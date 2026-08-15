# 当前 Chrome 配置旅程验证（2026-08-03）

## 用户结果

1. “Leemo 浏览器”仍是稳定默认路径。用户点选“当前 Chrome”时只展开配置，不会在扩展尚未就绪时提前切断原路径。
2. 点击“保存并检查连接”后，Leemo 先保存配置，再调用主进程的真实 MCP 探测；不要求用户保存后再找第二个检查按钮。
3. 配置改变会清除旧结果。扩展未连接时显示可行动的等待说明，`browser_tabs` 真实成功后才显示就绪。
4. 普通界面不出现 Playwright 或 MCP 品牌；可选连接令牌仍只保存于主进程密钥存储边界。

## 实现证据

- `src/renderer/components/BrowserAutomationSection.tsx`：草稿模式、保存后自动检查和人话状态。
- `src/renderer/stores/mcp-servers.ts`：保存配置后清除该服务的陈旧探测结果。
- `src/host/mcp-probe.ts`：扩展模式必须真实调用 `browser_tabs`，并区分等待连接与就绪。
- 官方扩展行为依据：Microsoft Playwright Extension README，<https://github.com/microsoft/playwright/blob/main/packages/extension/README.md>。

## 自动验证

```text
npx vitest run src/renderer/components/BrowserAutomationSection.test.tsx src/renderer/stores/mcp-servers.test.ts tests/host/mcp-probe.test.ts tests/host/bridge-host-mcp.test.ts tests/host/mcp-config.test.ts
5 files / 27 tests passed

npm run typecheck
3 TypeScript projects passed

git diff --check
passed
```

## 真实扩展验收（2026-08-06）

用户在本机 Chrome 安装 Microsoft Playwright Extension 后，最终打包版已完成零模型费用验收：

1. 只连接脚本新建且标题唯一的本地测试标签，不读取用户其他页面；
2. 从 `app.asar` 启动随包 Playwright MCP，列出 42 项工具；
3. 真实调用 `browser_tabs`、`browser_snapshot`、`browser_type` 与 `browser_click`；
4. 关闭并重启整个 MCP 进程，再次连接同一标签并刷新本地页面，已保存状态恢复；
5. 在隔离的 Leemo 用户目录保存“当前 Chrome”，重启整应用后设置页仍选中该模式；
6. 未填写扩展令牌，连接确认遵循官方扩展默认行为；模型调用为 0。

可复跑命令：

```text
npm run verify:current-chrome
```

结构化事实写入 `docs/research/audit-shots/current-chrome-extension-facts.json`，作为本地验收产物，不进入源码提交。当前 Chrome 状态由 **Integrated** 提升为 **Release-verified**。
