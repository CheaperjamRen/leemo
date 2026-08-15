# Task B3 报告：交互桥（审批三档 + ask_user MCP）+ IPC 契约冻结

> BASE=0b8128e。执行=Opus 4.8。零 live（fake transport 注入）。
> 交付：`src/bridge/interact.ts` + `src/bridge/contract.ts` + `docs/specs/09-Bridge-IPC契约-v1.0.md` + `tests/bridge/{interact,contract}.test.ts`。
> 结果：**202/202 绿（164→202，+38）**，typecheck 两段 exit 0，四个新文件零 null 字节。
> **§修复轮（复审后，见文末）：206/206 绿；三 Important + 两 Minor 全修。**

---

## 一、sdk.d.ts 核实结论（实名签名摘录，d.ts 为准）

先读 `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` 核实（**禁臆造**）。三处关键签名与简报推断有出入，均按 d.ts 实现：

### 1.1 `CanUseTool`（sdk.d.ts:206–254）
```ts
export declare type CanUseTool = (toolName: string, input: Record<string, unknown>, options: {
    signal: AbortSignal;              // ← 必选（简报猜的是 signal?，实际必选）
    suggestions?: PermissionUpdate[];
    blockedPath?: string;
    decisionReason?: string;
    title?: string;
    displayName?: string;
    description?: string;
    toolUseID: string;                // ← 必选
    agentID?: string;
    requestId: string;                // ← 必选
}) => Promise<PermissionResult | null>;   // ← 返回可为 null（out-of-band control_response 专用）
```
**与简报差异**：①`signal` 是**必选**非 `signal?`；②options 还带 `toolUseID`/`requestId`（必选）+ 一堆可选 UI hint（title/displayName/…）；③返回类型是 `Promise<PermissionResult | null>`——`null` 是"消费方已 out-of-band 发了 control_response"的信号，**本 broker 永不返回 null**（不是这个用例）。测试用 `decide()` helper 断言非 null 后再 narrow。

### 1.2 `PermissionResult`（sdk.d.ts:2066–2078）
```ts
export declare type PermissionResult = {
    behavior: 'allow';
    updatedInput?: Record<string, unknown>;
    updatedPermissions?: PermissionUpdate[];
    toolUseID?: string;
    decisionClassification?: PermissionDecisionClassification;
} | {
    behavior: 'deny';
    message: string;                  // ← deny 分支 message 必选
    interrupt?: boolean;
    toolUseID?: string;
    decisionClassification?: PermissionDecisionClassification;
};
```
**与简报差异**：allow 分支**没有** `message` 字段（简报里三档语义靠我方 `ApprovalDecision.decision` 承载，不放进 SDK 返回值）；deny 分支 `message` **必选**（broker deny 时 `decision.message ?? 'Denied: <tool>'` 兜底保证非空）。ApprovalDecision→PermissionResult 适配层：`allow-*`→`{behavior:'allow'}`，`deny`→`{behavior:'deny', message}`。

### 1.3 `createSdkMcpServer` + `tool`（sdk.d.ts:468, 6763）
```ts
export declare function createSdkMcpServer(_options: {
    name: string; version?: string;
    tools?: Array<SdkMcpToolDefinition<any>>;
    instructions?: string; alwaysLoad?: boolean;
}): McpSdkServerConfigWithInstance;    // = McpSdkServerConfig & { instance: McpServer }, {type:'sdk', name, instance}

export declare function tool<Schema extends AnyZodRawShape>(
    _name: string, _description: string, _inputSchema: Schema,   // ← inputSchema = zod raw shape (对象, 非 z.object())
    _handler: (args: InferShape<Schema>, extra: unknown) => Promise<CallToolResult>,
    _extras?: { annotations?; searchHint?; alwaysLoad? }
): SdkMcpToolDefinition<Schema>;
```
**与简报一致**（进程内 SDK MCP，NewMax waiters 模式适用）。落地细节：`tool()` 第三参是 **zod raw shape**（`{ questions: z.array(...) }`，非包好的 `z.object`）；`CallToolResult` 来自 `@modelcontextprotocol/sdk/types.js`（本项目已装 mcp sdk 1.29.0）。**运行时 probe 实证**：`tool()`+`createSdkMcpServer()` 可导入执行，返回 `{type:'sdk', name:'leemo-ask-user', instance:<McpServer>}`；`zod` 解析为 4.4.3（SDK 自身的 zod 大版本）。

