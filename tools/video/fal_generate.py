"""Bounded fal generation with durable reservations and explicit recovery."""
import argparse
import base64
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import time
from urllib.parse import urlparse
import requests
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.video.job_store import JobStore, run_job, sha256

IMAGE_ENDPOINT = 'minimax/h3-max/image-to-video'
TEXT_ENDPOINT = 'minimax/h3-max/text-to-video'


def validate_request(request):
    if not isinstance(request.get('request_id'), str) or not request['request_id']:
        raise ValueError('Missing request ID')
    for field in ['status_url', 'response_url']:
        url = urlparse(request[field])
        if url.scheme != 'https' or url.hostname != 'queue.fal.run' or url.username or url.password:
            raise ValueError('Unexpected queue URL')
        if request['request_id'] not in url.path.split('/'):
            raise ValueError('Request ID does not match queue URL')
    return {k: request[k] for k in ['request_id', 'status_url', 'response_url']}


class FalProvider:
    def __init__(self, root, endpoint):
        self.root, self.endpoint = root, endpoint
        self.key = os.environ.get('FAL_KEY', '')
        if not self.key and os.environ.get('VAPOR_PLUGIN_MODE') != '1':
            env = root / '.env'
            for line in env.read_text().splitlines() if env.exists() else []:
                match = re.match(r'^\s*(?:export\s+)?FAL_KEY\s*=\s*(.*?)\s*$', line)
                if match:
                    self.key = match[1].strip().strip('\"\'')
        if not self.key:
            raise ValueError('FAL_KEY is empty; no request submitted')

    def api(self, method, url, **kwargs):
        parsed = urlparse(url)
        if parsed.scheme != 'https' or parsed.hostname != 'queue.fal.run' or parsed.username or parsed.password:
            raise ValueError('Unexpected authenticated API host')
        response = requests.request(method, url, headers={'Authorization': 'Key ' + self.key,
                                    'X-Fal-No-Retry': '1'}, timeout=120, allow_redirects=False, **kwargs)
        if not response.ok:
            raise RuntimeError(f'fal HTTP {response.status_code}')  # Never log server body or headers.
        return response.json()

    def submit(self, job):
        if self.endpoint == IMAGE_ENDPOINT:
            image = (self.root / job['image']).read_bytes()
            payload = dict(job['input'], image_url='data:image/png;base64,' + base64.b64encode(image).decode())
            if job.get('endImage'):
                end_image = (self.root / job['endImage']).read_bytes()
                payload['end_image_url'] = 'data:image/png;base64,' + base64.b64encode(end_image).decode()
        elif self.endpoint == TEXT_ENDPOINT:
            if 'image' in job or 'endImage' in job or 'image_url' in job['input'] or 'end_image_url' in job['input']:
                raise ValueError('Text-to-video jobs cannot silently ignore an image')
            payload = dict(job['input'])
        else:
            raise ValueError('Unsupported video submission endpoint')
        return validate_request(self.api('POST', 'https://queue.fal.run/' + self.endpoint, json=payload))

    def status(self, request):
        return self.api('GET', validate_request(request)['status_url'])

    def result(self, request):
        return self.api('GET', validate_request(request)['response_url'])

    def download(self, result, destination):
        url = result['video']['url']
        if urlparse(url).scheme != 'https':
            raise ValueError('Unexpected media scheme')
        response = requests.get(url, timeout=120)
        if not response.ok:
            raise RuntimeError(f'Media download HTTP {response.status_code}')
        temporary = destination.with_suffix('.download')
        with temporary.open('wb') as stream:
            stream.write(response.content)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(destination)

    def duration(self, destination):
        probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(destination)]))
        duration = float(next(s for s in probe['streams'] if s['codec_type'] == 'video')['duration'])
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-i', str(destination), '-f', 'null', '-'], check=True, capture_output=True)
        return duration


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--action', choices=['run', 'status', 'reconcile', 'settle'], default='run')
    parser.add_argument('--request-file', type=Path)
    parser.add_argument('--evidence')
    parser.add_argument('--actual-usd', type=float)
    parser.add_argument('--wait-seconds', type=float, default=0)
    parser.add_argument('jobs', nargs='*')
    args = parser.parse_args()
    try:
        plan = json.loads(args.plan.read_text())
        if plan['endpoint'] not in {IMAGE_ENDPOINT, TEXT_ENDPOINT}:
            raise ValueError('Unsupported endpoint')
        for field in ['budgetUSD', 'estimatedRatePerSecond', 'reservationRatePerSecond']:
            if type(plan[field]) not in (int, float) or not math.isfinite(plan[field]) or plan[field] <= 0:
                raise ValueError('Invalid ' + field)
        if plan['reservationRatePerSecond'] < plan['estimatedRatePerSecond']:
            raise ValueError('Reservation rate must cover estimate')
        ids = [j['id'] for j in plan['jobs']]
        if len(set(ids)) != len(ids) or any(not re.fullmatch(r'[a-zA-Z0-9_-]+', i) for i in ids):
            raise ValueError('Invalid job IDs')
        if set(args.jobs) - set(ids):
            raise ValueError('Unknown jobs')
        selected = [j for j in plan['jobs'] if not args.jobs or j['id'] in args.jobs]
        if not math.isfinite(args.wait_seconds) or args.wait_seconds < 0:
            raise ValueError('Invalid wait duration')
        root = args.root.resolve()
        for j in selected:
            duration = j['input']['duration']
            if type(duration) is not int or not 5 <= duration <= 15:
                raise ValueError('Duration must be 5..15 integer seconds')
        if args.dry_run:
            print(json.dumps({'jobs': len(selected), 'estimatedUSD': sum(j['input']['duration'] for j in selected) * plan['estimatedRatePerSecond'],
                              'reservationUSD': sum(j['input']['duration'] + 2 for j in selected) * plan['reservationRatePerSecond'],
                              'budgetUSD': plan['budgetUSD'], 'submits': False}))
            return
        with JobStore(args.out, plan['budgetUSD']) as store:
            if args.action == 'status':
                print(json.dumps({'committedUSD': store.committed(), 'ledger': store.data}, indent=2))
                return
            if args.action in ['reconcile', 'settle']:
                if len(args.jobs) != 1 or not args.evidence:
                    raise ValueError('Reconciliation requires one job and --evidence')
                if args.action == 'reconcile':
                    if not args.request_file:
                        raise ValueError('--request-file required')
                    store.attach_request(args.jobs[0], validate_request(json.loads(args.request_file.read_text())), args.evidence)
                else:
                    if args.actual_usd is None:
                        raise ValueError('--actual-usd required')
                    store.settle(args.jobs[0], args.actual_usd, args.evidence)
                return
            project_path = (args.plan.parent / plan['project']).resolve() if plan.get('project') else None
            provider = None
            def preflight():
                if project_path and not plan.get('animaticGate'):
                    raise ValueError('Tracked generation plans require animaticGate before new submissions')
                if not plan.get('priceValidThrough') or datetime.date.today() > datetime.date.fromisoformat(plan['priceValidThrough']):
                    raise ValueError('Refresh expired pricing before new submissions; existing requests can still resume')
                # Optional legacy plans remain supported; new tracked plans should supply this gate.
                if plan.get('animaticGate'):
                    import sys
                    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
                    from tools.project.workflow import verify_gate
                    gate_record = verify_gate((args.plan.parent / plan['animaticGate']).resolve())
                    if project_path and Path(gate_record['project']).resolve() != project_path:
                        raise ValueError('Animatic gate belongs to a different project')
            deadline = time.monotonic() + args.wait_seconds
            for job in selected:
                image_hash = sha256(root / job['image']) if plan['endpoint'] == IMAGE_ENDPOINT else None
                end_image_hash = sha256(root / job['endImage']) if plan['endpoint'] == IMAGE_ENDPOINT and job.get('endImage') else None
                fingerprint = hashlib.sha256(json.dumps({'endpoint': plan['endpoint'], 'input': job['input'],
                                'imageSha256': image_hash, 'endImageSha256': end_image_hash}, sort_keys=True).encode()).hexdigest()
                if project_path:
                    import sys
                    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
                    from tools.project.workflow import register
                    from tools.video.job_store import atomic_json
                    dependencies = job.get('dependsOn', [])
                    if not dependencies:
                        raise ValueError('Tracked generation jobs require dependsOn references')
                    input_dependencies = []
                    if image_hash is not None:
                        register(project_path, root / job['image'], job['id']+'-input', 'image', 'media-assets',
                                 [], 'fal input image; source hash '+image_hash)
                        input_dependencies.append('asset:'+job['id']+'-input')
                    if end_image_hash is not None:
                        register(project_path, root / job['endImage'], job['id']+'-end-input', 'image', 'media-assets',
                                 [], 'fal end input image; source hash '+end_image_hash)
                        input_dependencies.append('asset:'+job['id']+'-end-input')
                    spec_path = store.directory / (job['id']+'.input.json')
                    atomic_json(spec_path, {'endpoint':plan['endpoint'], 'input':job['input'],
                                            'imageSha256':image_hash, 'endImageSha256':end_image_hash})
                    register(project_path, spec_path, job['id']+'-spec', 'manifest', 'video-production',
                             dependencies+input_dependencies, 'fal generation input specification')
                local_state = store.data['jobs'].get(job['id'], {}).get('state')
                if provider is None and local_state not in ['downloaded', 'submitting', 'submission_unknown', 'failed', 'cancelled']:
                    provider = FalProvider(root, plan['endpoint'])
                while True:
                    entry = run_job(store, job, fingerprint, (job['input']['duration'] + 2) * plan['reservationRatePerSecond'],
                                    job['input']['duration'] * plan['estimatedRatePerSecond'], image_hash, provider, preflight)
                    print(job['id'] + ': ' + entry['state'], flush=True)
                    if entry['state'] == 'downloaded':
                        if project_path:
                            register(project_path, store.directory / (job['id']+'.mp4'), job['id'], 'video', 'video-production',
                                     ['asset:'+job['id']+'-spec'], 'fal request '+entry['request']['request_id'])
                        break
                    if time.monotonic() >= deadline:
                        break
                    time.sleep(3)
            print(json.dumps({'committedUSD': store.committed(), 'budgetUSD': plan['budgetUSD'], 'billingVerified': False}))
    except (ValueError, RuntimeError, OSError, KeyError, requests.RequestException) as error:
        # Generic network exceptions can contain signed URLs; do not surface their text.
        message = type(error).__name__ if isinstance(error, requests.RequestException) else str(error)
        parser.exit(1, message + '\n')


if __name__ == '__main__':
    main()
