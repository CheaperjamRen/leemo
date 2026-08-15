# Evidence and research-integrity gates

These gates apply even under deadline, authority, sunk-cost, or publication pressure.

## Status vocabulary

Label material statements and artifacts with the most specific status:

- `USER_PROVIDED`: supplied by the user but not independently checked.
- `SOURCE_VERIFIED`: checked against a retrievable source at a recorded location.
- `COMPUTED`: produced by recorded code/data in this project.
- `ASSUMPTION`: reversible working choice, not fact.
- `INFERENCE`: reasoned interpretation from stated evidence.
- `UNKNOWN`: missing and not safely inferable.
- `PLANNED`: intended action, not yet run.
- `EXECUTED`: actually run with an artifact or log.

Never silently promote one status to another.

## Source gate

For each source record a stable identifier or retrievable URL/path, access date, access/legal basis, verification level, and screening status.

- `unverified`: remembered by the model, seen only in a search-result snippet/secondary citation, or discovered but identity not checked.
- `metadata_only`: an authoritative registry, publisher, journal, repository, or database record was opened and title, author, year, venue, and identifier were matched as applicable.
- `abstract_checked`: the authoritative abstract itself was opened; it remains discovery/metadata-level evidence for substantive synthesis.
- `full_text_checked`: substantive text checked at a recorded location.

`unverified` candidates must not be introduced as “confirmed,” “verified,” or “real literature.” A DOI-shaped string or clickable link generated from memory is not verification. Metadata-only or abstract-checked evidence may establish bibliographic identity, abstract-reported scope, or search relevance; it cannot establish a detailed method, result, quotation, limitation, or synthesis claim. Verify DOI/title/author/year combinations before final citation. Keep retractions, corrections, versions, and preprint status visible when relevant.

Do not infer `full_text_checked` from an article URL, publisher landing page, citation block, a few visible lines, or notes such as “opened abstract.” For that status, record `checked_scope=full_text` or `checked_scope=claim_relevant_sections` in the source-ledger notes plus the exact locations checked. Evidence from any lower status must use `support_grade=metadata_only`; the project validator blocks promotion.

For every verification claim, retain a `source_id`, authoritative URL/path, check time, and checked fields. If the current task has no such record, use `unverified` even when the citation looks plausible.

A partial factual synthesis may include only the subset whose source, evidence, and claim rows all pass, and must be labelled partial with coverage gaps. A final review or bibliography additionally requires a completed executed search/screening protocol and declared target coverage. Unresolved candidates stay in a separate verification queue. Deadline pressure and a requested citation count do not waive either gate.

## Authority gate

Choose and record a `strict`, `balanced`, `exploratory`, or explicit `custom` source profile. Apply [source-authority.md](source-authority.md) before using a source downstream.

- `L1` is strict/authoritative for the declared discipline and role.
- `L2` is reliable field evidence; it may carry core claims in balanced/exploratory profiles after full appraisal.
- `L3` is for discovery, framing, and commentary, not substantive empirical or causal support.
- `BLOCKED` covers globally ineligible material and can only remain as an excluded audit record.

Record the classification basis and date. Rankings and venue lists change; journal-level prestige does not establish article-level validity. A translated source must identify the edition actually consulted, translator, and original work. Never cite the original as if it was read when only a translation was used.

## Claim gate

Every material empirical, causal, quantitative, historical, or attribution claim needs a `claim_id` and evidence link. Support grades:

- `strong`: directly tests or documents the whole claim.
- `partial`: supports only part or under narrower conditions.
- `background`: supplies context, not direct support.
- `contradictory`: materially conflicts with the claim.
- `metadata_only`: identity/abstract-level check only.

Represent contradictory evidence. Do not use citation count, journal prestige, repository stars, or confident prose as support grade.

## Data and statistics gate

- Preserve raw data or an immutable reference; record transformations and exclusions.
- Distinguish prespecified/confirmatory, sensitivity, and exploratory analyses.
- A p-value alone does not reveal effect direction, magnitude, practical importance, or whether an analysis was prespecified.
- The words “main result” do not prove a preregistered primary outcome or prespecified analysis. Do not invent groups, design, model, effect direction, or outcome role around an isolated statistic.
- Do not search methods, subgroups, outcomes, covariates, or outlier rules for significance and then report the winner as confirmatory.
- Report effect estimates, uncertainty, sample size, missingness, multiplicity treatment, assumptions, and deviations when available.
- Negative, null, failed, and contradictory results remain in the record.
- Planned analysis, example output, or placeholder numbers must never look like executed results.

