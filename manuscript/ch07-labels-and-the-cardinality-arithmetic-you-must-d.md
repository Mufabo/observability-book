# Chapter 7 — Labels, and the Cardinality Arithmetic You Must Do First

Snip has been counting requests since Chapter 5, and the counter carries two
labels: `method` and `code`. That is enough to answer "how many failures?" and
not enough for the next question anyone asks, which is "failures on *what*?" The
redirect path and the create path are entirely different work, and right now
they are added together in every panel you have.

The fix is one word. You add `route` to the label list, rebuild, and Prometheus
starts telling you that the 500s are on `/l/{code}` while `/links` is mostly
fine. It takes ninety seconds and it is unambiguously the right change.

The same one-word edit, with `/l/8134` in the label instead of `/l/{code}`, is
how people take a monitoring system down. Not immediately — it works
beautifully in staging, where there are eleven short links. It fails four weeks
later in production, at three in the morning, when the process holding your
metrics runs out of memory. The difference between the good version and the
fatal one is a multiplication you can do on an envelope, and this chapter is
about doing it *before* you write the label.

!!! objectives "Objectives"
    After this chapter you can:

    - Compute the series count of a proposed label set before you write it.
    - Apply the label-admission test to any label somebody asks you for.
    - Quote the official cardinality guidance and say what it is guidance about.
    - Explain why one histogram is many series, and why the number differs
      between Go and Python.
    - Explain lazy series creation, and recognize "that series does not exist
      yet" as its own distinct cause of an empty graph.
    - Name six label values that are always wrong, and say where a trace ID
      belongs instead.

## Where the lab is, and one instruction that looks like a mistake

```bash
cd lab
git checkout ch07
```

**Do not run `make up` yet.** Leaving a checkout unapplied is deliberate here,
and it is the only chapter that asks for it.

The checkout gives you this chapter's files: a worksheet at
`lab/exercises/ch07-worksheet.md`, a budget file at
`lab/docs/cardinality-budget.md`, the verification script, and the finished
`lab/snip/metrics.go` with `route` already in it. Your *containers* are still
running the build from Chapter 6, "`rate()`, `increase()`, and Why Nothing Is a
Whole Number", because nothing rebuilds an image until you ask. So the files on
disk describe the label you are about to add, while the running stack shows the
cost of the labels you already have. You are going to price the change against
the thing it changes.

Leave the load generator at its defaults: 20 requests per second across the mix
from Chapter 1, "Ten Minutes to Your First Metric". Both `snip-api` containers
from Chapter 2 are up, told apart by `instance`.

## A label value is a new series, not a new column

If you write software for a living you have a strong prior about what a label
is, and it is wrong. A label looks like a column: `snip_http_requests_total`
looks like a table with a `method` column and a `code` column, and adding
`route` looks like `ALTER TABLE ADD COLUMN`, which costs one column and leaves
the rows alone.

Prometheus does not work that way, and Chapter 2, "What's Actually on the
Wire", already told you why, in a sentence that is about to become expensive:
**a time series is identified by its metric name plus its complete set of label
names and values.** Change any value and you are looking at a different series,
with its own memory footprint in the server, its own chunk of disk, and its own
index entries. A label is not a column; it is a *dimension*.

Ask Prometheus how many series that is today, against the stack you have
running right now:

```promql
count(snip_http_requests_total{job="snip-api"})
```

```promql
count by (instance) (snip_http_requests_total{job="snip-api"})
```

The first returns `16`, the second two rows — one per replica, each reading
`8`.

!!! iou "IOU — chapter 8"
    Three operators are on loan. `count()` collapses an instant vector to a
    single number: how many series came back. `count by (instance) (…)` does the
    same per distinct value of `instance`. `topk(10, …)` keeps the ten largest
    results. Nest the first two and you get this chapter's workhorse:
    `count(count by (l) (m))` groups `m`'s series by `l`, giving one result per
    distinct value of `l`, then counts those results — the number of distinct
    values `l` takes. It measures the cardinality of a *label* rather than of a
    metric. All of it belongs to the aggregation family Chapter 8, "Aggregation:
    `sum`, `without`, and the Rate-Then-Aggregate Law", teaches properly, along
    with the law governing when you may use them on a counter.

Eight series per replica. Not eight rows of a table — eight independent time
series, each kept in memory for as long as it is being written to. Sixteen
across the two replicas, because `instance` is a label too.

!!! jargon "Cardinality"
    The **cardinality** of a metric is the number of distinct time series it
    produces: one per unique combination of label values, counted separately
    per target. The cardinality of a *label* is the number of distinct values
    that label takes, and the first number is a product of the second across
    every label on the metric. Cardinality is the single quantity that
    determines what a Prometheus server costs to run.

## Cardinality is multiplication

Here is the whole model, short enough to memorize. For one metric on one
target, the number of series is the product of the distinct values of each
label:

