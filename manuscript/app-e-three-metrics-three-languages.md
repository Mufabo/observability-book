# Appendix E — The Same Three Metrics in Go, Python, Java and Node

Snip is Go, and every metric you wrote in Part II you wrote with
`client_golang`. The metrics themselves are not Go. A metric name, its label
names, its unit and its `# HELP` line are a contract with whoever queries the
series, and that contract is portable: the same families can come out of any of
the four official client libraries without one dashboard, recording rule or
alert changing.

This appendix ports three of Snip's families — one counter, one histogram, one
gauge — to `prometheus_client`, to `client_java` 1.x and to `prom-client`, and
then lists what differs. Find your language, copy the shape, and read the trap
table before you ship it. Every trap in it costs an evening the first time.

## The three metrics

These are the ones the rest of the book queries most. The names, label names
and units below are fixed; the code that produces them is not.

| Metric | Type | Labels | Unit |
|---|---|---|---|
| `snip_http_requests_total` | counter | `route`, `method`, `code` | requests |
| `snip_http_request_duration_seconds` | histogram | `route`, `method`, `code` | seconds |
| `snip_links_active` | gauge | none | links |

The `# HELP` strings travel with the names. Copy them exactly, in every
language:

| Metric | `# HELP` |
|---|---|
| `snip_http_requests_total` | `Total HTTP requests handled by the Snip API, by templated route, method and response status code.` |
| `snip_http_request_duration_seconds` | `Latency of HTTP requests handled by the Snip API, in seconds.` |
| `snip_links_active` | `Short links that currently exist and have not expired.` |

## What must not change, and what always does

Five things are the contract, and a port that breaks any of them breaks a query
somewhere in the lab:

- The metric names, including the `_total` suffix on the counter.
- The label names, and their closed value sets: `route` is always the
  templated path (`/l/{code}`, never `/l/abc123`), `method` is `GET` or `POST`,
  `code` is the HTTP status as a string.
- The unit. Seconds, always, never milliseconds — that is the `catalog` bug
  of Chapter 10, "Latency: Histograms Without Tears", in one line.
- The thirteen finite bucket bounds of the latency histogram, `0.3` among them.
- The rule from Chapter 5, "Your First Counter: Instrumenting Code You Own":
  application code never emits `job`, `instance`, `env`, `cluster` or `region`.
  Those are target labels, set by Prometheus.

Four things differ in every language and are the reason this appendix exists:
the constructor shape, the default bucket set, what the default registry
already contains, and how `/metrics` gets served.

## Go — `client_golang` v1.24.1

The main line. This is the shape of `lab/snip/metrics.go`, reduced to the
three families.

```go
var sloBuckets = []float64{
	0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.3, 0.5, 0.75, 1, 2.5, 5, 10,
}

type Metrics struct {
	Requests    *prometheus.CounterVec
	Duration    *prometheus.HistogramVec
	LinksActive prometheus.Gauge
}

func NewMetrics(reg prometheus.Registerer) *Metrics {
	f := promauto.With(reg)
	return &Metrics{
		Requests: f.NewCounterVec(prometheus.CounterOpts{
			Name: "snip_http_requests_total",
			Help: "Total HTTP requests handled by the Snip API, by " +
				"templated route, method and response status code.",
		}, []string{"route", "method", "code"}),

		Duration: f.NewHistogramVec(prometheus.HistogramOpts{
			Name: "snip_http_request_duration_seconds",
			Help: "Latency of HTTP requests handled by the Snip " +
				"API, in seconds.",
			Buckets: sloBuckets,
		}, []string{"route", "method", "code"}),

		LinksActive: f.NewGauge(prometheus.GaugeOpts{
			Name: "snip_links_active",
			Help: "Short links that currently exist and have not " +
				"expired.",
		}),
	}
}
```

Recording, once per request and once per refresh:

