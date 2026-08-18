# Start Static Workspace and Note Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有看板中的便签 / Todo 能力迁入一个默认不调用模型的顶层“开始”工作区，并增加可写父子文档树、稳定便签引用和“从便签创建关联待办”链路，同时为独立的全局待完成事项计划提供稳定首页槽位。

**Architecture:** 保留 SQLite Capture/Task 两个现有真源，先给 Note 增加最小组织字段，再通过纯函数投影首页、系统视图、树和反向引用。新增 `StartShell` 作为第三个应用表面，但运行时 AI `mode` 仍只允许 buddy/workbench；`surface` 负责页面选择，避免把“开始”误传给 Host。现有 OrganizerPage 在迁移期间继续可用，直到 Start 的真实旅程全部通过后才移除重复入口。

**Tech Stack:** Electron 43、React 19、TypeScript 5.9、Zustand 5、SQLite/better-sqlite3、Lexical Markdown、Vitest/Testing Library。

## Global Constraints

- “开始”中的打开、搜索、编辑、排序、置顶、归档、Todo 勾选和附件操作必须保持零模型调用；只有独立计划定义的手动 / 已授权每日总览梳理可以调用模型。
- 不新增“开始 → 便签”第二套应用壳层；左侧导航固定，选择对象只替换右侧工作面。
- 现有 Alt+N、草稿恢复、revision 冲突、附件 reference/copy、存储迁移、30 天回收站、恢复、永久删除和重启恢复不得退化。
- 便签创建 Todo 时原便签原位保留；Todo 通过 `noteId` 回链来源；双方不做正文自动同步。
- Todo 的父级完成状态只由用户改变；任务回执不能自动完成父级 Todo。
- 不加入标签、知识图谱、任意多父节点、Notion 数据库、云同步或未经用户触发 / 授权的 AI 自动整理。
- 开始页面生产 UI 实现前，必须先由 image2 生成最终权威视觉稿并经用户确认；视觉稿只决定呈现，不得改变本计划的数据语义。
- 每个工程卡只提交本卡文件；不得顺手重构 BuddyShell、WorkbenchShell 或 BridgeHost。

---

### Task 0: Freeze the Start Visual Authority

**Files:**
- Create: `docs/design-audition/visual-redesign/start-static-workspace-v2.png`
- Create: `docs/design-audition/visual-redesign/start-static-workspace-v2.md`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-08-18-start-note-library-design.md`
- Produces: one approved 1440×900 authority image and a parameter sheet used by Tasks 4–7.

- [x] **Step 1: Generate the authority image with image2**

The image shows one top-level `开始` surface with stable navigation containing `首页 / 收集箱 / 待办 / 置顶 / 最近 / 位置 / 我的文档 / 已归档 / 回收站`, and a right-side homepage containing exactly `待完成事项 / 今天 / 收集箱 / 最近`. It contains no AI composer.

- [x] **Step 2: Record measurable parameters**

Write the viewport, topbar height, navigation width, content max-width, typography sizes, row heights, card radii, shadows, focus style and narrow-width behavior. Do not use unmeasurable adjectives.

- [x] **Step 3: Obtain user approval**

Show the image with a short product/user rationale. Task 4 cannot start before explicit approval.

- [x] **Step 4: Commit**

```powershell
git add docs/design-audition/visual-redesign/start-static-workspace-v2.png docs/design-audition/visual-redesign/start-static-workspace-v2.md
git commit -m "docs: freeze start workspace visual authority"
```

### Task 1: Add Note Organization Fields and SQLite Migration

**Files:**
- Modify: `src/captures.ts`
- Modify: `src/main/persistence/capture-persistence.ts`
- Test: `tests/main/capture-persistence.test.ts`

**Interfaces:**
- Produces: `Note.parentId`, `Note.sortOrder`, `Note.pinnedAt`, `Note.organizedAt`; `CapturePersistence.moveNote`, `setNotePinned`, `markNoteOrganized`.
- Consumes: existing `Note` and optimistic `revision` semantics.

- [x] **Step 1: Write failing migration and ordering tests**

Create a legacy `notes` table, reopen it through `createCapturePersistence`, and assert:

```ts
expect(persistence.listNotes()[0]).toMatchObject({
  parentId: null,
  sortOrder: 0,
  pinnedAt: null,
  organizedAt: null,
});
```

Also cover moving beneath another note, sibling reorder, rejecting self/descendant cycles, pinning, organizing, and stale revision atomicity.

- [x] **Step 2: Run RED**

```powershell
npx vitest run tests/main/capture-persistence.test.ts
```

Expected: failures because organization columns and persistence methods do not exist.

- [x] **Step 3: Add exact domain types**

```ts
export interface Note {
  // keep every existing field
  parentId: string | null;
  sortOrder: number;
  pinnedAt: number | null;
  organizedAt: number | null;
}

