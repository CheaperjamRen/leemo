"""Install the complete leemo-research skill into a skills parent directory."""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path


SKILL_NAME = "leemo-research"
SKILL_ROOT = Path(__file__).resolve().parents[1]


def _default_parent(name: str) -> Path | None:
    """Return the conventional skills directory for a supported client."""
    home = Path.home()
    if name.lower() == "codex" and os.environ.get("CODEX_HOME"):
        return Path(os.environ["CODEX_HOME"]).expanduser() / "skills"
    return {
        "claude": home / ".claude" / "skills",
        "codex": home / ".codex" / "skills",
        "agents": home / ".agents" / "skills",
    }.get(name.lower())


def _destination(parent: str) -> Path:
    return (_default_parent(parent) or Path(parent).expanduser()).resolve() / SKILL_NAME


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Install the complete leemo-research skill."
    )
    parser.add_argument(
        "parent",
        help="Installation parent directory, or one of: claude, codex, agents",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show the destination without changing the filesystem",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Replace an existing installation",
    )
    return parser


def install(parent: str, *, dry_run: bool = False, force: bool = False) -> int:
    destination = _destination(parent)

    if destination == SKILL_ROOT or SKILL_ROOT in destination.parents:
        print(
            f"Refusing to install inside the source skill: {destination}",
            file=sys.stderr,
        )
        return 2

    if dry_run:
        print(f"DRY RUN: would install {SKILL_NAME} to {destination}")
        return 0

    if destination.exists() or destination.is_symlink():
        if not force:
            print(
                f"Refusing to overwrite existing installation: {destination}",
                file=sys.stderr,
            )
            return 2
        if destination.is_dir() and not destination.is_symlink():
            shutil.rmtree(destination)
        else:
            destination.unlink()

    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(
        SKILL_ROOT,
        destination,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    print(f"Installed {SKILL_NAME} to {destination}")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        return install(args.parent, dry_run=args.dry_run, force=args.force)
    except OSError as exc:
        print(f"Installation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
