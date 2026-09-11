import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runtime} from '../runtime.js';
import {packs} from '../../distribution/catalog.mjs';
const repo=new URL('../../../../',import.meta.url).pathname;
async function fixture(t){const root=mkdtempSync(join(tmpdir(),'vapor-tool-test-'));const runtime=new Runtime(root);t.after(async()=>{await runtime.close();rmSync(root,{recursive:true,force:true});});for(const [name,ops]of Object.entries(packs))runtime.toolkit.registerPack(name,repo,ops);return {root,runtime,k:runtime.toolkit};}
test('tool inventory covers feature operations and rejects shell/unknown inputs',async t=>{
 const {k,root}=await fixture(t);writeFileSync(join(root,'tone.wav'),'fixture');writeFileSync(join(root,'plan.json'),JSON.stringify({clips:[{source:'tone.wav'}]}));
 assert.ok(k.list().some(o=>o.id==='voice.speak'));assert.ok(k.list().some(o=>o.id==='video.finalize'));
 assert.throws(()=>k.prepare({commandId:'x',operation:'audio.assemble',input:{manifest:'plan.json',shell:'echo unsafe'}}),/Unknown input/);
 const j=k.prepare({commandId:'good',operation:'audio.assemble',input:{manifest:'plan.json'}});assert.equal(j.state,'prepared');assert.equal(Object.keys(j.inputs).length,2);
 assert.equal(k.prepare({commandId:'good',operation:'audio.assemble',input:{manifest:'plan.json'}}).id,j.id);
 assert.throws(()=>k.prepare({commandId:'good',operation:'audio.check',input:{audio:'tone.wav'}}),/Command ID/);
 writeFileSync(join(root,'tone.wav'),'changed');assert.throws(()=>k.run({id:j.id}),/Input changed/);
});
test('Agent authors new manifests without overwriting inputs or writing executable files',async t=>{
 const {k,root}=await fixture(t);const args={commandId:'doc',name:'edit.json',content:'{"schemaVersion":1}'};
 const first=k.writeDocument(args);assert.equal(first.path,'inputs/edit.json');assert.equal(k.writeDocument(args).revisionId,first.revisionId);
 assert.throws(()=>k.writeDocument({...args,content:'{}'}),/reused/);assert.throws(()=>k.writeDocument({...args,commandId:'new',content:'{}'}),/exists/);
 assert.throws(()=>k.writeDocument({...args,name:'../escape.json'}),/filename/);assert.throws(()=>k.writeDocument({...args,name:'run.py'}),/filename/);assert.throws(()=>k.writeDocument({...args,name:'broken.json',content:'invalid'}),SyntaxError);
});
test('nested media and symlink escapes rejected before execution',async t=>{
 const {k,root}=await fixture(t);writeFileSync(join(root,'bad.json'),JSON.stringify({clips:[{source:'/etc/passwd'}]}));
 assert.throws(()=>k.prepare({commandId:'bad',operation:'audio.assemble',input:{manifest:'bad.json'}}),/outside/);
 symlinkSync('/etc/passwd',join(root,'linked.txt'));assert.throws(()=>k.prepare({commandId:'link',operation:'audio.check',input:{audio:'linked.txt'}}),/outside/);
 writeFileSync(join(root,'.env'),'DO_NOT_READ');assert.throws(()=>k.prepare({commandId:'secret',operation:'audio.check',input:{audio:'.env'}}),/nonsecret/);
});
test('project provenance is text while asset paths remain hashed dependencies',async t=>{
 const {k,root}=await fixture(t);writeFileSync(join(root,'tone.wav'),'fixture');writeFileSync(join(root,'project.json'),JSON.stringify({assets:[{path:'tone.wav',producer:'media-assets',sha256:'fixture',source:'Sentence audio supplied to mix manifest: /private/project/mix.json'}]}));
 const j=k.prepare({commandId:'provenance',operation:'project.validate',input:{project:'project.json'}});assert.deepEqual(Object.keys(j.inputs).sort(),['project.json','tone.wav']);
});
test('registered historical manifests are hashed without rebasing their old source paths',async t=>{
 const {k,root}=await fixture(t);mkdirSync(join(root,'registered'));writeFileSync(join(root,'registered/history.json'),JSON.stringify({clips:[{source:'original-location.wav'}]}));writeFileSync(join(root,'project.json'),JSON.stringify({project:{id:'example'},assets:[{path:'registered/history.json',producer:'media-assets',sha256:'fixture',source:'original plan'}]}));
 const j=k.prepare({commandId:'history',operation:'project.validate',input:{project:'project.json'}});assert.deepEqual(Object.keys(j.inputs).sort(),['project.json','registered/history.json']);
});
test('remote and acceptance jobs cannot execute through Agent run; approval binds sources',async t=>{
 const {k,root}=await fixture(t);writeFileSync(join(root,'audio.wav'),'fixture');
 const j=k.prepare({commandId:'review',operation:'gemini.music-review',input:{audio:'audio.wav'}});
 assert.equal(j.state,'awaiting_approval');assert.throws(()=>k.run({id:j.id}),/approval/);
 assert.throws(()=>k.prepare({commandId:'alias',operation:j.operation,input:j.input}),/Equivalent/);
 assert.throws(()=>k.approve({id:j.id,fingerprint:j.fingerprint,confirmed:false}),/exact/);
 writeFileSync(join(root,'audio.wav'),'changed');assert.throws(()=>k.approve({id:j.id,fingerprint:j.fingerprint,confirmed:true,authorizationNote:'test'}),/Input changed/);
 const names=[];k.registerTools({register(d){names.push(d.name);return()=>{};}})();assert.ok(!names.some(n=>/approve|recover|settle/.test(n)));
});
test('real local driver writes immutable registered report and persists completed job',async t=>{
 const {k,root,runtime}=await fixture(t);writeFileSync(join(root,'cost.json'),JSON.stringify({schemaVersion:1,project:'test',currency:'USD',coverage:'partial',entries:[]}));
 k.packs.get('vapor-costs').config.python=process.env.VAPOR_TOOLS_PYTHON||'python3';
 const j=k.prepare({commandId:'cost',operation:'costs.report',input:{manifest:'cost.json'}});k.run({id:j.id});await k.active.promise;
 const done=k.get(j.id);assert.equal(done.state,'completed',done.error);assert.ok(done.outputs.length>=3);assert.equal(done.cloudSubmitted,false);assert.equal(runtime.store.snapshot().artifacts.length,done.outputs.length);
 const count=runtime.store.snapshot().artifacts.length;k.save({...done,state:'interrupted',outputs:[]});rmSync(join(root,'cost.json'));
 k.runner=async()=>{throw new Error('Collection must not rerun the command');};k.resume({id:j.id});await k.active?.promise;
 assert.equal(k.get(j.id).state,'completed');assert.equal(runtime.store.snapshot().artifacts.length,count);
});
test('remote runner uncertainty is durable and same request cannot be reposted',async t=>{
 const {k,root}=await fixture(t);writeFileSync(join(root,'audio.wav'),'fixture');let calls=0;k.runner=async()=>{calls++;throw new Error('unknown');};
 const j=k.prepare({commandId:'review',operation:'gemini.music-review',input:{audio:'audio.wav'}});
 k.approve({id:j.id,fingerprint:j.fingerprint,confirmed:true,authorizationNote:'synthetic test only',budgetUSD:1,estimatedUSD:.1,reservedUSD:.2,pricingSource:'test fixture',priceValidThrough:'2099-01-01'});await k.active.promise;
 assert.equal(k.get(j.id).state,'recovery_required');assert.equal(calls,1);assert.throws(()=>k.approve({id:j.id}),/awaiting/);assert.throws(()=>k.resume({id:j.id}),/original/);
});
test('proven preflight failure can be corrected without pretending a cloud job exists',async t=>{
 const {k,root}=await fixture(t);writeFileSync(join(root,'plan.json'),JSON.stringify({id:'music-fixture',budgetUSD:1,estimatedUSD:.1,reservedUSD:.4}));
 const j=k.prepare({commandId:'preflight',operation:'music.generate',input:{plan:'plan.json'}});
 k.approve({id:j.id,fingerprint:j.fingerprint,confirmed:true,authorizationNote:'Synthetic preflight fixture',budgetUSD:1,estimatedUSD:.1,reservedUSD:.2,pricingSource:'fixture',priceValidThrough:'2099-01-01'});await k.active.promise;
 assert.equal(k.get(j.id).state,'failed');assert.equal(k.get(j.id).cloudSubmitted,false);
 assert.equal(k.prepare({commandId:'corrected',operation:'music.generate',input:{plan:'plan.json'}}).state,'awaiting_approval');
});
test('plugin switches persist per project and gate prepared jobs and discovery',async t=>{
 const root=mkdtempSync(join(tmpdir(),'vapor-toggle-'));let runtime=new Runtime(root);t.after(async()=>{await runtime.close();rmSync(root,{recursive:true,force:true});});const k=runtime.toolkit;k.registerPack('vapor-music',repo,packs['vapor-music']);
 const j=k.prepare({commandId:'toggle-test',operation:'music.options',input:{}});
 k.setEnabled({name:'vapor-music',enabled:false});
 assert.ok(!k.list().some(o=>o.id==='music.options'));
 assert.equal(k.plugins().find(p=>p.name==='vapor-music').enabled,false);
 assert.throws(()=>k.prepare({commandId:'blocked',operation:'music.options',input:{}}),/停用/);
 assert.throws(()=>k.run({id:j.id}),/停用/);
 assert.equal(k.get(j.id).state,'prepared');
 assert.throws(()=>k.setEnabled({name:'unknown',enabled:false}),/Unknown/);
 assert.throws(()=>k.setEnabled({name:'vapor-music',enabled:'false'}),/boolean/);
 await runtime.close();const reopened=new Runtime(root);runtime=reopened;
 reopened.toolkit.registerPack('vapor-music',repo,packs['vapor-music']);
 assert.equal(reopened.toolkit.enabled('vapor-music'),false);
 reopened.toolkit.setEnabled({name:'vapor-music',enabled:true});assert.ok(reopened.toolkit.list().some(o=>o.id==='music.options'));
});
test('user can cancel an unsubmitted remote preparation but not erase submitted uncertainty',async t=>{
 const {k}=await fixture(t);const job=k.prepare({commandId:'cancel-pending',operation:'motion.credits',input:{}});assert.equal(job.state,'awaiting_approval');assert.equal(k.cancel({id:job.id}).state,'cancelled');assert.equal(k.get(job.id).cloudSubmitted,false);
 const next=k.prepare({commandId:'new-after-cancel',operation:'motion.credits',input:{}});k.save({...next,state:'recovery_required',cloudSubmitted:true});assert.throws(()=>k.cancel({id:next.id}),/Cancel remotely/);assert.equal(k.get(next.id).state,'recovery_required');
});
