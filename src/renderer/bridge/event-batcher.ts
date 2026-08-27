import type { BridgeEventEnvelope } from "../../bridge/contract";

export type EventBatchSchedule = (flush: () => void) => () => void;

export interface BridgeEventBatcher {
  push(envelope: BridgeEventEnvelope): void;
  flush(): void;
  dispose(): void;
}

function isDelta(envelope: BridgeEventEnvelope): envelope is BridgeEventEnvelope & {
  event: { type: "text.delta" | "thinking.delta"; text: string };
} {
  return envelope.event.type === "text.delta" || envelope.event.type === "thinking.delta";
}

const defaultSchedule: EventBatchSchedule = (flush) => {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(flush);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(flush, 16);
  return () => clearTimeout(id);
};

export function createBridgeEventBatcher(
  deliver: (envelope: BridgeEventEnvelope) => void,
  schedule: EventBatchSchedule = defaultSchedule,
): BridgeEventBatcher {
  let pending: BridgeEventEnvelope[] = [];
  let cancelPending: (() => void) | undefined;

  const flush = (): void => {
    cancelPending?.();
    cancelPending = undefined;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    batch.forEach(deliver);
  };

  const push = (envelope: BridgeEventEnvelope): void => {
    if (!isDelta(envelope)) {
      flush();
      deliver(envelope);
      return;
    }
    const last = pending.at(-1);
    if (
      last
      && isDelta(last)
      && last.conversationId === envelope.conversationId
      && last.event.type === envelope.event.type
    ) {
      last.event.text += envelope.event.text;
    } else {
      pending.push({
        conversationId: envelope.conversationId,
        event: { ...envelope.event },
      });
    }
    cancelPending ??= schedule(flush);
  };

  return {
    push,
    flush,
    dispose: () => {
      flush();
      cancelPending?.();
      cancelPending = undefined;
    },
  };
}
