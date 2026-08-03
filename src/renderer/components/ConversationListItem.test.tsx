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
