#!/usr/bin/env python3
"""
Build the EPUB3 from the Markdown manuscript.

Usage:
    python build/build_epub.py [--manifest manuscript/manifest.json] [--out ../Book.epub]

Manifest format (JSON):
{
  "title": "...", "subtitle": "...", "author": "...", "language": "en",
  "identifier": "urn:uuid:...", "date": "2026", "description": "...",
  "publisher": "...", "rights": "...",
  "cover": "build/cover.png",
  "css":   "build/styles.css",
  "items": [
     {"type": "titlepage"},
     {"type": "chapter",  "file": "00-preface.md",  "title": "Preface"},
     {"type": "part",     "title": "Foundations", "label": "Part I", "blurb": "..."},
     {"type": "chapter",  "file": "ch01-....md",   "title": "Why observability?"},
     {"type": "appendix", "file": "app-a-....md",  "title": "Appendix A — ..."}
  ]
}

If no manifest exists, every `manuscript/*.md` (except files starting with `00-OUTLINE`
and `_`) is treated as a chapter, ordered by filename.
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import uuid

import markdown
from bs4 import BeautifulSoup
from ebooklib import epub
from pygments.formatters import HtmlFormatter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# --------------------------------------------------------------------------
# Markdown -> XHTML
# --------------------------------------------------------------------------

MD_EXTENSIONS = [
    "extra",          # tables, fenced_code, footnotes, attr_list, def_list, abbr, md_in_html
    "admonition",
    "codehilite",
    "sane_lists",
    "smarty",
    "toc",
]

MD_CONFIG = {
    "codehilite": {
        "guess_lang": False,
        "use_pygments": True,
        "linenums": False,
        "pygments_style": "friendly",
        "noclasses": False,
    },
    "toc": {
        "permalink": False,
        "toc_depth": "2-3",
    },
    "smarty": {
        # keep quotes plain — code-adjacent prose and curly quotes fight each other
        "smart_quotes": False,
        "smart_dashes": True,
        "smart_ellipses": True,
        "smart_angled_quotes": False,
    },
}

# characters that mark a plain-text block as an ASCII diagram
DIAGRAM_CHARS = set("│─┌┐└┘├┤┬┴┼╭╮╰╯━┃▲▼◀▶↑↓←→")
DIAGRAM_LINE_RE = re.compile(r"^\s*[+|].*[+|]\s*$")


def make_md() -> markdown.Markdown:
    md = markdown.Markdown(
        extensions=MD_EXTENSIONS,
        extension_configs=MD_CONFIG,
        output_format="xhtml",
        tab_length=4,
    )
    return md


def looks_like_diagram(text: str) -> bool:
    lines = text.splitlines()
    if len(lines) < 3:
        return False
    hits = 0
    for ln in lines:
        if any(ch in DIAGRAM_CHARS for ch in ln) or DIAGRAM_LINE_RE.match(ln):
            hits += 1
    return hits >= 2


def postprocess(body_html: str, title: str) -> str:
    """Tidy the generated HTML: tag diagrams, harden code blocks, fix stray issues."""
    soup = BeautifulSoup(body_html, "html.parser")

    # 1. tag ASCII-art blocks so the stylesheet can tighten them
    for div in soup.find_all("div", class_="codehilite"):
        pre = div.find("pre")
        if pre is None:
            continue
        if looks_like_diagram(pre.get_text()):
            classes = div.get("class", [])
            if "diagram" not in classes:
                div["class"] = classes + ["diagram"]

    # 2. plain <pre> blocks (no codehilite wrapper) get the same treatment
    for pre in soup.find_all("pre"):
        if pre.parent is not None and "codehilite" in (pre.parent.get("class") or []):
            continue
        if looks_like_diagram(pre.get_text()):
            pre["class"] = (pre.get("class") or []) + ["diagram"]

    # 3. objectives boxes:  a blockquote-free convention —
    #    "> **In this chapter**" is fragile, so we support an explicit
    #    <div class="objectives"> written by the author, and also auto-upgrade
    #    an admonition titled "Objectives".
    for div in soup.find_all("div", class_="admonition"):
        t = div.find("p", class_="admonition-title")
        if t and t.get_text(strip=True).lower() in ("objectives", "learning objectives"):
            div["class"] = ["objectives"]
            t["class"] = ["objectives-title"]

    # 4. drop any stray <script>/<style> an author may have pasted
    for bad in soup.find_all(["script", "style"]):
        bad.decompose()

    return str(soup)


def render_markdown(path: str) -> tuple[str, str, list[tuple[str, str]]]:
    """Return (html_body, title, [(anchor, h2_text), ...])."""
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()

    # strip an optional YAML front-matter block
    if text.startswith("---\n"):
        end = text.find("\n---\n", 4)
        if end != -1:
            text = text[end + 5:]

    md = make_md()
    body = md.convert(text)
    body = postprocess(body, path)

    soup = BeautifulSoup(body, "html.parser")
    h1 = soup.find("h1")
    title = h1.get_text(strip=True) if h1 else os.path.basename(path)

    subs: list[tuple[str, str]] = []
    for h2 in soup.find_all("h2"):
        anchor = h2.get("id")
        if anchor:
            subs.append((anchor, h2.get_text(strip=True)))

    return str(soup), title, subs


# --------------------------------------------------------------------------
# Manifest
# --------------------------------------------------------------------------

def load_manifest(path: str | None) -> dict:
    if path and os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)

    ms_dir = os.path.join(ROOT, "manuscript")
    files = sorted(
        f for f in os.listdir(ms_dir)
        if f.endswith(".md") and not f.startswith(("_", "00-OUTLINE"))
    )
    return {
        "title": "Observability with Prometheus and Grafana",
        "subtitle": "A Hands-On Introduction",
        "author": "Co-Authored with Claude",
        "language": "en",
        "identifier": "urn:uuid:" + str(uuid.uuid5(uuid.NAMESPACE_DNS, "obs-prom-grafana-book")),
        "date": "2026",
        "cover": "build/cover.png",
        "css": "build/styles.css",
        "items": [{"type": "titlepage"}] + [{"type": "chapter", "file": f} for f in files],
    }


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def pygments_css() -> str:
    base = HtmlFormatter(style="friendly").get_style_defs("div.codehilite")
    dark = """
