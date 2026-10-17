# Concept dependency graph

Extracted verbatim from `00-OUTLINE.md` §F. A chapter may not use a term before the
chapter listed here as its first teaching. Check every term you introduce.

# §F. CONCEPT DEPENDENCY GRAPH

Every term the book uses, and the chapter where it is **first defined**. No chapter may use a term
whose first-definition chapter number is higher than its own, with the sole exception of the four
IOU'd terms marked ⓘ, which chapter 3 uses deliberately, flags in print, and repays on schedule. This
table is the manuscript's compile-time check: the technical-review pass greps every chapter for every
term and fails on any forward reference that is not an IOU.

## F.1 Foundations

| Concept | First taught |
|---|---|
| Monitoring; asking questions of a running system | ch1 |
| Pull model; target; scrape; scrape interval | ch1 |
| `/metrics` endpoint | ch1 |
| Metric name; label; sample; time series | ch1 |
| `up`, and why liveness is free | ch1 |
| `job` and `instance` as attached labels | ch1 |
| Prometheus Query page: Table / Graph / Explain, Metrics Explorer, Tree view | ch1 |
| RED (Rate, Errors, Duration) | ch1 |
| No-Data debugging ladder (rungs 1–4) | ch1 |
| Named volume for the TSDB; the Compose `command:` override trap | ch1 |
| Exposition format: `# HELP`, `# TYPE`, sample lines | ch2 |
| Series identity; `__name__` as a reserved label | ch2 |
| Metric family (`_bucket` / `_sum` / `_count`) | ch2 |
| Target labels versus application labels | ch2 |
| Series selectors; the four matchers `=` `!=` `=~` `!~` | ch2 |
| Fully-anchored regexes; `.` matches newlines in v3 | ch2 |
| Empty-string matchers also select series lacking the label | ch2 |
| The at-least-one-non-empty-matcher rule | ch2 |
| Quoted UTF-8 selector syntax | ch2 |
| Staleness markers; the lookback delta and `lookback_delta` | ch2 |
| Debugging ladder, full twelve rungs | ch2 (Appendix B) |

## F.2 Grafana foundations

| Concept | First taught |
|---|---|
| Grafana as a query client | ch3 |
| Provisioning: data source YAML, dashboard provider YAML, the directory split | ch3 |
| Data source `uid`; `isDefault`; `jsonData.timeInterval` | ch3 |
| Dashboard `uid`; `id: null`; `allowUiUpdates` | ch3 |
| Panel; query; legend; unit; time picker; refresh | ch3 |
| The IOU device | ch3 |
| ⓘ `rate()` — used in ch3, taught in ch6 | ch6 |
| ⓘ `sum by` — used in ch3, taught in ch8 | ch8 |
| ⓘ `histogram_quantile` — used in ch3, taught in ch10 | ch10 |
| ⓘ `$__rate_interval` — used in ch3, taught in ch13 | ch13 |

## F.3 The data model and instrumentation

| Concept | First taught |
|---|---|
| Metric type as a contract | ch4 |
| Counter: monotonic in a process lifetime, resets to zero, only differences carry meaning | ch4 |
| Gauge: no direction guarantee; blindness between scrapes | ch4 |
| The counter/gauge asymmetry | ch4 |
| Summary, and why client-side quantiles cannot be aggregated | ch4 |
| Untyped metrics; the `*_info` value-1 pattern | ch4 |
| `resets()`, `changes()` | ch4 |
| Odometer / speedometer analogy | ch4 |
| Registry; collector; construct-once-at-startup | ch5 |
| A fresh registry starts empty | ch5 |
| Naming law: `_total`, base units, unit-before-type | ch5 |
| The aggregation-honesty test | ch5 |
| Templated route labels | ch5 |
| Labels application code must never emit | ch5 |
| `CONTENT_TYPE_LATEST`; Prometheus 3 strict `Content-Type`; `fallback_scrape_protocol` | ch5 |
| Python multiprocess trap (sidebar) | ch5 (Appendix E) |
| Cardinality as multiplication; the series budget worksheet | ch7 |
| The label-admission test; under-10 / investigate-above-100 | ch7 |
| The histogram multiplier | ch7 |
| Lazy series creation | ch7 |
| Churn versus cardinality | ch7 |
| The always-wrong label list; exemplars named as the right home for a trace ID | ch7 |

## F.4 PromQL

