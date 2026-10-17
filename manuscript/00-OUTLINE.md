# Observability with Prometheus and Grafana: A Hands-On Introduction
## FINAL CANONICAL OUTLINE — v1.0, frozen 2026-07-27

Editor-in-chief's build. Spine: the **lab-first / incremental** candidate (won 2 of 3 judge lenses
— coverage 88, lab coherence 88 — and lost teachability only on fixable chapter-density grounds).
Grafted: the **incident-led** motivation architecture and its alerting-discipline chapters; the
**concept-first** metric-types-as-contracts chapter, its declarative fault switches, its
hand-POST-to-Alertmanager move, and its multi-target-pattern chapter. Every fatal flaw named by any
judge is fixed below and logged in §E.

---

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

# §C. FRONT MATTER

**F.1 — Who this book is for, and what it assumes** (~700 words). You write code and you have used
Docker. You have never been on call, you do not know what a time series is, and nobody has ever
handed you a pager. That is the assumed starting point and nothing in this book quietly requires
more. What you will be able to do at the end, stated as five verbs.

**F.2 — How to read this book** (~600 words). The lab grows; do not skip labs. The IOU boxes and how
the debt is repaid. The self-check boxes. The debugging-ladder cross-references. Chapters 27–29 are
optional and the book stands without them. Which chapters a reader in a hurry may skim on the first
pass (11, 26, 27).

**F.3 — What you need** (~500 words). Docker Desktop or Docker Engine with Compose v2, ~6 GB free
RAM for the full stack (3 GB for the base stack through chapter 11), ~10 GB disk, and no internet
after the first `docker compose pull`. Apple Silicon and ARM notes. The `make` targets. Why the TSDB
lives in a named volume and never a bind mount.

**F.4 — The lab in one page** (~500 words). The service diagram, the ports, the chaos API, the git
tag map, and the one command that recovers any broken state:
`make reset && git checkout ch<NN> && make up`.

**F.5 — Versions this book was written against** (~600 words). The pin table with verification dates,
the currency policy from §A.2 (including the explicit refusal to name an LTS number and why), and a
pointer to Appendix F for reading anything older.

**F.6 — Conventions** (~600 words). The typographic devices: `IOU` boxes, `SELF-CHECK` boxes,
`LADDER →` cross-references, `TRAP` boxes, `SIDEBAR` boxes, `IF YOU ARE ON GRAFANA 12.4` boxes (that
support window runs to May 2027, so a corporate reader is a real reader). Why every selector in this
book is scoped with `{job="..."}`, and why examples use `without()` rather than `by()`.

*Front matter total: ~3,500 words.*

---

# §D. THE CHAPTERS

---

## PART I — Get something on the screen (ch 1–3)

> **Part opener (1 paragraph).** Snip returned 500s on `/l/{code}` for forty minutes last Saturday
> and the first anyone heard was an email from a user. Nobody could say when it started, how many
> people hit it, or whether it was still getting worse. Write those three questions on the inside
> cover: chapter 2 answers the first, chapter 9 the second, chapter 21 the third. By the end of this
> part you will have a live dashboard of a real service on your own laptop.

---

### Chapter 1 — Ten Minutes to Your First Metric
**Target: 5,000 words**

**The chapter's single job.** Get Prometheus scraping a real, running, traffic-serving service and
get the reader's first three queries on screen before a single word of theory is spent. Everything
here is introduced as a label on something already visible: a time series is defined by pointing at
the rows in the result table, not by a definition in the abstract; the pull model is described as
"Prometheus fetched that, on a timer, over HTTP" while the reader watches the target flip to UP. The
chapter also defuses, up front, the two failures most likely to end the lab on page eight — a Compose
`command:` override silently discarding the image's default `--config.file` and
`--storage.tsdb.path`, and TSDB corruption from bind-mounting the data directory off a Docker Desktop
filesystem.

**After this chapter you can…**
1. Run the Snip stack and confirm that Prometheus is scraping two targets.
2. Read a `/metrics` endpoint in a browser and say what one line of it means.
3. Define *metric*, *label*, *sample*, *series* and *scrape* by pointing at something on your screen.
4. Run `up`, `up{job="snip-api"}` and a raw counter in the Prometheus Query page, and switch between
   the Table, Graph and Explain tabs.
5. State why Prometheus connects to your service and not the other way round, and what that buys you
   for free.
6. Recognise the first four rungs of the No-Data debugging ladder and use them.

**Concepts introduced, in order.** Monitoring as answering questions about a running system → the
pull model → target → scrape interval → `/metrics` as an ordinary HTTP endpoint → metric name →
label → sample (timestamp, float64) → time series → the `up` synthetic metric and why it is free →
`job` and `instance` as labels Prometheus attaches → the Prometheus 3 Query page (Table / Graph /
Explain, Metrics Explorer, Tree view) → RED (Rate, Errors, Duration) named as the spine of the whole
book → the No-Data debugging ladder, rungs 1–4.

**Lab step.**
*Files added:* the whole `obslab` repo — `compose.yaml`, `prometheus/prometheus.yml` (14 lines,
`global.scrape_interval: 15s`, two `static_configs` jobs), `snip/` (the FastAPI app),
`loadgen/`, `Makefile`, `scripts/`.
*Services up:* `snip-api` (:8000), `loadgen` (:8089, already driving ~20 rps), `valkey`, `postgres`,
`prometheus` (:9090, named volume `promdata`).
*Reader does:* `git clone`, `make up`. Creates a short link in the browser, follows it. Runs
`curl -s localhost:8000/metrics | head -40`. Opens `http://localhost:9090/targets`. Runs three
queries.
*Reader observes:* two targets reading **UP** with a recent "Last Scrape"; a `/metrics` body with
`# HELP` / `# TYPE` lines; `up` returning two rows; the raw counter climbing.
*Verification:* `make verify-ch01` asserts both targets UP and
`snip_http_requests_total` present and increasing. Expected `/targets` screenshot printed.

**Depends on.** Nothing.

**Exercises.**
1. Stop `loadgen` for one minute, then restart it, and describe in one sentence what the counter's
   graph does — and what it does *not* do.
2. Change `scrape_interval` to `5s`, reload, and count how many more points appear in a 5-minute
   graph. Predict the number first.
3. Point a browser at `http://localhost:9090/metrics`. Prometheus scrapes itself. Find one metric
   about Prometheus's own scraping and say what it measures.
4. Break it on purpose: add `command: ["--config.file=/nope.yml"]` to the `prometheus` service,
   restart, read the error, and revert. (This is rung 1 of the ladder, in advance.)
5. Find the `up` series for a target that does not exist by adding a bogus `static_configs` entry.
   What value does `up` take, and how quickly?

---

### Chapter 2 — What's Actually on the Wire
**Target: 6,000 words**

**The chapter's single job.** Turn "a bunch of text at `/metrics`" into a precise data model: metric
name plus label set **is** the series identity, and a sample is a `(timestamp, float64)` pair
appended to it. Establish where `job` and `instance` come from — the scrape config attaches them; the
application never emits them, and must never emit `env`, `region` or `cluster` either — then give the
reader the selector syntax they need to ask for exactly one thing. The chapter closes on staleness,
demonstrated rather than described, because the five-minute-lookback story the reader will find in
every tutorial they Google is wrong for the case that matters.

> **Deliberate change from the candidate outline:** the instant-vector/range-vector *type system*
> has been moved out of this chapter and into chapter 6, where `rate()` creates the need for it.
> Teaching it here — three chapters before anything wants a range vector — was flagged as this
> outline's own worst prerequisite violation.

**After this chapter you can…**
1. Read any line of the exposition format and say which series and which sample it describes.
2. State the identity rule: two series are the same series if and only if their complete label sets
   match.
3. Write selectors with all four matchers (`=`, `!=`, `=~`, `!~`) and predict what each returns.
4. Explain why regexes are fully anchored, and why a matcher against the empty string also selects
   series that lack the label entirely.
5. Predict what happens to a series when its target goes away — and say why it is *not* a five-minute
   flat line.
6. Name three labels that application code must never emit, and say who sets them instead.

**Concepts introduced, in order.** `# HELP` and `# TYPE` → sample lines → series identity
(`__name__` is just a reserved label) → metric family (`_bucket` / `_sum` / `_count` are separate
series of one family) → target labels vs application labels → series selectors → the four matchers →
fully-anchored RE2, `.` matching newlines since v3, the "at least one non-empty matcher" rule
(`{job=~".+"}` legal, `{job=~".*"}` not) → the quoted UTF-8 selector form → staleness markers → the
lookback delta (default 5m, `--query.lookback-delta`, overridable per query via `lookback_delta`) →
the exception for exporters that set their own timestamps.

**Lab step.**
*Files changed:* `compose.yaml` gains `snip-api-b` — a second container of the same image with **no
published host port** (the compose network is all Prometheus needs); `prometheus/prometheus.yml`
gains a second entry under `static_configs`. The book explains, in a TRAP box, that you *cannot*
`--scale` a service that publishes a fixed host port ("port is already allocated"), which is exactly
why the second replica is a separate named service here — and that chapter 12 fixes this properly.
*Reader does:* watches one metric name become two series distinguished only by `instance`, then
`docker compose stop snip-api-b`.
*Reader observes:* in the Graph tab, the line for `snip-api-b` **stops**, it does not persist for
five minutes; `up{instance="snip-api-b:8000"}` goes to 0 first and *stays* at 0.
*Verification:* `make verify-ch02` asserts `count(up{job="snip-api"}) == 2`, then, after the stop,
asserts that `snip_http_requests_total{instance="snip-api-b:8000"}` returns nothing while
`up{instance="snip-api-b:8000"} == 0`. Restart and confirm recovery.

**Depends on.** Ch1.

**Exercises.**
1. Write four selectors that all return exactly the series for `GET /l/{code}` on one replica — one
   with each matcher type.
2. Predict, then check: does `{job="snip-api", method=""}` return anything? Why?
3. Find a series whose label value contains a `.` and select it with the quoted UTF-8 form.
4. Explain to yourself in writing why `up` can be 0 while the metrics from that target vanish
   entirely, and why those are two different mechanisms.
5. Stop `snip-api-b` and time how long until the series disappears from the result set. Compare with
   the five minutes a random blog post promised you.

---

### Chapter 3 — Your First Dashboard: The Early Win
**Target: 5,500 words**

**The chapter's single job.** Deliver the payoff — three real RED panels on a real service, moving in
real time — with zero configuration friction and an explicit, dated IOU for the three things the
reader is about to use without understanding. Grafana arrives fully provisioned as files, not as a
wizard, so the win survives `make reset`. The chapter also lands the two provisioning facts that
silently ruin every hand-built lab, because losing the early win to a YAML path is unforgivable.

**After this chapter you can…**
1. Provision a Grafana data source and a dashboard entirely from files, with no UI clicks.
2. Build three panels that together are RED: request rate, error ratio, p95 latency.
3. Say why the data source URL is `http://prometheus:9090` and never `localhost`.
4. Say what `jsonData.timeInterval` is for and why it must equal `global.scrape_interval`.
5. Cause a failure with the chaos API and watch a specific panel respond within one scrape.
6. State, from the printed IOU, exactly which three chapters explain the queries you just used.

**Concepts introduced, in order.** Grafana as a query client, not a store → the provisioning
directory split (`provisioning/dashboards/` holds only the *provider YAML*; the JSON lives wherever
`options.path` points — the single most common provisioning mistake) → data source `uid` and why a
fixed one matters for printed URLs → `isDefault` → `jsonData.timeInterval` as the hidden term inside
`$__rate_interval` → dashboard `uid` and `id: null` → `allowUiUpdates: true` (needed by ch13) →
panel, query, legend, unit → the time picker and refresh → anonymous auth, lab only, with the
standing warning → **the IOU box** → why a dashboard of a service with no traffic teaches nothing.

**Lab step.**
*Files added:* `grafana` service (`grafana/grafana:13.1.1`, named volume, `GF_AUTH_ANONYMOUS_ENABLED`,
`GF_AUTH_ANONYMOUS_ORG_ROLE=Admin`); `provisioning/datasources/prometheus.yaml`
(`uid: prometheus`, `url: http://prometheus:9090`, `isDefault: true`,
`jsonData: {timeInterval: "15s", httpMethod: POST}`); `provisioning/dashboards/obslab.yaml` (file
provider, `allowUiUpdates: true`, `options.path: /var/lib/grafana/dashboards`);
`dashboards/snip-red.json` (`uid: snip-red`, `id: null`).
*Reader does:* builds the three panels from intent, then
`curl -XPOST localhost:8089/control -d '{"error_ratio":0.25}'`, then
`-d '{"extra_latency_ms":400}'`, then resets.
*Reader observes:* panel 2 climbs within ~30 s; panel 3 climbs within ~30 s; both fall back.
*Verification:* compare against the printed reference screenshot; `make verify-ch03` queries the
Grafana API for the three panels and asserts each returns data. Commit the dashboard JSON.

**Depends on.** Ch1, Ch2.

**Exercises.**
1. Set `jsonData.timeInterval` to `"60s"` while Prometheus still scrapes every 15 s. Re-run the
   chaos preset and describe how panel 1 changes. Then put it back. (You will understand *why* in
   chapter 13; record the observation now.)
2. Delete the data source `uid` and `make reset`. What breaks, and why is that a printed-book
   problem as well as a lab problem?
3. Drop `snip-red.json` into `provisioning/dashboards/` instead of `dashboards/`. Predict the
   symptom before you look.
4. Add a fourth panel showing `up` for both replicas. Which panel type did you choose, and why?
5. Turn the load generator off completely for five minutes and look at the dashboard. Write one
   sentence on what a dashboard of an idle service is worth.

> **Part I closing box.** In chapter 1 you could not say when the outage started. You can now answer
> that to the second, from a graph, in about ten seconds.

---

## PART II — Make the metrics yours (ch 4–7)

> **Part opener.** The dashboard is green and a user is complaining. It is green because it is
> counting requests to `/`, and because `catalog`'s "queue depth" metric is a gauge that is really a
> counter, so `rate()` over it has been producing confident nonsense for a month. Nobody has read
> what these services actually expose. This part makes the metrics yours: you will choose types on
> purpose, write your own, learn why the raw counter graph is useless, and calculate the cost of a
> label before you add it.

---

### Chapter 4 — Metric Types Are Contracts
**Target: 5,500 words**

**The chapter's single job.** Teach the four metric types as *promises the process makes and PromQL
relies on*, so that the legal operations follow by reasoning rather than by memorised prohibition.
A counter guarantees monotonic non-decrease within one process lifetime, a reset to zero on restart,
and that only *differences* carry meaning — from which it follows that displaying its absolute value
is always a mistake and that only `rate`, `irate`, `increase` and `resets` are safe on it. A gauge
guarantees nothing about direction and its instantaneous value is meaningful — which buys `deriv()`
and `predict_linear()` and costs *blindness between scrapes*. That asymmetry is the chapter's
centrepiece and it settles almost every future "should this be a counter or a gauge" question. This
is the chapter that lets a reader reason about functions the book never shows them.

*(Grafted wholesale from the concept-first candidate, and placed **before** instrumentation so the
reader chooses a type from what it guarantees rather than copying one.)*

**After this chapter you can…**
1. State the contract each of the four metric types makes, in one sentence each.
2. Derive, rather than recall, which PromQL functions are legal on a counter and which on a gauge.
3. Explain the gauge-blindness asymmetry: a spike living entirely between two scrapes never
   happened for a gauge, whereas a counter of the same events cannot hide it.
4. Recognise a gauge being used as a counter from the shape of its graph alone.
5. Say why a summary's quantiles cannot be aggregated, and therefore why histograms exist.
6. Read `# TYPE` and predict which operations the series will tolerate.

**Concepts introduced, in order.** Type as contract → **counter**: monotonic within a process
lifetime, resets to zero, only differences carry meaning → why the absolute value of a counter is
never worth displaying → **gauge**: no direction guarantee, instantaneous value meaningful, blind
between scrapes → the counter-vs-gauge asymmetry, worked → **histogram**: named here as a family of
counters, fully taught in ch10 → **summary**: shown exactly once, as a cautionary tale
(`avg(...{quantile="0.95"})` is annotated `// BAD!` in the official docs) → untyped metrics →
the `*_info` value-1 pattern (joined in ch11) → `resets()` and `changes()` → the odometer /
speedometer analogy, fixed here and reused for the rest of the book.

**Lab step.**
*Files added:* `catalog` service (Go, :8081) plus its scrape job. Still **no code editing by the
reader.**
*Reader does:* classifies every metric family exposed by `snip-api`, `loadgen`, `catalog` and
Prometheus itself by type — predicting from the name, confirming from `# TYPE`. Runs
`resets(snip_http_requests_total[10m])` and `changes(catalog_queue_depth[10m])`. Restarts `snip-api`
and watches the raw counter fall to zero while the process keeps serving. Then sets
`SNIP_GAUGE_COUNTER=1`, restarts, and graphs `rate()` over the resulting gauge.
*Reader observes:* the `rate()` output is smooth, plausible, non-negative — and completely wrong,
because every ordinary decrease was read as a counter reset. Then finds **`catalog`'s planted bug
#1**: `catalog_items_processed` is declared a gauge but only ever increases.
*Verification:* `make verify-ch04` checks the reader's written classification file
(`docs/type-census.md`) against the `# TYPE` lines actually exposed, and reports any mismatch.

**Depends on.** Ch1, Ch2.

**Exercises.**
1. For each of these, decide counter or gauge and defend it in one line: open database connections,
   bytes written to disk, current queue depth, cache evictions, seconds since last successful
   backup, temperature.
2. With `SNIP_GAUGE_COUNTER=1`, write the one sentence that explains why the `rate()` output is
   plausible, silent and wrong.
3. Design a gauge whose real behaviour your monitoring will provably miss. Now design a counter that
   captures the same events and cannot miss them.
4. Find `catalog`'s gauge-that-is-a-counter. Write the one-line diff you would send as a pull
   request, and the one-line PR description explaining the consequence.
5. `resets(x[1h])` on a counter you have restarted three times. Does it return 3? Read the docs and
   explain the case where it would not.

---

### Chapter 5 — Your First Counter: Instrumenting Code You Own
**Target: 6,500 words**

**The chapter's single job.** The reader edits application code for the first time and the green
dashboard finally goes red. Everything here is a rule with a consequence attached: construct metrics
once at import or constructor scope (per-request construction is slow *and* raises duplicate
registration errors); `_total` on counters; base units only; unit suffix before type suffix; and the
aggregation-honesty test that decides name-versus-label. The chapter ends by making the reader break
their own `/metrics` endpoint in the specific way Prometheus 3 punishes hardest, then fix it twice
and choose which fix they would defend in review.

**After this chapter you can…**
1. Add a counter and a gauge to a real service and see them in Prometheus within one scrape.
2. Apply the naming law: `_total`, base units (seconds, bytes, ratio 0–1 — never `_percent` at
   0–100, never milliseconds), unit suffix before type suffix.
3. Apply the aggregation test to decide whether something is a label or part of the metric name.
4. Explain why a fresh registry is empty, and what you lose if you forget to register the runtime
   collectors.
5. Diagnose a Prometheus 3 scrape that fails on a missing or unrecognised `Content-Type`, and name
   both fixes.
6. List the labels application code must never emit, and say who sets them.

