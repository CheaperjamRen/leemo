# 09 — Bridge IPC 契约 v1.0（冻结件，含 7/21 签字前修订）

> **v1.1→v1.2（2026-07-29，兼容加法）**：新增四条 MCP 配置通道：
> `bridge:listMcpServers` / `bridge:saveMcpServer` / `bridge:deleteMcpServer` /
> `bridge:testMcpServer`。MCP 的 env/header 明文只允许 renderer→main，落进与
> Provider 相同的 safeStorage 加密件；main→renderer 只回键名。测试通道直接执行
> MCP initialize + tools/list，不调用模型、不消耗模型额度。

> **v1.0→v1.1（2026-07-23）**：唯一形状级变化为 `bridge:event` 信封化为 `BridgeEventEnvelope = { conversationId, event: LeemoEvent }`，为多对话精确路由服务；其余为字段/通道加法。无在线 Phase-1 消费方，允许原路径就地修订；Bridge 不生产 `runId`。

> 里程碑 5 交付物。BASE=0b8128e（Task B3）。TS 形态权威 = `src/bridge/contract.ts`；本文件是人读版冻结声明。
> **本文档冻结后，双壳前端（渲染进程）可依此契约并行施工。** 契约面 channel/payload 类型名与 `contract.ts` 一一对应（下表每个 payload 类型都能在 `contract.ts` 找到同名导出）。
> 权威链：06 §2.9（审批 → **7/21 修订为策略驱动，见下**）、06 §3.1/3.2（Provider 形状 + 两种接线）、08 §二（ask_user MCP）。冲突时后者覆盖前者。
> **版本注记**：v1.0 含 **7/21 签字前修订**（Task B3-R）——审批策略化（PermissionMode + dangerousCommandCaching 开关 + bypassPermissions 零卡）、本地无 key provider（`authMode:'none'`）、NewMax 便捷能力轴（local/protocolSwitchable/multiKey/requiresProxy）。**7/29 安全订正**：Shell 缓存收窄到当前对话中的完全相同命令；Shell 与 dangerous 永不进入永久白名单。

---

## 宪法修订记录（06 §2.9，用户 7/21；范围订正 7/29）

> 06 §2.9 原文将"**危险操作永不提供永久允许档**"定为硬不变量。用户（设计负责人）7/21 **主动修订**为：**默认安全、用户可选放开**。7/29 实机视觉/安全复核后，放开的边界订正为：危险操作可在当前对话减少重复确认，但不跨对话永久放行；完全零卡仍由 `bypassPermissions` 显式承担。
>
> **理由**：绝大多数用户只想让模型把任务干完，反复弹卡读作麻烦而非安全；但展示一条具体 Shell 命令却暗中授权整类命令，会误导用户。故审批保持**策略驱动**：默认危险严格一次一批；用户可让完全相同的危险命令在本对话不再重复询问，或显式选择 `bypassPermissions` 全面零卡。便利不能制造隐藏的跨对话授权。

---

## 〇、契约边界与非目标

- 本契约是 **Electron 无关的纯类型 + 进程内逻辑**。channel 名与 payload 形状在此冻结；Electron 的 `ipcMain/ipcRenderer` 绑定是 **Phase 1** 落地（本卡不引 Electron）。
- **密钥永不过 IPC**：Provider 的真实 `apiKey` 只存在于主进程（safeStorage 加密，06 §3.2）。渲染进程只见 `ProviderSpec`（无 key 投影）；创建对话按 `providerId` 引用，主进程解目录取 key。
- 进程内对象（`ConversationHandle`、live `AbortController`、SDK MCP `instance`）**不过 IPC**，只暴露其可序列化投影（`ConversationRef` = 一个 `conversationId`）。

---

## 一、Channel 清单

两类：**invoke**（渲染进程→主进程，请求/响应）与 **event**（主进程→渲染进程，推送）。每个 channel 标注 payload 类型（= `contract.ts` 的导出类型名）。

### 1.1 invoke — 对话生命周期

