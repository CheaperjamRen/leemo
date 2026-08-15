# 交接：前端竖切续推（片3 交互卡 → …→ 片5 工作台壳）

> 日期：2026-07-22（第六批 CLOSED 后）／新会话满血起步用
> 你的角色：Leemo 设计与验收负责人（CLAUDE.md 全职责自动加载）

## 0 · 30 秒接手

- 读 `MEMORY.md` + 台账 `docs/sdd/progress.md`「第六批 CLOSED」段。
- 权威链：`docs/plans/2026-07-22-frontend-shell-slice.md`（**9 片单线顺序，§2 整批地图**）→ `docs/specs/02-前端设计规格-v2.0.md`（前端唯一权威）→ `09-Bridge-IPC契约-v1.0` + `src/bridge/contract.ts`（冻结契约，前端消费面）。
- 现状：main 290 测试绿、typecheck 3 段 exit 0；前端 fixture 态跑通（片1 搭子落地页 + 片2 消息卡/穿衣/思维链已合）。
- **用户已定：按计划顺序推**（片3→片4→片5），不跳片。工作台壳=片5，复用片2-4 组件库。

## 1 · 下一步 = 片3 交互卡（审批条 / 问询卡 / 用量脚注）

**为什么是片3**：9 片单线的下一顺位；工作台壳（片5）刻意排在片3-4 之后，因为要复用这些共享交互组件。跳片会造成乱序返工。

**片3 范围**（`02-前端设计规格` §7.10 审批条 / §7.11 问询卡 / §7.8 用量脚注）：
- **审批条**（`canUseTool` 回调，IPC 桥）：对话流内嵌，一句人话 +「允许一次 / 本对话总是允许 / 永久允许」三键 +「拒绝」。危险操作（rm/格式化）不显「永久允许」且条底色转 danger-soft。写入路径显示完整相对路径；cwd 外加「⚠ 工作区外」角标（Phase 0 实证模型会臆造 cwd 外路径）。
  - **审批哲学**（记忆 `approval-ux-philosophy`，用户 7/21 修订）：默认低摩擦，别老烦用户；契约层已支持 bypassPermissions + dangerousCommandCaching 开关。UI 要体现"默认放行、危险可选卡"的姿态。
- **问询卡**（ask-user MCP）：题干 + 2-4 选项按钮（可多选）+「其它…」内联输入。选择即回投（阻塞的 Promise 收到答案继续）。
- **用量脚注**（仅 fixture，Phase-1 gate#1）：§7.8 规则，暖白适配。

**⚠ 技术核心 = 回投通道**：审批/问询是**阻塞往返**（前端渲染卡 → 用户点 → answer 回投给等待的 Promise）。这是整个前端最易出 bug 的地方：
- fixture-client 要能"发一个待答事件 → 挂起 → 收到前端回投 → resolve → 继续流"。
- 契约面：`canUseTool` = `(toolName, input, {signal, toolUseID, requestId})=>Promise<PermissionResult|null>`（broker 永不返 null，见 br-b3 报告）；ask-user 走 `createAskUserMcp`（interact.ts）。
- **建议**：回投通道单独立卡 + Opus 对抗审查（严格 TDD 边界，不是纯视觉）。

## 2 · 建议：片3 前置立「fixture 场景库」（用户"深化场景"诉求的落点）

现在每片只有一个快乐路径 demo 回合（整理笔记）。真实产品质量要靠**多场景 fixture** 暴露非快乐路径 bug（片2 流式折叠 bug 就是单场景盲区）。片3 前置做一个 fixture 场景库：
- 覆盖：多轮长对话 / 工具失败 / 审批拒绝 / 中断重来 / compact 触发 / 空状态 / 超长计划 / 问询多选。
- 每片验收喂 3-5 个场景，不只看快乐路径。
- 落地：`src/renderer/bridge/fixtures/scenarios/` 或扩充现有 `DEMO_TURN_EVENTS` 为具名场景集；fixture-client 支持按场景名驱动。

## 3 · 施工纪律（每片适用，记忆已加载）

