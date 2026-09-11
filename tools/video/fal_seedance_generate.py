"""Seedance 1.5 fixed-camera adapter using the shared durable fal job ledger."""
import argparse
import base64
import datetime
import hashlib
import json
import math
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.video.fal_generate import FalProvider, validate_request
from tools.video.job_store import JobStore, run_job, sha256

ENDPOINT = 'fal-ai/bytedance/seedance/v1.5/pro/image-to-video'


def payload(root, job):
    value = dict(job['input'])
    duration = value['duration']
    if type(duration) is not int or not 4 <= duration <= 12:
        raise ValueError('Seedance duration must be an integer from 4 to 12')
    if value.get('resolution') not in ('480p', '720p', '1080p'):
        raise ValueError('Invalid resolution')
    if type(value.get('camera_fixed')) is not bool or type(value.get('generate_audio')) is not bool:
        raise ValueError('Explicit camera_fixed and generate_audio required')
    value['duration'] = str(duration)
    for field, key in [('image', 'image_url'), ('endImage', 'end_image_url')]:
        if field in job:
            value[key] = 'data:image/png;base64,' + base64.b64encode((root / job[field]).read_bytes()).decode()
    if 'image_url' not in value:
        raise ValueError('First frame required')
    return value


class SeedanceProvider(FalProvider):
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
    parser.add_argument('jobs', nargs='*')
    args = parser.parse_args()
    plan = json.loads(args.plan.read_text())
    if plan['endpoint'] != ENDPOINT:
        raise ValueError('Unexpected endpoint')
    selected = [job for job in plan['jobs'] if not args.jobs or job['id'] in args.jobs]
    if set(args.jobs) - {job['id'] for job in selected}:
        raise ValueError('Unknown jobs')
    root = args.root.resolve()
    if not math.isfinite(args.wait_seconds) or args.wait_seconds < 0:
        raise ValueError('Invalid wait time')
    for job in selected:
        payload(root, job)
        if not 0 < job['estimatedUSD'] <= job['reservedUSD']:
            raise ValueError('Invalid reservation')
    if args.dry_run:
        print(json.dumps({'jobs': len(selected), 'estimatedUSD': sum(j['estimatedUSD'] for j in selected),
                          'reservedUSD': sum(j['reservedUSD'] for j in selected), 'submits': False}))
        return
    def preflight():
        if datetime.date.today() > datetime.date.fromisoformat(plan['priceValidThrough']):
            raise ValueError('Pricing expired')
    with JobStore(args.out, plan['budgetUSD']) as store:
        provider = SeedanceProvider(root, ENDPOINT)
        for job in selected:
            hashes = {key: sha256(root / job[key]) for key in ('image', 'endImage') if key in job}
            fingerprint = hashlib.sha256(json.dumps({'endpoint': ENDPOINT, 'input': job['input'],
                                                      'hashes': hashes}, sort_keys=True).encode()).hexdigest()
            deadline = time.monotonic() + args.wait_seconds
            while True:
                entry = run_job(store, job, fingerprint, job['reservedUSD'], job['estimatedUSD'],
                                hashes['image'], provider, preflight)
                print(job['id'] + ': ' + entry['state'], flush=True)
                if entry['state'] == 'downloaded' or time.monotonic() >= deadline:
                    break
                time.sleep(3)
        print(json.dumps({'committedUSD': store.committed(), 'budgetUSD': plan['budgetUSD'], 'billingVerified': False}))


if __name__ == '__main__':
    main()
