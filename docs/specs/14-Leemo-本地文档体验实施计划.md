# 14 · Leemo 本地文档体验实施计划

> Approved scope: A — document trust chain plus visual polish.
> Do not rewrite the editor framework or redesign the accepted Start sidebar.

## Task 0 — Freeze and checkpoint

- Commit the verified global visual-polish baseline separately.
- Add the product-positioning archive and this release-gate spec.

## Task 1 — User copy and truthful Start projections

- RED: assert no AI-boundary meta copy or engineering-progress copy is rendered.
- Replace copy with object/action/result language.
- Make Inbox/Pinned/Recent project real note queries.
- Hide Locations only if a minimal real location path cannot be completed in this sprint.

## Task 2 — Draft safety and save states

- RED: cover debounce save, Ctrl+S flush, save failure, revision conflict, switching and restart recovery.
- Add one recovery-buffer helper around the existing note truth; no second document database.
- Keep one compact save state in the document header.

## Task 3 — Cursor-aware references and rich object entry

- RED: insert note references at the current selection/drop position.
- Add format active state and a single-column More menu.
- Expose link, code, highlight, callout, formula, Mermaid and table creation through existing Lexical nodes.
- Restrict Todo candidates to selected/checklist content.

## Task 4 — Attachments and file actions

- RED: reference/copy semantics, preview/open/reveal, missing path and removal.
- Reuse existing typed bridge and PreviewPane paths; do not create a second file-opening stack.
- Collapse empty attachment/backlink/task sections.

## Task 5 — Responsive and visual hierarchy

- Implement the inner Explorer overlay below 820px with Escape/focus return.
- Preserve 1440 and 960 geometry.
- Tighten document header, toolbar, table controls, callouts and state rows using existing Start tokens.
- Validate parent-layout balance after every hidden or moved element.

## Task 6 — Real Electron verification

- Update the existing verifier instead of creating a parallel harness.
- Replace product-philosophy fixture content with realistic project notes and a long document.
- Capture the matrix named in the spec and verify restart, files, conflicts and zero model calls.

## Task 7 — Independent visual gates

- Run Kimi K3 with exact screenshot paths and a per-image read-proof table.
- Iterate material findings once.
- Ask one independent visual/UX subagent to score the final current state; fix material findings and rerun focused checks.

## Task 8 — Release closeout

- Focused tests while iterating; final required typecheck, full tests, bundled-skill verification, renderer/main builds.
- Commit scoped work, keep the tree clean, then build one new Electron installer reusing the existing Electron cache.
- Record package version, file path and install/runtime smoke result; do not repeatedly compute hashes.
