# Slice-2 消息展示卡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 momo 一个回合里的结构化动作（计划/工具/分身活动/收尾/上下文压缩）从 `LeemoEvent` 流折成有序 timeline，渲染成工作台展示卡，完成的回合可折叠——全 fixture、零回投、零 Electron。

**Architecture:** 纯函数 reducer（`applyEvent`）把事件折成扁平判别联合 `TimelineItem[]`（时序进数据）；渲染层 `Timeline` 按 `runId` 分组成 `RunGroup`（视觉分组 + 折叠 UI state 进渲染层），按 `kind` 分发到纯展示卡组件。hexagonal 铁律：卡组件读 props/store，绝不 import 端口。

**Tech Stack:** React 18 + TypeScript（`tsconfig.renderer.json`，strict + DOM + jsx:react-jsx）+ Tailwind（CSS 变量 token）+ Zustand vanilla store + Vitest（jsdom project）+ @testing-library/react。

**权威 spec：** `docs/superpowers/specs/2026-07-22-slice2-message-cards-design.md`
**视觉基准：** `docs/design-audition/k3/workbench-mode.html`（工具卡/计划卡有基准；活动卡/结果卡无基准=穿衣拍自由发挥）
**数据源契约：** `src/bridge/events.ts` 的 `LeemoEvent` 判别联合（只 `import type`，不改）

## Global Constraints

- **CC SDK 锁 0.3.210**，不逐版跟随（本片不碰 SDK）。
- **禁改**：`src/gateway/**`、`src/bridge/**`（含 `contract.ts`/`events.ts` 只 `import type`）、`tsconfig.vendor.json`、`smoke/**`、现有 `vitest.config.ts` 的 node 测试行为。
- **Phase-1 gate 不碰**：gate#1 store 订阅生命周期（`conversations.ts` 的 `client.subscribe` 塞在 `context.tsx` useMemo 且丢 unsubscribe）；gate#2 `fixture-client.ts` 的 `invoke()` default 返 undefined。本片只扩 `send` 的事件脚本，**不动 invoke default 分支、不动 subscribe 结构**。
- **hexagonal 铁律**：`src/renderer/components/**` 不得 import `bridge/client` 或 `bridge/fixture-client`（`guard.test.ts` 文件扫描守卫，真 fail-red）。卡组件读 props 或经 `../bridge/context` hooks 读 store，绝不直连端口。
- **TDD 边界**：reducer/逻辑=严格测试（先写失败测试）；纯视觉=用户目验（穿衣拍，不在本 plan）。
- **命名**：仅 Leemo/momo；用户可见名词只「本子/成果」。禁「幸运鹿/LuckyDeer/Lulu」。
- **不回归**：原 gateway/bridge 215 + slice-1 renderer 测试全绿（总 241 基线）。
- **验收命令**：`npm run typecheck`（三段 exit 0）+ `npm test`（全绿，含 241 不回归）。
- 本 plan 只覆盖**骨架拍**（TDD 逻辑 + 朴素占位视觉）。穿衣拍（K3）是独立后续，不在此。

---

## 文件结构（本片新建/改动地图）

**新建：**
- `src/renderer/stores/message-model.ts` — **改造**（`RendererMessage`→`TimelineItem` 判别联合 + `applyEvent` 扩 6 分支）
- `src/renderer/components/timeline/Timeline.tsx` — 顶层：读 store items，按 runId 分组，渲染 RunGroup
- `src/renderer/components/timeline/RunGroup.tsx` — 一个 run 的容器：折叠条 + 过程卡（折叠区）+ 最终输出/结果卡（常驻）
- `src/renderer/components/timeline/TextBubble.tsx` — user/momo 文字气泡（从 MessageList 抽出）
- `src/renderer/components/timeline/ToolCard.tsx` — 工具卡（朴素）
- `src/renderer/components/timeline/PlanCard.tsx` — 计划卡（朴素）
- `src/renderer/components/timeline/ActivityCard.tsx` — 活动卡（朴素）
- `src/renderer/components/timeline/ResultCard.tsx` — 结果卡（朴素）
- `src/renderer/components/timeline/CompactDivider.tsx` — compact 分隔线（朴素）

**改动：**
- `src/renderer/stores/conversations.ts` — `messages` 字段类型 `RendererMessage[]`→`TimelineItem[]`；`send` 的乐观 user 项加 `kind:"text"` + `runId`
- `src/renderer/bridge/fixture-client.ts` — 扩 `scriptReply` 为完整演示回合（不碰 invoke default / subscribe）
- `src/renderer/bridge/fixtures/index.ts` — 加演示回合的脚本常量
- `src/renderer/components/BuddyShell.tsx` — `MessageList`→`Timeline`（引用点改一处）
- `src/renderer/stores/message-model.test.ts` — 更新到新类型 + 新分支断言
- `src/renderer/stores/conversations.test.ts` — `messages` 项断言加 `kind`
- `src/renderer/bridge/fixture-client.test.ts` — 演示回合序列断言

**删除：**
- `src/renderer/components/MessageList.tsx`（被 Timeline 取代）

---

## Task 1: 数据模型 — TimelineItem 判别联合 + text/run 分支迁移

把 `RendererMessage` 升级为 `TimelineItem` 判别联合，先迁移**现有** text/run 逻辑（加 `kind` + `runId`），保证不回归。tool/plan/activity/compact 分支在 Task 2 加。

**Files:**
- Modify: `src/renderer/stores/message-model.ts`（全文替换）
- Test: `src/renderer/stores/message-model.test.ts`（全文替换）

**Interfaces:**
- Consumes: `LeemoEvent`, `PathAudit` from `../../bridge/contract`（`import type`）。
- Produces:
  - `TimelineItem`（判别联合，`kind` 判别）——见 Step 3 完整定义。
  - `applyEvent(items: TimelineItem[], event: LeemoEvent, runId: string): TimelineItem[]` — 纯函数，**新增第三参 `runId`**（当前 run 标识，调用方传入）。
  - `RENDERER_RUN_ID_INITIAL = "run-0"`（常量，store 初始 runId）。

- [ ] **Step 1: Write the failing test**

