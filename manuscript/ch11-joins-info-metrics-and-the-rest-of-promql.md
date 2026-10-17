# Chapter 11 — Joins, Info Metrics, and the Rest of PromQL

The error ratio doubled at 14:20. Somebody asks the only question that
matters: was that the deploy? You have the answer twice over and cannot get
it onto one screen. The request rate lives in `snip_http_requests_total`, and
the version that produced it lives in `snip_build_info`, a metric whose value
is always exactly `1` and whose entire content is three labels. Two facts, two
metrics, one graph, and no obvious way to introduce them to each other.

That is a join, and PromQL does have one. It looks nothing like SQL's, it is
built out of the label-set model you already know, and you will reach for it
constantly — version annotation,
percent-of-limit, "which node was this pod on", "which team owns this queue".
The same three tokens do all of it.

This chapter is the last of Part III, so it also sweeps up the corners of the
language no earlier chapter forced: the `_over_time` family, subqueries,
`offset` and `@`, operator precedence, and an honest account of which shiny
things you read about online actually work in a stock Prometheus 3.13.1. Read
the first half now. Skim the second half, and come back to it the first time a
query does something you cannot explain.

!!! objectives "Objectives"
    After this chapter you can:

    - Match two instant vectors one-to-one with `on()` and `ignoring()`, and
      many-to-one with `group_left` / `group_right`.
    - Read "found duplicate series for the match group" and name its usual
      cause.
    - Join an `*_info` metric so a graph legend carries the deployed version.
    - Use the `_over_time` family, and say how `max_over_time` differs from
      `rate`.
    - Write a subquery that actually returns points under Prometheus 3's
      left-open ranges.
    - Place `offset` and `@` correctly, and say why `sum(x) offset 5m` is a
      parse error.

## Where you are

This chapter assumes the lab as Chapter 10, "Latency: Histograms Without
Tears" left it: two `snip-api` containers (`snip-api` and `snip-api-b`),
`snip-worker`, `loadgen`, `catalog`, Prometheus on `http://localhost:9090` and
Grafana on `http://localhost:3000`.

```bash
cd lab
git checkout ch11
make up
```

Give it two minutes of traffic first, so the five-minute rate windows have
something in them. If you have looked ahead at a later tag, make that
`make reset && git checkout ch11 && make up` — all three commands, in that
order, because a Prometheus data directory written by a later chapter does
not always start under an earlier one.

Most of this chapter is typed into the Prometheus Query page. Several
expressions are supposed to fail, and the browser is a clumsy place to copy an
error out of, so keep one shell function ready:

```bash
promq() {
  curl -sS -G localhost:9090/api/v1/query \
    --data-urlencode "query=$1" | jq -r '.error // .data.result'
}
```

Parse errors always begin `invalid parameter "query":` — the HTTP API
complaining about its own input, and the interesting part follows it. Errors
raised while a query *runs*, like the duplicate-series error later in this
chapter, arrive with no prefix at all. Prometheus prints both on one line;
the blocks in this chapter wrap them to fit.

## Two vectors, one result

Every binary operator you met in Chapter 9, "Ratios, Arithmetic, and the
Series That Isn't There" — `*`, `/`, `-`, `>`, `and` — has a job you have not
needed yet. When both sides are instant vectors, the operator has to decide
*which element on the left goes with which element on the right*. That
decision is called **vector matching**, and it falls straight out of the fact
that a series is identified by its label set.

The default is **one-to-one matching**. Two elements match when they have
exactly the same labels and the same label values, after the metric name is
thrown away. Every element that finds no partner is dropped from the result,
silently. Not an error, not a zero — gone.

Try the naive thing first. Ask for the request rate per replica, and multiply
it by the build-info metric, which is always `1` and so cannot change the
number:

```promql
sum by (instance) (rate(snip_http_requests_total{job="snip-api"}[5m]))
  * snip_build_info{job="snip-api"}
```

The Query page reports:

```text
Empty query result
```

Nothing matched. Look at the two sides on their own and it is obvious why.
The left side, after `sum by (instance)`, carries one label:

```text
{instance="snip-api:8000"}      20.05
{instance="snip-api-b:8000"}    0
```

The right side carries six:

```text
{commit="a1b2c3d", env="lab", goversion="go1.25.14",
 instance="snip-api:8000", job="snip-api", version="1.4.0"}   1
{commit="a1b2c3d", env="lab", goversion="go1.25.14",
 instance="snip-api-b:8000", job="snip-api", version="1.4.0"} 1
```

`{instance="snip-api:8000"}` and that six-label set are not the same label
set, so they do not match, so there is no result. This is the number-one
reason a join returns nothing, and it will stay that way for the rest of your
career.

Three of those six labels were never exported by the application. `job` and
`instance` are attached by Prometheus when it scrapes, and `env="lab"` comes
from a `labels:` block in `lab/prometheus/prometheus.yml`. A join matches
against the whole set, not the part the application authored — which is why
reading both sides separately is always the first move.

!!! ladder "Ladder → rung 12"
    An empty result from an expression whose two halves each return data on
    their own is Appendix B, rung 12: a binary operation dropped everything.
    The series exist, but not with the labels you asked to match on. Run each
    side separately and compare the label sets before you change anything
    else.

### `on()` and `ignoring()` choose the matching labels

You do not want to match on the whole label set. You want to match on
`instance` and let the other five differ. Two modifiers say so, and they are
mirror images:

- `on (a, b)` — match using **only** these labels.
- `ignoring (a, b)` — match using **every label except** these.