---

## 二、zod 依赖

`tool()` 的 schema 需 zod，SDK 未 re-export `z`。**加了显式依赖 `zod@4.4.3`（`--save-exact`，已在 package.json/package-lock 固定）**——此前 zod 只是 SDK 的传递依赖（幻影依赖），显式化后 `npm ci` 不会漂移。zod 4（`z.core` 存在）是 SDK 锁定的大版本，与 mcp sdk 1.29.0 的 zod 4 schema 一致，无双版本冲突。

---

## 三、ApprovalBroker 设计（`src/bridge/interact.ts`）

### 3.1 三档状态机
`createApprovalBroker(transport, persistence)` 返回符合 `CanUseTool` 签名的 `canUseTool`。每次调用：
1. `risk = classifyRisk(toolName, input)`（safe/moderate/dangerous）。
2. 查永久白名单（`persistence.getWhitelist()`，按 `toolName+risk` 命中）→ 直接 `allow()`（不问）。
3. 查本对话缓存（`conversationAllow: Set<string>`，key=`${tool} :: ${risk}`）→ 直接 `allow()`（不问）。
4. 否则生成 `ApprovalRequest{id:randomUUID, toolName, inputSummary, risk}` → `transport.request(req)` 问宿主 → 按 `ApprovalDecision.decision` 落地：

| decision | 行为 | 缓存/持久化 |
|---|---|---|
| `deny` | `{behavior:'deny', message}` | 无 |
| `allow-permanent`（非危险） | `allow()` | `persistence.addToWhitelist({toolName, risk})` |
| `allow-permanent`（危险） | `allow()` | **拒写**（降 allow-once），不缓存 |
| `allow-conversation` | `allow()` | `conversationAllow.add(key)` |
| `allow-once` | `allow()` | 无 |

- **broker 实例 = 一个对话的审批上下文**：`conversationAllow` 随实例生命周期，不跨兄弟对话泄漏；永久白名单经 `persistence` 共享（跨对话）。
- **缓存 key = tool+risk**（非 tool+具体 input）：用户批的是"这个工具在这个风险档"，不是某一个精确参数。
- `allow()` 是工厂（每次返回新 `{behavior:'allow'}`），不共享单例对象。

### 3.2 危险降档判定（06 §2.9）
`classifyRisk`：Bash input 的 `command` 命中 `BASH_DANGER_PATTERNS` 种子清单→`dangerous`；只读工具（Read/Grep/Glob/…）→`safe`；变更类工具（Bash/Write/Edit/…）与未知工具→`moderate`（fail-cautious，未知必问）。
种子清单（**注释标注"非穷举"**）：`rm -[flags]` / `rmdir /s` / `del /[flag]` / `format C:` / `mkfs[.x]` / `dd …of=/dev/` / `diskpart` / `fdisk` / `reg add|delete` / `shutdown` / fork-bomb。**漏判只降级为 moderate 走正常问询，绝不静默放行**（安全侧）。
**危险永不永久**由 broker 内部强制：`risk==='dangerous'` 且宿主返回 `allow-permanent` 时，broker 拒写 persistence、降为 allow-once——不信任宿主 UI 是否隐藏了永久档。

### 3.3 persistence 钩子外置（用户 7/21 拍板）
`ApprovalPersistence = { getWhitelist(): Promise<WhitelistEntry[]>|WhitelistEntry[]; addToWhitelist(entry): Promise<void>|void }`（同步/异步均容纳，`await` 兼容两者）。broker 不自持久化；测试用内存数组，Phase 1 接 SQLite。

### 3.4 并发
每个 `canUseTool` 调用独立 `id` + 独立 `transport.request` Promise，唯一共享是两个缓存（只用已 resolve 的 decision 读写）→ 挂起调用互不串。测试用 `deferredApprovalTransport` 反序 resolve 两个挂起请求，断言各归其位。

---

## 四、AskUserMcp 往返机制（`createAskUserMcp`，08 §二）

