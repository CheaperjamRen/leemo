# Batch 0b / B2 report: artifacts + wiki entries

## Scope

Target: `E:\Leemo\.claude\worktrees\agent-aa200edc2563d951e`.

Implemented only the four B2 store files plus this report:

- `src/renderer/stores/artifacts.ts`
- `src/renderer/stores/artifacts.test.ts`
- `src/renderer/stores/wiki-entries.ts`
- `src/renderer/stores/wiki-entries.test.ts`

The target already contained valid Batch 0a edits on top of `28921be`; they were preserved. No merge, patch reapplication, commit, push, reset, stash, or clean was performed because the target was not the stale clean baseline.

## TDD evidence

- Focused RED: before implementation, Vitest failed to resolve `./artifacts` from the newly added artifact test (no production module existed).
- Focused GREEN: `npm test -- src/renderer/stores/artifacts.test.ts src/renderer/stores/wiki-entries.test.ts` → **2 files / 14 tests passed**.
- Full suite: `npm test -- --run` → **43 files / 320 tests passed** (baseline was 306; +14 B2 tests).
- Typecheck: `npm run typecheck` → vendor, root, and renderer stages all exit 0.
- `git diff --check` → exit 0 (existing snapshot line-ending warning only).

## Behavior delivered

`artifacts.ts` has pure terminal Write/Edit/visualization derivation, path/title normalization for Windows and Unix separators, workspace-relative versus escaped absolute paths, notebook matching, immutable metadata, and newest-first id/path upsert/remove actions. It performs no filesystem, bridge, fixture, or subscription work.

`wiki-entries.ts` keeps wiki shadow IDs out of the conversations store, resolves provider/model defaults at first ask, sends `purpose:"wiki"` create then send, supports detailed/short prompt prefixes, reuses one shadow cid for multi-turns, exposes exact-cid `receiveEvent`, commits turns only at `run.finished`, ignores stale/foreign events, and does not auto-dispose after successful completion. Failed create/send/dispose operations do not create phantom active entries or turns; disposal errors are contained and entries are retained.

The single exported cross-card seam is `LEEMO_VISUALIZATION_TOOL_NAME` in `artifacts.ts`, with an integration comment directing Batch 0d to consume it rather than fixture production data or another alias. B2 does not subscribe; `WikiStoreDeps.onEvent` is only a composition seam for 0c.

## Rework / independent Opus findings — RED → GREEN

The preserved target was already partially implemented when the independent review arrived. I added executable regressions first, ran them against the prior implementation, then applied only minimal changes in the four B2 source/test files:

1. **Wiki lifecycle races (RED):** focused wiki run reported 2 failing regressions: concurrent asks made two `bridge:createConversation` calls, and close/reopen allowed stale `stale-cid` to attach and send. **GREEN:** the same race tests now pass. A popup-generation token invalidates stale async work; one in-flight create and one pending turn serialize/no-op concurrent asks; stale created cids are disposed; terminal completion permits the next turn; exact cid and generation checks prevent stale writes.
2. **Lexical traversal containment (RED):** artifact run reported traversal regression (`C:\\Users\\me\\Leemo\\..\\outside.md` was `escaped:false`, `../outside.md`) before the repair. **GREEN:** dot-segments are resolved with a pure lexical stack after trimming and before workspace containment; Windows and Unix traversal remain registered but `escaped:true`, `bookId:null`.
3. **Notebook interior-segment match (RED):** artifact run reported `exports/math/notes.md` incorrectly receiving `bookId:"math"`. **GREEN:** association now requires the normalized first path segment to equal the notebook id.
4. **Tool-specific path extraction (RED):** artifact run reported Write/Edit with only `{ path: ... }` as artifacts. **GREEN:** Write/Edit require `input.file_path`; only the exact visualization tool may use `path` fallback.
5. **Stale send rejection after close/reopen (RED → GREEN):** the added regression initially left the reopened popup `streaming:true` and committed no new turn because the stale send catch unconditionally cleared the singleton pending state. **GREEN:** send rejection cleanup now checks generation and cid before clearing pending or streaming, so a c2 turn survives c1 failure.
6. **Unresolved stale create blocking a new generation (RED → GREEN):** the added regression initially observed only one create and no new-generation send while c1 create remained pending. **GREEN:** `createInFlight` is now generation-bound; a reopened popup may create independently, while the old resolved cid is disposed and ignored.
7. **Same-cid next-turn send rejection (RED → GREEN):** the added regression initially committed the first turn but the old first send catch cleared the second pending turn because generation and cid were unchanged; the second `run.finished` was then ignored. **GREEN:** every ask gets a distinct turn identity, and send rejection cleanup only mutates state when it still owns that exact turn.
## Final evidence after rework

- Focused: `npm test -- src/renderer/stores/artifacts.test.ts src/renderer/stores/wiki-entries.test.ts` → **2 files / 22 tests passed**.
- Full: `npm test -- --run` → **43 files / 328 tests passed**.
- Typecheck: `npm run typecheck` → **all three stages passed** (`tsconfig.vendor.json`, `tsconfig.json`, `tsconfig.renderer.json`).
- Diff hygiene: `git diff --check` → **passed**; only the inherited gateway snapshot LF/CRLF warning was emitted.

