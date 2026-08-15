# Leemo 浏览器自动化产品审计（2026-08-02）

## 结论

Leemo 不应把「Claude in Chrome」作为底座。它要求用户拥有 Anthropic 直连方案，既不符合 Leemo 的多模型路线，也会把 Claude 产品心智重新暴露给用户。当前最佳实践是两条并存：

1. **Leemo 浏览器（默认）**：Playwright 管理的独立、持久身份。开箱可用，不污染用户日常 Chrome，适合重复任务和后续求职自动化。
2. **当前 Chrome（可选）**：通过 Microsoft 官方 Playwright 扩展接入用户已经打开的标签页与登录状态。扩展令牌只进主进程加密配置，renderer 只知道「已保存」。

官方依据：

- Playwright MCP 扩展说明：<https://github.com/microsoft/playwright/blob/main/packages/extension/README.md>
- Playwright Chrome 扩展：<https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm>
- Claude in Chrome 说明：<https://code.claude.com/docs/en/chrome>

## NewMax 做到了什么

本机安装包的只读拆解显示，NewMax 不是简单挂一个浏览器 MCP，而是在 Playwright 之上做了产品层：

- 检测 Chrome；
- 多个浏览器身份及导入、导出、清理；
- 独立浏览器窗口；
- AI 运行、停止与状态；
- 人工接管事件；
- 操作录制、步骤复核、工作流保存与重放；
- 已编排流程失败后由 Agent 接管继续。

本地证据包括 `playwright-core ^1.61.1`、`browserUseStore`、profile/recording/workflow IPC，以及 `browser-use:awaiting-human` / `human-completed` 事件。它说明 Leemo 后续要补的是**身份、接管和可复用工作流的产品层**，不是再换一个浏览器库。

## 当前 Leemo 状态

| 能力 | 状态 | 证据与边界 |
|---|---|---|
| 独立持久浏览器身份 | **Release-verified** | 最终安装包从 `app.asar` 启动 42 项工具；关闭整个 MCP 后用同一 Leemo profile 恢复本地草稿 |
| 导航、点击、输入、选择、截图 | **Implemented** | 开启浏览器后常规动作不逐步弹权限；上传、脚本执行等敏感工具仍询问 |
| 关闭浏览器开关后的结构禁用 | **Implemented** | 所有 `mcp__playwright__*` 工具按保留前缀统一拒绝，未来新增工具不会漏过开关 |
| 当前 Chrome | **Integrated** | 已接 `--extension` 与可选扩展令牌；本机尚未安装扩展，不能写成 release-verified |
| 登录/验证码人工接管 | **Prompt-integrated** | momo 会保留当前会话并请用户短暂接管；尚无 NewMax 式全局接管中心 |
| 最终提交确认 | **Prompt-integrated** | 求职投递、发布、发送、购买等最终动作须在本轮明确授权或再确认；工具层无法只凭“click”判断业务不可逆性 |
| 多浏览器身份 | **Not implemented** | 当前只有一个 Leemo profile 与一个当前 Chrome 入口 |
| 录制与复用工作流 | **Not implemented** | 后续求职自动化卡，不阻塞英语学习 MVP |

## 本轮界面与运行证据

零模型费用验收脚本：`scripts/verify-browser-automation-ui.mjs`。

- 真 Electron：`浏览器已就绪 · 42 项能力 · 317 ms`；
- 设置页 `1440x900` / `720x640`：横向溢出 0，两种浏览器身份卡等宽；
- AskUserCard：`1280x860` 为 `686 / 686 px`，`720x640` 为 `638 / 638 px`，均可完整滚入可视区；
- 工作台输入区：大屏最大 880px，1920/1440 居中，720 自动收缩；去掉工具栏式顶部分隔线，改为独立阴影悬浮。

结构化证据：`docs/research/audit-shots/browser-automation-ui-facts.json`。

## 最终安装包验收

`scripts/verify-packaged-browser-mcp.mjs` 直接使用 `dist-package/win-unpacked/Leemo.exe`，没有调用模型或外网：

1. 从安装包 `app.asar` 内启动 Playwright MCP，列出 42 项工具；
2. 打开本机临时 HTTP 页面，输入并点击保存；
3. 关闭浏览器与整个 MCP 进程；
4. 以同一 profile 重新启动 MCP，页面显示 `Draft restored: Leemo persistent browser proof`；
5. 截图目验通过，证据为 `packaged-browser-mcp.png` 与 `packaged-browser-mcp-facts.json`。

最终 NSIS 为 `190,117,572 B`，SHA-256 `D7B8CD8BE539C0528060CC8DDE4247868B6B5980F72393757060AF79884D946D`；解包仍为 498 个文件 / `756,607,565 B`，`app.asar 93,589,956 B`。相对上一轮 Skills/Office 包，安装器只增加 `3,817 B`，没有新增解包文件。

## 后续边界

### 本轮已完成

1. 最终安装包本地表单与 MCP 重启恢复已通过。
2. 保留失败、人类接管、最终提交确认三条安全出口；不为每次常规点击重复弹卡。
3. 收口当前 Skills/Office 与浏览器里程碑，避免工作区继续积累未归档改动。

### 有用户或进入求职自动化后做

1. 多浏览器身份及站点绑定；
2. 显式「需要你接管」状态与完成后继续；
3. 可复用浏览器任务、录制/复核/重放；
4. 简历投递专用流程，最终提交永远保留用户控制权。

### 明确不在当前卡做

- worktree、LSP、Hooks、checkpoint/rewind 等编程专用 UI；
- 云端浏览器农场；
- 自动绕过验证码或替用户处理二次验证。
