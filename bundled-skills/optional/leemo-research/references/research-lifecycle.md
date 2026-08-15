# Research lifecycle: from a question to defensible work

Use this lifecycle as a modular spine, not a compulsory waterfall. Enter at the stage implied by the user's deliverable, reuse existing artifacts, and run only the downstream stages that are necessary.

## The evidence-to-argument spine

The central transformation is:

`topic → one-sentence question → question modules → source map → anchored evidence → disagreement analysis → qualified gap → study/argument design → reviewed output`

Reading more is not progress unless a source changes this structure. Writing starts after the evidence and argument maps are coherent, not when a pile of references feels large.

## Stage 1: Frame the outcome and question

**Input:** a topic, practical problem, assignment, proposal request, or existing project.

**Actions:**

1. State the user's actual decision and deliverable.
2. Compress the research question into one sentence with an object, relation/problem, context, and intended contribution.
3. Distinguish causal, associational, descriptive, interpretive, design, forecasting, and normative questions.
4. Record why the answer matters and what would count as a useful answer.
5. Expose one route-changing unknown; ask only that question if needed.

**Gate:** the question is specific enough to determine what evidence could answer it, while unsupported project choices remain `UNKNOWN`.

**Output:** one-sentence question, decision/deliverable, known/unknown boundary, and candidate routes when confirmation is required.

## Stage 2: Decompose the question

Break the question into a coverage map. Use only relevant modules:

- phenomenon and definitions;
- population, setting, period, and boundary conditions;
- antecedents or influencing factors;
- mechanisms and competing explanations;
- methods, measures, datasets, and identification strategies;
- outcomes and evaluation criteria;
- disagreements, null findings, failures, and anomalies;
- limitations and open questions;
- practical, ethical, or policy implications.

For each module, record the subquestion, needed evidence type, and what would falsify or weaken the expected answer.

**Gate:** modules are mutually distinguishable, collectively sufficient for the deliverable, and not a decorative list of keywords.

## Stage 3: Design and execute retrieval

Build a reproducible protocol before a deep search. Start with short, broad queries to learn field vocabulary, then narrow with concepts, synonyms, methods, populations, time bounds, and contradiction terms. Preserve every executed query, source, timestamp, result count, and adjustment.

Prioritize original papers, datasets, standards, official records, and authoritative registries for factual support. Reviews and secondary sources are useful for orientation and citation chaining, not automatic substitutes for primary evidence.

Use backward citation search, forward citation search, author/venue clusters, and negative-result or critique queries when tools permit. A search-result snippet is discovery only.

**Gate:** actual retrieval is logged, source identity is verified, exclusions have reasons, and coverage is assessed by module rather than by an arbitrary paper count.

**Output:** search protocol/log, source ledger, screening record, and a coverage-gap list.

## Stage 4: Read and extract papers

Read in passes:

1. **Identity pass:** verify title, authors, version, venue, year, identifier, retraction/correction status, and lawful access basis.
2. **Orientation pass:** question, claimed contribution, design, data, central result, and relevance.
3. **Evidence pass:** extract methods, sample/data, comparator, measures, results, uncertainty, limitations, and exact page/table/figure locations.
4. **Audit pass:** test internal numerical consistency, construct validity, causal identification, alternative explanations, reproducibility, and transfer limits.

Do not summarize every paragraph. Extract only what answers a module or changes the project decision. Separate author claims from observed results and from your inference.

**Gate:** every substantive extraction has a retrievable location and an honest verification level.

## Stage 5: Organize evidence by question, not author

Do not make the default synthesis “A said…, B said…, C said…”. Build a matrix whose rows are sources/studies and whose columns are question modules, designs, populations, measures, findings, limitations, and relevance.

Within each module, synthesize:

- what is consistently supported;
- what is supported only under narrower conditions;
- what remains uncertain;
- what directly conflicts;
- which evidence is strongest and why;
- which apparent agreement comes from reused data, shared assumptions, or non-independent sources.

**Gate:** the emerging structure can explain why each included source is present and what claim it can or cannot support.

## Stage 6: Diagnose disagreements

