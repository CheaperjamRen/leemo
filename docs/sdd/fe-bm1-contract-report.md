# FE Batch -1 — Bridge 契约 v1.1 执行报告

## 1. BASE 与工作区状态

- 执行 worktree：`E:\Leemo\.claude\worktrees\agent-af26fcc90ac7bf4bb`
- 初始 worktree HEAD：`2ce18e5`，缺少本卡要求的 renderer call sites，仅有 215 测试；`HEAD` 经祖先检查可安全快进至 `main`。
- 快进前状态：`M tests/gateway/__snapshots__/pitfall-12-sse-statemachine.test.ts.snap`。该修改在本卡开始前已存在，未 stash/reset/clean/覆盖或编辑。
- 快进：`git merge --ff-only main` 成功，更新到本卡 BASE `28921be`；该上游更新不触及上述 gateway snapshot。更新后复跑基线：41 test files / **290 tests passed**；三段 typecheck 全绿。
- 父工作区的未跟踪 10 号规格和 brief 仅以绝对路径只读，未编辑；所有实现仅在本 worktree 进行。

## 2. v1.1 字段/通道矩阵与来源

来源：`docs/specs/10-前端完整形态设计-v1.0.md` §二裁决①②③、§1.4、§1.5、§四 Batch -1。

| 范围 | v1.0 | v1.1 |
|---|---|---|
| `bridge:event` | 裸 `LeemoEvent` | 唯一信封 `BridgeEventEnvelope = { conversationId: string; event: LeemoEvent }`；内层 11 个语义 variant 未改 |
| 对话创建 | 无类型标记 | `CreateConversationRequest.purpose?: "main" | "wiki"`，仅 metadata，不实现策略 |
| 审批外发 | `ApprovalRequest` 无路由字段 | 必填 `conversationId` |
| 问询外发 | `AskUserPayload` 无路由字段 | 必填 `conversationId` |
| 白名单读取 | 无 | `bridge:listWhitelist`: `void → WhitelistEntry[]` |
| 白名单撤销 | 无 | `bridge:revokeWhitelist`: `{ toolName; risk: RiskLevel } → void` |
| persistence | `getWhitelist` / `addToWhitelist` | 增加必填 `removeFromWhitelist(entry)`，由 `(toolName, risk)` 精确定位 |

`runId` 没有加入任何 Bridge payload；它仍只存在于渲染层消息模型。

## 3. 工厂签名与不串线证明

| 工厂 | 变更前 | v1.1 精确签名 |
|---|---|---|
| approval | `createApprovalBroker(transport, persistence, policy?)` | `createApprovalBroker(conversationId, transport, persistence, policy?)` |
| ask_user | `createAskUserMcp(transport, options?)` | `createAskUserMcp(conversationId, transport, options?)` |

- `createApprovalBroker` 在所有 `transport.request` payload 中写入构造时的 `conversationId`。
- `createAskUserMcp` 在每个并发 `transport.ask` payload 中写入构造时的 `conversationId`，原有 request-id waiters 与乱序答复隔离仍保留。
- `tests/bridge/interact.test.ts` 新断言验证 `conv-a` broker 外发为 `conv-a`，并验证 MCP 并发 payload 均为实例绑定的 `conv-a`；原有 `conv-a` / `conv-b` cache 隔离测试保持通过。
- `conversations.ts` 在 `applyEvent` 之前检查 `envelope.conversationId === activeId`；foreign envelope 直接 no-op，命中时 reducer 仍只接收裸 `envelope.event`。

## 4. 严格 TDD 证据

### RED

新增 contract/interact/renderer 断言后，在生产实现前运行：

```powershell
npm test -- tests/bridge/contract.test.ts tests/bridge/interact.test.ts src/renderer/stores/conversations.test.ts src/renderer/bridge/fixture-client.test.ts
npm run typecheck
```

真实结果：定向测试 **27 failed / 40 passed**；typecheck exit 2。

代表性真实失败：

