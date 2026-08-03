import { WebSocketServer, type WebSocket } from "ws";
import type { BridgeHost } from "./bridge-host";
import type { BridgeEventMap } from "../bridge/contract";

export interface WsServerDeps {
  host: BridgeHost;
  port: number;
}

export async function startWsServer(deps: WsServerDeps): Promise<{
  port: number;
  close(): Promise<void>;
  push: <K extends keyof BridgeEventMap>(channel: K, payload: BridgeEventMap[K]) => void;
}> {
  const { host } = deps;
  const clients = new Set<WebSocket>();

  const wss = new WebSocketServer({ host: "127.0.0.1", port: deps.port });

  await new Promise<void>((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject);
  });

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.on("message", async (data) => {
      let parsed: { id: number; channel: string; req: unknown };
      try {
        parsed = JSON.parse(String(data)) as typeof parsed;
      } catch {
        console.warn("[ws-server] bad JSON frame, discarding");
        return;
      }
      const { id, channel, req } = parsed;
      try {
        const response = await host.handleInvoke(
          channel as keyof import("../bridge/contract").BridgeInvokeMap,
          req as never
        );
        ws.send(JSON.stringify({ id, ok: true, response }));
      } catch (e: unknown) {
        ws.send(JSON.stringify({ id, ok: false, error: e instanceof Error ? e.message : String(e) }));
      }
    });
  });

  function push<K extends keyof BridgeEventMap>(channel: K, payload: BridgeEventMap[K]): void {
    const frame = JSON.stringify({ channel, payload });
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(frame);
    }
  }

  function close(): Promise<void> {
    return new Promise((resolve, reject) => {
      for (const ws of clients) ws.terminate();
      clients.clear();
      wss.close((err) => (err ? reject(err) : resolve()));
    });
  }

  const addr = wss.address() as { port: number };
  return { port: addr.port, close, push };
}
