# Leemo 工作台全局地图实施计划

> **执行原则：** 先修可见语义，再改壳层；每块先写用户行为测试，再写实现。Review Budget = 1，只在整卡完成后做一次独立代码/产品审查并修复阻断项。

**目标：** 把工作台从“顶部下拉切换单一文件夹 + 扁平对话流”升级为可总览所有本子和全局对话的 Agent 工作台；同时把会话状态收敛为进行中、报错、未读三种克制信号，并在标准窗口提供对话/文件左右并排、窄窗提供互斥标签、右侧提供文件/概览/搜索三个真实工具入口。

**架构：** 现有对话、工作区、本子、文件树、搜索与时间线继续是真源。新增的只是范围键和壳层视图状态：`ScopeKey`用稳定 id 表达全局、托管本子和外部本子；`UiState`保存每个范围的近期对话工作集、文件标签和布局偏好。UI 偏好与现有设置一起写入当前 settings KV 表，不增加数据库或平行业务账本。状态标记由现有 `unread`、活跃 run、pending interaction 与最新时间线共同派生。

**当前卡不做：** 完整文件增删改移动、独立对话子窗口、搭子专属模块、全产品视觉重画、多 Agent 编排。右栏只接已有真实能力，不放空入口。

**技术栈：** Electron、React 19、Zustand、TypeScript、Tailwind、Lucide、Vitest、Testing Library、CDP 验收脚本。

---

## Task 1：会话三态与“标记未读”

**Files:**

- Modify: `src/renderer/stores/conversation-status.ts`
- Modify: `src/renderer/stores/conversation-status.test.ts`
- Modify: `src/renderer/stores/conversations.ts`
- Modify: `src/renderer/stores/conversations.test.ts`
- Create: `src/renderer/components/ConversationStateMark.tsx`
- Create: `src/renderer/components/ConversationStateMark.test.tsx`
- Modify: `src/renderer/components/ConversationListItem.tsx`
- Modify: `src/renderer/components/ConversationListItem.test.tsx`
- Modify: `src/renderer/components/HistoryDrawer.tsx`
- Modify: `src/renderer/components/HistoryDrawer.test.tsx`
- Modify: `src/renderer/components/WorkbenchShell.tsx`
- Modify: `src/renderer/components/WorkbenchShell.test.tsx`

### Step 1：先锁定唯一派生规则

在 `conversation-status.test.ts` 增加红灯用例，固定以下纯函数接口：

```ts
export type ConversationMarker = "running" | "error" | "unread" | null;

export function deriveConversationMarker(input: {
  status: ConversationStatus;
  unread: boolean;
}): ConversationMarker;
```

断言：

- live run + unread -> `running`；
- failed + unread -> `error`；
- blocked approval/question -> `unread`；
- completed + unread -> `unread`；
- waiting/canceled/completed + read -> `null`；
- 优先级固定为 `running > error > unread`。

Run:

```powershell
npx vitest run src/renderer/stores/conversation-status.test.ts
```

Expected: FAIL，尚无 `deriveConversationMarker`。

### Step 2：加入可持久化的显式已读动作

在 `ConversationsState` 增加：

```ts
setConversationUnread(conversationId: string, unread: boolean): Promise<void>;
```

行为：

- 复用 `ConversationMeta.unread`，不加 schema 字段；
- 对当前激活对话也允许设为未读；
- `switchActive`/`activateScope` 仍会在真正打开对话时清除未读；
- 保存失败时不伪装成功，菜单沿用现有 inline error；
- 运行中允许标记未读，转圈暂时覆盖圆点，运行结束后圆点恢复；
- 打开失败对话只清 unread，不改变由时间线派生的 error。

在 `conversations.test.ts` 先写：成功落盘、失败保持原值、激活对话可标记、重开清除、运行中不破坏 runId 五组测试，再实现。

### Step 3：只渲染三种图形，不渲染状态文字

`ConversationStateMark` 只接受 marker、标题和可选 className：

