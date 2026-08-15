# Batch 6b Brief — WikiPopup + WikiHistoryList (S10)

**执行者**: Sonnet 5 medium（隔离 worktree）
**验收者**: Opus 4.8 主控（亲跑命令）
**基点**: main（6a 合入后，或与 6a 并行于独立 worktree）
**依赖**: wiki-entries store（已建）、useWikiEntries hook（已建）、wiring.ts 已路由影子对话事件

---

## 目标

实现 S10 WikiPopup 浮窗 + WikiHistoryList，接进 WorkbenchShell（浮层渲染）。wiki-entries store 逻辑已完整，本卡只做 UI 层。

---

## 文件清单

### 新建
- `src/renderer/components/WikiPopup.tsx`
- `src/renderer/components/WikiPopup.test.tsx`
- `src/renderer/components/WikiHistoryList.tsx`
- `src/renderer/components/WikiHistoryList.test.tsx`

### 修改
- `src/renderer/components/WorkbenchShell.tsx` — 加 WikiPopup 浮层渲染（`wikiActive && <WikiPopup />`）
- `src/renderer/components/WorkbenchShell.test.tsx` — 补 WikiPopup 集成测试

### 禁改（零 diff）
- `src/renderer/stores/wiki-entries.ts`（逻辑已完整，不动）
- `src/bridge/contract.ts` / `src/bridge/interact.ts`
- `src/renderer/bridge/wiring.ts` / `src/renderer/bridge/client.ts`
- `src/renderer/stores/conversations.ts` / `message-model.ts`
- `smoke/` / `tests/bridge/` / `package.json` / `package-lock.json`

---

## 实现规格

### 1. `WikiPopup.tsx`

Props: 无（全从 hooks 读）

Hooks:
- `useWikiEntries` 读 `active / entries`
- `useWikiEntries` 取 `ask / toggleDetailed / closePopup`

仅当 `active !== null` 时渲染（否则 `return null`）。

布局（380px 浮窗，`position: fixed`，`z-index: 50`）：
```
┌─────────────────────────────────────┐
│ [引用条] filePath · quotedText摘录   │  ← 琥珀细左边框 border-l-2 border-amber
│─────────────────────────────────────│
│ [momo 回答区] 流式文字               │  ← 复用 TextBubble 纯文字逻辑（无头像/时间戳）
│                                     │
│                      [详细一点] ○   │  ← 顶右小滑块 toggle
│─────────────────────────────────────│
│ [追问输入框] Enter 提交              │
│─────────────────────────────────────│
│                               [×]  │  ← 关闭按钮
└─────────────────────────────────────┘
```

状态机（从 `active` 派生，无本地 state）：
- `idle` — `active.streaming === false && entry.turns.length === 0` → 显示"正在思考…"占位（首问前）
- `asking` — `active.streaming === true && entry.turns.length === 0` → loading spinner
- `answered` — `entry.turns.length > 0 && !active.streaming` → 显示最后一轮 answer + 追问框
- `asking-followup` — `entry.turns.length > 0 && active.streaming` → 显示已有 turns + streaming indicator
- `error` — 当 `active.shadowConversationId === null && !active.streaming && entry.turns.length === 0` 且已调用过 ask → 内联重试按钮

momo 回答区：
- 显示 `entry.turns` 所有轮次（question + answer 交替）
- 流式中：最后一轮 answer 为空时显示 `…` 动画

追问输入框：
- `<textarea>` 单行，Enter（非 Shift+Enter）提交
- 提交时调 `ask(text)`，清空输入框
- `active.streaming === true` 时禁用

详细一点开关：
- `<input type="checkbox">` 或自定义 toggle
- 值 = `active.detailed`，onChange = `toggleDetailed(v)`

关闭按钮：调 `closePopup()`

定位：首发固定右下角 `bottom-6 right-6`（6a 完成后 SelectionMenu 会传坐标，届时另立卡升级；首发固定位置可用）。

### 2. `WikiHistoryList.tsx`

Props: 无（全从 hooks 读）

Hooks: `useWikiEntries(s => s.entries)`, `useUi(s => s.openPreview)`

按 `filePath` 分组展示 entries：
```
📄 第五章-树与二叉树.pptx
  ├─ "遍历的时间复杂度…" (2 轮)
  └─ "平衡树的定义…" (1 轮)
```

点击条目 → `ui.openPreview(entry.filePath, entry.filePath.split('/').pop(), 'other')`（首发文件级定位）

空态：`entries.length === 0` → "还没有小问答记录"

此组件首发接入 GlobalSearchPage 的 wiki 分组（修改 GlobalSearchPage.tsx 加 wiki 结果分区）。

### 3. `WorkbenchShell.tsx` 修改

新增 hooks：
```ts
const wikiActive = useWikiEntries(s => s.active);
```

在 JSX 末尾（其他浮层之后）加：
```tsx
{wikiActive && <WikiPopup />}
```

---

## 测试要求（严格 TDD）

### `WikiPopup.test.tsx`
```
renders null when active is null
renders quoted text and filePath in citation bar
renders turns when entry has answers
shows loading state when streaming with no turns
shows followup input when answered
calls ask on Enter key in followup input
does not submit on Shift+Enter
calls closePopup on × button click
calls toggleDetailed on toggle change
disables input while streaming
```

### `WikiHistoryList.test.tsx`
```
renders empty state when no entries
groups entries by filePath
shows turn count per entry
calls openPreview on entry click
```

### `WorkbenchShell.test.tsx` 补充
```
renders WikiPopup when wikiActive is not null
does not render WikiPopup when wikiActive is null
```

---

## 验收命令（执行者自跑，主控复跑）

```bash
npm test -- --run
# 预期：≥530 tests，全绿
npm run typecheck
# 预期：三段 exit 0
git diff --check
```

---

## 教训（必须遵守）

1. **局部绿 ≠ 整体健康**：每次改完必须跑 `npm run typecheck`，不只是 vitest
2. **建了 ≠ 接进 app**：WikiPopup 必须在 WorkbenchShell 里可达（wikiActive 非 null 时可见）
3. wiki-entries store 逻辑已完整，**不得修改 wiki-entries.ts**
4. 不改 Bridge 契约/冻结 store 逻辑
5. 不 commit/push；不覆盖用户脏文件；不碰 smoke/
