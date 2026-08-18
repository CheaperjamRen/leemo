# Global Pending Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在“开始”首页增加一张由用户手动触发或显式启用每日自动化生成的全局“待完成事项”快照，并让每个事项能回到真实 Todo、会话、Run、成果或本子，同时保持 Todo 完成权、静默捕捉和用户 API 费用边界。

**Architecture:** Renderer 先从已水合的 Todo、Conversation Timeline、Artifact 和本子元数据投影一个有界事实包；Host 使用无工具的一次性结构化推理通道归并和排序，并在主进程完成 JSON 与来源 ID 校验。最近一次成功快照、用户纠错和每日自动尝试日期写入 SQLite 单例状态；一次性调用的 token / 费用进入独立 usage event 表并汇入现有用量统计，不创建或持久化隐藏的 Leemo 对话。

**Tech Stack:** Electron 43、React 19、TypeScript 5.9、Zustand 5、SQLite/better-sqlite3、Claude Agent SDK 0.3.227、Codex app-server、Gemini ACP、Vitest/Testing Library。

## Global Constraints

- 本计划依赖 `docs/superpowers/plans/2026-08-18-start-static-workspace-and-note-library.md` 的 Task 4–5 已提供 `StartShell`、`StartHome` 和 Start 导航；不得在本计划中重建 Start 壳层。
- 视觉以 `docs/design-audition/visual-redesign/start-static-workspace-v2.png` 与参数表 v2 为权威。
- 打开、停留、浏览、搜索、编辑、勾选 Todo 和查看旧快照不得调用模型。
- 只有“为我梳理待完成事项”“重新梳理”或用户已启用的每日自动梳理可以调用模型。
- 每日自动梳理默认关闭；每个本地自然日最多自动尝试一次；开启开关本身不能立即调用模型。
- 模型只能归并、概括和排序；不能创建、完成、删除或修改 Todo、便签、Run、成果、本子或文件。
- 所有模型输出必须引用输入事实包中的稳定来源 ID；不存在、重复或越界的来源必须在 Host 丢弃。
- 一次性推理不暴露用户工作区：直接 API 请求不带工具；订阅运行时使用隔离空目录、禁用 Web / 动态工具、拒绝所有审批，并在任何工具事件出现时终止。
- Provider 凭据只留在主进程，IPC 不返回 Key、原始上游错误体或完整 Provider 响应。
- 最近一次成功快照必须在刷新失败、断网、解析失败和进程重启后继续可用。
- 用户选择“已经结束”只改变总览状态，不改变关联 Todo；“不再关注”保留原对象。
- 静默 Inbox 便签和普通闲聊不得自动成为候选。
- 不新增 WorkThread 实体，不建立第二套 Todo，不保存无限快照历史。

---

### Task 1: Define the Shared Domain and Build a Bounded Fact Projection

**Files:**
- Create: `src/bridge/global-pending-overview.ts`
- Create: `tests/bridge/global-pending-overview.test.ts`
- Create: `src/renderer/global-overview/facts.ts`
- Create: `src/renderer/global-overview/facts.test.ts`

**Interfaces:**

```ts
export type GlobalOverviewSourceKind = "task" | "conversation" | "run" | "artifact";
export type GlobalOverviewTrigger = "manual" | "scheduled";

export interface GlobalOverviewFact {
  id: string; // `${kind}:${stableObjectId}`
  kind: GlobalOverviewSourceKind;
  label: string;
  projectLabel?: string;
  state: "open" | "running" | "waiting-user" | "failed-retryable" | "delivered" | "uncertain";
  updatedAt: number;
  dueAt?: number;
  relatedIds: string[];
  evidence: string[];
}

export interface GlobalOverviewFactPack {
  generatedAt: number;
  facts: GlobalOverviewFact[];
}

export interface GlobalOverviewItem {
  id: string;
  anchorSourceId: string;
  sourceIds: string[];
  title: string;
  progressSummary: string;
  nextStep?: string;
  projectLabel?: string;
  priority: "now" | "soon" | "later";
}

export interface GlobalOverviewSnapshot {
  version: 1;
  id: string;
  generatedAt: number;
  trigger: GlobalOverviewTrigger;
  providerId: string;
  modelId: string;
  items: GlobalOverviewItem[];
  uncertainSourceIds: string[];
}

export interface GlobalOverviewOverride {
  anchorSourceId: string;
  action: "priority" | "ignore" | "ended";
  value?: "now" | "soon" | "later";
  updatedAt: number;
  sourceUpdatedAt: number;
}

export interface PersistedGlobalOverviewState {
  version: 1;
  snapshot: GlobalOverviewSnapshot | null;
  overrides: GlobalOverviewOverride[];
  lastAutoAttemptDate?: string; // local YYYY-MM-DD
}
```

