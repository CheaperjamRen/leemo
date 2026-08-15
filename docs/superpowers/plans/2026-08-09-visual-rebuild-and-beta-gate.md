# Leemo Visual Rebuild and Beta Gate Implementation Plan

> **For agentic workers:** Execute this plan milestone by milestone. Keep one review/fix round per milestone, use focused tests while iterating, and do not expand deferred product ideas into the beta scope.

**Goal:** Implement the approved Leemo visual system across the real desktop product, preserve all working Agent capabilities, close the remaining beta-critical product gaps, and produce one installable beta candidate with verified core journeys.

**Architecture:** Keep the existing React renderer, Electron main/preload boundary, typed IPC, stores, SQLite data, and host runtime. This is a visual-system and visible-path rebuild, not a framework rewrite. Shared primitives and tokens drive both surfaces; the workbench uses a cool professional system, while the momo companion uses a warmer companion surface without forking the execution or data layer.

**Tech stack:** Electron, React, TypeScript, Zustand, CSS design tokens, Vitest, PDF.js, react-markdown/GFM, existing SQLite and typed IPC layers.

## Execution rules

- Core user journey first; no architecture rewrite for theoretical purity.
- Use the approved Image2 drafts as visual direction, not as bitmap UI assets.
- Resolve visual conflicts at component scope: the final design approved for a specific region (for example composer, sidebar, PDF workspace, or timeline card) is authoritative only for that region. Unrelated areas shown incidentally in that draft never override their own later, dedicated approvals.
- Preserve existing behavior unless the approved design explicitly changes it.
- One focused RED→GREEN cycle where behavior changes; no test explosion for CSS-only work.
- One independent visual review/fix pass per milestone, then move on.
- Keep task temp/cache under `E:\Temp` or another explicit E-drive directory. Do not fill C:.
- Do not implement native inline XLSX/DOCX/PPTX editors in this milestone. Unsupported Office files keep the honest system-app fallback.
- Do not expose Claude Code, internal protocol, provider wire format, raw private reasoning, or implementation names in user-facing UI.

## Approved visual source of truth

Use the specifications under `docs/superpowers/specs/2026-08-08-*-visual-v1.md` and the approved images under `docs/design-audition/visual-redesign/`.

Fixed product decisions:

- App mark is professional and abstract; momo remains a separate small, warm conversation character.
- User messages have no avatar. momo's avatar stays quiet and small, with restrained expression/motion states.
- Workbench is cool neutral and information-dense; companion mode is warmer and intentionally lighter.
- The workbench left rail has three states: auto-expanded, auto-compact, and user-pinned.
- Explorer is a right overlay drawer when the center is crowded, not a permanent width tax.
- PDF/document readability wins over keeping every surrounding panel visible.
- `/` remains a compact standalone button without the word “Skill”; `@` stays in the composer.
- Tool and subagent cards are folded by default but expand to real commands, outputs, errors, task prompts, and results.
- Completion/artifact receipts stay compact and never grow into a full-screen report.

---

## Track A — Frontend visual implementation

### Milestone 1: Shared visual foundation and identity

**Primary files**

- `src/renderer/design/tokens.css`
- `src/renderer/design/effects.css`
- `src/renderer/index.css`
- shared icon/logo/momo asset modules under `src/renderer/`
- focused component/style tests where behavior is affected

**Implement**

- Replace the current mixed scale with one typography, spacing, radius, shadow, border, icon, focus, and motion system.
- Define paired workbench and companion palettes from the same semantic tokens.
- Add the finalized Leemo mark and restrained momo states: idle, listening, thinking, waiting, success, error, sleeping.
- Add reduced-motion behavior and maintain readable focus/contrast states.
- Build color as a three-layer theme contract: primitive palette, semantic
  roles, and shell/theme scopes. Components consume semantic roles only, so a
  future user-selected theme can replace the palette without component edits.
- Ship the approved default workbench and companion scopes first; keep the
  theme registry/selection surface extensible without building a theme store.
- Remove inconsistent one-off font sizes, shadows, saturated colors, and component radii.

**Acceptance**

