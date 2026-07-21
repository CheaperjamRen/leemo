// Leemo Bridge — per-conversation query() session pool.
//
// Each conversation owns an independent SDK session: its own model, its own
// resume chain, and a per-provider CLAUDE_CONFIG_DIR so concurrent
// conversations never cross-talk (06 §3.1 — provider-grain isolation, the
// scheme NewMax validated). The real SDK `query()` is INJECTED as `queryFn`
// (deps injection) so B1 does zero live calls; B4 supplies the real one.
//
// Wiring per round (src/bridge/providers.ts::buildConversationEnv):
//   direct  → ANTHROPIC_BASE_URL=endpoint, AUTH_TOKEN=real key, model aliases
//   gateway → BASE_URL=loopback:port,      AUTH_TOKEN=leemo-gw:<id>, claude- model
//
// Interrupt uses an AbortController (SDK d.ts: options.abortController — there is
// NO `signal` field). Mid-conversation model change is env-level: it rebuilds
// the next round's env, so it takes effect on the NEXT send, never retroactively.
// Resume: the session_id observed in round N's stream is carried as `resume` on
// round N+1 (resume is reliable on third-party endpoints — Phase 0 + G4).

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildConversationEnv, sanitizeHostEnv, type Provider } from "./providers";

/** Minimal structural view of an SDK message. The pool reads only `type` and
 *  `session_id`; the rest is passthrough payload B2 normalizes into LeemoEvent.
 *  The real SDK's `SDKMessage` (type = literal union, session_id present) is a
 *  subtype of this, so a real query() stream satisfies it. */
export interface SdkMessageLike {
  type: string;
  session_id?: string;
}

/** Options the pool builds for a round. A structural subset of the SDK `Options`
 *  (only the fields B1 sets). B4's real-SDK adapter maps these onto `Options`. */
export interface QueryOptions {
  /** REPLACES the subprocess env entirely (SDK contract) — the pool has already
   *  spread process.env into it. */
  env?: Record<string, string | undefined>;
  /** Cancellation handle; `interrupt()`/`dispose()` abort it. */
  abortController?: AbortController;
  /** Session id to resume; omitted on the first round. */
  resume?: string;
}

/** Params passed to the injected queryFn — mirrors `query({prompt, options})`. */
export interface QueryParams {
  prompt: string | AsyncIterable<unknown>;
  options?: QueryOptions;
}

/** The injected query function. Fake in tests; real SDK `query` (adapted) in B4. */
export type QueryFn = (params: QueryParams) => AsyncIterable<SdkMessageLike>;

export interface BridgeDeps {
  queryFn: QueryFn;
  /** Root dir under which per-provider CLAUDE_CONFIG_DIRs live
   *  (`<dataDir>/providers/<id>/`). Phase 1 passes Electron userData. */
  dataDir: string;
  /** Reserved for B4 live wiring (gateway registry). Unused in B1 — the
   *  gateway port is injected per-conversation via ConversationConfig. */
  registryFactory?: unknown;
}

/** Per-conversation creation config. */
export interface ConversationConfig {
  provider: Provider;
  modelId: string;
  /** Loopback port of the already-running gateway; REQUIRED for openai
   *  providers, ignored for anthropic (direct). B1 never starts a gateway. */
  gatewayPort?: number;
}

export type ConversationState = "idle" | "running" | "disposed";

/** A live conversation. `TMessage` is the B2 wrapping point: B1 yields raw SDK
 *  messages (`SdkMessageLike`); B2 re-types this to `LeemoEvent`. */
export interface ConversationHandle<TMessage = SdkMessageLike> {
  readonly id: string;
  /** Start a round. Returns the (raw, in B1) message stream. Throws if disposed. */
  send(prompt: string): AsyncIterable<TMessage>;
  /** Abort the active round's AbortController. The conversation may send again. */
  interrupt(): void;
  /** Change the model for the NEXT round (env-level; not retroactive). */
  setModel(modelId: string): void;
  /** Terminate: aborts any in-flight round; further send() throws. */
  dispose(): void;
  readonly state: ConversationState;
}

export interface Bridge {
  createConversation(cfg: ConversationConfig): ConversationHandle;
  dispose(): void;
}

class Conversation implements ConversationHandle {
  readonly id = randomUUID();
  private readonly provider: Provider;
  private modelId: string;
  private readonly gatewayPort?: number;
  private sessionId?: string;
  private currentAbort?: AbortController;
  private _state: ConversationState = "idle";