```text
series = |label₁| × |label₂| × … × |labelₙ|
```

Then multiply by the number of targets, because every replica reports its own
copy. That is it. It is worth a chapter because people reason additively about
labels — "I'll add one more" — while the system behaves multiplicatively. A
label with 40 values does not add 40 series; it multiplies what you had by 40.

A request counter with `method`, `code` and 40 routes is 5 × 6 × 40 = 1,200
series per replica, and nobody did anything unusual. Now add `user_id`, because
somebody wanted to know which customers hit errors: with 100,000 users, 1,200
becomes 120,000,000. That is an outage with a dashboard attached, and nothing
about writing the fifth label looked different from writing the fourth. By the
time the consequence is observable the label is in production, other teams are
querying it, and removing it is a breaking change.

### The product is a ceiling, not a measurement

Go back to Snip. Six routes are documented, `method` has two values and `code`
has seven: the product is 6 × 2 × 7 = 84. But when you add `route` you end up
with 12 series per replica, not 84, because the product counts combinations that
are *possible* and only combinations that actually occur become series. Snip
never answers `POST /healthz` and never returns 201 anywhere except `/links`.
The set that really happens is twelve:

| route | method | codes |
|---|---|---|
| `/l/{code}` | GET | 302, 404, 500, 503 |
| `/links` | POST | 201, 400, 500 |
| `/links/{code}` | GET | 200, 404 |
| `/healthz`, `/`, `other` | GET | 200, 200, 404 |

Both numbers are useful. The observed count is what you have today; the product
is what you signed up for. A new code path, a new status code, a bot that
finally triggers a 405, and the gap between 12 and 84 closes without anybody
writing a line of instrumentation. Budget with the product, reconcile with the
observation.

## Take a census before you add anything

Before rebuilding anything, look at what the running lab holds. Start with the
whole server, ranked — the query you will reach for every time somebody says
"Prometheus is using a lot of memory":

```promql
topk(10, count by (__name__) ({__name__=~".+"}))
```

Read it inside out. `{__name__=~".+"}` selects every series in the database —
Chapter 2 introduced `__name__` as the reserved label holding the metric name,
and this is the one place you will ever match on it loosely. `count by
(__name__)` gives one result per metric name, valued at how many series carry
it. `topk(10, …)` keeps the largest ten.

Everything at the top of that list belongs to somebody else: Prometheus's own
request and response-size histograms, and
`loadgen_request_duration_seconds_bucket` at 72 series. Your own request
counter, at 16, is nowhere near it. Above all of them, on a lab up for minutes,
is `catalog_lookups_total`. Remember that name.

Prometheus will also tell you directly, without PromQL, through its status API —
Chapter 24, "Cardinality: Detonate, Diagnose, Defuse", arriving early because
you need to count things today:

```bash
curl -s localhost:9090/api/v1/status/tsdb \
  | jq '.data.seriesCountByMetricName[:10]'
```

That prints the same top-ten ranking as a JSON array of `{name, value}`
objects. Swap the filter for `.data.headStats` and you get `numSeries` — every
series the server currently holds in memory, the number a Prometheus server
lives or dies by. It is also a metric, because Prometheus scrapes itself:

```promql
prometheus_tsdb_head_series
```

Graph it over the last hour. It climbs — on the machine this was written on, by
about three thousand series an hour, and as a clean straight line rather than a
step. Almost none of that is yours: the slope is one metric on a service you did
not write, and you are going to name it before this chapter ends. Chapter 24
turns this graph into a hockey stick on purpose and teaches you to diagnose it.
For now it is the gauge that says how much you are asking of the server.

## The three blocks of a series budget

Now narrow to the job you own. Everything Prometheus stores for `snip-api`
falls into exactly three blocks, and readers get this arithmetic wrong because
they budget only for the first.

**Block one: the series you wrote.** Six families at this point in the book, and
you chose every label and value set in Chapter 5, "Your First Counter:
Instrumenting Code You Own":

| Family | Labels | Series per replica |
|---|---|---|
| `snip_http_requests_total` | method, code | 8 |
| `snip_redirects_total` | outcome | 3 |
| `snip_cache_lookups_total` | result | 2 |
| `snip_links_created_total` | none | 1 |
| `snip_links_active` | none | 1 |
| `snip_build_info` | version, commit, goversion | 1 |

Sixteen per replica, thirty-two across the two. Note `snip_build_info`: three
labels, still one series, because the values never change inside one build.
Cardinality counts *combinations that occur*, not labels declared — a
three-label metric can be cheaper than a one-label one. Check it:

```promql
count({job="snip-api", __name__=~"snip_.*"})
```

That returns `32`, and it will keep returning 32 until you change the
instrumentation or the replica count. If it returns something else, one of
those two assumptions is wrong, and finding out which is worth more than the
number itself.

