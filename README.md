# Vapor

A project-based AIGC workspace built on DeepSeek Harness. Each project has a persistent conversation, versioned media artifacts and a spatial canvas. Capability plugins provide local rendering and optional remote services.

## Install

Vapor is available as **0.3.0 beta**: 18 public npm packages and the public Hub profile `vapor-studio@0.3.0`. Requires Node.js 24 or newer. Install the pinned tools:

```sh
npm install -g @deepseek-ai/dsh@0.1.5-rc.1 @dsh-plugin-hub/cli@0.2.0 pnpm@10.15.1
```

Use a separate home to keep Vapor projects and settings together:

```sh
export DSH_HOME="$HOME/.vapor"
PNPM_CONFIG_IGNORE_SCRIPTS=true npm_config_ignore_scripts=true \
  dsh-hub profile apply vapor-studio --version 0.3.0 --profile web
```

Both environment variables are intentional: pnpm versions differ in how they read configuration. Dependency installation scripts are disabled. Without this setting, pnpm 11 can stop with `ERR_PNPM_IGNORED_BUILDS` for esbuild. Public profile installation does not require a Hub publisher login.

Start a project:

```sh
export DSH_HOME="$HOME/.vapor"
VAPOR_BIN="$DSH_HOME/profiles/web/node_modules/.bin/vapor"
"$VAPOR_BIN" doctor
"$VAPOR_BIN" init --project "$HOME/Vapor Projects/My First Project"
"$VAPOR_BIN" serve --project "$HOME/Vapor Projects/My First Project" --profile web --port 3090
```

Run `init` only when creating a project. For later launches, run `serve` with the same home and project. Open the local link printed by the server on first launch; it establishes the browser's local authentication cookie. Treat that link as private. Subsequent visits use `http://127.0.0.1:3090/` while the cookie remains valid.

Select projects and their materials on the left, create through chat, and review versioned artifacts on the canvas. Configure provider credentials and choose capabilities in **Settings → 能力插件**. Credentials remain in the local Harness home; retain that directory across restarts. Remote operations need the relevant provider credentials and authorization.

## Media requirements

Install FFmpeg/ffprobe and Chrome/Chromium for local media work. Set `REMOTION_BROWSER_EXECUTABLE` if browser discovery needs an explicit path. Selected Python plugins require their own `requirements.txt` installed in a Python environment; point `VAPOR_TOOLS_PYTHON` to it. Modal Qwen inspection uses `VAPOR_VLM_PYTHON` and Modal credentials. Installation does not download model weights or invoke remote generation.

The default profile includes the framework and 14 capability plugins. Local macOS voice and the legacy Gemini review plugin are separately published optional packages. Voice models and full listening validation remain separate setup steps.

## Verification and limits

- All 18 npm versions were verified against the release integrity values; a clean npm suite install passed.
- The public Hub profile was installed into a new home using the published Hub CLI 0.2.0. Its 17 bundles include two Harness built-ins and 15 Vapor bundles. Configuration validation passed.
- An independent Hub installation started successfully: the canvas returned HTTP 200, and the chat returned HTTP 200 after the initial local authentication exchange.
- Earlier acceptance used two real DeepSeek chat turns to create and revise a local Remotion artifact, preserve both versions, and recover them after restart. Plugin activation/rollback and version playback were also exercised.
- Source tests: 83 passed, 2 explicit skips. Frame samples and playback completion are not full creative acceptance. Broad remote-provider coverage and a fresh macOS-machine install remain separate checks.

This is a beta release. Back up the complete project and local Harness home before upgrades. Package rollback does not restore project media or databases.

## Build from source

```sh
npm run build
node tools/harness/distribution/audit.mjs outputs/candidate
node tools/harness/distribution/archive.mjs outputs/candidate outputs/vapor-local-candidate.tar.gz
```

Follow `outputs/candidate/README.md` for local candidate installation. Builds default to private candidate manifests; public release artifacts are produced separately with the explicit `--publishable` builder option. No credentials, private media, model weights or user projects are included.

## Source layout

- `tools/harness/media-workbench`: projects, chat integration, canvas, jobs and settings.
- `tools/harness/vapor-*`: capability plugins.
- `tools/harness/distribution`: packaging, integrity checks and installer.
- `tools/video`, `tools/audio`, `tools/gpu`: packaged execution helpers.
- `examples`: portable input contracts.

## License

MIT. Vendored components retain their own notices, including `tools/vendor/video-use/LICENSE`. External dependencies and model weights have separate terms.