export interface MoveNoteInput {
  id: string;
  expectedRevision: number;
  parentId: string | null;
  index: number;
}

export interface SetNotePinnedInput {
  id: string;
  expectedRevision: number;
  pinned: boolean;
}

export interface MarkNoteOrganizedInput {
  id: string;
  expectedRevision: number;
  organized: boolean;
}
```

Update construction sites and test factories with explicit defaults; do not silence type failures with casts.

- [x] **Step 4: Implement migration and transactions**

Add `parent_id`, `sort_order`, `pinned_at`, `organized_at` and indexes on `(parent_id, sort_order, id)` and `pinned_at`. `moveNote` reindexes only old/new sibling groups to contiguous integers, increments the moved note revision once, and rejects cycles before any update.

- [x] **Step 5: Verify and commit**

```powershell
npx vitest run tests/main/capture-persistence.test.ts
npx tsc -p tsconfig.json --noEmit
git add src/captures.ts src/main/persistence/capture-persistence.ts tests/main/capture-persistence.test.ts
git commit -m "feat: persist note organization"
```

### Task 2: Expose Organization Through Admin, IPC and Store

**Files:**
- Modify: `src/main/capture-admin.ts`
- Modify: `src/main/capture-ipc.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/capture/client.ts`
- Modify: `src/renderer/stores/captures.ts`
- Test: `tests/main/capture-admin.test.ts`
- Test: `tests/main/capture-ipc.test.ts`
- Test: `src/renderer/stores/captures.test.ts`

**Interfaces:**
- Consumes: Task 1 inputs.
- Produces: `CaptureClient.moveNote`, `setNotePinned`, `markNoteOrganized` and matching Zustand actions.

- [x] **Step 1: Write failing tests**

Cover invalid parent ID, negative index, stale revision, quick-capture sender denial, main sender success, state update without a second refresh, and rollback on client failure.

- [x] **Step 2: Run RED**

```powershell
npx vitest run tests/main/capture-admin.test.ts tests/main/capture-ipc.test.ts src/renderer/stores/captures.test.ts
```

- [x] **Step 3: Add narrow operations**

Add operation names to `CaptureOperationInputs` and `MAIN_OPERATIONS`, never `QUICK_OPERATIONS`. Normalize IDs, revision, boolean and index in admin before persistence.

- [x] **Step 4: Update renderer state atomically**

After a move, apply the returned sibling snapshot without `refresh()`. Keep `selectedId` and the editor draft stable.

- [x] **Step 5: Verify and commit**

```powershell
npx vitest run tests/main/capture-admin.test.ts tests/main/capture-ipc.test.ts src/renderer/stores/captures.test.ts
npm run typecheck
git add src/main/capture-admin.ts src/main/capture-ipc.ts src/main/preload.ts src/renderer/capture/client.ts src/renderer/stores/captures.ts tests/main/capture-admin.test.ts tests/main/capture-ipc.test.ts src/renderer/stores/captures.test.ts
git commit -m "feat: expose note organization operations"
```

### Task 3: Build Pure Tree and Reference Projections

**Files:**
- Create: `src/renderer/notes/note-tree.ts`
- Create: `src/renderer/notes/note-tree.test.ts`
- Create: `src/renderer/notes/note-references.ts`
- Create: `src/renderer/notes/note-references.test.ts`

**Interfaces:**

```ts
export interface NoteTreeNode { note: Note; children: NoteTreeNode[] }
export function buildNoteTree(notes: readonly Note[]): NoteTreeNode[];
export function noteSystemViews(notes: readonly Note[], now: number): {
  inbox: Note[]; pinned: Note[]; recent: Note[];
};
export function noteReferenceHref(noteId: string): string;
export function extractNoteReferenceIds(markdown: string): string[];
export function buildBacklinks(notes: readonly Note[]): Map<string, string[]>;
```

- [x] **Step 1: Write failing pure tests**

Cover deterministic sibling order, missing parents promoted to top level, no input mutation, duplicate references deduplicated in first-seen order, malformed links ignored, and backlinks rebuilt after editing Markdown.

- [x] **Step 2: Run RED**

```powershell
npx vitest run src/renderer/notes/note-tree.test.ts src/renderer/notes/note-references.test.ts
```

- [x] **Step 3: Implement minimal functions**

Use a two-pass `Map` tree build. Encode IDs with `encodeURIComponent` and accept only `leemo-note://` targets. Markdown remains the reference truth; do not add a backlinks table.

