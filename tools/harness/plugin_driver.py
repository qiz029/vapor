"""Portable fixed-command executor. The host owns descriptors; this is not a shell API."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.video.job_store import JobStore, atomic_json, sha256


def confined(root, path):
    path = Path(path).resolve()
    if not path.is_relative_to(root):
        raise ValueError('Path outside project')
    return path


def record_failure(spec):
    """Only call after the child has exited. Ledger clients reserve before any POST."""
    j = spec.get('job', {})
    if spec.get('resume') or spec.get('remote') not in ['ledger', 'metered', 'viggle'] or not j:
        return
    root = Path(spec['root']).resolve()
    ledger_file = confined(root, root / 'generation/ledger.json')
    entries = json.loads(ledger_file.read_text())['jobs'] if ledger_file.exists() else {}
    ids = j.get('ledgerIds', [j['id']])
    if any(i in entries for i in ids):
        return
    atomic_json(confined(root, root / j['directory']) / 'receipt.json', {
        'state': 'failed_before_submission', 'cloudSubmitted': False, 'artifacts': [],
        'error': 'Stopped before provider submission. Check plugin dependencies, credentials and offline plan validation.'})


def recover(spec):
    root = Path(spec['root']).resolve()
    j = spec['job']
    directory = confined(root, root / j['directory'])
    ledger = confined(root, root / 'generation')
    if not (ledger / 'ledger.json').is_file():
        raise ValueError('No original ledger; no new submission authorized')
    with JobStore(ledger, j['authorization']['budgetUSD']) as store:
        ids = j.get('ledgerIds', [j['id']])
        selected = spec.get('providerJobId') or (ids[0] if len(ids) == 1 else None)
        action = spec['action']
        if action != 'status':
            if selected not in ids or selected not in store.data['jobs']:
                raise ValueError('Select an original provider job ID')
            if not spec.get('evidence', '').strip():
                raise ValueError('Verified evidence required')
        if action == 'settle':
            store.settle(selected, spec['actualUSD'], spec['evidence'])
        elif action == 'reconcile':
            if j.get('remote') == 'viggle':
                from tools.motion.viggle import identifier, save
                remote_id = identifier(spec.get('callId'))
                file = directory / 'output/job.json'
                record = json.loads(file.read_text())
                if record.get('remoteId'):
                    raise ValueError('Viggle already has a remote ID')
                record.update(remoteId=remote_id, state='submitted', recovery=spec['evidence'])
                save(file, record)
                request = {'remoteId': remote_id}
            elif spec.get('requestFile'):
                from tools.video.fal_generate import validate_request
                request = validate_request(json.loads(confined(root, spec['requestFile']).read_text()))
            else:
                import re
                if not re.fullmatch(r'fc-[A-Za-z0-9_-]+', spec.get('callId') or ''):
                    raise ValueError('Verified Modal call ID required')
                request = {'call_id': spec['callId']}
            store.attach_request(selected, request, spec['evidence'])
        elif action == 'mark-terminal':
            if spec.get('state') not in ['failed', 'cancelled']:
                raise ValueError('Failed or cancelled state required')
            if store.data['jobs'][selected]['state'] not in ['submitted', 'submission_unknown']:
                raise ValueError('Cannot mark this job terminal')
            store.event(selected, 'remote-terminal-verified', evidence=spec['evidence'])
            store.transition(selected, spec['state'])
        elif action != 'status':
            raise ValueError('Unknown recovery action')
        atomic_json(directory / 'recovery-result.json', store.data)


def execute(spec):
    root = Path(spec['root']).resolve()
    j, remote = spec['job'], spec['remote']
    directory = confined(root, root / j['directory'])
    ledger = confined(root, root / 'generation')
    command = [spec['executable'], *spec['args']]
    authorization = j.get('authorization', {})
    for name, binding in j['inputs'].items():
        if spec['resume'] and binding.get('mutable'):
            continue
        if sha256(confined(root, root / name)) != binding['sha256']:
            raise ValueError('Input changed since preparation: ' + name)
    project = confined(root, root / j['input']['project']) if j['input'].get('project') else None
    before = {a['id']: a['sha256'] for a in json.loads(project.read_text()).get('assets', [])} if project else {}
    guard = remote in ['metered', 'viggle']
    if remote == 'ledger':
        plan = j['plan']
        if plan['budgetUSD'] != authorization['budgetUSD']:
            raise ValueError('Plan must use authorized project budget')
        jobs = plan.get('jobs', [plan])
        if 'reservationRatePerSecond' in plan:
            reserved = sum((x['input']['duration'] + 2) * plan['reservationRatePerSecond'] for x in jobs)
            estimated = sum(x['input']['duration'] * plan['estimatedRatePerSecond'] for x in jobs)
        else:
            reserved = sum(x['reservedUSD'] for x in jobs)
            estimated = sum(x['estimatedUSD'] for x in jobs)
        if reserved > authorization['reservedUSD'] or estimated > authorization['estimatedUSD']:
            raise ValueError('Plan cost exceeds exact approved estimate/reservation')
        with JobStore(ledger, plan['budgetUSD']) as store:
            if spec['resume']:
                original = [i for i in j['ledgerIds'] if i in store.data['jobs']]
                if not original:
                    raise ValueError('No original submission; automatic replay refused')
                if len(original) != len(j['ledgerIds']):
                    if Path(command[1]).name not in ['fal_generate.py', 'fal_seedance_generate.py'] or spec['provider'] != 'fal-video':
                        raise ValueError('Incomplete batch requires original provider reconciliation')
                    command.extend(original)
            elif any(x['state'] in ['submitting', 'submission_unknown'] for x in store.data['jobs'].values()):
                raise ValueError('Reconcile uncertain project submissions before new paid work')
    if guard and not spec['resume']:
        with JobStore(ledger, authorization['budgetUSD']) as store:
            existing = store.data['jobs'].get(j['id'])
            if existing:
                raise ValueError('Metered request already attempted; inspect saved outputs/provider, do not upload again')
            store.reserve(j['id'], j['fingerprint'], authorization['reservedUSD'], authorization['estimatedUSD'], None)
    if remote:
        atomic_json(directory / 'receipt.json', {'state': 'submission_unknown', 'cloudSubmitted': None,
                    'provider': spec.get('provider'), 'fingerprint': j['fingerprint'], 'artifacts': []})
    try:
        if remote == 'viggle' and spec['resume']:
            from tools.motion.viggle import check, key, download_url, api, save, estimate
            output = directory / 'output'
            record, result = check(output, key())
            if record.get('downloaded'):
                downloaded = confined(root, output / record['downloaded'])
                verification = json.loads((output / (record['downloaded'] + '.verification.json')).read_text())
                if sha256(downloaded) != verification['sha256']:
                    raise ValueError('Cached Viggle output changed; no new generation authorized')
            if record['state'] == 'ready' and not record.get('downloaded'):
                if record['kind'] == 'remix':
                    url, name = result.get('video_url'), 'result.mp4'
                else:
                    skeleton = j['input'].get('skeleton', 'mixamo')
                    if skeleton not in ['mixamo', 'metahuman']:
                        raise ValueError('Unsupported skeleton')
                    result = api('GET', '/v1/motions/' + record['remoteId'] + '/export', key(), params={'download_type': skeleton})
                    if result.get('status') != 'ready':
                        raise ValueError('GLB export pending; resume original job later')
                    url, name = result.get('glb_url'), skeleton + '.glb'
                report = download_url(url, output / name)
                save(output / (name + '.verification.json'), report)
                record['downloaded'] = name
                save(output / 'job.json', record)
        else:
            if remote == 'viggle':
                plan = json.loads((root / j['input']['plan']).read_text())
                if plan['estimatedUSD'] > authorization['estimatedUSD'] or plan['budgetUSD'] != authorization['budgetUSD']:
                    raise ValueError('Viggle plan exceeds exact approval')
            subprocess.run(command, check=True)
    except BaseException:
        if guard and not spec['resume']:
            with JobStore(ledger, authorization['budgetUSD']) as store:
                store.transition(j['id'], 'submission_unknown')
        raise
    artifacts = []
    for name, binding in j['inputs'].items():
        if not binding.get('mutable') and sha256(confined(root, root / name)) != binding['sha256']:
            raise ValueError('Source changed during execution; retain output for inspection: ' + name)
    if project:
        for a in json.loads(project.read_text()).get('assets', []):
            if before.get(a['id']) != a['sha256']:
                path = confined(root, project.parent / a['path'])
                if sha256(path) != a['sha256']:
                    raise ValueError('Changed project asset hash')
                artifacts.append(str(path))
    if spec['operation'] == 'voice.add':
        voice = confined(root, root / 'voices' / j['input']['name'])
        artifacts.extend(str(p) for p in voice.rglob('*') if p.is_file())
    state, cloud = 'completed', bool(remote)
    if remote == 'ledger':
        with JobStore(ledger, authorization['budgetUSD']) as store:
            original_ids = [i for i in j['ledgerIds'] if i in store.data['jobs']]
            entries = [store.data['jobs'][i] for i in original_ids]
            states = [e['state'] for e in entries]
            state = 'completed' if all(s == 'downloaded' for s in states) else 'recovery_required' if any(s in ['submission_unknown', 'submitting', 'failed', 'cancelled'] for s in states) else 'submitted'
            if len(original_ids) != len(j['ledgerIds']):
                state = 'recovery_required'
            for jid, entry in zip(original_ids, entries):
                if entry['state'] != 'downloaded':
                    continue
                # Existing clients verify downloads before entering downloaded state.
                for suffix in ['.mp4', '.wav', '.mp3', '.input.json', '.result.json', '.request.json']:
                    p = ledger / (jid + suffix)
                    if p.is_file():
                        artifacts.append(str(p))
                if (ledger / jid).is_dir():
                    artifacts.extend(str(p) for p in (ledger / jid).rglob('*') if p.is_file())
    elif remote == 'viggle':
        record = json.loads((directory / 'output/job.json').read_text())
        state = 'completed' if record.get('downloaded') else 'recovery_required' if record['state'] in ['failed', 'cancelled', 'submission_unknown'] else 'submitted'
        with JobStore(ledger, authorization['budgetUSD']) as store:
            store.transition(j['id'], 'downloaded' if state == 'completed' else record['state'] if record['state'] in ['failed', 'cancelled'] else 'submitted', request={'remoteId': record['remoteId']})
    elif guard:
        with JobStore(ledger, authorization['budgetUSD']) as store:
            store.transition(j['id'], 'submitted', request={'localReceipt': str(directory / 'receipt.json')})
            store.transition(j['id'], 'completed')
            store.transition(j['id'], 'downloaded')
    outputs = [p for p in directory.rglob('*') if p.is_file() and not p.is_symlink()
               and p.name not in ['request.json', 'invocation.json', 'receipt.json', 'stdout.txt', 'result-report.json', 'recovery.json', 'recovery-result.json']]
    outputs.extend(Path(p) for p in artifacts)
    integrity = {str(confined(root, p).relative_to(root)): sha256(p) for p in outputs}
    atomic_json(directory / 'receipt.json', {'state': state, 'cloudSubmitted': cloud, 'integrity': integrity,
                'provider': spec.get('provider'), 'artifacts': sorted(set(artifacts)),
                'fullPlaybackReviewed': False, 'fullListeningReviewed': False, 'finished': time.time()})


if __name__ == '__main__':
    try:
        spec = json.loads(Path(sys.argv[1]).read_text())
        recover(spec) if len(sys.argv) > 2 else execute(spec)
    except BaseException as error:
        try:
            if len(sys.argv) == 2 and 'spec' in locals():
                record_failure(spec)
        except Exception:
            pass  # Missing evidence stays uncertain; never infer absence from a failed check.
        # Do not expose provider bodies, signed URLs or environment contents.
        print('Vapor tool: ' + (str(error) if type(error) is ValueError else type(error).__name__), file=sys.stderr)
        sys.exit(1)
