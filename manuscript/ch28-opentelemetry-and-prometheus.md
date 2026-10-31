# Chapter 28 — OpenTelemetry and Prometheus

A colleague hands you a service. It is instrumented, they say, and the
metrics are already in Prometheus. You open the Query page, type the name
they gave you — `http.server.request.duration` — and get a parse error.
You try again without the dots and find
`http_server_request_duration_seconds_bucket`, which nobody wrote and
which is now the name in your alert rules forever. There is a metric
called `target_info` that you did not create and cannot explain. The
`instance` label is a string of hexadecimal that matches nothing else in
the database. And `up` for that service does not exist at all, so the
question you have been able to answer since your first scrape — is it
still there? — has no answer.

Nothing is broken. This is what OpenTelemetry metrics look like after
they land in Prometheus, and every one of those surprises is a
documented, deterministic translation rule. The rules are invisible until
they have already rewritten your metric names, and by then they are in
your dashboards.

So run the translation on your own machine, on a service you already
know. `snip-worker` has been exporting four metric families through
`client_golang` since you instrumented it. You are going to re-point it
at the OpenTelemetry SDK, push the same four families into Prometheus's
own receiver, and go and look at what arrived — and then answer the
question the whole chapter exists for: should you do this on purpose?

!!! objectives "Objectives"
    After this chapter you can:

    - Name the three ways OpenTelemetry metrics reach Prometheus and
      choose between them for a given team.
    - Predict what the default translation does to a dotted metric name
      and a UCUM unit, before you look.
    - Find your resource attributes after ingestion and promote the two
      that matter.
    - Explain why delta temporality is a data-loss path, and tell the
      loud version from the silent one.
    - State what OTLP ingestion costs on every series, and what it does
      not cost.
    - Say why native client libraries, and not the OTel SDK,
      instrumented every service you own up to this point.

## Where the lab is

This runs against the base stack as Chapter 26, "When One Prometheus
Isn't Enough: HA, `remote_write`, and the Scaling Map", left it. Chapter
26's second Prometheus lives in an overlay file, and Chapter 27,
"Optional: What Changes on Kubernetes", never touches `compose.yaml` at
all, so neither is needed here. The `ch28` tag carries the OpenTelemetry
recorder in `lab/snip/otelmetrics.go`, the receiver flag and the `otlp:`
block; to add the server side yourself, check out `ch27` instead.

```bash
cd lab
git checkout ch28
make check
make up
make ps
```

Since Chapter 25, "Storage, Retention, Backups and Locking the Door",
Prometheus has had no published host port. It answers at
`https://localhost:8443/prometheus/` through `edge`, with the basic-auth
credential `obslab` / `obslab` and a certificate from Caddy's own
authority — which is why every `curl` here carries `-k`. The worker's
metrics endpoint is still `http://localhost:8090/metrics` and the load
generator's control API is still `http://localhost:8089/`.

