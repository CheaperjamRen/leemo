# Leemo r9b 任务与成果连续性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让任务和成果在关闭、重启 Leemo 后仍从真实时间线和本子文件恢复，并能回到来源对话继续。

**Architecture:** 对话时间线和本子文件继续作为事实源；任务状态与成果索引均由现有事件推导，Zustand 只保存当前投影和加载生命周期，不新增数据库真源。

**Tech Stack:** React 19、TypeScript、Zustand、Electron IPC、SQLite 对话持久化、Vitest、Testing Library。

## Global Constraints

- 不新增第二套任务状态表或成果数据库。
- 重启后的旧 `running` 必须降级为可继续的 `waiting`，绝不伪装后台仍在运行。
- 同一路径只显示最新成果；工作区外路径明确警告且不冒充本子文件。
- 每个任务先红后绿，最后必须用打包应用关闭并重启验证。

---

## Task 1：从持久化时间线重建成果

**Files:**

- Modify: `src/renderer/stores/artifacts.test.ts`
- Modify: `src/renderer/stores/artifacts.ts`
- Modify: `src/renderer/bridge/context.tsx`
- Modify: `src/renderer/bridge/wiring.test.ts`

- [x] 新增 `deriveArtifactsFromConversations` 测试，覆盖成功 Write/Edit、可视化 `file`/`file_path`/`path`、失败工具忽略、同路径取最新、来源对话/轮次和工作区逃逸。
- [x] 新增 store `loading/ready/error` 与 `hydrate(entries)` 测试。
- [x] 运行定向测试确认当前只支持实时登记且漏掉 visualization `file`。
- [x] 实现纯重建函数和 store 生命周期；BridgeProvider 在对话及本子加载完成后一次性重建，再继续接收实时事件。
- [x] 保证实时登记和重建采用同一去重规则，并保留子 Agent 工具输入以纳入成果。
- [x] 重跑 artifacts、message-model、context 与 wiring 测试。
- [x] Commit: `feat(r9): rebuild artifacts from persisted timelines`

## Task 2：推导六态任务状态

**Files:**

- Create: `src/renderer/stores/conversation-status.ts`
- Create: `src/renderer/stores/conversation-status.test.ts`
- Modify: `src/renderer/components/HistoryDrawer.tsx`
- Modify: `src/renderer/components/WorkbenchShell.tsx`

- [x] 为 waiting/running/blocked/failed/canceled/completed 六态写表驱动测试，覆盖待审批、待回答、显式错误、用户中断、成功结果和重启未收尾轮次。
- [x] 运行测试确认 selector 尚不存在。
- [x] 实现纯 selector，只读取 runId、交互状态和时间线终止事件。
- [x] 在历史列表与当前任务标题区显示克制状态和真实下一步，不增加假进度百分比。
- [x] 重跑 selector、HistoryDrawer 和 WorkbenchShell 测试。
- [x] Commit: `feat(r9): derive trustworthy task states`

## Task 3：来源回跳、预览错误与继续动作

**Files:**

- Modify: `src/renderer/pages/ArtifactsPage.test.tsx`
- Modify: `src/renderer/pages/ArtifactsPage.tsx`
- Modify: `src/renderer/components/PreviewPane.test.tsx`
- Modify: `src/renderer/components/PreviewPane.tsx`
- Modify: `src/renderer/components/HistoryDrawer.test.tsx`

- [x] 测试成果来源按钮切换到正确对话与 chat view。
- [x] 测试文件已删除、无权限、不可预览和重试后恢复，错误必须保留真实路径与人话下一步。
- [x] 测试重启未结束任务显示“上次停在这里，可以继续”，点击后只打开原对话，不自动发送或消耗额度。
- [x] 运行测试确认失败，再接通动作与错误分类。
- [x] 重跑定向测试。
- [x] Commit: `fix(r9): connect artifact source and recovery actions`

## Task 4：打包应用连续路径验收

**Files:**

- Create: `scripts/e2e-r9-continuity.cjs`
- Create: `docs/research/r9b-packaged-continuity.md`

- [ ] 构造临时本子，真实发起会写 Markdown 文件的任务，并处理一次审批或结构化追问。
- [ ] 断言对话出现完成态、成果页能打开真实文件、来源回跳正确。
- [ ] 正常关闭应用并重新启动同一安装包，断言对话、状态、成果和预览恢复。
- [ ] 对失败与中断各跑一次，确认不会错误显示完成或运行中。
- [ ] 运行 `npm test`、`npm run typecheck`、`npm run build`、`npm run build:main`、打包 E2E。
- [ ] 记录安装包大小、安装耗时、冷启动耗时和空闲内存，仅把明显回归作为本轮阻断。
- [ ] Commit: `test(r9): verify packaged task continuity`
