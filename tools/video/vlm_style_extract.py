"""Extract an evidence-linked video style system with Gemini 3.8 Flash.

The tool performs a neutral observation pass followed by a style-synthesis pass.
Interactions opt out of storage, and the uploaded Files API object is deleted in
a finally block. The result describes transferable grammar rather than copying
reference artwork or shot sequences.
"""
from __future__ import annotations

import argparse
import json
import math
import mimetypes
from pathlib import Path
import subprocess

import requests

from vlm_review import (
    GeminiClient,
    GeminiReviewError,
    MODEL,
    extract_output_text,
    load_api_key,
    sha256_file,
    write_json,
)


def parse_structured(response: dict) -> dict:
    try:
        value = json.loads(extract_output_text(response))
    except json.JSONDecodeError as exc:
        raise GeminiReviewError("Gemini returned invalid structured JSON") from exc
    if not isinstance(value, dict):
        raise GeminiReviewError("Gemini structured output must be an object")
    return value


def load_segments(video: Path, manifest_path: Path | None) -> tuple[list[dict], dict | None]:
    if manifest_path is None:
        return [{"id": "segment-001", "reelRange": [0, None], "sourceRange": [0, None]}], None
    manifest_path = manifest_path.resolve(strict=True)
    manifest = json.loads(manifest_path.read_text())
    reel = manifest.get("reel")
    if not isinstance(reel, dict) or not isinstance(reel.get("segments"), list) or not reel["segments"]:
        raise ValueError("Evidence manifest has no style reel segments")
    declared_sha = reel.get("sha256")
    if declared_sha and declared_sha != sha256_file(video):
        raise ValueError("Evidence manifest reel SHA-256 does not match the video")
    return reel["segments"], manifest


def observation_schema(segment_ids: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "segments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "segmentId": {"type": "string", "enum": segment_ids},
                        "reelRange": {"type": "array", "items": {"type": "number"}},
                        "sourceRange": {"type": "array", "items": {"type": "number"}},
                        "canvasAndComposition": {"type": "string"},
                        "objectsTypographyAndColor": {"type": "string"},
                        "visibleChangeAndCamera": {"type": "string"},
                        "explanatoryRole": {"type": "string"},
                        "audioVisualRelationship": {"type": "string"},
                        "evidenceTimestamps": {"type": "array", "items": {"type": "number"}},
                        "uncertainty": {"type": "string"},
                    },
                    "required": [
                        "segmentId",
                        "reelRange",
                        "sourceRange",
                        "canvasAndComposition",
                        "objectsTypographyAndColor",
                        "visibleChangeAndCamera",
                        "explanatoryRole",
                        "audioVisualRelationship",
                        "evidenceTimestamps",
                        "uncertainty",
                    ],
                },
            },
            "possibleExceptions": {"type": "array", "items": {"type": "string"}},
            "coverageLimitations": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["segments", "possibleExceptions", "coverageLimitations"],
    }