| channel | 常量键 | request 类型 | response 类型 |
|---|---|---|---|
| `bridge:createConversation` | `createConversation` | `CreateConversationRequest`（含 `purpose?: 'main' | 'wiki'`；wiki 影子对话的低 maxTurns/轻提示策略留给后续装配） | `ConversationRef` |
| `bridge:send` | `send` | `SendRequest` | `void`（事件走 `bridge:event`，非本 invoke 响应） |
| `bridge:interrupt` | `interrupt` | `ConversationRef` | `void` |
| `bridge:setModel` | `setModel` | `SetModelRequest` | `void`（env 级，下一轮生效，不追溯——B1） |
| `bridge:disposeConversation` | `disposeConversation` | `ConversationRef` | `void` |

### 1.2 invoke — Provider / 余额 / 用量 / 永久白名单

| channel | 常量键 | request 类型 | response 类型 |
|---|---|---|---|
| `bridge:listProviders` | `listProviders` | `void` | `ProviderSpec[]` |
| `bridge:fetchBalance` | `fetchBalance` | `FetchBalanceRequest` | `BalanceInfo`（B2） |
| `bridge:usageSummary` | `usageSummary` | `UsageSummaryQuery` | `UsageSummary` |
| `bridge:listWhitelist` | `listWhitelist` | `void` | `WhitelistEntry[]` |
| `bridge:revokeWhitelist` | `revokeWhitelist` | `{ toolName: string; risk: RiskLevel }` | `void` |

> `bridge:usageSummary` = **Phase 1 预留**（契约已占位，首发不实现——见 §五）。

### 1.3 invoke — 交互回填（宿主→桥）

| channel | 常量键 | request 类型 | response 类型 |
|---|---|---|---|
| `bridge:approvalDecision` | `approvalDecision` | `ApprovalDecision` | `void` |
| `bridge:askUserAnswer` | `askUserAnswer` | `AskUserAnswer` | `void` |

### 1.3a invoke — MCP / 浏览器能力

| channel | 常量键 | request 类型 | response 类型 |
|---|---|---|---|
| `bridge:listMcpServers` | `listMcpServers` | `void` | `McpServerView[]`（凭据只回 key 名） |
| `bridge:saveMcpServer` | `saveMcpServer` | `McpServerDraft` | `McpServerView` |
| `bridge:deleteMcpServer` | `deleteMcpServer` | `{ id: string }` | `void` |
| `bridge:testMcpServer` | `testMcpServer` | `{ id: string }` | `McpConnectionTestResult`（真实 initialize + tools/list） |

### 1.4 event — 主进程推渲染进程

| channel | 常量键 | payload 类型 |
|---|---|---|
| `bridge:event` | `event` | `BridgeEventEnvelope`（`{ conversationId: string; event: LeemoEvent }`；内层仍是 B2 的 11 个语义 variant） |
| `bridge:approvalRequest` | `approvalRequest` | `ApprovalRequest` |
| `bridge:askUser` | `askUser` | `AskUserPayload` |

> channel 常量集中在 `BRIDGE_CHANNELS`；`BridgeInvokeMap` / `BridgeEventMap` 把 channel 名映射到 payload 类型（键 = channel 名，值 = 契约类型），机器可核对文档↔类型一致。

---

## 二、审批往返时序（策略驱动：模式 + 三档 + 危险条件缓存）

审批**策略驱动**（7/21 修订）。`createApprovalBroker(conversationId, transport, persistence, policy?)`（`src/bridge/interact.ts`）适配 SDK 的 `canUseTool` 签名（实测自 sdk.d.ts：`(toolName, input, {signal, toolUseID, requestId, …}) => Promise<PermissionResult | null>`；broker 永不返回 null）。每个 broker 是一个对话上下文，外发 `ApprovalRequest` 必带注入的 `conversationId`；`policy` 可选，缺省 = `{ mode:'acceptEdits', dangerousCommandCaching:false }`（保留 B3 安全默认）。

**PermissionMode（`PermissionMode`）**：

| 模式 | 本卡 broker 语义 | 备注 |
|---|---|---|
| `default` | 完整问询流（走下方三档） | 基线 |
| `acceptEdits` | 自动放行 Write/Edit/NotebookEdit；Shell/未知 MCP 仍问 | 当前默认；写文件不打断，命令仍可控 |
| `bypassPermissions` | **短路：一切工具直接 allow（含危险），不生成 ApprovalRequest、不经 transport（零卡）** | 用户显式选 = 自负其责；本卡硬行为 |
| `plan` | 交给 Claude Agent SDK 原生 plan 模式执行只读约束 | Leemo 不自造一套相冲突的工具分类 |

