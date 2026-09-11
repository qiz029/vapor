import React from 'react';
import {AbsoluteFill,Img,staticFile,useCurrentFrame,useVideoConfig} from 'remotion';
export const EditorialFrame:React.FC<{scene:any}>=({scene:s})=>{
 const frame=useCurrentFrame();const {fps}=useVideoConfig();const local=frame-Math.round(s.start*fps);
 const dark=['#a62d27','#192326'].includes(s.background);const ink=dark?'#f0e9db':'#192326';
 const layout=s.layout||'wide';
 return <AbsoluteFill style={{background:s.background,color:ink,overflow:'hidden'}}>
  <div style={{position:'absolute',left:76,top:96,fontSize:18,letterSpacing:7,fontFamily:'sans-serif'}}>BLANK / FLASHBACK</div>
  <div style={{position:'absolute',right:78,top:94,fontSize:20,letterSpacing:5}}>留 白 闪 回</div>
  <div style={{position:'absolute',left:76,top:124,fontSize:112,letterSpacing:20,lineHeight:1,fontFamily:'"Songti SC",serif'}}>{s.word}</div>
  <div style={{position:'absolute',left:layout==='wide'?220:760,top:layout==='wide'?266:160,width:layout==='wide'?1480:1000,height:layout==='wide'?650:756,overflow:'hidden'}}>
   <Img src={staticFile(s.image)} style={{width:'100%',height:'100%',objectFit:layout==='wide'?'contain':'cover',objectPosition:s.position||'50% 50%',transform:`scale(${s.scale||1})`,transformOrigin:s.position||'50% 50%'}}/>
  </div>
  {layout!=='wide'&&<div style={{position:'absolute',left:80,top:430,fontSize:25,letterSpacing:8,lineHeight:2.2}}>一瞬<br/>一色<br/>一页</div>}
  <div style={{position:'absolute',left:80,top:912,fontSize:16,letterSpacing:5,fontFamily:'sans-serif'}}>SONG / EDITION　{String(s.number).padStart(2,'0')}</div>
  {s.flash&&local<3&&<AbsoluteFill style={{background:'#fff6e9',opacity:(3-local)*.065}}/>}
 </AbsoluteFill>;
};
