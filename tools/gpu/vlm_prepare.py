"""Prepare a bounded Qwen review ZIP from explicitly listed local video ranges.

Manifest: {"shots":[{"id":"shot1","video":"clip.mp4","start":0,"end":5,
"expected":"Visible action to inspect","reference":"storyboard.png"}]}
Paths are relative to the input manifest; reference is optional. No cloud calls.
"""
import argparse
import hashlib
import io
import json
import math
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.gpu.vlm_worker import MAX_ARCHIVE, unpack, revision


def pack(manifest_path, output, frame_count=8):
    if output.exists():
        raise ValueError('Output already exists')
    if not 2 <= frame_count <= 12:
        raise ValueError('Use 2..12 frames per shot')
    document = json.loads(manifest_path.read_text())
    shots = document['shots']
    if not 1 <= len(shots) <= 40:
        raise ValueError('Use 1..40 shots; split large reviews into batches')
    archive = io.BytesIO()
    packed = []
    with tempfile.TemporaryDirectory(prefix='vlm-frames-') as tmp, zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for shot in shots:
            jid = shot['id']
            if not re.fullmatch(r'[A-Za-z0-9_-]+', jid):
                raise ValueError('Invalid shot ID')
            if shot.get('image'):
                if shot.get('video') or 'start' in shot or 'end' in shot:
                    raise ValueError('Still image cannot carry a video range')
                from PIL import Image
                path = (manifest_path.parent / shot['image']).resolve()
                original = path.read_bytes()
                with Image.open(io.BytesIO(original)) as image:
                    image = image.convert('RGB'); image.thumbnail((672,672))
                    buf = io.BytesIO(); image.save(buf, format='JPEG', quality=90)
                name = f'{jid}-image.jpg'
                z.writestr(name, buf.getvalue())
                packed.append({'id':jid,'kind':'image','sourceSha256':hashlib.sha256(original).hexdigest(),
                               'frames':[{'file':name}], 'expected':shot['expected'],
                               'neighbours':shot.get('neighbours','')})
                continue
            video = (manifest_path.parent / shot['video']).resolve()
            probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(video)]))
            duration = float(probe['format']['duration'])
            if not any(s['codec_type'] == 'video' for s in probe['streams']):
                raise ValueError('Input has no video')
            start, end = shot.get('start', 0), shot.get('end', duration)
            if any(type(t) not in (int, float) or not math.isfinite(t) for t in [start, end]) or not 0 <= start < end <= duration:
                raise ValueError('Invalid video range')
            if end - start < .05:
                raise ValueError('Range too short')
            # Stay inside the last decodable interval; labels are requested source times.
            last = end - min(.1, (end-start)/4)
            times = [round(start + (last-start)*i/(frame_count-1), 3) for i in range(frame_count)]
            frames = []
            for i, seconds in enumerate(times):
                name = f'{jid}-{i}.jpg'; path = Path(tmp)/name
                subprocess.run(['ffmpeg','-nostdin','-v','error','-ss',str(seconds),'-i',str(video),
                                '-frames:v','1','-vf',"scale=672:672:force_original_aspect_ratio=decrease",'-q:v','3',str(path)],check=True,capture_output=True)
                z.writestr(name, path.read_bytes()); frames.append({'file':name,'seconds':seconds})
            ref_name = f'{jid}-ref.jpg'
            if shot.get('reference'):
                from PIL import Image
                with Image.open(manifest_path.parent / shot['reference']) as image:
                    image = image.convert('RGB'); image.thumbnail((672,672))
                    buf = io.BytesIO(); image.save(buf, format='JPEG', quality=90)
                    reference = buf.getvalue()
            else:
                reference = (Path(tmp)/frames[0]['file']).read_bytes()
            z.writestr(ref_name, reference)
            h = hashlib.sha256()
            with video.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024*1024), b''): h.update(chunk)
            packed.append({'id':jid,'sourceSha256':h.hexdigest(),'reference':ref_name,'frames':frames,
                           'expected':shot['expected'],'neighbours':shot.get('neighbours','')})
        z.writestr('manifest.json', json.dumps({'shots':packed},ensure_ascii=False))
    data = archive.getvalue()
    if len(data) > MAX_ARCHIVE: raise ValueError('Batch exceeds 48 MiB')
    unpack({'inputSha256':hashlib.sha256(data).hexdigest(),'workerRevision':revision(),
            'modelRevision':'0'*40,'key':'0'*64}, data)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('xb') as stream: stream.write(data)
    return {'file':str(output),'shots':len(packed),'uploadBytes':len(data),
            'modality':'images-and-video-samples','audioIncluded':False,
            'timestampMeaning':'requested source seek times, rounded to milliseconds; not exact decoded frame PTS',
            'fullPlaybackReviewed':False}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--frames',type=int,default=8)
    a=p.parse_args();print(json.dumps(pack(a.manifest.resolve(),a.out,a.frames),ensure_ascii=False))
if __name__=='__main__':main()