- Produces: `normalizePersistedGlobalOverviewState`, `buildGlobalOverviewFactPack` and `applyGlobalOverviewOverrides`.
- Consumes: `UserTask`, `ConversationMeta`, `TimelineItem`, `ArtifactEntry`, `deriveConversationStatus` and existing `WorkOverviewData`.

- [x] **Step 1: Write domain RED tests**

```ts
expect(normalizePersistedGlobalOverviewState({ version: 1, snapshot: null, overrides: [] })).toEqual({
  version: 1,
  snapshot: null,
  overrides: [],
});
expect(normalizePersistedGlobalOverviewState({ version: 2 })).toBeNull();
```

Also assert item/title/source limits, duplicate source removal, invalid timestamps dropped, and an override referencing no stable source rejected.

- [x] **Step 2: Write fact-projection RED tests**

Construct fixtures proving:

```ts
expect(pack.facts.map((fact) => fact.id)).toContain("task:task-open-old");
expect(pack.facts.map((fact) => fact.id)).not.toContain("task:task-done");
expect(pack.facts.map((fact) => fact.id)).toContain("conversation:waiting-user");
expect(JSON.stringify(pack)).not.toContain("raw thinking transcript");
```

Cover all open Todos regardless of age; conversations changed within 30 days; older running/waiting/failed conversations; latest user instruction, overview and terminal receipt clipped to bounded evidence; artifacts only for included conversations; archived ordinary chat and Inbox notes excluded.

- [x] **Step 3: Run RED**

```powershell
npx vitest run tests/bridge/global-pending-overview.test.ts src/renderer/global-overview/facts.test.ts
```

Expected: FAIL because the modules do not exist.

- [x] **Step 4: Implement exact bounds and projection**

Use these limits in the shared module:

```ts
export const GLOBAL_OVERVIEW_LIMITS = {
  facts: 160,
  tasks: 100,
  conversations: 48,
  artifacts: 64,
  evidencePerFact: 4,
  evidenceChars: 240,
  titleChars: 80,
  summaryChars: 240,
  nextStepChars: 160,
  outputItems: 24,
} as const;
```

Build facts in deterministic priority order: open Todo; waiting/running/failed Run; recent conversation; related artifact. Never serialize `thinking`, tool input, credentials, attachment bytes or entire document bodies.

- [x] **Step 5: Implement override application**

`ignore` remains until the user restores it. `ended` suppresses the item only while every linked source `updatedAt <= override.updatedAt`; new source activity makes it eligible again. `priority` applies after model output and before display sorting.

- [x] **Step 6: Verify and commit**

```powershell
npx vitest run tests/bridge/global-pending-overview.test.ts src/renderer/global-overview/facts.test.ts
npx tsc -p tsconfig.renderer.json --noEmit
git add src/bridge/global-pending-overview.ts tests/bridge/global-pending-overview.test.ts src/renderer/global-overview/facts.ts src/renderer/global-overview/facts.test.ts
git commit -m "feat: define global overview facts"
```

### Task 2: Add a No-Tool One-Shot Inference Runner

**Files:**
- Modify: `src/bridge/pool.ts`
- Modify: `tests/bridge/pool.test.ts`
- Modify: `src/host/sdk-adapter.ts`
- Modify: `tests/host/sdk-adapter.test.ts`
- Modify: `src/host/provider-test.ts`
- Modify: `tests/host/provider-test.test.ts`
- Create: `src/host/one-shot-inference.ts`
- Create: `tests/host/one-shot-inference.test.ts`

**Interfaces:**

