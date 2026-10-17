# Research dossier — Alerting philosophy, SLOs and error budgets

Researched live on **2026-07-27/28**. Everything below is either (a) quoted from a primary source
fetched today, (b) arithmetic I derived and checked, or (c) explicitly flagged **UNVERIFIED**.

Target chapter(s): the "maturity layer" — the chapter(s) after the reader already has a running
Prometheus + Grafana lab, has instrumented `demo-app`, and can write PromQL. This dossier assumes
the lab conventions used by the other dossiers: `job="demo-app"`, `http_requests_total`,
`http_request_duration_seconds_bucket`.

---

## 0. Version pins verified today (2026-07-27/28)

| Component | Version | Date | Where verified |
|---|---|---|---|
| Prometheus | **3.13.1** | 2026-07-10 | prometheus.io/download |
| Alertmanager | **0.33.1** | 2026-07-04 | prometheus.io/download; GitHub releases (0.33.0 = 2026-06-12) |
| node_exporter | 1.12.1 | 2026-07-14 | prometheus.io/download |
| Grafana | **13.1.1** | 2026-07-21 | github.com/grafana/grafana/releases (13.0.4 / 12.4.6 / 12.3.9 same day) |
| Sloth | **v0.16.0** | 2026-04-04 | github.com/slok/sloth/releases — image `ghcr.io/slok/sloth:v0.16.0` |
| Pyrra | **v0.10.1** | 2026-06-25 | github.com/pyrra-dev/pyrra/releases |
| OpenSLO spec | `openslo/v1` stable; `openslo/v2alpha` WIP | — | OpenSLO README (repo has **no GitHub releases**) |
| Grafana SLO app | `grafana-slo-app`, Grafana **Cloud** only | — | grafana.com/docs/plugins/grafana-slo-app/ |

Feature-availability facts pinned today:

- `keep_firing_for` exists in Prometheus alerting rules and is documented in the current docs.
  (It landed in **Prometheus 2.42** — that specific version number is from search-result text,
  not a page I fetched; treat the *number* as **UNVERIFIED**, the *existence* as verified.)
- Rule **groups** accept a group-level `labels:` map (verified in the current
  `docs/configuration/recording_rules.md` and shown in the alerting-rules example).
- Rule groups accept `interval`, `limit`, `query_offset` (verified verbatim, §12.4).
- Prometheus 3 dropped Alertmanager **API v1**; effectively requires Alertmanager ≥ 0.16 and
  `api_version: v2`.
- Native histograms are **stable since Prometheus v3.8.0**, but scraping is still opt-in via
  `scrape_native_histograms: true` until v4. (See `_CONFLICTS.md` C4 — this dossier agrees with
  `pedagogy.md`.)

---

## 1. The teaching problem this chapter solves

The reader arrives having built dashboards. They are now at the exact point where every real team
goes wrong: they will write `alert: HighCPU` / `expr: cpu > 80` and then, three weeks later, mute
the channel. The chapter's job is to replace "threshold on a resource" with "budget on a promise".

Recommended narrative order (each step is a lab step, not a lecture):

1. Write a naive cause alert against the lab. Break something. Watch it page for the wrong thing.
2. Introduce symptom alerting. Rewrite the alert against `http_requests_total`.
3. Introduce SLI → SLO → error budget on that same metric.
4. Show the naive SLO alert (`error ratio > 0.001`) and demonstrate, by driving load, that it is
   unusable — it pages on a 5-second blip and never resets.
5. Introduce burn rate. One window. Show the precision/detection trade-off empirically.
6. Introduce multiwindow multi-burn-rate. Ship the final rule file.
7. Alertmanager-side hygiene: grouping, inhibition, runbooks.
8. Only then: the tooling that generates all of this for you (Sloth / Pyrra).

Doing tooling last is deliberate. A reader who meets Sloth before they can derive `14.4` by hand
will treat the number as magic.

---

## 2. Symptom-based vs cause-based alerting

### 2.1 Primary source: Rob Ewaschuk, "My Philosophy on Alerting" (2013)

This is the origin document; the SRE book chapter grew out of it. Verified quotes:

> "Pages should be urgent, important, actionable, and real."

> "Symptoms are a better way to capture more problems more comprehensively and robustly with less
> effort."

> "Err on the side of removing noisy alerts – over-monitoring is a harder problem to solve than
> under-monitoring."

> "Alerts that are less than 50% accurate are broken; even those that are false positives 10% of the
> time merit more consideration."

On mixing the two: **include cause-based information in symptom-based pages or on dashboards, but
avoid alerting directly on causes.** That sentence is the whole design rule in one line and is worth
printing as a callout.

On playbooks: effective runbooks contain a brief explanation of what the alert means and current
context — *not* an exhaustive troubleshooting flowchart. (Important nuance: the book should not tell
readers to write 20-page runbooks; that is how runbooks rot.)

The category list Ewaschuk uses to classify what a page can be about:
availability & functionality · latency · correctness (completeness, freshness, durability) ·
feature-specific issues.

### 2.2 Primary source: SRE book, "Monitoring Distributed Systems"

> "Your monitoring system should address two questions: what's broken, and why? The 'what's broken'
> indicates the symptom; the 'why' indicates a (possibly intermediate) cause."

Definitions to quote verbatim:

- **White-box monitoring** — "Monitoring based on metrics exposed by the internals of the system,
  including logs, interfaces like the Java Virtual Machine Profiling Interface, or an HTTP handler
  that emits internal statistics."
- **Black-box monitoring** — "Testing externally visible behavior as a user would see it."

Teaching point for our reader: their `/metrics` endpoint is white-box; the `blackbox_exporter` probe
they may add later is black-box. Symptom alerting is *usually* white-box-with-a-user-view (error
ratio at the edge), not necessarily black-box.

### 2.3 Primary source: prometheus.io/docs/practices/alerting

The one-sentence summary of the whole page:

> "keep alerting simple, alert on symptoms, have good consoles to allow pinpointing causes, and
> avoid having pages where there is nothing to do."

Other verified content from that page:

- Alert names use **CamelCase** by community convention.
- Online serving systems: alert on **latency and errors as high up the stack as possible**. Alert on
  user-facing latency at **only one point** in the stack, to avoid multiple pages for one problem.
- Downstream/dependency errors deserve their own alert *only* if they are severe enough to need a
  human right now.
- Offline processing: alert on **how long data takes to get through the system**, page when that
  delay would become user-visible.
- Batch jobs: page when the job hasn't completed **recently enough to cause user-visible problems** —
  ideally allowing time for two full job cycles first.
- Capacity: alert on approaching limits that need lead-time human intervention.
- **Metamonitoring**: alert on the monitoring system itself; blackbox-test the whole alerting pipeline
  end to end rather than checking components individually.

### 2.4 The short list of cause-based alerts you *should* keep

The chapter must not overclaim. There are legitimate cause alerts:

| Legit cause alert | Why it survives the rule |
|---|---|
| Disk will be full in N hours (`predict_linear`) | The symptom (outage) is *not yet happening* and is preventable. Lead-time alert, ticket not page. |
| Certificate expires in N days | Same: pure lead time. |
| Quota / capacity headroom | Human procurement lead time. |
| `up == 0` on the whole job (not one replica) | You have lost the ability to *measure* the symptom. |
| Watchdog / dead-man's-switch | Meta-monitoring; see §16.3. |

Rule of thumb to print: **if the alert has no lead time and no user impact, it is a dashboard panel,
not a page.**

### 2.5 "Page on what the user feels" — how to operationalise it

Concrete translation table for the lab:

| Tempting cause alert | Symptom alert that replaces it |
|---|---|
| `node_memory_MemAvailable_bytes < 1e9` | request error ratio / latency SLI burn rate |
| `container restarts > 3` | same |
| `pg_stat_activity_count > 90` | same, plus a *ticket* on saturation |
| `rate(http_requests_total{code="500"}[5m]) > 10` | ratio, not count — see §14 |
| `up{job="demo-app"} == 0` on one instance | keep only the all-instances-down variant |

---

## 3. The four golden signals, RED, and USE

### 3.1 Four golden signals (SRE book, verbatim)

- **Latency** — "The time it takes to service a request. It's important to distinguish between the
  latency of successful requests and the latency of failed requests."
- **Traffic** — "A measure of how much demand is being placed on your system, measured in a
  high-level system-specific metric."
- **Errors** — "The rate of requests that fail, either explicitly (e.g., HTTP 500s), implicitly (for
  example, an HTTP 200 success response, but coupled with the wrong content), or by policy."
- **Saturation** — "How 'full' your service is. A measure of your system fraction, emphasizing the
  resources that are most constrained."

The latency caveat is the one authors drop and it matters: a fast 500 makes your p99 look *better*.
The book must show splitting latency by outcome:

```promql
# p99 latency of SUCCESSFUL requests only
histogram_quantile(
  0.99,
  sum by (le) (rate(http_request_duration_seconds_bucket{job="demo-app", code!~"5.."}[5m]))
)
```

### 3.2 RED (Tom Wilkie, 2015)

Verbatim from the Grafana Labs post:

- "Rate (the number of requests per second)"
- "Errors (the number of those requests that are failing)"
- "Duration (the amount of time those requests take)"

Origin: Tom Wilkie created it in 2015 (presented at the London Prometheus meetup) because "The USE
Method doesn't really apply to services; it applies to hardware, network disks, things like this."
His framing of the relationship: "The RED Method is about caring about your users and how happy they
are," while "the USE Method is about caring about your machines."

Note for the author: the Grafana post contains **no PromQL** and **no explicit caveats** section —
do not attribute PromQL examples to it.

### 3.3 USE (Brendan Gregg)

Verbatim:

- **Utilization** — "the average time that the resource was busy servicing work"
- **Saturation** — "the degree to which the resource has extra work which it can't service, often
  queued"
- **Errors** — "the count of error events"

The method: "For every resource, check utilization, saturation, and errors." It is a **checklist you
construct from the resource list**, not from the metrics you happen to have. Gregg's own scoping:
"The USE Method identifies problems which are likely to be system bottlenecks", it "solves about 80%
of server issues", and "there are many problem types it doesn't solve, which will require other
methods."

### 3.4 When each applies — the table the book needs

| | RED | USE | Four golden signals |
|---|---|---|---|
| Unit of analysis | a **service** / request stream | a **resource** (CPU, disk, NIC, pool, queue) | a **service**, with resource awareness |
| Signals | Rate, Errors, Duration | Utilization, Saturation, Errors | Latency, Traffic, Errors, Saturation |
| Answers | "are my users happy?" | "which resource is the bottleneck?" | both, deliberately |
| Good for | HTTP/gRPC APIs, queues-as-services, service mesh | nodes, disks, connection pools, thread pools, Kafka partitions | designing an alerting policy |
| Bad for | caches, cron/batch, fan-out where one request touches 40 services | anything user-visible | nothing, but it's a menu not a recipe |
| Page on it? | **yes** (R+E+D are symptoms) | **rarely** (U+S are causes → tickets/dashboards) | page on L+T+E, ticket on S |

Mnemonic worth printing: **golden signals = RED + Saturation**. Traffic ≈ Rate, Errors = Errors,
Latency ≈ Duration. RED is the golden signals minus the one signal that is a cause rather than a
symptom. That single sentence saves a page of prose.