- **waiters Map**（key=id）存 `{resolve, timer?}`。`handle({questions})`：生成 id → `waiters.set` 挂阻塞 Promise → `transport.ask(AskUserPayload{id, questions})` 推宿主 → 返回 pending Promise（工具 BLOCK）。
- **回填**：`provideAnswer(id, AskUserAnswer{id, items:[{selected, other?}]})` → `settle(id, textResult(renderAnswer))` → Promise resolve → 工具返回文本给模型。
- **三条失败路径永不挂死**（均返回 `isError:true` 的 `CallToolResult` 子集）：①`transport.ask` reject（宿主通道故障）→ 立即 settle error；②超时（`timeoutMs` 可选，默认不超时——permission 类无 park deadline，测试注入 15ms）→ error；③宿主取消 `failAsk(id, reason)`（卡片 dismiss）→ error。`settle()` 每条路径都 `clearTimeout`+`waiters.delete`，无泄漏。
- **并发**：多问各自独立 id，反序回填也各归其位。
- **SDK 集成**：`tool('ask_user', <desc>, {questions: z.array(questionSchema)}, handler)` + `createSdkMcpServer({name:'leemo-ask-user', version, tools:[askUserTool]})`；handler 体就是 `handle()`，阻塞往返与工具调用共用一条代码路径。`mcp.server` 暴露 `{type:'sdk', name, instance}`（供 options.mcpServers）。
- ask_user 输入形状：`{question, header?, options:[{label, description?}], multiSelect?}`（参照 AskUserQuestion 精简）。

---

## 五、contract.ts re-export 清单（覆盖 B1/B2/B3 对外类型对照）

**纯类型模块**（全部 `export type … from`，**不重定义**；运行时只两个 data 常量 `BRIDGE_CHANNELS`/`KNOWN_PROVIDER_KINDS`；零 SDK/Electron/gateway/vendor 运行时导入——`export type` 编译期擦除，引 contract 不会拖入 interact 的 SDK 运行时）。

| 来源 | re-export 类型 | 覆盖 |
|---|---|---|
| `events.ts`(B2) | `LeemoEvent`,`UsageRecord`,`PathAudit`,`PathClaim` | ✅ 全 |
| `pricing.ts`(B2) | `ModelPricing` | ✅ |
| `balance.ts`(B2) | `BalanceInfo` | ✅ |
| `pool.ts`(B1) | `ConversationConfig`,`ConversationState` | ✅（`ConversationHandle`=进程内对象不 re-export，投影=`ConversationRef`） |
| `providers.ts`(B1) | `ModelCapabilities` | `Provider` 含 `apiKey` 故**不 re-export**（密钥不过 IPC），投影=`ProviderSpec` |
| `interact.ts`(B3) | `RiskLevel`,`ApprovalTier`,`ApprovalRequest`,`ApprovalDecision`,`WhitelistEntry`,`AskUserOption`,`AskUserQuestion`,`AskUserInput`,`AskUserPayload`,`AskUserAnswerItem`,`AskUserAnswer` | ✅ 全 |

**contract.ts 新增（IPC 面）**：`ProviderSpec`/`ProviderAuthMode`/`ProviderKind`/`ProviderCapabilities`、`CreateConversationRequest`/`ConversationRef`/`SendRequest`/`SetModelRequest`/`FetchBalanceRequest`、`UsageSummaryQuery`/`UsageSummary`/`UsageSummaryByProvider`/`UsageSummaryByDay`、`BridgeInvokeMap`/`BridgeEventMap`/`BridgeChannel`、常量 `BRIDGE_CHANNELS`/`KNOWN_PROVIDER_KINDS`。

---

## 六、扩展轴落地说明（authMode/kind/capabilities 在哪个类型）

全部落在 **`ProviderSpec`**（+ 子对象 `ProviderCapabilities`），是**真实 TS 字段**非文档说说（`tests/bridge/contract.test.ts` 构造 OAuth-custom-quota 实例，删任一轴 → typecheck 红）：

| 轴 | 位置 | 类型 | 首发 |
|---|---|---|---|
| `authMode` | `ProviderSpec.authMode` | `'api-key' \| 'oauth-subscription'` | 只实现 `api-key`；`oauth-subscription` 槽预留（配额非余额、登录非 key） |
| `kind` | `ProviderSpec.kind` | `string`（**开放**，`ProviderKind`） | `KNOWN_PROVIDER_KINDS` 是参考值集非闭合 union；custom 一等公民 |
| `apiFormat` | `ProviderSpec.apiFormat` | `'anthropic' \| 'openai'` | 保留自 B1/B2 |
| `capabilities` | `ProviderSpec.capabilities` | `{balanceApi, modelDiscovery, subscriptionPlan}` | balance/pricing/quota 按能力声明、按 kind/family 派发 |

