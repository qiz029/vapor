"""Narration/music mixing with exact caption placement and measured delivery checks."""
import argparse
import json
import math
from pathlib import Path
import subprocess
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import numpy as np
import soundfile as sf
from tools.audio.timeline import assemble, read_audio
from tools.project.workflow import register, ensure_check
from tools.video.job_store import atomic_json, sha256


def inspect(audio, minimum_lufs=-24, maximum_lufs=-14):
    x,rate=sf.read(audio,always_2d=True)
    if not len(x) or not np.isfinite(x).all():
        raise ValueError('Empty/nonfinite audio')
    peak=float(np.max(np.abs(x)))
    rms=float(np.sqrt(np.mean(x*x)))
    process=subprocess.run(['ffmpeg','-nostdin','-hide_banner','-i',str(audio),'-af','loudnorm=I=-16:TP=-1:LRA=11:print_format=json',
                            '-f','null','-'],capture_output=True,text=True,check=True)
    start=process.stderr.rfind('{')
    loudness=json.loads(process.stderr[start:process.stderr.rfind('}')+1])
    # FFmpeg represents silence with -inf; preserve as null in JSON.
    measurements={key:float(loudness[key]) for key in ['input_i','input_tp','input_lra']}
    measurements={k:v if math.isfinite(v) else None for k,v in measurements.items()}
    problems=[]
    if peak>=1 or (measurements['input_tp'] is not None and measurements['input_tp']>=0):
        problems.append('clipping')
    if rms<1e-5:
        problems.append('silent_mix')
    integrated=measurements['input_i']
    warnings=[] if integrated is not None and minimum_lufs<=integrated<=maximum_lufs else ['integrated_loudness_outside_target']
    return {'schemaVersion':1,'audioSha256':sha256(audio),'duration':len(x)/rate,'sampleRate':rate,
            'channels':x.shape[1],'samplePeak':peak,'rms':rms,'loudness':measurements,
            'targetLUFS':[minimum_lufs,maximum_lufs],'failures':problems,'warnings':warnings,
            'status':'failed' if problems else 'passed','listeningReview':'pending'}


