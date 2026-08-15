# Native Visualization MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Leemo's existing visualization surface a real production capability that creates durable, safe workspace artifacts from structured data.

**Architecture:** A renderer-safe shared schema defines five bounded visualization kinds. A first-party in-process MCP validates the structured input, renders a static standalone HTML file locally, and writes it atomically inside the active workspace; the conversation renders the same structured input as native React instead of executing model-authored HTML.

**Tech Stack:** TypeScript, Zod, Claude Agent SDK in-process MCP, React, Vitest, Testing Library.

## Global Constraints

- The approved product scope is `docs/specs/02-已定决策清单.md` I9: table, flow, timeline, comparison, and chart are in scope; arbitrary interactive mini-apps are not.
- The tool accepts no raw HTML, JavaScript, CSS, URL, image, iframe, or executable code field.
- Generated artifacts stay inside the active workspace; a root-level relative path follows Leemo's existing default-workspace routing.
- `.leemo`, governed memory, traversal, wrong extensions, and silent overwrite fail without modifying a file.
- The result is a normal `.html` artifact that survives restart and opens through the existing preview and artifacts surfaces.
- The default `acceptEdits` mode treats this as a file edit; stricter modes may ask, and the filesystem boundary remains authoritative.
- The timeline card must be native React and useful at 1024 px; previewed HTML runs with scripts and network disabled.
- Do not modify or stage `bundled-skills/office/**`.

---

### Task 1: Structured Visualization Contract and Static Renderer

**Files:**
- Create: `src/bridge/visualization-spec.ts`
- Create: `src/host/visualization-renderer.ts`
- Test: `tests/bridge/visualization-spec.test.ts`
- Test: `tests/host/visualization-renderer.test.ts`

**Interfaces:**
- Produces: `VisualizationInput`, `visualizationInputSchema`, `parseVisualizationInput(input)`, `LEEMO_VISUALIZATION_TOOL_NAME`.
- Produces: `renderVisualizationHtml(input: VisualizationInput): string`.

- [x] **Step 1: Write failing schema tests**

```ts
expect(parseVisualizationInput({
  file_path: "复习进度.html",
  title: "本周复习",
  visualization: { kind: "bar", values: [{ label: "阅读", value: 4 }] },
})).toMatchObject({ visualization: { kind: "bar" } });
expect(parseVisualizationInput({
  file_path: "unsafe.html",
  title: "危险输入",
  html: "<script>alert(1)</script>",
})).toBeNull();
```

- [x] **Step 2: Run the schema tests and verify RED**

Run: `npm test -- tests/bridge/visualization-spec.test.ts`

Expected: FAIL because `visualization-spec.ts` does not exist.

- [x] **Step 3: Implement the discriminated Zod schema**

Implement bounded variants for:

```ts
type VisualizationData =
  | { kind: "table" | "comparison"; columns: string[]; rows: { cells: Array<string | number> }[] }
  | { kind: "timeline"; events: { label: string; date?: string; detail?: string }[] }
  | { kind: "flow"; steps: { label: string; detail?: string }[] }
  | { kind: "bar"; values: { label: string; value: number }[]; unit?: string };
```

Use 160 characters for title/labels, 500 for details/cells, 2-8 columns, 1-100 rows, 2-30 timeline events, 2-20 flow steps, and 1-20 bars. Use `.strict()` at every object boundary so raw HTML or unknown executable fields are rejected.

- [x] **Step 4: Write failing renderer tests**

```ts
const html = renderVisualizationHtml(validInput);
expect(html).toContain("<!doctype html>");
expect(html).toContain("Content-Security-Policy");
expect(html).not.toContain("<script");
expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
```

- [x] **Step 5: Run renderer tests and verify RED**

Run: `npm test -- tests/host/visualization-renderer.test.ts`

Expected: FAIL because the renderer does not exist.

- [x] **Step 6: Implement a pure escaped static renderer**

Render a standalone UTF-8 HTML document with an inline CSP of `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:;`. Escape every model-supplied string and generate only fixed Leemo-owned markup and CSS for the five approved kinds.

