import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Persistence, PersistedConversation, PersistedSnapshot } from "../../src/main/persistence/schema";
import {
  createRegisteredWorkspacePersistence,
  createWorkspaceBackedPersistence,
  createWorkspaceConversationArchive,
} from "../../src/main/persistence/workspace-persistence";
import { HOME_WORKSPACE_ID, type WorkspaceRegistry } from "../../src/main/workspace-registry";
import type { ConversationMeta } from "../../src/renderer/stores/conversations";
import type { TimelineItem } from "../../src/renderer/stores/message-model";

const roots: string[] = [];

function tempWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-workspace-persistence-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "高等数学"), { recursive: true });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const timeline: TimelineItem[] = [
  { kind: "text", id: "u0", runId: "run-1", role: "user", text: "总结第三章", streaming: false },
  { kind: "text", id: "m1", runId: "run-1", role: "momo", text: "已经整理好了", streaming: false },
];

function meta(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: "conv-1",
    title: "第三章复习",
    titleManuallyUpdated: false,
    bookId: "高等数学",
    source: "workbench",
    providerId: "deepseek",
    modelId: "deepseek-v4-flash",
    createdAt: 100,
    lastActivityAt: 200,
    unread: false,
    sessionId: "session-1",
    pinned: false,
    archived: false,
    lastOpenedAt: 200,
    ...overrides,
  } as ConversationMeta;
}

function conversation(overrides: Partial<ConversationMeta> = {}): PersistedConversation {
  return { meta: meta(overrides), timeline };
}

function emptySnapshot(conversations: PersistedConversation[] = []): PersistedSnapshot {
  return { conversations, wikiEntries: [], settings: {} };
}

function fakeIndex(initial: PersistedConversation[] = []) {
  let snapshot = emptySnapshot(initial);
  const tombstones = new Set<string>();
  const index = {
    saveConversation: vi.fn((nextMeta: ConversationMeta, nextTimeline: TimelineItem[]) => {
      snapshot = {
        ...snapshot,
        conversations: [
          { meta: nextMeta, timeline: nextTimeline },
          ...snapshot.conversations.filter((entry) => entry.meta.id !== nextMeta.id),
        ],
      };
    }),
    rebuildConversationIndex: vi.fn((entries: PersistedConversation[]) => {
      snapshot = { ...snapshot, conversations: entries.filter((entry) => !tombstones.has(entry.meta.id)) };
    }),
    moveConversation: vi.fn((_sourceWorkspaceId: string, nextMeta: ConversationMeta, nextTimeline: TimelineItem[]) => {
      if (tombstones.has(nextMeta.id)) return;
      snapshot = {
        ...snapshot,
        conversations: [
          { meta: nextMeta, timeline: nextTimeline },
          ...snapshot.conversations.filter((entry) => entry.meta.id !== nextMeta.id),
        ],
      };
    }),
    deleteConversation: vi.fn((conversationId: string) => {
      tombstones.add(conversationId);
      snapshot = {
        ...snapshot,
        conversations: snapshot.conversations.filter((entry) => entry.meta.id !== conversationId),
      };
    }),
    isConversationDeleted: vi.fn((conversationId: string) => tombstones.has(conversationId)),
    saveWikiEntry: vi.fn(),
    saveSettings: vi.fn(),
    usageSummary: vi.fn(() => ({ byProvider: [] })),
    loadAll: vi.fn(() => snapshot),
    getWhitelist: vi.fn(() => []),
    addToWhitelist: vi.fn(),
    removeFromWhitelist: vi.fn(),
    listScheduledTasks: vi.fn(() => []),
    getScheduledTask: vi.fn(() => undefined),
    saveScheduledTask: vi.fn(),
    deleteScheduledTask: vi.fn(),
    listScheduledTaskRuns: vi.fn(() => []),
    getScheduledTaskRun: vi.fn(() => undefined),
    saveScheduledTaskRun: vi.fn(),
    queueScheduledOccurrence: vi.fn(),
    claimScheduledTaskRun: vi.fn(() => undefined),
    completeScheduledTaskRun: vi.fn(),
    markStaleScheduledRunsMissed: vi.fn(),
    getLearningProfile: vi.fn(() => undefined),
    saveLearningProfile: vi.fn(),
    listLearningReviewItems: vi.fn(() => []),
    getLearningReviewItem: vi.fn(() => undefined),
    saveLearningReviewItem: vi.fn(),
    listLearningSessions: vi.fn(() => []),
    listLearningAssessmentSessions: vi.fn(() => []),
    getLearningSessionStats: vi.fn(() => ({ total: 0, hasBaseline: false })),
    saveLearningSession: vi.fn(),
  } satisfies Persistence;
  return { index, snapshot: () => snapshot };
}