**Block two: the series you inherited.** Chapter 5 explained that Snip registers
on the client library's *default* registry, which arrives with the Go runtime
and process collectors already on it. Nobody asked for `go_goroutines` or
`process_resident_memory_bytes`. They are on the bill anyway:

```promql
count({job="snip-api", __name__=~"go_.*|process_.*"})
```

This is the one row of the worksheet you **measure instead of derive**. Your
client library version and your Go release set it, not you, and either upgrade
moves it without a line of your code changing. There is no correct value to
memorize, only the value your build produces. On the lab this chapter was
measured against it returns `88`, 44 per replica.

**Block three: the series the server adds.** Every scrape, for every target,
Prometheus writes five series of its own that no exposition format ever
mentioned:

```promql
count({job="snip-api", __name__=~"up|scrape_.*"})
```

That returns `10`: five per target, two targets. You met `up` in Chapter 1; the
other four report how long the scrape took, how many samples it carried, how
many survived the scrape's own filtering, and — the one to remember — how many
series it added that the server had never seen before. Small, free, and exactly
what a reader forgets and then cannot account for.

Add the three blocks:

| Block | How you got it | Series |
|---|---|---|
| `snip_*`, the ones you wrote | arithmetic | 32 |
| `go_*` and `process_*` | one query | 88 |
| `up` and `scrape_*` | 5 × 2 targets | 10 |
| **Total** | | **130** |

Confirm the whole thing in one query:

```promql
count({job="snip-api"})
```

The middle row is the one that will differ on your machine, and if it does, your
machine is right and this table is a worked example. The outer two will not: 32
is fixed by the instrumentation, 10 by the target count. Two thirds of what
Prometheus stores for the service you wrote is made of things you did not write,
and that ratio is the most useful fact here.

## The histogram multiplier

There is one more multiplier, and it turns a reasonable label set into an
unreasonable bill. A histogram is not one series per label combination; it is
many. Chapter 2 showed the three parts of a histogram family on the wire: a
`_bucket` series for each boundary, plus `_sum` and `_count`. So:

```text
series per combination = (finite boundaries + 1) + 2
```

The `+ 1` is the `+Inf` bucket, which always exists and holds every
observation; the `+ 2` is `_sum` and `_count`.

Two services in your lab carry histograms, in two languages, and the numbers do
not match. `loadgen` is Go, and its latency histogram takes the client library's
default boundaries verbatim: eleven of them, with `+Inf` appended for you and
never written in the code. Count them yourself:

```promql
count(count by (le) (loadgen_request_duration_seconds_bucket))
```

That returns `12` — eleven finite boundaries and `+Inf`. Each `(route, method)`
pair costs 12 + 2 = **14 series**, and `loadgen` drives six pairs: 6 × 14 = 84
series from one metric name. Confirm the whole family:

```promql
count({__name__=~"loadgen_request_duration_seconds.*"})
```

Eighty-four. Now the same query against `catalog`, the Python service you have
been diagnosing since Chapter 4, "Metric Types Are Contracts":

```promql
count(count by (le) (catalog_request_duration_seconds_bucket))
```

That returns `15`. Python's client library ships **fourteen** default finite
boundaries where Go ships eleven — its `DEFAULT_BUCKETS` tuple lists more
of them, and lists `inf` itself, though `prometheus_client` appends the infinite
bucket for you exactly as `client_golang` does. Fourteen finite plus one
infinite is fifteen, so each route costs 15 + 2 = **17 series** instead of Go's
14. Count `catalog`'s observed routes with `count(count by (route) (…))` on the
same metric and multiply — the lab exercises only one of them hard, so the
answer is smaller than the service's route table.

Read that again, because it is the point: **the identical metric, with the
identical labels, costs 14 series per combination in Go and 17 in Python.** If
you ever plan capacity for a polyglot fleet from one spreadsheet, this is the
line that makes the spreadsheet wrong.

!!! pitfall "Budgeting a histogram as if it were a counter"
    The mistake is not forgetting that histograms are expensive. It is
    forgetting that the multiplier applies to the *product* of the labels, not
    to the metric. Snip's twelve observed `(route, method, code)` combinations
    cost 12 series as a counter; the same label set on a histogram with thirteen
    finite boundaries is 12 × 16 = 192. A label set that was fine on a counter
    has to be justified again from scratch on a histogram.

## The label-admission test

The arithmetic tells you what a label costs, not whether to add it. For that,
run four questions past every proposed label, and admit it only if all four
pass.

**1. Is the set of possible values bounded and known at deployment time?** Not
"small today". Bounded — an enumeration you could write out in the source file.
`method` is bounded: the HTTP methods are a short fixed list and you serve two.
A short link's code is not, and neither is anything derived from user input. The
test is not "how many values are there now"; it is "what stops there being a
million".

**2. Would you actually filter or group by it in a query or an alert?** If you
cannot name the panel or the rule that would use it, you are storing data on
the chance that somebody one day asks. That chance is billed per scrape,
forever.

