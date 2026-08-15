# Leemo 交互密度与本子生命周期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` in the primary session. Do not dispatch implementation subagents; one read-only visual auditor is the only delegated worker allowed by the user.

**Goal:** 修复真实 Electron 路径中的交互断点，补齐本子非破坏性生命周期，并把工作台从低密度灰白界面校准为已批准的冷中性、紧凑而可信的 Agent 工作台。

**Architecture:** 先建立少量共享交互原语（真实 Switch、锚定浮层定位、密度 token），再让现有页面复用；本子生命周期采用小型主进程元数据索引，真实目录保持原位且普通操作永不删除文件。每个纵切都在当前共享工作树内完成 focused RED→GREEN，并在真实 Electron 中截图验收；不以组件测试代替集成验证。

**Tech Stack:** Electron、React、TypeScript、Zustand、Vitest、Testing Library、CSS tokens、typed preload IPC。

## Global Constraints

- 当前共享工作树有大量用户/既有改动；只用 `apply_patch`，逐文件核对 diff，不 reset/checkout/stage/commit。
- 不新增 UI 框架或浮层依赖；复用 React portal、DOMRect 和现有 token 系统。
- 所有任务临时文件、截图、缓存使用 E 盘。
- 外部文件夹的“从 Leemo 移除”只解除登记；托管本子的“归档”只隐藏视图；二者都不得删除、移动或覆盖真实目录。
- 工作台与搭子共享能力层，但视觉心智保持不同：工作台冷中性/海军蓝层级，搭子暖色陪伴感。
- 视觉完成需真实 Electron 1440×900、1280×800、1024×768 截图；五组 P1 未清零不得宣称 READY。
- 不做付费基础设施、全量架构重写或与当前主链路无关的边角测试。

---

### Task 1: 共享交互底座与首批断点

**Files:**
- Create: `src/renderer/components/AnchoredLayer.tsx`
- Create: `src/renderer/components/AnchoredLayer.test.tsx`
- Create: `src/renderer/components/LeemoSwitch.tsx`
- Create: `src/renderer/components/LeemoSwitch.test.tsx`
- Modify: `src/renderer/pages/SettingsPage.tsx`
- Modify: `src/renderer/pages/SettingsPage.css`
- Modify: `src/renderer/pages/SettingsPage.test.tsx`
- Modify: `src/renderer/components/TopBar.tsx`
- Modify: `src/renderer/components/TopBar.test.tsx`
- Modify: `src/renderer/components/WorkbenchSidebar.tsx`
- Modify: `src/renderer/components/WorkbenchSidebar.test.tsx`
- Modify: `src/renderer/components/ConversationListItem.tsx`
- Modify: `src/renderer/components/ConversationListItem.test.tsx`
- Modify: `src/renderer/components/timeline/MessageFooter.tsx`
- Modify: `src/renderer/components/timeline/MessageFooter.test.tsx`
- Modify: `src/renderer/AppOverlays.tsx`
- Test: corresponding focused tests above

**Interfaces:**
- Produces: `AnchoredLayer({ open, anchor, placement, onDismiss, children })`，通过 portal、flip、shift、clamp 返回不引起正文 reflow 的浮层。
- Produces: `LeemoSwitch({ checked, onCheckedChange, disabled, label })`，使用 `role="switch"`、`aria-checked` 和真实位移 thumb。
- Consumes: existing CSS tokens and current state callbacks; no new store.

- [ ] **Step 1: Write focused failing tests**

```tsx
expect(screen.getByRole("switch", { name: "关闭窗口后继续运行" }))
  .toHaveAttribute("aria-checked", "false");
expect(screen.getByTestId("switch-thumb")).toHaveAttribute("data-side", "left");

openMenuNearViewportBottom();
expect(screen.getByRole("menu").getBoundingClientRect().bottom)
  .toBeLessThanOrEqual(window.innerHeight - 8);

expect(screen.getAllByRole("button", { name: "收起侧栏" })).toHaveLength(1);
```

