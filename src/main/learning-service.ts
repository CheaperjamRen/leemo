import { Rating, State, createEmptyCard, fsrs, type Card, type Grade } from "ts-fsrs";
import { randomUUID } from "node:crypto";
import type { Persistence } from "./persistence/schema";
import type {
  LearningBaseline,
  LearningEvidence,
  LearningFocus,
  LearningMistakeDraft,
  LearningProfile,
  LearningProfileDraft,
  LearningReviewDraft,
  LearningReviewItem,
  LearningReviewRating,
  LearningReviewState,
  LearningService,
  LearningSession,
  LearningSessionDraft,
  LearningSkill,
  LearningSnapshot,
} from "../learning";
import { LEARNING_FOCUSES, LEARNING_SKILLS } from "../learning";

export interface LearningServiceOptions {
  now?: () => number;
  createId?: (prefix: "review" | "session") => string;
}

const scheduler = fsrs({
  enable_fuzz: false,
  enable_short_term: false,
  maximum_interval: 3_650,
  request_retention: 0.9,
});

function cleanText(value: string, max: number, label: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) throw new Error(`${label}不能为空。`);
  return Array.from(clean).slice(0, max).join("");
}

function optionalText(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? Array.from(clean).slice(0, max).join("") : undefined;
}

function validFocus(value: LearningFocus): LearningFocus {
  if (!LEARNING_FOCUSES.includes(value)) throw new Error("学习方向无法识别。");
  return value;
}

function validSkill(value: LearningSkill): LearningSkill {
  if (!LEARNING_SKILLS.includes(value)) throw new Error("练习能力无法识别。");
  return value;
}

function stateName(state: State): LearningReviewState {
  switch (state) {
    case State.New: return "new";
    case State.Learning: return "learning";
    case State.Relearning: return "relearning";
    default: return "review";
  }
}

function stateValue(state: LearningReviewState): State {
  switch (state) {
    case "new": return State.New;
    case "learning": return State.Learning;
    case "relearning": return State.Relearning;
    default: return State.Review;
  }
}

function ratingValue(rating: LearningReviewRating): Grade {
  switch (rating) {
    case "again": return Rating.Again;
    case "hard": return Rating.Hard;
    case "easy": return Rating.Easy;
    default: return Rating.Good;
  }
}

function asCard(item: LearningReviewItem): Card {
  return {
    due: new Date(item.dueAt),
    stability: item.stability,
    difficulty: item.difficulty,
    elapsed_days: item.elapsedDays,
    scheduled_days: item.scheduledDays,
    learning_steps: item.learningSteps,
    reps: item.reps,
    lapses: item.lapses,
    state: stateValue(item.state),
    ...(item.lastReviewedAt === undefined ? {} : { last_review: new Date(item.lastReviewedAt) }),
  };
}

function cardFields(card: Card, rating: LearningReviewRating): Pick<
  LearningReviewItem,
  | "dueAt"
  | "lastReviewedAt"
  | "stability"
  | "difficulty"
  | "elapsedDays"
  | "scheduledDays"
  | "learningSteps"
  | "reps"
  | "lapses"
  | "state"
  | "lastRating"
> {
  return {
    dueAt: card.due.getTime(),
    ...(card.last_review ? { lastReviewedAt: card.last_review.getTime() } : {}),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: stateName(card.state),
    lastRating: rating,
  };
}

