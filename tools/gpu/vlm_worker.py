"""Bounded image-sequence VLM observations; no acceptance decisions or media retention."""
import hashlib,io,json,math,os,re,time,zipfile
from pathlib import Path
MODEL='Qwen/Qwen3-VL-8B-Instruct'
MAX_ARCHIVE=48*1024*1024

def revision():
 return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()

def unpack(request,source):
 if len(source)>MAX_ARCHIVE or hashlib.sha256(source).hexdigest()!=request['inputSha256']:raise ValueError('Input integrity/size')
 if request['workerRevision']!=revision():raise ValueError('Worker changed')
 if not re.fullmatch('[a-f0-9]{40}',request['modelRevision']):raise ValueError('Pinned model revision required')
 if not re.fullmatch('[a-f0-9]{64}',request['key']):raise ValueError('Invalid key')
 with zipfile.ZipFile(io.BytesIO(source)) as z:
  infos=z.infolist()
  if len({x.filename for x in infos})!=len(infos) or len(infos)>500 or sum(x.file_size for x in infos)>MAX_ARCHIVE:raise ValueError('Archive bounds')
  if any(not re.fullmatch(r'(manifest\.json|[A-Za-z0-9_-]+\.jpg)',x.filename) for x in infos):raise ValueError('Unexpected member')
  manifest=json.loads(z.read('manifest.json'));shots=manifest['shots']
  if not 1<=len(shots)<=40:raise ValueError('Batch size')
  if len({s['id'] for s in shots})!=len(shots):raise ValueError('Duplicate shot ID')
  blobs={}
  for shot in shots:
   if not re.fullmatch('[A-Za-z0-9_-]+',shot['id']) or not isinstance(shot['expected'],str) or len(shot['expected'])>5000:raise ValueError('Invalid shot')
   if not re.fullmatch('[a-f0-9]{64}',shot.get('sourceSha256','')):raise ValueError('Source hash')
   if not isinstance(shot.get('neighbours',''),str) or len(shot.get('neighbours',''))>5000:raise ValueError('Neighbour context')
   if shot.get('kind','video') not in ['image','video']:raise ValueError('Unsupported visual source')
   if shot.get('kind')=='image':
    if len(shot['frames'])!=1 or set(shot['frames'][0])!={'file'}:raise ValueError('Still image frame contract')
    blobs[shot['frames'][0]['file']]=z.read(shot['frames'][0]['file'])
    continue
   if not 2<=len(shot['frames'])<=12:raise ValueError('Frame bounds')
   times=[f['seconds'] for f in shot['frames']]
   if any(type(t) not in (int,float) for t in times) or any(b<=a for a,b in zip(times,times[1:])):raise ValueError('Ordered timestamps required')
   for frame in shot['frames']:
    if not math.isfinite(frame['seconds']) or frame['seconds']<0:raise ValueError('Timestamp')
    blobs[frame['file']]=z.read(frame['file'])
   blobs[shot['reference']]=z.read(shot['reference'])
 return manifest,blobs

def atomic_record(path, value):
 temporary=path.with_suffix('.tmp')
 with temporary.open('w') as stream:
  json.dump(value,stream,ensure_ascii=False,indent=2,allow_nan=False)
  stream.flush();os.fsync(stream.fileno())
 os.replace(temporary,path)

def review_prompt(shot):
 if shot.get('kind')=='image':
  return ('Inspect only the supplied still image. Do not infer sound, movement or events outside it. '
   'Return ONLY compact JSON with exactly observations (nonempty string), concerns (at most two objects '
   'with criterion, timestamps: [], severity: minor/major/uncertain, description, repair), '
   'recommendation: candidate/needs_review, and limits (nonempty string). '
   'A still image has no temporal evidence; timestamps must be empty. Suggestions are advisory, never approval. '
   'Keep under 180 words. Inspection question: '+shot['expected'])
 return ('Describe only the supplied video samples. The first image is a storyboard REFERENCE, '
 'not a video frame and not evidence that an action occurred. First describe the sampled start, '
 'change and end. Evaluate only requirements explicitly applicable to THIS shot. '
 'Neighbour descriptions are context, not requirements to apply to every frame. '
 'Do not transfer later injury, helmet or costume states to earlier scenes. '
 'Track the same individual across frames: when the lead subject exits and a follower takes their place, do not call the follower a changed version of the lead subject. If identity cannot be established, report uncertainty rather than a continuity defect. For any claimed change or disappearance, cite both before and after sample timestamps and identify the subject. '
 'An intentional setup may end before the action in the next shot. Different opposing uniforms '
 'are not an identity defect. Do not infer audio, exact crowd counts or continuous physics. '
 'Return ONLY compact JSON with exactly these keys: '
 '{"observations":"short factual description",'
 '"concerns":[{"criterion":"name","timestamps":[0.0],'
 '"severity":"minor/major/uncertain","description":"visible evidence or explicit uncertainty",'
 '"repair":"suggestion"}],"recommendation":"candidate/trim/regenerate/needs_review",'
 '"limits":"unobserved intervals and other limits"}. '
 'Use at most two concerns, empty if none; cite only supplied VIDEO timestamps. '
 'Suggestions are advisory, never approval. Keep under 180 words. '
 'Current shot brief: '+shot['expected']+'\nAdjacent context: '+shot.get('neighbours',''))

