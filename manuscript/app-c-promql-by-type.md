# Appendix C — PromQL by type

Alphabetical function lists are useless when you do not yet know the name of the
thing you want. This appendix is arranged the way the query engine actually
works: by what a construct **takes** and what it **returns**. Find the row whose
input you are holding, and the output you want, and the entry is there.

Every expression printed here runs against the lab in its finished state, at the
`ch29` tag, with no edits. Where an entry needs a feature flag, the flag name is
in the entry, because Prometheus does not tell you that a function is missing —
it tells you `unknown function`, which reads like a typo.

## How to read this appendix

The lab pins `quay.io/prometheus/prometheus:v3.13.1`, and everything below is
true for that version. Four numbers from `lab/prometheus/prometheus.yml` and the
running stack are load-bearing for the examples:

| Setting | Value | Why it matters here |
|---|---|---|
| `global.scrape_interval` | `15s` | the floor under every range window |
| `global.evaluation_interval` | `30s` | the default subquery resolution |
| `--query.lookback-delta` | `5m` (default) | how long a gauge stays "current" |
| Enabled PromQL feature flags | none | every `[EXP]` entry returns an error |

That last row is the important one. The lab's Prometheus command line carries
exactly one `--enable-feature`, and it is `exemplar-storage`, so every entry
marked `[EXP]` below fails in your lab with an error rather than a result. Those
entries are here so you recognize them in someone else's query, not so you run
them. Chapter 11, "Joins, info metrics, and the rest of PromQL" explains why the
book takes that position.

`[EXP]` always names its flag. A bare `[EXP]` never appears.

## The four expression types

Every PromQL expression evaluates to exactly one of four things. Most confusion
in this language is a type error wearing a disguise.

| Type | What it holds | Legal as the whole query? |
|---|---|---|
| Instant vector | one sample per series, all at one timestamp | yes, both APIs |
| Range vector | a list of samples per series over a window | instant query only |
| Scalar | one float, no labels, no identity | yes, both APIs |
| String | one string | instant query only, in practice |

`/api/v1/query` (the Prometheus UI's Table view, and Grafana's Instant toggle)
accepts all four. `/api/v1/query_range` — what every Grafana time series panel
issues — accepts **only scalar and instant vector**. That single rule explains
the most common beginner error in the language.

!!! trap "Trap"
    Typing a range vector into a graph panel is not a slow query, it is a type
    error. In the Prometheus UI's Graph tab,
    `snip_http_requests_total[5m]` gives you:

    ```text
    invalid expression type "range vector" for range query,
    must be Scalar or instant Vector
    ```

    A range vector is legal in exactly two places: as the argument of a
    function that declares one, and as the thing a subquery produces.

Chapter 6, "`rate()`, `increase()`, and Why Nothing Is a Whole Number"
introduces the distinction; this appendix assumes it.

## Selectors and matchers

An **instant vector selector** returns, per matching series, the newest sample
at or before the evaluation time, provided that sample is newer than
`t - 5m` (the lookback delta).

```promql
snip_http_requests_total
snip_http_requests_total{route="/l/{code}", code="302"}
{__name__=~"job:snip_sli_.*"}
```

The metric name is stored as the reserved label `__name__`, so those first two
forms are shorthand for a `__name__` matcher. Four matcher operators exist:

| Operator | Selects series whose label value |
|---|---|
| `=` | is exactly equal to the string |
| `!=` | is not equal to the string |
| `=~` | regex-matches the string |
| `!~` | does not regex-match the string |

Five rules about matchers that the syntax does not tell you:

- **Regexes are fully anchored.** `route=~"links"` is treated as
  `route=~"^links$"` and matches nothing in this lab. You want
  `route=~".*links.*"`, or the two exact values.
- Regex syntax is RE2. No backreferences, no lookahead, no lookbehind.
- Since Prometheus 3.0, `.` **matches a newline**. Write `[^\n]` for the old
  behavior.
- A matcher against the empty string also selects series that lack the label
  entirely: `snip_http_requests_total{link_code=""}` matches all twelve series
  while `SNIP_UNBOUNDED_LABEL` is off.
