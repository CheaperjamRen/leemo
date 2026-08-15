import csv
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
INIT_SCRIPT = SKILL_ROOT / "scripts" / "init_project.py"
VALIDATE_SCRIPT = SKILL_ROOT / "scripts" / "validate_project.py"
SOURCE_COLUMNS = [
    "source_id",
    "title",
    "source_type",
    "authors",
    "year",
    "doi",
    "url",
    "local_path",
    "accessed_at",
    "verification_status",
    "screening_status",
    "screening_reason",
    "license_or_access",
    "notes",
    "authority_level",
    "authority_basis",
    "edition_or_version",
    "translator",
    "original_work",
]


def run_script(script: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(script), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


class ValidateProjectTests(unittest.TestCase):
    def create_project(self, root: Path) -> Path:
        project = root / "study"
        result = run_script(INIT_SCRIPT, str(project))
        self.assertEqual(result.returncode, 0, result.stderr)
        return project

    def replace_sources(self, project: Path, rows: list[list[str]]) -> None:
        with (project / "source-ledger.csv").open(
            "w", encoding="utf-8", newline=""
        ) as handle:
            writer = csv.writer(handle)
            writer.writerow(SOURCE_COLUMNS)
            writer.writerows(rows)

    def test_clean_new_project_passes_and_reports_zero_records(self) -> None:
        """Catches validators that reject their own clean template or miscount rows."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["blocking"], [])
            self.assertEqual(
                payload["counts"], {"sources": 0, "evidence": 0, "claims": 0}
            )

    def test_supported_claim_without_evidence_is_blocking(self) -> None:
        """Catches unsupported prose being promoted to a supported research claim."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            ledger = project / "claim-ledger.csv"
            with ledger.open("a", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(
                    [
                        "C001",
                        "AI use improves job-search outcomes.",
                        "empirical",
                        "",
                        "",
                        "strong",
                        "supported",
                        "draft.md#results",
                        "",
                    ]
                )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            self.assertFalse(payload["ok"])
            self.assertIn("claim C001 is supported but has no source_ids", payload["blocking"])
            self.assertIn("claim C001 is supported but has no evidence_ids", payload["blocking"])

    def test_unknown_evidence_source_reference_is_blocking(self) -> None:
        """Catches evidence rows that silently point to a nonexistent source."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            ledger = project / "evidence-table.csv"
            with ledger.open("a", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(
                    [
                        "E001",
                        "S404",
                        "p. 3",
                        "survey",
                        "students",
                        "AI use",
                        "low use",
                        "job-search preparation",
                        "positive association",
                        "cross-sectional",
                        "partial",
                        "full_text",
                        "agent-a",
                        "agent-b",
                    ]
                )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            self.assertIn(
                "evidence E001 references unknown source_id S404", payload["blocking"]
            )

    def test_full_text_checked_source_requires_a_locator(self) -> None:
        """Catches claims that a full text was checked when no retrievable source exists."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            ledger = project / "source-ledger.csv"
            with ledger.open("a", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(
                    [
                        "S001",
                        "A paper",
                        "journal_article",
                        "Author",
                        "2025",
                        "",
                        "",
                        "",
                        "2026-08-09T00:00:00Z",
                        "full_text_checked",
                        "include",
                        "",
                        "open_access",
                        "",
                    ]
                )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            self.assertIn(
                "source S001 is full_text_checked but has no doi, url, or local_path",
                payload["blocking"],
            )

    def test_translation_checked_is_not_a_valid_verification_status(self) -> None:
        """Translation metadata must not create a fifth verification level."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            self.replace_sources(
                project,
                [[
                    "S001", "A translated classic", "translated_book", "Original Author", "2020",
                    "", "", "book.pdf", "2026-08-09T00:00:00Z", "translation_checked",
                    "include", "", "user_provided", "", "L1",
                    "canonical scholarly work; translation used", "Second edition",
                    "Translator Name", "Original Title; Original Author; 1950",
                ]],
            )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            self.assertIn(
                "source S001 has invalid verification_status translation_checked",
                json.loads(result.stdout)["blocking"],
            )

    def test_full_text_checked_source_requires_checked_scope_marker(self) -> None:
        """Catches an abstract or landing page being relabelled as checked full text."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            with (project / "source-ledger.csv").open(
                "a", encoding="utf-8", newline=""
            ) as handle:
                csv.writer(handle).writerow(
                    [
                        "S001",
                        "A paper",
                        "journal_article",
                        "Author",
                        "2025",
                        "10.1/example",
                        "https://example.test/paper",
                        "",
                        "2026-08-09T00:00:00Z",
                        "full_text_checked",
                        "include",
                        "",
                        "open_access",
                        "opened article abstract",
                    ]
                )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            self.assertIn(
                "source S001 is full_text_checked without a checked_scope marker",
                payload["blocking"],
            )

    def test_metadata_source_cannot_back_substantive_evidence(self) -> None:
        """Catches abstract/metadata extraction being promoted to substantive evidence."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            with (project / "source-ledger.csv").open(
                "a", encoding="utf-8", newline=""
            ) as handle:
                csv.writer(handle).writerow(
                    [
                        "S001",
                        "A paper",
                        "journal_article",
                        "Author",
                        "2025",
                        "10.1/example",
                        "https://example.test/record",
                        "",
                        "2026-08-09T00:00:00Z",
                        "metadata_only",
                        "include",
                        "",
                        "public_record",
                        "abstract opened",
                    ]
                )
            with (project / "evidence-table.csv").open(
                "a", encoding="utf-8", newline=""
            ) as handle:
                csv.writer(handle).writerow(
                    [
                        "E001",
                        "S001",
                        "abstract",
                        "survey",
                        "students",
                        "AI use",
                        "",
                        "employability",
                        "positive association",
                        "",
                        "partial",
                        "abstract",
                        "agent-a",
                        "",
                    ]
                )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            self.assertIn(
                "evidence E001 has substantive support_grade partial but source S001 is metadata_only",
                payload["blocking"],
            )

    def test_inference_claim_without_evidence_is_blocking(self) -> None:
        """Catches synthesis labelled as inference while escaping the evidence gate."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            with (project / "claim-ledger.csv").open(
                "a", encoding="utf-8", newline=""
            ) as handle:
                csv.writer(handle).writerow(
                    [
                        "C001",
                        "The evidence pattern suggests a boundary condition.",
                        "synthesis",
                        "",
                        "",
                        "partial",
                        "INFERENCE",
                        "draft.md#synthesis",
                        "",
                    ]
                )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            self.assertIn(
                "claim C001 is INFERENCE but has no evidence_ids",
                payload["blocking"],
            )

    def test_verified_alias_without_evidence_is_blocking(self) -> None:
        """A common status alias must not bypass the evidence requirement."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            with (project / "claim-ledger.csv").open(
                "a", encoding="utf-8", newline=""
            ) as handle:
                csv.writer(handle).writerow(
                    [
                        "C001", "The intervention works.", "empirical", "", "",
                        "partial", "verified", "draft.md#results", "",
                    ]
                )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            blocking = json.loads(result.stdout)["blocking"]
            self.assertIn("claim C001 is verified but has no source_ids", blocking)
            self.assertIn("claim C001 is verified but has no evidence_ids", blocking)

    def test_invalid_claim_status_is_blocking(self) -> None:
        """An invented confidence label cannot escape the finite epistemic vocabulary."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            with (project / "claim-ledger.csv").open(
                "a", encoding="utf-8", newline=""
            ) as handle:
                csv.writer(handle).writerow(
                    [
                        "C001", "The intervention works.", "empirical", "", "",
                        "strong", "certain", "draft.md#results", "",
                    ]
                )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            self.assertIn(
                "claim C001 has invalid status certain",
                json.loads(result.stdout)["blocking"],
            )

    def test_claim_evidence_source_mismatch_is_blocking(self) -> None:
        """A claim may not cite one source while its evidence row came from another."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            self.replace_sources(
                project,
                [
                    [
                        "S001", "Paper one", "journal_article", "Author One", "2025",
                        "10.1/one", "https://example.test/one", "", "2026-08-09T00:00:00Z",
                        "full_text_checked", "include", "", "open_access",
                        "checked_scope=full_text", "L2", "peer-reviewed field journal", "", "", "",
                    ],
                    [
                        "S002", "Paper two", "journal_article", "Author Two", "2025",
                        "10.1/two", "https://example.test/two", "", "2026-08-09T00:00:00Z",
                        "full_text_checked", "include", "", "open_access",
                        "checked_scope=full_text", "L2", "peer-reviewed field journal", "", "", "",
                    ],
                ],
            )
            with (project / "evidence-table.csv").open(
                "a", encoding="utf-8", newline=""
            ) as handle:
                csv.writer(handle).writerow(
                    [
                        "E001", "S002", "p. 4", "survey", "students", "AI use",
                        "low use", "preparedness", "positive association",
                        "cross-sectional", "partial", "full_text", "agent-a", "",
                    ]
                )
            with (project / "claim-ledger.csv").open(
                "a", encoding="utf-8", newline=""
            ) as handle:
                csv.writer(handle).writerow(
                    [
                        "C001", "AI use is associated with preparedness.", "empirical",
                        "S001", "E001", "partial", "supported", "draft.md#results", "",
                    ]
                )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            self.assertIn(
                "claim C001 references evidence E001 from source S002 but source_ids does not include it",
                json.loads(result.stdout)["blocking"],
            )

    def test_proposal_artifact_requires_a_passed_formal_gate(self) -> None:
        """Catches a provisional label being used to bypass proposal prerequisites."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            path = project / "project-state.json"
            state = json.loads(path.read_text(encoding="utf-8"))
            state["project"]["deliverable"] = "导师开题讨论初稿"
            state["artifacts"] = ["proposal.md"]
            state.pop("gates", None)
            path.write_text(json.dumps(state), encoding="utf-8")

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            self.assertIn(
                "formal proposal artifact exists but formal_proposal gate is missing",
                payload["blocking"],
            )

    def test_formal_gate_pass_requires_every_field_and_basis(self) -> None:
        """Catches gate PASS when a load-bearing route field remains unknown."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            path = project / "project-state.json"
            state = json.loads(path.read_text(encoding="utf-8"))
            state["project"]["deliverable"] = "proposal"
            state["artifacts"] = ["proposal.md"]
            state["gates"] = {
                "formal_proposal": {
                    "status": "PASS",
                    "fields": {
                        "research_object": {"status": "USER_PROVIDED", "basis": "user"},
                        "disciplinary_frame": {"status": "UNKNOWN", "basis": ""},
                        "claim_type": {"status": "USER_DELEGATED", "basis": "option A"},
                        "feasible_evidence_data": {"status": "USER_PROVIDED", "basis": "survey access"},
                        "method_route": {"status": "USER_DELEGATED", "basis": "option A"},
                    },
                }
            }
            path.write_text(json.dumps(state), encoding="utf-8")

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            self.assertIn(
                "formal_proposal gate field disciplinary_frame is unresolved (UNKNOWN)",
                payload["blocking"],
            )

    def test_resolved_formal_gate_allows_a_proposal_artifact(self) -> None:
        """Allows a proposal only after all five route fields have auditable bases."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            path = project / "project-state.json"
            state = json.loads(path.read_text(encoding="utf-8"))
            state["project"]["deliverable"] = "proposal"
            state["artifacts"] = ["proposal.md"]
            state["gates"] = {
                "formal_proposal": {
                    "status": "PASS",
                    "fields": {
                        name: {"status": "USER_PROVIDED", "basis": f"confirmed {name}"}
                        for name in (
                            "research_object",
                            "disciplinary_frame",
                            "claim_type",
                            "feasible_evidence_data",
                            "method_route",
                        )
                    },
                }
            }
            path.write_text(json.dumps(state), encoding="utf-8")

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 0, result.stdout)
            self.assertTrue(json.loads(result.stdout)["ok"])

    def test_missing_project_state_is_blocking(self) -> None:
        """Catches validation that ignores the resumable state contract."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            (project / "project-state.json").unlink()

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            self.assertIn("missing required file project-state.json", payload["blocking"])

    def test_invalid_stage_status_is_blocking(self) -> None:
        """Catches state transitions that use an undefined status and cannot resume safely."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            path = project / "project-state.json"
            state = json.loads(path.read_text(encoding="utf-8"))
            state["stages"]["scope"]["status"] = "done-ish"
            path.write_text(json.dumps(state), encoding="utf-8")

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            self.assertIn("stage scope has invalid status done-ish", payload["blocking"])

    def test_true_fabrication_integrity_flag_is_blocking(self) -> None:
        """Catches a project being declared valid after recording fabricated execution."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            path = project / "project-state.json"
            state = json.loads(path.read_text(encoding="utf-8"))
            state["integrity"]["fabricated_execution"] = True
            path.write_text(json.dumps(state), encoding="utf-8")

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            self.assertIn(
                "integrity flag fabricated_execution is true", payload["blocking"]
            )

    def test_supported_claim_cannot_use_metadata_only_support(self) -> None:
        """Catches abstract-level metadata being promoted to substantive support."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            with (project / "source-ledger.csv").open(
                "a", encoding="utf-8", newline=""
            ) as handle:
                csv.writer(handle).writerow(
                    [
                        "S001",
                        "A paper",
                        "journal_article",
                        "Author",
                        "2025",
                        "10.1/example",
                        "",
                        "",
                        "2026-08-09T00:00:00Z",
                        "metadata_only",
                        "include",
                        "",
                        "open_access",
                        "",
                    ]
                )
            with (project / "evidence-table.csv").open(
                "a", encoding="utf-8", newline=""
            ) as handle:
                csv.writer(handle).writerow(
                    [
                        "E001",
                        "S001",
                        "abstract",
                        "unknown",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "metadata_only",
                        "metadata",
                        "agent-a",
                        "",
                    ]
                )
            with (project / "claim-ledger.csv").open(
                "a", encoding="utf-8", newline=""
            ) as handle:
                csv.writer(handle).writerow(
                    [
                        "C001",
                        "The method improves outcomes.",
                        "empirical",
                        "S001",
                        "E001",
                        "metadata_only",
                        "supported",
                        "draft.md#results",
                        "",
                    ]
                )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            self.assertIn(
                "claim C001 is supported with insufficient support_grade metadata_only",
                payload["blocking"],
            )

    def test_missing_ledger_columns_are_blocking(self) -> None:
        """Catches a syntactically readable ledger that cannot preserve provenance."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            (project / "source-ledger.csv").write_text(
                "source_id,title\n", encoding="utf-8"
            )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            self.assertIn(
                "ledger source-ledger.csv is missing required columns: accessed_at, authority_basis, authority_level, authors, doi, edition_or_version, license_or_access, local_path, notes, original_work, screening_reason, screening_status, source_type, translator, url, verification_status, year",
                payload["blocking"],
            )

    def test_missing_integrity_declarations_are_blocking(self) -> None:
        """Catches state files that omit the integrity contract entirely."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            path = project / "project-state.json"
            state = json.loads(path.read_text(encoding="utf-8"))
            del state["integrity"]
            path.write_text(json.dumps(state), encoding="utf-8")

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            self.assertIn(
                "project-state.json is missing integrity declarations",
                payload["blocking"],
            )

    def test_missing_required_stage_is_blocking(self) -> None:
        """Catches state files that cannot represent the full recovery lifecycle."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            path = project / "project-state.json"
            state = json.loads(path.read_text(encoding="utf-8"))
            del state["stages"]["protocol"]
            path.write_text(json.dumps(state), encoding="utf-8")

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            self.assertIn(
                "project-state.json is missing required stages: protocol",
                payload["blocking"],
            )

    def test_completed_review_cannot_leave_review_matrix_unverified(self) -> None:
        """Catches a final review being declared complete while its gates are untouched."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            path = project / "project-state.json"
            state = json.loads(path.read_text(encoding="utf-8"))
            state["stages"]["review"]["status"] = "completed"
            path.write_text(json.dumps(state), encoding="utf-8")

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            self.assertTrue(
                any("review-matrix.md" in message and "NOT_VERIFIED" in message
                    for message in payload["blocking"]),
                payload["blocking"],
            )

    def test_completed_review_requires_evidence_for_passed_gates(self) -> None:
        """Catches checkbox-only quality approval with no review artifact or rationale."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            state_path = project / "project-state.json"
            state = json.loads(state_path.read_text(encoding="utf-8"))
            state["stages"]["review"]["status"] = "completed"
            state_path.write_text(json.dumps(state), encoding="utf-8")
            (project / "review-matrix.md").write_text(
                "# Review\n\n"
                "| Gate | Status | Evidence / artifact | Blocking finding | Owner |\n"
                "|---|---|---|---|---|\n"
                "| Claims are supported | PASS | | | reviewer |\n",
                encoding="utf-8",
            )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            self.assertIn(
                "review-matrix.md gate 'Claims are supported' is PASS without evidence",
                payload["blocking"],
            )

    def test_completed_review_passes_with_resolved_evidenced_matrix(self) -> None:
        """Allows completion when every recorded gate has an auditable disposition."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            state_path = project / "project-state.json"
            state = json.loads(state_path.read_text(encoding="utf-8"))
            state["stages"]["review"]["status"] = "completed"
            state_path.write_text(json.dumps(state), encoding="utf-8")
            (project / "review-matrix.md").write_text(
                "# Review\n\n"
                "| Gate | Status | Evidence / artifact | Blocking finding | Owner |\n"
                "|---|---|---|---|---|\n"
                "| Claims are supported | PASS | claim-ledger.csv | | reviewer |\n"
                "| Regulated review | NOT_APPLICABLE | Non-regulated desk review | | reviewer |\n",
                encoding="utf-8",
            )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 0, result.stdout)
            self.assertTrue(json.loads(result.stdout)["ok"])

    def test_supported_claim_cannot_hide_metadata_only_evidence(self) -> None:
        """Catches a strong claim label that masks abstract-only linked evidence."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            with (project / "source-ledger.csv").open(
                "a", encoding="utf-8", newline=""
            ) as handle:
                csv.writer(handle).writerow(
                    [
                        "S001",
                        "A paper",
                        "journal_article",
                        "Author",
                        "2025",
                        "10.1/example",
                        "",
                        "",
                        "2026-08-09T00:00:00Z",
                        "metadata_only",
                        "include",
                        "",
                        "open_access",
                        "",
                    ]
                )
            with (project / "evidence-table.csv").open(
                "a", encoding="utf-8", newline=""
            ) as handle:
                csv.writer(handle).writerow(
                    [
                        "E001",
                        "S001",
                        "abstract",
                        "unknown",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "metadata_only",
                        "metadata",
                        "agent-a",
                        "",
                    ]
                )
            with (project / "claim-ledger.csv").open(
                "a", encoding="utf-8", newline=""
            ) as handle:
                csv.writer(handle).writerow(
                    [
                        "C001",
                        "The method improves outcomes.",
                        "empirical",
                        "S001",
                        "E001",
                        "strong",
                        "supported",
                        "draft.md#results",
                        "",
                    ]
                )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            self.assertIn(
                "claim C001 relies on metadata_only evidence E001",
                payload["blocking"],
            )

    def test_included_blocked_source_is_blocking(self) -> None:
        """Globally denied sources may stay in the audit trail but cannot be included."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            self.replace_sources(
                project,
                [[
                    "S001", "Anonymous sales article", "marketing_page", "", "2026",
                    "", "https://example.test/sales", "", "2026-08-09T00:00:00Z",
                    "metadata_only", "include", "", "public_web", "",
                    "BLOCKED", "anonymous promotional content with no provenance", "", "", "",
                ]],
            )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            self.assertIn(
                "source S001 is included but authority_level is BLOCKED",
                json.loads(result.stdout)["blocking"],
            )

    def test_excluded_blocked_source_may_remain_in_audit_trail(self) -> None:
        """A denied source remains traceable without being accidentally usable."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            self.replace_sources(
                project,
                [[
                    "S001", "Anonymous sales article", "marketing_page", "", "2026",
                    "", "https://example.test/sales", "", "2026-08-09T00:00:00Z",
                    "metadata_only", "exclude", "no provenance", "public_web", "",
                    "BLOCKED", "anonymous promotional content with no provenance", "", "", "",
                ]],
            )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 0, result.stdout)
            self.assertTrue(json.loads(result.stdout)["ok"])

    def test_authority_level_requires_recorded_basis(self) -> None:
        """A prestige label without the list, venue, institution, or edition basis is not auditable."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            self.replace_sources(
                project,
                [[
                    "S001", "A field journal article", "journal_article", "Author", "2025",
                    "10.1/example", "https://example.test/article", "", "2026-08-09T00:00:00Z",
                    "metadata_only", "include", "", "open_access", "",
                    "L2", "", "", "", "",
                ]],
            )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            self.assertIn(
                "source S001 has authority_level L2 without authority_basis",
                json.loads(result.stdout)["blocking"],
            )

    def test_translated_book_requires_translator_edition_and_original_work(self) -> None:
        """A translated edition must not masquerade as direct use of the original."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            self.replace_sources(
                project,
                [[
                    "S001", "A translated classic", "translated_book", "Original Author", "2020",
                    "", "", "book.pdf", "2026-08-09T00:00:00Z", "full_text_checked",
                    "include", "", "user_provided", "checked_scope=full_text",
                    "L1", "canonical scholarly work; translation used", "", "", "",
                ]],
            )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            blocking = json.loads(result.stdout)["blocking"]
            self.assertIn("translated source S001 has no edition_or_version", blocking)
            self.assertIn("translated source S001 has no translator", blocking)
            self.assertIn("translated source S001 has no original_work", blocking)

    def test_l3_source_cannot_back_substantive_evidence(self) -> None:
        """Commentary can orient the review but cannot carry an empirical claim."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            self.replace_sources(
                project,
                [[
                    "S001", "A serious commentary", "commentary", "Expert", "2025",
                    "", "https://example.test/commentary", "", "2026-08-09T00:00:00Z",
                    "full_text_checked", "include", "", "public_web",
                    "checked_scope=full_text", "L3", "signed expert commentary", "", "", "",
                ]],
            )
            with (project / "evidence-table.csv").open(
                "a", encoding="utf-8", newline=""
            ) as handle:
                csv.writer(handle).writerow(
                    [
                        "E001", "S001", "para. 4", "commentary", "", "", "", "",
                        "The intervention works", "no empirical method", "partial",
                        "full_text", "agent-a", "",
                    ]
                )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            self.assertIn(
                "evidence E001 has substantive support_grade partial but source S001 has authority_level L3",
                json.loads(result.stdout)["blocking"],
            )

    def test_l1_abstract_cannot_back_substantive_evidence(self) -> None:
        """Top-source status never promotes an abstract to checked full-text evidence."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            self.replace_sources(
                project,
                [[
                    "S001", "A top-venue article", "journal_article", "Author", "2025",
                    "10.1/example", "https://example.test/abstract", "", "2026-08-09T00:00:00Z",
                    "abstract_checked", "include", "", "publisher_page", "",
                    "L1", "JCR category Q1; 2026 release checked 2026-08-09", "", "", "",
                ]],
            )
            with (project / "evidence-table.csv").open(
                "a", encoding="utf-8", newline=""
            ) as handle:
                csv.writer(handle).writerow(
                    [
                        "E001", "S001", "abstract", "RCT", "students", "AI tutoring",
                        "control", "score", "improved", "", "partial", "abstract",
                        "agent-a", "",
                    ]
                )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            self.assertIn(
                "evidence E001 has substantive support_grade partial but source S001 is abstract_checked",
                json.loads(result.stdout)["blocking"],
            )

    def test_strict_profile_blocks_l2_substantive_evidence(self) -> None:
        """Strict mode keeps non-top field sources supplemental instead of claim-bearing."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            state_path = project / "project-state.json"
            state = json.loads(state_path.read_text(encoding="utf-8"))
            state["source_policy"] = {
                "profile": "strict",
                "discipline_profile": "user-defined top venue list",
                "classification_basis_date": "2026-08-09",
                "core_claim_levels": ["L1"],
                "context_levels": ["L1", "L2", "L3"],
                "blocked_levels": ["BLOCKED"],
            }
            state_path.write_text(json.dumps(state), encoding="utf-8")
            self.replace_sources(
                project,
                [[
                    "S001", "A reputable field article", "journal_article", "Author", "2025",
                    "10.1/example", "https://example.test/article", "", "2026-08-09T00:00:00Z",
                    "full_text_checked", "include", "", "open_access",
                    "checked_scope=full_text", "L2", "peer-reviewed field journal", "", "", "",
                ]],
            )
            with (project / "evidence-table.csv").open(
                "a", encoding="utf-8", newline=""
            ) as handle:
                csv.writer(handle).writerow(
                    [
                        "E001", "S001", "p. 4", "survey", "students", "AI use", "low use",
                        "preparedness", "positive association", "cross-sectional", "partial",
                        "full_text", "agent-a", "",
                    ]
                )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 1)
            self.assertIn(
                "evidence E001 uses authority_level L2 outside strict core_claim_levels L1",
                json.loads(result.stdout)["blocking"],
            )

    def test_balanced_profile_allows_l2_substantive_evidence(self) -> None:
        """Balanced mode accepts a verified reputable field source after method review."""
        with tempfile.TemporaryDirectory() as tmp:
            project = self.create_project(Path(tmp))
            state_path = project / "project-state.json"
            state = json.loads(state_path.read_text(encoding="utf-8"))
            state["source_policy"] = {
                "profile": "balanced",
                "discipline_profile": "field-specific profile",
                "classification_basis_date": "2026-08-09",
                "core_claim_levels": ["L1", "L2"],
                "context_levels": ["L1", "L2", "L3"],
                "blocked_levels": ["BLOCKED"],
            }
            state_path.write_text(json.dumps(state), encoding="utf-8")
            self.replace_sources(
                project,
                [[
                    "S001", "A reputable field article", "journal_article", "Author", "2025",
                    "10.1/example", "https://example.test/article", "", "2026-08-09T00:00:00Z",
                    "full_text_checked", "include", "", "open_access",
                    "checked_scope=full_text", "L2", "peer-reviewed field journal", "", "", "",
                ]],
            )
            with (project / "evidence-table.csv").open(
                "a", encoding="utf-8", newline=""
            ) as handle:
                csv.writer(handle).writerow(
                    [
                        "E001", "S001", "p. 4", "survey", "students", "AI use", "low use",
                        "preparedness", "positive association", "cross-sectional", "partial",
                        "full_text", "agent-a", "",
                    ]
                )

            result = run_script(VALIDATE_SCRIPT, str(project), "--json")

            self.assertEqual(result.returncode, 0, result.stdout)
            self.assertTrue(json.loads(result.stdout)["ok"])


if __name__ == "__main__":
    unittest.main()
