# Superpowers Offline Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship all 14 `obra/superpowers` Skills offline as a separate, default-off Leemo plugin whose individual and whole-suite enable choices survive restarts and whose cross-Skill references actually work.

**Architecture:** Vendor the pinned MIT subset into `bundled-skills/superpowers/release`, validate it at build time, and atomically materialize it under Leemo app data as plugin `superpowers`. The host merges its cards and plugin path into the existing Skill selection path; the renderer groups the 14 cards as one suite while keeping per-Skill switches.

**Tech Stack:** TypeScript, Node.js filesystem/crypto, Vitest, React, Zustand, Electron Builder, Claude Agent SDK local plugins.

## Global Constraints

- All 14 upstream Skill directories ship inside the installer and require no network after installation.
- Preserve the complete 50-file tree inside the 14 upstream Skill directories,
  plus the MIT license, author, pinned full revision, file modes, scripts,
  templates, and references. Exclude only repository-root development material,
  `.git`, caches, `node_modules`, release logs, and host installation wrappers.
- Keep the plugin namespace `superpowers:` so upstream cross-Skill references remain valid.
- First install defaults every Superpowers Skill off; user overrides survive restart and upgrade.
- Normal UI says “Superpowers 开发方法套件” and plain-language purposes; it does not teach users Claude Code/Codex setup.
- No disabled Superpowers Skill is injected into an ordinary conversation.
- Do not ship the upstream unconditional SessionStart hook. Leemo owns bootstrap
  semantics: the bootstrap is present only when `superpowers:using-superpowers`
  is enabled, and ordinary per-Skill switches remain honest context filters.
- Remove the seven older `obra/superpowers` community-download cards so one
  upstream Skill never appears under both `leemo:` and `superpowers:` namespaces.

---

## File Map

- `bundled-skills/superpowers/release/`: checked-in pinned offline payload and manifest.
- `scripts/refresh-superpowers-bundle.mjs`: deterministic vendor refresh from a pinned upstream checkout/archive.
- `scripts/verify-superpowers-bundle.mjs`: offline release gate for identity, file tree, license, and hashes.
- `src/host/superpowers-skills.ts`: 14 card definitions and runtime snapshot types.
- `src/main/superpowers-skill-provisioner.ts`: atomic app-data materialization.
- `src/main/bundled-resource-roots.ts`: dev/packaged source root resolution.
- `src/main/main.ts`: provisioner construction and host dependency injection.
- `src/host/bridge-host.ts`: catalog merge, selection, and plugin path routing.
- `src/bridge/contract.ts`: optional collection metadata on Skill cards.
- `src/renderer/pages/SkillsPage.tsx`: suite summary and whole-suite toggle.
- `electron-builder.yml`: include the Superpowers payload inside ASAR.

### Task 1: Create and verify the pinned offline payload

