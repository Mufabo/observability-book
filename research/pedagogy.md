# Pedagogy Research Dossier — How To Actually Teach Prometheus + Grafana

**Book:** *Observability with Prometheus and Grafana: A Hands-On Introduction*
**Researched:** 2026-07-27 · **Revised and re-verified:** 2026-07-28

> **Revision log — 2026-07-28 pass.** Everything below was re-checked against live primary sources.
> Changes worth knowing about before you read the rest:
> - **§1** — Grafana corrected **12.4.6 → 13.1.1**; Prometheus LTS question **resolved** (`3.5.5`);
>   registry-prefix guidance added (`_CONFLICTS.md` C2 closed, C3 addressed).
> - **§2.1** — part-level TOC of *Prometheus: Up & Running* 2nd ed. recovered; the structural point
>   (PromQL is Part IV of six) is now evidenced rather than asserted.
> - **§2.4** — six more PromLabs posts, including the 2026-03-05 one and the 2025-07-17 OTel post,
>   whose six friction points now anchor the book's OTel stance.
> - **§4.6** — the two *documented* `histogram_quantile` interpolation rules (lowest-bucket floor of 0;
>   clamp to the second-highest bound) added verbatim. These turn "it's broken" into a diagnosis.
> - **§4.7** — `$__rate_interval` formula, precedence chain and caveat re-verified against current
>   Grafana docs; previously flagged UNVERIFIED, now **resolved**.
> - **§4.10(d) — NEW and Tier A: rate-before-sum.** This was missing entirely. It is a distinct
>   failure from averaging ratios and it only misbehaves when something restarts.
> - **§4.19** — Alertmanager's four timing defaults, `continue`, `matchers:` vs legacy `match:`.
> - **§4.21 — NEW:** `for` / `keep_firing_for` / the queryable `ALERTS` series.
> - **§4.22 — NEW:** `promtool test rules` as the book's assessment engine, with the series-expansion
>   notation. Nothing else in the ecosystem gives gradeable exercises.
> - **§9.3** — "Graph" tab is now "Query"; the `old-ui` fallback flag.
> - **§9.5 — rewritten.** Grafana 13 dynamic dashboards are GA *and auto-migrate existing dashboards*.
>   This invalidates click-by-click dashboard instructions far more thoroughly than the old §9.5 said.
> - **§9.5b — NEW:** Grafana Metrics Drilldown, and why it is a ch. 2 aside rather than the early win.
> - **§8** — corrected: "dynamic dashboards" was wrongly listed as an Enterprise feature to exclude.
> - **§13** — UNVERIFIED list re-triaged with ✅/⚠️ status; Reddit is now known to be *unfetchable*
>   from this toolchain, and `discuss.prometheus.io` data substituted.
**Scope:** Not product features. This file is about *teaching* — what existing material does, where learners
demonstrably fall over, and what chapter structure survives contact with a real beginner.

**Reader model (from brief, restated because every recommendation below depends on it):**
a working software developer; writes code; can `docker compose up`; has **no** ops/SRE background;
**does not know what a time series is**; may never have been on call.

---

## 0. How to read this file

Three kinds of statements appear here:

- **VERIFIED** — fetched from a primary source today. URL in §14.
- **INFERRED** — my synthesis across several sources. Reasonable, but it's a judgement call.
- **UNVERIFIED** — I could not confirm it live today. Flagged inline. **Do not put these in the book as fact.**

Everything in §4 (the misconception ranking) is *ranked by my judgement* but each item carries
concrete evidence. The evidence is real; the ordering is editorial.

---

## 1. Version reality check (verified 2026-07-27, re-verified 2026-07-28)

This matters for pedagogy because **most tutorials the reader will Google are wrong now.**
A big part of this book's value is being right in 2026.

| Component | Version | Source note |
|---|---|---|
| Prometheus | **3.13.1** (2026-07-10) "Latest" | prometheus.io/download; GitHub `releases/latest` returns `v3.13.1`, release title "3.13.1 / 2026-07-10" |
| Prometheus LTS | **3.5.5** (2026-07-09) | marked **LTS** on prometheus.io/download — re-verified 2026-07-28 |
| Alertmanager | **0.33.1** (2026-07-04) | GitHub `releases/latest` = `v0.33.1`, published 2026-07-04T19:48:50Z |
| node_exporter | **1.12.1** (2026-07-14) | |
| Pushgateway | **1.11.3** (2026-05-27) | |
| blackbox_exporter | **0.28.0** (2025-12-04) | |
| Grafana OSS | **13.1.1** (2026-07-21) | GitHub `releases/latest` = `v13.1.1`, published 2026-07-21T10:58:35Z. **13.0.0 GA was April 2026** |

> **LTS question — RESOLVED 2026-07-28.** Re-fetched `https://prometheus.io/download/` directly:
> it lists **`3.13.1 / 2026-07-10` as Latest** and **`3.5.5 / 2026-07-09` as LTS**. The GitHub
> `releases/latest` body for v3.13.1 contains no LTS designation. Any claim that 3.13.0 is the LTS
> line (as `promql.md` §0 states) contradicts the download page and should be dropped.
> Conflict `_CONFLICTS.md` C2 can be closed in favour of: *latest* `3.13.1`, *LTS* `3.5.5`.

> **Grafana version — RESOLVED 2026-07-28.** An earlier revision of this file said `12.4.6`.
> That is wrong as the current release: `https://api.github.com/repos/grafana/grafana/releases/latest`
> returns `v13.1.1` (2026-07-21). 12.4.x is the last minor of the 12 line and still in patch support,
> which matters for readers on a corporate install — but the book is written against **13.1**.
> This matters far more than a version number usually would: see the rewritten §9.5.

**Pinning advice for the lab:** pin exact tags, never `:latest`. `:latest` is the single most common
reason a book's lab stack rots. Suggested (verify at press time):

```yaml
# compose.yaml — NOTE: no top-level `version:` key. See §10.2
services:
  prometheus:
    image: prom/prometheus:v3.13.1
  grafana:
    image: grafana/grafana:13.1.1
  node-exporter:
    image: prom/node-exporter:v1.12.1
  alertmanager:
    image: prom/alertmanager:v0.33.1
```

> **Registry consistency (see `_CONFLICTS.md` C3).** `prometheus.io/docs/prometheus/latest/installation/`
> states the images are published to **both** Quay.io and Docker Hub and its own examples use the
> Docker Hub short form `prom/prometheus`. A textbook must pick one prefix and never mix; the official
> docs' own choice (`prom/*`) is the least surprising for a reader who Googles anything.

---

## 2. Survey: what already exists, and what it actually teaches

### 2.1 *Prometheus: Up & Running*, 2nd ed. (Pivotto & Brazil, O'Reilly, 2023)

The reference work. ~21 chapters.

**What I could verify today:** authors, publisher, 2nd edition; Ch. 20 "Server-Side Security" (p. 351)
and Ch. 21 "Putting It All Together" (p. 357); coverage includes "What Is Monitoring?", running
Prometheus, the expression browser, Node Exporter, a "simple program" instrumentation chapter,
counters/gauges/summaries/histograms, client libraries in Python/Go/Java, the text exposition format,
labels, timestamps, OpenMetrics, Grafana dashboards, service discovery incl. HTTP SD, Kubernetes,
container exporters, and trigonometry functions.

**Partial TOC recovered 2026-07-28** (from O'Reilly search-index snippets; the pages themselves still
return HTTP 403 to automated fetches, and the dokumen.pub / shroffpublishers mirrors were down or 403):

| Part | Contents |
|---|---|
| **Part I — Introduction** | Ch. 1 *What Is Prometheus?* (sections: What Is Monitoring?, A Brief and Incomplete History of Monitoring, Categories of Monitoring, Prometheus Architecture, Client Libraries, Exporters, Service Discovery, Scraping, Storage, Dashboards, Recording Rules and Alerts, Alert Management, Long-Term Storage, What Prometheus Is Not); Ch. 2 *Getting Started with Prometheus* |
| **Part II — Application Monitoring** | instrumentation, metric types, client libraries (Python/Go/Java), exposition format, labels, OpenMetrics, dashboarding with Grafana |
| **Part III — Infrastructure Monitoring** | Ch. 7 *Node Exporter* (CPU, Filesystem, Diskstats, Netdev, Meminfo, Hwmon, Stat, Uname, OS, Loadavg, Pressure and **Textfile** collectors, plus Timestamps); Ch. 9 containers/Kubernetes; Ch. 10 common exporters |
| **Part IV — PromQL** | Ch. 13 PromQL basics + HTTP API; Ch. 14 aggregation; Ch. 15 operators and joins; Ch. 16 functions; Ch. 17 recording rules |
| **Part V — Alerting** | Ch. 18 *Alerting* (alerting rules, alert labels, annotations and templates, what makes a good alert, configuring Alertmanagers, external labels); Ch. 19 *Alertmanager* (notification pipeline, configuration file, routing tree, receivers, inhibitions, web interface) |
| **Part VI — Deployment** | Ch. 20 *Server-Side Security* (p. 351); Ch. 21 *Putting It All Together* (p. 357) |

> **Still UNVERIFIED:** the exact titles of chapters 3–6, 8, 11 and 12, and the page-level TOC.
> Everything above is reconstructed from indexed section headings, not from the printed TOC.

**Structural observation that matters more than the missing titles:** PromQL is **Part IV of six** —
i.e. the reader meets the query language *after* four parts on instrumentation, exposition formats
and infrastructure exporters. Grafana appears inside Part II as a single chapter. Our book inverts
both: a real query in ch. 2, a real dashboard in ch. 3.

**Pedagogical character (INFERRED from structure + reviews):** it is organised **by subsystem**
(instrumentation → exposition → service discovery → PromQL → dashboards → alerting → operations),
which is a *reference* ordering, not a *learning* ordering. It is authoritative and dense.

**Documented criticisms** (from a published review and reader feedback):
- "the book is not a fast read" — "every example makes you stop and think"
- **Grafana gets ~20 pages**, which the reviewer called "not nearly enough to get a deep
  understanding" of dashboard creation
- PromQL is "the toughest part of the book"
- one reader: "examples are very short, hello-world like and don't really cover any real world example"
- another reader uses it "like a reference"