> `bypassPermissions` 是 broker 硬短路；`acceptEdits` 已有编辑类自动放行语义；`plan` 由 SDK 原生模式约束。每对话可经 `CreateConversationRequest.permissionMode?` 覆盖全局默认。

**PermissionPolicy（`PermissionPolicy = { mode, dangerousCommandCaching }`）**：`dangerousCommandCaching` = 设置页"记住危险操作授权"开关。`false`（默认、安全）= 危险严格一次一批；`true`（用户开）= 完全相同的危险 Shell 命令可在当前对话缓存。两种状态都不允许 Shell/dangerous 写入永久白名单。

```
SDK 需要用工具
  → canUseTool(toolName, input, options)          [SDK 调 broker]
  → policy.mode === 'bypassPermissions'? → 直接 allow(零卡：不问、不经 transport、危险也放行)
  → broker: risk = classifyRisk(toolName, input)  [safe|moderate|dangerous]
  → 非 Shell 且非 dangerous，命中永久白名单(toolName+risk)? → 直接 allow(不问)
  → 命中本对话缓存?（普通工具按 toolName+risk；Shell 再加完全相同 command）→ 直接 allow
  → 否则: 生成 ApprovalRequest{id, conversationId, toolName, inputSummary, risk}
         经 bridge:approvalRequest 推宿主(inputSummary 是输入摘要, 截断展示供用户审批时辨识; 非脱敏——展示命令原文是刻意的, 用户需看清才能批)
  → 宿主渲染对话内嵌审批条, 用户选档
  → 宿主经 bridge:approvalDecision 回 ApprovalDecision{id, decision, message?}
  → broker 按 decision 落地 → 返回 PermissionResult 给 SDK
```

**三档语义**（`ApprovalTier`）：

| 档 | decision 值 | broker 行为 | 缓存/持久化 |
|---|---|---|---|
| 允许一次 | `allow-once` | allow | 不缓存（同工具再来仍问） |
| 本对话内总是允许 | `allow-conversation` | allow | 普通工具按同工具同风险缓存；Shell 仅缓存完全相同命令；不跨对话；dangerous 视开关 |
| 永久允许 | `allow-permanent` | allow | 仅非 Shell、非 dangerous 工具可写全局白名单；设置页可查可撤 |
| 拒绝 | `deny` | deny（带 message） | 无 |
| 未知/畸形 decision | 其它任意值 | **deny（fail-closed）** | 无 |

> **fail-closed default**：`decision` 字段虽类型标 `ApprovalTier`，但值由宿主经 IPC 传入（运行时不可信数据）。畸形/未来未知字符串**一律 deny**，绝不 coerce 成 allow——与 broker "不信任宿主 UI" 的姿态一致（危险降档同源）。

**危险档纪律（策略条件化 — 06 §2.9 经 7/21 修订，7/29 收窄范围）**：dangerous 永不永久；是否可在当前对话缓存由 `policy.dangerousCommandCaching` 控制：
- **`dangerousCommandCaching === false`（默认、安全）**：**dangerous 档只允许 `allow-once`——禁 conversation 缓存、禁 permanent 持久化**。即便宿主返回 `allow-permanent`/`allow-conversation`，broker 一律降级为 `allow-once`（本次放行、不缓存、不持久化、下次仍问）。理由：破坏性命令高度特异，批准一个（`rm -rf /tmp/data`）绝不等于授权另一个（`format C:`，二者同 `Bash::dangerous` 键）。broker 内部强制，不信任宿主端 UI。
- **`dangerousCommandCaching === true`（用户经设置开关放开）**：`allow-conversation` 可写本对话缓存；Shell 缓存键包含完全相同的 command。`allow-permanent` 仍被 broker 拒绝持久化。
- `classifyRisk` 内置 Bash 危险模式**种子清单**（`rm -rf`/`del /f`/`format C:`/`mkfs`/`dd of=/dev/`/`diskpart`/`fdisk`/`reg add|delete`/`shutdown`/fork-bomb 等——注释标注"种子清单，非穷举"；漏判只降级为 moderate 走正常问询，绝不静默放行）。**注**：种子清单与危险分类不受开关影响；开关只改"危险被批准后能否缓存"，不改"什么算危险"。

