/** Loopback-only presentation; execution is limited by the local runtime registry. */
import { readFileSync, statSync, createReadStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Store, feedbackMessage, assert } from './store.js';
import {Canvas} from './canvas.js';
import {Lab} from './lab.js';

export const PREFIX='/media-workbench';
const pages=new Map([['/app.js',['./web/app.js','text/javascript']],['/app.css',['./web/app.css','text/css']]]);
pages.set('/workspaces.css',['./web/workspaces.css','text/css']);
pages.set('/media-recovery.js',['./web/media-recovery.js','text/javascript']);
pages.set('/canvas.js',['./web/canvas.js','text/javascript']);
pages.set('/canvas.css',['./web/canvas.css','text/css']);
pages.set('/vlm.js',['./web/vlm.js','text/javascript']);
pages.set('/plugins.js',['./web/plugins.js','text/javascript']);
pages.set('/toolkit.js',['./web/toolkit.js','text/javascript']);
export function rangeFor(header,size) {
  if(!header) return null;
  const match=/^bytes=(\d*)-(\d*)$/.exec(header); assert(match && (match[1]||match[2]),'Invalid Range');
  let start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));
  let end=match[1]?(match[2]?Number(match[2]):size-1):size-1;
  assert(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<size&&end>=start,'Invalid Range');
  return {start,end:Math.min(end,size-1)};
}
export function createHandler(projectRoot,runtime=null,options={}) {
  const store=new Store(projectRoot), token=options.token??randomBytes(24).toString('hex');
  const lab=new Lab(store),canvas=new Canvas(store);
  async function handler(req,res) {
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try {
      const host=req.headers.host||'';
      if(!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return json(403,{error:'Loopback host required'});
      if(req.socket.remoteAddress && !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return json(403,{error:'Local connection required'});
      const url=new URL(req.url,`http://${host}`), path=url.pathname.slice(PREFIX.length);
      if(req.headers.origin && req.headers.origin!==`http://${host}`) return json(403,{error:'Cross-origin denied'});
      if(req.headers['sec-fetch-site']==='cross-site') return json(403,{error:'Cross-site denied'});
      if(req.method==='GET' && (path==='/'||path==='')) {
        const html=readFileSync(new URL('./web/index.html',import.meta.url),'utf8').replace('__TOKEN__',token);
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer'});return res.end(html);
      }
      if(req.method==='GET' && pages.has(path)) {
        const [file,mime]=pages.get(path); res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});return res.end(readFileSync(new URL(file,import.meta.url)));
      }
      if((req.headers['x-media-token']||url.searchParams.get('token'))!==token) return json(403,{error:'Invalid access token'});
      if(req.method==='GET' && path==='/canvas')return json(200,canvas.snapshot());
      if(req.method==='GET' && path==='/snapshot') return json(200,{...store.snapshot(),...store.jobs(),labResults:lab.list(),renderJobs:runtime?.jobs()||[],adapters:runtime?.registry.list()||[],vlm:runtime?.services.get('vlm')?.snapshot()??null,toolkit:runtime?.toolkit?.snapshot()??null});
      if(req.method==='GET' && path.startsWith('/file/')) {
        const r=store.file(decodeURIComponent(path.slice(6))),size=statSync(r.absolute).size;
        let range; try {range=rangeFor(req.headers.range,size);} catch {res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}
        const headers={'Content-Type':r.mime,'Content-Length':range?range.end-range.start+1:size,'Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
        if(range) headers['Content-Range']=`bytes ${range.start}-${range.end}/${size}`;
        res.writeHead(range?206:200,headers); const stream=createReadStream(r.absolute,range||{});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res);
      }
      if(req.method==='POST' && (['/canvas','/feedback','/jobs','/jobs/cancel','/lab/confirm','/voice/profile'].includes(path)||path.startsWith('/vlm/')||path.startsWith('/toolkit/'))) {
        if(!req.headers['content-type']?.startsWith('application/json')) return json(415,{error:'JSON required'});
        let body='';for await (const chunk of req) {body+=chunk;assert(Buffer.byteLength(body)<=256000,'Request too large');}
        const args=JSON.parse(body);
        if(path==='/canvas')return json(200,canvas.update(args));
        if(path.startsWith('/toolkit/')){assert(runtime?.toolkit,'Toolkit unavailable');return json(200,await runtime.toolkit.userAction(path.slice(9),args));}
        if(path.startsWith('/vlm/')){const service=runtime?.services.get('vlm');assert(service,'Modal Qwen plugin unavailable');return json(200,await service.userAction(path.slice(5),args));}
        if(path==='/lab/confirm')return json(200,lab.confirm(args));
        if(path==='/voice/profile'){assert(runtime,'Local runtime unavailable');return json(200,runtime.saveVoiceProfile(args));}
        if(path!=='/feedback'){
          assert(runtime,'Local runtime unavailable');
          return json(200,path==='/jobs'?runtime.submit(args):runtime.cancel(args.id));
        }
        const feedback=store.addFeedback(args);return json(200,{feedback,message:feedbackMessage(feedback)});
      }
      return json(404,{error:'Not found'});
    } catch(e) {if(!res.headersSent) json(400,{error:e.message.includes('ENOENT')?'File unavailable':e.message});else res.destroy();}
  }
  return {handler,store,close:()=>store.close()};
}
