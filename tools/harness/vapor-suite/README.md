# Vapor Studio

A DSH Plugin Hub Profile combining Vapor Framework with project, audio, captions, editing, Remotion/MV, images, review evidence, music, fal generation, Modal GPU, costs, regression, Viggle and Modal Qwen plugins. Packages are pinned to 0.3.0; Harness is tested against 0.1.5-rc.1. The framework loads first, then capability plugins. Discover the installed operations with media_tools_list or the Lab tool panel.

The framework opens and manages projects without GPU credentials. Configure the optional plugin's Python/Modal environment when you want remote visual inspection. Media and project state belong to the user's project directory and are not shipped in the Profile.

This is a local release candidate. After npm packages are published, capture the installed, verified Profile with `dsh-hub profile share vapor-studio --version 0.3.0 --profile web --dry-run`, inspect its exact runtime/bundles, then publish. Do not publish the development profile: it contains local links and workstation-specific presets. A Profile package descriptor is not yet a Hub immutable Profile Release.

Use a fresh DSH_HOME to test installation. Confirm preset discovery, plugin registration, one representative render, input preparation and recovery. `dsh-hub profile doctor` verifies installed versions and drift. Upgrades require a Profile diff; rollback restores packages/configuration, not project media or SQLite data.

The public repository, npm publication, license choice, Hub screenshots and real cloud integration verification remain release tasks. No claim of public availability is made by this package.

The macOS-only `@toddzheng024/vapor-voice-local@0.3.0` package is optional and includes native reference profiles and local TTS; model setup and full listening remain separate. `@toddzheng024/vapor-review-gemini` preserves the previous Gemini operations as an optional plugin. The default visual model route remains Modal → Qwen.

If pnpm reports `ERR_PNPM_IGNORED_BUILDS` for esbuild, review and allow that dependency's build script in the selected local profile, then rerun installation. Do not enable every dependency's scripts globally. Package installation and successful Profile activation are separate checks.