Explicit gaps the book should name (these are the author's synthesis, not quotes):

- Neither RED nor USE covers **correctness/quality** — a 200 with wrong data. That is Ewaschuk's
  "correctness" category and the SRE workbook's "quality" SLI.
- Neither covers **freshness** for pipelines — that is the workbook's pipeline SLI menu (§4.4).
- RED on a cache is misleading: a cache with a 0% hit rate has a perfect RED profile.

---

## 4. SLI, SLO, SLA — definitions and the SLI menu

### 4.1 Definitions (SRE Workbook, "Implementing SLOs")

- **SLI** — an indicator of the level of service provided; "the ratio of good events divided by total
  number of events."
- **SLO** — a target reliability level; what proportion of users should be satisfied.
- **SLA** — a business contract that kicks in "when your users are so unhappy you have to compensate
  them in some fashion."

The formula to print big:

```
SLI = good events / valid events × 100%
```

Note the word **valid**, not *total*. This is the detail authors get wrong. "Valid" lets you exclude
events that are out of scope: health-check traffic, load-test traffic, requests from a client that
is violating your rate limit, `499 client closed request`. The exclusion list is part of the SLI
*definition* and must be written down, because it is exactly where teams cheat later.

Three-line distinction for the reader:

- **SLI** is a number you measure.
- **SLO** is a promise you make to yourself (internal, aspirational, has teeth via the error budget).
- **SLA** is a promise you make to a customer, with money attached.

Hard rule to print: **your SLO must be strictly stricter than your SLA.** If the SLA says 99.9%, the
internal SLO is 99.95% — you want the error budget to run out before the lawyers get involved.

### 4.2 Grafana's phrasing (useful, slightly different)

From the Grafana SLO docs:

- SLI — "A metric that measures how well your service is performing, typically from the end-user
  perspective." Grafana requires the SLI query to return a **success ratio** (0.75 = 75% success).
- SLO — defined by two settings: the **SLO target** and the **SLO time window**.
- Error budget — "Derived from the SLO target and represents the amount of failure allowed by an
  SLO", calculated as `100% - SLO target`.

Watch out: **Grafana's SLI is a *success* ratio; Sloth's SLI is an *error* ratio.** Same concept,
inverted. The book must be explicit about which convention each code block uses, or readers will
copy a Sloth `error_query` into a Grafana SLO field and get a 0.1% SLO.

Convention this book should adopt: follow Prometheus/Sloth/SRE-workbook and use the **error ratio**
(`slo:sli_error:ratio_*`), because burn-rate maths is written in terms of errors. Call out Grafana's
inversion once, loudly.

### 4.3 Request-based vs window-based SLIs

This distinction is not in the workbook under those exact words in the page I fetched, so treat the
*terminology* as ecosystem-standard rather than a Google quote, but the *substance* is standard:

**Request-based (event-based / "Occurrences")**

```
SLI = good requests / valid requests over the whole period
```

- Every request counts equally. 1,000 failures during peak weigh 1,000× a single failure at 3 a.m.
- This is what all the Prometheus tooling implements natively (Sloth, Pyrra, Grafana SLO).
- Cheap: two counters.
- Weakness: a service with bursty traffic can hide a 20-minute total outage at low traffic.

**Window-based (time-slice / "Timeslices")**

```
SLI = good minutes / total minutes,
where a minute is "good" if its error ratio in that minute is under a threshold
```

- Every *minute* counts equally, regardless of traffic. A 20-minute outage at 3 a.m. costs the same
  as a 20-minute outage at noon.
- Matches how humans and SLAs talk ("43 minutes of downtime per month").
- Weakness: you must pick a second threshold (what makes a minute "bad"), and a minute with 1 error
  out of 2 requests is "bad" — brutal on low-traffic services.

OpenSLO encodes this choice as **`budgetingMethod`** with values `Occurrences`, `Timeslices`,
`RatioTimeslices` (verified in the OpenSLO README).

Window-based SLI in PromQL, for the book (author-constructed, verify in lab):

```promql
# Recording rule: 1 if this minute was "good" (error ratio <= 1%), 0 if bad.
- record: slo:sli_good_minute:demo_app_availability
  expr: |
    (
      sum(rate(http_requests_total{job="demo-app", code=~"5.."}[1m]))
      /
      sum(rate(http_requests_total{job="demo-app"}[1m]))
      <= bool 0.01
    ) or vector(1)      # no traffic in this minute => count the minute as good
```

```promql
# 30-day window-based SLI
avg_over_time(slo:sli_good_minute:demo_app_availability[30d])
```

Note the `<= bool` — **the `bool` modifier is required here**, because without it a comparison
*filters* rather than producing 0/1. This is a classic beginner trap and worth a callout box.

Recommendation for the book: teach **request-based** as the default (it is what the tooling does and
what burn rate assumes), and show window-based once, as the thing to reach for when the service has
long idle periods or the SLA is written in minutes.

### 4.4 The SLI menu by service type (SRE Workbook, verified)

| Service type | SLIs |
|---|---|
| Request-driven | Availability, Latency, Quality |
| Pipeline | Freshness, Correctness, Coverage |
| Storage | Durability |

Definitions the book should give (synthesised — the fetched page lists the categories, expanded
definitions are standard usage, mark as author's gloss):

- *Availability*: proportion of valid requests served successfully.
- *Latency*: proportion of valid requests served **faster than a threshold**. (Not "the p99" — see
  §9.)
- *Quality*: proportion of valid requests served **without degradation** (e.g. served from a fallback
  or with a feature switched off).
- *Freshness*: proportion of valid data updated more recently than a threshold.
- *Correctness*: proportion of valid records producing correct output.
- *Coverage*: proportion of valid data that was processed at all.
- *Durability*: proportion of records written that can still be read.

### 4.5 Choosing the SLO window

From the workbook page:

- **Rolling** windows (e.g. 4 weeks) are "better aligned with actual user experience".
- **Calendar** windows (month, quarter) are "better for business planning cycles".
- Recommendation: **a four-week rolling window** as the balanced general-purpose choice, supplemented
  with weekly summaries and quarterly reports.

Practical note for Prometheus users the book must add: **a 30d rolling window is expensive to
compute directly.** `rate(...[30d])` over raw data is a bad idea. The two standard escapes:

1. Recording-rule chaining — Sloth's approach: record `slo:sli_error:ratio_rate5m` continuously, then
   compute the 30d SLI as `sum_over_time(...ratio_rate5m[30d]) / count_over_time(...ratio_rate5m[30d])`
   (verified verbatim in Sloth output, §17.1). This is an *average of averages*, which is only exactly
   right when traffic is constant — flag that honestly.
2. `increase()` over the long window on the raw counters — Pyrra's approach
   (`http_requests:increase2w`) — exact, but heavier.

### 4.6 Picking the target number

Guidance to print (author's synthesis of standard SRE practice; the fetched pages do not give a
target-picking table, so do not attribute):

- Start from **measured current performance**, not from a round number. If you are at 99.4%, do not
  promise 99.99%.
- Every extra nine costs roughly 10× more engineering. 99.9% → 99.99% is not "a bit better".
- Pick the loosest target that keeps users happy. A too-strict SLO burns its budget constantly and
  the policy becomes a joke.
- 100% is never a valid SLO. If your SLO is 100% your error budget is zero and you can never ship.

Error budget in wall-clock time (arithmetic derived and checked here):

| Target | per 7 days | per 28 days | per 30 days | per 365 days |
|---|---|---|---|---|
| 99% | 100.8 min | 6 h 43 m | 7 h 12 m | 3 d 15 h 36 m |
| 99.5% | 50.4 min | 3 h 22 m | 3 h 36 m | 1 d 19 h 48 m |
| 99.9% | 10.08 min | 40.3 min | **43.2 min** | 8 h 45 m 36 s |
| 99.95% | 5.04 min | 20.2 min | 21.6 min | 4 h 22 m 48 s |
| 99.99% | 1.008 min | 4.03 min | 4.32 min | 52.6 min |
| 99.999% | 6.05 s | 24.2 s | 25.9 s | 5.26 min |

(30 days = 43,200 min; 28 days = 40,320 min; 365 days = 525,600 min.)

---

## 5. Error budgets and error budget policy

### 5.1 Definition

Error budget = `100% − SLO`, expressed either as a share of events or as wall-clock time over the
SLO window. For 99.9% over 30 days: **0.1% of requests, or 43.2 minutes**.

The conceptual flip the book must land: the error budget is not a warning line, it is a **currency**.
It is the amount of unreliability you are *entitled to spend* — on risky deploys, on experiments, on
chaos testing. A team that ends the month with 100% of its budget unspent was too conservative.

### 5.2 Error budget policy (SRE Workbook, "Example Error Budget Policy" — verified)

The policy is the part that gives SLOs teeth. Verified structure:

**SLO miss policy** — "If the service is performing at or above its SLO, then releases (including
data changes) will proceed according to the release policy." If the budget is exceeded over four
weeks: "we will halt all changes and releases other than P0 issues or security fixes until the
service is back within its SLO."

**Triggers that make reliability work mandatory:**
- Code bugs or procedural errors caused the SLO miss.
- The postmortem identifies an opportunity to soften a hard dependency.
- Miscategorised errors masked true budget consumption.

**Conditions under which feature work may continue despite a miss:**
- Company-wide networking outage.
- Another team's service caused the failure.
- Out-of-scope users (load tests, penetration testers).
- Miscategorised errors with no user impact.

**Outage policy** — a single incident consuming more than **20%** of the budget requires a postmortem
with at least one **P0** action item. A recurring class of outage consuming 20%+ in a quarter requires
P0 planning documentation addressing root causes.

**Escalation** — "In the event of a disagreement between parties regarding the calculation of the
error budget or the specific actions it defines, the issue should be escalated to the CTO to make a
decision."

**Stated purpose** — "Protect customers from repeated SLO misses" and "Provide an incentive to
balance reliability with other features", explicitly **not** punishment.

### 5.3 What to tell a solo developer

The book's reader may be a single developer with no VP to escalate to. The honest translation:

> The policy for a team of one is: *when the budget is gone, the next thing you work on is
> reliability, not features.* Write that sentence in the repo's README, with a date. That is a
> policy. The mechanism matters less than the pre-commitment.

### 5.4 Budget-remaining PromQL (for the dashboard)

```promql
# Fraction of the 30d error budget remaining (1.0 = untouched, 0 = exhausted, negative = overspent)
1 - (
  slo:sli_error:ratio_rate30d{job="demo-app"}
  /
  0.001
)
```

Sloth calls this `slo:period_error_budget_remaining:ratio` and computes it as
`1 - slo:period_burn_rate:ratio` (verified, §17.1). Render it as a Grafana **gauge with a threshold
at 0**, and a **time series** of the same expression so the reader can see the slope. The slope *is*
the burn rate — that is the visual that makes burn rate click.

---

## 6. Burn rate — the core idea

### 6.1 Definition (SRE Workbook, verbatim)

> "Burn rate is how fast, relative to the SLO, the service consumes the error budget."

Burn rate 1 = you will spend exactly your whole budget by the end of the window. Burn rate 2 = you
spend it in half the window. Burn rate 0 = flawless.

### 6.2 The three formulas

```
burn_rate            = observed_error_ratio / (1 - SLO)
time_to_exhaustion   = SLO_period / burn_rate
budget_consumed      = burn_rate × alert_window / SLO_period
```

The third is the workbook's own sentence, verbatim: "The error budget consumed by the time the alert
fires is: burn rate × alerting window size / period".

### 6.3 Burn rate table (SRE Workbook, Table 5-4, verified verbatim)

| Burn rate | Error rate for a 99.9% SLO | Time to exhaustion |
|---|---|---|
| 1 | 0.1% | 30 days |
| 2 | 0.2% | 15 days |
| 10 | 1% | 3 days |
| 1,000 | 100% | 43 minutes |

Extended (my arithmetic, 30-day period, 99.9% SLO — check before printing):

| Burn rate | Error rate | Time to exhaustion |
|---|---|---|
| 1 | 0.1% | 30 d |
| 2 | 0.2% | 15 d |
| 3 | 0.3% | 10 d |
| 6 | 0.6% | 5 d |
| 10 | 1.0% | 3 d |
| **14.4** | **1.44%** | **50 h (2 d 2 h)** |
| 100 | 10% | 7.2 h |
| 1,000 | 100% | 43.2 min |

`43.2 min` is exactly the 99.9%/30d budget — which is the sanity check that the whole table is
self-consistent: at 100% errors you burn the entire budget in exactly one budget's worth of time.

### 6.4 The non-obvious result worth teaching

Derivation (mine — please re-check, it is the intellectual centrepiece of the chapter):

Let the alert threshold be burn rate `B` over long window `w`. An incident starts at t=0 with actual
burn rate `A`. The moving average over `w` reaches the threshold when `A·t/w = B`, i.e.

```
detection_time = w × B / A
```

and the budget consumed at the moment the alert fires is

```
budget_at_detection = A × detection_time / period = (w × B) / period
```

**The budget consumed when the alert fires does not depend on how bad the incident is.** It is fixed
by your choice of `w` and `B`. That is precisely why the SRE table has a column called "error budget
consumed" — it is the design parameter, and the burn rate is derived from it, not the other way
round.

So the real design question is never "what burn rate?" It is: **"how much of my monthly budget am I
willing to spend before a human is woken up?"** Answer 2% → the maths hands you 14.4 over 1 hour.

Consequences worth stating:
- A **total outage** (A = 1000 for a 99.9% SLO) trips the 14.4/1h alert in `1h × 14.4/1000 ≈ 52 s`
  of incident time (plus rate-window and evaluation lag — realistically ~2 minutes).
- An incident exactly *at* the threshold (A = B) takes the **full long window** to detect. That is
  the price of precision, and it is why you need more than one tier.

---

## 7. The six approaches (SRE Workbook, chapter 5) — with all code verbatim

The chapter is a designed narrative: each approach fixes the previous one's flaw and introduces a new
one. Reproduce it as a build-up in the lab. Four evaluation axes the workbook uses:

- **Precision** — proportion of alerts that represent significant events.
- **Recall** — proportion of significant events that generate alerts.
- **Detection time** — latency before the alert fires.
- **Reset time** — how long the alert keeps firing after the issue is resolved.

### Approach 1 — Target error rate ≥ SLO threshold

Recording rule (verbatim):

```
record: job:slo_errors_per_request:ratio_rate10m
expr:
  sum(rate(slo_errors[10m])) by (job)
    /
  sum(rate(slo_requests[10m])) by (job)
```

Alert (verbatim):

```
- alert: HighErrorRate
  expr: job:slo_errors_per_request:ratio_rate10m{job="myjob"} >= 0.001
```

The workbook also shows the "rename an existing metric into the SLO namespace" trick (verbatim):

```
record: slo_errors
expr: http_errors
```

Verdict: good detection, terrible precision. A 10-minute window at 0.1% fires on a 0.1% blip that
costs 0.02% of the budget.

### Approach 2 — Increased alert window

```
- alert: HighErrorRate
   expr: job:slo_errors_per_request:ratio_rate36h{job="myjob"} > 0.001
```

Better specificity, awful reset time (the alert lingers for many hours after recovery), and a 36h
range query is expensive.

### Approach 3 — Incrementing alert duration

```
- alert: HighErrorRate
    expr: job:slo_errors_per_request:ratio_rate1m{job="myjob"} > 0.001
    for: 1h
```

**Explicitly not recommended** by the workbook: poor recall and inconsistent detection. This matters
for the book because `for:` is the first thing every reader reaches for. Explain *why* it fails here:
`for:` requires the condition to hold at **every single evaluation** in the interval. A 59-minute
outage with one healthy 30-second dip in the middle resets the timer and never pages. See §13.

### Approach 4 — Alert on burn rate

```
- alert: HighErrorRate
  expr: job:slo_errors_per_request:ratio_rate1h{job="myjob"} > 36 * 0.001
```

36 over 1 hour = 5% of a 30-day budget (`36 × 1/720 = 5%`). Good detection *and* precision. Remaining
flaw: reset time is still up to an hour, and one tier can't cover both "on fire" and "slow leak".

### Approach 5 — Multiple burn rate alerts

```
expr: (
        job:slo_errors_per_request:ratio_rate1h{job="myjob"} > (14.4*0.001)
      or
        job:slo_errors_per_request:ratio_rate6h{job="myjob"} > (6*0.001)
      )
severity: page

expr: job:slo_errors_per_request:ratio_rate3d{job="myjob"} > 0.001
severity: ticket
```

Better recall, but reset time is still long and you now have several parameters to reason about.

### Approach 6 — Multiwindow, multi-burn-rate alerts (**recommended**)

```
expr: (
        job:slo_errors_per_request:ratio_rate1h{job="myjob"} > (14.4*0.001)
      and
        job:slo_errors_per_request:ratio_rate5m{job="myjob"} > (14.4*0.001)
      )
    or
      (
        job:slo_errors_per_request:ratio_rate6h{job="myjob"} > (6*0.001)
      and
        job:slo_errors_per_request:ratio_rate30m{job="myjob"} > (6*0.001)
      )
severity: page

expr: (
        job:slo_errors_per_request:ratio_rate24h{job="myjob"} > (3*0.001)
      and
        job:slo_errors_per_request:ratio_rate2h{job="myjob"} > (3*0.001)
      )
    or
      (
        job:slo_errors_per_request:ratio_rate3d{job="myjob"} > 0.001
      and
        job:slo_errors_per_request:ratio_rate6h{job="myjob"} > 0.001
      )
severity: ticket
```

**The short window is what fixes reset time.** The long window decides *whether* this is worth
paging about; the short window decides *whether it is still happening*. That is the one-sentence
explanation of MWMB and the book should put it in bold.

The workbook's rule for choosing the short window: **short window = long window / 12**. Check against
the code above: 1h/12 = 5m ✔ · 6h/12 = 30m ✔ · 24h/12 = 2h ✔ · 3d/12 = 6h ✔. All four hold.

---

## 8. The burn-rate tables — and a discrepancy the author must handle

### 8.1 Table 5-6, verbatim: "Recommended time windows and burn rates for percentages of SLO budget consumed"

| SLO budget consumption | Time window | Burn rate | Notification |
|---|---|---|---|
| 2% | 1 hour | 14.4 | Page |
| 5% | 6 hours | 6 | Page |
| 10% | 3 days | 1 | Ticket |

### 8.2 Table 5-8, verbatim: "Recommended parameters for a 99.9% SLO alerting configuration"

| Severity | Long window | Short window | Burn rate | Error budget consumed |
|---|---|---|---|---|
| Page | 1 hour | 5 minutes | 14.4 | 2% |
| Page | 6 hours | 30 minutes | 6 | 5% |
| Ticket | 3 days | 6 hours | 1 | 10% |

### 8.3 The discrepancy — **do not print the 3-row table as "the" answer**

The workbook's own Approach-6 **code** has **four** tiers, not three: it includes a
`24h / 2h @ burn rate 3` tier that does not appear in Table 5-8. Every mainstream implementation
follows the **four-tier** code, not the three-row table:

- **Sloth** `google-30d.yaml` (verified byte-for-byte, §17.2): 4 tiers.
- **Pyrra**: "4 severity levels" (FastBurn, MediumBurn, SlowBurn, LongTermBurn), verified.
- **Grafana Cloud SLO**: fast-burn is a 2-clause OR (14.4 and 6); slow-burn is the other pair.

Recommendation: **teach the four-tier table**, mention that the book's Table 5-8 in the workbook
shows three, and note that the fourth tier (3 over 1d/2h) is in the workbook's own example code.

### 8.4 The canonical four-tier table for 99.9% / 30 days (derived and checked here)

| Tier | Severity | Long window | Short window | Burn rate | Budget consumed when it fires | Error ratio needed | Time to exhaustion at that rate |
|---|---|---|---|---|---|---|---|
| 1 | page | 1 h | 5 m | **14.4** | 2% | 1.44% | 50 h |
| 2 | page | 6 h | 30 m | **6** | 5% | 0.6% | 5 d |
| 3 | ticket | 1 d | 2 h | **3** | 10% | 0.3% | 10 d |
| 4 | ticket | 3 d | 6 h | **1** | 10% | 0.1% | 30 d |

Derivation of every burn rate (`burn = budget_fraction × period / long_window`, period = 720 h):

```
0.02 × 720 / 1   = 14.4
0.05 × 720 / 6   = 6
0.10 × 720 / 24  = 3
0.10 × 720 / 72  = 1
```

Show this arithmetic in the book. Once the reader can regenerate 14.4 in their head, the whole method
stops being a cargo cult. And it lets them recompute for a 28-day or 7-day window, which they will
need.

### 8.5 The same table for other windows (derived here — verify before printing)

Burn rate for a 28-day period (672 h), keeping the same budget percentages and windows:

```
0.02 × 672 / 1  = 13.44
0.05 × 672 / 6  = 5.6
0.10 × 672 / 24 = 2.8
0.10 × 672 / 72 = 0.933
```

**Important subtlety, verified:** Sloth's `google-28d.yaml` keeps `errorBudgetPercent` and the window
sizes **identical** to the 30d file, which means the effective burn rates for 28d are 13.44 / 5.6 /
2.8 / 0.933, *not* 14.4 / 6 / 3 / 1. Sloth derives the factor at generation time. An author who
hard-codes 14.4 into a 28-day SLO is slightly wrong (about 7% too permissive). Worth one sentence.

For a 7-day window (168 h) with the same percentages:

```
0.02 × 168 / 1  = 3.36
0.05 × 168 / 6  = 1.4
```

which shows *why* short SLO windows produce burn-rate thresholds close to 1 and therefore noisy
alerts — a good reason to prefer 28d/30d for the lab.

---

## 9. Latency SLIs — the part everyone gets wrong

### 9.1 Do not build a latency SLO on `histogram_quantile`

A latency SLO is **not** "p99 < 300 ms". It is "**the proportion of requests served faster than
300 ms is ≥ 99%**". Reasons:

- Quantiles cannot be averaged or aggregated across instances; a burn-rate calculation over them is
  meaningless.
- A quantile has no notion of "good events / valid events", so there is no error budget.
- Grafana Labs' own MWMB post uses the **bucket-ratio** form, not `histogram_quantile`.

Verbatim from the Grafana Labs MWMB post (their latency example, 750 ms threshold, classic
histogram):

```promql
1 - rate(request_latencies_bucket{le="750"}[1h]) / rate(request_latencies_bucket{le="+Inf"}[1h]) > (14.4 * 0.001)
```

### 9.2 The lab version (author-written, classic histogram)

```promql
# Latency SLI as an ERROR ratio: fraction of requests SLOWER than 300ms.
# NOTE the le="0.3" bucket must actually exist in your histogram's buckets.
1 - (
  sum(rate(http_request_duration_seconds_bucket{job="demo-app", le="0.3"}[5m]))
  /
  sum(rate(http_request_duration_seconds_count{job="demo-app"}[5m]))
)
```

Two traps to call out:

1. **The `le` you query must be an actual bucket boundary.** There is no interpolation. If your
   buckets are the Go client's defaults (`.005 .01 .025 .05 .1 .25 .5 1 2.5 5 10`), there is no
   `0.3` bucket. Either change the buckets to include your SLO threshold, or change the SLO
   threshold to a bucket you have. **Design your buckets around your SLO, not the other way round.**
2. **Prometheus 3 normalises `le`.** In Prometheus 3, `le` (and `quantile`) label values are
   normalised on ingestion to OpenMetrics canonical-number form. `le="1"` becomes `le="1.0"`. Any
   rule, alert or dashboard that matches `le="1"` literally **stops working** on Prometheus 3.
   Pyrra shipped explicit "`le` normalisation handling" for Prometheus 3 in v0.10.0. This is a
   high-value gotcha for a 2026 book: a reader copying a 2021 blog post will hit it.
   Safe forms: `le="1.0"`, or `le=~"1(\\.0)?"`, or avoid the literal by using
   `histogram_fraction()`.

### 9.3 The native-histogram version (Prometheus ≥ 3.8, stable)

Verified signature: `histogram_fraction(lower scalar, upper scalar, b instant-vector)` — "returns the
estimated fraction of observations between the provided lower and upper values for each classic or
native histogram contained in `b`."

```promql
# Fraction of requests SLOWER than 300ms, native histogram
1 - histogram_fraction(0, 0.3, sum(rate(http_request_duration_seconds[5m])))
```

Note `histogram_fraction` works on **classic histograms too** (per the verified description), which
makes it the cleanest way to dodge the `le` literal entirely. Worth a sidebar.

Caveats to state: native histograms are **stable since v3.8.0** but scraping is opt-in via
`scrape_native_histograms: true` until v4; the estimate is bucket-interpolated, so it is approximate
either way. Pyrra exposes `latencyNative` as a distinct indicator type for exactly this.

### 9.4 Latency SLO + availability SLO are two separate SLOs

Do not combine them into one "good request" definition unless you really mean it. A slow-but-
successful request and a fast 500 are different failures with different fixes. Two SLOs, two error
budgets, two burn-rate alert families. (You *can* define one composite SLI — "good = 2xx AND
< 300 ms" — and the workbook's "quality" SLI is in that spirit; but say explicitly which you're
doing.)

---

## 10. The low-traffic problem

This is the single biggest reason SLO alerting fails for the kind of service our reader runs, and
most books skip it entirely.

At a 99.9% SLO, the tier-1 alert threshold is an error ratio of **1.44%**. If your service handles
**10 requests per hour**, a single failed request is a 10% error ratio — seven times over the
threshold. You will page for one failure.

### 10.1 Symptoms
- Pages on single failures.
- The SLI series **disappears** entirely when there is no traffic (0/0 → no sample), so alerts
  silently stop evaluating.
- Recording-rule chains (`sum_over_time(ratio_rate5m[30d])`) get holes in them.

### 10.2 Fixes, in order of preference

**(a) Add a minimum-events guard.** Grafana SLO exposes this as **"Minimum Failures"**, described in
their docs as "applied to all your alerting time windows for the SLO, the smallest of which is 1
hour". Hand-rolled:

```promql
(
  job:slo_errors_per_request:ratio_rate1h{job="demo-app"} > (14.4 * 0.001)
  and
  job:slo_errors_per_request:ratio_rate5m{job="demo-app"} > (14.4 * 0.001)
  and
  # at least 3 failed requests in the last hour, not just a high ratio
  sum(increase(http_requests_total{job="demo-app", code=~"5.."}[1h])) >= 3
)
```

**(b) Widen the SLO window** (30d instead of 7d) and/or **loosen the target** (99% instead of 99.9%)
so the thresholds are reachable only by real problems.

**(c) Aggregate.** One SLO across the whole service rather than per-endpoint or per-instance.

**(d) Synthetic traffic.** A blackbox probe every 15s gives you a floor of ~240 events/hour and turns
"no traffic" into "measurable availability". This is a legitimate and under-taught technique.

**(e) Switch to a window-based SLI** (§4.3), which is less sensitive to volume.

### 10.3 Make the SLI survive zero errors

`sum(rate(errors)) / sum(rate(total))` yields **nothing** when there are no errors, because the
numerator series doesn't exist. The result is a hole in the recording rule, not a zero. The idiom
(same trick the `promql.md` dossier documents at line 576):

```promql
(
  sum by (job) (rate(http_requests_total{job="demo-app", code=~"5.."}[5m]))
  or
  0 * sum by (job) (rate(http_requests_total{job="demo-app"}[5m]))
)
/
sum by (job) (rate(http_requests_total{job="demo-app"}[5m]))
```

The `or 0 * <total>` supplies a zero-valued series **with the right labels** when the error series is
absent. Without it, your 30-day SLI will be computed over a series full of gaps and will read better
than reality.

### 10.4 Alert when the SLI itself vanishes

```yaml
- alert: DemoAppSLIMissing
  expr: absent(job:slo_errors_per_request:ratio_rate5m{job="demo-app"})
  for: 10m
  labels:
    severity: page
  annotations:
    summary: "The availability SLI for demo-app has no data — the SLO alerts are blind."
    runbook_url: "https://runbooks.example.com/demo-app/sli-missing"
```

Verified signatures: `absent(v instant-vector)` — "returns an empty vector if the vector passed to it
has any elements ... and a 1-element vector with the value 1 if the vector passed to it has no
elements"; `absent_over_time(v range-vector)` — same, over a range.

Pyrra has this built in as an **Absent** severity/alert, and v0.8.1's release note says absent alerts
now wait **10m instead of 2m** depending on the objective's target and window. Use 10m in the book.

---

## 11. Alert on rates, not raw counts

Three separate arguments, all worth making:

1. **Counters only go up.** `http_requests_total{code="500"} > 100` fires forever once the process
   has served 100 errors since boot, and resets when the process restarts. It is not a signal, it is
   an odometer.
2. **Counts don't scale.** `rate(errors[5m]) > 10` is meaningful at 100 rps and absurd at 10,000 rps
   (0.1% error rate) and at 1 rps (impossible). Ratios are dimensionless and portable across
   environments — your staging alert threshold works in production unchanged.
3. **Rates handle restarts.** Verified: `rate()` — "calculates the per-second average rate of increase
   of the time series in the range vector"; `increase()` — "Breaks in monotonicity (such as counter
   resets due to target restarts) are automatically adjusted for." Raw counter comparisons do not.

Progression to show in the lab:

```promql
http_requests_total{job="demo-app", code=~"5.."}                       # ✗ odometer
increase(http_requests_total{job="demo-app", code=~"5.."}[5m]) > 100   # ✗ scale-dependent
rate(http_requests_total{job="demo-app", code=~"5.."}[5m]) > 2         # ✗ still scale-dependent
sum(rate(...{code=~"5.."}[5m])) / sum(rate(...[5m])) > 0.0144          # ✓ ratio
```

The one legitimate use of an absolute count in an alert is the **minimum-events guard** in §10.2(a) —
and there it is a guard, not the condition.

Also worth a line: aggregate **before** dividing, and always scope with `{job="..."}`. A bare
`sum(rate(http_requests_total[5m]))` sums every service in the org.

---

## 12. Prometheus alerting rules — the exact syntax

### 12.1 Canonical example (verbatim from current `docs/configuration/alerting_rules.md`)

```yaml
groups:
- name: example
  labels:
    team: myteam
  rules:
  - alert: HighRequestLatency
    expr: job:request_latency_seconds:mean5m{job="myjob"} > 0.5
    for: 10m
    keep_firing_for: 5m
    labels:
      severity: page
    annotations:
      summary: High request latency
```

### 12.2 `for` — verbatim

> "The optional `for` clause causes Prometheus to wait for a certain duration between first
> encountering a new expression output vector element and counting an alert as firing for this
> element. In this case, Prometheus will check that the alert continues to be active during each
> evaluation for 10 minutes before firing the alert. Elements that are active, but not firing yet,
> are in the pending state. Alerting rules without the `for` clause will become active on the first
> evaluation."

### 12.3 `keep_firing_for` — verbatim

> "There is also an optional `keep_firing_for` clause that tells Prometheus to keep this alert firing
> for the specified duration after the firing condition was last met. This can be used to prevent
> situations such as flapping alerts, false resolutions due to lack of data loss, etc. Alerting rules
> without the `keep_firing_for` clause will deactivate on the first evaluation where the condition is
> not met (assuming any optional `for` duration described above has been satisfied)."

Behaviour detail (from PromLabs training material, secondary source): if the condition becomes true
again before `keep_firing_for` elapses, the alert **stays firing** and does **not** have to serve the
`for` duration again.

### 12.4 Rule group fields (verbatim from `docs/configuration/recording_rules.md`)

```yaml
# The name of the group. Must be unique within a file.
name: <string>

# How often rules in the group are evaluated.
[ interval: <duration> | default = global.evaluation_interval ]

# Limit the number of alerts an alerting rule and series a recording
# rule can produce. 0 is no limit.
[ limit: <int> | default = 0 ]

# Offset the rule evaluation timestamp of this particular group by the specified duration into the past.
[ query_offset: <duration> | default = global.rule_query_offset ]

# Labels to add or overwrite before storing the result for its rules.
# Labels defined in <rule> will override the key if it has a collision.
labels:
  [ <labelname>: <labelvalue> ]

rules:
  [ - <rule> ... ]
```

Naming rules, verbatim: "The names of recording rules must be valid metric names. The names of
alerting rules must be valid label values."

`query_offset` is genuinely useful for SLO rules when using remote write — it delays evaluation so
late-arriving samples are included. Mention it once.

### 12.5 Templating (verbatim)

> "The `$labels` variable holds the label key/value pairs of an alert instance. The configured
> external labels can be accessed via the `$externalLabels` variable. The `$value` variable holds the
> evaluated value of an alert instance."

```
# To insert a firing element's label values:
{{ $labels.<labelname> }}
# To insert the numeric expression value of the firing element:
{{ $value }}
```

Practical formatting note for the book: raw `{{ $value }}` prints `0.014400000000000001`. Use
`{{ printf "%.2f" $value }}` or `{{ $value | humanizePercentage }}`. kube-prometheus's node-exporter
rules use `{{ printf "%.2f" $value }}` (verified in that manifest).

### 12.6 The `ALERTS` series (verbatim)

> "For pending and firing alerts, Prometheus also stores synthetic time series of the form
> `ALERTS{alertname="<alert name>", alertstate="<pending or firing>", <additional alert labels>}`.
> The sample value is set to `1` as long as the alert is in the indicated active (pending or firing)
> state, and the series is marked stale when this is no longer the case."

This is the raw material for measuring alert fatigue (§15) and for inhibition tricks (§16.4).

### 12.7 What Prometheus alerting is *not* (verbatim)

> "Prometheus's alerting rules are good at figuring what is broken *right now*, but they are not a
> fully-fledged notification solution. Another layer is needed to add summarization, notification
> rate limiting, silencing and alert dependencies on top of the simple alert definitions."

---

## 13. `for` vs flapping vs `keep_firing_for`

### 13.1 What `for` actually does — and its failure mode

`for: 10m` requires the expression to return the element at **every evaluation** for 10 minutes. One
single evaluation where the element is missing resets the pending timer to zero. This is why the SRE
workbook rejects Approach 3: a 59-minute outage with a single 30-second recovery in the middle never
pages.

Draw this as a timeline in the book. It is the clearest way to show why `for` is a *debounce*, not a
*sustained-badness detector*.

### 13.2 `for` and MWMB

The short window in MWMB **is** the anti-flap mechanism, so a long `for` is redundant and harmful
(it re-adds detection latency you just spent effort removing). Practice varies:

- **SRE Workbook**: no `for` on the MWMB examples at all.
- **Pyrra**: `for: 2m` on burn-rate alerts (verified in a community example).
- **Sloth**: no `for` on generated burn-rate alerts (verified in the generated output, §17.1).

Book's recommendation: **`for: 2m` or nothing**, and never more than ~5m on a burn-rate alert.
Explain that the short window already guarantees the badness is current.

### 13.3 When `keep_firing_for` is the right tool

`keep_firing_for` solves the *opposite* problem to `for`: an alert that resolves and re-fires
repeatedly, generating a resolved-notification / firing-notification storm.

Use it when:
- The underlying signal is intrinsically bursty (a scrape that intermittently fails, a job that
  runs every 5 minutes).
- You want a grace period so Alertmanager doesn't send `[RESOLVED]` and then `[FIRING]` 60 seconds
  later.
- The metric can genuinely disappear (target down) and you don't want that read as "recovered".

Do not use it as a substitute for fixing a noisy expression.

```yaml
- alert: DemoAppErrorBudgetBurnFast
  expr: ...
  for: 2m
  keep_firing_for: 15m      # don't declare victory the instant the 5m window dips
  labels:
    severity: page
```

### 13.4 Prometheus flags governing `for` state across restarts

(From search-result text quoting `prometheus --help`; the flag names are standard but I did not fetch
a docs page containing them — mark the *default values* as **UNVERIFIED**.)

- `--rules.alert.for-outage-tolerance` (default 1h) — max Prometheus outage tolerated when restoring
  the `for` state of an alert after restart.
- `--rules.alert.for-grace-period` (default 10m) — minimum duration between alert restart and the
  restored `for` state; only applies to alerts whose `for` exceeds the grace period.
- `--rules.alert.resend-delay` (default 1m) — minimum time before resending an alert to Alertmanager.

Teaching point: Prometheus persists pending-alert state (the `ALERTS_FOR_STATE` series) so a restart
doesn't reset every `for` timer to zero — but only within `for-outage-tolerance`. A reader whose lab
restarts constantly during a chapter will see `for` behave oddly; this is why.

### 13.5 Grafana-managed alert rules — the equivalents

Grafana 13's own alerting (not Prometheus rules) has:
- **Pending period** — the `for` equivalent.
- **Keep firing for** — "the minimum amount of time that an alert remains firing after the breached
  threshold expression no longer returns any results", which puts the alert in a **Recovering**
  state; documented explicitly as a way "to reduce noise from flapping alerts".
- **February 2026**: pending periods were added to the **NoData** and **Error** alert states, "to
  help reduce noise by preventing notifications triggering after first evaluation".

Book position: for a Prometheus-centric book, write the rules as **Prometheus rule files**
(portable, version-controllable, testable with `promtool`) and show Grafana-managed rules as the
alternative for people who want UI-driven alerting. Do not teach both as equals — pick rule files as
the spine.

---

## 14. Copy-pasteable rule files for the lab

All of the following is author-written for `job="demo-app"` with a **99.9% availability SLO over 30
days**. It uses the SRE-workbook metric naming (`job:slo_errors_per_request:ratio_rateXX`) so it
lines up with the quoted material. **Run `promtool check rules` and the unit tests in §18 before
printing.**

### 14.1 `rules/slo-demo-app-sli.yml` — recording rules

```yaml
groups:
  - name: slo_demo_app_availability_sli
    interval: 30s
    rules:
      # --- 5 minutes ---
      - record: job:slo_errors_per_request:ratio_rate5m
        expr: |
          (
            sum by (job) (rate(http_requests_total{job="demo-app", code=~"5.."}[5m]))
            or
            0 * sum by (job) (rate(http_requests_total{job="demo-app"}[5m]))
          )
          /
          sum by (job) (rate(http_requests_total{job="demo-app"}[5m]))

      # --- 30 minutes ---
      - record: job:slo_errors_per_request:ratio_rate30m
        expr: |
          (
            sum by (job) (rate(http_requests_total{job="demo-app", code=~"5.."}[30m]))
            or
            0 * sum by (job) (rate(http_requests_total{job="demo-app"}[30m]))
          )
          /
          sum by (job) (rate(http_requests_total{job="demo-app"}[30m]))

      # --- 1 hour ---
      - record: job:slo_errors_per_request:ratio_rate1h
        expr: |
          (
            sum by (job) (rate(http_requests_total{job="demo-app", code=~"5.."}[1h]))
            or
            0 * sum by (job) (rate(http_requests_total{job="demo-app"}[1h]))
          )
          /
          sum by (job) (rate(http_requests_total{job="demo-app"}[1h]))

      # --- 2 hours ---
      - record: job:slo_errors_per_request:ratio_rate2h
        expr: |
          (
            sum by (job) (rate(http_requests_total{job="demo-app", code=~"5.."}[2h]))
            or
            0 * sum by (job) (rate(http_requests_total{job="demo-app"}[2h]))
          )
          /
          sum by (job) (rate(http_requests_total{job="demo-app"}[2h]))

      # --- 6 hours ---
      - record: job:slo_errors_per_request:ratio_rate6h
        expr: |
          (
            sum by (job) (rate(http_requests_total{job="demo-app", code=~"5.."}[6h]))
            or
            0 * sum by (job) (rate(http_requests_total{job="demo-app"}[6h]))
          )
          /
          sum by (job) (rate(http_requests_total{job="demo-app"}[6h]))

      # --- 1 day ---
      - record: job:slo_errors_per_request:ratio_rate1d
        expr: |
          (
            sum by (job) (rate(http_requests_total{job="demo-app", code=~"5.."}[1d]))
            or
            0 * sum by (job) (rate(http_requests_total{job="demo-app"}[1d]))
          )
          /
          sum by (job) (rate(http_requests_total{job="demo-app"}[1d]))

      # --- 3 days ---
      - record: job:slo_errors_per_request:ratio_rate3d
        expr: |
          (
            sum by (job) (rate(http_requests_total{job="demo-app", code=~"5.."}[3d]))
            or
            0 * sum by (job) (rate(http_requests_total{job="demo-app"}[3d]))
          )
          /
          sum by (job) (rate(http_requests_total{job="demo-app"}[3d]))

  - name: slo_demo_app_availability_meta
    interval: 1m
    rules:
      # 30-day SLI, computed by averaging the 5m SLI (cheap; exact only under steady traffic)
      - record: job:slo_errors_per_request:ratio_rate30d
        expr: |
          avg_over_time(job:slo_errors_per_request:ratio_rate5m{job="demo-app"}[30d])

      - record: job:slo_objective:ratio
        expr: vector(0.999)
        labels:
          job: demo-app

      - record: job:slo_error_budget:ratio
        expr: vector(0.001)
        labels:
          job: demo-app

      # 0 = budget untouched, 1 = budget exactly spent, >1 = overspent
      - record: job:slo_period_burn_rate:ratio
        expr: |
          job:slo_errors_per_request:ratio_rate30d{job="demo-app"} / 0.001

      - record: job:slo_period_error_budget_remaining:ratio
        expr: |
          1 - job:slo_period_burn_rate:ratio{job="demo-app"}
```

Notes for the author:

- `interval: 30s` on the SLI group keeps short-window alerts responsive. Do not go below the scrape
  interval.
- The `avg_over_time(...[30d])` shortcut mirrors Sloth's approach and is the pragmatic choice for a
  lab; state the "average of averages" caveat honestly (it is exact only if request volume is
  constant). The exact alternative is
  `sum(increase(errors[30d])) / sum(increase(total[30d]))`, which is heavier but correct — worth a
  footnote.
- `vector(0.999)` produces a series with **no labels**, so the group/rule-level `labels:` are what
  attach `job="demo-app"`. Without them the metadata rules won't join to anything.

### 14.2 `rules/slo-demo-app-alerts.yml` — the four MWMB tiers

```yaml
groups:
  - name: slo_demo_app_availability_alerts
    interval: 30s
    labels:
      slo: demo-app-availability
    rules:
      # ---------- PAGE: fast burn ----------
      # 14.4x over 1h (2% of a 30d budget) OR 6x over 6h (5% of budget)
      - alert: DemoAppErrorBudgetBurnFast
        expr: |
          (
              job:slo_errors_per_request:ratio_rate1h{job="demo-app"}  > (14.4 * 0.001)
            and
              job:slo_errors_per_request:ratio_rate5m{job="demo-app"}  > (14.4 * 0.001)
          )
          or
          (
              job:slo_errors_per_request:ratio_rate6h{job="demo-app"}  > (6 * 0.001)
            and
              job:slo_errors_per_request:ratio_rate30m{job="demo-app"} > (6 * 0.001)
          )
        for: 2m
        keep_firing_for: 10m
        labels:
          severity: critical
          slo: demo-app-availability
          long_window: 1h
        annotations:
          summary: >-
            demo-app is burning its 30-day error budget fast
            ({{ $value | humanizePercentage }} of requests failing).
          description: >-
            The availability SLI for demo-app is above 14.4x (or 6x) the 99.9% error budget
            over both a long and a short window. At this rate the entire 30-day budget
            (43.2 minutes) is gone in about 2 days. Users are seeing 5xx responses now.
          runbook_url: https://runbooks.example.com/demo-app/error-budget-burn-fast
          dashboard_url: https://grafana.example.com/d/demo-app-slo

      # ---------- TICKET: slow burn ----------
      # 3x over 1d (10% of budget) OR 1x over 3d (10% of budget)
      - alert: DemoAppErrorBudgetBurnSlow
        expr: |
          (
              job:slo_errors_per_request:ratio_rate1d{job="demo-app"}  > (3 * 0.001)
            and
              job:slo_errors_per_request:ratio_rate2h{job="demo-app"}  > (3 * 0.001)
          )
          or
          (
              job:slo_errors_per_request:ratio_rate3d{job="demo-app"}  > (1 * 0.001)
            and
              job:slo_errors_per_request:ratio_rate6h{job="demo-app"}  > (1 * 0.001)
          )
        for: 15m
        labels:
          severity: warning
          slo: demo-app-availability
        annotations:
          summary: >-
            demo-app is slowly leaking its 30-day error budget
            ({{ $value | humanizePercentage }} of requests failing).
          description: >-
            Sustained low-level failures. Not an outage — do not wake anyone up.
            Open a ticket: at this rate the 30-day error budget will be exhausted
            before the window closes.
          runbook_url: https://runbooks.example.com/demo-app/error-budget-burn-slow

      # ---------- Meta: the SLI itself went away ----------
      - alert: DemoAppSLIMissing
        expr: absent(job:slo_errors_per_request:ratio_rate5m{job="demo-app"})
        for: 10m
        labels:
          severity: critical
          slo: demo-app-availability
        annotations:
          summary: "demo-app availability SLI has no data — SLO alerting is blind."
          description: >-
            The recording rule job:slo_errors_per_request:ratio_rate5m produced no series for
            10 minutes. Either demo-app is not being scraped, or it has served no requests at all.
            Either way the burn-rate alerts above cannot fire.
          runbook_url: https://runbooks.example.com/demo-app/sli-missing
```

### 14.3 The vector-matching gotcha that will bite the author

`A and B` requires **matching label sets**. The default matching (no `on`/`ignoring`) compares all
labels **except `__name__`** — which is why `ratio_rate1h ... and ratio_rate5m ...` works at all
despite the two sides having different metric names. (Same reason
`node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes` works.)

But it means:

- If the two sides carry **any** differing label, the `and` yields nothing and the alert silently
  never fires. This is a *silent* failure — the scariest kind.
- Sloth's generated rules attach a `sloth_window` label (`5m`, `1h`, …) to every SLI recording rule.
  Because that label differs between the two sides, Sloth must strip it, which is exactly why every
  generated clause looks like:

  ```
  max(slo:sli_error:ratio_rate5m{...} > (14.4 * 0.05)) without (sloth_window)
  ```

  The `max(...) without (sloth_window)` both removes the offending label **and** drops `__name__`
  via aggregation. The book should show this and explain it — readers who copy Sloth output and then
  hand-edit it will otherwise break it.
- Our lab rules deliberately do **not** put a window label on the recorded series; the window lives
  in the metric name. Simpler, and it makes `and` work with no ceremony.

Debugging recipe to print: if a multi-window alert never fires, run each half of the `and` separately
in the expression browser and compare the label sets character by character.

### 14.4 Comparison operators and `bool`

Verified from the operators doc: without `bool`, comparison operators **filter** and the left-hand
metric name is kept; with `bool` they return 0/1 and "the metric name is always dropped". Relevant
in two places in this chapter: the window-based SLI (§4.3) needs `bool`; the burn-rate alerts must
**not** use it (they rely on filtering).

---

## 15. Alert fatigue — and how to measure it

### 15.1 The numbers from Google (verified)

From the SRE book, "Being On-Call":

- "We strive to invest at least 50% of SRE time into engineering: of the remainder, no more than 25%
  can be spent on-call".
- "The maximum number of incidents per day is 2 per 12-hour on-call shift."
- Target: **paging events per shift < 2**, with "a median of zero incidents per day" and a "very
  flat" distribution.
- An incident costs roughly **6 hours** on average once you count root-cause analysis, remediation,
  postmortem and the follow-up bug fix. That is the number that makes the ceiling of two obvious:
  two incidents ≈ 12 hours ≈ one whole shift.
- Response-time expectation: within minutes — typically 5 minutes for user-facing systems, 30
  minutes for less time-sensitive ones.

From Ewaschuk: "Alerts that are less than 50% accurate are broken."

### 15.2 The metrics to track (with real PromQL)

The book should give the reader a **meta-dashboard**: alerts about alerts. All of these are
author-written; verify in the lab.

**Pages per week, by alert name** — the headline number:

```promql
sum by (alertname) (
  count_over_time(
    (ALERTS{alertstate="firing", severity="critical"} == 1)[7d:1m]
  )
) / 60
```

(The `[7d:1m]` subquery counts firing minutes; dividing by 60 gives firing hours. For *distinct
pages* rather than firing-time, count transitions instead — see below.)

**Distinct firings (transitions into firing) in the last 7 days:**

```promql
sum by (alertname) (
  resets(
    (ALERTS{alertstate="firing"} == bool 1)[7d:1m]
  )
)
```

Honest caveat: counting alert *episodes* from the `ALERTS` series is fiddly because the series goes
stale rather than to zero. **The reliable source is Alertmanager**, not Prometheus. Mark the above as
"good enough for the lab" and point at Alertmanager's own metrics:

```promql
# notifications actually sent, by integration
sum by (integration) (rate(alertmanager_notifications_total[7d])) * 86400 * 7

# notification failures — if this is non-zero your paging is broken
sum by (integration) (rate(alertmanager_notifications_failed_total[7d]))

# how many alerts Alertmanager currently holds
alertmanager_alerts

# silences currently active — a rising number is a fatigue smell
alertmanager_silences{state="active"}
```

(Metric names `alertmanager_notifications_total`, `alertmanager_notifications_failed_total`,
`alertmanager_alerts`, `alertmanager_silences` are standard Alertmanager instrumentation but I did
not fetch a page listing them today — **mark UNVERIFIED** and confirm against a live
`/metrics` in the lab, which is trivially easy and makes a nice exercise.)

### 15.3 The qualitative metrics that actually matter

Numbers a dashboard can't give you, worth a boxed list:

1. **Actionability rate** — what fraction of pages resulted in a human doing something other than
   acknowledging? Track it manually for a month. Anything under ~80% is a broken alert set.
2. **Repeat offenders** — the top 3 alerts by count almost always account for most of the volume.
   Fix or delete them; the distribution is never flat.
3. **Silences that never expire** — a permanent silence is a deleted alert with extra steps. Audit
   them. Set an expiry on every silence.
4. **Out-of-hours pages** — the ratio of 22:00–08:00 pages to daytime pages.
5. **Time-to-acknowledge trending up** — people have stopped believing the pager.

The single most effective intervention, and it should be stated bluntly: **delete alerts.** An alert
that has fired 40 times and been actioned twice is worse than no alert, because it trains the team
to ignore the channel that also carries the real ones.

### 15.4 The review ritual to prescribe

A monthly (or per-sprint) 30-minute "alert review":
- List every alert that fired.
- For each: was it actionable? Did the runbook help?
- Every non-actionable alert gets one of three verdicts: **fix the expression**, **downgrade to
  ticket**, or **delete**. "Leave it, we'll look next month" is not a verdict.

---

## 16. Alertmanager-side noise control

Prometheus decides *what is broken*; Alertmanager decides *who hears about it and how often*. Half
of alert fatigue is an Alertmanager configuration problem.

### 16.1 Route fields (verbatim skeleton from the current Alertmanager docs)

```yaml
[ receiver: <string> ]
[ group_by: '[' <labelname>, ... ']' ]
[ continue: <boolean> | default = false ]

match:
  [ <labelname>: <labelvalue>, ... ]
match_re:
  [ <labelname>: <regex>, ... ]
matchers:
  [ - <matcher> ... ]
labels:
  [ <labelname>: <tmpl_string>, ... ]

[ group_wait: <duration> | default = 30s ]
[ group_interval: <duration> | default = 5m ]
[ repeat_interval: <duration> | default = 4h ]

mute_time_intervals:
  [ - <string> ...]
active_time_intervals:
  [ - <string> ...]

routes:
  [ - <route> ... ]
```

Defaults to memorise (verified): `group_wait: 30s`, `group_interval: 5m`, `repeat_interval: 4h`.

What each one actually does, in plain English for a beginner:
- **`group_by`** — which labels define "the same problem". `['alertname', 'job']` is a sane default;
  `group_by: ['...']` disables grouping entirely (rarely what you want).
- **`group_wait`** — how long to hold the first notification of a new group, hoping siblings arrive
  so they can be batched. 30s is right; going to 0 turns one incident into ten notifications.
- **`group_interval`** — minimum gap before sending an *updated* notification for a group that has
  changed (a new alert joined).
- **`repeat_interval`** — how long before re-nagging about an unchanged, still-firing group. 4h is
  the default; for a page, 1h–4h; for a ticket, 12h–24h.

Note: `match` / `match_re` are the legacy forms; **`matchers:`** is the current one. A 2026 book
should use `matchers:` exclusively and mention the old syntax only to say "you will see this in old
blog posts."

### 16.2 Inhibition (verbatim skeleton)

```yaml
[ name: <string> ]

target_match:
  [ <labelname>: <labelvalue>, ... ]
target_match_re:
  [ <labelname>: <regex>, ... ]
target_matchers:
  [ - <matcher> ... ]

source_match:
  [ <labelname>: <labelvalue>, ... ]
source_match_re:
  [ <labelname>: <regex>, ... ]
source_matchers:
  [ - <matcher> ... ]

[ equal: '[' <labelname>, ... ']' ]
```

The canonical rule every book should ship — critical suppresses warning for the same thing:

```yaml
inhibit_rules:
  - source_matchers: [ 'severity="critical"' ]
    target_matchers: [ 'severity="warning"' ]
    equal: ['alertname', 'job']
```

For our SLO set: the fast-burn page should inhibit the slow-burn ticket, because a fast burn is
always also a slow burn.

```yaml
  - source_matchers: [ 'alertname="DemoAppErrorBudgetBurnFast"' ]
    target_matchers: [ 'alertname="DemoAppErrorBudgetBurnSlow"' ]
    equal: ['slo']
```

Gotcha to state: `equal` labels must be present **and identical** on both alerts. If `slo` is missing
from one of them, the inhibition silently does nothing.

### 16.3 The dead-man's switch (verbatim from kube-prometheus)

This is the metamonitoring pattern the Prometheus docs ask for, and it is a great lab exercise:

```yaml
- alert: Watchdog
  annotations:
    description: |
      This is an alert meant to ensure that the entire alerting pipeline is functional.
      This alert is always firing, therefore it should always be firing in Alertmanager
      and always fire against a receiver. There are integrations with various notification
      mechanisms that send a notification when this alert is not firing. For example the
      "DeadMansSnitch" integration in PagerDuty.
    runbook_url: https://runbooks.prometheus-operator.dev/runbooks/general/watchdog
    summary: An alert that should always be firing to certify that Alertmanager is working properly.
  expr: vector(1)
  labels:
    severity: none
```

`expr: vector(1)` — an alert that is *always* firing. You route it to something that pages you when
it **stops** arriving. This inverts the failure mode: a broken monitoring pipeline becomes loud
instead of silent. Excellent teaching moment.

### 16.4 The `InfoInhibitor` pattern (verbatim from kube-prometheus)

An advanced but instructive use of the `ALERTS` series:

```yaml
- alert: InfoInhibitor
  annotations:
    description: |
      This is an alert that is used to inhibit info alerts.
      By themselves, the info-level alerts are sometimes very noisy, but they are relevant when combined with
      other alerts.
      This alert fires whenever there's a severity="info" alert, and stops firing when another alert with a
      severity of 'warning' or 'critical' starts firing on the same namespace.
      This alert should be routed to a null receiver and configured to inhibit alerts with severity="info".
    runbook_url: https://runbooks.prometheus-operator.dev/runbooks/general/infoinhibitor
    summary: Info-level alert inhibition.
  expr: group by (namespace) (ALERTS{severity = "info"} == 1) unless on (namespace) group by (namespace) (ALERTS{alertname != "InfoInhibitor", alertstate = "firing", severity =~ "warning|critical"} == 1)
  labels:
    severity: none
```

(Kubernetes-flavoured, so probably belongs in the optional K8s chapter or a sidebar — but the
*technique*, alerting on `ALERTS`, is general.)

### 16.5 Time intervals — mute the ticket tier out of hours

```yaml
time_intervals:
  - name: out-of-hours
    time_intervals:
      - times:
          - start_time: '18:00'
            end_time: '24:00'
          - start_time: '00:00'
            end_time: '09:00'
        weekdays: ['monday:friday']
        location: 'Europe/Berlin'
      - weekdays: ['saturday', 'sunday']
        location: 'Europe/Berlin'
```

Then on the ticket route: `mute_time_intervals: ['out-of-hours']`. This is the mechanism that makes
"page vs ticket" real rather than aspirational, and it directly implements the SRE workbook's
severity split. Verified field names: `time_intervals`, `mute_time_intervals`,
`active_time_intervals`, and the spec keys `times`, `weekdays`, `days_of_month`, `months`, `years`,
`location`.

### 16.6 Alertmanager 0.33 notes (verified from the 0.33.0 release page, 2026-06-12)

- **Breaking**: `--enable-feature=auto-gomaxprocs` removed (deprecated since 0.32); the
  `alertmanager_marked_alerts` metric was removed.
- New: silence **annotations** in the UI; `/api/v2/receivers`, `/api/v2/alerts`,
  `/api/v2/alerts/groups` now include receiver labels and `receiver_matchers` filtering; a structured
  **event recorder** behind `--enable-feature=event-recorder` (file / webhook / Kafka output);
  `group-key-in-metrics` feature flag; a `now` template function.
- Docs improvements specifically about **UTF-8 matchers and YAML quoting** — relevant because
  Prometheus 3 allows UTF-8 label names, and matcher strings then need careful quoting.
- 0.33.1 (2026-07-04) is a bugfix release (webhook `notification_reason` docs; silences snapshot
  missing legacy matchers field).

---

## 17. Tooling landscape

### 17.1 Sloth — `github.com/slok/sloth`, v0.16.0 (2026-04-04)

**What it is:** a generator. You write a short SLO spec; it emits a Prometheus rules file (or a
`PrometheusRule` CRD). It is *not* a runtime component — you can run it once in CI and commit the
output. That makes it the ideal tool for this book: the reader can read the generated rules and
recognise everything in them.

Modes: CLI (`sloth generate`), Kubernetes controller with CRDs, and (since v0.15.0) a Go library
(`github.com/slok/sloth/pkg/lib`). v0.16.0 added a **new UI** with service listing, SLO details and
budget-burn charts, plus K8s transformer plugins. Image: `ghcr.io/slok/sloth:v0.16.0`.
Supports OpenSLO v1alpha as an input format.

**Input spec (verbatim, `examples/getting-started.yml`):**

```yaml
version: "prometheus/v1"
service: "myservice"
labels:
  owner: "myteam"
  repo: "myorg/myservice"
  tier: "2"
slos:
  # We allow failing (5xx and 429) 1 request every 1000 requests (99.9%).
  - name: "requests-availability"
    objective: 99.9
    description: "Common SLO based on availability for HTTP request responses."
    sli:
      events:
        error_query: sum(rate(http_request_duration_seconds_count{job="myservice",code=~"(5..|429)"}[{{.window}}]))
        total_query: sum(rate(http_request_duration_seconds_count{job="myservice"}[{{.window}}]))
    alerting:
      name: MyServiceHighErrorRate
      labels:
        category: "availability"
      annotations:
        # Overwrite default Sloth SLO alert summmary on ticket and page alerts.
        summary: "High error rate on 'myservice' requests responses"
      page_alert:
        labels:
          severity: pageteam
          routing_key: myteam
      ticket_alert:
        labels:
          severity: "slack"
          slack_channel: "#alerts-myteam"
```

Note the `{{.window}}` template placeholder — Sloth substitutes each window into your query. Also note
`objective: 99.9` is a **percentage**, not a ratio, and the SLI is an **error** query.

There is also a `raw:` SLI form with `error_ratio_query` (verbatim, from the raw-SLI example):

```yaml
    sli:
      raw:
        error_ratio_query: |
          1 - ( 
            sum(sum_over_time(unifipoller_client_satisfaction_ratio[{{.window}}])) 
            / 
            sum(count_over_time(unifipoller_client_satisfaction_ratio[{{.window}}])) 
          )
```

**Generated output — the exact rule names Sloth produces** (verified verbatim from the raw-SLI
example, 95% objective, 30d):

Group 1, `sloth-slo-sli-recordings-<service>-<slo>`:
`slo:sli_error:ratio_rate5m`, `…rate30m`, `…rate1h`, `…rate2h`, `…rate6h`, `…rate1d`, `…rate3d`,
`…rate30d`. Each carries labels `sloth_id`, `sloth_service`, `sloth_slo`, `sloth_window` plus your
own spec labels.

The 30d rule is the recording-rule-chaining trick, verbatim:

```yaml
  - record: slo:sli_error:ratio_rate30d
    expr: |
      sum_over_time(slo:sli_error:ratio_rate5m{sloth_id="...", sloth_service="...", sloth_slo="..."}[30d])
      / ignoring (sloth_window)
      count_over_time(slo:sli_error:ratio_rate5m{sloth_id="...", sloth_service="...", sloth_slo="..."}[30d])
    labels:
      ...
      sloth_window: 30d
```

Group 2, `sloth-slo-meta-recordings-<service>-<slo>`:
`slo:objective:ratio` (`vector(0.95)`), `slo:error_budget:ratio` (`vector(1-0.95)`),
`slo:time_period:days` (`vector(30)`), `slo:current_burn_rate:ratio`, `slo:period_burn_rate:ratio`,
`slo:period_error_budget_remaining:ratio`, and `sloth_slo_info` (`vector(1)` with
`sloth_objective`, `sloth_spec`, `sloth_version`, `sloth_mode` labels).

`slo:current_burn_rate:ratio` verbatim:

```yaml
    expr: |
      slo:sli_error:ratio_rate5m{...}
      / on(sloth_id, sloth_slo, sloth_service) group_left
      slo:error_budget:ratio{...}
```

Group 3, `sloth-slo-alerts-<service>-<slo>` — two alerts with the **same alert name**, distinguished
by `sloth_severity: page` / `sloth_severity: ticket`. Page alert verbatim (95% objective, so the
error budget is `0.05`):

```yaml
  - alert: WifiClientSatisfaction
    expr: |
      ( 
          max(slo:sli_error:ratio_rate5m{...} > (14.4 * 0.05)) without (sloth_window)
          and
          max(slo:sli_error:ratio_rate1h{...} > (14.4 * 0.05)) without (sloth_window)
      )
      or
      ( 
          max(slo:sli_error:ratio_rate30m{...} > (6 * 0.05)) without (sloth_window)
          and
          max(slo:sli_error:ratio_rate6h{...} > (6 * 0.05)) without (sloth_window)
      )
    labels:
      severity: home
      sloth_severity: page
    annotations:
      summary: '{{$labels.sloth_service}} {{$labels.sloth_slo}} SLO error budget burn rate is over expected.'
      title: (page) {{$labels.sloth_service}} {{$labels.sloth_slo}} SLO error budget burn rate is too fast.
```

Ticket alert uses `(3 * 0.05)` on `rate2h`/`rate1d` and `(1 * 0.05)` on `rate6h`/`rate3d`.

Three things this output teaches better than prose:
- Sloth generates **no `for:`** on burn-rate alerts.
- Sloth's default annotations do **not** include `runbook_url` — you must add it yourself via
  `alerting.annotations`. Say this; readers assume the generator does everything.
- The `max(...) without (sloth_window)` wrapper exists purely to make the label sets match (§14.3).

### 17.2 Sloth's window catalogue (verified byte-for-byte)

`internal/alert/windows/google-30d.yaml`:

```yaml
# Common and safe month windows.
#
# Numbers obtained from https://sre.google/workbook/alerting-on-slos/#recommended_parameters_for_an_slo_based_a.
apiVersion: "sloth.slok.dev/v1"
kind: "AlertWindows"
spec:
  sloPeriod: 30d
  page:
    quick:
      errorBudgetPercent: 2
      shortWindow: 5m
      longWindow: 1h
    slow:
      errorBudgetPercent: 5
      shortWindow: 30m
      longWindow: 6h
  ticket:
    quick:
      errorBudgetPercent: 10
      shortWindow: 2h
      longWindow: 1d
    slow:
      errorBudgetPercent: 10
      shortWindow: 6h
      longWindow: 3d
```

`internal/alert/windows/google-28d.yaml` is byte-identical except `sloPeriod: 28d` and the header
comment ("Common and safe 4 weeks windows."). Both cite the SRE workbook URL directly.

The docs page also shows a **custom** 30d catalogue with tighter windows, which is a nice
"you can tune this" example:

```yaml
apiVersion: sloth.slok.dev/v1
kind: AlertWindows
spec:
  sloPeriod: 30d
  page:
    quick:
      errorBudgetPercent: 1
      shortWindow: 2m
      longWindow: 30m
    slow:
      errorBudgetPercent: 2
      shortWindow: 15m
      longWindow: 3h
  ticket:
    quick:
      errorBudgetPercent: 5
      shortWindow: 1h
      longWindow: 12h
    slow:
      errorBudgetPercent: 5
      shortWindow: 3h
      longWindow: 36h
```

Key API insight for the book: **the catalogue is expressed in `errorBudgetPercent` + window sizes,
and the burn-rate factor is derived.** That is the right mental model, and it matches §6.4.

### 17.3 Pyrra — `github.com/pyrra-dev/pyrra`, v0.10.1 (2026-06-25)

**What it is:** a generator *and* a UI/API. It runs as a service (filesystem mode, Kubernetes mode,
or against a Prometheus/Thanos API), gives you a web UI of every SLO with burn-down charts, and
writes the recording + alerting rules for you.

Spec (verbatim from README):

```yaml
apiVersion: pyrra.dev/v1alpha1
kind: ServiceLevelObjective
metadata:
  name: pyrra-api-errors
  namespace: monitoring
  labels:
    prometheus: k8s
    role: alert-rules
    pyrra.dev/team: operations
spec:
  target: "99"
  window: 2w
  description: Pyrra's API requests and response errors over time grouped by route.
  indicator:
    ratio:
      errors:
        metric: http_requests_total{job="pyrra",code=~"5.."}
      total:
        metric: http_requests_total{job="pyrra"}
      grouping:
        - route
```

Generated recording rules for that 2-week window (verbatim from README):

```
http_requests:increase2w
http_requests:burnrate3m
http_requests:burnrate15m
http_requests:burnrate30m
http_requests:burnrate1h
http_requests:burnrate3h
http_requests:burnrate12h
http_requests:burnrate2d
```

Key differences from Sloth, worth a comparison box:

| | Sloth | Pyrra |
|---|---|---|
| Runtime component | no (generator) | yes (UI + API) |
| Windows | fixed catalogue (30d/28d + custom) | **scaled to your `window:`** (2w → 3m…2d) |
| SLI naming | `slo:sli_error:ratio_rateXX` (uniform) | `<metric>:burnrateXX` (per-metric) |
| Long-window SLI | `sum_over_time`/`count_over_time` of the 5m rule | `increase()` over the raw counter |
| Indicator types | events / raw / SLI plugins | **ratio, latency, latencyNative, boolGauge** |
| Alert name | your `alerting.name` | `ErrorBudgetBurn` |
| Severities | page, ticket | **Absent, FastBurn, MediumBurn, SlowBurn, LongTermBurn** |
| `for:` | none | `for: 2m` (community example) |
| Absent alerting | via a contrib plugin | built in |

Example generated alert (from a community write-up, **secondary source — verify before printing**):

```yaml
- alert: ErrorBudgetBurn
  expr: http_server_requests_seconds:burnrate5m{slo="rest-api-latency"} > (14 * (1-0.99)) and http_server_requests_seconds:burnrate1h{slo="rest-api-latency"} > (14 * (1-0.99))
  for: 2m
  labels:
    exhaustion: 2d
    long: 1h
    severity: critical
    short: 5m
    slo: rest-api-latency
```

The `exhaustion` label is a lovely idea worth stealing: the alert tells the responder *how long until
the budget is gone*, right in the label set.

v0.10.0 (2026-04-30) additions worth knowing: a **Performance Mode** using subqueries to cut rule
evaluation cost; configurable **alert severity overrides** for multi-burn-rate alerts; Prometheus v3
histogram support with `le` normalisation handling; and `pyrra_url` annotations that link an alert
straight to its SLO page. v0.10.1 fixed latency-total double counting.

### 17.4 OpenSLO — the vendor-neutral spec

`apiVersion: openslo/v1` is stable; `openslo/v2alpha` is work in progress. **The repository has no
GitHub releases**, which is a useful signal about how to describe it: it is a *specification*, not a
product, and its value is portability, not tooling.

SLO object (verbatim from the README):

```yaml
apiVersion: openslo/v1
kind: SLO
metadata:
  name: foo-slo
  displayName: Foo SLO
spec:
  service: foo
  indicator:
    metadata:
      name: foo-error
      displayName: Foo Error
    spec:
      ratioMetric:
        counter: true
        good:
          metricSource:
            metricSourceRef: datadog-datasource
            type: Datadog
            spec:
              query: sum:trace.http.request.hits.by_http_status{http.status_code:200}.as_count()
        total:
          metricSource:
            metricSourceRef: datadog-datasource
            type: Datadog
            spec:
              query: sum:trace.http.request.hits.by_http_status{*}.as_count()
  objectives:
    - displayName: Foo Total Errors
      target: 0.98
```

Key fields (verified): `timeWindow` takes exactly one item, rolling or calendar-aligned, in
duration-shorthand (`1d`, `4w`, `1M`); **`budgetingMethod`** is required and is one of `Occurrences`,
`Timeslices`, `RatioTimeslices`; `objectives[].target` is 0.0–1.0 (or `targetPercent` 0–100); exactly
one of `indicator` / `indicatorRef`.

Alerting objects (verbatim):

```yaml
apiVersion: openslo/v1
kind: AlertPolicy
metadata:
  name: AlertPolicy
  displayName: Alert Policy
spec:
  description: Alert policy for cpu usage breaches, notifies on-call devops via email
  alertWhenBreaching: true
  alertWhenResolved: false
  conditions:
    - conditionRef: cpu-usage-breach
  notificationTargets:
    - targetRef: on-call-devops-mail-notification
```

```yaml
apiVersion: openslo/v1
kind: AlertCondition
metadata:
  name: cpu-usage-breach
  displayName: CPU usage breach
spec:
  description: If the CPU usage is too high for given period then it should alert
  severity: page
  condition:
    kind: burnrate
    op: lte
    threshold: 2
    lookbackWindow: 1h
    alertAfter: 5m
```

Note `condition.kind: burnrate` — the spec has burn rate as a first-class concept.

Honest framing for the book: OpenSLO is worth **one page**, as "the YAML you'd write if you didn't
want to marry a vendor". Sloth consumes OpenSLO (v1alpha) as an input format, which is the concrete
reason a Prometheus reader might care. Do not oversell adoption — the README makes no adoption
claims and there are no releases to point at.

### 17.5 Grafana SLO (`grafana-slo-app`)

**Grafana Cloud only.** The docs live under both `grafana.com/docs/grafana-cloud/alerting-and-irm/slo/`
and `grafana.com/docs/plugins/grafana-slo-app/`, and nothing in either indicates OSS/self-hosted
availability. State this plainly — it is the single most likely thing for a reader to waste an
afternoon on.

Verified facts:
- SLI query must return a **success ratio** (0.75 = 75% success). Opposite convention to Sloth.
- Each SLO creates **10–12 Prometheus recording rules**; "each recording rule creates one or more
  series depending on the provided grouping labels".
- SLO alert rules and recording rules are stored in a Grafana Mimir namespace called
  **`grafana_slo_<STACK ID>`**.
- SLO window: minimum **7 days**, default **28 days**, custom day counts allowed.
- **Fast-burn** alert fires when: burn rate ≥ **14.4×** the error budget averaged over **both the
  last 5 minutes and the last hour**, OR ≥ **6×** over **both the last 30 minutes and the last 6
  hours**. Same numbers as the SRE workbook.
- **Slow-burn** alerts trigger "when the error budget would be consumed over hours or days".
  (The exact slow-burn window pairs are **not stated** on the pages I fetched — presumably the
  1d/2h @3 and 3d/6h @1 tiers, but **mark UNVERIFIED**; do not print specific slow-burn numbers.)
- **"Minimum Failures"** advanced setting exists for low-traffic services: "applied to all your
  alerting time windows for the SLO, the smallest of which is 1 hour".
- Provisioning via **Terraform** is documented.
- The SLO dashboard shows a **Burn Rate Alerts** panel with fast/slow state, SLI value, remaining
  error budget and historical trends.

Grafana's own MWMB blog post gives the availability query verbatim, useful as a second worked
example alongside the workbook's:

```promql
(
  rate(request_count{status="5xx"}[1h]) / rate(request_count[1h]) > (14.4 * 0.001)
  and
  rate(request_count{status="5xx"}[5m]) / rate(request_count[5m]) > (14.4 * 0.001)
)
or
(
  rate(request_count{status="5xx"}[6h]) / rate(request_count[6h]) > (6 * 0.001)
  and
  rate(request_count{status="5xx"}[30m]) / rate(request_count[30m]) > (6 * 0.001)
)
```

(Note: that snippet omits `sum()`, so it would alert per-series. Fine for a blog, wrong for a book —
if you reproduce it, reproduce it *and* fix it, and say why.)

### 17.6 Others to name-check in one sentence each

- **Google `slo-generator`** (github.com/google/slo-generator) — Python, multi-backend, oriented at
  Cloud Monitoring. **UNVERIFIED** maintenance status as of 2026; check before recommending.
- **`prometheus-operator` / kube-prometheus** — ships hundreds of alerts with `runbook_url`
  annotations and the `Watchdog`/`InfoInhibitor` patterns. Excellent reading material even for
  non-Kubernetes readers.
- **Nobl9, Datadog SLOs, New Relic SLM, Dynatrace, Honeycomb SLOs, Sysdig** — commercial. Mention only
  to say the concepts transfer; the burn-rate table is the same everywhere.

### 17.7 Recommendation for the book's lab

Teach the **hand-written rules first** (§14), then show **Sloth** as the way to stop hand-writing
them. Sloth fits the lab best because:
- It is a one-shot CLI — no extra long-running container in `docker-compose.yml` unless you want the
  UI.
- Its output is plain Prometheus rules the reader can read and diff against what they wrote by hand.
  That diff is the lesson.
- It has a browser-based live editor (live.sloth.dev) for readers who don't want to install anything.

Mention Pyrra as the "I want a UI and a burn-down chart" option, in one paragraph, with a screenshot.

---

## 18. Testing alerting rules (`promtool test rules`)

This is under-taught and belongs in the book: **alerting rules are code and must have tests.** A
burn-rate alert that never fires because of a label mismatch (§14.3) is invisible until the outage.

Command: `./promtool test rules test.yml` (or several files).

Test file structure (verified): top-level `rule_files`, `evaluation_interval` (default 1m),
`fuzzy_compare`, `group_eval_order`, `tests`. Each test has `name`, `interval`, `start_timestamp`,
`input_series`, `alert_rule_test`, `promql_expr_test`, `external_labels`, `external_url`.

Series expanding notation (verified):
- `1+2x3` → 1, 3, 5, 7
- `10-5x2` → 10, 5, 0
- `5x3` → 5, 5, 5, 5
- `_` → missing sample
- `stale` → stale sample
- native histograms: `{{schema:1 sum:-0.3 count:3.1 z_bucket:7.1 buckets:[5.1 10 7]}}`

Complete worked example (verbatim from the docs):

```yaml
rule_files:
    - alerts.yml

evaluation_interval: 1m

tests:
    - interval: 1m
      input_series:
          - series: 'up{job="prometheus", instance="localhost:9090"}'
            values: '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0'
          - series: 'up{job="node_exporter", instance="localhost:9100"}'
            values: '1+0x6 0 0 0 0 0 0 0 0'
          - series: 'go_goroutines{job="prometheus", instance="localhost:9090"}'
            values: '10+10x2 30+20x5'
          - series: 'go_goroutines{job="node_exporter", instance="localhost:9100"}'
            values: '10+10x7 10+30x4'

      alert_rule_test:
          - eval_time: 10m
            alertname: InstanceDown
            exp_alerts:
                - exp_labels:
                      severity: page
                      instance: localhost:9090
                      job: prometheus
                  exp_annotations:
                      summary: "Instance localhost:9090 down"
                      description: "localhost:9090 of job prometheus has been down for more than 5 minutes."

      promql_expr_test:
          - expr: go_goroutines > 5
            eval_time: 4m
            exp_samples:
                - labels: 'go_goroutines{job="prometheus",instance="localhost:9090"}'
                  value: 50
```

Also verified: inside tests `time()` returns 0 (Unix epoch) by default; `eval_time` is a duration
from `start_timestamp`, which may be a Unix timestamp or RFC3339 string.

**Caveat the author must handle honestly:** unit-testing a 3-day-window burn-rate alert requires
generating 3 days of synthetic samples, which is slow and awkward. Practical advice for the book:

- Unit-test the **fast tiers** (5m/1h) fully — that is where the paging risk is.
- Unit-test the **recording rules** and the **label sets** rather than the long windows.
- Add a cheap regression test that simply asserts the alert fires *at all* given a sustained high
  error ratio, which catches the silent `and`-mismatch bug.
- Also run `promtool check rules` in CI — it catches YAML and PromQL syntax errors.

A worked test for the lab's fast-burn alert (author-written; the exact `input_series` needs tuning
against the real rule set — **verify before printing**):