def style_schema() -> dict:
    string_array = {"type": "array", "items": {"type": "string"}}
    token = {
        "type": "object",
        "properties": {
            "rule": {"type": "string"},
            "basis": {
                "type": "string",
                "enum": ["observed", "inferred", "proposed_for_transfer"],
            },
            "evidenceTimestamps": {"type": "array", "items": {"type": "number"}},
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        },
        "required": ["rule", "basis", "evidenceTimestamps", "confidence"],
    }
    token_array = {"type": "array", "items": token}
    signature = {
        "type": "object",
        "properties": {
            "id": {"type": "string"},
            "rule": {"type": "string"},
            "evidenceSegmentIds": {"type": "array", "items": {"type": "string"}},
            "evidenceTimestamps": {"type": "array", "items": {"type": "number"}},
            "counterexample": {"type": "string"},
        },
        "required": ["id", "rule", "evidenceSegmentIds", "evidenceTimestamps", "counterexample"],
    }
    return {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "diagnosis": {"type": "string"},
            "signatures": {"type": "array", "items": signature},
            "flexibleConventions": string_array,
            "exceptions": string_array,
            "designTokens": {
                "type": "object",
                "properties": {
                    "canvas": token_array,
                    "paletteRoles": token_array,
                    "typographyRoles": token_array,
                    "shapeLanguage": token_array,
                    "spacingAndDensity": token_array,
                },
                "required": ["canvas", "paletteRoles", "typographyRoles", "shapeLanguage", "spacingAndDensity"],
            },
            "motionTokens": {
                "type": "object",
                "properties": {
                    "camera": token_array,
                    "entrance": token_array,
                    "stateChange": token_array,
                    "transition": token_array,
                    "readingHold": token_array,
                },
                "required": ["camera", "entrance", "stateChange", "transition", "readingHold"],
            },
            "explanatoryGrammar": {
                "type": "object",
                "properties": {
                    "entityRepresentation": string_array,
                    "causalPattern": string_array,
                    "comparisonPattern": string_array,
                    "codeAndDataPattern": string_array,
                },
                "required": ["entityRepresentation", "causalPattern", "comparisonPattern", "codeAndDataPattern"],
            },
            "sceneArchetypes": string_array,
            "continuityInvariants": string_array,
            "audioVisualRules": string_array,
            "rendererAllocation": {
                "type": "object",
                "properties": {
                    "deterministic": string_array,
                    "generative": string_array,
                    "sourceMedia": string_array,
                    "knownMismatches": string_array,
                },
                "required": ["deterministic", "generative", "sourceMedia", "knownMismatches"],
            },
            "negativeConstraints": string_array,
            "reviewQuestions": string_array,
            "uncertainties": string_array,
        },
        "required": [
            "name",
            "diagnosis",
            "signatures",
            "flexibleConventions",
            "exceptions",
            "designTokens",
            "motionTokens",
            "explanatoryGrammar",
            "sceneArchetypes",
            "continuityInvariants",
            "audioVisualRules",
            "rendererAllocation",
            "negativeConstraints",
            "reviewQuestions",
            "uncertainties",
        ],
    }


def observation_prompt(title: str, reference_url: str, segments: list[dict], brief: str) -> str:
    return """You are performing a neutral observation pass over a reference-video evidence reel.
Do not name, summarize, praise, or judge the style yet. For every supplied segment, record only
what is visibly and audibly present: canvas and composition; concrete objects, typography and
color roles; initial state, visible change, final state, camera behavior; explanatory role; and
the timing relationship with narration. Give reel timestamps in seconds. The source ranges map
each excerpt back to the original reference. Cuts between excerpts are artificial and are not
evidence of the source's transition style. Do not infer the authoring tool. Treat sponsor inserts,
logos, and topic-specific examples as possible exceptions. Cover every segment exactly once.

Reference title: %s
Reference URL: %s
Intended transfer brief: %s
Segment map: %s
""" % (title, reference_url, brief, json.dumps(segments, ensure_ascii=False))


def synthesis_prompt(title: str, observations: dict, brief: str) -> str:
    return """Derive a transferable video style system from the neutral observations below.
Separate recurring signature invariants from flexible conventions and incidental exceptions.
Prioritize explanatory grammar, motion grammar, continuity and information hierarchy over palette
adjectives. A signature invariant must recur in at least two distinct non-exception segments. Put a
useful but segment-specific construction under sceneArchetypes, not signatures. Start with global
grammar such as camera behavior, depth model, information hierarchy, semantic use of color and the
way elements are progressively revealed. Do not promote source-topic nouns such as arrays, CPUs or
threads into universal style rules.

Every signature needs distinct evidenceSegmentIds, reel evidence timestamps and a concrete
counterexample. Every design and motion token must declare its basis as observed, inferred or
proposed_for_transfer. Exact font families, hex colors, pixel sizes, frame counts, millisecond
durations and easing curves are forbidden unless they are directly readable or measurable in the
supplied evidence. Use qualitative roles or approximate ranges for observed traits. Put production
defaults that are absent from the evidence under proposed_for_transfer with empty evidence timestamps.
Never present a proposed value as an extracted fact.

Translate the findings into executable design and motion tokens, renderer allocation, negative
constraints and review questions. Keep exact text, code, counts and topology deterministic. Identify
any mismatch between generative video and the observed signatures instead of weakening the style
definition. Do not copy protected artwork, logos, characters, exact layouts or shot sequences. Do
not claim coverage beyond the inspected segments.

Reference title: %s
Intended transfer brief: %s
Neutral observations: %s
""" % (title, brief, json.dumps(observations, ensure_ascii=False))


