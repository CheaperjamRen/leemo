import { createStore, type StoreApi } from "zustand/vanilla";
import type { AttachmentRef, BridgeEventEnvelope, GuideResponse, PermissionMode, WorkspaceFileRef } from "../../bridge/contract";
import {
  applyUserWorkOverviewCorrection,
  migrateLegacyWorkOverview,
  WORK_OVERVIEW_MANUAL_REFRESH_PROMPT,
  type WorkOverviewSnapshot,
  type WorkOverviewUserCorrection,
} from "../../bridge/work-overview";
import type { BridgeClient } from "../bridge/client";
import { applyEvent, type TimelineItem, RENDERER_RUN_ID_INITIAL } from "./message-model";
import { HOME_WORKSPACE_ID } from "./workspaces";

export interface ConversationGoal {
  text: string;
  status: "active" | "paused";
  createdAt: number;
  updatedAt: number;
}

export interface ConversationMeta {
  id: string;
  title: string;
  titleManuallyUpdated: boolean;
  bookId: string | null;
  /** Opaque main-process workspace id. Missing on legacy records means the
   * Leemo main workspace. Never stores or transports an absolute path. */
  workspaceId?: string;
  source: "buddy" | "workbench";
  providerId: string;
  modelId: string;
  createdAt: number;
  lastActivityAt: number;
  /** Conversation-list state. Optional only for records written by releases
   * before the lifecycle fields existed; hydrate() normalizes all three. */
  lastOpenedAt?: number;
  pinned?: boolean;
  archived?: boolean;
  unread: boolean;
  /** SDK session this conversation last ran under (轮 2 卡 C), reported by
   *  `run.finished` and persisted so a restart can resume the real context
   *  instead of just re-opening an empty shell. Optional: conversations that
   *  never finished a round — and every row written before 卡 C — have none. */
  sessionId?: string | null;
  /** One user-authored durable objective for this conversation. It is shown as
   * a compact composer card and reaches the model only while active. */
  goal?: ConversationGoal;
}

export interface ConversationDefaults {
  providerId: string;
  modelId: string;
}

/** Full, renderer-memory-only copy of a submitted turn. Timeline persistence
 * deliberately keeps only display-safe attachment metadata; this parallel copy
 * keeps the real local paths just long enough to retry a failed round without
 * asking the user to rebuild the message. */
export interface PendingSendDraft {
  runId: string;
  text: string;
  attachments: AttachmentRef[];
  workspaceFiles?: WorkspaceFileRef[];
  noteReferences?: string[];
  providerId: string;
  modelId: string;
  allowSubagents?: boolean;
  permissionMode?: PermissionMode;
  /** Internal maintenance turns such as overview refreshes must not inherit an
   * active durable goal. Preserve this flag across retry so a failed metadata
   * refresh cannot turn into goal-driven work on the second attempt. */
  suppressGoal?: boolean;
  /** Optional display-safe text for app-generated turns. The full prompt still
   * reaches the host and remains available for retry, while the timeline keeps
   * the user's mental model concise. */
  displayText?: string;
  errorMessage?: string;
}

export interface ConversationTurnOptions {
  allowSubagents?: boolean;
  displayText?: string;
  noteReferences?: string[];
  permissionMode?: PermissionMode;
  suppressGoal?: boolean;
}

/** A complete next-round turn waiting behind the current run. This queue is
 * renderer-memory-only on purpose: it follows its conversation while the user
 * switches views, but does not claim restart recovery that the host cannot yet
 * guarantee. */
export interface QueuedTurn {
  id: string;
  text: string;
  attachments: AttachmentRef[];
  workspaceFiles: WorkspaceFileRef[];
  noteReferences?: string[];
  allowSubagents?: boolean;
  permissionMode?: PermissionMode;
  displayText?: string;
  errorMessage?: string;
}

export interface ConversationsStoreDeps {
  resolveConversationDefaults(): ConversationDefaults;
  /** Supplies momo's persona context (prompt layers ③④⑤⑦) at create time.
   *  Resolved per call, not captured once, so flipping the mode or persona card
   *  in settings affects the next conversation. Omit it (browser dev, fixtures,
   *  older tests) and the host applies its own momo defaults. */
  resolvePersonaContext?(): PersonaContext;
  /** The 本子 the user is currently working in (轮 3 卡 G), or null when unfiled.
   *  Becomes `ConversationMeta.bookId` AND crosses to the host as
   *  `notebookId`, which drives prompt layer ⑨ (<notebook>/CLAUDE.md, 06 §7.4).
   *  Resolved per call, like persona/skills, so switching notebooks lands on the
   *  next conversation rather than being captured once. */
  resolveActiveNotebook?(): string | null;
  /** Current workbench folder. Resolved per create so switching folders affects
   * the next workbench conversation. Buddy conversations stay in momo's global
   * Leemo workspace regardless of this selection. */
  resolveActiveWorkspaceId?(): string | undefined;
  /** QUALIFIED skill names to enable for a new/re-claimed conversation (轮 2 卡
   *  E). Resolved per call, like the persona, so a switch flipped on the
   *  SkillsPage lands on the next conversation.
   *
   *  ⚠️ Tri-state on purpose — `undefined` (or an absent dep) must NOT be
   *  rewritten to `[]`: the SDK reads an omitted `skills` as "CLI defaults
   *  apply" and `[]` as an explicit empty allow-list (sdk.d.ts:1877). The store
   *  therefore forwards exactly what it is given. */
  resolveEnabledSkills?(): string[] | undefined;
  /** Ensure the skill catalog has been hydrated before a conversation is
   * created or reclaimed. This closes the startup race where the first turn
   * could otherwise be sent with the SDK's default skill set. */
  ensureSkillsReady?(): Promise<void>;
  /** Deliberate lifecycle actions use awaited persistence. Streaming messages
   * still flow through the debounced persistence synchronizer. */
  persistence?: {
    saveConversation(meta: ConversationMeta, timeline: TimelineItem[]): Promise<void>;
    saveRelationshipChapter?(meta: ConversationMeta, timeline: TimelineItem[]): Promise<void>;
    moveConversation(
      sourceWorkspaceId: string,
      meta: ConversationMeta,
      timeline: TimelineItem[],
    ): Promise<void>;
    deleteConversation(conversationId: string): Promise<void>;
  };
  onConversationMoved?(conversationId: string): void;
  onConversationDeleted?(conversationId: string): void;
  onPersistenceError?: (error: unknown) => void;
  now?: () => number;
}

/** The renderer-owned half of momo's prompt inputs. `personaText` is the
 *  resolved `PersonaCard.promptText`, not a card id: the card registry lives in
 *  the settings store, so only the renderer can resolve it. */
export interface PersonaContext {
  mode: "buddy" | "workbench";
  personaText: string;
  talkStyle: 1 | 2 | 3;
  /** EFFECTIVE value, i.e. the 统筹「联网功能」mask already applied — resolved
   *  via `webSearchActive`, never read straight off the settings field. */
  webSearchEnabled: boolean;
  /** EFFECTIVE value for built-in WebFetch (`webFetchActive`). Optional so the
   *  many test fixtures that predate the three-tier switch keep compiling; the
   *  real resolver in context.tsx always sends it. */
  webFetchEnabled?: boolean;
  /** 轮 7 A4 —— the settings-page 权限策略 pair, previously never sent (the whole
   *  section was a dead control). Optional for the same fixture-compat reason. */
  permissionMode?: PermissionMode;
  dangerousCommandCaching?: boolean;
  /** Controls global memory read/write prompt layers. Skills remain available
   *  when this is false. Optional for older fixtures; the live resolver sends
   *  it on every create and context update. */
  rememberMode?: boolean;
}

