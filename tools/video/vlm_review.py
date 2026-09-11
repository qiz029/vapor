"""Collect Gemini video observations for an existing review contract.

This tool supplies evidence to ``review.json``; it never declares final video
acceptance. Uploaded files are deleted in a ``finally`` block and Interactions
API requests opt out of server-side storage.
"""

import argparse
import hashlib
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import sys
import time
from urllib.parse import urlparse

import requests


MODEL = "gemini-3.8-flash"
API_ORIGIN = "https://generativelanguage.googleapis.com"
MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024
STATUSES = {"passed", "failed", "not_checked", "needs_human_review"}
SEVERITIES = {None, "blocker", "major", "minor"}


class GeminiReviewError(RuntimeError):
    pass


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_api_key(root):
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if key:
        return key
    if os.environ.get('VAPOR_PLUGIN_MODE') == '1':
        return ''
    env_path = root / ".env"
    if not env_path.is_file():
        return ""
    for line in env_path.read_text().splitlines():
        match = re.match(r"^\s*(?:export\s+)?GEMINI_API_KEY\s*=\s*(.*?)\s*$", line)
        if match:
            return match.group(1).strip().strip("\"'")
    return ""


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def validate_contract(contract, video_sha):
    if not isinstance(contract, dict):
        raise ValueError("Review contract must be a JSON object")
    criteria = contract.get("criteria")
    if not isinstance(criteria, list) or not criteria:
        raise ValueError("Review contract needs at least one criterion")
    seen = set()
    normalized = []
    for item in criteria:
        if not isinstance(item, dict):
            raise ValueError("Each criterion must be a JSON object")
        criterion_id = item.get("id")
        if not isinstance(criterion_id, str) or not criterion_id or criterion_id in seen:
            raise ValueError("Criterion IDs must be non-empty and unique")
        seen.add(criterion_id)
        source_range = item.get("sourceRange")
        if (not isinstance(source_range, list) or len(source_range) != 2 or
                not all(isinstance(value, (int, float)) and math.isfinite(value)
                        for value in source_range) or
                not 0 <= source_range[0] < source_range[1]):
            raise ValueError(f"Criterion {criterion_id} has an invalid sourceRange")
        question = item.get("question")
        expected = item.get("expected")
        if not isinstance(question, str) or not question.strip():
            raise ValueError(f"Criterion {criterion_id} needs a question")
        if not isinstance(expected, str) or not expected.strip():
            raise ValueError(f"Criterion {criterion_id} needs an expected result")
        normalized.append({
            "id": criterion_id,
            "dimension": item.get("dimension", "unspecified"),
            "required": bool(item.get("required", False)),
            "question": question,
            "expected": expected,
            "sourceRange": source_range,
        })
    declared_sha = contract.get("artifact", {}).get("sha256", "")
    if declared_sha and declared_sha != video_sha:
        raise ValueError("Review contract artifact SHA-256 does not match the video")
    return normalized


def observation_schema(criterion_ids):
    return {
        "type": "object",
        "properties": {
            "observations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "criterionId": {"type": "string", "enum": criterion_ids},
                        "sourceRange": {"type": "array", "items": {"type": "number"}},
                        "visibleObservation": {"type": "string"},
                        "audibleObservation": {"type": "string"},
                        "evidenceTimestamps": {"type": "array", "items": {"type": "number"}},
                        "uncertainty": {"type": "string"},
                    },
                    "required": ["criterionId", "sourceRange", "visibleObservation",
                                 "audibleObservation", "evidenceTimestamps", "uncertainty"],
                },
            },
            "limitations": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["observations", "limitations"],
    }


def judgment_schema(criterion_ids):
    return {
        "type": "object",
        "properties": {
            "findings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "criterionId": {"type": "string", "enum": criterion_ids},
                        "status": {"type": "string", "enum": sorted(STATUSES)},
                        "observation": {"type": "string"},
                        "severity": {
                            "type": ["string", "null"],
                            "enum": ["blocker", "major", "minor", None],
                        },
                        "correction": {"type": ["string", "null"]},
                        "evidenceTimestamps": {"type": "array", "items": {"type": "number"}},
                    },
                    "required": ["criterionId", "status", "observation", "severity",
                                 "correction", "evidenceTimestamps"],
                },
            },
            "summary": {"type": "string"},
            "limitations": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["findings", "summary", "limitations"],
    }


def extract_output_text(response):
    direct = response.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct
    parts = []
    for step in response.get("steps", []):
        if step.get("type") != "model_output":
            continue
        for content in step.get("content", []):
            if content.get("type") == "text" and isinstance(content.get("text"), str):
                parts.append(content["text"])
    if not parts:
        raise GeminiReviewError("Gemini response contained no text output")
    return "".join(parts)


