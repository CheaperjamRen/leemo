# Leemo contributor notes

The project-wide development rules live in [`AGENTS.md`](./AGENTS.md). Read it
before changing product behavior, provider routing, permissions, persistence,
or release packaging.

Common checks:

```bash
npm run typecheck
npm test
npm run build
npm run build:main
```

Never commit credentials, local workspaces, generated audit evidence, or
optional third-party bundles that are not licensed for redistribution.
