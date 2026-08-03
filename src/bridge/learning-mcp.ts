import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type {
  LearningFocus,
  LearningReviewRating,
  LearningService,
  LearningSkill,
} from "../learning";
import { LEARNING_FOCUS_LABELS } from "../learning";

const SERVER = "leemo-learning";
const TOOL_NAMES = {
  getPlan: "get_plan",
  savePlan: "save_plan",
  recordMistake: "record_mistake",
  rateReview: "rate_review",
  recordSession: "record_session",
} as const;

export const LEEMO_LEARNING_TOOL_NAMES = {
  getPlan: `mcp__${SERVER}__${TOOL_NAMES.getPlan}`,
  savePlan: `mcp__${SERVER}__${TOOL_NAMES.savePlan}`,
  recordMistake: `mcp__${SERVER}__${TOOL_NAMES.recordMistake}`,
  rateReview: `mcp__${SERVER}__${TOOL_NAMES.rateReview}`,
  recordSession: `mcp__${SERVER}__${TOOL_NAMES.recordSession}`,
} as const;

export interface LearningMcpResult {
  text: string;
  isError: boolean;
  itemId?: string;
}

export interface LearningMcpOptions {
  service: LearningService;
  conversationId: string;
}

export interface LearningMcp {
  server: McpSdkServerConfigWithInstance;
  runGetPlan(input: Record<string, never>): Promise<LearningMcpResult>;
  runSavePlan(input: { goal: string; focus: LearningFocus; dailyMinutes: number }): Promise<LearningMcpResult>;
  runRecordMistake(input: {
    skill: LearningSkill;
    cue: string;
    userAnswer?: string;
    correction: string;
    explanation?: string;
  }): Promise<LearningMcpResult>;
  runRateReview(input: { itemId: string; rating: LearningReviewRating; userAnswer?: string }): Promise<LearningMcpResult>;
  runRecordSession(input: {
    kind: "baseline" | "practice" | "check";
    skill: LearningSkill;
    assessmentKey?: string;
    correct: number;
    total: number;
    summary: string;
  }): Promise<LearningMcpResult>;
}

function errorResult(error: unknown): LearningMcpResult {
  const message = error instanceof Error ? error.message : String(error);
  return { text: `英语学习记录没有更新：${message}`, isError: true };
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(timestamp));
}

