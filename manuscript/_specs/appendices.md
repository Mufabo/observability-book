# §E. APPENDICES

Reference-ordered, because the narrative is not. A reader who wants a manual gets one; a reader who
wants to learn gets the lab.

---

### Appendix A — The Complete Lab: `compose.yaml`, Every Config File, and the Chapter Tag Map
**Target: 2,500 words**

The final annotated `compose.yaml` with every pinned image tag, port, volume and flag, each line
annotated with the chapter that added it and why. Both overlay files. The complete
`prometheus/prometheus.yml`, all rule files, both Grafana provisioning YAMLs, the Alertmanager config,
the blackbox modules and the Caddyfile. The service inventory table. The **loadgen control-API
reference** and the **`SNIP_*` teaching-switch catalogue** (each switch, the failure it summons, and
the chapter that uses it). The `make` target list. The **pinned-version table with the exact tag
string and the date each pin was verified**, plus the registry policy from §A.3. The chapter → git tag
map (`ch01` … `ch29`). Platform notes that save an evening: named volumes rather than bind mounts for
the TSDB and Grafana data; why node_exporter under Docker Desktop measures the VM; the cAdvisor
Docker Desktop mounts; Apple Silicon and ARM image availability; Compose v2 conventions and the
obsolete `version:` key.

*Lab role:* the reader diffs their own tree against it and reconciles. `git checkout ch<NN> && make up`
is the recovery path from any broken state.

---

### Appendix B — The No-Data Debugging Ladder (tear-out)
**Target: 1,800 words**

The **twelve-rung** decision procedure for "my graph is empty", introduced in chapter 1 in a four-rung
form, completed in chapter 2, and cited **by rung number** in every subsequent chapter's
troubleshooting box rather than repeated:

1. Does the target exist in `/targets` at all?
2. Is `up` 1 for it?
3. Did the scrape fail on `Content-Type` (Prometheus 3 does not fall back)?
4. Does the metric name exist — check the Metrics Explorer, not your memory.
5. Does the **bare selector** return anything?
6. Add label matchers back **one at a time** — and check for the anchored-regex and
   empty-string-matcher surprises.
7. Has this label value ever occurred? A never-observed series does not exist.
8. Add the function **last**.
9. Is the range at least 4× the scrape interval? (Two samples is the bare minimum.)
10. Widen the time picker — and check the panel's Min step and Max data points.
11. Is the series stale, or did the target set its own timestamps?
12. Is one side of a binary operation missing, so one-to-one matching dropped everything?

Each rung carries **the tell that identifies it, the exact command or query that tests it, and the
chapter that explains the mechanism**. Includes the signature table pairing each of the twelve most
common failure modes with its one-line tell, and **the answer key to chapter 14's five planted lies**.

*Shipped as a printable PDF in the repo and as a Grafana text panel pinned to the top of the
troubleshooting dashboard.*

---

### Appendix C — PromQL Organised by Type
**Target: 3,500 words**

A reference arranged the way the evaluation model works rather than alphabetically, with **two
indexes**.

*By question* — "how many per second", "what fraction failed", "how slow for the slowest 5%", "is
anything missing", "will it fill up before Monday", "what version is deployed", "what was the peak" —
each mapping to the canonical expression and the chapter that earned it.

*By type* — which functions consume a range vector, which an instant vector, which return scalars; the
aggregation operators; the binary operators with their precedence table; the label-manipulation
functions; the vector-matching rules on one page.

Every entry flags **whether it needs a feature flag in 3.13.1** (`promql-experimental-functions`,
`promql-duration-expr`, `promql-extended-range-selectors`, `promql-binop-fill-modifiers`,
`use-start-timestamps`) and **whether its name changed since Prometheus 2** —
`holt_winters` → `double_exponential_smoothing`, `min`/`max` → `min_of`/`max_of`. Ends with the short
list of functions people believe exist but do not, and what they actually meant. Every entry links to
a one-line query that runs against the finished lab.

---

### Appendix D — Metric and Label Design Checklist, with the Cardinality Worksheet
**Target: 1,800 words**

A one-page review sheet to run before any new metric is merged, for the rest of the reader's career:
counter or gauge by the can-it-go-down test; does the name pass the aggregation test; base unit, with
the unit suffix before the type suffix; `_total` on counters; no label name embedded in the metric
name; no unit or metric type in a label; no target labels emitted from application code; every label
value bounded and the bound written down; the cardinality product computed; the histogram multiplier
included; histogram buckets justified against a stated threshold; a default zero exported for every
label value known in advance; is anything here really an exemplar. Followed by the **cardinality
worksheet** used in chapters 7 and 24, the base-unit table (seconds, bytes, ratio 0–1, celsius, volts,
amperes, joules), and the table of known-dangerous label names.

*Shipped as a pull-request template in the lab repo.*

---

### Appendix E — The Same Three Metrics in Go, Java and Node
**Target: 3,500 words**

Snip's counter, gauge and histogram ported line for line to `client_golang` v1.24.1,
`io.prometheus:prometheus-metrics-core` 1.8.0 (the 1.x rewrite, `io.prometheus.metrics.*` — **not** the
dead `simpleclient` line) and `prom-client` 15.1.3, with a table of exactly what differs and what does
not. The language-specific traps, each of which costs an evening:

