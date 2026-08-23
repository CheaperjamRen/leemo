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

export default function Timeline() {
  const activeId = useConversations((s) => s.activeId);
  const timeline = useConversations((s) => s.activeId ? s.timelines[s.activeId] : undefined);
  const activeRunId = useConversations((s) => s.activeId ? s.runIds[s.activeId] : null);
  const pendingByConversation = useApprovals((s) => s.pendingByConversation);
  const mode = useSettings((s) => s.mode);
  const messages = timeline ?? [];
  const pendingInteraction = activeId ? pendingByConversation[activeId] : undefined;
  const { containerRef, atBottom, scrollToBottom, onScroll } = useScrollFollow(messages, pendingInteraction?.id ?? null);
  const groups = messages.length === 0 ? [] : groupByRun(messages);

  // This conversation has a question waiting on the user, scrolled out of
  // view: swap BackToBottom's plain arrow for a labeled pill — the two are
  // mutually exclusive, never both shown (卡 D §6).
  const hasPendingQuestion = pendingInteraction?.kind === "question";

  return (
    <div className="leemo-workbench-timeline relative flex-1 min-h-0 overflow-hidden">
      <div ref={containerRef} onScroll={onScroll} className="leemo-timeline-scroll h-full overflow-y-auto">
        <div data-testid="timeline-content" data-content-axis="primary" className="leemo-workbench-content-axis mx-auto w-full max-w-[900px] space-y-3 px-5 py-4 xl:max-w-[960px]">
          {groups.map((g) => (
            <TurnBlock
              key={g.runId}
              items={g.items}
              active={g.runId === activeRunId}
              runId={g.runId}
              density={mode}
            />
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