Use whichever is easier to read six months from now. `on` is safer when the
right-hand side belongs to somebody else, because a new label appearing on it
cannot break your query; `ignoring` is safer when you own both sides and want
a new shared label matched automatically.

```promql
sum by (instance) (rate(snip_http_requests_total{job="snip-api"}[5m]))
  * on (instance) snip_build_info{job="snip-api"}
```

Now there is a result. It is also useless:

```text
{instance="snip-api-b:8000"}    0
{instance="snip-api:8000"}      20.05
```

The numbers are right and the version is gone. This is the rule that surprises
everyone: **in one-to-one matching, the result carries only the matching
labels.** Everything not named in `on()` — or everything named in `ignoring()`
— is discarded from both sides, along with the metric name. You matched on
`instance`, so `instance` is all you get.

Which is fair. One-to-one matching is symmetric: it cannot know that
`version` mattered to you and `commit` did not. You have to say.

## `group_left` and `group_right`

The modifier that says so is a **group modifier**, and it does two jobs at
once. It declares that the match is **many-to-one** rather than one-to-one,
and it names the extra labels to copy across.

The word `left` or `right` points at the side with **more** series — the
"many" side. It is not about which side you want labels from; that trips
everyone up at least once. In `A * on (x) group_left(l) B`, `A` is the many
side, `B` is the one side, and `l` is copied from `B` onto every matching
element of `A`.

Four rules make it predictable:

- Every element on the many side must have **at most one** partner on the one
  side. Many-to-many is forbidden and is an error.
- The many side keeps **all** of its labels, including the ones not used for
  matching.
- The labels listed inside `group_left(...)` are copied from the one side. An
  empty list copies nothing and only switches the matching mode.
- A label may appear in the `on()` list or in the `group_left()` list, never
  in both. Writing it twice is a parse error, and the message says so.

The mirror image is `group_right`, for when the many side is on the right.
Put the rate on the right and break it out per route, so that side genuinely
does have more series:

```promql
max by (job, version) (snip_build_info{job="snip-api"})
  * on (job) group_right(version)
    sum by (job, route) (
      rate(snip_http_requests_total{job="snip-api"}[5m])
    )
```

Six elements come back, one per route, each labeled `{job, route, version}`:
the many side kept all its own labels, and `version` was copied onto every
one of them from the single element on the left. Which modifier you need is
decided by which side has more series, not by which side you want labels
from.

Group modifiers work only with arithmetic and comparison operators. You cannot
write `and on (x) group_left(y)`; the set operators `and`, `or` and `unless`
match on labels but never copy them.

Here is the working version join:

```promql
sum by (instance) (rate(snip_http_requests_total{job="snip-api"}[5m]))
  * on (instance) group_left(version) snip_build_info{job="snip-api"}
```

```text
{instance="snip-api-b:8000", version="1.4.0"}    0
{instance="snip-api:8000", version="1.4.0"}      20.05
```

The value is untouched — multiplying by `1` is the whole point — and `version`
has arrived. One more aggregation gives you a per-version traffic line:

```promql
sum by (version) (
  sum by (instance) (rate(snip_http_requests_total{job="snip-api"}[5m]))
  * on (instance) group_left(version) snip_build_info{job="snip-api"}
)
```

```text
{version="1.4.0"}    20.05
```

### The example from the documentation, in the lab

The Prometheus documentation teaches many-to-one with a data set of its own:
two series computed on a schedule by Prometheus itself and stored under a new
name, a mechanism Chapter 15, "Recording Rules" covers. The colons in
`method_code:http_errors:rate5m` (labeled `method` and `code`) and
`method:http_requests:rate5m` (labeled `method` only) are that naming
convention. The canonical line is worth recognizing, because half the blog
posts on the internet quote it:

```promql
method_code:http_errors:rate5m
  / ignoring(code) group_left
    method:http_requests:rate5m
```

Those two series do not exist in this lab — they are the documentation's own
example data, and typing that expression here returns nothing at all. The
shape does exist here, though, and it answers a real question: what fraction
of each route's traffic came back with each status code?

```promql
sum by (route, code) (
  rate(snip_http_requests_total{job="snip-api"}[5m])
)
  / ignoring(code) group_left
    sum by (route) (rate(snip_http_requests_total{job="snip-api"}[5m]))
```

Left side: up to twelve elements, labeled `route` and `code`. Right side: up
to six, labeled `route`. `ignoring(code)` reduces both to `{route}` for
matching purposes, `group_left` says the left side is the many side, and the
empty label list copies nothing — the left side already has every label you
want. Twelve rows come back on the default traffic mix; these are the seven
that are not zero:

```text
{code="200", route="/"}                1
{code="200", route="/healthz"}         1
{code="200", route="/links/{code}"}    1
{code="201", route="/links"}           0.98
{code="400", route="/links"}           0.02
{code="302", route="/l/{code}"}        1
{code="404", route="other"}            1
```

Every group of rows sharing a `route` sums to `1`, which is what tells you the
denominator really was that route's own total and not the service total. The
`/links` split is the generator's doing — `loadgen` sends a deliberately
malformed body on 2% of its writes — and your last digit will differ. The five
rows omitted here are status codes that have not occurred recently; they read
`0` rather than vanishing, because Chapter 9's pre-initialization created
those series at zero.

## Reading "found duplicate series for the match group"

Now break it deliberately. Aggregate the left side by `job` instead of
`instance`, and match on `job`:

```promql
sum by (job) (rate(snip_http_requests_total{job="snip-api"}[5m]))
  * on (job) snip_build_info{job="snip-api"}
```

