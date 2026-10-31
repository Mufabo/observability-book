# Chapter 29 — Beyond Metrics: Exemplars, Traces, Logs, and Where to Go Next

At 14:20 the p99 on the redirect path doubled. You know that because the panel
you built in Chapter 10, "Latency: Histograms Without Tears", says so, and
because the burn-rate alert from Chapter 21, "Burn Rates: Alerts That Don't Cry
Wolf", told you before the panel did. You know the error ratio did not move. You
know from Chapter 22, "Metrics From Things You Didn't Write", that the container
is not throttled and the database is not slow. You have twenty-eight chapters of
apparatus and it is all working exactly as designed.

Now answer this: *which requests were slow?*

Not how many. Not what proportion. Which ones. Every query you have learned
returns another aggregate, because an aggregate is the only thing in the
building. `histogram_quantile` hands you a number interpolated inside a bucket;
`topk` ranks routes; `sum by (instance)` tells you it was both replicas. None
can produce a single request, because no single request was ever stored. Snip
incremented a counter and observed a duration, and everything else about that
request — which short code, which client, which database call ate the time —
was discarded at the moment of measurement.

That was not an oversight. It was the deal. This chapter is about what the deal
cost, the one mechanism Prometheus provides for buying a small piece of it back,
and the other kinds of data that exist because of it.

!!! objectives "Objectives"
    After this chapter you can:

    - Explain why metrics structurally cannot answer "which request", and why
      the obvious fix is the cardinality bomb from Chapter 24.
    - Turn exemplars on end to end, and name every switch they require on both
      sides.
    - Say why `curl` shows you no exemplars even when they are working.
    - Describe Loki's cardinality physics and where a trace ID belongs in a
      log line.
    - Say what a trace answers that a metric cannot, and the reverse.
    - Tell a stale tutorial from a current one in about ten seconds.

## Where the lab is

This is the last chapter, so the lab is everything you have built: the whole
base stack, four dashboards, five rule files, an Alertmanager tree, an SLO and
a burn-rate ladder. Chapter 29 adds one overlay file and turns on two switches
that have been sitting at zero since Chapter 5.

```bash
cd lab
git checkout ch29
make check
make up
make signals-up
```

`make signals-up` runs Compose with `compose.yaml` and `compose.signals.yaml`
together: Tempo on `3200`, Loki on `3100`, Alloy on `12345`. It also recreates
`snip-api` with `SNIP_OPENMETRICS=1` and `SNIP_EXEMPLARS=1`.

Two URLs changed earlier and stay changed: Snip is behind `edge` at
`http://localhost:8080/`, and Prometheus answers at
`https://localhost:8443/prometheus/` behind basic auth, user and password both
`obslab`. Grafana is still on `http://localhost:3000/`. Give the load generator
something steady to do:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","error_ratio":0}'
```

## The bargain metrics made

Chapter 7, "Labels, and the Cardinality Arithmetic You Must Do First", taught
the arithmetic and Chapter 24 detonated it: every distinct combination of label
values is a separate time series, with its own memory in the head block, its own
index entries and its own query cost. That is why `snip_http_requests_total` has
exactly twelve series no matter how much traffic arrives, and why
`SNIP_UNBOUNDED_LABEL=1` — which adds the short code as a label — produced
thousands and kept climbing.

Turn that around and it stops being a limitation and becomes a design decision.
**A counter costs the same at ten requests per second as at a hundred thousand.**
The bill is set by the shape of your label sets, not by your traffic. Nothing
else in observability has that property. Logs cost per line. Traces cost per
span. Metrics cost per *series*, and a series is something you can count on a
whiteboard before you ship.

The price is paid in exactly one currency: **request identity is discarded at
write time.** When Snip observes `0.412` into the redirect histogram, the value
lands in the `le="0.5"` bucket and everything that made that request
distinguishable evaporates. No amount of cleverness later recovers it, because
it was never written down.

So a whole family of questions is closed to your dashboards, and it is worth
being precise about which:

| Question | Why metrics cannot |
|---|---|
| Which customer saw the errors? | Customer ID is unbounded cardinality |
| Is it the same 2% failing each time? | A rate is a rate; identity is gone |
| Which downstream call ate the 4 s? | A bucket knows a count, not a chain |
| Which line of code burns the CPU? | Metrics have no stack |

The obvious fix is the wrong one, and Chapter 7 already named it. Putting
`trace_id` in a label would answer "which request" perfectly — and would be the
worst possible version of the cardinality bomb: one new series per request,
never reused, never reclaimed. The instinct is correct. The mechanism is not.

## Three questions, three answers

The other signals are usually introduced as "the three pillars of
observability." That framing is worth understanding and then putting down.

It comes from a specific, dated artifact: Peter Bourgon's February 2017 blog
post "Metrics, tracing, and logging", written after that year's distributed
tracing summit. His original was a *Venn diagram* — overlapping domains, not
three load-bearing columns. It is not from the CNCF, not from Google's SRE book,
and not from OpenTelemetry, and attributing it to any of them is a tell that
someone is repeating rather than reading.

The sharpest criticism of the flattened version comes from Charity Majors, and
it is a real argument rather than a straw man. Three pillars, she argues,
describes *storage silos*, not a debugging workflow: three databases, three
query languages, three retention policies, and you are the join key. Worse,
aggregation eliminates context at write time, and no amount of clever joining
later restores what was never preserved. Her alternative is one wide, structured
event per unit of work, from which both metrics and traces can be derived.

Take that seriously without concluding that Prometheus is obsolete. Metrics are
the only signal with a bounded cost curve, which makes them the right substrate
for alerting, and the only one that works where there is no request at all —
disk fullness, certificate expiry, queue depth, batch jobs, `up`. Majors' own
framing concedes that split: the model works for infrastructure and hurts for
application debugging. That boundary is exactly what you have been learning.

So drop the pillars and keep the questions. Each one has an answer, and the
answers are different data shapes rather than competing products:

- *Which request?* → **traces**. One request's journey across services, as a
  tree of timed spans.
- *What did it actually say?* → **logs**. The text your code emitted while it
  was happening.
- *Which function burned the CPU?* → **profiles**. Stack samples, continuously.

And the bridge from a metric to the first of those — the one Prometheus itself
ships — is the exemplar.

!!! jargon "Exemplar"
    An exemplar is a reference attached to one specific sample of a counter or
    a histogram bucket, pointing at data outside the metric. Canonically it
    holds a trace ID. It is **not a label**: it does not participate in series
    identity, it creates no new time series, and it costs no cardinality at
    all. That is the entire reason the feature exists.

## Both switches, and why `curl` will not show you

Exemplars fail silently in both directions, because they need two independent
switches thrown — one in your application, one on the server — and neither one
complains about the other.

The application switch is the exposition format. Exemplars ride on **OpenMetrics
text** (or protobuf). The classic Prometheus text format has nowhere to put
them; this is not Prometheus choosing to ignore them, the syntax does not exist.
In Go's `client_golang` that is one field on the handler, in `lab/snip/main.go`:

```go
return promhttp.HandlerFor(prometheus.DefaultGatherer,
    promhttp.HandlerOpts{
        // OpenMetrics is what carries exemplars. Both are off by
        // default and chapter 29 turns them on together.
        EnableOpenMetrics: c.OpenMetrics,
        ErrorHandling:     promhttp.ContinueOnError,
    })
