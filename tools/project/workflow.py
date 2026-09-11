"""Shared asset registration, playback gates and scoped repair plans."""
import argparse
import copy
import fcntl
import json
from pathlib import Path
import re
import sys
from datetime import datetime, timezone
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.project.project import snapshot, validate
from tools.video.job_store import atomic_json, sha256


def register(project, source, asset_id, kind, producer, dependencies, origin, expected_revision=None):
    """Copy immutable bytes and update the index under a lock; preserve approvals for invalidation."""
    project, source = Path(project).resolve(), Path(source).resolve()
    if not re.fullmatch(r'[A-Za-z0-9_-]+', asset_id):
        raise ValueError('Unsafe asset ID')
    if not origin.strip():
        raise ValueError('Asset provenance is required')
    with project.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        doc = json.loads(project.read_text())
        if expected_revision is not None:
            current = snapshot(doc, project.parent)
            if current['nodes'].get('asset:'+asset_id, {}).get('revision') != expected_revision:
                raise ValueError('Repair input changed during registration; replan')
        digest = sha256(source)
        suffix = source.suffix.lower()
        relative = Path('registered') / f'{asset_id}-{digest}{suffix}'
        record = {'id': asset_id, 'kind': kind, 'path': str(relative), 'sha256': digest,
                  'producer': producer, 'source': origin, 'dependsOn': dependencies}
        doc['assets'] = [a for a in doc['assets'] if a['id'] != asset_id] + [record]
        validate(doc)
        dest = project.parent / relative
        if not dest.resolve().is_relative_to(project.parent):
            raise ValueError('Registered asset path escapes project directory')
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            if sha256(dest) != digest:
                raise ValueError('Registered immutable asset was changed')
        else:
            with source.open('rb') as src, dest.open('xb') as dst:
                import shutil
                shutil.copyfileobj(src, dst)
                dst.flush()
                import os
                os.fsync(dst.fileno())
            if sha256(dest) != digest:
                raise ValueError('Source changed during registration')
        atomic_json(project, doc)
        return record



def ensure_check(project, check_id, question, dependencies, required=True):
    project = Path(project).resolve()
    with project.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        doc = json.loads(project.read_text())
        doc['checks'] = [c for c in doc['checks'] if c['id'] != check_id] + [
            {'id':check_id, 'question':question, 'required':required, 'dependsOn':dependencies}]
        validate(doc)
        atomic_json(project, doc)

def gate(project, target, reviewer, full_playback_reviewed):
    if not reviewer.strip() or not full_playback_reviewed:
        raise ValueError('Gate requires a named reviewer and explicit full playback review')
    project = Path(project).resolve()
    doc = json.loads(project.read_text())
    current = snapshot(doc, project.parent)
    if not any('asset:'+a['id'] == target and a['kind'] == 'animatic' for a in doc['assets']):
        raise ValueError('Gate target must have kind animatic')
    if target not in current['nodes'] or current['nodes'][target]['kind'] != 'asset':
        raise ValueError('Gate target must be a registered animatic asset')
    seen = set()
    def visit(ref):
        if ref in seen:
            return
        seen.add(ref)
        n = current['nodes'][ref]
        if n['material'] and n['material']['state'] != 'verified':
            raise ValueError('Gate contains missing/unregistered assets')
        for dep in n['dependencies']:
            visit(dep)
    visit(target)
    if not {'narration:'+n['id'] for n in doc['narrations']} <= seen:
        raise ValueError('Animatic gate must cover the complete narration')
    return {'schemaVersion': 1, 'project': str(project), 'target': target,
            'revision': current['nodes'][target]['revision'], 'decision': 'approved',
            'reviewer': reviewer, 'fullPlaybackReviewed': True,
            'recordedAt': datetime.now(timezone.utc).isoformat()}


def verify_gate(path):
    record = json.loads(Path(path).read_text())
    current = gate(record['project'], record['target'], record['reviewer'], record['fullPlaybackReviewed'])
    if record['decision'] != 'approved' or current['revision'] != record['revision']:
        raise ValueError('Animatic gate is stale; review the changed production before paid generation')
    return record


