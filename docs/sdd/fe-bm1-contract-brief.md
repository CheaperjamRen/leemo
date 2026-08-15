# 第七批 Batch -1 简报：Bridge 契约 v1.1 路由与白名单加法

> 唯一产品规格：`docs/specs/10-前端完整形态设计-v1.0.md` §二裁决①②③、§1.4、§1.5、§四 Batch -1。
> 执行模型：**Claude Opus 4.8**（高风险契约冻结卡，不降档）。
> 前置基线：第六批 main 记录为 290 测试绿、三段 typecheck exit 0；执行前须复跑并记录真实值。
> 本卡是本前端完整形态里程碑**唯一允许修改 `src/bridge/` 冻结面**的卡；通过独立复审前不得开始 Batch 0。

## Global Constraints

- **严格 TDD**：新增断言先行，保留 RED（失败测试名/关键报错）与 GREEN（命令/通过数）复现证据。类型形状用 typecheck 形成真实 RED，不以注释或 mock 自证。
- **执行者≠验收者**：本卡执行完只提交 diff + 报告；由另一名 Opus 4.8 复审，主控复跑测试后才可 PASS。
- `@anthropic-ai/claude-agent-sdk` **严格锁 `0.3.210`**；不得升级依赖、改 lockfile 或把当前 API 记忆替代本仓库 `sdk.d.ts` 实证。
- 本卡只做 v1.1 契约加法/信封化及两处最小消费者适配；**不得提前做 Batch 0 多对话 store 重构、统一订阅装配或完整 fixture 扩展**。
- Bridge/renderer 仍经 `BridgeClient` typed port；禁引 Electron；禁 import `@gateway/vendor/**`。
- 密钥只经 `.env`；代码、fixture、报告、测试输出中不得出现真实 key。
- 命名只用 Leemo/momo；禁旧名。
- 当前主工作区非干净，含用户/上一会话未提交资产。**不得 `git reset/clean/checkout --`，不得删除、覆盖、add 或改动本卡文件清单外的任何现有修改/未跟踪文件。**
- 不 commit、不 push；留下可审阅 diff。

## 产品语境：这张卡解锁什么

- **10号文档 §二①A1 + §1.4**：多对话后台并行是核心能力。`bridge:event` 的 `conversationId` 是 IPC 路由信封字段，不属于 `LeemoEvent` 的 11 个语义 variant；因此只能在 `BridgeEventMap` 一处信封化，不能给每个 variant 散加字段。
- **runId 精度纪律**：runId 是渲染层自发号概念，Bridge/SDK 全链路不生产。前端收到 `conversationId` 后在 Batch 0 用 `runIds[conversationId]` 反查；**本卡禁止向任何 Bridge payload 添加 runId**。
- **10号文档 §二②A2 + S10④**：wiki 用独立影子对话；`CreateConversationRequest.purpose?: 'main'|'wiki'` 只钉契约，具体低 maxTurns/轻系统提示策略不在本卡。
- **10号文档 §二③A3 + S7 权限分区**：设置页必须能读取和撤销真实永久白名单，所以新增 list/revoke invoke；本卡只冻结通道、payload 和 persistence hook，不实现设置 UI 或 Electron IPC。
- **10号文档 §1.5**：审批/问询回投仍保持既有 waiters/策略语义；本卡只给其外发 payload 补 conversationId，不能改变审批策略、危险缓存、fail-closed、超时/取消/并发隔离。

## v1.1 最终形状（逐项实现，不再讨论）

### A. `src/bridge/contract.ts`

1. 新增并导出信封类型（命名可用 `BridgeEventEnvelope`，须单一来源）：
   ```ts
   { conversationId: string; event: LeemoEvent }
   ```
   `BridgeEventMap["bridge:event"]` **只接受该信封**，不保留裸 `LeemoEvent` 兼容 union。
2. `CreateConversationRequest` 增加：
   ```ts
   purpose?: "main" | "wiki";
   ```
   不加默认策略实现，不改现有 permissionMode。
3. `BRIDGE_CHANNELS` 增加精确键值：
   - `listWhitelist: "bridge:listWhitelist"`
   - `revokeWhitelist: "bridge:revokeWhitelist"`
4. `BridgeInvokeMap` 增加精确映射：
   - `"bridge:listWhitelist": { request: void; response: WhitelistEntry[] }`
   - `"bridge:revokeWhitelist": { request: { toolName: string; risk: RiskLevel }; response: void }`
5. 现有 channel、Provider/usage 类型及 v1.0 语义均不得削弱或重命名。

### B. `src/bridge/interact.ts`

1. `ApprovalRequest` 增加必填 `conversationId: string`。
2. `AskUserPayload` 增加必填 `conversationId: string`。
3. `createApprovalBroker` 工厂签名固定为：
   ```ts
   createApprovalBroker(
     conversationId: string,
     transport: ApprovalTransport,
     persistence: ApprovalPersistence,
     policy?: PermissionPolicy,
   ): ApprovalBroker
   ```
   conversationId 必填且位于第一参数；每个 broker 实例本就是单对话上下文，所有送往 `transport.request` 的 payload 都盖入该值。
