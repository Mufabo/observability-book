#!/usr/bin/env python3
"""
Assemble the lab as it stands at the end of chapter N.

    python build/assemble.py 7 /tmp/ch07      # write the tree
    python build/assemble.py 7 --list         # just list what would be included

Rules:
  * an add-only file is included when its creation chapter (build/chapter_map.json) <= N
  * an evolving file uses the newest version in lab/.history/chNN/<path> with NN <= N,
    falling back to the live file in lab/ when no earlier version was reconstructed
  * files a chapter explicitly retires are dropped (RETIRED below)

Exit code is non-zero if anything is missing, so it can gate the git build.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LAB = os.path.join(ROOT, "lab")
HIST = os.path.join(LAB, ".history")
MAP = os.path.join(HERE, "chapter_map.json")

# LAB-SPEC names exactly these removals. path -> first chapter at which it is gone.
RETIRED: dict[str, int] = {}

# Never committed: build output, audit artefacts, the reconstruction scratch area.
SKIP_PREFIX = (".history/", ".git/")
SKIP_EXACT = {"runtime-audit.json", "BUILD-STATUS.md", "VERIFY-STATUS.md", "MEASURED.md"}
SKIP_SUFFIX = (".exe", ".pyc", ".log")


def load_map() -> dict[str, int]:
    with io.open(MAP, encoding="utf-8") as fh:
        return json.load(fh)


def history_versions(path: str) -> dict[int, str]:
    """chapter -> absolute path of the reconstructed version of `path`."""
    out: dict[int, str] = {}
    if not os.path.isdir(HIST):
        return out
    for entry in os.listdir(HIST):
        if not entry.startswith("ch"):
            continue
        try:
            n = int(entry[2:])
        except ValueError:
            continue
        cand = os.path.join(HIST, entry, path.replace("/", os.sep))
        if os.path.isfile(cand):
            out[n] = cand
    return out


def plan(chapter: int) -> tuple[list[tuple[str, str]], list[str]]:
    """Return (files_to_write, problems)."""
    cmap = load_map()
    files: list[tuple[str, str]] = []
    problems: list[str] = []

    for path, created in sorted(cmap.items()):
        if path.startswith(SKIP_PREFIX) or path in SKIP_EXACT:
            continue
        if path.endswith(SKIP_SUFFIX):
            continue
        if created > chapter:
            continue
        if RETIRED.get(path, 10**9) <= chapter:
            continue

        versions = history_versions(path)
        usable = [n for n in versions if n <= chapter]
        if usable:
            src = versions[max(usable)]
        else:
            src = os.path.join(LAB, path.replace("/", os.sep))
            if versions:
                # reconstructed, but only for later chapters: the live (ch29) file
                # would be an anachronism here.
                problems.append(
                    f"ch{chapter:02d}: {path} exists from ch{created} but the earliest "
                    f"reconstructed version is ch{min(versions):02d} — would ship the "
                    f"final file")
        if not os.path.isfile(src):
            problems.append(f"ch{chapter:02d}: {path} missing on disk ({src})")
            continue
        files.append((path, src))
    return files, problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("chapter", type=int)
    ap.add_argument("dest", nargs="?")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()

    files, problems = plan(a.chapter)

    if a.list or not a.dest:
        if not a.quiet:
            for p, src in files:
                tag = "live" if src.startswith(LAB) and HIST not in src else \
                    os.path.basename(os.path.dirname(os.path.dirname(src)))
                print(f"  {p}")
        print(f"ch{a.chapter:02d}: {len(files)} files, {len(problems)} problems")
        for pr in problems:
            print(f"  !! {pr}")
        return 1 if problems else 0

    if os.path.isdir(a.dest):
        shutil.rmtree(a.dest)
    for path, src in files:
        dst = os.path.join(a.dest, path.replace("/", os.sep))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)

    if not a.quiet:
        print(f"ch{a.chapter:02d}: wrote {len(files)} files to {a.dest}")
    for pr in problems:
        print(f"  !! {pr}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
