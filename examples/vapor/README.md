# Portable Vapor inputs

These are templates, not completed media or provider authorization. Copy a template into your project and replace source paths and content. All file references must resolve inside that project. Use `vapor init --project DIR` for an empty production contract; import and register actual sources before editing.

- `audio-assembly.json`: `audio.assemble` sample-positioned audio, no narration overlap.
- `music-video.json`: full MV rendering or still previews. Images/videos and audio are relative to the manifest. Scene boundaries must cover the complete duration. Select `mode: still` and a frame to preview before a full render. The base look accepts images or videos; editorial requires images; kinetic, chorus editorial and lyric-driven require videos. Kinetic plays source video at 1.25x and requires enough source duration. Lyric-driven also requires audio, captions and an `accents` array of `{time, strength}` musical events (empty is allowed). Use `trimStart` in source seconds when trimming video scenes.
- Production narration/mix/captions use the shared project contract in `docs/production-workflow.md`; a waveform or synthetic fixture does not prove spoken text.
- Editing uses `examples/video-editing/edl.json` and `docs/video-editing.md`. Register transcripts against the exact source and audio track; do not disable speech checks to force a cut through.
- Music generation templates remain under `examples/music`. ACE-Step and Vevo2 entries are experiment plans only.
- Modal templates remain under `examples/modal`. GPU selection does not prove deployment or model availability. Dates and costs in examples are placeholders; refresh before requesting approval.

Provider secrets belong in process environment variables. Do not insert keys in plans. Do not add a second ledger to reset project spending. Full visual review, listening, playback, and actual billing remain separate from tool execution.
