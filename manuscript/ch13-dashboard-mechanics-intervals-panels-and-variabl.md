# Chapter 13 — Dashboard Mechanics: Intervals, Panels and Variables

Open `http://localhost:3000/d/snip-red`, set the time picker to the last 24 hours, and look at the
request-rate panel. Now open that panel for editing. It grows to fill most of the screen — and the
line gets spikier. Close the editor. It smooths out again.

You changed nothing. Not the query, not the time range, not the data. You changed how many pixels
wide the panel was, and Grafana quietly changed the query it sent to Prometheus. Every panel on every
dashboard you build does this, all the time, and until you know what it is doing you cannot tell a
real spike from a rendering artifact — a bad position to be in at three in the morning. Leave the
picker at its default hour and nothing happens at all, which is the same lesson in disguise. By the
end of this chapter you will know why both are true.

Chapter 3, "Your First Dashboard: The Early Win", handed you three working panels and an IOU for the
strange token inside them, `$__rate_interval`. This chapter pays it properly: the arithmetic, the
setting it silently depends on, and what breaks when that setting is wrong. Then the rest of the
panel machinery — panel types, transformations, template variables, thresholds and the layout system
Grafana 13 turned on for everybody. Chapter 14, "Dashboards That Tell the Truth", is about dashboards
that lie. This one is about the machine.

!!! objectives "Objectives"
    After this chapter you can:

    - Compute `$__interval` and `$__rate_interval` by hand for any panel and time range.
    - Name the setting that supplies the "scrape interval" term, and say where it lives.
    - Explain why one query renders two different ways in two panel widths.
    - Choose between `$__rate_interval` and `$__interval` without guessing.
    - Build with the five panel types and five transformations that matter for Prometheus data.
    - Wire a multi-value template variable that does not break when you select a second value.

## A panel is a pipeline

A Grafana panel looks like a picture of a metric. It is not. It is a six-stage pipeline, and every
stage can change what you see without changing what is true.

```text
┌─────────────────┐
│ PromQL + window │
└─────────────────┘
    │ the expression, exactly as you typed it
    ▼
┌──────┐
│ step │
└──────┘
    │ one evaluation point per step
    ▼
┌───────────────┐
│ series frames │
└───────────────┘
    │ frames, as Prometheus answered
    ▼
┌───────────────────────────┐
│ transformations, in order │
└───────────────────────────┘
    │ rewritten frames
    ▼
┌────────────┐
│ panel type │
└────────────┘
    │ shapes, colors, a legend
    ▼
┌──────┐
│ unit │
└──────┘
```

Read it downward. Grafana takes your expression, decides on a **step** — how far apart the
evaluation points are — asks Prometheus for one value per step across the visible range, gets tables
back that it calls **frames**, optionally rewrites them with **transformations**, hands the result to
a **panel type** to draw, and formats the numbers with a **unit**. What proves it is a pipeline and
not a photograph: four of those six stages have nothing to do with your data and everything to do
with your browser window.

!!! jargon "Step"
    A range query does not return every sample Prometheus stored. It evaluates the expression at
    fixed instants — `start`, `start + step`, `start + 2 × step`, on to `end` — and returns one value
    per instant per series. The step is the client's choice. Grafana makes it for you, partly from
    the width of the panel.

## The step, and where it comes from

Grafana computes the step from three numbers, all of which you can see and change. The formula, in
the form worth memorizing:

```text
$__interval = (to − from) / Max data points
              snapped to a round duration
              then floored at Min interval
```

`to − from` is the visible range, straight off the picker. **Max data points** is a setting in every
panel's *Query options*, and here is the part nobody tells you: left empty it defaults to **the
panel's width in pixels**. One point per pixel — as many as the screen can draw, and not one more.

That default explains the spiky-in-the-editor effect from the opening. On the dashboard the
request-rate panel is eight of the grid's twenty-four columns — about a third of the window, call it
500 pixels. In the editor it is nearly full width, call it 1500. Over twenty-four hours that is 173
seconds per point against 58, which the next two paragraphs turn into a `2m` step and a `1m` one:
same query, same day, twice as many points, and every short-lived bump that was averaged away at 500
points is now visible.

The second line matters too. Grafana does not send a step of `7.2s`; it snaps the raw quotient onto
a ladder of round durations. Measured on this lab, the rungs from a quarter of a minute up:

```text
15s  20s  30s  1m  2m  5m  10m  15m  20m  30m  1h  2h  3h  6h  12h  24h
```

The snapping goes to the nearest rung, not always upward: three minutes of raw quotient becomes
`2m`, not `5m`. Do not memorize the boundaries. Memorize that the answer is always one of these
rungs, and that Grafana will tell you which.

### The floor nobody mentions

The third line is the one that catches people who have done the arithmetic correctly. `$__interval`
is floored at **Min interval**, and when a query does not set one, Min interval's default comes from
the data source. In this lab that floor is fifteen seconds.

It is why the opening asked for a 24-hour range. At the dashboard's stored default of one hour,
3600 ÷ 500 is 7.2 seconds and 3600 ÷ 1500 is 2.4: both under the floor, so both come back `15s` and
dashboard and editor draw *exactly* the same picture. The floor is not an edge case you meet later;
it is the first thing that happens.

Here is that one-hour range at five values of Max data points, measured against the running stack:

| Max data points | `$__interval` | `$__rate_interval` |
|---|---|---|
| 1000 | `15s` | `1m` |
| 200 | `20s` | `1m` |
| 100 | `30s` | `1m` |
| 50 | `1m` | `1m15s` |
| 30 | `2m` | `2m15s` |