- [x] **Step 4: Verify and commit**

```powershell
npx vitest run src/renderer/notes/note-tree.test.ts src/renderer/notes/note-references.test.ts
git add src/renderer/notes
git commit -m "feat: derive note trees and backlinks"
```

### Task 4: Add the Top-Level Start Surface Without Polluting Runtime Mode

**Files:**
- Modify: `src/renderer/stores/settings.ts`
- Modify: `src/renderer/stores/settings.test.ts`
- Modify: `src/renderer/app/App.tsx`
- Modify: `src/renderer/app/App.test.tsx`
- Create: `src/renderer/components/AppSurfaceSwitcher.tsx`
- Create: `src/renderer/components/AppSurfaceSwitcher.test.tsx`
- Modify: `src/renderer/components/TopBar.tsx`
- Modify: `src/renderer/components/TopBar.test.tsx`
- Create: `src/renderer/start/StartShell.tsx`
- Create: `src/renderer/start/StartShell.css`
- Create: `src/renderer/start/StartShell.test.tsx`

**Interfaces:**
- Produces: `AppSurface = "start" | "buddy" | "workbench"`, `SettingsState.surface` and `setSurface`.
- Preserves: `SettingsState.mode = "buddy" | "workbench"` as the only mode sent to runtime.

- [x] **Step 1: Write routing and persistence tests**

Assert Start renders only `StartShell`, preserves Buddy/Workbench drafts, makes zero bridge invokes, and restores `surface: "start"`. An older snapshot with only `mode: "workbench"` must restore Workbench.

- [x] **Step 2: Run RED**

```powershell
npx vitest run src/renderer/stores/settings.test.ts src/renderer/app/App.test.tsx src/renderer/components/AppSurfaceSwitcher.test.tsx src/renderer/components/TopBar.test.tsx src/renderer/start/StartShell.test.tsx
```

- [x] **Step 3: Implement split state**

```ts
setSurface: (surface) => set((state) => ({
  surface,
  mode: surface === "start" ? state.mode : surface,
})),
```

Hydration accepts valid `surface` and otherwise falls back to legacy `mode`. Do not widen `CreateConversationRequest.mode` or Host persona types.

- [x] **Step 4: Implement approved switcher and shell**

Render a distinct Start button followed by the existing paired Buddy/Workbench control. Follow Task 0 measurements, including icon-only narrow degradation and window-control safe space.

- [x] **Step 5: Verify and commit**

