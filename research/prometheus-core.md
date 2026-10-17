# Prometheus Server — Current State (research dossier)

**Compiled:** 2026-07-28
**Scope:** the Prometheus server binary itself — versions, 3.x history, breaking changes vs 2.x,
TSDB, retention, staleness, feature flags, promtool, the web UI, container images.
**Sibling dossiers:** `promql.md` (query language), `alertmanager-exporters.md`, `grafana-core.md`.

Everything below was verified against primary sources on 2026-07-28 unless explicitly marked
**UNVERIFIED**. Docs text was pulled from the `v3.13.1` git tag (not `main`), so it describes the
release a reader will actually run. Anything quoted from `main` is labelled as such.

---

## 0. TL;DR for the book's lab pin

| Thing | Value |
|---|---|
| Latest stable Prometheus | **3.13.1**, released **2026-07-10** |
| Current LTS line | **3.13** (3.13.0, 2026-07-01), supported to **2027-07-31** |
| Outgoing LTS line | **3.5** (3.5.5, 2026-07-09), support ends **2026-07-31** |
| Recommended lab image | `prom/prometheus:v3.13.1` |
| Default HTTP port | 9090 |
| Default config path in image | `/etc/prometheus/prometheus.yml` |
| Default data path in image | `/prometheus` |
| Default retention | 15d (time), size retention off |
| Default lookback delta | 5m |

`v3.13.1` is the happy pin: it is simultaneously the newest release **and** a patch on the new LTS
line. A reader who follows the book gets something that is supported until mid-2027.

---

## 1. Version and release-cycle facts

### 1.1 Release cadence

From <https://prometheus.io/docs/introduction/release-cycle/>:

> "Every 6 weeks, a new Prometheus minor release cycle begins. After those 6 weeks, minor releases
> generally no longer receive bugfixes."

So a non-LTS minor (3.10, 3.11, 3.12 …) gets bugfixes for roughly six weeks and is then superseded.
LTS releases get bug, security and documentation fixes for a **one-year** window.

Excluded from LTS coverage: unstable features, experimental features, and OpenBSD support.

### 1.2 The LTS table (this resolves conflict C2)

| LTS line | Released | End of support |
|---|---|---|
| Prometheus **3.13** | 2026-07-01 | **2027-07-31** |
| Prometheus **3.5** | 2025-07-14 | **2026-07-31** |
| Prometheus 2.53 | 2024-06-16 | 2025-07-31 (ended) |
| Prometheus 2.45 | 2023-06-23 | 2024-07-31 (ended) |
| Prometheus 2.37 | 2022-07-14 | 2023-07-31 (ended) |

**Why the two dossiers disagreed.** `prometheus.io/download` currently shows *two* boxes: `3.13.1`
badged **Latest** and `3.5.5` badged **LTS**. That is not a contradiction — the download page gives
the LTS badge to the *older, still-supported* LTS patch, because 3.13's LTS-ness is implied by it
also being latest. The release-cycle page is the authoritative list and shows **both 3.5 and 3.13 as
currently supported LTS lines**, with 3.5 expiring on 2026-07-31 (three days after this dossier was
written).

**Ruling for the manuscript:** the book may say "3.13 is the current LTS line, supported through
July 2027." It must **not** say "3.5.5 is the LTS" — that will be false by the time anyone reads the
book. If the author wants to be conservative, `prom/prometheus:v3.13.1` is correct under either
reading, so the lab is safe regardless.

### 1.3 Complete 3.x release list with dates

| Version | Date | Note |
|---|---|---|
| 3.13.1 | 2026-07-10 | latest; single TSDB bugfix |
| 3.13.0 | 2026-07-01 | **LTS** |
| 3.12.0 | 2026-05-28 | |
| 3.11.3 | 2026-04-27 | security |
| 3.11.2 | 2026-04-13 | security |
| 3.11.1 | 2026-04-07 | |
| 3.11.0 | 2026-04-02 | |
| 3.10.0 | 2026-02-24 | |
| 3.9.1 | 2026-01-07 | |
| 3.9.0 | 2026-01-06 | native histograms declared non-experimental |
| 3.8.1 | 2025-12-16 | security |
| 3.8.0 | 2025-11-28 | native histograms "stable but optional" |
| 3.7.3 | 2025-10-29 | |
| 3.7.2 | 2025-10-22 | |
| 3.7.1 | 2025-10-16 | |
| 3.7.0 | 2025-10-15 | |
| 3.6.0 | 2025-09-17 | |
| 3.5.5 | 2026-07-09 | LTS patch |
| 3.5.4 | 2026-06-17 | LTS patch |
| 3.5.3 | 2026-04-27 | LTS patch |
| 3.5.0 | 2025-07-14 | **previous LTS** |
| 3.4.2 | 2025-06-26 | |
| 3.4.1 | 2025-05-31 | |
| 3.4.0 | 2025-05-17 | |
| 3.3.0 | 2025-04-15 | |
| 3.2.1 | 2025-02-25 | |
| 3.2.0 | 2025-02-17 | |
| 3.1.0 | 2025-01-02 | |
| 3.0.1 | 2024-11-28 | |
| 3.0.0 | 2024-11-14 | first 3.x |

### 1.4 What actually shipped in 3.13.1 (verbatim)

```
## 3.13.1 / 2026-07-10

- [BUGFIX] TSDB: Fix the head-chunk cache returning samples from the wrong chunk, or spurious
  not-found errors, to range queries after head-chunk truncation. #19134
```

That is the entire release. It is a one-line fix on top of 3.13.0.

### 1.5 What shipped in 3.13.0 — the headline items

Verbatim from the `v3.13.1` CHANGELOG (trimmed to the entries a textbook would care about):

```
- [SECURITY] UI: Bump `sanitize-html` to fix a cross-site scripting vulnerability (CVE-2026-44990).
- [CHANGE] UI: Third-party npm dependency licenses are now embedded in the Prometheus binary and
  served at `/assets/third-party-licenses.txt`, replacing the `npm_licenses.tar.bz2` archive
  previously shipped in release tarballs and container images.
- [CHANGE] API: Use SHA-256 instead of SHA-1 to generate rule group pagination tokens.
- [CHANGE] HTTP clients: Credentials (Authorization header, basic auth, bearer token, OAuth2,
  configured headers) are no longer forwarded when following a redirect to a different host;
  affects scraping, remote read/write, alerting, and service discovery.
- [CHANGE] PromQL: Rename the `min()` and `max()` duration-expression functions to `min_of()` and
  `max_of()` to avoid confusion with the `min` and `max` aggregate operators.
- [FEATURE] API: Add experimental search endpoints to search metric names, label names, and
  label values.
- [FEATURE] TSDB: Add `storage.tsdb.chunk_encoding.floats` configuration field to select float
  chunk encoding (`xor` or `xor2`) at runtime.
- [FEATURE] Scrape: Add `__always_scrape_classic_histograms__` and `__scrape_native_histograms__`
  internal labels to allow per-target override … via relabeling.
- [FEATURE] Scrape: Add `__convert_classic_histograms_to_nhcb__` internal label …
- [ENHANCEMENT] Release: Container images are now also published to the GitHub Container
  Registry (ghcr.io).
- [PERF] TSDB: Reduce per-sample overhead in chunk population, speeding up affected queries by
  ~12-15% in benchmarks.
```

Note the CHANGELOG entry for `min_of`/`max_of` names the feature flag as
`experimental-duration-expr`. **That is a CHANGELOG typo.** The real flag is `promql-duration-expr`
(confirmed in `cmd/prometheus/main.go` and in `feature_flags.md`). Do not copy the typo.

---

## 2. Prometheus 2.x → 3.x: the breaking changes

Source: `docs/migration.md` at `v3.13.1`, i.e. <https://prometheus.io/docs/prometheus/latest/migration/>.
This is the single most important section for a 2026 textbook, because the entire pre-2025 internet
is written against 2.x.

### 2.1 Feature flags that were removed (behaviour is now default)

These no longer need `--enable-feature`; passing them logs a warning:

- `promql-at-modifier`
- `promql-negative-offset`
- `new-service-discovery-manager`
- `expand-external-labels` — `${var}` / `$var` in external label values are now always expanded from
  the environment; undefined variables become the empty string; escape `$` as `$$`
- `no-default-scrape-port` — **v3 no longer appends `:80`/`:443` to targets based on scheme.**
  A target configured as `https://example.com/metrics` stays exactly that in labels.
- `agent` → use the `--agent` CLI flag
- `remote-write-receiver` → use `--web.enable-remote-write-receiver`
- `auto-gomemlimit` → automatic; disable with `--no-auto-gomemlimit`
- `auto-gomaxprocs` → automatic; disable with `--no-auto-gomaxprocs`

### 2.2 PromQL: regex `.` now matches newline

> "The `.` pattern in regular expressions in PromQL matches newline characters."

`.*` now additionally matches `foo\n` and `Foo\nBar`; `foo.?bar` and `foo.+bar` now match
`foo\nbar`. To get v2 behaviour, replace `.` with `[^\n]`.

This applies to **matchers in queries and in relabel configs**.

### 2.3 PromQL: range selectors and lookback are now **left-open, right-closed**

This is the change that quietly breaks tutorials. Verbatim from `querying/basics.md`:

> "The range is a left-open and right-closed interval, i.e. samples with timestamps coinciding with
> the left boundary of the range are excluded from the selection, while samples coinciding with the
> right boundary of the range are included in the selection."

Consequences, from the migration guide:

- With samples exactly 1 minute apart, a `[5m]` range in v2 usually returned 5 samples but returned
  **6** when the evaluation aligned perfectly with a scrape. In v3 it always returns 5.
- **Subqueries are the common casualty.** `foo[1m:1m]` used to return 2 points on an aligned system
  and now returns **1** — which is not enough for `rate()`/`increase()`, so the result is No Data.
  The fix is to widen the window: `foo[2m:1m]` always returns two points regardless of alignment.
- Rule/alert unit tests are similarly affected: adjust the expected sample count or extend the range.

Teaching note: this is a genuinely good thing to explain early, because it is *why* the book will
tell readers to use `[2m:1m]`-style subqueries and why `rate(x[1m])` on a 1m scrape interval is
fragile. It also justifies the "always give rate() at least 4 scrape intervals" rule of thumb.

### 2.4 PromQL: `holt_winters` renamed

`holt_winters` → **`double_exponential_smoothing`**, and it is now guarded by
`--enable-feature=promql-experimental-functions`. Both changes are needed; renaming alone is not
enough.

### 2.5 Scrape protocol strictness (this WILL bite lab readers)

v2 fell back to the Prometheus text format when a target sent no `Content-Type`, or an unparsable
or unrecognised one. **v3 fails the scrape instead.**

Accepted `Content-Type` headers:

```
application/vnd.google.protobuf;proto=io.prometheus.client.MetricFamily;encoding=delimited
text/plain;version=0.0.4
text/plain;version=1.0.0
application/openmetrics-text;version=0.0.1
application/openmetrics-text;version=1.0.0
```