| Concept | First taught |
|---|---|
| The four expression types | ch6 |
| Range-vector selector; left-open, right-closed | ch6 |
| `count_over_time` (as the sample-count verifier) | ch6 |
| `rate()`; the extrapolation algorithm; the 1.1× threshold; the half-interval clamp | ch6 |
| `increase()`; why it returns fractions | ch6 |
| Counter resets and what is lost across one | ch6 |
| The two-sample minimum and the 4× rule | ch6 |
| `delta()`, `deriv()` as gauge-only; `irate()` (discouraged) | ch6 |
| Aggregation operators; `by` versus `without` | ch8 |
| The rate-then-aggregate law | ch8 |
| `topk` per-evaluation gotcha; `count_values`; `group()` | ch8 |
| Binary operators; one-to-one matching; metric-name dropping | ch9 |
| Comparison operators and the `bool` modifier | ch9 |
| `and`, `or`, `unless` | ch9 |
| The correct error-ratio pattern; `avg(a/b)` versus `sum(a)/sum(b)` | ch9 |
| The empty-result problem; `or 0 *`; `or vector(0)` | ch9 |
| `absent()`, `absent_over_time()` | ch9 |
| `label_replace`, `label_join` | ch9 |
| `fill()` / `fill_left()` / `fill_right()` (named, flagged, unused) | ch9 |
| Classic histogram anatomy; `le` normalisation to float form | ch10 |
| `histogram_fraction`; the bucket-ratio SLI form | ch10 |
| `histogram_quantile` and its two interpolation rules | ch10 |
| `le` must survive the grouping clause | ch10 |
| Bucket design from the objective; cross-language default buckets | ch10 |
| `histogram_count`, `histogram_sum`, `histogram_avg` | ch10 |
| Native histograms and their three opt-ins | ch10 |
| Vector matching; `on()`, `ignoring()`, `group_left`, `group_right` | ch11 |
| `*_info` joins; `info()` (flagged) | ch11 |
| The `_over_time` family; `max_over_time` | ch11 |
| Subqueries; the epoch-aligned step grid; the `[1m:1m]` trap | ch11 |
| `offset`; `@`; `@ start()` / `@ end()` | ch11 |
| Operator precedence; `sort` on instant queries only | ch11 |
| The experimental-function decode table | ch11 (Appendix C) |
| `predict_linear` | ch22 |

## F.5 Configuration and operations

| Concept | First taught |
|---|---|
| `global` versus per-job precedence; `external_labels`; `scrape_protocols` | ch12 |
| `metrics_path`, `scheme`, `params`, `honor_labels` | ch12 |
| The six scrape limits and their all-or-nothing semantics | ch12 |
| `static_configs`, `file_sd_configs`, `docker_sd_configs` | ch12 |
| The `__meta_*` / `__address__` / `__param_*` / `__tmp_*` namespace | ch12 |
| Relabeling: `source_labels`, `target_label`, `separator`, `regex`, `replacement` | ch12 |
| Actions `replace`, `keep`, `drop`, `labelmap`; `hashmod` (named, dismissed) | ch12 |
| The three pipeline positions | ch12 |
| `--config.auto-reload`; `POST /-/reload`; `--web.enable-lifecycle` | ch12 |
| `promtool check config --lint` | ch12 (Appendix G) |
| Recording rules; groups; sequential-within, parallel-across | ch15 |
| `level:metric:operations` naming | ch15 |
| Record buckets, never quantiles | ch15 |
| Rule-engine self-metrics | ch15 |
| TSDB head block, 2-hour blocks, WAL, m-mapped head chunks | ch25 |
| RAM tracks active series; disk tracks samples | ch25 |
| The disk formula; measuring your own bytes-per-sample | ch25 |
| Retention in the config file; the deprecated flags; the 80–85% rule | ch25 |
| Snapshots; WAL replay; NFS/EFS unsupported | ch25 |
| Meta-monitoring metrics | ch25 (alerts in ch19) |
| Prometheus has no authentication; the dangerous flags; reverse proxy | ch25 |
| `/api/v1/status/tsdb`; `promtool tsdb analyze` | ch24 |
| `prometheus_tsdb_head_series`; `scrape_samples_post_metric_relabeling` | ch24 |
| HA replica pairs; why an LB is not HA; the three label conventions | ch26 |
| Federation; `honor_labels` on a federation job | ch26 |
| `remote_write`; `queue_config`; auto-sharding; the lag expression | ch26 |
| `retry_on_http_429`; Remote Write 2.0 and its silent-loss trap | ch26 |
| `send_native_histograms` (the third opt-in) | ch26 |
| Agent mode; `remote_read` | ch26 |
| The long-term-storage map | ch26 |

## F.6 Dashboards

| Concept | First taught |
|---|---|
| `$__interval`; Max data points; pixel width | ch13 |
| `$__rate_interval` and its precedence chain | ch13 |
| Instant versus range per panel type | ch13 |
| The five panel types; the dead panel names | ch13 |
| The five transformations; order matters | ch13 |
| Query variables; `${var:format}`; `$__auto`; the `=~` rule | ch13 |
| Thresholds with a `null` base step | ch13 |
| Dynamic Dashboards; Custom versus Auto grid; Rows and Tabs; conditional rendering | ch13 |
| schemaVersion migration on open; `$$` escaping in provisioning YAML | ch13 |
| A graph is a sampled query result | ch14 |
| The vanishing spike and its `max_over_time` fix | ch14 |
| The Stat-panel staleness trap | ch14 |
| `percent` versus `percentunit` | ch14 |
| Stacking; multiple Y-axes; legend hygiene; panel descriptions | ch14 |

