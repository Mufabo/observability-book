# Research Dossier — Client Libraries and Instrumentation APIs

**Topic owner:** instrumentation / client libraries
**Research date:** 2026-07-27 / 2026-07-28
**Book:** *Observability with Prometheus and Grafana: A Hands-On Introduction*
**Status of this document:** ground truth for later chapters. Everything below was verified live against primary
sources on the research date unless explicitly marked **UNVERIFIED** or **CHECK BEFORE PRESS**.

> **Reader model reminder.** The book's reader is a working developer with no ops background. They do not know
> what a time series is. Every API detail in this dossier must be introduced against the running lab stack, not
> as reference material. This dossier is deliberately over-complete; the chapters will use maybe 40% of it.

---

## 0. Version snapshot (as of 2026-07-27)

| Component | Current version | Released | Notes |
|---|---|---|---|
| Prometheus server | **3.13.1** | 2026-07-10 | 3.13.0 was 2026-07-01 |
| Alertmanager | **0.33.1** | 2026-07-04 | still 0.x |
| node_exporter | **1.12.1** | 2026-07-14 | |
| Pushgateway | **1.11.3** | 2026-05-27 | |
| Go: `github.com/prometheus/client_golang` | **v1.24.1** | 2026-07-23 | v1.24.0 was 2026-07-20 |
| Python: `prometheus-client` | **0.26.0** | 2026-07-24 | still 0.x, requires Python `>=3.9` |
| Java: `io.prometheus:prometheus-metrics-*` | **1.8.0** | 2026-06-11 | the 1.x rewrite; **this is current** |
| Java (legacy): `io.prometheus:simpleclient` | 0.16.0 | 2022 | **dead end**, see §4 |
| Node: `prom-client` | **15.1.3** | 2024-06-27 | ⚠️ **no release in ~2 years**, see §5 |
| OTel Go SDK metric (`go.opentelemetry.io/otel/sdk/metric`) | **v1.44.0** | 2026-05-27 | |
| OTel Go Prometheus exporter (`go.opentelemetry.io/otel/exporters/prometheus`) | **v0.66.0** | 2026-05-27 | still 0.x — **not stable** |
| `github.com/prometheus/otlptranslator` | **v1.0.0** | 2025-09-09 | shared OTLP→Prom naming library |
| OpenMetrics text | **1.0.0** stable / **2.0.0-rc0 EXPERIMENTAL** (March 2026) | | see §8 |

**CHECK BEFORE PRESS:** all of the above. Pin them in one `versions.md` and re-verify at copy-edit time. The Go
client and the Python client both shipped releases within the last week of research — this ecosystem moves.

---

## 1. Go — `prometheus/client_golang`

### 1.1 Module, version, Go compatibility

```
go get github.com/prometheus/client_golang@v1.24.1
```

Import path is unchanged and **still v1** — there is no `/v2` module path. Anyone telling you to import
`github.com/prometheus/client_golang/v2` is wrong; that module does not exist. (There *is* an internal "v2"
*API namespace* inside the v1 module — `prometheus.V2.NewDesc(...)`, `prometheus.V2.NewHistogramVec(...)` —
which is a naming trick to add wider option structs without breaking v1 compatibility. Do not confuse the two.)

Go version support, from the v1.24.0 release notes verbatim:

> "Minimum required Go version is now 1.25, only the two latest Go versions (1.25 and 1.26) are supported"

The README states the general policy: *"This library supports the two most recent major releases of Go."*
This is a rolling requirement — a `client_golang` bump can break a build on an older toolchain. Worth a
callout box in the book: pin `client_golang` in `go.mod` and bump deliberately.

### 1.2 The four building blocks

Four metric types exist in the Go client. The book should introduce them in this order:

| Type | Constructor | What it means | Suffix convention |
|---|---|---|---|
| Counter | `prometheus.NewCounter` / `NewCounterVec` | monotonically increasing total; resets to 0 on process restart | `_total` |
| Gauge | `prometheus.NewGauge` / `NewGaugeVec` | a value that goes up and down | unit suffix, no `_total` |
| Histogram | `prometheus.NewHistogram` / `NewHistogramVec` | bucketed distribution, aggregatable across instances | `_seconds` / `_bytes` |
| Summary | `prometheus.NewSummary` / `NewSummaryVec` | client-side quantiles | `_seconds` |

**Teaching note:** Summary is the one to *de-emphasise*. Client-side quantiles cannot be aggregated across
instances — you cannot average a p99. The book should show Summary once, explain why it's a trap, and then
never use it again. Histograms (classic or native) are the right default.

### 1.3 Registries and `promauto`

Two registries matter:

- `prometheus.DefaultRegisterer` / `prometheus.DefaultGatherer` — the package-level globals. `promhttp.Handler()`
  serves `DefaultGatherer`. The default registry is **pre-populated** with the Go collector and the process
  collector (see §1.7).
- `prometheus.NewRegistry()` — a clean, empty registry. **This is what the book should teach**, because it
  makes the "what am I actually exposing?" question answerable, and because it is what tests need.

`promauto` is a convenience wrapper whose constructors register-and-panic-on-failure. The package's own docs
are unusually blunt about the risk:

> "Registration may fail if a metric inconsistent with or equal to a newly registered one already exists...
> panicking is problematic because... with the global registry, simply importing a package can trigger a panic...
> Use promauto responsibly! Conservative users should ignore it entirely."

The idiomatic modern pattern is `promauto.With(reg)` — a factory bound to an explicit registry:

```go
var (
	reg     = prometheus.NewRegistry()
	factory = promauto.With(reg)

	randomNumbers = factory.NewHistogram(prometheus.HistogramOpts{
		Name:    "random_numbers",
		Help:    "A histogram of normally distributed random numbers.",
		Buckets: prometheus.LinearBuckets(-3, .1, 61),
	})
	requestCount = factory.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests by status code and method.",
		},
		[]string{"code", "method"},
	)
)
```

**Book recommendation:** teach `promauto.With(reg)` inside a struct constructor, not in a package-level `var`
block. Package-level `var` + global registry is exactly the combination the docs warn about, and it makes the
metric un-testable. Something like:

```go
type Metrics struct {
	Requests *prometheus.CounterVec
	Duration *prometheus.HistogramVec
	InFlight prometheus.Gauge
}

func NewMetrics(reg prometheus.Registerer) *Metrics {
	f := promauto.With(reg)
	return &Metrics{
		Requests: f.NewCounterVec(prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests.",
		}, []string{"code", "method"}),
		Duration: f.NewHistogramVec(prometheus.HistogramOpts{
			Name:                        "http_request_duration_seconds",
			Help:                        "Duration of HTTP requests in seconds.",
			NativeHistogramBucketFactor: 1.1,
			Buckets:                     prometheus.DefBuckets,
		}, []string{"code", "method"}),
		InFlight: f.NewGauge(prometheus.GaugeOpts{
			Name: "http_requests_in_flight",
			Help: "Number of HTTP requests currently being served.",
		}),
	}
}
```

Full `promauto` surface (both top-level functions on the default registry and identical methods on `Factory`):

```go
func With(r prometheus.Registerer) Factory

func NewCounter(opts prometheus.CounterOpts) prometheus.Counter
func NewCounterFunc(opts prometheus.CounterOpts, function func() float64) prometheus.CounterFunc
func NewCounterVec(opts prometheus.CounterOpts, labelNames []string) *prometheus.CounterVec
func NewGauge(opts prometheus.GaugeOpts) prometheus.Gauge
func NewGaugeFunc(opts prometheus.GaugeOpts, function func() float64) prometheus.GaugeFunc
func NewGaugeVec(opts prometheus.GaugeOpts, labelNames []string) *prometheus.GaugeVec
func NewHistogram(opts prometheus.HistogramOpts) prometheus.Histogram
func NewHistogramVec(opts prometheus.HistogramOpts, labelNames []string) *prometheus.HistogramVec
func NewSummary(opts prometheus.SummaryOpts) prometheus.Summary
func NewSummaryVec(opts prometheus.SummaryOpts, labelNames []string) *prometheus.SummaryVec
func NewUntypedFunc(opts prometheus.UntypedOpts, function func() float64) prometheus.UntypedFunc
```

### 1.4 `Opts`, and the `Unit` field (new-ish)

```go
type Opts struct {
	Namespace   string
	Subsystem   string
	Name        string
	Help        string
	ConstLabels Labels
	Unit        string
}

type CounterOpts Opts
type GaugeOpts   Opts
type UntypedOpts Opts
```

The fully-qualified name is `Namespace_Subsystem_Name` joined with `_`. `Unit` is a **metadata** field: it
populates the OpenMetrics `# UNIT` line. It does **not** append a suffix to the metric name for you — you still
write `Name: "http_request_duration_seconds"` yourself. This is a very common misreading; call it out.

There is also a descriptor-level option added in v1.24.0:

```go
type DescOpt func(*Desc)

func WithUnit(unit string) DescOpt {
	return func(d *Desc) {
		d.unit = unit
	}
}

// used via the V2 namespace:
func (v2) NewDesc(fqName, help string, variableLabels ConstrainableLabels, constLabels Labels, opts ...DescOpt) *Desc
```

v1.24.0 also added a public `func (d *Desc) Err() error` so custom collectors can surface descriptor
construction errors instead of silently exporting an invalid metric.

### 1.5 Histograms: classic buckets

```go
var DefBuckets = []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10}
```

Doc comment: *"The default buckets are tailored to broadly measure the response time (in seconds) of a network
service."* Note there are **11** finite buckets plus an implicit `+Inf`. You never write `+Inf` yourself:

> "There is no need to add a highest bucket with +Inf bound, it will be added implicitly. If Buckets is left as
> nil or set to a slice of length zero, it is replaced by default buckets."

Bucket helpers:

```go
func LinearBuckets(start, width float64, count int) []float64
func ExponentialBuckets(start, factor float64, count int) []float64
func ExponentialBucketsRange(minBucket, maxBucket float64, count int) []float64
```

`ExponentialBucketsRange` is the friendliest for a textbook ("give me 12 buckets from 1ms to 10s") and is
under-taught in older material.

**Correctness detail the book must get right:** Prometheus classic histogram buckets are **cumulative and
upper-inclusive** (`le`, "less than or equal"). `http_request_duration_seconds_bucket{le="0.1"}` is the count of
*all* observations ≤ 0.1s, not the count in the 0.05–0.1 band. `histogram_quantile()` interpolates linearly
*within* a bucket, so a p99 read off `DefBuckets` above 10s is pinned at the `+Inf` boundary and is
mathematically meaningless. This is the #1 source of "my p99 is exactly 10 seconds forever" confusion.

### 1.6 Histograms: native histograms

Native histograms are the significant thing that changed since every 2021-era book. **They are stable in the
Prometheus server as of v3.8.0.** In the Go client they are enabled *per metric* by setting
`NativeHistogramBucketFactor > 1`.

Complete `HistogramOpts` (verbatim field list, doc comments condensed):

```go
type HistogramOpts struct {
	Namespace string
	Subsystem string
	Name      string
	Help      string
	Unit      string
	ConstLabels Labels

	// Buckets defines the buckets into which observations are counted. Each
	// element in the slice is the upper inclusive bound of a bucket. The
	// values must be sorted in strictly increasing order. There is no need
	// to add a highest bucket with +Inf bound, it will be added
	// implicitly. If Buckets is left as nil or set to a slice of length
	// zero, it is replaced by default buckets.
	Buckets []float64

	// NativeHistogramBucketFactor enables sparse buckets when greater than
	// one. A Histogram with sparse buckets will be ingested as a Native
	// Histogram by Prometheus v2.40+. Sparse buckets are exponential,
	// covering the whole float64 range (except the zero bucket). The factor
	// provides an upper bound for bucket width growth.
	NativeHistogramBucketFactor float64

	NativeHistogramZeroThreshold    float64
	NativeHistogramMaxBucketNumber  uint32
	NativeHistogramMinResetDuration time.Duration
	NativeHistogramMaxZeroThreshold float64
	NativeHistogramMaxExemplars     int
	NativeHistogramExemplarTTL      time.Duration
}
```

