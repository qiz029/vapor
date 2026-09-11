"""Sample-indexed PCM assembly and zero-offset exported-audio verification."""
import argparse,json,math,subprocess
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

def read_audio(path, rate):
    x,sr=sf.read(path,always_2d=True)
    if sr!=rate:
        g=math.gcd(sr,rate);x=resample_poly(x,rate//g,sr//g)
    return x

def assemble(clips, duration, rate=48000, channels=2):
    out=np.zeros((round(duration*rate),channels));occupied=np.zeros(len(out),dtype=bool)
    for c in clips:
        x=read_audio(c['source'],rate)
        if x.shape[1]==1 and channels==2:x=np.repeat(x,2,axis=1)
        if x.shape[1]!=channels:raise ValueError('Channel count mismatch')
        start=round(c.get('start',0)*rate);end=round(c.get('end',len(x)/rate)*rate);at=round(c['at']*rate)
        if start<0 or end<=start or end>len(x) or at<0 or at+end-start>len(out):raise ValueError('Clip outside source or timeline')
        span=slice(at,at+end-start)
        if occupied[span].any():raise ValueError('Overlapping narration clips')
        out[span]=x[start:end];occupied[span]=True
    return out

def verify(video, expected, rate=48000, threshold=.99, window=10):
    x=read_audio(expected,rate)
    if x.shape[1]==1:x=np.repeat(x,2,axis=1)
    if x.shape[1]!=2:raise ValueError('Expected mono or stereo audio')
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(video)]))
    streams=[s for s in probe['streams'] if s['codec_type']=='audio']
    if len(streams)!=1 or streams[0]['channels'] not in (1,2):raise ValueError('Expected exactly one mono/stereo audio stream')
    channels=streams[0]['channels']
    raw=subprocess.check_output(['ffmpeg','-nostdin','-v','error','-i',str(video),'-map','0:a:0','-ar',str(rate),'-ac',str(channels),'-f','f32le','-'])
    y=np.frombuffer(raw,dtype='<f4').reshape(-1,channels)
    if channels==1:y=np.repeat(y,2,axis=1)
    if abs(len(x)-len(y))>1024:raise ValueError('Audio length differs beyond one AAC padding frame')
    checks=[]
    for a in range(0,len(x),round(window*rate)):
        b=min(a+round(window*rate),len(x));p=x[a:b];q=y[a:min(b,len(y))]
        # Only codec-sized near-silent tail padding may be ignored.
        if len(q)<len(p):
            if np.max(np.abs(p[len(q):]))>1e-4:raise ValueError('Missing audible tail')
            p=p[:len(q)]
        if not len(p):continue
        rms=float(np.sqrt(np.mean(p*p)));err=float(np.sqrt(np.mean((p-q)**2)))
        if rms<1e-5:
            if err>1e-4:raise ValueError('Audio in expected silence')
            corr=None
        else:
            corr=float(np.corrcoef(p.ravel(),q.ravel())[0,1]);gain=float(np.sum(p*q)/np.sum(p*p))
            if not np.isfinite(corr) or corr<threshold or abs(gain-1)>.03:raise ValueError(f'Audio mismatch at {a/rate:.3f}s: correlation={corr}, gain={gain}')
        checks.append({'start':a/rate,'end':b/rate,'correlation':corr,'rmsError':err})
    if np.max(np.abs(y))>=1:raise ValueError('Decoded audio clips')
    return {'status':'passed','method':'Zero-offset expected mix comparison; does not certify listening quality','duration':len(x)/rate,'paddingSamples':len(y)-len(x),'windows':checks}

def mux(video, expected, output):
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(video)]))
    v=next(s for s in probe['streams'] if s['codec_type']=='video');duration=float(v['duration'])
    info=sf.info(expected)
    if abs(info.duration-duration)>.05:raise ValueError('Expected audio and video durations differ')
    subprocess.run(['ffmpeg','-nostdin','-v','error','-n','-i',str(video),'-i',str(expected),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-t',str(duration),'-movflags','+faststart',str(output)],check=True)
    return verify(output,expected)

def main():
    p=argparse.ArgumentParser(description=__doc__);s=p.add_subparsers(dest='command',required=True)
    a=s.add_parser('assemble');a.add_argument('--manifest',type=Path,required=True);a.add_argument('--out',type=Path,required=True)
    v=s.add_parser('verify');v.add_argument('--video',type=Path,required=True);v.add_argument('--expected',type=Path,required=True);v.add_argument('--out',type=Path,required=True)
    m=s.add_parser('mux');m.add_argument('--video',type=Path,required=True);m.add_argument('--expected',type=Path,required=True);m.add_argument('--out',type=Path,required=True)
    args=p.parse_args()
    if args.out.exists():p.error('Output exists; choose a new path')
    if args.command=='assemble':
        d=json.loads(args.manifest.read_text());clips=[dict(c,source=str((args.manifest.parent/c['source']).resolve())) for c in d['clips']];rate=d.get('sampleRate',48000)
        x=assemble(clips,d['duration'],rate,d.get('channels',2));sf.write(args.out,x,rate,subtype='FLOAT')
    elif args.command=='mux':
        result=mux(args.video,args.expected,args.out);args.out.with_suffix('.audio-check.json').write_text(json.dumps(result,indent=2)+'\n')
    else:args.out.write_text(json.dumps(verify(args.video,args.expected),indent=2)+'\n')
if __name__=='__main__':main()
