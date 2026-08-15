# Batch 0a · conversations 多对话注册表重构执行报告

日期：2026-07-23
执行范围：仅 Batch 0a（未实现 0b / 0c / 0d）

## 1. 基线与 Batch -1 应用证据

- 隔离 worktree 初始 HEAD 为 `2ce18e5df1124b1c60ef73c1235b13b030fc5d60`。
- 已执行 `git merge-base --is-ancestor HEAD 28921be`（exit 0），随后 `git merge --ff-only 28921be`；结果为 `28921be`，无 merge commit。
- 已先执行 `git apply --check`，再应用主控给定的 `fe-bm1-reviewed.patch`。该 patch 的 10 个文件仅包含 Batch -1 冻结契约及其最小消费者适配。
- 应用 patch 后、写入 Batch 0a 前执行 `npm test -- --run`：**41 files / 298 tests passed**。

## 2. 旧 → 新状态、action、selector 对照

| 旧单对话面 | Batch 0a 多对话面 |
|---|---|
| `activeId: "conv-1"` | `activeId: string \| null`，真实空态为 `null` |
| `messages: TimelineItem[]` | `timelines: Record<conversationId, TimelineItem[]>` |
| `activeRunId: string \| null` | `runIds: Record<conversationId, string \| null>` |
| 无 conversation metadata / order / tabs | `byId`、新到旧 `order`、至多五项 `openTabs` |
| `send(text)` / `interrupt()` 隐式读 active id | `send(conversationId, text)` / `interrupt(conversationId)` 显式路由；未知 id fail-fast |
| subscriber activeId filter + store-global run id | `foldConversationEnvelope(state, envelope, now)` 从 `envelope.conversationId` 取得该 cid timeline 与 run id |
| Buddy / Timeline / PinnedPlan 读取顶层字段 | 三者只读取 active cid 对应 `timelines` / `runIds` |

`createConversation` 每次调用 `resolveConversationDefaults()`，成功 IPC 后才一次性注册 meta、空 timeline、null run、order 与 active id。通用 store 未导入 fixture、未硬编码 provider/model/`conv-1`；composition 层才以现有 fixture provider 提供临时 resolver。

## 3. A/B 并发逐拍证据

定向 store 测试覆盖并通过以下实际序列：

1. 创建 A、B；先 `send(A)` 再 `send(B)`，产生不同 renderer-local `run-*`。
2. 将 active 切到 B 后交错发出 A / B `text.delta` 信封。
3. A delta 仅进入 `timelines[A]`，B delta 仅进入 `timelines[B]`；active B 不影响后台 A 的折入。
4. A `run.finished` 调 `applyEvent(..., oldRunId)` 后 result 保留 A 的旧 run id；仅 `runIds[A]` 清空，`runIds[B]` 仍运行。
5. 非 active 的 A 完成后 `byId[A].unread=true`；`switchActive(A)` 清除未读且无 IPC。

同一测试还直接调用导出的纯 `foldConversationEnvelope`，证明路由不读取 active id；未知 cid 返回空 patch，不创建 meta/timeline/run。

## 4. 首次发送与去重证据

- Buddy 首次 Enter 的组件测试断言 IPC 顺序为：
  1. `bridge:createConversation { providerId:"deepseek", modelId:"deepseek-chat", purpose:"main" }`
  2. `bridge:send { conversationId:"conv-1", prompt:"在吗" }`
- 首次创建期间两次快速提交共享一个 `useRef<Promise<string> | null>`；测试验证仅一次 create、随后两次 send 都路由到同一 cid。
- 初始渲染仍显示 momo greeting；成功首发后用户 bubble 与回复 bubble 都存在。

## 5. 临时 defaults seam

`createConversationsStore(client, deps)` 接收动态 `resolveConversationDefaults()`，不在 factory 时缓存结果。它让 Batch 0b 只需将 `src/renderer/bridge/context.tsx` 的 fixture resolver 替换成 settings/providers 的实时 resolver，无需改变 ConversationsState 或 action 形状。

## 6. direct subscription 临时边界

本批仍故意保留且只保留一处 `client.subscribe("bridge:event")`。回调只有：

```ts
store.setState((state) => foldConversationEnvelope(state, envelope, now()));
```

事件到状态的逻辑已经抽为纯函数。Batch 0c 必须原子迁出此订阅、添加 cleanup 并复用该 reducer；本批没有新建 `wireBridgeSubscriptions` 或第二条订阅。

## 7. TDD 与验证证据

### RED（实现前已保存）

```powershell
npm test -- src/renderer/stores/conversations.test.ts src/renderer/components/BuddyShell.test.tsx src/renderer/components/PinnedPlan.test.tsx
```

结果：3 files failed，14 tests failed / 3 passed。核心 RED 证据为旧 store 不存在 `createConversation`，以及旧 Buddy 路径仅直接 `bridge:send`，不能满足 create→send 顺序；这证明测试断言的是新行为而非字段存在。

