"""Project-local EDL adapter for pinned video-use; offline unless transcription is requested separately."""
import argparse
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[3]))
import numpy as np
import soundfile as sf
from tools.video.editing.common import asset, probe, upstream, ROOT
from tools.video.job_store import atomic_json, sha256
from tools.project.workflow import register, ensure_check
from tools.project.project import snapshot
from tools.audio.timeline import verify
from tools.captions.align import timestamp


def number(value):
    return type(value) in (int,float) and math.isfinite(value)


def resolve(project,edl):
    if set(edl)-{'schemaVersion','id','fps','sources','ranges','grade','overlays','subtitleMode','subtitleFont'} or edl.get('schemaVersion')!=1:
        raise ValueError('Invalid EDL schema')
    if not re.fullmatch(r'[A-Za-z0-9_-]+',edl['id']):
        raise ValueError('Unsafe edit ID')
    if type(edl['fps']) is not int or not 1<=edl['fps']<=60:
        raise ValueError('fps must be an integer from 1 to 60')
    if 'subtitleFont' in edl and (not isinstance(edl['subtitleFont'],str) or not re.fullmatch(r'[\w -]{1,80}',edl['subtitleFont'])):
        raise ValueError('subtitleFont must be a plain font family name')
    if edl.get('subtitleMode','soft') not in ['none','soft','burn']:
        raise ValueError('Unknown subtitleMode')
    if not edl['sources'] or not edl['ranges']:
        raise ValueError('EDL needs sources and ranges')
    sources={};dependencies=[];aspects=set()
    for name,item in edl['sources'].items():
        if not re.fullmatch(r'[A-Za-z0-9_-]+',name) or set(item)-{'asset','speech','transcript','audioTrack'}:
            raise ValueError('Invalid source fields or alias')
        if type(item.get('speech',False)) is not bool:
            raise ValueError('speech must be a boolean')
        path,record=asset(project,item['asset']);info=probe(path)
        video=next((s for s in info['streams'] if s['codec_type']=='video'),None)
        if video is None:
            raise ValueError('Source must contain video')
        width,height=video['width'],video['height']
        rotation=next((s.get('rotation',0) for s in video.get('side_data_list',[]) if 'rotation' in s),0)
        if round(rotation)%180:
            width,height=height,width
        aspects.add(round(width/height,3))
        tracks=[s for s in info['streams'] if s['codec_type']=='audio']
        track=item.get('audioTrack',0)
        if type(track) is not int or track<0 or (tracks and track>=len(tracks)):
            raise ValueError('Invalid audioTrack')
        transcript=None
        dependencies.append(item['asset'])
        if item.get('transcript'):
            tr_path,_=asset(project,item['transcript']);transcript=json.loads(tr_path.read_text())
            if transcript.get('sourceSha256')!=record['sha256'] or transcript.get('audioTrack',0)!=track:
                raise ValueError('Transcript belongs to different source bytes or audio track')
            dependencies.append(item['transcript'])
            validate_words(transcript,float(video.get('duration',info['format']['duration'])))
        if item.get('speech') and (not tracks or transcript is None):
            raise ValueError('Speech edits require an audio track and source-bound word transcript')
        sources[name]={'path':path,'info':info,'video':video,'transcript':transcript,'track':track,'hasAudio':bool(tracks)}
    if len(aspects)!=1:
        raise ValueError('Mixed aspect ratios: normalize source canvases explicitly before editing')
    cursor=0;cuts=[];captions=[]
    for r in edl['ranges']:
        if set(r)-{'source','start','end','reason'} or not isinstance(r.get('reason'),str) or not r['reason'].strip():
            raise ValueError('Every cut needs a source range and editorial reason')
        if r['source'] not in sources:
            raise ValueError('Unknown cut source')
        source=sources[r['source']];start,end=r['start'],r['end']
        duration=float(source['video'].get('duration',source['info']['format']['duration']))
        if not number(start) or not number(end) or not 0<=start<end<=duration+.0001:
            raise ValueError('Cut outside source bounds')
        frames=round((end-start)*edl['fps'])
        if frames<2 or abs(frames/edl['fps']-(end-start))>1e-6:
            raise ValueError('Cut duration must span at least two whole output frames')
        words=(source['transcript'] or {}).get('words',[])
        for word in words:
            if word['type']!='word':
                continue
            a,b=word['start'],word['end']
            if any(a+1e-6<edge<b-1e-6 for edge in [start,end]):
                raise ValueError('Cut splits a spoken word; move the boundary into the surrounding gap')
            if a>=start and b<=end:
                captions.append({'start':cursor+a-start,'end':cursor+b-start,'text':word['text']})
        cuts.append(dict(r,outputStart=cursor,outputEnd=cursor+frames/edl['fps']))
        cursor+=frames/edl['fps']
    overlays=[]
    for item in edl.get('overlays',[]):
        if set(item)!={'asset','start','duration'}:
            raise ValueError('Invalid overlay fields')
        path,_=asset(project,item['asset']);info=probe(path)
        video=next((s for s in info['streams'] if s['codec_type']=='video'),None)
        if video is None or not all(number(item[k]) for k in ['start','duration']) or not 0<=item['start']<item['start']+item['duration']<=cursor:
            raise ValueError('Overlay outside output timeline')
        if item['duration']>float(video.get('duration',info['format']['duration']))+.001:
            raise ValueError('Overlay is shorter than its window')
        overlays.append({'file':str(path),'start_in_output':item['start'],'duration':item['duration']})
        dependencies.append(item['asset'])
    # Raw filter strings are not accepted at this boundary; use upstream supported grade presets.
    if edl.get('grade','none') not in ['none','subtle','neutral_punch','warm_cinematic','auto']:
        raise ValueError('Unknown grade preset')
    return {'sources':sources,'cuts':cuts,'captions':captions,'duration':cursor,'overlays':overlays,'dependencies':sorted(set(dependencies))}


