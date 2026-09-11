"""Validate media project contracts and report dependency-aware change impact.

Standard library only. Commands are read-only except an explicitly new --out file.
"""
import argparse
import hashlib
import json
from pathlib import Path

OWNERS = {
    'project': 'visual-storyboarding', 'narration': 'visual-storyboarding',
    'shot': 'visual-storyboarding', 'asset': 'media-assets',
    'check': 'video-review',
}
PRODUCERS = {'media-assets', 'voice-production', 'video-production',
             'video-style-extraction', 'cinematic-director', 'video-editing', 'music-generation'}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate(doc):
    require(set(doc) == {'schemaVersion', 'project', 'narrations', 'shots', 'assets',
                         'checks', 'approvals'}, 'Invalid project contract fields')
    require(type(doc['schemaVersion']) is int and doc['schemaVersion'] == 1, 'Unsupported schemaVersion')
    nodes = {}
    groups = [('project', [doc['project']]), ('narration', doc['narrations']),
              ('shot', doc['shots']), ('asset', doc['assets']), ('check', doc['checks'])]
    allowed = {
        'project': {'id', 'title', 'brief'},
        'narration': {'id', 'text'},
        'shot': {'id', 'intent', 'visual'},
        'asset': {'id', 'kind', 'path', 'sha256', 'producer', 'source'},
        'check': {'id', 'question', 'required'},
    }
    for kind, items in groups:
        require(isinstance(items, list), f'{kind}: expected array')
        for item in items:
            require(isinstance(item, dict), f'{kind}: expected object')
            require(set(item) == allowed[kind] | {'dependsOn'}, f'{kind}: invalid fields')
            require(isinstance(item['id'], str) and item['id'].strip() and ':' not in item['id'], 'Invalid id')
            ref = f"{kind}:{item['id']}"
            require(ref not in nodes, f'Duplicate {ref}')
            deps = item['dependsOn']
            require(isinstance(deps, list) and all(isinstance(d, str) for d in deps)
                    and len(deps) == len(set(deps)), f'{ref}: invalid dependencies')
            for field in allowed[kind] - {'sha256', 'required'}:
                require(isinstance(item[field], str) and item[field].strip(), f'{ref}: empty {field}')
            if kind == 'asset':
                require(item['producer'] in PRODUCERS, f'{ref}: unknown producer')
                require(not Path(item['path']).is_absolute() and '..' not in Path(item['path']).parts,
                        f'{ref}: asset path must stay under contract directory')
                sha = item['sha256']
                require(sha is None or (isinstance(sha, str) and len(sha) == 64
                        and all(c in '0123456789abcdef' for c in sha)), f'{ref}: invalid sha256')
            if kind == 'check':
                require(type(item['required']) is bool and deps, f'{ref}: invalid check')
            nodes[ref] = {'kind': kind, 'owner': OWNERS[kind], 'data': item}
    for ref, node in nodes.items():
        for dep in node['data']['dependsOn']:
            require(dep in nodes, f'{ref}: missing dependency {dep}')
            require(nodes[dep]['kind'] != 'check' or node['kind'] == 'check',
                    f'{ref}: production cannot depend on a check')
    active, done = set(), set()
    def visit(ref):
        require(ref not in active, f'Dependency cycle at {ref}')
        if ref in done:
            return
        active.add(ref)
        for dep in nodes[ref]['data']['dependsOn']:
            visit(dep)
        active.remove(ref)
        done.add(ref)
    for ref in nodes:
        visit(ref)
    require(isinstance(doc['approvals'], list), 'approvals must be an array')
    ids = set()
    for approval in doc['approvals']:
        require(isinstance(approval, dict) and set(approval) == {
            'id', 'target', 'checks', 'fingerprint', 'decision', 'reviewer', 'evidence', 'recordedAt'
        }, 'Invalid approval fields')
        require(isinstance(approval['id'], str) and approval['id'] and approval['id'] not in ids,
                'Duplicate or invalid approval id')
        ids.add(approval['id'])
        require(approval['target'] in nodes and nodes[approval['target']]['kind'] != 'check',
                'Invalid approval target')
        require(isinstance(approval['checks'], list) and approval['checks']
                and all(c in nodes and nodes[c]['kind'] == 'check' for c in approval['checks']),
                'Approval must reference checks')
        require(approval['decision'] in ['approved', 'rejected'], 'Invalid approval decision')
        for field in ['fingerprint', 'reviewer', 'evidence', 'recordedAt']:
            require(isinstance(approval[field], str) and approval[field].strip(), f'Empty approval {field}')
    return nodes


