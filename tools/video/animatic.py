"""Build a complete timing pilot with offline rough speech and Remotion placeholders."""
import argparse
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np
import soundfile as sf
from tools.audio.timeline import read_audio
from tools.project.project import validate
from tools.project.workflow import register, ensure_check
from tools.video.job_store import atomic_json, sha256

ROOT = Path(__file__).resolve().parents[2]


def build(project, plan_path, out, render=True):
    project, plan_path, out = Path(project).resolve(), Path(plan_path).resolve(), Path(out).resolve()
    doc = json.loads(project.read_text())
    validate(doc)
    plan = json.loads(plan_path.read_text())
    narrations = {n['id']: n for n in doc['narrations']}
    shots = {s['id']: s for s in doc['shots']}
    beats = plan['beats']
    if not beats or sorted(b['narration'] for b in beats) != sorted(narrations):
        raise ValueError('Animatic must cover every narration exactly once')
    fps = plan.get('fps', 30)
    if type(fps) is not int or not 1 <= fps <= 60:
        raise ValueError('Invalid fps')
    prefix = plan.get('id', 'animatic')
    import re
    if not re.fullmatch(r'[A-Za-z0-9_-]+', prefix):
        raise ValueError('Invalid animatic ID')
    for beat in beats:
        if beat['shot'] not in shots or f"narration:{beat['narration']}" not in shots[beat['shot']]['dependsOn']:
            raise ValueError('Beat must link its narration to its shot')
        text = narrations[beat['narration']]['text']
        if not text.strip() or len(text) > 240:
            raise ValueError('Use sentence-sized narration entries of at most 240 characters')
        hold = beat.get('hold', .4)
        if not isinstance(hold, (int, float)) or not math.isfinite(hold) or hold < 0:
            raise ValueError('Invalid beat hold')
    out.mkdir(parents=True, exist_ok=False)
    atomic_json(out/'plan.json', plan)
    register(project, out/'plan.json', prefix+'-plan', 'manifest', 'video-production',
             [f"shot:{b['shot']}" for b in beats], f'Animatic plan: {plan_path}')
    voice_config = {'engine': 'supplied-or-macos-say', 'voice': plan.get('voice'), 'wordsPerMinute': plan.get('wordsPerMinute', 175)}
    atomic_json(out/'voice-config.json', voice_config)
    register(project, out/'voice-config.json', prefix+'-voice-config', 'config', 'voice-production', [], 'Offline rough speech configuration')
    rate = 48000
    chunks, scenes, captions, alignments, audio_refs, visual_refs = [], [], [], [], [], []
    cursor = 0
    for index, beat in enumerate(beats):
        text = narrations[beat['narration']]['text']
        wav = out/f'voice-{index:03d}.wav'
        if beat.get('audio'):
            source = (plan_path.parent/beat['audio']).resolve()
            subprocess.run(['ffmpeg','-nostdin','-v','error','-n','-i',str(source),'-ar',str(rate),'-ac','2',str(wav)], check=True)
            origin = f'Supplied rough speech: {source}; sha256={sha256(source)}'
        else:
            if not shutil.which('say'):
                raise ValueError('No offline say tool; supply an audio path for each beat')
            text_path = out/f'voice-{index:03d}.txt'
            text_path.write_text(text)
            aiff = out/f'voice-{index:03d}.aiff'
            command = ['say', '-r', str(plan.get('wordsPerMinute',175)), '-f', str(text_path), '-o', str(aiff)]
            if plan.get('voice'):
                command += ['-v', plan['voice']]
            subprocess.run(command, check=True)
            subprocess.run(['ffmpeg','-nostdin','-v','error','-n','-i',str(aiff),'-ar',str(rate),'-ac','2',str(wav)], check=True)
            origin = 'Local macOS say rough synthetic narration; not final voice'
        audio = read_audio(wav, rate)
        if audio.shape[1] == 1:
            audio = np.repeat(audio, 2, axis=1)
        if not len(audio) or not np.isfinite(audio).all() or np.max(np.abs(audio)) < 1e-5:
            raise ValueError('Rough speech is empty or silent; verify local speech service or supply audio')
        duration = len(audio)/rate
        frames = math.ceil((duration + beat.get('hold', .4))*fps)
        end = cursor + frames/fps
        padded = np.zeros((round(frames/fps*rate), 2))
        padded[:len(audio)] = audio
        chunks.append(padded)
        scene = {'start':cursor, 'end':end, 'title':shots[beat['shot']]['intent'][:100],
                 'body': 'ANIMATIC · Rough timing / placeholder shot', 'points': []}
        if beat.get('image'):
            image = (plan_path.parent/beat['image']).resolve()
            copied = out/f'image-{index:03d}{image.suffix}'
            shutil.copyfile(image, copied)
            scene['visual'] = {'kind':'image','src':str(copied),'alt':shots[beat['shot']]['visual'], 'fit':'contain','motion':'still'}
            ref = prefix+f'-image-{index:03d}'
            register(project, copied, ref, 'image', 'media-assets', [], f'Storyboard reference: {image}; sha256={sha256(image)}')
            visual_refs.append('asset:'+ref)
        scenes.append(scene)
        captions.append({'start':cursor, 'end':cursor+duration, 'text':text})
        alignments.append({'narration':beat['narration'], 'start':cursor, 'end':cursor+duration, 'text':text,
                           'method':'exact placement of a separately synthesized/supplied sentence; internal word alignment not inferred'})
        ref = prefix+f'-voice-{index:03d}'
        register(project, wav, ref, 'narration', 'voice-production', [f"narration:{beat['narration']}", 'asset:'+prefix+'-voice-config'], origin)
        audio_refs.append('asset:'+ref)
        cursor = end
    mix = out/'rough-mix.wav'
    sf.write(mix, np.concatenate(chunks), rate, subtype='PCM_24')
    register(project, mix, prefix+'-mix', 'audio', 'voice-production', audio_refs+['asset:'+prefix+'-plan'], 'Sample-positioned rough narration with beat holds')
    manifest = {'schemaVersion':1,'title':doc['project']['title'][:100], 'width':plan.get('width',1280),
                'height':plan.get('height',720),'fps':fps,'duration':cursor,'audio':str(mix),'syntheticVoice':True,
                'scenes':scenes,'captions':captions}
    atomic_json(out/'manifest.json', manifest)
    atomic_json(out/'alignment.json', {'schemaVersion':1,'audioSha256':sha256(mix),'segments':alignments})
    register(project, out/'alignment.json', prefix+'-alignment', 'captions', 'video-production',
             ['asset:'+prefix+'-mix']+[f"narration:{b['narration']}" for b in beats], 'Sentence-level rough audio placement')
    register(project, out/'manifest.json', prefix+'-timeline', 'manifest', 'video-production',
             ['asset:'+prefix+'-mix','asset:'+prefix+'-alignment','asset:'+prefix+'-plan']+visual_refs, 'Remotion animatic timeline')
    renderer = [os.environ.get('VAPOR_NODE', 'node'), '--import', 'tsx', str(ROOT/'tools/video/remotion/cli.ts')]
    subprocess.run([*renderer,'validate','--manifest',str(out/'manifest.json')],cwd=ROOT,check=True)
    if render:
        subprocess.run([*renderer,'render','--manifest',str(out/'manifest.json'),'--out',str(out/'render')],cwd=ROOT,check=True)
        register(project, out/'render/final.mp4', prefix, 'animatic', 'video-production',
                 ['asset:'+prefix+'-timeline'], 'Complete Remotion rough timing pilot; playback approval pending')
    if render:
        ensure_check(project, prefix+'-playback', 'Has the complete rough pilot been watched with audio and its pacing accepted?', ['asset:'+prefix])
    report = {'schemaVersion':1,'duration':cursor,'beats':len(beats),'speech':'rough', 'rendered':render,
              'visualReview':'pending','listeningReview':'pending','playbackReview':'pending',
              'paidGeneration':False,'target':'asset:'+prefix}
    atomic_json(out/'animatic-report.json', report)
    return report


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--project',type=Path,required=True)
    p.add_argument('--plan',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    p.add_argument('--prepare-only',action='store_true')
    a=p.parse_args()
    existed = a.out.exists()
    try:
        print(json.dumps(build(a.project,a.plan,a.out,not a.prepare_only),ensure_ascii=False))
    except (ValueError,OSError,KeyError,subprocess.CalledProcessError) as error:
        if not existed and a.out.exists() and not isinstance(error, FileExistsError):
            atomic_json(a.out/'animatic-failure.json',{'error':str(error),'review':'incomplete'})
        p.exit(1,str(error)+'\n')


if __name__=='__main__':
    main()