**The gap this book should exploit:** *Up & Running* tells you what everything **is**. It does not
run a single artefact all the way through, and it under-serves Grafana by an order of magnitude
relative to how much time real users spend in Grafana. Our brief (one growing lab stack; dashboards
you'd actually use) is a direct, defensible answer to both.

### 2.2 Official Prometheus docs and tutorials

The tutorial series (prometheus.io/docs/tutorials/) is exactly five pages:

1. Getting started with Prometheus
2. Understanding metric types
3. Instrumenting HTTP server written in Go
4. Visualizing metrics using Grafana
5. Alerting based on metrics

**Assessment:** the *ordering* is good and close to what I recommend below. The problem is depth and
persistence — it's five short pages, Go-only, and each page is disposable rather than cumulative.
It never explains *why a query returns nothing*, which is the #1 beginner blocker (§4.1).

**What page 1 actually contains (fetched 2026-07-28), because our ch. 2 is competing with it:**
concepts → download the **binary** → write a config → run → download `node_exporter` → add it to the
config. The entire config it teaches is:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ["localhost:9090"]
  - job_name: node_exporter
    static_configs:
      - targets: ["localhost:9100"]
```

Run with `prometheus --config.file=prometheus.yml`.

**Three things to note.** (1) It is **binary-based, not Docker** — so the reader who Googles
"prometheus getting started" gets instructions that don't match our compose lab; say so once, in ch. 2,
so they aren't confused when they inevitably look it up. (2) Its very first scrape target is
**Prometheus scraping itself**, which is a genuinely good move we should keep: it guarantees data
exists before anything else works, and it makes `up` meaningful on line one. (3) Its second target is
`node_exporter` — **machine** metrics — which is precisely the wrong centre of gravity for our reader
(§2.7). We keep the self-scrape and replace node_exporter with the reader's own service.

**Page 2, "Understanding metric types" (fetched 2026-07-28)**, teaches Counter → Gauge → Histogram →
Summary using Prometheus's *own* internal metrics (`go_gc_duration_seconds_count`,
`go_memstats_heap_alloc_bytes`, `prometheus_http_request_duration_seconds_bucket{handler="/graph"}`)
with a cumulative-bucket table. **What it omits is instructive:** no guidance on how to *create* these
metrics in your own app, no summary examples at all, no discussion of the histogram/summary trade-off,
and no link from metric type to alerting. Our ch. 5 and ch. 9 exist precisely in that gap.
Note also that the handler label is `/graph` — a page that no longer exists under that name in
Prometheus 3 (§9.3). Even the official tutorial has version rot.

The genuinely excellent official pages, which most tutorials never link and most beginners never find:

- `/docs/practices/naming/` — metric/label naming, base units. **This is a hidden gem.** Precise,
  short, opinionated, and beginners violate it constantly.
- `/docs/practices/instrumentation/` — what to instrument; the three service archetypes.
- `/docs/practices/histograms/` — histogram vs summary; now leads with native histograms.
- `/docs/practices/rules/` — the `level:metric:operations` recording rule naming convention.
- `/docs/practices/alerting/` — symptoms not causes.
- `/docs/practices/pushing/` — "when to use the Pushgateway", i.e. mostly *don't*.

**Recommendation: the book should be, in part, a readable gloss on `/docs/practices/`.**
Those pages are correct and almost nobody reads them.

### 2.3 Official Grafana material

**`/docs/grafana/latest/fundamentals/intro-to-prometheus/`** — teaches Prometheus through three
progressive lenses: *as data format → as software → as deployment architecture*. Grounds time series
in "seasonal temperature charts and stock prices". Shows a real query before explaining syntax.
Covers counters/gauges/histograms and labels via a concrete selector
(`job="integrations/macos-node"`, `device!=""`).

**This "show the query first, explain second" move is worth stealing.** It's the opposite of how
*Up & Running* does it.

**`/tutorials/grafana-fundamentals/`** — a docker-compose tutorial with Grafana + Prometheus + Loki +
a "Grafana News" sample app. Progression: Explore/PromQL → add Loki → build panel + annotations →
alerting with contact points. It's the closest existing thing to our "one growing stack" pedagogy.

**Where it's a poor model for us:** it drags Loki in immediately, which doubles the concept load
before the reader can read a single graph. Our brief is right to stay metrics-only.

### 2.4 PromLabs (Julius Volz, Prometheus co-founder)

**The single best pedagogical source in the ecosystem.** Blog posts that are explicitly teaching
artefacts, not marketing:

| Post | Date | Why it matters |
|---|---|---|
| The Anatomy of a PromQL Query | 2020-06-18 | query structure and *types* |
| Selecting Data in PromQL | 2020-07-02 | selectors, lookback delta, offset, `@` |
| Metric Types in Prometheus and PromQL | 2020-09-25 | counters/gauges/histograms/summaries |
| How Exactly Does PromQL Calculate Rates? | 2021-01-29 | **the canonical rate() explainer** |
| Avoid These 6 Mistakes When Getting Started | 2022-12-11 | **the canonical beginner-mistake list** |
| Dealing with Missing Time Series | 2023-09-13 | the silent-alert failure mode |
| Errors, Successes, Totals: Which Metrics Should I Expose? | 2023-09-19 | metric *design*, the thing ch. 5 needs |
| Smaller is Better: Avoid Large, Multi-Target Exporters | 2024-08-17 | how to evaluate an exporter (ch. 17) |
| Number and Duration Literals Are Now Interchangeable in PromQL | 2024-08-19 | 2.54+ change; invalidates older syntax claims |
| A Look at the New Prometheus 3.0 UI | 2024-09-11 | tree view / Explain tab |
| Why I recommend native Prometheus instrumentation over OpenTelemetry | 2025-07-17 | the OTel question, answered by a Prometheus co-founder |
| **Filling in Missing Series in Binary Operator Matching** | **2026-03-05** | newest post; directly extends the §4.9 missing-series problem into binary operators |

**The 2025-07-17 OTel post is the single most useful source for deciding the book's stance on
OpenTelemetry.** Volz's six named friction points, verbatim in substance:

1. **You lose target health.** Pull + service discovery synthesises `up` per target; OTLP push has no
   equivalent, so "a target that should be reporting and isn't" becomes invisible.
2. **Naming.** OTel permits `.` and `-`; translation rewrites `my.metric.name` → `my_metric_name`, so
   what you query is not what you named. Prometheus 3's UTF-8 support makes the untranslated form
   *possible* but only through quoted selectors: `{"my.metric", "my.label"="value"}`.
3. **Resource attributes ≠ target labels.** OTel's verbose resource attributes are not automatically
   attached; you re-join them in PromQL with `group_left()` (or now `info()`, §9.4).
4. **Server config burden.** `--web.enable-otlp-receiver` must be turned on explicitly, plus an
   out-of-order window such as `out_of_order_time_window: 30m`.
5. **Performance.** He reports the Prometheus Go SDK "around 26x faster" worst case and "still around
   4.4x faster" best case for counter increments, with zero allocations where OTel allocates.
6. **Redundant standardisation** — the Prometheus text format is trivially implementable.

**Editorial consequence:** the book teaches native client libraries on the main line and treats OTLP
as a ch. 19 pointer. That is not nostalgia; it is the position of the project's co-founder, published
in 2025, and it is *also* the pedagogically simpler path (one fewer moving part, and `up` works).

PromLabs also runs `training.promlabs.com` with a "Monitoring and Debugging Prometheus" track
including TSDB status pages, and the public demo at `demo.promlabs.com`.

**Steal:** the *topic selection*. Volz's six mistakes are empirically what beginners get wrong.
**Don't steal:** the format. These are standalone posts; a book can sequence them.

### 2.5 Robust Perception (Brian Brazil)

The other deep well. Notably `/what-range-should-i-use-with-rate/` (the 4× rule, §4.7) and
`/staleness-and-promql/`. Also Brazil's PromCon 2017 "Staleness and Isolation in Prometheus 2.0"
slides, which remain the clearest explanation of staleness markers.

### 2.6 Google SRE Book / Workbook

**SRE Workbook Ch. 5, "Alerting on SLOs"** is the reference for alerts that don't cry wolf, and it is
*already pedagogically structured* — six iterations, each fixing the previous one's flaw:

1. Target error rate ≥ SLO threshold
2. Increased alert window
3. Incrementing alert duration (`for`)
4. Alert on burn rate
5. Multiple burn rate alerts
6. Multiwindow, multi-burn-rate alerts

**This iterative-refinement structure is the best teaching pattern in the whole observability
literature.** Use it verbatim as a chapter shape (§5, Ch. 15).

Recommended starting parameters (Table 5-8, 99.9% SLO):

| Severity | Long window | Short window | Burn rate | Error budget consumed |
|---|---|---|---|---|
| Page | 1 hour | 5 minutes | 14.4 | 2% |
| Page | 6 hours | 30 minutes | 6 | 5% |
| Ticket | 3 days | 6 hours | 1 | 10% |

```yaml
expr: (
    job:slo_errors_per_request:ratio_rate1h   > (14.4*0.001)
  and
    job:slo_errors_per_request:ratio_rate5m   > (14.4*0.001)
)
```

Also referenced by prometheus.io: Rob Ewaschuk's "My Philosophy on Alerting" — *"keep alerting simple,
alert on symptoms, have good consoles to allow pinpointing causes, and avoid having pages where there
is nothing to do."*

### 2.7 Community docker-compose stacks

- **`vegasbrianc/prometheus`** — Prometheus + Grafana + node scraper for Docker infra. >4,000 stars
  (as of mid-2023). Long-lived; some PRs in the repo are still fighting compose-file version syntax.
- **`stefanprodan/dockprom`** — Prometheus + Grafana + cAdvisor + NodeExporter + Alertmanager.

**Assessment:** these are *infrastructure* monitoring stacks. They monitor the host and the containers.
They teach the reader nothing about instrumenting **their own code**, which is our primary promise.

**Recommendation: do not model the lab on dockprom.** The lab's centre of gravity must be a small
service the reader owns and edits. node_exporter/cAdvisor are *supporting cast*, introduced later as
"metrics from things you didn't write."

### 2.8 The "Julia Evans-style" explainer — a real, exploitable gap

I searched for a Julia Evans Prometheus explainer and **did not find one.** Her closest relevant post
is "Monitoring tiny web services" (July 2022).

> **UNVERIFIED (negative):** absence of evidence isn't proof. But a targeted search surfaced only her
> blog index and unrelated posts.

**This is the biggest gap in the field.** Nobody has written Prometheus in the Evans register:
short, drawn, cheerfully admitting confusion, "here is the thing that confused me for six months."
The observability literature is overwhelmingly written by people who have forgotten what it's like
not to know. Recommended stylistic devices to import:

- Name the confusion **before** resolving it ("Everyone gets this wrong. Here's why it's confusing.")
- Show the **wrong** query and its wrong output first, then fix it
- "What I thought was happening / what was actually happening" pairs
- Debugging **flowcharts**, not prose
- Explicit permission to not know things

---

## 3. The structural gaps — what nothing currently does

1. **No source runs one artefact end to end.** Every tutorial is disposable. Our growing lab is the
   differentiator; it must be *genuinely* cumulative (ch. 12's dashboard queries the metric added in
   ch. 5 and alerts on the rule written in ch. 13).
2. **Nobody teaches the debugging loop.** "My graph is empty" has ~7 distinct root causes and no
   published decision procedure. §4.1 supplies one. **This may be the single most valuable page in
   the book.**
3. **Grafana is systematically under-taught** relative to time spent in it (20 pages in *Up & Running*).
   And nobody teaches *reading dashboards critically* — §4.15.
4. **PromQL is taught as syntax, not as a type system.** The instant-vector/range-vector distinction
   is the actual conceptual barrier and it's usually one paragraph.
5. **The 2021→2026 drift is enormous** (§9) and unaddressed by any book.
6. **Nobody teaches cardinality *before* the reader creates a cardinality bomb.** It's always in the
   "operations" chapter at the back, i.e. after the damage.
7. **Instrumentation design is taught as API mechanics** (`prometheus.NewCounter(...)`) rather than as
   "what should I measure, and what will I want to ask later."

---

## 4. Ranked beginner misconceptions, with evidence

Ranking heuristic: **frequency × damage × how badly existing material handles it.**

### Tier S — these determine whether the reader succeeds at all

---

#### 4.1 — #1: "My graph is empty / No data" (a *cluster*, not one bug)

**Why it's #1:** it is the first wall every beginner hits, it has many unrelated causes, and the error
message is identical for all of them. Failure here causes abandonment.

**Evidence:** Grafana community threads ("Grafana Dashboard displaying empty graphs, not data coming";
"1/1 resolution, 15s scrape_interval, and empty graphs when time range is 3h or less"), the Microsoft
Learn Q&A "how to fix grafana dashboard showing no data for prometheus", Google Cloud Managed
Prometheus troubleshooting docs splitting causes into query-side vs ingestion-side.

**The distinct root causes a beginner cannot tell apart:**

| # | Cause | Tell |
|---|---|---|
| 1 | Target isn't up | `up{job="..."} == 0`, or target absent from `/targets` |
| 2 | Metric name typo / metric doesn't exist yet | Metrics explorer shows nothing |
| 3 | Label matcher matches nothing | Strip labels one at a time until data appears |
| 4 | The series exists but **hasn't been created yet** (label dimension not yet observed) | §4.9 |
| 5 | Time range is before the data existed, or after it went stale | Zoom out |
| 6 | **Range too short for `rate()`** — <2 samples in window | §4.7. Classic on zoom-in |
| 7 | Grafana step/`Min step`/Resolution interacting badly | §4.7, §4.15 |
| 8 | Prometheus 3 strict `Content-Type` on scrape → scrape fails silently to the beginner | §9 |

**Teaching recommendation:** a **named, reusable debugging ladder**, introduced in the early-win
chapter and *referenced by number* for the rest of the book. Something like:

```
1. Does the target exist?        →  http://localhost:9090/targets
2. Is it up?                     →  up
3. Does the metric name exist?   →  Metrics explorer, or {__name__=~".+"}
4. Does the bare metric return?  →  my_metric_total          (no labels, no functions)
5. Add labels back one at a time →  my_metric_total{job="x"}
6. Add the function last         →  rate(my_metric_total{job="x"}[5m])
7. Widen the range               →  [5m] → [15m]
8. Widen the time picker
```

The rule to drill: **peel the query back to a bare selector, then rebuild it.** Beginners instead
retype the whole thing and change three things at once.

---

#### 4.2 — #2: `rate()` vs `increase()` vs `irate()`, and "why isn't it a whole number?"

**Evidence:** enormous. Dedicated posts from SigNoz, PromLabs, Better Stack, Last9, DoiT, OneUptime;
prometheus-users threads "looks like rate/irate/delta/increase are not calculating consistent" and
"Forever increasing irate / rate"; it's mistake #5 and #6 in Volz's list.

**The four separate confusions, which are usually conflated:**

**(a) Units.** `rate()` is per-second average. `increase()` is total over the window.
Exactly: `increase(foo[5m]) / (5*60)` ≡ `rate(foo[5m])`.

**(b) Extrapolation — the non-integer results.** *This is the one that makes people distrust
Prometheus.* From the canonical PromLabs explainer:

> `rate()` "calculates the rate of increase per second, averaged over the entire provided time
> window." It requires at least two samples. It **extrapolates the slope between the first and last
> samples under the window to the window boundaries**, which is why `increase()` returns values like
> `2.5883` for a counter that only ever increments by whole numbers.

Boundary refinement: if the first/last sample is more than **1.1×** the average interval from the
window boundary, the series is assumed to start/end inside the window and extrapolation extends only
**half an average sample interval** toward the boundary, not all the way. Extrapolation also stops
before going negative.

**Teaching move:** show a counter that goes 0,1,2,3 and `increase(...[1m])` returning `3.75`, and say
*"this is not a bug and here is exactly why."* Then say: **`increase()` is an estimate. If you need an
exact count, you are asking the wrong system.** That sentence prevents months of grief.

**(c) Counter resets.** When a sample is lower than the previous one, it's treated as a reset to zero
and the new value is added to the pre-reset total. **Increments between the last scrape and the reset
are permanently lost.** Beginners see the sawtooth in the raw counter after a deploy and think their
data is broken.

**(d) `irate()`.** Uses only the last two samples. Beginners reach for it because it "looks more
responsive," then get spiky, aliased graphs and alerts. **Recommendation: teach `irate()` as a
footnote and actively discourage it.** It belongs in a sidebar, not the main line.

---

#### 4.3 — #3: Counter vs gauge — and never `rate()` a gauge

**Evidence:** Volz mistake #6. prometheus.io/docs/practices/instrumentation: *"Never apply `rate()`
to gauges."* Community explanation of the failure: PromQL **cannot detect the mistake** — every time
the gauge goes down, `rate()` reads it as a counter reset and silently "corrects" it, producing
plausible-looking garbage.

**Why it's Tier S:** it fails *silently and plausibly*. There is no error. The graph looks fine.

**Teaching move:** build the intuition as **"a counter is a mileage odometer; a gauge is a
speedometer."** Then: *you never plot the odometer, you plot how fast it's turning.* This single
analogy resolves both 4.2 and 4.3.

Also teach the inverse mistake: `deriv()` is for gauges only.

---

#### 4.4 — #4: Instant vector vs range vector (PromQL's actual type system)

**Evidence:** it's the mechanical cause of the two most common PromQL error messages, and it's what
makes `rate(x)` (invalid) vs `rate(x[5m])` (valid) feel arbitrary.

Verbatim definitions:
- **Instant vector** — "a set of time series containing a single sample for each time series, all
  sharing the same timestamp"
- **Range vector** — "a set of time series containing a range of data points over time for each
  time series"

**Teaching move:** teach PromQL as a **typed** language from the first query. Draw it:

```
http_requests_total              → instant vector   (one dot per series)
http_requests_total[5m]          → range vector     (a little strip of dots per series)
rate(  <range vector>  )         → instant vector
sum(   <instant vector> )        → instant vector
sum(   <range vector>  )         → TYPE ERROR
```

Explicitly state the rule beginners need: **functions ending in `_over_time`, plus
`rate`/`irate`/`increase`/`delta`/`deriv`/`resets`/`changes`, take range vectors. Almost everything
else takes instant vectors. Aggregations (`sum`, `avg`, `max`, `topk`) take instant vectors.**

**Big win available:** the **Prometheus 3 UI tree view** (`/query`) renders any query as a tree of
sub-expressions showing how many series each node evaluates to. This makes the type system *visible*.
**No existing book uses it.** See §9.

---

#### 4.5 — #5: Cardinality — the bomb they'll build in week two

**Evidence:** Volz mistake #1 ("Cardinality bombs"). prometheus.io/docs/practices/naming: *"Do not use
labels to store dimensions with high cardinality (many different label values), such as user IDs,
email addresses, or other unbounded sets of values."* Instrumentation practices: keep to ~10 labels;
*"The vast majority of your metrics should have no labels"*; investigate alternatives above 100.
Widely-reported field anecdote: a `user_id` label on a request counter producing >5M series over 90
days and a million users.

**Verbatim, the mechanism:** *"Every **unique combination** of labels on a metric automatically
creates one time series that Prometheus will have to ingest, index, store, and process."*

**Why current material fails:** cardinality lives in the back-of-book operations chapter. By then the
reader has already written `http_requests_total{path="/api/users/8134/posts/992"}`.

**Recommendation: introduce cardinality in the *instrumentation* chapter, the moment the first label
is added.** Not as a warning box — as a **budget calculation the reader performs**:

> `method` (5) × `status` (6) × `endpoint` (20) × `instance` (3) = **1,800 series for one metric.**
> Now add `user_id`.

Give them the heuristic verbatim: *"Could this label have 10,000 unique values in production?
If yes, it belongs in a trace or a log, not a metric label."*

And give them the tools **immediately**, not in chapter 16:

```promql
topk(10, count by (__name__) ({__name__=~".+"}))
count by (job) ({__name__=~".+"})
```

```bash
curl -s localhost:9090/api/v1/status/tsdb | jq '.data.seriesCountByMetricName[:10]'
```
Also: `http://localhost:9090/api/v1/status/tsdb?limit=50`, the `/tsdb-status` web page, and the
`prometheus_tsdb_head_series` metric for tracking over time.

The `path` fix, verbatim from Volz: replace IDs with placeholders —
`/api/users/{user_id}/posts/{post_id}`.

---

#### 4.6 — #6: `histogram_quantile` and the `le` label

**Evidence:** prometheus/prometheus issues #6611 ("How can I avoid histogram_quantile return NaN"),
#6645, #13020, #13221; grafana/grafana #76830; VictoriaMetrics #3231. A whole blog post exists titled
"Eliminating NaNs in PromQL Histogram Quantile."

**The four failure modes:**

1. **Aggregating away `le`.** `sum by (service) (...)` instead of `sum by (service, le) (...)`.
   Docs: samples "must have a label `le` denoting the inclusive upper bound of the bucket, and
   samples without such a label are **silently ignored**." Silently. Hence NaN.
2. **NaN from zero observations** — no data in the window, division by zero.
3. **Results pinned to the top bucket bound.** Issue #13020: q0.9999 returning `60` (the `+Inf`-adjacent
   top bucket bound) instead of ~22ms. **The lesson: your quantile can never be more precise than your
   bucket boundaries, and above the largest finite bucket it is not an estimate at all.**
