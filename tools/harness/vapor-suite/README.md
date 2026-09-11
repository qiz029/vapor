# Vapor Studio

A DSH Plugin Hub Profile combining Vapor Framework with project, audio, captions, editing, Remotion/MV, images, review evidence, music, fal generation, Modal GPU, costs, regression, Viggle and Modal Qwen plugins. Packages are pinned to 0.3.0; Harness is tested against 0.1.5-rc.1. The framework loads first, then capability plugins. Discover the installed operations with media_tools_list or the capability settings.

The framework opens and manages projects without GPU credentials. Configure the optional plugin's Python/Modal environment when you want remote visual inspection. Media and project state belong to the user's project directory and are not shipped in the Profile.

Vapor Studio 0.3.0 is published on npm and as the public Hub profile `vapor-studio`. The source repository is https://github.com/qiz029/vapor (MIT).

With Node 24+, DSH 0.1.5-rc.1, Hub CLI 0.2.0 and pnpm installed, use a separate `DSH_HOME` and run:

```sh
PNPM_CONFIG_IGNORE_SCRIPTS=true npm_config_ignore_scripts=true dsh-hub profile apply vapor-studio --version 0.3.0 --profile web
```

This installs fixed versions without dependency installation scripts. A clean installation using the public Hub CLI passed; the independent server passed local authentication and served chat and canvas successfully. Provider execution and full media acceptance remain separate checks. Configure capabilities in Settings → 能力插件.

Back up projects and the local Harness home before upgrades. Package rollback does not restore project media or databases.

The macOS-only `@toddzheng024/vapor-voice-local@0.3.0` package is optional and includes native reference profiles and local TTS; model setup and full listening remain separate. `@toddzheng024/vapor-review-gemini` preserves the previous Gemini operations as an optional plugin. The default visual model route remains Modal → Qwen.

If pnpm reports `ERR_PNPM_IGNORED_BUILDS`, use both environment variables above. pnpm 11 reads `PNPM_CONFIG_IGNORE_SCRIPTS`; setting only the npm-style variable is insufficient.