**审批哲学（7/21 定调，7/29 范围订正）**：**默认低摩擦**——内置只读能力和 acceptEdits 不重复索权；危险操作默认每次问。用户可在当前对话记住完全相同的危险命令，或选 `bypassPermissions` 彻底零卡。审批卡必须如实说明授权范围；畸形/未知 decision 一律 deny。

**并发**：每个 `canUseTool` 调用带独立 `id` + 独立 transport Promise，多个挂起互不串（waiters 隔离）。

**persistence 钩子外置（用户 7/21 拍板）**：`ApprovalPersistence = { getWhitelist(): …; addToWhitelist(entry): …; removeFromWhitelist(entry): … }`（同步/异步均可）。永久白名单全局按 `(toolName, risk)` 键控，但 Shell/dangerous 条目在 broker 与 SQLite 两层均拒绝；旧版遗留条目启动时清理。设置页可查看和精确撤销其余条目。

---

## 三、ask_user 往返时序（08 §二）

进程内 SDK MCP（`createAskUserMcp(conversationId, transport, options?)` + `createSdkMcpServer`，实测 API 自 sdk.d.ts）暴露 `ask_user(questions)` 工具。每个 MCP 实例固定绑定一个 conversationId，所有 `AskUserPayload` 以该值路由；momo 需求模糊时弹结构化选项卡而非文本反问（行为准则 §7.1③ 的执行机制）。NewMax ~80 行 waiters-Map 模式：

```
模型调 ask_user(questions)                          [SDK MCP 工具被调用]
  → 工具 handler → mcp.handle({questions})
  → 生成 id, 存 waiters.set(id, {resolve, timer?})  [阻塞 Promise 入 Map]
  → 经 bridge:askUser 推宿主 AskUserPayload{id, conversationId, questions}
  → 工具在此 BLOCK(Promise 未 settle)
  → 宿主渲染对话内选项卡片(单选/多选 + Other 输入; 搭子态轻样式)
  → 宿主经 bridge:askUserAnswer 回 AskUserAnswer{id, items:[{selected, other?}]}
  → mcp.provideAnswer(id, answer) → waiters 命中 → Promise resolve
  → 工具返回答案文本给模型(CallToolResult: content[{type:'text', text}])
```

**失败路径永不挂死**（三条，均返回 `isError:true` 的可解释结果，不吊住工具）：
- `transport.ask` reject（宿主通道故障）→ 立即 settle 为 error 结果。
- 超时（`timeoutMs` 可选；permission 类无 park deadline，默认不超时，测试注入小值）→ error 结果。
- 宿主取消（`failAsk(id, reason)`，如卡片被 dismiss）→ error 结果。

**并发**：多问各自独立 `id`，答复乱序回填也各归其位（waiters 隔离）。

**ask_user 输入形状**（`AskUserQuestion`，参照 AskUserQuestion 精简）：`{ question, header?, options:[{label, description?}], multiSelect? }`。zod schema 校验（zod 4.4.3，已固定为显式依赖）。

---

## 四、Provider 形状与扩展轴（硬要求 — 用户 7/21 provider 面落地）

`ProviderSpec`（IPC 面无 key 投影）**带这些扩展轴**（即便首发只实现一种）：

