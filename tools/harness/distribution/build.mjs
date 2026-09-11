/** Allowlist-only distribution builder. Never captures local DSH profiles or media. */
import {cpSync,mkdirSync,readFileSync,writeFileSync,readdirSync,lstatSync,existsSync,realpathSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {packs,sharedPython,optionalPacks} from './catalog.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const args=process.argv.slice(2),out=resolve(args[0]||'outputs/vapor-distribution');
const repository=args[1];if(repository&&!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repository))throw new Error('Use a GitHub repository URL');
if(existsSync(out))throw new Error('Use a new output directory');
const version='0.3.0',items=[];
const sourceFiles=new Set(['package.json','model-lock.json','skills/upstream-lock.json']);
mkdirSync(out,{recursive:true});
function copy(from,to){const path=join(root,from);if(lstatSync(path).isSymbolicLink())throw new Error('Symlinks are not distributable');mkdirSync(resolve(to,'..'),{recursive:true});cpSync(path,to,{recursive:true,dereference:false,filter:source=>{if(lstatSync(source).isSymbolicLink())throw new Error('Symlink in package source');const include=!/(?:^|\/)(?:__pycache__|node_modules|\.DS_Store)(?:\/|$)/.test(source)&&!source.endsWith('.pyc');if(include&&lstatSync(source).isFile())sourceFiles.add(relative(root,source));return include;}});}
function write(path,data){writeFileSync(path,typeof data==='string'?data:JSON.stringify(data,null,2)+'\n');}
function files(path){return readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(path,entry.name)):[join(path,entry.name)]);}
function resources(folder,dir,m){
 const operations=packs[folder];if(!operations)return;
 for(const file of ['register-tools.js','catalog.json','TOOLS.md'])copy(`tools/harness/${folder}/${file}`,join(dir,file));
 const paths=new Set([...sharedPython,'tools/harness/plugin_driver.py',...operations.map(o=>o.script)]);
 // Python imports are resolved against this portable resource tree, never the developer checkout.
 for(const path of paths)copy(path,join(dir,'resources',path));
 copy('skills/upstream-lock.json',join(dir,'resources/skills/upstream-lock.json'));
 const lock=JSON.parse(readFileSync(join(root,'skills/upstream-lock.json')))['video-use'];
 for(const path of Object.keys(lock.sha256))copy(lock.path+'/'+path,join(dir,'resources',lock.path,path));
 for(const path of ['examples/production','examples/project-contract','examples/video-editing','examples/project-costs','examples/music','examples/modal','examples/dance-motion','examples/vapor'])copy(path,join(dir,'resources',path));
 for(const name of ['project-contract','production-workflow','video-editing','local-voice']){
  sourceFiles.add('docs/'+name+'.md');
  const source=readFileSync(join(root,'docs',name+'.md'),'utf8').replaceAll('.venv/bin/python','python3');
  mkdirSync(join(dir,'resources/docs'),{recursive:true});write(join(dir,'resources/docs',name+'.md'),source);
 }
 const requirements='numpy==2.3.5\nscipy==1.17.0\nsoundfile==0.14.0\nrequests==2.32.5\npillow==12.3.0\n';
 write(join(dir,'requirements.txt'),requirements+(folder==='vapor-gpu-modal'?'modal==1.5.5\n':'')+(folder==='vapor-voice-local'?'demucs==4.0.1\nmlx-audio==0.5.1\nhuggingface-hub==1.30.0\n':''));
 if(folder==='vapor-gpu-modal')copy('tools/gpu/modal_app.py',join(dir,'resources/tools/gpu/modal_app.py'));
 if(folder==='vapor-voice-local')copy('model-lock.json',join(dir,'resources/model-lock.json'));
 if(['vapor-remotion','vapor-regression'].includes(folder)){
  for(const file of ['cli.ts','assets.ts','schema.ts','render-mv.ts','src'])copy('tools/video/remotion/'+file,join(dir,'resources/tools/video/remotion',file));
  for(const path of ['examples/remotion','examples/regression','tools/audio/mix.py','tools/video/finalize.py'])copy(path,join(dir,'resources',path));
  m.dependencies={...JSON.parse(readFileSync(join(root,'package.json'))).dependencies,tsx:'4.20.3'};
 }
 m.peerDependencies={'@toddzheng024/vapor':version};
}
function build(folder,allowlist,extra){
 const dir=join(out,folder);mkdirSync(dir);
 for(const file of allowlist)copy(`tools/harness/${folder}/${file}`,join(dir,file));
 sourceFiles.add('tools/harness/'+folder+'/package.json');
 let manifest=JSON.parse(readFileSync(join(root,'tools/harness',folder,'package.json')));
 manifest.version=version;manifest.private=true;manifest.license='MIT';manifest.keywords=['dsh-plugin','deepseek-harness','vapor','media'];
 if(repository)manifest.repository={type:'git',url:repository+'.git',directory:'tools/harness/'+folder};
 extra?.(dir,manifest);resources(folder,dir,manifest);copy('tools/harness/distribution/LICENSE',join(dir,'LICENSE'));manifest.files=readdirSync(dir).filter(name=>name!=='package.json');
 delete manifest.scripts;
 write(join(dir,'package.json'),manifest);
 for(const file of files(dir)){
   const rel=relative(dir,file);
   if(/(^|\/)(\.env|\.credentials|models|voices|outputs|dev-home)(\/|$)/.test(rel))throw new Error('Private payload: '+rel);
   if(/\.(js|mjs|json|yml|md|ts|tsx|py)$/.test(file)&&/\/Users\/toddzheng|link:|\.venv\//.test(readFileSync(file,'utf8')))throw new Error('Nonportable package content: '+rel);
 }
 const result=spawnSync('npm',['pack','--ignore-scripts','--json','--pack-destination',out],{cwd:dir,encoding:'utf8',env:{...process.env,npm_config_cache:join(out,'.npm-cache')}});
 if(result.status!==0)throw new Error(result.stderr);
 const packed=JSON.parse(result.stdout)[0];items.push({name:manifest.name,version,tarball:packed.filename,integrity:packed.integrity,sha256:createHash('sha256').update(readFileSync(join(out,packed.filename))).digest('hex'),files:packed.files.map(f=>f.path)});
}
build('media-workbench',['host.js','credential-settings.js','hub.js','profile-update.js','canvas.js','projects.js','project.js','runtime.js','context.js','context-tools.js','toolkit.js','store.js','lab.js','http.js','agent-tools.js','execution-tools.js','vlm-tools.js','capabilities.js','client.js','cli.js','web','vapor-mark.svg','presets','DISTRIBUTION.md'],(dir,m)=>{
 copy('tools/harness/media-workbench/portable.patch.yml',join(dir,'cordis.patch.yml'));
 m.exports['./preset']='./presets/vapor/agent.cordis.yml';m.description='Vapor media framework: immutable artifacts, feedback, local jobs and optional review services';
 m.bin={vapor:'./cli.js'};
 m.exports['./vlm-tools']='./vlm-tools.js';
 m.dsh.hub={displayName:'Vapor Framework',summary:m.description,compatibility:{dsh:'0.1.5-rc.1'},entryIds:['media-workbench'],channel:'beta'};
});
build('vapor-remotion',['index.js','cordis.patch.yml','README.md'],(dir,m)=>{
 for(const file of ['cli.ts','assets.ts','schema.ts','src'])copy('tools/video/remotion/'+file,join(dir,'renderer/tools/video/remotion',file));
 copy('examples/remotion/hello.json',join(dir,'renderer/examples/remotion/hello.json'));
 m.dependencies={...JSON.parse(readFileSync(join(root,'package.json'))).dependencies,tsx:'4.20.3'};
 m.description='Vapor Remotion rendering, stills, full music videos and animatics';m.engines={node:'>=24'};
 m.dsh.hub={displayName:'Vapor Remotion',summary:m.description,compatibility:{dsh:'0.1.5-rc.1'},entryIds:['vapor-remotion'],after:['@toddzheng024/vapor'],channel:'beta'};
});
build('vapor-vlm-modal',['index.js','tools.js','service.js','cordis.patch.yml','requirements.txt','README.md'],dir=>{
 for(const file of ['vlm_prepare.py','vlm_worker.py','vlm_jobs.py','vapor_bridge.py','modal_vlm_app.py'])copy('tools/gpu/'+file,join(dir,'python/tools/gpu',file));
 copy('tools/video/job_store.py',join(dir,'python/tools/video/job_store.py'));
});
build('vapor-suite',['README.md']);
for(const folder of Object.keys(packs).filter(n=>!['vapor-remotion','vapor-voice-local'].includes(n)))build(folder,['index.js','cordis.patch.yml','README.md']);
build('vapor-voice-local',['index.js','cordis.patch.yml','requirements.txt','README.md'],(dir,m)=>{
 copy('tools/voice/voice.py',join(dir,'python/tools/voice/voice.py'));
 m.os=['darwin'];m.engines={node:'>=24'};m.description='Optional macOS local reference-voice preparation for Vapor';
 m.dsh.hub={displayName:'Vapor Local Voice',summary:m.description,compatibility:{dsh:'0.1.5-rc.1',platforms:['darwin']},entryIds:['vapor-voice-local'],after:['@toddzheng024/vapor'],channel:'beta'};
});
write(join(out,'release-candidate.json'),{schemaVersion:1,version,runtime:{package:'@deepseek-ai/dsh',version:'0.1.5-rc.1'},repository:repository??null,packages:items,profile:JSON.parse(readFileSync(join(out,'vapor-suite/package.json'))).dsh.profile,optionalPacks,published:false,releaseBlockers:[...(!repository?['public repository not configured']:[]),'npm packages not published','Hub immutable Profile Release not captured','cloud provider integration and model-dependent acceptance pending']});
copy('tools/harness/distribution/install-local.mjs',join(out,'install-local.mjs'));
write(join(out,'README.md'),`# Vapor ${version} local candidate\n\nThis archive contains the framework, capability plugins and Studio Profile. It is not an npm or Hub publication. Tarball hashes and exact runtime versions are in release-candidate.json.\n\nInstall Node 24+, pnpm (validated with 10.15.1), DSH 0.1.5-rc.1, FFmpeg/ffprobe and Chrome/Chromium. Install the package managers with \`npm install -g pnpm@10.15.1 @deepseek-ai/dsh@0.1.5-rc.1\`. Unpack this directory and run:\n\n\`\`\`sh\nnode install-local.mjs . /absolute/path/to/a-new-dsh-home\n\`\`\`\n\nThe installer modifies only the specified profile, resolves unpublished Vapor dependencies to local tarballs, and fetches missing public dependencies. Set VAPOR_OFFLINE=1 when dependencies are already cached. Dependency lifecycle scripts are not run. macOS voice and legacy Gemini are included for local testing; the published Studio descriptor keeps them optional.\n\nCreate a Python environment and install the selected plugin requirements.txt from its installed package. Set VAPOR_TOOLS_PYTHON to that interpreter; Modal Qwen uses VAPOR_VLM_PYTHON. MLX voice needs its optional environment and separately prepared model. Open Settings > 能力插件 to save service credentials locally; all projects share these credentials. Existing values are never filled back into the form. Do not put credentials in plans or this bundle.\n\nUse the installed profile node_modules/.bin/vapor binary: doctor, init --project DIR, import --project DIR FILE..., then serve --project DIR --profile web with DSH_HOME set to the selected home. Choose a project on the left and describe work in chat; review prepared tasks using 创作任务 at the top right of the canvas. Agents use media_tools_list and media_tool_help. A missing browser must be installed separately or set REMOTION_BROWSER_EXECUTABLE; rendering never downloads one implicitly.\n\nRemote jobs require explicit input and budget approval. The entire project shares one generation/ledger.json. No provider was contacted during local packaging. Full listening/playback and live provider verification remain separate. Stop jobs and back up the whole project before upgrades; packages never contain model weights, voices or credentials.\n`);
console.log(JSON.stringify({out,packages:items.map(({files,...rest})=>rest),published:false},null,2));

write(join(out,'distribution-source.json'),{files:[...sourceFiles].sort()});