**3. Does it identify an individual user, request, session or entity?** If yes,
stop. This is a category error rather than a cost question: metrics are
aggregates over populations, and a label that identifies one member turns every
aggregate into a one-row table. There is a right place for per-request identity,
and you meet it before this chapter ends.

**4. Is it already derivable from a target label?** `instance` and `job` are
attached by the server on every scrape, and `env` is a target label this lab
sets in `lab/prometheus/prometheus.yml`. `region` and `cluster` belong to the
same family — deployment facts the scrape configuration owns, not the process —
and Chapter 12, "`prometheus.yml` in Full: Service Discovery and Relabeling",
is where they get set. Chapter 5 made this a rule and gave you the reason. Your
own copy costs series and creates two versions of one truth that will eventually
disagree.

Alongside the test there is published guidance, worth quoting exactly because it
is the sentence people cite at each other in code review. The official
instrumentation practices say to *"try to keep the cardinality of your metrics
below 10, and for metrics that exceed that, aim to limit them to a handful
across your whole system,"* and that *"if you have a metric that has a
cardinality over 100 or the potential to grow that large, investigate alternate
solutions."*

Be precise about what those numbers count, because they are routinely misread.
They are not a limit on the number of labels, nor on how many values one label
may take. They are the **series count of one metric on one target** — the whole
product. Under 10 is the target; over 100 means the design needs a second look,
not that it is forbidden. By that standard your twelve-series request counter is
comfortable, `loadgen`'s 84-series histogram is justifiable, and `catalog`'s
lookup counter is already past the line with no bound in sight.

## Bounded, unbounded, and the labels that are always wrong

The test collapses to one distinction. A **bounded** value set has a limit
something in the system enforces: an enumeration in the code, a fixed list of
routes, a status-code registry. An **unbounded** set has no such limit; its size
is a function of traffic, users or time. Bounded sets are labels. Unbounded sets
are not, no matter how small they look today.

These are always wrong as label values, and every one has taken down a real
system:

- `user_id` — grows with your customer base, the one number the business is
  trying to increase.
- `email` — the same, plus it puts personal data in your metrics store.
- `session_id` — grows with logins, and every value is dead within the hour.
- `request_id` — one new series per request, permanently.
- `order_id`, and any other primary key.
- The **raw URL path**. `/l/8134` and `/l/abc9x2` are two series. Use the
  templated route: `/l/{code}`.
- The **raw error string**, including anything with an exception message or a
  stack frame in it. Use a bounded `reason` with values you chose.
- Any **UUID**, and anything containing one — container IDs, generated
  hostnames, pod names emitted from inside the application.

Snip's catch-all is worth pausing on. Unrecognized paths are recorded as
`other`, not as themselves — and that one decision keeps every scanner on the
internet, probing for `/wp-login.php`, from minting a series per probe. A bot
cannot spend your budget if every path it invents collapses to one label value.

### Where a trace ID actually belongs

The obvious objection is that per-request identity is genuinely useful. You have
a slow request; you want *that* request's trace. Putting `trace_id` in a label
would do it — and would be the worst version of the bomb: one new series per
request, never reused, never reclaimed.

Prometheus has a purpose-built answer, and its name is an **exemplar**. An
exemplar is a reference — typically a `trace_id` and a `span_id` — attached to
a single sample of a metric, carrying you from the graph to the one request that
produced the observation. Exemplars are stored beside the series rather than as
part of its identity: **an exemplar creates no new time series and costs no
cardinality at all.** That is the entire reason the feature exists.

Chapter 29, "Beyond Metrics: Exemplars, Traces, Logs, and Where to Go Next",
turns them on in the lab. For now the durable rule is one sentence: a trace ID
is forbidden as a label and free as an exemplar.

## Lazy series creation, and the series that does not exist yet

One consequence of the "a label value is a new series" model costs beginners
entire evenings, and it is a debugging problem rather than a cost problem.
Client libraries create series **lazily**.
`snip_http_requests_total{route="/links", method="POST", code="500"}` would not
exist in the process until the first time Snip answered a 500 on a create — and
it would not, were it not for the pre-initialization you are about to read. Run
Snip with `SNIP_NO_ZERO_INIT=1` and that is exactly what happens. Before that
first 500 there is no series, so there is nothing on the exposition, so
Prometheus has nothing to store, so your query returns *nothing at all*.

Nothing is not zero. A panel showing zero errors and a panel showing no data
mean completely different things, but the query that produced them is identical.
"The metric exists; that label combination has never occurred" is its own cause
of an empty graph, and no amount of re-reading your PromQL will reveal it.

!!! ladder "Ladder → rung 7"
    Empty result, metric name definitely correct, bare selector definitely
    returns data? Appendix B, rung 7: has this label value ever occurred? A
    series that has never been written does not exist, and a selector for it is
    not wrong — it asks about something that has not happened yet.

