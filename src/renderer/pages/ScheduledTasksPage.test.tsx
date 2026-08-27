import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BridgeProvider } from "../bridge/context";
import { FixtureBridgeClient } from "../bridge/fixture-client";
import { MemorySchedulerClient } from "../scheduler/client";
import ScheduledTasksPage from "./ScheduledTasksPage";

describe("ScheduledTasksPage", () => {
  it("creates a task through the three-part novice flow", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider
        client={new FixtureBridgeClient({ reply: "完成", chunkDelayMs: 1 })}
        scheduler={new MemorySchedulerClient()}
      >
        <ScheduledTasksPage />
      </BridgeProvider>,
    );

    expect(await screen.findByRole("heading", { name: "定时任务" })).toBeInTheDocument();
    expect(screen.getByText("还没有定时任务")).toBeInTheDocument();
    expect(screen.getByTestId("scheduled-empty-state")).toHaveClass("min-h-[104px]", "max-w-[560px]");
    expect(screen.getByTestId("scheduled-empty-state")).toHaveTextContent("从右上角新建一个按时运行的任务");
    expect(screen.queryByRole("dialog", { name: "新建任务" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建任务" })).toHaveClass("rounded-full");
    await user.click(screen.getByRole("button", { name: "新建任务" }));
    const dialog = await screen.findByRole("dialog", { name: "新建任务" });
    expect(screen.getByLabelText("要做什么")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "运行频率" })).toBeInTheDocument();
    expect(screen.getByLabelText("结果放到哪里")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("仅一次");
    expect(dialog).toHaveTextContent("每天");
    expect(dialog).toHaveTextContent("每周");
    expect(dialog).toHaveTextContent("每月");
    expect(dialog).toHaveTextContent("工作日");
    expect(dialog).toHaveTextContent("周末");
    expect(screen.queryByText(/cron/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/模型|技能匹配/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建任务" })).toHaveClass("rounded-full");

    await user.type(screen.getByLabelText("要做什么"), "给我一份 10 分钟英语练习");
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    expect(await screen.findByText("给我一份 10 分钟英语练习")).toBeInTheDocument();
    expect(screen.getByLabelText("暂停 给我一份 10 分钟英语练习")).toBeInTheDocument();
    expect(screen.getByLabelText("立即运行 给我一份 10 分钟英语练习")).toBeInTheDocument();
  });

  it("creates and restores a task with multiple selected weekdays", async () => {
    const user = userEvent.setup();
    const scheduler = new MemorySchedulerClient();
    render(
      <BridgeProvider client={new FixtureBridgeClient()} scheduler={scheduler}>
        <ScheduledTasksPage />
      </BridgeProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "新建任务" }));
    await user.type(await screen.findByLabelText("要做什么"), "周一周三整理求职计划");
    await user.click(screen.getByRole("button", { name: "每周" }));
    await user.click(screen.getByRole("button", { name: "周一" }));
    await user.click(screen.getByRole("button", { name: "周三" }));
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    await waitFor(async () => {
      expect((await scheduler.list()).tasks[0]?.schedule).toEqual({
        kind: "weekly",
        weekdays: [1, 3],
        hour: expect.any(Number),
        minute: expect.any(Number),
      });
    });

    await user.click(screen.getByLabelText("更多 周一周三整理求职计划 操作"));
    await user.click(screen.getByLabelText("编辑 周一周三整理求职计划"));
    expect(screen.getByRole("button", { name: "每周" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "周一" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "周三" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps pause and edit on the same page instead of sending users to settings", async () => {
    const user = userEvent.setup();
    const scheduler = new MemorySchedulerClient();
    await scheduler.create({
      prompt: "整理今日学习记录",
      workspaceId: "leemo-home",
      schedule: { kind: "daily", hour: 21, minute: 0 },
    });
    render(
      <BridgeProvider client={new FixtureBridgeClient()} scheduler={scheduler}>
        <ScheduledTasksPage />
      </BridgeProvider>,
    );

    expect(screen.queryByRole("heading", { name: "新建任务" })).not.toBeInTheDocument();
    const pause = await screen.findByLabelText("暂停 整理今日学习记录");
    await user.click(pause);
    expect(screen.getByLabelText("继续 整理今日学习记录")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "已暂停 1" })).toBeInTheDocument();

    await user.click(screen.getByLabelText("更多 整理今日学习记录 操作"));
    await user.click(screen.getByLabelText("编辑 整理今日学习记录"));
    expect(screen.getByRole("dialog", { name: "编辑任务" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("整理今日学习记录")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "保存修改" })).toBeEnabled());
  });

  it("dismisses a task row menu when clicking elsewhere", async () => {
    const user = userEvent.setup();
    const scheduler = new MemorySchedulerClient();
    await scheduler.create({
      prompt: "整理今日学习记录",
      workspaceId: "leemo-home",
      schedule: { kind: "daily", hour: 21, minute: 0 },
    });
    render(
      <BridgeProvider client={new FixtureBridgeClient()} scheduler={scheduler}>
        <ScheduledTasksPage />
      </BridgeProvider>,
    );

    await user.click(await screen.findByLabelText("更多 整理今日学习记录 操作"));
    expect(screen.getByLabelText("编辑 整理今日学习记录")).toBeInTheDocument();
    await user.pointer({ keys: "[MouseLeft]", target: document.body });
    expect(screen.queryByLabelText("编辑 整理今日学习记录")).not.toBeInTheDocument();
  });

  it("shows a compact repeat-task list with separate scope and enabled controls", async () => {
    const scheduler = new MemorySchedulerClient();
    await scheduler.create({
      prompt: "每晚整理求职进度",
      workspaceId: "leemo-home",
      schedule: { kind: "weekdays", hour: 21, minute: 30 },
    });
    render(
      <BridgeProvider client={new FixtureBridgeClient()} scheduler={scheduler}>
        <ScheduledTasksPage />
      </BridgeProvider>,
    );

    const list = await screen.findByTestId("scheduled-task-list");
    expect(within(list).getByText("范围")).toBeInTheDocument();
    expect(within(list).getByText("状态")).toBeInTheDocument();
    expect(within(list).getByTestId("scheduled-task-row")).toHaveClass("min-h-[64px]");
    expect(within(list).getByTestId("scheduled-task-scope")).toHaveTextContent("Leemo 工作台");
    expect(within(list).getByRole("switch", { name: "暂停 每晚整理求职进度" })).toBeChecked();
  });

  it("filters the real task list by status and search text", async () => {
    const user = userEvent.setup();
    const scheduler = new MemorySchedulerClient();
    const active = await scheduler.create({
      prompt: "整理求职进度",
      workspaceId: "leemo-home",
      schedule: { kind: "daily", hour: 21, minute: 30 },
    });
    const paused = await scheduler.create({
      prompt: "复习英语单词",
      workspaceId: "leemo-home",
      schedule: { kind: "weekdays", hour: 8, minute: 0 },
    });
    await scheduler.setPaused(paused.id, true);
    render(
      <BridgeProvider client={new FixtureBridgeClient()} scheduler={scheduler}>
        <ScheduledTasksPage />
      </BridgeProvider>,
    );

    expect(await screen.findByText("整理求职进度")).toBeInTheDocument();
    expect(screen.getByText("复习英语单词")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "全部 2" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: "已暂停 1" }));
    expect(screen.queryByText("整理求职进度")).not.toBeInTheDocument();
    expect(screen.getByText("复习英语单词")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "全部 2" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索定时任务" }), "求职");
    expect(screen.getByText("整理求职进度")).toBeInTheDocument();
    expect(screen.queryByText("复习英语单词")).not.toBeInTheDocument();
    expect(active.id).toBeTruthy();
  });

  it("keeps a failed run understandable and retryable after the original attempt", async () => {
    const user = userEvent.setup();
    const scheduler = new MemorySchedulerClient();
    const task = await scheduler.create({
      prompt: "整理今晚的学习记录",
      workspaceId: "leemo-home",
      schedule: { kind: "daily", hour: 21, minute: 0 },
    });
    const failedRun = await scheduler.runNow(task.id);
    await scheduler.claim(failedRun.id);
    await scheduler.attachConversation(task.id, "failed-result-conversation");
    await scheduler.complete(
      failedRun.id,
      "failed",
      "failed-result-conversation",
      "模型余额不足，请更换模型后重试。",
    );

    render(
      <BridgeProvider
        client={new FixtureBridgeClient({ reply: "重试完成。", chunkDelayMs: 1 })}
        scheduler={scheduler}
      >
        <ScheduledTasksPage />
      </BridgeProvider>,
    );

    expect(await screen.findByText("模型余额不足，请更换模型后重试。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看 整理今晚的学习记录 的最近结果" })).toBeInTheDocument();

    const actions = screen.getByRole("group", { name: "整理今晚的学习记录 操作" });
    expect(within(actions).getByRole("button", { name: "查看 整理今晚的学习记录 的最近结果" })).toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: "立即运行 整理今晚的学习记录" })).toBeInTheDocument();
    expect(within(actions).getByRole("switch", { name: "暂停 整理今晚的学习记录" })).toBeChecked();
    await user.click(within(actions).getByRole("button", { name: "更多 整理今晚的学习记录 操作" }));
    expect(within(actions).getByRole("button", { name: "编辑 整理今晚的学习记录" })).toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: "删除 整理今晚的学习记录" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重新运行 整理今晚的学习记录" }));
    await waitFor(async () => {
      expect((await scheduler.list()).runs[0]).toMatchObject({ status: "succeeded" });
    });
  });
});
