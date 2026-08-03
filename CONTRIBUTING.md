# Contributing to Leemo

Thank you for helping improve Leemo. The most useful contributions are small,
testable changes that make a real desktop-agent journey more reliable or easier
to understand.

## Before opening a change

1. Search existing issues and pull requests.
2. For a bug, describe the visible user path, expected result, actual result,
   and whether the problem survives an app restart.
3. For a new product surface or changed user mental model, open an issue first.
   Provider fixes, focused accessibility fixes, and narrowly scoped bug fixes can
   usually go straight to a pull request.

## Local setup

Leemo is currently developed and release-tested on Windows.

```powershell
git clone https://github.com/CheaperjamRen/leemo.git
cd leemo
npm ci
npm run electron:dev
```

Use the in-app settings page for model credentials. Never commit `.env`, API
keys, local provider secrets, private files, or screenshots containing user
data.

## Pull requests

- Keep one user-facing outcome per pull request.
- Add or update focused tests for bridge, persistence, permission, provider, and
  store behavior.
- Reuse the existing typed IPC, store, and capability-registry patterns.
- Describe both the successful path and meaningful failure behavior.
- Include a screenshot for visible UI changes and verify a narrow supported
  viewport as well as a normal desktop viewport.
- Do not add third-party code, binaries, or Skills without a clear source,
  revision, and redistribution-compatible license.

Run these checks before submitting:

```powershell
npm run typecheck
npm test
npm run verify:bundled-skills
npm run build
npm run build:main
```

`npm run electron:pack` is recommended for changes to Electron startup,
packaging, native runtime resolution, or bundled resources.

## Product language

The public concepts are **momo**, **搭子 / companion**, **工作台 / workbench**,
**本子 / notebook**, **成果 / artifacts**, **Skills**, and **MCP**. Do not expose
Claude Code aliases, internal environment-variable names, or compatibility
plumbing as a normal user workflow.

Please also read [`AGENTS.md`](AGENTS.md) for the product invariants that apply to
human and AI-assisted contributions.

