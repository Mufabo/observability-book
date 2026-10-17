# Chapter 10 — Latency: Histograms Without Tears

Someone opens a ticket that says "Snip is slow." You look at the dashboard.
The request rate is normal. The error ratio is a flat zero. The one latency
panel you have says p95 is four milliseconds, and it has said four
milliseconds all afternoon. You reply that everything looks fine, you are
wrong, and you have no way to know that you are wrong.

The person who filed the ticket clicked a short link and waited twelve
seconds. Twelve seconds is real. It happened. It is in your service's own
measurements right now. The reason you cannot see it is that "how long did
requests take" is not one number, and every attempt to squeeze it into one
number throws away exactly the part you needed. A mean hides a tail. A
median hides everything except the middle. And the p95 you are staring at
was computed by a tool that had already been handed the wrong raw material.

This chapter is about the raw material. By the end of it your service will
export a distribution instead of a number, you will be able to ask that
distribution three genuinely different questions, and — this matters more
than it looks — you will be able to tell the difference between "the
service got slower" and "my buckets cannot describe what happened." Those
two produce the same graph. Only one of them is an incident.

!!! objectives "Objectives"
    After this chapter you can:

    - Read a classic histogram's `_bucket{le}` / `_sum` / `_count` anatomy,
      and say why cumulative buckets can be added across replicas while a
      summary's quantiles cannot.
    - Answer "what fraction of requests were faster than 300 ms" exactly,
      and recognize that ratio as a service level indicator.
    - Compute a mean latency, and say when a mean describes nobody.
    - Use `histogram_quantile` correctly, keep `le` in the grouping clause,
      and diagnose a pinned p99 as *my buckets are wrong* rather than
      *the tool is broken*.
    - Choose bucket boundaries backwards from a threshold you care about
      instead of accepting whatever your client library ships.
    - State the three independent opt-ins native histograms still require,
      and say why `curl` shows you nothing.

## Why a quantile is the wrong thing to store

Start with the thing everybody reaches for. You want p95 latency, so you
have your service compute p95 latency and export it. One number, one
series, cheap. It is a trap, and the reason it is a trap is worth the two
minutes it takes to see.

!!! jargon "Quantile"
    The *q*-quantile of a set of observations is the value below which a
    fraction *q* of them fall. The 0.95-quantile — p95 — of a set of
    request durations is the duration that 95 % of requests came in under.
    A percentile is the same thing scaled to 100. It is a property of a
    *population*, not of any single request.

That last sentence is load-bearing, because a property of a population is
not something you can combine. Your lab runs two `snip-api` replicas.
Suppose one handles 1 request per second with a p95 of 10 ms, and the
other handles 1,000 requests per second with a p95 of 900 ms. What is the
p95 across both?

It is about 900 ms, because 99.9 % of the traffic is the second replica's.
The average of the two exported p95 values is 455 ms — a number that
corresponds to no request that has ever happened on either machine. There
is no arithmetic you can do to the two p95 values that recovers the right
answer, because the answer depends on how many observations sat behind
each one, and that information was thrown away at the moment the quantile
was computed.

!!! pitfall "Never average a quantile"
    `avg(something{quantile="0.95"})` and
    `avg(histogram_quantile(0.95, ...))` are the same mistake wearing two
    different outfits: a number computed from a whole population being fed
    into a mean. The Prometheus documentation calls the results
    "statistically nonsensical values", which is unusually blunt for a
    reference manual. The rule that follows is the one you will use every
    day: **aggregate the counts, then compute the statistic.** Never the
    other way around. It applies over time as well as over replicas —
    averaging yesterday's p95 values does not give you yesterday's p95.

Chapter 4, "Metric Types Are Contracts", introduced the summary — the
metric type that exports pre-computed quantiles — and this is why it was
introduced as legacy. A summary hands you an answer you cannot combine with
any other answer.

So do not store the answer. Store enough counting to reconstruct any answer
later. That is a **histogram**: a set of counters, one per bucket, each
counting how many observations fell at or below some boundary. Counters
add. Two replicas' bucket counts add. A week of bucket counts adds. And
because the arithmetic happens at query time, you get to change your mind
about which question you are asking without redeploying anything.

## Where the lab is

Everything here runs against the stack as Chapter 9, "Ratios, Arithmetic,
and the Series That Isn't There", left it: two `snip-api` replicas,
`snip-worker`, `catalog`, `loadgen`, Prometheus and Grafana.

```bash
cd lab
git checkout ch10
make up
make ps
```

`make up` brings up `snip-api` and `snip-api-b`, two containers of the same
image, so your `instance` labels read `snip-api:8000` and
`snip-api-b:8000`. Snip answers on `http://localhost:8000/`, Prometheus on
`http://localhost:9090/`, Grafana on `http://localhost:3000/`. Put the load
generator into a known state before you measure anything:

```bash
curl -s -XPOST http://localhost:8089/control \
  -H 'Content-Type: application/json' \
  -d '{"rps":20,"route":"mix","error_ratio":0}'
```

The `ch10` tag already contains this chapter's edit: two histograms in
`snip/metrics.go`, the middleware in `snip/api.go` that observes one of
them, a single `Observe` call in `snip/db.go`, and three new panels in
`dashboards/snip-red.json`. If you would rather type them yourself, stay on
`ch09`.

## What a histogram looks like on the wire

`snip/metrics.go` gains two histograms. Here is the bucket list the whole
chapter turns on:

```go
// sloBuckets are designed backwards from the objective chapter 20
// declares: 300 ms. 0.3 is a real boundary, so the "99% under 300
// ms" SLI can be read straight off a bucket instead of interpolated
// out of a quantile. Thirteen finite bounds; the +Inf bound is added
// implicitly and must never be written here.
var sloBuckets = []float64{
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.3, 0.5, 0.75, 1, 2.5, 5, 10,
}
```

and the metric that uses it:

```go
Duration: f.NewHistogramVec(prometheus.HistogramOpts{
    Name: "snip_http_request_duration_seconds",
    Help: "Latency of HTTP requests handled by the Snip API, " +
        "in seconds.",
    Buckets: requestBuckets(c),
}, []string{"route", "method", "code"}),
```

The second histogram, `snip_db_query_duration_seconds`, times the database
calls with a deliberately different bucket list, because a database round
trip is not an HTTP request and the interesting range starts a decade
lower:

```go
var dbBuckets = []float64{
    0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5,
}
```

Both are observed **in seconds**, from a monotonic clock. The database one
is a single line in `snip/db.go`:

```go
s.dur.WithLabelValues(op).Observe(time.Since(start).Seconds())
```

`.Seconds()`, not `.Milliseconds()`. Hold on to that: a service in this lab
gets it wrong, on purpose, and you are going to find it.

