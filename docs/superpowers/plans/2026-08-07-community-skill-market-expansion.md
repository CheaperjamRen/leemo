# Community Skill Market Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Account for every current ColaOS, NewMax, and WorkBuddy Skill candidate, then expose every traceable public GitHub Skill as a pinned, hash-verified, directly installable Leemo community card.

**Architecture:** Keep the shipped catalog static and offline-readable. A developer-only refresh script consumes checked-in competitor candidate snapshots plus an approved source registry, downloads one pinned GitHub archive per repository, validates the license and real `SKILL.md` trees, and generates the typed runtime manifest; Leemo itself only downloads exact files from `raw.githubusercontent.com` after the user clicks Install.

**Tech Stack:** TypeScript, Node.js 20+, Vitest, `fflate`, React, Zustand, Electron host bridge.

## Global Constraints

- The current release downloads community Skills directly from pinned GitHub revisions; no Leemo cloud service is introduced.
- A future domestic no-VPN Skill Hub may mirror the same files, IDs, revisions, sizes, and SHA-256 values, but is not implemented in this plan.
- Every competitor candidate must end in one explicit state: `included`, `duplicate`, `not-a-skill`, `private`, `license-unknown`, or `origin-unresolved`.
- Only a public GitHub tree with a real `SKILL.md` and confirmed redistribution license may become an install card.
- A collection or CLI/MCP project is never represented as a fake Skill; collections expand into real child Skill paths and tools remain future connector candidates.
- Runtime installation remains optional, user-triggered, atomic, and hash-verified; an error leaves no partial directory.
- `human-writing` is a featured entry in “写作与表达”.
- `obra/superpowers` is not duplicated in the community download catalog; all
  14 items are supplied by the separate offline Superpowers bundle plan.
- Existing dirty Skill Market work is preserved and completed; unrelated worktree changes are not staged or rewritten.

---

## File Map

- `community-skills/candidates.json`: sanitized competitor inventory and one resolution record per candidate.
- `community-skills/sources.json`: approved GitHub repositories, pinned revisions, licenses, and true Skill subpaths.
- `scripts/refresh-community-skill-catalog.mjs`: developer-only archive downloader, validator, hasher, and TypeScript manifest generator.
- `src/host/community-skill-catalog.generated.ts`: generated, deterministic runtime entries including exact files.
- `src/host/community-skill-catalog.ts`: handwritten types, lookup helper, and generated-data re-export.
- `src/host/skill-admin-service.ts`: host-owned catalog projection and atomic installation.
- `src/bridge/contract.ts`: typed community card contract.
- `src/renderer/pages/SkillsPage.tsx`: featured/all discovery, source detail, and install feedback.
- `docs/research/2026-08-07-community-skill-source-audit.md`: human-readable included/excluded audit.

### Task 1: Finish and freeze the existing Skill Market discovery slice

**Files:**
- Modify: `src/bridge/contract.ts`
- Modify: `src/host/community-skill-catalog.ts`
- Modify: `src/host/skill-admin-service.ts`
- Modify: `src/renderer/pages/SkillsPage.tsx`
- Test: `tests/host/community-skill-catalog.test.ts`
- Test: `tests/host/skill-admin-service.test.ts`
- Test: `src/renderer/pages/SkillsPage.test.tsx`
- Test: `src/renderer/stores/skills.test.ts`
- Test: `tests/bridge/skill-admin-mcp.test.ts`

**Interfaces:**
- Produces: `CommunitySkillCatalogEntry.featured: boolean` and `CommunitySkillView.featured: boolean`.
- Produces: a “精选推荐 / 全部技能” presentation toggle that never changes trust or installation behavior.

- [ ] **Step 1: Run the focused tests against the current dirty slice**

Run:

```powershell
npx vitest run tests/host/community-skill-catalog.test.ts tests/host/skill-admin-service.test.ts tests/bridge/skill-admin-mcp.test.ts src/renderer/stores/skills.test.ts src/renderer/pages/SkillsPage.test.tsx
```

Expected: all tests pass; if a test fails, preserve the current intended contract and repair only the failing behavior before expanding the catalog.

- [ ] **Step 2: Run typecheck and inspect the exact diff**

Run:

```powershell
npm run typecheck
git diff --check
git diff -- src/bridge/contract.ts src/host/community-skill-catalog.ts src/host/skill-admin-service.ts src/renderer/pages/SkillsPage.tsx
```

Expected: no type errors or whitespace errors; the renderer receives `featured` only through the typed bridge.

- [ ] **Step 3: Commit the independently working discovery slice**

```powershell
git add src/bridge/contract.ts src/host/community-skill-catalog.ts src/host/skill-admin-service.ts src/renderer/pages/SkillsPage.tsx src/renderer/pages/SkillsPage.test.tsx src/renderer/stores/skills.test.ts tests/bridge/skill-admin-mcp.test.ts tests/host/community-skill-catalog.test.ts tests/host/skill-admin-service.test.ts
git commit -m "feat: improve community skill discovery"
```

### Task 2: Add a reproducible candidate-accounting and manifest pipeline

