# Leemo Skill 市场扩容与 Superpowers 内置设计

**状态：** 已批准，2026-08-07

## 目标

在不建设 Leemo 云端 Skill Hub 的前提下，补全 ColaOS、NewMax 与 WorkBuddy 已精选且能够追溯到公开 GitHub 仓库的 Skill，让用户看到的每一张可安装卡片都对应真实、可运行、来源清楚的能力。同时把 Superpowers 全套作为离线内置能力随安装包提供。

本轮沿用现有三层产品心智：

- **Leemo 精选：** 随安装包离线提供，安装后即可启用；
- **社区可信：** 客户端内置静态目录，用户点击安装时才直连固定 GitHub revision；
- **我的技能：** 用户自行从 GitHub、ZIP、文件夹或自然语言安装的 Skill。

## 目录来源与收录边界

收集 ColaOS、NewMax 与 WorkBuddy 当前已展示或预装的 Skill 名称和来源，把它们作为候选线索。最终只收录同时满足以下条件的条目：

1. 能追溯到公开 GitHub 仓库；
2. 仓库中存在真实 `SKILL.md`，而不是只有项目介绍；
3. 能确认许可证并保留作者、仓库、许可证与固定 revision；
4. Skill 的方法、脚本或参考资料相较直接对话具有明确增量；
5. 所需依赖与适用平台能够如实说明，不把“可下载”夸大成“当前电脑一定可运行”。

无法追溯来源、许可证不明、仅存在于竞品私有安装包、纯 MCP/CLI 项目却没有 Skill 入口的条目不进入 Skill 市场。它们可以作为未来连接器或工具候选，但不会用假 Skill 卡片凑数。

多个竞品收录同一 Skill 时，以 `repository + upstreamPath` 为稳定身份去重。集合仓库不伪装成单个 Skill：构建目录时枚举其中真实的 Skill 子目录，并在界面中保留集合/来源分组。

## 社区目录与下载

社区目录继续随应用静态分发，不依赖 Leemo 账号或在线目录服务。每个条目至少记录：

- 稳定 ID、显示名称、极简用途和开放分类；
- 作者、仓库、上游路径、许可证和 source URL；
- 固定 commit revision；
- 安装所需文件清单、字节数和 SHA-256。

用户点击安装后，Leemo 直接从固定 GitHub revision 下载文件，并在写入本地 Skill 目录前校验路径、大小与哈希。网络失败时保留未安装状态并给出简短可理解的重试提示；不会生成半安装目录。

`human-writing` 作为重点推荐进入“写作与表达”，与 `stop-slop` 并存：前者负责中文材料门槛、事实边界、推进和改稿流程，后者更偏向清理模板化 AI 表达。

## Superpowers 离线内置

`obra/superpowers` 当前 14 个 Skill 全部随 Leemo 安装包提供：

- `brainstorming`
- `dispatching-parallel-agents`
- `executing-plans`
- `finishing-a-development-branch`
- `receiving-code-review`
- `requesting-code-review`
- `subagent-driven-development`
- `systematic-debugging`
- `test-driven-development`
- `using-git-worktrees`
- `using-superpowers`
- `verification-before-completion`
- `writing-plans`
- `writing-skills`

每个 Skill 连同其真实引用的脚本、提示模板与参考资料一起打包；仓库测试、发布日志、各家 Agent 的安装壳和无关文档不进入安装包。保留 MIT 许可证、上游作者和固定 revision。

Superpowers 作为独立本地插件物化，保持 `superpowers:` 内部身份，避免复制进 `leemo-library` 后跨 Skill 引用失效。它属于软件开发方法论，因此“离线内置”不等于“默认注入普通对话”：首装默认关闭，用户可整套启用或单独启用，选择在重启和升级后保留。

正常界面只显示“Superpowers 开发方法套件”和具体用途，不向普通用户暴露 Claude Code、Codex 或其他宿主的安装方式。

## 分类与界面

分类保持开放，不把用户限制在学习或求职场景。当前映射以用户任务为中心，例如：

- 思考与决策
- 写作与表达
- 学习与研究
- 资料与办公
- 设计与创作
- 内容与发布
- 知识管理
- 自动化与浏览器
- 开发与扩展
- 生活与成长

Skill 卡片保持克制：名称、来源标签、极简介绍、分类和安装/启用状态是主信息。作者、许可证、仓库和依赖说明放在详情中。集合通过来源分组和展开子项表达，不把十几张同源卡片无组织地铺满首页。

## 未来国内 Skill Hub

“国内网络环境无需 VPN 即可浏览和下载”的 Leemo Skill Hub 进入后续待办，但不是当前 MVP 阻塞项。未来可以复用本轮的稳定 ID、revision、哈希和来源元数据，在国内对象存储或 GitHub 同步镜像上提供缓存；客户端仍验证同一份哈希，不因下载域名变化降低可信度。

在真实用户验证前，不建设账号、评分、评论、推荐流、上传审核后台或大规模运营系统。

## 验收

1. 竞品候选经过自动枚举与人工规则过滤，重复项合并，非 Skill 项不出现在可安装列表。
2. 任意社区卡片安装后，真实 `SKILL.md` 及依赖文件进入用户 Skill 目录；失败不会留下半安装状态。
3. `human-writing` 能从固定 GitHub revision 安装、启用、调用、重启恢复和卸载。
4. Superpowers 14 个 Skill 均在离线安装包中；无需联网即可启用。
5. 实测一条 Superpowers 跨 Skill 链路，证明 `superpowers:` 引用不是只有卡片可见。
6. 用户未启用 Superpowers 时，普通聊天请求不携带其 Skill 上下文。
7. 构建门禁继续检查重复身份、非法路径、符号链接、超大文件、许可证元数据和 SHA-256。
8. 记录新增压缩体积、物理文件数、首次准备耗时与重启耗时；不得为了目录规模显著拖慢安装。
