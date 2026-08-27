# Leemo 运行可靠性与搭子连续性实施计划

> 规格：`docs/superpowers/specs/2026-08-27-runtime-reliability-and-buddy-continuity-design.md`
>
> 执行方法：聚焦测试先失败，再做最小实现；每个阶段提交可回滚的功能单元；最终以真实 Electron 路径和安装包复验。

## 总体验收边界

本轮完成的判断以五组真实结果为准：

1. TokenFlux 权限失败能被准确分类，切换 GLM 后输入“继续”会回到简历与面试材料；
2. 长时间流式运行中，顶部导航、设置、执行过程和停止按钮保持可用；
3. 1M 设置、模型上限和当前 session snapshot 分开显示并能诊断差异；
4. 31.7MB PDF 经 Leemo 文档引擎读取；
5. 基础菜单、README、重启和安装包路径通过整体检查。

## Task 1：建立连续性回归样本与可信 session 语义

**Files**
- Modify: `src/bridge/events.ts`
- Modify: `src/bridge/contract.ts`
- Modify: `src/renderer/stores/conversations.ts`
- Modify: `src/main/persistence/schema.ts`
- Modify: `src/main/persistence/db.ts`
- Test: `tests/bridge/events.test.ts`
- Test: `src/renderer/stores/conversations.test.ts`
- Test: `tests/main/persistence.test.ts`

1. RED：写出“成功运行 s-good → 权限失败 s-bad → 切换 provider”的事件序列，证明 s-bad 不能覆盖上一份可信 session。
2. RED：旧数据库只有 `sessionId` 时可迁移；新数据同时记录 provider 所有者，另一 provider 不复用该 session。
3. GREEN：`run.finished` 提供明确的 session commit 语义；store 只在可信终态更新 session ref。
4. GREEN：持久化 schema 和 hydration 保留兼容，失败 run 诊断仍完整保存。
5. VERIFY：聚焦测试覆盖成功、权限失败、网络失败、产生内容后中断和旧数据迁移。
6. COMMIT：`fix: preserve trusted conversation sessions`

## Task 2：实现确定性的搭子章节检查点与恢复消息

**Files**
- Add: `src/renderer/stores/relationship-continuity.ts`
- Add: `src/renderer/stores/relationship-continuity.test.ts`
- Modify: `src/renderer/stores/conversations.ts`
- Modify: `src/renderer/stores/relationship-chapters.ts`
- Modify: `src/renderer/components/BuddyShell.tsx`
- Modify: `src/host/bridge-host.ts`
- Modify: `src/host/momo-prompt.ts`
- Test: `src/renderer/components/BuddyShell.test.tsx`
- Test: `tests/host/bridge-host.test.ts`

1. RED：用用户实际时间线 fixture 表达：面试材料消息、momo 承诺读取、连续 502、“继续”；预期检查点仍指向面试故事，且不包含流程图。
2. RED：纯“继续/重试”、零进展失败和旧工作区文件不能推进检查点；新话题会开启新的 chapter checkpoint。
3. GREEN：从当前章节事实派生有界 checkpoint，记录 basis run、附件名、用户意图、assistant 承诺和工具进展。
4. GREEN：provider 切换、重启恢复、session 不可信和弱指代续接时，在最新用户消息末尾注入隐藏的 `[Leemo 章节续接]`；普通稳定轮次保持 payload 前缀不变。
5. GREEN：证据不足时请求用户说明要继续的事项，跳过工作区任务猜测。
6. VERIFY：真实 fixture、模型切换、三次失败、停止、重启和新话题全部通过。
7. COMMIT：`fix: recover buddy chapters from local checkpoints`

## Task 3：保留上游错误类型并修复恢复入口

**Files**
- Modify: `src/gateway/server.ts`
- Modify: `src/host/provider-errors.ts`
- Modify: `src/host/provider-test.ts`
- Modify: `src/bridge/events.ts`
- Modify: `src/renderer/components/timeline/TurnBlock.tsx`
- Modify: `src/renderer/pages/SettingsPage.tsx`
- Test: `tests/gateway/server.test.ts`
- Test: `tests/host/provider-errors.test.ts`
- Test: `tests/host/provider-test.test.ts`
- Test: relevant renderer component tests

1. RED：上游 401、403、404、429、5xx 和 fetch failure 形成不同 failure kind，输出不含原始 key/header/body。
2. RED：TokenFlux 403 模型权限 fixture 在 UI 显示“模型权限”，并提供模型设置/切换入口；该类错误不执行五次无效重连。
3. GREEN：Gateway 返回清洗后的结构化错误元数据，host 统一分类，renderer 使用 recovery action 渲染。
4. GREEN：普通运行错误卡与设置连接测试共用同一分类源。
5. VERIFY：快照检查用户文案、详情展开和敏感信息清洗。
6. COMMIT：`fix: classify provider failures accurately`

