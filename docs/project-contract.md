# 项目清单与变更影响（P0 第一批）

`project.json` 是制作数据与依赖关系的统一索引。现有 Remotion manifest、声音 metadata、图片 sidecar、生成任务和 review.json 保留原格式；通过稳定 ID、资产路径和依赖关联。现有项目不自动迁移；新制作工具已接入自动资产登记，追踪式生成计划支持 Animatic 门禁，见 [制作工作流](production-workflow.md)。

## 数据约定

完整可执行样例：`examples/project-contract/project.json`。验证器：`tools/project/project.py`（Python 3.10+，仅标准库）。字段严格校验，未知字段、重复 ID、悬空引用和循环依赖报错。

顶层固定为 `schemaVersion: 1`、`project`、`narrations`、`shots`、`assets`、`checks`、`approvals`。除审批外每项都有 `id` 和 `dependsOn`。引用使用 `project:ID`、`narration:ID`、`shot:ID`、`asset:ID`、`check:ID`；稳定 ID 不随排序、文案变化而变化。

| 记录 | 字段 | 字段责任 |
| --- | --- | --- |
| project | id、title、brief、dependsOn | visual-storyboarding 管理项目需求；用户决定范围 |
| narrations[] | id、text、dependsOn | visual-storyboarding 维护逐句文案；voice-production 消费文案 |
| shots[] | id、intent、visual、dependsOn | visual-storyboarding 维护镜头意图和视觉规则；cinematic-director 提供导演方案，由分镜整合 |
| assets[] | id、kind、path、sha256、producer、source、dependsOn | media-assets 负责登记与来源；producer 对应的 skill 负责生成内容与输入关系 |
| checks[] | id、question、required、dependsOn | video-review 维护验收问题；制作 skill 提供技术检查要求 |
| approvals[] | id、target、checks、fingerprint、decision、reviewer、evidence、recordedAt | video-review 记录真实审查结果与证据；不得把执行成功或指纹生成当作审批 |

`kind` 可表示 image、video、audio、narration、captions、style-spec、manifest 等。`producer` 允许 media-assets、voice-production、video-production、video-style-extraction、cinematic-director、video-editing、music-generation。Remotion 官方 skill 只提供实现指导，不拥有业务字段。声音 profile、生成参数、导演方案和风格文档可以登记成独立资产，让消费者显式依赖。

资产 `path` 相对清单目录，不能逃逸该目录。`sha256: null` 表示计划产物；存在的文件也必须登记真实哈希才是 verified。`source` 填写来源或生成记录的位置/说明。源文件变化会由实际字节哈希检测，不能只信清单里的 sha256。当前按完整文件读取，长视频项目的快照成本与素材总量相关。

## 依赖与审批规则

`dependsOn` 表示“这个输入改变，需要重新处理或核查当前项”。每句旁白独立建记录。配音依赖旁白和声音参数；字幕依赖旁白与最终音轨；镜头画面依赖分镜及所用素材；混音依赖音频；成片依赖画面、混音、字幕和编排。跨镜头时序或连续性也必须明确连边，不能假设工具能从自然语言推断。

变化报告区分自身变化和上游变化，列出直接变动的依赖、受影响资产和检查。受影响代表需要处理/复核，不等于必须调用付费生成器。若镜头仍适用于新旁白，应由制作/审查流程确认复用，不能直接沿用旧审批。

每个节点的 revision 包含自身内容、实际文件哈希和上游 revision。审批 fingerprint 绑定目标及指定检查的 revision。审批检查清单必须包含所有直接依赖目标或其上游节点的 required 检查，遗漏时 freshness 为 stale。文件缺失或哈希未登记也不能得到 current。

`current` 仅表示审批记录仍对应当前输入，不代表已证实证据真实性或完整观看。真实 decision、reviewer、evidence、recordedAt 由审查者填写；原 review.json 继续记录时间戳、覆盖和判断。CLI 不自动批准，也不签名认证审批人。本批不实现权限系统、生成调度或审批执行门禁。

## 命令

从仓库根目录执行；输出文件必须尚不存在。

```sh
python3 tools/project/project.py validate --project examples/project-contract/project.json
python3 tools/project/project.py snapshot --project examples/project-contract/project.json --out outputs/contract-before.json
# 修改 project.json 的某句旁白后：
python3 tools/project/project.py impact --project examples/project-contract/project.json --before outputs/contract-before.json --out outputs/contract-impact.json
```

`validate` 验证结构并报告素材状态；planned/missing 不会使结构校验失败。snapshot 是旧版本的内容快照，不能用已变更文件重新构造旧版本。

审查完成后可以用以下命令计算待记录的 fingerprint；此命令不产生审批：

```sh
python3 tools/project/project.py fingerprint --project examples/project-contract/project.json --target asset:final --checks check:request-alignment check:return-alignment check:playback
```

可用 `python3 -m unittest discover -s tests -p test_project_contract.py` 验证一句旁白变更、字幕局部修改、实际文件替换、审批过期、缺失素材、引用错误和无效路径。

## 制作工作流批次

以下批次已有可执行入口，命令及具体边界见 [制作工作流](production-workflow.md)。

1. P0：粗配音与 Animatic，正式付费生成前完整播放确认节奏。
2. P0：生成任务持久化、恢复、预算预留，以提交后崩溃为验收案例。
3. P1：字幕对齐、混音检查、将所有实际使用的媒体接入统一登记。
4. P1：审片问题关联局部修复动作与定向复查，接入审批失效结果。
5. P1：小型回归样片集与质量、失败率、人工返工、成本的端到端测量。
