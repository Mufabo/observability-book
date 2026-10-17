# Research Dossier: The Wider Observability Landscape in 2026

**Compiled:** 2026-07-27
**For:** *Observability with Prometheus and Grafana: A Hands-On Introduction*
**Scope:** Where metrics sit among everything else — three pillars and its critique, OpenTelemetry status,
Loki, Tempo, exemplars, correlation in Grafana, profiling, eBPF, and the honest limits of metrics.

> **How to read the confidence markers in this file**
> - Unmarked statements were verified against a primary source fetched live on 2026-07-27 (see Sources).
> - `UNVERIFIED` means I could not confirm it live and the textbook must re-check before printing.
> - `DATE-SOFT` means the *version number* is verified but the *release date* came from a GitHub
>   releases page that renders relative dates ("13 months ago"); the fetch layer resolved several of
>   these to 2024 in a way that contradicts other sources. Trust the version, re-check the date.

---

## 0. Version table — the ecosystem as of 2026-07-27

| Component | Version | Notes |
|---|---|---|
| Prometheus | **3.13.1** (2026-07-10) | 3.13.0 (2026-07-01) is the current **LTS**, supported through 2027-07-31. 3.5.x is the previous LTS line (3.5.5, 2026-07-09). |
| Grafana | **13.1.1** (2026-07-21) | Grafana 13.0 launched at GrafanaCON on 2026-04-21. 13.1.0 shipped 2026-07-01. |
| Grafana Loki | **3.7.4** (2026-07-24) | 3.7.0 released 2026-03-26. 3.6.x still maintained (3.6.13). Loki 4.0 not released. |
| Grafana Tempo | **3.0.2** | 3.0.0 was the big rearchitecture ("Project Rhythm"); TraceQL metrics GA. 2.10.x still patched. DATE-SOFT |
| Grafana Pyroscope | **2.2.0** (2026-07-21) | Pyroscope 2.0 announced 2026-04-21. |
| Grafana Alloy | **1.18.0** (2026-07-20) | Grafana's OpenTelemetry Collector distribution with Prometheus pipelines. |
| OpenTelemetry Collector | **v0.157.0** (2026-07-22) | **Still 0.x. There is no Collector 1.0.** |
| OTLP specification | **1.11.0** | Traces/metrics/logs Stable; profiles Development. |
| OTel semantic conventions | **1.43.0** (2026-07-03) | GenAI conventions were *moved out* to a separate repo in 1.42.0. |
| OTel eBPF Instrumentation (OBI) | **v0.10.0** | Formerly Grafana Beyla. Pre-1.0. DATE-SOFT |
| OpenTelemetry (project) | **CNCF Graduated** | Graduated 2026-05-21. |

### Things that do **not** exist yet (do not imply otherwise in the book)

- **OpenTelemetry Collector 1.0** — the Collector is still `v0.x`. Component stability is per-component.
- **Prometheus Remote-Write 2.0 as a stable spec** — the spec page is still headed `[EXPERIMENTAL]`.
- **A stable OTel profiles signal** — it is Alpha (public alpha), OTLP profiles is "Development".
- **Loki 4.0** — announced as a future release that will remove SSD mode; not out.
- **Stable GenAI semantic conventions** — still Development, and now in their own repo with no tagged release.

---

## 1. The "three pillars" framing, and the honest critique

### 1.1 Where the framing came from

The three-pillars idea is traceable to a specific, dated artifact: **Peter Bourgon's February 2017 blog post
"Metrics, tracing, and logging"** (peter.bourgon.org), written after the 2017 Distributed Tracing Summit. His
original post was a *Venn diagram* — he was mapping out an overlapping domain, not declaring three separate
load-bearing columns. The vendor ecosystem flattened the Venn diagram into "three pillars" because it mapped
neatly onto three product categories that already existed and three separate bills.

**Textbook accuracy note:** do not attribute "three pillars" to the CNCF, to Google's SRE book, or to
OpenTelemetry. It is a 2017 blog-post framing that escaped.

### 1.2 The critique (state it fairly — it is a real argument, not a strawman)

The best-known critic is **Charity Majors** (Honeycomb), whose position is usually labelled
**"observability 2.0"**. The argument, in the strongest form:

1. **Three pillars is a description of storage silos, not of a debugging workflow.** Metrics, logs, and traces
   in the pillar model are three *separate databases* with three separate query languages and three separate
   retention policies. You are the join key.
2. **Aggregation destroys context at write time.** A counter increment throws away everything about the
   request that caused it — user ID, tenant, region, feature flag, build SHA, cache hit/miss. That information
   is unrecoverable later. Charity's phrasing of this in 2026 material is that the model "eliminates context
   at write time, and no amount of AI-powered joining can restore what was never preserved."
3. **The alternative is one source of truth: wide, structured events.** Arbitrarily wide (hundreds of fields),
   high-cardinality, one event per unit of work, stored in a columnar database, from which metrics *and*
   traces can be derived. Traces in this model are just events with a trace ID and a parent ID.
4. **A commercial observation used as evidence:** roughly, every surviving observability startup founded
   before ~2021 uses the multi-pillar model; every surviving one founded after ~2021 uses unified wide-event
   columnar storage.

### 1.3 The counter-argument the book should also make (this keeps the book honest)

Do not let the critique read as "so Prometheus is obsolete." It isn't, and here is why:

- **Metrics are the only signal with a bounded, predictable cost curve.** A counter costs the same whether you
  serve 10 req/s or 100k req/s. Wide events cost per event. For "is the fleet up, is the disk filling,
  what is my p99," metrics are unbeatable on cost.
- **Metrics are the right substrate for alerting.** Alert rules need cheap, continuous, always-on evaluation
  over long windows. You do not want to alert by scanning an event store.
- **Metrics work where there is no request.** Kernel, disk, JVM heap, queue depth, certificate expiry, batch
  jobs, hardware. There is no "wide event" for "the disk is 91% full."
- **Charity's own framing concedes the split:** the pillar model "works fine for infrastructure but is
  catastrophic for software engineering use cases." That is exactly the boundary this book should teach.

**Recommended framing for the textbook:** metrics answer *"is something wrong, and roughly where?"* cheaply and
continuously. They cannot answer *"why, for whom, and in which code path?"* That second question is what
traces, wide events, and profiles exist for. Teach the handoff, not the tribalism.

---

## 2. What metrics genuinely CANNOT tell you

This is the section that motivates everything else in the chapter. Keep it concrete.

### 2.1 The cardinality wall is a hard architectural limit, not a tuning problem

In Prometheus, **every unique combination of label values is a separate time series**, and every series
costs memory in the head block, costs an entry in the index, and costs query time. This is why:

- You must **never** put user ID, session ID, request ID, trace ID, email, full URL path with IDs in it,
  or unbounded error strings into a Prometheus label.
- The failure mode is not graceful. It is called a "cardinality bomb": the head block grows, the TSDB OOMs,
  and you lose the monitoring system exactly when you need it.
- Prometheus's own defences are blunt caps: `sample_limit`, `label_limit`, `label_value_length_limit`,
  `target_limit` in `scrape_config` — they protect the server by *dropping your data*.

So the sentence to write is: **metrics deliberately trade away the identity of individual requests in
exchange for bounded cost.** That trade is the whole point. It is also the whole limitation.

### 2.2 The specific questions metrics structurally cannot answer

| Question | Why metrics can't |
|---|---|
| "Which customer is seeing the errors?" | Customer ID is unbounded cardinality. |
| "Is it *the same* 2% of requests failing each time, or a different 2%?" | A rate is a rate. Identity was discarded. |
| "The p99 is 4s — which downstream call ate the 4 seconds?" | A histogram bucket knows a count, not a causal chain. |
| "Requests are slow *and* the DB is slow — is that the same requests?" | Two independent series, no join key. |
| "This request was slow. Show me *that* request." | There is no 'that request' in a metric. |
| "Which line of code is burning the CPU?" | Metrics have no stack. |

### 2.3 The averages/percentiles trap (worth its own callout box)

- An average latency hides a bimodal distribution completely.
- `histogram_quantile()` over classic histograms is an *interpolation within a bucket*, not a true quantile.
  If your `le` buckets are `[0.1, 0.5, 1, 5, 10]` and everything lands in the `le="5"` bucket, your "p99" is a
  linear guess between 1 and 5 seconds. It is not wrong so much as *approximate in a way people forget*.
- You **cannot average percentiles across instances**. `avg(p99)` is meaningless. You must aggregate the
  buckets first: `histogram_quantile(0.99, sum by (le) (rate(x_bucket[5m])))`.
- Native histograms (see §4.6) improve the resolution problem substantially but do not change the fact that a
  quantile is still an aggregate with no request identity.

### 2.4 The bridge

Everything above is why exemplars (§7) exist: they let a *metric* carry a handful of *sample trace IDs*, so
that "the p99 is bad" becomes clickable. That is the single most important structural idea in this chapter.

---

## 3. OpenTelemetry status in 2026

### 3.1 Project status

**OpenTelemetry graduated the CNCF on 2026-05-21** — the foundation's highest maturity tier. It was donated in
2019 as the merger of OpenTracing and OpenCensus. Community scale cited in the graduation announcement:
12,000+ contributors from 2,800+ companies; the JS API package passed 1.36 billion downloads in twelve months
and the Python API passed 1.3 billion.

For the book: OTel is now the *default* answer to "how do I instrument," and Prometheus is one of several
things it can write to. That is a real change from 2021-era books that treated OTel as an emerging option.

### 3.2 Specification stability (from `opentelemetry.io/docs/specs/status/`)

| Signal | API | SDK | Protocol (OTLP) |
|---|---|---|---|
| Tracing | **stable** | **stable** | **stable** |
| Metrics | **stable** | **mixed** | **stable** |
| Logging | **stable** (Bridge API) | **stable** | **stable** |
| Baggage | **stable** | **stable** | N/A |
| Profiles | — | — | **development** |

Exact wording worth quoting: tracing is *"completely stable, and covered by long term support"*; the metrics
data model and protocol are stable while the metrics SDK is *"mixed"* / *"currently under active development."*

### 3.3 Per-language SDK status (from `opentelemetry.io/status/`)

**This is the table beginners get wrong.** The spec being stable does not mean your language is.

| Language | Traces | Metrics | Logs |
|---|---|---|---|
| C++ | Stable | Stable | Stable |
| C#/.NET | Stable | Stable | Stable |
| Erlang/Elixir | Stable | Development | Development |
| Go | Stable | Stable | **Beta** |
| Java | Stable | Stable | Stable |
| JavaScript | Stable | Stable | **Development** |
| Kotlin | Development | Development | Development |
| PHP | Stable | Stable | Stable |
| Python | Stable | Stable | **Development** |
| Ruby | Stable | **Development** | **Development** |
| Rust | Beta | Beta | Beta |
| Swift | Stable | Development | Development |

The site's own caveat, worth quoting: *"the status of a signal in the specification may not be the same as the
signal status in a particular language SDK."*

**Practical consequence for the book's lab:** if the sample service is Go or Python, OTel *logs* are not the
mature path. Ship logs the boring way (stdout → collector/Alloy → Loki) and use OTel for traces/metrics.

### 3.4 OTLP — the wire protocol

**OTLP spec version 1.11.0.** Traces, metrics, logs Stable; profiles Development.

Three transports:
1. **OTLP/gRPC** — Protocol Buffers over gRPC, unary.
2. **OTLP/HTTP binary protobuf** — HTTP POST, `Content-Type: application/x-protobuf`.
3. **OTLP/HTTP JSON** — JSON-encoded protobuf; trace/span IDs are **hex-encoded strings**, enums are integers.

Default ports and paths:

| Transport | Port | Traces | Metrics | Logs | Profiles |
|---|---|---|---|---|---|
| gRPC | **4317** | — | — | — | — |
| HTTP | **4318** | `/v1/traces` | `/v1/metrics` | `/v1/logs` | `/v1development/profiles` |

Note the profiles path literally contains `v1development` — that is the spec's way of signalling instability.
Do not "clean it up" to `/v1/profiles` in the book.

Standard client env vars (verbatim, from the Prometheus OTel guide):

```bash
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://localhost:9090/api/v1/otlp
export OTEL_TRACES_EXPORTER=none
export OTEL_LOGS_EXPORTER=none
export OTEL_METRIC_EXPORT_INTERVAL=15000
export OTEL_SERVICE_NAME="my-example-service"
export OTEL_RESOURCE_ATTRIBUTES="service.instance.id=$(uuidgen)"
```

### 3.5 Declarative configuration is now stable

OTel **declarative configuration** (a YAML file describing the whole SDK pipeline instead of a pile of env
vars) had its key parts marked **stable** in 2026: the JSON schema, the YAML representation, and the SDK
operations for parsing a config file and instantiating components.

- Environment variable: **`OTEL_CONFIG_FILE`** (the older experimental name was `OTEL_EXPERIMENTAL_CONFIG_FILE`).
- Available in **C++, Go, Java, JavaScript, PHP**; .NET and Python in development.
- The Go implementation is reused inside the Collector for configuring its own internal telemetry.

This is new enough that most books and blog posts still teach env-var-only configuration. Mention it; don't
build the lab on it unless the lab language is Java or Go.

### 3.6 Semantic conventions

**Current version 1.43.0** (2026-07-03).

- HTTP conventions are **Stable** (they stabilized back in the 1.23.x era). Migration from pre-stable HTTP
  attributes used the `OTEL_SEMCONV_STABILITY_OPT_IN` environment variable — you will still see it in older
  instrumentation and should explain it as a *migration* mechanism, not a current requirement.
- Database conventions were **marked stable** in the 2025-2026 cycle.
- Kubernetes/container registry attributes went **stable** in 1.42.0.
- RPC conventions and `service.instance.id` were stabilized around 1.40.0.
- Process attributes/metrics/entity are at **release_candidate** as of 1.42.0-1.43.0.
- **GenAI conventions were moved out** of the main repo in 1.42.0 into
  `open-telemetry/semantic-conventions-genai`. That repo has **no tagged release** and the GenAI/MCP
  conventions remain **Development**. There is no stable schema URL to pin against for GenAI. Say so plainly.

Key stable attribute names the book will use: `service.name`, `service.namespace`, `service.version`,
`service.instance.id`, `deployment.environment.name`, `http.request.method`, `http.response.status_code`,
`url.path`, `server.address`, `server.port`.

**Trap:** `deployment.environment` was renamed to **`deployment.environment.name`**. Older blog posts and
older Prometheus `promote_resource_attributes` examples still use the old name.

### 3.7 The Collector

- **Latest release v0.157.0 (2026-07-22). Still 0.x — there is no Collector 1.0.**
- Official statement of status: the Collector's status is **"mixed," because "core Collector components
  currently have mixed stability levels."** Each component documents its own stability in its `README.md`.
- Component stability ladder: Development → Alpha → Beta → Stable → Deprecated → Unmaintained.
- **Five official distributions:** `otelcol` (core), `otelcol-contrib`, `otelcol-otlp` (minimal, OTLP in/out
  only), `otelcol-k8s`, and `otelcol-ebpf-profiler`. Each distribution's exact component list lives in its
  `manifest.yaml` in `open-telemetry/opentelemetry-collector-releases`.

Component stability levels relevant to this book:

| Component | Stability | Note |
|---|---|---|
| `prometheusreceiver` | **Beta** (metrics) | Drop-in-ish replacement for a Prometheus scraper. |
| `spanmetricsconnector` | **Alpha** | Generates RED metrics from spans. |
| `otelarrowreceiver` / `otelarrowexporter` | **Beta** | OTLP-over-Apache-Arrow, in contrib since v0.104.0. |
| `prometheusexporter` | (see README) | Exposes a `/metrics` endpoint to be scraped. |
| `prometheusremotewriteexporter` | (see README) | Pushes to Mimir/Thanos/Cortex/Prometheus. |

**OTel Arrow:** production-ready at **Beta**; the claim is ~10x traffic reduction after compression, roughly a
40% improvement over OTLP/gRPC with zstd at equal batch sizes; 15x-30x compression observed in production at
ServiceNow Cloud Observability. Phase 2 (efficient pipelines, not just transport) was in progress mid-2026.

---

## 4. Where OpenTelemetry and Prometheus overlap, and where they compete

This is the single most-outdated topic in existing books. Get it right.

### 4.1 The short version

They **overlap on metrics collection and transport** and they **do not compete on storage**. OTel has no
metrics database. Prometheus has no tracing. The friction is entirely in the middle: data model translation.

