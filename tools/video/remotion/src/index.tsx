import React from 'react';
import {AbsoluteFill, Composition, Html5Audio, interpolate, registerRoot, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {frameCount, manifestSchema, type Manifest} from '../schema';
import {SceneVisual} from './visuals';
import example from '../../../../examples/remotion/hello.json';

export const Timeline: React.FC<{manifest: Manifest}> = ({manifest: m}) => {
  const frame = useCurrentFrame();
  const {width, height, fps} = useVideoConfig();
  const index = Math.max(0, m.scenes.findIndex((s, i) => frame >= Math.round(s.start * fps) &&
    frame < (i === m.scenes.length - 1 ? frameCount(m) : Math.round(s.end * fps))));
  const scene = m.scenes[index];
  const local = frame - Math.round(scene.start * fps);
  const enter = interpolate(local, [0, 14], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const caption = m.captions.find(c => frame >= Math.round(c.start * fps) && frame < Math.round(c.end * fps));
  const portrait = height > width;
  const scale = Math.min(width / 1080, height / 1920);
  // Design in a 1080-wide coordinate system; landscape uses a shorter canvas.
  const factor = portrait ? width / 1080 : height / 1080;
  const canvasWidth = width / factor;
  const canvasHeight = height / factor;
  return <AbsoluteFill style={{background: '#101720', color: '#f4f6f8', fontFamily: '"PingFang SC", "Noto Sans CJK SC", sans-serif'}}>
    {m.audio ? <Html5Audio src={staticFile(m.audio)}/> : null}
    <div style={{width: canvasWidth, height: canvasHeight, flexShrink: 0, transform: `scale(${factor})`, transformOrigin: 'top left', position: 'relative', overflow: 'hidden'}}>
      <div style={{position: 'absolute', width: 720, height: 720, borderRadius: '50%', background: scene.accent, filter: 'blur(180px)', opacity: .09, right: -250, top: -230}}/>
      <div style={{position: 'absolute', top: 82, left: 76, right: 76, display: 'flex', justifyContent: 'space-between', fontSize: 25, letterSpacing: 2, color: '#a5b5c5'}}>
        <span style={{maxWidth: '80%'}}>{m.title}</span><span>{String(index + 1).padStart(2, '0')} / {String(m.scenes.length).padStart(2, '0')}</span>
      </div>
      <div style={{position: 'absolute', left: 76, right: 76, top: scene.visual ? 180 : portrait ? 360 : 230, opacity: enter, transform: `translateY(${(1 - enter) * 28}px)`}}>
        <div style={{height: 6, width: 72, background: scene.accent, marginBottom: 45}}/>
        <div style={{fontSize: portrait ? 76 : 64, lineHeight: 1.23, fontWeight: 650, whiteSpace: 'pre-line', overflowWrap: 'anywhere', letterSpacing: -2}}>{scene.title}</div>
        {scene.body && <div style={{fontSize: 34, lineHeight: 1.65, marginTop: 36, color: '#aab9c8', whiteSpace: 'pre-line'}}>{scene.body}</div>}
        <div style={{display: 'flex', flexDirection: 'column', gap: 22, marginTop: 56}}>
          {scene.points.map((point, i) => <div key={i} style={{display: 'flex', gap: 24, alignItems: 'baseline', padding: '24px 28px', borderRadius: 18, background: '#ffffff07', border: '1px solid #ffffff10', fontSize: 34, lineHeight: 1.5}}><span style={{color: scene.accent, fontSize: 23}}>{String(i + 1).padStart(2, '0')}</span><span>{point}</span></div>)}
        </div>
      </div>
      {scene.visual && <SceneVisual visual={scene.visual} frame={local} fps={fps} duration={scene.end - scene.start} width={canvasWidth} height={canvasHeight} portrait={portrait} accent={scene.accent}/>}
      {caption && <div style={{position: 'absolute', left: 76, right: 76, bottom: 160, fontSize: 36, lineHeight: 1.6, textAlign: 'center', whiteSpace: 'pre-line', background: '#101720ee', padding: '20px 24px', borderRadius: 14}}>{caption.text}</div>}
      <div style={{position: 'absolute', bottom: 70, left: 76, right: 76, fontSize: 21, color: '#8293a4', display: 'flex', justifyContent: 'space-between'}}><span>{m.syntheticVoice ? 'AI 合成旁白' : 'AGENT MEDIA LAB'}</span><span>REMOTION</span></div>
    </div>
    <div style={{position: 'absolute', bottom: 0, height: Math.max(3, 5 * scale), background: scene.accent, width: `${100 * (frame + 1) / frameCount(m)}%`}}/>
  </AbsoluteFill>;
};
const defaults = manifestSchema.parse(example);
const Root = () => <Composition id="Timeline" component={Timeline} width={defaults.width} height={defaults.height} fps={defaults.fps} durationInFrames={frameCount(defaults)} defaultProps={{manifest: defaults}} calculateMetadata={({props}) => {
  const m = manifestSchema.parse(props.manifest);
  return {width: m.width, height: m.height, fps: m.fps, durationInFrames: frameCount(m), props: {manifest: m}};
}}/>;
registerRoot(Root);
