# Word High-Fidelity Exact Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a governed momo tool that performs exact text replacements in an existing DOCX and writes a fidelity-preserving copy.

**Architecture:** Extend the existing in-process document engine with a DOCX package patcher that validates every requested match before changing any bytes. Expose it through the existing `leemo-documents` MCP, then register the exact tool name with permission and artifact semantics. Keep this slice renderer-light: no new editor UI and no new runtime service.

**Tech Stack:** TypeScript 5.9, fflate, fast-xml-parser, Claude Agent SDK in-process MCP, Zod, Vitest, esbuild, Electron packaged CDP verification.

## Global Constraints

- Source files are never overwritten; output is a new `.docx` beside the source unless an explicit in-workspace output path is supplied.
- At most 20 literal replacements; default expected match count is exactly one.
- No cloud service, LibreOffice dependency, Office automation process, or new npm runtime dependency.
- Existing workspace boundary, `.leemo/memory` protection, `acceptEdits`, atomic writes, compact receipts, and artifact indexing remain authoritative.
- This card does not claim structural/layout editing, tracked-change editing, macros, PPTX/XLSX editing, or Markdown rich editing.

---

### Task 1: DOCX package patcher

**Files:**
- Modify: `src/host/document-engine.ts`
- Modify: `tests/host/document-engine.test.ts`

**Interfaces:**
- Produces: `DocxTextReplacement { find; replace; expectedMatches? }`
- Produces: `DocxEditResult { buffer; replacements; changedParts }`
- Produces: `editDocxTextBuffer(buffer, replacements)`

- [ ] Write failing tests for single-run, cross-run, escaped XML, unchanged package parts, and all-or-nothing validation.
- [ ] Run `npx vitest run tests/host/document-engine.test.ts` and confirm failures are missing edit exports/behavior.
- [ ] Implement bounded input validation, paragraph/text-node mapping, overlap checks, minimal XML patching, and package rebuild.
- [ ] Re-run the engine tests and keep existing read/create/atomic tests green.

### Task 2: Governed momo tool

**Files:**
- Modify: `src/bridge/document-mcp.ts`
- Modify: `tests/bridge/document-mcp.test.ts`
- Modify: `src/bridge/interact.ts`
- Modify: `tests/bridge/interact.test.ts`
- Modify: `src/host/momo-prompt.ts`
- Modify: `tests/host/momo-prompt.test.ts`

**Interfaces:**
- Produces: `mcp__leemo-documents__edit_word_document`
- Input: `{ file_path; output_path?; replacements[] }`
- Output: compact receipt plus actual output path

- [ ] Write failing tests for default copy naming, explicit output, path/memory boundaries, ambiguous matches, no overwrite, permission classification, and prompt wording.
- [ ] Run the focused tests and confirm RED for the new tool.
- [ ] Implement the MCP handler and exact permission registry entries.
- [ ] Re-run focused bridge/host tests.

### Task 3: Artifact continuity

**Files:**
- Modify: `src/renderer/bridge/tool-names.ts`
- Modify: `src/renderer/stores/artifacts.ts`
- Modify: `src/renderer/stores/artifacts.test.ts`
- Modify: `src/renderer/bridge/wiring.test.ts`

**Interfaces:**
- Consumes the exact Word edit tool name.
- Derives the deterministic default `-修改版.docx` path or uses explicit `output_path`.

- [ ] Write failing tests that the new copy appears once in live and rebuilt成果, while the source is not misclassified as newly created.
- [ ] Implement output-path derivation without changing generic Write/Edit routing.
- [ ] Run renderer store and wiring tests.

### Task 4: Build and release verification

**Files:**
- Modify: `tests/main/document-bundle-runtime.test.ts`
- Modify: `scripts/cdp-document-tools-verify.mjs`
- Modify: `docs/research/2026-07-31-r11-document-tools-verification.md`
- Modify: `docs/sdd/r7-requirements-ledger.md`

- [ ] Add a built-main runtime round trip for editing a styled DOCX copy.
- [ ] Extend the packaged user path with success, ambiguity failure, source-byte preservation, restart recovery, and成果 visibility.
- [ ] Run focused tests, `npm test`, `npm run typecheck`, `npm run build`, `npm run build:main`, package, and packaged CDP verification.
- [ ] Record actual evidence and keep PPTX/XLSX edit work as the next separate card.
