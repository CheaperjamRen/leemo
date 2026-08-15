# Source authority profiles

Use this layer to decide which sources may play which role. It is optional at intake but mandatory before an evidence-bearing literature synthesis, proposal, report, or manuscript.

## Keep four judgments separate

Never turn venue prestige into a substitute for reading or appraisal. Record four independent judgments:

1. **Authority level** — how trustworthy and institutionally accountable the source class is for this discipline and claim.
2. **Verification status** — whether only identity, the abstract, or the full claim-relevant text was actually checked.
3. **Method quality** — whether the design, data, analysis, reporting, and limitations justify the finding.
4. **Claim relevance/directness** — whether the source actually entails the claim under the relevant population, setting, time, and outcome.

An `L1` publisher abstract is still only `abstract_checked` and cannot support detailed findings. A relevant, rigorous, full-text `L2` study can be more useful than an irrelevant or weak individual paper published in an `L1` venue. Journal-level indicators never prove the quality of one article.

## Select a profile

Record the selected profile in `project-state.json.source_policy` and the brief. The user may choose it directly; otherwise use `balanced` and disclose it.

| Profile | Core claim-bearing sources | Supplemental/context sources | Typical use |
|---|---|---|---|
| `strict` | `L1` | `L2` for gap mapping or corroboration; `L3` for orientation only | high-stakes review, formal proposal, contested claim, user-requested top-source-only work |
| `balanced` | `L1` and `L2` | `L3` for orientation and interpretation | normal academic research and most student projects |
| `exploratory` | `L1` and `L2` | `L3` may drive discovery and hypotheses, never a settled empirical conclusion | emerging topics with sparse peer-reviewed literature |
| `custom` | explicitly recorded | explicitly recorded | a discipline, institution, journal, or funder has its own rules |

`BLOCKED` is never eligible under any profile. `L3` never carries a substantive empirical or causal claim by itself.

## L1 — strict / authoritative

Use `L1` only when the source is primary or canonical for the exact role and its current classification basis is recorded. Typical candidates:

- peer-reviewed articles in the current project’s verified top-journal profile, such as the selected discipline’s current JCR category/quartile rule, recognized economics/management list, or equivalent expert-curated list;
- full/regular papers at verified top conferences in fields where conferences are primary publication venues;
- official statutes, regulations, standards, court or regulator records, government statistics, and authoritative intergovernmental data **for facts within that body’s remit**;
- original technical standards, official dataset documentation, registries, protocols, and primary archival records;
- canonical scholarly monographs, critical editions, or authoritative translations actually consulted.

Examples such as “SCI Q1/Q2,” “经管顶刊/五大刊,” “顶会,” AJG/ABS, FT, UTD, CCF, CSSCI, or an institutional whitelist are **calibration inputs, not timeless facts**. Record the exact list owner, discipline/category, version or year, entry, and lookup date in `authority_basis`. If “经管五大刊” is ambiguous, resolve the discipline-specific list instead of inventing a universal five.

Limits:

- an official document is authoritative about what the institution enacted, measured, or reported—not automatically about causal effectiveness;
- a canonical book is authoritative for the theory, text, or historical argument it contains—not automatically for a current empirical estimate;
- `L1` does not waive full-text, method, conflict-of-interest, retraction, or claim-entailment checks.

## L2 — solid field evidence

Use `L2` for reputable, accountable, technically useful sources that do not meet the chosen strict profile. Typical candidates:

- established peer-reviewed field journals with real editorial governance and indexing but outside the selected top tier;
- strong domestic or regional journals relevant to the research context—for example, a user may place 《金融研究》 in `L2` for a particular finance profile, but do not hard-code that decision across projects;
- scholarly books from reputable university or academic presses that are not canonical `L1` works;
- transparent reports or working papers from established universities, research institutes, central banks, regulators, or professional bodies, when methods and data are inspectable;
- official local statistics, administrative documents, or industry standards that are authoritative within a narrower jurisdiction;
- rigorous review articles whose venue and method fit `L2`.

In `balanced` and `exploratory` profiles, an `L2` source may support a core claim only after full-text, method, relevance, and evidence-location checks. In `strict`, keep it supplemental unless the user explicitly changes the profile and records why.

## L3 — exploratory / commentary

Use `L3` for accountable material that helps discover, frame, interpret, or challenge a question but should not carry a central empirical or causal claim:

- signed scholarly commentaries, editorials, perspectives, expert essays, and high-quality narrative reviews;
- transparent think-tank or professional commentary with named authors and visible evidence links;
- dissertations, preprints, working papers, or technical notes whose status/method has not earned `L2` in the selected profile;
- reputable long-form journalism used for chronology, stakeholder positions, or discovery;
- official or corporate announcements used only to establish what that organization publicly claimed.

Label the genre and conflict of interest. Trace factual claims to `L1`/`L2` primary sources where possible. `L3` may motivate a hypothesis or identify a source, but the validator blocks `strong`, `partial`, or `contradictory` evidence grades from relying on it.

## BLOCKED — globally ineligible

Record these in the ledger when encountered so exclusion is auditable, but never include them as research evidence:

- predatory, hijacked, or paper-mill venues; fabricated peer review; citation-selling operations;
- retracted or withdrawn work used as valid evidence, except when the retraction itself is the research object and is labelled as such;
- content farms, SEO pages, scraped/rewritten article mills, anonymous marketing or sales copy, and undisclosed sponsored content;
- unsourced AI-generated pages, fake or non-resolving citations, manipulated documents, or sources with irrecoverable provenance;
- invented translations, unattributed paraphrases presented as translations, or an original edition falsely claimed as consulted;
- any source whose identity or integrity cannot be reconciled after a reasonable check.

Do not confuse an unlawful copy with the underlying publication: reject the unauthorized access path, retain only lawful metadata, and seek a legal full text. A press release or social post is not automatically garbage; it may be a primary record of what its owner announced, but it cannot stand in for the underlying study.

## Translation and edition gate

When the consulted source is a translation:

1. cite the edition actually read, including translated title, translator or translating institution, publisher, year, edition/volume, and page or section;
2. record the original author, original title, original publication year, and original-language edition when identifiable in `original_work`;
3. set `source_type` to a translation-explicit value such as `translated_book`;
4. never imply that the original text was consulted if only the translation was read;
5. attribute quotations to the consulted translation. Label an assistant/user translation as `own translation` only when the original passage was actually checked and retained.

Translation is represented by `source_type`, `translator`, `edition_or_version`, and `original_work`; it is not a verification level. Do not create statuses such as `translation_checked`. Continue to use only `unverified`, `metadata_only`, `abstract_checked`, or `full_text_checked`, based on what portion of the consulted edition was actually opened.

The project validator blocks a translated source that lacks `translator`, `edition_or_version`, or `original_work`.

## Classification procedure

For each discovered source:

1. define its intended role: core evidence, counterevidence, context, discovery, or research object;
2. verify identity, publication status, version, correction/retraction status, and lawful access path;
3. apply the selected discipline profile and current list/version; never classify from model memory alone when the ranking may have changed;
4. assign `L1`, `L2`, `L3`, `BLOCKED`, or `UNASSESSED` and write a concrete `authority_basis`;
5. separately set verification status and appraise method/relevance;
6. include it only in a role permitted by `source_policy`.

When lists disagree, do not average them silently. Record each list and either use the stricter result or ask the user only if that choice materially changes coverage. Multidisciplinary work may use more than one named discipline profile.

## Required ledger fields

- `authority_level`: `L1`, `L2`, `L3`, `BLOCKED`, or `UNASSESSED`.
- `authority_basis`: concrete list/version/category, institution/remit, venue governance, genre/status, or exclusion reason.
- `edition_or_version`: edition, report version, standard version, preprint version, or release date where relevant.
- `translator`: translator(s) or translating institution for translated material.
- `original_work`: original title/author/year/edition for translated material.

`UNASSESSED` is allowed during discovery but cannot be included. A source marked `BLOCKED` or `UNASSESSED` may remain excluded in the audit trail; it cannot have claim-bearing evidence.

## Calibration references

Use current official records rather than copied ranking blogs. Examples include:

- [Clarivate Journal Citation Reports](https://clarivate.com/academia-government/scientific-and-academic-research/research-funding-analytics/journal-citation-reports/), which is annual journal intelligence and explicitly warns against using a journal-level metric as an article-level quality proxy;
- [Chartered Association of Business Schools Academic Journal Guide methodology](https://assets.charteredabs.org/ajg-2024-methodology.pdf), whose ratings combine expert review and multiple metrics rather than one number;
- [China Computer Federation recommended venue directory](https://www.ccf.org.cn/Academic_Evaluation/By_category/2023-03-08/787209.shtml), which is versioned, field-specific, and itself warns that venue class does not determine an individual paper's influence.

These are aids to a transparent discipline profile, not universal or article-level truth. Verify whether a newer official version exists at runtime and record the version actually used.