function fakeRegistry(homeRoot: string, externalRoot: string, available = true): WorkspaceRegistry {
  const external = {
    id: "workspace-project",
    name: "毕业设计",
    displayPath: externalRoot,
    kind: "external" as const,
    available,
    lastOpenedAt: 1,
  };
  const home = {
    id: HOME_WORKSPACE_ID,
    name: "Leemo",
    displayPath: homeRoot,
    kind: "home" as const,
    available: true,
    lastOpenedAt: 0,
  };
  return {
    list: () => [home, external],
    resolve: (id: string) => {
      if (id === HOME_WORKSPACE_ID) return { ...home, root: homeRoot };
      if (id === external.id && available) return { ...external, root: externalRoot, available: true };
      throw new Error("找不到这个工作区，请重新选择文件夹。");
    },
    register: vi.fn(),
    touch: vi.fn(),
    forget: vi.fn(),
  } as unknown as WorkspaceRegistry;
}

describe("workspace conversation archive", () => {
  it("never treats 默认工作区 as a notebook conversation scope", () => {
    const root = tempWorkspace();
    fs.mkdirSync(path.join(root, "默认工作区"));
    const archive = createWorkspaceConversationArchive(root);

    expect(() => archive.save(conversation({ bookId: "默认工作区" }))).toThrow(/本子名不合法/);
    expect(fs.existsSync(path.join(root, "默认工作区", ".leemo"))).toBe(false);
  });

  it("stores notebook and root conversations under the owning .leemo directory", () => {
    const root = tempWorkspace();
    const archive = createWorkspaceConversationArchive(root);

    archive.save(conversation());
    archive.save(conversation({ id: "conv-root", bookId: null, title: "和 momo 聊聊" }));

    expect(fs.readdirSync(path.join(root, "高等数学", ".leemo", "conversations"))).toHaveLength(1);
    expect(fs.readdirSync(path.join(root, ".leemo", "conversations")).filter((name) => name.endsWith(".json"))).toHaveLength(1);
    expect(archive.loadAll().conversations.map((entry) => entry.meta.id).sort()).toEqual(["conv-1", "conv-root"]);
  });

  it("treats the containing folder as truth after a notebook is renamed", () => {
    const root = tempWorkspace();
    const archive = createWorkspaceConversationArchive(root);
    archive.save(conversation());
    fs.renameSync(path.join(root, "高等数学"), path.join(root, "高数冲刺"));

    const loaded = archive.loadAll();
    expect(loaded.errors).toEqual([]);
    expect(loaded.conversations[0]?.meta.bookId).toBe("高数冲刺");
  });

  it("moves a reassigned conversation instead of leaving duplicate truth files", () => {
    const root = tempWorkspace();
    fs.mkdirSync(path.join(root, "求职"));
    const archive = createWorkspaceConversationArchive(root);
    archive.save(conversation());
    const sourceDir = path.join(root, "高等数学", ".leemo", "conversations");
    const sourceFile = path.join(sourceDir, fs.readdirSync(sourceDir)[0]!);
    fs.copyFileSync(sourceFile, `${sourceFile}.bak`);
    archive.save(conversation({ bookId: "求职", lastActivityAt: 300 }));

    expect(archive.loadAll().conversations).toHaveLength(1);
    expect(archive.loadAll().conversations[0]?.meta.bookId).toBe("求职");
    expect(fs.readdirSync(sourceDir)).toEqual([]);
  });

  it("removes every portable copy of a conversation", () => {
    const root = tempWorkspace();
    fs.mkdirSync(path.join(root, "求职"));
    const archive = createWorkspaceConversationArchive(root);
    archive.save(conversation());
    archive.save(conversation({ bookId: "求职", lastActivityAt: 300, lastOpenedAt: 300 } as Partial<ConversationMeta>));

    archive.remove("conv-1");

    expect(archive.loadAll().conversations).toEqual([]);
  });

  it("reports an unreadable archive so SQLite remains the fallback", () => {
    const root = tempWorkspace();
    const archive = createWorkspaceConversationArchive(root);
    const legacy = conversation();
    archive.save(legacy);
    archive.markMigrationComplete();
    const { index } = fakeIndex([legacy]);
    const conversationDir = path.join(root, "高等数学", ".leemo", "conversations");
    const realReaddir = fs.readdirSync.bind(fs);
    const spy = vi.spyOn(fs, "readdirSync").mockImplementation(((target: fs.PathLike, options?: unknown) => {
      if (path.resolve(String(target)) === path.resolve(conversationDir)) {
        const error = new Error("access denied") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      return realReaddir(target, options as never);
    }) as typeof fs.readdirSync);
    try {
      expect(createWorkspaceBackedPersistence(index, archive).loadAll().conversations).toEqual([legacy]);
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps the previous record recoverable when replacing it fails twice", () => {
    const root = tempWorkspace();
    const archive = createWorkspaceConversationArchive(root);
    archive.save(conversation({ title: "旧标题" }));
    const realRename = fs.renameSync.bind(fs);
    let attempts = 0;
    const spy = vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("destination exists") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      if (attempts === 2) {
        const error = new Error("disk error") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      return realRename(from, to);
    }) as typeof fs.renameSync);
    try {
      expect(() => archive.save(conversation({ title: "新标题", lastActivityAt: 300 }))).toThrow(/disk error/);
    } finally {
      spy.mockRestore();
    }
    expect(archive.loadAll().conversations[0]?.meta.title).toBe("旧标题");
  });

  it("skips one corrupt record without hiding the rest", () => {
    const root = tempWorkspace();
    const archive = createWorkspaceConversationArchive(root);
    archive.save(conversation());
    fs.writeFileSync(path.join(root, "高等数学", ".leemo", "conversations", "broken.json"), "{ nope", "utf8");

    const loaded = archive.loadAll();
    expect(loaded.conversations).toHaveLength(1);
    expect(loaded.errors).toHaveLength(1);
    expect(loaded.errors[0]).toContain("broken.json");
  });

  it("treats an external workspace as one project root, never as nested notebooks", () => {
    const root = tempWorkspace();
    const archive = createWorkspaceConversationArchive(root, {
      workspaceId: "workspace-project",
      notebookScopes: false,
    });

    archive.save(conversation({ bookId: null, workspaceId: "workspace-project" }));
    expect(() => archive.save(conversation({ bookId: "高等数学", workspaceId: "workspace-project" }))).toThrow(/外部工作区/);
    expect(archive.loadAll().conversations[0]?.meta).toMatchObject({
      workspaceId: "workspace-project",
      bookId: null,
    });
    expect(fs.readdirSync(path.join(root, ".leemo", "conversations")).filter((name) => name.endsWith(".json"))).toHaveLength(1);
    expect(fs.existsSync(path.join(root, "高等数学", ".leemo", "conversations"))).toBe(false);
  });
});

