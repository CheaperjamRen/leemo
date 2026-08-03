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
});
