# Chapter 14 — Dashboards That Tell the Truth

Here is a thing that happened, and will happen to you. Something went wrong for about forty
seconds. Somebody noticed, opened the dashboard, and widened the time picker to a day so they
could see whether it had happened before. The graph came back flat. Not "small spike" flat —
*nothing there* flat. They closed the tab and wrote "could not reproduce."

The forty seconds were in the database the whole time. Every sample was stored, every value was
correct, and the query on the panel was the query you would have written. What changed was the
step. At one hour the panel asked Prometheus for a value every twenty seconds; at twenty-four
hours it asked every five minutes, and the instant it happened to ask was not one of the three
instants where the spike lived. The panel did not fail. It answered a different question and
printed the answer in the same font.

Chapter 13, "Dashboard Mechanics: Intervals, Panels and Variables" was about the machine — where
the step comes from, which window belongs to which function, which query type belongs to which
panel. This chapter is about what that machine does to the truth. Every lie in it survives code
review and renders without a single error message, which is why they are worth a chapter: a
broken panel gets fixed on the day it breaks, and a lying panel gets trusted for a year.

!!! objectives "Objectives"
    After this chapter you can:

    - Demonstrate the vanishing-spike problem and fix it with `max_over_time`.
    - Recognize a `percent`-versus-`percentunit` mismatch as a silent 100× error.
    - Explain why a Stat panel can display stale data that looks live.
    - Say why stacking misleads, and when a second Y-axis is mandatory.
    - Audit somebody else's dashboard against a checklist and find planted defects.
    - Write a panel description that documents the panel's own caveats.

## A graph is a sampled query result, not a photograph

A time series panel is not a picture of your data. It is a table of answers to the same question
asked at fixed instants, joined up with line segments. Prometheus stores a sample every fifteen
seconds, because that is your scrape interval. Grafana asks for a value every *step*, and the
step is arithmetic done on your browser window: the visible range divided by Max data points,
which defaults to the panel's width in pixels. Those two grids have nothing to do with each
other.

!!! jargon "Evaluation grid"
    The fixed instants at which a range query is evaluated: `start`, `start + step`,
    `start + 2 × step`, and so on. Grafana rounds the requested range so those instants land on
    whole multiples of the step counted from the Unix epoch, whatever odd seconds your `from`
    and `to` carry. The grid is a property of the step — not of your data, not of when you
    clicked, not of when your samples were taken.

So nudging the time picker by a minute moves the window but not the grid. What moves the grid is
changing the *step*. Here is the picture, at a step of one minute against a fifteen-second
scrape; look at which samples the grid actually touches.

```text
samples   ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●
          every 15 s

grid      ▲           ▲           ▲           ▲           ▲
          every 60 s

drawn     └───────────┴───────────┴───────────┴───────────┘
          one point per ▲ — the other three samples in each
          window are never asked about
```

Three of every four samples take no part in the drawing. That is not a bug and there is no way
around it: a week at fifteen-second resolution is forty thousand points, and a panel a thousand
pixels wide has a thousand pixels. Something must be discarded; the only question is *what*, and
the default answer is the one that hurts most.

For an instant selector — a bare metric name, no range vector, no function — the value at a grid
instant is **the most recent sample at or before that instant**, provided one exists within the
five-minute lookback delta that Chapter 2, "What's Actually on the Wire" introduced. Not the
average of the window. Not the maximum. The last one. So at a five-minute step, a forty-second
spike is drawn only if it happens to contain the last sample before a grid instant. Twenty
samples fall in each such window; three are yours.

## The vanishing spike

Time to make it happen. The lab is where Chapter 13 left it: `snip-api` behind `edge`, targets
discovered from Docker, the RED dashboard rebuilt with variables and correct windows. If you need
to rejoin, `cd lab && git checkout ch14` and `make up`. `make check` is static validation and
knows nothing about traffic, so confirm the flow yourself: `make ps` shows every service `Up`, and
`postgres`, `valkey`, `prometheus`, `grafana` and `edge` additionally report `(healthy)` — the four
application services ship no healthcheck, so `Up` is all you get from them. Then
`sum(rate(snip_http_requests_total[1m]))` on the Prometheus Query page at
`http://localhost:9090/query` reads about 20, the load generator's default rate.

Open `http://localhost:3000/d/snip-red` and scroll to the row called **Spike recovery and
injector state**. Two panels sit side by side there, built in Chapter 11, "Joins, Info Metrics,
and the Rest of PromQL", and you have not yet had a reason to care about the difference between
them.

The left one, **In-flight requests, as sampled**, plots a gauge exactly as stored:

```promql
sum by (route) (loadgen_inflight_requests{route=~"$route"})
```

The right one, **In-flight requests, max per step**, plots the same gauge through a window:

```promql
max by (route) (
  max_over_time(loadgen_inflight_requests{route=~"$route"}[$__interval])
)
```

`loadgen_inflight_requests` counts the requests the load generator has sent and not yet had
answered, by route. On a calm lab it reads zero on every route, with the occasional one, because
Snip answers a redirect in single-digit milliseconds.

