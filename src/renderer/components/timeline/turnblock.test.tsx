import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useContext } from "react";
import type { TimelineItem } from "../../stores/message-model";
import type { PendingInteraction, ResolvedInteraction } from "../../stores/approvals";
import TurnBlock from "./TurnBlock";
import { BridgeProvider, BridgeContext, type BridgeStores } from "../../bridge/context";
import { FixtureBridgeClient } from "../../bridge/fixture-client";
import { LEEMO_VISUALIZATION_TOOL_NAME, LEEMO_ASK_USER_TOOL_NAME } from "../../bridge/tool-names";
import type { WorkspaceClient } from "../../workspace/client";

const R = "run-1";
const user: TimelineItem = { kind: "text", id: "u", runId: R, role: "user", text: "整理笔记", streaming: false };
const open: TimelineItem = { kind: "text", id: "o", runId: R, role: "momo", text: "好，我先看看。", streaming: false };
const tool: TimelineItem = { kind: "tool", id: "t", runId: R, toolUseId: "t1", name: "Read", input: {}, status: "ok", summary: "38 页" };
const finalT: TimelineItem = { kind: "text", id: "f", runId: R, role: "momo", text: "草稿好了。", streaming: false };
const usage: TimelineItem = { kind: "usage", id: "us", runId: R, usage: { providerId: "p", modelId: "m", inputTokens: 2400, outputTokens: 600, cacheReadTokens: 0, cacheCreationTokens: 0, costSource: "unpriced", tokensEstimated: false } };
const result: TimelineItem = { kind: "result", id: "r", runId: R, isError: false, interrupted: false, finalText: "草稿好了。", pathAudit: { claimed: [] } };
const memory: TimelineItem = {
  kind: "memory", id: "mem", runId: R, changeId: "change-1",
  action: "remembered", label: "用户喜欢先看结论", scope: { type: "global" }, undone: false,
};
const files: TimelineItem = {
  kind: "files", id: "files", runId: R,
  changes: [{ path: "报告.md", workspacePath: "默认工作区/报告.md", change: "modified" }],
  omitted: 0,
};
const vizTool: TimelineItem = {
  kind: "tool", id: "tv", runId: R, toolUseId: "tv1", name: LEEMO_VISUALIZATION_TOOL_NAME,
  input: {
    file_path: "chart.html",
    title: "练习次数",
    visualization: { kind: "bar", values: [{ label: "阅读", value: 4 }], unit: "次" },
  },
  status: "ok",
};
const askTool = (toolUseId: string): TimelineItem =>
  ({ kind: "tool", id: `ask-${toolUseId}`, runId: R, toolUseId, name: LEEMO_ASK_USER_TOOL_NAME, input: {}, status: "ok" });

function renderTurnBlock(
  items: TimelineItem[],
  active: boolean,
  pending: PendingInteraction[] = [],
  resolved: ResolvedInteraction[] = [],
  density: "workbench" | "buddy" = "workbench",
  workspace?: WorkspaceClient,
) {
  const client = new FixtureBridgeClient();
  let stores: BridgeStores | null = null;
  function Probe() {
    stores = useContext(BridgeContext);
    return <TurnBlock items={items} active={active} runId={R} density={density} />;
  }
  const view = render(
    <BridgeProvider client={client} workspace={workspace}>
      <Probe />
    </BridgeProvider>
  );
  // Seed pending approvals/questions + resolved history into the real store
  // the components read from, rather than through a test-only prop — same
  // shape wiring.ts/approvals.ts produce.
  if (pending.length > 0 || resolved.length > 0) {
    act(() => {
      stores!.approvals.setState((s) => ({
        ...s,
        pendingByConversation:
          pending.length > 0
            ? Object.fromEntries(pending.map((p) => [p.conversationId, p]))
            : s.pendingByConversation,
        resolvedByRun: resolved.length > 0 ? { ...s.resolvedByRun, [R]: resolved } : s.resolvedByRun,
      }));
    });
  }
  return Object.assign(view, {
    getStores: () => {
      if (!stores) throw new Error("Bridge stores were not mounted");
      return stores;
    },
  });
}