def mix(project, manifest_path, out, asset_id='final-mix'):
    project,manifest_path,out=map(Path,[project,manifest_path,out])
    doc=json.loads(project.read_text())
    plan=json.loads(manifest_path.read_text())
    duration=plan['duration'];rate=48000
    if not isinstance(duration,(int,float)) or not math.isfinite(duration) or not 0<duration<=3600:
        raise ValueError('Invalid mix duration')
    records={n['id']:n['text'] for n in doc['narrations']}
    clips=[]
    for clip in plan['narration']:
        clips.append(dict(clip,source=str((manifest_path.parent/clip['source']).resolve())))
    if sorted(c['narration'] for c in clips)!=sorted(records):
        raise ValueError('Mix must cover every narration exactly once')
    # Reject overlapping, truncated and out-of-bounds narration before writing outputs.
    voice=assemble(clips,duration,rate,2)
    mixed=voice.copy()
    speech=np.zeros(len(mixed),dtype=bool)
    segments=[]
    for c in clips:
        x=read_audio(c['source'],rate)
        if c.get('start',0)!=0 or abs(c.get('end',len(x)/rate)-len(x)/rate)>1/rate:
            raise ValueError('Sentence alignment requires the complete narration clip; use explicit external alignment for excerpts')
        a=round(c['at']*rate);b=a+len(x)
        speech[a:b]=True
        segments.append({'narration':c['narration'],'start':a/rate,'end':b/rate,'text':records[c['narration']],
                         'method':'exact placement of complete sentence audio; listening review pending'})
    segments.sort(key=lambda s:s['start'])
    music_sources=[]
    for track in plan.get('music',[]):
        path=(manifest_path.parent/track['source']).resolve()
        music=read_audio(path,rate)
        if music.shape[1]==1:
            music=np.repeat(music,2,axis=1)
        if music.shape[1]!=2:
            raise ValueError('Music must be mono or stereo')
        at=round(track.get('at',0)*rate)
        offset=round(track.get('start',0)*rate)
        length=round(track.get('duration',len(music)/rate-offset/rate)*rate)
        if at<0 or offset<0 or length<=0 or offset+length>len(music) or at+length>len(mixed):
            raise ValueError('Music outside source/timeline; specify explicit trim duration')
        gain=track.get('gainDB',-20);duck=track.get('duckDB',-12)
        if not all(isinstance(v,(int,float)) and math.isfinite(v) and -80<=v<=0 for v in [gain,duck]):
            raise ValueError('Music gains must be finite and between -80 and 0 dB')
        envelope=np.ones(length)*10**(gain/20)
        # Smooth the speech mask to avoid hard gain transitions; 50ms attack/release window.
        from scipy.ndimage import uniform_filter1d
        activity=uniform_filter1d(speech.astype(float),size=round(.1*rate),mode='nearest')[at:at+length]
        envelope*=10**(duck*activity/20)
        fade=track.get('fadeSeconds',.25)
        if not isinstance(fade,(int,float)) or not math.isfinite(fade) or fade<0:
            raise ValueError('Invalid fade')
        count=min(round(fade*rate),length//2)
        if count:
            envelope[:count]*=np.linspace(0,1,count)
            envelope[-count:]*=np.linspace(1,0,count)
        mixed[at:at+length]+=music[offset:offset+length]*envelope[:,None]
        music_sources.append(path)
    out.mkdir(parents=True,exist_ok=False)
    final=out/'mix.wav'
    sf.write(final,mixed,rate,subtype='FLOAT')
    report=inspect(final,plan.get('minimumLUFS',-24),plan.get('maximumLUFS',-14))
    atomic_json(out/'mix-check.json',report)
    if report['status']=='failed':
        raise ValueError('Mix failed technical checks; inspect mix-check.json')
    refs=[]
    for i,c in enumerate(clips):
        ref=asset_id+f'-voice-{i:03d}'
        register(project,Path(c['source']),ref,'narration','voice-production',['narration:'+c['narration']],
                 'Sentence audio supplied to mix manifest: '+str(manifest_path.resolve()))
        refs.append('asset:'+ref)
    for i,path in enumerate(music_sources):
        ref=asset_id+f'-music-{i:03d}'
        register(project,path,ref,'audio','media-assets',[], 'Music supplied to mix manifest: '+str(manifest_path.resolve()))
        refs.append('asset:'+ref)
    register(project,manifest_path,asset_id+'-plan','manifest','video-production',refs,'Mix placement/gain settings')
    register(project,final,asset_id,'audio','voice-production',['asset:'+asset_id+'-plan'],'Narration plus ducked/faded music; technical mix check passed')
    alignment={'schemaVersion':1,'audioSha256':sha256(final),'segments':segments}
    atomic_json(out/'alignment.json',alignment)
    register(project,out/'alignment.json',asset_id+'-alignment','captions','video-production',['asset:'+asset_id], 'Exact sentence placement on the final mixed audio')
    register(project,out/'mix-check.json',asset_id+'-check','report','video-production',['asset:'+asset_id],'Measured peak, LUFS and silence checks; listening pending')
    ensure_check(project, asset_id+'-delivery-check', 'Does the mix pass measured checks and remain intelligible throughout listening?', ['asset:'+asset_id])
    return report


def main():
    p=argparse.ArgumentParser(description=__doc__)
    s=p.add_subparsers(dest='command',required=True)
    m=s.add_parser('mix')
    m.add_argument('--project',type=Path,required=True)
    m.add_argument('--manifest',type=Path,required=True)
    m.add_argument('--id',default='final-mix')
    c=s.add_parser('check')
    c.add_argument('--audio',type=Path,required=True)
    for cmd in [m,c]:
        cmd.add_argument('--out',type=Path,required=True)
    a=p.parse_args()
    try:
        if a.out.exists():
            raise ValueError('Output exists')
        result=mix(a.project,a.manifest,a.out,a.id) if a.command=='mix' else inspect(a.audio)
        if a.command=='check':
            a.out.parent.mkdir(parents=True,exist_ok=True)
            atomic_json(a.out,result)
        print(json.dumps(result))
        if result['status']=='failed':
            p.exit(1)
    except (ValueError,OSError,KeyError,subprocess.CalledProcessError) as error:
        p.exit(1,str(error)+'\n')


if __name__=='__main__':
    main()
