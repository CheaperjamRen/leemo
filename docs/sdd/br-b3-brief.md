# Task B3 简报：交互桥（审批三档 + ask_user MCP）+ IPC 契约冻结

> 来源计划：docs/plans/2026-07-21-bridge-slice.md Task B3。BASE=3889c5b。
> 执行模型：Opus 4.8（高风险卡——契约一旦冻结，改动代价成倍）。本卡零 live（fake transport 注入）。
> **本卡是里程碑 5 的核心交付：09 号 IPC 契约文档冻结后，双壳前端可并行施工。**

## Global Constraints（本批每张卡隐含遵守）

- 新代码只进 `E:\Leemo\`；`smoke/`、`vendor/`、`src/gateway/**`、`src/bridge/{pool,providers,events,pricing,balance}.ts`（B0-B2 已过审）、既有测试禁改。
- **严格 TDD**：先失败测试后实现，RED 证据留存；fake transport 的测试断言真实往返行为而非 mock 自证。
- 类型防火墙：禁 import `@gateway/vendor/**`。
- 密钥纪律：key 只经 `.env`；日志/快照/commit 零明文 key；测试用假值。
- 命名：Leemo/momo；禁"幸运鹿/LuckyDeer/Lulu"。
- `npm run typecheck`=两条命令；自研代码根 tsconfig（ES2022+严格 catch）。
- 禁引 Electron（契约是 Electron 无关的纯类型 + 进程内逻辑；IPC 的 Electron 绑定是 Phase 1）。
- SDK API 面：开卡先读 `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` 核实 `canUseTool` 回调签名与 `createSdkMcpServer`/`tool` 的真实 API（d.ts 为准，禁臆造）。已核实事实：canUseTool 在第三方端点可用（Phase 0 probes ok）；ask_user 走进程内 SDK MCP（createSdkMcpServer，NewMax ~80 行 waiters Map 模式）。

## 背景：你在建什么

Bridge 层三件事本卡收尾：①**审批桥** ApprovalBroker——SDK 的 canUseTool 回调 → 生成审批请求 → 经 transport 问宿主 → 等决策（三档语义 + 危险命令降档）。②**ask_user MCP**——进程内 SDK MCP 工具，momo 需要澄清时弹结构化选项卡（08 §二，行为准则 §7.1③ 的执行机制）。③**contract.ts**——把 B1/B2/B3 的所有对外类型汇总成 IPC 契约的 TS 形态。④**09 号文档**——人读版契约冻结件。

**用户 7/21 明确的 Provider 未来面（关键设计输入，务必读）**：未来 20+ provider——国内外官方 API、**订阅 OAuth 调用**（Claude Max/Kimi/智谱 coding plan，是配额不是余额、是登录不是 key）、中转站（OpenRouter 等 openai+relay）、各家 coding/agent plan（火山方舟/阿里百炼/百度千帆）、**自定义 provider 是一等公民**。本卡**不建**这些 adapter（YAGNI，首发配一两家），但**契约冻结件绝不能把 provider 形状焊死**。见下"契约扩展轴（硬要求）"。

## 要建的东西

### 1. `src/bridge/interact.ts`

**`ApprovalBroker(transport: ApprovalTransport, persistence: ApprovalPersistence)`**：
- 暴露一个符合 SDK `canUseTool` 签名的回调（先读 d.ts 核实：大致 `(toolName, input, {signal?}) => Promise<{behavior:'allow', updatedInput?}|{behavior:'deny', message?}>`——以 d.ts 实际为准，你的 ApprovalDecision→SDK 返回值的适配在此）。
- 每次回调：`classifyRisk(toolName, input)` 判风险 → 若已有 conversation 级/permanent 白名单命中则直接放行（不问）→ 否则生成 `ApprovalRequest{id, toolName, inputSummary, risk}` 经 `transport.request(req)` 问宿主 → await `ApprovalDecision`。
- **三档语义**：`allow-once`（本次放行，不缓存）/`allow-conversation`（存 conversation 级缓存表，同 conversation 后续同工具同风险自动放行）/`allow-permanent`（经 persistence 钩子写宿主白名单，跨 conversation）。
- **危险降档（06 §2.9）**：`classifyRisk(toolName, input)` 内置 Bash 危险模式种子清单（`rm -rf`、`format`、`reg add`/`reg delete`、磁盘格式化、`del /f` 等——清单可测、留注释说明"种子清单，非穷举"）→ risk==='dangerous' 时 **permanent 档不可用**（broker 拒绝把 dangerous 工具写永久白名单，即便宿主返回 allow-permanent 也降级为 allow-once 并在返回里标注）。
- **persistence 钩子外置（用户 7/21 拍板）**：`ApprovalPersistence = { getWhitelist(): Promise<WhitelistEntry[]> | WhitelistEntry[]; addToWhitelist(entry: WhitelistEntry): Promise<void> | void }`——本卡测试用内存实现，Phase 1 接 SQLite。broker 不自持久化。
- 并发：多个 canUseTool 同时挂起时 waiters 不串（每个 request 独立 id/Promise）。

**`createAskUserMcp(transport: AskUserTransport)`**：
- `createSdkMcpServer` 进程内 MCP，暴露 `ask_user(questions)` 工具（questions 结构：`[{question, header, options:[{label, description}], multiSelect}]`——参照 AskUserQuestion 形状但精简；schema 若需 zod 且 SDK 未 re-export，允许加 zod 依赖，报告列版本）。
- 工具被调用 → waiters Map 存一个阻塞 Promise + id → 经 `transport.ask(payload)` 送宿主 → 宿主答复经 broker 回填 → Promise resolve → 工具返回答案给模型（NewMax ~80 行模式）。
- 阻塞往返、超时/拒绝路径（transport reject → 工具返回可解释的错误结果，不挂死）、并发多问不串。

### 2. `src/bridge/contract.ts`（类型总出口 = IPC 契约的 TS 形态）

汇总 re-export（**不重新定义已有类型，从各模块 re-export**）：
- 从 events.ts：`LeemoEvent`、`UsageRecord`、`PathAudit`
- 从 balance.ts：`BalanceInfo`
- 从 pricing.ts：`ModelPricing`
- 从 pool.ts：`ConversationConfig`、`ConversationState`（`ConversationHandle` 是进程内对象不过 IPC，不 re-export，或只 re-export 其可序列化投影）
- 本卡新增：`ApprovalRequest`、`ApprovalDecision`、`AskUserPayload`、`AskUserAnswer`、`WhitelistEntry`、`RiskLevel`
- **预留类型（实现 Phase 1，契约先占位）**：`UsageSummaryQuery{ range:'today'|'last7d'; providerId? }`、`UsageSummary{ totalCostUsd?:string; byProvider:[...]; byDay?:[...] }`（用户 7/21：hover 弹窗要展示余额+今日/7天用量统计；实现要 SQLite=Phase 1，但契约类型现在就得占位，否则冻结后再加要动契约）。

**契约扩展轴（硬要求——用户 7/21 provider 面的落地，勿焊死）**：
契约里凡涉及 provider 的可序列化投影类型（给前端/IPC 用的 `ProviderSpec` 或等价物）**必须带这些扩展轴**，即便首发只实现一种：
- `authMode: 'api-key' | 'oauth-subscription'`——首发只实现 'api-key'，但槽先留（OAuth 订阅是配额不是余额、是登录不是 key，未来 Claude Max/coding plan 走这条）。
- `kind: string`——provider 家族标识，**开放字符串**（可配已知值集常量如 `'deepseek'|'glm'|'kimi'|'openrouter'|'relay'|'custom'` 供参考，但类型是 `string` 不是闭合 union——新家族/自定义 provider 不需改契约）。
- `apiFormat: 'anthropic' | 'openai'`（已有，保留）。
- `capabilities`/`features` 子对象：如 `{ balanceApi:boolean; modelDiscovery:boolean; subscriptionPlan:boolean }`——balance/pricing/quota 是 provider 按能力声明的，**不是按具体 id 硬编码**。
- **反模式警示**（写进契约注释）：B2 的 `balance.ts` 现在用 `provider.id==='deepseek'|'kimi'` 硬编码 FETCHERS——那是明确自注的 Phase 1 占位，**不得把 id→capability 的假设编进本契约**；真 Provider 目录落地时改按 kind/family 派发。契约按 providerId 取实例 OK，别把"id 决定能力"焊进类型。

### 3. `docs/specs/09-Bridge-IPC契约-v1.0.md`（人读版契约冻结件——里程碑 5 交付物，批末给用户过目定稿）

结构：
- **channel 清单**：两类——invoke（请求/响应，如 `bridge:createConversation`/`bridge:send`/`bridge:fetchBalance`/`bridge:usageSummary`(Phase1)）+ event（主进程推渲染进程，如 `bridge:event`(LeemoEvent 流)/`bridge:approvalRequest`/`bridge:askUser`）。每 channel 标注 payload 类型（引用 contract.ts 的类型名）。
- **审批往返时序**（文字版）：canUseTool → approvalRequest event → 宿主决策 → approvalDecision invoke → broker resolve。三档语义 + 危险降档在此说明。
- **ask_user 往返时序**（文字版）：模型调 ask_user → askUser event → 宿主答复 → askUserAnswer invoke → 工具 resolve。
- **冻结声明 + 变更纪律**：v1.0 冻结哪些、加 provider/加能力的规则。**明写原则**："加 provider = 加目录数据，不改契约；自定义 provider 是一等公民；balance/pricing/quota 是 provider 按 kind 声明的 capability，内部派发按 kind/family 不按实例 id；authMode/kind/capabilities 是预留扩展轴，首发只实现 api-key + 少数 kind。"
- **预留区**：UsageSummary/订阅配额等 Phase 1 项明确标注"契约已占位、实现后续"。

## 测试要求

`tests/bridge/interact.test.ts`（fake transport + fake persistence）：
- 审批三档语义各一例：allow-once 不缓存（同工具再问一次仍走 transport）/allow-conversation 缓存（第二次同工具同风险不走 transport）/allow-permanent 经 persistence.addToWhitelist 且 getWhitelist 命中后直接放行。
- **危险命令 permanent 不可用**：构造 `rm -rf` 类 Bash 输入，宿主返回 allow-permanent，断言 broker 未写永久白名单且实际按 allow-once 处理（下次仍问）。
- classifyRisk 单测：种子危险清单每条命中 dangerous，普通命令非 dangerous。
- 并发多审批 waiters 不串（两个 canUseTool 同时挂起，各自决策各自 resolve，不错配）。
- ask_user：阻塞往返（工具调用挂起→transport.ask 收到 payload→答复回填→Promise resolve 返回答案）、超时/拒绝路径（transport reject→工具返回错误结果不挂死）、并发多问不串。
- 断言值不空转（复审会抽读审批三档 + 危险降档 + ask_user 往返）。

## 契约类型完备性（复审会核对）
- contract.ts 的 re-export 覆盖 B1/B2/B3 全部对外类型，无遗漏、无重复定义。
- 09 文档的 channel payload 类型名与 contract.ts 一一对应（不许文档写了契约没有的类型，反之亦然）。
- 扩展轴（authMode/kind/capabilities）在契约类型里真实存在（不是只在文档里说说）。

## 风险说明
1. canUseTool 的确切签名以 sdk.d.ts 为准——若与本简报描述不同，按 d.ts 实现并在报告里记差异（不是你的锅，是简报据实证推断）。ApprovalDecision→SDK 返回值的适配层要清晰。
2. createSdkMcpServer/tool 的 API 同样以 d.ts 为准；若 ask_user 的 schema 定义方式与预期不同，按 d.ts 走。
3. 若发现 contract.ts 需要 re-export 的某类型在 B1/B2 里不是 export 的（漏了 export）→ 报告 concern，**不要就地改 B0-B2 文件**（已过审）；由控制方决定补 export 卡还是本卡豁免。

## 禁改清单
smoke/；vendor/；src/gateway/**；src/bridge/{pool,providers,events,pricing,balance}.ts（B0-B2 只读）；tests/gateway/**；tests/bridge/{pool,providers,events,pricing,balance}.test.ts；tsconfig*/vitest.config.ts；CLAUDE.md；docs/NewmaxAI逆向报告/；docs/specs/ 既有 02/06/08 文档（只**新增** 09，不改旧的）。

