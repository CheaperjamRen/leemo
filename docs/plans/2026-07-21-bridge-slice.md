# Leemo 第三批实施计划：CC SDK Bridge 竖切（里程碑 5：Bridge + IPC 契约冻结）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `E:\Leemo` 建成 Electron 无关的 CC SDK Bridge 核心：per-conversation `query()` 会话池（直连/网关双接线、按对话选模型、per-provider 状态隔离）+ SDK 事件规范化（LeemoEvent，usage/成本抽取+防幻觉路径抽查）+ 交互桥（canUseTool 审批代理三档 + ask_user 进程内 MCP）+ IPC 契约冻结（09 号文档+类型包，冻结后双壳前端可并行施工）。前置清偿网关欠账（流式 usage、ProviderOpts 通道、凑手 Minor×3）。最终 live E2E：两条对话并发（DeepSeek 直连 + relay2 经网关）跑通事件流/审批/usage 落数/resume。

**Architecture:** `src/bridge/`（自研，根 tsconfig 严格区）四模块——①`pool.ts` 会话池（ConversationHandle 生命周期：create/send/interrupt/dispose；env 构造器 direct|gateway；CLAUDE_CONFIG_DIR=`<dataDir>/providers/<id>/`）②`events.ts` 规范化（SDK AsyncGenerator 消息 → LeemoEvent 判别联合；usage/cost 抽取；claimed-path existsSync 抽查）③`interact.ts` 交互桥（ApprovalBroker：canUseTool→pending→decision 三档语义+危险命令降档；AskUserMcp：createSdkMcpServer 进程内 waiters Map+阻塞 Promise）④`contract.ts` 类型总出口（=IPC 契约的 TS 形态，09 号文档同源）。SQLite 持久化**不在本批**（Phase 1 与 Electron 骨架一起做），但 LeemoEvent/UsageRecord 字段面必须足以填 08 §四双日志表（契约先行）。测试：fake SDK 注入（依赖注入 query 函数，fixture=Phase 0 真实消息形状）+ fake UI transport；live 仅 B4。

**Tech Stack:** 既有栈不变（TS 5.9.3 + vitest + tsx）。SDK `@anthropic-ai/claude-agent-sdk@0.3.210`（已锁）。新增运行时依赖：预期零；若 ask_user 工具 schema 需要 zod 且 SDK 未 re-export，允许加 `zod`（报告列明版本）。禁引 Electron。

## Global Constraints（每张卡隐含遵守）

