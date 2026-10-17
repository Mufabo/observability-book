# Appendix F — Reading Older Material Without Being Misled

You will search the web. Everyone does, usually at two in the morning with a
panel that will not draw. What comes back is a decade of Prometheus writing,
most of it written with care, and a large fraction of it now wrong in ways
that produce no error message at all.

Prometheus 3.0 shipped on 2024-11-14 and changed the meaning of queries that
had been correct for years. Grafana, Alertmanager and the exporters moved
too. None of it was recalled. The post that answers your question was
probably right when it was published, and the only way to tell is to know
what changed and when.

This appendix is the decoder, and it comes late on purpose, because it is
useful only once you know enough to recognize what you are reading.

## Three ways old material fails

Sort the failure modes by how loud they are, because loudness decides how
much of your evening the mistake costs.

| Class | What you see | Example |
|---|---|---|
| Loud | A parse error, at once | `holt_winters(...)` |
| Empty | It runs and returns no rows | `{le="1"}` |
| Silent | It runs and returns a wrong number | Regex `.` and a newline |

Loud breakage is a gift. The empty class is survivable once you have the
habit of running the bare selector and reading the labels that come back —
and of asking whether the metric name exists at all, which is what separates
a changed label value from a metric the project removed. The silent class is
the one to fear: the query runs, the graph draws, and the number is not what
the author meant.

## If the page says this, it now means that

These are the changes that break pre-3.0 material against the lab's
`quay.io/prometheus/prometheus:v3.13.1`. Each row is expanded below.

| Written before 3.0 | On Prometheus 3 | Current form |
|---|---|---|
| `holt_winters(x[1h],.3,.3)` | Parse error | Renamed, and gated |
| `{le="1"}` | Empty result | `{le="1.0"}` |
| `{quantile="1"}` | Empty result | `{quantile="1.0"}` |
| `foo[1m:1m]` into `rate()` | No data | `foo[2m:1m]` |
| `route=~"/l.*"` | Also spans newlines | `route=~"/l[^\n]*"` |
| `--enable-feature=agent` | Warning, no effect | `--agent` |
| `https://host` target | No `:443` appended | Write the port |
| Bare text `/metrics` | Whole scrape fails | Set a `Content-Type` |
| Metric names are ASCII | UTF-8 by default | Quote odd names |

### Regex `.` now matches a newline

In Prometheus 3, `.` in a PromQL regex matches newline characters, in query
matchers and in relabel configs alike. `.*`, `foo.?bar` and `foo.+bar` all
match strings containing `\n` now. Write `[^\n]` where you need the old
behavior. Nothing warns you: an old dashboard keeps drawing, with more
series in the result than its author intended.

### `le` and `quantile` are stored in float form

Prometheus 3 normalizes the `le` label of classic histogram buckets and the
`quantile` label of summaries to a canonical float form on ingestion,
whatever the target served. A value carrying neither a decimal point nor an
exponent gains `.0`, so the wire's `le="10"` is stored as `le="10.0"`. Values
that already have a point, such as `0.3`, survive untouched. Chapter 10,
"Latency: Histograms Without Tears", shows the whole list.

!!! trap "The selector that matches nothing"
    Every histogram tutorial written before 2025 selects a bucket this way:

    ```promql
    snip_http_request_duration_seconds_bucket{job="snip-api", le="1"}
    ```

    ```text
    Empty query result
    ```

    No error, no warning, no rows — and the series is being exported right
    now. Never copy an `le` value out of a blog post or out of `curl`. List
    the ones that exist with `count by (le) (...)` and paste those.

### Range selectors are left-open

A range is now the interval `(t-5m, t]`: a sample landing exactly on the left
boundary is excluded, one on the right boundary is included. In Prometheus 2
both boundaries were inclusive. The usual casualty is a subquery — `foo[1m:1m]`
can now return one point where it used to return two, which is not enough for
`rate()`, so the panel reads No Data. Widen the window to `foo[2m:1m]`. This
is also why Chapter 6, "`rate()`, `increase()`, and Why Nothing Is a Whole
Number", insists on at least four scrape intervals of range.

### The feature flags that were removed

Nine flags became default behavior in 3.0: `promql-at-modifier`,
`promql-negative-offset`, `new-service-discovery-manager`,
`expand-external-labels`, `no-default-scrape-port`, `agent`,
`remote-write-receiver`, `auto-gomaxprocs` and `auto-gomemlimit`. Agent mode
is now the `--agent` flag and the remote-write receiver is
`--web.enable-remote-write-receiver`. Two of these have consequences beyond
the flag itself: targets no longer get `:80` or `:443` appended by scheme, so
a config that relied on that silently scrapes the wrong port, and external
label values always expand environment variables.

### `Content-Type` is checked, and the scrape fails

Prometheus 2 fell back to the text format when a target sent no
`Content-Type`, or an unparsable one. Prometheus 3 fails the scrape instead
and ingests nothing — not part of the response, none of it. Snip sends this
on every scrape:

```text
Content-Type: text/plain; version=0.0.4; charset=utf-8;
  escaping=underscores
```

