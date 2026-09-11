"""Mux a clean picture master, the final mix and hash-bound selectable subtitles."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from tools.audio.timeline import verify
from tools.captions.align import validate_alignment, timestamp, duration
from tools.project.workflow import register, ensure_check
from tools.video.job_store import atomic_json, sha256


def finalize(project,picture,audio,alignment_path,out,picture_asset,audio_asset,asset_id='final',captions_asset=None):
    project,picture,audio,alignment_path,out=map(Path,[project,picture,audio,alignment_path,out])
    doc=json.loads(project.read_text())
    assets={'asset:'+a['id']:a for a in doc['assets']}
    for ref,path in [(picture_asset,picture),(audio_asset,audio)]:
        if ref not in assets or assets[ref]['sha256']!=sha256(path):
            raise ValueError('Register the exact picture and final mix before finalization')
    alignment=json.loads(alignment_path.read_text())
    seconds=duration(audio)
    segments=validate_alignment(alignment,audio,{n['id']:n['text'] for n in doc['narrations']},seconds)
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(picture)]))
    video=next(s for s in probe['streams'] if s['codec_type']=='video')
    if abs(float(video['duration'])-seconds)>.05:
        raise ValueError('Picture and final audio durations differ')
    out.mkdir(parents=True,exist_ok=False)
    srt=out/'captions.srt'
    srt.write_text('\n\n'.join(f"{i+1}\n{timestamp(s['start'])} --> {timestamp(s['end'])}\n{s['text']}" for i,s in enumerate(segments))+'\n')
    dest=out/'final.mp4'
    subprocess.run(['ffmpeg','-nostdin','-v','error','-n','-i',str(picture),'-i',str(audio),'-i',str(srt),
                    '-map','0:v:0','-map','1:a:0','-map','2:s:0','-c:v','copy','-c:a','aac','-b:a','192k',
                    '-c:s','mov_text','-disposition:s:0','default','-t',str(seconds),'-movflags','+faststart',str(dest)],check=True)
    audio_check=verify(dest,audio)
    subprocess.run(['ffmpeg','-nostdin','-v','error','-xerror','-i',str(dest),'-f','null','-'],check=True,capture_output=True)
    extracted=out/'exported-captions.srt'
    subprocess.run(['ffmpeg','-nostdin','-v','error','-n','-i',str(dest),'-map','0:s:0',str(extracted)],check=True)
    # Check text order and exact millisecond timings survived muxing.
    exported=extracted.read_text().replace('\r\n','\n')
    expected=srt.read_text().replace('\r\n','\n')
    if exported.strip()!=expected.strip():
        raise ValueError('Exported subtitle stream differs from final-audio alignment')
    register(project,alignment_path,asset_id+'-alignment','captions','video-production',
             [audio_asset]+['narration:'+n['id'] for n in doc['narrations']], 'Final audio hash-bound sentence alignment')
    if captions_asset:
        if captions_asset not in assets or assets[captions_asset]['sha256'] != sha256(srt):
            raise ValueError('Registered subtitle asset does not match final-audio alignment')
        caption_ref = captions_asset
    else:
        register(project,srt,asset_id+'-mux-captions','captions','video-production',['asset:'+asset_id+'-alignment'],'Selectable MP4 subtitle track')
        caption_ref = 'asset:'+asset_id+'-mux-captions'
    register(project,dest,asset_id,'video','video-production',[picture_asset,audio_asset,caption_ref],
             'Picture stream copied; final mix and selectable subtitles muxed')
    ensure_check(project, asset_id+'-playback', 'Do the final picture, audio and captions pass full audiovisual playback?', ['asset:'+asset_id])
    report={'schemaVersion':1,'artifactSha256':sha256(dest),'audio':audio_check,'subtitles':'round-trip passed',
            'subtitleMode':'selectable default mov_text; not burned into pixels','pictureReencoded':False,
            'fullDecode':'passed','visualReview':'pending','listeningReview':'pending','playbackReview':'pending'}
    atomic_json(out/'report.json',report)
    return report


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['project','picture','audio','alignment','out']:
        p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--picture-asset',required=True)
    p.add_argument('--audio-asset',required=True)
    p.add_argument('--id',default='final')
    p.add_argument('--captions-asset')
    a=p.parse_args()
    try:
        print(json.dumps(finalize(a.project,a.picture,a.audio,a.alignment,a.out,a.picture_asset,a.audio_asset,a.id,a.captions_asset)))
    except (ValueError,OSError,KeyError,subprocess.CalledProcessError) as error:
        p.exit(1,str(error)+'\n')


if __name__=='__main__':
    main()