```go
m.Requests.WithLabelValues(route, method, code).Inc()
m.Duration.WithLabelValues(route, method, code).
	Observe(time.Since(start).Seconds())
m.LinksActive.Set(float64(n))
```

Six things to know, in the order they will bite you:

- `prometheus.NewRegistry()` starts **empty**. Register
  `collectors.NewGoCollector()` and
  `collectors.NewProcessCollector(collectors.ProcessCollectorOpts{})`
  yourself or every runtime panel is silently blank. `lab/loadgen/main.go`
  does this; `lab/snip/metrics.go` uses the default registry, which already
  has both. That pair is the live example behind Chapter 5.
- Take the registry as a constructor argument and build a factory with
  `promauto.With(reg)`. Package-level `var` blocks against the default
  registry are the combination the library's own documentation warns about:
  `promauto` panics on a registration failure, and with package-level
  variables that failure happens during package initialization, before
  `main` gets control.
- The `promhttp` middlewares accept **only** `code` and `method` as
  non-const, non-curried labels, and they panic at wrap time otherwise.
  Extra dimensions go in through `MustCurryWith` — which is how `route`
  reaches the counter in `lab/snip/api.go` — or through
  `WithLabelFromRequest` / `WithLabelFromCtx`.
- A handler that panics is reported as nothing at all: no count, no
  observation. Recovery middleware has to sit *inside* the instrumentation
  chain, or you need a separate panic counter.
- `Opts.Unit` and the descriptor option `WithUnit()` are metadata. They
  populate the OpenMetrics `# UNIT` line and do **not** append a suffix to
  the name. You still write `_seconds` yourself.
- There is no `/v2` module path. `github.com/prometheus/client_golang` is
  still v1, and anything telling you to import `client_golang/v2` is
  describing a module that does not exist.

## Python — `prometheus_client` 0.26.0

The library the lab's `catalog` and `pager` services use. Install
`prometheus-client` with a hyphen; import `prometheus_client` with an
underscore.

```python
from prometheus_client import Counter, Gauge, Histogram

SLO_BUCKETS = (
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.3, 0.5, 0.75, 1.0,
    2.5, 5.0, 10.0, float("inf"),
)

REQUESTS = Counter(
    "snip_http_requests",
    "Total HTTP requests handled by the Snip API, by templated "
    "route, method and response status code.",
    ["route", "method", "code"],
)

DURATION = Histogram(
    "snip_http_request_duration_seconds",
    "Latency of HTTP requests handled by the Snip API, in seconds.",
    ["route", "method", "code"],
    buckets=SLO_BUCKETS,
)

LINKS_ACTIVE = Gauge(
    "snip_links_active",
    "Short links that currently exist and have not expired.",
)
```

Recording:

```python
REQUESTS.labels(route=route, method=method, code=str(code)).inc()
DURATION.labels(route=route, method=method, code=str(code)).observe(
    perf_counter() - started
)
LINKS_ACTIVE.set(n)
```

Read the counter's name again. It is declared **without** `_total`, and the
wire carries `snip_http_requests_total` anyway, because the Python client
appends the suffix for you. You have already seen this in the lab without
being told: `lab/catalog/metrics.py` declares `catalog_http_requests` and
`catalog_lookups`, and Chapter 4, "Metric Types Are Contracts", queries them
as `catalog_http_requests_total` and `catalog_lookups_total`. Go, Java and
Node all make you write the suffix. Python takes it off you.

Three more differences worth having in your head:

- `+Inf` is written out. The default bucket tuple ends with an explicit
  infinity and so should yours. In Go the `+Inf` bound is implicit and must
  never appear in the slice.
- Counters and histograms get a `*_created` companion series carrying a Unix
  timestamp. Both Python services in the lab set
  `PROMETHEUS_DISABLE_CREATED_SERIES=true` in their Dockerfiles to suppress
  the family, because a `_created` suffix carrying a timestamp with no
  `_seconds` on the end fails the naming law of Chapter 5.