| 轴 | 类型 | 首发 | 说明 |
|---|---|---|---|
| `authMode` | `'api-key' \| 'oauth-subscription' \| 'none'` | **实现 `api-key`（+ `none` 本地）** | `oauth-subscription` 槽位预留：订阅 OAuth 调用是**配额不是余额、是登录不是 key**（Claude Max/Kimi/智谱 coding plan、火山方舟/阿里百炼/百度千帆）。**`none`（7/21 新增）= 本地模型无需 key**（Ollama/LM Studio，用户点名），指向 loopback/LAN `baseUrl`，无鉴权，配 `capabilities.local`。 |
| `kind` | `string`（**开放字符串**） | 少数已知值 | provider 家族标识。`KNOWN_PROVIDER_KINDS` 提供参考值集（deepseek/glm/kimi/qwen/anthropic/openrouter/relay/custom），**但类型是 `string` 不是闭合 union**——新家族/自定义 provider 不需改契约。 |
| `apiFormat` | `'anthropic' \| 'openai'` | 两者 | 保留自 B1/B2，驱动直连 vs 网关接线（06 §3.2）。 |
| `capabilities` | `ProviderCapabilities` | 按 provider 声明 | 现有 `{ balanceApi, modelDiscovery, subscriptionPlan }` + **7/21 NewMax 对照留位（均可选）**：`local?`（本地部署）、`protocolSwitchable?`（anthropic⇄openai Base-URL 切换，NewMax ~10 个 provider 支持）、`multiKey?`（多 key 轮换）、`requiresProxy?`（海外端点需代理）。balance/pricing/quota 是 provider **按能力声明**的，内部派发按 `kind`/family，**不按具体 id 硬编码**。 |

> **NewMax 便捷特性留位说明**：上表 `capabilities` 的四个新可选轴是**契约留位**，首发无任何代码路径读它们。对齐 NewMax 便捷特性（双协议切换 / 多 key / requiresProxy / per-provider env / 模型槽位 / 从服务商拉取模型 / 测试连接）= **Provider 里程碑**填目录数据 + 建设置页 UI；契约已把轴留好，届时是加数据不是改契约。

**反模式警示（写进契约冻结）**：B2 的 `balance.ts` 现用 `provider.id === 'deepseek'|'kimi'` 硬编码 `FETCHERS` 表——那是明确自注的 **Phase 1 占位**，**不得把 id→capability 的假设编进本契约**。契约按 `providerId` 取实例 OK（IPC 引用），但"id 决定能力"绝不焊进类型；真 Provider 目录落地时，balance/pricing/quota 改按 `kind`/family 派发。

---

## 五、预留区（Phase 1 — 契约已占位、实现后续）

| 项 | 契约类型 | channel | 状态 |
|---|---|---|---|
| 今日/7 天用量汇总（hover 弹窗展示余额 + 统计，用户 7/21） | `UsageSummaryQuery` / `UsageSummary`（`byProvider` / `byDay` 明细） | `bridge:usageSummary` | 类型已冻结；实现需 SQLite = Phase 1 |
| 订阅配额（OAuth-subscription 的额度而非余额） | `authMode:'oauth-subscription'` + `capabilities.subscriptionPlan` | 复用 `bridge:fetchBalance` 面或 Phase 1 扩展 | 轴已预留；无 adapter 首发 |

> 预留原则：契约类型**现在就占位**，否则冻结后再加要动契约。首发不实现不代表契约缺席。

---

## 六、冻结声明 + 变更纪律（v1.1）

**v1.1 冻结（含 7/21 修订）**：§一 channel 集（`BRIDGE_CHANNELS`）、§一各 invoke/event payload 类型（其中 `bridge:event` 仅接受 `BridgeEventEnvelope`）、§二审批策略语义（PermissionMode/PermissionPolicy + 危险条件缓存 + bypass 零卡 + fail-closed）、§三 ask_user 时序、§四 `ProviderSpec` 扩展轴。`conversationId` 是所有外发事件/回投请求的路由字段；**Bridge/SDK 不生产 `runId`**，渲染层自行维护并在解信封后反查。下游前端依此并行施工。

