"""Download public model weights without using stored Hugging Face credentials."""
import json
import os
from pathlib import Path

os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
from huggingface_hub import HfApi, snapshot_download

ROOT = Path(os.environ['VAPOR_PROJECT_ROOT']).resolve() if os.environ.get('VAPOR_PLUGIN_MODE') == '1' else Path(__file__).resolve().parents[2]
manifest = ROOT / 'model-lock.json'
if manifest.exists():
    config = json.loads(manifest.read_text())
else:
    if os.environ.get('VAPOR_PLUGIN_MODE') == '1':
        config = json.loads((Path(__file__).resolve().parents[2] / 'model-lock.json').read_text())
    else:
        repo = 'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit'
        config = {'repo_id': repo, 'revision': HfApi(token=False).model_info(repo).sha,
                  'directory': 'models/qwen3-tts-1.7b-base-8bit'}
    manifest.write_text(json.dumps(config, indent=2) + '\n')
destination = (ROOT / config['directory']).resolve()
if os.environ.get('VAPOR_PLUGIN_MODE') == '1' and config != json.loads((Path(__file__).resolve().parents[2] / 'model-lock.json').read_text()):
    raise ValueError('Vapor downloads only the model revision locked by this plugin release')
if not destination.is_relative_to((ROOT / 'models').resolve()):
    raise ValueError('Model download destination must stay inside project models')
snapshot_download(config['repo_id'], revision=config['revision'], token=False,
                  local_dir=destination)
print('Model ready:', config['directory'])
