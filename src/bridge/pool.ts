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

export interface QueryContextUsage {
  totalTokens: number;
  maxTokens: number;
  rawMaxTokens: number;
  percentage: number;
  model: string;
  isAutoCompactEnabled: boolean;
  autoCompactThreshold?: number;
  [key: string]: unknown;
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
  /** Explicit SDK built-in tool allow-list for this round. `[]` means no
   * built-in tools and must remain distinct from an omitted key. */
  tools?: string[];
}

export interface ConversationRoundOptions {
  disallowedTools?: string[];
  tools?: string[];
}

/** Custom-spawn cleanup state written by sdk-process.ts when abort begins.
 * The boolean is fail-closed until verification finishes; the Promise lets the
 * host await it without blocking Electron's main event loop. */
export const PROCESS_TREE_STOP_RESULT_KEY = "__leemoProcessTreeStopped" as const;
export const PROCESS_TREE_STOP_PROMISE_KEY = "__leemoProcessTreeStopPromise" as const;

/** Params passed to the injected queryFn — mirrors `query({prompt, options})`. */
export interface QueryParams {
  prompt: string | AsyncIterable<unknown>;
  options?: QueryOptions;
}

export interface QueryStream extends AsyncIterable<SdkMessageLike> {
  streamInput?(stream: AsyncIterable<unknown>): Promise<void>;
  getContextUsage?(): Promise<QueryContextUsage>;
  close?(): void;
}

/** The injected query function. Fake in tests; real SDK `query` (adapted) in B4. */
export type QueryFn = ((params: QueryParams) => QueryStream) & {
  /** The real Agent SDK accepts an open AsyncIterable as a multi-turn session.
   * Test doubles and older adapters omit this flag and retain one-query-per-turn
   * behavior, which is also our compatibility fallback. */
  supportsPersistentInput?: true;
};

export interface BridgeDeps {
  queryFn: QueryFn;
  /** Root dir under which per-provider CLAUDE_CONFIG_DIRs live
   *  (`<dataDir>/providers/<id>/`). Phase 1 passes Electron userData. */
  dataDir: string;
  /** Main-process runtime overlay for proxy variables. Resolved per send so a
   * settings change retires a warm transport before its next round. */
  resolveEnvOverlay?: () => Record<string, string>;
  /** Recycle an idle Agent SDK subprocess after this delay. A bounded warm
   * window preserves provider prefix-cache hits during active work without
   * accumulating one background CLI process for every old conversation. */
  persistentQueryIdleMs?: number;
  /** Some Anthropic-compatible runtimes complete a streaming-input turn with
   * `result` but omit the newer `session_state_changed: idle` frame. Keep a
   * short grace window for the authoritative frame, then treat the result as
   * the compatibility boundary without closing the warm transport. */
  persistentTurnBoundaryGraceMs?: number;
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
  /** Request cancellation of the active round. True means the request was
   * accepted; waitForInterrupt() determines when the slot is safe to reuse. */
  interrupt(): boolean;
  /** Await the host-owned process-tree verification started by interrupt().
   * Fake/query-only transports resolve immediately; Windows CLI rounds keep
   * the conversation locked until their descendants are gone. */
  waitForInterrupt?(): Promise<boolean>;
  /** Change provider + model for the NEXT round (env-level; not retroactive). */
  setModel(provider: Provider, modelId: string, gatewayPort?: number): void;
  /** 轮 7 A3 —— point this conversation at the local search shim (or `undefined`
   *  to stop using it) from the NEXT round on. Needed because「联网搜索」can be
   *  switched on after the conversation already exists, and the shim port is
   *  carried in the subprocess env, which is rebuilt per round. */
  setSearchShimPort(port: number | undefined): void;
  /** Runtime-only prompt/tool/permission configuration changed. The active turn
   * finishes on its original snapshot; the next turn resumes through a fresh
   * transport so the new configuration is actually applied. */
  invalidateRuntime(): void;
  /** Terminate: aborts any in-flight round; further send() throws. */
  dispose(): void;
  readonly state: ConversationState;
}

const DEFAULT_PERSISTENT_QUERY_IDLE_MS = 5 * 60_000;
const DEFAULT_PERSISTENT_TURN_BOUNDARY_GRACE_MS = 750;