```text
found duplicate series for the match group {job="snip-api"} on the
right hand-side of the operation: [{__name__="snip_build_info",
commit="a1b2c3d", env="lab", goversion="go1.25.14",
instance="snip-api-b:8000", job="snip-api", version="1.4.0"},
{__name__="snip_build_info", commit="a1b2c3d", env="lab",
goversion="go1.25.14", instance="snip-api:8000", job="snip-api",
version="1.4.0"}];many-to-many matching not allowed: matching labels
must be unique on one side
```

It is a wall of text, and entirely readable once you know the four things it
tells you.

First, **the match group**: `{job="snip-api"}`. That is the label set the two
sides were being matched on, and it is the group that has too many members.
Second, **which side**: the right. Third, **the offending series**, printed in
full, so you can see what distinguishes them — here, `instance`. Fourth, the
verdict: many-to-many is not allowed.

The cause is almost never mysterious: you matched on a label set that is not
unique on one side. Two `snip-api` containers each export their own
`snip_build_info`, and both carry `job="snip-api"`.

There are two honest fixes, and which you want depends on what you meant. If
the label distinguishing the duplicates matters to you, put it in the match:
`on (job, instance)` makes every group a single series again. If it does not
— and `instance` does not, when the question is "which version is this job
running" — collapse the one side with an aggregation instead.

!!! pitfall "group_left is not the fix for this"
    The reflex is to add `group_left` and hope. It does not help here:
    `group_left` declares the *left* side to be the many side, and the
    duplicates are on the right. You get the same error with "left hand-side"
    swapped in, or a genuinely wrong number. Read the message: it names the
    side. Then either add the distinguishing label to `on()`, or collapse the
    side the message pointed at.

Collapsing the right side is one aggregation:

```promql
sum by (job) (rate(snip_http_requests_total{job="snip-api"}[5m]))
  * on (job) group_left(version)
    max by (job, version) (snip_build_info{job="snip-api"})
```

`max by (job, version)` reduces the two build-info series to one per
`(job, version)` pair — the value is `1` either way, so `max` here means
"one of these". Now the match group `{job="snip-api"}` has exactly one
member on the right, `group_left` is honest about which side is many, and the
version comes across.

This form is worth remembering, because it is what a genuinely cross-job join
looks like. Both `snip-api` and `snip-worker` run the same image, and both
export `snip_build_info`, so one query can carry one version story across
both:

```promql
sum by (job) (
  rate(process_cpu_seconds_total{job=~"snip-api|snip-worker"}[5m])
)
  * on (job) group_left(version)
    max by (job, version) (
      snip_build_info{job=~"snip-api|snip-worker"}
    )
```

```text
{job="snip-api",    version="1.4.0"}    0.0246
{job="snip-worker", version="1.4.0"}    0.0036
```

Your two numbers will differ; CPU seconds depend on the host.
`process_cpu_seconds_total` is used because it is a series both jobs really
have; `snip-worker` has no HTTP surface and therefore no
`snip_http_requests_total`. That constraint is the ordinary shape of the
problem: the metric you want to annotate and the metric carrying the
annotation rarely share a label set, and choosing the matching labels is most
of the work.

## Info metrics: a value of one, and everything in the labels

Chapter 4, "Metric Types Are Contracts" introduced the `*_info` pattern in
passing. Now it earns its keep. `lab/snip/metrics.go` registers it in eight
lines:

```go
func newBuildInfo(reg prometheus.Registerer, c *config) {
	promauto.With(reg).NewGaugeVec(prometheus.GaugeOpts{
		Name: "snip_build_info",
		Help: "Build information for the running Snip process. " +
			"Always 1; read the labels.",
	}, []string{"version", "commit", "goversion"}).
		WithLabelValues(c.Version, c.Commit, runtime.Version()).Set(1)
}
```

On the wire that is one sample:

```text
# TYPE snip_build_info gauge
snip_build_info{commit="a1b2c3d",goversion="go1.25.14",version="1.4.0"} 1
```

The `goversion` value is whatever `runtime.Version()` reported in the image
you built, and the Dockerfile builds `FROM golang:1.25-alpine`, so the patch
digit moves when that base image does. Yours may not read `go1.25.14`. The
other two come from `SNIP_VERSION` and `SNIP_COMMIT` in `lab/.env`.

The value carries no information at all. Every fact is a label — build
version, commit, node name, owning team — and an **info metric** is useless
on its own, because it is designed to be joined onto a metric that does
carry a number, so that a graph can be labeled with facts that are not
measurements. That is why the HELP string says, out loud, *Always 1; read
the labels.* You will meet the pattern everywhere once you recognize it:
`node_uname_info`, `kube_pod_info`, `target_info`, `alertmanager_build_info`.
Your own services should ship one.

### Lab: put the version on the graph

Open the Snip RED dashboard at `http://localhost:3000/d/snip-red`. Add a row
titled **Version, client view and process** at the bottom — the row is named
for what it grows into, and Chapter 13 adds the client-side and process panels
beside this one — and in it a time series panel titled **Request rate by build
version**. The query, exactly as
`lab/dashboards/snip-red.json` carries it at this tag:

```promql
sum by (version) (
  sum by (instance) (
    rate(snip_http_requests_total{job=~"$job"}[$__rate_interval])
  )
  * on (instance) group_left(version) snip_build_info{job=~"$job"}
)
```

Set the legend to `{{version}}` and the unit to requests per second. Give the
panel a description saying what an info metric is; a panel that does something
clever without saying so is a panel somebody will delete.

