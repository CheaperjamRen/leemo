import { createStore, type StoreApi } from "zustand/vanilla";
import type { LeemoEvent } from "../../bridge/contract";
import type { TimelineItem } from "./message-model";

export interface ConversationContextUsage {
  currentTokens: number;
  capacityTokens?: number;
  rawMaxTokens?: number;
  source?: "sdk";
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
  if (event.type === "context.snapshot") {
    const previous = prev.byConversation[conversationId];
    const capacityTokens = event.isAutoCompactEnabled && event.autoCompactThreshold !== undefined
      ? event.autoCompactThreshold
      : event.maxTokens;
    return {
      byConversation: {
        ...prev.byConversation,
        [conversationId]: {
          currentTokens: event.currentTokens,
          capacityTokens,
          rawMaxTokens: event.rawMaxTokens,
          source: "sdk",
          justCompacted: previous?.justCompacted ?? false,
        },
      },
    };
  }

  if (event.type === "compact.boundary") {
    const current = event.postTokens ?? event.preTokens;
    const previous = prev.byConversation[conversationId];
    return {
      byConversation: {
        ...prev.byConversation,
        [conversationId]: {
          ...previous,
          currentTokens: current,
          justCompacted: true,
        },
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
      if (item.kind === "context") {
        state = foldContextUsage(state, {
          type: "context.snapshot",
          currentTokens: item.currentTokens,
          maxTokens: item.maxTokens,
          rawMaxTokens: item.rawMaxTokens,
          ...(item.autoCompactThreshold !== undefined ? { autoCompactThreshold: item.autoCompactThreshold } : {}),
          isAutoCompactEnabled: item.isAutoCompactEnabled,
          model: item.model,
        }, conversationId);
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
