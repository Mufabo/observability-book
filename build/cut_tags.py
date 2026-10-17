#!/usr/bin/env python3
"""
Build the obslab git history: 29 commits, tags ch01..ch29, main at ch29.

The book calls the lab "one git repository called obslab", so the repository is
lab/ itself — the reader clones that, not the book project around it.

    python build/cut_tags.py --dry-run
    python build/cut_tags.py

Each commit is the full assembled state of that chapter (build/assemble.py), so
`git checkout ch07` gives a working tree the reader can `make up`.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import stat
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LAB = os.path.join(ROOT, "lab")
MS = os.path.join(ROOT, "manuscript")
SCRATCH = os.environ.get(
    "OBSLAB_SCRATCH",
    r"C:\Users\fatih\AppData\Local\Temp\claude"
    r"\C--Users-fatih-Desktop-Co-Authored-with-Claude"
    r"\ff0d43dd-98b0-46ae-ad93-8bb48428a4dd\scratchpad\tags")

# Never wiped between chapters, never committed.
#
# The three status files are project meta rather than lab content, so
# assemble.py deliberately omits them (its SKIP_EXACT). That means wiping the
# worktree and copying an assembled tree back DELETES them — which is exactly
# what happened on 2026-09-18, destroying MEASURED.md, VERIFY-STATUS.md and
# BUILD-STATUS.md. They had never been committed, so there was nothing to
# restore from. Preserving them here is the fix; keep this list in sync with
# assemble.py's SKIP_EXACT.
PRESERVE = {".git", ".history",
            "MEASURED.md", "VERIFY-STATUS.md", "BUILD-STATUS.md"}

TRAILER = "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"


def run(args: list[str], cwd: str, check: bool = True) -> str:
    p = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if check and p.returncode != 0:
        raise SystemExit(f"$ {' '.join(args)}\n{p.stdout}\n{p.stderr}")
    return (p.stdout or "") + (p.stderr or "")


def chapter_titles() -> dict[int, str]:
    out: dict[int, str] = {}
    for f in sorted(os.listdir(MS)):
        m = re.match(r"ch(\d{2})-.*\.md$", f)
        if not m:
            continue
        for line in io.open(os.path.join(MS, f), encoding="utf-8"):
            if line.startswith("# "):
                t = line[2:].strip()
                t = re.sub(r"^Chapter\s+\d+\s*[—-]\s*", "", t)
                out[int(m.group(1))] = re.sub(r"`", "", t)
                break
    return out


def wipe_worktree() -> None:
    for name in os.listdir(LAB):
        if name in PRESERVE:
            continue
        path = os.path.join(LAB, name)
        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)


def copy_tree(src: str) -> None:
    for base, _dirs, files in os.walk(src):
        for f in files:
            s = os.path.join(base, f)
            rel = os.path.relpath(s, src)
            d = os.path.join(LAB, rel)
            os.makedirs(os.path.dirname(d), exist_ok=True)
            shutil.copy2(s, d)


def mark_executable():
    # The working tree lives on NTFS, where git runs with core.fileMode=false
    # and `git add` records every file as 100644. A reader on Linux or macOS
    # then gets "Permission denied" from every `./scripts/...` the book
    # prints. Anything that starts with a shebang is meant to be run: stage
    # it as 100755 explicitly.
    paths = []
    for rel in run(["git", "ls-files"], LAB).splitlines():
        with open(os.path.join(LAB, rel), "rb") as fh:
            if fh.read(2) == b"#!":
                paths.append(rel)
    for i in range(0, len(paths), 100):
        run(["git", "update-index", "--chmod=+x", "--"] + paths[i:i + 100], LAB)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--from-chapter", type=int, default=1)
    ap.add_argument("--to-chapter", type=int, default=29)
    a = ap.parse_args()

    titles = chapter_titles()
    py = sys.executable

    # Pre-flight: every chapter must assemble without problems.
    print("pre-flight: assembling every chapter")
    bad = []
    for n in range(a.from_chapter, a.to_chapter + 1):
        dest = os.path.join(SCRATCH, f"ch{n:02d}")
        p = subprocess.run([py, os.path.join(HERE, "assemble.py"), str(n), dest, "--quiet"],
                           capture_output=True, text=True)
        if p.returncode != 0:
            bad.append((n, (p.stdout + p.stderr).strip()[:200]))
    if bad:
        print("  assembly problems — refusing to build history:")
        for n, msg in bad:
            print(f"    ch{n:02d}: {msg}")
        return 1
    print(f"  ok: {a.to_chapter - a.from_chapter + 1} chapters assemble cleanly")

    if a.dry_run:
        for n in range(a.from_chapter, a.to_chapter + 1):
            dest = os.path.join(SCRATCH, f"ch{n:02d}")
            cnt = sum(len(fs) for _, _, fs in os.walk(dest))
            print(f"  ch{n:02d}  {cnt:>4} files  {titles.get(n, '')[:52]}")
        print("\ndry run — nothing committed")
        return 0

    # Fresh repository at lab/.
    # git marks objects read-only, and Windows refuses to unlink a read-only
    # file — shutil.rmtree then dies with WinError 5 partway through, leaving a
    # half-deleted .git. Clear the bit and retry.
    def _force(func, path, _exc):
        os.chmod(path, stat.S_IWRITE)
        func(path)

    if os.path.isdir(os.path.join(LAB, ".git")):
        shutil.rmtree(os.path.join(LAB, ".git"), onerror=_force)
    run(["git", "init", "-b", "main"], LAB)
    run(["git", "config", "user.name", "Co-Authored with Claude"], LAB)
    run(["git", "config", "user.email", "noreply@anthropic.com"], LAB)
    # .history is reconstruction scratch, not part of the lab the reader gets.
    with io.open(os.path.join(LAB, ".git", "info", "exclude"), "a", encoding="utf-8") as fh:
        fh.write("\n.history/\n")

    for n in range(a.from_chapter, a.to_chapter + 1):
        dest = os.path.join(SCRATCH, f"ch{n:02d}")
        wipe_worktree()
        copy_tree(dest)
        run(["git", "add", "-A"], LAB)
        mark_executable()
        title = titles.get(n, f"chapter {n}")
        msg = (f"ch{n:02d}: {title}\n\n"
               f"The lab as it stands at the end of chapter {n}.\n"
               f"Checking out this tag gives a tree that `make up` can run.\n\n"
               f"{TRAILER}\n")
        p = subprocess.run(["git", "commit", "-q", "--allow-empty", "-m", msg],
                           cwd=LAB, capture_output=True, text=True)
        if p.returncode != 0:
            raise SystemExit(f"commit failed at ch{n:02d}:\n{p.stdout}\n{p.stderr}")
        run(["git", "tag", "-a", f"ch{n:02d}", "-m", f"chapter {n}: {title}"], LAB)
        files = len(run(["git", "ls-files"], LAB).strip().split("\n"))
        print(f"  ch{n:02d}  {files:>4} files  {title[:50]}")

    print("\nhistory built")
    print(run(["git", "log", "--oneline", "--decorate", "-5"], LAB))
    print(f"tags: {len(run(['git', 'tag'], LAB).split())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
