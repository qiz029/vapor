/** Vapor capability contract v1 and single-owner durable local job runtime. */
import {randomUUID,createHash} from 'node:crypto';
import {join,relative,extname} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync,unlinkSync,existsSync} from 'node:fs';
import {Store,assert,within,MIME} from './store.js';
import {Lab} from './lab.js';
import {Toolkit} from './toolkit.js';

export const operations=['video.render','image.generate','image.edit','motion.search','motion.download','lab.image.describe','lab.video.describe','lab.motion.extract','lab.voice.profile','lab.voice.prepare'];

export class Registry {
  adapters=new Map();
  register(adapter){
    assert(adapter.contractVersion===1,'Unsupported adapter contract');
    assert(/^[a-z][a-z0-9-]+$/.test(adapter.id)&&operations.includes(adapter.operation),'Unsupported adapter identity/operation');
    assert(adapter.permissions?.network===false&&adapter.permissions?.paid===false,'Only local unpaid adapters supported in v1');
    assert(typeof adapter.validate==='function'&&typeof adapter.execute==='function','Invalid adapter methods');
    assert(!this.adapters.has(adapter.id),'Duplicate adapter');this.adapters.set(adapter.id,adapter);
    return()=>{if(this.adapters.get(adapter.id)===adapter)this.adapters.delete(adapter.id);};
  }
  list(){return [...this.adapters.values()].filter(a=>this.enabled?.(a.id)!==false).map(({id,operation,contractVersion,inputSchema,permissions,progress})=>({id,operation,contractVersion,inputSchema,permissions,progress}));}
  get(id){const a=this.adapters.get(id);assert(a,'Adapter unavailable');return a;}
}
const terminal=new Set(['completed','failed','interrupted','cancelled']);
export class Runtime {
  services=new Map();
  registerService(id,service){assert(!this.services.has(id),'Duplicate service');this.services.set(id,service);return async()=>{await service.close?.();this.services.delete(id);};}
  registry=new Registry();active=new Map();closed=false;
  constructor(projectRoot){
    this.store=new Store(projectRoot);this.lab=new Lab(this.store);this.root=this.store.root;this.lock=join(this.store.dir,'runtime.lock');
    if(existsSync(this.lock)){
      const previous=JSON.parse(readFileSync(within(this.root,this.lock),'utf8'));let dead=false;
      try{process.kill(previous.pid,0);}catch(e){if(e.code==='ESRCH')dead=true;}
      assert(dead,'Another runtime owns this project; do not delete a live lock');unlinkSync(this.lock);
    }
    writeFileSync(this.lock,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600,flush:true});
    this.store.db.exec('CREATE TABLE IF NOT EXISTS vapor_jobs(id TEXT PRIMARY KEY,command TEXT UNIQUE NOT NULL,fingerprint TEXT NOT NULL,payload TEXT NOT NULL)');
    for(const j of this.jobs())if(!terminal.has(j.state))this.update(j.id,{state:'interrupted',phase:'recovery-required',progress:null,error:'Previous runtime stopped. Inspect retained output; no automatic rerender.'});
    this.toolkit=new Toolkit(this);this.registry.enabled=name=>this.toolkit.enabled(name);this.services.set('toolkit',this.toolkit);
  }
  jobs(){return this.store.db.prepare('SELECT payload FROM vapor_jobs ORDER BY rowid DESC').all().map(r=>JSON.parse(r.payload));}
  get(id){const r=this.store.db.prepare('SELECT payload FROM vapor_jobs WHERE id=?').get(id);assert(r,'Unknown job');return JSON.parse(r.payload);}
  update(id,patch){const value={...this.get(id),...patch,updated:new Date().toISOString()};this.store.transaction(()=>{this.store.db.prepare('UPDATE vapor_jobs SET payload=? WHERE id=?').run(JSON.stringify(value),id);this.store.event('job.updated',{id,state:value.state,phase:value.phase,progress:value.progress});});return value;}
  submit(args){
    assert(!this.closed,'Runtime closing');
    assert(!this.toolkit.active,'Tool job running; wait for it to finish');
    assert(typeof args.commandId==='string'&&/^[\w-]{1,100}$/.test(args.commandId),'Invalid command id');
    assert(typeof args.artifactId==='string'&&/^[\w-]{1,100}$/.test(args.artifactId)&&typeof args.title==='string'&&args.title.trim()&&args.title.length<=100,'Invalid artifact metadata');
    const adapter=this.registry.get(args.adapterId);this.toolkit.requireEnabled(adapter.id);const input=adapter.validate(args.input);
    const request={adapterId:adapter.id,artifactId:args.artifactId,title:args.title,input,expectedRevision:args.expectedRevision??null,feedbackId:args.feedbackId??null};
    const references=this.lab.references(args.labReferenceIds);
    if(references.length)request.labReferences=references;
    const fingerprint=createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const old=this.store.db.prepare('SELECT * FROM vapor_jobs WHERE command=?').get(args.commandId);
    if(old){assert(old.fingerprint===fingerprint,'Command reused with different inputs');return JSON.parse(old.payload);}
    assert(this.active.size===0,'Local renderer busy; wait for the current job');
    const artifact=this.store.snapshot().artifacts.find(a=>a.id===request.artifactId);
    assert((artifact?.current??null)===request.expectedRevision,'Revision conflict; provide the current expectedRevision');
    if(request.feedbackId){const f=this.store.snapshot().feedback.find(f=>f.id===request.feedbackId);assert(f&&f.artifactId===request.artifactId&&f.revisionId===request.expectedRevision,'Feedback must match target revision');}
    const id=randomUUID(),dir=join(this.store.dir,'jobs',id);mkdirSync(dir,{recursive:true,mode:0o700});within(this.root,dir);
    const job={id,...request,state:'queued',phase:'queued',progress:null,progressSource:'unknown',revisionId:null,created:new Date().toISOString(),cost:{kind:'local-compute',providerChargeUSD:0},review:'pending'};
    this.store.transaction(()=>{this.store.db.prepare('INSERT INTO vapor_jobs VALUES(?,?,?,?)').run(id,args.commandId,fingerprint,JSON.stringify(job));this.store.event('job.created',{id,artifactId:request.artifactId});});
    const controller=new AbortController();const active={controller,promise:null};this.active.set(id,active);
    active.promise=Promise.resolve().then(async()=>{
      try{
        this.update(id,{state:'running',phase:'starting'});
        const output=await adapter.execute({input,labReferences:references,jobDir:dir,signal:controller.signal,report:({phase,fraction})=>{
          assert(typeof phase==='string'&&phase.length<=80,'Invalid phase');assert(fraction===null||(Number.isFinite(fraction)&&fraction>=0&&fraction<=1),'Invalid progress');
          this.update(id,{phase,progress:fraction,progressSource:fraction===null?'unknown':'adapter-measured'});
        }});
        if(controller.signal.aborted)throw new Error('Aborted');
        const path=within(dir,output.path);assert(MIME[extname(path).toLowerCase()],'Unsupported result format');
        if(adapter.operation==='video.render')assert(path.endsWith('.mp4'),'Expected MP4 result');
        const revision=this.store.register({id:request.artifactId,title:request.title,path:relative(this.root,path),expectedRevision:request.expectedRevision});
        const assets=[];
        assert(!output.assets||(Array.isArray(output.assets)&&output.assets.length<=8),'Invalid output assets');
        for(const [index,a]of (output.assets||[]).entries()){
          const assetPath=within(dir,a.path);
          const r=this.store.register({id:`job-${id}-${index}`,title:a.title,path:relative(this.root,assetPath),expectedRevision:null});
          assets.push({name:a.name,revisionId:r.id});
        }
        this.update(id,{state:'completed',phase:'complete',progress:1,progressSource:'completed',revisionId:revision.id,assets,technical:output.technical,review:'pending'});
      }catch(e){this.update(id,{state:controller.signal.aborted?(this.closed?'interrupted':'cancelled'):'failed',phase:'stopped',progress:null,error:String(e.message).slice(0,1500)});}
      finally{this.active.delete(id);}
    });
    return job;
  }
  cancel(id){const j=this.get(id);if(terminal.has(j.state))return j;this.active.get(id)?.controller.abort();return this.update(id,{phase:'cancelling'});}
  saveVoiceProfile({jobId,transcript,authorizationNote,listened}){
    const j=this.get(jobId);
    assert(j.adapterId==='vapor-voice-local'&&j.state==='completed','Completed voice preparation required');
    assert(listened===true,'Listen to reference and available stems before confirming');
    assert(typeof transcript==='string'&&transcript.trim()&&transcript.length<=8000,'Exact transcript required');
    assert(typeof authorizationNote==='string'&&authorizationNote.trim()&&authorizationNote.length<=1000,'Voice usage authorization note required');
    const r=this.store.revision(j.revisionId);
    const profile={schemaVersion:1,kind:'vapor.voice-reference',provider:'mlx-audio',model:'Qwen3-TTS-12Hz-1.7B-Base-8bit',language:'Chinese',sourceRevisionId:j.input.sourceRevisionId,sourceSha256:j.technical.sourceSha256,referenceRevisionId:r.id,referenceSha256:r.sha256,referencePath:r.path,transcript:transcript.trim(),authorizationNote:authorizationNote.trim(),preparationJobId:j.id,start:j.input.start,duration:j.technical.signal.duration_seconds,separation:j.input.separation,referenceReview:'user-confirmed',synthesisReview:'not-generated'};
    const path=join(this.store.dir,'jobs',j.id,'voice-profile.json'),content=JSON.stringify(profile,null,2);
    if(existsSync(path))assert(readFileSync(within(this.root,path),'utf8')===content,'Profile already saved with different content; prepare a new version');
    else writeFileSync(path,content,{flag:'wx',mode:0o600,flush:true});
    const id=`voice-profile-${j.id}`,old=this.store.snapshot().artifacts.find(a=>a.id===id);
    const revision=this.store.register({id,title:`声音 Profile · ${j.title}`,path:relative(this.root,path),expectedRevision:old?.current??null});
    this.update(j.id,{profileRevisionId:revision.id,review:'reference-user-confirmed'});return revision;
  }
  async idle(){await Promise.all([...this.active.values()].map(a=>a.promise));}
  async close(){this.closed=true;for(const service of this.services.values())await service.close?.();this.services.clear();for(const a of this.active.values())a.controller.abort();await this.idle();this.store.close();unlinkSync(this.lock);}
}
