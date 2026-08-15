# Leemo 科研 Skill 与官方办公连接器审计

审计日期：2026-08-11。

本轮只审计下列两类资产：

1. 用户自有的 `E:\科研Skill资产包\Codex科研skill系统教程大全\04-Leemo科研Skill\leemo-research`；
2. 飞书、钉钉、WPS、腾讯 IMA 与 Google Workspace 的官方或一手能力。

没有把普通社区 Skill 扩进范围，也没有安装第三方 CLI、登录账号或调用办公数据。
官方仓库 revision 通过一手仓库固定 commit 核对；“Skill 已进入可选目录”与“外部 CLI/账号已经可用”分开判断。

## 一句话结论

- **科研 Skill：已作为 optional bundled Skill 集成。** 用户是权利人并明确授权随 Leemo 分发；核心方法和模板无需 Python，自动初始化与项目校验才需要本机 Python 3。技能中心会显示这一前置条件，缺失时不得声称脚本或校验已运行。
- **办公能力：首发新增按需目录，不随包预装外部 CLI。** 飞书官方 `lark-cli` 的 27 个真实 Skill 以一张套件卡进入 Skill Hub；现有 Google Workspace CLI 21 张卡补齐个人 Google Cloud OAuth 提示。需要企业主体或管理员批准的 WPS、钉钉继续后置；远程 MCP 在 Leemo 有真实 MCP 预设目录前不伪装成 Skill。
- **腾讯 IMA 需要反向补审。** 当前可证明官方下载来源，不能据此推导出公开再分发许可证；现有 Skill 还带 `.claude` 硬编码和未随包提供的 Python 依赖，不能称为 Release-verified。

## `leemo-research` 审计

### 结构与有效性

| 维度 | 观察 | 判断 |
|---|---|---|
| 结构 | `SKILL.md`、10 个 references、7 个状态/账本模板、3 个 Python 脚本、3 个测试文件、`agents/openai.yaml` | 完整，不是只有提示词的空壳 |
| 指令质量 | 明确区分用户提供、来源核验、推断、未知；包含正式提案硬闸门、来源等级、证据账本、断点恢复、实验与审阅矩阵 | 与 Leemo“真实执行、失败不伪装”的定位高度一致 |
| 便携性 | Markdown 与相对路径为主，Python 仅用标准库；集成副本要求先解析 Skill 自身目录，并提供手工复制七个模板的降级路径 | 核心方法可直接使用；自动化路径有明确的 Python 3 前置条件 |
| 验证 | 本机 `python -m unittest discover -s tests -v`：**41/41 通过**；交付 ZIP SHA-256 与 `SHA256SUMS.txt` 一致：`BA40B9453479023CE3E1FAFC4BB2593AB90FF88EB142F8DB1837347D83F980CE` | 源资产自身的结构验证可信；不等于 Leemo 安装包用户路径通过 |
| 权利边界 | 用户确认自己是 Leemo Research 权利人，并授权该包随 Leemo 集成与分发；集成副本明确这不是面向第三方的开源许可，外部 adapter 仍各自受许可证约束 | **不再阻塞 Leemo 集成；不得外推为通用开源授权** |

### 三级结论

| 档位 | 结论 |
|---|---|
| 可直接集成 | **核心指令、references、七个模板和标准库 Python helpers 已净复制到 `bundled-skills/optional/leemo-research`，排除 `__pycache__`/`.pyc`，默认不启用。** 用户授权已解决分发边界。 |
| 集成前最小修 | **本轮已完成。** Skill 与 catalog 同时声明 Python 3 前置、Skill 根路径解析和手工模板降级；没有 Python 时自动初始化/校验必须标成 `NOT_RUN`。 |
| 内测后优化 | 在真实科研项目中验证自动初始化、最终 validator、重启续做与触发准确性；再收紧 `--force` 覆盖策略、最终交付 gate 和上下文体积。现阶段不因这些增强项撤回可用的核心方法。 |

### 为什么 41 项测试不等于研究成果已通过交付校验

