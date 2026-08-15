# Community Skill source audit

审计日期：2026-08-07。计数直接来自
`community-skills/candidates.json` 与 `community-skills/sources.json`；候选账本是
多个可核验快照的并集，不代表三个竞品当前市场的全量。

## 结论

- 候选账本共 **216** 条唯一 `competitor + externalId`：ColaOS 42、NewMax
  70、WorkBuddy 104。
- 可安装社区目录共 **76** 张真实安装卡，来自 **12** 个固定 commit
  的公开仓库。竞品候选中有 **35** 个唯一 `included` catalogId；其余 **41**
  张是 Leemo 独立精选，未冒充竞品候选。两张 family 卡分别原子安装小红书 5 个与飞书 27 个真实 Skill。
- 明确重复为 **5** 条：NewMax 的 `docx`、`pdf`、`pptx`、`xlsx` 与
  ColaOS 指向相同 Anthropic 子路径，WorkBuddy `skill-creator` 与 NewMax
  指向相同子路径。首次记录保留许可证判定，重复记录不进入目录。
- `obra/superpowers` 不在社区目录；14 个 Superpowers 方法由独立离线套件
  分发，避免双重安装来源。

## 可核验库存边界

|范围|账本记录|证据边界|
|---|---:|---|
|ColaOS|42|仅为 ColaOS 1.2.9 历史候选快照；当前环境未能复现。历史 API 的 94 顶层计数也未保存可复核原始响应，因此 42 和 94 都不能称为当前全量。|
|NewMax|70|当前安装态 59 个递归 `SKILL.md` 路径，加 11 个仅见于历史快照的 stale 名称。59 是路径计数，不等于 59 张可独立安装卡。|
|WorkBuddy|104|当前静态索引 81 个 connector，加 23 个不与当前索引重复的历史 built-in/plugin 记录。205 个细粒度操作 `SKILL.md` 没有被卡化。|

WorkBuddy 当前 81 个 connector 的静态索引没有公开 GitHub canonical 仓库；
它们依赖 connector、MCP 或专有授权，因此本轮可公开镜像数为 0。

## 决议计数

|resolution|数量|含义与主要证据|
|---|---:|---|
|`included`|35|Google Workspace CLI 21（Apache-2.0）、Baoyu 13（MIT）及 `storage-analyzer` 1（MIT）；每项均有固定 revision 与真实子路径。|
|`duplicate`|5|上述五个相同 `repository + upstreamPath` 重复簇；不重复计算许可证或目录卡。|
|`license-unknown`|25|Anthropic、OpenClaw、self-improvement 以及 ima 三路径可追溯或可观察，但缺少可核验再分发许可证。|
|`origin-unresolved`|25|缺少可比对文件、canonical GitHub、固定 revision 或历史安装来源；同名项目不足以建立来源。|
|`private`|39|产品内建工作流、专有服务/授权；另含 AGPL 分发策略暂缓项和两个依赖逆向 Web API 的 Baoyu danger 项。|
|`not-a-skill`|82|WorkBuddy 当前 81 个 connector，以及小红书项目的共享运行时/路由集合根；这是包装与独立安装边界，不是价值判断。|
|`runtime-blocked`|5|记录小红书五个子 Skill 在“逐个安装”模型下会遗漏共享 Python/Chrome 运行时；当前已用一张原子 family 卡解决，但保留这五条历史判定，避免未来又拆回不完整单卡。|

`not-a-skill` 不等于“不好用”或“没有价值”。它只表示观察对象是 connector、
集合根、工具或项目边界，不能被当前社区市场模型安全地当作一张独立 Skill 卡。
同理，`private`、`license-unknown`、`origin-unresolved` 和
`runtime-blocked` 都是可分发证据或运行完整性的判断，不是功能质量评分。

## Approved source registry