4. **Inconsistent bucket sets** across series produce nonsense.

**The two interpolation rules the docs state and no tutorial repeats** (verbatim from
`/docs/prometheus/latest/querying/functions/`, re-fetched 2026-07-28):

- *"The lower limit of the lowest bucket is assumed to be 0 if the upper bound of that bucket is
  greater than 0."* → below your smallest `le`, the function pretends the floor is zero and
  interpolates linearly from there. Every p50 of a fast endpoint is therefore an artefact of your
  smallest bucket.
- *"If a quantile is located in the highest bucket, the upper bound of the second highest bucket is
  returned."* → the answer is **clamped to your second-largest finite bound**, which is exactly the
  #13020 symptom, and it is *documented behaviour*, not a bug.

**Teach these two sentences as a boxed rule.** They convert "histogram_quantile is broken" into
"histogram_quantile is telling me my buckets are wrong", which is the actual diagnosis and the actual
fix (add buckets around your SLO threshold).

Also verbatim, and the reason NaN is so common: for classic histograms *"each float sample must have a
label `le` where the label value denotes the inclusive upper bound of the bucket."* No `le`, no result.

**The correct canonical forms, verbatim from docs:**

```promql
# classic histogram
histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))

# native histogram
histogram_quantile(0.95, sum(rate(http_request_duration_seconds[5m])))
```

**Also teach, because it's the more common real mistake:** *averaging quantiles is meaningless.*
Docs: aggregating precomputed quantiles from a summary "rarely makes sense" and produces
"statistically nonsensical values." Beginners do `avg(http_request_duration_seconds{quantile="0.95"})`
across instances constantly.

**Teaching order matters here.** Do **not** open with `histogram_quantile`. Open with the honest
questions histograms answer well:

```promql
# what fraction of requests were under 300ms?  (an SLI, and it's exact-ish)
sum(rate(http_request_duration_seconds_bucket{le="0.3"}[5m]))
  /
sum(rate(http_request_duration_seconds_count[5m]))

# the mean
rate(http_request_duration_seconds_sum[5m]) / rate(http_request_duration_seconds_count[5m])
```

*Then* introduce quantiles as an interpolated estimate. This ordering — **ratios before
quantiles** — is not how any existing book does it, and it's better, because the ratio form is both
easier and more useful for SLOs (§5 Ch. 15).

---

### Tier A — these separate "it works" from "it's correct"

---

#### 4.7 — #7: Scrape interval vs range vector vs Grafana step

**Evidence:** Robust Perception "What range should I use with rate()?"; Volz mistake #5; the entire
existence of `$__rate_interval`; Grafana community thread "1/1 resolution, 15s scrape_interval, and
empty graphs when time range is 3h or less."

**The rule, verbatim:** *"the range should be at least 4x the scrape interval."*

**Why 4×:**
1. `rate()` needs at least two samples.
2. Recent scrapes may not be ingested yet at query time.
3. Resilience to **one failed scrape** — the worked example: with a 10s interval and a failed scrape
   at t=20, a query at t=39 with ~4× range still retrieves the t=0 and t=10 samples.

For 10s scrape → ~40s minimum, "typically rounded up to 60s for a 1m rate."

**Organisational advice worth quoting:** create **one** set of recording rules at a low range rather
than many; use `avg_over_time` for longer smoothing. *"a 5m rate and a 10m rate aren't directly
comparable."*

**The Grafana half.** `$__rate_interval` exists because `$__interval` shrinks as you zoom in, drops
below 4× scrape interval, and the panel goes blank. Formula (Grafana blog, corroborated by current
Prometheus template-variables docs):

> `$__rate_interval` = **max( `$__interval` + Scrape interval, 4 × Scrape interval )**

Current docs phrasing: it "guarantees a range window large enough to capture at least four scrape
samples" and "is in general one scrape interval larger than `$__interval` but is never smaller than
four times the scrape interval."

Second, subtler reason it exists: with perfectly aligned `$__interval` ranges, **counter increases at
range boundaries get skipped**, visibly dropping points on slow-moving counters.

**Hard rule for the book: in Grafana, `rate()` always gets `[$__rate_interval]`. Never `[$__interval]`.
Never a hardcoded `[5m]` in a dashboard panel.** State it that bluntly, early, and repeat it.

Settings to explain once, properly: the datasource **Scrape interval** field (default `15s`) —
`$__rate_interval` is computed from *this*, so if it doesn't match reality the macro is wrong —
plus **Min step** ("Sets the minimum interval between data points returned by the query"; supports
`$__interval` and `$__rate_interval`) and **Resolution** (1/1, 1/2, 1/10 …).

**Formula and precedence — re-verified 2026-07-28 against the current Grafana docs**
(`/docs/grafana/latest/datasources/prometheus/template-variables/`). This closes the earlier
UNVERIFIED item about the literal wording:

```
$__rate_interval = max( $__interval + scrape_interval , 4 * scrape_interval )
```

The docs define the surrounding variables as:

- `$__interval` — *"Calculated interval based on time range and panel width."*
- `$__interval_ms` — *"Same as `$__interval` in milliseconds."*
- `$__range` — *"Duration of the current dashboard time range (for example, `1h`)."* (plus
  `$__range_s`, `$__range_ms`)
- `$__rate_interval` — *"a Grafana-specific variable designed for use with `rate()` and `increase()`."*

And — this is the part that actually bites — the `scrape_interval` term is resolved by a **precedence
chain**, not by asking Prometheus:

1. the per-query **Min step**, if set;
2. otherwise the **data source's "Scrape interval"** setting (Interval behavior section);
3. *"The panel-level `min interval` is affected by the resolution setting and doesn't factor into this
   calculation."*

Docs note, verbatim in substance: **the scrape interval configured on the data source must match your
actual Prometheus scrape configuration.** Nothing validates this. A lab that ships `scrape_interval: 15s`
in `prometheus.yml` and leaves the Grafana data source at some other value produces dashboards that are
quietly wrong — see §10.3, where the provisioned data source must set it explicitly.

**Two consequences worth stating in the book as surprises, not footnotes:**

- **The same query gives different answers in the panel editor and on the dashboard.** In edit mode the
  panel is full width, so `$__interval` is small; back on the dashboard the panel is narrow,
  `$__interval` grows, and so does `$__rate_interval`. A reader who "fixed" a gappy panel in the editor
  will find it gappy again on the dashboard.
- **`$__rate_interval` moves when you resize a panel.** This is correct behaviour and it still feels
  like the tool is lying. Say so.

---

#### 4.8 — #8: Staleness, the 5-minute lookback, and disappearing/persisting data

**Evidence:** prometheus-users "Why don't I see gaps in instance vectors if Prometheus itself is down
by < 5 Mins" and "Facing 5m staleness issue even with 2.x"; Robust Perception "Staleness and PromQL";
Brazil's PromCon 2017 staleness talk.

**Mechanism:** the value at time T is the most recent sample at or before T, looking back at most
`--query.lookback-delta` (**default 5m**). Staleness markers (a special NaN) are written when a series
present in a previous scrape vanishes from the exposition.

**The two symmetric surprises:**
- **Data that shouldn't be there.** Prometheus down <5 min → **no gap**; the graph flat-lines the last
  known value. Beginners read this as "the service was fine."
- **Data that vanishes.** Sparser than 5m → gaps on instant queries.

**And the nastiest one, which no book covers:** *"A spike that's visible on a 1-day view can vanish on
a 7-day view."* Wider ranges → wider steps → each evaluation's 5m lookback covers a smaller fraction of
the timeline. **This is a dashboard that lies.** Ties directly to §4.15.

---

#### 4.9 — #9: Missing series = "everything is fine" (the silent alert failure)

**Evidence:** PromLabs "Dealing with Missing Time Series in Prometheus."

**Two causes:** (a) a labelled series *doesn't exist yet* because that label value hasn't occurred —
"the series for each operation type will only start existing once the first operation of that
particular type has occurred"; (b) targets unavailable.

**The killer, verbatim:** *"Prometheus interprets an empty alerting rule expression output as
'everything is fine'."*

So an alert like `rate(successful_operations_total[5m]) < 1` **never fires when the service is
completely dead**, because the series is gone. This is the failure mode that convinces people
monitoring doesn't work.

**Fixes to teach:**
```promql
# initialise from the always-present `up` series
sum by(job, instance) (rate(http_requests_total{job="my-job",status="503"}[5m]))
  or up{job="my-job"} * 0
```
Plus: pre-initialise known label values to 0 at process start. Docs (instrumentation practices):
*"Export a default value such as `0` for any time series you know may exist in advance."*

> Note: the PromLabs post covers `or up * 0` and pre-initialisation. `absent()` / `absent_over_time()`
> are the other standard tool but were **not** in that post — cite the functions doc for those.

---

#### 4.10 — #10: Aggregation — `by` vs `without`, and averaging things you must not average

**Evidence:** Volz mistakes #2 and #3; prometheus.io/docs/practices/rules.

**(a) Aggregating away labels you need for routing.** Volz:
```promql
# bad — loses `job`, so the alert can't be routed
sum(rate(errors_total{job="my-job"}[5m])) > 10
# better
sum by(job) (rate(errors_total{job="my-job"}[5m])) > 10
# best — drop only what you mean to drop
sum without(instance, type) (rate(errors_total{job="my-job"}[5m])) > 10
```
Rules doc: *"Always specify a `without` clause with the labels you are aggregating away."*

**Teach `without` as the default, `by` as the exception.** Every existing tutorial does the reverse,
and that's why beginners' alerts arrive with no labels.

**(b) "Naked" selectors.** Volz mistake #3: `rate(errors_total[5m]) > 10` silently picks up
`errors_total` from every other service in the org. Always scope with `{job="..."}`.

**(c) Averaging averages / averaging ratios.** Rules doc: *"When aggregating up ratios, aggregate up
the numerator and denominator separately and then divide."* And: do not average a ratio or average an
average — it "lacks statistical validity."

```promql
# WRONG
avg(rate(errors_total[5m]) / rate(requests_total[5m]))
# RIGHT
sum(rate(errors_total[5m])) / sum(rate(requests_total[5m]))
```

This is arguably the most common *silently wrong* dashboard in the world. It deserves a full worked
example with numbers proving the two disagree.

**(d) Rate before sum — never sum before rate.** *(Added 2026-07-28; this was missing and it is
Tier A.)* Distinct from (c): (c) is about statistics, this is about **counter resets**, and it fails
only when something restarts — i.e. it looks fine in the lab and lies in production.