- `Info` and `Enum` have no Go equivalent. `Info` is how `catalog` exports
  `catalog_build_info` in three lines, where Go hand-rolls an `_info` gauge
  set to 1.

## If your service is Python, here is the trap waiting for you

Snip is Go, so this one is not yours. It is the single most common cause of
"my Python metrics are wrong" in the wild, and you will meet it in somebody
else's service.

Run a Python app under Gunicorn or uWSGI with four workers and each worker
gets its own in-process registry. A scrape reaches whichever worker the
operating system routed the connection to, so the numbers Prometheus stores
are one random quarter of the truth, and they jump around and go backwards
between scrapes for no reason you can see in the code. Nothing errors.
Nothing logs.

The fix is multiprocess mode, and it is four changes, not one:

```python
from prometheus_client import CollectorRegistry, multiprocess

# PROMETHEUS_MULTIPROC_DIR is set in the environment before the
# workers start, and the directory is emptied at startup.
def build_registry() -> CollectorRegistry:
    registry = CollectorRegistry()
    multiprocess.MultiProcessCollector(registry)
    return registry
```

1. Point `PROMETHEUS_MULTIPROC_DIR` at a writable directory, and **empty it
   on startup**. Files left behind by the previous run are read as though
   they were current.
2. Serve from a registry built with `MultiProcessCollector`, not from the
   default one.
3. Call `multiprocess.mark_process_dead(pid)` from whatever hook your server
   calls when a worker exits, or dead workers' series linger.
4. Give every gauge an explicit `multiprocess_mode`. There is no single right
   answer to "what is the value of this gauge across four processes", so the
   library refuses to pick one for you.

Two consequences to expect afterward. The `process_*` collectors describe one
process, not the group, so a memory panel built on them reads low by roughly
a factor of the worker count. And `_created` series and exemplars behave
differently under the multiprocess collector than under the default registry.

## Java — `client_java` 1.x, not `simpleclient`

There are two incompatible Prometheus Java clients and the old one is still
the first search result. `io.prometheus:simpleclient`, package root
`io.prometheus.client.*`, stopped at 0.16.0 in 2022. The current line is
`io.prometheus:prometheus-metrics-*`, package root `io.prometheus.metrics.*`,
version 1.8.0. 1.0.0 was a complete rewrite of the data model and is not
backward compatible; a `prometheus-metrics-simpleclient-bridge` module exists
so you can migrate the exporter first and the instrumentation later.

Take the three artifacts through the BOM so they cannot drift apart:

```text
io.prometheus:prometheus-metrics-bom:1.8.0        (pom, import)
io.prometheus:prometheus-metrics-core
io.prometheus:prometheus-metrics-instrumentation-jvm
io.prometheus:prometheus-metrics-exporter-httpserver
```

Everything in 1.x is a builder:

```java
Counter requests = Counter.builder()
        .name("snip_http_requests_total")
        .help("Total HTTP requests handled by the Snip API, by "
                + "templated route, method and response status code.")
        .labelNames("route", "method", "code")
        .register();

Histogram duration = Histogram.builder()
        .name("snip_http_request_duration_seconds")
        .help("Latency of HTTP requests handled by the Snip API, "
                + "in seconds.")
        .labelNames("route", "method", "code")
        .classicUpperBounds(0.005, 0.01, 0.025, 0.05, 0.1, 0.25,
                0.3, 0.5, 0.75, 1, 2.5, 5, 10)
        .register();

Gauge linksActive = Gauge.builder()
        .name("snip_links_active")
        .help("Short links that currently exist and have not expired.")
        .register();
```

Recording, and the exposition on the port `snip-api` publishes in Chapter 1,
"Ten Minutes to Your First Metric":

```java
requests.labelValues(route, method, code).inc();
duration.labelValues(route, method, code).observe(seconds);
linksActive.set(n);

JvmMetrics.builder().register();
HTTPServer server = HTTPServer.builder()
        .port(8000)
        .buildAndStart();
```