```

Chapter 5, "Your First Counter: Instrumenting Code You Own", printed that same
block and said the option was off. This is the chapter that turns it on.

The second half is recording them. `lab/snip/api.go` attaches an exemplar to
every observation of `snip_http_request_duration_seconds`, and to nothing else:

```go
if s.cfg.Exemplars {
    durOpts = append(durOpts,
        promhttp.WithExemplarFromContext(exemplarFor(s.cfg)))
}
```

`exemplarFor` returns the two label keys, and these are the keys that matter:

```go
return prometheus.Labels{
    c.ExemplarLabel: ids.trace,
    exemplarSpanID:  ids.span,
}
```

`c.ExemplarLabel` defaults to `trace_id` and `exemplarSpanID` is `span_id` —
the W3C-aligned names, and what Grafana's trace linking expects. The official
`client_golang` exemplar example uses a key called `dummyID`, because it
demonstrates the API rather than a real pipeline. Copying that key is a mistake
with no error message attached to it.

Without the `promhttp` middleware there are two raw APIs and no third: a
histogram is asserted to `prometheus.ExemplarObserver` and observed with
`ObserveWithExemplar(value, labels)`; a counter is asserted to
`prometheus.ExemplarAdder` and incremented with `AddWithExemplar(delta,
labels)`. **Gauges cannot carry exemplars** — the OpenMetrics specification
allows them on counters, histograms and gauge histograms only, and there is no
sensible answer to "which request caused this gauge to read 7."

Now do the thing that misleads everybody. Ask Snip for its metrics the way you
have asked since Chapter 2, "What's Actually on the Wire":

```bash
curl -s http://localhost:8080/metrics | grep -c trace_id
```

```text
0
```

!!! trap "The `curl` that lies"
    Zero. The switches are on, the exemplars are being recorded, and the
    endpoint shows you none of them — because a bare `curl` sends
    `Accept: */*`, `promhttp` serves the classic text format, and the classic
    text format cannot carry an exemplar. Everyone who reaches this point
    concludes the feature is broken. Ask for a format that can carry them:

    ```bash
    curl -s -H 'Accept: application/openmetrics-text' \
      http://localhost:8080/metrics | grep -c trace_id
    ```

    That prints a small non-zero number. Content negotiation is doing exactly
    what it is designed to do, silently, and it looks identical to a bug.

The count is small on purpose. The client keeps **one exemplar per histogram
bucket**, and attaches each observation to the single bucket it falls into, not
to every cumulative bucket above it. Fifty requests across two routes produced
three exemplar lines on a freshly started Snip, not fifty. The number tracks how
many buckets have been touched, not how many requests you have served.

Here is one of those three, from a running Snip. It is one line on the wire,
wrapped here to fit the page:

```text
snip_http_request_duration_seconds_bucket{code="200",method="GET",
  route="/healthz",le="0.005"} 40 # {trace_id="37aabdb552cf30cb
  b02fe8add56c252b",span_id="f1c9d8eb5a2b51a0"} 8.8684e-05
  1.7934579734778378e+09
```

Everything after the `#` is the exemplar: a label set, the observed value in
seconds, and a timestamp. The series identity is still
`snip_http_request_duration_seconds_bucket{code="200",…,le="0.005"}`; the
exemplar is a rider on that one sample. One specification rule is worth
remembering: the combined length of an exemplar's label names and values must
not exceed 128 UTF-8 code points. A trace ID and a span ID fit comfortably. A
JSON blob does not.

The response header is the real tell, and it takes three values here:

| Request's `Accept` | Media type it comes back as |
|---|---|
| `*/*`, a bare `curl` | `text/plain; version=0.0.4` |
| `application/openmetrics-text` | `application/openmetrics-text; version=0.0.1` |
| the list Prometheus 3 sends | `application/openmetrics-text; version=1.0.0` |

Both OpenMetrics versions carry exemplars, so either works for debugging. You
get `1.0.0` only by asking for it, which Prometheus does: its default
`scrape_protocols` list, which Chapter 12, "prometheus.yml in Full", introduced,
puts `OpenMetricsText1.0.0` first. **The scraper has been asking for the right
format all along.** Your `curl` is the odd one out.

The bodies differ structurally too, and the differences are worth finding
yourself — the exercises ask you to diff them. One is load-bearing here: an
OpenMetrics body ends with a literal `# EOF`, so a truncated scrape is
detectable rather than merely short.

