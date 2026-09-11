"""Project-local Modal GPU jobs: plan, submit, resume, reconcile and settle."""
import argparse
import datetime
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from tools.video.job_store import JobStore, atomic_json, sha256
from tools.gpu.worker import MAX_INPUT, revision, profile

APP = 'agent-media-lab-gpu-v1'
VOLUME = 'agent-media-lab-gpu-results-v1'


def prepare(plan, base):
    if plan.get('schemaVersion') != 1 or plan.get('task') not in ['gpu-smoke','demucs','seed-vc','qwen-caption']:
        raise ValueError('Supported tasks: gpu-smoke, demucs, seed-vc, qwen-caption')
    if not re.fullmatch(r'[A-Za-z0-9_-]+',plan.get('id','')):
        raise ValueError('Invalid job ID')
    for field in ['budgetUSD','estimatedUSD','reservedUSD']:
        value=plan.get(field)
        if type(value) not in (int,float) or not math.isfinite(value) or value <= 0:
            raise ValueError('Invalid '+field)
    if not plan['estimatedUSD'] <= plan['reservedUSD'] <= plan['budgetUSD']:
        raise ValueError('Require estimate <= reservation <= budget')
    resources = profile(plan.get('gpu', 'L4'))
    if plan.get('pricingGPU', 'L4') != resources['gpu']:
        raise ValueError('pricingGPU must match gpu; refresh this GPU pricing and reservation')
    source=b''
    if plan['task'] in ['demucs','seed-vc','qwen-caption']:
        path=(base/plan['input']).resolve()
        if not path.is_file() or path.stat().st_size > MAX_INPUT:
            raise ValueError('Expected an audio file at most 64 MiB')
        source=path.read_bytes()
        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(path)]))
        if not 0<float(probe['format']['duration'])<=300 or not any(s['codec_type']=='audio' for s in probe['streams']):
            raise ValueError('Expected audio at most 300 seconds')
    elif plan.get('input'):
        raise ValueError('gpu-smoke does not accept input media')
    if plan['task']=='seed-vc':
        if resources['gpu'] != 'L40S':
            raise ValueError('Seed-VC currently uses its dedicated L40S image')
        import io, zipfile
        ref_path=(base/plan['reference']).resolve()
        if ref_path.stat().st_size>5*1024*1024:
            raise ValueError('Reference too large')
        ref_probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(ref_path)]))
        if not 1<=float(ref_probe['format']['duration'])<=30 or not any(s['codec_type']=='audio' for s in ref_probe['streams']):
            raise ValueError('Reference must contain 1..30 seconds of audio')
        reference = ref_path.read_bytes()
        packed=io.BytesIO()
        with zipfile.ZipFile(packed,'w') as z:
            z.writestr(zipfile.ZipInfo('source.wav'),source)
            z.writestr(zipfile.ZipInfo('reference.wav'),reference)
        source=packed.getvalue()
        resources=dict(resources,function='run_seed_l40s',timeout=1200)
    if plan['task']=='qwen-caption':
        if resources['gpu']!='A100-80GB':
            raise ValueError('Captioner requires A100-80GB')
        starts=plan.get('captionStarts')
        if not isinstance(starts,list) or not 1<=len(starts)<=10 or any(type(t) not in (int,float) or not math.isfinite(t) or not 0<=t<float(probe['format']['duration']) for t in starts):
            raise ValueError('Invalid captionStarts')
        resources=dict(resources,function='run_caption_a100',timeout=900)
    spec={'task':plan['task'],'inputSha256':hashlib.sha256(source).hexdigest(),
          'workerRevision':revision(),'app':APP,'gpu':resources['gpu'], 'resources':resources}
    if plan['task']=='qwen-caption':
        spec['captionStarts']=starts
    fingerprint=hashlib.sha256(json.dumps(spec,sort_keys=True).encode()).hexdigest()
    key=hashlib.sha256((plan['id']+fingerprint).encode()).hexdigest()
    return dict(spec,key=key),source,fingerprint