Four legitimate architectures, all current:

1. **Pure Prometheus.** App exposes `/metrics`; Prometheus scrapes it. Simplest; what the book's lab should
   start with.
2. **OTel SDK → Prometheus exporter → Prometheus scrapes.** App uses OTel SDK but exposes a pull endpoint.
3. **OTel SDK → OTLP → Prometheus native OTLP receiver.** Push. Requires a flag (below).
4. **OTel SDK → Collector/Alloy → remote write (or OTLP) → Prometheus/Mimir.** The production shape.

### 4.2 Prometheus as a native OTLP metrics backend

Verified from `prometheus.io/docs/guides/opentelemetry/`:

- Enable with the CLI flag **`--web.enable-otlp-receiver`**. It is **off by default** because Prometheus ships
  without authentication.
- Endpoint path: **`/api/v1/otlp/v1/metrics`** (accepts protobuf `ExportMetricsServiceRequest`). Note the
  doubled `v1` — the OTLP *base* URL you give an SDK is `http://host:9090/api/v1/otlp`, and the SDK appends
  `/v1/metrics`.
- **Metrics only.** Prometheus does not accept OTLP traces or logs, and there is no plan for it to.
- Because OTLP is a *push* protocol and pushes can arrive late, the docs recommend enabling out-of-order
  ingestion:

```yaml
storage:
  tsdb:
    out_of_order_time_window: 30m
```

The `otlp:` block in `prometheus.yml`. Full field list (from the configuration reference):

```yaml
otlp:
  promote_resource_attributes: [...]
  promote_all_resource_attributes: <bool>
  ignore_resource_attributes: [...]
  translation_strategy: <string>
  keep_identifying_resource_attributes: <bool>
  convert_histograms_to_nhcb: <bool>
  promote_scope_metadata: <bool>
  label_name_underscore_sanitization: <bool>
  label_name_preserve_multiple_underscores: <bool>
```

The documented example of resource-attribute promotion, verbatim:

```yaml
otlp:
  promote_resource_attributes:
    - service.instance.id
    - service.name
    - service.namespace
    - service.version
    - cloud.availability_zone
    - cloud.region
    - deployment.environment
    - k8s.cluster.name
    - k8s.namespace.name
    - k8s.pod.name
```

> Note: that official example still lists `deployment.environment`; current semconv is
> `deployment.environment.name`. Flag this in the book.

And:

```yaml
otlp:
  translation_strategy: NoTranslation
  keep_identifying_resource_attributes: true
```

### 4.3 The four `translation_strategy` values (memorize these — beginners hit this immediately)

| Value | Behaviour |
|---|---|
| `UnderscoreEscapingWithSuffixes` | **Default.** Full escaping to classic Prometheus names, **plus** type and unit suffixes (`_total`, `_seconds`, …). |
| `UnderscoreEscapingWithoutSuffixes` | Same escaping, **no** type/unit suffixes appended. |
| `NoUTF8EscapingWithSuffixes` | Keeps UTF-8 names, still appends suffixes. Requires UTF-8 support. |
| `NoTranslation` | Names pass through verbatim. Requires UTF-8 support. |

**Why this exists:** OTel metric names are dotted (`http.server.request.duration`); classic Prometheus names
are `[a-zA-Z_:][a-zA-Z0-9_:]*`. Since Prometheus 3.x, **UTF-8 metric and label names are allowed by default in
storage and the UI**, so `NoTranslation` is now a real option — but it changes every metric name in your
dashboards and it means PromQL selectors need the quoted form `{"http.server.request.duration"}`. For a
teaching book, keep the default and *explain* why the metric is called
`http_server_request_duration_seconds_bucket`.

### 4.4 Delta vs cumulative — the real incompatibility

Prometheus is **cumulative-only** by design (`rate()` and `increase()` assume monotonically increasing
counters and use counter-reset detection). OTel SDKs can emit **delta** temporality, and some (notably .NET
and StatsD-shaped pipelines) default to it.

Two experimental Prometheus feature flags handle this; **they are mutually incompatible**:

- `--enable-feature=otlp-deltatocumulative` — converts incoming delta metrics to cumulative on ingest.
- `--enable-feature=otlp-native-delta-ingestion` — stores raw deltas without conversion.

The alternative, and the more common production answer, is to convert upstream in the Collector with the
`deltatocumulative` processor (`otelcol.processor.deltatocumulative` in Alloy).

What the OTel↔Prometheus compatibility spec says about delta:
- Delta **Sums** *"MAY be converted to a cumulative temporality and become a Prometheus Counter."*
- Delta **Histograms** *"MAY be aggregated into a Cumulative aggregation temporality…or MUST be dropped."*
- Delta **Exponential Histograms** *"are dropped."*

**Book guidance:** tell the reader to configure their OTel SDK for **cumulative** temporality when the backend
is Prometheus. It removes an entire class of bugs.

### 4.5 Name and attribute mapping rules (OTel → Prometheus), from the compatibility spec

- Monotonic sums get a **`_total`** suffix by default unless already present.
- Histograms get **`_bucket`**, **`_count`**, **`_sum`**.
- **Unit suffix comes before the type suffix** (`..._seconds_total`, not `..._total_seconds`).
- Resource attributes do **not** become labels by default. They land on a synthetic **`target_info`** metric
  (a gauge with value 1) unless you promote them via `promote_resource_attributes`.
- `job` label = `<service.namespace>/<service.name>` (or just `service.name` if no namespace).
  `instance` label = `service.instance.id` (empty if absent).
- *"There MUST be at most one `target` info metric exported for each unique combination of `job` and `instance`."*
- Instrumentation scope becomes labels: **`otel_scope_name`**, **`otel_scope_version`**,
  **`otel_scope_schema_url`**, and `otel_scope_<attribute>`. Scope attributes that would collide with those
  reserved names *"MUST be dropped."* In Prometheus, `promote_scope_metadata` controls this.
- **Exemplars:** *"the OpenTelemetry Exemplar's Trace ID and Span ID MUST be added as Exemplar labels using
  the `trace_id` and `span_id` keys"*, and these *"MUST take precedence over labels from `filtered_attributes`."*

`target_info` is the piece that confuses everyone. A typical join looks like:

```promql
sum by (k8s_cluster_name) (
  rate(http_server_request_duration_seconds_count[5m])
  * on (job, instance) group_left(k8s_cluster_name) target_info
)
```

### 4.6 Native histograms — status changed recently, get this right

From `prometheus.io/docs/specs/native_histograms/`:

- **Native histograms became a stable feature starting in Prometheus v3.8.0.** Before that they required
  `--enable-feature=native-histograms`.
- **Scraping them still has to be turned on explicitly** via the **`scrape_native_histograms`** scrape-config
  setting.
- In v3.8 the old feature flag's only remaining effect was to default `scrape_native_histograms` to true.
  *"Starting with v3.9, the feature flag is a true no-op and explicitly setting `scrape_native_histograms` is
  required."*
- *"From v4 on, both `scrape_native_histograms` and `send_native_histograms` will default to `true`."*
- **NHCB** = Native Histograms with Custom Buckets, **schema -53**: classic explicit-bucket histograms stored
  in the native composite sample structure. Enabled per scrape config with
  **`convert_classic_histograms_to_nhcb`**, and for OTLP ingest with `otlp.convert_histograms_to_nhcb`.
  Reported to be *"at least 30% more efficient than the classic representation, while offering functional
  parity."*

A February 2026 Prometheus blog post ("Modernizing Prometheus: Native Storage for Composite Types",
Bartłomiej Płotka) lays out the direction: move histograms, summaries, statesets and info metrics to native
composite storage; **OpenMetrics 2.0** is under development to carry composite values in the text format;
Remote Write 2.0 already carries native histograms.

### 4.7 `scrape_protocols` — the negotiation list

Supported values: `PrometheusProto`, `OpenMetricsText1.0.0`, `OpenMetricsText0.0.1`, `PrometheusText0.0.4`,
`PrometheusText1.0.0`.

Default order depends on `scrape_native_histograms`:
- `false` → `[OpenMetricsText1.0.0, OpenMetricsText0.0.1, PrometheusText1.0.0, PrometheusText0.0.4]`
- `true` → `PrometheusProto` moves to the front of that list.

This matters for exemplars (§7): **exemplars only travel in OpenMetrics (or protobuf), never in the classic
Prometheus text format.**

### 4.8 Remote Write 2.0

The spec page is still titled **"Prometheus Remote-Write 2.0 specification [EXPERIMENTAL]"** as of 2026-07-27.
PRW 2.0 adds metadata, exemplars, created/start timestamps, native histograms, and string interning on top of
1.0. Stabilization is tracked in the umbrella issue **PROM-35** (`prometheus/prometheus#16944`), gated on
implementation quality and adoption by Cortex/Thanos/Mimir/vendors.

Related Prometheus feature flags: `metadata-wal-records` (required for RW 2.0), `st-storage`,
`created-timestamp-zero-ingestion`, `use-start-timestamps`, `st-synthesis`.

### 4.9 The Collector's Prometheus components — known limitations

`prometheusreceiver` (**Beta**, metrics only). Documented limitations, worth quoting:
- *"Collector cannot auto-scale the scraping yet when multiple replicas of the collector are run"* — multiple
  replicas will duplicate scrapes unless you shard manually (or use the Target Allocator on Kubernetes).
- It **errors out** if the embedded Prometheus config contains: alertmanager config, alert relabeling, remote
  read, remote write, or rule files. It is a scraper, not a Prometheus.
- It *does* ingest exemplars from the Prometheus/OpenMetrics format and converts them to OTLP: labels with key
  `span_id` become the OTLP span ID, labels with key `trace_id` become the trace ID.

Minimal config example:

```yaml
receivers:
  prometheus:
    trim_metric_suffixes: true
    config:
      scrape_configs:
        - job_name: 'otel-collector'
          scrape_interval: 5s
          static_configs:
            - targets: ['0.0.0.0:8888']
```

`prometheusexporter` vs `prometheusremotewriteexporter`:
- **`prometheus`** exporter exposes a `/metrics` endpoint for Prometheus to scrape. Does not scale well — all
  metrics come back in one scrape. **Exemplars are only exported when `enable_open_metrics: true`, and only
  for histogram and monotonic sum metrics.** It does not support exemplars on native histograms.
- **`prometheusremotewrite`** exporter pushes; works from many Collector replicas. Converts OTel exponential
  histograms to Prometheus native histograms.

```yaml
exporters:
  prometheus:
    endpoint: 0.0.0.0:8889
    namespace: prefix
    const_labels:
      label1: value1
    enable_open_metrics: true
    resource_to_telemetry_conversion:
      enabled: true
    metric_expiration: 180m
```

### 4.10 Grafana Alloy — what it actually is

**Grafana Alloy is Grafana Labs' distribution of the OpenTelemetry Collector**, with first-class Prometheus
pipelines bolted alongside. Current version **1.18.0 (2026-07-20)**.

- 120+ components in two families: `prometheus.*` (scrape, relabel, remote_write, …) and `otelcol.*`
  (receiver, processor, exporter, connector — the upstream Collector components).
- Configuration language is Alloy's own HCL-ish syntax, not OTel YAML.
- Alloy 1.11 upgraded its embedded Prometheus from v2.55.1 to v3.4.2 (regex, HTTP/2 defaults, histogram label
  normalization changes).
- **Promtail is dead.** Promtail was deprecated (commercial support ended 2026-02-28) and **removed from Loki
  as of v3.7.3**; its functionality is merged into Alloy. Any book or blog telling the reader to deploy
  Promtail is out of date. Migration tooling lives in the Alloy docs.

---

## 5. Grafana Loki — logs, indexed like Prometheus

### 5.1 The one-sentence idea

**Loki does not build a full-text index of your log lines. It indexes only the label set of each stream (plus
timestamps), compresses the raw lines into chunks, and brute-force greps the chunks at query time.** That is
why it is cheap, and it is why *label design is the whole game* — exactly the same lesson as Prometheus
cardinality, which makes it a great teaching pairing.

Loki's own framing: it *"does not index the content of logs but rather indexes a set of labels for each log
stream, similar to how Prometheus handles metrics."* Chunks are compressed and the index acts as *"a table of
contents"* telling the querier which chunks to pull.

**Consequence to teach:** a Loki query with a narrow stream selector and a line filter is fast. A Loki query
with `{job=~".+"}` and a regex is a full scan of your log storage. High-cardinality labels in Loki create the
same explosion as in Prometheus — one stream per unique label combination.

### 5.2 Versions and lifecycle

- **Loki 3.7.4 (2026-07-24)** is current; 3.7.0 shipped **2026-03-26**. 3.6.x still patched (3.6.13).
- **Loki 3.6 (2025-11-17)** switched Loki's internal tracing from OpenTracing to **OpenTelemetry** (JAEGER env
  vars still honoured), moved the operational UI into a Grafana plugin, and removed busybox/shell from the
  Docker images (you can no longer `docker exec … sh` into a Loki container — mention this, it surprises people).
- **The Loki Helm chart moved to a community repo** (`grafana-community/helm-charts`) on **2026-03-16**.
  Grafana Labs keeps maintaining the Enterprise Logs chart. `loki-distributed`, `loki-simple-scalable`,
  `loki-canary` and `LGTM-distributed` charts are deprecated.
- **Promtail removed in v3.7.3.** Use Grafana Alloy.
- **Simple Scalable Deployment (SSD) mode is deprecated and will be removed in Loki 4.0.** Migrate to
  distributed/microservices or HA monolithic. The built-in MinIO subchart is deprecated with removal dated
  2026-10-31.
- Loki 3.7 breaking changes worth knowing: scheduler is now aware of total compute capacity; worker threads
  shared across scheduler connections; **parsed labels no longer override structured metadata**; OpenShift
  stream labels default switched.

### 5.3 LogQL — the syntax the book will actually show

Shape: `{ stream selector } | log pipeline`.

**Stream selector** matchers (identical to PromQL): `=`, `!=`, `=~`, `!~`. Regexes here are **fully anchored**.

```logql
{container="query-frontend", namespace="loki-dev"}
```

**Line filters** — the distributed-grep stage. These are what make Loki fast; put them as early as possible.

| Operator | Meaning |
|---|---|
| `\|=` | Log line contains string |
| `!=` | Log line does not contain string |
| `\|~` | Log line contains a match to the regular expression |
| `!~` | Log line does not contain a match to the regular expression |

Line-filter regexes are **not anchored** (and `.` matches newlines) — the opposite of stream-selector regexes.
This asymmetry trips everyone up.

```logql
{job="mysql"} |= "error" != "timeout"
```

**Parsers** (extract labels from the line): `| json`, `| logfmt`, `| pattern`, `| regexp`, `| unpack`.

```logql
| json
| json first_server="servers[0]", ua="request.headers[\"User-Agent\"]"
| logfmt
| logfmt --strict --keep-empty host, fwd_ip="fwd"
| pattern "<ip> - - <_> \"<method> <uri> <_>\" <status> <size>"
| regexp "(?P<method>\\w+) (?P<path>[\\w|/]+)"
```

**Label filters** (after parsing) support string ops `=`, `!=`, `=~`, `!~` and numeric/duration/bytes ops
`==`, `!=`, `>`, `>=`, `<`, `<=`, combined with `and` / `or`:

```logql
| duration > 1m and bytes_consumed > 20MB
| duration >= 20ms or method="GET" and size <= 20KB
```

**Formatting and label surgery:** `| line_format "{{.query}} {{.duration}}"`,
`| label_format dst=src`, `| label_format dst="{{.status}} {{.query}}"`,
`| drop level, method="GET"`, `| keep level, method="GET"`, `| decolorize`.

Canonical full example from the docs:

```logql
{container="query-frontend",namespace="loki-dev"} |= "metrics.go" | logfmt | duration > 10s and throughput_mb < 500
```

### 5.4 LogQL metric queries — where PromQL knowledge transfers

**Log range aggregations** (operate on log lines):
`rate(log-range)` — *"calculates the number of entries per second"*;
`count_over_time(log-range)` — *"counts the entries for each log stream within the given range"*;
`bytes_rate(log-range)`; `bytes_over_time(log-range)`; `absent_over_time(log-range)`.

```logql
count_over_time({job="mysql"}[5m])

sum by (host) (rate({job="mysql"} |= "error" != "timeout" | json | duration > 10s [1m]))
```

