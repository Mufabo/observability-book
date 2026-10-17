# Editorial policy, the lab, and what is out of scope

Extracted verbatim from `00-OUTLINE.md`. Binding on every unit of the book.

# §A. EDITORIAL POLICY (binding on every chapter)

## A.1 The eight rules

1. **One chapter, one increment.** Each chapter changes exactly one thing in `compose.yaml`, one
   file in `snip/`, one rule file, or one dashboard. Nothing built is ever thrown away. Chapter 21's
   burn-rate alert fires on chapter 15's recording rule, computed from chapter 10's histogram,
   measuring chapter 5's endpoint, discovered by chapter 12's relabel config, drawn on chapter 14's
   dashboard, routed by chapter 17's tree, and graded by chapter 18's test file.
2. **Motivation precedes machinery.** Every part opens with a **one-paragraph** incident abstract
   (not a multi-page post-mortem): what broke, what the reader currently cannot answer, and the
   chapter number where each answer arrives. The part closes with a **"before and after"** box
   stating the elapsed diagnosis time then and now.
3. **Theory arrives when the lab forces it.** Range vectors are explained in chapter 6 because
   `rate(snip_http_requests_total)` returned a parse error in chapter 6. Cardinality arithmetic
   lands in chapter 7 because the reader is about to add a label; the cardinality *bomb* waits until
   chapter 24, when there are enough series to genuinely hurt.
4. **Every chapter ends with something moving on a screen.** The load generator and the chaos
   control plane ship in chapter 1, not chapter 17. Flat lines teach nothing.
5. **Every chapter ships a self-check the reader can run alone.** An expected number, a reference
   screenshot, a target that must read UP, a `make verify-chNN` target, or — from chapter 15
   onward — a `promtool test rules` file that passes or fails. This reader has no colleague, and
   "I understood it" and "I typed it correctly" feel identical until an incident.
6. **Deferred explanation is always a printed, dated IOU.** A recurring boxed device:
   *"You do not understand this yet, and that is the plan — chapter 6 (`rate`), chapter 8
   (`sum by`), chapter 13 (`$__rate_interval`)."* Every IOU is repaid in the named chapter and the
   repayment is flagged: *"IOU from chapter 3, settled."*
7. **Wrong-then-right, with the wrong output printed.** Beginners recognise their own mistakes on
   sight, not correct code. Faults are summoned with documented, reversible env-var switches
   (`SNIP_*`), never by asking the reader to vandalise their own file — so they are debugging a
   supplied fault, not their own typo, and cannot get stuck inside it.
8. **Instructions are written as intent, never as clicks.** Grafana 13's Dynamic Dashboards are GA
   and unconditional; every printed click sequence written before April 2026 is already wrong.
   "Add a time series panel; set the unit to seconds" — not "click the third icon."

## A.2 Currency and quarantine policy (from `_CONFLICTS.md`)

The manuscript **must not print** anything a dossier flagged UNVERIFIED or contested. Standing
quarantine list:

- **No LTS version number.** C2 is unresolved — `prometheus-core`/`promql` say the 3.13 line is LTS
  to 2027-07-31; `pedagogy` and `k8s` read prometheus.io/download as badging 3.5.5. The book says:
  *"Prometheus publishes a Long Term Support line; check prometheus.io/download for the current
  one."* The lab pin `v3.13.1` is not in question and is used everywhere.
- **No Grafana Cloud free-tier active-series number.** Only 14-day retention is published.
- **No claim that `grafana/grafana` and `grafana/grafana-oss` are identical builds.**
- **No Grafana 13.2** — `releases/latest` is 13.1.1.
- **No Alertmanager route-level `labels:` or `routeLabels`.** They exist only on `main`; in v0.33.1
  they are a config parse error (C6).
- **No `windows_exporter` metric names or default collector set** — flagged unverified. One page,
  version and port only.
- **No Promscale.**
- **Native histograms get one canonical paragraph, written once and reused verbatim** (closes C4):
  *stable since Prometheus 3.8.0; the `native-histograms` feature flag has been a complete no-op
  since 3.9; and there are still **three independent opt-ins** — the client library's
  `NativeHistogramBucketFactor`, the server's `scrape_native_histograms: true`, and remote write's
  `send_native_histograms: true`. The latter two default to true only from v4. The classic text
  exposition format cannot carry them at all.*

