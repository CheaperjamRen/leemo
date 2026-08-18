import type { ConversationMeta } from "../stores/conversations";
import type { TimelineItem } from "../stores/message-model";
import type { WikiEntry } from "../stores/wiki-entries";
import type { PersistedGlobalOverviewState } from "../../bridge/global-pending-overview";

/**
 * Renderer-side persistence port. The renderer owns the store (and the reducer
 * that folds bridge events into TimelineItems); the Electron main process owns
 * SQLite. This is the single seam between them: the renderer hands main the
 * already-folded conversation snapshot / wiki entry, and main writes rows.
 * Main treats each TimelineItem as opaque JSON — no renderer type crosses as a
 * live value, only as serialized data.
 *
 * Structurally identical DTOs live in src/main/persistence/schema.ts; they are
 * kept independent so neither layer imports the other (the IPC boundary
 * serializes JSON either way).
 */

export interface PersistedConversation {
  meta: ConversationMeta;
  timeline: TimelineItem[];
}

export interface PersistedSnapshot {
  conversations: PersistedConversation[];
  wikiEntries: WikiEntry[];
  /** 轮 7 A3 —— persisted settings, keyed as the settings store names them.
   *  Optional so a main process that predates A3 still satisfies the port. */
  settings?: Record<string, unknown>;
  globalPendingOverview?: PersistedGlobalOverviewState;
}

export interface PersistenceClient {
  /** Read everything back on startup (conversations newest-first). */
  loadAll(): Promise<PersistedSnapshot>;
  /** Upsert a conversation's meta + replace its full message timeline. */
  saveConversation(meta: ConversationMeta, timeline: TimelineItem[]): Promise<void>;
  /** Durably relocate a conversation before renderer state changes. */
  moveConversation(
    sourceWorkspaceId: string,
    meta: ConversationMeta,
    timeline: TimelineItem[],
  ): Promise<void>;
  /** Tombstone and remove one durable conversation. */
  deleteConversation(conversationId: string): Promise<void>;
  /** Upsert a single wiki Q&A entry (by id). */
  saveWikiEntry(entry: WikiEntry): Promise<void>;
  /** 轮 7 A3 —— replace the persisted settings map. */
  saveSettings(settings: Record<string, unknown>): Promise<void>;
  saveGlobalPendingOverview(state: PersistedGlobalOverviewState): Promise<void>;
}