- [ ] **Step 2: Run RED**

Run:
`npx vitest run src/renderer/components/AnchoredLayer.test.tsx src/renderer/components/LeemoSwitch.test.tsx src/renderer/pages/SettingsPage.test.tsx src/renderer/components/TopBar.test.tsx src/renderer/components/WorkbenchSidebar.test.tsx src/renderer/components/ConversationListItem.test.tsx src/renderer/components/timeline/MessageFooter.test.tsx`

Expected: new switch, collision placement, single collapse control, and non-reflow usage assertions fail for the intended reasons.

- [ ] **Step 3: Implement minimal shared primitives and migrate visible paths**

```ts
type LayerPlacement = "top-start" | "top-end" | "bottom-start" | "bottom-end";
function placeLayer(anchor: DOMRect, layer: DOMRect, viewport: DOMRect, preferred: LayerPlacement): { top: number; left: number };
```

Use one portal layer for usage, notification, conversation menu, and other menus touched by this task. Remove the inner workbench collapse button; the top control is the sole sidebar toggle.

- [ ] **Step 4: Run GREEN and typecheck**

Run focused command from Step 2, then `npx tsc -p tsconfig.renderer.json --noEmit`.

- [ ] **Step 5: Real Electron QA**

At 1440×900 and 1024×768 verify: switch thumb left/right, notification avoids rail, usage hover does not move messages, bottom conversation menu flips upward, exactly one sidebar toggle.

---

### Task 2: 本子归档、恢复与外部解除绑定

**Files:**
- Create: `src/main/notebook-registry.ts`
- Create: `tests/main/notebook-registry.test.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/host/workspace.ts`
- Modify: `src/renderer/workspace/client.ts`
- Modify: `src/renderer/stores/notebooks.ts`
- Modify: `src/renderer/stores/notebooks.test.ts`
- Modify: `src/renderer/components/WorkspaceSwitcher.tsx`
- Modify: `src/renderer/components/WorkspaceSwitcher.test.tsx`
- Modify: `src/renderer/components/WorkbenchSidebar.tsx`
- Modify: `src/renderer/components/WorkbenchSidebar.test.tsx`

**Interfaces:**
- Produces: managed notebook view metadata `{ id, relativePath, displayName, archivedAt }` persisted by main.
- Produces renderer actions: `renameNotebookDisplay(id, displayName)`, `archiveNotebook(id)`, `restoreNotebook(id)`.
- Keeps existing external `forgetWorkspace(id)` semantics: registry-only deletion, real folder untouched.

- [ ] **Step 1: Write persistence and visible-path RED tests**

```ts
expect(registry.archive("诊断").archivedAt).toBeTypeOf("number");
expect(listVisible()).not.toContainEqual(expect.objectContaining({ id: "诊断" }));
expect(listArchived()).toContainEqual(expect.objectContaining({ id: "诊断" }));
expect(fs.existsSync(notebookDirectory)).toBe(true);
```