An hour divided by a thousand is 3.6 seconds, which would snap to a rung well under `15s`. It comes
back `15s` anyway: the floor won. Ignore the third column for one more section. The point of the
second is that `$__interval` on a one-hour graph is anything from fifteen seconds to two minutes —
decided by geometry, clamped by a configuration file.

### Reading the answer instead of guessing it

You never have to compute this. Every panel tells you, twice.

Open a panel for editing and look at *Query options*. Alongside **Max data points** and **Min
interval** is a read-only **Interval** field: `$__interval`, resolved for this range and this panel's
width. Mind the names — the Prometheus query editor carries a **Min step** of its own, one row below
the expression. Both floor the step; only Min step also supplies the term in the next section's
formula, which is the one the rest of this chapter means.

For the whole picture use **Inspect → Query**. The *request* still says `$__rate_interval`, spelled
as you typed it: the data source deliberately does not resolve the interval macros in your browser.
It ships them to Grafana's own server with the resolved `intervalMs` and `maxDataPoints`, and the
server substitutes them — which is how a panel and the server-side rules you write in chapters 15
and 16 can be built from one expression and still agree about a window.

The *response* carries the resolved version, in each frame's `meta.executedQueryString`. On the
request-rate panel with `$job` set to `snip-api`, `$route` on *All*, a one-hour range and Max data
points at `50`, it reads:

```text
Expr: sum by (route) (
  rate(snip_http_requests_total{job=~"snip-api",
    route=~".*"}[1m15s])
)
Step: 1m0s
```

Every variable is gone — template variables resolved in the browser, interval macros on the server —
and Prometheus never saw a `$`. That is the expression that actually ran.

!!! selfcheck "Self-check"
    Open the request-rate panel for editing and set Max data points to `50` at a one-hour range. The
    *Interval* field must read `1m`, and the executed query must report `Step: 1m0s` with a `[1m15s]`
    window. Change Max data points to `30`: the same two readings must become `2m` and `Step: 2m0s`,
    with the window at `[2m15s]`.

## `$__rate_interval`, and the term Grafana cannot guess

Now the second variable, and the reason it exists at all.

Chapter 6, "rate(), increase() and Why Nothing Is a Whole Number", established that a `rate()` window
must hold at least four scrape intervals: two samples is the mathematical minimum, and two more are
headroom, because the newest scrape may not have landed and one failed scrape must not empty the
window. At a fifteen-second scrape that means never less than a minute.

Look at the table again. At a thousand data points `$__interval` is `15s`, so
`rate(...[$__interval])` asks for a rate over a fifteen-second window while Prometheus scrapes every
fifteen seconds. Watch what that costs, without a browser:

```bash
curl -sG http://localhost:9090/api/v1/query \
  --data-urlencode 'query=count(rate(
    snip_http_requests_total{job="snip-api"}[15s]))' \
  | jq -c .data.result
```

```text
[]
```

An empty array. Not an error, not a warning — Prometheus was asked a question with no answer and
said so politely. Widen the window to a minute and the same query counts every series:

```bash
curl -sG http://localhost:9090/api/v1/query \
  --data-urlencode 'query=count(rate(
    snip_http_requests_total{job="snip-api"}[1m]))' \
  | jq -c .data.result
```

```text
[{"metric":{},"value":[1789841005.114,"12"]}]
```

Twelve — the twelve `(route, method, code)` combinations from chapter 7, "Labels, and the Cardinality
Arithmetic You Must Do First". The difference is sample count and nothing else: swap `rate` for
`count_over_time` on one series and a `[15s]` window holds `1` sample where a `[1m]` window holds
`4`.

`$__rate_interval` is Grafana's fix for exactly this. Its definition:

```text
$__rate_interval = max($__interval + scrape interval,
                       4 × scrape interval)
```

The first term keeps the window at least one scrape wider than the step, so consecutive windows
overlap slightly and no sample falls between two evaluation points. The second is chapter 6's floor.
Whichever is larger wins.

Run the numbers, at a fifteen-second scrape. At `15s`: `max(30, 60) = 60`, so `1m`; at `20s` and
`30s`, still `1m`; at `1m`: `max(75, 60) = 75`, so `1m15s`; at `2m`: `max(135, 60) = 135`, so
`2m15s`. The floor holds the window at a minute until the step passes forty-five seconds; after that
the window tracks the step.

**The `4 ×` is not configurable.** No setting, no data source field, no environment variable. Want a
different multiplier and you write a literal window and give up the time picker.

!!! iou "IOU from chapter 3, settled"
    Chapter 3 asked you to copy `[$__rate_interval]` into three panels without understanding it.
    That is it, in full: a window always at least four scrapes wide and always at least one scrape
    wider than the step, recomputed every time you drag the picker or resize a panel. The other three
    chapter 3 IOUs — `rate()`, `sum by` and `histogram_quantile` — were settled in chapters 6, 8
    and 10. Chapter 5 deferred the same window, and Chapter 11 deferred it together with
    `$job`, which this chapter's variables section explains: *IOU from chapter 5, settled. IOU
    from chapter 11, settled.*

### The term Grafana has to be told

There is a hole in that formula, and it hides the most consequential misconfiguration a
Prometheus-and-Grafana pair can have: **Grafana does not know your scrape interval.** It never asks,
and Prometheus could not answer usefully if it did — the interval is per job, and one data source
faces a server with a dozen jobs.

