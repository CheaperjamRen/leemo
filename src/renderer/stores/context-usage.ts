import { createStore, type StoreApi } from "zustand/vanilla";
import type { LeemoEvent } from "../../bridge/contract";
import type { TimelineItem } from "./message-model";

export interface ConversationContextUsage {
  currentTokens: number;
  capacityTokens?: number;
  rawMaxTokens?: number;
  providerId: string;
  modelId: string;
  accuracy: "exact" | "estimated";
  updatedAt: number;
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
  now = Date.now(),
): ContextUsageState {
  const previous = prev.byConversation[conversationId];
  if (previous && now < previous.updatedAt) return prev;

  if (event.type === "context.snapshot") {
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
          providerId: event.providerId,
          modelId: event.model,
          accuracy: "exact",
          updatedAt: now,
          justCompacted: false,
        },
      },
    };
  }

  if (event.type === "context.live") {
    const sameModel = previous?.providerId === event.providerId && previous?.modelId === event.model;
    return {
      byConversation: {
        ...prev.byConversation,
        [conversationId]: {
          currentTokens: event.currentTokens,
          ...(sameModel && previous?.capacityTokens !== undefined
            ? { capacityTokens: previous.capacityTokens }
            : {}),
          ...(sameModel && previous?.rawMaxTokens !== undefined
            ? { rawMaxTokens: previous.rawMaxTokens }
            : {}),
          providerId: event.providerId,
          modelId: event.model,
          accuracy: "estimated",
          updatedAt: now,
          justCompacted: false,
        },
      },
    };
  }

  if (event.type === "usage.final") {
    const usage = event.usage;
    const contextParts = [
      usage.contextInputTokens,
      usage.contextCacheReadTokens,
      usage.contextCacheCreationTokens,
      usage.contextOutputTokens,
    ];
    if (!contextParts.some((value) => value !== undefined)) return prev;
    const currentTokens = contextParts.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const sameModel = previous?.providerId === usage.providerId && previous?.modelId === usage.modelId;
    return {
      byConversation: {
        ...prev.byConversation,
        [conversationId]: {
          currentTokens,
          ...(sameModel && previous?.capacityTokens !== undefined
            ? { capacityTokens: previous.capacityTokens }
            : {}),
          ...(sameModel && previous?.rawMaxTokens !== undefined
            ? { rawMaxTokens: previous.rawMaxTokens }
            : {}),
          providerId: usage.providerId,
          modelId: usage.modelId,
          accuracy: "estimated",
          updatedAt: now,
          justCompacted: false,
        },
      },
    };
  }

  if (event.type === "compact.boundary") {
    if (event.postTokens === undefined) {
      if (!previous) return prev;
      const byConversation = { ...prev.byConversation };
      delete byConversation[conversationId];
      return { byConversation };
    }
    const providerId = event.providerId ?? previous?.providerId;
    const modelId = event.model ?? previous?.modelId;
    if (!providerId || !modelId) {
      if (!previous) return prev;
      const byConversation = { ...prev.byConversation };
      delete byConversation[conversationId];
      return { byConversation };
    }
    return {
      byConversation: {
        ...prev.byConversation,
        [conversationId]: {
          ...previous,
          currentTokens: event.postTokens,
          providerId,
          modelId,
          accuracy: "exact",
          updatedAt: now,
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
    // 保持历史内部顺序，但最后一条绝不晚于恢复时钟；紧接 hydration 的真实
    // Date.now() 事件因此总能覆盖，不会被 5000 条历史制造的未来时间压住。
    let sequence = Math.max(0, Date.now() - items.length);
    for (const item of items) {
      if (item.kind === "context") {
        // 旧记录无法证明属于当前哪个 provider；宁可等待下一条真实读数。
        if (!item.providerId) {
          sequence += 1;
          continue;
        }
        state = foldContextUsage(state, {
          type: "context.snapshot",
          currentTokens: item.currentTokens,
          maxTokens: item.maxTokens,
          rawMaxTokens: item.rawMaxTokens,
          ...(item.autoCompactThreshold !== undefined ? { autoCompactThreshold: item.autoCompactThreshold } : {}),
          isAutoCompactEnabled: item.isAutoCompactEnabled,
          providerId: item.providerId,
          model: item.model,
        }, conversationId, sequence++);
      } else if (item.kind === "usage") {
        state = foldContextUsage(state, {
          type: "usage.final",
          usage: item.usage,
        }, conversationId, sequence++);
      } else if (item.kind === "compact") {
        state = foldContextUsage(state, {
          type: "compact.boundary",
          trigger: item.trigger,
          preTokens: item.preTokens,
          ...(item.postTokens !== undefined ? { postTokens: item.postTokens } : {}),
          ...(item.providerId !== undefined ? { providerId: item.providerId } : {}),
          ...(item.model !== undefined ? { model: item.model } : {}),
        }, conversationId, sequence++);
      }
    }
  }
  return state;
}
