import type { BridgeClient } from "./client";
import type { BridgeInvokeMap, BridgeEventMap } from "../../bridge/contract";

type WsCtor = new (url: string) => WebSocket;

interface PendingInvoke {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

type InvokeFrame = { id: number; channel: string; req: unknown };
type ResponseFrame = { id: number; ok: boolean; response?: unknown; error?: string };
type PushFrame = { channel: string; payload: unknown };

function isResponseFrame(frame: any): frame is ResponseFrame {
  return typeof frame === "object" && frame !== null && typeof frame.id === "number";
}

function isPushFrame(frame: any): frame is PushFrame {
  return typeof frame === "object" && frame !== null && typeof frame.id !== "number" && typeof frame.channel === "string";
}

const RECONNECT_DELAY_MS = 1000;

/** Renderer-side BridgeClient impl backed by a raw WebSocket to the host
 *  (src/host/ws-server.ts). Wire protocol: see docs/superpowers/plans/
 *  2026-07-24-power-on-vertical-slice.md ("Wire 协议"). Not a production
 *  reconnect strategy — Electron IPC replaces this transport later; the
 *  single one-shot reconnect exists only so a dev-mode host restart doesn't
 *  strand the renderer forever. */
export class WsBridgeClient implements BridgeClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, PendingInvoke>();
  private queue: InvokeFrame[] = [];
  private subscribers = new Map<string, Set<(payload: unknown) => void>>();
  private hasReconnected = false;
  private readonly url: string;
  private readonly wsCtor: WsCtor;

  constructor(url = "ws://127.0.0.1:8787", wsCtor: WsCtor = WebSocket) {
    this.url = url;
    this.wsCtor = wsCtor;
    this.ws = this.connect();
  }

  private connect(): WebSocket {
    const socket = new this.wsCtor(this.url);
    socket.addEventListener("open", () => this.flushQueue());
    socket.addEventListener("message", (event: any) => this.handleMessage(event.data));
    socket.addEventListener("close", () => this.handleClose());
    return socket;
  }

  private flushQueue(): void {
    for (const frame of this.queue) {
      this.ws.send(JSON.stringify(frame));
    }
    this.queue = [];
  }

  private handleMessage(data: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(data);
    } catch {
      return;
    }

    if (isResponseFrame(frame)) {
      const waiter = this.pending.get(frame.id);
      if (!waiter) return;
      this.pending.delete(frame.id);
      if (frame.ok) {
        waiter.resolve(frame.response);
      } else {
        waiter.reject(new Error(frame.error ?? "bridge invoke failed"));
      }
      return;
    }

    if (isPushFrame(frame)) {
      const cbs = this.subscribers.get(frame.channel);
      if (!cbs) return;
      for (const cb of cbs) cb(frame.payload);
    }
  }

  private handleClose(): void {
    console.error("[WsBridgeClient] connection closed");
    if (this.hasReconnected) return;
    this.hasReconnected = true;
    setTimeout(() => {
      this.ws = this.connect();
    }, RECONNECT_DELAY_MS);
  }

  invoke<K extends keyof BridgeInvokeMap>(
    channel: K,
    req: BridgeInvokeMap[K]["request"],
  ): Promise<BridgeInvokeMap[K]["response"]> {
    const id = this.nextId++;
    const frame: InvokeFrame = { id, channel, req };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      const OPEN = 1;
      if (this.ws.readyState === OPEN) {
        this.ws.send(JSON.stringify(frame));
      } else {
        this.queue.push(frame);
      }
    });
  }

  subscribe<K extends keyof BridgeEventMap>(
    channel: K,
    cb: (payload: BridgeEventMap[K]) => void,
  ): () => void {
    let cbs = this.subscribers.get(channel);
    if (!cbs) {
      cbs = new Set();
      this.subscribers.set(channel, cbs);
    }
    const wrapped = cb as (payload: unknown) => void;
    cbs.add(wrapped);
    return () => {
      cbs!.delete(wrapped);
    };
  }
}
