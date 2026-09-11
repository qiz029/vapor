import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Runtime} from '../runtime.js';
import {VlmService} from '../../vapor-vlm-modal/service.js';
import {apply as toolsApply} from '../../vapor-vlm-modal/tools.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'vapor-vlm-test-')),runtime=new Runtime(root);
 writeFileSync(join(root,'image.png'),'image fixture');const source=runtime.store.register({id:'image',title:'Image',path:'image.png'});
 const calls=[];let spec,preview,mode='submitted';
 const service=new VlmService(runtime.store,{run:async(script,args)=>{
  calls.push({script,args});
  if(script.endsWith('vapor_bridge.py')){
   const dir=args[args.indexOf('--out')+1],document=JSON.parse(readFileSync(args[1]));writeFileSync(join(dir,'frames.zip'),'zip');
   preview={inputSha256:hash('zip'),workerRevision:'a'.repeat(64),modelRevision:'b'.repeat(40),model:'Qwen/Qwen3-VL-8B-Instruct',uploadBytes:3,shots:document.shots.map(s=>({id:s.id,sourceRevisionId:s.sourceRevisionId,sourceSha256:s.registeredSha256,kind:'image',sampledSeconds:[],question:s.expected,range:null}))};return preview;
  }
  spec={inputSha256:preview.inputSha256,workerRevision:preview.workerRevision,modelRevision:preview.modelRevision};
  if(args.includes('--dry-run'))return {request:spec};
  if(mode==='unknown')throw new Error('Lost submission receipt');
  if(mode==='downloaded'){
   const plan=JSON.parse(readFileSync(args[1])),dir=join(root,'generation');mkdirSync(dir,{recursive:true});
   const file=join(dir,plan.id+'.observations.json');writeFileSync(file,JSON.stringify({schemaVersion:2,request:spec,fullPlaybackReviewed:false,acceptance:'not_decided',observations:preview.shots.map(s=>({id:s.id,sourceSha256:s.sourceSha256,sampledSeconds:[],rawResponse:'unparsed',parsedResponse:null,responseStatus:'needs_review',validationError:'invalid_json'}))}));return {state:'downloaded',file};
  }
  return {state:'submitted',call_id:'fc-test'};
 }});
 return {runtime,service,source,calls,setMode:value=>mode=value};
}
const request=source=>({commandId:'first',items:[{sourceRevisionId:source.id,question:'Describe visible objects'}]});
const approval=job=>({id:job.id,confirmed:true,approvalFingerprint:job.approvalFingerprint,budgetUSD:2,estimatedUSD:.1,reservedUSD:1,pricingSource:'fixture',priceValidThrough:'2099-01-01',authorizationNote:'test only'});

