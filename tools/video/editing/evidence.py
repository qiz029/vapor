"""Accurate time-bin waveform adapter for the upstream filmstrip renderer."""
import subprocess
import numpy as np


def envelope_pcm(pcm,samples):
    if not len(pcm):
        return np.zeros(samples)
    # Cover the entire interval. Upstream integer windows truncate the remainder
    # before drawing against the full time ruler, shifting apparent cut positions.
    edges=np.linspace(0,len(pcm),samples+1).astype(int)
    squares=np.concatenate(([0.0],np.cumsum(np.asarray(pcm,dtype=float)**2)))
    counts=np.maximum(1,np.diff(edges))
    values=np.sqrt(np.maximum(0,np.diff(squares[edges])/counts))
    maximum=values.max()
    return values/maximum if maximum>0 else values


def compute_envelope(video,start,end,samples=2000,track=0):
    process=subprocess.run(['ffmpeg','-nostdin','-v','error','-ss',str(start),'-i',str(video),'-t',str(end-start),
                            '-map',f'0:a:{track}','-ac','1','-ar','16000','-f','f32le','-'],capture_output=True)
    if process.returncode:
        return np.zeros(samples)
    return envelope_pcm(np.frombuffer(process.stdout,dtype='<f4'),samples)
