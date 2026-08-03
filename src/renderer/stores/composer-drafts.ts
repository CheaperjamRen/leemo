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
  /** A first-turn conversation exists in the host but is deliberately not
   * active until its send acknowledgement succeeds. Keeping this association
   * makes a failed draft survive workspace, mode, and sidebar navigation. */
  assignedConversationId: string | null;
}

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
  updateDraft(scope: string, update: (draft: ComposerDraft) => ComposerDraft): void;
  setText(scope: string, text: string): void;
  assignConversation(scope: string, conversationId: string): void;
  /** Delete keeps the user's unsent text in place, but releases the id that no
   * longer exists so the next send can create a fresh conversation. */
  detachConversation(conversationId: string): void;
  /** Move removes a failed first-turn draft from its old book scope and keeps
   * it attached to the moved conversation under a scope-neutral key. */
  relocateConversation(conversationId: string): void;
}

export function createComposerDraftsStore(): StoreApi<ComposerDraftsState> {
  return createStore<ComposerDraftsState>((set) => ({
    drafts: {},
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
