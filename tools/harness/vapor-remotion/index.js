/** Independent Harness plugin implementing the Vapor v1 video.render seam. */
import {writeFileSync,readFileSync,createWriteStream,existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {registerTools} from './register-tools.js';
export const inject=['vaporRuntime'];
export const inputSchema={type:'object',additionalProperties:false,required:['heading','body','duration','accent'],properties:{heading:{type:'string',minLength:1,maxLength:60},body:{type:'string',maxLength:160},duration:{type:'integer',minimum:1,maximum:10},accent:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'}}};
export function createAdapter(workspaceRoot){return {
  contractVersion:1,id:'vapor-remotion',operation:'video.render',inputSchema,permissions:{network:false,paid:false},progress:'phase-local measured render progress; bundling/verification indeterminate',
  validate(input){
    if(!input||Object.keys(input).some(k=>!Object.hasOwn(inputSchema.properties,k))||typeof input.heading!=='string'||!input.heading.trim()||input.heading.length>60||typeof input.body!=='string'||input.body.length>160||!Number.isInteger(input.duration)||input.duration<1||input.duration>10||!/^#[0-9a-fA-F]{6}$/.test(input.accent))throw new Error('Invalid title-card input');
    return {heading:input.heading,body:input.body,duration:input.duration,accent:input.accent};
  },
  async execute({input,jobDir,signal,report}){
    if(signal.aborted)throw new Error('Aborted');
    const manifest=join(jobDir,'input.json'),out=join(jobDir,'render');
    writeFileSync(manifest,JSON.stringify({schemaVersion:1,title:'VAPOR / LOCAL RENDER',width:1280,height:720,fps:30,duration:input.duration,scenes:[{start:0,end:input.duration,title:input.heading,body:input.body,accent:input.accent,points:[]}],captions:[]}),{flag:'wx',flush:true});
    await new Promise((resolve,reject)=>{
      // Trusted installed renderer only; no arbitrary command, URL, entrypoint or asset path.
      const child=spawn(process.execPath,['--import','tsx',join(workspaceRoot,'tools/video/remotion/cli.ts'),'render','--manifest',manifest,'--out',out,'--progress'],{cwd:workspaceRoot,detached:true,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,VAPOR_PLUGIN_MODE:'1',REMOTION_BROWSER_EXECUTABLE:process.env.REMOTION_BROWSER_EXECUTABLE},stdio:['ignore','pipe','pipe']});
      const log=createWriteStream(join(jobDir,'renderer.log'),{flags:'wx',mode:0o600});let pending='',tail='',timedOut=false;
      let forceTimer;
      const stop=()=>{try{process.kill(-child.pid,'SIGTERM');}catch{};forceTimer??=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},5000);forceTimer.unref();};
      const timeout=setTimeout(()=>{timedOut=true;stop();},180000);
      const abort=()=>stop();signal.addEventListener('abort',abort,{once:true});
      child.stdout.pipe(log,{end:false});
      child.stderr.on('data',chunk=>{log.write(chunk);pending+=chunk;tail=(tail+chunk).slice(-1500);let line;while((line=pending.indexOf('\n'))>=0){const s=pending.slice(0,line);pending=pending.slice(line+1);if(s.startsWith('VAPOR_PROGRESS ')){try{const p=JSON.parse(s.slice(15));report(p);}catch{}}}});
      child.once('error',e=>{clearTimeout(timeout);signal.removeEventListener('abort',abort);log.end();reject(e);});
      child.once('close',code=>{clearTimeout(timeout);clearTimeout(forceTimer);signal.removeEventListener('abort',abort);log.end();if(code===0&&!signal.aborted&&!timedOut)resolve();else reject(new Error(timedOut?'Renderer timed out':signal.aborted?'Render cancelled':`Renderer exited ${code}: ${tail}`));});
    });
    const result=JSON.parse(readFileSync(join(out,'report.json'),'utf8'));
    if(result.technical?.fullDecode!=='passed')throw new Error('Technical verification failed');
    return {path:join(out,'final.mp4'),technical:result.technical};
  }
};}
export function apply(ctx,config={}){
  const packed=fileURLToPath(new URL('./renderer/',import.meta.url));
  const root=existsSync(join(packed,'tools/video/remotion/cli.ts'))?packed:process.env.VAPOR_WORKSPACE_ROOT;
  if(!root)throw new Error('Renderer assets missing: install a built Vapor Remotion package');
  ctx.effect(()=>ctx.vaporRuntime.registry.register(createAdapter(root)));
  ctx.effect(()=>registerTools(ctx,config));
}