```yaml
rule_files:
  - ../rules/slo-demo-app-sli.yml
  - ../rules/slo-demo-app-alerts.yml

evaluation_interval: 30s

tests:
  - interval: 30s
    name: "fast burn fires on a sustained 10% error rate"
    input_series:
      # 100 rps total, 10 rps of 5xx  => 10% error ratio, burn rate 100
      - series: 'http_requests_total{job="demo-app", code="200"}'
        values: '0+2700x400'     # 90 rps * 30s = 2700 per interval
      - series: 'http_requests_total{job="demo-app", code="500"}'
        values: '0+300x400'      # 10 rps * 30s = 300 per interval
    alert_rule_test:
      - eval_time: 70m
        alertname: DemoAppErrorBudgetBurnFast
        exp_alerts:
          - exp_labels:
              severity: critical
              slo: demo-app-availability
              long_window: 1h
              job: demo-app
```

---

## 19. Runbook links as a required annotation

### 19.1 The rule

**Every paging alert must carry a `runbook_url` annotation.** Make it a lint rule, not a convention.
This is defensible from primary sources: the Prometheus docs describe `annotations` as the place "to
store longer additional information such as alert descriptions or **runbook links**"; Grafana
documents `runbook_url` as "The runbook page to guide operators managing a potential incident";
kube-prometheus puts `runbook_url` on essentially every shipped alert.