全文替换 `src/renderer/stores/message-model.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import type { LeemoEvent } from "../../bridge/contract";
import { applyEvent, type TimelineItem } from "./message-model";

const RUN = "run-1";

describe("applyEvent — text + run lifecycle (migrated)", () => {
  it("conversation.started adds no item", () => {
    expect(applyEvent([], { type: "conversation.started", sessionId: "s1" }, RUN)).toEqual([]);
  });

  it("text.delta accumulates into one streaming momo text item tagged with runId", () => {
    let m: TimelineItem[] = [];
    m = applyEvent(m, { type: "text.delta", text: "Hel" }, RUN);
    m = applyEvent(m, { type: "text.delta", text: "lo" }, RUN);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: "text", role: "momo", text: "Hello", streaming: true, runId: RUN });
  });

  it("text.final finalizes the streaming text item", () => {
    let m: TimelineItem[] = [{ kind: "text", id: "m0", runId: RUN, role: "momo", text: "Hel", streaming: true }];
    m = applyEvent(m, { type: "text.final", text: "Hello" }, RUN);
    expect(m[0]).toMatchObject({ kind: "text", text: "Hello", streaming: false });
  });

  it("run.finished appends a result item and clears streaming", () => {
    let m: TimelineItem[] = [{ kind: "text", id: "m0", runId: RUN, role: "momo", text: "Hi", streaming: true }];
    m = applyEvent(m, {
      type: "run.finished", subtype: "success", isError: false, finalText: "Hi",
      pathAudit: { claimed: [] },
    }, RUN);
    expect(m[0]).toMatchObject({ kind: "text", streaming: false });
    expect(m.at(-1)).toMatchObject({ kind: "result", runId: RUN, isError: false, finalText: "Hi" });
  });

  it("deferred variants (thinking/usage) leave items unchanged", () => {
    const start: TimelineItem[] = [{ kind: "text", id: "m0", runId: RUN, role: "momo", text: "x", streaming: false }];
    const evts: LeemoEvent[] = [
      { type: "thinking.delta", text: "…" },
      { type: "usage.final", usage: {
          providerId: "p", modelId: "m", inputTokens: 1, outputTokens: 1,
          cacheReadTokens: 0, cacheCreationTokens: 0, costSource: "unpriced", tokensEstimated: false,
      } },
    ];
    for (const e of evts) expect(applyEvent(start, e, RUN)).toEqual(start);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/stores/message-model.test.ts`
Expected: FAIL（`applyEvent` 只接 2 参 / `TimelineItem` 未导出 / result 项不产生）。

- [ ] **Step 3: Write minimal implementation**

全文替换 `src/renderer/stores/message-model.ts`：

```ts
import type { LeemoEvent, PathAudit } from "../../bridge/contract";

/** The ordered, discriminated timeline the frontend renders against. Time
 *  order lives in the array; visual grouping (by runId) lives in the render
 *  layer. `kind` is the discriminant. */
export type TimelineItem =
  | { kind: "text"; id: string; runId: string; role: "user" | "momo"; text: string; streaming: boolean }
  | { kind: "tool"; id: string; runId: string; toolUseId: string; name: string; input: unknown; status: "running" | "ok" | "error"; summary?: string }
  | { kind: "plan"; id: string; runId: string; toolUseId: string; todos: { text: string; status: "done" | "active" | "todo" }[] }
  | { kind: "activity"; id: string; runId: string; parentToolUseId: string; childToolUseIds: string[] }
  | { kind: "result"; id: string; runId: string; isError: boolean; finalText: string; pathAudit: PathAudit }
  | { kind: "compact"; id: string; trigger: string; preTokens: number; postTokens?: number };

export const RENDERER_RUN_ID_INITIAL = "run-0";

/** Pure reducer: fold one LeemoEvent into the timeline. `runId` tags every
 *  appended item (render layer groups by it). Slice 2 handles text + run
 *  lifecycle here; tool/plan/activity/compact land in the same switch. */
export function applyEvent(items: TimelineItem[], event: LeemoEvent, runId: string): TimelineItem[] {
  switch (event.type) {
    case "text.delta": {
      const last = items[items.length - 1];
      if (last && last.kind === "text" && last.role === "momo" && last.streaming) {
        return [...items.slice(0, -1), { ...last, text: last.text + event.text }];
      }
      return [...items, { kind: "text", id: `m${items.length}`, runId, role: "momo", text: event.text, streaming: true }];
    }
    case "text.final": {
      const last = items[items.length - 1];
      if (last && last.kind === "text" && last.role === "momo" && last.streaming) {
        return [...items.slice(0, -1), { ...last, text: event.text, streaming: false }];
      }
      return [...items, { kind: "text", id: `m${items.length}`, runId, role: "momo", text: event.text, streaming: false }];
    }
    case "run.finished": {
      const cleared = items.map((it) => (it.kind === "text" && it.streaming ? { ...it, streaming: false } : it));
      return [...cleared, {
        kind: "result", id: `m${items.length}`, runId,
        isError: event.isError, finalText: event.finalText, pathAudit: event.pathAudit,
      }];
    }
    default:
      return items;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/stores/message-model.test.ts`
