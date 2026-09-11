import React from 'react';
import {AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';

/** Continuous chorus art direction. All time comes from the composition frame. */
export const ChorusEditorial: React.FC<{scene: {video?:string; trimStart?:number; word?:string; design?:number; beatFrames?:number[]}}> = ({scene:s}) => {
  const f=useCurrentFrame(); const {fps}=useVideoConfig();
  const beats=s.beatFrames ?? [0,16,31,47,63,78];
  const beat=Math.max(0,beats.filter(b=>b<=f).length-1);
  const hit=1-Math.min(1,(f-(beats[beat]??0))/5);
  const variant=(s.design??0)%4;
  const mode=(variant+Math.floor(beat/2))%4;
  const paper=['#eae6d9','#d5e5a0','#dedcca','#d5e5a0'][(s.design??0)%4];
  const ink='#171b18'; const word=s.word||'留白';
  const video=(style:React.CSSProperties={})=><OffthreadVideo src={staticFile(s.video!)} muted trimBefore={Math.round((s.trimStart??0)*fps)} style={{width:'100%',height:'100%',objectFit:'cover',filter:'grayscale(1) contrast(1.17)',transform:`scale(${1.015+hit*.025})`,...style}}/>;
  const mask=`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="black"/><g fill="white" font-family="PingFang SC,sans-serif" font-weight="900"><text x="-20" y="490" font-size="510" textLength="1960" lengthAdjust="spacingAndGlyphs">${word}${word}</text><text x="-20" y="1010" font-size="510" textLength="1960" lengthAdjust="spacingAndGlyphs">${word}${word}</text></g></svg>`;
  const uri=`url("data:image/svg+xml,${encodeURIComponent(mask)}")`;
  return <AbsoluteFill style={{background:paper,overflow:'hidden',color:ink,fontFamily:'"PingFang SC", sans-serif'}}>
    {mode===0&&<>
      <AbsoluteFill>{video()}</AbsoluteFill>
      <div style={{position:'absolute',inset:'0 auto 0 0',width:85+hit*25,background:paper,clipPath:'polygon(0 0,90% 0,75% 19%,100% 40%,74% 63%,96% 83%,77% 100%,0 100%)'}}/>
      <div style={{position:'absolute',right:-24,bottom:-40,fontWeight:900,fontSize:270,letterSpacing:20,color:'transparent',WebkitTextStroke:`2px ${paper}`,opacity:.65,transform:`translateX(${beat%2*25}px)`}}>{word}</div>
    </>}
    {mode===1&&<>
      <div style={{position:'absolute',left:-45,top:-100,fontWeight:900,fontSize:440,lineHeight:1.02,letterSpacing:-20,transform:`translateY(${beat%2*22}px)`}}>{word}<br/>{word}<br/>{word}</div>
      <AbsoluteFill style={{clipPath:`polygon(${25+hit*3}% 0,100% 0,100% 100%,${15+hit*3}% 100%,22% 81%,17% 62%,26% 41%,20% 20%)`}}>{video()}</AbsoluteFill>
    </>}
    {mode===2&&<>
      <AbsoluteFill style={{opacity:.22}}>{video()}</AbsoluteFill>
      <AbsoluteFill style={{maskImage:uri,maskMode:'luminance',maskSize:'100% 100%',WebkitMaskImage:uri}}>{video()}</AbsoluteFill>
    </>}
    {mode===3&&<>
      <AbsoluteFill style={{clipPath:'polygon(0 8%,20% 5%,40% 10%,65% 3%,82% 8%,100% 4%,100% 91%,79% 96%,59% 90%,34% 97%,15% 92%,0 96%)'}}>{video()}</AbsoluteFill>
      <div style={{position:'absolute',left:-30,top:-65,fontSize:215,fontWeight:900,letterSpacing:25,whiteSpace:'nowrap',transform:`translateX(${-beat*22}px)`}}>{word}　{word}　{word}　{word}</div>
    </>}
    <svg width="1920" height="1080" style={{position:'absolute',inset:0,pointerEvents:'none'}}>
      <path d={`M ${1750+beat%2*12} 42 l 80 83 m -70 -97 l 52 108`} stroke={mode===0?paper:ink} strokeWidth="8" fill="none"/>
      <path d="M45 655 l 30 -90 22 105" stroke={paper} strokeWidth="7" fill="none"/>
    </svg>
  </AbsoluteFill>;
};

export const EditorialLyric:React.FC<{caption:{start:number;end:number;text:string}; seconds:number; chorus:boolean; align?:string; darkInk?:boolean}>=({caption:c,seconds,chorus,align='left',darkInk=false})=>{
  const age=Math.max(0,seconds-c.start);
  const enter=Math.min(1,age/(chorus?.09:.2));
  const exit=Math.min(1,Math.max(0,(c.end-seconds)/.12));
  const parts=c.text.trim().split(/\s+/);
  return <div style={{position:'absolute',left:align==='right'?undefined:90,right:align==='right'?90:undefined,bottom:chorus?95:100,maxWidth:1500,textAlign:align==='right'?'right':'left',color:!chorus&&darkInk?'#283632':'#f6f1e4',textShadow:!chorus&&darkInk?'0 1px 2px #ffffff66':'0 2px 5px #000a,0 0 2px #000',opacity:enter*exit,transform:`translateY(${(1-enter)*(chorus?18:8)}px)`,fontFamily:chorus?'"PingFang SC", sans-serif':'"Songti SC", serif',fontWeight:chorus?650:400,fontSize:chorus?68:44,letterSpacing:chorus?5:7,lineHeight:1.25}}>
    {parts.map((part,i)=><span key={i} style={{display:'inline-block',marginLeft:i?30:0}}>{part}</span>)}
  </div>;
};
