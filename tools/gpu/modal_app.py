"""Deploy explicitly: .venv-modal/bin/modal deploy tools/gpu/modal_app.py"""
from pathlib import Path
import modal

APP_NAME = 'agent-media-lab-gpu-v1'
RESULT_VOLUME = 'agent-media-lab-gpu-results-v1'
CACHE_VOLUME = 'agent-media-lab-gpu-models-v1'
# Do not auto-mount the checkout, voices, models, or .env.
app = modal.App(APP_NAME, include_source=False)
results = modal.Volume.from_name(RESULT_VOLUME, create_if_missing=True)
cache = modal.Volume.from_name(CACHE_VOLUME, create_if_missing=True)
image = (modal.Image.debian_slim(python_version='3.11')
         .apt_install('ffmpeg')
         .pip_install('numpy==1.26.4','torch==2.5.1','torchaudio==2.5.1','demucs==4.0.1')
         .env({'TORCH_HOME':'/models/torch','PYTHONPATH':'/opt'})
         .add_local_file(Path(__file__).with_name('worker.py'), '/opt/gpu_worker.py', copy=True))


def make_worker(resources):
    # Each closure binds one profile; no late-bound loop variable in remote dispatch.
    def invoke(request: dict, source: bytes):
        import gpu_worker
        results.reload()
        record = gpu_worker.execute(request, source, '/results', deployed_profile=resources)
        cache.commit()
        results.commit()
        return record
    return app.function(image=image, gpu=resources['gpu'], cpu=resources['cpu'],
                        memory=resources['memory'], timeout=resources['timeout'],
                        startup_timeout=600, retries=0, min_containers=0, max_containers=1,
                        scaledown_window=2, volumes={'/results':results,'/models':cache},
                        env={'TORCH_HOME':'/models/'+resources['function']+'/torch'},
                        name=resources['function'], serialized=True)(invoke)


# Read the allowlist without importing the entire tools package into the remote image.
import importlib.util
_spec = importlib.util.spec_from_file_location('gpu_profiles', Path(__file__).with_name('worker.py'))
_profiles = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_profiles)
workers = {gpu: make_worker(_profiles.profile(gpu)) for gpu in _profiles.PROFILES}
run = workers['L4']

# Singing conversion is a separate image; ordinary GPU tasks retain their smaller image.
seed_image = (image.apt_install('git')
    .pip_install('transformers==4.46.3','huggingface-hub==0.36.0','librosa==0.10.2',
                 'scipy==1.13.1','munch==4.0.0','einops==0.8.0','soundfile==0.12.1',
                 'pyyaml==6.0.2','matplotlib==3.9.2','faster-whisper==1.1.1')
    .pip_install('descript-audio-codec==1.0.0','torchvision==0.20.1')
    # AudioTools pulls an obsolete protobuf that breaks Modal before user code starts.
    .pip_install('protobuf==6.33.6')
    .run_commands('git clone https://github.com/Plachtaa/seed-vc.git /opt/seed-vc',
                  'cd /opt/seed-vc && git checkout 51383efd921027683c89e5348211d93ff12ac2a8',
                  'rm -rf /opt/seed-vc/checkpoints && ln -s /models/seed-checkpoints /opt/seed-vc/checkpoints'))

@app.function(image=seed_image,gpu='L40S',cpu=4,memory=32768,timeout=1200,startup_timeout=600,
              retries=0,min_containers=0,max_containers=1,scaledown_window=2,
              volumes={'/results':results,'/models':cache},serialized=True)
def run_seed_l40s(request: dict, source: bytes):
    import gpu_worker
    from pathlib import Path
    Path('/models/seed-checkpoints').mkdir(parents=True,exist_ok=True)
    results.reload()
    selected=dict(gpu_worker.profile('L40S'),function='run_seed_l40s',timeout=1200)
    record=gpu_worker.execute(request,source,'/results',deployed_profile=selected)
    cache.commit()
    results.commit()
    return record

# Captioner remains isolated from Demucs/Seed-VC dependencies.
caption_image = (modal.Image.debian_slim(python_version='3.11')
    .apt_install('ffmpeg')
    .pip_install('torch==2.8.0','transformers==4.57.6','accelerate==1.12.0',
                 'soundfile==0.13.1','librosa==0.11.0','pillow==11.3.0','torchvision==0.23.0')
    .env({'HF_HOME':'/models/qwen-caption','PYTHONPATH':'/opt'})
    .add_local_file(Path(__file__).with_name('worker.py'),'/opt/gpu_worker.py',copy=True))

@app.function(image=caption_image,gpu='A100-80GB',cpu=8,memory=65536,timeout=900,
              startup_timeout=600,retries=0,min_containers=0,max_containers=1,
              scaledown_window=2,volumes={'/results':results,'/models':cache},serialized=True)
def run_caption_a100(request: dict, source: bytes):
    import gpu_worker
    results.reload()
    selected=dict(gpu_worker.profile('A100-80GB'),function='run_caption_a100',timeout=900)
    try:
        return gpu_worker.execute(request,source,'/results',deployed_profile=selected)
    finally:
        cache.commit()
        results.commit()