Make it not calm. This raises the rate and holds most requests open for an extra second and a
half, for forty-five seconds, then puts everything back:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":40,"extra_latency_ms":1500}' > /dev/null
sleep 45
curl -s -XPOST http://localhost:8089/chaos/reset > /dev/null
```

Forty requests a second, most held open for a second and a half, gives around sixty in flight at
once — the delay goes on the redirect and the two link routes, ninety-five percent of the mix.
Measured during exactly this burst, the total across routes climbed from zero to the high fifties
and came straight back down.

Now pin both panels to a step you can predict. Open each for editing and set **Max data points**
to `200` in *Query options*; Chapter 13's formula then gives `20s` at a one-hour range and `5m`
at twenty-four hours. At one hour both panels show the same narrow tower where the burst was. Now
set the time picker to 24 hours.

```text
  1 hour · step 20 s              24 hours · step 5 m
  ┤          ╭╮                   ┤
  ┤          ││                   ┤
  ┤          ││                   ┤
  ┼──────────╯╰──────────         ┼────────────────────────
   as sampled: the peak            as sampled: nothing
```

The left panel is now a flat line at the baseline. If your stack has been up for an hour, most of
that canvas is empty and the line is a short stub on the right; the emptiness is honest, so look
at the stub. The burst is gone: not shrunk, not smoothed, *gone*, with no gap, no gray band, no
warning.

Look at the right panel at the same 24-hour range.

```text
  24 hours · step 5 m, max_over_time(...[$__interval])
  ┤                                          ╷
  ┤                                          │
  ┼──────────────────────────────────────────┴─────────
   max per step: still there, one pixel wide
```

`max_over_time(v[5m])` at a grid instant returns the largest sample in the five minutes before it.
The windows tile the range exactly, so nothing can fall between them. The peak survives every zoom
level; widening the range only makes it narrower.

You do not have to take the panels' word for it. Ask Prometheus for the same two *shapes* on the
same five-minute grid, aggregated across routes so they fit in a terminal. Summing per-route
maxima reads a little above any instant the gauge actually held, because the routes do not peak
together; it is the gap between the columns that matters, not the last digit.

```bash
END=$(( $(date -u +%s) / 300 * 300 ))
START=$(( END - 1800 ))

grid() {
  curl -s -G http://localhost:9090/api/v1/query_range \
    --data-urlencode "query=$1" \
    --data-urlencode "start=$START" \
    --data-urlencode "end=$END" \
    --data-urlencode "step=300s" |
    jq -r '.data.result[0].values[] |
           "\(.[0] | gmtime | strftime("%H:%M"))  \(.[1])"'
}

grid 'sum(loadgen_inflight_requests)' > /tmp/sampled
grid 'sum(max_over_time(loadgen_inflight_requests[5m]))' > /tmp/maxed
paste /tmp/sampled /tmp/maxed |
  awk '{printf "%s  %9s  %9s\n", $1, $2, $4}'
