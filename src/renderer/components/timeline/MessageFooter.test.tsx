import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import type { TimelineItem } from "../../stores/message-model";
import MessageFooter from "./MessageFooter";

type Result = Extract<TimelineItem, { kind: "result" }>;
type Usage = Extract<TimelineItem, { kind: "usage" }>;
type Memory = Extract<TimelineItem, { kind: "memory" }>;
type Files = Extract<TimelineItem, { kind: "files" }>;

const localTime = new Date(2026, 6, 29, 16, 31).getTime();
const ok: Result = { kind: "result", id: "r", runId: "run-1", isError: false, interrupted: false, finalText: "草稿好了。", pathAudit: { claimed: [] }, createdAt: localTime };
const usage: Usage = { kind: "usage", id: "u", runId: "run-1", usage: { providerId: "p", modelId: "m", inputTokens: 2400, outputTokens: 600, cacheReadTokens: 300, cacheCreationTokens: 0, durationMs: 8_200, costSource: "unpriced", tokensEstimated: false } };
const memory: Memory = {
  kind: "memory",
  id: "mem",
  runId: "run-1",
  changeId: "change-1",
  action: "remembered",
  label: "用户喜欢先看结论",
  scope: { type: "global" },
  undone: false,
};
const files: Files = {
  kind: "files",
  id: "files",
  runId: "run-1",
  changes: [
    { path: "课程笔记/第一章.md", change: "modified" },
    { path: "复习计划.md", change: "added" },
  ],
  omitted: 0,
};

