import React from 'react';
import {AbsoluteFill,OffthreadVideo,staticFile,useCurrentFrame,useVideoConfig} from 'remotion';
export const KineticFrame:React.FC<{scene:any}>=({scene:s})=>{
 const f=useCurrentFrame();const {fps}=useVideoConfig();const t=f/fps;const punch=Math.max(0,1-f/6);const phase=Math.floor(f/4);const bg=s.background||'#eee8dc';const ink=bg==='#eee8dc'?'#131919':'#eee8dc';
 const video=<OffthreadVideo src={staticFile(s.video)} muted trimBefore={Math.round((s.trimStart||0)*fps)} playbackRate={1.25} style={{width:'100%',height:'100%',objectFit:'cover',filter:'grayscale(1) contrast(1.22)',transform:`scale(${1.06+punch*.09})`}}/>;
 const mask=`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="black"/><g fill="white" font-family="sans-serif" font-weight="900"><text x="40" y="505" font-size="490" textLength="1840" lengthAdjust="spacingAndGlyphs">${s.word}</text><text x="40" y="975" font-size="490" textLength="1840" lengthAdjust="spacingAndGlyphs">${s.word}</text></g></svg>`;
 const uri=`url("data:image/svg+xml,${encodeURIComponent(mask)}")`;
 const reveal=Math.min(1,f/6);const mode=s.layout;
 return <AbsoluteFill style={{background:bg,overflow:'hidden',color:ink}}>
  {mode==='type'?<>
   <AbsoluteFill style={{opacity:.12}}>{video}</AbsoluteFill>
   <AbsoluteFill style={{maskImage:uri,maskMode:'luminance',maskSize:'100% 100%',WebkitMaskImage:uri,transform:`translateX(${phase%2?12:-12}px)`}}>{video}</AbsoluteFill>
  </>:mode==='tear'?<>
   <AbsoluteFill style={{clipPath:`polygon(0 ${18-reveal*15}%,100% ${10-reveal*8}%,100% ${76+reveal*17}%,78% 88%,62% 96%,45% 89%,23% 96%,0 88%)`}}>{video}</AbsoluteFill>
   <div style={{position:'absolute',top:65,left:-35,fontSize:180,fontWeight:900,letterSpacing:20,transform:`translateX(${-f*3}px)`,whiteSpace:'nowrap'}}>{s.word}　{s.word}　{s.word}</div>
  </>:<>
   <AbsoluteFill>{video}</AbsoluteFill>
   <AbsoluteFill style={{background:bg,mixBlendMode:'multiply',opacity:.55}}/>
   <div style={{position:'absolute',left:-20,top:80,fontSize:210,fontWeight:900,WebkitTextStroke:`2px ${ink}`,color:'transparent',letterSpacing:25,transform:`translateX(${f*2}px)`}}>{s.word}</div>
   <div style={{position:'absolute',bottom:120,right:-10,fontSize:165,fontWeight:900,letterSpacing:20}}>{s.word}</div>
  </>}
  <svg width="1920" height="1080" style={{position:'absolute',inset:0,pointerEvents:'none'}}><path d={`M ${1560+phase%3*5} 125 l 160 60 m -120 -80 l 65 145`} stroke={ink} strokeWidth="13" fill="none"/><path d="M80 875 Q240 820 340 886" stroke={ink} strokeWidth="9" fill="none"/></svg>
 </AbsoluteFill>;
};
