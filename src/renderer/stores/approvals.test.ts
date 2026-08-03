import { describe, expect, it, vi } from "vitest";
import type {
  ApprovalRequest,
  AskUserPayload,
  AskUserAnswerItem,
  WhitelistEntry,
} from "../../bridge/contract";
import type { BridgeClient } from "../bridge/client";
import type { BridgeInvokeMap } from "../../bridge/contract";
import {
  createApprovalsStore,
  foldApprovalRequest,
  foldAskUser,
  type ApprovalsData,
} from "./approvals";

const approval = (conversationId: string, id: string, runId = "run-1"): ApprovalRequest => ({
  id,
  conversationId,
  toolName: "Read",
  inputSummary: "Read notes.txt",
  risk: "safe",
});

const question = (conversationId: string, id: string): AskUserPayload => ({
  id,
  conversationId,
  questions: [{ question: "Which format?", options: [{ label: "plain" }] }],
});

function fakeClient(
  invoke: (channel: keyof BridgeInvokeMap, req: unknown) => Promise<unknown> = async () => undefined,
) {
  const calls: { channel: keyof BridgeInvokeMap; req: unknown }[] = [];
  const client: BridgeClient = {
    invoke: async (channel, req) => {
      calls.push({ channel, req });
      return (await invoke(channel, req)) as never;
    },
    subscribe: () => () => undefined,
  };
  return { client, calls };
}

const dataOf = (store: ReturnType<typeof createApprovalsStore>): ApprovalsData => {
  const { pendingByConversation, resolvedByRun } = store.getState();
  return { pendingByConversation, resolvedByRun };
};

describe("approvals pure reducers", () => {
  it("starts empty and folds each payload cid with the supplied runId/time", () => {
    const initial: ApprovalsData = { pendingByConversation: {}, resolvedByRun: {} };
    const original = structuredClone(initial);
    const withApproval = foldApprovalRequest(initial, approval("conversation-a", "a1"), "run-a", 101);
    const withQuestion = foldAskUser(withApproval, question("conversation-b", "b1"), "run-b", 202);

    expect(withApproval.pendingByConversation["conversation-a"]).toEqual({
      kind: "approval", id: "a1", conversationId: "conversation-a", runId: "run-a",
      toolName: "Read", inputSummary: "Read notes.txt", risk: "safe", receivedAt: 101,
    });
    expect(withQuestion.pendingByConversation["conversation-b"]).toMatchObject({
      kind: "question", id: "b1", conversationId: "conversation-b", runId: "run-b", receivedAt: 202,
    });
    expect(initial).toEqual(original);
    expect(withQuestion.pendingByConversation["conversation-a"]).toEqual(withApproval.pendingByConversation["conversation-a"]);
  });

  it("replaces the same conversation's card and archives the old card as cancelled", () => {
    const initial: ApprovalsData = { pendingByConversation: {}, resolvedByRun: {} };
    const first = foldApprovalRequest(initial, approval("conversation-a", "a1"), "run-a", 101);
    const second = foldAskUser(first, question("conversation-a", "a2"), "run-b", 202);

    expect(second.pendingByConversation["conversation-a"]).toMatchObject({ kind: "question", id: "a2" });
    expect(second.resolvedByRun["run-a"]).toEqual([{
      kind: "approval", id: "a1", runId: "run-a", toolName: "Read",
      inputSummary: "Read notes.txt", risk: "safe", outcome: "cancelled",
    }]);
    expect(first.resolvedByRun).toEqual({});
  });
});

