/** macOS-only, network-denied reference preparation. No TTS or global voice writes. */
import {spawn} from 'node:child_process';
import {join,dirname,delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,existsSync} from 'node:fs';
import {registerTools} from './register-tools.js';
export const inject=['vaporRuntime'];
export const inputSchema={type:'object',additionalProperties:false,required:['sourceRevisionId','start','duration','separation','sourceNote'],properties:{sourceRevisionId:{type:'string'},start:{type:'number',minimum:0},duration:{type:'number',minimum:3,maximum:30},separation:{type:'string',enum:['demucs','none']},sourceNote:{type:'string',minLength:1,maxLength:1000}}};
export function createAdapter(root,store,config={}){const local=join(root,'.venv','bin','python');const python=config.python||process.env.VAPOR_VOICE_PYTHON||(existsSync(local)?local:'python3');return {
  id:'vapor-voice-local',operation:'lab.voice.prepare',contractVersion:1,inputSchema,permissions:{network:false,paid:false},progress:'Actual process stages only; no estimated percentage',
  validate(i){
    if(!i||Object.keys(i).some(k=>!Object.hasOwn(inputSchema.properties,k))||typeof i.sourceRevisionId!=='string'||!Number.isFinite(i.start)||i.start<0||!Number.isFinite(i.duration)||i.duration<3||i.duration>30||!['demucs','none'].includes(i.separation)||typeof i.sourceNote!=='string'||!i.sourceNote.trim()||i.sourceNote.length>1000)throw new Error('Invalid voice preparation input');
    const r=store.file(i.sourceRevisionId);if(!/^(audio|video)\//.test(r.mime))throw new Error('Voice source must be audio/video');
    return {sourceRevisionId:i.sourceRevisionId,start:i.start,duration:i.duration,separation:i.separation,sourceNote:i.sourceNote};
  },
  async execute({input,jobDir,signal,report}){
    if(process.platform!=='darwin')throw new Error('Local voice adapter currently requires macOS network sandbox');
    if(signal.aborted)throw new Error('Cancelled');
    const source=store.file(input.sourceRevisionId),out=join(jobDir,'prepared');
    report({phase:input.separation==='demucs'?'extracting-and-separating':'extracting-clean-reference',fraction:null});
    await new Promise((resolve,reject)=>{
      const child=spawn('/usr/bin/sandbox-exec',['-p','(version 1) (allow default) (deny network*)',python,join(root,'tools/voice/voice.py'),'separate','--source',source.absolute,'--start',String(input.start),'--duration',String(input.duration),'--separation',input.separation,'--source-note',input.sourceNote,'--output-dir',out],{cwd:root,detached:true,env:{PATH:dirname(python)+delimiter+process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_IMPLICIT_TOKEN:'1'},stdio:['ignore','pipe','pipe']});
      let tail='',force,timedOut=false;
      const stop=()=>{try{process.kill(-child.pid,'SIGTERM');}catch{};force??=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},3000);};
      const timeout=setTimeout(()=>{timedOut=true;stop();},600000);
      const abort=()=>stop();signal.addEventListener('abort',abort,{once:true});
      child.stdout.on('data',c=>{tail=(tail+c).slice(-2000);});child.stderr.on('data',c=>{tail=(tail+c).slice(-2000);});
      const clean=()=>{clearTimeout(timeout);clearTimeout(force);signal.removeEventListener('abort',abort);};
      child.once('error',e=>{clean();reject(e);});
      child.once('close',code=>{clean();if(code===0&&!signal.aborted&&!timedOut)resolve();else reject(new Error(signal.aborted?'Cancelled':timedOut?'Voice preparation timed out':`Preparation failed (models must be cached; network denied): ${tail}`));});
    });
    report({phase:'registering-reference',fraction:null});
    const reportData=JSON.parse(readFileSync(join(out,'preprocessing.json'),'utf8'));
    const assets=[{name:'mixture',title:'原始片段',path:join(out,'mixture.wav')}];
    if(input.separation==='demucs')assets.push({name:'vocals',title:'分离人声',path:join(out,'separated/htdemucs/mixture/vocals.wav')},{name:'accompaniment',title:'移除的伴奏',path:join(out,'separated/htdemucs/mixture/no_vocals.wav')});
    return {path:join(out,'reference.wav'),assets,technical:{...reportData,sourceRevisionId:source.id,sourceSha256:source.sha256,listening_review:'pending'}};
  }
};}
export function apply(ctx,config={}){const packed=fileURLToPath(new URL('./python/',import.meta.url));const root=existsSync(join(packed,'tools/voice/voice.py'))?packed:process.env.VAPOR_WORKSPACE_ROOT;if(!root)throw new Error('Voice resources missing: install a built Vapor voice package');ctx.effect(()=>ctx.vaporRuntime.forEachProject?ctx.vaporRuntime.forEachProject(r=>r.registry.register(createAdapter(root,r.store,config))):ctx.vaporRuntime.registry.register(createAdapter(root,ctx.vaporRuntime.store,config)));ctx.effect(()=>registerTools(ctx,config));}
