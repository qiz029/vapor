# 制作工作流：持久化生成 → Animatic → 音频字幕 → 局部修复 → 回归

此轮将五批功能接到独立 CLI。入口共享 `project.json`，不要求改写现有 Remotion 组件。新产物保存在 `outputs/`，正式付费调用仍遵循用户已授权的范围。

## 1. 生成任务恢复与预算

入口：`tools/video/fal_generate.py`，持久化核心：`tools/video/job_store.py`。

```sh
.venv/bin/python tools/video/fal_generate.py --plan PLAN --root . --out outputs/RUN --dry-run
.venv/bin/python tools/video/fal_generate.py --plan PLAN --root . --out outputs/RUN
.venv/bin/python tools/video/fal_generate.py --plan PLAN --out outputs/RUN --action status
```

运行默认提交后查询一次即返回；同一命令继续查询同一请求。可用 `--wait-seconds 60` 等待；超时、下载失败都不重新提交。队列协议参考 [fal 官方异步推理文档](https://fal.ai/docs/documentation/model-apis/inference/queue)：保存 request_id、status_url、response_url，后续进程使用这些信息取回状态和结果。

状态路径：`submitting → submitted → completed → downloaded`。提交结果未知停在 `submission_unknown`；远端失败进入 `failed/cancelled`。台账在 POST 前执行文件 fsync、原子替换和目录 fsync；文件锁拒绝同一预算目录的并发运行。崩溃恢复测试在模拟服务接受请求后直接 `os._exit`，验证重启不会再次 POST。

未知提交需在提供商控制台查明远端请求，保存仅含 request_id、status_url、response_url 的 JSON，再执行：

```sh
.venv/bin/python tools/video/fal_generate.py --plan PLAN --out outputs/RUN --action reconcile \
  --request-file request-receipt.json --evidence '控制台核对记录路径' JOB_ID
```

没有远端请求证据时保持未知，不提供自动“清空重试”操作。失败和未知任务继续占用预留，只有终态任务可凭账单证据结算：

```sh
.venv/bin/python tools/video/fal_generate.py --plan PLAN --out outputs/RUN --action settle \
  --actual-usd 0.42 --evidence '账单记录路径' JOB_ID
```

`committedUSD` 对已结算任务使用实际费用，对未结算任务使用预留费用。实际账单高于预算仍如实记录，后续任务将被预算检查阻止。未知费用不是零。台账预算固定，不允许修改计划来静默提高预算。不同输出目录是不同预算域，不能用换目录绕过既有生产预算。原 ledger.json 会保留费用和请求字段，迁移到 schemaVersion 2；缺少指纹的旧任务会停止要求核对。

价格有效期只约束新提交，过期不阻止查询已有请求。HTTP POST 不自动重试，并发送 `X-Fal-No-Retry: 1`。鉴权请求限定 queue.fal.run；错误日志不输出服务端正文和密钥。

追踪式生成计划增加：

```json
{
  "project": "project.json",
  "animaticGate": "animatic-approved.json",
  "jobs": [{"id":"shot-01","image":"assets/first.png","dependsOn":["shot:request"],"input":{"duration":5}}]
}
```

以上仅展示新增字段，完整计划仍需 endpoint、价格、预算、有效期和 provider input。project/gate 相对计划文件；image 相对 `--root`。指定 project 时，新提交必须通过 Animatic 门禁，生成输入、参数和结果自动登记。旧计划未指定 project 时保持原用法，不自动宣称已有节奏审批。

## 2. 粗配音与完整 Animatic

```sh
mkdir -p outputs/MY_PROJECT
cp examples/production/project.json outputs/MY_PROJECT/project.json
.venv/bin/python tools/video/animatic.py \
  --project outputs/MY_PROJECT/project.json \
  --plan examples/production/animatic-plan.json --out outputs/MY_PROJECT/animatic
```

每个 beat 对应一个 narration 和 shot，必须恰好覆盖所有旁白。默认使用本机 macOS `say` 生成粗配音，也可为每个 beat 提供相对 plan 的 `audio`。非 macOS 使用 supplied audio；正式 Qwen3-TTS 仍由 voice CLI 生成后作为 audio 输入。空或静音合成视为错误，不能伪装成节奏确认。

时间轴取实际音频采样长度，加可配置 hold 并对齐帧率；beat 可指定 `image`，否则显示明确标注的占位镜头。图片、声音参数、逐句音频、混音、对齐、时间轴与 MP4 自动登记。`--prepare-only` 仅准备和验证，不渲染。输出目录必须新建；失败保留检查记录。

完整观看并确认节奏后，由真实审查者运行：

```sh
.venv/bin/python tools/project/workflow.py gate --project outputs/MY_PROJECT/project.json \
  --target asset:animatic --reviewer '实际审查者' --full-playback-reviewed \
  --out outputs/MY_PROJECT/animatic-approved.json
```

这是审批记录操作，不能仅因渲染通过而执行。门禁绑定完整旁白依赖和实际文件哈希。旁白、分镜、输入音频或时间轴改变后，门禁失效；不会自动替人批准。它只确认粗样节奏，不代表正式成片通过，也不扩大付费授权。

## 3. 最终混音、字幕对齐与资产登记

混音计划格式：

```json
{
  "duration": 7,
  "narration": [
    {"source":"request.wav","narration":"request","at":0},
    {"source":"return.wav","narration":"return","at":3}
  ],
  "music": [{"source":"music.wav","at":0,"start":0,"duration":7,"gainDB":-20,"duckDB":-12,"fadeSeconds":0.25}]
}
```

完整句音频按采样位置拼接，拒绝旁白重叠、越界、截断；音乐可明确裁剪、淡入淡出、在旁白期间平滑压低。输出 peak、true peak、LUFS、LRA、静音与削波检查。默认响度目标 -24 到 -14 LUFS，超出记为 warning；削波或全静音为失败，不自动更改音量掩盖问题。

```sh
.venv/bin/python tools/audio/mix.py mix --project PROJECT --manifest MIX_PLAN --out NEW_MIX_DIR
.venv/bin/python tools/captions/align.py --project PROJECT --audio NEW_MIX_DIR/mix.wav \
  --alignment NEW_MIX_DIR/alignment.json --audio-asset asset:final-mix --out NEW_CAPTION_DIR
```

对齐采用“每句独立音频的真实放置时刻”；也可接入外部生成的同结构 alignment.json。必须包含最终音轨 SHA-256、每句的 narration/text/start/end/method，并恰好覆盖当前全文。拒绝文本不符、重叠、越界及旧音轨。输出 Remotion captions JSON、SRT 和元数据。工具不自带 ASR/强制逐词对齐模型；录制的连续长音轨需先提供可验证的外部句级对齐，不能凭字数猜时间。完整句源音频的内容仍需听辨。

将无烧录字幕的画面母版、最终混音和字幕交付：

```sh
.venv/bin/python tools/video/finalize.py --project PROJECT --picture PICTURE.mp4 \
  --picture-asset asset:picture --audio MIX.wav --audio-asset asset:final-mix \
  --alignment ALIGNMENT.json --captions-asset asset:final-captions-srt --out NEW_DELIVERY_DIR
```

picture 必须先登记。通过 `--captions-asset` 引用字幕导出资产，保持 JSON → SRT → 成片的修复依赖链；省略时会创建独立的 mux-captions 资产。finalize 复制视频码流，替换音轨，加入默认可选择的 mov_text 字幕轨；不重新生成镜头、不重新编码画面。字幕是软字幕，显示取决于播放器，上传平台如需烧录字幕应使用 Remotion 或支持 libass 的 FFmpeg 导出。不能用此步骤移除画面中已烧录的字幕。

检查最终解码音轨与预期混音的长度、零偏移相关性和增益；从 MP4 导出字幕，核对文本和毫秒时间；执行完整解码。数值检查不等于完整听看通过。

统一登记也可独立使用：

```sh
.venv/bin/python tools/project/workflow.py register --project PROJECT --source FILE \
  --id picture --kind video --producer video-production --depends-on shot:request shot:return \
  --origin '来源或生成记录路径'
```

复制到项目目录下 `registered/ID-SHA.ext`，保留旧版本，持锁原子更新清单，旧审批保留以供失效分析。新 workflow 的音频、图片、字幕和视频自动登记；现存任意项目脚本仍需调用登记接口，并非扫描整个仓库自动证明来源完整。

## 4. 审片问题 → 替换修复 → 定向复查

issues.json 是数组，每项包含 id、asset、range、correction。例如：

```json
[{"id":"caption-typo","asset":"asset:final-captions","range":[1,2.5],"correction":"修正标点"}]
```

```sh
.venv/bin/python tools/project/workflow.py repair-plan --project PROJECT --issues issues.json --out repair-plan.json
.venv/bin/python tools/project/workflow.py apply-repair --project PROJECT --plan repair-plan.json \
  --asset asset:final-captions --source corrected-captions.json --origin '问题 caption-typo 的修复' --out repair-receipt.json
# 按 tasks 调用对应制作工具重建受影响的下游产物，然后：
.venv/bin/python tools/project/workflow.py recheck --project PROJECT --plan repair-plan.json --out recheck.json
```

repair-plan 保存基线，给出修复任务、保留资产、复查检查和审批目标。apply-repair 仅接受问题中的资产，拒绝从过期基线覆盖已变更输入；登记替代品但不自动执行付费生成。字幕更改只向下影响字幕消费者，不向上重生成配音或镜头。根据实际用途调用 captions/finalize/Remotion 等工具重建下游。

recheck 检测计划外变动、尚未修改的问题资产与受影响检查。复查状态始终从 not_checked 开始；审查者根据新产物证据填写结果。检查问题范围及邻接转场，最终成片仍需全片听看。

## 5. 三条小型回归样片与测量

`examples/regression/suite.json` 固定竖屏字幕、横屏请求/结果动画、音频与软字幕交付三条样片。第三条使用测试音调验证信号链，不冒充真实配音质量样本。

```sh
.venv/bin/python tools/regression/run.py run --out outputs/regression-RUN
.venv/bin/python tools/regression/run.py compare --before OLD/report.json --after NEW/report.json --out comparison.json
```

记录 suite 哈希、工具/skill 实现哈希、各样片源 MP4 哈希、耗时、失败率、技术验证、provider 调用费用。这个本地 suite 不进行 provider 调用，provider 费用为零；本机计算费用未测量。失败会保留日志并继续其余样片，最终非零退出。不同 suite 哈希拒绝直接比较。

人工/agent 感知审查结果与真实人工返工时间需显式补录，未测量时保持 null：

```json
[{"id":"portrait-captions","artifactSha256":"真实成片哈希","decision":"incomplete","reviewer":"实际审查者","evidence":"带时间戳的 review.json","humanReworkMinutes":3}]
```

```sh
.venv/bin/python tools/regression/run.py annotate --report RUN/report.json --annotations notes.json --out annotated-report.json
```

annotation 必须绑定同一成片哈希。质量结论、人工时间和运行失败率分别比较，不用渲染成功代替质量分数。没有真实返工计时，不应填入猜测值。

## 验证

```sh
.venv/bin/python -m unittest discover -s tests
npm run typecheck
npm test
```

本机沙箱可能限制 macOS 语音服务或 Chrome 监听端口。对应现象是 say 生成空文件、Remotion 报 No available ports found；用已授权的本机执行权限重跑至新目录，失败记录保留。工具本身不会放宽系统权限。
