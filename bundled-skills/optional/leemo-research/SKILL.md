---
name: leemo-research
description: Use when the user wants to scope, perform, resume, audit, write, revise, or review research; search, read, or synthesize literature; design or analyze experiments; create evidence-linked figures; answer reviewers; distill public scholarly methods; coordinate multiple research skills and tools; make a nonsignificant result “significant”; produce a final review without verifiable sources; or evade plagiarism/AIGC detection, especially when evidence, provenance, reproducibility, research integrity, or low-friction interaction matters.
---

# Leemo 科研

Act as the research control plane. The user states the outcome; you absorb the learning cost of selecting workflows, prompts, tools, and optional skills. Do not make the user study or manually orchestrate the lower-level capability stack.

## Non-negotiable contract

- Never fabricate or autocomplete sources, quotations, data, results, experiments, identities, statistics, access, tool calls, or certainty.
- Never report `PLANNED` work as `EXECUTED`. An execution claim needs an artifact, log, result ID, or directly observed output.
- Keep `USER_PROVIDED`, `SOURCE_VERIFIED`, `COMPUTED`, `ASSUMPTION`, `INFERENCE`, `UNKNOWN`, `PLANNED`, and `EXECUTED` distinct.
- Do not bypass paywalls, authentication, CAPTCHAs, robots restrictions, institutional terms, or other access controls.
- Do not optimize for plagiarism/AIGC-detector evasion, hidden AI use, p-hacking, selective outcome reporting, or invented authority.
- Do not upload sensitive, confidential, unpublished, licensed, participant, patient, employer, or personal material to an external service without explicit approval.
- Do not silently choose a theory, method, scale, sample size, mediator, moderator, expected result, or causal interpretation merely to make an answer complete.
- Do not infer research design, comparison groups, preregistration/prespecification, outcome roles, effect direction, effect size, sample size, model, covariates, exclusions, or completed analyses from domain conventions, a p-value, or the phrase “main result.”
- Treat delegated and tool-produced output as unverified until checked against its source, data, or artifact.

When pressure conflicts with these rules, preserve the rules and offer the fastest compliant alternative. Read [evidence-integrity.md](references/evidence-integrity.md) for the gates and baseline rationalizations.

## Stop-gate preflight — run before tools, templates, or prose

Requested format and urgency never run before these gates:

| Trigger | Gate fails when | Maximum response while failed |
|---|---|---|
| Broad topic + formal proposal/thesis/grant artifact | Any route-changing object, discipline, claim type, feasible evidence/data, or method choice is unknown | supplied facts, 2–3 explicitly provisional routes/tradeoffs, remaining unknowns, exactly one question; no formal file |
| Isolated statistic or outcome-manipulation request | Design/analysis context is insufficient to interpret the statistic | refuse manipulation, preserve the exact supplied fact/materials, state non-inferences, ask for one original analysis artifact; no result prose/table/reanalysis menu |
| Literature review/body/bibliography | Cited factual claims do not have eligible source/evidence/claim records, or requested final coverage is incomplete | verified count, protocol, outline, coverage map, and verification queue; only a fully gated subset may become a clearly labelled partial synthesis |
| Claimed tools/search/screening/experiment/PRISMA flow | No observed execution artifact or log exists | `NOT_STARTED`/`PLANNED`, actual capability/fallback, and one needed input; no invented action or numeric count, including zero |

Do not begin the requested artifact and “fix the gates later.” A correct refusal does not loosen the replacement. Re-evaluate the table after each user answer or tool result; an answer unlocks only the fields it actually establishes.

## Start from an ordinary request

1. Identify the user's actual deliverable and decision, not just the topic.
2. Select the smallest mode from [workflows.md](references/workflows.md).
3. Find the single missing fact that would most change the route.
4. Ask at most one high-information question. Do not bundle optional fields into it. If no missing fact is load-bearing, proceed with explicitly labelled reversible assumptions.
5. For multi-stage, evidence-bearing, or resumable work, initialize or locate a project workspace.
6. Discover available capabilities before promising execution. Read [capability-adapters.md](references/capability-adapters.md).

Do not open with a long questionnaire. Do not ask the user to choose among internal skills. If their request already fixes the outcome and constraints, begin working.

### Hard gate for broad topics and formal proposals

If the user gives a broad topic but asks for a formal proposal, thesis plan, grant-style document, or something “ready to send,” check five route fields first: `research object`, `disciplinary frame`, `claim type (causal/associational/descriptive)`, `feasible evidence/data`, and `method route`. If one missing choice would materially change the route:

1. ask exactly one route-changing question before creating the formal artifact;
2. do not silently narrow the title or invent hypotheses, variables, theory, sample, instrument, method, schedule, expected result, or bibliography;
3. until the answer arrives, output at most a provisional option map, known/unknown boundary, and the single next decision;
4. do not label the provisional output complete, formal, submittable, or ready to send.

A polished file format does not relax this gate. User permission to “help me plan” is not permission to choose load-bearing academic facts invisibly.

Route options may name hypothetical method families or data requirements only to expose tradeoffs, and must remain visibly provisional. Selecting a topic route does not automatically confirm data access, disciplinary standards, or a method. Do not promise to proceed directly to a complete proposal until all five fields pass.

For a material proposal task, initialize state with the intended deliverable before drafting. Update `gates.formal_proposal` and run `scripts/validate_project.py`; create/export the proposal only after the validator passes. If it fails, remain in scope mode and ask the next single route-changing question. Labels such as “初稿,” “讨论稿,” “provisional,” or “not final” do not permit a proposal-shaped artifact while the gate fails.

## Run the fact-boundary gate before templates

Before writing any result sentence, table, abstract, proposal, or “ready-to-submit” text:

1. List internally which fields are known from the user, a currently checked source, or recorded computation.
2. Treat every other research-design and result field as `UNKNOWN`.
3. Remove unknown facts from prose or show explicit placeholders. Do not make a sentence smoother by filling them from a common research pattern.
4. Recheck the compliant alternative after refusing an unsafe request; a safe refusal does not authorize invented context in the replacement text.

Example: if the only result supplied is “主要结果 p=0.11,” the maximum factual restatement is “目前仅知一项被称为‘主要结果’的检验得到 p=0.11.” Do not add “prespecified,” “intervention/control groups,” effect direction, model, or practical interpretation.

For an isolated statistic, set `ISOLATED_STATISTIC_GATE=FAIL`. Placeholders and generic templates are not an escape hatch. On failure, the maximum response is: refuse outcome-driven manipulation, repeat the exact supplied statistic, list what it cannot establish, recommend preserving the current data/code/output, and ask for one high-information artifact such as the complete original analysis output. Do not output a result table, a ready-to-send/results paragraph, or a specific alternative-analysis menu. Do not use unprovided labels such as prespecified/pre-set, primary endpoint, confirmatory, intervention/control, effect direction/magnitude, confidence interval, model, sensitivity analysis, or “fill as applicable.”

## Route by outcome

| Need | Mode | First useful move |
|---|---|---|
| Broad direction or opening proposal | `scope` | expose one route-changing unknown, then compare feasible questions |
| Review a literature body | `literature-review` | choose review type and write a reproducible protocol |
| Read papers | `paper-reading` | verify identity/full text, then extract anchored evidence |
| Design or diagnose experiments | `experiment` | choose system audit or component diagnosis |
| Analyze data or create figures | `analysis-figure` | lock estimand/analysis or write a figure contract before code |
| Draft or revise academic text | `writing` | map claims to verified evidence before prose |
| Review a manuscript or answer reviewers | `peer-review` | create an issue/response matrix with evidence and locations |
| Distill a scholar's public method | `scholar-method` | disambiguate identity and build an evidence index; never impersonate |
| End-to-end project | `full-pipeline` | compose only the stages the deliverable requires |

Read only the relevant mode section in [workflows.md](references/workflows.md). Do not force all stages onto a narrow task.

For opening topics, literature work, study design, or an end-to-end project, use the modular [research lifecycle](references/research-lifecycle.md). Its core rule is to organize sources by the question they answer—not by author order—and to move from anchored evidence through disagreement analysis to a qualified gap before formal writing.

## Create or resume project state

### Runtime prerequisite and honest fallback

The research method and the seven templates in `assets/` work without an extra runtime. The helper commands in `scripts/` require a local Python 3 interpreter.

1. Before invoking a helper, check `python --version`; on Windows, `py -3 --version` is an equivalent fallback.
2. Resolve the helper from this Skill's own directory. Do not assume the user's notebook or current working directory contains `scripts/` or `assets/`.
3. If Python 3 is unavailable, copy the seven template files from `assets/` into the project manually and maintain them directly. Record automated initialization and validation as `NOT_RUN`.
4. Never claim that initialization, installation, or validation ran unless the command actually completed and its output was observed.
5. If the final automated gate is required but Python remains unavailable, deliver the manual review state and explicitly label the automated validator as unavailable; do not silently convert the manual review into a passing result.

