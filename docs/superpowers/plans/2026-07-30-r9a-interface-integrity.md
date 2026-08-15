# Leemo r9a 界面可信度实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 momo 回复、过程、搜索、通知、技能和成果入口都准确呈现真实能力，并消除裸 Markdown、重复过程卡和字符占位。

**Architecture:** 以共享 `MarkdownContent` 统一富文本边界；每轮时间线只聚合一份过程事实；二级页面继续复用现有 Zustand 真源和 Leemo 设计令牌，不新增平行数据源。

**Tech Stack:** React 19、TypeScript、Zustand、React Markdown、remark-gfm、Tailwind CSS 4、Vitest、Testing Library、Lucide React（仅构建期打包进 renderer）。

## Global Constraints

- 不渲染或推导 SDK 未显式返回的隐藏思维链，只展示已返回的阶段说明、工具、计划、子任务和结果。
- 所有可见按钮必须有真实动作；本切片做不到的入口直接隐藏或改成事实文案。
- 不复制竞品代码和品牌视觉，只采用已验证的信息层级与交互原则。
- 每个任务先运行新增测试看到预期失败，再写生产代码并看到定向测试通过。
- 不提交 `.claude/`、`.kimi/`、`.kimi-code/`、`comate/`、`openspec/`、安装包或根目录临时记录。

---

## Task 1：共享 Markdown 渲染边界

**Files:**

- Create: `src/renderer/components/MarkdownContent.tsx`
- Create: `src/renderer/components/MarkdownContent.test.tsx`
- Modify: `src/renderer/components/timeline/TextBubble.tsx`
- Modify: `src/renderer/components/timeline/ThinkingCard.tsx`
- Modify: `src/renderer/components/timeline/ActivityCard.tsx`
- Modify: `src/renderer/components/PreviewPane.tsx`

- [x] 新增 `answer`、`process`、`preview` 三种密度测试，覆盖标题、嵌套列表、GFM 表格、任务列表、引用、代码块、行内代码、链接和超长连续文本。
- [x] 运行 `npx vitest run src/renderer/components/MarkdownContent.test.tsx src/renderer/components/PreviewPane.test.tsx src/renderer/components/timeline/cards.test.tsx`，确认共享组件尚不存在或当前裸 Markdown 断言失败。
- [x] 实现安全共享组件：外链新窗口打开、表格可横向滚动、代码和长词不撑破容器、样式按密度收敛。
- [x] 将 momo 最终回答、thinking 可见文本、subagent transcript 和 Markdown 预览迁移到共享组件，保留流式光标和纯文本预览语义。
- [x] 重跑定向测试并确认通过。
- [x] Commit: `feat(r9): unify markdown rendering`

## Task 2：一轮只显示一张过程收据

**Files:**

- Modify: `src/renderer/components/timeline/turnblock.test.tsx`
- Modify: `src/renderer/components/timeline/TurnBlock.tsx`
- Modify: `src/renderer/components/timeline/ProcessFold.tsx`

- [x] 新增 `thinking -> tool -> 中间文本 -> activity -> approval -> final` fixture，断言整轮只有一个 `process-fold`，并断言审批卡和最终回答仍独立可见。
- [x] 新增搭子态与工作台态的折叠策略测试，断言待审批时过程收据自动展开。
- [x] 运行 `npx vitest run src/renderer/components/timeline/turnblock.test.tsx`，确认现有 flush 逻辑产生多张过程卡。
- [x] 先收集全轮过程项目及其首个索引，再在首个过程位置插入唯一 `ProcessFold`；非过程项目保持原时间顺序。
- [x] 将已解决但无法锚定的确认记录合并进同一收据，避免另建第二张“归档”过程卡；待处理交互继续放在正文尾部。
- [x] 重跑 `turnblock`、`cards`、`ApprovalBar`、`AskUserCard` 定向测试。
- [x] Commit: `fix(r9): render one process receipt per turn`

## Task 3：让搜索承诺与真实能力一致

**Files:**