Expected: PASS（5 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/stores/message-model.ts src/renderer/stores/message-model.test.ts
git commit -m "feat(fe): TimelineItem discriminated union + runId-tagged applyEvent (s2 task1)"
```

---

## Task 2: reducer 扩展 — tool / plan / activity / compact 分支

在 `applyEvent` 加 4 类事件的折叠。TodoWrite→plan（防御式解析），普通工具→tool，subagent 工具挂进 activity，compact→分隔项。

**Files:**
- Modify: `src/renderer/stores/message-model.ts`（加 switch 分支 + `parseTodos` helper）
- Test: `src/renderer/stores/message-model.test.ts`（追加 describe 块）

**Interfaces:**
- Consumes: Task 1 的 `applyEvent(items, event, runId)`、`TimelineItem`。
- Produces: `applyEvent` 新增处理 `tool.started`/`tool.finished`/`subagent.activity`/`compact.boundary`；内部 helper `parseTodos(input: unknown): { text: string; status: "done"|"active"|"todo" }[] | null`（返回 null = 非合法 TodoWrite，降级为普通 tool 项）。

- [ ] **Step 1: Write the failing test**

追加到 `src/renderer/stores/message-model.test.ts` 末尾：

```ts
describe("applyEvent — tool / plan / activity / compact (slice 2)", () => {
  it("non-TodoWrite tool.started appends a running tool item", () => {
    const m = applyEvent([], { type: "tool.started", toolUseId: "t1", name: "Read", input: { file: "a.md" }, subagent: false }, RUN);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: "tool", toolUseId: "t1", name: "Read", status: "running", runId: RUN });
  });

  it("tool.finished updates the matching tool item's status and summary", () => {
    let m: TimelineItem[] = applyEvent([], { type: "tool.started", toolUseId: "t1", name: "Read", input: {}, subagent: false }, RUN);
    m = applyEvent(m, { type: "tool.finished", toolUseId: "t1", isError: false, contentSummary: "38 pages" }, RUN);
    expect(m[0]).toMatchObject({ kind: "tool", status: "ok", summary: "38 pages" });
  });

  it("tool.finished with isError marks status error", () => {
    let m: TimelineItem[] = applyEvent([], { type: "tool.started", toolUseId: "t1", name: "Write", input: {}, subagent: false }, RUN);
    m = applyEvent(m, { type: "tool.finished", toolUseId: "t1", isError: true, contentSummary: "denied" }, RUN);
    expect(m[0]).toMatchObject({ kind: "tool", status: "error", summary: "denied" });
  });

  it("TodoWrite tool.started projects a plan item from input.todos", () => {
    const m = applyEvent([], {
      type: "tool.started", toolUseId: "p1", name: "TodoWrite", subagent: false,
      input: { todos: [
        { content: "extract ppt", status: "completed" },
        { content: "draft notes", status: "in_progress" },
        { content: "write file", status: "pending" },
      ] },
    }, RUN);
    expect(m[0]).toMatchObject({ kind: "plan", toolUseId: "p1" });
    if (m[0].kind === "plan") {
      expect(m[0].todos).toEqual([
        { text: "extract ppt", status: "done" },
        { text: "draft notes", status: "active" },
        { text: "write file", status: "todo" },
      ]);
    }
  });

  it("malformed TodoWrite input degrades to a plain tool item, never throws", () => {
    const m = applyEvent([], { type: "tool.started", toolUseId: "p2", name: "TodoWrite", input: { todos: "oops" }, subagent: false }, RUN);
    expect(m[0].kind).toBe("tool");
  });

  it("subagent.activity appends an activity item; subagent tool.started nests into it", () => {
    let m: TimelineItem[] = applyEvent([], { type: "subagent.activity", parentToolUseId: "a1" }, RUN);
    expect(m[0]).toMatchObject({ kind: "activity", parentToolUseId: "a1", childToolUseIds: [] });
    m = applyEvent(m, { type: "tool.started", toolUseId: "c1", name: "Grep", input: {}, subagent: true }, RUN);
    expect(m).toHaveLength(1);
    if (m[0].kind === "activity") expect(m[0].childToolUseIds).toEqual(["c1"]);
  });

  it("repeated subagent.activity for same parent does not duplicate", () => {
    let m: TimelineItem[] = applyEvent([], { type: "subagent.activity", parentToolUseId: "a1" }, RUN);
    m = applyEvent(m, { type: "subagent.activity", parentToolUseId: "a1" }, RUN);
    expect(m.filter((i) => i.kind === "activity")).toHaveLength(1);
  });

  it("compact.boundary appends a compact divider item", () => {
    const m = applyEvent([], { type: "compact.boundary", trigger: "auto", preTokens: 1000, postTokens: 300 }, RUN);
    expect(m[0]).toMatchObject({ kind: "compact", trigger: "auto", preTokens: 1000, postTokens: 300 });
  });

  it("preserves interleaved order of cards and text", () => {
    let m: TimelineItem[] = [];
    m = applyEvent(m, { type: "text.delta", text: "start" }, RUN);
    m = applyEvent(m, { type: "tool.started", toolUseId: "t1", name: "Read", input: {}, subagent: false }, RUN);
    m = applyEvent(m, { type: "text.delta", text: " more" }, RUN);
    expect(m.map((i) => i.kind)).toEqual(["text", "tool", "text"]);
  });
});
```

> 注：`tool.started` 的类型是 `{ ...; input: unknown; subagent: boolean }`（见 `events.ts:62`）。TodoWrite 的 `input.todos[].status` SDK 惯例值为 `completed|in_progress|pending`，映射到 `done|active|todo`。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/stores/message-model.test.ts`
Expected: FAIL（新 8 个断言，tool/plan/activity/compact 分支未实现）。

- [ ] **Step 3: Write minimal implementation**

在 `message-model.ts` 顶部（`applyEvent` 之前）加 helper：

```ts
type TodoStatus = "done" | "active" | "todo";
const TODO_STATUS_MAP: Record<string, TodoStatus> = { completed: "done", in_progress: "active", pending: "todo" };

/** Defensive TodoWrite input → plan todos. Returns null when the shape is not
 *  a recognizable todo list (caller degrades to a plain tool item). Never throws. */
function parseTodos(input: unknown): { text: string; status: TodoStatus }[] | null {
  if (!input || typeof input !== "object") return null;
  const todos = (input as { todos?: unknown }).todos;
  if (!Array.isArray(todos)) return null;
  const out: { text: string; status: TodoStatus }[] = [];
  for (const t of todos) {
    if (!t || typeof t !== "object") return null;
    const text = (t as { content?: unknown; text?: unknown }).content ?? (t as { text?: unknown }).text;
    const rawStatus = (t as { status?: unknown }).status;
    if (typeof text !== "string") return null;
    out.push({ text, status: (typeof rawStatus === "string" && TODO_STATUS_MAP[rawStatus]) || "todo" });
  }
  return out;
}
```

在 `applyEvent` 的 switch 里，`default` 之前插入这些 case：

