# Leemo Global UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the real Leemo desktop surfaces to a coherent, white-copper, high-density visual system while preserving the existing Buddy identity, data contracts, and working interactions.

**Architecture:** Keep the existing React/Electron component boundaries and typed stores. First normalize shared visual tokens and surface roles, then tune workbench state components, settings provider layout, and Start/Skills/right-panel surfaces in separate slices. Each slice keeps behavior intact, adds focused visual/interaction assertions where needed, and is accepted only after a real Electron screenshot at the relevant viewport.

**Tech Stack:** Electron, React, TypeScript, Tailwind utility classes, scoped CSS, Vitest, existing Electron/CDP screenshot workflow.

## Global Constraints

- “开始” remains a static Human Space; browsing, recording, organizing, and linking never call a model.
- Buddy entry performs zero API calls; momo speaks only after a user message or explicit AI action.
- Do not expose provider aliases, SDK names, environment variables, or credentials in user-facing UI.
- Preserve notebook-as-real-folder semantics, typed IPC, approval behavior, raw tool visibility, and restart recovery.
- Large surfaces use natural white or pale warm supporting surfaces; depressing gray, gray-green, and pure orange are not main canvases.
- The approved default palette is `white-copper`: blue-green ink, copper focus, pale blue support. `warm-copper` and `white-indigo` remain tokenized future themes.
- Copper is reserved for brand/focus/primary action/real in-progress state; green means success only; red means real danger or failure.
- Static cards use boundaries rather than decorative shadows; shadows are reserved for overlays, menus, and selected surfaces.
- Keep existing dirty-worktree changes; never reset or overwrite unrelated files.
- Retain the newest evidence under `E:\Leemo\.tmp-visual-audit`; add versioned screenshots instead of deleting them.
- Keep user Todo, Agent Run Plan, and long-term Goal as separate semantic objects. A workbench run plan must not become a user Todo unless the user explicitly asks for one.
- Adopt Codex/shadcnblocks spatial rhythm: one content axis, compact rows, one raised focus, token-driven surfaces, and context actions instead of stacked control cards.

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

- [x] **Step 1: Write the failing token assertions**

  Add focused assertions to the existing design/shell test location that verify workbench and start expose the same warm canvas/content roles, that the main canvas is not the current gray-green value, and that Buddy still resolves its existing warm surface roles. Assert the public variable names rather than implementation-specific CSS selectors.

- [x] **Step 2: Run the focused tests and confirm the old roles fail**

  Run: `npx vitest run src/renderer/components/WorkbenchShell.test.tsx`

  Expected: the new role assertions fail against the current gray-green overrides; no unrelated test should fail.

- [x] **Step 3: Implement the smallest token mapping**

  Map the active workbench/start roles to the approved `white-copper` palette (`#FBFCFD`, `#FFFFFF`, `#F3F6F8`, `#FFF0E8`, `#C65F2C`, `#193B4B`, `#5D7180`, `#D9E4EA`). Keep semantic success/danger variables separate. Remove only the structural gray-green use; do not delete legacy aliases until all consumers resolve through the new roles. Reduce broad background gradients in `workbench.css` to a nearly flat white canvas.

- [x] **Step 4: Run tests and typecheck**

  Run: `npx vitest run src/renderer/components/WorkbenchShell.test.tsx`

  Then run: `npx tsc -p tsconfig.renderer.json --noEmit`

  Expected: focused tests pass and renderer typecheck exits 0.

- [x] **Step 5: Capture a baseline visual screenshot**

  Run `New-Item -ItemType Directory -Force 'E:\Leemo\.tmp-visual-audit\global-ui-polish-2026-08-20'`, then use the existing Electron/CDP capture workflow at 1440x900 for Buddy, Start, and Workbench. Save the three files as `buddy-token-1440x900.png`, `start-token-1440x900.png`, and `workbench-token-1440x900.png`. Check that Buddy has not lost its warm identity and that workbench no longer reads as a gray sheet.

### Task 1A: Theme preference and hot switching (after visual acceptance)

- [x] Add a validated `themeId` setting with `white-copper` as the default and
      `warm-copper` / `white-indigo` as the only alternate ids.
- [x] Persist and hydrate the preference through the existing settings path;
      changing it must update only `document.documentElement[data-theme]` and
      must not recreate conversations, reload a notebook, or call a model.
- [x] Add a compact Settings appearance control with a live preview and a
      restart-recovery assertion. Do not expose raw token names or hex values
      to users.

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

- [x] **Step 1: Add behavioral/semantic visual assertions**

  Extend focused tests to assert: workbench user bubbles carry a distinct surface class; pending approval keeps one compact command summary and one primary action; ask options expose selected state and a non-selected state; resolved process folds do not retain the pending card’s raised treatment.