Now look at what comes out. On the wire every sample is one line; a few of
the lines that follow are wrapped to fit the page, with the continuation
indented, and ten bucket lines in the middle have been cut for space.

```bash
curl -s localhost:8000/metrics \
  | grep snip_http_request_duration_seconds \
  | grep -E '# (HELP|TYPE)|/healthz'
```

```text
# HELP snip_http_request_duration_seconds Latency of HTTP
    requests handled by the Snip API, in seconds.
# TYPE snip_http_request_duration_seconds histogram
snip_http_request_duration_seconds_bucket{code="200",
    method="GET",route="/healthz",le="0.005"} 2891
snip_http_request_duration_seconds_bucket{code="200",
    method="GET",route="/healthz",le="0.01"} 2903
    [ ten bucket lines cut ]
snip_http_request_duration_seconds_bucket{code="200",
    method="GET",route="/healthz",le="10"} 2914
snip_http_request_duration_seconds_bucket{code="200",
    method="GET",route="/healthz",le="+Inf"} 2914
snip_http_request_duration_seconds_sum{code="200",
    method="GET",route="/healthz"} 1.0412887380000002
snip_http_request_duration_seconds_count{code="200",
    method="GET",route="/healthz"} 2914
```

Chapter 2, "What's Actually on the Wire", called this shape a **metric
family**: one name you wrote, several series on the wire. Now you can read
every part of it.

`le` is short for *less than or equal*, and the buckets are **cumulative**.
`le="0.01"` reads 2,903 — that is not "requests that took between 5 and 10
milliseconds", it is "requests that took **10 ms or less**, all of them,
including everything already counted in `le="0.005"`". Each bucket is a
running total. This is the single most common misreading of a Prometheus
histogram, and it is worth saying out loud once: every bucket contains
every smaller bucket.

Three consequences fall straight out of that.

`le="+Inf"` counts every observation, so it is always exactly equal to
`_count`. In the sample here both read 2,914. That is not a coincidence you
should ever have to check. The counts never decrease as `le` grows, because
each one contains the one below it. And subtracting two buckets gives you a
band: `le="10"` minus `le="0.01"` is the number of requests that took more
than 10 ms and at most 10 s.

`_sum` is the total of every observed value, in seconds. `_count` is how
many observations there were. Those two are a mean waiting to be divided,
and they are the reason a histogram can answer a question its boundaries
have no answer for.

Here is the same idea as a picture. Four boundaries, seven requests, and
the number each bucket reports:

```text
 requests (seconds) ─▶  .002  .004  .02  .06  .3   .4   9.0
                          │     │    │    │   │    │     │
 le="0.005"  counts ──▶   ■     ■                            = 2
 le="0.05"   counts ──▶   ■     ■    ■                       = 3
 le="0.3"    counts ──▶   ■     ■    ■    ■   ■              = 5
 le="+Inf"   counts ──▶   ■     ■    ■    ■   ■    ■     ■   = 7
```

Read down a column and you see one request being counted again in every
bucket above it. That repetition is the whole trick: it is what makes the
counts addable across replicas, and it is what makes them cost series.

### What it costs

Chapter 7, "Labels, and the Cardinality Arithmetic You Must Do First",
asked you to predict the size of this histogram before it existed. Time to
settle up.
Thirteen finite boundaries produce thirteen `_bucket` series, plus one for
`+Inf`, plus `_sum`, plus `_count`: **sixteen series per label
combination**. Snip's request histogram carries `route`, `method` and
`code`, and the catalog closes that set at twelve combinations, so the
ceiling is 12 × 16 = **192 series per replica**. Count what you actually
have:

```promql
count by (instance) (
  {__name__=~"snip_http_request_duration_seconds_(bucket|count|sum)",
   job="snip-api"}
)
```

You will get a number below 192 for each replica, and the gap is the
lesson. Unlike the counters in `snip_http_requests_total`, the histogram is
deliberately **not** pre-initialized at startup — a zero-count histogram is
sixteen series that say nothing at all. A `(route, method, code)`
combination only appears once it has actually happened.

So the number you see is sixteen times however many combinations your
traffic has produced, and that depends on how long the lab has been up.
Count the combinations themselves and the arithmetic closes:

```promql
count by (instance) (
  snip_http_request_duration_seconds_count{job="snip-api"}
)
```

The redirect, the write, the lookup and the health check show up inside the
first minute. `POST /links` answering `400` waits for the malformed-URL
trickle. `/` and `other` arrive with the browser-and-scanner noise every
thirty seconds. The two `500`s need the error injector:

```bash
curl -s -XPOST http://localhost:8089/control \
  -H 'Content-Type: application/json' \
  -d '{"error_ratio":0.2}'
```

Watch both numbers move, then set `error_ratio` back to `0`. The `503`
combination is the last holdout: it only exists when Postgres is
unreachable.

Sixteen series for one histogram on one route triple is the number to carry
around in your head. It is why adding a label to a histogram is a different
decision from adding one to a counter, and why the label you rejected in
Chapter 7 was almost certainly the right call.

### The bucket that is there and is not there

Look at the exposition again. The Go client wrote `le="10"`. Now ask
Prometheus what it stored:

```promql
count by (le) (
  snip_http_request_duration_seconds_bucket{job="snip-api"}
)
```

Fourteen rows come back, and their `le` values are:

```text
0.005  0.01  0.025  0.05  0.1  0.25  0.3  0.5  0.75
1.0    2.5   5.0    10.0  +Inf
```

`1.0`. `5.0`. `10.0`. Not `1`, `5`, `10`. The wire said one thing and the
database says another, because Prometheus 3 **normalizes** the `le` label
of classic histograms — and the `quantile` label of summaries — to a
canonical float form on ingestion, whatever the target served. A value that
would otherwise contain neither a decimal point nor an exponent gets `.0`
appended. `0.3` already has a point, so it survives untouched; `10` does
not, so it becomes `10.0`. Large boundaries get the other surprise:
`100000000` is stored as `1e+08`.

!!! trap "The bucket that is there and is not there"
    Every histogram tutorial written before 2025 selects buckets like this:

    ```promql
    snip_http_request_duration_seconds_bucket{job="snip-api", le="1"}
    ```

    ```text
    Empty query result
    ```

    No error. No warning. No rows. The series exists, your service is
    exporting it right now, and the selector matches nothing because the
    stored label value is `1.0`. Written the other way it works:

    ```promql
    snip_http_request_duration_seconds_bucket{job="snip-api", le="1.0"}
    ```

    ```text
    snip_http_request_duration_seconds_bucket{code="302", ...,
      instance="snip-api:8000", le="1.0"}     11631
    snip_http_request_duration_seconds_bucket{code="302", ...,
      instance="snip-api-b:8000", le="1.0"}   11402
    ```

    A dashboard panel, or an alert expression stored in a file, that
    hard-codes `le="1"` went blank on the day its Prometheus was upgraded
    to 3, and nothing in the system said so. Do not guess at `le` values,
    and do not copy them out of `curl`. List them with
    `count by (le) (...)` and paste what comes back.

