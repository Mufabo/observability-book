#!/usr/bin/env python3
"""Generate manuscript/manifest.json: title page, front matter, nine parts, appendices."""
from __future__ import annotations

import glob
import io
import json
import os
import re
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MS = os.path.join(ROOT, "manuscript")

PARTS = [
    ("Part I", "Get something on the screen", 1, 3),
    ("Part II", "Make the metrics yours", 4, 7),
    ("Part III", "Ask better questions", 8, 11),
    ("Part IV", "Run it like you mean it", 12, 14),
    ("Part V", "Alerts that reach the right human", 15, 19),
    ("Part VI", "Alerts that don't cry wolf", 20, 21),
    ("Part VII", "Everything you didn't write", 22, 23),
    ("Part VIII", "Living with it", 24, 26),
    ("Part IX", "The wider world", 27, 29),
]


def part_blurbs() -> dict[int, str]:
    """Map part index -> its opener paragraph.

    Keyed off each '## PART <roman> —' heading rather than by match order. An
    earlier version matched '> **Part opener.**' blocks and used their position,
    which silently shifted every blurb by one as soon as a single part wrote
    '> **Part opener (1 paragraph).**' instead — Part I did exactly that, so
    every part from II onward carried the previous part's text.
    """
    path = os.path.join(MS, "00-OUTLINE.md")
    if not os.path.exists(path):
        return {}
    text = io.open(path, encoding="utf-8").read()

    heads = [(m.start(), m.group(1))
             for m in re.finditer(r"^## (PART [IVX]+) — .*$", text, re.M)]
    out: dict[int, str] = {}
    for i, (pos, _label) in enumerate(heads):
        end = heads[i + 1][0] if i + 1 < len(heads) else len(text)
        chunk = text[pos:end]
        m = re.search(r"^> \*\*Part opener[^*]*\*\*(.*?)(?=\n(?!>))",
                      chunk, re.M | re.S)
        if not m:
            continue
        cleaned = " ".join(line.lstrip("> ").strip()
                           for line in m.group(1).strip().split("\n"))
        out[i] = re.sub(r"\s+", " ", cleaned).strip()
    return out


def title_of(path: str) -> str:
    for line in io.open(path, encoding="utf-8"):
        if line.startswith("# "):
            return re.sub(r"\s+", " ", line[2:].strip())
    return os.path.basename(path)


def main() -> None:
    blurbs = part_blurbs()

    chapters = {}
    for f in sorted(glob.glob(os.path.join(MS, "ch*.md"))):
        n = int(os.path.basename(f)[2:4])
        chapters[n] = os.path.basename(f)

    items = [{"type": "titlepage"}]

    fm = os.path.join(MS, "00-front-matter.md")
    if os.path.exists(fm):
        items.append({"type": "front", "file": "00-front-matter.md",
                      "title": title_of(fm), "subtoc": True})

    for idx, (label, name, lo, hi) in enumerate(PARTS):
        items.append({"type": "part", "label": label, "title": name,
                      "blurb": blurbs.get(idx, "")})
        for n in range(lo, hi + 1):
            if n not in chapters:
                print(f"  !! chapter {n} missing")
                continue
            p = os.path.join(MS, chapters[n])
            items.append({"type": "chapter", "file": chapters[n],
                          "title": title_of(p)})

    apps = sorted(glob.glob(os.path.join(MS, "app-*.md")))
    if apps:
        items.append({"type": "part", "label": "Appendices",
                      "title": "Reference",
                      "blurb": "Material you will come back to: the lab in full, a debugging "
                               "ladder, PromQL by type, naming and cardinality checklists, the "
                               "same three metrics in three more languages, how to read older "
                               "material, a promtool cookbook, the certification map, and "
                               "worked solutions to every exercise."})
        for a in apps:
            items.append({"type": "appendix", "file": os.path.basename(a),
                          "title": title_of(a)})

    manifest = {
        "title": "Observability with Prometheus and Grafana",
        "subtitle": "A Hands-On Introduction",
        "author": "Co-Authored with Claude",
        "language": "en",
        "identifier": "urn:uuid:" + str(
            uuid.uuid5(uuid.NAMESPACE_DNS, "obs-prom-grafana-2026")),
        "date": "2026",
        "publisher": "Co-Authored with Claude",
        "description": (
            "A hands-on introduction to observability for developers who have never operated "
            "anything. Instrument a real service, query it with PromQL, build dashboards that "
            "tell the truth, and set up alerts that do not cry wolf — building one Docker "
            "Compose stack that grows chapter by chapter."),
        "subjects": ["Prometheus", "Grafana", "Observability", "Monitoring",
                     "PromQL", "SRE", "DevOps", "Alerting"],
        "rights": "Written against Prometheus 3.13.1 and Grafana 13.1.1, verified 2026-09-18.",
        "cover": "build/cover.png",
        "css": "build/styles.css",
        "items": items,
    }

    out = os.path.join(MS, "manifest.json")
    with io.open(out, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1, ensure_ascii=False)

    n_ch = len([i for i in items if i.get("type") == "chapter"])
    n_ap = len([i for i in items if i.get("type") == "appendix"])
    n_pt = len([i for i in items if i.get("type") == "part"])
    missing_blurb = [p[0] for i, p in enumerate(PARTS) if not blurbs.get(i)]
    print(f"wrote {out}")
    print(f"  {n_pt} parts, {n_ch} chapters, {n_ap} appendices, {len(items)} spine items")
    if missing_blurb:
        print(f"  !! no part-opener blurb found for: {', '.join(missing_blurb)}")


if __name__ == "__main__":
    main()