- [x] **Step 7: Run Task 1 tests**

Run: `npm test -- tests/bridge/visualization-spec.test.ts tests/host/visualization-renderer.test.ts`

Expected: PASS.

### Task 2: First-Party MCP and Workspace-Safe Persistence

**Files:**
- Create: `src/bridge/visualization-mcp.ts`
- Test: `tests/bridge/visualization-mcp.test.ts`

**Interfaces:**
- Consumes: `visualizationInputSchema`, `renderVisualizationHtml`, `resolvePathWithinBoundary`, `writeDocumentAtomically`.
- Produces: `createVisualizationMcp(options)` with `server` and `runCreateVisualization(input)`.

- [x] **Step 1: Write failing MCP tests**

Cover exact qualified name, successful creation, root routing into `默认工作区`, traversal, `.leemo/memory`, wrong extension, duplicate-without-overwrite, explicit overwrite, and injection text being escaped in the saved file.

```ts
const result = await visualizations.runCreateVisualization(input);
expect(result).toMatchObject({ isError: false, actualPath: expectedPath });
expect(fs.readFileSync(expectedPath, "utf8")).not.toContain("<script");
```

- [x] **Step 2: Run MCP tests and verify RED**

Run: `npm test -- tests/bridge/visualization-mcp.test.ts`

Expected: FAIL because `createVisualizationMcp` does not exist.

- [x] **Step 3: Implement the MCP**

Expose one `create_visualization` tool. Resolve `.html` paths inside `workspaceRoot`, route root writes through `routeRootWritePath`, reject governed memory, render the fixed document, and call the existing atomic writer. Return one lightweight Chinese receipt and never return the full HTML to the model.

- [x] **Step 4: Run Task 2 tests**

Run: `npm test -- tests/bridge/visualization-mcp.test.ts tests/host/document-engine.test.ts`

Expected: PASS with the existing atomic writer suite unchanged.

### Task 3: Production Host Registration and Permission Semantics

**Files:**
- Modify: `src/host/bridge-host.ts`
- Modify: `src/bridge/interact.ts`
- Modify: `src/renderer/bridge/tool-names.ts`
- Modify: `tests/host/bridge-host-mcp.test.ts`
- Modify: `tests/host/bridge-host.test.ts`
- Modify: `tests/bridge/interact.test.ts`

**Interfaces:**
- Consumes: `createVisualizationMcp` and `LEEMO_VISUALIZATION_TOOL_NAME`.
- Produces: reserved in-process server `leemo-visualization` in every conversation.

- [x] **Step 1: Write failing host and permission tests**

```ts
expect(host.inspect(conversationId)?.mcpServerNames).toContain("leemo-visualization");
await expect(decide(broker.canUseTool, LEEMO_VISUALIZATION_TOOL_NAME, input))
  .resolves.toMatchObject({ behavior: "allow" });
```

