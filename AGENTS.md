# Leemo engineering guide

Leemo is a general desktop AI agent with two product surfaces: the `momo`
companion and the local workbench. Learning and job-search experiences build on
the same execution, workspace, memory, and permission layers; they must not fork
into a weaker second agent.

## Product invariants

- Use user-facing language. Do not expose Claude Code implementation names,
  model aliases, environment variables, or internal protocol terms in normal UI.
- A notebook is a real local folder. Its conversations, files, and governed
  memory move with it. Global momo remains outside any single notebook.
- momo may have an opinion, but must not reinterpret or refuse an ordinary user
  task. Genuine safety, permission, capability, and technical limits stay clear.
- Settings and runtime behavior must share one semantic source. New tools join a
  capability class instead of accumulating one-off permission exceptions.
- Credentials stay in the main process and must never cross IPC or enter logs.
- A feature is complete only after its visible user path, failure state, and
  restart recovery are verified in proportion to risk.

## Development

Requirements: Windows, Node.js 20 or newer, and npm.

```bash
npm ci
npm run electron:dev
```

Before a pull request:

```bash
npm run typecheck
npm test
npm run verify:bundled-skills
npm run build
npm run build:main
```

Use focused tests while iterating. Keep edits scoped, prefer existing typed IPC
and store patterns, and do not create tiny modules unless they remove real
complexity. Never commit `.env`, personal paths, generated screenshots, unpacked
applications, model credentials, or private skill bundles.

## Packaging

`npm run electron:pack` builds the public base edition. An optional advanced
Office bundle can be supplied locally under `bundled-skills/office/release`, but
that directory is ignored and is not part of the open-source repository. See
[`bundled-skills/office/README.md`](./bundled-skills/office/README.md).