If an isolated statistic is the only result context, the interpretation gate fails. The assistant may preserve the exact statistic, state unknowns, protect the existing materials, and request the complete original analysis output in one question. It may not draft a table, result paragraph, boss/supervisor message, or named reanalysis plan. In particular, `p=0.11` plus a request for `p<0.05` does not establish that 0.05 was prespecified, that the test was primary/confirmatory, or what design, variables, groups, direction, magnitude, model, sample, or uncertainty produced it.

## Writing and authorship gate

AI may help with questions, outlines, counterarguments, synthesis, editing, and review. The author remains responsible for claims, decisions, citations, originality, disclosure, and submission rules.

Do not:

- fabricate or autocomplete references, quotations, data, metrics, experiments, identities, or tool calls;
- copy or lightly transform another work's expression or distinctive argument structure without attribution;
- promise acceptance, rankings, similarity percentages, or AIGC-detector scores;
- optimize for hiding AI use or evading plagiarism/AIGC detection.

When a user requests evasion, redirect to original reasoning, accurate attribution, transparent AI-use compliance, author review, and a substantive revision log.

## Access, privacy, and regulated-work gate

- Never bypass paywalls, logins, robots rules, CAPTCHAs, institutional terms, or other access controls.
- Use open-access, user-provided, or explicitly authorized material.
- Obtain user approval before uploading confidential, unpublished, personal, patient, participant, employer, or licensed data to an external service.
- For human subjects, clinical/medical, legal, safety-critical, or other regulated work, identify the relevant human/ethics/organizational review. The skill does not replace it.
- Record license and redistribution rights before bundling third-party code, prompts, figures, datasets, or full text.

## Completion gate

Before calling a result final:

1. Run `scripts/validate_project.py` when a project workspace exists.
2. Complete `review-matrix.md` independently of the drafting pass.
3. Confirm material claims have evidence and important counterevidence is represented.
4. Confirm every claimed search, computation, experiment, download, and edit has an artifact or log.
5. List unresolved gaps and decisions separately from completed results.

## Rationalizations to stop

| Rationalization | Required response |
|---|---|
| “The deadline means we can fill details now and verify later.” | Use placeholders or `ASSUMPTION`; do not turn them into facts or final prose. |
| “A complete draft is more useful even without a source corpus.” | Produce a protocol and structure draft; factual synthesis waits for evidence. |
| “p=0.11, so the direction probably matches the hypothesis.” | A p-value does not supply direction or prespecification; leave both `UNKNOWN`. |
| “The replacement sentence is only a helpful template.” | Templates obey the same fact boundary; use bound fields/placeholders and do not add groups, design, or prespecification. |
| “The DOI looks real and a search snippet showed it.” | Keep it `unverified` until an authoritative record is opened and fields are matched. |
| “I can add placeholders or ‘fill as applicable’ to make the result table useful.” | Placeholders may not imply an unknown design, group, outcome role, direction, or prespecification; with an isolated statistic, do not emit a result table. |
| “I refused p-hacking, so a ready-to-send transparent paragraph is safe.” | A refusal does not supply missing design facts. With only an isolated statistic, do not draft result prose or a reanalysis menu; request the original analysis artifact. |
| “A broad search found enough plausible papers for a submit-ready draft.” | Without the three ledgers and executed search log, stop at an unverified outline and verification queue. |
| “I opened the article page/abstract, so `full_text_checked` is close enough.” | Use `metadata_only` or `abstract_checked`; substantive evidence requires recorded full text or claim-relevant sections. |
| “The validator passed, so the review body is evidence-valid.” | Structural validation is only one gate. Check source scope, claim entailment, coverage, and review status before calling prose valid. |
| “No search ran, so all PRISMA counts are honestly zero.” | Use `NOT_STARTED` and no numeric flow. Zero is a result count only after an executed, logged search. |
| “Call it exploratory and we can try everything.” | Exploration is allowed only with a complete search record and non-confirmatory interpretation. |
| “Pretend the optional tools are installed so the user gets an answer.” | Report actual capabilities, use a real fallback, and never invent counts or execution. |
| “Only language proofreading is safe.” | Transparent ideation and critique are allowed; provenance and author judgment are the controls. |
| “Detector score is the practical target.” | Optimize substance, originality, attribution, and disclosure—not evasion or an unverifiable score. |