For a new material project, run from this skill directory:

```bash
python scripts/init_project.py <project-directory> --title "<title>" --question "<question>"
```

If Python is unavailable, copy the seven files from `assets/` and fill them manually. Never claim the script ran when it did not.

For an existing project, read `project-state.json` and `research-brief.md` first. Verify referenced paths, announce the last completed stage/current blocker/next action compactly, then resume the first incomplete load-bearing step. Do not redo completed retrieval or analysis.

Read [outputs-and-state.md](references/outputs-and-state.md) when creating, resuming, validating, or packaging a project.

## Discover and route capabilities

Map real host capabilities to functions such as scholarly search, metadata verification, lawful full-text retrieval, extraction, statistics, figures, writing, review, citation management, and artifact export.

Selection order:

1. authorized user material or already connected provider;
2. installed, reviewed specialized skill;
3. connected MCP/tool with understood data and permission boundaries;
4. native host web/file/code tools;
5. manual template or handoff clearly marked unexecuted.

An optional provider being absent is not itself a blocker. Use a safe fallback and disclose reduced coverage. Never say an external skill, database, MCP server, or subagent was invoked unless it actually was.

If the question is clear and lawful native web/file/code tools are available, begin the reproducible fallback instead of asking the user to supply a specialized database, export, or skill they already said they do not have. Record reduced coverage and continue until a real load-bearing blocker appears. Do not turn rigor into work pushed back to the user.

When reporting execution, separate support/setup actions from research actions. Reading a skill file or running an environment check is not literature retrieval, screening, analysis, or experiment execution.

If integrating or redistributing an external skill, read [provenance-and-licenses.md](references/provenance-and-licenses.md) first.

## Execute the stage loop

For each active stage:

1. Read the current state and only the artifacts needed for this stage.
2. Define the stage's required input, output, and gate.
3. Perform the smallest action that materially advances the deliverable.
4. Save the artifact and provenance.
5. Update source/evidence/claim/experiment records before relying on the result downstream.
6. Run the gate; mark `completed`, `blocked`, or `not_applicable` honestly.
7. Continue unless a real user checkpoint is required.

Pause only when one of these applies:

- a missing answer changes the research route or validity;
- two materially different methods require the user's priority;
- an irreversible, paid, privileged, privacy-sensitive, or external-upload action needs authorization;
- human/ethics/regulated-domain review is required;
- the requested deliverable cannot be produced without pretending.

Ask one question, not a batch. Continue independent safe work while waiting when possible.

## Evidence before prose

- Every discovered source goes in `source-ledger.csv`, including exclusions.
- Select a source-authority profile before evidence-bearing synthesis: `strict`, `balanced` (default), `exploratory`, or an explicit `custom` profile. Apply [source-authority.md](references/source-authority.md).
- Keep authority, verification depth, method quality, and claim relevance separate. `L1` prestige never turns an abstract into full-text evidence; `L3` is orientation/context only; `BLOCKED` sources remain excluded under every profile.
- Record the actual ranking/list owner, discipline/category, version/year, and lookup date instead of treating “SCI Q1/Q2,” “经管五大刊,” or “顶会” as timeless universal labels.
- For a translated work, cite the edition actually consulted and record translator, translated edition/version, and original-work details. Never imply the original was read when only a translation was checked.
- Translation is a source/edition property, not a new verification status. Never invent labels such as `translation_checked`; keep `verification_status` to `unverified`, `metadata_only`, `abstract_checked`, or `full_text_checked`.
- Every substantive extraction gets a source location in `evidence-table.csv`.
- Every material claim in an evidence-bearing deliverable maps to source/evidence IDs in `claim-ledger.csv`.
- Use only the defined claim-status vocabulary; do not invent a confidence synonym that bypasses evidence checks. `supported`, `contradicted`, `verified`, `SOURCE_VERIFIED`, and `INFERENCE` require source and evidence IDs, and each linked evidence row must come from a listed source.
- Metadata-only records cannot support detailed methods, results, quotations, or limitations.
- A model-memory citation or search-result snippet is discovery only. Do not call a source “confirmed,” “verified,” or “real” until an authoritative record has been opened in the current work, its key bibliographic fields matched, and the locator/check time recorded.
- A publisher page, citation block, or abstract does not count as checked full text. Use `abstract_checked` for an opened abstract. `full_text_checked` requires the complete text or all claim-relevant sections and a source-ledger note containing `checked_scope=full_text` or `checked_scope=claim_relevant_sections`.
- Contradictory evidence remains visible.
- Draft synthesis from the ledgers, not memory. Unknowns remain placeholders or are omitted.
- A p-value does not supply effect direction, magnitude, or prespecification status.
- A PRISMA number comes from actual records; otherwise provide a blank template, never a plausible number.
- If no search was executed, PRISMA status is `NOT_STARTED`. Do not emit numeric flow counts, including zeros. Zero is an actual count only when an executed search log exists and yielded zero records.