describe("TurnBlock — approval cards live inline in the conversation flow", () => {
  it("renders no trailing approval node when nothing is pending", () => {
    // The old behaviour pushed <ApprovalBar> after every node, so the card
    // floated below the final text no matter which tool raised it — the user
    // read it as "置底还很丑" and often missed it until the permission stream
    // timed out (which surfaced as a bogus "被拒绝").
    const running: TimelineItem = { ...tool, status: "running", summary: undefined };
    const { container } = renderTurnBlock([user, open, running, finalT], true);
    expect(container.innerHTML).not.toContain("momo 想");
  });

  it("anchors a pending approval to its own tool inside the process fold", () => {
    const running: TimelineItem = { ...tool, toolUseId: "tu-42", status: "running", summary: undefined };
    renderTurnBlock([user, open, running], true, [
      {
        kind: "approval",
        id: "a1",
        conversationId: "conv-fixture",
        runId: R,
        toolUseId: "tu-42",
        toolName: "Read",
        inputSummary: "bookmarks.md",
        risk: "safe",
        receivedAt: 0,
      },
    ]);
    const card = screen.getByText(/momo 想/);
    const fold = screen.getByTestId("process-fold");
    // The approval sits with its tool inside the fold — part of the flow, not
    // a footer bolted onto the turn.
    expect(fold.contains(card)).toBe(true);
  });

  it("puts approval actions on their own responsive row instead of squeezing the explanation", () => {
    const running: TimelineItem = { ...tool, toolUseId: "tu-responsive", status: "running", summary: undefined };
    renderTurnBlock([user, open, running], true, [
      {
        kind: "approval",
        id: "a-responsive",
        conversationId: "conv-fixture",
        runId: R,
        toolUseId: "tu-responsive",
        toolName: "Write",
        inputSummary: "一份很长的课程资料整理结果.md",
        risk: "moderate",
        receivedAt: 0,
      },
    ]);

    expect(screen.getByTestId("approval-card-pending")).toHaveClass("grid");
    expect(screen.getByTestId("approval-actions")).toHaveClass("col-span-full", "w-full");
  });

  it("renders an anchored approval EXACTLY once (no duplicate fallback card)", () => {
    // Regression: the fallback bar recomputed "is this anchored?" from
    // resolvedByRun only, so a PENDING approval whose tool is right there in
    // the timeline looked unanchored to it — and the card rendered twice,
    // overlapping itself on screen.
    const running: TimelineItem = { ...tool, toolUseId: "tu-42", status: "running", summary: undefined };
    renderTurnBlock([user, open, running], true, [
      {
        kind: "approval",
        id: "a1",
        conversationId: "conv-fixture",
        runId: R,
        toolUseId: "tu-42",
        toolName: "Read",
        inputSummary: "bookmarks.md",
        risk: "safe",
        receivedAt: 0,
      },
    ]);
    expect(screen.getAllByText(/momo 想/)).toHaveLength(1);
  });

  it("keeps a pending approval visible in buddy density", () => {
    const running: TimelineItem = { ...tool, toolUseId: "tu-buddy", status: "running", summary: undefined };
    renderTurnBlock([user, open, running], true, [
      {
        kind: "approval",
        id: "a-buddy",
        conversationId: "conv-fixture",
        runId: R,
        toolUseId: "tu-buddy",
        toolName: "Bash",
        inputSummary: "npm test",
        risk: "moderate",
        receivedAt: 0,
      },
    ], [], "buddy");
    expect(screen.getByText(/momo 想/)).toBeInTheDocument();
  });

  it("compacts a resolved approval in buddy density without hiding its outcome", () => {
    const completed: TimelineItem = { ...tool, toolUseId: "tu-buddy-done" };
    renderTurnBlock([user, completed], false, [], [{
      kind: "approval",
      id: "a-buddy-done",
      runId: R,
      toolUseId: "tu-buddy-done",
      toolName: "Bash",
      inputSummary: "npm test",
      risk: "moderate",
      outcome: "allow-once",
    }], "buddy");
    fireEvent.click(screen.getByTestId("process-fold").querySelector("button")!);
    expect(screen.getByText("执行命令 · 已允许一次")).toBeInTheDocument();
    expect(screen.queryByText("momo 想执行命令")).not.toBeInTheDocument();
    expect(screen.queryByText("npm test")).not.toBeInTheDocument();
  });

  it("keeps an approval whose tool is not in this turn visible (no silent drop)", () => {
    // Defensive: an approval that cannot be anchored (missing/unknown
    // toolUseId, e.g. an older host) must still reach the user rather than
    // vanish — an invisible permission prompt is what stalls the round.
    const running: TimelineItem = { ...tool, toolUseId: "tu-1", status: "running", summary: undefined };
    renderTurnBlock([user, open, running], true, [
      {
        kind: "approval",
        id: "a2",
        conversationId: "conv-fixture",
        runId: R,
        toolName: "Bash",
        inputSummary: "rm -rf /tmp/x",
        risk: "dangerous",
        receivedAt: 0,
      },
    ]);
    expect(screen.getByText(/momo 想执行命令/)).toBeInTheDocument();
  });
});

