# 项目内 video-use 剪辑

入口 skill：`skills/video-editing/SKILL.md`。原版 `browser-use/video-use` 的 helpers、测试、说明和 MIT LICENSE 保存在 `tools/vendor/video-use/`，版本固定为 `9575612f066aa517354790a645fd90f9f95a743b`。`skills/upstream-lock.json` 保存每个文件哈希，加载 helper 时验证。上游文件未修改；本地适配在 `tools/video/editing/`。

这里没有安装全局 skill、修改 `.env` 或调用云端转写。根目录 `AGENTS.md` 路由项目内的剪辑请求。上游安装流程和上游 SKILL 是保留的参考，不作为本项目第二套审批、目录或子代理规则。

## 依赖

使用本项目 `.venv/bin/python`、FFmpeg/FFprobe。已有媒体依赖加 `requirements-video-editing.txt` 中的 Pillow。上游 pyproject 声明的 librosa/matplotlib 在当前调用路径中不需要，不另建 Remotion/Manim/HyperFrames 环境。

```sh
uv pip install --python .venv/bin/python -r requirements-media-tools.txt -r requirements-video-editing.txt
```

烧录字幕需要 FFmpeg 的 libass `subtitles` 滤镜。本机已安装并将默认 ffmpeg/ffprobe 链接到 Homebrew `ffmpeg-full 9.0.1_1`，使用 `libass 0.17.5`；软字幕和中英文烧录均已验证。原精简版 FFmpeg 8 的链接已移除，未修改 shell 配置文件。

## 1. 登记源素材

源视频不移动、不覆盖。统一登记器保存不可变副本与来源：

```sh
.venv/bin/python tools/project/workflow.py register --project outputs/MY_PROJECT/project.json \
  --source /path/to/take-a.mp4 --id take-a --kind video --producer media-assets \
  --origin '原始拍摄或生成记录的位置'
```

需要现有 `project.json`；格式见 `docs/project-contract.md`。每个新素材有自己的 ID；替换素材后，哈希及依赖变化使旧转写/审批失效。

## 2. 导入或生成逐词转写

已有词级 JSON 可直接导入。内容必须包含 `words`，每项有 type、text、start、end，可带 speaker_id。type 支持 word、spacing、audio_event。导入不证明实际说话内容，需要试听核对；如果原 JSON 自带 sourceSha256/audioTrack，必须与选定素材一致。

```sh
.venv/bin/python tools/video/editing/transcripts.py import --project PROJECT.json \
  --source asset:take-a --id take-a-transcript --input transcript.json --audio-track 0 \
  --origin '转写工具和原始记录'
.venv/bin/python tools/video/editing/transcripts.py pack --project PROJECT.json \
  --transcripts asset:take-a-transcript asset:take-b-transcript --out outputs/MY_PROJECT/takes.md
```

pack 复用上游 phrase grouping，供 agent 比较 take 和停顿；正式切点仍依据原始词级数据。

可选 Scribe 路径：在用户授权上传及费用后，使用本地环境变量 `ELEVENLABS_API_KEY`。不在聊天中提供密钥，不自动读取任意目录下的 `.env`。

```sh
.venv/bin/python tools/video/editing/transcripts.py cloud --project PROJECT.json \
  --source asset:take-a --id take-a-transcript --audio-track 0 --language en \
  --allow-upload --estimated-usd 0.10 --budget-usd 0.20
```

金额仅演示参数，不代表提供商价格。执行前按实际源长度和当前价格填写已授权的单次估算与上限。此处预算范围是一条转写请求；需要批量共享预算时应由生产计划限制总量，不把单次上限当整个项目上限。

缓存按源字节、音轨、语言和模型生成指纹，位于项目目录 `transcript-cache/`，使用文件锁。POST 前持久化预留；进程崩溃或结果未知不会自动重传。同一缓存已收到结果时不再读取密钥、不再调用 API。静音音轨在上传前被拒绝。结果未知需查提供商记录；工具没有自动清空重试。实际费用保留 null，安装验证只模拟请求，没有访问真实 Scribe。

## 3. 写 EDL 并剪辑

完整样例见 `examples/video-editing/edl.json`：

```json
{
  "schemaVersion": 1,
  "id": "rough-cut",
  "fps": 24,
  "sources": {
    "a": {"asset":"asset:take-a","speech":true,"transcript":"asset:take-a-transcript","audioTrack":0},
    "b": {"asset":"asset:take-b","speech":false}
  },
  "ranges": [
    {"source":"a","start":0.5,"end":1.5,"reason":"保留完整开场句"},
    {"source":"b","start":0.25,"end":1.25,"reason":"接上结果镜头"}
  ],
  "grade": "none",
  "overlays": [],
  "subtitleMode": "soft"
}
```