4. `createAskUserMcp` 工厂签名固定为：
   ```ts
   createAskUserMcp(
     conversationId: string,
     transport: AskUserTransport,
     options?: AskUserMcpOptions,
   ): AskUserMcp
   ```
   conversationId 必填且位于第一参数；每次 `transport.ask` 的 payload 都盖入该值。
5. `ApprovalPersistence` 增加必填钩子：
   ```ts
   removeFromWhitelist(entry: WhitelistEntry): Promise<void> | void;
   ```
   本卡不新造 whitelist service；后续 Electron/主进程 binding 调此钩子。
6. 其余行为逐字保留：bypassPermissions 零卡、dangerousCommandCaching 条件化、默认危险不缓存、畸形 decision fail-closed、ask_user waiters 隔离、transport reject/timeout/failAsk 均不挂死。

### C. 最小消费者适配（只为保当前 main 绿）

1. `src/renderer/stores/conversations.ts`：订阅 `bridge:event` 后先按 `envelope.conversationId` 判归属；当前单对话 store 仅折入 `conversationId===activeId` 的信封，foreign envelope 直接 no-op，绝不能污染当前消息；命中后只把裸 `envelope.event` 交给现有 `applyEvent`。本卡不得把单对话 state 改成 maps，不得搬字段或新增 `wireBridgeSubscriptions`。
2. `src/renderer/bridge/fixture-client.ts`：`bridge:event` 统一发送 `{conversationId,event}`。send/interrupt 必须使用各自 invoke request 中的 conversationId 盖信封，不能永远硬编码一个猜测 id。现有 demo 事件内容与节奏不扩展（完整 Batch 0d fixture 扩展后做）。
3. 仅当新增必填字段/工厂签名导致现有测试 fake 编译失败时，最小更新同测试文件的 fixture/fake；不得趁机改断言含义或削弱覆盖。

## 文件清单

### 允许修改

- `src/bridge/contract.ts`
- `src/bridge/interact.ts`
- `tests/bridge/contract.test.ts`
- `tests/bridge/interact.test.ts`
- `src/renderer/stores/conversations.ts`
- `src/renderer/bridge/fixture-client.ts`
- 与上述两处 renderer 最小适配直接对应的**现有测试文件**（执行前列明准确路径；只改受信封化影响的断言/fake）
- `docs/specs/09-Bridge-IPC契约-v1.0.md`（路径不改名，正文追加 v1.0→v1.1 修订并同步受影响表格/时序）
- `docs/sdd/fe-bm1-contract-report.md`（新建执行报告）

### 禁改清单

- 不改 `normalizeSdkStream`，不把 conversationId 散加到任一 `LeemoEvent` variant；信封由 host/fixture 边界包裹。
- 不给 `ApprovalDecision` 或 `AskUserAnswer` 增加 conversationId；回复仍只按 request id 相关联。Outgoing 卡片需要归属，不等于本卡重做 inbound 路由。
- 永久白名单全局按 `(toolName,risk)` 键控；不得把 conversationId 加进 `WhitelistEntry`，撤销不得只按 toolName 粗删。
- `purpose` 在本卡只作为可选 metadata；不改 `ConversationConfig`、pool、maxTurns 或 system prompt。
- `smoke/**`（可跑不可改；本卡**也不运行 live smoke**。已知 `smoke/bridge-live.mjs` 仍按旧 factory 签名构造 broker，因 `.mjs` 不进 typecheck；本卡刻意不兼容它，后续若要恢复 live smoke 必须另立专卡，禁止在本卡偷改）
- `src/bridge/{pool,providers,events,pricing,balance}.ts`
- `src/gateway/**`、`vendor/**`、`tests/gateway/**`
- `src/renderer/stores/message-model.ts` 及除 `conversations.ts` 外所有 store
- 所有 React 组件、CSS/token、视觉资产
- renderer fixture 数据脚本/fixtures 内容（本卡只改 fixture-client 信封运输；Batch 0d 才扩数据面）
- `package.json`、lockfile、`tsconfig*`、`vitest.config.ts`
- `CLAUDE.md`、`docs/specs/10-前端完整形态设计-v1.0.md`、`docs/sdd/progress.md`
- 根目录 `task_plan.md` / `findings.md` / `progress.md`
- `.claude/`、`.kimi*/`、`openspec/`、`docs/NewmaxAI逆向报告/`、其它既有未跟踪/未提交用户资产

> 若实际受影响 call site 不在“允许修改”列表：先在报告列出 `file:symbol → 为什么非改不可` 并停止，不得自行扩大业务范围。

## TDD 测试矩阵

### `tests/bridge/contract.test.ts`