The escape hatch is a per-scrape-config field:

```yaml
scrape_configs:
  - job_name: legacy-app
    fallback_scrape_protocol: PrometheusText0.0.4
```

Valid `fallback_scrape_protocol` / `scrape_protocols` values (case sensitive):
`PrometheusProto`, `OpenMetricsText0.0.1`, `OpenMetricsText1.0.0`, `PrometheusText0.0.4`,
`PrometheusText1.0.0`.

**Book-relevant:** a hand-rolled `/metrics` endpoint written by a reader (a bare Go `http.Handler`,
a Python Flask route returning a string) is very likely to send `text/plain; charset=utf-8` or
nothing at all, and the scrape will fail with a confusing error. The book should either (a) use a
real client library, which sets the header correctly, or (b) teach `fallback_scrape_protocol` at
the point where the reader writes their first exposition by hand. Option (a) then (b) as a
troubleshooting sidebar is probably the right pedagogy.

### 2.6 `le` and `quantile` label values are normalised

In v3 the `le` label of classic histograms and the `quantile` label of summaries are normalised to
a float-like representation on ingestion, regardless of scrape protocol.

`my_classic_hist{le="1"}` is now always ingested as `my_classic_hist{le="1.0"}`.

> "The effect of this change is that alerts, recording rules and dashboards that directly reference
> label values as whole numbers such as `le="1"` will stop working."

The recommended fix is simply to write `le="1.0"`. A `metric_relabel_configs` workaround exists for
people who need the old labels back:

```yaml
    metric_relabel_configs:
      - source_labels:
          - quantile
        target_label: quantile
        regex: (\d+)\.0+
      - source_labels:
          - le
          - __name__
        target_label: le
        regex: (\d+)\.0+;.*_bucket
```

**This is a top-tier "old blog post is now wrong" trap.** Every pre-2025 histogram tutorial writes
`histogram_quantile(0.9, ...)` fine, but any that hand-selects `{le="1"}` or `{le="0.5"}` will
silently return nothing.

### 2.7 UTF-8 metric and label names

v3 supports UTF-8 in metric and label names, **enabled by default**. The global config default is:

```yaml
global:
  metric_name_validation_scheme: utf8   # default; "legacy" restores v2 rules
```

Per-scrape override:

```yaml
scrape_configs:
  - job_name: job1
    metric_name_validation_scheme: utf8
  - job_name: job2
    metric_name_validation_scheme: legacy
```

`legacy` means letters, numbers, colons and underscores only.

Practical PromQL consequence: a metric whose name is not a legacy identifier must be quoted inside
the braces, e.g. `{"my.metric.name", job="x"}`. The `__name__` form also still works:
`{__name__="my.metric.name"}`. Details belong in `promql.md`, but the *server-side* fact is that
UTF-8 is on by default and this is what makes untranslated OTLP names viable.

Also relevant: `<labelname>` in the config file schema is still documented as matching
`[a-zA-Z_][a-zA-Z0-9_]*` — the relaxed rules apply to *ingested* names, not to every YAML field.
Relabel `targetLabel` and rule names gained UTF-8 support in 3.2.0 specifically.

### 2.8 Log format changed

v3 moved from `go-kit/log` to `log/slog`. Old:

```
ts=2024-10-23T22:01:06.074Z caller=main.go:627 level=info msg="Starting Prometheus Server" ...
```

New:

```
time=2024-10-24T00:03:07.542+02:00 level=INFO source=/…/cmd/prometheus/main.go:681 msg="Starting Prometheus Server" ...
```

Fields: `time=` not `ts=`, `source=` not `caller=`, uppercase level. Anyone with log-parsing
pipelines or grep habits from 2.x needs to know. Flags: `--log.level` (`debug|info|warn|error`,
default `info`), `--log.format` (`logfmt|json`, default `logfmt`).

### 2.9 Alertmanager v1 API removed

`alerting: alertmanagers: [api_version: v1]` is rejected. v3 requires **Alertmanager 0.16.0+** and
`api_version: v2`. In practice nobody is running an AM that old, but the config key must say `v2`
(or be omitted).

### 2.10 TSDB downgrade floor

> "a Prometheus v3 TSDB can only be read by a Prometheus v2.55 or newer."

The format changed in v2.55 in preparation for index changes. If a reader ever needs to roll back,
2.55 is the floor. (Irrelevant to the lab, relevant to the "running this at work" chapter.)

### 2.11 Other 3.0 changes worth a footnote

- `scrape_classic_histograms` was **renamed** to `always_scrape_classic_histograms`.
- `remote_write` `http_config.enable_http2` default flipped from `true` to `false`.
- `GOMAXPROCS` / `GOMEMLIMIT` set automatically from Linux container limits.
- Console templates: the example files were removed (consoles themselves still exist and are
  officially "stable", but they are a dead end — do not teach them).
- Agent mode promoted to stable.
- The new service discovery manager is the only one.
- The web UI was completely replaced (see §9).

---

## 3. Native histograms: the exact status (this resolves conflict C4)

This is the single easiest thing to get half-right. The canonical paragraph:

> Native histograms are a **stable feature** of Prometheus as of **v3.8.0**. They are **not enabled
> by default**. Scraping them requires `scrape_native_histograms: true` (global or per scrape
> config); forwarding them requires `send_native_histograms: true` on the remote-write config.
> The old `--enable-feature=native-histograms` flag became a **no-op in v3.9** and now only logs a
> warning. Both settings are planned to default to `true` in **Prometheus 4.0**.

Verified against `docs/migration.md` (v3.13.1):

> "Starting from v3.9, the feature flag `native-histograms` is a no-op. Native histograms are a
> stable feature now, but scraping them has to be enabled via the `scrape_native_histograms` global
> or per-scrape configuration option (added in v3.8)."

And against the source, `cmd/prometheus/main.go` @ v3.13.1:

```go
case "native-histograms":
    logger.Warn("This option for --enable-feature is a no-op. To scrape native histograms, set the scrape_native_histograms scrape config setting to true.", "option", o)
case "ooo-native-histograms":
    logger.Warn("This option for --enable-feature is now permanently enabled and therefore a no-op.", "option", o)
```

So: **"experimental" is wrong. "On by default" is also wrong. "Stable but opt-in" is right.**

### 3.1 The four scrape settings and how they interact

All four exist at both `global:` and `scrape_configs[]:` level; the scrape-config value defaults to
the global one.

```yaml
[ scrape_native_histograms: <bool> | default = false ]
[ convert_classic_histograms_to_nhcb: <bool> | default = false ]
[ always_scrape_classic_histograms: <boolean> | default = false ]
[ native_histogram_bucket_limit: <int> | default = 0 ]        # scrape_config only
[ native_histogram_min_bucket_factor: <float> | default = 0 ]  # scrape_config only
```

The config file documents three cases verbatim; paraphrased faithfully:

- **Case 1 — target exposes only a classic histogram.** `scrape_native_histograms` has no effect.
  If `convert_classic_histograms_to_nhcb: false` it is ingested as a classic histogram. If `true`
  it becomes an NHCB, and `always_scrape_classic_histograms` decides whether the classic form is
  *also* stored.
- **Case 2 — target exposes only a native histogram** (no classic buckets other than the optional
  `+Inf`). With `scrape_native_histograms: false` you get a useless one-bucket classic histogram /
  NHCB. With `true` it is ingested as a pure native histogram, and neither
  `always_scrape_classic_histograms` nor `convert_classic_histograms_to_nhcb` has any effect.
- **Case 3 — target exposes both.** With `false`, behaves as case 1 and the native parts are
  discarded. With `true`, ingested as a native histogram, no NHCB is produced (it would collide),
  and the classic form is stored **only if** `always_scrape_classic_histograms: true`.

As of 3.13, each of the three booleans can also be overridden per target via relabeling using
internal labels: `__scrape_native_histograms__`, `__always_scrape_classic_histograms__`,
`__convert_classic_histograms_to_nhcb__`.

### 3.2 Exposition format constraint — the thing that makes native histograms awkward to teach

Native histograms travel over the **Prometheus protobuf** exposition format
(`PrometheusProto`). **The classic Prometheus text format cannot carry them.** OpenMetrics text
support is described in the spec as "in development".

The default `scrape_protocols` negotiation order therefore *changes* based on
`scrape_native_histograms`:

- `scrape_native_histograms: false` →
  `[ OpenMetricsText1.0.0, OpenMetricsText0.0.1, PrometheusText1.0.0, PrometheusText0.0.4 ]`
- `scrape_native_histograms: true` →
  `[ PrometheusProto, OpenMetricsText1.0.0, OpenMetricsText0.0.1, PrometheusText1.0.0, PrometheusText0.0.4 ]`

**Pedagogical consequence:** a chapter on native histograms cannot use a plain-text `/metrics`
endpoint. The reader's instrumented service must use a client library that can emit protobuf, and
the scrape config must set `scrape_native_histograms: true`. If the book's lab service is, say, a
Go service using `prometheus/client_golang`, this works. If it is a hand-written text endpoint, it
does not. Plan the lab accordingly, or treat native histograms as an "advanced/optional" chapter
that swaps in a purpose-built target.

An easier on-ramp that avoids the protobuf problem entirely: `convert_classic_histograms_to_nhcb:
true` turns ordinary classic histograms (scraped over plain text) into NHCBs at ingestion. That
demonstrates native-histogram *storage and querying* without needing a protobuf-capable target.
Strongly consider this for the book.

### 3.3 Schemas

- Standard schemas: **-4 (lowest resolution) … +8 (highest resolution)**, base-2. Each bucket
  boundary is the previous one times `2^(2^-n)`.
- **Schema -53** = custom bucket boundaries (NHCB — "native histogram with custom buckets"), where
  upper bounds are listed explicitly, playing the role classic `le` values play.
- -9 … +52 are reserved for future schemas.
- 3.8.0 change: "Native Histogram Custom Bounds with a NaN threshold are now rejected."

### 3.4 Remote write

```yaml
remote_write:
  - url: …
    [ send_native_histograms: <boolean> | default = false ]
```

Note: with `protobuf_message: io.prometheus.write.v2.Request`, `send_native_histograms` is a no-op
(always true).

### 3.5 Follow-up flagged in `pedagogy.md`

`pedagogy.md` flagged an unfetched blog post, "Modernizing Prometheus: Native Storage for Composite
Types" (2026-02-14). **I did not fetch it** — it is not required to state the stability facts above,
which are settled by the migration guide, the spec, and the source. Mark it as optional background;
nothing in §3 depends on it. **UNVERIFIED: the content of that blog post.**

---

## 4. TSDB: layout, WAL, head, compaction, retention

Source: `docs/storage.md` @ v3.13.1.

### 4.1 On-disk layout (verbatim)

