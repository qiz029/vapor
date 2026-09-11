# Vapor Local Voice (optional, macOS)

Prepare a 3–30 second reference from a registered audio/video revision. This package is separate from the cross-platform Studio Profile because its network-denied execution relies on macOS sandbox-exec.

Install the requirements into your own Python environment and set `VAPOR_VOICE_PYTHON` to its executable. FFmpeg is required. Prepare Demucs weights separately before use; processing denies network and will not download missing weights. The package contains processing code, never recordings, models, global voice profiles or credentials.

After processing, listen to all tracks, verify the transcript and record the source authorization in Lab. Saving the legacy reference Profile does not synthesize speech or establish voice quality.

The 0.3 tool catalog separately exposes `voice.add`, `voice.list`, `voice.doctor`, `voice.speak` and the user-approved `voice.prepare-model` download. These use the existing native profile format under the selected project's `voices/` and locked weights under `models/`; they do not consume the legacy Lab reference-asset JSON. Choose `VAPOR_TOOLS_PYTHON` (or plugin config.python) with MLX-Audio installed for these operations. Model-dependent inference has not been accepted by full listening. See [operations](TOOLS.md).
