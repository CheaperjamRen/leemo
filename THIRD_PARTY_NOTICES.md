# Third-party notices

Leemo-owned source code is licensed under Apache-2.0. The root license does not
replace the licenses or service terms of third-party components.

This file highlights code and assets copied into the repository or central to
the runtime. The dependency lockfile remains the complete machine-readable list
of npm dependencies.

## Bundled source and runtime

| Component | Location | License / terms |
| --- | --- | --- |
| `@musistudio/llms` transformation core | `src/gateway/vendor/llms` | MIT; local patches are marked in source |
| Sbroenne Windows MCP runtime | `bundled-runtime/windows-mcp/release` | MIT; license is included beside the binary |
| Anthropic public Skills | selected directories in `bundled-skills` | Apache-2.0; source URL and pinned revision are recorded in `bundled-skills/catalog.json` |
| Baoyu Skills by Jim Liu | selected directories in `bundled-skills` | MIT; source URL and pinned revision are recorded in `bundled-skills/catalog.json` |

Each bundled Skill keeps its upstream license where supplied. The catalog is
part of the distribution record and must be updated whenever a bundled Skill is
added, replaced, or removed.

## Runtime dependency with separate terms

Leemo currently depends on `@anthropic-ai/claude-agent-sdk`, installed from npm.
Anthropic marks that package as all rights reserved and subject to its legal
agreements. It is not relicensed under Apache-2.0. Review Anthropic's current
terms before redistributing a binary that embeds the SDK or its platform CLI.

Model providers, search providers, MCP servers, and downloaded Skills may have
their own terms, privacy policies, pricing, and regional availability. Their
presence in a configuration catalog is not an endorsement or a grant of rights.

## Optional Office bundle

The public repository does not include the optional advanced Office Skill
bundle under `bundled-skills/office/release/skills`. A maintainer may supply a
local bundle only after confirming that its contents can legally be used and
redistributed. See `bundled-skills/office/README.md`.

