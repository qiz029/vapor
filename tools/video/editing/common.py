"""Load a hash-verified video-use helper and resolve registered input assets."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from tools.video.job_store import sha256


def upstream(name):
    lock=json.loads((ROOT/'skills/upstream-lock.json').read_text())['video-use']
    directory=ROOT/lock['path']
    for file,digest in lock['sha256'].items():
        if sha256(directory/file)!=digest:
            raise ValueError('Vendored video-use changed: '+file)
    helpers=directory/'helpers'
    spec=importlib.util.spec_from_file_location('video_use_'+name,helpers/(name+'.py'))
    module=importlib.util.module_from_spec(spec)
    sys.path.insert(0,str(helpers))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(str(helpers))
    return module


def probe(path):
    return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(path)]))


def asset(project,ref):
    project=Path(project).resolve()
    doc=json.loads(project.read_text())
    record=next((a for a in doc['assets'] if 'asset:'+a['id']==ref),None)
    if record is None:
        raise ValueError('Unknown asset '+ref)
    path=(project.parent/record['path']).resolve()
    if not path.is_relative_to(project.parent) or not path.is_file() or sha256(path)!=record['sha256']:
        raise ValueError('Missing, escaped or changed registered asset '+ref)
    return path,record