!!! trap "The server decides, not the client"
    Send that same OpenMetrics `Accept` header at a Snip running with
    `SNIP_OPENMETRICS=0` — which is every chapter before this one — and the
    response comes back `text/plain; version=0.0.4` anyway: classic text, no
    `# EOF`, no exemplars. `EnableOpenMetrics: false` means the handler never
    offers the format, so there is nothing to negotiate. Asking louder does not
    help. This is the first half of the two-switch failure, and it is invisible
    from Grafana.

## The server side, and the buffer nobody mentions

The second switch is on Prometheus, and it is still a feature flag in 3.13.1.
The `ch29` tag carries it in the `prometheus` command in `lab/compose.yaml`:

```yaml
command:
  - --config.file=/etc/prometheus/prometheus.yml
  - --storage.tsdb.path=/prometheus
  - --web.enable-lifecycle
  - --config.auto-reload
  - --web.enable-otlp-receiver
  - --enable-feature=exemplar-storage
  - --web.enable-admin-api
```

Without that flag Prometheus scrapes the exemplars and throws them away. It does
not warn you. The scrape succeeds, the series are correct, and the stars never
appear. With it, Prometheus says so once at startup and never again — one line,
wrapped here, with its leading `time=` stamp cut:

```text
level=INFO source=main.go:237 msg="Experimental in-memory exemplar
storage enabled"
```

Storage is not a time series. It is a **fixed-size in-memory circular buffer**
shared across all series, sized by `storage.exemplars.max_exemplars`, default
`100000`, and also appended to the write-ahead log so it survives a restart. Two
consequences follow, and both will save you an evening. Exemplars are
short-lived by design: once 100,000 newer ones have arrived the old ones are
gone, so **you cannot go exemplar-hunting in last week's data**, and a star
missing from yesterday is not a bug. And the cost is fixed and tiny — no series,
no labels, no per-request growth.

You need not take that on faith, because Prometheus measures its own buffer with
ordinary metrics. Query `prometheus_tsdb_exemplar_max_exemplars` and the lab
reads `100000`. Its three neighbours are the ones you diagnose with:
`prometheus_tsdb_exemplar_exemplars_in_storage`,
`prometheus_tsdb_exemplar_series_with_exemplars_in_storage` and
`prometheus_tsdb_exemplar_exemplars_appended_total`. On a base stack — the flag
on, the application switches off — all three read `0`, which is precisely what
"one switch of two" looks like from the server's side.

There is also a dedicated query endpoint, documented as experimental and
deliberately not part of `/api/v1/query`:

```bash
curl -sk -u obslab:obslab -G \
  --data-urlencode \
    'query=snip_http_request_duration_seconds_bucket' \
  --data-urlencode "start=$(($(date +%s) - 300))" \
  --data-urlencode "end=$(date +%s)" \
  'https://localhost:8443/prometheus/api/v1/query_exemplars' \
  | jq '.data[0].exemplars[0]'
```

```text
{
  "labels": {
    "span_id": "59925b397a9333b1",
    "trace_id": "0bd76e1b7e6e5a8495c5bf7e59c65b9c"
  },
  "value": "0.000129459",
  "timestamp": 1793458036.254
}
```

