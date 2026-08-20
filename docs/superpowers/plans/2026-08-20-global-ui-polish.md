# Leemo Global UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the real Leemo desktop surfaces to a coherent, warm-white, high-density visual system while preserving the existing Buddy identity, data contracts, and working interactions.

**Architecture:** Keep the existing React/Electron component boundaries and typed stores. First normalize shared visual tokens and surface roles, then tune workbench state components, settings provider layout, and Start/Skills/right-panel surfaces in separate slices. Each slice keeps behavior intact, adds focused visual/interaction assertions where needed, and is accepted only after a real Electron screenshot at the relevant viewport.

**Tech Stack:** Electron, React, TypeScript, Tailwind utility classes, scoped CSS, Vitest, existing Electron/CDP screenshot workflow.

## Global Constraints

- “开始” remains a static Human Space; browsing, recording, organizing, and linking never call a model.
- Buddy entry performs zero API calls; momo speaks only after a user message or explicit AI action.
- Do not expose provider aliases, SDK names, environment variables, or credentials in user-facing UI.
- Preserve notebook-as-real-folder semantics, typed IPC, approval behavior, raw tool visibility, and restart recovery.
- Large surfaces use warm white or pale oat; cold gray, gray-green, and pure orange are not main canvases.
- Copper is reserved for brand/focus/primary action/real in-progress state; green means success only; red means real danger or failure.
- Static cards use boundaries rather than decorative shadows; shadows are reserved for overlays, menus, and selected surfaces.
- Keep existing dirty-worktree changes; never reset or overwrite unrelated files.
- Retain the newest evidence under `E:\Leemo\.tmp-visual-audit`; add versioned screenshots instead of deleting them.

---

### Task 1: Shared Warm Surface and Typography Tokens

**Files:**
- Modify: `src/renderer/design/tokens.css`
- Modify: `src/renderer/design/effects.css`
- Modify: `src/renderer/design/workbench.css`
- Modify: `src/renderer/start/StartShell.css`
- Test: existing focused token/shell tests under `src/renderer/design` and `src/renderer/components/WorkbenchShell.test.tsx`

**Interfaces:**
- Consumes: current `data-shell` and `data-surface` attributes.
- Produces: stable `--leemo-*` roles for canvas, content, structure, selection, copper focus, ink, secondary text, and warm separators; existing component class names remain unchanged.

- [ ] **Step 1: Write the failing token assertions**

  Add focused assertions to the existing design/shell test location that verify workbench and start expose the same warm canvas/content roles, that the main canvas is not the current gray-green value, and that Buddy still resolves its existing warm surface roles. Assert the public variable names rather than implementation-specific CSS selectors.

- [ ] **Step 2: Run the focused tests and confirm the old roles fail**

  Run: `npx vitest run src/renderer/components/WorkbenchShell.test.tsx`

  Expected: the new role assertions fail against the current gray-green overrides; no unrelated test should fail.

- [ ] **Step 3: Implement the smallest token mapping**

  Map the active workbench/start roles to the approved warm palette (`#FAF8F3`, `#FFFDFC`, `#F5F0E7`, `#F8E9D7`, `#D47A24`, `#142033`, `#66717F`, `#E4DED4`). Keep semantic success/danger variables separate. Remove only the structural gray-green use; do not delete legacy aliases until all consumers resolve through the new roles. Reduce broad background gradients in `workbench.css` to a nearly flat warm canvas.

- [ ] **Step 4: Run tests and typecheck**

  Run: `npx vitest run src/renderer/components/WorkbenchShell.test.tsx`

  Then run: `npx tsc -p tsconfig.renderer.json --noEmit`

  Expected: focused tests pass and renderer typecheck exits 0.

- [ ] **Step 5: Capture a baseline visual screenshot**

  Run `New-Item -ItemType Directory -Force 'E:\Leemo\.tmp-visual-audit\global-ui-polish-2026-08-20'`, then use the existing Electron/CDP capture workflow at 1440x900 for Buddy, Start, and Workbench. Save the three files as `buddy-token-1440x900.png`, `start-token-1440x900.png`, and `workbench-token-1440x900.png`. Check that Buddy has not lost its warm identity and that workbench no longer reads as a gray sheet.

### Task 2: Workbench Conversation and State Hierarchy

**Files:**
- Modify: `src/renderer/components/timeline/TextBubble.tsx`
- Modify: `src/renderer/components/ApprovalBar.tsx`
- Modify: `src/renderer/components/AskUserCard.tsx`
- Modify: `src/renderer/components/timeline/ProcessFold.tsx`
- Modify: `src/renderer/design/workbench.css`
- Test: `src/renderer/components/AskUserCard.test.tsx`
- Test: `src/renderer/components/timeline/turnblock.test.tsx`
- Test: `src/renderer/components/timeline/cards.test.tsx`