**反模式警示已写进 contract.ts 顶部注释 + 09 文档 §四**：B2 `balance.ts` 的 `id==='deepseek'|'kimi'` 硬编码 FETCHERS 是 Phase 1 占位，**不得把 id→capability 假设编进契约**；契约按 `providerId` 取实例 OK，但"id 决定能力"不焊进类型。

---

## 七、09 文档要点

`docs/specs/09-Bridge-IPC契约-v1.0.md`：〇边界（Electron 无关纯类型、密钥不过 IPC、进程内对象不过 IPC）；一 channel 清单（5 类 invoke + 3 event，每 channel 标 payload 类型 = contract.ts 类型名，`BridgeInvokeMap`/`BridgeEventMap` 机器可核）；二审批往返时序（三档表 + 危险降档）；三 ask_user 往返时序（waiters + 三失败路径）；四 Provider 扩展轴表 + 反模式；五预留区（UsageSummary/订阅配额 Phase 1）；六冻结声明 + 5 条变更纪律（**加 provider=加数据不改契约 / 自定义一等公民 / balance 按 kind 派发 / 轴预留 / 破坏性变更走 v2.0**）+ 完备性自证表。

---

## 八、RED/GREEN 证据

- **RED**：`interact.test.ts` 先写，`npx vitest run tests/bridge/interact.test.ts` → `Cannot find module '../../src/bridge/interact'`（模块不存在，Test Files 1 failed / no tests）。
- **GREEN（interact）**：实现 `interact.ts` 后 → 30/30 绿。
- **GREEN（contract）**：`contract.ts` + `contract.test.ts` → 38/38 绿（含类型级断言：删扩展轴即 typecheck 红）。
- **全绿**：`npx vitest run` → **202/202（23 文件）**；`npm run typecheck` → 两段 exit 0。
- **卫生**：四个新文件 null 字节扫描 = 0（构造中曾在 cacheKey 分隔符混入一个 U+0000，已定位清除，改 ` :: `）。

---

## 九、风险①②③处理

- **①canUseTool 签名与简报不同**：已按 d.ts 实现并记差异（§1.1——`signal` 必选、options 多字段、返回 `|null`）。ApprovalDecision→PermissionResult 适配层清晰（§3.1 表）。非我方臆造，据实证。
- **②createSdkMcpServer/tool API**：与 d.ts 一致（§1.3），`tool()` 第三参是 zod raw shape 已正确落地；运行时 probe 实证可导入执行。
- **③需 re-export 的类型漏 export**：**未发生**——B1/B2 需 re-export 的类型（`LeemoEvent`/`UsageRecord`/`PathAudit`/`PathClaim`/`ModelPricing`/`BalanceInfo`/`ConversationConfig`/`ConversationState`/`ModelCapabilities`）全部已 export。**未改动任何 B0-B2 文件**（禁改清单遵守）。`PathClaim` 顺带 re-export（`PathAudit.claimed: PathClaim[]` 的成员类型，前端渲染 pathAudit 需要）。

---

## 十、文件清单

| 文件 | 状态 | 说明 |
|---|---|---|
| `src/bridge/interact.ts` | 新增 | ApprovalBroker + classifyRisk + createAskUserMcp |
| `src/bridge/contract.ts` | 新增 | IPC 契约 TS 形态（re-export + 新增 + 扩展轴 + UsageSummary 预留） |
| `tests/bridge/interact.test.ts` | 新增 | 30 例（三档/危险降档/并发/classifyRisk/ask_user 往返+超时+取消+并发） |
| `tests/bridge/contract.test.ts` | 新增 | 8 例（扩展轴真实存在/开放 kind/预留 UsageSummary/channel↔type 1:1/无 key 过 IPC） |
| `docs/specs/09-Bridge-IPC契约-v1.0.md` | 新增 | 人读版契约冻结件 |
| `package.json` / `package-lock.json` | 改 | 显式固定 `zod@4.4.3`（此前幻影传递依赖） |

