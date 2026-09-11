import React from 'react';
import {AbsoluteFill, Composition, Html5Audio, OffthreadVideo, Sequence, interpolate, registerRoot, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';

type Scene={start:number;end:number;video:string;trimStart:number;mode?:'dialogue'|'rock'|'resolve';ink?:boolean;place?:string};
type Caption={start:number;end:number;text:string;align?:'left'|'right'|'center';emphasis?:boolean};
type Cue={time:number;strength:number};
type Manifest={duration:number;audio:string;scenes:Scene[];captions:Caption[];accents:Cue[]};
const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;

/** Explicit musical events control typography and lighting; source actions are aligned in the EDL. */
const LyricDrivenMV:React.FC<{manifest:Manifest}>=({manifest:m})=>{
 const frame=useCurrentFrame();const {fps}=useVideoConfig();const t=frame/fps;
 const current=m.scenes.find(s=>t>=s.start&&t<s.end);
 const caption=m.captions.find(c=>t>=c.start&&t<c.end);
 const cue=m.accents.filter(c=>c.time<=t&&t-c.time<.22).at(-1);
 const pulse=cue?cue.strength*interpolate(t,[cue.time,cue.time+.22],[1,0],clamp):0;
 const rock=current?.mode==='rock';
 return <AbsoluteFill style={{background:'#080909',color:'#fff9e9',overflow:'hidden',fontFamily:'"PingFang SC",sans-serif'}}>
  <Html5Audio src={staticFile(m.audio)}/>
  {m.scenes.map((s,i)=><Sequence key={i} from={Math.round(s.start*fps)} durationInFrames={Math.round(s.end*fps)-Math.round(s.start*fps)} premountFor={15}>
   <OffthreadVideo muted src={staticFile(s.video)} trimBefore={Math.round(s.trimStart*fps)} style={{width:'100%',height:'100%',objectFit:'cover',filter:s.ink?'grayscale(1) contrast(1.18)':'contrast(1.08) saturate(.9)'}}/>
   <AbsoluteFill style={{background:s.mode==='dialogue'?'linear-gradient(90deg,#08090985,transparent 65%),linear-gradient(0deg,#080909b0,transparent 60%)':'linear-gradient(0deg,#080909b8,transparent 55%)'}}/>
  </Sequence>)}
  {rock&&<AbsoluteFill style={{background:'radial-gradient(ellipse at 8% 25%,#e42f16,transparent 60%)',mixBlendMode:'screen',opacity:pulse*.17}}/>}
  {rock&&pulse>.05&&<div style={{position:'absolute',left:0,top:0,bottom:0,width:interpolate(pulse,[0,1],[0,18]),background:'#e13626',opacity:pulse*.6}}/>}
  {current?.place&&<div style={{position:'absolute',left:120,top:88,fontSize:32,letterSpacing:8,textShadow:'0 2px 8px #000'}}>{current.place}</div>}
  {caption&&<div style={{position:'absolute',left:caption.align==='right'?undefined:120,right:caption.align==='left'?undefined:120,bottom:rock?105:150,maxWidth:1680,textAlign:caption.align??'center',fontWeight:rock||caption.emphasis?850:550,fontSize:caption.emphasis?(rock?142:154):(rock?80:94),letterSpacing:rock?8:12,lineHeight:1.22,textShadow:'0 3px 14px #000b',opacity:interpolate(t,[caption.start,caption.start+.08,caption.end-.1,caption.end],[0,1,1,0],clamp),transform:`translateY(${interpolate(t,[caption.start,caption.start+.16],[18,0],clamp)}px)`}}>
   {caption.emphasis&&<div style={{position:'absolute',left:-20,right:-20,bottom:4,height:rock?25:3,background:'#c7271d',zIndex:-1,opacity:.95}}/>}
   {caption.text}
  </div>}
  <AbsoluteFill style={{background:'#080909',opacity:interpolate(t,[0,.13,m.duration-.6,m.duration],[1,0,0,1],clamp)}}/>
 </AbsoluteFill>;
};
const defaults:Manifest={duration:1,audio:'',scenes:[],captions:[],accents:[]};
registerRoot(()=> <Composition id="MusicVideo" component={LyricDrivenMV} width={1920} height={1080} fps={30} durationInFrames={30} defaultProps={{manifest:defaults}} calculateMetadata={({props})=>({durationInFrames:Math.round(props.manifest.duration*30)})}/>);