There is a happier way to avoid the whole problem, and it arrives in the
section on `histogram_fraction`. First, the questions.

## Question one: what fraction was fast enough?

Here is the order this chapter insists on, and it is the reverse of most
treatments: **ratios first, mean second, quantiles last.** Not because
quantiles are hard, but because the first question is the one that turns
into something you can act on, and the last question is the one that most
often turns into an argument.

The first question is: *what fraction of requests came back in under 300
milliseconds?* Not "what is p95" — the actual thing a person waiting for a
page cares about, expressed as a proportion.

Because `0.3` is a real bucket boundary, the answer is already counted. The
numerator is the `le="0.3"` bucket. The denominator is `_count`. Both are
counters, so both need `rate()` — Chapter 6's rule has not gone anywhere:

```promql
sum(rate(snip_http_request_duration_seconds_bucket{
      job="snip-api", le="0.3"}[5m]))
/
sum(rate(snip_http_request_duration_seconds_count{
      job="snip-api"}[5m]))
```

On a healthy lab that reads `1`, or a hair under it if a cold cache clipped
a request or two. Everything Snip does is faster than 300 ms, which is
exactly what you would hope, and the answer is a proportion between 0 and 1
rather than a duration.

Two things about the shape of that expression are not optional.

**`sum()` on both sides, before the division.** Try it without:

```promql
rate(snip_http_request_duration_seconds_bucket{
      job="snip-api", le="0.3"}[5m])
/
rate(snip_http_request_duration_seconds_count{
      job="snip-api"}[5m])
```

```text
Empty query result
```

Chapter 9 explains why: a vector-to-vector division matches samples by
their full label set, and the left side carries an `le` label the right
side does not, so nothing on the left has a partner. Wrapping both sides in
`sum()` throws every label away and leaves one number over one number. If
you want the answer split by route, do it symmetrically:

```promql
sum by (route) (rate(snip_http_request_duration_seconds_bucket{
      job="snip-api", le="0.3"}[5m]))
/
sum by (route) (rate(snip_http_request_duration_seconds_count{
      job="snip-api"}[5m]))
```

**The denominator can be `_count` or the `+Inf` bucket.** They carry the
same values by construction. `_count` reads better; plenty of published
examples use `le="+Inf"`; neither is wrong.

This ratio is worth a name. It is a **service level indicator** — an SLI —
which at this stage is nothing more grand than a number between 0 and 1
saying what fraction of events were good. Chapter 20, "SLIs, SLOs and Error
Budgets", gives the precise definition, builds an objective on top of
exactly this expression, and Chapter 21 makes alerts out of it. That is not
a detour: it is why `0.3` is in the bucket list at all. Somebody decided
the objective first, and the instrumentation was designed backwards from
it.

!!! iou "IOU from chapter 3, settled"
    Chapter 3 put a p95 latency panel on your dashboard and printed an IOU
    for the expression inside it, promising `histogram_quantile`, the
    `_bucket` series and the `le` label here. All three arrive in this
    chapter. You also now know why that panel had to read the load
    generator's histogram rather than your own service's: `snip-api` did
    not export one until this chapter added it.

### The same question without the `le` literal

There is a function that asks the fraction question directly, and it never
makes you type a bucket boundary as a string:

```promql
histogram_fraction(0, 0.3,
  sum by (le) (rate(snip_http_request_duration_seconds_bucket{
    job="snip-api"}[5m])))
```

`histogram_fraction(lower, upper, v)` returns the estimated fraction of
observations between `lower` and `upper`. It works on classic histograms
like this one and on native histograms, which arrive at the end of the
chapter, and it sidesteps the `le="1"` versus `le="1.0"` trap entirely
because no `le` value appears in the query. Note the `sum by (le)` on the
inside: the function needs the buckets, so `le` has to survive the
aggregation — a rule `histogram_quantile` will make a great deal of.

Run it against the bucket ratio. The two agree, because `0.3` is a real
boundary of this histogram.

!!! warning "A threshold that is not a boundary cannot be answered"
    Classic histogram buckets do not interpolate for this question. Ask for
    the fraction under 0.28 seconds on a histogram whose boundaries are
    0.25 and 0.3, and there is no honest answer available: the counts do
    not record where inside that band the observations fell. The documented
    behavior is not an estimate but no result at all. The bucket-ratio form
    fails the same way for the same reason — a selector for `le="0.28"`
    matches no series, and an empty numerator makes the whole division
    empty.

    The fix is never a cleverer query. The fix is to put the boundary in
    the histogram before you need it, which is what Chapter 20's 300 ms
    objective bought when it reached back into this chapter's bucket list.

### Build the panel

The reference dashboard `dashboards/snip-red.json` has a stat panel called
**Faster than 300 ms (selected routes)**. Build your own version of it. The
intent, not the clicks:

- Query: the `le="0.3"` bucket ratio. Run it once rather than over a range
  — the panel shows one number, not a line.
- Unit: a ratio displayed as a percentage. The value really is between 0
  and 1, so do not multiply by 100 in the query; let the display do it.
- Title: something that says what it measures.
- Description: say out loud that this is a proportion and not a quantile,
  and that it covers whichever routes the panel is scoped to. The shipped
  panel's description spends four sentences on the difference between this
  number and the service level *objective* — the SLO, which Chapter 20
  defines — and that tells you how often people confuse the two.

The panel reads essentially 100 % on a healthy lab. Leave it up. Shortly
you are going to watch it fall to just over 98 %, and knowing why is the
point of the chapter.

## Question two: the mean

The second question is the boring one, and it earns its place because
`_sum` and `_count` are already there and the arithmetic is free:

```promql
sum(rate(snip_http_request_duration_seconds_sum{
      job="snip-api"}[5m]))
/
sum(rate(snip_http_request_duration_seconds_count{
      job="snip-api"}[5m]))
```

That reads a few milliseconds — around `0.005` on an unloaded laptop.
Seconds of latency accumulated per second, divided by requests per second,
leaves seconds per request. The units work out, which is a good habit to
check.

Aggregate both sides again, and for a sharper reason than before. Written
without the `sum()`s:

```promql
rate(snip_http_request_duration_seconds_sum{job="snip-api"}[5m])
/
rate(snip_http_request_duration_seconds_count{job="snip-api"}[5m])
```