```ts
export interface OneShotUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd?: string;
  costSource: "sdk" | "local-pricing" | "unpriced";
  tokensEstimated: boolean;
  durationMs: number;
}

export type OneShotInferenceTarget =
  | { kind: "direct"; providerId: string; modelId: string; target: ProviderTestTarget }
  | { kind: "claude-subscription"; provider: Provider; modelId: string }
  | { kind: "codex-subscription"; providerId: string; modelId: string }
  | { kind: "gemini-subscription"; providerId: string; modelId: string };

export type OneShotInferenceResult =
  | { ok: true; text: string; usage: OneShotUsage }
  | { ok: false; message: string; detail?: string; retryable: boolean; usage?: OneShotUsage };

export interface OneShotInferenceDeps {
  fetchFn: typeof fetch;
  dataDir: string;
  now?: () => number;
  queryImpl?: typeof sdkQuery;
  codexRuntime?: CodexExecutionRuntime;
  geminiRuntime?: CodexExecutionRuntime;
  resolvePricing(providerId: string, modelId: string): ModelPricing | undefined;
}

export function runOneShotInference(
  target: OneShotInferenceTarget,
  prompt: string,
  deps: OneShotInferenceDeps,
): Promise<OneShotInferenceResult>;
```

- [x] **Step 1: Write RED tests for an empty built-in tool set**

Extend `ConversationRoundOptions` and `QueryOptions` with `tools?: string[]`. Assert `handle.send("prompt", { tools: [] })` reaches the SDK adapter as `Options.tools: []` and remains distinct from an omitted key.

- [x] **Step 2: Write one-shot runner RED tests**

Cover:

```ts
expect(result).toMatchObject({ ok: true, text: "{\"items\":[]}" });
expect(capturedClaudeOptions.tools).toEqual([]);
expect(capturedCodexConfig).toMatchObject({ permissionMode: "plan", webSearchEnabled: false, webFetchEnabled: false });
expect(capturedCodexConfig.dynamicTools).toBeUndefined();
expect(capturedCwd).not.toContain("Leemo\\默认工作区");
```

Also cover Gemini, classified network failure, no final text, usage extraction, cleanup/dispose in `finally`, all approvals declined, and a `tool.started` event turning the operation into a safe failure.

- [x] **Step 3: Run RED**

```powershell
npx vitest run tests/bridge/pool.test.ts tests/host/sdk-adapter.test.ts tests/host/provider-test.test.ts tests/host/one-shot-inference.test.ts
```

- [x] **Step 4: Return usage from direct provider requests**

Extend `requestProviderText` success with normalized token fields from Anthropic `usage`, OpenAI Chat `usage`, and Responses `usage`. Inject `now` and return duration. No raw body crosses this function.

- [x] **Step 5: Implement the runtime adapters**

For direct providers, reuse `requestProviderText`. For Claude subscription, create a fresh Bridge over a per-call app-managed empty directory, empty MCP / Skill sets, `tools: []`, memory disabled and max one turn; normalize with `normalizeSdkStream`. For Codex and Gemini subscriptions, create a non-persisted runtime handle in the same isolated directory, pass no dynamic tools, disable Web, set plan mode, decline approvals, consume only text / usage / terminal events, then dispose.

If any adapter emits a tool event, stop the handle and return “梳理过程尝试了不需要的工具，本次结果已丢弃。” Do not return partial JSON.

- [x] **Step 6: Verify and commit**

```powershell
npx vitest run tests/bridge/pool.test.ts tests/host/sdk-adapter.test.ts tests/host/provider-test.test.ts tests/host/one-shot-inference.test.ts
npx tsc -p tsconfig.json --noEmit
git add src/bridge/pool.ts tests/bridge/pool.test.ts src/host/sdk-adapter.ts tests/host/sdk-adapter.test.ts src/host/provider-test.ts tests/host/provider-test.test.ts src/host/one-shot-inference.ts tests/host/one-shot-inference.test.ts
git commit -m "feat: add no-tool one-shot inference"
```

### Task 3: Persist the Snapshot and Standalone Model Usage