type PersistentNextResult =
  | { ok: true; value: IteratorResult<SdkMessageLike> }
  | { ok: false; error: unknown };

class PushInputQueue implements AsyncIterable<unknown> {
  private values: unknown[] = [];
  private waiters: Array<(value: IteratorResult<unknown>) => void> = [];
  private closed = false;

  push(value: unknown): void {
    if (this.closed) throw new Error("persistent input stream is closed");
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return {
      next: async (): Promise<IteratorResult<unknown>> => {
        const value = this.values.shift();
        if (value !== undefined) return { value, done: false };
        if (this.closed) return { value: undefined, done: true };
        return new Promise<IteratorResult<unknown>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

interface PersistentQueryTransport {
  query: QueryStream;
  iterator: AsyncIterator<SdkMessageLike>;
  input: PushInputQueue;
  abortController: AbortController;
  signature: string;
  idleTimer?: ReturnType<typeof setTimeout>;
  modelUsageCursor: Record<string, Record<string, unknown>>;
  totalCostCursor: number;
  /** A timed-out read stays owned by the transport and is consumed by the next
   * round. This prevents a late idle/background frame from being dropped or a
   * second concurrent iterator.next() call from corrupting stream ordering. */
  pendingNext?: Promise<PersistentNextResult>;
}

export interface Bridge {
  createConversation(cfg: ConversationConfig): ConversationHandle;
  dispose(): void;
}

const MISSING_RESUME_SESSION_PATTERNS = [
  /no conversation found(?: with session id)?/i,
  /conversation session[^\n]*(?:not found|does not exist)/i,
  /resume session[^\n]*(?:not found|invalid|expired)/i,
];

function missingResumeSessionText(value: unknown): boolean {
  const text = value instanceof Error
    ? value.message
    : typeof value === "string"
      ? value
      : "";
  return MISSING_RESUME_SESSION_PATTERNS.some((pattern) => pattern.test(text));
}

/** Is this specifically the SDK's terminal "saved resume session is gone" message?
 *
 *  Used only to decide whether a re-claimed conversation's first round may be
 *  retried without resume: such a message reports a failure, it does not
 *  represent work performed, so replaying the prompt after one is safe. Every
 *  other message shape means the round actually got going. Structural check
 *  (type + is_error) rather than message-text matching, which would break the
 *  moment a provider words the error differently. */
function isMissingResumeSessionResult(msg: SdkMessageLike): boolean {
  if (msg?.type !== "result" || (msg as { is_error?: boolean }).is_error !== true) return false;
  const result = (msg as { result?: unknown }).result;
  return missingResumeSessionText(result);
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
  private persistentTransport?: PersistentQueryTransport;
  private runtimeRevision = 0;
  /** A failed process-tree stop is terminal for this in-memory handle. Clearing
   * the controller must never let a second Stop turn an unconfirmed process
   * into an apparently reusable conversation. Only dispose/restart replaces
   * the handle. */
  private processTreeStopFailed = false;
  private pendingProcessTreeStop?: Promise<boolean>;
  private readonly retiredTransportStops = new Set<Promise<boolean>>();
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
    private readonly dataDir: string,
    private readonly persistentQueryIdleMs: number,
    private readonly persistentTurnBoundaryGraceMs: number,
    private readonly resolveEnvOverlay?: () => Record<string, string>,
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
    this.runtimeRevision += 1;
  }

  setSearchShimPort(port: number | undefined): void {
    // Same next-round contract as setModel: buildOptions() re-reads this field.
    this.searchShimPort = port;
    this.runtimeRevision += 1;
  }

  invalidateRuntime(): void {
    this.runtimeRevision += 1;
  }

  interrupt(): boolean {
    if (this.processTreeStopFailed) return false;
    if (this.pendingProcessTreeStop) return true;
    // Retire the round before notifying the producer. Abort listeners can wake
    // synchronously, and none of their late work may regain ownership after the
    // UI has acknowledged Stop. The conversation remains locked until the
    // process-tree verification settles.
    const abort = this.currentAbort;
    if (this._state === "running") {
      this.activeRoundId = undefined;
      this.currentAbort = undefined;
      abort?.abort();
      const stopPromise = abort
        ? (abort.signal as AbortSignal & {
            [PROCESS_TREE_STOP_PROMISE_KEY]?: Promise<boolean>;
          })[PROCESS_TREE_STOP_PROMISE_KEY]
        : undefined;
      if (stopPromise) {
        const pending = stopPromise.then((stopped) => {
          if (this.pendingProcessTreeStop === pending) this.pendingProcessTreeStop = undefined;
          if (stopped) {
            void this.closePersistentTransport();
            if (this.state !== "disposed") this.setState("idle");
          } else {
            this.processTreeStopFailed = true;
          }
          return stopped;
        });
        this.pendingProcessTreeStop = pending;
        return true;
      }
      const stopped = abort
        ? (abort.signal as AbortSignal & { [PROCESS_TREE_STOP_RESULT_KEY]?: boolean })[PROCESS_TREE_STOP_RESULT_KEY] ?? true
        : true;
      if (stopped) {
        void this.closePersistentTransport();
        this.setState("idle");
      }
      else this.processTreeStopFailed = true;
      return stopped;
    }
    abort?.abort();
    return true;
  }

  async waitForInterrupt(): Promise<boolean> {
    // Cleanup can chain: resolving the active round's stop may retire its warm
    // transport, and a transport replacement can already be waiting on an older
    // retirement. A one-time snapshot can therefore report success before the
    // newly registered cleanup settles. Keep sampling until the owned cleanup
    // set is genuinely empty.
    while (true) {
      if (this.processTreeStopFailed) return false;
      const pending = [
        ...(this.pendingProcessTreeStop ? [this.pendingProcessTreeStop] : []),
        ...this.retiredTransportStops,
      ];
      if (pending.length === 0) return true;
      const results = await Promise.all(pending);
      if (this.processTreeStopFailed || results.some((stopped) => !stopped)) return false;
    }
  }

  async guide(prompt: string): Promise<"applied"> {
    const query = this.currentQuery;
    if (this._state !== "running" || !query) {
      throw new Error("当前任务暂时不能接收引导，请稍后重试。");
    }
    const message = prompt.trim();
    if (!message) throw new Error("引导内容不能为空。");
    const guidance = {
        type: "user",
        message: { role: "user", content: message },
        parent_tool_use_id: null,
        session_id: "",
        priority: "now",
        shouldQuery: true,
    };
    if (this.persistentTransport?.query === query) {
      this.persistentTransport.input.push(guidance);
    } else if (query.streamInput) {
      await query.streamInput((async function* () { yield guidance; })());
    } else {
      throw new Error("当前任务暂时不能接收引导，请稍后重试。");
    }
    return "applied";
  }

  dispose(): void {
    const persistentAbort = this.persistentTransport?.abortController;
    const retirement = this.closePersistentTransport();
    const aborts = [...new Set([this.currentAbort]
      .filter((candidate): candidate is AbortController => candidate !== undefined && candidate !== persistentAbort))];
    const existingStop = this.pendingProcessTreeStop;
    this.activeRoundId = undefined;
    this.currentAbort = undefined;
    this.setState("disposed");
    for (const abort of aborts) abort.abort();
    const stopPromises = [
      ...(existingStop ? [existingStop] : []),
      retirement,
      ...this.retiredTransportStops,
      ...aborts.flatMap((abort) => {
        const pending = (abort.signal as AbortSignal & {
          [PROCESS_TREE_STOP_PROMISE_KEY]?: Promise<boolean>;
        })[PROCESS_TREE_STOP_PROMISE_KEY];
        return pending ? [pending] : [];
      }),
    ];
    if (stopPromises.length > 0) {
      const pending = Promise.all(stopPromises).then((results) => {
        const stopped = results.every(Boolean);
        if (this.pendingProcessTreeStop === pending) this.pendingProcessTreeStop = undefined;
        if (!stopped) this.processTreeStopFailed = true;
        return stopped;
      });
      this.pendingProcessTreeStop = pending;
    } else {
      const stopped = aborts.every((abort) => (
        (abort.signal as AbortSignal & { [PROCESS_TREE_STOP_RESULT_KEY]?: boolean })
          [PROCESS_TREE_STOP_RESULT_KEY] ?? true
      ));
      if (!stopped) this.processTreeStopFailed = true;
    }
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
      ...(this.resolveEnvOverlay?.() ?? {}),
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
      ...(roundOptions?.tools !== undefined
        ? { tools: [...roundOptions.tools] }
        : {}),
    };
    if (this.sessionId) options.resume = this.sessionId;
    return options;
  }

  private persistentSignature(roundOptions?: ConversationRoundOptions): string {
    return JSON.stringify({
      provider: this.provider.id,
      model: this.modelId,
      gatewayPort: this.gatewayPort ?? null,
      searchShimPort: this.searchShimPort ?? null,
      tools: roundOptions?.tools ?? null,
      disallowedTools: roundOptions?.disallowedTools ?? null,
      runtimeRevision: this.runtimeRevision,
      envOverlay: this.resolveEnvOverlay?.() ?? null,
    });
  }

  private trackRetiredTransportStop(raw: Promise<boolean>): Promise<boolean> {
    let tracked!: Promise<boolean>;
    tracked = raw.catch(() => false).then((stopped) => {
      this.retiredTransportStops.delete(tracked);
      if (!stopped) this.processTreeStopFailed = true;
      return stopped;
    });
    this.retiredTransportStops.add(tracked);
    return tracked;
  }

  private closePersistentTransport(expected?: PersistentQueryTransport): Promise<boolean> {
    const transport = this.persistentTransport;
    if (!transport || (expected && transport !== expected)) return Promise.resolve(true);
    this.persistentTransport = undefined;
    if (transport.idleTimer) clearTimeout(transport.idleTimer);
    transport.abortController.abort();
    const signal = transport.abortController.signal as AbortSignal & {
      [PROCESS_TREE_STOP_PROMISE_KEY]?: Promise<boolean>;
      [PROCESS_TREE_STOP_RESULT_KEY]?: boolean;
    };
    const cleanup = this.trackRetiredTransportStop(
      signal[PROCESS_TREE_STOP_PROMISE_KEY]
        ?? Promise.resolve(signal[PROCESS_TREE_STOP_RESULT_KEY] ?? true),
    );
    transport.input.close();
    try {
      transport.query.close?.();
    } catch {
      // The child may already have exited. Reaping an idle transport is best
      // effort and must not turn a completed user round into an error.
    }
    return cleanup;
  }

  private schedulePersistentTransportRecycle(transport: PersistentQueryTransport): void {
    if (transport.idleTimer) clearTimeout(transport.idleTimer);
    if (this.persistentQueryIdleMs <= 0) {
      void this.closePersistentTransport(transport);
      return;
    }
    transport.idleTimer = setTimeout(() => {
      if (this._state === "idle") void this.closePersistentTransport(transport);
    }, this.persistentQueryIdleMs);
    transport.idleTimer.unref?.();
  }

  private async ensurePersistentTransport(
    options: QueryOptions,
    roundId: number,
    roundOptions?: ConversationRoundOptions,
  ): Promise<PersistentQueryTransport | undefined> {
    const signature = this.persistentSignature(roundOptions);
    const existing = this.persistentTransport;
    if (existing && existing.signature === signature) {
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer);
        existing.idleTimer = undefined;
      }
      return existing;
    }
    if (existing) {
      const stopped = await this.closePersistentTransport(existing);
      if (!stopped) throw new Error("previous persistent transport cleanup could not be verified");
    } else if (this.retiredTransportStops.size > 0) {
      const stopped = (await Promise.all([...this.retiredTransportStops])).every(Boolean);
      if (!stopped) throw new Error("previous persistent transport cleanup could not be verified");
    }

    // Stop can arrive while the replacement is waiting for the old process tree
    // to disappear. Re-check ownership after every await and immediately before
    // the synchronous query() call that can spawn the next CLI. Once retired,
    // this round is never allowed to create another process.
    if (
      this.activeRoundId !== roundId
      || options.abortController?.signal.aborted === true
      || this._state !== "running"
      || this.processTreeStopFailed
    ) return undefined;

    const input = new PushInputQueue();
    const query = this.queryFn({ prompt: input, options });
    const transport: PersistentQueryTransport = {
      query,
      iterator: query[Symbol.asyncIterator](),
      input,
      abortController: options.abortController!,
      signature,
      modelUsageCursor: {},
      totalCostCursor: 0,
    };
    this.persistentTransport = transport;
    return transport;
  }