## F.7 Alerting and SLOs

| Concept | First taught |
|---|---|
| Alerting rule; alert instance; label inheritance | ch16 |
| `for` as a debounce; `keep_firing_for` | ch16 |
| `ALERTS` and `ALERTS_FOR_STATE` | ch16 |
| Counters versus rates versus ratios as alert expressions | ch16 |
| Symptoms versus causes | ch16 |
| Annotation templating: `$labels`, `$value`, `humanize` | ch16 |
| The silent-alert failure | ch16 |
| `alerting:` block; `api_version: v2` | ch16 |
| Alertmanager's data model; `POST /api/v2/alerts` | ch17 |
| `group_by`; the dispatcher | ch17 |
| `group_wait`, `group_interval`, `repeat_interval` | ch17 |
| Route tree; depth-first; first-match-wins; `continue` | ch17 |
| `matchers:` grammar and quoting | ch17 |
| Receivers; the webhook payload; `notification_reason` | ch17 |
| Go templating; `.CommonLabels`; the whitespace-trim dash | ch17 |
| `inhibit_rules` and the missing-labels-are-equal caution | ch17 |
| `time_intervals`; route-level mute/active; UTC; no midnight wrap | ch17 |
| Silences; `amtool`; expiry rather than deletion | ch17 |
| `--web.external-url`; gossip on 9094 TCP and UDP | ch17 |
| `promtool test rules`; `input_series` expansion; `1x4` = five samples | ch18 |
| Negative-case testing; `--junit`; CI | ch18 |
| Severity taxonomy as routing | ch19 |
| The five-field annotation template; runbook scope | ch19 |
| Watchdog / dead-man's switch | ch19 |
| Noise auditing from `alertmanager_notifications_total` | ch19 |
| SLI = good / **valid** events; the exclusion list | ch20 |
| SLO versus SLA; window choice; the 28-day trap | ch20 |
| Error budget as currency; budget in minutes; the budget-remaining expression | ch20 |
| Error-budget policy | ch20 |
| Latency SLO as a fraction, never a quantile | ch20 |
| The six approaches; burn rate derived from `budget_fraction × period / long_window` | ch21 |
| Four-tier MWMB; short window = long / 12 | ch21 |
| Budget consumed at fire time; detection time | ch21 |
| The `and`-label-matching trap; `max(...) without (sloth_window)` | ch21 |
| The low-traffic problem and its five fixes | ch21 |
| Sloth and Pyrra as generators | ch21 |

## F.8 The world outside your service

| Concept | First taught |
|---|---|
| Exporter as translator; the three categories | ch22 |
| USE (Utilization, Saturation, Errors) | ch22 |
| node_exporter; `avail` versus `free`; the Docker Desktop VM caveat | ch22 |
| cAdvisor; working set versus usage; CFS throttling; root-cgroup filtering | ch22 |
| The `> 0` guard on an unset memory limit | ch22 |
| postgres_exporter and the 0.20.0 renames | ch22 |
| The exporter evaluation checklist | ch22 |
| Textfile collector | ch22 |
| Pushgateway (discouraged sidebar) | ch22 |
| The multi-target pattern; `__address__` → `__param_target` → `instance` | ch23 |
| `probe_success`, `probe_duration_seconds`, `probe_timeout_seconds` | ch23 |
| `preferred_ip_protocol`; `NET_RAW`; the DNS inversion; `?debug=true` | ch23 |
| `probe_ssl_earliest_cert_expiry` | ch23 |
| `kubernetes_sd_config` and its six roles | ch27 |
| Prometheus Operator CRDs; `ServiceMonitor`; `PrometheusRule`; `Probe` | ch27 |
| The `release:` label; the four-selector chain; gunzipping the config Secret | ch27 |
| cAdvisor versus kube-state-metrics versus metrics-server | ch27 |
| OTLP receiver; `/api/v1/otlp/v1/metrics`; the `otlp:` block | ch28 |
| The four translation strategies; `target_info`; `otel_scope_*` | ch28 |
| Cumulative versus delta temporality | ch28 |
| `out_of_order_time_window` | ch28 (named in ch25) |
| Exemplars; both switches; `trace_id`/`span_id`; the circular buffer | ch29 |
| `exemplarTraceIdDestinations` | ch29 |
| Traces, TraceQL, Tempo | ch29 |
| Logs, LogQL, Loki, structured metadata | ch29 |
| Profiles; eBPF; OBI | ch29 |

---