So the "scrape interval" term is resolved by a two-step precedence:

1. The query's **Min step**, if that query sets one — a field in the Prometheus query editor, and a
   target's `interval` key in dashboard JSON. Its own tooltip says what it does: an additional lower
   limit for the step parameter *and* for the `$__interval` and `$__rate_interval` variables. The
   floor and the scrape-interval term, in one setting.
2. Otherwise, the data source's **Scrape interval** field — `jsonData.timeInterval` in the
   provisioning YAML you wrote in chapter 3.

Go and look at `lab/provisioning/datasources/prometheus.yaml`. The comment above the setting is not
decoration:

```yaml
    jsonData:
      httpMethod: POST
      timeInterval: 15s
```

That `15s` is a promise you are making to Grafana about `lab/prometheus/prometheus.yml`, where
`global.scrape_interval` is also `15s`. Nothing checks that the two agree. Nothing ever will.

Set that field to `60s` while Prometheus keeps scraping every fifteen — the lab step walks you
through it — and `$__interval` floors at a minute while `$__rate_interval` floors at
`max(60 + 60, 240) = 240` seconds. Every rate graph is averaged over four minutes instead of one.
Spikes flatten; a thirty-second error burst that was an obvious peak becomes a gentle rise. The
dashboard is not wrong, exactly — it is smoothed four times harder than you asked, and nothing on
screen says so.

Chapter 3's first exercise asked you to do exactly this and write down the shape and the peak of
panel 2. That flattened peak now has an explanation, and the arithmetic that predicts it.

The mistake in the other direction is louder and therefore kinder. If Prometheus scraped every sixty
seconds while `timeInterval` said `15s`, most windows would hold a single sample: a graph full of
holes, and you would go looking for the cause. Nothing in this lab scrapes at sixty seconds, so keep
that one as a thought experiment.

## Rate windows and `_over_time` windows are different problems

`$__rate_interval` is the right window for `rate()`, `irate()` and `increase()`, and the wrong one
for the `_over_time` family — for the very overlap that makes it right for rates.

`max_over_time(x[w])` asks: what was the largest value of `x` in the `w` seconds before each
evaluation point? When `w` equals the step the windows tile the range exactly, every sample sits in
one window, and each pixel shows a true maximum. When `w` is wider — which `$__rate_interval` always
is, by at least one scrape — the windows overlap, one spike is reported at several consecutive
points, and a one-scrape blip renders as a plateau.

The rule has no exceptions worth teaching:

- `rate()`, `irate()`, `increase()` → `[$__rate_interval]`
- `max_over_time()`, `avg_over_time()`, `sum_over_time()` and the rest of that family →
  `[$__interval]`

The RED dashboard has both, side by side, in the "Spike recovery and injector state" row. One plots
the gauge as sampled:

```promql
sum by (route) (loadgen_inflight_requests{route=~"$route"})
```

and the panel next to it recovers peaks that a wider time range would otherwise hide:

```promql
max by (route) (
  max_over_time(loadgen_inflight_requests{route=~"$route"}[$__interval])
)
```

The second takes `[$__interval]`, and its panel description says so out loud. Chapter 14 shows what
that panel rescues; the reason for the narrower window is here.

!!! trap "Trap: `[$__interval]` on a `rate()`"
    Change one rate panel's window from `[$__rate_interval]` to `[$__interval]` and leave the
    dashboard at one hour. The panel does not fail loudly. It renders — and renders almost nothing.

    At a one-hour range and a thousand data points the honest panel returns **241 points per
    series**. The same panel with `[$__interval]` returns **nothing at all**: every evaluation point
    asks a fifteen-second window holding one sample, and `rate()` needs two. The legend is a row of
    dashes and Inspect → Data a table of empty cells:

    ```text
    Legend            Last *
    /                 -
    /healthz          -
    /links            -
    ```

    Catch a stray point or two and that is scrape drift, not signal.

    Widen the window a little and it gets more insidious, not less. At `$__interval = 20s` about a
    third of the windows catch two samples, so the panel returns 61 of 181 points: not blank, merely
    dotted — the shape of a flapping service. At `30s` every window holds exactly two and the panel
    looks perfect with no margin at all, so one missed scrape punches a hole. It changes character as
    you zoom, so the symptom never looks like one cause.

There is a third option people reach for, not wrong so much as frozen. A literal `rate(...[5m])`
always works, and stops tracking the time picker entirely — which is why the lab treats a literal
window in a panel query as a violation, with a documented escape hatch: a target can carry a
`__lintExempt` key giving its reason, or the panel can be listed in the checker's exemption table.
Three panels in the finished repository end up exempt, each on a dashboard a later chapter adds, and
each a decision somebody wrote down rather than a slip nobody noticed.

## Instant or range: the panel decides

Every Prometheus query in Grafana is one of two kinds, and the panel type decides which you want.

A **range query** evaluates the expression once per step across the visible window and returns a
line. An **instant query** evaluates it once, at the right-hand edge, and returns one number per
series. In dashboard JSON they are the target's `range: true` and `instant: true` flags; in the query
editor, the *Type* selector.

Time series panels want range queries — a line needs points. Stat and Gauge want instant queries:
they show one number, so fetching three hundred to discard two hundred and ninety-nine is waste.
Tables usually want instant too, one row per series.

Compare two panels. The request-rate time series carries `"range": true` and no `instant` key. The
"Short links active" stat carries the opposite:

```promql
max(snip_links_active{job=~"$job"})
```

with `instant: true`, `range: false`, and a *Value options* calculation of *Last \**.

Set both flags on one target and Grafana returns two frames — usually an accident, whose symptom is
a Stat showing a number from a reduction you never chose. If a Stat disagrees with the right-hand
end of the series beside it, check the query type first.

Stat has a second, sharper problem: an instant query returns the newest sample within Prometheus's
lookback window, which can be minutes old, and the panel shows it with no sign of its age. That is
chapter 14's material and one of its planted lies. Exercise 3 asks you to catch it happening now.

## Five panel types, and four names that are gone

Grafana ships more than thirty visualizations. A Prometheus dashboard needs five, plus one
specialty. Here they are with the string that goes in a panel's `type` field, because the UI name and
the JSON name are not always the same word:

| UI name | `"type"` | Use it for |
|---|---|---|
| Time series | `timeseries` | Anything with a shape over time |
| Stat | `stat` | One number, now |
| Gauge | `gauge` | One number against a known ceiling |
| Table | `table` | One row per label combination |
| Heatmap | `heatmap` | A distribution, not three lines through it |
| State timeline | `state-timeline` | A metric with few discrete values |

**Time series** is the default and right roughly three quarters of the time: fourteen of the RED
dashboard's twenty-six panels.

**Stat** is for a number read at a glance — how many links exist, how long since the worker last
succeeded. Give it an instant query and set the unit.

**Gauge** is for a value with a meaningful maximum: a ratio between 0 and 1, a fraction of a budget.
It needs `min` and `max` in the field config or the needle means nothing. The RED dashboard has none,
because none of its numbers has a natural ceiling.

**Table** is the honest choice for many series with no shape worth drawing. The lab's "Rate by
route, method and status" sums the *rate* of `snip_http_requests_total` by `route`, `method` and
`code` as an instant query — rate first, then aggregate, as chapter 8 insisted — and shows twelve
rows for twelve combinations. Its target sets `"format": "table"`, which tells the data source to
return one column per label instead of one frame per series.

**Heatmap** finally does justice to a histogram. Three quantile lines are three thin slices of a
distribution; a heatmap shows all of it — where the mass sits, when a second mode appears, whether
the tail grew or the whole curve moved. The lab's hands the buckets over pre-aggregated:

```promql
sum by (le) (
  rate(snip_http_request_duration_seconds_bucket{job=~"$job",
    route=~"$route"}[$__rate_interval])
)
```

Two settings make it work and both are easy to get wrong: the target sets `"format": "heatmap"`, and
**Calculate from data** stays **off** — `calculate: false` in the JSON — because Prometheus already
bucketed when chapter 10 designed those thirteen boundaries, and bucketing the buckets is a smear.

**State timeline** is the sixth, and earns its place on one shape: a metric with few discrete
values, where you care *when it changed*, not what it averaged. `up` is the canonical example — one
row per target, colored bands, a gap where a target stopped existing. No panel in this lab is one,
so build it yourself if you want to see it.

### The names that are gone

Angular was removed in Grafana 12.0, and with it four panel types that fill an enormous amount of
pre-2024 material. Find them in a downloaded dashboard or a blog post and you are reading something
stale:

| Dead name | What it became |
|---|---|
| `graph` | `timeseries` |
| `singlestat` | `stat` |
| `table-old` | `table` |
| `heatmap-old` | `heatmap` |

Grafana migrates them, so they still "work" — the trouble is that every option name in the tutorial
you are following was renamed years ago. `make verify-ch13` fails if any of the four appears in a
dashboard file.

## Transformations, and why order matters

Transformations run after the query returns and before the visualization draws. They rewrite the
frames: rename, drop or reorder columns, merge two queries into one table, collapse a series to one
number. Grafana has thirty-four; five matter for Prometheus data.

**Organize fields by name** renames, reorders and hides columns — the one you will use most, because
a Prometheus table arrives with a `Time` column you do not want and one literally called `Value`. The
lab's table panel does exactly that:

```json
{
  "id": "organize",
  "options": {
    "excludeByName": { "Time": true },
    "indexByName": { "route": 0, "method": 1, "code": 2, "Value": 3 },
    "renameByName": { "Value": "req/s" }
  }
}
```

Three operations, one transformation: hide `Time`, fix the column order, rename `Value` to something
a human would say out loud.

**Labels to fields** turns each label of a series into its own column, which is what makes an info
metric readable: query `snip_build_info{job=~"$job"}` as an instant query, apply it, and the columns
become `instance`, `version`, `commit`, `goversion` and `env` instead of one inscrutable series name.

**Join by field** merges two queries on a shared column — usually `instance` — into one table with a
column from each. When the join is *semantic*, though — "attach the version label to this rate" — do
it in PromQL with `group_left`, as the RED dashboard's build-version panel does: then the join is
part of the query and survives being copied into a rule file or a `curl`.

**Reduce** collapses each series to one number. In *Series to rows* mode it replaces the frame with
one row per input column: a `Field` column naming the column, and one column per calculation you
asked for. It turns a range query into a leaderboard without a second query.

**Time series to table** does the same collapse but keeps a miniature chart in the row. It went GA in
Grafana 13.1 with sparkline support, and it is the most useful of the five for a service overview:
one row per route, the current number, a thumbnail of the last hour beside it.

### Order matters, and here is the proof

Grafana applies transformations in the order they are listed, each consuming the output of the last.
The documentation says so plainly, and it is very easy to forget.