## Changed allowlist

Only these owned B2 files changed during rework: `artifacts.ts`, `artifacts.test.ts`, `wiki-entries.ts`, and `wiki-entries.test.ts`; this report was updated for the evidence. No B1/B3/0d/parent/smoke files were touched, and no commit/push/reset/stash/clean was performed.


## Rework / independent Opus findings 8–10 — RED → GREEN

8. **Distinct lexical identities for escaped relative paths (RED):** focused artifact tests showed `../outside.md` collapsing to `outside.md`, so safe and escaped entries shared the same path identity. **GREEN:** relative lexical normalization now retains leading `../` segments (`../outside.md` and `a/../../outside.md`), keeps escaped entries at `bookId:null`, and the upsert key includes `escaped`, so safe and escaped registrations coexist. Absolute traversal and workspace-relative behavior remain covered by the existing regressions.

9. **Dispose replaced popup shadow CID (RED):** focused wiki tests showed direct `openPopup` replacement left the previous active shadow CID undisposed. **GREEN:** replacement now synchronously clears the active UI state and fire-and-forgets exactly one rejection-contained `bridge:disposeConversation`; entries/turns remain intact, and generation checks still handle unresolved stale creates.

10. **Visualization blank-file_path fallback (RED):** focused artifact tests showed visualization input `{ file_path: "  ", path: "math/chart.html" }` returned null. **GREEN:** visualization extraction now falls back to a non-empty `path` only when `file_path` is blank; Write/Edit continue requiring a non-empty `file_path`.

## Final evidence after findings 8–10

- Focused: `npm --prefix E:/Leemo/.claude/worktrees/agent-aa200edc2563d951e test -- --run src/renderer/stores/artifacts.test.ts src/renderer/stores/wiki-entries.test.ts` → **2 files / 25 tests passed**.
- Full: `npm --prefix E:/Leemo/.claude/worktrees/agent-aa200edc2563d951e test -- --run` → **43 files / 331 tests passed**.
- Typecheck: `npm --prefix E:/Leemo/.claude/worktrees/agent-aa200edc2563d951e run typecheck` → **all three stages passed** (`tsconfig.vendor.json`, `tsconfig.json`, `tsconfig.renderer.json`).
- Untracked-file whitespace validation: a byte-level trailing-whitespace check ran independently against all four B2 source/test files and reported each **whitespace clean**. Ordinary `git diff --check` was not used as evidence for these files.

## Final B2 file/test counts

- Owned implementation/test files: **4** (`artifacts.ts`, `artifacts.test.ts`, `wiki-entries.ts`, `wiki-entries.test.ts`).
- Report file: **1** (`docs/sdd/fe-b0b2-artifacts-wiki-report.md`).
- Focused B2 tests: **25**.
- Full suite: **331** tests across **43** files.

## Rework / independent Opus findings 11–14 — RED → GREEN

11. **Workspace-boundary containment (RED):** focused artifact run reported 3 failures: Windows workspace paths were retained as escaped absolute identities, Windows `..` escape was treated as inside, and POSIX `/tmp/Leemo/...` was misclassified by the former `/leemo/` substring heuristic. **GREEN:** pure lexical root/candidate normalization now requires matching path kind and a path-boundary prefix; drive and UNC comparisons are case-insensitive, POSIX comparisons remain case-sensitive, and absent roots conservatively retain escaped absolute identity.
12. **UNC identity preservation (RED):** the UNC regression initially normalized `\\server\share\outside.md` to a non-UNC identity, collapsing its distinction from POSIX `/server/share/outside.md`. **GREEN:** drive, POSIX, and UNC prefixes are parsed separately; UNC identities retain `//server/share/...`, and registration keeps UNC and POSIX entries distinct.
13. **Finished-success filtering (RED):** focused wiki run reported one failure because cancelled/non-success terminal events committed a turn. **GREEN:** turns are committed only when `event.type === "run.finished"`, `event.subtype === "success"`, and `!event.isError`; every other terminal event clears streaming/pending without appending a turn.
14. **Error-to-next-turn stale CID (RED):** focused wiki run reported one failure because an error left the old shadow CID active and reusable. **GREEN:** current-CID errors clear pending, set `streaming:false`, null the shadow CID, dispose exactly once with rejection containment, and allow the next ask to create a new CID; stale old-CID terminal events are ignored while the new CID commits normally.

## Final evidence after findings 11–14

- Focused RED: after adding findings 11–14 regressions, the focused run reported **5 failures / 25 passing tests** (3 artifact containment/identity failures and 2 wiki lifecycle failures).
- Focused GREEN: `npm --prefix E:/Leemo/.claude/worktrees/agent-aa200edc2563d951e test -- --run src/renderer/stores/artifacts.test.ts src/renderer/stores/wiki-entries.test.ts` → **2 files / 30 tests passed**.
- Full: `npm --prefix E:/Leemo/.claude/worktrees/agent-aa200edc2563d951e test -- --run` → **43 files / 336 tests passed**.
- Typecheck: `npm --prefix E:/Leemo/.claude/worktrees/agent-aa200edc2563d951e run typecheck` → vendor, root, and renderer stages all passed.
- No filesystem, OS, Electron, subscription, or runId changes were introduced by the artifact/wiki fixes.
