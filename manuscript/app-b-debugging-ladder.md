# Appendix B — The No-Data Debugging Ladder

An empty graph has about a dozen causes and one appearance. Prometheus does not
say which cause it was, so the cure is a fixed order of checks, cheapest first.
Chapter 1, "Ten Minutes to Your First Metric" teaches rungs 1 to 4; Chapter 2,
"What's Actually on the Wire" adds the query-side rungs. Here is the whole
ladder, for use during an incident.

Three rules make it work. Climb in order, because rung 1 costs a glance and rung
12 costs a comparison of label sets. Change one thing at a time, because a
rewritten expression that starts working teaches you nothing. Peel back rather
than retype: strip to a bare metric name, confirm it returns rows, then rebuild.

## The signature table

Find your symptom in the middle column, then read the matching rung below it.

| Rung | What you see | What it actually is |
|---|---|---|
| 1 | The job is not on `/targets` | Config, not query |
| 2 | `up` is `0`, or has no row | Failed scrape, or none attempted |
| 3 | A message in the Error column | Wrong address, or no `Content-Type` |
| 4 | Empty table, no error | The name is not what you typed |
| 5 | Name exists, query still empty | The fault is in the matchers |
| 6 | Dropping one matcher fixes it | Anchored regex, or empty-string match |
| 7 | Spelling is right, still nothing | That combination never occurred |
| 8 | Selector works, `rate()` does not | The function, not the selector |
| 9 | Empty at `[10s]`, fine at `[2m]` | Fewer than two samples in range |
| 10 | Empty in Grafana, fine in the UI | Step, Min step or Max data points |
| 11 | Series vanished, target is fine | Staleness, or the target's own clock |
| 12 | Each half works, together nothing | Vector matching dropped everything |

## The twelve rungs

### Rung 1 — does the target exist at all?

**Tell.** The job is not listed on <http://localhost:9090/targets>, or it is
listed with no targets under it.

**Test.** Open that page. When the targets come from service discovery rather
than a static list, open the Service Discovery page too: a job reading
`active 0 dropped 13` means every candidate was relabeled away.

**Fix.** The problem is in `lab/prometheus/prometheus.yml`, not in your query.
Run `make check`, then `make reload`. Chapter 12, "`prometheus.yml` in Full:
Service Discovery and Relabeling" has the `keep` rule that eats candidates.

### Rung 2 — is `up` 1 for it?

**Tell.** `up{job="snip-api"}` returns `0`, or returns no row at all.

**Test.** Run `up`. A healthy lab answers with one row per target: 12 scrape
jobs and 14 targets, because `blackbox` contributes three.

**Fix.** A `0` means Prometheus tried and failed, which is rung 3. A missing row
means Prometheus never tried, which sends you back to rung 1. Those are
different problems and the distinction is worth ten minutes.

### Rung 3 — did the scrape fail, and why?

**Tell.** The target is **DOWN** and the Error column on `/targets` names a
reason.

**Test.** Read the reason. `dial tcp 127.0.0.1:8000: connect: connection
refused` means you wrote `localhost` where the container network needs a service
name. One reason is subtle enough to have its own section in Chapter 5, "Your
First Counter: Instrumenting Code You Own":

```text
non-compliant scrape target sending blank Content-Type and no
fallback_scrape_protocol specified for target
```

**Fix.** Prometheus 3 does not fall back to the text format when the header is
missing, and it discards the whole response rather than ingesting part of it.
Fix the handler, or set `fallback_scrape_protocol` on the job and know that you
have made a permanent statement about somebody else's code.

### Rung 4 — does the metric name exist?

**Tell.** An empty table with no error and no red text anywhere.

**Test.** Open the Metrics Explorer beside the expression input and look, rather
than trusting your memory. For a fuzzy search, `{__name__=~"snip_.*"}` lists
every series whose name starts that way.

**Fix.** Typos are the largest single cause of an empty result. The second
largest is asking for a family name that is not a series name:
`snip_http_request_duration_seconds` stores its series as `_bucket`, `_sum` and
`_count`, and the bare family name matches none of them. If the name does exist
and the result is still empty, the fault is in your labels — carry on to rung 5.

### Rung 5 — does the bare selector return anything?

**Tell.** The name is in the Metrics Explorer and the query is still empty.

**Test.** Delete every matcher and every function. Query the metric name alone.

**Fix.** If the bare name returns rows, the fault is in the matchers and rung 6
finds which one. If the bare name returns nothing, you have a collection
problem, so go back to rungs 1 through 3.

### Rung 6 — add the matchers back one at a time

**Tell.** The rows come back the moment you drop one particular matcher.

**Test.** Add matchers one per attempt. The matcher that empties the result is
the wrong one.

**Fix.** Two surprises account for most of these. Matcher regexes are **fully
anchored**, so `route=~"links"` is evaluated as `^links$` and matches nothing;
substring matching costs you two explicit `.*`. And the empty string is not "no
value": `{region=""}` matches every series that has no `region` label at all,
which is every series in this lab. Chapter 2 covers both.

### Rung 7 — has this label value ever occurred?

**Tell.** The name is right, the bare selector returns rows, and this one
combination returns nothing.

**Test.** Ask what values exist rather than asserting one:

```promql
count by (code) (snip_http_requests_total{job="snip-api"})
```

**Fix.** A series that has never been written does not exist, and no amount of
re-reading your PromQL will reveal that. Nothing is not zero. Pre-initialize the
combinations you know about at zero — Snip does this, and `SNIP_NO_ZERO_INIT=1`
turns it off so you can watch the failure. In a query, repair it with
`or vector(0)` or the `or 0 *` idiom from Chapter 9, "Ratios, Arithmetic, and
the Series That Isn't There". Chapter 7, "Labels, and the Cardinality Arithmetic
You Must Do First" explains why the series is absent.