```

Four consecutive drawn points from one real run, times in UTC, with the burst straddling the
17:50 grid instant:

```text
17:40         0          0
17:45         1          2
17:50        58         65
17:55         1         63
```

Read the last two rows slowly. At 17:55 both columns describe the same five minutes of the same
gauge. One says the number was `1`; the other says it reached `63`. Neither is a bug: the left
column is the newest sample at or before 17:55:00, and by then everything had drained.

The 17:50 row is the other half of the lesson, and the reason this chapter says *luck*. One
forty-five-second burst landed across 17:50:00. The half before the grid instant was still in
flight when Prometheus was asked, so the instant selector drew `58`; the half after it lived and
died inside the next cell, which is the row reading `1`. Which half of your incident is visible
depends on where it fell relative to a grid you do not control.

!!! selfcheck "Self-check"
    Run that block within half an hour of your burst. Find the rows where the *max per step*
    column is large — one row if your burst sat inside a single five-minute cell, two if it
    straddled a grid instant like this one. The number there must be in the region of
    `rps × extra_latency_ms ÷ 1000` — around 60 at 40 requests a second and a second and a half
    of delay — against a baseline of 0 or 1 everywhere else. Now read the *as sampled* column
    beside it. Wherever that column is small while *max per step* is large, you are watching the
    spike vanish. If every elevated row carries a large *as sampled* number too, your burst was in
    flight at each grid instant it touched: run it again, starting a minute or two later in the
    five-minute cell, and at least one row comes back small.

This panel is also the reason for Chapter 13's rule that the window here is `[$__interval]`, not
`[$__rate_interval]`. `$__rate_interval` is always wider than the step, so its windows overlap
and an overlapping maximum reports the same peak at several consecutive points — a forty-second
burst rendered as a two-minute plateau. For `rate()` that overlap is a feature; for a maximum it
is a fabrication.

None of this is a Grafana defect, and you can prove it. Put the plain expression into the
Prometheus Query page, Graph tab, at one hour and then one day: Prometheus's own graph loses the
spike the same way, because it is also a range query on a grid.

### Series that vanish, not only peaks

Peaks are the common case. The sharper version is that entire series disappear.

A series is drawn only if some grid instant finds a sample for it within the lookback delta, and
a staleness marker ends that lookback one scrape after the last sample rather than five minutes
after. So a series that lived three minutes is invisible at any step wide enough that no grid
instant falls inside those three minutes. At a seven-day range, where the step runs to tens of
minutes, a replica that existed for three minutes contributes nothing at all. It is not that its
line is short. There is no line.

You can watch this happen with replicas, which Chapter 12, "`prometheus.yml` in Full: Service
Discovery and Relabeling" made cheap:

```bash
make scale N=6
sleep 180
make scale N=2
```

For three minutes there are six `instance` values on `snip_http_requests_total`; then four go
stale. Graph `sum by (instance) (rate(snip_http_requests_total{job="snip-api"}[1m]))` at one hour
and you see four short-lived lines. Widen far enough and they are no part of the story — and
nothing on the graph says so.

The mitigation is the spike's: put an explicit range-vector window on the query, so each drawn
value summarizes a span instead of snapshotting an instant. `max_over_time` for peaks; `rate()`
over `$__rate_interval` for counters, which already does this and is most of why counter panels
behave better than gauge panels.

## The Stat panel that is four minutes old

Chapter 13 asked you to build one expression twice — a time series and a Stat — then make the
underlying series *genuinely stop being produced*, and write down the moment they disagreed. It
also told you that setting the load generator's rate to zero would not do it. The disagreement
has two independent causes: one true of every Stat panel ever built, one a choice somebody
made.

The first is the lookback delta. A Stat panel usually runs an instant query — every Stat on
`/d/snip-red` does — and an instant query returns the most recent sample **within five minutes**
of the evaluation time, with nothing on the panel to say how old that sample is. At `{"rps":0}`
the counters stop moving but `snip-api` is still scraped: both panels keep getting fresh samples,
both honestly read zero, nothing goes stale. That is Chapter 13's answer. Stop the *target*
instead — `docker compose stop snip-api`, which stops both replicas — and watch your pair. Bring
it back with `docker compose start snip-api` as soon as you have your answer: everything from here
on needs traffic, and `make ps` must show both replicas `Up` again before you continue.

Chapter 2 said why. A failed scrape makes Prometheus write a staleness marker for every series
that target produced, and a selector that finds a marker returns nothing at all. If both your
panels ran the same bare selector, both end at the same instant: the Stat blanks, and the graph
stops. Now put a window on the graph and the asymmetry appears. Measured by stopping `catalog`
mid-scrape, the instant selector `catalog_items_processed` went empty at the very next evaluation,
fifteen seconds later, while `max_over_time(catalog_items_processed[5m])` never gapped. **The Stat
blanks first**, and the windowed graph is the one that goes on looking confident.

So the lookback is not what bites you when a target dies. It bites when samples keep arriving and
stop meaning anything: a gauge whose exporter froze while the process stayed healthy, or Chapter
2's exceptions — pushed data, or an exporter that timestamps its own samples and so never gets a
marker. A Stat is only ever as fresh as its last sample, and it cannot tell you which of those it
is showing.

The second is worse, because it is a choice somebody made. Grafana lets a panel override the
dashboard's time range, and lets you hide the fact:

```json
"timeShift": "4m",
"hideTimeOverride": true
```

*Time shift* moves this one panel's window back by four minutes. Grafana would normally print a
small time-override note in the panel header saying so — that is the whole point of the note —
and `hideTimeOverride: true` removes it. The result is a Stat titled for the present moment,
sitting next to live panels, showing a number from four minutes ago with nothing on screen to say
so. Note that this one does not need an instant query to work. A Stat fed by a *range* query has
to turn a whole series into one number, and the rule it uses is the panel's **reduction** —
`options.reduceOptions.calcs` in the JSON. Every Stat in the lab reduces with `lastNotNull`, the
newest point that is not null; a Stat set to `mean` or `max` shows a window's average or peak
while looking exactly like a Stat showing now. Shift that window back four minutes and
`lastNotNull` lands four minutes back with it. The lookback has nothing to do with it.

!!! trap "Trap: the confident, stale number"
    Build the pair, because the lab does not ship it. On `/d/snip-red`, duplicate **Error ratio
    (5xx / all)**, change the copy's type to Stat and its query type to Instant, set *Decimals*
    to `3`, then in *Query options* set *Time shift* to `4m` and turn on *Hide time info*. Drop
    it beside the original and run a burst of errors:

    ```bash
    curl -s -XPOST http://localhost:8089/control \
      -d '{"rps":40,"error_ratio":0.30}' > /dev/null
    ```

    The original time series starts climbing within a scrape or two. The Stat beside it keeps
    reading `0.000` — green, bold, and wrong — for four minutes. Then it jumps. Reset with
    `curl -s -XPOST http://localhost:8089/chaos/reset` and the pair dances in reverse: the graph
    recovers and the Stat insists you are still broken. Nothing errors, nothing is gray, nothing
    is dashed. The only tell is that two panels disagree, and if the graph is not next to the
    Stat there is no tell at all. Then delete the Stat, or reload the page without saving.

There are three honest ways to build a "right now" number. Pick one deliberately.

Show the age next to the value. The lab does this on the worker: the **Since last successful
job** Stat is `time()` minus a timestamp gauge, in seconds, and it catches a worker that is
running, healthy and quietly doing nothing.

```promql
time() - max by (queue) (
  snip_worker_last_success_timestamp_seconds{job="snip-worker"}
)
```