- 新初始化的零来源、零证据项目被测试明确视为 `OK`，所以当前 validator 是**结构检查器**，不是“研究已可交付”证明。
- 正式产物识别只读取 `project.deliverable` 与 `artifacts` 元数据字符串，不检查声明文件是否真实存在。
- `literature_synthesis` 与 `execution_truth` 的状态/日志没有进入当前阻塞判断；review matrix 也只在 review/package 被标为 completed 时强制收口。
- `init_project.py --force` 会覆盖七个受管文件；`install_skill.py --force` 会递归删除整个现有目标。测试证明行为符合当前设计，但不证明该设计适合用户已有研究账本。
- `agents/openai.yaml` 不参与 Leemo 的内置 Skill 发现；当前 Leemo 包也没有单独的 Python runtime。集成副本已排除 `__pycache__`/`.pyc`，并把 Python helpers 标成条件能力，而非把它们伪装成随包 runtime。

## 官方办公能力候选

“首发”只表示在当前 Leemo 安装包里对普通用户真正可用，不把“仓库存在”“Skill 可下载”写成已集成。

| 能力 | 官方/一手来源与许可证 | 认证与真实能力 | Leemo 成本 | 首发判断 |
|---|---|---|---|---|
| 飞书/Lark `lark-cli` | [`larksuite/cli@8419534`](https://github.com/larksuite/cli/tree/841953496b41a06bb670396f3d9f8fba943766ed)，MIT；larksuite 官方仓库 | Node/npm 安装；应用配置与个人 OAuth；固定 revision 下有 27 个真实 Skills，覆盖消息、文档、云盘、表格、幻灯片、日历、任务、邮件、会议等 | Skill 按需下载；外部 CLI、应用配置和账号权限仍由用户完成，部分组织能力取决于所在组织授权 | **首发可选目录。** 以一张 27 成员 family 卡安装，不随 Leemo 预装 `lark-cli`，列表与安装记录均保留 setup 提示 |
| 飞书 OpenAPI MCP | [`larksuite/lark-openapi-mcp`](https://github.com/larksuite/lark-openapi-mcp)，MIT，官方且标记 Beta | 需自建飞书应用、App ID/Secret、权限与 OAuth；当前官方 README 明示不支持文件上传/下载和直接编辑云文档 | 中高；能力反而窄于新 CLI，且凭证不能进 renderer/日志 | **不首发，排在 `lark-cli` 之后** |
| 飞书开发者 `opdev` | [飞书官方命令行文档](https://open.feishu.cn/document/tools-and-resources/development-tools/ide-with-commands?lang=zh-CN)；本轮未找到可核验开源再分发许可证 | Node/npm；用于应用项目创建、登录、预览、上传、反馈 | 与普通办公自动化目标不匹配 | **不纳入** |
| 钉钉 Workspace CLI `dws` | [`DingTalk-Real-AI/dingtalk-workspace-cli@24437fc`](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/tree/24437fc1a537bc31639ec555a517579ad4c751b8)，Apache-2.0；仓库说明为钉钉官方开源 | 预编译 Windows 二进制或 npm；OAuth 设备/浏览器登录；企业管理员必须开启 CLI 访问；mono/multi Skills，文档、云盘、表格、日历、待办、聊天、审批等；JSON/schema/`--dry-run` | 中高：企业授权门槛；mono 附带 13 个 Python 脚本，而 Leemo 没有 Python runtime | **不进普通用户首发；企业内测候选 P2。** 后续优先复用核心 Go CLI，不能假定 Python 辅助脚本可用 |
| WPS 365 MCP | [WPS 官方简介](https://open.wps.cn/documents/app-integration-dev/mcp-server/introduction) 与 [对接指南](https://open.wps.cn/documents/app-integration-dev/mcp-server/use-guide)；远程服务，无开源 Skill/CLI 再分发许可证 | 企业申请试用；创建企业自建应用、获取 AK/SK、申请权限、用户 access token；可接云文档、日历、消息等已发布 MCP endpoint | 高：企业/审批/令牌接入，不是桌面 WPS 文件保真编辑 runtime | **收入或企业用户提出明确需求后再做** |
| Google Workspace CLI `gws` | [`googleworkspace/cli@a3768d0`](https://github.com/googleworkspace/cli/tree/a3768d0e82ad83cca2da97724e46bea4ff0e6dbd)，Apache-2.0；仓库位于 Google Workspace 组织，但 README 明示“not an officially supported Google product” | 需个人 Google Cloud project、OAuth desktop client；自动配置还依赖 `gcloud`，也可手工配置；Drive/Gmail/Calendar/Sheets/Docs 等 | 现有 21 个固定来源 Skill 保持按需下载；用户仍需外部 `gws` 与个人 OAuth | **首发可选目录。** 不扩容，每张卡明确显示 CLI/OAuth 前置，不把“Skill 已安装”误报成 Google 已登录 |
| Google Workspace 官方远程 MCP | [Google 官方配置文档](https://developers.google.com/workspace/guides/configure-mcp-servers)；Developer Preview 远程服务 | 个人账号可借自己的 Cloud project 配置 Gmail、Drive、Docs、Sheets、Slides、Calendar、Chat、People；需 gcloud、启用 API/MCP services 与 OAuth client | Leemo 当前没有可安全承载固定 MCP preset 的目录，且官方特别提示间接提示注入风险 | **能力符合个人授权边界，但本轮不伪装成 Skill。** 等真实 MCP 预设目录后再列为首发可选 connector |
| 腾讯 IMA Skill（现有） | 官方 ZIP：`https://app-dl.ima.qq.com/skills/ima-skills-1.1.2.zip`；包内未发现 LICENSE | 需 IMA Client ID/API Key；现有文件使用 `curl`、Python，并硬编码 `.claude/skills/...` 的 Node 脚本路径 | 当前 `bundled-skills/catalog.json` 把“腾讯官方分发”写入 license 字段，但它不是可核验的公开许可证 | **内测前补许可证与 Leemo 路径/运行时审计；未解决前不得声称可公开再分发或 Release-verified** |

## 优先级与落地边界

### 必须现在做

1. `leemo-research` 以 optional bundled Skill 随包提供；Python 3 只作为自动初始化/校验的显式前置条件。
2. 飞书官方 27 个 Skill 以一张 family 卡进入 Skill Hub、按需下载；Google 21 张卡保留并显示个人 OAuth 前置。
3. 现有 IMA 的许可证/路径/runtime 真实性仍保留为内测前待办，不被本轮用户自有授权顺带放行。

### 有真实用户后做

1. 用真实个人飞书账号验证 `lark-cli` 登录状态、最小 scope、读操作、一次可回滚写操作、失败态与重启恢复；当前只完成目录/安装链，不冒充账号实测。
2. 有企业内测用户再验证钉钉；管理员授权是入场条件，不做成普通用户必经步骤。
3. WPS 365 MCP 等企业主体能力继续后置；Google 官方远程 MCP 等 Leemo 有真实 preset 目录再接。

### 明确不现在做

- 不自建飞书/WPS/Google 全套 OpenAPI connector；
- 不把远程 MCP、第三方 CLI 或一组 Markdown Skills 的存在当成“已集成”；
- 不运行官方文档中的 `irm ... | iex` / `curl ... | sh` 一行安装器；未来若集成，必须固定版本、校验摘要、可卸载并服从 Leemo 统一权限。

## 本轮验证边界

- 已验证：科研 Skill 文件结构、41 项 Python 单元测试与交付 ZIP SHA-256；Leemo optional bundled discovery/setup 投影；飞书固定 commit 的 27 个 `SKILL.md`、MIT、逐文件摘要、family 目录生成；Google 21 张卡的 setup 投影；相关 host tests 与目录刷新。
- 未验证：任何飞书、钉钉、WPS、IMA 或 Google 真实账号调用；外部 `lark-cli`/`gws` 的安装登录；科研 Skill 自动脚本在最终安装包中的执行和重启恢复。
