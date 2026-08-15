# Leemo 离线精选技能库设计

**状态：** 已批准，2026-08-02

## 目标

Leemo 不再用 40 份同构提示词制造“技能很多”的观感。内测版改为随安装包提供真实、可追溯的 Skill 目录，并为产品维护者保留两个发布前直接粘贴入口：

- `bundled-skills/default-enabled/<skill>/SKILL.md`：首装默认启用；
- `bundled-skills/optional/<skill>/SKILL.md`：随包离线提供，首装默认关闭。

这两个入口只属于开发者选品与构建流程，不是终端用户的运行目录。安装后它们合并为一个只读内置技能库；用户自己安装的 Skill 位于工作区的 `.leemo/skills`。用户安装 Leemo 后不需要 GitHub、VPN 或二次下载。技能中心自动发现、分类、展示和启停这些 Skill；用户自己的开关选择优先于后续版本调整。

## 质量边界

一个 Skill 只有在能让模型的行为相较直接对话产生明确增量时才进入安装包。可接受的增量至少包含一项：经过验证的方法论、可执行脚本、领域参考资料、严格完成判据或真实工具接线。

只有“适用场景 + 三步流程 + 输出格式”的通用模板不算能力。momo 的轻回执、产物不写入记忆、先确认再修改等产品礼仪属于全局规则，不靠复制到几十个 Skill 中维持。

现有 `src/host/builtin-skills.ts` 的 40 项全部由同一个 `bodyFor()` 模板生成，整体退出产品目录；不在本轮逐条润色，也不保留为占位卡。

## 本轮内容

新技能库共 26 项，和既有 Office 4 项合计 30 项。

默认启用 8 项：

- Anthropic：`frontend-design`、`skill-creator`、`web-artifacts-builder`、`doc-coauthoring`；
- JimLiu/baoyu-skills：`baoyu-format-markdown`、`baoyu-markdown-to-html`、`baoyu-compress-image`、`baoyu-url-to-markdown`。

按需启用 18 项：

- Anthropic：`canvas-design`、`theme-factory`、`brand-guidelines`、`algorithmic-art`、`mcp-builder`、`webapp-testing`、`slack-gif-creator`、`internal-comms`；
- 腾讯 IMA：`ima-skill`；
- baoyu 内容创作：`baoyu-image-gen`、`baoyu-slide-deck`、`baoyu-infographic`、`baoyu-cover-image`、`baoyu-article-illustrator`、`baoyu-comic`、`baoyu-xhs-images`、`baoyu-post-to-wechat`、`baoyu-post-to-x`。

DeepL 本质是 MCP 服务，进入连接器待办；飞书官方入口会展开约 20 个真实 Skill，待枚举和审计后逐项接入。两者不作为普通 Skill 卡片凑数。

`claude-api` 不进入产品。它是 Anthropic API 开发参考而非 Leemo 底层运行依赖，并会在供应商未指定时把任务主动导向 Claude；这与 Leemo 的多模型心智和服从用户任务边界冲突。底层 SDK 仍作为实现细节使用，不向技能中心或 momo 注入供应商教程。

## 发现与身份

构建和运行时只识别两个入口的直接子目录；每个子目录必须有合法 `SKILL.md` frontmatter。目录名是稳定身份，生成偏好键 `bundled:<directory>`；显示名和触发名来自 frontmatter。

根级 `bundled-skills/catalog.json` 只为 Leemo 精选内容补充来源、分类、许可证和链接。产品维护者后来粘贴的目录即使没有 catalog 条目也会出现，分类取 Skill frontmatter，缺省归入“其他”。分类是开放字符串，不限制学习、求职或创作等未来方向。

首装时，目录位置决定 `defaultEnabled`。升级时，已有 `skillOverrides` 始终优先；新出现的 Skill 才使用目录默认值。Skill 在两个入口之间移动不会覆盖用户已经做过的选择。

## 运行时与打包

两个源目录作为 `app.asar` 内容进入安装包，不以数百个 loose `extraResources` 文件拖慢安装。首次启动按内容哈希原子复制到 Leemo 的应用数据目录，形成一个真实的 `leemo-library` 本地插件；后续启动复用同一 revision。

SDK 只接收用户当前启用 Skill 的 qualified allow-list。技能关闭是产品层的发现/上下文开关，不宣传为安全沙箱；安全扫描仍是可选报告，不会替用户拒绝安装。

构建前校验：缺失/非法 frontmatter、重名、符号链接、`.git`、`node_modules`、`__pycache__`、`.pyc`、超大单文件或 catalog 悬空项都使构建失败。校验同时输出 Skill 数量、文件数、展开体积和树哈希。

## 技能中心

三分区保持“Leemo 精选 / 社区可信 / 我的技能”。随包技能进入“Leemo 精选”，卡片只展示名称、真实来源标签、极简用途、分类和启停开关；不显示 Claude Code 插件前缀、环境变量或物理路径。

来源标签优先显示 `Anthropic 官方`、`腾讯官方`、`社区精选`，而不是把所有内容伪装成 Leemo 自研。搜索和分类从实际发现结果生成，数量不写死。

## 验收

1. 源码态发现 26 个新 Skill，默认 8 个；加 Office 后内置总数 30、默认启用总数 12。
2. 任意合法 Skill 文件夹放入两个入口后，重新打包即可被发现；无需修改 TypeScript。
3. 首装、开关切换、重启和版本升级都保持预期状态。
4. 真实模型请求只携带启用项；关闭项不出现在技能中心的已启用计数和斜杠菜单。
5. 安装包中的新技能库是 ASAR 内资源，不增加同数量的安装目录 loose files；记录新增压缩体积、首次准备耗时和缓存文件数。
6. 至少实测一个默认 Skill、一个按需 Skill、一个 Office Skill 和一个手工粘贴 fixture 的完整用户路径。
