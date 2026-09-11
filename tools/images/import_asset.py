"""Import a raster asset with provenance, without altering its pixels."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--prompt-file', required=True, type=Path)
    p.add_argument('--provider', required=True)
    p.add_argument('--model', default='unspecified')
    args = p.parse_args()
    data = args.source.read_bytes()
    with Image.open(args.source) as image:
        width, height = image.size
        fmt = image.format
        image.verify()
    extensions = {'PNG': ['.png'], 'JPEG': ['.jpg', '.jpeg'], 'WEBP': ['.webp']}
    if args.output.suffix.lower() not in extensions.get(fmt, []):
        p.error('Output extension must match source PNG/JPEG/WebP format')
    prompt = args.prompt_file.read_text().strip()
    if not prompt:
        p.error('Prompt/source description must not be empty')
    meta = args.output.with_suffix(args.output.suffix + '.json')
    if args.output.exists() or meta.exists():
        p.error('Output or sidecar exists; choose a new path')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('xb') as file:
        file.write(data)
    with meta.open('x') as file:
        json.dump({'source': str(args.source.resolve()), 'sha256': hashlib.sha256(data).hexdigest(),
                   'width': width, 'height': height, 'provider': args.provider, 'model': args.model,
                   'prompt': prompt, 'visual_review': 'pending'}, file, ensure_ascii=False, indent=2)
        file.write('\n')
    print(args.output)


if __name__ == '__main__':
    main()