The fix is to create the series you know about, at zero, before any traffic
arrives. Snip already does this, in `lab/snip/metrics.go` as this chapter's
checkout leaves it:

```go
func (m *apiMetrics) zeroInit(c *config) {
	for _, k := range httpCombinations {
		l := prometheus.Labels{
			"route": k.route, "method": k.method, "code": k.code,
		}
		if c.UnboundedLabel {
			l["link_code"] = ""
		}
		m.Requests.With(l)
	}
	for _, r := range []string{resultHit, resultMiss} {
		m.CacheLookups.WithLabelValues(r)
	}
	for _, o := range []string{outcomeHit, outcomeMiss, outcomeExpired} {
		m.Redirects.WithLabelValues(o)
	}
}
```

Touching a child with `With` or `WithLabelValues` creates it at zero without
incrementing anything. Twelve combinations, two cache results, three redirect
outcomes: every series the process knows it can produce exists before the first
request does. The `c.UnboundedLabel` branch is dead until you set
`SNIP_UNBOUNDED_LABEL=1` — the switch this chapter's trap box is about. Watch
the rest of it working: after the rebuild, ask for every 404 the service
counts:

```promql
snip_http_requests_total{job="snip-api", code="404"}
```

Six series come back, three per replica. On `snip-api`, `route="other"` climbs
fastest, because the load generator probes a path Snip does not route.
`route="/l/{code}"` climbs slowly: links expire after ten minutes, and a
request for an expired code is a 404 — the same events
`snip_redirects_total{outcome="expired"}` counts, so the two track each other.
Only `route="/links/{code}"` holds at exactly `0`, because that handler never
checks expiry. And on `snip-api-b` all three sit at `0`, because the load
generator dials `snip-api` by name and never reaches the second replica.

Those zeros are the point: the series exist after hours of traffic without ever
having been incremented, which is why your arithmetic can match a measurement
at all.

Two later chapters are built on the consequences. A ratio of errors to requests
returns no data instead of a solid zero when the numerator has never occurred:
the blank panel of Chapter 9, "Ratios, Arithmetic, and the Series That Isn't
There". An alert whose expression can never be evaluated can never fire: the
silent failure of Chapter 16, "Alerting Rules, and What 'Firing' Actually
Means", and the worst bug in monitoring, because the system looks healthy
precisely when it is broken.

The rule to carry: **pre-initialize every label combination you know in
advance, and only those.** Do not pre-initialize a histogram, and never
pre-initialize a set you cannot enumerate.

## Churn: the cost that does not show up as a big number

One last distinction, and it separates people who have operated a Prometheus
from people who have read about one. Two labels, both with about a thousand
distinct values. The first is a thousand shard names that have been the same for
two years: a cardinality problem — steady, costed once, survivable. The second
is a container ID that changes on every deploy, and you deploy four times a day.
That is a **churn** problem, and it is strictly worse. Every deploy strands a
generation of series. They do not
vanish when the values stop being produced: Prometheus keeps a series in memory
for hours after its last sample, and the samples themselves stay on disk until
they age out — Chapter 25, "Storage, Retention, Backups, and Locking the Door",
is where you set how long that is. After a week you are paying for twenty-eight
thousand series, and the number keeps climbing while the label's cardinality,
measured at any instant, still reads one thousand. The bill is written by
history.

The practical test, applicable to any proposed label in about five seconds:
**does this value change when nothing about the world changed?** A deploy is
not a change in the world. Neither is a restart. A label that turns over on
either is churn, and churn is measured in series per week, not in series.

## The lab step: add `route`, and reject the label you wanted

### Do the arithmetic first

Fill in `lab/exercises/ch07-worksheet.md` **before** you rebuild. The exercise
is the reconciliation, and it does not work backwards: once you have seen the
answer you cannot unsee it, and the value of this chapter is in the gap between
your figure and the real one.

You are budgeting the state you are about to create, not the one you have.
Adding `route` turns eight `(method, code)` combinations into twelve
`(route, method, code)` ones: the single `GET 200` splits three ways, across
`/links/{code}`, `/healthz` and `/`, and the single `GET 404` splits three ways,
across `/l/{code}`, `/links/{code}` and `other`. Four more per replica, eight
across the pair. Everything else is unchanged: neither the runtime block nor the
scrape block cares about your labels. Add the three blocks yourself, write the
figure on a line containing the word `TOTAL` in
`lab/docs/cardinality-budget.md`, and only then run `make verify-ch07`.

The same worksheet, with the design checklist that goes around it, is Appendix
D, "Metric and Label Design Checklist, with the Cardinality Worksheet" — that
is the copy to keep after the lab is deleted.

### The edit

Four edits in `lab/snip/metrics.go` — the label list, the combination table,
the map inside `zeroInit` and the HELP string, which now reads "by templated
route, method and response status code" where Chapter 5 printed it without the
route — and three in `lab/snip/api.go`, all on disk already after
`git checkout ch07`. The label list gains `route`:

```go
requestLabels := []string{"route", "method", "code"}
```

and the pre-initialized set becomes the twelve combinations the service can
actually produce, each row now naming its route:

```go
var httpCombinations = []httpCombination{
	{routeRedirect, "GET", "302"},
	{routeRedirect, "GET", "404"},
	// ... eight more ...
	{routeIndex, "GET", "200"},
	{routeOther, "GET", "404"},
}
```

Those `route*` names are constants at the top of the same file, and every one
is a template rather than a path:

```go
const (
	routeIndex    = "/"
	routeHealthz  = "/healthz"
	routeRedirect = "/l/{code}"
	routeLinks    = "/links"
	routeLink     = "/links/{code}"
	routeOther    = "other"
)
```

The value reaches the metric from `lab/snip/api.go`, where each route is
wrapped once, at startup, with its template bound in:

```go
func (s *server) instrument(route string, next http.Handler) http.Handler {
	curry := prometheus.Labels{"route": route}

	// ... promhttp options, including the method label ...

	return promhttp.InstrumentHandlerCounter(
		s.m.Requests.MustCurryWith(curry), next, countOpts...)
}
```

`MustCurryWith` fixes `route` for that handler and hands back a counter that
only needs the remaining labels. The template is decided at wiring time, by code
you wrote — never derived from the request path at runtime. That is the
structural reason Snip cannot accidentally emit `/l/8134`.

Now apply it:

```bash
make up
```

The old `{method, code}` series stop appearing on the exposition immediately.
Chapter 2's staleness markers mean they disappear from instant queries on the
next scrape rather than lingering for five minutes — though their samples stay
in the database, so a range query over the last hour still shows the old shape
ending and the new one beginning. The dashboard's request-rate panel regains the
by-route breakdown it lost in Chapter 5, splitting into six lines once the
rebuilt containers are scraped.

Then run the verifier. Here is what it prints when you make the mistake
everybody makes first — budgeting only the metrics you wrote, and taking the
full product rather than the observed twelve:

```console
$ make verify-ch07

== verify-ch07 ==
   expected runtime: about 10 s

     the TSDB currently holds 138 series for job="snip-api"
PASS snip_http_requests_total now carries route
PASS route has at most the six documented values
     route values seen: / /healthz /l/{code} /links /links/{code} other
PASS docs/cardinality-budget.md exists
     your budget: 84   measured: 138
FAIL your budget is within 10% of the measured count — got 84,
want within 10% of 138
     → the usual misses: the runtime metrics you did not ask
     → for (go_*, process_*), the two replicas, and the _sum,
     → _count and +Inf series every histogram brings with it.
     catalog_lookups_total currently has 927 book_id values,
     and nothing in that service bounds the number. Chapter
     24 is where that bill comes due.
PASS planted bug #3 is visible in catalog_lookups_total

ch07: 4 passed, 1 failed
ch07 FAILED
```

The `FAIL` line is one line on your screen; it is wrapped here to fit the page.

Eighty-four against a hundred and thirty-eight. Both halves of that error are
instructive: 84 is the product where 12 was the observation, and the two blocks
of series nobody asked for are missing entirely. Done right, the census before
the edit gave 130, the four extra combinations per replica add eight, and the
budget lands on 138. Fix the figure, re-run, and you get `ch07 OK`.

Two numbers there are not yours to reproduce. The `138` moves with your runtime
block, and `927` will be different on your machine because it is still going up
while you read this. That is the finding, and the last section of this chapter
is about it.

### Reject one

The worksheet's step 6 asks you to reject a label you genuinely wanted: a
design rule you have only ever applied to labels you did not want is a rule you
have not applied. The most obvious product question about a link shortener is
*which links are hot*, and a `link_code` label on `snip_http_requests_total`
answers it instantly.

Cost it honestly. `link_code` multiplies the twelve combinations by the number
of short codes ever requested, and Snip's whole purpose is to accumulate links:
a hundred thousand links, ten of the twelve combinations reachable per link, two
replicas, and one counter is asking for two million series — each keeping most
of its cost after the link goes quiet.

Then apply the test. It fails questions 1 and 3 outright. Question 2 is the
interesting one, because the answer is genuinely yes: you would filter by it.
That is what makes this a real decision and not a straw man.

So reject it, and write down what you will do instead. Per-link popularity is a
top-N question over a large key space, which is what a database, a log pipeline
or a nightly job is for. Snip's `links` table already has a `hits` column and an
index on `(hits DESC, code ASC)` — the product question was answered before
anyone reached for a metric. Write that sentence in the worksheet; it is the one
you will have to say out loud in a code review one day.

