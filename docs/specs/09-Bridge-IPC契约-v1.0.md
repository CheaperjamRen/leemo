# 09 — Bridge IPC 契约 v1.0（冻结件）

> 里程碑 5 交付物。BASE=0b8128e（Task B3）。TS 形态权威 = `src/bridge/contract.ts`；本文件是人读版冻结声明。
> **本文档冻结后，双壳前端（渲染进程）可依此契约并行施工。** 契约面 channel/payload 类型名与 `contract.ts` 一一对应（下表每个 payload 类型都能在 `contract.ts` 找到同名导出）。
> 权威链：06 §2.9（审批三档 + 危险永不永久）、06 §3.1/3.2（Provider 形状 + 两种接线）、08 §二（ask_user MCP）。冲突时后者覆盖前者。

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
| `bridge:createConversation` | `createConversation` | `CreateConversationRequest` | `ConversationRef` |
| `bridge:send` | `send` | `SendRequest` | `void`（事件走 `bridge:event`，非本 invoke 响应） |
| `bridge:interrupt` | `interrupt` | `ConversationRef` | `void` |
| `bridge:setModel` | `setModel` | `SetModelRequest` | `void`（env 级，下一轮生效，不追溯——B1） |
| `bridge:disposeConversation` | `disposeConversation` | `ConversationRef` | `void` |

### 1.2 invoke — Provider / 余额 / 用量

| channel | 常量键 | request 类型 | response 类型 |
|---|---|---|---|
| `bridge:listProviders` | `listProviders` | `void` | `ProviderSpec[]` |
| `bridge:fetchBalance` | `fetchBalance` | `FetchBalanceRequest` | `BalanceInfo`（B2） |
| `bridge:usageSummary` | `usageSummary` | `UsageSummaryQuery` | `UsageSummary` |

> `bridge:usageSummary` = **Phase 1 预留**（契约已占位，首发不实现——见 §五）。

### 1.3 invoke — 交互回填（宿主→桥）

| channel | 常量键 | request 类型 | response 类型 |
|---|---|---|---|
| `bridge:approvalDecision` | `approvalDecision` | `ApprovalDecision` | `void` |
| `bridge:askUserAnswer` | `askUserAnswer` | `AskUserAnswer` | `void` |

### 1.4 event — 主进程推渲染进程

| channel | 常量键 | payload 类型 |
|---|---|---|
| `bridge:event` | `event` | `LeemoEvent`（B2 判别联合：conversation.started / text.delta / thinking.delta / text.final / tool.started / tool.finished / subagent.activity / compact.boundary / usage.final / run.finished / error） |
| `bridge:approvalRequest` | `approvalRequest` | `ApprovalRequest` |
| `bridge:askUser` | `askUser` | `AskUserPayload` |

> channel 常量集中在 `BRIDGE_CHANNELS`；`BridgeInvokeMap` / `BridgeEventMap` 把 channel 名映射到 payload 类型（键 = channel 名，值 = 契约类型），机器可核对文档↔类型一致。

---

## 二、审批往返时序（三档 + 危险降档）

审批基线：`permissionMode: 'acceptEdits'` + `canUseTool` 回调（06 §2.9）。`ApprovalBroker`（`src/bridge/interact.ts`）适配 SDK 的 `canUseTool` 签名（实测自 sdk.d.ts：`(toolName, input, {signal, toolUseID, requestId, …}) => Promise<PermissionResult | null>`；broker 永不返回 null）。

```
SDK 需要用工具
  → canUseTool(toolName, input, options)          [SDK 调 broker]
  → broker: risk = classifyRisk(toolName, input)  [safe|moderate|dangerous]
  → 命中永久白名单(persistence.getWhitelist, 按 toolName+risk)? → 直接 allow(不问)
  → 命中本对话缓存(conversation cache, 按 toolName+risk)?       → 直接 allow(不问)
  → 否则: 生成 ApprovalRequest{id, toolName, inputSummary, risk}
         经 bridge:approvalRequest 推宿主(inputSummary 是脱敏摘要, 非原始 input)
  → 宿主渲染对话内嵌审批条, 用户选档
  → 宿主经 bridge:approvalDecision 回 ApprovalDecision{id, decision, message?}
  → broker 按 decision 落地 → 返回 PermissionResult 给 SDK
```