def parse_response(answer, sampled_seconds, truncated=False):
 if truncated:return None,'generation_token_limit'
 text=answer.strip()
 if text.startswith('```'):
  text=re.sub(r'^```(?:json)?\s*','',text);text=re.sub(r'\s*```$','',text)
 try:
  value=json.loads(text)
  if not isinstance(value,dict) or set(value)!={'observations','concerns','recommendation','limits'}:raise ValueError('schema')
  if any(not isinstance(value[k],str) or not value[k].strip() for k in ['observations','limits']):raise ValueError('description')
  if value['recommendation'] not in ['candidate','trim','regenerate','needs_review']:raise ValueError('recommendation')
  if not isinstance(value['concerns'],list) or len(value['concerns'])>2:raise ValueError('concerns')
  for c in value['concerns']:
   if not isinstance(c,dict) or set(c)!={'criterion','timestamps','severity','description','repair'}:raise ValueError('concern schema')
   if any(not isinstance(c[k],str) or not c[k].strip() for k in ['criterion','description','repair']):raise ValueError('concern text')
   if c['severity'] not in ['minor','major','uncertain']:raise ValueError('severity')
   if not isinstance(c['timestamps'],list) or (sampled_seconds and not c['timestamps']):raise ValueError('missing evidence timestamps')
   for t in c['timestamps']:
    if type(t) not in (float,int) or not math.isfinite(t) or not any(abs(t-s)<=0.0011 for s in sampled_seconds):raise ValueError('unsampled timestamp')
  return value,None
 except (ValueError,TypeError,KeyError):return None,'invalid_json_schema_or_evidence'

def execute(request,source,cache_dir,results_dir,commit=lambda:None):
 started=time.monotonic();manifest,blobs=unpack(request,source)
 out=Path(results_dir)/request['key'];out.mkdir(exist_ok=True,parents=True);target=out/'observations.json'
 if target.exists():
  record=json.loads(target.read_text())
  if record['request']!=request:raise ValueError('Result identity')
  return record
 import torch
 from PIL import Image
 from transformers import AutoProcessor,Qwen3VLForConditionalGeneration
 processor=AutoProcessor.from_pretrained(MODEL,revision=request['modelRevision'],cache_dir=cache_dir)
 model=Qwen3VLForConditionalGeneration.from_pretrained(MODEL,revision=request['modelRevision'],cache_dir=cache_dir,torch_dtype=torch.bfloat16,device_map='auto',attn_implementation='sdpa').eval()
 commit()
 partial=out/'partial.json';records=json.loads(partial.read_text()) if partial.exists() else []
 done={r['id'] for r in records}
 for shot in manifest['shots']:
  if shot['id'] in done:continue
  images=[];content=[]
  inputs_for_shot=([('Source still image',shot['frames'][0]['file'])] if shot.get('kind')=='image' else [('Reference image (not a video sample)',shot['reference'])]+[(f"Video sample at {f['seconds']:.3f} seconds",f['file']) for f in shot['frames']])
  for label,name in inputs_for_shot:
   im=Image.open(io.BytesIO(blobs[name])).convert('RGB');im.thumbnail((672,672));images.append(im)
   content.extend([{'type':'text','text':label},{'type':'image'}])
  prompt=review_prompt(shot)
  content.append({'type':'text','text':prompt})
  text=processor.apply_chat_template([{'role':'user','content':content}],tokenize=False,add_generation_prompt=True)
  inputs=processor(text=[text],images=images,return_tensors='pt',padding=True).to(model.device)
  with torch.inference_mode():ids=model.generate(**inputs,max_new_tokens=768,do_sample=False)
  answer=processor.batch_decode(ids[:,inputs['input_ids'].shape[1]:],skip_special_tokens=True)[0]
  sampled=[] if shot.get('kind')=='image' else [x['seconds'] for x in shot['frames']]
  parsed,error=parse_response(answer,sampled,ids.shape[1]-inputs['input_ids'].shape[1]>=768)
  records.append({'id':shot['id'],'sourceSha256':shot['sourceSha256'],'sampledSeconds':sampled,'rawResponse':answer,'parsedResponse':parsed,'responseStatus':'valid' if error is None else 'needs_review','validationError':error,'evidenceScope':{'modality':'still_image' if shot.get('kind')=='image' else 'sampled_images','audioReviewed':False,'continuousMotionReviewed':False,'identityTrackingVerified':False}})
  atomic_record(partial,records);commit()
 record={'schemaVersion':2,'hardware':{'gpu':torch.cuda.get_device_name(0),'torch':torch.__version__},'request':request,'model':MODEL,'modality':'images-and-video-samples','observations':records,'elapsedSeconds':time.monotonic()-started,'fullPlaybackReviewed':False,'acceptance':'not_decided','unreviewed':'All temporal intervals between video samples; audio; final edited sequence unless separately submitted'}
 atomic_record(target,record);commit();return record
