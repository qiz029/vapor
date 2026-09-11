# 本地声音克隆与配音

默认路线：MLX-Audio 0.5.1 + Qwen3-TTS 1.7B Base 8bit，在 Apple Silicon 上运行。不需要 API Key，也不会读取 `.env`。MiniMax 的空凭据占位保留，尚未接入。

参考音频默认使用本地 Demucs 分离人声，再送入 Qwen3-TTS；已干净的单人录音可显式指定 `--separation none`。当前本机已有 Demucs 4.0.1、PyTorch 2.5.1、torchaudio 2.5.1，模型为 `htdemucs`；该工具在独立于 TTS 的环境中运行，优先使用 `.venv-separation/bin/demucs`，其次从 PATH 查找。

## 安装与恢复

在仓库根目录执行：

```sh
uv venv --python 3.11 .venv
uv pip sync --python .venv/bin/python requirements.lock.txt
.venv/bin/python tools/voice/prepare_model.py
```

依赖版本记录在 `requirements.lock.txt`，模型仓库与精确 revision 记录在 `model-lock.json`。下载公开模型无需 Hugging Face token。模型约占 2.9 GB，当前虚拟环境约占 499 MB。推理入口启用了 Hugging Face 离线模式，模型下载与推理分开执行。

恢复人声分离工具时，可在单独环境安装以下版本，并将该环境的 `bin` 加入 PATH：

```sh
uv venv --python 3.11 .venv-separation
uv pip install --python .venv-separation/bin/python -r requirements-separation.txt
export PATH="$PWD/.venv-separation/bin:$PATH"
```

Demucs 首次运行会下载公开模型到 PyTorch 缓存；本机已缓存。它在本地运行，不上传参考音频。

## 保存音色

选一段清晰、单人说话、没有背景音乐的录音，建议先用 5–15 秒。视频也可直接作为输入，由 FFmpeg 提取音轨。创建一个文本文件，逐字记录**所选时间段**说的话。

```sh
.venv/bin/python tools/voice/voice.py add todd \
  --source /absolute/path/recording.mp4 \
  --start 10 --duration 12 \
  --transcript /absolute/path/reference.txt \
  --source-note '本人录音，供项目配音使用'
.venv/bin/python tools/voice/voice.py list
```

默认会先截取保留立体声的片段，再使用 Demucs 分出 `vocals` 与 `no_vocals`，最后将人声转换为 24 kHz 单声道参考音频。创建的 `voices/todd/` 保存原混音 `mixture.wav`、两个分离音轨、`reference.wav`、`reference.txt` 和 `profile.json`。分离失败会终止导入，不会回退到原混音。

转写必须与实际截取内容一致；导入命令本身不自动转写，不做多说话人分离。背景伴奏分离也不保证完全去掉混响或所有噪声，仍需听人声和被移除的音轨，检查是否残留配乐或误伤人声。相同名称不会覆盖已有 profile。

Profile 是参考音频与模型配置的组合，不是为每个人单独训练的模型。保存好整个 `voices/` 目录即可复用；原视频不用在每次生成时重新提供。

## 生成配音

把旁白写入 UTF-8 文本文件；长文案请显式分文件调用；当前克隆路径不会按换行自动分段，数字建议先写成预期读法。

```sh
.venv/bin/python tools/voice/voice.py speak todd \
  --text-file /absolute/path/narration.txt \
  --output outputs/todd/narration.wav
```

输出 WAV 及同名 JSON，记录输入文案、音色、模型、随机种子、生成时长、音频时长和 MLX 峰值内存。文件不会覆盖；修改文案后应选择新的输出名。`--seed` 默认为 42；固定种子有助于复现，但不保证跨硬件或模型版本逐位相同。

默认中文生成。导入其他语言的 profile 时可用 `--language English` 等模型支持的语言。该 Base 模型的克隆入口没有实现可靠的原生语速控制，因此暂不暴露无效的语速选项。

## 检查与边界

- 先试听参考音频，再完整听生成音频，检查漏字、重复、数字、多音字、停顿和尾音。
- 同名 JSON 的 `listening_review` 初始为 `pending`，生成成功不代表听感验收完成。
- 输出长度有 token 上限；长文案按镜头拆开，检查是否提前结束。
- `api_cost` 为 0；本地电力、设备与人工成本未测，`total_cost` 保留未知。
- `voices/`、`outputs/`、`models/` 与 `.env` 已加入 Git 忽略规则；忽略不等于备份。
- `qwen-demo` 只使用官方公开示例验证安装，不是可直接用于成片的用户音色。
- `chen-jianbin` 是早期未分离参考音轨的对照版本；后续采用 `chen-jianbin-clean`，包含人声分离步骤与处理记录。

上游依据：[MLX-Audio 克隆指南](https://github.com/Blaizzy/mlx-audio/blob/main/docs/guides/voice-cloning.md)、[模型卡](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit)。

## 本机冒烟记录（2026-09-04）

M5 Max、48 GB 内存；MLX-Audio 0.5.1、MLX 0.32.2。通过 `qwen-demo` 的英文官方示例参考音频生成中文复利文案，验证跨语言调用和完整文件落盘：

- 产物：`outputs/smoke/chinese.wav`，24 kHz 单声道，7.72 秒。
- 模型加载：3.57 秒；包括加载、生成和写文件共 11.58 秒。
- MLX 记录的峰值内存：8.01 GB（不是整机内存占用）。
- 元数据：`outputs/smoke/chinese.json`。
- 仅单次安装冒烟，未做完整听感评审、真人相似度评审或与 MiniMax 对比。


## 依赖检查与单独分离

```sh
.venv/bin/python tools/voice/voice.py doctor
.venv/bin/python tools/voice/voice.py separate \
  --source /absolute/path/recording.mp4 --start 10 --duration 12 \
  --source-note '本人录音，测试参考声音预处理' \
  --output-dir outputs/reference-review
```

`doctor` 检查 FFmpeg、FFprobe、Demucs 是否可启动，列出当前 Python 中的 TTS 依赖版本和模型配置是否存在；不代表权重完整或推理已验证。Demucs 权重首次使用可能需要下载。

`separate` 不创建 profile，保存混音、人声、伴奏、24kHz 单声道 `reference.wav` 和 `preprocessing.json`。输出目录必须不存在；失败的暂存目录自动移除。报告记录来源、参考音频哈希、时长、峰值、RMS 和触顶样本比例。静音或非有限样本会报错；其他统计只供筛查，不能证明自然度或分离质量。

`add` 与 `separate` 共用预处理实现。干净单人录音可以加 `--separation none`，只做格式转换；此选择记录在 metadata 中，分离失败不会自动回退。默认 Demucs 模式保持原有行为。无需为了更新工具重新创建已有 profile。

人声分离不能区分多个说话人，也不等同于去混响。自动转写、说话人分离和进一步降噪尚未做成通用入口；参考文本仍需要逐字核对。语速与语气稳定性需要在 TTS 侧另外验证。