Four notes:

- It is `labelValues(...)`, not `labels(...)`. `labels()` is the 0.16.0 API
  and will not compile against 1.x.
- `JvmMetrics.builder().register()` is the equivalent of Go's Go collector
  plus process collector. Without it you get your own metrics and nothing
  else.
- The default builder produces **classic and native histograms together**,
  with no configuration at all. `classicOnly()` and `nativeOnly()` turn one
  half off. In Go you opt in per metric with `NativeHistogramBucketFactor`.
- If the service is Spring Boot, you are not calling this API. Spring Boot
  exposes Prometheus metrics through Micrometer, whose naming conventions —
  dots to underscores, automatic base-unit suffixes — sit between your code
  and the `/metrics` output. Configure Micrometer, and check the names it
  produced before writing a query against the names you expected.

## Node — `prom-client` 15.1.3

The newest published release is 15.1.3, from June 2024. The repository has an
unreleased 16.x section in its changelog; **prom-client 16 does not exist on
npm**, so do not pin one.

```javascript
const client = require('prom-client');

client.collectDefaultMetrics();

const requests = new client.Counter({
  name: 'snip_http_requests_total',
  help:
    'Total HTTP requests handled by the Snip API, by templated ' +
    'route, method and response status code.',
  labelNames: ['route', 'method', 'code'],
});

const duration = new client.Histogram({
  name: 'snip_http_request_duration_seconds',
  help: 'Latency of HTTP requests handled by the Snip API, in seconds.',
  labelNames: ['route', 'method', 'code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.3, 0.5, 0.75, 1,
            2.5, 5, 10],
});

const linksActive = new client.Gauge({
  name: 'snip_links_active',
  help: 'Short links that currently exist and have not expired.',
});
```

Recording takes the labels as an object:

```javascript
requests.inc({ route, method, code });
duration.observe({ route, method, code }, seconds);
linksActive.set(n);
```

The library bundles no web framework, so the endpoint is yours to write:

```javascript
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});
```

!!! pitfall "The two-line Node endpoint that breaks both ways"
    `register.metrics()` returns a Promise. Forget `await` and the response
    body is the literal string `[object Promise]`, served with a 200. Forget
    the `Content-Type` line and Prometheus 3 fails the entire scrape rather
    than guessing a format — the target goes down and takes all its metrics
    with it, which is exactly the failure `SNIP_NO_CONTENT_TYPE=1` summons in
    Chapter 5. Two lines, two different ways to be invisible.

One more Node-specific habit to break: `prom-client` does no name
normalization whatsoever. `labelNames: ['statusCode']` produces a literal
`statusCode` label — legal, and against every naming convention in this book.
The README's own example does it. Use `code`, as the lab does. And for a
clustered Node service, `client.AggregatorRegistry` gathers the workers'
registries in the primary process, with a per-metric `aggregator` of `sum`,
`first`, `min`, `max`, `average` or `omit` — the same problem Python solves
with multiprocess mode, solved a different way.

## A fourth family worth porting: `*_info`

Every service in the lab exports one metric whose value is always `1` and whose
payload is entirely in its labels. Chapter 11, "Joins, info metrics, and the
rest of PromQL", joins against it; you will want it in any port.

Go has no info type, so `lab/snip/metrics.go` builds one out of a gauge:

```go
promauto.With(reg).NewGaugeVec(prometheus.GaugeOpts{
	Name: "snip_build_info",
	Help: "Build information for the running Snip process. " +
		"Always 1; read the labels.",
}, []string{"version", "commit", "goversion"}).
	WithLabelValues(version, commit, runtime.Version()).Set(1)
```

Python has a real one, and `lab/catalog/metrics.py` uses it:

```python
BUILD_INFO = Info(
    "catalog_build",
    "Build information for the running catalog service. "
    "Always 1; read the labels.",
)
BUILD_INFO.info(
    {
        "version": VERSION,
        "revision": REVISION,
        "python_version": platform.python_version(),
    }
)
```

