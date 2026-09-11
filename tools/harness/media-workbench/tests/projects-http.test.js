import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {apply} from '../host.js';
test('project HTTP upload/auth/origin and project-specific snapshots',async t=>{const dir=mkdtempSync(join(tmpdir(),'vapor-project-http-')),root=join(dir,'root');mkdirSync(root);let handler,dispose;
 apply({sessionQuery:{listSessions:async()=>[]},provide:()=>{},on:()=>()=>{},effect:fn=>{dispose=fn();},webServer:{host:'127.0.0.1',register:r=>{handler=r.handler;return()=>{};}}},{projectRoot:root,catalogRoot:join(dir,'catalog')});
 const server=createServer((req,res)=>handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await dispose();rmSync(dir,{recursive:true,force:true});});const base=`http://127.0.0.1:${server.address().port}/media-workbench`,html=await(await fetch(base+'/')).text(),token=html.match(/name="media-token" content="([^"]+)"/)[1],headers={'x-media-token':token,'content-type':'application/json'};
 assert.equal((await fetch(base+'/projects')).status,403);assert.equal((await fetch(base+'/projects',{headers:{...headers,origin:'https://example.com'}})).status,400);
 for(const path of ['/credentials','/credentials/test','/hub/search','/hub/plan','/hub/install','/hub/status','/hub/rollback','/hub/cancel','/projects/create']){const response=await fetch(base+path,{method:'POST',headers:{'x-media-token':'expired-token','content-type':'application/json'},body:'{}'});assert.equal(response.status,403,path);assert.deepEqual(await response.json(),{error:'Invalid access token'},path);}
 const catalog=await(await fetch(base+'/projects',{headers})).json(),a=catalog.defaultId,b=await(await fetch(base+'/projects/create',{method:'POST',headers,body:JSON.stringify({title:'B'})})).json();
 const upload=await fetch(base+'/projects/upload?id='+a+'&name='+encodeURIComponent('剧本.md'),{method:'POST',headers:{'x-media-token':token},body:'第一幕'});assert.equal(upload.status,200);const record=await upload.json();
 const snap=async id=>(await fetch(base+'/snapshot?projectId='+id,{headers})).json();assert.equal((await snap(a)).artifacts.length,1);assert.equal((await snap(b.id)).artifacts.length,0);assert.equal((await fetch(base+'/file/'+record.revision.id+'?projectId='+b.id,{headers})).status,400);
 assert.equal((await fetch(base+'/projects/upload?id='+a+'&name=..%2Fbad.md',{method:'POST',headers:{'x-media-token':token},body:'bad'})).status,400);
});