### 19.2 The convention to teach

Annotation set for every alert:

| Annotation | Content |
|---|---|
| `summary` | One line, present tense, what a human would say out loud. Fits in a phone notification. |
| `description` | 2–4 sentences: what is happening, what the user impact is, what the numbers mean. |
| `runbook_url` | Stable URL. One page per alert. |
| `dashboard_url` | Deep link to the relevant Grafana dashboard (optionally with `var-job=` and a time range). |

Grafana's own reserved annotations: `summary`, `description`, `runbook_url`, `__dashboardUid__`,
`__panelId__` (the last two link an alert to a dashboard panel). Reserved labels: `alertname`,
`grafana_folder`; anything prefixed `grafana_` is reserved.

### 19.3 The kube-prometheus pattern (verified)

URL shape: `https://runbooks.prometheus-operator.dev/runbooks/<component>/<lowercased-alertname>`,
e.g. `.../runbooks/kubernetes/kubepodcrashlooping`, `.../runbooks/general/watchdog`. Deriving the
URL mechanically from the alert name is the trick that makes 100% coverage achievable — the book
should recommend it:

```yaml
annotations:
  runbook_url: "https://runbooks.example.com/alerts/{{ $labels.alertname | toLower }}"
```

(Template-function availability for `toLower` in Prometheus annotation templates: **UNVERIFIED** —
Prometheus uses Go text/template plus its own function set; verify `toLower` exists before printing,
or use a literal URL.)

