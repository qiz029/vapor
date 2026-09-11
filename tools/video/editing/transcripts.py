"""Source-hash-bound transcript import, packing and opt-in Scribe calls."""
import argparse
import fcntl
import hashlib
import json
import math
import os
import re
from pathlib import Path
import subprocess
import sys
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parents[3]))
from tools.video.editing.common import asset,probe,upstream
from tools.video.editing.edit import validate_words
from tools.video.job_store import atomic_json
from tools.project.workflow import register


def ingest(project,source_ref,asset_id,raw,origin,track=0):
    project=Path(project).resolve();source,record=asset(project,source_ref)
    info=probe(source);tracks=[s for s in info['streams'] if s['codec_type']=='audio']
    if type(track) is not int or not 0<=track<len(tracks):
        raise ValueError('Invalid source audio track')
    if raw.get('sourceSha256',record['sha256'])!=record['sha256']:
        raise ValueError('Imported transcript has a different source hash')
    if raw.get('audioTrack',track)!=track:
        raise ValueError('Imported transcript has a different audio track')
    payload=dict(raw,sourceSha256=record['sha256'],audioTrack=track,provenance=origin)
    validate_words(payload,float(info['format']['duration']))
    with tempfile.TemporaryDirectory(prefix='video-use-transcript-') as temp:
        path=Path(temp)/'transcript.json';atomic_json(path,payload)
        return register(project,path,asset_id,'transcript','video-editing',[source_ref],origin)


def cloud(project,source_ref,asset_id,allow_upload,estimate,budget,track=0,language=None):
    if not isinstance(asset_id,str) or not re.fullmatch(r'[A-Za-z0-9_-]+',asset_id):
        raise ValueError('Invalid transcript asset ID')
    if not allow_upload:
        raise ValueError('Cloud transcription requires explicit --allow-upload after authorization')
    if not all(type(v) in (int,float) and math.isfinite(v) and v>0 for v in [estimate,budget]) or estimate>budget:
        raise ValueError('Provide a positive estimate within the authorized transcription budget')
    project=Path(project).resolve();source,record=asset(project,source_ref)
    info=probe(source);tracks=[s for s in info['streams'] if s['codec_type']=='audio']
    if type(track) is not int or not 0<=track<len(tracks):
        raise ValueError('Invalid audio track')
    settings={'sourceSha256':record['sha256'],'track':track,'language':language,'model':'scribe_v1'}
    fingerprint=hashlib.sha256(json.dumps(settings,sort_keys=True).encode()).hexdigest()
    directory=project.parent/'transcript-cache'/fingerprint
    directory.mkdir(parents=True,exist_ok=True)
    with (directory/'lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        result=directory/'result.json';state=directory/'request.json'
        if not result.exists():
            if state.exists():
                raise ValueError('Prior Scribe outcome unknown; inspect provider records, do not blindly re-upload')
            key=os.environ.get('ELEVENLABS_API_KEY','')
            if not key:
                raise ValueError('Set ELEVENLABS_API_KEY locally before an authorized cloud call')
            helper=upstream('transcribe')
            with tempfile.TemporaryDirectory(prefix='video-use-scribe-') as temp:
                wav=Path(temp)/'speech.wav';helper.extract_audio(source,wav,track)
                if helper.peak_dbfs(wav)<-60:
                    raise ValueError('Selected track is silent; no upload made')
                atomic_json(state,{'settings':settings,'state':'submission_unknown','reservedUSD':estimate,'budgetUSD':budget,'actualUSD':None})
                try:
                    # Adapter avoids upstream error-body logging and redirects with credentials.
                    import requests
                    data={'model_id':'scribe_v1','diarize':'true','tag_audio_events':'true','timestamps_granularity':'word'}
                    if language:
                        data['language_code']=language
                    with wav.open('rb') as audio:
                        response=requests.post(helper.SCRIBE_URL,headers={'xi-api-key':key},data=data,
                            files={'file':('speech.wav',audio,'audio/wav')},timeout=1800,allow_redirects=False)
                    if response.status_code!=200:
                        raise RuntimeError('Scribe HTTP '+str(response.status_code))
                    raw=response.json()
                    atomic_json(result,raw)
                except Exception:
                    raise RuntimeError('Scribe request failed or outcome unknown; reservation retained; no automatic retry') from None
                atomic_json(state,{'settings':settings,'state':'received','reservedUSD':estimate,'budgetUSD':budget,'actualUSD':None})
        return ingest(project,source_ref,asset_id,json.loads(result.read_text()),
                      'ElevenLabs Scribe word transcript; cache '+fingerprint,track)


def pack(project,refs,out):
    out=Path(out)
    if out.exists():
        raise ValueError('Output exists')
    helper=upstream('pack_transcripts')
    lines=['# Source transcripts','']
    for ref in refs:
        path,record=asset(project,ref);doc=json.loads(path.read_text())
        source_refs=[d for d in record['dependsOn'] if d.startswith('asset:')]
        if len(source_refs)!=1:
            raise ValueError('Transcript must have one source dependency')
        _,source_record=asset(project,source_refs[0])
        if source_record['sha256']!=doc.get('sourceSha256'):
            raise ValueError('Transcript source changed')
        phrases=helper.group_into_phrases(doc['words'])
        lines.append('## '+ref)
        for phrase in phrases:
            lines.append(f"[{phrase['start']:.3f}-{phrase['end']:.3f}] {phrase.get('speaker_id') or ''} {phrase['text']}")
        lines.append('')
    out.parent.mkdir(parents=True,exist_ok=True)
    with out.open('x') as stream:
        stream.write('\n'.join(lines))


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('command',choices=['import','cloud','pack'])
    p.add_argument('--project',type=Path,required=True)
    p.add_argument('--source');p.add_argument('--id');p.add_argument('--input',type=Path);p.add_argument('--origin')
    p.add_argument('--audio-track',type=int,default=0);p.add_argument('--language')
    p.add_argument('--allow-upload',action='store_true');p.add_argument('--estimated-usd',type=float);p.add_argument('--budget-usd',type=float)
    p.add_argument('--transcripts',nargs='+');p.add_argument('--out',type=Path)
    a=p.parse_args()
    try:
        if a.command=='pack':
            if not a.transcripts or not a.out:
                raise ValueError('pack requires --transcripts and --out')
            pack(a.project,a.transcripts,a.out);return
        if not a.source or not a.id:
            raise ValueError('--source and --id required')
        if a.command=='import':
            if not a.input or not a.origin:
                raise ValueError('import requires --input and --origin')
            result=ingest(a.project,a.source,a.id,json.loads(a.input.read_text()),a.origin,a.audio_track)
        else:
            result=cloud(a.project,a.source,a.id,a.allow_upload,a.estimated_usd,a.budget_usd,a.audio_track,a.language)
        print(json.dumps(result,ensure_ascii=False))
    except (ValueError,RuntimeError,OSError,KeyError,subprocess.CalledProcessError) as error:
        p.exit(1,str(error)+'\n')


if __name__=='__main__':
    main()