describe("MessageFooter", () => {
  it("a successful result shows time and duration while usage details stay folded", async () => {
    const user = userEvent.setup();
    render(<MessageFooter result={ok} usage={usage} />);
    expect(screen.getByText(/复制/)).toBeInTheDocument();
    expect(screen.getByText(/16:31/)).toBeInTheDocument();
    expect(screen.getByText(/8\.2 秒/)).toBeInTheDocument();
    expect(screen.queryByText(/2\.4k|2400/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /查看用量/ }));
    const details = screen.getByRole("dialog", { name: "用量详情" });
    expect(details).toHaveAttribute("data-anchored-layer");
    expect(screen.getByText(/输入 2\.4k/)).toBeInTheDocument();
    expect(screen.getByText(/缓存 300/)).toBeInTheDocument();
    expect(screen.getByText(/未估价/)).toBeInTheDocument();
  });

  it("separates request preparation and model latency from the interactive wall clock", async () => {
    const user = userEvent.setup();
    const timed: Usage = {
      ...usage,
      usage: {
        ...usage.usage,
        durationMs: 208_215,
        apiDurationMs: 12_140,
        ttftMs: 3_180,
        timeToRequestMs: 420,
      },
    };

    render(<MessageFooter result={ok} usage={timed} />);
    await user.click(screen.getByRole("button", { name: /查看用量/ }));
    const details = screen.getByRole("dialog", { name: "用量详情" });

    expect(within(details).getByText("准备 420 毫秒")).toBeInTheDocument();
    expect(within(details).getByText("首字 3.2 秒")).toBeInTheDocument();
    expect(within(details).getByText("模型请求 12 秒")).toBeInTheDocument();
    expect(within(details).getByText("本轮总历时 3 分 28 秒")).toBeInTheDocument();
  });

  it("shows per-model usage only inside the compact usage popover", async () => {
    const user = userEvent.setup();
    const detailed: Usage = {
      ...usage,
      usage: {
        ...usage.usage,
        modelBreakdown: [
          {
            providerId: "anthropic-subscription",
            modelId: "claude-sonnet-4-5",
            servingProvider: "anthropic",
            inputTokens: 2_000,
            outputTokens: 400,
            cacheReadTokens: 300,
            cacheCreationTokens: 0,
            costUsd: "0.020000",
          },
          {
            providerId: "anthropic-subscription",
            modelId: "claude-haiku-4-5",
            servingProvider: "anthropic",
            inputTokens: 400,
            outputTokens: 200,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            costUsd: "0.002000",
          },
        ],
      },
    };
    render(<MessageFooter result={ok} usage={detailed} />);
    expect(screen.queryByText(/claude-sonnet-4-5/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /查看用量/ }));
    expect(screen.getByText(/claude-sonnet-4-5/)).toBeInTheDocument();
    expect(screen.getByText(/claude-haiku-4-5/)).toBeInTheDocument();
  });

  it("does not repeat the aggregate row when one model is the entire usage breakdown", async () => {
    const user = userEvent.setup();
    const singleModel: Usage = {
      ...usage,
      usage: {
        ...usage.usage,
        providerId: "deepseek",
        modelId: "deepseek-v4-flash",
        modelBreakdown: [{
          providerId: "deepseek",
          modelId: "deepseek-v4-flash",
          servingProvider: "firstParty",
          inputTokens: 2_400,
          outputTokens: 600,
          cacheReadTokens: 300,
          cacheCreationTokens: 0,
          costUsd: "0.020000",
        }],
      },
    };

    render(<MessageFooter result={ok} usage={singleModel} />);
    await user.click(screen.getByRole("button", { name: /查看用量/ }));

    const details = screen.getByRole("dialog", { name: "用量详情" });
    expect(within(details).getAllByText(/deepseek-v4-flash/)).toHaveLength(1);
    expect(within(details).getByText("firstParty")).toBeInTheDocument();
  });

  it("confirms a successful copy instead of leaving the user guessing", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    const previousClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    try {
      render(<MessageFooter result={ok} />);
      await user.click(screen.getByRole("button", { name: "复制回答" }));
      expect(writeText).toHaveBeenCalledWith("草稿好了。");
      expect(await screen.findByText("已复制")).toBeInTheDocument();
    } finally {
      if (previousClipboard) Object.defineProperty(navigator, "clipboard", previousClipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("an interrupted result shows 已停止 and no copy button (finding #2: no empty copy)", () => {
    const interrupted: Result = { ...ok, interrupted: true, finalText: "" };
    render(<MessageFooter result={interrupted} usage={usage} />);
    expect(screen.getByText(/已停止|停下/)).toBeInTheDocument();
    expect(screen.queryByText(/复制/)).not.toBeInTheDocument();
  });

  it("an error result surfaces an error affordance (finding #3)", () => {
    const errored: Result = { ...ok, isError: true, finalText: "" };
    render(<MessageFooter result={errored} usage={usage} />);
    expect(screen.getByText(/没跑完|出错|失败|中断/)).toBeInTheDocument();
    expect(screen.queryByText(/复制/)).not.toBeInTheDocument();
  });

  it("escaped-path audit warning still renders on a successful result", () => {
    const escaped: Result = { ...ok, pathAudit: { claimed: [{ path: "/etc/x", exists: true, withinCwd: false, writeClaim: true }] } };
    render(<MessageFooter result={escaped} usage={usage} />);
    expect(screen.getByText(/当前本子外/)).toBeInTheDocument();
  });

  it("does not render legacy reference-only path records as write warnings", () => {
    const legacy: Result = { ...ok, pathAudit: { claimed: [{ path: "/etc/reference", exists: false, withinCwd: false }] } };
    render(<MessageFooter result={legacy} usage={usage} />);
    expect(screen.queryByText(/当前本子外/)).not.toBeInTheDocument();
  });

  it("keeps the memory receipt on the existing footer line with an accessible undo command", async () => {
    const user = userEvent.setup();
    const onUndoMemory = vi.fn();
    render(
      <MessageFooter
        result={ok}
        usage={usage}
        memory={memory}
        onUndoMemory={onUndoMemory}
      />,
    );

    expect(screen.getByText("记住了：用户喜欢先看结论")).toBeInTheDocument();
    const undo = screen.getByRole("button", { name: "撤销这条记忆" });
    await user.tab();
    while (document.activeElement !== undo) await user.tab();
    await user.keyboard("{Enter}");
    expect(onUndoMemory).toHaveBeenCalledWith(memory);
  });

  it("normalizes and truncates a long receipt while preserving the full label in its title", () => {
    const label = "这是第一行  \n  这是第二行，而且它会继续写得很长很长，用来验证底部回执不会把聊天区域撑成一张醒目的卡片或挤坏布局";
    render(<MessageFooter result={ok} memory={{ ...memory, label }} onUndoMemory={() => undefined} />);

    const full = "这是第一行 这是第二行，而且它会继续写得很长很长，用来验证底部回执不会把聊天区域撑成一张醒目的卡片或挤坏布局";
    const receipt = screen.getByTitle(full);
    expect(receipt.textContent).toContain("…");
    expect(receipt.textContent).not.toContain("\n");
    expect(Array.from(receipt.textContent?.replace(/^记住了：/, "") ?? "").length).toBeLessThanOrEqual(48);
    expect(receipt.className).toMatch(/overflow-hidden/);
    expect(receipt.className).toMatch(/text-ellipsis/);
    expect(receipt.className).toMatch(/whitespace-nowrap/);
    expect(receipt.parentElement?.className).toMatch(/whitespace-nowrap/);
  });

  it("disables undo while pending and renders success only after it is real", () => {
    const { rerender } = render(
      <MessageFooter
        result={ok}
        memory={memory}
        memoryUndoState="pending"
        onUndoMemory={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "正在撤销这条记忆" })).toBeDisabled();
    expect(screen.queryByText("已撤销")).not.toBeInTheDocument();

    rerender(<MessageFooter result={ok} memory={{ ...memory, undone: true }} />);
    expect(screen.getByText("已撤销")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /撤销这条记忆/ })).not.toBeInTheDocument();
  });

  it("keeps a failed undo retryable instead of claiming success", async () => {
    const user = userEvent.setup();
    const onUndoMemory = vi.fn();
    render(
      <MessageFooter
        result={ok}
        memory={memory}
        memoryUndoState="error"
        memoryUndoError="这条记忆后来又被修改了"
        onUndoMemory={onUndoMemory}
      />,
    );

    expect(screen.getByText("撤销失败")).toBeInTheDocument();
    expect(screen.queryByText("已撤销")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试撤销这条记忆" }));
    expect(onUndoMemory).toHaveBeenCalledWith(memory);
  });

  it("uses honest wording for a forget operation", () => {
    render(<MessageFooter result={ok} memory={{ ...memory, action: "removed", label: "旧的求职状态" }} />);
    expect(screen.getByText("已忘掉：旧的求职状态")).toBeInTheDocument();
  });

  it("shows a compact delivery receipt with real file actions", async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    const onRevealFile = vi.fn();
    const { container } = render(
      <MessageFooter
        result={ok}
        files={files}
        onOpenFile={onOpenFile}
        onRevealFile={onRevealFile}
      />,
    );

    expect(screen.getByText("本轮交付 2 个文件")).toBeInTheDocument();
    expect(screen.getByText("课程笔记/第一章.md")).toBeInTheDocument();
    expect(screen.getByText("另 1 个")).toBeInTheDocument();
    expect(screen.queryByText("复习计划.md")).not.toBeInTheDocument();
    expect(screen.getByText("修改")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-file-delivery-receipt]")).toHaveLength(1);
    expect(container.querySelector("[data-file-delivery-receipt]")).toHaveClass("leemo-delivery-receipt");
    expect(screen.getByLabelText("本轮交付文件").parentElement).toHaveClass("text-[12px]");
    expect(container.querySelector("[data-file-delivery-receipt]")).toHaveClass("shadow-none");
    expect(screen.getByRole("button", { name: "预览 课程笔记/第一章.md" })).toHaveClass("text-[12.5px]");

    await user.click(screen.getByRole("button", { name: "预览 课程笔记/第一章.md" }));
    expect(onOpenFile).toHaveBeenCalledWith(files.changes[0]);
    await user.click(screen.getByRole("button", { name: "在文件夹中显示 课程笔记/第一章.md" }));
    expect(onRevealFile).toHaveBeenCalledWith(files.changes[0]);

    await user.click(screen.getByRole("button", { name: "查看文件变化" }));
    expect(screen.getByText("复习计划.md")).toBeInTheDocument();
  });

  it("does not offer stale actions for a deleted file", async () => {
    const user = userEvent.setup();
    render(
      <MessageFooter
        result={ok}
        files={{ ...files, changes: [{ path: "旧稿.md", change: "deleted" }] }}
        onOpenFile={vi.fn()}
        onRevealFile={vi.fn()}
      />,
    );

    expect(screen.getByText("旧稿.md")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "预览 旧稿.md" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "在文件夹中显示 旧稿.md" })).not.toBeInTheDocument();
  });

  it("keeps oversized receipts to one quiet summary row until the user expands details", async () => {
    const user = userEvent.setup();
    const manyFiles: Files = {
      ...files,
      changes: [
        ...files.changes,
        { path: "讲义/第三章.md", change: "added" },
        { path: "讲义/第四章.md", change: "added" },
        { path: "讲义/第五章.md", change: "added" },
      ],
      omitted: 2,
    };
    const { container } = render(<MessageFooter result={ok} files={manyFiles} />);

    expect(screen.getByText("本轮交付 7 个文件")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-delivery-file-row]")).toHaveLength(0);
    expect(screen.getByText("另 6 个")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看文件变化" }));
    expect(container.querySelectorAll("[data-delivery-file-row]")).toHaveLength(2);
    expect(screen.getByText("另有 4 个文件，可在成果页查看")).toBeInTheDocument();
  });
});
