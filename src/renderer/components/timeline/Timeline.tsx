import { useEffect, useMemo, useState } from "react";
import { useConversations, useApprovals, useSettings } from "../../bridge/context";
import type { TimelineItem } from "../../stores/message-model";
import TurnBlock from "./TurnBlock";
import { useScrollFollow } from "./useScrollFollow";
import BackToBottom from "./BackToBottom";
import PendingQuestionPill from "./PendingQuestionPill";

/** Groups items by runId (compact items, which have no runId, attach to the
 *  current group) and renders one TurnBlock per run. */
function groupByRun(items: TimelineItem[]): { runId: string; items: TimelineItem[] }[] {
  const groups: { runId: string; items: TimelineItem[] }[] = [];
  for (const item of items) {
    const run = item.kind === "compact" ? groups[groups.length - 1]?.runId : item.runId;
    const last = groups[groups.length - 1];
    if (last && last.runId === run) last.items.push(item);
    else if (run !== undefined) groups.push({ runId: run, items: [item] });
    else if (last) last.items.push(item); // leading compact w/o group: attach to last (none → dropped)
  }
  return groups;
}

interface TimelineProps {
  /** Optional projection used by Buddy's durable relationship stream. The
   * workbench keeps the active-conversation defaults below. */
  items?: TimelineItem[];
  activeConversationId?: string | null;
  activeRunId?: string | null;
  /** Relationship history is mounted in bounded pages so years of local chat
   * do not turn one visible screen into an unbounded DOM tree. */
  pageSize?: number;
  pageKey?: string;
  focusRequest?: { runId: string; nonce: number } | null;
}

export default function Timeline({
  items,
  activeConversationId,
  activeRunId: projectedActiveRunId,
  pageSize,
  pageKey = "active-conversation",
  focusRequest,
}: TimelineProps = {}) {
  const storeActiveId = useConversations((s) => s.activeId);
  const storeTimeline = useConversations((s) => s.activeId ? s.timelines[s.activeId] : undefined);
  const storeActiveRunId = useConversations((s) => s.activeId ? s.runIds[s.activeId] : null);
  const activeId = activeConversationId === undefined ? storeActiveId : activeConversationId;
  const activeRunId = projectedActiveRunId === undefined ? storeActiveRunId : projectedActiveRunId;
  const pendingByConversation = useApprovals((s) => s.pendingByConversation);
  const mode = useSettings((s) => s.mode);
  const messages = items ?? storeTimeline ?? [];
  const pendingInteraction = activeId ? pendingByConversation[activeId] : undefined;
  const groups = useMemo(() => messages.length === 0 ? [] : groupByRun(messages), [messages]);
  const boundedPageSize = pageSize === undefined ? Number.MAX_SAFE_INTEGER : Math.max(1, pageSize);
  const [visibleGroupCount, setVisibleGroupCount] = useState(boundedPageSize);
  useEffect(() => setVisibleGroupCount(boundedPageSize), [boundedPageSize, pageKey]);
  const hiddenGroupCount = Math.max(0, groups.length - visibleGroupCount);
  const visibleGroups = hiddenGroupCount > 0 ? groups.slice(hiddenGroupCount) : groups;
  const visibleMessages = useMemo(() => visibleGroups.flatMap((group) => group.items), [visibleGroups]);
  const { containerRef, atBottom, scrollToBottom, onScroll } = useScrollFollow(visibleMessages, pendingInteraction?.id ?? null);

  useEffect(() => {
    if (!focusRequest) return;
    const targetIndex = groups.findIndex((group) => group.runId === focusRequest.runId);
    if (targetIndex < 0) return;
    const neededCount = groups.length - targetIndex;
    setVisibleGroupCount((count) => Math.max(count, neededCount));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const target = containerRef.current?.querySelector<HTMLElement>(
        `[data-run-id="${focusRequest.runId.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"]`,
      );
      target?.scrollIntoView?.({ block: "start" });
    }));
  }, [containerRef, focusRequest, groups]);

  const revealOlder = () => {
    const scroll = containerRef.current;
    const previousHeight = scroll?.scrollHeight ?? 0;
    const previousTop = scroll?.scrollTop ?? 0;
    setVisibleGroupCount((count) => Math.min(groups.length, count + boundedPageSize));
    requestAnimationFrame(() => {
      if (!scroll) return;
      scroll.scrollTop = previousTop + Math.max(0, scroll.scrollHeight - previousHeight);
    });
  };

  // This conversation has a question waiting on the user, scrolled out of
  // view: swap BackToBottom's plain arrow for a labeled pill — the two are
  // mutually exclusive, never both shown (卡 D §6).
  const hasPendingQuestion = pendingInteraction?.kind === "question";

  return (
    <div className="leemo-workbench-timeline relative flex-1 min-h-0 overflow-hidden">
      <div ref={containerRef} onScroll={onScroll} className="leemo-timeline-scroll h-full overflow-y-auto">
        <div data-testid="timeline-content" data-content-axis="primary" className="leemo-workbench-content-axis mx-auto w-full max-w-[900px] space-y-3 px-5 py-4 xl:max-w-[960px]">
          {hiddenGroupCount > 0 && (
            <button
              type="button"
              className="mx-auto flex min-h-9 items-center rounded-full border border-[var(--leemo-border-soft)] bg-[var(--leemo-surface)] px-4 text-[12.5px] text-[var(--leemo-text-secondary)] transition-colors hover:border-[var(--leemo-border-strong)] hover:text-[var(--leemo-text-primary)]"
              aria-label={`加载更早记录（还有 ${hiddenGroupCount} 段）`}
              onClick={revealOlder}
            >
              加载更早记录 · {hiddenGroupCount} 段
            </button>
          )}
          {visibleGroups.map((g) => (
            <div key={g.runId} data-run-id={g.runId}>
              <TurnBlock
                items={g.items}
                active={g.runId === activeRunId}
                runId={g.runId}
                density={mode}
              />
            </div>
          ))}
        </div>
      </div>
      {hasPendingQuestion ? (
        <PendingQuestionPill show={!atBottom} onClick={scrollToBottom} />
      ) : (
        <BackToBottom show={!atBottom} onClick={scrollToBottom} />
      )}
    </div>
  );
}