Take the table panel. Organize renames `Value` to `req/s`. Add **Reduce** below it in *Series to
rows* mode: rename, then collapse. Renaming a column sets its *display name*, and the `Field` column
Reduce builds is made of display names — so the rows read `req/s`. The string survives as a value
rather than a header.

Now drag Reduce above Organize. The collapse happens first, and Organize is handed a frame whose only
columns are `Field` and your calculation: no `Value` to rename, no `Time` to hide. It matches
nothing, does nothing, and `req/s` appears nowhere. Same two transformations, same panel, completely
different output — and this failure is the quiet kind, because a transformation that matches no
column does not complain.

The habit that saves you: when a transformation "does nothing", check whether the column it names
still exists at that point in the chain. Each row in the transformation editor has a debug toggle
showing that step's input and output frames, which makes it a five-second look.

## Variables that survive a second selection

A **template variable** is a named value chosen from a dropdown at the top of the dashboard and
substituted into every query that mentions it. The RED dashboard has two, both **query variables**:
their values come from a query against the data source rather than a list you typed.

The first asks which jobs own the HTTP counter:

```text
label_values(snip_http_requests_total, job)
```

`label_values()` is not PromQL. It is a helper the Prometheus data source provides for variable
queries only; typing it into a panel is a parse error. Given a metric and a label it returns that
label's distinct values — here exactly one, `snip-api`. A one-item dropdown looks pointless and is
not: it is the seam where a second API service appears without anyone editing a panel.

The second is **chained** off the first — its query references `$job`, so it only lists routes the
selected job actually serves:

```text
label_values(snip_http_requests_total{job=~"$job"}, route)
```

That returns Snip's five templated routes plus `other`, which appears as soon as something asks for
a path Snip does not serve.

One setting is worth understanding rather than copying. `refresh` controls when the option list is
rebuilt: `1` on dashboard load, `2` on load *and* whenever the time range changes. `job` uses `1`,
because jobs do not come and go during a session; `route` uses `2`, because which routes have traffic
genuinely depends on the window you are looking at.

### The `=~` rule, and what happens when you break it

The `route` variable is multi-value, with an *All* option whose value is `.*`. This is where
beginners lose an afternoon.

Select two values and Grafana does not hand your query two strings. It interpolates one string
containing a **regex alternation** — the values joined with `|`, wrapped in parentheses, with
metacharacters escaped. Select `/links` and `/healthz` and `$route` becomes `(/links|/healthz)`.

That is only useful with a regex matcher. Chapter 2, "What's Actually on the Wire", established the
four matchers; this is the first time choosing between `=` and `=~` has consequences beyond style.

!!! trap "Trap: `=` with a multi-value variable"
    Write the panel with an equality matcher. It looks tidier, and with one value selected it works
    perfectly:

    ```promql
    sum by (route) (
      rate(snip_http_requests_total{job=~"$job",
        route="$route"}[$__rate_interval])
    )
    ```

    Now select a second route. The panel goes blank and the legend empties. The executed query shows
    why:

    ```text
    Expr: sum by (route) (
      rate(snip_http_requests_total{job=~"snip-api",
        route="(/links|/healthz)"}[1m15s])
    )
    Step: 1m0s
    ```

    You asked for series whose `route` label is the literal seventeen-character string
    `(/links|/healthz)`. None exists. Prove it:
    `count(rate(snip_http_requests_total{job="snip-api",route="(/links|/healthz)"}[1m]))` returns
    `[]`, and the same query with `=~` returns `4`. Grafana draws the empty vector as nothing: no
    error, no warning, a panel that looks exactly like an outage.

    The fix is one character. Use `=~` wherever a variable appears in a selector, from the first
    panel you write, multi-value or not. `route=~"/links"` behaves identically to `route="/links"`
    for a single value, and does not break when somebody turns on multi-select next year.

The *All* option deserves a note of its own. Its stored value is the literal `$__all`; what gets
substituted is the variable's **custom all value**, `.*` on this dashboard. With `=~` and
Prometheus's full anchoring from chapter 2, `route=~".*"` matches every value of the label — and,
because `.*` also matches the empty string, it reaches series carrying no `route` label at all,
exactly as `route=""` does. That is chapter 2's empty-string rule, and *All* is where it bites:
`count(process_cpu_seconds_total{job="snip-api", route=~".*"})` returns `1`, on a series with no
`route` label anywhere. Harmless here, where every series these panels touch is labeled. Point the
same pattern at a family where only some series carry the label and you collect the rest silently.
For only the series that genuinely have it, the custom all value has to be `.+`.

### Syntax forms, and one you must never write

Four spellings exist. Three are current.

| Form | When |
|---|---|
| `$job` | The default. Cannot be used mid-word |
| `${job}` | When the variable is adjacent to other characters |
| `${route:regex}` | When you want a specific interpolation format |
| `[[job]]` | **Deprecated.** Do not write this |

`[[varname]]` is deprecated and slated for removal. It is also everywhere in pre-2020 material, so
you will read it. Never type it.

One format modifier matters here: `${route:regex}` forces the regex-alternation form explicitly, for
when a data source's default interpolation is not what you want. A dozen more exist; Prometheus needs
none of them.

### `$__auto`, and the variable type to skip

There is a variable type called **Interval** that offers a dropdown of durations — `1m`, `5m`, `1h` —
so a reader can pick a resolution by hand. Its *auto* option has the literal value `$__auto`; older
material calls it `$__auto_interval_<name>`, and that spelling is gone.

