import { describe, it, expect } from "vitest";
import type { LeemoEvent } from "../../bridge/contract";
import { applyEvent, RENDERER_RUN_ID_INITIAL, type TimelineItem } from "./message-model";

const RUN = "run-1";

describe("applyEvent — text + run lifecycle (migrated)", () => {
  it("keeps connection and subagent retries as separate statuses", () => {
    let items = applyEvent([], {
      type: "stream.retry",
      attempt: 1,
      maxAttempts: 5,
      summary: "正在重新连接 1/5",
      detail: "socket closed",
      scope: "connection",
    }, RUN);
    items = applyEvent(items, {
      type: "stream.retry",
      attempt: 1,
      maxAttempts: 3,
      summary: "协作任务正在重试 1/3",
      detail: "upstream overloaded",
      scope: "subagent",
      retryId: "agent-a",
    }, RUN);
    items = applyEvent(items, {
      type: "stream.retry",
      attempt: 2,
      maxAttempts: 3,
      summary: "协作任务正在重试 2/3",
      detail: "upstream overloaded again",
      scope: "subagent",
      retryId: "agent-a",
    }, RUN);

    expect(items.filter((item) => item.kind === "retry")).toEqual([
      expect.objectContaining({ scope: "connection", attempt: 1 }),
      expect.objectContaining({ scope: "subagent", retryId: "agent-a", attempt: 2 }),
    ]);
  });

  it("folds reconnect attempts into one status and preserves partial output on failure", () => {
    let items = applyEvent([], { type: "text.delta", text: "已收到" }, RUN);
    items = applyEvent(items, {
      type: "stream.retry",
      attempt: 1,
      maxAttempts: 5,
      summary: "正在重新连接 1/5",
      detail: "socket closed",
    }, RUN);
    items = applyEvent(items, {
      type: "stream.retry",
      attempt: 2,
      maxAttempts: 5,
      summary: "正在重新连接 2/5",
      detail: "socket closed again",
    }, RUN);
    items = applyEvent(items, {
      type: "run.finished", subtype: "error", isError: true, finalText: "已收到",
      pathAudit: { claimed: [] },
    }, RUN);

    expect(items.filter((item) => item.kind === "retry")).toEqual([
      expect.objectContaining({
        attempt: 2,
        maxAttempts: 5,
        summary: "正在重新连接 2/5",
        detail: "socket closed again",
        state: "failed",
      }),
    ]);
    expect(items.find((item) => item.kind === "text")).toMatchObject({ text: "已收到", streaming: false });
    expect(items.at(-1)).toMatchObject({ kind: "result", isError: true, finalText: "已收到" });
  });

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

  it("records the real event time on new assistant text and the terminal result", () => {
    const at = 1_785_300_660_000;
    let m = applyEvent([], { type: "text.delta", text: "你好" }, RUN, at);
    m = applyEvent(m, {
      type: "run.finished", subtype: "success", isError: false, finalText: "你好",
      pathAudit: { claimed: [] },
    }, RUN, at + 2_000);

    expect(m.find((item) => item.kind === "text")).toMatchObject({ createdAt: at });
    expect(m.find((item) => item.kind === "result")).toMatchObject({ createdAt: at + 2_000 });
  });

  it("text.final finalizes the streaming text item", () => {
    let m: TimelineItem[] = [{ kind: "text", id: "m0", runId: RUN, role: "momo", text: "Hel", streaming: true }];
    m = applyEvent(m, { type: "text.final", text: "Hello" }, RUN);
    expect(m[0]).toMatchObject({ kind: "text", text: "Hello", streaming: false });
  });

  it("text.final replaces the streamed bubble even when usage.final landed in between (real stream order)", () => {
    // Real streams (events.ts result handling) emit: deltas → usage.final → text.final.
    // The usage item sits between the bubble and text.final — the reducer must
    // scan back to the run's momo bubble instead of only checking the last item.
    let m: TimelineItem[] = [];
    m = applyEvent(m, { type: "text.delta", text: "你好" }, RUN);
    m = applyEvent(m, { type: "text.delta", text: "呀" }, RUN);
    m = applyEvent(m, {
      type: "usage.final",
      usage: {
        providerId: "deepseek", modelId: "deepseek-chat",
        inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0,
        costSource: "local-pricing", tokensEstimated: false,
      },
    }, RUN);
    m = applyEvent(m, { type: "text.final", text: "你好呀" }, RUN);
    const textItems = m.filter((i) => i.kind === "text");
    expect(textItems).toHaveLength(1); // ← the duplicate-output bug: must NOT append a second bubble
    expect(textItems[0]).toMatchObject({ text: "你好呀", streaming: false });
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

  it("run.finished with subtype interrupted marks the result item interrupted", () => {
    let m: TimelineItem[] = [{ kind: "text", id: "m0", runId: RUN, role: "momo", text: "half", streaming: true }];
    m = applyEvent(m, {
      type: "run.finished", subtype: "interrupted", isError: false, finalText: "",
      pathAudit: { claimed: [] },
    }, RUN);
    expect(m.at(-1)).toMatchObject({ kind: "result", interrupted: true, finalText: "" });
  });

  it("run.finished with subtype success is not interrupted", () => {
    let m: TimelineItem[] = [];
    m = applyEvent(m, {
      type: "run.finished", subtype: "success", isError: false, finalText: "done",
      pathAudit: { claimed: [] },
    }, RUN);
    expect(m.at(-1)).toMatchObject({ kind: "result", interrupted: false });
  });

  it("preserves structured cancellation and retryability on the terminal result", () => {
    const cancelled = applyEvent([], {
      type: "run.finished",
      subtype: "aborted_streaming",
      outcome: "cancelled",
      retryable: false,
      isError: false,
      finalText: "",
      pathAudit: { claimed: [] },
    }, RUN);
    expect(cancelled.at(-1)).toMatchObject({
      kind: "result",
      outcome: "cancelled",
      interrupted: true,
      retryable: false,
    });

    const overloaded = applyEvent([], {
      type: "run.finished",
      subtype: "error_during_execution",
      outcome: "overloaded",
      retryable: true,
      statusCode: 529,
      isError: true,
      finalText: "",
      pathAudit: { claimed: [] },
    }, RUN);
    expect(overloaded.at(-1)).toMatchObject({
      kind: "result",
      outcome: "overloaded",
      interrupted: false,
      retryable: true,
      statusCode: 529,
    });
  });

  it("thinking.delta appends a thinking process item (streaming)", () => {
    const m = applyEvent([], { type: "thinking.delta", text: "先看看" }, RUN);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: "thinking", runId: RUN, text: "先看看", streaming: true });
  });

  it("consecutive thinking.delta merge into the same thinking item", () => {
    let m = applyEvent([], { type: "thinking.delta", text: "先看看" }, RUN);
    m = applyEvent(m, { type: "thinking.delta", text: "PPT" }, RUN);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: "thinking", text: "先看看PPT" });
  });

  it("a tool.started between thinking deltas starts a new thinking item (not merged across process)", () => {
    let m = applyEvent([], { type: "thinking.delta", text: "先看看" }, RUN);
    m = applyEvent(m, { type: "tool.started", toolUseId: "t1", name: "Read", input: {}, subagent: false }, RUN);
    m = applyEvent(m, { type: "thinking.delta", text: "再想想" }, RUN);
    expect(m).toHaveLength(3);
    expect(m[0]).toMatchObject({ kind: "thinking", text: "先看看" });
    expect(m[1]).toMatchObject({ kind: "tool" });
    expect(m[2]).toMatchObject({ kind: "thinking", text: "再想想" });
  });

  it("text.delta after thinking starts a separate text item (thinking is not answer text)", () => {
    let m = applyEvent([], { type: "thinking.delta", text: "内心" }, RUN);
    m = applyEvent(m, { type: "text.delta", text: "回答" }, RUN);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ kind: "thinking", text: "内心" });
    expect(m[1]).toMatchObject({ kind: "text", role: "momo", text: "回答" });
  });

  it("run.finished clears streaming on a live thinking item", () => {
    let m = applyEvent([], { type: "thinking.delta", text: "想" }, RUN);
    m = applyEvent(m, { type: "run.finished", subtype: "success", isError: false, finalText: "done", pathAudit: { claimed: [] } }, RUN);
    const thinking = m.find((it) => it.kind === "thinking");
    expect(thinking).toMatchObject({ kind: "thinking", streaming: false });
  });
});

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

  it("keeps a denied tool result distinct from an execution failure", () => {
    let m: TimelineItem[] = applyEvent([], {
      type: "tool.started", toolUseId: "t1", name: "Write", input: {}, subagent: false,
    }, RUN);
    m = applyEvent(m, {
      type: "tool.finished",
      toolUseId: "t1",
      isError: true,
      outcome: "denied",
      contentSummary: "没有获得写入权限",
      userFeedback: "请不要修改这个文件",
    }, RUN);
    expect(m[0]).toMatchObject({
      kind: "tool",
      status: "error",
      outcome: "denied",
      summary: "没有获得写入权限",
      userFeedback: "请不要修改这个文件",
    });
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

  it("does not invent a todo status when TodoWrite omits a supported structured status", () => {
    const m = applyEvent([], {
      type: "tool.started", toolUseId: "p3", name: "TodoWrite", subagent: false,
      input: { todos: [{ content: "没有真实状态" }] },
    }, RUN);

    expect(m[0]).toMatchObject({ kind: "tool", name: "TodoWrite", status: "running" });
  });

  it("coalesces repeated TodoWrite updates from one run into one current plan", () => {
    let m = applyEvent([], {
      type: "tool.started", toolUseId: "p1", name: "TodoWrite", subagent: false,
      input: { todos: [{ content: "先检查", status: "in_progress" }] },
    }, RUN);
    m = applyEvent(m, {
      type: "tool.started", toolUseId: "p2", name: "TodoWrite", subagent: false,
      input: { todos: [
        { content: "先检查", status: "completed" },
        { content: "再修复", status: "in_progress" },
      ] },
    }, RUN);

    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({
      kind: "plan",
      toolUseId: "p2",
      todos: [
        { text: "先检查", status: "done" },
        { text: "再修复", status: "active" },
      ],
    });
  });

  it("coalesces current SDK TaskCreate calls into one visible plan", () => {
    let m: TimelineItem[] = [];
    m = applyEvent(m, {
      type: "tool.started", toolUseId: "create-1", name: "TaskCreate", subagent: false,
      input: { subject: "读测试", description: "Inspect failures", activeForm: "Reading tests" },
    }, RUN);
    m = applyEvent(m, {
      type: "tool.finished", toolUseId: "create-1", isError: false,
      contentSummary: "Task #7 created successfully: 读测试",
    }, RUN);
    m = applyEvent(m, {
      type: "tool.started", toolUseId: "create-2", name: "TaskCreate", subagent: false,
      input: { subject: "修实现", description: "Fix implementation", activeForm: "Fixing" },
    }, RUN);
    m = applyEvent(m, {
      type: "tool.finished", toolUseId: "create-2", isError: false,
      contentSummary: "Task #8 created successfully: 修实现",
    }, RUN);

    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: "plan", todos: [
      { text: "读测试", status: "todo", taskId: "7" },
      { text: "修实现", status: "todo", taskId: "8" },
    ] });
  });

  it("does not publish a TaskCreate row until the structured tool call succeeds", () => {
    let m: TimelineItem[] = applyEvent([], {
      type: "tool.started", toolUseId: "create-1", name: "TaskCreate", subagent: false,
      input: { subject: "不会提前出现" },
    }, RUN);

    expect(m).toEqual([expect.objectContaining({
      kind: "tool", toolUseId: "create-1", name: "TaskCreate", status: "running",
    })]);

    m = applyEvent(m, {
      type: "tool.finished", toolUseId: "create-1", isError: true,
      contentSummary: "creation failed",
    }, RUN);

    expect(m.some((item) => item.kind === "plan")).toBe(false);
    expect(m).toEqual([expect.objectContaining({ kind: "tool", status: "error" })]);
  });

  it("commits TaskUpdate only after success and leaves confirmed status unchanged on failure", () => {
    let m: TimelineItem[] = [];
    m = applyEvent(m, {
      type: "tool.started", toolUseId: "create-1", name: "TaskCreate", subagent: false,
      input: { subject: "跑测试" },
    }, RUN);
    m = applyEvent(m, {
      type: "tool.finished", toolUseId: "create-1", isError: false,
      contentSummary: "Task #3 created successfully: 跑测试",
    }, RUN);
    m = applyEvent(m, {
      type: "tool.started", toolUseId: "update-1", name: "TaskUpdate", subagent: false,
      input: { taskId: "3", status: "in_progress" },
    }, RUN);
    expect(m.find((item) => item.kind === "plan")).toMatchObject({
      kind: "plan", todos: [{ text: "跑测试", status: "todo", taskId: "3" }],
    });
    m = applyEvent(m, {
      type: "tool.finished", toolUseId: "update-1", isError: true,
      contentSummary: "update failed",
    }, RUN);
    expect(m.find((item) => item.kind === "plan")).toMatchObject({
      kind: "plan", todos: [{ text: "跑测试", status: "todo", taskId: "3" }],
    });
    m = applyEvent(m, {
      type: "tool.started", toolUseId: "update-2", name: "TaskUpdate", subagent: false,
      input: { taskId: "3", status: "completed" },
    }, RUN);
    expect(m.find((item) => item.kind === "plan")).toMatchObject({
      kind: "plan", todos: [{ text: "跑测试", status: "todo", taskId: "3" }],
    });
    m = applyEvent(m, {
      type: "tool.finished", toolUseId: "update-2", isError: false,
      contentSummary: "Task #3 updated",
    }, RUN);

    expect(m.filter((item) => item.kind === "plan")).toHaveLength(1);
    expect(m.find((item) => item.kind === "plan")).toMatchObject({
      kind: "plan", todos: [{ text: "跑测试", status: "done", taskId: "3" }],
    });
  });

  it("malformed TaskCreate and unknown TaskUpdate degrade to ordinary tool cards", () => {
    let m = applyEvent([], { type: "tool.started", toolUseId: "bad-create", name: "TaskCreate", input: {}, subagent: false }, RUN);
    expect(m[0]).toMatchObject({ kind: "tool", name: "TaskCreate" });
    m = applyEvent(m, {
      type: "tool.started", toolUseId: "bad-update", name: "TaskUpdate",
      input: { taskId: "missing", status: "completed" }, subagent: false,
    }, RUN);
    expect(m.at(-1)).toMatchObject({ kind: "tool", name: "TaskUpdate" });
  });

  it("subagent.activity appends an activity item; subagent tool.started nests into it", () => {
    let m: TimelineItem[] = applyEvent([], { type: "subagent.activity", parentToolUseId: "a1" }, RUN);
    expect(m[0]).toMatchObject({ kind: "activity", parentToolUseId: "a1", childToolUseIds: [], tools: [], transcript: [] });
    m = applyEvent(m, { type: "tool.started", toolUseId: "c1", name: "Grep", input: { pattern: "artifact" }, subagent: true, parentToolUseId: "a1" }, RUN);
    expect(m).toHaveLength(1);
    if (m[0].kind === "activity") {
      expect(m[0].childToolUseIds).toEqual(["c1"]);
      expect(m[0].tools).toEqual([{ toolUseId: "c1", name: "Grep", input: { pattern: "artifact" }, status: "running" }]);
    }

    m = applyEvent(m, { type: "tool.finished", toolUseId: "c1", isError: false, contentSummary: "3 matches", parentToolUseId: "a1" }, RUN);
    if (m[0].kind === "activity") {
      expect(m[0].tools[0]).toEqual({ toolUseId: "c1", name: "Grep", input: { pattern: "artifact" }, status: "ok", summary: "3 matches" });
    }
  });

  it("keeps subagent text and thinking inside its own activity", () => {
    let m: TimelineItem[] = applyEvent([], { type: "subagent.activity", parentToolUseId: "a1" }, RUN);
    m = applyEvent(m, { type: "subagent.output", parentToolUseId: "a1", kind: "thinking", text: "先读测试" }, RUN);
    m = applyEvent(m, { type: "subagent.output", parentToolUseId: "a1", kind: "text", text: "找到原因" }, RUN);

    expect(m).toHaveLength(1);
    if (m[0].kind === "activity") {
      expect(m[0].transcript).toEqual([
        { kind: "thinking", text: "先读测试" },
        { kind: "text", text: "找到原因" },
      ]);
    }
  });

  it("folds the parent Agent call into one identified activity with trustworthy timing", () => {
    let m: TimelineItem[] = applyEvent([], {
      type: "tool.started",
      toolUseId: "agent-1",
      name: "Agent",
      input: {
        subagent_type: "Explore",
        description: "比较三款桌面 Agent 的设置流程",
        prompt: "读取实现并形成证据。",
      },
      subagent: false,
    }, RUN, 1_000);
    m = applyEvent(m, {
      type: "subagent.activity",
      parentToolUseId: "agent-1",
    }, RUN, 1_200);

    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({
      kind: "activity",
      parentToolUseId: "agent-1",
      role: "调研助手",
      task: "比较三款桌面 Agent 的设置流程",
      status: "running",
      startedAt: 1_000,
    });

    m = applyEvent(m, {
      type: "subagent.output",
      parentToolUseId: "agent-1",
      kind: "text",
      text: "找到关键差异",
    }, RUN, 9_000);
    m = applyEvent(m, {
      type: "tool.finished",
      toolUseId: "agent-1",
      isError: false,
      contentSummary: "完成",
    }, RUN, 9_500);

    expect(m[0]).toMatchObject({ kind: "activity", status: "ok", updatedAt: 9_500 });
    if (m[0].kind === "activity") {
      expect(m[0].transcript).toEqual([
        { kind: "text", text: "找到关键差异", createdAt: 9_000 },
      ]);
    }
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

describe("applyEvent — usage + error (slice 2.5)", () => {
  const RUN = "run-1";
  it("usage.final appends a usage item carrying the UsageRecord", () => {
    const m = applyEvent([], { type: "usage.final", usage: {
      providerId: "deepseek", modelId: "deepseek-chat", inputTokens: 2400, outputTokens: 600,
      cacheReadTokens: 0, cacheCreationTokens: 0, costSource: "unpriced", tokensEstimated: false,
    } }, RUN);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: "usage", runId: RUN });
    if (m[0].kind === "usage") {
      expect(m[0].usage.inputTokens).toBe(2400);
      expect(m[0].usage.outputTokens).toBe(600);
    }
  });

  it("error appends an error item with the message", () => {
    const m = applyEvent([], { type: "error", message: "run failed" }, RUN);
    expect(m[0]).toMatchObject({ kind: "error", runId: RUN, message: "run failed" });
  });

  it("thinking.delta now appends a thinking process item (no longer deferred)", () => {
    const start: TimelineItem[] = [{ kind: "text", id: "m0", runId: RUN, role: "momo", text: "x", streaming: false }];
    const m = applyEvent(start, { type: "thinking.delta", text: "…" }, RUN);
    expect(m).toHaveLength(2);
    expect(m[1]).toMatchObject({ kind: "thinking", text: "…", streaming: true });
  });
});

