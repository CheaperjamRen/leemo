import fs from "node:fs";
import path from "node:path";
import type { ConversationMeta } from "../../renderer/stores/conversations";
import type { TimelineItem } from "../../renderer/stores/message-model";
import type { Persistence, PersistedConversation, PersistedSnapshot } from "./schema";
import { DEFAULT_WORKSPACE_DIR, LEGACY_INBOX_DIR } from "../../host/workspace";
import { HOME_WORKSPACE_ID, type WorkspaceRegistry } from "../workspace-registry";

const ARCHIVE_VERSION = 1;
const INTERNAL_DIR = ".leemo";
const CONVERSATIONS_DIR = "conversations";
const MIGRATION_MARKER = ".workspace-source-v1";
const RESERVED_ROOT_DIRECTORIES = new Set([DEFAULT_WORKSPACE_DIR, LEGACY_INBOX_DIR, "memory"]);

interface ArchiveRecord {
  version: 1;
  meta: ConversationMeta;
  timeline: TimelineItem[];
}

export interface ArchiveLoadResult {
  conversations: PersistedConversation[];
  errors: string[];
}

export interface WorkspaceConversationArchive {
  save(conversation: PersistedConversation): void;
  remove(conversationId: string): void;
  loadAll(): ArchiveLoadResult;
  migrationComplete(): boolean;
  markMigrationComplete(): void;
}

export interface WorkspaceConversationArchiveOptions {
  /** Location is authoritative; copied project folders receive their new id. */
  workspaceId?: string;
  /** Leemo home has notebook sub-scopes. External projects are one root. */
  notebookScopes?: boolean;
}

function conversationFileName(id: string): string {
  if (typeof id !== "string" || id.length === 0 || id.length > 160) {
    throw new Error("对话 id 不合法，无法写入本子");
  }
  return `${Buffer.from(id, "utf8").toString("base64url")}.json`;
}