@media (prefers-color-scheme: dark) {
  div.codehilite pre span            { color: #dcdcdc; }
  div.codehilite .c,  div.codehilite .c1, div.codehilite .cm,
  div.codehilite .cs, div.codehilite .cp                { color: #8a94a0; font-style: italic; }
  div.codehilite .k,  div.codehilite .kc, div.codehilite .kd,
  div.codehilite .kn, div.codehilite .kp, div.codehilite .kr,
  div.codehilite .kt                                    { color: #9ecbff; font-weight: bold; }
  div.codehilite .s,  div.codehilite .s1, div.codehilite .s2,
  div.codehilite .sb, div.codehilite .sc, div.codehilite .sd,
  div.codehilite .se, div.codehilite .sh, div.codehilite .si,
  div.codehilite .sx, div.codehilite .sr, div.codehilite .ss  { color: #b6e3a0; }
  div.codehilite .m,  div.codehilite .mi, div.codehilite .mf,
  div.codehilite .mh, div.codehilite .mo, div.codehilite .il  { color: #f2b880; }
  div.codehilite .nf, div.codehilite .fm                { color: #d2a8ff; }
  div.codehilite .nt                                    { color: #9ecbff; }
  div.codehilite .na                                    { color: #ffd9a0; }
  div.codehilite .nb, div.codehilite .bp                { color: #79c0ff; }
  div.codehilite .o,  div.codehilite .ow                { color: #ff9c6e; }
  div.codehilite .err                                   { color: #ff8888; border: none; }
  div.codehilite .gp                                    { color: #8a94a0; }
}
"""
    return base + "\n" + dark


def esc(s: str) -> str:
    return html.escape(s, quote=False)


def build(manifest: dict, out_path: str) -> None:
    lang = manifest.get("language", "en")
    book = epub.EpubBook()
    book.set_identifier(manifest.get("identifier") or ("urn:uuid:" + str(uuid.uuid4())))
    book.set_title(manifest["title"])
    book.set_language(lang)
    book.add_author(manifest.get("author", "Unknown"))

    if manifest.get("description"):
        book.add_metadata("DC", "description", manifest["description"])
    if manifest.get("publisher"):
        book.add_metadata("DC", "publisher", manifest["publisher"])
    if manifest.get("rights"):
        book.add_metadata("DC", "rights", manifest["rights"])
    if manifest.get("date"):
        book.add_metadata("DC", "date", str(manifest["date"]))
    for kw in manifest.get("subjects", []):
        book.add_metadata("DC", "subject", kw)

    # ---- stylesheet ------------------------------------------------------
    css_src = os.path.join(ROOT, manifest.get("css", "build/styles.css"))
    with open(css_src, "r", encoding="utf-8") as fh:
        css_text = fh.read()
    css_text += "\n\n/* ---- pygments ---- */\n" + pygments_css()

    css_item = epub.EpubItem(
        uid="style_main",
        file_name="style/main.css",
        media_type="text/css",
        content=css_text.encode("utf-8"),
    )
    book.add_item(css_item)

    # ---- cover -----------------------------------------------------------
    cover_rel = manifest.get("cover")
    if cover_rel:
        cover_path = os.path.join(ROOT, cover_rel)
        if os.path.exists(cover_path):
            with open(cover_path, "rb") as fh:
                book.set_cover("images/cover.png", fh.read(), create_page=True)

    spine: list = ["cover", "nav"]
    toc: list = []
    current_part: list | None = None   # [epub.Section, [children]]

    def add_doc(uid: str, filename: str, title: str, body: str, epubtype: str = "") -> epub.EpubHtml:
        # ebooklib builds <html>/<head>/<body> itself from `title` + linked items,
        # and parses `content` as an HTML *fragment*. Passing a full document (or a
        # unicode string carrying an XML declaration) makes lxml throw and ebooklib
        # silently emit an empty file — so hand it a bare fragment.
        item = epub.EpubHtml(uid=uid, file_name=filename, lang=lang, title=title)
        if epubtype:
            body = f'<section epub:type="{epubtype}">\n{body}\n</section>'
        item.content = body
        item.add_item(css_item)
        book.add_item(item)
        spine.append(item)
        return item

    def push_toc(entry) -> None:
        if current_part is not None:
            current_part[1].append(entry)
        else:
            toc.append(entry)

    counter = 0
    for spec in manifest["items"]:
        kind = spec.get("type", "chapter")
        counter += 1

        # ---------------- title page ------------------------------------
        if kind == "titlepage":
            body = f"""<section class="title-page" epub:type="titlepage">
  <p class="book-title">{esc(manifest['title'])}</p>
  <p class="book-subtitle">{esc(manifest.get('subtitle', ''))}</p>
  <p class="book-author">{esc(manifest.get('author', ''))}</p>
  <p class="book-meta">{esc(str(manifest.get('date', '')))}</p>
</section>"""
            add_doc("titlepage", "title.xhtml", manifest["title"], body, "frontmatter")
            continue

        # ---------------- part opener -----------------------------------
        if kind == "part":
            if current_part is not None:
                toc.append((current_part[0], current_part[1]))
            label = spec.get("label", "")
            title = spec["title"]
            blurb = spec.get("blurb", "")
            blurb_html = ""
            if blurb:
                md = make_md()
                blurb_html = f'<div class="part-blurb">{md.convert(blurb)}</div>'
            body = f"""<section class="part-opener">
  <p class="part-label">{esc(label)}</p>
  <h1>{esc(title)}</h1>
  {blurb_html}
</section>"""
            fn = f"part{counter:03d}.xhtml"
            item = add_doc(f"part{counter:03d}", fn, f"{label} — {title}" if label else title, body)
            section = epub.Section(f"{label} — {title}" if label else title, href=item.file_name)
            current_part = [section, []]
            continue

        # ---------------- chapter / appendix ----------------------------
        rel = spec["file"]
        src = os.path.join(ROOT, "manuscript", rel)
        if not os.path.exists(src):
            print(f"  !! MISSING {rel} — skipped", file=sys.stderr)
            continue

        body, detected_title, subs = render_markdown(src)
        title = spec.get("title") or detected_title
        stem = re.sub(r"[^a-zA-Z0-9]+", "-", os.path.splitext(rel)[0]).strip("-")
        fn = f"{stem}.xhtml"
        etype = "backmatter" if kind == "appendix" else ("frontmatter" if kind == "front" else "bodymatter")
        item = add_doc(stem, fn, title, body, etype)

        if spec.get("toc", True):
            if subs and spec.get("subtoc", True) and kind not in ("front",):
                children = [
                    epub.Link(f"{item.file_name}#{a}", t, f"{stem}-{a}")
                    for a, t in subs
                ]
                push_toc((epub.Section(title, href=item.file_name), children))
            else:
                push_toc(epub.Link(item.file_name, title, stem))

        words = len(re.findall(r"\w+", BeautifulSoup(body, "html.parser").get_text()))
        print(f"  + {title[:62]:<64} {words:>7,} words")

    if current_part is not None:
        toc.append((current_part[0], current_part[1]))

    book.toc = tuple(toc)
    book.add_item(epub.EpubNcx())
    nav = epub.EpubNav()
    nav.add_item(css_item)
    book.add_item(nav)
    book.spine = spine

    epub.write_epub(out_path, book, {"epub3_pages": False})
    print(f"\nwrote {out_path} ({os.path.getsize(out_path):,} bytes)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=os.path.join(ROOT, "manuscript", "manifest.json"))
    ap.add_argument("--out", default=os.path.join(ROOT, "Observability-with-Prometheus-and-Grafana.epub"))
    args = ap.parse_args()

    manifest = load_manifest(args.manifest)
    print(f"Building '{manifest['title']}' ...")
    build(manifest, args.out)


if __name__ == "__main__":
    main()