**Files:**
- Create: `community-skills/candidates.json`
- Create: `community-skills/sources.json`
- Create: `scripts/refresh-community-skill-catalog.mjs`
- Create: `tests/main/community-skill-refresh-script.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run refresh:community-skills -- --write`.
- Produces: `npm run refresh:community-skills -- --check` where `--check` validates checked-in JSON and generated output without changing files.
- Produces: candidate records shaped as:

```ts
interface CompetitorCandidate {
  competitor: "colaos" | "newmax" | "workbuddy";
  externalId: string;
  name: string;
  advertisedSource?: string;
  resolution: "included" | "duplicate" | "not-a-skill" | "private" | "license-unknown" | "origin-unresolved";
  catalogId?: string;
  reason: string;
}
```

- Produces: approved source records shaped as:

```ts
interface ApprovedRepository {
  repository: `${string}/${string}`;
  revision: string;
  license: string;
  licensePath: string;
  entries: Array<{
    id: string;
    upstreamPath: string;
    name: string;
    description: string;
    category: string;
    categoryLabel: string;
    featured: boolean;
    author: string;
  }>;
}
```

- [ ] **Step 1: Write failing script tests**

Add tests that create small ZIP fixtures and assert that the refresh code:

```ts
expect(() => validateCandidates([{ resolution: "included", catalogId: undefined }])).toThrow(/catalogId/);
expect(() => validateSources(twoEntriesWithSameRepositoryAndPath)).toThrow(/重复/);
expect(buildManifest(validArchive).entries[0].files).toEqual([
  expect.objectContaining({ path: "SKILL.md", bytes: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
]);
expect(() => buildManifest(archiveWithoutLicense)).toThrow(/许可证/);
expect(() => buildManifest(archiveWithTraversal)).toThrow(/路径/);
```

- [ ] **Step 2: Verify the tests fail for missing refresh behavior**

Run:

```powershell
npx vitest run tests/main/community-skill-refresh-script.test.ts
```

Expected: FAIL because the refresh module and validation functions do not exist.

- [ ] **Step 3: Implement the minimal deterministic refresh script**

The script must:

```js
const zipUrl = `https://codeload.github.com/${repository}/zip/${revision}`;
// one archive request per repository; enumerate only approved Skill subtrees
// reject absolute paths, `..`, symlinks, caches, node_modules, and files > 10 MiB
// append the repository license as LICENSE.upstream
// sort repositories, entries, and files before serializing
// write src/host/community-skill-catalog.generated.ts only with --write
```

Export pure `validateCandidates`, `validateSources`, `buildManifestFromArchive`, and `serializeGeneratedCatalog` functions so tests do not need the network.

- [ ] **Step 4: Verify green and add the package command**

```json
"refresh:community-skills": "tsx scripts/refresh-community-skill-catalog.mjs"
```

Run:

```powershell
npx vitest run tests/main/community-skill-refresh-script.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the pipeline**

```powershell
git add community-skills/candidates.json community-skills/sources.json scripts/refresh-community-skill-catalog.mjs tests/main/community-skill-refresh-script.test.ts package.json
git commit -m "build: add reproducible community skill catalog refresh"
```

### Task 3: Audit and generate the complete public GitHub catalog

**Files:**
- Modify: `community-skills/candidates.json`
- Modify: `community-skills/sources.json`
- Create: `src/host/community-skill-catalog.generated.ts`
- Modify: `src/host/community-skill-catalog.ts`
- Modify: `tests/host/community-skill-catalog.test.ts`
- Create: `docs/research/2026-08-07-community-skill-source-audit.md`

**Interfaces:**
- Consumes: `serializeGeneratedCatalog(approvedRepositories)` from Task 2.
- Produces: `COMMUNITY_SKILL_CATALOG: readonly CommunitySkillCatalogEntry[]` and `communityCatalogEntry(idOrName)` with no runtime network call.

- [ ] **Step 1: Add failing completeness and identity tests**

Add assertions that:

```ts
expect(COMMUNITY_SKILL_CATALOG.some((entry) => entry.id === "human-writing")).toBe(true);
expect(new Set(COMMUNITY_SKILL_CATALOG.map((entry) => `${entry.repository}:${entry.upstreamPath}`)).size)
  .toBe(COMMUNITY_SKILL_CATALOG.length);
expect(unresolvedIncludedCandidates()).toEqual([]);
expect([...candidateIdsMarkedIncluded()].every((id) => catalogIds().has(id))).toBe(true);
expect(COMMUNITY_SKILL_CATALOG.some((entry) => entry.repository === "obra/superpowers")).toBe(false);
```

Competitor accounting and the broader Leemo-curated catalog are intentionally
different sets: every `included` competitor candidate must resolve to a catalog
entry, while additional independently curated entries such as `human-writing`
need a pinned approved source but must not be misrepresented as a competitor
candidate. Also assert every path is relative, every size is positive, every
SHA-256 is 64 lowercase hex characters, and every entry contains one
`LICENSE.upstream` manifest item.

- [ ] **Step 2: Verify the completeness test fails**

