"""Viggle V1: offline plans, single-character remix and GLB motion extraction."""
import argparse
from contextlib import ExitStack
import datetime as dt
import hashlib
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
from urllib.parse import urlparse
import uuid
import requests

ROOT = Path(__file__).resolve().parents[2]
ORIGIN = 'https://apis.viggle.ai'
PRICE_DATE = '2026-09-07'
PRICE_EXPIRY = '2026-09-14'


def save(path, value):
    temp = path.with_suffix('.tmp')
    with temp.open('w') as f:
        json.dump(value, f, indent=2, ensure_ascii=False)
        f.write('\n'); f.flush(); os.fsync(f.fileno())
    temp.replace(path)


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def key():
    value = os.environ.get('VIGGLE_API_KEY', '').strip()
    if value:
        return value
    if os.environ.get('VAPOR_PLUGIN_MODE') == '1':
        return ''
    env = ROOT / '.env'
    for line in env.read_text().splitlines() if env.exists() else []:
        m = re.match(r'^\s*(?:export\s+)?VIGGLE_API_KEY\s*=\s*(.*?)\s*$', line)
        if m:
            return m[1].strip().strip('\"\'')
    return ''


def positive(value):
    value = float(value)
    if not math.isfinite(value) or value <= 0:
        raise ValueError('Expected a finite positive number')
    return value


def probe(path):
    raw = subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams',
                                  '-show_format', '-of', 'json', str(path)], stderr=subprocess.PIPE)
    info = json.loads(raw)
    stream = next(s for s in info['streams'] if s['codec_type'] == 'video')
    duration = positive(stream.get('duration', info['format'].get('duration')))
    return {'duration': duration, 'width': stream['width'], 'height': stream['height'],
            'fps': stream.get('avg_frame_rate')}


def estimate(kind, duration):
    return round((math.ceil(duration) * .05 if kind == 'mocap' else duration * .01), 6)


def make_plan(kind, video, image, budget):
    budget = positive(budget)
    video = video.resolve(strict=True)
    meta = probe(video)
    cost = estimate(kind, meta['duration'])
    if cost > budget:
        raise ValueError('Estimated cost exceeds budget; no submission')
    sources = {'motion_video': {'path': str(video), 'sha256': digest(video)}}
    if kind == 'remix':
        if image is None:
            raise ValueError('Remix requires --image')
        image = image.resolve(strict=True)
        from PIL import Image
        with Image.open(image) as im:
            im.verify()
        sources['image'] = {'path': str(image), 'sha256': digest(image)}
    return {'schemaVersion': 1, 'provider': 'viggle-v1', 'kind': kind,
            'sources': sources, 'video': meta, 'budgetUSD': budget,
            'estimatedUSD': cost, 'priceChecked': PRICE_DATE, 'priceExpires': PRICE_EXPIRY,
            'actualUSD': None, 'reviewStatus': 'not_checked',
            'note': 'One character source per remix. Estimate is not a provider spending cap or invoice.'}


def api(method, path, credential, trace_id=None, **kwargs):
    if not path.startswith('/v1/') or '?' in path or '..' in path:
        raise ValueError('Invalid API path')
    try:
        response = requests.request(method, ORIGIN + path,
            headers={'Authorization': 'Bearer ' + credential, 'X-Viggle-Source': 'agent-media-lab',
                     **({'X-Request-Id': trace_id} if trace_id else {})},
            timeout=(15, 120), allow_redirects=False, **kwargs)
        if response.status_code not in (200, 201, 202):
            raise RuntimeError('Viggle HTTP ' + str(response.status_code))
        return response.json()
    except (requests.RequestException, ValueError):
        raise RuntimeError('Viggle transport or response error; inspect saved job, do not resubmit blindly') from None


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', value):
        raise ValueError('Invalid remote ID')
    return value


def submit(plan_path, out, credential):
    plan = json.loads(plan_path.read_text())
    if plan.get('kind') not in ('remix', 'mocap'):
        raise ValueError('Unsupported plan kind')
    if dt.date.today().isoformat() > plan['priceExpires'] or plan['priceChecked'] != PRICE_DATE:
        raise ValueError('Price estimate expired; check provider rates and prepare a fresh plan')
    # Recompute, never trust edited duration, hashes or estimate in a plan.
    sources = plan['sources']
    fresh = make_plan(plan['kind'], Path(sources['motion_video']['path']),
                      Path(sources['image']['path']) if 'image' in sources else None, plan['budgetUSD'])
    if fresh['sources'] != sources or fresh['estimatedUSD'] != plan['estimatedUSD']:
        raise ValueError('Plan inputs changed; prepare again')
    if not credential:
        raise ValueError('VIGGLE_API_KEY is empty; no submission')
    out.mkdir(parents=True, exist_ok=False)  # durable one-submit boundary, including concurrent callers
    record = dict(fresh, state='submission_unknown', remoteId=None, traceId=uuid.uuid4().hex)
    save(out / 'job.json', record)  # persist before any POST; never auto retry a create
    with ExitStack() as stack:
        files = {name: (Path(src['path']).name, stack.enter_context(open(src['path'], 'rb')),
                       mimetypes.guess_type(src['path'])[0] or 'application/octet-stream')
                 for name, src in sources.items()}
        data = {'background_mode': 'original'} if plan['kind'] == 'remix' else {
            'type': 'glb', 'task_id': record['traceId']}
        result = api('POST', '/v1/renders' if plan['kind'] == 'remix' else '/v1/motions',
                     credential, trace_id=record['traceId'], files=files, data=data)
    record.update(remoteId=identifier(result.get('id')), state='submitted')
    save(out / 'job.json', record)
    return {'state': record['state'], 'remoteId': record['remoteId'], 'estimatedUSD': record['estimatedUSD']}


