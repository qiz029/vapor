/** Public catalog and exact install plans, using the official Hub API. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ProfileUpdate} from './profile-update.js';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
export function verifyInstalledVersion(profileRoot,name,version){
 if(!/^(@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name))throw Error('无效插件名称');
 const actual=JSON.parse(readFileSync(join(profileRoot,'node_modules',name,'package.json'),'utf8'));
 if(actual.name!==name||actual.version!==version)throw Error('实际安装版本与确认版本不一致');
 const manifest=JSON.parse(readFileSync(join(profileRoot,'package.json'),'utf8'));
 if(!manifest.dsh?.profile?.bundles?.includes(name))throw Error('插件未加入当前配置');
 return true;
}
const execute=promisify(execFile);
export class Hub {
 constructor({home=process.env.DSH_HOME,profile=process.env.VAPOR_PROFILE||'web',request=fetch}={}){
  if(!/^[a-zA-Z0-9_-]+$/.test(profile))throw Error('Invalid profile');
  this.home=home;this.profile=profile;this.plans=new Map();this.request=request;
 }
 async get(path){const response=await this.request('https://api.dshpluginhub.ai/api/v1'+path,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok)throw Error('插件目录暂不可用');return response.json();}
 async search({query=''}){
  if(typeof query!=='string'||query.length>200)throw Error('搜索内容过长');
  const data=await this.get('/packages?q='+encodeURIComponent(query)+'&limit=20');if(!Array.isArray(data.items))throw Error('插件目录格式异常');
  return {items:data.items.filter(p=>typeof p.packageName==='string'&&typeof p.latestVersion==='string').map(p=>({packageName:p.packageName,latestVersion:p.latestVersion,displayName:typeof p.displayName==='string'?p.displayName:p.packageName,summary:typeof p.summary==='string'?p.summary:'',security:p.security})),nextCursor:data.nextCursor??null};
 }
 async plan({name,version}){
  if(typeof name!=='string'||!/^(@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name))throw Error('无效插件名称');
  if(typeof version!=='string'||!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))throw Error('请选择确定的版本');
  const info=await this.get('/packages/resolve?name='+encodeURIComponent(name));
  const selected=Array.isArray(info.versions)?info.versions.find(v=>v.version===version):null;
  if(info.packageName!==name||!selected||selected.yanked||!selected.source?.installSpec)throw Error('Hub 返回的版本不可安装');
  const plan={id:randomUUID(),input:{profile:this.profile,packageName:name,version,installSpec:selected.source.installSpec},source:selected.source,compatibility:selected.compatibility,security:info.security};
  if(this.home){try{const installed=JSON.parse(readFileSync(join(this.home,'profiles',this.profile,'node_modules',name,'package.json'),'utf8'));if(installed.name===name&&typeof installed.version==='string')plan.installedVersion=installed.version;}catch(error){if(error.code!=='ENOENT')throw error;}}
  this.plans.set(plan.id,plan);return plan;
 }
 cancel({confirmed}){if(confirmed!==true)throw Error('请确认取消更新');return (this.update??=new ProfileUpdate(this.home,this.profile)).cancel();}
 status(){return {update:new ProfileUpdate(this.home,this.profile).read()};}
 async rollback({confirmed}){if(confirmed!==true)throw Error('请确认恢复');return (this.update??=new ProfileUpdate(this.home,this.profile)).rollback();}
 async install({id,confirmed}){
  const plan=this.plans.get(id);if(!plan||confirmed!==true)throw Error('请重新查看并确认安装计划');
  const spec=plan.input?.installSpec;
  if(spec!==plan.input?.packageName+'@'+plan.input?.version&&!/^github:[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+#[a-f0-9]{40}$/.test(spec||''))throw Error('安装来源必须是确定 npm 版本或完整 Git 提交');
  const update=this.update??=new ProfileUpdate(this.home,this.profile);
  return update.stage(async stage=>{
   const env={...process.env,DSH_HOME:this.home,CI:'true'};
   await execute('dsh',['plugin','--profile',stage,'add','--ignore-scripts',spec],{env,timeout:180000,maxBuffer:2*1024*1024});
   verifyInstalledVersion(join(this.home,'profiles',stage),plan.input.packageName,plan.input.version);
   await execute('dsh',['--profile',stage,'--dump-config'],{env,timeout:45000,maxBuffer:2*1024*1024});
  });
 }
}
