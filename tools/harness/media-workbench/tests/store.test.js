import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,validateLocator,feedbackMessage} from '../store.js';
import {rangeFor,createHandler} from '../http.js';
import {createServer} from 'node:http';
function fixture(){const root=mkdtempSync(join(tmpdir(),'media-wb-test-'));writeFileSync(join(root,'a.md'),'version one');return {root,store:new Store(root)};}
test('immutable revisions and duplicate import survive reopen',()=>{
  const {root,store}=fixture();const one=store.register({id:'a',title:'A',path:'a.md'});
  assert.equal(store.register({id:'a',title:'A',path:'a.md'}).id,one.id);
  writeFileSync(join(root,'a.md'),'version two');const two=store.register({id:'a',title:'A',path:'a.md',expectedRevision:one.id});
  assert.equal(two.ordinal,2);assert.equal(readFileSync(store.file(one.id).absolute,'utf8'),'version one');store.close();
  const reopened=new Store(root);assert.equal(reopened.snapshot().artifacts[0].revisions.length,2);reopened.close();
});
test('stale writer rejected; independent stores preserve both additions',()=>{
  const {root,store}=fixture(),second=new Store(root);
  const one=store.register({id:'a',title:'A',path:'a.md'});
  second.register({id:'b',title:'B',path:'a.md'});
  assert.throws(()=>store.register({id:'a',title:'A',path:'a.md',expectedRevision:'stale'}),/conflict/);
  assert.equal(store.snapshot().artifacts.length,2);assert.equal(store.revision(one.id).artifact,'a');second.close();store.close();
});
test('feedback exact version, idempotent command and conflict',()=>{
  const {store}=fixture(),r=store.register({id:'a',title:'A',path:'a.md'});
  const args={commandId:'c1',sessionId:'s1',artifactId:'a',revisionId:r.id,locator:{type:'whole'},comment:'修改结尾'};
  const first=store.addFeedback(args);assert.equal(store.addFeedback(args).id,first.id);
  assert.throws(()=>store.addFeedback({...args,comment:'不同意见'}),/reused/);
  assert.throws(()=>store.addFeedback({...args,artifactId:'b'}),/mismatch/);
  assert.match(feedbackMessage(first),new RegExp(r.id));assert.equal(store.snapshot().feedback.length,1);store.close();
});
test('path escape and symlink escape rejected',()=>{
  const {root,store}=fixture(),outside=mkdtempSync(join(tmpdir(),'media-outside-'));
  writeFileSync(join(outside,'secret.md'),'private');symlinkSync(join(outside,'secret.md'),join(root,'link.md'));
  assert.throws(()=>store.register({id:'x',title:'X',path:'link.md'}),/outside/);
  assert.throws(()=>store.register({id:'../x',title:'X',path:'a.md'}),/Invalid/);
  writeFileSync(join(root,'.env'),'secret');assert.throws(()=>store.register({id:'env',title:'X',path:'.env'}),/Unsupported/);store.close();
});
test('strict feedback locator validation',()=>{
  for(const l of [{type:'time',start:-1,end:2},{type:'time',start:3,end:1},{type:'region',x:0.9,y:0,width:0.2,height:1},{type:'quote',text:''},{type:'unsupported'}])assert.throws(()=>validateLocator(l));
  validateLocator({type:'time',start:2,end:2});validateLocator({type:'region',x:0,y:0,width:1,height:1});
});
test('range support and invalid range',()=>{
  assert.deepEqual(rangeFor('bytes=2-4',10),{start:2,end:4});assert.deepEqual(rangeFor('bytes=-3',10),{start:7,end:9});assert.deepEqual(rangeFor('bytes=8-',10),{start:8,end:9});
  for(const h of ['bytes=20-','bytes=3-2','bytes=0-1,3-4','bytes=-0'])assert.throws(()=>rangeFor(h,10));
});
test('ledger projection neither mutates nor invents progress/refund',()=>{
  const {root,store}=fixture();mkdirSync(join(root,'generation'));const path=join(root,'generation','ledger.json');const data=JSON.stringify({budgetUSD:15,jobs:{x:{state:'submission_unknown',reservedUSD:10,actualUSD:null}}});writeFileSync(path,data);
  assert.equal(store.jobs().jobs[0].progress,null);assert.equal(store.jobs().budget.reserved,10);assert.equal(readFileSync(path,'utf8'),data);store.close();
});
test('HTTP authentication, origins, partial media and feedback persistence',async t=>{
  const {root,store}=fixture(),rev=store.register({id:'a',title:'A',path:'a.md'});store.close();
  const app=createHandler(root),server=createServer(app.handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();app.close();});
  const base=`http://127.0.0.1:${server.address().port}/media-workbench`;
  const html=await (await fetch(base+'/')).text(),token=html.match(/name="media-token" content="([^"]+)"/)[1];
  assert.equal((await fetch(base+'/snapshot')).status,403);
  assert.equal((await fetch(base+'/snapshot',{headers:{'x-media-token':token,Origin:'https://evil.example'}})).status,403);
  const partial=await fetch(base+'/file/'+rev.id+'?token='+token,{headers:{Range:'bytes=0-6'}});assert.equal(partial.status,206);assert.equal(await partial.text(),'version');
  const response=await fetch(base+'/feedback',{method:'POST',headers:{'x-media-token':token,'Content-Type':'application/json'},body:JSON.stringify({commandId:'http1',sessionId:'s1',artifactId:'a',revisionId:rev.id,locator:{type:'whole'},comment:'局部修改'})});assert.equal(response.status,200);
  assert.equal(app.store.snapshot().feedback.length,1);
});