!!! iou "IOU — chapter 13"
    `$job` and `$__rate_interval` are Grafana, not PromQL. You met
    `$__rate_interval` in Chapter 3, "Your First Dashboard: The Early Win":
    it is a duration Grafana computes from the panel's width and the data
    source's settings. `$job` is new. It is a *query variable* — a dropdown
    whose values come from a query against Prometheus — and it arrives with
    this chapter's dashboard changes, together with a second one, `$route`.
    `$__interval` joins them later in this chapter. Chapter 13, "Dashboard
    Mechanics: Intervals, Panels and Variables" builds the variables properly
    and explains all four. To run this query on the Prometheus Query page
    today, substitute `job="snip-api"` and `[5m]`.

You should see one line, labeled `1.4.0`, at about 20 requests per second.

Now redeploy one container with a new version. The version string comes from
`SNIP_VERSION`, which `lab/compose.yaml` reads for `snip-api`, `snip-api-b`
and `snip-worker` alike, so edit `lab/.env`:

```ini
SNIP_VERSION=1.5.0
```

and then recreate **one** of the two containers, not both:

```bash
docker compose up -d snip-api-b
```

Within one scrape interval a second line appears in the legend, labeled
`1.5.0`, sitting flat on zero. That zero is not a bug. `loadgen` is configured
with `LOADGEN_TARGET_URL: http://snip-api:8000`, so it dials one container by
name; nothing yet spreads traffic between the two, which is a job Chapter 12,
"`prometheus.yml` in Full: Service Discovery and Relabeling" gives to a
reverse proxy. `snip-api-b` is scraped, is healthy, and serves nothing. Its
counters read zero because Chapter 9's pre-initialization created them at
zero, and the join copies `version` onto a zero as happily as onto a busy
number.

Now roll the other one:

```bash
docker compose up -d snip-api
```

Watch the legend for the next five minutes. The `1.4.0` line ends at the
moment of the roll — an info series is replaced, not added to, so the old
version is gone from the very next scrape — while `1.5.0` starts near zero and
climbs to about 20 as the rate window refills behind the restart, which is the
memory Chapter 6, "`rate()`, `increase()`, and Why Nothing Is a Whole Number"
warned you rates have. Both lines are drawn on the same canvas, but only one
of them carries a value at any instant. A real rolling deploy behind a load
balancer *would* show both carrying traffic at once. Being able to see the
handover at all is most of why the join is worth writing.

Put `lab/.env` back to `SNIP_VERSION=1.4.0` and recreate both containers when
you are done.

!!! trap "Delete the group modifier and the version disappears"
    Edit the panel query to remove `group_left(version)`, leaving
    `* on (instance) snip_build_info{job=~"$job"}`. The panel does not error
    and does not blank. The legend goes from named lines to one line labeled
    `{}` carrying the whole service's rate, because `sum by (version)` is now
    grouping by a label no element has. On the Query page it reads
    `{} 20.05`. A join that silently stops carrying its payload looks healthy
    from across the room.

!!! sidebar "info(), the shortcut that is not ready yet"
    Prometheus 3.9.0 added a function that collapses the whole join into one
    call. It finds the matching info series, copies their labels across, and
    needs no `on`, no `group_left` and no `max by`. Two limitations shape how
    you have to write it: it considers only info series named `target_info`
    unless a `__name__` matcher says otherwise, and it assumes the
    identifying labels are `job` and `instance`. This lab exports no
    `target_info`, so the form that would do this chapter's join has to name
    the metric:

    ```promql
    info(
      rate(snip_http_requests_total[5m]),
      {__name__="snip_build_info", version=~".+"}
    )
    ```

    It is experimental, it is off by default, and this lab does not enable
    it, so that expression gets you

    ```text
    invalid parameter "query": 1:1: parse error: function "info" is not
    enabled
    ```

    Learn `group_left`. It is the portable answer and it will still be
    there.

## The `_over_time` family

`rate()` answers "how fast is this counter climbing". A different question —
"what was the largest value this took during the last hour" — needs a
different tool. The `_over_time` functions all take a range vector and reduce
it to one number per series.

| Function | Reduces the range to | Note |
|---|---|---|
| `avg_over_time` | the unweighted mean | not time-weighted |
| `max_over_time` | the largest sample | the spike-saver |
| `min_over_time` | the smallest sample | |
| `sum_over_time` | the sum of samples | rarely what you want |
| `count_over_time` | how many samples | chapter 6's verifier |
| `last_over_time` | the newest sample | survives long gaps |
| `present_over_time` | `1` if any sample exists | existence check |
| `quantile_over_time` | the φ quantile of samples | takes φ first |
| `stddev_over_time` | the standard deviation | `stdvar_over_time` too |
| `mad_over_time` | the median absolute deviation | experimental |

Two need a caveat. `avg_over_time` weights every sample equally regardless of
spacing, so a run of failed scrapes skews it toward whatever was happening
when scrapes succeeded. And `mad_over_time` is behind a feature flag;
Appendix C catalogues it with the rest of the flagged functions.

The difference between `max_over_time` and `rate` is not subtle once stated.
`rate` produces a speed: a number that was never in the data, computed from
the ends of a window. `max_over_time` produces one of the samples in the
window, unchanged. They are not alternatives; they compose.

### Two panels over one gauge

The second half of this chapter's lab step needs a spike to look at, and a
gauge that spends most of its life at zero is the easiest kind to make.

`loadgen_inflight_requests` counts requests the generator is waiting
on, one series per route, so delaying every response makes it climb —
40 requests per second held open for 1.2 seconds each is roughly 48 in flight,
most of them on the hot `/l/{code}` route:

```bash
curl -sS -X POST localhost:8089/control \
  -H 'Content-Type: application/json' \
  -d '{"rps":40,"extra_latency_ms":1200}'
```

Leave it for ninety seconds, then put it back:

```bash
curl -sS -X POST localhost:8089/control \
  -H 'Content-Type: application/json' \
  -d '{"rps":20,"extra_latency_ms":0}'
```

While it runs, `loadgen_inflight_requests{route="/l/{code}"}` reads about 40
and the other five routes share another handful. At rest all six read `0`.

On the dashboard, add a row titled **Spike recovery and injector state**. Two
panels go in it side by side. The first, **In-flight requests, as sampled**:

```promql
sum by (route) (loadgen_inflight_requests{route=~"$route"})
```

The second, **In-flight requests, max per step**:

```promql
max by (route) (
  max_over_time(loadgen_inflight_requests{route=~"$route"}[$__interval])
)
```

At a one-hour range the two panels are near enough identical. Widen the time
picker to six hours, then to 24 hours, and watch the left panel lose the spike
while the right one keeps it, shrinking to a single tall pixel but never
disappearing. The window in the second query is `[$__interval]`, deliberately
not `[$__rate_interval]`: you want the window to equal one rendering step, so
each drawn point is the maximum of everything that step covers, with no
overlap and no gap. That trick works on any gauge. Chapter 14, "Dashboards
That Tell the Truth" makes a chapter out of what else this graph is hiding.

Both queries carry Grafana syntax again. To run them on the Prometheus Query
page, drop the `{route=~"$route"}` matcher and put a fixed window such as
`[1m]` where `[$__interval]` is.

Three stat panels complete the row. They are not measurements — they are the
dials you just turned, read back: **Injector: target rate**
(`loadgen_target_rps`), **Injector: error ratio**
(`loadgen_injected_error_ratio`) and **Injector: extra latency**
(`loadgen_injected_latency_seconds`). `lab/loadgen/control.go` mirrors every
POST to `/control` into them, so a spike can be read against what you asked
for. You posted `extra_latency_ms: 1200`; the panel reads `1.2 s`, because
base units win.

## Subqueries

`max_over_time` needs a range vector, and a range vector comes from a
selector. So what do you do when the thing you want the maximum of is not a
series but an *expression* — the peak of `sum(rate(...))`, say, which exists
nowhere in storage?

You run the expression repeatedly and collect the answers. That is a
**subquery**, the `[1m:15s]` Chapter 8 asked you to copy —
*IOU from chapter 8, settled*:

```promql
max_over_time(
  (sum(rate(snip_http_requests_total{job="snip-api"}[1m])))[10m:1m]
)
```

The syntax is `<instant query>[<range>:<resolution>]`. The colon is
**mandatory**, even when you leave the resolution off — `[10m:]` is legal and
means "use the server's evaluation interval". In this lab that is one minute:
`lab/prometheus/prometheus.yml` does not set `evaluation_interval` at all, so
Prometheus's own default applies, and you can read it back from the server
with `curl -s localhost:9090/api/v1/status/config`. `[10m:1m]` means "evaluate
the inner expression once a minute across the last ten minutes, and hand me
the results as a range vector".

Note the parentheses around the inner expression. They are not always
required, but they are always readable, and without them `[10m:1m]` binds in
ways that will surprise you.

### The step grid belongs to the epoch, not to your query

Subquery steps are aligned to the Unix epoch. With a resolution of `1m`, the
inner expression is evaluated at timestamps that are exact multiples of 60
seconds — not at "now", "now minus one minute", and so on.

You can watch this directly. `time()` returns the instant an expression is
being evaluated at, and `vector()` turns a scalar into something a subquery
can chew on:

```promql
max_over_time( vector(time())[2m:1m] )
```

Run it. Wait three seconds. Run it again. The number does not change, and it
ends in a multiple of 60 — the run behind this chapter returned `1789810260`
twice. Run plain `time()` in between and it changes every time. The subquery's
newest point can therefore be up to one resolution old — the price of results
that are stable and cacheable rather than jittering with the millisecond you
pressed the button.

### The `[1m:1m]` trap

Prometheus 3 made range selectors left-open: `foo[1m]` covers the half-open
interval `(t-1m, t]`. A half-open window of sixty seconds contains exactly one
multiple of sixty. So a `[1m:1m]` subquery produces **one point**.

Prove it with the sample counter from Chapter 6:

```promql
count_over_time(
  (sum(rate(snip_http_requests_total{job="snip-api"}[1m])))[1m:1m]
)
```

```text
{}    1
```

```promql
count_over_time(
  (sum(rate(snip_http_requests_total{job="snip-api"}[1m])))[2m:1m]
)
```

```text
{}    2
```

One point is worse than an error, because nothing complains. Wrap it in
`max_over_time` and you get a number — the current value, dressed up as a
maximum. Wrap it in anything needing two samples and you get nothing at all.
`deriv`, from Chapter 6, is the shortest demonstration:

```promql
deriv( (max(snip_links_active{job="snip-api"}))[1m:1m] )
```

```text
Empty query result
```

```promql
deriv( (max(snip_links_active{job="snip-api"}))[10m:1m] )
```

```text
{}    -0.243
```

Your number will differ, and it may well be negative. It is the slope of the
*active* link count, and on a lab that has been up for more than ten minutes
that count is at steady state: links expire as fast as `loadgen` creates
them, so the slope hovers around zero and wanders either side of it. What
matters is that one form returns a number and the other returns nothing, from
the same data, with no warning in between.