Put the traffic into a steady state, because the analytics queue only has
work when redirects are happening:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","error_ratio":0}'
```

## Three roads into the same database

OpenTelemetry and Prometheus are not competitors, and reading them as
competitors is what makes this subject confusing. OpenTelemetry is an
instrumentation API, an SDK and a wire protocol. It has no metrics
database and no query language. Prometheus is a database, a query
language and a collector. It has no tracing. The two overlap on exactly
one thing — getting measurements out of a process — and every difficulty
in this chapter lives in that overlap.

There are three ways to bridge it. Read the diagram as three different
answers to "who initiates the transfer".

```text
(A) your code ─OTel SDK─▶ Prometheus exporter ─/metrics─▶ scrape
(B) your code ─OTel SDK─▶ OTLP POST ─▶ /api/v1/otlp/v1/metrics
(C) your code ─OTel SDK─▶ Collector ─▶ remote write, or /metrics
```

In (A) Prometheus still pulls, and everything you know still applies. In
(B) and (C) something else pushes, and the parts of Prometheus that
depend on pulling stop working.

**Path A** keeps the OTel SDK in your code and bolts a Prometheus
exposition endpoint onto it. In Go that is
`go.opentelemetry.io/otel/exporters/prometheus`, currently **v0.66.0**.
Note the leading zero: the metrics SDK itself
(`go.opentelemetry.io/otel/sdk/metric`) is **v1.44.0** and stable, but
this exporter has been 0.x for years and sits *outside* OpenTelemetry's
stability guarantees. Path A is the least disruptive of the three —
scrapes, `up`, service discovery and relabeling all keep working — and it
is the one most teams should reach for first.

**Path B** is what this chapter builds. The SDK pushes OTLP straight into
a receiver inside Prometheus. No collector, no exporter, one flag on the
server. The OTLP exporter the worker uses for this,
`go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp`, is
pinned at **v1.44.0** and is stable — unlike its path-A sibling.

**Path C** puts an OpenTelemetry Collector in the middle. It is the shape
most production OTel deployments actually have, because the collector is
where you batch, filter, fan out to more than one backend and convert
temporality. Grafana Alloy is a distribution of that same collector. It
is out of scope here for one reason worth stating: the translation rules
you are about to learn are *identical* in the collector and in
Prometheus, because both import `github.com/prometheus/otlptranslator`,
**v1.0.0**. Learn them once on path B and you know them for path C.

The `ch28` tag carries path B's server-side half. Prometheus runs with
`--web.enable-otlp-receiver` from this chapter on. That flag is off by
default upstream for a blunt reason: Prometheus ships with no
authentication, and the flag opens a write door.

## Flip the switch

`snip-worker` can be instrumented either way. `lab/snip/worker.go`
records every job through a small interface, and the job loop never
learns which implementation it is holding:

```go
type jobRecorder interface {
	setQueueDepth(queue string, n int)
	observeJob(queue, outcome string, seconds float64)
	markSuccess(queue string, unixSeconds float64)
	shutdown(ctx context.Context) error
}
```

`lab/snip/metrics.go` implements it with `client_golang`.
`lab/snip/otelmetrics.go` implements it with the OpenTelemetry SDK. One
environment variable picks between them. Open `lab/.env`, change one
line, and restart:

```ini
SNIP_OTEL=1
```

```bash
make up
```

Now look at the worker's own metrics endpoint, the one Prometheus has
been scraping since Chapter 8, "Aggregation: `sum`, `without`, and the
Rate-Then-Aggregate Law":

```console
$ curl -s http://localhost:8090/metrics | grep snip_worker
$
```

Nothing. Not an error, not an empty family, not a zero — the four
families are not there at all. The endpoint still answers, because the
process still registers `snip_build_info` and the Go runtime collectors
on the default registry:

```bash
curl -s http://localhost:8090/metrics | grep -c '^snip_build_info'
```

```text
1
```

So the scrape still succeeds, and `up{job="snip-worker"}` is still 1.
That is an accident of this lab's design, not a property of OTLP: the
worker kept a pull endpoint because something else lives on it. A service
that went OTLP-only would have no endpoint, no target, no scrape and
therefore no `up` at all — and "a process that should be reporting and
has stopped" would become a question you can no longer ask directly.

!!! trap "The doubled `v1`"
    The receiver's path is `/api/v1/otlp/v1/metrics`, and the repeated
    `v1` is not a misprint: `/api/v1/` is the Prometheus API version and
    `/v1/metrics` is the OTLP signal path. The two standard endpoint
    variables treat it differently. `OTEL_EXPORTER_OTLP_ENDPOINT` is a
    base URL and the SDK appends `/v1/metrics` to it, so its correct
    value here is `http://prometheus:9090/api/v1/otlp`. Give that
    variable the full path instead and every export goes to
    `/api/v1/otlp/v1/metrics/v1/metrics`, where the answer is:

    ```text
    404 page not found
    ```

    Nothing reaches Prometheus, nothing logs a complaint there, and the
    only sign of trouble is in the exporter's own output. The
    signal-specific `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` is used
    exactly as given and needs the full path.
    `lab/snip/otelmetrics.go` sidesteps the choice by passing a complete
    URL through `otlpmetrichttp.WithEndpointURL` whenever neither
    variable is set.

## The names changed

Give it a minute. The OTel periodic reader exports every 15 seconds, the
same cadence as the scrape, and the previously scraped `snip_worker_*`
series get staleness markers at the first scrape that no longer carries
them — the mechanism Chapter 2, "What's Actually on the Wire", described.
Then ask Prometheus what it now knows about the worker:

```bash
curl -sk -u obslab:obslab -G \
  https://localhost:8443/prometheus/api/v1/query \
  --data-urlencode 'query=count by (__name__) (
      {__name__=~"snip_worker.*"})' \
  | jq -r '.data.result[] | .metric.__name__' | sort
```

```text
snip_worker_job_duration_seconds_bucket
snip_worker_job_duration_seconds_count
snip_worker_job_duration_seconds_sum
snip_worker_jobs_total
snip_worker_last_success_timestamp_seconds
snip_worker_queue_depth
```

Those are the same six names Chapter 8 taught, and they are the names
your recording rules, dashboards and alerts already use. Nobody wrote
them. Here is what the OTel side actually declares, from
`lab/snip/otelmetrics.go`:

```go
m.Int64Counter("snip.worker.jobs", ...)
m.Int64Gauge("snip.worker.queue.depth", ...)
m.Float64Histogram("snip.worker.job.duration",
	metric.WithUnit("s"), ...)
m.Float64Gauge("snip.worker.last_success_timestamp",
	metric.WithUnit("s"), ...)
```

Four dotted names and two units went in; six classic Prometheus names
came out. Those units are written in UCUM — the Unified Code for Units of
Measure, a standard vocabulary of short unit codes that OpenTelemetry
adopted, in which `s` means seconds and `By` means bytes. Four rules did
the transformation, and they are worth memorizing, because they are the
rules you will be reversing in your head for the rest of your career.

