import React from 'react';
import {ChorusEditorial,EditorialLyric} from './chorus-editorial';
import {KineticFrame} from './kinetic-mv';
import {EditorialFrame} from './editorial-mv';
import {AbsoluteFill,Composition,Img,OffthreadVideo,Sequence,Html5Audio,interpolate,registerRoot,staticFile,useCurrentFrame,useVideoConfig} from 'remotion';
export type MV = {title:string; cleanFrame?:boolean; integratedLyrics?:boolean; subtitle?:string; captionFontSize?:number; captionBottom?:number; framedVideo?:boolean; introFadeSeconds?:number; audio?:string; duration:number; scenes:{start:number;end:number;chorusEditorial?:boolean;design?:number;beatFrames?:number[];lyricAlign?:string;lyricDarkInk?:boolean;image?:string;video?:string;trimStart?:number;focusX?:number;focusY?:number;zoom?:number;rain?:boolean;candle?:boolean;boat?:boolean;kinetic?:boolean;editorial?:boolean;background?:string;layout?:string;word?:string;position?:string;scale?:number;number?:number;flash?:boolean}[]; captions:{start:number;end:number;text:string}[]};
const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;
const PaperBoat:React.FC<{t:number}>=({t})=><div style={{position:'absolute',left:780+t*250,top:645-t*50+Math.sin(t*9)*3,width:135-t*45,opacity:Math.min(1,t*3),transform:`rotate(${Math.sin(t*8)*2}deg)`}}><svg viewBox="0 0 200 90"><path d="M3 42 L197 42 155 79 51 79Z" fill="#bdb8a0"/><path d="M30 42 85 9 144 43Z" fill="#ede6cb"/><path d="M85 9 100 42 144 43Z" fill="#969a90"/><path d="M3 42 95 61 197 42" fill="none" stroke="#f5ebcd" strokeWidth="2"/></svg><div style={{height:8,background:'#cad5c6',opacity:.18,filter:'blur(5px)',borderRadius:'50%'}}/></div>;
export const MusicVideo:React.FC<{manifest:MV}>=({manifest:m})=>{
 const frame=useCurrentFrame();const {fps}=useVideoConfig();const sec=frame/fps;
 const cap=m.captions.find(c=>sec>=c.start&&sec<c.end);
 const currentScene=m.scenes.find(s=>sec>=s.start&&sec<s.end);
 return <AbsoluteFill style={{background:'#080e12',fontFamily:'"Songti SC", "STSong", serif',color:'#eee6d2'}}>
  {m.audio&&<Html5Audio src={staticFile(m.audio)}/>}
  {m.scenes.map((s,i)=>{
   if(s.chorusEditorial)return <Sequence key={i} from={Math.round(s.start*fps)} durationInFrames={Math.round(s.end*fps)-Math.round(s.start*fps)}><ChorusEditorial scene={s}/></Sequence>;
   if(s.kinetic)return <Sequence key={i} from={Math.round(s.start*fps)} durationInFrames={Math.round(s.end*fps)-Math.round(s.start*fps)}><KineticFrame scene={s}/></Sequence>;
   if(s.editorial)return sec>=s.start&&sec<s.end?<EditorialFrame key={i} scene={s}/>:null;
   if(s.video)return <Sequence key={i} from={Math.round(s.start*fps)} durationInFrames={Math.round((s.end-s.start)*fps)} premountFor={fps}>
    <OffthreadVideo src={staticFile(s.video)} muted trimBefore={Math.round((s.trimStart||0)*fps)} style={{width:'100%',height:m.framedVideo?'calc(100% - 164px)':'100%',marginTop:m.framedVideo?72:0,objectFit:m.framedVideo?'contain':'cover'}}/>
   </Sequence>;
   if(sec<s.start-.8||sec>s.end+.8)return null;
   const t=Math.max(0,Math.min(1,(sec-s.start)/(s.end-s.start)));
   const alpha=interpolate(sec,[s.start-.6,s.start+.6,s.end-.1,s.end+.8],[0,1,1,0],clamp);
   const zoom=(s.zoom||1.04)+t*.065;
   return <AbsoluteFill key={i} style={{opacity:alpha,overflow:'hidden'}}>
    <Img src={staticFile(s.image!)} style={{width:'100%',height:'100%',objectFit:'cover',objectPosition:`${s.focusX||50}% ${s.focusY||50}%`,transform:`scale(${zoom}) translate(${(i%2?1:-1)*(t-.5)*1.2}%,${(t-.5)*.5}%)`}}/>
    {s.rain&&<AbsoluteFill style={{overflow:'hidden',opacity:.32}}>{Array.from({length:85},(_,n)=>{const x=(n*811+frame*2)%2200-150;const y=(n*173+frame*(12+n%6))%1400-160;return <div key={n} style={{position:'absolute',left:x,top:y,width:1,height:25+n%25,background:'linear-gradient(transparent,#b2c8d2)',transform:'rotate(17deg)',opacity:.15+(n%5)*.1}}/>})}</AbsoluteFill>}
    {s.candle&&<AbsoluteFill style={{background:'radial-gradient(ellipse at 76% 48%,#edb86532,transparent 58%)',opacity:.45+.08*Math.sin(frame*.21)+.06*Math.sin(frame*.47),mixBlendMode:'screen'}}/>}
    {s.boat&&<PaperBoat t={t}/>}
    <AbsoluteFill style={{background:'radial-gradient(ellipse at center,transparent 35%,#02060b75 100%)'}}/>
   </AbsoluteFill>;
  })}
  {!m.cleanFrame&&<div style={{position:'absolute',top:0,left:0,right:0,height:72,background:'#070c10'}}/>}
  {!m.cleanFrame&&<div style={{position:'absolute',bottom:0,left:0,right:0,height:92,background:'#070c10'}}/>}
  {sec<6.4&&<AbsoluteFill style={{alignItems:'center',justifyContent:'center',opacity:interpolate(sec,[.7,2,4.8,6.4],[0,1,1,0],clamp),background:'#030a131a'}}>
   <div style={{fontSize:112,letterSpacing:26,textShadow:'0 3px 30px #000',marginLeft:26}}>{m.title}</div>
   <div style={{marginTop:32,fontSize:22,letterSpacing:9,color:'#d4c5aa'}}>{m.subtitle ?? (m.title === '一纸归舟' ? 'A LETTER ON THE RIVER' : '')}</div>
  </AbsoluteFill>}
  {cap&&m.integratedLyrics&&<EditorialLyric caption={cap} seconds={sec} chorus={Boolean(currentScene?.chorusEditorial)} align={currentScene?.lyricAlign} darkInk={currentScene?.lyricDarkInk}/> }
  {cap&&!m.integratedLyrics&&<div style={{position:'absolute',bottom:m.captionBottom ?? 126,left:120,right:120,textAlign:'center',fontSize:m.captionFontSize ?? 39,letterSpacing:5,textShadow:'0 2px 8px #000,0 0 20px #000',opacity:interpolate(sec,[cap.start,cap.start+.22,cap.end-.18,cap.end],[0,1,1,0],clamp)}}>{cap.text}</div>}
  {!m.cleanFrame&&<div style={{position:'absolute',bottom:35,left:60,fontFamily:'"PingFang SC", sans-serif',fontSize:15,letterSpacing:3,color:'#7d8588'}}>原创音乐 MV · AI 合成演唱（非本人演唱）</div>}
  {!m.cleanFrame&&<div style={{position:'absolute',bottom:34,right:60,fontSize:16,letterSpacing:4,color:'#9b9789'}}>{m.title}</div>}
  <AbsoluteFill style={{background:'#070c10',opacity:interpolate(sec,[0,m.introFadeSeconds ?? .6,m.duration-1.1,m.duration],[1,0,0,1],clamp)}}/>
 </AbsoluteFill>;
};
const defaults:MV={title:'一纸归舟',duration:60,scenes:[],captions:[]};
registerRoot(()=> <Composition id="MusicVideo" component={MusicVideo} width={1920} height={1080} fps={30} durationInFrames={1800} defaultProps={{manifest:defaults}} calculateMetadata={({props})=>({durationInFrames:Math.round(props.manifest.duration*30)})}/>);
