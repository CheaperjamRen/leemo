import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import type { TimelineItem } from "../../stores/message-model";
import ToolCard from "./ToolCard";
import PlanCard from "./PlanCard";
import ActivityCard from "./ActivityCard";
import CompactDivider from "./CompactDivider";
import TextBubble from "./TextBubble";
import ThinkingCard from "./ThinkingCard";
import ProcessFold from "./ProcessFold";
import { BridgeProvider } from "../../bridge/context";
import SubagentAvatar from "./SubagentAvatar";

type Of<K extends TimelineItem["kind"]> = Extract<TimelineItem, { kind: K }>;

describe("timeline cards render their data", () => {
  it("ToolCard shows tool name and status", () => {
    const item: Of<"tool"> = { kind: "tool", id: "1", runId: "r", toolUseId: "t", name: "Read", input: {}, status: "ok", summary: "38 pages" };
    render(<ToolCard item={item} />);
    expect(screen.getByText("读取文件")).toBeInTheDocument();
    expect(screen.getByText(/38 pages/)).toBeInTheDocument();
  });

  it("ToolCard expands retained inputs and results as the actual technical record", () => {
    const item: Of<"tool"> = {
      kind: "tool", id: "raw", runId: "r", toolUseId: "tool-raw", name: "Read",
      input: { file_path: "课程/讲义.pdf", offset: 3 }, status: "ok", summary: "读取了 38 页",
    };
    render(<ToolCard item={item} />);
    fireEvent.click(screen.getByRole("button", { name: "展开工具详情" }));

    const details = screen.getByTestId("raw-tool-details");
    expect(details).toHaveTextContent("Read");
    expect(details).toHaveTextContent('"file_path": "课程/讲义.pdf"');
    expect(details).toHaveTextContent("完成");
    expect(details).toHaveTextContent("参数");
    expect(details).toHaveTextContent("返回结果");
    expect(details).toHaveTextContent("读取了 38 页");
    expect(details).toHaveClass("max-h-72", "overflow-auto", "select-text");
    expect(details).not.toHaveTextContent(/完整输出|stdout|stderr|工作目录|退出代码|耗时/);
  });

  it("ToolCard shows a shell command and its retained output directly", () => {
    const item: Of<"tool"> = {
      kind: "tool", id: "shell", runId: "r", toolUseId: "tool-shell", name: "Bash",
      input: { command: "npm run typecheck", cwd: "E:\\Leemo" }, status: "error",
      summary: "src/app.ts(12,4): error TS2322",
    };
    render(<ToolCard item={item} />);
    fireEvent.click(screen.getByRole("button", { name: "展开工具详情" }));

    expect(screen.getByTestId("raw-tool-command")).toHaveTextContent("$ npm run typecheck");
    expect(screen.getByText("E:\\Leemo")).toBeInTheDocument();
    expect(screen.getByTestId("raw-tool-output")).toHaveTextContent("error TS2322");
  });

  it("ToolCard distinguishes a denied tool from an execution failure and keeps the user's reason", () => {
    const item: Of<"tool"> = {
      kind: "tool",
      id: "denied",
      runId: "r",
      toolUseId: "tool-denied",
      name: "Write",
      input: { file_path: "外部目录/结果.md" },
      status: "error",
      outcome: "denied",
      summary: "用户拒绝了这次操作",
      userFeedback: "先不要改这个文件",
    };

    render(<ToolCard item={item} />);
    expect(screen.getByText("未获允许")).toBeInTheDocument();
    expect(screen.queryByText("失败")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开工具详情" }));
    expect(screen.getByText("用户说明")).toBeInTheDocument();
    expect(screen.getByText("先不要改这个文件")).toBeInTheDocument();
  });

  it("ToolCard presents a cancelled tool as cancelled rather than failed", () => {
    const item: Of<"tool"> = {
      kind: "tool",
      id: "cancelled",
      runId: "r",
      toolUseId: "tool-cancelled",
      name: "Bash",
      input: { command: "npm test" },
      status: "error",
      outcome: "cancelled",
      summary: "Operation cancelled",
    };

    render(<ToolCard item={item} />);
    expect(screen.getByText("已取消")).toBeInTheDocument();
    expect(screen.queryByText("失败")).not.toBeInTheDocument();
  });

  it("ToolCard keeps browser transport output out of the user-facing summary", () => {
    const item: Of<"tool"> = {
      kind: "tool",
      id: "browser-snapshot",
      runId: "r",
      toolUseId: "browser-1",
      name: "mcp__playwright__browser_snapshot",
      input: {},
      status: "ok",
      summary: '[{"type":"text","text":"### Page\\n- Page URL: http://127.0.0.1"}]',
    };
    render(<ToolCard item={item} />);

    expect(screen.getByText("读取网页内容")).toBeInTheDocument();
    expect(screen.getByText("已读取当前页面")).toBeInTheDocument();
    expect(screen.queryByText(/Page URL/)).not.toBeInTheDocument();
  });

  it("PlanCard is a flat todo region without its own nested card header", () => {
    const item: Of<"plan"> = { kind: "plan", id: "1", runId: "r", toolUseId: "p", todos: [
      { text: "a", status: "done" }, { text: "b", status: "active" }, { text: "c", status: "todo" },
    ] };
    render(<PlanCard item={item} />);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("c")).toBeInTheDocument();
    expect(screen.getByTestId("plan-card")).not.toHaveClass("leemo-card-shadow");
    expect(screen.queryByText("计划")).not.toBeInTheDocument();
  });

  it("ActivityCard expands to show the subagent transcript and tool results", () => {
    const item: Of<"activity"> = {
      kind: "activity", id: "1", runId: "r", parentToolUseId: "a",
      childToolUseIds: ["c1", "c2"],
      tools: [
        { toolUseId: "c1", name: "Read", status: "ok", summary: "42 lines" },
        { toolUseId: "c2", name: "Grep", status: "running" },
      ],
      transcript: [{ kind: "text", text: "定位到了配置入口。" }],
    };
    render(<ActivityCard item={item} />);
    expect(screen.getByText(/2/)).toBeInTheDocument();
    expect(screen.queryByText("定位到了配置入口。")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开助手详情" }));
    expect(screen.getByText("定位到了配置入口。")).toBeInTheDocument();
    expect(screen.getByText("读取文件")).toBeInTheDocument();
    expect(screen.getByText("42 lines")).toBeInTheDocument();
  });

  it("ActivityCard uses the same denied-tool language as the main timeline", () => {
    const item: Of<"activity"> = {
      kind: "activity",
      id: "denied-activity",
      runId: "r",
      parentToolUseId: "a",
      childToolUseIds: ["c1"],
      tools: [{
        toolUseId: "c1",
        name: "Write",
        status: "error",
        outcome: "denied",
        summary: "用户拒绝了这次操作",
      }],
      transcript: [],
    };

    render(<ActivityCard item={item} />);
    fireEvent.click(screen.getByRole("button", { name: "展开助手详情" }));
    expect(screen.getByText("未获允许")).toBeInTheDocument();
  });

  it("ActivityCard renders subagent markdown as structured content", () => {
    const item: Of<"activity"> = {
      kind: "activity", id: "markdown-activity", runId: "r", parentToolUseId: "a",
      childToolUseIds: [], tools: [],
      transcript: [{
        kind: "text",
        text: "## 子任务结论\n\n| 检查 | 结果 |\n| --- | --- |\n| typecheck | 通过 |",
      }],
    };

    render(<ActivityCard item={item} />);
    fireEvent.click(screen.getByRole("button", { name: "展开助手详情" }));

    expect(screen.getByRole("heading", { name: "子任务结论" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("ActivityCard preserves returned output but never renders raw thinking prose", () => {
    const item: Of<"activity"> = {
      kind: "activity",
      id: "nested-thinking",
      runId: "r",
      parentToolUseId: "agent-1",
      childToolUseIds: [],
      tools: [],
      status: "ok",
      role: "调研助手",
      task: "比较三款桌面 Agent 的设置流程",
      startedAt: 1_000,
      updatedAt: 9_000,
      transcript: [
        { kind: "thinking", text: "先逐项核对，再归纳差异。", createdAt: 4_000 },
        { kind: "text", text: "**结论：** NewMax 的添加路径最短。", createdAt: 9_000 },
      ],
    };

    render(<ActivityCard item={item} />);
    expect(screen.getByText("调研助手")).toBeInTheDocument();
    expect(screen.getByText("比较三款桌面 Agent 的设置流程")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开助手详情" }));
    expect(screen.getByText(/NewMax 的添加路径最短/)).toBeInTheDocument();
    expect(screen.queryByText("先逐项核对，再归纳差异。")).not.toBeInTheDocument();

    expect(screen.queryByText("先逐项核对，再归纳差异。")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /助手思考过程/ })).not.toBeInTheDocument();
  });

  it("SubagentAvatar uses stable sibling variants that are not momo", () => {
    const { rerender } = render(<SubagentAvatar identity="调研助手" />);
    const research = screen.getByRole("img", { name: "调研助手头像" });
    const researchVariant = research.getAttribute("data-variant");
    expect(research).not.toHaveAttribute("aria-label", expect.stringMatching(/momo/i));

    rerender(<SubagentAvatar identity="校验助手" />);
    expect(screen.getByRole("img", { name: "校验助手头像" })).not.toHaveAttribute("data-variant", researchVariant);
  });

  it("ProcessFold gives the first eight sibling assistants distinct avatars even when role hashes collide", () => {
    const roles = ["调研助手", "资料助手", "校验助手", "分析助手", "写作助手", "搜索助手", "审核助手", "测试助手"];
    const activities: Of<"activity">[] = roles.map((role, index) => ({
      kind: "activity",
      id: `activity-${index}`,
      runId: "r",
      parentToolUseId: `agent-${index}`,
      childToolUseIds: [],
      tools: [],
      transcript: [],
      role,
    }));

    render(<ProcessFold items={activities} defaultCollapsed={false} runId="r" />);

    const variants = screen.getAllByRole("img", { name: /助手头像$/ })
      .map((avatar) => avatar.getAttribute("data-variant"));
    expect(new Set(variants).size).toBe(8);
  });

  it("ActivityCard infers completion for restored records without an explicit parent status", () => {
    const item: Of<"activity"> = {
      kind: "activity",
      id: "legacy-activity",
      runId: "old-run",
      parentToolUseId: "agent-old",
      childToolUseIds: ["read-old"],
      tools: [{ toolUseId: "read-old", name: "Read", status: "ok", summary: "已读取" }],
      transcript: [{ kind: "text", text: "资料已经核对完成。" }],
    };

    render(<ActivityCard item={item} />);

    expect(screen.getByText(/已完成/)).toBeInTheDocument();
    expect(screen.queryByText(/进行中/)).not.toBeInTheDocument();
  });

  it("CompactDivider shows a compaction marker", () => {
    const item: Of<"compact"> = { kind: "compact", id: "1", trigger: "auto", preTokens: 1000, postTokens: 300 };
    render(<CompactDivider item={item} />);
    expect(screen.getByText(/压缩|compact/i)).toBeInTheDocument();
  });

  it("TextBubble renders momo text with a streaming caret", () => {
    const item: Of<"text"> = { kind: "text", id: "1", runId: "r", role: "momo", text: "hi", streaming: true };
    const { container } = render(<TextBubble item={item} />);
    expect(screen.getByText("hi")).toBeInTheDocument();
    expect(container.querySelector(".text-\\[14\\.5px\\]")).not.toBeNull();
  });

  it("TextBubble gives momo a warm conversation bubble only in buddy mode", () => {
    const item: Of<"text"> = { kind: "text", id: "1", runId: "r", role: "momo", text: "我们先聊聊", streaming: false };
    const { rerender } = render(<TextBubble item={item} density="buddy" />);
    expect(screen.getByTestId("buddy-momo-bubble")).toHaveClass("text-[15.5px]");

    rerender(<TextBubble item={item} density="workbench" />);
    expect(screen.queryByTestId("buddy-momo-bubble")).not.toBeInTheDocument();
  });

  it("TextBubble keeps user messages compact and never adds a user avatar", () => {
    const item: Of<"text"> = { kind: "text", id: "1", runId: "r", role: "user", text: "继续整理", streaming: false };
    const { container } = render(<TextBubble item={item} />);
    expect(container.querySelector(".max-w-\\[min\\(520px\\,65\\%\\)\\]")).not.toBeNull();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("TextBubble renders attachment names without exposing local paths", () => {
    const item: Of<"text"> = {
      kind: "text", id: "1", runId: "r", role: "user", text: "帮我看看", streaming: false,
      attachments: [{ name: "简历.pdf", size: 1024, mimeType: "application/pdf" }],
    };
    render(<TextBubble item={item} />);
    expect(screen.getByText("简历.pdf")).toBeInTheDocument();
    expect(screen.queryByText(/C:\\/)).not.toBeInTheDocument();
  });

  it("TextBubble renders a real timestamp for a user message", () => {
    const item: Of<"text"> = {
      kind: "text", id: "1", runId: "r", role: "user", text: "晚上继续", streaming: false,
      createdAt: new Date(2026, 6, 29, 21, 7).getTime(),
    };
    render(<TextBubble item={item} />);
    expect(screen.getByText("21:07")).toBeInTheDocument();
  });

  it("TextBubble renders GFM tables as a responsive table instead of raw pipes", () => {
    const item: Of<"text"> = {
      kind: "text", id: "1", runId: "r", role: "momo", streaming: false,
      text: "| 文件 | 结果 |\n|---|---|\n| RESULT.md | 通过 |",
    };
    const { container } = render(<TextBubble item={item} />);
    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "文件" })).toBeInTheDocument();
  });

  it("TextBubble makes sources visibly external and keyboard-focusable", () => {
    const item: Of<"text"> = {
      kind: "text", id: "1", runId: "r", role: "momo", streaming: false,
      text: "来源：[Example Domain](https://example.com)",
    };
    render(<TextBubble item={item} />);
    const link = screen.getByRole("link", { name: /Example Domain/ });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.className).toContain("underline");
  });

  it("ProcessFold uses one human sentence in buddy density", () => {
    const item: Of<"tool"> = {
      kind: "tool", id: "1", runId: "r", toolUseId: "t", name: "Read", input: {}, status: "running",
    };
    render(<ProcessFold items={[item]} defaultCollapsed={true} runId="r" density="buddy" />);
    expect(screen.getByText(/翻翻本子/)).toBeInTheDocument();
    expect(screen.queryByText("momo 的干活过程")).not.toBeInTheDocument();
    expect(screen.queryByText("Read")).not.toBeInTheDocument();
  });

  it("ProcessFold uses a neutral receipt for a finished plan", () => {
    const item: Of<"plan"> = {
      kind: "plan", id: "1", runId: "r", toolUseId: "p",
      todos: [{ text: "整理范围", status: "active" }],
    };
    render(<ProcessFold items={[item]} defaultCollapsed={true} runId="r" density="buddy" active={false} />);
    expect(screen.getByText("任务已完成")).toBeInTheDocument();
    expect(screen.queryByText(/正在/)).not.toBeInTheDocument();
  });

  it.each([
    {
      label: "tool",
      item: { kind: "tool", id: "done", runId: "r", toolUseId: "done-tool", name: "OtherTool", input: {}, status: "ok" } as Of<"tool">,
    },
    {
      label: "subagent activity",
      item: { kind: "activity", id: "activity", runId: "r", parentToolUseId: "a", childToolUseIds: [], tools: [], transcript: [], status: "ok" } as Of<"activity">,
    },
  ])("uses a neutral completion receipt for $label", ({ item }) => {
    render(<ProcessFold items={[item]} defaultCollapsed={true} runId="r" density="buddy" active={false} />);
    expect(screen.getByText("任务已完成")).toBeInTheDocument();
    expect(screen.queryByText(/收好|核对过|梳理过/)).not.toBeInTheDocument();
  });

  it("ProcessFold makes the current action and failure scannable in workbench density", () => {
    const running: Of<"tool"> = {
      kind: "tool", id: "1", runId: "r", toolUseId: "t", name: "Bash", input: {}, status: "running",
    };
    const { rerender } = render(
      <ProcessFold items={[running]} defaultCollapsed={true} runId="r" density="workbench" active />,
    );
    expect(screen.getByText("正在执行命令")).toBeInTheDocument();

    const failed: Of<"tool"> = { ...running, status: "error" };
    rerender(<ProcessFold items={[failed]} defaultCollapsed={true} runId="r" density="workbench" active={false} />);
    expect(screen.getByText("执行命令未完成")).toBeInTheDocument();
  });

  it("separates real plan, tool, and assistant sections without a fake percentage", () => {
    const plan: Of<"plan"> = { kind: "plan", id: "p", runId: "r", toolUseId: "p", todos: [
      { text: "读取资料", status: "done" }, { text: "整理结论", status: "active" },
    ] };
    const tool: Of<"tool"> = { kind: "tool", id: "t", runId: "r", toolUseId: "t", name: "Read", input: {}, status: "ok" };
    const activity: Of<"activity"> = { kind: "activity", id: "a", runId: "r", parentToolUseId: "a", childToolUseIds: [], tools: [], transcript: [] };
    render(
      <BridgeProvider>
        <ProcessFold items={[plan, tool, activity]} defaultCollapsed={false} runId="r" />
      </BridgeProvider>,
    );
    expect(screen.getByText("工具与命令 · 1 次")).toBeInTheDocument();
    expect(screen.getByText("助手协作 · 1")).toBeInTheDocument();
    expect(screen.getByTestId("process-fold-toggle")).toHaveClass("h-11");
    expect(screen.getByTestId("process-fold-progress")).toHaveTextContent("1 / 2");
    expect(screen.getByRole("img", { name: "momo 的头像" })).toHaveAttribute("width", "26");
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("does not present a stale partial plan fraction after a successful terminal result", () => {
    const plan: Of<"plan"> = { kind: "plan", id: "p", runId: "r", toolUseId: "p", todos: [
      { text: "读取资料", status: "done" }, { text: "补充说明", status: "active" },
    ] };
    const compact: Of<"compact"> = {
      kind: "compact", id: "c", trigger: "manual", preTokens: 1_000, postTokens: 420,
    };

    render(
      <BridgeProvider>
        <ProcessFold
          items={[plan, compact]}
          defaultCollapsed={false}
          runId="r"
          density="workbench"
          active={false}
          outcome="success"
        />
      </BridgeProvider>,
    );

    expect(screen.getByText("上下文已整理")).toBeInTheDocument();
    expect(screen.queryByTestId("process-fold-progress")).not.toBeInTheDocument();
    expect(screen.getByText("补充说明")).toBeInTheDocument();
  });

  it("summarizes a completed read-edit-read sequence as file processing", () => {
    const items: Of<"tool">[] = [
      { kind: "tool", id: "read-before", runId: "r", toolUseId: "read-1", name: "Read", input: {}, status: "ok" },
      { kind: "tool", id: "edit", runId: "r", toolUseId: "edit-1", name: "Edit", input: {}, status: "ok" },
      { kind: "tool", id: "read-after", runId: "r", toolUseId: "read-2", name: "Read", input: {}, status: "ok" },
    ];

    render(<ProcessFold items={items} defaultCollapsed={true} runId="r" density="workbench" active={false} />);

    expect(screen.getByText("处理文件已完成")).toBeInTheDocument();
    expect(screen.queryByText("读取资料已完成")).not.toBeInTheDocument();
  });

  it("ProcessFold never exposes internal desktop tool names", () => {
    const running: Of<"tool"> = {
      kind: "tool",
      id: "computer-tool",
      runId: "r",
      toolUseId: "computer-use",
      name: "mcp__computer__ui_click",
      input: { name: "Confirm" },
      status: "running",
    };
    render(<ProcessFold items={[running]} defaultCollapsed={true} runId="r" density="workbench" active />);
    expect(screen.getByText("正在电脑应用中点击")).toBeInTheDocument();
    expect(screen.queryByText(/mcp__|ui_click/i)).not.toBeInTheDocument();
  });

  it("ProcessFold follows the assistant activity status even before child tools appear", () => {
    const running: Of<"activity"> = {
      kind: "activity",
      id: "activity-running",
      runId: "r",
      parentToolUseId: "agent-1",
      status: "running",
      childToolUseIds: [],
      tools: [],
      transcript: [],
    };
    const { rerender } = render(
      <ProcessFold items={[running]} defaultCollapsed={true} runId="r" density="workbench" active />,
    );
    expect(screen.getByText("助手正在处理")).toBeInTheDocument();

    rerender(
      <ProcessFold
        items={[{ ...running, status: "error" }]}
        defaultCollapsed={true}
        runId="r"
        density="workbench"
        active={false}
      />,
    );
    expect(screen.getByText("助手未完成")).toBeInTheDocument();
  });

  it("marks a restored unfinished tool as paused instead of still spinning", () => {
    const running: Of<"tool"> = {
      kind: "tool", id: "stale", runId: "old-run", toolUseId: "old-tool", name: "Write", input: {}, status: "running",
    };
    render(
      <BridgeProvider>
        <ProcessFold items={[running]} defaultCollapsed={false} runId="old-run" density="workbench" active={false} />
      </BridgeProvider>,
    );
    expect(screen.getAllByText("上次停在这里").length).toBeGreaterThan(0);
    expect(screen.queryByText("进行中…")).not.toBeInTheDocument();
  });

  it("ThinkingCard renders the model's thought text", () => {
    const item: Of<"thinking"> = { kind: "thinking", id: "1", runId: "r", text: "先看看 PPT", streaming: false };
    render(<ThinkingCard item={item} />);
    expect(screen.getByText(/先看看 PPT/)).toBeInTheDocument();
  });

  it("ThinkingCard renders returned process markdown without raw markers", () => {
    const item: Of<"thinking"> = {
      kind: "thinking", id: "thinking-markdown", runId: "r",
      text: "- 检查资料\n- 汇总结论", streaming: false,
    };
    render(<ThinkingCard item={item} />);
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText("检查资料")).toBeInTheDocument();
  });
});
