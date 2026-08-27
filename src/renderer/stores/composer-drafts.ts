import { createStore, type StoreApi } from "zustand/vanilla";
import type { AttachmentRef, WorkspaceFileRef } from "../../bridge/contract";

export interface ComposerAttachment extends AttachmentRef {
  id: string;
  /** True only for a screenshot staged in Leemo's guarded temporary cache. */
  temporary?: boolean;
}

export interface ComposerWorkspaceFile extends WorkspaceFileRef {
  id: string;
}

export interface ComposerDraft {
  text: string;
  attachments: ComposerAttachment[];
  /** Current-workspace references stay relative until host validation. Optional
   * only for drafts persisted by versions before @ file references existed. */
  workspaceFiles?: ComposerWorkspaceFile[];
  submitPending: boolean;
  retryPending: boolean;
  submitError: string | null;
  pendingStageCount: number;
  /** False applies only to the next submitted turn. Omitted is the normal
   * automatic helper behavior and keeps legacy persisted drafts compatible. */
  allowSubagents?: boolean;
  /** Keeps planning separate from the approval policy. When true, the next
   * turns use the runtime's real plan mode until the user turns it off from
   * the composer + menu. */
  planMode?: boolean;
  /** A first-turn conversation exists in the host but is deliberately not
   * active until its send acknowledgement succeeds. Keeping this association
   * makes a failed draft survive workspace, mode, and sidebar navigation. */
  assignedConversationId: string | null;
}

export interface PersistedComposerDraft {
  text: string;
  attachments: ComposerAttachment[];
  workspaceFiles: ComposerWorkspaceFile[];
  allowSubagents?: boolean;
  planMode?: boolean;
  assignedConversationId: string | null;
  /** 只保存数量，不保存上一进程临时缓存的路径或 bytes。 */
  lostTemporaryAttachmentCount?: number;
}

export type PersistedComposerDrafts = Record<string, PersistedComposerDraft>;

export const EMPTY_COMPOSER_DRAFT: ComposerDraft = {
  text: "",
  attachments: [],
  workspaceFiles: [],
  submitPending: false,
  retryPending: false,
  submitError: null,
  pendingStageCount: 0,
  assignedConversationId: null,
};

export function workspaceComposerScope(workspaceId: string, bookId: string | null = null): string {
  return bookId === null
    ? `workspace:${workspaceId}`
    : `book:${encodeURIComponent(workspaceId)}:${encodeURIComponent(bookId)}`;
}

export function conversationComposerScope(conversationId: string): string {
  return `conversation:${conversationId}`;
}

export function resolveComposerScope(
  drafts: Record<string, ComposerDraft>,
  conversationId: string | null,
  workspaceId: string,
  bookId: string | null = null,
): string {
  if (!conversationId) return workspaceComposerScope(workspaceId, bookId);
  const assigned = Object.entries(drafts).find(([, draft]) =>
    draft.assignedConversationId === conversationId
  );
  return assigned?.[0] ?? conversationComposerScope(conversationId);
}