def markdown_report(style: dict, observations: dict, reference: dict, reviewer: dict) -> str:
    lines = [
        f"# {style['name']}",
        "",
        style["diagnosis"],
        "",
        "## Reference and coverage",
        "",
        f"- Title: {reference['title']}",
        f"- URL: {reference['url'] or 'local reference'}",
        f"- Coverage: {reference['coverageLimit']}",
        f"- Reviewer: {reviewer['model']}, {reviewer['processing']}",
        "",
        "## Timestamped observations",
        "",
    ]
    for item in observations["segments"]:
        lines.extend(
            [
                f"### {item['segmentId']} · source {item['sourceRange']}",
                "",
                f"- Canvas/composition: {item['canvasAndComposition']}",
                f"- Objects/type/color: {item['objectsTypographyAndColor']}",
                f"- Motion/camera: {item['visibleChangeAndCamera']}",
                f"- Explanatory role: {item['explanatoryRole']}",
                f"- Audio/visual: {item['audioVisualRelationship']}",
                f"- Uncertainty: {item['uncertainty']}",
                "",
            ]
        )

    def section(title_text: str, items: list[str]) -> None:
        lines.extend([f"## {title_text}", ""])
        lines.extend([f"- {item}" for item in items] or ["- None observed."])
        lines.append("")

    def grouped_section(title_text: str, groups: dict[str, list[str]]) -> None:
        lines.extend([f"## {title_text}", ""])
        for group, items in groups.items():
            lines.append(f"### {group}")
            lines.append("")
            lines.extend([f"- {item}" for item in items] or ["- None observed."])
            lines.append("")

    def token_section(title_text: str, groups: dict[str, list[dict]]) -> None:
        lines.extend([f"## {title_text}", ""])
        for group, items in groups.items():
            lines.append(f"### {group}")
            lines.append("")
            for item in items:
                evidence = item["evidenceTimestamps"] or "none; production proposal"
                lines.append(
                    f"- {item['rule']} "
                    f"(basis: `{item['basis']}`; confidence: `{item['confidence']}`; "
                    f"evidence: {evidence})"
                )
            if not items:
                lines.append("- None observed.")
            lines.append("")

    lines.extend(["## Signature invariants", ""])
    for item in style["signatures"]:
        lines.extend(
            [
                f"### {item['id']}",
                "",
                item["rule"],
                "",
                f"Evidence: {item['evidenceTimestamps']}",
                f"Segments: {item['evidenceSegmentIds']}",
                "",
                f"Counterexample: {item['counterexample']}",
                "",
            ]
        )
    section("Flexible conventions", style["flexibleConventions"])
    section("Exceptions", style["exceptions"])
    token_section("Design tokens", style["designTokens"])
    token_section("Motion tokens", style["motionTokens"])
    grouped_section("Explanatory grammar", style["explanatoryGrammar"])
    section("Scene archetypes", style["sceneArchetypes"])
    section("Continuity invariants", style["continuityInvariants"])
    section("Audio and visual rules", style["audioVisualRules"])
    grouped_section("Renderer allocation", style["rendererAllocation"])
    section("Negative constraints", style["negativeConstraints"])
    section("Review questions", style["reviewQuestions"])
    section("Uncertainties", style["uncertainties"] + observations["coverageLimitations"])
    return "\n".join(lines).rstrip() + "\n"