The identifiers and the value differ on your machine. What must be true is the
shape: a `labels` object holding `trace_id` and `span_id`, a `value` that is the
observed duration in seconds as a string, and a timestamp. The full response is
an array, one entry per series, each with a `seriesLabels` object naming the
series the exemplar rides on — which is why the `jq` reaches through `.data[0]`.

`"data": []` with `"status": "success"` means the endpoint works and stored
nothing: work backwards through the switches — handler, recording, feature flag
— because that is the order they fail in. An *error* rather than an empty array
means the flag is missing entirely.

## The star, and the one word that has to match

Grafana renders an exemplar as a highlighted star on the graph, and turns it
into a link if — and only if — it has been told which label carries the trace
ID. That is `exemplarTraceIdDestinations` on the *Prometheus* data source, not
the Tempo one, and `lab/provisioning/datasources/prometheus.yaml` has it:

```yaml
exemplarTraceIdDestinations:
  - name: trace_id
    datasourceUid: tempo
```

Both fields are load-bearing. `name` must equal the exemplar label key your
application emits. `datasourceUid` must equal the `uid` of a data source that
actually exists — which is why the same file declares a Tempo entry with exactly
that `uid`, pointed at `http://tempo:3200`.

On the panel side there are three more conditions, and all three produce silence
rather than an error. Exemplars are enabled **per query, not per panel** — a
toggle in the query editor. They render on **Time series panels only**. And
there is **no exemplar support for Instant queries at all**, so a Stat panel —
which is instant by construction — will never show one.

The `Latency quantiles` panel on the `Snip RED` dashboard already satisfies all
three. Open `http://localhost:3000/d/snip-red`; each of its three queries carries
`"exemplar": true` alongside `"range": true`, and the p99 one reads:

```promql
histogram_quantile(0.99, sum by (le) (
  rate(snip_http_request_duration_seconds_bucket{job=~"$job",
    route=~"$route"}[$__rate_interval])
))
```

Within a minute or two of `make signals-up`, stars appear scattered under the
quantile lines. Hover one: the tooltip lists `trace_id` and `span_id` with their
values, and offers a button to query Tempo with that ID.

!!! trap "One word, no error, a dead link"
    Now break it on purpose, the way a real team breaks it — by disagreeing
    about a name.

    ```bash
    SNIP_EXEMPLAR_LABEL=traceID make signals-up
    ```

    Wait a minute and reload the panel. **The stars are still there.** Hover one
    and the tooltip now reads `traceID`, and the button to open the trace is
    gone. No error banner, no red panel, nothing in Grafana's or Prometheus's
    logs, nothing on the target page. The data source was told to look for
    `trace_id`; the application emits `traceID`; Grafana finds no such field and
    renders a star with nothing behind it.

    On the wire the mismatch is plain once you look — and `span_id` is
    untouched, which is what lets the eye slide over it:

    ```text
    … le="0.005"} 21 # {span_id="2c5cc3f7ead76989",
      traceID="a90549b3d3c4c401b1fe462c05fbbee8"} 5.4195e-05 …
    ```

    This is the most common exemplar failure in the wild, and the discriminator
    is the tooltip: *stars with a key you did not configure*. Put it back with a
    plain `make signals-up`.

## The room behind the door

Click the button on a correctly configured star and Grafana opens Tempo with
your trace ID. Tempo answers that it has no such trace.

That is not a misconfiguration, and it is worth more to you than a working demo
would have been. **Nothing in this lab exports spans.** `lab/snip/api.go` mints
a W3C-shaped trace ID and span ID per request, reuses an inbound `traceparent`
header when there is one, and forwards `traceparent` on its outbound call to
`catalog`, so the identifiers are real and correctly propagated. But
`snip/go.mod` pins an OpenTelemetry *metrics* exporter only — the one Chapter
28, "OpenTelemetry and Prometheus", switched on for the worker. No span
exporter, therefore no spans. Tempo is up, healthy and empty, and says so:

```bash
curl -s 'http://localhost:3200/api/search?limit=5'
```

```text
{"traces":[],"metrics":{"completedJobs":3,"totalJobs":3}}
```

!!! warning "The lab stops one component short, on purpose"
    The exemplar half of this chapter is real and you can verify every step of
    it. The trace on the other end is not, because closing that last hop means
    adding a tracing SDK to Snip — a tracing tutorial, and a different book.
    Row X16 of the repository's `SPEC-DELTAS.md` says so in writing rather than
    hoping you do not notice.

    Learn the discriminator instead, because in production both failures are
    live at once. A **missing link button** means the label key does not match
    `exemplarTraceIdDestinations`. A **link button that opens an empty trace
    view** means the bridge is correct and the trace is not there — either
    nothing wrote it, or it aged out of the trace store's retention, which is a
    different retention from the exemplar buffer's.

