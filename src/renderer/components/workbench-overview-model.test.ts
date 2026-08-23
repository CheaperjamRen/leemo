import { describe, expect, it } from "vitest";
import type { WorkOverviewSnapshot } from "../../bridge/work-overview";
import type { PendingInteraction, ResolvedInteraction } from "../stores/approvals";
import type { ArtifactEntry } from "../stores/artifacts";
import type { TimelineItem } from "../stores/message-model";
import {
  deriveConversationContinuity,
  deriveNotebookContinuity,
} from "./workbench-overview-model";

const question = (overrides: Partial<Extract<PendingInteraction, { kind: "question" }>> = {}): Extract<PendingInteraction, { kind: "question" }> => ({
  kind: "question",
  id: "question-pending",
  conversationId: "conversation-main",
  runId: "run-current",
  questions: [{ question: "是否保留核验日志？", options: [{ label: "保留" }, { label: "删除" }] }],
  receivedAt: 290,
  ...overrides,
});

const approval = (overrides: Partial<Extract<PendingInteraction, { kind: "approval" }>> = {}): Extract<PendingInteraction, { kind: "approval" }> => ({
  kind: "approval",
  id: "approval-pending",
  conversationId: "conversation-blocked",
  runId: "run-blocked",
  toolName: "Write",
  inputSummary: "写入发布记录",
  risk: "moderate",
  receivedAt: 500,
  ...overrides,
});

const artifact = (
  id: string,
  conversationId: string,
  runId: string,
  createdAt: number,
  title = `${id}.md`,
): ArtifactEntry => ({
  id,
  kind: "file",
  path: `results/${title}`,
  title,
  bookId: "book-continuity",
  sourceConversationId: conversationId,
  sourceRunId: runId,
  createdAt,
  escaped: false,
});

const semanticOverview = (
  conversationId: string,
  runId: string,
  updatedAt: number,
  overrides: Partial<WorkOverviewSnapshot> = {},
): WorkOverviewSnapshot => ({
  revision: 2,
  scopeConversationId: conversationId,
  sourceRunId: runId,
  sourceToolUseId: `overview-${conversationId}`,
  updatedAt,
  updateReason: "phase-changed",
  basisEventIds: [runId, `overview-${conversationId}`],
  actor: "momo",
  objective: `目标-${conversationId}`,
  objectiveSource: "semantic",
  successCriteria: [],
  currentPhase: `阶段-${conversationId}`,
  currentFocus: `重点-${conversationId}`,
  nextKnown: [],
  blockers: [],
  decisions: [],
  completedHighlights: [],
  fieldAuthority: { objective: "momo" },
  ...overrides,
});