**Files:**
- Create: `scripts/refresh-superpowers-bundle.mjs`
- Create: `scripts/verify-superpowers-bundle.mjs`
- Create: `tests/main/superpowers-bundle-script.test.ts`
- Create: `bundled-skills/superpowers/release/manifest.json`
- Create: `bundled-skills/superpowers/release/LICENSE.upstream`
- Create: `bundled-skills/superpowers/release/skills/**`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run refresh:superpowers-bundle -- --source C:\Users\Example\.superpowers --revision 3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9`.
- Produces: `npm run verify:superpowers-bundle` with JSON output containing `skillCount`, `files`, `bytes`, and `sha256`.

- [ ] **Step 1: Write failing verifier tests**

Test a fixture that rejects a missing Skill, an extra fifteenth Skill, a symlink, a cache directory, a manifest/file hash mismatch, and a missing MIT license. Assert a valid fixture reports exactly 14 Skills with this identity set:

```ts
[
  "brainstorming", "dispatching-parallel-agents", "executing-plans",
  "finishing-a-development-branch", "receiving-code-review",
  "requesting-code-review", "subagent-driven-development",
  "systematic-debugging", "test-driven-development", "using-git-worktrees",
  "using-superpowers", "verification-before-completion", "writing-plans",
  "writing-skills",
]
```

- [ ] **Step 2: Verify red**

```powershell
npx vitest run tests/main/superpowers-bundle-script.test.ts
```

Expected: FAIL because the refresh/verifier modules do not exist.

- [ ] **Step 3: Implement refresh and verifier**

Copy only each expected Skill tree plus repository `LICENSE`. Generate a sorted manifest with the full upstream revision and SHA-256 for every file. The refresh command must delete its staging directory on failure and replace `release` only after verification succeeds.

- [ ] **Step 4: Populate from the verified local upstream checkout**

Run:

```powershell
npm run refresh:superpowers-bundle -- --source C:\Users\Example\.superpowers --revision 3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9
npm run verify:superpowers-bundle
```

If the local checkout’s full `git rev-parse HEAD` differs, use that exact 40-character value and record it in `manifest.json`; never label mutable `main` as a revision.

- [ ] **Step 5: Verify green and add release commands**

```json
"refresh:superpowers-bundle": "node scripts/refresh-superpowers-bundle.mjs",
"verify:superpowers-bundle": "node scripts/verify-superpowers-bundle.mjs"
```

Run:

```powershell
npx vitest run tests/main/superpowers-bundle-script.test.ts
npm run verify:superpowers-bundle
```

Expected: PASS and `skillCount: 14`.

- [ ] **Step 6: Commit the offline payload**

```powershell
git add bundled-skills/superpowers scripts/refresh-superpowers-bundle.mjs scripts/verify-superpowers-bundle.mjs tests/main/superpowers-bundle-script.test.ts package.json
git commit -m "build: vendor superpowers skill suite"
```

### Task 2: Discover and atomically materialize the separate plugin

**Files:**
- Create: `src/host/superpowers-skills.ts`
- Create: `src/main/superpowers-skill-provisioner.ts`
- Create: `tests/host/superpowers-skills.test.ts`
- Create: `tests/main/superpowers-skill-provisioner.test.ts`

**Interfaces:**
- Produces: `SUPERPOWERS_PLUGIN_NAME = "superpowers"`.
- Produces: `discoverSuperpowersSkills(root: string): SuperpowersSkillDefinition[]`.
- Produces: `createSuperpowersSkillProvisioner({ configDir, bundledRoot }): SuperpowersSkillRuntime`.
- Produces: qualified names such as `superpowers:brainstorming`, `defaultEnabled: false`, `collectionId: "superpowers"`, and `collectionLabel: "Superpowers 开发方法套件"`.

- [ ] **Step 1: Write failing discovery tests**

Assert all 14 definitions are default-off, source `builtin`, category `developer`, source label `社区精选`, and contain no source path in the card projection.

- [ ] **Step 2: Write failing provisioner tests**

Assert `ensureReady()` creates:

```text
C:/temp/leemo-test-profile/runtime/superpowers/.claude-plugin/plugin.json
C:/temp/leemo-test-profile/runtime/superpowers/skills/brainstorming/SKILL.md
...
C:/temp/leemo-test-profile/runtime/superpowers/skills/writing-skills/SKILL.md
```

Assert concurrent callers coalesce, identical revisions reuse the directory, failed replacement restores the previous plugin, and source files are never modified.

- [ ] **Step 3: Verify red**

```powershell
npx vitest run tests/host/superpowers-skills.test.ts tests/main/superpowers-skill-provisioner.test.ts
```

Expected: FAIL because the runtime modules do not exist.

- [ ] **Step 4: Implement discovery and materialization**

Use the existing bundled/Office provisioner invariants: recursive real-file validation, content revision, `.staging` + `.backup`, plugin manifest validation, and user-facing error state. Do not generalize all provisioners in this card.

- [ ] **Step 5: Verify green and commit**

```powershell
npx vitest run tests/host/superpowers-skills.test.ts tests/main/superpowers-skill-provisioner.test.ts
git add src/host/superpowers-skills.ts src/main/superpowers-skill-provisioner.ts tests/host/superpowers-skills.test.ts tests/main/superpowers-skill-provisioner.test.ts
git commit -m "feat: provision superpowers as an offline plugin"
```

### Task 3: Route enabled Superpowers Skills into real conversations

**Files:**
- Modify: `src/main/bundled-resource-roots.ts`
- Modify: `src/main/main.ts`
- Modify: `src/host/bridge-host.ts`
- Modify: `src/host/community-skill-catalog.ts`
- Modify: `tests/main/bundled-resource-roots.test.ts`
- Modify: `tests/host/bridge-host.test.ts`
- Modify: `tests/host/community-skill-catalog.test.ts`
- Modify: `tests/host/sdk-adapter.test.ts`

**Interfaces:**
- Adds host dependency: `superpowersSkills?: SuperpowersSkillRuntime`.
- Extends selection result with `enabledSuperpowersIds: string[]`.
- Appends the Superpowers plugin path only when at least one `superpowers:*` qualified name is enabled.

- [ ] **Step 1: Write failing root and host-selection tests**

Assert packaged/dev roots resolve `bundled-skills/superpowers/release`. In bridge tests assert:

```ts
expect(list.find((skill) => skill.qualifiedName === "superpowers:brainstorming")?.defaultEnabled).toBe(false);
expect(queryExtras.pluginPaths).toContain(superpowersPluginPath);
expect(queryExtras.enabledSkills).toContain("superpowers:brainstorming");
```

Also assert omitted `enabledSkills` excludes every `superpowers:*` item and `enabledSkills: []` loads no plugin.
Keep one unrelated Leemo/Office Skill enabled while the Superpowers suite is
off, and assert the Superpowers plugin path, allow-list names, and bootstrap
marker are all absent. Assert the old community catalog contains no
`obra/superpowers` entry.

- [ ] **Step 2: Verify red**

```powershell
npx vitest run tests/main/bundled-resource-roots.test.ts tests/host/bridge-host.test.ts tests/host/sdk-adapter.test.ts
```

- [ ] **Step 3: Implement the host wiring**

Construct the runtime beside `bundledSkills` and `officeSkills`, start a small local-only background preparation so default-off cards become immediately actionable, merge its metadata into `listSkills()`, and add its plugin path through the same `selectSkills()` source of truth. Do not copy upstream hooks. If and only if `superpowers:using-superpowers` is enabled, route its pinned bootstrap through the host-owned prompt context; disabling it must remove that context on the next round. Preparation is not conversation injection.

- [ ] **Step 4: Add the cross-Skill runtime proof**

Select all 14 qualified names and assert the SDK receives one `superpowers` plugin path plus all 14 allow-list entries, including both `superpowers:brainstorming` and `superpowers:writing-plans`. Use a clean conversation fixture with the upstream acceptance prompt (`Let's make a react todo list`) to verify the exact SDK options and host-owned `using-superpowers` bootstrap. This is a structural runtime proof, not a paid-model behavioral eval; it proves the suite is routed rather than merely rendered as cards without claiming a particular model will always choose the same successor Skill.