describe("approvals actions", () => {
  it("has a vacuum initial state", () => {
    const { client } = fakeClient();
    expect(createApprovalsStore(client).getState()).toMatchObject({
      pendingByConversation: {}, resolvedByRun: {}, whitelist: [],
    });
  });

  it("decide greys the approval before invoke and retains the resolved audit card", async () => {
    let resolveInvoke!: () => void;
    const invokeDone = new Promise<void>((resolve) => { resolveInvoke = resolve; });
    const { client, calls } = fakeClient(async () => invokeDone);
    const store = createApprovalsStore(client, { now: () => 777 });
    store.setState((state) => foldApprovalRequest(state, approval("conversation-a", "a1"), "run-a", 777));

    const deciding = store.getState().decide("a1", "allow-once");
    expect(store.getState().pendingByConversation).toEqual({ "conversation-a": null });
    expect(store.getState().resolvedByRun["run-a"]).toEqual([{
      kind: "approval", id: "a1", runId: "run-a", toolName: "Read",
      inputSummary: "Read notes.txt", risk: "safe", outcome: "allow-once",
    }]);
    expect(calls).toEqual([{ channel: "bridge:approvalDecision", req: { id: "a1", decision: "allow-once" } }]);
    resolveInvoke();
    await deciding;
    expect(store.getState().resolvedByRun["run-a"]).toHaveLength(1);
  });

  it("answers only questions and sends the exact answer payload", async () => {
    const { client, calls } = fakeClient();
    const store = createApprovalsStore(client);
    const items: AskUserAnswerItem[] = [{ selected: ["plain"], other: "safe supplement" }];
    store.setState((state) => foldAskUser(state, question("conversation-a", "q1"), "run-q", 9));

    await store.getState().answer("q1", items);
    expect(calls).toEqual([{ channel: "bridge:askUserAnswer", req: { id: "q1", items } }]);
    expect(store.getState().pendingByConversation["conversation-a"]).toBeNull();
    expect(store.getState().resolvedByRun["run-q"]).toEqual([{
      kind: "question", id: "q1", runId: "run-q", questions: question("conversation-a", "q1").questions, items,
    }]);
  });

  it("does not invoke when id is absent or kind is mismatched", async () => {
    const { client, calls } = fakeClient();
    const store = createApprovalsStore(client);
    store.setState((state) => foldAskUser(state, question("conversation-a", "q1"), "run-q", 9));
    await store.getState().decide("q1", "deny");
    await store.getState().answer("missing", []);
    expect(calls).toEqual([]);
    expect(store.getState().pendingByConversation["conversation-a"]).toMatchObject({ kind: "question", id: "q1" });
  });

  it("rolls back a rejected decision once, keeps no stale optimistic item, and gives only a safe notification", async () => {
    const notifyError = vi.fn();
    const bridgeError = new Error("bridge failed with secret-token");
    const { client } = fakeClient(async () => { throw bridgeError; });
    const store = createApprovalsStore(client, { notifyError });
    store.setState((state) => foldApprovalRequest(state, approval("conversation-a", "a1"), "run-a", 1));

    await expect(store.getState().decide("a1", "deny")).rejects.toBe(bridgeError);
    expect(store.getState().pendingByConversation["conversation-a"]).toMatchObject({ kind: "approval", id: "a1" });
    expect(store.getState().resolvedByRun["run-a"]).toEqual([]);
    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(notifyError.mock.calls[0][0]).not.toContain("secret-token");
  });

  it("never restores a rejected old card over a newer pending card or after cancellation", async () => {
    let rejectInvoke!: (error: Error) => void;
    const invokePending = new Promise<void>((_, reject) => { rejectInvoke = reject; });
    const { client } = fakeClient(async () => invokePending);
    const store = createApprovalsStore(client);
    store.setState((state) => foldApprovalRequest(state, approval("conversation-a", "old"), "run-old", 1));
    const first = store.getState().decide("old", "allow-once");
    store.setState((state) => foldApprovalRequest(state, approval("conversation-a", "new"), "run-new", 2));
    rejectInvoke(new Error("transport"));
    await expect(first).rejects.toThrow("transport");
    expect(store.getState().pendingByConversation["conversation-a"]).toMatchObject({ id: "new" });

    let rejectSecond!: (error: Error) => void;
    const secondPending = new Promise<void>((_, reject) => { rejectSecond = reject; });
    const secondClient = fakeClient(async () => secondPending);
    const secondStore = createApprovalsStore(secondClient.client);
    secondStore.setState((state) => foldApprovalRequest(state, approval("conversation-b", "cancel-me"), "run-cancel", 3));
    const second = secondStore.getState().decide("cancel-me", "allow-once");
    secondStore.getState().cancelForConversation("conversation-b");
    rejectSecond(new Error("transport"));
    await expect(second).rejects.toThrow("transport");
    expect(secondStore.getState().pendingByConversation["conversation-b"]).toBeNull();
    expect(secondStore.getState().resolvedByRun["run-cancel"]).toEqual([]);
  });

  it("does not restore a rejected old question over a newer question or after cancellation", async () => {
    let rejectOld!: (error: Error) => void;
    const oldInvoke = new Promise<void>((_, reject) => { rejectOld = reject; });
    const { client, calls } = fakeClient(async (channel) => {
      if (channel === "bridge:askUserAnswer" && calls.length === 1) return oldInvoke;
      return undefined;
    });
    const notifyError = vi.fn();
    const store = createApprovalsStore(client, { notifyError });
    const oldQuestion = question("conversation-a", "old-question");
    const newQuestion = question("conversation-a", "new-question");
    store.setState((state) => foldAskUser(state, oldQuestion, "run-old-question", 1));

    const oldAnswer = store.getState().answer("old-question", [{ selected: ["plain"] }]);
    store.setState((state) => foldAskUser(state, newQuestion, "run-new-question", 2));
    const newAnswer = store.getState().answer("new-question", [{ selected: ["plain"] }]);
    expect(store.getState().resolvedByRun["run-new-question"]).toHaveLength(1);
    rejectOld(new Error("answer transport contains secret-token"));
    await expect(oldAnswer).rejects.toThrow("secret-token");
    await newAnswer;

    expect(store.getState().pendingByConversation["conversation-a"]).toBeNull();
    expect(store.getState().resolvedByRun["run-old-question"] ?? []).toEqual([]);
    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(notifyError.mock.calls[0][0]).not.toContain("secret-token");
  });

  it("cancels pending interactions idempotently and archives each kind", () => {
    const { client } = fakeClient();
    const store = createApprovalsStore(client);
    store.setState((state) => foldApprovalRequest(state, approval("conversation-a", "a1"), "run-a", 1));
    store.getState().cancelForConversation("conversation-a");
    store.getState().cancelForConversation("conversation-a");
    expect(store.getState().resolvedByRun["run-a"]).toEqual([expect.objectContaining({ id: "a1", outcome: "cancelled" })]);

    store.setState((state) => foldAskUser(state, question("conversation-b", "q1"), "run-q", 2));
    store.getState().cancelForConversation("conversation-b");
    expect(store.getState().resolvedByRun["run-q"]).toEqual([expect.objectContaining({ id: "q1", items: null })]);
  });

  it("refreshes whitelist atomically and preserves old data on failure", async () => {
    let list: WhitelistEntry[] = [{ toolName: "Read", risk: "safe" }];
    let fail = false;
    const { client, calls } = fakeClient(async (channel) => {
      if (channel === "bridge:listWhitelist") {
        if (fail) throw new Error("list failed");
        return list;
      }
      return undefined;
    });
    const store = createApprovalsStore(client);
    await store.getState().refreshWhitelist();
    expect(store.getState().whitelist).toEqual(list);
    list = [{ toolName: "Write", risk: "moderate" }];
    await store.getState().refreshWhitelist();
    expect(store.getState().whitelist).toEqual(list);
    fail = true;
    await expect(store.getState().refreshWhitelist()).rejects.toThrow("list failed");
    expect(store.getState().whitelist).toEqual(list);
    expect(calls.filter((call) => call.channel === "bridge:listWhitelist").every((call) => call.req === undefined)).toBe(true);
  });

  it("keeps whitelist entries immutable when the Bridge reuses returned objects", async () => {
    const entries: WhitelistEntry[] = [{ toolName: "Read", risk: "safe" }];
    const { client } = fakeClient(async (channel) => channel === "bridge:listWhitelist" ? entries : undefined);
    const store = createApprovalsStore(client);

    await store.getState().refreshWhitelist();
    expect(store.getState().whitelist[0]).not.toBe(entries[0]);
    entries[0].toolName = "Bash";
    expect(store.getState().whitelist).toEqual([{ toolName: "Read", risk: "safe" }]);
  });

  it("revokes by the exact tool+risk pair, then trusts the refreshed Bridge list", async () => {
    const lists: WhitelistEntry[][] = [
      [{ toolName: "Bash", risk: "safe" }, { toolName: "Bash", risk: "dangerous" }],
      [{ toolName: "Bash", risk: "dangerous" }],
    ];
    const { client, calls } = fakeClient(async (channel) => {
      if (channel === "bridge:listWhitelist") return lists.shift() ?? [];
      return undefined;
    });
    const store = createApprovalsStore(client);
    await store.getState().refreshWhitelist();
    await store.getState().revokeWhitelistEntry({ toolName: "Bash", risk: "safe" });
    expect(calls).toEqual([
      { channel: "bridge:listWhitelist", req: undefined },
      { channel: "bridge:revokeWhitelist", req: { toolName: "Bash", risk: "safe" } },
      { channel: "bridge:listWhitelist", req: undefined },
    ]);
    expect(store.getState().whitelist).toEqual([{ toolName: "Bash", risk: "dangerous" }]);
  });

  it("does not optimistically delete when revoke rejects", async () => {
    const initial: WhitelistEntry[] = [{ toolName: "Bash", risk: "safe" }];
    const { client } = fakeClient(async (channel) => {
      if (channel === "bridge:listWhitelist") return initial;
      throw new Error("revoke failed");
    });
    const store = createApprovalsStore(client);
    await store.getState().refreshWhitelist();
    await expect(store.getState().revokeWhitelistEntry(initial[0])).rejects.toThrow("revoke failed");
    expect(store.getState().whitelist).toEqual(initial);
  });
});