  private normalizePersistentResult(
    message: SdkMessageLike,
    transport: PersistentQueryTransport,
  ): SdkMessageLike {
    if (message.type !== "result") return message;
    const raw = message as SdkMessageLike & {
      modelUsage?: Record<string, Record<string, unknown>>;
      total_cost_usd?: number;
    };
    if (!raw.modelUsage || typeof raw.modelUsage !== "object") return message;

    const deltaUsage: Record<string, Record<string, unknown>> = {};
    const cumulativeKeys = new Set([
      "inputTokens",
      "outputTokens",
      "cacheReadInputTokens",
      "cacheCreationInputTokens",
      "webSearchRequests",
      "costUSD",
    ]);
    for (const [model, current] of Object.entries(raw.modelUsage)) {
      const previous = transport.modelUsageCursor[model] ?? {};
      const delta: Record<string, unknown> = { ...current };
      for (const key of cumulativeKeys) {
        const now = current[key];
        const before = previous[key];
        if (typeof now !== "number" || !Number.isFinite(now)) continue;
        delta[key] = typeof before === "number" && Number.isFinite(before) && now >= before
          ? now - before
          : now;
      }
      deltaUsage[model] = delta;
      transport.modelUsageCursor[model] = { ...current };
    }

    const currentCost = typeof raw.total_cost_usd === "number" && Number.isFinite(raw.total_cost_usd)
      ? raw.total_cost_usd
      : 0;
    const deltaCost = currentCost >= transport.totalCostCursor
      ? currentCost - transport.totalCostCursor
      : currentCost;
    transport.totalCostCursor = currentCost;
    return {
      ...raw,
      modelUsage: deltaUsage,
      total_cost_usd: deltaCost,
    } as SdkMessageLike;
  }