- [ ] **Step 5: Verify green and commit**

```powershell
npx vitest run tests/main/bundled-resource-roots.test.ts tests/host/bridge-host.test.ts tests/host/sdk-adapter.test.ts
git add src/main/bundled-resource-roots.ts src/main/main.ts src/host/bridge-host.ts src/host/community-skill-catalog.ts tests/main/bundled-resource-roots.test.ts tests/host/bridge-host.test.ts tests/host/community-skill-catalog.test.ts tests/host/sdk-adapter.test.ts
git commit -m "feat: route superpowers skills into conversations"
```

### Task 4: Add the suite-level product control without hiding individual choices

**Files:**
- Modify: `src/bridge/contract.ts`
- Modify: `src/renderer/pages/SkillsPage.tsx`
- Modify: `src/renderer/pages/SkillsPage.test.tsx`
- Modify: `src/renderer/stores/skills.test.ts`

**Interfaces:**
- Adds optional `SkillInfo.collectionId?: string` and `SkillInfo.collectionLabel?: string`.
- Produces one atomic suite action that updates all 14 stable IDs in one store
  transaction and performs exactly one host sync; persistence remains in the
  existing `skillOverrides` map.

- [ ] **Step 1: Write failing UI tests**

Render the 14 cards and assert one “Superpowers 开发方法套件” header appears, “全部启用” enables all 14, “全部关闭” disables all 14, and an individual card can then be re-enabled without changing unrelated Skills.

- [ ] **Step 2: Verify red**

```powershell
npx vitest run src/renderer/pages/SkillsPage.test.tsx src/renderer/stores/skills.test.ts
```

- [ ] **Step 3: Implement the minimal grouped control**

Keep each existing card and switch. Add only a compact group header with enabled count and the one context-sensitive suite action; do not add a separate settings page, onboarding modal, or technical installation copy. Do not implement the suite action by invoking the existing asynchronous `toggle()` fourteen times, because out-of-order IPC snapshots can restore an intermediate state.

- [ ] **Step 4: Verify restart semantics**

In store tests hydrate persisted overrides for one enabled and thirteen disabled members, refresh the host list, and assert the same state is restored without rewriting user choices to upstream defaults.

- [ ] **Step 5: Verify green and commit**

```powershell
npx vitest run src/renderer/pages/SkillsPage.test.tsx src/renderer/stores/skills.test.ts src/renderer/bridge/context.test.tsx
git add src/bridge/contract.ts src/renderer/pages/SkillsPage.tsx src/renderer/pages/SkillsPage.test.tsx src/renderer/stores/skills.test.ts src/renderer/bridge/context.test.tsx
git commit -m "feat: add superpowers suite controls"
```

### Task 5: Package and measure the offline suite

**Files:**
- Modify: `electron-builder.yml`
- Modify: `package.json`
- Modify: `scripts/verify-bundled-skills.mjs`
- Modify: `tests/main/bundled-skill-bundle-script.test.ts`
- Create: `docs/research/2026-08-07-superpowers-bundle-verification.md`

- [ ] **Step 1: Write a failing packaging contract test**

Assert `electron-builder.yml` includes `bundled-skills/superpowers/release/**/*` in ASAR and that `electron:pack:base` runs `verify:superpowers-bundle` before build.

- [ ] **Step 2: Verify red**

```powershell
npx vitest run tests/main/bundled-skill-bundle-script.test.ts
```

- [ ] **Step 3: Update packaging and verification**

Add the Superpowers release path to `files`, keep it out of `extraResources`, and add the verifier to the pack command so the suite does not create dozens of loose installer files.

- [ ] **Step 4: Run complete release gates**

```powershell
npm run verify:superpowers-bundle
npm run verify:bundled-skills
npm run typecheck
npm test
npm run build
npm run build:main
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Record performance evidence**

Record compressed/uncompressed bytes, file count, first materialization duration, cached restart duration, and proof that a default ordinary chat has no `superpowers:*` allow-list entries.

- [ ] **Step 6: Commit the release gate and evidence**

```powershell
git add electron-builder.yml package.json scripts/verify-bundled-skills.mjs tests/main/bundled-skill-bundle-script.test.ts docs/research/2026-08-07-superpowers-bundle-verification.md
git commit -m "build: verify packaged superpowers suite"
```