Note the declared name: `catalog_build`, and the wire reads
`catalog_build_info`. `Info` appends its suffix the way `Counter` appends
`_total`. Java has `Info.builder()` in the same 1.x builder style.

Keep the label values honest across a port. A Go process exporting a
`python_version` label, or a Python one exporting `goversion`, is a printed
falsehood that no test will catch — which is why the lab's two info metrics
carry different third labels.

## The wire, whichever language produced it

The point of all of the above is that none of it is visible downstream. Ask any
of the four ports for the counter and the first two lines are the same,
because they are determined by the name and the `# HELP` string rather than by
the library. The `# HELP` line is one line on the wire, wrapped here to fit
the page:

```text
# HELP snip_http_requests_total Total HTTP requests handled by the
    Snip API, by templated route, method and response status code.
# TYPE snip_http_requests_total counter
```

The sample lines differ only in label order, which carries no meaning, and in
how floats are rendered, which Prometheus normalizes on ingestion. Chapter 2,
"What's Actually on the Wire", taught you to read those three parts; this
appendix is the demonstration that they are the whole interface.

## Default buckets, side by side

If you accept a library's default histogram buckets, you are accepting a
different histogram in each language. This is the table Chapter 10 made
observable:

| Library | Finite default bounds | The `+Inf` bound |
|---|---|---|
| Go `client_golang` | 11 | implicit — never write it |
| Python `prometheus_client` | 14 | spelled out in `DEFAULT_BUCKETS` |
| Java `client_java` | 11 | implicit |
| Node `prom-client` | 11 | implicit |

Python's fourteen are Go's eleven plus `0.075`, `0.75` and `7.5`. Java's and
Node's defaults match Go's list exactly. The cost is not cosmetic: eleven
finite bounds plus `+Inf` plus `_sum` and `_count` is **14 series per label
combination**, and fourteen finite bounds is **17** — the 21% difference
Chapter 7, "Labels, and the Cardinality Arithmetic You Must Do First",
computed against `loadgen` and `catalog`.

You can read both halves off the running lab. `snip-api` with its designed
buckets exposes thirteen finite bounds plus `+Inf`; `catalog`, on Python
defaults, exposes fourteen plus `+Inf`:

```text
snip-api  0.005 0.01 0.025 0.05 0.1 0.25 0.3 0.5 0.75 1 2.5 5 10
catalog   0.005 0.01 0.025 0.05 0.075 0.1 0.25 0.5 0.75 1.0 2.5
          5.0 7.5 10.0
```

Look at the rendering as well as the count. Go writes `1`, `5`, `10`; Python
writes `1.0`, `5.0`, `10.0`. Both are `le` label *values*, and Prometheus 3
normalizes them to the same canonical float form on ingestion — so the
difference you can see in `curl` never reaches PromQL, and `le="1"` matches
neither of them. Chapter 10 has the full trap.

This is also why a port has to keep the thirteen bounds rather than take the
defaults. `le="0.3"` is hard-coded in three of the lab's dashboards and in
every window of the latency SLI recording rules in
`lab/prometheus/rules/snip-recording.yml`. Accept any library's defaults and
`0.3` is not a boundary any more, those queries return nothing, and the SLO
stops being measurable.

## Registries, runtime metrics and serving `/metrics`

Two lines per language, because this is where ports go quiet rather than
wrong.

| Language | Runtime metrics | Serving `/metrics` |
|---|---|---|
| Go | `collectors.NewGoCollector()` + process collector, on a fresh registry | `promhttp.HandlerFor(reg, opts)` |
| Python | default registry supplies `python_info`, `python_gc_*`, `process_*` | `make_wsgi_app()`, `make_asgi_app()`, `start_http_server()` |
| Java | `JvmMetrics.builder().register()` | `HTTPServer.builder().port(p).buildAndStart()` |
| Node | `client.collectDefaultMetrics()` | you write the route yourself |

