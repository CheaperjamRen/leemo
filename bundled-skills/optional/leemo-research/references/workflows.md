# Workflow router and contracts

Choose the smallest workflow that produces the user's actual outcome. Do not run a full pipeline for a narrow reading, editing, or analysis task.

## Router

| User outcome | Mode | Usually active stages |
|---|---|---|
| Turn a broad interest into a feasible question | `scope` | intake → scope → review |
| Find and synthesize a body of literature | `literature-review` | scope → protocol → collect → extract → synthesize → review → package |
| Understand one or several papers | `paper-reading` | collect → extract → synthesize → review |
| Design, diagnose, or audit an experiment | `experiment` | scope → protocol → produce → review |
| Analyze data or make evidence-linked figures | `analysis-figure` | protocol → produce → review → package |
| Draft, revise, translate, or polish academic text | `writing` | extract → synthesize → produce → review |
| Review a draft or answer reviewers | `peer-review` | extract → review → produce → package |
| Distill a scholar's public methods | `scholar-method` | protocol → collect → extract → synthesize → review |
| Coordinate an end-to-end project | `full-pipeline` | all necessary stages |

If two modes share evidence, use one project workspace and one set of ledgers. Do not create competing source-of-truth files.

## `scope`

- Entry: broad topic, uncertain direction, or a request for an opening proposal.
- Minimum input: desired deliverable plus enough context to identify one decision-changing unknown.
- Work: map candidate questions to contribution, evidence access, minimum study, cost, ethics, and failure risk. Separate observed gaps from hypothesized gaps.
- Checkpoint: user confirms the question or explicitly delegates the choice after seeing tradeoffs.
- Output: confirmed question, candidate hypotheses, feasibility note, minimum evidence plan, and rejected alternatives with reasons.
- Stop: do not invent a theory, scale, sample size, mediator, moderator, or expected result merely to make the proposal look complete.

Formal-artifact gate: before drafting, check `research object`, `disciplinary frame`, `claim type`, `feasible evidence/data`, and `method route`. Any route-changing unknown means the gate fails. On failure, ask exactly one question that best separates the routes. Before the answer, do not create/export a proposal, DOCX, PDF, or presentation and do not call anything supervisor-ready. The maximum response is: supplied facts, two or three genuinely different routes with tradeoffs, unknown fields, and the one requested decision. Do not fill routes with project-specific theories, hypotheses, variables, samples, methods, expected results, schedules, or citations.

Urgency and “do not ask questions” change the response length, not this gate. A field may become project-specific only when it is user-provided, source-verified, computed from authorized project material, or explicitly delegated after the user sees material alternatives.

For material work, write the intended deliverable and five field states/bases to `project-state.json`, then run the validator before creating any proposal-shaped file. A failed check keeps the task in `scope`; it does not authorize a “provisional proposal” with assumptions and later caveats.

## `literature-review`

First select the review type:

- Narrative: explanatory synthesis; still requires traceable sources and search boundaries.
- Scoping: maps concepts, methods, and gaps; broad inclusion and explicit coverage limits.
- Systematic: protocol, source/date/search strings, duplicate handling, two-pass screening, exclusion reasons, and flow counts are mandatory.

Contract:

1. Lock the question, review type, date range, languages, source types, and inclusion/exclusion criteria.
2. Save every executed query, database/site, timestamp, and raw result count. A proposed query is not an executed search.
3. Deduplicate records without losing identifiers or provenance.
4. Screen title/abstract, then full text when required; retain exclusion reasons.
5. Retrieve only lawful open-access, user-provided, or otherwise authorized full text.
6. Extract evidence at a retrievable location. Title or metadata alone cannot support a substantive claim.
7. Synthesize by question, method, mechanism, population, evidence pattern, disagreement, and boundary—not one paragraph per paper.
8. Generate prose from `evidence-table.csv` and `claim-ledger.csv`, not model memory.
9. Diagnose conflicting findings through population, construct, design, measure, period, analysis, and bias differences before declaring a gap.

If only study type, sample size, and headline result are supplied, distinguish relative identification potential from verified validity. Match each design to the question it can answer, state that methods/results remain unverified, and keep conclusions within the reported sample/context. Do not let a larger cross-sectional sample outvote a randomized design, or let the word “randomized” erase unknown execution and measurement quality.

Minimum outputs: search protocol, source ledger, screening record, evidence table, claim ledger, synthesis, limitations, and coverage statement. PRISMA-style counts must come from actual records; otherwise provide a visibly blank template.

