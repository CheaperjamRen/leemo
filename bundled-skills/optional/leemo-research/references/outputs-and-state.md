# Outputs, state, and recovery

Use a project workspace for multi-stage work, more than a few sources, experiments, data analysis, or any task that must resume later. A narrow conceptual answer or one-paragraph edit may stay in chat if no artifact is needed.

## Initialize

From the installed skill directory:

```bash
python scripts/init_project.py <project-directory> --title "<title>" --question "<question>"
```

If Python is unavailable, copy all files from `assets/` into the project directory and fill them manually. Do not pretend the script ran.

## Workspace contract

- `research-brief.md`: outcome, scope, one next question, coverage map, effort/stopping conditions, constraints, checkpoints, and decisions.
- `project-state.json`: resumable stage/capability/execution/source-policy/gate/artifact/risk state.
- `source-ledger.csv`: one row per discovered source and its authority/verification/access/screening/edition status.
- `evidence-table.csv`: anchored extraction from included sources.
- `claim-ledger.csv`: material claims mapped to source and evidence IDs.
- `experiment-log.md`: append-only plans, runs, deviations, and results.
- `review-matrix.md`: independent completion gates.

Derived prose, figures, reports, code, and exports may live in clearly named subdirectories. The seven files above remain the control records.

## Stage state

Allowed stages:

`intake`, `scope`, `protocol`, `collect`, `extract`, `synthesize`, `produce`, `review`, `package`.

Allowed status values:

`planned`, `in_progress`, `blocked`, `completed`, `not_applicable`.

Only mark a stage `completed` when its required artifact exists and its gate passed. `blocked` must name the exact missing input, authorization, capability, or decision. A narrow workflow can mark irrelevant stages `not_applicable`.

For any proposal/opening-report/thesis-plan/grant artifact, `gates.formal_proposal.status` must be `PASS`; each of its five route fields must record a resolved epistemic status and basis. Calling an artifact “initial,” “discussion,” “provisional,” or “draft” does not bypass the gate.

After each material action update:

1. current stage and status;
2. capability actually used and fallback, if any;
3. created or changed artifact;
4. decision/assumption and basis;
5. unresolved risk;
6. next action or user checkpoint.

For long or delegated work, also update the coverage status, failed query/tool route, remaining budget, and stopping-condition evidence. Preserve verification/synthesis capacity instead of spending the entire budget on discovery.

## Source and evidence IDs

Use stable project-local IDs such as `S001`, `E001`, and `C001`. Never reuse an ID for a different record. Separate multiple IDs in a claim row with semicolons. Keep a source row even when excluded; record the reason.

Authority fields use `L1`, `L2`, `L3`, `BLOCKED`, or `UNASSESSED`. Record a concrete classification basis. Authority does not replace verification depth, method appraisal, or claim entailment. For translated material, record the consulted edition/version, translator, and original work; the validator treats all three as required.

Claim status must be one of `needs_evidence`, `supported`, `contradicted`, `USER_PROVIDED`, `SOURCE_VERIFIED`, `COMPUTED`, `ASSUMPTION`, `INFERENCE`, `UNKNOWN`, or `PLANNED`. The legacy alias `verified` is accepted with a warning but should be migrated to `SOURCE_VERIFIED`. `supported`, `contradicted`, `verified`, `SOURCE_VERIFIED`, and `INFERENCE` require source/evidence links; each evidence row's `source_id` must also appear in the claim row.

## Validate

```bash
python scripts/validate_project.py <project-directory>
python scripts/validate_project.py <project-directory> --json
```

Fix blocking findings before a final evidence-bearing deliverable. Warnings can remain only when disclosed in the final report.

## Resume protocol

On a new session:

1. Read `project-state.json` and `research-brief.md`.
2. Read only the ledgers/artifacts needed by the current stage.
3. Verify that referenced paths exist.
4. State the last completed stage, current blocker, and next action in one compact update.
5. Continue from the first incomplete load-bearing step; do not restart completed collection or analysis.

## Final response contract

Lead with the outcome, then report:

- completed work and deliverables;
- evidence basis and coverage;
- important findings with calibrated certainty;
- planned versus actually executed work;
- validation/review status;
- unresolved gaps, unavailable capabilities, and external dependencies;
- at most one immediate user decision, only if needed.

Layer long results so the outcome is understandable first, the core reasoning second, evidence/limits third, and audit artifacts last. For a short task, do not manufacture extra sections merely to look comprehensive.

Never make the user study the adapter map. Explain a missing provider only when it changes coverage, cost, privacy, or the next decision.
