/** Release integrity, executable coverage and optional Hub schema audit. No registry writes. */
import {readFileSync,readdirSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {packs} from './catalog.mjs';
const [candidateArg,schemasArg]=process.argv.slice(2);if(!candidateArg)throw new Error('Usage: audit.mjs CANDIDATE_DIRECTORY [HUB_SCHEMA_MODULE]');
const candidate=resolve(candidateArg),root=fileURLToPath(new URL('../../../',import.meta.url));
const release=JSON.parse(readFileSync(join(candidate,'release-candidate.json')));
const hub=schemasArg?await import(pathToFileURL(resolve(schemasArg))):null;
const licenseInventory=[];
const vendorLock=JSON.parse(readFileSync(join(root,'skills/upstream-lock.json')))['video-use'];
const manifests=[];for(const item of release.packages){
 if(createHash('sha256').update(readFileSync(join(candidate,item.tarball))).digest('hex')!==item.sha256)throw new Error('Tarball integrity mismatch');
 const folder=item.name==='@toddzheng024/vapor'?'media-workbench':item.name.split('/')[1];
 const p=JSON.parse(readFileSync(join(candidate,folder,'package.json')));
 const notices=item.files.filter(file=>/(?:^|\/)(?:LICENSE|NOTICE|COPYING|COPYRIGHT)(?:\.[^/]*)?$/i.test(file)).map(file=>{
  const extracted=spawnSync('tar',['-xOf',join(candidate,item.tarball),'package/'+file],{maxBuffer:2*1024*1024});
  if(extracted.status!==0)throw new Error('Cannot read packaged notice: '+item.name+'/'+file);
  const sha256=createHash('sha256').update(extracted.stdout).digest('hex');
  if(file.endsWith('tools/vendor/video-use/LICENSE')&&sha256!==vendorLock.sha256.LICENSE)throw new Error('Vendored license differs from pinned upstream: '+item.name);
  return {path:file,sha256};
 });
 if(item.files.some(file=>file.includes('tools/vendor/video-use/'))&&!notices.some(n=>n.path.endsWith('tools/vendor/video-use/LICENSE')))throw new Error('Missing video-use license: '+item.name);
 licenseInventory.push({name:p.name,version:p.version,declaredLicense:p.license??null,notices,declaredDependencies:p.dependencies??{},pythonRequirements:item.files.filter(f=>f.endsWith('requirements.txt'))});
 if(p.version!==release.version||!p.private)throw new Error('Unexpected candidate manifest');
 if(hub){(p.dsh.profile?hub.dshProfileManifestSchema:hub.dshPackageManifestSchema).parse(p);hub.hubListingSchema.parse(p.dsh.hub);}
 for(const file of item.files)if(/(?:^|\/)(?:\.env|\.credentials|models|voices|dev-home|__pycache__)(?:\/|$)/.test(file)||file.endsWith('.pyc'))throw new Error('Private/nonportable payload');
 const catalog=join(candidate,folder,'catalog.json');if(existsSync(catalog))for(const o of JSON.parse(readFileSync(catalog)))if(!existsSync(join(candidate,folder,'resources',o.script)))throw new Error('Missing executable '+o.script);
 manifests.push({name:p.name,version:p.version,integrity:'passed',hubSchema:hub?'passed':'not-run'});
}
const owners=new Map();for(const [name,ops]of Object.entries(packs))for(const o of ops)owners.set(o.script,name);
const supporting={
 'tools/audio/timeline.py':'vapor-audio',
 'tools/video/job_store.py':'shared durable budget dependency',
 'tools/video/editing/common.py':'vapor-editing shared helper',
 'tools/video/editing/evidence.py':'vapor-editing waveform helper',
 'tools/gpu/worker.py':'vapor-gpu-modal worker',
 'tools/gpu/modal_app.py':'vapor-gpu-modal deployment resource',
 'tools/gpu/vlm_worker.py':'vapor-vlm-modal worker',
 'tools/gpu/modal_vlm_app.py':'vapor-vlm-modal deployment resource',
 'tools/gpu/vlm_prepare.py':'vapor-vlm-modal preparation',
 'tools/gpu/vlm_jobs.py':'vapor-vlm-modal durable provider client',
 'tools/gpu/vapor_bridge.py':'vapor-vlm-modal source binding',
 'tools/skills/vendor_remotion.py':'development-only upstream maintenance (not a media operation)'
};
const coverage=[];function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){if(['harness','vendor','__pycache__','node_modules'].includes(e.name))continue;const file=join(dir,e.name);if(e.isDirectory())walk(file);else if(/\.(py|ts|tsx)$/.test(e.name)&&!e.name.includes('.test.')){const path=relative(root,file);const owner=owners.get(path)||supporting[path]||(path.startsWith('tools/video/remotion/')?'vapor-remotion rendering dependency':null);if(!owner)throw new Error('Unclassified tool '+path);coverage.push({source:path,owner});}}}walk(join(root,'tools'));
const value={version:release.version,packages:manifests,coverage,sourceFiles:coverage.length,operationCount:release.packages.reduce((n,p)=>{const f=join(candidate,p.name==='@toddzheng024/vapor'?'media-workbench':p.name.split('/')[1],'catalog.json');return n+(existsSync(f)?JSON.parse(readFileSync(f)).length:0);},0),published:false,cloudVerified:false};
writeFileSync(join(candidate,'package-audit.json'),JSON.stringify(value,null,2));console.log(JSON.stringify({version:value.version,packages:manifests.length,sourceFiles:value.sourceFiles,operations:value.operationCount,unclassified:0,hubSchema:!!hub}));
writeFileSync(join(candidate,'license-inventory.json'),JSON.stringify({scope:'Packaged notices and direct dependency declarations only; not legal clearance or a transitive dependency license audit',firstPartyLicenseDecisionPending:licenseInventory.some(p=>!p.declaredLicense||p.declaredLicense==='UNLICENSED'),pinnedVendor:{repository:vendorLock.repository,commit:vendorLock.commit},packages:licenseInventory},null,2)+'\n');