describe("TurnBlock strict-chronological rendering", () => {
  it("collects interleaved process events into exactly one receipt per turn", () => {
    const thinking: TimelineItem = {
      kind: "thinking", id: "thinking-1", runId: R,
      text: "先确认资料范围", streaming: false,
    };
    const activity: TimelineItem = {
      kind: "activity", id: "activity-1", runId: R, parentToolUseId: "agent-1",
      childToolUseIds: [], tools: [],
      transcript: [{ kind: "text", text: "小助手核对完成" }],
    };
    const middle: TimelineItem = {
      kind: "text", id: "middle", runId: R, role: "momo",
      text: "我继续核对一遍。", streaming: false,
    };

    renderTurnBlock([user, thinking, open, tool, middle, activity, finalT, result], false);

    expect(screen.getAllByTestId("process-fold")).toHaveLength(1);
    expect(screen.getByText("好，我先看看。")).toBeInTheDocument();
    expect(screen.getByText("我继续核对一遍。")).toBeInTheDocument();
    expect(screen.getByText("草稿好了。")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("process-fold").querySelector("button")!);
    expect(screen.getByText("先确认资料范围")).toBeInTheDocument();
    expect(screen.getByText("读取文件")).toBeInTheDocument();
    expect(screen.getByText("分身干活")).toBeInTheDocument();
  });

  it("renders user message, then momo text, in document order (user is NOT hoisted below process)", () => {
    renderTurnBlock([user, open, tool, finalT, usage, result], false);
    const u = screen.getByText("整理笔记");
    const o = screen.getByText("好，我先看看。");
    // user appears before momo opening in DOM order
    expect(u.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("finished turn collapses the process fold by default; final text + footer stay visible", () => {
    renderTurnBlock([user, open, tool, finalT, usage, result], false);
    expect(screen.getByText("草稿好了。")).toBeInTheDocument();
    expect(screen.queryByText("读取文件")).not.toBeInTheDocument(); // process folded
    expect(screen.getByText(/复制/)).toBeInTheDocument(); // footer copy
    expect(screen.getByRole("button", { name: /查看用量/ })).toBeInTheDocument();
    expect(screen.queryByText(/2\.4k|2400/)).not.toBeInTheDocument(); // details stay quiet until requested
  });

  it("folds memory data into the existing result footer instead of rendering another message", () => {
    const { container } = renderTurnBlock([user, finalT, memory, result], false);
    expect(screen.getByText("记住了：用户喜欢先看结论")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "撤销这条记忆" })).toBeInTheDocument();
    expect(container.querySelectorAll("[data-memory-receipt]")).toHaveLength(1);
    expect(container.querySelector("[data-memory-card]")).toBeNull();
  });

  it("folds file changes into the same quiet result footer", () => {
    const { container } = renderTurnBlock([user, finalT, files, result], false);
    expect(screen.getByRole("button", { name: "查看文件变化" })).toHaveTextContent("修改了 1 个文件");
    expect(container.querySelectorAll("[data-file-change-receipt]")).toHaveLength(1);
    expect(container.querySelector("[data-file-change-card]")).toBeNull();
  });

  it("opens the internal workspace path and moves buddy users into the workbench", () => {
    const reveal = vi.fn(async () => {});
    const workspace = { reveal } as unknown as WorkspaceClient;
    const { getStores } = renderTurnBlock(
      [user, finalT, files, result],
      false,
      [],
      [],
      "buddy",
      workspace,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看文件变化" }));
    fireEvent.click(screen.getByRole("button", { name: "预览 报告.md" }));

    expect(getStores().settings.getState().mode).toBe("workbench");
    expect(getStores().ui.getState().previewActivePath).toBe("默认工作区/报告.md");
    expect(screen.getByRole("button", { name: "在文件夹中显示 报告.md" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "在文件夹中显示 报告.md" }));
    expect(reveal).toHaveBeenCalledWith("默认工作区/报告.md", "leemo-home");
  });

  it("keeps the process receipt aligned with interrupted and failed turn outcomes", () => {
    const bash: TimelineItem = {
      kind: "tool", id: "bash", runId: R, toolUseId: "bash-1",
      name: "Bash", input: {}, status: "running",
    };
    const interrupted: TimelineItem = {
      kind: "result", id: "interrupted", runId: R, isError: false,
      interrupted: true, finalText: "", pathAudit: { claimed: [] },
    };
    const { rerender } = renderTurnBlock([user, bash, interrupted], false);
    expect(screen.getByText("执行命令已停止")).toBeInTheDocument();
    expect(screen.queryByText("执行命令已完成")).not.toBeInTheDocument();

    const failed: TimelineItem = {
      ...interrupted, id: "failed", isError: true, interrupted: false,
    };
    rerender(
      <BridgeProvider>
        <TurnBlock items={[user, { ...bash, status: "ok" }, failed]} active={false} runId={R} />
      </BridgeProvider>,
    );
    expect(screen.getByText("执行命令已完成")).toBeInTheDocument();
    expect(screen.queryByText("执行命令未完成")).not.toBeInTheDocument();

    rerender(
      <BridgeProvider>
        <TurnBlock items={[user, bash, failed]} active={false} runId={R} />
      </BridgeProvider>,
    );
    expect(screen.getByText("执行命令未完成")).toBeInTheDocument();

    const earlierFailure: TimelineItem = {
      kind: "tool", id: "read-failed", runId: R, toolUseId: "read-1",
      name: "Read", input: {}, status: "error",
    };
    rerender(
      <BridgeProvider>
        <TurnBlock items={[user, earlierFailure, bash, interrupted]} active={false} runId={R} />
      </BridgeProvider>,
    );
    expect(screen.getByText("执行命令已停止")).toBeInTheDocument();
    expect(screen.queryByText("读取资料未完成")).not.toBeInTheDocument();
  });

  it("shows a concrete failure reason once without repeating a generic failed footer", () => {
    const error: TimelineItem = {
      kind: "error", id: "error", runId: R, message: "模型服务暂时不可用",
    };
    const failed: TimelineItem = {
      kind: "result", id: "failed-result", runId: R, isError: true,
      interrupted: false, finalText: "", pathAudit: { claimed: [] },
    };

    renderTurnBlock([user, error, failed], false);
    expect(screen.getByText("模型服务暂时不可用")).toBeInTheDocument();
    expect(screen.queryByText("这条没跑完")).not.toBeInTheDocument();
  });

  it("no 完成 card is rendered", () => {
    renderTurnBlock([user, open, tool, finalT, usage, result], false);
    expect(screen.queryByText(/^完成$/)).not.toBeInTheDocument();
  });

  it("active turn shows the process fold expanded", () => {
    const running: TimelineItem = { ...tool, status: "running", summary: undefined };
    renderTurnBlock([user, open, running], true);
    expect(screen.getByText("读取文件")).toBeInTheDocument();
  });

  it("clicking the fold bar reveals process cards on a finished turn", () => {
    renderTurnBlock([user, open, tool, finalT, usage, result], false);
    fireEvent.click(screen.getByRole("button", { name: /momo 的干活过程/ }));
    expect(screen.getByText("读取文件")).toBeInTheDocument();
  });

  it("a usage item between two process items does not split the process fold", () => {
    const tool2: TimelineItem = { kind: "tool", id: "t2", runId: R, toolUseId: "t2", name: "Write", input: {}, status: "running" };
    renderTurnBlock([user, open, tool, usage, tool2], true);
    // active turn: fold is expanded by default, showing "N 步" — should say 2 steps, not two separate folds
    expect(screen.getByText(/^2 步$/)).toBeInTheDocument();
    expect(screen.getAllByText(/^\d 步$/)).toHaveLength(1);
    expect(screen.getByText("读取文件")).toBeInTheDocument();
    expect(screen.getByText("写入文件")).toBeInTheDocument();
  });

  it("visualization tool renders outside process fold as VisualizationCard", () => {
    renderTurnBlock([user, open, tool, vizTool, finalT, usage, result], false);
    // Regular tool is in collapsed fold
    expect(screen.queryByText("读取文件")).not.toBeInTheDocument();
    // Visualization tool renders as card outside fold
    expect(screen.getByText("chart.html")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "练习次数" })).toBeInTheDocument();
    expect(screen.queryByTitle("可视化: chart.html")).not.toBeInTheDocument();
  });
});