  constructor(
    cfg: ConversationConfig,
    private readonly queryFn: QueryFn,
    private readonly dataDir: string
  ) {
    this.provider = cfg.provider;
    this.modelId = cfg.modelId;
    this.gatewayPort = cfg.gatewayPort;
  }

  get state(): ConversationState {
    return this._state;
  }

  /** Route state writes through a method so TS keeps `_state`'s declared type
   *  (a direct `_state = "running"` narrows the field to that literal, making
   *  the later `!== "disposed"` check — which dispose() can make true mid-stream
   *  — look unreachable to control-flow analysis). */
  private setState(s: ConversationState): void {
    this._state = s;
  }

  setModel(modelId: string): void {
    // Takes effect next round — buildOptions() reads this.modelId at send-time.
    this.modelId = modelId;
  }

  interrupt(): void {
    // Aborting a completed/absent round is harmless.
    this.currentAbort?.abort();
  }

  dispose(): void {
    this.setState("disposed");
    this.currentAbort?.abort();
  }

  /** Build this round's options: a fresh AbortController, the dual-wiring env
   *  (process.env spread + provider env + per-provider CONFIG_DIR), and resume
   *  if a session was captured on a prior round. Runs synchronously at send()
   *  time so interrupt() has a controller and env reflects the current model. */
  private buildOptions(): QueryOptions {
    const abortController = new AbortController();
    this.currentAbort = abortController;

    const configDir = path.join(this.dataDir, "providers", this.provider.id);
    fs.mkdirSync(configDir, { recursive: true });

    const env: Record<string, string | undefined> = {
      // env REPLACES the subprocess environment (SDK contract) — spread
      // process.env so the child keeps PATH/HOME/etc., but FIRST strip every
      // secret-shaped host var (RELAY2_API_KEY, sibling-provider keys, …). The
      // conversation's OWN token is layered on right after via
      // buildConversationEnv (ANTHROPIC_AUTH_TOKEN), so direct wiring is
      // unaffected while sibling secrets never reach the child. (B1 fix.)
      ...sanitizeHostEnv(process.env),
      ...buildConversationEnv(this.provider, this.modelId, this.gatewayPort),
      CLAUDE_CONFIG_DIR: configDir,
    };

    const options: QueryOptions = { env, abortController };
    if (this.sessionId) options.resume = this.sessionId;
    return options;
  }

  send(prompt: string): AsyncIterable<SdkMessageLike> {
    if (this._state === "disposed") {
      throw new Error("cannot send() on a disposed conversation");
    }
    // Sequential-turn contract: one active round at a time. Guarding here keeps
    // interrupt()/dispose() bound to a single currentAbort — a second send()
    // would otherwise clobber it and orphan the first round's cancellation.
    if (this._state === "running") {
      throw new Error(
        "cannot send() while a round is in progress (turns are sequential)"
      );
    }
    // Build options eagerly (sync) so interrupt() before/at iteration works and
    // env captures the model/resume as of this call. buildOptions may throw
    // (e.g. missing gateway port) — do it BEFORE flipping state so a failure
    // leaves the conversation reusable (idle), not stuck running.
    const options = this.buildOptions();
    // Flip to running synchronously so a racing send() is rejected even before
    // the generator is first pulled.
    this.setState("running");
    const self = this;
    return (async function* () {
      try {
        for await (const msg of self.queryFn({ prompt, options })) {
          // Capture the session id as it flows by, for next round's resume.
          if (msg && typeof msg.session_id === "string" && msg.session_id) {
            self.sessionId = msg.session_id;
          }
          yield msg;
        }
      } finally {
        // Don't clobber a dispose() that landed mid-stream.
        if (self.state !== "disposed") self.setState("idle");
      }
    })();
  }
}

/** Create a Bridge: a factory of isolated conversations sharing one queryFn +
 *  dataDir. `dispose()` tears down every conversation it created. */
export function createBridge(deps: BridgeDeps): Bridge {
  const conversations = new Set<Conversation>();
  return {
    createConversation(cfg: ConversationConfig): ConversationHandle {
      const convo = new Conversation(cfg, deps.queryFn, deps.dataDir);
      conversations.add(convo);
      return convo;
    },
    dispose(): void {
      for (const c of conversations) c.dispose();
      conversations.clear();
    },
  };
}