1. **Discouraged characters become underscores.** Prometheus's classic
   name alphabet is `[a-zA-Z_:][a-zA-Z0-9_:]*`. Dots are not in it, so
   `snip.worker.jobs` becomes `snip_worker_jobs`. Runs of underscores
   collapse to one.
2. **The unit becomes a word, appended.** UCUM unit codes map to
   Prometheus's spelled-out base units: `s` becomes `seconds`, `By`
   becomes `bytes`, `m/s` becomes `meters_per_second`. Nothing is added
   if the name already ends in that unit.
3. **A monotonic sum gets `_total`.** `snip.worker.jobs` is a counter, so
   it becomes `snip_worker_jobs_total`. A name that already ends in
   `_total` is left alone.
4. **The unit suffix comes before the type suffix.** A monotonic sum
   measured in bytes arrives as `..._bytes_total`, never
   `..._total_bytes`. Histograms then add `_bucket`, `_sum` and `_count`
   on top of that, which is where six names came from four instruments.

One more rule catches people out because it deletes rather than rewrites.
UCUM lets you annotate a unit with a bracketed word that says what is
being counted — `{packet}`, `{request}`, `{job}`. Those annotations **are
dropped**, not translated. An UpDownCounter called
`http.server.active_requests` with unit `{request}` arrives as
`http_server_active_requests`: no unit suffix, and no `_total`, because
an UpDownCounter is not monotonic.

Chapter 5, "Your First Counter: Instrumenting Code You Own", gave you a
naming law — base units, `_total` on counters, unit before type — and
warned that a name is a contract you cannot take back. The translation
layer obeys that law on your behalf, which is useful and is also the
problem: **the name you query is not the name anybody wrote.** A grep
through your own source for `http_server_request_duration_seconds` finds
nothing.

### Choosing how much translation you want

Those four rules are one of four named strategies, and all four live in
`prometheus/otlptranslator` v1.0.0. Prometheus's `otlp:` block selects
one with `translation_strategy`.

| Strategy | Escapes `.` | Adds unit and `_total` |
|---|---|---|
| `UnderscoreEscapingWithSuffixes` (default) | yes | yes |
| `UnderscoreEscapingWithoutSuffixes` | yes | no |
| `NoUTF8EscapingWithSuffixes` | no | yes |
| `NoTranslation` | no | no |

Here is the worker's histogram bucket series under each of the four, and
there is one surprise in the list:

```text
UnderscoreEscapingWithSuffixes     snip_worker_job_duration_seconds_bucket
UnderscoreEscapingWithoutSuffixes  snip_worker_job_duration_bucket
NoUTF8EscapingWithSuffixes         snip.worker.job.duration_seconds_bucket
NoTranslation                      snip.worker.job.duration_bucket
```

`_bucket` survives all four. "Without suffixes" means without the *unit*
and `_total` suffixes; `_bucket`, `_sum` and `_count` are structural —
they are how a classic histogram is represented at all, not decoration —
so no strategy removes them.

The bottom two keep your dotted names, which Prometheus 3 can store and
query because UTF-8 names are allowed by default, at the cost of the
quoted selector form Chapter 2 showed you: `{"snip.worker.jobs"}` rather
than `snip_worker_jobs_total`. Every dashboard, rule and alert that
touches such a metric has to be written that way too.

`NoTranslation` in particular carries a warning in Prometheus's own
documentation, and it is not the warning you expect. Beyond the awkward
PromQL, it says the setting risks *series collisions*, whose best case is
an out-of-order error and whose worst case is a silently malformed time
series. That is a strange sentence to read about a feature whose selling
point is fidelity, and it is the reason the lab leaves
`translation_strategy` at its default. So should you, until you have a
specific reason not to.

## Where the resource went

Now ask Prometheus about a metric name you never declared:

```bash
curl -sk -u obslab:obslab -G \
  https://localhost:8443/prometheus/api/v1/query \
  --data-urlencode 'query=target_info' \
  | jq -c '.data.result[].metric'
```

```json
{"__name__":"target_info","instance":"4f2a9c71b3de",
"job":"snip-worker","service_instance_id":"4f2a9c71b3de",
"service_name":"snip-worker","service_version":"1.4.0"}
```

Your `instance` value will differ — it is the worker container's
hostname, and Docker generates it. Everything else is fixed. The two
`service_*` labels are there because this lab's `otlp:` block asks for
them; a stock receiver would show `job`, `instance` and `service_version`
only.

!!! jargon "Resource"
    In OpenTelemetry, the **resource** is the set of attributes
    describing the *entity producing* the telemetry, as opposed to the
    attributes describing an individual measurement. `service.name`,
    `service.version` and `service.instance.id` are resource attributes;
    `queue="expiry"` is a measurement attribute. Prometheus has no
    separate concept for this. It has labels, and labels belong to
    series.