- At least one matcher must not match the empty string. `{job=~".*"}` alone is
  an error; `{job=~".+"}` is fine.

Multiple matchers on one label are ANDed, which is how you carve a set out of
chapter 7's twelve combinations:

```promql
snip_http_requests_total{code=~"5..", code!="503"}
```

A **range vector selector** appends a duration. Since 3.0 the window is
**left-open and right-closed** — `(t-5m, t]` — so a sample landing exactly on
the left edge is excluded.

```promql
snip_http_requests_total{route="/l/{code}"}[5m]
```

Duration literals are a decimal integer plus a unit, concatenated longest-first:
`ms`, `s`, `m`, `h`, `d` (always 24h), `w` (always 7d), `y` (always 365 days).
`1h30m` and `54s321ms` are valid; `1.5h` is not, because floats are not allowed
in a duration literal. A bare number is accepted where a duration belongs and
counts as seconds, so `rate(x[300])` and `rate(x[5m])` are the same query. The
book writes durations everywhere because they are readable.

Float literals accept `23`, `-2.43`, `3.4e-9`, `0x8f`, `NaN`, `+Inf`, and
underscores as digit separators (`1_000_000`). String literals take single
quotes, double quotes or backticks; backticks do not process escapes.

UTF-8 names are valid in Prometheus 3. A name outside `[a-zA-Z_:][a-zA-Z0-9_:]*`
must be quoted and placed inside the braces — `{"my.metric.name"}` — which is
what makes OpenTelemetry's dotted names queryable. Chapter 28, "OpenTelemetry
and Prometheus" uses this.

## Modifiers: `offset` and `@`

Both modifiers attach to a **selector**, never to a function call or an
aggregation, and both are stable and unflagged in 3.13.1.

```promql
snip_links_active offset 1h
rate(snip_http_requests_total[5m] offset 1w)
sum(snip_http_requests_total offset 5m)     # correct
sum(snip_http_requests_total) offset 5m     # parse error
```

`offset` shifts the selector's time reference backward; a negative offset
(`offset -1w`) looks forward. `@` pins the selector to an absolute Unix
timestamp instead, and accepts the special values `start()` and `end()`, which
resolve to a range query's endpoints. The two combine in either order with
identical results.

The idiom that earns `@` its place is a top-k list whose membership stops
reshuffling at every step:

```promql
sum by (route) (rate(snip_http_requests_total[$__rate_interval]))
and
topk(5, sum by (route) (
  rate(snip_http_requests_total[$__rate_interval] @ end())))
```

The `@ end()` sits on the range selector, inside `rate()`, so the ranking is
computed once, at the last step of the graph, and `topk` picks the same five
routes at every step. The `and` then draws those five routes' real values
across the whole range. Put `@ end()` outside the aggregation instead and the
query does not parse: `@ modifier must be preceded by an instant vector
selector or range vector selector or a subquery`.

!!! note "Two flags you do not need"
    `--enable-feature=promql-at-modifier` and
    `--enable-feature=promql-negative-offset` were real in Prometheus 2 and no
    longer exist. Prometheus 3.13.1 does not accept either string. Any tutorial
    telling you to enable them predates 3.0.

## Subqueries

A subquery runs an instant query repeatedly over a range and hands back a
**range vector**, which is the only way to feed one function's output into
another function that demands a window.

```text
<instant_query> '[' <range> ':' [<resolution>] ']'
```

The colon is mandatory even when you omit the resolution. Omitted, the
resolution is the global `evaluation_interval`, which is `30s` in this lab.

```promql
max_over_time(
  sum(rate(snip_http_requests_total[5m]))[1h:1m]
)
```

Three properties to keep in mind. Subquery steps are aligned to the Unix epoch
rather than to the parent query's evaluation time, so results are stable and
cacheable but the newest point can be up to one resolution old. Subqueries force
a full inner evaluation per step and are therefore expensive — chapter 15,
"Recording Rules" exists partly to keep them out of dashboards. And the 3.0
left-open change bites here: `foo[1m:1m]` can yield a single point where it used
to yield two. Write `[2m:1m]`.

## Functions that take a range vector