**变更纪律（明写原则）**：
1. **加 provider = 加目录数据，不改契约**。新 provider 是一条 `ProviderSpec` 目录记录，不是一次类型变更。
2. **自定义 provider 是一等公民**（`kind:'custom'` 或任意字符串 + 用户填 BaseURL/Key/模型/协议二选，06 §3.1）。契约不得假设 provider 来自预置集。
3. **balance/pricing/quota 是 provider 按 `kind` 声明的 capability**，内部派发**按 kind/family 不按实例 id**。
4. **`authMode`/`kind`/`capabilities` 是预留扩展轴**，首发实现 `api-key`（+ `none` 本地）+ 少数 `kind`；扩展走目录数据与 adapter，不动本契约。**NewMax 便捷特性（双协议切换/多 key/requiresProxy/per-provider env/模型槽位/从服务商拉取/测试连接）= Provider 里程碑填目录数据，契约已留轴**（`capabilities.local/protocolSwitchable/multiKey/requiresProxy`）。
5. **审批是策略驱动**：`PermissionMode` 四值 + `PermissionPolicy.dangerousCommandCaching` 开关是冻结契约面；`acceptEdits` 与 SDK 原生 `plan` 已落地。Shell 缓存只能命中完全相同命令；Shell/dangerous 永不永久。
6. **v1.1 路由纪律**：`BridgeEventEnvelope` 是 `bridge:event` 唯一信封；不得把 `conversationId` 散加到 `LeemoEvent` variant，亦不得添加 Bridge 侧 `runId`。`purpose` 仅为创建 metadata，不能在本契约层引入 pool/maxTurns/system prompt 策略。
7. **白名单撤销纪律**：全局条目按 `(toolName, risk)` 精确定位；不得以 toolName 单键粗删，也不得加入 conversationId。
8. 破坏性变更（改 channel 名/删字段/收窄 union）需 **v2.0** 并记变更纪律；加**可选**字段兼容 v1.x。

**契约类型完备性自证**（复审可核）：
- `contract.ts` re-export 覆盖 B1/B2/B3 全部对外类型（下表），无遗漏、无重复定义（全部 `export type … from`，不再定义）。
- 本文档每个 payload 类型名 = `contract.ts` 同名导出（`BridgeInvokeMap`/`BridgeEventMap` 键即 channel 名，机器可核）。
- v1.1 新增 `BridgeEventEnvelope`、`CreateConversationRequest.purpose?`、list/revoke whitelist 映射、两个外发 payload 的 `conversationId` 与 `ApprovalPersistence.removeFromWhitelist`；`tests/bridge/contract.test.ts` 和 `tests/bridge/interact.test.ts` 以类型断言和运输行为覆盖。
- 扩展轴在 `ProviderSpec`/`ProviderCapabilities` 真实存在（`tests/bridge/contract.test.ts` 构造 OAuth-custom-quota 实例 + 本地 `authMode:'none'`/`capabilities.local` 实例 + `PermissionMode`/`PermissionPolicy` 用例，删轴即 typecheck 红）。

| 来源模块 | re-export 的对外类型 |
|---|---|
| `events.ts`（B2） | `LeemoEvent`、`UsageRecord`、`PathAudit`、`PathClaim` |
| `pricing.ts`（B2） | `ModelPricing` |
| `balance.ts`（B2） | `BalanceInfo` |
| `pool.ts`（B1） | `ConversationState`（`ConversationConfig` 内嵌 `provider:Provider` 持 key，进程内创建配置**不 re-export**、不过 IPC，投影 = 无 key 的 `CreateConversationRequest`；`ConversationHandle` 进程内对象不 re-export，投影 = `ConversationRef`） |
| `providers.ts`（B1） | `ModelCapabilities`（`Provider` 含 key，不 re-export；投影 = `ProviderSpec`） |
| `interact.ts`（B3 / B3-R） | `RiskLevel`、`ApprovalTier`、`ApprovalRequest`、`ApprovalDecision`、`WhitelistEntry`、**`PermissionMode`**、**`PermissionPolicy`**（7/21 新增）、`AskUserOption`、`AskUserQuestion`、`AskUserInput`、`AskUserPayload`、`AskUserAnswerItem`、`AskUserAnswer` |
| `contract.ts` 新增（IPC 面） | `ProviderSpec`、`ProviderAuthMode`（+`none`）、`ProviderKind`、`ProviderCapabilities`（+`local/protocolSwitchable/multiKey/requiresProxy`）、`CreateConversationRequest`（+`permissionMode?`）、`ConversationRef`、`SendRequest`、`SetModelRequest`、`FetchBalanceRequest`、`UsageSummaryQuery`/`UsageSummary`/`UsageSummaryByProvider`/`UsageSummaryByDay`、`BridgeInvokeMap`/`BridgeEventMap`/`BridgeChannel`、常量 `BRIDGE_CHANNELS`/`KNOWN_PROVIDER_KINDS` |
