# 第七批 Batch 0b / 卡 B1 简报：approvals + context-usage stores

> 唯一规格：`docs/specs/10-前端完整形态设计-v1.0.md` §1.3.0、§1.3.2、§1.3.4、§1.4、§1.5、§四 Batch 0b 卡B1。
> 执行模型：**Claude Sonnet 5**（规格写死的纯 TDD store 卡）。
> 前置：Batch -1 + Batch 0a 已独立复审 PASS；父工作区基线 **41 files / 306 tests**、三段 typecheck 绿。
> 本卡只建 store 数据面/纯 reducer/action；订阅统一装配、React context hooks、TurnBlock 卡片渲染均留给 0c/Batch 1。

## Global Constraints

- **严格 TDD**：先写行为测试并保存 RED，再实现；不能只断言字段存在。
- 执行者≠验收者；执行完只交 diff/report，由独立 Opus 4.8 复审。
- 新 store 不得自行 `client.subscribe`。所有事件入口写成可单测纯函数，Batch 0c 由唯一 `wireBridgeSubscriptions` 调用。
- store action 只经注入的 `BridgeClient` invoke；不得 import `FixtureBridgeClient`，不得直连 Electron/SDK。
- 不改已冻结 `src/bridge/**`、`tests/bridge/**`、09 契约、`message-model.ts` / `applyEvent`。
- 不把 key/secret 放进 state、fixture、测试或报告；SDK 继续锁 `0.3.210`。
- 不升级依赖，不改 package/lockfile/tsconfig/vitest/smoke/gateway/vendor。
- 不 commit、不 push；不得 reset/clean/stash/覆盖父工作区。

## 一、`approvals.ts` 目标契约

新建 `src/renderer/stores/approvals.ts`，复用契约导出的 `RiskLevel`、`ApprovalTier`、`AskUserQuestion`、`AskUserAnswerItem`、`WhitelistEntry`、`ApprovalRequest`、`AskUserPayload`，不得本地复制定义。

```ts
export type PendingInteraction =
  | { kind: "approval"; id: string; conversationId: string; runId: string;
      toolName: string; inputSummary: string; risk: RiskLevel; receivedAt: number }
  | { kind: "question"; id: string; conversationId: string; runId: string;
      questions: AskUserQuestion[]; receivedAt: number };

export type ResolvedInteraction =
  | { kind: "approval"; id: string; runId: string; toolName: string; inputSummary: string;
      risk: RiskLevel; outcome: ApprovalTier | "cancelled" }
  | { kind: "question"; id: string; runId: string; questions: AskUserQuestion[];
      items: AskUserAnswerItem[] | null };

export interface ApprovalsState {
  pendingByConversation: Record<string, PendingInteraction | null>;
  resolvedByRun: Record<string, ResolvedInteraction[]>;
  whitelist: WhitelistEntry[];
  decide(id: string, decision: ApprovalTier, message?: string): Promise<void>;
  answer(id: string, items: AskUserAnswerItem[]): Promise<void>;
  cancelForConversation(conversationId: string): void;
  refreshWhitelist(): Promise<void>;
  revokeWhitelistEntry(entry: { toolName: string; risk: RiskLevel }): Promise<void>;
}
```

工厂：

```ts
export interface ApprovalsStoreDeps {
  now?: () => number;
  notifyError?: (message: string) => void;
}

createApprovalsStore(client: BridgeClient, deps?: ApprovalsStoreDeps): StoreApi<ApprovalsState>
```

`notifyError` 是 0b→0c 的显式 seam：本卡测试回滚时注入 spy；0c 将它接到 notifications store。通用 store 不得 import notifications store。

### 1. 纯事件 reducer

导出可单测纯函数（命名可等价），供 0c 调用：