The rule to carry away: **make the subquery range at least twice the
resolution**, for exactly the same reason Chapter 6 told you to make a rate
window at least four times the scrape interval. `[10m:1m]`, not `[1m:1m]`.

!!! warning "Subqueries are the most expensive thing in this chapter"
    Every step forces a full evaluation of the inner expression. A `[24h:1m]`
    subquery over an expression that already reads thousands of samples will
    run 1,440 of those evaluations, and it can time out. Use them for ad-hoc
    questions and for panels you look at rarely. Chapter 15, "Recording Rules"
    shows how to compute the inner expression once, on a schedule, under a
    name — at which point `max_over_time(that_name[24h])` needs no subquery at
    all.

## Moving the clock: `offset` and `@`

Two modifiers change *when* a selector reads from. Both attach to the
**selector**, and this is the single most common parse error in PromQL:

```promql
sum(max(snip_links_active{job="snip-api"})) offset 5m
```

```text
invalid parameter "query": 1:1: parse error: offset modifier must be
preceded by an instant vector selector or range vector selector or a
subquery
```

`sum(...)` is an aggregation, not a selector, so there is nothing for `offset`
to attach to. Move it inside, onto the thing it can actually attach to:

```promql
max(snip_links_active{job="snip-api"} offset 5m)
```

Inside a range selector it goes after the bracket:
`rate(snip_http_requests_total[5m] offset 1h)`. The same placement rule
governs `@`, and the same error message appears with `@ modifier` in place of
`offset modifier`.

The everyday use of `offset` is comparing now with then:

```promql
sum(rate(snip_http_requests_total{job="snip-api"}[5m]))
/
sum(rate(snip_http_requests_total{job="snip-api"}[5m] offset 5m))
```

A value near 1 means traffic is what it was five minutes ago. The idiomatic
version uses `offset 1h` or `offset 1w`, and on a lab that came up twenty
minutes ago both return nothing at all: the denominator has no data, so
nothing matches, so the result is empty. That is the silent-drop rule from the
start of this chapter, arriving from a direction you did not expect. Negative
offsets look *forward* — `offset -1h`.

`@` is the absolute form: it pins the selector to a Unix timestamp regardless
of when the query is evaluated. `snip_links_active @ <timestamp>` reads that
one instant every time you run it, for as long as Prometheus keeps the data —
mint yourself a timestamp by running `time()` and subtracting 600, because a
literal copied out of a book points at an instant your lab never had. Two
special values make it useful on a graph rather than in a one-off:
`@ start()` and `@ end()` resolve to the start and end of the range query
being drawn. In an instant query both resolve to the evaluation time.

The canonical use is making `topk` stop re-ranking. Chapter 8, "Aggregation:
`sum`, `without`, and the Rate-Then-Aggregate Law" showed that `topk` picks
its winners independently at every step of a range query, so a graph of "top
three routes" can show six different routes across its width. Pinning the
ranking to the end of the range fixes it:

```promql
topk(3, sum by (route) (
  rate(snip_http_requests_total{job="snip-api"}[5m] @ end())
))
```

Now the same three routes are ranked once, at the right-hand edge, and drawn
across the whole graph — `/l/{code}`, `/links/{code}` and `/healthz`, in that
order, on the default mix.

!!! note "Two different things called start() and end()"
    `@ start()` and `@ end()` are stable, unflagged special values of the `@`
    modifier, and have been since Prometheus 3.0. There are *also* scalar
    functions called `start()`, `end()`, `range()` and `step()`, added in
    3.12.0, which are experimental and behind
    `--enable-feature=promql-experimental-functions`. Same names, different
    things. If a query works in your Grafana panel but not in a colleague's
    blog post, this is often why.

`offset` and `@` combine in either order with identical results, so
`[5m] @ <timestamp> offset 5m` and `[5m] offset 5m @ <timestamp>` mean the same
thing.

## Precedence, and sorting that only sometimes sorts

PromQL's operator precedence, highest first:

```text
1.  ^                        (right-associative)
2.  *  /  %  atan2
3.  +  -
4.  ==  !=  <=  <  >=  >
5.  and  unless
6.  or
```

Everything except `^` associates left to right. Four consequences are worth
knowing before they bite:

- `a / b * 100` is `(a / b) * 100`, which is what you meant when converting a
  ratio to a percentage.
- `2 ^ 3 ^ 2` is `2 ^ (3 ^ 2)` = 512, not 64.
- `x > 1 and y > 2` parses as `(x > 1) and (y > 2)` — comparison binds tighter
  than `and`, which works out in your favor.
- `a or b and c` is `a or (b and c)`. When you mix set operators,
  parenthesize.

Sorting is the other corner that surprises people. `sort()` and `sort_desc()`
order the result by value:

```promql
sort_desc(
  sum by (route) (rate(snip_http_requests_total{job="snip-api"}[5m]))
)
```

On the Query page's Table view the busiest route now comes first. Switch to
the Graph tab and the sort does nothing at all — **range query results always
come back in a fixed order**, so sorting them is meaningless. Since Prometheus
3.12.0 the server tells you so, attaching a warning to the range query's
response:

```text
PromQL warning: sort is ineffective for range queries since results
are always ordered by labels (1:1)
```

A Grafana time series panel is a range query, so `sort_desc` in one is
decoration and nothing else; sort the legend in the panel options instead.

`sort_by_label()` and `sort_by_label_desc()` sort by label value rather than
by number, using natural ordering so `snip-api-10` comes after `snip-api-9`
rather than before it. They are experimental, need
`--enable-feature=promql-experimental-functions`, and are catalogued in
Appendix C rather than taught here.

