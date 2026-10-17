# Open conflicts between dossiers — must be resolved before the manuscript is final

Editor-maintained. Every item here is a place where two research agents disagreed, or where a
dossier flagged itself UNVERIFIED on something the book will state as fact. **Nothing on this list
may be printed as a bare fact until it is resolved and marked RESOLVED below.**

---

## C1. Grafana "current stable" version — RESOLVED

- `pedagogy.md` §1 and §9.5 say the current Grafana OSS release is **12.4.6**.
- `grafana-core.md` (the specialist dossier, with a full release table and support-window matrix)
  says **13.1.1** (2026-07-21) is latest stable, and that **12.4.6** is the final minor of the
  12 line, on patch support until May 2027.

**Resolution: `grafana/grafana:13.1.1`.** The specialist dossier wins — it enumerates the release
table, the support windows and the Docker tag variants; the pedagogy agent only needed a version in
passing and read less deeply.

**Consequence for the manuscript:** write against 13.1, and keep `grafana-core.md` §15 (the
12.4-vs-13 differences list) handy — the book should flag the handful of places a reader on a
corporate 12.4.x install will see something different, because that support window runs to 2027.
Ignore the `12.4.6` pin in `pedagogy.md` §1.

---

## C2. Which Prometheus release line is LTS — OPEN

- `promql.md` §0: **3.13.0** (2026-07-01) marked Long Term Support; 3.5.x is the *previous* LTS.
- `pedagogy.md` §1: prometheus.io/download marks **3.5.5** as LTS; explicitly flags this
  **UNVERIFIED** and asks for re-verification before the book pins an LTS.

Both agree **3.13.1** (2026-07-10) is the current *latest* release, so the lab pin
(`prom/prometheus:v3.13.1`) is not in question. Only the LTS *claim* is.

**Action:** the `prometheus-core` dossier must settle this against prometheus.io/download and the
GitHub releases page. Until then the book must not name an LTS version. If it stays ambiguous,
say "Prometheus publishes an LTS line; check prometheus.io/download for the current one" and
name no number.

---

## C3. Docker tag registries for the exporters — OPEN

Mentions across dossiers are inconsistent about registry prefixes for the same component:

- `prom/node-exporter:v1.12.1` vs `quay.io/prometheus/node-exporter:v1.12.1`
- `prom/alertmanager:v0.33.1` vs `quay.io/prometheus/alertmanager:v0.33.1`

Both registries do publish these, but a textbook lab must pick one and use it everywhere.

**Action:** the lab spec picks one registry per image and every chapter uses that exact string.
Verify each pinned tag actually exists before the manuscript is frozen.

---

## C4. Native histogram stability wording — RESOLVED

`pedagogy.md` §9.2 quotes the spec: stable as a feature since **v3.8.0**, `native-histograms`
feature flag a no-op from v3.9 — *but* scraping is still opt-in via `scrape_native_histograms: true`
and `send_native_histograms: true`, both defaulting to true only from v4.

This is exactly the kind of half-true the book must not fumble: "experimental" is now wrong,
"just use them" is also wrong.

**Resolution: confirmed, and one canonical paragraph fixed.** `prometheus-core.md` §3
("Native histograms: the exact status", which cites `docs/migration.md` @ v3.13.1 and
`cmd/prometheus/main.go`) corroborates every clause independently of `pedagogy.md`:
stable at 3.8.0; the flag a no-op from 3.9, with the exact startup log line; both
`scrape_native_histograms` and `send_native_histograms` defaulting to true only in 4.0. The
canonical wording is the one recorded in `manuscript/_specs/_POLICY.md` §A.2 and printed verbatim
in the chapter 10 box "Native histograms, exactly". It is reused unchanged wherever the subject
comes up; no chapter paraphrases it.

`pedagogy.md` also flags an unfetched blog post — "Modernizing Prometheus: Native Storage for
Composite Types" (2026-02-14). Not needed for the paragraph above, which is settled against the
release table; read it only if a later chapter wants to go past the three opt-ins.

---

## C6. Alertmanager route-level `labels` / `routeLabels` — RESOLVED (self-conflict within one dossier)

A second, independent research pass on `alertmanager-exporters.md` (2026-07-27) contradicted the first pass
of the same dossier:

- First pass, §3.2 and §4.2: listed route-level `labels:` in the `<route>` block and `routeLabels` in the
  template-function list, recommending `labels` for an advanced sidebar.
- Second pass: **neither exists in the released v0.33.1.**

**Resolution: they do not exist. Do not print them.** Evidence:

- `config/config.go` at tag **`v0.33.1`** — `type Route struct` has **no `Labels` field**.
- `config/config.go` on **`main`** — has `Labels model.LabelSet \`yaml:"labels,omitempty"\``.
- `prometheus.io/docs/alerting/0.33/configuration/` (version-pinned) — no `labels:` in the route block.
  `prometheus.io/docs/alerting/latest/` (tracks `main`) — shows it.

A reader on 0.33.1 who copies a route containing `labels:` gets a config parse error. Corrections are applied
inline in the dossier; the release these ship in is UNVERIFIED.

**Generalised action for every dossier, not just this one:** `/docs/.../latest/` and
`raw.githubusercontent.com/.../main/docs/` **document unreleased work.** Verify version-sensitive config keys
against a version-pinned docs URL or a git tag. The same trap produced a third error in this dossier (the
stale "UTF-8 strict mode becomes the default in the next two versions" line, written for 0.27 and still
untrue at 0.33.1 — verified against every CHANGELOG entry from 0.28 through 0.33.1). Worth a spot-check pass
over `grafana-core.md` and `promql.md` for the same failure mode.

---

## C5. Anything a dossier marked UNVERIFIED

Each dossier has its own UNVERIFIED section. Those items are quarantined by default: a chapter may
not state them. The verification pass either confirms them (and they become printable) or the
sentence is cut. Known so far:

- Whether `grafana/grafana` and `grafana/grafana-oss` are identical builds — do not claim either way
  (`grafana-core.md`).
- Docker Hub tag *format* conventions (`v`-prefix for Prometheus images, none for Grafana) were
  asserted from practice, not confirmed against Docker Hub (`promql.md` §0).