- Modify: `src/renderer/pages/GlobalSearchPage.test.tsx`
- Modify: `src/renderer/pages/GlobalSearchPage.tsx`
- Modify: `src/renderer/components/WikiHistoryList.test.tsx`
- Modify: `src/renderer/components/WikiHistoryList.tsx`

- [x] 新增按文件名和相对路径搜索真实文件树、点击后打开预览的失败测试。
- [x] 新增 Wiki 按引用文本、问题、答案和文件路径过滤的失败测试。
- [x] 运行两份测试并记录当前“文件筛选无结果、Wiki 不随 query 变化”的预期失败。
- [x] 复用 `useFileTree` 已加载树生成文件结果，不建设全文索引；为文件类型推导真实预览 kind。
- [x] 给 `WikiHistoryList` 增加 query 过滤并补齐空搜索、无结果和有结果状态。
- [x] 重跑定向测试。
- [x] Commit: `fix(r9): connect file and wiki search`

## Task 4：通知和技能去骨架化

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/renderer/stores/notifications.test.ts`
- Modify: `src/renderer/stores/notifications.ts`
- Modify: `src/renderer/components/NotificationPanel.test.tsx`
- Modify: `src/renderer/components/NotificationPanel.tsx`
- Modify: `src/renderer/pages/SkillsPage.test.tsx`
- Modify: `src/renderer/pages/SkillsPage.tsx`

- [x] 用 `npm install -D lucide-react` 安装图标库，确保 electron-builder 不复制其小文件目录到成品。
- [x] 新增 `markRead(id)` 测试，断言点击一条通知不会把全部通知标为已读。
- [x] 新增通知空状态、未读状态、单条跳转和全部已读测试；先运行并确认失败。
- [x] 用真实 Tailwind 类重写通知面板，使用 Lucide 图标、语义色、关闭与空状态；点击单条只调用 `markRead(id)`。
- [x] 修改技能页事实文案，删除“点击卡片触发”承诺；卡片继续只承担查看和启停，补齐真实图标及空状态。
- [x] 重跑通知与技能定向测试。
- [x] Commit: `fix(r9): finish notification and skills surfaces`

## Task 5：成果页的成品状态与真实动作

**Files:**

- Modify: `src/renderer/pages/ArtifactsPage.test.tsx`
- Modify: `src/renderer/pages/ArtifactsPage.tsx`
- Modify: `src/renderer/components/VisualizationCard.test.tsx`
- Modify: `src/renderer/components/VisualizationCard.tsx`

- [x] 新增成果页 empty/loading/error/populated 四态测试，以及“打开预览”“回到来源对话”两条动作测试。
- [x] 新增可视化卡“在预览中打开”“在成果中查看”测试，并断言不再出现无协议支撑的“让 momo 重画”。
- [x] 运行测试确认当前未定义 CSS 类、空白页和假按钮导致失败。
- [x] 用无嵌套卡片的紧凑列表重写成果页，使用真实图标、分段控件、文件路径、来源和工作区外警告。
- [x] 接通来源对话跳转和真实预览；实现前仅显示 store 真实状态，不伪造加载或错误。
- [x] 重跑定向测试。
- [x] Commit: `feat(r9): finish artifact surfaces`

## Task 6：切片验证与独立视觉复核

**Files:**

- Create: `docs/research/r9a-interface-audit.md`
- Create: `docs/research/audit-shots/r9a-*.png`

- [x] 运行 `npm test`、`npm run typecheck`、`npm run build`。
- [x] 启动真实 Electron，分别在 1440×900 和 1280×720 走“Markdown 回复 -> 展开过程 -> 搜索文件 -> 打开成果 -> 查看通知 -> 技能页”。
- [x] 截图并检查裸 Markdown、重复过程卡、横向溢出、空白页、假按钮、字符占位和导航选中态。
- [x] 让独立评审只根据截图和真实操作列 P0/P1；P0 全部修完后复跑截图。
- [x] Commit: `fix(r9): close interface integrity gaps`