- running: `LoaderCircle` + `animate-spin`，`aria-label="<标题>：进行中"`；
- error: `CircleAlert`，使用 `--leemo-danger`，`aria-label="<标题>：报错"`；
- unread: 6px 实心圆点，`aria-label="<标题>：未读"`；
- null: 不渲染；
- 全部无可见文字，只有 `title` 和无障碍名称。

`ConversationListItem` 新增 `onUnread`，菜单按当前值显示`标记未读`或`标记已读`。移除旧的文字状态 span 和重复 unread 点，统一通过 `ConversationStateMark` 渲染。当前标题区同样复用该组件，不再显示`已完成/等待继续/等你回答`文字。

待审批和待回答不写数据库 unread：它们在真实 pending 存在时由 `blocked -> unread` 显示；pending 消失即恢复持久化 unread 或空状态，避免制造无法恢复的假待办。

### Step 4：定向验证并提交

```powershell
npx vitest run src/renderer/stores/conversation-status.test.ts src/renderer/stores/conversations.test.ts src/renderer/components/ConversationStateMark.test.tsx src/renderer/components/ConversationListItem.test.tsx src/renderer/components/HistoryDrawer.test.tsx src/renderer/components/WorkbenchShell.test.tsx
npm run typecheck
git diff --check
```

人工检查：进行中只有转圈、失败只有红色错误图标、审批/回答/后台完成/手动标记都只有同一种未读点，菜单无 Toast。

Commit:

```powershell
git add src/renderer/stores/conversation-status.ts src/renderer/stores/conversation-status.test.ts src/renderer/stores/conversations.ts src/renderer/stores/conversations.test.ts src/renderer/components/ConversationStateMark.tsx src/renderer/components/ConversationStateMark.test.tsx src/renderer/components/ConversationListItem.tsx src/renderer/components/ConversationListItem.test.tsx src/renderer/components/HistoryDrawer.tsx src/renderer/components/HistoryDrawer.test.tsx src/renderer/components/WorkbenchShell.tsx src/renderer/components/WorkbenchShell.test.tsx
git commit -m "feat: simplify conversation attention states"
```

---

## Task 2：范围键、近期工作集与重启恢复

**Files:**

- Create: `src/renderer/stores/workbench-scope.ts`
- Create: `src/renderer/stores/workbench-scope.test.ts`
- Modify: `src/renderer/stores/ui.ts`
- Modify: `src/renderer/stores/ui.test.ts`
- Modify: `src/renderer/stores/conversations.ts`
- Modify: `src/renderer/stores/conversations.test.ts`
- Modify: `src/renderer/persistence/sync.ts`
- Modify: `src/renderer/persistence/sync.test.ts`
- Modify: `src/renderer/bridge/context.tsx`
- Modify: `src/renderer/app/App.test.tsx`

### Step 1：建立稳定 ScopeKey，不使用显示名和绝对路径

`workbench-scope.ts` 定义：

```ts
export type ScopeKey =
  | "global"
  | `notebook:${string}`
  | `workspace:${string}`;

export interface ScopeSession {
  openConversationIds: string[];
  activeConversationId: string | null;
  fileTabs: { workspaceId: string; path: string; title: string; kind: "markdown" | "pdf" | "html" | "other" }[];
  activeFileKey: string | null;
  surfacePreference: "conversation" | "split" | "file";
  splitRatio: number;
}
```

提供并测试 `scopeKeyForSelection`、`scopeKeyForConversation`、`sanitizeScopeSessions`。输入的持久化对象按白名单字段、最多 5 个对话标签、合理 splitRatio 和真实对话归属清洗；损坏单项只能丢该项，不能让启动失败。

### Step 2：UiState 成为壳层视图单一真源

在 `ui.ts` 增加：

- `activeScopeKey`；
- `scopeSessions`；
- 左栏宽度/折叠；
- 当前右侧工具、各工具宽度、聚焦状态；
- 中央临时响应式形态与用户保存偏好分离；
- `activateScopeSession`、`openConversationInScope`、`closeConversationInScope`、`openFileInScope`、`closeFileInScope`、`setSplitRatio`、`setToolWidth` 等原子 action；
- `pickPersistedWorkbenchUi` 和 `hydrateWorkbenchUi`。

