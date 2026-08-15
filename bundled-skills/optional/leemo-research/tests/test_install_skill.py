import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = SKILL_ROOT / "scripts" / "install_skill.py"


def run_script(
    *args: str, env: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        check=False,
    )


class InstallSkillTests(unittest.TestCase):
    def test_dry_run_resolves_explicit_parent_without_writing(self) -> None:
        """Catches a dry run that mutates the target or resolves the wrong folder."""
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp) / "skills"

            result = run_script(str(parent), "--dry-run")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(parent.exists())
            self.assertIn(str(parent / "leemo-research"), result.stdout)
            self.assertIn("DRY RUN", result.stdout)

    def test_installs_the_complete_skill_folder(self) -> None:
        """Catches installers that copy only SKILL.md and lose references or assets."""
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp) / "skills"

            result = run_script(str(parent))

            destination = parent / "leemo-research"
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((destination / "SKILL.md").is_file())
            self.assertTrue((destination / "references").is_dir())
            self.assertTrue((destination / "scripts").is_dir())
            self.assertTrue((destination / "assets").is_dir())

    def test_refuses_overwrite_unless_force_is_explicit(self) -> None:
        """Catches silent replacement of an installed, possibly customized skill."""
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp) / "skills"
            destination = parent / "leemo-research"
            destination.mkdir(parents=True)
            sentinel = destination / "custom.txt"
            sentinel.write_text("keep me", encoding="utf-8")

            refused = run_script(str(parent))

            self.assertEqual(refused.returncode, 2)
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep me")

            forced = run_script(str(parent), "--force")

            self.assertEqual(forced.returncode, 0, forced.stderr)
            self.assertFalse(sentinel.exists())
            self.assertTrue((destination / "SKILL.md").is_file())

    def test_codex_target_respects_codex_home(self) -> None:
        """Catches installing into the default home when CODEX_HOME redirects Codex."""
        with tempfile.TemporaryDirectory() as tmp:
            codex_home = Path(tmp) / "custom-codex"
            env = os.environ.copy()
            env["CODEX_HOME"] = str(codex_home)

            result = run_script("codex", "--dry-run", env=env)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(
                str(codex_home / "skills" / "leemo-research"), result.stdout
            )

    def test_refuses_a_target_inside_the_source_skill(self) -> None:
        """Catches recursive self-copy into a descendant of the source package."""
        nested_parent = SKILL_ROOT / "nested-install-test"

        result = run_script(str(nested_parent), "--dry-run")

        self.assertEqual(result.returncode, 2)
        self.assertIn("inside the source skill", result.stderr.lower())
        self.assertFalse(nested_parent.exists())


if __name__ == "__main__":
    unittest.main()
