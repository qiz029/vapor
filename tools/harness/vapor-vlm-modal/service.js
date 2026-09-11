/** Optional remote review service. Approval is a user action, not an Agent tool. */
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {registerTools} from './tools.js';

const packageDir=fileURLToPath(new URL('.',import.meta.url));
const digest=value=>createHash('sha256').update(value).digest('hex');
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const text=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max;
const inside=(root,path)=>{const rel=relative(realpathSync(root),realpathSync(path));assert(rel!== '..'&&!rel.startsWith('../')&&!rel.startsWith('/'),'Path outside project');return realpathSync(path);};
const save=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2),{flag:'wx',mode:0o600,flush:true});

export function commandRunner(python,root,timeoutMs=120000,environment=async()=>({})){
  return async(script,args)=>{const env={...process.env,...await environment()};return new Promise((resolve,reject)=>{
    const child=spawn(python,[join(root,script),...args],{cwd:root,env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',expired=false;
    const timer=setTimeout(()=>{expired=true;child.kill('SIGKILL');},timeoutMs);
    child.stdout.on('data',data=>{stdout+=data;if(stdout.length>10*1024*1024)child.kill('SIGKILL');});
    child.stderr.on('data',data=>{stderr=(stderr+data).slice(-3000);});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',code=>{clearTimeout(timer);if(code!==0||expired)return reject(new Error(expired?'Client timed out; remote state must be reconciled':`VLM command failed: ${stderr}`));try{resolve(JSON.parse(stdout));}catch{reject(new Error('Invalid VLM command response'));}});
  });};
}

export class VlmService {
  registerTools(tools){return registerTools(tools,()=>this);}
  active=new Map(); closed=false;
  constructor(store,config={}){
    this.store=store;
    // One fixed production ledger, shared with other generation work.
    this.ledger=join(store.root,'generation');
    this.root=existsSync(join(packageDir,'python'))?join(packageDir,'python'):resolve(packageDir,'../../..');
    const localPython=join(this.root,'.venv-modal/bin/python');
    this.python=config.python||process.env.VAPOR_VLM_PYTHON||(existsSync(localPython)?localPython:'python3');
    this.run=config.run||commandRunner(this.python,this.root,120000,config.environment);
    store.db.exec('CREATE TABLE IF NOT EXISTS vapor_vlm_jobs(id TEXT PRIMARY KEY,command TEXT UNIQUE NOT NULL,fingerprint TEXT NOT NULL,payload TEXT NOT NULL)');
    for(const job of this.list())if(['preparing','submitting','collecting'].includes(job.state))this.update(job.id,{state:job.state==='preparing'?'interrupted':'recovery_required',error:'Process restarted; no automatic preparation or remote submission.'});
  }
  list(){return this.store.db.prepare('SELECT payload FROM vapor_vlm_jobs ORDER BY rowid DESC').all().map(row=>JSON.parse(row.payload));}
  get(id){const row=this.store.db.prepare('SELECT payload FROM vapor_vlm_jobs WHERE id=?').get(id);assert(row,'Unknown VLM job');const job=JSON.parse(row.payload);if(job.reportRevisionId){const r=this.store.file(job.reportRevisionId),bytes=readFileSync(r.absolute);assert(digest(bytes)===r.sha256,'Report changed');job.report=JSON.parse(bytes);}return job;}
  update(id,patch){const job={...this.get(id),...patch,updated:new Date().toISOString()};delete job.report;this.store.transaction(()=>{this.store.db.prepare('UPDATE vapor_vlm_jobs SET payload=? WHERE id=?').run(JSON.stringify(job),id);this.store.event('vlm.updated',{id,state:job.state});});return job;}
  snapshot(){return {enabled:this.isEnabled?.()??true,provider:'modal',model:'Qwen/Qwen3-VL-8B-Instruct',audioIncluded:false,jobs:this.list(),busy:this.active.size>0};}
  directory(id){return inside(this.store.root,join(this.store.dir,'vlm',id));}
  start(id,work,errorState){
    assert(!this.closed&&!this.active.size,'VLM service busy or closing');
    const promise=Promise.resolve().then(work).catch(error=>this.update(id,{state:errorState,error:String(error.message).slice(0,3000)})).finally(()=>this.active.delete(id));
    this.active.set(id,promise);
  }
  prepare(args){
    this.checkEnabled?.();
    assert(!this.closed,'VLM service closing');
    assert(text(args.commandId,100)&&/^[\w-]+$/.test(args.commandId),'Invalid commandId');
    assert(Array.isArray(args.items)&&args.items.length>=1&&args.items.length<=40,'Use 1–40 visual sources');
    const frameCount=args.frameCount??8;assert(Number.isInteger(frameCount)&&frameCount>=2&&frameCount<=12,'Use 2–12 video frames');
    const items=args.items.map((item,index)=>{
      assert(text(item.sourceRevisionId,100)&&text(item.question,5000),'Source revision and inspection question required');
      assert(Object.keys(item).every(key=>['sourceRevisionId','question','start','end'].includes(key)),'Unknown inspection fields');
      const r=this.store.file(item.sourceRevisionId);assert(/^(image|video)\//.test(r.mime),'VLM accepts images/video, not audio');
      if(r.mime.startsWith('video/'))assert(Number.isFinite(item.start)&&Number.isFinite(item.end)&&item.start>=0&&item.end>item.start,'Explicit video range required');
      else assert(item.start===undefined&&item.end===undefined,'Still images have no timestamps');
      return {id:`source-${index+1}`,sourceRevisionId:r.id,registeredSha256:r.sha256,expected:item.question,...(r.mime.startsWith('image/')?{image:r.absolute}:{video:r.absolute,start:item.start,end:item.end})};
    });
    const fingerprint=digest(JSON.stringify({items,frameCount}));
    const old=this.store.db.prepare('SELECT * FROM vapor_vlm_jobs WHERE command=?').get(args.commandId);
    if(old){assert(old.fingerprint===fingerprint,'Command reused with different review input');return this.get(old.id);}
    assert(!this.active.size,'VLM service busy');
    assert(!this.list().some(j=>j.fingerprint===fingerprint&&!['failed','interrupted','cancelled'].includes(j.state)),'Equivalent review already exists; use its job ID');
    const id='vlm-'+randomUUID(),dir=join(this.store.dir,'vlm',id);mkdirSync(dir,{recursive:true,mode:0o700});inside(this.store.root,dir);
    const job={id,fingerprint,state:'preparing',items:items.map(({image,video,...item})=>item),frameCount,created:new Date().toISOString(),review:'pending',cost:null};
    save(join(dir,'source.json'),{shots:items,frameCount});
    this.store.db.prepare('INSERT INTO vapor_vlm_jobs VALUES(?,?,?,?)').run(id,args.commandId,fingerprint,JSON.stringify(job));
    this.start(id,async()=>{const preview=await this.run('tools/gpu/vapor_bridge.py',['--source',join(dir,'source.json'),'--out',dir]);assert(Array.isArray(preview.shots)&&preview.shots.length===items.length,'Invalid preparation result');this.update(id,{state:'awaiting_approval',preview,approvalFingerprint:digest(JSON.stringify(preview))});},'failed');
    return job;
  }
  cancel({id}){const job=this.get(id);assert(job.state==='awaiting_approval'&&!this.active.has(id),'Only an unsubmitted review can be cancelled');return this.update(id,{state:'cancelled'});}
  approve(args){
    this.checkEnabled?.();
    const job=this.get(args.id);assert(job.state==='awaiting_approval','Review is not awaiting approval');assert(!this.active.size,'VLM service busy');
    assert(args.confirmed===true&&args.approvalFingerprint===job.approvalFingerprint,'Confirm the exact prepared batch');
    for(const key of ['budgetUSD','estimatedUSD','reservedUSD'])assert(Number.isFinite(args[key])&&args[key]>0,'Positive '+key+' required');
    assert(args.estimatedUSD<=args.reservedUSD&&args.reservedUSD<=args.budgetUSD,'Require estimate ≤ reservation ≤ budget');
    assert(text(args.pricingSource,1000)&&text(args.authorizationNote,2000),'Pricing source and authorization note required');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(args.priceValidThrough)&&args.priceValidThrough>=new Date().toISOString().slice(0,10),'Pricing expired or invalid');
    const ledgerPath=join(this.ledger,'ledger.json');
    if(existsSync(this.ledger))inside(this.store.root,this.ledger);
    if(existsSync(ledgerPath)){const ledger=JSON.parse(readFileSync(inside(this.store.root,ledgerPath)));assert(ledger.budgetUSD===args.budgetUSD,'Existing production budget is fixed');}
    const dir=this.directory(job.id),zip=inside(dir,join(dir,'frames.zip'));
    assert(digest(readFileSync(zip))===job.preview.inputSha256,'Prepared upload changed');
    const plan={id:job.id,input:'frames.zip',modelRevision:job.preview.modelRevision,budgetUSD:args.budgetUSD,estimatedUSD:args.estimatedUSD,reservedUSD:args.reservedUSD,pricingSource:args.pricingSource,priceValidThrough:args.priceValidThrough,userAuthorization:{note:args.authorizationNote,approvalFingerprint:job.approvalFingerprint,approvedAt:new Date().toISOString()}};
    const path=join(dir,'plan.json');
    // Persist before launching anything; a crash here never permits a second spawn.
    if(existsSync(path))throw new Error('Approval already recorded; recover the original job');
    save(path,plan);this.update(job.id,{state:'submitting',cost:{estimatedUSD:args.estimatedUSD,reservedUSD:args.reservedUSD,actualUSD:null},planSha256:digest(readFileSync(path))});
    this.start(job.id,async()=>{
      try{
        const check=await this.run('tools/gpu/vlm_jobs.py',['--plan',path,'--out',this.ledger,'--dry-run']);
        assert(check.request.inputSha256===job.preview.inputSha256&&check.request.workerRevision===job.preview.workerRevision,'Prepared worker/input changed; no submission');
      }catch(error){this.update(job.id,{state:'failed',cost:null,error:'Preflight failed; nothing submitted: '+error.message});return;}
      const result=await this.run('tools/gpu/vlm_jobs.py',['--plan',path,'--out',this.ledger,'--allow-paid']);await this.record(job.id,result);
    },'recovery_required');
    return this.get(job.id);
  }
  async record(id,result){
    if(result.state!=='downloaded'){this.update(id,{state:result.state,callId:result.call_id??null,error:null});return;}
    const file=inside(this.store.root,result.file),report=JSON.parse(readFileSync(file));const job=this.get(id);
    assert(report.fullPlaybackReviewed===false&&report.acceptance==='not_decided','Unsupported report acceptance');
    assert(report.schemaVersion===2&&Array.isArray(report.observations),'Structured observation report required');
    assert(report.request.inputSha256===job.preview.inputSha256&&report.request.modelRevision===job.preview.modelRevision&&report.request.workerRevision===job.preview.workerRevision,'Report request mismatch');
    assert(report.observations.length===job.preview.shots.length,'Report source count mismatch');
    for(const [i,o]of report.observations.entries()){const s=job.preview.shots[i];assert(o.id===s.id&&o.sourceSha256===s.sourceSha256&&JSON.stringify(o.sampledSeconds)===JSON.stringify(s.sampledSeconds),'Report source/timestamp mismatch');}
    const bound={...report,vapor:{jobId:id,sources:job.preview.shots},audioReviewed:false,continuousMotionReviewed:false};
    const path=join(this.directory(id),'report.json');
    if(!existsSync(path))save(path,bound);else assert(JSON.stringify(JSON.parse(readFileSync(path)))===JSON.stringify(bound),'Existing report differs');
    const existing=this.store.snapshot().artifacts.find(a=>a.id===id);
    const revision=this.store.register({id,title:'Qwen 素材检查',path:relative(this.store.root,path),expectedRevision:existing?.current??null});
    this.update(id,{state:'completed',reportRevisionId:revision.id,error:null,review:'pending',needsReview:report.observations.filter(o=>o.responseStatus!=='valid').map(o=>o.id)});
  }
  recover(args,action='resume'){
    const job=this.get(args.id);assert(!['preparing','awaiting_approval','failed','interrupted'].includes(job.state),'No submitted review to recover');assert(!this.active.size,'VLM service busy');
    if(existsSync(this.ledger))inside(this.store.root,this.ledger);
    const path=inside(this.store.root,join(this.directory(job.id),'plan.json'));assert(digest(readFileSync(path))===job.planSha256,'Approved plan changed');
    const command=['--plan',path,'--out',this.ledger,'--action',action];
    if(action==='reconcile'){assert(/^fc-[\w-]+$/.test(args.callId)&&text(args.evidence,2000),'Original call ID and verification evidence required');command.push('--call-id',args.callId,'--evidence',args.evidence);}
    if(action==='settle'){assert(Number.isFinite(args.actualUSD)&&args.actualUSD>=0&&text(args.evidence,2000),'Billing amount and evidence required');command.push('--actual-usd',String(args.actualUSD),'--evidence',args.evidence);}
    if(action==='mark-terminal'){assert(['failed','cancelled'].includes(args.state)&&text(args.evidence,2000),'Verified remote terminal state required');command.push('--state',args.state,'--evidence',args.evidence);}
    this.update(job.id,{state:'collecting'});
    this.start(job.id,async()=>{const result=await this.run('tools/gpu/vlm_jobs.py',command);if(action==='resume')await this.record(job.id,result);else if(action==='settle')this.update(job.id,{state:job.state,cost:{...job.cost,actualUSD:args.actualUSD},error:null});else this.update(job.id,{state:result.state,callId:args.callId??job.callId,error:null});},'recovery_required');
    return this.get(job.id);
  }
  userAction(action,args){if(action==='prepare')return this.prepare(args);if(action==='approve')return this.approve(args);if(action==='cancel')return this.cancel(args);if(['resume','reconcile','settle','mark-terminal'].includes(action))return this.recover(args,action);throw new Error('Unsupported VLM action');}
  async idle(){await Promise.all(this.active.values());}
  async close(){this.closed=true;await this.idle();}
}