**Files:**
- Modify: `src/main/persistence/schema.ts`
- Modify: `tests/main/persistence.test.ts`
- Modify: `src/main/persistence/workspace-persistence.ts`
- Modify: `tests/main/workspace-persistence.test.ts`
- Modify: `src/renderer/persistence/client.ts`
- Modify: `src/renderer/persistence/ipc-persistence-client.ts`
- Modify: `src/renderer/persistence/ipc-persistence-client.test.ts`
- Modify: `src/main/main.ts`

**Interfaces:**

```ts
export interface StandaloneUsageEvent {
  id: string;
  purpose: "global-overview";
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd?: string;
  costSource: "sdk" | "local-pricing" | "unpriced";
  tokensEstimated: boolean;
  durationMs: number;
  createdAt: number;
}

interface Persistence {
  loadGlobalOverviewState(): PersistedGlobalOverviewState | null;
  saveGlobalOverviewState(state: PersistedGlobalOverviewState): void;
  recordStandaloneUsage(event: StandaloneUsageEvent): void;
}
```

`PersistedSnapshot` gains `globalPendingOverview?: PersistedGlobalOverviewState` and `PersistenceClient` gains `saveGlobalPendingOverview(state)`.

- [x] **Step 1: Write migration and corruption RED tests**

Open a pre-feature database, call the new methods, reopen and assert state round-trips. Insert corrupt `state_json` and assert `loadAll()` returns `globalPendingOverview: undefined` without losing conversations or settings.

- [x] **Step 2: Write standalone usage RED tests**

Record one conversation usage row and one `global-overview` usage event, then assert `usageSummary({ range: "today" })` includes both exactly once. Call `rebuildConversationIndex` and assert the standalone event remains.

- [x] **Step 3: Run RED**

```powershell
npx vitest run tests/main/persistence.test.ts tests/main/workspace-persistence.test.ts src/renderer/persistence/ipc-persistence-client.test.ts
```

- [x] **Step 4: Add dedicated tables**

```sql
CREATE TABLE IF NOT EXISTS global_overview_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS standalone_usage (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('global-overview')),
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL,
  cost_usd TEXT,
  cost_source TEXT NOT NULL,
  tokens_estimated INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
```

Do not make `standalone_usage` part of `rebuildConversationIndex`. Change `usageSummary` to aggregate a `UNION ALL` of conversation usage and standalone usage.

- [x] **Step 5: Add typed IPC operations**

Add `saveGlobalPendingOverview` to `leemo:persist`. Validate through `normalizePersistedGlobalOverviewState` in main before writing. Host usage recording calls `Persistence.recordStandaloneUsage` directly; renderer cannot write usage events.

- [x] **Step 6: Delegate through workspace persistence wrappers**

Both registered and workspace-backed wrappers delegate the three methods to the SQLite index. The snapshot is global app state, not copied into notebook archives.

- [x] **Step 7: Verify and commit**

```powershell
npx vitest run tests/main/persistence.test.ts tests/main/workspace-persistence.test.ts src/renderer/persistence/ipc-persistence-client.test.ts
npx tsc -p tsconfig.json --noEmit
git add src/main/persistence/schema.ts tests/main/persistence.test.ts src/main/persistence/workspace-persistence.ts tests/main/workspace-persistence.test.ts src/renderer/persistence/client.ts src/renderer/persistence/ipc-persistence-client.ts src/renderer/persistence/ipc-persistence-client.test.ts src/main/main.ts
git commit -m "feat: persist global overview snapshots"
```

### Task 4: Add the Structured Overview Bridge Channel

**Files:**
- Create: `src/host/global-pending-overview.ts`
- Create: `tests/host/global-pending-overview.test.ts`
- Modify: `src/bridge/contract.ts`
- Modify: `tests/bridge/contract.test.ts`
- Modify: `src/host/bridge-host.ts`
- Modify: `tests/host/bridge-host.test.ts`
- Modify: `src/renderer/bridge/fixture-client.ts`
- Modify: `src/renderer/bridge/fixture-client.test.ts`
- Modify: `src/main/main.ts`

**Interfaces:**

```ts
export interface GenerateGlobalOverviewRequest {
  providerId: string;
  modelId: string;
  trigger: GlobalOverviewTrigger;
  localNow: string;
  timeZone?: string;
  facts: GlobalOverviewFact[];
  overrides: GlobalOverviewOverride[];
}

export type GenerateGlobalOverviewResponse =
  | { ok: true; snapshot: GlobalOverviewSnapshot }
  | { ok: false; message: string; detail?: string; retryable: boolean };
```