describe("deriveConversationContinuity", () => {
  it("answers the recovery questions from semantic anchors and real run-scoped evidence", () => {
    const timeline: TimelineItem[] = [
      { kind: "text", id: "user-1", runId: "run-recovered", role: "user", text: "整理连续性概览。", streaming: false, createdAt: 100 },
      { kind: "text", id: "user-2", runId: "run-recovered", role: "user", text: "先核对目标来源。", streaming: false, createdAt: 110 },
      { kind: "plan", id: "plan-old", runId: "run-recovered", toolUseId: "plan-old-tool", todos: [
        { text: "核对目标来源", status: "done", taskId: "task-old-done" },
        { text: "验证恢复", status: "active", taskId: "task-old-active" },
      ] },
      {
        kind: "retry",
        id: "retry-1",
        runId: "run-recovered",
        attempt: 2,
        maxAttempts: 3,
        summary: "连接已恢复",
        detail: "第一次连接失败，重试后恢复",
        state: "recovered",
      },
      {
        kind: "result",
        id: "result-recovered",
        runId: "run-recovered",
        isError: false,
        interrupted: false,
        finalText: "恢复链路核验结束。",
        pathAudit: { claimed: [] },
        createdAt: 150,
      },
      { kind: "text", id: "user-3", runId: "run-current", role: "user", text: "继续核对当前计划。", streaming: false, createdAt: 200 },
      { kind: "text", id: "user-4", runId: "run-current", role: "user", text: "保留三个成果入口。", streaming: false, createdAt: 210 },
      { kind: "text", id: "user-5", runId: "run-current", role: "user", text: "最后等我确认日志。", streaming: false, createdAt: 220 },
      { kind: "plan", id: "plan-current-v1", runId: "run-current", toolUseId: "plan-current-v1-tool", todos: [
        { text: "核对恢复链路", status: "done", taskId: "task-current-1" },
        { text: "生成核验记录", status: "active", taskId: "task-current-2" },
        { text: "等待用户确认", status: "todo", taskId: "task-current-3" },
      ] },
      { kind: "plan", id: "plan-current-v2", runId: "run-current", toolUseId: "plan-current-v2-tool", todos: [
        { text: "核对恢复链路", status: "done", taskId: "task-current-1" },
        { text: "生成核验记录", status: "done", taskId: "task-current-2" },
        { text: "确认日志保留方式", status: "active", taskId: "task-current-3" },
        { text: "完成最终交接", status: "todo", taskId: "task-current-4" },
      ] },
      {
        kind: "tool",
        id: "write-timeline",
        runId: "run-current",
        toolUseId: "write-record",
        name: "Write",
        input: { file_path: "results/evidence.md" },
        status: "ok",
        summary: "已写入核验记录",
        createdAt: 250,
      },
      {
        kind: "files",
        id: "files-record",
        runId: "run-current",
        changes: [{ path: "results/evidence.md", change: "added" }],
        omitted: 0,
      },
      {
        kind: "text",
        id: "assistant-only-message",
        runId: "run-current",
        role: "momo",
        text: "assistant only：全部已经完成。",
        streaming: false,
        createdAt: 260,
      },
      {
        kind: "overview",
        id: "overview-current",
        runId: "run-current",
        toolUseId: "overview-current-tool",
        createdAt: 280,
        overview: semanticOverview("conversation-main", "run-current", 280, {
          objective: "完成连续性概览并保留可复现证据",
          successCriteria: ["七个恢复问题都有真源答案", "三个成果都能回到当前对话"],
          currentPhase: "真实性与恢复核验",
          currentFocus: "等待用户确认日志保留方式",
          nextKnown: ["完成最终交接"],
          blockers: ["日志保留方式尚未确认"],
          completedHighlights: [
            { evidenceId: "recovery-fact", text: "失败后恢复链路已核验", basisEventIds: ["result-recovered", "run-recovered"] },
            { evidenceId: "write-fact", text: "核验记录已写入", basisEventIds: ["write-record", "files-record"] },
            { evidenceId: "artifact-fact", text: "证据清单已保存", basisEventIds: ["artifact-evidence"] },
            { evidenceId: "confirmed-fact", text: "用户已确认保留恢复记录", basisEventIds: ["question-confirmed"] },
            { evidenceId: "assistant-claim", text: "assistant only：全部已经完成", basisEventIds: ["assistant-only-message"] },
          ],
        }),
      },
    ];
    const artifacts = [
      artifact("artifact-evidence", "conversation-main", "run-current", 275, "evidence.md"),
      artifact("artifact-report", "conversation-main", "run-current", 274, "report.md"),
      artifact("artifact-log", "conversation-main", "run-current", 273, "restart.log"),
    ];
    const resolvedInteractions: ResolvedInteraction[] = [{
      kind: "question",
      id: "question-confirmed",
      runId: "run-recovered",
      questions: [{ question: "是否保留恢复记录？", options: [{ label: "保留" }] }],
      items: [{ selected: ["保留"] }],
    }];

    const snapshot = deriveConversationContinuity({
      conversationId: "conversation-main",
      title: "连续性概览",
      timeline,
      activeRunId: "run-current",
      pending: { interaction: question(), summary: "确认是否保留核验日志" },
      resolvedInteractions,
      artifacts,
    });

    expect(snapshot.objective).toEqual({ text: "完成连续性概览并保留可复现证据", source: "semantic" });
    expect(snapshot.successCriteria).toEqual(["七个恢复问题都有真源答案", "三个成果都能回到当前对话"]);
    expect(snapshot.currentPhase).toBe("真实性与恢复核验");
    expect(snapshot.currentFocus).toBe("等待用户确认日志保留方式");
    expect(snapshot.currentPlan).toEqual({
      runId: "run-current",
      steps: [
        { text: "核对恢复链路", status: "done" },
        { text: "生成核验记录", status: "done" },
        { text: "确认日志保留方式", status: "active" },
        { text: "完成最终交接", status: "todo" },
      ],
      done: 2,
      total: 4,
      current: true,
    });
    expect(snapshot.nextKnown).toEqual([{ text: "完成最终交接", certainty: "known" }]);
    expect(snapshot.blockers).toEqual([
      { text: "日志保留方式尚未确认", kind: "semantic" },
      { text: "确认是否保留核验日志", kind: "waiting" },
    ]);
    expect(snapshot.completed).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidenceId: "recovery-fact", text: "失败后恢复链路已核验" }),
      expect.objectContaining({ evidenceId: "write-fact", text: "核验记录已写入" }),
      expect.objectContaining({ evidenceId: "artifact-fact", text: "证据清单已保存" }),
      expect.objectContaining({ evidenceId: "confirmed-fact", text: "用户已确认保留恢复记录" }),
      expect.objectContaining({ evidenceId: "task-current-1", text: "核对恢复链路" }),
      expect.objectContaining({ evidenceId: "task-current-2", text: "生成核验记录" }),
    ]));
    expect(snapshot.completed).not.toContainEqual(
      expect.objectContaining({ text: expect.stringContaining("assistant only") }),
    );
    expect(snapshot.artifacts.map(({ id, sourceConversationId }) => ({ id, sourceConversationId }))).toEqual([
      { id: "artifact-evidence", sourceConversationId: "conversation-main" },
      { id: "artifact-report", sourceConversationId: "conversation-main" },
      { id: "artifact-log", sourceConversationId: "conversation-main" },
    ]);
    expect(snapshot.updatedAt).toBe(290);
    expect("overallPercent" in snapshot).toBe(false);
    expect("userTaskMutations" in snapshot).toBe(false);
  });

  it("uses a scoped legacy title without treating assistant prose as completion", () => {
    const snapshot = deriveConversationContinuity({
      conversationId: "legacy-conversation",
      title: "会话标题不应覆盖旧主题",
      timeline: [
        {
          kind: "overview",
          id: "legacy-overview",
          runId: "run-legacy",
          toolUseId: "legacy-tool",
          createdAt: 100,
          overview: { theme: "旧版连续性主题", summary: "旧版概览" },
        },
        { kind: "text", id: "assistant-claim", runId: "run-legacy", role: "momo", text: "已经交付。", streaming: false, createdAt: 110 },
      ],
      activeRunId: null,
      artifacts: [],
    });

    expect(snapshot.objective).toEqual({ text: "旧版连续性主题", source: "legacy-title" });
    expect(snapshot.completed).toEqual([]);
  });

  it("ignores pending summaries and artifacts owned by another conversation", () => {
    const snapshot = deriveConversationContinuity({
      conversationId: "conversation-local",
      title: "本地对话",
      timeline: [
        { kind: "text", id: "local-user", runId: "run-local", role: "user", text: "继续本地工作。", streaming: false, createdAt: 100 },
      ],
      activeRunId: null,
      pending: {
        interaction: question({ conversationId: "conversation-foreign", runId: "run-foreign", receivedAt: 500 }),
        summary: "另一条对话正在等用户回答",
      },
      artifacts: [artifact("foreign-artifact", "conversation-foreign", "run-foreign", 600)],
    });

    expect(snapshot.state).toBe("recent");
    expect(snapshot.blockers).toEqual([]);
    expect(snapshot.artifacts).toEqual([]);
    expect(snapshot.updatedAt).toBe(100);
  });
});

