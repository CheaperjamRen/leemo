import { describe, it, expect, vi } from "vitest";
import { IpcPersistenceClient } from "./ipc-persistence-client";
import type { ConversationMeta } from "../stores/conversations";
import type { TimelineItem } from "../stores/message-model";
import type { WikiEntry } from "../stores/wiki-entries";
import type { PersistedGlobalOverviewState } from "../../bridge/global-pending-overview";

const META = { id: "c1" } as unknown as ConversationMeta;

describe("IpcPersistenceClient", () => {
  it("loadAll unwraps the response", async () => {
    const api = { invoke: vi.fn(async () => ({ ok: true, response: { conversations: [{ meta: META, timeline: [] }], wikiEntries: [] } })) };
    const c = new IpcPersistenceClient(api);
    const snap = await c.loadAll();
    expect(snap.conversations).toHaveLength(1);
    expect(api.invoke).toHaveBeenCalledWith("loadAll", undefined);
  });

  it("loadAll defaults to an empty snapshot when main returns no payload", async () => {
    const api = { invoke: vi.fn(async () => ({ ok: true })) };
    const c = new IpcPersistenceClient(api);
    expect(await c.loadAll()).toEqual({ conversations: [], wikiEntries: [], settings: {} });
  });

  it("throws on an error frame", async () => {
    const api = { invoke: vi.fn(async () => ({ ok: false, error: "disk full" })) };
    const c = new IpcPersistenceClient(api);
    await expect(c.loadAll()).rejects.toThrow("disk full");
    await expect(c.saveConversation(META, [])).rejects.toThrow("disk full");
  });

  it("saveConversation / saveWikiEntry send the right op + payload", async () => {
    const api = { invoke: vi.fn(async () => ({ ok: true })) };
    const c = new IpcPersistenceClient(api);
    const tl: TimelineItem[] = [{ kind: "text", id: "u0", runId: "r1", role: "user", text: "hi", streaming: false }];
    await c.saveConversation(META, tl);
    expect(api.invoke).toHaveBeenCalledWith("saveConversation", { meta: META, timeline: tl });
    await c.saveRelationshipChapter(META, []);
    expect(api.invoke).toHaveBeenCalledWith("saveRelationshipChapter", { meta: META, timeline: [] });

    const entry: WikiEntry = { id: "w1", filePath: "f", quotedText: "q", turns: [], createdAt: 1 };
    await c.saveWikiEntry(entry);
    expect(api.invoke).toHaveBeenCalledWith("saveWikiEntry", entry);
  });

  it("awaits explicit move and delete operations with stable payloads", async () => {
    const api = { invoke: vi.fn(async () => ({ ok: true })) };
    const c = new IpcPersistenceClient(api);
    const tl: TimelineItem[] = [{ kind: "text", id: "u0", runId: "r1", role: "user", text: "hi", streaming: false }];

    await c.moveConversation("leemo-home", META, tl);
    await c.deleteConversation("c1");

    expect(api.invoke).toHaveBeenNthCalledWith(1, "moveConversation", {
      sourceWorkspaceId: "leemo-home",
      meta: META,
      timeline: tl,
    });
    expect(api.invoke).toHaveBeenNthCalledWith(2, "deleteConversation", { conversationId: "c1" });
  });

  it("saves the global pending overview through its dedicated operation", async () => {
    const api = { invoke: vi.fn(async () => ({ ok: true })) };
    const c = new IpcPersistenceClient(api);
    const state: PersistedGlobalOverviewState = { version: 1, snapshot: null, overrides: [] };

    await c.saveGlobalPendingOverview(state);

    expect(api.invoke).toHaveBeenCalledWith("saveGlobalPendingOverview", state);
  });

  it("通过独立操作保存 composer 草稿，不混入设置", async () => {
    const api = { invoke: vi.fn(async () => ({ ok: true })) };
    const c = new IpcPersistenceClient(api);
    const drafts = { "workspace:leemo-home": { text: "未发送", attachments: [], workspaceFiles: [], assignedConversationId: null } };

    await c.saveComposerDrafts(drafts);

    expect(api.invoke).toHaveBeenCalledWith("saveComposerDrafts", drafts);
  });
});