export interface ConversationsState {
  byId: Record<string, ConversationMeta>;
  order: string[];
  activeId: string | null;
  openTabs: string[];
  timelines: Record<string, TimelineItem[]>;
  runIds: Record<string, string | null>;
  /** Never persisted. A missing `errorMessage` means the acknowledged run is
   * still pending; a present one means the exact draft can be retried. */
  pendingSends: Record<string, PendingSendDraft | undefined>;
  queuedTurns: Record<string, QueuedTurn[] | undefined>;

  createConversation: (opts: {
    source: "buddy" | "workbench";
    bookId?: string | null;
    /** Scheduled tasks target their saved workspace without changing what the
     * user is currently looking at. */
    workspaceId?: string;
    activate?: boolean;
    /** Internal chapter creation can preserve the relationship's current
     * model even though the user never sees a separate conversation shell. */
    modelSelection?: { providerId: string; modelId: string };
    /** Await the main-owned portable + SQLite relationship commit before this
     * empty chapter becomes visible in renderer state. */
    durableRelationshipChapter?: boolean;
  }) => Promise<string>;
  /** Remove a shell that never crossed the first-send acknowledgement boundary.
   *  This is intentionally narrower than a user-facing delete: any real
   *  timeline content or active run makes the operation a no-op. */
  discardEmptyConversation: (conversationId: string) => Promise<boolean>;
  send: (
    conversationId: string,
    text: string,
    attachments?: AttachmentRef[],
    workspaceFiles?: WorkspaceFileRef[],
    options?: ConversationTurnOptions,
  ) => Promise<void>;
  refreshWorkOverview: (conversationId: string) => Promise<void>;
  correctWorkOverview: (conversationId: string, correction: WorkOverviewUserCorrection) => Promise<void>;
  guide: (conversationId: string, text: string) => Promise<GuideResponse>;
  enqueueTurn: (
    conversationId: string,
    text: string,
    attachments?: AttachmentRef[],
    workspaceFiles?: WorkspaceFileRef[],
    options?: ConversationTurnOptions,
  ) => string;
  removeQueuedTurn: (conversationId: string, queuedTurnId: string) => void;
  guideQueuedTurn: (conversationId: string, queuedTurnId: string) => Promise<GuideResponse>;
  flushQueuedTurns: (conversationId: string) => Promise<void>;
  retry: (conversationId: string) => Promise<void>;
  dismissRetry: (conversationId: string) => void;
  interrupt: (conversationId: string) => Promise<void>;
  /** Switches the visible conversation scope with the selected workspace. */
  activateWorkspace: (workspaceId: string) => void;
  /** Selects the latest conversation in one user-visible 本子 scope. */
  activateScope: (workspaceId: string, bookId: string | null) => void;
  switchActive: (conversationId: string) => void;
  openTab: (conversationId: string) => void;
  closeTab: (conversationId: string) => void;
  renameTitle: (conversationId: string, title: string) => void;
  setGoal: (conversationId: string, text: string) => Promise<void>;
  toggleGoalPaused: (conversationId: string) => Promise<void>;
  clearGoal: (conversationId: string) => Promise<void>;
  /** Explicitly set the durable reminder dot from the conversation menu. */
  setConversationUnread: (conversationId: string, unread: boolean) => Promise<void>;
  pinConversation: (conversationId: string, pinned: boolean) => Promise<void>;
  archiveConversation: (conversationId: string, archived: boolean) => Promise<void>;
  moveConversation: (
    conversationId: string,
    target: { workspaceId: string; bookId: string | null },
  ) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  setModelForConversation: (conversationId: string, providerId: string, modelId: string) => Promise<void>;
  /** 轮 7 A3 —— push the current persona/web/permission context to every
   *  conversation the host actually knows about, so a settings change lands on
   *  their NEXT round instead of only in brand-new conversations.
   *
   *  Returns the ids it reached, which is what lets the UI say「下轮起生效」only
   *  when something was really updated. */
  broadcastContext: () => Promise<string[]>;
  /** Seed the registry from persisted storage on startup (Electron main →
   *  SQLite → renderer). Replaces state; runIds are nulled (no run survives a
   *  restart) and the newest conversation (order[0]) becomes active so its
   *  content is visible immediately. */
  hydrate: (conversations: { meta: ConversationMeta; timeline: TimelineItem[] }[]) => void;
}

function moveToFront(order: string[], conversationId: string): string[] {
  return [conversationId, ...order.filter((id) => id !== conversationId)];
}

function unknownConversation(conversationId: string): Error {
  return new Error(`Unknown conversation: ${conversationId}`);
}

function latestWorkOverviewSnapshot(
  timeline: TimelineItem[],
  conversationId: string,
  fallbackUpdatedAt: number,
): WorkOverviewSnapshot | undefined {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item.kind !== "overview") continue;
    if (
      typeof item.overview.revision === "number"
      && typeof item.overview.scopeConversationId === "string"
      && item.overview.fieldAuthority
    ) {
      if (item.overview.scopeConversationId === conversationId) {
        return item.overview as WorkOverviewSnapshot;
      }
      continue;
    }
    const migrated = migrateLegacyWorkOverview(item.overview, {
      scopeConversationId: conversationId,
      updatedAt: item.createdAt ?? fallbackUpdatedAt,
    });
    if (migrated) return migrated;
  }
  return undefined;
}

function withoutConversation<T>(record: Record<string, T | undefined>, conversationId: string): Record<string, T | undefined> {
  const next = { ...record };
  delete next[conversationId];
  return next;
}

function markRead(byId: Record<string, ConversationMeta>, conversationId: string): Record<string, ConversationMeta> {
  const meta = byId[conversationId];
  if (!meta?.unread) return byId;
  return { ...byId, [conversationId]: { ...meta, unread: false } };
}

function workspaceIdOf(meta: ConversationMeta): string {
  return meta.workspaceId ?? HOME_WORKSPACE_ID;
}

function sameScope(meta: ConversationMeta, workspaceId: string, bookId: string | null): boolean {
  return workspaceIdOf(meta) === workspaceId && meta.bookId === bookId;
}

function normalizedMeta(meta: ConversationMeta): ConversationMeta {
  return {
    ...meta,
    lastOpenedAt: meta.lastOpenedAt ?? meta.lastActivityAt,
    pinned: meta.pinned ?? false,
    archived: meta.archived ?? false,
  };
}

function nextConversationInScope(
  state: Pick<ConversationsState, "byId" | "order">,
  workspaceId: string,
  bookId: string | null,
  excludeId?: string,
): string | null {
  let selected: ConversationMeta | undefined;
  for (const id of state.order) {
    const candidate = state.byId[id];
    if (
      !candidate
      || id === excludeId
      || candidate.archived
      || !sameScope(candidate, workspaceId, bookId)
    ) continue;
    const opened = candidate.lastOpenedAt ?? candidate.lastActivityAt;
    const selectedOpened = selected?.lastOpenedAt ?? selected?.lastActivityAt ?? Number.NEGATIVE_INFINITY;
    if (!selected || opened > selectedOpened) selected = candidate;
  }
  return selected?.id ?? null;
}