class ModalBackend:
    def __init__(self):
        import modal
        self.modal=modal
    def submit(self,request,source):
        resources = profile(request['gpu'])
        if request['task']=='seed-vc':
            resources=dict(resources,function='run_seed_l40s',timeout=1200)
        if request['task']=='qwen-caption':
            resources=dict(profile('A100-80GB'),function='run_caption_a100',timeout=900)
        if request['resources'] != resources:
            raise ValueError('GPU profile changed')
        return self.modal.Function.from_name(APP,resources['function']).spawn(request,source).object_id
    def poll(self,call_id):
        try:
            return self.modal.FunctionCall.from_id(call_id).get(timeout=0)
        except TimeoutError:
            return None
    def read(self,key,name):
        return self.modal.Volume.from_name(VOLUME).read_file(key+'/'+name)


def validate_record(record,request):
    if record.get('schemaVersion')!=1 or record.get('request')!=request:
        raise ValueError('Remote result does not match submitted job')
    expected={'gpu.json'} if request['task']=='gpu-smoke' else ({'converted.wav','vocals.wav','no_vocals.wav','transcript.json'} if request['task']=='seed-vc' else {'vocals.wav','no_vocals.wav'})
    if request['task']=='qwen-caption':
        expected={'captions.json'}
    items=record['artifacts']
    if len(items)!=len(expected) or {a['name'] for a in items}!=expected:
        raise ValueError('Unexpected result artifacts')
    for item in items:
        if not re.fullmatch('[a-f0-9]{64}',item['sha256']) or type(item['bytes']) is not int or not 0<item['bytes']<=256*1024*1024:
            raise ValueError('Invalid artifact integrity metadata')