Verbatim from `/docs/prometheus/latest/querying/functions/`:

> *"always take a `rate()` first, then aggregate. Otherwise `rate()` cannot detect counter resets when
> your target restarts."*

And Robust Perception's expansion of the mechanism:

> *"the real problem is what happens when one of the servers restarts. The counters from the restarted
> server will reset to 0, the sum will decrease, which will then be treated by `rate` as a counter
> reset and you'd get a large spurious spike in the result."*

```promql
# RIGHT
sum by (job) (rate(http_requests_total{job="node"}[5m]))
rate(counter_a[5m]) + rate(counter_b[5m])

# WRONG
rate(sum by (job) (http_requests_total{job="node"})[5m])
rate(counter_a[5m] + counter_b[5m])
```

**The rule of thumb to print in a box** (Robust Perception, verbatim):

> *"The only mathematical operations you can safely directly apply to a counter's values are `rate`,
> `irate`, `increase`, and `resets`. Anything else will cause you problems."*

**Teaching move that makes this stick:** the lab must be able to *restart one replica on demand*
(§10.1 adds a second replica in ch. 11). Run `sum(...)` then `rate(...)` across two replicas, restart
one, and watch the spurious spike appear on one panel and not the other. This is a five-minute demo
that no book contains, and it converts a memorised rule into an observed fact.

Note also `resets(v range-vector)` — *"Any decrease in the value between two consecutive float samples
is interpreted as a counter reset"* — which is the ideal instrument for showing the reader that resets
are real and countable, not folklore.

---

#### 4.11 — #11: "Why pull instead of push?" and Pushgateway abuse

**Evidence:** it's a standing FAQ entry; Pushgateway misuse has its own official "when to use" page,
which is mostly a list of reasons not to.

**FAQ, verbatim:** *"Pulling over HTTP offers a number of advantages: You can start extra monitoring
instances as needed, e.g. on your laptop when developing changes. You can more easily and reliably
tell if a target is down. You can manually go to a target and inspect its health with a web browser."*
The FAQ then honestly notes this isn't a decisive factor overall — **quote that too; it builds trust.**

**The `up` metric is the punchline of pull** and should be taught as such: *because Prometheus does the
connecting, it always knows whether it worked.* `up` is free liveness monitoring you get from the
architecture. Teach `up` in the very first hands-on chapter — it's the simplest possible real query
and it makes pull concrete.

**Pushgateway, verbatim caveats:**
1. It becomes "both a single point of failure and a potential bottleneck."
2. You lose the automatic `up` health check.
3. *"The Pushgateway never forgets series pushed to it and will expose them to Prometheus forever
   unless those series are manually deleted via the Pushgateway's API."*

And the key sentence: **"The Pushgateway is not capable of turning Prometheus into a push-based
monitoring system."** Only valid use: **service-level** batch jobs not tied to a machine. For
machine-tied batch jobs use the **node_exporter textfile collector**. For firewall/NAT, use
**PushProx** or a Prometheus inside the network.

**Recommendation: Pushgateway is a SIDEBAR, not a chapter,** and its content is 80% "don't."

---

#### 4.12 — #12: Alerts that cry wolf

**Evidence:** Volz mistake #4 (no `for` duration); prometheus.io/docs/practices/alerting; SRE Workbook Ch. 5.

**Beginner-level:**
```yaml
alert: InstanceDown
expr: up == 0
for: 5m
```
Without `for`, one bad scrape pages you.

**Principles, verbatim:** alert on **symptoms** that cause user pain, not causes. *"only page on
downstream component slowness if it impacts overall user latency."* *"allow for slack in alerting to
accommodate small blips."* Page vs ticket. Minimise volume. Metamonitoring (who watches Prometheus).

**Advanced:** burn rates (§2.6). But see §5 — this must come *after* the reader has an SLI, and an SLI
comes out of the histogram chapter.

---

### Tier B — real, but sidebars or later chapters

#### 4.13 — Relabeling is impenetrable

**Evidence:** it's the topic with the most competing "finally explained" blog posts (Grafana Labs,
Better Stack, OneUptime ×3, Valyala, HeyOnCall, Ruan Bekker) — a reliable signal that the docs fail.

**Why it's hard (INFERRED):** four things at once — an invisible pre-scrape label set (`__meta_*`,
`__address__`), string concatenation with a separator, RE2 regex with capture groups, and an `action`
verb that changes what the other fields even mean.

**The facts that unlock it:**
- Defaults: `separator: ";"`, `regex: "(.*)"`, `replacement: "$1"`, `action: replace`
- `source_labels` **reads**; `target_label` **writes**; values are concatenated by `separator` before
  the regex sees them
- Three pipeline positions: **`relabel_configs`** (pre-scrape, shapes *targets*),
  **`metric_relabel_configs`** (post-scrape, shapes *stored series*),
  **`write_relabel_configs`** (pre-remote-write). *"confusing these is a common source of bugs."*
- The `__`-prefixed labels are temporary and dropped after relabeling

Special labels worth listing verbatim:
```
__name__              # metric name
__address__           # host:port of target
__scheme__            # http/https
__metrics_path__      # endpoint path
__param_<name>        # URL parameter
__scrape_interval__   # (experimental)
__scrape_timeout__    # (experimental)
__meta_*              # from service discovery
__tmp_*               # scratch space, never persisted
```

Worked example showing concatenation, which is the "aha":
```yaml
- source_labels: [subsystem, server]
  separator: "@"
  regex: "kata@(.*)"
  replacement: "env_${1}"
  target_label: "environment"
# {subsystem="kata", server="webserver01"} → "kata@webserver01" → environment="env_webserver01"
```

**Teaching recommendation:** teach relabeling **only in service of a concrete need the reader already
has** (e.g. "drop this high-cardinality metric that's eating your laptop" via `metric_relabel_configs`
+ `drop`). Teach exactly three actions in the main line — `replace`, `keep`, `drop` — and table the
rest (`labelmap`, `labeldrop`, `labelkeep`, `hashmod`, `keepequal`, `dropequal`). `hashmod` sharding
is out of scope for this book entirely.

#### 4.14 — Vector matching / `group_left` / "found duplicate series for the match group"

**Evidence:** prometheus-users threads "matching labels must be unique on one side", "Promql JOIN
many-to-many matching" (×2), "Aggregation Metrics - Found duplicate series for the match group";
prometheus/prometheus #8247; prometheus-community/helm-charts #2038; a dedicated iximiuz cheat sheet;
Chris Siebenmann's notes on `group_left`/`group_right`.

**Rule:** for each element on the "many" side there must be **at most one** match on the "one" side.
Many-to-many is forbidden. Getting the side wrong flips the error message between "left hand-side"
and "right hand-side".

**Recommendation:** later chapter, and mostly in service of one genuinely useful pattern — joining a
`*_info` metric to attach metadata labels. Do not attempt completeness.

#### 4.15 — Dashboards that look right but are wrong

**The most under-taught topic in the field.** No existing book has this chapter. Contents:

- Averaging averages and averaging ratios (§4.10c)
- The 5m-lookback flat-line masquerading as uptime (§4.8)
- **Spikes vanishing as you zoom out** (§4.8) — and the `max_over_time($__interval)` mitigation
- `$__interval` vs `$__rate_interval` (§4.7)
- Panel legends showing "Last" or "Mean" when the reader thinks they show "now"
- Y-axis starting at non-zero
- Unit mismatches: Prometheus base unit is **seconds** and **ratio (0–1)**; Grafana panel unit says
  "percent (0–100)" → silently 100× wrong. Naming doc: *Percent → ratio 0–1, not 0–100.*
- Stacked graphs of rates from different-cardinality label sets
- Dashboards with no `job` scoping picking up a second environment
- **`sum()` before `rate()`** — the spurious restart spike (§4.10d)

**Added 2026-07-28 — Grafana's own docs supply four of these for free.** From
`/docs/grafana/latest/dashboards/build-dashboards/best-practices/`:

- *"A dashboard should tell a story or answer a question."* Use this as the chapter's opening test:
  *what question does this panel answer?* Panels that answer no question are the ones that lie
  unnoticed, because nobody looks at them.
- *"Avoid stacking graph data, as it can be misleading"* — official, quotable, and beginners stack by
  reflex because it looks tidy.
- Use **separate Y-axes** for series with different units or ranges.
- *"if your data changes every hour, then you don't need to set the dashboard refresh rate to 30
  seconds"* — a refresh rate faster than the scrape interval teaches the reader to distrust a graph
  that is simply redrawing identical data.
- The docs also name **USE, RED and the Four Golden Signals** as the sanctioned strategies. Since the
  book already runs on RED (§5 ch. 1), cite this: it means the book's spine is the vendor's own advice,
  not an invention.

**Added 2026-07-28 — the Grafana query editor's own options are a source of silent wrongness.**
Teach these five once, in ch. 12, verbatim from
`/docs/grafana/latest/datasources/prometheus/query-editor/`:

| Option | Values | Why it silently misleads |
|---|---|---|
| **Legend** | *Auto* ("Displays unique labels only, hiding labels that are common across all returned series"), *Verbose* ("Displays all label names for every series"), *Custom* (`{{hostname}}`) | *Auto* hides a label that later becomes non-constant; the legend's meaning changes as data changes |
| **Min step** | duration; supports `$__interval`, `$__rate_interval` | Feeds `$__rate_interval` (§4.7) and *"The time range of the query is aligned to the step size, which may adjust the actual start and end times of the returned data."* |
| **Format** | Time series / Table / Heatmap | Wrong format = plausible-looking but meaningless panel |
| **Type** | *Range* ("a set of time series where each series includes multiple data points"), *Instant* ("a single data point per series (the most recent value)"), *Both* ("Runs both a Range query and an Instant query and returns combined results") | **Instant + a stat panel is where "the number is stale but looks live" comes from** — it is the most recent value *subject to the 5m lookback* (§4.8) |
| **Exemplars** | toggle | *"Not available with Instant queries"* — reader toggles it, nothing happens, concludes it's broken |

**Added 2026-07-28 — two query-engine quirks that make correct dashboards disagree with themselves**
(Chronosphere, "Understanding PromQL and its quirks"):

1. **Series vanish when you widen the time range.** A wider range means a wider step; with sparse
   series or short-lived series followed by staleness markers, the engine finds no sample within
   lookback at the evaluated timestamps and the series disappears entirely. The mitigation is the same
   one the book teaches elsewhere: *use an explicit range-vector window* (`rate(metric[5m])`,
   `max_over_time(metric[5m])`) rather than relying on instant selection.
2. **Peaks disappear when you zoom out**, because a larger step steps *over* the timestamp where the
   spike lived and lookback then returns a later, lower sample. `max_over_time(http_errors[5m])`
   recovers them. **This one is worth a before/after screenshot pair** — it is the clearest possible
   demonstration that a graph is a *sampling of a query*, not a picture of reality.

**This should be a full chapter and it is the book's most defensible original contribution.**

#### 4.16 — Timezone and time-range confusion in Grafana

**Evidence:** grafana/grafana #15284, #22289, #51525, #53288; multiple community threads
("Grafana shows wrong data or timezone", "Weird timezone problems", "Local Browser Time Issue").

Practical items: default is **browser time**; the dashboard timezone setting; absolute ranges being
reinterpreted in local time; a panel's relative-time override not affecting `$__range`; and the
cross-team problem of screenshots with no timezone. **Sidebar**, plus one rule: *set the dashboard
timezone explicitly to UTC for anything shared across a team.*

#### 4.17 — Naming, units, and `_total`

**Evidence:** prometheus.io/docs/practices/naming — precise and widely ignored.

Verbatim rules worth reproducing:
- names "SHOULD have a suffix describing the unit, in plural form"
- accumulating counts use `total`: `http_requests_total`, `process_cpu_seconds_total`
- "SHOULD have a (single-word) application prefix relevant to the domain"
- "MUST refer to a single unit … and to a single quantity"
- "SHOULD use base units (e.g. seconds, bytes, meters — not milliseconds, megabytes, kilometers)"
- either `sum()` or `avg()` over all label dimensions "should be meaningful"
- "Do not put the label names in the metric name, as this introduces redundancy"

Base units: seconds, celsius, meters, bytes (also for bits), **ratio (0–1, not 0–100)**, volts,
amperes, joules, grams.

**Teach this in the instrumentation chapter as a checklist, not an appendix.** The `sum()`-or-`avg()`
test is a genuinely good design tool and nobody teaches it.

#### 4.18 — Recording rules

`level:metric:operations`. Metric name largely unchanged except dropping `_total` when `rate()`d.
Operations newest-first. Aggregate numerator and denominator separately, then divide.

Short chapter, and it should exist mainly to set up SLO alerting (§5 Ch. 15), where
`job:slo_errors_per_request:ratio_rate5m` suddenly makes sense.

#### 4.19 — Alertmanager's route tree, grouping, inhibition, silences

Conceptually separate from alert *rules* and beginners merge them. One clean sentence:
**Prometheus decides *whether* something is wrong; Alertmanager decides *who hears about it and how
often*.** Grouping is the anti-fatigue feature and deserves a worked example (one bad deploy → 40
firing alerts → 1 notification).

**The four timing knobs, with their real defaults** (verified 2026-07-28 against
`/docs/alerting/latest/configuration/`). Beginners tune these blind because no tutorial prints the
defaults next to each other, and the *interaction* is what confuses:

| Key | Default | Docs description |
|---|---|---|
| `group_by` | `['alertname']` | "Labels by which incoming alerts are grouped together" |
| `group_wait` | `30s` | "Wait before sending first notification for new group" |
| `group_interval` | `5m` | "Wait before sending subsequent notifications after `group_wait`" |
| `repeat_interval` | `4h` | "Wait before repeating last notification" |

Teaching order that works: `group_by` (what counts as "the same incident") → `group_wait` (let the
storm finish before paging) → `group_interval` (tell me if the storm *grows*) → `repeat_interval`
(nag me if I ignore it). Four sentences, one diagram, done.