- App identity remains legible at 16/24/32 px and in light/dark-compatible contexts.
- Workbench and companion feel related but immediately distinguishable.
- No page-specific token forks for the same semantic control.
- A second test theme can override semantic roles at the root without changing
  component source or exposing raw palette names to components.

### Milestone 2: Application shell, navigation, and spatial arbitration

**Primary files**

- `src/renderer/components/WorkbenchShell.tsx`
- `src/renderer/components/BuddyShell.tsx`
- `src/renderer/components/WorkbenchSidebar.tsx`
- `src/renderer/components/FileTree.tsx`
- corresponding CSS and focused tests

**Implement**

- Rebuild the top bar and the companion/workbench switch using the approved hierarchy.
- Implement the three-state left navigation and its resize/compact behavior.
- Present notebooks above “与 momo 的对话”; give both bounded, independently scrollable regions.
- Keep only unread, running, and error state marks in conversation rows; remove verbose status text.
- Replace the left-bottom vertical menu with the approved compact icon row and extension capacity.
- Implement the far-right work toolbar: Explorer, overview, and search.
- Make Explorer a drawer/overlay when document or conversation width would become unreadable.
- Preserve the user’s pinned sidebar preference across restart.

**Acceptance**

- Users can see and switch the global notebook/conversation map without a top-dropdown-only mental model.
- At narrow widths, controls fold predictably; panels never overlap or compress the main document into illegibility.
- Existing chat, notebook, file, search, overview, and settings routes continue to work.

### Milestone 3: Composer, conversation surface, and runtime feedback

**Primary files**

- `src/renderer/components/InputArea.tsx`
- `src/renderer/components/Timeline.tsx`
- timeline card components and styles
- `src/renderer/components/BuddyShell.tsx`
- `src/renderer/components/WorkbenchShell.tsx`

**Implement**

- Rebuild both composers as floating, shadowed surfaces; remove the old full-width divider look.
- Keep the workbench composer professional; keep the companion composer warm without adding a second agent identity.
- Implement a single-column `+` menu for files/folders and companion features; retain `/`, `@`, model, permission, microphone, and send controls.
- Keep running-message queue/steer cards one line high, showing only enough text to identify the message.
- Match the approved ordering between queued messages, steering, onboarding/“先聊聊”, scene suggestions, and the composer.
- Rebuild timeline presentation for:
  - real tool/command trace and raw output/error on expansion;
  - compact processing state;
  - AskUser options with title, concrete explanation, and tradeoff;
  - neutral/amber/red approval severity by real consequence;
  - subagent cards with distinct non-repeating avatars, initial prompt, task, status, output, and tool trace;
  - compact failure, completion, artifact, and copyable plain-text blocks.
- Do not expose raw private chain-of-thought; expose useful task/process evidence.

**Acceptance**

- The default timeline is calm and scannable; interested users can inspect exact operations.
- User messages have no avatar; momo remains a small visual anchor rather than a dominant illustration.
- Long answers may scroll normally, but a receipt/card itself never becomes a full-screen container.

### Milestone 4: Workboard, Skills, scheduled tasks, and settings

**Primary files**

- `src/renderer/pages/OrganizerPage.tsx`
- `src/renderer/pages/OrganizerPage.css`
- `src/renderer/capture/CaptureEditor.tsx`
- `src/renderer/capture/CaptureEditor.css`
- `src/renderer/quick-capture/QuickCaptureApp.tsx`
- `src/renderer/quick-capture/QuickCaptureApp.css`
- `src/renderer/pages/SkillsPage.tsx`
- `src/renderer/pages/ScheduledTasksPage.tsx`
- `src/renderer/pages/SettingsPage.tsx`
- focused page tests

**Implement**

- Workboard:
  - approved Today, notes, tasks, and lightweight trash views;
  - quick capture with rich-text toolbar at the top;
  - compact attachments, real file paths, open file, and reveal in Explorer actions;
  - task quick-entry with editable parsed tags and full-detail entry available at first creation;
  - keep notes and tasks distinct while allowing explicit note-to-task conversion.
- Skills:
  - three-column desktop grid with compressed card height;
  - curated Chinese display names, short purpose, source/provenance, install/enable state;
  - suite grouping such as Superpowers without fourteen noisy duplicate headers;
  - full detail view for installation, setup requirements, source link, and local folder.