每个 action 只更新相关引用，窗口 resize 不重建 scope map。关闭带草稿的对话标签由调用层阻止；store 本身不静默挤掉第六个标签。

### Step 3：与现有 settings KV 合并保存，不加数据库

重构 `startPersistenceSync` 的偏好保存为一个函数，每次都合并：

```ts
{
  ...pickPersistedSettings(settings.getState()),
  workbenchUi: pickPersistedWorkbenchUi(ui.getState()),
}
```

订阅 settings 和 ui，但只在持久化投影真的变化时写入；拖拽过程不写，pointerup 后 action 才更新持久化值。启动顺序固定为：加载 snapshot -> hydrate settings -> hydrate workbenchUi -> hydrate conversations -> 按真实对话/本子清理失效 scope -> 显示应用。

测试损坏 JSON、旧版本无 key、失效对话 id、跨范围同名对话、最多五标签、重启恢复和两类偏好互不覆盖。

### Step 4：定向验证并提交

```powershell
npx vitest run src/renderer/stores/workbench-scope.test.ts src/renderer/stores/ui.test.ts src/renderer/stores/conversations.test.ts src/renderer/persistence/sync.test.ts src/renderer/app/App.test.tsx
npm run typecheck
git diff --check
```

Commit: `feat: persist scoped workbench sessions`

---

## Task 3：左侧全局地图与模式入口

**Files:**

- Create: `src/renderer/components/WorkbenchSidebar.tsx`
- Create: `src/renderer/components/WorkbenchSidebar.test.tsx`
- Modify: `src/renderer/components/WorkbenchShell.tsx`
- Modify: `src/renderer/components/WorkbenchShell.test.tsx`
- Modify: `src/renderer/components/ModeSwitcher.tsx`
- Create: `src/renderer/components/ModeSwitcher.test.tsx`
- Modify: `src/renderer/components/WorkspaceSwitcher.tsx`
- Modify: `src/renderer/components/WorkspaceSwitcher.test.tsx`
- Modify: `src/renderer/design/effects.css`

### Step 1：用用户路径测试锁定地图结构

测试数据至少 8 个本子、20 段全局对话，断言：

- 左上是紧凑`搭子 / 工作台`切换；
- `本子`在上，`与 momo 的对话`在下；
- 两区独立滚动，本子区最多约 55%，全局区至少保留标题和三行；
- 所有本子始终可见，只有当前本子展开其对话；
- 点击本子恢复该范围最后对话，点击全局对话切到 global；
- 外部文件夹以本子心智展示，但隐藏默认工作区不出现；
- 当前目录失效时保留条目并给重新定位/移除动作，不跳去别处；
- 对话行只使用 Task 1 的三态标记和菜单。

### Step 2：迁移顶部下拉中的真实保护逻辑

`WorkbenchSidebar` 复用 `workspaces/notebooks/conversations/previewContent/fileTree/ui` 真源。把 `WorkspaceSwitcher` 中切换前的未保存 Markdown 检查迁入范围导航流程；保存、放弃或取消的行为不变。确认新地图覆盖所有路径后移除工作台顶部下拉入口，避免两套范围选择器互相打架；组件若已无调用则删除对应旧实现和测试。

新建对话默认跟随当前范围；首发前关闭范围 chip 后变为`未选择本子`，不弹确认/Toast、不清草稿附件；首发成功后只能通过`移动到其他本子`改变归属。

### Step 3：实现尺寸和键盘规则

- 展开默认 288px，限制 252-360px，折叠 52px；
- 左栏拖拽命中区约 8px，双击恢复默认；
- 拖拽中无 easing，pointerup 才持久化；
- 键盘能遍历本子、对话与菜单；当前项有 `aria-current`；
- 折叠后保留模式入口、展开按钮和当前范围提示，不用极小字体塞内容。

### Step 4：定向验证并提交

```powershell
npx vitest run src/renderer/components/WorkbenchSidebar.test.tsx src/renderer/components/WorkbenchShell.test.tsx src/renderer/components/ModeSwitcher.test.tsx src/renderer/stores/ui.test.ts
npm run typecheck
git diff --check
```