export interface ComposerDraftsState {
  drafts: Record<string, ComposerDraft>;
  hydrate(raw: unknown, validConversationIds: ReadonlySet<string>): void;
  updateDraft(scope: string, update: (draft: ComposerDraft) => ComposerDraft): void;
  setText(scope: string, text: string): void;
  /** Move a blank-conversation draft between notebook/workspace scopes before
   * its first turn. Local attachments remain valid; workspace references only
   * move when they still belong to the destination workspace. */
  moveDraft(
    sourceScope: string,
    targetScope: string,
    targetWorkspaceId: string,
  ): { removedWorkspaceFileCount: number };
  assignConversation(scope: string, conversationId: string): void;
  /** Delete keeps the user's unsent text in place, but releases the id that no
   * longer exists so the next send can create a fresh conversation. */
  detachConversation(conversationId: string): void;
  /** Move removes a failed first-turn draft from its old book scope and keeps
   * it attached to the moved conversation under a scope-neutral key. */
  relocateConversation(conversationId: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeAttachment(value: unknown): ComposerAttachment | undefined {
  if (!isRecord(value)
    || typeof value.id !== "string" || !value.id
    || typeof value.name !== "string"
    || typeof value.path !== "string" || !value.path
    || typeof value.size !== "number" || !Number.isFinite(value.size) || value.size < 0
    || (value.mimeType !== undefined && typeof value.mimeType !== "string")) return undefined;
  return {
    id: value.id,
    name: value.name,
    path: value.path,
    size: value.size,
    ...(typeof value.mimeType === "string" ? { mimeType: value.mimeType } : {}),
  };
}

function safeWorkspaceFile(value: unknown): ComposerWorkspaceFile | undefined {
  if (!isRecord(value)
    || typeof value.id !== "string" || !value.id
    || typeof value.name !== "string"
    || typeof value.workspaceId !== "string" || !value.workspaceId
    || typeof value.workspacePath !== "string" || !value.workspacePath) return undefined;
  return {
    id: value.id,
    name: value.name,
    workspaceId: value.workspaceId,
    workspacePath: value.workspacePath,
  };
}

function hasPersistableIntent(draft: {
  text: string;
  attachments: readonly unknown[];
  workspaceFiles: readonly unknown[];
  allowSubagents?: boolean;
  planMode?: boolean;
  lostTemporaryAttachmentCount?: number;
}): boolean {
  return draft.text.length > 0
    || draft.attachments.length > 0
    || draft.workspaceFiles.length > 0
    || draft.allowSubagents !== undefined
    || draft.planMode !== undefined
    || (draft.lostTemporaryAttachmentCount ?? 0) > 0;
}

export function serializeComposerDrafts(drafts: Readonly<Record<string, ComposerDraft>>): PersistedComposerDrafts {
  const persisted: PersistedComposerDrafts = {};
  for (const [scope, draft] of Object.entries(drafts)) {
    if (!scope || scope.length > 1_024) continue;
    const attachments = draft.attachments.flatMap((attachment) => {
      if (attachment.temporary) return [];
      const safe = safeAttachment(attachment);
      return safe ? [safe] : [];
    });
    const workspaceFiles = (draft.workspaceFiles ?? []).flatMap((file) => {
      const safe = safeWorkspaceFile(file);
      return safe ? [safe] : [];
    });
    const lostTemporaryAttachmentCount = draft.attachments.filter((attachment) => attachment.temporary).length
      + Math.max(0, Math.floor(draft.pendingStageCount));
    const next: PersistedComposerDraft = {
      text: draft.text,
      attachments,
      workspaceFiles,
      ...(draft.allowSubagents !== undefined ? { allowSubagents: draft.allowSubagents } : {}),
      ...(draft.planMode !== undefined ? { planMode: draft.planMode } : {}),
      assignedConversationId: draft.assignedConversationId,
      ...(lostTemporaryAttachmentCount > 0 ? { lostTemporaryAttachmentCount } : {}),
    };
    if (hasPersistableIntent(next)) persisted[scope] = next;
  }
  return persisted;
}

export function hydrateComposerDrafts(
  raw: unknown,
  validConversationIds: ReadonlySet<string>,
): Record<string, ComposerDraft> {
  if (!isRecord(raw)) return {};
  const drafts: Record<string, ComposerDraft> = {};
  for (const [scope, value] of Object.entries(raw)) {
    if (!scope || scope.length > 1_024 || !isRecord(value) || typeof value.text !== "string") continue;
    const attachments = Array.isArray(value.attachments)
      ? value.attachments.flatMap((attachment) => {
          const safe = safeAttachment(attachment);
          return safe ? [safe] : [];
        })
      : [];
    const workspaceFiles = Array.isArray(value.workspaceFiles)
      ? value.workspaceFiles.flatMap((file) => {
          const safe = safeWorkspaceFile(file);
          return safe ? [safe] : [];
        })
      : [];
    const lostTemporaryAttachmentCount = typeof value.lostTemporaryAttachmentCount === "number"
      && Number.isFinite(value.lostTemporaryAttachmentCount)
      ? Math.max(0, Math.min(20, Math.floor(value.lostTemporaryAttachmentCount)))
      : 0;
    const allowSubagents = typeof value.allowSubagents === "boolean" ? value.allowSubagents : undefined;
    const planMode = typeof value.planMode === "boolean" ? value.planMode : undefined;
    const candidateConversationId = typeof value.assignedConversationId === "string"
      ? value.assignedConversationId
      : null;
    const next = {
      text: value.text,
      attachments,
      workspaceFiles,
      submitPending: false,
      retryPending: false,
      submitError: lostTemporaryAttachmentCount > 0
        ? `有 ${lostTemporaryAttachmentCount} 张未发送的粘贴图片在重启后不可恢复，请重新粘贴或从文件添加。`
        : null,
      pendingStageCount: 0,
      ...(allowSubagents !== undefined ? { allowSubagents } : {}),
      ...(planMode !== undefined ? { planMode } : {}),
      assignedConversationId: candidateConversationId && validConversationIds.has(candidateConversationId)
        ? candidateConversationId
        : null,
    } satisfies ComposerDraft;
    if (hasPersistableIntent({ ...next, lostTemporaryAttachmentCount })) drafts[scope] = next;
  }
  return drafts;
}

export function createComposerDraftsStore(): StoreApi<ComposerDraftsState> {
  return createStore<ComposerDraftsState>((set, get) => ({
    drafts: {},
    hydrate: (raw, validConversationIds) => set({
      drafts: hydrateComposerDrafts(raw, validConversationIds),
    }),
    updateDraft: (scope, update) => set((state) => ({
      drafts: {
        ...state.drafts,
        [scope]: update(state.drafts[scope] ?? EMPTY_COMPOSER_DRAFT),
      },
    })),
    setText: (scope, text) => set((state) => ({
      drafts: {
        ...state.drafts,
        [scope]: { ...(state.drafts[scope] ?? EMPTY_COMPOSER_DRAFT), text },
      },
    })),
    moveDraft: (sourceScope, targetScope, targetWorkspaceId) => {
      if (sourceScope === targetScope) return { removedWorkspaceFileCount: 0 };
      const source = get().drafts[sourceScope];
      if (!source) return { removedWorkspaceFileCount: 0 };
      if (source.submitPending || source.retryPending || source.pendingStageCount > 0) {
        throw new Error("请等待当前发送完成后再切换本子。");
      }
      if (source.assignedConversationId) {
        throw new Error("这段草稿已经属于一个对话，请通过移动对话更改本子。");
      }
      const target = get().drafts[targetScope];
      if (target && (hasPersistableIntent({
        text: target.text,
        attachments: target.attachments,
        workspaceFiles: target.workspaceFiles ?? [],
        allowSubagents: target.allowSubagents,
        planMode: target.planMode,
      }) || target.assignedConversationId !== null
        || target.submitPending || target.retryPending || target.pendingStageCount > 0)) {
        throw new Error("目标本子里已经有一份未发送草稿，请先处理它。");
      }

      const workspaceFiles = (source.workspaceFiles ?? []).filter((file) =>
        file.workspaceId === targetWorkspaceId
      );
      const removedWorkspaceFileCount = (source.workspaceFiles?.length ?? 0) - workspaceFiles.length;
      const moved: ComposerDraft = {
        ...source,
        workspaceFiles,
        assignedConversationId: null,
        submitError: removedWorkspaceFileCount > 0
          ? `已切换本子；原工作区的 ${removedWorkspaceFileCount} 个文件引用没有带过来，请重新添加。`
          : source.submitError,
      };
      set((state) => {
        const drafts = { ...state.drafts };
        delete drafts[sourceScope];
        drafts[targetScope] = moved;
        return { drafts };
      });
      return { removedWorkspaceFileCount };
    },
    assignConversation: (scope, conversationId) => set((state) => ({
      drafts: {
        ...state.drafts,
        [scope]: {
          ...(state.drafts[scope] ?? EMPTY_COMPOSER_DRAFT),
          assignedConversationId: conversationId,
        },
      },
    })),
    detachConversation: (conversationId) => set((state) => {
      let changed = false;
      const drafts = { ...state.drafts };
      for (const [scope, draft] of Object.entries(drafts)) {
        if (draft.assignedConversationId !== conversationId) continue;
        drafts[scope] = { ...draft, assignedConversationId: null };
        changed = true;
      }
      return changed ? { drafts } : {};
    }),
    relocateConversation: (conversationId) => set((state) => {
      const assigned = Object.entries(state.drafts).find(([, draft]) =>
        draft.assignedConversationId === conversationId
      );
      if (!assigned) return {};
      const [sourceScope, draft] = assigned;
      const targetScope = conversationComposerScope(conversationId);
      const drafts = { ...state.drafts };
      delete drafts[sourceScope];
      drafts[targetScope] = { ...draft, assignedConversationId: conversationId };
      return { drafts };
    }),
  }));
}