describe("workspace-backed persistence", () => {
  it("migrates legacy SQLite conversations once, then rebuilds the index from workspace files", () => {
    const root = tempWorkspace();
    const archive = createWorkspaceConversationArchive(root);
    const legacy = conversation();
    const { index } = fakeIndex([legacy]);
    const persistence = createWorkspaceBackedPersistence(index, archive);

    expect(persistence.loadAll().conversations).toEqual([legacy]);
    expect(archive.migrationComplete()).toBe(true);

    // A new index on the same workspace proves the files, not the old DB, are
    // now the source of truth.
    const fresh = fakeIndex();
    const rebuilt = createWorkspaceBackedPersistence(fresh.index, archive).loadAll();
    expect(rebuilt.conversations).toEqual([legacy]);
    expect(fresh.index.rebuildConversationIndex).toHaveBeenCalledWith([legacy]);
  });

  it("does not resurrect a deleted workspace record from a stale SQLite index after migration", () => {
    const root = tempWorkspace();
    const archive = createWorkspaceConversationArchive(root);
    const legacy = conversation();
    const first = fakeIndex([legacy]);
    createWorkspaceBackedPersistence(first.index, archive).loadAll();
    const record = fs.readdirSync(path.join(root, "高等数学", ".leemo", "conversations"))[0]!;
    fs.rmSync(path.join(root, "高等数学", ".leemo", "conversations", record));

    const stale = fakeIndex([legacy]);
    const loaded = createWorkspaceBackedPersistence(stale.index, archive).loadAll();
    expect(loaded.conversations).toEqual([]);
    expect(stale.index.rebuildConversationIndex).toHaveBeenCalledWith([]);
  });

  it("writes the portable archive before updating the disposable SQLite index", () => {
    const root = tempWorkspace();
    const archive = createWorkspaceConversationArchive(root);
    const { index } = fakeIndex();
    const save = vi.spyOn(archive, "save");
    index.saveConversation.mockImplementation(() => {
      expect(save).toHaveBeenCalled();
    });
    const persistence = createWorkspaceBackedPersistence(index, archive);

    persistence.saveConversation(meta(), timeline);
    expect(index.saveConversation).toHaveBeenCalledWith(meta(), timeline);
    expect(archive.loadAll().conversations).toEqual([conversation()]);
  });
});

