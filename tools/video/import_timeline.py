"""Adapt a legacy lab timeline to Remotion cards, retaining the same audio and timing."""
import argparse
import json
from pathlib import Path


def convert(timeline, title, audio):
    return {
        'schemaVersion': 1, 'title': title, 'width': 1080, 'height': 1920,
        'fps': timeline['fps'], 'duration': timeline['duration'],
        'audio': str(audio.resolve()), 'syntheticVoice': True,
        'scenes': [
            {'start': s['start'], 'end': s['end'],
             'title': s.get('caption', s['text']),
             'accent': ['#7de2c3', '#aab9ff', '#f4c786'][s.get('section', 0) % 3]}
            for s in timeline['segments']
        ],
        'captions': [{'start': s['start'], 'end': s['end'], 'text': s['text']}
                     for s in timeline['segments']],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--timeline', required=True, type=Path)
    parser.add_argument('--audio', required=True, type=Path)
    parser.add_argument('--title', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if not args.audio.is_file():
        parser.error('Audio file does not exist')
    result = convert(json.loads(args.timeline.read_text()), args.title, args.audio)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x') as file:
        file.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(args.output)


if __name__ == '__main__':
    main()
