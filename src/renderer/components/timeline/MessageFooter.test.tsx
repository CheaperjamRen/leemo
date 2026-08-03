import { render, screen } from "@testing-library/react";
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
    expect(screen.getByText(/输入 2\.4k/)).toBeInTheDocument();
    expect(screen.getByText(/缓存 300/)).toBeInTheDocument();
    expect(screen.getByText(/未估价/)).toBeInTheDocument();
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

  it("keeps file changes to one quiet expandable line", async () => {
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

    const receipt = screen.getByRole("button", { name: "查看文件变化" });
    expect(receipt).toHaveTextContent("修改了 2 个文件");
    expect(screen.queryByText("课程笔记/第一章.md")).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-file-change-receipt]")).toHaveLength(1);
    expect(container.querySelector("[data-file-change-card]")).toBeNull();

    await user.click(receipt);
    expect(screen.getByText("课程笔记/第一章.md")).toBeInTheDocument();
    expect(screen.getByText("复习计划.md")).toBeInTheDocument();
    expect(screen.getByText("新建")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "预览 课程笔记/第一章.md" }));
    expect(onOpenFile).toHaveBeenCalledWith(files.changes[0]);
    await user.click(screen.getByRole("button", { name: "在文件夹中显示 课程笔记/第一章.md" }));
    expect(onRevealFile).toHaveBeenCalledWith(files.changes[0]);
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

    await user.click(screen.getByRole("button", { name: "查看文件变化" }));
    expect(screen.getByText("旧稿.md")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "预览 旧稿.md" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "在文件夹中显示 旧稿.md" })).not.toBeInTheDocument();
  });

  it("states the real total while keeping oversized receipts bounded", async () => {
    const user = userEvent.setup();
    render(<MessageFooter result={ok} files={{ ...files, omitted: 18 }} />);

    const receipt = screen.getByRole("button", { name: "查看文件变化" });
    expect(receipt).toHaveTextContent("修改了 20 个文件");
    await user.click(receipt);
    expect(screen.getByText("另有 18 个文件未展开")).toBeInTheDocument();
  });
});
