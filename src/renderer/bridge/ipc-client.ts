import type { BridgeClient } from "./client";
import type { BridgeInvokeMap, BridgeEventMap } from "../../bridge/contract";

/** Envelope returned by the preload's `invoke`. Mirrors the ws-server frame
 *  shape ({ ok, response, error }) so errors cross IPC as data, never as a
 *  thrown-and-reserialized Error (which Electron would wrap/mangle). */
export interface InvokeResult {
  ok: boolean;
  response?: unknown;
  error?: string;
}

/** The exact surface the preload exposes on `window.leemoBridge`
 *  (see src/main/preload.ts). Kept tiny on purpose: one multiplexed invoke and
 *  one channel subscribe. */
export interface LeemoBridgeApi {
  invoke(channel: string, req: unknown): Promise<InvokeResult>;
  on(channel: string, cb: (payload: unknown) => void): () => void;
}

/**
 * Renderer-side BridgeClient backed by Electron IPC (via the preload's
 * `window.leemoBridge`). This is the default transport inside the desktop app;
 * WsBridgeClient remains for browser dev + smoke. Simpler than WsBridgeClient
 * because ipcRenderer.invoke already returns a Promise per call — no manual
 * pending-id map, no reconnect.
 */
export class IpcBridgeClient implements BridgeClient {
  constructor(private readonly api: LeemoBridgeApi) {}

  async invoke<K extends keyof BridgeInvokeMap>(
    channel: K,
    req: BridgeInvokeMap[K]["request"],
  ): Promise<BridgeInvokeMap[K]["response"]> {
    const res = await this.api.invoke(channel, req);
    if (!res.ok) throw new Error(res.error ?? "bridge invoke failed");
    return res.response as BridgeInvokeMap[K]["response"];
  }

  subscribe<K extends keyof BridgeEventMap>(
    channel: K,
    cb: (payload: BridgeEventMap[K]) => void,
  ): () => void {
    return this.api.on(channel, cb as (payload: unknown) => void);
  }
}
