import { describe, it, expect } from "vitest";
import { WebSocket } from "ws";
import { startWsServer } from "../../src/host/ws-server";
import type { BridgeHost } from "../../src/host/bridge-host";

function makeFakeHost(): BridgeHost & { lastInvoke: { channel: string; req: unknown } | null } {
  return {
    lastInvoke: null,
    async handleInvoke(channel, req) {
      this.lastInvoke = { channel, req };
      if (channel === "bridge:listProviders") return [] as never;
      if (channel === "bridge:createConversation") return { conversationId: "cid-1" } as never;
      throw new Error(`unknown channel: ${String(channel)}`);
    },
    dispose() {},
    async shutdown() {},
    inspect() { return undefined; },
  };
}

async function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

async function send(ws: WebSocket, msg: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(String(data))));
    ws.send(JSON.stringify(msg));
  });
}

describe("ws-server", () => {
  it("invoke round-trip: listProviders returns ok:true", async () => {
    const host = makeFakeHost();
    const srv = await startWsServer({ host, port: 0 });
    const ws = await connect(srv.port);
    const resp = await send(ws, { id: 1, channel: "bridge:listProviders", req: null });
    expect((resp as { ok: boolean }).ok).toBe(true);
    expect((resp as { id: number }).id).toBe(1);
    ws.close();
    await srv.close();
  });

  it("invoke round-trip: unknown channel returns ok:false", async () => {
    const host = makeFakeHost();
    const srv = await startWsServer({ host, port: 0 });
    const ws = await connect(srv.port);
    const resp = await send(ws, { id: 2, channel: "bridge:unknown", req: null });
    expect((resp as { ok: boolean }).ok).toBe(false);
    expect(typeof (resp as { error: string }).error).toBe("string");
    ws.close();
    await srv.close();
  });

  it("bad JSON frame does not crash server", async () => {
    const host = makeFakeHost();
    const srv = await startWsServer({ host, port: 0 });
    const ws = await connect(srv.port);
    // Send bad JSON then a valid frame
    ws.send("not json at all");
    const resp = await send(ws, { id: 3, channel: "bridge:listProviders", req: null });
    expect((resp as { ok: boolean }).ok).toBe(true);
    ws.close();
    await srv.close();
  });

  it("push broadcasts to connected clients", async () => {
    const host = makeFakeHost();
    const srv = await startWsServer({ host, port: 0 });
    const ws = await connect(srv.port);
    const received = new Promise<unknown>((resolve) => ws.once("message", (d) => resolve(JSON.parse(String(d)))));
    srv.push("bridge:event", { conversationId: "cid-1", event: { type: "error", message: "test" } });
    const msg = await received;
    expect((msg as { channel: string }).channel).toBe("bridge:event");
    ws.close();
    await srv.close();
  });

  it("close shuts down cleanly", async () => {
    const host = makeFakeHost();
    const srv = await startWsServer({ host, port: 0 });
    await expect(srv.close()).resolves.toBeUndefined();
  });
});
