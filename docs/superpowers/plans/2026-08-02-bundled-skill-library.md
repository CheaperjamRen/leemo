# Bundled Skill Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 40 generated placeholder workflows with an offline, auto-discovered 26-Skill library plus two product-owner drop folders.

**Architecture:** Package the two source roots inside `app.asar`, validate direct child Skill directories before packaging, and atomically copy one content-addressed `leemo-library` plugin into app data on first run. Host metadata comes from discovered `SKILL.md` files plus an optional root catalog; renderer state continues to persist stable ids and passes only enabled qualified names to the SDK.

**Tech Stack:** TypeScript 5.9, Node/Electron filesystem APIs, Claude Agent SDK local plugins, React 19, Zustand 5, Vitest, electron-builder.

## Global Constraints

- No online Skill Hub or first-run download is added.
- Existing Office Skills remain independently provisioned and default enabled.
- The two source folders are developer-only pre-package inputs. Installed users see one read-only built-in library; their own Skills live under `<workspace>/.leemo/skills`.
- `bundled-skills/default-enabled` means first-install enabled; `bundled-skills/optional` means first-install disabled.
- Persisted user overrides win over directory defaults on every upgrade.
- Skills are discovered from real `SKILL.md` files; TypeScript must not contain a second hand-maintained list of names.
- New bundled files live in `app.asar`, not loose `extraResources`.
- The 40 generated `bodyFor()` workflows are removed, not rewritten in bulk.
- Every code behavior follows RED-GREEN-REFACTOR; no new runtime dependency is added.

---

### Task 1: Freeze discovery and first-run policy

**Files:**
- Create: `tests/host/bundled-skills.test.ts`
- Create: `tests/main/bundled-skill-provisioner.test.ts`
- Create: `src/host/bundled-skills.ts`
- Create: `src/main/bundled-skill-provisioner.ts`

**Interfaces:**
- Produces: `BUNDLED_SKILL_PLUGIN_NAME = "leemo-library"`
- Produces: `BundledSkillDefinition extends SkillInfo { id: \`bundled:${string}\`; defaultEnabled: boolean }`
- Produces: `BundledSkillRuntime.snapshot()` and `ensureReady()`
- Consumes: direct child directories under `default-enabled` and `optional`

- [ ] Write failing tests proving direct-child discovery, frontmatter parsing, duplicate rejection, stable directory ids, default policy, optional catalog metadata, open categories and ignored junk directories.
- [ ] Run `npx vitest run tests/host/bundled-skills.test.ts` and confirm failure because the module is absent.
- [ ] Implement the pure discovery/metadata projection without source-specific hardcoded names.
- [ ] Write failing provisioner tests proving content-hash reuse, staging-then-rename, complete resource copying, no mutation of source roots and human-readable failure state.
- [ ] Implement the provisioner with a single in-flight promise and a content-addressed real plugin under app data.
- [ ] Run both test files and confirm green.

### Task 2: Connect the library to host selection

**Files:**
- Modify: `src/host/bridge-host.ts`
- Modify: `src/main/main.ts`
- Modify: `tests/host/bridge-host.test.ts`
- Modify: `src/renderer/stores/skills.ts`
- Modify: `src/renderer/stores/skills.test.ts`

**Interfaces:**
- Host dependency: `bundledSkills?: BundledSkillRuntime`
- Selection output adds `enabledBundledIds: string[]`
- Plugin path is present only when at least one bundled Skill is enabled and the runtime is ready.

- [ ] Add failing host tests for list projection, default selection, explicit optional enable, unknown-name rejection, plugin-path inclusion and active-conversation hot sync.
- [ ] Add failing store test showing a preparing bundled Skill is refreshed without matching an Office-only id prefix.
- [ ] Wire the provisioner into main and await it before conversation assembly when selected.
- [ ] Extend host list/selection while preserving user and Office behavior.
- [ ] Generalize the preparation refresh predicate and run focused tests green.

### Task 3: Remove generated placeholders

