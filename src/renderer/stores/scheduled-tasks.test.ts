import { describe, expect, it } from "vitest";
import { FixtureBridgeClient } from "../bridge/fixture-client";
import { MemorySchedulerClient } from "../scheduler/client";
import { createConversationsStore } from "./conversations";
import { foldConversationEnvelope } from "./conversations";
import { createNotificationsStore } from "./notifications";
import { createScheduledTasksStore } from "./scheduled-tasks";
import { createWorkspacesStore, HOME_WORKSPACE_ID } from "./workspaces";

function tomorrowAt(hour: number, minute: number): number {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

describe("scheduled tasks store", () => {
  it("runs through the existing conversation path without stealing the active screen", async () => {
    const bridge = new FixtureBridgeClient({ reply: "今天练习完成。", chunkDelayMs: 1 });
    const conversations = createConversationsStore(bridge, {
      resolveConversationDefaults: () => ({ providerId: "deepseek", modelId: "deepseek-chat" }),
      resolveActiveWorkspaceId: () => HOME_WORKSPACE_ID,
    });
    const workspaces = createWorkspacesStore();
    const notifications = createNotificationsStore();
    const scheduler = new MemorySchedulerClient();
    const store = createScheduledTasksStore(scheduler, { conversations, workspaces, notifications });
    const unsubscribe = bridge.subscribe("bridge:event", (envelope) => {
      conversations.setState((state) => foldConversationEnvelope(state, envelope, Date.now()));
    });

    expect(await store.getState().create({
      prompt: "给我一份 10 分钟英语练习",
      workspaceId: HOME_WORKSPACE_ID,
      schedule: { kind: "once", runAt: tomorrowAt(8, 0) },
    })).toBe(true);
    const taskId = store.getState().tasks[0].id;
    expect(await store.getState().runNow(taskId)).toBe(true);

    expect(conversations.getState().activeId).toBeNull();
    expect(Object.values(conversations.getState().byId)).toEqual([
      expect.objectContaining({ title: "给我一份 10 分钟英语练习", workspaceId: HOME_WORKSPACE_ID }),
    ]);
    expect(store.getState().runs[0]).toMatchObject({ status: "succeeded", taskId });
    expect(store.getState().tasks[0].conversationId).toBeTruthy();
    expect(notifications.getState().items[0]).toMatchObject({
      text: "定时任务「给我一份 10 分钟英语练习」已完成",
      kind: "task-done",
    });
    unsubscribe();
  });

  it("records a readable failure when the saved workspace is unavailable", async () => {
    const bridge = new FixtureBridgeClient({ reply: "不会运行", chunkDelayMs: 1 });
    const conversations = createConversationsStore(bridge, {
      resolveConversationDefaults: () => ({ providerId: "deepseek", modelId: "deepseek-chat" }),
    });
    const scheduler = new MemorySchedulerClient();
    const store = createScheduledTasksStore(scheduler, {
      conversations,
      workspaces: createWorkspacesStore(),
      notifications: createNotificationsStore(),
    });
    await store.getState().create({
      prompt: "整理项目进度",
      workspaceId: "missing-project",
      schedule: { kind: "once", runAt: tomorrowAt(9, 0) },
    });

    expect(await store.getState().runNow(store.getState().tasks[0].id)).toBe(false);
    expect(store.getState().error).toContain("找不到");
    expect(store.getState().runs[0]).toMatchObject({ status: "failed" });
    expect(Object.keys(conversations.getState().byId)).toHaveLength(0);
  });
});
