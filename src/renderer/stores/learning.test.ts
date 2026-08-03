import { describe, expect, it, vi } from "vitest";
import type { LearningClient } from "../learning/client";
import type { LearningSnapshot } from "../../learning";
import { createLearningStore } from "./learning";

const SNAPSHOT: LearningSnapshot = {
  profile: {
    id: "english",
    goal: "读懂英文论文",
    focus: "academic",
    dailyMinutes: 15,
    createdAt: 1,
    updatedAt: 1,
  },
  dueItems: [],
  upcomingItems: [],
  recentSessions: [],
  baselines: [],
  evidence: [],
  summary: {
    totalItems: 0,
    dueItems: 0,
    recurringItems: 0,
    reviewedItems: 0,
    completedSessions: 0,
    hasBaseline: false,
  },
};

describe("learning store", () => {
  it("keeps the last good snapshot when a later durable read fails", async () => {
    const getSnapshot = vi.fn<LearningClient["getSnapshot"]>()
      .mockResolvedValueOnce(SNAPSHOT)
      .mockRejectedValueOnce(new Error("学习计划无法读取，原数据仍保留。"));
    const client: LearningClient = {
      getSnapshot,
      saveProfile: vi.fn(),
    };
    const store = createLearningStore(client);

    await store.getState().refresh();
    await store.getState().refresh();

    expect(store.getState()).toMatchObject({
      snapshot: SNAPSHOT,
      status: "error",
      error: "学习计划无法读取，原数据仍保留。",
    });
  });
});
