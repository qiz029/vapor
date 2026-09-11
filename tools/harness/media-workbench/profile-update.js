/** Stage changes away from the running profile; activate only during startup. */
import {cpSync,mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,readdirSync,lstatSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {join,relative} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export function profileFingerprint(root){
 const hash=createHash('sha256');
 function visit(dir){for(const name of readdirSync(dir).sort()){if(name==='node_modules')continue;const path=join(dir,name),stat=lstatSync(path);hash.update(relative(root,path));if(stat.isSymbolicLink())throw Error('配置目录包含符号链接');if(stat.isDirectory())visit(path);else hash.update(readFileSync(path));}}
 visit(root);return hash.digest('hex');
}
export class ProfileUpdate{
 constructor(home,profile){if(!/^[a-zA-Z0-9_-]+$/.test(profile))throw Error('Invalid profile');this.home=home;this.profile=profile;this.root=join(home,'profiles');this.target=join(this.root,profile);this.legacyRecord=join(home,'vapor','profile-update.json');this.record=join(home,'vapor','profile-update-'+profile+'.json');mkdirSync(join(home,'vapor'),{recursive:true,mode:0o700});this.busy=false;}
 read(){
  if(existsSync(this.record)){const r=JSON.parse(readFileSync(this.record,'utf8'));if(r.profile!==this.profile)throw Error('更新记录与当前配置不匹配');return r;}
  if(!existsSync(this.legacyRecord))return null;
  const legacy=JSON.parse(readFileSync(this.legacyRecord,'utf8'));return legacy.profile===this.profile?legacy:null;
 }
 write(value){const tmp=this.record+'.tmp';writeFileSync(tmp,JSON.stringify(value),{mode:0o600,flush:true});renameSync(tmp,this.record);return value;}
 lock(){
  const path=this.legacyRecord+'.lock';
  if(existsSync(path)){let pid;try{pid=JSON.parse(readFileSync(path,'utf8')).pid;}catch{throw Error('更新锁需要检查');}
   if(!Number.isInteger(pid)||pid<=0)throw Error('无效更新锁');
   try{process.kill(pid,0);throw Error('另一个更新进程正在运行');}catch(e){if(e.code!=='ESRCH')throw e;unlinkSync(path);}
  }
  const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,JSON.stringify({pid:process.pid}),{flush:true});}finally{closeSync(fd);}
  return()=>unlinkSync(path);
 }
 async stage(install){
  const unlock=this.lock();let record;
  try{
   if(this.busy||['ready','switching','recovery_required','restoring'].includes(this.read()?.state))throw Error('已有更新，请先应用或恢复');this.busy=true;
   const id=randomUUID(),stageName=this.profile+'-vapor-'+id,stage=join(this.root,stageName);
   record={id,profile:this.profile,state:'preparing',stageName,backupName:this.profile+'-previous-'+id,before:profileFingerprint(this.target)};this.write(record);
   cpSync(this.target,stage,{recursive:true,verbatimSymlinks:true});await install(stageName);
   if(profileFingerprint(this.target)!==record.before)throw Error('配置已变化，请重新准备更新');record.after=profileFingerprint(stage);record.state='ready';return this.write(record);
  }catch(error){if(record){record.state='failed';record.error='更新准备失败，原配置保持不变';this.write(record);throw Error(record.error);}throw error;}finally{this.busy=false;unlock();}
 }
 cancel(){
  const unlock=this.lock();try{const r=this.read();if(r?.state!=='ready'||r.profile!==this.profile)throw Error('没有可取消的待应用更新');r.state='cancelled';return this.write(r);}finally{unlock();}
 }
 rollback(){
  const previous=this.read();if(this.busy||previous?.state!=='applied')throw Error('没有可恢复的已应用更新');
  const backup=previous.backupName;
  if(!backup?.startsWith(this.profile+'-previous-')||!/^[a-zA-Z0-9_-]+$/.test(backup))throw Error('无效恢复记录');
  const source=join(this.root,backup);if(!existsSync(source))throw Error('之前的版本不存在');
  return this.stage(async stage=>{const destination=join(this.root,stage);renameSync(destination,destination+'-discarded');cpSync(source,destination,{recursive:true,verbatimSymlinks:true});});
 }
 activate(){const unlock=this.lock();try{return this.activateLocked();}finally{unlock();}}
 activateLocked(){
  const r=this.read();if(!r||!['ready','switching','recovery_required','restoring'].includes(r.state))return r;
  if(r.profile!==this.profile||!r.stageName?.startsWith(this.profile+'-vapor-')||!r.backupName?.startsWith(this.profile+'-previous-')||[r.stageName,r.backupName].some(n=>!/^[a-zA-Z0-9_-]+$/.test(n)))throw Error('无效更新记录');
  const stage=join(this.root,r.stageName),backup=join(this.root,r.backupName);
  if(['recovery_required','restoring'].includes(r.state))return this.restoreLocked(r,backup);
  if(r.state==='ready'){
   if(!existsSync(this.target))throw Error('当前配置不存在，请恢复后重试');
   let unchanged=false;try{unchanged=profileFingerprint(this.target)===r.before&&profileFingerprint(stage)===r.after;}catch{}
   if(!unchanged){r.state='failed';r.error='配置已变化或更新文件不完整，已取消本次更新；继续使用当前配置';return this.write(r);}
   r.state='switching';this.write(r);
  }
  // A crash between renames is recovered on the next launch.
  if(!existsSync(backup)&&existsSync(this.target))renameSync(this.target,backup);
  if(!existsSync(this.target)&&existsSync(stage))renameSync(stage,this.target);
  let valid=false;try{valid=profileFingerprint(this.target)===r.after;}catch{}
  if(!valid)return this.restoreLocked(r,backup);
  r.state='applied';return this.write(r);
 }
 restoreLocked(r,backup){
  const matches=path=>{try{return profileFingerprint(path)===r.before;}catch{return false;}};
  // Resume safely if the previous launch already restored the original directory.
  if(r.state==='restoring'&&matches(this.target)){r.state='rolled_back';return this.write(r);}
  if(!matches(backup)){r.state='recovery_required';this.write(r);throw Error('旧版本校验失败，请检查恢复文件');}
  r.state='restoring';this.write(r);
  if(existsSync(this.target))renameSync(this.target,join(this.root,r.stageName+'-rejected-'+randomUUID()));
  renameSync(backup,this.target);r.state='rolled_back';return this.write(r);
 }
}
