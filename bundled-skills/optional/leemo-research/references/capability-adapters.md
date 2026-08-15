# Capability adapters and delegation

Leemo Research is the control plane. Optional skills, MCP servers, CLIs, APIs, databases, and local applications are capability providers. Never make the core workflow depend on a provider's brand name.

## Discover before promising

At the start of a material task:

1. Inspect the host's available skills, tools, commands, connected services, network limits, and local runtimes.
2. Map them to capability IDs below.
3. Record actual availability and constraints in `project-state.json`.
4. Select the smallest sufficient provider and name the fallback.
5. Invoke it only through its real interface. Record output paths, query IDs, or other execution evidence.

Do not tell the user to learn or choose among eleven skills. Ask about the research outcome; route internally.

## Capability registry

| Capability ID | Purpose | Native fallback when no adapter exists |
|---|---|---|
| `question-framing` | Turn an interest into testable questions | Structured reasoning plus `research-brief.md` |
| `scholarly-search` | Search structured literature sources | Browser/web search with saved queries and explicit coverage limits |
| `metadata-verify` | Check DOI, PMID, title, author, year, version | Publisher/registry pages checked individually; unresolved fields remain unknown |
| `fulltext-retrieve` | Obtain lawful full text | User files, OA repository, publisher OA page, or manual handoff |
| `document-extract` | Extract PDF/HTML/Office text and locations | Host document tools or manual anchored notes |
| `screen-dedupe` | Deduplicate and screen records | CSV ledger plus deterministic scripts/spreadsheet operations |
| `evidence-extract` | Build study/evidence records | `evidence-table.csv` with source locations |
| `statistics` | Design or run analysis | Local Python/R if available; otherwise a plan clearly marked unexecuted |
| `data-figure` | Generate evidence-linked plots | Local plotting tools; otherwise a figure contract |
| `concept-figure` | Create explanatory diagrams | Host diagram/image tools with an “illustrative” label |
| `academic-writing` | Draft from verified claims | Claim-ledger-driven native writing |
| `language-edit` | Edit language without changing evidence | Side-by-side native revision with reasons |
| `independent-review` | Challenge methods, claims, and artifacts | Fresh review pass using `review-matrix.md` |
| `citation-manager` | Read/write a citation library | RIS/BibTeX/CSV files; never fabricate a successful sync |
| `artifact-export` | Produce DOCX/PDF/PPTX/LaTeX/Markdown | Host-native file tools or a format-neutral Markdown handoff |

## Adapter selection order

Use this order unless project constraints justify another:

1. User-provided source/data and an already connected, authorized provider.
2. Installed specialized skill with compatible license and verifiable output.
3. Connected MCP/tool with understood authentication, data egress, and result schema.
4. Native host web/file/code tools.
5. A manual template or handoff that states what was not executed.

An unavailable adapter is not a blocker if a safe fallback can still satisfy the outcome. Degrade the claim and coverage, not the honesty.

When the user has already said a database/export/provider is unavailable, do not request it again as the only next step. If the research question is clear, execute the native public-web or user-file fallback, save the queries and coverage limits, and reserve the missing provider for an optional later upgrade. Stop only when no lawful source route can answer a load-bearing module.

## Optional aliases found in the source archive

The archived tutorials mention capability providers such as `scientific-brainstorming`, `nature-academic-search`, `literature-review`, `statistical-analysis`, `nature-figure`, `nature-writing`, `nature-polishing`, `nature-reviewer`, `nature-response`, and the ARS research/writing/reviewer workflows. Treat these as discoverable aliases only. Their presence, interface, license, dependencies, and actual execution must be verified in the current host.

Do not install a whole repository merely because one capability is needed. Prefer the smallest reviewed subset. Do not nest another full-pipeline orchestrator under Leemo Research without a clear boundary; use its atomic capability or treat it as a separate optional route.

## MCP adapter contract

MCP is optional. Before using an MCP server, record:

- server/tool identity and version;
- data source and coverage;
- authentication and permissions;
- data sent outside the local environment;
- cost/rate limits;
- input/output schema and stable identifiers;
- failure and fallback behavior.

MCP results enter the same source/evidence ledgers as native results. “Returned by a tool” does not mean “supports the claim.”

## Delegation policy

Delegate bounded, parallelizable, checkable work:

- Fast/low-cost agents: file inventory, metadata normalization, deduplication candidates, format conversion, transcription, table population, and deterministic checks.
- Standard agents: source screening, structured extraction, code changes, and scoped analysis when the rubric is explicit.
- Strongest reasoning agent: question selection, causal/method design, conflicting-evidence judgment, statistical interpretation, final synthesis, and integration review.

Give each agent a disjoint write scope, required inputs, output schema, and stop conditions. A delegated result is `UNVERIFIED` until checked against its source or artifact. Do not let the same pass both draft and independently approve a high-stakes result.