## Task 4：增加统一网络模式并贯通运行时

**Files**
- Add: `src/host/network-runtime.ts`
- Add: `tests/host/network-runtime.test.ts`
- Modify: `src/bridge/contract.ts`
- Modify: `src/host/provider-config.ts`
- Modify: `src/host/bridge-host.ts`
- Modify: `src/gateway/server.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/stores/settings.ts`
- Modify: `src/renderer/pages/SettingsPage.tsx`
- Modify: `src/renderer/pages/SettingsPage.css`
- Test: `src/renderer/stores/settings.test.ts`
- Test: `src/renderer/pages/SettingsPage.test.tsx`
- Test: `tests/host/bridge-host-providers.test.ts`

1. RED：自动、直连、手动代理三种配置产生确定的 fetch 与子进程 env；localhost 始终进入 `NO_PROXY`；含 URL 用户名/密码的手动代理被拒绝。
2. RED：设置改变会让下一轮重建 provider/gateway transport，旧运行不被中途改写。
3. GREEN：主进程读取系统代理并生成单一 `NetworkRuntimeConfig`；Gateway 使用注入 fetch；provider 子进程接收受控代理 env。
4. GREEN：设置页新增网络模式、手动地址、测试当前连接和测试所选模型；凭据保持主进程边界。
5. VERIFY：当前 `127.0.0.1:10801` 自动模式、直连、无效代理、重启恢复和模型测试通过。
6. COMMIT：`feat: add recoverable network settings`

## Task 5：为流式事件、时间线和持久化增加背压

**Files**
- Add: `src/renderer/bridge/event-batcher.ts`
- Add: `src/renderer/bridge/event-batcher.test.ts`
- Modify: `src/renderer/bridge/wiring.ts`
- Modify: `src/renderer/stores/conversations.ts`
- Modify: `src/renderer/components/BuddyShell.tsx`
- Modify: `src/renderer/components/timeline/TurnBlock.tsx`
- Modify: `src/renderer/components/timeline/TextBubble.tsx`
- Modify: `src/renderer/components/MarkdownContent.tsx`
- Modify: `src/renderer/persistence/sync.ts`
- Modify: `src/main/persistence/db.ts`
- Test: `src/renderer/bridge/wiring.test.ts`
- Test: `src/renderer/components/BuddyShell.test.tsx`
- Test: `src/renderer/components/MarkdownContent.test.tsx`
- Test: `src/renderer/persistence/sync.test.ts`
- Test: `tests/main/persistence.test.ts`

1. RED：投递 2,000 个 delta 时，store 更新次数有界；结构事件仍立即到达；完成的历史 TurnBlock 不随活动 run delta 重渲染。
2. RED：活动 run 安静 300ms 不再触发完整 delete/reinsert；用户消息、结构检查点和终态仍在规定窗口内落盘。
3. GREEN：delta 按帧/33ms 合并，结构事件先 flush；completed turn 与 Markdown 使用稳定 memo；BuddyShell 改为窄 selector 和缓存投影。
4. GREEN：持久化采用脏段或增量 upsert；活动文本以低频检查点写入，终态立即写入。
5. VERIFY：高频流、40 轮历史和长 Markdown 的交互延迟/渲染次数测试通过；异常退出恢复保留最近检查点。
6. COMMIT：`perf: keep the renderer responsive while streaming`

## Task 6：拆分停止确认与后台清理

**Files**
- Modify: `src/bridge/contract.ts`
- Modify: `src/host/bridge-host.ts`
- Modify: `src/renderer/bridge/client.ts`
- Modify: `src/renderer/stores/conversation-status.ts`
- Modify: `src/renderer/components/InputArea.tsx`
- Test: `tests/host/bridge-host.test.ts`
- Test: `src/renderer/stores/conversation-status.test.ts`
- Test: `src/renderer/components/InputArea.test.tsx`

1. RED：interrupt 在进程树清理 promise 尚未结束时快速返回 `stopping`；同一 conversation 只启动一次 cleanup。
2. RED：停止期间禁止发送新消息，同时允许页面切换、设置和历史交互；最终成功、清理失败和进程已退出三种状态可见。
3. GREEN：host 先 fence/abort 并应答，再异步验证进程树；终态事件负责解锁。
4. GREEN：renderer 首次点击立即显示“正在停止”，重复点击保持同一状态。
5. VERIFY：慢清理、失败清理、重复点击和应用关闭路径通过。
6. COMMIT：`fix: acknowledge stop requests immediately`

## Task 7：校准上下文上限与 snapshot