Any client library sets that header for you. A hand-rolled handler that
returns a string usually does not, which is the fault Chapter 5, "Your First
Counter: Instrumenting Code You Own", summons with `SNIP_NO_CONTENT_TYPE=1`.
For a target you cannot fix, the per-job escape hatch is
`fallback_scrape_protocol: PrometheusText0.0.4`.

### UTF-8 names are the default

Older books state flatly that a metric name matches
`[a-zA-Z_:][a-zA-Z0-9_:]*`. Since 3.0 the server accepts UTF-8 in metric and
label names, and `metric_name_validation_scheme` defaults to `utf8` globally
with a per-job override; `legacy` restores the old rules. A name outside the
legacy character set has to be quoted inside the braces —
`{"my.metric.name", job="x"}` — which is what makes untranslated
OpenTelemetry names usable, as Chapter 28, "OpenTelemetry and Prometheus",
shows. The change is purely additive, so existing queries keep working.

### `holt_winters` became `double_exponential_smoothing`

The rename fixed a long-standing misnomer: the function implements double
exponential smoothing, which has no seasonal term, while Holt-Winters is the
triple-exponential method that does. Two things changed, not one — the new
name is also gated behind `--enable-feature=promql-experimental-functions`.
The lab does not set that flag, so both names fail there, which is a useful
thing to have seen once.

## What changed outside PromQL

Queries are not the only thing that rots. These are the lines in an old
`prometheus.yml`, an old `docker compose` service block or an old runbook
that no longer do what their author meant.

| Old form | Now |
|---|---|
| `--storage.tsdb.retention.time=45d` | Deprecated; use the config field |
| `scrape_classic_histograms` | `always_scrape_classic_histograms` |
| `enable_http2` on by default | Defaults to false on `remote_write` |
| `api_version: v1` for Alertmanager | Rejected; v2, and 0.16.0 or newer |
| `--enable-feature=auto-reload-config` | `--config.auto-reload`, stable in 3.12 |
| Logs with `ts=` and `caller=` | `time=`, `source=`, uppercase level |
| Top-level `version:` in Compose | Obsolete, and warns |

The retention move is the one that catches people who already run Prometheus
at work: the flags still start the server, and the help text tells you they
are deprecated in favor of the `storage.tsdb.retention` fields in the
configuration file, which have the further advantage of being reloadable
without a restart. Chapter 25, "Storage, Retention, Backups and Locking the
Door", makes the move.

One more, for anyone reading an upgrade guide written in 2024: a Prometheus 3
TSDB can be read only by 2.55 or newer. If you ever need to roll back, 2.55
is the floor, and any post recommending a rollback to an earlier 2.x was
written before that constraint existed.

## What "experimental" has meant, and when

The word has carried three different meanings, and a page that uses it tells
you nothing until you work out which one it meant.

| Sense | How you can tell | Example today |
|---|---|---|
| Gated | Needs `--enable-feature=` | `double_exponential_smoothing` |
| Unstable but on | Listed in `docs/stability.md` | Prometheus self-metrics |
| Formerly gated | The flag is a no-op now | Native histograms |

The second sense is the one readers miss. Remote read, every service
discovery except `static_configs`, `file_sd_configs` and `http_sd_config`,
the log format, the HTML the web UI generates, and the metrics Prometheus
exposes about itself all ship enabled and carry no compatibility promise. An
alert built on a `prometheus_*` self-metric can break across a minor release,
and several did: 3.7 deprecated four remote-storage counters and 3.10 added
an `alertmanager` dimension to three notification metrics.

The third sense has its own trap. Passing a removed flag is not an error —
Prometheus logs a warning and starts anyway, and an unrecognized value for
`--enable-feature` is also only a warning. So "I enabled the flag and it
works" is never evidence that the flag does anything.

!!! note "Native histograms, exactly"
    Native histograms are stable since Prometheus 3.8.0; the
    `native-histograms` feature flag has been a complete no-op since 3.9;
    and there are still **three independent opt-ins** — the client
    library's `NativeHistogramBucketFactor`, the server's
    `scrape_native_histograms: true`, and remote write's
    `send_native_histograms: true`. The latter two default to true only
    from v4. The classic text exposition format cannot carry them at all.

Read that against what you will find online. A post from 2023 calling native
histograms experimental meant the first sense, and was correct at the time.
The same sentence today is wrong in both of the senses that would matter —
they are neither gated nor unstable — and the flag it tells you to pass does
nothing at all.

## The citation rule that caught this book's worst error

While this book was being researched, a draft of the Alertmanager material
carried a route-level `labels:` key and the `routeLabels` template function
that reads it. Both came from `docs/configuration.md`, which is the official
configuration reference. A second pass went looking for them in the source
and found this:

- `config/config.go` at tag `v0.33.1` — `type Route struct` has no `Labels`
  field.
- The same file on `main` — has `Labels model.LabelSet` with
  `yaml:"labels,omitempty"`.
- The version-pinned documentation at `/docs/alerting/0.33/configuration/`
  does not list `labels:` in the route block. The `/docs/alerting/latest/`
  page does, because for Alertmanager `latest` follows `main`.

