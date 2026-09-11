# Vapor

A project-based AIGC workspace built on DeepSeek Harness. Each project has a persistent conversation, versioned media artifacts and a spatial canvas. Capability plugins provide local rendering and explicitly approved remote services.

## Status

Pre-release. npm packages and the Vapor Hub profile are not yet published. Do not install similarly named packages as substitutes. Current validation covers local installation, Remotion rendering, project recovery, and plugin installation/rollback. Remote provider coverage remains separate.

## Build a local candidate

Requires Node 24+, npm, pnpm (validated with 10.15.1) and DeepSeek Harness 0.1.5-rc.1.

```sh
npm run build
node tools/harness/distribution/audit.mjs outputs/candidate
node tools/harness/distribution/archive.mjs outputs/candidate outputs/vapor-local-candidate.tar.gz
```

Follow `outputs/candidate/README.md` for installation. FFmpeg, Chromium and the Python requirements of selected plugins must be installed separately. Configure credentials in **Settings → 能力插件**. No credentials, private media, model weights or user projects are included here.

## Source layout

- `tools/harness/media-workbench`: project state, conversation integration, canvas, jobs and settings.
- `tools/harness/vapor-*`: independently installable capability plugins.
- `tools/harness/distribution`: allowlisted packaging, integrity checks and installer.
- `tools/video`, `tools/audio`, `tools/gpu` and other tool folders: packaged execution helpers.
- `examples`: portable input contracts.

Packages currently remain private candidates to prevent accidental npm publication. Public release requires a separately reviewed package/version and Hub profile.

## License

Vapor source is MIT licensed. Vendored third-party components retain their own notices, including `tools/vendor/video-use/LICENSE`. External runtimes, dependencies and model weights have separate terms.