- Scheduled tasks:
  - list-first surface, not a calendar;
  - create/edit in a calm single column;
  - daily, selected weekdays, monthly, workdays, weekends, and custom repetition.
- Settings:
  - single-column information hierarchy;
  - a compact theme selector backed by the shared semantic theme contract;
    beta may ship only the approved default plus any fully reviewed built-in
    variants, while custom/community theme distribution remains deferred;
  - inline expandable search sources, computer control, memory scope, and related controls instead of unnecessary second-level pages;
  - provider/subscription cards, model usage and estimated cost, personality, storage, default workspace, shortcuts, background running, autostart, and minimal About page;
  - heart journal remains hidden from the beta UI.

**Acceptance**

- Each page uses real current data and actions; no decorative mock feature appears as available.
- Common settings are findable in place and remain extensible.
- Quick capture and board data survive restart; attachment/storage locations remain visible and configurable.

### Milestone 5: File workspace, Markdown, Explorer, and PDF

**Primary files**

- `src/renderer/components/PreviewPane.tsx`
- `src/renderer/components/PdfView.tsx`
- `src/renderer/components/MarkdownContent.tsx`
- `src/renderer/components/MarkdownEditor.tsx`
- `src/renderer/components/SelectionMenu.tsx`
- `src/renderer/components/FileTree.tsx`
- focused tests

**Implement**

- Keep the approved editor/preview layout, with Explorer on the right.
- Put the Markdown rich-text toolbar at the top; preserve source when editing and saving.
- Keep text selection actions such as “问 momo” and “改写润色”.
- Add consistent link interaction and separate external URL behavior from local file behavior.
- Improve existing PDF.js reader rather than replacing it:
  - readable focus layout;
  - page navigation and search;
  - demand rendering/virtualization for long files;
  - useful load/error states;
  - an official PDF.js TextLayer that shares the exact page viewport, scale,
    and rotation with the canvas so selection does not drift after zoom,
    resize, or rotation;
  - stable text selection and copy order on real text PDFs, with honest
    degradation for scanned/image-only files.
- Keep unsupported Word/Excel/PowerPoint as honest open-with-system-app/reveal-in-Explorer flows.

**Acceptance**

- Markdown edit/save/reopen works without source corruption.
- A long PDF remains readable and does not force all four panels on screen.
- A real multi-page text PDF supports navigation, search, zoom/fit, selection,
  and copy without visible TextLayer drift; long documents keep rendered page
  work bounded instead of mounting every page at once.
- No inline XLSX/DOCX/PPTX editing is implied before it exists.

### Milestone 6: Visual acceptance and installable build

**Verify**

- Representative views at 1600×1000, 1280×820, 960×680, and the enforced minimum window size.
- Companion/workbench switching, sidebar pinning, Explorer overlay, PDF focus, quick capture, settings folds, queue cards, approvals, subagents, and restart restoration.
- No horizontal overflow, clipped controls, illegible text, stretched icons, or empty oversized cards.
- Cold start, long conversation input, memory use, and packaged renderer behavior.

**Budget**

- One visual audit, one targeted fix pass, then proceed to beta gates.

---

## Track B — Beta-critical functional gates

These are not all visual work. They are the remaining “a user will immediately notice” gaps to close after the visual milestones.

### P0 — Must be complete before external beta

1. **Search capability parity**
   - Keep arXiv independent.
   - Reach the approved 12-source catalog: AnySearch, Doubao, Metaso, Tavily, Bocha, Google CSE, Exa, Brave Search, SerpAPI, Serper, Bing Search, Firecrawl.
   - Put all sources in the same network-search capability class; enabling web search must authorize tagged search tools consistently.
   - Verify configure, call, failure, disable, and restart behavior.

2. **Running-message queue and steering**
   - Preserve native real-time steering for Claude/Codex and honest next-turn fallback where the runtime cannot steer.
   - Complete Enter-to-queue for text, images, files, Skills, and note references.
   - Add edit, delete, convert-to-steer, automatic dequeue, and failure retention.

