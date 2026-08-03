import { act, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BridgeProvider } from "../bridge/context";
import { FixtureBridgeClient } from "../bridge/fixture-client";
import type { LearningClient } from "../learning/client";
import type { LearningSnapshot } from "../../learning";
import EnglishLearningPage from "./EnglishLearningPage";

const emptySnapshot: LearningSnapshot = {
  profile: null,
  dueItems: [],
  upcomingItems: [],
  recentSessions: [],
  baselines: [],
  evidence: [],
  summary: { totalItems: 0, dueItems: 0, recurringItems: 0, reviewedItems: 0, completedSessions: 0, hasBaseline: false },
};

function learningClient(initial: LearningSnapshot = emptySnapshot): LearningClient {
  let snapshot = structuredClone(initial);
  return {
    getSnapshot: vi.fn(async () => structuredClone(snapshot)),
    saveProfile: vi.fn(async (draft) => {
      snapshot.profile = {
        ...draft,
        id: "english",
        createdAt: 1,
        updatedAt: 1,
      };
      return structuredClone(snapshot.profile!);
    }),
  };
}

describe("EnglishLearningPage", () => {
  it("turns first-time setup into one real momo diagnostic conversation", async () => {
    const user = userEvent.setup();
    const bridge = new FixtureBridgeClient({ reply: "先做一个短诊断。", chunkDelayMs: 1 });
    const invoke = vi.spyOn(bridge, "invoke");
    const learning = learningClient();
    render(
      <BridgeProvider client={bridge} learning={learning}>
        <EnglishLearningPage />
      </BridgeProvider>,
    );

    expect(await screen.findByRole("heading", { name: "英语学习" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("学习目标"), "能用英语完成 AI 产品岗位面试");
    await user.click(screen.getByRole("button", { name: "论文阅读" }));
    await user.click(screen.getByRole("button", { name: "开始诊断" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "bridge:send",
      expect.objectContaining({
        prompt: expect.stringContaining("英语基线诊断"),
      }),
    ));
    expect(invoke).toHaveBeenCalledWith(
      "bridge:send",
      expect.objectContaining({ prompt: expect.stringContaining("当前重点是：论文阅读") }),
    );
    expect(learning.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
      goal: "能用英语完成 AI 产品岗位面试",
      focus: "academic",
    }));
  });

  it("shows due work without revealing the answer and starts today's practice", async () => {
    const user = userEvent.setup();
    const bridge = new FixtureBridgeClient({ reply: "开始复习。", chunkDelayMs: 1 });
    const invoke = vi.spyOn(bridge, "invoke");
    const learning = learningClient({
      ...emptySnapshot,
      profile: {
        id: "english",
        goal: "读懂英文论文并能复述",
        focus: "academic",
        dailyMinutes: 20,
        createdAt: 1,
        updatedAt: 1,
      },
      dueItems: [{
        id: "item-1",
        skill: "reading",
        cue: "What does ablation study mean?",
        correction: "A test that removes components.",
        createdAt: 1,
        updatedAt: 1,
        dueAt: 1,
        stability: 1,
        difficulty: 5,
        elapsedDays: 0,
        scheduledDays: 1,
        learningSteps: 0,
        reps: 1,
        lapses: 1,
        state: "review",
        encounterCount: 1,
        lastRating: "again",
      }],
      recentSessions: [{
        id: "baseline-1",
        kind: "baseline",
        skill: "reading",
        correct: 2,
        total: 5,
        score: 40,
        summary: "阅读基线",
        createdAt: 1,
      }],
      summary: { totalItems: 1, dueItems: 1, recurringItems: 0, reviewedItems: 0, completedSessions: 1, hasBaseline: true },
    });
    render(
      <BridgeProvider client={bridge} learning={learning}>
        <EnglishLearningPage />
      </BridgeProvider>,
    );

    expect(await screen.findByText("What does ablation study mean?")).toBeInTheDocument();
    expect(screen.getByText("论文阅读", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("A test that removes components.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "开始今日练习" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "bridge:send",
      expect.objectContaining({
        prompt: expect.stringMatching(/1 个到期复习[\s\S]*当前重点是：论文阅读/),
      }),
    ));
  });

  it("keeps long user content in wrap-safe containers", async () => {
    const longGoal = `读懂论文${"A".repeat(220)}`;
    const longCue = `Explain${"B".repeat(760)}`;
    render(
      <BridgeProvider client={new FixtureBridgeClient()} learning={learningClient({
        ...emptySnapshot,
        profile: {
          id: "english",
          goal: longGoal,
          focus: "academic",
          dailyMinutes: 15,
          createdAt: 1,
          updatedAt: 1,
        },
        dueItems: [{
          id: "long-item",
          skill: "reading",
          cue: longCue,
          correction: "A concise answer.",
          createdAt: 1,
          updatedAt: 1,
          dueAt: 1,
          stability: 1,
          difficulty: 5,
          elapsedDays: 0,
          scheduledDays: 1,
          learningSteps: 0,
          reps: 1,
          lapses: 1,
          state: "review",
          encounterCount: 1,
          lastRating: "again",
        }],
        summary: { ...emptySnapshot.summary, totalItems: 1, dueItems: 1 },
      })}>
        <EnglishLearningPage />
      </BridgeProvider>,
    );

    expect(await screen.findByText(longGoal)).toHaveClass("[overflow-wrap:anywhere]");
    expect(screen.getByText(longCue)).toHaveClass("[overflow-wrap:anywhere]");
  });

  it("does not present daily practice before a baseline session exists", async () => {
    const bridge = new FixtureBridgeClient({ reply: "继续完成诊断。", chunkDelayMs: 1 });
    const invoke = vi.spyOn(bridge, "invoke");
    render(
      <BridgeProvider client={bridge} learning={learningClient({
        ...emptySnapshot,
        profile: {
          id: "english",
          goal: "能完成英文面试",
          focus: "career",
          dailyMinutes: 15,
          createdAt: 1,
          updatedAt: 1,
        },
      })}>
        <EnglishLearningPage />
      </BridgeProvider>,
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "完成基线诊断" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "bridge:send",
      expect.objectContaining({ prompt: expect.stringContaining("英语基线诊断") }),
    ));
    expect(screen.queryByRole("button", { name: "开始今日练习" })).not.toBeInTheDocument();
  });

  it("uses the durable baseline flag after the baseline leaves the recent feed", async () => {
    render(
      <BridgeProvider client={new FixtureBridgeClient()} learning={learningClient({
        ...emptySnapshot,
        profile: {
          id: "english",
          goal: "能完成英文面试",
          focus: "career",
          dailyMinutes: 15,
          createdAt: 1,
          updatedAt: 1,
        },
        recentSessions: [],
        summary: { ...emptySnapshot.summary, completedSessions: 21, hasBaseline: true },
      })}>
        <EnglishLearningPage />
      </BridgeProvider>,
    );

    expect(await screen.findByRole("button", { name: "开始今日练习" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "完成基线诊断" })).not.toBeInTheDocument();
  });

  it("removes the empty conversation when the first diagnostic message is rejected", async () => {
    const user = userEvent.setup();
    const bridge = new FixtureBridgeClient();
    const originalInvoke = bridge.invoke.bind(bridge);
    const invoke = vi.spyOn(bridge, "invoke").mockImplementation(async (channel, request) => {
      if (channel === "bridge:send") throw new Error("模型服务暂时不可用");
      return originalInvoke(channel, request);
    });
    render(
      <BridgeProvider client={bridge} learning={learningClient()}>
        <EnglishLearningPage />
      </BridgeProvider>,
    );

    await user.type(await screen.findByLabelText("学习目标"), "能完成英文面试");
    await user.click(screen.getByRole("button", { name: "开始诊断" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("模型服务暂时不可用");
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "bridge:disposeConversation",
      expect.objectContaining({ conversationId: expect.any(String) }),
    ));
    expect(screen.queryByRole("button", { name: "开始一次英语基线诊断" })).not.toBeInTheDocument();
  });

  it("shows a retryable failure state instead of the setup form when the first read fails", async () => {
    const getSnapshot = vi.fn<LearningClient["getSnapshot"]>()
      .mockRejectedValueOnce(new Error("学习计划无法读取，原数据仍保留。"))
      .mockResolvedValueOnce(emptySnapshot);
    render(
      <BridgeProvider client={new FixtureBridgeClient()} learning={{
        getSnapshot,
        saveProfile: vi.fn(),
      }}>
        <EnglishLearningPage />
      </BridgeProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("学习计划无法读取");
    expect(screen.queryByLabelText("学习目标")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "重新读取" }));
    expect(await screen.findByLabelText("学习目标")).toBeInTheDocument();
  });
});
