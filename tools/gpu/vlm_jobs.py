"""Submit, resume and recover bounded visual observations through a durable ledger."""
import argparse
import datetime
import hashlib
import json
import math
import re
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.gpu.vlm_worker import MODEL, MAX_ARCHIVE, unpack, revision, parse_response
from tools.video.job_store import JobStore, atomic_json


def validate_plan(plan):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', plan.get('id', '')):
        raise ValueError('Invalid job ID')
    for field in ['budgetUSD', 'estimatedUSD', 'reservedUSD']:
        value = plan.get(field)
        if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
            raise ValueError('Invalid ' + field)
    if not plan['estimatedUSD'] <= plan['reservedUSD'] <= plan['budgetUSD']:
        raise ValueError('Require estimate <= reservation <= budget')


def prepare(plan, base):
    validate_plan(plan)
    path = base / plan['input']
    if path.stat().st_size > MAX_ARCHIVE:
        raise ValueError('Archive too large')
    source = path.read_bytes()
    spec = {'inputSha256': hashlib.sha256(source).hexdigest(),
            'modelRevision': plan['modelRevision'], 'workerRevision': revision(),
            'model': MODEL, 'app': 'agent-media-lab-vlm-v2', 'function': 'review', 'gpu': 'L40S'}
    fp = hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()
    spec['key'] = hashlib.sha256((plan['id'] + fp).encode()).hexdigest()
    manifest, _ = unpack(spec, source)
    return spec, source, fp, manifest


class Backend:
    def __init__(self):
        import modal
        self.modal = modal

    def submit(self, spec, source):
        return self.modal.Function.from_name(spec['app'], spec['function']).spawn(spec, source).object_id

    def read(self, key):
        parts = self.modal.Volume.from_name('agent-media-lab-gpu-results-v1').read_file(key + '/observations.json')
        data = bytearray()
        for chunk in parts:
            data.extend(chunk)
            if len(data) > 8 * 1024 * 1024:
                raise ValueError('Result too large')
        return json.loads(data)

    def poll(self, call_id):
        try:
            return self.modal.FunctionCall.from_id(call_id).get(timeout=0)
        except TimeoutError:
            return None


def validate_result(result, spec, expected=None):
    if result.get('request') != spec or result.get('model') != spec['model']:
        raise ValueError('Result identity mismatch')
    if result.get('fullPlaybackReviewed') is not False or result.get('acceptance') != 'not_decided':
        raise ValueError('Unsupported acceptance claim')
    records = result['observations']
    ids = [r['id'] for r in records]
    if not 1 <= len(ids) <= 40 or len(set(ids)) != len(ids):
        raise ValueError('Result coverage mismatch')
    if expected is not None:
        actual = [{'id': r['id'], 'sourceSha256': r['sourceSha256'],
                   'sampledSeconds': r['sampledSeconds']} for r in records]
        if actual != expected:
            raise ValueError('Result source/timestamp coverage mismatch')
    if result.get('schemaVersion') == 2:
        for r in records:
            if r.get('responseStatus') == 'valid':
                parsed, error = parse_response(r['rawResponse'], r['sampledSeconds'])
                if error or parsed != r.get('parsedResponse') or r.get('validationError') is not None:
                    raise ValueError('Invalid structured observation')
            elif r.get('responseStatus') != 'needs_review' or r.get('parsedResponse') is not None or not r.get('validationError'):
                raise ValueError('Invalid response status')


def collect(store, jid, spec, backend=None):
    entry = store.data['jobs'][jid]
    target = store.directory / (jid + '.observations.json')
    if entry['state'] == 'downloaded':
        if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != entry['sha256']:
            raise ValueError('Cached result missing/changed; recover original result, never resubmit')
        return {'id': jid, 'state': 'downloaded', 'file': str(target)}
    if entry['state'] in ['submitting', 'submission_unknown', 'failed', 'cancelled']:
        raise ValueError('Unresolved/terminal job: reconcile original call; no resubmission')
    backend = backend or Backend()
    # Durable Volume survives the ephemeral FunctionCall result retention period.
    try:
        result = backend.read(spec['key'])
    except FileNotFoundError:
        result = backend.poll(entry['request']['call_id'])
    if result is None:
        return {'id': jid, 'state': 'submitted', 'call_id': entry['request']['call_id']}
    validate_result(result, spec, entry.get('expectedShots'))
    atomic_json(target, result)
    store.transition(jid, 'downloaded', sha256=hashlib.sha256(target.read_bytes()).hexdigest(),
                     elapsedSeconds=result['elapsedSeconds'])
    return {'id': jid, 'state': 'downloaded', 'file': str(target),
            'needsReview': [r['id'] for r in result['observations'] if r.get('responseStatus') != 'valid']}


