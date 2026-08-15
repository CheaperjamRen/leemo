import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ArtifactEntry } from "../stores/artifacts";
import type { TimelineItem } from "../stores/message-model";
import { deriveWorkbenchOverview, WorkbenchOverview } from "./WorkbenchOverview";

describe("WorkbenchOverview", () => {
  it("derives plans, attention, collaborators, and artifacts from real scope data", () => {
    const timelines: Record<string, TimelineItem[]> = {
      active: [
        { kind: "plan", id: "p", runId: "r1", toolUseId: "plan", todos: [
          { text: "整理课程笔记", status: "done" },
          { text: "完成练习题", status: "active" },
        ] },
        { kind: "activity", id: "a", runId: "r1", parentToolUseId: "agent", status: "running", role: "调研助手", task: "核对参考资料", childToolUseIds: [], tools: [], transcript: [] },
      ],
      waiting: [],
    };
    const artifacts: ArtifactEntry[] = [{
      id: "out", kind: "file", path: "math/复习提纲.md", title: "复习提纲.md", bookId: "math",
      sourceConversationId: "active", sourceRunId: "r1", createdAt: 10, escaped: false,
    }];

    const model = deriveWorkbenchOverview({
      conversationIds: ["active", "waiting"],
      activeConversationId: "active",
      timelines,
      runIds: { active: "r1", waiting: null },
      pendingConversationIds: new Set(["waiting"]),
      artifacts,
    });

    expect(model).toMatchObject({ conversationCount: 2, runningCount: 1, attentionCount: 1, artifactCount: 1 });
    expect(model.todos.map((todo) => todo.text)).toEqual(["整理课程笔记", "完成练习题"]);
    expect(model.collaborators).toEqual([{ role: "调研助手", task: "核对参考资料", status: "running" }]);
  });

  it("renders a restrained empty state instead of invented progress", () => {
    render(<WorkbenchOverview model={{
      conversationCount: 0, runningCount: 0, attentionCount: 0, artifactCount: 0,
      todos: [], collaborators: [], recentArtifacts: [], overview: null,
    }} />);
    expect(screen.getByText("这里还没有可汇总的进展")).toBeInTheDocument();
    expect(screen.queryByText(/完成度/)).not.toBeInTheDocument();
  });

  it("does not call a completed, failed, interrupted, or restored run plan current", () => {
    const stalePlan: TimelineItem = {
      kind: "plan",
      id: "stale-plan",
      runId: "old-run",
      toolUseId: "todo",
      todos: [{ text: "旧轮计划", status: "active" }],
    };
    const model = deriveWorkbenchOverview({
      conversationIds: ["finished", "failed", "interrupted", "restored"],
      activeConversationId: "finished",
      timelines: {
        finished: [stalePlan, { kind: "result", id: "done", runId: "old-run", isError: false, interrupted: false, finalText: "done", pathAudit: { claimed: [] } }],
        failed: [{ ...stalePlan, id: "failed-plan" }, { kind: "result", id: "failed", runId: "old-run", isError: true, interrupted: false, finalText: "failed", pathAudit: { claimed: [] } }],
        interrupted: [{ ...stalePlan, id: "interrupted-plan" }, { kind: "result", id: "interrupted", runId: "old-run", isError: false, interrupted: true, finalText: "stopped", pathAudit: { claimed: [] } }],
        restored: [{ ...stalePlan, id: "restored-plan" }],
      },
      runIds: { finished: null, failed: null, interrupted: null, restored: null },
      pendingConversationIds: new Set(),
      artifacts: [],
    });

    expect(model.todos).toEqual([]);
  });

  it("prioritizes the newest persisted semantic overview in the current scope", () => {
    const model = deriveWorkbenchOverview({
      conversationIds: ["active", "other"],
      activeConversationId: "active",
      conversationTitles: { active: "旧标题", other: "另一段对话" },
      timelines: {
        active: [{
          kind: "overview", id: "old", runId: "r1", toolUseId: "o1", createdAt: 100,
          overview: { theme: "旧主题", summary: "旧概括" },
        }],
        other: [{
          kind: "overview", id: "new", runId: "r2", toolUseId: "o2", createdAt: 200,
          overview: {
            theme: "Leemo 内测准备",
            summary: "保持主链路完整并准备安装候选包",
            currentPosition: "正在补齐工作概览",
            nextStep: "完成打包验收",
            focus: "PDF 阅读准确性",
          },
        }],
      },
      runIds: { active: null, other: null },
      pendingConversationIds: new Set(),
      artifacts: [],
    });

    expect(model.overview).toMatchObject({
      source: "momo",
      theme: "Leemo 内测准备",
      summary: "保持主链路完整并准备安装候选包",
      currentPosition: "正在补齐工作概览",
      nextStep: "完成打包验收",
      focus: "PDF 阅读准确性",
    });

    render(<WorkbenchOverview model={model} />);
    expect(screen.getByText("Leemo 内测准备")).toBeInTheDocument();
    expect(screen.getByText("PDF 阅读准确性")).toBeInTheDocument();
  });

  it("does not mix a partial overview from another conversation with the active conversation", () => {
    const model = deriveWorkbenchOverview({
      conversationIds: ["active", "other"],
      activeConversationId: "active",
      conversationTitles: { active: "发布 Leemo 内测版", other: "PDF 阅读体验" },
      timelines: {
        active: [{ kind: "plan", id: "plan", runId: "live", toolUseId: "todo", todos: [
          { text: "生成安装包", status: "active" },
        ] }],
        other: [{
          kind: "overview", id: "focus", runId: "old", toolUseId: "overview", createdAt: 200,
          overview: { focus: "优先关注文字选择准确性" },
        }],
      },
      runIds: { active: "live", other: null },
      pendingConversationIds: new Set(),
      artifacts: [],
    });

    expect(model.overview).toEqual({
      source: "momo",
      theme: "PDF 阅读体验",
      focus: "优先关注文字选择准确性",
    });
    expect(model.overview).not.toMatchObject({
      theme: "发布 Leemo 内测版",
      currentPosition: "生成安装包",
    });
  });

  it("builds a truthful fallback from the real title and active plan without inventing completion", () => {
    const model = deriveWorkbenchOverview({
      conversationIds: ["active"],
      activeConversationId: "active",
      conversationTitles: { active: "发布 Leemo 内测版" },
      timelines: {
        active: [{ kind: "plan", id: "plan", runId: "live", toolUseId: "todo", todos: [
          { text: "补齐工作概览", status: "active" },
          { text: "生成安装包", status: "todo" },
        ] }],
      },
      runIds: { active: "live" },
      pendingConversationIds: new Set(),
      artifacts: [],
    });

    expect(model.overview).toEqual({
      source: "fallback",
      theme: "发布 Leemo 内测版",
      summary: "这段工作正在进行中。",
      currentPosition: "补齐工作概览",
      nextStep: "生成安装包",
    });
    expect(JSON.stringify(model)).not.toMatch(/完成度|%/u);
  });

  it("uses waiting, failure, and artifact evidence as fallback rather than a fabricated plan", () => {
    const artifacts: ArtifactEntry[] = [{
      id: "installer", kind: "file", path: "dist/Leemo.exe", title: "Leemo.exe", bookId: null,
      sourceConversationId: "failed", sourceRunId: "old", createdAt: 20, escaped: false,
    }];
    const waiting = deriveWorkbenchOverview({
      conversationIds: ["wait"], activeConversationId: "wait", conversationTitles: { wait: "整理简历" },
      timelines: { wait: [] }, runIds: { wait: null }, pendingConversationIds: new Set(["wait"]), artifacts: [],
    });
    expect(waiting.overview).toMatchObject({ currentPosition: "正在等你处理", nextStep: "处理后继续" });

    const failed = deriveWorkbenchOverview({
      conversationIds: ["failed"], activeConversationId: "failed", conversationTitles: { failed: "打包 Leemo" },
      timelines: { failed: [{ kind: "error", id: "error", runId: "old", message: "builder failed" }] },
      runIds: { failed: null }, pendingConversationIds: new Set(), artifacts,
    });
    expect(failed.overview).toMatchObject({
      theme: "打包 Leemo",
      currentPosition: "上次任务遇到问题",
      nextStep: "查看错误后决定是否重试",
    });
    expect(failed.recentArtifacts[0]?.title).toBe("Leemo.exe");
  });

  it("switches between the current notebook and conversation without mixing their real summaries", async () => {
    const user = userEvent.setup();
    const notebookModel = deriveWorkbenchOverview({
      conversationIds: ["active", "other"],
      activeConversationId: "active",
      conversationTitles: { active: "整理高数复习重点", other: "错题归纳" },
      timelines: {
        active: [{
          kind: "overview", id: "book-overview", runId: "r1", toolUseId: "overview", createdAt: 100,
          overview: { theme: "高等数学复习", summary: "正在把课程内容整理成三天复习计划。" },
        }],
        other: [{
          kind: "overview", id: "latest-book-overview", runId: "r2", toolUseId: "overview", createdAt: 200,
          overview: { theme: "本子复习主线", summary: "把错题和讲义汇总到同一份复习路线。" },
        }],
      },
      runIds: { active: null, other: null },
      pendingConversationIds: new Set(),
      artifacts: [],
    });
    const conversationModel = deriveWorkbenchOverview({
      conversationIds: ["active"],
      activeConversationId: "active",
      conversationTitles: { active: "整理高数复习重点" },
      timelines: {
        active: [{
          kind: "overview", id: "conversation-overview", runId: "r1", toolUseId: "overview", createdAt: 100,
          overview: { theme: "整理高数复习重点", summary: "只梳理这次对话里的三天复习计划。" },
        }],
      },
      runIds: { active: null },
      pendingConversationIds: new Set(),
      artifacts: [],
    });

    render(<WorkbenchOverview model={notebookModel} conversationModel={conversationModel} />);

    expect(screen.getByRole("button", { name: "当前本子" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("本子复习主线")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "本次会话" }));
    expect(screen.getByRole("button", { name: "本次会话" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("整理高数复习重点")).toBeInTheDocument();
    expect(screen.queryByText("本子复习主线")).not.toBeInTheDocument();
  });

  it("renders the approved overview hierarchy and keeps artifact and board actions real", async () => {
    const user = userEvent.setup();
    const onOpenArtifact = vi.fn();
    const onOpenBoard = vi.fn();
    const onOpenAttention = vi.fn();
    const artifact: ArtifactEntry = {
      id: "review", kind: "file", path: "高等数学/三天复习计划.md", title: "高等数学三天复习计划.md",
      bookId: "高等数学", sourceConversationId: "active", sourceRunId: "r1", createdAt: 1_723_000_000_000,
      escaped: false,
    };
    const model = deriveWorkbenchOverview({
      conversationIds: ["active", "waiting"],
      activeConversationId: "active",
      conversationTitles: { active: "整理高数复习重点", waiting: "第 4 章材料补缺" },
      pendingSummaries: { waiting: "第 4 章资料缺失，是否先按现有内容继续？" },
      timelines: {
        active: [
          {
            kind: "overview", id: "overview", runId: "r1", toolUseId: "overview", createdAt: 100,
            overview: {
              theme: "高等数学期末复习",
              summary: "围绕课程内容整理一套可执行的三天计划。",
              focus: "完成三天复习计划与章节覆盖检查",
              currentPosition: "正在归纳高频错题",
              nextStep: "补齐例题证据",
            },
          },
          {
            kind: "plan", id: "plan", runId: "r1", toolUseId: "plan",
            todos: [
              { text: "整理复习资料", status: "done" },
              { text: "归纳高频错题", status: "active" },
            ],
          },
          {
            kind: "activity", id: "agent", runId: "r1", parentToolUseId: "agent", status: "running",
            role: "核对助手", task: "核对例题", childToolUseIds: [], tools: [], transcript: [],
          },
        ],
        waiting: [],
      },
      runIds: { active: "r1", waiting: null },
      pendingConversationIds: new Set(["waiting"]),
      artifacts: [artifact],
    });

    render(
      <WorkbenchOverview
        model={model}
        onOpenAttention={onOpenAttention}
        onOpenArtifact={onOpenArtifact}
        onOpenBoard={onOpenBoard}
      />,
    );

    expect(screen.getByRole("heading", { name: "这个本子在做什么" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "当前重点" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "需要你处理 · 1" })).toBeInTheDocument();
    expect(screen.getByText("第 4 章资料缺失，是否先按现有内容继续？")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "进行中" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "最近成果" })).toBeInTheDocument();
    expect(screen.getByLabelText("范围状态")).toHaveTextContent(/1 项进行中.*1 项待回答.*1 个新成果/u);

    await user.click(screen.getByRole("button", { name: "打开待处理 第 4 章资料缺失，是否先按现有内容继续？" }));
    expect(onOpenAttention).toHaveBeenCalledWith("waiting");
    await user.click(screen.getByRole("button", { name: /打开成果 高等数学三天复习计划\.md/ }));
    expect(onOpenArtifact).toHaveBeenCalledWith(artifact);
    await user.click(screen.getByRole("button", { name: "打开完整看板" }));
    expect(onOpenBoard).toHaveBeenCalledTimes(1);
  });
});