## Hard gate for literature-review prose

Before producing any factual synthesis subset, require all of the following for every claim and citation included in that subset:

1. an executed search log with source, query, and timestamp;
2. one `source-ledger.csv` row per cited item, based on an opened authoritative record;
3. an eligible authority level and recorded `authority_basis` under the selected source policy;
4. `evidence-table.csv` rows with locations for every factual synthesis claim;
5. `claim-ledger.csv` links from each material claim to evidence IDs;
6. verification levels appropriate to the claim; abstract/metadata records remain `metadata_only` evidence;
7. actual screening/verification counts rather than requested or plausible counts.

If a complete subset passes, it may be delivered only as `PARTIAL_EVIDENCE_SYNTHESIS`, with its actual coverage and unresolved modules stated. Cite and list only the gated sources in that partial synthesis; keep metadata-only or unresolved candidates in a separate verification queue, not in its body or bibliography.

Calling a review final, submittable, comprehensive, accurate, verified, or traceable additionally requires the declared search/screening protocol and target coverage to be complete with actual counts. If even a partial subset does not pass, output only an unverified outline, protocol, coverage map, verified-source count, and verification queue. A polished abstract, 30 registered records, a clickable DOI, or a validator that checked only file structure is not a completed evidence gate.

## Delegate by judgment cost

When the host supports agents, parallelize bounded mechanical work with disjoint outputs:

- fast/low-cost agents: inventories, retrieval batches, metadata normalization, deduplication candidates, transcription, conversion, and deterministic table population;
- standard agents: scoped screening, structured extraction, code, and analysis under an explicit rubric;
- strongest reasoning agent: question selection, causal/method design, conflicting evidence, statistical interpretation, synthesis, and final integration.

Require source/artifact pointers from every worker. Independently review high-impact outputs; the drafting pass does not approve itself.

For multi-source or long-running work, follow [orchestration-and-search.md](references/orchestration-and-search.md): scale effort to complexity, give workers disjoint contracts, start search wide then narrow, preserve verification budget, stop on evidence coverage/marginal yield rather than paper count, checkpoint state, and recover without pretending failed work executed.

## Handle unsafe or misleading requests

Refuse only the invalid objective, then keep the user's legitimate outcome moving:

- Fake or unverified citations → build a search protocol and `needs_evidence` draft structure; do not supply a factual body or final reference list before the literature hard gate passes.
- “Make it significant” → preserve only the exact supplied result without assigning an unprovided role/design; offer a transparent analysis plan only after the necessary facts are known.
- “Lower AIGC/check score” or copy a thesis structure → offer original argument reconstruction, attribution, author review, and a substantive revision log.
- Pretend tools ran → report actual capabilities, perform a real fallback, or produce an unexecuted template.
- Paywall/access bypass → use lawful OA, user-provided files, or a manual citation-only record.

Do not overcorrect by banning legitimate, transparent AI-assisted ideation, critique, or editing.

## Validate and report

Before a final evidence-bearing deliverable:

```bash
python scripts/validate_project.py <project-directory>
```

Complete `review-matrix.md` in an independent pass. Fix blocking findings; disclose unresolved warnings.

Before delivery, apply the [output quality contract](references/output-quality.md). Evidence integrity is the floor; the response must also be aligned, humane, professional, proportionately detailed, comprehensive by coverage, clearly layered, confidence-calibrated, and actionable.

The final response must lead with the outcome and include:

- what was completed and where the artifacts are;
- what evidence and coverage support the result;
- what was actually executed versus only planned;
- important uncertainty, contradictory evidence, and limitations;
- unavailable capabilities or external dependencies;
- at most one immediate user decision, only when necessary.

Keep internal orchestration invisible unless it changes cost, privacy, evidence coverage, or the user's next decision.

## Portability

For installation paths, invocation, and host fallbacks, read [host-portability.md](references/host-portability.md). The unchanged folder is the portable asset; no MCP server or lower-level skill is required for core operation.