function directNotebookPath(workspaceRoot: string, bookId: string): string {
  if (
    bookId.length === 0
    || bookId === "."
    || bookId === ".."
    || bookId.includes("/")
    || bookId.includes("\\")
    || bookId.includes("\0")
    || bookId.trim() !== bookId
    || bookId.length > 80
    || RESERVED_ROOT_DIRECTORIES.has(bookId)
    || /[<>:"|?*]/.test(bookId)
    || /[\u0000-\u001f]/.test(bookId)
  ) {
    throw new Error(`本子名不合法：${bookId}`);
  }
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolved = path.resolve(resolvedRoot, bookId);
  if (path.dirname(resolved) !== resolvedRoot) throw new Error(`本子越出了工作区：${bookId}`);
  return resolved;
}

function isConversationMeta(value: unknown): value is ConversationMeta {
  if (!value || typeof value !== "object") return false;
  const meta = value as Record<string, unknown>;
  return (
    typeof meta.id === "string"
    && typeof meta.title === "string"
    && typeof meta.titleManuallyUpdated === "boolean"
    && (meta.bookId === null || typeof meta.bookId === "string")
    && (meta.source === "buddy" || meta.source === "workbench")
    && typeof meta.providerId === "string"
    && typeof meta.modelId === "string"
    && typeof meta.createdAt === "number"
    && Number.isFinite(meta.createdAt)
    && typeof meta.lastActivityAt === "number"
    && Number.isFinite(meta.lastActivityAt)
    && typeof meta.unread === "boolean"
    && (meta.workspaceId === undefined || typeof meta.workspaceId === "string")
    && (meta.sessionId === undefined || meta.sessionId === null || typeof meta.sessionId === "string")
  );
}

function isTimeline(value: unknown): value is TimelineItem[] {
  return Array.isArray(value) && value.every(
    (item) => item !== null && typeof item === "object" && typeof (item as { kind?: unknown }).kind === "string",
  );
}

function writeAtomic(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  const backup = `${file}.bak`;
  fs.writeFileSync(temporary, contents, "utf8");
  try {
    fs.renameSync(temporary, file);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if ((code !== "EEXIST" && code !== "EPERM") || !fs.existsSync(file)) {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
    // Windows cannot rename over an existing destination. Preserve a complete
    // old record before unlinking it; if replacement fails (or the process dies
    // in the gap), loadAll can recover the .bak rather than treating the
    // conversation as intentionally deleted.
    fs.copyFileSync(file, backup);
    try {
      fs.rmSync(file, { force: true });
      fs.renameSync(temporary, file);
      fs.rmSync(backup, { force: true });
    } catch (replacementError) {
      if (!fs.existsSync(file) && fs.existsSync(backup)) {
        try {
          fs.copyFileSync(backup, file);
        } catch {
          // Keep the backup as the recoverable source. loadAll reads it when
          // restoring the canonical file is temporarily impossible.
        }
      }
      if (fs.existsSync(file)) fs.rmSync(temporary, { force: true });
      throw replacementError;
    }
  }
}

function lifecycleMeta(meta: ConversationMeta): ConversationMeta {
  const candidate = meta as ConversationMeta & {
    pinned?: boolean;
    archived?: boolean;
    lastOpenedAt?: number;
  };
  return {
    ...meta,
    pinned: candidate.pinned ?? false,
    archived: candidate.archived ?? false,
    lastOpenedAt: candidate.lastOpenedAt ?? meta.lastActivityAt,
  } as ConversationMeta;
}

/**
 * Portable source of truth for conversation history.
 *
 * Root-persona conversations live in `<workspace>/.leemo/conversations`;
 * notebook conversations live in `<workspace>/<book>/.leemo/conversations`.
 * The enclosing directory wins over the serialized bookId so renaming or
 * copying a notebook in Explorer keeps its history attached to that folder.
 */
export function createWorkspaceConversationArchive(
  workspaceRoot: string,
  options: WorkspaceConversationArchiveOptions = {},
): WorkspaceConversationArchive {
  const root = path.resolve(workspaceRoot);
  const rootArchive = path.join(root, INTERNAL_DIR, CONVERSATIONS_DIR);
  const notebookScopes = options.notebookScopes ?? true;

  const locations = (): { dir: string; bookId: string | null }[] => {
    const out = [{ dir: rootArchive, bookId: null as string | null }];
    if (!notebookScopes || !fs.existsSync(root)) return out;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (
        !entry.isDirectory()
        || entry.name.startsWith(".")
        || RESERVED_ROOT_DIRECTORIES.has(entry.name)
      ) continue;
      const dir = path.join(root, entry.name, INTERNAL_DIR, CONVERSATIONS_DIR);
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) out.push({ dir, bookId: entry.name });
    }
    return out;
  };

  const targetDirectory = (bookId: string | null): string => {
    if (bookId === null) return rootArchive;
    if (!notebookScopes) throw new Error("外部工作区不使用本子目录");
    const notebook = directNotebookPath(root, bookId);
    if (!fs.existsSync(notebook) || !fs.statSync(notebook).isDirectory()) {
      throw new Error(`没有这个本子：${bookId}`);
    }
    return path.join(notebook, INTERNAL_DIR, CONVERSATIONS_DIR);
  };

  return {
    save(conversation) {
      const fileName = conversationFileName(conversation.meta.id);
      const targetDir = targetDirectory(conversation.meta.bookId);
      const target = path.join(targetDir, fileName);
      const record: ArchiveRecord = {
        version: ARCHIVE_VERSION,
        meta: {
          ...lifecycleMeta(conversation.meta),
          ...(!notebookScopes ? { bookId: null } : {}),
          ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
        },
        timeline: conversation.timeline,
      };
      // New truth is durable before stale copies are removed. A crash can leave
      // a duplicate, but never leave no copy; loadAll resolves duplicates by
      // lastActivityAt.
      writeAtomic(target, `${JSON.stringify(record, null, 2)}\n`);
      for (const location of locations()) {
        const candidate = path.join(location.dir, fileName);
        if (path.resolve(candidate) !== path.resolve(target)) {
          fs.rmSync(candidate, { force: true });
          fs.rmSync(`${candidate}.bak`, { force: true });
        }
      }
    },

    remove(conversationId) {
      const fileName = conversationFileName(conversationId);
      for (const location of locations()) {
        const file = path.join(location.dir, fileName);
        fs.rmSync(file, { force: true });
        fs.rmSync(`${file}.bak`, { force: true });
      }
    },

    loadAll() {
      const byId = new Map<string, PersistedConversation>();
      const errors: string[] = [];
      let archiveLocations: { dir: string; bookId: string | null }[];
      try {
        archiveLocations = locations();
      } catch (error: unknown) {
        errors.push(`${root}: ${error instanceof Error ? error.message : String(error)}`);
        return { conversations: [], errors };
      }
      for (const location of archiveLocations) {
        let files: string[];
        try {
          const entries = fs.readdirSync(location.dir);
          files = entries.filter((name) => name.endsWith(".json"));
          for (const backupName of entries.filter((name) => name.endsWith(".json.bak"))) {
            const canonicalName = backupName.slice(0, -4);
            const canonical = path.join(location.dir, canonicalName);
            if (fs.existsSync(canonical)) continue;
            const backup = path.join(location.dir, backupName);
            try {
              fs.renameSync(backup, canonical);
              files.push(canonicalName);
            } catch {
              // The backup is valid JSON and remains a readable source even if
              // Windows still refuses the repair rename.
              files.push(backupName);
            }
          }
        } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          errors.push(`${location.dir}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        for (const name of files) {
          const file = path.join(location.dir, name);
          try {
            const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ArchiveRecord>;
            if (parsed.version !== ARCHIVE_VERSION || !isConversationMeta(parsed.meta) || !isTimeline(parsed.timeline)) {
              throw new Error("记录结构不完整");
            }
            const next: PersistedConversation = {
              meta: {
                ...lifecycleMeta(parsed.meta),
                bookId: notebookScopes ? location.bookId : null,
                ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
              },
              timeline: parsed.timeline,
            };
            const previous = byId.get(next.meta.id);
            if (!previous || next.meta.lastActivityAt >= previous.meta.lastActivityAt) byId.set(next.meta.id, next);
          } catch (error: unknown) {
            errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      const conversations = [...byId.values()].sort(
        (left, right) => right.meta.lastActivityAt - left.meta.lastActivityAt,
      );
      return { conversations, errors };
    },

    migrationComplete() {
      return fs.existsSync(path.join(rootArchive, MIGRATION_MARKER));
    },

    markMigrationComplete() {
      writeAtomic(path.join(rootArchive, MIGRATION_MARKER), `${ARCHIVE_VERSION}\n`);
    },
  };
}

/**
 * Routes portable conversation history to the workspace that owns it while a
 * single SQLite database remains the disposable cross-workspace query index.
 */
export function createRegisteredWorkspacePersistence(
  index: Persistence,
  registry: WorkspaceRegistry,
  reportError: (message: string) => void = (message) => console.error(message),
): Persistence {
  const archiveFor = (workspaceId: string): WorkspaceConversationArchive => {
    const workspace = registry.resolve(workspaceId);
    return createWorkspaceConversationArchive(workspace.root, {
      notebookScopes: workspace.kind === "home",
      ...(workspace.kind === "external" ? { workspaceId: workspace.id } : {}),
    });
  };

  const workspaceIdOf = (conversation: PersistedConversation): string =>
    conversation.meta.workspaceId ?? HOME_WORKSPACE_ID;

  return {
    saveConversation(meta, timeline) {
      if (index.isConversationDeleted(meta.id)) return;
      const workspaceId = meta.workspaceId ?? HOME_WORKSPACE_ID;
      archiveFor(workspaceId).save({ meta, timeline });
      index.saveConversation(meta, timeline);
    },

    moveConversation(sourceWorkspaceId, meta, timeline) {
      if (index.isConversationDeleted(meta.id)) return;
      const targetWorkspaceId = meta.workspaceId ?? HOME_WORKSPACE_ID;
      archiveFor(targetWorkspaceId).save({ meta, timeline });
      index.moveConversation(sourceWorkspaceId, meta, timeline);
      if (sourceWorkspaceId !== targetWorkspaceId) {
        try {
          archiveFor(sourceWorkspaceId).remove(meta.id);
        } catch (error: unknown) {
          // The target and index are already durable. A stale source duplicate
          // is preferable to rolling the move back; the newer target metadata
          // wins on load and a later delete/move can clean it.
          reportError(`[leemo:persist] could not clean moved conversation ${meta.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },

    deleteConversation(conversationId) {
      // Tombstone first. An unavailable external drive may keep a stale JSON,
      // but it can never become visible again when the drive returns.
      index.deleteConversation(conversationId);
      for (const listed of registry.list()) {
        if (!listed.available) continue;
        try {
          archiveFor(listed.id).remove(conversationId);
        } catch (error: unknown) {
          reportError(`[leemo:persist] could not clean deleted conversation ${conversationId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },

    isConversationDeleted(conversationId) {
      return index.isConversationDeleted(conversationId);
    },

    rebuildConversationIndex(conversations) {
      index.rebuildConversationIndex(conversations);
    },

    saveWikiEntry(entry) {
      index.saveWikiEntry(entry);
    },

    saveSettings(settings) {
      index.saveSettings(settings);
    },

    loadGlobalOverviewState() {
      return index.loadGlobalOverviewState();
    },

    saveGlobalOverviewState(state) {
      index.saveGlobalOverviewState(state);
    },

    recordStandaloneUsage(event) {
      index.recordStandaloneUsage(event);
    },

    usageSummary(query, now) {
      return index.usageSummary(query, now);
    },

    listScheduledTasks: () => index.listScheduledTasks(),
    getScheduledTask: (id) => index.getScheduledTask(id),
    saveScheduledTask: (task) => index.saveScheduledTask(task),
    deleteScheduledTask: (id) => index.deleteScheduledTask(id),
    listScheduledTaskRuns: (taskId, limit) => index.listScheduledTaskRuns(taskId, limit),
    getScheduledTaskRun: (id) => index.getScheduledTaskRun(id),
    saveScheduledTaskRun: (run) => index.saveScheduledTaskRun(run),
    queueScheduledOccurrence: (task, run) => index.queueScheduledOccurrence(task, run),
    claimScheduledTaskRun: (id, startedAt) => index.claimScheduledTaskRun(id, startedAt),
    completeScheduledTaskRun: (run) => index.completeScheduledTaskRun(run),
    markStaleScheduledRunsMissed: (now) => index.markStaleScheduledRunsMissed(now),
    getLearningProfile: () => index.getLearningProfile(),
    saveLearningProfile: (profile) => index.saveLearningProfile(profile),
    listLearningReviewItems: () => index.listLearningReviewItems(),
    getLearningReviewItem: (id) => index.getLearningReviewItem(id),
    saveLearningReviewItem: (item) => index.saveLearningReviewItem(item),
    listLearningSessions: (limit) => index.listLearningSessions(limit),
    listLearningAssessmentSessions: () => index.listLearningAssessmentSessions(),
    getLearningSessionStats: () => index.getLearningSessionStats(),
    saveLearningSession: (session) => index.saveLearningSession(session),

    loadAll(): PersistedSnapshot {
      const indexed = index.loadAll();
      const homeArchive = archiveFor(HOME_WORKSPACE_ID);

      // Existing releases put every conversation in the home archive. Only
      // legacy/home rows are migrated here; external rows are written through
      // their own archive from their first save in this release.
      if (!homeArchive.migrationComplete()) {
        for (const entry of indexed.conversations.filter((conversation) =>
          workspaceIdOf(conversation) === HOME_WORKSPACE_ID
          && !index.isConversationDeleted(conversation.meta.id)
        )) {
          try {
            homeArchive.save(entry);
          } catch (error: unknown) {
            if (entry.meta.bookId === null) throw error;
            reportError(`[leemo:persist] missing notebook for ${entry.meta.id}; moved conversation to workspace root`);
            homeArchive.save({ ...entry, meta: { ...entry.meta, bookId: null } });
          }
        }
        homeArchive.markMigrationComplete();
      }

      const byId = new Map<string, PersistedConversation>();
      const cleanAuthoritative = new Set<string>();
      let archiveHadErrors = false;

      for (const listed of registry.list()) {
        if (!listed.available) continue;
        let archive: WorkspaceConversationArchive;
        try {
          archive = archiveFor(listed.id);
        } catch (error: unknown) {
          reportError(`[leemo:persist] unavailable workspace ${listed.id}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        const portable = archive.loadAll();
        if (portable.errors.length === 0) cleanAuthoritative.add(listed.id);
        else archiveHadErrors = true;
        for (const error of portable.errors) {
          reportError(`[leemo:persist] skipped corrupt workspace conversation: ${error}`);
        }
        for (const conversation of portable.conversations) {
          if (index.isConversationDeleted(conversation.meta.id)) continue;
          const previous = byId.get(conversation.meta.id);
          if (!previous || conversation.meta.lastActivityAt >= previous.meta.lastActivityAt) {
            byId.set(conversation.meta.id, conversation);
          }
        }
      }

      // A clean home archive remains source-of-truth, including intentional
      // deletion. External projects retain their SQLite fallback so removing a
      // recent entry or temporarily unplugging a drive never loses history.
      for (const conversation of indexed.conversations) {
        if (index.isConversationDeleted(conversation.meta.id)) continue;
        const workspaceId = workspaceIdOf(conversation);
        const previous = byId.get(conversation.meta.id);
        if (previous) {
          if (workspaceId !== HOME_WORKSPACE_ID && conversation.meta.lastActivityAt > previous.meta.lastActivityAt) {
            byId.set(conversation.meta.id, conversation);
          }
          continue;
        }
        if (workspaceId === HOME_WORKSPACE_ID && cleanAuthoritative.has(HOME_WORKSPACE_ID)) continue;
        byId.set(conversation.meta.id, conversation);
      }

      const conversations = [...byId.values()].sort(
        (left, right) => right.meta.lastActivityAt - left.meta.lastActivityAt,
      );
      if (!archiveHadErrors) index.rebuildConversationIndex(conversations);
      return { ...indexed, conversations };
    },

    getWhitelist() {
      return index.getWhitelist();
    },

    addToWhitelist(entry) {
      return index.addToWhitelist(entry);
    },

    removeFromWhitelist(entry) {
      return index.removeFromWhitelist(entry);
    },
  };
}

/** Keep SQLite as a disposable query index while workspace files own history. */
export function createWorkspaceBackedPersistence(
  index: Persistence,
  archive: WorkspaceConversationArchive,
  reportError: (message: string) => void = (message) => console.error(message),
): Persistence {
  return {
    saveConversation(meta, timeline) {
      if (index.isConversationDeleted(meta.id)) return;
      archive.save({ meta, timeline });
      index.saveConversation(meta, timeline);
    },

    moveConversation(sourceWorkspaceId, meta, timeline) {
      if (index.isConversationDeleted(meta.id)) return;
      archive.save({ meta, timeline });
      index.moveConversation(sourceWorkspaceId, meta, timeline);
    },

    deleteConversation(conversationId) {
      index.deleteConversation(conversationId);
      try {
        archive.remove(conversationId);
      } catch (error: unknown) {
        reportError(`[leemo:persist] could not clean deleted conversation ${conversationId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    isConversationDeleted(conversationId) {
      return index.isConversationDeleted(conversationId);
    },

    rebuildConversationIndex(conversations) {
      index.rebuildConversationIndex(conversations);
    },

    saveWikiEntry(entry) {
      index.saveWikiEntry(entry);
    },

    saveSettings(settings) {
      index.saveSettings(settings);
    },

    loadGlobalOverviewState() {
      return index.loadGlobalOverviewState();
    },

    saveGlobalOverviewState(state) {
      index.saveGlobalOverviewState(state);
    },

    recordStandaloneUsage(event) {
      index.recordStandaloneUsage(event);
    },

    usageSummary(query, now) {
      return index.usageSummary(query, now);
    },

    listScheduledTasks: () => index.listScheduledTasks(),
    getScheduledTask: (id) => index.getScheduledTask(id),
    saveScheduledTask: (task) => index.saveScheduledTask(task),
    deleteScheduledTask: (id) => index.deleteScheduledTask(id),
    listScheduledTaskRuns: (taskId, limit) => index.listScheduledTaskRuns(taskId, limit),
    getScheduledTaskRun: (id) => index.getScheduledTaskRun(id),
    saveScheduledTaskRun: (run) => index.saveScheduledTaskRun(run),
    queueScheduledOccurrence: (task, run) => index.queueScheduledOccurrence(task, run),
    claimScheduledTaskRun: (id, startedAt) => index.claimScheduledTaskRun(id, startedAt),
    completeScheduledTaskRun: (run) => index.completeScheduledTaskRun(run),
    markStaleScheduledRunsMissed: (now) => index.markStaleScheduledRunsMissed(now),
    getLearningProfile: () => index.getLearningProfile(),
    saveLearningProfile: (profile) => index.saveLearningProfile(profile),
    listLearningReviewItems: () => index.listLearningReviewItems(),
    getLearningReviewItem: (id) => index.getLearningReviewItem(id),
    saveLearningReviewItem: (item) => index.saveLearningReviewItem(item),
    listLearningSessions: (limit) => index.listLearningSessions(limit),
    listLearningAssessmentSessions: () => index.listLearningAssessmentSessions(),
    getLearningSessionStats: () => index.getLearningSessionStats(),
    saveLearningSession: (session) => index.saveLearningSession(session),

    loadAll(): PersistedSnapshot {
      const indexed = index.loadAll();
      if (!archive.migrationComplete()) {
        for (const entry of indexed.conversations.filter((candidate) => !index.isConversationDeleted(candidate.meta.id))) {
          try {
            archive.save(entry);
          } catch (error: unknown) {
            // A legacy conversation can refer to a notebook deleted outside
            // Leemo. Preserve it at the root instead of losing all migration.
            if (entry.meta.bookId === null) throw error;
            reportError(`[leemo:persist] missing notebook for ${entry.meta.id}; moved conversation to workspace root`);
            archive.save({ ...entry, meta: { ...entry.meta, bookId: null } });
          }
        }
        archive.markMigrationComplete();
      }

      const portable = archive.loadAll();
      for (const error of portable.errors) reportError(`[leemo:persist] skipped corrupt workspace conversation: ${error}`);
      // Do not destructively rebuild around an unreadable record. Valid files
      // still hydrate; the previous index stays available for recovery.
      const conversations = portable.conversations.filter((entry) => !index.isConversationDeleted(entry.meta.id));
      if (portable.errors.length === 0) index.rebuildConversationIndex(conversations);
      return {
        ...indexed,
        conversations: portable.errors.length === 0
          ? conversations
          : indexed.conversations.filter((entry) => !index.isConversationDeleted(entry.meta.id)),
      };
    },

    getWhitelist() {
      return index.getWhitelist();
    },

    addToWhitelist(entry) {
      return index.addToWhitelist(entry);
    },

    removeFromWhitelist(entry) {
      return index.removeFromWhitelist(entry);
    },
  };
}