function safeRetryError(message: unknown): string {
  const normalized = (typeof message === "string" ? message : "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized
    ? Array.from(normalized).slice(0, 240).join("")
    : "任务运行失败，请重试。";
}

const RESTART_INTERRUPTION_MESSAGE = "上次任务因 Leemo 退出而中断";

/** A renderer restart cannot keep a host run alive. Persisted running markers
 * are useful history, but presenting them as live work is false. Settle every
 * stale marker and append one explicit receipt for the last unterminated run. */
function restoreTimelineAfterRestart(timeline: TimelineItem[]): TimelineItem[] {
  const terminalRuns = new Set(
    timeline.flatMap((item) =>
      item.kind === "result" || item.kind === "error" ? [item.runId] : [],
    ),
  );
  let interruptedRunId: string | undefined;
  const markInterrupted = (runId: string): void => {
    if (!terminalRuns.has(runId)) interruptedRunId = runId;
  };

  const restored = timeline.map((item): TimelineItem => {
    if ((item.kind === "text" || item.kind === "thinking") && item.streaming) {
      markInterrupted(item.runId);
      return { ...item, streaming: false };
    }
    if (item.kind === "tool" && item.status === "running") {
      markInterrupted(item.runId);
      return { ...item, status: "error" };
    }
    if (item.kind === "activity") {
      const hasRunningChild = item.tools.some((tool) => tool.status === "running");
      if (item.status === "running" || hasRunningChild) {
        markInterrupted(item.runId);
        return {
          ...item,
          status: "error",
          tools: item.tools.map((tool) => tool.status === "running" ? { ...tool, status: "error" } : tool),
        };
      }
    }
    if (item.kind === "retry" && item.state === "retrying") {
      markInterrupted(item.runId);
      return { ...item, state: "failed" };
    }
    return item;
  });

  if (!interruptedRunId) return restored;
  const baseId = `restart-interrupted-${interruptedRunId}`;
  let receiptId = baseId;
  let suffix = 1;
  while (restored.some((item) => item.id === receiptId)) receiptId = `${baseId}-${++suffix}`;
  return [
    ...restored,
    { kind: "error", id: receiptId, runId: interruptedRunId, message: RESTART_INTERRUPTION_MESSAGE },
  ];
}

/** Free, local title derivation for the first turn. It removes request boilerplate
 * and path noise instead of billing the user's model for a second hidden call.
 * Manual rename remains the authority after this one automatic pass. */
export function deriveConversationTitle(text: string, attachmentNames: string[] = []): string {
  let candidate = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\)*([^\\\s，。！？,!?；;]+)/g, "$1")
    .replace(/(^|\s)\/(?:[^/\s]+\/)*([^/\s，。！？,!?；;]+)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:#{1,6}|[-*>]|\d+[.)])\s+/, "")
    .replace(/^[「『“\"'【\[]+/, "")
    .replace(/[」』”\"'】\]]+$/, "");

  for (let i = 0; i < 3; i += 1) {
    const before = candidate;
    candidate = candidate
      .replace(/^(?:你好|嗨|hi|hello)[，,：:\s]*/i, "")
      .replace(/^(?:请问|请|麻烦)(?:你)?\s*/i, "")
      .replace(/^(?:可以|能不能|能否)(?:(?:请)?你|(?:请)?帮我|帮忙)\s*/i, "")
      .replace(/^(?:帮我|帮忙|替我|给我|我(?:想|希望|需要)(?:让)?你)\s*/i, "");
    if (candidate === before) break;
  }
  candidate = candidate
    .replace(/^(?:现在|接下来|这次)\s*/, "")
    .replace(/^直接\s*/, "")
    .replace(/^联网搜(?:索)?(?:一下)?\s*/, "搜索 ")
    .replace(/\s+/g, " ")
    .trim();

  const colon = candidate.match(/^([^：:]{1,8})[：:]\s*(.+)$/);
  if (colon && /^(?:任务|需求|问题|目标|背景|说明|请求|主题)$/.test(colon[1].trim())) {
    candidate = colon[2];
  }
  const clauses = candidate.split(/[，,。！？!?；;]+/).map((part) => part.trim()).filter(Boolean);
  candidate = clauses.find((part) => Array.from(part).length >= 4) ?? clauses[0] ?? candidate;
  candidate = candidate.replace(/[：:\-—\s]+$/g, "").trim();

  if (!candidate) candidate = attachmentNames.filter(Boolean).slice(0, 2).join("、");
  if (!candidate) return "新对话";
  return Array.from(candidate).slice(0, 32).join("");
}

/** Pure renderer-side event fold. Subscription ownership moved to
 * wireBridgeSubscriptions (Batch 0c). */
export function foldConversationEnvelope(
  state: ConversationsState,
  envelope: BridgeEventEnvelope,
  now: number,
): Partial<ConversationsState> {
  const conversationId = envelope.conversationId;
  const meta = state.byId[conversationId];
  if (!meta) return {};

  const oldRunId = state.runIds[conversationId];
  const timeline = applyEvent(
    state.timelines[conversationId] ?? [],
    envelope.event,
    oldRunId ?? RENDERER_RUN_ID_INITIAL,
    now,
    conversationId,
  );
  const event = envelope.event;
  const finished = event.type === "run.finished";
  const pending = state.pendingSends[conversationId];
  // The host enforces one active round per conversation. Keeping the local
  // run-id guard here additionally prevents a stale error fold from rewriting
  // a newer pending draft in tests, fixtures, or delayed renderer work.
  const ownsPending = oldRunId !== null && oldRunId !== undefined && pending?.runId === oldRunId;
  let pendingSends = state.pendingSends;
  if (event.type === "error" && ownsPending && pending) {
    pendingSends = {
      ...state.pendingSends,
      [conversationId]: { ...pending, errorMessage: safeRetryError(event.message) },
    };
  } else if (finished && ownsPending && pending) {
    if (event.isError && event.subtype !== "interrupted" && event.retryable !== false) {
      pendingSends = {
        ...state.pendingSends,
        [conversationId]: {
          ...pending,
          errorMessage: pending.errorMessage ?? safeRetryError(event.finalText),
        },
      };
    } else {
      pendingSends = withoutConversation(state.pendingSends, conversationId);
    }
  }
  const nextMeta: ConversationMeta = {
    ...meta,
    lastActivityAt: now,
    unread: finished && conversationId !== state.activeId ? true : meta.unread,
  };
  // 卡 C: latch the round's session id onto meta. This is the ONLY write path —
  // meta becomes a new object, which is exactly what startPersistenceSync's
  // reference check watches, so the id reaches SQLite with no extra plumbing.
  // A round that reports none leaves the previous value alone (never regress a
  // known session to undefined).
  if (event.type === "run.finished" && event.sessionId) {
    nextMeta.sessionId = event.sessionId;
  }

  return {
    byId: { ...state.byId, [conversationId]: nextMeta },
    order: moveToFront(state.order, conversationId),
    timelines: { ...state.timelines, [conversationId]: timeline },
    pendingSends,
    runIds: finished
      ? { ...state.runIds, [conversationId]: null }
      : state.runIds,
  };
}

export function createConversationsStore(
  client: BridgeClient,
  deps: ConversationsStoreDeps,
): StoreApi<ConversationsState> {
  let runSeq = 0;
  let queueSeq = 0;
  let localCorrectionSeq = 0;
  const now = deps.now ?? Date.now;
  const reportPersistenceError = deps.onPersistenceError
    ?? ((error: unknown) => console.error("[leemo:conversation-lifecycle]", error));

  const persistOpened = (meta: ConversationMeta, timeline: TimelineItem[]): void => {
    if (!deps.persistence) return;
    void deps.persistence.saveConversation(meta, timeline).catch(reportPersistenceError);
  };

  /** Conversations this process has a LIVE host-side counterpart for (轮 2 卡 C).
   *  Deliberately NOT store state and never persisted: it mirrors the host's
   *  in-memory registry, which dies with the process. Anything restored by
   *  hydrate() is absent here by construction, which is precisely the signal
   *  that it must be re-claimed before its next send. */
  const hostLive = new Set<string>();
  // Synchronous ownership for the whole pre-ack path. `runIds` cannot protect
  // a restored conversation while its first host claim is still awaiting IPC.
  // One ownership gate covers first-host claim, sending, disposal and durable
  // lifecycle mutations. Without a shared lock, an archive/move/delete can
  // cross the async gap before runId exists, or a new send can begin while a
  // lifecycle write is still pending.
  const conversationLocks = new Set<string>();
  const queueFlushLocks = new Set<string>();

  /** Make sure the host has a conversation answering to `conversationId`.
   *
   *  After a restart the renderer holds ids the host has never heard of, and
   *  `bridge:send` failed with `unknown conversation: <cid>` — the message just
   *  vanished. Re-claiming keeps the id (timeline + SQLite primary key are keyed
   *  on it) and hands the host the persisted session so the thread genuinely
   *  continues rather than restarting blank. */
  async function ensureHostConversation(
    client: BridgeClient,
    meta: ConversationMeta,
    permissionMode?: PermissionMode,
  ): Promise<void> {
    if (hostLive.has(meta.id)) return;
    await deps.ensureSkillsReady?.();
    const persona = deps.resolvePersonaContext?.();
    const enabledSkills = deps.resolveEnabledSkills?.();
    await client.invoke("bridge:createConversation", {
      conversationId: meta.id,
      providerId: meta.providerId,
      modelId: meta.modelId,
      purpose: "main",
      ...(meta.sessionId ? { resumeSessionId: meta.sessionId } : {}),
      ...(meta.workspaceId ? { workspaceId: meta.workspaceId } : {}),
      // 轮 3 卡 G: re-claiming after a restart must carry the notebook binding
      // too, or a hydrated conversation silently loses prompt layer ⑨ — the
      // 本子约定 would apply before the restart and not after.
      ...(meta.bookId ? { notebookId: meta.bookId } : {}),
      ...(persona ?? {}),
      ...(permissionMode !== undefined ? { permissionMode } : {}),
      // Spread-on-defined keeps "no opinion" (key absent) distinct from "all
      // off" (empty array) all the way to the SDK.
      ...(enabledSkills !== undefined ? { enabledSkills } : {}),
    });
    hostLive.add(meta.id);
  }

  const store = createStore<ConversationsState>((set, get) => ({
    byId: {},
    order: [],
    activeId: null,
    openTabs: [],
    timelines: {},
    runIds: {},
    pendingSends: {},
    queuedTurns: {},

    createConversation: async ({
      source,
      bookId,
      workspaceId: requestedWorkspaceId,
      activate = true,
      modelSelection,
      durableRelationshipChapter = false,
    }) => {
      await deps.ensureSkillsReady?.();
      const defaults = deps.resolveConversationDefaults();
      const providerId = modelSelection?.providerId ?? defaults.providerId;
      const modelId = modelSelection?.modelId ?? defaults.modelId;
      const persona = deps.resolvePersonaContext?.();
      const enabledSkills = deps.resolveEnabledSkills?.();
      const selectedWorkspaceId = requestedWorkspaceId ?? deps.resolveActiveWorkspaceId?.();
      const workspaceId = selectedWorkspaceId === undefined
        ? undefined
        : source === "buddy"
          ? HOME_WORKSPACE_ID
          : selectedWorkspaceId;
      // Buddy mode is momo's global scope even when the workbench still has a
      // 本子 selected. Workbench conversations inherit that selected book only
      // when the caller did not provide an explicit scope.
      const notebookId = source === "buddy"
        ? null
        : bookId !== undefined
          ? bookId
          : deps.resolveActiveNotebook?.() ?? null;
      const { conversationId } = await client.invoke("bridge:createConversation", {
        providerId,
        modelId,
        purpose: "main",
        ...(persona ?? {}),
        ...(enabledSkills !== undefined ? { enabledSkills } : {}),
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        // Send the ID only — the host reads <notebook>/CLAUDE.md itself, fresh
        // per conversation, so momo sees what it wrote there a minute ago.
        ...(notebookId ? { notebookId } : {}),
      });
      const timestamp = now();
      const meta: ConversationMeta = {
        id: conversationId,
        title: "新对话",
        titleManuallyUpdated: false,
        bookId: notebookId,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        source,
        providerId,
        modelId,
        createdAt: timestamp,
        lastActivityAt: timestamp,
        lastOpenedAt: timestamp,
        pinned: false,
        archived: false,
        unread: false,
      };
      if (durableRelationshipChapter && deps.persistence) {
        if (!deps.persistence.saveRelationshipChapter) {
          await client.invoke("bridge:disposeConversation", { conversationId }).catch(() => undefined);
          throw new Error("当前存储版本无法安全创建新话题，请重启 Leemo 后再试。");
        }
        try {
          await deps.persistence.saveRelationshipChapter(meta, []);
        } catch (error: unknown) {
          await client.invoke("bridge:disposeConversation", { conversationId }).catch(() => undefined);
          throw error;
        }
      }
      hostLive.add(conversationId);
      set((state) => ({
        byId: { ...state.byId, [conversationId]: meta },
        order: moveToFront(state.order, conversationId),
        activeId: activate ? conversationId : state.activeId,
        timelines: { ...state.timelines, [conversationId]: [] },
        runIds: { ...state.runIds, [conversationId]: null },
      }));
      return conversationId;
    },

    discardEmptyConversation: async (conversationId) => {
      const initial = get();
      const activeRun = initial.runIds[conversationId];
      if (
        !initial.byId[conversationId]
        || (initial.timelines[conversationId]?.length ?? 0) > 0
        || (initial.queuedTurns[conversationId]?.length ?? 0) > 0
        || (activeRun !== null && activeRun !== undefined)
        || conversationLocks.has(conversationId)
      ) {
        return false;
      }

      // Lock the same ownership gate used by send() so a retry cannot begin
      // between the empty check and host teardown.
      conversationLocks.add(conversationId);
      try {
        await client.invoke("bridge:disposeConversation", { conversationId }).catch(() => undefined);
        const current = get();
        const currentRun = current.runIds[conversationId];
        if (
          !current.byId[conversationId]
          || (current.timelines[conversationId]?.length ?? 0) > 0
          || (current.queuedTurns[conversationId]?.length ?? 0) > 0
          || (currentRun !== null && currentRun !== undefined)
        ) {
          return false;
        }

        hostLive.delete(conversationId);
        set((state) => {
          const byId = { ...state.byId };
          const timelines = { ...state.timelines };
          const runIds = { ...state.runIds };
          const pendingSends = { ...state.pendingSends };
          const queuedTurns = { ...state.queuedTurns };
          delete byId[conversationId];
          delete timelines[conversationId];
          delete runIds[conversationId];
          delete pendingSends[conversationId];
          delete queuedTurns[conversationId];
          const order = state.order.filter((id) => id !== conversationId);
          return {
            byId,
            timelines,
            runIds,
            pendingSends,
            queuedTurns,
            order,
            openTabs: state.openTabs.filter((id) => id !== conversationId),
            activeId: state.activeId === conversationId ? order[0] ?? null : state.activeId,
          };
        });
        return true;
      } finally {
        conversationLocks.delete(conversationId);
      }
    },

    send: async (conversationId, text, attachments, workspaceFiles, turnOptions) => {
      const initial = get();
      const known = initial.byId[conversationId];
      if (!known) throw unknownConversation(conversationId);
      if (initial.runIds[conversationId] !== null && initial.runIds[conversationId] !== undefined) {
        throw new Error("这个对话仍在执行，请等待完成或先停止后再发送。");
      }
      if (conversationLocks.has(conversationId)) {
        throw new Error("这个对话仍在执行，请等待完成或先停止后再发送。");
      }
      conversationLocks.add(conversationId);

      try {
        const hostWasLive = hostLive.has(conversationId);
        // Claim BEFORE the optimistic timeline write: a failed claim must not
        // leave a user bubble sitting in a conversation that never sent.
        await ensureHostConversation(client, known, turnOptions?.permissionMode);
        if (hostWasLive && turnOptions?.permissionMode !== undefined) {
          await client.invoke("bridge:updateContext", {
            conversationId,
            permissionMode: turnOptions.permissionMode,
          });
        }

        // Re-read after the await — the claim is an async IPC hop, and events for
        // OTHER conversations (or this one) may have landed meanwhile.
        const state = get();
        const meta = state.byId[conversationId];
        if (!meta) throw unknownConversation(conversationId);
        // The host and timeline both model one active round per conversation.
        // Re-check after the asynchronous host claim so a scheduled task and a
        // user click cannot race through the first guard and steal each other's
        // run id or retry draft.
        if (state.runIds[conversationId] !== null && state.runIds[conversationId] !== undefined) {
          throw new Error("这个对话仍在执行，请等待完成或先停止后再发送。");
        }

        const runId = `run-${++runSeq}`;
        const timeline = state.timelines[conversationId] ?? [];
        const timestamp = now();
        const displayFiles = [
          ...(attachments ?? []).map(({ name, size, mimeType }) => ({
            name,
            size,
            sourceKind: "local" as const,
            ...(mimeType ? { mimeType } : {}),
          })),
          ...(workspaceFiles ?? []).map(({ name, workspaceId, workspacePath }) => ({
            name,
            size: 0,
            sourceKind: "workspace" as const,
            workspaceId,
            workspacePath,
          })),
        ];
        const visibleText = turnOptions?.displayText?.trim() || text;
        const userMessage: TimelineItem = {
          kind: "text",
          id: `u${timeline.length}`,
          runId,
          role: "user",
          text: visibleText,
          streaming: false,
          createdAt: timestamp,
          ...(displayFiles.length > 0 ? { attachments: displayFiles } : {}),
        };
        const title = meta.title === "新对话" && !meta.titleManuallyUpdated
          ? deriveConversationTitle(visibleText, displayFiles.map((file) => file.name))
          : meta.title;
        // A user may deliberately start a different turn while the previous
        // failed turn is still offered for retry. The new draft temporarily owns
        // the one-per-conversation pending slot, but the old draft remains the
        // rollback value until the host acknowledges the replacement.
        const previousPending = state.pendingSends[conversationId];
        const pendingDraft: PendingSendDraft = {
          runId,
          text,
          attachments: attachments?.map((attachment) => ({ ...attachment })) ?? [],
          workspaceFiles: workspaceFiles?.map((file) => ({ ...file })) ?? [],
          ...(turnOptions?.noteReferences && turnOptions.noteReferences.length > 0
            ? { noteReferences: [...turnOptions.noteReferences] }
            : {}),
          providerId: meta.providerId,
          modelId: meta.modelId,
          ...(turnOptions?.allowSubagents !== undefined
            ? { allowSubagents: turnOptions.allowSubagents }
            : {}),
          ...(turnOptions?.permissionMode !== undefined
            ? { permissionMode: turnOptions.permissionMode }
            : {}),
          ...(turnOptions?.suppressGoal !== undefined
            ? { suppressGoal: turnOptions.suppressGoal }
            : {}),
          ...(turnOptions?.displayText !== undefined
            ? { displayText: turnOptions.displayText }
            : {}),
        };

        set((current) => ({
          byId: {
            ...current.byId,
            [conversationId]: { ...current.byId[conversationId], title, lastActivityAt: timestamp },
          },
          order: moveToFront(current.order, conversationId),
          timelines: { ...current.timelines, [conversationId]: [...timeline, userMessage] },
          runIds: { ...current.runIds, [conversationId]: runId },
          pendingSends: { ...current.pendingSends, [conversationId]: pendingDraft },
        }));
        try {
          const goalText = !turnOptions?.suppressGoal && meta.goal?.status === "active"
            ? meta.goal.text.trim()
            : "";
          await client.invoke("bridge:send", {
            conversationId,
            prompt: text,
            sourceMessageId: userMessage.id,
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
            ...(workspaceFiles && workspaceFiles.length > 0 ? { workspaceFiles } : {}),
            ...(turnOptions?.noteReferences && turnOptions.noteReferences.length > 0
              ? { noteReferences: turnOptions.noteReferences }
              : {}),
            ...(turnOptions?.allowSubagents !== undefined
              ? { allowSubagents: turnOptions.allowSubagents }
              : {}),
            ...(goalText ? { goalText } : {}),
          });
        } catch (error) {
          // `bridge:send` is the acknowledgement boundary. When validation or IPC
          // rejects before a round starts, remove only this optimistic turn and
          // restore its metadata. This prevents a permanent fake-running state.
          set((current) => {
            if (current.runIds[conversationId] !== runId) return {};
            return {
              byId: {
                ...current.byId,
                [conversationId]: {
                  ...current.byId[conversationId],
                  title: meta.title,
                  lastActivityAt: meta.lastActivityAt,
                },
              },
              timelines: {
                ...current.timelines,
                [conversationId]: (current.timelines[conversationId] ?? []).filter(
                  (item) => !(item.kind === "text" && item.id === userMessage.id && item.runId === runId),
                ),
              },
              runIds: { ...current.runIds, [conversationId]: null },
              pendingSends: previousPending
                ? { ...current.pendingSends, [conversationId]: previousPending }
                : withoutConversation(current.pendingSends, conversationId),
            };
          });
          throw error;
        }
      } finally {
        conversationLocks.delete(conversationId);
      }
    },

    refreshWorkOverview: async (conversationId) => {
      const state = get();
      if (!state.byId[conversationId]) throw unknownConversation(conversationId);
      if (state.runIds[conversationId] !== null && state.runIds[conversationId] !== undefined) {
        throw new Error("任务进行中，完成后会自动更新概览。");
      }
      return get().send(conversationId, WORK_OVERVIEW_MANUAL_REFRESH_PROMPT, [], [], {
        displayText: "更新工作概览",
        allowSubagents: false,
        suppressGoal: true,
      });
    },

    correctWorkOverview: async (conversationId, correction) => {
      const initial = get();
      if (!initial.byId[conversationId]) throw unknownConversation(conversationId);
      if (initial.runIds[conversationId] !== null && initial.runIds[conversationId] !== undefined) {
        throw new Error("任务进行中，完成后再编辑工作概览。");
      }
      if (conversationLocks.has(conversationId)) {
        throw new Error("这个对话正在保存，请稍后再试。");
      }
      conversationLocks.add(conversationId);
      const timestamp = now();
      const correctionId = `local-correction-${timestamp}-${++localCorrectionSeq}`;
      try {
        const state = get();
        const meta = state.byId[conversationId];
        if (!meta) throw unknownConversation(conversationId);
        if (state.runIds[conversationId] !== null && state.runIds[conversationId] !== undefined) {
          throw new Error("任务进行中，完成后再编辑工作概览。");
        }
        const timeline = state.timelines[conversationId] ?? [];
        const overview = applyUserWorkOverviewCorrection(
          latestWorkOverviewSnapshot(timeline, conversationId, timestamp),
          correction,
          { correctionId, scopeConversationId: conversationId, updatedAt: timestamp },
        );
        const nextTimeline: TimelineItem[] = [...timeline, {
          kind: "overview",
          id: correctionId,
          runId: "",
          toolUseId: "",
          overview,
          createdAt: timestamp,
        }];

        await deps.persistence?.saveConversation(meta, nextTimeline);
        const latest = get();
        const latestMeta = latest.byId[conversationId];
        if (!latestMeta) throw unknownConversation(conversationId);
        const latestTimeline = latest.timelines[conversationId] ?? [];
        const latestRunId = latest.runIds[conversationId];
        if (
          (latestRunId !== null && latestRunId !== undefined)
          || latestMeta !== meta
          || latestTimeline !== timeline
        ) {
          await deps.persistence?.saveConversation(latestMeta, latestTimeline);
          throw new Error("对话刚刚发生变化，请重试编辑工作概览。");
        }
        set({ timelines: { ...latest.timelines, [conversationId]: nextTimeline } });
      } finally {
        conversationLocks.delete(conversationId);
      }
    },

    guide: async (conversationId, text) => {
      const state = get();
      const runId = state.runIds[conversationId];
      const prompt = text.trim();
      if (!state.byId[conversationId]) throw unknownConversation(conversationId);
      if (!runId) throw new Error("当前没有正在执行的任务。");
      if (!prompt) throw new Error("引导内容不能为空。");
      const timeline = state.timelines[conversationId] ?? [];
      const item: TimelineItem = {
        kind: "text",
        id: `g${timeline.length}`,
        runId,
        role: "user",
        text: prompt,
        streaming: false,
        createdAt: now(),
      };
      set((current) => ({
        timelines: {
          ...current.timelines,
          [conversationId]: [...(current.timelines[conversationId] ?? []), item],
        },
      }));
      try {
        return await client.invoke("bridge:guide", { conversationId, prompt });
      } catch (error) {
        set((current) => ({
          timelines: {
            ...current.timelines,
            [conversationId]: (current.timelines[conversationId] ?? []).filter(
              (candidate) => candidate.id !== item.id
                || candidate.kind !== "text"
                || candidate.runId !== runId,
            ),
          },
        }));
        throw error;
      }
    },

    enqueueTurn: (conversationId, text, attachments, workspaceFiles, options) => {
      if (!get().byId[conversationId]) throw unknownConversation(conversationId);
      const prompt = text.trim();
      const copiedAttachments = attachments?.map((attachment) => ({ ...attachment })) ?? [];
      const copiedWorkspaceFiles = workspaceFiles?.map((file) => ({ ...file })) ?? [];
      const copiedNotes = options?.noteReferences ? [...options.noteReferences] : undefined;
      if (!prompt && copiedAttachments.length === 0 && copiedWorkspaceFiles.length === 0 && !copiedNotes?.length) {
        throw new Error("消息不能为空。");
      }
      const id = `queued-${++queueSeq}`;
      const queuedTurn: QueuedTurn = {
        id,
        text,
        attachments: copiedAttachments,
        workspaceFiles: copiedWorkspaceFiles,
        ...(copiedNotes?.length ? { noteReferences: copiedNotes } : {}),
        ...(options?.allowSubagents !== undefined ? { allowSubagents: options.allowSubagents } : {}),
        ...(options?.permissionMode !== undefined ? { permissionMode: options.permissionMode } : {}),
        ...(options?.displayText !== undefined ? { displayText: options.displayText } : {}),
      };
      set((state) => ({
        queuedTurns: {
          ...state.queuedTurns,
          [conversationId]: [...(state.queuedTurns[conversationId] ?? []), queuedTurn],
        },
      }));
      return id;
    },

    removeQueuedTurn: (conversationId, queuedTurnId) => {
      if (!get().byId[conversationId]) throw unknownConversation(conversationId);
      set((state) => ({
        queuedTurns: {
          ...state.queuedTurns,
          [conversationId]: (state.queuedTurns[conversationId] ?? []).filter((turn) => turn.id !== queuedTurnId),
        },
      }));
    },

    guideQueuedTurn: async (conversationId, queuedTurnId) => {
      const queuedTurn = get().queuedTurns[conversationId]?.find((turn) => turn.id === queuedTurnId);
      if (!queuedTurn) throw new Error("这条排队消息已经不存在。");
      if (
        queuedTurn.attachments.length > 0
        || queuedTurn.workspaceFiles.length > 0
        || (queuedTurn.noteReferences?.length ?? 0) > 0
      ) {
        throw new Error("含附件、文件或便签的消息不能转为引导。");
      }
      const result = await get().guide(conversationId, queuedTurn.text);
      get().removeQueuedTurn(conversationId, queuedTurnId);
      return result;
    },

    flushQueuedTurns: async (conversationId) => {
      if (queueFlushLocks.has(conversationId)) return;
      const initial = get();
      if (!initial.byId[conversationId] || initial.runIds[conversationId]) return;
      const head = initial.queuedTurns[conversationId]?.[0];
      if (!head) return;
      queueFlushLocks.add(conversationId);
      try {
        const options: ConversationTurnOptions | undefined =
          head.allowSubagents === undefined && head.displayText === undefined && head.noteReferences === undefined && head.permissionMode === undefined
            ? undefined
            : {
                ...(head.allowSubagents !== undefined ? { allowSubagents: head.allowSubagents } : {}),
                ...(head.displayText !== undefined ? { displayText: head.displayText } : {}),
                ...(head.noteReferences !== undefined ? { noteReferences: [...head.noteReferences] } : {}),
                ...(head.permissionMode !== undefined ? { permissionMode: head.permissionMode } : {}),
              };
        await get().send(
          conversationId,
          head.text,
          head.attachments.map((attachment) => ({ ...attachment })),
          head.workspaceFiles.map((file) => ({ ...file })),
          options,
        );
        set((state) => {
          const queue = state.queuedTurns[conversationId] ?? [];
          if (queue[0]?.id !== head.id) return {};
          return {
            queuedTurns: {
              ...state.queuedTurns,
              [conversationId]: queue.slice(1),
            },
          };
        });
      } catch (error) {
        const errorMessage = safeRetryError(error instanceof Error ? error.message : error);
        set((state) => {
          const queue = state.queuedTurns[conversationId] ?? [];
          if (queue[0]?.id !== head.id) return {};
          return {
            queuedTurns: {
              ...state.queuedTurns,
              [conversationId]: [{ ...queue[0], errorMessage }, ...queue.slice(1)],
            },
          };
        });
      } finally {
        queueFlushLocks.delete(conversationId);
      }
    },

    retry: async (conversationId) => {
      const draft = get().pendingSends[conversationId];
      if (!draft?.errorMessage) return;
      try {
        await get().send(
          conversationId,
          draft.text,
          draft.attachments,
          draft.workspaceFiles,
          draft.allowSubagents === undefined
            && draft.displayText === undefined
            && draft.noteReferences === undefined
            && draft.permissionMode === undefined
            && draft.suppressGoal === undefined
            ? undefined
            : {
                ...(draft.allowSubagents !== undefined ? { allowSubagents: draft.allowSubagents } : {}),
                ...(draft.displayText !== undefined ? { displayText: draft.displayText } : {}),
                ...(draft.noteReferences !== undefined ? { noteReferences: draft.noteReferences } : {}),
                ...(draft.permissionMode !== undefined ? { permissionMode: draft.permissionMode } : {}),
                ...(draft.suppressGoal !== undefined ? { suppressGoal: draft.suppressGoal } : {}),
              },
        );
      } catch (error) {
        const meta = get().byId[conversationId];
        set((state) => ({
          pendingSends: {
            ...state.pendingSends,
            [conversationId]: {
              ...draft,
              ...(meta ? { providerId: meta.providerId, modelId: meta.modelId } : {}),
              errorMessage: safeRetryError(error instanceof Error ? error.message : error),
            },
          },
        }));
        throw error;
      }
    },

    dismissRetry: (conversationId) => {
      if (!get().pendingSends[conversationId]?.errorMessage) return;
      set((state) => ({
        pendingSends: withoutConversation(state.pendingSends, conversationId),
      }));
    },

    interrupt: async (conversationId) => {
      if (!get().byId[conversationId]) throw unknownConversation(conversationId);
      await client.invoke("bridge:interrupt", { conversationId });
    },

    activateWorkspace: (workspaceId) => {
      set((state) => {
        const nextActiveId = state.order.reduce<string | null>((newestId, id) => {
          const candidate = state.byId[id];
          if (!candidate || (candidate.workspaceId ?? HOME_WORKSPACE_ID) !== workspaceId) return newestId;
          if (!newestId) return id;
          return candidate.lastActivityAt > state.byId[newestId].lastActivityAt ? id : newestId;
        }, null);
        if (!nextActiveId) return { activeId: null };
        const byId = markRead(state.byId, nextActiveId);
        return {
          activeId: nextActiveId,
          ...(byId === state.byId ? {} : { byId }),
        };
      });
    },

    activateScope: (workspaceId, bookId) => {
      set((state) => {
        const nextActiveId = nextConversationInScope(state, workspaceId, bookId);
        if (!nextActiveId) return { activeId: null };
        const timestamp = now();
        const current = state.byId[nextActiveId];
        const opened = { ...current, unread: false, lastOpenedAt: timestamp };
        const byId = { ...state.byId, [nextActiveId]: opened };
        persistOpened(opened, state.timelines[nextActiveId] ?? []);
        return {
          activeId: nextActiveId,
          byId,
        };
      });
    },

    switchActive: (conversationId) => {
      if (!get().byId[conversationId]) return;
      set((state) => {
        const opened = { ...state.byId[conversationId], unread: false, lastOpenedAt: now() };
        persistOpened(opened, state.timelines[conversationId] ?? []);
        return { activeId: conversationId, byId: { ...state.byId, [conversationId]: opened } };
      });
    },

    openTab: (conversationId) => {
      const state = get();
      if (!state.byId[conversationId] || state.openTabs.includes(conversationId) || state.openTabs.length >= 5) return;
      set({ openTabs: [...state.openTabs, conversationId] });
    },

    closeTab: (conversationId) => {
      const state = get();
      const index = state.openTabs.indexOf(conversationId);
      if (index === -1) return;
      const openTabs = state.openTabs.filter((id) => id !== conversationId);
      if (state.activeId !== conversationId) {
        set({ openTabs });
        return;
      }
      const closingMeta = state.byId[conversationId];
      const closingWorkspaceId = closingMeta?.workspaceId ?? HOME_WORKSPACE_ID;
      const closingBookId = closingMeta?.bookId ?? null;
      const sameScope = (id: string) => {
        const candidate = state.byId[id];
        return candidate !== undefined
          && (candidate.workspaceId ?? HOME_WORKSPACE_ID) === closingWorkspaceId
          && candidate.bookId === closingBookId;
      };
      const previousTab = state.openTabs.slice(0, index).filter(sameScope).at(-1);
      const nextTab = state.openTabs.slice(index + 1).find(sameScope);
      const nextActiveId = previousTab ?? nextTab ?? null;
      set((current) => {
        const byId = nextActiveId ? markRead(current.byId, nextActiveId) : current.byId;
        return { openTabs, activeId: nextActiveId, ...(byId === current.byId ? {} : { byId }) };
      });
    },

    renameTitle: (conversationId, title) => {
      if (!get().byId[conversationId]) return;
      const clean = Array.from(title.trim()).slice(0, 80).join("");
      if (!clean) return;
      set((state) => ({
        byId: {
          ...state.byId,
          [conversationId]: { ...state.byId[conversationId], title: clean, titleManuallyUpdated: true },
        },
      }));
    },

    setGoal: async (conversationId, text) => {
      const clean = text.trim();
      if (!clean) throw new Error("目标内容不能为空。");
      const state = get();
      const current = state.byId[conversationId];
      if (!current) throw unknownConversation(conversationId);
      const timestamp = now();
      const goal: ConversationGoal = {
        text: clean,
        status: current.goal?.status ?? "active",
        createdAt: current.goal?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      const next = { ...current, goal };
      await deps.persistence?.saveConversation(next, state.timelines[conversationId] ?? []);
      set((latest) => latest.byId[conversationId]
        ? { byId: { ...latest.byId, [conversationId]: { ...latest.byId[conversationId], goal } } }
        : {});
    },

    toggleGoalPaused: async (conversationId) => {
      const state = get();
      const current = state.byId[conversationId];
      if (!current) throw unknownConversation(conversationId);
      if (!current.goal) return;
      const goal: ConversationGoal = {
        ...current.goal,
        status: current.goal.status === "active" ? "paused" : "active",
        updatedAt: now(),
      };
      const next = { ...current, goal };
      await deps.persistence?.saveConversation(next, state.timelines[conversationId] ?? []);
      set((latest) => latest.byId[conversationId]
        ? { byId: { ...latest.byId, [conversationId]: { ...latest.byId[conversationId], goal } } }
        : {});
    },

    clearGoal: async (conversationId) => {
      const state = get();
      const current = state.byId[conversationId];
      if (!current) throw unknownConversation(conversationId);
      if (!current.goal) return;
      const { goal: _removed, ...next } = current;
      await deps.persistence?.saveConversation(next, state.timelines[conversationId] ?? []);
      set((latest) => {
        const latestMeta = latest.byId[conversationId];
        if (!latestMeta) return {};
        const { goal: _latestGoal, ...withoutGoal } = latestMeta;
        return { byId: { ...latest.byId, [conversationId]: withoutGoal } };
      });
    },

    setConversationUnread: async (conversationId, unread) => {
      if (typeof unread !== "boolean") return;
      const state = get();
      const current = state.byId[conversationId];
      if (!current) throw unknownConversation(conversationId);
      if (current.unread === unread) return;
      const next = { ...current, unread };
      // Persist before changing the visible state. A disk failure must not
      // make the menu claim that a reminder was saved when it was not.
      await deps.persistence?.saveConversation(next, state.timelines[conversationId] ?? []);
      set((latest) => latest.byId[conversationId]
        ? { byId: { ...latest.byId, [conversationId]: { ...latest.byId[conversationId], unread } } }
        : {});
    },

    pinConversation: async (conversationId, pinned) => {
      const state = get();
      const current = state.byId[conversationId];
      if (!current) throw unknownConversation(conversationId);
      const next = { ...current, pinned };
      await deps.persistence?.saveConversation(next, state.timelines[conversationId] ?? []);
      set((latest) => latest.byId[conversationId]
        ? {
            byId: {
              ...latest.byId,
              [conversationId]: { ...latest.byId[conversationId], pinned },
            },
          }
        : {});
    },

    archiveConversation: async (conversationId, archived) => {
      const state = get();
      const current = state.byId[conversationId];
      if (!current) throw unknownConversation(conversationId);
      const activeRun = state.runIds[conversationId];
      if (
        conversationLocks.has(conversationId)
        || (archived && (
          (activeRun !== null && activeRun !== undefined)
          || state.pendingSends[conversationId] !== undefined
          || (state.queuedTurns[conversationId]?.length ?? 0) > 0
        ))
      ) {
        throw new Error("对话进行中，完成或停止后再归档。");
      }
      conversationLocks.add(conversationId);
      try {
        const next = { ...current, archived };
        await deps.persistence?.saveConversation(next, state.timelines[conversationId] ?? []);
        set((latest) => {
          if (!latest.byId[conversationId]) return {};
          const workspaceId = workspaceIdOf(current);
          const nextActiveId = archived && latest.activeId === conversationId
            ? nextConversationInScope(latest, workspaceId, current.bookId, conversationId)
            : latest.activeId;
          return {
            byId: {
              ...latest.byId,
              [conversationId]: { ...latest.byId[conversationId], archived },
            },
            activeId: nextActiveId,
            ...(archived ? { openTabs: latest.openTabs.filter((id) => id !== conversationId) } : {}),
          };
        });
      } finally {
        conversationLocks.delete(conversationId);
      }
    },

    moveConversation: async (conversationId, target) => {
      const state = get();
      const current = state.byId[conversationId];
      if (!current) throw unknownConversation(conversationId);
      const activeRun = state.runIds[conversationId];
      if (
        (activeRun !== null && activeRun !== undefined)
        || conversationLocks.has(conversationId)
        || state.pendingSends[conversationId] !== undefined
        || (state.queuedTurns[conversationId]?.length ?? 0) > 0
      ) {
        throw new Error("对话进行中，完成或停止后再移动。");
      }
      const sourceWorkspaceId = workspaceIdOf(current);
      if (sourceWorkspaceId === target.workspaceId && current.bookId === target.bookId) return;
      if (!deps.persistence) throw new Error("当前环境暂不支持移动对话。");
      conversationLocks.add(conversationId);
      try {
        await client.invoke("bridge:disposeConversation", { conversationId });
        hostLive.delete(conversationId);
        const timestamp = Math.max(now(), current.lastActivityAt + 1);
        const next: ConversationMeta = {
          ...current,
          workspaceId: target.workspaceId,
          bookId: target.bookId,
          lastActivityAt: timestamp,
          lastOpenedAt: timestamp,
        };
        await deps.persistence.moveConversation(
          sourceWorkspaceId,
          next,
          state.timelines[conversationId] ?? [],
        );
        set((latest) => {
          if (!latest.byId[conversationId]) return {};
          const nextActiveId = latest.activeId === conversationId
            ? nextConversationInScope(latest, sourceWorkspaceId, current.bookId, conversationId)
            : latest.activeId;
          return {
            byId: {
              ...latest.byId,
              [conversationId]: {
                ...latest.byId[conversationId],
                workspaceId: target.workspaceId,
                bookId: target.bookId,
                lastActivityAt: timestamp,
                lastOpenedAt: timestamp,
              },
            },
            order: moveToFront(latest.order, conversationId),
            activeId: nextActiveId,
            openTabs: latest.openTabs.filter((id) => id !== conversationId),
          };
        });
        deps.onConversationMoved?.(conversationId);
      } finally {
        conversationLocks.delete(conversationId);
      }
    },

    deleteConversation: async (conversationId) => {
      const state = get();
      const current = state.byId[conversationId];
      if (!current) throw unknownConversation(conversationId);
      const activeRun = state.runIds[conversationId];
      if (
        (activeRun !== null && activeRun !== undefined)
        || conversationLocks.has(conversationId)
        || state.pendingSends[conversationId] !== undefined
        || (state.queuedTurns[conversationId]?.length ?? 0) > 0
      ) {
        throw new Error("对话进行中，完成或停止后再删除。");
      }
      if (!deps.persistence) throw new Error("当前环境暂不支持删除对话。");
      conversationLocks.add(conversationId);
      try {
        await client.invoke("bridge:disposeConversation", { conversationId });
        hostLive.delete(conversationId);
        await deps.persistence.deleteConversation(conversationId);
        set((latest) => {
          if (!latest.byId[conversationId]) return {};
          const byId = { ...latest.byId };
          const timelines = { ...latest.timelines };
          const runIds = { ...latest.runIds };
          const pendingSends = { ...latest.pendingSends };
          const queuedTurns = { ...latest.queuedTurns };
          delete byId[conversationId];
          delete timelines[conversationId];
          delete runIds[conversationId];
          delete pendingSends[conversationId];
          delete queuedTurns[conversationId];
          const order = latest.order.filter((id) => id !== conversationId);
          const nextActiveId = latest.activeId === conversationId
            ? nextConversationInScope({ byId, order }, workspaceIdOf(current), current.bookId)
            : latest.activeId;
          return {
            byId,
            timelines,
            runIds,
            pendingSends,
            queuedTurns,
            order,
            activeId: nextActiveId,
            openTabs: latest.openTabs.filter((id) => id !== conversationId),
          };
        });
        deps.onConversationDeleted?.(conversationId);
      } finally {
        conversationLocks.delete(conversationId);
      }
    },

    setModelForConversation: async (conversationId, providerId, modelId) => {
      if (!get().byId[conversationId]) throw unknownConversation(conversationId);
      await client.invoke("bridge:setModel", { conversationId, providerId, modelId });
      set((state) => ({
        byId: {
          ...state.byId,
          [conversationId]: { ...state.byId[conversationId], providerId, modelId },
        },
      }));
    },

    broadcastContext: async () => {
      const persona = deps.resolvePersonaContext?.();
      if (!persona) return [];
      // Only conversations the HOST has claimed: a hydrated-but-not-yet-claimed
      // one has no host record, and it will pick up the current context anyway
      // when it is claimed on its first send (ensureHostConversation).
      const targets = [...hostLive].filter((cid) => get().byId[cid]);
      const reached: string[] = [];
      await Promise.all(
        targets.map(async (conversationId) => {
          try {
            await client.invoke("bridge:updateContext", { conversationId, ...persona });
            reached.push(conversationId);
          } catch {
            // Best-effort per conversation: one torn-down conversation must not
            // stop the others from getting the new settings.
          }
        }),
      );
      return reached;
    },

    hydrate: (conversations) => {
      const byId: Record<string, ConversationMeta> = {};
      const timelines: Record<string, TimelineItem[]> = {};
      const runIds: Record<string, string | null> = {};
      for (const { meta, timeline } of conversations) {
        // No host-side run survives an app restart. Text/thinking records are
        // still useful history, but their old streaming caret must not imply
        // that work continues invisibly in the background.
        const restoredTimeline = restoreTimelineAfterRestart(timeline);
        const firstUserMessage = restoredTimeline.find(
          (item): item is Extract<TimelineItem, { kind: "text" }> =>
            item.kind === "text" && item.role === "user",
        );
        const legacyTitle = firstUserMessage
          ? Array.from(firstUserMessage.text).slice(0, 24).join("")
          : "";
        const shouldRefreshAutomaticTitle = !meta.titleManuallyUpdated
          && firstUserMessage !== undefined
          && (meta.title === "新对话" || meta.title === legacyTitle);
        const restoredMeta = shouldRefreshAutomaticTitle
          ? {
              ...meta,
              title: deriveConversationTitle(
                firstUserMessage.text,
                firstUserMessage.attachments?.map((attachment) => attachment.name),
              ),
            }
          : meta;
        byId[meta.id] = normalizedMeta(restoredMeta);
        timelines[meta.id] = restoredTimeline;
        runIds[meta.id] = null;
        // Restored turns carry run ids minted in an earlier process. Advance the
        // counter past them, or the next send would re-issue an existing id and
        // its message would be grouped into that finished turn. (`compact`
        // items have no runId — they attach to the preceding group.)
        for (const item of restoredTimeline) {
          if (item.kind === "compact") continue;
          const n = /^run-(\d+)$/.exec(item.runId);
          if (n) runSeq = Math.max(runSeq, Number(n[1]));
        }
      }
      // loadAll() returns newest-first; preserve that as the display order.
      const order = conversations.map((c) => c.meta.id);
      set({
        byId,
        order,
        timelines,
        runIds,
        pendingSends: {},
        queuedTurns: {},
        // A restart must not reopen a conversation the user deliberately
        // archived. The exact visible 本子 will call activateScope after its
        // own restoration; this fallback is only for the shared bootstrap.
        activeId: order.find((id) => !byId[id]?.archived) ?? null,
        openTabs: [],
      });
    },
  }));

  return store;
}