Commit: `feat: add global notebook and conversation map`

---

## Task 4：右侧 AI 原生工具栏与真实工具面板

**Files:**

- Create: `src/renderer/components/WorkbenchActivityRail.tsx`
- Create: `src/renderer/components/WorkbenchActivityRail.test.tsx`
- Create: `src/renderer/components/WorkbenchOverview.tsx`
- Create: `src/renderer/components/WorkbenchOverview.test.tsx`
- Modify: `src/renderer/components/WorkbenchShell.tsx`
- Modify: `src/renderer/components/WorkbenchShell.test.tsx`
- Modify: `src/renderer/components/FileTree.tsx`
- Modify: `src/renderer/pages/GlobalSearchPage.tsx`
- Modify: `src/renderer/pages/GlobalSearchPage.test.tsx`
- Modify: `src/renderer/stores/ui.ts`
- Modify: `src/renderer/stores/ui.test.ts`
- Modify: `src/main/main.ts`
- Modify: `src/renderer/design/effects.css`

### Step 1：固定三个且只有三个入口

右侧 44px 栏只渲染`文件`、`概览`、`搜索`三个 Lucide 图标，hover tooltip 使用中文；同一时刻只开一个面板，再点当前图标关闭。没有实现的数据不出现占位按钮。

### Step 2：连接真实范围数据

- 文件：本子范围展示真实 `FileTree`；global 范围只列当前对话已附加/读取/生成/修改的`本次文件`，不暴露隐藏默认工作区全树；
- 概览：只聚合当前范围真实对话、pending interaction、运行状态、计划/成果/subagent 明确事件；局部来源失败只降级对应区块；
- 搜索：复用 `GlobalSearchPage` 的现有索引和过滤，默认当前范围，可切`全部`，结果显示归属并先切范围再打开。

### Step 3：实现停靠、覆盖和聚焦

- 面板默认 320px，限制 280-520px 或窗口 45%；各工具记住自己的宽度；
- 只有中央剩余空间满足当前主表面下限时停靠，否则以覆盖抽屉打开；
- Esc、空白区或当前图标关闭覆盖层；
- 拖到约 55% 只显示聚焦预览，松开才聚焦；退出后恢复中央现场；
- 搭子态不常驻右栏，只保留一个按需打开工作的入口。

同时把 Electron 窗口下限从 800x640 调到 960x680，并增加主进程测试或可注入 window-options 纯函数测试，确保不是只写在 CSS 中。

### Step 4：定向验证并提交

```powershell
npx vitest run src/renderer/components/WorkbenchActivityRail.test.tsx src/renderer/components/WorkbenchOverview.test.tsx src/renderer/components/WorkbenchShell.test.tsx src/renderer/pages/GlobalSearchPage.test.tsx src/renderer/stores/ui.test.ts tests/main
npm run typecheck
git diff --check
```

Commit: `feat: add workbench activity rail`

---

## Task 5：中央对话/文件双表面与响应式仲裁

**Files:**

- Create: `src/renderer/components/WorkbenchStage.tsx`
- Create: `src/renderer/components/WorkbenchStage.test.tsx`
- Modify: `src/renderer/components/WorkbenchShell.tsx`
- Modify: `src/renderer/components/WorkbenchShell.test.tsx`
- Modify: `src/renderer/components/PreviewPane.tsx`
- Modify: `src/renderer/components/PreviewPane.test.tsx`
- Modify: `src/renderer/components/InputArea.tsx`
- Modify: `src/renderer/stores/ui.ts`
- Modify: `src/renderer/stores/ui.test.ts`
- Modify: `src/renderer/design/effects.css`

### Step 1：以中央容器实测宽度决定形态

`WorkbenchStage` 使用 `ResizeObserver` 测量中央容器，不用窗口媒体查询猜测：

- 无文件：对话全宽；
- 可用宽度 >= 约 920px：对话/文件左右并排，默认 42%/58%，分别不小于 400/500px；
- 不足或用户主动专注：顶部`对话`与文件标签互斥；
- 右侧工具面板先改覆盖，仍不足才 split -> tabs；
- 左栏不因打开文件自动收起。