Or give the Stat a sparkline, so a value flat for four minutes looks flat rather than current.
That is two changes, not one: `graphMode: "area"` *and* a range query, because an instant query
returns a single sample and a single sample draws nothing. Every Stat on `/d/snip-red` that sets
`graphMode: "area"` also runs `instant: true`, so not one of them shows a sparkline — switch one
to a range query and watch it appear. Or, where the space exists, do not use a Stat at all. A time
series ending in a stub of blank space tells you the truth about its own freshness for free.

Never use `hideTimeOverride: true` to make a shifted panel look unshifted. A time override has
one legitimate use — a deliberate "same window, last week" comparison panel, clearly titled — and
there you want the badge, not the absence of it.

## Units: the silent hundredfold

Prometheus has a naming law, and Chapter 5, "Your First Counter: Instrumenting Code You Own" made
you obey it: base units, always. Seconds, not
milliseconds. Bytes, not megabytes. Ratios from zero to one, never zero to a hundred.
`snip_http_request_duration_seconds` really is seconds; a ratio really is `0.997`.

Grafana has two units that both call themselves percent, and they mean opposite things.

| Grafana unit | Reads the value as | Correct for |
|---|---|---|
| `percent` | already 0–100 | a value your code multiplied by 100 |
| `percentunit` | 0.0–1.0 | every ratio a Prometheus query produces |

Put `percent` on a query that returns `0.997` and Grafana believes you. It does not scale
anything; it appends a percent sign. At two decimal places it reads **`1.00%`**.

Sit with that. The true value is 99.7 percent; the panel says one percent. The error is a factor
of a hundred, in the direction that turns an excellent number into a catastrophic one, and there
is no visual difference between the right panel and the wrong one — same query, same data, same
layout, one character different in the field config.

Now the part that makes it survive review. Thresholds are evaluated on the *raw* value, not the
displayed one, so the color and the number are computed from two different numbers. Give a ratio
Stat the `percent` unit and thresholds stepping at `0.95` and `0.99`. On a calm lab a
share-under-300 ms expression measures around `0.95` — one request in ten goes to
`/links/{code}`, which waits on `catalog`, and `catalog` is slow — so the panel prints **`0.95%`**
while the threshold, reading the raw `0.95`, paints it the middle band. The number says
near-total failure, the color says acceptable, and neither is the ninety-five percent that is
actually true. A reader resolves the contradiction by assuming they have misread something.

!!! pitfall "`percent` on a ratio"
    Any Prometheus expression of the form `sum(a) / sum(b)` returns a value between 0 and 1. Its
    Grafana unit is `percentunit`. The `percent` unit is for data that arrived already scaled —
    which, if you obeyed the naming law, yours never did. When you see `percent` in a Prometheus
    dashboard, assume it is wrong until you find the `* 100` that justifies it.

Time is the same bug wearing a different hat. `snip_http_request_duration_seconds` is seconds; a
p95 of `0.021` means twenty-one milliseconds. Set that panel's unit to `ms` and Grafana reads
`0.021` as twenty-one *microseconds*. Your latency panel now reports a service a thousand times
faster than it is, in units that look plausible, on an axis that looks sensible.

`catalog`'s second planted bug, harvested in Chapter 10, "Latency: Histograms Without Tears", is
the same confusion one level down, in the instrumentation rather than the display: it
records milliseconds into second-tuned buckets. A 20 ms lookup is observed as `20`, clearing the
histogram's top finite bound of `10.0` outright, and the slower ones clear it by far more. Every
one of its fourteen finite buckets is empty or as near as makes no difference, `+Inf` holds the
whole count, and `histogram_quantile` returns exactly `10` for p50, p95 and p99 alike. The
histogram cannot answer anything at all. See for yourself:

```promql
sum by (le) (catalog_request_duration_seconds_bucket)
```

One rule covers both: **do the scaling in the unit, never in the query.** A query that ends
`* 100` is a query you can no longer copy into a recording rule (Chapter 15, "Recording Rules"),
a `curl` or another tool without remembering what it did to itself. Keep the expression in base
units and let the panel format it.

## Stacking, axes and legends

Three display choices, each of which can invert the meaning of a correct query.

**Stacking.** Grafana's own dashboard best-practices documentation tells you to avoid stacking
graph data, because it "can be misleading". In a stacked chart no series except the bottom one is
drawn against the axis; every other one is drawn against the *cumulative total below it*, so the
slope your eye reads belongs to somebody else. A flat series on top of a rising one looks like it
is rising.

There is exactly one honest case: disjoint parts of one total, in one unit, where the total is
what you want to read. Request rate by status code qualifies. Latency quantiles do not stack,
ever: p50, p95 and p99 are not parts of anything, and stacking them draws p99 at the sum of all
three. If you cannot name what the top of the stack measures, do not stack.

**Axes.** Two series in different units on one axis means one of them is unreadable. The lab's
**Cache lookups and links created** panel puts two counters together on purpose and says why in
its own description: they share a unit, `ops`, so one axis is honest. Add the link count -
`max(snip_links_active{job="snip-api"})`, a gauge in the hundreds — and the lookup rates, around
fifteen per second, are squashed into the bottom pixel row.

