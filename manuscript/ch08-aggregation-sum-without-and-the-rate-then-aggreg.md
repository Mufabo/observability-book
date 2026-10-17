# Chapter 8 — Aggregation: `sum`, `without`, and the Rate-Then-Aggregate Law

Snip has run as two containers since Chapter 2, "What's Actually on the
Wire", and Chapter 7, "Labels, and the Cardinality Arithmetic You Must
Do First", gave its request counter a `route` label. Those two facts
multiply. Type `rate(snip_http_requests_total{job="snip-api"}[1m])` into
the Query page now and Prometheus hands you twenty-four lines: twelve
route-method-code combinations, twice over, once per replica. Every one
is correct. None is the number you wanted, which was *how busy is Snip
right now*.

Twenty-four lines is the good case. A service with four replicas, eight
routes and a handful of status codes produces a few hundred. You cannot
page a human with that, because a page has to say *which service* and
*how bad*, and a hundred correct lines say neither. What is missing is a
way to collapse many series into few — and a way to do it that does not
quietly throw away the labels that decide who gets woken up.

That is this chapter, and three build on it: Chapter 9, "Ratios,
Arithmetic, and the Series That Isn't There"; Chapter 10, "Latency:
Histograms Without Tears"; and Chapter 11, "Joins, Info Metrics, and the
Rest of PromQL". One thing here is not a technique but a **law** — an
ordering rule that, broken, puts a spike of seven hundred requests per
second on your graph during a restart that served nobody at all. You are
going to cause that spike on purpose and then take it apart.

!!! objectives "Objectives"
    After this chapter you can:

    - Use all twelve aggregation operators and say what each returns.
    - Choose `without()` over `by()` by default, and give the reason that
      has nothing to do with typing.
    - Demonstrate on your own lab that `sum(rate(x))` and `rate(sum(x))`
      disagree, and say which one is lying.
    - Explain why `topk(3, ...)` on a graph can draw forty lines.
    - Tell `count` and `count_values` apart, and pick the right one.
    - Instrument a process that has no HTTP handlers at all.

## Where the lab is

Chapter 7 left you five targets, two Snip replicas, and a request counter
with `route`, `method` and `code` on it. This chapter adds a sixth
target, and the checkout brings it:

```bash
cd lab
git checkout ch08
make up
docker compose restart prometheus
```

That last line is not decoration. `make up` recreates a container only
when its image or its service definition changes, and this checkout edits
`lab/prometheus/prometheus.yml` rather than the `prometheus` service, so
the running server would keep the configuration it read at startup. A
restart and not a reload, because until Chapter 12, "`prometheus.yml` in
Full: Service Discovery and Relabeling", adds `--web.enable-lifecycle`
there is no reload endpoint to call. The named volume means it costs you
no data.

If something has drifted further than a checkout can fix,
`make reset && git checkout ch08 && make up` — in that order, because a
Prometheus data directory written by a later chapter does not always
start under an earlier one.

## What an aggregation operator actually does

An **aggregation operator** takes an instant vector — many series, each
with one sample at the evaluation timestamp — and returns a smaller one.
It sorts the input series into **groups**, computes one number per group,
and emits one output series per group.

With no grouping clause there is exactly one group, and it contains
everything:

```promql
sum(rate(snip_http_requests_total{job="snip-api"}[1m]))
```

```text
{}   20.09
```

One series, no labels at all, and a value near twenty because the load
generator has been sending twenty requests per second since Chapter 1.
The empty `{}` is not a display quirk: the output series genuinely has no
labels, including no `__name__`. The ten operators that *compute* a
number all drop the metric name, because the result is no longer it.

Count what it collapsed:

```promql
count(snip_http_requests_total{job="snip-api"})
```

```text
{}   24
```

Twelve combinations from Chapter 7, on two instances. Notice what `count`
counted — series, not requests. `sum` adds up sample values; `count`
ignores them and tallies how many series arrived in the group. Confusing
the two is the most common aggregation bug there is, and it never
announces itself, because both return a plausible number.

Here are all twelve. Eight take no parameter and behave exactly like
`sum`; four take one, written first, inside the parentheses.

| Operator | Returns per group | Notes |
|---|---|---|
| `sum` | total of the values | the everyday one |
| `min` / `max` | smallest / largest value | across series |
| `avg` | arithmetic mean | across series, not across time |
| `count` | how many series | ignores the values |
| `stddev` | population standard deviation | across series |
| `stdvar` | the same, squared: the variance | rarely what you want |
| `group` | the constant `1` | "does this group exist" |
| `topk(k, v)` | the k largest series | keeps original labels |
| `bottomk(k, v)` | the k smallest series | keeps original labels |
| `quantile(q, v)` | the value ranked at `q`, 0 to 1 | across series |
| `count_values(l, v)` | one series per distinct value | see the note that follows |

`topk` and `bottomk` are the odd pair. They do not compute a new number;
they *select* input series and pass them through untouched, labels and
values intact. That is why they alone keep `__name__`: the series in the
result are the originals.

`quantile` is not the histogram function. `quantile(0.5, v)` ranks the
*series in v* by their current values and interpolates the middle one. It
answers "what does the median replica look like", not "what is the median
request latency"; the function for that arrives in Chapter 10.

!!! iou "IOU from Chapter 7, settled here"
    Chapter 7 borrowed three of these on credit so that you could count
    series before you had been taught to: `count()`, `count by (…)` and
    `topk(10, …)`. They are all in that table, and the rest of this
    chapter is the family they belong to — including the rule that
    governs when you may point any of them at a counter.

