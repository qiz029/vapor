#!/usr/bin/env node
/** Portable local entrypoint; no installation, credential copying or cloud submission. */
import {parseArgs} from 'node:util';
import {spawnSync,spawn} from 'node:child_process';
import {copyFileSync,mkdirSync,statSync,writeFileSync} from 'node:fs';
import {basename,extname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store,MIME} from './store.js';
import {projectRoot} from './project.js';
import {homedir} from 'node:os';
import {ProfileUpdate} from './profile-update.js';
const {positionals,values}=parseArgs({allowPositionals:true,options:{project:{type:'string'},profile:{type:'string',default:'web'},port:{type:'string',default:'3090'},help:{type:'boolean'}}});
const [command,...files]=positionals;
if(values.help||!command){console.log('Vapor: doctor | init --project DIR | import --project DIR FILE... | serve --project DIR [--profile web] [--port 3090]');}
else if(command==='init'){
  const root=projectRoot({projectRoot:values.project});
  const doc={schemaVersion:1,project:{id:'film',title:basename(root),brief:'Describe the intended production here.',dependsOn:[]},narrations:[],shots:[],assets:[],checks:[],approvals:[]};
  const file=join(root,'project.json');writeFileSync(file,JSON.stringify(doc,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({project:file,next:'Import source files, then register production assets through the project plugin.'}));
}
else if(command==='doctor'){
  const checks={node:{ok:Number(process.versions.node.split('.')[0])>=24,version:process.version}};
  for(const [tool,args] of [['dsh',['--version']],['ffmpeg',['-version']],['ffprobe',['-version']]]){const result=spawnSync(tool,args,{encoding:'utf8',timeout:10000});checks[tool]={ok:result.status===0,version:result.stdout?.split('\n')[0]||'unavailable'};}
  checks.dsh.ok=checks.dsh.ok&&checks.dsh.version.includes('0.1.5-rc.1');
  for(const [name,executable,modules] of [['python',process.env.VAPOR_TOOLS_PYTHON||'python3',[]],['modalPython',process.env.VAPOR_VLM_PYTHON||'python3',['modal','PIL']]]){
   const result=spawnSync(executable,['-c','import importlib.util,json,sys; print(json.dumps({"version":sys.version.split()[0],"modules":{m:importlib.util.find_spec(m) is not None for m in sys.argv[1:]}}))',...modules],{encoding:'utf8',timeout:10000,maxBuffer:65536});
   let info;try{info=JSON.parse(result.stdout);}catch{}
   checks[name]={ok:result.status===0&&!!info&&Object.values(info.modules).every(Boolean),optional:name==='modalPython',executable,...(info||{version:'unavailable'})};
  }
  console.log(JSON.stringify({checks,optionalVlm:'Install the VLM package requirements and configure VAPOR_VLM_PYTHON; this check makes no cloud calls.'},null,2));
  if(!checks.node.ok||!checks.dsh.ok||!checks.python.ok)process.exitCode=1;
}else if(command==='import'){
  if(!files.length)throw new Error('Specify files to import');
  const inputs=files.map(file=>{const path=resolve(file),info=statSync(path);if(!info.isFile()||info.size>512*1024*1024||!MIME[extname(path).toLowerCase()])throw new Error('Unsupported input: '+basename(path));return path;});
  const root=projectRoot({projectRoot:values.project}),store=new Store(root);
  try{for(const file of inputs){const id='import-'+randomUUID(),dir=join(root,'imports',id);mkdirSync(dir,{recursive:true});const path=join(dir,'source'+extname(file).toLowerCase());copyFileSync(file,path,1);console.log(JSON.stringify(store.register({id,title:basename(file),path:join('imports',id,basename(path))})));}}finally{store.close();}
}else if(command==='serve'){
  const port=Number(values.port);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid port');
  const root=projectRoot({projectRoot:values.project});
  const home=process.env.DSH_HOME||join(homedir(),'.dsh');new ProfileUpdate(home,values.profile).activate();
  const child=spawn('dsh',['--profile',values.profile,'--no-open','--port',String(port)],{env:{...process.env,DSH_HOME:home,VAPOR_PROFILE:values.profile,VAPOR_PROJECT_ROOT:root},stdio:'inherit'});
  child.on('error',error=>{console.error(error.message);process.exitCode=1;});child.on('exit',code=>process.exitCode=code??1);
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
}else throw new Error('Unknown Vapor command');