## Steps
1. 读 sdk.d.ts 核实 canUseTool + createSdkMcpServer 签名（报告记摘录）
2. ApprovalBroker TDD（三档 + 危险降档 + 并发，先 RED）
3. AskUserMcp TDD（阻塞往返 + 超时 + 并发）
4. contract.ts 汇总（re-export + 新增类型 + 扩展轴 + UsageSummary 预留）
5. 09 号文档成稿（channel 清单 + 两个时序 + 冻结声明 + 扩展原则）
6. 全绿 → Commit `feat(bridge): approval broker (3-tier, danger downgrade), ask_user MCP, IPC contract freeze draft`

## 验收命令
`Set-Location E:\Leemo; npm test; npm run typecheck`（验收方核对：危险清单测试真实、审批三档非空转、09 文档 channel 面与 contract.ts 一致、扩展轴真实存在于类型中）

## 报告
写到 `docs/sdd/br-b3-report.md`：sdk.d.ts 核实结论（canUseTool/createSdkMcpServer 实名签名摘录）、ApprovalBroker 设计（三档状态 + 危险降档判定）、AskUserMcp 往返机制、contract.ts re-export 清单（覆盖 B1/B2/B3 对外类型对照）、扩展轴落地说明（authMode/kind/capabilities 在哪个类型）、09 文档要点、RED/GREEN 证据、风险①②③处理、文件清单、自查、concerns。
