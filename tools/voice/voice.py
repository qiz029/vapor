"""Local reference-voice profiles and Qwen3-TTS synthesis. No cloud API calls."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

ROOT = Path(os.environ['VAPOR_PROJECT_ROOT']).resolve() if os.environ.get('VAPOR_PLUGIN_MODE') == '1' else Path(__file__).resolve().parents[2]
PROFILES = ROOT / 'voices'
MODEL = ROOT / 'models/qwen3-tts-1.7b-base-8bit'


def profile_dir(name):
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}', name):
        raise ValueError('Profile ID must contain 1–64 letters, digits, _ or -.')
    return PROFILES / name


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def demucs_executable():
    local = ROOT / '.venv-separation/bin/demucs'
    return str(local) if local.is_file() else shutil.which('demucs')


def prepare_reference(stage, method):
    """Process an extracted stereo mixture; shared by profile import and standalone separation."""
    import soundfile as sf
    import numpy as np
    started = time.perf_counter()
    mixture = stage / 'mixture.wav'
    vocals = mixture
    processing = {'method': method, 'mixture': 'mixture.wav', 'listening_review': 'pending'}
    if method == 'demucs':
        executable = demucs_executable()
        if not executable:
            raise ValueError('Demucs is missing; run doctor and see docs/local-voice.md.')
        subprocess.run([executable, '-n', 'htdemucs', '--two-stems', 'vocals',
                        '-d', 'cpu', '--shifts', '0', '--float32',
                        '-o', str(stage / 'separated'), str(mixture)], check=True)
        vocals = stage / 'separated/htdemucs/mixture/vocals.wav'
        if not vocals.is_file():
            raise ValueError('Separation returned no vocal stem; output was not saved.')
        processing.update(model='htdemucs', device='cpu', shifts=0,
                          vocals='separated/htdemucs/mixture/vocals.wav',
                          accompaniment='separated/htdemucs/mixture/no_vocals.wav')
    elif method != 'none':
        raise ValueError('Unknown separation method')
    audio = stage / 'reference.wav'
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(vocals),
                    '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', str(audio)], check=True)
    samples, rate = sf.read(audio)
    if len(samples) / rate < 3 or not np.isfinite(samples).all():
        raise ValueError('Reference must contain at least 3 seconds of finite samples.')
    peak = float(np.max(np.abs(samples)))
    rms = float(np.sqrt(np.mean(samples ** 2)))
    if peak == 0:
        raise ValueError('Reference is silent; output was not saved.')
    processing.update(seconds=time.perf_counter() - started,
                      order=['extract stereo clip'] + (['separate vocals'] if method == 'demucs' else []) + ['mono 24kHz reference'],
                      signal={'duration_seconds': len(samples) / rate, 'sample_rate': rate,
                              'peak': peak, 'rms': rms,
                              'clipped_sample_fraction': float(np.mean(np.abs(samples) >= 32767 / 32768))})
    return processing


def separate(args):
    source = Path(args.source).resolve()
    dest = Path(args.output_dir).resolve()
    if not source.is_file() or not 0 <= args.start or not 3 <= args.duration <= 30:
        raise ValueError('Provide a source file, nonnegative start and 3–30 second duration.')
    if dest.exists():
        raise ValueError('Output directory already exists; choose a new path.')
    dest.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.prepare-', dir=dest.parent))
    try:
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-ss', str(args.start),
                        '-i', str(source), '-t', str(args.duration), '-map', '0:a:0',
                        '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_f32le', str(stage / 'mixture.wav')], check=True)
        processing = prepare_reference(stage, args.separation)
        write_json(stage / 'preprocessing.json', {'source': str(source), 'start_seconds': args.start,
                   'requested_duration_seconds': args.duration, 'source_note': args.source_note,
                   'reference_sha256': hashlib.sha256((stage / 'reference.wav').read_bytes()).hexdigest(),
                   **processing})
        stage.rename(dest)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    print(f'Reference prepared: {dest}')


def doctor(args):
    from importlib.metadata import version, PackageNotFoundError
    checks = {}
    for name, executable, flag in [('ffmpeg', shutil.which('ffmpeg'), '-version'),
                                    ('ffprobe', shutil.which('ffprobe'), '-version'),
                                    ('demucs', demucs_executable(), '--help')]:
        ready = False
        if executable:
            try:
                result = subprocess.run([executable, flag], capture_output=True, text=True, timeout=30)
                ready = result.returncode == 0
            except (OSError, subprocess.TimeoutExpired):
                pass
        checks[name] = {'executable': executable, 'launch_ok': ready}
    packages = {}
    for name in ['mlx-audio', 'mlx', 'soundfile', 'numpy']:
        try:
            packages[name] = version(name)
        except PackageNotFoundError:
            packages[name] = None
    print(json.dumps({'tools': checks, 'python_packages': packages,
                     'tts_model_config_present': (MODEL / 'config.json').is_file(),
                     'note': 'Launch checks only; separation weights and TTS inference are not exercised.'}, ensure_ascii=False, indent=2))
    if not all(c['launch_ok'] for c in checks.values()) or not all(packages.values()):
        raise ValueError('Some dependencies are missing or cannot launch; see docs/local-voice.md.')


def add(args):
    import soundfile as sf
    source = Path(args.source).resolve()
    transcript = Path(args.transcript).read_text().strip()
    dest = profile_dir(args.name)
    if not source.is_file() or not transcript:
        raise ValueError('Source file and exact transcript are required.')
    if dest.exists():
        raise ValueError('Profile already exists; choose another ID.')
    if not 0 <= args.start or not 3 <= args.duration <= 30:
        raise ValueError('Start must be nonnegative; duration must be 3–30 seconds.')
    PROFILES.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.prepare-', dir=PROFILES))
    try:
        audio = stage / 'reference.wav'
        mixture = stage / 'mixture.wav'
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-ss', str(args.start),
                        '-i', str(source), '-t', str(args.duration), '-map', '0:a:0',
                        '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_f32le', str(mixture)],
                       check=True)
        if sf.info(mixture).duration < 3:
            raise ValueError('Extracted audio is shorter than 3 seconds.')
        preprocessing = prepare_reference(stage, getattr(args, 'separation', 'demucs'))
        info = sf.info(audio)
        (stage / 'reference.txt').write_text(transcript + '\n')
        write_json(stage / 'profile.json', {
            'schema_version': 1, 'id': args.name, 'provider': 'mlx-audio',
            'model': str(MODEL.relative_to(ROOT)), 'language': args.language,
            'source': str(source), 'source_note': args.source_note,
            'start_seconds': args.start, 'duration_seconds': info.duration,
            'reference_sha256': hashlib.sha256(audio.read_bytes()).hexdigest(),
            'preprocessing': preprocessing,
            'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        })
        stage.rename(dest)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    print(f'Profile saved: {dest}')


def speak(args):
    # The model is prepared separately. Inference must not upload samples or fetch files.
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
    folder = profile_dir(args.name)
    profile = json.loads((folder / 'profile.json').read_text())
    model_path = ROOT / profile['model']
    if not model_path.resolve().is_relative_to((ROOT / 'models').resolve()):
        raise ValueError('Voice model must remain in the project model directory')
    if not (model_path / 'config.json').exists():
        raise ValueError('Model is missing; run scripts/prepare_model.py first.')
    text = Path(args.text_file).read_text().strip()
    if not text or len(text) > 2000:
        raise ValueError('Provide 1–2000 characters; split longer scripts by shot.')
    output = Path(args.output).resolve()
    metadata = output.with_suffix('.json')
    if output.suffix.lower() != '.wav' or output.exists() or metadata.exists():
        raise ValueError('Output must be a new .wav path (including its .json sidecar).')
    transcript = (folder / 'reference.txt').read_text().strip()
    if not transcript:
        raise ValueError('Reference transcript is empty.')
    import mlx.core as mx
    import numpy as np
    import soundfile as sf
    from mlx_audio.tts.utils import load_model
    from importlib.metadata import version
    mx.random.seed(args.seed)
    started = time.perf_counter()
    model = load_model(str(model_path))
    loaded = time.perf_counter()
    results = list(model.generate(text=text, ref_audio=str(folder / 'reference.wav'),
                                 ref_text=transcript, lang_code=profile['language'],
                                 max_tokens=2048, temperature=0.7, verbose=False))
    if not results:
        raise ValueError('Model returned no audio.')
    samples = np.concatenate([np.asarray(r.audio, dtype=np.float32) for r in results])
    if not samples.size or not np.isfinite(samples).all():
        raise ValueError('Model returned empty or invalid audio.')
    rate = results[0].sample_rate
    output.parent.mkdir(parents=True, exist_ok=True)
    sf.write(output, samples, rate, subtype='PCM_16')
    stats = {
        'profile': args.name, 'text': text, 'model': profile['model'],
        'mlx_audio_version': version('mlx-audio'), 'seed': args.seed,
        'sample_rate': rate, 'audio_seconds': len(samples) / rate,
        'load_seconds': loaded - started, 'total_seconds': time.perf_counter() - started,
        'peak_mlx_memory_gb': mx.get_peak_memory() / 1e9,
        'api_cost': 0, 'total_cost': None, 'listening_review': 'pending',
    }
    write_json(metadata, stats)
    print(json.dumps({'output': str(output), **stats}, ensure_ascii=False, indent=2))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    a = sub.add_parser('add', help='Separate vocals and save a reusable profile')
    a.add_argument('name')
    a.add_argument('--source', required=True)
    a.add_argument('--transcript', required=True, help='Exact transcript of the selected clip')
    a.add_argument('--start', type=float, default=0)
    a.add_argument('--duration', type=float, default=15)
    a.add_argument('--language', default='Chinese')
    a.add_argument('--source-note', required=True, help='Source and permission/use notes')
    a.add_argument('--separation', choices=['demucs', 'none'], default='demucs', help='Use none only for an already clean single-speaker recording')
    a.set_defaults(run=add)
    s = sub.add_parser('speak', help='Generate local WAV audio from a saved profile')
    s.add_argument('name')
    s.add_argument('--text-file', required=True)
    s.add_argument('--output', required=True)
    s.add_argument('--seed', type=int, default=42)
    s.set_defaults(run=speak)
    sub.add_parser('doctor', help='Check local audio tools and Python dependencies').set_defaults(run=doctor)
    r = sub.add_parser('separate', help='Prepare a reference clip without creating a voice profile')
    r.add_argument('--source', required=True)
    r.add_argument('--output-dir', required=True)
    r.add_argument('--start', type=float, default=0)
    r.add_argument('--duration', type=float, default=15)
    r.add_argument('--source-note', required=True)
    r.add_argument('--separation', choices=['demucs', 'none'], default='demucs')
    r.set_defaults(run=separate)
    sub.add_parser('list', help='List saved profile IDs').set_defaults(
        run=lambda _: print('\n'.join(p.parent.name for p in sorted(PROFILES.glob('*/profile.json')))))
    args = p.parse_args()
    try:
        args.run(args)
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        p.exit(1, f'Error: {exc}\n')


if __name__ == '__main__':
    main()
