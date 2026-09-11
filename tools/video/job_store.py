"""Durable generation reservations. One locked ledger per production budget."""
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import time


def atomic_json(path, data):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + '.tmp')
    with temporary.open('w') as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


class JobStore:
    def __init__(self, directory, budget):
        if not isinstance(budget, (int, float)) or not math.isfinite(budget) or budget <= 0:
            raise ValueError('Invalid budget')
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = (self.directory / '.generation.lock').open('a')
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.path = self.directory / 'ledger.json'
            self.data = json.loads(self.path.read_text()) if self.path.exists() else {
                'schemaVersion': 2, 'budgetUSD': budget, 'jobs': {}, 'events': []}
            if self.data['budgetUSD'] != budget:
                raise ValueError('Ledger budget is fixed; changing the plan does not authorize a budget increase')
            # Preserve legacy reservations and requests. Never infer an unrecorded submission failed.
            self.data.setdefault('events', [])
            self.data['schemaVersion'] = 2
            for entry in self.data['jobs'].values():
                if entry['state'] == 'submitting' and not entry.get('request'):
                    entry['state'] = 'submission_unknown'
            self.save()
        except BaseException:
            self.lock.close()
            raise

    def close(self):
        self.lock.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def save(self):
        atomic_json(self.path, self.data)

    def event(self, jid, action, **fields):
        self.data['events'].append({'at': time.time(), 'job': jid, 'action': action, **fields})

    def committed(self):
        return sum(e['actualUSD'] if e.get('actualUSD') is not None else e['reservedUSD']
                   for e in self.data['jobs'].values())

    def reserve(self, jid, fingerprint, reservation, estimate, image_hash):
        if jid in self.data['jobs']:
            entry = self.data['jobs'][jid]
            if entry.get('fingerprint') != fingerprint:
                raise ValueError('Job input changed or legacy fingerprint missing; do not reuse its ID')
            return entry, False
        if any(e.get('fingerprint') == fingerprint and e['state'] in ['submitting', 'submission_unknown', 'submitted', 'completed']
               for e in self.data['jobs'].values()):
            raise ValueError('Equivalent request is already unresolved or active under another ID')
        if any(not math.isfinite(x) or x < 0 for x in [reservation, estimate]) or reservation < estimate:
            raise ValueError('Invalid reservation')
        if self.committed() + reservation > self.data['budgetUSD'] + 1e-8:
            raise ValueError('Budget cap reached')
        entry = {'fingerprint': fingerprint, 'state': 'submitting', 'reservedUSD': reservation,
                 'estimatedUSD': estimate, 'actualUSD': None, 'started': time.time(),
                 'imageSha256': image_hash}
        self.data['jobs'][jid] = entry
        self.event(jid, 'reserved', reservedUSD=reservation)
        self.save()  # Durable before the provider sees any request.
        return entry, True

    def transition(self, jid, state, **fields):
        self.data['jobs'][jid].update(state=state, **fields)
        self.event(jid, state)
        self.save()

    def attach_request(self, jid, request, evidence):
        entry = self.data['jobs'][jid]
        if entry['state'] not in ['submission_unknown', 'submitting'] or entry.get('request'):
            raise ValueError('Only unresolved submissions may be reconciled')
        if not evidence.strip():
            raise ValueError('Reconciliation evidence is required')
        self.event(jid, 'reconciled', evidence=evidence)
        self.transition(jid, 'submitted', request=request)

    def settle(self, jid, amount, evidence):
        if not math.isfinite(amount) or amount < 0 or not evidence.strip():
            raise ValueError('Settlement requires nonnegative actual cost and billing evidence')
        if self.data['jobs'][jid]['state'] not in ['downloaded', 'failed', 'cancelled']:
            raise ValueError('Cannot release reservation while a job is unresolved or active')
        self.data['jobs'][jid]['actualUSD'] = amount
        self.event(jid, 'billing-reconciled', actualUSD=amount, evidence=evidence)
        self.save()


def run_job(store, job, fingerprint, reservation, estimate, image_hash, provider, before_submit=lambda: None, output_suffix=".mp4"):
    """One POST at most per ledger ID, including a crash after acceptance before receipt."""
    jid = job['id']
    if jid not in store.data['jobs']:
        if os.environ.get('VAPOR_PLUGIN_MODE') == '1' and os.environ.get('VAPOR_ALLOW_PAID') != '1':
            raise ValueError('Vapor recovery cannot create a new paid submission')
        before_submit()
    entry, fresh = store.reserve(jid, fingerprint, reservation, estimate, image_hash)
    if output_suffix not in ['.mp4', '.mp3', '.wav']:
        raise ValueError('Unsupported output suffix')
    destination = store.directory / f'{jid}{output_suffix}'
    if fresh:
        try:
            request = provider.submit(job)
        except Exception:
            store.transition(jid, 'submission_unknown')
            raise RuntimeError('Submission outcome unknown; reconcile the remote request before continuing') from None
        store.transition(jid, 'submitted', request=request)
    if entry['state'] in ['submitting', 'submission_unknown']:
        raise RuntimeError('Submission outcome unknown; no automatic POST retry')
    if entry['state'] in ['failed', 'cancelled']:
        raise RuntimeError('Terminal job; reservation retained pending billing reconciliation')
    if entry['state'] == 'downloaded':
        if not destination.is_file() or sha256(destination) != entry['sha256']:
            raise RuntimeError('Cached artifact missing or changed; no new generation will be submitted')
        return entry
    status = provider.status(entry['request'])
    if status.get('error') or status.get('status') in ['FAILED', 'CANCELLED']:
        state = 'cancelled' if status.get('status') == 'CANCELLED' else 'failed'
        store.transition(jid, state)
        raise RuntimeError('Provider returned a terminal failure; reservation retained')
    if status['status'] != 'COMPLETED':
        store.transition(jid, 'submitted', remoteStatus=status['status'])
        return entry
    store.transition(jid, 'completed')
    result = provider.result(entry['request'])
    atomic_json(store.directory / f'{jid}.result.json', result)
    # Download/validation failure is recoverable through the saved request; never a POST.
    provider.download(result, destination)
    duration = provider.duration(destination)
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('Downloaded media has invalid duration')
    requested_duration = job.get('input', {}).get('duration')
    output_estimate = estimate * duration / requested_duration if requested_duration else None
    store.transition(jid, 'downloaded', sha256=sha256(destination), outputDurationSeconds=duration,
                     elapsedSeconds=time.time() - entry['started'], outputBasedEstimatedUSD=output_estimate)
    return entry
