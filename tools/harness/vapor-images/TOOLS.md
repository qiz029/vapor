# @toddzheng024/vapor-images

Install as a DSH bundle alongside @toddzheng024/vapor 0.3.0. Requires Node 24+, FFmpeg/FFprobe and a Python environment selected by VAPOR_TOOLS_PYTHON (or plugin config.python). Install requirements.txt into your own environment. No install hook downloads models or runs media.

In Vapor Lab, select a plugin tool, enter project-relative file paths, prepare, then execute. Agents use media_tools_list, media_tool_prepare, media_tool_run and media_tool_get. Remote work requires exact user approval in Lab; media_tool_resume only resumes the original job. Use the recovery panel for provider receipts and verified billing. The project uses one generation/ledger.json across plugins.

Tool inputs and outputs live in VAPOR_PROJECT_ROOT, not node_modules. Setup credentials in the process environment; plugins do not read .env files. Models and voice profiles stay in project models/ and voices/, and are never included in packages. Results retain pending visual/listening/playback review.

## Operations

- **image.import**: local; required inputs: source, promptFile, provider.

Exact input schemas are returned by media_tools_list and recorded in catalog.json. Reference contracts, examples and helper licenses ship in resources/. JSON file references must resolve within the selected project.
