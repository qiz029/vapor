import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Runtime,Registry} from '../runtime.js';
import {createAdapter} from '../../vapor-remotion/index.js';
const request={commandId:'command1',adapterId:'test-renderer',artifactId:'clip',title:'Test clip',input:{version:1}};
function fixture(){return new Runtime(mkdtempSync(join(tmpdir(),'vapor-runtime-')));}
function adapter(execute){return {contractVersion:1,id:'test-renderer',operation:'video.render',permissions:{network:false,paid:false},validate:i=>i,execute:execute||(async({input,jobDir,report})=>{report({phase:'rendering',fraction:.5});const path=join(jobDir,'final.mp4');writeFileSync(path,JSON.stringify(input));return {path,technical:{fullDecode:'mock-only'}};})};}
test('registry rejects duplicate and paid adapters, supports unload',()=>{
  const r=new Registry(),a=adapter();const dispose=r.register(a);assert.throws(()=>r.register(a),/Duplicate/);dispose();assert.equal(r.list().length,0);
  assert.throws(()=>r.register({...a,permissions:{network:true,paid:true}}),/local unpaid/);
});
test('durable dispatch, idempotence, measured progress and revision registration',async()=>{
  const r=fixture();r.registry.register(adapter());try{
    const j=r.submit(request);assert.equal(j.state,'queued');assert.equal(r.submit(request).id,j.id);
    assert.throws(()=>r.submit({...request,title:'different'}),/reused/);
    await r.idle();const done=r.get(j.id);assert.equal(done.state,'completed');assert.equal(done.review,'pending');assert.ok(done.revisionId);
    assert.equal(r.store.snapshot().artifacts[0].revisions.length,1);
    const root=r.root;await r.close();const recovered=new Runtime(root);assert.equal(recovered.get(j.id).revisionId,done.revisionId);await recovered.close();
  }catch(e){await r.close();throw e;}
});
test('feedback-driven revision is bound to exact version and preserves old bytes',async()=>{
  const r=fixture();r.registry.register(adapter());try{
    const first=r.submit(request);await r.idle();const one=r.get(first.id).revisionId;
    const feedback=r.store.addFeedback({commandId:'feedback',sessionId:'test',artifactId:'clip',revisionId:one,locator:{type:'time',start:0,end:1},comment:'Change title'});
    assert.throws(()=>r.submit({...request,commandId:'c2',feedbackId:feedback.id}),/Revision conflict/);
    const next=r.submit({...request,commandId:'c2',input:{version:2},expectedRevision:one,feedbackId:feedback.id});await r.idle();
    assert.equal(r.get(next.id).state,'completed');assert.notEqual(r.get(next.id).revisionId,one);assert.equal(readFileSync(r.store.file(one).absolute,'utf8'),'{"version":1}');
  }finally{await r.close();}
});
test('cancel, busy limit and restart interruption do not rerender automatically',async()=>{
  const r=fixture();r.registry.register(adapter(({signal})=>new Promise((resolve,reject)=>{if(signal.aborted)reject(new Error('abort'));else signal.addEventListener('abort',()=>reject(new Error('abort')),{once:true});})));
  const j=r.submit(request);assert.throws(()=>r.submit({...request,commandId:'other'}),/busy/);r.cancel(j.id);await r.idle();assert.equal(r.get(j.id).state,'cancelled');
  r.update(j.id,{state:'running'});const root=r.root;await r.close();const next=new Runtime(root);assert.equal(next.get(j.id).state,'interrupted');assert.equal(next.active.size,0);await next.close();
});
test('result path escape fails without registering artifact',async()=>{
  const r=fixture(),outside=join(mkdtempSync(join(tmpdir(),'vapor-outside-')),'final.mp4');writeFileSync(outside,'test');
  r.registry.register(adapter(async()=>({path:outside})));r.submit(request);await r.idle();assert.equal(r.jobs()[0].state,'failed');assert.equal(r.store.snapshot().artifacts.length,0);await r.close();
});
test('Remotion input is bounded and refuses asset paths and arbitrary entrypoints',()=>{
  const a=createAdapter('/unused'),input={heading:'Vapor',body:'Local',duration:3,accent:'#c7f77b'};assert.deepEqual(a.validate(input),input);
  for(const bad of [{...input,duration:11},{...input,audio:'/private/file'},{...input,entryPoint:'evil.tsx'},{...input,accent:'url(https://example.com)'}])assert.throws(()=>a.validate(bad));
});
