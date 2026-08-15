# Batch 6a Brief — PreviewPane + SelectionMenu (S9)

**执行者**: Sonnet 5 medium（隔离 worktree）
**验收者**: Opus 4.8 主控（亲跑命令）
**基点**: main（当前 HEAD，501 tests 全绿）
**依赖**: Batch 0-5 全部已合 main

---

## 目标

实现 S9 预览区面板 + 选区菜单，接进 WorkbenchShell 右侧列，让 `ui.openPreview` 的 action 有可见面板。

---

## 文件清单

### 新建
- `src/renderer/utils/wrap-visualization-html.ts` — 从 VisualizationCard.tsx 提取 wrapVisualizationHtml 纯函数并导出
- `src/renderer/components/PreviewPane.tsx`
- `src/renderer/components/PreviewPane.test.tsx`
- `src/renderer/components/SelectionMenu.tsx`
- `src/renderer/components/SelectionMenu.test.tsx`

### 修改
- `src/renderer/stores/ui.ts` — 加 `closePreviewTab(path: string): void`
- `src/renderer/stores/ui.test.ts` — 补 closePreviewTab 测试
- `src/renderer/components/VisualizationCard.tsx` — 改用 import wrapVisualizationHtml（删本地定义）
- `src/renderer/components/WorkbenchShell.tsx` — 加预览列 + WikiPopup 占位渲染槽
- `src/renderer/components/WorkbenchShell.test.tsx` — 补预览列集成测试

### 禁改（零 diff）
- `src/bridge/contract.ts` / `src/bridge/interact.ts`
- `src/renderer/bridge/wiring.ts` / `src/renderer/bridge/client.ts`
- `src/renderer/stores/conversations.ts` / `message-model.ts` / `wiki-entries.ts`
- `smoke/` / `tests/bridge/` / `package.json` / `package-lock.json`

---

## 实现规格

### 1. `wrap-visualization-html.ts`

```ts
export function wrapVisualizationHtml(html: string): string {
  // 原 VisualizationCard 内的同名函数，逐字迁移
}
```

VisualizationCard.tsx 改为 `import { wrapVisualizationHtml } from "../utils/wrap-visualization-html"` 并删本地定义。

### 2. `ui.ts` — 加 `closePreviewTab(path)`

逻辑：
- 从 `previewTabs` 移除该 path 的 tab
- 若移除的是 `previewActivePath`：切到左邻 tab（若无则右邻）；若无邻居则 `previewActivePath = null`
- `previewTabs` 变空后 `previewOpen` **保持 true**（spec §S9 empty 态：面板开着但无 tab，显示提示文字）

```ts
closePreviewTab: (path) => set((state) => {
  const tabs = state.previewTabs.filter(t => t.path !== path);
  let activePath = state.previewActivePath;
  if (activePath === path) {
    const idx = state.previewTabs.findIndex(t => t.path === path);
    activePath = tabs[idx - 1]?.path ?? tabs[idx]?.path ?? null;
  }
  return { previewTabs: tabs, previewActivePath: activePath };
}),
```

### 3. `PreviewPane.tsx`

Props: 无（全从 hooks 读）

Hooks: `useUi` 读 `previewTabs / previewActivePath / previewOpen / closePreviewTab / openPreview`

状态机（本地 state）：
- `loading` — 取文件内容中（首发：立即变 ready，无真实 fs）
- `ready` — 渲染内容
- `error` — "打不开这个文件"
- `empty` — `previewTabs.length === 0`，显示"没有打开的文件，从对话或文件树点开一个"

内容渲染（按 activeTab.kind）：
- `markdown` → `<pre className="whitespace-pre-wrap text-sm">` 渲染（首发无 markdown 库，K3 穿衣时升级）
- `html` → `<iframe sandbox="allow-scripts" srcDoc={wrapVisualizationHtml(content)} />`
- `pdf` → `<div>PDF 预览 Phase-1 可用</div>`（占位）
- `other` → `<div>不支持预览，<a>下载</a>（Phase-1）</div>`

