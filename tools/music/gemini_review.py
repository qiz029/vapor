"""Observe generated music and lyric timing with Gemini; never claim human listening."""
import argparse, datetime, json, sys
from pathlib import Path
import soundfile as sf
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from tools.video.vlm_review import GeminiClient, load_api_key, parse_structured_response, sha256_file

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--audio',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--root',type=Path,default=Path.cwd());a=p.parse_args()
    if a.out.exists():raise SystemExit('Existing report retained; choose a deliberate new review path')
    info=sf.info(a.audio);duration=info.duration
    schema={'type':'object','properties':{
      'summary':{'type':'string'},
      'lyrics':{'type':'array','items':{'type':'object','properties':{'start':{'type':'number'},'end':{'type':'number'},'text':{'type':'string'}},'required':['start','end','text']}},
      'sections':{'type':'array','items':{'type':'object','properties':{'start':{'type':'number'},'end':{'type':'number'},'description':{'type':'string'},'approxBPM':{'type':'number'}},'required':['start','end','description','approxBPM']}},
      'issues':{'type':'array','items':{'type':'object','properties':{'start':{'type':'number'},'end':{'type':'number'},'observation':{'type':'string'},'severity':{'type':'string'}},'required':['start','end','observation','severity']}},
      'ending':{'type':'string'}},'required':['summary','lyrics','sections','issues','ending']}
    prompt=f'''Listen to this complete {duration:.3f}-second music file. This is an observation pass, not an approval. In simplified Chinese, describe the ACTUAL voices, instrumental arrangement, energy and style changes with timestamps. Transcribe all audible Mandarin singing into phrase-length segments, giving start/end seconds for every sung phrase; include repeated lyrics and label genuinely unclear words as [听不清]. Never fill missing words from a presumed lyric sheet. Mark instrumental sections separately in sections. Identify audible clipping, pronunciation problems, premature cutoff, unnatural register changes or missing musical closure with exact times. Describe whether call-and-response or distinct operatic choir voices are actually audible, rather than inferred from genre labels. Approximate BPM per section is advisory; put 0 if unknown. Timestamps must be within 0 to {duration:.3f}.'''
    client=GeminiClient(load_api_key(a.root),timeout=240);remote=None;deleted=False
    a.out.parent.mkdir(parents=True,exist_ok=True)
    try:
        remote=client.upload(a.audio,'audio/wav');active=client.wait_until_active(remote)
        response=client.interact([{'type':'audio','uri':active['uri'],'mime_type':'audio/wav'},
                                 {'type':'text','text':prompt}],schema)
        a.out.with_suffix('.raw.json').write_text(json.dumps(response,ensure_ascii=False,indent=2)+'\n')
        analysis=parse_structured_response(response)
        timestamp_issues=[]
        for field in ['lyrics','sections','issues']:
            for item in analysis[field]:
                if not 0<=item['start']<item['end']<=duration+.25:
                    timestamp_issues.append({'field':field,'item':item})
        report={'model':'gemini-3.8-flash','artifact':{'path':str(a.audio.resolve()),'sha256':sha256_file(a.audio),'duration':duration},
                'analysis':analysis,'usage':response.get('usage',{}),'fullHumanListeningReviewed':False,
                'requestedObservationRange':[0,duration],'evidenceType':'model-assisted audio observations',
                'timestampValidationIssues':timestamp_issues,
                'recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
        a.out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({'report':str(a.out),'phrases':len(analysis['lyrics']),'summary':analysis['summary'],'issues':analysis['issues']},ensure_ascii=False),flush=True)
    finally:
        if remote:
            try:client.delete_file(remote['name']);deleted=True
            finally:a.out.with_suffix('.retention.json').write_text(json.dumps({'store':False,'uploadDeleted':deleted,'remoteName':remote['name']},indent=2)+'\n')

if __name__=='__main__':main()