## The grouping clause: `by` and `without`

A **grouping clause** tells the operator how to split the input into
groups. It comes in two spellings that mean opposite things.

`by (a, b)` says: **keep only** labels `a` and `b`. Two series land in
the same group when they agree on `a` and `b`, whatever else they
disagree about.

`without (a, b)` says: **discard** labels `a` and `b`, keep everything
else. Two series land in the same group when they agree on every label
except those two.

Either form may be written before or after the parentheses —
`sum by (route) (x)` and `sum(x) by (route)` parse identically. Every
expression here writes it first, the order Prometheus's own query
prettifier produces.

Take the twenty-four request series and group them by route:

```promql
sum by (route) (rate(snip_http_requests_total{job="snip-api"}[1m]))
```

```text
{route="/"}               0.04
{route="/healthz"}        1.11
{route="/l/{code}"}      16.09
{route="/links"}          1.00
{route="/links/{code}"}   1.80
{route="other"}           0.04
```

Six lines instead of twenty-four, and the load generator's traffic mix is
visible in them: the redirect path carries eighty percent of everything.
Now ask the same question the other way around:

```promql
sum without (instance, code) (
  rate(snip_http_requests_total{job="snip-api"}[1m])
)
```

```text
{env="lab", job="snip-api", method="GET",
  route="/"}                                      0.04
{env="lab", job="snip-api", method="GET",
  route="/healthz"}                               1.11
{env="lab", job="snip-api", method="GET",
  route="/l/{code}"}                             16.09
{env="lab", job="snip-api", method="POST",
  route="/links"}                                 1.00
{env="lab", job="snip-api", method="GET",
  route="/links/{code}"}                          1.80
{env="lab", job="snip-api", method="GET",
  route="other"}                                  0.04
```

Same six groups. Same six numbers. Very different label sets. `by
(route)` returned series that know only their route. `without (instance,
code)` returned series that still know their job, environment, method and
route — everything they started with, minus the two dimensions you asked
to fold away.

There is a surprise in there. You did not ask for `env`, and you may well
have forgotten it exists; it has been on every series since Chapter 1,
attached by the scrape configuration rather than by Snip. `without` kept
it anyway, because `without` keeps what it was not told about. `by` is an
allowlist, `without` is a denylist, and denylists let through the things
you have not thought of yet.