```powershell
npx vitest run src/renderer/stores/settings.test.ts src/renderer/app/App.test.tsx src/renderer/components/AppSurfaceSwitcher.test.tsx src/renderer/components/TopBar.test.tsx src/renderer/start/StartShell.test.tsx
npm run typecheck
git add src/renderer/stores/settings.ts src/renderer/stores/settings.test.ts src/renderer/app/App.tsx src/renderer/app/App.test.tsx src/renderer/components/AppSurfaceSwitcher.tsx src/renderer/components/AppSurfaceSwitcher.test.tsx src/renderer/components/TopBar.tsx src/renderer/components/TopBar.test.tsx src/renderer/start/StartShell.tsx src/renderer/start/StartShell.css src/renderer/start/StartShell.test.tsx
git commit -m "feat: add quiet start surface"
```

### Task 5: Implement Start Navigation, Homepage and Todo View

**Files:**
- Create: `src/renderer/start/start-navigation.ts`
- Create: `src/renderer/start/start-navigation.test.ts`
- Create: `src/renderer/start/StartSidebar.tsx`
- Create: `src/renderer/start/StartSidebar.test.tsx`
- Create: `src/renderer/start/StartHome.tsx`
- Create: `src/renderer/start/StartHome.test.tsx`
- Create: `src/renderer/start/StartTasksView.tsx`
- Create: `src/renderer/start/StartTasksView.test.tsx`
- Create: `src/renderer/stores/start.ts`
- Create: `src/renderer/stores/start.test.ts`
- Modify: `src/renderer/start/StartShell.tsx`
- Modify: `src/renderer/start/StartShell.css`

**Interfaces:**

```ts
export type StartDestination =
  | "home" | "inbox" | "tasks" | "pinned" | "recent"
  | "locations" | "documents" | "archive" | "trash";

export interface StartState {
  destination: StartDestination;
  selectedNoteId: string | null;
  open(destination: StartDestination, selectedNoteId?: string | null): void;
}
```

Implementation rule: move the existing today/task rendering and handlers out of `OrganizerPage` into the new Start components; during transition `OrganizerPage` delegates to them. Do not copy forms, date parsing or task mutations into a second implementation.

- [x] **Step 1: Write navigation and zero-AI tests**

Assert fixed order, default home, four homepage sections only, Todo groups `today / undated / planned / completed`, and no conversation/send invoke while navigating, checking a Todo or rendering the persisted overview preview. The actual overview model invocation belongs only to `2026-08-18-global-pending-overview.md`.

- [x] **Step 2: Run RED**

```powershell
npx vitest run src/renderer/start/start-navigation.test.ts src/renderer/stores/start.test.ts src/renderer/start/StartSidebar.test.tsx src/renderer/start/StartHome.test.tsx src/renderer/start/StartTasksView.test.tsx
```

- [x] **Step 3: Implement bounded real views**

Homepage cards link to actual destinations and use bounded previews. Reserve card 01 for the `GlobalPendingOverviewCard` interface from `2026-08-18-global-pending-overview.md`; before that plan is executed it renders only the zero-call initial CTA shell. Todo mutations use the existing task store; do not create another task service.

- [x] **Step 4: Implement narrow overlay**

At the authority breakpoint, turn the sidebar into an overlay with Escape close and focus return. Never compress the editor below the authority minimum.

- [x] **Step 5: Verify and commit**

```powershell
npx vitest run src/renderer/start/start-navigation.test.ts src/renderer/stores/start.test.ts src/renderer/start/StartSidebar.test.tsx src/renderer/start/StartHome.test.tsx src/renderer/start/StartTasksView.test.tsx src/renderer/start/StartShell.test.tsx
npm run typecheck
git add src/renderer/start
git commit -m "feat: add start navigation and action views"
```

### Task 6: Implement Document Explorer and Local References

