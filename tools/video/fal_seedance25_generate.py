"""Seedance 2.5 image-reference generation with the existing durable job ledger."""
import argparse
import base64
import datetime
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import time
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.video.fal_generate import FalProvider, validate_request
from tools.video.job_store import JobStore, run_job, sha256

ENDPOINT = 'bytedance/seedance-2.5/reference-to-video'


def payload(root, job):
    value = dict(job['input'])
    allowed = {'prompt', 'duration', 'resolution', 'aspect_ratio', 'generate_audio',
               'bitrate_mode', 'seed', 'end_user_id'}
    if set(value) - allowed:
        raise ValueError('Unsupported input field')
    if type(value.get('duration')) is not int or not 4 <= value['duration'] <= 30:
        raise ValueError('Duration must be integer 4..30')
    if value.get('resolution') not in ('480p', '720p') or value.get('aspect_ratio') != '16:9':
        raise ValueError('This adapter budgets only 16:9 480p/720p')
    if type(value.get('generate_audio')) is not bool:
        raise ValueError('Explicit audio choice required')
    if not isinstance(value.get('prompt'), str) or not value['prompt'].strip():
        raise ValueError('Prompt required')
    images = job.get('images')
    if not isinstance(images, list) or not 1 <= len(images) <= 30:
        raise ValueError('1..30 local PNG references required')
    value['image_urls'] = []
    for filename in images:
        data = (root / filename).read_bytes()
        if not data.startswith(b'\x89PNG\r\n\x1a\n') or len(data) > 30_000_000:
            raise ValueError('Reference must be PNG under 30 MB')
        value['image_urls'].append('data:image/png;base64,' + base64.b64encode(data).decode())
    value['duration'] = str(value['duration'])
    return value


class Seedance25Provider(FalProvider):
    def submit(self, job):
        return validate_request(self.api('POST', 'https://queue.fal.run/' + ENDPOINT,
                                         json=payload(self.root, job)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--wait-seconds', type=float, default=0)
    args = parser.parse_args()
    try:
        plan = json.loads(args.plan.read_text())
        if plan['endpoint'] != ENDPOINT or len(plan['jobs']) != 1:
            raise ValueError('One explicitly scoped Seedance 2.5 job required')
        if not math.isfinite(args.wait_seconds) or args.wait_seconds < 0:
            raise ValueError('Invalid wait time')
        root = args.root.resolve()
        job = plan['jobs'][0]
        if not re.fullmatch(r'[a-zA-Z0-9_-]+', job['id']):
            raise ValueError('Invalid job ID')
        payload(root, job)  # Validate locally before credentials or submission.
        estimate, reserve = job['estimatedUSD'], job['reservedUSD']
        if any(type(v) not in (int, float) or not math.isfinite(v) for v in (estimate, reserve)):
            raise ValueError('Invalid cost')
        price_floor = job['input']['duration'] * (0.473 if job['input']['resolution'] == '720p' else 0.2205)
        if not 0 < price_floor <= estimate + 1e-8 or not estimate <= reserve <= plan['newBudgetUSD']:
            raise ValueError('Reservation must cover published estimate within new budget')
        hashes = [sha256(root / f) for f in job['images']]
        fingerprint = hashlib.sha256(json.dumps({'endpoint': ENDPOINT, 'input': job['input'],
                                                'imageHashes': hashes}, sort_keys=True).encode()).hexdigest()
        if args.dry_run:
            print(json.dumps({'submits': False, 'references': len(hashes), 'estimatedUSD': estimate,
                              'reservedUSD': reserve, 'fingerprint': fingerprint}))
            return
        def preflight():
            if datetime.date.today() > datetime.date.fromisoformat(plan['priceValidThrough']):
                raise ValueError('Pricing expired')
            if not plan.get('authorization'):
                raise ValueError('Explicit authorization required')
        with JobStore(args.out, plan['budgetUSD']) as store:
            state = store.data['jobs'].get(job['id'], {}).get('state')
            provider = None if state in ('downloaded', 'submitting', 'submission_unknown', 'failed', 'cancelled') else Seedance25Provider(root, ENDPOINT)
            deadline = time.monotonic() + args.wait_seconds
            while True:
                entry = run_job(store, job, fingerprint, reserve, estimate, hashes[0], provider, preflight)
                print(job['id'] + ': ' + entry['state'], flush=True)
                if entry['state'] == 'downloaded' or time.monotonic() >= deadline:
                    break
                time.sleep(5)
            print(json.dumps({'committedUSD': store.committed(), 'budgetUSD': plan['budgetUSD'], 'billingVerified': False}))
    except (ValueError, RuntimeError, OSError, KeyError, requests.RequestException) as error:
        parser.exit(1, (type(error).__name__ if isinstance(error, requests.RequestException) else str(error)) + '\n')


if __name__ == '__main__':
    main()