**Concepts introduced, in order.** The client library's model: a registry is a set of collectors,
a scrape is a rendering of a registry → construct once at module/constructor scope → `.inc()`,
`.set()`, `.labels()` → the naming law (`_total`; base units; unit before type) → the aggregation
test verbatim (`sum(http_requests_total)` is honest; `sum(http_get_requests_total)` lies) → the
templated route (`/l/{code}`, never the raw path) → **never emit `env` / `region` / `instance` /
`cluster`** → the `*_info` build-metadata pattern → a fresh registry starts empty (the Python
equivalent of the Go `collectors.NewGoCollector()` trap; the Go form is in Appendix E) →
`CONTENT_TYPE_LATEST` → Prometheus 3's strict `Content-Type` and `fallback_scrape_protocol:
PrometheusText0.0.4` as the escape hatch → the Python-under-Gunicorn multiprocess trap (sidebar,
pointer to Appendix E).

**Lab step.**
*Files changed:* `snip/metrics.go` (new) and `snip/api.go`. Adds, at import time:
`snip_http_requests_total{route,method,code}` with `route` as the **templated** path,
`snip_links_created_total`, `snip_cache_lookups_total{result="hit"|"miss"}` (real, because Valkey has
been in the stack since chapter 1), `snip_links_active` (gauge), and
`snip_build_info{version,commit}`.
*Reader does:* rebuilds with `make up`; repoints the chapter-3 panels at the new metric names —
noticing first that the old dashboard stays green because it is watching the wrong series. Then sets
`SNIP_NO_CONTENT_TYPE=1`.
*Reader observes:* `/targets` flips the job to **DOWN** with a real Prometheus 3 error string (v2
would have silently fallen back). Fixes it **twice** — once with
`fallback_scrape_protocol: PrometheusText0.0.4` in the scrape config, once properly with
`CONTENT_TYPE_LATEST` in the handler — and writes down which one they would defend in review.
*Verification:* `make verify-ch05` asserts the five new series exist, that no metric name contains a
label name, that every duration-ish name ends in `_seconds`, and that `snip_build_info == 1`.

**Depends on.** Ch1, Ch2, Ch4.

**Exercises.**
1. Add `snip_redirects_total{outcome="hit"|"miss"|"expired"}`. Justify `outcome` as a label rather
   than three metric names, using the aggregation test.
2. Name three metrics badly on purpose — one with a unit in a label, one with a label name in the
   metric name, one with `_percent` at 0–100 — and write the sentence that `sum()` would make each
   one tell.
3. Move a metric construction inside a request handler. What error do you get, and how many requests
   does it take to appear?
4. Emit `env="dev"` from the application. Then find the right place to set it instead, and explain
   in one line why the application was the wrong place.
5. Which fix for the `Content-Type` failure would you defend in a code review, and what does the
   other one cost you?
6. Add a `# HELP` string to each new metric that would still make sense to a colleague at 3 a.m.

---

### Chapter 6 — `rate()`, `increase()`, and Why Nothing Is a Whole Number
**Target: 7,500 words**

**The chapter's single job.** Forced by chapter 5: the raw counter graph is a useless staircase. This
chapter earns the range vector, defines the PromQL type system at the moment the reader needs it,
and then removes all mystery from `rate()` by making the reader compute one by hand *before*
Prometheus does. It opens with two `curl` captures of `/metrics` fifteen seconds apart and a
calculator — so `rate()` is later *recognised*, not believed — and closes with the extrapolation
arithmetic that explains why `increase(...[1m])` returns 2.5 requests.

*(The hand-computed-rate opener is grafted from the concept-first candidate's chapter 1; its
tool-free 5,000-word chapter is **not** adopted — the insight is worth two pages against a live
graph, not an entire opening chapter with no monitoring system in it.)*

**After this chapter you can…**
1. Name the four PromQL expression types and say which functions consume which.
2. Explain why `rate(x)` is a type error and `rate(x[5m])` is not.
3. Count the samples in `[1m]` at a 15 s scrape and get 4, not 5, and say why.
4. Predict the value `increase(x[1m])` will return, including the fraction, before pressing Execute.
5. Diagnose an empty `rate()` panel with the two-sample rule and the 4× guideline.
6. Say what a counter reset costs you, and which functions survive one.

**Concepts introduced, in order.** The staircase problem → hand-computed per-second rate from two
`curl` captures → **the four expression types**: instant vector, range vector, scalar, string → the
rule that a range query's root may only be a scalar or instant vector (which is exactly why pasting
`x[5m]` into a time-series panel is an error, not a graph) → the range-vector selector `[5m]` →
**left-open, right-closed since Prometheus 3** → `count_over_time` as the way to verify the sample
count yourself → `rate()` → the extrapolation algorithm, in plain arithmetic with a worked example
(reset-corrected first-to-last difference; average interval between samples; the 1.1× extrapolation
threshold; the clamp to half an average interval; the counter-only guard that prevents extrapolating
below zero; and the final division by the **declared** range, which is why
`increase(x[5m]) == rate(x[5m]) * 300`) → `increase()` → counter resets and what is permanently lost
across one → the hard two-sample minimum, silent series drop, and the practical 4× rule with all
three of its justifications → `delta()` and `deriv()` as gauge-only → `irate()` in a deliberately
discouraging sidebar (spikiness resets `for:` forever, so never in an alert).