!!! iou "IOU from Chapter 3, settled here"
    Chapter 3 had you paste this operator into three panels on a printed
    promise that Chapter 8 would explain it: `sum by (route) (...)` into
    the per-route panel, a bare `sum(...)` twice into the error ratio, and
    `sum by (le) (...)` into the latency panel. That is what you have just
    read. `sum` adds values; `by (route)` groups so that exactly one
    series comes back per route; and `sum` with no clause at all is the
    one-group case this section opened with. (Why `le` has to survive the
    clause is Chapter 10's, along with the function wrapped around it.)
    Chapter 5 deferred the same operator, so *IOU from chapter 5,
    settled* too. Of Chapter 3's four IOUs, `rate()` was settled in
    Chapter 6; two remain — `histogram_quantile` in Chapter 10 and `$__rate_interval` in
    Chapter 13.

## Why `without` is the habit and `by` is the exception

The two forms are equally correct and equally fast. The reason to make
`without` your default has nothing to do with the query and everything to
do with what happens to the result *after* it comes back.

In Chapter 16, 'Alerting Rules, and What "Firing" Actually Means', you
will write an alerting rule whose expression is an aggregation of exactly
this shape. In Chapter 17, "Alertmanager: Routing, Grouping and Silence",
you will send the resulting alerts to different places depending on their
labels — that is what routing means, and every routing decision is a
label match.

Now look again at what `by (route)` returned. `{route="/healthz"}`. No
job on it, no environment on it. If that expression becomes an alert, it
arrives carrying the name of a route and nothing else, and there is
nothing in it to route on. Worse, if a second service in the same
organization also has a `/healthz` route and also aggregates
`by (route)`, the two produce series with identical label sets, and
nothing anywhere can tell them apart.

`sum without (instance, code)` has the opposite property. It answers the
same question and arrives with `job`, `env`, `method` and `route` intact.

So the rule is: **name what you want to lose, not what you want to
keep.** You always know what you are folding away — that is the point of
the query. You do not always know what else is on the series, and those
are exactly the labels a future scrape-configuration change will add.

`by` is still right in two situations. The first is when you want one
specific shape and the extra labels would be noise: a top-level "requests
per second, per job" tile is honestly `sum by (job)`. The second is when
the input carries a label that must not survive, and naming everything
else would be absurd:

```promql
count by (job) (up)
```

```text
{job="catalog"}       1
{job="loadgen"}       1
{job="prometheus"}    1
{job="snip-api"}      2
{job="snip-worker"}   1
```

That is "how many targets does each job have", and `by (job)` is the
honest way to write it. `instance` is the label you are counting over, so
it must go. `count without (instance) (up)` returns the same five numbers
and drags `env` along, which is noise in a target census.

There is a third case, and it catches people out: the label you must lose
is one you have not met. `count without (instance)` on a metric that also
carries `zone` and `pod` returns one series per zone per pod. So: when
you are collapsing *to* a known shape, use `by`; when you are collapsing
*away* a known dimension, use `without`. Most days you are doing the
second.

!!! warning
    Aggregating a **gauge** across replicas is where `sum` stops being
    the obvious choice. `snip_links_active` reports how many short links
    currently exist. Both replicas read that from the same database, so
    both report the same number:

    ```text
    snip_links_active{instance="snip-api:8000"}     605
    snip_links_active{instance="snip-api-b:8000"}   600
    ```

    (The five-point gap is the two containers refreshing that gauge on
    independent timers, nothing more.) `sum without (instance)
    (snip_links_active)` returns `1205` — and there are about six hundred
    links, not twelve hundred. `avg without (instance) (...)` returns
    `602.5` and `max without (instance) (...)` returns `605`, and both
    answer the question a human asked. Ask what the number *means*
    before you pick the operator: totals are for things each replica
    owns a share of, averages and maxima for things each replica
    separately reports about one shared world.

## The everyday shape, on a panel

`sum without (instance, code)` is the shape you will write most often
against a request counter, so build a panel out of it and keep it.

Open the Snip RED dashboard, add a panel, and set its visualization to
**Table**. Give it this query, and set the panel to run an instant query
rather than a range query — a table wants one row per series carrying
the current value, not a line of history each:

```promql
sum without (instance, code) (
  rate(snip_http_requests_total{job="snip-api"}[$__rate_interval])
)
```

Set the unit to requests per second and title it "Rate by route and
method". `$__rate_interval` is the last of Chapter 3's unsettled IOUs;
Chapter 13, "Dashboard Mechanics: Intervals, Panels and Variables", pays
it off. For now, read it as Grafana substituting a window that suits the
panel's width — a sensible `[1m]`.

You should now see six rows, one per route-and-method pair, with a
`Value` column that adds up to roughly twenty. The `instance` column is
gone, which is the point: the panel is about Snip, not about which
container answered.

## The rate-then-aggregate law

Now the reason two replicas exist.

You want one line on a graph showing Snip's total request rate. There are
two ways to write it, and they read like the same sentence with the words
in a different order. The first takes the rate of each series and then
adds the rates up:

```promql
sum(rate(snip_http_requests_total{job="snip-api"}[1m]))
```

The second adds the counters up and then takes the rate of the total.
That one you cannot write directly, because `sum(...)` returns an instant
vector and `rate()` demands a range vector — Chapter 6's type rule. There
is a syntax that bridges the gap:

```promql
rate(sum(snip_http_requests_total{job="snip-api"})[1m:15s])
```

!!! iou "IOU — Chapter 11"
    That `[1m:15s]` is a **subquery**. It re-evaluates the expression in
    front of it every fifteen seconds across the last minute, producing a
    range vector out of something that was not one. The `15s` is this
    lab's scrape interval, chosen so the synthetic series gets one point
    per scrape and nothing is invented between them; Chapter 11 teaches
    the rest, including what goes wrong when that number and the window
    are the same. It appears here for one reason: without it, the mistake
    this section is about could not be written down at all. Copy it — and
    notice that PromQL made you work to say the wrong thing.

Run both against the lab as it stands. They agree, to within a rounding
error:

```text
sum(rate(...[1m]))            20.05
rate(sum(...)[1m:15s])        20.09
```

Two expressions, one answer. This is the situation in which people
conclude the two forms are interchangeable and pick whichever reads
better. Do not conclude that yet.

### Give the second replica a history

Chapter 2 told you something about `snip-api-b` that now becomes
load-bearing: nothing addresses it. The load generator sends its traffic
to `snip-api` by name, and `snip-api-b` publishes no host port either, so
its counter has been sitting at zero since the container started. Check:

```promql
sum by (instance) (rate(snip_http_requests_total{job="snip-api"}[1m]))
```

```text
{instance="snip-api:8000"}   20.05
{instance="snip-api-b:8000"}     0
```

One replica is doing all of the work and the other has never done any, so
its counter still reads exactly zero. That is not a fault — Chapter 12 is
where a reverse proxy finally shares the load out for real.

A replica whose counter is zero cannot take part in what follows, and the
reason why is the most useful thing in this section. The failure you are
about to produce depends on the **summed** counter visibly *falling*, and
`snip-api` is adding about three hundred requests to that total every
fifteen seconds. If `snip-api-b` disappears carrying a history of
nothing, the total does not fall; it carries on climbing, and nothing
downstream has anything to misread. That is why this bug is so hard to
catch in the wild: it needs a replica with a real history to go away, and
most of the time nothing goes away.

So give it one. Nothing on your laptop can reach `snip-api-b`, but
anything already inside the Compose network can, and Valkey's container
has a shell and BusyBox's `wget` in it. Three thousand requests take
about five seconds:

```bash
docker compose exec -T valkey sh -c \
  'i=0; while [ $i -lt 3000 ]; do
     wget -q -O /dev/null http://snip-api-b:8000/healthz
     i=$((i+1))
   done'
```

The `-T` turns off terminal allocation, which lets this run identically
from a Windows shell and a Linux one. Now wait at least ninety seconds —
long enough for the burst to fall out of a one-minute rate window — and
read the raw counters:

```promql
sum by (instance) (snip_http_requests_total{job="snip-api"})
```

```text
{instance="snip-api:8000"}     34153
{instance="snip-api-b:8000"}    3000
```

The left number keeps climbing while you read. The right one will not
move again, because nothing else in the lab talks to that container.

Three thousand is ten times the three hundred `snip-api` adds per
fifteen-second step, so when those series go away the total has nowhere
to go but down. **Write the sum of the two numbers down — 37,153 — and
divide it by the sixty seconds of the rate window: about 620.**

### Two panels, one restart

Put the two expressions side by side. Add a time series panel to your
dashboard with:

```promql
sum(rate(snip_http_requests_total{job="snip-api"}[1m]))
```

and a second one, immediately beside it, with:

```promql
rate(sum(snip_http_requests_total{job="snip-api"})[1m:15s])
```

Title them honestly — "rate then sum" and "sum then rate" — set both to
requests per second, and set the dashboard's time range to the last
fifteen minutes. Both panels should be drawing the same flat line near
twenty, and both are describing a service that is completely healthy,
because it is.

Then restart one replica. This is the most ordinary operation there is:
a deploy, a config change, a container that ran out of memory overnight.

```bash
docker compose restart snip-api-b
```

!!! trap "The spike that never happened"
    Within a scrape or two the two panels stop agreeing, and they do not
    disagree slightly:

    ```text
    sum(rate(...[1m]))        20.05 →  20.09  → 20.05
    rate(sum(...)[1m:15s])    20.09 → 772.33  → 20.09
    ```

    Seven hundred and seventy-two requests per second, on a service that
    is serving twenty and has never served more. The left panel does not
    move **at all** — not a dip, not a wobble — because the replica you
    restarted was not carrying live traffic. The right panel holds its
    spike for about forty-five seconds, exactly as long as the restart
    stays inside the query's one-minute window, then drops back to twenty
    and leaves no trace.

    If you had been looking at a dashboard, you would have opened an
    incident. If a threshold had been watching that panel, it would have
    paged you at 03:00. Nothing happened. The service was fine.

Your peak will not be 772.33, and it should not be. Compare it with the
620 you wrote down: measured peaks on this lab land twenty to forty
percent above the prediction, because `rate()` extrapolates out to the
edges of the window. What you should get right is the order of magnitude
— hundreds, against a true twenty. Run the experiment an hour later and
the spike will be bigger, because the counter will be.

If the right panel never moves, the drop was too small to see. Re-read
`sum by (instance)`: if `snip-api-b` is back at zero, the restart you
just did reset it, and a second restart has nothing to remove. Seed it
again and repeat.

### What actually happened

`rate()` knows that counters reset to zero when a process restarts,
because Chapter 4, "Metric Types Are Contracts", established that they do
and Chapter 6 established what `rate()` does about it. Walking the
samples in its window, any time a sample is *lower* than the one before
it, `rate()` concludes that a reset happened and adds the pre-drop value
back into the total increase.

The correction is applied **per series**, and that is the entire lesson.

Written the right way round, `rate()` runs on
`snip_http_requests_total{instance="snip-api-b:8000", ...}` — one
container's counter, whose resets are that container's resets. The
restarted replica's twelve series go stale and come back at zero,
`rate()` corrects for exactly that, `sum` adds the two corrected rates
together, and the result is honest. It would dip if the restarted replica
had been serving anything; here it does not, because it was not.

Written the wrong way round, `sum` runs first. What `rate()` receives is
a single synthetic series — the total across both replicas — with no
memory that it was ever two things. When `snip-api-b`'s series go away
during the restart (they vanish rather than flat-line, which is Chapter
2's staleness marker doing its job), that total drops by the restarted
replica's entire lifetime count. `rate()` cannot know that this was
bookkeeping rather than a reset. It sees a decrease, calls it a reset,
and adds the whole pre-drop total back in.

!!! sidebar "Where the number comes from"
    Skippable arithmetic, but it is why the prediction works at all.
    `rate()` computes `last − first + correction`, and the correction it
    adds on a decrease is the sample immediately before the drop — here
    the *combined* counter, 37,153. Subtracting `first` cancels most of
    the departed replica's share, so what survives is very close to the
    counter of everything that did **not** restart: 34,153. Divide by the
    sixty-second window and you land near 570 to 620; extrapolation out
    to the window edges covers the rest of the distance to 772.

    Two things follow that are worth more than the arithmetic. The spike
    scales with **how long the survivors have been running**, not with
    how busy anything is. And it appears only when the vanishing
    replica's history is large enough to make the total fall — which is
    why the same wrong expression can look perfect for months.

The law, then, and it has no exceptions:

**Take the `rate()` first. Aggregate second.** `sum(rate(x[1m]))` is
right; `rate(sum(x)[1m:])` is wrong. The same order applies to
`increase()` and `irate()`: the only operations you may apply directly to
a raw counter's values are the ones that understand resets, and `sum` is
not one of them.

This is a fault that testing cannot find. On a single replica the two
forms are genuinely identical, because summing one series returns that
series. On many replicas they are identical too — until something
restarts, and even then only if the thing that restarted had enough
history to make the total fall. Which means the wrong form ships, passes
review, works perfectly for months, and then lies to you on the one
afternoon you need it.

## `topk`, and why three can mean forty

`topk(k, v)` returns the k input series with the largest values. Run it
as an instant query against the shape you built earlier:

```promql
topk(3, sum without (instance, code) (
  rate(snip_http_requests_total{job="snip-api"}[1m])
))
```

```text
{env="lab", job="snip-api", method="GET",
  route="/l/{code}"}                             16.47
{env="lab", job="snip-api", method="GET",
  route="/links/{code}"}                          1.73
{env="lab", job="snip-api", method="GET",
  route="/healthz"}                               1.09
```

Three lines, sorted largest first, carrying the labels and the values the
input had. Exactly what you asked for. Note which series is *not* there:
`POST /links` runs within a fifth of a request per second of `/healthz`,
so which of the two takes third place changes from one evaluation to the
next. Remember that; it is the whole of the next box. Now put the same
expression on a graph over six hours and count the entries in the legend.

!!! pitfall "topk on a graph"
    A graph is not one query. It is one query re-run at every step across
    the time range — a **range query**, in Chapter 6's vocabulary — and
    `topk` is evaluated independently at every one of those evaluation
    timestamps. If `/healthz` was third busiest at 09:00 and `/links` was
    third busiest at 09:05, both appear in the result, and each one's
    line is drawn only over the steps where it happened to win. A
    six-hour `topk(3, ...)` panel on a busy service routinely returns
    twenty or forty distinct series, each a broken dashed fragment. Even
    this lab, with six routes and almost no variation, returns **four**
    series for a `topk(3, ...)` over the last hour: `/l/{code}` and
    `/links/{code}` hold the top two at every step; third place
    alternates between `/healthz` and `POST /links`; and `/` and
    `other`, at two hundredths of a request per second, never appear at
    all. The panel is not buggy. It is answering the question you asked
    several hundred times over, and taking the union of the answers.

    The sorting does not survive either. Output is sorted by value for
    instant queries; no sorting applies to range queries at all.

The fix is to compute the ranking once, at a fixed point in time, and
then draw the live values of only those series. That needs the `and`
operator from Chapter 9 and the `@` modifier from Chapter 11, so for now
the rule is: `topk` belongs in tables and instant queries, not on a time
series graph.

## `count` versus `count_values`

`count` counts series. It answers "how many of these are there".

```promql
count without (instance) (snip_http_requests_total{job="snip-api"})
```

```text
{code="200", env="lab", job="snip-api", method="GET",
  route="/"}                                                2
{code="200", env="lab", job="snip-api", method="GET",
  route="/healthz"}                                         2
{code="302", env="lab", job="snip-api", method="GET",
  route="/l/{code}"}                                        2
```

…and nine more like them, twelve rows in all, each reading `2`, because
each combination exists on both replicas. Useful, and unexciting.

`count_values` counts something else entirely. It groups the input by
**sample value**, returns one series per distinct value, and writes that
value into a label you name. Snip exports a build-information metric
whose value is always `1` and whose labels carry the version. Ask how
many copies of the API are running each version:

```promql
count_values by (version) ("copies", snip_build_info{job="snip-api"})
```

```text
{copies="1", version="1.4.0"}   2
```

Read that carefully, because the two numbers in it mean opposite things.
The label `copies="1"` is the *sample value* of `snip_build_info`, which
is always 1 — the convention for information metrics from Chapter 4. The
series' value, `2`, is how many series in that version's group carried
that sample value: one per replica of `snip-api`. Roll a new version
through half of a real fleet and the result becomes two rows with two
counts, a genuinely useful answer to "is the deploy finished".

Drop the `by (version)` and you get `{copies="1"} 2` — every series
lumped into one group, because every value is 1. `count_values` without a
grouping clause is almost never what you want on an information metric.

The simplest operator of the twelve is `group`. It returns the constant
`1` for every group that contains anything at all:

```promql
group by (route) (snip_http_requests_total{job="snip-api"})
```

```text
{route="/"}              1
{route="/healthz"}       1
{route="/l/{code}"}      1
{route="/links"}         1
{route="/links/{code}"}  1
{route="other"}          1
```

That is "which routes currently exist", with the magnitudes deliberately
thrown away: a set rather than a measurement. Because every value is
exactly 1, it makes a clean input for the comparisons Chapter 9 builds.

Two more are worth knowing exist. `stddev` gives the spread of a value
across series at one instant:

```promql
stddev without (instance) (
  rate(snip_http_requests_total{job="snip-api"}[1m])
)
```

Twelve rows come back, one per combination. The interesting one is the
redirect:

```text
{code="302", env="lab", job="snip-api", method="GET",
  route="/l/{code}"}                                    8.23
```

That is a spread of 8.23 around a mean of 8.23 — maximum imbalance, and
correct, because one replica is serving every redirect and the other
none. Behind a working load balancer the same number sits near zero, and
a climb away from zero means one container is doing something its peers
are not. (`stdvar` is that number squared. You will want it roughly
never.)

And `quantile` ranks series rather than observations. With one replica
serving twenty and the other zero, `quantile(0.5, sum by (instance)
(rate(...)))` returns `10.02`: a precise answer to a question nobody
should ask of two machines, and a useful one across twenty.

## Instrumenting something that is not a web server

Every metric you have written so far hangs off an HTTP handler. Real
systems are full of processes that have none — queue consumers, cron
jobs, sync loops — and a request counter has nothing to say about them.
Snip now has one.

The checkout added this service to `lab/compose.yaml`. It is the same
image as `snip-api`, one environment variable apart:

```yaml
  # ── ch8 ─────────────────────────────────────────────────────────
  # The same image as snip-api, one environment variable apart. It
  # has no HTTP API — only a metrics endpoint — which is what forces
  # the "how do I instrument something that is not a web server"
  # question.
  snip-worker:
    build:
      context: ./snip
      target: worker
    restart: unless-stopped
    environment:
      SNIP_ROLE: worker
      SNIP_DATABASE_URL: >-
        postgres://snip:snip@postgres:5432/snip?sslmode=disable
      SNIP_VALKEY_ADDR: valkey:6379
      SNIP_VERSION: ${SNIP_VERSION:-1.4.0}
      SNIP_COMMIT: ${SNIP_COMMIT:-a1b2c3d}
      SNIP_NO_ZERO_INIT: ${SNIP_NO_ZERO_INIT:-0}
    ports:
      - "8090:8090"
    depends_on:
      postgres:
        condition: service_healthy
      valkey:
        condition: service_healthy
    networks: [obsnet]
    mem_limit: 256m
```

The shipped file writes that database URL with the same
`${POSTGRES_USER}` and `${POSTGRES_PASSWORD}` variables the `postgres`
service reads, so changing one cannot leave half the stack talking to a
database that no longer exists; the URL printed here is what those
defaults resolve to. `SNIP_ROLE: worker` selects a different entry point
in the same binary, and `target: worker` is the image stage that sets it
and exposes 8090 instead of 8000. `SNIP_NO_ZERO_INIT`, at its default
of `0`, is what makes every `(queue, outcome)` pair exist at zero before
it has ever happened; Chapters 9 and 16 turn it off on purpose.

The worker runs two queues on their own timers. `expiry` deletes one
expired link per job; `analytics` processes one recorded redirect per
job. It serves nothing but `/metrics` on port 8090, because a process
nothing can scrape is a process nobody can see.

And this job to `lab/prometheus/prometheus.yml`:

```yaml
  # ── ch8 ─────────────────────────────────────────────────────────
  # The same binary in a different role. It serves no API at all —
  # only /metrics on 8090.
  - job_name: snip-worker
    static_configs:
      - targets: ["snip-worker:8090"]
        labels:
          env: lab
```

That edit is why the checkout was followed by
`docker compose restart prometheus`: a scrape job only reaches a server
that has read the file. Check it now — http://localhost:9090/targets
shows a sixth target reading UP and `count(up)` returns `6`. If it still
returns `5`, the restart is the thing you skipped.

### Four families, and not a request among them

The worker's instrumentation lives in `lab/snip/metrics.go`, beside the
API's. Four families, and each shape is a decision:

```go
type workerMetrics struct {
	QueueDepth  *prometheus.GaugeVec
	Jobs        *prometheus.CounterVec
	JobDuration *prometheus.HistogramVec
	LastSuccess *prometheus.GaugeVec
}
```

| Metric | Type | `# HELP` |
|---|---|---|
| `snip_worker_queue_depth` | gauge | Jobs currently waiting in the named worker queue. |
| `snip_worker_jobs_total` | counter | Total background jobs processed, by queue and outcome. |
| `snip_worker_job_duration_seconds` | histogram | Time taken to process one background job, in seconds, by queue. |
| `snip_worker_last_success_timestamp_seconds` | gauge | Unix timestamp of the last successfully completed job, by queue. |

The third is a histogram, and histograms are Chapter 10's subject. Leave
it alone for now; the only part you need today is
`snip_worker_job_duration_seconds_count`, a plain counter of finished
jobs that behaves like any other.

The other three are the answer to "what do you measure when there are no
requests". Depth of the backlog. Count of work done, split by outcome.
And the time the queue last succeeded at anything — a gauge whose value
is a Unix timestamp, which sounds strange until you notice that "nothing
has succeeded for eleven minutes" is the most useful fact there is about
a background job.

Recording them is three small methods, and the queue loop never sees a
metrics library:

```go
func (m *workerMetrics) setQueueDepth(queue string, n int) {
	m.QueueDepth.WithLabelValues(queue).Set(float64(n))
}

func (m *workerMetrics) observeJob(
	queue, outcome string, secs float64,
) {
	m.Jobs.WithLabelValues(queue, outcome).Inc()
	m.JobDuration.WithLabelValues(queue).Observe(secs)
}

func (m *workerMetrics) markSuccess(
	queue string, unixSeconds float64,
) {
	m.LastSuccess.WithLabelValues(queue).Set(unixSeconds)
}
```

Fetch the exposition and look at what a service with no API exports:

```bash
curl -s localhost:8090/metrics \
  | grep '^snip_worker' | grep -v job_duration
```

```text
snip_worker_jobs_total{outcome="error",queue="analytics"} 0
snip_worker_jobs_total{outcome="error",queue="expiry"} 0
snip_worker_jobs_total{outcome="skipped",queue="analytics"} 1
snip_worker_jobs_total{outcome="skipped",queue="expiry"} 32
snip_worker_jobs_total{outcome="success",queue="analytics"} 21200
snip_worker_jobs_total{outcome="success",queue="expiry"} 2352
snip_worker_last_success_timestamp_seconds{queue="analytics"}
    1.7898127278952308e+09
snip_worker_last_success_timestamp_seconds{queue="expiry"}
    1.7898127178255372e+09
snip_worker_queue_depth{queue="analytics"} 6977
snip_worker_queue_depth{queue="expiry"} 0
```

(The two timestamp lines are one line each on the wire, folded here to
fit the page. The second `grep` drops the histogram.)

No `snip_http_requests_total`. There is no HTTP to count. Your numbers
will differ — they depend on how long the worker has been running — but
the shapes will not.

Two things in there earn their place. `outcome="skipped"` is what a queue
records when it woke up and found nothing to do: a real outcome,
deliberately counted, because an idle worker and a dead worker must not
look identical. And every `(queue, outcome)` pair exists at zero before
it has ever happened, which is Chapter 5's pre-initialization.

### What a queue gauge shows, and what it hides

Now aggregate the worker, and watch the difference between a gauge and a
counter stop being an abstraction. Graph these together:

```promql
snip_worker_queue_depth
```

```promql
sum without (instance) (
  rate(snip_worker_jobs_total{job="snip-worker"}[5m])
)
```

The two queues behave completely differently, and that is the point.

`analytics` has a genuine backlog. One redirect writes one row for it to
process, so work arrives at the redirect rate — sixteen a second, the
number the `sum by (route)` table gave you for `/l/{code}`. The queue
wakes every five seconds and runs at most forty jobs per wake-up
(`maxBurst`, in `lab/snip/worker.go`), which is eight a second, and you
can read that ceiling straight off the counter: the `success`/`analytics`
line settles at exactly `8.00` however deep the queue gets.

The gauge tells the truth about that: a number in the thousands, which is
what a backlog looks like. What it does *not* do is climb without limit,
and the reason is worth chasing down. Sixteen in against eight out should
add nearly thirty thousand rows an hour; leave the lab running and it
does not, the depth wandering inside a band a few thousand wide instead.
Something other than this queue is removing rows. It is the other queue:
links expire after ten minutes, and `link_events` references `links` with
`ON DELETE CASCADE` in `lab/postgres/initdb/01-schema.sql`, so every link
the `expiry` queue deletes takes its own unprocessed events with it. The
backlog settles at roughly one link-lifetime of unprocessed redirects.

`expiry` is the opposite. It wakes every twenty seconds and deletes up to
forty expired links one at a time — on this lab that is the whole
backlog, so it is empty again a fraction of a second later. Prometheus
scrapes every fifteen seconds, the two rhythms do not line up, and the
gauge loses: over twenty minutes it read `0` on every one of the eighty
scrapes in the window, while the counter beside it recorded about one
successful expiry job per second, without a gap. Widen the range to a few
hours and you catch the occasional non-zero sample — four or five percent
of them, peaking in the low hundreds after a burst of traffic has aged
into expiry.

You can count those scrapes yourself with Chapter 6's sample-counter:

```promql
count_over_time(snip_worker_queue_depth{queue="expiry"}[20m])
```

```text
{env="lab", instance="snip-worker:8090", job="snip-worker",
  queue="expiry"}                                       80
```

Eighty samples in twenty minutes is one every fifteen seconds, exactly as
configured — eighty honest readings of a queue that did real work in the
gaps between them. The gauge is not wrong. It is *blind between
scrapes*, and no amount of PromQL can recover a burst that was never
sampled. The counter cannot hide the same events, because it accumulates
them instead of describing the present.

That asymmetry is why the two families ship side by side. Alert on the
counter; use the gauge to see how deep the backlog is now. And use
`snip_worker_last_success_timestamp_seconds` for the question neither
answers — *is this thing still alive* — because a crashed worker and an
idle one differ only in how long ago they last finished something.

Now re-run the version census with the `job` filter taken off:

```promql
count_values by (version) ("copies", snip_build_info)
```

It reads `3`, not `2`: the worker runs the same image, so it exports the
same build-information metric under a different job. That shared series
is what Chapter 11 uses to join across jobs.

!!! selfcheck "Self-check"
    `make verify-ch08` checks that the worker's four families exist, that
    the depth gauge covers both queues, and then proves the law: it
    restarts a replica and asserts that the wrong expression exceeded the
    right one by more than five times at some timestamp. It takes about
    two and a half minutes, and on a lab that came up in the last few
    minutes it first raises the load generator to 300 rps for thirty
    seconds and puts it back — a counter with nothing in it has no cliff
    to fall off.

    Re-seed `snip-api-b` first. The restart you did a moment ago put its
    counter back to zero, and with nothing to remove there is no drop for
    the script to find:

    ```bash
    docker compose exec -T valkey sh -c \
      'i=0; while [ $i -lt 3000 ]; do
         wget -q -O /dev/null http://snip-api-b:8000/healthz
         i=$((i+1))
       done'
    make verify-ch08
    ```

    ```text
    PASS snip_worker_queue_depth exists
    PASS snip_worker_jobs_total exists
    PASS snip_worker_job_duration_seconds_count exists
    PASS snip_worker_last_success_timestamp_seconds exists
    PASS snip_worker_queue_depth covers both queues
         restarting obslab-snip-api-b-1 to manufacture the counter reset
         predicted spike multiple if we restarted now: 216.3x
         restarted; waiting 70 s for the artifact to appear
    PASS rate(sum(...)) exceeds sum(rate(...)) by over 5x
         peak multiple: 19.745148954748952x — that is the spike you would
         have shown a product manager.
         sum(rate(...)) peaked at 20.191624573378837 over the same window
    PASS the restarted replica is scraped again

    ch08: 7 passed, 0 failed
    ch08 OK
    ```

    That predicted multiple grows with how long the lab has been up, so
    yours will not be 216; under ten is where the script raises traffic
    first and inserts two more lines saying so. The `peak multiple` note
    is the whole chapter, and the line under it is its control: the
    honest expression stayed at twenty while the other went to four
    hundred.

    If the assertion reads FAIL, or the script reports that the two
    expressions could not be compared, it prints both halves for you to
    run by hand. Check `sum by (instance)` first, because a `snip-api-b`
    sitting at zero is the one condition under which the lesson cannot
    happen. Then run it again: the script waits a fixed seventy seconds
    for the restart to land inside a one-minute rate window, and a first
    run that misses is worth repeating before you go looking for a
    fault.

## Common mistakes

**Aggregating away `job`.** `sum by (route) (...)` is the most-copied
aggregation on the internet, and the one that produces alerts nobody can
route. Say what you are discarding instead:
`sum without (instance, code) (...)`.

**Summing a gauge that every replica reports identically.** Before
choosing `sum`, ask whether each series reports *its own share* of
something — sum it — or *its view* of one shared thing — average it, or
take the maximum.

**Reaching for `count_values` when you meant `count`.** `count_values`
groups by the *sample value*. On a metric whose value is a measurement,
that gives you one output series per distinct float — on live data,
roughly one output series per input series. If your question contains the
words "how many series", the operator is `count`.

**`topk` on a time series panel.** Forty lines in the legend when you
asked for three, all dashed, none complete, none sorted. It is evaluating
independently at every step. Move it to a table.

**Forgetting that `without` keeps what you did not name.** It kept `env`
in every example here, which is usually what you want — until somebody
adds a target label and a one-line panel silently becomes a six-line
panel. Chapter 15, "Recording Rules", is where this bites hardest.

!!! pitfall "Rate after aggregate"
    `rate(sum(x)[5m:])`, `increase(sum(x)[1h:])` and every variation on
    the theme are wrong for one reason: `sum` produces a series with no
    memory of the individual counters underneath it, so `rate()` reads
    one instance's restart as everybody's reset. It looks correct for
    weeks, because it *is* correct until something with a history
    disappears. Then it reports hundreds of requests per second that
    never happened, at the moment a deploy or a crash makes you look.
    Rate first, aggregate second, always.

## Summary

Aggregation operators group an instant vector and return one series per
group. There are twelve; `sum`, `count` and `avg` cover most days, and
the ten that compute a value all drop the metric name.

The grouping clause is the part that matters. `by` keeps only what you
list; `without` drops only what you list and preserves everything else,
including labels you have forgotten about and labels that do not exist
yet. Preserving them is not tidiness — it is what lets an alert be
delivered to the right human in Chapter 17.

And `rate()` has to come first. Everything else here is a technique; that
one is a law, provable on your own laptop with one
`docker compose restart`, and invisible until the day it matters.

Durable takeaways:

- Every computing aggregation drops `__name__`; `topk` and `bottomk` are
  pass-through selectors and hand back the original series intact.
- `sum without (instance, code)` is the default shape for a request
  counter. Name what you discard, not what you keep.
- An expression that has aggregated away `job` cannot be routed, and
  cannot be told apart from another service's.
- `sum(rate(x[1m]))` is right. `rate(sum(x)[1m:])` manufactures a spike
  out of a restart, sized at the counter's total divided by the rate
  window — and only when the vanishing replica had enough history to
  make that total fall.
- `topk` in a range query is evaluated per step, so a panel can contain
  far more than k series, and range-query output is not sorted.
- `count` counts series; `count_values` counts occurrences of each
  distinct sample value and needs a grouping clause to be useful.
- A process with no requests is measured with a depth gauge, an
  outcome-labeled counter, and a last-success timestamp — and a gauge
  sampled every fifteen seconds cannot see a queue that empties inside
  one second.

## Exercises

!!! exercise
    **1. Three rewrites (core).** Find three `by()` aggregations — here,
    in the Snip dashboard, or in any tutorial you have open — and
    rewrite each as the equivalent `without()`. For each, name a label
    that `by()` discarded and that a Chapter 17 routing rule will want.
    You should end with three pairs that return identical values and
    different label sets; confirm that with `count()` around each side.

    **2. topk, twice (core).** Run
    `topk(3, rate(snip_http_requests_total{job="snip-api"}[5m]))` as an
    instant query and count the result rows. Then graph the same
    expression over six hours and count the distinct legend entries.
    Write both numbers down and one sentence explaining the gap. You
    should see exactly 3 in the first case and more than 3 in the second
    — four or five over an hour, and one or two more as you widen the
    window, because each extra entry won third place at some step and
    lost it at the next. Then count the points on each line: two are
    complete and the rest are fragments.

    **3. Version census (warm-up).** Use `count_values` to answer "how
    many processes are running each build version?" from
    `snip_build_info`. You should get a single row reading `3`. Now write
    the same answer with `count`, and say in one line which of the two
    you would put on a deploy dashboard, and why.

    **4. Depth, averaged or totaled (core).** Run
    `avg without (instance) (snip_worker_queue_depth)` and
    `sum without (instance) (snip_worker_queue_depth)`. They return
    identical numbers today. Say why, then say what each would return on
    three workers, and which you would put a threshold on. Then watch
    `snip_worker_queue_depth{queue="analytics"}` for five minutes. It
    barely moves, even though eight jobs a second are draining and
    sixteen redirects a second arrive. Something else is removing rows.
    Read `lab/postgres/initdb/01-schema.sql` and say what.

    **5. Something a counter cannot say (stretch).** Add one metric to
    `lab/snip/metrics.go` that describes the worker and that a request
    counter could not express. Say what makes it different in kind — not
    in subject. Rebuild with `make up` (editing the file changes nothing
    until the image is rebuilt), confirm the new family at
    http://localhost:8090/metrics, confirm Prometheus has it one scrape
    later, and check that its name obeys Chapter 5's naming law.

    **6. Predict the spike (stretch).** Re-seed `snip-api-b`, then write
    down the peak you expect `rate(sum(...)[1m:15s])` to reach, computed
    from `sum(snip_http_requests_total{job="snip-api"})` and the rate
    window. Restart the replica and read the peak off the panel. You
    should be within a factor of two, and at least ten times above the
    honest rate. If you are not, check `sum by (instance)` before you
    check your arithmetic.
