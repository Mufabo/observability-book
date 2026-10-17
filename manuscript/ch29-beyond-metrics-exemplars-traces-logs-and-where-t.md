# Chapter 29 — Beyond Metrics: Exemplars, Traces, Logs, and Where to Go Next

At 14:20 the p99 on the redirect path doubled. You know that because the panel
you built in Chapter 10, "Latency: Histograms Without Tears", says so, and
because the burn-rate alert from Chapter 21, "Burn Rates: Alerts That Don't Cry
Wolf", told you before the panel did. You know the error ratio did not move. You
know from Chapter 22, "Metrics From Things You Didn't Write", that the container
is not throttled and the database is not slow. You have twenty-eight chapters of
apparatus and it is all working exactly as designed.

Now answer this: *which requests were slow?*

Not how many. Not what proportion. Which ones. Show me one. Every query you have
learned returns another aggregate, because an aggregate is the only thing in the
building. `histogram_quantile` will hand you a number interpolated inside a
bucket; `topk` will rank routes; `sum by (instance)` will tell you it was both
replicas. None of them can produce a single request, because no single request
was ever stored. Snip incremented a counter and observed a duration, and
everything else about that request — which short code, which client, which
database call ate the time — was discarded at the moment of measurement.

That was not an oversight. It was the deal. This chapter is about what the deal
cost, about the one mechanism Prometheus provides for buying a small piece of it
back, and about the three other kinds of data that exist because of it.

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
a burn-rate ladder. Chapter 29 adds one overlay file and one Prometheus flag,
and turns on two switches that have been sitting at zero since Chapter 5. The
`ch29` tag carries all of it, to read along with; to add it yourself, check
out `ch28` instead.

```bash
cd lab
git checkout ch29
make check
make up
make signals-up
```

`make signals-up` brings up `compose.signals.yaml` alongside the base file:
Tempo on `3200`, Loki on `3100`, Alloy on `12345`. It also restarts `snip-api`
with `SNIP_OPENMETRICS=1` and `SNIP_EXEMPLARS=1`.

Two URLs changed earlier in the book and stay changed. Snip is behind `edge` at
`http://localhost:8080/` and has been since Chapter 12. Prometheus lost its
published port in Chapter 25 and now answers at
`https://localhost:8443/prometheus/` behind basic auth, user `obslab`, password
`obslab`. Grafana is still on `http://localhost:3000/`.

Give the load generator something steady to do:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","error_ratio":0}'
```

## The bargain metrics made

Chapter 7, "Labels, and the Cardinality Arithmetic You Must Do First",
taught the
arithmetic and Chapter 24 detonated it: every distinct combination of label
values is a separate time series, with its own memory in the head block, its own
index entries and its own query cost. That is why `snip_http_requests_total` has
exactly twelve series no matter how much traffic arrives, and why
`SNIP_UNBOUNDED_LABEL=1` — which adds the short code as a label — produced
thousands and kept climbing.

Turn that around and it stops being a limitation and becomes a design decision.
**A counter costs the same at ten requests per second as at a hundred thousand.**
The bill is set by the shape of your label sets, not by your traffic. That is an
extraordinary property, and nothing else in observability has it. Logs cost per
line. Traces cost per span. Metrics cost per *series*, and a series is something
you can count on a whiteboard before you ship.

The price of that property is paid in exactly one currency: **request identity is
discarded at write time.** When Snip observes `0.412` into the redirect
histogram, the value goes into the `le="0.5"` bucket and everything that made
that request distinguishable evaporates. No amount of cleverness later recovers
it, because it was never written down.

So there is a whole family of questions your dashboards cannot answer, and it is
worth being precise about which:

| Question | Why metrics cannot |
|---|---|
| Which customer saw the errors? | Customer ID is unbounded cardinality |
| Is it the same 2% failing each time? | A rate is a rate; identity is gone |
| Which downstream call ate the 4 s? | A bucket knows a count, not a chain |
| Which line of code burns the CPU? | Metrics have no stack |

The obvious fix is the wrong one, and Chapter 7 already named it. Putting
`trace_id` in a label would answer "which request" perfectly — and would be the
worst possible version of the cardinality bomb, one new series per request,
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
later restores what was never preserved. The proposed alternative is one wide,
structured event per unit of work — hundreds of fields, high cardinality, stored
columnar — from which both metrics and traces can be derived.

Take the critique seriously without concluding that Prometheus is obsolete,
because it is not, for four reasons the last twenty-eight chapters have
demonstrated. Metrics are the only signal with a bounded cost curve. Metrics
are the right substrate for alerting, because alert rules need cheap, continuous
evaluation over long windows and you do not want to page by scanning an event
store. Metrics work where there is no request at all — disk fullness,
certificate expiry, queue depth, batch jobs, `up`. And Majors' own framing
concedes the split: the model works for infrastructure and hurts for
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

Exemplars fail silently, in both directions, and the reason is that they need
two independent switches thrown — one in your application, one on the server —
and neither one complains about the other.

The application switch is the exposition format. Exemplars ride on **OpenMetrics
text** (or protobuf). The classic Prometheus text format has nowhere to put
them; it is not a matter of Prometheus ignoring them, the syntax does not exist.
In Go's `client_golang` that means one field on the handler, and you can read it
in `lab/snip/main.go`:

```go
return promhttp.HandlerFor(prometheus.DefaultGatherer,
    promhttp.HandlerOpts{
        // OpenMetrics is what carries exemplars. Both are off by
        // default and chapter 29 turns them on together.
        EnableOpenMetrics: c.OpenMetrics,
        ErrorHandling:     promhttp.ContinueOnError,
    })