!!! trap "The rejected label is one environment variable away"
    The lab ships this exact bomb behind a switch. `SNIP_UNBOUNDED_LABEL=1` adds
    `link_code` to `snip_http_requests_total` for real, and the ranked census
    query stops looking like your lab:

    ```text
    snip_http_requests_total                    1562
    ```

    **Do not turn it on yet.** That reading is real. While this book's lab was
    being verified, a stale `.env` left the switch on by accident, and
    Prometheus stored 1,562 series for a counter whose service can produce
    twelve combinations — on a laptop, in an afternoon, from one label.
    Chapter 24 detonates it deliberately, with enough traffic and enough
    diagnostic vocabulary to make watching it enjoyable. Turning it on here, on
    a lab you will spend seventeen more chapters in, buys you a slow server and
    spends the lesson early.

## Somebody else's unbounded label

Your own service is now costed. Most of the cardinality you will ever deal with
was written by somebody else, and `catalog` — the service you diagnose and do
not own — has a problem you can find with nothing but the census. It was at the
top of that ranking. `catalog_lookups_total` counts lookups by result: hit and
miss, so it should be two series. Ask how many values its labels really take,
then ask again sixty seconds later:

```promql
count(count by (book_id) (catalog_lookups_total))
```

The number does not settle. On the run that produced that verifier output, it
read 321, then 593, then 927 over six minutes — on the order of a hundred new
series a minute, nearer fifty on a lab that has been up a while at twenty
requests per second, none ever reclaimed. Treat both figures as
order-of-magnitude; the rate moves with the link-expiry turnover. Whatever you
see, the second reading is larger than the first, and that is the diagnosis:
nothing bounds the value set, so the graph of its cost is a ramp rather than a
level. Read the code, at `lab/catalog/metrics.py`:

```python
if FIX_CARDINALITY:
    LOOKUPS = Counter(
        "catalog_lookups",
        "Catalog lookups by book and result.",
        ["result"],
    )
else:
    LOOKUPS = Counter(
        "catalog_lookups",
        "Catalog lookups by book and result.",
        ["book_id", "result"],
    )
```

`CATALOG_FIX_CARDINALITY` defaults to off, so your lab runs the second branch;
the first is the shape of the fix Chapter 24 eventually applies.

`book_id` comes straight off the URL path of `GET /books/{id}`. Nothing
validates it, nothing bounds it, and a miss is labeled too — so any caller,
including one who does not exist yet, can mint series that never go away. The
book catalog behind it holds 200,000 entries.

One more query, because it makes an estimate wrong by a factor of two:

```promql
count by (result) (catalog_lookups_total)
```

One row, `result="hit"`. Snip maps each short code onto a book id
deterministically and always lands inside the catalog, so the `miss` half of the
label has never been written. In your lab `result` multiplies by one; in
production, facing callers who ask for books that are not there, by two.

Exercise 4 asks you to do the arithmetic the person who wrote this label did
not. Whatever daily fraction of those 200,000 books you assume, every id is a
series that is never reclaimed, and a scanner walking `/books/1` upward mints
them as fast as it can issue requests, because a miss counts too.

Nor is this theoretical. Snip creates short links continuously and expires them
after ten minutes, so the working set of codes turns over — and every new code
maps to a new book id, minting a new series on a counter that never forgets.
Churn and unbounded cardinality in one metric.

**Do not fix it.** Write the number in step 7 of the worksheet and leave the
service as it is. You found a defect by arithmetic, three chapters after it was
introduced and seventeen before it detonates. Chapter 24 is where the bill
arrives.

!!! selfcheck "Self-check"
    Run `make verify-ch07`. It must print `ch07 OK`. Three numbers are worth
    checking on the way:
    `count({job="snip-api", __name__=~"snip_.*"})` returns exactly `40`,
    `count(count by (route) (snip_http_requests_total{job="snip-api"}))`
    returns exactly `6`, and
    `count({job="snip-api", __name__=~"up|scrape_.*"})` returns exactly `10`.
    If the first is still 32, the containers are running the old image — run
    `make up` again. If it is well below 32 — around twenty — then
    `SNIP_NO_ZERO_INIT` is set in your `.env`: without pre-initialization only
    the combinations traffic has actually produced exist, and the idle replica
    has almost nothing at all.

## Common mistakes

**Budgeting the metric you wrote and nothing else.** This is the one the
verifier is built to catch. Two-thirds of what Prometheus stores for a typical
application job is runtime metrics you never asked for plus scrape metrics the
server added, so a capacity plan that counts only your own instrumentation is
wrong by a factor you never measured.

**Treating a small value set as a bounded one.** "There are only forty routes"
is an observation. "The routes are an enumeration in this file" is a bound. The
question is never how many values exist today; it is what mechanism prevents
there being a million. If the answer is "our current traffic", there is no
bound — and this lab is the live proof. `bookIDFor` in your own
`lab/snip/api.go` says the mapping "settles at a few dozen distinct ids rather
than one per request"; the measurement says thousands. The expectation was
written down, and nothing enforced it.