**三档语义**（`ApprovalTier`）：

| 档 | decision 值 | broker 行为 | 缓存/持久化 |
|---|---|---|---|
| 允许一次 | `allow-once` | allow | 不缓存（同工具再来仍问） |
| 本对话内总是允许 | `allow-conversation` | allow | 写**本对话内存缓存**（同工具同风险后续不问）；不跨对话 |
| 永久允许 | `allow-permanent` | allow | 经 `persistence.addToWhitelist` 写全局白名单（跨对话；设置页可查可撤，06 §2.9） |
| 拒绝 | `deny` | deny（带 message） | 无 |

**危险降档（06 §2.9 铁律：危险操作永不提供"永久允许"档）**：
- `classifyRisk` 内置 Bash 危险模式**种子清单**（`rm -rf`/`del /f`/`format C:`/`mkfs`/`dd of=/dev/`/`diskpart`/`fdisk`/`reg add|delete`/`shutdown`/fork-bomb 等——注释标注"种子清单，非穷举"；漏判只降级为 moderate 走正常问询，绝不静默放行）。
- `risk === 'dangerous'` 时：**即便宿主返回 `allow-permanent`，broker 拒绝写永久白名单**，降级为 `allow-once`（本次放行、不缓存、下次仍问）。这是 broker 内部强制，不信任宿主端 UI 是否隐藏了永久档。

**并发**：每个 `canUseTool` 调用带独立 `id` + 独立 transport Promise，多个挂起互不串（waiters 隔离）。

**persistence 钩子外置（用户 7/21 拍板）**：`ApprovalPersistence = { getWhitelist(): …; addToWhitelist(entry): … }`（同步/异步均可）。broker 不自持久化；首发测试用内存实现，**Phase 1 接 SQLite**。

---

## 三、ask_user 往返时序（08 §二）

进程内 SDK MCP（`createSdkMcpServer`，实测 API 自 sdk.d.ts）暴露 `ask_user(questions)` 工具。momo 需求模糊时弹结构化选项卡而非文本反问（行为准则 §7.1③ 的执行机制）。NewMax ~80 行 waiters-Map 模式：

