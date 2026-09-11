/** Regenerate descriptors and thin plugin entrypoints from the reviewed inventory. */
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {packs,optionalPacks} from './catalog.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export const version='0.3.0';
const write=(file,value)=>writeFileSync(file,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
for(const [name,operations]of Object.entries(packs)){
 const dir=join(root,name);mkdirSync(dir,{recursive:true});
 const definitions=operations.flatMap(o=>o.remote==='ledger'?[{...o,id:o.id+'.validate',description:o.description+' (offline validation)',remote:false,dryOnly:true,approvalArgs:[],recovery:[]},o]:[o]);
 write(join(dir,'catalog.json'),definitions);
 write(join(dir,'register-tools.js'),`import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export function registerTools(ctx,config={}){
 const resources=fileURLToPath(new URL('./resources/',import.meta.url));
 const root=existsSync(resources)?resources:fileURLToPath(new URL('../../../',import.meta.url));
 const catalog=JSON.parse(readFileSync(new URL('./catalog.json',import.meta.url),'utf8'));
 return ctx.vaporRuntime.toolkit.registerPack('${name}',root,catalog,config);
}
`);
 if(!['vapor-remotion','vapor-voice-local'].includes(name)){
  write(join(dir,'index.js'),`import {registerTools} from './register-tools.js';
export const inject=['vaporRuntime'];
export function apply(ctx,config={}){ctx.effect(()=>registerTools(ctx,config));}
`);
  write(join(dir,'cordis.patch.yml'),`- insert:\n    - id: ${name}\n      name: '@toddzheng024/${name}'\n`);
  write(join(dir,'package.json'),{name:'@toddzheng024/'+name,version,private:true,license:'MIT',type:'module',exports:{'.':'./index.js'},engines:{node:'>=24'},os:['darwin','linux'],peerDependencies:{'@toddzheng024/vapor':version},description:operations.map(o=>o.id).join(', ').slice(0,500),dsh:{bundle:{patch:'./cordis.patch.yml'},hub:{displayName:name,summary:'Vapor '+name.slice(6).replaceAll('-',' ')+' tool operations',compatibility:{dsh:'0.1.5-rc.1',platforms:['darwin','linux']},entryIds:[name],after:['@toddzheng024/vapor'],channel:'beta'}}});
 }
 const header=`# @toddzheng024/${name}\n\nInstall as a DSH bundle alongside @toddzheng024/vapor ${version}. Requires Node 24+, FFmpeg/FFprobe and a Python environment selected by VAPOR_TOOLS_PYTHON (or plugin config.python). Install requirements.txt into your own environment. No install hook downloads models or runs media.\n\nIn Vapor Lab, select a plugin tool, enter project-relative file paths, prepare, then execute. Agents use media_tools_list, media_tool_prepare, media_tool_run and media_tool_get. Remote work requires exact user approval in Lab; media_tool_resume only resumes the original job. Use the recovery panel for provider receipts and verified billing. The project uses one generation/ledger.json across plugins.\n\nTool inputs and outputs live in VAPOR_PROJECT_ROOT, not node_modules. Setup credentials in the process environment; plugins do not read .env files. Models and voice profiles stay in project models/ and voices/, and are never included in packages. Results retain pending visual/listening/playback review.\n\n`;
 const listing=definitions.map(o=>`- **${o.id}**: ${o.remote?'remote '+o.provider+'; user approval':o.authority==='user'?'user-confirmed evidence only':'local'}; required inputs: ${o.required.join(', ')||'none'}.`).join('\n');
 write(join(dir,'TOOLS.md'),header+'## Operations\n\n'+listing+'\n\nExact input schemas are returned by media_tools_list and recorded in catalog.json. Reference contracts, examples and helper licenses ship in resources/. JSON file references must resolve within the selected project.\n');
 if(!existsSync(join(dir,'README.md')))write(join(dir,'README.md'),header+'See [tool operations](TOOLS.md) for the executable interface.\n');
}
for(const name of ['media-workbench','vapor-remotion','vapor-voice-local','vapor-vlm-modal']){const file=join(root,name,'package.json'),p=JSON.parse(readFileSync(file));p.version=version;p.license='MIT';write(file,p);}
const suitePath=join(root,'vapor-suite/package.json'),suite=JSON.parse(readFileSync(suitePath));suite.version=version;
const bundles=['@toddzheng024/vapor',...Object.keys(packs).filter(n=>!optionalPacks.includes(n)).map(n=>'@toddzheng024/'+n),'@toddzheng024/vapor-vlm-modal'];
suite.dependencies=Object.fromEntries(bundles.map(n=>[n,version]));suite.dsh.profile.bundles=bundles;write(suitePath,suite);
console.log(JSON.stringify({version,packs:Object.keys(packs).length,operations:Object.values(packs).flat().length,suite:bundles,optionalPacks}));