this one *does* return data — the label sets match on both sides — but what
it returns is one mean per `(route, method, code)` per replica, which is a
dozen or more lines and is not the mean of anything anybody asked about.
Both forms are useful; only one of them answers "how long does a request to
Snip take."

Now the honest part. A mean is the right tool when you want a total: mean
latency times request rate is total time spent waiting, which is a real
quantity with a real budget attached. It is the wrong tool the moment the
distribution has more than one hump.

Snip's has three. Requests that hit the cache come back in a millisecond or
two. Requests that miss and go to Postgres take several times that.
Requests to `GET /links/{code}` call out to `catalog` and take longer
again. The mean of those three populations sits in a gap between them,
describing a request the service never actually serves. You will see it on
the heatmap: bright bands with the mean line running through empty space
between them.

The rule to take away: **a mean tells you about the total, a quantile tells
you about a person.** When someone says "the site feels slow," they are
never talking about a mean.

## Question three: `histogram_quantile`

Now the function everyone wanted from the start.

```promql
histogram_quantile(0.95,
  sum by (le) (rate(snip_http_request_duration_seconds_bucket{
    job="snip-api"}[5m])))
```

Read it from the inside out, because the order is mandatory and every layer
is there for a reason.

`rate(..._bucket[5m])` first, because the buckets are counters. Without
`rate()` you get the quantile over everything since the process started,
which barely moves and tells you nothing about now. Try it once so you
recognize the shape:

```promql
histogram_quantile(0.95,
  snip_http_request_duration_seconds_bucket{job="snip-api"})
```

Numbers come back. They are the p95 of all of history, one per replica per
route triple, and they will still be there tomorrow reading almost the
same. It is not an error. It is worse than an error, because it looks like
an answer.

`sum by (le)` second, because you have two replicas and several routes and
you almost never want a quantile per series. Summing the bucket *rates*
across replicas is legitimate in a way that averaging their p95 values is
not: you are adding counts, and counts add.

`histogram_quantile(0.95, ...)` last, on the aggregated buckets. That is
"aggregate the counts, then compute the statistic", written in PromQL.

Change the first argument to get p50 and p99. Those three expressions are
the **Latency quantiles** time series panel: three queries on one panel,
legend `p50` / `p95` / `p99`, unit seconds, minimum 0. The reference
dashboard adds a dashed threshold line at 0.3 s so the bucket boundary is
visible on the graph — a reference mark, not the objective.

### What the function is actually doing

Inside a bucket, `histogram_quantile` assumes the observations are spread
evenly and interpolates linearly. That assumption is usually wrong in
detail and usually fine in practice. Two of its consequences are not
optional knowledge, though — they are the source of most "the tool is
broken" tickets in the world.

!!! note "The two rules that decide every classic quantile"
    **The floor rule.** The lowest bucket is assumed to have a lower limit
    of 0, provided its upper bound is greater than 0. If the quantile lands
    in that lowest bucket, the answer is interpolated between 0 and that
    bound. If the lowest bound is not greater than 0, the bound itself is
    returned.

    **The ceiling rule.** If the quantile lands in the highest bucket — the
    `+Inf` one — the function returns **the second-highest bucket's upper
    bound**. In other words, your p99 can never exceed your largest finite
    boundary. A p99 sitting at exactly `10` on a histogram whose top finite
    bucket is 10 does not mean "ten seconds". It means "at least ten
    seconds, and this histogram has no idea".

If the summed buckets are not monotonic — replicas scraped a moment apart
can do that, and so can floating-point error — `histogram_quantile` repairs
the ordering itself and says so in an info-level annotation about input
that "needed to be fixed for monotonicity". You do not have to act on it.

Two more rules complete the set, and both produce `NaN` rather than an
error. Fewer than two buckets in the input gives `NaN`. A highest bucket
whose bound is not `+Inf` gives `NaN`. You can produce both at once:

```promql
histogram_quantile(0.9,
  sum by (le) (rate(snip_http_request_duration_seconds_bucket{
    job="snip-api", le="0.3"}[5m])))
```

```text
{}   NaN
```

One bucket went in, and it was not `+Inf`. This is why you must never
filter a histogram down to the buckets you find interesting: the function
needs the whole ladder, top rung included.

### The mistake that gets everybody

Every latency panel on Earth eventually gets copied, edited and broken the
same way. Someone wants the quantile per job, so they write `by (job)`.

Do it deliberately, now, so that you recognize it later:

```promql
histogram_quantile(0.99,
  sum by (job) (rate(snip_http_request_duration_seconds_bucket{
    job="snip-api"}[2m])))
```

!!! trap "The missing `le`"
    ```text
    Empty query result
    ```

    No error, no `NaN`, no red banner. The query "succeeded". Summing
    `by (job)` collapsed all fourteen buckets of every route triple into
    one number and threw the `le` label away with them, so
    `histogram_quantile` was handed samples it cannot interpret. It reads
    `le` off every input sample; when it cannot, it attaches a warn-level
    annotation and skips the series. Every series skipped leaves nothing
    behind.

    The annotation is the only diagnostic you get, and the web UI prints it
    above an empty table where it is easy to scroll past. From the API it
    is a top-level array:

    ```bash
    curl -sG --data-urlencode \
      'query=histogram_quantile(0.99, sum by (job) (rate(
         snip_http_request_duration_seconds_bucket[2m])))' \
      http://localhost:9090/api/v1/query | jq .warnings
    ```

    ```text
    [
      "bucket label \"le\" is missing or has a malformed value"
    ]
    ```

    The exact wrapping varies between releases; the phrase to grep for is
    `bucket label`. The fix is one word: `sum by (job, le)`.

The general rule is easy to remember once you have been bitten: **`le` must
survive the grouping clause.** `by (le)`, `by (job, le)`, `by (route, le)`
— whatever else you group by, `le` comes too. With `without()` the rule
inverts and is easier to get right by accident: `sum without (instance)`
keeps `le`, because it drops only what you name.

!!! ladder "Ladder → rung 4"
    An empty result from a histogram query is almost always rung 4 of the
    debugging ladder in Appendix B: the series exist, but not with the
    labels you asked for. For histograms there are exactly two usual
    suspects — a dropped `le` in the aggregation, or an `le` literal in the
    wrong float form. Check them in that order.

## The incident: a p99 that cannot move

Everything so far has been arithmetic. Now break something.

Forty requests per second, and a delay header stamped on two percent of the
routes that can carry one. `loadgen` never delays `/healthz`, `/` or its
scanner traffic, so those two percent apply to 95 % of the mix and 1.9 % of
all requests spend twelve seconds inside the handler. The rest are
untouched: this is a tail, not an outage.

```bash
curl -s -XPOST http://localhost:8089/control \
  -H 'Content-Type: application/json' \
  -d '{"rps":40,"extra_latency_ms":12000,
       "latency_ratio":0.02,"timeout_ms":15000}'
```