### 19.4 What a runbook must contain

Per Ewaschuk: a brief explanation of what the alert means and current context, **not** a decision
tree. Concretely, five headings:

1. **What this alert means** — one paragraph, in terms of user impact.
2. **How to confirm it's real** — the two or three queries/dashboards to look at first.
3. **Immediate mitigations** — roll back, scale up, shed load, flip the feature flag. In order.
4. **Common causes** — a short list from past incidents, with links to postmortems.
5. **Escalation** — who to wake next, and when.

A missing runbook should be treated as a bug against the alert. If nobody can write the five
headings, the alert is not actionable and should be deleted — which is the *real* value of the rule.

---

## 20. Common mistakes a textbook must not make

A checklist for the manuscript's own review pass.

1. **Printing the 3-row Table 5-8 as the whole method.** The workbook's own code has four tiers, and
   every implementation uses four. (§8.3)
2. **Getting the burn rate for a 28-day window wrong.** 14.4 is a *30-day* number. 28 days gives
   13.44. (§8.5)
3. **Saying "error budget = downtime".** It is a share of *events* for a request-based SLI. It maps
   to minutes only under a window-based SLI or under an assumption of constant traffic.
4. **`histogram_quantile` in a latency SLO.** (§9.1)
5. **`le="1"` in a Prometheus 3 query.** Values are normalised to `le="1.0"`. (§9.2)
6. **Forgetting that `sum(errors)/sum(total)` disappears when there are no errors.** (§10.3)
7. **Not mentioning the low-traffic problem at all.** For our reader's side project it is *the*
   dominant failure mode. (§10)