- 四拍循环：骨架(TDD)→验收①→K3 穿衣(无头 `kimi -p -m kimi-code/k3`)→验收②。
- **执行者≠验收者**；验收只认复现证据（主控自跑 tests+typecheck，非采信）；**每个改类型 Task 验证步必含 `npm run typecheck`**（vitest 剥类型会漏）。
- TDD 边界：store/reducer/回投通道=严格 TDD；纯视觉=用户目验。
- **kimi -p 派发坑**（本批实证）：裸 `-p` 不加 `--yolo/--auto`；首派可能静默零改动，**git diff --stat 才是判进度真信号**（kimi 缓冲到 session 结束才落 stdout），失败就前台重派 + prompt 显式"必须用编辑工具写入"。
- 模型分档：实现卡=Sonnet 5，回投通道/契约相关=Opus 4.8，复审终审恒 Opus 4.8。
- worktree 正确姿势（记忆 `worktree-baseref-gotcha`）：主检出在 main 后 `git worktree add .claude/worktrees/<name> -b <branch> main` 再 EnterWorktree(path)+`npm install`（不共享 node_modules）+ 跑基线 290 绿。
- 成本：机械密集卡批处理（记忆 `sdd-cost-batching-preference`）；里程碑一会话；收官出交接。

## 4 · 遗留 gate（接真 IPC 时统一带走，别现在做）

- Phase-1 gate（记忆 `fe-slice1-phase1-gates`）：store 订阅生命周期 / fixture default-case。
- Bridge 遗留（记忆 `bridge-batch-followups`）：costSource 错算所有 provider（**先于成本 UI 修**）/ dangerLocked 读写不对称 / pool↔interact 接线。

---

## 附 · 片5 工作台壳（WorkbenchShell）交接——到点直接用

> **不是下一步**（片3-4 先做）。但用户点名想要，故预备好，片5 到点直接施工。

**权威**：`02-前端设计规格` §5 布局 + §6 侧边栏 + §7.9 上下文圆环；视觉基准 = `docs/design-audition/k3/workbench-mode.html`（**这次是照抄冷灰气质**，不像片2 是暖白）。

**核心设计点**：
1. **双壳架构**（§2.1 铁律）：BuddyShell / WorkbenchShell **二选一渲染**，共享同一套 Zustand stores（模式无关，唯一真相源）。切换=换壳，对话/任务/记忆/产物原地不动。
2. **冷灰 token**：§3 双基调 = **同一套 `--leemo-*` 语义变量在两壳下不同赋值**。片2 我已把所有卡片颜色走语义 token 并用**搭子暖白值**；工作台壳要提供一份**冷灰赋值**（`--leemo-bg:#FFFFFF` / side `#F6F6F7` / ink `#1C1C21` / line `#E7E7EA` / panel `#F8F8F9` 等，见 §3 表工作台列）。做法：给 WorkbenchShell 根容器一个 class/data 属性作用域覆盖 token 值，**卡片组件零改自动变冷灰**（这是片2 走语义 token 的回报）。
3. **两栏布局**（§5）：侧栏（260px，`--leemo-side` 底）+ 对话区；预览区/文件区按需从右展开（用户主动，永不自动弹）。
4. **侧栏**（§6）：本子树（book-blue/green/red token 着色 + 计数）+ 放养对话区 + 底部 momo 状态。workbench-mode.html 有完整参考结构（树状缩进线、pulse-dot 活跃标记）。
5. **顶栏**（§5）：左=当前对话标题（可改名，`title_manually_updated` 保护）；中=**上下文圆环**（§7.9）；右=模式切换器 + 铃铛。
6. **上下文圆环**（§7.9）：input token 计数可视化；注意 Phase 0 实证 message_start 硬编码 0，消费方不得当权威（B0 报告）——fixture 态先给假值。

**复用**：对话区直接用片2 的 Timeline/TurnBlock/ProcessFold/6 卡 + 片3 的审批/问询卡 + 片4 的可视化卡。工作台壳主要工作 = **布局容器 + 侧栏 + 顶栏 + token 冷灰作用域**，卡片本身不重造。

**验收**：冷灰 vs 暖白双基调本身是两套目验量（§3 注）。切到工作台，卡片应自动变冷灰（token 作用域生效），布局对齐 workbench-mode.html。

**下一会话建议**：新开满血；片3 用 Sonnet 5 实现 + Opus 复审（回投通道对抗审查）；effort=medium 起步，回投通道升 high。
