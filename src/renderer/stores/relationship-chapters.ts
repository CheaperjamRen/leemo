import type { ConversationMeta } from "./conversations";
import type { TimelineItem } from "./message-model";
import { isGlobalBuddyConversation } from "./relationship-onboarding";

export interface RelationshipChapter {
  conversation: ConversationMeta;
  timeline: TimelineItem[];
  firstRunId?: string;
  hasActivity: boolean;
  active: boolean;
}

export interface RelationshipChapterMarker {
  beforeRunId: string;
  title: string;
  startedAt: number;
}

export interface RelationshipTimelineWindow {
  items: TimelineItem[];
  chapterMarkers: RelationshipChapterMarker[];
  hasOlder: boolean;
}

const firstActivityCache = new WeakMap<TimelineItem[], TimelineItem | null>();

function firstVisibleActivity(timeline: TimelineItem[]): TimelineItem | undefined {
  const cached = firstActivityCache.get(timeline);
  if (cached !== undefined) return cached ?? undefined;
  const first = timeline.find((item) => (
    item.kind !== "context"
    && item.kind !== "usage"
    && item.kind !== "compact"
  ));
  firstActivityCache.set(timeline, first ?? null);
  return first;
}

function chapterTitle(chapter: RelationshipChapter): string {
  const rawTitle = chapter.conversation.title.trim();
  return rawTitle === "" || rawTitle === "新对话" ? "新话题" : rawTitle;
}

export function deriveRelationshipChapters(_args: {
  conversations: Readonly<Record<string, ConversationMeta>>;
  timelines: Readonly<Record<string, TimelineItem[]>>;
  activeId: string | null;
}): RelationshipChapter[] {
  const { conversations, timelines, activeId } = _args;
  return Object.values(conversations)
    .filter(isGlobalBuddyConversation)
    .sort((left, right) => {
      if (left.id === activeId && right.id !== activeId) return 1;
      if (right.id === activeId && left.id !== activeId) return -1;
      return left.createdAt - right.createdAt || left.lastActivityAt - right.lastActivityAt;
    })
    .map((conversation) => {
      const timeline = timelines[conversation.id] ?? [];
      const firstActivity = firstVisibleActivity(timeline);
      return {
        conversation,
        timeline,
        ...(firstActivity && "runId" in firstActivity ? { firstRunId: firstActivity.runId } : {}),
        hasActivity: firstActivity !== undefined,
        active: conversation.id === activeId,
      };
    });
}

/**
 * 从关系章节尾部按 run 取一个有界窗口。默认流式更新只会读取窗口附近的数组项，
 * 不会为了最后一段增量去 flatten / group 多年历史；用户点「加载更早」时再增大
 * maxRunCount。一个 run 内的工具与流式片段仍保持完整，章节标记只在真实章节开头
 * 落入窗口时出现。
 */
export function projectRelationshipTimelineWindow(
  chapters: readonly RelationshipChapter[],
  maxRunCount: number,
): RelationshipTimelineWindow {
  const limit = Math.max(1, Math.floor(maxRunCount));
  const chunks: Array<{ chapter: RelationshipChapter; items: TimelineItem[] }> = [];
  let includedRuns = 0;
  let hasOlder = false;

  for (let chapterIndex = chapters.length - 1; chapterIndex >= 0; chapterIndex -= 1) {
    const chapter = chapters[chapterIndex];
    const timeline = chapter.timeline;
    if (timeline.length === 0) continue;
    const reversedItems: TimelineItem[] = [];
    let newestSeenRunId: string | undefined;
    let reachedOlderBoundary = false;

    for (let itemIndex = timeline.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = timeline[itemIndex];
      if (item.kind !== "compact" && item.runId !== newestSeenRunId) {
        if (includedRuns >= limit) {
          hasOlder = true;
          reachedOlderBoundary = true;
          break;
        }
        includedRuns += 1;
        newestSeenRunId = item.runId;
      }
      reversedItems.push(item);
    }

    if (reversedItems.length > 0) chunks.push({ chapter, items: reversedItems.reverse() });
    if (reachedOlderBoundary) break;
  }

  chunks.reverse();
  const chapterMarkers: RelationshipChapterMarker[] = [];
  for (const chunk of chunks) {
    if (!chunk.chapter.firstRunId) continue;
    const firstIncludedRun = chunk.items.find((item) => item.kind !== "compact")?.runId;
    if (firstIncludedRun !== chunk.chapter.firstRunId) continue;
    chapterMarkers.push({
      beforeRunId: chunk.chapter.firstRunId,
      title: chapterTitle(chunk.chapter),
      startedAt: chunk.chapter.conversation.createdAt,
    });
  }

  return {
    items: chunks.flatMap((chunk) => chunk.items),
    chapterMarkers,
    hasOlder,
  };
}

/** 仅在用户从历史抽屉跳到旧章节时调用；返回从末尾覆盖目标 run 所需的窗口。 */
export function relationshipRunCountFromEnd(
  chapters: readonly RelationshipChapter[],
  targetRunId: string,
): number | undefined {
  let count = 0;
  for (let chapterIndex = chapters.length - 1; chapterIndex >= 0; chapterIndex -= 1) {
    let lastRunId: string | undefined;
    const timeline = chapters[chapterIndex].timeline;
    for (let itemIndex = timeline.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = timeline[itemIndex];
      if (item.kind === "compact") continue;
      if (item.runId !== lastRunId) {
        count += 1;
        lastRunId = item.runId;
      }
      if (item.runId === targetRunId) return count;
    }
  }
  return undefined;
}

export function canReuseEmptyRelationshipChapter(chapter: RelationshipChapter | undefined): boolean {
  return chapter?.active === true && !chapter.hasActivity;
}