Route-tree mechanics that must be shown once, explicitly, or the reader will build a tree that silently
never matches:

- `continue` — `[ continue: <boolean> | default = false ]`. **Matching stops at the first matching
  sibling route unless `continue: true`.** This is the #1 reason "my second receiver never fires."
- Matchers come in two flavours in current Alertmanager: the newer **UTF-8 matchers**
  (`label = value`, `label != value`, `label =~ regex`, `label !~ regex`, composable PromQL-style as
  `{label="value", other!="x"}`) and the legacy **classic matchers** with different escaping.
  Older books show only the deprecated `match:` / `match_re:` maps. **Use `matchers:` in the book.**
- `inhibit_rules` take `source_matchers`, `target_matchers` and `equal` — and the `equal` list is the
  part everyone forgets, which is why their inhibition silences the whole estate.
- `time_intervals` (with `times`, `weekdays`, `days_of_month`, `months`, `years`, `location`) is how
  maintenance windows are expressed now. One short worked example ("don't page for the nightly batch
  window") is worth more than a tour of the schema.

#### 4.20 — Histogram vs summary vs native histogram

Current docs lead with: *"If you can, use native histograms and prefer them over both classic
histograms and summaries."* Key axis: **summaries are not aggregatable**; classic histograms are only
aggregatable if bucket boundaries match; native histograms are fully aggregatable and let you pick the
quantile and window ad hoc. Summaries are also expensive to compute client-side (streaming quantiles).

Accuracy illustration from the docs: true p95 at 220ms → native histogram estimates ~228ms; a classic
histogram with a 200ms–300ms bucket estimates ~295ms.

See §9 for the currency problem — every existing book calls native histograms experimental.

#### 4.21 — `for` / `keep_firing_for`, pending vs firing, and the `ALERTS` series

Beginners believe an alert either fires or doesn't. There are three states and a synthetic metric, and
knowing this is what lets them *debug* an alert instead of staring at it. Verified 2026-07-28 against
`/docs/prometheus/latest/configuration/alerting_rules/`:

```yaml
- alert: AlertName
  expr: <promql_expression>
  for: 10m               # inactive → pending → firing
  keep_firing_for: 5m    # firing → (still firing) after expr goes false
  labels:
    severity: page
  annotations:
    summary: Description
```

- `for` — *"causes Prometheus to wait for a certain duration between first encountering a new
  expression output vector element and counting an alert as firing."*
- `keep_firing_for` — holds the alert firing for a while **after** the condition clears; the
  anti-flapping counterpart to `for`, and almost nothing written before 2023 mentions it.
- **`ALERTS{alertname="<name>", alertstate="<pending|firing>"} == 1`** is a real, queryable series.
  Graphing `ALERTS` is the single best way to teach the pending→firing transition, because the reader
  can *see* it, and it also enables "how often did this alert fire last week?" as a self-assessment.

Pair this with §4.12: the state machine explains *why* `for` fixes flapping, rather than asserting it.

#### 4.22 — Nobody teaches `promtool test rules`, and it is the best assessment device available

`promtool` can unit-test alerting and recording rules against synthetic series, with no running
Prometheus. For a textbook this is close to ideal: deterministic, offline, gradeable, and it forces the
reader to *predict* behaviour (§11 pattern 2). Schema verified 2026-07-28 against
`/docs/prometheus/latest/configuration/unit_testing_rules/`:

```yaml
rule_files:
  - alerts.yml
evaluation_interval: 1m

tests:
  - interval: 1m
    input_series:
      - series: 'up{job="demo", instance="demo:8000"}'
        values: '1+0x6 0 0 0 0 0 0 0 0'
    alert_rule_test:
      - eval_time: 10m
        alertname: InstanceDown
        exp_alerts:
          - exp_labels:
              severity: page
              job: demo
              instance: demo:8000
            exp_annotations:
              summary: "demo:8000 is down"
    promql_expr_test:
      - expr: up{job="demo"}
        eval_time: 10m
        exp_samples:
          - labels: 'up{job="demo", instance="demo:8000"}'
            value: 0
```

The **series-expansion notation** is the part to teach explicitly, because it is unlike anything else
in the ecosystem:

| Notation | Expands to |
|---|---|
| `a+bxn` | `a  a+b  a+(2*b)  a+(3*b) … a+(n*b)` |
| `a-bxn` | `a  a-b  a-(2*b)  a-(3*b) … a-(n*b)` |
| `axn` | `a  a  a … a` (n+1 samples) |
| `_` | a missing sample (gap) |
| `stale` | an explicit staleness marker |

Worked reading of the example above: `'1+0x6 0 0 0 0 0 0 0 0'` is **15 values** — a `1` repeated seven
times, then eight zeros.

**Why this belongs in the book (and in no other book):**

- `stale` and `_` let the reader *manufacture* the staleness and missing-series situations from §4.8
  and §4.9 on demand, instead of waiting for a container to die.
- `0+10x100` manufactures a perfect counter; changing it to `0+10x50 0+10x50` manufactures a **counter
  reset**, which is otherwise annoying to demonstrate.
- It makes "did the reader get it right?" mechanically checkable — the missing ingredient in every
  hands-on monitoring tutorial.

Command: `promtool test rules tests.yml`. Ship the tests in the lab repo from ch. 14 onward.

---

### Tier C — mention, don't dwell

- `scrape_interval` vs `evaluation_interval` (one sentence + one YAML comment)
- `sum` vs `count` vs `count_values`
- `offset` and `@` modifier
- Subqueries `[<range>:<resolution>]` — genuinely advanced; sidebar
- Exemplars (Grafana toggle; "not available with Instant query types")
- `absent()` / `absent_over_time()` for "target vanished entirely"
- Duration syntax: `ms s m h d w y`; `1h30m` valid, **`1.5h` invalid** (a real, silly stumbling block)

---

## 5. Recommended chapter ordering

Design constraints: early win by ch. 3; one growing lab; K8s at most one optional chapter;
cardinality *before* the bomb; SLOs *after* histograms.

### Part I — See something work (ch. 1–3)

**Ch. 1 — Why you're here / what monitoring is for.** No install. ~12–15 pages.
Defines **time series** from zero (the brief says the reader doesn't know). Introduces
"metrics vs logs vs traces" in one page and then drops it. Introduces **RED** (Rate, Errors, Duration)
as the spine of the whole book. Ends with a promise and a screenshot of the ch. 3 dashboard.

**Ch. 2 — The lab: first scrape.** `docker compose up` → a provided demo service + Prometheus.
Reader visits `/metrics` on their service **with a browser** and reads raw text. Then `/targets`.
Then the expression browser. **First query is `up`.** Introduces the pull model concretely (§4.11).
Introduces the **debugging ladder** (§4.1). One paragraph on *finding out what metrics exist* —
Prometheus 3's Metrics Explorer (§9.3) and Grafana Metrics Drilldown (§9.5b) — then straight back to
typing queries.

**Ch. 3 — Your first dashboard (THE EARLY WIN).** Add Grafana to the compose file, **provisioned**
(datasource + dashboard as code — see §10.3, this must not be 30 clicks). Reader builds 3 panels:
request rate, error rate, latency. They *use* `rate()` before understanding it — with an explicit
promise: "chapter 7 explains why this works." Ends with a dashboard they'd genuinely open.

> **Rationale for using `rate()` before teaching it:** the Grafana intro material does exactly this
> ("shows a practical query first, then explains") and it's the right call. Deferred explanation is
> fine *if you flag the debt explicitly.*

### Part II — The model and the language (ch. 4–10)

**Ch. 4 — The data model.** Metric name + labels = series. Samples. The exposition format, read line
by line. `job` and `instance`. **Naming and base units (§4.17).** Where cardinality comes from —
introduce it here as arithmetic.

**Ch. 5 — Instrument your own service (counters and gauges only).** The reader edits code for the
first time. Client library idioms. Labels — and immediately, the **cardinality budget exercise**
(§4.5). Deliberately **no histograms yet.**

**Ch. 6 — PromQL I: selecting.** Selectors, matchers (`=`, `!=`, `=~`, `!~`), **instant vs range
vectors as types** (§4.4). Use the **Prometheus 3 tree view** here (§9). Staleness and the 5m lookback
(§4.8) belong here, not in an ops chapter.

**Ch. 7 — PromQL II: counters over time.** `rate`, `increase`, extrapolation, non-integers, counter
resets, the 4× rule (§4.2, §4.7). `irate` as a discouraged sidebar. **The odometer/speedometer
analogy pays off here.**

**Ch. 8 — PromQL III: aggregation.** `sum`/`avg`/`max`/`min`/`count`/`topk`, `by` vs **`without`
(default)**, arithmetic between vectors, the ratio pattern, **why you must not average ratios**
(§4.10).

**Ch. 9 — Latency and histograms.** Instrument a histogram (back to the code — the lab grows).
**Ratios first** (`le="0.3"` / `_count`), mean second, `histogram_quantile` third (§4.6).
Native vs classic (§4.20, §9). This chapter produces the **SLI** used in ch. 15.

**Ch. 10 — PromQL IV: joins and the rest.** Vector matching, `on`/`ignoring`, `group_left`, the
duplicate-series error (§4.14), `*_info` joins, `_over_time` family, subqueries. Explicitly labelled
"you can skip this and come back."

### Part III — Make it real (ch. 11–16)

**Ch. 11 — Configuration and finding targets.** `prometheus.yml` in full. `static_configs`,
`file_sd_configs`, `docker_sd_configs`. **Relabeling taught by need** (§4.13), three actions only.

**Ch. 12 — Dashboards that tell the truth.** *The original-contribution chapter* (§4.15).
`$__rate_interval` (§4.7), units, the vanishing-spike problem, legend semantics, variables/templating,
rows, and a "review this dashboard and find four lies" exercise.

**Ch. 13 — Recording rules.** Naming convention; why (dashboard speed + a stable SLI name).
Short. Sets up ch. 15.

**Ch. 14 — Alerting rules and Alertmanager.** `for` / `keep_firing_for` and the pending→firing state
machine made visible by graphing the `ALERTS` series (§4.21); labels/annotations; symptoms vs causes;
the route tree with `matchers:` and `continue`; the four timing defaults printed together (§4.19);
grouping, silences, inhibition. Reader gets a real notification (webhook receiver in the compose file
so it works offline). **Ends by writing a `promtool test rules` file for the alert they just wrote**
(§4.22) — from here on, every alerting exercise is testable and self-gradeable.

**Ch. 15 — Alerts that don't cry wolf: SLOs and burn rates.** Follow the SRE Workbook's six-iteration
structure verbatim (§2.6). Lands the multiwindow multi-burn-rate table. **This is the chapter that
justifies the book's subtitle promise.**

**Ch. 16 — Living with it.** Cardinality *diagnosis* (the tools from §4.5 revisited at scale),
retention/storage sizing, `--web.enable-lifecycle`, backups, what breaks at scale, and an honest
one-page map of Thanos/Mimir/VictoriaMetrics/Grafana Cloud **without teaching any of them**.

### Part IV — Beyond your own code (ch. 17–19)

**Ch. 17 — Metrics from things you didn't write.** node_exporter, blackbox_exporter, a database
exporter, the textfile collector. Pushgateway **sidebar** (§4.11). Brief: how to evaluate an exporter.

**Ch. 18 — (Optional) What changes on Kubernetes.** Explicitly marked optional. Scope: service
discovery, ServiceMonitor/PodMonitor and the operator pattern, `kube-prometheus-stack`, why
cardinality gets worse, and what does *not* change (PromQL, dashboards, alerting logic).
**One chapter, no more, per brief.**

**Ch. 19 — Where to go next.** OpenTelemetry and Prometheus's OTLP receiver, exemplars →
traces, logs (Loki), Grafana Drilldown. Short, honest, ends the book pointing outward.

**Appendices:** A — PromQL function reference by *return type*; B — the debugging ladder (§4.1) as a
tear-out page; C — the complete final `compose.yaml`; D — a metric-design checklist.

---

## 6. Full chapter vs sidebar vs omit

| Topic | Treatment | Why |
|---|---|---|
| Time series from zero | **Full section, ch. 1** | Brief says reader doesn't know |
| Pull vs push | **Section, ch. 2** | Answer it once, concretely, via `up` |
| Debugging "no data" | **Full section + appendix** | #1 blocker, nothing else covers it |
| Exposition format | Section, ch. 4 | Read it, don't dwell |
| Naming & base units | **Section, ch. 4** (checklist) | Cheap to teach, expensive to get wrong |
| Cardinality | **Section ch. 5 (budget) + section ch. 16 (diagnosis)** | Must precede the bomb |
| Counter vs gauge | **Full section, ch. 5** | Silent failure mode |
| `rate()` internals | **Full chapter, ch. 7** | The #2 misconception |
| `irate()` | **Sidebar (discouraging)** | Actively harmful to beginners |
| 4× rule / `$__rate_interval` | **Section ch. 7 + section ch. 12** | Needs both halves |
| Staleness / lookback | **Section, ch. 6** | Not an ops topic; it's a query semantics topic |
| Missing series / `or up*0` | **Section, ch. 8 + revisit ch. 14** | Silent alert failure |
| `by` vs `without` | **Section, ch. 8** | Teach `without` as default |
| Averaging ratios | **Full worked example, ch. 8** | Most common silent error |
| Histograms | **Full chapter, ch. 9** | |
| Native histograms | **Section of ch. 9** | Now stable — see §9 |
| Summaries | **Sidebar** | Mostly "prefer histograms" |
| `histogram_quantile` | **Section, ch. 9** (taught third) | |
| Vector matching / `group_left` | **Chapter 10, marked skippable** | Real but not day-one |
| Subqueries | **Sidebar** | Advanced |
| `offset` / `@` | **Sidebar** | |
| Relabeling | **Section of ch. 11, 3 actions** | Teach by need, not completeness |
| `hashmod` sharding | **Omit** (one-line mention) | Out of scope |
| Service discovery (non-lab) | **Table, ch. 11** | Don't tour every SD |
| Dashboard truthfulness | **Full chapter, ch. 12** | Original contribution |
| Grafana variables/templating | Section, ch. 12 | |
| Timezones | **Sidebar, ch. 12** | |
| Grafana Metrics Drilldown | **Paragraph, ch. 2 + pointer, ch. 19** | Discovery aid, not a substitute for PromQL (§9.5b) |
| Grafana 13 dynamic dashboards (tabs, auto grid) | **Section, ch. 12** | It is the default UI; can't be ignored (§9.5) |
| Recording rules | **Short chapter, ch. 13** | |
| Alertmanager routing | **Full chapter, ch. 14** | |
| `for` / `keep_firing_for` / `ALERTS` series | **Section, ch. 14** | Three states, one queryable metric (§4.21) |
| Alertmanager timing defaults (`group_wait` etc.) | **Table + diagram, ch. 14** | Four knobs, printed together once (§4.19) |
| `promtool test rules` | **Section, ch. 14 + used in exercises after** | Best gradeable device in the ecosystem (§4.22) |
| SLOs / burn rate | **Full chapter, ch. 15** | The payoff |
| Grafana Alerting vs Alertmanager | **Sidebar, ch. 14** | See §8 — pick one, name the other |
| Pushgateway | **Sidebar, ch. 17** | 80% "don't" |
| Writing your own exporter | **Sidebar, ch. 17** | |
| TSDB internals | **Sidebar, ch. 16** | Only what's operationally actionable |
| Remote write | **Sidebar, ch. 16** | Name-drop for the scaling map |
| Kubernetes | **One optional chapter, 18** | Per brief |
| OTel / OTLP | **Section, ch. 19** | Modern, but not the through-line |
| Exemplars | **Sidebar, ch. 19** | |
| Security / TLS / auth | **Appendix or ch. 16 section** | Necessary, not pedagogically central |

---

## 7. Where the early win goes, and how to protect it

**Chapter 3, per brief. Non-negotiable design rules to make it land:**

1. **One command.** `docker compose up -d`, then one URL. If the reader must click through Grafana's
   "add datasource" wizard, you have lost them. **Provision everything** (§10.3).
2. **No login friction.** Set `GF_AUTH_ANONYMOUS_ENABLED=true` and `GF_AUTH_ANONYMOUS_ORG_ROLE=Admin`
   in the lab (and say plainly: never in production).
3. **The data must be interesting immediately.** Ship a **load generator** container in the compose
   file from ch. 2. A dashboard of a service with no traffic is a dashboard of flat lines, and flat
   lines do not create the "oh!" moment. This is the most commonly-skipped detail in tutorials and it
   silently destroys the early win.
4. **Make something break.** The load generator should be controllable — an endpoint that injects
   errors or latency. Seeing the error-rate panel *move* because you caused it is the actual win.
   "Turn on the failure switch and watch panel 2" is worth more than ten pages of prose.
5. **Explicitly defer.** "You just used `rate()` and `sum by`. You don't understand them yet. That's
   fine — chapters 7 and 8. Right now, notice that it works."
6. **End with a screenshot the reader can compare against.** Beginners need to know they succeeded.

---

## 8. What the book should deliberately EXCLUDE

Being explicit about exclusions is what keeps an intro book intro-sized.

**Exclude entirely:**
- Thanos, Mimir, Cortex, VictoriaMetrics internals (one-page map in ch. 16, no more)
- Federation (`/federate`) — mention as "exists, you probably don't need it"
- Remote-write protocol internals, protobuf, Remote Write 2.0 details
- TSDB block layout, WAL, compaction, head chunks (beyond "here's why RAM goes up")
- Alertmanager HA / gossip clustering
- `hashmod` sharding, PushProx, `promtool` beyond `check config` / `check rules` / `test rules`
- Grafana Enterprise/Cloud features: SCIM, RBAC, Grafana Assistant, **Git Sync configuration**, and
  **dashboard schema v2 internals**.
  **Corrected 2026-07-28:** *dynamic dashboards* must NOT be on this list. They are GA and default in
  Grafana OSS 13 — the reader is using them whether the book mentions them or not (§9.5). Exclude the
  *internals*, teach the *surface* the reader actually sees (tabs, auto grid vs custom grid,
  conditional rendering gets one sidebar).
- Every service discovery mechanism (EC2, Consul, Azure, GCE, Nomad, …) — table, not tour
- Every exporter — teach *how to evaluate one*, not a catalogue
- Every Grafana panel type — teach ~5 well (time series, stat, gauge, table, heatmap)
- Client libraries for every language — pick **one** primary, appendix for the others
- PromQL exotica: `double_exponential_smoothing` (né `holt_winters`), trigonometric functions,
  `predict_linear` beyond one disk-fill example
- OpenMetrics protobuf, native histogram bucket-schema mathematics
- Writing Grafana plugins
- Tracing and logging as first-class topics (ch. 19 pointer only)
- Capacity planning spreadsheets, multi-tenancy, cost optimisation

**Two contested exclusions worth a deliberate editorial decision:**

1. **Grafana Alerting vs Prometheus Alertmanager.** These are two complete, competing alerting systems.
   Teaching both doubles ch. 14 and confuses everyone.
   **Recommendation: teach Alertmanager as the main line** (alert rules live next to the code and the
   PromQL, they're version-controlled, and it's what the SLO literature assumes), and give Grafana
   Alerting a two-page sidebar explaining when you'd choose it (multi-datasource alerts, UI-driven
   teams). Note honestly that many orgs run both — infra alerts via Alertmanager, app/correlation
   alerts via Grafana.
2. **Language for instrumentation.** Pick one for the main line. Go is the ecosystem's default and the
   official tutorial's choice; Python is friendlier for the stated reader. **Recommendation: Python
   for the main lab service** (lower barrier, brief says "comfortable writing code" not "writes Go"),
   with a Go appendix and a note that the *concepts* are identical. Whatever is chosen, **do not
   alternate languages between chapters** — the lab must be one artefact.

---

## 9. What existing books get wrong or omit (the 2026 currency problem)

This is where the book earns its existence. Anything written before ~2025 is wrong on all of these.

### 9.1 Prometheus 3 broke things older tutorials still teach

From the official migration guide, verbatim highlights:

- **Removed feature flags** (now default behaviour): `promql-at-modifier`, `promql-negative-offset`,
  `new-service-discovery-manager`, `expand-external-labels`, `no-default-scrape-port`.
  `agent` → `--agent` CLI flag. `remote-write-receiver` → `--web.enable-remote-write-receiver`.
  `auto-gomemlimit`/`auto-gomaxprocs` now automatic (disable with `--no-...`).
- **`no-default-scrape-port`:** *"Prometheus v3 will no longer add ports to scrape targets according to
  the specified scheme."* Older configs relying on the implicit `:80`/`:443` break.
- **Regex:** *"The `.` pattern in regular expressions in PromQL matches newline characters."*
  Use `[^\n]` for v2 behaviour. **Silently changes existing queries' results.**
- **Range selectors are now left-open, right-closed** (were left-closed, right-closed). Affects
  subqueries and edge-case results. **No book covers this.**
- **`le` and `quantile` label values are normalised to float form** — `le="1"` becomes `le="1.0"`.
  **This breaks every hardcoded `{le="1"}` in every older tutorial and dashboard.** High-value warning.
- **`holt_winters` renamed `double_exponential_smoothing`** (needs
  `--enable-feature=promql-experimental-functions`).
- **Strict `Content-Type` on scrape:** *"Prometheus v3 is more strict concerning the Content-Type
  header received when scraping."* Scrapes fail without a proper header; `fallback_scrape_protocol`
  is the escape hatch. **A likely cause of a beginner's mystery empty graph with a hand-rolled
  exporter — belongs in the debugging ladder (§4.1, cause 8).**
- **UTF-8 metric and label names now supported** (legacy validation available via config). Implies the
  new quoting syntax in selectors. Older books state flatly that names match `[a-zA-Z_:][a-zA-Z0-9_:]*`.
- **Alertmanager v1 API no longer supported.**
- **TSDB format:** a v3 TSDB can only be read by v2.55+. Downgrade path matters for the ops chapter.
- **Logging** switched from `go-kit/log` to `log/slog` — log lines look different.
- `scrape_classic_histograms` renamed **`always_scrape_classic_histograms`**.
- `remote_write` `http_config.enable_http2` now defaults to **`false`**.

### 9.2 Native histograms are STABLE now — every book says experimental

**Verbatim from the spec:** *"Starting with v3.8.0, native histograms are supported as a stable
feature."* As of v3.9 the `native-histograms` feature flag is a **no-op**.

But — and this is the trap — **scraping is still opt-in**:

```yaml
scrape_native_histograms: true      # required to collect them
```
```yaml
remote_write:
  - send_native_histograms: true    # separate setting
```
Both **default to `true` from v4 onward.**

And **the client library is a third opt-in that nobody mentions.** Re-verified 2026-07-28 against the
spec: instrumentation libraries expose

| Parameter | Default | Effect |
|---|---|---|
| `NativeHistogramBucketFactor` | `1.1` | initial resolution; a histogram is only *native* if this is set |
| `NativeHistogramZeroThreshold` | `2^-128` | width of the zero bucket |
| `NativeHistogramMaxBucketNumber` | (optional) | caps bucket growth, trading resolution for memory |

So the honest, complete answer to "are native histograms ready?" in 2026 is **three switches, not one**:
the *metric* must be created as a native histogram in the app (`NativeHistogramBucketFactor`), the
*server* must be told to scrape them (`scrape_native_histograms: true`), and if you remote-write, that
is a *third* flag (`send_native_histograms: true`). Only the last two flip to `true` by default in v4.

And the practices doc now *leads* with: *"If you can, use native histograms and prefer them over both
classic histograms and summaries."*

**Canonical paragraph for the book (proposed wording, to settle `_CONFLICTS.md` C4):**

> Native histograms are a stable feature of Prometheus as of version 3.8, and the project's own
> guidance now prefers them to both classic histograms and summaries. They are not, however, on by
> default: your client library must be told to produce them, and your Prometheus must be told to
> scrape them. Meanwhile every exporter you did not write, and every dashboard you inherit, still
> speaks classic `_bucket` / `_sum` / `_count`. So: learn classic histograms, because that is what
> you will read; turn on native histograms for the metrics you own, because that is where this is
> going.

That paragraph is true on 2026-07-28 and stays true through v4, which is more than can be said for
either "they're experimental" or "just use them."

**Editorial decision required:** ch. 9 must teach **classic histograms as the main line** (that's what
the reader's client library, existing exporters, and every dashboard they'll inherit still emit) while
teaching native histograms as **the direction of travel, with the exact config to turn them on.**
Saying "experimental" would be flatly wrong; saying "use them for everything" would leave the reader
unable to read their own ecosystem. Say both, clearly.

> Also relevant and recent: the Prometheus blog post "Modernizing Prometheus: Native Storage for
> Composite Types" (2026-02-14). **UNVERIFIED** — I saw the title in search results but did not fetch
> the article. Worth reading before finalising ch. 9.

### 9.3 The Prometheus 3 UI is the best PromQL teaching tool that exists, and no book uses it

At `/query` the rewritten (React/Mantine) UI provides:
- **Tree view** — renders a query as a tree of sub-expressions, showing **how many series each node
  evaluates to** and the label data present at each node. Hover a label to see example values; click a
  node to see its data as table or graph.
- **Explain tab** — shows function documentation for the selected node, and for binary operators
  **visualises vector matching**, including *failed* matches.
- **Metrics explorer** — search all metrics with metadata, drill into label names/values and per-label
  cardinality, then insert the constructed selector.

The tree view was inspired by **PromLens**, which was donated to the Prometheus project.

**This directly attacks misconceptions §4.4 (types), §4.14 (vector matching), §4.5 (cardinality
discovery) and §4.1 (empty results — you can see *which node* went empty).**

**Strong recommendation: make the tree view a recurring pedagogical device from ch. 6 onward.**
"Paste this query into the tree view and look at the series counts at each level" is a better exercise
than any prose explanation. Known limitation to note: the new UI lacks heatmap rendering and exemplar
display.

**Three further details verified 2026-07-28, all of which break older instructions:**

- **The "Graph" page is now called "Query"** — because, in the PromLabs write-up's phrasing, not every
  query is graphed. Every pre-3.0 tutorial says "go to the Graph tab." That tab does not exist.
  The book should refer to it by URL (`http://localhost:9090/query`) as well as by name, since URLs
  age better than tab labels.
- The UI was rebuilt on **Mantine** (replacing the old Bootstrap styling), and rules/alerts pages now
  render PromQL with **syntax highlighting** instead of attempting full YAML rendering. Screenshots
  from any earlier book are unrecognisable.
- **There is a documented escape hatch:** the **`old-ui` feature flag** restores the previous UI.
  Worth one sentence in the lab chapter — not to encourage it, but so a reader whose corporate
  Prometheus looks different knows why, and a reader who hits a new-UI bug isn't stuck.

**Sequencing note:** the tree view is most valuable *immediately after* the reader's first
`sum by (...)` (§5 ch. 8), because that is the first moment a query has an interesting internal
structure. Introducing it earlier (against `up`) wastes it — a single selector's tree is one node.

### 9.4 Prometheus ingests OTLP natively now

```
--web.enable-otlp-receiver          # disabled by default (no auth in Prometheus)
POST /api/v1/otlp/v1/metrics
```
```yaml
otlp:
  promote_resource_attributes:
    - service.instance.id
    - service.name
    - service.namespace
    - service.version
    - cloud.availability_zone
    - cloud.region
  translation_strategy: NoTranslation   # or UnderscoreEscapingWithSuffixes (default),
                                        # UnderscoreEscapingWithoutSuffixes, NoUTF8EscapingWithSuffixes
  keep_identifying_resource_attributes: true
```
Delta temporality is experimental (`--enable-feature=otlp-deltatocumulative`).

Older books predate this entirely and present OTel as a separate universe. Ch. 19 should show that
the walls have come down — briefly.

### 9.5 Grafana **13** invalidated every dashboard-building instruction ever printed

**This is the biggest single currency problem in the book, bigger than Prometheus 3.**
Corrected and expanded 2026-07-28; an earlier revision of this file was written against 12.4 and
understated it.

- Current OSS release: **13.1.1** (2026-07-21). **13.0.0 went GA in April 2026.**
- **Dynamic dashboards are GA and are no longer opt-in.** Grafana's own announcement
  (2026-04-08, "Dynamic dashboards is now generally available"): dynamic dashboards are on by default
  for Grafana Cloud *and* self-managed instances; **every new *and existing* dashboard uses the new
  layout engine, editing experience and dashboard structure automatically**, with existing dashboards
  **migrated to the new schema when you open them**.
- What that concretely changes for a beginner following printed steps:
  - **The edit experience is a sidebar**, not the old full-screen panel editor. You click an element
    and it opens in a panel that keeps the dashboard visible.
  - **Two layout modes:** *custom grid* (hand-placed panels, placement carries meaning) and
    *auto grid* (panels flow and stay consistent as content changes). "Drag the panel to resize it"
    is now mode-dependent advice.
  - **Tabs** are a first-class dashboard structure, nestable with rows.
  - **Conditional rendering** — show/hide panels, rows or tabs based on variable values or query
    results.
  - Variables and annotations are edited **in the sidebar**; there is a new dashboard-creation page.
  - Ad hoc filter variables were **renamed to simply "Filters."**
- **Dashboard schema v2** decouples layout from panel config; v1 JSON auto-migrates on load.
  **Any dashboard JSON printed in a pre-13 book is a different shape now** — and worse, it will be
  silently rewritten the first time the reader opens it.
- **Git Sync is GA** in 13.0 — bidirectional GitOps for dashboards against GitHub/GitLab/Bitbucket.
  "Observability as code" is the platform's framing.
- Also GA in 13.0: revamped **gauge** visualization; restore-deleted-dashboards; panel style presets
  and copy/paste panel styling; a query recommendation system.
- Alerting in 13.0: provenance support on notification APIs; a new permission gate on the Alertmanager
  status endpoint; **removal of legacy Alertmanager configuration endpoints**.

**Implications for our book — three hard rules:**

1. **Ship dashboards as provisioned JSON files in the repo** (§10.3) and keep printed JSON to
   *fragments*, never whole dashboards. Whole-dashboard JSON in print is dead on arrival, bloats the
   page count, and is now schema-unstable besides.
2. **Write dashboard instructions in terms of intent, not clicks.** "Add a time series panel, set the
   query to X, set the unit to seconds" survives a UI revision; "click the three-dot menu in the top
   right, then Edit, then drag the handle" does not. Screenshots age fastest of anything in the book —
   keep them few, purposeful, and cropped to the thing being discussed.
3. **State the version in the lab chapter and again in the dashboard chapter**, and add one sentence
   for readers on a corporate 12.4.x install (still in patch support into 2027) telling them the
   editing surface will look different but every *query* in the book is unchanged. That sentence buys
   a lot of goodwill and costs one line.

> **Correction to an earlier revision of this file:** §8 previously listed "dynamic dashboards" among
> Grafana *Enterprise/Cloud* features to exclude. That is now wrong — dynamic dashboards are the
> default behaviour of Grafana OSS 13. They cannot be excluded; they are the thing the reader is
> looking at. What should be excluded is *schema v2 internals* and *Git Sync configuration*.

### 9.5b Grafana Metrics Drilldown: a queryless on-ramp that didn't exist when the other books were written

`/docs/grafana/latest/explore/simplified-exploration/metrics/` describes **Grafana Metrics Drilldown**
as *"a queryless experience for browsing Prometheus-compatible metrics"*: find related metrics in a few
clicks, segment by label to spot anomalies, get a sensible visualization chosen automatically,
*"without needing to write a PromQL query"*, and pivot to related telemetry. Grafana's 13-era framing
groups it with Logs/Traces/Profiles Drilldown as one-click integrations with core dashboards.

> **UNVERIFIED:** the exact Grafana version in which Metrics Drilldown became a bundled core app in
> **OSS** (as opposed to an installable plugin, `grafana-metricsdrilldown-app`). The docs page does not
> state it and I did not confirm it. **Do not print a version number for this.** Verify before ch. 3 is
> final, because the instruction "open Drilldown" fails badly if the plugin isn't there.

**Pedagogical judgement — use it, but not as the early win.** Drilldown is genuinely excellent for
*discovery* ("what metrics does this thing even expose?") and it is a real answer to the
metrics-explorer problem. But a reader whose first success came from clicking through Drilldown has
learned nothing transferable, and the book's whole promise is that they can write real PromQL.

**Recommended placement:**
- **Ch. 2, one paragraph + one screenshot**, as a *discovery* tool: "before you can query a metric you
  have to know it exists; here are two ways to find out" (Prometheus 3's Metrics Explorer, §9.3, and
  Grafana Drilldown). Then go back to typing queries.