**Citation rule, printed in Appendix F and obeyed by the author:** `/docs/.../latest/` documents the
latest *release*; `main`-branch docs document *unreleased* work. Only version-pinned doc URLs or git
tags may be cited. This rule is what caught C6.

## A.3 Registry policy (resolves C3)

Stated once in chapter 1, obeyed everywhere, tabulated with verification dates in Appendix A:

| Source | Rule | Reason |
|---|---|---|
| Prometheus-org images | `quay.io/prometheus/*` | One registry, one rule; no Docker Hub pull-rate surprise halfway through a lab |
| Grafana | `grafana/grafana:13.1.1` (Docker Hub) | Not published to quay |
| cAdvisor | `ghcr.io/google/cadvisor:v0.60.5` | `gcr.io/cadvisor/cadvisor` is dead |
| postgres_exporter | `quay.io/prometheuscommunity/postgres-exporter:v0.20.1` | Community org, not prometheus org |
| redis_exporter | `oliver006/redis_exporter:v1.88.0` (Docker Hub) | Named exception, called out in text |

## A.4 Main-line language

**Go 1.25 throughout the main line** (`client_golang` v1.24.1) — never alternating. This section
originally chose Python; the editor-in-chief overruled it on 2026-07-28. LAB-SPEC amendment **A3**
is the record and LAB-SPEC §0.2 carries the full reasoning. Python 3.13
(`prometheus-client` 0.26.0) stays in the stack as `catalog` — *someone else's service*, which the
reader diagnoses but never owns — and as the `pager` tool. Java and Node get Appendix E.

The two-language requirement is unchanged and still load-bearing: ch7, ch10 and Appendix E turn on
one client library's default histogram buckets differing from another's. Only the polarity
reverses. The reader's own service now ships Go's 11 `prometheus.DefBuckets` with an implicit
`+Inf`; the service they diagnose ships `prometheus_client`'s 14 with an explicit `INF`. One
consequence for authors: the Python multiprocess-registry trap is no longer the reader's own
problem, so it moves to a ch5 sidebar and Appendix E, framed as *"if your service is Python…"*.
It is not cut.

---


# §B. THE LAB — `obslab`, the Snip stack

One git repository. One `compose.yaml` (Compose v2 filename, **no obsolete top-level `version:`
key**, every image tag pinned exactly, named volumes for all state, read-only bind mounts for config
only). Two overlay files for the heavy optional additions. One git tag per chapter
(`ch01` … `ch29`) so a reader who breaks something rejoins in thirty seconds. `make up`, `make down`,
`make reset`, `make check`, `make verify-chNN`.

**Snip** is a URL shortener the reader owns and edits: small enough to read in one sitting, rich
enough to produce every metric shape the book needs — a hot read path (`GET /l/{code}`), a write
path (`POST /links`), a cache, a database, a background worker, and a failure switch.

## B.1 Services

| Service | Image / language | Port | Added | Role |
|---|---|---|---|---|
| `snip-api` | Go 1.25 · `client_golang` v1.24.1, built from `./snip` | 8000 (ch1 only; behind `edge` from ch12) | ch1 | **The service the reader owns and edits** |
| `snip-api-b` | second container of the same image, no published host port | — | ch2 | Makes `instance` real; retired in ch12 |
| `loadgen` | Go 1.25 · `client_golang` v1.24.1 | 8089 (control API) | ch1 | Traffic driver, chaos control plane, **and** a second instrumented service; the only native-histogram source |
| `valkey` | `valkey/valkey:9-alpine` | 6379 | ch1 | Snip's cache — **plumbing from day one**, monitored in ch23 |
| `postgres` | `postgres:18-alpine` | 5432 | ch1 | Snip's store — **plumbing from day one**, monitored in ch22 |
| `prometheus` | `quay.io/prometheus/prometheus:v3.13.1` | 9090 | ch1 | Named volume `promdata`; never a bind mount |
| `grafana` | `grafana/grafana:13.1.1` | 3000 | ch3 | Named volume; fully provisioned; anonymous Admin (lab only) |
| `catalog` | Python 3.13, **deliberately mis-instrumented** | 8081 | ch4 | "Someone else's service" — three planted bugs, each harvested in the chapter that teaches it |
| `snip-worker` | same Go image, no HTTP API, metrics on 8090 | 8090 | ch8 | Forces "how do I instrument something that isn't a web server" |
| `edge` | `caddy:2-alpine` | 8080 | ch12 | Reverse proxy so `snip-api` can be scaled; gains bcrypt basic auth in front of Prometheus in ch25 |
| `alertmanager` | `quay.io/prometheus/alertmanager:v0.33.1` | 9093 / 9094 (TCP **and** UDP) | ch17 | |
| `pager` | ~80-line Python webhook sink with a web UI | 5001 | ch17 | Renders every notification; **turns red when the Watchdog stops arriving**. Notifications work offline |
| `node-exporter` | `quay.io/prometheus/node-exporter:v1.12.1` | 9100 | ch22 | |
| `cadvisor` | `ghcr.io/google/cadvisor:v0.60.5` | host 8085 → 8080 | ch22 | Docker Desktop caveats printed in-chapter |
| `postgres-exporter` | `quay.io/prometheuscommunity/postgres-exporter:v0.20.1` | 9187 | ch22 | |
| `blackbox-exporter` | `quay.io/prometheus/blackbox-exporter:v0.28.0` | 9115 | ch23 | |
| `redis-exporter` | `oliver006/redis_exporter:v1.88.0` | 9121 | ch23 | Proves multi-target is a *pattern*, not a blackbox quirk |
| `prometheus-b` | second `quay.io/prometheus/prometheus:v3.13.1` | 9099 | ch26 | Overlay `compose.scale.yaml` — HA replica, then remote-write receiver |
| `tempo` / `loki` / `alloy` | Grafana signals trio | 3200 / 3100 / 12345 | ch29 | Overlay `compose.signals.yaml` |