describe("applyEvent — lightweight memory receipt", () => {
  const globalScope = { type: "global" as const };

  it("folds a successful memory change into a zero-height timeline item", () => {
    const items = applyEvent([], {
      type: "memory.changed",
      changeId: "change-1",
      action: "remembered",
      label: "用户喜欢先看结论",
      scope: globalScope,
    }, RUN);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "memory",
      runId: RUN,
      changeId: "change-1",
      action: "remembered",
      label: "用户喜欢先看结论",
      scope: globalScope,
      undone: false,
    });
  });

  it("keeps only the latest memory receipt from the same run", () => {
    let items = applyEvent([], {
      type: "memory.changed",
      changeId: "change-1",
      action: "remembered",
      label: "第一条",
      scope: globalScope,
    }, RUN);
    items = applyEvent(items, {
      type: "memory.changed",
      changeId: "change-2",
      action: "updated",
      label: "第二条",
      scope: globalScope,
    }, RUN);

    expect(items.filter((item) => item.kind === "memory")).toHaveLength(1);
    expect(items.find((item) => item.kind === "memory")).toMatchObject({
      changeId: "change-2",
      label: "第二条",
    });
  });

  it("marks the matching receipt undone without appending another visible item", () => {
    const originalRun = "run-original";
    let items = applyEvent([], {
      type: "memory.changed",
      changeId: "change-1",
      action: "remembered",
      label: "用户喜欢先看结论",
      scope: globalScope,
    }, originalRun);
    items = applyEvent(items, {
      type: "memory.changed",
      changeId: "undo-1",
      targetChangeId: "change-1",
      action: "undone",
      label: "用户喜欢先看结论",
      scope: globalScope,
    }, RENDERER_RUN_ID_INITIAL);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "memory",
      runId: originalRun,
      changeId: "change-1",
      undone: true,
      undoChangeId: "undo-1",
    });
  });

  it("does not mutate another receipt when the undo target is unknown", () => {
    let items = applyEvent([], {
      type: "memory.changed",
      changeId: "change-1",
      action: "remembered",
      label: "用户喜欢先看结论",
      scope: globalScope,
    }, RUN);
    items = applyEvent(items, {
      type: "memory.changed",
      changeId: "undo-1",
      targetChangeId: "missing",
      action: "undone",
      label: "不存在的记忆",
      scope: globalScope,
    }, RENDERER_RUN_ID_INITIAL);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ changeId: "change-1", undone: false });
  });
});