- **Go**: `prometheus.NewRegistry()` starts **empty**, so `collectors.NewGoCollector()` and
  `collectors.NewProcessCollector()` must be registered or every runtime dashboard is silently blank;
  `promauto.With(reg)` inside a constructor taking a `prometheus.Registerer`, never a package-level
  `var` block against the default registry (the library's own docs are blunt about this); the
  `promhttp` middleware rule that permits **only** `code` and `method` as non-const labels and
  **panics at wrap time** otherwise (extra dimensions need `MustCurryWith` or
  `WithLabelFromCtx`/`WithLabelFromRequest`); a panicking handler is reported as **nothing at all**, so
  recovery middleware must sit inside the instrumentation chain; `Opts.Unit` and `WithUnit()` are
  metadata only and do **not** append a suffix; there is **no** `/v2` module path.
- **Java 1.x**: emits classic **and** native histograms by default with zero configuration;
  `labelValues()` not `labels()`; exemplars created automatically when OpenTelemetry tracing is on the
  classpath; use the BOM.
- **Node**: `register.metrics()` returns a Promise, so a missing `await` serves the literal string
  `[object Promise]`; `prom-client` 16 does **not** exist on npm.
- **Python** (the main line, collected here for completeness): the Gunicorn/uWSGI multiprocess trap —
  `PROMETHEUS_MULTIPROC_DIR` cleared at startup, `MultiProcessCollector`, `mark_process_dead` in the
  worker-exit hook, and an explicit `multiprocess_mode` on gauges.

Plus **the cross-language default-bucket comparison table** that explains why the same service in two
languages produces different `le` values — the fact chapter 10 made observable.

*Lab role, optional:* swap `catalog` for the Node port shipped in the repo and confirm that no
dashboard, recording rule or alert needs to change — except the one panel that hardcodes a bucket
boundary.

---

### Appendix F — Reading Older Material Without Being Misled
**Target: 2,500 words**

The most practically valuable appendix, because the reader will Google. An **"if the page says X, it
now means Y"** table, deliberately placed last so the reader meets it after they know enough to use it.

*Prometheus 2 → 3:* left-open range selectors and the sample arithmetic that follows; `le="1"`
normalised to `le="1.0"`; regex `.` now matching newlines; strict scrape `Content-Type` with no
fallback; no implicit `:80`/`:443` on targets; retention flags deprecated in favour of config fields;
`--enable-feature=native-histograms` a no-op; `scrape_classic_histograms` renamed
`always_scrape_classic_histograms`; `holt_winters` renamed and flagged; the feature flags removed in
3.0 (`utf8-name`, `agent`, `remote-write-receiver`, `promql-at-modifier`, `promql-negative-offset`,
`expand-external-labels`, `new-service-discovery-manager`, `no-default-scrape-port`,
`auto-gomaxprocs`, `auto-gomemlimit`); `--enable-feature=auto-reload-config` superseded by the stable
`--config.auto-reload`; `remote_write` HTTP/2 defaulting to false; slog-format logs (`time=`,
`source=`) instead of `ts=`, `caller=`; the rebuilt Mantine UI and "Graph" becoming "Query"; the v2.55
downgrade floor.

*Grafana 11/12 → 13:* the Angular Graph, singlestat, table-old and heatmap-old panels gone;
`grafana-cli` becoming `grafana cli`; Dynamic Dashboards GA and unconditional with migration on open;
ad hoc filters renamed **Filter and Group by**; Explore Metrics renamed **Metrics Drilldown**;
`[[var]]` deprecated; `$__auto_interval_<var>` becoming the literal `$__auto`; the Image Renderer
plugin removed; Unified Storage deprecating the `dashboard` tables; RBAC and data source permissions
being Enterprise-only.

*Alertmanager 0.2x → 0.33:* `matchers:` over `match:`/`match_re:`; API v1 removed in 0.27.0;
`alertmanager_marked_alerts` removed in 0.33.0; `--enable-feature=auto-gomaxprocs` removed; **no
route-level `labels:`** in 0.33.1 (it exists only on `main`); the docs' "UTF-8 strict mode in the next
two versions" line, written for 0.27.0 and still untrue.

*Dead recommendations to retire on sight:* Grafana Agent (EOL 2025-11-01 — use Alloy); Promtail
(removed in Loki 3.7.3); `gcr.io/cadvisor/cadvisor`; Tempo's local-blocks processor and ingesters
(removed in 3.0); Grafana Beyla (now OBI); the `phlare` Pyroscope data source type; summaries for
latency; `prometheus.io/scrape` described as an upstream feature; `helm repo add grafana
https://grafana.github.io/helm-charts`.

**Ends with the meta-rule that saved this book:** `/docs/.../latest/` documents the latest **release**;
`main`-branch docs document **unreleased** work. Only version-pinned URLs or git tags are safe
citations. That single rule is the generalised fix for the error class that produced conflict C6, and
it protects the reader after this book ships.

*Lab role:* take one pre-2024 blog post, run its queries against the lab, and count how many break.
The repo ships three archived examples with the expected failure mode for each.

---

### Appendix G — The `promtool` Cookbook
**Target: 2,000 words**

Everything the book uses `promtool` for, collected: `check config --lint` (values `all`,
`duplicate-rules`, `none`, `too-long-scrape-interval`; default `duplicate-rules`) and `--lint-fatal`,
which exits 3; `check rules`; `test rules` with the complete `input_series` expansion notation
(`a+bxn`, `a-bxn`, `axn`, `_`, `stale`, and the fact that **`1x4` produces five samples**);
`fuzzy_compare`; `start_timestamp`; `--junit` for CI; `tsdb analyze --extended --limit --match`;
`tsdb create-blocks-from openmetrics` for the synthetic SLO history from chapter 20; `query instant`
and `query range`; `push`; `debug`. Ends with the **`--entrypoint /bin/promtool` incantation**, needed
because the image's entrypoint is the server binary, and the GitHub Actions workflow that runs the
book's rule tests on every push.

*Lab role:* wire `promtool check` and `promtool test rules` into a pre-commit hook and a CI workflow in
the reader's own copy of the repo.

---