### Rung 8 — put the function back last

**Tell.** The bare selector returns a staircase; wrapping it in `rate()` returns
nothing.

**Test.** Take the function off first, then put the range back without the
function. `count_over_time(...[2m])` tells you how many samples are in the
window, and it is the one function here that speaks with a single sample.

**Fix.** Removing the function and the range together changes two things at
once. Change one. Chapter 6, "`rate()`, `increase()`, and Why Nothing Is a Whole
Number" is the mechanism.

### Rung 9 — is the range at least 4× the scrape interval?

**Tell.** `[10s]` is empty and `[2m]` is fine, on the same expression.

**Test.** The lab scrapes every 15 seconds, so `count_over_time(x[1m])` is 4.

**Fix.** `rate()`, `increase()`, `irate()`, `delta()`, `idelta()` and `deriv()`
all need at least two samples inside the range. Given fewer, the series is
dropped silently — no error, no `NaN`. Two samples is the bare mathematical
minimum and leaves no margin, so size the window at four scrapes. The same rung
wears a disguise in Chapter 25, "Storage, Retention, Backups and Locking the
Door": a compaction counter moves every few hours, so its range needs `[6h]`.

### Rung 10 — widen the time picker, then check the panel's query options

**Tell.** The expression returns data in the Prometheus UI and nothing in
Grafana.

**Test.** Open the panel's Query options. `$__interval` is the visible range
divided by **Max data points**, floored at **Min step**, then snapped to a round
duration. Inspect → Query shows the step and the expression Grafana actually
sent, with variables already resolved.

**Fix.** A wide range makes a wide step, and anything narrower than one step is
drawn only by luck. A Min step larger than you expected can push the range
window past what the data supports. Chapter 13, "Dashboard Mechanics: Intervals,
Panels and Variables" has the arithmetic.

### Rung 11 — is the series stale, or did the target set its own timestamps?

**Tell.** The series disappeared from an instant query, and the target looks
healthy now.

**Test.** Shrink the lookback window and see whether the sample is merely old:

```bash
curl -s http://localhost:9090/api/v1/query \
  --data-urlencode 'query=up{job="loadgen"}' \
  --data-urlencode 'lookback_delta=1s' | jq '.data.result'
```

**Fix.** A failed scrape writes a **staleness marker** for every series that
target produced, and an instant query that finds one returns nothing — not zero.
For a scraped target the series stops within one scrape interval, not five
minutes. The five minutes in every blog post is the **lookback delta**
(`--query.lookback-delta`), which governs data arriving with no live scrape
behind it, including exporters that stamp their own timestamps on sample lines.
Those get no marker unless you set `track_timestamps_staleness` on the job.
Chapter 2 has the mechanism.

### Rung 12 — did a binary operation drop everything?

**Tell.** Each half of the expression returns data on its own, and the two
together return nothing. Or the error reads `found duplicate series for the
match group`.

**Test.** Run each side separately and compare the label sets element by
element, before changing anything.

**Fix.** One-to-one matching needs identical label sets, so a six-label build
metric never matches a one-label selector. Choose the matching labels with
`on()` or `ignoring()`, and name the many side with `group_left` or
`group_right`. When the missing side is a denominator that goes idle, guard it
with `> 0` so the result is absent rather than `NaN`. Chapter 11, "Joins, info
metrics, and the rest of PromQL" and Chapter 9 cover the two halves of this.

!!! note "Two extra rungs on Kubernetes"
    Chapter 27, "Optional: What Changes on Kubernetes" bolts two rungs
    underneath rung 1. Ask whether your `ServiceMonitor` reached the generated
    Prometheus config at all, then whether the config produced a target. Only
    when both answers are yes does the ordinary ladder start.

## Answer key: chapter 14's five planted lies

`lab/dashboards/snip-red-BROKEN.json` carries five deliberate defects. Each one
renders without an error, survives review, and is wrong. Time yourself before
you read this. The honest version of each panel is in
`lab/dashboards/snip-red.json`.

**Lie 1 — "Error ratio (5xx / all)" averages a ratio.** The panel computes a
per-`instance` error ratio and wraps the lot in `avg()`. That gives every
replica an equal vote regardless of how much traffic it served, so one idle
replica with two errors can outvote a busy one with none. Add the numerators,
add the denominators, then divide once.

**Lie 2 — "Request rate by route" uses `$__interval` inside `rate()`.**
`$__interval` is the step, and nothing guarantees the step covers four scrapes,
or even two. The panel draws at a wide range and goes full of holes at a narrow
one. `$__rate_interval` exists precisely for this and is never wrong here.

**Lie 3 — "Faster than 300 ms" wears a `percent` unit on a 0-to-1 value.**
Grafana does not scale for you: it believes the unit. A healthy `0.997` renders
as `1.00%`, in green, and during an outage `0.5` renders as the smaller,
friendlier-looking `0.50%` while the threshold turns it red. The unit is
`percentunit`.

**Lie 4 — "Snip CPU by job" has no `job` matcher.**
`process_cpu_seconds_total` is exported by every Go and Python process in the
stack, so a panel titled for Snip quietly includes `catalog`, `pager`,
Prometheus and Alertmanager. This is what copying a panel and editing only the
title produces. Scope the selector with `{job=~"$job"}`.

**Lie 5 — "Errors right now" is not right now.** The Stat panel carries a
four-minute `timeShift` with `hideTimeOverride` set, which removes the one cue
Grafana would otherwise have drawn. It reports a four-minute-old value as the
current one, and a Stat panel shows no sign of a value's age. Drop the shift.

The checker names the panel title rather than the defect, on purpose: finding
the defect is the exercise.