The fix is a field override that moves one series to its own axis. Give that query the
`legendFormat` `links active` first: the override matches by *displayed* name, and Grafana's
default name is the whole label set, so otherwise the matcher below silently matches nothing.

```json
"overrides": [
  {
    "matcher": { "id": "byName", "options": "links active" },
    "properties": [
      { "id": "custom.axisPlacement", "value": "right" },
      { "id": "custom.axisLabel", "value": "links" },
      { "id": "unit", "value": "short" }
    ]
  }
]
```

Two axes are not free — a reader must check which axis a line belongs to before reading its height
— so the honest default is two panels. Reach for the second axis when the two series must be read
*together*, as a ratio or a lead-and-lag, and for nothing else.

**Legends.** A legend is a lookup table, and one with four hundred rows is a wall: a panel whose
legend does not fit on the screen has failed however correct its query is. The lab has a
ready-made offender. `catalog` carries an unbounded `book_id` label — Chapter 7, "Labels, and the
Cardinality Arithmetic You Must Do First" predicted it by arithmetic, and Chapter 24,
"Cardinality: Detonate, Diagnose, Defuse" detonates it. Count it:

```promql
count(count by (book_id) (catalog_lookups_total))
```

Measured once on a running lab, that returned **3,248**, and it was still climbing. What you get
depends on how long yours has run, which is the point. Now imagine the panel:

```promql
sum by (book_id) (rate(catalog_lookups_total[$__rate_interval]))
```

Thousands of lines, from a color palette that repeats after a few dozen, and a legend taller than
your monitor. Grafana's Legend options include a **Limit**, which caps the entries drawn — a
bandage on the display, not a fix for the query, because the panel still transfers and renders
every series.

The fix is in PromQL, and it is `topk`, from Chapter 8, "Aggregation: `sum`, `without`, and the
Rate-Then-Aggregate Law":

```promql
topk(5, sum by (book_id) (rate(catalog_lookups_total[$__rate_interval])))
```

Two habits follow. Aggregate away every label you will not read — `sum by (route)`, not
`sum by (route, method, code, instance)` — because each retained label multiplies the legend. And
write an explicit `legendFormat` such as `{{route}}`: Grafana's default is a series identifier,
not a name, and it changes shape as your labels do.

## Refresh rate is not data rate

A dashboard's `refresh` setting decides how often the browser re-runs every query. It has no
relationship to how often the data changes, and confusing the two teaches you to distrust your
own eyes. The lab's RED dashboard refreshes every thirty seconds against a fifteen-second scrape:
two scrapes per redraw. At a five-second refresh, two of every three redraws paint numbers
identical to the last ones while every panel re-queries Prometheus. Grafana's own guidance is
blunt: data that changes every hour does not need a thirty-second refresh.

The dashboard also decides which intervals you may choose. Its picker offers `10s` as the fastest
and nothing below, because `timepicker.refresh_intervals` lists exactly six values — a small act
of honesty by the author, who declined to offer an option that would only redraw stale data.

Try to set it faster still and you meet two floors. `min_refresh_interval` is the instance-wide
one: it defaults to `5s`, and you raise it with `GF_DASHBOARDS_MIN_REFRESH_INTERVAL`. Above it
sits the dashboard's own `refresh_intervals`, because the picker can only land on a value that
list contains. Ask the RED dashboard for `?refresh=1s` and you quietly get `10s`, its fastest
listed value, with Grafana rewriting the URL to say so. Nothing warns you. If you operate the
Grafana, raise the instance floor rather than trusting every dashboard author to be reasonable.

There is a subtler problem at the right-hand edge of every panel. The most recent evaluation
instant usually sits inside a window that is still filling, so the last point on a graph is
systematically low — and it is the point everybody looks at. The RED dashboard defends against
this in its time picker:

```json
"timepicker": {
  "refresh_intervals": ["10s", "30s", "1m", "5m", "15m", "1h"],
  "nowDelay": "1m"
}
```

`nowDelay` moves the panel's `now` one minute into the past. You give up sixty seconds of
immediacy and the right-hand edge of every graph becomes a settled number rather than a
descending artifact. The broken dashboard you are about to audit does not set it — not one of
its five planted lies, but worth noticing.

Comparing now against then is the other half of this. `offset`, from Chapter 11, shifts a
selector's window backward:

```promql
sum(rate(snip_http_requests_total{job="snip-api"}[5m]))
/
sum(rate(snip_http_requests_total{job="snip-api"}[5m] offset 1h))
```

A value near 1 means traffic is what it was an hour ago; on a steady lab it measures about
`0.9998`. Anything with a weekly rhythm needs `offset 7d` instead, and on this lab that returns
nothing: no data from seven days ago, so an empty denominator and a panel reading *No data* -
which looks like a broken query and is the standard fate of a week-over-week panel on a service
deployed on Wednesday.

## The panel description is where the caveats live

Every panel has a **Description** field, which shows up as a small information icon in the panel
header. Almost nobody fills it in, and it is the single highest-leverage thing in this chapter,
because it is the only place on a dashboard where you can write a sentence.