### GREEN

```powershell
npm test -- src/renderer/stores/conversations.test.ts src/renderer/components/BuddyShell.test.tsx src/renderer/components/PinnedPlan.test.tsx src/renderer/components/timeline/timeline-groups.test.tsx src/renderer/app/App.test.tsx
```

结果：**5 files / 20 tests passed**。

```powershell
npm test -- --run
```

结果：**41 files / 306 tests passed**（高于 298 baseline；包含 message-model 测试）。

```powershell
npm run typecheck
```

结果：通过，依次完成 `tsconfig.vendor.json`、`tsconfig.json`、`tsconfig.renderer.json` 三段检查。

```powershell
git diff --check
```

结果：通过，无 whitespace error。

## 8. 实际文件与禁改自查

### Batch 0a 实际修改 / 新建

- `src/renderer/stores/conversations.ts`
- `src/renderer/stores/conversations.test.ts`
- `src/renderer/components/BuddyShell.tsx`
- `src/renderer/components/BuddyShell.test.tsx`
- `src/renderer/components/timeline/Timeline.tsx`
- `src/renderer/components/timeline/timeline-groups.test.tsx`
- `src/renderer/components/PinnedPlan.tsx`
- `src/renderer/components/PinnedPlan.test.tsx`
- `src/renderer/bridge/context.tsx`
- `docs/sdd/fe-b0a-conversations-report.md`（本报告）

本 worktree 的总 diff 另含已要求应用的 Batch -1 patch 文件：`src/bridge/contract.ts`、`src/bridge/interact.ts`、fixture-client 及其测试、Bridge 契约文档和 Bridge 测试。它们不是本批的新增修改。

本批未修改 `message-model.ts` / `applyEvent`、fixture-client、HistoryDrawer、InputBox、其它 stores、Bridge 契约/实现、package/lockfile、tsconfig、Vitest、smoke 或 gateway/vendor；未 commit / push。

## 9. 精确后续关注点

- `src/renderer/stores/conversations.ts:237-239`：临时 direct subscription 尚无 unsubscribe/cleanup；Batch 0c 必须将其原子迁至共享 subscription composition。
- `src/renderer/bridge/context.tsx:22-27`：resolver 当前读取 fixture composition；Batch 0b 落 settings/providers 后只替换这一来源，不能把 fixture import 倒灌进通用 store。
- 最后 `git diff --name-only` 的总 tracked 名称共 16 项：其中 10 项属于按要求预应用的 Batch -1 patch；Batch 0a 实际修改的是 §8 列出的 **9 个独立 tracked 路径**，其中 3 个（`conversations.ts`、`conversations.test.ts`、`PinnedPlan.test.tsx`）与 Batch -1 的路径重叠，因此不能用“总脏路径数减 10”得出本卡文件数。本报告为唯一新增未跟踪文件。`git status --short` 额外显示 `tests/gateway/__snapshots__/pitfall-12-sse-statemachine.test.ts.snap` 为 worktree modified，但 `git diff --numstat`/`--raw` 都无内容或 blob 差异；本批未触碰该禁改 gateway snapshot，未 reset/clean 它。

## 10. 独立复审与父工作区验收

### 独立 Opus 4.8 复审

结论：**PASS，无 Critical / Important finding**。

复审者逐项反证了 A/B 并发精确路由、`run.finished` 使用旧 runId 后仅清目标对话、首次创建去重、tabs 左/右邻语义、unknown cid fail-fast、message-model/applyEvent 冻结边界和 0c 临时 direct subscription 边界。唯一 Minor 是原报告将 9 个 0a 独立路径误写成 6 个 tracked 路径；已按 §9 修正为“9 个独立路径，其中 3 个与 Batch -1 重叠”。

### 主控迁入父工作区后的复跑

父工作区已精确包含 §8 的 9 个 tracked 路径与本报告；未迁入 gateway snapshot 或其它 worktree 脏项。

```powershell
npm test -- src/renderer/stores/conversations.test.ts src/renderer/components/BuddyShell.test.tsx src/renderer/components/PinnedPlan.test.tsx src/renderer/components/timeline/timeline-groups.test.tsx src/renderer/app/App.test.tsx
# 5 files / 20 tests passed

npm test -- --run
# 41 files / 306 tests passed

npm run typecheck
# tsc -p tsconfig.vendor.json && tsc -p tsconfig.json && tsc -p tsconfig.renderer.json
# exit 0

git diff --check
# exit 0
```

最终边界复核：`message-model.ts` / `applyEvent`、fixture-client、HistoryDrawer、InputBox、其它 stores、Bridge 冻结契约、package/lockfile、tsconfig、smoke、gateway/vendor 均无 Batch 0a 新增 diff。**Batch 0a 验收结论：PASS。**
