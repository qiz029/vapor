/** Stable workstation settings. Credentials remain exclusively owned by DSH. */
import {existsSync,readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
export function localSettings(root,{project,port}={}){
 const file=join(root,'.harness/local-settings.json');
 const defaults={schemaVersion:1,dshHome:'.harness/dev-home',profile:'web',project:'outputs/cat-train-2026-09-09/fixed-camera-30s',port:3090};
 const value=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):defaults;
 if(value.schemaVersion!==1||!value.dshHome||!value.project||!/^[-\w]+$/.test(value.profile))throw new Error('Invalid Vapor local settings');
 const selectedPort=Number(port??value.port);if(!Number.isInteger(selectedPort)||selectedPort<1024||selectedPort>65535)throw new Error('Invalid Vapor port');
 const home=resolve(root,value.dshHome),selectedProject=realpathSync(resolve(root,project??value.project));
 if(home.startsWith('/tmp/')||home.startsWith('/private/tmp/'))throw new Error('Daily Vapor configuration must not use a temporary DSH home');
 if(!existsSync(file)){mkdirSync(join(root,'.harness'),{recursive:true});writeFileSync(file,JSON.stringify(defaults,null,2)+'\n',{flag:'wx',mode:0o600});}
 return {file,home,profile:value.profile,project:selectedProject,port:selectedPort};
}
