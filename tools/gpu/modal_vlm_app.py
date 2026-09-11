"""Optional Qwen3-VL backend. Deploy only for an authorized visual review task."""
from pathlib import Path
import modal
app=modal.App('agent-media-lab-vlm-v2',include_source=False)
cache=modal.Volume.from_name('agent-media-lab-gpu-models-v1',create_if_missing=True)
results=modal.Volume.from_name('agent-media-lab-gpu-results-v1',create_if_missing=True)
image=(modal.Image.debian_slim(python_version='3.11')
 .pip_install('torch==2.8.0','torchvision==0.23.0','transformers==4.57.6','accelerate==1.12.0','pillow==11.3.0')
 .env({'PYTHONPATH':'/opt'})
 .add_local_file(Path(__file__).with_name('vlm_worker.py'),'/opt/vlm_worker.py',copy=True))
@app.function(image=image,gpu='L40S',cpu=4,memory=32768,timeout=900,startup_timeout=600,retries=0,min_containers=0,max_containers=1,scaledown_window=2,volumes={'/models':cache,'/results':results},serialized=True)
def review(request:dict,source:bytes):
 import vlm_worker
 results.reload()
 def commit():
  cache.commit();results.commit()
 try:return vlm_worker.execute(request,source,'/models/qwen-vl','/results',commit)
 finally:commit()