**Files:**
- Create: `src/renderer/start/StartDocumentsView.tsx`
- Create: `src/renderer/start/StartDocumentsView.test.tsx`
- Create: `src/renderer/start/NoteExplorer.tsx`
- Create: `src/renderer/start/NoteExplorer.test.tsx`
- Create: `src/renderer/start/NoteReferenceMenu.tsx`
- Create: `src/renderer/start/NoteReferenceMenu.test.tsx`
- Modify: `src/renderer/components/CaptureEditor.tsx`
- Modify: `src/renderer/components/CaptureEditor.test.tsx`
- Modify: `src/renderer/components/MarkdownContent.tsx`
- Modify: `src/renderer/components/MarkdownContent.test.tsx`
- Modify: `src/renderer/start/StartShell.tsx`

**Interfaces:**
- Consumes: Task 2 capture mutations and Task 3 projections.
- Produces: local `@便签` insertion, tree drag move, drag-to-editor reference, backlink navigation.

Implementation rule: extract the existing note editor, attachment handlers and note-created-task preview from `OrganizerPage`; `StartDocumentsView` owns the extracted implementation and the legacy page temporarily composes it. Do not fork CaptureEditor or attachment semantics.

- [x] **Step 1: Write interaction tests**

Cover opening a parent note, editing its own body, expanding children, moving notes, inserting references by `@` and drag, opening `leemo-note://` without browser navigation, returning to source, and missing/deleted targets.

- [x] **Step 2: Run RED**

```powershell
npx vitest run src/renderer/start/StartDocumentsView.test.tsx src/renderer/start/NoteExplorer.test.tsx src/renderer/start/NoteReferenceMenu.test.tsx src/renderer/components/CaptureEditor.test.tsx src/renderer/components/MarkdownContent.test.tsx
```

- [x] **Step 3: Implement one drag contract**

Use MIME `application/x-leemo-note` with JSON `{"noteId":"..."}`. Tree drop calls `moveNote`; editor drop inserts `[标题](leemo-note://<encoded-id>)`. Reject malformed payloads and cycles before mutation.

- [x] **Step 4: Intercept local links**

Add `onOpenNoteReference(noteId)` to `MarkdownContent`. Local note links never reach `window.open`, Electron shell or browser navigation.

- [x] **Step 5: Verify and commit**

```powershell
npx vitest run src/renderer/start/StartDocumentsView.test.tsx src/renderer/start/NoteExplorer.test.tsx src/renderer/start/NoteReferenceMenu.test.tsx src/renderer/components/CaptureEditor.test.tsx src/renderer/components/MarkdownContent.test.tsx
npm run typecheck
git add src/renderer/start src/renderer/components/CaptureEditor.tsx src/renderer/components/CaptureEditor.test.tsx src/renderer/components/MarkdownContent.tsx src/renderer/components/MarkdownContent.test.tsx
git commit -m "feat: add local note document explorer"
```

### Task 7: Replace Conversion Copy and Add Source Links

**Files:**
- Modify: `src/renderer/pages/OrganizerPage.tsx`
- Modify: `src/renderer/pages/OrganizerPage.test.tsx`
- Modify: `src/renderer/start/StartDocumentsView.tsx`
- Modify: `src/renderer/start/StartDocumentsView.test.tsx`
- Modify: `src/renderer/start/StartTasksView.tsx`
- Modify: `src/renderer/start/StartTasksView.test.tsx`
- Modify: `src/renderer/stores/tasks.ts`
- Modify: `src/renderer/stores/tasks.test.ts`

**Interfaces:**
- Consumes: existing `CreateManyTasksInput.tasks[].noteId`.
- Produces: `tasksForNote(noteId): UserTask[]` and one-click source navigation.

- [x] **Step 1: Write wording and data tests**

Assert `创建待办`, `从便签创建待办`, `创建 2 条待办` and `已创建 2 条待办 · 便签原文保留`. The note title/Markdown/revision remain unchanged; each task has `noteId` and can return to the source note.

- [x] **Step 2: Run RED**

```powershell
npx vitest run src/renderer/pages/OrganizerPage.test.tsx src/renderer/start/StartDocumentsView.test.tsx src/renderer/start/StartTasksView.test.tsx src/renderer/stores/tasks.test.ts
```

- [x] **Step 3: Keep the existing copy implementation**