```sh
.venv/bin/python tools/video/editing/edit.py validate --project PROJECT.json --edl EDL.json
.venv/bin/python tools/video/editing/edit.py render --project PROJECT.json --edl EDL.json --out outputs/MY_PROJECT/edit-v1 --draft
```

移除 `--draft` 为正式提取质量。当前复用上游尺寸选择：横屏 draft 为 1280 宽、正式为 1920 宽；竖屏为对应高度，保持源宽高比。不宣称支持任意输出尺寸。

约定：

- speech=true 必须有同一源哈希、同一音轨的逐词转写。不要为绕过校验而将对话素材标为非语音。
- start/end 为源时间，顺序由 ranges 决定。切点不能位于词内；留多少上下文由语速和剪辑目的决定。
- 每段时长必须是至少两个完整输出帧。当前支持整数 fps 1–60；未开放上游的有理数帧率参数。
- 输入画幅比例必须一致；混合横竖屏应先明确统一画布/裁切方案。不同音轨布局通过显式选轨并统一为立体声处理。
- grade 可为 none、subtle、neutral_punch、warm_cinematic、auto。默认 none；raw FFmpeg filter 不属于适配器输入接口。
- overlay 格式为 `{"asset":"asset:overlay-1","start":0.5,"duration":1}`，时间相对成片。复用上游 PTS 平移和叠加，overlay 必须足够长。位置默认为左上角，尺寸由素材本身决定；先用 Remotion 制作正确画幅和透明通道。
- 可选 `subtitleFont` 指定纯字体族名称，例如 `"Heiti SC"`。macOS 检测到汉字且系统 Heiti 字体存在时默认使用 Heiti SC，避免 CoreText 回退到不可读取的 PingFangUI 字体后出现方框；其他文本保留上游 Helvetica 默认。报告记录选定字体和 FFmpeg 版本。
- subtitleMode 为 none/soft/burn。保持原始语言和大小写，当前每个 word 一条字幕，可供后续字幕工具重新分组。soft 写 mov_text 轨并回读验证；burn 在所有 overlay 之后烧录，缺少 libass 时明确失败。

音频适配：从选定源音轨精确提取 PCM，在每个切段边缘应用 30ms 淡入淡出，缺音轨段明确补静音。画面单独拼接，避免 AAC 段填充累积移动后续切点；最后只将完整 PCM 编码为一条 AAC 音轨。不默认做上游 -14 LUFS 自动归一化，保留已有项目的混音检查职责。

每次输出必须是新目录，包含 EDL、源/成片切点映射、期望混音、字幕、成片转写、MP4、技术报告；失败留下 failure.json。产物、输入依赖和 `video-editing` producer 自动登记，并建立 cut-review 检查。旧源素材不被重新生成。

## 4. 查看切点并接入复查

```sh
.venv/bin/python tools/video/editing/edit.py view --project PROJECT.json \
  --asset asset:rough-cut --transcript asset:rough-cut-transcript \
  --start 0.5 --end 1.5 --out outputs/MY_PROJECT/cut-001
```

输出胶片条、波形和词标签 PNG，以及源哈希/查看区间。源视频也可使用对应 transcript 查看；音轨跟随 transcript 的 audioTrack。没有转写时省略 `--transcript`。

本地 adapter 修正了上游波形的整数分窗截尾问题：所有采样映射到完整时间范围，避免波形凹口相对标尺漂移。上游文件保持原样，该修正位于 `evidence.py` 并有时间定位测试。胶片条是离散帧，不能作为连续运动或完整听音证据。

对每个切点和密集叠加/字幕处检查，按 `video-review` 记录实际观看、听音范围。问题可针对 `asset:rough-cut-edl` 发起 repair-plan；重剪只影响剪辑下游，不重新下单生成 take。若只改最终字幕，应使用无烧录字幕母版及已有 captions/finalize 路径。

## 验证与升级

```sh
.venv/bin/python -m unittest discover -s tests -p test_video_editing.py
.venv/bin/python -m unittest discover -s tools/vendor/video-use/tests
```

本地 smoke：`outputs/video-editing-smoke/edit-v2/final.mp4`。它使用纯色/音调与合成词时间验证剪辑链，不证明真实口播转写质量。

升级时在临时目录取得指定上游 commit，审查 helpers 变化，再整体更新 vendor 文件与 lock 哈希；不要对运行中的 vendor 目录直接 git pull，也不要修改全局 skill。运行本地与上游测试，并渲染/检查代表样片。上游 renderer 支持的能力不自动等于本适配器已验证的能力。