---

## 十一、自查

- ✅ canUseTool 适配匹配真实 d.ts 签名（`signal` 必选/options 多字段/返回 `|null`，broker 不返 null）；ApprovalDecision→PermissionResult 映射干净。
- ✅ 三档各有尖锐断言：allow-once 第二次仍走 transport（`seen.length===2`）；allow-conversation 第二次**不走** transport（`seen.length===1`）；allow-permanent 实际命中 `persistence.addToWhitelist`（`list.length===1`）且新对话 broker（transport 会 deny）仍自动放行（`b.seen.length===0`）。
- ✅ 危险永不永久真强制：宿主返回 allow-permanent + `rm -rf` → 断言未写白名单（`list.length===0`）且按 allow-once（第二次仍问，`seen.length===2`）。
- ✅ ask_user 阻塞往返真实（Promise 仅在 `provideAnswer` 后 resolve，`settled` 标志验证）；超时/reject/取消不挂死（三例均 `isError:true`）。
- ✅ contract.ts 覆盖 B1/B2/B3 全部对外类型，无重定义、无遗漏；扩展轴在真实类型；UsageSummary 预留。
- ✅ 09 文档 channel payload ↔ contract.ts 类型名 1:1（`BridgeInvokeMap`/`BridgeEventMap` 键=channel 名，contract.test.ts 运行时核 XOR 归属 + 计数）。
- ✅ 严格 catch（`catch (e: unknown)`，interact.ts:427）；无 Electron/vendor/gateway 导入；无真 key 形字面量（测试用 fake，无 sk-/RELAY2/niubiapi）；zod 版本已记（4.4.3 显式固定）。

---

## 十二、Concerns

1. **`ConversationHandle` 不 re-export（设计选择，非漏）**：它是进程内对象（方法 + live AbortController），不过 IPC。契约暴露其可序列化投影 `ConversationRef{conversationId}` + lifecycle invoke channel（interrupt/setModel/dispose 按 id）。若复审认为应 re-export 某"可序列化投影类型"，B1 未定义这样的类型——我方在 contract.ts 新建了 `ConversationRef`（未改 B1）。
2. **`AskUserToolResult` 是 `CallToolResult` 的结构子集**：我方定义了最小形状（`content:[{type:'text',text}]` + `isError?`）而非 import mcp sdk 的 `CallToolResult`（避免 contract/interact 依赖 `@modelcontextprotocol/sdk` 的深层类型面）。handler 里 `as unknown as` 桥接到 SDK 期望的返回类型——运行时 probe 已证形状被接受。若复审偏好直接用 SDK 的 `CallToolResult`，可改（但会把 mcp sdk 类型拉进 bridge 层）。
3. **zod 显式依赖**：从传递依赖提升为直接依赖（`4.4.3` exact）。若项目有"最小依赖"偏好，替代方案是继续依赖传递解析（但幻影依赖，`npm ci` 语义脆弱）——我方选了显式固定。
4. **`bridge:usageSummary` channel 已进 `BRIDGE_CHANNELS` 但标 Phase 1 预留**：契约面存在、实现首发缺席（符合简报"契约先占位"）。复审若认为预留 channel 不该进冻结常量集，可移出——但那样 Phase 1 加它就要动 `BRIDGE_CHANNELS`（与"加能力不改契约"原则相悖），故选择现在纳入 + 注释标预留。

---

## §修复轮（复审 Needs fixes：0 Critical + 3 Important + 2 Minor，全修）

复审自 `30b4745`。三 Important 冻结前必修、两 Minor 顺带。严格 TDD：#2/#3 先写 RED 再改。结果 **206/206 绿（202→206，+4 守卫测试）**，typecheck 两段 exit 0，null 扫描零。

### Important #1（撤 ConversationConfig re-export）
- **问题**：`contract.ts` re-export 了 `ConversationConfig`，但它内嵌 `provider: Provider`（持 `apiKey`），与我方排除 Provider 的理由自相矛盾——冻结契约里摆一个带 key 的进程内类型是陷阱（非活跃泄漏：无 channel 绑它，createConversation 用无 key 的 `CreateConversationRequest`）。
- **修法**：删 `ConversationConfig` re-export（只留 `ConversationState`）；订正 §B1 pool 注释——明标 `ConversationConfig` 是**进程内创建配置、不过 IPC**，投影为无 key 的 `CreateConversationRequest`。`pool.ts` 未动（B1 禁改）。同步 09 文档 §六 re-export 表。
- 无新测试（纯 re-export 撤除；`contract.test.ts` 本就不引 ConversationConfig，全绿）。

