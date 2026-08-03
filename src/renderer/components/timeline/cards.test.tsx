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

type Of<K extends TimelineItem["kind"]> = Extract<TimelineItem, { kind: K }>;

describe("timeline cards render their data", () => {
  it("ToolCard shows tool name and status", () => {
    const item: Of<"tool"> = { kind: "tool", id: "1", runId: "r", toolUseId: "t", name: "Read", input: {}, status: "ok", summary: "38 pages" };
    render(<ToolCard item={item} />);
    expect(screen.getByText("读取文件")).toBeInTheDocument();
    expect(screen.getByText(/38 pages/)).toBeInTheDocument();
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

  it("PlanCard lists todos with a progress count", () => {
    const item: Of<"plan"> = { kind: "plan", id: "1", runId: "r", toolUseId: "p", todos: [
      { text: "a", status: "done" }, { text: "b", status: "active" }, { text: "c", status: "todo" },
    ] };
    render(<PlanCard item={item} />);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("c")).toBeInTheDocument();
    expect(screen.getByText(/1\s*\/\s*3/)).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "展开分身详情" }));
    expect(screen.getByText("定位到了配置入口。")).toBeInTheDocument();
    expect(screen.getByText("读取文件")).toBeInTheDocument();
    expect(screen.getByText("42 lines")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "展开分身详情" }));

    expect(screen.getByRole("heading", { name: "子任务结论" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("CompactDivider shows a compaction marker", () => {
    const item: Of<"compact"> = { kind: "compact", id: "1", trigger: "auto", preTokens: 1000, postTokens: 300 };
    render(<CompactDivider item={item} />);
    expect(screen.getByText(/压缩|compact/i)).toBeInTheDocument();
  });

  it("TextBubble renders momo text with a streaming caret", () => {
    const item: Of<"text"> = { kind: "text", id: "1", runId: "r", role: "momo", text: "hi", streaming: true };
    render(<TextBubble item={item} />);
    expect(screen.getByText("hi")).toBeInTheDocument();
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

  it("ProcessFold never describes a finished buddy turn as still running", () => {
    const item: Of<"plan"> = {
      kind: "plan", id: "1", runId: "r", toolUseId: "p",
      todos: [{ text: "整理范围", status: "active" }],
    };
    render(<ProcessFold items={[item]} defaultCollapsed={true} runId="r" density="buddy" active={false} />);
    expect(screen.getByText("momo 梳理过步骤")).toBeInTheDocument();
    expect(screen.queryByText(/正在/)).not.toBeInTheDocument();
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