**Files:**
- Delete: `src/host/builtin-skills.ts`
- Delete: `tests/host/builtin-skills.test.ts`
- Delete: `tests/host/builtin-skills-runtime.test.ts`
- Modify: `src/host/skills.ts`
- Modify: `tests/host/skills.test.ts`
- Modify: affected host/renderer fixtures that mention `leemo-builtin`

**Interfaces:**
- Removes: `BUILTIN_SKILL_DEFINITIONS`, `builtinSkillMetadata`, `materializeBuiltinSkills`, `builtinPluginRootFor`
- Preserves: user plugin discovery under `<workspace>/.leemo/skills`

- [ ] Change tests first so no production path or visible catalog can return a generated placeholder.
- [ ] Remove the template catalog and managed materializer.
- [ ] Replace stale fixtures with `leemo-library` or user/Office fixtures according to the behavior under test.
- [ ] Run all Skill and bridge-host tests green and scan source for `leemo-builtin`, `bodyFor(` and the 40 legacy ids.

### Task 4: Populate and validate the two source roots

**Files:**
- Create: `bundled-skills/README.md`
- Create: `bundled-skills/catalog.json`
- Populate: `bundled-skills/default-enabled/*`
- Populate: `bundled-skills/optional/*`
- Create: `scripts/verify-bundled-skills.mjs`
- Create: `tests/main/bundled-skill-bundle-script.test.ts`
- Modify: `package.json`

**Interfaces:**
- Script command: `npm run verify:bundled-skills`
- Exact expected inventory: 8 default + 18 optional = 26

- [ ] Write a failing script contract test for invalid frontmatter, duplicates, forbidden directories/files, symlinks, catalog drift and deterministic report fields.
- [ ] Implement the validator and add it before `electron:pack`.
- [ ] Copy 12 product-appropriate Skills from the verified local Anthropic cache, one IMA official package, and 13 Skills from a pinned JimLiu/baoyu-skills source; retain upstream license/readme files inside each directory when present. Exclude `claude-api` because it leaks a provider-specific product mental model and changes unspecified-provider tasks.
- [ ] Write concise maintenance instructions for pasting future Skills into either root.
- [ ] Run the validator and record count, files, bytes and tree hash.

### Task 5: Present real provenance without visual noise

**Files:**
- Modify: `src/renderer/pages/SkillsPage.tsx`
- Modify: `src/renderer/pages/SkillsPage.test.tsx`

**Interfaces:**
- Bundled Skills remain in section `leemo` but `sourceBadge()` prefers `sourceLabel`.
- Category filters continue to derive from open metadata.

- [ ] Add failing UI tests for `Anthropic 官方` / `腾讯官方` / `社区精选`, compact descriptions, dynamic categories and absence of the retired placeholders.
- [ ] Adjust source badges and empty/preparing states without adding card density.
- [ ] Run page/store/slash-menu tests green at desktop and narrow viewports.

### Task 6: Package and verify the user journey

**Files:**
- Modify: `electron-builder.yml`
- Modify: `scripts/cdp-skills-r11-verify.mjs`
- Modify: `docs/research/2026-07-31-r11-skills-verification.md`
- Modify: `docs/sdd/r7-requirements-ledger.md`
- Modify: `docs/sdd/HANDOFF-r7-to-next-agent.md`

**Interfaces:**
- Packaged source root: `path.join(app.getAppPath(), "bundled-skills")`
- Development source root: repository `bundled-skills`

- [ ] Add failing packaging assertions that both drop roots and catalog enter `app.asar`, while no new loose resource directory is configured.
- [ ] Wire exact `files` patterns and rebuild main/renderer/package.
- [ ] Verify first launch discovers 30 built-ins including Office, enables 12, toggles an optional Skill, invokes it, restarts and preserves the toggle.
- [ ] Add a temporary valid Skill fixture to each source root in an isolated copy and prove discovery requires no TypeScript edit.
- [ ] Record installer bytes, unpacked loose file count, ASAR size, skill archive bytes, first preparation time and app-data cache file count.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, `npm run build:main`, `npm run verify:bundled-skills`, packaged E2E and `git diff --check` before claiming completion.