首发文件内容来源：fixture 静态 map（path → content string），无真实 fs 读取。

标签条：`previewTabs` 列表，每个 tab 有关闭按钮（调 `closePreviewTab`）。

SelectionMenu 集成：`PreviewPane` 内渲染 `<SelectionMenu />`，传 `filePath={previewActivePath}`。

WikiPopup 渲染槽：`{wikiActive && <WikiPopupPlaceholder />}`（6b 实现前用空 div 占位，6b 完成后替换）。

### 4. `SelectionMenu.tsx`

Props: `filePath: string | null`

行为：
- `mouseup` 事件监听（在 PreviewPane 容器上）
- `window.getSelection()` 非空且 `rangeCount > 0` → 计算 `getBoundingClientRect()` → 显示菜单
- 菜单按钮：**[问一下]** / **[翻译]** / **[复制]** / **[高亮]**
- [问一下] → `wikiEntries.openPopup(filePath, selectedText)`（调 `useWikiEntries`）
- [翻译] → `wikiEntries.openPopup(filePath, selectedText)` 后 `wikiEntries.ask("把这段翻译成中文")`
- [复制] → `navigator.clipboard.writeText(selectedText)`
- [高亮] → 给选区所在元素加 CSS class `leemo-highlight`（纯前端，刷新丢失）
- 位置：`position: fixed`，clamp 在视口内（`Math.min(Math.max(x, 8), window.innerWidth - menuWidth - 8)`）
- 选区清除或点击外部 → 隐藏菜单

### 5. `WorkbenchShell.tsx` 布局修改

在 `<main>` 内，chat 视图下，在现有内容区右侧加预览列：

```tsx
<div className="flex min-h-0 flex-1">
  {/* 现有内容区 */}
  <div className="flex min-w-0 flex-1 flex-col">
    {/* 原 content */}
  </div>
  {/* 预览列 */}
  {previewOpen && (
    <div
      className="flex shrink-0 flex-col border-l border-[var(--leemo-line)]"
      style={{ width: previewWidthPx }}
      data-testid="preview-pane-column"
    >
      <PreviewPane />
    </div>
  )}
</div>
```

新增 hooks：`previewOpen = useUi(s => s.previewOpen)`, `previewWidthPx = useUi(s => s.previewWidthPx)`

---

## 测试要求（严格 TDD）

### `ui.test.ts` 补充
```
closePreviewTab removes tab and switches active to left neighbor
closePreviewTab on last tab leaves previewOpen true with empty tabs
closePreviewTab on non-active tab does not change activePath
```

### `PreviewPane.test.tsx`
```
renders empty state when previewTabs is empty
renders tab bar with close buttons
renders markdown content in pre element
renders html content in iframe
renders pdf placeholder
switches active tab on click
calls closePreviewTab on close button click
```

### `SelectionMenu.test.tsx`
```
hidden when no selection
shows menu on mouseup with selection
calls openPopup on 问一下 click
calls clipboard on 复制 click
hides on selection clear
```

### `WorkbenchShell.test.tsx` 补充
```
renders preview column when previewOpen is true
hides preview column when previewOpen is false
```

---

## 验收命令（执行者自跑，主控复跑）

```bash
npm test -- --run
# 预期：≥520 tests，全绿
npm run typecheck
# 预期：三段 exit 0
git diff --check
```

---

## 教训（必须遵守）

1. **局部绿 ≠ 整体健康**：每次改完必须跑 `npm run typecheck`（不只是 vitest），typecheck 失败不算完成
2. **建了 ≠ 接进 app**：PreviewPane 必须在 WorkbenchShell 里可达（previewOpen=true 时可见），不能是孤儿组件
3. 不改 Bridge 契约/冻结 store 逻辑
4. 不 commit/push；不覆盖用户脏文件；不碰 smoke/