describe("deriveNotebookContinuity", () => {
  it("keeps five source-linked rows ordered by attention, running state, and meaningful recency", () => {
    const waitingTimeline: TimelineItem[] = [
      { kind: "text", id: "wait-user", runId: "run-wait", role: "user", text: "等我选择导出格式。", streaming: false, createdAt: 580 },
      { kind: "overview", id: "wait-overview", runId: "run-wait", toolUseId: "wait-semantic", createdAt: 590, overview: semanticOverview("conversation-waiting", "run-wait", 590) },
    ];
    const blockedTimeline: TimelineItem[] = [
      { kind: "text", id: "blocked-user", runId: "run-blocked", role: "user", text: "写入发布记录。", streaming: false, createdAt: 480 },
      { kind: "overview", id: "blocked-overview", runId: "run-blocked", toolUseId: "blocked-semantic", createdAt: 490, overview: semanticOverview("conversation-blocked", "run-blocked", 490) },
    ];
    const runningTimeline: TimelineItem[] = [
      { kind: "text", id: "running-user", runId: "run-running", role: "user", text: "继续打包。", streaming: false, createdAt: 980 },
      { kind: "overview", id: "running-overview", runId: "run-running", toolUseId: "running-semantic", createdAt: 990, overview: semanticOverview("conversation-running", "run-running", 990) },
      { kind: "plan", id: "running-plan", runId: "run-running", toolUseId: "running-plan-tool", todos: [{ text: "构建安装包", status: "active", taskId: "task-running" }] },
    ];
    const terminalTimeline: TimelineItem[] = [
      { kind: "text", id: "terminal-user", runId: "run-terminal", role: "user", text: "完成旧轮核验。", streaming: false, createdAt: 880 },
      { kind: "overview", id: "terminal-overview", runId: "run-terminal", toolUseId: "terminal-semantic", createdAt: 890, overview: semanticOverview("conversation-terminal", "run-terminal", 890) },
      { kind: "plan", id: "terminal-plan", runId: "run-terminal", toolUseId: "terminal-plan-tool", todos: [
        { text: "旧轮已核验", status: "done", taskId: "task-terminal-done" },
        { text: "旧轮未做步骤", status: "todo", taskId: "task-terminal-todo" },
      ] },
      { kind: "result", id: "terminal-result", runId: "run-terminal", isError: false, interrupted: false, finalText: "旧轮结束。", pathAudit: { claimed: [] }, createdAt: 900 },
    ];
    const artifactTimeline: TimelineItem[] = [
      { kind: "text", id: "artifact-user", runId: "run-artifact", role: "user", text: "保留结果。", streaming: false, createdAt: 780 },
      { kind: "overview", id: "artifact-overview", runId: "run-artifact", toolUseId: "artifact-semantic", createdAt: 790, overview: semanticOverview("conversation-artifact", "run-artifact", 790) },
    ];
    const oldTimeline: TimelineItem[] = [
      { kind: "text", id: "old-user", runId: "run-old", role: "user", text: "很早以前的工作。", streaming: false, createdAt: 100 },
      { kind: "overview", id: "old-overview", runId: "run-old", toolUseId: "old-semantic", createdAt: 110, overview: semanticOverview("conversation-old", "run-old", 110) },
    ];

    const notebook = deriveNotebookContinuity({
      conversations: [
        {
          conversationId: "conversation-old",
          title: "很早以前",
          timeline: oldTimeline,
          activeRunId: null,
          artifacts: [],
        },
        {
          conversationId: "conversation-artifact",
          title: "成果整理",
          timeline: artifactTimeline,
          activeRunId: null,
          artifacts: [artifact("artifact-own", "conversation-artifact", "run-artifact", 800)],
        },
        {
          conversationId: "conversation-terminal",
          title: "旧轮核验",
          timeline: terminalTimeline,
          activeRunId: null,
          artifacts: [],
        },
        {
          conversationId: "conversation-running",
          title: "安装包构建",
          timeline: runningTimeline,
          activeRunId: "run-running",
          artifacts: [],
        },
        {
          conversationId: "conversation-blocked",
          title: "发布记录",
          timeline: blockedTimeline,
          activeRunId: null,
          pending: { interaction: approval(), summary: "确认写入发布记录" },
          artifacts: [],
        },
        {
          conversationId: "conversation-waiting",
          title: "导出格式",
          timeline: waitingTimeline,
          activeRunId: null,
          pending: {
            interaction: question({ conversationId: "conversation-waiting", runId: "run-wait", receivedAt: 600 }),
            summary: "选择导出格式",
          },
          artifacts: [],
        },
      ],
    });

    expect(notebook.conversations).toHaveLength(5);
    expect(notebook.conversations.map(({ conversationId, title, state }) => ({ conversationId, title, state }))).toEqual([
      { conversationId: "conversation-waiting", title: "导出格式", state: "waiting" },
      { conversationId: "conversation-blocked", title: "发布记录", state: "blocked" },
      { conversationId: "conversation-running", title: "安装包构建", state: "running" },
      { conversationId: "conversation-terminal", title: "旧轮核验", state: "recent" },
      { conversationId: "conversation-artifact", title: "成果整理", state: "recent" },
    ]);
    expect(notebook.conversations.map((row) => row.objective?.text)).toEqual([
      "目标-conversation-waiting",
      "目标-conversation-blocked",
      "目标-conversation-running",
      "目标-conversation-terminal",
      "目标-conversation-artifact",
    ]);
    const terminal = notebook.conversations.find((row) => row.conversationId === "conversation-terminal");
    expect(terminal?.currentPlan?.current ?? false).toBe(false);
    expect(terminal?.completed).toContainEqual({
      evidenceId: "task-terminal-done",
      text: "旧轮已核验",
      basisEventIds: ["task-terminal-done"],
    });
    const artifactRow = notebook.conversations.find((row) => row.conversationId === "conversation-artifact");
    expect(artifactRow?.artifacts).toEqual([
      expect.objectContaining({ id: "artifact-own", sourceConversationId: "conversation-artifact" }),
    ]);
    expect(notebook.conversations.some((row) => row.conversationId === "conversation-old")).toBe(false);
  });
});
