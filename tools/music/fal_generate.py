"""Generate music through fal with durable reservations and recoverable downloads."""
import argparse
import datetime
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import requests
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.video.fal_generate import FalProvider, validate_request
from tools.video.job_store import JobStore, run_job, atomic_json
from tools.project.project import digest, snapshot
from tools.project.workflow import register, ensure_check, verify_gate

ENDPOINT = 'fal-ai/minimax-music/v2.6'
MUSIC3 = 'minimax/music-3'


def validate_plan(plan):
    if plan.get('schemaVersion') != 1 or plan.get('endpoint') not in {ENDPOINT, MUSIC3}:
        raise ValueError('Unsupported music plan or endpoint')
    for field in ['budgetUSD', 'estimatedUSD', 'reservedUSD']:
        value = plan.get(field)
        if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
            raise ValueError('Expected positive finite ' + field)
    if not plan['estimatedUSD'] <= plan['reservedUSD'] <= plan['budgetUSD']:
        raise ValueError('Require estimate <= reservation <= budget')
    if not re.fullmatch(r'[A-Za-z0-9_-]+', plan.get('id', '')):
        raise ValueError('Unsafe music ID')
    payload = plan['input']
    if plan['endpoint'] == MUSIC3:
        validate_music3(payload)
        return
    if set(payload) - {'prompt', 'lyrics', 'lyrics_optimizer', 'is_instrumental', 'audio_setting'}:
        raise ValueError('Unsupported music input field; exact duration is not supported')
    if not isinstance(payload.get('prompt'), str) or not 10 <= len(payload['prompt']) <= 2000:
        raise ValueError('Prompt must contain 10..2000 characters')
    if type(payload.get('is_instrumental')) is not bool or type(payload.get('lyrics_optimizer', False)) is not bool:
        raise ValueError('Specify boolean is_instrumental and lyrics_optimizer')
    lyrics = payload.get('lyrics', '')
    if not isinstance(lyrics, str) or len(lyrics) > 3500:
        raise ValueError('Invalid lyrics')
    if payload['is_instrumental'] and (lyrics.strip() or payload.get('lyrics_optimizer')):
        raise ValueError('Instrumental generation cannot request lyrics')
    if not payload['is_instrumental'] and not lyrics.strip() and not payload.get('lyrics_optimizer'):
        raise ValueError('Songs require lyrics or lyrics_optimizer')
    settings = payload.get('audio_setting', {})
    if set(settings) - {'format', 'sample_rate', 'bitrate'}:
        raise ValueError('Unsupported audio setting')
    if settings.get('format', 'mp3') not in ['mp3', 'wav']:
        raise ValueError('Use mp3 or wav; raw PCM lacks a probeable container')
    if settings.get('sample_rate', 44100) not in [16000, 24000, 32000, 44100]:
        raise ValueError('Unsupported sample rate')
    if settings.get('bitrate', 256000) not in [32000, 64000, 128000, 256000]:
        raise ValueError('Unsupported bitrate')


def validate_music3(payload):
    if not isinstance(payload, dict) or set(payload) - {'prompt','lyrics','duration','seed','num_inference_steps','guidance_scale'}:
        raise ValueError('Unsupported Music 3 input field')
    for key in ['prompt','lyrics']:
        if not isinstance(payload.get(key), str) or not payload[key].strip():
            raise ValueError('Music 3 requires nonempty '+key)
    if any(re.match(r'^\s*\[[^\]]+\]\s*\S', line) for line in payload['lyrics'].splitlines()):
        raise ValueError('Music 3 section tags must be on their own line')
    for key in ['duration','guidance_scale']:
        if key in payload and (type(payload[key]) not in (int,float) or not math.isfinite(payload[key]) or payload[key] <= 0):
            raise ValueError('Expected positive finite '+key)
    if payload.get('duration',60)>300:
        raise ValueError('Music 3 duration upper bound cannot exceed 300 seconds')
    for key in ['seed','num_inference_steps']:
        if key in payload and (type(payload[key]) is not int or payload[key]<0 or (key=='num_inference_steps' and payload[key]==0)):
            raise ValueError('Invalid '+key)


class MusicProvider(FalProvider):
    def __init__(self, endpoint=ENDPOINT):
        # Environment only. Local validation and cached recovery never read credentials.
        self.key = os.environ.get('FAL_KEY', '')
        self.endpoint = endpoint
        if not self.key:
            raise ValueError('Set FAL_KEY in the runtime environment')

    def submit(self, job):
        return validate_request(self.api('POST', 'https://queue.fal.run/' + self.endpoint, json=job['input']))

    def download(self, result, destination):
        super().download({'video': result['audio']}, destination)

    def duration(self, destination):
        probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams',
                           '-show_format', '-of', 'json', str(destination)]))
        streams = probe['streams']
        if len(streams) != 1 or streams[0]['codec_type'] != 'audio':
            raise ValueError('Expected one audio stream')
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-i', str(destination),
                        '-f', 'null', '-'], check=True, capture_output=True)
        return float(probe['format']['duration'])