That mismatch is the whole of `target_info`. The resource cannot become
part of every series without inflating every series, so by default it
becomes one synthetic gauge, always valued 1, carrying the resource
attributes as labels. It is exactly the `*_info` pattern Chapter 4,
"Metric Types Are Contracts", named and Chapter 11, "Joins, Info Metrics,
and the Rest of PromQL", taught you to join against. Here is that join
doing real work — the version of the worker that did each job, taken from
a metric that does not carry a version label:

```promql
sum by (service_version) (
  rate(snip_worker_jobs_total[5m])
  * on (job, instance) group_left(service_version) target_info
)
```

Two of the resource attributes never needed the join, and this is where
`job` and `instance` come from on pushed data. The compatibility spec is
prescriptive: `service.namespace` and `service.name` are combined as
`<namespace>/<name>` — or the name alone when there is no namespace — to
form `job`, and `service.instance.id` becomes `instance`. The worker sets
two of those three in `lab/snip/otelmetrics.go`:

```go
res := resource.NewSchemaless(
	attribute.String("service.name", "snip-worker"),
	attribute.String("service.instance.id", host),
	attribute.String("service.version", c.Version),
)
```

Read that carefully, because it inverts a rule that has held since
Chapter 5. Application code must never set `job` or `instance` — those
are target labels, and the monitoring system owns them. The rule still
holds literally: this code sets neither. But it sets the two attributes
that *become* them. **On the OTLP path, target identity moves out of the
monitoring system and into the application.** That is the single most
consequential difference in this chapter, and every remaining awkwardness
in it follows from that one sentence.

### The `otlp:` block, key by key

`lab/prometheus/prometheus.yml` carries the server's half:

```yaml
otlp:
  promote_resource_attributes:
    - service.namespace
    - service.name
    - service.instance.id
  keep_identifying_resource_attributes: true
```

`promote_resource_attributes` copies the named resource attributes onto
every series as labels, sanitized the same way metric names are —
`service.name` arrives as `service_name`. Promote an attribute and you
stop needing a join for it; you also pay for it on every single series,
so the list is a budget decision of exactly the kind Chapter 7, "Labels,
and the Cardinality Arithmetic You Must Do First", taught you to make
before rather than after. This list promotes the identifying attributes,
so `service_name` and `service_instance_id` sit next to the `job` and
`instance` that already carry the same values — deliberate, so you can
see both mechanisms at once. On your own stack, promote what you would
otherwise have to join for and leave identity to `job` and `instance`.

`keep_identifying_resource_attributes` decides what happens to the three
identifying attributes — `service.name`, `service.namespace`,
`service.instance.id` — on `target_info` itself. They are redundant there
by default, because `job` and `instance` already carry them, so by
default they are stripped. Setting it to `true` keeps them, which is why
`target_info` carries both `job` and `service_name` in this lab.

The full block has more keys than the lab uses. This is the complete set
as of Prometheus 3.13.1:

```yaml
otlp:
  promote_resource_attributes: []
  promote_all_resource_attributes: false
  ignore_resource_attributes: []
  translation_strategy: UnderscoreEscapingWithSuffixes
  keep_identifying_resource_attributes: false
  convert_histograms_to_nhcb: false
  promote_scope_metadata: false
  label_name_underscore_sanitization: true
  label_name_preserve_multiple_underscores: true
```

`promote_all_resource_attributes` and `ignore_resource_attributes` are an
allow-all-then-deny pair, and Prometheus refuses to start if you mix them
with the promote list. `make check` catches both before anything runs:

```text
'promote_all_resource_attributes' and
'promote_resource_attributes' cannot be configured simultaneously

'ignore_resource_attributes' cannot be configured unless
'promote_all_resource_attributes' is true
```

`convert_histograms_to_nhcb` stores an incoming explicit-bucket histogram
in the native histogram structure Chapter 10, "Latency: Histograms
Without Tears", introduced, keeping the sender's own boundaries rather
than the exponential ones — NHCB is native histograms with custom
buckets. That leaves `promote_scope_metadata`, which is a section of its
own.

### What the server cannot fix

Compare the labels on the pushed series with the labels on
`snip_build_info`, which the same process still exposes by scrape. The
name filter matters: the recording rules you wrote in Chapter 15,
"Recording Rules", also carry `job="snip-worker"` and deliberately have
no `instance` at all, so without it they show up as a third population
that has nothing to do with OTLP.

```bash
curl -sk -u obslab:obslab -G \
  https://localhost:8443/prometheus/api/v1/query \
  --data-urlencode 'query=count by (instance, env) (
      {job="snip-worker", __name__=~"snip_.*"})' \
  | jq -r '.data.result[] | .metric | "\(.instance) \(.env)"'
```

```text
snip-worker-1 lab
4f2a9c71b3de null
```

One service, one job name, two populations. The scraped half has
`instance="snip-worker-1"` and `env="lab"`, both of them minted by the
seven relabel rules in the `snip-worker` job that Chapter 12,
"`prometheus.yml` in Full: Service Discovery and Relabeling", walked
through. The pushed half has the container hostname and no `env` at all,
because **OTLP does not go through the scrape pipeline**. No
`relabel_configs`, no `metric_relabel_configs`, and — worth knowing after
Chapter 24, "Cardinality: Detonate, Diagnose, Defuse" — no `sample_limit`
and no `label_limit` either. The guard rails you installed on the scrape
door do not cover this door.