```

The second half is recording them. `lab/snip/api.go` attaches an exemplar to
every observation of `snip_http_request_duration_seconds` — and to nothing else,
because the counter would tell you nothing a bucket does not:

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

`c.ExemplarLabel` defaults to `trace_id` and `exemplarSpanID` is `span_id`.
Those are the W3C-aligned names, and they are what Grafana's trace linking
expects. If you go looking at the official `client_golang` exemplar example you
will find it uses a key called `dummyID`, because it is demonstrating the API
rather than a real pipeline. Copying that key is a mistake with no error message
attached to it, and you will meet it again shortly.

Underneath, the same file also shows you the two raw APIs, which you will need
if you are not using the `promhttp` middleware: a histogram carrying exemplars
is asserted to `prometheus.ExemplarObserver` and observed with
`ObserveWithExemplar(value, labels)`; a counter is asserted to
`prometheus.ExemplarAdder` and incremented with `AddWithExemplar(delta, labels)`.
There is no third form. **Gauges cannot carry exemplars** — the OpenMetrics spec
allows them on counters, histograms and gauge histograms only, and there is no
sensible answer to "which request caused this gauge to read 7."

Now do the thing that misleads everybody. Ask Snip for its metrics the way you
have asked since Chapter 2:

```bash
curl -s http://localhost:8080/metrics | grep -c trace_id
```

```text
0
```

!!! trap "The `curl` that lies"
    Zero. Nothing. The switches are on, the exemplars are being recorded, and
    the endpoint shows you none of them — because a bare `curl` sends
    `Accept: */*`, `promhttp` picks the classic text format, and the classic
    text format cannot carry an exemplar. Every beginner who reaches this point
    concludes the feature is broken. Ask for the format that can carry them:

    ```bash
    curl -s -H 'Accept: application/openmetrics-text' \
      http://localhost:8080/metrics | grep -c trace_id
    ```

    That prints a non-zero count. The client keeps the most recent exemplar
    per histogram bucket, so the number tracks how many buckets have seen an
    observation, not how many requests you have served. Content negotiation is
    doing exactly what it is designed to do, silently, and it looks identical
    to a bug.

With the right header, the exposition lines gain a suffix. The shape, straight
from the OpenMetrics specification, is a hash, then a label set, then the
observed value, then an optional timestamp:

```text
foo_bucket{le="1"} 11 # {trace_id="KOO5S4vxi0o"} 0.67
```

Everything after the `#` is the exemplar. It is not a label on the series — the
series identity is still `foo_bucket{le="1"}` — it is a rider attached to that
one sample. One more spec rule worth remembering: the combined length of an
exemplar's label names and values must not exceed 128 UTF-8 code points. A trace
ID and a span ID fit comfortably. A JSON blob does not.

## The server side, and the buffer nobody mentions

The second switch is on Prometheus, and it is still a feature flag in 3.13.1.
The `ch29` tag adds it to the `prometheus` command in `lab/compose.yaml`; if
you are recreating from `ch28`, add the one line yourself and run `make up`:

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

Without `--enable-feature=exemplar-storage`, Prometheus scrapes the exemplars
and throws them away. It does not warn you. The scrape succeeds, the series are
correct, and the stars never appear.

Storage is not a time series. It is a **fixed-size in-memory circular buffer**
shared across all series, sized by `storage.exemplars.max_exemplars`, default
`100000`, and also appended to the write-ahead log so it survives a restart. The
lab does not change the default. Two consequences follow, and both will save you
an evening:

- Exemplars are short-lived by design. Once 100,000 newer ones have arrived, the
  old ones are gone. **You cannot go exemplar-hunting in last week's data.** If
  the star you want is from yesterday, it does not exist any more, and that is
  not a bug.
- The cost is fixed and tiny. This is the payoff of the whole design: turning
  exemplars on adds no series, no labels and no per-request growth. A hundred
  thousand exemplars, and then it recycles.

There is a dedicated query endpoint, documented as experimental and deliberately
not part of `/api/v1/query`:

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
    "span_id": "4c1e0f2a9b73d5e8",
    "trace_id": "9f2c7a1e5b3d84600af1c29d7e5b3a41"
  },
  "value": "0.0412",
  "timestamp": 1789430445.117
}
```

The exact ids and value will differ on your machine. What must be true is the
shape: a `labels` object holding `trace_id` and `span_id`, a `value` that is the
observed duration in seconds, and a timestamp. If `.data` is an empty array,
work backwards through the switches — handler, recording, feature flag — in that
order, because that is the order they fail in.

## The star, and the one word that has to match

Grafana renders an exemplar as a highlighted star on the graph, and turns it
into a link if — and only if — it has been told which label carries the trace
ID. That is `exemplarTraceIdDestinations` on the *Prometheus* data source, not
the Tempo one, and `lab/provisioning/datasources/prometheus.yaml` already has
it:

```yaml
exemplarTraceIdDestinations:
  - name: trace_id
    datasourceUid: tempo
```

Two fields, and both are load-bearing in different ways. `name` must equal the
exemplar label key your application emits. `datasourceUid` must equal the `uid`
of a data source that actually exists — which is why the same file declares one:

```yaml
- name: Tempo
  type: tempo
  uid: tempo
  access: proxy
  url: http://tempo:3200
```

On the panel side there are three more conditions, and all three are the kind
that produce silence rather than an error. Exemplars are enabled **per query,
not per panel** — a toggle in the query editor. They render on **Time series
panels only**. And there is **no exemplar support for Instant queries at all**,
so a Stat panel — which is instant by construction — will never show one.

The lab's `Latency quantiles` panel on the `Snip RED` dashboard already
satisfies all three. Open `http://localhost:3000/d/snip-red`, and each of its
three queries carries `"exemplar": true` with `"range": true`:

```promql
histogram_quantile(0.99, sum by (le) (
  rate(snip_http_request_duration_seconds_bucket{job=~"$job",
    route=~"$route"}[$__rate_interval])
))
```

Within a minute or two of `make signals-up`, magenta stars appear scattered
under the quantile lines. Hover one: the tooltip lists `trace_id` and `span_id`
with their values, and offers a button to query Tempo with that ID.

!!! trap "One character, no error, a dead link"
    Now break it on purpose, the way a real team breaks it — by disagreeing
    about a name.

    ```bash
    SNIP_EXEMPLAR_LABEL=traceID make signals-up
    ```

    Wait a minute and reload the panel. **The stars are still there.** Hover
    one and the tooltip now reads `traceID` instead of `trace_id` — and the
    button to open the trace is gone. No error banner. No red panel. Nothing in
    Grafana's logs, nothing in Prometheus's logs, nothing on the target page.
    The data source was told to look for a field called `trace_id`; the
    application is emitting one called `traceID`; Grafana finds no such field
    and quietly renders a star with nothing behind it.

    This is the single most common exemplar failure in the wild, and the
    discriminator is the tooltip: *stars with a key you did not configure*.
    Confirm it from the command line too — re-run the `query_exemplars` call
    and look at the label keys. Then put it back:

    ```bash
    make signals-up
    ```

## The room behind the door

Click the button on a correctly configured star and Grafana opens Tempo with
your trace ID. Tempo answers that it has no such trace.

That is not a misconfiguration, and it is worth more to you than a working demo
would have been. **Nothing in this lab exports spans.** `snip/api.go` mints a
W3C-shaped trace ID and span ID per request, reuses an inbound `traceparent`
header when one is present, and forwards `traceparent` on its outbound call to
`catalog` — so the identifiers are real, consistent and correctly propagated.
But there is no tracing SDK in `snip/go.mod`, no span exporter, and therefore no
spans. Tempo is up, healthy, correctly wired and completely empty.

!!! warning "The lab stops one component short, on purpose"
    The exemplar half of this chapter is real and you can verify every step of
    it. The trace on the other end is not, because closing that last hop means
    adding a tracing SDK to Snip, which is a tracing tutorial and a different
    book. The comments in `compose.signals.yaml` and row X16 of the repository's
    `SPEC-DELTAS.md` say so in writing rather than hoping you do not notice.

    Learn the discriminator instead, because you will need it in production
    where both failures are live at once. A **missing link button** means the
    label key does not match `exemplarTraceIdDestinations`. A **link button
    that opens an empty trace view** means the bridge is correct and the trace
    is not there — either nothing wrote it, or it aged out of the trace store's
    retention, which is a different retention from the exemplar buffer's.

There is a third way to end up starless, and it catches teams who did everything
else right. If you generate exemplars from an OpenTelemetry SDK rather than by
hand, the default exemplar filter is **`TraceBased`**: a measurement is only
eligible to become an exemplar if it was recorded inside a *sampled* span.
Deciding at the start of a request to keep one trace in a hundred — head
sampling — therefore discards 99% of your exemplars before they are created,
and your latency panel is almost bare. The filter is controlled by
`OTEL_METRICS_EXEMPLAR_FILTER`, whose other values are `AlwaysOn` and
`AlwaysOff`. This is why `compose.signals.yaml` sets
`OTEL_TRACES_SAMPLER: always_on` — at any realistic production sampling rate
this chapter would have nothing to show you. Sampling at 100% is a teaching
decision, not a recommendation.

## Traces and TraceQL, in one page

A trace is one request's path through your system, recorded as a tree of
**spans**. Each span has a name, a start and an end, a parent, and a bag of
attributes. The root span is the whole request; children are the database call,
the cache lookup, the outbound HTTP request to `catalog`. What a trace gives you
that a histogram cannot is *the causal chain*: not "the p99 is four seconds" but
"this request spent 3.8 of its 4 seconds waiting on one `select_link`."

The reverse is equally true, and it is the sentence to remember. **A trace
describes one request and can never tell you how often.** Ten traces are ten
anecdotes. The rate, the ratio and the error budget all live in metrics, and
trying to compute them from a sampled trace store is how people end up with
numbers that disagree with their own dashboards.

Tempo is Grafana's trace store, pinned in this lab at `grafana/tempo:3.0.2`, and
`lab/tempo/tempo.yaml` is deliberately the smallest file that works: an OTLP
receiver on `4317` (gRPC) and `4318` (HTTP), and local disk for blocks and the
write-ahead log. Three absences in that file are the fastest way to date a Tempo
tutorial. Tempo 3.0 removed **ingesters**, removed **compactors**, and removed
the **OpenCensus receiver**; a configuration that still carries an `ingester:`
or `compactor:` block will not start. It also removed the `local-blocks`
processor, which most surviving blog posts tell you to enable.

Its query language is **TraceQL**, and it selects spans with curly braces:

```text
{ resource.service.name = "snip-api" && span:duration > 300ms }
```

Intrinsics — the fields every span has — use a colon: `span:duration`,
`span:name`, `span:status`, `trace:duration`, `trace:rootService`. Attributes
use a period and a scope: `span.`, `resource.`, `event.`. Regexes are **fully
anchored**, like PromQL selectors.

The part with no PromQL equivalent at all is the **structural operators**, and
they are the reason traces are their own thing rather than a table of durations:
`>>` descendant, `<<` ancestor, `>` direct child, `<` direct parent, `~` sibling.

```text
{ span.http.route = "/l/{code}" } >> { span:status = error }
```

Read that as: find spans on the redirect route that have an erroring descendant
somewhere below them. There is no way to write that in PromQL, because PromQL
has no concept of one sample being inside another. That is the whole difference
in one line.

## Loki, in one page

Loki is the log store, pinned here at `grafana/loki:3.7.4`, and the single most
useful thing to know about it is that **it does not index your log lines.** It
indexes the *label set* of each stream, compresses the raw lines into chunks,
and brute-force greps those chunks at query time. The index is a table of
contents, not a search engine.

That one design choice means Loki has **exactly the cardinality physics you
already understand**. A stream label with unbounded values creates one stream per
value, forever, in the same way an unbounded Prometheus label creates one series
per value. Everything Chapter 7 taught transfers without modification, which is
why `lab/alloy/config.alloy` attaches four labels to a container's logs and not
fourteen:

```text
rule {
  source_labels = [
    "__meta_docker_container_label_com_docker_compose_service",
  ]
  target_label = "service"
}
```

The four are `service`, `instance`, `env` and the Compose project filter that
keeps the rest of your laptop out of the lab. `service` deliberately matches the
Compose service name, which is the same string Chapter 12's relabeling turns
into the `job` label — so a metric and a log line are joinable by eye.

Go and look. In Grafana, query Loki for `{service="snip-api"}` and you get
Snip's stdout. Change it to `{service=~".+"} |= "error"` and you have asked for
a full scan of every chunk in the store; on a laptop it returns, and in
production it is how you make an on-call engineer wait four minutes.

So where does a trace ID go? Not in a stream label — that is the bomb again.
Not, ideally, regexed back out of the text either. The correct home is
**structured metadata**: key/value pairs attached to a log *entry*, indexed as
neither label nor line, queryable with an ordinary label filter and no parser.
It requires schema v13, which is why `lab/loki/loki.yaml` pins both:

```yaml
limits_config:
  allow_structured_metadata: true
```

The limits are 64 KB of structured metadata and 128 entries per line, and the
intended contents are precisely the high-cardinality values you must filter on
and must never index: trace IDs, span IDs, container IDs, pod names, request
IDs. Grafana's Loki data source then turns one into a clickable link through a
**derived field** with `matcherType: label`, which reads indexed labels, parsed
labels and structured metadata without touching the line at all.

Snip's own log lines carry no trace ID today — they are plain `log.Printf`
output, which is worth noticing, because "we have logs and we have traces" and
"we can get from one to the other" are separated by exactly that one field.

## The names the ecosystem changed

A large fraction of what you will find online is not wrong so much as *expired*,
and most of the expiry is in the nouns. Learn these six and you will decode the
rest.

| Say this | Not this |
|---|---|
| Grafana Alloy | Grafana Agent, Promtail |
| Logs / Metrics Drilldown | Explore Logs, Explore Metrics |
| OBI (OTel eBPF Instrumentation) | Beyla |
| `tracesToLogsV2` | `tracesToLogs` |
| structured metadata | "index the trace ID" |
| span / resource attributes | tags |

Two of those are not renames but removals. **Promtail was removed in Loki
3.7.3** — it is gone, not deprecated, and Alloy is the shipper. And Grafana
Agent reached end of life; Alloy is its successor as well. A post that installs
Promtail is telling you its own age.

## Profiles and eBPF, briefly

**Continuous profiling** is the fourth shape. A trace tells you which span was
slow; a profile tells you which *function* burned the CPU or allocated the
memory while that span was running, by sampling stack traces continuously in
production at single-digit-percent overhead. Grafana's store for it is Pyroscope
(2.2.0 at the time of writing), and the bridge to traces works exactly like
exemplars conceptually: `trace_id` and `span_id` are attached to profile samples
as pprof labels, so you can ask for the profile of one span. Be careful with
dates here: the OpenTelemetry **profiles signal is Alpha**, its OTLP path is
literally `/v1development/profiles`, and OpenTelemetry's own blog says it should
not be used for critical production workloads. Anything claiming it is GA is
ahead of the primary sources.

**eBPF** is the other direction: instrumentation with no code changes at all,
by attaching programs to kernel hooks and reading protocol traffic as it passes.
OBI — OpenTelemetry eBPF Instrumentation, v0.10.0, the project formerly called
Grafana Beyla and donated to OpenTelemetry in 2025 — produces RED metrics and
spans for every service in every language, because it works at the kernel rather
than the library level. The honest framing, which Grafana itself publishes: eBPF
gets you roughly 80% coverage in five minutes with zero code changes, and it
cannot see inside your business logic. It knows an HTTP request happened. It
does not know the tenant, the feature flag, or that this was the retry. Use it
for baseline coverage of services nobody has instrumented, and an SDK for the
ones you care about. The deployment cost is real: Linux 5.8 or newer, kernel BTF
support, amd64 or arm64, and root or specific capabilities.

## What is still moving

Three things in this book's subject matter are unfinished, and knowing which
saves you from being blindsided.

**Remote Write 2.0** — Chapter 26 covered the operational truth. The spec page
is still headed experimental. Treat 2.0 support as a compatibility question to
test, not a version number to assume.

**OpenMetrics 2.0** — released as `2.0.0-rc0` in March 2026 and explicitly
experimental, with breaking changes still possible. It matters to this chapter
specifically: it makes exemplar timestamps mandatory, allows multiple exemplars
per sample, and relaxes the 128-code-point cap to soft guidance. It also relaxes
OpenMetrics 1.0's `_total` suffix rule from a MUST to a SHOULD, to accommodate
OpenTelemetry. Exposers must still default to 1.0 unless 2.0 is explicitly
negotiated.

**Profiles** — Alpha, as covered. And the OpenTelemetry Collector itself is
still `v0.x` at the distribution level; there is no Collector 1.0, and stability
is declared per component, not for the whole thing.

## Keeping this current after the book ends

Prometheus ships a new minor release roughly **every six weeks**, and once the
next one starts the previous minor generally stops getting bugfixes. Alongside
that cadence, Prometheus publishes a **Long Term Support** line, which keeps
receiving bug, security and documentation fixes for far longer. Check
`prometheus.io/download` for which release currently carries that badge: it
moves, and a number printed here would be wrong before you read it.

Then there is the rule that caught more errors in the writing of this book than
any other, and it is worth more to you than any version number. **`/docs/.../latest/`
documents the latest *release*. `main`-branch documentation documents
*unreleased* work.** A configuration key that appears in one and not the other is
not a key you have; it is a key somebody is building. Cite and copy from
version-pinned URLs or git tags only. Appendix F states this as the book's
closing meta-rule for exactly this reason.

Finally, the ten-second staleness test. Take any Prometheus or Grafana article
and scan for these. Any single hit dates it:

- It installs **Promtail** or **Grafana Agent**. Removed and superseded.
- It enables Tempo's **`local-blocks`** processor, or configures an
  **`ingester:`** block. Both removed in Tempo 3.0.
- It says native histograms are experimental, or sets
  `--enable-feature=native-histograms`. Stable since Prometheus 3.8.0, and that
  flag has been a no-op since 3.9.
- It selects `le="1"`. Prometheus 3 normalizes `le` to float form; that selector
  matches nothing.
- It says "Explore Metrics" or "Explore Logs". Renamed to Drilldown.
- It says "Grafana Beyla". Donated and renamed to OBI.

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
files: `prometheus.yml`, the rule files, the provisioned data sources, the four
dashboards, the Alertmanager tree, the SLO definitions. Nothing you built lives
only in a UI, which is the property the whole book has been quietly enforcing.

!!! selfcheck "Self-check"
    First, the exemplar assertions alone, which take about thirty seconds:

    ```bash
    SKIP_CHAIN=1 ./scripts/verify-ch29.sh
    ```

    It must print `PASS` lines for `tempo`, `loki` and `alloy` answering, for
    `/api/v1/query_exemplars answers`, for `at least one exemplar was stored`,
    for `at least one exemplar carries trace_id`, and for `the data source
    declares exemplarTraceIdDestinations (trace_id)`. If the three readiness
    checks fail with `no reply`, the overlay is down: run `make signals-up`.
    If the `trace_id` assertion fails, the script prints the label keys it
    actually found — which is the `traceID` trap, diagnosed for you.

    Then the chain. `./scripts/verify-ch29.sh` with no `SKIP_CHAIN` re-runs
    every previous chapter's verify target in sequence and takes up to
    twenty-five minutes, because it detonates the cardinality bomb on the way
    through. Expect failures, and expect them to be these. `ch04`, `ch06` and
    `ch07` wait for files *you* write as those chapters' exercises, and
    correctly fail on a fresh clone. `ch27` is skipped unless you set
    `OBSLAB_K8S=1`. Every other chapter's checker must pass; the defects the
    lab's own verification found in five of them — `ch10`, `ch13`, `ch14`,
    `ch22` and `ch24` — have been fixed in the scripts. A chapter failing for
    a reason outside that list is a real regression, and the script prints
    the expression that disagreed.

## Common mistakes

!!! pitfall "Concluding exemplars are broken because `curl` shows nothing"
    A bare `curl` negotiates the classic text format, which cannot carry an
    exemplar. You get a complete, correct, star-free exposition and no
    indication that anything was withheld. Always add
    `-H 'Accept: application/openmetrics-text'` before you start debugging, and
    prefer `/api/v1/query_exemplars` over reading the endpoint by hand — it
    tells you what Prometheus actually stored, which is the question you have.

**Turning on one switch and not the other.** `EnableOpenMetrics: true` with no
`--enable-feature=exemplar-storage` means Prometheus scrapes exemplars and
discards them. The flag with no OpenMetrics handler means there is nothing to
scrape. Both failures look identical from Grafana: stars never appear, nothing
logs anything. Check the exposition first, then the flag; that order halves the
search space each time.

**Putting exemplars on a gauge.** The spec permits them on counters, histograms
and gauge histograms. A gauge has no "the observation that caused this", so
there is nothing for an exemplar to point at. Client libraries will not offer
you the method.

**Expecting a star on a Stat panel.** There is no exemplar support for Instant
queries, and a Stat panel is instant by construction. Same for the old Graph
panel. Time series panels running range queries, with the per-query exemplar
toggle on — all three, every time.

**Reading a dead link as a broken configuration.** Exemplars live in a 100,000
entry circular buffer; traces live under the trace store's own retention. A link
that leads nowhere may be perfectly configured and merely pointing at something
that has aged out. Distinguish it by the tooltip: a missing *button* is a
configuration fault, a present button with an empty result is a data fault.

**Making a Loki stream label out of something unbounded.** "Loki is cheap"
refers to storage, not to labels. A pod name, a request ID or a trace ID as a
stream label produces the same explosion as a Prometheus label, for the same
reason, with the same fix — structured metadata rather than a label.

## Summary

Metrics discarded request identity on purpose, and got a cost curve that does
not move with traffic in exchange. That single trade explains both why your
dashboards answered every question in this book and why they cannot answer
"which request". Traces answer it. Logs say what the code said. Profiles say
which function burned the CPU. None of them replaces a metric, because none of
them is cheap enough to alert on continuously, and metrics remain the only
signal that works where there is no request at all.

Between the metric and the trace sits the exemplar: a rider on one sample of a
counter or a bucket, carrying a trace ID, creating no series and costing no
cardinality. It is the sanctioned answer to the instinct Chapter 7 forbade.

The things worth still knowing in six months:

- A trace ID is forbidden as a label and free as an exemplar. That sentence has
  not changed since Chapter 7 and will not.
- Exemplars need two switches — `EnableOpenMetrics` on the client and
  `--enable-feature=exemplar-storage` on the server — and each fails silently
  without the other.
- They ride only on OpenMetrics or protobuf, only on counters and histograms,
  only on range queries, only on time series panels.
- `exemplarTraceIdDestinations[].name` must equal the label key the application
  emits. `trace_id` versus `traceID` is a dead link with no error anywhere.
- Exemplars live in a fixed circular buffer, default 100,000 entries. They are
  for the incident you are in, not for archaeology.
- Loki indexes labels, not lines, so Prometheus cardinality discipline applies
  unchanged. Trace IDs belong in structured metadata.
- A trace tells you about one request and can never tell you how often. Compute
  rates from metrics.
- `/latest/` docs describe a release; `main` docs describe unreleased work.
  Cite version-pinned URLs.

## Exercises

!!! exercise
    **1. One switch at a time (warm-up).** Set `SNIP_OPENMETRICS=0` in `.env`,
    leave `--enable-feature=exemplar-storage` alone, and run `make signals-up`.
    Wait two minutes, then run `SKIP_CHAIN=1 ./scripts/verify-ch29.sh` and
    record which assertion fails and what it prints. Put it back, then do the
    reverse: remove the feature flag from the `prometheus` service in
    `compose.yaml`, recreate it, and record the failure. Write one sentence
    naming the observable difference between the two, or state that there is
    none.

    **2. Diff the two expositions (warm-up).** Save
    `curl -s http://localhost:8080/metrics` and
    `curl -s -H 'Accept: application/openmetrics-text'
    http://localhost:8080/metrics` to two files and diff them. Besides the
    exemplar suffixes, find two other structural differences between the
    formats. Which line marks the end of an OpenMetrics body?

    **3. Range to Instant (core).** On the `Snip RED` dashboard, edit the
    `Latency quantiles` panel and switch one of its three queries from Range to
    Instant. Reload. Explain what happened to that query's stars using one
    sentence from this chapter, then switch it back.

    **4. Sample at one percent (core).** You cannot change Snip's sampler — it
    has none — so reason it through instead and then check yourself. Given the
    default `TraceBased` exemplar filter, predict how many of 1,200 requests
    would produce an exemplar at 1% head sampling. Then explain to a colleague,
    in two sentences, why `OTEL_TRACES_SAMPLER: always_on` in
    `compose.signals.yaml` is a teaching decision rather than a
    recommendation.

    **5. Move a label to structured metadata (stretch).** Add a fifth rule to
    `discovery.relabel "containers"` in `lab/alloy/config.alloy` that promotes
    `__meta_docker_container_id` to a stream label. Restart Alloy, then query
    Loki's `/loki/api/v1/index/volume` endpoint or the label browser and count
    the streams for `service="snip-api"`. Restart one snip-api container and
    count again. Remove the rule. Write down which chapter of this book already
    told you what would happen, and what the correct home for that value is.

    **6. Date a blog post (stretch).** Find any Prometheus, Loki or Tempo
    article published before 2025 and date it in ten seconds using exactly one
    tell from the staleness list. Write down the tell, the claim it makes, and
    what is true instead. If the article survives all six, say so — they exist,
    and they are worth bookmarking.

!!! note "The exit exam"
    Run `./scripts/scenario-outage.sh` one more time. Then write the
    post-mortem you could not have written on page one: when it started, how
    many users were affected, what it cost against the error budget, which
    layer was responsible, which alert fired and how long it took to fire, and
    what you would change. Every one of those numbers now has a query behind it
    and a panel that shows it. That document, not the last page of this book,
    is the thing that tells you whether it worked.
