import { describe, expect, it } from "vitest";
import type { PendingInteraction } from "./approvals";
import type { TimelineItem } from "./message-model";
import { deriveConversationMarker, deriveConversationStatus } from "./conversation-status";

const user = (runId = "run-1"): TimelineItem => ({
  kind: "text",
  id: `user-${runId}`,
  runId,
  role: "user",
  text: "开始任务",
  streaming: false,
});

const result = (
  overrides: Partial<Extract<TimelineItem, { kind: "result" }>> = {},
): Extract<TimelineItem, { kind: "result" }> => ({
  kind: "result",
  id: "result-1",
  runId: "run-1",
  isError: false,
  interrupted: false,
  finalText: "完成",
  pathAudit: { claimed: [] },
  ...overrides,
});

const pending = (kind: "approval" | "question"): PendingInteraction => kind === "approval"
  ? {
      kind,
      id: "approval-1",
      conversationId: "conv-1",
      runId: "run-1",
      toolName: "Write",
      inputSummary: "写入文件",
      risk: "moderate",
      receivedAt: 1,
    }
  : {
      kind,
      id: "question-1",
      conversationId: "conv-1",
      runId: "run-1",
      questions: [{ question: "放在哪里？", options: [] }],
      receivedAt: 1,
    };

describe("deriveConversationStatus", () => {
  it("returns waiting for a new conversation and a more specific recovery state for a restored unfinished turn", () => {
    expect(deriveConversationStatus({ timeline: [], activeRunId: null, pending: null })).toMatchObject({
      kind: "waiting",
      label: "待开始",
    });
    expect(deriveConversationStatus({ timeline: [user()], activeRunId: null, pending: null })).toEqual({
      kind: "waiting",
      label: "等待继续",
      detail: "上次停在这里，可以继续",
      runId: "run-1",
    });
  });

  it("returns running only when this process owns a live run", () => {
    expect(deriveConversationStatus({ timeline: [user()], activeRunId: "run-1", pending: null })).toMatchObject({
      kind: "running",
      label: "进行中",
      runId: "run-1",
    });
  });

  it("gives pending approval and question precedence over running", () => {
    expect(deriveConversationStatus({ timeline: [user()], activeRunId: "run-1", pending: pending("approval") })).toMatchObject({
      kind: "blocked",
      label: "等你确认",
    });
    expect(deriveConversationStatus({ timeline: [user()], activeRunId: "run-1", pending: pending("question") })).toMatchObject({
      kind: "blocked",
      label: "等你回答",
    });
  });

  it.each([
    [{ isError: true }, "failed", "失败"],
    [{ interrupted: true }, "canceled", "已中断"],
    [{}, "completed", "已完成"],
  ] as const)("maps a terminal result to %s", (overrides, kind, label) => {
    expect(deriveConversationStatus({
      timeline: [user(), result(overrides)],
      activeRunId: null,
      pending: null,
    })).toMatchObject({ kind, label, runId: "run-1" });
  });

  it("treats an explicit terminal error item as failed when no result survived", () => {
    expect(deriveConversationStatus({
      timeline: [user(), { kind: "error", id: "error-1", runId: "run-1", message: "network" }],
      activeRunId: null,
      pending: null,
    })).toMatchObject({ kind: "failed", label: "失败" });
  });

  it("ignores a stale interaction from another run", () => {
    expect(deriveConversationStatus({
      timeline: [user("run-2")],
      activeRunId: "run-2",
      pending: pending("approval"),
    })).toMatchObject({ kind: "running", runId: "run-2" });
  });

  it("collapses process state into one mutually exclusive attention marker", () => {
    const base = { detail: "详情", runId: "run-1" } as const;
    expect(deriveConversationMarker({
      status: { ...base, kind: "running", label: "进行中" },
      unread: true,
    })).toBe("running");
    expect(deriveConversationMarker({
      status: { ...base, kind: "failed", label: "失败" },
      unread: true,
    })).toBe("error");
    expect(deriveConversationMarker({
      status: { ...base, kind: "blocked", label: "等你确认" },
      unread: false,
    })).toBe("unread");
    expect(deriveConversationMarker({
      status: { ...base, kind: "completed", label: "已完成" },
      unread: true,
    })).toBe("unread");
    expect(deriveConversationMarker({
      status: { ...base, kind: "completed", label: "已完成" },
      unread: false,
    })).toBeNull();
  });
});
