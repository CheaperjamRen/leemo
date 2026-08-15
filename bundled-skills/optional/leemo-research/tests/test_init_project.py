import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = SKILL_ROOT / "scripts" / "init_project.py"
EXPECTED_FILES = {
    "research-brief.md",
    "project-state.json",
    "source-ledger.csv",
    "evidence-table.csv",
    "claim-ledger.csv",
    "experiment-log.md",
    "review-matrix.md",
}


def run_script(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


class InitProjectTests(unittest.TestCase):
    def test_creates_a_complete_project_with_traceable_initial_state(self) -> None:
        """Catches missing templates or a state file that loses the supplied brief."""
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / "study"

            result = run_script(
                str(destination),
                "--title",
                "AI and job-search preparation",
                "--question",
                "How does verified AI use relate to job-search preparation?",
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                {path.name for path in destination.iterdir()}, EXPECTED_FILES
            )
            state = json.loads(
                (destination / "project-state.json").read_text(encoding="utf-8")
            )
            self.assertEqual(state["schema_version"], "1.0")
            self.assertEqual(state["project"]["title"], "AI and job-search preparation")
            self.assertEqual(
                state["project"]["research_question"],
                "How does verified AI use relate to job-search preparation?",
            )
            self.assertEqual(state["stages"]["intake"]["status"], "completed")
            self.assertEqual(state["stages"]["scope"]["status"], "in_progress")
            self.assertTrue(state["created_at"].endswith("Z"))

    def test_refuses_a_nonempty_destination_without_force(self) -> None:
        """Catches accidental overwrite of an existing research workspace."""
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / "study"
            destination.mkdir()
            sentinel = destination / "keep.txt"
            sentinel.write_text("user data", encoding="utf-8")

            result = run_script(str(destination))

            self.assertEqual(result.returncode, 2)
            self.assertIn("destination is not empty", result.stderr.lower())
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "user data")
            self.assertNotIn("project-state.json", {p.name for p in destination.iterdir()})

    def test_force_preserves_unrelated_files_while_refreshing_managed_files(self) -> None:
        """Catches a force mode that deletes unrelated user files."""
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / "study"
            destination.mkdir()
            sentinel = destination / "keep.txt"
            sentinel.write_text("user data", encoding="utf-8")
            stale = destination / "research-brief.md"
            stale.write_text("stale", encoding="utf-8")

            result = run_script(str(destination), "--force")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "user data")
            self.assertNotEqual(stale.read_text(encoding="utf-8"), "stale")


if __name__ == "__main__":
    unittest.main()