The practical damage is that any join across the two halves returns
nothing, because `on (job, instance)` cannot match `snip-worker-1`
against `4f2a9c71b3de`. No config change fixes that: `instance` is
whatever `service.instance.id` says it is, and the only place to change
it is the application. The repair is a one-line code change — give the
resource the identity your monitoring system uses — and the honest
observation is that a deployment concern has moved into a binary.

## Three labels you did not ask for

Ask which label names the pushed series carry:

```bash
curl -sk -u obslab:obslab -G \
  https://localhost:8443/prometheus/api/v1/query \
  --data-urlencode 'query=snip_worker_jobs_total' \
  | jq -r '[.data.result[0].metric | keys[]] | join(" ")'
```

```text
__name__ instance job outcome queue service_instance_id service_name
```

There is nothing beginning `otel_scope_` there, and if you have read
anything else about OpenTelemetry and Prometheus you were expecting some.
Every OTel measurement belongs to an **instrumentation scope** — a named,
versioned library or module — and the compatibility spec maps that scope
onto three labels: `otel_scope_name`, `otel_scope_version` and
`otel_scope_schema_url`. Path A's Prometheus exporter stamps them on
every series by default. Prometheus's OTLP receiver does not: it puts
them behind `promote_scope_metadata`, which defaults to `false`.

Turn them on. Add one line to the `otlp:` block in
`lab/prometheus/prometheus.yml`:

```yaml
otlp:
  promote_resource_attributes:
    - service.namespace
    - service.name
    - service.instance.id
  keep_identifying_resource_attributes: true
  promote_scope_metadata: true
```

`--config.auto-reload` has been on since Chapter 12 and polls every
thirty seconds; `make reload` forces it immediately. Then wait five
minutes before you re-run the label query, for a reason worth knowing.
Adding a label does not rewrite the old series; it starts a new one
beside it. The old series stops receiving samples, and because nothing
scraped it, nothing writes it a staleness marker either — it falls out of
the lookback window in its own time. Push has no way to say "this series
is finished". Once it has aged out:

```text
__name__ instance job otel_scope_name otel_scope_schema_url
otel_scope_version outcome queue service_instance_id service_name
```

The values come straight from `lab/snip/otelmetrics.go`:
`otel_scope_name="obslab/snip/worker"`, `otel_scope_version="1.4.0"`,
`otel_scope_schema_url="https://opentelemetry.io/schemas/1.27.0"`.

Now price them, and be careful, because the obvious answer is wrong. Ask
how many series the four families occupy:

```promql
count({__name__=~"snip_worker.*"})
```

The arithmetic from Chapter 7 gives you the ceiling before you run it.
Two queues, three outcomes: `snip_worker_jobs_total` is at most 6 series.
`snip_worker_queue_depth` and `snip_worker_last_success_timestamp_seconds`
are 2 each. The histogram has eight finite buckets plus `+Inf`, plus
`_sum` and `_count`, which is 11 per queue, so 22. Six plus two plus two
plus twenty-two is **32**, and 32 is what a worker that has run every
queue to every outcome reports.

You may count fewer, and the reason is worth knowing: an OTel counter has
no way to pre-create a label combination that has not happened yet, so
`outcome="error"` has no series at all until a job actually fails. On the
`client_golang` side the worker pre-initializes all six children at
startup. That guarantee does not survive the switch.

Whatever number you get, it is also the number you would have got before
you added `promote_scope_metadata`. Scope labels do not multiply
cardinality. Every series belongs to exactly one scope, so adding the
scope to its identity cannot split it in two:

```promql
count(count by (otel_scope_name, otel_scope_version,
                otel_scope_schema_url) (snip_worker_jobs_total))
```

That returns `1`, and it will return `1` for most services you ever
operate. What the three labels actually cost is paid per series rather
than in series: more bytes in the head block and in the index for every
one of them, longer label sets on the wire, noisier legends in every
panel, and one genuine trap. Chapter 8 recommended `without` over `by` as
the default habit, precisely because `without` keeps dimensions you have
not met yet instead of silently dropping them. Its own worker query was:

```promql
sum without (instance) (
  rate(snip_worker_jobs_total{job="snip-worker"}[5m])
)
```

Run that now and it still returns a number, and on a second worker
container the number would be wrong in a way no error tells you about.
You asked to aggregate the `instance` label away. `service_instance_id`
holds the very same value, you did not name it, and `without` keeps what
it was not told to drop — so the result is still per-instance. Two
containers would give you twelve series out of a query written to return
six. The habit that protected you in Chapter 8 is the habit that catches
you here. Either name everything:

```promql
sum without (instance, service_instance_id, otel_scope_name,
             otel_scope_version, otel_scope_schema_url)
  (rate(snip_worker_jobs_total[5m]))
```

