/** Install unpublished candidates into an explicit isolated profile using local dependency overrides. */
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const [candidateArg,homeArg,profile='web']=process.argv.slice(2);
if(!candidateArg||!homeArg)throw new Error('Usage: install-local.mjs CANDIDATE_DIRECTORY ISOLATED_DSH_HOME [PROFILE]');
const candidate=resolve(candidateArg),home=resolve(homeArg);
if(!/^[a-zA-Z0-9_-]+$/.test(profile))throw new Error('Invalid profile');
const release=JSON.parse(readFileSync(join(candidate,'release-candidate.json')));
if(Number(process.versions.node.split('.')[0])<24)throw new Error('Install Node 24 or newer before this profile');
const pnpm=spawnSync('pnpm',['--version'],{encoding:'utf8',timeout:10000});
if(pnpm.status!==0)throw new Error('Install pnpm before this profile (npm install -g pnpm@10.15.1), then retry. No profile changes were made.');
const selectedPackages=release.packages.filter(p=>p.name!=='@toddzheng024/vapor-voice-local'||process.platform==='darwin');
const installed=spawnSync('dsh',['--version'],{encoding:'utf8'});if(installed.status!==0||!installed.stdout.includes(release.runtime.version))throw new Error('Install DSH '+release.runtime.version+' before this profile');
// A candidate may retain its version while its bytes change. Never reuse a mutable
// tarball path: package managers can otherwise silently retain an older candidate.
const archives=release.packages.map(p=>{
 const bytes=readFileSync(join(candidate,p.tarball));
 const digest=createHash('sha256').update(bytes).digest('hex');
 if(digest!==p.sha256)throw new Error('Candidate checksum mismatch: '+p.name);
 return {name:p.name,bytes,path:join(home,'vapor','candidate-archives',digest+'.tgz')};
});
for(const archive of archives){
 mkdirSync(join(home,'vapor','candidate-archives'),{recursive:true});
 if(existsSync(archive.path)){
  if(!readFileSync(archive.path).equals(archive.bytes))throw new Error('Candidate cache checksum mismatch: '+archive.name);
 }else writeFileSync(archive.path,archive.bytes,{flag:'wx',mode:0o600});
}
const archivePath=name=>archives.find(a=>a.name===name).path;
const env={...process.env,DSH_HOME:home,CI:'true'};
const run=args=>{const r=spawnSync('dsh',args,{env,stdio:'inherit'});if(r.status!==0)throw new Error('DSH command failed');};
const dir=join(home,'profiles',profile);
if(!existsSync(join(dir,'package.json')))run(['--profile',profile,...(profile==='web'?[]:['--from-default-profile','web']),'--dump-config']);
const workspace=join(dir,'pnpm-workspace.yaml'),old=readFileSync(workspace,'utf8');
const marker='# Vapor local candidate overrides';
if(/^overrides:/m.test(old)&&!old.includes(marker))throw new Error('Profile already has unrelated dependency overrides; choose a new isolated profile');
const overrides=release.packages.map(p=>'  '+JSON.stringify(p.name)+': '+JSON.stringify('file:'+archivePath(p.name))).join('\n');
writeFileSync(workspace,old.split(marker)[0].trimEnd()+'\n\n'+marker+'\noverrides:\n'+overrides+'\n');
run(['plugin','--profile',profile,'add',...(process.env.VAPOR_OFFLINE==='1'?['--offline']:[]),'--ignore-scripts',...selectedPackages.map(p=>archivePath(p.name))]);
// A profile descriptor is a shareable installation plan, not a bundle itself.
const file=join(dir,'package.json'),p=JSON.parse(readFileSync(file));
const profileBundles=release.profile?.bundles??JSON.parse(readFileSync(join(candidate,'vapor-suite/package.json'))).dsh.profile.bundles;
const bundled=new Set(release.packages.filter(p=>p.name!=='@toddzheng024/vapor-suite').map(p=>p.name));
const base=(p.dsh?.profile?.bundles??[]).filter(n=>!bundled.has(n)&&n!=='@toddzheng024/vapor-suite');
p.dsh.profile.bundles=[...base,...profileBundles,...(release.optionalPacks??[]).filter(n=>n!=='vapor-voice-local'||process.platform==='darwin').map(n=>'@toddzheng024/'+n)];
writeFileSync(file,JSON.stringify(p,null,2)+'\n');
console.log(JSON.stringify({home,profile,version:release.version,plugins:p.dsh.profile.bundles,postinstallScripts:false,published:false}));
