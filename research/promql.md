# PromQL: Complete Current Semantics — Research Dossier

**Compiled:** 2026-07-27
**For:** *Observability with Prometheus and Grafana: A Hands-On Introduction*
**Status of this file:** ground truth for the PromQL chapters. Everything below was verified against live
primary sources on 2026-07-27 unless explicitly marked **UNVERIFIED**.

---

## 0. Version baseline (verified 2026-07-27)

| Component | Version | Notes |
|---|---|---|
| Prometheus | **3.13.1** (released 2026-07-10) | current "Latest" release on GitHub |
| Prometheus LTS | **3.13.0** (released 2026-07-01) | marked **Long Term Support** |
| Prometheus previous LTS | **3.5.x**, latest patch **3.5.5** (2026-07-09) | 3.5.5 fixed a security issue in a UI dependency |
| Grafana | **13.1.1** (released 2026-07-21) | 13.0.4, 12.4.6, 12.3.9 also released 2026-07-21 |

Docker tags to use in the lab: `prom/prometheus:v3.13.1` and `grafana/grafana:13.1.1`.
(Tag *format* — `v`-prefix for Prometheus, no prefix for Grafana — matches long-standing practice on
Docker Hub; **UNVERIFIED** against Docker Hub itself in this pass, confirm before printing.)

**Writing rule for the book:** every PromQL statement in the manuscript must be true for Prometheus 3.13.x.
Where a feature needs `--enable-feature=...`, say so *in the same sentence* as the feature.

---

## 1. The mental model a reader with no ops background needs first

### 1.1 What a time series is

A **time series** is an append-only stream of `(timestamp, value)` pairs identified by a **metric name**
plus a set of **labels**. Prometheus stores nothing else — no logs, no traces, no strings-as-values.

```
http_requests_total{job="api", instance="10.0.0.4:8080", method="GET", code="200"}
  ↑ metric name        ↑ label set (the rest of the identity)
```

The metric name is itself stored as a reserved label, `__name__`. So
`http_requests_total{job="api"}` and `{__name__="http_requests_total", job="api"}` are the same selector.

A single `(timestamp, value)` pair in that stream is a **sample**. Values are `float64` — or, since
native histograms, a *histogram sample* (a whole distribution in one sample).

### 1.2 The four PromQL expression types

Every PromQL expression evaluates to exactly one of:

1. **Instant vector** — a set of time series, each with **exactly one sample**, all at the *same* timestamp.
2. **Range vector** — a set of time series, each with a **list of samples over a time window**.
3. **Scalar** — one bare floating-point number, no labels, no series identity.
4. **String** — a bare string. Currently only usable as an argument to some functions; it is not a
   queryable result type in practice.

Rules the reader will trip over:

- **Instant queries** (`/api/v1/query`) accept all four types as the root expression.
- **Range queries** (`/api/v1/query_range` — what every Grafana time-series panel issues) accept
  **only scalar and instant-vector** root expressions. Typing `http_requests_total[5m]` into a Grafana
  time-series panel is an error, not a graph. This is the #1 beginner error and deserves its own callout.
- A range vector is **only** legal as the argument of a function that takes one (`rate`, `increase`,
  `*_over_time`, …) or as the target of a subquery.

### 1.3 How a range query actually runs

A range query is *not* "give me the raw stored points". Prometheus takes `start`, `end`, `step`, and
evaluates the **entire expression independently at every step timestamp**:

```
t = start, start+step, start+2*step, …, ≤ end
```

At each of those instants the expression is evaluated from scratch. `rate(x[5m])` at `t=12:00:00` looks
at the window `(11:55:00, 12:00:00]`; at `t=12:00:15` it looks at `(11:55:15, 12:00:15]`. The windows
**overlap** — that is normal and is why a `rate()` graph looks smoothed. Teach this before teaching `rate`.

---

## 2. Selectors

### 2.1 Instant vector selectors

```promql
http_requests_total
http_requests_total{job="prometheus", group="canary"}
```

Returns, for each matching series, the **most recent sample at or before the evaluation timestamp**,
provided that sample is not older than the **lookback delta** (default 5m — see §4).

**Matcher operators (all four, verbatim from the docs):**

| Operator | Meaning |
|---|---|
| `=` | Select labels that are exactly equal to the provided string. |
| `!=` | Select labels that are not equal to the provided string. |
| `=~` | Select labels that regex-match the provided string. |
| `!~` | Select labels that do not regex-match the provided string. |

Critical details:

- **Regexes are fully anchored.** `env=~"foo"` is treated as `env=~"^foo$"`. To match a substring you
  must write `env=~".*foo.*"`. This is the opposite of `grep` and surprises everyone.
