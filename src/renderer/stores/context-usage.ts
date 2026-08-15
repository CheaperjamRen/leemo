import { createStore, type StoreApi } from "zustand/vanilla";
import type { LeemoEvent } from "../../bridge/contract";

export const CONTEXT_COMPACT_THRESHOLD = 21_000;

export interface ConversationContextUsage {
  currentTokens: number;
  justCompacted: boolean;
}

export interface ContextUsageState {
  byConversation: Record<string, ConversationContextUsage>;
}

/** Purely fold prompt-scale usage/compaction events for one routed conversation. */
export function foldContextUsage(
  prev: ContextUsageState,
  event: LeemoEvent,
  conversationId: string,
): ContextUsageState {
  if (event.type === "usage.final") {
    const current = (event.usage.contextInputTokens ?? event.usage.inputTokens)
      + (event.usage.contextCacheReadTokens ?? event.usage.cacheReadTokens)
      + (event.usage.contextCacheCreationTokens ?? event.usage.cacheCreationTokens);
    const previous = prev.byConversation[conversationId];
    return {
      byConversation: {
        ...prev.byConversation,
        [conversationId]: { currentTokens: current, justCompacted: previous?.justCompacted ?? false },
      },
    };
  }

  if (event.type === "compact.boundary") {
    const current = event.postTokens ?? event.preTokens;
    return {
      byConversation: {
        ...prev.byConversation,
        [conversationId]: { currentTokens: current, justCompacted: true },
      },
    };
  }

  return prev;
}

export function createContextUsageStore(): StoreApi<ContextUsageState> {
  return createStore<ContextUsageState>(() => ({ byConversation: {} }));
}