测试断言 1440/1280 形成 split，1024/960 形成 tabs；不能出现对话 + 文件 + Explorer 三个窄栏。

### Step 2：保持两个表面实例与现场

对话和文件在布局切换时复用同一组件实例；只改变尺寸、可见性和 `inert/aria-hidden`：

- 消息滚动、输入草稿、附件、权限卡不丢；
- 文件滚动、Markdown 草稿、选区、活动文件不丢；
- 打开多个文件只增加文件表面的标签；
- 收起对话后顶部入口用 Task 1 三态；
- 不渲染底部矮宽聊天条或遮住文件的浮动聊天卡。

### Step 3：拖拽、动效与性能边界

- 分隔线视觉 1px、命中 8px；直接跟随指针，每帧最多一次 state 更新；
- 松手才写 splitRatio，双击恢复 42/58；
- 离开窗口/失焦取消未完成拖拽；
- 离散切换只用 120-180ms 位移/透明度，不用弹跳、缩放、模糊；
- `prefers-reduced-motion` 关闭非必要过渡；
- resize 不调用文件树 refresh、搜索重建或 bridge 重新订阅。

### Step 4：定向验证并提交

```powershell
npx vitest run src/renderer/components/WorkbenchStage.test.tsx src/renderer/components/WorkbenchShell.test.tsx src/renderer/components/PreviewPane.test.tsx src/renderer/components/InputArea.test.tsx src/renderer/stores/ui.test.ts
npm run typecheck
npm run build
git diff --check
```

Commit: `feat: add adaptive conversation and file stage`

---

## Task 6：真实用户路径、重启和性能验收

**Files:**

- Create: `scripts/verify-workbench-global-map.mjs`
- Create: `docs/research/2026-08-04-workbench-global-map-verification.md`
- Modify: `docs/sdd/r7-requirements-ledger.md`
- Modify: relevant focused tests found during integration

### Step 1：组件与浏览器四视口验收

使用隔离 fixture/profile 准备 8 个本子、20 段全局对话、运行/报错/审批/回答/完成各一段，并截图：

- 1440x900；
- 1280x860；
- 1024x768；
- 960x680。

检查输入框完整、两个滚动区、三态互斥、菜单、左栏/右栏/中央冲突规则、长中文换行、hover tooltip、键盘焦点和 reduced motion。

### Step 2：安装包真实路径

在打包应用的隔离 userData 中验证：

1. 新建全局对话和本子对话；
2. 后台完成产生未读点，打开清除；
3. 手动标记未读，重启仍在；
4. 待审批/待回答显示未读点；
5. 真实失败显示红色报错，打开不消失，下一轮成功后消失；
6. 切换本子恢复各自最后对话、最多五个标签和文件现场；
7. 打开文件在宽窗并排、窄窗互斥；
8. 本子目录失效时不串到默认工作区；
9. 快速切换 20 次、连续拖拽 5 秒，输入/停止/审批仍响应且 renderer 无未捕获错误。

### Step 3：发布门槛与一次审查

```powershell
npm run typecheck
npm test
npm run verify:bundled-skills
npm run build
npm run build:main
npm run electron:pack
node scripts/verify-workbench-global-map.mjs
git diff --check
```

记录与上一候选包相比的安装体积、解包文件数、冷启动、空闲内存和长对话输入区；无法解释的明显回退必须修复。最后只开一轮独立 reviewer，修阻断用户路径、数据串范围、明显视觉破损和真实性问题；其余建议进入后续 backlog，不反复重审拖慢下一里程碑。

Commit: `test: verify global workbench user journey`

---

## 完成判据

用户在真实安装包中可以同时看见多个本子和`与 momo 的对话`，一键切换且恢复现场；会话行只用转圈、红色错误、未读点表达需要关注的状态；文件、概览、搜索来自真实数据；宽窗对话与文件并排、窄窗稳定退化为标签；所有关键状态在重启后不串范围、不丢草稿，也不因布局切换重复运行任务。