|repository|revision|license|真实 Skill 数|
|---|---|---|---:|
|`autoclaw-cc/xiaohongshu-skills`|`b043748282a57e347c52f517dfb59819121134ab`|MIT|5（1 张套件卡）|
|`googleworkspace/cli`|`a3768d0e82ad83cca2da97724e46bea4ff0e6dbd`|Apache-2.0|21|
|`larksuite/cli`|`841953496b41a06bb670396f3d9f8fba943766ed`|MIT|27（1 张套件卡）|
|`hardikpandya/stop-slop`|`8da1f030185bdfe8471220585162991eaeb970e9`|MIT|1|
|`JimLiu/baoyu-skills`|`6b7a2e417500561a5ecdd0b168332f4142584617`|MIT|13|
|`kepano/obsidian-skills`|`a1dc48e68138490d522c04cbf5822214c6eb1202`|MIT|5|
|`KKKKhazix/human-writing`|`4fda173f3fef7fb808f3eba991eeb2528ea4b189`|MIT|1|
|`KKKKhazix/khazix-skills`|`17573491cf2ff70582d2ae0018ca39e571d35f53`|MIT|1|
|`mattpocock/skills`|`84fdeffd12f2ee307994d1eb6feb48173b6e0502`|MIT|29|
|`microsoft/playwright-cli`|`ca196c297169a494ee5517584883eada60dc8d0e`|Apache-2.0|1|
|`vercel-labs/agent-browser`|`acbc22bdc5d4f6c5a88d97d4a4745d3c5eb0591f`|Apache-2.0|1|
|`vercel-labs/skills`|`a4d243c3d4f86cdf9385dd1b6a0733f6937e70b5`|MIT|1|

刷新器只读取上述固定 revision 的仓库许可证与批准 Skill 子树。生成清单逐文件记录
相对路径、正字节数和 SHA-256；普通卡恰含一个 `SKILL.md`，family 卡为每个固定成员保留一个 `SKILL.md`，两类都只含一个 `LICENSE.upstream`。

## 重点纳入与暂缓证据

- `KKKKhazix/human-writing@4fda173f3fef7fb808f3eba991eeb2528ea4b189`
  以 `human-writing/` 为真实子树，MIT，作为“写作与表达”精选卡；它不是竞品候选。
- `KKKKhazix/khazix-skills@17573491cf2ff70582d2ae0018ca39e571d35f53`
  的 `storage-analyzer/` 与 NewMax 当前入口在换行归一化后相同，MIT，可独立安装。
- `autoclaw-cc/xiaohongshu-skills@b043748282a57e347c52f517dfb59819121134ab`
  的五个子 Skill 与 MIT 已核验；它们连同共享 Python/Chrome 运行时以一张 family 卡原子安装。候选账本继续保留原始 `runtime-blocked` 证据，用来说明为什么不能拆成五张独立安装卡。
- `larksuite/cli@841953496b41a06bb670396f3d9f8fba943766ed`
  的 27 个官方 Skill 与 MIT 已核验，以一张 family 卡进入按需目录；外部 `lark-cli`、应用配置和账号授权不随 Skill 包安装，目录与安装记录会保留 setup 提示。
- `anthropics/skills@b29e7cf65e5cb78a5ac33d582270551bc74a14eb`、
  `openclaw/openclaw@01cc71060d6c57eff142cfc210685c651ccb6397` 和
  `pskoett/pskoett-ai-skills@20e64cec1529d9c371fdcc20c751b7ef10b68af7`
  当前许可证证据不足，不进入目录。
- `op7418/guizang-ppt-skill@c91369c449d34755d320a8b81d0734000d99d1ab`
  为 AGPL-3.0；在 copyleft 市场分发策略明确前暂缓，不误写成许可证不明。
- `baoyu-danger-gemini-web` 与 `baoyu-danger-x-to-markdown` 虽来自已核验 MIT
  仓库，但依赖逆向 Gemini Web API 或 X 抓取，安全与合规评审前不分发。

## 可复现校验

```powershell
npm run refresh:community-skills -- --write
npm run refresh:community-skills -- --check
npx vitest run tests/host/community-skill-catalog.test.ts
```

第二次刷新必须零漂移。手写入口只保留类型、generated value re-export 与
`communityCatalogEntry()` helper；生成文件是运行时目录的唯一数据真源。