Four fields, and the fourth is the one that needs explaining. `loadgen`
drives Snip over ordinary HTTP with an ordinary client, and that client
gives up after two seconds by default. A caller that hangs up takes the
server's request context with it, and Snip's injected delay is written to
stop early when that happens — so with the default timeout you would be
measuring a two-second client abort, not a twelve-second server response.
Raising the client's patience above the delay you injected is what makes
the server-side histogram see the real number. Check that no requests are
being abandoned:

```promql
sum by (reason) (rate(loadgen_request_failures_total[5m]))
```

Everything should be zero or absent. If `reason="timeout"` is climbing, the
`timeout_ms` never landed.

Now give it two full minutes before you read anything. Every expression
here is a rate over a five-minute window, and a window that is mostly
outside the injection shows you mostly the past. Then look at your panels,
in this order.

**"Faster than 300 ms" falls to just over 0.98** — about `0.981`. Nearly
two percent of requests are no longer fast. The panel does precisely what
it says on the tin, and — worth noticing — it is the only one of the three
numbers you could have predicted before running anything, from the
injector's settings plus the fact that `/healthz` is never delayed.

**The mean explodes.**

```promql
sum(rate(snip_http_request_duration_seconds_sum{
      job="snip-api"}[5m]))
/
sum(rate(snip_http_request_duration_seconds_count{
      job="snip-api"}[5m]))
```

It climbs from roughly `0.005` to roughly `0.23`. The arithmetic is exactly
what you would do on paper: 0.981 × 0.005 + 0.019 × 12 ≈ 0.23. A tail of
under two percent, and the mean is nearly fifty times its baseline. If you
have ever heard that averages are not robust, this is what that sentence
looks like on a graph.

**The p50 does not move at all.**

```promql
histogram_quantile(0.5,
  sum by (le) (rate(snip_http_request_duration_seconds_bucket{
    job="snip-api"}[5m])))
```

Still a couple of milliseconds, and it should be: 98 % of requests were
never touched, so the middle of the distribution is where it was.
The median is the robust statistic here and the average is not, which is
the reverse of what most people expect, and it is the whole argument for
having quantiles at all.

**And the p99 pins.**

```promql
histogram_quantile(0.99,
  sum by (le) (rate(snip_http_request_duration_seconds_bucket{
    job="snip-api"}[5m])))
```

```text
{}   10
```

Ten. Exactly ten, to as many decimal places as the panel will show, and it
stays at exactly ten for as long as the injection runs. It is not
oscillating around ten. It is not converging on ten. It is *pinned* at ten,
and if you doubled the injected delay to twenty-four seconds it would still
be ten.

That is the ceiling rule, live. The top finite bucket of this histogram is
10 seconds. Every twelve-second request landed in `+Inf`, the 99th
percentile is in that bucket, and the function's documented answer for "the
quantile is in the highest bucket" is the second-highest bucket's bound.
The histogram is not lying to you. It is telling you, in the only
vocabulary it has, that it cannot see up there.

Prove it from the counts rather than taking the function's word for it.
Classic buckets are cumulative, so `le="+Inf"` is the total request rate
and barely moves during the injection; what changes is `le="10.0"`, which
drops by nearly 2 %. The difference between the two is the rate of requests
the histogram can no longer describe:

```promql
sum(rate(snip_http_request_duration_seconds_bucket{
      job="snip-api", le="+Inf"}[5m]))
-
sum(rate(snip_http_request_duration_seconds_bucket{
      job="snip-api", le="10.0"}[5m]))
```

About `0.76` requests per second, which is 1.9 % of 40. Those are the
requests that fell off the top of your instrument. Note the `10.0`: this is
the normalization trap again. Writing `le="10"` here empties the right-hand
side of the subtraction, and a binary operation with an empty operand
returns nothing at all.

Three numbers, one window, three different stories: 98 % fast, a mean of
230 milliseconds, a p99 of ten seconds. None of them is wrong. Each answers
a different question, and an incident review that quotes only one of them
is an incident review that ends in an argument. Write down, in your own
words, why they disagree. That sentence is the deliverable of this chapter.

The repository also ships `./scripts/scenario-latency-tail.sh`, which wraps
the same injection in a ten-minute countdown and resets the injector on the
way out. It leaves `timeout_ms` at its two-second default. Start it with
`--no-wait` so you get your shell back, then patch the timeout in:

```bash
./scripts/scenario-latency-tail.sh --no-wait
curl -s -XPOST http://localhost:8089/control \
  -H 'Content-Type: application/json' -d '{"timeout_ms":15000}'
```

!!! selfcheck "Self-check"
    ```bash
    make verify-ch10
    ```

    It runs for about two minutes twenty, because it injects the tail
    itself — including a `timeout_ms` high enough that the delay is not cut
    short — waits for the rate window to fill, and then restores your
    previous injector settings. It must end with `ch10 OK`. Among its
    assertions:

    ```text
    PASS a bucket boundary at le="0.3"
    PASS 13 finite buckets plus +Inf
    PASS p99 sits at exactly 10 under a 12 s tail
    PASS dropping le from the aggregation returns no samples
    PASS and Prometheus says why, in a warning annotation
    ```

    If the bucket count reads 12 instead of 14, `SNIP_BUCKETS` is set to
    `default` — that is Go's eleven plus `+Inf`. The p99 assertion waits
    for the rate window to fill by itself, so it takes about a minute. If
    it still fails with a value near your baseline, nothing is landing
    above the top bucket and the injection never reached `snip-api`: check
    `curl -s localhost:8089/control`. If it fails with
    a value close to 2, something has put `timeout_ms` back to its
    two-second default and the client is hanging up before the server
    replies.

Put the lab back when you are done:

```bash
curl -s -XPOST http://localhost:8089/chaos/reset
```

## Designing buckets backwards from a question

The p99 pinned at ten because the bucket list stops at ten. So the obvious
question is: why does it stop at ten, and who chose that?

For most services, nobody chose it. Every client library ships a default,
the default is fine, and the default is quietly wrong for you. Snip's
choice is switchable so you can see the difference:

```bash
SNIP_BUCKETS=default docker compose up -d \
  snip-api snip-api-b
```

Both containers, because the count that follows runs across the whole job
and would see whichever bucket list either of them still exports. Wait one
scrape, then count:

```promql
count(count by (le) (
  snip_http_request_duration_seconds_bucket{job="snip-api"}
))
```

The answer goes from 14 to 12: Go's `prometheus.DefBuckets` is eleven
finite bounds plus the implicit `+Inf`.

```text
0.005  0.01  0.025  0.05  0.1  0.25  0.5  1  2.5  5  10
```