- [x] **Step 2: Run the focused tests and confirm the new assertions fail**

  Run: `npx vitest run src/renderer/components/AskUserCard.test.tsx src/renderer/components/timeline/turnblock.test.tsx src/renderer/components/timeline/cards.test.tsx`

  Expected: only the new assertions fail before styling/markup changes.

- [x] **Step 3: Tune the message hierarchy**

  Give `.leemo-workbench-user-bubble` a warm content surface and a clear but quiet warm separator, distinct from the canvas. Preserve Buddy bubble rules. Keep assistant answer text unboxed in workbench unless the approved component specifically requires a card. Normalize body text to 14–15px with a 1.58–1.68 line-height and keep metadata at 11.5–12px.

- [x] **Step 4: Redesign approval and ask surfaces without changing semantics**

  Replace the oversized shield treatment with a small semantic risk marker and text label. Keep the raw command in a compact inset monospace row. Use a single warm outline for pending approval, a single dark/copper primary action, and neutral secondary capsules. For AskUser, use a radio/checkbox marker with a selected warm surface, a slightly different option background, and a disabled submit state that explains its reason through existing affordances; do not add new model calls or fake copy.

- [x] **Step 5: Collapse completed process state**

  Keep active process details expandable and raw commands inspectable. When the run is terminal, render the existing summary row at 36px height with no large raised card. Preserve full details behind the existing disclosure and preserve progress truthfulness.

- [x] **Step 6: Run focused tests, typecheck, and screenshot the real states**

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

- [x] **Step 1: Add layout and save-state assertions**

  Assert that the provider list remains a compact rail, the detail surface is the dominant flex child at desktop width, the selected provider row has a clear selected state, and the UI does not simultaneously present a clean “已保存” status with an enabled-looking “保存设置” primary action.

- [x] **Step 2: Run the focused settings tests and verify the assertions fail**

  Run: `npx vitest run src/renderer/components/ProviderConfigForm.test.tsx src/renderer/pages/SettingsPage.test.tsx`

- [x] **Step 3: Rebalance the three-column model surface**

  Keep the outer modal and background context. Set the desktop provider rail to 216px, provider rows to 54px, and let the right detail panel consume the remaining width. Keep provider identity/logo, tabs, fields, model ordering, and actions in the existing DOM; remove only redundant nested framing and excessive blank height.

- [x] **Step 4: Make save semantics single and clear**

  Use the existing dirty state: clean state shows a quiet saved label and a disabled/no-op save control; dirty state shows one emphasized “保存设置” action. Keep “测试连接” secondary and preserve its real result feedback. Do not alter credential handling.

- [x] **Step 5: Verify 1440/960 modal behavior**

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

- [x] **Step 1: Add empty-state and parent-layout assertions**

  Assert that empty Skills and empty Start cards do not render full-height dashed scaffolds, same-row Start cards share a height band, selected Start/FileTree rows use the shared focus syntax, and right-panel empty search/overview content stays near its control area.

- [x] **Step 2: Run the focused page tests and confirm the new assertions fail**

  Run: `npx vitest run src/renderer/start/StartHome.test.tsx src/renderer/pages/SkillsPage.test.tsx src/renderer/pages/GlobalSearchPage.test.tsx src/renderer/components/FileTree.test.tsx src/renderer/components/WorkbenchOverview.test.tsx src/renderer/components/WorkbenchActivityRail.test.tsx`

- [x] **Step 3: Tune Start without adding content**

  Preserve the existing left navigation. Align the four overview cards, collapse empty content to a compact 120–160px message/action area, and keep real counts/rows only. Use the warm shared roles and the same row height/icon baseline as the navigation.

- [x] **Step 4: Tune Skills empty and populated states**

  Remove decorative dashed separators from the empty state. Keep a short explanation, one real “添加技能” action, and no fabricated examples. In populated/detail views, use white content surfaces with copper only for selected/installation state; keep Markdown detail content intact.

- [x] **Step 5: Tune right panels**

  Apply the Start row rhythm to search, Explorer, overview, and activity rail. At 960px and below, use existing overlay behavior rather than squeezing the central work surface. Preserve focus return and all real actions.

- [x] **Step 6: Run tests/typecheck and capture page evidence**

  Run the focused command from Step 2 plus `npx tsc -p tsconfig.renderer.json --noEmit`. Save Start populated, Skills empty/detail, Search, Explorer, and Overview screenshots at 1440x900 and 960x680 under `E:\Leemo\.tmp-visual-audit\global-ui-polish-2026-08-20`. Keep every newest screenshot in the QA directory.