```
模型调 ask_user(questions)                          [SDK MCP 工具被调用]
  → 工具 handler → mcp.handle({questions})
  → 生成 id, 存 waiters.set(id, {resolve, timer?})  [阻塞 Promise 入 Map]
  → 经 bridge:askUser 推宿主 AskUserPayload{id, questions}
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
| `authMode` | `'api-key' \| 'oauth-subscription'` | **只实现 `api-key`** | `oauth-subscription` 槽位预留：订阅 OAuth 调用是**配额不是余额、是登录不是 key**（Claude Max/Kimi/智谱 coding plan、火山方舟/阿里百炼/百度千帆）。 |
| `kind` | `string`（**开放字符串**） | 少数已知值 | provider 家族标识。`KNOWN_PROVIDER_KINDS` 提供参考值集（deepseek/glm/kimi/qwen/anthropic/openrouter/relay/custom），**但类型是 `string` 不是闭合 union**——新家族/自定义 provider 不需改契约。 |
| `apiFormat` | `'anthropic' \| 'openai'` | 两者 | 保留自 B1/B2，驱动直连 vs 网关接线（06 §3.2）。 |
| `capabilities` | `ProviderCapabilities` | 按 provider 声明 | `{ balanceApi, modelDiscovery, subscriptionPlan }`——balance/pricing/quota 是 provider **按能力声明**的，内部派发按 `kind`/family，**不按具体 id 硬编码**。 |

**反模式警示（写进契约冻结）**：B2 的 `balance.ts` 现用 `provider.id === 'deepseek'|'kimi'` 硬编码 `FETCHERS` 表——那是明确自注的 **Phase 1 占位**，**不得把 id→capability 的假设编进本契约**。契约按 `providerId` 取实例 OK（IPC 引用），但"id 决定能力"绝不焊进类型；真 Provider 目录落地时，balance/pricing/quota 改按 `kind`/family 派发。

---

## 五、预留区（Phase 1 — 契约已占位、实现后续）

| 项 | 契约类型 | channel | 状态 |
|---|---|---|---|
| 今日/7 天用量汇总（hover 弹窗展示余额 + 统计，用户 7/21） | `UsageSummaryQuery` / `UsageSummary`（`byProvider` / `byDay` 明细） | `bridge:usageSummary` | 类型已冻结；实现需 SQLite = Phase 1 |
| 订阅配额（OAuth-subscription 的额度而非余额） | `authMode:'oauth-subscription'` + `capabilities.subscriptionPlan` | 复用 `bridge:fetchBalance` 面或 Phase 1 扩展 | 轴已预留；无 adapter 首发 |

> 预留原则：契约类型**现在就占位**，否则冻结后再加要动契约。首发不实现不代表契约缺席。

---

## 六、冻结声明 + 变更纪律（v1.0）

**v1.0 冻结**：§一 channel 集（`BRIDGE_CHANNELS`）、§一各 invoke/event payload 类型、§二/§三两条往返时序语义、§四 `ProviderSpec` 扩展轴。下游前端依此并行施工。

**变更纪律（明写原则）**：
1. **加 provider = 加目录数据，不改契约**。新 provider 是一条 `ProviderSpec` 目录记录，不是一次类型变更。
2. **自定义 provider 是一等公民**（`kind:'custom'` 或任意字符串 + 用户填 BaseURL/Key/模型/协议二选，06 §3.1）。契约不得假设 provider 来自预置集。
3. **balance/pricing/quota 是 provider 按 `kind` 声明的 capability**，内部派发**按 kind/family 不按实例 id**。
4. **`authMode`/`kind`/`capabilities` 是预留扩展轴**，首发只实现 `api-key` + 少数 `kind`；扩展走目录数据与 adapter，不动本契约。
5. 破坏性变更（改 channel 名/删字段/收窄 union）需 **v2.0** 并记变更纪律；加**可选**字段兼容 v1.x。

**契约类型完备性自证**（复审可核）：
- `contract.ts` re-export 覆盖 B1/B2/B3 全部对外类型（下表），无遗漏、无重复定义（全部 `export type … from`，不再定义）。
- 本文档每个 payload 类型名 = `contract.ts` 同名导出（`BridgeInvokeMap`/`BridgeEventMap` 键即 channel 名，机器可核）。
- 扩展轴在 `ProviderSpec`/`ProviderCapabilities` 真实存在（`tests/bridge/contract.test.ts` 构造 OAuth-custom-quota 实例，删轴即 typecheck 红）。

| 来源模块 | re-export 的对外类型 |
|---|---|
| `events.ts`（B2） | `LeemoEvent`、`UsageRecord`、`PathAudit`、`PathClaim` |
| `pricing.ts`（B2） | `ModelPricing` |
| `balance.ts`（B2） | `BalanceInfo` |
| `pool.ts`（B1） | `ConversationConfig`、`ConversationState`（`ConversationHandle` 进程内对象不 re-export，投影 = `ConversationRef`） |
| `providers.ts`（B1） | `ModelCapabilities`（`Provider` 含 key，不 re-export；投影 = `ProviderSpec`） |
| `interact.ts`（B3） | `RiskLevel`、`ApprovalTier`、`ApprovalRequest`、`ApprovalDecision`、`WhitelistEntry`、`AskUserOption`、`AskUserQuestion`、`AskUserInput`、`AskUserPayload`、`AskUserAnswerItem`、`AskUserAnswer` |
| `contract.ts` 新增（IPC 面） | `ProviderSpec`、`ProviderAuthMode`、`ProviderKind`、`ProviderCapabilities`、`CreateConversationRequest`、`ConversationRef`、`SendRequest`、`SetModelRequest`、`FetchBalanceRequest`、`UsageSummaryQuery`/`UsageSummary`/`UsageSummaryByProvider`/`UsageSummaryByDay`、`BridgeInvokeMap`/`BridgeEventMap`/`BridgeChannel`、常量 `BRIDGE_CHANNELS`/`KNOWN_PROVIDER_KINDS` |
