# 第七批 Batch 0d 简报：FixtureBridgeClient 多会话与回投演示扩展

> 唯一规格：`docs/specs/10-前端完整形态设计-v1.0.md` §1.3.0、§1.3.11、§1.4、§1.5、§四 Batch 0d；Batch -1/0a 当前契约与事件形状为唯一类型真相。
> 执行模型：**Claude Sonnet 5**（规格写死的 fixture/TDD 卡）。
> 前置：Batch -1 + Batch 0a 已独立复审 PASS；父工作区基线 **41 files / 306 tests**、三段 typecheck 绿。
> 本卡可与 0b 并行；不得等待/修改 B1/B2/B3 文件，只实现 fixture 运输与 demo 数据面。

## Global Constraints

- 严格 TDD：先写 fixture 行为测试保存 RED，再实现；测试真实观察 events/invoke，不只查字段。
- 不 commit/push，不清理/覆盖父工作区；不改 smoke/、Bridge 契约/实现、conversations、任何新 store。
- `FixtureBridgeClient` 是 BridgeClient 端口实现；事件必须仍是 `{conversationId,event}`，approval/ask payload 必须携 `conversationId`，不能把 runId 加入 Bridge payload。
- 不在 fixture 写任何 key/secret。示例 `inputSummary` 只使用安全的假命令/描述，不放真实凭据。
- 逐 case 显式支持契约 invoke；禁止用 default 把未知 channel 静默返回 undefined（对已存在未实现/Phase-1 reserved channel，按测试钉死“显式拒绝/显式空结果”的可观察行为）。
- 不改 `message-model`、`conversations` 或组件；0c 负责统一订阅，fixture 只产出可路由 payload。

## 一、fixture 数据与多会话隔离

允许修改：

- `src/renderer/bridge/fixture-client.ts`
- `src/renderer/bridge/fixture-client.test.ts`
- `src/renderer/bridge/fixtures/index.ts`（必要时新建同目录数据文件）
- `docs/sdd/fe-b0d-fixture-report.md`

### 1. Conversation IDs / lifecycle

- `bridge:createConversation` 每次成功返回唯一 renderer fixture cid（如 `conv-1`, `conv-2`），不得永返 conv-1；可按 request `purpose` 记录 main/wiki，不能把 wiki 自动发给 conversations store。
- `bridge:send` 精确使用 request cid；未创建/已 disposed cid 的行为必须显式且稳定（建议 reject，不发 phantom event）；invoke 请求原样不含 secret。
- 每 cid 维护 started/session、pending timer handles、disposed/running 状态；A/B 同时 send 的 timers、events、interrupt 互不取消/污染。
- `conversation.started` 每个 cid 最多一次（或有明确每-run 规则并测试），事件信封 cid 精确。
- `bridge:interrupt({conversationId})` 只取消目标 cid pending timers 并发一个 `{type:"run.finished", subtype:"interrupted", ...}`；不能清 B；重复 interrupt 幂等，不多发 finished。
- `bridge:disposeConversation` 只释放目标 cid，后续目标 send 显式失败；dispose 不清其它 cid。

### 2. Demo turn 内容

在现有 `DEMO_TURN_EVENTS` 基础上扩展一条完整、可观测但无密钥的 demo：

- 维持已有 text/thinking/plan/tool/subagent/compact/usage/result 回合，不破坏 slice-2 现有测试。
- 至少一次 `bridge:approvalRequest` 与一次 `bridge:askUser`，payload 必须含 id、目标 conversationId、合法 toolName/inputSummary/risk 或 questions；只在一个明确 demo request/脚本阶段发送，不能每个事件重复注入。
- 回投演示：收到 `bridge:approvalDecision` 后，对匹配 request id/cid 只延迟约 300ms 续发剩余 demo tail；收到 `bridge:askUserAnswer` 同理。未匹配/重复回复必须显式 no-op/reject，不把 tail 发到其它 cid。
- 至少一次可视化 tool event，工具名使用 10号裁决常量；input/finished 形状必须能被 `deriveArtifact` 识别。若 B2 尚未落地，fixture 只保证事件契约，不 import B2 store。
- approval/ask 请求应让初始 demo 在卡片处暂停，避免同时把后续 tail 发完；custom `reply` 模式可保持简单 text stream，但应有明确是否注入交互卡的测试/报告。

### 3. 显式 invoke cases

`invoke` 必须对当前 `BridgeInvokeMap` 每个 channel 有显式 `case`，至少包括：

- `bridge:createConversation`：唯一 cid。
- `bridge:send`：校验/调度目标 cid。
- `bridge:interrupt`：单 cid 取消。
- `bridge:setModel`：目标 cid 存在时显式成功并记录/更新 fixture metadata；未知 cid 显式失败。
- `bridge:disposeConversation`：释放单 cid。
- `bridge:listProviders`：返回无 key `FIXTURE_PROVIDERS`。
- `bridge:fetchBalance`：使用 provider capability fixture；不做真实网络，返回安全的假 BalanceInfo 或显式 unsupported。
- `bridge:usageSummary`：Phase-1 reserved，显式返回安全空 summary（或按现有契约统一 reject，必须有测试，禁止 default 假成功）。
- `bridge:listWhitelist`：返回 fixture whitelist 的副本。
- `bridge:revokeWhitelist`：仅精确删除 `(toolName,risk)`，不按 toolName 粗删；未知双键显式幂等/拒绝并测试。
- `bridge:approvalDecision` / `bridge:askUserAnswer`：严格按 id/cid waiter 处理，触发延迟 tail；错 kind/未知 id 不串台。

无论采用 reject 还是安全空响应，必须保持返回类型与测试一致，报告列出所有 case；不得依赖 default。

## 二、允许/禁改面

允许仅：fixture-client、fixture data/index、其测试、此报告。若 typecheck 因 fixture test fake 直接受影响，只在同一测试文件做最小适配并报告；不得改 context/conversations/stores/组件。

## 三、严格 TDD 矩阵

1. create A/B 返回不同 cid，purpose 记录但不泄露；send A/B 交错，events envelope cid 精确。
2. A interrupt 不取消 B；A/B 各自 run.finished；重复 interrupt/dispose 行为幂等。
3. unknown/disposed cid send/interrupt/setModel 有稳定错误/零事件；不存在 phantom state。
4. 每 cid started/session 生命周期隔离；custom reply 保持既有测试。
5. demo 显式包含 approval、ask、visualization/tool、compact、usage；请求 payload cid 与安全字段正确。
6. approvalDecision/askUserAnswer 精确匹配后延迟续流；未知/错 kind/重复回复零串台。
7. listWhitelist/revokeWhitelist 显式 case，双键删除；其它 entry 保留。
8. listProviders/fetchBalance/usageSummary/setModel/dispose 每个 case 都有测试；默认分支不静默吞未知 channel（类型已穷尽时保留 unreachable guard 也不能掩盖合法 case）。
9. unsubscribe 停止所有目标事件；timer cleanup 不泄漏跨测试。

## 四、执行/验收

先在 clean 28921be worktree 应用 `E:\Leemo\.claude\batch0a-reviewed.patch`，复现 41/306；严格 RED→GREEN：

```powershell
npm test -- src/renderer/bridge/fixture-client.test.ts
npm test -- --run
npm run typecheck
git diff --check
git diff --stat
```

全量不得低于 306；完成后交独立 Opus 4.8 复审。0d 通过后仍须等 0b 三卡完成，才派 0c。