or switch to `by (queue, outcome)`, which is unaffected. On metrics that
arrive over OTLP, `by` is the safer default — one of the few places in
this subject where the standard advice reverses.

So: are the scope labels worth it? They earn their keep when two
libraries in one process emit the same metric name and you need to tell
them apart. In a service with one scope, which is most services, they
are three labels of pure overhead. Prometheus makes that your decision,
and you have now measured both sides of it.

## Cumulative and delta

Everything so far has been cosmetic compared with this. The one place
where OpenTelemetry and Prometheus disagree about *meaning* rather than
spelling is temporality.

!!! jargon "Temporality"
    How a counter reports. A **cumulative** counter reports its running
    total since the process started; the value 4,812 means "4,812 since
    I booted". A **delta** counter reports only what happened since the
    previous export; the value 37 means "37 in the last fifteen
    seconds". Prometheus is cumulative, everywhere, by design — `rate()`,
    `increase()` and counter-reset detection all assume it.

The difference is not a preference, it is a durability property. A missed
scrape of a cumulative counter costs you resolution and nothing else: the
next scrape carries the total, and `rate()` spans the gap. A lost delta
export is gone permanently, because nothing afterwards restates it. That
is why Prometheus scrapes cumulative counters and why `rate()` over
deltas is arithmetic nonsense.

The happy path needs no configuration.
`go.opentelemetry.io/otel/sdk/metric` v1.44.0 uses cumulative temporality
for every instrument kind by default, so the worker you switched over a
moment ago is already speaking the right dialect. The lab did nothing to
arrange this, and the chapter would be much longer if the default ran the
other way.

You can see what the other way looks like without touching the worker.
Hand-build one OTLP data point that declares delta temporality —
`aggregationTemporality` is `1` for delta and `2` for cumulative — and
post it to the receiver yourself:

```bash
cat > /tmp/delta.json <<EOF
{"resourceMetrics":[{"resource":{"attributes":[{"key":"service.name",
"value":{"stringValue":"delta-probe"}}]},"scopeMetrics":[{"metrics":[
{"name":"delta.probe.jobs","sum":{"aggregationTemporality":1,
"isMonotonic":true,"dataPoints":[
{"timeUnixNano":"$(date +%s)000000000","asDouble":5}]}}]}]}]}
EOF
```

```bash
curl -sk -u obslab:obslab -X POST -w '\nHTTP %{http_code}\n' \
  -H 'Content-Type: application/json' --data-binary @/tmp/delta.json \
  https://localhost:8443/prometheus/api/v1/otlp/v1/metrics
```

```text
invalid temporality and type combination for metric "delta.probe.jobs"

HTTP 500
```

Change `"aggregationTemporality":1` to `2` and the same request returns
`HTTP 200` with an empty body. Prometheus also writes a line of its own,
which you can see with `docker compose logs prometheus`:

```text
time=2026-10-31T14:46:32.864Z level=ERROR
source=write_otlp_handler.go:184 msg="Error appending remote write"
component=web err="invalid temporality and type combination for
metric \"delta.probe.jobs\""
```

So Prometheus's own receiver is not quiet about delta. It is something
worse and more useful: it is **strict**. The rejection is per *request*,
not per metric. One delta data point anywhere in an export fails the
whole POST, and every cumulative metric that shared that request is lost
with it — which is exactly the shape of a bug report that reads "half our
metrics vanished when we added one new instrument".

!!! pitfall "The quiet version of the same mistake"
    Someone sets `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` to
    `delta` because a different backend wanted it — the documented,
    supported way to ask an OTel exporter for deltas, and the default in
    several SDKs and vendor pipelines. Send that through path C instead
    of path B and nobody returns a 500 to anyone. The compatibility spec
    says delta histograms *may* be converted to cumulative **or must be
    dropped**, and the Collector's `prometheusremotewrite` exporter
    takes the second option: non-cumulative monotonic, histogram and
    summary points are dropped on the way out. Your dashboard goes
    blank, the sender reports success, and the only clue is that nobody
    configured anything called "drop". Prometheus shouts; a collector in
    front of it does not.

Prometheus has two recoveries, both experimental and **mutually
exclusive**:

- `--enable-feature=otlp-deltatocumulative` converts deltas to cumulative
  as they arrive, keeping the running totals in server memory. A restart
  therefore looks like a counter reset.
- `--enable-feature=otlp-native-delta-ingestion` stores the raw deltas.
  `rate()` is then wrong on them; the documented shape is
  `sum_over_time(m[5m])`.

Either one turns that `HTTP 500` into `HTTP 200`. Asking for both is a
startup error, and Prometheus says so in as many words — `cannot enable
otlp-deltatocumulative and otlp-native-delta-ingestion features at the
same time` — before it binds a port. The better fix is upstream: set
cumulative in the SDK, or convert in the collector with its
`deltatocumulative` processor. Configure the producer rather than
teaching the database a second dialect.

### The window push makes necessary