Compare that to Snip's list. Go's defaults have no `0.3` and no `0.75`. On
those buckets, "what fraction was under 300 ms" is a question this service
literally cannot answer — the nearest boundaries are 0.25 and 0.5, and no
amount of PromQL recovers what was never counted. Put it back:

```bash
SNIP_BUCKETS=slo docker compose up -d \
  snip-api snip-api-b
```

That is the entire argument for designing buckets. The procedure is short.

1. **Write down the threshold somebody actually cares about.** For Snip it
   is 300 ms, and it came from a conversation, not from a library. Chapter
   20 writes it down in `docs/SLO.md`; for now it lives in the bucket list.
2. **Make it a boundary.** Not near one. Exactly one — `0.3`, not `0.25`.
3. **Put boundaries either side of it** so a quantile near the threshold
   has somewhere to interpolate. Snip has `0.25`, `0.3`, `0.5`.
4. **Choose a top finite bucket above the worst case you want to
   distinguish.** Not above the worst case that can happen — above the
   worst case you want a *number* for. Ten seconds is a fine top bucket for
   a redirect service, and it is precisely why the twelve-second injection
   pins the p99. That is a trade being made deliberately, not an accident.
5. **Count the cost before you commit.** Every boundary is one more series
   per label combination, times replicas. Thirteen boundaries across twelve
   combinations is 192 series per replica; twenty-six boundaries would be
   348. Chapter 7's arithmetic applies to every bucket you add.

Exercise 2 asks you to add a boundary above ten and re-run the tail. The
p99 changes and the service does not, which is the sentence you will one
day have to say to a colleague who thinks the tool is broken.

### Defaults differ between languages, and it will bite you

The lab runs two instrumented languages on purpose. `snip-api` and
`loadgen` are Go; `catalog` is Python. Their client libraries do not agree
on what a default histogram is.

| Library | Finite bounds | The `+Inf` bound |
|---|---|---|
| Go `client_golang` | 11 | implicit — never write it |
| Python `prometheus_client` | 14 | spelled out in `DEFAULT_BUCKETS` |
| Node `prom-client` | 11 | implicit |
| Java `client_java` | 11 | implicit |

You measured both halves of that table in Chapter 7:
`count(count by (le) (loadgen_request_duration_seconds_bucket))` returns 12
and the same query against `catalog_request_duration_seconds_bucket`
returns 15. Python's default adds `0.075`, `0.75` and `7.5` to Go's list.
That is a harmless difference right up until somebody builds one dashboard
across two services and hard-codes an `le` value that exists in only one of
them.

The `+Inf` bound is where the two libraries look different and behave the
same, which is its own kind of trap. Neither will let you ship a histogram
without a `+Inf` bucket. Go's `DefBuckets` does not mention it: you never
write one, and a trailing `+Inf` written anyway is silently discarded and
replaced by the library's own, so it looks like it worked and teaches you
nothing. Put one anywhere but last and the process panics at startup,
because the slice must be strictly increasing. Python's `DEFAULT_BUCKETS`
spells `INF` out as its last element, and a custom tuple that leaves it off
gets `INF` appended for you.

So what differs is the visible list, not the guarantee. Neither library can
produce the failure people warn about — a top bucket that is not `+Inf` —
and you have already seen the only way to reach that state: filter the
buckets yourself with an `le` selector and hand `histogram_quantile` a
ladder with the top rung sawn off.

## Someone else's service gets it wrong

`catalog` has been in the lab since Chapter 4. You do not own it, you
cannot deploy it, and it belongs to a colleague who instrumented it in a
hurry. Ask it the same question you have been asking Snip:

```promql
histogram_quantile(0.95,
  sum by (le) (rate(catalog_request_duration_seconds_bucket[5m])))
```

```text
{}   10
```

Ten seconds. Now p50:

```promql
histogram_quantile(0.5,
  sum by (le) (rate(catalog_request_duration_seconds_bucket[5m])))
```

```text
{}   10
```

Also ten. And p99 is ten, and p10 is ten. Every quantile of this service is
exactly its top finite bucket, which by now you can read as a sentence:
*essentially every observation is landing in `+Inf`.* Nothing is being
measured that this histogram can describe.

You know how to check that directly:

```promql
sum by (le) (rate(catalog_request_duration_seconds_bucket[5m]))
```

Every finite bucket rate is zero or very close to it. Only `+Inf` has
traffic. So either `catalog` really does take more than ten seconds per
request — in which case Snip's `GET /links/{code}` would be unusable, and
it plainly is not — or the observations are not in the unit the metric name
promises.

Look at the mean:

```promql
sum(rate(catalog_request_duration_seconds_sum[5m]))
/
sum(rate(catalog_request_duration_seconds_count[5m]))
```

Somewhere in the tens. The exact figure depends on how hard your laptop is
working, but it will be a two-digit number of "seconds" from a service that
answers Snip in a blink. Twenty-something *thousand* milliseconds is
absurd. Twenty-something milliseconds is a completely believable answer for
this service — reported wrong by a factor of exactly 1,000.

That is the whole bug. `catalog` measures in seconds, multiplies by a
thousand, and observes milliseconds into a metric named `_seconds` whose
buckets are `prometheus_client`'s second-tuned defaults. There is a
corroborating tell in the exposition, too: the `# HELP` line says only
`Catalog request duration.` and names no unit at all, because the author
was not thinking in units.

You can confirm the diagnosis without editing anybody's code:

```bash
CATALOG_FIX_UNITS=1 docker compose up -d catalog
```

Give it a minute of traffic, then re-run the p95. The finite buckets fill
in and the quantile becomes a small number with decimal places in it. Turn
it back off — the bug is somebody else's to fix, and exercise 6 asks you to
write the pull request rather than merge it.

The question that pull request has to answer, and the reason this bug is in
the book: **does the metric name have to change?** It does not. The name
was right the whole time; the code was wrong. This is the one situation in
the whole of metric naming where the correct fix breaks no existing query,
and it is worth saying explicitly in the description, because a reviewer's
first instinct will be that a unit change is a breaking change.

## The third thing called "a histogram"

You have used the word for two different things already: the client-side
data structure and the family of series on the wire. There is a third, and
it is the panel.

The reference dashboard's **Request latency distribution** panel is a
heatmap, and its query is one you already have:

```promql
sum by (le) (rate(snip_http_request_duration_seconds_bucket{
  job="snip-api"}[5m]))
```

That is the quantile panel's expression minus the `histogram_quantile`
wrapper. The intent for the panel:

- Format the query result as a heatmap rather than as time series.
- Turn **off** any option that asks the panel to calculate buckets from the
  data. The buckets already exist; Grafana is being handed them
  pre-aggregated and must not re-bucket them.