Also prove default mode classifies it as a moderate file mutation, `acceptEdits` allows it without a card, and an out-of-bound `file_path` is denied by the shared filesystem boundary.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- tests/host/bridge-host-mcp.test.ts tests/host/bridge-host.test.ts tests/bridge/interact.test.ts`

Expected: FAIL because the server and permission membership are absent.

- [x] **Step 3: Register the reserved MCP and edit category**

Instantiate it with the resolved conversation workspace and existing root-artifact routing. Reassign the reserved server key after configured MCPs so a hand-edited third-party config cannot impersonate it. Add the exact qualified tool to `MUTATING_TOOLS`, `EDIT_TOOLS`, and `FILESYSTEM_PATH_FIELDS`; do not classify it as a read-only always-allow capability.

- [x] **Step 4: Run Task 3 tests**

Run: `npm test -- tests/host/bridge-host-mcp.test.ts tests/host/bridge-host.test.ts tests/bridge/interact.test.ts`

Expected: PASS.

### Task 4: Native Timeline Card and Script-Free Preview

**Files:**
- Modify: `src/renderer/components/VisualizationCard.tsx`
- Modify: `src/renderer/components/VisualizationCard.test.tsx`
- Modify: `src/renderer/components/timeline/turnblock.test.tsx`
- Modify: `src/renderer/bridge/fixtures/index.ts`
- Modify: `src/renderer/utils/wrap-visualization-html.ts`
- Create: `src/renderer/utils/wrap-visualization-html.test.ts`
- Modify: `src/renderer/components/PreviewPane.tsx`

**Interfaces:**
- Consumes: `parseVisualizationInput` and the existing UI `openPreview` / `setView` actions.
- Produces: native views for all five visualization kinds and a script-free HTML preview wrapper.

- [x] **Step 1: Replace fixture expectations with failing structured-card tests**

Assert that a bar input renders labels and proportional bars without an iframe, table/comparison/timeline/flow inputs expose their content, invalid input renders nothing, and the existing preview/artifacts buttons target `file_path`.

- [x] **Step 2: Run component tests and verify RED**

Run: `npm test -- src/renderer/components/VisualizationCard.test.tsx src/renderer/components/timeline/turnblock.test.tsx`

Expected: FAIL because the component still requires raw `html` and renders an iframe.

- [x] **Step 3: Implement the native card**

Use fixed React markup, existing Leemo tokens, compact typography, stable row/step dimensions, and horizontal overflow only for genuinely wide tables. Keep running/error receipts lightweight and retain the two existing navigation actions.

- [x] **Step 4: Write and verify failing preview hardening tests**

```ts
const wrapped = wrapVisualizationHtml('<html><head><style>.x{color:red}</style></head><body><script>alert(1)</script><p>内容</p></body></html>');
expect(wrapped).toContain("script-src 'none'");
expect(wrapped).not.toContain("<script>alert(1)</script>");
expect(wrapped).toContain("<p>内容</p>");
```

Run: `npm test -- src/renderer/utils/wrap-visualization-html.test.ts`

Expected: FAIL because the current wrapper preserves scripts and allows execution.

- [x] **Step 5: Harden HTML preview**

Parse with `DOMParser`, retain body markup and inline style text, drop script and executable nodes, and emit Leemo's own CSP with `script-src 'none'`. Remove `allow-scripts` from both visualization and general HTML preview iframes.

- [x] **Step 6: Run Task 4 tests**

Run: `npm test -- src/renderer/components/VisualizationCard.test.tsx src/renderer/components/timeline/turnblock.test.tsx src/renderer/utils/wrap-visualization-html.test.ts`

Expected: PASS.

### Task 5: Integration, User-Path Verification, and Ledger

**Files:**
- Modify: `docs/sdd/r7-requirements-ledger.md`
- Modify: `docs/sdd/HANDOFF-r7-to-next-agent.md`

**Interfaces:**
- Consumes: the production MCP, workspace preview, artifacts index, and Electron runtime.
- Produces: truthful `Integrated` evidence; `Release-verified` remains false until an installer build is tested.

- [x] **Step 1: Run focused and full automated verification**

Run:

```powershell
npm test -- tests/bridge/visualization-spec.test.ts tests/host/visualization-renderer.test.ts tests/bridge/visualization-mcp.test.ts tests/bridge/interact.test.ts tests/host/bridge-host-mcp.test.ts src/renderer/components/VisualizationCard.test.tsx src/renderer/utils/wrap-visualization-html.test.ts
npm test
npm run typecheck
npm run build
npm run build:main
```

Expected: every command exits 0.

- [x] **Step 2: Verify the real Electron user path**

In an isolated Electron profile and temporary workspace, invoke the production in-process tool to create one visualization, then prove: the timeline card is native and readable at 1024x720; the file exists under the active workspace; preview opens; artifacts view indexes it; restart restores the file; script/network payloads cannot execute.

- [x] **Step 3: Record exact evidence and status**

Update the ledger and handoff with test counts, runtime paths checked, screenshot locations, remaining package-level gap, and no claim that arbitrary interactive apps exist.

- [ ] **Step 4: Review and commit only this card**

Run `git diff --check -- src tests docs`, inspect the staged name list, explicitly exclude `bundled-skills/office/**`, and commit with `feat: add native visualization artifacts`.