export function createLearningMcp(options: LearningMcpOptions): LearningMcp {
  const runGetPlan: LearningMcp["runGetPlan"] = async () => {
    try {
      const snapshot = options.service.getSnapshot();
      const lines = [
        snapshot.profile
          ? `当前目标：${snapshot.profile.goal}（重点：${LEARNING_FOCUS_LABELS[snapshot.profile.focus]}；每天约 ${snapshot.profile.dailyMinutes} 分钟）`
          : "还没有建立英语学习目标，先做一次短诊断。",
      ];
      if (snapshot.dueItems.length === 0) {
        lines.push("暂时没有到期复习。");
      } else {
        lines.push(`到期复习 ${snapshot.dueItems.length} 条：`);
        for (const item of snapshot.dueItems.slice(0, 20)) {
          // Do not reveal correction/explanation before active recall.
          lines.push(`- [${item.id}] ${item.cue}`);
        }
      }
      if (snapshot.baselines.length > 0) {
        lines.push("可复测基线：");
        for (const baseline of snapshot.baselines.slice(0, 10)) {
          lines.push(`- ${baseline.skill} / ${baseline.assessmentKey} / ${baseline.total} 题 / ${baseline.score} 分：${baseline.summary}`);
        }
      }
      if (snapshot.evidence.length > 0) {
        lines.push("进步证据：");
        for (const evidence of snapshot.evidence.slice(0, 5)) {
          lines.push(`- ${evidence.skill}: ${evidence.baselineScore} -> ${evidence.latestScore} (${evidence.delta >= 0 ? "+" : ""}${evidence.delta})`);
        }
      }
      return { text: lines.join("\n"), isError: false };
    } catch (error) {
      return errorResult(error);
    }
  };

  const runSavePlan: LearningMcp["runSavePlan"] = async (input) => {
    try {
      const profile = options.service.saveProfile(input);
      return {
        text: `英语目标已更新：${profile.goal} · ${LEARNING_FOCUS_LABELS[profile.focus]} · 每天约 ${profile.dailyMinutes} 分钟。`,
        isError: false,
      };
    } catch (error) {
      return errorResult(error);
    }
  };

  const runRecordMistake: LearningMcp["runRecordMistake"] = async (input) => {
    try {
      const item = options.service.recordMistake({
        ...input,
        sourceConversationId: options.conversationId,
      });
      return {
        text: `已放进复习队列：${item.cue}（${formatDate(item.dueAt)} 再练）。`,
        isError: false,
        itemId: item.id,
      };
    } catch (error) {
      return errorResult(error);
    }
  };

  const runRateReview: LearningMcp["runRateReview"] = async (input) => {
    try {
      const item = options.service.rateReview(input);
      return { text: `已记录本次掌握情况；下次复习 ${formatDate(item.dueAt)}。`, isError: false, itemId: item.id };
    } catch (error) {
      return errorResult(error);
    }
  };

  const runRecordSession: LearningMcp["runRecordSession"] = async (input) => {
    try {
      const session = options.service.recordSession({ ...input, conversationId: options.conversationId });
      return { text: `本次练习已记录：${session.score} 分。`, isError: false };
    } catch (error) {
      return errorResult(error);
    }
  };

  const focus = z.enum(["general", "academic", "career", "conversation"]);
  const skill = z.enum(["vocabulary", "grammar", "reading", "writing", "conversation"]);
  const rating = z.enum(["again", "hard", "good", "easy"]);
  const result = (value: LearningMcpResult) => ({
    content: [{ type: "text", text: value.text }],
    isError: value.isError,
  }) as never;

  const server = createSdkMcpServer({
    name: SERVER,
    version: "1.0.0",
    tools: [
      tool(
        TOOL_NAMES.getPlan,
        "Read the user's local English-learning goal, due review cues, reusable baseline identities, and comparable progress evidence. Use before planning or running an English session.",
        {},
        async () => result(await runGetPlan({})),
      ),
      tool(
        TOOL_NAMES.savePlan,
        "Create or update the user's explicit English-learning goal after they state or confirm it.",
        {
          goal: z.string().min(1).max(240),
          focus,
          dailyMinutes: z.number().int().min(5).max(90),
        },
        async (args) => result(await runSavePlan(args as Parameters<typeof runSavePlan>[0])),
      ),
      tool(
        TOOL_NAMES.recordMistake,
        "Add one concrete learner error to the spaced-review queue after correction. Store a self-contained cue and answer, not an entire chat transcript.",
        {
          skill,
          cue: z.string().min(1).max(800),
          userAnswer: z.string().max(1_500).optional(),
          correction: z.string().min(1).max(1_500),
          explanation: z.string().max(1_500).optional(),
        },
        async (args) => result(await runRecordMistake(args as Parameters<typeof runRecordMistake>[0])),
      ),
      tool(
        TOOL_NAMES.rateReview,
        "Rate an attempted due review only after the user answers. again means failed recall; good means correct independent recall.",
        {
          itemId: z.string().min(1).max(200),
          rating,
          userAnswer: z.string().max(1_500).optional(),
        },
        async (args) => result(await runRateReview(args as Parameters<typeof runRateReview>[0])),
      ),
      tool(
        TOOL_NAMES.recordSession,
        "Record a scored English baseline, practice, or same-form check. Baseline and check require the same stable assessmentKey; never compare different tasks.",
        {
          kind: z.enum(["baseline", "practice", "check"]),
          skill,
          assessmentKey: z.string().min(1).max(120).optional(),
          correct: z.number().int().min(0),
          total: z.number().int().min(1),
          summary: z.string().min(1).max(1_000),
        },
        async (args) => result(await runRecordSession(args as Parameters<typeof runRecordSession>[0])),
      ),
    ],
  });

  return { server, runGetPlan, runSavePlan, runRecordMistake, runRateReview, runRecordSession };
}