!!! pitfall "The label that was bounded until somebody changed the code"
    A `reason` label with four values passes the admission test. Then a
    colleague writes `reason=str(exc)` in a new error path, because it was right
    there and more informative. Nothing in Prometheus, the client library, the
    compiler or your test suite objects. The label was bounded by convention,
    and conventions are enforced by code review or not at all. Put an enumerated
    value set in the source as constants — the way Snip's routes are — so that
    adding a value is an edit somebody makes on purpose.

**Putting the trace ID in a label because the graph and the trace need to be
connected.** They do need to be connected — that is precisely why exemplars
exist, and reaching for a label instead is how a correct instinct produces the
worst outcome available.

## Summary

A label is not a column. Every distinct combination of label values is a
separate time series with its own memory, disk and index entries, so cardinality
multiplies where intuition adds. The product of the label value sets is your
ceiling; the combinations that actually occur are your current bill; the gap is
what you committed to without noticing. The procedure is repeatable: multiply
out the families you wrote, measure the runtime families you inherited, add five
series per target for the ones the server writes itself, multiply by your
replica count — then reconcile against the database, and when the numbers
disagree, find out why before you change either one.

The things to still know in six months:

- Cardinality is multiplicative, per target. One new label with *n* values
  multiplies an existing metric by *n*; it does not add *n*.
- A histogram costs `(finite boundaries + 1) + 2` series per label combination,
  and that count belongs to the client library — Go's defaults give 14, Python's
  give 17, for identical code.
- The official guidance is under 10 series per metric per target, investigate
  above 100. It counts series, not labels.
- Admit a label only if its values are bounded and enumerable, you would group
  by it, it identifies no individual, and it is not already a target label.
- `user_id`, `email`, `session_id`, `request_id`, `order_id`, raw paths, raw
  error strings and UUIDs are never labels. Trace IDs go in exemplars, which
  cost no cardinality at all.
- Series are created lazily, so a combination that has never occurred is an
  absent series and a distinct cause of an empty graph. Pre-initialize the
  combinations you can enumerate.
- Churn — values that turn over on every deploy — is worse than steady high
  cardinality, and no instantaneous measurement will show it to you.

## Exercises

!!! exercise
    **1. Your label set, costed (core).** Fill in
    `lab/exercises/ch07-worksheet.md` for the label set you would genuinely
    want on `snip_http_requests_total` in production, not the one the lab
    ships. Compute the total at your real replica count, then cut one label
    and record what it would have cost. End with a figure, a rejected label,
    and one sentence saying where that label's question gets answered
    instead.

    **2. What a `region` label would cost (warm-up).** Compute the series
    cost of adding a `region` label with three values to every metric
    `snip-api` exposes — including the runtime families, which would carry
    it too. Then say who should really be setting `region`, and why the
    application is the wrong place. Your answer should be three times the
    first two blocks with the ten `up` and `scrape_*` series unchanged — 394
    against the 138 in `lab/docs/cardinality-budget.md` — and knowing why
    block three does not triple is the point.

    **3. Predict chapter 10's histogram (core).** Chapter 10, "Latency:
    Histograms Without Tears", adds `snip_http_request_duration_seconds`
    over the same `(route, method, code)` label set you just established.
    Predict its series count per replica for two designs: one with eight
    explicit finite boundaries, and one with thirteen. Write both numbers in
    your worksheet. Chapter 10 ships one of them and will check your figure.

    **4. The pull request to catalog (core).** Estimate
    `catalog_lookups_total`'s cost if the book catalog holds 200,000 books
    and 0.5% of them are requested on a given day. State your assumption
    about the `result` label explicitly, since it changes the answer by a
    factor of two. Then write the pull request you would send to the team
    that owns `catalog`: what the defect is, what it costs per week, what
    the fix is, and what the fix breaks. Finally, run `count(count by
    (book_id) (catalog_lookups_total))` twice, five minutes apart, and say
    in one line why the lab's growth rate differs from your production
    estimate.

    **5. Two counts that disagree (stretch).** Run `topk(10, count by
    (__name__) ({__name__=~".+"}))` and find one metric whose cardinality
    surprised you, high or low. Say in one line why it is what it is. Then
    find the same metric in the `seriesCountByMetricName` list from
    `/api/v1/status/tsdb` and confirm the two agree. If you pick
    `snip_http_requests_total` they will not, for the first couple of hours
    after your rebuild — say why, using what you know about the series you
    just replaced.

!!! note "Part II — before and after"
    The dashboard you built in Chapter 3, "Your First Dashboard: The Early Win",
    was green during a real outage, because it watched the wrong series and
    averaged the wrong thing. Four chapters later it watches metrics you wrote,
    with types you chose deliberately, on labels you costed before you typed
    them. Diagnosis then: see green, go looking somewhere else. Diagnosis now:
    read the route and the status code off the panel, and know what the graph
    cost you to have.