def run_extraction(
    video: Path,
    manifest_path: Path | None,
    output: Path,
    title: str,
    reference_url: str,
    brief: str,
    processing: str,
    fps: float,
    client: GeminiClient,
) -> Path:
    video = video.resolve(strict=True)
    output = output.resolve()
    if output.exists():
        raise FileExistsError("Output exists; choose a new directory")
    if video.stat().st_size > 2 * 1024 * 1024 * 1024:
        raise ValueError("Video exceeds the Gemini Files API 2 GiB limit")
    segments, manifest = load_segments(video, manifest_path)
    if segments[0]["reelRange"][1] is None:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(video)],
            capture_output=True,
            text=True,
            check=True,
        )
        duration = float(json.loads(result.stdout)["format"]["duration"])
        segments[0]["reelRange"][1] = duration
        segments[0]["sourceRange"][1] = duration

    mime_type = mimetypes.guess_type(video.name)[0] or "video/mp4"
    if not mime_type.startswith("video/"):
        raise ValueError("Input MIME type must be video/*")
    output.mkdir(parents=True, exist_ok=False)
    video_sha = sha256_file(video)
    remote_file = None
    deletion = {"attempted": False, "deleted": False}
    try:
        remote_file = client.wait_until_active(client.upload(video, mime_type))
        process_config = processing if processing == "agentic" else {"type": "static", "fps": fps}
        first_response = client.interact(
            [
                {"type": "video", "uri": remote_file["uri"], "mime_type": mime_type, "processing": process_config},
                {"type": "text", "text": observation_prompt(title, reference_url, segments, brief)},
            ],
            observation_schema([item["id"] for item in segments]),
        )
        observations = parse_structured(first_response)
        ids = [item.get("segmentId") for item in observations.get("segments", [])]
        if len(ids) != len(segments) or set(ids) != {item["id"] for item in segments}:
            raise GeminiReviewError("Gemini observation output did not cover every segment exactly once")
        second_response = client.interact(
            synthesis_prompt(title, observations, brief), style_schema()
        )
        style = parse_structured(second_response)
        reference = {
            "title": title,
            "url": reference_url,
            "role": "authoritative",
            "inspectedRanges": [item["sourceRange"] for item in segments],
            "coverageLimit": "Selected source-linked excerpts; not full-playback coverage" if manifest else "Full uploaded video processed by the configured VLM mode; not human playback coverage",
        }
        reviewer = {
            "provider": "google-gemini-api",
            "model": MODEL,
            "method": "neutral observation then style synthesis",
            "processing": process_config,
            "interactionStorage": False,
        }
        style_spec = {
            "schemaVersion": 1,
            **style,
            "referenceSet": [reference],
            "evidence": {
                "videoPath": str(video),
                "videoSha256": video_sha,
                "manifestPath": str(manifest_path.resolve()) if manifest_path else None,
                "observations": "vlm-style-observations.json",
            },
            "reviewer": reviewer,
        }
        write_json(output / "style-spec.json", style_spec)
        (output / "style-analysis.md").write_text(
            markdown_report(style, observations, reference, reviewer)
        )
        write_json(
            output / "vlm-style-observations.json",
            {
                "schemaVersion": 1,
                "artifact": {"path": str(video), "sha256": video_sha},
                "reference": reference,
                "reviewer": reviewer,
                "observations": observations,
                "styleSynthesis": style,
                "usage": {
                    "observation": first_response.get("usage", {}),
                    "synthesis": second_response.get("usage", {}),
                },
                "acceptanceAuthority": "supporting_evidence_only",
            },
        )
        return output / "style-spec.json"
    except Exception as exc:
        write_json(
            output / "failure.json",
            {
                "error": str(exc).replace(client.api_key, "[redacted]"),
                "model": MODEL,
                "artifactSha256": video_sha,
            },
        )
        raise
    finally:
        if remote_file and remote_file.get("name"):
            deletion["attempted"] = True
            try:
                client.delete_file(remote_file["name"])
                deletion["deleted"] = True
            except Exception as exc:
                deletion["error"] = str(exc).replace(client.api_key, "[redacted]")
        write_json(output / "retention.json", deletion)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True, help="Local video or evidence reel")
    parser.add_argument("--manifest", type=Path, help="Optional style_samples.py manifest for reel mapping")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--reference-url", default="")
    parser.add_argument("--brief", default="")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--processing", choices=("static", "agentic"), default="static")
    parser.add_argument("--fps", type=float, default=4.0)
    args = parser.parse_args()
    if not math.isfinite(args.fps) or not 0 < args.fps <= 24:
        parser.error("--fps must be finite and within (0, 24]")
    key = load_api_key(args.root.resolve())
    if not key:
        parser.exit(2, "GEMINI_API_KEY is empty; no video was uploaded\n")
    try:
        result = run_extraction(
            args.video,
            args.manifest,
            args.out,
            args.title,
            args.reference_url,
            args.brief,
            args.processing,
            args.fps,
            GeminiClient(key),
        )
    except (OSError, ValueError, GeminiReviewError, requests.RequestException) as exc:
        parser.exit(1, f"{str(exc).replace(key, '[redacted]')}\n")
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
