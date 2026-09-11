"""Offline preparation for the portable Vapor Modal plugin; never submits work."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import zipfile
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.gpu.vlm_prepare import pack
from tools.gpu.vlm_worker import MODEL, revision
from tools.video.job_store import atomic_json

MODEL_REVISION = '0c351dd01ed87e9c1b53cbc748cba10e6187ff3b'


def prepare(source, out):
    document = json.loads(source.read_text())
    # The host supplies registered immutable files and their expected hashes.
    for item in document['shots']:
        path = Path(item.get('image') or item['video'])
        if hashlib.sha256(path.read_bytes()).hexdigest() != item['registeredSha256']:
            raise ValueError('Registered source bytes changed')
    result = pack(source, out / 'frames.zip', document.get('frameCount', 8))
    with zipfile.ZipFile(out / 'frames.zip') as archive:
        shots = json.loads(archive.read('manifest.json'))['shots']
    sources = {s['id']: s for s in document['shots']}
    for item in shots:
        if item['sourceSha256'] != sources[item['id']]['registeredSha256']:
            raise ValueError('Source changed during preparation')
    result.update(model=MODEL, modelRevision=MODEL_REVISION, workerRevision=revision(),
                  inputSha256=hashlib.sha256((out / 'frames.zip').read_bytes()).hexdigest(),
                  app='agent-media-lab-vlm-v2', shots=[{
                      'id': s['id'], 'sourceRevisionId': sources[s['id']]['sourceRevisionId'],
                      'sourceSha256': s['sourceSha256'], 'kind': s.get('kind', 'video'),
                      'sampledSeconds': [] if s.get('kind') == 'image' else [f['seconds'] for f in s['frames']],
                      'question': s['expected'],
                      'range': None if s.get('kind') == 'image' else {
                          'start': sources[s['id']]['start'], 'end': sources[s['id']]['end']},
                  } for s in shots])
    atomic_json(out / 'preview.json', result)
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    print(json.dumps(prepare(a.source.resolve(), a.out.resolve()), ensure_ascii=False))
