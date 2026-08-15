import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ConversationListItem from "./ConversationListItem";
import type { ConversationMeta } from "../stores/conversations";

const CONVERSATION: ConversationMeta = {
  id: "conversation-1",
  title: "高数复习计划",
  titleManuallyUpdated: true,
  bookId: "高等数学",
  workspaceId: "leemo-home",
  source: "workbench",
  providerId: "provider",
  modelId: "model",
  createdAt: 1,
  lastActivityAt: 2,
  lastOpenedAt: 2,
  pinned: false,
  archived: false,
  unread: false,
};

describe("ConversationListItem lifecycle menu", () => {
  it("keeps workbench conversations readable without inflating the sidebar", () => {
    render(
      <ConversationListItem
        conversation={CONVERSATION}
        active
        variant="workbench"
        onPick={vi.fn()}
        onRename={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "高数复习计划" })).toHaveClass("h-9", "text-[13px]");
    expect(screen.getByRole("button", { name: "高数复习计划" })).toHaveClass("focus-visible:outline-none");
    expect(screen.getByRole("button", { name: "高数复习计划" }).parentElement).toHaveClass("focus-within:ring-2");
  });

  it("offers a quiet unread toggle and keeps the dot on the active row", async () => {
    const user = userEvent.setup();
    const onUnread = vi.fn(async () => undefined);
    render(
      <ConversationListItem
        conversation={{ ...CONVERSATION, unread: true }}
        active
        variant="workbench"
        onPick={vi.fn()}
        onRename={vi.fn()}
        onUnread={onUnread}
        status={{ kind: "completed", label: "已完成", detail: "任务已完成", runId: "run-1" }}
      />,
    );

    expect(screen.getByRole("img", { name: "高数复习计划：未读" })).toBeInTheDocument();
    expect(screen.queryByText("已完成")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "更多操作：高数复习计划" }));
    await user.click(screen.getByRole("button", { name: "标记已读" }));
    expect(onUnread).toHaveBeenCalledWith(false);
  });

  it("shows only the error icon when a failed run is also unread", () => {
    render(
      <ConversationListItem
        conversation={{ ...CONVERSATION, unread: true }}
        active={false}
        variant="workbench"
        onPick={vi.fn()}
        onRename={vi.fn()}
        status={{ kind: "failed", label: "失败", detail: "这次没有完成", runId: "run-1" }}
      />,
    );

    expect(screen.getByRole("img", { name: "高数复习计划：报错" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "高数复习计划：未读" })).not.toBeInTheDocument();
    expect(screen.queryByText("失败")).not.toBeInTheDocument();
  });

  it("keeps row actions quiet until the overflow menu is opened", async () => {
    const user = userEvent.setup();
    const onPin = vi.fn(async () => undefined);
    render(
      <ConversationListItem
        conversation={CONVERSATION}
        active={false}
        variant="workbench"
        onPick={vi.fn()}
        onRename={vi.fn()}
        onPin={onPin}
      />,
    );

    expect(screen.queryByRole("button", { name: "置顶" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "更多操作：高数复习计划" }));
    await user.click(screen.getByRole("button", { name: "置顶" }));

    expect(onPin).toHaveBeenCalledWith(true);
  });

  it("moves through a named book target instead of exposing workspace ids", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn(async () => undefined);
    render(
      <ConversationListItem
        conversation={CONVERSATION}
        active
        variant="workbench"
        onPick={vi.fn()}
        onRename={vi.fn()}
        moveTargets={[
          { workspaceId: "leemo-home", bookId: "求职", label: "求职" },
          { workspaceId: "workspace-private", bookId: null, label: "毕业论文" },
        ]}
        onMove={onMove}
      />,
    );

    await user.click(screen.getByRole("button", { name: "更多操作：高数复习计划" }));
    await user.click(screen.getByRole("button", { name: "移动到其他本子" }));
    expect(screen.queryByText("workspace-private")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "移动到求职" }));

    expect(onMove).toHaveBeenCalledWith({ workspaceId: "leemo-home", bookId: "求职", label: "求职" });
  });

  it("uses the compact approved labels in the buddy history menu", async () => {
    const user = userEvent.setup();
    render(
      <ConversationListItem
        conversation={{ ...CONVERSATION, source: "buddy", bookId: null }}
        active
        variant="buddy"
        onPick={vi.fn()}
        onRename={vi.fn()}
        moveTargets={[{ workspaceId: "leemo-home", bookId: "求职", label: "求职" }]}
        onMove={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "更多操作：高数复习计划" }));
    const menu = document.querySelector("[data-conversation-menu]");
    expect(menu).not.toBeNull();
    expect(menu?.closest("[data-anchored-layer]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "移动到其他本子" })).toHaveTextContent("移动到本子");
    expect(screen.getByRole("button", { name: "删除对话" })).toHaveTextContent(/^删除$/);
  });

  it("renders workbench actions in a viewport-aware anchored layer instead of a clipped downward menu", async () => {
    const user = userEvent.setup();
    render(
      <ConversationListItem
        conversation={CONVERSATION}
        active
        variant="workbench"
        onPick={vi.fn()}
        onRename={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "更多操作：高数复习计划" }));
    const layer = document.querySelector("[data-anchored-layer]");
    expect(layer).not.toBeNull();
    expect(layer).toHaveAttribute("role", "menu");
    expect(layer).toHaveAttribute("data-placement");
  });

  it("requires an inline confirmation before permanent deletion", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(async () => undefined);
    render(
      <ConversationListItem
        conversation={CONVERSATION}
        active={false}
        variant="workbench"
        onPick={vi.fn()}
        onRename={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByRole("button", { name: "更多操作：高数复习计划" }));
    await user.click(screen.getByRole("button", { name: "删除对话" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("删除后无法恢复")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认删除对话" }));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("uses restore language for an archived conversation", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn(async () => undefined);
    render(
      <ConversationListItem
        conversation={{ ...CONVERSATION, archived: true }}
        active={false}
        variant="workbench"
        onPick={vi.fn()}
        onRename={vi.fn()}
        onArchive={onArchive}
      />,
    );

    await user.click(screen.getByRole("button", { name: "更多操作：高数复习计划" }));
    await user.click(screen.getByRole("button", { name: "移出归档" }));
    expect(onArchive).toHaveBeenCalledWith(false);
  });
});