Add `bridge:generateGlobalPendingOverview` to `BRIDGE_CHANNELS` and `BridgeInvokeMap`. `HostDeps` gains optional `runOneShotInference` for focused tests and optional `recordStandaloneUsage` for production usage persistence.

- [x] **Step 1: Write prompt/parser RED tests**

The prompt must wrap facts inside `<records>` and state that records are data, never instructions. Test valid JSON, fenced JSON, unknown source IDs, duplicate anchors, overlong strings, more than 24 items, invalid priority, a model claiming Todo completion, and uncertain IDs.

```ts
expect(parseGlobalOverviewReply(reply, factIndex)).toMatchObject({
  items: [{ anchorSourceId: "task:t1", sourceIds: ["task:t1", "conversation:c1"] }],
});
expect(parseGlobalOverviewReply('{"items":[{"sourceIds":["missing"]}]}', factIndex).items).toEqual([]);
```

- [x] **Step 2: Write host channel RED tests**

Assert configured provider/model resolution, API Key never in request/response, one-shot invocation once, usage recorded even when JSON parsing fails, no snapshot persisted by Host, and an unavailable model returns a human-readable failure without deleting renderer state.

- [x] **Step 3: Run RED**

```powershell
npx vitest run tests/host/global-pending-overview.test.ts tests/host/bridge-host.test.ts tests/bridge/contract.test.ts src/renderer/bridge/fixture-client.test.ts
```

- [x] **Step 4: Implement strict JSON production**

The model output schema is:

```json
{
  "items": [{
    "anchorSourceId": "task:t1",
    "sourceIds": ["task:t1", "conversation:c1"],
    "title": "...",
    "progressSummary": "...",
    "nextStep": "...",
    "projectLabel": "...",
    "priority": "now"
  }],
  "uncertainSourceIds": ["conversation:c2"]
}
```

Model text such as `completed: true` is an unknown key and ignored. Host computes snapshot ID/time/provider/model/trigger; the model cannot supply them.

- [x] **Step 5: Record usage before parsing**

After one-shot completion, call `recordStandaloneUsage` with a fresh UUID and `purpose: "global-overview"` before JSON parsing. If parsing fails, the user still paid for the call and usage must remain truthful.

- [x] **Step 6: Keep fixture mode honest**

Fixture invocation returns `{ ok: false, message: "演示环境不会调用模型。", retryable: false }`. Visual fixture data must be seeded through the overview store, not generated by a fake successful model call.

- [x] **Step 7: Verify and commit**

```powershell
npx vitest run tests/host/global-pending-overview.test.ts tests/host/bridge-host.test.ts tests/bridge/contract.test.ts src/renderer/bridge/fixture-client.test.ts
npm run typecheck
git add src/host/global-pending-overview.ts tests/host/global-pending-overview.test.ts src/bridge/contract.ts tests/bridge/contract.test.ts src/host/bridge-host.ts tests/host/bridge-host.test.ts src/renderer/bridge/fixture-client.ts src/renderer/bridge/fixture-client.test.ts src/main/main.ts
git commit -m "feat: generate structured global overviews"
```

### Task 5: Add the Store, Settings and Foreground Automation Gate

**Files:**
- Create: `src/renderer/stores/global-pending-overview.ts`
- Create: `src/renderer/stores/global-pending-overview.test.ts`
- Create: `src/renderer/global-overview/auto-refresh.ts`
- Create: `src/renderer/global-overview/auto-refresh.test.ts`
- Modify: `src/renderer/stores/settings.ts`
- Modify: `src/renderer/stores/settings.test.ts`
- Modify: `src/renderer/bridge/context.tsx`
- Modify: `src/renderer/bridge/context.test.tsx`

**Interfaces:**