- approval request + `runId` + `receivedAt` → 目标 cid 的 pending approval。
- ask-user payload + `runId` + `receivedAt` → 目标 cid 的 pending question。
- reducer 不读 activeId、不读 client、不读 module global；cid 直接来自 payload，runId 由 0c 从 `conversations.runIds[cid]` 反查后传入。
- `PendingInteraction.runId` 必填；若 0c 收到 approval/ask 时 `runIds[cid]===null/undefined`，B1 reducer 不猜占位值。0c 必须在自己的 brief/测试里明确“丢弃延迟事件或采用由 renderer 已知时序保证的非空值”，禁止读 activeId、禁止让 Bridge 造 runId。
- 每对话至多一张挂起卡。收到第二张时，新卡顶替旧卡；旧卡必须搬到其 `resolvedByRun[old.runId]` 并记 cancelled（approval=`outcome:"cancelled"`；question=`items:null`），不能静默丢弃。
- 不修改其它 conversation pending，也不修改其它 run 的 resolved 数组。
- 输入对象/既有 state 不可原地 mutate。

### 2. `decide` / `answer` 乐观迁移与回滚

共同规则：

1. 按 `id` 在全部 pending 槽中精确查找，并校验 interaction `kind`：`decide` 只能命中 approval、`answer` 只能命中 question；找不到或 kind 错配即 no-op resolve（停止/回答赛跑时不抛、不 invoke、状态不变）。
2. invoke 前立即把挂起卡移入 `resolvedByRun[runId]` 并清该 cid pending，防双击。
3. approval outcome=传入 `ApprovalTier`；question items=传入答案数组。
4. invoke payload 必须逐字符合冻结契约：`bridge:approvalDecision` / `bridge:askUserAnswer`，不得添加 conversationId/runId 等未定义字段。
5. invoke reject：移除本次 optimistic resolved 项；只有当前槽仍允许恢复该 in-flight 原卡时才恢复。若期间已有更新 pending，或已被 `cancelForConversation` 抢先清空/归档，绝不能复活旧卡或覆盖新卡。调用 `notifyError` 一次并向调用者 reject；传给 UI 的消息使用固定安全文案，不得原样展示未知 Bridge 错误，更不得泄露 key/secret。
6. invoke 成功：保留 resolved 审计卡，不删除。

### 3. 中断/错误取消

`cancelForConversation(cid)`：

- pending 为空/未知 cid → no-op。
- 有 pending → 搬到对应 run 的 resolved，approval outcome cancelled / question items null，清 pending。
- 保留已存在 resolved 项与其它 cid；重复调用幂等。

### 4. whitelist

- 初始 `whitelist=[]`。
- `refreshWhitelist()` 调 `client.invoke("bridge:listWhitelist", undefined)`，成功后原子替换镜像；失败保留旧列表并 reject。
- `revokeWhitelistEntry(entry)` 按冻结双键 `{toolName,risk}` 调 `bridge:revokeWhitelist`；成功后再 refresh，最终以 Bridge 返回列表为真相。
- revoke 失败不得先从本地乐观粗删；不得按 toolName 单键删除；不得加入 conversationId。

## 二、`context-usage.ts` 目标契约

新建 `src/renderer/stores/context-usage.ts`：

```ts
export const CONTEXT_COMPACT_THRESHOLD = 21_000;

export interface ConversationContextUsage {
  currentTokens: number;
  justCompacted: boolean;
}

export interface ContextUsageState {
  byConversation: Record<string, ConversationContextUsage>;
}
```

导出：

```ts
foldContextUsage(
  prev: ContextUsageState,
  event: LeemoEvent,
  conversationId: string,
): ContextUsageState // 或等价 Partial patch，但必须纯函数

createContextUsageStore(): StoreApi<ContextUsageState>
```

纯派生规则：