Overlays (`-f compose.yaml -f compose.scale.yaml`) rather than mutating the base file, so a failed
heavy addition never leaves the working stack broken.

## B.2 The chaos control plane (`loadgen`, ch1)

`POST /control {"rps":40,"error_ratio":0.35,"extra_latency_ms":2500,"route":"/l/{code}","cache_bypass":true}`
plus `POST /chaos/{stall,kill,reset}` and named presets driven by `scripts/scenario-*.sh`
(`outage`, `drip`, `cardinality`, `slow-db`, `flap`, `low-traffic`, `noise-history`). Every concept
in the book can be caused, on a laptop, offline, in under two minutes.

## B.3 Teaching switches (`SNIP_*` env vars — declarative, reversible, catalogued in Appendix A)

| Switch | Failure it summons | Used in |
|---|---|---|
| `SNIP_NO_CONTENT_TYPE=1` | Bare `/metrics` handler → Prometheus 3 fails the whole scrape | ch5 |
| `SNIP_GAUGE_COUNTER=1` | Monotonic value exported as a gauge → `rate()` returns plausible garbage | ch4 |
| `SNIP_UNBOUNDED_LABEL=1` | Adds the short-link `code` as a label → the cardinality bomb | ch7, ch24 |
| `SNIP_BUCKETS=default\|slo` | Library defaults vs buckets designed around the 300 ms objective | ch10 |
| `SNIP_NO_ZERO_INIT=1` | Never pre-initialises known label values → the silent-alert failure | ch9, ch16 |
| `LOADGEN_NATIVE=1` | Go side sets `NativeHistogramBucketFactor: 1.1` → dual exposition | ch10 |

## B.4 `catalog`'s three planted bugs, and where each is harvested

`catalog` is instrumented by "a colleague", badly, on purpose. The reader never owns it; they
diagnose it and, at the end, write the pull request they would send. Diagnosing someone else's
mistake is what real work feels like, and an own-code exercise cannot simulate it.

1. **A gauge used as a counter** → diagnosed in **ch4** (metric types as contracts).
2. **Durations recorded in milliseconds against second-tuned default buckets** → diagnosed in
   **ch10** (histograms).
3. **An unbounded `book_id` label** → found by arithmetic in **ch7**, detonated and diagnosed in
   **ch24**.

