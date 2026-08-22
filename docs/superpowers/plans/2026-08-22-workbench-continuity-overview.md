# Workbench Continuity Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the workbench overview's title/artifact recap with a truthful, restart-safe continuity snapshot that lets a user recover the objective, current phase, current Agent Run Plan, verified completed work, known remaining work, blockers, and source artifacts without opening the panel calling a model.

**Architecture:** Keep one append-only conversation timeline and the existing `set_work_overview` MCP. Semantic checkpoints become bounded versioned patches; the renderer folds them into per-conversation snapshots and derives live facts from existing Plan/Task/Tool/approval/question/retry/run/file/artifact state. A dedicated pure projection module builds either one conversation snapshot or a notebook aggregate. The React panel only renders that projection. The current model may write a patch at meaningful checkpoints; there is no background summarizer or second task database.

**Tech Stack:** Electron, React, TypeScript, Zustand, Anthropic Agent SDK MCP, Zod, Vitest, existing typed IPC/persistence, existing Electron/CDP visual acceptance workflow.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-22-workbench-continuity-overview-design.md` as the product authority.
- Preserve the distinction between user-owned tasks, run-scoped Agent plans, and long-running Goal Mode. The overview never completes a user task and never creates or extends a Goal.
- Opening, closing, resizing, or switching the overview panel performs zero model/API calls.
- A manual refresh is an explicit user action and an ordinary visible model turn. It is disabled while a run is active; it must not masquerade as free local refresh.
- Do not add a background summarizer, scheduler, second task database, new user-visible “work thread” object, project-health percentage, or invented overall completion percentage.
- Only real Tool/Task/Run/Artifact/user-confirmation identifiers can support a displayed completed fact. Assistant prose alone is not completion evidence.
- Keep old five-field overview records readable after restart. Legacy `theme` is labelled as a previous topic until a real v2 objective exists; it is not silently promoted to a verified objective.
- Keep the current dirty worktree. Before touching a scoped file, record its current diff. Never reset, checkout, clean, stage, or commit unrelated modifications.
- `src/renderer/components/WorkbenchActivityRail.tsx` is already dirty. Preserve its current Explorer/search/layout work and make only the overview integration edits described here.
- Components consume existing semantic `--leemo-*` tokens. This feature introduces no page-private palette and does not modify Buddy visual rules.
- Retain the newest screenshots under `E:\Leemo\.tmp-visual-audit\workbench-continuity-overview`; never delete the latest accepted evidence.
- The two Quick Capture items remain queued after this plan: caret/placeholder alignment first, body-area/chrome ratio second. They are not implementation scope here.

---

## Task 0: Preserve the Dirty Baseline and Pin the Focused Gate

**Files:**
- Read: all files listed by the tasks below
- Create outside Git: `E:\Leemo-backups\workbench-continuity-overview-<timestamp>\`
- Do not modify production code in this task

**Interfaces:**
- Input: current dirty worktree at commit `b4c0718`
- Output: a status manifest and scoped text patches that can restore pre-task local changes

- [ ] **Step 1: Capture the current repository and scoped-file state**

  Run:

  ```powershell
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup = "E:\Leemo-backups\workbench-continuity-overview-$stamp"
  New-Item -ItemType Directory -Force -Path $backup | Out-Null
  git rev-parse HEAD | Set-Content -LiteralPath "$backup\HEAD.txt" -Encoding utf8
  git status --short | Set-Content -LiteralPath "$backup\status.txt" -Encoding utf8
  git diff --binary -- `
    src/bridge/work-overview.ts `
    src/bridge/work-overview-mcp.ts `
    src/host/momo-prompt.ts `
    src/renderer/stores/message-model.ts `
    src/renderer/stores/conversations.ts `
    src/renderer/components/WorkbenchOverview.tsx `
    src/renderer/components/WorkbenchActivityRail.tsx `
    tests/bridge/work-overview-mcp.test.ts `
    tests/host/momo-prompt.test.ts `
    src/renderer/stores/message-model.test.ts `
    src/renderer/stores/conversations.test.ts `
    src/renderer/components/WorkbenchOverview.test.tsx `
    src/renderer/components/WorkbenchActivityRail.test.tsx `
    | Set-Content -LiteralPath "$backup\scoped-before.patch" -Encoding utf8
  Set-Content -LiteralPath 'E:\Leemo-backups\workbench-continuity-overview-latest.txt' -Value $backup -Encoding utf8
  Write-Output $backup
  ```

  Expected: the command prints one backup directory; `status.txt` and `scoped-before.patch` exist; no tracked file changes.

- [ ] **Step 2: Run the current focused baseline**

  Run:

  ```powershell
  npx vitest run `
    tests/bridge/work-overview-mcp.test.ts `
    tests/host/momo-prompt.test.ts `
    src/renderer/stores/message-model.test.ts `
    src/renderer/stores/conversations.test.ts `
    src/renderer/components/WorkbenchOverview.test.tsx `
    src/renderer/components/WorkbenchActivityRail.test.tsx
  ```

  Expected: record the exact pass/fail baseline in `$backup\focused-baseline.txt`. Do not fix an unrelated pre-existing failure in this task.

---

## Task 1: Define the Versioned Semantic Checkpoint Contract

**Files:**
- Modify: `src/bridge/work-overview.ts`
- Create: `tests/bridge/work-overview.test.ts`

**Interfaces:**
- Produces: `WorkOverviewPatch`, `WorkOverviewSnapshot`, `WorkOverviewEvidence`, `WorkOverviewUpdateReason`
- Produces: `normalizeWorkOverviewPatch`, `applyWorkOverviewPatch`, `applyUserWorkOverviewCorrection`, `migrateLegacyWorkOverview`
- Preserves: `LEEMO_WORK_OVERVIEW_TOOL`

- [ ] **Step 1: Write failing contract tests**

  Add tests that pin the approved semantics:

  ```ts
  it("merges scalar and overwrite-list fields while appending evidence by id", () => {
    const next = applyWorkOverviewPatch(previous, patch, {
      scopeConversationId: "conv-1",
      sourceRunId: "run-2",
      toolUseId: "overview-2",
      updatedAt: 200,
      actor: "momo",
    });
    expect(next.revision).toBe(2);
    expect(next.objective).toBe(previous.objective);
    expect(next.nextKnown).toEqual(["打包并重启验收"]);
    expect(next.completedHighlights.map((item) => item.evidenceId)).toEqual(["tool-a", "artifact-b"]);
  });

  it("uses empty arrays and clearFields as the only clear operations", () => {
    const next = applyWorkOverviewPatch(previous, {
      updateReason: "recovered",
      basisEventIds: ["tool-result-2"],
      blockers: [],
      clearFields: ["currentFocus"],
    }, metadata);
    expect(next.blockers).toEqual([]);
    expect(next.currentFocus).toBeUndefined();
    expect(next.objective).toBe(previous.objective);
  });
  ```

  Also assert:

  - scalar limits: objective 160, phase/focus 120;
  - every list is at most five entries and every entry text is at most 120 characters;
  - one patch contains at most 800 user-visible characters;
  - every decision/completed highlight has a non-empty `evidenceId` and at least one `basisEventId`;
  - empty strings, unknown update reasons, wrong types, duplicate clear fields, and a patch with no semantic change fail normalization;
  - legacy five-field data migrates without pretending its title is a verified objective.

- [ ] **Step 2: Run the contract test and confirm RED**

  Run: `npx vitest run tests/bridge/work-overview.test.ts`

  Expected: compile/test failures for the new exports and behavior.

- [ ] **Step 3: Implement the bounded types and normalizer**

  Use one source of truth similar to:

  ```ts
  export const WORK_OVERVIEW_UPDATE_REASONS = [
    "objective-set",
    "objective-changed",
    "phase-changed",
    "blocked",
    "recovered",
    "run-completed",
    "manual-refresh",
  ] as const;

  export interface WorkOverviewEvidence {
    evidenceId: string;
    text: string;
    basisEventIds: string[];
  }

  export interface WorkOverviewPatch {
    objective?: string;
    successCriteria?: string[];
    currentPhase?: string;
    currentFocus?: string;
    nextKnown?: string[];
    blockers?: string[];
    decisions?: WorkOverviewEvidence[];
    completedHighlights?: WorkOverviewEvidence[];
    clearFields?: Array<"objective" | "currentPhase" | "currentFocus">;
    updateReason: WorkOverviewUpdateReason;
    basisEventIds?: string[];
  }

  export interface WorkOverviewUserCorrection {
    objective?: string;
    successCriteria?: string[];
    clearFields?: Array<"objective" | "successCriteria">;
  }

  export interface WorkOverviewSnapshot {
    revision: number;
    scopeConversationId: string;
    sourceRunId: string;
    sourceToolUseId: string;
    updatedAt: number;
    updateReason: WorkOverviewUpdateReason | "user-correction" | "legacy-migration";
    basisEventIds: string[];
    actor: "momo" | "user" | "legacy";
    objective?: string;
    objectiveSource?: "semantic" | "legacy-title";
    successCriteria: string[];
    currentPhase?: string;
    currentFocus?: string;
    nextKnown: string[];
    blockers: string[];
    decisions: WorkOverviewEvidence[];
    completedHighlights: WorkOverviewEvidence[];
    fieldAuthority: {
      objective?: "momo" | "user" | "legacy";
      successCriteria?: "momo" | "user";
    };
  }
  ```

  Normalize first, then merge. Do not let the model submit `revision`, `scopeConversationId`, `sourceRunId`, `sourceToolUseId`, `updatedAt`, `actor`, or `fieldAuthority`; those come from renderer metadata. Patch-level `basisEventIds` are optional because the model does not know renderer ids reliably; the stored snapshot always unions the real source run/tool ids supplied by the renderer. Evidence-bearing decision/completion entries still require their own real basis ids. Keep user correction as a separate local input type so a user edit cannot be mistaken for a model-authored patch or forced to invent a run/tool id.

- [ ] **Step 4: Implement deterministic patch application and legacy migration**

  Required behavior:

  ```ts
  const next: WorkOverviewSnapshot = {
    ...previous,
    ...scalarPatch,
    revision: (previous?.revision ?? 0) + 1,
    scopeConversationId: metadata.scopeConversationId,
    sourceRunId: metadata.sourceRunId,
    sourceToolUseId: metadata.toolUseId,
    updatedAt: metadata.updatedAt,
    updateReason: patch.updateReason,
    actor: metadata.actor,
    basisEventIds: [...new Set([metadata.sourceRunId, metadata.toolUseId, ...(patch.basisEventIds ?? [])])],
    successCriteria: patch.successCriteria ?? previous?.successCriteria ?? [],
    nextKnown: patch.nextKnown ?? previous?.nextKnown ?? [],
    blockers: patch.blockers ?? previous?.blockers ?? [],
    decisions: appendEvidence(previous?.decisions, patch.decisions),
    completedHighlights: appendEvidence(previous?.completedHighlights, patch.completedHighlights),
  };
  ```

  `migrateLegacyWorkOverview` maps `theme` to `objective` with `objectiveSource: "legacy-title"`; maps old position/summary/next/focus conservatively; never fabricates evidence or a v2 update reason.

  `applyUserWorkOverviewCorrection` accepts only `objective`, `successCriteria`, and explicit clears plus a generated local correction id, conversation id, and timestamp. It increments the revision, writes `actor: "user"`, `updateReason: "user-correction"`, and marks the edited fields as user-owned without inventing `sourceRunId` or `sourceToolUseId`.

  When `fieldAuthority.objective` or `fieldAuthority.successCriteria` is `user`, a model patch cannot overwrite that stable field. A later local user correction may replace or clear it and creates a new revision. This is deliberately stricter than guessing whether model prose represented an explicit user change.

- [ ] **Step 5: Run focused tests and commit only this slice**

  Run:

  ```powershell
  npx vitest run tests/bridge/work-overview.test.ts
  npx tsc -p tsconfig.json --noEmit
  git diff --check -- src/bridge/work-overview.ts tests/bridge/work-overview.test.ts
  ```

  Commit only these two files with: `feat: version work overview checkpoints`

---

## Task 2: Upgrade the Existing MCP Without Adding a Second Service

**Files:**
- Modify: `src/bridge/work-overview-mcp.ts`
- Modify: `tests/bridge/work-overview-mcp.test.ts`

**Interfaces:**
- Consumes: `normalizeWorkOverviewPatch`
- Produces: the same stable `mcp__leemo-work-overview__set_work_overview` name
- Returns: normalized `WorkOverviewPatch` in the test seam; the SDK still returns a compact text receipt

- [ ] **Step 1: Replace the five-field MCP tests with v2 checkpoint cases**

  Test a successful terminal patch containing objective, phase, known next work, a blocker, a verified completed highlight, reason, and evidence ids. Add failures for missing reason, unverified completion, and over-budget text. Also prove patch-level basis ids may be omitted because the renderer supplies the stored source ids. Keep the stable tool-name assertion.

- [ ] **Step 2: Run the MCP test and confirm RED**

  Run: `npx vitest run tests/bridge/work-overview-mcp.test.ts`

  Expected: old schema rejects new fields or returns the old five-field object.

- [ ] **Step 3: Replace the Zod schema and tool description**

  The description must encode both triggers and skip rules:

  ```ts
  "Write one bounded continuity checkpoint for the current conversation only when the objective, phase, blocker/recovery state, or meaningful terminal result changed. Usually call once at run end. Never call for ordinary chat, repeated reads/searches, individual tool steps, display changes, or no-net-change retries. Never complete a user Todo or invent overall progress. Completed highlights require real event IDs. Failure to update this metadata must not stop the user's task."
  ```

  Build Zod from the same limits as the normalizer; do not duplicate different numeric limits. Return `text: "工作概览已更新。"` on success and a compact tool error on invalid input.

- [ ] **Step 4: Verify and commit the MCP slice**

  Run:

  ```powershell
  npx vitest run tests/bridge/work-overview.test.ts tests/bridge/work-overview-mcp.test.ts
  npx tsc -p tsconfig.json --noEmit
  git diff --check -- src/bridge/work-overview-mcp.ts tests/bridge/work-overview-mcp.test.ts
  ```

  Commit only the two MCP files with: `feat: bound overview checkpoint tool`

---

## Task 3: Persist Revisions in the Existing Conversation Timeline

**Files:**
- Modify: `src/renderer/stores/message-model.ts`
- Modify: `src/renderer/stores/message-model.test.ts`
- Modify: `src/renderer/stores/conversations.ts`
- Modify: `src/renderer/stores/conversations.test.ts`

**Interfaces:**
- `TimelineItem.kind === "overview"` stores a v2 `WorkOverviewSnapshot`; old hydrated values remain accepted through migration
- `applyEvent` receives the real conversation id from `foldConversationEnvelope`
- Previous overview entries remain in timeline; the newest entry is the current revision

- [ ] **Step 1: Write failing fold tests for revision metadata**

  Extend `message-model.test.ts` to assert:

  ```ts
  expect(items.at(-1)).toMatchObject({
    kind: "overview",
    overview: {
      revision: 2,
      scopeConversationId: "conv-a",
      sourceRunId: "run-2",
      sourceToolUseId: "overview-2",
      updatedAt: 200,
      updateReason: "phase-changed",
    },
  });
  expect(items.filter((item) => item.kind === "overview")).toHaveLength(2);
  ```

  Cover explicit clearing, evidence dedupe, malformed tool result remaining an ordinary tool row, and one conversation never merging another conversation's partial patch.

- [ ] **Step 2: Write the real-envelope conversation-id test**

  In `conversations.test.ts`, fold a successful overview tool start/finish envelope for `conv-a` and assert the persisted timeline snapshot records `scopeConversationId: "conv-a"` and the envelope receipt time. This is the production path; direct `applyEvent` tests may pass an explicit id.

- [ ] **Step 3: Run the two store tests and confirm RED**

  Run: `npx vitest run src/renderer/stores/message-model.test.ts src/renderer/stores/conversations.test.ts`

- [ ] **Step 4: Implement the timeline fold**

  Change the function seam without breaking existing callers:

  ```ts
  export function applyEvent(
    items: TimelineItem[],
    event: LeemoEvent,
    runId: string,
    occurredAt?: number,
    conversationId?: string,
  ): TimelineItem[]
  ```

  `foldConversationEnvelope` passes its real `conversationId`. On successful overview-tool completion:

  1. normalize the pending input as a v2 patch;
  2. migrate the newest previous overview if it is legacy;
  3. call `applyWorkOverviewPatch` with run/tool/time/conversation metadata;
  4. replace only the pending tool row with the new semantic revision;
  5. retain earlier overview rows as history.

  A failed or invalid overview update remains an ordinary folded tool result and never changes the latest snapshot.

- [ ] **Step 5: Verify persistence compatibility and commit**

  Run:

  ```powershell
  npx vitest run src/renderer/stores/message-model.test.ts src/renderer/stores/conversations.test.ts
  npx tsc -p tsconfig.renderer.json --noEmit
  git diff --check -- src/renderer/stores/message-model.ts src/renderer/stores/message-model.test.ts src/renderer/stores/conversations.ts src/renderer/stores/conversations.test.ts
  ```

  Commit only these four files with: `feat: persist overview revision history`

---

## Task 4: Build a Pure Truthful Continuity Projection

**Files:**
- Create: `src/renderer/components/workbench-overview-model.ts`
- Create: `src/renderer/components/workbench-overview-model.test.ts`
- Modify later in Task 7: `src/renderer/components/WorkbenchOverview.tsx`

**Interfaces:**
- Consumes: conversation ids/titles, per-conversation timelines, active run ids, pending approval/question summaries, artifacts
- Produces: `ConversationContinuitySnapshot` and `NotebookContinuitySnapshot`
- Performs: no I/O, no store mutation, no model call

- [ ] **Step 1: Write failing projection tests for the seven recovery questions**

  Define fixtures with at least five user instructions, two runs, a plan revision, one waiting question, one failure/recovery, and three artifacts. Assert the conversation projection exposes:

  - objective and objective provenance;
  - current phase/focus;
  - current finite plan with `done/total` known-step counts;
  - known next work;
  - blockers/waiting;
  - verified completed facts;
  - clickable artifacts and source conversation ids.

  Add negative assertions:

  ```ts
  expect("overallPercent" in snapshot).toBe(false);
  expect(snapshot.completed).not.toContainEqual(
    expect.objectContaining({ text: expect.stringContaining("assistant only") }),
  );
  expect("userTaskMutations" in snapshot).toBe(false);
  ```

- [ ] **Step 2: Write notebook aggregation tests**

  Create six conversations with mixed waiting/running/blocked/recent states. Assert:

  - at most five active conversation rows;
  - waiting/blocked first, then running, then latest meaningful update;
  - every row retains its own `conversationId` and source title;
  - no field from one conversation is merged into another;
  - an old terminal plan is not labelled current, but its verified completed steps may remain in history.

- [ ] **Step 3: Run the new model test and confirm RED**

  Run: `npx vitest run src/renderer/components/workbench-overview-model.test.ts`

- [ ] **Step 4: Implement evidence collection and conversation projection**

  Use explicit view types, for example:

  ```ts
  export interface KnownPlanView {
    runId: string;
    steps: Array<{ text: string; status: "done" | "active" | "todo" }>;
    done: number;
    total: number;
    current: boolean;
  }

  export interface ConversationContinuitySnapshot {
    conversationId: string;
    title: string;
    objective?: { text: string; source: "semantic" | "legacy-title" };
    successCriteria: string[];
    currentPhase?: string;
    currentFocus?: string;
    currentPlan?: KnownPlanView;
    nextKnown: Array<{ text: string; certainty: "known" | "possible" }>;
    blockers: Array<{ text: string; kind: "semantic" | "waiting" | "failure" }>;
    completed: WorkOverviewEvidence[];
    artifacts: ArtifactEntry[];
    updatedAt?: number;
  }
  ```

  Evidence ids are collected from real `toolUseId`, `taskId`, run ids/result ids, file-change ids, artifact ids, and user-confirmed pending resolution. Filter semantic completed highlights whose basis ids do not exist in that conversation's real evidence set.

- [ ] **Step 5: Implement notebook aggregation**

  The notebook projection is a list of per-conversation snapshots, not one blended paragraph. Sort using explicit state priority and `updatedAt`. Keep recent verified completions and artifacts linked to their source conversation.

- [ ] **Step 6: Verify and commit the pure model**

  Run:

  ```powershell
  npx vitest run src/renderer/components/workbench-overview-model.test.ts
  npx tsc -p tsconfig.renderer.json --noEmit
  git diff --check -- src/renderer/components/workbench-overview-model.ts src/renderer/components/workbench-overview-model.test.ts
  ```

  Commit only the new model files with: `feat: derive truthful continuity snapshots`

---

## Task 5: Teach the Current Run When to Write a Checkpoint

**Files:**
- Modify: `src/host/momo-prompt.ts`
- Modify: `tests/host/momo-prompt.test.ts`

**Interfaces:**
- Produces: one concise semantic-checkpoint policy in the system prompt
- Preserves: all provider runtimes receiving the same existing `buildMomoSystemPrompt` result
- Does not produce: a timer, background request, or automatic panel-open call

- [ ] **Step 1: Add failing policy assertions**

  Assert the prompt contains all meaningful triggers, all important skip rules, real-evidence requirements, the user-task boundary, and the normal call ceiling. Also assert the rule appears for both Buddy and Workbench because conversation continuity belongs to the shared runtime, while the visible panel remains Workbench-only.

- [ ] **Step 2: Pin a bounded token increase**

  Add a test using the existing `o200k_base` encoder. The new authored prompt should remain at or below 1,050 tokens in the pinned configuration. Do not silently remove existing safety, memory, browser, document, or capability rules to hit the cap.

- [ ] **Step 3: Run the prompt test and confirm RED**

  Run: `npx vitest run tests/host/momo-prompt.test.ts`

- [ ] **Step 4: Add one compact policy block**

  Keep it close to task behavior, not user-visible persona text:

  ```text
  ### Maintain a bounded work overview
  Use the Leemo work-overview tool only when the objective/constraint changes, the work enters a genuinely new phase, a blocker appears or clears, or a run ends with meaningful progress/decision/artifact. Usually call once at run end; before terminal state, only one extra call is allowed for a real goal change, blocker, recovery, or phase boundary. Skip ordinary chat, explanation-only answers, repeated reads/searches, individual tool steps, view changes, and retries with no net change. Never mark a user Todo complete or invent an overall percentage. Completed highlights must cite real run/tool/artifact ids. If the metadata call fails, continue the user's task.
  ```

- [ ] **Step 5: Verify and commit the prompt slice**

  Run:

  ```powershell
  npx vitest run tests/host/momo-prompt.test.ts tests/bridge/work-overview-mcp.test.ts
  npx tsc -p tsconfig.json --noEmit
  git diff --check -- src/host/momo-prompt.ts tests/host/momo-prompt.test.ts
  ```

  Commit only these files with: `feat: checkpoint meaningful work transitions`

---

## Task 6: Add Honest Manual Refresh and Local User Correction

**Files:**
- Modify: `src/bridge/work-overview.ts`
- Modify: `src/renderer/stores/conversations.ts`
- Modify: `src/renderer/stores/conversations.test.ts`

**Interfaces:**
- Adds: `refreshWorkOverview(conversationId)` to the conversations store
- Adds: `correctWorkOverview(conversationId, correction)` to the conversations store
- Reuses: the existing `send` path and current conversation model/provider
- User-visible label: `更新工作概览`

- [ ] **Step 1: Write failing store tests**

  Assert that explicit refresh:

  - fails clearly when no conversation exists;
  - is disabled/rejected while a run is active;
  - invokes one normal `bridge:send` when idle;
  - sends a bounded internal instruction with `updateReason: manual-refresh` and `allowSubagents: false`;
  - shows only the honest user-facing display text `更新工作概览`, not the internal instruction;
  - preserves provider/model, retry, permission, and persistence behavior of `send`.

  Add a second local-action case: correcting objective/success criteria appends a `user-correction` overview revision, performs no bridge/model call, sets `fieldAuthority` to `user`, and survives the existing persistence/hydration path. A later ordinary model patch may update phase/focus but cannot overwrite those user-owned stable fields.

- [ ] **Step 2: Run the store test and confirm RED**

  Run: `npx vitest run src/renderer/stores/conversations.test.ts`

- [ ] **Step 3: Implement the action through the existing send path**

  Export a bounded prompt constant from `work-overview.ts` and add:

  ```ts
  refreshWorkOverview: async (conversationId) => {
    const state = get();
    if (!state.byId[conversationId]) throw unknownConversation(conversationId);
    if (state.runIds[conversationId]) throw new Error("任务进行中，完成后会自动更新概览。");
    return get().send(conversationId, WORK_OVERVIEW_MANUAL_REFRESH_PROMPT, [], [], {
      displayText: "更新工作概览",
      allowSubagents: false,
    });
  },
  ```

  The prompt instructs the model to inspect verified current-conversation evidence, call only the overview tool with `manual-refresh`, and finish with one concise receipt. Do not add a hidden IPC or suppress usage accounting.

- [ ] **Step 4: Implement local user correction without a model call**

  Add a narrow correction type for `objective`, `successCriteria`, and explicit clears. Append a new semantic timeline item using `applyUserWorkOverviewCorrection` with a generated local correction id and the current conversation id/time. Do not route this action through `bridge:send`, memory, a user task, or Goal Mode, and do not fabricate run/tool provenance for a local edit.

- [ ] **Step 5: Verify and commit the refresh/correction actions**

  Run:

  ```powershell
  npx vitest run src/renderer/stores/conversations.test.ts tests/bridge/work-overview.test.ts
  npx tsc -p tsconfig.renderer.json --noEmit
  git diff --check -- src/bridge/work-overview.ts src/renderer/stores/conversations.ts src/renderer/stores/conversations.test.ts
  ```

  Commit only these scoped changes with: `feat: add overview refresh and correction`

---

## Task 7: Rebuild the Panel Around Recovery, Not Counts

**Files:**
- Modify: `src/renderer/components/WorkbenchOverview.tsx`
- Modify: `src/renderer/components/WorkbenchOverview.test.tsx`
- Import: `src/renderer/components/workbench-overview-model.ts`

**Interfaces:**
- Props consume conversation/notebook continuity snapshots
- Adds callbacks: open source conversation, open artifact, request manual refresh
- Adds callback: save a local objective/success-criteria correction
- Produces no model call on render or scope switch

- [ ] **Step 1: Replace old hierarchy tests with the approved seven-section journey**

  Test exact visible order:

  1. 工作目标 / legacy 工作主题;
  2. 当前阶段与当前重点;
  3. 本轮执行 with `已完成 2/4 个已知步骤` only when finite plan exists;
  4. 接下来;
  5. 阻塞或待决定;
  6. 已完成;
  7. 相关成果.

  Assert no overall percent/progress bar, no title-only summary, and no loud running/artifact dashboard counts.

- [ ] **Step 2: Add interaction/default tests**

  Assert:

  - with an active conversation, initial tab is `本次会话`;
  - without one, initial tab is `当前本子`/`当前范围`;
  - tab switching only changes local render state;
  - active notebook rows open their exact source conversation;
  - artifacts open the real preview callback;
  - the low-emphasis more menu exposes `更新概览` and disables it while a run is active;
  - `编辑工作目标` opens a compact inline form for objective and success criteria, creates a local revision, and never calls the model;
  - refresh pending/success/error feedback stays one quiet text line, not a card.

- [ ] **Step 3: Run the component test and confirm RED**

  Run: `npx vitest run src/renderer/components/WorkbenchOverview.test.tsx`

- [ ] **Step 4: Implement the new semantic structure**

  Remove derivation logic from the React file; import the pure model types. Keep one compact scroll column with section dividers and 3–5 visible rows per group. Use existing semantic tokens, 12–15px type hierarchy, and existing panel width behavior. Do not create stacked dashboard cards.

  Conversation scope renders one snapshot. Notebook scope renders up to five compact source-linked conversation rows, each with phase/next/blocker; it does not blend their prose.

  Keep objective correction behind the low-emphasis more menu. The form uses the existing panel width, two bounded inputs, `保存`/`取消`, and a short “由你固定” marker after save. Do not add a settings page or a new prominent card.

- [ ] **Step 5: Verify component behavior and commit**

  Run:

  ```powershell
  npx vitest run src/renderer/components/WorkbenchOverview.test.tsx src/renderer/components/workbench-overview-model.test.ts
  npx tsc -p tsconfig.renderer.json --noEmit
  git diff --check -- src/renderer/components/WorkbenchOverview.tsx src/renderer/components/WorkbenchOverview.test.tsx
  ```

  Commit only the panel files with: `feat: render continuity overview`

---

## Task 8: Integrate the Projection With the Existing Activity Rail

**Files:**
- Modify: `src/renderer/components/WorkbenchActivityRail.tsx`
- Modify: `src/renderer/components/WorkbenchActivityRail.test.tsx`

**Interfaces:**
- Consumes: conversation store `refreshWorkOverview`, active conversation, timelines, run ids, pending approvals/questions, artifacts
- Produces: one conversation projection and one notebook/global aggregate
- Preserves: Explorer, Search, overlay/docked/focused presentation, resize, source navigation

- [ ] **Step 1: Save the pre-edit diff for this already-dirty file**

  Run:

  ```powershell
  $backup = Get-Content -LiteralPath 'E:\Leemo-backups\workbench-continuity-overview-latest.txt' -Raw
  $backup = $backup.Trim()
  git diff --binary -- src/renderer/components/WorkbenchActivityRail.tsx src/renderer/components/WorkbenchActivityRail.test.tsx `
    | Set-Content -LiteralPath "$backup\activity-rail-before.patch" -Encoding utf8
  ```