Every function in this section consumes a range vector and returns an instant
vector. All of them except `*_over_time` need **at least two samples inside the
window**; with fewer, the series vanishes from the result with no error at all.
At the lab's 15-second scrape interval, use `[1m]` as the floor and
`[$__rate_interval]` in panels.

### Counter family (corrects for resets)

| Function | Returns | Use it for |
|---|---|---|
| `rate(v)` | per-second average over the window | alerts, everything by default |
| `irate(v)` | per-second rate from the last two samples | volatile counters, graphs only |
| `increase(v)` | `rate(v)` × window seconds | human-readable totals |
| `resets(v)` | number of counter resets in the window | did this process restart |

```promql
sum by (route) (rate(snip_http_requests_total[5m]))
increase(snip_links_created_total[1h])
resets(process_cpu_seconds_total{job="snip-api"}[1h]) > 0
```

`increase()` extrapolates to the window edges and therefore returns fractions
for an integer counter. That is correct behavior, and chapter 6 traces the
arithmetic sample by sample.

### Gauge family (does not correct for resets)

| Function | Returns | Note |
|---|---|---|
| `delta(v)` | first-to-last difference, extrapolated | gauges only |
| `idelta(v)` | difference of the last two samples | gauges only |
| `deriv(v)` | per-second derivative by least squares | gauges only |
| `predict_linear(v, t)` | extrapolated value `t` seconds ahead | `t` is a scalar |

```promql
deriv(snip_worker_queue_depth{queue="analytics"}[10m])
predict_linear(node_filesystem_avail_bytes[6h], 4 * 3600) < 0
```

`predict_linear`'s second argument is seconds as a number, never a duration
literal. Chapter 22, "Metrics From Things You Didn't Write" pairs it with a
"and we are actually low" guard so it does not fire on a disk that has been
nearly full forever.

`changes(v)` belongs with the gauges as well: it counts how many times the value
changed in the window, which is meaningful for a state gauge such as
`catalog_queue_depth` and meaningless for a counter, where the answer is "the
number of scrapes minus one".

### `*_over_time` — reduce a window to one number

These are the only range-vector functions that work on a single sample.

| Function | Reduces the window to | Note |
|---|---|---|
| `avg_over_time` | unweighted mean of samples | not time-weighted |
| `min_over_time` / `max_over_time` | smallest / largest sample | the spike-saver |
| `sum_over_time` | sum of samples | rarely what you want |
| `count_over_time` | how many samples landed | proves scrapes happened |
| `last_over_time` | newest sample | survives long gaps |
| `present_over_time` | `1` if any sample exists | existence check |
| `absent_over_time` | `1` if no sample exists | the alerting form |
| `quantile_over_time(φ, v)` | the φ quantile of samples | φ comes first |
| `stddev_over_time` / `stdvar_over_time` | spread over time, one series | population statistics |

```promql
count_over_time(up{job="snip-api"}[1m])
max_over_time(snip_worker_queue_depth[1h])
absent_over_time(snip_http_requests_total{job="snip-api"}[10m])
```

`avg_over_time` weights every sample equally regardless of spacing, so a run of
failed scrapes skews it. Range vectors ignore staleness markers entirely, which
is why `count_over_time(up[1m])` returns `4` in this lab and tells you the truth
about a gap.

Experimental additions to the family, all behind
`--enable-feature=promql-experimental-functions`: `mad_over_time` (median
absolute deviation, 3.8.0), `first_over_time` and `ts_of_first_over_time`
(3.7.0), and `ts_of_min_over_time`, `ts_of_max_over_time`, `ts_of_last_over_time`
(3.6.0). The `ts_of_*` family returns timestamps rather than values.

`double_exponential_smoothing(v, sf, tf)` is also `[EXP]` under the same flag.
It is the function that used to be called `holt_winters`.

### Range modifiers

`anchored` and `smoothed` replace `rate()`'s extrapolation with something exact,
and need `--enable-feature=promql-extended-range-selectors` (3.7.0, extended in
3.11.0). `increase(x[5m] anchored)` returns whole numbers for an integer
counter. Neither modifier is supported inside a subquery, and neither combines
with `use-start-timestamps`.

## Functions that take an instant vector