- **Ch. 19**, as part of "where to go next."
- **Not** as the ch. 3 early win. The early win must be a dashboard the reader *built*, because
  authorship is what produces the "oh!" (§7).

### 9.6 Docker Compose: the `version:` key is obsolete

Compose v2 ignores the top-level `version` element and warns:
*"the attribute `version` is obsolete, it will be ignored, please remove it to avoid potential
confusion."* Every older Prometheus tutorial's compose file starts with `version: '3.7'`.
**Our lab file must not.** Also prefer the filename `compose.yaml` and the command `docker compose`
(v2, space) over `docker-compose` (v1, hyphen, EOL).

### 9.7 Things existing books omit rather than get wrong

- The **debugging loop** (§4.1) — the single biggest omission
- **Reading dashboards critically** (§4.15)
- **Cardinality taught preventively** rather than as post-mortem ops
- **Averaging ratios** shown with numbers proving it's wrong
- The **`sum()`-or-`avg()`-should-be-meaningful** metric design test
- **Grafana depth** — 20 pages is not enough and readers said so
- **Native histograms' actual current status** and the exact opt-in config
- An honest sentence about **`increase()` being an estimate, not a count**
- *(added 2026-07-28)* **`promtool test rules`** — a whole testing discipline, absent from every intro
  treatment, and the only way to give the reader gradeable exercises (§4.22)
