import { afterEach, describe, it, expect, vi } from "vitest";
import type { BridgeEventEnvelope } from "../../bridge/contract";
import type { ApprovalRequest, AskUserPayload } from "../../bridge/interact";
import { FixtureBridgeClient } from "./fixture-client";

async function createConversation(client: FixtureBridgeClient, purpose?: "main" | "wiki") {
  return client.invoke("bridge:createConversation", {
    providerId: "fixture-provider",
    modelId: "fixture-model",
    purpose,
  });
}

describe("FixtureBridgeClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates unique conversations and custom reply emits a contract-conformant sequence", async () => {
    vi.useFakeTimers();
    const client = new FixtureBridgeClient({ reply: "ab cd", chunkDelayMs: 10 });
    const events: BridgeEventEnvelope[] = [];
    client.subscribe("bridge:event", (e) => events.push(e));

    const first = await createConversation(client);
    const second = await createConversation(client, "wiki");
    expect(first.conversationId).not.toBe(second.conversationId);

    await client.invoke("bridge:send", { conversationId: first.conversationId, prompt: "hi" });
    await vi.advanceTimersByTimeAsync(200);

    expect(events[0]).toEqual({
      conversationId: first.conversationId,
      event: { type: "conversation.started", sessionId: expect.any(String) },
    });
    expect(events.every((envelope) => envelope.conversationId === first.conversationId)).toBe(true);
    expect(events.some(({ event }) => event.type === "text.delta")).toBe(true);
    expect(events.find(({ event }) => event.type === "text.final")?.event).toEqual({ type: "text.final", text: "ab cd" });
    expect(events.at(-1)?.event).toMatchObject({ type: "run.finished", isError: false });
  });

  it("unsubscribe stops delivery", async () => {
    vi.useFakeTimers();
    const client = new FixtureBridgeClient({ reply: "x", chunkDelayMs: 10 });
    const { conversationId } = await createConversation(client);
    const seen: BridgeEventEnvelope[] = [];
    const off = client.subscribe("bridge:event", (e) => seen.push(e));
    off();
    await client.invoke("bridge:send", { conversationId, prompt: "hi" });
    await vi.advanceTimersByTimeAsync(200);
    expect(seen).toHaveLength(0);
  });

  it("keeps A/B timers and event envelopes isolated while both custom turns run", async () => {
    vi.useFakeTimers();
    const client = new FixtureBridgeClient({ reply: "one two", chunkDelayMs: 10 });
    const events: BridgeEventEnvelope[] = [];
    client.subscribe("bridge:event", (e) => events.push(e));
    const a = await createConversation(client);
    const b = await createConversation(client);

    await client.invoke("bridge:send", { conversationId: a.conversationId, prompt: "A" });
    await client.invoke("bridge:send", { conversationId: b.conversationId, prompt: "B" });
    await vi.advanceTimersByTimeAsync(200);

    expect(events.filter((e) => e.conversationId === a.conversationId)).not.toHaveLength(0);
    expect(events.filter((e) => e.conversationId === b.conversationId)).not.toHaveLength(0);
    expect(events.filter((e) => e.conversationId === a.conversationId).at(-1)?.event).toMatchObject({ type: "run.finished" });
    expect(events.filter((e) => e.conversationId === b.conversationId).at(-1)?.event).toMatchObject({ type: "run.finished" });
    expect(events.find((e) => e.conversationId === a.conversationId && e.event.type === "conversation.started")).toBeDefined();
    expect(events.find((e) => e.conversationId === b.conversationId && e.event.type === "conversation.started")).toBeDefined();
  });

  it("emits the full default demo only after approval and ask replies, including visualization", async () => {
    vi.useFakeTimers();
    const client = new FixtureBridgeClient({ chunkDelayMs: 5 });
    const events: BridgeEventEnvelope[] = [];
    const approvals: ApprovalRequest[] = [];
    const asks: AskUserPayload[] = [];
    client.subscribe("bridge:event", (envelope) => events.push(envelope));
    client.subscribe("bridge:approvalRequest", (payload) => {
      approvals.push(payload);
      void client.invoke("bridge:approvalDecision", { id: payload.id, decision: "allow-once" });
    });
    client.subscribe("bridge:askUser", (payload) => {
      asks.push(payload);
      void client.invoke("bridge:askUserAnswer", {
        id: payload.id,
        items: [{ selected: [payload.questions[0].options[0].label] }],
      });
    });
    const { conversationId } = await createConversation(client);

    await client.invoke("bridge:send", { conversationId, prompt: "整理笔记" });
    await vi.advanceTimersByTimeAsync(5000);

    const types = events.map(({ event }) => event.type);
    expect(approvals).toHaveLength(1);
    expect(asks).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ conversationId, toolName: "Bash", risk: "moderate" });
    expect(approvals[0].inputSummary).toMatch(/ls/);
    expect(asks[0]).toMatchObject({ conversationId, id: expect.any(String) });
    expect(types).toContain("conversation.started");
    expect(types).toContain("compact.boundary");
    expect(events).toContainEqual({
      conversationId,
      event: {
        type: "file.changed",
        path: "数据结构/第五章笔记.md",
        workspacePath: "数据结构/第五章笔记.md",
        change: "added",
      },
    });
    expect(events.some(({ event }) => event.type === "tool.started" && event.name === "mcp__leemo-visualization__create_visualization")).toBe(true);
    expect(events.at(-1)).toMatchObject({ conversationId, event: { type: "run.finished", isError: false } });
  });

  it("does not inject approval or ask cards into a custom reply", async () => {
    vi.useFakeTimers();
    const client = new FixtureBridgeClient({ reply: "simple text", chunkDelayMs: 5 });
    const approvals: unknown[] = [];
    const asks: unknown[] = [];
    client.subscribe("bridge:approvalRequest", (payload) => approvals.push(payload));
    client.subscribe("bridge:askUser", (payload) => asks.push(payload));
    const { conversationId } = await createConversation(client);
    await client.invoke("bridge:send", { conversationId, prompt: "hello" });
    await vi.advanceTimersByTimeAsync(500);
    expect(approvals).toHaveLength(0);
    expect(asks).toHaveLength(0);
  });

  it("routes A interrupt only to A, is idempotent, and leaves B running", async () => {
    vi.useFakeTimers();
    const client = new FixtureBridgeClient({ reply: "one two three four", chunkDelayMs: 50 });
    const events: BridgeEventEnvelope[] = [];
    client.subscribe("bridge:event", (e) => events.push(e));
    const a = await createConversation(client);
    const b = await createConversation(client);
    await client.invoke("bridge:send", { conversationId: a.conversationId, prompt: "A" });
    await client.invoke("bridge:send", { conversationId: b.conversationId, prompt: "B" });
    await vi.advanceTimersByTimeAsync(55);
    await client.invoke("bridge:interrupt", { conversationId: a.conversationId });
    await client.invoke("bridge:interrupt", { conversationId: a.conversationId });
    await vi.advanceTimersByTimeAsync(1000);

    const aEvents = events.filter((e) => e.conversationId === a.conversationId);
    const bEvents = events.filter((e) => e.conversationId === b.conversationId);
    expect(aEvents.filter(({ event }) => event.type === "run.finished")).toHaveLength(1);
    expect(aEvents.at(-1)?.event).toMatchObject({ type: "run.finished", subtype: "interrupted" });
    expect(bEvents.at(-1)?.event).toMatchObject({ type: "run.finished", subtype: "success" });
  });

  it("rejects unknown and disposed conversation operations without phantom events", async () => {
    vi.useFakeTimers();
    const client = new FixtureBridgeClient({ reply: "x", chunkDelayMs: 5 });
    const events: BridgeEventEnvelope[] = [];
    client.subscribe("bridge:event", (e) => events.push(e));
    await expect(client.invoke("bridge:send", { conversationId: "missing", prompt: "nope" })).rejects.toThrow(/unknown conversation/i);
    await expect(client.invoke("bridge:interrupt", { conversationId: "missing" })).rejects.toThrow(/unknown conversation/i);
    await expect(client.invoke("bridge:setModel", { conversationId: "missing", providerId: "deepseek", modelId: "m" })).rejects.toThrow(/unknown conversation/i);
    const { conversationId } = await createConversation(client);
    await client.invoke("bridge:disposeConversation", { conversationId });
    await expect(client.invoke("bridge:send", { conversationId, prompt: "after dispose" })).rejects.toThrow(/disposed conversation/i);
    await expect(client.invoke("bridge:setModel", { conversationId, providerId: "deepseek", modelId: "m" })).rejects.toThrow(/disposed conversation/i);
    await vi.advanceTimersByTimeAsync(500);
    expect(events).toHaveLength(0);
  });

  it("matches approval and ask replies by id and conversation, rejecting wrong kind, unknown, and duplicate replies", async () => {
    vi.useFakeTimers();
    const client = new FixtureBridgeClient({ chunkDelayMs: 5 });
    const approvals: ApprovalRequest[] = [];
    const asks: AskUserPayload[] = [];
    client.subscribe("bridge:approvalRequest", (payload) => approvals.push(payload));
    client.subscribe("bridge:askUser", (payload) => asks.push(payload));
    const { conversationId } = await createConversation(client);
    await client.invoke("bridge:send", { conversationId, prompt: "demo" });
    await vi.advanceTimersByTimeAsync(50);
    expect(approvals).toHaveLength(1);
    await expect(client.invoke("bridge:askUserAnswer", { id: approvals[0].id, items: [] })).rejects.toThrow(/pending ask|unknown|kind/i);
    await expect(client.invoke("bridge:approvalDecision", { id: "unknown", decision: "allow-once" })).rejects.toThrow(/unknown|pending/i);
    await client.invoke("bridge:approvalDecision", { id: approvals[0].id, decision: "allow-once" });
    await expect(client.invoke("bridge:approvalDecision", { id: approvals[0].id, decision: "allow-once" })).rejects.toThrow(/unknown|duplicate|pending/i);
    await vi.advanceTimersByTimeAsync(350);
    expect(asks).toHaveLength(1);
    await expect(client.invoke("bridge:askUserAnswer", { id: asks[0].id, items: [] })).resolves.toBeUndefined();
    await expect(client.invoke("bridge:askUserAnswer", { id: asks[0].id, items: [] })).rejects.toThrow(/unknown|duplicate|pending/i);
  });

  it("implements every provider/whitelist/reserved invoke case explicitly", async () => {
    const client = new FixtureBridgeClient();
    const { conversationId } = await createConversation(client);
    expect(await client.invoke("bridge:listProviders", undefined)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "deepseek", capabilities: expect.objectContaining({ balanceApi: true }) }),
    ]));
    await expect(client.invoke("bridge:fetchBalance", { providerId: "deepseek" })).resolves.toMatchObject({ supported: false });
    await expect(client.invoke("bridge:usageSummary", { range: "today" })).resolves.toEqual({ byProvider: [], byDay: [] });
    await expect(client.invoke("bridge:getSearchSources", undefined)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "anysearch", keyless: true, configured: false }),
      expect.objectContaining({ id: "doubao", keyless: false, configured: false }),
    ]));
    await expect(client.invoke("bridge:saveSearchKey", { source: "doubao", apiKey: "fixture-key" })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "doubao", configured: true, configuredFields: ["apiKey"] }),
    ]));
    await expect(client.invoke("bridge:setModel", { conversationId, providerId: "deepseek", modelId: "new-model" })).resolves.toBeUndefined();

    const memory = await client.invoke("bridge:listMemory", { scopes: [{ type: "global" }] });
    expect(memory).toEqual([expect.objectContaining({
      id: "fixture-memory-1",
      statement: "用户希望 momo 先给结论",
      scope: { type: "global" },
    })]);
    const updated = await client.invoke("bridge:updateMemory", {
      scope: { type: "global" },
      id: "fixture-memory-1",
      statement: "用户希望 momo 先给结论和下一步",
    });
    expect(updated).toMatchObject({ action: "updated", memory: { statement: "用户希望 momo 先给结论和下一步" } });
    await expect(client.invoke("bridge:pinMemory", {
      scope: { type: "global" }, id: "fixture-memory-1", pinned: true,
    })).resolves.toMatchObject({ action: "pinned", memory: { pinned: true } });
    await expect(client.invoke("bridge:memoryHistory", {
      scope: { type: "global" }, id: "fixture-memory-1",
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ statement: "用户希望 momo 先给结论" }),
      expect.objectContaining({ statement: "用户希望 momo 先给结论和下一步" }),
    ]));
    const removed = await client.invoke("bridge:deleteMemory", {
      scope: { type: "global" }, id: "fixture-memory-1",
    });
    expect(removed.action).toBe("removed");
    await expect(client.invoke("bridge:undoMemory", {
      conversationId,
      scope: { type: "global" },
      targetChangeId: removed.changeId,
    })).resolves.toMatchObject({ ok: true, action: "undone" });
    await expect(client.invoke("bridge:openMemoryDir", { scope: { type: "global" } })).resolves.toBeUndefined();
    await expect(client.invoke("bridge:listMemory", { scopes: [{ type: "global" }] }))
      .resolves.toEqual([expect.objectContaining({ id: "fixture-memory-1", pinned: true })]);

    const first = await client.invoke("bridge:listWhitelist", undefined);
    expect(first).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: "mcp__demo__publish", risk: "moderate" }),
      expect.objectContaining({ toolName: "mcp__calendar__create_event", risk: "moderate" }),
    ]));
    first.push({ toolName: "Injected", risk: "safe" });
    expect(await client.invoke("bridge:listWhitelist", undefined)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: "Injected" }),
    ]));
    await client.invoke("bridge:revokeWhitelist", { toolName: "mcp__demo__publish", risk: "moderate" });
    expect(await client.invoke("bridge:listWhitelist", undefined)).not.toEqual(expect.arrayContaining([
      { toolName: "mcp__demo__publish", risk: "moderate" },
    ]));
    expect(await client.invoke("bridge:listWhitelist", undefined)).toEqual(expect.arrayContaining([
      { toolName: "mcp__calendar__create_event", risk: "moderate" },
    ]));
    await expect(client.invoke("bridge:revokeWhitelist", { toolName: "mcp__demo__publish", risk: "moderate" })).resolves.toBeUndefined();
    await client.invoke("bridge:disposeConversation", { conversationId });
  });

  it("refuses an old memory undo after a later edit to the same fact", async () => {
    const client = new FixtureBridgeClient();
    const updated = await client.invoke("bridge:updateMemory", {
      scope: { type: "global" },
      id: "fixture-memory-1",
      statement: "用户希望 momo 先给结论和下一步",
    });
    await client.invoke("bridge:pinMemory", {
      scope: { type: "global" },
      id: "fixture-memory-1",
      pinned: true,
    });

    await expect(client.invoke("bridge:undoMemory", {
      scope: { type: "global" },
      targetChangeId: updated.changeId,
    })).resolves.toEqual({
      ok: false,
      conflict: true,
      targetChangeId: updated.changeId,
    });
    await expect(client.invoke("bridge:listMemory", { scopes: [{ type: "global" }] }))
      .resolves.toEqual([expect.objectContaining({
        statement: "用户希望 momo 先给结论和下一步",
        pinned: true,
      })]);
  });

  it("fails closed on deny and malformed approval decisions with one denied finish", async () => {
    vi.useFakeTimers();
    const client = new FixtureBridgeClient({ chunkDelayMs: 5 });
    const events: BridgeEventEnvelope[] = [];
    const approvals: ApprovalRequest[] = [];
    const asks: AskUserPayload[] = [];
    client.subscribe("bridge:event", (envelope) => events.push(envelope));
    client.subscribe("bridge:approvalRequest", (payload) => approvals.push(payload));
    client.subscribe("bridge:askUser", (payload) => asks.push(payload));
    const { conversationId } = await createConversation(client);

    await client.invoke("bridge:send", { conversationId, prompt: "deny" });
    await vi.advanceTimersByTimeAsync(50);
    expect(approvals).toHaveLength(1);
    await client.invoke("bridge:approvalDecision", { id: approvals[0].id, decision: "deny", message: "no" });
    await vi.advanceTimersByTimeAsync(5000);

    expect(events.filter((envelope) => envelope.conversationId === conversationId && envelope.event.type === "run.finished"))
      .toEqual([{
        conversationId,
        event: { type: "run.finished", subtype: "denied", isError: true, finalText: "", pathAudit: { claimed: [] } },
      }]);
    expect(asks).toHaveLength(0);
    expect(events.some(({ event }) => event.type === "text.final" || event.type === "compact.boundary" || event.type === "usage.final")).toBe(false);

    const malformedClient = new FixtureBridgeClient({ chunkDelayMs: 5 });
    const malformedEvents: BridgeEventEnvelope[] = [];
    const malformedApprovals: ApprovalRequest[] = [];
    const malformedAsks: AskUserPayload[] = [];
    malformedClient.subscribe("bridge:event", (envelope) => malformedEvents.push(envelope));
    malformedClient.subscribe("bridge:approvalRequest", (payload) => malformedApprovals.push(payload));
    malformedClient.subscribe("bridge:askUser", (payload) => malformedAsks.push(payload));
    const malformed = await createConversation(malformedClient);
    await malformedClient.invoke("bridge:send", { conversationId: malformed.conversationId, prompt: "malformed" });
    await vi.advanceTimersByTimeAsync(50);
    await malformedClient.invoke("bridge:approvalDecision", {
      id: malformedApprovals[0].id,
      decision: "not-a-tier",
    } as never);
    await vi.advanceTimersByTimeAsync(5000);

    expect(malformedEvents.filter((envelope) => envelope.event.type === "run.finished")).toEqual([{
      conversationId: malformed.conversationId,
      event: { type: "run.finished", subtype: "denied", isError: true, finalText: "", pathAudit: { claimed: [] } },
    }]);
    expect(malformedAsks).toHaveLength(0);
    expect(malformedEvents.some(({ event }) => event.type === "text.final" || event.type === "compact.boundary" || event.type === "usage.final")).toBe(false);
  });

  it("rejects a second send while running without duplicate events, then allows a later run", async () => {
    vi.useFakeTimers();
    const client = new FixtureBridgeClient({ reply: "one two", chunkDelayMs: 10 });
    const events: BridgeEventEnvelope[] = [];
    client.subscribe("bridge:event", (envelope) => events.push(envelope));
    const { conversationId } = await createConversation(client);

    await client.invoke("bridge:send", { conversationId, prompt: "first" });
    await expect(client.invoke("bridge:send", { conversationId, prompt: "duplicate" }))
      .rejects.toThrow(`Conversation already running: ${conversationId}`);
    await vi.advanceTimersByTimeAsync(200);
    expect(events.filter((envelope) => envelope.conversationId === conversationId && envelope.event.type === "run.finished"))
      .toHaveLength(1);

    await client.invoke("bridge:send", { conversationId, prompt: "second" });
    await vi.advanceTimersByTimeAsync(200);
    const targetEvents = events.filter((envelope) => envelope.conversationId === conversationId);
    expect(targetEvents.filter(({ event }) => event.type === "run.finished")).toHaveLength(2);
    expect(targetEvents.filter(({ event }) => event.type === "conversation.started")).toHaveLength(1);
  });

  it("returns deeply defensive provider snapshots including model capabilities", async () => {
    const client = new FixtureBridgeClient();
    const otherClient = new FixtureBridgeClient();
    const first = await client.invoke("bridge:listProviders", undefined);
    expect(first[0]).toMatchObject({
      id: "deepseek",
      models: ["deepseek-chat"],
      capabilities: expect.objectContaining({ balanceApi: true }),
      modelCapabilities: { "deepseek-chat": { thinking: true, vision: false } },
    });
    first[0].models.push("mutated-model");
    first[0].capabilities.balanceApi = false;
    first[0].modelCapabilities!["deepseek-chat"].thinking = false;
    first[0].modelCapabilities!["deepseek-chat"] = { thinking: false, vision: true };

    const second = await client.invoke("bridge:listProviders", undefined);
    const isolated = await otherClient.invoke("bridge:listProviders", undefined);
    expect(second[0]).toMatchObject({
      models: ["deepseek-chat"],
      capabilities: expect.objectContaining({ balanceApi: true }),
      modelCapabilities: { "deepseek-chat": { thinking: true, vision: false } },
    });
    expect(isolated).toEqual(second);
  });

  it("restores conversation.started after an immediate interrupt before its timer", async () => {
    vi.useFakeTimers();
    const client = new FixtureBridgeClient({ reply: "later", chunkDelayMs: 10 });
    const events: BridgeEventEnvelope[] = [];
    client.subscribe("bridge:event", (envelope) => events.push(envelope));
    const { conversationId } = await createConversation(client);

    await client.invoke("bridge:send", { conversationId, prompt: "interrupted immediately" });
    await client.invoke("bridge:interrupt", { conversationId });
    await client.invoke("bridge:send", { conversationId, prompt: "later" });
    await vi.advanceTimersByTimeAsync(200);

    const targetEvents = events.filter((envelope) => envelope.conversationId === conversationId);
    expect(targetEvents.filter(({ event }) => event.type === "conversation.started")).toHaveLength(1);
    expect(targetEvents.filter(({ event }) => event.type === "run.finished" && event.subtype === "interrupted")).toHaveLength(1);
    expect(targetEvents.at(-1)?.event).toMatchObject({ type: "run.finished", subtype: "success" });
  });

  it("accepts a new send invoked synchronously from the terminal success event", async () => {
    vi.useFakeTimers();
    const client = new FixtureBridgeClient({ chunkDelayMs: 5 });
    const events: BridgeEventEnvelope[] = [];
    let nextSend: Promise<void> | undefined;
    client.subscribe("bridge:event", (envelope) => {
      events.push(envelope);
      if (envelope.event.type === "run.finished" && envelope.event.subtype === "success" && !nextSend) {
        nextSend = client.invoke("bridge:send", { conversationId: envelope.conversationId, prompt: "next turn" });
      }
    });
    client.subscribe("bridge:approvalRequest", (payload) => {
      void client.invoke("bridge:approvalDecision", { id: payload.id, decision: "allow-once" });
    });
    client.subscribe("bridge:askUser", (payload) => {
      void client.invoke("bridge:askUserAnswer", {
        id: payload.id,
        items: [{ selected: [payload.questions[0].options[0].label] }],
      });
    });
    const { conversationId } = await createConversation(client);

    await client.invoke("bridge:send", { conversationId, prompt: "first turn" });
    await vi.advanceTimersByTimeAsync(5000);

    await expect(nextSend).resolves.toBeUndefined();
    const targetEvents = events.filter((envelope) => envelope.conversationId === conversationId);
    expect(targetEvents.filter(({ event }) => event.type === "conversation.started")).toHaveLength(1);
    expect(targetEvents.filter(({ event }) => event.type === "run.finished" && event.subtype === "success")).toHaveLength(2);
  });

  it("rejects a runtime unknown channel instead of silently returning undefined", async () => {
    const client = new FixtureBridgeClient();
    await expect((client.invoke as unknown as (channel: string, request: unknown) => Promise<unknown>)("bridge:not-a-real-channel", undefined))
      .rejects.toThrow(/unsupported bridge channel/i);
  });

  it("projects configured providers into the browser settings editor", async () => {
    const client = new FixtureBridgeClient();

    await expect(client.invoke("bridge:getProviderConfig", { providerId: "deepseek" })).resolves.toMatchObject({
      id: "deepseek",
      name: "DeepSeek",
      authMode: "api-key",
      models: ["deepseek-chat"],
      hasApiKey: true,
      saved: true,
    });
    await expect(client.invoke("bridge:getProviderConfig", { providerId: "missing" })).resolves.toBeNull();
  });

  it("never pretends that fixture mode spent tokens to generate a global overview", async () => {
    const client = new FixtureBridgeClient();

    await expect(client.invoke("bridge:generateGlobalPendingOverview", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
      trigger: "manual",
      localNow: "2026-08-18T22:00:00+08:00",
      facts: [],
      overrides: [],
    })).resolves.toEqual({
      ok: false,
      message: "演示环境不会调用模型。",
      retryable: false,
    });
  });
});