Chapter 25 named `storage.tsdb.out_of_order_time_window`, left it at
zero, and said this chapter would turn it on. Here is why. A scrape
arrives in order by construction — one scraper, one timeline, one sample
per interval per series. Pushes do not. Two collector replicas, a retry
after a network stall, or a batch flushed late all arrive out of order,
and at zero Prometheus rejects any sample older than the newest one in
its series. Add one line to the `storage.tsdb` block that has carried the
retention settings since Chapter 25:

```yaml
storage:
  tsdb:
    out_of_order_time_window: 30m
    retention:
      time: 45d
      size: 2GB
```

Reload with `make reload`. Nothing is logged when a window opens, so read
it back from the server rather than from your own file:

```bash
curl -sk -u obslab:obslab \
  https://localhost:8443/prometheus/api/v1/status/config \
  | jq -r '.data.yaml' | grep order
```

```text
    outofordertimewindow: 1800000
    out_of_order_time_window: 30m
```

The server reports it twice: once under an internal field name in
milliseconds, and once as you wrote it. Before the edit there is a
single line reading `outofordertimewindow: 0`. One sender on a timer
never needs this window, which is why the lab ships without it; open it
the moment a second pusher appears.

## The honest verdict

Julius Volz, who co-founded Prometheus, published a position in July 2025
titled "Why I recommend native Prometheus instrumentation over
OpenTelemetry". It is a position, not documentation, and it is worth
taking seriously because every one of its six friction points is
something you have now seen on your own machine.

1. **You lose target health.** Pull plus service discovery synthesizes
   `up` for every target. Push has no equivalent, so "should be reporting
   and isn't" becomes invisible.
2. **Naming.** What you query is not what you named.
3. **Resource attributes are not target labels.** You re-join them from
   `target_info` instead of reading them off the series.
4. **Server configuration burden.** A flag to enable the receiver, an
   `otlp:` block to make the labels usable, and an out-of-order window
   once there is more than one sender.
5. **Performance.** He reports the Prometheus Go client somewhere between
   roughly 4.4 and 26 times faster at counter increments, depending on
   the case, with zero allocations where OTel allocates.
6. **Redundant standardization.** The Prometheus text format is trivial
   to implement, and it already had an ecosystem.

That is why every chapter before this one instrumented Snip with
`client_golang` rather than the OTel SDK. It is not nostalgia. With
native instrumentation the name you write is the name you query, the
monitoring system owns target identity, `up` is free, and there is
nothing between your code and your query to misconfigure.

!!! sidebar "The other side of the argument"
    OpenTelemetry graduated the CNCF on 21 May 2026, the foundation's
    highest maturity tier, and its case is real: one instrumentation API
    across metrics, traces and logs; a large body of automatic
    instrumentation you do not have to write; and vendor portability,
    since the same SDK can point anywhere. If your organization has
    already standardized on OTel, re-instrumenting for Prometheus is the
    wrong fight. The counterweight is maturity: the Collector is still
    **v0.157.0** — there is no Collector 1.0 — and stability is declared
    per component rather than for the distribution.

A two-sentence recommendation for a Prometheus-centric team: instrument
new services you own with the native client library, because the whole
toolchain assumes it and nothing is lost. When metrics are already
OpenTelemetry, take them — path A if you can, because it keeps `up` and
the scrape pipeline; path B or C when push is forced on you — and budget
a day for names, `target_info` and temporality before anyone writes an
alert on them.

## Putting the lab back

Run the self-check and the exercises with `SNIP_OTEL=1` still on, then
put it back. The shipped stack runs the worker on `client_golang` on
purpose: the OTLP path cannot pre-initialize a counter's label values,
so while the switch is on, `SNIP_NO_ZERO_INIT` becomes a no-op on the
worker and the zero-initialization guarantee underneath Chapter 9,
"Ratios, Arithmetic, and the Series That Isn't There", and the alerting
rules of Chapter 16, "Alerting Rules, and What 'Firing' Actually
Means", does not hold.

```ini
SNIP_OTEL=0
```

```bash
make up
```

Your two edits to `lab/prometheus/prometheus.yml` are yours to keep.
`git checkout ch28 -- prometheus/prometheus.yml` puts the shipped file
back if you would rather go on from that.

!!! selfcheck "Self-check"
    With `SNIP_OTEL=1` and `promote_scope_metadata: true` in place, run
    `make verify-ch28`. It asserts six things: `snip_worker_jobs_total`
    exists; those series carry `otel_scope_*` labels; `target_info`
    exists; `job` reads `snip-worker`; the series carry a non-empty
    `instance`; and `snip-api`'s series carry no `otel_scope_*` labels,
    because `snip-api` never left `client_golang`. With all six true it
    prints `ch28 OK`. This is the one verify target that needs you to
    turn two switches on first — with `SNIP_OTEL=0` it fails at the
    first assertion, and with the scope line missing it fails at the
    second. Both failures are correct behavior, not a broken lab, and
    the script's own hints name both switches.