**Interfaces:**
- Consumes: existing approval/question stores and `TimelineItem` discriminated unions.
- Produces: stronger user-message separation, compact neutral approval state, visibly selectable ask options, and a quiet completed process row without changing approval/question payloads.

- [ ] **Step 1: Add behavioral/semantic visual assertions**

  Extend focused tests to assert: workbench user bubbles carry a distinct surface class; pending approval keeps one compact command summary and one primary action; ask options expose selected state and a non-selected state; resolved process folds do not retain the pending card’s raised treatment.

- [ ] **Step 2: Run the focused tests and confirm the new assertions fail**

  Run: `npx vitest run src/renderer/components/AskUserCard.test.tsx src/renderer/components/timeline/turnblock.test.tsx src/renderer/components/timeline/cards.test.tsx`

  Expected: only the new assertions fail before styling/markup changes.

- [ ] **Step 3: Tune the message hierarchy**

  Give `.leemo-workbench-user-bubble` a warm content surface and a clear but quiet warm separator, distinct from the canvas. Preserve Buddy bubble rules. Keep assistant answer text unboxed in workbench unless the approved component specifically requires a card. Normalize body text to 14–15px with a 1.58–1.68 line-height and keep metadata at 11.5–12px.

- [ ] **Step 4: Redesign approval and ask surfaces without changing semantics**

  Replace the oversized shield treatment with a small semantic risk marker and text label. Keep the raw command in a compact inset monospace row. Use a single warm outline for pending approval, a single dark/copper primary action, and neutral secondary capsules. For AskUser, use a radio/checkbox marker with a selected warm surface, a slightly different option background, and a disabled submit state that explains its reason through existing affordances; do not add new model calls or fake copy.

- [ ] **Step 5: Collapse completed process state**

  Keep active process details expandable and raw commands inspectable. When the run is terminal, render the existing summary row at 36px height with no large raised card. Preserve full details behind the existing disclosure and preserve progress truthfulness.

- [ ] **Step 6: Run focused tests, typecheck, and screenshot the real states**

  Run the three focused Vitest files from Step 2 and `npx tsc -p tsconfig.renderer.json --noEmit`. Save 1440x900 approval, ask, running, and completed states under `E:\Leemo\.tmp-visual-audit\global-ui-polish-2026-08-20\workbench-approval.png`, `workbench-ask.png`, `workbench-running.png`, and `workbench-completed.png`. Check attention order: answer text first, user message second, active status third, raw tool detail last.

### Task 3: Settings Provider Density and Save Semantics