- *(added 2026-07-28)* **`keep_firing_for`** and the **`ALERTS` series** as a debugging tool (§4.21)
- *(added 2026-07-28)* **rate-before-sum** stated as a *counter-reset* rule rather than lumped in with
  general aggregation advice (§4.10d)
- *(added 2026-07-28)* The **documented** clamping behaviour of `histogram_quantile` at the top and
  bottom buckets — books quote the function signature, not the interpolation rules (§4.6)
- *(added 2026-07-28)* Alertmanager's **`continue: false` default**, which silently makes second and
  subsequent routes dead code (§4.19)
- *(added 2026-07-28)* That the **same panel gives different `$__rate_interval` values in the editor
  and on the dashboard** (§4.7)

---

## 10. Lab-stack pedagogy constraints

### 10.1 Composition principle

The lab's centre is **the reader's own service** (§2.7). Suggested growth:

| Ch. | Added to the stack |
|---|---|
| 2 | demo service (pre-instrumented), prometheus, **load generator** |
| 3 | grafana (provisioned datasource + dashboard) |
| 5 | reader replaces demo service with their own instrumented one |
| 9 | histogram added to that service |
| 11 | second instance of the service (so `instance` labels matter), file_sd |
| 14 | alertmanager + a local webhook receiver |
| 17 | node-exporter, blackbox-exporter |

**Key design point:** ch. 11 adding a *second replica* is what makes `sum by`, `without(instance)`,
and aggregation stop being abstract. Single-instance labs make aggregation look pointless.

### 10.2 Compose file rules

- No `version:` key (§9.6)
- Pin exact image tags (§1)
- Named volumes for `prometheus` and `grafana` data, so restarts don't wipe history — a reader whose
  data vanishes on restart concludes the tool is broken
- `--web.enable-lifecycle` on Prometheus so `curl -X POST localhost:9090/-/reload` works;
  otherwise every config change means a restart and the reader loses patience
- Consider `--enable-feature=...` only where genuinely required, and say why each time

### 10.3 Grafana provisioning (protects the ch. 3 early win)

Mount into `/etc/grafana/provisioning/{datasources,dashboards}` and `/var/lib/grafana/dashboards`.

```yaml
# provisioning/datasources/prometheus.yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    uid: prometheus
    url: http://prometheus:9090
    isDefault: true
```

```yaml
# provisioning/dashboards/dashboards.yaml
apiVersion: 1
providers:
  - name: 'lab'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /var/lib/grafana/dashboards
      foldersFromFilesStructure: true
```

**Set `allowUiUpdates: true`** — the reader must be able to edit provisioned dashboards in the UI or
chapter 12's exercises are impossible.

**Critical, and usually missed:** in the datasource's `jsonData`, set the **scrape interval** to match
`prometheus.yml`, because `$__rate_interval` is computed from it (§4.7). Getting this wrong makes the
book's own dashboards subtly wrong.

```yaml
# provisioning/datasources/prometheus.yaml — the version that is actually correct
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    uid: prometheus
    url: http://prometheus:9090
    isDefault: true
    jsonData:
      timeInterval: "15s"      # MUST equal global.scrape_interval in prometheus.yml.
                               # This is the "Scrape interval" field in the UI, and it is
                               # the `scrape_interval` term inside $__rate_interval (§4.7).
      httpMethod: POST
```

> The field is named **`timeInterval`** in provisioning YAML but appears as **"Scrape interval"** in
> the UI. That mismatch costs people hours. Say it once, in a callout.

Two more provisioning points that protect the early win:

- If ch. 12 asks the reader to *edit* provisioned dashboards, `allowUiUpdates: true` is mandatory
  (already noted above) — otherwise the Save button is disabled and the chapter is impossible.
- Grafana 13 will **migrate a provisioned v1 dashboard to schema v2 on open** (§9.5). The JSON in the
  repo and the JSON in the browser will therefore differ. Warn the reader before they diff them and
  conclude something is broken, and keep the repo's dashboards as the source of truth.

### 10.4 Platform notes

The reader may be on Windows/macOS/Linux. `node_exporter` on Docker Desktop reports the VM, not the
host — say so explicitly rather than letting the reader conclude their machine has 0% disk usage.
Prometheus images run as a non-root user; bind-mounted host directories cause permission errors —
prefer named volumes.

---

## 11. Exercise and assessment design

Patterns that fit these specific misconceptions:

1. **"Break it and watch"** — every chapter has a switch on the load generator (inject errors, add
   latency, kill an instance, restart the service to force a counter reset). Passive labs don't teach
   monitoring; monitoring is about change.
2. **"Predict then run"** — state what the query will return *before* executing. Highest-yield format
   for the extrapolation surprise (§4.2b) and staleness (§4.8).
3. **"Find the lie"** — give a dashboard with 4 deliberate errors (averaged ratio, `$__interval` on a
   rate, percent-vs-ratio unit mismatch, unscoped selector). Ch. 12.
4. **"Two queries that should agree but don't"** — `avg(a/b)` vs `sum(a)/sum(b)` with real numbers.
5. **"Blow it up"** — deliberately add a high-cardinality label, watch `prometheus_tsdb_head_series`
   climb, then fix it with `metric_relabel_configs`. Teaches §4.5 and §4.13 in one motion.
6. **"Make this alert fire, then make it stop crying"** — iterate a bad alert into a good one following
   the SRE Workbook's six steps.
7. **Tree-view exercises** (§9.3) — "how many series does each node produce?"
8. **`promtool test rules` as the grader** (§4.22) — *added 2026-07-28.* From ch. 14 onward, every
   alerting exercise ships with a test file the reader runs to check themselves. `input_series` with
   `stale`, `_`, and reset-shaped values (`0+10x50 0+10x50`) manufactures staleness, gaps and counter
   resets deterministically and offline. **This is the only mechanically checkable assessment format
   available in this subject, and no existing book uses it.**
9. **"Restart one replica"** (§4.10d) — with two replicas in the stack from ch. 11, restart one and
   compare a `sum(rate(...))` panel against a `rate(sum(...))` panel. The spurious spike appears on
   exactly one of them. Five minutes, unforgettable, unpublished anywhere.
10. **"Zoom out and lose the spike"** (§4.15) — same panel, two time ranges, then fix it with
    `max_over_time`. Teaches that a graph is a sampled query result, not a photograph.

**Anti-pattern to avoid:** exercises that only ask the reader to type in a given query. Every existing
tutorial does this and it produces no transfer.

**A note on self-assessment.** The stated reader is a working developer with no ops background and
probably no colleague to check their work. Every chapter therefore needs at least one
*self-verifiable* success signal: an expected screenshot, a `promtool` test that passes, a specific
number the query should return, or an `ALERTS` series that should appear. Without one, the reader
cannot distinguish "I understood this" from "I typed it correctly", and monitoring is a subject where
those feel identical right up until an incident.

---

## 12. Voice and notation conventions to fix early

- **Name the confusion before resolving it.** ("Everybody trips on this. Here's the trip wire.")
- **Show wrong-then-right,** with the wrong output printed. Beginners recognise their own mistakes.
- Prefer **`without()`** in all example aggregations (§4.10) so the habit forms.
- Always scope selectors with `{job="..."}` in examples, even when unnecessary (§4.10b).
- In every Grafana panel query, use **`[$__rate_interval]`** — never a literal range (§4.7).
- Use **`_total`** suffixes and **base units** in every invented metric (§4.17), so the reader absorbs
  the convention by osmosis.
- When printing PromQL, annotate the **type** of each sub-expression the first several times.
- Never print a whole Grafana dashboard JSON (§9.5) — fragments and a repo link.
- Flag deferred explanations explicitly ("you'll understand this in ch. 7") rather than hand-waving.

---

## 13. Explicitly UNVERIFIED items (do not state as fact)

**Status key:** ✅ RESOLVED 2026-07-28 · ⚠️ still open.