## What the feature flags actually buy you

A lot of what you read about PromQL online is real, documented, and not
switched on in the server you are running. Prometheus 3.13.1 ships these
query-related flags off by default, and `lab/compose.yaml` passes Prometheus
exactly two arguments, neither of them `--enable-feature`. The table is here
so you can read a blog post without being misled, not so you can turn them
on.

| Flag | What it unlocks | The catch |
|---|---|---|
| `promql-experimental-functions` | a dozen functions | `info()` needs `target_info` |
| `promql-duration-expr` | arithmetic in `[ ]` and `offset` | no `@`; parenthesize |
| `promql-extended-range-selectors` | `anchored`, `smoothed` | banned in subqueries |
| `promql-binop-fill-modifiers` | `fill`, `fill_left`, `fill_right` | goes between the operands |
| `use-start-timestamps` | start-timestamp `rate` | not with `anchored` |

The first row is the biggest bag: `info()`, `mad_over_time()`,
`first_over_time()`, the `ts_of_*` family, `sort_by_label*()`,
`double_exponential_smoothing()`, and `start()`/`end()`/`range()`/`step()` as
scalar functions. The second lets you write `rate(x[5m * 2])`. The third
replaces `rate`'s extrapolation with exact range edges, so
`increase(...[5m] anchored)` finally returns whole numbers. The fourth gives
unmatched elements a value instead of dropping them — the eventual fix for
the silent drop this chapter opened with. The fifth stops `rate` losing the
first increase after a restart.

Four of the five refuse you in words you can act on. Try them and read the
replies: `function "info" is not enabled`, `experimental duration expression
is not enabled`, and `anchored modifier is experimental and not enabled`. The
fill modifier is the one whose placement people get wrong. It is not a
function call; it is a modifier on the operator, written between the two
operands:

```promql
sum(rate(snip_http_requests_total{job="snip-api",
  code=~"5.."}[5m]))
/ fill(0)
sum(rate(snip_http_requests_total{job="snip-api"}[5m]))
```

```text
invalid parameter "query": 1:1: parse error: binop fill modifiers are
experimental and not enabled
```

None of those four says "unknown", because Prometheus knows the feature
perfectly well and has been told not to offer it. The fifth changes how
`rate` behaves and has no syntax to refuse, so it fails silently or not at
all.

Two habits follow. When a documentation page says something works, check
whether it is the version-pinned page for your release or the one tracking
unreleased work — different URLs, and they disagree. `promql-duration-expr`
is a live example: flagged in 3.13.1, already permanently on in the
unreleased branch. And when a feature is flagged, write the portable form.
Every technique this chapter taught in the main line works in a stock 3.13.1
with no flags at all.

!!! selfcheck "Self-check"
    Run `make verify-ch11`. It takes about two minutes, because it injects a
    45-second burst at 200 requests per second and then waits a minute for the
    rate to fall back. It ends with:

    ```text
    ch11: 6 passed, 0 failed, 1 skipped
    ch11 OK
    ```

    The six are: the join returns series; the result carries a `version`
    label; matching `on (job)` against two replicas is an error;
    `snip_build_info` is exported by both snip jobs; the cross-job join
    carries `version` onto both; and `max_over_time` keeps a spike the plain
    expression lost. The run behind this chapter printed
    `plain now: 20.22   max_over_time over 10 m: 176.39` before that last
    one. The single `SKIP` is the 24-hour comparison, which a lab that came
    up this afternoon cannot make; it never fails the script, and it prints
    the command that does show the thing. If anything reads `FAIL`, Appendix
    B starts at rung 1.

## Common mistakes

**Matching on a label set that is not unique.** The
`found duplicate series for the match group` error. Work out which side is
supposed to have one series per match group, run
it on its own, and count. If the count exceeds the number of groups, either
add the distinguishing label to `on()` or aggregate that side down —
`max by (...)` for an info metric, `sum by (...)` for a number.

**Reaching for `group_left` when the empty result was the problem.** An empty
result means nothing matched; a duplicate error means too much matched. Empty
results want `on()` / `ignoring()` or a corrected label; duplicates want the
offending side collapsed or the match widened.

**Forgetting that one-to-one throws labels away.** `a * on (instance) b`
returns elements labeled `{instance="..."}` and nothing else. If the point was
to carry a label, you need a group modifier even when the match really is
one-to-one.

!!! pitfall "The join that silently stops joining"
    A version join is a multiplication by `1`. If the info series disappears —
    a container restarts and comes back before its first scrape, a relabeling
    change drops it, somebody renames the metric — the multiplication finds no
    partner and the *entire graph goes blank*. Not wrong: blank. A panel whose
    data depends on an unrelated metric being present is a panel that can be
    switched off by accident, and you should say so in the panel description.

**Writing `sum(x) offset 5m`.** The modifier attaches to the selector, never
to a function call or an aggregation. Same for `@`. The parse error names the
rule, so read it rather than guessing.

**Subquery ranges that are not at least twice the resolution.** `[1m:1m]` is
one point. It does not error, it does not blank, and `max_over_time` over it
returns today's value wearing a maximum's clothes.

## Summary

PromQL's join is one idea applied twice. Binary operators between two instant
vectors have to pair up elements, and by default they pair elements whose
label sets are identical. `on()` and `ignoring()` change which labels count. A
group modifier — `group_left` or `group_right`, pointing at the side with more
series — switches the match from one-to-one to many-to-one and names the
labels to copy from the smaller side. Everything else in the chapter is a
corner of the language you now know exists.