*(This fixes the incident-led candidate's twenty-chapter dangling asset.)*

## B.5 Why this stack teaches well

- The reader's own code is the centre of gravity. `node_exporter` and cAdvisor are supporting cast
  in chapter 22, not the opening act — unlike every community compose stack.
- A real dependency graph (`snip-api` → `valkey` → `postgres`, plus `snip-api` → `catalog`) makes
  "which layer is slow?" a real question with a wrong answer available at every hop.
- Two replicas from chapter 2 make `instance`, `sum without (instance)` and the counter-reset spike
  physically demonstrable. A single-container lab cannot teach the rate-then-aggregate law.
- `loadgen` measures what a caller sees; `snip-api` measures what the server sees. The gap between
  those two panels is the most honest lesson in the dashboards chapter.
- Postgres and Valkey are present from chapter 1 as plumbing, so **no chapter ever rewrites the
  reader's application** to make an exporter interesting.

---


# §G. WHAT WAS EXCLUDED, AND WHY

- **A standalone "what is monitoring / three pillars" opening chapter.** Dead weight for a lab-first
  book; the same definitions land in chapter 1 with a live time series to point at, and the pillars
  critique lands in chapter 29, after the reader has personally felt the join problem.
- **Thanos, Mimir, Cortex and VictoriaMetrics internals.** One comparison table and one page of
  decision guidance in chapter 26. Teaching any of them would double the book, and none is something
  this reader deploys in their first year.
- **Federation as a scaling technique.** Named, shown once as the scrape it is, and explicitly not
  recommended — even the official example federates only recording-rule output.
- **Remote Write 2.0 internals, protobuf schemas, string interning.** Chapter 26 states the
  operational truth and stops.
- **TSDB block layout beyond what changes a decision.** No ULID directory tours, chunk encodings, WAL
  segment mechanics or compaction algorithms.
- **Alertmanager HA and memberlist gossip.** Two sentences in chapter 26. A single Alertmanager is
  correct for every reader of this book.
- **`hashmod` sharding, PushProx, and the Pushgateway as anything but a discouraging sidebar.** The
  Pushgateway is deliberately absent from the compose file, because including it endorses it.
- **Grafana Alerting as a co-equal system.** Alertmanager is the main line — rules live next to the
  code and the PromQL, they are version-controlled and unit-testable with promtool, and the entire SLO
  literature assumes them. Grafana Alerting gets a two-page honest sidebar in chapter 17.
- **A tour of every service discovery mechanism.** The lab needs three; the rest is one table.
- **A catalogue of exporters.** Four taught properly plus a checklist for evaluating a fifth.
  `windows_exporter` gets one paragraph (version and port only — its metric names are unverified);
  `snmp_exporter` gets one sentence.
- **Every Grafana panel type and all 34 transformations.** Five and five, taught well, plus the dead
  names so old tutorials can be decoded.
- **Grafana Enterprise and Cloud features.** Fine-grained RBAC, data source permissions, SCIM, Git
  Sync, the Grafana SLO app, Grafana Assistant, the Image Renderer. Named only where a reader would
  otherwise search and find nothing. Dynamic Dashboards are explicitly **not** excluded: they are GA
  and unconditional in OSS 13.
- **Printed full dashboard JSON and schema v2 internals.** Grafana 13 migrates on open, so printed
  JSON is both the wrong shape and silently rewritten. Fragments in print; files in the repo.
- **Click-by-click Grafana walkthroughs.** Every instruction is intent.
- **Client libraries for every language on the main line.** Python throughout; Go as a second service
  the reader reads; Java and Node in Appendix E.
- **PromQL exotica.** Trigonometric functions, `double_exponential_smoothing`, `sort_by_label`,
  `mad_over_time`, `limitk`/`limit_ratio`, the `anchored`/`smoothed` modifiers, the `</` and `>/`
  histogram trim operators, `histogram_quantiles`. Listed in Appendix C with their flags; taught
  nowhere.
- **Native-histogram bucket-schema mathematics and the OpenMetrics protobuf wire format.** The
  operationally load-bearing part is taught; the schema exponent arithmetic is not.
- **Tracing, logging and profiling as first-class subjects.** Chapter 29 is a bridge with a working
  exemplar demo, not a Loki or Tempo tutorial.
- **Capacity-planning spreadsheets, multi-tenancy, chargeback, cost optimisation, vendor comparison
  shopping.** Chapter 25 gives the formula and the measurement query; the rest is a different book.
- **Kubernetes as a through-line.** Exactly one optional chapter on a `kind` side-quest that never
  touches the compose stack. No Operator internals, no Target Allocator, no kubernetes-mixin
  walkthrough, no Thanos sidecar topology.
- **Everything on the §A.2 quarantine list.** No LTS number, no Grafana Cloud series figure, no
  `grafana`-vs-`grafana-oss` equivalence claim, no Grafana 13.2, no Alertmanager route-level
  `labels:`, no `windows_exporter` metric names, no Promscale.

---