- `BRIDGE_CHANNELS.listWhitelist` 为 `undefined`，且 channel 完备性计数 13 而测试要求 15。
- `tests/bridge/contract.test.ts`: `BridgeEventEnvelope` 未导出；`CreateConversationRequest.purpose` 不存在；新的 `BridgeInvokeMap` key 不存在；裸 `LeemoEvent` 仍被 `bridge:event` 接受（`@ts-expect-error` 未使用）。
- `tests/bridge/interact.test.ts`: 新签名将 string 作为首参传入旧工厂时，旧实现把 string 当 transport，运行时触发 `TypeError: persistence.getWhitelist is not a function`；`ApprovalRequest` / `AskUserPayload` 不存在 `conversationId`；`ApprovalPersistence` 不存在 `removeFromWhitelist`。
- `fixture-client` 仍发裸事件，新的信封断言读取 `event` 时为 `undefined`；interrupt 结果也没有 `conversationId`。

这些失败分别证明契约类型、工厂入参顺序、外发 payload 盖章、事件运输与 renderer 解信封均非空转。

### GREEN

实现后按 brief 原定四文件命令验证：

```powershell
npm test -- tests/bridge/contract.test.ts tests/bridge/interact.test.ts src/renderer/stores/conversations.test.ts src/renderer/bridge/fixture-client.test.ts
# 4 files / 67 tests passed
```

实现过程中另发现 `src/renderer/components/PinnedPlan.test.tsx` 的既有 BridgeClient fake 也直接受信封化影响；做最小适配后，把它加入补充定向复跑：

```powershell
npm test -- tests/bridge/contract.test.ts tests/bridge/interact.test.ts src/renderer/stores/conversations.test.ts src/renderer/bridge/fixture-client.test.ts src/renderer/components/PinnedPlan.test.tsx
# 5 files / 69 tests passed
```

随后运行：

```powershell
npm run typecheck
# tsc -p tsconfig.vendor.json && tsc -p tsconfig.json && tsc -p tsconfig.renderer.json
# exit 0
```

最终全量验证：

```powershell
npm test
# 41 files / 298 tests passed

npm run typecheck
# vendor + first-party + renderer 三段均 exit 0

git diff --check
# exit 0

git diff --stat
# 10 tracked files；另有本报告 1 个允许的新建未跟踪文件
```

290 测试的更新后基线未下降，最终增加到 298。

## 5. 实际文件清单与说明

本卡实现/测试/文档变更：

1. `src/bridge/contract.ts` — v1.1 envelope、purpose、两个白名单 channel/map。
2. `src/bridge/interact.ts` — 两个必填 conversationId、精确工厂签名、persistence removal hook。
3. `tests/bridge/contract.test.ts` — envelope-only、purpose、list/revoke 类型与 channel 完备性断言。
4. `tests/bridge/interact.test.ts` — payload conversationId、broker/MCP 不串、精确 removal fake/assertion。
5. `src/renderer/stores/conversations.ts` — 解信封并按当前单对话 activeId 过滤，再传裸 event 给 reducer。
6. `src/renderer/stores/conversations.test.ts` — foreign envelope 不污染 state。
7. `src/renderer/bridge/fixture-client.ts` — send/interrupt request 的 conversationId 进入所有 event 信封。
8. `src/renderer/bridge/fixture-client.test.ts` — send/demo/interrupt 的信封 transport 断言。
9. `src/renderer/components/PinnedPlan.test.tsx` — 直接受 `bridge:event` 信封化影响的既有 fake 最小适配；原有 plan 渲染断言未改。
10. `docs/specs/09-Bridge-IPC契约-v1.0.md` — 原路径 v1.0→v1.1 修订：channel 表、event 信封、审批/问询时序、purpose、remove hook、冻结纪律和 runId 边界。
11. `docs/sdd/fe-bm1-contract-report.md` — 本报告。