def parse_structured_response(response):
    try:
        value = json.loads(extract_output_text(response))
    except json.JSONDecodeError as exc:
        raise GeminiReviewError("Gemini returned invalid structured JSON") from exc
    if not isinstance(value, dict):
        raise GeminiReviewError("Gemini structured output must be an object")
    return value


def validate_items(items, expected_ids, kind):
    if not isinstance(items, list):
        raise GeminiReviewError(f"Gemini {kind} output is missing its item list")
    actual_ids = [item.get("criterionId") for item in items if isinstance(item, dict)]
    if len(actual_ids) != len(items) or len(set(actual_ids)) != len(actual_ids):
        raise GeminiReviewError(f"Gemini {kind} output has invalid or duplicate criterion IDs")
    if set(actual_ids) != set(expected_ids):
        raise GeminiReviewError(f"Gemini {kind} output did not cover every criterion exactly once")


class GeminiClient:
    def __init__(self, api_key, session=None, timeout=180):
        self.api_key = api_key
        self.session = session or requests.Session()
        self.timeout = timeout

    def request(self, method, url, **kwargs):
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != "generativelanguage.googleapis.com":
            raise GeminiReviewError("Refusing request to an unexpected authenticated API host")
        headers = dict(kwargs.pop("headers", {}))
        headers["x-goog-api-key"] = self.api_key
        response = self.session.request(
            method, url, headers=headers, timeout=self.timeout,
            allow_redirects=False, **kwargs)
        if not response.ok:
            body = response.text.replace(self.api_key, "[redacted]")[:1000]
            raise GeminiReviewError(f"Gemini HTTP {response.status_code}: {body}")
        return response

    def upload(self, video, mime_type):
        size = video.stat().st_size
        response = self.request(
            "POST", f"{API_ORIGIN}/upload/v1beta/files",
            headers={
                "X-Goog-Upload-Protocol": "resumable",
                "X-Goog-Upload-Command": "start",
                "X-Goog-Upload-Header-Content-Length": str(size),
                "X-Goog-Upload-Header-Content-Type": mime_type,
                "Content-Type": "application/json",
            },
            json={"file": {"display_name": video.name}},
        )
        upload_url = response.headers.get("X-Goog-Upload-URL")
        if not upload_url:
            raise GeminiReviewError("Gemini upload start returned no upload URL")
        with video.open("rb") as source:
            response = self.request(
                "POST", upload_url,
                headers={
                    "Content-Length": str(size),
                    "X-Goog-Upload-Offset": "0",
                    "X-Goog-Upload-Command": "upload, finalize",
                },
                data=source,
            )
        value = response.json().get("file", {})
        if not value.get("name") or not value.get("uri"):
            raise GeminiReviewError("Gemini upload response omitted file identity")
        return value

    def wait_until_active(self, remote_file, poll_seconds=2, timeout_seconds=600):
        deadline = time.monotonic() + timeout_seconds
        current = remote_file
        while current.get("state") == "PROCESSING":
            if time.monotonic() >= deadline:
                raise GeminiReviewError("Timed out waiting for Gemini to process the video")
            time.sleep(poll_seconds)
            current = self.request(
                "GET", f"{API_ORIGIN}/v1beta/{remote_file['name']}").json()
        if current.get("state") != "ACTIVE":
            raise GeminiReviewError(f"Gemini file entered state {current.get('state', 'UNKNOWN')}")
        return current

    def interact(self, input_value, schema):
        response = self.request(
            "POST", f"{API_ORIGIN}/v1beta/interactions",
            headers={"Content-Type": "application/json"},
            json={
                "model": MODEL,
                "store": False,
                "input": input_value,
                "response_format": {
                    "type": "text",
                    "mime_type": "application/json",
                    "schema": schema,
                },
                "generation_config": {"temperature": 0, "seed": 17},
            },
        )
        return response.json()

    def delete_file(self, name):
        self.request("DELETE", f"{API_ORIGIN}/v1beta/{name}")


def observation_prompt(contract, criteria):
    observable = [{key: item[key] for key in
                   ("id", "dimension", "question", "sourceRange")} for item in criteria]
    return """You are performing the observation pass for a rendered-video review.
Do not decide whether any criterion passes. Describe only what is visibly and audibly
present in the requested source time range. For actions, state the initial state,
continuous change, final state, and ordering that you can actually observe. Give source
timestamps in seconds. Say what remains uncertain; sampled or unclear evidence must not
be upgraded into certainty. Return one observation for every criterion.

Brief and references:
%s

Observation questions:
%s""" % (
        json.dumps(contract.get("requirements", {}), ensure_ascii=False),
        json.dumps(observable, ensure_ascii=False),
    )