### Task 4A: Separate Agent Run Plan from User Todo

**Files:**
- Modify: `src/renderer/components/timeline/PlanCard.tsx`
- Modify: `src/renderer/components/timeline/ProcessFold.tsx`
- Modify: `src/renderer/components/timeline/TurnBlock.tsx` only if event placement requires it
- Test: `src/renderer/components/timeline/cards.test.tsx`
- Test: `src/renderer/components/timeline/turnblock.test.tsx`
- Test: `src/renderer/start/StartTasksView.test.tsx` only for user-Todo semantics

**Contract:**

- `UserTask.status` remains user-owned (`open`/`done`).
- Timeline `plan` items remain run-scoped Agent Run Plan records; they do not create or complete UserTask records.
- A Todo/Run relationship is created only by an explicit user-originated task launch or `@待办` binding.

- [x] Add focused assertions that a normal run without a plan renders no plan row, a planned run renders one compact summary row, and expansion exposes truthful step states. (`turnblock.test.tsx`, `cards.test.tsx`)
- [x] Assert terminal success, blocked, retryable failure, and waiting-for-user states remain distinct and retain the run in the timeline. (`turnblock.test.tsx`, `FailureRecoveryCard.test.tsx`, `cards.test.tsx`)
- [ ] Assert Start Todo completion actions do not mutate the Agent Run Plan, and Agent terminal events do not mark a UserTask done.
- [x] Tune the workbench row to 34–38px and keep composer/answer axis unchanged; no new thick Todo card in the workbench. (compact fold contract and visual QA evidence)
- [x] Capture running, waiting, failed, retried, and completed screenshots before the final whole-screen audit. (retained QA screenshots under `.tmp-visual-audit/global-ui-polish-2026-08-20` and `.tmp-visual-audit/global-ui-polish-2026-08-21`)

### Task 4B: Document editor production safety and continuity

**Additive P0/P1 fixes from the visual acceptance loop; this section does not replace Tasks 1–4A.**

**Contract:**

- A callout is a normal Markdown block, not a modal trap: insertion always leaves a paragraph after it, and the user can continue typing below it.
- A callout can be selected and removed with its visible action or Backspace/Delete; the editor never leaves the document without a caret target.
- Preview and rich editing use the same semantic icon vocabulary; product UI must not render emoji as control icons.
- The document shell must remain within the viewport at 1440px and narrow widths; title identity stays concise (`文档库`, `请输入标题`).

- [x] Add RED coverage for insertion-with-following-paragraph and callout deletion.
- [x] Implement shared callout insertion, normalization, node selection, keyboard deletion, and visible delete action for CaptureEditor and MarkdownEditor.
- [x] Replace preview callout emoji with Lucide semantic icons and keep labels accessible.
- [x] Remove the meaningless `我的文档` identity copy and keep untitled documents visually spacious with a title placeholder.
- [x] Verify focused editor/document suites (46 tests), App/settings save lifecycle (159 focused tests combined), renderer typecheck, real 1440px DOM bounds, zero document overflow, and retained screenshot evidence.
- [x] Run the full editor journey matrix (new line after callout, exit via click/arrow/Enter, delete from empty/non-empty callout, table selection and batch format, narrow-window resize) in the final Task 5 gate. (focused editor/table suites plus real 1440px DOM bounds; packaged-runtime follow-up remains a residual risk)

### Task 4C: Complete the real Start object journeys

**This is additive. It does not replace the existing visual tasks or merge User Todo with Agent Run Plan.**

**User Todo contract:**

- User Todo is a user-owned commitment. Creation, editing, completion, reopening,
  and deletion are explicit user actions and persist through the existing task
  store.
- An Agent Run Plan remains run-scoped process state. Terminal Agent events do
  not silently complete a User Todo.
- The empty Todo page must expose the real create path rather than a decorative
  empty illustration.

  - [x] Add focused RED coverage for inline Todo create, edit, complete/reopen,
      delete, failure feedback, and restart hydration.
  - [x] Implement the compact Todo list and form against the existing typed task
      store; do not introduce a second task database or a model call.
  - [ ] Close the remaining Task 4A semantic assertion: Todo changes never mutate
      Agent Run Plan state and Agent completion never marks a Todo done.

**Human-only folder contract:**

- Rename the ambiguous `位置` surface to user-facing `常用文件夹` (or the
  shortest equivalent that remains clear in the final layout).
- A pinned folder is a Human-only convenience reference. Adding it grants no
  Agent workspace access and does not add it to the notebook registry.
