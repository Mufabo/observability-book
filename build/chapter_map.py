#!/usr/bin/env python3
"""
Derive, for every file in lab/, the chapter at which it first exists.

Sources, in order:
  1. LAB-SPEC.md §4 directory tree — entries carry a `(chNN)` marker when they
     are introduced later than chapter 1.
  2. LAB-SPEC.md §8 growth plan — the "files created" column.
Anything named by neither is assumed to exist from chapter 1, which is what the
tree means by an unmarked entry.

Writes build/chapter_map.json:  {"<repo-relative path>": <chapter int>, ...}
"""
from __future__ import annotations

import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LAB = os.path.join(ROOT, "lab")
SPEC = os.path.join(LAB, "LAB-SPEC.md")


def tree_markers() -> dict[str, int]:
    """Walk the §4 ASCII tree, tracking indent depth to rebuild full paths."""
    text = io.open(SPEC, encoding="utf-8").read()
    start = text.index("## §4. THE DIRECTORY TREE")
    end = text.index("## §5.")
    block = text[start:end]
    m = re.search(r"```\n(.*?)```", block, re.S)
    if not m:
        return {}
    out: dict[str, int] = {}
    stack: list[tuple[int, str]] = []
    dir_ch: list[tuple[int, int]] = []  # (depth, chapter) for directories in scope
    for raw in m.group(1).split("\n"):
        if not raw.strip() or "obslab/" in raw:
            continue
        # strip the drawing characters, keep their width so depth survives
        drawn = re.sub(r"[│├└─]", " ", raw)
        name_part = drawn.strip()
        if not name_part or name_part.startswith("#"):
            continue
        indent = len(drawn) - len(drawn.lstrip())
        depth = indent // 4
        name = name_part.split()[0].rstrip("/")
        if not name or name.startswith("("):
            continue
        while stack and stack[-1][0] >= depth:
            stack.pop()
        while dir_ch and dir_ch[-1][0] >= depth:
            dir_ch.pop()
        path = "/".join([p for _, p in stack] + [name])
        stack.append((depth, name))

        # `(ch15)`, `(ch15; grows in ch20)` and `(ch16; annotations rewritten ch19)`
        # all mean the same thing for our purposes: the file first exists at 15/16.
        m_ch = re.search(r"\(ch(\d+)", raw)
        ch = int(m_ch.group(1)) if m_ch else None

        if name_part.split()[0].endswith("/") or "." not in name:
            # A directory. Its marker applies to everything beneath it, which is
            # how the tree records `provisioning/ (ch3)` and `alertmanager/ (ch17)`
            # without repeating the chapter on every child.
            inherited = dir_ch[-1][1] if dir_ch else 1
            dir_ch.append((depth, ch if ch is not None else inherited))
            continue

        inherited = dir_ch[-1][1] if dir_ch else 1
        out[path] = max(ch if ch is not None else 1, inherited)
    return out


def growth_created() -> dict[str, int]:
    text = io.open(SPEC, encoding="utf-8").read()
    sec = text[text.index("## §8. THE CHAPTER-BY-CHAPTER GROWTH PLAN"):]
    sec = sec[:sec.index("## §9.")]
    out: dict[str, int] = {}
    for line in sec.split("\n"):
        if not line.startswith("| **"):
            continue
        cols = [c.strip() for c in line.split("|")[1:-1]]
        if len(cols) < 2:
            continue
        ch = int(re.sub(r"\D", "", cols[0]) or 0)
        for f in re.findall(r"`([^`]+)`", cols[1]):
            if "." in f and "/" in f or f.endswith((".yml", ".yaml", ".json", ".go",
                                                    ".py", ".sh", ".md", ".sql", ".txt")):
                out.setdefault(f.lstrip("./"), ch)
    return out


# Build artefacts and audit output, not lab content. Never committed.
EXCLUDE_EXACT = {"runtime-audit.json"}
EXCLUDE_SUFFIX = (".exe", ".pyc", ".log")

# A service's whole directory arrives with the service, whatever the tree says
# about individual files inside it (Dockerfiles are rarely listed with a marker).
DIR_CHAPTER = {"catalog/": 4, "pager/": 17, "edge/": 12}


def real_files() -> list[str]:
    out = []
    for base, dirs, files in os.walk(LAB):
        dirs[:] = [d for d in dirs
                   if d not in (".git", ".history", "__pycache__", "node_modules")]
        for f in files:
            p = os.path.relpath(os.path.join(base, f), LAB).replace("\\", "/")
            if p in EXCLUDE_EXACT or p.endswith(EXCLUDE_SUFFIX):
                continue
            out.append(p)
    return sorted(out)


def main() -> None:
    markers = tree_markers()
    growth = growth_created()
    files = real_files()

    # Files that are project scaffolding rather than lab content: present from ch1.
    ALWAYS = ("LAB-SPEC.md", "SPEC-DELTAS.md", "BUILD-STATUS.md", "MEASURED.md",
              "VERIFY-STATUS.md", "README.md", "LICENSE", ".gitignore",
              ".dockerignore", ".env.example")

    mapping: dict[str, int] = {}
    unresolved: list[str] = []
    for f in files:
        base = os.path.basename(f)
        if base in ALWAYS or f in ALWAYS:
            mapping[f] = 1
            continue
        # A service directory cannot predate the service it implements.
        dirhit = next((ch for pre, ch in DIR_CHAPTER.items() if f.startswith(pre)), None)
        if dirhit is not None:
            mapping[f] = max(dirhit, markers.get(f, 0), growth.get(f, 0))
            continue
        if f in markers:
            mapping[f] = markers[f]
        elif base in markers:
            mapping[f] = markers[base]
        elif f in growth:
            mapping[f] = growth[f]
        elif base in growth:
            mapping[f] = growth[base]
        else:
            # verify-chNN.sh belongs to its own chapter
            m = re.search(r"verify-ch(\d+)\.sh$", f)
            if m:
                mapping[f] = int(m.group(1))
            else:
                mapping[f] = 1
                unresolved.append(f)

    out = os.path.join(HERE, "chapter_map.json")
    with io.open(out, "w", encoding="utf-8") as fh:
        json.dump(mapping, fh, indent=1, sort_keys=True)

    import collections
    hist = collections.Counter(mapping.values())
    print(f"mapped {len(mapping)} files -> {out}")
    print("files first appearing at each chapter:")
    for ch in sorted(hist):
        print(f"   ch{ch:02d}: {hist[ch]}")
    if unresolved:
        print(f"\n{len(unresolved)} file(s) named by neither the tree nor the growth "
              f"plan, defaulted to ch1:")
        for u in unresolved[:25]:
            print(f"   {u}")


if __name__ == "__main__":
    sys.exit(main())