- Set the y-axis unit to seconds, so the row labels read as boundaries.

What you get is time along the x-axis, bucket boundary up the y-axis, and
color for how many requests landed in each cell. Snip's healthy heatmap
shows two or three bright bands low down — the cache hits, the cache
misses, the requests that call `catalog` — which is the many-humped shape
the mean was hiding, drawn rather than described.

Re-run the tail injection and watch the top of the picture. A single hot
row appears at the very top and nothing above it, because there is nothing
above it to draw. The heatmap and the pinned p99 are the same fact rendered
two ways, and the heatmap is the one that makes people believe it.

## Native histograms

Everything so far has been a **classic** histogram: one series per bucket,
boundaries you chose in advance, cardinality you pay for whether or not any
request lands there. There is a newer form that fixes all three problems at
once, and the reason it is at the end of this chapter rather than the start
is that switching it on takes three separate decisions in three different
places.

!!! note "Native histograms, exactly"
    Native histograms are stable since Prometheus 3.8.0; the
    `native-histograms` feature flag has been a complete no-op since 3.9;
    and there are still **three independent opt-ins** — the client
    library's `NativeHistogramBucketFactor`, the server's
    `scrape_native_histograms: true`, and remote write's
    `send_native_histograms: true`. The latter two default to true only
    from v4. The classic text exposition format cannot carry them at all.

Remote write is how one Prometheus forwards its samples to another store;
Chapter 26 covers it, and that third switch matters only if you run one.

A native histogram is a single series. Its buckets are exponential, laid
out automatically at a resolution you request rather than a list you write,
and they are materialized only where observations actually landed. There is
no `le` label, no `_bucket` family, and no top finite bucket to pin
against — which means the incident you just produced cannot happen in the
same way.

The lab's native-histogram source is `loadgen`, and only `loadgen`. Turn on
the first opt-in:

```bash
LOADGEN_NATIVE=1 docker compose up -d loadgen
```

That sets `NativeHistogramBucketFactor: 1.1` on
`loadgen_request_duration_seconds`, which asks the client library to keep
bucket widths growing by no more than about ten percent apiece. Now go and
look at it. Four lines, wrapped again to fit the page:

```bash
curl -s localhost:8089/metrics \
  | grep loadgen_request_duration_seconds \
  | head -4
```

```text
# HELP loadgen_request_duration_seconds Client-observed latency
    of load-generator requests, in seconds.
# TYPE loadgen_request_duration_seconds histogram
loadgen_request_duration_seconds_bucket{method="GET",
    route="/",le="0.005"} 214
loadgen_request_duration_seconds_bucket{method="GET",
    route="/",le="0.01"} 228
```

The client library sorts a family's children by label value, so the
home-page trickle comes first rather than the redirect that carries most of
the traffic. Nothing has changed. The same eleven classic buckets, the same `le` labels.
This is not a failure and it is not a caching problem — it is the last
sentence of the boxed paragraph. Native histograms travel over the
Prometheus protobuf exposition format, and the plain text format `curl`
receives cannot represent them. They are being computed inside the process
right now and there is no way to see them with a text client.

The second opt-in is the server's. Add one line to the `loadgen` job in
`prometheus/prometheus.yml`:

```yaml
  - job_name: loadgen
    # (ch10) Native histograms travel over protobuf, and Prometheus
    # does not ask for protobuf unless you tell it to.
    scrape_native_histograms: true
```

Then make Prometheus re-read its configuration with
`docker compose restart prometheus` — the named volume means the restart
costs you no stored data, and Chapter 12 is where the server learns to
re-read the file without restarting at all. Wait two scrapes, then query the
metric with no `_bucket` suffix and no `le` anywhere:

```promql
histogram_quantile(0.95,
  sum by (job) (rate(loadgen_request_duration_seconds[5m])))
```

A number comes back. `sum by (job)` with no `le` was an empty result and a
warning half an hour ago; here it is exactly right, because there is no
`le` to preserve. That single difference is the fastest way to tell which
kind of histogram a query in the wild was written against.

!!! pitfall "Turning on native scraping turns off your classic buckets"
    `loadgen` is now exposing both forms — classic buckets in text, native
    buckets in protobuf. When a target offers both and
    `scrape_native_histograms: true`, Prometheus ingests the native form
    and stores the classic form **only if you also set
    `always_scrape_classic_histograms: true`.** You did not, so
    `loadgen_request_duration_seconds_bucket` has stopped arriving, and any
    panel built on it — including Chapter 3's original p95 panel — goes
    blank within minutes.

    That is a defensible default and a nasty surprise. During a real
    migration you turn both on, run the two side by side until you trust
    the new numbers, then turn the classic one off. Remove the config line,
    run `docker compose restart prometheus`, and set `LOADGEN_NATIVE=0` to
    put the lab back the way the rest of the book expects it.

Five functions work on native histograms and on nothing else:
`histogram_count`, `histogram_sum`, `histogram_avg`, and — since Prometheus
3.5 — `histogram_stddev` and `histogram_stdvar`. They do what their names
say, on a single native-histogram sample, and `histogram_avg` in particular
collapses the `rate(_sum) / rate(_count)` division you wrote earlier into
one call:

```promql
histogram_avg(sum by (job) (rate(loadgen_request_duration_seconds[5m])))
```

They return nothing at all when handed a classic histogram's float samples
— which, given the shape of this chapter, should now feel like the right
behavior rather than a limitation.

!!! sidebar "Summaries, and why you will still meet them"
    Chapter 4 named the summary as the third metric type: `x_sum`,
    `x_count`, and a set of `x{quantile="0.5"}` series whose values were
    computed inside the process. It is worth one more paragraph here, in
    the chapter where you can finally say precisely what is wrong with it.

    A summary's quantiles cannot be aggregated. Not "should not" —
    *cannot*. There is no arithmetic over two instances' p95 values that
    produces the p95 across both, because the counts behind them were
    thrown away. That single sentence is why summaries are legacy, and why
    a dashboard built on somebody's summary quantiles cannot be fixed by
    rewriting the query. It has to be fixed by re-instrumenting. The
    `quantile` label is normalized on ingestion exactly as `le` is, so
    `quantile="0.50"` has the same "went blank on upgrade" story.

    Two honest points in their favor. A summary's `_sum` and `_count` are
    perfectly good and aggregate fine, so you can always compute a mean
    from one. And summaries need no bucket design: the p99 comes from a
    streaming estimator over a sliding window, with an error bound you
    configure, rather than from interpolating between boundaries you chose
    in advance. It is a different approximation, not an exact answer. If
    you own the code, use a histogram anyway.

## Common mistakes

