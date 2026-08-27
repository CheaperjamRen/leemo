import type { StoreApi } from "zustand/vanilla";
import type { ConversationsState, ConversationMeta } from "../stores/conversations";
import type { WikiState, WikiEntry } from "../stores/wiki-entries";
import type { TimelineItem } from "../stores/message-model";
import { pickPersistedSettings, type SettingsState } from "../stores/settings";
import { pickPersistedWorkbenchUi, type UiState } from "../stores/ui";
import { HOME_WORKSPACE_ID, type WorkspacesState } from "../stores/workspaces";
import type { PersistenceClient } from "./client";
import {
  serializeComposerDrafts,
  type ComposerDraftsState,
} from "../stores/composer-drafts";

export interface PersistenceSyncStores {
  conversations: StoreApi<ConversationsState>;
  wikiEntries: StoreApi<WikiState>;
  /** 轮 7 A3 —— optional so existing callers/tests keep compiling; the real
   *  bootstrap always passes it. */
  settings?: StoreApi<SettingsState>;
  /** Shell layout preferences share the settings KV map under a namespaced key. */
  ui?: StoreApi<UiState>;
  /** External books can be removed while a debounced conversation save is
   * pending. The registry is authoritative: once removed, do not write into
   * that folder again until the user opens it as a book another time. */
  workspaces?: StoreApi<WorkspacesState>;
  composerDrafts?: StoreApi<ComposerDraftsState>;
}

export interface PersistenceSyncDeps {
  /** Debounce seam: schedule a flush, returning a cancel fn. Default = 300ms
   *  setTimeout, which coalesces a turn's streaming deltas into ONE save that
   *  fires ~300ms after the stream settles (and immediately after run.finished
   *  quiets the timeline). Tests inject an immediate scheduler for determinism. */
  schedule?: (fn: () => void) => () => void;
  /** Non-throwing error sink (persistence is best-effort; never crash the UI). */
  onError?: (err: unknown) => void;
}

const DEFAULT_DEBOUNCE_MS = 1_500;

/**
 * Wire the renderer stores to persistent storage (Electron main → SQLite).
 *
 * Save policy:
 * - Conversations: debounced save whenever a conversation's meta OR timeline
 *   reference changes. Empty-timeline shells ("新对话" with no message) are
 *   skipped until their first message lands. The debounce turns a burst of
 *   streaming deltas into a single write per settled turn.
 * - Wiki entries: an entry is saved the moment it holds real Q&A (turns > 0);
 *   an open-but-unasked popup's empty entry is never written.
 *
 * The baseline "seen" refs are primed from the CURRENT store state so hydrated
 * (just-restored) data is not immediately written back. Returns an unsubscribe.
 */