### Histograms

| Function | Works on | Note |
|---|---|---|
| `histogram_quantile(φ, b)` | classic and native | `le` must survive the `by` |
| `histogram_fraction(lo, hi, b)` | classic and native | the SLO question |
| `histogram_avg` / `histogram_count` / `histogram_sum` | native only | |
| `histogram_stddev` / `histogram_stdvar` | native only, 3.5.0 | |
| `histogram_quantiles(v, label, φ…)` | `[EXP]`, 3.11.0 | several φ at once |

The lab stores classic histograms. `scrape_native_histograms` is not set in
`lab/prometheus/prometheus.yml`, so the native-only functions return an empty
result against every metric in the stack — including
`loadgen_request_duration_seconds` under `LOADGEN_NATIVE=1`, whose native form
is on the wire but is not ingested.

```promql
histogram_quantile(0.95, sum by (le, route) (
  rate(snip_http_request_duration_seconds_bucket[5m])))
```

!!! pitfall "The `le` you dropped"
    Aggregating a classic histogram without keeping `le` does not raise an
    error. It returns a number, and the number is nonsense.
    `sum by (route) (rate(..._bucket[5m]))` has collapsed every bucket into
    one series, and `histogram_quantile` has no ladder left to interpolate
    on. Keep `le` in every `by` clause, forever.

Two facts measured on this lab's own exposition. `snip-api` ships thirteen
finite bounds plus `+Inf`; `catalog` ships fourteen plus `+Inf`. And Prometheus 3
normalizes `le` values to float form on ingestion, so a selector written
`le="1"` matches neither service. Match on `le="1.0"`, or on what
`/api/v1/label/le/values` actually returns. Chapter 10, "Latency: Histograms
Without Tears" puts both expositions side by side.

### Label manipulation

```text
label_replace(v, dst, replacement, src, regex)
label_join(v, dst, separator, src1, src2, ...)
info(v, [{matchers}])                    # [EXP]
```

`label_replace` matches `regex` against `src`'s value and, on a match, sets
`dst` to the expansion of `replacement`. Capture groups are `$1`, `$2` or
`$name`. A non-matching series is returned unchanged, and setting `dst` to `""`
removes the label. Unlike a selector matcher, this regex is **not** anchored for
you.

```promql
label_replace(up, "host", "$1", "instance", "([^:]+):.*")
```

`info()` needs `--enable-feature=promql-experimental-functions` (3.9.0). It
copies data labels from an info series onto a vector, replacing a `group_left`
join. It defaults to the metric name `target_info` and assumes `instance` and
`job` identify it. `target_info` is an OpenTelemetry construct, so chapter 28,
"OpenTelemetry and Prometheus" is where you meet it.

### Sorting, absence, and conversion

| Function | Returns | Note |
|---|---|---|
| `sort` / `sort_desc` | the input, ordered by value | instant queries only |
| `sort_by_label` / `sort_by_label_desc` | ordered by label, naturally | `[EXP]` |
| `absent(v)` | `1` if `v` is empty | labels from `=` matchers only |
| `scalar(v)` | the single value, else `NaN` | needs exactly one element |
| `vector(s)` | a one-element vector, no labels | the "show 0" trick |
| `timestamp(v)` | each sample's own timestamp | seconds since epoch |

Range query results have a fixed output ordering, so `sort` in a graph panel
does nothing; since 3.12.0 the server attaches a warning annotation saying so.

`absent()` derives its output labels only from equality matchers on a plain
selector, which is why `absent(up{job="snip-api"})` gives you `{job="snip-api"}`
to route an alert on, while `absent(sum(up))` gives you `{}` and nothing to route
with. Chapter 16, "Alerting Rules, and What 'Firing' Actually Means" prefers
`absent_over_time(x[10m])` for exactly this reason.

### Time, date, and math

`time()` returns the timestamp the expression is being evaluated at, not the
wall clock. `day_of_month`, `day_of_week` (0 = Sunday), `day_of_year`,
`days_in_month`, `hour`, `minute`, `month` and `year` all default to
`vector(time())`.