> "Ingested samples are grouped into two-hour blocks. Each block consists of a directory that
> contains a chunks subdirectory with all the time series samples for that time window, a metadata
> file, and an index file (which maps metric names and labels to the time series in the chunks
> directory). The samples in the chunks directory are organized into one or more segment files, each
> up to 512 MB by default. When series are deleted via the API, the deletion records are stored in
> separate tombstone files rather than being immediately removed from the chunk segments."

```
./data
├── 01BKGV7JBM69T2G1BGBGM6KB12
│   └── meta.json
├── 01BKGTZQ1SYQJTR4PB43C8PD98
│   ├── chunks
│   │   └── 000001
│   ├── tombstones
│   ├── index
│   └── meta.json
├── 01BKGTZQ1HHWHV8FBJXW1Y3W0K
│   └── meta.json
├── 01BKGV7JC0RY8A6MACW02A2PJD
│   ├── chunks
│   │   └── 000001
│   ├── tombstones
│   ├── index
│   └── meta.json
├── chunks_head
│   └── 000001
└── wal
    ├── 000000002
    └── checkpoint.00000001
        └── 00000000
```

Block directory names are **ULIDs**, not timestamps — they sort lexicographically by creation time,
which is a nice thing to point out in a "look inside the data dir" lab exercise.

There is also a `wbl/` directory (write-behind log) when out-of-order ingestion is enabled — the
docs reference it in the backup section: "the `chunks_head/`, `wal/`, and `wbl/` directories in
`storage.tsdb.path`".

### 4.2 Head block and WAL

> "The current block for incoming samples is kept in memory and is not fully persisted. It is
> secured against crashes by a write-ahead log (WAL) that can be replayed when the Prometheus server
> restarts. Write-ahead log files are stored in the `wal` directory in 128MB segments. These files
> contain raw data that has not yet been compacted; thus they are significantly larger than regular
> block files. Prometheus will retain a minimum of three write-ahead log files. High-traffic servers
> may retain more than three WAL files in order to keep at least two hours of raw data."

The mental model to teach:

1. Sample arrives → appended to the **head block** (in memory) **and** to the **WAL** on disk.
2. When a head chunk fills (target 120 samples, see `--storage.tsdb.samples-per-chunk`) it is
   written to `chunks_head/` and **m-mapped** — out of the Go heap but still queryable.
3. Every ~2h the head is **compacted** into a persistent block directory, and the corresponding WAL
   is **checkpointed** (old segments dropped, still-live series records rewritten into
   `checkpoint.XXXXXXXX/`).
4. Background compaction later merges 2h blocks into bigger ones.

### 4.3 Compaction

> "The initial two-hour blocks are eventually compacted into longer blocks in the background.
> Compaction will create larger blocks containing data spanning up to 10% of the retention time, or
> 31 days, whichever is smaller."

So with the default 15d retention, the largest block spans ~36h. With 1y retention, 31d.

### 4.4 Retention — **the flags are deprecated, the config fields are the new way**

This is a change most tutorials have not caught up with. From the generated flag table at v3.13.1:

```
--storage.tsdb.retention.time   [DEPRECATED] … This flag has been deprecated, use the
                                storage.tsdb.retention.time field in the config file instead.
--storage.tsdb.retention.size   [DEPRECATED] … use the storage.tsdb.retention.size field in the
                                config file instead.
```

The current, runtime-reloadable way:

```yaml
storage:
  tsdb:
    retention:
      time: 15d       # if neither time nor size set, defaults to 15d. 0 disables time retention.
      size: 512MB     # default 0 = disabled. Units: B, KB, MB, GB, TB, PB, EB. Powers of 2.
      percentage: 0   # EXPERIMENTAL (3.11+). % of total disk. 0 = disabled.
```

Notes straight from the config docs:

- `time` and `size` config fields "take precedence over the deprecated command-line flag".
- `percentage`: "Prometheus will fail to start if this config is enabled, but it fails to query the
  total storage capacity. The total disk space allowed will automatically adapt to volume resize."
  Experimental.
- Retention changes at runtime apply immediately, "but block deletion based on the new retention
  policy occurs during the next block reload cycle. This happens automatically within 1 minute or
  when a compaction completes, whichever comes first."

From `storage.md`, still true:

- Time units supported: `y, w, d, h, m, s, ms`.
- Size retention only deletes **persistent blocks**, "although WAL and m-mapped chunks are counted
  in the total size. So the minimum requirement for the disk is the peak space taken by the `wal`
  … and `chunks_head` … directory combined (peaks every 2 hours)."
- "If both time and size retention policies are specified, whichever triggers first will be used."
- "Expired block cleanup happens in the background. It may take up to two hours to remove expired
  blocks. Blocks must be fully expired before they are removed."
- Right-sizing advice: "we recommend setting the retention size to, at most, 80-85% of your
  allocated Prometheus disk space."

**Book guidance:** teach the config-file form. Mention the flags only as "you will see these in
older docker-compose files; they still work but are deprecated." A lab that sets retention in
`prometheus.yml` also gets to demonstrate hot reload, which is a nice two-birds moment.

### 4.5 Capacity planning

> "Prometheus stores an average of only 1-2 bytes per sample."

```
needed_disk_space = retention_time_seconds * ingested_samples_per_second * bytes_per_sample
```

> "To lower the rate of ingested samples, you can either reduce the number of time series you scrape
> (fewer targets or fewer series per target), or you can increase the scrape interval. However,
> reducing the number of series is likely more effective, due to compression of samples within a
> series."

### 4.6 Filesystem warning (worth a callout box)