The advice is short: do not build one. `$__rate_interval`, plus the query editor's **Min step** on
the rare query that needs a floor, covers everything a Prometheus dashboard needs, and an interval
variable adds a second, competing story about where the step comes from — on a dashboard whose whole
lesson is that there is one. Recognize `$__auto` in somebody else's JSON and move on. One other
built-in is worth knowing: `$__range`, the whole visible span as a duration.

## Thresholds start at nothing

A **threshold** is a value above which a panel changes color. In JSON they live in the field config
as an ordered list of steps:

```json
"thresholds": {
  "mode": "absolute",
  "steps": [
    { "color": "green",  "value": null },
    { "color": "orange", "value": 0.01 },
    { "color": "red",    "value": 0.05 }
  ]
}
```

Read it as bands: below `0.01` green, `0.01` to `0.05` orange, `0.05` up red. The first step is the
**base step**, the color for everything below the lowest real threshold, and its value must be
`null`.

!!! pitfall "The classic hand-written-JSON mistake"
    Writing `"value": 0` for the base step. It looks more correct than `null`, and it is the most
    common error in hand-authored dashboard JSON.

    `null` means *no lower bound*: this band extends downward forever. `0` means *this band starts
    at zero*, which is a claim about your data — and a false one for anything that can go negative,
    such as a difference, a `deriv()`, or a gauge measuring a delta. Those values then sit below
    every declared band. It is worse in *Percentage* mode, where Grafana reads each step's value as a
    percentage of the field's own minimum and maximum: the scale moves with the data, and a band
    starting at zero is pinned to wherever the bottom of the range happens to be today. `make
    verify-ch13` counts base steps whose value is `0` and fails if the count is not zero.

Two more habits. A panel whose number has no meaningful "bad" value should have exactly one step — a
base step in a neutral color — rather than an invented red line; several of the RED dashboard's stats
are built that way on purpose. And thresholds on a time series draw only if *Show thresholds* is on.
A threshold that colors nothing and draws nothing is a comment, not a control.

## What Grafana 13 changed under the layout

Grafana 13 shipped in April 2026 and made **Dynamic Dashboards** generally available. Not a feature
flag, not an opt-in: every dashboard, new and existing, uses the new layout engine, editing
experience and structure automatically. The lab's compose file sets `GF_FEATURE_TOGGLES_ENABLE` to
the empty string and says so in a comment, because there is nothing to turn on. Four consequences
show up immediately.

**Two layout families.** *Custom* is the classic twenty-four-column grid where you place and size
each panel yourself; it is the default for a new dashboard and what every dashboard in this lab uses.
*Auto grid* reflows panels into a uniform grid on their own. Custom is right when the arrangement
carries meaning — the two in-flight panels sit side by side because the comparison *is* the lesson.
Auto grid is right when the panels are peers and the screen size is not yours to predict.

**Rows and Tabs.** Both group panels; both nest; both repeat over a variable. Since 13.1 both also
carry **section-level variables**, scoped to that row or tab rather than the whole dashboard — which
is how you stop a variable bar growing to nine dropdowns nobody can parse.

**Filter and Group by** is what Grafana now calls *ad hoc filters*: GA in 13.1 as a dashboard-level
control rather than a variable, letting a reader filter every query on a label the author never
declared a variable for.

**Metrics Drilldown**, formerly *Explore Metrics*, renamed in February 2025 with the rest of the
Explore apps. A query-less browser for Prometheus metrics — pick one, split it by a label, spot the
outlier — under **Drilldown → Metrics**, shipped as the preinstalled plugin
`grafana-metricsdrilldown-app`.

!!! sidebar "Conditional rendering"
    Dynamic Dashboards can show or hide a panel by rule: whether its queries returned data, whether
    a template variable matches a value, whether the range is shorter than some span. Rules combine
    with *match all* or *match any* — a good way to keep an error-breakdown row off the screen when
    there are no errors. One restriction: they apply to **Auto grid** panels only, so the option does
    not appear in this lab until you convert a row.

!!! grafana12 "If you are on Grafana 12.4"
    Dynamic Dashboards are a public preview there, so the edit surface and the layout menu differ,
    and section-level variables and Filter and Group by are not yet GA. Grafana 12.4 is the last
    minor of the 12 line, with extended support into May 2027, so this is a real place to be.
    Everything else is unchanged: `$__interval`, `$__rate_interval`, Max data points, Min interval,
    Min step, `jsonData.timeInterval`, the panel type strings, the transformations, the `=~` rule and
    the `null` base step all behave identically.

### Why the file and the browser disagree

Dashboards carry a `schemaVersion`. The current one is `42`, and every file in `lab/dashboards/` is
written at 42. Open a dashboard written at an older version and Grafana migrates it forward while
loading — the copy on your screen is not byte-for-byte the copy on disk, and never was.

That is half the story. Edit the RED dashboard in the browser, export it as JSON, and diff it
against `lab/dashboards/snip-red.json`. There are differences even if you changed nothing:

- Grafana fills in every panel option you left at its default, so `options` blocks grow.
- Each panel gains a `pluginVersion` recording which build last wrote it.
- `id` comes back populated from the database instead of the `null` the file carries.
- If you switched a row to **Auto grid**, that change is not in the file at all: Auto grid belongs to
  the newer dashboard resource schema, and the classic schema this lab provisions has no field that
  can express it.