def validate_words(transcript,duration):
    if not isinstance(transcript.get('words'),list):
        raise ValueError('Transcript needs words')
    for w in transcript['words']:
        if w.get('type') not in ['word','spacing','audio_event']:
            raise ValueError('Unknown transcript token type')
        if not all(number(w.get(k)) for k in ['start','end']) or not 0<=w['start']<=w['end']<=duration+.001 or (w['type']=='word' and w['start']==w['end']):
            raise ValueError('Invalid transcript timing')
        if not isinstance(w.get('text'),str):
            raise ValueError('Invalid transcript text')


def write_srt(captions,path):
    # Preserve supplied language/case; the project adapter does not force English uppercase.
    path.write_text('\n\n'.join(f"{i+1}\n{timestamp(c['start'])} --> {timestamp(c['end'])}\n{c['text']}" for i,c in enumerate(captions))+'\n')


def render(project,edl_path,out,draft=False):
    project,edl_path,out=map(lambda p:Path(p).resolve(),[project,edl_path,out])
    edl=json.loads(edl_path.read_text());resolved=resolve(project,edl)
    mode=edl.get('subtitleMode','soft')
    if mode=='burn' and resolved['captions']:
        filters=subprocess.check_output(['ffmpeg','-hide_banner','-filters'],stderr=subprocess.DEVNULL,text=True)
        if not re.search(r'\bsubtitles\s',filters):
            raise ValueError('FFmpeg lacks libass subtitles filter; use soft subtitles or a libass-enabled build')
    engine=upstream('render');started=time.monotonic()
    subtitle_font=edl.get('subtitleFont')
    if subtitle_font is None and sys.platform=='darwin' and Path('/System/Library/Fonts/STHeiti Light.ttc').is_file() and any(re.search(r'[\u3400-\u9fff]',c['text']) for c in resolved['captions']):
        subtitle_font='Heiti SC'
    if subtitle_font:
        engine.SUB_FORCE_STYLE=re.sub(r'FontName=[^,]*','FontName='+subtitle_font,engine.SUB_FORCE_STYLE)
    out.mkdir(parents=True,exist_ok=False)
    try:
        atomic_json(out/'edl.json',edl)
        atomic_json(out/'cuts.json',resolved['cuts'])
        register(project,out/'edl.json',edl['id']+'-edl','manifest','video-editing',resolved['dependencies'],'Source ranges and editorial decisions')
        before=snapshot(json.loads(project.read_text()),project.parent)
        # Upstream concat embeds paths in a text format. Stage under safe temporary names.
        with tempfile.TemporaryDirectory(prefix='video-use-') as temp:
            stage=Path(temp);segments=[];chunks=[];rate=48000
            for i,cut in enumerate(resolved['cuts']):
                source=resolved['sources'][cut['source']];duration=cut['outputEnd']-cut['outputStart']
                expected_frames=round(duration*edl['fps'])
                clip=stage/f'segment-{i:03d}.mp4'
                grade=engine.resolve_grade_filter(edl.get('grade','none'))
                if grade=='__AUTO__':
                    grade,_=engine.auto_grade_for_clip(source['path'],start=cut['start'],duration=duration,verbose=False)
                engine.extract_segment(source['path'],cut['start'],duration,grade,clip,preview=False,draft=draft,rate=str(edl['fps']))
                picture=stage/f'picture-{i:03d}.mp4'
                # `-t` extraction can include a boundary packet when a fractional
                # frame duration is rounded by ffmpeg. Cap every picture segment
                # to the EDL's exact whole-frame count before lossless concat.
                subprocess.run(['ffmpeg','-nostdin','-v','error','-n','-i',str(clip),'-map','0:v:0',
                                '-frames:v',str(expected_frames),'-c:v','copy','-an',str(picture)],check=True)
                picture_stream=next(s for s in probe(picture)['streams'] if s['codec_type']=='video')
                actual=float(picture_stream['duration'])
                if int(picture_stream['nb_frames'])!=expected_frames:
                    raise ValueError(f"Extracted picture frame count differs from cut {i} ({cut['source']}): expected {expected_frames}, got {picture_stream['nb_frames']}")
                if abs(actual-duration)>1/edl['fps']+.001:
                    raise ValueError('Extracted picture duration differs from cut')
                segments.append(picture)
                count=round(duration*rate)
                if source['hasAudio']:
                    raw=subprocess.check_output(['ffmpeg','-nostdin','-v','error','-ss',str(cut['start']),'-i',str(source['path']),'-t',str(duration),
                        '-map',f"0:a:{source['track']}",'-ac','2','-ar',str(rate),'-f','f32le','-'])
                    audio=np.frombuffer(raw,dtype='<f4').reshape(-1,2).copy()
                    if len(audio)<count-1024:
                        raise ValueError('Source audio ends before the selected cut')
                    audio=np.pad(audio,((0,max(0,count-len(audio))),(0,0)))[:count]
                else:
                    audio=np.zeros((count,2))
                fade=min(round(.03*rate),count//2)
                audio[:fade]*=np.linspace(0,1,fade)[:,None];audio[-fade:]*=np.linspace(1,0,fade)[:,None]
                chunks.append(audio)
            # Picture-only concat avoids AAC padding moving every following cut.
            engine.concat_segments(segments,stage/'picture.mp4',stage)
            sf.write(out/'edit-mix.wav',np.concatenate(chunks),rate,subtype='FLOAT')
            subprocess.run(['ffmpeg','-nostdin','-v','error','-n','-i',str(stage/'picture.mp4'),'-i',str(out/'edit-mix.wav'),
                '-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-t',str(resolved['duration']),str(stage/'base.mp4')],check=True)
            staged_overlays=[]
            for i,ov in enumerate(resolved['overlays']):
                dest=stage/(f'overlay-{i}'+Path(ov['file']).suffix)
                subprocess.run(['ffmpeg','-nostdin','-v','error','-n','-i',ov['file'],'-t',str(ov['duration']),
                                '-map','0:v:0','-an','-c:v','copy',str(dest)],check=True)
                staged_overlays.append(dict(ov,file=str(dest)))
            subs=stage/'captions.srt'
            write_srt(resolved['captions'],subs)
            shutil.copyfile(subs,out/'captions.srt')
            if staged_overlays or (mode=='burn' and resolved['captions']):
                engine.build_final_composite(stage/'base.mp4',staged_overlays,subs if mode=='burn' else None,
                                             stage/'composite.mp4',stage)
            else:
                shutil.copyfile(stage/'base.mp4',stage/'composite.mp4')
            final=out/'final.mp4'
            if mode=='soft' and resolved['captions']:
                subprocess.run(['ffmpeg','-nostdin','-v','error','-n','-i',str(stage/'composite.mp4'),'-i',str(subs),'-map','0:v:0','-map','0:a:0','-map','1:s:0',
                    '-c:v','copy','-c:a','copy','-c:s','mov_text','-disposition:s:0','default','-movflags','+faststart',str(final)],check=True)
            else:
                shutil.copyfile(stage/'composite.mp4',final)
        audio_check=verify(final,out/'edit-mix.wav')
        subtitle_check='not-present' if mode=='none' or not resolved['captions'] else 'burned; visual review pending'
        if mode=='soft' and resolved['captions']:
            extracted=subprocess.check_output(['ffmpeg','-nostdin','-v','error','-i',str(final),'-map','0:s:0','-f','srt','-'],text=True)
            if extracted.replace('\r\n','\n').strip()!=(out/'captions.srt').read_text().strip():
                raise ValueError('Exported subtitles differ from output-timeline timestamps')
            subtitle_check='round-trip passed'
        info=probe(final);v=next(s for s in info['streams'] if s['codec_type']=='video')
        if int(v['nb_frames'])!=round(resolved['duration']*edl['fps']):
            raise ValueError('Final frame count differs from EDL')
        subprocess.run(['ffmpeg','-nostdin','-v','error','-xerror','-i',str(final),'-f','null','-'],check=True,capture_output=True)
        current=snapshot(json.loads(project.read_text()),project.parent)
        if current['nodes']['asset:'+edl['id']+'-edl']['revision']!=before['nodes']['asset:'+edl['id']+'-edl']['revision']:
            raise ValueError('Inputs changed during editing; output needs rebuilding')
        register(project,out/'edit-mix.wav',edl['id']+'-audio','audio','video-editing',['asset:'+edl['id']+'-edl'],'Selected source audio with 30ms cut-edge fades; missing source audio filled with silence')
        register(project,out/'captions.srt',edl['id']+'-captions','captions','video-editing',['asset:'+edl['id']+'-edl'],'Word timestamps remapped to edited output timeline')
        register(project,final,edl['id'],'video','video-editing',['asset:'+edl['id']+'-edl','asset:'+edl['id']+'-audio','asset:'+edl['id']+'-captions'],'Pinned video-use edit with project audio and dependency adapter')
        atomic_json(out/'transcript.json',{'sourceSha256':sha256(final),'audioTrack':0,
            'words':[dict(c,type='word') for c in resolved['captions']], 'provenance':'Source transcript words remapped through EDL; no new ASR call'})
        register(project,out/'transcript.json',edl['id']+'-transcript','transcript','video-editing',['asset:'+edl['id']],'Edited-output transcript for cut evidence')
        ensure_check(project,edl['id']+'-cut-review','Are cuts, speech boundaries, overlays and captions correct across every cut and full playback?', ['asset:'+edl['id']])
        report={'schemaVersion':1,'upstreamCommit':json.loads((ROOT/'skills/upstream-lock.json').read_text())['video-use']['commit'],
            'artifactSha256':sha256(final),'duration':float(v['duration']),'frames':int(v['nb_frames']),'audio':audio_check,'fullDecode':'passed',
            'cuts':[c['outputStart'] for c in resolved['cuts'][1:]],'subtitleMode':mode,'elapsedSeconds':time.monotonic()-started,
            'subtitles':subtitle_check,'subtitleFont':subtitle_font or 'Helvetica',
            'ffmpegVersion':subprocess.check_output(['ffmpeg','-version'],text=True).splitlines()[0],'silentSources':[name for name,s in resolved['sources'].items() if not s['hasAudio']],
            'visualReview':'pending','listeningReview':'pending','playbackReview':'pending','cloudCalls':0}
        atomic_json(out/'report.json',report)
        return report
    except Exception as error:
        atomic_json(out/'failure.json',{'error':str(error),'review':'incomplete'})
        raise


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('command',choices=['validate','render','view'])
    p.add_argument('--project',type=Path,required=True)
    p.add_argument('--edl',type=Path)
    p.add_argument('--out',type=Path)
    p.add_argument('--draft',action='store_true')
    p.add_argument('--asset');p.add_argument('--start',type=float);p.add_argument('--end',type=float)
    p.add_argument('--transcript',help='Registered transcript asset for word labels and audio track selection')
    a=p.parse_args()
    try:
        if a.command=='view':
            if not a.asset or a.start is None or a.end is None or not a.out:
                raise ValueError('view needs --asset --start --end --out')
            path,record=asset(a.project,a.asset);info=probe(path)
            seconds=float(info['format']['duration'])
            if not all(number(v) for v in [a.start,a.end]) or not 0<=a.start<a.end<=seconds:
                raise ValueError('Invalid view range')
            a.out.mkdir(parents=True,exist_ok=False)
            end=min(a.end,seconds-.05)
            if end<=a.start:
                raise ValueError('Range too short at end of video')
            helper=upstream('timeline_view')
            tr_path=None;track=0
            if a.transcript:
                tr_path,_=asset(a.project,a.transcript);tr=json.loads(tr_path.read_text())
                if tr.get('sourceSha256')!=record['sha256']:
                    raise ValueError('Transcript belongs to different source bytes')
                track=tr.get('audioTrack',0)
            from tools.video.editing.evidence import compute_envelope
            helper.compute_envelope=lambda video,start,end,samples=2000: compute_envelope(video,start,end,samples,track)
            helper.render_timeline(video=path,start=a.start,end=end,out_path=a.out/'timeline.png',n_frames=5,transcript=tr_path)
            atomic_json(a.out/'evidence.json',{'asset':a.asset,'sha256':record['sha256'],'sourceRange':[a.start,end],'review':'not_checked'})
            return
        if not a.edl:
            raise ValueError('--edl required')
        if a.command=='validate':
            r=resolve(a.project,json.loads(a.edl.read_text()));print(json.dumps({'valid':True,'duration':r['duration'],'cuts':len(r['cuts']),'captionWords':len(r['captions'])}))
        else:
            if not a.out:
                raise ValueError('--out required')
            print(json.dumps(render(a.project,a.edl,a.out,a.draft)))
    except (ValueError,OSError,KeyError,subprocess.CalledProcessError) as error:
        p.exit(1,str(error)+'\n')


if __name__=='__main__':
    main()