Grafana's best-practices documentation offers a test worth applying to every panel you build:
*"A dashboard should tell a story or answer a question."* A panel that answers no question is the
one that lies unnoticed, because nobody looks at it until the night they do. The lab's dashboards
are written to that rule. Here is the description on the **Process CPU by job** panel, verbatim
from `lab/dashboards/snip-red.json`:

```text
Scoped with job=~"$job". process_cpu_seconds_total exists on every
instrumented service in the stack, Go and Python alike, so an
unscoped copy of this panel silently graphs catalog, pager and
Prometheus too.
```

That is not documentation of what the panel shows. It documents the trap the panel avoids,
written by the person who nearly fell into it for the person who will next edit the query. It
names more services than your stack runs today, because it was written for the finished one:
`pager` joins in Chapter 17, "Alertmanager: Routing, Grouping and Silence", and Prometheus does
not scrape it until Chapter 20, "SLIs, SLOs and Error Budgets", so it reaches this metric later
still. You measure the real list during the audit. A good description carries four things, and
the panel title carries none of them:

- What question the panel answers, in one sentence a stranger can act on.
- The unit and the shape of the number, when either could be misread.
- What is deliberately excluded, and by which selector.
- What the panel is *not* — especially when a similar-looking number lives elsewhere.

That last one is why the lab's **Faster than 300 ms (selected routes)** Stat carries a
description several sentences long: it follows the `$route` variable, therefore includes
`/healthz`, and is therefore not the pinned objective number Chapter 20 builds on its own
dashboard. The panel is correct and would still mislead without that paragraph — which is also
why the title gained the words *(selected routes)*, and why its thresholds were flattened to a
neutral color so nobody mistakes it for a verdict.

## The lab step: find five lies

The repository ships a dashboard built to deceive you, in its own file so it can never be
confused with your own work:

```text
lab/dashboards/snip-red-BROKEN.json
```

It is provisioned like every other dashboard and lives at
`http://localhost:3000/d/snip-red-broken`; if it is not there, `git checkout ch14` is the tag that
carries it. Its own description claims that every query parses, every panel renders, nothing
errors, and exactly five properties are wrong.

Three of those four claims hold. The one that does not is your free hint. At the dashboard's
default
one-hour range `$__interval` resolves to `15s` — the data source's floor from Chapter 13 beats
the arithmetic on any panel wider than 240 pixels — and a `rate()` over a fifteen-second window
on a fifteen-second scrape covers one sample where `rate()` needs two. So one panel reads *No
data*, permanently: the only lie you can find without reading anything. Widen the range far
enough and it draws again, still wrong.

Your job is to find the other four **by reading**, before you run anything. Reading is the skill.
The verifier checks the same five properties, and it names both the defect and the panel it is
still in — which is the answer key. Run it after you have written your findings down, or run
`make verify-ch14 2>&1 | tail -3` for the score alone.

`lab/exercises/ch14-audit.md` is a template with a slot for each finding: what the panel claims,
what it actually shows, the fix, and how a reviewer catches it in ten seconds. Write the clock
time at the top before you start. Here is the checklist to audit against — the five classes,
without saying which panel has which:

1. **A ratio built by averaging ratios.** The rule from Chapter 9, "Ratios, Arithmetic, and the
   Series That Isn't There": aggregate the numerator and the denominator separately, then divide
   once. Look for `avg(` anywhere near a `/`.
2. **The wrong window on a `rate()`.** `[$__rate_interval]` for rates, `[$__interval]` for the
   `_over_time` family. One panel uses `[$__interval]` where a `rate()` needs `[$__rate_interval]`.
3. **A unit that disagrees with the query.** Read every `unit` in the file and ask what range the
   expression it belongs to can actually produce.
4. **A selector with no `job` matcher.** Metrics such as `process_cpu_seconds_total`, `go_*` and
   `python_*` exist on many jobs at once. A panel titled as though it were about your service,
   selecting on a name every service exports, is about the whole stack.
5. **A Stat presenting an old value as the current one.** Look for a panel-level `timeShift` or
   `timeFrom`, and for an `options.reduceOptions.calcs` that is neither `last` nor `lastNotNull`.
   `mean`, `max` and `min` each make a Stat show something other than the newest sample while
   still looking live.

Two of these have a lab you can run rather than reason about. For number four, ask Prometheus who
else answers:

```promql
count by (job) (process_cpu_seconds_total)
```

```text
{job="catalog"}       1
{job="loadgen"}       1
{job="prometheus"}    1
{job="snip-api"}      2
{job="snip-worker"}   1
```

Five jobs and six processes — `snip-api` runs two replicas by default — and only two of them
belong to the service that panel's title claims it is about. All six are on the graph, and the
list grows every time the stack does, or every time you scale.

For number one, do the arithmetic on paper first. Two replicas: one has served 100 requests with
1 error, the other 4 requests with 1 error, because it started thirty seconds ago.

```text
avg of the per-replica ratios   (0.010 + 0.250) / 2  =  0.130
ratio of the sums                        2 / 104     =  0.019
```

Seven times apart, from an ordinary deploy. Averaging ratios gives every replica one equal vote
whatever traffic it carried, and the vote you least want counted is always the loudest, because a
replica with four requests can have any ratio at all. Watch it in the Prometheus Query page, one
expression per query panel:

```promql
sum by (instance) (rate(snip_http_requests_total{job="snip-api",
  code=~"5.."}[5m]))
/
sum by (instance) (rate(snip_http_requests_total{job="snip-api"}[5m]))
```

```promql
sum(rate(snip_http_requests_total{job="snip-api",code=~"5.."}[5m]))
/
sum(rate(snip_http_requests_total{job="snip-api"}[5m]))
```

Run `make scale N=6` first, then both queries during an error burst. The per-instance table shows
the votes; the second query shows the answer. They agree only while every replica carries
identical traffic, which is a property of your load balancer, not your dashboard. Put the replica
count back with `make scale N=2` when you are done.

!!! trap "Trap: what a fresh checkout of the broken dashboard scores"
    This is what `make verify-ch14` says before anything is fixed — read it here rather than
    running it, for the reason below. Each `FAIL` is wrapped over two lines to fit the page; your
    terminal prints it as one.

    ```text
    == verify-ch14 ==
       expected runtime: instant

    PASS dashboards/snip-red-BROKEN.json exists
    FAIL lie 1 the averaged ratio is fixed — got still present
    in: Error ratio (5xx / all), want gone
    FAIL lie 2 $__interval on a rate() is fixed — got still
    present in: Request rate by route, want gone
    ...

    ch14: 1 passed, 5 failed
    ch14 FAILED
    ```

    Note what each line names: the defect **and** the panel it is still in. That is the answer
    key, which is why the checklist above lists the five classes without saying which panel has
    which. Write your five findings down before you run it — or run
    `make verify-ch14 2>&1 | tail -3` and get the score without the mapping.

Fix them in the file, not in the browser. The dashboards directory is bind-mounted read-only into
Grafana and re-read about every ten seconds, so a host edit appears in the browser without a
restart; if it does not, `docker compose restart grafana`. The verifier reads the repository file
and never Grafana's copy, because the repository is what ships.

Not everything unusual in that file is one of the five; anything else you notice is a bonus
finding for exercise 2.

!!! selfcheck "Self-check"
    With all five fixed, `make verify-ch14` must end:

    ```text
    PASS dashboards/snip-red-BROKEN.json exists
    PASS lie 1 the averaged ratio is fixed
    PASS lie 2 $__interval on a rate() is fixed
    PASS lie 3 a percent unit on a 0-1 ratio is fixed
    PASS lie 4 the unscoped selector that sweeps in catalog is fixed
    PASS lie 5 the Stat panel showing a stale value is fixed
         8 panels examined in snip-red-BROKEN.json
         the answer key is in Appendix B. Time yourself first.

    ch14: 6 passed, 0 failed
    ch14 OK
    ```

    The script also runs all five checks against the honest `snip-red.json` and against a
    built-in fixture carrying one lying panel and its corrected twin per lie. If a check trips on
    the honest file, or cannot tell its fixture pair apart, it says so and blames itself — that
    is the book's bug, not yours.

## Common mistakes

**Trusting a flat line.** Flat is the most dangerous shape on a dashboard: it is what you see
when nothing is happening, when the step is too wide to show what is happening, when an exporter
froze an hour ago and has repeated one value ever since, and when a selector matches nothing and
`or vector(0)` fills it in. Four states, one picture. A target that *died* does not draw a flat
line at all — the staleness marker ends it — so a line that stops is the honest case, not the
alarming one. Before you conclude "nothing happened", check the step and the freshness.

**Reading the last point on a graph.** It sits inside a window that has not finished filling, so
it is biased low, and it is the point every eye lands on. `nowDelay` fixes it at the dashboard
level; reading the second-to-last point fixes it everywhere else.

**Copying a panel and changing only the title.** This is where lie four comes from, every time.
Somebody duplicates a working panel, edits the title to say `snip-api`, and leaves a selector
that matches every job in the stack. Duplicate, then read the whole expression out loud before
you edit anything.

**Building a dashboard by adding panels.** A dashboard grows one "while I'm here" panel at a
time until it is forty panels nobody can read. Apply the test: what question does this panel
answer, and would somebody ask it at three in the morning? A panel that fails is not neutral — it
competes for attention with the panels that pass.

!!! pitfall "The panel that looks best when it is most wrong"
    A ratio panel with a `percent` unit on a healthy service reads about `0.95%` — a number that
    looks like total collapse — while the threshold, reading the raw `0.95`, paints it a calm
    color. During a real outage the ratio drops to `0.5`, the panel reads `0.50%` — a *smaller*
    number, which looks better — and the threshold turns it red. Number down, color red, and the
    two disagree about which direction is bad. Whenever a panel's color and its number seem to be
    arguing, check the unit before you check the query.

## Summary

Chapter 13 was about making a panel work. This chapter was about the gap between a panel that
works and a panel that is true, and almost every item in that gap is invisible by construction:
correct PromQL, no errors, no gray bands, no warnings.

The thread running through all of it is that a graph is a *sampled query result*. The step is
arithmetic done on your browser window, the evaluation grid is aligned to the epoch and has
nothing to do with your sample grid, and whatever misses the grid is discarded silently. Once you
have watched a real spike read `1` in one column and `63` in the next, you read dashboards as
answers to a question you should check you asked, not as pictures.