def snapshot(doc, root):
    nodes = validate(doc)
    result = {}
    def build(ref):
        if ref in result:
            return result[ref]['revision']
        node = nodes[ref]
        data = node['data']
        deps = {d: build(d) for d in sorted(data['dependsOn'])}
        content = {k: v for k, v in data.items() if k != 'dependsOn'}
        material = None
        if node['kind'] == 'asset':
            path = (root / data['path']).resolve()
            require(path.is_relative_to(root.resolve()), f'{ref}: asset symlink escapes project')
            if path.is_file():
                sha = hashlib.sha256(path.read_bytes()).hexdigest()
                material = {'sha256': sha, 'state': 'verified' if sha == data['sha256'] else 'unregistered'}
            else:
                material = {'sha256': None, 'state': 'missing'}
        own = digest({'content': content, 'material': material})
        revision = digest({'own': own, 'dependencies': deps})
        result[ref] = {'kind': node['kind'], 'owner': node['owner'], 'own': own,
                       'revision': revision, 'dependencies': deps, 'material': material}
        return revision
    for ref in nodes:
        build(ref)
    approvals = []
    for a in doc['approvals']:
        fingerprint = approval_fingerprint(result, a['target'], a['checks'])
        ancestry = set()
        def collect(ref):
            if ref in ancestry:
                return
            ancestry.add(ref)
            for dep in result[ref]['dependencies']:
                collect(dep)
        collect(a['target'])
        required_checks = {ref for ref, node in nodes.items()
                           if node['kind'] == 'check' and node['data']['required']
                           and set(node['data']['dependsOn']) & ancestry}
        missing_checks = sorted(required_checks - set(a['checks']))
        for ref in a['checks']:
            collect(ref)
        unavailable = [r for r in sorted(ancestry) if result[r]['material'] is not None
                       and result[r]['material']['state'] != 'verified']
        approvals.append({'id': a['id'], 'target': a['target'], 'decision': a['decision'],
                          'freshness': 'current' if fingerprint == a['fingerprint'] and not unavailable and not missing_checks else 'stale',
                          'unavailableAssets': unavailable, 'missingChecks': missing_checks})
    return {'schemaVersion': 1, 'projectId': doc['project']['id'], 'nodes': result, 'approvals': approvals}


def approval_fingerprint(nodes, target, checks):
    return digest({r: nodes[r]['revision'] for r in sorted(set([target, *checks]))})


def impact(before, after):
    require(before['schemaVersion'] == 1 and before['projectId'] == after['projectId'],
            'Snapshots must belong to the same project and schema')
    old, new = before['nodes'], after['nodes']
    changes = []
    for ref in sorted(old.keys() | new.keys()):
        a, b = old.get(ref), new.get(ref)
        if a and b and a['revision'] == b['revision']:
            continue
        status = 'added' if a is None else 'removed' if b is None else 'changed'
        deps = sorted(d for d in ((a or {}).get('dependencies', {}).keys()
                      | (b or {}).get('dependencies', {}).keys())
                      if (a or {}).get('dependencies', {}).get(d) != (b or {}).get('dependencies', {}).get(d))
        changes.append({'ref': ref, 'kind': (b or a)['kind'], 'owner': (b or a)['owner'],
                        'status': status, 'direct': not a or not b or a['own'] != b['own'],
                        'changedDependencies': deps})
    return {'schemaVersion': 1, 'projectId': after['projectId'], 'changes': changes,
            'affectedAssets': [c['ref'] for c in changes if c['kind'] == 'asset'],
            'affectedChecks': [c['ref'] for c in changes if c['kind'] == 'check'],
            'approvals': after['approvals'],
            'removedApprovals': sorted(a['id'] for a in before['approvals']
                                      if a['id'] not in {b['id'] for b in after['approvals']})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['validate', 'snapshot', 'impact', 'fingerprint'])
    parser.add_argument('--project', required=True, type=Path)
    parser.add_argument('--before', type=Path)
    parser.add_argument('--target')
    parser.add_argument('--checks', nargs='+')
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    try:
        doc = json.loads(args.project.read_text())
        current = snapshot(doc, args.project.parent)
        if args.command == 'impact':
            require(args.before is not None, 'impact requires --before snapshot')
            result = impact(json.loads(args.before.read_text()), current)
        elif args.command == 'fingerprint':
            require(args.target in current['nodes'] and args.checks
                    and all(c in current['nodes'] and current['nodes'][c]['kind'] == 'check' for c in args.checks),
                    'fingerprint requires a valid --target and --checks')
            result = {'fingerprint': approval_fingerprint(current['nodes'], args.target, args.checks)}
        elif args.command == 'validate':
            result = {'valid': True, 'nodes': len(current['nodes']),
                      'assetStates': {r: n['material']['state'] for r, n in current['nodes'].items() if n['material']},
                      'approvals': current['approvals']}
        else:
            result = current
        output = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
        if args.out:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            with args.out.open('x') as f:
                f.write(output)
        else:
            print(output, end='')
    except (ValueError, OSError, KeyError, TypeError) as exc:
        parser.exit(2, f'project: {exc}\n')


if __name__ == '__main__':
    main()
