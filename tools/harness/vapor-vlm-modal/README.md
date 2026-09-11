# Vapor Modal Qwen

Optional visual inspection plugin for Vapor Framework, using `Qwen/Qwen3-VL-8B-Instruct` at revision `0c351dd01ed87e9c1b53cbc748cba10e6187ff3b`. Static images and sampled video frames are supported; audio and continuous playback are not.

## Install and configure

Use Python 3.11+ on macOS/Linux with FFmpeg/ffprobe. Create your own Python virtual environment, install this package's `requirements.txt`, and set `VAPOR_VLM_PYTHON` to its Python executable. Authenticate Modal using its official CLI. Credentials stay in the user's Modal environment and are never bundled or copied by Vapor.

Deploy `python/tools/gpu/modal_vlm_app.py` using that environment with `python -m modal deploy <path>`. The app is `agent-media-lab-vlm-v2`, separate from v1 so existing calls remain recoverable. Deployment is a separate operation, never a package install hook. Model weights download into the user's Modal Volume on first use. No cloud deployment or GPU inference is established by an npm installation or offline tests.

## Review

In Lab select a registered image/video revision, enter a question, and add it to the current batch. Video ranges are validated against the actual duration. Prepare locally, then inspect the upload size, pinned model, exact source IDs and sampled times. Batches accept 1–40 items; videos use 2–12 frames. Images are one image with no invented timestamps. ZIP input is capped at 48 MiB.

Only the user can approve the prepared input fingerprint and cost plan. The fixed `<project>/generation/ledger.json` is shared with production generation work. An existing budget cannot be increased through this form. Estimates, reservations and actual billing are distinct; reservations do not hard-limit Modal's billing. GPU runtime has a 900 second timeout and one-container concurrency.

The Agent gets `media_vlm_prepare`, `media_vlm_list`, `media_vlm_get` and `media_vlm_resume` when the Vapor preset is selected. It cannot approve spending. Results retain raw answers, parsing failures, exact sources and coverage; reports appear in the board. No automatic acceptance or paid regeneration follows a model recommendation.

## Recovery

After submission, use **查询原任务 / 取回结果**. This recovers the saved request and original call, never spawns a new job. Unknown submissions require the verified original `fc-...` ID and evidence in Lab. Remote cancellation is performed in Modal; record the verified terminal state in Lab afterward. Killing the local client is not remote cancellation. Reservations stay until actual billing is recorded.

Old v1 calls can be recovered with the saved plan and existing CLI ledger. Do not redeploy v1 to recover a v2 call or make a fresh plan to retry an uncertain request. The client never auto-submits on startup.

This package's source checkout is built into a portable npm payload by the distribution builder. Python code is included; environments, model weights, recordings, API keys and production logs are not.