**Dropping `le` in the aggregation.** By a wide margin the most common
histogram bug there is. `sum by (job)` instead of `sum by (job, le)`
returns an empty result and a warning annotation nobody reads. If a
histogram query returns nothing, check the grouping clause before you check
anything else.

**Selecting a bucket by an integer-looking `le`.** `le="1"`, `le="5"`,
`le="10"` and `le="30"` all match nothing on Prometheus 3, because the
stored values are `1.0`, `5.0`, `10.0` and `30.0` — even when `curl` shows
you the integer form on the wire. This is the single biggest cause of "my
dashboard went blank after the upgrade". List the values with
`count by (le) (...)` and paste them.

**Forgetting `rate()`.** `histogram_quantile(0.95, ..._bucket)` with no
`rate()` around the buckets is syntactically fine and semantically useless:
it gives you the quantile since process start, which is dominated by
history and moves like a glacier. Every histogram query you have seen here
has `rate()` inside it. There are no exceptions in normal use.

**Recording milliseconds into a metric named `_seconds`.** `catalog`'s bug,
and it is depressingly common in the wild: people arrive from a StatsD or
APM background where every timing is milliseconds, take the `_seconds`
suffix from a naming guide, and never reconcile the two. The symptom is
every quantile pinned at the top bucket and a mean off by a factor of
1,000. Base units, always — seconds and bytes — and let the `# HELP` string
name the unit so the next person can tell at a glance.

**Filtering a histogram down to the interesting buckets.** Selecting
`le=~"0.25|0.3|0.5"` to make a graph tidier removes `+Inf` and produces
`NaN` from every quantile. `histogram_quantile` needs the entire ladder.
Aggregate, do not filter.

!!! pitfall "Reading a pinned p99 as a latency"
    A p99 that sits at exactly your top finite bucket is not a measurement,
    it is a message: *the answer is somewhere above here.* Read it as
    "at least 10 s, resolution exhausted", never as "10 s". The tell is
    that the value is exactly a bucket boundary and does not wobble — real
    latency numbers have decimals and jitter. When you see it, the next
    question is "what is my top bucket", not "why did latency triple".

## Summary

A quantile is a property of a population, which makes it the wrong thing to
store and the wrong thing to average. What you store instead is counting: a
set of cumulative bucket counters plus a sum and a count, from which any
question about the distribution can be answered later, and which can be
added across replicas because counts add.

Ask that structure the fraction question first. "What proportion of
requests were faster than 300 ms" is a number a person can act on, it is
one division of two aggregated rates, and it is the exact artifact Chapters
20 and 21 turn into an objective and an alert. Ask it for the mean second,
remembering that a mean is a statement about totals and describes nobody
when the distribution has more than one hump. Ask it for quantiles last,
and read them knowing where the interpolation came from.

The durable takeaways:

- Buckets are **cumulative and upper-inclusive**. `le="0.5"` counts
  everything at or below 0.5 seconds, including every smaller bucket, and
  `le="+Inf"` always equals `_count`.
- One histogram costs **(finite boundaries + 3) series per label
  combination** — buckets, `+Inf`, `_sum`, `_count`. Multiply by label
  combinations, then by replicas, before you add a boundary or a label.
- Prometheus 3 normalizes `le` to a canonical float form on ingestion.
  `le="1"` is stored as `le="1.0"`, and a selector written the old way
  matches nothing and says nothing.
- The mandatory shape is `rate()` → aggregate → `histogram_quantile`, and
  **`le` must survive the grouping clause**. Dropping it gives an empty
  result plus a warning annotation, not an error.
- A quantile that lands in the `+Inf` bucket returns the second-highest
  bucket's upper bound. A p99 pinned at exactly your top finite boundary
  means "we cannot see up there", not "ten seconds".
- Choose bucket boundaries backwards from a threshold somebody cares about,
  and make that threshold an exact boundary. Library defaults differ
  between languages — Go, Node and Java ship 11 finite bounds with an
  implicit `+Inf`; Python ships 14 with `INF` spelled out. Both guarantee
  the `+Inf` bucket whatever you write.
- Native histograms are stable since 3.8.0 and still require three separate
  opt-ins. `curl` cannot show them to you, because the classic text format
  cannot carry them.

## Exercises

!!! exercise
    **1. Settling Chapter 7's prediction (warm-up).** Chapter 7 asked you to
    predict how many series this histogram would add per replica, for an
    eight-boundary design and a thirteen-boundary one. Measure the one that
    shipped:

    ```promql
    count by (instance) (
      {__name__=~"snip_http_request_duration_seconds_(bucket|count|sum)",
       job="snip-api"}
    )
    ```

    Divide by sixteen to get the number of `(route, method, code)`
    combinations your traffic has produced, and compare that against your
    worksheet — the total will be below the 192 ceiling. Name the
    combinations that have not happened yet, produce one of them on
    purpose, and watch the count rise by exactly sixteen.

    **2. One more bucket (core).** Add a boundary above 10 s to
    `sloBuckets` in `snip/metrics.go` — 15, say — rebuild both containers
    with `docker compose up -d --build snip-api snip-api-b`, and re-run
    the twelve-second injection. The p99 now reads a different number.
    Write the two sentences you would say to a colleague who concludes from
    this that latency got worse, and record what the change cost you in
    series per replica.

    **3. Two roads to the same fraction (core).** Compute "fraction under
    300 ms" both ways over the same window — the `le="0.3"` bucket ratio
    and `histogram_fraction(0, 0.3, ...)` — and confirm they agree to
    several decimal places. Then say which one you would put in a rule that
    Chapter 20 will depend on, and why. There is a defensible answer either
    way; the reasoning is the exercise.

    **4. Opposite stories (core).** Find a five-minute window in which the
    mean and the p95 disagree about `job="snip-api"`. The tail injection
    gives you one for free; a `db_delay_ms` injection gives you a different
    one. Put both expressions on one panel, capture it, and write one
    sentence naming which statistic you would quote in an incident channel
    and which in a capacity review.

    **5. Two empty results, two reasons (warm-up).** Query
    `catalog_request_duration_seconds_bucket{le="0.3"}` and then
    `snip_http_request_duration_seconds_bucket{job="snip-api", le="1"}`.
    Both come back empty, for completely different reasons. Name both, and
    say which one a `count by (le) (...)` would have prevented.

    **6. The pull request (stretch).** Write the pull request that fixes
    `catalog`'s unit bug: the diff against `catalog/metrics.py`, the
    description, and the answer to "does the metric name change?" Verify
    your proposed fix without editing the repository by running
    `CATALOG_FIX_UNITS=1 docker compose up -d catalog`, waiting a minute
    for traffic, and showing that `histogram_quantile(0.95, ...)` returns
    something other than 10. Include in the description what a reviewer
    should check on any dashboard that reads this metric today.
