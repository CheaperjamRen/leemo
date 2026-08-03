import { describe, it, expect } from "vitest";
import { pairAskUserQuestions } from "./ask-user-pairing";
import { LEEMO_ASK_USER_TOOL_NAME } from "../../bridge/tool-names";
import type { TimelineItem } from "../../stores/message-model";
import type { PendingInteraction, ResolvedInteraction } from "../../stores/approvals";

const R = "run-1";

function askTool(id: string): TimelineItem {
  return { kind: "tool", id, runId: R, toolUseId: id, name: LEEMO_ASK_USER_TOOL_NAME, input: {}, status: "ok" };
}

const Q1 = [{ question: "选择环境？", options: [{ label: "开发" }] }];
const Q2 = [{ question: "选择区域？", options: [{ label: "北京" }] }];

function resolvedQuestion(id: string, questions = Q1): ResolvedInteraction {
  return { kind: "question", id, runId: R, questions, items: [{ selected: ["开发"] }] };
}

function pendingQuestion(id: string, conversationId = "conv-1", questions = Q1): PendingInteraction {
  return { kind: "question", id, conversationId, runId: R, questions, receivedAt: 0 };
}

describe("pairAskUserQuestions — index pairing (no toolUseId on AskUserPayload)", () => {
  it("pairs a single ask_user tool item with the single pending question", () => {
    const items = [askTool("t1")];
    const pendingByConversation = { "conv-1": pendingQuestion("q1") };
    const result = pairAskUserQuestions(items, R, pendingByConversation, {});
    expect(result.byToolIndex).toHaveLength(1);
    expect(result.byToolIndex[0]?.id).toBe("q1");
    expect(result.overflow).toEqual([]);
  });

  it("pairs a single ask_user tool item with a single resolved question", () => {
    const items = [askTool("t1")];
    const resolvedByRun = { [R]: [resolvedQuestion("q1")] };
    const result = pairAskUserQuestions(items, R, {}, resolvedByRun);
    expect(result.byToolIndex[0]?.id).toBe("q1");
    expect(result.overflow).toEqual([]);
  });

  it("pairs two ask_user tool items with resolved-then-pending, in order", () => {
    const items = [askTool("t1"), askTool("t2")];
    const resolvedByRun = { [R]: [resolvedQuestion("q1", Q1)] };
    const pendingByConversation = { "conv-1": pendingQuestion("q2", "conv-1", Q2) };
    const result = pairAskUserQuestions(items, R, pendingByConversation, resolvedByRun);
    expect(result.byToolIndex).toHaveLength(2);
    expect(result.byToolIndex[0]?.id).toBe("q1");
    expect(result.byToolIndex[1]?.id).toBe("q2");
    expect(result.overflow).toEqual([]);
  });

  it("leaves a later index undefined when its push hasn't landed yet (transient)", () => {
    const items = [askTool("t1"), askTool("t2")];
    const resolvedByRun = { [R]: [resolvedQuestion("q1")] };
    // No pending, no second resolved yet — t2's push is still in flight.
    const result = pairAskUserQuestions(items, R, {}, resolvedByRun);
    expect(result.byToolIndex[0]?.id).toBe("q1");
    expect(result.byToolIndex[1]).toBeUndefined();
    expect(result.overflow).toEqual([]);
  });

  it("puts a question in overflow when its push raced ahead of the tool item landing", () => {
    // Race: bridge:askUser arrived before the matching tool.started event was
    // folded into the timeline — zero ask_user tool items seen yet, but a
    // question already exists. Must NOT be silently dropped.
    const items: TimelineItem[] = [];
    const pendingByConversation = { "conv-1": pendingQuestion("q1") };
    const result = pairAskUserQuestions(items, R, pendingByConversation, {});
    expect(result.byToolIndex).toEqual([]);
    expect(result.overflow).toHaveLength(1);
    expect(result.overflow[0].id).toBe("q1");
  });

  it("ignores pending questions belonging to a different run", () => {
    const items = [askTool("t1")];
    const pendingByConversation = { "conv-1": pendingQuestion("q-other", "conv-1", Q1) };
    (pendingByConversation["conv-1"] as { runId: string }).runId = "run-OTHER";
    const result = pairAskUserQuestions(items, R, pendingByConversation, {});
    expect(result.byToolIndex[0]).toBeUndefined();
    expect(result.overflow).toEqual([]);
  });

  it("ignores non-question pending interactions (approvals) entirely", () => {
    const items = [askTool("t1")];
    const pendingByConversation: Record<string, PendingInteraction | null> = {
      "conv-1": {
        kind: "approval",
        id: "a1",
        conversationId: "conv-1",
        runId: R,
        toolName: "Bash",
        inputSummary: "ls",
        risk: "safe",
        receivedAt: 0,
      },
    };
    const result = pairAskUserQuestions(items, R, pendingByConversation, {});
    expect(result.byToolIndex[0]).toBeUndefined();
    expect(result.overflow).toEqual([]);
  });

  it("returns empty pairing when there are no ask_user tool items and no questions", () => {
    const result = pairAskUserQuestions([], R, {}, {});
    expect(result.byToolIndex).toEqual([]);
    expect(result.overflow).toEqual([]);
  });
});