describe("applyEvent — lightweight file change receipt", () => {
  it("folds a real file change into one zero-height item for the current run", () => {
    const items = applyEvent([], {
      type: "file.changed",
      path: "课程笔记/第一章.md",
      workspacePath: "数据结构/课程笔记/第一章.md",
      change: "modified",
    } as unknown as LeemoEvent, RUN);

    expect(items).toEqual([expect.objectContaining({
      kind: "files",
      runId: RUN,
      changes: [{
        path: "课程笔记/第一章.md",
        workspacePath: "数据结构/课程笔记/第一章.md",
        change: "modified",
      }],
    })]);
  });

  it("aggregates different paths into one receipt and keeps first-seen order", () => {
    let items = applyEvent([], {
      type: "file.changed", path: "先出现.md", change: "modified",
    }, RUN);
    items = applyEvent(items, {
      type: "file.changed", path: "后出现.md", change: "added",
    }, RUN);
    items = applyEvent(items, {
      type: "file.changed", path: "先出现.md", change: "modified",
    }, RUN);

    expect(items.filter((item) => item.kind === "files")).toHaveLength(1);
    expect(items.find((item) => item.kind === "files")).toMatchObject({
      changes: [
        { path: "先出现.md", change: "modified" },
        { path: "后出现.md", change: "added" },
      ],
    });
  });

  it("reports net changes instead of every intermediate filesystem event", () => {
    let items: TimelineItem[] = [];
    items = applyEvent(items, { type: "file.changed", path: "临时.md", change: "added" }, RUN);
    items = applyEvent(items, { type: "file.changed", path: "临时.md", change: "modified" }, RUN);
    items = applyEvent(items, { type: "file.changed", path: "临时.md", change: "deleted" }, RUN);
    expect(items.some((item) => item.kind === "files")).toBe(false);

    items = applyEvent(items, { type: "file.changed", path: "原文件.md", change: "deleted" }, RUN);
    items = applyEvent(items, { type: "file.changed", path: "原文件.md", change: "added" }, RUN);
    expect(items.find((item) => item.kind === "files")).toMatchObject({
      changes: [{ path: "原文件.md", change: "modified" }],
    });
  });

  it("keeps the omitted count on the compact receipt", () => {
    const items = applyEvent([], {
      type: "file.changed",
      path: "前 100 个之一.md",
      change: "modified",
      omitted: 23,
    }, RUN);

    expect(items[0]).toMatchObject({ kind: "files", omitted: 23 });
  });
});