**Unwrapped range aggregations** (turn a label value into a number with `| unwrap <label>`):
`rate`, `rate_counter`, `sum_over_time`, `avg_over_time`, `max_over_time`, `min_over_time`,
`first_over_time`, `last_over_time`, `stdvar_over_time`, `stddev_over_time`, `quantile_over_time`,
`absent_over_time`. Conversion helpers: `duration_seconds()`, `bytes()`.

**Built-in vector aggregations** (same names as PromQL): `sum`, `avg`, `min`, `max`, `stddev`, `stdvar`,
`count`, `topk`, `bottomk`, `sort`, `sort_desc`, with
`<aggr-op>([parameter,] <vector expression>) [without|by (<label list>)]`.

**Loki-specific:** `approx_topk(k, <vector expression>)` — probabilistic top-k for when exact `topk` times out
on huge datasets. This has no PromQL equivalent; call it out as a Loki extension.

### 5.5 Structured metadata — the correct home for trace IDs

**This is the mechanism that makes logs↔traces correlation cheap in Loki, and it is the thing most 2021-era
material predates entirely.**

- Structured metadata attaches key/value metadata to a log entry **without indexing it as a label and without
  embedding it in the line**.
- Requires **chunk format V4 / schema version 13 or higher**.
- Enable with `allow_structured_metadata: true` in the `limits_config` block.
- Default limits: **max 64KB of structured metadata per log line, max 128 entries per line**.
- Intended exactly for: **trace IDs**, span IDs, container IDs, pod names, process/thread IDs — high-cardinality
  values you want to *filter on* but must never make into stream labels.
- Query it with a label filter, no parser needed:

```logql
{job="example"} | pod="myservice-abc1234-56789"
```

- Loki 3.7 breaking change: **parsed labels no longer override structured metadata.**

### 5.6 Loki's native OTLP endpoint

Loki ingests OTLP logs directly — no Promtail, no Alloy strictly required.

- Endpoint: **`http://<loki-addr>/otlp`** (the OTLP HTTP exporter appends `/v1/logs`).
- Collector config:

```yaml
exporters:
  otlphttp:
    endpoint: http://<loki-addr>/otlp

service:
  pipelines:
    logs:
      receivers: [...]
      processors: [...]
      exporters: [..., otlphttp]
```

- **Mapping rule:** a curated default list of **resource attributes becomes index labels**; **everything else
  becomes structured metadata**. The 17 defaults:

```
cloud.availability_zone   cloud.region              container.name
deployment.environment.name                          k8s.cluster.name
k8s.container.name        k8s.cronjob.name          k8s.daemonset.name
k8s.deployment.name       k8s.job.name              k8s.namespace.name
k8s.pod.name              k8s.replicaset.name       k8s.statefulset.name
service.instance.id       service.name              service.namespace
```

- Override with the `otlp_config` block, whose sections are `resource_attributes` (with `ignore_defaults` and
  `attributes_config`), `scope_attributes`, and `log_attributes`. Each entry takes an `action` of
  **`index_label`**, **`structured_metadata`**, or **`drop`**.
- **Dots become underscores** in label names; nested attributes are flattened with underscores.

### 5.7 Bloom filters and the new engine — clearly mark as experimental

- **Bloom filters are experimental.** Since Loki 3.3 they target **structured metadata** rather than free-text
  search, and Grafana positions them at customers ingesting **>75TB/month**. Documentation page is literally
  titled *"Manage bloom filter building and querying (Experimental)"*. Do not put them in a teaching lab.
- The **DataObj** columnar format plus a rewritten query engine (logical/physical plans, predicate pushdown to
  scan nodes) is the direction of travel; the DataObj pipeline (push to Kafka → DataObjConsumer → columnar
  DataObj) is **experimental**. Claims made at GrafanaCON 2026: ~20x less data scanned, ~10x faster queries for
  analytics-shaped queries. Mention as roadmap, not as something the reader configures. `UNVERIFIED` on the
  exact GA timing.

---

## 6. Grafana Tempo — traces, and now metrics from traces

### 6.1 Versions and the Tempo 3.0 rearchitecture

**Tempo 3.0** (current patch **3.0.2**) is a major release. What changed:

- Codename **"Project Rhythm."** Three goals: remove the replication-factor-3 requirement, decouple the read
  and write paths, and lower TCO. In practice: **one copy of trace data in object storage instead of three.**
- **Ingesters are gone.** All ingester config, CLI flags and alerts must be removed.
- **Compactors are gone** — compaction now runs via a backend scheduler/worker.
- Microservices mode uses **Kafka** for durable write buffering.
- **The OpenCensus receiver was removed.** Migrate to OTLP.
- Legacy flat (non-scoped) overrides are no longer permitted; filter policies are validated through the
  overrides API.
- `mem-ballast-size-mbs` and `SpanMetricsSummary` removed.
- **The `local-blocks` processor was removed in Tempo 3.0** — important, because most existing tutorials tell
  you to enable `local-blocks` to get TraceQL metrics. That advice is now wrong.

**TraceQL metrics are Generally Available in Tempo 3.0.** Alerting on TraceQL metrics is still **experimental**,
as are span-name sanitization and the optimized "faster read path" for metrics queries.

### 6.2 TraceQL — the syntax

Curly braces select spans. `{}` matches all spans. Expressions chain through a pipeline with `|`.

**Intrinsics use a colon** (`<scope>:`):

| Intrinsic | Meaning |
|---|---|
| `span:status` | `error`, `ok`, or `unset` |
| `span:statusMessage` | text accompanying status |
| `span:duration` | end − start |
| `span:name` | operation name |
| `span:kind` | `server`, `client`, `producer`, `consumer`, `internal`, `unspecified` |
| `span:id`, `span:parentID` | hex identifiers |
| `span:childCount` | number of direct children |
| `trace:duration` | max(end) − min(start) across the trace |
| `trace:rootName`, `trace:rootService` | root span info |
| `trace:id` | trace identifier |
| `event:name`, `event:timeSinceStart` | span-event fields |
| `link:spanID`, `link:traceID` | span-link fields |
| `instrumentation:name`, `instrumentation:version` | instrumentation scope |

**Attributes use a period** (`<scope>.`): `span.`, `resource.` (no intrinsics), `event.`, `link.`,
`instrumentation.`

**Literals:** integers (`200`, `-1`, `minInt`, `maxInt`), durations (`100ms`, `5s`, `1h`; units
`ns us ms s m h`), floats (`1.5`), strings (`"GET"`), and `nil` for missing attributes.

**Comparison:** `=`, `!=`, `>`, `>=`, `<`, `<=`, `=~`, `!~`. **TraceQL regexes are fully anchored by default** —
the opposite of LogQL line filters. Flag this in the book; it is a classic cross-tool foot-gun.

**Logical:** `&&`, `||`.

