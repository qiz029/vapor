"""Export sentence captions tied to the exact final audio and narration revisions."""
import argparse
import json
import math
from pathlib import Path
import subprocess
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.video.job_store import atomic_json, sha256
from tools.project.workflow import register, ensure_check


def duration(path):
    info = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-of','json',str(path)]))
    return float(info['format']['duration'])


def validate_alignment(alignment, audio, narrations, seconds):
    if alignment.get('schemaVersion') != 1 or alignment.get('audioSha256') != sha256(audio):
        raise ValueError('Alignment does not belong to the final audio hash')
    segments = alignment['segments']
    if not segments:
        raise ValueError('No caption segments')
    seen, last = [], 0
    for segment in segments:
        a, b = segment['start'], segment['end']
        if any(type(x) not in (float, int) or not math.isfinite(x) for x in [a,b]) or not last <= a < b <= seconds + .001:
            raise ValueError('Caption overlaps or is outside final audio')
        ref = segment['narration']
        if ref not in narrations or segment['text'] != narrations[ref]:
            raise ValueError('Caption text differs from the current narration')
        if not segment.get('method'):
            raise ValueError('Alignment method/provenance is required')
        if len(segment['text']) > 240:
            raise ValueError('Split narration into sentence-sized entries before alignment')
        seen.append(ref)
        last = b
    if sorted(seen) != sorted(narrations):
        raise ValueError('Captions must cover every narration exactly once')
    return segments


def timestamp(seconds):
    milliseconds = round(seconds*1000)
    h, milliseconds = divmod(milliseconds, 3600000)
    m, milliseconds = divmod(milliseconds, 60000)
    s, milliseconds = divmod(milliseconds, 1000)
    return f'{h:02}:{m:02}:{s:02},{milliseconds:03}'


def export(project, audio, alignment_path, out, audio_asset, asset_id='final-captions'):
    project, audio, alignment_path, out = map(Path, [project,audio,alignment_path,out])
    doc = json.loads(project.read_text())
    audio_record = next((a for a in doc['assets'] if 'asset:'+a['id'] == audio_asset), None)
    if audio_record is None or audio_record['sha256'] != sha256(audio):
        raise ValueError('Register the exact final audio first')
    alignment = json.loads(alignment_path.read_text())
    segments = validate_alignment(alignment, audio, {n['id']:n['text'] for n in doc['narrations']}, duration(audio))
    out.mkdir(parents=True,exist_ok=False)
    captions = [{'start':s['start'],'end':s['end'],'text':s['text']} for s in segments]
    atomic_json(out/'captions.json', captions)
    (out/'captions.srt').write_text('\n\n'.join(f"{i+1}\n{timestamp(s['start'])} --> {timestamp(s['end'])}\n{s['text']}" for i,s in enumerate(segments))+'\n', encoding='utf-8')
    atomic_json(out/'alignment.json', alignment)
    deps = [audio_asset]+['narration:'+n['id'] for n in doc['narrations']]
    register(project,out/'alignment.json',asset_id+'-alignment','captions','video-production',deps,'Supplied sentence placement or externally aligned timing; final audio hash checked')
    for filename, suffix in [('captions.json',''),('captions.srt','-srt')]:
        register(project,out/filename,asset_id+suffix,'captions','video-production',['asset:'+asset_id+'-alignment'] if not suffix else ['asset:'+asset_id], 'Export from validated final-audio alignment')
    ensure_check(project, asset_id+'-alignment-check', 'Do caption text and timings match the final audio, including listening verification?', ['asset:'+asset_id, audio_asset])
    report={'schemaVersion':1,'audioSha256':sha256(audio),'captions':len(captions),'technical':'passed',
            'alignmentMethod':sorted({s['method'] for s in segments}),
            'listeningReview':'pending','wordAlignment':'not inferred from sentence boundaries'}
    atomic_json(out/'report.json',report)
    return report


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['project','audio','alignment','out']:
        p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--audio-asset',required=True)
    p.add_argument('--id',default='final-captions')
    a=p.parse_args()
    try:
        print(json.dumps(export(a.project,a.audio,a.alignment,a.out,a.audio_asset,a.id)))
    except (ValueError,OSError,KeyError,subprocess.CalledProcessError) as error:
        p.exit(1,str(error)+'\n')


if __name__=='__main__':
    main()
