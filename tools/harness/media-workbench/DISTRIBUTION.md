# Vapor Framework

This package runs inside DeepSeek Harness 0.1.5-rc.1 with Node 24+. It provides a media board, library, versioned artifacts, precise feedback and a local job runtime. Optional plugins register executable adapters or independently governed remote services.

The current candidate is not published on npm or PluginHub. Install it using the candidate archive’s README and install-local.mjs. Public Studio Profile installation remains a release requirement; do not use an unverified similarly named package.

Set `VAPOR_PROJECT_ROOT` to a user-owned project directory before starting Harness. The default is `vapor-project` under the process working directory. One process hosts multiple isolated projects; each project keeps its own primary chat. Package installation directories never hold project data. Import explicit media with `vapor import`; create an empty production contract with `vapor init`. Existing projects remain compatible with `MEDIA_WORKBENCH_PROJECT`.

Select the **Vapor · 媒体创作** preset. The board stores immutable media snapshots and SQLite metadata under `workbench/`. Stop the service before backing up the entire directory, including any WAL files. Uninstalling or rolling back packages does not delete projects or restore their database schemas. Back up project data before upgrades.

Local plugins register `contractVersion: 1` adapters with validated input schemas. Network/paid declarations remain rejected by that registry. Remote services use `runtime.registerService(id, service)` with their own durable task and authorization contract; they must drain work in `close()` and never reuse a local cancel signal as proof of remote cancellation. The framework owns project state and HTTP authentication; service registration is trusted executable plugin code, not an OS sandbox.

The built-in VLM panel is available only when the Modal Qwen service is installed. The Agent can prepare and collect reviews, but only the user UI can approve an exact batch, reconcile a call ID or settle billing. Reports remain pending review.

This beta is loopback-only. Node and browser UI support must be verified on each release target. The shell theme contains Harness-version-specific CSS. Do not expose this development service publicly.

## Local commands

The package exposes a `vapor` binary (use the installed profile's `node_modules/.bin/vapor` if it is not on PATH):

```sh
vapor doctor
vapor init --project ./my-film
vapor import --project ./my-film ./reference.png ./clip.mp4
vapor serve --project ./my-film --profile web --port 3090
```

Import copies only explicitly named supported files and preserves originals. The total per-file limit is 512 MiB. `doctor` checks Node, DSH, FFmpeg, the configured Python and optional Modal/Pillow availability without reading secrets or calling a model. Missing optional dependencies do not prove other plugins are unusable; review each check.

## Tool packs in 0.3

Use chat to describe creation or revision requests. The canvas’s 创作任务 dialog shows prepared jobs and exact approval forms; Settings > 能力插件 manages installed capabilities. Agents discover operations with `media_tools_list`, read packaged manifest contracts with `media_tool_help`, prepare with `media_tool_prepare`, execute local work with `media_tool_run`, and inspect original jobs with `media_tool_get`. Inputs are project-relative; nested media dependencies are hashed before execution. Registered historical manifests are retained as evidence, without rebasing their original paths.

Remote jobs and acceptance gates require exact user approval in the canvas creation task dialog. The same project `generation/ledger.json` enforces reservations across providers. `media_tool_resume` recovers original requests or imports a completed, hash-verified local receipt; it cannot create a new paid job. Provider cancellation still happens at the provider, followed by verified local reconciliation. Unknown synchronous uploads are retained and never automatically repeated.

The Studio Profile includes all cross-platform capability packs. Native MLX voice and the old Gemini review route are separate optional packages. Experimental music options remain plans, not executable model integrations. Startup does not load model weights or contact providers.

This release does not provide an OS sandbox for trusted installed plugins. Stop active jobs before upgrading/unloading plugins. Back up the whole project before package upgrades; package rollback does not roll back project assets or SQLite.

## Plugin settings and updates

Open Settings > 能力插件 to enable installed project capabilities, configure local service credentials, and search PluginHub. Vapor reads the official public Hub API directly and builds exact version/commit plans. It does not require a global Hub CLI. Withdrawn versions are rejected; unknown additive catalog metadata does not break search.

Confirmed installations use a staging Profile with install scripts disabled and run DSH configuration validation. Start with `vapor serve` to activate a ready update; previous complete profiles remain available through the recovery button. Project assets and credentials are not rolled back. Failed preparation retains the active profile. A ready update can be cancelled before restart. Version switching validates configuration fingerprints and restores a verified previous profile if the replacement fails that check. This does not promise automatic rollback of every runtime startup failure.