describe("TurnBlock — ask_user question cards live inline, never folded (卡 D)", () => {
  const askQuestions = [{ question: "选择部署环境？", options: [{ label: "开发" }, { label: "生产" }] }];

  function pendingQuestion(id: string): PendingInteraction {
    return { kind: "question", id, conversationId: "conv-fixture", runId: R, questions: askQuestions, receivedAt: 0 };
  }
  function resolvedQuestion(id: string, items: { selected: string[]; other?: string }[] | null): ResolvedInteraction {
    return { kind: "question", id, runId: R, questions: askQuestions, items };
  }

  it("renders no question card when nothing is pending/resolved for the run", () => {
    const { container } = renderTurnBlock([user, open, askTool("tu-1")], true);
    expect(container.innerHTML).not.toContain("选择部署环境？");
  });

  it("is NOT folded into the process fold, unlike a regular tool", () => {
    renderTurnBlock(
      [user, open, tool, askTool("tu-1"), finalT],
      false,
      [],
      [resolvedQuestion("q1", [{ selected: ["开发"] }])],
    );
    // Regular tool (Read) IS folded (collapsed by default on a finished turn).
    expect(screen.queryByText("读取文件")).not.toBeInTheDocument();
    // The question card is never hidden behind a fold — momo asking directly
    // is not "干活过程".
    expect(screen.getByText("选择部署环境？")).toBeInTheDocument();
  });

  it("renders the pending question inline, amber-emphasized and interactive", () => {
    const { container } = renderTurnBlock([user, open, askTool("tu-1")], true, [pendingQuestion("q1")]);
    expect(screen.getByText("选择部署环境？")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /开发/ })).toBeInTheDocument();
    expect(container.innerHTML).toContain("var(--leemo-amber-line)");
  });

  it("renders an answered question in place — archived, no controls, still where its tool item is", () => {
    renderTurnBlock(
      [user, open, askTool("tu-1"), finalT],
      false,
      [],
      [resolvedQuestion("q1", [{ selected: ["开发"] }])],
    );
    const question = screen.getByText("选择部署环境？");
    const finalText = screen.getByText("草稿好了。");
    // Question sits BEFORE the final text — same position as its tool call,
    // not moved to the end of the turn ("不许移动位置").
    expect(question.compareDocumentPosition(finalText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: /开发/ })).not.toBeInTheDocument();
  });

  it("renders a cancelled/expired question in place, marked 已取消", () => {
    renderTurnBlock([user, open, askTool("tu-1")], false, [], [resolvedQuestion("q1", null)]);
    expect(screen.getByText("已取消")).toBeInTheDocument();
  });

  it("pairs two sequential ask_user calls to resolved-then-pending, by index and in order", () => {
    renderTurnBlock(
      [user, open, askTool("tu-1"), askTool("tu-2")],
      true,
      [pendingQuestion("q2")],
      [resolvedQuestion("q1", [{ selected: ["开发"] }])],
    );
    // First is archived (answered); second is the live interactive pending
    // card — exactly one submit button (only the pending one has it).
    expect(screen.getAllByText("选择部署环境？")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /提交/i })).toHaveLength(1);
  });

  it("renders an unpaired (overflow) question at the turn's tail instead of dropping it", () => {
    // Race: the push landed before its own tool.started did — zero ask_user
    // tool items in the timeline yet, but the question already exists. An
    // invisible pending question is a permanently stalled round (the exact
    // failure mode this round's anchoring fix targets).
    renderTurnBlock([user, open], true, [pendingQuestion("q1")]);
    expect(screen.getByText("选择部署环境？")).toBeInTheDocument();
  });

  it("archives resolved fallback interactions before the final answer on a finished turn", () => {
    renderTurnBlock(
      [user, open, tool, finalT, usage, result],
      false,
      [],
      [
        {
          kind: "approval",
          id: "a-fallback-done",
          runId: R,
          toolName: "Bash",
          inputSummary: "Bash: npm test",
          risk: "moderate",
          outcome: "allow-once",
        },
        resolvedQuestion("q-fallback-done", [{ selected: ["开发"] }]),
      ],
    );

    expect(screen.getAllByTestId("process-fold")).toHaveLength(1);
    const archive = screen.getByText("含 2 条确认记录");
    const finalAnswer = screen.getByText("草稿好了。");
    expect(archive.compareDocumentPosition(finalAnswer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(archive.closest("button")!);
    expect(screen.getByTestId("resolved-approval-receipt")).toHaveTextContent("执行命令");
    expect(screen.getByText("选择部署环境？")).toBeInTheDocument();
  });

  it("renders a paired ask_user question EXACTLY once — no duplicate anywhere in the turn", () => {
    // Regression: a prior round introduced "same card renders twice" for the
    // approval bar (a pinned copy stacked on top of the inline one). Verified
    // by literally reintroducing that duplicate-render shape during
    // development and confirming this exact assertion fails before fixing it
    // back (see r2-bd report's "反向验证" section) — a test that can't fail
    // proves nothing.
    renderTurnBlock([user, open, askTool("tu-1")], true, [pendingQuestion("q1")]);
    expect(screen.getAllByText("选择部署环境？")).toHaveLength(1);
  });
});