Constants:

```go
const DefNativeHistogramZeroThreshold = 2.938735877055719e-39
const NativeHistogramZeroThresholdZero = -1
```

Semantics worth stating precisely:

- `NativeHistogramBucketFactor` — **the** switch. `> 1` turns native buckets on. The client rounds the factor
  up to the nearest supported *schema*. `1.1` is the canonical starting value (≈10% relative bucket width,
  schema 3) and is what the official `examples/nativehistogram` uses for latency.
- `NativeHistogramZeroThreshold` — observations with |value| ≤ threshold go in the zero bucket. Zero value means
  use `DefNativeHistogramZeroThreshold`. Set `NativeHistogramZeroThresholdZero` (= `-1`) for a zero-*width*
  bucket that only catches exact zeros.
- `NativeHistogramMaxBucketNumber` — 0 = unlimited. When exceeded, the client applies, in order: reset if
  `NativeHistogramMinResetDuration` has elapsed; else widen the zero bucket (up to
  `NativeHistogramMaxZeroThreshold`); else reduce resolution (drop schema).
- `NativeHistogramMaxExemplars` — 0 defaults to 10, negative disables. `NativeHistogramExemplarTTL` — 0 defaults
  to 5 minutes.

The official example (`examples/nativehistogram/main.go`) uses:

```go
requestDuration := prometheus.NewHistogram(prometheus.HistogramOpts{
	Name:                        "http_request_duration_seconds",
	Help:                        "HTTP request latency distribution.",
	NativeHistogramBucketFactor: 1.1,
})

responseSize := prometheus.NewHistogram(prometheus.HistogramOpts{
	Name:                            "http_response_size_bytes",
	Help:                            "HTTP response size distribution.",
	NativeHistogramBucketFactor:     1.5,
	NativeHistogramZeroThreshold:    1,
	NativeHistogramMaxBucketNumber:  100,
	NativeHistogramMinResetDuration: 15 * time.Minute,
})
```

**Dual exposition.** If you set *both* `Buckets` and `NativeHistogramBucketFactor`, the metric carries both
representations and Prometheus takes whichever the exposition format delivers. This is the recommended
migration posture and what the book's lab should do, so the same code works whether or not the reader has
native histograms enabled on their server.

#### Native histograms and the wire format — the gotcha

Native histograms are **not representable in the classic Prometheus text exposition format**. From the
Prometheus native histograms spec:

> "the classic Prometheus text form was not extended for native histograms, and such an extension is not planned."

So: if the reader `curl`s `/metrics` and sees only `_bucket{le=...}` lines, that is expected and correct. The
native buckets only appear when the scraper negotiates a format that can carry them:

- **Protobuf** — what the Go client has always used internally. The scraper's Accept header is
  `application/vnd.google.protobuf;proto=io.prometheus.client.MetricFamily;encoding=delimited;q=0.7,text/plain;version=0.0.4;q=0.3`.
- **OpenMetrics 2.0 text** — new, EXPERIMENTAL (see §8). This is what will eventually make native histograms
  `curl`-visible.

To make `curl` show native buckets today, the reader must ask for protobuf explicitly. This deserves a boxed
"why can't I see it?" sidebar; it will otherwise eat an hour of a reader's evening.

#### Server-side enablement — this changed recently

- Prometheus **< 3.8**: `--enable-feature=native-histograms`.
- Prometheus **3.8**: native histograms declared **stable**. New scrape-config setting `scrape_native_histograms`
  introduced. The feature flag is *not* a no-op in 3.8 — it flips the default of `scrape_native_histograms` to
  `true`.
- Prometheus **3.9+** (and therefore 3.13.x, what the book targets): the feature flag is a **complete no-op**;
  the default of `scrape_native_histograms` is **always `false`**. You must set it explicitly.

So the lab's `prometheus.yml` needs, per job (or globally):

```yaml
scrape_configs:
  - job_name: demo-app
    scrape_native_histograms: true
    static_configs:
      - targets: ["app:8080"]
```

Related scrape-config knobs (all default `0`/inherit-from-global):

```yaml
native_histogram_bucket_limit: 0        # cap on positive+negative buckets in one native histogram; 0 = no limit
native_histogram_min_bucket_factor: 0   # lower limit for bucket-to-bucket growth factor
always_scrape_classic_histograms: <global>   # also scrape classic parts even when native is present
convert_classic_histograms_to_nhcb: <global> # convert classic histograms to native-with-custom-buckets
```

For remote write, native histograms additionally require `send_native_histograms` in the remote-write config.

**Schema numbers:** valid exponential schemas are **-4 to +8**; **-53** is reserved for NHCB (native histogram
with custom buckets). Schemas -9..+52 are reserved for future standard schemas. NHCBs are *not* mergeable
across differing boundary layouts — a real limitation worth one sentence.

### 1.7 Built-in collectors — `prometheus/collectors`

The old `prometheus.NewGoCollector()` / `prometheus.NewProcessCollector()` / `prometheus.NewBuildInfoCollector()`
/ `prometheus.NewExpvarCollector()` are **deprecated**. The current home is the `collectors` subpackage:

```go
import "github.com/prometheus/client_golang/prometheus/collectors"

func NewGoCollector(opts ...func(o *internal.GoCollectorOptions)) prometheus.Collector
func NewProcessCollector(opts ProcessCollectorOpts) prometheus.Collector
func NewBuildInfoCollector() prometheus.Collector
func NewDBStatsCollector(db *sql.DB, dbName string) prometheus.Collector
func NewExpvarCollector(exports map[string]*prometheus.Desc) prometheus.Collector
```

```go
type ProcessCollectorOpts struct {
	PidFn        func() (int, error) // defaults to os.Getpid()
	Namespace    string
	ReportErrors bool
}
```

Go collector options:

```go
func WithGoCollectorRuntimeMetrics(rules ...GoRuntimeMetricsRule) func(*internal.GoCollectorOptions)
func WithoutGoCollectorRuntimeMetrics(matchers ...*regexp.Regexp) func(*internal.GoCollectorOptions)
func WithGoCollectorMemStatsMetricsDisabled() func(*internal.GoCollectorOptions)
func WithGoCollections(flags GoCollectionOption) // DEPRECATED
```

Predefined rule variables (each wraps an RE2 over the `runtime/metrics` namespace):

```go
var (
	MetricsAll       // regexp.MustCompile("/.*")
	MetricsGC        // regexp.MustCompile("^/gc/.*")
	MetricsMemory    // regexp.MustCompile("^/memory/.*")
	MetricsScheduler // regexp.MustCompile("^/sched/.*")
	MetricsDebug     // regexp.MustCompile("^/godebug/.*")
)
```

Example from the official docs:

```go
prometheus.MustRegister(collectors.NewGoCollector(
	collectors.WithGoCollectorMemStatsMetricsDisabled(),
	collectors.WithGoCollectorRuntimeMetrics(
		collectors.MetricsScheduler,
		collectors.MetricsMemory,
	),
	collectors.WithoutGoCollectorRuntimeMetrics(regexp.MustCompile("^/gc/.*")),
))
```

Important behaviour for the lab: `prometheus.NewRegistry()` gives you a registry with **nothing** in it — no
`go_*`, no `process_*`. The `DefaultRegisterer` has them pre-registered. If the book teaches a custom registry
(it should), it must also teach:

```go
reg := prometheus.NewRegistry()
reg.MustRegister(
	collectors.NewGoCollector(),
	collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
)
```

Otherwise the reader's dashboards for `process_resident_memory_bytes` will be mysteriously empty.

`NewProcessCollector` works on Linux-style procfs and on Windows. macOS/Darwin support for the process
collector was added in v1.21.0. In the book's Docker-based lab this is a non-issue (containers are Linux).

v1.24.0 added six new Go 1.26 runtime metrics for goroutine and thread tracking. v1.20.0 removed
`go_memstat_lookups_total` and added `go_gc_gogc_percent`, `go_gc_gomemlimit_bytes`,
`go_sched_gomaxprocs_threads` to the defaults — if a 2022-era dashboard is broken, this is usually why.

### 1.8 Exemplars

Exemplars link a metric sample to a trace. Two interfaces:

```go
type ExemplarAdder interface {
	AddWithExemplar(value float64, exemplar Labels)
}

type ExemplarObserver interface {
	ObserveWithExemplar(value float64, exemplar Labels)
}
```

Doc comment on the counter implementation, verbatim and load-bearing:

> "AddWithExemplar works like Add but also replaces the currently saved exemplar (if any) with a new one,
> created from the provided value, the current time as timestamp, and the provided labels. Empty Labels will
> lead to a valid (label-less) exemplar. But if Labels is nil, the current exemplar is left in place.
> AddWithExemplar panics if the value is < 0, if any of the provided labels are invalid, or if the provided
> labels contain more than 128 runes in total."

Three things a textbook usually gets wrong here:

1. `nil` labels ≠ empty labels. `nil` leaves the previous exemplar untouched; `prometheus.Labels{}` installs a
   label-less exemplar.
2. The **128-rune total** limit is an OpenMetrics 1.0 hard cap and the Go client enforces it with a **panic**.
   OpenMetrics 2.0 relaxes this to soft guidance, but the Go client's runtime check is what bites you.
3. A **classic** histogram stores at most **one exemplar per bucket**, replaced on each observation. A **native**
   histogram stores up to `NativeHistogramMaxExemplars` (default 10) with a TTL
   (`NativeHistogramExemplarTTL`, default 5m). Native-histogram exemplars arrived in v1.22.0/v1.23.0.

Exemplars are only emitted on the wire when OpenMetrics (or protobuf) is negotiated:

```go
http.Handle("/metrics", promhttp.HandlerFor(reg, promhttp.HandlerOpts{
	EnableOpenMetrics: true,
}))
```

`EnableOpenMetrics: true` is **required**. Without it the handler serves plain text 0.0.4 and silently drops
exemplars. And on the server side the reader needs `--enable-feature=exemplar-storage`. Two switches, both
easy to miss — the book should show both together.

The official `examples/exemplars/main.go` uses the exemplar label key `"dummyID"`. **The book should not copy
that.** Use `trace_id` (and optionally `span_id`) — those are the W3C-aligned keys OpenMetrics 2.0 recommends
and the keys Grafana's exemplar → trace datasource linking expects by default.

Manual usage:

```go
hist.(prometheus.ExemplarObserver).ObserveWithExemplar(
	elapsed.Seconds(),
	prometheus.Labels{"trace_id": traceID, "span_id": spanID},
)
```

Note the type assertion: `prometheus.Histogram` does not itself expose `ObserveWithExemplar`; you assert to
`prometheus.ExemplarObserver`. Same for counters via `prometheus.ExemplarAdder`. For a `*HistogramVec`, call
`.With(labels)` first and assert on the returned `Observer`.

### 1.9 `promhttp` — exposing metrics

```go
func Handler() http.Handler
func HandlerFor(reg prometheus.Gatherer, opts HandlerOpts) http.Handler
func HandlerForTransactional(reg prometheus.TransactionalGatherer, opts HandlerOpts) http.Handler
func InstrumentMetricHandler(reg prometheus.Registerer, handler http.Handler) http.Handler
```

`Handler()` = `HandlerFor(prometheus.DefaultGatherer, HandlerOpts{})` wrapped in `InstrumentMetricHandler`. It
is *already* instrumented (it exports `promhttp_metric_handler_requests_total` and
`promhttp_metric_handler_requests_in_flight`). `HandlerFor` is **not** — wrap it yourself if you want those.