Math: `abs`, `ceil`, `floor`, `round(v, to_nearest)`, `clamp(v, min, max)`,
`clamp_max`, `clamp_min`, `exp`, `ln`, `log2`, `log10`, `sqrt`, `sgn`, `pi()`,
`deg`, `rad`, and the trigonometric set (`sin`, `cos`, `tan`, their inverses and
hyperbolics), which work in radians. `round()` resolves ties upward.

`min_of(a, b)` and `max_of(a, b)` are `[EXP]` scalar functions added in 3.13.0,
renamed from `min`/`max`. So are `start()`, `end()`, `range()` and `step()` as
functions (3.12.0) — which are **not** the same thing as the stable `start()`
and `end()` special values of the `@` modifier, and not the same thing as the
`step()` helper inside a duration expression. Three collisions on four names,
under two different flags.

## Aggregation operators

An aggregation collapses an instant vector into fewer series. The modifier may
precede or follow the parentheses; the book writes it in front because that is
what the UI's prettifier produces.

```promql
sum by (route) (rate(snip_http_requests_total[5m]))
sum without (instance) (rate(snip_http_requests_total[5m]))
```

| Operator | Parameter | Note |
|---|---|---|
| `sum` / `avg` / `count` | — | handle histogram samples |
| `min` / `max` | — | floats only |
| `group` | — | returns `1` per group |
| `stddev` / `stdvar` | — | spread across series, floats only |
| `topk(k, v)` / `bottomk(k, v)` | `k` | original series, floats only |
| `quantile(φ, v)` | `φ` | the value ranking at φ·N |
| `count_values(l, v)` | label name | one series per distinct value |
| `limitk(k, v)` | `k` | `[EXP]`, sampling not ranking |
| `limit_ratio(r, v)` | `r` in `[-1, 1]` | `[EXP]`, negative takes the complement |

`by` keeps only the listed labels; `without` keeps everything except them. Both
drop `__name__`. Chapter 8, "Aggregation: `sum`, `without`, and the
Rate-Then-Aggregate Law" argues for `without` as the default.

`topk` and `bottomk` return the **original series with their original values**,
not a ranking. In a range query they are re-evaluated at every step, so the set
of series changes as the graph scrolls — pin it with `@ end()`, or accept the
spaghetti.

`count_values` aggregates on the **sample value**, not on a label, and writes
that value into a new label. `count_values("status", up)` tells you how many
targets sit at `1` and how many at `0`.

```promql
count_values("status", up)
topk(3, sum by (book_id) (rate(catalog_lookups_total[5m])))
```

That second query is chapter 24's opening move. `catalog_lookups_total` carried
3,248 series and climbing when this lab was measured, which is the whole point
of the planted bug.

## Binary operators and vector matching

Arithmetic (`+ - * / % ^`) and comparison (`== != > < >= <=`) work between two
scalars, between a vector and a scalar, and between two vectors. Set operators
(`and`, `or`, `unless`) work only between two vectors.

Precedence, highest first. Only `^` is right-associative:

```text
1.  ^
2.  *  /  %  atan2
3.  +  -
4.  ==  !=  <=  <  >=  >
5.  and  unless
6.  or
```

So `2 ^ 3 ^ 2` is 512, and `a or b and c` is `a or (b and c)`. Parenthesize when
the answer is not immediate.

Comparison operators **filter** by default, dropping elements where the
comparison is false. Add `bool` and they return `1` or `0` instead, dropping the
metric name. Between two scalars, `bool` is required.

```promql
node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.1
avg(up == bool 1)
```

The metric name is dropped by every function, every arithmetic operator, every
`bool` comparison and every aggregation. Two different metrics reduced to the
same label set collide with `vector cannot contain metrics with the same
labelset`; `label_replace` is the portable fix.

### Matching

By default two elements match when their **full label sets are equal**, ignoring
the metric name. `on(...)` restricts matching to the listed labels;
`ignoring(...)` removes labels from consideration. Unmatched elements on either
side disappear from the result with no warning, which is why a per-route error
ratio loses the routes that have no errors.

`group_left` and `group_right` declare which side has the higher cardinality —
the arrow points at the "many" side — and turn a one-to-one match into
many-to-one:

```promql
rate(snip_http_requests_total[5m])
  * on (job, instance) group_left (version)
    snip_build_info
```

Four rules to internalize:

- Group modifiers work with arithmetic and comparison operators only, never with
  `and`, `or` or `unless`.
- The labels inside `group_left(...)` are **extra labels copied from the "one"
  side**. An empty list copies nothing and keeps the value math.
- A label cannot be both a matching label in `on(...)` and a copied label.
- `found duplicate series for the match group` almost always means you chose the
  wrong side, or need more labels in `on(...)`.

Chapter 11 builds this shape. `snip_build_info` is exported by `snip-api` and
`snip-worker` alike, because they run the same image, which is what lets the
join span two jobs rather than one.

### Fill modifiers and trim operators

`fill(0)`, `fill_left(0)` and `fill_right(0)` supply a value for unmatched
elements instead of dropping them, and need
`--enable-feature=promql-binop-fill-modifiers` (3.10.0). Until that is stable,
chapter 9, "Ratios, Arithmetic, and the Series That Isn't There" teaches the
portable workarounds — `or vector(0)`, `unless`, and a zero-multiplied
denominator.

`</` and `>/` trim a native histogram above or below a threshold. They arrived
in 3.11.0, are **not** flagged experimental, and have nothing to operate on in
this lab.

## The experimental surface, flag by flag

None of these is enabled in the lab. All are off by default in 3.13.1.

| Flag | Turns on | Since |
|---|---|---|
| `promql-experimental-functions` | `info`, `mad_over_time`, `first_over_time`, the `ts_of_*` family, `sort_by_label*`, `double_exponential_smoothing`, `histogram_quantiles`, `limitk`, `limit_ratio`, `min_of`, `max_of`, `start`/`end`/`range`/`step` as functions | added to over many releases |
| `promql-duration-expr` | arithmetic inside `[ ]` and `offset` | 3.4.0 |
| `promql-extended-range-selectors` | `anchored`, `smoothed` | 3.7.0 |
| `promql-binop-fill-modifiers` | `fill`, `fill_left`, `fill_right` | 3.10.0 |
| `promql-delayed-name-removal` | keeps `__name__` through operations | 3.8.0 |
| `use-start-timestamps` | start-timestamp-aware `rate`, `irate`, `increase`, `resets` | 3.12.0 |

Duration expressions deserve one line of their own: inside `offset` you must
parenthesize the expression, or only the first duration value is used, and they
do not work with the `@` modifier at all.

## Names that changed, and names that were never there

| You may read | The truth in 3.13.1 |
|---|---|
| `holt_winters` | renamed `double_exponential_smoothing`, and `[EXP]` |
| `min()` / `max()` in durations | renamed `min_of` / `max_of` in 3.13.0 |
| `median()`, `percentile()` | do not exist; use `quantile`, `quantile_over_time` or `histogram_quantile` |
| `now()` | does not exist; use `time()` |
| `rate_interval()` | not PromQL; `$__rate_interval` is a Grafana variable |
| `start_timestamp()` | not in 3.13.1 |

## Index by question

| Question | Expression | Chapter |
|---|---|---|
| How many per second? | `sum by (route) (rate(snip_http_requests_total[5m]))` | 6, 8 |
| What fraction failed? | errors ÷ total, aggregated the same way on both sides | 9 |
| How slow for the slowest 5%? | `histogram_quantile(0.95, sum by (le) (rate(..._bucket[5m])))` | 10 |
| What fraction beat the target? | the `le="0.3"` bucket rate ÷ the `_count` rate | 10, 20 |
| Is anything missing? | `absent_over_time(snip_http_requests_total[10m])` | 16 |
| Will it fill up before Monday? | `predict_linear(node_filesystem_avail_bytes[6h], 4 * 3600) < 0` | 22 |
| What version is deployed? | `snip_build_info` joined with `group_left (version)` | 11 |
| What was the peak? | `max_over_time(snip_worker_queue_depth[1h])` | 11 |
| How wide is this metric family? | `count(catalog_lookups_total)` | 7, 24 |
| Did this restart? | `resets(process_cpu_seconds_total[1h]) > 0` | 22 |
