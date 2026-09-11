import React from 'react';
import {Img, interpolate, staticFile} from 'remotion';
import type {Manifest} from '../schema';
type Visual = NonNullable<Manifest['scenes'][number]['visual']>;
function Icon({kind}: {kind: string}) {
  const common = {fill: 'none', stroke: 'currentColor', strokeWidth: 4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const};
  return <svg width="90" height="90" viewBox="0 0 100 100" {...common}>
    {kind === 'person' ? <><circle cx="50" cy="30" r="15"/><path d="M20 85v-8a30 30 0 0 1 60 0v8"/></> :
    kind === 'model' ? <><rect x="18" y="18" width="64" height="64" rx="16"/><path d="M35 40h30M35 60h30M40 5v13M60 5v13M40 82v13M60 82v13"/></> :
    kind === 'tool' ? <><path d="M65 15a23 23 0 0 0-28 28L15 65a14 14 0 0 0 20 20l22-22a23 23 0 0 0 28-28L68 52 48 32Z"/></> :
    <><ellipse cx="50" cy="22" rx="30" ry="12"/><path d="M20 22v56c0 16 60 16 60 0V22M20 50c0 16 60 16 60 0"/></>}
  </svg>;
}
export function SceneVisual({visual, frame, fps, duration, width, height, portrait, accent}: {
  visual: Visual; frame: number; fps: number; duration: number; width: number; height: number; portrait: boolean; accent: string;
}) {
  const top = portrait ? 460 : 330;
  const areaHeight = height - top - 320;
  if (visual.kind === 'image') return <div style={{position: 'absolute', left: 90, right: 90, top, height: areaHeight, overflow: 'hidden', borderRadius: 32}}>
    <Img src={staticFile(visual.src)} alt={visual.alt} style={{width: '100%', height: '100%', objectFit: visual.fit, scale: visual.motion === 'slow-zoom' ? interpolate(frame, [0, duration * fps], [1, 1.06], {extrapolateRight: 'clamp'}) : 1}}/>
  </div>;
  const nodeSize = portrait ? 150 : 160;
  const centers = visual.nodes.map((_, i) => portrait
    ? {x: width / 2, y: top + 110 + i * (areaHeight - 220) / (visual.nodes.length - 1)}
    : {x: 220 + i * (width - 440) / (visual.nodes.length - 1), y: top + areaHeight / 2 - 20});
  const seconds = frame / fps;
  const active = visual.steps.find(s => seconds >= s.at && seconds < s.at + s.duration);
  const last = [...visual.steps].reverse().find(s => seconds >= s.at);
  return <>
    <svg width={width} height={height} style={{position: 'absolute', inset: 0}}>
      {visual.steps.map((s, i) => {
        const a = centers[visual.nodes.findIndex(n => n.id === s.from)];
        const b = centers[visual.nodes.findIndex(n => n.id === s.to)];
        const progress = Math.max(0, Math.min(1, (seconds - s.at) / s.duration));
        return <g key={i}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffffff12" strokeWidth="4"/>
          {seconds >= s.at && <line x1={a.x} y1={a.y} x2={a.x + (b.x-a.x)*progress} y2={a.y + (b.y-a.y)*progress} stroke={accent} strokeOpacity={active === s ? 1 : .25} strokeWidth="5"/>}
          {active === s && <circle cx={a.x+(b.x-a.x)*progress} cy={a.y+(b.y-a.y)*progress} r="17" fill="#ffcf78" stroke="#fff3d5" strokeWidth="4"/>}
        </g>;
      })}
    </svg>
    {visual.nodes.map((n, i) => <div key={n.id} style={{position: 'absolute', left: centers[i].x-nodeSize/2, top: centers[i].y-nodeSize/2, width: nodeSize, height: nodeSize, borderRadius: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#192a35', border: `3px solid ${active?.from === n.id || active?.to === n.id ? accent : '#405260'}`, color: accent}}>
      <Icon kind={n.icon}/><div style={{position: 'absolute', ...(portrait ? {left: nodeSize+32, top: 48, width: 230} : {top: nodeSize+24, left: -50, width: nodeSize+100}), fontSize: 36, textAlign: portrait ? 'left' : 'center', color: '#f4f6f8'}}>{n.label}</div>
    </div>)}
    {last && <div style={{position: 'absolute', left: 90, top: portrait ? height-315 : top-18, fontSize: 30, color: '#ffcf78'}}>{String(visual.steps.indexOf(last)+1).padStart(2,'0')} · {last.label}</div>}
  </>;
}