> "CAUTION: Non-POSIX compliant filesystems are not supported for Prometheus' local storage as
> unrecoverable corruptions may happen. NFS filesystems (including AWS's EFS) are not supported."

Docker-on-Windows / Docker-on-macOS bind mounts are a real hazard here for a lab. **Recommend a
named Docker volume for `/prometheus`, not a bind mount** — this is exactly what the official
installation doc recommends too, and it sidesteps both the filesystem-semantics issue and file
ownership problems (the busybox image runs as `nobody`).

### 4.7 Backups

> "[Snapshots] are recommended for backups. Backups made without snapshots run the risk of losing
> data that was recorded since the last TSDB block was created…"

Snapshot endpoint is `POST /api/v1/admin/tsdb/snapshot`, requires `--web.enable-admin-api`.

### 4.8 Hidden TSDB flags (from `cmd/prometheus/main.go`, not in the docs table)

These are real but `Hidden()`, so `--help` does not show them. Useful for a "how it actually works"
sidebar; do not tell readers to set them.

| Hidden flag | Default | Purpose |
|---|---|---|
| `--storage.tsdb.min-block-duration` | `2h` | head/block chunk range. "For use in testing." |
| `--storage.tsdb.max-block-duration` | 10% of retention | max compacted block span. "For use in testing." |
| `--storage.tsdb.max-block-chunk-segment-size` | 512MB | chunk segment file size |
| `--storage.tsdb.wal-segment-size` | 128MB | WAL segment size |
| `--storage.tsdb.wal-compression` | `true` | WAL compression (on by default since 2.20) |
| `--storage.tsdb.wal-compression-type` | `snappy` | or `zstd` |
| `--storage.tsdb.samples-per-chunk` | `120` | target samples per chunk |
| `--storage.tsdb.allow-overlapping-compaction` | `true` | vertical compaction |
| `--storage.tsdb.delayed-compaction.max-percent` | `10` | only with `delayed-compaction` flag |
| `--storage.tsdb.block-reload-interval` | `1m` | how often new/removed blocks are picked up |

The 2h block duration is *not* user-configurable in any supported way — worth saying plainly, since
readers often ask.

---

## 5. Out-of-order ingestion

Configured in the runtime-reloadable `storage.tsdb` block, **not** by a flag or feature flag:

```yaml
storage:
  tsdb:
    out_of_order_time_window: 30m   # default 0s = OOO ingestion disabled
```

Verbatim semantics:

> "An out-of-order/out-of-bounds sample is ingested into the TSDB as long as the timestamp of the
> sample is >= TSDB.MaxTime-out_of_order_time_window."
>
> "When out_of_order_time_window is >0, the errors out-of-order and out-of-bounds are combined into
> a single error called 'too-old'; a sample is either (a) ingestible into the TSDB … or (b) too-old,
> i.e. not in-order and before the out-of-order window."
>
> "When out_of_order_time_window is greater than 0, it also affects experimental agent. It allows
> the agent's WAL to accept out-of-order samples that fall within the specified time window relative
> to the timestamp of the last appended sample for the same series."

Related facts:

- Enabling OOO creates the **`wbl/`** (write-behind log) directory alongside `wal/`.
- Out-of-order **native histogram** ingestion landed in 3.0.0; the `ooo-native-histograms` feature
  flag is a permanently-enabled **no-op** since 3.4.0 ("Config: Make setting out-of-order native
  histograms feature a no-op").
- 3.9.0 added the histogram `prometheus_tsdb_sample_ooo_delta` for observing how out-of-order your
  arrivals actually are.
- Caveat from `feature_flags.md`: with `--enable-feature=st-synthesis`, "cumulative samples without
  ST that are out of order will be rejected despite the `tsdb.out_of_order_time_window` setting."

Also in the same block, two newer knobs:

```yaml
storage:
  tsdb:
    stale_series_compaction_threshold: 0.0   # EXPERIMENTAL (3.10+). 0 disables.
    chunk_encoding:
      floats: xor                             # or xor2 (3.13+); see §8 xor2-encoding
```

`stale_series_compaction_threshold` is "the ratio of stale series in the memory to the total series
in the memory" that triggers early compaction of stale series out of the head.

---

## 6. Staleness and the 5m lookback delta

Source: `docs/querying/basics.md` @ v3.13.1, "Gotchas → Staleness".

### 6.1 Lookback

> "The timestamps at which to sample data, during a query, are selected independently of the actual
> present time series data. … It does so by taking the newest sample that is less than the lookback
> period ago. The lookback period is 5 minutes by default, but can be set with the
> `--query.lookback-delta` flag or overridden on an individual query via the `lookback_delta`
> parameter."

Two things a textbook must get right here:

1. The flag is **`--query.lookback-delta`**, default **`5m`**. It applies to "expression evaluations
   **and federation**".
2. There is now a **per-query override**: `lookback_delta=<duration | float>` on both
   `/api/v1/query` and `/api/v1/query_range`. Many older books say the 5m window is global-only.
   That is now stale advice.

Also note §2.3: lookback is **left-open** in v3, same as range selectors.

### 6.2 Staleness markers

> "If a target scrape or rule evaluation no longer returns a sample for a time series that was
> previously present, this time series will be marked as stale. If a target is removed, the
> previously retrieved time series will be marked as stale soon after removal."
>
> "If a query is evaluated at a sampling timestamp after a time series is marked as stale, then no
> value is returned for that time series. If new samples are subsequently ingested for that time
> series, they will be returned as expected."

The mechanism: Prometheus appends an explicit *stale marker* sample (a specific NaN payload) when a
series disappears. That is why a series drops off a graph immediately rather than lingering for 5
minutes.

### 6.3 The exception that trips people up

> "Some exporters, which put their own timestamps on samples, get a different behaviour: series that
> stop being exported take the last value for (by default) 5 minutes before disappearing. The
> `track_timestamps_staleness` setting can change this."

Config field (global and per scrape config):

```yaml
[ track_timestamps_staleness: <boolean> | default = false ]
```

So: for a *normal* exporter, disappearance is immediate (stale marker). For a target that sets its
own timestamps (Pushgateway-ish, some federation setups, some SNMP/blackbox arrangements), the value
lingers for the lookback delta unless `track_timestamps_staleness: true`.

**Great lab exercise:** stop one of the lab's scrape targets and watch `up{job="…"}` vanish
instantly rather than flatline for 5 minutes. Then contrast with a metric coming from a
timestamp-setting source. This makes staleness concrete in about 90 seconds and pre-empts the
"why is my dead service still showing green" question.

### 6.4 Instant vector selector wording

> "Time series are only returned if their most recent sample is less than the lookback period ago."

---

## 7. Remote write, remote read, and OTLP ingestion

### 7.1 The four integration directions (verbatim from `storage.md`)

> - Prometheus can write samples that it ingests to a remote URL in a Remote Write format.
> - Prometheus can receive samples from other clients in a Remote Write format.
> - Prometheus can read (back) sample data from a remote URL in a Remote Read format.
> - Prometheus can return sample data requested by clients in a Remote Read format.

> "The remote read and write protocols both use a snappy-compressed protocol buffer encoding over
> HTTP. The read protocol is not yet considered as stable API."

### 7.2 Remote-write 1.0 vs 2.0 — current status

- **1.0**: stable specification. Protobuf message `prometheus.WriteRequest`. This is still the
  **default** for outgoing remote write.
- **2.0**: **experimental**, currently at spec version **2.0-rc.4**. Protobuf message
  `io.prometheus.write.v2.Request`, `Content-Type: application/x-protobuf;proto=io.prometheus.write.v2.Request`.
  The spec text says: "no major changes are expected, but we reserve the right to break the
  compatibility if it's necessary."

Config field:

```yaml
remote_write:
  - url: http://…/api/v1/write
    [ protobuf_message: <prometheus.WriteRequest | io.prometheus.write.v2.Request>
      | default = prometheus.WriteRequest ]
```

The docs' own summary of the difference:

> "The `prometheus.WriteRequest` represents the message introduced in Remote Write 1.0, which will
> be deprecated eventually. The `io.prometheus.write.v2.Request` was introduced in Remote Write 2.0
> and replaces the former, by improving efficiency and sending metadata, start timestamp and native
> histograms by default."

What 2.0 adds: string interning (smaller payloads, less CPU), metadata, exemplars, native
histograms, and **start timestamps**; plus mandatory `X-Prometheus-Remote-Write-*-Written` response
headers so the sender knows what was actually persisted.

Terminology change in 3.8.0: "Update receiving to 2.0-rc.4 spec. 'created timestamp' (CT) is now
called **'start timestamp' (ST)**." All the newer feature flags use ST naming
(`st-storage`, `st-synthesis`, `use-start-timestamps`) while the older
`created-timestamp-zero-ingestion` flag kept its old name "for stability".

### 7.3 Receiving remote write

- Enable: `--web.enable-remote-write-receiver` (default `false`)
- Endpoint: **`/api/v1/write`**
- Which messages are accepted:
  `--web.remote-write-receiver.accepted-protobuf-messages`, default `prometheus.WriteRequest`.
  Supported values: `prometheus.WriteRequest`, `io.prometheus.write.v2.Request`.

Docs caveat, worth quoting to readers tempted to build a push pipeline:

> "This is not considered an efficient way of ingesting samples. Use it with caution for specific
> low-volume use cases. It is not suitable for replacing the ingestion via scraping and turning
> Prometheus into a push-based metrics collection system."

To send metadata over RW 2.0 you also need `--enable-feature=metadata-wal-records`.

### 7.4 Remote read

- Endpoint: **`/api/v1/read`**
- Considered **unstable** per `stability.md`.
- Important architectural caveat: "on the read path, Prometheus only fetches raw series data for a
  set of label selectors and time ranges from the remote end. All PromQL evaluation on the raw data
  still happens in Prometheus itself." So remote read does not distribute query execution.
- Flags: `--storage.remote.read-sample-limit` (default `5e7`),
  `--storage.remote.read-concurrent-limit` (default `10`),
  `--storage.remote.read-max-bytes-in-frame` (default `1048576`).

### 7.5 OTLP ingestion endpoint

- Enable: `--web.enable-otlp-receiver` (default `false`)
- Endpoint: **`/api/v1/otlp/v1/metrics`** ← note the doubled `v1`; this is correct and surprising.
- Introduced in v2.47; the CLI flag form (rather than a feature flag) is v3.0.
- Listed as **stable** in `stability.md` ("OTLP receiver endpoint").
- Same "not efficient, low-volume use cases" caveat as remote write.

Full `otlp:` config block (v3.13.1), which is where most of the OTLP subtlety lives:

```yaml
otlp:
  [ promote_resource_attributes: [<string>, ...] | default = [ ] ]
  [ promote_all_resource_attributes: <boolean> | default = false ]
  [ ignore_resource_attributes: [<string>, ...] | default = [] ]
  [ translation_strategy: <string> | default = "UnderscoreEscapingWithSuffixes" ]
  [ keep_identifying_resource_attributes: <boolean> | default = false ]
  [ convert_histograms_to_nhcb: <boolean> | default = false ]
  [ promote_scope_metadata: <boolean> | default = false ]
  [ label_name_underscore_sanitization: <boolean> | default = true ]
  [ label_name_preserve_multiple_underscores: <boolean> | default = true ]
```

`translation_strategy` values:

- `UnderscoreEscapingWithSuffixes` — **default**; the classic OTel→Prometheus normalisation
  (dots → underscores, unit and `_total` suffixes appended).
- `NoUTF8EscapingWithSuffixes` — keeps dots etc. (relies on UTF-8 support), still adds suffixes.
- `UnderscoreEscapingWithoutSuffixes` — escapes but adds no suffixes. (3.6.0)
- `NoTranslation` — **experimental**, keeps everything. The docs carry a strong warning:

> "WARNING: The 'NoTranslation' setting has significant known risks and limitations …
>  * Impaired UX when using PromQL in plain YAML (e.g. alerts, rules, dashboard, autoscaling
>    configuration).
>  * Series collisions which in the best case may result in OOO errors, in the worst case a silently
>    malformed time series."

Delta temporality: two mutually exclusive feature flags —
`--enable-feature=otlp-deltatocumulative` (converts deltas to cumulative using the OTel Collector's
`deltatocumulative` processor; keeps mutex-guarded in-memory state, and a restart causes a counter
reset) and `--enable-feature=otlp-native-delta-ingestion` (stores raw delta values as-is, very
early stage). Enabling both is a config error.

For delta metrics, `rate()`/`increase()` are wrong; the docs suggest
`sum_over_time(delta_metric[<range>])` and `sum_over_time(delta_metric[<range>]) / <range>`.

**Book guidance:** the OTLP receiver is genuinely useful as a one-paragraph "yes, you can point an
OTel Collector at Prometheus" note plus a working `otlp:` snippet. It is *not* a good spine for a
beginner's book — scraping is. Keep it to a short section, probably in the same optional chapter as
remote write.

---

## 8. Feature flags — the complete current list

`--enable-feature=a,b,c`. The binary's own help text at v3.13.1 lists these valid options:

```
concurrent-rule-eval, created-timestamp-zero-ingestion, delayed-compaction, exemplar-storage,
extra-scrape-metrics, memory-snapshot-on-shutdown, metadata-wal-records, old-ui,
otlp-deltatocumulative, otlp-native-delta-ingestion, promql-binop-fill-modifiers,
promql-delayed-name-removal, promql-duration-expr, promql-experimental-functions,
promql-extended-range-selectors, promql-per-step-stats, search-api, st-storage, st-synthesis,
type-and-unit-labels, use-start-timestamps, use-uncached-io, xor2-encoding
```

### 8.1 Annotated table

| Flag | Since | What it does |
|---|---|---|
| `exemplar-storage` | 2.x | In-memory fixed-size circular buffer for exemplars. Size via `storage: exemplars: max_exemplars` (default `100000`). Exemplars are also appended to the WAL. |
| `memory-snapshot-on-shutdown` | 2.x | Snapshot in-memory chunks + series on shutdown → much faster startup (less WAL replay). |
| `extra-scrape-metrics` | 2.x | **Deprecated.** Use the `extra_scrape_metrics` config option (global or per scrape config) instead. Adds `scrape_timeout_seconds`, `scrape_sample_limit`, `scrape_body_size_bytes`. |
| `promql-per-step-stats` | 2.x | `stats=all` returns per-step stats: `totalQueryableSamples(PerStep)`, `samplesRead(PerStep)`, `peakSamples`. |
| `promql-experimental-functions` | 2.x | Unlocks experimental PromQL functions incl. `double_exponential_smoothing`, `histogram_quantiles`, `first_over_time`, `ts_of_*_over_time`. |
| `created-timestamp-zero-ingestion` | 2.x | Injects start timestamps as 0-valued samples. Changes default `scrape_protocols` to prefer `PrometheusProto`. |
| `st-storage` | 3.11 | Stores start timestamps per sample through WAL/TSDB/agent/RW2.0. Requires XOR2 chunk encoding or Prometheus refuses to start. New `SamplesV2` WAL record — **replayable only by 3.11+**. |
| `use-start-timestamps` | 3.12 | Uses ST in `rate()`, `irate()`, `increase()`. Does **not** work with `promql-extended-range-selectors`. |
| `st-synthesis` | 3.12 | Synthesises STs for cumulative metrics when the source omits them. **Drops the first sample** of every series to establish a reference point. Scrape-only. |
| `concurrent-rule-eval` | 2.x | Independent rules within a group evaluate concurrently. Limit: `--rules.max-concurrent-evals` (default 4). |
| `old-ui` | 3.0 | Serve the Prometheus 2.x web UI instead of the new one. |
| `metadata-wal-records` | 2.x | Per-series metadata tracked in memory + WAL. Required to send metadata over RW 2.0. |
| `delayed-compaction` | 2.x | Random offset up to 10% of chunk range added to head compaction start time, to de-synchronise a fleet. |
| `promql-delayed-name-removal` | 3.x | Defers `__name__` removal to the last evaluation step; lets `label_replace`/`label_join` preserve the name and avoids many "vector cannot contain metrics with the same labelset" errors. |
| `otlp-deltatocumulative` | 3.2 | Convert OTLP delta → cumulative. Mutually exclusive with `otlp-native-delta-ingestion`. |
| `otlp-native-delta-ingestion` | 3.x | Store OTLP deltas raw. Very early stage. |
| `promql-duration-expr` | 3.4 | Arithmetic in durations: `rate(x[5m * 2])`, `x offset (1h / 2)`. Provides `step()`, `range()`, `min_of()`, `max_of()`. |
| `type-and-unit-labels` | 3.5 | Injects reserved `__type__` / `__unit__` labels from scrape/ingest metadata. PROM-39. |
| `use-uncached-io` | 3.x | Linux-only. Chunk writes bypass the page cache via direct I/O. |
| `xor2-encoding` | 3.11 | New XOR2 float chunk encoding. **Highly experimental and risky** (see below). |
| `promql-extended-range-selectors` | 3.7 | `anchored` and `smoothed` range/instant selector modifiers. |
| `promql-binop-fill-modifiers` | 3.10 | `fill()`, `fill_left()`, `fill_right()` on binary operators. |
| `search-api` | 3.13 | Experimental `/api/v1/search/*` NDJSON endpoints with fuzzy matching. |

### 8.2 Undocumented flag: `fast-startup`

`--enable-feature=fast-startup` **exists in the v3.13.1 binary**:

```go
case "fast-startup":
    c.tsdb.EnableFastStartup = true
    logger.Info("Experimental fast startup is enabled.")
```

It was added in 3.11.0 ("[FEATURE] TSDB: Add an experimental `fast-startup` feature flag") but it is
**not listed in `feature_flags.md`** and **not in the `--enable-feature` help string**. Treat it as
undocumented-experimental. **Do not mention it in the book**, other than possibly as an example of
why one should read the changelog, not just the docs.

### 8.3 Flags that are accepted but are now no-ops / deprecated

| Passed value | Behaviour at v3.13.1 |
|---|---|
| `native-histograms` | **No-op.** Warns: set `scrape_native_histograms` instead. |
| `ooo-native-histograms` | **No-op.** "now permanently enabled". |
| `auto-reload-config` | Deprecated. Warns: use `--config.auto-reload` instead. Promoted to stable in 3.12. |
| `extra-scrape-metrics` | Being phased out in favour of the `extra_scrape_metrics` config option. |
| `promql-at-modifier`, `promql-negative-offset`, `remote-write-receiver`, `agent`, `expand-external-labels`, `no-default-scrape-port`, `new-service-discovery-manager`, `auto-gomaxprocs`, `auto-gomemlimit` | Removed in 3.0. Prometheus logs a warning if still passed. |

Anything unrecognised just logs `Unknown option for --enable-feature` and continues — Prometheus
does **not** fail to start. Worth telling readers: a typo in `--enable-feature` is silent-ish.

### 8.4 XOR2 warning (verbatim — reproduce this if the book mentions it at all)

> "WARNING: This is highly experimental and risky setting:
> * Chunks encoded with XOR2 **cannot be read by older Prometheus versions** … Once enabled and data
>   is written, you need to **manually delete blocks from the disk**, otherwise Prometheus will
>   return error on all queries.
> * We are still experimenting on the final encoding. As of now this encoding can change in any
>   Prometheus version. All your persistent block data will be lost between versions."

Runtime control (3.13+): `storage.tsdb.chunk_encoding.floats: xor | xor2`.

**Recommendation: the book should not enable any of `xor2-encoding`, `st-storage`, `st-synthesis`,
or `use-uncached-io` anywhere in the lab.** They are in-flight work. `exemplar-storage` is the one
experimental flag genuinely worth teaching (exemplars → trace links in Grafana).

---

## 9. The web UI

Prometheus 3.0 replaced the old UI wholesale. From the 3.0 announcement: the UI was "completely
rewritten with less clutter, a more modern look and feel", including "a PromLens-style tree view".
The old UI is still reachable with `--enable-feature=old-ui`, and `feature_flags.md` is candid about
why: the new UI "is not fully feature complete and battle-tested yet".

### 9.1 Navigation (routes, from `web/ui/mantine-ui/src/App.tsx` @ v3.13.1)

| Path | Page | Shown in agent mode? |
|---|---|---|
| `/query` | Query (the expression browser) | no |
| `/alerts` | Alerts | no |
| `/targets` | Targets | **yes** |
| `/rules` | Rules | no |
| `/service-discovery` | Service Discovery | **yes** |
| `/status` | Status | **yes** |
| `/tsdb-status` | TSDB Status | no |
| `/flags` | Flags | **yes** |
| `/config` | Config | **yes** |
| `/alertmanager-discovery` | Alertmanager Discovery | no |

Note the 3.0 change: "Move AM discovery page from 'Monitoring status' to 'Server status'."

### 9.2 The query page

Three tabs per query panel: **Table**, **Graph**, **Explain**. Alongside them the page ships:

- **Metrics Explorer** — browse metric names and their metadata without typing a query. This is the
  single best onboarding affordance in the whole product for a reader who has never used PromQL.
- **Tree view** (`TreeView.tsx` / `TreeNode.tsx`) — the PromLens-style AST breakdown showing what
  each sub-expression evaluates to. Superb teaching tool; the book should use screenshots of it when
  first explaining `rate(...)` inside `sum by (...)`.
- **Explain tab** — plain-English description of the selected expression node.
- CodeMirror-based **`ExpressionInput`** with autocompletion over metric names, label names and
  label values, plus a **query history** completion strategy.
- Multiple query panels per page (3.9 added "duplicate that query panel").
- Range/resolution inputs, stacked/unstacked display modes, a dedicated histogram chart renderer for
  native histograms, and a query-stats hover tooltip on the table tab.

UI changes worth knowing about across 3.x: relabeling steps are shown per discovered target (3.8);
scrape interval and timeout on the targets page (3.7); rules-page filtering (3.5); alerts-page
virtual scrolling (3.8); a UI for deleting time series and cleaning tombstones (3.12); a
"start Y axis at zero" graph option (3.9).

**Caveat for the book:** `stability.md` explicitly lists "HTML generated by the web UI" as
**unstable**. Screenshots will age. Budget for re-shooting them, and prefer describing *what to
click* over pixel-exact descriptions.

---

## 10. promtool

Same binary family, shipped in the same container image at `/bin/promtool`.

Top-level flags: `--version`, `--experimental`, and
`--enable-feature` (a **much shorter** list than the server's:
`promql-experimental-functions, promql-delayed-name-removal, promql-duration-expr,
promql-extended-range-selectors`).

Commands: `help`, `check`, `query`, `debug`, `push`, `test`, `tsdb`, `promql`.

### 10.1 `promtool check`

| Subcommand | Notes |
|---|---|
| `promtool check config <config-files…>` | `--syntax-only`, `--lint` (`all`, `duplicate-rules`, `none`, `too-long-scrape-interval`; default `duplicate-rules`), `--lint-fatal` (exit 3), `--ignore-unknown-fields`, `--agent` |
| `promtool check rules [rule-files…]` | Reads stdin if no files. `--lint` (`all`, `duplicate-rules`, `none`), `--lint-fatal`, `--ignore-unknown-fields` |
| `promtool check web-config <files…>` | validates `--web.config.file` files |
| `promtool check healthy` | `--url` (default `http://localhost:9090`), `--http.config.file` |
| `promtool check ready` | same flags |
| `promtool check service-discovery <config-file> <job>` | runs SD for one job and shows relabeling. `--timeout` default `30s` |
| `promtool check metrics` | reads exposition text on **stdin**; `--extended` for cardinality analysis, `--lint` (`all`/`none`) |

Parent `promtool check` also takes `--query.lookback-delta` (default `5m`).

Examples straight from the help text:

```
$ cat metrics.prom | promtool check metrics
$ curl -s http://localhost:9090/metrics | promtool check metrics --extended
$ curl -s http://localhost:9100/metrics | promtool check metrics --extended --lint=none
```

**Lab-friendly:** `promtool check config` in a CI step, or as a docker-compose one-shot service, is
a cheap and very teachable habit. In 3.11 promtool's debug output moved to **stderr** so stdout
stays pipeable.

### 10.2 `promtool query`

`promtool query instant|range|series|labels|analyze`, with `-o/--format` (default `promql`) and
`--http.config.file` at the parent level.

- `instant <server> <expr>` — `--time`, `--header`
- `range <server> <expr>` — `--start`, `--end`, `--step`, `--header`
- `series <server>` — `--match` (repeatable), `--start`, `--end`
- `labels <server> <name>` — `--start`, `--end`, `--match`
- `analyze` — `--server`, `--type histogram`, `--duration` (default `1h`), `--time`, `--match`

### 10.3 `promtool test rules` — rule unit testing

```shell
./promtool test rules test.yml
./promtool test rules test1.yml test2.yml test3.yml
```

Flags: `--junit <path>` (on the parent `test` command), `--run <regex>` (repeatable),
`--debug`, `--diff` (experimental, coloured diff), `--ignore-unknown-fields`.

Test file schema (verbatim from `unit_testing_rules.md` @ v3.13.1):

```yaml
rule_files:
  [ - <file_name> ]

[ evaluation_interval: <duration> | default = 1m ]

# Setting fuzzy_compare true will very slightly weaken floating point comparisons.
# This will (effectively) ignore differences in the last bit of the mantissa.
[ fuzzy_compare: <boolean> | default = false ]

group_eval_order:
  [ - <group_name> ]

tests:
  [ - <test_group> ]
```

`<test_group>`:

```yaml
[ interval: <duration> | default = evaluation_interval ]
input_series:
  [ - <series> ]
[ name: <string> ]
[ start_timestamp: <int> | <rfc3339_string> | default = 0 ]
alert_rule_test:
  [ - <alert_test_case> ]
promql_expr_test:
  [ - <promql_test_case> ]
external_labels:
  [ <labelname>: <string> ... ]
  [ external_url: <string> ]
```

The expanding series notation, which is the part readers always get wrong:

```
'a+bxn' becomes 'a a+b a+(2*b) a+(3*b) … a+(n*b)'
'a-bxn' becomes 'a a-b a-(2*b) a-(3*b) … a-(n*b)'
'axn'   becomes 'a a a … a'  (a, n+1 times) — shorthand for 'a+0xn'
'_'     represents a missing sample from scrape
'stale' indicates a stale sample
```

Worked examples from the docs:

```
'-2+4x3' becomes '-2 2 6 10'
' 1-2x4' becomes '1 -1 -3 -5 -7'
' 1x4'   becomes '1 1 1 1 1'
' 1 _x3 stale' becomes '1 _ _ _ stale'
```

Note the off-by-one that catches everyone: `1x4` is **five** samples, not four — `n` counts the
*further* samples after the first.

Native histograms can appear in `values:` too:

```
{{schema:1 sum:-0.3 count:3.1 z_bucket:7.1 z_bucket_w:0.05 buckets:[5.1 10 7] offset:-3 n_buckets:[4.1 5] n_offset:-5 counter_reset_hint:gauge}}
```

with `custom_values:` used instead of the bucket fields when `schema:-53`.

Time semantics: by default `time()` returns 0 at test start (Unix epoch) and `eval_time` is a
duration relative to `start_timestamp`. `start_timestamp` (new in 3.9) accepts a Unix timestamp
(`1609459200`) or RFC3339 (`"2021-01-01T00:00:00Z"`), and then `time()` returns
`start_timestamp + eval_time`.

A complete working example (`test.yml` + `alerts.yml`) is in the docs and is reproduced faithfully
in §10.6 of the source doc — the book should use its own domain-appropriate example rather than
copying it.

**This is the tool that makes the "alerts that don't cry wolf" chapter teachable.** A reader can
write an alert, write a unit test that asserts it fires at 10m and not at 4m, and run it in a
second with no cluster. Make this a first-class part of the alerting chapter, not an appendix.

### 10.4 `promtool tsdb`

| Subcommand | Notes |
|---|---|
| `tsdb analyze [db path] [block id]` | "Analyze churn, label pair cardinality and compaction efficiency." `--limit` (default 20), `--extended`, `--match` (one matcher set only). Defaults to `data/` and the **last** block. |
| `tsdb list [db path]` | list blocks; `-r/--human-readable` |
| `tsdb dump [db path]` | `--min-time`, `--max-time`, `--match` (default `{__name__=~'(?s:.*)'}`), `--format prom\|seriesjson` (`seriesjson` added in 3.9), `--sandbox-dir-root` |
| `tsdb dump-openmetrics [db path]` | experimental; excludes native histograms and staleness markers |
| `tsdb create-blocks-from openmetrics <input> [outdir]` | backfill; `--label`; can read from a pipe (3.3+) |
| `tsdb create-blocks-from rules <rule-files…>` | `--url` (default `http://localhost:9090`), `--start` (required), `--end`, `--output-dir` (default `data/`), `--eval-interval` (default `60s`), `--http.config.file` |
| `tsdb bench write` | `--out` (default `benchout`), `--metrics` (10000), `--scrapes` (3000) |

`create-blocks-from` also takes `-r/--human-readable` and `-q/--quiet`.

`promtool tsdb analyze` is the cardinality-debugging tool. A lab exercise that deliberately creates
a high-cardinality label and then finds it with `promtool tsdb analyze --extended` is worth a lot.

### 10.5 Backfilling caveats (verbatim, from `storage.md`)

> "it is not safe to backfill data from the last 3 hours (the current head block) as this time range
> may overlap with the current head block Prometheus is still mutating."

> "Note that native histograms and staleness markers are not supported by this procedure, as they
> cannot be represented in the OpenMetrics format."

Rule-backfill limitations: re-running with overlapping ranges duplicates blocks; **all** rules in
the file are evaluated; `interval` in the rule file beats `--eval-interval`; alerting rules are
ignored; rules in the same group cannot see each other's results.

### 10.6 `promtool promql` (requires `--experimental`)

- `promtool promql format <query>` — pretty-print
- `promtool promql label-matchers set <query> <name> <value>` (`-t/--type`, default `=`)
- `promtool promql label-matchers delete <query> <name>`

### 10.7 `promtool push metrics`

```
promtool push metrics <remote-write-url> [metric-files…]
  --label (default job=promtool, repeatable)
  --timeout (30s)
  --header
  --protobuf_message (prometheus.WriteRequest | io.prometheus.write.v2.Request)
```

Help text says "for testing purpose only".

---

## 11. Command-line flags worth memorising

Generated table at v3.13.1. Only the ones a book will actually use.

| Flag | Default | Note |
|---|---|---|
| `--config.file` | `prometheus.yml` | |
| `--config.auto-reload` | `false` | **Stable as of 3.12.** Replaces the `auto-reload-config` feature flag. |
| `--config.auto-reload-interval` | `30s` | only with `--config.auto-reload` |
| `--web.listen-address` | `0.0.0.0:9090` | repeatable |
| `--web.enable-lifecycle` | `false` | enables `POST /-/reload` and `POST /-/quit` |
| `--web.enable-admin-api` | `false` | snapshot / delete series / clean tombstones |
| `--web.enable-remote-write-receiver` | `false` | `/api/v1/write` |
| `--web.remote-write-receiver.accepted-protobuf-messages` | `prometheus.WriteRequest` | |
| `--web.enable-otlp-receiver` | `false` | `/api/v1/otlp/v1/metrics` |
| `--web.external-url` | | prefixes all HTTP endpoints if it has a path |
| `--web.route-prefix` | path of `--web.external-url` | |
| `--web.config.file` | | **[EXPERIMENTAL]** TLS / basic auth |
| `--web.page-title` | `Prometheus Time Series Collection and Processing Server` | |
| `--web.max-connections` | `512` | |
| `--web.read-timeout` | `5m` | |
| `--web.cors.origin` | `.*` | fully anchored regex |
| `--web.max-notifications-subscribers` | `16` | SSE subscribers for `/api/v1/notifications/live` |
| `--web.search.max-limit` | `10000` | caps `limit` on the experimental search API |
| `--storage.tsdb.path` | `data/` | server mode only |
| `--storage.tsdb.retention.time` | — | **[DEPRECATED]** → config `storage.tsdb.retention.time` |
| `--storage.tsdb.retention.size` | — | **[DEPRECATED]** → config `storage.tsdb.retention.size` |
| `--storage.tsdb.no-lockfile` | `false` | |
| `--storage.tsdb.head-chunks-write-queue-size` | `0` | experimental |
| `--storage.tsdb.delay-compact-file.path` | | Thanos shipper integration (3.9+) |
| `--storage.agent.path` | `data-agent/` | agent mode only |
| `--storage.agent.wal-compression` | `true` | agent mode only |
| `--storage.agent.retention.min-time` | `5m` | agent mode only |
| `--storage.agent.retention.max-time` | `4h` | agent mode only |
| `--query.lookback-delta` | `5m` | |
| `--query.timeout` | `2m` | |
| `--query.max-concurrency` | `20` | |
| `--query.max-samples` | `50000000` | per-query in-memory sample cap |
| `--rules.alert.for-outage-tolerance` | `1h` | |
| `--rules.alert.for-grace-period` | `10m` | |
| `--rules.alert.resend-delay` | `1m` | |
| `--rules.max-concurrent-evals` | `4` | |
| `--alertmanager.notification-queue-capacity` | `10000` | |
| `--alertmanager.notification-batch-size` | `256` | |
| `--alertmanager.drain-notification-queue-on-shutdown` | `true` | |
| `--auto-gomaxprocs` | `true` | disable with `--no-auto-gomaxprocs` |
| `--auto-gomemlimit` | `true` | disable with `--no-auto-gomemlimit` |
| `--auto-gomemlimit.ratio` | `0.9` | |
| `--agent` | | agent mode |
| `--log.level` | `info` | `debug\|info\|warn\|error` |
| `--log.format` | `logfmt` | `logfmt\|json` |
| `--enable-feature` | | see §8 |

**Documentation bug to be aware of:** `feature_flags.md` says the concurrency limit flag is
`--rules.max-concurrent-rule-evals`. The generated flag table (and therefore the binary) says
**`--rules.max-concurrent-evals`**. Trust the binary. Verify empirically before printing either.

---

## 12. Config file — the shape a reader needs

Top-level keys at v3.13.1:

```yaml
global:            # defaults for everything below
runtime:           # gogc
rule_files:        # list of globs
scrape_config_files:  # list of globs
scrape_configs:    # list of <scrape_config>
alerting:
  alert_relabel_configs:
  alertmanagers:
remote_write:      # list
otlp:              # OTLP receiver translation settings
remote_read:       # list
storage:           # runtime-reloadable storage settings
  tsdb:
  exemplars:
tracing:           # OTLP trace export from Prometheus itself
```

### 12.1 `global:` defaults worth knowing

```yaml
global:
  [ scrape_interval: <duration> | default = 1m ]
  [ scrape_timeout: <duration> | default = 10s ]     # cannot exceed scrape_interval
  [ scrape_protocols: [<string>, ...] ]              # default depends on scrape_native_histograms
  [ evaluation_interval: <duration> | default = 1m ]
  [ rule_query_offset: <duration> | default = 0s ]
  external_labels:
    [ <labelname>: <labelvalue> ... ]
  [ query_log_file: <string> ]
  [ scrape_failure_log_file: <string> ]
  [ body_size_limit: <size> | default = 0 ]
  [ sample_limit: <int> | default = 0 ]
  [ label_limit: <int> | default = 0 ]
  [ label_name_length_limit: <int> | default = 0 ]
  [ label_value_length_limit: <int> | default = 0 ]
  [ target_limit: <int> | default = 0 ]
  [ keep_dropped_targets: <int> | default = 0 ]
  [ metric_name_validation_scheme: <string> | default "utf8" ]
  [ scrape_native_histograms: <bool> | default = false ]
  [ convert_classic_histograms_to_nhcb: <bool> | default = false ]
  [ always_scrape_classic_histograms: <boolean> | default = false ]
  [ extra_scrape_metrics: <boolean> | default = false ]

runtime:
  [ gogc: <int> | default = 75 ]
```

`external_labels` values support `${var}` / `$var` environment expansion (this used to require the
`expand-external-labels` feature flag; it is unconditional in v3). `$$` escapes a literal `$`.

`<duration>` regex, verbatim:

```
((([0-9]+)y)?(([0-9]+)w)?(([0-9]+)d)?(([0-9]+)h)?(([0-9]+)m)?(([0-9]+)s)?(([0-9]+)ms)?|0)
```

`<size>`: "A unit is required. Supported units: B, KB, MB, GB, TB, PB, EB." Powers of 2.

### 12.2 The image's bundled `prometheus.yml`

Exactly what a reader gets from `docker run prom/prometheus` with no config mounted
(`documentation/examples/prometheus.yml` @ v3.13.1):

```yaml
# my global config
global:
  scrape_interval: 15s # Set the scrape interval to every 15 seconds. Default is every 1 minute.
  evaluation_interval: 15s # Evaluate rules every 15 seconds. The default is every 1 minute.
  # scrape_timeout is set to the global default (10s).

# Alertmanager configuration
alerting:
  alertmanagers:
    - static_configs:
        - targets:
          # - alertmanager:9093

# Load rules once and periodically evaluate them according to the global 'evaluation_interval'.
rule_files:
  # - "first_rules.yml"
  # - "second_rules.yml"

# A scrape configuration containing exactly one endpoint to scrape:
# Here it's Prometheus itself.
scrape_configs:
  # The job name is added as a label `job=<job_name>` to any timeseries scraped from this config.
  - job_name: "prometheus"

    # metrics_path defaults to '/metrics'
    # scheme defaults to 'http'.

    static_configs:
      - targets: ["localhost:9090"]
       # The label name is added as a label `label_name=<label_value>` to any timeseries scraped from this config.
        labels:
          app: "prometheus"
```

Note the `app: "prometheus"` label — this is newer than most tutorials show, and it means a fresh
Prometheus's self-metrics carry `app="prometheus"`. Harmless, but it will appear in the reader's
first label-explorer screenshot and should be explained rather than ignored.

### 12.3 Reloading

> "A configuration reload is triggered by sending a `SIGHUP` to the Prometheus process or sending a
> HTTP POST request to the `/-/reload` endpoint (when the `--web.enable-lifecycle` flag is enabled).
> This will also reload any configured rule files."

> "If the new configuration is not well-formed, the changes will not be applied."

Or use `--config.auto-reload` (+ `--config.auto-reload-interval`, default `30s`), stable since 3.12.
For a docker-compose lab, `--web.enable-lifecycle` plus
`curl -X POST http://localhost:9090/-/reload` is the most teachable option, and it lets the book
show the failure case (bad YAML → reload rejected, old config still serving) which is a genuinely
important operational lesson.

---

## 13. Agent mode

Promoted to **stable** in 3.0. Enabled with the `--agent` CLI flag (the `agent` feature flag was
removed).

What it is, per `docs/prometheus_agent.md`:

> "this agent mode disables some of Prometheus' usual features (TSDB, alerting, and rule
> evaluations) and optimizes the binary for scraping and remote writing to remote locations."

Benefits and downsides, verbatim:

> - "Improved efficiency. The customized Agent TSDB WAL removes the data immediately after
>   successful writes. If it cannot reach the remote endpoint, it persists the data temporarily on
>   the disk until the remote endpoint is back online. This is currently limited to a two-hour
>   buffer only…"
> - "No local queries."
> - "Recording rules are not possible."
> - "No alerting."

Agent-only flags: `--storage.agent.path` (default `data-agent/`),
`--storage.agent.wal-compression` (`true`), `--storage.agent.retention.min-time` (`5m`),
`--storage.agent.retention.max-time` (`4h`),
`--storage.agent.checkpoint-from-in-memory-series` (`false`, 3.12+),
`--storage.agent.checkpoint-batch-size` (`1000`), `--storage.agent.no-lockfile`.

Config validation for agent mode: `promtool check config --agent`.

In the web UI, agent mode shows only Targets, Service Discovery, Status, Flags and Config.

**⚠ Documentation inconsistency to verify before printing.** `prometheus_agent.md` says the agent
"exposes a web UI on port **9095**". The generated flag table says `--web.listen-address` defaults
to `0.0.0.0:9090` with no mode qualifier, and nothing in `cmd/prometheus/main.go` changes it for
agent mode. I believe the 9095 claim is **stale documentation** and the real default is 9090, but I
did not run the binary. **UNVERIFIED — do not print a port number for agent mode without testing
it.** (Easiest check: `docker run prom/prometheus:v3.13.1 --agent --config.file=…` and see what it
binds.)

**Book guidance:** agent mode deserves one page in a "scaling out" chapter, no more. It is
irrelevant to a single-node lab and actively confusing if introduced early (a reader who enables it
loses the query UI, which is the whole point of chapters 1–8).

---

## 14. HTTP API highlights

Full reference: `docs/querying/api.md`. There is also an **OpenAPI 3.2 spec served by the server
itself** at `/api/v1/openapi.yaml` (added in 3.10).

### 14.1 Query endpoints

```
GET|POST /api/v1/query
  query=<string>
  time=<rfc3339 | unix_timestamp>
  timeout=<duration>
  limit=<number>            # truncates matrix/vector series count; 0 = disabled
  lookback_delta=<duration | float>
  stats=<string>            # "all" for detailed timings + sample counts

GET|POST /api/v1/query_range
  query, start, end, step, timeout, limit, lookback_delta, stats
```

POST with `Content-Type: application/x-www-form-urlencoded` is the escape hatch for long queries
that breach URL length limits — worth teaching, since dashboards generate monsters.

### 14.2 Endpoints a book will reference

| Endpoint | Note |
|---|---|
| `/api/v1/series`, `/api/v1/labels`, `/api/v1/label/<name>/values` | metadata discovery |
| `/api/v1/targets` | includes `scrapePool` for dropped targets (3.3+) |
| `/api/v1/targets/relabel_steps` | per-target relabeling trace (3.8) |
| `/api/v1/rules`, `/api/v1/alerts` | paginated rule groups |
| `/api/v1/status/config`, `/status/flags`, `/status/runtimeinfo`, `/status/buildinfo` | |
| `/api/v1/status/tsdb` | head stats + cardinality. `limit` default 10, max 10000 |
| `/api/v1/status/tsdb/blocks` | **experimental** (3.6) |
| `/api/v1/status/walreplay` | WAL replay progress |
| `/api/v1/status/self_metrics` | **new in 3.12** — the server's own metrics as JSON |
| `/api/v1/features` | **new in 3.9** — which features are on. Categories: `api`, `otlp_receiver`, `prometheus`, `promql`, `promql_functions`, `promql_operators`, `rules`, `scrape`, `service_discovery`, … |
| `/api/v1/notifications`, `/api/v1/notifications/live` | experimental; SSE stream feeding the UI banner |
| `/api/v1/search/metric_names`, `/search/label_names`, `/search/label_values` | **experimental, 3.13**, needs `--enable-feature=search-api`. NDJSON (`application/x-ndjson`), fuzzy matching (`fuzz_threshold`, `fuzz_alg=subsequence\|jarowinkler`) |
| `/api/v1/admin/tsdb/snapshot`, `/delete_series`, `/clean_tombstones` | need `--web.enable-admin-api` |
| `/api/v1/write` | needs `--web.enable-remote-write-receiver` |
| `/api/v1/otlp/v1/metrics` | needs `--web.enable-otlp-receiver` |
| `/-/healthy`, `/-/ready` | `/-/ready` sends `X-Prometheus-Stopping` during shutdown (fixed in 3.10) |
| `/-/reload`, `/-/quit` | need `--web.enable-lifecycle` |
| `/debug/pprof/…`, `/debug/pprof/fgprof` | fgprof wall-time profiling added 3.10 |
| `/assets/third-party-licenses.txt` | new in 3.13 |

`/api/v1/status/tsdb` response shape (the useful bit for a cardinality lab):

```json
{
  "status": "success",
  "data": {
    "headStats": { "numSeries": 508, "chunkCount": 937, "minTime": …, "maxTime": … },
    "seriesCountByMetricName": [ { "name": "…", "value": 20 } ],
    "labelValueCountByLabelName": [ … ],
    "memoryInBytesByLabelName": [ … ],
    "seriesCountByLabelValuePair": [ … ]
  }
}
```

Note the documented key name in the prose (`seriesCountByLabelPair`) does not match the key in the
example JSON (`seriesCountByLabelValuePair`). **UNVERIFIED which is correct at runtime** — check
against a live server before printing the field name.

---

## 15. Official container images

**All three registries carry identical tag sets** (verified 2026-07-28 by querying each registry's
tag API):

| Registry | Image |
|---|---|
| Docker Hub | `prom/prometheus` |
| Quay.io | `quay.io/prometheus/prometheus` |
| GitHub Container Registry | `ghcr.io/prometheus/prometheus` *(new in 3.13)* |

### 15.1 Tag scheme (this settles part of conflict C5)

Prometheus images **do** use a `v` prefix on version tags. Confirmed present on Docker Hub right
now:

```
latest              latest-busybox              latest-distroless
v3                  v3-busybox                  v3-distroless
v3.13.1             v3.13.1-busybox             v3.13.1-distroless
v3.13.0             v3.13.0-busybox             v3.13.0-distroless
v3.12.0             v3.12.0-busybox             v3.12.0-distroless
v3.5.5              (no -distroless variant)
main                main-busybox                main-distroless
```

Timestamps: `v3.13.1*` pushed 2026-07-10; `v3.5.5` pushed 2026-07-09; `main*` rebuilt daily.

So there are three variants per release:

- **unsuffixed** (`v3.13.1`) — the default; busybox-based
- **`-busybox`** — explicit alias of the default
- **`-distroless`** — added in 3.10

`v3.5.5` has **no** `-distroless` variant, because distroless landed after the 3.5 line branched.
If the book ever suggests distroless, it must also say "3.10+ only".

**Pin `prom/prometheus:v3.13.1` and use that exact string everywhere.** Never `latest` in a
textbook — the whole point of pinning is that the reader's output matches the printed output.

### 15.2 Default (busybox) image internals

From `Dockerfile` @ v3.13.1:

```dockerfile
FROM quay.io/prometheus/busybox-${OS}-${ARCH}:latest
COPY .build/${OS}-${ARCH}/prometheus        /bin/prometheus
COPY .build/${OS}-${ARCH}/promtool          /bin/promtool
COPY documentation/examples/prometheus.yml  /etc/prometheus/prometheus.yml
WORKDIR /prometheus
RUN chown -R nobody:nobody /etc/prometheus /prometheus && chmod g+w /prometheus
USER       nobody
EXPOSE     9090
VOLUME     [ "/prometheus" ]
ENTRYPOINT [ "/bin/prometheus" ]
CMD        [ "--config.file=/etc/prometheus/prometheus.yml", \
             "--storage.tsdb.path=/prometheus" ]
```

Facts a lab chapter depends on:

- Runs as **`nobody`**, not root. `/prometheus` is `chmod g+w` (3.3 change: "Dockerfile: Make
  `/prometheus` writable").
- **`ENTRYPOINT` is the binary and `CMD` holds the two default flags.** Therefore: *any* `command:`
  you put in docker-compose **replaces both defaults**. You must re-specify `--config.file` and
  `--storage.tsdb.path` yourself. The docs say this explicitly: "If you want to add extra command
  line parameters to the `docker run` command, you will need to re-add these yourself as they will
  be overwritten."
  **This is probably the #1 docker-compose mistake readers will make.** Call it out in a box.
- `VOLUME [ "/prometheus" ]` is declared — so an anonymous volume appears if you do not name one.
- `promtool` is in the same image at `/bin/promtool`, so
  `docker compose run --rm prometheus --version`-style tricks need
  `--entrypoint /bin/promtool`.

### 15.3 Distroless variant internals

From `Dockerfile.distroless` @ v3.13.1:

```dockerfile
FROM gcr.io/distroless/static-debian13:nonroot-${DISTROLESS_ARCH}
# Base image sets USER to 65532:65532 (nonroot user).
COPY documentation/examples/prometheus.yml  /etc/prometheus/prometheus.yml
COPY .build/${OS}-${ARCH}/prometheus        /bin/prometheus
COPY .build/${OS}-${ARCH}/promtool          /bin/promtool
WORKDIR /prometheus
EXPOSE     9090
ENTRYPOINT [ "/bin/prometheus" ]
CMD        [ "--config.file=/etc/prometheus/prometheus.yml", \
             "--storage.tsdb.path=/prometheus" ]
```

Differences from the busybox image, all of which matter operationally:

- UID/GID **65532** (not `nobody`)
- **No `VOLUME` declaration**
- **No shell** — `docker exec ... sh` will not work, which is a bad property for a teaching lab
- No `chown`/`chmod` of `/prometheus`, so volume permissions are the operator's problem

**Recommendation: use the default busybox image in the book's lab.** Mention distroless once, in a
production-hardening aside.

---

## 16. API stability guarantees (`docs/stability.md`)

Stable for 3.x:

> * The query language and data model
> * Alerting and recording rules
> * The ingestion exposition format
> * v1 HTTP API (used by dashboards and UIs), excluding endpoints explicitly marked as experimental
> * Configuration file format (minus the service discovery remote read/write, see below)
> * Rule/alert file format
> * Console template syntax and semantics
> * Remote write sending, per the 1.0 specification, and receiving
> * Agent mode
> * OTLP receiver endpoint

Unstable for 3.x:

> * Any feature listed as experimental or subject to change, including:
>   * The `double_exponential_smoothing` PromQL function
>   * Remote read and the remote read endpoint
> * Server-side HTTPS and basic authentication
> * Service discovery integrations, with the exception of `static_configs`, `file_sd_configs` and `http_sd_config`
> * Go APIs of packages that are part of the server
> * HTML generated by the web UI
> * The metrics in the /metrics endpoint of Prometheus itself
> * Exact on-disk format. …
> * The format of the logs

Two of these are load-bearing for a textbook:

1. **"The metrics in the /metrics endpoint of Prometheus itself" are unstable.** Any dashboard or
   alert the book builds on `prometheus_*` self-metrics may break across minors. Say so, and prefer
   the most-established ones (`prometheus_tsdb_head_series`, `prometheus_target_interval_length_seconds`,
   `up`, `scrape_duration_seconds`). Several were renamed/deprecated recently — 3.7 deprecated
   `prometheus_remote_storage_samples_in_total`, `…_histograms_in_total`, `…_exemplars_in_total`,
   `prometheus_remote_storage_highest_timestamp_in_seconds`; 3.10 added an `alertmanager` dimension
   to three `prometheus_notifications_*` metrics.
2. **"HTML generated by the web UI" is unstable** → screenshots will rot. See §9.2.

---

## 17. Notable 3.x additions the book might want, by version

Quick index so a chapter can say "requires 3.x or later" accurately.

| Capability | First available |
|---|---|
| New web UI, UTF-8 by default, agent stable, OTLP flag, left-open ranges | 3.0.0 |
| `limit` param on `/query` and `/query_range`; `otlp-deltatocumulative` | 3.2.0 |
| Anchors/aliases in rule files; `idelta()`/`irate()` for native histograms | 3.3.0 |
| Duration arithmetic in PromQL (`promql-duration-expr`); global `convert_classic_histograms_to_nhcb` | 3.4.0 |
| `type-and-unit-labels`; `always_scrape_classic_histograms` global; STACKIT SD; `/rules` filtering | 3.5.0 |
| `/api/v1/status/tsdb/blocks`; OTLP `__type__`/`__unit__`; `UnderscoreEscapingWithoutSuffixes` | 3.6.0 |
| `anchored`/`smoothed` selectors; `first_over_time`; RW2 type+unit labels; OTLP writes direct to TSDB | 3.7.0 |
| **Native histograms stable**; RW 2.0-rc.4 / ST rename; relabel-steps UI; RW2 in `promtool push` | 3.8.0 |
| Native histograms "no longer experimental"; `/api/v1/features`; `tsdb dump --format seriesjson`; `start_timestamp` in unit tests | 3.9.0 |
| `fill()`/`fill_left()`/`fill_right()`; OpenAPI at `/api/v1/openapi.yaml`; **distroless image**; fgprof | 3.10.0 |
| `storage.tsdb.retention.percentage`; `st-storage`; `xor2-encoding`; `histogram_quantiles`; `</` `>/` histogram trim ops | 3.11.0 |
| `/api/v1/status/self_metrics`; `--config.auto-reload` **stable**; `start()`/`end()`/`range()`/`step()`; UI for deleting series | 3.12.0 |
| Experimental search API; `chunk_encoding.floats`; per-target histogram relabel overrides; **ghcr.io images** | 3.13.0 |

---

## 18. Traps a textbook author will otherwise fall into

1. **Writing `--storage.tsdb.retention.time=30d` as the modern way.** It is deprecated. Config-file
   `storage.tsdb.retention.time` is the current form and is hot-reloadable.
2. **Saying native histograms are experimental.** Stable since 3.8, but opt-in. Get §3's paragraph
   verbatim.
3. **Teaching `{le="0.5"}` selectors.** v3 normalises to `le="0.5"` fine but `le="1"` becomes
   `le="1.0"`. Any integer bucket bound breaks.
4. **`foo[1m:1m]` subqueries in examples.** Returns one point in v3 → No Data through `rate()`.
5. **A hand-written text `/metrics` endpoint with no `Content-Type`.** v3 fails the scrape outright.
6. **Overriding `command:` in docker-compose without re-adding `--config.file` and
   `--storage.tsdb.path`.** ENTRYPOINT/CMD split means the defaults vanish.
7. **Bind-mounting the data dir on Docker Desktop.** Non-POSIX filesystems are explicitly
   unsupported; use a named volume.
8. **Assuming `--enable-feature` typos are fatal.** They are only warnings; a mis-typed flag
   silently does nothing.
9. **Assuming targets get `:80`/`:443` appended.** Not since v3.
10. **Copying v2 log-parsing (`ts=`, `caller=`).** v3 emits `time=`, `source=`, uppercase level.
11. **`holt_winters`.** Renamed *and* gated behind `promql-experimental-functions`.
12. **Claiming the 5m lookback is global-only.** There is a per-query `lookback_delta` parameter now.
13. **Claiming a dead target's series linger for 5 minutes.** Stale markers make them vanish
    immediately — *unless* the exporter sets its own timestamps.
14. **Building alerts on `prometheus_*` self-metrics without caveat.** Explicitly unstable, and
    several were renamed in 3.7 and 3.10.
15. **Regex `.` not matching newline.** It does now, in queries *and* relabel configs.
16. **Assuming `promtool test rules` counts samples the way you think.** `1x4` is five samples.

---

## 19. Explicitly UNVERIFIED

Do not print these without checking:

1. **Agent mode's web UI port.** `prometheus_agent.md` says 9095; the flag default is 9090 and
   nothing in `main.go` overrides it per mode. I did not run the binary. (§13)
2. **`seriesCountByLabelPair` vs `seriesCountByLabelValuePair`** in the `/api/v1/status/tsdb`
   response — the docs contradict themselves. (§14)
3. **`--rules.max-concurrent-evals` vs `--rules.max-concurrent-rule-evals`** — the generated flag
   table and `feature_flags.md` disagree. I trust the generated table (it comes from the binary) but
   did not run `prometheus --help`. (§11)
4. **The content of the blog post "Modernizing Prometheus: Native Storage for Composite Types"
   (2026-02-14)**, flagged by `pedagogy.md`. Not fetched. Nothing in §3 depends on it.
5. **Whether `prom/prometheus:v3.13.1` and `quay.io/prometheus/prometheus:v3.13.1` are
   byte-identical.** Both registries carry the tag; I did not compare digests.
6. **Exact `promtool` exit codes** beyond the documented "`--lint-fatal` makes lint errors exit
   with exit code 3".

All of these are cheap to settle with a running container during the verification pass.

---

## 20. Resolutions offered to `_CONFLICTS.md`

- **C2 (which Prometheus line is LTS) — RESOLVED.** Both dossiers were partly right. Per
  `prometheus.io/docs/introduction/release-cycle/`, **3.13 and 3.5 are both currently supported LTS
  lines**; 3.5's window closes **2026-07-31**, 3.13's closes **2027-07-31**. The download page badges
  `3.5.5` as "LTS" only because `3.13.1` already carries the "Latest" badge. The book should name
  **3.13 as the current LTS** and pin `prom/prometheus:v3.13.1`, which is simultaneously latest and
  LTS. It must **not** name 3.5.5 as the LTS — that expires days from now.
- **C4 (native histogram wording) — RESOLVED.** Use the canonical paragraph in §3 verbatim. Stable
  since 3.8.0; flag is a no-op since 3.9; opt-in via `scrape_native_histograms` /
  `send_native_histograms`; both default to `true` only in 4.0. Additional constraint the other
  dossiers did not surface: **native histograms require the protobuf exposition format**, so the
  histogram chapter's target must be protobuf-capable, or the chapter should use
  `convert_classic_histograms_to_nhcb: true` instead.
- **C5, Docker tag format for Prometheus images — RESOLVED.** Confirmed directly against the Docker
  Hub, Quay and GHCR tag APIs: Prometheus images use a **`v` prefix** (`v3.13.1`), with
  `-busybox` and `-distroless` variants and `latest` / `v3` / `main` floating tags. See §15.1.
- **C3 (which registry to use) — input, not a resolution.** All three registries carry identical
  tag sets for `prometheus` itself. Docker Hub (`prom/prometheus`) is what the official installation
  doc uses in every example, so it is the lowest-friction choice for a beginner's book. Whatever the
  lab spec picks, note that `-distroless` does not exist for the 3.5 line.

---

## Sources

All fetched 2026-07-28. Docs pinned to the `v3.13.1` git tag where possible.

**Release and version**
- <https://prometheus.io/download/>
- <https://prometheus.io/docs/introduction/release-cycle/>
- <https://github.com/prometheus/prometheus/releases>
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/CHANGELOG.md>
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.5.5/CHANGELOG.md>
- <https://raw.githubusercontent.com/prometheus/prometheus/main/CHANGELOG.md>

**Core docs (v3.13.1 tag)**
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/migration.md>
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/storage.md>
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/feature_flags.md>
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/stability.md>
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/installation.md>
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/prometheus_agent.md>
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/configuration/configuration.md>
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/configuration/unit_testing_rules.md>
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/command-line/prometheus.md>
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/command-line/promtool.md>
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/querying/basics.md>
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/querying/api.md>

**Source code (v3.13.1 tag)**
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/cmd/prometheus/main.go>
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/Dockerfile>
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/Dockerfile.distroless>
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/documentation/examples/prometheus.yml>
- <https://github.com/prometheus/prometheus/tree/v3.13.1/web/ui/mantine-ui/src/pages>
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/web/ui/mantine-ui/src/App.tsx>
- <https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/web/ui/mantine-ui/src/pages/query/QueryPanel.tsx>

**Specs and announcements**
- <https://prometheus.io/docs/specs/native_histograms/>
- <https://prometheus.io/docs/specs/prw/remote_write_spec_2_0/>
- <https://prometheus.io/blog/2024/11/14/prometheus-3-0/>

**Registries (tag APIs queried directly)**
- <https://hub.docker.com/v2/repositories/prom/prometheus/tags>
- <https://quay.io/api/v1/repository/prometheus/prometheus/tag/>
- `https://ghcr.io/v2/prometheus/prometheus/tags/list` (anonymous bearer token)
