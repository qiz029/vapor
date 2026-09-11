/** Export a candidate using an explicit allowlist; never archive the build directory recursively. */
import {readFileSync,writeFileSync,copyFileSync,mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {resolve,join,basename,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const [candidateArg,outputArg]=process.argv.slice(2);
if(!candidateArg||!outputArg)throw new Error('Usage: archive.mjs CANDIDATE_DIRECTORY OUTPUT.tar.gz');
const candidate=resolve(candidateArg),output=resolve(outputArg);
if(!output.endsWith('.tar.gz')||existsSync(output)||existsSync(output+'.sha256'))throw new Error('Choose a new .tar.gz output path');
const release=JSON.parse(readFileSync(join(candidate,'release-candidate.json')));
const files=['README.md','install-local.mjs','release-candidate.json','package-audit.json','license-inventory.json'];
for(const p of release.packages){
 if(basename(p.tarball)!==p.tarball||!p.tarball.endsWith('.tgz'))throw new Error('Invalid package filename');
 const bytes=readFileSync(join(candidate,p.tarball));
 if(createHash('sha256').update(bytes).digest('hex')!==p.sha256)throw new Error('Package checksum mismatch: '+p.name);
 files.push(p.tarball);
}
const stage=mkdtempSync(join(tmpdir(),'vapor-export-'));
try{
 const root=join(stage,'vapor-candidate');mkdirSync(root);
 for(const file of new Set(files))copyFileSync(join(candidate,file),join(root,file));
 const archive=join(stage,'candidate.tar.gz');
 const result=spawnSync('tar',['-czf',archive,'-C',stage,'vapor-candidate'],{encoding:'utf8'});
 if(result.status!==0)throw new Error('Archive creation failed: '+result.stderr);
 mkdirSync(dirname(output),{recursive:true});copyFileSync(archive,output,1);
 const sha256=createHash('sha256').update(readFileSync(output)).digest('hex');
 writeFileSync(output+'.sha256',sha256+'  '+basename(output)+'\n',{flag:'wx'});
 console.log(JSON.stringify({archive:output,sha256,packages:release.packages.length,files:new Set(files).size,published:false}));
}finally{rmSync(stage,{recursive:true,force:true});}