Run:

```powershell
npx vitest run tests/host/community-skill-catalog.test.ts
```

Expected: FAIL because `human-writing` and the competitor accounting files are not yet represented.

- [ ] **Step 3: Populate candidate accounting from all three competitor inventories**

Record each ColaOS 1.2.9 directory entry, all 45 NewMax market entries, and WorkBuddy’s five current built-in market candidates. Expand collection entries into their public child `SKILL.md` paths; mark duplicate paths once; record the concrete reason for every excluded item. Do not copy proprietary competitor files or secrets into either JSON file.

- [ ] **Step 4: Populate approved sources and pin primary repositories**

At minimum include and pin the already verified primary sources plus every additional public source resolved during the audit:

```json
{
  "repository": "KKKKhazix/human-writing",
  "revision": "4fda173f3fef7fb808f3eba991eeb2528ea4b189",
  "license": "MIT",
  "licensePath": "LICENSE",
  "entries": [{
    "id": "human-writing",
    "upstreamPath": "human-writing",
    "name": "human-writing",
    "description": "基于真实材料、事实边界和中文语感完成自然写作与改稿。",
    "category": "writing",
    "categoryLabel": "写作与表达",
    "featured": true,
    "author": "KKKKhazix"
  }]
}
```

The recorded file tree must include `SKILL.md`, `VERSION`, `agents/openai.yaml`, `dist/human-writing-lite.md`, all five `references/*.md`, `scripts/check_prose.py`, and `LICENSE.upstream` when those files exist at the pinned revision.

- [ ] **Step 5: Generate and inspect the static manifest**

Run:

```powershell
npm run refresh:community-skills -- --write
npm run refresh:community-skills -- --check
git diff --check
```

Expected: the second command reports no drift; the generated file contains no credentials, local absolute paths, branches such as `main`, or unpinned URLs.

- [ ] **Step 6: Write the audit report from the two registries**

The report must state candidate counts per competitor, unique included Skill count, duplicate count, and each exclusion reason with repository evidence. It must explicitly distinguish “not a Skill” from “not useful”.

- [ ] **Step 7: Verify green and commit the catalog**

```powershell
npx vitest run tests/host/community-skill-catalog.test.ts
git add community-skills/candidates.json community-skills/sources.json src/host/community-skill-catalog.generated.ts src/host/community-skill-catalog.ts tests/host/community-skill-catalog.test.ts docs/research/2026-08-07-community-skill-source-audit.md
git commit -m "feat: expand curated community skills"
```

### Task 4: Prove direct GitHub install, failure cleanup, and restart recovery

**Files:**
- Modify: `tests/host/skill-admin-service.test.ts`
- Modify: `src/host/skill-admin-service.ts` only if the failing test exposes a real gap
- Modify: `src/renderer/pages/SkillsPage.test.tsx`

**Interfaces:**
- Consumes: generated exact-file manifests.
- Produces: unchanged `installCatalog(idOrName): Promise<SkillInstallResult>` with atomic finalization.

- [ ] **Step 1: Add a real-manifest install test for `human-writing`**

Stub `fetchFn` by exact raw GitHub URL and return the generated bytes. Assert:

```ts
expect(result.installed[0]).toMatchObject({
  catalogId: "human-writing",
  trust: "community",
  repository: "KKKKhazix/human-writing",
  scanStatus: "scanned",
});
expect(readInstalledFiles()).toContain("references/revision.md");
```

- [ ] **Step 2: Add a mismatch/failure test**

Return one altered byte for a supporting file and assert the install rejects with a short integrity message, the final Skill directory does not exist, and no managed registry record is written.

- [ ] **Step 3: Run tests red, then make the smallest host repair if needed**

```powershell
npx vitest run tests/host/skill-admin-service.test.ts
```

Expected before any repair: either PASS (existing atomic installer already satisfies the requirement) or one precise FAIL proving a gap. If it passes, do not rewrite the installer.

- [ ] **Step 4: Verify UI success and failure language**

Assert the card shows one compact installing state, becomes enabled after success, and remains installable with a concise retry message after failure. No confirmation modal or security-scan gate is added.

- [ ] **Step 5: Run the focused suite and commit only if behavior changed**

```powershell
npx vitest run tests/host/skill-admin-service.test.ts src/renderer/pages/SkillsPage.test.tsx src/renderer/stores/skills.test.ts tests/bridge/skill-admin-mcp.test.ts
```

Expected: PASS with no console warnings.

### Task 5: Release verification and handoff

**Files:**
- Modify: `docs/research/2026-08-07-community-skill-source-audit.md`

- [ ] **Step 1: Run all proportionate release gates**

```powershell
npm run typecheck
npm test
npm run verify:bundled-skills
npm run build
npm run build:main
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 2: Record evidence**

Append the exact catalog count, repository count, total downloadable file count/bytes, test count, build result, and one successful plus one failed-install proof to the audit report.

- [ ] **Step 3: Final scoped commit**

```powershell
git add docs/research/2026-08-07-community-skill-source-audit.md
git commit -m "docs: record community skill verification"
```