Durable takeaways:

- Two instant vectors match one-to-one on their full label set with the metric
  name removed; unmatched elements vanish without a word. `on (l)` matches
  using only `l`, `ignoring (l)` using everything but `l`, and the result
  carries only the matching labels.
- `group_left(x)` says the left side is the many side and copies `x` from the
  right. The many side keeps all its labels. Group modifiers do not work with
  `and`, `or` or `unless`, and a label may not be in both `on()` and the group
  list.
- "found duplicate series for the match group" names the group, the side and
  the offending series. Widen the match or collapse that side; do not reach
  for a group modifier first.
- An `*_info` metric is always `1`. Join it to move build metadata onto a
  graph, and remember that if it vanishes, the graph goes blank.
- The `_over_time` family reduces a window to one number. `max_over_time` over
  one rendering step is how a spike survives being zoomed out.
- A subquery, `expr[range:resolution]`, evaluates an expression repeatedly on
  an epoch-aligned grid. The colon is mandatory, the range must be at least
  twice the resolution, and the whole thing is expensive.
- `offset` and `@` attach to selectors only. `@ end()` is how you stop `topk`
  from re-ranking at every step.
- `sort` and `sort_desc` affect instant queries only, and Prometheus warns you
  since 3.12.0 if you use them in a range query.

## Exercises

!!! exercise
    **1. Break the join three ways (core).** Start from the working join in
    its Prometheus Query page form. Record the exact message for each of
    these, then write one sentence saying which label set failed to line up.

    (a) *Wrong side.* Aggregate the left side as `sum by (instance, route)`
    and swap `group_left(version)` for `group_right(version)`. You should get
    a duplicate-series error naming the **left** hand-side, listing series
    that differ only by `route`.
    (b) *No matching clause.* Delete `on (instance)` but keep
    `group_left(version)`. This is not an empty result — it does not parse,
    and the message points at the column where `group_left` appears.
    (c) *A label in two places.* Write `on (instance, version)
    group_left(version)`. The message names the rule directly. Then drop the
    group modifier, leaving `on (instance, version)`, and explain why *that*
    one returns an empty result instead.

    **2. Error ratio by deployed version (core).** Divide
    `sum by (instance) (rate(snip_http_requests_total{job="snip-api",
    code=~"5.."}[5m]))` by the same aggregation without the code matcher,
    then join `snip_build_info` onto the result with `group_left(version)`.
    Drive errors by posting `{"rps":40,"error_ratio":0.30}` to
    `localhost:8089/control`, then bump `SNIP_VERSION` and redeploy **the
    container `loadgen` dials**, `snip-api`. Confirm the new version's line
    carries the ratio while the old version's reads `NaN` — zero over zero on
    the replica that serves nothing.
    Say in one sentence what Chapter 12's reverse proxy will change about this
    exercise. Reset with `{"rps":20,"error_ratio":0}`.

    **3. Which question is cheaper (stretch).** Ask "peak requests per second
    in the last hour" as a subquery at two resolutions, `[1h:1m]` and
    `[1h:15s]`, then ask a comparable question of a gauge with no subquery at
    all: `max_over_time(loadgen_inflight_requests[1h])`. Measure each with
    the same curl as `promq`, plus `--data-urlencode 'stats=all'`, piped to
    `jq .data.stats.samples`. Compare `peakSamples`, the figure a query limit
    is enforced against. The 15-second subquery should peak at roughly four
    times the one-minute one, and the plain range vector far below either.
    The absolute figures depend on how long your lab has been running and how
    many series the selector covers, so compare the ratio and not the numbers.
    Write the three down and say why the ratio is close to four.

    **4. Now versus then (warm-up).** Add a second query to **Request rate by
    build version**, the panel you just built: the same expression with
    `offset 7d` on the `snip_http_requests_total` selector only, legended
    `a week ago`. It returns nothing, because this lab has not been running
    for a week — and an unmatched series on a graph is an absent line, with
    no error to tell you why. Change it to `offset 5m` and confirm both lines
    appear. Then write the ratio of the two as a single expression, say what a
    value of 2 would mean, and say which version the week-old line gets
    labeled with, given that `snip_build_info` is not offset.

    **5. The parse error (warm-up).** Run
    `sum(max(snip_links_active{job="snip-api"})) offset 5m` and copy the error
    down verbatim. Then write the form that works. The two numbers — with and
    without the offset — differ, but by far less than the number of links
    created in the same five minutes. Check that against
    `sum(increase(snip_links_created_total{job="snip-api"}[5m]))`, and explain
    the gap using the `expiry` queue Chapter 8 added, whose deletions you can
    count with `increase(snip_worker_jobs_total{queue="expiry",
    outcome="success"}[5m])`. Then explain why the query uses `max` and not
    `sum` across the two replicas.

    **6. Audit your assumptions (stretch).** Run `info`, `mad_over_time` and
    `sort_by_label` against the lab. Record which flag each needs according
    to the table in this chapter, and confirm the `is not enabled` parse
    error you get without it. Then run `docker compose config prometheus` and
    confirm the `command:` block contains no `--enable-feature` at all.

!!! note "Part III, closing"
    The p99 was pinned because the tail lived above the top bucket. The error
    ratio was blank because the numerator did not exist. The spike was
    invented by summing before rating. All three were correct PromQL, accepted
    without complaint, drawn on a dashboard somebody trusted. You can now tell
    the difference — and you have the service level indicator that Chapter 20,
    "SLIs, SLOs and Error Budgets" needs.