- Regex syntax is **RE2** (Go's `regexp`), so there are **no backreferences and no lookahead/lookbehind**.
- **In Prometheus 3.x, `.` matches newline characters.** In 2.x it did not. `.*`, `foo.?bar`, `foo.+bar`
  now match strings containing `\n`. To get v2 behaviour write `[^\n]` instead of `.`. (3.0 breaking change.)
- A matcher against the **empty string also selects series that do not have that label at all**:
  `{job="api", env=""}` matches series in job `api` with no `env` label.
- **A selector must have at least one matcher that does not match the empty string.** `{job=~".*"}` alone
  is an error; you need a metric name or a non-empty-matching matcher.
- Multiple matchers on the same label are ANDed: `{code=~"5..", code!="503"}` is legal and useful.

**Selecting by metric name pattern:**

```promql
{__name__=~"job:.*"}
```

**UTF-8 metric and label names (Prometheus 3.x).** All UTF-8 strings are valid names now (this is what
makes OpenTelemetry's dotted names work). Names outside `[a-zA-Z_:][a-zA-Z0-9_:]*` must be **quoted and
placed inside the braces**. These three are equivalent:

```promql
{"my.domain.com/metric/name_bucket", "label.key"="label.value"}
{__name__="my.domain.com/metric/name_bucket", "label.key"="label.value"}
{"__name__"="my.domain.com/metric/name_bucket", "label.key"="label.value"}
```

UTF-8 support is **purely additive** — existing dashboards and rules keep working unchanged.

### 2.2 Range vector selectors

```promql
http_requests_total{job="prometheus"}[5m]
```

**The 3.0 breaking change you must not get wrong:** range selectors are now
**left-open and right-closed**, i.e. the window is `(t-5m, t]`. A sample landing exactly on the
left boundary is **excluded**; a sample exactly on the right boundary is **included**.
(In Prometheus 2.x it was left-closed *and* right-closed, so a boundary sample was counted twice across
adjacent windows.)

Practical fallout, straight from the migration guide: `foo[1m:1m]` may now return **one** point where it
used to return two; rewrite as `foo[2m:1m]`.

### 2.3 Literals: numbers, strings, durations

**String literals:** single quotes, double quotes, or backticks. Go escaping rules (`\n`, `\t`, `\\`,
octal, hex) — except backtick strings, which do **not** process escapes.

**Float literals:** `[-+]?(integer|float|hex|NaN|Inf)`. Examples: `23`, `-2.43`, `3.4e-9`, `0x8f`,
`NaN`, `+Inf`. Underscores are allowed as digit separators: `1_000_000`, `0x_53_AB_F3_82`.

**Duration literals:** a decimal integer plus a unit; units may be concatenated **longest-first**:

| Unit | Meaning |
|---|---|
| `ms` | milliseconds |
| `s` | seconds |
| `m` | minutes |
| `h` | hours |
| `d` | days (always 24h) |
| `w` | weeks (always 7d) |
| `y` | years (**always 365 days** — no leap-year handling) |

Valid: `1s`, `2m`, `1ms`, `-2h`, `1h30m`, `12h34m56s`, `54s321ms`.
Invalid: `1.5h` (floats not allowed in duration literals — write `90m`), and hex is not allowed either.

**Float/duration interchangeability is stable since 3.0**: a bare number is accepted where a duration is
expected and vice versa (a duration used as a number yields seconds). So `rate(foo[300])` ≡ `rate(foo[5m])`.
Prefer duration literals in the book for readability; mention interchangeability once as a footnote.

### 2.4 Duration expressions — arithmetic inside `[ ]` and `offset`

**Experimental. Requires `--enable-feature=promql-duration-expr`.** Added in 3.4.0; extended in 3.6.0
(`step()`, duration `min`/`max`) and renamed in 3.13.0 (`min`→`min_of`, `max`→`max_of`).

Operators supported: `+`, `-`, `*`, `/`, `%`, `^`, with normal precedence.

```promql
rate(http_requests_total[5m * 2])          # 10m range
rate(http_requests_total[(5+2) * 1m])      # 7m range
http_requests_total offset (1h / 2)        # 30m offset
http_requests_total offset ((2 ^ 3) * 1m)  # 8m offset
```

Gotchas to print in the book:

- **In `offset` you must parenthesise the expression.** Without parentheses only the first duration value
  is used.
- Helper functions usable inside duration expressions: `step()` (the range query's step width; `0s` for
  instant queries), `range()` (the query's total span; `0s` for instant queries), `min_of()`, `max_of()`.
- **Duration expressions do not work with the `@` modifier.**

This is the native answer to Grafana's `$__rate_interval` hack: `rate(http_requests_total[4 * step()])`.
Because it is behind a flag, the book should teach `$__rate_interval` as the primary tool and mention
duration expressions as "where this is going".

**Status check done at the source level on 2026-07-27 — this flag is mid-graduation, so be careful.**

- In the **released v3.13.1**, `cmd/prometheus/main.go` still has
  `case "promql-duration-expr": c.parserOpts.ExperimentalDurationExpr = true` and logs
  *"Experimental duration expression parsing enabled."* The feature is documented in the v3.13.1
  `feature_flags.md` under the heading **"PromQL arithmetic expressions in time durations"**, and there is
  **no** duration-expressions section in the v3.13.1 `querying/basics.md`. **So: flag required in 3.13.1.**
- On **`main`** (i.e. post-3.13.1, unreleased) the same switch case now reads
  `logger.Warn("This option for --enable-feature is now permanently enabled and therefore a no-op.", ...)`,
  the flag's section has been **deleted** from `feature_flags.md`, and duration expressions have been
  promoted into `querying/basics.md` as a first-class **"### Duration expressions"** section.

Practical consequence for the book: **write the chapter against "requires the flag"**, and add a
forward-looking sentence that it becomes permanently-on in the release after 3.13. Which release that is
is **UNVERIFIED** — there is no CHANGELOG entry for the promotion yet, only the code and docs change on
`main`.

Note also that `prometheus.io/docs/prometheus/latest/` tracks the **latest release**, not `main`. The
`latest` feature-flags page still lists `--enable-feature=promql-duration-expr`. If you ever see the
website and the GitHub `main` docs disagree, `main` is the future and `latest` is the truth for readers.

---

## 3. Modifiers: `offset`, `@`, and the experimental range modifiers

### 3.1 `offset`

Shifts the *selector's* time reference. **It must immediately follow the selector**, not the function call.

```promql
http_requests_total offset 5m
rate(http_requests_total[5m] offset 1w)
sum(http_requests_total{method="GET"} offset 5m)   # CORRECT
sum(http_requests_total{method="GET"}) offset 5m   # INVALID — parse error
```

Negative offsets look *forward* in time: `http_requests_total offset -1w`.

Week-over-week comparison idiom:

```promql
sum(rate(http_requests_total[5m]))
  /
sum(rate(http_requests_total[5m] offset 1w))
```

### 3.2 The `@` modifier

Pins the selector to an absolute Unix timestamp, regardless of the query's evaluation time. Same
placement rule as `offset` — immediately after the selector.

```promql
http_requests_total @ 1609746000
rate(http_requests_total[5m] @ 1609746000)
sum(http_requests_total{method="GET"} @ 1609746000)   # CORRECT
sum(http_requests_total{method="GET"}) @ 1609746000   # INVALID
```

Special values: `start()` and `end()` resolve to the range query's start/end (for an instant query both
resolve to the evaluation time).

```promql
rate(http_requests_total[5m] @ end())
```

`@` accepts all numeric literal forms. `offset` and `@` **combine in either order with identical
results**: `@ 1609746000 offset 5m` is equivalent to `offset 5m @ 1609746000`.

The canonical teaching example — "share of total, held constant across the graph":

```promql
topk(5, sum by (job) (rate(http_requests_total[5m]) @ end()))
```

Note: `@` was gated behind `--enable-feature=promql-at-modifier` in old 2.x versions. **That flag is gone;
`@` is stable and always available in 3.x.** Do not repeat the old flag advice.

### 3.3 Experimental: `anchored` and `smoothed` range modifiers

**Requires `--enable-feature=promql-extended-range-selectors`.** Introduced 3.7.0, extended in
3.11.0, native-histogram support added in 3.13.0.

These exist specifically to fix the two things people hate about `rate()`/`increase()` extrapolation.

```promql
increase(http_requests_total[5m] anchored)
rate(http_requests_total[step()] smoothed)
```

- **`anchored`** — instead of extrapolating, the range's left edge uses *the most recent sample within
  the lookback delta before the range start* (or the first in-range sample if there is none). Works with
  `resets`, `changes`, `rate`, `increase`, `delta`. **`increase(...[5m] anchored)` returns integer results**
  for an integer counter. This is the "why isn't increase() a whole number" fix.
- **`smoothed`** — linearly interpolates the value at both range boundaries. Works with `rate`,
  `increase`, `delta`.

Caveats to print:

- `smoothed` needs a sample *after* the range end, so in recording/alerting rules it can **underestimate**.
  Use the rule group's `query_offset` so the evaluation window is fully historical.
- Not supported for **subqueries**.
- Native histogram support only arrived in 3.13.0.
- Does not combine with the `use-start-timestamps` feature (see section 6.4).

Because these need a flag, the book should teach classic `rate()` semantics as the ground truth and present
`anchored` as an optional sidebar ("if you can run with the flag, `increase()` finally gives whole numbers").

---

## 4. Lookback delta and staleness — the behaviour that surprises everyone

This is the single most common source of "my graph is lying". It deserves a full sidebar.

### 4.1 Lookback delta

An instant vector selector at time `t` returns, per series, the newest sample with timestamp
`<= t` **and** `> t - lookback_delta`.

- Default lookback delta: **5m**.
- Server flag: `--query.lookback-delta` (default `5m`).
- Per-query override: the `lookback_delta` request parameter on `/api/v1/query` and `/api/v1/query_range`
  (duration string or float seconds).

Consequences:

- **A gauge you stopped scraping keeps being "current" for up to 5 minutes.** If a target vanishes without
  a staleness marker (e.g. remote-write, pushgateway, federation), the last value is repeated at every step
  for 5 minutes and then abruptly disappears.
- **A scrape interval longer than ~2 minutes is dangerous.** One failed scrape at a 3m interval means the
  next evaluation may find nothing within 5m and the series drops out. Rule of thumb: keep
  `scrape_interval` well under `lookback_delta / 2`.
- Range vectors are **not** subject to the lookback delta. `foo[5m]` returns exactly the samples in
  `(t-5m, t]` — no extension, no repetition. This is why `count_over_time(foo[5m])` tells you how many
  scrapes actually happened.

### 4.2 Staleness markers

Since Prometheus 2.0 the server writes an explicit **staleness marker** when a series stops being
reported. Internally it is a specific NaN bit pattern (`0x7ff0000000000002`) — **never visible via PromQL**,
but remote-storage implementers must handle it.

Markers are written when:

- a target is scraped successfully but a series that was present last time is now gone;
- a **scrape fails** — *all* series from the previous scrape of that target are marked stale (this stops
  aggregations double-counting when a replacement target has already been brought up);
- a target disappears from service discovery (Prometheus waits roughly two scrape intervals first, so a
  recreated target can reject the stale marker).

Query behaviour:

- **Instant vector selectors:** if the newest sample at or before `t` is a staleness marker, the series is
  **omitted from the result entirely**. It does not linger for 5 minutes.
- **Range vectors ignore staleness markers completely.** `avg_over_time`, `rate`, `count_over_time` etc.
  operate only on the real samples. A stale marker is not a data point.
- If Prometheus **crashes** (no clean shutdown), no markers are written and the system falls back to
  pre-2.0 behaviour: a series is stale only if there is no sample in the preceding lookback delta.

### 4.3 `track_timestamps_staleness`

Exporters that expose **their own explicit timestamps** do not get staleness markers by default; their
series simply age out after the lookback delta. The scrape-config option
**`track_timestamps_staleness`** makes Prometheus track staleness for these too.

### 4.4 Teaching demo for the lab

1. `docker compose stop demo-app`
2. `up{job="demo"}` goes to `0` (the target is still configured, the scrape fails).
3. An application gauge disappears from the *instant* query almost immediately — staleness marker after
   the first failed scrape, **not** after 5 minutes.
4. `count_over_time(some_gauge[10m])` shows the range vector seeing the real hole.
5. Now delete the job from `prometheus.yml`, reload, and compare.

---

## 5. Subqueries

```
<instant_query> '[' <range> ':' [<resolution>] ']' [ @ <float_literal> ] [ offset <float_literal> ]
```

A subquery runs an instant query repeatedly over a range and produces a **range vector**. The resolution
(the part after the colon) defaults to the **global `evaluation_interval`**. The colon is mandatory even
when you omit the resolution: `[30m:]`.

```promql
rate(http_requests_total[5m])[30m:1m]
max_over_time(deriv(rate(distance_covered_total[5s])[30s:5s])[10m:])
```

Canonical uses:

- **Max of a rate over a longer window:** `max_over_time(rate(http_requests_total[5m])[1h:1m])`
- **Aggregating an aggregate over time:** `avg_over_time(sum(rate(x[5m]))[1h:1m])`
- **Rate of an expression** you have not turned into a recording rule yet.

Semantics people get wrong:

- **Subquery steps are aligned to the Unix epoch, not to the parent query's evaluation time.** With a
  resolution of `1m`, the sample timestamps are multiples of 60s. A parent evaluation at `t=100s` and one
  at `t=103s` see *the same* subquery output timestamps. This makes results stable and cacheable, but
  means the newest subquery point can be up to one resolution old.
- Subqueries are **expensive** — they force a full inner evaluation per step. Prefer a recording rule.
- The 3.0 left-open change bites here: `foo[1m:1m]` can yield **one** point. Use `[2m:1m]`.
- The experimental `anchored` / `smoothed` modifiers are **not supported** in subqueries.

---

## 6. Counters: `rate`, `irate`, `increase`, `delta`, `idelta` — the deep dive

### 6.1 What the docs actually say (verbatim)

**`rate(v range-vector)`** — "calculates the per-second average rate of increase of the time series in the
range vector. Breaks in monotonicity (such as counter resets due to target restarts) are automatically
adjusted for. Also, the calculation extrapolates to the ends of the time range, allowing for missed
scrapes or imperfect alignment of scrape cycles with the range's time period."
"`rate` should only be used with counters (for both floats and histograms). It is best suited for
alerting, and for graphing of slow-moving counters."

**`increase(v range-vector)`** — "calculates the increase in the time series in the range vector. Breaks in
monotonicity (such as counter resets due to target restarts) are automatically adjusted for. The increase
is extrapolated to cover the full time range as specified in the range vector selector, so that it is
possible to get a non-integer result even if a counter increases only by integer increments."
"It is syntactic sugar for `rate(v)` multiplied by the number of seconds under the specified time range
window, and should be used primarily for human readability."

**`irate(v range-vector)`** — "calculates the per-second instant rate of increase of the time series in the
range vector. This is based on the last two data points."
"`irate` should only be used when graphing volatile, fast-moving counters. Use `rate` for alerts and
slow-moving counters, as brief changes in the rate can reset the `FOR` clause and graphs consisting
entirely of rare spikes are hard to read."

**`delta(v range-vector)`** — first-to-last difference, extrapolated to the full range. **Gauges only.**
**`idelta(v range-vector)`** — difference between the last two samples. **Gauges only.**

So: `rate` / `increase` / `irate` are the **counter** family (they do reset correction);
`delta` / `idelta` / `deriv` / `predict_linear` are the **gauge** family (they do not).

### 6.2 The extrapolation algorithm, exactly (from `promql/functions.go`, `extrapolatedRate`)

This is the part textbooks get wrong. The real algorithm:

```
rangeStart = evalTimestamp - (range + offset)
rangeEnd   = evalTimestamp - offset

sampledInterval               = (lastT - firstT) / 1000            # seconds actually covered by samples
averageDurationBetweenSamples = sampledInterval / (numSamples - 1)

durationToStart = (firstT - rangeStart) / 1000                     # gap at the left edge
durationToEnd   = (rangeEnd - lastT)   / 1000                      # gap at the right edge

extrapolationThreshold = averageDurationBetweenSamples * 1.1

if durationToStart >= extrapolationThreshold:
    durationToStart = averageDurationBetweenSamples / 2
if durationToEnd >= extrapolationThreshold:
    durationToEnd = averageDurationBetweenSamples / 2

# counters only: never extrapolate back past the point where the counter would have been zero
if isCounter and resultFloat > 0 and firstValue >= 0:
    durationToZero = sampledInterval * (firstValue / resultFloat)
    if durationToZero < durationToStart:
        durationToStart = durationToZero

factor = (sampledInterval + durationToStart + durationToEnd) / sampledInterval
if isRate:
    factor /= range.Seconds()
result *= factor
```

Plain-English version for the book:

1. Take the first and last sample in the window and compute the reset-corrected difference between them.
2. Those two samples almost never sit exactly on the window edges, so Prometheus **scales the result up**
   by the ratio of "full window" to "window actually covered by samples".
3. **Guard rail:** if the gap to an edge is more than **1.1x the average sample spacing** in the window,
   Prometheus assumes the series genuinely started/ended there and extrapolates only **half an average
   sample interval** instead of all the way to the edge. The source comment defines "close enough" as
   "up to 10% more than the average duration between samples within the range".
4. **Second guard rail (counters only):** it will not extrapolate to a point where the counter would have
   been negative. If the counter's slope implies it hit zero inside the window, the left edge is clamped there.

### 6.3 Why `increase()` returns non-integers — the exact story

Because of step 2 above. Two worked examples, both traced through the real algorithm. Use **Example B**
in the book: it is the one that actually produces a fraction, which is the whole point.

**Example A — inflation without a fraction (4 samples, tidy alignment).**

- scrape_interval `15s`, query `increase(http_requests_total[1m])` at time `t`
- window `(t-60s, t]` contains 4 samples at `t-45s, t-30s, t-15s, t` with values `10, 11, 12, 13`
- `resultFloat = 13 - 10 = 3`
- `sampledInterval = 45s`; `numSamples - 1 = 3`; `averageDurationBetweenSamples = 15s`;
  `extrapolationThreshold = 16.5s`
- `durationToStart = 15s` (< 16.5 → **not** clamped, extrapolate all the way to the edge),
  `durationToEnd = 0s`
- counter zero-clamp: `durationToZero = 45 * (10 / 3) = 150s`, which is **not** less than 15, so no clamp
- `factor = (45 + 15 + 0) / 45 = 1.3333…`
- **result = `3 * 1.3333… = 4`**

The counter observably went up by **3**, and `increase()` reports **4**. Already surprising, still integral.

**Example B — the genuine fraction (3 samples, gap at the left edge).**

- same 15s scrape, `increase(http_requests_total[1m])` at time `t`
- window `(t-60s, t]` contains only 3 samples at `t-30s, t-15s, t` with values `10, 11, 12`
  (one scrape was missed, or the series is young)
- `resultFloat = 12 - 10 = 2`
- `sampledInterval = 30s`; `numSamples - 1 = 2`; `averageDurationBetweenSamples = 15s`;
  `extrapolationThreshold = 16.5s`
- `durationToStart = 30s` → `30 >= 16.5`, so it **is** clamped to `averageDurationBetweenSamples / 2 = 7.5s`
- counter zero-clamp: `durationToZero = 30 * (10 / 2) = 150s`, not less than 7.5 → no further clamp
- `durationToEnd = 0s`
- `factor = (30 + 7.5 + 0) / 30 = 1.25`
- **result = `2 * 1.25 = 2.5`**

`increase()` reports **2.5 requests**. There is no such thing as half a request. **That is correct
behaviour, not a bug.**

**Example C — the zero-clamp actually firing (young counter).**

Same shape as B, but the counter is new and the values are `0, 1, 2`:

- `resultFloat = 2`, `durationToStart` clamped to `7.5s` as before
- `durationToZero = 30 * (0 / 2) = 0`, and `0 < 7.5` → `durationToStart = 0`
- `factor = (30 + 0 + 0) / 30 = 1` → **result = `2`**, exactly

This is the guard rail that stops a counter's first minutes from being extrapolated into negative
territory. Worth showing, because it explains why a brand-new counter's `increase()` looks "honest"
while an established one looks inflated.

Four things to tell the reader:

1. `increase()` is an **estimate of the increase over the window**, not a count of observed events.
2. Never `round()` it to make it look nicer in an alert — you are hiding the estimate's uncertainty.
   If you need exact counts, either widen the window, use `anchored` (flagged), or accept the estimate.
3. `increase(x[5m])` is exactly `rate(x[5m]) * 300`. Verify this in the lab; it makes the sugar obvious.
4. **`rate()` divides by the *declared* range, not by the interval the samples actually covered.** In the
   source the last step is literally `factor /= ms.Range.Seconds()`. So `rate(x[1m])` in Example B is
   `2 * 1.25 / 60 = 0.041666…/s`, i.e. `2.5 / 60`. This is why `rate()` over a window with sparse data
   reads *lower* than the instantaneous truth: the numerator is extrapolated only partway to the edges,
   but the denominator is always the full window.

### 6.4 Counter resets

A **counter reset** is any decrease between two consecutive samples of a counter series (usually a process
restart). `rate`/`irate`/`increase` compensate by treating the drop as "the counter went to 0 and started
again": they add the new value to the previously accumulated total, as if the reset never happened.

Consequences the reader must internalise:

- **Never use `delta()` on a counter** — it does not correct resets and will go negative.
- A reset **between two scrapes is invisible** if the counter climbed back above its previous value in the
  meantime. Prometheus can only see samples, and it will undercount. This is a fundamental limit.
- **`rate()` of a counter that restarts every scrape** produces garbage; that is a broken exporter.

For native histograms, a reset is detected more richly: any decrease in **any** bucket (including the zero
bucket) or in the observation count, **plus** the disappearance of a previously populated bucket, a
decrease of the zero-bucket width, or a schema change that is not a compatible resolution decrease.

**New in 3.12.0 — start timestamps.** `--enable-feature=use-start-timestamps` makes `rate()`, `irate()`
and `increase()` use the series' **start timestamp (ST)** — the created-timestamp / `_created` concept —
so the first increase after a restart can be attributed correctly instead of being lost. `resets()` also
considers ST resets when the flag is on. Related storage flags: `st-storage` (persist ST through WAL,
TSDB/Agent and Remote-Write 2.0; wants the `xor2-encoding` chunk format) and `st-synthesis` (synthesize
STs by detecting resets and subtracting an initial reference point; it **drops the first sample**).
**`use-start-timestamps` does not work together with `anchored` / `smoothed`.**

Mark all of this as "experimental, 3.12+" in the book. It is the direction of travel but not yet default.

### 6.5 The "at least 2 samples / at least 4x the scrape interval" rule

**Hard requirement:** `rate`, `irate`, `increase`, `delta`, `idelta`, `deriv` and `predict_linear` need
**at least two samples inside the range**. With fewer, the series is silently **dropped from the result** —
no error, no `NaN`, just a missing line on your graph. This silent-drop is the #1 cause of "empty panel".

> **One modern exception, verified in the 3.13.1 source.** With `--enable-feature=use-start-timestamps`,
> `rate`/`increase` *can* produce a result from a **single** sample, provided that sample carries a start
> timestamp (ST) that falls strictly inside the range. The source comment is explicit: *"To calculate a
> rate, we normally need at least two float or two histogram samples. However, we can calculate rate with
> a single sample as long as there's a start timestamp reset inside the window."* In that path
> `durationToStart` is forced to `0` and the first sample's value is added to the result, because the
> counter is known to have been `0` at ST. Note the trade-off recorded in the same comment: with only one
> sample there is no average spacing, so the extrapolation threshold is `0` and **extrapolation to the
> right edge is lost**. Teach the two-sample rule as *the* rule; mention this as a footnote only.

**Practical rule.** The canonical published statement of the 4x guidance that I could verify live today is
Grafana's: *"The range in a `rate` query should be at least four times the scrape interval."* (Grafana Labs,
the `$__rate_interval` announcement — this is also the design rationale for that variable). Why 4x and
not 2x:

1. Two samples is the bare mathematical minimum.
2. At query time the most recent scrape may not have been ingested/committed yet.
3. A single failed scrape must not empty the window.

Together those eat two samples of headroom, so 4x is the safe floor.

| scrape_interval | minimum sane range | what people usually write |
|---|---|---|
| 10s | 40s | `[1m]` |
| 15s | 60s | `[1m]` |
| 30s | 2m | `[2m]` or `[5m]` |
| 60s | 4m | `[5m]` |

Further advice from the same source: pick **one** range for your whole organisation (1m, 2m or 5m), use it
everywhere in recording rules, and use `avg_over_time()` on top when you need a longer-term average —
rather than maintaining `rate5m`, `rate10m`, `rate30m` variants.

### 6.6 Grafana's `$__rate_interval`

Grafana's answer to the same problem. Definition, verbatim:

> `$__rate_interval` = `max( $__interval + Scrape interval, 4 * Scrape interval )`

where *Scrape interval* is the panel's **Min step** if set, otherwise the **Scrape interval** setting on
the Prometheus data source (the query's *Min interval* option is deliberately ignored here).

So `rate(http_requests_total[$__rate_interval])` is always at least 4 scrapes wide **and** at least one
scrape wider than the panel's step — which is what stops the "gaps when zoomed out" artefact.

**Book rule: every `rate()` in a Grafana panel uses `[$__rate_interval]`. Every `rate()` in a recording or
alerting rule uses a fixed literal range** (rules have no `$__interval`). Do not mix them up.

Related Grafana variables the reader will meet: `$__interval`, `$__interval_ms`, `$__range`,
`$__range_s`, `$__range_ms`, `$__rate_interval_ms`. (Only `$__interval` and `$__rate_interval` are
documented on the current Prometheus query-editor page; the others exist but are documented elsewhere —
**verify the exact list against the Grafana 13.1 docs before printing a table.**)

### 6.7 `rate` vs `irate` vs `increase` — the decision table

| | window used | best for | avoid for |
|---|---|---|---|
| `rate(x[5m])` | all samples in window, extrapolated | **alerting**, slow counters, everything by default | when you need sub-window spikes |
| `irate(x[5m])` | **last two samples only** | graphing volatile fast counters at high resolution | alerting — spikes reset the `for:` clause |
| `increase(x[5m])` | same as `rate`, not per-second | human-readable "how many in the last N" | anything needing an exact integer |

Note `irate`'s trap: the `[5m]` on `irate` does **not** widen the calculation, it only says "look back up
to 5m to find two samples". At a step wider than the scrape interval, `irate` **skips most of your data**.

---

## 7. The complete current function catalogue (Prometheus 3.13.x)

Everything marked **[EXP]** requires `--enable-feature=promql-experimental-functions` and may change name,
syntax or semantics without a major-version bump. The docs' own warning: "These functions might change
their name, syntax, or semantics."

### 7.1 Counter / gauge rate family (take a range vector)

```
rate(v range-vector)
irate(v range-vector)
increase(v range-vector)
delta(v range-vector)
idelta(v range-vector)
deriv(v range-vector)
predict_linear(v range-vector, t scalar)
resets(v range-vector)
changes(v range-vector)
double_exponential_smoothing(v range-vector, sf scalar, tf scalar)   [EXP]
```

### 7.2 `*_over_time` family (take a range vector, return an instant vector)

Stable:

```
avg_over_time(range-vector)
min_over_time(range-vector)
max_over_time(range-vector)
sum_over_time(range-vector)
count_over_time(range-vector)
quantile_over_time(scalar, range-vector)
stddev_over_time(range-vector)
stdvar_over_time(range-vector)
last_over_time(range-vector)
present_over_time(range-vector)
absent_over_time(range-vector)
```

Experimental **[EXP]** (this is the recently-added cluster the book must flag):

```
mad_over_time(range-vector)           # median absolute deviation of all float samples in the interval
first_over_time(range-vector)         # the oldest sample in the interval
ts_of_first_over_time(range-vector)   # timestamp of the earliest sample
ts_of_last_over_time(range-vector)    # timestamp of the last sample
ts_of_min_over_time(range-vector)     # timestamp of the LAST float sample holding the minimum value
ts_of_max_over_time(range-vector)     # timestamp of the LAST float sample holding the maximum value
```

Timeline: `mad_over_time` and `sort_by_label*` landed 3.8.0; `ts_of_(min|max|last)_over_time` in 3.6.0;
`first_over_time` and `ts_of_first_over_time` in 3.7.0.

Semantics notes worth printing:

- "Note that all values in the specified interval have the same weight in the aggregation even if the
  values are not equally spaced throughout the interval." — i.e. `avg_over_time` is an **unweighted mean
  of samples**, not a time-weighted average. Irregular scraping skews it.
- "`first_over_time(m[1m])` differs from `m offset 1m` in that the former will select the first sample of
  `m` within the 1m range, where `m offset 1m` will select the most recent sample within the lookback
  interval outside and prior to the 1m offset."
- Histogram handling: `count_over_time`, `first_over_time`, `last_over_time`, `present_over_time` treat
  float and histogram samples identically. `avg_over_time` and `sum_over_time` aggregate histograms
  properly. A series with a **mix** of float and histogram samples in the range is **removed entirely**
  (warn-level annotation). All other functions silently drop histogram-only ranges and, for mixed ranges,
  process only the floats (info-level annotation).

### 7.3 Histogram functions

```
histogram_quantile(φ scalar, b instant-vector)
histogram_fraction(lower scalar, upper scalar, b instant-vector)
histogram_avg(v instant-vector)
histogram_count(v instant-vector)
histogram_sum(v instant-vector)
histogram_stddev(v instant-vector)          # added 3.5.0
histogram_stdvar(v instant-vector)          # added 3.5.0
histogram_quantiles(v instant-vector, quantile_label string, φ_1 scalar, φ_2 scalar, ...)   [EXP]  # added 3.11.0
```

`histogram_quantile` and `histogram_fraction` work on **both classic and native** histograms.
`histogram_avg`, `histogram_count`, `histogram_sum`, `histogram_stddev`, `histogram_stdvar` are
**native-histogram only**.

```promql
histogram_quantiles(sum(rate(foo[1m])), "quantile", 0.9, 0.99)
# => {quantile="0.9"}  123
#    {quantile="0.99"} 128
```

### 7.4 Label manipulation and metadata

```
label_replace(v instant-vector, dst_label string, replacement string, src_label string, regex string)
label_join(v instant-vector, dst_label string, separator string, src_label_1 string, src_label_2 string, ...)
info(v instant-vector, [data-label-selector instant-vector])   [EXP]   # added 3.9.0
```

### 7.5 Sorting

```
sort(v instant-vector)
sort_desc(v instant-vector)
sort_by_label(v instant-vector, label string, ...)        [EXP]
sort_by_label_desc(v instant-vector, label string, ...)   [EXP]
```

- All four "only affect the results of instant queries, as range query results always have a fixed output
  ordering." **Since 3.12.0 Prometheus emits a warning annotation if you use them in a range query.**
- `sort_by_label` uses **natural sort order** (so `node10` sorts after `node9`, not before) and falls back
  to the full label set when the given label values tie.
- `sort`/`sort_desc` silently ignore histogram samples.

### 7.6 Absence

```
absent(v instant-vector)
absent_over_time(v range-vector)
```

Exact examples from the docs:

```promql
absent(nonexistent{job="myjob"})
# => {job="myjob"}

absent(nonexistent{job="myjob",instance=~".*"})
# => {job="myjob"}

absent(sum(nonexistent{job="myjob"}))
# => {}

absent_over_time(nonexistent{job="myjob"}[1h])
# => {job="myjob"}

absent_over_time(nonexistent{job="myjob",instance=~".*"}[1h])
# => {job="myjob"}

absent_over_time(sum(nonexistent{job="myjob"})[1h:])
# => {}
```

**The rule:** `absent()` "tries to be smart about deriving labels of the 1-element output vector from the
input vector" — it copies through **only the labels fixed by equality (`=`) matchers** on a plain vector
selector. Regex matchers contribute nothing. Wrap the input in an aggregation and you get `{}` with **no**
labels, which means your alert has no `job`/`instance` to route on. Print this warning:

> If you want `absent()` alerts to carry useful labels, write the selector with explicit `=` matchers.
> `absent(up{job="api"})` gives you `{job="api"}`; `absent(sum(up))` gives you nothing to route on.

Prefer **`absent_over_time(x[10m])`** over `absent(x)` for alerting: it is immune to a single missing
scrape and to lookback-delta edge effects.

### 7.7 Time and date

```
time()
timestamp(v instant-vector)
day_of_month(v=vector(time()) instant-vector)
day_of_week(v=vector(time()) instant-vector)      # 0 = Sunday
day_of_year(v=vector(time()) instant-vector)
days_in_month(v=vector(time()) instant-vector)
hour(v=vector(time()) instant-vector)
minute(v=vector(time()) instant-vector)
month(v=vector(time()) instant-vector)
year(v=vector(time()) instant-vector)
```

`time()` "does not actually return the current time, but the time at which the expression is to be
evaluated" — essential for range queries.

Query-context functions, all **[EXP]**, added 3.12.0 (with `step()` first appearing in 3.6.0 for duration
expressions):

```
start()   [EXP]   # start timestamp of the current query range evaluation, seconds since epoch
end()     [EXP]   # end timestamp of the current query range evaluation
range()   [EXP]   # end() - start(); 0 for instant queries
step()    [EXP]   # query resolution step in seconds; 0 for instant queries
```

**Do not confuse these with the `start()` / `end()` special values of the `@` modifier**, which are
stable and unflagged. Same names, different thing — a genuinely confusing corner worth one sentence.

There is a **third** collision on these names, and it is worth a table in the book. `step()`, `range()`,
`min_of()` and `max_of()` each exist in **two** places with **two different feature flags**:

| Name | As a *duration expression* helper inside `[ ]` / `offset` | As a *scalar function* in an expression |
|---|---|---|
| `step()` | `promql-duration-expr` (3.6.0+) | `promql-experimental-functions` (3.12.0+) |
| `range()` | `promql-duration-expr` | `promql-experimental-functions` (3.12.0+) |
| `min_of()` / `max_of()` | `promql-duration-expr` (renamed from `min`/`max` in 3.13.0) | `promql-experimental-functions` (3.13.0+) |

So `rate(x[max_of(step(), 5s)])` and `max_of(step(), 5)` are gated by *different* flags. Enable both if
you want to demo either.

**`start_timestamp()` — NOT in 3.13.1.**

```
start_timestamp(v instant-vector)    # seconds since epoch; float and histogram samples alike
```

Returns the **start timestamp** of each sample, as opposed to `timestamp()` which returns the sample's own
timestamp. Two hard constraints from the docs: it "only works when used directly on an instant vector and
when `use-start-timestamps` feature flag is enabled. Otherwise, if it's used on an expression or if
`use-start-timestamps` is disabled, it returns empty results."

**Version caution.** This function is documented on the `main` branch but is **absent from the v3.13.1
docs**, and I found **no CHANGELOG entry** for it in either the released sections or `Unreleased`. It is
therefore post-3.13.1 and presumably lands in 3.14. **Do not put it in the book as a current feature.**
Which release introduces it is **UNVERIFIED**.

### 7.8 Math and utility

```
abs(v)  ceil(v)  floor(v)  round(v, to_nearest=1)  clamp(v, min, max)  clamp_max(v, max)  clamp_min(v, min)
exp(v)  ln(v)  log2(v)  log10(v)  sqrt(v)  sgn(v)
scalar(v instant-vector)  vector(s scalar)
min_of(a scalar, b scalar)   [EXP]     # renamed from min()  in 3.13.0
max_of(a scalar, b scalar)   [EXP]     # renamed from max()  in 3.13.0
pi()  deg(v)  rad(v)
acos  acosh  asin  asinh  atan  atanh  cos  cosh  sin  sinh  tan  tanh
```

- `round()` — "Ties are resolved by rounding up." `to_nearest` lets you round to a multiple.
- `scalar()` returns `NaN` unless the input vector has **exactly one** element with a float sample.
- `vector(0)` is the standard trick for "show 0 instead of no data" (see pitfalls).
- Trig functions work in **radians** and ignore histogram samples.
- The `atan2` **operator** (not function) exists as a binary operator at `*`/`/` precedence.

### 7.9 Functions that do NOT exist (and what people mean instead)

- `holt_winters` — **renamed** in 3.0 to `double_exponential_smoothing` **and** moved behind
  `promql-experimental-functions`. Any book or blog using `holt_winters` is pre-3.0.
- There is no `avg_over_time` for quantiles, no `median()`, no `percentile()` — use
  `quantile(0.5, …)` / `quantile_over_time(0.5, …)` / `histogram_quantile(0.5, …)`.
- There is no `rate_interval()` in PromQL; `$__rate_interval` is a **Grafana** variable.
- There is no `now()`; it is `time()`.

---

## 8. Aggregation operators

Syntax — the modifier may go **before or after** the parentheses; both forms are identical:

```
<aggr-op> [without|by (<label list>)] ([parameter,] <vector expression>)
<aggr-op>([parameter,] <vector expression>) [without|by (<label list>)]
```

The book should standardise on the **prefix** form (`sum by (job) (...)`) because it reads left-to-right
and matches what the Prometheus UI's prettifier produces.

| Operator | Parameter | Notes |
|---|---|---|
| `sum(v)` | — | supports histogram samples |
| `avg(v)` | — | supports histogram samples |
| `min(v)` | — | **floats only**, histograms ignored |
| `max(v)` | — | **floats only**, histograms ignored |
| `count(v)` | — | supports histogram samples |
| `group(v)` | — | "Returns 1 for each group that contains any value at that timestamp." |
| `stddev(v)` | — | population standard deviation, **floats only** |
| `stdvar(v)` | — | population variance, **floats only** |
| `topk(k, v)` | `k` | largest k, **floats only**, histograms ignored |
| `bottomk(k, v)` | `k` | smallest k, **floats only**, histograms ignored |
| `quantile(φ, v)` | `φ` | "the value that ranks at number φ*N among the N metric values" |
| `count_values(l, v)` | `l` (label name) | one output series per distinct value; works on floats **and** histograms |
| `limitk(k, v)` | `k` | **[EXP]** deterministic pseudo-random k samples; floats **and** histograms |
| `limit_ratio(r, v)` | `r` in [-1, +1] | **[EXP]** pseudo-random ratio; negative r selects the complement |

`by` keeps only the listed labels; `without` keeps everything except the listed labels (and always drops
`__name__`). **`by` also drops `__name__`.** Teach `without` for "keep all the dimensions except this one"
and `by` for "collapse to exactly these dimensions".

Examples from the docs:

```promql
count_values("version", build_version)
topk(5, memory_consumption_bytes)
limit_ratio(0.1, app_foo_metric_bar)
sum by (job) (rate(http_requests_total[5m]))
count by (app) (instance_cpu_time_ns)
topk(3, sum by (app, proc) (rate(instance_cpu_time_ns[5m])))
```

### 8.1 `topk` / `bottomk` gotchas — a mandatory sidebar

- They return **the original series with their original labels and values** — not a ranking, not a rewrite.
- For **instant queries** the output is sorted by value. **"No sorting applies to range queries."**
- In a **range query** `topk` is evaluated **independently at every step**, so the set of series in the
  result changes from step to step. A `topk(5, …)` panel over 6 hours can easily contain 40 distinct
  series and look like spaghetti. Fixes:
  - pin the ranking with `@ end()`:
    `topk(5, sum by (instance) (rate(x[5m])) @ end())` — but note this pins the *values* too;
  - or use the standard two-step idiom that keeps live values but a fixed membership:

    ```promql
    sum by (instance) (rate(node_network_receive_bytes_total[$__rate_interval]))
      and
    topk(5, sum by (instance) (rate(node_network_receive_bytes_total[$__rate_interval])) @ end())
    ```
- `topk(k, …)` with `by`/`without` picks the top k **within each group**:
  `topk(3, x) by (job)` → 3 per job.
- `limitk` / `limit_ratio` exist for *sampling* high-cardinality output cheaply, not for ranking.

---

## 9. Binary operators

### 9.1 Arithmetic

`+ - * / % ^` — IEEE 754 semantics. Between two scalars → scalar. Between a vector and a scalar → applied
to each sample, **metric name dropped**. Between two vectors → element-wise after **vector matching**
(see 9.4), **metric name dropped**.

Histogram behaviour:
- `*` multiplies bucket populations, count and sum by the scalar. A negative scalar yields a **gauge** histogram.
- `/` is only valid with the histogram on the **left**. Division by zero gives `+Inf` / `-Inf` / `NaN`.
- Any other arithmetic involving a histogram removes the element with an **info-level annotation**.
- Unary minus on a histogram inverts every bucket population, the count and the sum, producing a gauge
  histogram. Negative histograms are valid only as **intermediate** results — they cannot be a recording
  rule's output and cannot be ingested.

### 9.2 Comparison and the `bool` modifier

`== != > < >= <=`.

- **Without `bool`:** the operator **filters** — elements where the comparison is false are dropped.
- **With `bool`:** returns `1` for true and `0` for false instead of filtering; the **metric name is dropped**.
  Elements that fail *vector matching* still produce no result at all.
- **Between two scalars the `bool` modifier is required.**

```promql
node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.1        # filter: only the bad ones
(node_filesystem_avail_bytes / node_filesystem_size_bytes < bool 0.1) # 1/0 series for every filesystem
```

Only `==` and `!=` work between histogram samples; other comparisons drop the element with an info annotation.

The `bool` idiom the book needs for error ratios and SLOs:

```promql
# fraction of instances currently above threshold
avg(up == bool 1)
```

### 9.3 Logical / set operators

Vector-to-vector only: `and`, `or`, `unless`.

- `and` — intersection: elements of the **left** side that have a matching label set on the right.
  Values and metric name come from the left.
- `or` — union: all elements of the left, plus elements of the right whose label set has no match on the left.
- `unless` — complement: elements of the left with **no** match on the right.

They also accept `on(...)` / `ignoring(...)`. Matching is on the **full label set** by default.

Canonical uses:

```promql
# only alert on latency when there is meaningful traffic
histogram_quantile(0.95, sum by (le, job) (rate(http_request_duration_seconds_bucket[5m]))) > 0.5
  and
sum by (job) (rate(http_requests_total[5m])) > 1

# suppress during maintenance
some_alert_expr unless on (instance) maintenance_mode == 1

# default to zero when the series is missing
sum(rate(errors_total[5m])) or vector(0)
```

### 9.4 Vector matching — the worked example (verbatim from the docs)

Example data set:

```
method_code:http_errors:rate5m{method="get", code="500"}  24
method_code:http_errors:rate5m{method="get", code="404"}  30
method_code:http_errors:rate5m{method="put", code="501"}  3
method_code:http_errors:rate5m{method="post", code="500"} 6
method_code:http_errors:rate5m{method="post", code="404"} 21

method:http_requests:rate5m{method="get"}  600
method:http_requests:rate5m{method="del"}  34
method:http_requests:rate5m{method="post"} 120
```

**One-to-one** (default). Two elements match if they have **exactly the same label set** after applying
`on(...)` / `ignoring(...)` (the metric name is never part of matching). Unmatched elements on either side
simply vanish from the result.

```promql
method_code:http_errors:rate5m{code="500"} / ignoring(code) method:http_requests:rate5m
```

```
{method="get"}  0.04      // 24 / 600
{method="post"} 0.05      //  6 / 120
```

`put` and `del` have no counterpart, so they are absent — **silently**. This silent disappearance is the
motivation for the new `fill()` modifiers (9.5).

**Many-to-one with `group_left`.** The `group_left` / `group_right` modifier says which side has the
**higher cardinality** ("many"); the arrow points at the "many" side.

```promql
method_code:http_errors:rate5m / ignoring(code) group_left method:http_requests:rate5m
```

```
{method="get", code="500"}  0.04      // 24 / 600
{method="get", code="404"}  0.05      // 30 / 600
{method="post", code="500"} 0.05      //  6 / 120
{method="post", code="404"} 0.175     // 21 / 120
```

Rules to state explicitly:

- Group modifiers may **only** be used with arithmetic and comparison operators — **not** with
  `and`, `or`, `unless`.
- The label list *inside* `group_left(...)` / `group_right(...)` names **extra labels copied from the
  "one" side** into the result. `group_left()` with an empty list copies nothing.
- Labels from the "many" side are always kept.
- "For `on` a label can only appear in one of the lists" — i.e. a label cannot be both a matching label
  and a copied grouping label.
- "Every time series of the result vector must be uniquely identifiable." If two result elements collapse
  to the same label set you get `found duplicate series for the match group ...`. Almost always this means
  you picked the wrong side for `group_left`/`group_right`, or you need more labels in `on(...)`.

**The classic real-world many-to-one: enrich metrics from an info metric.**

```promql
rate(http_server_request_duration_seconds_count[2m])
* on (job, instance) group_left (k8s_cluster_name)
  target_info
```

Because `target_info` is always `1`, multiplying by it is a no-op on the value and the whole point is the
**label copy**. Alternatives with the same shape:

```promql
node_filesystem_avail_bytes
  * on (instance) group_left (nodename)
    node_uname_info

kube_pod_container_resource_requests{resource="cpu"}
  * on (namespace, pod) group_left (node)
    kube_pod_info
```

### 9.5 `fill()`, `fill_left()`, `fill_right()` — new binop modifiers

**Experimental. `--enable-feature=promql-binop-fill-modifiers`. Added in 3.10.0.**
This directly fixes the "one side is missing so the whole result silently disappears" problem.

```promql
rate(successful_requests[5m])
+ fill(0)
rate(failed_requests[5m])
```

- `fill(<value>)` fills missing matches on **either** side.
- `fill_left(<value>)` fills missing matches on the **left** side.
- `fill_right(<value>)` fills missing matches on the **right** side.

3.13.0 additions: the UI prettifier collapses `fill_left(x) fill_right(x)` to `fill(x)` when the values are
equal, and a bug where `fill_left`/`fill_right` produced missing samples together with
`group_left`/`group_right` was fixed.

Until this is stable, the book should teach the classic workarounds:
`... or vector(0)`, `... unless ...`, and `sum(... or on() vector(0))`.

### 9.6 Native-histogram trim operators `</` and `>/`

**Added in 3.11.0. Not flagged as experimental in the docs.**

- `h </ 0.5` — **trim upper**: removes all observations **above** the threshold.
- `h >/ 0.1` — **trim lower**: removes all observations **below** the threshold.

Left side must be a native histogram (exponential or NHCB), right side a float threshold. When the
threshold falls inside a bucket, interpolation is applied — **linear** for NHCB buckets and for the zero
bucket of an exponential histogram, **exponential** for non-zero exponential buckets — and the sum of
observations is recomputed from what is left.

Useful for "latency of requests under 1s only" style analysis. Probably too advanced for the main track;
put it in the native-histogram chapter as a short note.

### 9.7 Operator precedence (highest → lowest)

```
1. ^                       (right-associative)
2. * / % atan2
3. + -
4. == != <= < >= >
5. and unless
6. or
```

Everything except `^` is left-associative. Two consequences to warn about:

- `a / b * 100` is `(a / b) * 100` — fine.
- `2 ^ 3 ^ 2` is `2 ^ (3 ^ 2)` = 512, not 64.
- `x > 1 and y > 2` parses as `(x > 1) and (y > 2)` — comparison binds tighter than `and`. Good.
- But `a or b and c` is `a or (b and c)`. Parenthesise when in doubt.

---

## 10. Label manipulation

### 10.1 `label_replace`

```
label_replace(v instant-vector, dst_label string, replacement string, src_label string, regex string)
```

Matches `regex` against the value of `src_label`. On match, `dst_label` in the output is set to the
expansion of `replacement`; the original labels are kept. Capture groups are `$1`, `$2`, … and **named**
groups are `$name`. **If the regex does not match, the series is returned unchanged.**

```promql
label_replace(up{job="api-server",service="a:c"}, "foo", "$1", "service", "(.*):.*")
label_replace(up{job="api-server",service="a:c"}, "foo", "$name", "service", "(?P<name>.*):(?P<version>.*)")
```

Notes:
- The regex here is **not** automatically anchored the way selector matchers are — it is a normal RE2 match
  against the whole label value with capture groups. Anchor it yourself when you mean to.
- Setting `dst_label` to `""` **removes** the label.
- Common use: normalise `instance="10.0.0.4:9100"` down to a hostname:
  `label_replace(up, "host", "$1", "instance", "([^:]+):.*")`

### 10.2 `label_join`

```
label_join(v instant-vector, dst_label string, separator string, src_label_1 string, src_label_2 string, ...)
```

```promql
label_join(up{job="api-server",src1="a",src2="b",src3="c"}, "foo", ",", "src1", "src2", "src3")
```

Produces `foo="a,b,c"`. Any number of source labels.

### 10.3 `info()` — the new join shortcut

**Experimental. `--enable-feature=promql-experimental-functions`. Added in 3.9.0.**

```
info(v instant-vector, [data-label-selector instant-vector])
```

"finds, for each time series in `v`, all info series with matching identifying labels …, and adds the union
of their data (i.e., non-identifying) labels to the time series."

The second argument "is not a real instant vector, but uses a subset of its syntax. It must start and end
with curly braces (`{ ... }`) and may only contain label matchers."

Before:

```promql
rate(http_server_request_duration_seconds_count[2m])
* on (job, instance) group_left (k8s_cluster_name)
  target_info
```

After:

```promql
info(
  rate(http_server_request_duration_seconds_count[2m]),
  {k8s_cluster_name=~".+"}
)
```

or, to pull in every data label:

```promql
info(rate(http_server_request_duration_seconds_count[2m]))
```

Behaviour when the info series is missing at a timestamp:

- if `data-label-selector` contains any matcher that does **not** match the empty string (e.g. `{data=~".+"}`),
  the series is **dropped** at that timestamp;
- if all matchers match the empty string (`{data=~".*"}`) or no selector is given, the series is returned
  **unenriched**.

Current limitations, verbatim in spirit: `info` "defaults to considering only info series with the name
`target_info`" and "assumes that the identifying info series labels are `instance` and `job`". Other info
series are reachable via a `__name__` matcher inside the selector.

This is a strong candidate for a "the future of joins" sidebar; the `group_left` form must still be taught
as the portable answer.

---

## 11. Histograms and quantiles

### 11.1 The three things called "a histogram" in 2026

| | series shape | `le` label | aggregatable | status |
|---|---|---|---|---|
| **Summary** | `x{quantile="0.95"}`, `x_sum`, `x_count` | no | **NO** | legacy; avoid |
| **Classic histogram** | `x_bucket{le="..."}`, `x_sum`, `x_count` | **yes** | yes | still the default in most client libraries |
| **Native histogram** | **one** series named `x` | **no** | yes | **stable since Prometheus 3.8.0**, opt-in |
| **NHCB** (native histogram with custom buckets) | one series named `x`, schema `-53` | no | partly | server-side conversion of classic histograms |

The docs' own recommendation is blunt: "If you can, use native histograms and prefer them over both
classic histograms and summaries."

**Book plan:** teach classic histograms first (that is what the reader's client library emits by default and
what every existing dashboard uses), then add native histograms as an explicit upgrade with its own lab step.

### 11.2 Classic histograms and the `le` label

A classic histogram called `http_request_duration_seconds` with buckets `0.1, 0.5, 1, +Inf` produces:

```
http_request_duration_seconds_bucket{le="0.1"}   # count of observations <= 0.1
http_request_duration_seconds_bucket{le="0.5"}   # count of observations <= 0.5   (INCLUDES the 0.1 bucket)
http_request_duration_seconds_bucket{le="1.0"}
http_request_duration_seconds_bucket{le="+Inf"}  # == http_request_duration_seconds_count
http_request_duration_seconds_sum
http_request_duration_seconds_count
```

Key facts:

- `le` means **less-or-equal**, and buckets are **cumulative**. `{le="0.5"}` is *not* "observations between
  0.1 and 0.5"; it is "observations ≤ 0.5". Beginners get this wrong constantly.
- The `+Inf` bucket is mandatory and equals `_count`.
- Every bucket is a separate time series — a 10-bucket histogram with 5 label combinations is 60 series.
  This is the cardinality cost that motivated native histograms.

**Prometheus 3.0 breaking change:** values of the `le` label (classic histograms) and `quantile` label
(summaries) are **normalised on ingestion**. `le="1"` becomes `le="1.0"`. Any query, dashboard or rule
matching `le="1"` silently returns nothing after upgrading. Fix the query or add metric_relabel_configs.
**Print this. It is a genuine "my dashboard broke" trap.**

The exact mechanism, read from the source on 2026-07-27 so the book can state the rule precisely rather
than hand-wave it. In `model/textparse/openmetricsparse.go`:

```go
// normalizeFloatsInLabelValues ensures that values of the "le" labels of classic histograms and "quantile" labels
// of summaries follow OpenMetrics formatting rules.
func normalizeFloatsInLabelValues(t model.MetricType, l, v string) string {
	if (t == model.MetricTypeSummary && l == model.QuantileLabel) || (t == model.MetricTypeHistogram && l == model.BucketLabel) {
		f, err := strconv.ParseFloat(v, 64)
		if err == nil {
			return labels.FormatOpenMetricsFloat(f)
		}
	}
	return v
}
```

and `labels.FormatOpenMetricsFloat` (in `model/labels/float.go`) "works like the usual Go string formatting
of a float but appends `.0` if the resulting number would otherwise contain neither a `.` nor an `e`",
with these hardcoded cases:

| input | normalised `le` / `quantile` value |
|---|---|
| `1` | `"1.0"` |
| `0` | `"0.0"` |
| `-1` | `"-1.0"` |
| `NaN` | `"NaN"` |
| `+Inf` | `"+Inf"` |
| `-Inf` | `"-Inf"` |
| `0.5` | `"0.5"` (already contains `.`) |
| `100000000` | `"1e+08"` (Go `%g`) |

Three consequences worth stating explicitly:

1. `le="1"`, `le="1.00"` and `le="+Inf"`-vs-`le="Inf"` mismatches are the common breakages.
2. Normalisation only applies when the **metric type is known** to be a histogram/summary from the
   exposition metadata. Series that arrive without type metadata are **not** normalised.
3. The large-number case (`1e+08`) surprises people writing byte-size buckets. Match on what
   `/api/v1/label/le/values` actually returns, not on what you wrote in your instrumentation.

### 11.3 `histogram_quantile` on classic histograms

```promql
histogram_quantile(0.9, rate(http_request_duration_seconds_bucket[10m]))
```

The **mandatory** shape is: `rate()` (or `increase()`) **first**, then aggregate, then `histogram_quantile`.
Why `rate()` first: the buckets are counters. Without `rate()` you get the quantile over all history since
process start, which never changes and is useless.

When aggregating, **`le` must survive the `by` clause**:

```promql
histogram_quantile(0.9, sum by (job, le) (rate(http_request_duration_seconds_bucket[10m])))
histogram_quantile(0.9, sum by (le)      (rate(http_request_duration_seconds_bucket[10m])))
```

Forgetting `le` is the most common histogram bug in existence. The failure mode is not an error — you get
nonsense or nothing.

Estimation rules for classic histograms:

- Within a bucket, observations are assumed **uniformly distributed** → **linear interpolation**.
- Fewer than two buckets → `NaN`.
- The highest bucket must have upper bound `+Inf`, otherwise `NaN`.
- If the quantile lands in the **highest** (`+Inf`) bucket, the **second-highest bucket's upper bound** is
  returned. So your p99 can never exceed your largest finite bucket boundary — a p99 pinned exactly at
  `10` when your top finite bucket is `10` means "we don't know, it's ≥ 10". **Sidebar-worthy.**
- The lowest bucket is assumed to have a lower limit of `0` if its upper bound is > 0; otherwise the
  bucket's upper bound is returned.
- Non-monotonic buckets (from `sum`ming across targets scraped at different instants, or float error) are
  silently fixed with an **info-level annotation**: `input to histogram_quantile needed to be fixed for
  monotonicity`. Discrepancies below 1e-12 of the bucket sum are ignored.
- `φ < 0` → `-Inf`; `φ > 1` → `+Inf`; `φ = NaN` → `NaN`; zero observations → `NaN`.

**Your quantile can only be as good as your buckets.** If the true p95 is 228ms and your buckets jump from
200ms to 300ms, the estimate is ~295ms. This is bucket-resolution error, not a Prometheus bug.

### 11.4 `histogram_quantile` on native histograms

No `_bucket` suffix, no `le`, no `by (le)`:

```promql
histogram_quantile(0.9, rate(http_request_duration_seconds[10m]))
histogram_quantile(0.9, sum by (job) (rate(http_request_duration_seconds[10m])))
histogram_quantile(0.9, sum(rate(http_request_duration_seconds[10m])))
```

- For **standard exponential** schemas, interpolation inside a bucket is **exponential** (samples are
  assumed to distribute as if they uniformly populated higher-resolution exponential sub-buckets).
- For **NHCB** (custom buckets, schema `-53`) interpolation is **linear**, same as classic.
- If `NaN` observations exist and the quantile lands in the exponential buckets, results skew high
  (info annotation). If the quantile is above all exponential buckets, `NaN` is returned (info annotation).
- A finite-width **zero bucket** is assumed to contain no negative observations if there are positive
  observations elsewhere, and vice versa.

**Mixing classic and native in one input:** `histogram_quantile` accepts float samples (interpreted as
classic bucket counts, requiring `le`) *and* native histogram samples (each handled individually) in the
same instant vector. During a migration where both forms exist for the same metric this produces confusing
double results — set `always_scrape_classic_histograms: false` once you have cut over.

### 11.5 `histogram_fraction` — usually the better question

```
histogram_fraction(lower scalar, upper scalar, b instant-vector)
```

"returns the estimated fraction of observations between the provided lower and upper values for each
classic or native histogram contained in `b`". Boundaries may be `-Inf` / `+Inf`.

```promql
histogram_fraction(0, 0.2, rate(http_request_duration_seconds[1h]))
```

= "what fraction of requests completed in 200ms or less over the last hour". **This is the SLO question**,
and it is far more useful (and far more numerically honest) than a p95. Teach it right after quantiles.

Apdex, from the docs:

```promql
histogram_fraction(0, 0.3, sum by (job) (rate(http_request_duration_seconds[5m])))
+
histogram_fraction(0.3, 1.2, sum by (job) (rate(http_request_duration_seconds[5m]))) / 2
```

For **classic** histograms the equivalent, if `0.3` is an actual bucket boundary, is the older idiom:

```promql
sum(rate(http_request_duration_seconds_bucket{le="0.3"}[5m])) by (job)
  /
sum(rate(http_request_duration_seconds_count[5m])) by (job)
```

Note the docs' warning about classic buckets and interpolation: "If the histograms involved do not have a
bucket with that boundary, no interpolation is applied. Instead of an estimation, no result is returned at
all." **Pick your SLO thresholds as actual bucket boundaries.**

For native histograms with exponential buckets, `histogram_fraction(-Inf, +Inf, b)` returns the fraction of
**non-`NaN`** observations and may therefore be **less than 1**.

### 11.6 Why averaging quantiles is wrong

The one-paragraph proof for the book:

> A quantile is an **order statistic**, not a mean. Instance A serves 1 request/s with p95 = 10ms.
> Instance B serves 1000 requests/s with p95 = 900ms. The average of the two p95 values is 455ms.
> The **true** p95 across both instances is ~900ms, because 99.9% of the traffic is B's. Averaging
> quantiles produces a number that corresponds to no request that ever happened.

Therefore:

- **NEVER** `avg(http_request_duration_seconds{quantile="0.95"})` — the docs call this "statistically
  nonsensical values". Summaries expose *pre-computed* quantiles, and there is no way to combine them.
  This is the reason summaries are legacy.
- **NEVER** `avg(histogram_quantile(0.95, ...))`. Aggregate the **buckets**, then compute the quantile:
  `histogram_quantile(0.95, sum by (le) (rate(..._bucket[5m])))`.
- Corollary: the same applies over **time**. `avg_over_time(p95_recording_rule[1h])` is also wrong. Use a
  subquery over the buckets, or record the buckets and quantile at read time.

### 11.7 Native histograms: enabling them (config exactness matters)

Timeline, verbatim from the spec:

- v2.40.0 (Nov 2022): experimental, `--enable-feature=native-histograms`.
- **v3.8.0: "native histograms are supported as a stable feature"** — but "scraping native histograms still
  has to be activated explicitly via the `scrape_native_histograms` configuration setting". In 3.8 the old
  flag's "only remaining effect [is] to set `scrape_native_histograms` to `true` by default".
- **v3.9.0: the flag is "a true no-op and explicitly setting `scrape_native_histograms` is required".**
- v4.0+: `scrape_native_histograms` and `send_native_histograms` will default to `true`.

So on **Prometheus 3.13.1 the default is `scrape_native_histograms: false`** and you must write:

```yaml
scrape_configs:
  - job_name: demo-app
    scrape_native_histograms: true
    static_configs:
      - targets: ['demo-app:8080']
```

Related scrape-config options (exact names):

- `always_scrape_classic_histograms: true` — ingest **both** classic and native forms (both must be present
  in the exposition).
- `convert_classic_histograms_to_nhcb: true` — convert classic histograms to NHCBs at ingestion time.
  This is the cheap path to native-histogram storage without touching your instrumentation.
- `native_histogram_bucket_limit` — hard cap on bucket count; exceeding it reduces resolution (lowers schema).
- `native_histogram_min_bucket_factor` — lower bound on the bucket growth factor; violations reduce resolution.

Schema numbers: signed 8-bit. **-4 to +8** are the standard exponential schemas (higher = higher
resolution; "Schema *n* has half the resolution of schema *n*+1"; upper limit of bucket *i* is
`(2**2**-n)**i`). **-53** = NHCB (custom bucket boundaries). -9 to +52 reserved.

The **zero bucket** counts observations in `[-threshold, +threshold]`. Merging histograms with different
thresholds picks the largest threshold, then widens it to a bucket boundary.

In the API/JSON, a native histogram sample looks like:

```json
{
  "count": "<observation_count>",
  "sum": "<observation_sum>",
  "buckets": [[<boundary_rule>, "<left>", "<right>", "<count>"]]
}
```

`boundary_rule`: `0` = open left, `1` = open right, `2` = open both, `3` = closed both.

Native histograms also have two **flavours**: *counter* (buckets are counters — what `rate()` expects) and
*gauge* (an arbitrary point-in-time distribution). `rate`/`increase`/`delta` of a counter histogram return a
**gauge** histogram (fixed in 3.7.0), which is why you can `sum()` them and then take a quantile.

---

## 12. Gauge and statistics functions

### 12.1 `predict_linear`

```
predict_linear(v range-vector, t scalar)
```

"predicts the value of time series `t` seconds from now, based on the range vector `v`, using simple linear
regression. The range vector must have at least two float samples… When `+Inf` or `-Inf` are found in the
range vector, the predicted value will be `NaN`. `predict_linear` should only be used with gauges and only
works for float samples." Histogram-only ranges are ignored entirely; mixed ranges use only the floats
(info-level annotation).

The canonical alert — "this disk fills up within 4 hours, based on the last 6 hours of behaviour":

```promql
predict_linear(node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"}[6h], 4 * 3600) < 0
```

Teaching notes:
- It is **ordinary least squares** over the samples in the window. It knows nothing about seasonality;
  a nightly backup will make it scream.
- The `t` argument is **seconds**, a scalar — `4 * 3600`, not `4h`. (With
  `--enable-feature=promql-duration-expr` you still cannot pass a duration here; keep it numeric.)
- Always pair it with a "and we're actually low" guard so it doesn't fire on a nearly-full-forever disk:

```promql
  predict_linear(node_filesystem_avail_bytes[6h], 4*3600) < 0
and
  node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.2
```

### 12.2 `deriv`

Per-second derivative of each float series in the range, via simple linear regression. At least two float
samples required. **Gauges only** — it does not correct counter resets. Use it where `rate()` would be
wrong because the metric can legitimately go down (queue depth, temperature, free memory).

### 12.3 `changes`

"returns the number of times its value has changed within the provided time range as an instant vector."

Uses:

```promql
changes(process_start_time_seconds[1h]) > 3          # flapping / crashlooping process
changes(kube_deployment_status_replicas[30m])        # churn
```

Careful: for a counter that increases every scrape, `changes()` is just "number of scrapes minus one" —
meaningless. It is a **gauge/discrete-state** function.

### 12.4 `resets`

"returns the number of counter resets within the provided time range… Any decrease in the value between
two consecutive float samples is interpreted as a counter reset." For native histograms a reset is any
decrease in any bucket (including zero bucket) or in the observation count, plus the disappearance of a
previously populated bucket, a decrease of the zero-bucket width, or an incompatible schema change.
**Counters only.**

```promql
resets(process_cpu_seconds_total[1h]) > 0   # this process restarted in the last hour
```

Since 3.12.0 with `--enable-feature=use-start-timestamps`, `resets()` also counts start-timestamp resets.

### 12.5 `stddev` / `stdvar` and `stddev_over_time` / `stdvar_over_time`

Two different axes, and the book must not conflate them:

- **`stddev(v)` / `stdvar(v)`** are **aggregation operators**: spread **across series** at one instant.
  "How different are my 20 instances from each other right now?" Population (not sample) statistics.
  Floats only; histogram samples ignored.
- **`stddev_over_time(v[5m])` / `stdvar_over_time(v[5m])`** are **range functions**: spread **over time**
  for a single series. "How jittery has this one series been?" Population statistics. Floats only.

Outlier-detection idiom (a nice hands-on exercise):

```promql
abs(
  node_load1
  - on (job) group_left avg by (job) (node_load1)
)
> on (job) group_left 3 * stddev by (job) (node_load1)
```

`mad_over_time` **[EXP]** (median absolute deviation) is the robust alternative to `stddev_over_time` when
outliers dominate.

---

## 13. Canonical worked expressions

### 13.1 RED (Rate, Errors, Duration) — per service

Assume a counter `http_requests_total{job, instance, method, route, status}` and a classic histogram
`http_request_duration_seconds_bucket{job, instance, method, route, le}`.

**R — request rate (per second), by route:**

```promql
sum by (route) (rate(http_requests_total{job="demo-app"}[$__rate_interval]))
```

**E — error ratio (fraction of requests that are 5xx), by route:**

```promql
  sum by (route) (rate(http_requests_total{job="demo-app", status=~"5.."}[$__rate_interval]))
/
  sum by (route) (rate(http_requests_total{job="demo-app"}[$__rate_interval]))
```

Notes that must accompany this expression:

- Both sides are aggregated **the same way** (`sum by (route)`), so vector matching is one-to-one and
  succeeds. If you write `... / sum(rate(...))` without `by (route)` it will match nothing.
- Routes with **zero errors have no series on the numerator at all**, so they vanish from the result rather
  than showing `0`. Fixes: `or vector(0)` at the end (loses labels), a `... or (0 * <denominator>)` trick,
  or — with the flag — `+ fill(0)` / an explicit `fill_left(0)` on the division.
- Multiply by 100 only in the panel's unit, not in the query. Keep the query a ratio; Grafana's `percentunit`
  unit renders `0.023` as `2.3%`.

Whole-service version (the number for an SLO):

```promql
  sum(rate(http_requests_total{job="demo-app", status=~"5.."}[5m]))
/
  sum(rate(http_requests_total{job="demo-app"}[5m]))
```

**D — duration, p95, classic histogram:**

```promql
histogram_quantile(
  0.95,
  sum by (le, route) (rate(http_request_duration_seconds_bucket{job="demo-app"}[$__rate_interval]))
)
```

**D — duration, p95, native histogram:**

```promql
histogram_quantile(
  0.95,
  sum by (route) (rate(http_request_duration_seconds{job="demo-app"}[$__rate_interval]))
)
```

**D — the better SLO form (fraction under target):**

```promql
# native histogram
histogram_fraction(0, 0.3, sum by (route) (rate(http_request_duration_seconds[$__rate_interval])))

# classic histogram, 0.3 must be a real bucket boundary
  sum by (route) (rate(http_request_duration_seconds_bucket{le="0.3"}[$__rate_interval]))
/
  sum by (route) (rate(http_request_duration_seconds_count[$__rate_interval]))
```

**Average latency** (cheap, and legitimately aggregatable — unlike a quantile):

```promql
  sum by (route) (rate(http_request_duration_seconds_sum[$__rate_interval]))
/
  sum by (route) (rate(http_request_duration_seconds_count[$__rate_interval]))
```

**Recording rules for the same three**, following the official `level:metric:operations` convention
(level = output aggregation level and labels; metric = the metric name with `_total` stripped when
`rate`/`irate` is applied; operations = newest first, `sum` implied, `_per_` for division, result named `ratio`):

```yaml
groups:
  - name: demo-app-red
    interval: 30s
    rules:
      - record: route:http_requests:rate5m
        expr: sum by (route) (rate(http_requests_total{job="demo-app"}[5m]))

      - record: route:http_requests_errors:rate5m
        expr: sum by (route) (rate(http_requests_total{job="demo-app", status=~"5.."}[5m]))

      - record: route:http_requests_errors_per_requests:ratio_rate5m
        expr: route:http_requests_errors:rate5m / route:http_requests:rate5m

      - record: route:http_request_duration_seconds_bucket:rate5m
        expr: sum by (route, le) (rate(http_request_duration_seconds_bucket{job="demo-app"}[5m]))
```

Then the dashboard reads `histogram_quantile(0.95, route:http_request_duration_seconds_bucket:rate5m)`.
**Never record a quantile** — record the buckets, quantile at read time (see 11.6).

### 13.2 An alert that does not cry wolf

```yaml
- alert: HighErrorRatio
  expr: |
    (
        sum by (job, route) (rate(http_requests_total{status=~"5.."}[5m]))
      /
        sum by (job, route) (rate(http_requests_total[5m]))
    ) > 0.05
    and
    sum by (job, route) (rate(http_requests_total[5m])) > 1
  for: 10m
  labels:
    severity: page
  annotations:
    summary: "{{ $labels.job }} {{ $labels.route }} error ratio {{ $value | humanizePercentage }}"
```

The `and ... > 1` guard is the anti-wolf clause: 1 error out of 2 requests is 50% and means nothing.

### 13.3 USE (Utilization, Saturation, Errors) — node_exporter

**CPU utilization** (fraction of CPU time not idle, per instance):

```promql
1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[$__rate_interval]))
```

Per-mode breakdown for a stacked graph:

```promql
sum by (instance, mode) (rate(node_cpu_seconds_total{mode!="idle"}[$__rate_interval]))
  / on (instance) group_left
count by (instance) (count by (instance, cpu) (node_cpu_seconds_total))
```

**CPU saturation** (run-queue pressure — load per core):

```promql
  node_load1
/ on (instance) group_left
  count by (instance) (count by (instance, cpu) (node_cpu_seconds_total{mode="idle"}))
```

Better, if `node_pressure_cpu_waiting_seconds_total` (PSI) is available:

```promql
rate(node_pressure_cpu_waiting_seconds_total[$__rate_interval])
```

**CPU errors:** node_exporter exposes none. Say so — the USE method's honest answer is sometimes "not
measurable with this exporter".

**Memory utilization:**

```promql
1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)
```

**Memory saturation** (swapping / reclaim pressure):

```promql
rate(node_vmstat_pgmajfault[$__rate_interval])
rate(node_pressure_memory_waiting_seconds_total[$__rate_interval])
```

**Disk utilization** (fraction of wall time the device was busy):

```promql
rate(node_disk_io_time_seconds_total[$__rate_interval])
```

**Disk saturation:**

```promql
rate(node_disk_io_time_weighted_seconds_total[$__rate_interval])
```

**Filesystem fullness** (utilization of a *capacity* resource, not a throughput resource):

```promql
1 - (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes)
```

**Network utilization / errors:**

```promql
rate(node_network_receive_bytes_total{device!="lo"}[$__rate_interval]) * 8      # bits/s
rate(node_network_transmit_bytes_total{device!="lo"}[$__rate_interval]) * 8
rate(node_network_receive_errs_total[$__rate_interval])
rate(node_network_transmit_errs_total[$__rate_interval])
rate(node_network_receive_drop_total[$__rate_interval])                         # saturation proxy
```

**Note:** the node_exporter metric names above are the long-standing 1.x names and are stable, but they were
**not re-verified against the current node_exporter release in this research pass — mark UNVERIFIED and
confirm against a running `node_exporter` in the lab before printing.** (`node_pressure_*` PSI metrics in
particular require a Linux kernel with PSI enabled.)

---

## 14. Pitfalls the book must actively defuse

1. **Range vector in a graph panel.** `foo[5m]` in a Grafana time-series panel is an error. Range vectors
   only exist inside functions.
2. **Regexes are anchored.** `=~"error"` will not match `"http_error"`.
3. **`.` matches newline in 3.x.** Different from 2.x.
4. **Range selectors are left-open in 3.x.** `foo[1m:1m]` may give one point.
5. **`rate()` needs ≥ 2 samples; fewer means the series silently disappears.** Use ≥ 4x scrape interval.
6. **`rate()` on a gauge** silently produces nonsense (it "corrects" every legitimate decrease as a reset).
   `delta()`/`deriv()` are the gauge equivalents.
7. **`delta()` on a counter** goes negative on restarts.
8. **`sum(rate(x))` vs `rate(sum(x))`.** Always `rate()` **inside**, `sum()` **outside**. `rate(sum(x)[5m:])`
   loses counter-reset correction across the individual series and is wrong.
9. **Forgetting `le` in `by()`** when computing classic-histogram quantiles.
10. **`le="1"` vs `le="1.0"`** after the 3.0 normalisation.
11. **Averaging quantiles.**
12. **Recording a quantile** instead of recording buckets.
13. **`increase()` is not an integer** — and rounding it to look pretty is hiding an estimate.
14. **`irate()` in alerts** — spikes reset the `for:` clause.
15. **One-to-one matching silently drops unmatched series**, so ratios lose the "zero errors" case.
    (`fill()` fixes this once stable.)
16. **`group_left` on the wrong side** → `found duplicate series for the match group`.
17. **`absent(sum(x))` has no labels** and so cannot route an alert.
18. **`topk` in a range query** re-ranks at every step.
19. **`sort()` in a range query does nothing** (and warns since 3.12).
20. **Gauges keep their last value for 5 minutes** when there is no staleness marker.
21. **Comparison operators filter; they do not return booleans** unless you add `bool`.
22. **Metric name is dropped** by every function, arithmetic operator, `bool` comparison, and aggregation.
    Two different metrics reduced to the same label set collide:
    `vector cannot contain metrics with the same labelset`. Workarounds: `label_replace` to re-add a
    distinguishing label, or `--enable-feature=promql-delayed-name-removal`.
23. **`x or vector(0)`** does not do what people expect when `x` has labels — `vector(0)` has no labels, so
    it only fills in when `x` is **completely** empty, and the filled series has no labels.
24. **`count(up)` vs `count(up == 1)`** — the second filters first. `sum(up)` is usually what you meant.
25. **`up` is synthetic** — it is generated by Prometheus per target, not exposed by the target.
26. **Query limits are real:** `--query.timeout` 2m, `--query.max-samples` 50000000,
    `--query.max-concurrency` 20. Exceeding max-samples aborts the query.
27. **Instant query in a Grafana table panel vs range query in a graph** produce different-looking results
    from the same expression. Teach the toggle.

---

## 15. What changed recently — a timeline for "is this book current?"

| Version | Date | PromQL-relevant change |
|---|---|---|
| 3.0.0 | 2024-11-14 | Range selectors become **left-open**; `.` matches `\n` in regexes; `holt_winters` → `double_exponential_smoothing` **[EXP]**; `le`/`quantile` label values normalised (`1` → `1.0`); UTF-8 names with quoted-name selector syntax; float/duration literal interchangeability stable |
| 3.2.0 | 2025-02-17 | UTF-8 in relabeling and rule names |
| 3.3.0 | 2025-04-15 | `idelta()` and `irate()` for native histograms |
| 3.4.0 | 2025-05-17 | **Duration arithmetic** in PromQL duration expressions (`promql-duration-expr`) |
| 3.5.0 | 2025-07-14 | `histogram_stdvar()`, `histogram_stddev()`; **3.5 became the previous LTS** |
| 3.6.0 | 2025-09-17 | `step()` and duration `min`/`max` in duration expressions; `ts_of_(min|max|last)_over_time` **[EXP]**; type/unit labels **[EXP]** |
| 3.7.0 | 2025-10-15 | `anchored` / `smoothed` extended range selectors **[EXP]**; `first_over_time()`, `ts_of_first_over_time()` **[EXP]**; `rate`/`increase`/`delta` of histograms now return **gauge** histograms |
| 3.8.0 | 2025-11-28 | **Native histograms stable** (`scrape_native_histograms` config); `promql-delayed-name-removal` **[EXP]**; `sort_by_label` / `sort_by_label_desc` **[EXP]** |
| 3.9.0 | 2026-01-06 | `native-histograms` feature flag becomes a **no-op**; `info()` **[EXP]** |
| 3.10.0 | 2026-02-24 | `fill()` / `fill_left()` / `fill_right()` binop modifiers **[EXP]** |
| 3.11.0 | 2026-04-02 | `</` and `>/` native-histogram **trim** operators; `histogram_quantiles()` **[EXP]**; extended range selectors extended |
| 3.12.0 | 2026-05-28 | `start()`, `end()`, `range()`, `step()` functions **[EXP]**; `use-start-timestamps` for `rate`/`irate`/`increase`; `resets()` considers ST resets; warning when `sort*` used in range queries |
| 3.13.0 | 2026-07-01 | **LTS.** duration `min`/`max` renamed `min_of`/`max_of`; smoothed/anchored rate for native histograms; per-query `samplesRead` in stats |
| 3.13.1 | 2026-07-10 | current latest patch |

### Feature flags relevant to PromQL (exact strings)

```
--enable-feature=promql-experimental-functions
--enable-feature=promql-duration-expr
--enable-feature=promql-extended-range-selectors
--enable-feature=promql-binop-fill-modifiers
--enable-feature=promql-delayed-name-removal
--enable-feature=promql-per-step-stats
--enable-feature=use-start-timestamps
--enable-feature=type-and-unit-labels
```

Full `--enable-feature` list accepted by Prometheus 3.13.x:
`concurrent-rule-eval, created-timestamp-zero-ingestion, delayed-compaction, exemplar-storage,
extra-scrape-metrics, memory-snapshot-on-shutdown, metadata-wal-records, old-ui, otlp-deltatocumulative,
otlp-native-delta-ingestion, promql-binop-fill-modifiers, promql-delayed-name-removal, promql-duration-expr,
promql-experimental-functions, promql-extended-range-selectors, promql-per-step-stats, search-api,
st-storage, st-synthesis, type-and-unit-labels, use-start-timestamps, use-uncached-io, xor2-encoding`

Note what is **absent**: `native-histograms`, `promql-at-modifier`, `promql-negative-offset`. Those are all
stable-and-unflagged now. Any source telling you to enable them is out of date.

### Query-related server flags and defaults

| Flag | Default |
|---|---|
| `--query.lookback-delta` | `5m` |
| `--query.timeout` | `2m` |
| `--query.max-concurrency` | `20` |
| `--query.max-samples` | `50000000` |

### HTTP API surface the book will use

- `GET|POST /api/v1/query` — params: `query`, `time`, `timeout`, `limit`, `lookback_delta`, `stats`
- `GET|POST /api/v1/query_range` — params: `query`, `start`, `end`, `step`, `timeout`, `limit`,
  `lookback_delta`, `stats`
- `resultType` is one of `vector`, `matrix`, `scalar`, `string`
- annotations arrive as top-level `warnings` and `infos` string arrays
- `stats=all` returns `timings`, `samples.totalQueryableSamples`, `samples.samplesRead`,
  `samples.peakSamples` (per-step stats need `--enable-feature=promql-per-step-stats`)
- use **POST** for long queries — URLs have server-side length limits

```json
{
  "resultType": "vector",
  "result": [
    {
      "metric": {"__name__": "up", "job": "prometheus"},
      "value": [1435781451.781, "1"]
    }
  ]
}
```

---

## 16. Stale advice to strike from any pre-2024 source

- "`@` and negative offsets need a feature flag" — **false since 2.x-late; gone in 3.x.**
- "Native histograms need `--enable-feature=native-histograms`" — **false; stable since 3.8.0, flag is a
  no-op since 3.9.0. You need `scrape_native_histograms: true` in the scrape config instead.**
- "Use `holt_winters`" — **renamed and flagged.**
- "Range selectors are inclusive on both ends" — **false since 3.0.**
- "`.` doesn't match newlines in PromQL regexes" — **false since 3.0.**
- "Match `le="1"`" — **normalised to `le="1.0"` since 3.0.**
- "Prometheus 2.x is current" — 2.x is end-of-life; 3.13 is current and 3.13.0 is the LTS.
- "Use summaries for latency" — summaries cannot be aggregated; use histograms.
- "Record `job:latency:p95`" — recording a quantile destroys the ability to re-aggregate.
- "`rate()` requires the range to be at least 2x the scrape interval" — technically the minimum, but the
  actual guidance is **4x**.
- "Kubernetes is where you learn Prometheus" — irrelevant to this book's main track by design.
- Grafana "Graph (old)" panel, `$interval` (single underscore), and the Angular plugin ecosystem are gone
  in Grafana 12/13; use the **Time series** panel and `$__interval` / `$__rate_interval`.

---

## 17. Sources

All fetched and read on 2026-07-27.

**Prometheus official documentation**
- Querying basics — https://prometheus.io/docs/prometheus/latest/querying/basics/
- Operators — https://prometheus.io/docs/prometheus/latest/querying/operators/
- Query functions — https://prometheus.io/docs/prometheus/latest/querying/functions/
- Query examples — https://prometheus.io/docs/prometheus/latest/querying/examples/
- HTTP API — https://prometheus.io/docs/prometheus/latest/querying/api/
- Feature flags — https://prometheus.io/docs/prometheus/latest/feature_flags/
- Prometheus 3.0 migration guide — https://prometheus.io/docs/prometheus/latest/migration/
- Command-line flags — https://prometheus.io/docs/prometheus/latest/command-line/prometheus/
- Histograms and summaries (practices) — https://prometheus.io/docs/practices/histograms/
- Recording rules (practices) — https://prometheus.io/docs/practices/rules/
- Native histograms specification — https://prometheus.io/docs/specs/native_histograms/
- UTF-8 in Prometheus — https://prometheus.io/docs/guides/utf8/
- UTF-8 escaping schemes — https://prometheus.io/docs/instrumenting/escaping_schemes/
- Data model — https://prometheus.io/docs/concepts/data_model/
- Subquery support (blog, 2019) — https://prometheus.io/blog/2019/01/28/subquery-support/
- Announcing Prometheus 3.0 — https://prometheus.io/blog/2024/11/14/prometheus-3-0/

**Prometheus source and releases**
- Releases index — https://github.com/prometheus/prometheus/releases
- Releases via API (used to pin 3.13.1 / 3.13.0 / 3.5.5 dates) — https://api.github.com/repos/prometheus/prometheus/releases
- CHANGELOG — https://raw.githubusercontent.com/prometheus/prometheus/main/CHANGELOG.md

**Read verbatim at the `v3.13.1` tag (second pass, 2026-07-27) — these pin what is true in the *current
release* as opposed to `main`**
- `docs/querying/basics.md` — https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/querying/basics.md
- `docs/querying/functions.md` — https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/querying/functions.md
- `docs/querying/operators.md` — https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/querying/operators.md
- `docs/feature_flags.md` — https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/feature_flags.md
- `cmd/prometheus/main.go` (the `--enable-feature` switch) — https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/cmd/prometheus/main.go

**Read verbatim at `main` (the future release; differs from `latest` on the website)**
- `docs/querying/basics.md`, `functions.md`, `operators.md`, `feature_flags.md`, `command-line/prometheus.md`, `querying/api.md`, `querying/examples.md`
- `promql/functions.go` — `extrapolatedRate`, `extendedRate`, `extendedHistogramRate`, `histogramRate` — https://raw.githubusercontent.com/prometheus/prometheus/main/promql/functions.go
- `promql/engine.go` — `runSubquery` (subquery step alignment) — https://raw.githubusercontent.com/prometheus/prometheus/main/promql/engine.go
- `model/textparse/openmetricsparse.go` — `normalizeFloatsInLabelValues` (the `le`/`quantile` trap) — https://raw.githubusercontent.com/prometheus/prometheus/main/model/textparse/openmetricsparse.go
- `model/labels/float.go` — `FormatOpenMetricsFloat` — https://raw.githubusercontent.com/prometheus/prometheus/main/model/labels/float.go
- `cmd/prometheus/main.go` — https://raw.githubusercontent.com/prometheus/prometheus/main/cmd/prometheus/main.go

**Design proposals (primary, for anchored/smoothed rationale)**
- PROM-52, Extended range selectors semantics — https://raw.githubusercontent.com/prometheus/proposals/main/proposals/0052-extended-range-selectors-semantics.md
  (note: the older path `2025-04-04_extended-range-selectors-semantics.md` is now just a redirect stub)

**node_exporter (canonical USE expressions)**
- node-mixin recording rules — https://raw.githubusercontent.com/prometheus/node_exporter/master/docs/node-mixin/rules/rules.libsonnet

**USE method (primary)**
- Brendan Gregg, The USE Method — https://www.brendangregg.com/usemethod.html
- v3.8.0 release notes — https://github.com/prometheus/prometheus/releases/tag/v3.8.0
- v3.11.0 release notes — https://github.com/prometheus/prometheus/releases/tag/v3.11.0
- v3.12.0 release notes — https://github.com/prometheus/prometheus/releases/tag/v3.12.0
- v3.13.0 (LTS) release notes — https://github.com/prometheus/prometheus/releases/tag/v3.13.0
- `promql/functions.go` (extrapolatedRate) — https://raw.githubusercontent.com/prometheus/prometheus/main/promql/functions.go
- UTF-8 proposal — https://github.com/prometheus/proposals/blob/main/proposals/0028-utf8.md

**Grafana**
- Releases index — https://github.com/grafana/grafana/releases
- Prometheus query editor — https://grafana.com/docs/grafana/latest/datasources/prometheus/query-editor/
- `$__rate_interval` announcement (formula source) — https://grafana.com/blog/new-in-grafana-7-2-rate-interval-for-prometheus-rate-queries-that-just-work/
- The RED Method — https://grafana.com/blog/the-red-method-how-to-instrument-your-services/
- Visualizing Prometheus histograms — https://grafana.com/blog/how-to-visualize-prometheus-histograms-in-grafana/

**Community / expert commentary (secondary, used only where flagged)**
- Robust Perception, "What range should I use with rate()?" — https://www.robustperception.io/what-range-should-i-use-with-rate/
- Robust Perception, "Staleness and PromQL" — https://www.robustperception.io/staleness-and-promql/
- Robust Perception, "PromQL Subqueries and Alignment" — https://www.robustperception.io/promql-subqueries-and-alignment/
- PromLabs, "How Exactly Does PromQL Calculate Rates?" — https://promlabs.com/blog/2021/01/29/how-exactly-does-promql-calculate-rates/
- PromLabs PromQL Cheat Sheet — https://promlabs.com/promql-cheat-sheet/
- PromLabs blog index (fill() article, Mar 2026) — https://promlabs.com/blog/
- Cloudflare pint `promql/rate` check — https://cloudflare.github.io/pint/checks/promql/rate.html

---

## 18. Explicitly UNVERIFIED items

Flag these for a second pass before they reach print.

**Resolved on 2026-07-27 (second research pass) — these were previously listed as unverified:**

- ~~node_exporter metric names~~ — **RESOLVED.** All USE expressions in §13.3 were checked against the
  official node_exporter mixin recording rules,
  `https://raw.githubusercontent.com/prometheus/node_exporter/master/docs/node-mixin/rules/rules.libsonnet`.
  The metric names used there are `node_cpu_seconds_total`, `node_load1`, `node_memory_MemAvailable_bytes`,
  `node_memory_Buffers_bytes`, `node_memory_Cached_bytes`, `node_memory_MemFree_bytes`,
  `node_memory_Slab_bytes`, `node_memory_MemTotal_bytes`, `node_vmstat_pgmajfault`,
  `node_disk_io_time_seconds_total`, `node_disk_io_time_weighted_seconds_total`,
  `node_network_receive_bytes_total`, `node_network_transmit_bytes_total`,
  `node_network_receive_drop_total`, `node_network_transmit_drop_total`. Prefer the mixin's exact
  expressions over hand-written ones; they are the canonical USE implementation.
- ~~Grafana `$__*` interval variables~~ — **RESOLVED for most of them.** The Grafana 13 Prometheus
  *template variables* page (not the query-editor page) documents `$__interval`, `$__interval_ms`,
  `$__range`, `$__range_s`, `$__range_ms` and `$__rate_interval`, and states the formula as
  `max($__interval + scrape_interval, 4 * scrape_interval)`, where the scrape interval comes from the
  per-query **Min step** if set, otherwise the data source's **Scrape interval** setting (default `15s`).
  **`$__rate_interval_ms` is still UNVERIFIED** — it did not appear on that page.
- ~~Whether `</` and `>/` are flagged~~ — **RESOLVED: they are unflagged.** They appear in
  `docs/querying/operators.md` at **both** `main` and the `v3.13.1` tag under "Histogram trim operators"
  with no experimental marker, and there is **no** corresponding `case` in the `--enable-feature` switch
  in `cmd/prometheus/main.go`. Introduced in 3.11.0. (Still worth one smoke test in the lab.)
- ~~The `native-histogram` feature flag timeline~~ — **RESOLVED, and the old note was wrong.** The
  CHANGELOG entry is under **3.9.0 / 2026-01-06**: *"Native Histograms are no longer experimental! Make the
  `native-histogram` feature flag a no-op. Use `scrape_native_histograms` config option instead. #17528"*.
  So: native histograms went **stable in 3.9.0**, and the flag became a **no-op** (not removed). The
  config knob is `scrape_native_histograms`. Do not attribute any of this to 3.0.0.
- ~~`promql-delayed-name-removal` default state~~ — **RESOLVED: still opt-in.** At the `v3.13.1` tag,
  `main.go` has `case "promql-delayed-name-removal": c.promqlEnableDelayedNameRemoval = true` and logs
  *"Experimental PromQL delayed name removal enabled."* It has not been flipped on by default.

**Still genuinely unverified:**

1. **Docker image tags** `prom/prometheus:v3.13.1` and `grafana/grafana:13.1.1` were inferred from the
   release versions, not read off Docker Hub. (Note: as of 3.13.0 images are *also* published to
   `ghcr.io`, per the CHANGELOG — worth deciding which registry the lab uses.)
2. **`$__rate_interval_ms`** — see above.
3. **Which release promotes `promql-duration-expr` to permanently-on.** Code and docs on `main` say it
   becomes a no-op; there is no CHANGELOG entry. Presumably 3.14.
4. **Which release introduces `start_timestamp()`.** Documented on `main`, absent from v3.13.1, no
   CHANGELOG entry found. Presumably 3.14.
5. **The exact rounding behaviour of `$__rate_interval`.** The documented formula is
   `max($__interval + scrape_interval, 4 * scrape_interval)`, but Grafana also snaps `$__interval` to a
   set of "nice" intervals; whether the final `$__rate_interval` is re-snapped after the `max()` was not
   verified. If the book prints a worked table of `$__rate_interval` values per time range, verify each
   cell against a running Grafana 13.1 rather than computing it by hand.