1. ⚠️ **Full TOC of *Prometheus: Up & Running* 2nd ed.** — **partially resolved.** §2.1 now carries a
   part-level reconstruction (Parts I–VI, Ch. 1, 7, 13–21) recovered from O'Reilly's search index.
   O'Reilly page URLs still return HTTP 403 to automated fetches; the shroffpublishers and cb-india
   mirrors also 403'd and dokumen.pub was in maintenance. **Chapters 3–6, 8, 11, 12 titles are still
   unknown.** Someone with a browser and an O'Reilly account should transcribe the printed TOC.
2. ✅ **Which Prometheus line is truly "LTS" today — RESOLVED.** Re-fetched `prometheus.io/download`
   on 2026-07-28: **Latest `3.13.1 / 2026-07-10`, LTS `3.5.5 / 2026-07-09`.** The GitHub
   `releases/latest` body for v3.13.1 makes no LTS claim. Closes `_CONFLICTS.md` C2 against
   `promql.md`'s "3.13.0 is LTS."
3. ⚠️ **Absence of a Julia Evans Prometheus explainer** — searched again 2026-07-28; still nothing.
   The closest is "Monitoring tiny web services" (July 2022) on jvns.ca. Cannot prove a negative;
   the book should cite the *register*, not claim the gap in print.
4. ⚠️ **Attribution of the 4× rule to Björn Rabenstein** — not confirmed. Cite **Robust Perception /
   Brian Brazil**, which is verified.
5. ⚠️ **Resolution of prometheus/prometheus #13020** — issue closed, maintainer resolution not
   surfaced. But note §4.6 now quotes the *documented* behaviour ("if a quantile is located in the
   highest bucket, the upper bound of the second highest bucket is returned"), so the book no longer
   needs the issue to make the point. Cite the docs, mention the issue only as evidence of confusion.
6. ✅ **Grafana `$__rate_interval` formula and precedence — RESOLVED.** Re-fetched
   `/docs/grafana/latest/datasources/prometheus/template-variables/` on 2026-07-28. Formula
   `max($__interval + scrape_interval, 4 * scrape_interval)`; precedence Min step → data source Scrape
   interval; and the literal caveat *"The panel-level `min interval` is affected by the resolution
   setting and doesn't factor into this calculation."* See §4.7.
7. ⚠️ **Reddit r/PrometheusMonitoring specifically** — **now known to be unreachable from this
   toolchain**: a direct fetch of `reddit.com/r/PrometheusMonitoring/top/?t=year` was refused by the
   fetch tool, and keyword searches return blogs rather than Reddit threads. Substitute evidence used
   instead: `discuss.prometheus.io` (the official Discourse — its most-viewed threads of the past year
   are "Alternatives to Alertmanager. Grafana's alerting?" 623 views, "Systemd collector 'couldn't get
   dbus connection'" 578, "Clustering Architecture" 367, "Metrics missing from all servers for ~1h
   after a single server restart" 311, "Query Regarding Metric Name Changes and Deprecations in Windows
   Exporter" 304, "Node_exporter showing wrong metrics" 219, "Determining network latency…" 210),
   plus Google Groups `prometheus-users`, Grafana community forums, and GitHub issues.
   **The book must not cite Reddit threads it hasn't seen.** Note that the single most-viewed thread
   being "Alertmanager or Grafana alerting?" corroborates §8's contested-exclusion decision: readers
   genuinely don't know which alerting system they're supposed to use.
8. ⚠️ **Prometheus blog "Modernizing Prometheus: Native Storage for Composite Types" (2026-02-14)** —
   title seen in search, article still not fetched. Read before ch. 9 is final.
9. ⚠️ **Exact current star counts** for vegasbrianc/prometheus (>4,000 as of mid-2023) and dockprom.
10. ⚠️ **Grafana version in which Metrics Drilldown became a bundled core app in OSS** — the docs page
    does not say, and a separate plugin listing (`grafana-metricsdrilldown-app`) exists. See §9.5b.
    **Do not print a version.**
11. ⚠️ **Whether the Grafana 13 "query variable editor" change is in 13.1 or a later 13.2** — a search
    snippet referenced "released in v13.2.0" while `releases/latest` is `v13.1.1`. Likely a Cloud-first
    feature. **Do not print 13.2 as an existing OSS release.**
12. ⚠️ **`grafana/grafana` vs `grafana/grafana-oss` image equivalence** — unresolved here and in
    `grafana-core.md`. The lab must pick one and the book must not claim they are identical.

---

## 14. Sources

**Primary — Prometheus**
- https://prometheus.io/download/
- https://prometheus.io/docs/prometheus/latest/migration/
- https://prometheus.io/docs/prometheus/latest/querying/basics/
- https://prometheus.io/docs/prometheus/latest/querying/functions/
- https://prometheus.io/docs/practices/naming/
- https://prometheus.io/docs/practices/instrumentation/
- https://prometheus.io/docs/practices/histograms/
- https://prometheus.io/docs/practices/rules/
- https://prometheus.io/docs/practices/alerting/
- https://prometheus.io/docs/practices/pushing/
- https://prometheus.io/docs/introduction/faq/
- https://prometheus.io/docs/specs/native_histograms/
- https://prometheus.io/docs/guides/opentelemetry/
- https://prometheus.io/docs/tutorials/getting_started/
- https://prometheus.io/docs/guides/go-application/
- https://prometheus.io/blog/2024/11/14/prometheus-3-0/
- https://prometheus.io/blog/2026/02/14/modernizing-prometheus-composite-samples/ (UNVERIFIED, not fetched)
- https://github.com/prometheus/prometheus/releases
- https://github.com/prometheus/prometheus/issues/13020
- https://github.com/prometheus/prometheus/issues/6611
- https://github.com/prometheus/prometheus/issues/13221
- https://github.com/prometheus/prometheus/issues/8247
- https://github.com/prometheus/pushgateway
- https://github.com/prometheus/promlens

**Primary — Prometheus (added / re-verified 2026-07-28)**
- https://prometheus.io/download/ — Latest 3.13.1, LTS 3.5.5
- https://api.github.com/repos/prometheus/prometheus/releases/latest — `v3.13.1`, 2026-07-10
- https://api.github.com/repos/prometheus/alertmanager/releases/latest — `v0.33.1`, 2026-07-04
- https://prometheus.io/docs/tutorials/ — the five-page tutorial index
- https://prometheus.io/docs/tutorials/understanding_metric_types/
- https://prometheus.io/docs/prometheus/latest/installation/ — Docker commands, image names, volumes
- https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/ — `for`, `keep_firing_for`, `ALERTS`
- https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/ — `promtool test rules` schema
- https://prometheus.io/docs/alerting/latest/configuration/ — `group_by`/`group_wait`/`group_interval`/`repeat_interval` defaults, `continue`, matchers, `inhibit_rules`, `time_intervals`
- https://prometheus.io/blog/2025/12/16/introducing-info-function/ — experimental `info()`

**Primary — Grafana**
- https://api.github.com/repos/grafana/grafana/releases/latest — `v13.1.1`, 2026-07-21
- https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v13-0/
- https://grafana.com/blog/grafana-13-release-all-the-latest-features/
- https://grafana.com/docs/grafana/latest/explore/simplified-exploration/metrics/ — Metrics Drilldown
- https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/best-practices/ — USE/RED/Four Golden Signals framing, "avoid stacking graph data", refresh-rate advice
- https://grafana.com/docs/grafana/latest/datasources/prometheus/troubleshooting/
- https://grafana.com/docs/grafana/latest/fundamentals/intro-to-prometheus/
- https://grafana.com/docs/grafana/latest/administration/provisioning/
- https://grafana.com/docs/grafana/latest/datasources/prometheus/query-editor/
- https://grafana.com/docs/grafana/latest/datasources/prometheus/template-variables/
- https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v12-0/
- https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v12-4/
- https://grafana.com/tutorials/grafana-fundamentals/
- https://grafana.com/blog/new-in-grafana-7-2-rate-interval-for-prometheus-rate-queries-that-just-work/
- https://grafana.com/blog/how-relabeling-in-prometheus-works/
- https://grafana.com/blog/grafana-12-release-all-the-new-features/
- https://grafana.com/blog/grafana-12-4-release-all-the-latest-features/
- https://grafana.com/whats-new/2026-04-08-dynamic-dashboards-is-now-generally-available/
- https://github.com/grafana/grafana/releases
- https://github.com/grafana/grafana/issues/76830
- https://github.com/grafana/grafana/issues/15284
- https://github.com/grafana/grafana/issues/22289
- https://github.com/grafana/grafana/issues/51525
- https://github.com/grafana/grafana/issues/53288
- https://github.com/grafana/grafana/issues/9705

**Teaching sources (added 2026-07-28)**
- https://promlabs.com/blog/2025/07/17/why-i-recommend-native-prometheus-instrumentation-over-opentelemetry/
- https://promlabs.com/blog/2026/03/05/filling-in-missing-series-in-binary-operator-matching/
- https://promlabs.com/blog/2024/08/17/smaller-is-better-why-you-should-avoid-large-multi-target-exporters-in-prometheus/
- https://promlabs.com/blog/2023/09/19/errors-successes-totals-which-metrics-should-i-expose-to-prometheus/
- https://www.robustperception.io/rate-then-sum-never-sum-then-rate/
- https://chronosphere.io/learn/understanding-promql-and-its-quirks/ — disappearing series on step change, hidden peaks, lookback-vs-downsampling
- https://discuss.prometheus.io/top?period=yearly — official Discourse, most-viewed threads
- https://demo.prometheus.io/ and https://demo.promlabs.com/query — public Prometheus instances for query practice
- https://training.promlabs.com/training/understanding-promql/
- https://promlabs.com/promql-cheat-sheet/
- https://grafana.com/tutorials/grafana-fundamentals/ + https://github.com/grafana/tutorial-environment

**Teaching sources**
- https://promlabs.com/blog/
- https://promlabs.com/blog/2021/01/29/how-exactly-does-promql-calculate-rates/
- https://promlabs.com/blog/2022/12/11/avoid-these-6-mistakes-when-getting-started-with-prometheus/
- https://promlabs.com/blog/2023/09/13/dealing-with-missing-time-series-in-prometheus/
- https://promlabs.com/blog/2020/06/18/the-anatomy-of-a-promql-query/
- https://promlabs.com/blog/2020/07/02/selecting-data-in-promql/
- https://promlabs.com/blog/2020/09/25/metric-types-in-prometheus-and-promql/
- https://promlabs.com/blog/2024/09/11/a-look-at-the-new-prometheus-3-0-ui/
- https://training.promlabs.com/training/monitoring-and-debugging-prometheus/web-status-pages/tsdb-status-information/
- https://www.robustperception.io/what-range-should-i-use-with-rate/
- https://www.robustperception.io/staleness-and-promql/
- https://promcon.io/2017-munich/slides/staleness-in-prometheus-2-0.pdf
- https://sre.google/workbook/alerting-on-slos/
- https://iximiuz.com/en/posts/prometheus-vector-matching/
- https://utcc.utoronto.ca/~cks/space/blog/sysadmin/PrometheusGroupLeftAndRightNotes

**Existing books / reviews**
- https://www.oreilly.com/library/view/prometheus-up/9781098131135/ (403 to automated fetch)
- https://hceris.com/book-review-prometheus-up-and-running/
- https://dev.to/sirech/book-review-prometheus-up-and-running-218c
- https://www.goodreads.com/book/show/39971446-prometheus
- https://www.amazon.com/product-reviews/B07FCV2VVG

**Forum / community pain-point evidence**
- https://groups.google.com/g/prometheus-users/c/-YimxkbjC9M (staleness gaps)
- https://groups.google.com/g/prometheus-users/c/EUFWuLPvdIs (5m staleness)
- https://groups.google.com/g/prometheus-users/c/PZ-fnZxSpOk (rate/irate/delta/increase inconsistent)
- https://groups.google.com/g/prometheus-users/c/cylqenjZIp8 (forever increasing irate/rate)
- https://groups.google.com/g/prometheus-users/c/SqynCBhmGLA (matching labels must be unique)
- https://groups.google.com/g/prometheus-users/c/Dq6pUnnmivI (duplicate series for match group)
- https://groups.google.com/g/prometheus-users/c/po4YEDU5uWw (many-to-many join)
- https://groups.google.com/g/prometheus-users/c/07PARWIGc30 (rate a sum across machines)
- https://discuss.prometheus.io/t/promql-join-many-to-many-matching/543
- https://community.grafana.com/t/grafana-dashboard-displaying-empty-graphs-not-data-coming/8275
- https://community.grafana.com/t/1-1-resolution-15s-scrape-interval-and-empty-graphs-when-time-range-is-3h-or-less/108830
- https://community.grafana.com/t/interval-and-max-data-points-calculation-in-prometheus-queries/56665
- https://community.grafana.com/t/how-to-make-grafana-prometheus-summarize-values-by-max-or-peak-when-zooming-out/52506
- https://community.grafana.com/t/grafana-shows-wrong-data-or-timezone/24203
- https://community.grafana.com/t/weird-timezone-problems/72815
- https://learn.microsoft.com/en-us/answers/questions/2183064/how-to-fix-grafana-dashboard-showing-no-data-for-p
- https://docs.cloud.google.com/stackdriver/docs/managed-prometheus/troubleshooting
- https://github.com/prometheus-community/helm-charts/issues/2038
- https://sarajarjoura.com/eliminating-nans-in-promql-histogram-quantile/

**Lab-stack references**
- https://github.com/vegasbrianc/prometheus
- https://adamj.eu/tech/2025/05/05/docker-remove-obsolete-compose-version/

**Secondary / corroborating**
- https://signoz.io/guides/understanding-prometheus-rate-vs-increase-functions-correctly/
- https://betterstack.com/community/guides/monitoring/prometheus-relabeling/
- https://last9.io/blog/how-to-manage-high-cardinality-metrics-in-prometheus/
- https://alexandre-vazquez.com/grafana-alerting-vs-alert-manager/
- https://www.infoq.com/news/2024/12/prometheus-3/
- https://versionlog.com/grafana/12.4/
