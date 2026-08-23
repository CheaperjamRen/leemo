import { createStore, type StoreApi } from "zustand/vanilla";
import type { LeemoEvent } from "../../bridge/contract";
import type { TimelineItem } from "./message-model";

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

/** Rebuild the disposable meter projection from the persisted conversation
 * timeline. Usage and compact items are already durable, so restart recovery
 * needs no second database table or guessed token count. */
export function deriveContextUsageFromTimelines(
  timelines: Record<string, TimelineItem[]>,
): ContextUsageState {
  let state: ContextUsageState = { byConversation: {} };
  for (const [conversationId, items] of Object.entries(timelines)) {
    for (const item of items) {
      if (item.kind === "usage") {
        state = foldContextUsage(state, { type: "usage.final", usage: item.usage }, conversationId);
      } else if (item.kind === "compact") {
        state = foldContextUsage(state, {
          type: "compact.boundary",
          trigger: item.trigger,
          preTokens: item.preTokens,
          ...(item.postTokens !== undefined ? { postTokens: item.postTokens } : {}),
        }, conversationId);
      }
    }
  }
  return state;
}