3. **Truthful task plan/progress**
   - Task progress must come from executor-owned structured state and accept model updates.
   - If accuracy cannot be guaranteed, degrade to a plain “处理中” state plus real tool trace instead of showing a false checklist.

4. **Global Markdown compatibility**
   - Unify chat, process summaries, Markdown preview/editor, and notes.
   - Add math, footnotes, callouts, Mermaid, syntax highlighting, tables, task lists, and safe fallback for invalid syntax.

5. **Permission semantics and approval severity**
   - Cache/temp/staging cleanup proceeds without approval.
   - Reversible ordinary changes use neutral/amber language.
   - Red blocking is reserved for genuinely irreversible broad deletion, privileged system change, credential exposure, or high-consequence external action.
   - Recheck permission modes across shell, MCP, browser, computer use, and newly registered tools.

6. **Overview main-thread summary**
   - Summarize theme, goal, current position, key progress, blockers, and next focus rather than listing every event.
   - Let users tell momo in natural language what the overview should emphasize.

7. **Background runtime and notifications**
   - Verify close-to-tray, background tasks, autostart setting, completion/waiting/error system notifications, click routing, and restart recovery in the packaged app.
   - Approval prompts auto-reject after two minutes where the approved flow requires it.

8. **Release-critical failure and restart paths**
   - Recheck notes/tasks/reminders/attachments/trash, scheduled tasks, Skill install/enable/update, provider configuration, default workspace, memory, file edits, browser/computer use, and subagent visibility after restart.
   - Do one packaged smoke pass, not an enterprise test matrix.

9. **Production-grade local PDF reading**
   - Keep PDF rendering local and reuse the shipped PDF.js runtime rather than
     bundling a second browser engine solely for PDF.
   - Verify open/reopen, page navigation, zoom/fit, search, selection and copy
     on real text PDFs; Canvas and TextLayer must remain aligned after resize,
     zoom, and rotation.
   - Render long files on demand with bounded live page work, readable focus
     mode, honest password/load/image-only failures, and no XLSX-style claims.

### P1 — Finish if missing after the P0 audit

1. AskUser model guidance: options must include a concise answer and a concrete explanation/tradeoff, plus free input.
2. Global external-link opening: auto-detect `http/https`; Ctrl+click in edit surfaces; open with the default browser; local paths remain separate.
3. Model ability probe semantics: cheap automatic vision/reasoning probes, uncertainty never hard-blocks image upload, and users can override a false negative.
4. Provider/subscription acceptance: real-account smoke tests where credentials are available; usage and cache/token cost are clearly labelled as measured or estimated.
5. Skill Hub acceptance: install/failure/retry/restart/update flows, readable Chinese curated names, and no dependency on Leemo operating a cloud marketplace.
6. Compact conversation state: unread/running/error only, including user-controlled “标记未读”.
7. Default workspace setting: persisted, visible, and never silently redirects large data into C:.

---

## Explicitly deferred until after beta

- English-learning deep experience and learning dashboard.
- Paper/PDF visual teaching and research-specific deep flows beyond the solid generic PDF path.
- University/career planning, assessments, tarot/astrology, and expanded companion mini experiences.
- AI-native infinite canvas and richer draggable dashboard widgets.
- True multi-agent orchestration/agent cluster; beta only needs honest subagent visibility.
- Native inline XLSX/DOCX/PPTX editors.
- Heart journal.
- Forgetting-curve memory, background LLM memory curation, and MindMemOS integration.
- Leemo-operated cloud Skill Hub, cloud feedback service, paid gateway/subscription platform, and large cloud operations.
- Worktree/coding-specialized polish unless it blocks the generic user journey.
- Auto-update, paid signing, enterprise telemetry, and broad test matrices.

## Final beta exit criteria

- A new user can install Leemo, configure one usable model, talk to momo, open a notebook/folder, search the web, operate local files, create/edit a useful artifact, use notes/tasks/reminders, leave a task running in the background, and return after restart without losing context.
- The UI looks and behaves consistently at supported window sizes and does not expose borrowed implementation mental models.
- Success, failure, permission, and restart recovery are understandable without reading logs.
- A packaged beta build passes the focused core-journey smoke checklist; known non-blocking edge bugs are documented rather than delaying the release indefinitely.