There is a third way to end up starless, and it catches teams who did everything
else right. If you generate exemplars from an OpenTelemetry SDK rather than by
hand, the default exemplar filter is **`TraceBased`**: a measurement is eligible
to become an exemplar only if it was recorded inside a *sampled* span. Head
sampling at one trace in a hundred therefore discards 99% of your exemplars
before they are created, and your latency panel is nearly bare. The filter is
`OTEL_METRICS_EXEMPLAR_FILTER`, whose other values are `AlwaysOn` and
`AlwaysOff`. That is why `lab/compose.signals.yaml` sets
`OTEL_TRACES_SAMPLER: always_on`: at any realistic production sampling rate this
chapter would have nothing to show you. Sampling at 100% is a teaching decision,
not a recommendation.

## Traces and TraceQL, in one page

A trace is one request's path through your system, recorded as a tree of
**spans**. Each span has a name, a start and an end, a parent, and a bag of
attributes. The root span is the whole request; children are the database call,
the cache lookup, the outbound HTTP request to `catalog`. What a trace gives you
that a histogram cannot is *the causal chain*: not "the p99 is four seconds" but
"this request spent 3.8 of its 4 seconds inside one database call."

The reverse is the sentence to remember. **A trace describes one request and can
never tell you how often.** Ten traces are ten anecdotes. The rate, the ratio
and the error budget live in metrics, and computing them from a sampled trace
store is how people end up with numbers that disagree with their dashboards.

Tempo is Grafana's trace store, pinned here at `grafana/tempo:3.0.2`, and
`lab/tempo/tempo.yaml` is deliberately the smallest file that works: an OTLP
receiver on `4317` (gRPC) and `4318` (HTTP), and local disk for blocks and the
write-ahead log. What is *absent* from that file is the fastest way to date a
Tempo tutorial. Tempo 3.0 removed **ingesters**, **compactors** and the
**OpenCensus receiver**; a configuration still carrying an `ingester:` or
`compactor:` block will not start. It also removed the `local-blocks` processor,
which most surviving blog posts tell you to enable.

A healthy first start is noisy and none of it is a problem: four warnings — an
empty scheduler address, an empty worker address, `metrics-generator is not
configured`, and an ignored file during WAL replay — plus a repeating
backend-scheduler error reading `no jobs found`. Every one is a single-binary
Tempo configuring itself against an empty backend, and
`curl -s http://localhost:3200/ready` answers `ready` regardless.

Its query language is **TraceQL**, and it selects spans with curly braces:

```text
{ resource.service.name = "snip-api" && span:duration > 300ms }
```

Intrinsics — the fields every span has — use a colon: `span:duration`,
`span:name`, `span:status`. Attributes use a period and a scope: `span.`,
`resource.`, `event.`. Regexes are **fully anchored**, as PromQL selectors are.

The part with no PromQL equivalent is the **structural operators**, and they are
why traces are their own thing rather than a table of durations: `>>`
descendant, `<<` ancestor, `>` direct child, `<` direct parent, `~` sibling.

```text
{ span.http.route = "/l/{code}" } >> { span:status = error }
```

Read that as: find spans on the redirect route that have an erroring descendant
somewhere below them. There is no way to write it in PromQL, because PromQL has
no concept of one sample being inside another. That is the whole difference in
one line.

## Loki, in one page

Loki is the log store, pinned here at `grafana/loki:3.7.4`, and the single most
useful thing to know is that **it does not index your log lines.** It indexes
the *label set* of each stream, compresses the raw lines into chunks, and
brute-force greps those chunks at query time. The index is a table of contents,
not a search engine.

That one choice means Loki has **exactly the cardinality physics you already
understand**. A stream label with unbounded values creates one stream per value,
forever, as an unbounded Prometheus label creates one series per value. Chapter
7 transfers without modification, which is why `lab/alloy/config.alloy` attaches
a handful of bounded labels and not fourteen:

```text
rule {
  source_labels = [
    "__meta_docker_container_label_com_docker_compose_service",
  ]
  target_label = "service"
}
```

The set is `service`, `instance` and `env`, plus a `keep` rule on the Compose
project that stops Alloy tailing the rest of your laptop. `service` matches the
Compose service name, the same string Chapter 12's relabeling turns into the
`job` label, so a metric and a log line are joinable by eye; `instance` matches
Chapter 12's relabel exactly, `<service>-<number>`.

Look from the command line rather than from Grafana — the API answers the
question more precisely than a log panel does:

```bash
curl -s -G 'http://localhost:3100/loki/api/v1/series' \
  --data-urlencode 'match[]={service="catalog"}'
```

```text
{"status":"success","data":[{"instance":"catalog-1",
"service":"catalog","service_name":"catalog","env":"lab"}]}
```

One stream for `catalog`, and four labels on it rather than the three Alloy set:
Loki adds `service_name` itself. Ask for the label names and you get those four
and nothing else — `{"status":"success","data":["env","instance","service",
"service_name"]}`. Now ask Loki for a line and compare:

```text
{"stream":{"detected_level":"info","env":"lab",
"instance":"catalog-1","service":"catalog",
"service_name":"catalog"},"values":[["1793458233725273404",
"INFO:     172.19.0.13:56396 - \"GET /books/147519 ... 200 OK"]]}
```