Treat contradiction as information, not clutter. Compare disagreeing studies on:

- construct definitions and operationalization;
- population, setting, period, and sample selection;
- design, comparator, baseline, and identification assumptions;
- intervention/exposure intensity and implementation fidelity;
- outcome, metric, time horizon, and statistical power;
- preprocessing, exclusions, models, multiplicity, and robustness checks;
- publication status, conflicts, and risk of bias.

Classify the disagreement as genuine theoretical conflict, boundary condition, measurement/design difference, data-quality issue, underpowered uncertainty, or unresolved.

When only design labels, sample sizes, and headline findings are known, give at most a provisional design-to-question judgment. Random assignment generally has greater causal identification potential than a cross-sectional association, but the label alone does not establish allocation integrity, attrition, implementation, measurement, analysis, power, or external validity. A null observational association does not refute an intervention effect when exposure and estimand differ. Say which study better addresses which question and bound every conclusion to the study's unknown population, measure, setting, and implementation; do not declare either paper simply “true.”

**Gate:** contradictory evidence remains visible and no majority vote by citation count replaces methodological judgment.

## Stage 7: Qualify the research gap and contribution

A gap is not simply “few papers exist.” Classify it as one or more of:

- **evidence gap:** a consequential question lacks adequate direct evidence;
- **contradiction gap:** credible results conflict and the source of heterogeneity is unresolved;
- **mechanism gap:** a relation is observed but the process is not identified;
- **measurement/method gap:** current designs cannot answer the intended question reliably;
- **boundary/context gap:** transfer to an important population, setting, or period is unknown;
- **integration gap:** fragmented findings have not been connected into a useful model;
- **replication/robustness gap:** an influential claim lacks independent or stress-tested support;
- **implementation gap:** efficacy is known but real-world feasibility or adoption is not.

For every proposed gap, state supporting evidence, counterevidence, importance, feasibility, and the smallest study or synthesis that could reduce it. Never claim “no one has studied this” without a search capable of supporting that statement.

**Gate:** the contribution follows from the evidence map and is both useful and feasible under the user's constraints.

## Stage 8: Design or conduct the study

Map each question/claim to a design, data source, measure, analysis, and validity threat. Prefer the smallest discriminating test over a bundle of changes. Record preregistered/prespecified choices separately from later exploration.

Before execution, define success/failure signals, stopping criteria, ethics/privacy requirements, resource limits, and rollback. During execution, preserve raw inputs or immutable references, code/environment, deviations, negative results, and failures.

**Gate:** the design can answer the question it claims to answer; execution claims have artifacts; causal language matches identification strength.

## Stage 9: Build the argument and write

Create an argument map before prose:

1. conclusion or decision the section must establish;
2. material claims needed to establish it;
3. evidence and counterevidence for each claim;
4. warrant connecting evidence to claim;
5. boundary, uncertainty, and transition to the next claim.

Draft by question and argument, not by the order papers were read. Each paragraph should have one job and a visible evidence basis. Use the author's voice and reasoning; AI organizes, challenges, and helps express the work without disguising borrowed expression or responsibility.

**Gate:** material prose is traceable to claim/evidence records, limitations are proportionate, and the conclusion does not outrun the method.

## Stage 10: Independent review and package

Run a pass independent of drafting for factual accuracy, citation entailment, source quality, method/statistical validity, numerical consistency, completeness, contradictions, writing quality, privacy/ethics, license, and deliverable integrity.

Resolve `review-matrix.md`, run the project validator, and package the report together with its evidence/state artifacts when appropriate.

**Gate:** blocking findings are fixed; unresolved non-blocking limitations are disclosed; the output is not called final merely because it is polished.

## Search stopping rule

Stop or pause retrieval when all load-bearing modules meet their declared evidence threshold, the last search rounds mostly duplicate known records or add no decision-changing evidence, key contradictions and authoritative sources have been pursued, and the effort budget is reached. Record uncovered modules and the reason for stopping.

Do not stop only because a target paper count was reached. Do not continue indefinitely in pursuit of nonexistent certainty or a nonexistent source.