```ts
    case "tool.started": {
      if (event.name === "TodoWrite") {
        const todos = parseTodos(event.input);
        if (todos) {
          return [...items, { kind: "plan", id: `m${items.length}`, runId, toolUseId: event.toolUseId, todos }];
        }
      }
      if (event.subagent) {
        // nest into the most recent activity item
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i];
          if (it.kind === "activity") {
            const updated = { ...it, childToolUseIds: [...it.childToolUseIds, event.toolUseId] };
            return [...items.slice(0, i), updated, ...items.slice(i + 1)];
          }
        }
      }
      return [...items, { kind: "tool", id: `m${items.length}`, runId, toolUseId: event.toolUseId, name: event.name, input: event.input, status: "running" }];
    }
    case "tool.finished": {
      return items.map((it) =>
        it.kind === "tool" && it.toolUseId === event.toolUseId
          ? { ...it, status: event.isError ? "error" : "ok", summary: event.contentSummary }
          : it,
      );
    }
    case "subagent.activity": {
      const exists = items.some((it) => it.kind === "activity" && it.parentToolUseId === event.parentToolUseId);
      if (exists) return items;
      return [...items, { kind: "activity", id: `m${items.length}`, runId, parentToolUseId: event.parentToolUseId, childToolUseIds: [] }];
    }
    case "compact.boundary": {
      const item: TimelineItem = { kind: "compact", id: `m${items.length}`, trigger: event.trigger, preTokens: event.preTokens };
      if (event.postTokens !== undefined) item.postTokens = event.postTokens;
      return [...items, item];
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/stores/message-model.test.ts`
Expected: PASS（全部 ~13 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/stores/message-model.ts src/renderer/stores/message-model.test.ts
git commit -m "feat(fe): fold tool/plan/activity/compact events into timeline (s2 task2)"
```

---

## Task 3: store 接线 — conversations 用 TimelineItem + runId

`conversations.ts` 的 `messages` 换成 `TimelineItem[]`，乐观 user 项加 `kind`/`runId`，`applyEvent` 调用传 runId。

**Files:**
- Modify: `src/renderer/stores/conversations.ts`
- Test: `src/renderer/stores/conversations.test.ts`（断言加 `kind`）

**Interfaces:**
- Consumes: Task 1 的 `TimelineItem`, `RENDERER_RUN_ID_INITIAL`, `applyEvent(items, event, runId)`。
- Produces: `ConversationsState.messages: TimelineItem[]`；`send` 追加 `{ kind:"text", role:"user", ... }`。runId 语义：S2 单流固定用 `RENDERER_RUN_ID_INITIAL`（并发多 run 是 Phase-1，见记忆 fe-slice1-phase1-gates 的 defer 项）。

- [ ] **Step 1: Write the failing test**

改 `src/renderer/stores/conversations.test.ts` 的两处断言（加 `kind`）：

```ts
    await store.getState().send("hello");
    expect(store.getState().messages[0]).toMatchObject({ kind: "text", role: "user", text: "hello", streaming: false });

    await vi.advanceTimersByTimeAsync(300);
    const msgs = store.getState().messages;
    expect(msgs.find((m) => m.kind === "text" && m.role === "momo")).toMatchObject({ text: "hi there friend", streaming: false });
```

> 注：演示回合改造后（Task 5）momo 文字不再是 `messages[1]`（前面有卡），故改用 `find`。此 Task 先只改 `kind` 断言；`find` 改法一并落。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/stores/conversations.test.ts`
Expected: FAIL（user 项无 `kind` 字段 / 类型不匹配）。

- [ ] **Step 3: Write minimal implementation**

改 `src/renderer/stores/conversations.ts`：

```ts
import { createStore, type StoreApi } from "zustand/vanilla";
import type { BridgeClient } from "../bridge/client";
import { applyEvent, type TimelineItem, RENDERER_RUN_ID_INITIAL } from "./message-model";

export interface ConversationsState {
  activeId: string;
  messages: TimelineItem[];
  send: (text: string) => Promise<void>;
}

export function createConversationsStore(client: BridgeClient): StoreApi<ConversationsState> {
  const runId = RENDERER_RUN_ID_INITIAL;
  const store = createStore<ConversationsState>((set, get) => ({
    activeId: "conv-1",
    messages: [],
    send: async (text: string) => {
      const { messages, activeId } = get();
      const userMsg: TimelineItem = { kind: "text", id: `u${messages.length}`, runId, role: "user", text, streaming: false };
      set({ messages: [...messages, userMsg] });
      await client.invoke("bridge:send", { conversationId: activeId, prompt: text });
    },
  }));

  client.subscribe("bridge:event", (event) => {
    store.setState((s) => ({ messages: applyEvent(s.messages, event, runId) }));
  });

  return store;
}
```

> gate#1 不碰：`client.subscribe` 结构原样保留（不移进 useEffect）。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/stores/conversations.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/stores/conversations.ts src/renderer/stores/conversations.test.ts
git commit -m "feat(fe): conversations store carries TimelineItem[] with runId (s2 task3)"
```

---

## Task 4: 纯展示卡组件（朴素占位）

7 个纯展示组件：读 props，零 store/端口引用。朴素视觉（灰框/系统字/无动效）——穿衣拍才上 K3 皮。

**Files:**
- Create: `src/renderer/components/timeline/TextBubble.tsx`, `ToolCard.tsx`, `PlanCard.tsx`, `ActivityCard.tsx`, `ResultCard.tsx`, `CompactDivider.tsx`
- Create: `src/renderer/components/timeline/cards.test.tsx`

**Interfaces:**
- Consumes: `TimelineItem` 的各 variant（`import type` from `../../stores/message-model`）。
- Produces: 每个组件 default export，props = 对应 variant（如 `ToolCard({ item }: { item: Extract<TimelineItem, { kind: "tool" }> })`）。`MomoAvatar` 复用 `../momo/MomoAvatar`（default export，`{ size?: number }`）。

- [ ] **Step 1: Write the failing test**

`src/renderer/components/timeline/cards.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import type { TimelineItem } from "../../stores/message-model";
import ToolCard from "./ToolCard";
import PlanCard from "./PlanCard";
import ActivityCard from "./ActivityCard";
import ResultCard from "./ResultCard";
import CompactDivider from "./CompactDivider";
import TextBubble from "./TextBubble";

