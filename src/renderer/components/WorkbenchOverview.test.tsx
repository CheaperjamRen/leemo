import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ArtifactEntry } from "../stores/artifacts";
import type { ConversationContinuitySnapshot, NotebookContinuitySnapshot } from "./workbench-overview-model";
import { WorkbenchOverview } from "./WorkbenchOverview";

function artifact(id: string, title: string, conversationId = "conversation-main"): ArtifactEntry {
  return { id, kind: "file", path: `results/${title}`, title, bookId: "notebook", sourceConversationId: conversationId, sourceRunId: "run-main", createdAt: 1_723_000_000_000, escaped: false };
}

function conversation(overrides: Partial<ConversationContinuitySnapshot> = {}): ConversationContinuitySnapshot {
  return {
    conversationId: "conversation-main", title: "连续性概览验收", state: "running",
    objective: { text: "完成连续性概览并保留可复现证据", source: "semantic" },
    successCriteria: ["七个恢复问题都有真源答案", "成果可以回到当前对话"],
    currentPhase: "真实性与恢复核验", currentFocus: "确认日志保留方式",
    currentPlan: { runId: "run-main", done: 2, total: 4, current: true, steps: [
      { text: "核对恢复链路", status: "done" }, { text: "生成核验记录", status: "done" },
      { text: "确认日志保留方式", status: "active" }, { text: "完成最终交接", status: "todo" },
    ] },
    nextKnown: [
      { text: "完成最终交接", certainty: "known" },
      { text: "可能需要补充重启截图", certainty: "possible" },
    ],
    blockers: [{ text: "日志保留方式尚未确认", kind: "waiting" }],
    completed: [
      { evidenceId: "recovery", text: "失败后恢复链路已核验", basisEventIds: ["result-recovery"] },
      { evidenceId: "record", text: "核验记录已写入", basisEventIds: ["write-record"] },
    ],
    artifacts: [artifact("evidence", "evidence.md"), artifact("report", "report.md")],
    updatedAt: 1_723_000_000_000, ...overrides,
  };
}