test('preparation is unpaid, idempotent, version-bound and rejects duplicate aliases',async()=>{
 const f=fixture();try{
  const j=f.service.prepare(request(f.source));assert.equal(f.service.prepare(request(f.source)).id,j.id);await f.service.idle();
  const ready=f.service.get(j.id);assert.equal(ready.state,'awaiting_approval');assert.equal(f.calls.length,1);
  assert.equal(ready.preview.shots[0].sourceSha256,f.source.sha256);
  assert.throws(()=>f.service.prepare({...request(f.source),commandId:'alias'}),/Equivalent/);
  assert.throws(()=>f.service.prepare({...request(f.source),items:[{sourceRevisionId:f.source.id,question:'Changed'}]}),/reused/);
  assert.throws(()=>f.service.approve({...approval(ready),confirmed:false}),/Confirm/);
  assert.throws(()=>f.service.approve({...approval(ready),approvalFingerprint:'wrong'}),/Confirm/);
  assert.equal(f.calls.length,1);
 }finally{await f.service.close();await f.runtime.close();}
});
test('unknown submissions never restart under same or different command; recovery only collects',async()=>{
 const f=fixture();try{
  const j=f.service.prepare(request(f.source));await f.service.idle();f.setMode('unknown');f.service.approve(approval(f.service.get(j.id)));await f.service.idle();
  assert.equal(f.service.get(j.id).state,'recovery_required');assert.throws(()=>f.service.approve(approval(f.service.get(j.id))),/awaiting/);
  assert.throws(()=>f.service.prepare({...request(f.source),commandId:'different'}),/Equivalent/);
  f.setMode('downloaded');f.service.recover({id:j.id});await f.service.idle();
  const done=f.service.get(j.id);assert.equal(done.state,'completed');assert.equal(done.report.vapor.sources[0].sourceRevisionId,f.source.id);assert.equal(done.report.acceptance,'not_decided');assert.deepEqual(done.needsReview,['source-1']);
  assert.equal(f.calls.filter(c=>c.args.includes('--allow-paid')).length,1);
  f.service.recover({id:j.id});await f.service.idle();assert.equal(f.runtime.store.snapshot().artifacts.find(a=>a.id===j.id).revisions.length,1);
 }finally{await f.service.close();await f.runtime.close();}
});
test('existing production budget and tampered upload cannot be bypassed',async()=>{
 const f=fixture();try{
  const j=f.service.prepare(request(f.source));await f.service.idle();const a=approval(f.service.get(j.id));
  mkdirSync(join(f.runtime.root,'generation'));writeFileSync(join(f.runtime.root,'generation/ledger.json'),JSON.stringify({budgetUSD:1,jobs:{}}));
  assert.throws(()=>f.service.approve(a),/fixed/);
  writeFileSync(join(f.service.directory(j.id),'frames.zip'),'changed');assert.throws(()=>f.service.approve({...a,budgetUSD:1}),/changed/);
 }finally{await f.service.close();await f.runtime.close();}
});
test('Agent registration exposes no spending, reconciliation or settlement tool',()=>{
 const names=[];toolsApply({vaporRuntime:{},effect:fn=>fn(),tools:{register:d=>{names.push(d.name);return()=>{};}}});
 assert.deepEqual(names,['media_vlm_list','media_vlm_prepare','media_vlm_get','media_vlm_resume']);
});

test('restart preserves remote recovery and never creates another cloud request',async()=>{
 const f=fixture();let second;
 try{
  const j=f.service.prepare(request(f.source));await f.service.idle();f.service.approve(approval(f.service.get(j.id)));await f.service.idle();
  f.service.update(j.id,{state:'submitting'});await f.service.close();
  second=new VlmService(f.runtime.store,{run:async()=>{throw new Error('No calls during recovery construction');}});
  assert.equal(second.get(j.id).state,'recovery_required');assert.equal(second.active.size,0);assert.equal(f.calls.filter(c=>c.args.includes('--allow-paid')).length,1);
 }finally{await second?.close();await f.service.close();await f.runtime.close();}
});

test('installed VLM activation blocks preparation and approval without provider calls',async()=>{
 const {apply}=await import('../../vapor-vlm-modal/index.js');const runtime=new Runtime(mkdtempSync(join(tmpdir(),'vapor-vlm-toggle-')));let dispose;
 try{apply({vaporRuntime:runtime,effect:fn=>{dispose=fn();}});runtime.toolkit.setEnabled({name:'vapor-vlm-modal',enabled:false});const service=runtime.services.get('vlm');assert.equal(service.snapshot().enabled,false);assert.throws(()=>service.prepare({}),/停用/);assert.throws(()=>service.approve({}),/停用/);runtime.toolkit.setEnabled({name:'vapor-vlm-modal',enabled:true});assert.equal(service.snapshot().enabled,true);}finally{await dispose?.();await runtime.close();}
});
test('declining a prepared review never submits and cannot cancel submitted recovery',async()=>{
 const f=fixture();try{const j=f.service.prepare(request(f.source));await f.service.idle();assert.equal(f.service.userAction('cancel',{id:j.id}).state,'cancelled');assert.equal(f.calls.length,1);assert.throws(()=>f.service.approve(approval(f.service.get(j.id))),/not awaiting/);
 const next=f.service.prepare({...request(f.source),commandId:'after-cancel'});await f.service.idle();f.service.update(next.id,{state:'recovery_required'});assert.throws(()=>f.service.cancel({id:next.id}),/unsubmitted/);assert.equal(f.service.get(next.id).state,'recovery_required');
 }finally{await f.service.close();await f.runtime.close();}
});