describe("applyEvent — persisted work overview", () => {
  const toolName = "mcp__leemo-work-overview__set_work_overview";

  it("migrates the newest legacy overview into revision metadata and retains both revisions", () => {
    const existing: TimelineItem = {
      kind: "overview",
      id: "old-overview",
      runId: "run-1",
      toolUseId: "overview-1",
      createdAt: 100,
      overview: {
        theme: "Leemo 内测",
        summary: "聚焦可安装候选包",
        currentPosition: "正在补齐概览",
        nextStep: "打包验收",
        focus: "PDF 阅读准确性",
      },
    };
    let items = applyEvent([existing], {
      type: "tool.started",
      toolUseId: "overview-2",
      name: toolName,
      input: {
        currentPhase: "验收中",
        updateReason: "phase-changed",
      },
      subagent: false,
    }, "run-2", 150, "conv-a");

    items = applyEvent(items, {
      type: "tool.finished",
      toolUseId: "overview-2",
      isError: false,
      contentSummary: "工作概览已更新。",
    }, "run-2", 200, "conv-a");

    expect(items.at(-1)).toMatchObject({
      kind: "overview",
      id: "m1",
      runId: "run-2",
      toolUseId: "overview-2",
      createdAt: 200,
      overview: {
        revision: 2,
        scopeConversationId: "conv-a",
        sourceRunId: "run-2",
        sourceToolUseId: "overview-2",
        updatedAt: 200,
        updateReason: "phase-changed",
        objective: "Leemo 内测",
        currentPhase: "验收中",
      },
    });
    expect(items.filter((item) => item.kind === "overview")).toHaveLength(2);
  });

  it("keeps a failed or malformed update visible as an ordinary tool result", () => {
    let failed = applyEvent([], {
      type: "tool.started", toolUseId: "failed", name: toolName,
      input: { objective: "新目标", updateReason: "objective-set" }, subagent: false,
    }, RUN, 10, "conv-a");
    failed = applyEvent(failed, {
      type: "tool.finished", toolUseId: "failed", isError: true, contentSummary: "保存失败",
    }, RUN, 20, "conv-a");
    expect(failed[0]).toMatchObject({ kind: "tool", status: "error", summary: "保存失败" });

    let malformed = applyEvent([], {
      type: "tool.started", toolUseId: "bad", name: toolName,
      input: { currentPhase: "缺少更新原因" }, subagent: false,
    }, RUN, 30, "conv-a");
    malformed = applyEvent(malformed, {
      type: "tool.finished", toolUseId: "bad", isError: false, contentSummary: "unexpected",
    }, RUN, 40, "conv-a");
    expect(malformed[0]).toMatchObject({ kind: "tool", status: "ok" });
  });

  it("applies explicit clearing and deduplicates appended evidence by evidence id", () => {
    const existing: TimelineItem = {
      kind: "overview",
      id: "old",
      runId: "run-1",
      toolUseId: "overview-1",
      createdAt: 100,
      overview: {
        revision: 1,
        scopeConversationId: "conv-a",
        sourceRunId: "run-1",
        sourceToolUseId: "overview-1",
        updatedAt: 100,
        updateReason: "blocked",
        basisEventIds: ["run-1", "overview-1"],
        actor: "momo",
        objective: "完成连续性验收",
        objectiveSource: "semantic",
        successCriteria: ["重启后仍可读取"],
        currentPhase: "修复中",
        currentFocus: "排查阻塞",
        nextKnown: ["重跑验收"],
        blockers: ["host offline"],
        decisions: [],
        completedHighlights: [
          { evidenceId: "tool-a", text: "已完成存储迁移", basisEventIds: ["tool-a"] },
        ],
        fieldAuthority: { objective: "momo", successCriteria: "momo" },
      },
    };
    let items = applyEvent([existing], {
      type: "tool.started",
      toolUseId: "overview-2",
      name: toolName,
      input: {
        blockers: [],
        clearFields: ["currentFocus"],
        completedHighlights: [
          { evidenceId: "tool-a", text: "重复条目不应追加", basisEventIds: ["tool-a"] },
          { evidenceId: "artifact-b", text: "已生成验收包", basisEventIds: ["artifact-b"] },
        ],
        updateReason: "recovered",
      },
      subagent: false,
    }, "run-2", 150, "conv-a");
    items = applyEvent(items, {
      type: "tool.finished", toolUseId: "overview-2", isError: false, contentSummary: "工作概览已更新。",
    }, "run-2", 200, "conv-a");

    expect(items.at(-1)).toMatchObject({
      kind: "overview",
      overview: {
        revision: 2,
        blockers: [],
        completedHighlights: [
          { evidenceId: "tool-a", text: "已完成存储迁移" },
          { evidenceId: "artifact-b", text: "已生成验收包" },
        ],
      },
    });
    const latest = items.at(-1);
    expect(latest?.kind === "overview" ? latest.overview : {}).not.toHaveProperty("currentFocus");
    expect(items.filter((item) => item.kind === "overview")).toHaveLength(2);
  });

  it("does not merge a partial patch with another conversation's snapshot", () => {
    const foreign: TimelineItem = {
      kind: "overview",
      id: "foreign",
      runId: "run-b",
      toolUseId: "overview-b",
      overview: {
        revision: 4,
        scopeConversationId: "conv-b",
        sourceRunId: "run-b",
        sourceToolUseId: "overview-b",
        updatedAt: 100,
        updateReason: "objective-set",
        basisEventIds: ["run-b", "overview-b"],
        actor: "momo",
        objective: "只属于 B 的目标",
        objectiveSource: "semantic",
        successCriteria: [],
        nextKnown: [],
        blockers: [],
        decisions: [],
        completedHighlights: [],
        fieldAuthority: { objective: "momo" },
      },
    };
    let items = applyEvent([foreign], {
      type: "tool.started",
      toolUseId: "overview-a",
      name: toolName,
      input: { currentFocus: "A 的当前重点", updateReason: "phase-changed" },
      subagent: false,
    }, "run-a", 150, "conv-a");
    items = applyEvent(items, {
      type: "tool.finished", toolUseId: "overview-a", isError: false, contentSummary: "工作概览已更新。",
    }, "run-a", 200, "conv-a");

    expect(items.at(-1)).toMatchObject({
      kind: "overview",
      overview: {
        revision: 1,
        scopeConversationId: "conv-a",
        currentFocus: "A 的当前重点",
      },
    });
    const latest = items.at(-1);
    expect(latest?.kind === "overview" ? latest.overview : {}).not.toHaveProperty("objective");
  });

  it("orders overlapping overview revisions by completion instead of tool start", () => {
    const first: TimelineItem = {
      kind: "overview",
      id: "overview-1",
      runId: "run-1",
      toolUseId: "overview-1",
      createdAt: 100,
      overview: {
        revision: 1,
        scopeConversationId: "conv-a",
        sourceRunId: "run-1",
        sourceToolUseId: "overview-1",
        updatedAt: 100,
        updateReason: "objective-set",
        basisEventIds: ["run-1", "overview-1"],
        actor: "momo",
        objective: "完成连续性验收",
        objectiveSource: "semantic",
        successCriteria: [],
        nextKnown: [],
        blockers: [],
        decisions: [],
        completedHighlights: [],
        fieldAuthority: { objective: "momo" },
      },
    };
    let items = applyEvent([first], {
      type: "tool.started",
      toolUseId: "overview-a",
      name: toolName,
      input: { currentPhase: "A 完成较晚", updateReason: "phase-changed" },
      subagent: false,
    }, "run-2", 110, "conv-a");
    items = applyEvent(items, {
      type: "tool.started",
      toolUseId: "overview-b",
      name: toolName,
      input: { currentFocus: "B 先完成", updateReason: "phase-changed" },
      subagent: false,
    }, "run-2", 120, "conv-a");
    items = applyEvent(items, {
      type: "tool.finished",
      toolUseId: "overview-b",
      isError: false,
      contentSummary: "工作概览已更新。",
    }, "run-2", 200, "conv-a");
    items = applyEvent(items, {
      type: "tool.finished",
      toolUseId: "overview-a",
      isError: false,
      contentSummary: "工作概览已更新。",
    }, "run-2", 300, "conv-a");

    const revisions = items.filter(
      (item): item is Extract<TimelineItem, { kind: "overview" }> => item.kind === "overview",
    );
    expect(revisions.map((item) => item.overview.revision)).toEqual([1, 2, 3]);
    expect(revisions.at(-1)).toMatchObject({
      toolUseId: "overview-a",
      overview: {
        revision: 3,
        sourceToolUseId: "overview-a",
        updatedAt: 300,
      },
    });
  });
});
