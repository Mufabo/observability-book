# House style guide — binding for every chapter author

This book is assembled from chapters written independently and then merged into one EPUB.
Consistency is therefore not a nicety, it is a build requirement. **Follow every rule below.**

---

## 1. The reader

A working software developer. Writes code daily. Can run `docker compose up`. Has **never** run a
monitoring system, has **never** been paged, and does not know what a time series is.

Consequences:

- Never assume ops vocabulary. The first use of a term is defined **in the sentence that uses it**,
  or in a `!!! jargon` box.
- Never say "simply", "just", "obviously", "of course", "as you know", "trivially".
- Explain *why* before *how*. A reader who does not know why they would ever want a histogram will
  not remember `histogram_quantile`.
- Analogies are welcome, but every analogy must be followed by where it breaks down.

## 2. Voice

- Second person, present tense. "You add a scrape target." Not "The user should add…", not "We will add…".
- **American English** throughout: *visualize, behavior, color, labeled, canceled, analyze*.
- Active voice. Short sentences. Vary paragraph length; never write a wall of six long paragraphs.
- Contractions are fine ("you'll", "don't"). Keep it warm and direct, not chatty and not stiff.
- No exclamation marks. No emoji. No "Let's dive in!".
- Never refer to "this book" doing things ("this book will teach you"); just teach.

## 3. Mandatory chapter skeleton

Every chapter file is one Markdown file with **exactly one `#` heading** — the chapter title —
in the form `# Chapter N — Title` (em dash, spaces around it).

```markdown
# Chapter 7 — Relabeling: the config nobody explains

<one to three paragraphs of hook: a concrete situation the reader can picture,
which the chapter resolves. No bullet lists here. No "in this chapter we will".>

!!! objectives "Objectives"
    After this chapter you can:

    - <verb-first, testable capability>
    - <5 to 6 of these>

## <first section>
...

## Common mistakes

<3 to 6 named mistakes. Each: what the reader does, what they see, why it happens, the fix.
Use a `!!! pitfall` box for the sharpest one or two, plain prose for the rest.>

## Summary

<A short recap in prose, then a bullet list of the durable takeaways —
the things the reader should still know in six months.>

## Exercises

!!! exercise
    **1. Short title (core).** The exercise text. Doable against the lab as it stands at
    the END of this chapter, with no forward references — a later chapter may be promised,
    never required. State a verifiable outcome: "you should see three targets `UP`", not
    "explore the targets page".

    **2. Another title (warm-up).** …
```

**The exercise block format is fixed, and it is the one above.** 3 to 6 exercises, all inside
a single `!!! exercise` admonition, each opening with a **bold number, a short title, and the
difficulty in parentheses**, in that order: `**3. Predict, then run (core).**` Difficulty is
one of `(warm-up)`, `(core)`, `(stretch)`.

Do not write `1. **(warm-up)**` with the number outside the bold, and do not put the exercises
in a bare numbered list outside the admonition. Both forms occur in early drafts and both are
wrong; 26 of 29 chapters already use the form above and the rest are being brought into line.

Solutions go in Appendix I, never inline.

Section headings use `##`; sub-sections `###`; go no deeper than `####`.
Headings are sentence case, not Title Case: `## Why pull beats push`, not `## Why Pull Beats Push`.

## 4. Markdown features you may use — and only these

### Admonitions

Four-space-indented content, blank line before and after the block.

```markdown
!!! note "Optional title"
    Body text.

!!! tip
    Body text.

!!! warning
    Something that will cost the reader time or data.

!!! pitfall "The classic mistake"
    A specific, named trap. Say what it looks like when you fall in.

!!! jargon "Cardinality"
    A one-paragraph definition of a term, placed at its first use.

!!! exercise
    Only inside the Exercises section.
```

The book also has six **recurring devices** mandated by `00-OUTLINE.md` §A.1 and §F.6.
Use exactly these class names — the stylesheet styles them distinctly:

```markdown
!!! iou "IOU — chapter 6"
    You do not understand this expression yet, and that is the plan. `rate()` arrives in
    chapter 6, `sum by` in chapter 8. Copy it for now.

!!! selfcheck "Self-check"
    Run `make verify-ch08`. It must print `ch08 OK`. If it does not, the ladder in
    Appendix B starts at rung 1.

!!! trap "Trap"
    A named, reproducible way to break this — printed with the wrong output, so you
    recognize it when it happens to you.

!!! sidebar "Where the extrapolation comes from"
    Skippable. The thread continues without it.

!!! ladder "Ladder → rung 4"
    Empty result? Appendix B, rung 4: the metric exists but not with those labels.

!!! grafana12 "If you are on Grafana 12.4"
    Dynamic Dashboards are opt-in here, so the edit flow differs. Everything else applies.
```

Full list of available classes: `note`, `info`, `tip`, `hint`, `warning`, `pitfall`, `jargon`,
`exercise`, `objectives`, `iou`, `selfcheck`, `trap`, `sidebar`, `ladder`, `grafana12`.
**No others** — anything else renders unstyled.

Rules for the recurring devices:

- Every `iou` names the exact chapter that repays it. When you repay one, say so:
  "IOU from chapter 3, settled."
