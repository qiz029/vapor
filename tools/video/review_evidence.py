"""Extract source-linked review evidence; never infer perceptual acceptance."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
from datetime import datetime, timezone


def run(command):
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{command[0]} failed: {result.stderr[-4000:]}')
    return result.stdout


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def parse_range(value):
    try:
        start, end = map(float, value.split(':'))
        if not all(map(math.isfinite, (start, end))) or not 0 <= start < end:
            raise ValueError()
        return start, end
    except ValueError as exc:
        raise argparse.ArgumentTypeError('Use finite seconds START:END with 0 <= START < END') from exc


def collect(video, ranges, output):
    video = video.resolve(strict=True)
    if not video.is_file():
        raise ValueError('Video must be a file')
    if output.exists():
        raise FileExistsError('Output exists; choose a new directory')
    probe = json.loads(run(['ffprobe', '-v', 'error', '-show_format', '-show_streams',
                            '-of', 'json', str(video)]))
    streams = [s for s in probe['streams'] if s['codec_type'] == 'video'
               and not s.get('disposition', {}).get('attached_pic')]
    if not streams:
        raise ValueError('No video stream')
    stream = streams[0]
    duration = float(stream.get('duration') or probe['format']['duration'])
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('Invalid video duration')
    if any(end > duration + 0.000001 for _, end in ranges):
        raise ValueError(f'Review range exceeds video duration {duration}')
    output.mkdir(parents=True, exist_ok=False)
    try:
        digest = hashlib.sha256()
        with video.open('rb') as source:
            for block in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(block)
        write_json(output / 'probe.json', probe)
        run(['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-i', str(video),
             '-map', f'0:{stream["index"]}', '-map', '0:a?', '-f', 'null', '-'])
        evidence = {
            'schemaVersion': 1,
            'createdAt': datetime.now(timezone.utc).isoformat(),
            'artifact': {'path': str(video), 'sha256': digest.hexdigest(),
                         'duration': duration,
                         'hasAudio': any(s['codec_type'] == 'audio' for s in probe['streams'])},
            'tools': {name: run([name, '-version']).splitlines()[0]
                      for name in ('ffmpeg', 'ffprobe')},
            'technical': {'decode': 'passed', 'probe': 'probe.json'},
            'perceptualReview': 'not_checked',
            'samples': [],
        }
        for index, (start, end) in enumerate(ranges, 1):
            # Stay within the interval rather than seeking exactly onto its end.
            points = [start + (end - start) * fraction for fraction in (0.1, 0.5, 0.9)]
            sample = {'sourceStart': start, 'sourceEnd': end, 'frames': [],
                      'clip': f'clip-{index:03}.mp4', 'clipTimeOrigin': 0}
            for number, point in enumerate(points, 1):
                name = f'frame-{index:03}-{number}.png'
                run(['ffmpeg', '-nostdin', '-v', 'error', '-n', '-i', str(video),
                     '-ss', str(point), '-map', f'0:{stream["index"]}', '-frames:v', '1',
                     '-update', '1', str(output / name)])
                if not (output / name).is_file() or not (output / name).stat().st_size:
                    raise RuntimeError(f'No frame extracted at {point}')
                sample['frames'].append({'requestedSourceTime': point, 'path': name})
            run(['ffmpeg', '-nostdin', '-v', 'error', '-n', '-i', str(video),
                 '-ss', str(start), '-t', str(end - start),
                 '-map', f'0:{stream["index"]}', '-map', '0:a:0?',
                 '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
                 '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
                 str(output / sample['clip'])])
            evidence['samples'].append(sample)
        write_json(output / 'evidence.json', evidence)
    except Exception as exc:
        write_json(output / 'failure.json', {'error': str(exc), 'perceptualReview': 'not_checked'})
        raise
    return output / 'evidence.json'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', type=Path, required=True)
    parser.add_argument('--range', dest='ranges', action='append', type=parse_range, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    try:
        print(collect(args.video, args.ranges, args.out))
    except (OSError, ValueError, RuntimeError) as exc:
        parser.exit(1, f'{exc}\n')


if __name__ == '__main__':
    main()