```go
type HandlerOpts struct {
	ErrorLog                            Logger
	ErrorHandling                       HandlerErrorHandling
	Registry                            prometheus.Registerer
	DisableCompression                  bool
	OfferedCompressions                 []Compression
	MaxRequestsInFlight                 int
	CoalesceGather                      bool
	Timeout                             time.Duration
	EnableOpenMetrics                   bool
	EnableOpenMetricsTextCreatedSamples bool
	ProcessStartTime                    time.Time
}
```

New in v1.24.0:
- **`CoalesceGather`** — deduplicates concurrent `Gather()` calls so multiple simultaneous scrapes share one
  collection cycle instead of piling up goroutines. Worth mentioning for anyone scraping the same target from
  two Prometheus servers (HA pairs).
- Handlers now support metric filtering via repeated `name[]` query parameters:
  `curl 'localhost:8080/metrics?name[]=http_requests_total&name[]=up'`. Handy for a "just show me this one
  metric" teaching moment.

Compression: since **v1.22.0** zstd support is **opt-in** and requires a blank import:

```go
import _ "github.com/prometheus/client_golang/prometheus/promhttp/zstd"
```

Anyone who upgraded from v1.21 and lost zstd negotiation hit this. Probably a footnote, not body text.

### 1.10 The idiomatic HTTP middleware pattern

The canonical chain, reconstructed from the package's own `ExampleInstrumentHandlerDuration`:

```go
inFlightGauge := prometheus.NewGauge(prometheus.GaugeOpts{
	Name: "in_flight_requests",
	Help: "A gauge of requests currently being served by the wrapped handler.",
})

counter := prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "api_requests_total",
		Help: "A counter for requests to the wrapped handler.",
	},
	[]string{"code", "method"},
)

duration := prometheus.NewHistogramVec(
	prometheus.HistogramOpts{
		Name:    "request_duration_seconds",
		Help:    "A histogram of latencies for requests.",
		Buckets: []float64{.25, .5, 1, 2.5, 5, 10},
	},
	[]string{"handler", "method"},
)

responseSize := prometheus.NewHistogramVec(
	prometheus.HistogramOpts{
		Name:    "response_size_bytes",
		Help:    "A histogram of response sizes for requests.",
		Buckets: []float64{200, 500, 900, 1500},
	},
	[]string{},
)

reg.MustRegister(inFlightGauge, counter, duration, responseSize)

pushChain := promhttp.InstrumentHandlerInFlight(inFlightGauge,
	promhttp.InstrumentHandlerDuration(duration.MustCurryWith(prometheus.Labels{"handler": "push"}),
		promhttp.InstrumentHandlerCounter(counter,
			promhttp.InstrumentHandlerResponseSize(responseSize, pushHandler),
		),
	),
)
```

Full middleware set:

```go
func InstrumentHandlerDuration(obs prometheus.ObserverVec, next http.Handler, opts ...Option) http.HandlerFunc
func InstrumentHandlerCounter(counter *prometheus.CounterVec, next http.Handler, opts ...Option) http.HandlerFunc
func InstrumentHandlerInFlight(g prometheus.Gauge, next http.Handler) http.Handler
func InstrumentHandlerRequestSize(obs prometheus.ObserverVec, next http.Handler, opts ...Option) http.HandlerFunc
func InstrumentHandlerResponseSize(obs prometheus.ObserverVec, next http.Handler, opts ...Option) http.Handler
func InstrumentHandlerTimeToWriteHeader(obs prometheus.ObserverVec, next http.Handler, opts ...Option) http.HandlerFunc
```

Client side (for outbound HTTP — a nice chapter-6-ish topic):

```go
func InstrumentRoundTripperDuration(obs prometheus.ObserverVec, next http.RoundTripper, opts ...Option) RoundTripperFunc
func InstrumentRoundTripperCounter(counter *prometheus.CounterVec, next http.RoundTripper, opts ...Option) RoundTripperFunc
func InstrumentRoundTripperInFlight(gauge prometheus.Gauge, next http.RoundTripper) RoundTripperFunc
func InstrumentRoundTripperTrace(it *InstrumentTrace, next http.RoundTripper) RoundTripperFunc
```

#### The magic-label rule — must be stated explicitly

From the `InstrumentHandlerDuration` doc comment, verbatim:

> "The ObserverVec must have valid metric and label names and must have zero, one, or two non-const
> non-curried labels. For those, the only allowed label names are 'code' and 'method'."

This is the single most surprising thing about `promhttp` middleware and it **panics at registration/wrap time**
if violated. Consequences the book should spell out:

- You may use `"code"`, `"method"`, both, or neither. Nothing else.
- Extra dimensions must be supplied via `MustCurryWith` (as `"handler"` is in the example above) or as
  `ConstLabels`.
- Also verbatim: *"If the wrapped Handler does not set a status code, a status code of 200 is assumed."* and
  *"If the wrapped Handler panics, no values are reported."* / *"...the Counter is not incremented."* — so a
  panicking handler is invisible to these middlewares. Recovery middleware must sit *inside* the chain, or you
  need a separate panic counter.
- Implementation note: the label check works by feeding a sentinel `magicString` through the vec and inspecting
  which label slots come back changed. Not reader-facing, but it explains the otherwise-cryptic panic text.

#### Per-route labels: `http.route`, not `http.path`

`promhttp` gives you `code` and `method` only. A `handler`/`route` label is almost always wanted, and the book
must teach the *templated route* (`/users/{id}`), never the raw path (`/users/8f3c...`), or cardinality
explodes. With `net/http`'s Go 1.22+ pattern router or chi/gorilla, curry the route in per-route:

```go
mux.Handle("GET /users/{id}",
	promhttp.InstrumentHandlerDuration(
		duration.MustCurryWith(prometheus.Labels{"handler": "GET /users/{id}"}),
		usersHandler,
	),
)
```

#### Dynamic labels and exemplars via options

```go
type LabelValueFromCtx     func(ctx context.Context) string
type LabelValueFromRequest func(request *http.Request) string

func WithExtraMethods(methods ...string) Option
func WithLabelFromCtx(name string, valueFn LabelValueFromCtx) Option
func WithLabelFromRequest(name string, valueFn LabelValueFromRequest) Option
func WithExemplarFromContext(getExemplarFn func(requestCtx context.Context) prometheus.Labels) Option
func WithExemplarFromRequest(getExemplarFn func(req *http.Request) prometheus.Labels) Option
```

`WithLabelFromCtx` / `WithLabelFromRequest` are the sanctioned escape hatch from the code/method restriction.
`WithExemplarFromContext` is the clean way to wire OTel trace IDs into exemplars without touching handler code:

```go
promhttp.InstrumentHandlerDuration(duration, next,
	promhttp.WithExemplarFromContext(func(ctx context.Context) prometheus.Labels {
		if sc := trace.SpanContextFromContext(ctx); sc.IsSampled() {
			return prometheus.Labels{"trace_id": sc.TraceID().String()}
		}
		return nil // nil => leave existing exemplar alone
	}),
)
```

v1.24.0 fixed a real bug here: `InstrumentHandlerDuration` and `InstrumentHandlerCounter` used to **panic** when
handed an observer that doesn't implement the exemplar interfaces; they now fall back to the plain path.
If the book's code targets ≥ v1.24.0 this is a non-issue, but a reader on an older pin may hit it.

### 1.11 Wrapping registries and collectors

```go
func WrapRegistererWith(labels Labels, reg Registerer) Registerer
func WrapRegistererWithPrefix(prefix string, reg Registerer) Registerer
func WrapCollectorWith(labels Labels, c Collector) Collector          // added v1.23.0
func WrapCollectorWithPrefix(prefix string, c Collector) Collector    // added v1.23.0
```

The registry wrappers add ConstLabels / a name prefix to everything registered through them. Useful for
subsystem isolation. **Anti-pattern warning for the book:** do *not* use `WrapRegistererWith` to stamp
`env="prod"` or `instance=` onto every metric. Those belong as **target labels** applied by the Prometheus
server via relabeling — the `HistogramOpts.ConstLabels` doc says so directly:

> "ConstLabels are only used rarely. In particular, do not use them to attach the same labels to all your
> metrics. Those use cases are better covered by target labels set by the scraping Prometheus server, or by one
> specific metric (e.g. a build_info or a machine_role metric)."

### 1.12 Testing instrumentation — `prometheus/testutil`

Worth a short section in the book; it's the thing that makes instrumentation feel like real engineering rather
than print-debugging.

- `testutil.ToFloat64(c prometheus.Collector) float64` — read a single-series metric's current value.
- `testutil.CollectAndCount(c prometheus.Collector, metricNames ...string) int` — count series.
- `testutil.CollectAndCompare(c prometheus.Collector, expected io.Reader, metricNames ...string) error` —
  compare against a text-format golden fixture.
- `testutil.GatherAndCompare(g prometheus.Gatherer, expected io.Reader, metricNames ...string) error`
- `testutil.CollectAndLint` / `GatherAndLint` — run the promlint naming rules in a unit test. **This is the
  cheapest possible way to enforce the naming conventions in §6.** Strongly recommend the book shows this.
- `testutil.CollectAndFormat` and `ScrapeAndCompare` were added in v1.20.0.

**UNVERIFIED:** exact current signatures of the `testutil` functions above were not re-fetched from
pkg.go.dev in this pass; they are from prior knowledge of the package. Verify before writing the chapter.

### 1.13 Other notable Go-client changes since the "old books"

- **v1.24.0** — name validation now *always* uses the UTF-8 scheme; the deprecated global
  `model.NameValidationScheme` is gone. Default observable behaviour unchanged, but legacy validation is no
  longer enforced at metric-construction time. If a book/blog tells you to set
  `model.NameValidationScheme = model.LegacyValidation`, that is dead code now.