**Structural / spanset operators** (this is TraceQL's superpower, PromQL and LogQL have nothing like it):

| Standard (returns right side) | Union (returns both, `&` prefix) | Negation (experimental, `!` prefix) | Meaning |
|---|---|---|---|
| `>>` | `&>>` | `!>>` | descendant |
| `<<` | `&<<` | `!<<` | ancestor |
| `>` | `&>` | `!>` | direct child |
| `<` | `&<` | `!<` | direct parent |
| `~` | `&~` | `!~` | sibling |

**Aggregators** applied via `|`: `count()`, `avg(field)`, `max(field)`, `min(field)`, `sum(field)`.

**Pipeline extras:** `by(field)`, `select(fields)`, `with (most_recent=true)`.

Example:

```traceql
{ resource.service.name = "frontend" && span.http.status_code >= 500 } | count() > 1
```

### 6.3 TraceQL metrics (GA in Tempo 3.0)

Functions: `rate`, `count_over_time`, `sum_over_time`, `min_over_time`, `max_over_time`, `avg_over_time`,
`quantile_over_time`, `histogram_over_time`, `compare`. `topk` / `bottomk` and the comparison operators
`>`, `>=`, `<`, `<=`, `=`, `!=` work on metrics results.

```traceql
{ span:name = "GET /:endpoint" } | quantile_over_time(duration, .99) by (span.http.target)
```

Enabling config (query-frontend):

```yaml
query_frontend:
  metrics:
    concurrent_jobs: 1000
    target_bytes_per_job: 2.25e+08
    interval: 30m0s
    max_duration: 24h
    query_backend_after: 15m
```

Defaults noted in the docs: `concurrent_jobs` ~1000 for cloud vs ~8 on-prem; `target_bytes_per_job` ~225MB
cloud vs ~1.25GB on-prem; `max_duration` 24h; `query_backend_after` 15m (the live-store/backend boundary).

**Exemplars in TraceQL metrics:** available for all range queries. Configure
**`query_frontend.metrics.max_exemplars`** or pass a query hint:

```traceql
{ span:name = "GET /:endpoint" } | quantile_over_time(duration, .99) by (span.http.target) with (exemplars=true)
```

Caps: `maxExemplars` default **10,000**, `maxExemplarsPerBucket` default **2**.

The experimental "faster read path" uses the `spanonly_fetch=true` hint and the `metrics_spanonly_fetch`
override. Marked experimental, no SLA.

### 6.4 Tempo's metrics-generator — traces in, Prometheus metrics out

This is the mechanism that gives you RED metrics without instrumenting anything extra, and it is the thing
that makes "one lab stack" work: **Tempo can write metrics into Prometheus via `remote_write`.**

- Processors in Tempo 3.0: **service-graphs**, **span-metrics**, **host-info**. (`local-blocks` removed.)
- The generator *"runs a Prometheus Agent that periodically sends metrics to a `remote_write` endpoint."*
- `metrics_generator.registry.collection_interval` controls the write interval.
- `remote_write_add_org_id_header: false` disables forwarding `X-Scope-OrgID`.
- In Tempo 3.0 microservices mode the generator consumes trace data from Kafka.

**Span-metrics processor — exact metric names:**

| Metric | Type |
|---|---|
| `traces_spanmetrics_latency` | Histogram |
| `traces_spanmetrics_calls_total` | Counter |
| `traces_spanmetrics_size_total` | Counter |

**Default dimensions (labels):** `service`, `span_name`, `span_kind`, `status_code`.
Optional (must be enabled): `status_message`, `job`, `instance`.

Enable the sub-processors in overrides:

```yaml
overrides:
  defaults:
    metrics_generator:
      processors:
        - span-metrics-latency
        - span-metrics-count
        - span-metrics-size
```

**Service graphs:** builds a map of services by finding *edges* — parent/child span pairs that represent a jump
between two services.

**Exemplars:** because traces and metrics coexist inside the generator, *"exemplars can be automatically
added"* to the generated metrics. This is the easiest exemplar setup that exists — you get metric→trace links
without touching application code. `UNVERIFIED`: the exact config key to toggle generator exemplars; check
`metrics_generator.processor.span_metrics` in the Tempo config reference before writing the lab.

Tempo 3.0 also added: per-label cardinality limiting in the generator, service-graph filtering, trace redaction
(new CLI command + API), and **span profiling with native Pyroscope integration** (otelpyroscope).

### 6.5 OTel Collector alternative: the `spanmetrics` connector

If you'd rather generate RED metrics in the Collector than in Tempo:

- Stability: **alpha**.
- Metric names (namespace prefix `traces.span.metrics`, configurable):
  `traces.span.metrics.calls`, `traces.span.metrics.duration`, `traces.span.metrics.events`.
- Default dimensions: `service.name`, `span.name`, `span.kind`, `status.code`, `collector.instance.id`.
- Exemplars:

```yaml
exemplars:
  enabled: false          # default
  max_per_data_point: 5   # default
```

- Histogram options:

```yaml
histogram:
  type: explicit
  buckets: [2ms, 4ms, 6ms, 8ms, 10ms, 50ms, 100ms, 200ms, 400ms, 800ms, 1s, 1400ms, 2s, 5s, 10s, 15s]
```

```yaml
histogram:
  type: exponential
  max_size: 160
```

Full documented example:

```yaml
connectors:
  span_metrics:
    histogram:
      dimensions:
        - name: url.scheme
          default: https
      explicit:
        buckets: [100us, 1ms, 2ms, 6ms, 10ms, 100ms, 250ms]
    dimensions:
      - name: http.method
        default: GET
      - name: http.status_code
      - glob: "k8s.*.name"
      - glob: "db.**.name"
    calls_dimensions:
      - name: http.url
        default: /ping
    exemplars:
      enabled: true
    exclude_dimensions: ['status.code']
    aggregation_temporality: "AGGREGATION_TEMPORALITY_CUMULATIVE"
    metrics_flush_interval: 15s
    metrics_expiration: 5m
    series_expiration: 5m
    events:
      enabled: true
      dimensions:
        - name: exception.type
        - name: exception.message
    resource_metrics_key_attributes:
      - service.name
      - telemetry.sdk.language
      - telemetry.sdk.name
    include_instrumentation_scope:
      - express

service:
  pipelines:
    traces:
      receivers: [nop]
      exporters: [span_metrics]
    metrics:
      receivers: [span_metrics]
      exporters: [nop]
```

**Note the naming clash for the book:** Tempo's generator produces `traces_spanmetrics_*`; the Collector
connector produces `traces.span.metrics.*` (which becomes `traces_span_metrics_*` after Prometheus
translation). They are **not** the same metric names. Dashboards are not portable between the two.

---

## 7. Exemplars — the metric→trace bridge, end to end

This is the highest-value practical section in the chapter. It is also where readers fail, because there are
**six** places it can break and the failure is always silent.

### 7.1 What an exemplar is, precisely

An exemplar is a **reference attached to a single sample of a counter or histogram bucket**, pointing at data
outside the metric — canonically, a trace ID. Grafana's definition: *"An exemplar is a specific trace
representative of measurement taken in a given time interval."*

It is *not* a label. It does not create a new time series. It does not increase cardinality. This is the
crucial teaching point: **exemplars give you the "which request?" answer without paying the cardinality cost
of putting a trace ID in a label.**

### 7.2 The wire format (OpenMetrics 1.0)

ABNF from the OpenMetrics spec:

```
exemplar = SP HASH SP labels SP number [SP timestamp]
sample   = metricname [labels] SP number [SP timestamp] [exemplar] LF
```

Hard rules from the spec:
- *"The combined length of the label names and values of an Exemplar's LabelSet MUST NOT exceed 128 UTF-8
  character code points."*
- Only certain types may carry exemplars: **Counter** (*"A MetricPoint in a Metric's Counter's Total MAY have
  an exemplar"*), **Histogram** (*"Bucket values MAY have exemplars"*), and **GaugeHistogram**.
  **Gauges cannot carry exemplars.**

Worked example straight from the OpenMetrics spec — memorize the shape of the `#` separator:

```
# TYPE foo histogram
foo_bucket{le="0.01"} 0
foo_bucket{le="0.1"} 8 # {} 0.054
foo_bucket{le="1"} 11 # {trace_id="KOO5S4vxi0o"} 0.67
foo_bucket{le="10"} 17 # {trace_id="oHg5SJYRHA0"} 9.8 1520879607.789
foo_bucket{le="+Inf"} 17
foo_count 17
foo_sum 324789.3
foo_created 1520430000.123
```

Content type: `application/openmetrics-text; version=1.0.0; charset=utf-8`.

### 7.3 Step 1 — produce exemplars in the app

**Go (`client_golang`).** The complete official example, verbatim:

```go
// A simple example of how to record a latency metric with exemplars, using a fictional id
// as a prometheus label.

package main

import (
	"log"
	"math/rand"
	"net/http"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
	requestDurations := prometheus.NewHistogram(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "A histogram of the HTTP request durations in seconds.",
		Unit:    "seconds",
		Buckets: prometheus.ExponentialBuckets(0.1, 1.5, 5),
	})

	// Create non-global registry.
	registry := prometheus.NewRegistry()

	// Add go runtime metrics and process collectors.
	registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		requestDurations,
	)

	go func() {
		for {
			// Record fictional latency.
			now := time.Now()
			requestDurations.(prometheus.ExemplarObserver).ObserveWithExemplar(
				time.Since(now).Seconds(), prometheus.Labels{"dummyID": strconv.Itoa(rand.Intn(100000))},
			)
			time.Sleep(600 * time.Millisecond)
		}
	}()

	// Expose /metrics HTTP endpoint using the created custom registry.
	http.Handle(
		"/metrics", promhttp.HandlerFor(
			registry,
			promhttp.HandlerOpts{
				EnableOpenMetrics: true,
			}),
	)
	// To test: curl -H 'Accept: application/openmetrics-text' localhost:8080/metrics
	log.Fatalln(http.ListenAndServe(":8080", nil))
}
```

Two things in that file the book must not lose:
1. The type assertion **`prometheus.ExemplarObserver`** and the method **`ObserveWithExemplar(value, labels)`**.
   For counters the equivalent is **`AddWithExemplar(increment, labels)`** (`prometheus.ExemplarAdder`).
2. **`promhttp.HandlerOpts{EnableOpenMetrics: true}`** — without this the handler will never emit exemplars,
   no matter what you record.

In a real service you replace `dummyID` with the trace ID:

```go
span := trace.SpanFromContext(ctx)
if sc := span.SpanContext(); sc.IsSampled() {
    requestDurations.(prometheus.ExemplarObserver).ObserveWithExemplar(
        elapsed.Seconds(),
        prometheus.Labels{"trace_id": sc.TraceID().String()},
    )
}
```

**Python (`prometheus_client`).** The API is an `exemplar=` keyword / positional dict:

```python
c.labels('get', '/').inc(exemplar={'trace_id': 'abc123'})
c.labels('post', '/submit').inc(1.0, {'trace_id': 'def456'})
h.observe(4.7, {'trace_id': 'abc123'})
```

Docs note: *"Exemplars are only rendered in the OpenMetrics exposition format."* Either rely on content
negotiation (Prometheus asks for OpenMetrics by default) or call `generate_latest` from
`prometheus_client.openmetrics.exposition` explicitly.

**Java (`client_java`):** follow the client library's exemplar support (it can auto-attach exemplars from the
active OpenTelemetry span context). `UNVERIFIED` on the exact current class/method names for client_java 1.x —
check before writing code.

**From an OTel SDK instead:** the OTel metrics SDK has **stable** exemplar support with three filters —
**`TraceBased`** (the default; *"makes those measurements eligible for being an Exemplar, which are recorded in
the context of a sampled parent span"*), **`AlwaysOn`**, **`AlwaysOff`**. Environment variable
**`OTEL_METRICS_EXEMPLAR_FILTER`**. Two reservoirs are required by spec:
`SimpleFixedSizeExemplarReservoir` (uniform weighted sampling) and `AlignedHistogramBucketExemplarReservoir`
(one measurement per bucket — the default for explicit-bucket histograms with more than one bucket). The spec
says *"Exemplar sampling SHOULD be turned on by default."*

> **Consequence of `TraceBased` being the default:** if your trace sampler drops the span, you get **no
> exemplar**. Readers who tail-sample at 1% and then wonder why their dashboards have no stars have found this.
> In the lab, sample at 100%.

### 7.4 Step 2 — verify the exposition

```bash
curl -H "Accept: application/openmetrics-text" http://localhost:8080/metrics | grep -i "trace_id"
```

If you see no `#` sections, stop here. Nothing downstream can fix it.

### 7.5 Step 3 — make Prometheus scrape and store them

```bash
prometheus --enable-feature=exemplar-storage
```

- `exemplar-storage` is still a **feature flag** in Prometheus 3.13. It is not on by default.
- Storage is *"a fixed size circular buffer that stores exemplars in memory for all series"*, and when enabled
  Prometheus also **appends exemplars to the WAL** for local persistence.
- Buffer size:

```yaml
storage:
  exemplars:
    max_exemplars: 100000
```

  Default **100000**; also settable as `--storage.tsdb.max-exemplars=100000`. Rough sizing: an exemplar with
  just a `trace_id` costs on the order of **~100 bytes** of memory. `UNVERIFIED` on the byte figure being an
  official number — treat as an estimate.
- Make sure the scrape negotiates OpenMetrics:

```yaml
scrape_configs:
  - job_name: my-app
    scrape_protocols:
      - OpenMetricsText1.0.0
    static_configs:
      - targets: ['app:8080']
```

  The default protocol list already prefers `OpenMetricsText1.0.0`, so this is usually belt-and-braces — but
  pin it in the book so the lab is deterministic.
- There is also a **per-scrape** exemplar limit distinct from the storage buffer: *"Per-scrape limit on the
  number of exemplars that will be accepted. If more than this number of exemplars are present after metric
  relabeling the entire scrape will be treated as failed. 0 means no limit."* Note the harshness — **exceeding
  it fails the whole scrape**, not just the exemplars. `UNVERIFIED` on the exact YAML key name for this
  per-scrape limit (the config reference truncated); check `scrape_config` in the configuration docs.

If you are using **Grafana Alloy** instead of a Prometheus server, no feature flag is needed; you need
`send_exemplars = true` on the remote-write endpoint:

```alloy
prometheus.scrape "self" {
  targets = [
    { "__address__" = "localhost:9090" },
  ]
  forward_to = [prometheus.remote_write.default.receiver]
}

prometheus.remote_write "default" {
  endpoint {
    url            = "https://prometheus-xxx.grafana.net/api/prom/push"
    send_exemplars = true
    basic_auth {
      username = "<PROMETHEUS_USERNAME>"
      password = "<GRAFANA_CLOUD_API_KEY>"
    }
  }
}
```

Verification metric: **`prometheus_remote_write_wal_exemplars_appended_total`** should be non-zero.

### 7.6 Step 4 — query them

Prometheus exposes a dedicated, **experimental** API endpoint (it is *not* part of `/api/v1/query`):

```
GET  /api/v1/query_exemplars
POST /api/v1/query_exemplars
```

Parameters: `query=<string>` (PromQL), `start=<rfc3339|unix_timestamp>`, `end=<rfc3339|unix_timestamp>`.

```bash
curl -g 'http://localhost:9090/api/v1/query_exemplars?query=test_exemplar_metric_total&start=2020-09-14T15:22:25.479Z&end=2020-09-14T15:23:25.479Z'
```

```json
{
  "status": "success",
  "data": [
    {
      "seriesLabels": {
        "__name__": "test_exemplar_metric_total",
        "instance": "localhost:8090",
        "job": "prometheus",
        "service": "bar"
      },
      "exemplars": [
        {
          "labels": {"trace_id": "EpTxMJ40fUus7aGY"},
          "value": "6",
          "timestamp": 1600096945.479
        }
      ]
    }
  ]
}
```

The docs state this feature *"is experimental and might change in the future."*

### 7.7 Step 5 — wire the trace link in Grafana

On the **Prometheus data source**, under **Exemplars**:

| Field | Meaning |
|---|---|
| **Internal link** | Toggle on to link to a Grafana data source; reveals the data source selector |
| **Data source** | The tracing data source (Tempo) |
| **URL** | *"Defines the external link's URL trace backend"* — used when Internal link is off |
| **Label name** | *"The name of the field in the `labels` object used to obtain the traceID property"* |
| **URL label** | *"Adds a custom display label to override the value of the `Label name` field"* |

Provisioning, verbatim from the docs:

```yaml
exemplarTraceIdDestinations:
  - datasourceUid: my_jaeger_uid
    name: traceID
  - name: traceID
    url: 'http://localhost:3000/explore?orgId=1&left=...'
```

**The `name` field must match the exemplar label key your app emits.** If the app writes `trace_id` and the
data source says `traceID`, you get stars with no link and no error message. This is the #1 silent failure.

Other Prometheus data source options worth knowing: `httpMethod` (*"POST is recommended and selected by
default"*), `prometheusType` (Prometheus | Mimir | Thanos | Cortex), `prometheusVersion`,
`incrementalQuerying`, `timeInterval` (defaults to `15s`).

### 7.8 Step 6 — turn them on in the panel

- Toggle **Exemplars** in the **query editor** (per query, not per panel).
- **There is no exemplar option for Instant queries.** Range queries only.
- Panel type must be **Time series** (the old Graph panel does not render them).
- Rendering: each exemplar is a **highlighted star** on the graph. Hovering shows the label key/value; a button
  ("Query with Tempo") opens the trace in a split pane.
- Grafana's docs state: *"Support for exemplars is available for the Prometheus data source only."*

### 7.9 The exemplar failure checklist (put this in the book as a box)

1. App does not call `ObserveWithExemplar` / pass `exemplar=` at all.
2. Handler not in OpenMetrics mode (`EnableOpenMetrics: true` missing).
3. Metric type is a **gauge** — gauges cannot have exemplars.
4. Span was not sampled, so the `TraceBased` exemplar filter dropped it.
5. Prometheus started without `--enable-feature=exemplar-storage`.
6. Scrape negotiated `PrometheusText0.0.4` instead of OpenMetrics.
7. `exemplarTraceIdDestinations[].name` does not match the emitted label key (`trace_id` vs `traceID`).
8. Panel is using an Instant query, or is not a Time series panel.
9. Exemplar label set exceeds **128 UTF-8 code points** and was rejected.
10. Exemplars expired out of the 100k circular buffer (they are short-lived by design — you cannot go
    exemplar-hunting in last week's data).

### 7.10 The easier path worth mentioning

If wiring app-side exemplars is too much for chapter N, **Tempo's metrics-generator adds exemplars to
`traces_spanmetrics_*` automatically** (§6.4), and **TraceQL metrics support exemplars via
`with (exemplars=true)`** (§6.3). Both give the reader a working metric→trace click with zero application
code changes. That is a good "early win."

---

## 8. Correlation in Grafana — the four mechanisms and when to use each

Grafana has **four** overlapping ways to jump between signals. Books usually cover one and confuse the reader.
Here is the full map.

| Mechanism | Lives on | Direction | Configured where |
|---|---|---|---|
| **Exemplars** | Prometheus data source | metric → trace | `exemplarTraceIdDestinations` |
| **Derived fields** | Loki data source | log → trace (or any URL) | `jsonData.derivedFields` |
| **Trace to X** | Tempo data source | trace → logs / metrics / profiles | `tracesToLogsV2`, `tracesToMetrics`, `tracesToProfiles` |
| **Correlations** | Grafana admin / provisioning | any → any (Explore) | `correlations:` block or Administration UI |
| *(plus)* **Data links** | Panel options | panel value → URL or another panel | Panel editor |

### 8.1 Derived fields (Loki → Tempo)

Fields (from the Loki data source docs):

- **Name** — *"Sets the field name. Displayed as a label in the log details."*
- **Type** — **Regex** or **Label**.
- **Regex** — *"A regular expression to parse a part of the log message and capture it as the value of the new
  field. **Can contain only one capture group.**"*
- **Label** — *"A label from the selected log line…the value of the matched label will be used as the value of
  the derived field."* Works with **indexed labels, parsed labels, and structured metadata**.
- **URL/query** — *"Sets the full link URL if the link is external, or a query for the target data source if
  the link is internal."*
- **URL Label** — custom display label.
- **Internal link** — toggle to target a Grafana tracing data source.
- **Open in new tab** — link behaviour.

**The `Label` type is the modern, correct choice when logs are ingested via OTLP**, because the trace ID is
already sitting in structured metadata and you should not regex a log line to find it. With the Label type the
input is matched **as a regular expression against label *keys***, so `trace[_]?id` catches both `traceid` and
`trace_id`. The provisioning key is `matcherType` (`regex` | `label`); an **undefined `matcherType` is treated
as `regex`** for backwards compatibility.

Warning from the docs worth repeating: *"Using complex regular expressions in either type can impact browser
performance when processing large volumes of logs."*

Provisioning, verbatim:

```yaml
apiVersion: 1
datasources:
  - name: Loki
    type: loki
    access: proxy
    url: http://localhost:3100
    basicAuth: true
    basicAuthUser: my_user
    jsonData:
      maxLines: 1000
      derivedFields:
        - datasourceUid: my_jaeger_uid
          matcherRegex: "traceID=(\\w+)"
          name: TraceID
          url: '$${__value.raw}'
          urlDisplayLabel: 'View Trace'
        - matcherRegex: "traceID=(\\w+)"
          name: TraceID
          url: 'http://localhost:16686/trace/$${__value.raw}'
    secureJsonData:
      basicAuthPassword: test_password
```

**Two escaping traps in one snippet:**
1. `$${__value.raw}` — the doubled `$$` is required because *"you must escape the dollar (`$`) character in
   YAML values because it can be used to interpolate environment variables."*
2. `"traceID=(\\w+)"` — YAML double quotes, so the backslash is doubled.

Get either wrong and the link silently does nothing.

### 8.2 Trace → logs / metrics / profiles (Tempo data source)

**This is the complete, verbatim provisioning example from the Grafana docs** — the single most useful config
block in this dossier:

```yaml
apiVersion: 1

datasources:
  - name: Tempo
    type: tempo
    uid: EbPG8fYoz
    url: http://localhost:3200
    access: proxy
    basicAuth: false
    jsonData:
      tracesToLogsV2:
        datasourceUid: 'loki'
        spanStartTimeShift: '-1h'
        spanEndTimeShift: '1h'
        tags: [{ key: 'job' }, { key: 'instance' }, { key: 'pod' }, { key: 'namespace' }]
        filterByTraceID: false
        filterBySpanID: false
        customQuery: true
        query: 'method="$${__span.tags.method}"'
      tracesToMetrics:
        datasourceUid: 'prom'
        spanStartTimeShift: '-1h'
        spanEndTimeShift: '1h'
        tags: [{ key: 'service.name', value: 'service' }, { key: 'job' }]
        queries:
          - name: 'Sample query'
            query: 'sum(rate(traces_spanmetrics_latency_bucket{$$__tags}[5m]))'
      tracesToProfiles:
        datasourceUid: 'grafana-pyroscope-datasource'
        tags: [{ key: 'job' }, { key: 'instance' }, { key: 'pod' }, { key: 'namespace' }]
        profileTypeId: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds'
        customQuery: true
        query: 'method="$${__span.tags.method}"'
      serviceMap:
        datasourceUid: 'prometheus'
      nodeGraph:
        enabled: true
      search:
        hide: false
      traceQuery:
        timeShiftEnabled: true
        spanStartTimeShift: '-1h'
        spanEndTimeShift: '1h'
      spanBar:
        type: 'Tag'
        tag: 'http.path'
      streamingEnabled:
        search: true
        metrics: true
```

Notes for the author:
- **`tracesToLogsV2`** is the current key. Plain `tracesToLogs` is the **legacy v1** form — you will still see
  it in older examples (including Grafana's own `intro-to-mltp` repo, see below). Use V2.
- **`tags`** maps span attributes → target-data-source labels. `{ key: 'service.name', value: 'service' }`
  means "take span attribute `service.name`, call it `service` in the query."
- **`$__tags`** (written `$$__tags` in provisioning YAML) interpolates the mapped tags as a matcher list in the
  target language.
- Span-scoped variables: `${__span.tags.<name>}`, plus `__span.name`, `__span.duration`, `__span.spanId`,
  `__span.traceId`. In YAML these need `$${...}`.
- **Time shifts default to `-2m` / `2m`** in the trace-to-metrics UI. They exist because the span's instant is
  a point, and you need a window around it to have any metric samples at all.
- `profileTypeId: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds'` is the exact Pyroscope profile-type string
  format: `<name>:<sample type>:<sample unit>:<period type>:<period unit>`.

### 8.3 Correlations

**Correlations** are a Grafana-level (not data-source-level) feature: *"You can create interactive links for
Explore visualizations by setting up Correlations. These links can either run queries or generate external URLs
related to presented data."*

- Two kinds: **query-based** (runs a query in another data source, opens in Split View) and **URL-based**
  (external link, new tab).
- Supported visualizations: **Logs panel and Table** (as documented).
- Configured via **Administration → Plugins and data → Correlations**, directly in Explore, or by provisioning.
- `UNVERIFIED`: the current GA/experimental status and whether any feature toggle is still required. The docs
  page does not state one. Check before asserting "GA" in print.

A real provisioned correlation, from Grafana's own `intro-to-mltp` demo repo — note it lives **under the data
source**, as a sibling of `jsonData`, and uses a `transformations` regex to pull a value out of span tags:

```yaml
    correlations:
      - targetUID: postgres
        label: "Count $$beast in table"
        description: ''
        config:
          type: query
          field: tags
          target:
            editorMode: code
            format: table
            rawQuery: true
            rawSql: "SELECT COUNT(*) FROM $$beast;"
            refId: A
          transformations:
          - type: regex
            expression: .*{"value":"(.*?)","key":"beast".*}
            mapValue: beast
```

### 8.4 The canonical reference lab: `grafana/intro-to-mltp`

Grafana maintains a public MLTP (Metrics, Logs, Traces, Profiles) demo. Its
`grafana/provisioning/datasources/datasources.yaml` is the best single artifact to model the book's lab on.
Reproduced verbatim (fetched 2026-07-27):

```yaml
apiVersion: 1

datasources:
  - name: Loki
    type: loki
    access: proxy
    uid: loki
    url: http://loki:3100
    jsonData:
      derivedFields:
        - datasourceUid: tempo
          matcherRegex: "^.*?traceI[d|D]=(\\w+).*$"
          name: traceId
          url: '$${__value.raw}'

  - name: Tempo
    type: tempo
    access: proxy
    uid: tempo
    url: http://tempo:3200
    jsonData:
      nodeGraph:
        enabled: true
      serviceMap:
        datasourceUid: 'Mimir'
      tracesToLogs:
        datasourceUid: loki
        filterByTraceID: false
        spanEndTimeShift: "500ms"
        spanStartTimeShift: "-500ms"
        tags: ['beast']

  - name: Mimir
    type: prometheus
    access: proxy
    uid: mimir
    url: http://mimir:9009/prometheus
    jsonData:
      exemplarTraceIdDestinations:
        - datasourceUid: tempo
          name: traceID
      httpMethod: POST
      timeInterval: "2s"

  - name: Pyroscope
    type: phlare
    access: proxy
    uid: pyroscope
    url: http://pyroscope:4040
    jsonData:
      backendType: pyroscope
```

Three things to *fix* if you copy it:
1. It uses the legacy **`tracesToLogs`**; use `tracesToLogsV2`.
2. The Pyroscope data source `type` is **`phlare`** — a historical name (Phlare merged into Pyroscope). The
   current plugin id used elsewhere in Grafana docs is `grafana-pyroscope-datasource`. `UNVERIFIED` which id is
   canonical in Grafana 13; test both.
3. `serviceMap.datasourceUid: 'Mimir'` is capitalised while the actual `uid:` is `mimir`. UIDs are
   case-sensitive; this kind of mismatch is exactly what silently breaks service maps.

### 8.5 Explore and the Drilldown apps

- **Explore** is the ad-hoc, non-dashboard query surface. Split view (two panes, linked time range) is the
  workhorse for correlation: metric on the left, trace or logs on the right.
- The four **Grafana Drilldown apps** — **Metrics Drilldown, Logs Drilldown, Traces Drilldown, Profiles
  Drilldown** — are the *queryless*, point-and-click exploration surfaces. **They were introduced at
  ObservabilityCON 2024 as the "Explore apps" and were renamed to "Drilldown" since.** Any source calling them
  "Explore Metrics" / "Explore Logs" / "Explore Traces" / "Explore Profiles" is using the old name.
  Plugin ids retain the old naming: `grafana-lokiexplore-app` (Logs Drilldown),
  `grafana-exploretraces-app` (Traces Drilldown).
- Traces Drilldown surfaces **RED metrics derived from traces** for investigation.
- Pedagogically: Drilldown is a great chapter-3 "early win" (a real view with zero PromQL), but the book must
  not let it replace teaching PromQL. Show Drilldown, then show the query it is standing in for.

---

## 9. Continuous profiling — Pyroscope

### 9.1 What profiling adds that traces don't

A trace tells you *which span* was slow. A profile tells you *which function* burned the CPU (or allocated the
memory) while that span was running. It is the fourth signal, and its unit is the **stack trace sample**.

Continuous profiling = sampling profiles from production continuously at low overhead (single-digit percent),
rather than attaching a profiler to a sick process after the fact.

### 9.2 Pyroscope status

- **Grafana Pyroscope 2.2.0 (2026-07-21)** is current. **Pyroscope 2.0 was announced 2026-04-21.**
- Pyroscope 2.0 is *"a ground-up rearchitecture"*: no write-path replication (each profile written once, not
  three times), read/write decoupled, **object storage is the single source of truth**, stateless read path.
  Object storage is **mandatory** for distributed deployments in v2.
- **Symbol deduplication** (co-locating function names, source locations, stack traces) cuts symbol storage by
  **up to 95%** in production.
- New in 2.x: metrics-from-profiles, individual profile inspection, heatmap visualizations, richer query types.
- 2.2.0 added `trace_id_selector` filtering, query-bar autocomplete, and a public symbolizer API for
  address-level symbol resolution.

### 9.3 Pyroscope ↔ OpenTelemetry

- **Pyroscope 2.0 has native OTLP profiles ingestion.** It receives OTLP profiles over **gRPC on port 4040**.
- Collector wiring (both exporter styles are used in the wild):

```yaml
exporters:
  otlp/pyroscope:
    endpoint: pyroscope:4040
    tls:
      insecure: true

service:
  pipelines:
    profiles:
      receivers: [otlp]
      processors: [memory_limiter, batch, resource]
      exporters: [otlp/pyroscope]
```

- **Span profiles** are the profiling↔tracing bridge, and they work the same way exemplars do conceptually:
  a `TracerProvider` wrapper (`grafana/otel-profiling-go`, `grafana/otel-profiling-python`) annotates profile
  samples with **`trace_id` and `span_id` pprof labels**, so you can ask Pyroscope for "the profile of this
  one span."
- Grafana surfaces this through **`tracesToProfiles`** on the Tempo data source (§8.2) with an embedded flame
  graph in the span detail.
- Tempo 3.0 added *"span profiling with native Pyroscope integration."*

### 9.4 The OTel profiles signal itself

- **Alpha / "public Alpha".** The concept page says the signal is `[Alpha]`; the OTLP spec says `development`;
  the OTLP HTTP path is literally `/v1development/profiles`.
- Announced as entering public Alpha in an `opentelemetry.io/blog/2026/profiles-alpha/` post referencing
  spec **v1.55.0**, **Collector v0.148.0 or newer**, an official **eBPF profiler collector distribution**,
  and runtime support for **Go, Node.js (ARM64), .NET 9 and 10, Ruby, and initial BEAM (Erlang/Elixir)**.
- The blog is explicit: it *"should not be used for critical production workloads."*
- `UNVERIFIED`: several secondary sources claim profiles reached "release candidate in Q1 2026" and are
  "targeting GA by Q3 2026." **The primary sources on 2026-07-27 say Alpha / development.** Do not print the
  RC/GA claim. If the book needs a forward-looking sentence, say "expected to progress toward Beta" and cite
  nothing more specific.

**Definition to quote:** *"A profile is a collection of samples and associated metadata that shows where
applications consume resources during execution."* Language integrations lean on existing runtime frameworks —
*"such as JFR for Java or pprof for Go."*

---

## 10. eBPF: zero-code instrumentation

### 10.1 OBI — OpenTelemetry eBPF Instrumentation (formerly Grafana Beyla)

**The name change matters and most existing material predates it.**

- Grafana Labs **donated Beyla to OpenTelemetry in 2025**; the project is now **OpenTelemetry eBPF
  Instrumentation (OBI)**. A weekly SIG launched in May 2025 with maintainers from Grafana Labs, Splunk,
  Odigos, Coralogix and others. First alpha release announced late 2025.
- **Current release v0.10.0.** Recent versions added gRPC/HTTP2 context propagation, Go channel span links,
  Go and JVM runtime metrics, SunRPC, expanded GenAI instrumentation (including vector databases),
  signal-specific dynamic process selection, and configuration v2 groundwork. DATE-SOFT.
- Reported milestones: v0.8.0 around 2026-04-16, a **Beta launch at KubeCon EU 2026** (2026-03-25/26,
  Amsterdam), and a **1.0 GA planned for late 2026**. `UNVERIFIED` — the beta/GA claims come from secondary
  sources; the version numbers are verified.
- **Grafana Beyla still exists** as a downstream distribution of OBI with commercial support, Grafana Cloud
  integrations, and extra features such as process metrics.
- Coralogix separately donated its own eBPF auto-instrumentation to OpenTelemetry (2025).

**What OBI produces:** distributed trace spans for web transactions, **RED metrics**, service graphs,
application/runtime metrics (Go runtime, JVM memory), and network flow metrics with TCP/packet data.

**Protocols:** HTTP/HTTPS, HTTP/2, gRPC, SQL, Redis, MongoDB, Kafka, GraphQL, Elasticsearch/OpenSearch, AWS S3.

**Languages:** it instruments *all* languages for basic RED metrics because it works at the protocol/kernel
level, not the library level. **Distributed tracing** (context propagation) works well for **Go, Node.js,
Python, NGINX, PHP**, with varying support elsewhere.

**Requirements:**
- Linux kernel **5.8+** (RHEL 4.18+ with eBPF backports)
- **amd64 or arm64**
- Kernel **BTF** support
- Root, or specific Linux capabilities depending on features
- Deployable standalone, in containers, on Kubernetes, or **as an OpenTelemetry Collector receiver component**

### 10.2 The OTel eBPF profiler

- Ships as an official Collector distribution: **`otelcol-ebpf-profiler`**.
- Collects **system-wide CPU profiles from all processes on a Linux host**, default sampling **97 Hz**, and
  sends them over **OTLP gRPC**.
- Requires: Linux amd64/arm64, **privileged host access**, host PID namespace, and mounts of `/proc`,
  `/sys/kernel`, `/lib/modules`.
- Must be started with the feature gate **`--feature-gates=service.profilesSupport`**.

Minimal config (from the Pyroscope docs):

```yaml
receivers:
  profiling:
    samples_per_second: 97

exporters:
  otlp_grpc:
    endpoint: pyroscope:4040
    tls:
      insecure: true

service:
  pipelines:
    profiles:
      receivers: [profiling]
      exporters: [otlp_grpc]
```

Service-name mapping is not automatic; relabel on the Pyroscope side:

```yaml
limits:
    ingestion_relabeling_rules:
        - action: labelmap
          regex: ^process.executable.name$
          replacement: service_name
```

Grafana's own honesty about this, worth quoting to the reader: it is *"suitable for development and testing"*;
the profiles signal is under active development with potential breaking changes; flamegraph function-name
resolution may be incomplete; and profiler/collector/Pyroscope versions must be aligned.

### 10.3 The balanced take (Grafana's own position)

Grafana published "Why OpenTelemetry instrumentation needs both eBPF and SDKs." The honest framing for a
textbook:

- **eBPF gets you 80% coverage in 5 minutes with zero code changes** — every service, every language, uniform
  RED metrics. Perfect for "we have 200 services and no instrumentation."
- **eBPF cannot see inside your business logic.** It knows there was an HTTP request; it does not know the
  tenant ID, the feature flag, or that this was the retry. It cannot instrument a pure-compute code path with
  no syscalls.
- **eBPF context propagation across process boundaries is the hard part** and is language-dependent.
- Therefore: eBPF for baseline coverage, SDKs for the parts you care about. They are complements.
- Deployment cost is real: kernel version floor, privileged containers, and a security review.

---

## 11. Guidance for the chapter

### 11.1 Suggested narrative arc

1. **Open with a failure the reader's metrics cannot solve.** "p99 checkout latency doubled at 14:20." The
   dashboard is red. Now what? Every PromQL query the reader has learned so far returns another aggregate.
2. **Name the limitation honestly** (§2): metrics discarded request identity on purpose, in exchange for a
   cost curve that doesn't move with traffic.
3. **Introduce the other signals as answers to specific questions**, not as "pillars":
   - *which request?* → traces
   - *what did it say?* → logs
   - *which function?* → profiles
4. **Then critique the pillar framing** (§1) — because by now the reader has felt the join problem themselves.
5. **Show the bridges**: exemplars (metric→trace), derived fields / structured metadata (log→trace),
   trace-to-logs/metrics/profiles (trace→everything).
6. **Land on OpenTelemetry** as the thing that makes the bridges possible: one context, one propagation
   format, one set of attribute names, one wire protocol.
7. **Close with what's still moving** (profiles, eBPF, PRW 2.0, wide events) so the reader isn't surprised in
   six months.

### 11.2 What to actually put in the growing lab

Minimum viable "everything" stack, all single-binary, all docker-compose friendly:

- `prom/prometheus:v3.13.1` with `--enable-feature=exemplar-storage` (add `--web.enable-otlp-receiver` only if
  the chapter demonstrates OTLP push)
- `grafana/grafana:13.1.1`
- `grafana/loki:3.7.4` (monolithic mode, filesystem storage, `allow_structured_metadata: true`)
- `grafana/tempo:3.0.2` (monolithic, local storage; metrics-generator remote-writing to Prometheus)
- `grafana/alloy:v1.18.0` **instead of Promtail** for log shipping
- optional: `grafana/pyroscope:2.2.0`
- optional: `otel/opentelemetry-collector-contrib:0.157.0`

Prometheus must run with `--web.enable-remote-write-receiver` for Tempo's metrics-generator to push into it.
`UNVERIFIED` version-pin exactness of the Docker tags above — confirm each tag exists on Docker Hub before
publishing; `grafana/tempo` tags may be `3.0.2` or `v3.0.2` depending on the repo's convention.

### 11.3 What to deliberately leave out

- Kubernetes-specific machinery (Operator, PodMonitor/ServiceMonitor, Target Allocator) — one optional chapter
  at most, per the brief.
- Loki bloom filters, DataObj, Loki microservices mode.
- Tempo microservices/Kafka mode.
- OTel Arrow (mention in one sentence; it's a transport optimization, not a concept the reader needs).
- Remote Write 2.0 internals.
- Mimir/Thanos/Cortex — name them once as "Prometheus-compatible long-term storage" and move on.

### 11.4 Terminology hygiene table

| Say this | Not this | Why |
|---|---|---|
| OpenTelemetry eBPF Instrumentation (OBI) | Beyla | Donated & renamed; Beyla is now the downstream distro |
| Grafana Alloy | Grafana Agent, Promtail | Agent superseded; Promtail removed in Loki 3.7.3 |
| Logs Drilldown / Metrics Drilldown | Explore Logs / Explore Metrics | Renamed |
| `tracesToLogsV2` | `tracesToLogs` | V1 is legacy |
| structured metadata | "index the trace ID" | Trace IDs must never be Loki stream labels |
| `deployment.environment.name` | `deployment.environment` | semconv rename |
| native histogram | "the new histogram" | Stable since Prometheus 3.8.0; still needs `scrape_native_histograms` |
| span attributes / resource attributes | tags | OTel dropped "tags"; Grafana's UI still says Tags in places |

---

## 12. Beginner pitfalls specific to this topic

1. **Believing the "three pillars" are three products you must buy.** They're three data shapes; one vendor or
   stack usually covers all of them.
2. **Putting a trace ID in a Prometheus label** to "correlate." This is the cardinality bomb. Exemplars exist
   precisely so you don't.
3. **Expecting exemplars to work with the classic Prometheus text format.** They only ride on OpenMetrics (or
   protobuf).
4. **Expecting exemplars on a gauge.** Counters and histograms (and gauge-histograms) only.
5. **Expecting exemplars on an Instant query / on a Stat panel.** Range queries, Time series panels.
6. **Trace-ID label key mismatch** (`trace_id` in the app, `traceID` in the data source config). Silent.
7. **Head-based sampling at 1% + `TraceBased` exemplar filter = almost no exemplars.** And the ones you get are
   biased toward whatever the sampler kept.
8. **Assuming an exemplar link means the trace exists.** Exemplars live ~100k entries in a circular buffer;
   traces live under Tempo's own retention. The link can 404 legitimately.
9. **Treating LogQL as "PromQL for logs" without noticing the regex-anchoring difference.** Stream selector
   regexes are anchored; line filter regexes are not; TraceQL regexes are anchored.
10. **Making high-cardinality Loki stream labels** (pod name, request ID, trace ID) because "Loki is cheap."
    Loki has the same cardinality physics as Prometheus for labels.
11. **Copying `$${__value.raw}` as `${__value.raw}`** in provisioning YAML, or forgetting `$$__tags`.
12. **Assuming OTel means you no longer need to understand Prometheus's data model.** You need it *more* —
    `target_info`, `otel_scope_*`, suffix rules, and delta-vs-cumulative all leak through.
13. **Assuming the OTel Collector is 1.0-stable.** It's `v0.157.0` and component stability varies.
14. **Assuming your language's OTel logs SDK is stable.** For Go it's Beta; for Python and JS it's Development.
15. **Enabling profiling/eBPF in a lab without checking kernel version and privileges** and concluding the tool
    is broken.

---

## 13. Stale advice to avoid (things older books and blogs still say)

| Stale claim | Reality on 2026-07-27 |
|---|---|
| "Use Promtail to ship logs to Loki." | Promtail is **removed** (Loki v3.7.3). Use **Grafana Alloy**. |
| "Use Grafana Agent." | Superseded by Grafana Alloy. |
| "Install Loki with the `loki-distributed` / `loki-simple-scalable` Helm chart." | Deprecated. Chart moved to `grafana-community/helm-charts` (2026-03-16). SSD mode goes away in Loki 4.0. |
| "Enable Tempo's `local-blocks` processor to use TraceQL metrics." | `local-blocks` was **removed in Tempo 3.0**. |
| "Tempo needs ingesters / replication factor 3." | Tempo 3.0 removed ingesters and compactors; RF1. |
| "Send traces to Tempo with the OpenCensus receiver." | Removed in Tempo 3.0. Use OTLP. |
| "Native histograms are experimental; use `--enable-feature=native-histograms`." | **Stable since Prometheus v3.8.0.** The flag is a no-op from v3.9; set `scrape_native_histograms` instead. |
| "Prometheus can't accept OpenTelemetry data." | It has a native OTLP metrics receiver (`--web.enable-otlp-receiver`, `/api/v1/otlp/v1/metrics`). Metrics only. |
| "Prometheus metric names must match `[a-zA-Z_:][a-zA-Z0-9_:]*`." | UTF-8 names allowed by default since Prometheus 3.x; PromQL has a quoted selector form. |
| "The OTel Collector will hit 1.0 soon / is 1.0." | Still `v0.x` (v0.157.0). No 1.0. |
| "Remote Write 2.0 is the stable protocol now." | Spec still `[EXPERIMENTAL]`; stabilization tracked in PROM-35. |
| "OpenTelemetry logs are stable everywhere." | Spec is stable; **Go = Beta, Python/JS/Ruby/Swift = Development.** |
| "OTel profiles are GA / RC." | **Alpha.** OTLP profiles = `development`; endpoint path is `/v1development/profiles`. |
| "Use Grafana Beyla." | Donated to OpenTelemetry, now **OBI**. Beyla persists only as the downstream commercial distro. |
| "Explore Metrics / Explore Logs / Explore Traces apps." | Renamed **Drilldown**. |
| "Configure OTel purely with environment variables." | **Declarative configuration (`OTEL_CONFIG_FILE`) is now stable** in C++, Go, Java, JS, PHP. |
| "GenAI semantic conventions are stable." | Development, moved to their own repo, **no tagged release**. |
| "Use `tracesToLogs` in the Tempo data source." | Use **`tracesToLogsV2`**. |
| "Derived fields require a regex over the log line." | The **Label** matcher type (`matcherType: label`) reads indexed labels, parsed labels, or structured metadata. |
| "Loki full-text-indexes your logs / Loki's bloom filters give you full-text search." | Loki indexes labels only. Bloom filters are **experimental** and now target **structured metadata**, not free text. |
| "Pyroscope and Phlare are different projects." | Phlare merged into Pyroscope; the Grafana data source `type: phlare` is a historical artifact. |
| "OpenTelemetry is an incubating CNCF project." | **Graduated 2026-05-21.** |
| "Jaeger is the default tracing backend to pair with Prometheus." | Still valid software, but the Grafana-stack book should use **Tempo**; Grafana's own correlation features are richest there. |
| "`avg(p99)` across instances." | Always wrong. Aggregate buckets, then `histogram_quantile`. |

---

## 14. Open questions / things the author must re-verify before print

1. **Release dates from GitHub releases pages.** Several fetches resolved relative timestamps to 2024 while
   other sources say 2026 (Tempo 3.0.x, OBI v0.10.0, semconv v1.4x). Versions are solid; dates need a second
   pass against changelogs.
2. **Whether Prometheus's native OTLP receiver ingests exemplars.** The OTel↔Prometheus compatibility spec
   *mandates* `trace_id` / `span_id` exemplar labels, and the Collector's Prometheus receiver does the
   conversion — but I could not verify live that Prometheus's own OTLP write path stores exemplars. **Test it
   before claiming it.**
3. **Exact YAML key for the per-scrape exemplar limit** in `scrape_config` (docs page truncated).
4. **Tempo generator exemplar toggle** — exact key under `metrics_generator.processor.span_metrics`.
5. **Grafana Correlations stability/feature-toggle status** in Grafana 13.
6. **Pyroscope Grafana data source type id** in Grafana 13: `phlare` vs `grafana-pyroscope-datasource`.
7. **`client_java` exemplar API** for the current 1.x line.
8. **OBI beta/GA timeline claims** (KubeCon EU 2026 beta, late-2026 GA) — secondary sources only.
9. **Loki DataObj / new query engine GA timing.**
10. **Docker image tag conventions** for every image pinned in the lab.

---

## Sources

All fetched or searched on **2026-07-27**.

### OpenTelemetry
- https://opentelemetry.io/docs/specs/status/ — specification status summary (signal stability table)
- https://opentelemetry.io/status/ — per-language SDK signal status
- https://opentelemetry.io/docs/specs/otlp/ — OTLP 1.11.0: transports, ports, paths
- https://opentelemetry.io/docs/specs/semconv/ — semantic conventions 1.43.0
- https://github.com/open-telemetry/semantic-conventions/releases — semconv release history
- https://opentelemetry.io/docs/specs/semconv/http/http-spans/ — HTTP span conventions (Stable)
- https://opentelemetry.io/docs/specs/semconv/non-normative/http-migration/ — `OTEL_SEMCONV_STABILITY_OPT_IN`
- https://opentelemetry.io/docs/specs/otel/metrics/sdk/ — exemplar filters and reservoirs (Stable)
- https://opentelemetry.io/docs/specs/otel/compatibility/prometheus_and_openmetrics/ — name mapping, `target_info`, `otel_scope_*`, exemplars, delta handling
- https://opentelemetry.io/docs/collector/ — Collector status ("mixed")
- https://opentelemetry.io/docs/collector/distributions/ — the five official distributions
- https://github.com/open-telemetry/opentelemetry-collector-releases/releases — v0.157.0 (2026-07-22)
- https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/receiver/prometheusreceiver/README.md — Beta, limitations, exemplar conversion
- https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/prometheusexporter/README.md — `enable_open_metrics`
- https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/connector/spanmetricsconnector/README.md — alpha; metric names, exemplars, histogram config
- https://opentelemetry.io/blog/2026/profiles-alpha/ — profiles public Alpha
- https://opentelemetry.io/docs/concepts/signals/profiles/ — profiles definition, Alpha
- https://opentelemetry.io/blog/2026/stable-declarative-config/ — `OTEL_CONFIG_FILE` stable
- https://opentelemetry.io/blog/2026/otel-graduates/ — CNCF graduation
- https://www.cncf.io/announcements/2026/05/21/cloud-native-computing-foundation-announces-opentelemetrys-graduation-solidifying-status-as-the-de-facto-observability-standard/
- https://opentelemetry.io/blog/2024/prom-and-otel/ — official Prometheus interop positioning
- https://opentelemetry.io/blog/2023/otel-arrow/ and https://opentelemetry.io/blog/2024/otel-arrow-production/ and https://opentelemetry.io/blog/2026/otel-arrow-phase-2/ — OTel Arrow
- https://opentelemetry.io/blog/2025/obi-announcing-first-release/ — OBI first release
- https://opentelemetry.io/docs/zero-code/obi/ — OBI requirements and capabilities
- https://github.com/open-telemetry/opentelemetry-ebpf-instrumentation/releases — OBI v0.10.0

### Prometheus
- https://prometheus.io/docs/guides/opentelemetry/ — `--web.enable-otlp-receiver`, `otlp:` block, translation strategies, delta flag
- https://prometheus.io/docs/prometheus/latest/feature_flags/ — full feature-flag list
- https://prometheus.io/docs/prometheus/latest/configuration/configuration/ — `scrape_protocols`, `otlp:`, `storage.exemplars`, scrape defaults
- https://prometheus.io/docs/prometheus/latest/querying/api/ — `/api/v1/query_exemplars`
- https://prometheus.io/docs/instrumenting/exposition_formats/ — OpenMetrics content type, exemplar note
- https://prometheus.io/docs/specs/om/open_metrics_spec/ — exemplar ABNF, 128-code-point limit, worked example
- https://prometheus.io/docs/specs/native_histograms/ — stable in v3.8.0, `scrape_native_histograms`, NHCB
- https://prometheus.io/docs/specs/prw/remote_write_spec_2_0/ — PRW 2.0 `[EXPERIMENTAL]`
- https://github.com/prometheus/prometheus/issues/16944 — PROM-35 PRW 2.0 stability meta-issue
- https://prometheus.io/blog/2024/11/14/prometheus-3-0/ — Prometheus 3.0 announcement
- https://prometheus.io/blog/2026/02/14/modernizing-prometheus-composite-samples/ — NHCB, OpenMetrics 2.0 direction
- https://prometheus.io/docs/introduction/release-cycle/ — LTS policy
- https://github.com/prometheus/prometheus/releases — 3.13.1 / 3.13.0 LTS
- https://github.com/prometheus/client_golang/blob/main/examples/exemplars/main.go — Go exemplar example
- https://prometheus.github.io/client_python/instrumenting/exemplars/ — Python exemplar API

### Grafana / Loki / Tempo / Pyroscope / Alloy
- https://github.com/grafana/grafana/releases — Grafana 13.1.1
- https://grafana.com/blog/grafana-13-release-all-the-latest-features/ — Grafana 13 (2026-04-21)
- https://grafana.com/blog/grafana-13-1-release-all-the-latest-features/ — Grafana 13.1
- https://grafana.com/docs/grafana/latest/fundamentals/exemplars/ — exemplar concept, Prometheus-only support
- https://grafana.com/docs/grafana/latest/datasources/prometheus/configure/ — exemplars config, `exemplarTraceIdDestinations`
- https://grafana.com/docs/grafana/latest/datasources/prometheus/query-editor/ — Exemplars toggle
- https://grafana.com/docs/grafana-cloud/send-data/traces/configure/exemplars/ — end-to-end exemplar setup, Alloy `send_exemplars`
- https://grafana.com/docs/grafana/latest/datasources/loki/configure-loki-data-source/ — derived fields (Regex / Label)
- https://grafana.com/docs/grafana/latest/datasources/loki/ — Loki provisioning YAML with `derivedFields`
- https://grafana.com/docs/grafana/latest/datasources/tempo/configure-tempo-data-source/provision/ — **full Tempo provisioning YAML**
- https://grafana.com/docs/grafana/latest/datasources/tempo/configure-tempo-data-source/configure-trace-to-metrics/ — trace-to-metrics fields and `$__tags`
- https://grafana.com/docs/grafana/latest/administration/correlations/ — Correlations
- https://github.com/grafana/intro-to-mltp/blob/main/grafana/provisioning/datasources/datasources.yaml — reference MLTP lab datasources
- https://grafana.com/blog/grafana-drilldown-apps-the-improved-queryless-experience-formerly-known-as-the-explore-apps/ — Explore apps → Drilldown rename
- https://grafana.com/docs/grafana/latest/visualizations/simplified-exploration/ — Drilldown docs
- https://github.com/grafana/loki/releases — Loki 3.7.4
- https://grafana.com/docs/loki/latest/release-notes/v3-7/ — Loki 3.7 (2026-03-26), Promtail removal, Helm move
- https://grafana.com/docs/loki/latest/release-notes/v3-6/ — Loki 3.6 (2025-11-17), OTel tracing, SSD deprecation
- https://grafana.com/docs/loki/latest/get-started/labels/ — label-based indexing
- https://grafana.com/docs/loki/latest/get-started/labels/structured-metadata/ — structured metadata, `allow_structured_metadata`
- https://grafana.com/docs/loki/latest/query/ — LogQL overview
- https://grafana.com/docs/loki/latest/query/log_queries/ — line filters, parsers, label filters, formatting
- https://grafana.com/docs/loki/latest/query/metric_queries/ — range aggregations, unwrapped ranges, `approx_topk`
- https://grafana.com/docs/loki/latest/send-data/otel/ — Loki `/otlp` endpoint, 17 default index labels, `otlp_config`
- https://grafana.com/docs/loki/latest/operations/bloom-filters/ — bloom filters (Experimental)
- https://grafana.com/blog/grafana-loki-3-3-release-faster-query-results-via-blooms-for-structured-metadata/ — blooms pivot to structured metadata
- https://grafana.com/docs/loki/latest/setup/migrate/ssd-to-distributed/ — SSD removal in Loki 4.0
- https://github.com/grafana/tempo/releases — Tempo 3.0.2
- https://grafana.com/docs/tempo/latest/release-notes/v3-0/ — Tempo 3.0 breaking changes, TraceQL metrics GA
- https://grafana.com/blog/tempo-3-0-release-all-the-latest-features/ — Project Rhythm
- https://grafana.com/docs/tempo/latest/traceql/construct-traceql-queries/ — intrinsics, scopes, operators
- https://grafana.com/docs/tempo/latest/metrics-from-traces/metrics-queries/ — TraceQL metrics functions, exemplars hint
- https://grafana.com/docs/tempo/latest/operations/traceql-metrics/ — `query_frontend.metrics` config
- https://grafana.com/docs/tempo/latest/metrics-from-traces/metrics-generator/ — processors, remote_write
- https://grafana.com/docs/tempo/latest/metrics-from-traces/span-metrics/span-metrics-metrics-generator/ — `traces_spanmetrics_*` names and dimensions
- https://github.com/grafana/pyroscope/releases — Pyroscope 2.2.0
- https://grafana.com/blog/pyroscope-2-0-release/ — Pyroscope 2.0 rearchitecture, OTLP profiles
- https://grafana.com/docs/pyroscope/latest/configure-client/opentelemetry/ebpf-profiler/ — OTel eBPF profiler config, feature gate
- https://github.com/grafana/otel-profiling-go — span profiles bridge
- https://github.com/grafana/alloy/releases — Alloy 1.18.0
- https://grafana.com/oss/alloy-opentelemetry-collector/ — Alloy as an OTel Collector distribution
- https://grafana.com/docs/alloy/latest/release-notes/ — Alloy breaking changes, embedded Prometheus version
- https://grafana.com/blog/opentelemetry-and-grafana-labs-whats-new-and-whats-next-in-2026/ — Grafana + OTel 2026
- https://grafana.com/blog/opentelemetry-ebpf-instrumentation-beyla-donation/ — Beyla → OBI donation
- https://grafana.com/blog/why-opentelemetry-instrumentation-needs-both-ebpf-and-sdks/ — eBPF vs SDK balance

### Three pillars and its critique
- https://peter.bourgon.org/blog/2017/02/21/metrics-tracing-and-logging.html — the origin post (Feb 2017)
- https://charity.wtf/tag/observability-2-0/ — Charity Majors on observability 2.0 / wide events
- https://www.honeycomb.io/blog/observability-5-year-retrospective — retrospective on the framing
- https://www.cockroachlabs.com/big-ideas-podcast/breaking-the-pillars-rethinking-observability-with-charity-majors/ — "Breaking the pillars"
- https://newsletter.pragmaticengineer.com/p/observability-the-present-and-future — accessible summary of the debate

---
---

# ADDENDUM — Second-pass verification, 2026-07-28

*Independent re-research pass. Everything below was fetched live on 2026-07-27/28. Its jobs are: (a) resolve
the `DATE-SOFT` and open-question markers above, (b) add material the first pass did not cover, and
(c) record the places where the two passes disagreed. Section numbers in **bold** refer back to the main
dossier.*

## A1. Dates resolved (clears most `DATE-SOFT` markers in §0)

Fetched through the **GitHub Releases REST API** (`api.github.com/repos/<org>/<repo>/releases`), which returns
absolute ISO-8601 `published_at` timestamps and therefore does not suffer the relative-date ("13 months ago")
rendering problem that produced the `DATE-SOFT` flags.

| Component | Version | `published_at` (UTC) | Status of the old marker |
|---|---|---|---|
| Tempo | **v3.0.2** | **2026-06-09T16:30:31Z** | `DATE-SOFT` **cleared** |
| Tempo | v3.0.0 | 2026-05-28T15:09:13Z | confirms "3.0 was May 2026" |
| Tempo | v2.10.7 | 2026-06-12T16:28:23Z | 2.x still patched — confirmed |
| Tempo | v2.9.4 | 2026-07-24T12:29:33Z | 2.9 line *also* still patched |
| semconv | **v1.43.0** | **2026-07-03T20:14:31Z** | `DATE-SOFT` **cleared** |
| semconv | v1.42.0 | 2026-06-12T21:03:17Z | (the release that moved GenAI out) |
| semconv | v1.41.1 / v1.41.0 | 2026-05-11 / 2026-04-28 | |
| semconv | v1.40.0 / v1.39.0 | 2026-02-19 / 2026-01-12 | ⇒ roughly monthly cadence |
| OTel Collector (core) | **v0.157.0** | **2026-07-21T12:38:34Z** | main dossier says 2026-07-22 (the *releases* repo tag); both are right, different repos |
| OTel Collector (core) | v0.156.0 / v0.155.0 | 2026-07-07 / 2026-06-23 | ⇒ ~2-week cadence |
| Pyroscope | **v2.2.0** | **2026-07-21T19:03:11Z** | confirmed |
| Pyroscope | v2.1.1 / v2.0.6 | both 2026-07-10 | two lines maintained |
| Alloy | **v1.18.0** | **2026-07-20T10:38:16Z** | confirmed |
| Loki | **v3.7.4** | **2026-07-24** | confirmed |
| Loki | v3.6.13 | 2026-07-24 | 3.6 line patched in lockstep |

**Tempo caveat worth keeping:** `api.github.com/repos/grafana/tempo/releases/latest` returns **v3.0.2**, but the
*most recently published* Tempo release is **v2.9.4 (2026-07-24)** — a backport to the 2.9 line. Do not
mistake "newest release published" for "highest version". Three Tempo lines (2.9, 2.10, 3.0) are receiving
patches simultaneously.

## A2. Components missing from the §0 version table

The main table omits several things the lab and the text will reference.

| Component | Version | Date | Note |
|---|---|---|---|
| **Alertmanager** | **0.33.1** | 2026-07-04 | Still 0.x after all these years. Worth a footnote — readers ask. |
| **node_exporter** | **1.12.1** | 2026-07-14 | |
| **pushgateway** | **1.11.3** | 2026-05-27 | |
| **blackbox_exporter** | **0.28.0** | 2025-12-04 | Slow-moving; fine. |
| **client_golang** | **v1.24.1** | 2026-07-24 | v1.24.1 is a bugfix for a `promhttp` panic on requests with a nil URL. Pin ≥ this. |
| **OTel Java auto-instrumentation** | **v2.30.0** | 2026-07-22 | The `opentelemetry-javaagent.jar` used for zero-code Java. |
| **Prometheus (previous LTS)** | 3.5.5 | 2026-07-09 | **3.5 LTS support ends 2026-07-31.** |

> **Time-bomb for this book:** the 3.5 LTS window closes **four days after this dossier was written**. Any
> lab, appendix or "if you're on the LTS line" aside pinned to 3.5.x is wrong on the day it ships. Pin
> **3.13.x** (LTS through 2027-07-31).

## A3. Open questions from §14 that this pass could answer

**§14.10 — Tempo monolithic vs Kafka.** The main dossier notes Tempo 3.0 microservices mode uses Kafka but
leaves monolithic unresolved. Findings:
- `grafana.com/docs/tempo/latest/setup/deployment/` states flatly: **"Tempo 3.0 requires a Kafka-compatible
  message queue as part of its architecture"** — with **no** monolithic carve-out on that page. That sentence,
  read alone, would kill the docker-compose lab.
- Secondary sources and the shipped `example/docker-compose` directory indicate **monolithic mode
  (`target: all`) does not require Kafka**, and that the docker-compose examples default to published Tempo
  3.0.0 images.
- **Verdict: still `UNVERIFIED`, but now with a specific test.** Before writing the lab chapter, run the
  upstream `grafana/tempo` `example/docker-compose/local` stack at the 3.0.x tag and confirm it starts with no
  Kafka container. If it does not, fall back to **Tempo 2.10.7** for the lab and say why. This is a
  **build-blocking** question, not a cosmetic one.

**§14.6 — Pyroscope data source type id.** The current Grafana docs page for the Pyroscope data source gives
this provisioning example verbatim, using **`grafana-pyroscope-datasource`**:
```yaml
apiVersion: 1

datasources:
  - name: Grafana Pyroscope
    type: grafana-pyroscope-datasource
    url: http://localhost:4040
    jsonData:
      minStep: '15s'
```
The `type: phlare` in `intro-to-mltp` (**§8.4**) is therefore the historical form. **Use
`grafana-pyroscope-datasource`.** (Whether `phlare` still resolves as an alias in Grafana 13 remains
untested — but there is no reason to write it.)

**§14.5 — Grafana Correlations status.** Re-fetched `administration/correlations/`. Still no statement of a
feature toggle; the page references Grafana 10.0 as the introduction version and documents three
configuration routes (provisioning, Administration → Plugins and data → Correlations, and the in-Explore
editor) plus permissions. **Remains `UNVERIFIED`.** Test in the lab; do not print "GA".

**§14.3 — per-scrape exemplar limit key.** Not resolvable from the rendered configuration page in this pass
either. Still open.

## A4. Corrections and conflicts between the two passes

**A4.1 — Python OTel logs status. The main dossier (§3.3) is CORRECT; a naive read of `/status/` is not.**
This pass initially recorded Python logs as *Stable* from a summarised fetch of `opentelemetry.io/status/`.
Re-checked against two independent pages:
- `opentelemetry.io/docs/languages/` → **Python: Traces Stable, Metrics Stable, Logs Development**
- `opentelemetry.io/docs/languages/python/` → **Traces "Stable", Metrics "Stable", Logs "Development"**

**Python OTel logs are Development.** Keep §3.3's table. Recording this because it is exactly the kind of
error that gets into a textbook: a summariser flattened a table and promoted a cell.

**A4.2 — Alloy's embedded component versions.** §4.10 says Alloy 1.11 moved its embedded Prometheus from
v2.55.1 to v3.4.2. Still true historically, but stale as a *current* statement. **Alloy v1.18.0 (2026-07-20)
upgrades embedded Prometheus to v3.12.0 (GA) and the embedded OpenTelemetry Collector to v0.153.0**, and adds
an OpAmp Extension and a `k8sleaderelector` Extension to its OTel engine.

Teaching point worth extracting: **Alloy lags upstream.** Alloy 1.18 carries Collector v0.153.0 while upstream
is at v0.157.0, and Prometheus v3.12.0 while upstream is at v3.13.1. If a reader needs a component that landed
in the last few upstream releases, Alloy will not have it yet. That is a legitimate reason to reach for
`otelcol-contrib` instead.

**A4.3 — Grafana's own exemplar docs are internally ambiguous.** §7.7's field table (from the UI docs) and the
provisioning example use overlapping names. The configure page documents an `exemplarTraceIdDestinations` entry
as having **`datasourceUid`**, **`name`**, **`url`**, **`urlDisplayLabel`** *and* **`labelName`** ("Field name
in the labels object containing the traceID") — while the UI table calls the same idea "Label name" and maps it
to `name`. The provisioning example only ever uses `datasourceUid` + `name` (or `name` + `url`).
**Recommendation: write `{ datasourceUid: <tempo-uid>, name: trace_id }` in the book, and verify empirically on
13.1.x that no `labelName` is needed.** Do not print both keys as if you know which wins.

## A5. Material not in the main dossier

### A5.1 The `otlp:` block, verbatim with defaults and the project's own warnings

**§4.2** lists the nine `otlp:` keys but not their descriptions or defaults. The full block from
`prometheus/prometheus:docs/configuration/configuration.md` on `main` — the comments are the valuable part:

```yaml
otlp:
  # Promote specific list of resource attributes to labels.
  # It cannot be configured simultaneously with 'promote_all_resource_attributes: true'.
  [ promote_resource_attributes: [<string>, ...] | default = [ ] ]
  # Promoting all resource attributes to labels, except for the ones configured with 'ignore_resource_attributes'.
  # Be aware that changes in attributes received by the OTLP endpoint may result in time series churn and lead to high memory usage by the Prometheus server.
  # It cannot be set to 'true' simultaneously with 'promote_resource_attributes'.
  [ promote_all_resource_attributes: <boolean> | default = false ]
  # Which resource attributes to ignore, can only be set when 'promote_all_resource_attributes' is true.
  [ ignore_resource_attributes: [<string>, ...] | default = [] ]
  # Configures translation of OTLP metrics when received through the OTLP metrics
  # endpoint. Available values:
  # - "UnderscoreEscapingWithSuffixes" refers to commonly agreed normalization used
  #   by OpenTelemetry in https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/pkg/translator/prometheus
  # - "NoUTF8EscapingWithSuffixes" is a mode that relies on UTF-8 support in Prometheus.
  #   It preserves all special characters like dots, but still adds required metric name suffixes
  #   for units and _total, as UnderscoreEscapingWithSuffixes does.
  # - "UnderscoreEscapingWithoutSuffixes" translates metric name characters that
  #   are not alphanumerics/underscores/colons to underscores, and label name
  #   characters that are not alphanumerics/underscores to underscores, but
  #   unlike UnderscoreEscapingWithSuffixes it does not append any suffixes to
  #   the names.
  # - (EXPERIMENTAL) "NoTranslation" is a mode that relies on UTF-8 support in Prometheus.
  #   It preserves all special character like dots and won't append special suffixes for metric
  #   unit and type.
  #
  #   WARNING: The "NoTranslation" setting has significant known risks and limitations (see https://prometheus.io/docs/practices/naming/
  #   for details):
  #       * Impaired UX when using PromQL in plain YAML (e.g. alerts, rules, dashboard, autoscaling configuration).
  #       * Series collisions which in the best case may result in OOO errors, in the worst case a silently malformed
  #         time series. For instance, you may end up in situation of ingesting `foo.bar` series with unit
  #         `seconds` and a separate series `foo.bar` with unit `milliseconds`.
  [ translation_strategy: <string> | default = "UnderscoreEscapingWithSuffixes" ]
  # Enables adding "service.name", "service.namespace" and "service.instance.id"
  # resource attributes to the "target_info" metric, on top of converting
  # them into the "instance" and "job" labels.
  [ keep_identifying_resource_attributes: <boolean> | default = false ]
  # Configures optional translation of OTLP explicit bucket histograms into native histograms with custom buckets.
  [ convert_histograms_to_nhcb: <boolean> | default = false ]
  # Enables promotion of OTel scope metadata (i.e. name, version, schema URL, and attributes) to metric labels.
  # This is disabled by default for backwards compatibility, but according to OTel spec, scope metadata _should_ be identifying, i.e. translated to metric labels.
  [ promote_scope_metadata: <boolean> | default = false ]
  # Controls whether to enable prepending of 'key_' to labels starting with '_'.
  # Reserved labels starting with '__' are not modified.
  # This is only relevant when translation_strategy uses underscore escaping
  # (e.g., "UnderscoreEscapingWithSuffixes" or "UnderscoreEscapingWithoutSuffixes").
  [ label_name_underscore_sanitization: <boolean> | default = true ]
  # Enables preserving of multiple consecutive underscores in label names when
  # translation_strategy uses underscore escaping. When true (default), multiple
  # consecutive underscores are preserved during label name sanitization.
  [ label_name_preserve_multiple_underscores: <boolean> | default = true ]
```

**This changes the advice in §4.3.** The main dossier's translation-strategy table is accurate but neutral;
Prometheus itself flags `NoTranslation` as **EXPERIMENTAL** and enumerates two concrete hazards — bad PromQL
ergonomics in YAML, and **silent series collisions when two metrics share a dotted name but differ in unit**.
The book should not present `NoTranslation` as "the modern UTF-8-native choice". Present the default,
`UnderscoreEscapingWithSuffixes`, as correct, and cite the project's own warning if the reader is tempted.

Also note `promote_scope_metadata` is `false` **for backwards compatibility only** — the comment says the OTel
spec holds that scope metadata *should* be identifying. Another good "the defaults are historical, not ideal"
teaching moment.

### A5.2 The complete Prometheus feature-flag inventory (3.13.x)

Twenty-three flags. The main dossier names five or six; the whole list is useful because it shows the reader
what "experimental" actually looks like in a mature project, and several are directly relevant.

| Flag | What it does |
|---|---|
| `exemplar-storage` | **Stores scraped exemplars.** Still a flag. Central to **§7**. |
| `native-histograms` | *(no longer listed as functional)* — see `scrape_native_histograms` config instead |
| `memory-snapshot-on-shutdown` | Snapshot in-memory chunks/series at shutdown; faster startup, no full WAL replay |
| `extra-scrape-metrics` | **Deprecated.** `scrape_timeout_seconds`, `scrape_sample_limit`, `scrape_body_size_bytes`. Use the config option. |
| `promql-per-step-stats` | Per-step stats (`totalQueryableSamples`, `samplesRead`, `peakSamples`) with `stats=all` |
| `promql-experimental-functions` | Experimental PromQL functions (syntax/semantics may change or vanish) |
| `created-timestamp-zero-ingestion` | Ingest start timestamps as zero-valued samples (PrometheusProto, OpenMetrics) |
| `st-storage` | Store start timestamps per sample through WAL and TSDB. **Requires XOR2 chunk encoding.** |
| `use-start-timestamps` | Use start timestamps in `rate()`, `irate()`, `increase()` |
| `st-synthesis` | Synthesize start timestamps for cumulative metrics, tracking resets |
| `concurrent-rule-eval` | Evaluate independent rules in a group concurrently (default 4) |
| `old-ui` | Fall back to the Prometheus 2.x web UI |
| `metadata-wal-records` | Metadata as WAL records per series — needed for Remote Write 2.0 |
| `delayed-compaction` | Random offset (≤10% of chunk range) on Head compaction start, to desynchronise |
| `promql-delayed-name-removal` | Delay `__name__` removal to the final eval step, so `label_replace`/`label_join` can preserve it |
| `otlp-deltatocumulative` | Convert OTLP delta → cumulative (mutually exclusive with the next one) |
| `promql-duration-expr` | Arithmetic expressions inside durations, for range and offset |
| `otlp-native-delta-ingestion` | Ingest OTLP deltas natively (mutually exclusive with the previous one) |
| `type-and-unit-labels` | Inject reserved `__type__` and `__unit__` labels from metadata |
| `use-uncached-io` | Direct I/O for chunk writing, bypassing page cache (Linux only) |
| `xor2-encoding` | XOR2 chunk encoding — better compression + start timestamps. **"highly experimental"; incompatible with older versions.** |
| `promql-extended-range-selectors` | `anchored` and `smoothed` modifiers on range/instant selectors |
| `promql-binop-fill-modifiers` | `fill()`, `fill_left()`, `fill_right()` on binary operators for missing matches |
| `search-api` | Experimental search API for metric/label discovery with fuzzy matching |

Three observations for the book:

1. **The start-timestamp cluster** (`st-storage`, `use-start-timestamps`, `st-synthesis`,
   `created-timestamp-zero-ingestion`, plus `xor2-encoding`) is the current big project. It is what will
   eventually fix the "first sample of a counter after a restart is invisible to `rate()`" problem.
   Worth one honest paragraph: *this is a real correctness gap in Prometheus today, and it is being fixed.*
2. **`type-and-unit-labels`** (`__type__` / `__unit__`) directly relates to the OTLP translation story in
   **§4.3** — it is Prometheus growing native metadata rather than encoding type and unit into name suffixes.
3. `promql-extended-range-selectors` and `promql-binop-fill-modifiers` are new PromQL surface area. Both are
   experimental. **Do not teach `anchored`, `smoothed`, or `fill()` in a beginner textbook** — but be aware
   they exist so the book does not accidentally claim PromQL "has no way to" do something it now can.

### A5.3 Additional `scrape_config` keys for histograms

**§4.6** covers `scrape_native_histograms` and `convert_classic_histograms_to_nhcb`. One more:

- **`always_scrape_classic_histograms`** — *"Additionally scrape the classic parts of a histogram, even if it
  is also exposed with native parts."* This is the migration switch: run both representations side by side
  while you port dashboards and alert rules. Very relevant if the book ever discusses migrating from classic
  to native histograms.

### A5.4 `prometheusremotewriteexporter` — the drop rule nobody warns you about

**§4.9** covers `prometheusreceiver` and `prometheusexporter` but not the remote-write exporter in detail.

- **Stability: Beta (metrics).** Distributions: Core **and** Contrib.
- **The rule that bites:** *"Non-cumulative monotonic, histogram, and summary OTLP metrics are dropped by this
  exporter."* Silently. If a reader points a .NET app (which may default to delta) at this exporter, their
  histograms simply do not arrive and nothing logs an error at the obvious place.
- `add_metric_suffixes` is **deprecated** — use `translation_strategy`, matching the Prometheus server's
  vocabulary.
- `target_info` is generated by default per resource metric and can be disabled; `disable_scope_info`
  suppresses the `otel_scope_*` labels.
- `protobuf_message` selects the wire format; Remote Write 2.0 support "always includes metadata" and carries
  created timestamps and native histograms, but is **"In Development" and only partially implemented** —
  consistent with **§4.8**.
- Other keys: `endpoint` (required), `external_labels`, `headers`, `namespace`, `send_metadata`,
  `include_metadata_keys`, `remote_write_queue` (`enabled`, `queue_size`, `num_consumers`),
  `resource_to_telemetry_conversion`, `wal` (`directory`, `buffer_size`, `truncate_frequency`,
  `lag_record_frequency`), `max_batch_size_bytes`, `max_batch_request_parallelism`, TLS (`insecure`,
  `cert_file`, `key_file`).

Documented example:
```yaml
exporters:
  prometheus_remote_write:
    endpoint: "https://my-cortex:7900/api/v1/push"
    wal:
      directory: ./prom_rw
      buffer_size: 100
      truncate_frequency: 45s
    resource_to_telemetry_conversion:
      enabled: true
```

### A5.5 `prometheusreceiver` — the `$$` escaping trap

Add to **§4.9**: dollar signs in the embedded Prometheus config are interpreted as **environment variable
references** by the Collector and must be escaped as `$$`. This bites immediately, because Prometheus
relabeling configs are full of `$1`, `$2` capture-group references:

```yaml
# WRONG inside a Collector prometheusreceiver config — $1 gets eaten
relabel_configs:
  - source_labels: [__meta_kubernetes_pod_name]
    regex: '(.*)-[a-z0-9]+'
    target_label: workload
    replacement: '$1'

# RIGHT
    replacement: '$$1'
```

This is the *same* class of trap as Grafana provisioning `$${__value.raw}` in **§8.1** — worth teaching once,
as "any YAML that a Go program env-interpolates needs `$$`", and then pointing at both instances.

### A5.6 Loki's label budget — the actual numbers

**§5.1** correctly explains Loki's cardinality physics but does not give the numbers the docs give:

- **"aim to have 10 - 15 labels at a maximum"** — and **Loki defaults to a 15-label limit**, so this is
  enforced, not just advised.
- Labels should describe the **source** (namespace, cluster, region, hostname, service), not the **content**.
  The docs single out log **level** as a label to avoid — which is counter-intuitive, because level is the
  first thing every developer reaches for. Call this out explicitly; it is a great concrete example.
- Verbatim: high cardinality "will significantly reduce the performance and cost-effectiveness" of Loki.

### A5.7 Ben Sigelman's critique — a second, distinct argument for §1.2

**§1.2** presents the Charity Majors / wide-events critique well. There is a second, older and differently
shaped critique that the book should present alongside it, because it lands on a *different* conclusion:

**"Three Pillars with Zero Answers"** (Ben Sigelman, Lightstep, 2018; also a KubeCon NA 2018 talk).
- Core claim: metrics, logs and traces are **just data**. Buying all three and lighting up three dashboards
  does not answer "why is it slow right now?" The memorable form: if what you need is a car, the three pillars
  are only the fuel.
- The specific charge against metrics: once you *detect* an anomaly, all metrics let you do is **drill down** —
  group by a tag, hope one tag value explains it, filter, repeat. A guessing game bounded by how many tags you
  had the foresight to add, and adding tags multiplies cardinality.
- The proposed reframe: stop organising around data types and organise around two activities —
  **(1) detection** (a small number of high-quality SLIs) and **(2) refinement** (systematically narrowing the
  search space).

**Why include both critiques.** They agree the pillars are a bad *workflow* model but disagree on the fix:
Sigelman says "reorganise around detection + refinement"; Majors says "collapse to one wide-event dataset."
Presenting both, and noting they disagree, is more honest than presenting either as *the* critique — and the
detection/refinement framing maps beautifully onto a Prometheus+Grafana book: **detection is what Prometheus
alerting is for; refinement is what exemplars, traces and correlation are for.** That is arguably the thesis
sentence for the whole chapter.

### A5.8 Grafana 13.0 — what changed that affects a printed book

Absent from the main dossier and directly consequential for screenshots and shipped dashboard JSON.

- **Dynamic Dashboards are GA and on by default.** Existing dashboards **automatically migrate** to the new
  layout engine and schema when opened — *"No manual steps required."* **Implication: any dashboard JSON the
  book ships will be silently rewritten the first time a reader opens it, and the JSON in the book will not
  match what they can export back out.** Decide now how to handle this: either ship dashboards as provisioned
  files and never ask the reader to compare JSON, or add an explicit note.
- **Grafana Image Renderer plugin support was REMOVED.** No PNG rendering, no image-in-alert-notification
  workflows via that plugin. If the alerting chapter planned to show images in Slack/email notifications,
  re-plan it.
- Legacy `/api` path **deprecated** in favour of `/apis`; deprecated numeric data source ID APIs **disabled by
  default**. Affects any scripted provisioning the book teaches.
- React 18 → 19 (breaks some third-party panels). Database metrics deprecated; eight Prometheus metrics
  replaced.
- Also GA/new: Gauge visualisation revamped and GA; legend limits for high-series-count panels; panel style
  copy/paste; "Recently deleted" dashboard restore; section-level variables; Git Sync GA; revamped query editor
  (private preview); Grafana Assistant available on-prem for OSS.

### A5.9 OBI — the operational details (extends §10.1)

- **Container images: `otel/ebpf-instrument` and `otel/ebpf-instrument-k8s-cache`.** (§10.1 gives requirements
  but not image names — needed for any docker-compose snippet.)
- **Environment variables use the `OTEL_EBPF_*` prefix**, e.g. `OTEL_EBPF_OPEN_PORT`.
- Protocol list from the current OTel docs page is broader than §10.1's: HTTP/S, gRPC, gRPC-Web, **JSON-RPC,
  MQTT, NATS, AMQP 1.0, Memcached, SunRPC/NFS**, and databases PostgreSQL, MySQL, MSSQL, MongoDB, Redis,
  **Couchbase**. Plus GenAI APIs from **OpenAI, Anthropic, Google and AWS**.
- Requirements restated from the page: **Linux kernel 5.8+** (RHEL 4.18+ with eBPF backports), **BTF** support,
  **amd64 or arm64**.
- Version on the docs page: **v0.10.0**, consistent with §10.1.

### A5.10 `grafana/otel-lgtm` — the all-in-one image (entirely new)

Not mentioned anywhere in the main dossier, and it is the single fastest way to show a reader the whole
landscape working. Repo: `grafana/docker-otel-lgtm`.

- **Bundles** in one container: OpenTelemetry Collector, **P**rometheus, **L**oki, **T**empo, **G**rafana,
  Pyroscope, and optional OBI. The embedded Collector auto-routes metrics→Prometheus, logs→Loki,
  traces→Tempo, profiles→Pyroscope.
- Works with **OTel SDK defaults out of the box** — OTLP on **4317** (gRPC) and **4318** (HTTP). Also exposes
  **3000** (Grafana, `admin`/`admin`), **9090** (Prometheus), **3200** (Tempo), **4040** (Pyroscope). All four
  data sources are pre-provisioned.
- Run via the repo's `./run-lgtm.sh` (Linux/macOS) or `./run-lgtm` (Windows PowerShell); custom runs follow
  `docker run -e [ENV_VARS] grafana/otel-lgtm`.
- Per-component log toggles: `ENABLE_LOGS_GRAFANA`, `ENABLE_LOGS_LOKI`, `ENABLE_LOGS_PROMETHEUS`,
  `ENABLE_LOGS_TEMPO`, `ENABLE_LOGS_PYROSCOPE`, `ENABLE_LOGS_OTELCOL`, `ENABLE_LOGS_OBI`, `ENABLE_LOGS_ALL`.
- eBPF: `ENABLE_OBI=true`, target selection via `OBI_TARGET` (language/executable) or `OTEL_EBPF_OPEN_PORT`
  (ports). Requires kernel 5.8+ with BTF and Docker flags **`--pid=host --privileged`**.
- Grafana Labs' own scoping, verbatim in spirit: intended for **"development, demo, and testing
  environments"**, with Grafana Cloud Application Observability recommended for production.

**Recommendation for the book:** use it as a **sidebar or appendix** — "the whole LGTM stack in one command,
if you just want to see it" — and explicitly *not* as the growing lab. The book's pedagogy is that the reader
assembles the stack service by service and understands each piece; an opaque all-in-one defeats that. But it
is an excellent five-minute payoff and a great fallback for readers whose hand-built compose file has broken.

### A5.11 Grafana Prometheus data source — fuller provisioning example

Extends **§7.7**. Verbatim from the current configure page:

```yaml
jsonData:
  httpMethod: POST
  manageAlerts: true
  prometheusType: Prometheus
  prometheusVersion: 3.3.0
  cacheLevel: 'High'
  incrementalQuerying: true
  incrementalQueryOverlapWindow: 10m
  exemplarTraceIdDestinations:
    - datasourceUid: my_jaeger_uid
      name: traceID
    - name: traceID
      url: 'http://localhost:3000/explore?...'
```
Key meanings: `httpMethod` — *"POST recommended for larger queries"*; `prometheusType` — one of
`Prometheus | Mimir | Thanos | Cortex`, and it **changes which API endpoints Grafana calls**;
`cacheLevel` — `Low | Medium | High | None`, browser-side caching for the query editor;
`incrementalQuerying` + `incrementalQueryOverlapWindow` — reduce load by reusing cached results between
refreshes.

Note the docs' own sample is a little stale in two ways the book should fix: it pins `prometheusVersion: 3.3.0`
(bump it), and it uses a **Jaeger** UID with the label name `traceID`. The book should use a **Tempo** UID and
the label name **`trace_id`**, matching the OTLP↔Prometheus spec (**§4.5**) and the Go/Python examples in
**§7.3**.

## A6. Additions to the pitfalls / stale-advice lists

Append to **§12**:

16. **Assuming Alloy is at parity with upstream.** Alloy 1.18 embeds Collector v0.153.0 and Prometheus
    v3.12.0 while upstream is at v0.157.0 and v3.13.1. A component that exists upstream may not exist in your
    Alloy yet.
17. **Forgetting `$$` inside `prometheusreceiver`'s embedded scrape config**, so relabel `$1` capture groups
    silently vanish (see A5.5).
18. **Pointing a delta-temporality OTel app at `prometheusremotewriteexporter`** and losing every histogram
    without an obvious error (see A5.4).
19. **Shipping dashboard JSON in print and expecting it to round-trip on Grafana 13** — dashboards are
    auto-migrated to the new schema on open (see A5.8).
20. **Using log `level` as a Loki stream label.** It feels natural and it is exactly the content-based,
    cardinality-multiplying label the docs tell you to avoid (see A5.6).

Append to **§13**:

| Stale claim | Reality on 2026-07-28 |
|---|---|
| "Pin Prometheus 3.5, it's the LTS." | 3.5 LTS **ends 2026-07-31**. The current LTS is **3.13** (through 2027-07-31). |
| "`NoTranslation` is the modern UTF-8-native OTLP setting." | Prometheus marks it **EXPERIMENTAL** and documents silent unit-collision risk. Default to `UnderscoreEscapingWithSuffixes`. |
| "`add_metric_suffixes` in the remote-write exporter." | **Deprecated.** Use `translation_strategy`. |
| "Grafana can render dashboard panels to PNG for alert notifications." | **Image Renderer plugin support was removed in Grafana 13.0.** |
| "The Pyroscope data source type is `phlare`." | Current docs provision `type: grafana-pyroscope-datasource`. |
| "Tempo's newest release is the highest version." | Three lines (2.9, 2.10, 3.0) get patches; the newest *published* tag was 2.9.4 while `latest` was 3.0.2. |

## A7. Sources added by this pass

Fetched 2026-07-27 / 2026-07-28. (Sources already listed in the main §Sources are not repeated.)

**Version verification via the GitHub Releases API**
- https://api.github.com/repos/grafana/tempo/releases/latest and `.../releases?per_page=10`
- https://api.github.com/repos/grafana/pyroscope/releases?per_page=8
- https://api.github.com/repos/grafana/alloy/releases?per_page=5
- https://api.github.com/repos/open-telemetry/semantic-conventions/releases?per_page=6
- https://api.github.com/repos/open-telemetry/opentelemetry-collector/releases?per_page=5
- https://api.github.com/repos/open-telemetry/opentelemetry-java-instrumentation/releases/latest
- https://api.github.com/repos/prometheus/client_golang/releases/latest

**Prometheus**
- https://prometheus.io/download/ — Alertmanager 0.33.1, node_exporter 1.12.1, pushgateway 1.11.3, blackbox_exporter 0.28.0, and the LTS marking
- https://raw.githubusercontent.com/prometheus/prometheus/main/docs/configuration/configuration.md — the verbatim `otlp:` block with defaults and the `NoTranslation` WARNING
- https://raw.githubusercontent.com/prometheus/prometheus/main/docs/feature_flags.md — exemplar-storage wording and sizing note
- https://github.com/prometheus/prometheus/releases/tag/v3.9.0 — *"Native Histograms are no longer experimental! Make the `native-histogram` feature flag a no-op."*

**OpenTelemetry**
- https://opentelemetry.io/docs/languages/ — the authoritative per-language signal matrix (resolves the Python-logs conflict in A4.1)
- https://opentelemetry.io/docs/languages/python/ — Python: Traces Stable, Metrics Stable, Logs Development
- https://raw.githubusercontent.com/open-telemetry/opentelemetry-collector-contrib/main/exporter/prometheusremotewriteexporter/README.md — Beta, the non-cumulative drop rule, `add_metric_suffixes` deprecation
- https://raw.githubusercontent.com/open-telemetry/opentelemetry-collector-contrib/main/receiver/prometheusreceiver/README.md — `$$` escaping, unsupported Prometheus features, exemplar and native-histogram conversion
- https://raw.githubusercontent.com/open-telemetry/opentelemetry-collector-contrib/main/connector/spanmetricsconnector/README.md — full config key list and the alpha stability table

**Grafana / Loki / Tempo / Pyroscope**
- https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v13-0/ — Dynamic Dashboards GA + auto-migration, Image Renderer removal, `/api` deprecation
- https://grafana.com/docs/grafana/latest/datasources/prometheus/configure/ — fuller provisioning example, `cacheLevel`, `incrementalQuerying`, `labelName` ambiguity
- https://grafana.com/docs/grafana/latest/datasources/pyroscope/ — `type: grafana-pyroscope-datasource` provisioning example
- https://grafana.com/docs/tempo/latest/setup/deployment/ — *"Tempo 3.0 requires a Kafka-compatible message queue as part of its architecture"* (the sentence that needs the monolithic carve-out tested)
- https://grafana.com/docs/tempo/latest/configuration/ — minimal monolithic config with OTLP receivers and metrics_generator remote_write
- https://github.com/grafana/tempo/tree/main/example/docker-compose — the compose examples to test against
- https://grafana.com/docs/loki/latest/get-started/labels/ — the "10 - 15 labels at a maximum" figure and the 15-label default limit

**All-in-one / eBPF**
- https://github.com/grafana/docker-otel-lgtm and https://raw.githubusercontent.com/grafana/docker-otel-lgtm/main/README.md — ports, `ENABLE_LOGS_*`, `ENABLE_OBI`, `OBI_TARGET`, intended-use caveat
- https://grafana.com/blog/an-opentelemetry-backend-in-a-docker-image-introducing-grafana-otel-lgtm/
- https://opentelemetry.io/docs/zero-code/obi/ — container image names, `OTEL_EBPF_*`, full protocol list, kernel requirements

**Three pillars critique**
- https://medium.com/lightstephq/three-pillars-with-zero-answers-2a98b36358b8 — Ben Sigelman, the detection/refinement reframe
- https://kccna18.sched.com/event/GrXI/three-pillars-zero-answers-we-need-to-rethink-observability-ben-sigelman-lightstep — the KubeCon NA 2018 talk
- https://www.honeycomb.io/blog/time-to-version-observability-signs-point-to-yes — "Observability 2.0" naming
- https://boristane.com/blog/observability-wide-events-101/ — wide events, accessible explainer
- https://www.parseable.com/blog/decision-framework-wide-events-or-traces — the cost counter-argument to wide events
