# Global Pending Overview Verification — 2026-08-18

## Scope

This verification covers the top-level `开始` surface, the persisted global pending-overview snapshot, manual and opt-in daily generation boundaries, source navigation, failure preservation, responsive navigation, standalone usage accounting, and the no-tool one-shot inference boundary.

Visual authority: `docs/design-audition/visual-redesign/start-static-workspace-v2.png` and `docs/design-audition/visual-redesign/start-static-workspace/design.md`.

## Deterministic renderer journey

Command:

```powershell
node scripts/verify-global-pending-overview.mjs
```

Fresh result:

- four approved cards render at 1440×900 with no vertical overflow;
- no composer is present on `开始`;
- a failed refresh keeps the previous snapshot and folds diagnostics;
- full board groups by real project and keeps uncertain sources collapsed;
- a source chip opens the real Todo view;
- reload restores the persisted snapshot;
- 960×680 uses a sidebar overlay and has no horizontal overflow;
- browser console errors: 0.

Evidence:

- `.tmp-visual-audit/global-pending-overview/start-populated-1440x900.png`
- `.tmp-visual-audit/global-pending-overview/start-failed-keeps-snapshot-1440x900.png`
- `.tmp-visual-audit/global-pending-overview/start-full-board-1440x900.png`
- `.tmp-visual-audit/global-pending-overview/start-populated-960x680.png`
- `.tmp-visual-audit/global-pending-overview/start-overlay-960x680.png`
- `.tmp-visual-audit/global-pending-overview/verification.json`

## Real Electron + SQLite restart journey

Commands:

```powershell
npm run build:main
node scripts/verify-global-pending-overview-electron.mjs
```

The script launches the current `dist-electron/main.mjs` with an isolated, validated one-level E2E root under the system temporary directory. It writes one conversation and one overview snapshot through the real preload persistence IPC, stops the full Electron process tree, relaunches against the same SQLite database, verifies the `开始` card, and opens the source into the real Workbench conversation. The isolated root is removed only after the owned Electron process tree stops.

Fresh result:

- real persistence IPC writes succeeded;
- `user-data/leemo.db` existed;
- restart restored the snapshot;
- the source action opened the persisted conversation;
- no AI composer appeared on `开始`.

Evidence:

- `.tmp-visual-audit/global-pending-overview/start-electron-restarted-1440x900.png`

## Semantic gates

- opening, browsing, navigating, editing settings and Todo interaction never invoke overview generation;
- only manual refresh or the explicitly enabled once-per-day foreground schedule invokes the model;
- scheduled refresh defaults off and records the local-day attempt before spending quota;
- model output cannot mutate or complete Todos, notes, runs, artifacts, notebooks or files;
- every accepted item references a Host-validated fact ID;
- provider credentials and raw upstream bodies never cross IPC;
- direct providers use no tools and `store: false` where supported;
- subscription runtimes use a fresh isolated directory, no MCP, no skills/plugins, no Web and denied approvals;
- any unexpected tool event aborts the one-shot result;
- standalone input/output/cache/cost usage is recorded and merged into the existing usage summary without creating a hidden conversation.