```ts
export interface GlobalPendingOverviewState {
  persisted: PersistedGlobalOverviewState;
  status: "idle" | "refreshing" | "error";
  error: string | null;
  refresh(trigger: GlobalOverviewTrigger): Promise<void>;
  setPriority(anchorSourceId: string, value: "now" | "soon" | "later"): Promise<void>;
  ignore(anchorSourceId: string): Promise<void>;
  end(anchorSourceId: string): Promise<void>;
  restore(anchorSourceId: string): Promise<void>;
  maybeAutoRefresh(now?: number): Promise<"ran" | "skipped">;
}

export function shouldAutoRefresh(input: {
  enabled: boolean;
  localTime: string;
  now: number;
  lastAutoAttemptDate?: string;
  lastSuccessfulAt?: number;
}): boolean;
```

Settings add `globalOverviewAutoEnabled: boolean` default `false` and `globalOverviewAutoTime: string` default `"09:00"`; both join `PERSISTED_SETTING_KEYS` and per-field hydration validation.

- [x] **Step 1: Write store RED tests**

Cover no Provider, empty fact pack, successful refresh/save, concurrent refresh deduplication, failure preserving old snapshot, persistence failure preserving old snapshot, override persistence, hard-state reconciliation and source changes reviving an `ended` item.

- [x] **Step 2: Write auto-gate RED tests**

```ts
expect(shouldAutoRefresh({ enabled: false, localTime: "09:00", now })).toBe(false);
expect(shouldAutoRefresh({ enabled: true, localTime: "09:00", now: at("08:59") })).toBe(false);
expect(shouldAutoRefresh({ enabled: true, localTime: "09:00", now: at("09:01") })).toBe(true);
expect(shouldAutoRefresh({ enabled: true, localTime: "09:00", now: at("09:01"), lastAutoAttemptDate: today })).toBe(false);
```

Also assert a manual successful refresh after today's threshold suppresses the automatic call; a manual refresh before the threshold does not; malformed persisted time becomes `09:00`.

- [x] **Step 3: Run RED**

```powershell
npx vitest run src/renderer/stores/global-pending-overview.test.ts src/renderer/global-overview/auto-refresh.test.ts src/renderer/stores/settings.test.ts src/renderer/bridge/context.test.tsx
```

- [x] **Step 4: Implement atomic automatic attempt semantics**

Before an automatic model call, persist `lastAutoAttemptDate` for the local day. This guarantees at most one paid automatic attempt even if the request fails. A manual retry remains available. Do not mark a successful timestamp until the validated snapshot is durable.

- [x] **Step 5: Wire one global foreground listener**

In `BridgeProvider`, after persistence hydration, register `window.focus` and `document.visibilitychange`. Call `maybeAutoRefresh` only when `document.visibilityState === "visible"`; initial mount also checks once. Remove listeners on unmount. Enabling the setting does not call `refresh` directly.

- [x] **Step 6: Reconcile hard facts without a model call**

When tasks, conversations or artifacts update, derive a display view that removes a now-completed Todo-only item, updates running/waiting/failed labels and marks missing sources. Do not rewrite the stored model summary or reorder unrelated items.

- [x] **Step 7: Verify and commit**

```powershell
npx vitest run src/renderer/stores/global-pending-overview.test.ts src/renderer/global-overview/auto-refresh.test.ts src/renderer/stores/settings.test.ts src/renderer/bridge/context.test.tsx
npx tsc -p tsconfig.renderer.json --noEmit
git add src/renderer/stores/global-pending-overview.ts src/renderer/stores/global-pending-overview.test.ts src/renderer/global-overview/auto-refresh.ts src/renderer/global-overview/auto-refresh.test.ts src/renderer/stores/settings.ts src/renderer/stores/settings.test.ts src/renderer/bridge/context.tsx src/renderer/bridge/context.test.tsx
git commit -m "feat: manage global overview refresh state"
```

### Task 6: Build the Authority-Matched Card and Full Global Board

**Files:**
- Create: `src/renderer/start/GlobalPendingOverviewCard.tsx`
- Create: `src/renderer/start/GlobalPendingOverviewCard.test.tsx`
- Create: `src/renderer/start/GlobalPendingOverviewPage.tsx`
- Create: `src/renderer/start/GlobalPendingOverviewPage.test.tsx`
- Create: `src/renderer/start/open-overview-source.ts`
- Create: `src/renderer/start/open-overview-source.test.ts`
- Modify: `src/renderer/start/start-navigation.ts`
- Modify: `src/renderer/start/start-navigation.test.ts`
- Modify: `src/renderer/stores/start.ts`
- Modify: `src/renderer/stores/start.test.ts`
- Modify: `src/renderer/start/StartHome.tsx`
- Modify: `src/renderer/start/StartHome.test.tsx`
- Modify: `src/renderer/start/StartShell.tsx`
- Modify: `src/renderer/start/StartShell.css`