Before the first executed query, record PRISMA/flow status as `NOT_STARTED` and show no numeric counts, including zero. A numeric zero requires a logged executed search that actually returned zero records.

Hard stop: a partial factual synthesis may use only a fully gated source/evidence/claim subset, must be labelled `PARTIAL_EVIDENCE_SYNTHESIS`, and must exclude unresolved candidates from its body and bibliography. Without that subset, stop at an outline/protocol/queue. A final, submittable, comprehensive, verified, or traceable review additionally requires completed declared coverage and real screening counts. Search snippets, abstracts, broad web results, model memory, and clickable DOI strings remain discovery/metadata-level.

If the topic itself is missing, ask only for the topic/research question. Use labelled defaults for other reversible fields (for example date/language coverage) and refine them later; do not ask for topic, PICO, years, languages, and databases in one batch.

## `paper-reading`

For each paper capture:

- identity and stable locator;
- research question and claimed contribution;
- actual method, data/sample, comparators, metrics, and key settings;
- results with page/table/figure anchors;
- author-stated limitations and independently identified limitations;
- reproducibility information: code, data, preprocessing, seeds, and missing details;
- relevance to the user's question and one transferable lesson written independently.

Use additional reviewer lenses only when useful: skeptical reviewer, competing researcher, adjacent-field reader, and reproducibility auditor. Label criticism as analysis, not as the author's or a named scholar's opinion.

## `experiment`

Choose one of two routes:

- System audit: use when failures may come from architecture, assumptions, or interactions across components.
- Component diagnosis: use when the system direction is sound and a bounded component has enough success/failure evidence.

Required context: objective, architecture/component, design assumptions, current results, success and failure cases, historical attempts, constraints, and available data/code.

For each proposed change provide: suspected mechanism, supporting observation, counterevidence, exact intervention, expected measurable change, implementation cost, confounders, stop condition, and rollback. Prefer a small discriminating test over a bundle of tweaks.

Record every analysis in `experiment-log.md`. Never relabel post-hoc analysis as prespecified, remove outliers without an objective rule, or select outcomes/methods because they cross a significance threshold.

When only an isolated statistic is supplied, stop before proposing named analyses or drafting results. Preserve the exact fact and materials, state the missing design/analysis facts, and ask once for the complete original output. Method diagnosis begins only after that gate passes.

## `analysis-figure`

Before analysis, record variable definitions, missingness, exclusions, estimand, assumptions, primary outcome, multiplicity, and planned sensitivity analyses. Report effect sizes and uncertainty, not only thresholds.

Before drawing, create a figure contract:

- claim the figure may support;
- source data and transformation code;
- panel purpose, axes, units, sample size, uncertainty, and statistical annotation;
- distinction between data figures, conceptual diagrams, and illustrative graphics;
- editable and publication outputs.

A figure may communicate evidence; it may not create evidence or hide negative results.

## `writing`

Inputs must distinguish verified facts, user results, source-supported interpretations, and open placeholders. Build an outline around claims and evidence. For each material sentence, update the claim ledger or keep it explicitly provisional.

Revision may improve logic, clarity, structure, terminology, and hedging. It may not add invented data/citations, conceal borrowed expression, promise acceptance, or optimize for detector evasion. Preserve an author decision trail for substantive changes.

For proposals, the formal-artifact gate precedes document formatting. For literature-based prose, build an argument map of conclusion → claims → evidence/counterevidence → warrant → boundary before paragraphs. A cover page, methods table, numbered hypothesis, timeline, or bibliography cannot turn an unknown choice into an apparent decision.

## `peer-review`

Audit scope, novelty evidence, method validity, statistical interpretation, reproducibility, claim support, figures, writing, and compliance. Separate critical, major, minor, and optional items. AI review is preparation, not official peer review.

For reviewer response, create a matrix with comment, interpretation, planned action, changed artifact/location, evidence, response text, and unresolved disagreement. Do not claim a change before it exists.

## `scholar-method`

Disambiguate identity before collection. Build a paper matrix and evidence index from public work. Label outputs as direct public evidence, coauthored-work evidence, cross-paper pattern, target-paper fact, method inference, independent analysis, or insufficient evidence.

Never impersonate the scholar, claim access to private views, or present an inferred framework as that person's actual advice. If evidence is sparse, produce a provisional method profile instead of a persona.

## `full-pipeline`

Compose the contracts above with the modular lifecycle in `research-lifecycle.md`. Lock only load-bearing decisions; keep reversible choices moving. At every stage record input, action, artifact, gate result, and next stage. Run an independent review before packaging.