export function startPersistenceSync(
  stores: PersistenceSyncStores,
  client: PersistenceClient,
  deps: PersistenceSyncDeps = {},
): () => void {
  const schedule =
    deps.schedule ??
    ((fn: () => void) => {
      const t = setTimeout(fn, DEFAULT_DEBOUNCE_MS);
      return () => clearTimeout(t);
    });
  const onError = deps.onError ?? ((err: unknown) => console.error("[leemo:persist-sync]", err));

  const seenMeta = new Map<string, ConversationMeta>();
  const seenTimeline = new Map<string, TimelineItem[]>();
  const seenWiki = new Map<string, WikiEntry>();

  // Prime baselines from hydrated state (no immediate re-save).
  {
    const s = stores.conversations.getState();
    for (const cid of Object.keys(s.byId)) {
      seenMeta.set(cid, s.byId[cid]);
      seenTimeline.set(cid, s.timelines[cid] ?? []);
    }
    for (const e of stores.wikiEntries.getState().entries) seenWiki.set(e.id, e);
  }

  const dirty = new Set<string>();
  let cancelPending: (() => void) | null = null;
  const canPersistConversation = (meta: ConversationMeta): boolean => {
    const workspaceId = meta.workspaceId ?? HOME_WORKSPACE_ID;
    if (workspaceId === HOME_WORKSPACE_ID || !stores.workspaces) return true;
    return stores.workspaces.getState().list.some((workspace) => workspace.id === workspaceId);
  };

  const flush = (): void => {
    cancelPending = null;
    const cids = [...dirty];
    dirty.clear();
    const state = stores.conversations.getState();
    for (const cid of cids) {
      const meta = state.byId[cid];
      const timeline = state.timelines[cid];
      if (!meta || !timeline) continue; // disposed between schedule and flush
      seenMeta.set(cid, meta);
      seenTimeline.set(cid, timeline);
      if (!canPersistConversation(meta)) continue;
      void client.saveConversation(meta, timeline).catch(onError);
    }
  };

  const unsubConversations = stores.conversations.subscribe((state, previous) => {
    let changed = false;
    let reachedTerminal = false;
    let startedTurn = false;
    for (const cid of Object.keys(state.byId)) {
      const meta = state.byId[cid];
      const timeline = state.timelines[cid] ?? [];
      if (timeline.length === 0) continue;
      if (seenMeta.get(cid) !== meta || seenTimeline.get(cid) !== timeline) {
        dirty.add(cid);
        changed = true;
      }
      if (previous.runIds[cid] && state.runIds[cid] === null) reachedTerminal = true;
      if (!previous.runIds[cid] && state.runIds[cid]) startedTurn = true;
    }
    if (changed) {
      cancelPending?.();
      // A terminal event is the user's durable completion boundary. Waiting
      // another 300 ms lets a fast window close discard the result footer and
      // final text, so flush the entire dirty batch immediately.
      if (startedTurn || reachedTerminal) flush();
      else cancelPending = schedule(flush);
    }
  });

  const unsubWiki = stores.wikiEntries.subscribe((state) => {
    for (const entry of state.entries) {
      if (entry.turns.length === 0) continue;
      if (seenWiki.get(entry.id) !== entry) {
        seenWiki.set(entry.id, entry);
        void client.saveWikiEntry(entry).catch(onError);
      }
    }
  });

  // 轮 7 A3 —— settings. Compared by VALUE (a small flat map), not by reference:
  // zustand's `set` produces a new state object on every action, including ones
  // that touch nothing we persist (e.g. refreshing searchKeySources), and a
  // reference check would write the same rows on each of them.
  //
  // Not debounced: a settings change is one deliberate click, not a stream. The
  // user expects「我改了就存住了」, and coalescing would open a window where
  // closing the app right after a click loses it.
  const persistedPreferences = (): Record<string, unknown> => ({
    ...(stores.settings ? pickPersistedSettings(stores.settings.getState()) : {}),
    ...(stores.ui ? { workbenchUi: pickPersistedWorkbenchUi(stores.ui.getState()) } : {}),
  });
  let seenSettings = JSON.stringify(persistedPreferences());
  const persistPreferences = (): void => {
    const next = JSON.stringify(persistedPreferences());
    if (next === seenSettings) return;
    seenSettings = next;
    void client.saveSettings(JSON.parse(next) as Record<string, unknown>).catch(onError);
  };
  const unsubSettings = stores.settings?.subscribe(persistPreferences);
  const unsubUi = stores.ui?.subscribe(persistPreferences);

  let seenDrafts = JSON.stringify(serializeComposerDrafts(stores.composerDrafts?.getState().drafts ?? {}));
  let pendingDrafts: string | null = null;
  let cancelDraftPending: (() => void) | null = null;
  const flushDrafts = (): void => {
    cancelDraftPending = null;
    if (pendingDrafts === null) return;
    const serialized = pendingDrafts;
    pendingDrafts = null;
    seenDrafts = serialized;
    void client.saveComposerDrafts(JSON.parse(serialized)).catch(onError);
  };
  const unsubComposerDrafts = stores.composerDrafts?.subscribe((state) => {
    const next = JSON.stringify(serializeComposerDrafts(state.drafts));
    if (next === seenDrafts && pendingDrafts === null) return;
    pendingDrafts = next;
    cancelDraftPending?.();
    cancelDraftPending = schedule(flushDrafts);
  });

  return () => {
    cancelPending?.();
    cancelDraftPending?.();
    // Best-effort final drain for non-terminal edits (rename, unread state).
    // The invoke is already dispatched before React unmount finishes.
    flush();
    flushDrafts();
    unsubConversations();
    unsubWiki();
    unsubSettings?.();
    unsubUi?.();
    unsubComposerDrafts?.();
  };
}
