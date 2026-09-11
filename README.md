# Vapor

A project-based AIGC workspace built on DeepSeek Harness. Each project has a persistent conversation, versioned media artifacts and a spatial canvas. Capability plugins provide local rendering and explicitly approved remote services.

## Status

Pre-release. All 18 npm packages are published at version `0.3.0` with the `beta` tag. Public version metadata matches the release checksums. Clean npm installation is still being verified; the Vapor Hub profile is not yet published. Current validation covers local installation, Remotion rendering, project recovery, and plugin installation/rollback. A real two-turn DeepSeek chat also generated and revised one artifact through the local Remotion plugin, preserved both versions, and recovered them after restart. General remote-provider coverage remains separate.

## Build a local candidate

Requires Node 24+, npm, pnpm (validated with 10.15.1) and DeepSeek Harness 0.1.5-rc.1.

```sh
npm run build
node tools/harness/distribution/audit.mjs outputs/candidate
node tools/harness/distribution/archive.mjs outputs/candidate outputs/vapor-local-candidate.tar.gz
```

Follow `outputs/candidate/README.md` for installation. FFmpeg, Chromium and the Python requirements of selected plugins must be installed separately. Configure credentials in **Settings → 能力插件**. No credentials, private media, model weights or user projects are included here.

## Verification

The standalone source builds all 18 candidate packages and passes package integrity checks. Tests: 83 passed, 2 skipped (workstation-only skill catalog and optional macOS voice preparation). Native UI plugin install/activation/rollback and version playback were exercised. Frame sampling and playback completion do not constitute full creative acceptance.

## Source layout

- `tools/harness/media-workbench`: project state, conversation integration, canvas, jobs and settings.
- `tools/harness/vapor-*`: independently installable capability plugins.
- `tools/harness/distribution`: allowlisted packaging, integrity checks and installer.
- `tools/video`, `tools/audio`, `tools/gpu` and other tool folders: packaged execution helpers.
- `examples`: portable input contracts.

Packages currently remain private candidates to prevent accidental npm publication. Public release requires a separately reviewed package/version and Hub profile.

## License

Vapor source is MIT licensed. Vendored third-party components retain their own notices, including `tools/vendor/video-use/LICENSE`. External runtimes, dependencies and model weights have separate terms.
