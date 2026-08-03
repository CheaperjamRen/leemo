const NATIVE_TOOL_ACTIONS: Readonly<Record<string, string>> = {
  Read: "读取文件",
  Grep: "搜索文件内容",
  Glob: "查找文件",
  Write: "写入文件",
  Edit: "编辑文件",
  NotebookRead: "读取笔记本",
  NotebookEdit: "编辑笔记本",
  Bash: "执行命令",
  PowerShell: "执行命令",
  KillShell: "停止运行中的命令",
};

export function isMcpToolName(toolName: string): boolean {
  return toolName.startsWith("mcp__");
}

function mcpActionName(toolName: string): string {
  return toolName.split("__").at(-1)?.toLowerCase() ?? "";
}

export function toolResultLabel(
  toolName: string,
  status: "running" | "ok" | "error",
  fallback?: string,
): string {
  if (toolName.startsWith("mcp__computer__")) {
    if (status === "running") return "正在操作电脑…";
    if (status === "error") return "电脑操作失败";
    const action = mcpActionName(toolName);
    if (["ui_snapshot", "screenshot_control", "ui_read", "ui_find", "ui_read_table"].includes(action)) return "已查看电脑界面";
    if (["ui_click", "mouse_control", "ui_select"].includes(action)) return "已在电脑应用中操作";
    if (["ui_type", "keyboard_control"].includes(action)) return "已在电脑应用中输入";
    if (action === "app") return "已打开电脑应用";
    if (action === "ui_wait") return "已等待界面更新";
    return "已完成电脑操作";
  }
  if (!toolName.startsWith("mcp__playwright__")) {
    return fallback ?? (status === "running" ? "进行中…" : status === "error" ? "失败" : "完成");
  }
  if (status === "running") return "进行中…";
  if (status === "error") return "网页操作失败";

  const action = mcpActionName(toolName);
  if (action === "browser_snapshot") return "已读取当前页面";
  if (action === "browser_take_screenshot") return "已截取当前页面";
  if (action === "browser_navigate") return "已打开网页";
  if (action === "browser_tabs") return "已读取浏览器标签页";
  return "已完成网页操作";
}

/** User-facing action phrase. Internal SDK/MCP identifiers stay in transport
 * data and never become the product language shown on an approval card. */
export function toolActionLabel(toolName: string): string {
  const native = NATIVE_TOOL_ACTIONS[toolName];
  if (native) return native;
  if (!isMcpToolName(toolName)) return "使用工具";

  const action = mcpActionName(toolName);
  if (toolName.startsWith("mcp__computer__")) {
    if (["ui_snapshot", "screenshot_control", "ui_read", "ui_find", "ui_read_table"].includes(action)) return "查看电脑界面";
    if (["ui_click", "mouse_control", "ui_select"].includes(action)) return "在电脑应用中点击";
    if (["ui_type", "keyboard_control"].includes(action)) return "在电脑应用中输入";
    if (action === "app") return "打开电脑应用";
    if (action === "ui_wait") return "等待电脑界面更新";
    if (action === "window_management") return "切换电脑窗口";
    return "操作电脑";
  }
  if (action === "browser_take_screenshot") return "截取网页画面";
  if (action === "browser_snapshot") return "读取网页内容";
  if (action === "browser_navigate") return "打开网页";
  if (/^browser_(?:click|type|press_key|mouse_click_xy)$/.test(action)) return "在网页上完成最终操作";
  if (/^browser_evaluate$/.test(action)) return "在网页中执行脚本";
  if (/install.*skill|skill.*install/.test(action)) return "安装技能";
  if (/remove.*skill|uninstall.*skill/.test(action)) return "移除技能";
  if (/(publish|post)/.test(action)) return "通过第三方工具发布内容";
  if (/(send|message)/.test(action)) return "通过第三方工具发送内容";
  if (/(purchase|buy|pay)/.test(action)) return "通过第三方工具付款或购买";
  if (/(delete|remove)/.test(action)) return "通过第三方工具删除数据";
  if (/upload/.test(action)) return "通过第三方工具上传文件";
  if (/(create|add)/.test(action)) return "通过第三方工具创建内容";
  if (/(update|edit|write)/.test(action)) return "通过第三方工具修改内容";
  return "使用第三方工具";
}

export function permissionToolLabel(toolName: string): string {
  return toolActionLabel(toolName).replace(/^通过第三方工具/, "第三方工具：");
}