- **v1.24.0** — a collector that panics during `Gather()` now returns an error instead of crashing the process.
- **v1.21.0** — relaxed UTF-8 validation for names (tracking prometheus/common); `BuildFQName` ~30% faster;
  concurrent metric ops ~50% faster under contention; created-timestamp support for OpenMetrics ("not
  recommended due to cardinality increases").
- **v1.22.0** — context-aware `Push` methods; zstd moved behind a blank import.
- **v1.23.0** — `WrapCollectorWith*`; native-histogram exemplars.

---

## 2. Minimal idiomatic Go program (book-ready)

```go
package main

import (
	"log"
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
	reg := prometheus.NewRegistry()
	reg.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)
	f := promauto.With(reg)

	requests := f.NewCounterVec(prometheus.CounterOpts{
		Name: "demo_http_requests_total",
		Help: "Total number of HTTP requests served.",
	}, []string{"code", "method"})

	duration := f.NewHistogramVec(prometheus.HistogramOpts{
		Name:                        "demo_http_request_duration_seconds",
		Help:                        "Duration of HTTP requests in seconds.",
		Buckets:                     prometheus.DefBuckets,
		NativeHistogramBucketFactor: 1.1,
	}, []string{"code", "method"})

	inFlight := f.NewGauge(prometheus.GaugeOpts{
		Name: "demo_http_requests_in_flight",
		Help: "Number of HTTP requests currently being served.",
	})

	app := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(50 * time.Millisecond)
		w.Write([]byte("hello\n"))
	})

	instrumented := promhttp.InstrumentHandlerInFlight(inFlight,
		promhttp.InstrumentHandlerDuration(duration,
			promhttp.InstrumentHandlerCounter(requests, app),
		),
	)

	http.Handle("/", instrumented)
	http.Handle("/metrics", promhttp.HandlerFor(reg, promhttp.HandlerOpts{
		EnableOpenMetrics: true,
	}))

	log.Fatal(http.ListenAndServe(":8080", nil))
}
```

Exposes: `demo_http_requests_total{code,method}`, `demo_http_request_duration_seconds_{bucket,sum,count}`
(plus native buckets over protobuf), `demo_http_requests_in_flight`, all `go_*` and `process_*`.

---

## 3. Python — `prometheus_client`

```
pip install prometheus-client   # 0.26.0, requires Python >=3.9
```

Note the **hyphen** on PyPI (`prometheus-client`) and the **underscore** on import (`prometheus_client`). Still
a `0.x` version number after a decade; it is nonetheless the official library and is production-grade.

Canonical three-liner from the docs:

```python
from prometheus_client import start_http_server, Summary
import random
import time

REQUEST_TIME = Summary('request_processing_seconds', 'Time spent processing request')

@REQUEST_TIME.time()
def process_request(t):
    time.sleep(t)

if __name__ == '__main__':
    start_http_server(8000)
    while True:
        process_request(random.random())
```

**Do not reproduce this in the book as-is** — it teaches `Summary` as the default, which contradicts §1.2. Use
`Histogram` instead.

### 3.1 Default buckets differ from Go — verbatim from source

```python
DEFAULT_BUCKETS = (.005, .01, .025, .05, .075, .1, .25, .5, .75, 1.0, 2.5, 5.0, 7.5, 10.0, INF)
```

**This is 14 finite buckets + explicit `INF`, versus Go's 11 + implicit `+Inf`.** Python adds `.075`, `.75`,
`7.5`, and requires `INF` to be present explicitly in a custom bucket tuple. If a book claims "all client
libraries use the same default buckets", it is wrong. This trips people building cross-language dashboards
with hardcoded `le` values.

### 3.2 API surface

```python
def __init__(self, name: str, documentation: str, labelnames: Iterable[str] = (),
             namespace: str = '', subsystem: str = '', unit: str = '',
             registry: Optional[CollectorRegistry] = REGISTRY,
             _labelvalues: Optional[Sequence[str]] = None,
             buckets: Sequence[Union[float, str]] = DEFAULT_BUCKETS)
```

Types: `Counter`, `Gauge`, `Summary`, `Histogram`, `Info`, `Enum`.
`Info` exposes key-value metadata (`.info({...})`, sample value always `1.0`); `Enum` exposes which of a set of
states is active (`.state("running")`). Neither has a Go equivalent — Go users hand-roll `*_info` gauges.

Exemplars are first-class parameters:

```python
def inc(self, amount: float = 1, exemplar: Optional[Dict[str, str]] = None) -> None
def observe(self, amount: float, exemplar: Optional[Dict[str, str]] = None) -> None
```

Idiomatic Flask-style minimal example for the book:

```python
from prometheus_client import Counter, Histogram, make_wsgi_app, REGISTRY
from werkzeug.middleware.dispatcher import DispatcherMiddleware

REQUESTS = Counter(
    "demo_http_requests_total",
    "Total number of HTTP requests served.",
    ["code", "method"],
)
DURATION = Histogram(
    "demo_http_request_duration_seconds",
    "Duration of HTTP requests in seconds.",
    ["code", "method"],
)

# expose at /metrics alongside the app
app.wsgi_app = DispatcherMiddleware(app.wsgi_app, {"/metrics": make_wsgi_app()})
```

Exporters shipped in-tree: `start_http_server` (standalone thread), `make_wsgi_app`, `make_asgi_app`, plus
Flask / Django / FastAPI / AIOHTTP integrations (Django and AIOHTTP exporters added in 0.24.0).

### 3.3 Multiprocess mode — the Python-specific trap

Under Gunicorn/uWSGI with multiple worker processes, each worker has its own in-process registry, so a scrape
hits one random worker and returns one worker's numbers. The fix is multiprocess mode:

- set `PROMETHEUS_MULTIPROC_DIR` to a writable directory (must be **cleared on startup**),
- build the registry with `CollectorRegistry()` + `multiprocess.MultiProcessCollector(registry)`,
- call `multiprocess.mark_process_dead(pid)` from the worker-exit hook.

Caveats to state plainly: gauges need an explicit `multiprocess_mode` (`'all'`, `'liveall'`, `'min'`, `'max'`,
`'sum'`, `'mostrecent'`, `'livemostrecent'`); the `_created` series and exemplars behave differently; and the
`process_*` / `go_*`-equivalent collectors are per-process. This is the single biggest "my Python metrics are
wrong" cause in the wild and deserves a real sidebar.

**UNVERIFIED:** the exact current list of `multiprocess_mode` values above is from prior knowledge, not
re-fetched. Verify against the client_python docs before writing.

### 3.4 Native histograms and OpenMetrics 2.0 in Python

- **0.22.0** — native histogram support in the OpenMetrics *parser*; exemplar support on
  `CounterMetricFamily`; build moved from `setup.py` to `pyproject.toml`; **Python 3.8 support removed**
  (breaking).
- **0.23.0** (Sept 2025) — **UTF-8 content negotiation** and UTF-8 metric names/values; **OpenMetrics text
  exposition for native histograms**, emitted *only when OM 2.0.0 is requested*; ASGI query-string fix.
- **0.24.0** (Jan 2026) — AIOHTTP and Django exporters, `remove_matching()` for deleting label sets,
  pushgateway compression.
- **0.25.0** (Apr 2026) — pushgateway grouping-key spacing fix; `MultiProcessCollector` usable in a
  `RestrictedRegistry`.
- **0.26.0** (Jul 2026) — `Timer` context managers expose the measured duration; specific exception type for
  duplicate timeseries; exemplar operator-precedence fix; `floatToGoString` no longer emits a leading zero in
  exponents ≥ 10.

So Python **can** emit native histograms, but via the OM 2.0 *text* path, not protobuf, and only when the
scraper negotiates `version=2.0.0`. Given OM 2.0 is still `2.0.0-rc0` EXPERIMENTAL, **the book should treat
native histograms as a Go/Java feature and mention Python's OM-2.0 path as forward-looking.**

⚠️ **Date discrepancy:** GitHub's rendered release page returned 2024 years for several of these releases
(e.g. "v0.23.0 — September 11, 2024") while PyPI's machine-readable index gives 2025/2026 dates
(0.23.1 → 2025-09-18, 0.26.0 → 2026-07-24). PyPI is authoritative here; the GitHub-derived years above were
corrected. **CHECK BEFORE PRESS** if any specific date is printed.

---

## 4. Java — `client_java` 1.x is current; `simpleclient` is the old world

**Say this unambiguously in the book.** There are two incompatible Prometheus Java clients:

| | Old | Current |
|---|---|---|
| Artifact | `io.prometheus:simpleclient` (+ `simpleclient_hotspot`, `simpleclient_httpserver`, `simpleclient_servlet`) | `io.prometheus:prometheus-metrics-core` (+ `-instrumentation-jvm`, `-exporter-httpserver`) |
| Last version | **0.16.0** (2022) | **1.8.0** (2026-06-11) |
| Package root | `io.prometheus.client.*` | `io.prometheus.metrics.*` |
| Status | deprecated, no new features | active |

1.0.0 was a **complete rewrite of the underlying data model and is not backward compatible** with 0.16.0 and
older. Packages were renamed so that no Java package is shared across two Maven modules (the old layout broke
JPMS/module-info). A bridge module, **`prometheus-metrics-simpleclient-bridge`**, lets an old
`CollectorRegistry` be exposed through the new `PrometheusRegistry` so you can migrate the exporter first and
the instrumentation later.

### 4.1 Coordinates

```xml
<dependency>
    <groupId>io.prometheus</groupId>
    <artifactId>prometheus-metrics-core</artifactId>
    <version>1.8.0</version>
</dependency>
<dependency>
    <groupId>io.prometheus</groupId>
    <artifactId>prometheus-metrics-instrumentation-jvm</artifactId>
    <version>1.8.0</version>
</dependency>
<dependency>
    <groupId>io.prometheus</groupId>
    <artifactId>prometheus-metrics-exporter-httpserver</artifactId>
    <version>1.8.0</version>
</dependency>
```

BOM (preferred, so the three stay in lockstep):

```xml
<dependency>
    <groupId>io.prometheus</groupId>
    <artifactId>prometheus-metrics-bom</artifactId>
    <version>1.8.0</version>
    <type>pom</type>
    <scope>import</scope>
</dependency>
```

Gradle:

```gradle
implementation 'io.prometheus:prometheus-metrics-core:1.8.0'
implementation 'io.prometheus:prometheus-metrics-instrumentation-jvm:1.8.0'
implementation 'io.prometheus:prometheus-metrics-exporter-httpserver:1.8.0'
```

### 4.2 Minimal program (official quickstart, verbatim)

```java
import io.prometheus.metrics.core.metrics.Counter;
import io.prometheus.metrics.exporter.httpserver.HTTPServer;
import io.prometheus.metrics.instrumentation.jvm.JvmMetrics;

import java.io.IOException;

public class App {

    public static void main(String[] args) throws InterruptedException, IOException {

        JvmMetrics.builder().register();

        Counter counter = Counter.builder()
                .name("my_count_total")
                .help("example counter")
                .labelNames("status")
                .register();

        counter.labelValues("ok").inc();
        counter.labelValues("ok").inc();
        counter.labelValues("error").inc();

        HTTPServer server = HTTPServer.builder()
                .port(9400)
                .buildAndStart();

        System.out.println("HTTPServer listening on port http://localhost:" +
          server.getPort() + "/metrics");

        Thread.currentThread().join();
    }
}
```

Note the API shape: **everything is a builder**, `labelValues(...)` (not `labels(...)`), and `JvmMetrics` is the
equivalent of Go's Go+Process collectors.

### 4.3 Histograms in Java 1.x — native by default

This is a genuine difference from Go and a good "the ecosystem has moved" moment for the book. From the source:

```java
public static final double[] DEFAULT_CLASSIC_UPPER_BOUNDS =
    new double[] {.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10};

private static final double DEFAULT_NATIVE_MIN_ZERO_THRESHOLD = Math.pow(2.0, -128);
private static final double DEFAULT_NATIVE_MAX_ZERO_THRESHOLD = Math.pow(2.0, -128);
private static final int    DEFAULT_NATIVE_INITIAL_SCHEMA = 5;
private static final int    DEFAULT_NATIVE_MAX_NUMBER_OF_BUCKETS = 160;
private static final long   DEFAULT_NATIVE_RESET_DURATION_SECONDS = 0;
```

The default classic bounds **match Go's `DefBuckets` exactly** (11 buckets). And the default builder produces
**both** classic and native representations — `getDefaultProperties()` sets `histogramNativeOnly(false)` and
`histogramClassicOnly(false)`. Prometheus then takes whichever the negotiated exposition format can carry. So
in Java you get native histograms with **zero configuration**; in Go you must opt in with
`NativeHistogramBucketFactor`.

Builder methods:

```java
Histogram duration = Histogram.builder()
    .name("http_request_duration_seconds")
    .classicUpperBounds(0.01, 0.05, 0.1, 0.5, 1.0)
    .register();
```

- `classicUpperBounds(double...)`
- `classicLinearUpperBounds(start, width, count)`
- `classicExponentialUpperBounds(start, factor, count)`
- `nativeOnly()` / `classicOnly()`
- `nativeInitialSchema(int)` (default 5)
- `nativeMaxNumberOfBuckets(int)` (default 160)

Other types: `Counter.builder()`, `Gauge.builder()`, `Summary.builder().quantile(0.95, 0.005)`,
`Info.builder()`, `StateSet.builder()`. Units are typed: `.unit(Unit.SECONDS)`, `.unit(Unit.CELSIUS)`.

Example from the docs:

```java
Counter serviceTimeSeconds = Counter.builder()
    .name("service_time_seconds_total")
    .help("total time spent serving requests")
    .unit(Unit.SECONDS)
    .register();

Gauge temperature = Gauge.builder()
    .name("temperature_celsius")
    .labelNames("location")
    .unit(Unit.CELSIUS)
    .register();
```

### 4.4 Java exemplars — automatic

The Java client **automatically detects OpenTelemetry tracing on the classpath and creates exemplars when a
metric is updated inside a sampled span.** No code change required. It also marks the span with the attribute
`exemplar="true"` so an OTel sampling policy can retain exemplar-bearing traces. The default exemplar sampler
can be disabled through the `ExemplarConfig` API.

**UNVERIFIED:** the precise class name of the properties object (`ExemplarsProperties` vs `ExemplarConfig`) and
its config-key prefix (`io.prometheus.exemplars.*`) were not confirmed from a primary source in this pass.
Verify at prometheus.github.io/client_java before naming it in print.

### 4.5 Recent Java releases

- **1.4.0** — UTF-8 support for metric and label names (backwards compatible).
- **1.5.0** — big contention improvements: histogram/summary ~185% (classic) and ~92% (native) under high
  contention.
- **1.7.0** (2026-06-03) — typed metric family descriptors; `StableApi` marker + API diff check.
- **1.8.0** (2026-06-11) — custom labels on exemplars; `MetricMetadata.Builder`; wider constructors deprecated.

### 4.6 Spring Boot / Micrometer caveat

Spring Boot exposes Prometheus metrics through **Micrometer**, not directly through `client_java`. Micrometer
1.13+ has a `micrometer-registry-prometheus` built on client_java 1.x (the older one used simpleclient 0.16).
If the book mentions Spring Boot at all, it must say: you configure Micrometer, and Micrometer's naming
conventions (dots → underscores, automatic base-unit suffixes) sit between your code and the `/metrics` output.

**UNVERIFIED:** exact Micrometer version boundaries. Do not print a version number without re-checking.

---

## 5. Node — `prom-client`

```
npm install prom-client
```

Module name is exactly `prom-client`:

```js
const client = require('prom-client');
```

⚠️ **State of the project (important, and easy to get wrong).** The newest published release is **15.1.3
(2024-06-27)** — roughly two years old as of press time. The repository's `CHANGELOG.md` has a substantial
`[Unreleased]` 16.x section (drops Node 16/18/20/21/23; replaces the internal hashMap storage with a `LabelMap`;
counter exemplars report the actual value instead of the delta; adds event-loop-utilization to default metrics;
adds a `WorkerRegistry`; claims 20–45% faster stat recording and 60% faster aggregation) but **v16 has not
shipped to npm**. Do not write "prom-client 16" in the book. If the book recommends anything for Node beyond
prom-client, the honest alternative today is the OpenTelemetry JS SDK with a Prometheus exporter (§7).

`package.json` for 15.1.3: `engines.node` = `^16 || ^18 || >=20`; dependencies `@opentelemetry/api ^1.4.0` and
`tdigest ^0.1.1`; entry points `index.js` / `index.d.ts`; Apache-2.0.

### 5.1 Default metrics and metric creation

```js
const client = require('prom-client');

const collectDefaultMetrics = client.collectDefaultMetrics;

collectDefaultMetrics();
```

With an explicit registry:

```js
const client = require('prom-client');
const register = new client.Registry();
client.collectDefaultMetrics({ register });
```

```js
const counter = new client.Counter({
  name: 'metric_name',
  help: 'metric_help',
  labelNames: ['method', 'statusCode'],
});
counter.inc({ method: 'GET', statusCode: '200' });

const gauge = new client.Gauge({
  name: 'metric_name',
  help: 'metric_help',
  labelNames: ['method', 'statusCode'],
});
gauge.set({ method: 'GET', statusCode: '200' }, 100);

const histogram = new client.Histogram({
  name: 'metric_name',
  help: 'metric_help',
  buckets: [0.1, 5, 15, 50, 100, 500],
  labelNames: ['method'],
});
histogram.observe({ method: 'GET' }, 10);
```

Default histogram buckets, verbatim from `lib/histogram.js`:

```js
buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
```

**Same as Go's `DefBuckets`.** (Python is the odd one out — see §3.1.)

### 5.2 Exposing the endpoint

The README is explicit: *"The library does not bundle any web framework. To expose the metrics, respond to
Prometheus's scrape requests with the result of `await registry.metrics()`."* So the Express snippet is
yours to write:

```js
const express = require('express');
const client = require('prom-client');

const app = express();

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

app.listen(8080);
```

`register.metrics()` returns a **Promise** — forgetting `await` yields `[object Promise]` in the response body.
Very common beginner failure; worth one line.

### 5.3 Exemplars and clustering in prom-client

Exemplars require switching the registry to the OpenMetrics content type:

```js
client.register.setContentType(client.Registry.OPENMETRICS_CONTENT_TYPE);

const histogram = new client.Histogram({
  name: 'request_duration',
  help: 'Request duration in seconds',
  enableExemplars: true,
});

histogram.observe({
  labels: { method: 'GET' },
  value: 0.5,
  exemplarLabels: { traceId: 'abc123', spanId: 'def456' },
});
```

**UNVERIFIED:** the exact option key (`enableExemplars` vs `exemplars`) and the `observe({labels, value,
exemplarLabels})` object form were summarised from the README by a fetch that also hallucinated a package name
in the same response. **Do not print this snippet without opening the README and copying it by hand.**

For clustered Node, `client.AggregatorRegistry` aggregates worker registries in the primary; per-metric
aggregation is chosen with `aggregator: 'sum' | 'first' | 'min' | 'max' | 'average' | 'omit'`. Same conceptual
problem as Python multiprocess mode (§3.3).

**UNVERIFIED:** whether a `ClusterRegistry` type exists in 15.1.3 (one fetch mentioned it, another did not).
`AggregatorRegistry` is the long-standing name. Verify.

### 5.4 Naming caution for Node

`prom-client` does **no** name normalisation. `labelNames: ['statusCode']` produces a literal `statusCode`
label — camelCase, which is legal but violates Prometheus convention (§6). The book should use `code` /
`status_code` and explicitly note that the README's own example is not convention-compliant.

---

## 6. Official naming conventions

Primary source: <https://prometheus.io/docs/practices/naming/>.

### 6.1 Metric names — the rules, close to verbatim

A metric name:

1. must comply with the data model's valid-character rules;
2. **"SHOULD have a (single-word) application prefix relevant to the domain the metric belongs to"** —
   e.g. `prometheus_notifications_total`, `process_cpu_seconds_total`, `http_request_duration_seconds`;
3. **"MUST refer to a single unit (e.g. do not mix seconds with milliseconds) and to a single quantity"**;
4. **"SHOULD use base units (e.g. seconds, bytes, meters - not milliseconds, megabytes, kilometers)"**;
5. **"SHOULD have a suffix describing the unit, in plural form"**;
6. may order name components for lexicographic grouping convenience;
7. **"SHOULD represent the same logical thing-being-measured across all label dimensions."**

### 6.2 Base units table

| Family | Base unit | Remark |
|---|---|---|
| Time | `seconds` | |
| Temperature | `celsius` | preferred over kelvin |
| Length | `meters` | |
| Bytes | `bytes` | |
| Bits | `bytes` | always use bytes, to avoid confusion |
| Percent | `ratio` | values 0–1, **not** 0–100 |
| Voltage | `volts` | |
| Electric current | `amperes` | |
| Energy | `joules` | export as a counter; `rate()` then yields watts |
| Mass | `grams` | preferred over kilograms |

The `ratio` row is a frequent violation. `cpu_usage_percent` at value `85` is wrong; `cpu_usage_ratio` at `0.85`
is right. Grafana formats it back to 85% at display time with the `percentunit` unit.

### 6.3 Suffix conventions

| Suffix | Meaning | Example |
|---|---|---|
| `_total` | cumulative counter | `http_requests_total` |
| `_seconds` | duration/time, base unit | `http_request_duration_seconds` |
| `_bytes` | size, base unit | `process_resident_memory_bytes` |
| `_ratio` | 0–1 fraction | `node_cpu_utilization_ratio` |
| `_info` | metadata pseudo-metric, value always 1 | `foobar_build_info`, `go_build_info`, `target_info` |
| `_timestamp_seconds` | a Unix timestamp | `process_start_time_seconds` |
| `_created` | OM 1.0 creation timestamp series | (being replaced by inline `st@` in OM 2.0) |

Auto-generated by histograms/summaries — **never write these yourself**: `_bucket` (with the `le` label),
`_sum`, `_count`; summaries additionally use the `quantile` label.

Order for a histogram: `<name>_<unit>` then the generated suffix →
`http_request_duration_seconds_bucket`. The unit suffix always comes *before* the type suffix. Same rule in
the OTLP translation spec: *"The unit suffix comes before any type-specific suffixes."*

### 6.4 Labels — what belongs in a label vs the name

Labels differentiate characteristics of the same measured thing:

- `api_http_requests_total` with `operation="create|update|delete"`
- `api_request_duration_seconds` with `stage="extract|transform|load"`

The core rule, verbatim:

> "Do not put the label names in the metric name, as this introduces redundancy and will cause confusion if the
> respective labels are aggregated away."

So: `http_requests_total{method="GET"}` — **not** `http_get_requests_total`. The reason is the aggregation
test: if you `sum()` away the label, the remaining name must still be true. `sum(http_requests_total)` is
"total HTTP requests" ✓. `sum(http_get_requests_total)` would claim to be GET requests while actually summing
everything ✗.

Corollaries the book should state as a checklist:

- **Never put a unit in a label.** No `{unit="seconds"}`, no `{unit="ms"}`. The unit belongs in the metric name
  (and, optionally, in the OpenMetrics `# UNIT` metadata via `Opts.Unit` / `.unit(Unit.SECONDS)`). Mixing units
  within one metric name violates rule 3 in §6.1 outright.
- **Never put the metric type in a label.**
- **Reserved:** label names beginning with `__` are reserved for internal Prometheus use. `__name__` is the
  metric name. `job` and `instance` are set by the scrape config — don't emit them from the client.
- Label *names* are `snake_case`. Label *values* are arbitrary UTF-8 strings and are the high-cardinality risk.
- Don't emit `instance`, `env`, `region`, `cluster` from application code. Those are **target labels**, applied
  by the Prometheus server via `relabel_configs` / `external_labels`. Duplicating them in the client makes
  federation and multi-environment dashboards painful. (See the `ConstLabels` doc quote in §1.11.)

### 6.5 UTF-8 names — new, and a trap

Prometheus 3.x and the current clients accept **UTF-8** metric and label names beyond the classic
`[a-zA-Z_:][a-zA-Z0-9_:]*`. `client_golang` v1.24.0 dropped the legacy validation switch entirely; Java gained
UTF-8 in 1.4.0; Python in 0.23.0. UTF-8 names must be **quoted** in PromQL:

```promql
{"http.server.request.duration_seconds", job="demo"}
```

**Book guidance:** mention it, do not build on it. Dotted OTel-style names inside Prometheus require quoted
selectors everywhere, break most existing dashboards and recording rules, and are only worth it in an
OTel-native shop. The default `UnderscoreEscapingWithSuffixes` translation strategy (§7.4) exists precisely so
you don't have to.

### 6.6 `__type__` / `__unit__` labels (PROM-39) — forward-looking

Prometheus has an experimental feature flag `type-and-unit-labels` implementing PROM-39: Prometheus injects
reserved `__type__` and `__unit__` labels sourced from exposition metadata (OpenMetrics text, Prometheus text,
Prometheus proto, Remote Write 2.0, OTLP). Purpose: select metrics by type/unit, and disambiguate series that
share a name but differ in type or unit. Any user-supplied `__type__`/`__unit__` labels are overridden. PromQL
treats them like `__name__` (dropped by `+`/`-`, affected by `promql-delayed-name-removal`). Still stabilising.
**One paragraph in a "where this is going" section; not a lab exercise.**

---

## 7. Cardinality — current guidance

### 7.1 The official numbers

From <https://prometheus.io/docs/practices/instrumentation/>, verbatim:

> "try to keep the cardinality of your metrics below 10, and for metrics that exceed that, aim to limit them to
> a handful across your whole system."

> "If you have a metric that has a cardinality over 100 or the potential to grow that large, investigate
> alternate solutions."

> "Each labelset is an additional time series that has RAM, CPU, disk, and network costs."

And from the naming page:

> "Remember that every unique combination of key-value label pairs represents a new time series, which can
> dramatically increase the amount of data stored. Do not use labels to store dimensions with high cardinality
> (many different label values), such as user IDs, email addresses, or other unbounded sets of values."

**Framing for a no-ops reader:** cardinality is *multiplicative*. One histogram with `DefBuckets` (11 + `+Inf`
= 12 bucket series, plus `_sum` and `_count` = **14 series per label combination**), crossed with
`method` (5 values) × `code` (6 values) × `route` (40 values) = 1,200 combos × 14 = **16,800 series from one
metric**. Add a `user_id` label with 100k values and you have 1.68 *billion*. This arithmetic, worked in the
book, does more than any amount of warning prose.

### 7.2 The label-admission test (book-ready heuristic)

Add a label only if **all** of these hold:

1. The set of possible values is **bounded and known at deploy time** (an enum, not user input).
2. You would actually **filter or group by it** in a query or alert.
3. It does not identify an individual user, request, session, or entity.
4. It is not derivable from an existing target label.

Fails the test, almost always: `user_id`, `email`, `session_id`, `request_id`, `trace_id`, `order_id`, full
`url`/`path` (use the templated `route`), raw `error_message` (use a bounded `error_type`/`reason`), IP address,
unbounded `pod` names emitted from inside the app, timestamps, UUIDs.

**Trace IDs go in exemplars, not labels.** That is exactly what exemplars are for, and it is the cleanest way to
teach the distinction.

### 7.3 Server-side limits (defence in depth)

All available in `scrape_configs` (and in `global:` as defaults). Verbatim descriptions:

```yaml
sample_limit: 0
# "Per-scrape limit on the number of scraped samples that will be accepted. If more than this
#  number of samples are present after metric relabeling the entire scrape will be treated as
#  failed. 0 means no limit."

label_limit: 0
# "Limit on the number of labels that will be accepted per sample. If more than this number of
#  labels are present on any sample post metric-relabeling, the entire scrape will be treated
#  as failed. 0 means no limit."

label_name_length_limit: 0
# "Limit on the length (in bytes) of each individual label name... 0 means no limit."

label_value_length_limit: 0
# "Limit on the length (in bytes) of each individual label value... 0 means no limit."

target_limit: 0
# "Limit per scrape config on number of unique targets that will be accepted... 0 means no limit."

keep_dropped_targets: 0
# "Limit per scrape config on the number of targets dropped by relabeling that will be kept in
#  memory. 0 means no limit."
```

**All default to `0` = unlimited.** The lab should set `sample_limit` on purpose so the reader sees a target go
down and learns what that failure mode looks like. Note the semantics: exceeding `sample_limit` fails the
**entire scrape**, it does not truncate — the target's `up` goes to 0 and you lose *all* its metrics.

### 7.4 Diagnosing cardinality

- `/status/tsdb` in the Prometheus UI — top-10 series by metric name, by label name, by label-value pairs, plus
  total series count.
- `topk(10, count by (__name__)({__name__=~".+"}))` — series per metric name.
- `count(count by (some_label)(some_metric))` — distinct values of one label.
- `scrape_samples_scraped` / `scrape_samples_post_metric_relabeling` per target.
- `prometheus_tsdb_head_series` — total in-memory series; the single number to alert on.
- The `promtool tsdb analyze` subcommand on a block directory.
- Mitigations, in order of preference: fix the instrumentation → `metric_relabel_configs` with `labeldrop` /
  `drop` → recording rules to pre-aggregate → `sample_limit` as a circuit breaker.

**UNVERIFIED:** the exact `/status/tsdb` panel layout in the Prometheus 3.x UI (it was redesigned in 3.0) and
the precise `promtool tsdb analyze` flags. Screenshot/verify against 3.13.1 when writing.

---

## 8. Exposition formats (needed to explain why exemplars/native histograms "don't show up")

| Format | Content-Type / Accept | Carries exemplars? | Carries native histograms? |
|---|---|---|---|
| Prometheus text 0.0.4 | `text/plain; version=0.0.4` | ❌ | ❌ |
| OpenMetrics 1.0 text | `application/openmetrics-text; version=1.0.0; charset=utf-8` | ✅ (1 per sample, ≤128 runes) | ❌ |
| OpenMetrics 2.0 text | `application/openmetrics-text; version=2.0.0; charset=utf-8` | ✅ (multiple, timestamps mandatory) | ✅ |
| Prometheus protobuf | `application/vnd.google.protobuf;proto=io.prometheus.client.MetricFamily;encoding=delimited` | ✅ | ✅ |

### 8.1 OpenMetrics 2.0 — EXPERIMENTAL

Status line from the spec: **"Version: 2.0.0-rc0, Status: Experimental, Date: March 2026."** Breaking changes
are still possible. Changes that matter:

- **Composite values.** Histogram / GaugeHistogram / Summary collapse from many `_bucket`/`_sum`/`_count` lines
  into a single line with a braced structure. **Breaking.**
- **Inline start timestamps.** The separate `_created` series is gone; start timestamp moves inline as
  `st@<ts>`. Field order becomes `metric_name value [timestamp] [st@start_timestamp] [# exemplar...]`.
  Counters, histograms and summaries carry them; gauges do not. **Breaking.**
- **Native histograms in text**, with `schema`, `zero_threshold`, `zero_count`, and positive/negative
  span+bucket pairs. Exposers may emit native-only or classic+native. **Non-breaking addition.**
- **`_total` relaxed from MUST to SHOULD**: *"The MetricFamily name for Counters SHOULD end in `_total`."*
  Explicitly to accommodate OpenTelemetry. **This is a real change from OM 1.0 and older books state the MUST.**
- **Exemplars**: timestamps now **mandatory** (breaking); **multiple exemplars per sample** allowed
  (non-breaking); W3C keys `trace_id` / `span_id` recommended; the hard 128-character cap relaxed to soft
  guidance.
- **UTF-8 names**, with double-quote escaping for names containing non-ASCII/`.` characters.
- **Strict name matching** — implicit suffix stripping is removed; the sample name must match the MetricFamily
  name.
- **Protobuf is no longer officially specified for OM 2.0.**
- Exposers must **default to 1.0.0** unless the consumer explicitly negotiates 2.0.

Example exemplar line from the spec:

```
foo_total 17.0 1520879607.789 st@1520879607.789 # {trace_id="KOO5S4vxi0o"} 0.67 1520879606.1
```

**Book guidance:** OM 2.0 gets a "what's coming" box. The lab targets OM 1.0 + protobuf, which is what
Prometheus 3.13 and the Go client do today.

---

## 9. OpenTelemetry → Prometheus

There are **three** distinct paths and the book must keep them apart, because they have different naming,
different temporality behaviour, and different failure modes.

```
(A) OTel SDK ──► Prometheus exporter ──► /metrics ──scrape──► Prometheus
(B) OTel SDK ──OTLP──► Prometheus /api/v1/otlp/v1/metrics  (push)
(C) OTel SDK ──OTLP──► OTel Collector ──► prometheus exporter (pull)
                                      └─► prometheusremotewrite exporter (push)
```

### 9.1 Path A — OTel SDK with the Prometheus exporter (pull)

Go module: `go.opentelemetry.io/otel/exporters/prometheus` — **v0.66.0 (2026-05-27)**. Note the `v0`: this
exporter has been 0.x for years and is **not covered by OTel's stability guarantees**, unlike
`go.opentelemetry.io/otel/sdk/metric` (v1.44.0, stable). Say this in the book.

```go
func New(opts ...Option) (*Exporter, error)

func WithRegisterer(reg prometheus.Registerer) Option
func WithNamespace(ns string) Option
func WithProducer(producer metric.Producer) Option
func WithResourceAsConstantLabels(resourceFilter attribute.Filter) Option
func WithAggregationSelector(agg metric.AggregationSelector) Option
func WithTranslationStrategy(strategy otlptranslator.TranslationStrategyOption) Option
func WithoutScopeInfo() Option
func WithoutTargetInfo() Option

func WithoutCounterSuffixes() Option // DEPRECATED: use WithTranslationStrategy
func WithoutUnits() Option           // DEPRECATED: use WithTranslationStrategy
```

`WithoutUnits()` and `WithoutCounterSuffixes()` are **deprecated** as of the current version in favour of
`WithTranslationStrategy` — a lot of blog posts still show them. Two behaviours that surprise people:

- By default the exporter adds **scope labels** `otel_scope_name`, `otel_scope_version`,
  `otel_scope_schema_url` to *every* metric. That is up to three extra labels on every series, i.e. a real
  cardinality and dashboard-ergonomics cost. Disable with `WithoutScopeInfo()`.
- By default it emits a `target_info` metric carrying the resource attributes. Disable with
  `WithoutTargetInfo()`. `target_info` is how you join resource attributes back onto metrics; Prometheus has an
  experimental `info()` PromQL function for exactly that (behind `--enable-feature=promql-experimental-functions`):

  ```promql
  info(rate(http_server_request_duration_seconds_count[2m]), {k8s_cluster_name=~".+"})
  ```

Because path A is a *pull* path, temporality is forced to **cumulative** — the exporter is a Reader, and
delta would be meaningless for a scrape endpoint.

### 9.2 Path B — OTLP straight into Prometheus (push)

Prometheus has a native OTLP receiver. Enable with a **flag** (it is off by default):

```bash
prometheus --web.enable-otlp-receiver
```

Endpoint: `http://localhost:9090/api/v1/otlp/v1/metrics` (note the doubled `v1`; the SDK-side base is
`http://localhost:9090/api/v1/otlp` and the SDK appends `/v1/metrics`).

SDK-side environment configuration from the official guide:

```bash
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://localhost:9090/api/v1/otlp
export OTEL_TRACES_EXPORTER=none
export OTEL_LOGS_EXPORTER=none
export OTEL_METRIC_EXPORT_INTERVAL=15000
export OTEL_SERVICE_NAME="my-example-service"
export OTEL_RESOURCE_ATTRIBUTES="service.instance.id=$(uuidgen)"
```

Server-side `prometheus.yml`:

```yaml
otlp:
  promote_resource_attributes:
    - service.instance.id
    - service.name
    - service.namespace
    - service.version
    - cloud.availability_zone
    - cloud.region
    - k8s.cluster.name
    - k8s.namespace.name
    - k8s.pod.name
    - deployment.environment
  keep_identifying_resource_attributes: true
  translation_strategy: NoUTF8EscapingWithSuffixes

storage:
  tsdb:
    out_of_order_time_window: 30m
```

`out_of_order_time_window` matters because push from multiple collectors/replicas arrives out of order; without
it Prometheus rejects those samples.

**Push vs pull framing for the book:** OTLP-into-Prometheus inverts the model the rest of the book teaches. You
lose the free `up` metric, staleness handling changes, and `service.instance.id` becomes your identity instead
of the scrape target. Present it as an interop path for teams already standardised on OTel, not as the default.

### 9.3 Delta vs cumulative temporality

This is the concept most likely to be explained badly.

- **Cumulative** — every export carries the running total since process start. Prometheus's entire model
  (`rate()`, `increase()`, counter-reset detection) assumes this. Scraping is idempotent: a lost scrape costs
  you resolution, not data.
- **Delta** — each export carries only what happened since the last export. Common in StatsD/Graphite/DataDog
  lineage. A lost export is **permanently lost data**, and `rate()` over deltas is nonsense.

**Prometheus is cumulative. The OTel SDK default is also cumulative** (`DefaultTemporalitySelector` uses
`CumulativeTemporality` for all instrument kinds), so the happy path needs no configuration. The trouble starts
when someone sets the temporality preference for a different backend and then points it at Prometheus.

`OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` values:

| Value | Behaviour |
|---|---|
| `cumulative` | Cumulative for all instrument kinds. **Use this with Prometheus.** |
| `delta` | Delta for Counter, Asynchronous Counter and Histogram; Cumulative for UpDownCounter and Asynchronous UpDownCounter. |
| `lowmemory` | Delta for **synchronous** Counter and Histogram; Cumulative for synchronous UpDownCounter, Asynchronous Counter and Asynchronous UpDownCounter. |

Go SDK equivalents: `metric.DefaultTemporalitySelector`, `metric.DeltaTemporalitySelector`,
`metric.LowMemoryTemporalitySelector`, `metric.CumulativeTemporalitySelector`, wired via
`WithTemporalitySelector`. Note that `lowmemory` exists because cumulative state must be held *somewhere* — the
SDK holds it, unless you shift that cost to a collector.

If deltas do arrive, Prometheus can convert. Two **mutually exclusive** experimental flags:

```bash
prometheus --enable-feature=otlp-deltatocumulative      # convert delta -> cumulative on ingest
prometheus --enable-feature=otlp-native-delta-ingestion # store deltas natively
```

The docs are explicit that these two "cannot coexist". `otlp-deltatocumulative` embeds the
`deltatocumulative` processor from opentelemetry-collector-contrib.

Note also the spec's histogram rule: *"OpenTelemetry Histograms with Delta aggregation temporality MAY be
aggregated into a Cumulative aggregation temporality and follow the logic below, or MUST be dropped."* —
i.e. delta histograms can be silently dropped by a conforming implementation. Great debugging anecdote.

### 9.4 OTel → Prometheus name translation

The shared implementation is **`github.com/prometheus/otlptranslator` v1.0.0**, used by both Prometheus and the
OTel Collector, so the four strategies mean the same thing everywhere:

```go
var (
	NoUTF8EscapingWithSuffixes        TranslationStrategyOption = "NoUTF8EscapingWithSuffixes"
	UnderscoreEscapingWithSuffixes    TranslationStrategyOption = "UnderscoreEscapingWithSuffixes"
	UnderscoreEscapingWithoutSuffixes TranslationStrategyOption = "UnderscoreEscapingWithoutSuffixes"
	NoTranslation                     TranslationStrategyOption = "NoTranslation"
)

type MetricNamer struct {
	Namespace          string
	WithMetricSuffixes bool
	UTF8Allowed        bool
}

func NewMetricNamer(namespace string, strategy TranslationStrategyOption) MetricNamer
func (mn *MetricNamer) Build(metric Metric) (string, error)

type LabelNamer struct {
	UTF8Allowed                 bool
	UnderscoreLabelSanitization bool
	PreserveMultipleUnderscores bool
}
func (ln *LabelNamer) Build(label string) (string, error)
```

| Strategy | Escapes `.`→`_`? | Adds unit/`_total` suffixes? | Requires UTF-8 support |
|---|---|---|---|
| `UnderscoreEscapingWithSuffixes` (**default**) | yes | yes | no |
| `UnderscoreEscapingWithoutSuffixes` | yes | no | no |
| `NoUTF8EscapingWithSuffixes` | no | yes | yes |
| `NoTranslation` | no | no | yes (**experimental, may be removed**) |

Worked example from the package docs:

```go
namer := otlptranslator.NewMetricNamer("myapp", otlptranslator.UnderscoreEscapingWithSuffixes)
metric := otlptranslator.Metric{
	Name: "http.server.request.duration",
	Unit: "s",
	Type: otlptranslator.MetricTypeHistogram,
}
// -> "myapp_http_server_request_duration_seconds"
```

(`Build` actually returns `(string, error)`; the docs' one-liner elides the error.)

The underlying rules from the OTel spec:

- **Unit suffix.** UCUM units map to Prometheus words (`s`→`seconds`, `By`→`bytes`, `m`→`meters`, …). Rate units
  like `m/s` become `meters_per_second`. Bracketed annotation portions (e.g. `{packet}`) **MUST be dropped**.
  A suffix is added *"unless the metric name already ends with the unit (before type-specific suffixes)"*, and
  *"The unit suffix comes before any type-specific suffixes."*
- **`_total`.** *"If the metric name for monotonic Sum metric points does not end in a suffix of `_total` a
  suffix of `_total` SHOULD be added by default, otherwise the name MUST remain unchanged."*
- **Character sanitisation.** *"Discouraged characters in the metric name SHOULD be replaced with the `_`
  character by default"* and *"Multiple consecutive `_` characters SHOULD be replaced with a single `_`
  character."* Target alphabet: `[a-zA-Z_:]([a-zA-Z0-9_:])*`.
- **Resource → `target_info`.** *"an OpenTelemetry Resource SHOULD be converted to a `target` info metric if
  the resource is not empty"*, and that metric *"MUST be an info-typed metric whose labels MUST include the
  resource attributes, and MUST NOT include any other labels."*
- **`job` / `instance`.** *"the `service.name` and `service.namespace` attributes MUST be combined as
  `<service.namespace>/<service.name>`, or `<service.name>` if namespace is empty, to form the `job` metric
  label. The `service.instance.id` attribute, if present, MUST be converted to the `instance` label; otherwise,
  `instance` should be added with an empty value."*
- **Types.** Gauge → Gauge (exemplars dropped). Cumulative Histogram → classic Prometheus histogram.
  Summary → `quantile`-labelled series. **Exponential Histogram → Prometheus native histogram**, with OTel
  `Scale` mapped to native `Schema`; valid schema range −4…+8, out-of-range values downscaled or dropped.

Concrete end-to-end example worth printing in the book:

| OTel | Prometheus (`UnderscoreEscapingWithSuffixes`) |
|---|---|
| `http.server.request.duration` (Histogram, unit `s`) | `http_server_request_duration_seconds_bucket` / `_sum` / `_count` |
| `http.server.active_requests` (UpDownCounter, unit `{request}`) | `http_server_active_requests` (annotation dropped, no `_total`) |
| `messages.sent` (monotonic Sum, no unit) | `messages_sent_total` |
| resource `service.name=checkout`, `service.instance.id=abc` | `target_info{job="checkout", instance="abc", ...}` |
| attribute `http.response.status_code` | label `http_response_status_code` |

And the stable OTel HTTP semantic conventions the reader will actually meet:

- `http.server.request.duration` — Histogram, **seconds**, **stable**. Recommended boundaries
  `[0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10]`. Required attributes
  `http.request.method`, `url.scheme`; conditionally required `http.response.status_code`, `error.type`,
  `http.route`; recommended `network.protocol.version`.
- `http.client.request.duration` — Histogram, seconds, stable. Required `http.request.method`,
  `server.address`, `server.port`.
- `http.server.active_requests` — UpDownCounter, **development** stability.

Note that OTel's recommended HTTP buckets are **exactly Python's `DEFAULT_BUCKETS`**, not Go's `DefBuckets`.
Nice detail; explains a discrepancy readers will otherwise notice and not understand.

Also note `OTEL_SEMCONV_STABILITY_OPT_IN` — instrumentations use it to emit old and/or new convention names
during migrations, which is why a reader may see both `http_server_duration_milliseconds` (old) and
`http_server_request_duration_seconds` (new) from the same library.

### 9.5 Path C — via the OpenTelemetry Collector

`prometheusexporter` (contrib), **beta** for metrics, exposes a `/metrics` endpoint for Prometheus to scrape:

```yaml
exporters:
  prometheus:
    endpoint: "0.0.0.0:8889"
    namespace: myapp
    const_labels:
      env: lab
    send_timestamps: false          # default false
    metric_expiration: 5m           # default 5m
    resource_to_telemetry_conversion:
      enabled: false
    enable_open_metrics: false      # true => OpenMetrics format, enables exemplars
    translation_strategy: UnderscoreEscapingWithSuffixes
```

- `add_metric_suffixes` is **deprecated** in favour of `translation_strategy` — another thing older material
  gets wrong.
- The exporter supports **native histograms**, converting OTel exponential histograms automatically.
- `metric_expiration` (default 5m) is a real footgun: a metric that stops being pushed disappears from
  `/metrics` after 5 minutes, which looks like data loss to a reader used to scrape-based staleness.

`prometheusremotewrite` exporter is the push alternative (into Prometheus's remote-write endpoint, which itself
needs `--web.enable-remote-write-receiver`).

**UNVERIFIED:** the exact stability level of `prometheusremotewrite` today and its current full config surface;
not fetched in this pass.

### 9.6 Which should the book recommend?

For this book — a hands-on introduction where the reader instruments *their own* service — recommend
**native Prometheus client libraries** for the main track:

1. Fewer moving parts: no collector, no temporality question, no name translation layer, no `otel_scope_*`
   labels appearing in the reader's dashboards.
2. The names the reader writes are the names they query. That is enormously valuable pedagogically.
3. Native histograms work out of the box (Java) or with one field (Go).
4. Exemplars are a two-line change (`EnableOpenMetrics` + `--enable-feature=exemplar-storage`).

Cover OTel in a clearly-scoped chapter as (a) what to do when the metrics are already OTel, and (b) the
vendor-portability argument. Be even-handed: OTel's advantage is one instrumentation API across metrics, logs
and traces, and a large body of auto-instrumentation. Prometheus's advantage is that nothing sits between the
code and the query. PromLabs published a well-argued piece on this ("Why I recommend native Prometheus
instrumentation over OpenTelemetry", 2025-07-17) — cite it as a *position*, clearly attributed, not as neutral
documentation.

---

## 10. Beginner pitfalls (candidate sidebars)

1. **Counting with a Gauge.** If it can go down, it's a gauge; if it only accumulates, it's a counter. Using a
   gauge for a total breaks `rate()` and hides resets. Verbatim from the docs: *"If the value can go down, it is
   a gauge."*
2. **`_total` on things that aren't counters.** `queue_size_total` is a gauge wearing a counter's hat.
3. **`rate()` on a gauge**, or `sum()` before `rate()`. Always `rate()` first, then aggregate.
4. **A high-cardinality label added "just for debugging"** and never removed.
5. **Custom registry with no `go_*`/`process_*`** because `collectors.NewGoCollector()` was never registered.
6. **Exemplars invisible**: forgot `EnableOpenMetrics: true`, or forgot `--enable-feature=exemplar-storage`, or
   used `curl` without an OpenMetrics `Accept` header.
7. **Native histograms invisible**: text format cannot carry them; and on Prometheus ≥ 3.9 you must set
   `scrape_native_histograms: true` — the old `--enable-feature=native-histograms` flag is a no-op.
8. **`promhttp` middleware panic** because the vec has a label other than `code`/`method`. Use
   `MustCurryWith` or `WithLabelFromRequest`.
9. **Raw URL path as a label.** Use the templated route.
10. **Duplicate registration panic** from `promauto` at package-`var` init, often triggered merely by importing
    a package.
11. **Python multiprocess mode not configured** under Gunicorn → each scrape returns one random worker's view.
12. **`await` forgotten** on `register.metrics()` in Node → `[object Promise]` on `/metrics`.
13. **Milliseconds instead of seconds.** `Duration.Milliseconds()` instead of `.Seconds()`; then `DefBuckets`
    (tuned for seconds) puts everything in `+Inf`. Use `time.Since(start).Seconds()`.
14. **Percent instead of ratio.** Export 0–1 with `_ratio`, format at display time.
15. **Metric created inside the request handler.** Create once at startup; `.With()`/`.WithLabelValues()` per
     request. Creating a metric per request is both slow and a registration error.
16. **Unbounded `WithLabelValues` without `DeleteLabelValues`.** Series live in memory until process exit; a
     label value that stops occurring keeps its series forever until staleness kicks in on the server side.
17. **`ConstLabels` used for `env`/`region`/`instance`.** Those are target labels; set them in the scrape
     config.
18. **Assuming default buckets are identical across languages.** Python's differ from Go's and Node's.
19. **Summary quantiles averaged in a dashboard.** You cannot aggregate client-side quantiles. This is the
     entire reason histograms exist.
20. **`sample_limit` misunderstood** as truncation. It fails the whole scrape.

---

## 11. Stale advice to avoid (things older books/blogs say that are now wrong)

- ❌ `prometheus.NewGoCollector()` / `prometheus.NewProcessCollector()` — **deprecated**; use
  `collectors.NewGoCollector()` / `collectors.NewProcessCollector()`.
- ❌ `prometheus.NewBuildInfoCollector()` / `prometheus.NewExpvarCollector()` — same, moved to `collectors`.
- ❌ `collectors.WithGoCollections(...)` and the `GoRuntimeMemStatsCollection` / `GoRuntimeMetricsCollection`
  constants — deprecated; use `WithGoCollectorRuntimeMetrics()` / `WithGoCollectorMemStatsMetricsDisabled()`.
- ❌ "Prometheus histograms have fixed buckets you must choose up front" — no longer the whole story. Native
  histograms are **stable** since Prometheus 3.8.
- ❌ `--enable-feature=native-histograms` — on Prometheus ≥ 3.9 this is a **complete no-op**. Use
  `scrape_native_histograms: true` in the scrape config.
- ❌ `--enable-feature=extra-scrape-metrics` — deprecated; use the `extra_scrape_metrics` config option.
- ❌ `model.NameValidationScheme = model.LegacyValidation` — the global is gone as of client_golang v1.24.0;
  name validation always uses the UTF-8 scheme.
- ❌ Setting `NativeHistogramBucketFactor` and expecting to see it in `curl /metrics` text output. Not possible
  in the classic text format, by design.
- ❌ "OpenMetrics requires counters to end in `_total`" — that was OM 1.0's MUST. OM 2.0 relaxes it to SHOULD.
- ❌ Java: any use of `io.prometheus:simpleclient*` / `io.prometheus.client.*` packages. That's 0.16.0, from
  2022. Current is `io.prometheus:prometheus-metrics-*` / `io.prometheus.metrics.*` 1.8.0.
- ❌ Java: `counter.labels("ok")` — the 1.x API is `counter.labelValues("ok")`.
- ❌ OTel Go: `prometheus.WithoutUnits()` / `prometheus.WithoutCounterSuffixes()` — **deprecated**, use
  `WithTranslationStrategy(...)`.
- ❌ OTel Collector: `add_metric_suffixes` — deprecated, use `translation_strategy`.
- ❌ "Prometheus can't accept pushed OTLP" — it can, since 3.0, via `--web.enable-otlp-receiver`.
- ❌ "Prometheus can't handle delta temporality at all" — there are now two (mutually exclusive) experimental
  flags: `otlp-deltatocumulative` and `otlp-native-delta-ingestion`.
- ❌ Node: writing about "prom-client v16". It exists only as an `[Unreleased]` changelog section; npm's latest
  is 15.1.3 from June 2024.
- ❌ Go: `go get github.com/prometheus/client_golang/v2` — no such module.
- ❌ zstd "just works" in promhttp — since v1.22.0 it needs a blank import of
  `prometheus/promhttp/zstd`.
- ❌ Python 3.8 examples — dropped in prometheus-client 0.22.0; current floor is Python 3.9.
- ⚠️ Any claim that metric names must match `[a-zA-Z_:][a-zA-Z0-9_:]*` — still the *convention* and still the
  right advice, but no longer a hard constraint: UTF-8 names are accepted (and require quoted PromQL
  selectors).

---

## 12. Open items / to verify before writing

1. `prometheus/testutil` exact signatures (§1.12) — **UNVERIFIED**.
2. Python `multiprocess_mode` value list (§3.3) — **UNVERIFIED**.
3. Java exemplar config class name and property prefix (§4.4) — **UNVERIFIED**.
4. Micrometer version boundary for client_java 1.x (§4.6) — **UNVERIFIED**.
5. prom-client exemplar option key and `observe()` object form (§5.3) — **UNVERIFIED, high risk**; one fetch of
   that README hallucinated the package name as `@prometheus/client`, so treat everything from that response as
   suspect and re-read the README by hand.
6. Whether `ClusterRegistry` exists in prom-client 15.1.3 alongside `AggregatorRegistry` (§5.3) —
   **UNVERIFIED**.
7. Prometheus 3.x `/status/tsdb` UI layout and `promtool tsdb analyze` flags (§7.4) — **UNVERIFIED**.
8. `prometheusremotewrite` exporter stability and config (§9.5) — **UNVERIFIED**.
9. Exact release day of client_golang v1.24.1 — the GitHub releases page said 2026-07-23, a search snippet said
   2026-07-28. Prefer the releases page; re-verify.
10. Python release dates: GitHub's rendered release page returned 2024 years that contradict PyPI's index.
    PyPI used throughout §3.4; re-verify any date printed.
11. Confirm the OM 2.0 status has not moved past `2.0.0-rc0` by press time — it was rc0 in March 2026 and this
    is the fastest-moving item in the dossier.

---

## Sources

**Prometheus core**
- Downloads / current versions — https://prometheus.io/download/
- Metric and label naming — https://prometheus.io/docs/practices/naming/
- Naming, doc source — https://raw.githubusercontent.com/prometheus/docs/main/docs/practices/naming.md
- Instrumentation practices (cardinality) — https://prometheus.io/docs/practices/instrumentation/
- Configuration reference (scrape limits, native histogram settings) — https://prometheus.io/docs/prometheus/latest/configuration/configuration/
- Feature flags — https://prometheus.io/docs/prometheus/latest/feature_flags/
- Native histograms spec — https://prometheus.io/docs/specs/native_histograms/
- Prometheus 3.8.0 release (native histograms stable, `scrape_native_histograms`) — https://github.com/prometheus/prometheus/releases/tag/v3.8.0
- OpenMetrics 1.0 spec — https://prometheus.io/docs/specs/om/open_metrics_spec/
- OpenMetrics 2.0 spec (EXPERIMENTAL) — https://prometheus.io/docs/specs/om/open_metrics_spec_2_0/
- OpenMetrics 2.0 migration guide — https://prometheus.io/docs/guides/open_metrics_2_0_migration/
- Using Prometheus as your OpenTelemetry backend — https://prometheus.io/docs/guides/opentelemetry/
- PROM-39 type-and-unit-labels meta issue — https://github.com/prometheus/prometheus/issues/16610

**Go client**
- Repo — https://github.com/prometheus/client_golang
- Releases — https://github.com/prometheus/client_golang/releases
- v1.24.0 release notes — https://github.com/prometheus/client_golang/releases/tag/v1.24.0
- CHANGELOG — https://raw.githubusercontent.com/prometheus/client_golang/main/CHANGELOG.md
- `prometheus` package docs — https://pkg.go.dev/github.com/prometheus/client_golang/prometheus
- `promauto` package docs — https://pkg.go.dev/github.com/prometheus/client_golang/prometheus/promauto
- `promhttp` package docs — https://pkg.go.dev/github.com/prometheus/client_golang/prometheus/promhttp
- `collectors` package docs — https://pkg.go.dev/github.com/prometheus/client_golang/prometheus/collectors
- `histogram.go` source — https://raw.githubusercontent.com/prometheus/client_golang/main/prometheus/histogram.go
- `counter.go` source — https://raw.githubusercontent.com/prometheus/client_golang/main/prometheus/counter.go
- `desc.go` source (`WithUnit`, `Desc.Err`) — https://raw.githubusercontent.com/prometheus/client_golang/main/prometheus/desc.go
- `wrap.go` source — https://raw.githubusercontent.com/prometheus/client_golang/main/prometheus/wrap.go
- `promhttp/option.go` source — https://raw.githubusercontent.com/prometheus/client_golang/main/prometheus/promhttp/option.go
- `promhttp/instrument_server.go` source — https://raw.githubusercontent.com/prometheus/client_golang/main/prometheus/promhttp/instrument_server.go
- Examples index — https://github.com/prometheus/client_golang/tree/main/examples
- Native histogram example — https://raw.githubusercontent.com/prometheus/client_golang/main/examples/nativehistogram/main.go
- Exemplars example — https://raw.githubusercontent.com/prometheus/client_golang/main/examples/exemplars/main.go
- Instrumenting a Go application (guide) — https://prometheus.io/docs/guides/go-application/

**Python client**
- PyPI metadata — https://pypi.org/pypi/prometheus-client/json
- Docs — https://prometheus.github.io/client_python/
- Releases — https://github.com/prometheus/client_python/releases
- `metrics.py` source (DEFAULT_BUCKETS, exemplar signatures) — https://raw.githubusercontent.com/prometheus/client_python/master/prometheus_client/metrics.py

**Java client**
- Docs home — https://prometheus.github.io/client_java/
- Quickstart — https://prometheus.github.io/client_java/getting-started/quickstart/
- Metric types — https://prometheus.github.io/client_java/getting-started/metric-types/
- Releases — https://github.com/prometheus/client_java/releases
- simpleclient migration guide — https://github.com/prometheus/client_java/blob/main/docs/content/migration/simpleclient.md
- Tracing / exemplars — https://prometheus.github.io/client_java/otel/tracing/
- `Histogram.java` source (defaults) — https://raw.githubusercontent.com/prometheus/client_java/main/prometheus-metrics-core/src/main/java/io/prometheus/metrics/core/metrics/Histogram.java
- Grafana: Introducing the Prometheus Java client 1.0.0 — https://grafana.com/blog/introducing-the-prometheus-java-client-1-0-0/

**Node client**
- npm registry metadata — https://registry.npmjs.org/prom-client/latest
- Repo — https://github.com/siimon/prom-client
- Releases — https://github.com/siimon/prom-client/releases
- CHANGELOG — https://raw.githubusercontent.com/siimon/prom-client/master/CHANGELOG.md
- README (v15.1.3) — https://raw.githubusercontent.com/siimon/prom-client/v15.1.3/README.md
- `lib/histogram.js` (default buckets) — https://raw.githubusercontent.com/siimon/prom-client/v15.1.3/lib/histogram.js

**OpenTelemetry**
- Prometheus & OpenMetrics compatibility spec — https://opentelemetry.io/docs/specs/otel/compatibility/prometheus_and_openmetrics/
- OTLP metrics exporter spec (temporality preference) — https://opentelemetry.io/docs/specs/otel/metrics/sdk_exporters/otlp/
- HTTP metrics semantic conventions — https://opentelemetry.io/docs/specs/semconv/http/http-metrics/
- Go SDK metric — https://pkg.go.dev/go.opentelemetry.io/otel/sdk/metric
- Go Prometheus exporter — https://pkg.go.dev/go.opentelemetry.io/otel/exporters/prometheus
- `otlptranslator` — https://pkg.go.dev/github.com/prometheus/otlptranslator
- Collector prometheusexporter README — https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/prometheusexporter/README.md
- Grafana: delta vs cumulative temporality trade-offs — https://grafana.com/blog/opentelemetry-metrics-a-guide-to-delta-vs-cumulative-temporality-trade-offs/
- PromLabs: Why I recommend native Prometheus instrumentation over OpenTelemetry (opinion, 2025-07-17) — https://promlabs.com/blog/2025/07/17/why-i-recommend-native-prometheus-instrumentation-over-opentelemetry/