### Important #2（dangerous 档禁一切缓存 — 设计负责人拍板补全 06 §2.9）
- **设计决定**：**dangerous 档只允许 `allow-once`，禁 conversation 缓存、禁 permanent**（破坏性命令高度特异，批一个≠授权另一个）。
- **RED**：`interact.ts:268` allow-conversation 原无条件缓存（key=`Bash::dangerous`）→ host 对 `rm -rf /tmp/data` 返回 allow-conversation 后，`format C:`（同键）命中缓存自动放行。新测试断言"第二条不同 dangerous 命令仍走 transport（`seen.length===2`）"→ 现实现 RED（实际 1）。
- **GREEN**：allow-conversation 分支加 `if (risk !== "dangerous") conversationAllow.add(key)`——与 permanent-降 dangerous 对称。
- **测试**：新增 3 例——①不同 dangerous 命令不缓存（seen===2）；②同一 dangerous 命令仍问（strictly once）；③**moderate 命令仍缓存**（守卫是 dangerous-only 非一刀切，seen===1）。
- 09 文档审批档表 + 危险纪律段同步（明写"dangerous 只 allow-once，不缓存不持久化"）。

### Important #3（审批 default 改 fail-closed）
- **问题**：`allow-once` 与 `default` 同走 `allow()`；`ApprovalDecision.decision` 虽类型标 `ApprovalTier`，但值是宿主经 IPC 来的运行时不可信数据，畸形/未知字符串会 coerce 成 allow——与 broker "不信任宿主 UI" 姿态矛盾。
- **RED**：新测试构造畸形 decision（`"totally-bogus"`）→ 断言 deny → 现实现 RED（实际 allow）。
- **GREEN**：`case "allow-once": return allow();` 显式列出；`default:` 改 `{behavior:'deny', message:'Denied: unknown approval decision'}`（fail-closed）。
- **测试**：新增 1 例（畸形 decision → deny + message 非空）。

### Minor（两项，顺带）
- **inputSummary 措辞夸大"脱敏"**：实为命令原文截断（给用户看清才能批，本身对）。软化——`interact.ts` 两处 docstring（`ApprovalRequest.inputSummary` 注释 + `summarizeInput` 注释）去掉 "secret-safe"/"never the raw input/no secrets leak"，改为"截断展示供用户审批辨识、非脱敏（展示命令原文是刻意的）；密钥卫生在上游（env 脱敏 + 无 key IPC payload）"。09 文档 §二同步。
- （复审提及 `interact.ts:1009-1011` 应为笔误——文件仅 ~490 行；对应的措辞在 `summarizeInput` docstring，已软化。）

### 修复轮文件面
`src/bridge/interact.ts`（broker switch + 两 docstring）、`src/bridge/contract.ts`（撤 re-export + 注释）、`tests/bridge/interact.test.ts`（+4 测试）、`docs/specs/09-…v1.0.md`（审批表 + 危险纪律 + inputSummary 措辞 + re-export 表）。**仍未碰 forbidden 清单**（pool/providers/events/pricing/balance/gateway/smoke/vendor/CLAUDE.md/02/06/08）。

### 修复轮自查
- ✅ dangerous 档三态都只 allow-once：permanent 降级（原有）+ conversation 拒缓存（新）+ 本次仍放行；moderate 缓存不受影响（对照测试锁定）。
- ✅ default fail-closed：未知 decision → deny（非 allow），与危险降档同源"不信任宿主"。
- ✅ 契约不再含带 key 的进程内类型；`ConversationState` 仍导出（纯字符串 union，安全）。
- ✅ 措辞不再声称脱敏；密钥卫生归因到真实来源（上游 env 脱敏 + 无 key payload）。
- ✅ 206/206 绿；typecheck exit 0；null 扫描零；无 Electron/vendor/gateway 导入；无真 key 字面量。