def check(out, credential, recover_id=None):
    record = json.loads((out / 'job.json').read_text())
    if recover_id:
        if record.get('remoteId'):
            raise ValueError('Job already has a remote ID')
        remote = identifier(recover_id)
    else:
        remote = identifier(record.get('remoteId'))
    path = '/v1/videos/' if record['kind'] == 'remix' else '/v1/motions/'
    result = api('GET', path + remote, credential)
    if result.get('id') != remote:
        raise ValueError('Remote ID mismatch')
    status = result.get('status')
    if status not in ('queued', 'processing', 'ready', 'failed', 'cancelled', 'pending', 'running'):
        raise ValueError('Unknown provider status; no acceptance inferred')
    record.update(remoteId=remote, state=status)
    if recover_id:
        record['recovery'] = 'Operator supplied remote ID after verifying dashboard inputs'
    save(out / 'job.json', record)
    return record, result


def download_url(url, destination):
    parsed = urlparse(url or '')
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Invalid media URL')
    if destination.exists():
        raise ValueError('Output already exists; refusing overwrite')
    # Never attach the API credential to storage requests or retain signed URLs.
    temp = destination.with_suffix(destination.suffix + '.part')
    try:
        with requests.get(url, stream=True, timeout=(15, 120), allow_redirects=False) as response:
            if response.status_code != 200:
                raise RuntimeError('Media download failed; re-read resource for a fresh URL')
            total = 0
            with temp.open('wb') as f:
                for chunk in response.iter_content(1024 * 1024):
                    total += len(chunk)
                    if total > 2 * 1024**3:
                        raise ValueError('Download exceeds 2 GiB')
                    f.write(chunk)
                f.flush(); os.fsync(f.fileno())
        if destination.suffix == '.mp4':
            meta = probe(temp)
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-i', str(temp),
                            '-f', 'null', '-'], check=True, capture_output=True)
        else:
            with temp.open('rb') as f:
                header = f.read(12)
            if len(header) != 12 or struct.unpack('<4sII', header) != (b'glTF', 2, total):
                raise ValueError('Invalid GLB header or file length')
            meta = {'bytes': total, 'validation': 'GLB container header only; animation not inspected'}
        temp.replace(destination)
        return dict(meta, sha256=digest(destination))
    except requests.RequestException:
        raise RuntimeError('Media transport error; resume download without generating again') from None
    finally:
        temp.unlink(missing_ok=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    sub.add_parser('doctor')
    sub.add_parser('credits')
    prep = sub.add_parser('plan')
    prep.add_argument('--kind', choices=['remix', 'mocap'], default='remix')
    prep.add_argument('--video', type=Path, required=True)
    prep.add_argument('--image', type=Path)
    prep.add_argument('--budget-usd', type=positive, required=True)
    prep.add_argument('--out', type=Path, required=True)
    send = sub.add_parser('submit')
    send.add_argument('--plan', type=Path, required=True)
    send.add_argument('--out', type=Path, required=True)
    for name in ['status', 'download', 'recover']:
        cmd = sub.add_parser(name)
        cmd.add_argument('--out', type=Path, required=True)
        if name == 'download':
            cmd.add_argument('--skeleton', choices=['mixamo', 'metahuman'], default='mixamo')
        if name == 'recover':
            cmd.add_argument('--remote-id', required=True)
    args = p.parse_args()
    if args.command == 'plan':
        plan = make_plan(args.kind, args.video, args.image, args.budget_usd)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open('x') as f:
            json.dump(plan, f, indent=2); f.write('\n')
        return {'plan': str(args.out), 'estimatedUSD': plan['estimatedUSD'], 'networkUsed': False}
    credential = key()
    if args.command == 'doctor':
        import shutil
        return {'VIGGLE_API_KEY': 'configured' if credential else 'empty',
                'ffmpeg': bool(shutil.which('ffmpeg')), 'ffprobe': bool(shutil.which('ffprobe')),
                'liveValidated': False}
    if not credential:
        raise ValueError('VIGGLE_API_KEY is empty; no network request')
    if args.command == 'credits':
        return {'balanceCredits': api('GET', '/v1/credits', credential)['balance']}
    if args.command == 'submit':
        return submit(args.plan, args.out, credential)
    record, result = check(args.out, credential, getattr(args, 'remote_id', None))
    if args.command == 'download':
        if record['state'] != 'ready':
            raise ValueError('Resource is not ready; query status later')
        if record['kind'] == 'remix':
            url, name = result.get('video_url'), 'result.mp4'
        else:
            result = api('GET', '/v1/motions/' + record['remoteId'] + '/export', credential,
                         params={'download_type': args.skeleton})
            if result.get('status') != 'ready':
                raise ValueError('GLB export is not ready')
            url, name = result.get('glb_url'), args.skeleton + '.glb'
        report = download_url(url, args.out / name)
        save(args.out / (name + '.verification.json'), report)
        record['downloaded'] = name
        if record['kind'] == 'remix':
            record['outputEstimatedUSD'] = estimate('remix', report['duration'])
        save(args.out / 'job.json', record)
    return {k: record.get(k) for k in ['state', 'remoteId', 'estimatedUSD', 'actualUSD', 'downloaded', 'reviewStatus']}


if __name__ == '__main__':
    try:
        print(json.dumps(main(), ensure_ascii=False))
    except (ValueError, RuntimeError, OSError, KeyError, StopIteration, subprocess.SubprocessError) as exc:
        # Avoid leaking remote payloads, signed URLs or credentials from exception strings.
        message = str(exc) if type(exc) in (ValueError, RuntimeError) else type(exc).__name__
        print(json.dumps({'error': message}), file=sys.stderr)
        sys.exit(1)
