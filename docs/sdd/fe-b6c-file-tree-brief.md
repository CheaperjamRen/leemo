# Batch 6c Brief — FileTree + file-tree.ts (S11)

**执行者**: Sonnet 5 medium（隔离 worktree）
**验收者**: Opus 4.8 主控（亲跑命令）
**基点**: main（当前 HEAD，501 tests 全绿）
**依赖**: ui store（filesOpen/toggleFiles 已建）、notebooks store（已建）

---

## 目标

实现 S11 文件浏览器第四栏：新建 file-tree.ts store + FileTree.tsx 组件，接进 WorkbenchShell 右侧（filesOpen 时显示），接进 context.tsx。

---

## 文件清单

### 新建
- `src/renderer/stores/file-tree.ts`
- `src/renderer/stores/file-tree.test.ts`
- `src/renderer/components/FileTree.tsx`
- `src/renderer/components/FileTree.test.tsx`

### 修改
- `src/renderer/bridge/context.tsx` — 加 `createFileTreeStore` + `useFileTree` hook
- `src/renderer/components/WorkbenchShell.tsx` — 加文件树列（`filesOpen` 时显示）
- `src/renderer/components/WorkbenchShell.test.tsx` — 补文件树集成测试

### 禁改（零 diff）
- `src/bridge/contract.ts` / `src/bridge/interact.ts`
- `src/renderer/bridge/wiring.ts` / `src/renderer/bridge/client.ts`
- `src/renderer/stores/conversations.ts` / `message-model.ts` / `wiki-entries.ts`
- `smoke/` / `tests/bridge/` / `package.json` / `package-lock.json`

---

## 实现规格

### 1. `file-tree.ts`

```ts
export interface FileNode {
  path: string;
  name: string;
  kind: "file" | "dir";
  bookId: string | null;
  children?: FileNode[];
  isNew?: boolean;
  referenced?: boolean;
}

export interface FileTreeState {
  roots: FileNode[];
  expandedPaths: Set<string>;
  toggleExpand(path: string): void;
  moveToBook(path: string, bookId: string): void;
}

export function createFileTreeStore(initialRoots?: FileNode[]): StoreApi<FileTreeState>
```

逻辑：
- `toggleExpand(path)` — 在 `expandedPaths` 中 add/delete
- `moveToBook(path, bookId)` — 递归找到节点，更新 `bookId`（纯前端 state，Phase-1 才真联动 fs）
- `initialRoots` 默认值 = `FIXTURE_FILE_TREE`（见下方 fixture）

### 2. Fixture 静态树（加入 `src/renderer/bridge/fixtures/index.ts`）

```ts
export const FIXTURE_FILE_TREE: FileNode[] = [
  {
    path: "/books/数据结构",
    name: "数据结构",
    kind: "dir",
    bookId: "数据结构",
    children: [
      { path: "/books/数据结构/第五章笔记.md", name: "第五章笔记.md", kind: "file", bookId: "数据结构", isNew: true },
      { path: "/books/数据结构/遍历-复杂度.html", name: "遍历-复杂度.html", kind: "file", bookId: "数据结构", referenced: true },
    ],
  },
  {
    path: "/books/高等数学",
    name: "高等数学",
    kind: "dir",
    bookId: "高等数学",
    children: [
      { path: "/books/高等数学/极限与连续.md", name: "极限与连续.md", kind: "file", bookId: "高等数学" },
    ],
  },
];
```

### 3. `context.tsx` 修改

新增 import：
```ts
import { createFileTreeStore, type FileTreeState } from "../stores/file-tree";
import { FIXTURE_FILE_TREE } from "./fixtures";
```

`BridgeStores` interface 加：
```ts
fileTree: ReturnType<typeof createFileTreeStore>;
```

`useMemo` 内加：
```ts
fileTree: createFileTreeStore(FIXTURE_FILE_TREE),
```

新增 hook：
```ts
export const useFileTree = <T,>(sel: (s: FileTreeState) => T): T =>
  useStore(useStores().fileTree, sel);
```

### 4. `FileTree.tsx`

Props: 无（全从 hooks 读）

Hooks:
- `useFileTree(s => s.roots)` / `expandedPaths` / `toggleExpand` / `moveToBook`
- `useUi(s => s.openPreview)`
- `useNotebooks(s => s.list)`（用于"移入本子"菜单选项）

布局（固定 260px，随 `ui.filesOpen`）：
```
┌──────────────────────────┐
│ 📁 数据结构          [▼] │  ← dir 行，点击展开/折叠
│   📄 第五章笔记.md  🟡   │  ← file 行，🟡=isNew 琥珀点
│   📄 遍历-复杂度.html ✓  │  ← ✓=referenced 灰勾
│ 📁 高等数学          [▶] │
└──────────────────────────┘
```

行为：
- 点击 dir → `toggleExpand(path)`
- 点击 file → `ui.openPreview(path, name, kind)` （.md→markdown, .html→html, .pdf→pdf, 其他→other）
- 右键菜单（仅"移入本子"可用，其余禁用+tooltip）：
  ```
  移入本子 ▶ [本子列表]
  ──────────
  重命名（Phase-1，禁用）
  删除（Phase-1，禁用）
  在文件夹显示（Phase-1，禁用）
  ```
- "移入本子"子菜单 = `notebooks.list` 遍历，点击 → `moveToBook(path, notebook.id)`

空态：`roots.length === 0` → "本子里还没有文件"

### 5. `WorkbenchShell.tsx` 布局修改

在 `<main>` 内容区最右侧加文件树列（与预览列并列，文件树在最右）：

```tsx
{filesOpen && (
  <div
    className="flex w-[260px] shrink-0 flex-col border-l border-[var(--leemo-line)] bg-[var(--leemo-side)]"
    data-testid="file-tree-column"
  >
    <FileTree />
  </div>
)}
```

新增 hooks：
```ts
const filesOpen = useUi(s => s.filesOpen);
```

顶栏加文件树切换按钮（在搜索按钮左侧）：
```tsx
<button onClick={toggleFiles} className="leemo-icon-btn" title="文件树">
  <svg>/* folder icon */</svg>
</button>
```

---

## 测试要求（严格 TDD）

### `file-tree.test.ts`
```
initializes with provided roots
toggleExpand adds path to expandedPaths
toggleExpand removes already-expanded path
moveToBook updates bookId of matching node
moveToBook updates nested file node
```

### `FileTree.test.tsx`
```
renders empty state when roots is empty
renders dir nodes
renders file nodes with isNew indicator
renders file nodes with referenced indicator
calls toggleExpand on dir click
calls openPreview on file click with correct kind mapping
shows context menu on right click
disables rename/delete/show-in-folder items
calls moveToBook on notebook selection
```

### `WorkbenchShell.test.tsx` 补充
```
renders file tree column when filesOpen is true
hides file tree column when filesOpen is false
```

---

## 验收命令（执行者自跑，主控复跑）

```bash
npm test -- --run
# 预期：≥525 tests，全绿
npm run typecheck
# 预期：三段 exit 0
git diff --check
```

---

## 教训（必须遵守）

1. **局部绿 ≠ 整体健康**：每次改完必须跑 `npm run typecheck`，不只是 vitest
2. **建了 ≠ 接进 app**：FileTree 必须在 WorkbenchShell 里可达（filesOpen=true 时可见），context.tsx 必须加 fileTree store
3. context.tsx 加 fileTree 后，`BridgeStores` interface 和 `useMemo` 内都要同步更新
4. 不改 Bridge 契约/冻结 store 逻辑
5. 不 commit/push；不覆盖用户脏文件；不碰 smoke/
