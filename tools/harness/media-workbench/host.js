/** Project-scoped presentation and execution; installed packs are shared, user data is not. */
import {createHandler,PREFIX} from './http.js';
import {Projects} from './projects.js';
import {projectRoot} from './project.js';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {assert} from './store.js';
import {CredentialSettings} from './credential-settings.js';
import {Hub} from './hub.js';
export const inject=['webServer','sessionQuery','credentials'];
export function apply(ctx,config={}){
 if(ctx.webServer.host!=='127.0.0.1')throw new Error('Vapor requires loopback hosting');
 const root=projectRoot(config),projects=new Projects(root,config.catalogRoot||join(process.env.DSH_HOME||root,'vapor')),token=randomBytes(24).toString('hex'),apps=new Map();
 const hub=new Hub();
 const credentialSettings=ctx.credentials?new CredentialSettings(ctx.credentials):null;
 if(credentialSettings)projects.initialize(r=>{r.toolkit.credentialEnvironment=pack=>credentialSettings.environment(pack);return()=>{delete r.toolkit.credentialEnvironment;};});
 ctx.provide('vaporRuntime',projects.facade);
 ctx.effect(()=>{
  const off=ctx.on('tools/execute',(exec,next)=>exec.agent?projects.runSession(exec.agent.session,next):next());
  const dispose=ctx.webServer.register({kind:'prefix',path:PREFIX,handler:async(req,res)=>{
   const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
   try{
    const host=req.headers.host||'';assert(/^(127\.0\.0\.1|localhost):\d+$/.test(host),'Loopback host required');assert(!req.socket.remoteAddress||['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress),'Local connection required');assert(!req.headers.origin||req.headers.origin===`http://${host}`,'Cross-origin denied');assert(req.headers['sec-fetch-site']!=='cross-site','Cross-site denied');
    const url=new URL(req.url,`http://${host}`),path=url.pathname.slice(PREFIX.length);
    if(['/hub/search','/hub/plan','/hub/install','/hub/status','/hub/rollback','/hub/cancel'].includes(path)){
     assert(req.headers['x-media-token']===token,'Invalid access token');assert(req.method==='POST'&&req.headers['content-type']?.startsWith('application/json'),'JSON POST required');
     let body='';for await(const chunk of req){body+=chunk;assert(Buffer.byteLength(body)<=12000,'Request too large');}
     const args=JSON.parse(body);try{return send(200,await hub[path.slice(5)](args));}catch{return send(400,{error:'插件操作未完成；请检查网络和安装计划。原配置未切换。'});}
    }
    if(path==='/credentials'||path==='/credentials/test'){
     assert(req.headers['x-media-token']===token,'Invalid access token');assert(credentialSettings,'凭据服务不可用');
     if(req.method==='GET'&&path==='/credentials')return send(200,{credentials:await credentialSettings.list()});
     assert(req.method==='POST'&&req.headers['content-type']?.startsWith('application/json'),'JSON POST required');
     let body='';for await(const chunk of req){body+=chunk;assert(Buffer.byteLength(body)<=12000,'Request too large');}
     try{return send(200,await credentialSettings[path.endsWith('/test')?'test':'save'](JSON.parse(body)));}catch{return send(400,{error:'密钥保存失败，请检查输入和本地存储权限'});}
    }
    if(path==='/projects'||path.startsWith('/projects/')){
     assert(req.headers['x-media-token']===token,'Invalid access token');
     if(req.method==='GET'&&path==='/projects')return send(200,{projects:projects.list(),defaultId:projects.defaultId});
     if(req.method==='GET'&&path==='/projects/detail')return send(200,projects.snapshot(url.searchParams.get('id')));
     if(req.method==='POST'&&path==='/projects/upload'){
      const declared=Number(req.headers['content-length']);assert(Number.isSafeInteger(declared)&&declared>0&&declared<=512*1024*1024,'文件需小于 512 MB');let total=0;const chunks=[];for await(const chunk of req){total+=chunk.length;assert(total<=512*1024*1024,'文件过大');chunks.push(chunk);}return send(200,projects.import(url.searchParams.get('id'),url.searchParams.get('name'),Buffer.concat(chunks)));
     }
     assert(req.method==='POST'&&req.headers['content-type']?.startsWith('application/json'),'JSON POST required');let body='';for await(const chunk of req){body+=chunk;assert(Buffer.byteLength(body)<=64000,'Request too large');}const args=JSON.parse(body);
     if(path==='/projects/create')return send(200,projects.create(args));
     if(path==='/projects/open')return send(200,await projects.open(args.id,ctx.sessionQuery));
     if(path==='/projects/bind')return send(200,await projects.bind(args.id,args.sessionId,ctx.sessionQuery));
     if(path==='/projects/update')return send(200,projects.update(args.id,args));
     if(path==='/projects/delete')return send(200,projects.deleteArtifact(args.id,args));
     if(path==='/projects/organize')return send(200,projects.organize(args.id,args));
     return send(404,{error:'Not found'});
    }
    let id=url.searchParams.get('projectId');const sid=url.searchParams.get('sessionId');if(!id&&sid&&sid!=='preview'){id=projects.list().find(p=>p.sessionId===sid)?.id;assert(id,'请先从左侧打开项目');}id??=projects.defaultId;
    if(!apps.has(id)){const r=projects.runtime(id);apps.set(id,createHandler(r.root,r,{token}));}return projects.scope.run(projects.runtime(id),()=>apps.get(id).handler(req,res));
   }catch(error){if(!res.headersSent)send(error.message==='Invalid access token'?403:400,{error:error.message});else res.destroy();}
  }});
  return async()=>{off();dispose();for(const app of apps.values())app.close();await projects.close();};
 });
}