The last one generalizes: the browser can do things the file format cannot record. Who wins is
answered by the provider YAML you wrote in chapter 3. `allowUiUpdates: true` lets Save persist to
Grafana's database — but the file provider re-reads `lab/dashboards/` every ten seconds and
overwrites that copy the next time it sees a changed file. The file wins, always, eventually. So:
experiment in the browser, export as JSON, paste it back into the repository file, commit. The
browser is the editor; the file is the artifact.

One escaping rule belongs with that habit. Grafana interpolates environment variables inside files
under `provisioning/` — `${NAME}` first, then `$NAME` — so a literal dollar sign there must be
written `$$`, which is why the documented password example is `Pa$$sw0rd`. Dashboard JSON gets **no
interpolation at all**, which is why `$__rate_interval`, `$job` and `$route` are unconditionally safe
in `lab/dashboards/*.json`.

## The lab step: rebuild the RED dashboard properly

The lab is where chapter 12, "prometheus.yml in Full", left it: `snip-api` behind `edge`, targets
discovered from Docker, readable `instance` values. To rejoin, `cd lab && git checkout ch13` and
`make up`. `make check` is static validation and never looks at a running container, so ask the
target that does: `make ps` shows every service `running` and the health-checked ones `(healthy)`.
Then open `http://localhost:3000/d/snip-red`.

This chapter changes one file: `lab/dashboards/snip-red.json`. The dashboard has grown by accretion
since chapter 3, and it shows. `$job` and `$route` have existed since chapter 11, but almost every
panel still hard-codes `job="snip-api"` and ignores `$route`, and the chapter 6 rate workbench still
carries a literal `[30s]` window and a third variable, `$instance`, that only those three panels use.
A variable nobody consumes is a lie on the toolbar: it implies the dashboard will respond to it.

The rebuilt file, all of it visible in the repository copy:

- Every panel querying `snip_http_*` consumes `$job` with `=~` — fourteen of them — and every one
  whose metric carries a `route` label consumes `$route` the same way, which is nine. The worker,
  loadgen-client and injector panels keep a literal `job=` on purpose: `$job` lists only the jobs
  that own the HTTP counter, so widening those would empty them. Consume a variable where its values
  can match, nowhere else.
- `$instance` is gone, along with the workbench row that was the only thing using it.
- `[$__rate_interval]` on every `rate()`, `[$__interval]` on the one `max_over_time()`, and no
  literal window anywhere.
- Units everywhere: `reqps` for rates, `percentunit` for ratios — the 0-to-1 form, not 0-to-100, and
  chapter 14 shows what picking the wrong one costs — `s` for durations, `ops` for the worker's job
  throughput, `short` for counts.
- Thresholds whose base step is `null`, on the panels that have any at all.
- An Organize fields transformation on the new table panel. The latency heatmap has been here since
  chapter 10, with **Calculate from data** off and `format: heatmap` on its target; this rebuild only
  points it at `$job` and `$route`.

Twenty-six panels across six rows. Fourteen arrive — six worker panels, the table, database latency,
two cache panels, the active-links stat, redirects, client-versus-server and process CPU — and
chapter 9's `Four ways to write one ratio` leaves with the workbench: a scratchpad for one lesson,
whose correct form is now the error-ratio panel at the top.

### Four things to do by hand

None of these changes the repository. All four are browser experiments you undo.

**One.** Open the request-rate panel for editing and set **Max data points** to `50`. The *Interval*
field reads `1m`; Inspect → Query shows `Step: 1m0s` and a `[1m15s]` window. Change it to `30` and
watch both move to `2m` and `2m15s`. Clear the field to restore the pixel-width default.

**Two.** Close the editor and drag the panel from eight columns to sixteen, with the picker at 24
hours: at one hour both widths sit under the floors and nothing moves. Across a third of the screen
`$__rate_interval` is roughly `2m15s`; across two thirds it drops to about `1m15s`. The exact numbers
depend on your monitor; that they differ does not.

**Three.** Edit `lab/provisioning/datasources/prometheus.yaml`, set `timeInterval: 60s`, restart
with `docker compose restart grafana`, and reload. Every rate panel is now smoothed over four minutes
while Prometheus still scrapes every fifteen seconds. Trigger a burst — `curl -XPOST
localhost:8089/control -d '{"error_ratio":0.3}'`, wait a minute, then `-d '{"error_ratio":0}'` — and
see how much flatter the error-ratio panel is than in chapter 3. Put `15s` back and restart again.

**Four.** Export the dashboard as JSON and diff it against the repository file. Twice: once having
changed nothing, once having converted "Traffic detail" to Auto grid. The first diff shows what
Grafana adds, the second what the classic schema cannot hold.

!!! selfcheck "Self-check"
    Run `make verify-ch13`. It reads `lab/dashboards/`, not Grafana's copies, and must end:

    ```text
    PASS snip-red.json is valid JSON
         26 panels across 1 dashboards
    PASS the dashboards have panels
    PASS every rate() uses [$__rate_interval]
    PASS every *_over_time uses [$__interval]
    PASS no unrecorded hard-coded range in any panel query
    PASS no panel uses a removed panel type
    PASS no threshold base step is 0 (it must be null)
         snip-red template variables: job route
    PASS the RED dashboard has a $job variable

    ch13: 8 passed, 0 failed
    ch13 OK
    ```

    The panel and dashboard counts grow as later chapters add dashboards, and so does the per-file
    `is valid JSON` line: on the finished lab the same script reads `74 panels across 4 dashboards`
    and ends `11 passed`. The seven rules do not change. Then audit the window rule yourself, because
    a rule you can run beats one somebody else runs for you:

    ```bash
    jq -r '[.panels[]?, (.panels[]? | .panels[]? // empty)][]
           | (.targets // [])[] | (.expr // "") | gsub("\n"; " ")' \
       dashboards/snip-red.json \
     | grep -E '(^|[^a-z_])(rate|increase)\(' \
     | grep -v '\$__rate_interval' | wc -l
    ```

    It must print `0`. Against the `ch12` tag it prints `1` — the rate workbench panel this chapter
    retired.

