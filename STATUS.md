# Project status

Updated 2026-10-17. Keep this current — this project spans sessions and session
limits interrupt work mid-flight.

## The deliverable

`Observability-with-Prometheus-and-Grafana.epub` — built, validated, delivered.
29 chapters + 9 appendices + front matter, ~269,000 words, 887 KB, 531-entry three-level TOC.
Rebuild with:

```bash
PY="C:/Users/fatih/AppData/Local/Programs/Python/Python310/python.exe"
"$PY" build/make_manifest.py && "$PY" build/build_epub.py
```

**Use the 3.10 interpreter explicitly.** Python 3.14 is first on PATH and does not have
`markdown`, `ebooklib`, `pygments`, `bs4`, `lxml` or `Pillow`. **Go is no longer installed** on
this machine — compile checks run in `golang:1.25-alpine` (see `build/fix_history.js` for the
container invocation).

## The lab: DONE, with a real git history

`lab/` is now its own git repository — **29 commits, tags `ch01`..`ch29`, `main` at ch29** — which
is what the book means by "one git repository called obslab".

Verified, not asserted:

| Check | Result |
|---|---|
| `go build ./...` at every chapter | 29/29 |
| `promtool check config` at every chapter | 29/29 |
| `promtool check rules` (ch15+) | 15/15 |
| `promtool test rules` (ch18+) | 12/12 |
| `docker compose config` at every chapter | 29/29 |
| ch29 `diff -r` against the live lab | 0 differences |
| `git checkout ch07` builds | yes, 64 files, `worker.go` correctly absent |
| **ch01 started for real** | 5 services healthy, `verify-ch01.sh` 4/4 |
| **ch20 started for real** | 11 services healthy, `TSDB retention updated duration=45d` |

Rebuild the history from scratch (idempotent — it re-inits `lab/.git`):

```bash
"$PY" build/chapter_map.py && "$PY" build/cut_tags.py
```

`build/assemble.py <N> <dir>` materialises any chapter's tree on demand.
`lab/.history/` holds the reconstructed per-chapter versions of the 18 files that evolve; it is
git-excluded and is scratch, not part of what the reader gets.

## Chapter verification state

Pipeline: draft → 2 independent verifiers (technical / teaching) → repair.
Drafting alone ~280k tokens/chapter; the full pipeline ~960k.

| State | Chapters |
|---|---|
| **Verified + repaired** | 1–17 (Parts I–V complete) |
| **Drafted, single-reviewer pass 2026-10-16 — not through the two-verifier pipeline** | 18–29 |
| **Back matter — written, not verified** | front matter, appendices A–I |

```bash
# Workflow tool, scriptPath = build/write_chapters.js
# args: {"chapters": [N], "stage": "full"}     full pipeline
# args: {"chapters": [N], "stage": "draft"}    draft/revise only
```

## Review pass 2026-10-16

`REVIEW-2026-10-16.md` lists every finding. All manuscript findings are fixed and the EPUB is
rebuilt; `lab/` was not touched, so the tags did not need regenerating. The book now states the
lab convention once, in the front matter: each tag is its chapter's end state; read along on
`chNN`, then recreate from `chNN-1`. Chapters 18–29 each say so in their lab section.

Lab follow-up, 2026-10-17: `docs/runbooks/SnipSLIAbsent.md` written (ch19, added to the
`LAB-SPEC.md` §4 tree), `verify-ch19.sh` now checks all four runbooks (19 assertions), and
`scenario-noise-history.sh` sends `SnipSLIAbsent` as `page` to match the rule. History rebuilt
with `chapter_map.py && cut_tags.py`; `promtool test rules` passes at `ch19` and `ch29`.

Measured 2026-10-17 (`lab/MEASURED.md` §12): ch19's noise audit was re-run on a live `ch19`
stack, with six hours of Watchdog, then the scenario, then the audit. Every printed figure in
ch19 and App I 19.3 now comes from that run. The measurement corrected three claims:
- The heartbeat is every **two** minutes, not one: 180 in six hours, not 360.
- The `increase()` rows don't sum to the `increase()` total, because series born inside the
  window lose their first sample. The raw counters agree.
- `SnipTargetDown` and `SnipHighErrorRatio` **tie** at the top; a single winner is not possible
  with this script.

The run also exposed that every tag committed files as `100644`, so `./scripts/*.sh` failed after
a clone. `cut_tags.py` now stages shebang files as `100755` (44 at ch29).

## Work outstanding, in priority order

1. **12 chapters unverified (18–29).** This is the largest remaining quality gap. The pass finds real
   defects every time: ch01 took 22 fixes (including an exercise telling the reader to *add* a
   `command:` key, which Compose rejects as a duplicate YAML key); ch02 took 23 (including a
   `networks: aliases` block that exists nowhere in the real lab, and a query using `cluster`,
   which is an *external* label and never appears in an ordinary query).
2. ~~**Exercise formatting is inconsistent**~~ — **DONE 2026-09-20. All 29 chapters conform.**
   It was **six** variants, not three, and two chapters had no `!!! exercise` block at all.
   `_STYLE-GUIDE.md` §3 now pins the form and names the wrong ones. The normaliser is
   `build/normalize_exercises.py` (run it from `manuscript/`; `--write` commits, `--skip 12,13`
   spares chapters an agent is holding). It rewrites each header to `**N. Title (difficulty).**`,
   folds per-exercise admonitions into one block, and checks that no line is lost or invented.
   It deliberately **refuses** a chapter whose exercises have no titles to reuse (ch07, ch26,
   ch28 — a title has to be written, not generated); those 16 were titled by hand. Chapters
   12–17 were converted by their own repair agents, because the brief carried the pinned form.
   Re-run it after any chapter pass; it is idempotent.


3. **`lab/.history/AUDIT.md` §3 minors** — eight open items, all cosmetic or prose.
4. ~~**`docs/runbooks/SnipSLIAbsent.md` is missing**~~ — **DONE 2026-10-17** (runbook, verify
   script and ch19 prose).
5. **Never run end to end:** `make history && make backfill && verify-ch20`. Every component has
   now been exercised separately; the cycle has not. Note the backfill staleness guard fires
   correctly today because `fixtures/history.om` ends 48 days ago — regenerate before testing.
6. **Appendix H is 17,529 words** against a 9,000 spec. Not a defect; trim if the book reads
   back-heavy.

## Governing documents, in authority order

1. `lab/MEASURED.md` — measured from the running stack. Outranks everything for any figure.
2. `lab/VERIFY-STATUS.md` — which verify scripts actually pass. **All four checker defects
   V1–V4 now have fixed scripts**; V2's chapter text was rewritten 2026-10-16 (ch22 trap, ch22 self-check, App I 22.5, ch29 chain list), and V2/V3 each
   owe one live run at their own chapter's stack. The CRLF outbreak is closed and cannot recur
   (`lab/.gitattributes` is committed).
3. `lab/` source · `lab/SPEC-DELTAS.md` (runtime findings R1–R6) · `lab/LAB-SPEC.md`
   (amendment A3: main line is Go)
4. `manuscript/_specs/_POLICY.md` · `_DEPENDENCY-GRAPH.md` · `manuscript/_STYLE-GUIDE.md`
5. `research/*.md`, with `research/_CONFLICTS.md` as the quarantine list — nothing on it may be
   printed as fact.
