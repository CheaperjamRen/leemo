import type { InvokeResult } from "../bridge/ipc-client";
import type { ConversationMeta } from "../stores/conversations";
import type { TimelineItem } from "../stores/message-model";
import type { WikiEntry } from "../stores/wiki-entries";
import type { PersistenceClient, PersistedSnapshot } from "./client";

/** The exact surface the preload exposes on `window.leemoPersist`
 *  (see src/main/preload.ts). One multiplexed invoke, mirroring leemoBridge. */
export interface LeemoPersistApi {
  invoke(op: string, payload: unknown): Promise<InvokeResult>;
}

const EMPTY_SNAPSHOT: PersistedSnapshot = { conversations: [], wikiEntries: [], settings: {} };

/**
 * PersistenceClient backed by Electron IPC (via the preload's
 * `window.leemoPersist`). Errors cross as data ({ ok:false, error }) — same
 * frame shape as leemoBridge — and are re-thrown here as real Errors.
 */
export class IpcPersistenceClient implements PersistenceClient {
  constructor(private readonly api: LeemoPersistApi) {}

  async loadAll(): Promise<PersistedSnapshot> {
    const res = await this.api.invoke("loadAll", undefined);
    if (!res.ok) throw new Error(res.error ?? "persist loadAll failed");
    return (res.response as PersistedSnapshot | undefined) ?? EMPTY_SNAPSHOT;
  }

  async saveConversation(meta: ConversationMeta, timeline: TimelineItem[]): Promise<void> {
    const res = await this.api.invoke("saveConversation", { meta, timeline });
    if (!res.ok) throw new Error(res.error ?? "persist saveConversation failed");
  }

  async moveConversation(
    sourceWorkspaceId: string,
    meta: ConversationMeta,
    timeline: TimelineItem[],
  ): Promise<void> {
    const res = await this.api.invoke("moveConversation", { sourceWorkspaceId, meta, timeline });
    if (!res.ok) throw new Error(res.error ?? "persist moveConversation failed");
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const res = await this.api.invoke("deleteConversation", { conversationId });
    if (!res.ok) throw new Error(res.error ?? "persist deleteConversation failed");
  }

  async saveWikiEntry(entry: WikiEntry): Promise<void> {
    const res = await this.api.invoke("saveWikiEntry", entry);
    if (!res.ok) throw new Error(res.error ?? "persist saveWikiEntry failed");
  }

  async saveSettings(settings: Record<string, unknown>): Promise<void> {
    const res = await this.api.invoke("saveSettings", settings);
    if (!res.ok) throw new Error(res.error ?? "persist saveSettings failed");
  }
}
