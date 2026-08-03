import { render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByLabelText("要做什么")).toBeInTheDocument();
    expect(screen.getByLabelText("运行频率")).toBeInTheDocument();
    expect(screen.getByLabelText("结果放到哪里")).toBeInTheDocument();
    expect(screen.queryByText(/cron/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/模型|技能匹配/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("要做什么"), "给我一份 10 分钟英语练习");
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    expect(await screen.findByText("给我一份 10 分钟英语练习")).toBeInTheDocument();
    expect(screen.getByLabelText("暂停 给我一份 10 分钟英语练习")).toBeInTheDocument();
    expect(screen.getByLabelText("立即运行 给我一份 10 分钟英语练习")).toBeInTheDocument();
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

    const pause = await screen.findByLabelText("暂停 整理今日学习记录");
    await user.click(pause);
    expect(await screen.findByText("已暂停")).toBeInTheDocument();
    expect(screen.getByLabelText("继续 整理今日学习记录")).toBeInTheDocument();

    await user.click(screen.getByLabelText("编辑 整理今日学习记录"));
    expect(screen.getByRole("heading", { name: "编辑任务" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("整理今日学习记录")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "保存修改" })).toBeEnabled());
  });
});
