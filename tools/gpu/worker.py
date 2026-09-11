"""Allowlisted GPU tasks. This file alone is copied into the Modal image."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import time

# Explicit single-GPU profiles; CPU and memory are container resources, not VRAM.
PROFILES = {
    'T4': {'function':'run_t4', 'cpu':2, 'memory':8192},
    'L4': {'function':'run', 'cpu':2, 'memory':8192},
    'A10': {'function':'run_a10', 'cpu':4, 'memory':16384},
    'L40S': {'function':'run_l40s', 'cpu':4, 'memory':32768},
    'A100-40GB': {'function':'run_a100_40gb', 'cpu':4, 'memory':32768},
    'A100-80GB': {'function':'run_a100_80gb', 'cpu':8, 'memory':65536},
    'H100': {'function':'run_h100', 'cpu':8, 'memory':65536},
    'H200': {'function':'run_h200', 'cpu':8, 'memory':65536},
}


def profile(gpu):
    if not isinstance(gpu, str) or gpu not in PROFILES:
        raise ValueError('Unsupported GPU; choose: ' + ', '.join(PROFILES))
    return dict(PROFILES[gpu], gpu=gpu, timeout=600)


MAX_INPUT = 64 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def revision():
    return digest(Path(__file__).read_bytes())


def execute(request, source, results_root, deployed_profile=None):
    if request['workerRevision'] != revision():
        raise ValueError('Worker revision mismatch; deploy the current worker first')
    selected = profile(request['gpu'])
    if request['task']=='seed-vc':
        selected=dict(selected,function='run_seed_l40s',timeout=1200)
    if request['task']=='qwen-caption':
        selected=dict(profile('A100-80GB'),function='run_caption_a100',timeout=900)
    if request.get('resources') != selected or (deployed_profile is not None and deployed_profile != selected):
        raise ValueError('GPU deployment profile mismatch')
    key = request['key']
    if len(key) != 64 or any(c not in '0123456789abcdef' for c in key):
        raise ValueError('Invalid result key')
    if request['task'] not in ['gpu-smoke', 'demucs', 'seed-vc', 'qwen-caption']:
        raise ValueError('Unsupported GPU task')
    if not isinstance(source, bytes) or len(source) > MAX_INPUT:
        raise ValueError('Input must be bytes, at most 64 MiB')
    if digest(source) != request['inputSha256']:
        raise ValueError('Input hash mismatch')
    output = Path(results_root) / key
    output.mkdir(parents=True, exist_ok=True)
    receipt = output/'result.json'
    if receipt.exists():
        cached = json.loads(receipt.read_text())
        if cached['request'] != request:
            raise ValueError('Result identity mismatch')
        if all(digest((output/a['name']).read_bytes()) == a['sha256'] for a in cached['artifacts']):
            return cached
        raise ValueError('Cached output changed')
    started = time.monotonic()
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError('CUDA unavailable; refusing CPU fallback')
    info = {'requestedGPU':request['gpu'], 'deviceCount':torch.cuda.device_count(),
            'memoryBytes':torch.cuda.get_device_properties(0).total_memory,
            'device':torch.cuda.get_device_name(0), 'torch':torch.__version__, 'cuda':torch.version.cuda}
    if request['task'] == 'gpu-smoke':
        if source:
            raise ValueError('GPU smoke does not accept media')
        torch.manual_seed(0)
        a = torch.randn(512,512,device='cuda')
        result = a @ a.T
        torch.cuda.synchronize()
        if not torch.isfinite(result).all().item():
            raise ValueError('Nonfinite GPU result')
        info['matrixShape'] = list(result.shape)
        (output/'gpu.json').write_text(json.dumps(info,indent=2)+'\n')
        names = ['gpu.json']
    elif request['task']=='qwen-caption':
        caption_audio(request,source,output,info)
        names=['captions.json']
    else:
        # Inputs stay on ephemeral disk; only the requested stems persist.
        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp)/'input.audio'
            if request['task']=='seed-vc':
                import io, zipfile
                with zipfile.ZipFile(io.BytesIO(source)) as z:
                    if set(z.namelist()) != {'source.wav','reference.wav'} or any(i.file_size>MAX_INPUT for i in z.infolist()):
                        raise ValueError('Invalid SVC inputs')
                    audio.write_bytes(z.read('source.wav'))
                    reference=Path(tmp)/'reference.wav'
                    reference.write_bytes(z.read('reference.wav'))
            else:
                audio.write_bytes(source)
            probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(audio)]))
            duration = float(probe['format']['duration'])
            if not 0 < duration <= 300 or not any(s['codec_type']=='audio' for s in probe['streams']):
                raise ValueError('Audio must be at most 300 seconds')
            subprocess.run(['python','-m','demucs','--device','cuda','--name','htdemucs',
                            '--two-stems','vocals','--shifts','0','--float32','--out',tmp,str(audio)],
                           check=True,capture_output=True,timeout=540)
            names = ['vocals.wav','no_vocals.wav']
            for name in names:
                data = (Path(tmp)/'htdemucs'/'input'/name).read_bytes()
                (output/name).write_bytes(data)
            if request['task']=='seed-vc':
                import os
                # The pinned upstream stores checkpoints relative to its checkout.
                os.chdir('/opt/seed-vc')
                converted=Path(tmp)/'converted'
                subprocess.run(['python','inference.py','--source',str(output/'vocals.wav'),
                                '--target',str(reference),'--output',str(converted),
                                '--diffusion-steps','30','--length-adjust','1.0',
                                '--inference-cfg-rate','0.7','--f0-condition','True',
                                '--auto-f0-adjust','False','--semi-tone-shift','0','--fp16','True'],
                               check=True,timeout=850)
                found=list(converted.glob('*.wav'))
                if len(found)!=1:
                    raise ValueError('Expected one converted vocal')
                (output/'converted.wav').write_bytes(found[0].read_bytes())
                names.append('converted.wav')
                from faster_whisper import WhisperModel
                asr=WhisperModel('small',device='cuda',compute_type='float16',download_root='/models/whisper')
                segments,meta=asr.transcribe(str(output/'vocals.wav'),language='zh',word_timestamps=True,vad_filter=False)
                transcript={'language':meta.language,'segments':[{'start':s.start,'end':s.end,'text':s.text,
                    'words':[{'start':w.start,'end':w.end,'text':w.word} for w in (s.words or [])]} for s in segments]}
                (output/'transcript.json').write_text(json.dumps(transcript,ensure_ascii=False,indent=2))
                names.append('transcript.json')
            info['sourceDurationSeconds'] = duration
    record = {'schemaVersion':1,'request':request,'computeSeconds':time.monotonic()-started,
              'hardware':info,'artifacts':[{'name':name,'sha256':digest((output/name).read_bytes()),
                 'bytes':(output/name).stat().st_size} for name in names]}
    temporary = output/'result.tmp'
    temporary.write_text(json.dumps(record,indent=2)+'\n')
    temporary.replace(receipt)
    return record


CAPTION_MODEL = 'Qwen/Qwen3-Omni-30B-A3B-Captioner'
CAPTION_REVISION = 'a2bd106cbf527db5676e79662674da22b0545ec0'


def caption_audio(request, source, output, info):
    import torch
    import soundfile as sf
    from transformers import Qwen3OmniMoeForConditionalGeneration, Qwen3OmniMoeProcessor
    starts=request.get('captionStarts')
    if not isinstance(starts,list) or not 1<=len(starts)<=10 or any(type(t) not in (int,float) or not 0<=t<300 for t in starts):
        raise ValueError('Invalid caption offsets')
    with tempfile.TemporaryDirectory() as tmp:
        original=Path(tmp)/'source.audio'
        original.write_bytes(source)
        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-of','json',str(original)]))
        duration=float(probe['format']['duration'])
        if not 0<duration<=300 or any(t>=duration for t in starts):
            raise ValueError('Invalid audio duration or offsets')
        model=Qwen3OmniMoeForConditionalGeneration.from_pretrained(
            CAPTION_MODEL,revision=CAPTION_REVISION,dtype=torch.bfloat16,
            device_map='cuda:0',attn_implementation='sdpa')
        processor=Qwen3OmniMoeProcessor.from_pretrained(CAPTION_MODEL,revision=CAPTION_REVISION)
        captions=[]
        for start in starts:
            length=min(30,duration-start)
            clip=Path(tmp)/'clip.wav'
            subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-ss',str(start),'-i',str(original),
                '-t',str(length),'-ar','16000','-ac','1',str(clip)],check=True)
            samples,sr=sf.read(clip,dtype='float32')
            conversation=[{'role':'user','content':[{'type':'audio','audio':str(clip)}]}]
            text=processor.apply_chat_template(conversation,add_generation_prompt=True,tokenize=False)
            inputs=processor(text=text,audio=[samples],return_tensors='pt',padding=True,use_audio_in_video=False)
            inputs=inputs.to(model.device).to(model.dtype)
            with torch.inference_mode():
                ids,_=model.generate(**inputs,thinker_return_dict_in_generate=True,
                    thinker_max_new_tokens=768,thinker_do_sample=False,return_audio=False)
            caption=processor.batch_decode(ids.sequences[:,inputs['input_ids'].shape[1]:],skip_special_tokens=True)[0]
            captions.append({'startSeconds':start,'endSeconds':start+length,'caption':caption})
            # Commit each completed segment so a later failure does not erase evidence.
            (output/'captions.partial.json').write_text(json.dumps(captions,ensure_ascii=False,indent=2))
        info['sourceDurationSeconds']=duration
        info['peakAllocatedGPUBytes']=torch.cuda.max_memory_allocated()
        (output/'captions.json').write_text(json.dumps({'model':CAPTION_MODEL,'modelRevision':CAPTION_REVISION,
            'sourceSha256':request['inputSha256'],'segments':captions,'textPrompt':None,
            'fullListeningReviewed':False,'scope':'Model descriptions of sampled audio only'},ensure_ascii=False,indent=2))