8. **`and` between recording rules that carry differing labels.** Silent non-firing. (§14.3)
9. **Confusing Grafana's success-ratio SLI with Sloth's error-ratio SLI.** (§4.2)
10. **Claiming Grafana SLO works in OSS Grafana.** It does not. (§17.5)
11. **Using `for:` as a sustained-badness detector.** It's a debounce; a single good evaluation resets
    it. (§13.1)
12. **Confusing `for` and `keep_firing_for`.** Opposite ends of the alert lifecycle. (§13)
13. **Alerting on a raw counter.** (§11)
14. **Writing `severity: page` as a label and never wiring it to a route.** Severity labels do
    nothing until Alertmanager routes on them; show the route in the same chapter.
15. **Presenting SLOs as a Kubernetes thing.** All of Sloth, Pyrra and the SRE method work fine
     against plain Prometheus in `docker-compose`. Keep K8s out of this chapter entirely.
16. **Treating burn rate as an arbitrary tunable.** It is derived from the budget percentage you are
     willing to spend before paging. (§6.4)
17. **Copying `severity: page`/`ticket` from Google without saying what "ticket" means for a team of
     three.** Translate: page = wake up; ticket = it's in the backlog with a deadline.
18. **Recommending 99.99% for a hobby service.** 4.32 minutes per month, including your own deploys.