describe("registered workspace persistence", () => {
  it("writes an external conversation into that project's .leemo directory", () => {
    const homeRoot = tempWorkspace();
    const externalRoot = tempWorkspace();
    const { index } = fakeIndex();
    const persistence = createRegisteredWorkspacePersistence(
      index,
      fakeRegistry(homeRoot, externalRoot),
    );
    const external = meta({
      id: "conv-project",
      bookId: null,
      workspaceId: "workspace-project",
    });

    persistence.saveConversation(external, timeline);

    expect(fs.readdirSync(path.join(externalRoot, ".leemo", "conversations")).filter((name) => name.endsWith(".json"))).toHaveLength(1);
    expect(fs.existsSync(path.join(homeRoot, ".leemo", "conversations"))).toBe(false);
    expect(persistence.loadAll().conversations[0]?.meta.workspaceId).toBe("workspace-project");
  });

  it("keeps indexed history recoverable while an external folder is unavailable", () => {
    const homeRoot = tempWorkspace();
    const externalRoot = tempWorkspace();
    const indexed = conversation({
      id: "conv-project",
      bookId: null,
      workspaceId: "workspace-project",
    });
    const { index } = fakeIndex([indexed]);
    const persistence = createRegisteredWorkspacePersistence(
      index,
      fakeRegistry(homeRoot, externalRoot, false),
    );

    expect(persistence.loadAll().conversations).toEqual([indexed]);
  });

  it("moves a conversation within home and across home/external without leaving stale truth", () => {
    const homeRoot = tempWorkspace();
    fs.mkdirSync(path.join(homeRoot, "求职"));
    const externalRoot = tempWorkspace();
    const { index } = fakeIndex();
    const registry = fakeRegistry(homeRoot, externalRoot);
    const persistence = createRegisteredWorkspacePersistence(index, registry);
    persistence.saveConversation(meta(), timeline);

    const inHomeTarget = meta({ bookId: "求职", lastActivityAt: 300, lastOpenedAt: 300 } as Partial<ConversationMeta>);
    persistence.moveConversation(HOME_WORKSPACE_ID, inHomeTarget, timeline);
    expect(createWorkspaceConversationArchive(homeRoot).loadAll().conversations).toEqual([
      { meta: inHomeTarget, timeline },
    ]);

    const external = meta({
      bookId: null,
      workspaceId: "workspace-project",
      lastActivityAt: 400,
      lastOpenedAt: 400,
    } as Partial<ConversationMeta>);
    persistence.moveConversation(HOME_WORKSPACE_ID, external, timeline);
    expect(createWorkspaceConversationArchive(homeRoot).loadAll().conversations).toEqual([]);
    expect(createWorkspaceConversationArchive(externalRoot, {
      workspaceId: "workspace-project",
      notebookScopes: false,
    }).loadAll().conversations).toEqual([{ meta: external, timeline }]);
    expect(persistence.loadAll().conversations).toEqual([{ meta: external, timeline }]);
  });

  it("keeps an offline external deletion tombstoned when the folder returns", () => {
    const homeRoot = tempWorkspace();
    const externalRoot = tempWorkspace();
    const fixture = fakeIndex();
    const external = conversation({
      id: "conv-project",
      bookId: null,
      workspaceId: "workspace-project",
    });
    const online = createRegisteredWorkspacePersistence(fixture.index, fakeRegistry(homeRoot, externalRoot));
    online.saveConversation(external.meta, external.timeline);

    const offline = createRegisteredWorkspacePersistence(fixture.index, fakeRegistry(homeRoot, externalRoot, false));
    offline.deleteConversation(external.meta.id);
    expect(fixture.index.isConversationDeleted(external.meta.id)).toBe(true);

    const returned = createRegisteredWorkspacePersistence(fixture.index, fakeRegistry(homeRoot, externalRoot));
    expect(returned.loadAll().conversations).toEqual([]);
  });
});
