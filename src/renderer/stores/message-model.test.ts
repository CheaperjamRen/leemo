import { describe, it, expect } from "vitest";
import type { LeemoEvent } from "../../bridge/contract";
import { applyEvent, RENDERER_RUN_ID_INITIAL, type TimelineItem } from "./message-model";

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

  it("projects TaskUpdate status changes into the matching plan row", () => {
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
    m = applyEvent(m, {
      type: "tool.started", toolUseId: "update-2", name: "TaskUpdate", subagent: false,
      input: { taskId: "3", status: "completed" },
    }, RUN);

    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: "plan", todos: [{ text: "跑测试", status: "done", taskId: "3" }] });
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