Retain `createManyTasks` and `noteId`; change only semantics and backlinks. Do not update/delete the note and do not add a synchronization watcher.

- [x] **Step 4: Verify and commit**

```powershell
npx vitest run src/renderer/pages/OrganizerPage.test.tsx src/renderer/start/StartDocumentsView.test.tsx src/renderer/start/StartTasksView.test.tsx src/renderer/stores/tasks.test.ts
npm run typecheck
git add src/renderer/pages/OrganizerPage.tsx src/renderer/pages/OrganizerPage.test.tsx src/renderer/start/StartDocumentsView.tsx src/renderer/start/StartDocumentsView.test.tsx src/renderer/start/StartTasksView.tsx src/renderer/start/StartTasksView.test.tsx src/renderer/stores/tasks.ts src/renderer/stores/tasks.test.ts
git commit -m "fix: preserve notes when creating tasks"
```

### Task 8: Preserve Trees Through Archive, Trash and Restore

**Files:**
- Modify: `src/captures.ts`
- Modify: `src/main/persistence/capture-persistence.ts`
- Modify: `src/main/capture-admin.ts`
- Modify: `src/main/capture-ipc.ts`
- Modify: `src/renderer/capture/client.ts`
- Modify: `src/renderer/stores/captures.ts`
- Modify: `src/renderer/start/StartDocumentsView.tsx`
- Test: `tests/main/capture-persistence.test.ts`
- Test: `tests/main/capture-admin.test.ts`
- Test: `src/renderer/start/StartDocumentsView.test.tsx`

**Interfaces:**

```ts
export type NoteChildStrategy = "subtree" | "lift";
export interface MutateNoteTreeInput {
  id: string;
  expectedRevision: number;
  childStrategy: NoteChildStrategy;
}
```

- [x] **Step 1: Write atomic subtree tests**

Cover archive/restore subtree, trash/restore subtree, lift preserving order, permanent deletion cleaning only managed attachments, and external originals never deleted.

- [x] **Step 2: Run RED**

```powershell
npx vitest run tests/main/capture-persistence.test.ts tests/main/capture-admin.test.ts src/renderer/start/StartDocumentsView.test.tsx
```

- [x] **Step 3: Implement one transaction per action**

Resolve descendants first, validate the root revision, mutate structural rows atomically, and emit events only after commit.

- [x] **Step 4: Add the explicit choice**

Parents show affected count and exactly `连同子便签一起处理` / `只处理这条，子便签上移`. Leaves keep the current one-step action.

- [x] **Step 5: Verify and commit**

```powershell
npx vitest run tests/main/capture-persistence.test.ts tests/main/capture-admin.test.ts tests/main/capture-ipc.test.ts src/renderer/stores/captures.test.ts src/renderer/start/StartDocumentsView.test.tsx
npm run typecheck
git add src/captures.ts src/main/persistence/capture-persistence.ts src/main/capture-admin.ts src/main/capture-ipc.ts src/renderer/capture/client.ts src/renderer/stores/captures.ts src/renderer/start/StartDocumentsView.tsx tests/main/capture-persistence.test.ts tests/main/capture-admin.test.ts tests/main/capture-ipc.test.ts src/renderer/stores/captures.test.ts src/renderer/start/StartDocumentsView.test.tsx
git commit -m "feat: preserve note trees through archive and trash"
```

### Task 9: Remove the Duplicate Workbench Organizer Route After Parity

**Files:**
- Modify: `src/renderer/components/WorkbenchSidebar.tsx`
- Modify: `src/renderer/components/WorkbenchSidebar.test.tsx`
- Modify: `src/renderer/components/WorkbenchShell.tsx`
- Modify: `src/renderer/components/WorkbenchShell.test.tsx`
- Modify: `src/renderer/stores/ui.ts`
- Modify: `src/renderer/stores/ui.test.ts`
- Delete: `src/renderer/pages/OrganizerPage.tsx`
- Delete: `src/renderer/pages/OrganizerPage.css`
- Delete: `src/renderer/pages/OrganizerPage.test.tsx`