def execute(plan, out, base, allow_paid=False, provider=None):
    validate_plan(plan)
    project = (base / plan['project']).resolve() if plan.get('project') else None
    deps = plan.get('dependsOn', [])
    revisions = {}
    if project:
        nodes = snapshot(json.loads(project.read_text()), project.parent)['nodes']
        if not deps or len(set(deps)) != len(deps) or any(d not in nodes or nodes[d]['kind'] == 'check' for d in deps):
            raise ValueError('Tracked music requires valid production dependsOn references')
        revisions = {d: nodes[d]['revision'] for d in deps}
    spec = {'endpoint': plan['endpoint'], 'input': plan['input'], 'dependencyRevisions': revisions,
            'project': str(project) if project else None}
    fingerprint = digest(spec)
    suffix = '.wav' if plan['endpoint'] == MUSIC3 else '.' + plan['input'].get('audio_setting', {}).get('format', 'mp3')
    with JobStore(out, plan['budgetUSD']) as store:
        state = store.data['jobs'].get(plan['id'], {}).get('state')
        def preflight():
            if not allow_paid:
                raise ValueError('New submissions require --allow-paid within user-authorized budget')
            if not plan.get('pricingSource') or datetime.date.fromisoformat(plan.get('priceValidThrough', '1970-01-01')) < datetime.date.today():
                raise ValueError('Refresh pricingSource and priceValidThrough before submitting')
            if plan.get('animaticGate'):
                gate = verify_gate(base / plan['animaticGate'])
                if project and Path(gate['project']).resolve() != project:
                    raise ValueError('Animatic gate belongs to another project')
        if state is None:
            preflight()
        if provider is None and state not in ['downloaded', 'submission_unknown', 'submitting', 'failed', 'cancelled']:
            provider = MusicProvider(plan['endpoint'])
        entry = run_job(store, plan, fingerprint, plan['reservedUSD'], plan['estimatedUSD'], None,
                        provider, preflight, output_suffix=suffix)
        spec_path = store.directory / (plan['id'] + '.input.json')
        atomic_json(spec_path, spec)
        if project and entry['state'] == 'downloaded':
            current = snapshot(json.loads(project.read_text()), project.parent)['nodes']
            if any(current.get(d, {}).get('revision') != revision for d, revision in revisions.items()):
                raise ValueError('Music dependencies changed during generation; downloaded result retained for review')
            register(project, spec_path, plan['id']+'-spec', 'manifest', 'music-generation', deps,
                     'fal music input; dependency revisions recorded in specification')
            register(project, store.directory / (plan['id']+suffix), plan['id'], 'audio', 'music-generation',
                     ['asset:'+plan['id']+'-spec'], 'fal request '+entry['request']['request_id'])
            ensure_check(project, plan['id']+'-listening',
                         'Full listening: musical fit, lyrics or absence of vocals, artifacts, ending and mix fit?',
                         ['asset:'+plan['id']])
        return {'state': entry['state'], 'committedUSD': store.committed(), 'actualUSD': entry['actualUSD'],
                'fullListeningReviewed': False, 'artifact': str(store.directory / (plan['id']+suffix)) if entry['state']=='downloaded' else None}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--plan', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--allow-paid', action='store_true')
    p.add_argument('--action', choices=['run', 'status', 'reconcile', 'settle'], default='run')
    p.add_argument('--request-file', type=Path)
    p.add_argument('--evidence', default='')
    p.add_argument('--actual-usd', type=float)
    args = p.parse_args()
    try:
        plan = json.loads(args.plan.read_text())
        validate_plan(plan)
        if args.dry_run:
            result = {'submits': False, 'estimatedUSD': plan['estimatedUSD'], 'reservedUSD':plan['reservedUSD'],
                      'budgetUSD':plan['budgetUSD'], 'pricingVerified':False}
        elif args.action == 'run':
            result = execute(plan, args.out, args.plan.resolve().parent, args.allow_paid)
        else:
            with JobStore(args.out, plan['budgetUSD']) as store:
                if args.action == 'reconcile':
                    if not args.request_file:
                        raise ValueError('Provide --request-file and --evidence')
                    store.attach_request(plan['id'], validate_request(json.loads(args.request_file.read_text())), args.evidence)
                elif args.action == 'settle':
                    if args.actual_usd is None:
                        raise ValueError('Provide --actual-usd and --evidence')
                    store.settle(plan['id'], args.actual_usd, args.evidence)
                result = store.data
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, RuntimeError, OSError, KeyError, TypeError, subprocess.CalledProcessError, requests.RequestException) as error:
        p.exit(1, (type(error).__name__ if isinstance(error, (requests.RequestException, subprocess.CalledProcessError)) else str(error))+'\n')


if __name__ == '__main__':
    main()