UI tests must assert row ellipsis exposes “修改显示名称 / 在资源管理器中显示 / 归档”; external rows additionally expose “从 Leemo 移除” with non-deletion copy; archived entry restores after restart.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/main/notebook-registry.test.ts src/renderer/stores/notebooks.test.ts src/renderer/components/WorkspaceSwitcher.test.tsx src/renderer/components/WorkbenchSidebar.test.tsx`

- [ ] **Step 3: Implement versioned, atomic metadata without moving directories**

```ts
interface StoredNotebookView {
  id: string;
  relativePath: string;
  displayName: string;
  archivedAt: number | null;
}
```

Unknown/directly created directories are adopted on scan. Missing directories remain recoverable metadata and are not silently discarded. Archiving the active notebook returns the UI to global scope.

- [ ] **Step 4: Run GREEN, main/renderer typecheck, restart test**

Run Step 2, `npx tsc -p tsconfig.json --noEmit`, and `npx tsc -p tsconfig.renderer.json --noEmit`.

- [ ] **Step 5: Real Electron QA**

Archive and restore one managed notebook; detach and re-add one external folder; restart between actions and confirm all real folders/files remain intact.

---

### Task 3: 可信失败恢复、成果直达与发布身份

**Files:**
- Modify: `src/renderer/pages/ArtifactsPage.tsx`
- Modify: `src/renderer/pages/ArtifactsPage.test.tsx`
- Modify: `src/renderer/components/timeline/FailureRecoveryCard.tsx`
- Modify: `src/renderer/components/timeline/FailureRecoveryCard.test.tsx`
- Modify only if required by the verified failure route: `src/renderer/components/timeline/RawToolDetails.tsx`
- Modify: `src/main/main.ts`
- Modify: relevant main test proving product version
- Modify: `src/renderer/components/ProviderBrandIcon.tsx`
- Modify: `src/renderer/components/ProviderList.test.tsx`

**Interfaces:**
- Artifact row primary action calls existing preview store action; nested auxiliary buttons stop propagation.
- Transport retry remains provider-native up to five attempts.
- Local retry is allowed only for explicitly idempotent read/search tools; mutating tools never replay automatically.
- About reads Leemo package SemVer (`0.1.0` in current tree), never Electron runtime version.

- [ ] **Step 1: Write focused RED tests** for whole-row artifact preview, product SemVer, terminal retry visibility, and no retry for mutating tools.
- [ ] **Step 2: Run focused tests and confirm intended failures.**
- [ ] **Step 3: Implement minimal routes** without broad retry framework changes or fabricated provider marks.
- [ ] **Step 4: Run focused tests, renderer/main typecheck, and `npm run build:main`.**
- [ ] **Step 5: Real Electron QA** with one successful artifact, one transient read/search failure, one terminal failure, and About/Provider pages.

---

### Task 4: 密度、色彩与整页视觉收口

**Files:**
- Modify: `src/renderer/design/tokens.css`
- Modify: `src/renderer/design/workbench.css`
- Modify: `src/renderer/design/effects.css`
- Modify: `src/renderer/components/TopBar.css`
- Modify: `src/renderer/components/BuddyShell.css`
- Modify: `src/renderer/pages/SettingsPage.css`
- Modify scoped page CSS only where screenshots show remaining material gaps.
- Test: existing shell/page focused tests plus minimal computed-style assertions.

**Interfaces:**
- Produces semantic density tokens for shell chrome, list rows, settings rows, gaps, card padding, and typography.
- Preserves existing color token override architecture for future user themes.

- [ ] **Step 1: Add computed-style RED assertions** for 60–64px topbar, 36–40px New Chat, 34–36px sidebar rows, 48–56px dock, 52–60px settings rows, and unambiguous mode selected state.
- [ ] **Step 2: Run focused RED.**
- [ ] **Step 3: Implement token-driven density and restrained color hierarchy**; do not globally shrink body text or add decorative shadow to every surface.
- [ ] **Step 4: Run focused tests and renderer typecheck.**
- [ ] **Step 5: Capture final matrix** at 1440×900, 1280×800, 1024×768 for workbench/buddy, empty/non-empty, scrolled bottom, menus, failure, notebook lifecycle, and artifact preview.
- [ ] **Step 6: Score the independent audit matrix**; total must be at least 90/100 and all P1 findings closed before declaring READY.

## Self-Review

- Spec coverage: all five independent-audit P1 groups map to Tasks 1–4; notebook non-deletion and restart recovery are explicit.
- Placeholder scan: no TBD/“appropriate handling” placeholders; conditional files are restricted to routes whose ownership must be verified before editing.
- Type consistency: managed notebook lifecycle actions remain separate from external `forgetWorkspace`; shared layers do not own product state.
- Opportunity cost: no full rewrite, no new dependency, no physical folder rename/delete, no enterprise-grade test matrix.