**Interfaces:**
- Consumes: completed Start views from Tasks 4–8.
- Produces: one user-visible source of truth for 首页 / Todo / notes / trash.

- [ ] **Step 1: Write parity and navigation tests**

Assert the Workbench `看板` shortcut changes to the Start surface and opens the intended Start destination; no second Organizer shell renders. Preserve every previously tested task/note/trash action through the Start components.

- [ ] **Step 2: Run RED**

```powershell
npx vitest run src/renderer/components/WorkbenchSidebar.test.tsx src/renderer/components/WorkbenchShell.test.tsx src/renderer/stores/ui.test.ts src/renderer/pages/OrganizerPage.test.tsx src/renderer/start
```

- [ ] **Step 3: Remove only the duplicate route**

Delete `view === "organizer"` from Workbench routing and make the shortcut call `openStart("home")` followed by `setSurface("start")`. Delete the legacy page only after the extracted Start tests cover its behavior; keep shared domain functions in their new focused files.

- [ ] **Step 4: Verify and commit**

```powershell
npx vitest run src/renderer/components/WorkbenchSidebar.test.tsx src/renderer/components/WorkbenchShell.test.tsx src/renderer/stores/ui.test.ts src/renderer/pages/OrganizerPage.test.tsx src/renderer/start
npm run typecheck
git add -A src/renderer/components/WorkbenchSidebar.tsx src/renderer/components/WorkbenchSidebar.test.tsx src/renderer/components/WorkbenchShell.tsx src/renderer/components/WorkbenchShell.test.tsx src/renderer/stores/ui.ts src/renderer/stores/ui.test.ts src/renderer/pages/OrganizerPage.tsx src/renderer/pages/OrganizerPage.css src/renderer/pages/OrganizerPage.test.tsx src/renderer/start src/renderer/stores/start.ts src/renderer/stores/start.test.ts
git commit -m "refactor: route organizer work through start"
```

### Task 10: End-to-End Migration, Visual and Restart Acceptance

**Files:**
- Modify: `src/renderer/app/App.test.tsx`
- Modify: `src/renderer/pages/OrganizerPage.test.tsx`
- Modify: `tests/main/capture-persistence.test.ts`
- Create: `scripts/verify-start-workspace.mjs`
- Create: `docs/verification/2026-08-18-start-workspace.md`

- [ ] **Step 1: Add a deterministic legacy migration fixture**

Create flat notes, archived notes, trash, managed/external attachments and linked Todo rows; run migration twice and assert identical normalized output.

- [ ] **Step 2: Run static verification**

```powershell
npx vitest run tests/main/capture-persistence.test.ts tests/main/capture-admin.test.ts tests/main/capture-ipc.test.ts src/renderer/stores/captures.test.ts src/renderer/stores/tasks.test.ts src/renderer/start src/renderer/app/App.test.tsx src/renderer/pages/OrganizerPage.test.tsx
npm run typecheck
npm run build
npm run build:main
node scripts/verify-start-workspace.mjs
```

- [ ] **Step 3: Run real Electron journeys**

At 1440×900 and 960×680 verify Start homepage, create/edit/restart note, parent/child drag, local reference/backlink, note-created Todo/source return, attachment reference/copy, archive/trash/restore, and zero model requests for ordinary Start operations. Run the global overview plan's separate manual / automatic model-call acceptance before final release.

- [ ] **Step 4: Compare with the authority**

Record measured differences in `docs/verification/2026-08-18-start-workspace.md`. Require no clipped navigation, unintended horizontal scroll, editor compression, focus loss or layout shift from overlays.

- [ ] **Step 5: Commit verification**

```powershell
git add scripts/verify-start-workspace.mjs docs/verification/2026-08-18-start-workspace.md src/renderer/app/App.test.tsx src/renderer/pages/OrganizerPage.test.tsx tests/main/capture-persistence.test.ts
git commit -m "test: verify start workspace journeys"
```
