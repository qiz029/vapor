"""Small deterministic media regression suite; measured runtime and explicit review gaps."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import numpy as np
import soundfile as sf
from tools.video.job_store import atomic_json, sha256
from tools.audio.mix import mix
from tools.captions.align import export
from tools.project.workflow import register
from tools.video.finalize import finalize

ROOT=Path(__file__).resolve().parents[2]


def implementation_hash():
    files=[]
    for base in ['tools','skills']:
        files.extend(p for p in (ROOT/base).rglob('*') if p.suffix in ['.py','.ts','.tsx','.md','.json'] and '__pycache__' not in p.parts)
    files += [p for p in [ROOT/'package-lock.json',ROOT/'requirements-media-tools.txt'] if p.is_file()]
    return hashlib.sha256(json.dumps({str(p.relative_to(ROOT)):sha256(p) for p in sorted(files)},sort_keys=True).encode()).hexdigest()


def render(manifest,out):
    command=[os.environ.get('VAPOR_NODE', 'node'),'--import','tsx',str(ROOT/'tools/video/remotion/cli.ts'),'render','--manifest',str(manifest),'--out',str(out)]
    result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True)
    (out.parent/'render.log').write_text(result.stdout+result.stderr)
    if result.returncode:
        raise RuntimeError('Render failed; see render.log')
    return json.loads((out/'report.json').read_text())


def run(out):
    out=Path(out).resolve()
    out.mkdir(parents=True,exist_ok=False)
    start=time.monotonic()
    suite=json.loads((ROOT/'examples/regression/suite.json').read_text())
    report={'schemaVersion':1,'suiteSha256':sha256(ROOT/'examples/regression/suite.json'),
            'implementationSha256':implementation_hash(),'cases':[],
            'costScope':'No provider calls; local compute cost not measured',
            'providerCostUSD':0,'localComputeCostUSD':None}
    for case in suite['cases']:
        case_out=out/case['id'];case_out.mkdir()
        began=time.monotonic()
        record={'id':case['id'],'technical':'failed','qualityReview':None,'humanReworkMinutes':None,
                'artifactSha256':None,'expectations':case['expectations']}
        try:
            manifest=case['manifest']
            if case['id']=='audio-captions':
                doc=json.loads((ROOT/'examples/production/project.json').read_text())
                project=case_out/'project.json';atomic_json(project,doc)
                rate=48000;t=np.arange(rate)/rate
                for i,freq in enumerate([180,310]):
                    sf.write(case_out/f'tone-{i}.wav',.12*np.sin(2*np.pi*(freq*t+40*t*t)),rate,subtype='FLOAT')
                # Tones are signal fixtures, never evidence of spoken words or natural delivery.
                plan={'duration':3,'narration':[{'source':'tone-0.wav','narration':'request','at':0},
                                               {'source':'tone-1.wav','narration':'return','at':1.5}]}
                atomic_json(case_out/'mix-plan.json',plan)
                mix(project,case_out/'mix-plan.json',case_out/'mix')
                export(project,case_out/'mix/mix.wav',case_out/'mix/alignment.json',case_out/'captions','asset:final-mix')
                record['speechFixture']='synthetic tones; no semantic or listening acceptance'
            atomic_json(case_out/'manifest.json',manifest)
            render_report=render(case_out/'manifest.json',case_out/'render')
            artifact=case_out/'render/final.mp4'
            if case['id']=='audio-captions':
                register(project,artifact,'picture','video','video-production',['shot:request','shot:return'],'Regression clean picture master')
                final_report=finalize(project,artifact,case_out/'mix/mix.wav',case_out/'mix/alignment.json',case_out/'delivery','asset:picture','asset:final-mix',captions_asset='asset:final-captions-srt')
                artifact=case_out/'delivery/final.mp4'
                record['finalization']=final_report
            record.update(technical='passed',artifact=str(artifact),artifactSha256=sha256(artifact),render=render_report['technical'])
        except (ValueError,OSError,KeyError,RuntimeError,subprocess.CalledProcessError) as error:
            record['error']=str(error)
        record['elapsedSeconds']=time.monotonic()-began
        report['cases'].append(record)
        atomic_json(out/'report.json',report)
    report['elapsedSeconds']=time.monotonic()-start
    report['failureRate']=sum(c['technical']=='failed' for c in report['cases'])/len(report['cases'])
    report['qualityCoverage']=0
    atomic_json(out/'report.json',report)
    return report


def compare(before,after):
    if before['suiteSha256']!=after['suiteSha256']:
        raise ValueError('Suite changed; do not compare unlike fixtures')
    old={c['id']:c for c in before['cases']}
    if set(old)!={c['id'] for c in after['cases']}:
        raise ValueError('Case sets differ')
    return {'schemaVersion':1,'beforeImplementation':before['implementationSha256'],
            'afterImplementation':after['implementationSha256'],
            'failureRateDelta':after['failureRate']-before['failureRate'],
            'elapsedSecondsDelta':after['elapsedSeconds']-before['elapsedSeconds'],
            'cases':[{'id':c['id'],'before':old[c['id']]['technical'],'after':c['technical'],
                      'elapsedSecondsDelta':c['elapsedSeconds']-old[c['id']]['elapsedSeconds'],
                      'beforeQuality':old[c['id']].get('qualityReview'),'afterQuality':c.get('qualityReview'),
                      'beforeReworkMinutes':old[c['id']].get('humanReworkMinutes'),
                      'afterReworkMinutes':c.get('humanReworkMinutes')} for c in after['cases']],
            'providerCostDeltaUSD':after['providerCostUSD']-before['providerCostUSD'],
            'localComputeCostDeltaUSD':None}


def annotate(report,annotations):
    import copy
    result=copy.deepcopy(report)
    cases={c['id']:c for c in result['cases']}
    for note in annotations:
        case=cases[note['id']]
        if not case['artifactSha256'] or note['artifactSha256']!=case['artifactSha256']:
            raise ValueError('Review belongs to a different rendered artifact')
        if note['decision'] not in ['passed','failed','incomplete'] or not note['evidence'] or not note['reviewer']:
            raise ValueError('Review requires a decision, reviewer and evidence')
        minutes=note['humanReworkMinutes']
        import math
        if type(minutes) not in [int,float] or not math.isfinite(minutes) or minutes<0:
            raise ValueError('Invalid rework minutes')
        case['qualityReview']={k:note[k] for k in ['decision','evidence','reviewer','artifactSha256']}
        case['humanReworkMinutes']=minutes
    result['qualityCoverage']=sum(c['qualityReview'] is not None for c in result['cases'])/len(result['cases'])
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('command',choices=['run','compare','annotate'])
    p.add_argument('--out',type=Path,required=True)
    p.add_argument('--before',type=Path)
    p.add_argument('--after',type=Path)
    p.add_argument('--report',type=Path)
    p.add_argument('--annotations',type=Path)
    a=p.parse_args()
    try:
        if a.out.exists():
            raise ValueError('Output exists')
        if a.command=='run':
            result=run(a.out)
        elif a.command=='compare':
            if not a.before or not a.after:
                raise ValueError('compare requires --before and --after')
            result=compare(json.loads(a.before.read_text()),json.loads(a.after.read_text()))
        else:
            if not a.report or not a.annotations:
                raise ValueError('annotate requires --report and --annotations')
            result=annotate(json.loads(a.report.read_text()),json.loads(a.annotations.read_text()))
        if a.command!='run':
            a.out.parent.mkdir(parents=True,exist_ok=True)
            with a.out.open('x') as stream:
                json.dump(result,stream,ensure_ascii=False,indent=2)
        print(json.dumps(result,ensure_ascii=False))
        if a.command=='run' and result['failureRate']:
            p.exit(1)
    except (ValueError,OSError,KeyError) as error:
        p.exit(1,str(error)+'\n')


if __name__=='__main__':
    main()
