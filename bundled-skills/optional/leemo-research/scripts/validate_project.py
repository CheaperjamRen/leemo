#!/usr/bin/env python3
"""Validate the cross-references in a Leemo research project."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Iterable


LEDGERS = {
    "sources": (
        "source-ledger.csv",
        "source_id",
        {
            "source_id", "title", "source_type", "authors", "year", "doi", "url",
            "local_path", "accessed_at", "verification_status", "screening_status",
            "screening_reason", "license_or_access", "notes", "authority_level",
            "authority_basis", "edition_or_version", "translator", "original_work",
        },
    ),
    "evidence": (
        "evidence-table.csv",
        "evidence_id",
        {
            "evidence_id", "source_id", "location", "study_design", "population_or_dataset",
            "method_or_intervention", "comparator", "outcome_or_metric", "finding",
            "limitations", "support_grade", "extraction_status", "extractor", "checked_by",
        },
    ),
    "claims": (
        "claim-ledger.csv",
        "claim_id",
        {
            "claim_id", "claim_text", "claim_type", "source_ids", "evidence_ids",
            "support_grade", "status", "artifact_location", "notes",
        },
    ),
}
REFERENCE_SPLITTER = re.compile(r"[;,|]")
ALLOWED_STAGE_STATUSES = {"planned", "in_progress", "blocked", "completed", "not_applicable"}
ALLOWED_REVIEW_STATUSES = {"PASS", "FAIL", "NOT_APPLICABLE", "NOT_VERIFIED"}
ALLOWED_VERIFICATION_STATUSES = {
    "unverified", "metadata_only", "abstract_checked", "full_text_checked"
}
ALLOWED_AUTHORITY_LEVELS = {"L1", "L2", "L3", "BLOCKED", "UNASSESSED"}
ALLOWED_SOURCE_PROFILES = {"strict", "balanced", "exploratory", "custom"}
SUBSTANTIVE_SUPPORT_GRADES = {"strong", "partial", "contradictory"}
TRANSLATED_SOURCE_PATTERN = re.compile(
    r"translated|translation|译著|译本|翻译", re.IGNORECASE
)
FULL_TEXT_SCOPE_MARKERS = {
    "checked_scope=full_text", "checked_scope=claim_relevant_sections"
}
ALLOWED_CLAIM_STATUSES = {
    "needs_evidence", "supported", "contradicted", "verified",
    "USER_PROVIDED", "SOURCE_VERIFIED", "COMPUTED", "ASSUMPTION", "INFERENCE",
    "UNKNOWN", "PLANNED",
}
EVIDENCE_REQUIRED_CLAIM_STATUSES = {
    "supported", "contradicted", "verified", "SOURCE_VERIFIED", "INFERENCE"
}
REQUIRED_STAGES = {
    "intake", "scope", "protocol", "collect", "extract", "synthesize", "produce",
    "review", "package",
}
FORMAL_ARTIFACT_PATTERN = re.compile(
    r"proposal|opening[\s_-]*report|thesis[\s_-]*plan|grant|开题|基金申请|课题申请",
    re.IGNORECASE,
)
FORMAL_GATE_FIELDS = {
    "research_object",
    "disciplinary_frame",
    "claim_type",
    "feasible_evidence_data",
    "method_route",
}
FORMAL_GATE_RESOLVED_STATUSES = {
    "USER_PROVIDED", "SOURCE_VERIFIED", "COMPUTED", "USER_DELEGATED"
}
INTEGRITY_FLAGS = (
    "fabricated_sources",
    "fabricated_data",
    "fabricated_execution",
    "detector_evasion",
    "unauthorized_access",
)


def read_csv(
    path: Path,
    identifier: str,
    required_columns: set[str],
    blocking: list[str],
    warnings: list[str],
) -> list[dict[str, str]]:
    """Read a ledger, reporting malformed or duplicate identifiers."""
    if not path.is_file():
        blocking.append(f"missing required ledger {path.name}")
        return []

    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            columns = set(reader.fieldnames or ())
            missing_columns = sorted(required_columns - columns)
            if missing_columns:
                blocking.append(
                    f"ledger {path.name} is missing required columns: "
                    + ", ".join(missing_columns)
                )
                return []
            rows = []
            seen: set[str] = set()
            for row_number, row in enumerate(reader, start=2):
                if not any((value or "").strip() for value in row.values()):
                    continue
                value = (row.get(identifier) or "").strip()
                if not value:
                    blocking.append(f"ledger {path.name} has a row without {identifier} at row {row_number}")
                    continue
                if value in seen:
                    blocking.append(f"ledger {path.name} has duplicate {identifier} {value}")
                    continue
                seen.add(value)
                rows.append({key: (value or "").strip() for key, value in row.items() if key is not None})
            return rows
    except (OSError, UnicodeError, csv.Error) as exc:
        blocking.append(f"could not read ledger {path.name}: {exc}")
        return []


def identifiers(value: str) -> Iterable[str]:
    """Split the conventional delimited ID fields while ignoring empty items."""
    return (item.strip() for item in REFERENCE_SPLITTER.split(value) if item.strip())


def validate_project_state(project: Path, blocking: list[str]) -> dict[str, object] | None:
    """Validate the state data required to safely resume a research project."""
    path = project / "project-state.json"
    if not path.is_file():
        blocking.append("missing required file project-state.json")
        return None
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        blocking.append(f"could not read project-state.json: {exc}")
        return None

    stages = state.get("stages", {})
    if isinstance(stages, dict):
        missing_stages = sorted(REQUIRED_STAGES - set(stages))
        if missing_stages:
            blocking.append(
                "project-state.json is missing required stages: "
                + ", ".join(missing_stages)
            )
        for name, stage in stages.items():
            status = stage.get("status") if isinstance(stage, dict) else None
            if status not in ALLOWED_STAGE_STATUSES:
                blocking.append(f"stage {name} has invalid status {status}")

    integrity = state.get("integrity")
    if not isinstance(integrity, dict):
        blocking.append("project-state.json is missing integrity declarations")
    else:
        for name in INTEGRITY_FLAGS:
            if integrity.get(name) is True:
                blocking.append(f"integrity flag {name} is true")
    return state


def validate_review_matrix(
    project: Path,
    state: dict[str, object] | None,
    blocking: list[str],
) -> None:
    """Require an evidenced matrix once review or packaging is declared complete."""
    if state is None:
        return
    stages = state.get("stages")
    if not isinstance(stages, dict):
        return
    completion_claimed = any(
        isinstance(stages.get(name), dict)
        and stages[name].get("status") == "completed"
        for name in ("review", "package")
    )
    if not completion_claimed:
        return

    path = project / "review-matrix.md"
    if not path.is_file():
        blocking.append("review or package is completed but review-matrix.md is missing")
        return
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        blocking.append(f"could not read review-matrix.md: {exc}")
        return

    gates = 0
    for line in lines:
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if len(cells) < 3 or cells[0].lower() == "gate":
            continue
        if cells[0] and set(cells[0]) <= {"-", ":"}:
            continue
        gate, status, evidence = cells[0], cells[1], cells[2]
        if not gate:
            continue
        gates += 1
        if status not in ALLOWED_REVIEW_STATUSES:
            blocking.append(
                f"review-matrix.md gate '{gate}' has invalid status {status or '<empty>'}"
            )
        elif status in {"FAIL", "NOT_VERIFIED"}:
            blocking.append(f"review-matrix.md gate '{gate}' remains {status}")
        elif status == "PASS" and not evidence:
            blocking.append(f"review-matrix.md gate '{gate}' is PASS without evidence")
        elif status == "NOT_APPLICABLE" and not evidence:
            blocking.append(
                f"review-matrix.md gate '{gate}' is NOT_APPLICABLE without rationale"
            )
    if gates == 0:
        blocking.append("review-matrix.md contains no review gates")


def validate_formal_proposal_gate(
    state: dict[str, object] | None,
    blocking: list[str],
) -> None:
    """Block proposal-like artifacts until all five route fields are resolved."""
    if state is None:
        return
    project = state.get("project")
    artifact_values: list[str] = []
    if isinstance(project, dict):
        artifact_values.append(str(project.get("deliverable", "")))
    artifacts = state.get("artifacts")
    if isinstance(artifacts, list):
        for artifact in artifacts:
            if isinstance(artifact, str):
                artifact_values.append(artifact)
            elif isinstance(artifact, dict):
                artifact_values.extend(
                    str(artifact.get(key, ""))
                    for key in ("path", "description", "name")
                )
    if not FORMAL_ARTIFACT_PATTERN.search("\n".join(artifact_values)):
        return

    gates = state.get("gates")
    formal_gate = gates.get("formal_proposal") if isinstance(gates, dict) else None
    if not isinstance(formal_gate, dict):
        blocking.append("formal proposal artifact exists but formal_proposal gate is missing")
        return
    gate_status = formal_gate.get("status")
    if gate_status != "PASS":
        blocking.append(
            f"formal proposal artifact exists but formal_proposal gate is {gate_status or '<empty>'}"
        )
    fields = formal_gate.get("fields")
    if not isinstance(fields, dict):
        blocking.append("formal_proposal gate is missing route fields")
        return
    for field_name in sorted(FORMAL_GATE_FIELDS):
        field = fields.get(field_name)
        if not isinstance(field, dict):
            blocking.append(f"formal_proposal gate field {field_name} is missing")
            continue
        status = field.get("status")
        if status not in FORMAL_GATE_RESOLVED_STATUSES:
            blocking.append(
                f"formal_proposal gate field {field_name} is unresolved "
                f"({status or '<empty>'})"
            )
        if not str(field.get("basis", "")).strip():
            blocking.append(
                f"formal_proposal gate field {field_name} has no recorded basis"
            )


def validate_source_policy(
    state: dict[str, object] | None,
    blocking: list[str],
) -> dict[str, object]:
    """Validate the project-level authority profile and return safe defaults."""
    fallback: dict[str, object] = {
        "profile": "balanced",
        "core_claim_levels": ["L1", "L2"],
        "context_levels": ["L1", "L2", "L3"],
        "blocked_levels": ["BLOCKED"],
    }
    if state is None:
        return fallback
    policy = state.get("source_policy")
    if not isinstance(policy, dict):
        blocking.append("project-state.json is missing source_policy")
        return fallback

    profile = str(policy.get("profile", ""))
    if profile not in ALLOWED_SOURCE_PROFILES:
        blocking.append(f"source_policy has invalid profile {profile or '<empty>'}")

    normalized: dict[str, object] = {"profile": profile or "balanced"}
    for field, allowed in (
        ("core_claim_levels", {"L1", "L2"}),
        ("context_levels", {"L1", "L2", "L3"}),
        ("blocked_levels", {"BLOCKED"}),
    ):
        raw = policy.get(field)
        if not isinstance(raw, list) or not raw:
            blocking.append(f"source_policy {field} must be a non-empty list")
            normalized[field] = fallback[field]
            continue
        values = [str(value).upper() for value in raw]
        invalid = sorted(set(values) - allowed)
        if invalid:
            blocking.append(
                f"source_policy {field} contains invalid levels: " + ", ".join(invalid)
            )
        normalized[field] = values

    core_levels = normalized["core_claim_levels"]
    if profile == "strict" and core_levels != ["L1"]:
        blocking.append("strict source_policy must use core_claim_levels L1")
    if profile in {"balanced", "exploratory"} and set(core_levels) != {"L1", "L2"}:
        blocking.append(
            f"{profile} source_policy must use core_claim_levels L1 and L2"
        )
    if "BLOCKED" not in normalized["blocked_levels"]:
        blocking.append("source_policy blocked_levels must include BLOCKED")
    return normalized


def validate(project: Path) -> dict[str, object]:
    blocking: list[str] = []
    warnings: list[str] = []
    ledgers: dict[str, list[dict[str, str]]] = {}

    state = validate_project_state(project, blocking)
    validate_formal_proposal_gate(state, blocking)
    validate_review_matrix(project, state, blocking)
    source_policy = validate_source_policy(state, blocking)
    for name, (filename, identifier, required_columns) in LEDGERS.items():
        ledgers[name] = read_csv(
            project / filename, identifier, required_columns, blocking, warnings
        )

    source_ids = {row["source_id"] for row in ledgers["sources"]}
    sources_by_id = {row["source_id"]: row for row in ledgers["sources"]}
    evidence_ids = {row["evidence_id"] for row in ledgers["evidence"]}
    evidence_by_id = {row["evidence_id"]: row for row in ledgers["evidence"]}

    for source in ledgers["sources"]:
        source_id = source["source_id"]
        verification_status = source.get("verification_status", "")
        authority_level = source.get("authority_level", "").upper()
        screening_status = source.get("screening_status", "").lower()
        if verification_status not in ALLOWED_VERIFICATION_STATUSES:
            blocking.append(
                f"source {source_id} has invalid verification_status "
                f"{verification_status or '<empty>'}"
            )
        if verification_status == "full_text_checked":
            if not any(source.get(field, "") for field in ("doi", "url", "local_path")):
                blocking.append(
                    f"source {source_id} is full_text_checked but has no doi, url, or local_path"
                )
            notes = source.get("notes", "").lower()
            if not any(marker in notes for marker in FULL_TEXT_SCOPE_MARKERS):
                blocking.append(
                    f"source {source_id} is full_text_checked without a checked_scope marker"
                )
        if authority_level not in ALLOWED_AUTHORITY_LEVELS:
            blocking.append(
                f"source {source_id} has invalid authority_level "
                f"{authority_level or '<empty>'}"
            )
        elif authority_level != "UNASSESSED" and not source.get("authority_basis", ""):
            blocking.append(
                f"source {source_id} has authority_level {authority_level} "
                "without authority_basis"
            )
        if screening_status in {"include", "included"} and authority_level in {
            "", "UNASSESSED", "BLOCKED"
        }:
            blocking.append(
                f"source {source_id} is included but authority_level is "
                f"{authority_level or '<empty>'}"
            )
        if TRANSLATED_SOURCE_PATTERN.search(source.get("source_type", "")):
            for field in ("edition_or_version", "translator", "original_work"):
                if not source.get(field, ""):
                    blocking.append(f"translated source {source_id} has no {field}")

    for evidence in ledgers["evidence"]:
        source_id = evidence.get("source_id", "")
        if not source_id:
            blocking.append(f"evidence {evidence['evidence_id']} has no source_id")
        elif source_id not in source_ids:
            blocking.append(
                f"evidence {evidence['evidence_id']} references unknown source_id {source_id}"
            )
        else:
            source = sources_by_id[source_id]
            source_status = source.get("verification_status", "")
            authority_level = source.get("authority_level", "").upper()
            support_grade = evidence.get("support_grade", "")
            if source_status != "full_text_checked" and support_grade != "metadata_only":
                blocking.append(
                    f"evidence {evidence['evidence_id']} has substantive support_grade "
                    f"{support_grade or '<empty>'} but source {source_id} is {source_status or '<empty>'}"
                )
            if authority_level in {"BLOCKED", "UNASSESSED", ""}:
                blocking.append(
                    f"evidence {evidence['evidence_id']} uses ineligible authority_level "
                    f"{authority_level or '<empty>'} from source {source_id}"
                )
            elif authority_level == "L3" and support_grade in SUBSTANTIVE_SUPPORT_GRADES:
                blocking.append(
                    f"evidence {evidence['evidence_id']} has substantive support_grade "
                    f"{support_grade} but source {source_id} has authority_level L3"
                )
            elif support_grade in SUBSTANTIVE_SUPPORT_GRADES:
                core_levels = [str(value) for value in source_policy["core_claim_levels"]]
                if authority_level not in core_levels:
                    profile = str(source_policy["profile"])
                    blocking.append(
                        f"evidence {evidence['evidence_id']} uses authority_level "
                        f"{authority_level} outside {profile} core_claim_levels "
                        + ", ".join(core_levels)
                    )
            elif support_grade == "background":
                context_levels = [str(value) for value in source_policy["context_levels"]]
                if authority_level not in context_levels:
                    profile = str(source_policy["profile"])
                    blocking.append(
                        f"evidence {evidence['evidence_id']} uses authority_level "
                        f"{authority_level} outside {profile} context_levels "
                        + ", ".join(context_levels)
                    )

    for claim in ledgers["claims"]:
        claim_id = claim["claim_id"]
        source_refs = list(identifiers(claim.get("source_ids", "")))
        evidence_refs = list(identifiers(claim.get("evidence_ids", "")))
        claim_status = claim.get("status", "")
        if claim_status not in ALLOWED_CLAIM_STATUSES:
            blocking.append(
                f"claim {claim_id} has invalid status {claim_status or '<empty>'}"
            )
        elif claim_status == "verified":
            warnings.append(
                f"claim {claim_id} uses legacy status verified; prefer SOURCE_VERIFIED"
            )
        if claim_status in EVIDENCE_REQUIRED_CLAIM_STATUSES:
            if not source_refs:
                blocking.append(f"claim {claim_id} is {claim_status} but has no source_ids")
            if not evidence_refs:
                blocking.append(f"claim {claim_id} is {claim_status} but has no evidence_ids")
            support_grade = claim.get("support_grade", "")
            if support_grade in ("", "metadata_only"):
                blocking.append(
                    f"claim {claim_id} is {claim_status} with insufficient support_grade {support_grade}"
                )
            for evidence_id in evidence_refs:
                evidence = evidence_by_id.get(evidence_id)
                if evidence and evidence.get("support_grade") == "metadata_only":
                    blocking.append(
                        f"claim {claim_id} relies on metadata_only evidence {evidence_id}"
                    )
        for source_id in source_refs:
            if source_id not in source_ids:
                blocking.append(f"claim {claim_id} references unknown source_id {source_id}")
        for evidence_id in evidence_refs:
            if evidence_id not in evidence_ids:
                blocking.append(f"claim {claim_id} references unknown evidence_id {evidence_id}")
            else:
                evidence_source_id = evidence_by_id[evidence_id].get("source_id", "")
                if evidence_source_id and evidence_source_id not in source_refs:
                    blocking.append(
                        f"claim {claim_id} references evidence {evidence_id} from source "
                        f"{evidence_source_id} but source_ids does not include it"
                    )

    counts = {name: len(ledgers[name]) for name in LEDGERS}
    return {"ok": not blocking, "blocking": blocking, "warnings": warnings, "counts": counts}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate a Leemo research project.")
    parser.add_argument("project", type=Path, help="research project directory")
    parser.add_argument("--json", action="store_true", dest="as_json", help="emit JSON")
    args = parser.parse_args(argv)

    result = validate(args.project)
    if args.as_json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        for message in result["blocking"]:
            print(f"BLOCKING: {message}")
        for message in result["warnings"]:
            print(f"WARNING: {message}")
        print("Counts: " + ", ".join(f"{name}={count}" for name, count in result["counts"].items()))
        print("OK" if result["ok"] else "FAILED")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
