# Batch 0b / B3 foundation stores report

## Scope and baseline

- Worktree: `E:\Leemo\.claude\worktrees\agent-ae0ceb4514db86874`
- Clean base was proven to be a descendant of `28921be`; it fast-forwarded with `git merge --ff-only 28921be`.
- Applied `E:\Leemo\.claude\batch0a-reviewed.patch` after `git apply --check` passed.
- Baseline reproduction: `npm test -- --run` = **41 files / 306 tests passed**.
- No reset, stash, clean, commit, or push was used.

## TDD evidence

The five new/extended store test files were written first. The focused run was RED: missing `notebooks.ts`, `providers.ts`, and `ui.ts` imports, plus the old settings/notifications implementations failed the new action/default assertions. Implementations were then added/extended and the focused run became GREEN:

```text
npm test -- src/renderer/stores/notebooks.test.ts src/renderer/stores/providers.test.ts src/renderer/stores/settings.test.ts src/renderer/stores/ui.test.ts src/renderer/stores/notifications.test.ts
Test Files  5 passed (5)
Tests       23 passed (23)
```

## Implemented behavior

- `notebooks.ts`: key-free in-memory renderer-local notebooks, trimmed empty rejection, stable local IDs, blue/green/red rotation excluding sample entries, cloned input and immutable list updates. Workspace IPC remains intentionally unmodeled until a workspace channel exists.
- `providers.ts`: key-free `ProviderSpec` list, loading/ready/error state, refresh replacement while preserving the old list on failure, capability-driven balance eligibility (`capabilities.balanceApi === true`), timestamped success and redacted generic failure state. No provider-ID capability branching and no key caching.
- `settings.ts`: preserved `mode`, `persona`, and `buildGreeting`; added safe defaults and explicit validated setters for persona card, talk style, provider/model, permission mode, dangerous-command caching, search, and remember mode. No key fields or key actions.
- `ui.ts`: default surface/overlay state plus validated view/settings actions, preview tab dedupe and activation, width clamp at 300px, and toggle/open/close actions.
- `notifications.ts`: legacy item normalization, immutable history, exact unread count updates, collision-safe renderer-local IDs (including imported `notification-N` IDs), toast insertion/dismissal, and mark-all-read behavior. No timer or external mutation.

## Final evidence

```text
npm test -- --run
Test Files  44 passed (44)
Tests       325 passed (325)

npm run typecheck
> tsc -p tsconfig.vendor.json && tsc -p tsconfig.json && tsc -p tsconfig.renderer.json
# passed, no errors

git diff --check
# passed; only expected LF/CRLF warnings for edited text files
```

The full suite increased from 306 to 325 tests (+19 net; five focused files contain 23 tests, with four legacy tests replaced/expanded). A gateway snapshot appears as a metadata-only worktree status entry from the inherited baseline patch: `git diff-files --quiet` reports no content difference and `git ls-files --eol` reports matching LF content. It was not edited by B3.

## Independent review repair

Independent Opus 4.8 review returned **REWORK** with one Important finding: the original allocator started at `notification-1` without reserving imported legacy IDs, so an initial item with id `notification-1` could collide with the first pushed item.

TDD repair evidence:

1. Added a regression test first: initialize with `notification-1`, push, and require IDs `notification-2`, `notification-1`.
2. RED reproduced after the test was added: the implementation produced duplicate IDs `notification-1`, `notification-1`.
3. GREEN repair uses a per-store reserved-ID set seeded from normalized legacy items and advances the stable `notification-N` sequence until an unused ID is found; each allocated ID is immediately reserved.

Post-repair evidence:

```text
npm test -- src/renderer/stores/notebooks.test.ts src/renderer/stores/providers.test.ts src/renderer/stores/settings.test.ts src/renderer/stores/ui.test.ts src/renderer/stores/notifications.test.ts
Test Files  5 passed (5)
Tests       24 passed (24)

npm test -- --run
Test Files  44 passed (44)
Tests       326 passed (326)

npm run typecheck
> tsc -p tsconfig.vendor.json && tsc -p tsconfig.json && tsc -p tsconfig.renderer.json
# passed, no errors

git diff --check -- src/renderer/stores/notifications.ts src/renderer/stores/notifications.test.ts docs/sdd/fe-b0b3-foundation-stores-report.md
# passed; only expected LF/CRLF warnings
```

Repair scope was limited to `src/renderer/stores/notifications.ts`, `src/renderer/stores/notifications.test.ts`, and this report. No commit or push was made.


B3 authored/modified only:

- `src/renderer/stores/notebooks.ts`
- `src/renderer/stores/notebooks.test.ts`
- `src/renderer/stores/providers.ts`
- `src/renderer/stores/providers.test.ts`
- `src/renderer/stores/settings.ts`
- `src/renderer/stores/settings.test.ts`
- `src/renderer/stores/ui.ts`
- `src/renderer/stores/ui.test.ts`
- `src/renderer/stores/notifications.ts`
- `src/renderer/stores/notifications.test.ts`
- this report

The other modified files shown by `git status` are inherited from the explicitly applied Batch 0a reviewed patch; B3 did not alter Bridge, context, fixture, conversations, components, package/lockfile, tsconfig, vitest, gateway, vendor, or smoke files.

## Concerns / deferred seams

1. Notebook persistence is deliberately deferred: no `workspace:*` channel exists in the frozen contract, so the action is memory-only rather than an invented IPC channel.
2. Provider `refresh()` safely captures errors as a generic key-free message. Detailed diagnostics remain outside renderer state.
3. `acceptEdits` and `plan` remain contract/settings values; broker execution semantics are Phase 1 and are not fabricated here.
4. `dataDir` is a read-only display value in this store; no filesystem or persistence side effects were introduced.
5. Independent Opus 4.8 review remains required by the brief; no commit or push was made.