def run(plan, base, out, allow_paid=False, backend=None):
    spec, source, fp, manifest = prepare(plan, base)
    with JobStore(out, plan['budgetUSD']) as store:
        jid = plan['id']
        if jid not in store.data['jobs']:
            if not allow_paid or not plan.get('userAuthorization'):
                raise ValueError('Paid/model authorization required')
            if not plan.get('pricingSource') or datetime.date.fromisoformat(plan['priceValidThrough']) < datetime.date.today():
                raise ValueError('Pricing missing/expired')
        path = store.directory / (jid + '.request.json')
        if path.exists() and json.loads(path.read_text()) != spec:
            raise ValueError('Saved request changed; use --action resume for an older worker')
        backend = backend or Backend()
        entry, fresh = store.reserve(jid, fp, plan['reservedUSD'], plan['estimatedUSD'], None)
        if not path.exists():
            atomic_json(path, spec)
        if fresh:
            entry['expectedShots'] = [{'id': s['id'], 'sourceSha256': s['sourceSha256'],
                                      'sampledSeconds': [] if s.get('kind')=='image' else [f['seconds'] for f in s['frames']]} for s in manifest['shots']]
            store.save()
            try:
                call_id = backend.submit(spec, source)
                if not isinstance(call_id, str) or not re.fullmatch(r'fc-[A-Za-z0-9_-]+', call_id):
                    raise ValueError('Invalid call ID')
            except Exception:
                store.transition(jid, 'submission_unknown')
                raise RuntimeError('Submission unknown; reconcile original call, do not retry') from None
            store.transition(jid, 'submitted', request={'call_id': call_id}, resultKey=spec['key'])
        return collect(store, jid, spec, backend)


def recover(plan, out, action, backend=None, call_id=None, evidence='', actual_usd=None, state=None):
    validate_plan(plan)
    if not (out / 'ledger.json').is_file():
        raise ValueError('Ledger not found')
    with JobStore(out, plan['budgetUSD']) as store:
        jid = plan['id']
        entry = store.data['jobs'][jid]
        if action == 'status':
            return dict(entry, id=jid)
        spec = json.loads((out / (jid + '.request.json')).read_text())
        identity = {k: v for k, v in spec.items() if k != 'key'}
        fp = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        if fp != entry['fingerprint'] or spec['key'] != hashlib.sha256((jid + fp).encode()).hexdigest():
            raise ValueError('Saved request integrity mismatch')
        if action == 'reconcile':
            if not call_id or not re.fullmatch(r'fc-[A-Za-z0-9_-]+', call_id):
                raise ValueError('Verified call ID required')
            store.attach_request(jid, {'call_id': call_id}, evidence)
        elif action == 'settle':
            if actual_usd is None:
                raise ValueError('Actual amount and billing evidence required')
            store.settle(jid, actual_usd, evidence)
        elif action == 'mark-terminal':
            if state not in ['failed', 'cancelled'] or not evidence.strip() or entry['state'] not in ['submitted', 'submission_unknown']:
                raise ValueError('Verify remote terminal state and supply evidence')
            store.event(jid, 'remote-terminal-verified', evidence=evidence)
            store.transition(jid, state)
        elif action == 'resume':
            return collect(store, jid, spec, backend)
        return {'id': jid, 'state': entry['state']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--allow-paid', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--action', choices=['run', 'resume', 'status', 'reconcile', 'settle', 'mark-terminal'], default='run')
    parser.add_argument('--call-id')
    parser.add_argument('--evidence', default='')
    parser.add_argument('--actual-usd', type=float)
    parser.add_argument('--state', choices=['failed', 'cancelled'])
    args = parser.parse_args()
    plan = json.loads(args.plan.read_text())
    if args.dry_run:
        spec, source, _, manifest = prepare(plan, args.plan.resolve().parent)
        value = {'shots': len(manifest['shots']), 'uploadBytes': len(source),
                 'reservedUSD': plan['reservedUSD'], 'request': spec, 'submits': False}
    elif args.action == 'run':
        value = run(plan, args.plan.resolve().parent, args.out, args.allow_paid)
    else:
        value = recover(plan, args.out, args.action, call_id=args.call_id, evidence=args.evidence,
                        actual_usd=args.actual_usd, state=args.state)
    print(json.dumps(value, ensure_ascii=False))


if __name__ == '__main__':
    main()