- `bridge:event` 正例必须构造 `{conversationId,event}`；裸 event 不再是合法 payload（用现有类型断言范式验证，勿加运行时兼容层）。
- `ApprovalRequest` / `AskUserPayload` fixture 均必须带 conversationId。
- `CreateConversationRequest` 的 `purpose:'main'` 与 `'wiki'` 类型合法；非法值由现有类型测试范式拒绝。
- `BRIDGE_CHANNELS` 含两个新 channel，名称逐字相等。
- `BridgeInvokeMap` 的 list/revoke request/response 形状可用；revoke 必须复用既有 `RiskLevel`，不得另造字符串类型。
- v1.0 的既有 provider/permission/usage/channel 完备性断言继续成立。

### `tests/bridge/interact.test.ts`

- 创建 broker 注入 `conversationId='conv-a'`，transport 真实收到同值；另建 `conv-b` broker 证明不串。
- ask_user transport 的每个并发 payload 都带该 MCP 实例注入的同一个 conversationId；乱序答复仍按 id 归位。
- 所有现有 persistence fake 补 `removeFromWhitelist`；增加最小可观测断言证明调用签名可撤销目标 `(toolName,risk)`，但不凭空搭 IPC service。
- 既有 bypass/default-danger/fail-closed/ask reject/timeout/cancel/concurrency 测试全部保留且通过。

### renderer 最小适配测试

- conversations store 收到 `{conversationId:'conv-1',event:{type:'text.delta',...}}` 后结果与信封化前一致，`applyEvent` 仍只见裸 LeemoEvent；收到 foreign conversationId 信封时当前单对话 messages/run 状态不变。
- FixtureBridgeClient 对 `bridge:send({conversationId:'conv-X',...})` 后发出的所有 `bridge:event` payload 均带 `conv-X`；interrupt 的 `run.finished` 信封也带请求中的 conversationId。
- 不新增多对话 registry/openTabs/runIds maps 测试——那是 Batch 0a。

## 09 文档 v1.1 修订要求

路径保持 `docs/specs/09-Bridge-IPC契约-v1.0.md`，不另开 v2 文件。至少同步：

1. 顶部版本注记追加：`v1.0→v1.1（2026-07-23）`，说明唯一形状级变化是 `bridge:event` 信封化，其余为字段/通道加法；无在线 Phase-1 消费方，允许 in-place 修订。
2. §一 channel 表新增 list/revoke，event 表把 payload 改为 `BridgeEventEnvelope` 并解释 envelope 内 `event:LeemoEvent`。
3. §二审批时序中的 `ApprovalRequest` 加 conversationId；persistence 钩子改为 get/add/remove，说明设置页可撤销。
4. §三 ask_user 时序中的 `AskUserPayload` 加 conversationId。
5. 对话创建形状补 `purpose?:'main'|'wiki'`，说明 wiki 影子对话策略留给后续装配。
6. 冻结声明/完备性表更新到 v1.1；明确 **Bridge 不生产 runId**。

## Steps

1. 复跑改前基线：`npm test`、`npm run typecheck`；记录测试数与三段 typecheck。
2. 写 contract/interact/renderer 新断言与类型 fixture，跑定向测试/typecheck，保存 RED。
3. 实现 `contract.ts` + `interact.ts` 最小 v1.1。
4. 实现 renderer 两处最小适配；跑定向 GREEN。
5. 同步 09 文档；自查关键词与通道/类型表一致。
6. 跑全量验收；检查 diff 只含允许文件；写报告。不 commit、不 push。

## 验收命令

```powershell
Set-Location E:\Leemo
npm test -- tests/bridge/contract.test.ts tests/bridge/interact.test.ts src/renderer/stores/conversations.test.ts src/renderer/bridge/fixture-client.test.ts
npm test
npm run typecheck
git diff --check
git diff --stat
```

验收方还会独立抽查：

- 全仓搜索 `bridge:event` 消费者是否都适配为信封；
- ApprovalRequest/AskUserPayload 是否不存在缺 conversationId 的生产 payload；
- 是否有人错误地给 Bridge 加 runId；
- SDK 版本/lockfile、smoke、其它 bridge 模块和用户脏工作区资产是否零改；
- 当前测试通过数不得低于改前真实基线（且必须 ≥215；预计在 290 基线上增加断言）。

## 复现证据 / 报告

写 `docs/sdd/fe-bm1-contract-report.md`，必须包含：

1. BASE（`git rev-parse --short HEAD`）+ 改前 `git status --short`（说明哪些是既有脏项，哪些是本卡新增）。
2. v1.1 字段/通道矩阵（旧→新）及其 10号文档 §二①②③来源。
3. 工厂签名前后与 conversationId 不串证明。
4. RED：命令、失败测试名/TS 报错、为何证明新断言非空转。
5. GREEN：定向测试、全量测试通过数、三段 typecheck、`git diff --check`。
6. `git diff --stat` + 本卡实际文件清单；逐个解释。
7. 禁改面自查：SDK `0.3.210`、smoke、其它 bridge、Batch 0 store、密钥、旧名均无变化。
8. concerns：没有写“无”；有则精确到 `file:line`，不得静默扩 scope。