> **SIDEBAR, clearly labelled optional:** "The algorithm in the source." The Go identifiers
> (`extrapolatedRate`, `averageDurationBetweenSamples`, `durationToZero`,
> `factor /= ms.Range.Seconds()`) are printed *here only*, in a box the reader may skip, so the main
> line stays arithmetic. *(This fixes the candidate outline's chapter 5, which walked Go source by
> variable name in the reader's fifth chapter.)*

**Lab step.**
*Files changed:* none in the app. `dashboards/snip-red.json` gains a "rate workbench" row.
*Reader does:* captures `/metrics` twice, 15 s apart, computes requests-per-second on paper, writes
the number in the margin — then computes the same thing with `rate()` and reconciles the small
difference. Graphs the raw counter (staircase), then `rate(...[30s])` — **the panel goes empty**, and
the reader diagnoses it with the ladder rather than being told. Widens to `[2m]`, then
`[$__rate_interval]`. Verifies the left-open arithmetic with
`count_over_time(snip_http_requests_total[1m])` against the configured scrape interval, then repeats
at `[45s]` and `[75s]`. Runs `docker compose restart snip-api` mid-chapter.
*Reader observes:* the raw counter sawtooths at the restart while `rate()` bridges it smoothly;
`count_over_time(...[1m])` returns 4.
*Verification:* `make verify-ch06` runs the predict-then-run set and diffs the reader's written
predictions in `exercises/ch06-predictions.txt` against live results.

**Depends on.** Ch1, Ch2, Ch4, Ch5.

**Exercises.**
1. Predict-then-run: write down `increase(snip_links_created_total[1m])` to two decimal places
   before executing. Reconcile any difference using the extrapolation arithmetic on paper.
2. Set the load generator to 4 rps and run `rate(...[20s])`. Manufacture the empty panel
   deliberately, then walk the ladder to the rung that fixes it.
3. Prove `increase(x[5m]) == rate(x[5m]) * 300` on live data. Then explain why that identity holds
   even though the extrapolation factor varies.
4. Use `delta()` on a counter, restart `snip-api`, and screenshot the negative value. Write the
   one-line rule you will never break again.
5. Graph `irate(...[1m])` and `rate(...[1m])` on one panel during a chaos burst. Which one would you
   put a threshold on, and why not the other?
6. `count_over_time(x[1m])` at scrape intervals of 15 s, 20 s and 30 s. Predict each answer first.

---

### Chapter 7 — Labels, and the Cardinality Arithmetic You Must Do First
**Target: 6,000 words**

**The chapter's single job.** Add dimensions properly, and convert cardinality from a warning box
into arithmetic the reader performs *before* writing the label rather than a lament after the OOM.
Every other treatment puts cardinality in the back-of-book operations chapter — that is, after the
reader has already shipped `{path="/l/8134"}`. Here the reader computes a series budget on a
worksheet, applies the label-admission test, and is made to reject at least one label they wanted.
The bomb itself is not detonated here; chapter 24 does that, when there are enough series to hurt
and the reader has the diagnostic vocabulary to enjoy it.

**After this chapter you can…**
1. Compute the series count of a proposed label set before you write it.
2. Apply the label-admission test: could this have 10,000 values in production?
3. Quote the official guidance (stay under 10; investigate above 100) and say what it is guidance
   *about*.
4. Explain the histogram multiplier: one default-bucket classic histogram is many series per label
   combination, and the count differs between Python and Go.
5. Explain lazy series creation and why "the series does not exist yet" is a distinct No-Data cause.
6. Name six label values that are always wrong, and say where a trace ID belongs instead.

**Concepts introduced, in order.** A label value is a new **series**, not a new column → cardinality
is multiplicative → the worksheet: method × route × code × instance → the histogram multiplier
(Python's 14 finite buckets + explicit `INF` vs Go's and Node's 11 + implicit `+Inf`, so the same
service in two languages costs different amounts) → the label-admission test → the official
under-10 / investigate-above-100 guidance → bounded vs unbounded value sets → lazy series creation
(a label value never yet observed is an absent series) → pre-initialising known label values, and
why (forward reference to ch9 and ch16) → churn as distinct from cardinality (a value that *changes*
on every deploy is worse than a high-but-stable one) → the always-wrong list: `user_id`, `email`,
`session_id`, `request_id`, `order_id`, raw URL path, raw error string, UUID → **exemplars named
here as the correct, cardinality-free home for a trace ID** (taught in ch29).

**Lab step.**
*Files changed:* `snip/metrics.go` — the reader adds `route` and `code` labels properly, having first
filled in the Appendix D cardinality worksheet and **rejected at least one label they wanted**.
*Reader does:* takes a census of the running lab —
`topk(10, count by (__name__) ({__name__=~".+"}))`,
`curl -s localhost:9090/api/v1/status/tsdb | jq '.data.seriesCountByMetricName[:10]'`, and a graph of
`prometheus_tsdb_head_series`. Hand-computes the expected series count for
`snip_http_requests_total` and reconciles it against the measured value, accounting for the
difference. Then inspects `catalog` and finds **planted bug #3**: an unbounded `book_id` label. They
compute what it will cost at production traffic — and do *not* fix it yet.
*Reader observes:* their arithmetic matches the TSDB's own count, or they find out why not.
*Verification:* `make verify-ch07` compares the reader's `docs/cardinality-budget.md` figure against
`count({job="snip-api"})` and fails if they are more than 10% apart.

**Depends on.** Ch1, Ch2, Ch4, Ch5.

**Exercises.**
1. Fill in the worksheet for a label set you would actually want in production for Snip. What is the
   total? Which label did you cut?
2. Compute the series cost of adding a `region` label with 3 values to every metric Snip exposes.
   Then explain who should really be setting `region`.
3. Predict how many series `snip_http_request_duration_seconds` will produce once chapter 10 adds it
   with 8 explicit buckets across 4 routes and 5 status codes. Write the number down; chapter 10
   checks it.
4. Estimate `catalog`'s `book_id` cost if the catalogue has 200,000 books and 0.5% are requested per
   day. Write the pull-request description you would send.
5. Find one metric in the running lab whose cardinality surprised you, and say in one line why.

> **Part II closing box.** The chapter-3 dashboard was green during a real outage because it was
> watching the wrong series and averaging the wrong thing. It now watches metrics you wrote, with
> labels you costed, on types you chose deliberately.

---

## PART III — Ask better questions (ch 8–11)

> **Part opener.** The p95 panel reads 250 ms; users say a redirect takes eight seconds. The
> error-ratio panel goes blank exactly when the service is healthy. And a routine restart of one
> replica put a spike on the graph that never happened. All three panels contain correct-looking
> PromQL. This part is about the questions behind the queries: how to aggregate without lying, how
> to divide without vanishing, how to measure latency honestly, and how to join one series to
> another.

---

### Chapter 8 — Aggregation: `sum`, `without`, and the Rate-Then-Aggregate Law
**Target: 6,000 words**

**The chapter's single job.** Now that two replicas and several label dimensions exist, aggregation
stops being abstract. Teach the operators, teach `without()` as the default habit and `by()` as the
exception — because an alert that aggregates away `job` cannot be routed, and every tutorial teaches
this backwards — and then *prove* the rate-then-aggregate law experimentally instead of asserting it.
That proof is only possible because the lab has had two replicas since chapter 2; it is the single
clearest argument for the lab's shape.

**After this chapter you can…**
1. Use `sum`, `min`, `max`, `avg`, `count`, `count_values`, `stddev`, `stdvar`, `topk`, `bottomk`,
   `quantile` and `group`, and say what each returns.
2. Choose `without()` over `by()` by default, and articulate the alert-routing reason.
3. Demonstrate on your own data that `sum(rate(x))` and `rate(sum(x))` disagree, and say which lies.
4. Explain why `topk` in a range query can return far more than *k* lines.
5. Distinguish `count` from `count_values`.
6. Instrument something that is not an HTTP handler.

**Concepts introduced, in order.** Aggregation operators → the grouping clause → `by` vs `without`,
with `without` as the taught default (it drops only what you name and preserves the labels alert
routing will need) → `sum without (instance, code)` as the everyday shape → **the rate-then-aggregate
law**, with the mechanism attached: `sum(rate(x))` keeps per-series counter-reset detection,
`rate(sum(x))` throws it away and manufactures a spike out of a restart → the `topk`
per-evaluation-timestamp gotcha in range queries → `count` vs `count_values` → `group()` → gauges
from a non-HTTP process: queue depth and a last-success timestamp.

**Lab step.**
*Files added:* `snip-worker` (same Go image, no HTTP API, metrics endpoint on :8090) exposing
`snip_worker_queue_depth` (gauge), `snip_worker_last_success_timestamp_seconds` (gauge) and
`snip_worker_jobs_total{outcome}` (counter). New scrape job.
*Reader does:* builds a per-route table panel with
`sum without (instance, code) (rate(snip_http_requests_total{job="snip-api"}[$__rate_interval]))`.
Then puts two panels side by side — `sum(rate(...))` and `rate(sum(...)[5m:])` — and runs
`docker compose restart snip-api-b`.
*Reader observes:* a large spurious spike appears on **exactly one** of the two panels. Screenshot,
printed in the book for comparison.
*Verification:* `make verify-ch08` asserts the worker's three series exist, and that during a
scripted restart the `rate(sum(...))` expression exceeds `sum(rate(...))` by more than 5× at some
timestamp — i.e. the lesson provably happened on this reader's machine.

**Depends on.** Ch2 (two replicas), Ch5, Ch6.

**Exercises.**
1. Rewrite three `by()` queries as `without()`. For each, name a label `by()` would have discarded
   that an Alertmanager route will want in chapter 17.
2. Run `topk(3, rate(...))` as an instant query and then over 6 hours. Count the distinct legend
   entries. Explain the difference.
3. Use `count_values` to answer "how many replicas are running each build version?" from
   `snip_build_info`.
4. `avg without (instance) (snip_worker_queue_depth)` versus `sum without (instance) (...)`. Which
   would you alert on, and why not the other?
5. Instrument one thing in `snip-worker` that a request counter fundamentally cannot express, and
   say what makes it different.
6. Predict the spurious spike's height before you cause it, from the counter's value at restart.

---

### Chapter 9 — Ratios, Arithmetic, and the Series That Isn't There
**Target: 6,500 words**

**The chapter's single job.** Teach binary operators, then spend half the chapter on the two
silent-wrongness results that would otherwise follow the reader into production: averaging a ratio
instead of dividing two aggregates, and a ratio panel that goes blank *precisely when the service is
healthy*. The second matters far beyond the panel — it is why a 30-day SLI reads better than reality,
and why an alert on a service that has stopped entirely never fires.

**After this chapter you can…**
1. Write vector–scalar and vector–vector arithmetic and predict the result's label set.
2. State the metric-name dropping rules for arithmetic and comparison, including `bool` and `on`.
3. Use `and`, `or`, `unless`, and say why they never accept `group_left`/`group_right`.
4. Compute an error ratio correctly, and show numerically that `avg(a/b)` disagrees with
   `sum(a)/sum(b)`.
5. Make a ratio panel read a truthful `0` instead of going blank when there are no errors.
6. Detect a series that has stopped existing with `absent()` and `absent_over_time()`.

**Concepts introduced, in order.** Binary operators between a vector and a scalar → between two
vectors, with one-to-one matching on the full label set minus `__name__` → metric-name dropping
(arithmetic always drops it; comparison keeps the left-hand name unless `bool` or `on` is used, and
keeps the right-hand name with `group_right`) → comparison operators and the `bool` modifier —
without `bool` a comparison **filters**, with `bool` it returns 0/1, which the window-based SLI in
chapter 20 needs → the set operators `and`, `or`, `unless` → **the correct error-ratio pattern**:
aggregate numerator and denominator separately, then divide → `avg(a/b)` versus `sum(a)/sum(b)` with
real numbers from two unequally-loaded replicas → **the empty-result problem**: Prometheus reads "no
series" as "nothing to report" → the `or 0 * ...` and `or vector(0)` idioms → pre-initialising known
label values in the application as the upstream fix → `absent()` and `absent_over_time()` →
`fill()` / `fill_left()` / `fill_right()` named honestly as experimental behind
`--enable-feature=promql-binop-fill-modifiers`, and therefore **not used** in this book's rules →
`label_replace` and `label_join` for legend hygiene.

**Lab step.**
*Files changed:* `dashboards/snip-red.json` — the chapter-3 error-ratio panel is rewritten correctly.
*Reader does:* drives the two replicas to very different traffic levels through the loadgen control
API, then builds four expressions side by side in one table panel — `avg(rate(errors)/rate(total))`,
`sum(rate(errors))/sum(rate(total))`, and both `by (route)` — having first predicted the *direction*
of the disagreement. Reconciles the numbers in writing. Then sets `error_ratio: 0` and watches the
naive ratio panel go blank; repairs it with
`sum without (instance) (rate(errors[$__rate_interval])) or 0 * sum without (instance) (rate(total[$__rate_interval]))`.
Adds an `absent(snip_http_requests_total{job="snip-api"})` panel. Finally sets `SNIP_NO_ZERO_INIT=1`
and observes that `code="500"` simply does not exist until the first 500 happens.
*Reader observes:* the repaired panel reads a solid `0`; the `absent()` panel returns nothing while
healthy, which is itself the lesson.
*Verification:* `make verify-ch09` asserts the repaired expression returns a sample of value `0`
while `error_ratio` is 0 — the naive form returns nothing and fails the check.

**Depends on.** Ch2, Ch6, Ch8.

**Exercises.**
1. Drive replica A to 200 rps at 1% errors and replica B to 5 rps at 40% errors. Predict which of
   `avg(a/b)` and `sum(a)/sum(b)` is higher, then measure both and record the numbers.
2. Write the same error ratio three ways — `or 0 *`, `or vector(0)`, and pre-initialised label values
   in the application. Rank them and defend the ranking.
3. Run `up == 1` and `up == bool 1`. Explain the difference in one sentence, and name a place each is
   the right choice.
4. Write an expression that returns 1 when Snip is serving traffic and 0 when it has stopped
   entirely — and that never returns *nothing*.
5. Use `label_replace` to turn `instance="snip-api-b:8000"` into a legend reading `replica-b`.
6. Explain why `and` cannot take `group_left`, using the label-set model rather than "the docs say
   so".

---

### Chapter 10 — Latency: Histograms Without Tears
**Target: 8,000 words**

**The chapter's single job.** Teach distributions in the order that actually builds understanding —
**ratios first, mean second, `histogram_quantile` last** — which is the reverse of every other
treatment and is not a style choice: the bucket ratio *is* the SLI that chapters 20 and 21 consume,
so this chapter directly produces the artefact the SLO chapters need. A latency SLO built on a
quantile cannot be burn-rated at all, so getting this order wrong would sabotage the book's own
subtitle ten chapters later.

**After this chapter you can…**
1. Read a classic histogram's `_bucket{le}` / `_sum` / `_count` anatomy, and say why cumulative
   buckets aggregate across instances while summary quantiles cannot.
2. Answer "what fraction of requests were under 300 ms" exactly, and recognise that as an SLI.
3. Compute a mean latency, and say when a mean describes nobody.
4. Use `histogram_quantile` correctly, keep `le` in the grouping clause, and diagnose a pinned p99 as
   *"my buckets are wrong"* rather than *"histogram_quantile is broken"*.
5. Design buckets backwards from a stated objective instead of accepting library defaults.
6. State the three independent opt-ins native histograms still require, and explain why `curl` shows
   you nothing.

**Concepts introduced, in order.** A quantile is a property of a population and therefore the wrong
thing to store → classic histogram anatomy: `_bucket{le}` cumulative and upper-inclusive, `_sum`,
`_count` → **Prometheus 3 normalises `le="1"` to `le="1.0"` on ingestion**, silently breaking every
selector copied from a pre-2024 tutorial → **(1) the fraction under a threshold**
(`bucket{le="0.3"} / _count`, and `histogram_fraction`, which avoids the `le` literal entirely, plus
the warning that there is **no interpolation** — the boundary must actually exist) → **(2) the mean**
(`rate(_sum) / rate(_count)`) and bimodality → **(3) `histogram_quantile`**, with both documented
interpolation rules printed as a boxed rule: *the lowest bucket's floor is assumed to be 0 if its
upper bound is greater than 0, and a quantile located in the highest bucket returns the second-highest
bucket's upper bound* → `le` must survive `by()`/`without()` or the buckets are silently ignored and
you get NaN → fewer than two buckets returns NaN; the top bucket must be `+Inf` → bucket design
driven by the SLO threshold → the cross-language default-bucket trap (Python: 14 finite buckets plus
an **explicit** `INF` that custom tuples must include; Go and Node: 11 plus an **implicit** `+Inf` you
must never write; Java matches Go) → `histogram_count`, `histogram_sum`, `histogram_avg` →
**summaries**: exactly one cautionary sidebar → **native histograms**: the canonical paragraph from
§A.2, verbatim → the heatmap panel as the third thing called "a histogram".

**Lab step.**
*Files changed:* `snip/metrics.go` adds `snip_http_request_duration_seconds` with **explicit** buckets
chosen so that 0.3 — the objective chapter 20 will declare — is a real boundary:
`.005 .01 .025 .05 .1 .25 .3 .5 .75 1 2.5 5 10`. Observed in **seconds** from `time.perf_counter()`
deltas, never milliseconds. `SNIP_BUCKETS=default|slo` toggles between library defaults and these.
*Reader does:* builds a "% under 300 ms" stat panel, a p50/p95/p99 time series and a heatmap. Then
reproduces the incident by injecting `extra_latency_ms: 12000` — **deliberately above the 10 s top
finite bucket** — and watches `histogram_quantile(0.99, ...)` sit pinned at exactly `10` while the
mean barely moves. Computes the same latency three ways and explains in writing why they disagree.
Deliberately writes `sum by (job)` instead of `sum by (job, le)` and records the NaN. Compares
`snip-api`'s p95 against `catalog`'s and finds **planted bug #2**: `catalog` records milliseconds
into second-tuned default buckets, so essentially every observation lands in `+Inf`. Finally, the
optional native-histogram lab: sets `LOADGEN_NATIVE=1` (Go, `NativeHistogramBucketFactor: 1.1`),
`curl`s `loadgen`'s `/metrics` and **sees nothing**, then sets `scrape_native_histograms: true` on
that job only and queries
`histogram_quantile(0.95, sum by (job) (rate(loadgen_request_duration_seconds[5m])))` — note the
absent `le`.
*Reader observes:* the p99 pinned at exactly the top finite bound; the NaN from the missing `le`; the
native histogram invisible in text and present after the opt-in.
*Verification:* `make verify-ch10` asserts a bucket boundary exists at exactly `le="0.3"`, that `le`
values are stored in normalised float form, and that under the 12 s chaos preset
`histogram_quantile(0.99, ...)` equals `10`.

**Depends on.** Ch4, Ch5, Ch6, Ch7 (its histogram-multiplier prediction is checked here), Ch8.

**Exercises.**
1. Chapter 7 asked you to predict this histogram's series count. Measure it. Were you right?
2. Add one bucket above 10 s and re-run the 12 s preset. The p99 changes and the service did not.
   Write the sentence that explains this to a colleague who thinks the tool is broken.
3. Compute "fraction under 300 ms" both ways — bucket ratio and `histogram_fraction` — and confirm
   they agree. Which will you use in chapter 20, and why?
4. Find a window where the mean and the p95 tell opposite stories. Screenshot both.
5. Query `le="0.3"` on `catalog`, which has no such bucket. What comes back? Now query `le="1"` on
   Snip. What comes back, and why?
6. Write the pull request that fixes `catalog`'s millisecond bug. Does it change the metric name?

---

### Chapter 11 — Joins, Info Metrics, and the Rest of PromQL
**Target: 6,000 words**

**The chapter's single job.** Cover vector matching and the long tail of PromQL, driven by two
genuinely ordinary needs — "annotate this graph with the deployed version" and "recover the spike the
step stepped over" — and explicitly marked skim-now-return-later. It sits *here*, not in the exporters
chapter, because a reader who finishes the alerting parts and stops must not have missed joins:
`*_info` annotation and percent-of-limit are first-job queries.

> **Judge disagreement, resolved:** the coverage lens called deferring joins to the exporters chapter
> a fatal flaw; the teachability lens liked the late motivation. Resolved in favour of early — the
> version join supplies a real motive here, and chapter 22 reuses the identical shape for
> percent-of-limit, which makes it a pattern rather than a one-off.

**After this chapter you can…**
1. Match two vectors one-to-one with `on()`/`ignoring()`, and many-to-one with
   `group_left`/`group_right`.
2. Read the "found duplicate series for the match group" error and name its usual cause.
3. Join a `*_info` metric to carry build metadata onto a graph legend.
4. Use the `_over_time` family and say how `max_over_time` differs from `rate`.
5. Write a subquery that actually returns points under Prometheus 3's left-open ranges.
6. Place `offset` and `@` correctly, and say why `sum(x) offset 5m` is a parse error.

**Concepts introduced, in order.** Vector matching derived from the label-set model → one-to-one
requires identical labels after `on()`/`ignoring()` → `group_left`/`group_right` name the
**higher-cardinality** side → the canonical docs example
(`method_code:http_errors:rate5m / ignoring(code) group_left method:http_requests:rate5m`) → reading
the duplicate-series error → `*_info` and `*_build_info` joins → the experimental `info()` shortcut,
named and flagged → the full `_over_time` family (`avg`, `max`, `min`, `sum`, `last`, `present`,
`quantile`, `stddev`, `mad`) → subqueries, their **epoch-aligned** step grid (two evaluations three
seconds apart see identical subquery timestamps), the mandatory colon, and the `foo[1m:1m]`
single-point trap that must be written `foo[2m:1m]` under v3's left-open ranges → `offset` and `@`,
both attaching to the **selector** → `@ start()` / `@ end()` as stable @-modifier special values,
distinct from the experimental `start()`/`end()` *functions* → operator precedence →
`sort`/`sort_desc`/`sort_by_label` affect instant queries only, and since 3.12 Prometheus warns if you
try otherwise → a short, honest decode table of what sits behind `promql-experimental-functions`,
`promql-duration-expr`, `promql-extended-range-selectors`, `promql-binop-fill-modifiers` and
`use-start-timestamps` in 3.13.1, so the reader can read blog posts without being misled.

**Lab step.**
*Files changed:* `dashboards/snip-red.json` gains a version-annotated row and a spike-recovery panel.
*Reader does:* joins `snip_build_info` onto the request-rate query with `group_left(version)` so the
legend carries the deployed version; changes the version env var on one replica, redeploys it, and
watches the legend split into two lines mid-graph. Deletes the modifier to reproduce the many-to-one
error and reads it correctly. Adds
`max_over_time(rate(snip_http_requests_total[$__rate_interval])[$__interval:])` beside the plain
panel, zooms from 1 h to 24 h, and sees which one still shows the chaos spike. Writes the subquery as
`[1m:1m]`, observes the empty result, and fixes it.
*Reader observes:* the legend splitting mid-graph during the redeploy; the spike surviving on exactly
one of the two panels at 24 h.
*Verification:* `make verify-ch11` asserts the joined query returns a `version` label and that at a
24 h range the `max_over_time` panel's maximum exceeds the plain panel's by the expected factor.

**Depends on.** Ch2, Ch5 (`snip_build_info`), Ch6, Ch8, Ch9.

**Exercises.**
1. Break the join three ways — wrong side of `group_left`, missing `ignoring`, mismatched label — and
   record the exact error message for each.
2. Show the error ratio broken out by deployed version during a rolling redeploy.
3. Ask "peak requests per second in the last hour" with `max_over_time` and with a subquery. Which is
   cheaper, and how did you find out?
4. Compare this week's request rate with last week's using `offset 7d` on one panel.
5. Write `sum(x) offset 5m` and read the parse error. Then write the correct form.
6. Find a function in the decode table you assumed was stable. Which flag does it need in 3.13.1?

> **Part III closing box.** The p99 was pinned because the tail lived above the top bucket. The error
> ratio was blank because the numerator did not exist. The spike was invented by summing before
> rating. All three were "correct PromQL". You can now tell the difference — and you have the SLI
> chapter 20 needs.

---

## PART IV — Run it like you mean it (ch 12–14)

> **Part opener.** Scaling Snip to four replicas means editing `prometheus.yml` four times and
> restarting it. The page that woke someone at 03:14 identified the failing thing as
> `172.19.0.7:8000`. And the dashboard everyone trusts renders one story on a laptop and a different
> one on the wall screen. This part is about configuration that finds its own targets, and panels
> that mean the same thing at every zoom level.

---

### Chapter 12 — `prometheus.yml` in Full: Service Discovery and Relabeling
**Target: 7,000 words**

**The chapter's single job.** Read the configuration file top to bottom now that every section means
something; teach service discovery as one idea with many sources — SD produces candidate targets
carrying `__meta_*` labels, and relabeling turns that candidate set into the final target list — and
teach relabeling as a deterministic transformation with exactly four actions. The motivation is
unarguable: the reader wants four replicas without editing anything, and a page that says
`instance=snip-api-3` rather than an IP address.

**After this chapter you can…**
1. Read any `prometheus.yml` and say what each block does and which setting wins on conflict.
2. Migrate a job from `static_configs` to `file_sd_configs` and then to `docker_sd_configs`.
3. Write `relabel_configs` using `keep`, `drop`, `replace` and `labelmap`, and predict the resulting
   label set.
4. Distinguish `relabel_configs` from `metric_relabel_configs` from `write_relabel_configs`, and say
   what each can see.
5. Scale a service and watch its targets appear with no config edit and no restart.
6. Set the scrape-side limits and explain their all-or-nothing semantics.

**Concepts introduced, in order.** `global` (`scrape_interval`, `evaluation_interval`,
`external_labels`, `scrape_protocols`, `metric_name_validation_scheme`) and per-job overrides →
`metrics_path`, `scheme`, `params`, `honor_labels` → the six scrape limits (`sample_limit`,
`label_limit`, `label_name_length_limit`, `label_value_length_limit`, `target_limit`,
`keep_dropped_targets`), all defaulting to 0 = unlimited, all failing the **entire** scrape rather
than truncating → SD as a progression the lab forces: `static_configs` does not survive scaling →
`file_sd_configs`, hot-reloaded from disk → `docker_sd_configs`, which asks the runtime → the
invisible pre-scrape label set (`__address__`, `__scheme__`, `__metrics_path__`, `__param_*`,
`__meta_*`, `__tmp_*`) → relabeling as a transformation over that set: `source_labels` reads,
`target_label` writes, source values are joined by `separator` **before** the regex sees them, and
the field defaults (`separator: ";"`, `regex: "(.*)"`, `replacement: "$1"`, `action: replace`) are
what make short rules work → the four actions (`replace`, `keep`, `drop`, `labelmap`) → `hashmod`
named and dismissed → the three pipeline positions → **no default scrape port in v3** (targets appear
exactly as configured) → config reload: `--config.auto-reload` (**stable since 3.12**, not the removed
feature flag), `POST /-/reload`, `--web.enable-lifecycle` → `promtool check config --lint` → a
one-page **table**, not a tour, of the SD mechanisms this lab does not use.

**Lab step.**
*Files changed:* `compose.yaml` — `snip-api` loses its published host port; the new `edge` service
(`caddy:2-alpine`, :8080) reverse-proxies to the replicas; `snip-api-b` is **deleted** and replaced by
`docker compose up -d --scale snip-api=4`, which now works precisely because no static host port is
published. (Chapter 2's TRAP box promised this fix; it is now delivered, and the reader is invited to
re-read it.) `prometheus/prometheus.yml` — every hand-written Snip `static_configs` target is deleted
and replaced by `docker_sd_configs` over the Docker socket with `relabel_configs` that `keep` only
containers carrying the Compose label `obslab.scrape=true`, map
`__meta_docker_container_label_com_docker_compose_service` into `job`, derive a human-readable
`instance` (`snip-api-3`, never an IP), and build `__address__` from the container port. A
`metric_relabel_configs` block drops `python_gc_*`.
*Reader does:* scales to 4, then 2, then 6, editing nothing. Then sets `sample_limit: 50` on one job
deliberately.
*Reader observes:* targets appearing and disappearing on `/targets` within one SD refresh with
readable `instance` values; then `up` going to **0** with **every** metric from that target gone — not
just the excess.
*Verification:* `make verify-ch12` scales to 4 and asserts `count(up{job="snip-api"}) == 4` with no
`instance` value matching an IP-address pattern. `promtool check config --lint=all` is wired into
`make check`.

**Depends on.** Ch1, Ch2, Ch5, Ch7 (the `metric_relabel_configs` emergency brake named in ch7 is
built here and used in anger in ch24).

**Exercises.**
1. Add a `tier="frontend"` target label by relabeling, without touching application code.
2. Write a `drop` rule that removes every `go_*` metric from `loadgen`, and confirm the series count
   falls.
3. Move one job to `file_sd_configs` and add a target by writing a JSON file — **and starting the
   container that goes with it.** Then write the file and *forget* the container. What do you see,
   and which ladder rung names it?
4. Put a `keep` on `__meta_docker_*` in `metric_relabel_configs` instead of `relabel_configs`.
   Predict the symptom, then check.
5. Set `target_limit: 2` while running 4 replicas. Predict the symptom, then check.
6. Turn on `--config.auto-reload`, edit the file, and time how long until the change takes effect.

---

### Chapter 13 — Dashboard Mechanics: Intervals, Panels and Variables
**Target: 6,500 words**

**The chapter's single job.** Nail the machinery of a Grafana panel once and completely — the interval
variables, the panel types, the transformations, the variables and the Grafana 13 layout surface — so
that chapter 14 can be entirely about honesty rather than mechanics.

> **Deliberate split.** All three candidate outlines put roughly twenty discrete concepts into one
> 8,000–9,000-word dashboards chapter, and every judge flagged it as the place the book's most
> original material would be lost to density. Chapters 13 and 14 are that chapter, split into
> *mechanics* and *honesty*.

**After this chapter you can…**
1. Compute `$__interval` and `$__rate_interval` for a given panel and time range, by hand.
2. Say exactly which setting supplies the "scrape interval" term, and where it is configured.
3. Explain why the same PromQL renders differently in the panel editor and on the dashboard.
4. Choose correctly between `$__rate_interval` and `$__interval`.
5. Build with the five panel types and five transformations that matter for Prometheus data.
6. Wire a multi-value template variable that does not break the moment a second value is selected.

**Concepts introduced, in order.** A panel as a pipeline: range query → step → returned series →
transformations → rendering → unit → `$__interval = (to − from) / Max data points`, where Max data
points defaults to the panel's **pixel width** → `$__rate_interval = max($__interval + scrape
interval, 4 × scrape interval)`, and the 4× factor is not configurable → the precedence that resolves
the "scrape interval" term: the query's **Min step** if set, otherwise the data source's *Scrape
interval* field, which is `jsonData.timeInterval` — **Grafana never learns this from Prometheus**, so
chapter 3's provisioning was load-bearing → the docs' own rule: always `$__rate_interval` with rate
functions, `$__interval` with `*_over_time` → **the same query renders differently narrow and wide,
and `$__rate_interval` changes when you resize the panel** → instant versus range per panel type
(Stat and Gauge want instant; time series wants range) → the five panel types (`timeseries`, `stat`,
`gauge`, `table`, `heatmap`) plus `state-timeline`, with the dead names (`graph`, `singlestat`,
`table-old`, `heatmap-old`) explicitly buried → the five transformations that matter (Organize fields
by name, Labels to fields, Join by field, Reduce, Time series to table with sparklines) and the fact
that **order matters** → query variables, `${var:format}`, the deprecated `[[var]]`, `$__auto`, and
the rule that a multi-value variable requires `=~` → thresholds whose base step must be `null`, not
`0` → Grafana 13 reality: Dynamic Dashboards GA and unconditional; Custom versus Auto grid layouts;
Rows and Tabs with section-level variables; conditional rendering (Auto grid only) as a sidebar;
Filter and Group by (formerly ad hoc filters); Metrics Drilldown (formerly Explore Metrics) →
**opening a provisioned v1 JSON migrates it to schemaVersion 42 in the browser**, so the repo copy and
the UI copy will differ → the `$$` escaping rule in provisioning YAML (dashboard JSON gets no
interpolation, so `$__rate_interval` is always safe there) → an `IF YOU ARE ON GRAFANA 12.4` box,
because that support window runs to May 2027.

**Lab step.**
*Files changed:* `dashboards/snip-red.json` rebuilt properly — `$job` and `$route` query variables
consumed as `=~`, `[$__rate_interval]` in every rate expression, `[$__interval]` on every
`*_over_time`, an Auto grid RED row, a heatmap, correct units throughout (`reqps`, `percentunit`,
`s`), thresholds with a `null` base step.
*Reader does:* sets Max data points to 50 on one panel and reads the computed step in the Query
Inspector; resizes the panel and records how `$__rate_interval` changes; sets the data source
`timeInterval` to `60s` while Prometheus still scrapes at 15 s, observes the change, and puts it back.
Diffs the repo JSON against what Grafana shows after opening it, and understands why they differ.
*Reader observes:* the same query producing two different steps in two panel widths.
*Verification:* `make verify-ch13` asserts every `rate(` in the dashboard JSON is followed by
`[$__rate_interval]`, every `_over_time(` by `[$__interval]`, that no panel uses a dead type name,
and that no threshold base step is `0`.

**Depends on.** Ch3, Ch6, Ch8, Ch9, Ch10.

**Exercises.**
1. Compute `$__interval` and `$__rate_interval` by hand for a 6-hour range on a 400-pixel-wide panel
   at a 15 s scrape. Check against the Query Inspector.
2. Put `[$__interval]` on a `rate()` and zoom in. At what zoom level does it break, and why exactly
   there?
3. Build the same panel twice, Stat and time series, and find a moment when the Stat shows something
   no longer true. (Chapter 14 explains it; record the observation now.)
4. Make a multi-value `$route` variable and write the query with `=`. Select two routes. Record the
   symptom.
5. Apply Organize fields then Reduce, then swap the order. Explain the difference.
6. Convert one row to Auto grid and one to Custom. Which would you put on a wall display, and why?

---

### Chapter 14 — Dashboards That Tell the Truth
**Target: 6,000 words**

**The chapter's single job.** A correct query rendered wrongly is indistinguishable from a lie. With
the mechanics known, spend a whole chapter on the lies that survive perfectly correct PromQL — and end
with a find-the-lie audit that is the book's hardest self-graded exercise.

**After this chapter you can…**
1. Demonstrate the vanishing-spike problem and fix it with `max_over_time`.
2. Recognise a percent-versus-ratio unit mismatch as a silent 100× error.
3. Explain why a Stat panel can display stale data that looks live.
4. Say why stacking misleads, and when a second Y-axis is mandatory.
5. Audit somebody else's dashboard against a checklist and find planted defects.
6. Write a panel description that documents the panel's own caveats.

**Concepts introduced, in order.** A graph is a **sampled query result, not a photograph** → the
vanishing spike: the same panel at 1 h and 24 h, the peak simply gone, recovered with
`max_over_time` → series that vanish entirely as you widen the range (wider step, sparse series,
lookback) → **the Stat-panel staleness trap**: an instant query returns the newest sample within the
5 m lookback, so a Stat panel can present a four-minute-old value as current → units: `percent`
(0–100) versus `percentunit` (0–1) as a silent 100× error, and seconds versus milliseconds as the
same class of bug → stacking, and Grafana's own quotable rule against it → separate Y-axes for
different units → legend semantics, and why a legend with 400 entries is a failed panel → refresh
rate versus data rate, and `min_refresh_interval` silently clamping → `offset 7d` for week-over-week
→ the panel description field as the place caveats live → Grafana's own best-practice rules, quoted:
*"A dashboard should tell a story or answer a question."*

**Lab step.**
*Files added:* `dashboards/snip-red-BROKEN.json`, shipped in the repo **as a separate file** so it is
unambiguously the book's planted trap and never confusable with the reader's own work.
*Reader does:* finds and fixes five deliberate defects — (1) an averaged ratio; (2) `$__interval` on a
`rate()`; (3) a `percent` unit on a 0–1 ratio; (4) an unscoped selector that silently sweeps in
`catalog` alongside `snip-api`; (5) a Stat panel presenting a four-minute-old value as current. Then
runs the vanishing-spike demonstration: one chaos burst, viewed at 1 h and at 24 h, before and after
`max_over_time`.
*Reader observes:* the spike present, then absent, then recovered — two screenshots printed in the
book for comparison.
*Verification:* the answer key lives in Appendix B; `make verify-ch14` diffs the reader's fixed JSON
against the reference on those five specific properties and names any still broken.

**Depends on.** Ch9, Ch10, Ch11 (`max_over_time`), Ch13.

**Exercises.**
1. Find all five lies before reading Appendix B. Time yourself.
2. Make one panel lie in a *sixth* way. Leave it for yourself for a week, then find it again.
3. Build a "client-side versus server-side latency" panel: `loadgen`'s duration histogram against
   `snip-api`'s. Explain the gap. Which would you show a product manager, and which an engineer?
4. Set a 1 s dashboard refresh against a 15 s scrape. Describe what you are actually watching.
5. Write panel descriptions for the three RED panels that would let a stranger use them correctly at
   3 a.m.
6. Take one panel from a public Grafana dashboard and audit it against this chapter's checklist.

> **Part IV closing box.** Scaling from two to six replicas is now one command and zero config edits,
> and every panel means the same thing at every zoom level and on every screen.

---

## PART V — Alerts that reach the right human (ch 15–19)

> **Part opener.** One page, at 03:14. It said `instance=172.19.0.7:8000` — chapter 12 fixed that. It
> had no `for`, no annotations, and it had resolved before anyone logged in. Its expression was a
> 300-character one-liner nobody could review and it took nine seconds to evaluate. It went to the
> wrong receiver, bundled with twelve unrelated alerts. And nobody had ever checked that it *could*
> fire. Five chapters, one flaw each.

---

### Chapter 15 — Recording Rules
**Target: 4,500 words**

**The chapter's single job.** Short and load-bearing. Present the rule engine as a scheduled query
writer with a precise execution model, teach the two legitimate reasons to record, and land the rule
that decides half of chapter 21's outcome: record the *bucket rates*, never the quantile.

**After this chapter you can…**
1. Write a rule group and predict its evaluation order.
2. Name the two legitimate reasons to record, and the one illegitimate one.
3. Explain why recording a quantile destroys the ability to re-aggregate or change phi later.
4. Give your SLI a stable name that chapters 20 and 21 can depend on without re-deriving it.
5. Verify a recording rule by graphing it against the ad-hoc expression.
6. Monitor the rule engine itself.

**Concepts introduced, in order.** Rule files and `rule_files:` → rule groups with `name`,
`interval`, `limit`, `query_offset` and group-level `labels` → **sequential evaluation inside a
group** (a later rule may consume an earlier one's output) and **parallel evaluation across groups**
(so it may not) → rule output is an ordinary series subject to every staleness rule from chapter 2 →
the `level:metric:operations` naming convention → the two legitimate reasons: an expensive dashboard
or alert query, and a stable SLI name → **record the bucket rates, never the quantile** → monitoring
the rules themselves (`prometheus_rule_evaluation_duration_seconds`,
`prometheus_rule_group_iterations_missed_total`, `prometheus_rule_evaluation_failures_total`) →
`promtool check rules`, wired into `make check` as a pre-commit gate.

**Lab step.**
*Files added:* `prometheus/rules/snip-recording.yml` — one group, `snip-red`, at `interval: 30s`,
recording `job:snip_http_requests:rate5m`, `job_route:snip_http_errors:ratio_rate5m`, the bucket rate
`job_le:snip_http_request_duration_seconds_bucket:rate5m`, and the SLI pair
`job:snip_sli_good:rate5m` / `job:snip_sli_valid:rate5m`. `rule_files:` added to `prometheus.yml`.
*Reader does:* reloads, confirms the group on `/rules`, then **proves correctness** by graphing the
recorded series and the ad-hoc expression on one panel — they must lie exactly on top of each other.
Repoints three dashboard panels at the recorded series and records the panel query time before and
after from Grafana's Query Inspector.
*Reader observes:* two lines that are indistinguishable, and a measurably faster panel.
*Verification:* `make check` runs `promtool check rules`; `make verify-ch15` asserts each recorded
series exists and that `abs(recorded − adhoc) < 0.001` at the current instant.

**Depends on.** Ch6, Ch8, Ch9, Ch10.

**Exercises.**
1. Record a p95 as a rule. Now try to re-aggregate it across replicas, then try to change it to p99.
   Write down what stopped you.
2. Put two rules in one group where the second consumes the first, then split them into two groups.
   What changes, and how would you observe it?
3. Set a group `interval` shorter than the scrape interval. What happens to the recorded series?
4. Write the query that tells you whether your rule groups are keeping up.
5. Break a rule's YAML on purpose and confirm `make check` catches it before Prometheus does.

---

### Chapter 16 — Alerting Rules, and What "Firing" Actually Means
**Target: 6,500 words**

**The chapter's single job.** Make the state machine visible rather than described, and correct the
single most damaging misunderstanding in beginner alerting: `for` is a **debounce**, not a
sustained-badness detector. The condition must hold at *every* evaluation, so one good scrape resets
the timer to zero and a 59-minute outage containing a 30-second blip never pages. That is precisely
the SRE Workbook's rejected Approach 3 — and it is what chapter 21 will replace.

**After this chapter you can…**
1. Write an alerting rule and predict its inactive → pending → firing transitions on a graph.
2. Explain what `for` actually does, and why `keep_firing_for` is the opposite tool.
3. Choose ratios over rates over counters as alert expressions, and defend the choice.
4. Template an annotation with `$labels`, `$value` and `humanize`.
5. Recognise the silent-alert failure: an expression over a series that has never existed returns
   nothing and never fires, forever.
6. Explain why an alert that aggregates away `job` cannot be routed.

**Concepts introduced, in order.** An alerting rule is a recording rule whose output is a set of
**alert instances** — one per result series, each inheriting the expression's labels plus the rule's
own — which is why aggregating away `job` makes an alert unroutable and why a high-cardinality label
pages you a thousand times → `alert`, `expr`, `for`, `keep_firing_for`, `labels`, `annotations` →
the synthetic `ALERTS{alertname, alertstate}` and `ALERTS_FOR_STATE` series, **graphed** → `for` as a
debounce, worked through on a timeline → `keep_firing_for` for flapping and premature resolution →
counters versus rates versus ratios as alert expressions (a counter threshold fires forever and
resets on restart; a rate threshold must be re-tuned per environment; a ratio is dimensionless and
ports from staging to production unchanged) → symptoms versus causes, with the short list of
cause-based alerts worth keeping anyway → annotation templating → **the silent-alert failure** and its
two fixes (`absent()`, and pre-initialised label values from chapter 9) → the `alerting:` block with
`api_version: v2`, because Prometheus 3 dropped v1 entirely.

**Lab step.**
*Files added:* `prometheus/rules/snip-alerts.yml` with four rules — `SnipTargetDown`
(`up == 0`, `for: 2m`), `SnipHighErrorRatio` (a **ratio**, built on chapter 15's recording rule),
`SnipLatencyObjectiveAtRisk`, and `SnipSLIAbsent` (an `absent()` alert on the SLI itself) — each
carrying `severity`, `service` and `route` labels.
*Reader does:* injects a 90-second error blip and graphs
`ALERTS{alertname="SnipHighErrorRatio"}` to watch pending **never reach** firing. Runs
`scripts/scenario-flap.sh`, then adds `keep_firing_for: 5m` and sees the difference. Sets
`SNIP_NO_ZERO_INIT=1` and deliberately typos a label value in an expression, confirming the alert
becomes permanently, silently incapable of firing.
*Reader observes:* the `ALERTS` series appearing at `alertstate="pending"` and dropping back without
ever reaching `firing`; the book's printed timeline beside their own screenshot.
*Verification:* `make verify-ch16` asserts all four rules load, that a 90 s blip produces a pending
state and no firing state, and that a 5-minute outage produces firing.

**Depends on.** Ch2, Ch6, Ch8, Ch9, Ch10, Ch15.

**Exercises.**
1. Predict, then measure, how long after the error ratio crosses the threshold `SnipHighErrorRatio`
   reaches `firing` with `for: 5m` and a 30 s evaluation interval.
2. Write an alert on a raw counter threshold. Restart the service. Explain the two separate ways it
   is broken.
3. Aggregate away `job` in one expression on purpose. What does the resulting alert instance look
   like, and why can Alertmanager not route it?
4. Write an annotation that would let you start work at 3 a.m. without opening a dashboard. Chapter
   19 grades it against a template.
5. Make `SnipSLIAbsent` fire by stopping every replica. How long did it take, and what determined
   that?
6. Convert one alert from a rate threshold to a ratio threshold. Which survives a 10× traffic change
   unchanged?

---

### Chapter 17 — Alertmanager: Routing, Grouping and Silence
**Target: 7,000 words**

**The chapter's single job.** Establish Alertmanager as a **separate program with a separate data
model** — it receives label sets that have lifetimes, not queries — and prove the separation by
exercising it *before* Prometheus is connected to it at all. Then the route tree, the four timers on
one timeline, and a real notification the reader can read, offline, with no SMTP server and no Slack
account.

> **Grafted from the concept-first candidate:** hand-POSTing an alert before wiring Prometheus forces
> two separate mental models where every other treatment fuses them into one pipeline beginners never
> manage to pull apart — and it incidentally demonstrates that only `/api/v2` exists.

**After this chapter you can…**
1. Send an alert to Alertmanager by hand and watch it route, group and notify.
2. Read a route tree as depth-first, first-match-wins, and say what `continue: true` is for.
3. Print and explain the four timers, and say which one to change when the first page is too slow.
4. Write modern `matchers:` with correct YAML-versus-matcher quoting, knowing regexes are fully
   anchored.
5. Write an inhibition rule and avoid the missing-labels-are-equal trap.
6. Silence an alert with `amtool`, and explain why silences expire rather than being deleted.

**Concepts introduced, in order.** Alertmanager's data model: alerts are label sets with `startsAt`
and `endsAt` → `POST /api/v2/alerts` (only v2 exists; v1 was removed in 0.27.0) → the dispatcher:
alerts bucketed by `group_by`, and why omitting it at the root makes every alert in the system one
group (`group_by: [alertname, service]` is the sane start; `['...']` disables grouping and is almost
never wanted) → **the four timers printed together, once, on one timeline**: `group_wait: 30s` paid
once when a group is created; `group_interval: 5m` gating a further notification when the group's
**contents change**; `repeat_interval: 4h`, the nag for an unchanged group; and `for` on the rule
itself — with the explicit warning that lowering `group_interval` to "get alerts faster" produces
storms, and that the fix for a slow first page is `group_wait` → the route tree, depth-first,
first-match-wins unless `continue: true` (**the #1 reason a second receiver silently never fires**) →
the `matchers:` grammar, fully anchored, single-quote the matcher in YAML and double-quote the value
inside it → receivers and the webhook payload (camelCase throughout **except** `notification_reason`)
→ Go templating with the `.CommonLabels` trap (works with one alert, silently prints nothing once a
second joins the group) and the whitespace-trim dash → `inhibit_rules`, with the documented caution
that labels missing on **both** sides count as equal → `time_intervals`: route-level
`mute_time_intervals` / `active_time_intervals` are **current**; only the **top-level**
`mute_time_intervals` is deprecated (say *where*, or readers delete a working key); UTC when
`location` is omitted; a range cannot wrap past midnight → silences, which **expire** rather than
being deleted, and `amtool` → `--web.external-url` → `9094/tcp` **and** `9094/udp` for gossip →
Alertmanager is still pre-1.0 after ten years, so minor bumps carry breaking changes → legacy
`match:` / `match_re:` in one clearly-labelled decoding box → a two-page honest sidebar on when
Grafana Alerting is the better choice.

**Lab step.**
*Files added:* `alertmanager` service and `alertmanager/alertmanager.yml`; the `pager` service (:5001).
*Reader does:* **before touching Prometheus**, hand-POSTs a JSON alert to
`http://localhost:9093/api/v2/alerts` and watches it route, group and reach the pager UI. Then wires
Prometheus's `alerting:` block; builds a root route with `group_by: [alertname, service]`, three child
routes matching on `severity` with exactly one carrying `continue: true`, an out-of-hours
`time_intervals` block with an explicit `location`, and an inhibit rule so `SnipTargetDown` suppresses
`SnipHighErrorRatio` for the same instance. Triggers a real page. Silences it with `amtool` during a
simulated deploy, then lets the silence expire. Deletes `continue: true` and confirms the ticket
receiver goes dead. Adds a second `equal` label to the inhibit rule to demonstrate the missing-label
trap.
*Reader observes:* the notification rendered in the pager UI; the `group_wait` delay on a new group;
the `repeat_interval` nag — **with `repeat_interval` lowered to `2m` in the lab config and a printed
note saying exactly why, so this chapter does not contain a four-hour wait.**
*Verification:* `make verify-ch17` POSTs three synthetic alerts with different `severity` values and
asserts the pager received exactly the expected set of notifications, including the `continue: true`
duplicate.

**Depends on.** Ch16.

**Exercises.**
1. Write a route tree with four siblings and exactly one `continue: true`. Predict which receivers
   fire for each of three test alerts, then verify by hand-POSTing them.
2. Write a matcher you expect to match `severity="warning"` but which does not, because of anchoring.
   Then fix it.
3. Build an inhibition rule using an optional label in `equal`, and make two unrelated alerts inhibit
   each other. Explain the docs' caution in your own words.
4. Express an 18:00–09:00 out-of-hours window. It cannot be one range — write it correctly.
5. Use `.CommonLabels.instance` in a template. Fire one alert, then two. Screenshot both
   notifications.
6. Read the webhook JSON the pager received. Find the one field that is not camelCase.

---

### Chapter 18 — Testing Alerts Before They Page You
**Target: 4,500 words**

**The chapter's single job.** Give the only mechanically checkable assessment device this subject has
its own chapter, and turn it into the book's grading harness. From here on, every alerting exercise
ships with a test file the reader runs to grade themselves.

> **Grafted from the incident-led candidate.** Bolting this onto the Alertmanager chapter is exactly
> what made that chapter 9,000 words in the spine outline.

**After this chapter you can…**
1. Write a `promtool test rules` file and run it offline.
2. Use the series-expansion notation, including the off-by-one that catches everyone.
3. Manufacture counter resets, gaps and staleness markers deterministically.
4. Test the negative case — "this must NOT fire" — and say why it is harder and more valuable.
5. Explain why only the fast alert tiers are worth unit-testing.
6. Run the tests in CI and fail a build on a broken rule.

**Concepts introduced, in order.** Rules are code → the test-file schema (`rule_files`,
`evaluation_interval`, `group_eval_order`, `tests[]` with `interval`, `input_series`,
`alert_rule_test` with `eval_time` and `exp_alerts`, `promql_expr_test` with `exp_samples`,
`external_labels`, `fuzzy_compare`, `start_timestamp`) → the expanding series notation `a+bxn`,
`a-bxn`, `axn`, `_` for a gap, `stale` for a staleness marker → **`1x4` produces FIVE samples**,
because *n* counts the samples after the first → manufacturing a counter reset (`0+10x50 0+10x50`) →
testing the negative case → why a 3-day window is not worth unit-testing → `--junit` output →
`--entrypoint /bin/promtool`, because the image's entrypoint is the server binary → a `make
test-rules` target and a GitHub Actions job.

**Lab step.**
*Files added:* `prometheus/rules/tests/snip-alerts_test.yml`, `.github/workflows/rules.yml`, and a
`make test-rules` target.
*Reader does:* writes tests covering all four chapter-16 alerts, including one case that **must not**
fire (a 30-second blip under a `for: 2m`) and one manufactured counter reset. Runs
`docker compose run --rm --entrypoint /bin/promtool prometheus test rules /etc/prometheus/rules/tests/snip-alerts_test.yml`.
Then changes a `>` to a `<` in the rule file and confirms the test catches it.
*Reader observes:* a passing run, then a failing run with a readable diff. **This is the chapter's
self-verification signal and the model for every remaining chapter.**
*Verification:* `make test-rules` must exit 0; the CI workflow must be green.

**Depends on.** Ch15, Ch16.

**Exercises.**
1. Write an input series that produces exactly 7 samples. Check your arithmetic against the tool.
2. Manufacture a target that goes stale mid-test, and assert `SnipTargetDown` behaves correctly.
3. Write a test proving a 30-second blip does *not* page. Then shorten `for` until it does, and
   record the boundary.
4. Add `--junit` output and open the report. What would you show a colleague from it?
5. Break each of the four alerts in a different way and confirm the suite catches all four.
6. Add the test job as a required check on your own repo's pull requests.

---

### Chapter 19 — What a Page Should Say, and Who Watches the Watcher
**Target: 5,500 words**

**The chapter's single job.** Treat the alerting system as a service with users. This is where "alerts
that don't cry wolf" is delivered on the *human* side; chapter 21 delivers the mathematical side. No
other introductory book owns this material anywhere.

> **Grafted wholesale from the incident-led candidate**, which was the only outline to have it as a
> chapter.

**After this chapter you can…**
1. Define a severity taxonomy that maps one-to-one onto Alertmanager routes rather than decorating
   labels.
2. Write an annotation that makes a 3 a.m. page actionable in ninety seconds.
3. Say what a runbook is for, and why a troubleshooting flowchart is the wrong artefact.
4. Monitor the monitoring system, and route a dead-man's switch somewhere that screams when it stops.
5. Audit your own alert noise from Alertmanager's own metrics, and defend or delete every alert.
6. Quote a quantitative standard for what an acceptable on-call load looks like.

**Concepts introduced, in order.** Severity as routing, not decoration → **the five-field annotation
template**: what is broken in user terms; who is affected and how many; the single first thing to
check; a dashboard link with the time range pre-set; a runbook link → Ewaschuk's rule that a runbook
is a brief explanation and current context, not a troubleshooting flowchart, because flowcharts rot
within a quarter → building links from `--web.external-url` and `$labels` → **meta-monitoring**:
Prometheus cannot page you about itself → self-scrape jobs for Prometheus and Alertmanager → the five
meta-alerts → **the Watchdog / dead-man's switch** (`expr: vector(1)`, always firing,
`severity: none`) routed to something that alarms when it *stops* arriving → **the noise audit**:
`sum by (integration) (increase(alertmanager_notifications_total[6h]))` — Alertmanager's own
notification metrics, **not** the `ALERTS` series, which goes stale rather than to zero and is the
wrong source → Google's quantitative guidance (fewer than two paging events per 12-hour shift; a
median of zero incidents per day; alerts under 50% accurate are broken) → the alert review as a
recurring practice.
> **Decoding note:** `alertmanager_marked_alerts` was removed in Alertmanager 0.33.0. Any inherited
> dashboard using it will show "No data" — named here so the reader can decode it rather than debug
> it.

**Lab step.**
*Files changed:* every annotation in `snip-alerts.yml` rewritten to the five-field template.
*Files added:* `prometheus/rules/meta-alerts.yml` with `PrometheusRuleEvaluationFailures`,
`PrometheusNotificationsFailed`, `PrometheusTargetScrapesFailing`,
`AlertmanagerNotificationFailures` and `Watchdog`; self-scrape jobs for Prometheus and Alertmanager;
a `deadman` receiver pointing at the pager's dead-man endpoint.
*Reader does:* stops Prometheus and watches the pager UI **turn red** because the Watchdog stopped
arriving. Then runs `scripts/scenario-noise-history.sh`, which drives roughly 40 notifications
through the stack in about four minutes, and runs the noise audit over `[6h]`.
> **Honesty note printed in-chapter:** a lab that has been up for one afternoon has no 24-hour
> notification history. The scenario script exists precisely so the audit has something to audit, and
> the book says so rather than pretending otherwise.
*Reader observes:* the red pager; a notification table in which a small number of alerts account for
most of the volume. They then delete or downgrade every alert they cannot defend.
*Verification:* `make verify-ch19` checks that every alert rule has all five annotation fields
populated and not resolving to empty strings, and that `Watchdog` is firing.

**Depends on.** Ch16, Ch17, Ch18.

**Exercises.**
1. Rewrite your worst annotation from chapter 16 against the five-field template. Compare them.
2. Kill Alertmanager. Which meta-alert catches it — and which does not, and why?
3. Run the noise audit. Which alert produced the most notifications? Defend it or delete it.
4. Write a runbook for `SnipHighErrorRatio` that fits on one screen and contains no flowchart.
5. Design a severity taxonomy with exactly three levels, and map each to a route and a human response
   time.
6. Compute your lab's paging rate per simulated 12-hour shift. How does it compare with Google's
   number?

> **Part V closing box.** The 03:14 page now names a service, arrives with a dashboard link and a
> first step, reaches exactly one receiver, can be silenced during a deploy, is unit-tested in CI,
> and the system that sends it tells you when it dies. What it still cannot do is decide whether it
> was worth sending. That is Part VI.

---

## PART VI — Alerts that don't cry wolf (ch 20–21)

> **Part opener.** Three weeks, 47 pages, 44 of them noise — and the one that mattered arrived twenty
> minutes late. Every rule in chapter 16 is individually defensible and the set is unusable, because
> nobody has written down what "working" means. This part fixes that with two chapters: one that
> defines the target, and one that derives the alerts from it.

---

### Chapter 20 — SLIs, SLOs and Error Budgets
**Target: 6,500 words**

**The chapter's single job.** Reframe the whole alerting problem: you cannot decide what is worth
waking someone for until you have written down what "working" means. Produce, by the end of the
chapter, the two named SLIs and the windowed recording rules that chapter 21 alerts on.

**After this chapter you can…**
1. Define an SLI as good events over **valid** events, and write the exclusion list that makes
   "valid" meaningful.
2. Separate SLO from SLA, and say why the internal target must be strictly stricter.
3. Choose a window and a target, and state the budget in minutes rather than nines.
4. Express a latency SLO as "the fraction of requests faster than X" and say why a quantile cannot be
   used.
5. Compute error budget remaining and put it on a dashboard.
6. Write a one-page error-budget policy a solo developer could actually adopt.

**Concepts introduced, in order.** SLI = good events / **valid** events — "valid", not "total", so the
exclusion list (health checks, load tests, bot traffic, out-of-scope clients) is part of the
*definition* and must be written down → the SLI menu by service type → request-based versus
window-based SLIs, and why a window-based SLI needs the `bool` modifier from chapter 9 (a bare
comparison filters instead of returning 0/1) → choosing the window: rolling 30 days, with **the
28-day trap named** — Sloth's `google-28d.yaml` is identical except for the period, which makes the
effective burn rates 13.44 / 5.6 / 2.8 / 0.933 rather than 14.4 / 6 / 3 / 1 — and why calendar months
are a trap → choosing a target, with the arithmetic made concrete: 99.9% over 30 days is 43.2 minutes
of budget; 99.99% is 4.32 minutes, less than one deploy → SLO versus SLA → **the error budget as a
currency to spend, not a line not to cross**: a team that ends the month with 100% of its budget
untouched was too conservative, not excellent → the error-budget policy, one page, for a solo
developer → the budget-remaining expression and its gauge → **the rule the chapter turns on**: a
latency SLO is *the proportion of requests faster than X*, never `histogram_quantile(0.99, ...) <
0.3`, because a quantile has no good-event count, cannot be aggregated, and cannot be burn-rated —
so it is chapter 10's bucket ratio, or `histogram_fraction`.

> **Honesty box, printed in this chapter:** your lab's TSDB is a few days old, so a 30-day rolling
> window is mostly empty and the budget burns implausibly fast when the chaos injector runs. This is
> an artefact of the lab, not of SLOs. Two options are given: accept it and read the ratios rather
> than the absolute minutes, or backfill synthetic history with
> `promtool tsdb create-blocks-from openmetrics` using the shipped `fixtures/history.om`. No other
> book states this, and every reader hits it.

**Lab step.**
*Files added:* `docs/SLO.md` declaring two SLOs for Snip over a rolling 30 days — **availability**
99.5% of valid `GET /l/{code}` requests succeed, and **latency** 99% of them complete in under
300 ms — each with an explicit exclusion list and a named owner.
*Files changed:* `prometheus/rules/snip-recording.yml` gains the full windowed SLI ladder (5m, 30m,
1h, 2h, 6h, 1d, 3d, 30d) for both SLOs, every one guarded against the zero-errors hole with the
`or 0 *` idiom from chapter 9, plus `slo:error_budget_remaining:ratio30d`. The latency SLI uses the
`le="0.3"` bucket that exists **because chapter 10 designed it that way** — and the value is written
`"0.3"` in normalised float form.
*Files added:* `dashboards/snip-slo.json` — a 30-day compliance stat, a budget-remaining gauge in
`percentunit`, and a burn-down time series.
*Reader does:* burns 40% of the budget deliberately with the fault injector and watches the gauge
move.
*Verification:* `make verify-ch20` asserts every window in the ladder returns a value (not nothing)
while the service is healthy, and that `slo:error_budget_remaining:ratio30d` is between 0 and 1.

**Depends on.** Ch9 (`or 0 *`, `bool`), Ch10 (the bucket ratio), Ch15 (recording rules), Ch16.

**Exercises.**
1. Write the exclusion list for Snip's availability SLI. Name three things you excluded and defend
   each in one line.
2. Convert 99.5%, 99.9% and 99.99% over 30 days into minutes of budget. Which of the three could you
   personally sustain?
3. Recompute your budget for a 28-day window. What changes, and what does chapter 21 need to know
   about it?
4. Write the latency SLI two ways — bucket ratio and `histogram_fraction` — and confirm they agree.
5. Draft a one-page error-budget policy: what happens at 50% spent, at 90%, at 100%?
6. Try to define a latency SLO using `histogram_quantile`. Then write down the two things you cannot
   compute from it.

---

### Chapter 21 — Burn Rates: Alerts That Don't Cry Wolf
**Target: 8,000 words**

**The chapter's single job.** Justify the book's subtitle. Replay the SRE Workbook's six approaches in
order, each one motivated by the concrete failure of the one before, ending at four-tier multiwindow
multi-burn-rate — and **derive** the magic numbers rather than printing them, so they are portable to
a 28-day or 7-day window.

**After this chapter you can…**
1. Derive any burn-rate threshold from `budget_fraction × period / long_window`, without a table.
2. Explain in one sentence what the long window and the short window each decide.
3. Implement four tiers as alerting rules on top of your own recording rules, and route two of them
   to a pager and two to a ticket queue.
4. Predict detection time before an alert fires, and check it against the clock.
5. Diagnose the low-traffic failure mode and choose a fix with its trade-off stated.
6. Recognise Sloth- and Pyrra-generated rules in an inherited repository, and edit them safely.

**Concepts introduced, in order.** The six approaches in order, each fixing the previous one's flaw —
(1) threshold on the SLO itself: fires constantly; (2) a longer window: terrible reset time;
(3) `rate1m > threshold for: 1h`: **explicitly rejected**, because one good scrape resets the timer,
which chapter 16 already proved on the reader's own screen; (4) burn rate: better, but one tier
cannot be both fast and quiet; (5) multiple burn rates: better, still noisy on recovery; (6)
**multiwindow multi-burn-rate** → the derivation: `burn_rate = budget_fraction × period /
long_window`, so 0.02 × 720 / 1 = 14.4, 0.05 × 720 / 6 = 6, 0.10 × 720 / 24 = 3, 0.10 × 720 / 72 = 1 →
**the short window is always long / 12**, and it exists to fix reset time → the one-sentence rule, in
bold: *the long window decides whether it is worth paging; the short window decides whether it is
still happening* → **the four-tier table** (1h/5m @ 14.4 page; 6h/30m @ 6 page; 1d/2h @ 3 ticket;
3d/6h @ 1 ticket), with the note that the widely-copied three-row version is the workbook's *table*,
not the workbook's *code*, and that Sloth, Pyrra and Grafana Cloud all ship four → budget consumed at
fire time = `long_window × threshold / period`, **independent of incident severity** — so the real
design knob is "how much budget will I spend before waking someone" → detection time =
`long_window × threshold / actual_burn_rate` → why the `and` between two differently-named ratio
rules works (matching ignores `__name__`) and how one stray differing label makes it silently never
fire — **which is exactly why Sloth wraps everything in `max(...) without (sloth_window)`, and why
deleting that wrapper breaks the alert silently** → **the low-traffic problem**, the dominant
real-world failure for this reader: at 99.9% the tier-1 threshold is a 1.44% error ratio, so at ten
requests an hour a single failure pages — with all five fixes ranked (minimum-events guard, wider
window, looser target, aggregation across services, synthetic probe traffic) → an `absent()` alert on
the SLI itself → one honest page placing **Sloth v0.16.0** and **Pyrra v0.10.1** as generators the
reader can adopt later, naming the artefacts they produce (`slo:sli_error:ratio_rateXX`,
`sloth_severity`, `sloth_window`, Pyrra's `pyrra_url` annotations and its four indicator types) so an
inherited repo is recognisable rather than mysterious.

**Lab step.**
*Files changed:* chapter 16's `SnipHighErrorRatio` threshold alert is **deleted** and replaced by four
hand-written burn-rate rules built on chapter 20's recording rules, two labelled `severity: page` and
two `severity: ticket`, routed differently in Alertmanager. `SnipSLIAbsent` is retained.
*Files added:* `prometheus/rules/tests/snip-burnrate_test.yml` covering the 1h/5m and 6h/30m tiers —
the book states plainly why the 3-day tier is not worth unit-testing.
*Reader does:* runs `scripts/scenario-outage.sh` (30% errors) and `scripts/scenario-drip.sh` (0.3%
background errors). **Predicts detection time from `long_window × threshold / actual_burn_rate`
before the alert fires**, then compares against the wall clock. Then runs
`scripts/scenario-low-traffic.sh` (10 requests/hour, one failure), watches tier 1 fire spuriously,
adds the minimum-events guard, and re-runs the whole test suite.
*Reader observes:* `scenario-outage.sh` pages within minutes; `scenario-drip.sh` opens only the ticket
tier and **never pages**; the low-traffic single failure pages before the guard and does not after.
*Verification:* `make test-rules` must pass; `make verify-ch21` runs both scenarios headlessly and
asserts the expected receiver saw exactly the expected severities.

**Depends on.** Ch9, Ch10, Ch15, Ch16, Ch17, Ch18, Ch20.

**Exercises.**
1. Derive all four thresholds for a **7-day** window. Show why hard-coding 14.4 would have been wrong
   by a factor you can name.
2. Predict detection time for a sustained 3% error ratio against a 99.5% SLO, then measure it.
3. Break one tier by adding a stray label to one side of the `and`. Confirm it silently never fires,
   and confirm the test suite catches it.
4. Compute the budget consumed at the moment each tier fires. Which tier is the expensive one?
5. Implement the minimum-events guard three ways and rank them by what each costs you.
6. Take a Sloth-generated rule file from the repo's `fixtures/` directory, remove the
   `max(...) without (sloth_window)` wrapper, and explain in one line why the alert is now dead.

> **Part VI closing box.** In chapter 1 you spent an unbounded amount of time failing to answer "is it
> still getting worse". Run `scenario-outage.sh` and time it: the page arrives before you have
> finished reading this sentence twice. And `scenario-drip.sh` — which is genuinely bad and genuinely
> slow — does not wake anybody.

---

## PART VII — Everything you didn't write (ch 22–23)

> **Part opener.** Redirect latency doubled overnight and you shipped nothing. The cause is
> underneath your code: a container that has been CPU-throttled since somebody tightened a Compose
> limit, and a database nobody was watching. This part is about metrics from software you did not
> write — and about the one exporter pattern that behaves differently from all the others.

---

### Chapter 22 — Metrics From Things You Didn't Write
**Target: 6,500 words**

**The chapter's single job.** Define an exporter as a translator from someone else's state into the
exposition format — which changes *nothing* about the data model, PromQL, dashboards or alerting the
reader already knows — so that the only genuinely new skill is judging whether a given exporter can
be trusted. Introduce USE as the counterpart to RED, teach four exporters properly, and replace the
catalogue with a checklist, because the list rots and the checklist does not.

**After this chapter you can…**
1. Explain the three exporter categories and choose the right one for a given system.
2. Evaluate an unfamiliar exporter against a checklist before trusting it.
3. Build a USE row for the host and a container row for your own service.
4. Diagnose a service that is slow while showing modest CPU usage.
5. Use the textfile collector for a machine-tied batch job.
6. Say why the Pushgateway is almost never the answer.

**Concepts introduced, in order.** The three categories: direct instrumentation, single-target
exporter, multi-target exporter (the third is chapter 23) → **USE** (Utilization, Saturation, Errors)
as the counterpart to RED → **node_exporter 1.12.1**: why CamelCase names like
`node_memory_MemAvailable_bytes` are faithful rather than sloppy (the collector builds names from
`/proc/meminfo` field names verbatim); `node_filesystem_avail_bytes` **not** `_free_bytes` for
alerting, because `free` includes root-reserved space; and the honest caveat that `--net=host` on
Docker Desktop shows you the Linux VM, not your laptop → **cAdvisor 0.60.5**:
`container_memory_working_set_bytes` **not** `container_memory_usage_bytes` for OOM proximity (usage
includes reclaimable page cache and sits near the limit on healthy containers, producing endless
false alarms); `container_cpu_cfs_throttled_seconds_total` for the service that is slow while looking
idle; filtering the root cgroup with `{name!=""}` to avoid double counting; guarding division by
`container_spec_memory_limit_bytes > 0` because an unset limit reads 0 and gives `+Inf`; and the image
move to `ghcr.io/google/cadvisor` → **a printed Docker Desktop box for cAdvisor**, naming the `/sys`
and `/var/lib/docker` mounts it needs and the ways its behaviour differs from Linux — *no candidate
outline had this and all three would have generated support traffic* → **postgres_exporter 0.20.1**,
used as the concrete lesson that exporters churn and pins matter: 0.20.0 renamed the
`replication_slot` collector to `replication_slots` and the `pg_replication_slot_*` metrics to
`pg_replication_slots_*`, so anything written before mid-2026 is wrong → **the exporter evaluation
checklist**: maintained? conventions followed? cardinality bounded? `/metrics` readable? multi-target
capable? → the **textfile collector** as the right answer for machine-tied batch jobs → a
**Pushgateway sidebar that is 80% "don't"**: single point of failure, you lose `up`-based health
monitoring, it never forgets a pushed series, and the maintainers deliberately refused a TTL because
it would encourage the anti-pattern. It is deliberately **absent from the compose file**, because
including it implicitly endorses it → `honor_labels: true` named as the thing you would need if you
did use it → one paragraph on `windows_exporter` (0.31.8, port **9182** not 9100) and nothing more,
because its metric names are unverified.

**Lab step.**
*Files added:* `node-exporter` (:9100), `cadvisor` (host :8085), `postgres-exporter` (:9187), each
with its own job and the `metric_relabel_configs` drops that keep cAdvisor's cardinality sane —
modelled on kube-prometheus's own rules. `dashboards/snip-use.json`.
*Reader does:* builds a USE row for the host and a container row for `snip-api` using working set and
CFS throttling, reusing **chapter 11's `group_left` shape** for "memory as a percentage of limit"
with the `> 0` guard. Writes one alert per layer: disk full within four hours via `predict_linear`;
a container above 90% of its memory limit; Postgres connection saturation. Then solves the part's
incident: finds the `catalog` container that has been CPU-throttled since the Compose limits changed,
using `rate(container_cpu_cfs_throttled_seconds_total[$__rate_interval])` — the metric that explains
a slow service with low CPU usage. Finally emits one custom metric from a shell script through the
textfile collector and scrapes it.
*Reader observes:* a throttled container with unremarkable CPU usage; a textfile metric appearing in
Prometheus within one scrape.
*Verification:* `make verify-ch22` asserts all three exporter jobs are UP, that the throttling query
returns a non-zero value for `catalog`, and that the textfile metric is present.

**Depends on.** Ch6, Ch8, Ch9, Ch11 (`group_left`), Ch12 (relabeling), Ch16.

**Exercises.**
1. Alert on `node_filesystem_free_bytes` and on `node_filesystem_avail_bytes` at the same threshold.
   Explain, with numbers, why they disagree.
2. Divide by `container_spec_memory_limit_bytes` without the `> 0` guard on a container with no
   limit. Screenshot the panel.
3. Evaluate one exporter you have never used against the checklist. Would you deploy it? Write three
   lines.
4. Write a `predict_linear` alert for disk exhaustion in four hours. What window did you choose and
   why?
5. Publish a nightly backup's exit code and timestamp through the textfile collector, then alert on
   "no successful backup in 26 hours".
6. Name one situation where the Pushgateway is genuinely the right answer, and one where the textfile
   collector is better.

---

### Chapter 23 — The Multi-Target Pattern: Probing From Outside
**Target: 4,500 words**

**The chapter's single job.** Generalise a *pattern* rather than teach a tool. Some exporters are
functions you call with a parameter, and the calling convention is relabeling — which makes this
chapter the payoff for chapter 12. Teaching it as its own short chapter also fixes the overloaded
exporters chapter that two of the three candidate outlines carried.

> **Grafted from the concept-first candidate**, including its proof move: run the identical relabel
> shape a second time against `redis_exporter`'s `/scrape?target=` mode, so it reads as a calling
> convention rather than one exporter's quirk.

**After this chapter you can…**
1. Explain the `__address__` → `__param_target` → `instance` → `__address__` manoeuvre line by line.
2. Write a multi-target scrape job from the model rather than by copying.
3. Say what black-box probing tells you that instrumentation cannot, and what it cannot tell you that
   instrumentation can.
4. Diagnose the most common Docker probe failure in one setting change.
5. Alert on probe failure and on certificate expiry.
6. Recognise the same pattern in an exporter you have never seen.

**Concepts introduced, in order.** The multi-target idea: the exporter is a function; relabeling is
how you call it → **the manoeuvre, line by line**: `__address__` begins as the thing you want to know
about, is copied to `__param_target` (which becomes a URL query parameter) and to `instance` (which
becomes the series identity), and is then **overwritten with the exporter's own address**, which is
what Prometheus actually connects to → the seven prober types in 0.28.0 (http, tcp, dns, icmp, grpc,
unix, websocket) → the universal series `probe_success`, `probe_duration_seconds`,
`probe_timeout_seconds` → `http_2xx` as the default module when a scrape omits `module`; a missing
target returns HTTP 400 → `?debug=true` dumps a full probe log → **`preferred_ip_protocol` defaults to
`ip6`**, the single most common cause of probes failing or hanging in IPv4-only environments including
most Docker setups → ICMP needs `cap_add: [NET_RAW]` → the DNS prober's **inverted** convention:
`target` is the DNS *server* and `query_name` is the record → `probe_ssl_earliest_cert_expiry` →
what black-box probing adds (it tests the path, the proxy, the TLS chain and DNS) and what it cannot
see (which handler, which query, which user) → **the same shape again**, on `redis_exporter`'s
multi-target mode, to prove it is a pattern → `snmp_exporter` named in one sentence as the other
famous multi-target exporter.

**Lab step.**
*Files added:* `blackbox-exporter` (:9115) with `blackbox/config.yml`; `redis-exporter` (:9121); two
new scrape jobs.
*Reader does:* writes the blackbox multi-target job **by hand from the model, not by copying**,
probing `snip-api`'s `/healthz` through `edge`, `catalog`, and one external URL. **Omits
`preferred_ip_protocol` first**, observes the failure, then sets `ip4` and explains the fix. Adds
`?debug=true` to one probe and reads the probe log. Alerts on `probe_success == 0` with a `for:` long
enough to survive a rolling restart, and on certificate expiry from
`probe_ssl_earliest_cert_expiry`. Then writes the `redis_exporter` multi-target job and notices it is
the same four rules with two strings changed.
*Reader observes:* a probe that fails for a reason that is not the target's fault, then succeeds; the
identical relabel block working against a completely different exporter.
*Verification:* `make verify-ch23` asserts `probe_success == 1` for all three probe targets and that
the `instance` label on each probe series is the **probed** address, not the exporter's.

**Depends on.** Ch12 (relabeling), Ch16 (alerting rules), Ch22.

**Exercises.**
1. Diagram the four relabel rules and mark, at each step, what `__address__` currently holds.
2. Probe a hostname that does not resolve. Which metric tells you, and what value does it take?
3. Write a DNS probe. Which field is the server and which is the record? Get it backwards once on
   purpose.
4. Add an ICMP probe without `NET_RAW`. Read the error, then fix it.
5. Set up a probe against a real HTTPS site and alert 30 days before its certificate expires.
6. Find one exporter in the wild that uses `/scrape?target=`. Write its scrape job without looking at
   its README.

> **Part VII closing box.** Redirect latency doubled because a container was being throttled by a
> limit nobody remembered setting. It took two queries and no code changes to find.

---

## PART VIII — Living with it (ch 24–26)

> **Part opener.** Prometheus OOMed on a Tuesday, four hours after a one-line change, and the graphs
> stop six hours ago because the disk filled. Then someone asked whether we could ship all of this to
> a central store, and whether losing the one Prometheus we have would be survivable. This part is
> about running the monitoring system as a system.

---

### Chapter 24 — Cardinality: Detonate, Diagnose, Defuse
**Target: 5,500 words**

**The chapter's single job.** The one-line change was a new label. Chapter 7 taught the arithmetic
before the reader could hurt themselves; this chapter makes them detonate the bomb on purpose,
because reading about cardinality does not produce the reflex that watching
`prometheus_tsdb_head_series` climb by two orders of magnitude does. Then it teaches diagnosis in the
order you would actually reach for it, and ranks the cures.

> **Split placement decision.** The candidate outlines put cardinality in one place: early (spine and
> concept-first) or late (incident-led). Split is better and it is what the incident-led candidate
> did: the arithmetic costs two pages in chapter 7 and prevents the mistake; the detonation needs
> enough series to be visceral and a reader who can already read a TSDB status page.

**After this chapter you can…**
1. Detonate a cardinality bomb deliberately and watch it in three different metrics.
2. Diagnose an unknown cardinality incident top-down, in the order a practitioner would.
3. Distinguish cardinality from churn, and say which is worse.
4. Rank the four cures and say when each is appropriate.
5. Apply the emergency scrape-side brake and know exactly what it costs.
6. Explain why series do not vanish the moment you stop creating them.

**Concepts introduced, in order.** Where series come from, at scale (chapter 7's arithmetic, now with
real numbers) → **cardinality versus churn**: a `pod` or `container_id` label that changes on every
deploy is worse than a high-but-stable one, because every deploy strands a whole generation of series
→ the diagnostic toolkit **in the order you reach for it**: the `/tsdb-status` page and
`/api/v1/status/tsdb` with its top-10 tables → `promtool tsdb analyze --extended --limit=20 --match`
(remember `--entrypoint /bin/promtool`) → `topk(10, count by (__name__) ({__name__=~".+"}))` →
`scrape_samples_scraped` and `scrape_samples_post_metric_relabeling` →
`prometheus_tsdb_head_series` → **the cures, ranked**: (1) fix the application; (2) drop at the scrape
with `metric_relabel_configs` `drop` / `labeldrop`; (3) bound it with `sample_limit`, `label_limit`,
`label_value_length_limit`, `target_limit`; (4) delete stale label values in-process
(`DeleteLabelValues` / the Python equivalent) → **the two timescales**: head series fall when the
label stops being produced *and* the series ages out of the head block, and expired-block cleanup can
take up to two hours — so the reader is taught to watch the switch-off effect on `head_series` within
the session and told plainly that disk reclamation is slower → memory tracks **active series**, not
retention, so shortening retention never fixes an OOM (forward reference to ch25) → the always-wrong
label list, again, with exemplars named as the correct home for a trace ID.

**Lab step.**
*Reader does:* sets `SNIP_UNBOUNDED_LABEL=1`, restarts, runs `scripts/scenario-cardinality.sh` and
watches `prometheus_tsdb_head_series` climb from roughly 3,000 to well over 200,000 within ten
minutes while the container's RSS follows it. Then diagnoses it **three ways, as if they did not
already know the answer** — the TSDB status API, `promtool tsdb analyze --extended`, and a
`count by (__name__)` topk — writing the diagnosis before checking. Then fixes it **twice**: first the
3 a.m. emergency fix at the scrape (`metric_relabel_configs` with `action: labeldrop`, reload, watch
`head_series` stop growing), then the real fix by turning the switch off. Adds `sample_limit: 5000`
and `label_limit: 20` as guard rails, deliberately breaches the sample limit, and confirms the
**whole scrape** fails with `up == 0`. Finally applies the same treatment to `catalog`'s planted
`book_id` bug and writes the pull request.
*Reader observes:* the head-series graph as a hockey stick, then flat, then falling.
*Verification:* `make verify-ch24` records `prometheus_tsdb_head_series` before, during and after, and
asserts a rise of at least 20× followed by a return to within 20% of baseline.

**Depends on.** Ch2, Ch7, Ch8, Ch12 (`metric_relabel_configs`), Ch22.

**Exercises.**
1. Before detonating, predict the peak head-series count from chapter 7's worksheet. How close were
   you?
2. Diagnose the incident using only `promtool tsdb analyze`. How long did it take?
3. Create a **churn** problem rather than a cardinality problem: a label whose value changes on every
   restart. Which diagnostic finds it, and which does not?
4. Apply `labeldrop` and then `drop`. What is the difference in what remains?
5. Breach `label_value_length_limit` instead of `sample_limit`. Is the failure mode the same?
6. Write the three-sentence incident summary you would post after resolving this.

---

### Chapter 25 — Storage, Retention, Backups and Locking the Door
**Target: 6,500 words**

**The chapter's single job.** Cover exactly as much TSDB internals as changes an operational
decision, and no more — then say plainly what most introductory books skip: Prometheus has no
authentication, has never had one, and its built-in TLS and basic auth are experimental.

**After this chapter you can…**
1. Size a Prometheus disk from the official formula, and measure your own bytes-per-sample.
2. Configure retention the current way, and explain why the CLI flags are the wrong way.
3. Say why size-based retention does not bound total disk usage, and what number to target instead.
4. Take a snapshot and restore it into a throwaway instance.
5. Build a meta-monitoring row that tells you when Prometheus itself is in trouble.
6. Put authentication in front of Prometheus and explain why the built-in option is not it.

**Concepts introduced, in order.** The head block, 2-hour persistent blocks in ULID directories, the
WAL in 128 MB segments (minimum three retained), `chunks_head/` for m-mapped head chunks →
compaction into blocks spanning up to 10% of retention or 31 days, whichever is smaller → **RAM tracks
active series; disk tracks samples** — so a shorter retention never fixes an OOM (the callback chapter
24 promised) → the official disk formula verbatim
(`retention_time_seconds × ingested_samples_per_second × bytes_per_sample`, with 1–2 bytes per
sample) and how to measure your own with
`rate(prometheus_tsdb_compaction_chunk_size_bytes_sum[1h]) / rate(prometheus_tsdb_compaction_chunk_samples_sum[1h])`
→ **the honest statement that there is no official memory-per-series figure**; the widely-quoted 3 kB
is a 2020 head-chunk number for Prometheus 2.20, not RSS; budget more and measure → **retention lives
in the config file** under `storage.tsdb.retention.{time,size,percentage}`, is runtime-reloadable, and
takes precedence over the flags, **both of which are marked [DEPRECATED] in 3.13.1** (with a note that
the `storage.md` docs page is itself internally inconsistent here — follow the config reference and
the CLI help) → why size retention does not bound total disk (WAL and head chunks count toward the
total but are never trimmed by it) so target **80–85%** → block deletion lags by up to a cleanup cycle,
and expired-block cleanup can take up to two hours → **NFS and EFS are explicitly unsupported**;
Docker Desktop bind mounts for the TSDB risk unrecoverable corruption, which is why the lab has used a
named volume since chapter 1 → `out_of_order_time_window` named, for chapter 28 → snapshots via the
admin API, and what "backup" honestly means → WAL replay time and
`prometheus_tsdb_data_replay_duration_seconds` → **meta-monitoring row**: `up`,
`scrape_duration_seconds`, `scrape_samples_post_metric_relabeling`, `prometheus_tsdb_head_series`,
rule-evaluation metrics (building on chapter 19's meta-alerts) → **security, stated plainly**:
Prometheus has no login page; the docs say its endpoints should not be exposed to public networks;
`--web.enable-admin-api` lets anyone delete series; `--web.enable-lifecycle` exposes `/-/reload` and
`/-/quit`; `--web.cors.origin` defaults to `.*`; and the built-in `--web.config.file` TLS and
bcrypt basic auth are **explicitly experimental** and all-or-nothing — a reverse proxy is the real
answer.

**Lab step.**
*Files changed:* retention moved out of the command line into `prometheus.yml` under
`storage.tsdb.retention.time` and `.size`, then hot-reloaded. The existing `edge` Caddy service (added
in chapter 12) gains **bcrypt basic auth in front of Prometheus on :8443**, and the published `9090`
port is removed from `compose.yaml` entirely.
*Files added:* `prometheus/rules/meta-recording.yml`; `dashboards/meta.json`.
*Reader does:* measures their own bytes-per-sample and computes the disk needed for 90 days at the
current ingest rate. Runs `promtool tsdb analyze --extended` against the lab volume and ranks the top
metric names by series count. Takes a snapshot through the admin API and restores it into a throwaway
second Prometheus container. Then removes port 9090 and confirms **Grafana still works**, because it
talks over the Compose network and never used the published port.
*Reader observes:* block deletion lagging the retention change; Grafana unaffected by the port
removal; a browser prompt for credentials at `:8443`.
*Verification:* `make verify-ch25` asserts port 9090 is not reachable from the host, that `:8443`
returns 401 without credentials and 200 with them, and that Grafana's data source health check still
passes.

**Depends on.** Ch1 (named volume), Ch12 (`edge`), Ch19 (meta-alerts), Ch24.

**Exercises.**
1. Measure your bytes-per-sample. How does it compare with the docs' 1–2 bytes, and why might it
   differ?
2. Set size retention to 100% of a small volume and watch what happens. Then set 80% and explain the
   difference.
3. Restore your snapshot into a second container and query it. What is missing, and why is "snapshot"
   not the same as "backup"?
4. Turn on `--web.enable-admin-api`, delete a series, and then explain in one line why this flag must
   never be reachable.
5. Time a Prometheus restart with a full head block. What did the query API do during that window?
6. Put Grafana behind the proxy too. What breaks, and what does that tell you about `root_url`?

---

### Chapter 26 — When One Prometheus Isn't Enough: HA, `remote_write`, and the Scaling Map
**Target: 6,500 words**

**The chapter's single job.** Give the reader an honest decision spine and the two skills they will
actually need in a first job — running an HA pair without lying to themselves about it, and shipping
to a managed backend — then map the long-term-storage landscape without teaching any of it.

**After this chapter you can…**
1. Decide, from ingestion rate, retention, blast radius and multi-region, whether you need any of
   this yet.
2. Run two scrapers and explain precisely why a load balancer in front of them is **not** HA.
3. Name the three mutually contradictory HA replica-label conventions and pick correctly per backend.
4. Configure `remote_write` with current defaults, and build a lag panel from the current metrics.
5. Say what federation is, what it is for, and why it is not a scaling strategy.
6. Choose between Thanos, Mimir, VictoriaMetrics, Cortex and a managed service — without deploying
   any of them.

**Concepts introduced, in order.** A decision spine first, before any product names → **HA done
honestly**: two identical scrapers gives you scrape availability, but a load balancer in front of them
is not HA, because each refresh hits a different replica with a different scrape offset and the graph
visibly flaps; deduplication happens in a replica-aware query layer or at the receiver, **never** in
the load balancer, and **Grafana has no dedup feature** → **the three mutually contradictory HA label
conventions, printed side by side**, because getting this backwards is the highest-value gotcha in
this area: Thanos requires replicas to have **different** replica labels; Mimir/Cortex/AMP key an HA
tracker on `cluster` + `__replica__` and strip the replica label from the winner; VictoriaMetrics
requires replicas to have **byte-identical** `external_labels` → **federation as a scrape**: why the
official example federates only `{__name__=~"job:.*"}` (recording-rule output), why `honor_labels:
true` is mandatory, that it silently downsamples at the parent's interval, has no backfill, and does
not reduce the child's storage — so it is not a scaling strategy → **`remote_write` mechanics** with
the **current 3.x `queue_config` defaults**, because every blog post has the old ones: `capacity`
10000, `max_shards` **50** (not 200), `min_shards` 1, `max_samples_per_send` **2000** (not 500),
`batch_send_deadline` 5s, `min_backoff` 30ms, `max_backoff` **5s**, `sample_age_limit` 0s,
`send_exemplars` false, `send_native_histograms` false, and **`enable_http2` false for remote write
specifically** → **`retry_on_http_429` defaults to false**, so throttled samples are dropped silently
→ auto-sharding recalculated every 10 s, with the official guidance that `max_shards` rarely needs
raising and `capacity` should be 3–10× `max_samples_per_send`; remote write costs roughly +25% memory
→ **the current lag expression**:
`prometheus_remote_storage_queue_highest_timestamp_seconds − prometheus_remote_storage_queue_highest_sent_timestamp_seconds`,
needing no `ignoring()`/`group_right` because both metrics share `remote_name` and `url` — and the
note that `prometheus_remote_storage_{samples,histograms,exemplars}_in_total` and
`prometheus_remote_storage_highest_timestamp_in_seconds` were **deprecated in 3.7.0**, which is what
every surviving blog post still uses → **Remote Write 2.0**: still spec 2.0-rc.4, still experimental,
`prometheus.WriteRequest` still the default, the receiver's
`--web.remote-write-receiver.accepted-protobuf-messages` defaults to v1 only (so a naive lab 415s),
and the **silent-data-loss trap**: a 1.0 receiver that ignores `Content-Type` decodes a v2 payload
with the v1 schema, produces an empty result with no decoding error, and returns 2xx — so treat a 2xx
with **no** `X-Prometheus-Remote-Write-*-Written` headers as a 415 → **`send_native_histograms: true`
named here as the third of the three native-histogram opt-ins**, closing the loop with chapter 10 →
agent mode (`--agent`, stable in 3.x) and what it switches off → `remote_read` as a migration and
backfill tool, listed unstable, with no aggregation pushdown → `hashmod` sharding named and dismissed
→ **a one-page comparison table, taught not at all**: Thanos v0.42.2, Mimir 3.1.x, VictoriaMetrics
v1.148.x, Cortex v1.21.1 (**not** archived — the "Cortex is dead" narrative is stale), Grafana Cloud,
AMP (which accepts `remote_write`) and Google Cloud Managed Service for Prometheus (**which does
not** — the config reference says so verbatim) → the correction that Grafana Agent reached EOL on
2025-11-01 and the successor is Alloy → two sentences on Alertmanager HA: send to all instances,
never behind a load balancer, and publish 9094 on **UDP as well as TCP**.

**Lab step.**
*Files added:* overlay `compose.scale.yaml` adding `prometheus-b` (:9099) with an identical scrape
config and a distinguishing `external_labels` entry.
*Reader does:* adds `prometheus-b` as a second Grafana data source and flips between them on the same
panel **to see the flap for themselves**. Then reconfigures `prometheus-b` with
`--web.enable-remote-write-receiver`, adds a `remote_write` block to the primary, and builds a lag
panel from the current queue metrics. Breaks it deliberately by pausing the receiver
(`docker compose pause prometheus-b`) and watches the queue back up and then recover. Finally runs a
throwaway `prometheus --agent` container for five minutes and tries to query it.
*Reader observes:* the flap between replicas; the lag panel climbing and draining; the agent refusing
to answer a query.
*Verification:* `make verify-ch26` asserts that lag returns to under 30 s within two minutes of
unpausing the receiver, and that both replicas report the same `count()` of Snip series while
disagreeing on individual sample timestamps.

**Depends on.** Ch10 (native histograms), Ch12, Ch14 (reading a flapping graph honestly), Ch25.

**Exercises.**
1. Put both Prometheus instances behind a round-robin proxy and point Grafana at the proxy. Refresh
   ten times. Describe what you see, and why no Grafana setting fixes it.
2. Set the HA labels three ways — Thanos-style, Mimir-style, VictoriaMetrics-style. Which of the
   three is correct for which backend, and what breaks if you swap them?
3. Federate `{__name__=~"job:.*"}` from `prometheus-b` into the primary. Now try to federate
   everything. Measure the body size.
4. Forget `honor_labels: true` on the federation job. What happens to `instance`?
5. Compute how long your `remote_write` queue can buffer at your current ingest rate before dropping.
6. Set `retry_on_http_429: true`. Under what circumstances would you not?

> **Part VIII closing box.** The monitoring system now has a measured disk budget, a door with a lock,
> a second copy of itself, and an alert that fires when its own rule engine falls behind.

---

## PART IX — The wider world (ch 27–29)

> **Part opener.** Everything so far runs on one laptop with Docker Compose, and everything so far
> transfers. This part says exactly what changes when the platform changes, what OpenTelemetry does
> and does not alter, and what to do when a metric genuinely cannot answer the question. All three
> chapters are optional; the book is complete without them.

---

### Chapter 27 — Optional: What Changes on Kubernetes
**Target: 7,000 words**

**The chapter's single job.** Marked optional on its first line and scoped strictly to the delta.
Exactly four things change; everything you have learned about PromQL, the data model, instrumentation,
dashboards, alerting logic and SLOs does not — and saying so, then proving it by importing the
chapter-13 dashboard unchanged, is the point of the chapter.

**After this chapter you can…**
1. Name the four things that change and the six that do not.
2. Read a `kubernetes_sd_config` by hand and say why `role: service` is wrong for scraping
   applications.
3. Write a `ServiceMonitor` that is actually discovered — including the label everyone forgets.
4. Debug a zero-target `ServiceMonitor` by decoding the operator's generated config.
5. Distinguish cAdvisor, kube-state-metrics and metrics-server by the question each answers.
6. Explain why a default `kube-prometheus-stack` install pages you on day one for things you cannot
   fix.

**Concepts introduced, in order.** The four things that change: targets become a query against the
cluster API; configuration becomes CRD objects an operator compiles into a **gzipped Secret**; you
inherit a large amount of free telemetry (~35 dashboards, 41 rule groups); and cardinality, target
churn and Prometheus's own resource limits get materially harder → **what does not change**, stated
first and proved last → `kubernetes_sd_config`'s six roles (node, service, pod, endpoints,
endpointslice, ingress) → **`role: service` hits the Service VIP, so every scrape lands on a random
backend with no stable instance — use endpoints or endpointslice** → the Endpoints API is deprecated
as of Kubernetes 1.33; EndpointSlice is the replacement, and `ServiceMonitor.spec.serviceDiscoveryRole`
selects it (switching requires `get`/`list`/`watch` RBAC on `discovery.k8s.io` endpointslices, or
targets vanish completely) → the `prometheus.io/scrape` annotation is a **community convention**, not
an upstream feature → the kubelet is not a pod, so the operator synthesises a `kubelet` Service in
`kube-system` → **the ten Prometheus Operator CRDs across three API versions**, with real attention
only to `ServiceMonitor`, `PodMonitor`, `PrometheusRule` and `Probe`; `ScrapeConfig` is **still
`v1alpha1`** as of 2026-07-28, and there is **no RemoteWrite CRD** →
**⚠ the missing `release: <helm-release-name>` label**, which `kube-prometheus-stack`'s default
selectors require and whose symptom is zero targets with **no error message anywhere** — documented as
the #1 failure "by a very large margin", and given a full page → **the four-selector chain that must
all agree**: `Prometheus.spec.serviceMonitorNamespaceSelector` →
`Prometheus.spec.serviceMonitorSelector` → `ServiceMonitor.spec.namespaceSelector` →
`ServiceMonitor.spec.selector` → `Service.spec.selector` → `endpoints[].port` (which names a **Service
port by name**, a string, not a number) → **the definitive debugging command**:
`kubectl -n monitoring get secret prometheus-... -ojson | jq -r '.data["prometheus.yaml.gz"]' | base64 -d | gunzip | grep <monitor>`
— *the single highest-leverage debugging skill on Kubernetes* → the CRD snake_case-to-camelCase
translation trap (`relabelings`, `metricRelabelings`, `sourceLabels`, `targetLabel`, `honorLabels`) and
`relabelings` belonging **inside an endpoint**, not at `spec:` level → `kubectl apply --server-side
--force-conflicts` for the CRDs, because client-side apply fails on the 262144-byte annotation limit,
and Helm v3 **never** upgrades CRDs → **the three components readers conflate**: cAdvisor (compiled
into the kubelet, `/metrics/cadvisor`) answers *what a container is using*; kube-state-metrics answers
*what the API says should exist* — and `kube_pod_container_resource_requests/limits` are
**declarations, not usage**, which is why every "% of limit" panel is a join across two exporters
(chapter 11's shape again); metrics-server is **not a Prometheus exporter at all** → omitting
`spec.storage` gives you an emptyDir and loses all history on every pod restart → sharding requires
`__tmp_disable_sharding` on singletons like kube-state-metrics, or joined dashboards silently return
partial data → **on EKS/GKE/AKS the control plane is not yours**, so `kubeEtcd`,
`kubeControllerManager`, `kubeScheduler` (and usually `kubeProxy`) show as down and their shipped
alerts fire on day one — set them to `enabled: false`, **which is the perfect callback to chapters 19
and 21: the default install pages you for things you cannot fix** → the Grafana chart repository moved
on 2026-01-30 to `https://grafana-community.github.io/helm-charts`, and pre-migration releases were
signed with a different key.

**Lab step.**
*A clearly-signposted parallel lab that never touches `compose.yaml`.* `kind create cluster`; install
CRDs with `kubectl apply --server-side --force-conflicts`; install `kube-prometheus-stack` 87.21.0
with `kubeEtcd.enabled=false`, `kubeControllerManager.enabled=false`, `kubeScheduler.enabled=false`
(and understand why); load the same `snip-api` image; write a Deployment, Service and `ServiceMonitor`
**with the correct `release:` label**; port-forward `svc/prometheus-operated`. Then **import
`dashboards/snip-red.json` unchanged** and confirm every panel works, and port one chapter-21
burn-rate rule into a `PrometheusRule`.
*Reader then breaks it:* deletes the `release:` label, watches the targets silently vanish with no
error, and debugs it with the gunzip command.
*Reader observes:* the dashboard working unmodified — the proof that none of the queries were ever
Kubernetes-specific — and then a completely silent failure they can now diagnose in thirty seconds.
*Verification:* `make verify-ch27` (kind profile) asserts the ServiceMonitor produces targets, that
the imported dashboard's three RED queries return data, and that the ported `PrometheusRule` loads.

**Depends on.** Ch12 (relabeling), Ch13 (the dashboard being imported), Ch16, Ch21, Ch22.

**Exercises.**
1. Write a `ServiceMonitor` with a numeric `port:`. Read the error. Now name a container port instead
   of a Service port. Read that error too.
2. Remove the `release:` label and time how long it takes you to find the cause using only the gunzip
   command.
3. Build "memory as a percentage of limit" using cAdvisor and kube-state-metrics. Which exporter
   supplies which side of the join?
4. Install with the control-plane components enabled on a managed cluster (or simulate it). Count the
   alerts that fire on day one, and say which chapter told you this would happen.
5. Port one more chapter-21 tier into a `PrometheusRule`. What changed in the YAML, and what did not?
6. `helm upgrade` the chart and check whether the CRDs changed. What did you have to do yourself?

---

### Chapter 28 — OpenTelemetry and Prometheus
**Target: 5,000 words**

**The chapter's single job.** Take a position rather than survey. Explain the three integration paths
with a working example and an honest verdict for a Prometheus-centric shop, and be specific about
what OTLP does to your metric names and labels — because that is what leaks into everyday PromQL.

**After this chapter you can…**
1. Name the three ways OpenTelemetry metrics reach Prometheus, and choose one.
2. Predict what happens to a dotted metric name and a UCUM unit under the default translation
   strategy.
3. Find your resource attributes after ingestion, and promote the two that matter.
4. Explain the delta-versus-cumulative trap and why it is a silent data-loss path.
5. State the cost that OTLP ingestion adds to every series.
6. Say why this book taught native client libraries on the main line.

**Concepts introduced, in order.** The three paths: (1) the OTel SDK plus its Prometheus exporter
(pull; note the exporter is still 0.x and **outside** OTel's stability guarantees, unlike the SDK);
(2) **OTLP pushed straight into Prometheus's own receiver** — `--web.enable-otlp-receiver`, endpoint
`/api/v1/otlp/v1/metrics` (note the doubled `v1`); (3) the Collector in the middle → the `otlp:`
config block and its keys (`promote_resource_attributes`, `keep_identifying_resource_attributes`,
`translation_strategy`, `convert_histograms_to_nhcb`, and the rest) → **the four translation
strategies** from `prometheus/otlptranslator` v1.0.0, shared identically by Prometheus and the
Collector: `UnderscoreEscapingWithSuffixes` (the default), `UnderscoreEscapingWithoutSuffixes`,
`NoUTF8EscapingWithSuffixes`, and `NoTranslation` (which Prometheus itself marks experimental and
warns can cause silent series collisions) → what the default strategy does: dots to underscores, UCUM
units expanded (`s`→`seconds`, `By`→`bytes`), bracketed annotations like `{packet}` **dropped**,
`_total` appended to monotonic sums → **the Resource becomes a `target_info` metric**, with
`service.namespace`/`service.name` folded into `job` and `service.instance.id` into `instance` → the
`otel_scope_name` / `otel_scope_version` / `otel_scope_schema_url` labels the Go exporter stamps on
**every** series by default, and what up to three extra labels on every series costs → **cumulative
versus delta**: Prometheus is cumulative-only and the OTel SDK's default is cumulative, so the happy
path needs nothing; trouble starts when the temporality preference is set to delta for a different
backend, and the two mutually exclusive experimental flags (`otlp-deltatocumulative`,
`otlp-native-delta-ingestion`) are the only recourse — the Collector's
`prometheusremotewriteexporter` states plainly that non-cumulative monotonic, histogram and summary
metrics are **dropped**, which is a silent data-loss path → pushed data from several senders usually
also needs `storage.tsdb.out_of_order_time_window` → **Julius Volz's six named friction points**
(loss of `up`, name translation, resource attributes versus target labels, extra server config,
performance, redundant standardisation) as the honest reason this book taught native client libraries
on the main line → the note that OpenTelemetry graduated from CNCF in May 2026, and that the Collector
is still v0.x at the distribution level with stability declared per component.

**Lab step.**
*Files changed:* `snip-worker` is re-instrumented with the OpenTelemetry SDK in place of
`prometheus-client` and pushes OTLP into Prometheus with `--web.enable-otlp-receiver`. `snip-api` is
**left on `prometheus-client`**, so both models are visible side by side in one stack.
*Reader does:* diffs the resulting metric names against the originals in the Metrics Explorer;
inspects `target_info`; finds the `otel_scope_*` labels and counts the extra series; then fixes the
`job` and `instance` labels with `promote_resource_attributes` and
`keep_identifying_resource_attributes` in the `otlp:` block.
*Reader observes:* `snip.worker.jobs` arriving as `snip_worker_jobs_total`; three extra labels on
every series; `job` and `instance` initially wrong, then right.
*Verification:* `make verify-ch28` asserts the OTLP-ingested series exist under their translated
names and that `job` matches the promoted resource attribute.

**Depends on.** Ch2, Ch5, Ch7 (the cardinality cost of `otel_scope_*`), Ch8, Ch12.

**Exercises.**
1. Push a metric named `http.server.request.duration` with unit `s`. Predict its Prometheus name
   before you look.
2. Turn off scope info. How many series did you save? Was it worth it?
3. Set delta temporality on the worker. What arrives in Prometheus, and what error did you get?
4. Compare the same three metrics via the SDK's Prometheus exporter and via OTLP push. Which
   differences are cosmetic and which are structural?
5. Write the two-sentence recommendation you would give your own team, and defend it against Volz's
   six points.

---

### Chapter 29 — Beyond Metrics: Exemplars, Traces, Logs, and Where to Go Next
**Target: 5,500 words**

**The chapter's single job.** Open with a question the reader's own dashboard genuinely cannot answer
— *p99 doubled at 14:20; which requests?* — name the bargain metrics made (request identity was
discarded on purpose, in exchange for a cost curve that does not move with traffic), and then teach
exemplars end-to-end as the sanctioned bridge. Close the book by pointing outward honestly.

**After this chapter you can…**
1. Explain why metrics structurally cannot answer "which request", and why the obvious fix is the
   cardinality bomb from chapter 24.
2. Turn exemplars on end to end and click from a latency panel into a trace.
3. Name every switch exemplars require, on both sides, and say why `curl` will not show them.
4. Describe Loki's cardinality physics and where a trace ID belongs in a log line.
5. Say what a trace answers that a metric cannot, and vice versa.
6. Keep a stack current: tell a stale tutorial from a current one in ten seconds.

**Concepts introduced, in order.** The bargain metrics made → the other signals as answers to specific
questions rather than as pillars: *which request* → traces; *what did it say* → logs; *which function*
→ profiles → a short, fair critique of the three-pillars framing as a description of storage silos
rather than a debugging workflow → **exemplars, taught properly because both halves fail silently**:
`EnableOpenMetrics: true` on the client **and** `--enable-feature=exemplar-storage` on the server
(still a feature flag in 3.13); `trace_id` and `span_id` as the label keys (W3C-aligned, and what
Grafana's trace linking expects — **not** the official Go example's `dummyID`); OpenMetrics or
protobuf only, never classic text; **counters and histograms only**, never gauges; **range queries on
a time series panel only**, never Instant, never Stat; **no cardinality cost at all**, which is the
whole point; a fixed-size in-memory circular buffer (`storage.exemplars.max_exemplars`, default
100000), so a dead link is not always a bug; and `exemplarTraceIdDestinations` on the Grafana data
source, with the trap that if the app emits `trace_id` and the config says `traceID` you get stars
with a dead link and **no error whatsoever** → **sample at 100% in the lab**, because the OTel default
`TraceBased` exemplar filter drops everything from unsampled spans, so 1% head sampling leaves the
panel starless → Tempo and TraceQL in one page, including that TraceQL's structural operators have no
PromQL equivalent → Loki in one page: it indexes **labels, not lines**, so it has the same cardinality
physics you already understand, and **structured metadata** is the correct home for a trace ID →
terminology hygiene the ecosystem now demands: **Alloy**, not Agent, not Promtail (removed in Loki
3.7.3); **Drilldown**, not Explore Logs/Metrics; **OBI**, not Beyla → a paragraph each on continuous
profiling (OTel Profiles is Alpha, path `/v1development/profiles`) and eBPF → **what is still moving**,
so the reader is not blindsided in six months: Remote Write 2.0, OpenMetrics 2.0, profiles → **how to
keep current**: release cadences, the `/latest/`-versus-`main` docs rule from Appendix F, and a
ten-second staleness test → what to read next.

**Lab step.**
*Files added:* overlay `compose.signals.yaml` with `tempo`, `loki` and `alloy`.
*Files changed:* `--enable-feature=exemplar-storage` on Prometheus; `EnableOpenMetrics` on Snip's
metrics handler; exemplars emitted on the redirect-latency histogram with `trace_id`/`span_id` keys;
`exemplarTraceIdDestinations` on the provisioned data source; trace sampling at 100%, **with the
printed explanation of why 1% would leave the panel starless**.
*Reader does:* clicks a star on the latency panel and lands inside the trace of one specific slow
redirect; from the trace, jumps to that request's log lines. Then deliberately renames the exemplar
label key to `traceID` on one side and observes stars with a dead link and no error.
*Reader observes:* the end-to-end jump — and the silent failure that a single mismatched key produces.
**Then the final act of the book:** `make reset`, `git checkout ch29`, `make up`, and confirm the
entire stack rebuilds itself from the repository with every dashboard, rule, alert and SLO intact.
*Verification:* `make verify-ch29` asserts `/api/v1/query_exemplars` returns at least one exemplar
carrying a `trace_id`, and that the full-stack rebuild passes every previous chapter's verify target
in sequence.

**Depends on.** Ch5, Ch7 (why a trace ID is not a label), Ch10, Ch13, Ch24, Ch28.

**Exercises.**
1. Turn off `EnableOpenMetrics` and leave the server flag on. What do you see? Now do the reverse.
2. `curl` the metrics endpoint with and without an OpenMetrics `Accept` header. Diff the output.
3. Toggle an exemplar-bearing panel from Range to Instant. Explain what happened using one sentence
   from this chapter.
4. Set trace sampling to 1%. Count the stars. Now explain the OTel exemplar filter to a colleague.
5. Add a Loki stream label with high cardinality, then move it to structured metadata. What changed,
   and which chapter of this book already told you why?
6. Take any Prometheus blog post you can find. In ten seconds, date it. Which single tell did you use?

> **Final box.** Run `scripts/scenario-outage.sh` one more time and write the post-mortem you could
> not have written on page one: when it started, how many users were affected, what the error budget
> cost was, which layer was responsible, which alert fired and how long it took, and what you would
> change. That document is the book's actual exit exam.

---

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

# §F. CONCEPT DEPENDENCY GRAPH

Every term the book uses, and the chapter where it is **first defined**. No chapter may use a term
whose first-definition chapter number is higher than its own, with the sole exception of the four
IOU'd terms marked ⓘ, which chapter 3 uses deliberately, flags in print, and repays on schedule. This
table is the manuscript's compile-time check: the technical-review pass greps every chapter for every
term and fails on any forward reference that is not an IOU.

## F.1 Foundations

| Concept | First taught |
|---|---|
| Monitoring; asking questions of a running system | ch1 |
| Pull model; target; scrape; scrape interval | ch1 |
| `/metrics` endpoint | ch1 |
| Metric name; label; sample; time series | ch1 |
| `up`, and why liveness is free | ch1 |
| `job` and `instance` as attached labels | ch1 |
| Prometheus Query page: Table / Graph / Explain, Metrics Explorer, Tree view | ch1 |
| RED (Rate, Errors, Duration) | ch1 |
| No-Data debugging ladder (rungs 1–4) | ch1 |
| Named volume for the TSDB; the Compose `command:` override trap | ch1 |
| Exposition format: `# HELP`, `# TYPE`, sample lines | ch2 |
| Series identity; `__name__` as a reserved label | ch2 |
| Metric family (`_bucket` / `_sum` / `_count`) | ch2 |
| Target labels versus application labels | ch2 |
| Series selectors; the four matchers `=` `!=` `=~` `!~` | ch2 |
| Fully-anchored regexes; `.` matches newlines in v3 | ch2 |
| Empty-string matchers also select series lacking the label | ch2 |
| The at-least-one-non-empty-matcher rule | ch2 |
| Quoted UTF-8 selector syntax | ch2 |
| Staleness markers; the lookback delta and `lookback_delta` | ch2 |
| Debugging ladder, full twelve rungs | ch2 (Appendix B) |

## F.2 Grafana foundations

| Concept | First taught |
|---|---|
| Grafana as a query client | ch3 |
| Provisioning: data source YAML, dashboard provider YAML, the directory split | ch3 |
| Data source `uid`; `isDefault`; `jsonData.timeInterval` | ch3 |
| Dashboard `uid`; `id: null`; `allowUiUpdates` | ch3 |
| Panel; query; legend; unit; time picker; refresh | ch3 |
| The IOU device | ch3 |
| ⓘ `rate()` — used in ch3, taught in ch6 | ch6 |
| ⓘ `sum by` — used in ch3, taught in ch8 | ch8 |
| ⓘ `histogram_quantile` — used in ch3, taught in ch10 | ch10 |
| ⓘ `$__rate_interval` — used in ch3, taught in ch13 | ch13 |

## F.3 The data model and instrumentation

| Concept | First taught |
|---|---|
| Metric type as a contract | ch4 |
| Counter: monotonic in a process lifetime, resets to zero, only differences carry meaning | ch4 |
| Gauge: no direction guarantee; blindness between scrapes | ch4 |
| The counter/gauge asymmetry | ch4 |
| Summary, and why client-side quantiles cannot be aggregated | ch4 |
| Untyped metrics; the `*_info` value-1 pattern | ch4 |
| `resets()`, `changes()` | ch4 |
| Odometer / speedometer analogy | ch4 |
| Registry; collector; construct-once-at-startup | ch5 |
| A fresh registry starts empty | ch5 |
| Naming law: `_total`, base units, unit-before-type | ch5 |
| The aggregation-honesty test | ch5 |
| Templated route labels | ch5 |
| Labels application code must never emit | ch5 |
| `CONTENT_TYPE_LATEST`; Prometheus 3 strict `Content-Type`; `fallback_scrape_protocol` | ch5 |
| Python multiprocess trap (sidebar) | ch5 (Appendix E) |
| Cardinality as multiplication; the series budget worksheet | ch7 |
| The label-admission test; under-10 / investigate-above-100 | ch7 |
| The histogram multiplier | ch7 |
| Lazy series creation | ch7 |
| Churn versus cardinality | ch7 |
| The always-wrong label list; exemplars named as the right home for a trace ID | ch7 |

## F.4 PromQL

| Concept | First taught |
|---|---|
| The four expression types | ch6 |
| Range-vector selector; left-open, right-closed | ch6 |
| `count_over_time` (as the sample-count verifier) | ch6 |
| `rate()`; the extrapolation algorithm; the 1.1× threshold; the half-interval clamp | ch6 |
| `increase()`; why it returns fractions | ch6 |
| Counter resets and what is lost across one | ch6 |
| The two-sample minimum and the 4× rule | ch6 |
| `delta()`, `deriv()` as gauge-only; `irate()` (discouraged) | ch6 |
| Aggregation operators; `by` versus `without` | ch8 |
| The rate-then-aggregate law | ch8 |
| `topk` per-evaluation gotcha; `count_values`; `group()` | ch8 |
| Binary operators; one-to-one matching; metric-name dropping | ch9 |
| Comparison operators and the `bool` modifier | ch9 |
| `and`, `or`, `unless` | ch9 |
| The correct error-ratio pattern; `avg(a/b)` versus `sum(a)/sum(b)` | ch9 |
| The empty-result problem; `or 0 *`; `or vector(0)` | ch9 |
| `absent()`, `absent_over_time()` | ch9 |
| `label_replace`, `label_join` | ch9 |
| `fill()` / `fill_left()` / `fill_right()` (named, flagged, unused) | ch9 |
| Classic histogram anatomy; `le` normalisation to float form | ch10 |
| `histogram_fraction`; the bucket-ratio SLI form | ch10 |
| `histogram_quantile` and its two interpolation rules | ch10 |
| `le` must survive the grouping clause | ch10 |
| Bucket design from the objective; cross-language default buckets | ch10 |
| `histogram_count`, `histogram_sum`, `histogram_avg` | ch10 |
| Native histograms and their three opt-ins | ch10 |
| Vector matching; `on()`, `ignoring()`, `group_left`, `group_right` | ch11 |
| `*_info` joins; `info()` (flagged) | ch11 |
| The `_over_time` family; `max_over_time` | ch11 |
| Subqueries; the epoch-aligned step grid; the `[1m:1m]` trap | ch11 |
| `offset`; `@`; `@ start()` / `@ end()` | ch11 |
| Operator precedence; `sort` on instant queries only | ch11 |
| The experimental-function decode table | ch11 (Appendix C) |
| `predict_linear` | ch22 |

## F.5 Configuration and operations

| Concept | First taught |
|---|---|
| `global` versus per-job precedence; `external_labels`; `scrape_protocols` | ch12 |
| `metrics_path`, `scheme`, `params`, `honor_labels` | ch12 |
| The six scrape limits and their all-or-nothing semantics | ch12 |
| `static_configs`, `file_sd_configs`, `docker_sd_configs` | ch12 |
| The `__meta_*` / `__address__` / `__param_*` / `__tmp_*` namespace | ch12 |
| Relabeling: `source_labels`, `target_label`, `separator`, `regex`, `replacement` | ch12 |
| Actions `replace`, `keep`, `drop`, `labelmap`; `hashmod` (named, dismissed) | ch12 |
| The three pipeline positions | ch12 |
| `--config.auto-reload`; `POST /-/reload`; `--web.enable-lifecycle` | ch12 |
| `promtool check config --lint` | ch12 (Appendix G) |
| Recording rules; groups; sequential-within, parallel-across | ch15 |
| `level:metric:operations` naming | ch15 |
| Record buckets, never quantiles | ch15 |
| Rule-engine self-metrics | ch15 |
| TSDB head block, 2-hour blocks, WAL, m-mapped head chunks | ch25 |
| RAM tracks active series; disk tracks samples | ch25 |
| The disk formula; measuring your own bytes-per-sample | ch25 |
| Retention in the config file; the deprecated flags; the 80–85% rule | ch25 |
| Snapshots; WAL replay; NFS/EFS unsupported | ch25 |
| Meta-monitoring metrics | ch25 (alerts in ch19) |
| Prometheus has no authentication; the dangerous flags; reverse proxy | ch25 |
| `/api/v1/status/tsdb`; `promtool tsdb analyze` | ch24 |
| `prometheus_tsdb_head_series`; `scrape_samples_post_metric_relabeling` | ch24 |
| HA replica pairs; why an LB is not HA; the three label conventions | ch26 |
| Federation; `honor_labels` on a federation job | ch26 |
| `remote_write`; `queue_config`; auto-sharding; the lag expression | ch26 |
| `retry_on_http_429`; Remote Write 2.0 and its silent-loss trap | ch26 |
| `send_native_histograms` (the third opt-in) | ch26 |
| Agent mode; `remote_read` | ch26 |
| The long-term-storage map | ch26 |

## F.6 Dashboards

| Concept | First taught |
|---|---|
| `$__interval`; Max data points; pixel width | ch13 |
| `$__rate_interval` and its precedence chain | ch13 |
| Instant versus range per panel type | ch13 |
| The five panel types; the dead panel names | ch13 |
| The five transformations; order matters | ch13 |
| Query variables; `${var:format}`; `$__auto`; the `=~` rule | ch13 |
| Thresholds with a `null` base step | ch13 |
| Dynamic Dashboards; Custom versus Auto grid; Rows and Tabs; conditional rendering | ch13 |
| schemaVersion migration on open; `$$` escaping in provisioning YAML | ch13 |
| A graph is a sampled query result | ch14 |
| The vanishing spike and its `max_over_time` fix | ch14 |
| The Stat-panel staleness trap | ch14 |
| `percent` versus `percentunit` | ch14 |
| Stacking; multiple Y-axes; legend hygiene; panel descriptions | ch14 |

## F.7 Alerting and SLOs

| Concept | First taught |
|---|---|
| Alerting rule; alert instance; label inheritance | ch16 |
| `for` as a debounce; `keep_firing_for` | ch16 |
| `ALERTS` and `ALERTS_FOR_STATE` | ch16 |
| Counters versus rates versus ratios as alert expressions | ch16 |
| Symptoms versus causes | ch16 |
| Annotation templating: `$labels`, `$value`, `humanize` | ch16 |
| The silent-alert failure | ch16 |
| `alerting:` block; `api_version: v2` | ch16 |
| Alertmanager's data model; `POST /api/v2/alerts` | ch17 |
| `group_by`; the dispatcher | ch17 |
| `group_wait`, `group_interval`, `repeat_interval` | ch17 |
| Route tree; depth-first; first-match-wins; `continue` | ch17 |
| `matchers:` grammar and quoting | ch17 |
| Receivers; the webhook payload; `notification_reason` | ch17 |
| Go templating; `.CommonLabels`; the whitespace-trim dash | ch17 |
| `inhibit_rules` and the missing-labels-are-equal caution | ch17 |
| `time_intervals`; route-level mute/active; UTC; no midnight wrap | ch17 |
| Silences; `amtool`; expiry rather than deletion | ch17 |
| `--web.external-url`; gossip on 9094 TCP and UDP | ch17 |
| `promtool test rules`; `input_series` expansion; `1x4` = five samples | ch18 |
| Negative-case testing; `--junit`; CI | ch18 |
| Severity taxonomy as routing | ch19 |
| The five-field annotation template; runbook scope | ch19 |
| Watchdog / dead-man's switch | ch19 |
| Noise auditing from `alertmanager_notifications_total` | ch19 |
| SLI = good / **valid** events; the exclusion list | ch20 |
| SLO versus SLA; window choice; the 28-day trap | ch20 |
| Error budget as currency; budget in minutes; the budget-remaining expression | ch20 |
| Error-budget policy | ch20 |
| Latency SLO as a fraction, never a quantile | ch20 |
| The six approaches; burn rate derived from `budget_fraction × period / long_window` | ch21 |
| Four-tier MWMB; short window = long / 12 | ch21 |
| Budget consumed at fire time; detection time | ch21 |
| The `and`-label-matching trap; `max(...) without (sloth_window)` | ch21 |
| The low-traffic problem and its five fixes | ch21 |
| Sloth and Pyrra as generators | ch21 |

## F.8 The world outside your service

| Concept | First taught |
|---|---|
| Exporter as translator; the three categories | ch22 |
| USE (Utilization, Saturation, Errors) | ch22 |
| node_exporter; `avail` versus `free`; the Docker Desktop VM caveat | ch22 |
| cAdvisor; working set versus usage; CFS throttling; root-cgroup filtering | ch22 |
| The `> 0` guard on an unset memory limit | ch22 |
| postgres_exporter and the 0.20.0 renames | ch22 |
| The exporter evaluation checklist | ch22 |
| Textfile collector | ch22 |
| Pushgateway (discouraged sidebar) | ch22 |
| The multi-target pattern; `__address__` → `__param_target` → `instance` | ch23 |
| `probe_success`, `probe_duration_seconds`, `probe_timeout_seconds` | ch23 |
| `preferred_ip_protocol`; `NET_RAW`; the DNS inversion; `?debug=true` | ch23 |
| `probe_ssl_earliest_cert_expiry` | ch23 |
| `kubernetes_sd_config` and its six roles | ch27 |
| Prometheus Operator CRDs; `ServiceMonitor`; `PrometheusRule`; `Probe` | ch27 |
| The `release:` label; the four-selector chain; gunzipping the config Secret | ch27 |
| cAdvisor versus kube-state-metrics versus metrics-server | ch27 |
| OTLP receiver; `/api/v1/otlp/v1/metrics`; the `otlp:` block | ch28 |
| The four translation strategies; `target_info`; `otel_scope_*` | ch28 |
| Cumulative versus delta temporality | ch28 |
| `out_of_order_time_window` | ch28 (named in ch25) |
| Exemplars; both switches; `trace_id`/`span_id`; the circular buffer | ch29 |
| `exemplarTraceIdDestinations` | ch29 |
| Traces, TraceQL, Tempo | ch29 |
| Logs, LogQL, Loki, structured metadata | ch29 |
| Profiles; eBPF; OBI | ch29 |

---

# §E-bis. APPENDIX H — PCA EXAM ALIGNMENT (commissioned 2026-09-18)

Added after the outline was frozen, by editor decision. Full brief:
`manuscript/_specs/appendix-h-pca.md`. Summary: a competency-to-chapter map for the five
Prometheus Certified Associate domains, six gap-filler sections covering the things this book
deliberately omits but the exam asks about (Pushgateway mechanics, Prometheus's limitations,
SLA vs SLO vs SLI, logs/events/tracing concepts, timestamp metrics, push-vs-pull as a table),
and ~80 original practice questions weighted to the real domain percentages. Target ~9,000 words.

**This reverses exactly one line of §G below** — certification mapping is no longer out of scope.
Nothing else in §G changes, and no chapter changes shape: the appendix sits beside the book
rather than reshaping it. Written last, because its map must cite real section headings.

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

# §H. EDITORIAL DECISION LOG

## H.1 Judge disagreements, resolved

| Disagreement | Decision | One-line justification |
|---|---|---|
| Which spine? Teachability ranked incident-led #1; coverage and lab-coherence ranked lab-first #1 | **Lab-first spine, incident-led part openers** | Lab-first won two of three lenses and lost the third only on density, which is fixable by splitting chapters; the incident architecture is graftable as a one-paragraph device at a third of the narrative cost. |
| Cardinality early or late? | **Both — arithmetic ch7, detonation ch24** | The arithmetic costs two pages and prevents the mistake; the detonation needs enough series to be visceral and a reader who can already read a TSDB status page. |
| Vector matching in ch10/11 or deferred to the exporters chapter? | **Early, ch11** | A reader who stops after the alerting parts must not have missed joins; `*_info` annotation and percent-of-limit are first-job queries. |
| Main-line language: Python or Go? | **Python** | The brief's reader is "comfortable writing code", not "writes Go"; Go remains present as two second services so cross-language traps stay observable. |
| Registry: Docker Hub or quay.io? | **quay.io/prometheus/\*** | One rule for the whole Prometheus org, and no Docker Hub pull-rate surprise halfway through a lab. |
| Dashboards: one chapter or two? | **Two — mechanics (ch13), honesty (ch14)** | All three candidates crammed ~20 concepts into one chapter and all three judges flagged it as where the book's most original material would be lost. |
| Alerting: one chapter or many? | **Five (ch15–19)** | The spine outline's 9,000-word ch14 was the single highest-load chapter proposed anywhere, sitting exactly where the book starts delivering its headline promise. |
| Kubernetes depth? | **One optional chapter, but with the full failure triad** | The coverage lens correctly called omitting the `release:` label, the four-selector chain and the gunzip command a fatal flaw — the chapter's own lab would have failed for the reason it never taught. |
| ch1 opening: timed unaided failure? | **No — a half-page vignette and three named questions** | A timed 15-minute failure in the opening chapter is a real bet against completion; the motivation is preserved, the abandonment risk is not. |

## H.2 Fatal flaws fixed (one line each)

**From the lab-first spine:**
1. **9,000-word ch14 cramming rules + Alertmanager + promtool** → split into five chapters
   (15 rules, 16 alerting rules, 17 Alertmanager, 18 testing, 19 page quality).
2. **Type system taught in ch2, three chapters before anything wants a range vector** → moved to
   ch6, where `rate()` forces it; ch2 keeps only what selectors need.
3. **Go source walked by variable name in the reader's fifth chapter** → the arithmetic stays in the
   main line; the Go identifiers move to one clearly-optional sidebar.
4. **`--scale snip-api=4` incompatible with ch2's second service on a static host port** → the port
   collision is turned into ch2's TRAP box and ch12's payoff: the host port is removed, `edge` is
   added, and scaling then works at any N.
5. **SQLite→Postgres migration mid-book** → Postgres and Valkey are plumbing from ch1; no chapter
   ever rewrites the reader's application.
6. **Kubernetes failure triad missing** → `release:` label (a full page), the four-selector chain, and
   the base64/gunzip debugging command, plus disabling control-plane components on managed clusters
   as an explicit callback to ch19 and ch21.
7. **Only two of three native-histogram opt-ins** → all three stated in one canonical paragraph
   (§A.2), reused verbatim in ch10 and closed out in ch26 with `send_native_histograms`.
8. **Alert quality owned nowhere** → ch19 exists.

**From the incident-led candidate (grafted material, flaws corrected on the way in):**
9. **Timed 15-minute unaided failure in ch1** → compressed to a part-opener vignette with three named
   questions and the ch3 screenshot as a printed promise.
10. **ch21 carrying USE + four exporters + all of vector matching + a code review** → vector matching
    moved to ch11, multi-target probing given its own ch23, code review distributed across ch4/ch10/ch24.
11. **Seven multi-page post-mortems (~20 pages of fiction)** → one-paragraph part openers plus a
    closing before/after box; skippable without losing the thread.
12. **8 s latency described as pinning at a 10 s top bucket (arithmetically wrong)** → the lab injects
    **12 s**, above the top finite bucket, which is what actually produces the pin.
13. **`catalog`'s planted bugs dangling twenty chapters** → each bug is harvested in the chapter that
    teaches it (ch4, ch10, ch7/ch24).
14. **ch3 building panels in the UI while ch10 audits "the JSON the book seeded"** → the broken
    dashboard ships as a separate file, `snip-red-BROKEN.json`.
15. **A 24 h noise audit on a lab with no history** → `scenario-noise-history.sh` generates the
    history in four minutes, the window is `[6h]`, and the book says so out loud.
16. **`--config.auto-reload` never covered** → taught in ch12 as stable since 3.12.

**From the concept-first candidate (grafted material, flaws avoided):**
17. **A 5,000-word tool-free opening chapter** → not adopted; the hand-computed rate becomes a
    two-page opener to ch6, against a live graph.
18. **A five-chapter, ~39,500-word PromQL wall with no visual payoff for eleven chapters** → avoided
    by the lab-first interleave; PromQL is spread across ch6, 8, 9, 10, 11 with a dashboard or a
    moving panel in every one.
19. **Its own prerequisite rule violated three times** → replaced by the printed IOU device and the
    §F concept dependency graph, which the technical-review pass enforces mechanically.
20. **ch10 needing a service the outline introduced in ch12** → every service exists before the
    chapter that uses it (see §B.1).
21. **`redis_exporter` used with no Redis in the stack** → Valkey is present from ch1 and
    `redis-exporter` probes it in ch23.
22. **`file_sd` target added with no container, promised to appear UP** → the lab always starts the
    container; the container-less case is an *exercise* with the ladder rung named.
23. **Observing `repeat_interval` at its 4 h default inside a chapter** → the lab config lowers it to
    `2m` with a printed note saying why.

**Shared across all three:**
24. **cAdvisor's Docker Desktop caveats unflagged** → a printed box in ch22 naming the required `/sys`
    and `/var/lib/docker` mounts and the behavioural differences from Linux.
25. **30-day SLO windows computed over a TSDB that is days old, with no acknowledgement** → an honesty
    box in ch20 plus a `promtool tsdb create-blocks-from openmetrics` backfill option.
26. **Cardinality "fix" verified by watching head series fall after a block cycle** (a 2 h+ wait) →
    the lab verifies the *switch-off* effect within the session and states plainly that disk
    reclamation is slower.

## H.3 Word-count budget

| Section | Words |
|---|---|
| Front matter (F.1–F.6) | 3,500 |
| Part I (ch 1–3) | 16,500 |
| Part II (ch 4–7) | 25,500 |
| Part III (ch 8–11) | 26,500 |
| Part IV (ch 12–14) | 19,500 |
| Part V (ch 15–19) | 28,000 |
| Part VI (ch 20–21) | 14,500 |
| Part VII (ch 22–23) | 11,000 |
| Part VIII (ch 24–26) | 18,500 |
| Part IX (ch 27–29) | 17,500 |
| Appendices A–G | 17,600 |
| **Total** | **≈ 198,600** |

29 chapters, 9 parts, 7 appendices. Longest chapter: 8,000 words (ch10, ch21). No chapter exceeds
8,000 — the density ceiling the teachability lens asked for, and a hard constraint on drafting.