**Files:**
- Modify: `src/renderer/pages/SettingsPage.css`
- Modify: `src/renderer/components/ProviderConfigForm.tsx`
- Test: `src/renderer/components/ProviderConfigForm.test.tsx`
- Test: `src/renderer/pages/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: existing provider store, typed credential bridge, and settings modal lifecycle.
- Produces: a compact provider rail, dominant configuration work surface, one unambiguous save state, and preserved test-connection/delete/reorder actions.

- [ ] **Step 1: Add layout and save-state assertions**

  Assert that the provider list remains a compact rail, the detail surface is the dominant flex child at desktop width, the selected provider row has a clear selected state, and the UI does not simultaneously present a clean “已保存” status with an enabled-looking “保存设置” primary action.

- [ ] **Step 2: Run the focused settings tests and verify the assertions fail**

  Run: `npx vitest run src/renderer/components/ProviderConfigForm.test.tsx src/renderer/pages/SettingsPage.test.tsx`

- [ ] **Step 3: Rebalance the three-column model surface**

  Keep the outer modal and background context. Set the desktop provider rail to 216px, provider rows to 54px, and let the right detail panel consume the remaining width. Keep provider identity/logo, tabs, fields, model ordering, and actions in the existing DOM; remove only redundant nested framing and excessive blank height.

- [ ] **Step 4: Make save semantics single and clear**

  Use the existing dirty state: clean state shows a quiet saved label and a disabled/no-op save control; dirty state shows one emphasized “保存设置” action. Keep “测试连接” secondary and preserve its real result feedback. Do not alter credential handling.

- [ ] **Step 5: Verify 1440/960 modal behavior**

  Run focused tests and renderer typecheck. Save settings model screenshots as `settings-model-1440x900.png` and `settings-model-960x680.png` in `E:\Leemo\.tmp-visual-audit\global-ui-polish-2026-08-20`, with the underlying app visibly dimmed but readable. Confirm only the settings body scrolls and the footer never covers fields.

### Task 4: Start, Skills, Search, Explorer, and Overview Surface Rhythm

**Files:**
- Modify: `src/renderer/start/StartShell.css`
- Modify: `src/renderer/start/StartHome.tsx`
- Modify: `src/renderer/pages/SkillsPage.css`
- Modify: `src/renderer/pages/SkillsPage.tsx`
- Modify: `src/renderer/pages/GlobalSearchPage.css`
- Modify: `src/renderer/components/FileTree.tsx`
- Modify: `src/renderer/components/WorkbenchOverview.tsx`
- Modify: `src/renderer/components/WorkbenchActivityRail.tsx`
- Test: existing corresponding Start, Skills, Search, FileTree, Overview, and ActivityRail focused tests

**Interfaces:**
- Consumes: existing static Human Space stores, skill catalog, search store, file tree bridge, and overview projection.
- Produces: aligned rows, compact truthful empty states, consistent selected/focus treatment, and no new AI entry points.

- [ ] **Step 1: Add empty-state and parent-layout assertions**

  Assert that empty Skills and empty Start cards do not render full-height dashed scaffolds, same-row Start cards share a height band, selected Start/FileTree rows use the shared focus syntax, and right-panel empty search/overview content stays near its control area.

- [ ] **Step 2: Run the focused page tests and confirm the new assertions fail**

  Run: `npx vitest run src/renderer/start/StartHome.test.tsx src/renderer/pages/SkillsPage.test.tsx src/renderer/pages/GlobalSearchPage.test.tsx src/renderer/components/FileTree.test.tsx src/renderer/components/WorkbenchOverview.test.tsx src/renderer/components/WorkbenchActivityRail.test.tsx`

- [ ] **Step 3: Tune Start without adding content**

  Preserve the existing left navigation. Align the four overview cards, collapse empty content to a compact 120–160px message/action area, and keep real counts/rows only. Use the warm shared roles and the same row height/icon baseline as the navigation.

- [ ] **Step 4: Tune Skills empty and populated states**

  Remove decorative dashed separators from the empty state. Keep a short explanation, one real “添加技能” action, and no fabricated examples. In populated/detail views, use white content surfaces with copper only for selected/installation state; keep Markdown detail content intact.

- [ ] **Step 5: Tune right panels**

  Apply the Start row rhythm to search, Explorer, overview, and activity rail. At 960px and below, use existing overlay behavior rather than squeezing the central work surface. Preserve focus return and all real actions.

- [ ] **Step 6: Run tests/typecheck and capture page evidence**

  Run the focused command from Step 2 plus `npx tsc -p tsconfig.renderer.json --noEmit`. Save Start populated, Skills empty/detail, Search, Explorer, and Overview screenshots at 1440x900 and 960x680 under `E:\Leemo\.tmp-visual-audit\global-ui-polish-2026-08-20`. Keep every newest screenshot in the QA directory.

### Task 5: Full Visual Regression and Release Gate

**Files:**
- Modify only the scoped files from Tasks 1–4 if the screenshot audit finds a concrete regression.
- Add: `docs/research/2026-08-20-global-ui-polish-qa.md`

**Interfaces:**
- Consumes: all existing stores, real Electron bridge, and the screenshot matrix in the approved design spec.
- Produces: reproducible evidence and a short residual-risk list; no claims based solely on component tests.

- [ ] **Step 1: Run focused regression suites**

  Run the combined focused Vitest command covering Tasks 1–4, then `npx tsc -p tsconfig.renderer.json --noEmit` and `git diff --check` on only the scoped files.

- [ ] **Step 2: Run real Electron journeys**

  Verify: enter Buddy without an API call; send one Buddy message; enter Workbench; trigger an approval; answer an AskUser card; inspect raw tool detail; open a provider setting; open Skills; open Start and a document; open a right-side panel. Record any failure with the exact screen and action.

- [ ] **Step 3: Review screenshots as whole screens**

  For each screenshot check contrast, visual center, object density, baseline alignment, parent layout after hidden/removed content, focus/hover state, and whether secondary cards steal attention from momo’s answer. Do not accept “tests pass” as visual acceptance.

- [ ] **Step 4: Run the external second-eye review**

  Ask Kimi to read the retained PNGs and first enumerate visible facts, then report only material differences. Treat its report as evidence, not authority; reconcile it with the Leemo design spec and real interaction behavior.

- [ ] **Step 5: Write the QA report and stop at residual risks**

  Write `docs/research/2026-08-20-global-ui-polish-qa.md` with screenshot paths, tested journeys, pass/fail results, and remaining P2 visual items. Do not delete screenshots or claim 90%+ until the whole-screen checks pass.
