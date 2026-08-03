export type LearningFocus = "general" | "academic" | "career" | "conversation";
export type LearningSkill = "vocabulary" | "grammar" | "reading" | "writing" | "conversation";
export type LearningReviewRating = "again" | "hard" | "good" | "easy";
export type LearningReviewState = "new" | "learning" | "review" | "relearning";
export type LearningSessionKind = "baseline" | "practice" | "check";

export interface LearningProfileDraft {
  goal: string;
  focus: LearningFocus;
  dailyMinutes: number;
}

export interface LearningProfile extends LearningProfileDraft {
  id: "english";
  createdAt: number;
  updatedAt: number;
}

export interface LearningMistakeDraft {
  skill: LearningSkill;
  cue: string;
  userAnswer?: string;
  correction: string;
  explanation?: string;
  sourceConversationId?: string;
}

export interface LearningReviewItem {
  id: string;
  skill: LearningSkill;
  cue: string;
  userAnswer?: string;
  correction: string;
  explanation?: string;
  sourceConversationId?: string;
  createdAt: number;
  updatedAt: number;
  dueAt: number;
  lastReviewedAt?: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: LearningReviewState;
  encounterCount: number;
  lastRating: LearningReviewRating;
}

export interface LearningReviewDraft {
  itemId: string;
  rating: LearningReviewRating;
  userAnswer?: string;
}

export interface LearningSessionDraft {
  kind: LearningSessionKind;
  skill: LearningSkill;
  /** Stable task/form identity. Required for baseline and check sessions so
   * scores are only compared when the learner completed the same assessment. */
  assessmentKey?: string;
  correct: number;
  total: number;
  summary: string;
  conversationId?: string;
}

export interface LearningSession extends LearningSessionDraft {
  id: string;
  score: number;
  createdAt: number;
}

export interface LearningEvidence {
  skill: LearningSkill;
  assessmentKey: string;
  baselineScore: number;
  latestScore: number;
  delta: number;
  baselineAt: number;
  latestAt: number;
  latestSummary: string;
}

export interface LearningBaseline {
  skill: LearningSkill;
  assessmentKey: string;
  correct: number;
  total: number;
  score: number;
  summary: string;
  createdAt: number;
}

export interface LearningSnapshot {
  profile: LearningProfile | null;
  dueItems: LearningReviewItem[];
  upcomingItems: LearningReviewItem[];
  recentSessions: LearningSession[];
  baselines: LearningBaseline[];
  evidence: LearningEvidence[];
  summary: {
    totalItems: number;
    dueItems: number;
    recurringItems: number;
    reviewedItems: number;
    completedSessions: number;
    hasBaseline: boolean;
  };
}

export interface LearningService {
  getSnapshot(now?: number): LearningSnapshot;
  saveProfile(draft: LearningProfileDraft): LearningProfile;
  recordMistake(draft: LearningMistakeDraft): LearningReviewItem;
  rateReview(draft: LearningReviewDraft): LearningReviewItem;
  recordSession(draft: LearningSessionDraft): LearningSession;
}

export const LEARNING_FOCUSES: readonly LearningFocus[] = [
  "general",
  "academic",
  "career",
  "conversation",
];

export const LEARNING_FOCUS_LABELS: Readonly<Record<LearningFocus, string>> = {
  general: "日常表达",
  academic: "论文阅读",
  career: "求职面试",
  conversation: "交流表达",
};

export const LEARNING_SKILLS: readonly LearningSkill[] = [
  "vocabulary",
  "grammar",
  "reading",
  "writing",
  "conversation",
];