`detected_level` is there on the entry and absent from the label-names list.
That is not an inconsistency — it is **structured metadata**, and it is the
answer to the question this section exists for.

So where does a trace ID go? Not in a stream label; that is the bomb again. Not,
ideally, regexed back out of the text either. Structured metadata is key/value
pairs attached to a log *entry*, indexed as neither label nor line, and queried
with an ordinary label filter and no parser:

```text
{service="catalog"} | detected_level="info"
```

That filter returns lines, with no parser stage anywhere in it, against a field
that is not a label. It costs you no streams. Structured metadata requires
schema v13, which is why `lab/loki/loki.yaml` pins both the schema and the
switch:

```yaml
limits_config:
  allow_structured_metadata: true
```

The limits are 64 KB of structured metadata and 128 entries per line, and the
intended contents are precisely the high-cardinality values you must filter on
and must never index: trace IDs, span IDs, container IDs, pod names, request
IDs. Grafana's Loki data source turns one into a clickable link through a
**derived field** with `matcherType: label`, which reads indexed labels, parsed
labels and structured metadata without touching the line at all. The lab does
not configure one, because Snip's own log lines carry no trace ID today — they
are plain `log.Printf` output. That is worth noticing: "we have logs and we have
traces" and "we can get from one to the other" are separated by exactly that one
field.

One last query, to run once and never again in production: `{service=~".+"} |=
"error"` asks for a full scan of every chunk in the store. On a laptop it
returns a line from Tempo's own logs. In production it is how you make an
on-call engineer wait four minutes.

## The names the ecosystem changed

A large fraction of what you will find online is not wrong so much as *expired*,
and most of the expiry is in the nouns. Learn these six and you can decode the
rest.

| Say this | Not this |
|---|---|
| Grafana Alloy | Grafana Agent, Promtail |
| Logs / Metrics Drilldown | Explore Logs, Explore Metrics |
| OBI (OTel eBPF Instrumentation) | Beyla, for the upstream project |
| `tracesToLogsV2` | `tracesToLogs` |
| structured metadata | "index the trace ID" |
| span / resource attributes | tags |

Two of those are removals rather than renames. **Promtail was removed in Loki
3.7.3** — gone, not deprecated, and Alloy is the shipper. Grafana Agent reached
end of life, and Alloy is its successor too. A post that installs either is
telling you its own age. The third is subtler: Grafana donated Beyla to
OpenTelemetry in 2025 and the upstream project is now OBI, but the name Beyla
survives as Grafana's downstream distribution, so "Beyla" in 2026 means
something narrower than it used to rather than nothing at all.

## Profiles and eBPF, briefly

**Continuous profiling** is the fourth shape. A trace tells you which span was
slow; a profile tells you which *function* burned the CPU or allocated the
memory while that span was running, by sampling stack traces continuously in
production at single-digit-percent overhead. Grafana's store for it is Pyroscope
(2.2.0 at the time of writing), and the bridge works conceptually like an
exemplar: `trace_id` and `span_id` ride along as pprof labels on profile
samples, so you can ask for the profile of one span. Be careful with dates. The
OpenTelemetry **profiles signal is Alpha**, its OTLP path is literally
`/v1development/profiles`, and OpenTelemetry's own material says it should not
be used for critical production workloads.

**eBPF** is the other direction: instrumentation with no code changes at all, by
attaching programs to kernel hooks and reading protocol traffic as it passes.
OBI produces RED metrics and spans for every service in every language, because
it works at the kernel rather than the library level. The honest framing, which
Grafana itself publishes: eBPF gets you broad coverage in minutes, and it cannot
see inside your business logic. It knows an HTTP request happened. It does not
know the tenant, the feature flag, or that this was the retry. Use it for
services nobody has instrumented, and an SDK for the ones you care about. The
deployment cost is real: Linux 5.8 or newer, kernel BTF support, and elevated
privileges.

## What is still moving

Three things in this book's subject matter are unfinished, and knowing which
saves you from being blindsided in six months.

**Remote Write 2.0** — Chapter 26, "When One Prometheus Isn't Enough", covered
the operational truth. The specification page is still headed experimental.
Treat 2.0 support as a compatibility question to test, not a version number to
assume.

**OpenMetrics 2.0** — released as `2.0.0-rc0` in March 2026 and explicitly
experimental. It matters to this chapter specifically: it makes exemplar
timestamps mandatory, allows multiple exemplars per sample, relaxes the
128-code-point cap to soft guidance, and relaxes OpenMetrics 1.0's `_total`
suffix rule from a MUST to a SHOULD to accommodate OpenTelemetry. Exposers must
still default to 1.0 unless 2.0 is explicitly negotiated, which is why the best
a scrape negotiates today is the `1.0.0` in that table.

**Profiles** — Alpha, as covered. And the OpenTelemetry Collector itself is
still `v0.x` at the distribution level; there is no Collector 1.0, and stability
is declared per component rather than for the whole thing.

## Keeping this current after the book ends