**Files**
- Modify: `src/bridge/providers.ts`
- Modify: `src/bridge/pool.ts`
- Modify: `src/bridge/events.ts`
- Modify: `src/renderer/stores/context-usage.ts`
- Modify: `src/renderer/components/ContextUsageIndicator.tsx`
- Test: `tests/bridge/providers.test.ts`
- Test: `tests/bridge/pool.test.ts`
- Test: `tests/bridge/events.test.ts`
- Test: `src/renderer/stores/context-usage.test.ts`
- Test: `src/renderer/components/ContextUsageIndicator.test.tsx`

1. RED：模型切换后旧 snapshot 立即失效；1M 配置和运行时 200K 同时存在时，圆环及 tooltip 显示差异。
2. RED：上下文设置改变后 transport 重建；第三方原始模型 ID 不触发 Claude 200K 内建上限。
3. GREEN：store 分开保存 configured target、advertised maximum 和 runtime snapshot；首轮前显示待确认。
4. GREEN：tooltip 提供模型配置入口与精确值，避免用累计 usage 推导窗口。
5. VERIFY：直连和 Gateway fixture 覆盖 1M、200K mismatch、模型切换和无 snapshot。
6. COMMIT：`fix: report the active context window accurately`

## Task 8：统一 Office/PDF 工具路由

**Files**
- Modify: `src/bridge/document-paths.ts`
- Modify: `src/bridge/document-mcp.ts`
- Modify: `src/host/bridge-host.ts`
- Modify: `src/host/momo-prompt.ts`
- Modify: tool governance files located by the existing permission path
- Test: `tests/bridge/document-mcp.test.ts`
- Test: `tests/host/document-engine.test.ts`
- Test: `tests/host/bridge-host.test.ts`

1. RED：原生 Read 请求 31.7MB PDF、DOCX/PPTX/XLSX 时被路由到 Leemo 文档引擎；普通文本仍走原生 Read。
2. RED：未授权绝对路径仍被拒绝，错误信息不暴露内部协议名。
3. GREEN：在工具执行边界确定性改道，prompt 只保留简短使用说明。
4. VERIFY：真实 31.7MB PDF 完成读取、分页、停止和错误恢复；重启后附件授权不扩大。
5. COMMIT：`fix: route documents through the local engine`

## Task 9：统一临时菜单契约并复查父级页面

**Files**
- Modify: `src/renderer/components/AnchoredLayer.tsx`
- Modify: `src/renderer/components/InputArea.tsx`
- Modify: `src/renderer/components/WorkbenchOverview.tsx`
- Modify: scheduled task and PDF menu components located by `rg`
- Modify: `src/renderer/design/tokens.css` only if a semantic visual role is missing
- Test: `src/renderer/components/AnchoredLayer.test.tsx`
- Test: `src/renderer/components/InputArea.test.tsx`
- Test: affected component tests

1. RED：输入框加号、模型、权限、引用，概览、计划任务和 PDF 菜单都支持 outside click、Escape、焦点返回和互斥。
2. GREEN：扩展共享 `AnchoredLayer` 或共享 hook，删除各组件重复且不完整的 document listener。
3. VERIFY：鼠标、键盘、IME 输入、运行中打开菜单和窄窗位置通过；设置等模态交互保持原语义。
4. COMMIT：`fix: make transient menus predictable`

## Task 10：更新 README 开篇与完整发布验收

**Files**
- Modify: `README.md`
- Modify: `package.json`
- Modify: lockfile/version metadata required by the existing packaging flow
- Add only if repository convention requires: release notes/changelog

1. README：H1 恢复 `Leemo`，使用已批准的中性开篇；把“真的能干活/真的能聊下去”等标题改为具体功能分类，保留真实截图、普通用户场景和本地优先说明。
2. 聚焦测试：按前九个任务逐组运行，先处理回归，再进入全量。
3. 全量命令：

   ```bash
   npm run typecheck
   npm test
   npm run verify:bundled-skills
   npm run build
   npm run build:main
   ```

4. 真机路径：当前窗口、1440×900、窄窗；TokenFlux 权限失败、GLM 成功、模型切换、“继续”、运行中设置/导航/停止、31.7MB PDF、菜单、重启恢复。
5. 性能：记录 delta storm 的 renderer 更新次数和真实点击响应；检查运行结束后 CPU/内存回落。
6. 视觉：最新截图保留到 `.tmp-visual-audit`，复查父级布局、弹层层级、错误卡、上下文提示和设置页。
7. 打包：更新版本号，运行 `npm run electron:pack`，安装/启动包，复验核心路径和用户数据兼容。
8. Git：清除生成物和临时数据，确认 `git diff --check`、提交历史、工作区干净，再推送 `main` 和对应发布标签/Release。
9. COMMIT：按实际版本使用 `release: Leemo x.y.z`。