---

## 21. Suggested chapter structure and lab progression

**Chapter A — "Alerts that don't cry wolf" (philosophy + first symptom alert)**
1. Break the lab deliberately; write the naive CPU alert; watch it be useless.
2. Symptoms vs causes; the four golden signals; RED vs USE (§2, §3).
3. Rewrite as a symptom alert on `http_requests_total`. Route it. See it in Alertmanager.
4. Annotations, runbook_url, and the runbook template (§19).
5. Grouping, inhibition, `repeat_interval` — the noise controls (§16).
6. Lab exit state: one symptom alert, one route, one runbook file in the repo.

**Chapter B — "SLOs and error budgets"**
1. SLI / SLO / SLA; the good/valid formula (§4).
2. Pick the lab's SLO: 99.9% availability over 30 days. Compute 43.2 minutes together.
3. Write the SLI recording rules (§14.1). Build the error-budget-remaining panel (§5.4).
4. Request-based vs window-based; why we chose request-based (§4.3).
5. Latency SLO as a second SLI (§9).
6. Error budget policy — write the one-sentence version into the repo (§5.3).

**Chapter C — "Alerting on your SLO" (burn rate)**
1. Naive SLO alert → fails. Approaches 1–4 from the workbook, run against the lab (§7).
2. Burn rate, the three formulas, the derivation of 14.4 (§6).
3. MWMB: the four tiers, page vs ticket (§8).
4. Ship `slo-demo-app-alerts.yml` (§14.2). Drive load, watch tier 1 fire in ~2 minutes.
5. `for`, `keep_firing_for`, flapping (§13).
6. The low-traffic problem and the minimum-events guard (§10).
7. Unit-test the alerts with `promtool` (§18).
8. Measure your own alert volume (§15).
9. Generate the same rules with Sloth; diff against what you wrote (§17.1).