Prometheus ships a new minor release roughly **every six weeks**, and once the
next one starts the previous minor generally stops getting bugfixes. Alongside
that cadence Prometheus publishes a **Long Term Support** line, which keeps
receiving bug, security and documentation fixes for far longer. Check
`prometheus.io/download` for which release currently carries that badge: it
moves, and a number printed here would be wrong before you read it.

Then the rule that caught more errors in the building of this lab than any
other. **`/docs/.../latest/` documents the latest *release*. `main`-branch
documentation documents *unreleased* work.** A configuration key that appears in
one and not the other is not a key you have; it is a key somebody is building.
Copy from version-pinned URLs or git tags only. Appendix F states this as the
closing meta-rule for exactly this reason.

That rule also decides what to read next. The primary sources are the ones with
version numbers on them: the Prometheus release notes and `feature_flags.md` at
the tag you run, the OpenMetrics specification, the Grafana and Loki and Tempo
upgrade guides, and each client library's own CHANGELOG. For anything else, the
ten-second staleness test. Take any Prometheus or Grafana article and scan for
these; any single hit dates it:

- It installs **Promtail** or **Grafana Agent**. Removed and superseded.
- It enables Tempo's **`local-blocks`** processor, or configures an
  **`ingester:`** block. Both removed in Tempo 3.0.
- It says native histograms are experimental, or sets
  `--enable-feature=native-histograms`. Stable since Prometheus 3.8.0, and that
  flag has been a no-op since 3.9.
- It selects `le="1"`. Prometheus 3 normalizes `le` to float form; that selector
  matches nothing.
- It says "Explore Metrics" or "Explore Logs". Renamed to Drilldown.
- It calls the eBPF project Beyla without mentioning OBI. Upstream was donated
  and renamed in 2025.

Six tells, most articles hit at least one, and you now know why each one is
wrong rather than merely that it is.

## The final act

Everything in this repository was built one increment at a time, and the last
thing to prove is that it rebuilds itself. Throw it all away and bring it back:

```bash
make reset
git checkout ch29
make up
make signals-up
```

`make reset` removes every container and every named volume — the TSDB, the
Grafana database, the Postgres data, all of it. What comes back comes back from
files. Nothing you built lives only in a UI, which is the property the whole
book has been quietly enforcing.

`scripts/verify-ch29.sh` then re-runs every previous chapter's verify target in
sequence, which takes up to twenty-five minutes because it detonates the
cardinality bomb on the way through. Two things to do first.

A minutes-old stack has no history, so give it ten minutes of uptime and run
`make history` then `make backfill` before you start; otherwise the seventeen
Chapter 20 assertions that read recording rules have nothing to read. And bring
up *both* overlays, because `verify-ch26.sh` fails without the second Prometheus
and `verify-ch28.sh` fails without `SNIP_OTEL=1` on the worker — and because
running `make scale-up` after `make signals-up` recreates `snip-api` from the
base file and silently switches your exemplars back off:

```bash
SNIP_OTEL=1 docker compose -f compose.yaml \
  -f compose.scale.yaml -f compose.signals.yaml \
  up -d --build --scale snip-api=2
```

Then expect three honest failures and one skip. `ch04`, `ch06` and `ch07` wait
for files *you* write as those chapters' exercises and correctly fail on a fresh
clone; `ch27` is skipped unless you set `OBSLAB_K8S=1`. Treat the chain as an
audit rather than a pass/fail gate: it is long, it spans two overlays and a
backfill, and the useful output is *which* rung disagreed, which the script
prints as the expression that failed.

!!! selfcheck "Self-check"
    The exemplar assertions alone take about thirty seconds:

    ```bash
    SKIP_CHAIN=1 ./scripts/verify-ch29.sh
    ```

    It must print `PASS` for `tempo answers on …`, `loki answers on …` and
    `alloy answers on …`; for `/api/v1/query_exemplars answers`; for `at least
    one exemplar was stored`; for `at least one exemplar carries trace_id`; for
    `the data source declares exemplarTraceIdDestinations (trace_id)`; and for
    `snip serves the OpenMetrics exposition`.

    Two expected near-misses. Run it in the first seconds after
    `make signals-up` and the Loki check fails, because Loki's `/ready` answers
    `503` while its ring settles; wait and re-run. And if the `trace_id`
    assertion fails, the script prints the exemplar label keys it actually
    found — which is the `traceID` trap, diagnosed for you.

## Common mistakes

!!! pitfall "Concluding exemplars are broken because `curl` shows nothing"
    A bare `curl` negotiates the classic text format, which cannot carry an
    exemplar. You get a complete, correct, star-free exposition and no
    indication that anything was withheld. Add
    `-H 'Accept: application/openmetrics-text'` before you start debugging, and
    prefer `/api/v1/query_exemplars` over reading the endpoint by hand — it
    tells you what Prometheus actually stored, which is the question you have.

**Turning on one switch and not the other.** `EnableOpenMetrics: true` with no
`--enable-feature=exemplar-storage` means Prometheus scrapes exemplars and
discards them. The flag with no OpenMetrics handler means there is nothing to
scrape. Both look identical from Grafana: stars never appear, nothing logs
anything. Check the exposition first, then
`prometheus_tsdb_exemplar_exemplars_in_storage`; that order halves the search
space each time.