  private pendingPersistentNext(transport: PersistentQueryTransport): Promise<PersistentNextResult> {
    if (!transport.pendingNext) {
      transport.pendingNext = transport.iterator.next().then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
    }
    return transport.pendingNext;
  }

  private async consumePersistentNext(
    transport: PersistentQueryTransport,
  ): Promise<IteratorResult<SdkMessageLike>> {
    const pending = this.pendingPersistentNext(transport);
    const result = await pending;
    if (transport.pendingNext === pending) transport.pendingNext = undefined;
    if (!result.ok) throw result.error;
    return result.value;
  }

  private async consumePersistentNextWithin(
    transport: PersistentQueryTransport,
    waitMs: number,
  ): Promise<IteratorResult<SdkMessageLike> | undefined> {
    if (waitMs <= 0) return undefined;
    const pending = this.pendingPersistentNext(transport);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), waitMs);
      timer.unref?.();
    });
    const result = await Promise.race([pending, timeout]);
    if (timer) clearTimeout(timer);
    if (result === undefined) return undefined;
    if (transport.pendingNext === pending) transport.pendingNext = undefined;
    if (!result.ok) throw result.error;
    return result.value;
  }

  private async *runPersistentRound(
    prompt: string,
    options: QueryOptions,
    roundId: number,
    roundOptions?: ConversationRoundOptions,
  ): AsyncIterable<SdkMessageLike> {
    const transport = await this.ensurePersistentTransport(options, roundId, roundOptions);
    if (!transport) return;
    if (this.activeRoundId !== roundId) {
      await this.closePersistentTransport(transport);
      return;
    }
    this.currentAbort = transport.abortController;
    this.currentQuery = transport.query;
    transport.input.push({
      type: "user",
      message: { role: "user", content: prompt },
      parent_tool_use_id: null,
      session_id: "",
    });

    let observedResult = false;
    try {
      while (this.activeRoundId === roundId) {
        const next = observedResult
          ? await this.consumePersistentNextWithin(transport, this.persistentTurnBoundaryGraceMs)
          : await this.consumePersistentNext(transport);
        if (!next) {
          const snapshot = await this.contextSnapshot(transport.query, roundId);
          if (snapshot) yield snapshot;
          this.schedulePersistentTransportRecycle(transport);
          return;
        }
        if (next.done) {
          await this.closePersistentTransport(transport);
          return;
        }
        const message = this.normalizePersistentResult(next.value, transport);
        this.captureSession(message, roundId);
        if (message.type === "result") observedResult = true;
        yield message;

        const state = message as SdkMessageLike & { subtype?: string; state?: string };
        if (
          observedResult
          && state.type === "system"
          && state.subtype === "session_state_changed"
          && state.state === "idle"
        ) {
          const snapshot = await this.contextSnapshot(transport.query, roundId);
          if (snapshot) yield snapshot;
          this.schedulePersistentTransportRecycle(transport);
          return;
        }
      }
    } catch (error) {
      await this.closePersistentTransport(transport);
      throw error;
    }
  }

  /** Capture the session id as it flows by, for next round's resume. */
  private captureSession(msg: SdkMessageLike, roundId: number): void {
    if (this.activeRoundId !== roundId) return;
    if (msg && typeof msg.session_id === "string" && msg.session_id) {
      this.sessionId = msg.session_id;
    }
  }

  /** Read the SDK's own context accounting while the query object still owns
   * its control channel. Billing usage and context occupancy are deliberately
   * separate: the former may count repeated/cacheable input while the latter
   * is the exact live window position shown by the composer ring. */
  private async contextSnapshot(
    query: QueryStream,
    roundId: number,
  ): Promise<SdkMessageLike | undefined> {
    if (this.activeRoundId !== roundId || !query.getContextUsage) return undefined;
    try {
      const contextUsage = await query.getContextUsage();
      if (
        this.activeRoundId !== roundId
        || !Number.isFinite(contextUsage.totalTokens)
        || !Number.isFinite(contextUsage.maxTokens)
        || !Number.isFinite(contextUsage.rawMaxTokens)
      ) return undefined;
      return {
        type: "leemo_context_snapshot",
        ...(this.sessionId ? { session_id: this.sessionId } : {}),
        contextUsage,
      } as SdkMessageLike;
    } catch {
      // Third-party compatible endpoints and older runtimes may omit this
      // control request. A missing meter must never fail an otherwise complete
      // user turn or be replaced with a guessed number.
      return undefined;
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
    const snapshot = await this.contextSnapshot(query, roundId);
    if (snapshot) yield snapshot;
  }

  send(prompt: string, roundOptions?: ConversationRoundOptions): AsyncIterable<SdkMessageLike> {
    if (this.processTreeStopFailed) {
      throw new Error("cannot send() after unverified process-tree cleanup");
    }
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
    const mayDegrade = this.resumeFallbackGrant;
    const usePersistentTransport = this.queryFn.supportsPersistentInput === true && !mayDegrade;
    const reusableTransport = usePersistentTransport
      && this.persistentTransport?.signature === this.persistentSignature(roundOptions)
      ? this.persistentTransport
      : undefined;
    // Flip to running synchronously so a racing send() is rejected even before
    // the generator is first pulled.
    this.activeRoundId = roundId;
    this.currentAbort = reusableTransport?.abortController ?? options.abortController;
    this.setState("running");
    const self = this;
    // Consume the degrade grant here: it belongs to the first round after a
    // re-claim only. A standing "retry without resume" policy would silently
    // amputate context on any transient upstream blip.
    this.resumeFallbackGrant = false;
    return (async function* () {
      try {
        if (usePersistentTransport) {
          yield* self.runPersistentRound(prompt, options, roundId, roundOptions);
          return;
        }
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
            if (degradable && isMissingResumeSessionResult(msg)) {
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
            const snapshot = await self.contextSnapshot(query, roundId);
            if (snapshot) yield snapshot;
          }
        } catch (e: unknown) {
          if (!canDegradeNow() || (held.length === 0 && !missingResumeSessionText(e))) {
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
      const convo = new Conversation(
        cfg,
        deps.queryFn,
        deps.dataDir,
        deps.persistentQueryIdleMs ?? DEFAULT_PERSISTENT_QUERY_IDLE_MS,
        deps.persistentTurnBoundaryGraceMs ?? DEFAULT_PERSISTENT_TURN_BOUNDARY_GRACE_MS,
        deps.resolveEnvOverlay,
      );
      conversations.add(convo);
      return convo;
    },
    dispose(): void {
      for (const c of conversations) c.dispose();
      conversations.clear();
    },
  };
}