That diff at the end of Chapter C is the payoff of the whole arc, and it is a genuinely satisfying
way to end the maturity layer.

---

## 22. UNVERIFIED — do not print as fact without re-checking

1. **`keep_firing_for` was added in Prometheus 2.42.** Existence verified; the version number came
   from search-result text, not a fetched changelog.
2. **`--rules.alert.for-outage-tolerance` = 1h, `--rules.alert.for-grace-period` = 10m,
   `--rules.alert.resend-delay` = 1m.** Flag names are standard; defaults are from search-result
   text quoting `--help`, not a fetched docs page.
3. **Alertmanager metric names** `alertmanager_notifications_total`,
   `alertmanager_notifications_failed_total`, `alertmanager_alerts`, `alertmanager_silences`. Not
   verified against a fetched page today; trivially checkable against the lab's `/metrics`.
4. **Grafana SLO's slow-burn window pairs and burn-rate factors.** Fast-burn (14.4 @ 5m/1h, 6 @
   30m/6h) is verified; slow-burn numbers are not. Do not print specific slow-burn values.
5. **Pyrra's exact generated alert YAML.** The `ErrorBudgetBurn` example with `exhaustion`/`long`/
   `short` labels is from a community write-up, not from Pyrra's own docs. The *severity names*
   (Absent, FastBurn, MediumBurn, SlowBurn, LongTermBurn) and the *recording rule names* are from the
   README / pkg.go.dev and are solid.
6. **`toLower` availability in Prometheus annotation templates.**
7. **Google `slo-generator` maintenance status in 2026.**
8. **All author-written PromQL and YAML in §4.3, §9.2, §10.2, §10.3, §14, §15.2, §18** — written from
   verified primitives but not executed. Every block must be run through
   `promtool check rules` / `promtool test rules` and the live lab before it is printed.
9. **The 28d burn-rate figures (13.44 / 5.6 / 2.8 / 0.933)** are my arithmetic from Sloth's verified
   28d catalogue, not values Sloth prints. Confirm by running `sloth generate` against a 28d SLO.
10. **The detection-time / budget-at-detection derivation in §6.4** is mine. It is standard and the
    algebra is simple, but it is not quoted from the workbook — have a second reader check it.
11. **The claim that default vector matching excludes `__name__`.** This is certainly true in
    practice (it is why `a_bytes / b_bytes` works, and why the workbook's `and` examples work at
    all), but the operators documentation does not state it explicitly. Verify empirically in the lab
    and phrase carefully.

---

## 23. Sources

Primary, fetched 2026-07-27/28:

- Google SRE Workbook, "Alerting on SLOs" — https://sre.google/workbook/alerting-on-slos/
- Google SRE Workbook, "Implementing SLOs" — https://sre.google/workbook/implementing-slos/
- Google SRE Workbook, "Example Error Budget Policy" — https://sre.google/workbook/error-budget-policy/
- Google SRE Book, "Monitoring Distributed Systems" — https://sre.google/sre-book/monitoring-distributed-systems/
- Google SRE Book, "Being On-Call" — https://sre.google/sre-book/being-on-call/
- Rob Ewaschuk, "My Philosophy on Alerting" — https://gist.github.com/msgodf/86a3fc7fcd3ce663ff37
  (also https://robewaschuk.tumblr.com/post/48822960728/my-philosophy-on-alerting)
- Prometheus — Alerting rules — https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/
  and https://raw.githubusercontent.com/prometheus/prometheus/main/docs/configuration/alerting_rules.md
- Prometheus — Recording rules — https://raw.githubusercontent.com/prometheus/prometheus/main/docs/configuration/recording_rules.md
- Prometheus — Alerting practices — https://prometheus.io/docs/practices/alerting/
- Prometheus — Unit testing rules — https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/
- Prometheus — Query functions — https://prometheus.io/docs/prometheus/latest/querying/functions/
- Prometheus — Operators — https://raw.githubusercontent.com/prometheus/prometheus/main/docs/querying/operators.md
- Prometheus — Native histograms spec — https://prometheus.io/docs/specs/native_histograms/
- Prometheus — Download (version table) — https://prometheus.io/download/
- Prometheus 3.0 migration guide — https://prometheus.io/docs/prometheus/latest/migration/
- Alertmanager configuration — https://raw.githubusercontent.com/prometheus/alertmanager/main/docs/configuration.md
- Alertmanager v0.33.0 release — https://github.com/prometheus/alertmanager/releases/tag/v0.33.0
- kube-prometheus `nodeExporter-prometheusRule.yaml` — https://raw.githubusercontent.com/prometheus-operator/kube-prometheus/main/manifests/nodeExporter-prometheusRule.yaml
- kube-prometheus `kubePrometheus-prometheusRule.yaml` (Watchdog, InfoInhibitor) — https://raw.githubusercontent.com/prometheus-operator/kube-prometheus/main/manifests/kubePrometheus-prometheusRule.yaml
- kube-prometheus runbooks — https://runbooks.prometheus-operator.dev/
- Sloth docs — https://sloth.dev/ , https://sloth.dev/usage/slo-period-windows/ ,
  https://sloth.dev/examples/default/raw-sli/ , https://sloth.dev/slo-plugins/core/alert_rules_v1/
- Sloth `examples/getting-started.yml` — https://raw.githubusercontent.com/slok/sloth/main/examples/getting-started.yml
- Sloth `google-30d.yaml` — https://raw.githubusercontent.com/slok/sloth/main/internal/alert/windows/google-30d.yaml
- Sloth `google-28d.yaml` — https://raw.githubusercontent.com/slok/sloth/main/internal/alert/windows/google-28d.yaml
- Sloth releases — https://github.com/slok/sloth/releases
- Pyrra README — https://raw.githubusercontent.com/pyrra-dev/pyrra/main/README.md
- Pyrra site — https://pyrra.dev/
- Pyrra releases — https://github.com/pyrra-dev/pyrra/releases
- Pyrra `slo` package — https://pkg.go.dev/github.com/pyrra-dev/pyrra/slo
- OpenSLO README — https://raw.githubusercontent.com/OpenSLO/OpenSLO/main/README.md
- Grafana SLO (Cloud) — https://grafana.com/docs/grafana-cloud/alerting-and-irm/slo/introduction/ ,
  .../slo/create/ , .../slo/best-practices/ , .../slo/dashboard/
- Grafana SLO plugin docs — https://grafana.com/docs/plugins/grafana-slo-app/latest/introduction/
- Grafana Labs, "How to implement multi-window, multi-burn-rate alerts with Grafana Cloud" —
  https://grafana.com/blog/how-to-implement-multi-window-multi-burn-rate-alerts-with-grafana-cloud/
- Grafana — Labels and annotations — https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rules/annotation-label/
- Grafana releases — https://github.com/grafana/grafana/releases
- Grafana Labs, "The RED Method: How to Instrument Your Services" — https://grafana.com/blog/the-red-method-how-to-instrument-your-services/
- Brendan Gregg, "The USE Method" — https://www.brendangregg.com/usemethod.html

Secondary (used only where flagged):

- PromLabs training, "The keep_firing_for field" — https://training.promlabs.com/training/alerting-with-prometheus/understanding-alerting-rules/the-keep-firing-for-field/
- tb.lx insider, "The SLO Toolkit: Setup & Alerting with Pyrra" — https://medium.com/tblx-insider/third-part-the-slo-toolkit-c4207e689804
- incident.io, "SRE alerting best practices" — https://incident.io/blog/sre-alerting-best-practices
- Rootly, "Reducing Alert Fatigue: Practical Steps for SRE Teams" — https://rootly.com/sre/reducing-alert-fatigue-practical-steps-sre-teams