type Of<K extends TimelineItem["kind"]> = Extract<TimelineItem, { kind: K }>;

describe("timeline cards render their data", () => {
  it("ToolCard shows tool name and status", () => {
    const item: Of<"tool"> = { kind: "tool", id: "1", runId: "r", toolUseId: "t", name: "Read", input: {}, status: "ok", summary: "38 pages" };
    render(<ToolCard item={item} />);
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText(/38 pages/)).toBeInTheDocument();
  });

  it("PlanCard lists todos with a progress count", () => {
    const item: Of<"plan"> = { kind: "plan", id: "1", runId: "r", toolUseId: "p", todos: [
      { text: "a", status: "done" }, { text: "b", status: "active" }, { text: "c", status: "todo" },
    ] };
    render(<PlanCard item={item} />);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("c")).toBeInTheDocument();
    expect(screen.getByText(/1\s*\/\s*3/)).toBeInTheDocument();
  });

  it("ActivityCard shows subagent activity with child count", () => {
    const item: Of<"activity"> = { kind: "activity", id: "1", runId: "r", parentToolUseId: "a", childToolUseIds: ["c1", "c2"] };
    render(<ActivityCard item={item} />);
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });

  it("ResultCard warns on out-of-workspace claimed path", () => {
    const item: Of<"result"> = { kind: "result", id: "1", runId: "r", isError: false, finalText: "done",
      pathAudit: { claimed: [{ path: "E:/evil", exists: false, withinCwd: false }] } };
    render(<ResultCard item={item} />);
    expect(screen.getByText(/E:\/evil/)).toBeInTheDocument();
  });

  it("CompactDivider shows a compaction marker", () => {
    const item: Of<"compact"> = { kind: "compact", id: "1", trigger: "auto", preTokens: 1000, postTokens: 300 };
    render(<CompactDivider item={item} />);
    expect(screen.getByText(/压缩|compact/i)).toBeInTheDocument();
  });

  it("TextBubble renders momo text with a streaming caret", () => {
    const item: Of<"text"> = { kind: "text", id: "1", runId: "r", role: "momo", text: "hi", streaming: true };
    render(<TextBubble item={item} />);
    expect(screen.getByText("hi")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/timeline/cards.test.tsx`
Expected: FAIL（组件文件不存在）。

- [ ] **Step 3: Write minimal implementation**

`TextBubble.tsx`（从 MessageList 抽出的双角色气泡）：

```tsx
import MomoAvatar from "../momo/MomoAvatar";
import type { TimelineItem } from "../../stores/message-model";

export default function TextBubble({ item }: { item: Extract<TimelineItem, { kind: "text" }> }) {
  if (item.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="rounded-[10px] bg-[var(--leemo-bg-deep)] px-3 py-2 text-sm text-[var(--leemo-ink)]">{item.text}</div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      <MomoAvatar size={26} />
      <p className="text-sm leading-relaxed text-[var(--leemo-ink)]">
        {item.text}
        {item.streaming && <span aria-hidden>▍</span>}
      </p>
    </div>
  );
}
```

`ToolCard.tsx`：

```tsx
import type { TimelineItem } from "../../stores/message-model";

const STATUS_LABEL = { running: "进行中…", ok: "完成", error: "失败" } as const;

export default function ToolCard({ item }: { item: Extract<TimelineItem, { kind: "tool" }> }) {
  return (
    <div className="rounded border border-[var(--leemo-line)] px-3 py-2 text-sm">
      <span className="font-medium text-[var(--leemo-ink)]">{item.name}</span>
      <span className="ml-2 text-xs text-[var(--leemo-ink-3)]">{STATUS_LABEL[item.status]}</span>
      {item.summary && <span className="ml-2 text-xs text-[var(--leemo-ink-3)]">· {item.summary}</span>}
    </div>
  );
}
```

`PlanCard.tsx`：

```tsx
import type { TimelineItem } from "../../stores/message-model";

export default function PlanCard({ item }: { item: Extract<TimelineItem, { kind: "plan" }> }) {
  const done = item.todos.filter((t) => t.status === "done").length;
  return (
    <div className="rounded border border-[var(--leemo-line)] px-3 py-2 text-sm">
      <div className="mb-1 text-xs text-[var(--leemo-ink-3)]">计划 · {done} / {item.todos.length}</div>
      <ol className="space-y-0.5">
        {item.todos.map((t, i) => (
          <li key={i} className="text-[var(--leemo-ink)]">
            <span className="mr-1.5 text-xs">{t.status === "done" ? "✓" : t.status === "active" ? "▸" : "○"}</span>
            {t.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
```

`ActivityCard.tsx`：

```tsx
import type { TimelineItem } from "../../stores/message-model";

export default function ActivityCard({ item }: { item: Extract<TimelineItem, { kind: "activity" }> }) {
  return (
    <div className="rounded border border-dashed border-[var(--leemo-line)] px-3 py-2 text-sm">
      <span className="text-[var(--leemo-ink-2)]">分身干活</span>
      <span className="ml-2 text-xs text-[var(--leemo-ink-3)]">{item.childToolUseIds.length} 个工具</span>
    </div>
  );
}
```

`ResultCard.tsx`：

```tsx
import type { TimelineItem } from "../../stores/message-model";

export default function ResultCard({ item }: { item: Extract<TimelineItem, { kind: "result" }> }) {
  const escaped = item.pathAudit.claimed.filter((c) => !c.withinCwd);
  return (
    <div className="rounded border border-[var(--leemo-line)] px-3 py-2 text-sm">
      <div className="text-[var(--leemo-ink)]">{item.isError ? "这回合出错了" : "完成"}</div>
      {escaped.length > 0 && (
        <ul className="mt-1 text-xs text-[var(--leemo-amber-ink,#8A6210)]">
          {escaped.map((c, i) => (
            <li key={i}>⚠ 声称写到工作区外：{c.path}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

`CompactDivider.tsx`：

```tsx
import type { TimelineItem } from "../../stores/message-model";

export default function CompactDivider({ item }: { item: Extract<TimelineItem, { kind: "compact" }> }) {
  return (
    <div className="my-2 flex items-center gap-2 text-xs text-[var(--leemo-ink-3)]">
      <span className="h-px flex-1 bg-[var(--leemo-line)]" />
      <span>上下文已压缩 · {item.preTokens}{item.postTokens !== undefined ? ` → ${item.postTokens}` : ""}</span>
      <span className="h-px flex-1 bg-[var(--leemo-line)]" />
    </div>
  );
}
```

> token 变量沿用 slice-1 的 `--leemo-*`（`design/tokens.css`）。`--leemo-line`/`--leemo-ink`/`--leemo-ink-2`/`--leemo-ink-3` 已存在；`--leemo-bg-deep` 见 MessageList 原用法。若某变量缺失，朴素占位阶段不影响测试通过（jsdom 不算样式）。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/timeline/cards.test.tsx`
Expected: PASS（6 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/timeline/
git commit -m "feat(fe): plain timeline card components (s2 task4)"
```

---

## Task 5: fixture 演示回合

扩 `scriptReply` 为完整「真干活」序列。**不碰 invoke default / subscribe（gate#2/gate#1）**。

**Files:**
- Modify: `src/renderer/bridge/fixtures/index.ts`（加演示脚本常量）
- Modify: `src/renderer/bridge/fixture-client.ts`（`scriptReply` 用脚本）
- Test: `src/renderer/bridge/fixture-client.test.ts`（追加演示回合断言）

**Interfaces:**
- Consumes: `LeemoEvent` from contract。
- Produces: `fixtures/index.ts` 导出 `DEMO_TURN_EVENTS: LeemoEvent[]`（不含 `conversation.started`，那个由 client 首次发）。`scriptReply` 按 `chunkDelayMs` 逐个 emit。

- [ ] **Step 1: Write the failing test**

追加到 `src/renderer/bridge/fixture-client.test.ts`：

```ts
  it("send emits a full demo turn: plan, tools, subagent, compact, result", async () => {
    vi.useFakeTimers();
    const client = new FixtureBridgeClient({ chunkDelayMs: 5 });
    const events: LeemoEvent[] = [];
    client.subscribe("bridge:event", (e) => events.push(e));

    await client.invoke("bridge:send", { conversationId: "conv-1", prompt: "整理笔记" });
    await vi.advanceTimersByTimeAsync(2000);

    const types = events.map((e) => e.type);
    expect(types).toContain("conversation.started");
    expect(events.some((e) => e.type === "tool.started" && e.name === "TodoWrite")).toBe(true);
    expect(events.some((e) => e.type === "tool.started" && e.name === "Read")).toBe(true);
    expect(events.some((e) => e.type === "tool.finished")).toBe(true);
    expect(types).toContain("subagent.activity");
    expect(types).toContain("compact.boundary");
    expect(events.at(-1)).toMatchObject({ type: "run.finished", isError: false });
    vi.useRealTimers();
  });
```

> 保留原有两个测试；原 "contract-conformant sequence" 测试用 `{ reply: "ab cd" }`——演示回合改造后仍须让它过。做法：`scriptReply` 在有自定义 `reply` 时走**简单流**（started→delta→final→finished），否则走演示回合。见 Step 3。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/bridge/fixture-client.test.ts`
Expected: FAIL（无 tool/subagent/compact 事件）。

- [ ] **Step 3: Write minimal implementation**

加到 `src/renderer/bridge/fixtures/index.ts` 末尾：

```ts
import type { LeemoEvent } from "../../../bridge/contract";

/** A scripted "real work" turn (excludes conversation.started — the client
 *  emits that once on first send). Drives slice-2 acceptance ①. */
export const DEMO_TURN_EVENTS: LeemoEvent[] = [
  { type: "text.delta", text: "好，我先通读一遍，" },
  { type: "text.delta", text: "列个计划再动手。" },
  { type: "tool.started", toolUseId: "p1", name: "TodoWrite", subagent: false, input: { todos: [
    { content: "提取《第五章-树与二叉树.pptx》全文", status: "completed" },
    { content: "检索本子内相关笔记", status: "completed" },
    { content: "归纳重点，生成复习笔记草稿", status: "in_progress" },
    { content: "写入「数据结构 / 笔记」文件夹", status: "pending" },
  ] } },
  { type: "tool.started", toolUseId: "t1", name: "Read", subagent: false, input: { file: "第五章-树与二叉树.pptx" } },
  { type: "tool.finished", toolUseId: "t1", isError: false, contentSummary: "38 页 · 2,146 字" },
  { type: "tool.started", toolUseId: "t2", name: "Grep", subagent: false, input: { query: "本子内相关笔记" } },
  { type: "tool.finished", toolUseId: "t2", isError: false, contentSummary: "命中 4 条" },
  { type: "subagent.activity", parentToolUseId: "sa1" },
  { type: "tool.started", toolUseId: "t3", name: "Write", subagent: true, input: { file: "草稿.md" } },
  { type: "tool.finished", toolUseId: "t3", isError: false, contentSummary: "草稿完成" },
  { type: "compact.boundary", trigger: "auto", preTokens: 12000, postTokens: 3200 },
  { type: "text.delta", text: "草稿好了。第五章主线是「遍历」，" },
  { type: "text.delta", text: "我配了 6 道例题和一张易错点清单。" },
  { type: "text.final", text: "草稿好了。第五章主线是「遍历」，我配了 6 道例题和一张易错点清单。" },
  { type: "usage.final", usage: {
    providerId: "deepseek", modelId: "deepseek-chat", inputTokens: 2400, outputTokens: 600,
    cacheReadTokens: 0, cacheCreationTokens: 0, costSource: "unpriced", tokensEstimated: false,
  } },
  { type: "run.finished", subtype: "success", isError: false,
    finalText: "草稿好了。第五章主线是「遍历」，我配了 6 道例题和一张易错点清单。",
    pathAudit: { claimed: [] } },
];
```

改 `fixture-client.ts` 的 import + `scriptReply`：

```ts
import { DEFAULT_MOMO_REPLY, FIXTURE_PROVIDERS, DEMO_TURN_EVENTS } from "./fixtures";
```

```ts
  /** Schedules a scripted stream. Custom `reply` → simple text stream; default
   *  → the full demo turn (plan/tools/subagent/compact/result). */
  private scriptReply(): void {
    let t = 0;
    const step = this.chunkDelayMs;
    if (!this.started) {
      this.started = true;
      setTimeout(() => this.emit({ type: "conversation.started", sessionId: this.sessionId }), (t += step));
    }
    if (this.customReply !== undefined) {
      const chunks = this.customReply.match(/\S+\s*/g) ?? [this.customReply];
      for (const chunk of chunks) setTimeout(() => this.emit({ type: "text.delta", text: chunk }), (t += step));
      setTimeout(() => this.emit({ type: "text.final", text: this.customReply as string }), (t += step));
      setTimeout(() => this.emit({
        type: "run.finished", subtype: "success", isError: false,
        finalText: this.customReply as string, pathAudit: { claimed: [] },
      }), (t += step));
      return;
    }
    for (const ev of DEMO_TURN_EVENTS) {
      setTimeout(() => this.emit(ev), (t += step));
    }
  }
```

改构造函数：区分「显式传了 reply」和默认。把 `this.reply` 换成 `this.customReply`：

```ts
  private readonly customReply: string | undefined;
  private readonly chunkDelayMs: number;
  private readonly sessionId: string;

  constructor(opts: FixtureOpts = {}) {
    this.customReply = opts.reply;
    this.chunkDelayMs = opts.chunkDelayMs ?? 24;
    this.sessionId = opts.sessionId ?? "fixture-session-1";
  }
```

> `DEFAULT_MOMO_REPLY` import 可留（其它地方可能引用）——若 lint 报未使用则删。gate#2（invoke default 分支）、gate#1（subscribe）原样不动。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/bridge/fixture-client.test.ts`
Expected: PASS（3 tests，含原 2 个）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/bridge/fixtures/index.ts src/renderer/bridge/fixture-client.ts src/renderer/bridge/fixture-client.test.ts
git commit -m "feat(fe): fixture demo turn with plan/tools/subagent/compact/result (s2 task5)"
```

---

## Task 6: Timeline 分发 + RunGroup 折叠

顶层 `Timeline` 读 store，按 runId 分组成 RunGroup；RunGroup 完成即默认折叠。替换 MessageList。

**Files:**
- Create: `src/renderer/components/timeline/Timeline.tsx`
- Create: `src/renderer/components/timeline/RunGroup.tsx`
- Create: `src/renderer/components/timeline/timeline.test.tsx`
- Modify: `src/renderer/components/BuddyShell.tsx`（MessageList→Timeline）
- Delete: `src/renderer/components/MessageList.tsx`

**Interfaces:**
- Consumes: `useConversations` from `../../bridge/context`（selector 读 `messages`）；Task 4 卡组件；`TimelineItem`。
- Produces: `Timeline`（default export，无 props，读 store）；`RunGroup`（default export，props `{ items: TimelineItem[] }` — 一个 run 的项，纯展示，折叠 state 内部 useState）。分组规则：`compact` 项无 runId → 归它前一个 run 组（或独立渲染）；文本/卡按 runId 连续分组。

- [ ] **Step 1: Write the failing test**

`src/renderer/components/timeline/timeline.test.tsx`：

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import type { TimelineItem } from "../../stores/message-model";
import RunGroup from "./RunGroup";

const RUN = "run-1";
const tool: TimelineItem = { kind: "tool", id: "t", runId: RUN, toolUseId: "t1", name: "Read", input: {}, status: "ok", summary: "38 页" };
const finalText: TimelineItem = { kind: "text", id: "x", runId: RUN, role: "momo", text: "全部搞定", streaming: false };
const result: TimelineItem = { kind: "result", id: "r", runId: RUN, isError: false, finalText: "全部搞定", pathAudit: { claimed: [] } };

describe("RunGroup progressive disclosure", () => {
  it("a finished run (has result) collapses process cards by default; final output stays visible", () => {
    render(<RunGroup items={[tool, finalText, result]} />);
    expect(screen.getByText("全部搞定")).toBeInTheDocument(); // final output always shown
    expect(screen.queryByText("Read")).not.toBeInTheDocument(); // process card collapsed
  });

  it("clicking the collapse bar reveals the process cards", () => {
    render(<RunGroup items={[tool, finalText, result]} />);
    fireEvent.click(screen.getByRole("button", { name: /过程|展开|momo/ }));
    expect(screen.getByText("Read")).toBeInTheDocument();
  });

  it("an in-progress run (no result) shows process cards expanded by default", () => {
    const running: TimelineItem = { ...tool, status: "running", summary: undefined };
    render(<RunGroup items={[running]} />);
    expect(screen.getByText("Read")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/timeline/timeline.test.tsx`
Expected: FAIL（RunGroup 不存在）。

- [ ] **Step 3: Write minimal implementation**

`RunGroup.tsx`：

```tsx
import { useState } from "react";
import type { TimelineItem } from "../../stores/message-model";
import TextBubble from "./TextBubble";
import ToolCard from "./ToolCard";
import PlanCard from "./PlanCard";
import ActivityCard from "./ActivityCard";
import ResultCard from "./ResultCard";
import CompactDivider from "./CompactDivider";

function renderItem(item: TimelineItem) {
  switch (item.kind) {
    case "text": return <TextBubble key={item.id} item={item} />;
    case "tool": return <ToolCard key={item.id} item={item} />;
    case "plan": return <PlanCard key={item.id} item={item} />;
    case "activity": return <ActivityCard key={item.id} item={item} />;
    case "result": return <ResultCard key={item.id} item={item} />;
    case "compact": return <CompactDivider key={item.id} item={item} />;
  }
}

const isProcess = (i: TimelineItem) => i.kind === "tool" || i.kind === "plan" || i.kind === "activity" || i.kind === "compact";
const isFinalOutput = (i: TimelineItem) => (i.kind === "text" && i.role === "momo") || i.kind === "result" || (i.kind === "text" && i.role === "user");

export default function RunGroup({ items }: { items: TimelineItem[] }) {
  const finished = items.some((i) => i.kind === "result");
  const [expanded, setExpanded] = useState(!finished);
  const processItems = items.filter(isProcess);
  const outputItems = items.filter(isFinalOutput);

  return (
    <div className="space-y-2">
      {processItems.length > 0 && finished && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2 text-left text-xs text-[var(--leemo-ink-3)]"
        >
          <span aria-hidden>{expanded ? "▾" : "▸"}</span>
          <span>momo 干了活 · {processItems.length} 步{expanded ? "（收起）" : "（展开过程）"}</span>
        </button>
      )}
      {(expanded || !finished) && processItems.map(renderItem)}
      {outputItems.map(renderItem)}
    </div>
  );
}
```

> 折叠时保序：S2 骨架把「过程卡」聚在折叠区、「最终输出」常驻区。穿衣拍可细化为严格时序保留；骨架阶段此简化满足验收①（进行中展开、完成折叠、最终输出常驻、可 toggle）。

`Timeline.tsx`：

```tsx
import { useConversations } from "../../bridge/context";
import type { TimelineItem } from "../../stores/message-model";
import RunGroup from "./RunGroup";

/** Groups items by runId (compact items, which have no runId, attach to the
 *  current group) and renders one RunGroup per run. */
function groupByRun(items: TimelineItem[]): TimelineItem[][] {
  const groups: TimelineItem[][] = [];
  let currentRun: string | null = null;
  for (const item of items) {
    const run = item.kind === "compact" ? currentRun : item.runId;
    if (run !== currentRun || groups.length === 0) {
      if (item.kind !== "compact") { currentRun = item.runId; groups.push([item]); continue; }
    }
    (groups[groups.length - 1] ?? groups[groups.push([]) - 1]).push(item);
  }
  return groups.filter((g) => g.length > 0);
}

export default function Timeline() {
  const messages = useConversations((s) => s.messages);
  if (messages.length === 0) return null;
  const groups = groupByRun(messages);
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4 py-4">
      {groups.map((g, i) => <RunGroup key={i} items={g} />)}
    </div>
  );
}
```

> S2 单流：`RENDERER_RUN_ID_INITIAL` 固定，所有项同一 run → 实际一个 RunGroup。`groupByRun` 为 Phase-1 多 run 预留，本片行为=单组。测试只测 RunGroup（分组逻辑简单，多 run 是 defer）。

改 `BuddyShell.tsx`：把 `import MessageList from "./MessageList";` 换成 `import Timeline from "./timeline/Timeline";`，JSX 里 `<MessageList />` 换成 `<Timeline />`。

删 `src/renderer/components/MessageList.tsx`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/timeline/timeline.test.tsx`
Expected: PASS（3 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/timeline/ src/renderer/components/BuddyShell.tsx
git rm src/renderer/components/MessageList.tsx
git commit -m "feat(fe): Timeline dispatch + RunGroup collapse; retire MessageList (s2 task6)"
```

---

## Task 7: 全量验收 — typecheck 三段 + 全测试 + guard

跑完整验收命令，确认无回归、guard 铁律命中 0。

**Files:** 无新建（验证任务）。

- [ ] **Step 1: typecheck 三段**

Run: `npm run typecheck`
Expected: 三段全 exit 0（vendor && 根 && renderer）。若 renderer 段报类型错，修到绿（常见：`Extract` variant 属性遗漏、`import type` 漏）。

- [ ] **Step 2: 全量测试 + 不回归**

Run: `npm test`
Expected: 全绿。总数 ≥ 原 241 +（本片新增：message-model ~13、cards 6、timeline 3、fixture 演示 1，减去 message-model 原 5 已并入）。**原 gateway/bridge 215 + slice-1 其余 renderer 测试不得回归。**

- [ ] **Step 3: guard 铁律确认**

Run: `npx vitest run src/renderer/components/guard.test.ts`
Expected: PASS（`components/timeline/**` 无 import `bridge/client`/`fixture-client`，offenders=[]）。

- [ ] **Step 4: 目验准备（交用户验收①）**

Run: `npm run dev`（或 `npx vite`）
人工目验：打字 Enter → momo 流式吐出短开场 → 计划卡（4 条待办）→ 工具卡（Read/Grep 完成、Write）→ 活动卡（分身）→ compact 分隔 → 流式收尾 → 结果卡；回合完成后过程卡折叠成一条，点开可展开。**朴素视觉即可（不看美丑）**。

- [ ] **Step 5: Commit（若 Step 1–3 有修复）**

```bash
git add -A
git commit -m "chore(fe): slice-2 acceptance green — typecheck ×3 + tests + guard (s2 task7)"
```

---

## Self-Review

**Spec coverage：**
- §3 数据模型（TimelineItem + reducer 6 分支）→ Task 1（text/run）+ Task 2（tool/plan/activity/compact）✓
- §4 组件层（Timeline 分发 + 卡组件 + 纯展示）→ Task 4（卡）+ Task 6（Timeline）✓
- §4a run 折叠（RunGroup 完成折叠/进行展开/toggle）→ Task 6 ✓
- §5 fixture 演示流 → Task 5 ✓
- §6 测试面（reducer 分支/fixture 契约/Timeline 分发/guard/不回归）→ Task 1,2,4,5,6 测试 + Task 7 guard/回归 ✓
- §7 禁改（gate#1/#2 不碰、bridge 只 import type）→ Task 3（保留 subscribe）、Task 5（保留 invoke default）显式声明 ✓
- TodoWrite 防御式解析 → Task 2 `parseTodos` + 畸形不崩测试 ✓

**Placeholder scan：** 无 TBD/TODO；每 code step 有完整代码。✓

**Type consistency：** `applyEvent(items, event, runId)` 三参在 Task 1/2/3 一致；`TimelineItem` variant 属性名（`toolUseId`/`childToolUseIds`/`parentToolUseId`/`pathAudit`）在 reducer/卡/测试一致；卡 props 统一 `{ item: Extract<TimelineItem, {kind}> }`；`RENDERER_RUN_ID_INITIAL` Task1 定义、Task3 消费。✓

**已知取舍（非缺陷）：** RunGroup 折叠把过程卡聚拢、最终输出常驻（非严格逐项时序）——骨架阶段满足验收①四诉求，穿衣拍可细化。多 run 分组 `groupByRun` 为 Phase-1 预留，S2 单流=单组。
