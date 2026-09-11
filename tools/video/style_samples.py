"""Extract source-hashed visual-style evidence from a local video."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess


def run(command: list[str]) -> str:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"{command[0]} failed: {result.stderr[-4000:]}")
    return result.stdout


def parse_clip(value: str) -> tuple[float, float]:
    try:
        start, end = map(float, value.split(":"))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Use START:END seconds") from exc
    if not all(math.isfinite(item) for item in (start, end)) or not 0 <= start < end:
        raise argparse.ArgumentTypeError("Use finite seconds with 0 <= START < END")
    return start, end


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def automatic_times(duration: float, count: int) -> list[float]:
    if count < 1:
        raise ValueError("Automatic sample count must be positive")
    # Avoid title-card and end-card bias while still covering the whole body.
    return [duration * (0.05 + 0.9 * (index + 0.5) / count) for index in range(count)]


def collect(
    video: Path,
    output: Path,
    times: list[float],
    clips: list[tuple[float, float]],
    auto_count: int,
    columns: int,
) -> Path:
    video = video.resolve(strict=True)
    if not video.is_file():
        raise ValueError("Video must be a file")
    if output.exists():
        raise FileExistsError(f"Output exists: {output}")
    for executable in ("ffmpeg", "ffprobe"):
        if shutil.which(executable) is None:
            raise RuntimeError(f"{executable} is required on PATH")

    probe = json.loads(
        run(["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(video)])
    )
    video_streams = [
        stream
        for stream in probe["streams"]
        if stream["codec_type"] == "video" and not stream.get("disposition", {}).get("attached_pic")
    ]
    if not video_streams:
        raise ValueError("No video stream")
    stream = video_streams[0]
    duration = float(stream.get("duration") or probe["format"]["duration"])
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("Invalid video duration")

    selected_times = sorted(set(times or automatic_times(duration, auto_count)))
    if any(not math.isfinite(item) or item < 0 or item >= duration for item in selected_times):
        raise ValueError(f"Frame sample must be within 0 <= time < {duration}")
    if any(end > duration + 0.000001 for _, end in clips):
        raise ValueError(f"Clip exceeds video duration {duration}")
    if columns < 1:
        raise ValueError("Columns must be positive")

    output.mkdir(parents=True)
    frames_dir = output / "frames"
    clips_dir = output / "clips"
    frames_dir.mkdir()
    clips_dir.mkdir()
    try:
        frames = []
        for index, point in enumerate(selected_times, 1):
            name = f"frame-{index:03d}.png"
            destination = frames_dir / name
            run(
                [
                    "ffmpeg",
                    "-nostdin",
                    "-v",
                    "error",
                    "-n",
                    "-ss",
                    f"{point:.6f}",
                    "-i",
                    str(video),
                    "-map",
                    f"0:{stream['index']}",
                    "-frames:v",
                    "1",
                    "-update",
                    "1",
                    str(destination),
                ]
            )
            if not destination.is_file() or not destination.stat().st_size:
                raise RuntimeError(f"No frame extracted at {point}")
            frames.append(
                {"index": index, "sourceTime": point, "path": str(destination.relative_to(output))}
            )

        extracted_clips = []
        for index, (start, end) in enumerate(clips, 1):
            name = f"clip-{index:03d}.mp4"
            destination = clips_dir / name
            run(
                [
                    "ffmpeg",
                    "-nostdin",
                    "-v",
                    "error",
                    "-n",
                    "-ss",
                    f"{start:.6f}",
                    "-i",
                    str(video),
                    "-t",
                    f"{end - start:.6f}",
                    "-map",
                    f"0:{stream['index']}",
                    "-map",
                    "0:a:0?",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "fast",
                    "-crf",
                    "18",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-movflags",
                    "+faststart",
                    str(destination),
                ]
            )
            extracted_clips.append(
                {
                    "index": index,
                    "sourceStart": start,
                    "sourceEnd": end,
                    "path": str(destination.relative_to(output)),
                }
            )

        reel = None
        if extracted_clips:
            concat_file = output / "style-reel.ffconcat"
            concat_file.write_text(
                "ffconcat version 1.0\n"
                + "".join(
                    f"file '{(output / item['path']).resolve()}'\n" for item in extracted_clips
                )
            )
            reel_path = output / "style-reel.mp4"
            run(
                [
                    "ffmpeg",
                    "-nostdin",
                    "-v",
                    "error",
                    "-n",
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                    str(concat_file),
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a:0?",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "fast",
                    "-crf",
                    "18",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-movflags",
                    "+faststart",
                    str(reel_path),
                ]
            )
            cursor = 0.0
            reel_segments = []
            for item in extracted_clips:
                segment_duration = item["sourceEnd"] - item["sourceStart"]
                reel_segments.append(
                    {
                        "id": f"segment-{item['index']:03d}",
                        "reelRange": [cursor, cursor + segment_duration],
                        "sourceRange": [item["sourceStart"], item["sourceEnd"]],
                    }
                )
                cursor += segment_duration
            reel = {
                "path": reel_path.name,
                "sha256": sha256_file(reel_path),
                "duration": float(
                    json.loads(
                        run(
                            [
                                "ffprobe",
                                "-v",
                                "error",
                                "-show_format",
                                "-of",
                                "json",
                                str(reel_path),
                            ]
                        )
                    )["format"]["duration"]
                ),
                "segments": reel_segments,
                "artificialCuts": [item["reelRange"][1] for item in reel_segments[:-1]],
            }

        rows = math.ceil(len(frames) / columns)
        contact_sheet = output / "contact-sheet.png"
        run(
            [
                "ffmpeg",
                "-nostdin",
                "-v",
                "error",
                "-n",
                "-framerate",
                "1",
                "-i",
                str(frames_dir / "frame-%03d.png"),
                "-frames:v",
                "1",
                "-vf",
                f"scale=480:-2,tile={columns}x{rows}:padding=8:margin=8:color=0x202020",
                str(contact_sheet),
            ]
        )

        manifest = {
            "schemaVersion": 1,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "source": {
                "path": str(video),
                "sha256": sha256_file(video),
                "duration": duration,
                "videoStreamIndex": stream["index"],
            },
            "coverage": {
                "frameTimes": selected_times,
                "clipRanges": [[start, end] for start, end in clips],
                "fullPlayback": False,
            },
            "frames": frames,
            "clips": extracted_clips,
            "reel": reel,
            "contactSheet": contact_sheet.name,
            "technicalOnly": True,
            "limitations": [
                "Frames do not establish motion or event order.",
                "Extracted clips do not establish uninspected coverage or perceptual acceptance.",
            ],
        }
        (output / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
        )
        return output / "manifest.json"
    except Exception as exc:
        (output / "failure.json").write_text(json.dumps({"error": str(exc)}, indent=2) + "\n")
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--time", dest="times", type=float, action="append", default=[])
    parser.add_argument("--clip", dest="clips", type=parse_clip, action="append", default=[])
    parser.add_argument("--auto-count", type=int, default=12)
    parser.add_argument("--columns", type=int, default=4)
    args = parser.parse_args()
    try:
        print(collect(args.video, args.out, args.times, args.clips, args.auto_count, args.columns))
    except (OSError, ValueError, RuntimeError) as exc:
        parser.exit(1, f"{exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