- 新代码只进 `E:\Leemo\`；`smoke/`（Phase 0 资产）只读禁改；vendor 除已有 5 处 LEEMO-PATCH 外禁改（B0 若需第 6 处必须先 BLOCKED 上报）。
- **严格 TDD**（宪法：Bridge/网关=严格 TDD）：先失败测试后实现，RED 证据留存；fake SDK/fake transport 的测试必须断言行为而非 mock 自证。
- 类型防火墙延续：自研代码禁 import `@gateway/vendor/**`；G2 契约 `anthropicToOpenAI` 返回 `{result, stripped}`。
- 密钥纪律：key 只经 `.env`；日志/快照/commit 零明文 key；Bridge 构造的 SDK 子进程 env 直连时含真 key（这是直连语义，宪法允许）、网关时只含占位 token——**测试必须断言网关模式 env 无真 key**。
- 命名：Leemo/momo；禁"幸运鹿/LuckyDeer/Lulu"。
- 执行者≠验收者；每卡可复现证据；PowerShell 验收命令；`npm run typecheck`=两条命令（vendor emit 先行）。
- 已核实事实（不必再查）：SDK 工具真名 Agent（init 列表双名 Task）；compact=resume+字符串'/compact'；CC 恒带 ?beta=true；canUseTool 在第三方端点可用（Phase 0 probes ok）；resume 在 DeepSeek 直连与经网关均实证可靠（Phase 0 + G4 compaction）→ **resume 优先，重放降级只留接口不实现**（YAGNI，backlog）；模型会臆造绝对路径写出 cwd 外（Phase 0 硬发现→08 §三纪律③的依据）；EFFORT_BUDGET_MAP low4000/medium12000/high24000/xhigh40000/max60000/default16000。
- SDK API 面（执行者开卡先读 `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` 核实签名再写测试，d.ts 为准，禁臆造）：query({prompt, options}) 返回 AsyncGenerator；options 关注 resume/abortController(或 signal)/canUseTool/mcpServers/systemPrompt/permissionMode/env/cwd/maxTurns。
- Live 成本纪律：只有 B4 打真端点；跑前设 VPN 代理三件套（见 CLAUDE.md git 条目）；单场景单跑，不重试刷次数。

---

### Task B0: 网关欠账清偿（流式 usage + ProviderOpts 通道 + 凑手 Minor×3 + 401 语义）

**Files:**
- Create: `E:\Leemo\smoke\relay-sse-probe.mjs`（诊断脚本：直打 RELAY2 端点 stream:true + stream_options.include_usage，dump 全部 SSE 帧结构到 smoke/results/（redact），回答终审判定的分支问题：**上游有无 usage 帧**）
- Modify: `E:\Leemo\src\gateway\core\translate.ts` + `provider-opts.ts`（usage 回填：新 opt `usageBackfill:'auto'|'off'`——'auto' 且流末未见上游 usage 时，用 tokens.ts 的 o200k 近似回填 message_start.input_tokens（对请求侧算）与末 message_delta.usage.output_tokens（对累计输出文本算）；上游有真 usage 则透传不回填防双计。**根因若在 vendor message_start 硬编码 0 且上游确有帧**：修透传，位置若超出既有 2 处 G2 PATCH 块需 BLOCKED 上报）
- Modify: `E:\Leemo\src\gateway\registry.ts`（fromEnv 增 per-provider opts 通道：`RELAY2_OPTS` 可选 JSON env 合入 ProviderOpts；registry 构造函数路径本就收 opts——补测试钉住，Bridge 后续程序化构造不走 env）
- Modify: `E:\Leemo\src\gateway\server.ts`（凑手①：drain await 与 res close 竞态一行 race+测试；凑手②：stripped 非空日志一断言；低优：上游 401/403 映射改 502 型 `api_error`（保留 message 说明 upstream auth failed），客户端 401 只留给占位 token 无效）
- Test: `tests\gateway\pitfall-10-usage.test.ts` 增用例（回填 auto/off/真 usage 透传三分支）+ `server.test.ts` 增用例（竞态/stripped 日志/502 映射）+ `pitfall-02` 增锁定测试（凑手③：divergent shape 直打 vendor transformer 路径，锁 backstop 谓词）

**Interfaces:** Produces：网关 usage 语义完整（CC 自动 compaction 的 token 计数前提）+ opts 全表可配置。B1+ 在此之上。

**禁改清单：** smoke/ 旧文件；vendor 除既有 PATCH 块内最小改动外。

- [ ] **Step 1:** 跑 relay-sse-probe.mjs（VPN 三件套）拿到分支答案，证据入报告
- [ ] **Step 2:** 按分支 TDD 实现回填/透传；三分支测试全绿
- [ ] **Step 3:** 凑手三项+401 语义 TDD；全量 test+typecheck 绿
- [ ] **Step 4:** Commit `fix(gateway): stream usage backfill/passthrough, provider-opts env channel, drain race, 502 mapping`

**验收命令：** `Set-Location E:\Leemo; npm test; npm run typecheck`（验收方核对：诊断证据存在且分支选择与证据一致；三分支测试非空转）

---

### Task B1: Bridge 会话池核心（per-conversation query() + 双接线 env + 隔离）

**Files:**
- Create: `E:\Leemo\src\bridge\pool.ts`（`createBridge(deps: {queryFn, dataDir, registryFactory?})` → `{ createConversation(cfg): ConversationHandle, dispose() }`；ConversationHandle=`{id, send(prompt): AsyncIterable<LeemoEvent>, interrupt(), dispose(), state}`；每对话持有 `{providerId, modelId, sessionId?}`；send 内部构造 env（direct: ANTHROPIC_BASE_URL/AUTH_TOKEN=真key/模型 4 槽位别名；gateway: BASE_URL=127.0.0.1:port/AUTH_TOKEN=leemo-gw:<id>）+ `CLAUDE_CONFIG_DIR=<dataDir>/providers/<providerId>/`（目录确保存在）；resume：首轮后存 sessionId，续轮带 resume；中途换模型=下一轮 env 生效）
- Create: `E:\Leemo\src\bridge\providers.ts`（Provider 目录类型（06 §3.1 形状：id/name/category/apiFormat/baseUrl/models/modelCapabilities/envTemplate）+ env 构造纯函数 `buildConversationEnv(provider, modelId, gatewayPort?)`——独立可测）
- Test: `tests\bridge\pool.test.ts` + `providers.test.ts`（fake queryFn 捕获收到的 options/env 断言：双接线 env 正确性、**网关模式 env 无真 key**、CONFIG_DIR 按 provider 隔离且并发两对话互不串、resume 传递、interrupt 触发 abort、dispose 清理、换模型下轮生效）+ fixtures（Phase 0 真实消息形状节选）

**Interfaces:** Consumes：G3 startGateway 类型（网关端口注入，B1 不起真网关）。Produces：createBridge/ConversationHandle/buildConversationEnv——B2 消费其消息流，B4 live 用真 queryFn。

**禁改清单：** smoke/；vendor/；src/gateway/**（网关 bug 报回 B0 另立修复）。

- [ ] **Step 1:** providers.ts env 构造纯函数 TDD（direct/gateway/别名槽位/模型能力表）
- [ ] **Step 2:** pool.ts 生命周期与隔离 TDD（fake queryFn）
- [ ] **Step 3:** 全绿 → Commit `feat(bridge): conversation pool with dual-wiring env construction and per-provider isolation`

**验收命令：** `Set-Location E:\Leemo; npm test; npm run typecheck`（验收方抽读：网关模式无真 key 断言、并发隔离断言非空转）

---

### Task B2: 事件规范化 + usage/成本抽取 + 余额拉取 + 防幻觉抽查

**Files:**
- Create: `E:\Leemo\src\bridge\events.ts`（`normalizeSdkStream(sdkMessages: AsyncIterable<SDKMessage>): AsyncIterable<LeemoEvent>`；LeemoEvent 判别联合 ≥：conversation.started(sessionId)/text.delta/text.final/tool.started(name,input 摘要)/tool.finished/subagent.activity/thinking.delta/compact.boundary/usage.final(UsageRecord)/run.finished(subtype)/error；**usage 提取基准=NewMax 模式（用户 7/21 拍板提供）**：流末 result/message_stop 一次性提取 usage 对象→统一四维 token 结构→查价目→`cost = tokens × price / 1_000_000` 六位小数精度、TEXT 输出；UsageRecord={in,out,cacheRead,cacheWrite,durationMs,costUsd?:string(TEXT),estimated:boolean(o200k 回填链路=true),providerId,modelId}——**字段面必须能填 08 §四 tool_call_logs+proxy_request_logs 双表**；`auditClaimedPaths(finalText, cwd)`：抽取路径样式 token→existsSync→`pathAudit` 附到 run.finished（08 §三纪律③））
- Create: `E:\Leemo\src\bridge\pricing.ts`（价目占位常量表：DeepSeek/GLM/Kimi 每百万 token 单价（执行者从官网查当前价，报告列出处与查询日期）+ 注入覆盖接口 `resolvePricing(providerId, modelId, overrides?)`；正式维护机制随 Provider 目录走=Phase 1）
- Create: `E:\Leemo\src\bridge\balance.ts`（**用户 7/21 新增拍板：余额从官方 API 拉取**：`fetchBalance(provider, deps:{fetchFn})` per-provider 适配器——DeepSeek `GET /user/balance`（公开文档端点）必做；GLM/Kimi 有公开余额端点则做、无则返回 `{supported:false}`（执行者查各官网文档，报告列结论与出处）；统一返回 `BalanceInfo={supported, totalUsd?|totalCny?, granted?, toppedUp?, raw?}`；fetchFn 注入可测，零 live 调用）
- Test: `tests\bridge\events.test.ts`（fixture=Phase 0 smoke/results 真实流形状改造（脱敏已保证）：断言事件序列逐类型映射、Agent 工具名归 subagent.activity、compact_boundary 透传、usage 抽取数值、cost 公式与精度、estimated 标记两分支、路径抽查真/假路径两例）+ `pricing.test.ts` + `balance.test.ts`（fake fetch：DeepSeek 响应形状解析/不支持 provider/网络错误路径）

**Interfaces:** Consumes：B1 消息流。Produces：LeemoEvent/UsageRecord/BalanceInfo/pricing——contract.ts 再导出，前端渲染（02 v2.0 E5 工具卡片/活动卡/审批条 + 用量 hover 弹窗）的数据源。**今日/7 天用量汇总的实现需 SQLite=Phase 1，但其 IPC channel 与类型（UsageSummaryQuery/UsageSummary）必须进 B3 契约预留**（用户拍板 hover 弹窗展示余额+用量统计，契约冻结前必须占位）。

**禁改清单：** smoke/；vendor/；src/gateway/**。

- [ ] **Step 1:** LeemoEvent 类型 + 逐事件映射 TDD（fixture 驱动）
- [ ] **Step 2:** pricing + usage/cost（NewMax 公式）+ estimated 标记 TDD
- [ ] **Step 3:** balance.ts per-provider 适配 TDD（fake fetch；先查官网文档定支持面）
- [ ] **Step 4:** pathAudit TDD；全绿 → Commit `feat(bridge): SDK event normalization, usage/cost/pricing, balance fetch, claimed-path audit`

**验收命令：** `Set-Location E:\Leemo; npm test; npm run typecheck`（验收方核对 UsageRecord 字段⊇双日志表需求；fixture 来源真实非玩具；价目与余额端点出处可溯源）

---

### Task B3: 交互桥（canUseTool 审批代理 + ask_user MCP）+ IPC 契约冻结

**Files:**
- Create: `E:\Leemo\src\bridge\interact.ts`（`ApprovalBroker(transport, persistence)`：canUseTool 回调→生成 ApprovalRequest{id,toolName,input 摘要,risk}→transport.request()→await decision；三档 allow-once/allow-conversation/allow-permanent 语义（conversation 级缓存表；**permanent 走外置 persistence 钩子接口 `{getWhitelist, addToWhitelist}`——本批测试用内存实现，Phase 1 接 SQLite**（用户 7/21 拍板：钩子外置））；**危险模式判定 `classifyRisk(toolName,input)`：Bash 危险模式种子清单（rm -rf/format/reg add/del 等）→ risk='dangerous' 时 permanent 档不可用**（06 §2.9）；`createAskUserMcp(transport)`：createSdkMcpServer 进程内 `ask_user(questions)` 工具，waiters Map+阻塞 Promise，transport 往返（08 §二 NewMax ~80 行模式））
- Create: `E:\Leemo\src\bridge\contract.ts`（类型总出口：LeemoEvent/UsageRecord/BalanceInfo/ApprovalRequest/ApprovalDecision/AskUserPayload/ConversationConfig/ProviderSpec + **UsageSummaryQuery/UsageSummary 预留类型**（今日/7 天汇总，hover 弹窗数据面；实现 Phase 1）——**即 IPC 契约的 TS 形态**）
- Create: `E:\Leemo\docs\specs\09-Bridge-IPC契约-v1.0.md`（人读版契约：channel 清单（invoke/event 两类）、每 channel 的 payload 类型引用 contract.ts、审批/问询往返时序图（文字版）、冻结声明与变更纪律——**双壳前端施工的依据**，里程碑 5 交付物）
- Test: `tests\bridge\interact.test.ts`（fake transport：审批三档语义、危险命令 permanent 不可用、并发多请求 waiters 不串、ask_user 阻塞→答案回填→Promise resolve、transport 超时/拒绝路径）

**Interfaces:** Consumes：B1（canUseTool/mcpServers 注入点）。Produces：交互桥 + 契约冻结件——批末用户过目定稿。

**禁改清单：** smoke/；vendor/；src/gateway/**。

- [ ] **Step 1:** ApprovalBroker TDD（三档+危险降档+并发）
- [ ] **Step 2:** AskUserMcp TDD（阻塞往返）
- [ ] **Step 3:** contract.ts 汇总 + 09 号文档成稿
- [ ] **Step 4:** 全绿 → Commit `feat(bridge): approval broker (3-tier, danger downgrade), ask_user MCP, IPC contract freeze draft`

**验收命令：** `Set-Location E:\Leemo; npm test; npm run typecheck`（验收方核对：危险清单测试真实、09 文档 channel 面与 contract.ts 一致）

---

### Task B4: Live E2E 验收（DeepSeek 直连 + relay2 经网关，并发双对话）

**Files:**
- Create: `E:\Leemo\smoke\bridge-live.mjs`（新文件不改旧 smoke：真 SDK queryFn + createBridge；场景：①DeepSeek 直连对话（工具轮：真写文件）②relay2 经网关对话（起 G3 网关）**两对话并发**；断言：事件流完整（text/tool/run.finished）、usage.final 数值非零（B0 效果实证）、审批桥 auto-approve transport 记录到请求、resume 续轮召回、CONFIG_DIR 隔离目录落盘、结果 JSON 落 smoke/results/（redact））
- Modify: `E:\Leemo\docs\sdd\progress.md`（台账续写由控制方做，执行者不动）

**Interfaces:** Consumes：B0-B3 全部。Produces：Bridge 竖切 PASS/FAIL 结论（两场景全过=达成；单场景 FAIL 按归因守则记录）。

**禁改清单：** smoke/ 旧文件；src/** 全部（发现 bug 报回对应卡）。

- [ ] **Step 1:** 写 bridge-live.mjs（redact/超时/逐场景模式抄 gateway-live）
- [ ] **Step 2:** VPN 三件套下跑双场景，FAIL 原样记录
- [ ] **Step 3:** Commit `feat(bridge): live E2E — concurrent dual-wiring conversations with usage/approval/resume` + push

**验收命令：** `Set-Location E:\Leemo; node smoke\bridge-live.mjs` 复跑对账（需 VPN 三件套）；`Select-String -Path smoke\results\*.json -Pattern 'sk-[a-zA-Z0-9]{8}'` 零命中。

---

## Self-Review 记录

1. **需求溯源**：06 §五会话池=B1；§六 resume 优先/降级只留接口=B1（YAGNI 有 Phase 0 证据支撑）；§3.2/3.4 双接线+按对话选模型=B1；§2.9 审批三档+危险永不永久=B3；§2.6 usage 落库字段=B2（持久化本体后移 Phase 1，契约先行）；08 §二 ask_user=B3；§三纪律③=B2 pathAudit；§四双日志字段面=B2 UsageRecord；里程碑 5 契约冻结=B3 交付 09 号文档。终审 Important×2=B0；凑手 Minor×3+低优 401=B0。
   **用户 7/21 计划评审拍板增量**：①usage 提取采 NewMax 模式（流末一次性提取→四维结构→查价目→tokens×price/1M 六位精度→TEXT 落库）=B2 events/pricing；②余额从官方 API 拉取（DeepSeek 必做，GLM/Kimi 查文档定支持面）+今日/7 天用量汇总（实现 Phase 1、契约类型本批预留）=B2 balance + B3 contract；③permanent 档钩子外置=B3；④o200k 回填可接受、标 estimated=B0/B2。
2. **范围裁剪（记 backlog 不做）**：重放降级实现、SQLite store、web-search MCP（里程碑 6 前后另卡）、momo systemPrompt 组装（里程碑 6）、Electron 壳（Phase 1）。
3. **接口链**：B0→网关语义完整；B1 产 Handle/env→B2 产 LeemoEvent→B3 产交互与契约→B4 消费全部。无循环依赖；SDK d.ts 核实点已进 Global Constraints 防臆造。
4. **风险内嵌**：fake SDK 注入使 B1-B3 零 live 成本；B4 单跑纪律；usage 回填双计防护（auto 仅在无上游 usage 时）；vendor 第 6 patch 需 BLOCKED 门。