## Common mistakes

!!! pitfall "Leaving `jsonData.timeInterval` at a value your Prometheus does not use"
    Nothing errors. Every rate panel in your Grafana is quietly wrong in one direction or the other,
    forever, and no screen in either product compares the two numbers. The fix: set it in the
    provisioned file, restart Grafana, and treat it as part of the same change as any edit to
    `global.scrape_interval`.

**Using `=` with a template variable.** It works for as long as nobody selects a second value, then
produces an empty panel indistinguishable from a dead service. Use `=~` in every selector that names
a variable.

**Editing in the browser and forgetting to export.** `allowUiUpdates: true` makes Save work, which
makes it feel saved. It is — in the database, until the file provider next re-reads a changed file
and overwrites it.

**Reaching for a transformation when PromQL would do.** Transformations run in the browser on
whatever came back. A join expressed in PromQL travels — into a rule file, into a `curl`, into
another tool. As a transformation it lives and dies inside that one panel.

**Turning on *Calculate from data* on a heatmap of Prometheus buckets.** Prometheus already bucketed;
re-bucketing produces a blurred distribution and no error message. Turn it off and let the buckets
through unchanged.

## Summary

A panel is a pipeline, and the first stage is arithmetic you can do on paper. `$__interval` is the
visible range divided by Max data points — which defaults to the panel's width in pixels — snapped to
a round duration and then floored at Min interval, which in this lab means it never drops below
fifteen seconds. `$__rate_interval` is `max($__interval + scrape interval, 4 × scrape interval)`,
where the scrape-interval term comes from the query's Min step if set and otherwise from the data
source's `jsonData.timeInterval` — Grafana has no way to learn it from Prometheus. Get that one
setting wrong and every rate graph you own is silently smoothed or silently sparse.

The durable takeaways:

- `$__interval = (to − from) / Max data points`, snapped and then floored. Max data points defaults
  to pixel width, which is why one query renders two ways in two panel widths — and why, below the
  floor, it renders the same way in both.
- `$__rate_interval = max($__interval + scrape interval, 4 × scrape interval)`. The `4 ×` is not
  configurable, and the scrape-interval term is `jsonData.timeInterval` unless a query sets Min step.
- `[$__rate_interval]` on `rate`, `irate` and `increase`; `[$__interval]` on the `_over_time` family.
  Literal windows only where there is no time picker.
- Range queries for time series; instant queries for Stat, Gauge and most tables.
- The five type strings are `timeseries`, `stat`, `gauge`, `table`, `heatmap`, plus `state-timeline`.
  `graph`, `singlestat`, `table-old` and `heatmap-old` are gone.
- Transformations apply in list order, each consuming the last one's output.
- Use `=~` with every template variable in a selector, whether or not it is multi-value today.
- The base threshold step is `null`, never `0`.
- The browser is the editor; the file is the artifact. Export, paste, commit.

## Exercises

!!! exercise
    **1. Interval arithmetic by hand (core).** A panel 400 pixels wide, no Max data points set, a
    six-hour range, a fifteen-second scrape. Compute `$__interval` and `$__rate_interval` on paper
    before you touch a browser. Then reproduce those conditions — Max data points `400`, picker at
    six hours — and check both against the executed query. Your numbers must match the reported step
    and the substituted window exactly.

    **2. Break it on purpose, then find the edge (core).** Change one rate panel's window to
    `[$__interval]`. From a 24-hour range, halve the range repeatedly and record the first zoom level
    at which the panel develops gaps. Write one sentence on why it breaks exactly there rather than
    one step earlier or later. Put `[$__rate_interval]` back.

    **3. A Stat that is out of date (core).** Build one expression twice — a time series with a range
    query, a Stat with an instant query. Now make the underlying series genuinely stop being
    produced, and record when the Stat and the right-hand end of the time series disagree, and for
    how long. Setting the load generator's rate to zero will not do it; working out why is part of
    the exercise. Chapter 14 explains the rest; take the note now.

    **4. The second value (warm-up).** Change one panel's `route` selector from `=~` to `=`. Select a
    single route: it works. Select a second: record what the panel shows, and copy the resolved
    expression out of the executed query. You should find a `route="…"` matcher containing a
    parenthesized alternation.

    **5. Order matters (core).** On the table panel, add a Reduce transformation in *Series to rows*
    mode below the existing Organize fields. Find the string `req/s` and write down where it is — it
    will not be a column header. Now drag Reduce above Organize and look again. Write two sentences
    explaining why one ordering keeps it and the other loses it.

    **6. Two layouts, one decision (stretch).** Convert the "Traffic detail" row to Auto grid, leave
    "Spike recovery and injector state" on Custom, and resize the browser from full width to half.
    Export the dashboard as JSON and confirm the Auto grid conversion is not in the file. Say which
    row you would put on an office wall display, and why the other would be wrong there.