**Interfaces:**

`StartDestination` gains `"overview"`. `StartState` gains `selectedTaskId: string | null` and a single typed source-opening action:

```ts
export type OverviewOpenTarget =
  | { kind: "task"; id: string }
  | { kind: "conversation"; id: string }
  | { kind: "artifact"; id: string }
  | { kind: "run"; conversationId: string; runId: string };

export interface OpenOverviewSourceDeps {
  openTask(taskId: string): void;
  openConversation(conversationId: string): void;
  openArtifact(artifactId: string): void;
  openRun(conversationId: string, runId: string): void;
  reportMissing(target: OverviewOpenTarget): void;
}

export function openOverviewSource(target: OverviewOpenTarget, deps: OpenOverviewSourceDeps): void;
```

- [x] **Step 1: Write card state RED tests**

Cover never-generated CTA, persisted top-three rows, updating with old rows visible, failure with folded detail, empty result, model-unavailable neutral message, exact update timestamp and no invoke on mount.

- [x] **Step 2: Write full-board and navigation RED tests**

Assert grouping by `projectLabel`, “未归组” fallback, uncertain section collapsed by default, source buttons, priority/ignore/end/restore, and exact object routing. A task opens the Todo view and selects that task; a conversation opens its real shell/tab; an artifact opens the existing preview; a missing source displays an error and never opens a browser URL.

- [x] **Step 3: Run RED**

```powershell
npx vitest run src/renderer/start/GlobalPendingOverviewCard.test.tsx src/renderer/start/GlobalPendingOverviewPage.test.tsx src/renderer/start/open-overview-source.test.ts src/renderer/start/start-navigation.test.ts src/renderer/stores/start.test.ts src/renderer/start/StartHome.test.tsx
```

- [x] **Step 4: Implement the v2 homepage card**

Match the authority: 01 number, title, update time, exactly three compact rows, source-count metadata, orange `重新梳理`, quiet `查看完整看板`, and low-contrast `由 momo 梳理`. Initial CTA says `为我梳理待完成事项`. A tooltip and accessible description say the action will use the configured model.

- [x] **Step 5: Implement the full board without a second task system**

Render snapshot items only. Do not add checkboxes that resemble Todo completion. Per-item actions are `打开来源 / 优先处理 / 不再关注 / 已经结束`; source chips remain visible and keyboard reachable. Use one scroll surface and the existing Start sidebar; no nested full-height card scrollbars.

- [x] **Step 6: Implement responsive behavior**

At 1440×900 preserve the two-column four-card home grid. Below 1100px use one column. Below 820px hide source-count detail before wrapping buttons. The full board uses project sections, not horizontal Kanban columns.

- [x] **Step 7: Verify and commit**

```powershell
npx vitest run src/renderer/start/GlobalPendingOverviewCard.test.tsx src/renderer/start/GlobalPendingOverviewPage.test.tsx src/renderer/start/open-overview-source.test.ts src/renderer/start/start-navigation.test.ts src/renderer/stores/start.test.ts src/renderer/start/StartHome.test.tsx
npx tsc -p tsconfig.renderer.json --noEmit
git add src/renderer/start src/renderer/stores/start.ts src/renderer/stores/start.test.ts
git commit -m "feat: show the global pending overview"
```

### Task 7: Add the Opt-In Daily Overview Setting

**Files:**
- Modify: `src/renderer/pages/SettingsPage.tsx`
- Modify: `src/renderer/pages/SettingsPage.test.tsx`
- Modify: `src/renderer/pages/SettingsPage.css`

**Interfaces:**
- Consumes: `globalOverviewAutoEnabled`, `globalOverviewAutoTime`, their setters and the existing `LeemoSwitch`.
- Produces: one single-column “工作总览” group in General settings.