The lab pins `quay.io/prometheus/alertmanager:v0.33.1`. Chapter 17,
"Alertmanager: Routing, Grouping and Silence", would have shipped a route
tree that does not load.

!!! pitfall "The URL that documents software you do not have"
    A `/latest/` documentation URL is not a version. Depending on the
    project it may track the newest release or the `main` branch, and
    `raw.githubusercontent.com/.../main/docs/` always tracks unreleased
    work. You fall in by copying a config key that reads as current,
    and you find out when the process refuses to start on a parse error
    at a line you copied from the official docs.

The rule, which is the one piece of this appendix that will still be true
when every version number in it is stale: **cite and copy from
version-pinned URLs or git tags only.** If a key appears in one place and not
the other, it is not a key you have; it is a key somebody is building.

Documentation fails in the other direction too. The same Alertmanager page
has said for years that UTF-8 strict mode becomes the default within two
releases. That sentence was written for 0.27.0 in February 2024. Every
changelog entry from 0.28.0 through 0.33.1 was read while checking it, and
none of them flips the default; fallback mode is still the default and strict
mode is still opt-in. Stale-in-place is harder to catch than ahead-of-release,
because nothing contradicts it.

## Dating a page from its PromQL

You can usually date an undated post from the queries in it, to within a few
weeks, without leaving the page. The newest feature it uses sets the earliest
it can have been written.

| If the query uses | Shipped in | Not written before |
|---|---|---|
| Duration arithmetic, `[5m * 2]` | 3.4.0 | 2025-05-17 |
| `histogram_stddev`, `histogram_stdvar` | 3.5.0 | 2025-07-14 |
| `anchored` / `smoothed` selectors | 3.7.0 | 2025-10-15 |
| `sort_by_label` | 3.8.0 | 2025-11-28 |
| `info()` | 3.9.0 | 2026-01-06 |
| `fill()`, `fill_left()`, `fill_right()` | 3.10.0 | 2026-02-24 |
| `histogram_quantiles()`, `</`, `>/` | 3.11.0 | 2026-04-02 |
| `min_of`, `max_of` | 3.13.0 | 2026-07-01 |

The oldest mistake it makes sets the last version anyone ran it against.

| If the page still says | Then it was never run on |
|---|---|
| `holt_winters` | 3.0.0 or later |
| `{le="1"}`, `{quantile="1"}` | 3.0.0 or later |
| `--enable-feature=promql-at-modifier` | 3.0.0 or later |
| `--enable-feature=native-histograms` is required | 3.9.0 or later |
| "Go to the Graph tab" | Any 3.x — the page is `/query` |
| Log lines with `ts=` and `caller=` | Any 3.x — now `time=`, `source=` |

Put the two together and you get something better than a date. A post that
calls `info()` and also selects `le="1"` was written after 2026-01-06 and was
never run against the server it claims to describe. That is the strongest
signal you can get for free, and it costs one read-through.

## Names that were retired

Chapter 29, "Beyond Metrics: Exemplars, Traces, Logs, and Where to Go Next",
gives the ten-second staleness test for the wider ecosystem. These are the
ones that waste the most time inside Prometheus and Alertmanager themselves.

| Retired | Current |
|---|---|
| Grafana Agent, Promtail | Alloy — Promtail was removed in Loki 3.7.3 |
| `gcr.io/cadvisor/cadvisor` | `ghcr.io/google/cadvisor` |
| Alertmanager `/api/v1/*` | v2 only, since 0.27.0 |
| `alertmanager_marked_alerts` | `alertmanager_alerts`, since 0.33.0 |
| `match:`, `match_re:` | `matchers:` — deprecated, still parsed |
| Summaries for latency | Histograms, which aggregate |

## Try it against the lab

The repository ships three archived queries in
`lab/fixtures/stale-queries/`. Each file holds the stale form, the current
form, the diagnostic that would have caught it, and the structural habit
that stops it happening again.

- `02-holt-winters.promql` — loud. A function that no longer parses, plus
  the second trap: the new name needs a feature flag the lab does not set,
  so both names fail and it reads as though the rename never happened.
- `01-le-string.promql` — empty, because a label value is not the string it
  used to be. The name is fine; the matcher is not.
- `03-marked-alerts.promql` — empty, because the metric was removed from the
  exporter. A healthy target, `up` at 1, and nothing to select.

Those last two look identical in a panel and are told apart in one query:
ask whether the metric name exists at all, ignoring every matcher.

!!! selfcheck "Self-check"
    With the lab up, run the diagnostic from `01-le-string.promql`:

    ```promql
    count by (le) (
      snip_http_request_duration_seconds_bucket{job="snip-api"}
    )
    ```

    Fourteen rows come back: thirteen finite boundaries and `+Inf`. Among
    them are `1.0`, `5.0` and `10.0` — the three the old tutorials write as
    `1`, `5` and `10`. Now run the first query in the same file. It returns
    `Empty query result`, on a stack where nothing whatsoever is broken.
