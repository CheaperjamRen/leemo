import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createPersistence } from "../../src/main/persistence/schema";
import { createLearningService } from "../../src/main/learning-service";

describe("local English learning service", () => {
  let db: InstanceType<typeof Database>;
  let clock: number;
  let sequence: number;

  beforeEach(() => {
    db = new Database(":memory:");
    clock = Date.parse("2026-08-02T10:00:00.000Z");
    sequence = 0;
  });

  function service() {
    return createLearningService(createPersistence(db), {
      now: () => clock,
      createId: (prefix) => `${prefix}-${++sequence}`,
    });
  }

  it("keeps the learning plan and review queue after reopening the database", () => {
    const first = service();
    first.saveProfile({
      goal: "能用英语完成 AI 产品岗位面试",
      focus: "career",
      dailyMinutes: 15,
    });
    const item = first.recordMistake({
      skill: "grammar",
      cue: "I have went to the interview yesterday.",
      userAnswer: "I have went to the interview yesterday.",
      correction: "I went to the interview yesterday.",
      explanation: "明确的过去时间使用一般过去时。",
      sourceConversationId: "conversation-1",
    });

    const reopened = service().getSnapshot(clock);
    expect(reopened.profile).toMatchObject({
      goal: "能用英语完成 AI 产品岗位面试",
      focus: "career",
      dailyMinutes: 15,
    });
    expect(reopened.upcomingItems).toEqual([
      expect.objectContaining({ id: item.id, cue: item.cue, encounterCount: 1 }),
    ]);
    expect(reopened.dueItems).toEqual([]);
  });

  it("uses FSRS to schedule a concrete mistake and reuses an exact recurring item", () => {
    const learning = service();
    const first = learning.recordMistake({
      skill: "vocabulary",
      cue: "How do you say '获得实习机会'?",
      userAnswer: "get an internship chance",
      correction: "secure an internship opportunity",
    });

    expect(first.dueAt).toBe(Date.parse("2026-08-03T10:00:00.000Z"));
    expect(first.state).toBe("review");
    expect(first.lastRating).toBe("again");

    clock += 60 * 60 * 1_000;
    const repeated = learning.recordMistake({
      skill: "vocabulary",
      cue: "  How do you say '获得实习机会'?  ",
      userAnswer: "win an internship",
      correction: "secure an internship opportunity",
    });

    expect(repeated.id).toBe(first.id);
    expect(repeated.encounterCount).toBe(2);
    expect(learning.getSnapshot(clock).summary.recurringItems).toBe(1);
  });

  it("rates due reviews through FSRS and records comparable progress evidence", () => {
    const learning = service();
    const item = learning.recordMistake({
      skill: "writing",
      cue: "Write a concise project-impact sentence.",
      correction: "I improved onboarding completion by 18% through guided setup.",
    });

    clock = item.dueAt;
    const reviewed = learning.rateReview({
      itemId: item.id,
      rating: "good",
      userAnswer: "I improved onboarding completion by 18% with guided setup.",
    });
    expect(reviewed.lastRating).toBe("good");
    expect(reviewed.dueAt).toBeGreaterThan(clock);
    expect(reviewed.reps).toBeGreaterThan(item.reps);

    learning.recordSession({
      kind: "baseline",
      skill: "writing",
      assessmentKey: "impact-sentence-v1",
      correct: 4,
      total: 10,
      summary: "基线：句子结构清楚，但时态和动词搭配不稳定。",
      conversationId: "conversation-baseline",
    });
    clock += 7 * 24 * 60 * 60 * 1_000;
    learning.recordSession({
      kind: "check",
      skill: "writing",
      assessmentKey: "impact-sentence-v1",
      correct: 7,
      total: 10,
      summary: "同型复测：能独立写出带量化结果的项目句。",
      conversationId: "conversation-check",
    });

    expect(learning.getSnapshot(clock).evidence).toEqual([
      expect.objectContaining({
        skill: "writing",
        baselineScore: 40,
        latestScore: 70,
        delta: 30,
      }),
    ]);
  });

  it("keeps baseline state, total sessions, and evidence beyond recent-feed limits", () => {
    const learning = service();
    learning.recordSession({
      kind: "baseline",
      skill: "reading",
      assessmentKey: "paper-abstract-v1",
      correct: 2,
      total: 5,
      summary: "摘要理解基线。",
    });
    for (let index = 0; index < 205; index += 1) {
      clock += 1;
      learning.recordSession({
        kind: "practice",
        skill: "vocabulary",
        correct: 1,
        total: 1,
        summary: `日常练习 ${index + 1}`,
      });
    }
    clock += 1;
    learning.recordSession({
      kind: "check",
      skill: "reading",
      assessmentKey: "paper-abstract-v1",
      correct: 4,
      total: 5,
      summary: "同一摘要题型复测。",
    });

    const snapshot = learning.getSnapshot(clock);
    expect(snapshot.summary.hasBaseline).toBe(true);
    expect(snapshot.summary.completedSessions).toBe(207);
    expect(snapshot.recentSessions).toHaveLength(20);
    expect(snapshot.recentSessions.some((session) => session.kind === "baseline")).toBe(false);
    expect(snapshot.evidence).toEqual([
      expect.objectContaining({ assessmentKey: "paper-abstract-v1", delta: 40 }),
    ]);
  });

  it("does not manufacture progress from different assessments or an obsolete baseline", () => {
    const learning = service();
    learning.recordSession({
      kind: "baseline",
      skill: "writing",
      assessmentKey: "cover-letter-v1",
      correct: 2,
      total: 5,
      summary: "求职信基线。",
    });
    clock += 1;
    expect(() => learning.recordSession({
      kind: "check",
      skill: "writing",
      assessmentKey: "free-writing-v1",
      correct: 5,
      total: 5,
      summary: "不同任务。",
    })).toThrow(/找不到.*基线/);

    expect(() => learning.recordSession({
      kind: "check",
      skill: "reading",
      assessmentKey: "cover-letter-v1",
      correct: 5,
      total: 5,
      summary: "标识相同但能力不同的任务。",
    })).toThrow(/找不到.*基线/);

    clock += 1;
    learning.recordSession({
      kind: "baseline",
      skill: "writing",
      assessmentKey: "cover-letter-v1",
      correct: 4,
      total: 5,
      summary: "新一轮求职信基线。",
    });
    clock += 1;
    expect(() => learning.recordSession({
      kind: "check",
      skill: "writing",
      assessmentKey: "cover-letter-v1",
      correct: 4,
      total: 4,
      summary: "题数不同的任务。",
    })).toThrow(/题数.*基线/);
    clock += 1;
    learning.recordSession({
      kind: "check",
      skill: "writing",
      assessmentKey: "cover-letter-v1",
      correct: 5,
      total: 5,
      summary: "新基线后的同型复测。",
    });
    expect(learning.getSnapshot(clock).evidence).toEqual([
      expect.objectContaining({ baselineScore: 80, latestScore: 100, delta: 20 }),
    ]);
  });

  it("rejects non-finite daily practice minutes at the main-process boundary", () => {
    const learning = service();
    expect(() => learning.saveProfile({
      goal: "完成英文面试",
      focus: "career",
      dailyMinutes: Number.NaN,
    })).toThrow("每日学习时长");
  });

  it("surfaces a corrupt learning profile instead of treating it as missing", () => {
    const learning = service();
    learning.saveProfile({
      goal: "完成英文面试",
      focus: "career",
      dailyMinutes: 15,
    });
    db.prepare("UPDATE learning_profiles SET profile_json = ? WHERE id = 'english'").run("{broken");

    expect(() => learning.getSnapshot(clock)).toThrow(/学习计划.*无法读取/);
  });

  it("surfaces corrupt queue and session rows instead of silently dropping progress", () => {
    const learning = service();
    const review = learning.recordMistake({
      skill: "grammar",
      cue: "I have went there yesterday.",
      correction: "I went there yesterday.",
    });
    db.prepare("UPDATE learning_review_items SET item_json = ? WHERE id = ?").run("null", review.id);
    expect(() => learning.getSnapshot(clock)).toThrow(/复习记录.*无法读取/);

    db.prepare("DELETE FROM learning_review_items").run();
    learning.recordSession({
      kind: "practice",
      skill: "conversation",
      correct: 1,
      total: 1,
      summary: "完成一次练习。",
    });
    db.prepare("UPDATE learning_sessions SET session_json = ?").run("{broken");
    expect(() => learning.getSnapshot(clock)).toThrow(/练习记录.*无法读取/);
  });

  it("does not count a corrupt practice session after it leaves the recent feed", () => {
    const learning = service();
    for (let index = 0; index < 25; index += 1) {
      clock += 1;
      learning.recordSession({
        kind: "practice",
        skill: "conversation",
        correct: 1,
        total: 1,
        summary: `练习 ${index + 1}`,
      });
    }
    const oldest = db.prepare("SELECT id FROM learning_sessions ORDER BY created_at ASC LIMIT 1").get() as { id: string };
    db.prepare("UPDATE learning_sessions SET session_json = ? WHERE id = ?").run("{broken", oldest.id);

    expect(() => learning.getSnapshot(clock)).toThrow(/练习记录.*无法读取/);
  });
});