## Common mistakes

**Querying the name you wrote.** You search the Metrics Explorer on the
Query page for `snip.worker.jobs`, find nothing, and conclude the push is
not working. The push is working; the name is `snip_worker_jobs_total`.
Before debugging an OTLP pipeline, run `count by (__name__)` over a
generous regex and read what actually arrived.

**Reading `up` as "the pusher is alive".** In this lab
`up{job="snip-worker"}` stays 1 while `SNIP_OTEL=1`, which makes it look
like OTLP preserves target health. It does not — that `up` describes a
scrape of an endpoint that no longer carries the four families, and if
the exporter stopped pushing this instant it would not move. Alert on the
data instead, with `absent_over_time()` or the staleness of
`snip_worker_last_success_timestamp_seconds`, exactly as Chapter 9
showed.

**Assuming relabeling still runs.** Pushed series have no `env`, no
renamed `instance`, and none of your `metric_relabel_configs` drops. A
label on OTLP data has to come from the resource, from the `otlp:` block,
or from a collector in front.

**Reaching for `NoTranslation` to keep your names.** It works, and then
every selector needs the quoted form, every dashboard and rule has to be
rewritten, and Prometheus's own documentation warns about silent series
collisions. Keep the default and explain the suffixes to your team once.

**Blaming the new instrument.** An export carrying one delta data point
fails in its entirety, so the symptom of adding a single
delta-temporality metric is that *all* of that service's metrics stop.
The new instrument is the cause but not the victim, and looking only at
the series that disappeared will not find it.

## Summary

OpenTelemetry metrics reach Prometheus by three roads: the SDK's own
Prometheus exporter, which keeps the pull model and is still a 0.x
component; OTLP pushed into Prometheus's receiver behind
`--web.enable-otlp-receiver`; and a collector in the middle. The
translation rules are identical on all of them, because they are one
library.

You flipped one environment variable, watched four metric families vanish
from a `/metrics` endpoint and reappear in the database under different
names, found the resource hiding in `target_info`, priced three scope
labels that cost nothing in cardinality and something real in everything
else, and saw one service split into two `instance` populations that no
PromQL join can bridge.

- Dots become underscores, UCUM units become words, monotonic sums gain
  `_total`, the unit suffix comes before the type suffix, and bracketed
  annotations like `{packet}` are dropped entirely. `_bucket`, `_sum` and
  `_count` are structural and survive every translation strategy.
- The resource becomes `target_info`, a value-1 gauge you join against;
  `service.namespace`/`service.name` become `job` and
  `service.instance.id` becomes `instance`.
- `promote_resource_attributes` trades a join for a label on every
  series. `keep_identifying_resource_attributes` governs `target_info`
  only. Scope metadata is off by default on Prometheus's receiver, on by
  default in the SDK's Prometheus exporter, and costs no series either
  way.
- Prometheus is cumulative-only and the OTel SDK default is cumulative,
  so the happy path is free. A delta point sent to Prometheus's own
  receiver fails the whole request with an HTTP 500; the same point sent
  through a collector is dropped without complaint.
- OTLP bypasses the scrape pipeline completely: no relabeling, no scrape
  limits, no `up`, and target identity moves from your configuration into
  your application code.

## Exercises

!!! exercise
    **1. Three names from one histogram (warm-up).** An OTel Histogram
    named `http.server.request.duration` carries unit `s`. Write down its
    three Prometheus series names before you look anything up, then check
    your answer against the worker's own `snip.worker.job.duration`,
    which has the same type and the same unit and is already in your
    database.

    **2. What the scope labels cost (core).** Count the four worker
    families with `count({__name__=~"snip_worker.*"})`. Remove
    `promote_scope_metadata: true` again, reload, wait five minutes for
    the old series to age out of the lookback window, and count again.
    State the difference in series, then say in one sentence what the
    three labels do cost and name a situation in which you would pay it
    gladly.

    **3. One delta point, many casualties (stretch).** Take the
    hand-built OTLP payload from this chapter and add a second metric to
    the same request — a cumulative gauge, any name you like. Predict
    what the receiver does with the request, then send it and check
    whether your gauge arrived. Now set `"aggregationTemporality":2` on
    the first metric and send it again. Write down the rule you proved,
    in one sentence, and say which of Prometheus's two delta
    feature flags you would reach for and why you would rather not.

    **4. One query, both worlds (core).** Write a PromQL expression that
    reports the worker's job rate per queue and returns exactly two
    series in both worlds — the scraped one and the pushed one. Flip
    `SNIP_OTEL` twice and watch it on a graph. State which of `by` and
    `without` you used, why the other one fails, and what the graph does
    in the half-minute after each flip while both populations are still
    inside the lookback window.

    **5. Your team's recommendation (core).** Write the two-sentence
    recommendation you would give your own team. Then take Volz's six
    friction points in turn and say, for each, whether your
    recommendation survives it, mitigates it, or accepts it. A
    recommendation that accepts none of the six is not a recommendation,
    it is a preference.
