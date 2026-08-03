import { describe, it, expect, vi } from "vitest";
import { IpcBridgeClient, type LeemoBridgeApi, type InvokeResult } from "./ipc-client";

/** In-memory stand-in for the preload's window.leemoBridge surface. */
class FakeApi implements LeemoBridgeApi {
  invokeCalls: { channel: string; req: unknown }[] = [];
  nextResult: InvokeResult = { ok: true, response: undefined };
  private channels = new Map<string, Set<(p: unknown) => void>>();
  disposedChannels: string[] = [];

  invoke(channel: string, req: unknown): Promise<InvokeResult> {
    this.invokeCalls.push({ channel, req });
    return Promise.resolve(this.nextResult);
  }

  on(channel: string, cb: (p: unknown) => void): () => void {
    let set = this.channels.get(channel);
    if (!set) {
      set = new Set();
      this.channels.set(channel, set);
    }
    set.add(cb);
    return () => {
      set!.delete(cb);
      this.disposedChannels.push(channel);
    };
  }

  emit(channel: string, payload: unknown): void {
    for (const cb of this.channels.get(channel) ?? []) cb(payload);
  }
}

describe("IpcBridgeClient", () => {
  it("forwards invoke to the preload api and resolves the response on ok:true", async () => {
    const api = new FakeApi();
    api.nextResult = { ok: true, response: [{ id: "deepseek" }] };
    const client = new IpcBridgeClient(api);

    const req = { providerId: "deepseek", modelId: "deepseek-chat" };
    const res = await client.invoke("bridge:createConversation", req as never);

    expect(api.invokeCalls).toEqual([{ channel: "bridge:createConversation", req }]);
    expect(res).toEqual([{ id: "deepseek" }]);
  });

  it("rejects the invoke promise with the error message on ok:false", async () => {
    const api = new FakeApi();
    api.nextResult = { ok: false, error: "unknown provider: bogus" };
    const client = new IpcBridgeClient(api);

    await expect(client.invoke("bridge:createConversation", {} as never)).rejects.toThrow(
      "unknown provider: bogus",
    );
  });

  it("rejects with a default message when ok:false carries no error text", async () => {
    const api = new FakeApi();
    api.nextResult = { ok: false };
    const client = new IpcBridgeClient(api);

    await expect(client.invoke("bridge:listProviders", undefined)).rejects.toThrow(
      "bridge invoke failed",
    );
  });

  it("subscribe delivers pushed payloads for the channel to the callback", () => {
    const api = new FakeApi();
    const client = new IpcBridgeClient(api);
    const cb = vi.fn();

    client.subscribe("bridge:event", cb);
    const envelope = { conversationId: "c1", event: { type: "text.delta", text: "hi" } };
    api.emit("bridge:event", envelope);

    expect(cb).toHaveBeenCalledWith(envelope);
  });

  it("subscribe returns the preload's disposer so unsubscribe stops delivery", () => {
    const api = new FakeApi();
    const client = new IpcBridgeClient(api);
    const cb = vi.fn();

    const unsub = client.subscribe("bridge:event", cb);
    unsub();
    api.emit("bridge:event", { conversationId: "c1", event: { type: "text.delta", text: "hi" } });

    expect(cb).not.toHaveBeenCalled();
    expect(api.disposedChannels).toContain("bridge:event");
  });
});
