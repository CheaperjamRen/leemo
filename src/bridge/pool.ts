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
  /** Built-in tools removed for this round only. Conversation-wide settings
   * are merged later by the SDK adapter. */
  disallowedTools?: string[];
}

export interface ConversationRoundOptions {
  disallowedTools?: string[];
}

/** Custom-spawn acknowledgement written synchronously by sdk-process.ts when
 * AbortController.abort() terminates an owned Claude process tree. Undefined
 * means no child process was active for that signal. */
export const PROCESS_TREE_STOP_RESULT_KEY = "__leemoProcessTreeStopped" as const;

/** Params passed to the injected queryFn — mirrors `query({prompt, options})`. */
export interface QueryParams {
  prompt: string | AsyncIterable<unknown>;
  options?: QueryOptions;
}

export interface QueryStream extends AsyncIterable<SdkMessageLike> {
  streamInput?(stream: AsyncIterable<unknown>): Promise<void>;
}

/** The injected query function. Fake in tests; real SDK `query` (adapted) in B4. */
export type QueryFn = (params: QueryParams) => QueryStream;

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
  /** Loopback port of the running search shim (轮 4 卡 H2). Applies ONLY to
   *  anthropic providers — openai ones must go through the gateway for protocol
   *  translation, so the two never stack. Omit and anthropic providers keep the
   *  original direct wiring (and CC's built-in WebSearch stays off). */
  searchShimPort?: number;
  /** ADOPT this id instead of minting a uuid (轮 2 卡 C). Conversation ids are
   *  persisted in SQLite by the renderer while the host's registry is pure
   *  memory, so after a restart the host must be able to re-claim an id the
   *  renderer already owns — the timeline/primary key must not change. Omit
   *  for a genuinely new conversation. */
  id?: string;
  /** Session id to resume on the FIRST round (轮 2 卡 C). Normally the pool
   *  learns the session from round N's stream and resumes it on N+1; a
   *  re-claimed conversation has no round N in this process, so its persisted
   *  session id is injected here. If it turns out to be unusable the first
   *  round degrades to a fresh session — see send(). */
  resume?: string;
}

export type ConversationState = "idle" | "running" | "disposed";

/** A live conversation. `TMessage` is the B2 wrapping point: B1 yields raw SDK
 *  messages (`SdkMessageLike`); B2 re-types this to `LeemoEvent`. */
export interface ConversationHandle<TMessage = SdkMessageLike> {
  readonly id: string;
  /** Start a round. Returns the (raw, in B1) message stream. Throws if disposed. */
  send(prompt: string, options?: ConversationRoundOptions): AsyncIterable<TMessage>;
  /** Add guidance to the active round through the SDK's streaming-input API. */
  guide(prompt: string): Promise<"applied">;
  /** Abort the active round. True means no owned process tree remains and the
   * conversation may send again; false keeps the slot closed. */
  interrupt(): boolean;
  /** Change provider + model for the NEXT round (env-level; not retroactive). */
  setModel(provider: Provider, modelId: string, gatewayPort?: number): void;
  /** 轮 7 A3 —— point this conversation at the local search shim (or `undefined`
   *  to stop using it) from the NEXT round on. Needed because「联网搜索」can be
   *  switched on after the conversation already exists, and the shim port is
   *  carried in the subprocess env, which is rebuilt per round. */
  setSearchShimPort(port: number | undefined): void;
  /** Terminate: aborts any in-flight round; further send() throws. */
  dispose(): void;
  readonly state: ConversationState;
}

export interface Bridge {
  createConversation(cfg: ConversationConfig): ConversationHandle;
  dispose(): void;
}

/** Is this the SDK's terminal "the run failed" message?
 *
 *  Used only to decide whether a re-claimed conversation's first round may be
 *  retried without resume: such a message reports a failure, it does not
 *  represent work performed, so replaying the prompt after one is safe. Every
 *  other message shape means the round actually got going. Structural check
 *  (type + is_error) rather than message-text matching, which would break the
 *  moment a provider words the error differently. */
function isTerminalErrorResult(msg: SdkMessageLike): boolean {
  return msg?.type === "result" && (msg as { is_error?: boolean }).is_error === true;
}

class Conversation implements ConversationHandle {
  readonly id: string;
  private provider: Provider;
  private modelId: string;
  /** Pinned so switching provider does not hide this conversation's resume
   * transcript under another CLAUDE_CONFIG_DIR. */
  private readonly configDirProviderId: string;
  private gatewayPort?: number;
  /** 轮 7 A3: mutable (was readonly) so 「联网搜索」 can be switched on for a
   *  conversation that was created with it off. `buildOptions` re-reads it every
   *  round, so the change lands on the next send — same "next round" semantics
   *  as setModel, and for the same reason (env is rebuilt per query, not once). */
  private searchShimPort?: number;
  private sessionId?: string;
  private currentAbort?: AbortController;
  private currentQuery?: QueryStream;
  /** A failed process-tree stop is terminal for this in-memory handle. Clearing
   * the controller must never let a second Stop turn an unconfirmed process
   * into an apparently reusable conversation. Only dispose/restart replaces
   * the handle. */
  private processTreeStopFailed = false;
  /** Identifies the one round allowed to mutate conversation state/session.
   * Interrupt retires this id immediately, so an abort-ignoring iterator can
   * finish later without clobbering the replacement round. */
  private activeRoundId?: number;
  private nextRoundId = 0;
  private _state: ConversationState = "idle";
  /** One-shot permission to retry WITHOUT resume, granted only to a conversation
   *  created with `cfg.resume` (i.e. re-claimed after a restart) and consumed by
   *  its first send. See send() for why it can't be a standing policy. */
  private resumeFallbackGrant = false;