写报告前的 `git diff --stat`（不含本报告）为 10 文件、258 additions / 77 deletions；本报告作为允许的新建文件加入最终交付。

## 6. 禁改面自查

- `@anthropic-ai/claude-agent-sdk` 仍严格为 `0.3.210`；`package.json`、lockfile 未产生本卡 diff。
- `smoke/**` 未修改，亦未运行 live smoke。
- `src/bridge/{pool,providers,events,pricing,balance}.ts` 零改；`src/gateway/**`、vendor、gateway tests 零改。
- 无 `runId` 进入 `src/bridge/**`；不存在对 `LeemoEvent` variant 散加 `conversationId`。
- 未改 Batch 0 state maps / `wireBridgeSubscriptions` / 其他 store / React UI / CSS。
- `PinnedPlan.test.tsx` 是唯一额外 renderer test fake，且为 envelope-only contract 所必需的最小适配。
- 未新增密钥、fixture secret 或旧名称；无 commit / push。
- 既有脏文件 `tests/gateway/__snapshots__/pitfall-12-sse-statemachine.test.ts.snap` 仍在 status 中，但不属于本卡 diff，未触碰。

## 7. 独立复审与父工作区验收

### 独立 Opus 4.8 复审

结论：**PASS，无代码/阻断缺陷**。

复审者逐项反证并确认：
- `BridgeEventEnvelope` 只存在于契约/运输边界；`LeemoEvent` variant 未被污染，Bridge 无 `runId`。
- 单对话兼容层先过滤 foreign conversationId，再把裸 event 交给 `applyEvent`。
- fixture 的 send/interrupt 均使用 invoke request 自带 conversationId 包信封。
- approval/ask 工厂签名与外发 payload 正确；只给 outgoing 卡加 conversationId，reply 类型未越界扩大。
- whitelist 撤销按 `(toolName,risk)` 精确键，purpose 只作为 metadata。
- channel/map/09 文档与 v1.1 一致；policy/waiters 旧语义无回归。
- SDK 仍锁 0.3.210；smoke/package/gateway/其它 bridge/UI/CSS 均无本卡内容 diff。

唯一两个 Minor 均已闭环：
- 原报告只列四文件定向结果、未同时解释 PinnedPlan 补充复跑；已在 §4 GREEN 补齐 5 files / 69 tests 证据。
- 09 文档冻结纪律编号误写为 `5,6,7,6`；已将最后一项机械修正为 `8`，契约语义不变。

### 主控迁入父工作区后的独立复跑

迁入前确认 10 个目标 tracked 文件在父工作区均无并行修改；迁入后 11 个交付文件逐一 SHA-256 对比执行 worktree，内容完全一致，并再次通过 `git diff --check`。

```powershell
npm test -- tests/bridge/contract.test.ts tests/bridge/interact.test.ts src/renderer/stores/conversations.test.ts src/renderer/bridge/fixture-client.test.ts src/renderer/components/PinnedPlan.test.tsx
# 5 files / 69 tests passed

npm test
# 41 files / 298 tests passed

npm run typecheck
# tsc -p tsconfig.vendor.json && tsc -p tsconfig.json && tsc -p tsconfig.renderer.json
# exit 0

git diff --check
# exit 0
```

最终边界复核：package/lockfile 无 diff；smoke 无 diff；`src/bridge` 除 `contract.ts`/`interact.ts` 外无 diff。**Batch -1 验收结论：PASS。**

## 8. Concerns

- `smoke/bridge-live.mjs:227` 仍以旧三参顺序调用 `createApprovalBroker(transportA, persistenceA, policy)`。这是 brief 明确列出的、刻意不兼容的 `.mjs` live smoke call site；该路径不参与 typecheck，且本卡禁止修改/运行 smoke。后续若要恢复 live smoke，必须另立专项卡。
- `conversations.ts` 仍是本卡要求的单对话 store：foreign envelope no-op 是临时兼容边界，不包含 Batch 0 的 timelines/runIds maps 或统一订阅装配。