def judgment_prompt(criteria, observations):
    return """You are performing the judgment pass for a rendered-video review.
Compare the expected result with the neutral observations. Use passed only when the
observation supplies affirmative evidence for the full criterion. Use failed for a
demonstrated contradiction or missing required event. Use needs_human_review when the
observation is uncertain or cannot establish continuous motion, natural voice delivery,
fine readability, or audiovisual alignment. Do not infer facts that are absent from the
observations. Return one finding for every criterion. Severity is only for failed items.

Acceptance criteria:
%s

Neutral observations:
%s""" % (
        json.dumps(criteria, ensure_ascii=False),
        json.dumps(observations, ensure_ascii=False),
    )


def run_review(video, contract_path, output, processing, fps, client):
    video = video.resolve(strict=True)
    contract_path = contract_path.resolve(strict=True)
    output = output.resolve()
    if not video.is_file() or not contract_path.is_file():
        raise ValueError("Video and contract must be files")
    if video.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("Video exceeds the Gemini Files API 2 GiB limit")
    if output.exists():
        raise FileExistsError("Output exists; choose a new directory")
    video_sha = sha256_file(video)
    contract_bytes = contract_path.read_bytes()
    contract = json.loads(contract_bytes)
    criteria = validate_contract(contract, video_sha)
    mime_type = mimetypes.guess_type(video.name)[0] or "video/mp4"
    if not mime_type.startswith("video/"):
        raise ValueError("Input MIME type must be video/*")
    output.mkdir(parents=True, exist_ok=False)
    remote_file = None
    deletion = {"attempted": False, "deleted": False}
    try:
        remote_file = client.upload(video, mime_type)
        remote_file = client.wait_until_active(remote_file)
        process_config = processing if processing == "agentic" else {
            "type": "static", "fps": fps,
        }
        first_response = client.interact([
            {"type": "video", "uri": remote_file["uri"],
             "mime_type": mime_type, "processing": process_config},
            {"type": "text", "text": observation_prompt(contract, criteria)},
        ], observation_schema([item["id"] for item in criteria]))
        observations = parse_structured_response(first_response)
        validate_items(observations.get("observations"),
                       [item["id"] for item in criteria], "observation")
        second_response = client.interact(
            judgment_prompt(criteria, observations),
            judgment_schema([item["id"] for item in criteria]),
        )
        judgments = parse_structured_response(second_response)
        validate_items(judgments.get("findings"),
                       [item["id"] for item in criteria], "judgment")
        for finding in judgments["findings"]:
            if finding.get("status") not in STATUSES or finding.get("severity") not in SEVERITIES:
                raise GeminiReviewError("Gemini judgment used an unsupported status or severity")
        report = {
            "schemaVersion": 1,
            "artifact": {"path": str(video), "sha256": video_sha},
            "contract": {
                "path": str(contract_path),
                "sha256": hashlib.sha256(contract_bytes).hexdigest(),
            },
            "reviewer": {
                "provider": "google-gemini-api",
                "model": MODEL,
                "method": "two-pass neutral observation then contract judgment",
                "processing": process_config,
                "interactionStorage": False,
            },
            "observations": observations,
            "judgments": judgments,
            "usage": {
                "observation": first_response.get("usage", {}),
                "judgment": second_response.get("usage", {}),
            },
            "acceptanceAuthority": "supporting_evidence_only",
        }
        write_json(output / "vlm-observations.json", report)
        return output / "vlm-observations.json"
    except Exception as exc:
        write_json(output / "failure.json", {
            "error": str(exc).replace(client.api_key, "[redacted]"),
            "model": MODEL,
            "artifactSha256": video_sha,
            "perceptualReview": "not_checked",
        })
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--contract", type=Path, required=True,
                        help="review.json containing artifact identity and criteria")
    parser.add_argument("--out", type=Path, required=True,
                        help="new output directory")
    parser.add_argument("--root", type=Path, default=Path.cwd(),
                        help="checkout root containing the local .env")
    parser.add_argument("--processing", choices=("static", "agentic"), default="static")
    parser.add_argument("--fps", type=float, default=4.0,
                        help="static processing sample rate; ignored for agentic mode")
    args = parser.parse_args()
    if not math.isfinite(args.fps) or not 0 < args.fps <= 24:
        parser.error("--fps must be finite and within (0, 24]")
    key = load_api_key(args.root.resolve())
    if not key:
        parser.exit(2, "GEMINI_API_KEY is empty; no video was uploaded\n")
    try:
        result = run_review(
            args.video, args.contract, args.out, args.processing, args.fps,
            GeminiClient(key),
        )
    except (OSError, ValueError, GeminiReviewError, requests.RequestException) as exc:
        parser.exit(1, f"{str(exc).replace(key, '[redacted]')}\n")
    print(result)


if __name__ == "__main__":
    main()