**Expecting a star where one cannot appear.** Gauges carry no exemplars — the
specification permits them on counters, histograms and gauge histograms, and a
gauge has no "the observation that caused this" to point at. Nor do Instant
queries, so a Stat panel, instant by construction, will never show one.

**Reading a dead link as a broken configuration.** Exemplars live in a
100,000-entry circular buffer; traces live under the trace store's own
retention. A link that leads nowhere may be perfectly configured and merely
pointing at something that has aged out. The tooltip distinguishes them: a
missing *button* is a configuration fault, a present button with an empty result
is a data fault.

**Making a Loki stream label out of something unbounded.** "Loki is cheap"
refers to storage, not to labels. A pod name, a request ID or a trace ID as a
stream label produces the same explosion as a Prometheus label, for the same
reason, with the same fix — structured metadata rather than a label.

## Summary

Metrics discarded request identity on purpose, and got a cost curve that does
not move with traffic in exchange. That single trade explains both why your
dashboards answered every question in this book and why they cannot answer
"which request". Traces answer it; logs say what the code said; profiles say
which function burned the CPU. None replaces a metric, because none is cheap
enough to alert on continuously. Between the metric and the trace sits the
exemplar: a rider on one sample of a counter or a bucket, carrying a trace ID,
creating no series and costing no cardinality. It is the sanctioned answer to
the instinct Chapter 7 forbade.

The things worth still knowing in six months:

- A trace ID is forbidden as a label and free as an exemplar. That sentence has
  not changed since Chapter 7 and will not.
- Exemplars need two switches — `EnableOpenMetrics` on the client and
  `--enable-feature=exemplar-storage` on the server — and each fails silently
  without the other.
- They ride only on OpenMetrics or protobuf, only on counters and histograms,
  only on range queries, only on time series panels. The server decides the
  format; an `Accept` header cannot talk a handler into offering one it was not
  built to offer.
- `exemplarTraceIdDestinations[].name` must equal the label key the application
  emits. `trace_id` versus `traceID` is a dead link with no error anywhere.
- Exemplars live in a fixed circular buffer, default 100,000 entries. They are
  for the incident you are in, not for archaeology.
- Loki indexes labels, not lines, so Prometheus cardinality discipline applies
  unchanged. Trace IDs belong in structured metadata.
- A trace tells you about one request and can never tell you how often.
- `/latest/` docs describe a release; `main` docs describe unreleased work.

## Exercises

!!! exercise
    **1. One switch at a time (warm-up).** With the overlay down —
    `make up` alone — the server flag is on and both application switches are
    off. Query `prometheus_tsdb_exemplar_exemplars_in_storage` and call
    `/api/v1/query_exemplars`, recording what each returns. Bring the overlay up
    and repeat both. Name the observable difference in one sentence.

    **2. Diff the two expositions (warm-up).** Save
    `curl -s http://localhost:8080/metrics` and the same request with
    `-H 'Accept: application/openmetrics-text'` to two files and diff them.
    Besides the exemplar suffixes, find three structural differences. Which line
    marks the end of an OpenMetrics body, and why does that line exist?

    **3. Range to Instant (core).** On the `Snip RED` dashboard, edit the
    `Latency quantiles` panel and switch one of its three queries from Range to
    Instant. Reload. Explain what happened to that query's stars using one
    sentence from this chapter, then switch it back.

    **4. Sample at one percent (core).** Snip has no sampler, so reason this one
    through. Given the default `TraceBased` exemplar filter, predict how many of
    1,200 requests would produce an exemplar at 1% head sampling. Then explain
    to a colleague, in two sentences, why `OTEL_TRACES_SAMPLER: always_on` in
    `compose.signals.yaml` is a teaching decision and not a recommendation.

    **5. Move a label to structured metadata (stretch).** Add a rule to
    `discovery.relabel "containers"` in `lab/alloy/config.alloy` that promotes
    `__meta_docker_container_id` to a stream label. Restart Alloy, then count
    the streams for `service="snip-api"` with the `/loki/api/v1/series`
    endpoint. Restart one `snip-api` container and count again. Remove the rule.
    Write down which chapter already told you what would happen, and what the
    correct home for that value is.

    **6. Date a blog post (stretch).** Find any Prometheus, Loki or Tempo
    article published before 2025 and date it in ten seconds using exactly one
    tell from the staleness list. Write down the tell, the claim it makes, and
    what is true instead. If the article survives all six, say so — such
    articles exist, and they are worth bookmarking.

!!! note "The exit exam"
    Run `./scripts/scenario-outage.sh` one more time. Then write the post-mortem
    you could not have written on page one: when it started, how many users were
    affected, what it cost against the error budget, which layer was
    responsible, which alert fired and how long it took to fire, and what you
    would change. Every one of those numbers now has a query behind it and a
    panel that shows it. That document, not the last page of this book, is the
    thing that tells you whether it worked.