function notebook(rows: ConversationContinuitySnapshot[] = []): NotebookContinuitySnapshot {
  return { conversations: rows };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("WorkbenchOverview", () => {
  it("renders the seven recovery sections in order without dashboard metrics or invented percentages", () => {
    render(<WorkbenchOverview model={notebook([conversation()])} conversationModel={notebook([conversation()])} />);
    const names = ["工作目标", "当前阶段与当前重点", "本轮执行", "接下来", "阻塞或待决定", "已完成", "相关成果"];
    const headings = names.map((name) => screen.getByRole("heading", { name }));
    for (let index = 1; index < headings.length; index += 1) {
      expect(headings[index - 1].compareDocumentPosition(headings[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.getByText("完成连续性概览并保留可复现证据")).toBeInTheDocument();
    expect(screen.getByText("真实性与恢复核验")).toBeInTheDocument();
    expect(screen.getAllByText("确认日志保留方式")).toHaveLength(2);
    expect(screen.getByText("已完成 2/4 个已知步骤")).toBeInTheDocument();
    expect(screen.getByText("可能需要补充重启截图")).toHaveTextContent(/^可能需要/u);
    expect(screen.getByText("日志保留方式尚未确认")).toBeInTheDocument();
    expect(screen.getByText("失败后恢复链路已核验")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开成果 evidence.md" })).toBeInTheDocument();
    expect(screen.queryByText(/项进行中|项待回答|个新成果|完成度|50%/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("uses the active conversation as the default scope and switches locally without requesting a refresh", async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();
    const active = conversation();
    const other = conversation({ conversationId: "conversation-other", title: "安装包验收", objective: { text: "完成安装包重启验收", source: "semantic" }, state: "recent", currentPlan: undefined });
    render(<WorkbenchOverview model={notebook([active, other])} conversationModel={notebook([active])} onRequestRefresh={refresh} />);
    expect(screen.getByRole("button", { name: "本次会话" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("完成连续性概览并保留可复现证据")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "当前本子" }));
    expect(screen.getByRole("button", { name: "当前本子" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /打开会话 安装包验收/u })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("defaults to the range when there is no active conversation and keeps source rows separate and bounded", async () => {
    const user = userEvent.setup();
    const openConversation = vi.fn();
    const rows = Array.from({ length: 6 }, (_, index) => conversation({
      conversationId: `conversation-${index + 1}`, title: `来源会话 ${index + 1}`, state: index === 0 ? "blocked" : "recent",
      objective: { text: `目标 ${index + 1}`, source: "semantic" }, currentPhase: `阶段 ${index + 1}`, currentFocus: undefined,
      currentPlan: undefined, nextKnown: [{ text: `下一步 ${index + 1}`, certainty: "known" }],
      blockers: index === 0 ? [{ text: "等待确认", kind: "waiting" }] : [], completed: [], artifacts: [],
    }));
    render(<WorkbenchOverview model={notebook(rows)} notebookScopeLabel="当前范围" onOpenConversation={openConversation} />);
    expect(screen.getByRole("button", { name: "当前范围" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button", { name: /打开会话 来源会话/u })).toHaveLength(5);
    expect(screen.queryByText("来源会话 6")).not.toBeInTheDocument();
    expect(screen.getByText("阶段 1")).toBeInTheDocument();
    expect(screen.getByText("下一步 1")).toBeInTheDocument();
    expect(screen.getByText("等待确认")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "打开会话 来源会话 2" }));
    expect(openConversation).toHaveBeenCalledWith("conversation-2");
  });

  it("opens artifacts through the exact source callback", async () => {
    const user = userEvent.setup();
    const openArtifact = vi.fn();
    const target = artifact("target", "restart-proof.md");
    const active = conversation({ artifacts: [target] });
    render(<WorkbenchOverview model={notebook([active])} conversationModel={notebook([active])} onOpenArtifact={openArtifact} />);
    await user.click(screen.getByRole("button", { name: "打开成果 restart-proof.md" }));
    expect(openArtifact).toHaveBeenCalledWith(target);
  });

  it("keeps refresh in a low-emphasis menu, disables it during a run, and reports status in one quiet line", async () => {
    const user = userEvent.setup();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<WorkbenchOverview model={notebook([conversation()])} conversationModel={notebook([conversation()])} onRequestRefresh={refresh} />);
    expect(screen.queryByRole("button", { name: "更新概览" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "概览操作" }));
    expect(screen.getByRole("button", { name: "更新概览" })).toBeDisabled();
    const idle = conversation({ state: "recent", currentPlan: undefined });
    rerender(<WorkbenchOverview model={notebook([idle])} conversationModel={notebook([idle])} onRequestRefresh={refresh} />);
    await user.click(screen.getByRole("button", { name: "更新概览" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status")).toHaveTextContent("概览已更新");
    expect(screen.getByRole("status")).toHaveClass("text-xs");
  });

  it("shows refresh errors as the same quiet status line rather than a card", async () => {
    const user = userEvent.setup();
    const idle = conversation({ state: "recent", currentPlan: undefined });
    render(<WorkbenchOverview model={notebook([idle])} conversationModel={notebook([idle])} onRequestRefresh={vi.fn().mockRejectedValue(new Error("网络暂时不可用"))} />);
    await user.click(screen.getByRole("button", { name: "概览操作" }));
    await user.click(screen.getByRole("button", { name: "更新概览" }));
    expect(await screen.findByRole("status")).toHaveTextContent("网络暂时不可用");
    expect(screen.getByRole("status").closest("section")).toBeNull();
  });

  it("edits only the local objective and success criteria and marks the saved anchor as user-fixed", async () => {
    const user = userEvent.setup();
    const saveCorrection = vi.fn().mockResolvedValue(undefined);
    const active = conversation({ state: "recent", currentPlan: undefined });
    render(<WorkbenchOverview model={notebook([active])} conversationModel={notebook([active])} onSaveCorrection={saveCorrection} onRequestRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "概览操作" }));
    await user.click(screen.getByRole("button", { name: "编辑工作目标" }));
    const form = screen.getByRole("form", { name: "编辑工作目标" });
    const objective = within(form).getByLabelText("工作目标");
    const criteria = within(form).getByLabelText("完成标准");
    await user.clear(objective); await user.type(objective, "交付可恢复的连续性概览");
    await user.clear(criteria); await user.type(criteria, "七个问题都能回答\n成果可以直接打开");
    await user.click(within(form).getByRole("button", { name: "保存" }));
    expect(saveCorrection).toHaveBeenCalledWith({ objective: "交付可恢复的连续性概览", successCriteria: ["七个问题都能回答", "成果可以直接打开"] });
    expect(await screen.findByText("由你固定")).toBeInTheDocument();
  });

  it("cancels objective editing without writing a correction", async () => {
    const user = userEvent.setup();
    const saveCorrection = vi.fn();
    const active = conversation({ state: "recent", currentPlan: undefined });
    render(<WorkbenchOverview model={notebook([active])} conversationModel={notebook([active])} onSaveCorrection={saveCorrection} />);
    await user.click(screen.getByRole("button", { name: "概览操作" }));
    await user.click(screen.getByRole("button", { name: "编辑工作目标" }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(saveCorrection).not.toHaveBeenCalled();
    expect(screen.queryByRole("form", { name: "编辑工作目标" })).not.toBeInTheDocument();
  });

  it("resets scope and drafts when the active conversation changes or disappears", async () => {
    const user = userEvent.setup();
    const saveA = vi.fn();
    const saveB = vi.fn().mockResolvedValue(undefined);
    const a = conversation({ conversationId: "conversation-a", objective: { text: "目标 A", source: "semantic" }, successCriteria: ["标准 A"], state: "recent", currentPlan: undefined });
    const b = conversation({ conversationId: "conversation-b", objective: { text: "目标 B", source: "semantic" }, successCriteria: ["标准 B"], state: "recent", currentPlan: undefined });
    const { rerender } = render(<WorkbenchOverview model={notebook([a, b])} conversationModel={notebook([a])} onSaveCorrection={saveA} />);

    await user.click(screen.getByRole("button", { name: "概览操作" }));
    await user.click(screen.getByRole("button", { name: "编辑工作目标" }));
    await user.clear(screen.getByLabelText("工作目标"));
    await user.type(screen.getByLabelText("工作目标"), "A 的未保存草稿");

    rerender(<WorkbenchOverview model={notebook([a, b])} conversationModel={notebook([b])} onSaveCorrection={saveB} />);
    expect(screen.queryByRole("form", { name: "编辑工作目标" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "本次会话" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "概览操作" }));
    await user.click(screen.getByRole("button", { name: "编辑工作目标" }));
    expect(screen.getByLabelText("工作目标")).toHaveValue("目标 B");
    expect(screen.getByLabelText("完成标准")).toHaveValue("标准 B");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(saveA).not.toHaveBeenCalled();
    expect(saveB).toHaveBeenCalledWith({ objective: "目标 B", successCriteria: ["标准 B"] });

    rerender(<WorkbenchOverview model={notebook([a, b])} onSaveCorrection={saveB} />);
    expect(screen.getByRole("button", { name: "当前本子" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "本次会话" })).toBeDisabled();
  });

  it("uses the explicit active-run truth to disable refresh even when the snapshot is waiting", async () => {
    const user = userEvent.setup();
    const waiting = conversation({ state: "waiting", currentPlan: undefined });
    render(<WorkbenchOverview model={notebook([waiting])} conversationModel={notebook([waiting])} activeRunInProgress onRequestRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "概览操作" }));
    expect(screen.getByRole("button", { name: "更新概览" })).toBeDisabled();
  });

  it("keeps the correction draft visible and reports a quiet error when local persistence fails", async () => {
    const user = userEvent.setup();
    const active = conversation({ state: "recent", currentPlan: undefined });
    render(<WorkbenchOverview model={notebook([active])} conversationModel={notebook([active])} onSaveCorrection={vi.fn().mockRejectedValue(new Error("保存冲突，请重试"))} />);
    await user.click(screen.getByRole("button", { name: "概览操作" }));
    await user.click(screen.getByRole("button", { name: "编辑工作目标" }));
    await user.clear(screen.getByLabelText("工作目标"));
    await user.type(screen.getByLabelText("工作目标"), "保留这份草稿");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("status")).toHaveTextContent("保存冲突，请重试");
    expect(screen.getByRole("form", { name: "编辑工作目标" })).toBeInTheDocument();
    expect(screen.getByLabelText("工作目标")).toHaveValue("保留这份草稿");
  });

  it("supports explicitly clearing the objective and bounds each submitted success criterion", async () => {
    const user = userEvent.setup();
    const saveCorrection = vi.fn().mockResolvedValue(undefined);
    const active = conversation({ state: "recent", currentPlan: undefined });
    render(<WorkbenchOverview model={notebook([active])} conversationModel={notebook([active])} onSaveCorrection={saveCorrection} />);
    await user.click(screen.getByRole("button", { name: "概览操作" }));
    await user.click(screen.getByRole("button", { name: "编辑工作目标" }));
    await user.clear(screen.getByLabelText("工作目标"));
    fireEvent.change(screen.getByLabelText("完成标准"), { target: { value: `${"甲".repeat(121)}\n${"乙".repeat(121)}\n三\n四\n五\n六` } });
    const displayedLines = (screen.getByLabelText("完成标准") as HTMLTextAreaElement).value.split("\n");
    expect(displayedLines).toHaveLength(5);
    expect(displayedLines.every((line) => line.length <= 120)).toBe(true);
    await user.clear(screen.getByLabelText("完成标准"));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(saveCorrection).toHaveBeenCalledWith({ clearFields: ["objective", "successCriteria"] });
  });

  it("ignores a stale correction success after switching conversations", async () => {
    const user = userEvent.setup();
    const pendingA = deferred();
    const saveA = vi.fn(() => pendingA.promise);
    const saveB = vi.fn().mockResolvedValue(undefined);
    const a = conversation({ conversationId: "conversation-a", objective: { text: "目标 A", source: "semantic" }, state: "recent", currentPlan: undefined });
    const b = conversation({ conversationId: "conversation-b", objective: { text: "目标 B", source: "semantic" }, state: "recent", currentPlan: undefined });
    const { rerender } = render(<WorkbenchOverview model={notebook([a, b])} conversationModel={notebook([a])} onSaveCorrection={saveA} />);

    await user.click(screen.getByRole("button", { name: "概览操作" }));
    await user.click(screen.getByRole("button", { name: "编辑工作目标" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(saveA).toHaveBeenCalledTimes(1);

    rerender(<WorkbenchOverview model={notebook([a, b])} conversationModel={notebook([b])} onSaveCorrection={saveB} />);
    await user.click(screen.getByRole("button", { name: "概览操作" }));
    await user.click(screen.getByRole("button", { name: "编辑工作目标" }));
    await user.clear(screen.getByLabelText("工作目标"));
    await user.type(screen.getByLabelText("工作目标"), "B 的未保存草稿");

    await act(async () => pendingA.resolve());
    expect(screen.getByRole("form", { name: "编辑工作目标" })).toBeInTheDocument();
    expect(screen.getByLabelText("工作目标")).toHaveValue("B 的未保存草稿");
    expect(screen.queryByText("由你固定")).not.toBeInTheDocument();
  });

  it("ignores a stale correction failure after switching conversations", async () => {
    const user = userEvent.setup();
    const pendingA = deferred();
    const a = conversation({ conversationId: "conversation-a", state: "recent", currentPlan: undefined });
    const b = conversation({ conversationId: "conversation-b", objective: { text: "目标 B", source: "semantic" }, state: "recent", currentPlan: undefined });
    const { rerender } = render(<WorkbenchOverview model={notebook([a, b])} conversationModel={notebook([a])} onSaveCorrection={() => pendingA.promise} />);

    await user.click(screen.getByRole("button", { name: "概览操作" }));
    await user.click(screen.getByRole("button", { name: "编辑工作目标" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    rerender(<WorkbenchOverview model={notebook([a, b])} conversationModel={notebook([b])} onSaveCorrection={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "概览操作" }));
    await user.click(screen.getByRole("button", { name: "编辑工作目标" }));

    await act(async () => pendingA.reject(new Error("A 的迟到错误")));
    expect(screen.getByRole("form", { name: "编辑工作目标" })).toBeInTheDocument();
    expect(screen.queryByText("A 的迟到错误")).not.toBeInTheDocument();
  });

  it("does not let a stale refresh response overwrite the new conversation request", async () => {
    const user = userEvent.setup();
    const refreshA = deferred();
    const refreshB = deferred();
    const a = conversation({ conversationId: "conversation-a", state: "recent", currentPlan: undefined });
    const b = conversation({ conversationId: "conversation-b", state: "recent", currentPlan: undefined });
    const { rerender } = render(<WorkbenchOverview model={notebook([a, b])} conversationModel={notebook([a])} onRequestRefresh={() => refreshA.promise} />);

    await user.click(screen.getByRole("button", { name: "概览操作" }));
    await user.click(screen.getByRole("button", { name: "更新概览" }));
    rerender(<WorkbenchOverview model={notebook([a, b])} conversationModel={notebook([b])} onRequestRefresh={() => refreshB.promise} />);
    await user.click(screen.getByRole("button", { name: "概览操作" }));
    await user.click(screen.getByRole("button", { name: "更新概览" }));

    await act(async () => refreshA.resolve());
    expect(screen.getByRole("status")).toHaveTextContent("正在更新概览…");
    await act(async () => refreshB.resolve());
    expect(screen.getByRole("status")).toHaveTextContent("概览已更新");
  });
});