def repair_plan(project, issues):
    project = Path(project).resolve()
    doc = json.loads(project.read_text())
    current = snapshot(doc, project.parent)
    nodes = current['nodes']
    seeds = set()
    for issue in issues:
        if issue['asset'] not in nodes or nodes[issue['asset']]['kind'] != 'asset':
            raise ValueError('Issue references an unknown asset')
        if not issue['correction'].strip() or len(issue['range']) != 2 or not 0 <= issue['range'][0] < issue['range'][1]:
            raise ValueError('Issue needs a correction and valid time range')
        seeds.add(issue['asset'])
    affected = set(seeds)
    while True:
        expanded = affected | {r for r, n in nodes.items() if set(n['dependencies']) & affected}
        if expanded == affected:
            break
        affected = expanded
    actions = {'captions': 'edit-align-captions', 'audio': 'remix', 'narration': 'regenerate-voice',
               'video': 'render-or-reassemble', 'animatic': 'rebuild-animatic', 'manifest': 'rebuild-timeline'}
    assets = {f"asset:{a['id']}": a for a in doc['assets']}
    return {'schemaVersion': 1, 'issues': issues, 'baseline': current,
            'tasks': [{'asset': r, 'action': actions.get(assets[r]['kind'], 'review-or-rebuild'),
                       'reason': 'reported-issue' if r in seeds else 'dependent-output'}
                      for r in sorted(affected & assets.keys())],
            'recheck': sorted(r for r in affected if nodes[r]['kind'] == 'check'),
            'preserveAssets': sorted(assets.keys() - affected),
            'approvalTargetsToRevisit': sorted({a['target'] for a in doc['approvals']
                                              if a['target'] in affected or set(a['checks']) & affected}),
            'execution': 'planned; no automatic generation or approval',
            'reviewCoverage': 'Include affected ranges and adjacent transitions; final acceptance still requires full playback'}


def recheck(project, plan):
    from tools.project.project import impact
    project = Path(project).resolve()
    current = snapshot(json.loads(project.read_text()), project.parent)
    delta = impact(plan['baseline'], current)
    changed = {c['ref'] for c in delta['changes']}
    expected = {t['asset'] for t in plan['tasks']}
    unexpected = sorted(set(delta['affectedAssets']) - expected)
    criteria = sorted(set(plan['recheck']) | set(delta['affectedChecks']))
    return {'schemaVersion': 1, 'decision': 'incomplete', 'impact': delta,
            'unexpectedAffectedAssets': unexpected,
            'unmodifiedIssueAssets': sorted({i['asset'] for i in plan['issues']} - changed),
            'criteria': [{'id': c, 'revision': current['nodes'][c]['revision'] if c in current['nodes'] else None,
                          'status': 'not_checked'} for c in criteria],
            'requiredRanges': [i['range'] for i in plan['issues']],
            'coverage': {'visualRanges': [], 'listeningRanges': [], 'avPlaybackRanges': []}}



def apply_repair(project, plan, asset, source, origin):
    project = Path(project).resolve()
    doc = json.loads(project.read_text())
    current = snapshot(doc, project.parent)
    if asset not in {i['asset'] for i in plan['issues']}:
        raise ValueError('Repair must target a reported issue asset')
    if current['projectId'] != plan['baseline']['projectId']:
        raise ValueError('Repair plan belongs to another project')
    if current['nodes'][asset]['revision'] != plan['baseline']['nodes'][asset]['revision']:
        raise ValueError('Repair input changed since planning; create a fresh plan')
    record = next(a for a in doc['assets'] if 'asset:'+a['id'] == asset)
    updated = register(project, source, record['id'], record['kind'], record['producer'],
                       record['dependsOn'], origin, expected_revision=plan['baseline']['nodes'][asset]['revision'])
    return {'asset':asset, 'registered':updated, 'recheck':recheck(project, plan),
            'execution':'Replacement registered; downstream tasks still require their producing tools'}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    r = sub.add_parser('register')
    r.add_argument('--source', type=Path, required=True)
    r.add_argument('--id', required=True)
    r.add_argument('--kind', required=True)
    r.add_argument('--producer', required=True)
    r.add_argument('--depends-on', nargs='*', default=[])
    r.add_argument('--origin', required=True)
    g = sub.add_parser('gate')
    g.add_argument('--target', required=True)
    g.add_argument('--reviewer', required=True)
    g.add_argument('--full-playback-reviewed', action='store_true')
    q = sub.add_parser('repair-plan')
    q.add_argument('--issues', type=Path, required=True)
    fix = sub.add_parser('apply-repair')
    fix.add_argument('--plan', type=Path, required=True)
    fix.add_argument('--asset', required=True)
    fix.add_argument('--source', type=Path, required=True)
    fix.add_argument('--origin', required=True)
    c = sub.add_parser('recheck')
    c.add_argument('--plan', type=Path, required=True)
    for command in [r, g, q, c, fix]:
        command.add_argument('--project', type=Path, required=True)
    for command in [g, q, c, fix]:
        command.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    try:
        if args.command == 'register':
            result = register(args.project, args.source, args.id, args.kind, args.producer, args.depends_on, args.origin)
            print(json.dumps(result, ensure_ascii=False))
            return
        if args.out.exists():
            raise ValueError('Output exists')
        if args.command == 'gate':
            result = gate(args.project, args.target, args.reviewer, args.full_playback_reviewed)
        elif args.command == 'repair-plan':
            result = repair_plan(args.project, json.loads(args.issues.read_text()))
        elif args.command == 'apply-repair':
            result = apply_repair(args.project, json.loads(args.plan.read_text()), args.asset, args.source, args.origin)
        else:
            result = recheck(args.project, json.loads(args.plan.read_text()))
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open('x') as stream:
            json.dump(result, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
    except (ValueError, KeyError, OSError) as error:
        p.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