- [ ] **Step 2: Write failing integration tests**

  Assert:

  - opening the overview tool and switching scopes invokes no bridge/model action;
  - `本次会话` receives only the active conversation;
  - notebook/global projection receives all in-scope conversations and keeps their ids;
  - clicking a notebook item switches/open the source conversation;
  - clicking refresh calls `refreshWorkOverview(activeId)` once;
  - saving a user correction calls `correctWorkOverview(activeId, correction)` and does not invoke bridge send;
  - no active conversation disables semantic refresh but still renders local notebook facts;
  - Explorer and Search panels still mount through their existing branches.

- [ ] **Step 3: Run the rail test and confirm RED**

  Run: `npx vitest run src/renderer/components/WorkbenchActivityRail.test.tsx`

- [ ] **Step 4: Replace only the overview model assembly**

  Keep the current panel shell and presentation logic. Replace `deriveWorkbenchOverview` calls with the new conversation/notebook projection functions, pass the real callbacks, and leave `ScopedFilesPanel`, `ConversationFilesPanel`, `GlobalSearchPage`, resize, dock/overlay, and focus code unchanged.

- [ ] **Step 5: Verify no adjacent-panel regression and commit**

  Run:

  ```powershell
  npx vitest run `
    src/renderer/components/WorkbenchActivityRail.test.tsx `
    src/renderer/components/WorkbenchOverview.test.tsx `
    src/renderer/components/FileTree.test.tsx
  npx tsc -p tsconfig.renderer.json --noEmit
  git diff --check -- src/renderer/components/WorkbenchActivityRail.tsx src/renderer/components/WorkbenchActivityRail.test.tsx
  ```

  Compare the final scoped diff with `$backup\activity-rail-before.patch`; confirm unrelated pre-existing changes remain. Commit only the overview integration hunks with: `feat: connect overview continuity projection`

---

## Task 9: Whole-Journey Verification, Restart Recovery, and Retained Evidence

**Files:**
- Test only: all files from Tasks 1–8
- Retain screenshots under: `E:\Leemo\.tmp-visual-audit\workbench-continuity-overview\`
- Do not clean or delete existing QA directories

**Acceptance fixture:**
- one real conversation with at least five user instructions;
- two runs;
- one finite plan revision;
- one approval or ask-user wait and resolution;
- one retryable failure and recovery;
- three real artifacts;
- one semantic phase change and one meaningful terminal checkpoint.

- [ ] **Step 1: Run the complete focused suite**

  Run:

  ```powershell
  npx vitest run `
    tests/bridge/work-overview.test.ts `
    tests/bridge/work-overview-mcp.test.ts `
    tests/host/momo-prompt.test.ts `
    src/renderer/stores/message-model.test.ts `
    src/renderer/stores/conversations.test.ts `
    src/renderer/components/workbench-overview-model.test.ts `
    src/renderer/components/WorkbenchOverview.test.tsx `
    src/renderer/components/WorkbenchActivityRail.test.tsx
  ```

  Expected: all focused tests pass with no retries or skipped new tests.

- [ ] **Step 2: Run project gates**

  Run:

  ```powershell
  npm run typecheck
  npm test
  npm run verify:bundled-skills
  npm run build
  npm run build:main
  git diff --check
  ```

  Expected: all commands exit 0. If a known unrelated dirty-tree failure exists, record its exact file/error and prove every scoped gate still passes; do not claim full green.

- [ ] **Step 3: Verify the live Electron journey at four widths**

  Build/restart Electron after `build:main`; do not rely on renderer hot reload for host prompt/MCP changes. Using the real fixture conversation, verify:

  - opening overview causes zero network/model events;
  - default scope is the active conversation;
  - the user can answer the seven recovery questions in ten seconds without reading history;
  - `2/4` is labelled known steps and no overall percent appears;
  - waiting, failure, recovery, completed evidence, and artifacts are truthful and clickable;
  - notebook scope lists separate source conversations;
  - manual refresh is visibly user-triggered and counted as one model turn;
  - malformed/failed overview metadata does not interrupt the main task.

  Capture and retain:

  ```text
  01-conversation-running-1440x900.png
  02-conversation-waiting-1280x860.png
  03-conversation-recovered-1024x768.png
  04-notebook-aggregate-960x680.png
  05-panel-focused-1440x900.png
  06-panel-overlay-960x680.png
  ```

- [ ] **Step 4: Verify restart and legacy recovery**

  Close Electron, restart with the same isolated Leemo data root, and confirm:

  - latest snapshot and revision are unchanged;
  - source run/tool ids and timestamp survive;
  - opening the restored overview makes no model call;
  - a legacy five-field fixture still renders conservatively;
  - user task status and Goal Mode state are unchanged.

- [ ] **Step 5: Package only after acceptance**

  Run: `npm run electron:pack`

  Launch the unpacked/package candidate with an isolated data root, repeat the overview open/restart smoke, and record the package path plus SHA-256. Do not replace the previous installer until this packaged smoke passes.

- [ ] **Step 6: Final scoped review and commit**

  Run:

  ```powershell
  git status --short
  git diff --stat
  git diff --check
  git diff --name-only --cached
  ```

  Confirm staged files are only this plan's implementation files. Commit the final verification-only adjustments with: `test: verify workbench continuity overview`.

## Deferred Follow-up Queue

1. Quick Capture: align the caret and placeholder on the same text baseline.
2. Quick Capture: restore a Word-like writing-area ratio by shrinking chrome, toolbar, and attachment occupancy while preserving existing note/task, storage, drag-copy/reference, autosave, and shortcut behavior.