- The page supports add, open in Explorer, forget, missing-path feedback, and
  restart recovery. Forgetting never deletes the real folder.

  - [x] Add a separate typed IPC/storage path for Human-only pinned folders and
      prove it cannot resolve through the Agent workspace registry.
  - [x] Replace the dead generic note view with a real folder list, truthful empty
      state, add/open/forget actions, and failure states.

### Task 4D: Lossless Markdown document round-trip

**Data-safety contract:**

- Opening a valid document in rich mode without editing must not emit or save a
  rewritten Markdown string.
- After one real rich edit, untouched GFM bold/strikethrough, math delimiters,
  tables, links, callouts, and code blocks remain semantically intact.
- Rich preview, source mode, autosave, conflict recovery, restart hydration,
  and rendered preview all consume the same canonical Markdown source.

  - [x] Add the exact regression fixture that currently turns `**bold**` into
      `\\**bold\\**`, escapes math identifiers, and inserts blank lines between
      GFM table rows; confirm RED at the CaptureEditor/StartDocuments boundary.
  - [x] Prevent hydration-only Lexical updates from entering the autosave path and
      repair any transformer/export behavior required for a genuine edit.
  - [x] Verify open-without-edit, single-paragraph edit, autosave, source switch,
      remount, and restart against the same fixture; inspect the persisted note
      rather than relying only on rendered DOM.

### Task 4E: Explorer-to-composer attachment handoff

**Contract:**

- A visible file row is draggable; a folder row is not treated as a file
  attachment.
- Dropping a file from the current notebook Explorer onto the composer adds one
  validated workspace-file chip and does not send automatically.
- The internal drag payload contains only workspace id and relative file path;
  InputArea validates it against the current file tree, deduplicates it, and
  rejects stale or cross-workspace payloads with user-visible feedback.
- Existing operating-system file drop/import behavior remains unchanged.

  - [x] Add focused RED coverage for the FileTree drag payload and InputArea drop,
      deduplication, stale path, cross-workspace rejection, and send payload.
  - [x] Implement one shared internal MIME contract and keep folders/OS files on
      their existing paths.

### Task 4F: Start and Workbench page-completion matrix

- [x] Audit Start: Home, Inbox, Todo, Pinned, Recent, Common Folders, Document
      Library, Archive, and Trash. For every route record purpose, real source,
      create/open/edit/delete actions, empty/loading/error states, and restart
      behavior.
- [x] Audit Workbench: conversation, approval, AskUser, retry, Explorer,
      preview/editor, overview, search, artifacts, and attachment handoff.
- [x] Remove or hide any navigation entry that still has no honest product
      journey; the route audit found no dead entry requiring removal. Never
      leave a visible dead page as a placeholder.
- [x] Retain current 1440px and 960px screenshots for populated, empty, error,
      and narrow states under `.tmp-visual-audit` and review the whole parent
      layout after each local change.

### Task 5: Full Visual Regression and Release Gate

**Files:**
- Modify only the scoped files from Tasks 1–4 if the screenshot audit finds a concrete regression.
- Add: `docs/research/2026-08-20-global-ui-polish-qa.md`

**Interfaces:**
- Consumes: all existing stores, real Electron bridge, and the screenshot matrix in the approved design spec.
- Produces: reproducible evidence and a short residual-risk list; no claims based solely on component tests.

- [x] **Step 1: Run focused regression suites**

  Run the combined focused Vitest command covering Tasks 1–4, then `npx tsc -p tsconfig.renderer.json --noEmit` and `git diff --check` on only the scoped files.

- [x] **Step 2: Run real Electron journeys**

  Verify: enter Buddy without an API call; send one Buddy message; enter Workbench; trigger an approval; answer an AskUser card; inspect raw tool detail; open a provider setting; open Skills; open Start and a document; open a right-side panel. Record any failure with the exact screen and action.

- [x] **Step 3: Review screenshots as whole screens**

  For each screenshot check contrast, visual center, object density, baseline alignment, parent layout after hidden/removed content, focus/hover state, and whether secondary cards steal attention from momo’s answer. Do not accept “tests pass” as visual acceptance.

- [ ] **Step 4: Run the external second-eye review**

  Ask Kimi to read the retained PNGs and first enumerate visible facts, then report only material differences. Treat its report as evidence, not authority; reconcile it with the Leemo design spec and real interaction behavior.

- [x] **Step 5: Write the QA report and stop at residual risks**

  Write `docs/research/2026-08-20-global-ui-polish-qa.md` with screenshot paths, tested journeys, pass/fail results, and remaining P2 visual items. Do not delete screenshots or claim 90%+ until the whole-screen checks pass.