def run(plan,out,base,allow_paid=False,backend=None):
    request,source,fingerprint=prepare(plan,base)
    with JobStore(out,plan['budgetUSD']) as store:
        jid=plan['id']
        existing=store.data['jobs'].get(jid)
        if existing is None:
            if not allow_paid:
                raise ValueError('New GPU jobs require --allow-paid and an authorized budget')
            if not plan.get('pricingSource') or datetime.date.fromisoformat(plan.get('priceValidThrough','2000-01-01')) < datetime.date.today():
                raise ValueError('Refresh pricingSource and priceValidThrough')
        # Construct SDK before reserving; missing local dependency is not a lost submission.
        if backend is None and (existing is None or existing['state'] not in ['downloaded','submitting','submission_unknown','failed','cancelled']):
            backend=ModalBackend()
        entry,fresh=store.reserve(jid,fingerprint,plan['reservedUSD'],plan['estimatedUSD'],None)
        spec_path=store.directory/(jid+'.request.json')
        if not spec_path.exists():
            atomic_json(spec_path,request)
        elif json.loads(spec_path.read_text())!=request:
            raise ValueError('Saved request differs from plan')
        if fresh:
            try:
                call_id=backend.submit(request,source)
                if not isinstance(call_id,str) or not re.fullmatch(r'fc-[A-Za-z0-9_-]+',call_id):
                    raise ValueError('Invalid Modal call ID')
            except Exception:
                store.transition(jid,'submission_unknown')
                raise RuntimeError('Modal submission outcome unknown; reconcile call ID, do not resubmit') from None
            store.transition(jid,'submitted',request={'call_id':call_id},resultKey=request['key'])
        if entry['state'] in ['submitting','submission_unknown']:
            raise RuntimeError('Submission unknown; recover call ID from Modal dashboard, no automatic retry')
        if entry['state'] in ['failed','cancelled']:
            raise RuntimeError('Terminal job; reservation retained pending billing')
        target=store.directory/jid
        if entry['state']=='downloaded':
            for item in entry['artifacts']:
                path=target/item['name']
                if not path.is_file() or sha256(path)!=item['sha256']:
                    raise ValueError('Cached output missing or changed; no resubmission')
            return entry
        receipt=store.directory/(jid+'.result.json')
        if receipt.exists():
            record=json.loads(receipt.read_text())
        else:
            # Read durable volume first, including after Modal's call-result retention expires.
            try:
                record=json.loads(b''.join(backend.read(request['key'],'result.json')))
            except FileNotFoundError:
                record=backend.poll(entry['request']['call_id'])
            if record is None:
                return entry
        validate_record(record,request)
        atomic_json(receipt,record)
        store.transition(jid,'completed')
        target.mkdir(exist_ok=True)
        for item in record['artifacts']:
            dest=target/item['name']
            if dest.is_file() and sha256(dest)==item['sha256']:
                continue
            temp=dest.with_suffix(dest.suffix+'.download')
            size=0
            with temp.open('wb') as stream:
                for chunk in backend.read(request['key'],item['name']):
                    size+=len(chunk)
                    if size>item['bytes']:
                        raise ValueError('Artifact exceeds recorded size')
                    stream.write(chunk)
                stream.flush()
                import os
                os.fsync(stream.fileno())
            if size!=item['bytes'] or sha256(temp)!=item['sha256']:
                raise ValueError('Downloaded artifact failed hash verification')
            if dest.suffix=='.wav':
                subprocess.run(['ffmpeg','-nostdin','-v','error','-xerror','-i',str(temp),'-f','null','-'],check=True,capture_output=True)
            temp.replace(dest)
        store.transition(jid,'downloaded',artifacts=record['artifacts'],elapsedSeconds=time.time()-entry['started'],
                         computeSeconds=record['computeSeconds'],fullListeningReviewed=False)
        return entry


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('action',choices=['plan','run','status','reconcile','settle','mark-terminal'])
    p.add_argument('--plan',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    p.add_argument('--allow-paid',action='store_true')
    p.add_argument('--call-id')
    p.add_argument('--evidence',default='')
    p.add_argument('--actual-usd',type=float)
    p.add_argument('--state',choices=['failed','cancelled'])
    args=p.parse_args()
    try:
        plan=json.loads(args.plan.read_text())
        if args.action=='plan':
            request,source,_=prepare(plan,args.plan.resolve().parent)
            value={'request':request,'uploadBytes':len(source),'estimatedUSD':plan['estimatedUSD'],
                   'reservedUSD':plan['reservedUSD'],'budgetUSD':plan['budgetUSD'],'submits':False,'pricingVerified':False}
        elif args.action=='run':
            value=run(plan,args.out,args.plan.resolve().parent,args.allow_paid)
        else:
            # Recovery does not require the original media or current worker source.
            if not (args.out/'ledger.json').is_file():
                raise ValueError('Ledger not found')
            with JobStore(args.out,plan['budgetUSD']) as store:
                jid=plan['id']
                if args.action=='reconcile':
                    if not args.call_id or not re.fullmatch(r'fc-[A-Za-z0-9_-]+',args.call_id):
                        raise ValueError('Provide a verified --call-id')
                    store.attach_request(jid,{'call_id':args.call_id},args.evidence)
                elif args.action=='settle':
                    if args.actual_usd is None:
                        raise ValueError('Provide --actual-usd and --evidence')
                    store.settle(jid,args.actual_usd,args.evidence)
                elif args.action=='mark-terminal':
                    if not args.state or not args.evidence.strip() or store.data['jobs'][jid]['state'] not in ['submitted','submission_unknown']:
                        raise ValueError('Verify terminal remote state and provide --state and --evidence')
                    store.event(jid,'remote-terminal-verified',evidence=args.evidence)
                    store.transition(jid,args.state)
                value=store.data
        print(json.dumps(value,ensure_ascii=False,indent=2))
    except Exception as error:
        # SDK/network errors can include credentials or signed URLs. Keep their bodies out of logs.
        message=str(error) if isinstance(error,(ValueError,RuntimeError)) and type(error).__module__=='builtins' else type(error).__name__
        p.exit(1,message+'\n')


if __name__=='__main__':
    main()