- [x] **Step 1: Write RED tests**

Assert the switch defaults off, time control is disabled while off, enabling the switch only saves the setting, selecting `09:30` saves valid local time, invalid time is rejected, copy mentions default model and usage, and no bridge overview invocation occurs from either control.

- [x] **Step 2: Run RED**

```powershell
npx vitest run src/renderer/pages/SettingsPage.test.tsx src/renderer/stores/settings.test.ts
```

- [x] **Step 3: Implement the compact settings group**

Use exact copy:

```text
每天自动整理待完成事项
在设定时间之后，当天首次回到 Leemo 时整理一次。会使用默认模型并计入用量。
```

Place a native local-time input on the next single-column row. Do not open a second settings page or create a scheduled-task card.

- [x] **Step 4: Verify and commit**

```powershell
npx vitest run src/renderer/pages/SettingsPage.test.tsx src/renderer/stores/settings.test.ts
npx tsc -p tsconfig.renderer.json --noEmit
git add src/renderer/pages/SettingsPage.tsx src/renderer/pages/SettingsPage.test.tsx src/renderer/pages/SettingsPage.css
git commit -m "feat: configure daily overview refresh"
```

### Task 8: End-to-End, Restart, Cost and Visual Acceptance

**Files:**
- Create: `scripts/verify-global-pending-overview.mjs`
- Create: `docs/verification/2026-08-18-global-pending-overview.md`
- Modify: `src/renderer/app/App.test.tsx`
- Modify: `tests/main/persistence.test.ts`
- Modify: `tests/host/bridge-host.test.ts`

- [x] **Step 1: Add a deterministic verification script**

The script seeds two open Todos, one completed Todo, a waiting conversation, a failed retryable Run, one delivered artifact and one ordinary chat. It invokes the pure fact builder and a fake structured model reply, persists the result, reloads, applies a Todo completion and verifies the display projection.

- [x] **Step 2: Run focused and static verification**

```powershell
npx vitest run src/bridge/global-pending-overview.test.ts src/renderer/global-overview src/renderer/stores/global-pending-overview.test.ts src/renderer/start/GlobalPendingOverviewCard.test.tsx src/renderer/start/GlobalPendingOverviewPage.test.tsx src/renderer/pages/SettingsPage.test.tsx tests/host/global-pending-overview.test.ts tests/host/one-shot-inference.test.ts tests/host/bridge-host.test.ts tests/main/persistence.test.ts
npm run typecheck
npm run build
npm run build:main
node scripts/verify-global-pending-overview.mjs
```

- [x] **Step 3: Run real Electron manual-refresh journeys**

Using an isolated E-drive userData root, verify: first Start render performs zero model calls; manual CTA produces one snapshot; every source opens the real target; refresh failure preserves the old snapshot; restart restores it without another call; usage summary increases by exactly the recorded one-shot usage. Use a configured API provider and, when locally available, one subscription runtime. If no subscription login exists, record the unavailable-path screenshot and focused adapter proof rather than claiming a live subscription call.

- [x] **Step 4: Run real automatic-refresh journeys**

Enable a time just before the current local clock, relaunch or refocus after the threshold, and verify one automatic attempt. Refocus twice more on the same day and assert no second attempt. Disable the setting and repeat foreground transitions with zero calls.

- [x] **Step 5: Perform visual comparison**

Capture 1440×900 Start home for never-generated, populated and failure-with-old-snapshot states; capture 960×680 populated state. Compare card position, row count, typography, action alignment and responsive collapse against `start-static-workspace-v2.png` and record measured differences.

- [x] **Step 6: Scan safety and repository hygiene**

```powershell
rg -n "sk-[A-Za-z0-9_-]{10,}|Bearer [A-Za-z0-9._-]{10,}" docs/verification scripts src tests
git diff --check
git status --short
```

No API Key, generated screenshot, userData database, provider response body or isolated runtime directory may be staged.

- [x] **Step 7: Commit verification**

```powershell
git add scripts/verify-global-pending-overview.mjs docs/verification/2026-08-18-global-pending-overview.md src/renderer/app/App.test.tsx tests/main/persistence.test.ts tests/host/bridge-host.test.ts
git commit -m "test: verify global pending overview"
```