function normalizedCue(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function score(correct: number, total: number): number {
  if (!Number.isInteger(correct) || !Number.isInteger(total) || total < 1 || correct < 0 || correct > total) {
    throw new Error("练习得分必须是有效的正确数和总题数。");
  }
  return Math.round((correct / total) * 100);
}

function evidenceFor(sessions: readonly LearningSession[]): LearningEvidence[] {
  const byAssessment = new Map<string, LearningSession[]>();
  for (const session of sessions) {
    if (!session.assessmentKey) continue;
    const key = `${session.skill}\u0000${session.assessmentKey}`;
    const list = byAssessment.get(key) ?? [];
    list.push(session);
    byAssessment.set(key, list);
  }
  const evidence: LearningEvidence[] = [];
  for (const list of byAssessment.values()) {
    const ordered = [...list].sort((left, right) => left.createdAt - right.createdAt);
    const baseline = [...ordered].reverse().find((session) => session.kind === "baseline");
    const latest = [...ordered].reverse().find(
      (session) => session.kind === "check" && baseline !== undefined && session.createdAt > baseline.createdAt,
    );
    if (!baseline || !latest || latest.createdAt <= baseline.createdAt || latest.total !== baseline.total) continue;
    evidence.push({
      skill: baseline.skill,
      assessmentKey: baseline.assessmentKey as string,
      baselineScore: baseline.score,
      latestScore: latest.score,
      delta: latest.score - baseline.score,
      baselineAt: baseline.createdAt,
      latestAt: latest.createdAt,
      latestSummary: latest.summary,
    });
  }
  return evidence.sort((left, right) => right.latestAt - left.latestAt);
}

function baselinesFor(sessions: readonly LearningSession[]): LearningBaseline[] {
  const latestByAssessment = new Map<string, LearningBaseline>();
  for (const session of sessions) {
    if (session.kind !== "baseline" || !session.assessmentKey) continue;
    const key = `${session.skill}\u0000${session.assessmentKey}`;
    const current = latestByAssessment.get(key);
    if (current && current.createdAt >= session.createdAt) continue;
    latestByAssessment.set(key, {
      skill: session.skill,
      assessmentKey: session.assessmentKey,
      correct: session.correct,
      total: session.total,
      score: session.score,
      summary: session.summary,
      createdAt: session.createdAt,
    });
  }
  return [...latestByAssessment.values()].sort((left, right) => right.createdAt - left.createdAt);
}

export function createLearningService(
  persistence: Pick<
    Persistence,
    | "getLearningProfile"
    | "saveLearningProfile"
    | "listLearningReviewItems"
    | "getLearningReviewItem"
    | "saveLearningReviewItem"
    | "listLearningSessions"
    | "listLearningAssessmentSessions"
    | "getLearningSessionStats"
    | "saveLearningSession"
  >,
  options: LearningServiceOptions = {},
): LearningService {
  const now = options.now ?? Date.now;
  const createId = options.createId ?? ((prefix) => `${prefix}-${randomUUID()}`);

  return {
    getSnapshot(at = now()): LearningSnapshot {
      const items = persistence.listLearningReviewItems();
      const sessions = persistence.listLearningSessions(20);
      const assessmentSessions = persistence.listLearningAssessmentSessions();
      const sessionStats = persistence.getLearningSessionStats();
      const due = items.filter((item) => item.dueAt <= at);
      const dueItems = due.slice(0, 50);
      const upcomingItems = items.filter((item) => item.dueAt > at).slice(0, 20);
      return {
        profile: persistence.getLearningProfile() ?? null,
        dueItems,
        upcomingItems,
        recentSessions: sessions,
        baselines: baselinesFor(assessmentSessions),
        evidence: evidenceFor(assessmentSessions),
        summary: {
          totalItems: items.length,
          dueItems: due.length,
          recurringItems: items.filter((item) => item.encounterCount > 1).length,
          reviewedItems: items.filter((item) => item.reps > 1).length,
          completedSessions: sessionStats.total,
          hasBaseline: sessionStats.hasBaseline,
        },
      };
    },

    saveProfile(draft: LearningProfileDraft): LearningProfile {
      const current = persistence.getLearningProfile();
      const timestamp = now();
      if (!Number.isFinite(draft.dailyMinutes) || !Number.isInteger(draft.dailyMinutes)
        || draft.dailyMinutes < 5 || draft.dailyMinutes > 90) {
        throw new Error("每日学习时长需为 5 到 90 分钟的整数。");
      }
      const dailyMinutes = draft.dailyMinutes;
      const profile: LearningProfile = {
        id: "english",
        goal: cleanText(draft.goal, 240, "学习目标"),
        focus: validFocus(draft.focus),
        dailyMinutes,
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      persistence.saveLearningProfile(profile);
      return profile;
    },

    recordMistake(draft: LearningMistakeDraft): LearningReviewItem {
      const timestamp = now();
      const skill = validSkill(draft.skill);
      const cue = cleanText(draft.cue, 800, "复习题面");
      const correction = cleanText(draft.correction, 1_500, "正确表达");
      const existing = persistence.listLearningReviewItems().find(
        (item) => item.skill === skill && normalizedCue(item.cue) === normalizedCue(cue),
      );
      const baseCard = existing ? asCard(existing) : createEmptyCard(new Date(timestamp));
      const next = scheduler.next(baseCard, new Date(timestamp), Rating.Again).card;
      const item: LearningReviewItem = {
        id: existing?.id ?? createId("review"),
        skill,
        cue,
        ...(optionalText(draft.userAnswer, 1_500) ? { userAnswer: optionalText(draft.userAnswer, 1_500) } : {}),
        correction,
        ...(optionalText(draft.explanation, 1_500) ? { explanation: optionalText(draft.explanation, 1_500) } : {}),
        ...(optionalText(draft.sourceConversationId, 200)
          ? { sourceConversationId: optionalText(draft.sourceConversationId, 200) }
          : {}),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        ...cardFields(next, "again"),
        encounterCount: (existing?.encounterCount ?? 0) + 1,
      };
      persistence.saveLearningReviewItem(item);
      return item;
    },

    rateReview(draft: LearningReviewDraft): LearningReviewItem {
      const item = persistence.getLearningReviewItem(cleanText(draft.itemId, 200, "复习项目"));
      if (!item) throw new Error("找不到这条复习内容，可能已经被整理。请刷新后再试。");
      const timestamp = now();
      const next = scheduler.next(asCard(item), new Date(timestamp), ratingValue(draft.rating)).card;
      const updated: LearningReviewItem = {
        ...item,
        ...(optionalText(draft.userAnswer, 1_500) ? { userAnswer: optionalText(draft.userAnswer, 1_500) } : {}),
        updatedAt: timestamp,
        ...cardFields(next, draft.rating),
      };
      persistence.saveLearningReviewItem(updated);
      return updated;
    },

    recordSession(draft: LearningSessionDraft): LearningSession {
      const timestamp = now();
      const skill = validSkill(draft.skill);
      const assessmentKey = optionalText(draft.assessmentKey, 120);
      if ((draft.kind === "baseline" || draft.kind === "check") && !assessmentKey) {
        throw new Error("基线与复测必须注明可复用的测评标识。");
      }
      if (draft.kind === "check" && assessmentKey) {
        const baseline = persistence.listLearningAssessmentSessions()
          .filter((session) => session.kind === "baseline"
            && session.skill === skill
            && session.assessmentKey === assessmentKey)
          .sort((left, right) => right.createdAt - left.createdAt)[0];
        if (!baseline) {
          throw new Error("找不到对应的可复测基线，请先读取学习计划或重新完成基线。");
        }
        if (draft.total !== baseline.total) {
          throw new Error(`本次复测题数必须与基线的 ${baseline.total} 题一致。`);
        }
      }
      const session: LearningSession = {
        id: createId("session"),
        kind: draft.kind,
        skill,
        ...(assessmentKey ? { assessmentKey } : {}),
        correct: draft.correct,
        total: draft.total,
        score: score(draft.correct, draft.total),
        summary: cleanText(draft.summary, 1_000, "练习小结"),
        ...(optionalText(draft.conversationId, 200)
          ? { conversationId: optionalText(draft.conversationId, 200) }
          : {}),
        createdAt: timestamp,
      };
      persistence.saveLearningSession(session);
      return session;
    },
  };
}