The durable takeaways:

- Widening the time range widens the step, and a spike shorter than the step is drawn only by
  luck. `max_over_time(x[$__interval])` makes peaks survive every zoom level — `[$__interval]`,
  not `[$__rate_interval]`, because the windows must tile rather than overlap.
- Series vanish entirely, not merely flatten, when no grid instant falls within the lookback
  delta of any of their samples.
- A Stat panel returns the newest sample within the five-minute lookback — unless a staleness
  marker ended that lookback early, which on a dead target it will — and shows no sign of its
  age. `timeShift` with `hideTimeOverride: true` removes the one cue Grafana would have given.
- `percentunit` is 0.0–1.0 and is what every Prometheus ratio needs. `percent` is 0–100 and turns
  `0.997` into `1.00%` — while the threshold keeps reading the raw value, so the color and the
  number can point in opposite directions. Seconds versus milliseconds is the same bug.
- Scale in the unit, never in the query. A query that ends `* 100` cannot be copied anywhere else.
- Stack only disjoint parts of one total in one unit. Two units on one panel need two axes, or
  more often two panels.
- A legend you cannot read is a failed panel. Fix it with `topk` and by aggregating away labels
  you will not read, not with a display limit.
- Refresh rate is not data rate. Two floors clamp it: the instance's `min_refresh_interval`, five
  seconds by default, and the dashboard's own `refresh_intervals` list.
- The panel description is the only place on a dashboard where you can write a sentence. Put the
  caveats there: what is excluded, what the number is not, which similar number lives elsewhere.

## Exercises

!!! exercise
    **1. The audit, timed (core).** Find all five lies in
    `lab/dashboards/snip-red-BROKEN.json` — one of them the chapter has already handed you -
    before reading Appendix B, filling in `lab/exercises/ch14-audit.md` as you go. Write down
    your start and finish times. Then run `make verify-ch14`; it must print `ch14 OK` with 6
    passed and 0 failed. Finally read Appendix B and note which of the five you would have
    merged.

    **2. Plant a sixth (core).** Make one panel on the broken dashboard lie in a way this
    chapter did not list — a stacked latency panel, a legend of nine thousand entries, a `ms`
    unit on a seconds metric, a threshold band that colors the wrong direction. Commit it, write
    nothing down, and come back in a week. Find it again, and time that too. The gap between the
    two timings is what a panel description is worth.

    **3. Client versus server (stretch).** The lab's **Client-observed vs server-observed p95**
    panel already puts these two on one chart:

    ```promql
    histogram_quantile(0.95, sum by (le) (
      rate(snip_http_request_duration_seconds_bucket{job=~"$job",
        route=~"$route"}[$__rate_interval])
    ))
    ```

    ```promql
    histogram_quantile(0.95, sum by (le) (
      rate(loadgen_request_duration_seconds_bucket{job="loadgen",
        route=~"$route"}[$__rate_interval])
    ))
    ```

    Run `curl -s -XPOST http://localhost:8089/control -d '{"rps":60}'` and watch the gap widen,
    then reset with `curl -s -XPOST http://localhost:8089/chaos/reset`. Write two sentences
    explaining where the difference lives. Then say which line you would show a product manager
    and which you would show the engineer who has to fix it, and why those differ.

    **4. Refresh faster than the data (warm-up).** Choose the picker's fastest option, `10s`,
    against the lab's 15-second scrape, and watch one number for two minutes. Count how many
    redraws changed the value and how many repainted the last one. Then append `?refresh=1s` to
    the dashboard URL and record what the picker reads once the page has loaded. Describe in one
    sentence what you are actually watching when a dashboard redraws more often than data
    arrives.

    **5. Three descriptions (core).** Write panel descriptions for the three RED panels on
    `/d/snip-red` — request rate, error ratio, latency quantiles — good enough that a stranger at
    three in the morning uses them correctly. Each must name the unit, name what the selector
    excludes, and name one thing the panel is not. Compare yours with the descriptions already in
    the file; where they disagree, decide which is right and say why. Some of those descriptions
    name a recording rule, a `docs/SLO.md` and a `/d/snip-slo` dashboard that do not exist yet —
    they were written for the finished stack, so ignore the forward references and read the
    reasoning.

    **6. Somebody else's dashboard (stretch).** Take one panel from any public Grafana dashboard
    and run this chapter's five checks against it by hand, using the table at the bottom of
    `lab/exercises/ch14-audit.md`. Record how many it failed. Then check the one thing no
    automated checker can: does the panel answer a question, and can you say what the question is?

!!! note "Part IV, closing"
    Two chapters ago the page that woke somebody at 03:14 named `172.19.0.7:8000`, adding a
    replica meant hand-editing a config file and reloading, and a panel meant one thing at one
    hour and something else at one day. Scaling `snip-api` from two replicas to six is now one
    config edits, every target names itself, and every panel on the RED dashboard means the same
    thing at every zoom level and on every screen. What is still missing is that somebody has to
    be looking at it. Chapter 15, "Recording Rules" makes the expensive queries cheap; Chapter 16,
    "Alerting Rules, and What 'Firing' Actually Means" is where being the one who looks stops
    being your job.