- Every chapter has **at least one** `selfcheck`, and it must state the concrete expected
  output — a number, a count, a status, a passing command. Never "you should see it working."
- A `trap` shows the **wrong output**, not just a warning. Beginners recognize their own mistakes
  on sight; they do not recognize correct code.
- Never put load-bearing content in a `sidebar`. If the reader must have it, it is not a sidebar.

Budget: at most **one admonition per ~600 words**. They lose all force if the page is a wall of boxes.

### Code fences

Always tag the language. Recognized tags:

`promql` · `yaml` · `go` · `python` · `java` · `javascript` · `json` · `sql` · `dockerfile`
· `ini` · `bash` · `console` · `text` · `diff`

- `bash` — commands the reader types, one per block where practical, no `$` prompt.
- `console` — a captured session *with* output. Prefix input lines with `$ `.
- `text` — raw output, exposition-format samples, and ASCII diagrams.

**Hard limit: 76 characters per line inside any code fence.** E-reader screens are narrow and
long lines wrap into unreadable soup. Break long PromQL across lines; break long YAML values;
use `\` continuations in shell.

### ASCII diagrams

Use `text` fences. Box-drawing characters (`┌ ─ ┐ │ └ ┘ ├ ┤ ┬ ┴ ┼ ▶ ◀ ▲ ▼`) are supported and
preferred over `+--+`. **Maximum width 72 characters.** Label every arrow.

```text
┌──────────┐  GET /metrics   ┌────────────┐  PromQL   ┌─────────┐
│ checkout │◀────────────────│ Prometheus │◀──────────│ Grafana │
│  :8080   │   every 15s     │   :9090    │           │  :3000  │
└──────────┘                 └────────────┘           └─────────┘
```

Every diagram gets a sentence before it saying what to look at, and a sentence after it
saying what it proves.

### Tables

Maximum **4 columns**. Keep cells to a few words; a table cell is not a paragraph.
Every table gets an introductory sentence. If you need 6 columns, you need a list.

### Other

- Bullet and numbered lists: yes. Nested one level deep, no more.
- Footnotes (`[^1]`): sparingly, for asides only. Never for anything load-bearing.
- Bold for the first appearance of a key term. Italics for emphasis, rarely.
- **Do not use**: raw HTML, images, Mermaid, LaTeX/MathJax, `<details>`, horizontal rules,
  emoji, task lists, definition lists, or a `[TOC]` marker.

## 5. Cross-references

- Refer to chapters by number and title on first mention: *Chapter 4, "How Prometheus collects data"*.
  Afterwards just *Chapter 4*.
- **Never** reference page numbers, "above", "below", "the previous section", or "the next chapter"
  as a load-bearing pointer — reflowable text has no pages.
- **Never** forward-reference a concept the reader needs *now*. A forward reference is only allowed
  as a promise ("Chapter 11 shows how to make this fast"), never as a prerequisite.
- Check the concept dependency graph in `00-OUTLINE.md` before using any term. If a term is first
  taught in a later chapter, either define it inline or cut it.

## 6. Technical accuracy — non-negotiable

- Every PromQL expression, YAML snippet, CLI invocation, metric name, and config key must be
  **correct and current**. Ground truth, in priority order:
  1. `lab/LAB-SPEC.md` — service names, ports, metric names, labels, file paths. **Never invent one.**
  2. `research/00-FACT-SHEET.md` and `research/*.md` — versions, semantics, config schemas.
  3. Live official docs, if you must check something the research does not cover.
- Never invent a metric name. If the lab does not expose it, it does not exist in this book.
- Never invent a version number, a flag, or a function. If unsure, verify or omit.
- Pin image tags exactly as `LAB-SPEC.md` pins them. Never write `:latest`.
- Any output you show the reader must be plausible for the lab as configured — same job names,
  same instance labels, same value ranges.
- When something is version-dependent or experimental, say so explicitly and say since when.

## 7. The lab

- Every chapter's hands-on work builds on the lab **as the previous chapters left it**.
  State at the start of the lab section what state you assume, and how to get there
  (`cd lab && git checkout ch06` style, per `LAB-SPEC.md`).
- Every lab step ends with a **verification**: what to run, and the specific thing the reader
  should see. "You should now see three targets `UP` on http://localhost:9090/targets."
- Show file paths relative to the lab root, always as `lab/prometheus/prometheus.yml` style.
- When you modify a file, show the diff-sized excerpt with enough surrounding context to place it,
  not the whole file — unless the whole file is under 25 lines.

## 8. Length and rhythm

- Hit the word target in `00-OUTLINE.md` within ±15%.
- No section should run more than ~900 words without a code block, diagram, or box.
- Open every chapter with something concrete. Close every chapter with something the reader can do.
- Do not pad. A chapter that says its thing in 3,000 words should not be stretched to 6,000.

## 9. Things this book will not do

- No vendor pitching. Grafana Cloud, AMP and friends get an honest sentence, not a paragraph.
- No "in a future chapter we might". Either it is in the book or it is not.
- No unexplained magic. If a config block is copy-pasted, every non-obvious line is explained.
- No screenshots described as if present ("as you can see in the figure"). There are no figures.
  Describe the UI in words: "the panel header shows …".
- No claims about what "most teams" do without grounding them in the research.