  constructor(
    cfg: ConversationConfig,
    private readonly queryFn: QueryFn,
    private readonly dataDir: string
  ) {
    this.id = cfg.id ?? randomUUID();
    this.provider = cfg.provider;
    this.modelId = cfg.modelId;
    this.configDirProviderId = cfg.provider.id;
    this.gatewayPort = cfg.gatewayPort;
    this.searchShimPort = cfg.searchShimPort;
    if (cfg.resume) {
      this.sessionId = cfg.resume;
      this.resumeFallbackGrant = true;
    }
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

  setModel(provider: Provider, modelId: string, gatewayPort?: number): void {
    // Takes effect next round — buildOptions() reads both fields at send-time.
    this.provider = provider;
    this.modelId = modelId;
    this.gatewayPort = gatewayPort;
  }

  setSearchShimPort(port: number | undefined): void {
    // Same next-round contract as setModel: buildOptions() re-reads this field.
    this.searchShimPort = port;
  }

  interrupt(): boolean {
    if (this.processTreeStopFailed) return false;
    // Retire the round before notifying the producer. Abort listeners can wake
    // synchronously, and none of their late work may regain ownership after the
    // UI has acknowledged Stop. A new send can start immediately.
    const abort = this.currentAbort;
    if (this._state === "running") {
      this.activeRoundId = undefined;
      this.currentAbort = undefined;
      abort?.abort();
      const stopped = abort
        ? (abort.signal as AbortSignal & { [PROCESS_TREE_STOP_RESULT_KEY]?: boolean })[PROCESS_TREE_STOP_RESULT_KEY] ?? true
        : true;
      if (stopped) this.setState("idle");
      else this.processTreeStopFailed = true;
      return stopped;
    }
    abort?.abort();
    return true;
  }

  async guide(prompt: string): Promise<"applied"> {
    const query = this.currentQuery;
    if (this._state !== "running" || !query?.streamInput) {
      throw new Error("当前任务暂时不能接收引导，请稍后重试。");
    }
    const message = prompt.trim();
    if (!message) throw new Error("引导内容不能为空。");
    await query.streamInput((async function* () {
      yield {
        type: "user",
        message: { role: "user", content: message },
        parent_tool_use_id: null,
        session_id: "",
        priority: "now",
        shouldQuery: true,
      };
    })());
    return "applied";
  }

  dispose(): void {
    const abort = this.currentAbort;
    this.activeRoundId = undefined;
    this.currentAbort = undefined;
    this.setState("disposed");
    abort?.abort();
  }

  /** Build this round's options: a fresh AbortController, the dual-wiring env
   *  (process.env spread + provider env + per-provider CONFIG_DIR), and resume
   *  if a session was captured on a prior round. Runs synchronously at send()
   *  time so interrupt() has a controller and env reflects the current model. */
  private buildOptions(roundOptions?: ConversationRoundOptions): QueryOptions {
    const abortController = new AbortController();

    const configDir = path.join(this.dataDir, "providers", this.configDirProviderId);
    fs.mkdirSync(configDir, { recursive: true });

    const env: Record<string, string | undefined> = {
      // env REPLACES the subprocess environment (SDK contract) — spread
      // process.env so the child keeps PATH/HOME/etc., but FIRST strip every
      // secret-shaped host var (RELAY2_API_KEY, sibling-provider keys, …). The
      // conversation's OWN token is layered on right after via
      // buildConversationEnv (ANTHROPIC_AUTH_TOKEN), so direct wiring is
      // unaffected while sibling secrets never reach the child. (B1 fix.)
      ...sanitizeHostEnv(process.env),
      ...buildConversationEnv(this.provider, this.modelId, this.gatewayPort, this.searchShimPort),
      CLAUDE_CONFIG_DIR: configDir,
      // The UI promises at most five transparent reconnect attempts. Pin the
      // native SDK to the same limit so a host-level override cannot leave a
      // turn running while every later retry is misleadingly displayed as 5/5.
      CLAUDE_CODE_MAX_RETRIES: "5",
    };

    const options: QueryOptions = {
      env,
      abortController,
      ...(roundOptions?.disallowedTools !== undefined
        ? { disallowedTools: [...roundOptions.disallowedTools] }
        : {}),
    };
    if (this.sessionId) options.resume = this.sessionId;
    return options;
  }

  /** Capture the session id as it flows by, for next round's resume. */
  private captureSession(msg: SdkMessageLike, roundId: number): void {
    if (this.activeRoundId !== roundId) return;
    if (msg && typeof msg.session_id === "string" && msg.session_id) {
      this.sessionId = msg.session_id;
    }
  }

  /** Replay the prompt on a FRESH session (no resume). Only ever called from
   *  send()'s degrade path, after it has established the first attempt produced
   *  no effects. Drops the dead session id first so buildOptions() omits resume
   *  and the next round carries whatever session this one mints. */
  private async *retryWithoutResume(
    prompt: string,
    roundId: number,
    roundOptions?: ConversationRoundOptions,
  ): AsyncIterable<SdkMessageLike> {
    if (this.activeRoundId !== roundId) return;
    this.sessionId = undefined;
    const options = this.buildOptions(roundOptions); // fresh AbortController, no resume
    this.currentAbort = options.abortController;
    const query = this.queryFn({ prompt, options });
    this.currentQuery = query;
    for await (const msg of query) {
      if (this.activeRoundId !== roundId) return;
      this.captureSession(msg, roundId);
      yield msg;
    }
  }

  send(prompt: string, roundOptions?: ConversationRoundOptions): AsyncIterable<SdkMessageLike> {
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
    const options = this.buildOptions(roundOptions);
    const roundId = ++this.nextRoundId;
    // Flip to running synchronously so a racing send() is rejected even before
    // the generator is first pulled.
    this.activeRoundId = roundId;
    this.currentAbort = options.abortController;
    this.setState("running");
    const self = this;
    // Consume the degrade grant here: it belongs to the first round after a
    // re-claim only. A standing "retry without resume" policy would silently
    // amputate context on any transient upstream blip.
    const mayDegrade = this.resumeFallbackGrant;
    this.resumeFallbackGrant = false;
    return (async function* () {
      try {
        // ── Resume degradation (轮 2 卡 C §7) ────────────────────────────────
        // The persisted session transcript can be gone (workspace cleared, SDK
        // pruned it). The first round of a RE-CLAIMED conversation then dies,
        // and without a fallback the user simply cannot send: 宁可失忆，不可发
        // 不出消息. So retry that one round once, without resume.
        //
        // The retry must never replay work. The card specified "failed before
        // emitting anything", but a live probe against the real SDK (bogus
        // resume id, DeepSeek) showed that shape does not occur: the stream
        // yields ONE message first — result / error_during_execution, "No
        // conversation found with session ID: <id>" — and only then throws. A
        // literal zero-message rule would make this whole path dead code.
        //
        // So the guard is on EFFECTS, not on message count: a terminal error
        // result is not an effect, anything else is. While only error results
        // have arrived the round is still a degrade candidate and they are held
        // back (un-yielded — otherwise the renderer paints a red error card and
        // then the real answer). The first message that is not an error result
        // proves the round is live: flush and disarm permanently, so a round
        // that reached a tool can never be replayed.
        let degradable = mayDegrade;
        // Held-back error results from a round that may still turn out dead.
        let held: SdkMessageLike[] = [];
        // Anything actually handed downstream — the retry is off once true.
        let emitted = false;

        function* flushHeld(): Generator<SdkMessageLike> {
          if (self.activeRoundId !== roundId) return;
          const pending = held;
          held = [];
          for (const m of pending) {
            emitted = true;
            self.captureSession(m, roundId);
            yield m;
          }
        }

        /** May this round still be retried without resume? */
        const canDegradeNow = (): boolean =>
          degradable &&
          !emitted &&
          self.activeRoundId === roundId &&
          options.abortController?.signal.aborted !== true &&
          self.state !== "disposed";

        try {
          const query = self.queryFn({ prompt, options });
          self.currentQuery = query;
          for await (const msg of query) {
            if (self.activeRoundId !== roundId) return;
            if (degradable && isTerminalErrorResult(msg)) {
              held.push(msg); // might be the dead-resume round; decide at the end
              continue;
            }
            if (degradable) {
              // A real message: this round is alive. Release anything held and
              // stop treating the round as replayable.
              degradable = false;
              yield* flushHeld();
            }
            emitted = true;
            self.captureSession(msg, roundId);
            yield msg;
          }
          // Stream ended. If all it ever produced was an error result, treat it
          // as the dead-resume case; otherwise pass the held result through.
          if (held.length > 0 && canDegradeNow()) {
            held = [];
            yield* self.retryWithoutResume(prompt, roundId, roundOptions);
          } else {
            yield* flushHeld();
          }
        } catch (e: unknown) {
          if (!canDegradeNow()) {
            yield* flushHeld(); // not degradable: the caller still owns these
            throw e;
          }
          held = [];
          yield* self.retryWithoutResume(prompt, roundId, roundOptions);
        }
      } finally {
        // Only the still-current round may release the slot. An interrupted old
        // iterator can reach finally after its replacement is already running.
        if (self.activeRoundId === roundId) {
          self.activeRoundId = undefined;
          self.currentAbort = undefined;
          self.currentQuery = undefined;
          if (self.state !== "disposed") self.setState("idle");
        }
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