- `usage.final`：`currentTokens = inputTokens + cacheReadTokens + cacheCreationTokens`；`justCompacted` 保留该 cid 之前值（没有则 false）。outputTokens 不计入 prompt 规模。
- `compact.boundary`：`currentTokens = postTokens ?? preTokens`，`justCompacted=true`。
- 其它事件：语义 no-op；不得创建无意义 cid 条目。
- 只更新目标 cid，保持其它 cid 引用/值；不得读 activeId。
- 阈值是 Phase 0 实测估算基线，不宣称 SDK 权威上限；不得从 SDK 导入隐藏常量。
- 圆环 `min(1,current/threshold)` 是未来 UI selector 逻辑，本卡不建组件/CSS/timer。
- `justCompacted` 的 600ms 自清是 ContextRing/UI 生命周期；B1 不私设 timer。报告 concerns 必须点名：0c/Batch 2a 需提供安全清除入口（显式 store action 或由持有 StoreApi 的 composition 层 setState），避免组件无正式迁移路径。

## 三、允许文件

- `src/renderer/stores/approvals.ts`（新建）
- `src/renderer/stores/approvals.test.ts`（新建）
- `src/renderer/stores/context-usage.ts`（新建）
- `src/renderer/stores/context-usage.test.ts`（新建）
- `docs/sdd/fe-b0b1-approvals-context-report.md`（新建）

不得因测试方便修改 `context.tsx`、conversations、notifications、fixture-client 或任何组件；0c 会做单点装配。

## 四、严格 TDD 矩阵

### approvals

1. 真空初态：pending/resolved/whitelist 均空。
2. approval/question fold 精确使用 payload cid + 外部 runId；不依赖 activeId。
3. 第二张同 cid 顶替并取消第一张；不同 cid 相互隔离。
4. decide/answer 在 invoke 前已灰化；成功后保留 resolved；kind 错配（question→decide / approval→answer）零 invoke、状态不变。
5. decide/answer reject 回滚原 pending、移除本次 optimistic 项、notifyError 一次；不覆盖期间更新的新 pending，也不复活期间已被 cancel 的旧卡；安全通知不含原始 secret-bearing error 文本。
6. cancel approval/question 分别产 cancelled 形状；空槽/重复取消幂等。
7. 回答与停止赛跑：id 已不存在时零 invoke、零异常。
8. refresh whitelist 成功替换；失败保留旧值。
9. revoke 精确双键 payload，成功后 refresh；revoke 失败不本地删。
10. 所有 reducer 不 mutate 输入。

### context usage

1. 初态空。
2. usage.final 三项输入/cache 求和，不加 output。
3. compact 用 postTokens，缺省退 preTokens（`postTokens=0` 仍必须保留 0，不能用 `||`），并置 justCompacted。
4. A/B cid 隔离；未知事件不创建条目。
5. 导出阈值精确 21_000。

## 五、执行步骤与基线恢复

1. 隔离 worktree 若在陈旧祖先：先证明 `git merge-base --is-ancestor HEAD 28921be`，且无内容 diff，再 `git merge --ff-only 28921be`；不得 reset/stash。
2. `git apply --check E:/Leemo/.claude/batch0a-reviewed.patch` 后正向应用；跑 `npm test -- --run`，必须复现 41 files / 306 tests。
3. 先写测试并保存 RED（失败测试名/关键报错/数量）。
4. 最小实现至 GREEN；不接订阅/context/UI。
5. 定向→全量→三段 typecheck→diff check；核禁改面；写报告。不 commit/push。

## 六、验收命令

```powershell
npm test -- src/renderer/stores/approvals.test.ts src/renderer/stores/context-usage.test.ts
npm test -- --run
npm run typecheck
git diff --check
git diff --stat
```

最终全量测试不得低于 306，现有 conversations/message-model/Bridge 测试必须继续绿。

## 七、报告

写 `docs/sdd/fe-b0b1-approvals-context-report.md`：

1. BASE、reviewed patch 应用与 306 基线。
2. RED/GREEN 真实命令和计数。
3. 两种 interaction 的 pending→resolved/cancelled/rollback 逐拍证据。
4. 第二张顶替、停止赛跑、回滚不覆盖新 pending 的证据。
5. whitelist 双键与 refresh 证据。
6. context usage 公式、compact 与 A/B 隔离证据。
7. 实际文件/禁改面与 0c 接缝；concerns 精确到 file:line。
