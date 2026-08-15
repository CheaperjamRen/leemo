"""Initialize a Leemo research project from the bundled templates."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path


ASSETS_DIR = Path(__file__).resolve().parents[1] / "assets"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--title", default="")
    parser.add_argument("--question", default="")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def initialize_project(destination: Path, title: str, question: str, force: bool) -> None:
    if destination.exists():
        if not destination.is_dir():
            raise ValueError("destination is not a directory")
        if any(destination.iterdir()) and not force:
            raise ValueError("destination is not empty; use --force to refresh managed files")
    else:
        destination.mkdir(parents=True)

    managed_files = sorted(path for path in ASSETS_DIR.iterdir() if path.is_file())
    for asset in managed_files:
        target = destination / asset.name
        if asset.name == "project-state.json":
            state = json.loads(asset.read_text(encoding="utf-8"))
            now = utc_timestamp()
            state["project"]["title"] = title
            state["project"]["research_question"] = question
            state["created_at"] = now
            state["updated_at"] = now
            state["stages"]["intake"]["status"] = "completed"
            state["stages"]["scope"]["status"] = "in_progress"
            target.write_text(
                json.dumps(state, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        else:
            shutil.copy2(asset, target)


def main() -> int:
    args = parse_args()
    try:
        initialize_project(args.destination, args.title, args.question, args.force)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
