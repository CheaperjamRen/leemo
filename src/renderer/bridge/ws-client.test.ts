import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WsBridgeClient } from "./ws-client";
import type { ProviderSpec } from "../../bridge/contract";

type Listener = (event: any) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0; // CONNECTING
  sent: string[] = [];
  url: string;
  private listeners: Record<string, Listener[]> = { open: [], message: [], close: [] };

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: Listener): void {
    this.listeners[type].push(cb);
  }

  removeEventListener(type: string, cb: Listener): void {
    this.listeners[type] = this.listeners[type].filter((l) => l !== cb);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  triggerOpen(): void {
    this.readyState = 1; // OPEN
    for (const cb of this.listeners.open) cb({});
  }

  triggerMessage(data: unknown): void {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    for (const cb of this.listeners.message) cb({ data: payload });
  }

  triggerClose(): void {
    this.readyState = 3; // CLOSED
    for (const cb of this.listeners.close) cb({});
  }
}

const deepseekSpec: ProviderSpec = {
  id: "deepseek",
  name: "DeepSeek",
  kind: "deepseek",
  category: "cn_official",
  apiFormat: "anthropic",
  authMode: "api-key",
  baseUrl: "https://api.deepseek.com/anthropic",
  models: ["deepseek-chat"],
  capabilities: { balanceApi: true, modelDiscovery: false, subscriptionPlan: false },
};

beforeEach(() => {
  FakeWebSocket.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WsBridgeClient", () => {
  it("queues invoke frames before open and flushes them once open fires", () => {
    const client = new WsBridgeClient("ws://test", FakeWebSocket as any);
    const ws = FakeWebSocket.instances[0];

    const pending = client.invoke("bridge:listProviders", undefined);
    expect(ws.sent).toHaveLength(0);

    ws.triggerOpen();
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toMatchObject({ channel: "bridge:listProviders" });

    ws.triggerMessage({ id: JSON.parse(ws.sent[0]).id, ok: true, response: [deepseekSpec] });
    return expect(pending).resolves.toEqual([deepseekSpec]);
  });

  it("resolves out-of-order responses to the matching id without cross-talk", async () => {
    const client = new WsBridgeClient("ws://test", FakeWebSocket as any);
    const ws = FakeWebSocket.instances[0];
    ws.triggerOpen();

    const first = client.invoke("bridge:listProviders", undefined);
    const second = client.invoke("bridge:listProviders", undefined);
    const [firstId, secondId] = ws.sent.map((frame) => JSON.parse(frame).id);
    expect(firstId).not.toBe(secondId);

    // Respond to the second request first.
    ws.triggerMessage({ id: secondId, ok: true, response: [deepseekSpec] });
    ws.triggerMessage({ id: firstId, ok: true, response: [] });

    await expect(second).resolves.toEqual([deepseekSpec]);
    await expect(first).resolves.toEqual([]);
  });

  it("rejects the invoke promise when the response frame carries ok:false", async () => {
    const client = new WsBridgeClient("ws://test", FakeWebSocket as any);
    const ws = FakeWebSocket.instances[0];
    ws.triggerOpen();

    const pending = client.invoke("bridge:listProviders", undefined);
    const id = JSON.parse(ws.sent[0]).id;
    ws.triggerMessage({ id, ok: false, error: "boom" });

    await expect(pending).rejects.toThrow("boom");
  });

  it("dispatches push frames to subscribed channel callbacks", () => {
    const client = new WsBridgeClient("ws://test", FakeWebSocket as any);
    const ws = FakeWebSocket.instances[0];
    ws.triggerOpen();

    const cb = vi.fn();
    client.subscribe("bridge:event", cb);

    const envelope = { conversationId: "c1", event: { type: "text.delta", text: "hi" } };
    ws.triggerMessage({ channel: "bridge:event", payload: envelope });

    expect(cb).toHaveBeenCalledWith(envelope);
  });

  it("stops delivering to a callback once unsubscribed", () => {
    const client = new WsBridgeClient("ws://test", FakeWebSocket as any);
    const ws = FakeWebSocket.instances[0];
    ws.triggerOpen();

    const cb = vi.fn();
    const unsub = client.subscribe("bridge:event", cb);
    unsub();

    ws.triggerMessage({ channel: "bridge:event", payload: { conversationId: "c1", event: { type: "text.delta", text: "hi" } } });

    expect(cb).not.toHaveBeenCalled();
  });

  it("silently ignores malformed frames without throwing or affecting pending invokes", async () => {
    const client = new WsBridgeClient("ws://test", FakeWebSocket as any);
    const ws = FakeWebSocket.instances[0];
    ws.triggerOpen();

    const pending = client.invoke("bridge:listProviders", undefined);
    const id = JSON.parse(ws.sent[0]).id;

    expect(() => ws.triggerMessage("not json{{{")).not.toThrow();

    ws.triggerMessage({ id, ok: true, response: [] });
    await expect(pending).resolves.toEqual([]);
  });

  it("reconnects exactly once, 1s after close, and keeps queuing invokes meanwhile", () => {
    vi.useFakeTimers();
    const client = new WsBridgeClient("ws://test", FakeWebSocket as any);
    const first = FakeWebSocket.instances[0];
    first.triggerOpen();

    first.triggerClose();
    expect(FakeWebSocket.instances).toHaveLength(1);

    const pending = client.invoke("bridge:listProviders", undefined);

    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    const second = FakeWebSocket.instances[1];
    expect(second.sent).toHaveLength(0);
    second.triggerOpen();
    expect(second.sent).toHaveLength(1);

    second.triggerClose();
    vi.advanceTimersByTime(5000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    void pending;
  });
});