Go and Python differ in their default: Go's `DefaultRegisterer` arrives with
the runtime collectors already on it and a fresh registry arrives empty, while
Python's default registry always carries its runtime families. Both Python
services in the lab show the two exposition shapes — `catalog` encodes the
default registry directly, `pager` uses `generate_latest()` with
`CONTENT_TYPE_LATEST`.

## Exemplars and native histograms

Exemplars attach a trace ID to a single observation. The mechanism is the
same everywhere and the API is not:

| Language | How an exemplar is attached |
|---|---|
| Go | assert to `prometheus.ExemplarObserver`, call `ObserveWithExemplar` |
| Python | an `exemplar=` argument on `inc()` and `observe()` |
| Java | automatic when OpenTelemetry tracing is on the classpath |
| Node | see the README of the version you install |

In every language the exemplar only reaches the wire when the scrape
negotiates OpenMetrics or protobuf — in Go that is
`promhttp.HandlerOpts{EnableOpenMetrics: true}` — and it only reaches storage
when the server runs with `--enable-feature=exemplar-storage`. Use `trace_id`
and `span_id` as the label keys. Chapter 29, "Beyond Metrics: Exemplars,
Traces, Logs, and Where to Go Next", shows what emitting `traceID` instead of
`trace_id` costs: a dead link with no error anywhere.

!!! note "Native histograms, exactly"
    Native histograms are stable since Prometheus 3.8.0; the
    `native-histograms` feature flag has been a complete no-op since 3.9;
    and there are still **three independent opt-ins** — the client
    library's `NativeHistogramBucketFactor`, the server's
    `scrape_native_histograms: true`, and remote write's
    `send_native_histograms: true`. The latter two default to true only
    from v4. The classic text exposition format cannot carry them at all.

Of the four libraries, Java emits native and classic representations by
default, Go emits them when you set `NativeHistogramBucketFactor` (the lab
does it on `loadgen` under `LOADGEN_NATIVE=1`), and Python emits them only
through the OpenMetrics 2.0 text path, which is still experimental. Treat
native histograms as a Go and Java feature for now.

## The trap table

One line per language. Each of these is a real evening.

| Language | The trap |
|---|---|
| Go | a fresh registry starts empty; no `go_*`, no `process_*` |
| Go | `promhttp` allows only `code` and `method`, and panics otherwise |
| Python | one registry per worker under Gunicorn; scrapes see one worker |
| Python | fourteen default buckets, not eleven |
| Java | `simpleclient` is a dead end; 1.x is `io.prometheus.metrics.*` |
| Node | a missing `await` serves `[object Promise]` with a 200 |

## Porting Snip: what to check afterward

Port the three families into your language, point a scrape job at the result,
and then confirm the port rather than assume it. Four checks, in order.

Count the bucket boundaries. It must be **14** — thirteen finite bounds and
`+Inf`. Any other number means you took the library's defaults:

```promql
count(
  count by (le) (snip_http_request_duration_seconds_bucket)
)
```

Confirm the boundary the SLO is read off. This must return rows, or every
recording rule in `lab/prometheus/rules/snip-recording.yml` goes blank:

```promql
snip_http_request_duration_seconds_bucket{le="0.3"}
```

Count the label combinations. It must be **12**, the closed set of Chapter 7 —
not more, which means a raw path leaked into `route`, and not fewer, which
means you dropped the pre-initialized zeros of Chapter 9, "Ratios, Arithmetic,
and the Series That Isn't There":

```promql
count(
  count by (route, method, code) (snip_http_requests_total)
)
```

Finally, read the exposition by hand and check that it carries
`# TYPE snip_http_requests_total counter` and `# HELP` text identical to the
table at the top of this appendix. A type that disagrees with a name is
Chapter 4's planted bug, and it is the one defect no PromQL query will report
to you.

If all four hold, nothing else in the lab needs to know which language you
used. That is the whole point of the contract.
