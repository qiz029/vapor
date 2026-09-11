import {bundle} from '@remotion/bundler';
import {renderMedia,renderStill,selectComposition} from '@remotion/renderer';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
const [manifestPath,out,mode='render',frame='120',entryPoint='tools/video/remotion/src/music-video.tsx',style='music-video']=process.argv.slice(2);
if(!manifestPath||!out)throw new Error('Usage: render-mv.ts MANIFEST NEW_OUT [still FRAME]');
const m=JSON.parse(await fs.readFile(manifestPath,'utf8'));
if(!['music-video','kinetic-mv','editorial-mv','chorus-editorial','lyric-driven-mv'].includes(style))throw new Error('Unknown packaged MV style');
if(!['render','still'].includes(mode))throw new Error('Mode must be render or still');
if(style==='lyric-driven-mv'&&(!m.audio||!Array.isArray(m.captions)||!Array.isArray(m.accents)))throw new Error('Lyric-driven MV requires audio, captions and accents');
if(['kinetic-mv','editorial-mv','chorus-editorial'].includes(style)){
 const flag=style==='kinetic-mv'?'kinetic':style==='editorial-mv'?'editorial':'chorusEditorial';
 m.scenes=m.scenes.map((s:Record<string,unknown>)=>({...s,kinetic:false,editorial:false,chorusEditorial:false,[flag]:true}));
}
const concurrency=Number(process.env.MEDIA_RENDER_CONCURRENCY||4);
const scale=Number(process.env.MEDIA_RENDER_SCALE||1);
if(!Number.isFinite(scale)||scale<.25||scale>1)throw new Error('MEDIA_RENDER_SCALE must be between .25 and 1');
if(!Number.isInteger(concurrency)||concurrency<1||concurrency>16)throw new Error('MEDIA_RENDER_CONCURRENCY must be an integer from 1 to 16');
if(!Number.isFinite(m.duration)||m.duration<=0||m.duration>600||!Array.isArray(m.scenes)||!m.scenes.length)throw new Error('Expected a complete music video of up to 600 seconds');
const base=path.dirname(path.resolve(manifestPath));
await fs.mkdir(out,{recursive:false});
const publicDir=await fs.mkdtemp(path.join(os.tmpdir(),'media-mv-'));
try{
 for(const [i,s] of m.scenes.entries()){
  if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start!==(i?m.scenes[i-1].end:0)||s.end<=s.start||s.end>m.duration)throw new Error('Invalid scene coverage');
  const key=s.video?'video':'image';
  if(typeof s[key]!=='string'||(s.video&&s.image))throw new Error('Each scene needs exactly one image or video');
  if(['kinetic-mv','chorus-editorial','lyric-driven-mv'].includes(style)&&!s.video)throw new Error(style+' requires video scenes');
  if(style==='editorial-mv'&&!s.image)throw new Error('Editorial MV requires still image scenes');
  if(style==='lyric-driven-mv')s.trimStart??=0;
  if(s.video){
   const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',path.resolve(base,s.video)],{encoding:'utf8'}));
   const stream=probe.streams.find((v:{codec_type:string})=>v.codec_type==='video');
   const trim=s.trimStart??0;
   if(!stream||!Number.isFinite(trim)||trim<0||!Number.isFinite(Number(stream.duration))||Number(stream.duration)+.001<trim+(s.end-s.start)*(style==='kinetic-mv'?1.25:1))throw new Error('Video cannot cover scene without freezing or looping');
  }
  const dest=`scene-${i}${path.extname(s[key])}`;await fs.copyFile(path.resolve(base,s[key]),path.join(publicDir,dest));s[key]=dest;
 }
 if(m.media!==undefined){
  if(!m.media||typeof m.media!=='object'||Array.isArray(m.media))throw new Error('media must be an object of project-local files');
  for(const [key,value] of Object.entries(m.media)){
   if(!/^[A-Za-z0-9_-]+$/.test(key)||typeof value!=='string')throw new Error('Invalid media entry');
   const dest=`media-${key}${path.extname(value)}`;
   await fs.copyFile(path.resolve(base,value),path.join(publicDir,dest));
   m.media[key]=dest;
  }
 }
 if(m.scenes.at(-1).end!==m.duration)throw new Error('Incomplete scenes');
 if(m.audio){const dest='audio'+path.extname(m.audio);await fs.copyFile(path.resolve(base,m.audio),path.join(publicDir,dest));m.audio=dest;}
 const serveUrl=await bundle({entryPoint:path.resolve(entryPoint),publicDir});
 const inputProps={manifest:m};
 const browserExecutable=process.env.REMOTION_BROWSER_EXECUTABLE || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium','/usr/bin/google-chrome','/usr/bin/chromium-browser'].find(p=>existsSync(p));
 if(process.env.VAPOR_PLUGIN_MODE==='1'&&!browserExecutable)throw new Error('Install a browser and set REMOTION_BROWSER_EXECUTABLE; Vapor does not download browsers during rendering');
 const composition=await selectComposition({serveUrl,id:'MusicVideo',inputProps,browserExecutable});
 if(mode==='still'&&(!Number.isInteger(Number(frame))||Number(frame)<0||Number(frame)>=composition.durationInFrames))throw new Error('Still frame outside composition');
 if(mode==='still')await renderStill({serveUrl,composition,inputProps,output:path.join(out,'frame.png'),frame:Number(frame),browserExecutable});
 else await renderMedia({serveUrl,composition,inputProps,codec:'h264',outputLocation:path.join(out,'final.mp4'),browserExecutable,crf:18,concurrency,scale,onProgress:({progress})=>{if(Math.round(progress*100)%20===0)process.stdout.write('.');}});
 if(mode==='render')execFileSync('ffmpeg',['-nostdin','-v','error','-xerror','-i',path.join(out,'final.mp4'),'-f','null','-'],{stdio:'pipe'});
 await fs.writeFile(path.join(out,'render.json'),JSON.stringify({manifest:path.resolve(manifestPath),style,width:mode==='still'?1920:Math.round(1920*scale),height:mode==='still'?1080:Math.round(1080*scale),fps:composition.fps,duration:composition.durationInFrames/composition.fps,fullDecode:mode==='render'?'passed':'not-applicable',fullPlaybackReviewed:false},null,2));
}finally{await fs.rm(publicDir,{recursive:true,force:true});}
