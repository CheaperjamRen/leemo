import { describe, expect, it } from "vitest";
import { permissionToolLabel, toolActionLabel, toolResultLabel } from "./tool-labels";

describe("desktop tool labels", () => {
  it("keeps internal server and tool names out of user-facing text", () => {
    expect(toolActionLabel("mcp__computer__ui_snapshot")).toBe("查看电脑界面");
    expect(toolActionLabel("mcp__computer__ui_click")).toBe("在电脑应用中点击");
    expect(toolActionLabel("mcp__computer__ui_type")).toBe("在电脑应用中输入");
    expect(toolResultLabel("mcp__computer__ui_snapshot", "ok")).toBe("已查看电脑界面");
    expect(toolResultLabel("mcp__computer__ui_click", "error")).toBe("电脑操作失败");
    expect(permissionToolLabel("mcp__computer__ui_click")).not.toMatch(/MCP|computer|ui_click/i);
  });

  it("describes Leemo scheduling actions without calling them third-party tools", () => {
    expect(toolActionLabel("mcp__leemo-scheduler__create_scheduled_task")).toBe("创建定时任务");
    expect(toolActionLabel("mcp__leemo-scheduler__update_scheduled_task")).toBe("修改定时任务");
    expect(toolActionLabel("mcp__leemo-scheduler__delete_scheduled_task")).toBe("删除定时任务");
    expect(toolActionLabel("mcp__leemo-scheduler__run_scheduled_task_now")).toBe("立即运行定时任务");
  });

  it("describes Leemo notes and tasks as first-party workboard actions", () => {
    expect(toolActionLabel("mcp__leemo-workboard__list_notes")).toBe("查看便签");
    expect(toolActionLabel("mcp__leemo-workboard__create_note")).toBe("保存便签");
    expect(toolActionLabel("mcp__leemo-workboard__update_note")).toBe("修改便签");
    expect(toolActionLabel("mcp__leemo-workboard__delete_note")).toBe("删除便签");
    expect(toolActionLabel("mcp__leemo-workboard__list_tasks")).toBe("查看待办");
    expect(toolActionLabel("mcp__leemo-workboard__create_tasks")).toBe("批量创建待办");
    expect(toolActionLabel("mcp__leemo-workboard__update_task")).toBe("修改待办");
    expect(toolActionLabel("mcp__leemo-workboard__set_task_completed")).toBe("更新待办状态");
    expect(permissionToolLabel("mcp__leemo-workboard__delete_task")).toBe("删除待办");
  });

  it("describes Leemo overview updates as first-party metadata", () => {
    expect(toolActionLabel("mcp__leemo-work-overview__set_work_overview")).toBe("更新工作概览");
  });
});
