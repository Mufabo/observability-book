# Research Dossier: Scale, HA, and Long-Term Storage

**Topic owner:** scaling / HA / LTS chapter(s)
**Research date:** 2026-07-27 / 2026-07-28
**Verification method:** live fetch of primary sources (prometheus.io docs, raw GitHub files at pinned tags,
GitHub Releases API, grafana.com/docs, docs.victoriametrics.com, docs.aws.amazon.com, docs.cloud.google.com).
Anything not verified live is explicitly marked **UNVERIFIED**.

> **Reader context reminder.** Our reader is a working developer with *no* ops background. This chapter sits
> late in the book. By the time they arrive they know: what a time series is, PromQL, scrape configs,
> recording rules, Alertmanager. They have never sharded anything. They do not know what "object storage"
> means operationally. Almost everything in this dossier needs a plain-language on-ramp before the YAML.

---

## 0. Version table — what is current as of 2026-07-28

All rows verified live via the GitHub Releases API or the project's own release-cycle docs.

| Component | Current version | Date | Notes |
|---|---|---|---|
| Prometheus | **3.13.1** | 2026-07-10 | Patch on the 3.13 LTS line |
| Prometheus LTS (current) | **3.13** | released 2026-07-01 | Supported until **2026-07-31 → 2027-07-31** (see below) |
| Prometheus LTS (outgoing) | **3.5** | released 2025-07-14 | **End of support 2026-07-31** — i.e. *this week*. Latest patch 3.5.5 (2026-07-09) |
| Alertmanager | **0.33.1** | 2026-07-04 | Still pre-1.0 |
| Grafana | **13.1.1** | 2026-07-21 | 13.0.4, 12.4.6, 12.3.9 also patched same week |
| Thanos | **v0.42.2** | 2026-07-17 | CNCF **Incubating**. Apache-2.0 |
| Grafana Mimir | **mimir-3.1.4** | 2026-07-22 | AGPL-3.0. 3.0 was a major architectural release |
| VictoriaMetrics | **v1.148.0** | 2026-07-20 | Apache-2.0 (OSS). Also an LTS line |
| VictoriaMetrics LTS lines | **v1.148.x**, **v1.136.x** (latest v1.136.14) | — | LTS lines are an *Enterprise* offering; fixes also land in latest OSS |
| Cortex | **v1.21.1** | 2026-06-05 | CNCF **Incubating** (since 2020-08-20), **not archived**, Apache-2.0, repo active |

### Prometheus LTS policy (verified)

- New minor release every **6 weeks**; after that window a minor generally stops getting bugfixes.
- LTS releases get bug, security and documentation fixes for **one year**.
- History: 2.37 (EOL 2023-07-31), 2.45 (EOL 2024-07-31), 2.53 (EOL 2025-07-31), **3.5** (EOL 2026-07-31),
  **3.13** (EOL 2027-07-31). Next LTS expected ~June 2027.

**Textbook implication:** pin the lab to `v3.13.1` (or the `v3` floating tag) and say in the text that 3.5 goes
out of support at the end of July 2026. Do not write "the latest Prometheus is 2.x" anywhere.

### Container image tags (verified against Docker Hub / Quay APIs)

```
prom/prometheus:v3.13.1              # default variant == busybox
prom/prometheus:v3.13.1-busybox
prom/prometheus:v3.13.1-distroless   # UID/GID 65532 (nonroot), no VOLUME declaration
prom/prometheus:v3                   # floating major tag
quay.io/prometheus/prometheus:v3.13.1
ghcr.io/prometheus/prometheus:v3.13.1   # NEW in 3.13.0 — images now also published to GHCR
grafana/grafana:13.1.1
quay.io/thanos/thanos:v0.42.2
grafana/mimir:3.1.4                  # note: NO leading "v"
victoriametrics/victoria-metrics:v1.148.0
```

**Distroless gotcha worth a callout box** (from the Prometheus 3.10.0 changelog, 2026-02-24): the distroless
variant runs as UID/GID **65532** instead of `nobody`, and **removes the `VOLUME` declaration**. Migrating an
existing named volume needs:

```
docker run --rm -v prometheus-data:/prometheus alpine chown -R 65532:65532 /prometheus
```

---

## 1. How Prometheus actually stores data (the mental model the reader needs first)

Verbatim-accurate summary of `docs/storage.md` at tag `v3.13.1`.

- Samples are grouped into **two-hour blocks**. Each block is a directory (ULID-named) containing:
  - `chunks/` — segment files, **up to 512 MB each by default**
  - `index` — maps metric names and labels to series in the chunks
  - `meta.json`
  - `tombstones` — deletion records; deletes via the API do **not** immediately rewrite chunk segments
- The **current** block lives in memory ("the head") and is protected by a **write-ahead log (WAL)** in the
  `wal/` directory, in **128 MB segments**. Prometheus retains **a minimum of three WAL files**; high-traffic
  servers keep more in order to hold at least two hours of raw data.
- `chunks_head/` holds m-mapped head chunks.
- Compaction: initial 2h blocks are merged in the background into larger blocks spanning **up to 10% of the
  retention time, or 31 days, whichever is smaller**.

Real directory listing straight from the docs (good figure for the book):

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

### Hard constraints the reader must internalise

Quoted from the docs:

- *"a limitation of local storage is that it is not clustered or replicated. Thus, it is not arbitrarily
  scalable or durable in the face of drive or node outages and should be managed like any other single node
  database. With proper architecture, it is possible to retain years of data in local storage."*
- **NFS is not supported.** Verbatim: *"Non-POSIX compliant filesystems are not supported for Prometheus'
  local storage as unrecoverable corruptions may happen. NFS filesystems (including AWS's EFS) are not
  supported."* → This deserves a warning box. Developers reach for EFS/NFS constantly in Docker/K8s labs.
- Backups: use the **snapshot API** (`/api/v1/admin/tsdb/snapshot`, needs `--web.enable-admin-api`). Backups
  without snapshots risk losing data since the last block cut (~every 2 hours, covering the last 3 hours).
  Excluding `chunks_head/`, `wal/`, `wbl/` gives a coherent backup at the cost of the WAL time range.
- Expired block cleanup is background work: *"It may take up to two hours to remove expired blocks. Blocks
  must be fully expired before they are removed."* → Explains "I set retention to 1d and disk didn't shrink."

---

## 2. Vertical sizing: the rules of thumb (and how to stop guessing)

### 2.1 Disk

The official formula, verbatim from `storage.md`:

```
needed_disk_space = retention_time_seconds * ingested_samples_per_second * bytes_per_sample
```

And the official constant, verbatim: *"Prometheus stores an average of only **1-2 bytes per sample**."*

Worked examples to put in the book (arithmetic done here; check when typesetting):

| Scenario | Samples/sec | Retention | @1.5 B/sample |
|---|---|---|---|
| The book's lab (a handful of targets) | ~1,000 | 15d | ~1.9 GB |
| Small production estate | 10,000 | 15d | ~19 GB |
| Small production estate | 10,000 | 90d | ~117 GB |
| Mid-size | 100,000 | 15d | ~194 GB |
| Mid-size | 100,000 | 1y | ~4.7 TB |

`samples_per_second ≈ active_series / scrape_interval_seconds`. So 1 M active series at a 15s scrape interval
is ~66,700 samples/sec ≈ **~2.6 TB/year** at 1.5 bytes/sample. That number is the punchline of the chapter:
raw disk is *not* usually why one Prometheus stops being enough — **memory and blast radius are**.

**How to measure your own bytes/sample instead of guessing** (both metrics verified to exist in
`tsdb/compact.go` at v3.13.1; both are histograms so `_sum` exists):

```promql
rate(prometheus_tsdb_compaction_chunk_size_bytes_sum[1h])
  /
rate(prometheus_tsdb_compaction_chunk_samples_sum[1h])
```

Other verified TSDB self-metrics worth teaching (all confirmed present in `tsdb/head.go` / `tsdb/db.go` at
v3.13.1):

```
prometheus_tsdb_head_series                     # active series in the head — THE cardinality number
prometheus_tsdb_head_series_created_total       # churn numerator
prometheus_tsdb_head_series_removed_total
prometheus_tsdb_head_samples_appended_total     # rate() of this == ingestion rate
prometheus_tsdb_head_chunks
prometheus_tsdb_head_chunks_storage_size_bytes
prometheus_tsdb_storage_blocks_bytes            # on-disk size of persisted blocks
prometheus_tsdb_symbol_table_size_bytes
prometheus_tsdb_wal_corruptions_total
prometheus_tsdb_retention_limit_seconds
prometheus_tsdb_retention_limit_bytes
prometheus_tsdb_retention_limit_percentage      # new, matches the percentage retention option
prometheus_tsdb_time_retentions_total
prometheus_tsdb_size_retentions_total
prometheus_tsdb_compactions_total
prometheus_tsdb_compactions_failed_total
prometheus_tsdb_data_replay_duration_seconds    # WAL replay time on startup
prometheus_tsdb_out_of_order_samples_total
prometheus_tsdb_too_old_samples_total
prometheus_tsdb_sample_ooo_delta                # histogram, added 3.9.0
```

Two teachable PromQL expressions:

```promql
# Ingestion rate (samples/sec)
rate(prometheus_tsdb_head_samples_appended_total[5m])

# Churn: new series per second. High churn is the #1 cause of surprise memory growth.
rate(prometheus_tsdb_head_series_created_total[5m])
```

### 2.2 Memory — be honest that this one is fuzzy

The only *primary* figure I could verify live is Robust Perception's, and it is old:

> **"As of Prometheus 2.20 a good rule of thumb should be around 3kB per series in the head."**
> — Robust Perception (Brian Brazil), article dated **2020-09-07**.

There is **no official memory-per-series number in the current Prometheus docs.** I checked `storage.md` at
v3.13.1: it gives the disk formula only.

Community/vendor guidance in 2025–2026 clusters around **6–10 KiB of process RSS per active series** once you
include the Go heap, m-mapped chunk handles, the index, query working memory and headroom. **These are
secondary sources — UNVERIFIED as official guidance.** Recommended framing for the book:

> Budget **~8 KiB of RAM per active series** as a starting point, then measure. The 3 kB figure you'll find
> in older blog posts is head-chunk memory only, not the resident set size of the process.

Practical planning table (label it clearly as a *starting point*, not a spec):

| Active series | Rough RAM to provision |
|---|---|
| 100 k | 1–2 GB |
| 500 k | 4–6 GB |
| 1 M | 8–12 GB |
| 5 M | 40–60 GB (you are now well into "should I shard?" territory) |
| 10 M | 80+ GB (single Prometheus is a bad idea here) |

Things that push you to the top of the range: high churn (Kubernetes pod restarts, per-request labels),
15s or faster scrape intervals, native histograms, heavy concurrent range queries.

**Additional verified memory fact:** enabling `remote_write` costs roughly **+25% memory**, and shard memory
is `number of shards * (capacity + max_samples_per_send)`. With defaults (`capacity: 10000`,
`max_samples_per_send: 2000`) each shard uses **less than 2 MB**. Source: prometheus.io/docs/practices/remote_write/.

### 2.3 Right-sizing size-based retention (verified, exact)

From `storage.md`: *"we recommend setting the retention size to, at most, **80-85% of your allocated
Prometheus disk space**."* Reason: only **persistent blocks** are deleted to honour size retention, but the
WAL and m-mapped head chunks **count toward the total**. So the disk floor is the peak combined size of
`wal/` + `chunks_head/`, which peaks every 2 hours.

---

## 3. Retention configuration — **this changed, and most writing about it is now wrong**

### 3.1 The old way (still works, now deprecated)

```
--storage.tsdb.retention.time=30d
--storage.tsdb.retention.size=100GB
```

Verified from `docs/command-line/prometheus.md` at v3.13.1, the help text for **both** flags now begins with
`[DEPRECATED]`:

> `--storage.tsdb.retention.time` — **[DEPRECATED]** How long to retain samples in storage. If neither this
> flag nor "storage.tsdb.retention.size" is set, the retention time defaults to 15d. Units Supported: y, w,
> d, h, m, s, ms. **This flag has been deprecated, use the storage.tsdb.retention.time field in the config
> file instead.** Use with server mode only.

Same wording for `--storage.tsdb.retention.size`.

### 3.2 The current way — retention in the config file, runtime-reloadable

Verbatim schema from `docs/configuration/configuration.md` at v3.13.1 (`<tsdb>` section, reached via
`storage: → tsdb:`):

```yaml
storage:
  tsdb:
    retention:
      # How long to retain samples in storage. If neither this option nor the size option
      # is set, the retention time defaults to 15d. Setting this to 0 disables time-based retention.
      # This option takes precedence over the deprecated command-line flag --storage.tsdb.retention.time.
      time: 30d

      # Maximum number of bytes that can be stored for blocks. A unit is required,
      # supported units: B, KB, MB, GB, TB, PB, EB. Ex: "512MB". Based on powers-of-2, so 1KB is 1024B.
      # If set to 0 or not set, size-based retention is disabled.
      # This option takes precedence over the deprecated command-line flag --storage.tsdb.retention.size.
      size: 100GB

      # Maximum percent of total disk space allowed for storage of blocks. Alternative to `size`.
      # Prometheus will fail to start if this config is enabled, but it fails to query the total
      # storage capacity. The total disk space allowed will automatically adapt to volume resize.
      # This is an experimental feature.
      percentage: 80
```

Doc note that matters operationally, verbatim:

> *"Note: When retention is changed at runtime, the retention settings are updated immediately, but block
> deletion based on the new retention policy occurs during the next block reload cycle. This happens
> automatically within 1 minute or when a compaction completes, whichever comes first."*

Related history from the CHANGELOG (verified):
- `storage.tsdb.retention.percentage` added — **3.11.0** (2026-04-02), #18080. Experimental.
- 3.11.0 bugfixes #18200: *"Fall back to CLI flag values when retention is removed from config file"*,
  *"Fix storage.tsdb.retention.time unit mismatch in file causing retention to be 1e6 times longer than
  configured"*, *"Update retention display in runtime info when config is reloaded"*.
- 3.12.0 / 3.13.0 fixed percentage retention with the new data path (#18628, #18374).

**Book guidance:** teach the config-file form as the default; mention the flags exist and are deprecated;
warn that the retention-percentage feature is experimental and had unit bugs as recently as 3.11.
The `storage.md` docs page still shows only the flags — that page lags the config reference. Flag this
discrepancy rather than repeating it.

### 3.3 Other retention-adjacent config

Also in the `<tsdb>` config block (verified v3.13.1):

```yaml
storage:
  tsdb:
    # Allow out-of-order ingestion within this window relative to TSDB max time.
    out_of_order_time_window: 0s          # default
    # Experimental: compact stale series out of memory when this ratio is crossed.
    stale_series_compaction_threshold: 0  # default; 0 disables
    chunk_encoding:
      floats: xor                          # or xor2, requires --enable-feature=xor2-encoding
```

`out_of_order_time_window` matters for Thanos/Mimir/receiver setups and for the `--agent` mode WAL.

---

## 4. When is one Prometheus not enough? (the chapter's decision spine)

Give the reader an explicit, honest ladder. Every rung is cheaper than the next.

1. **Reduce cardinality.** From the docs verbatim: *"To lower the rate of ingested samples, you can either
   reduce the number of time series you scrape (fewer targets or fewer series per target), or you can
   increase the scrape interval. However, **reducing the number of series is likely more effective**, due to
   compression of samples within a series."* Drop labels with `metric_relabel_configs`, kill unused metrics.
2. **Buy a bigger box.** A single modern Prometheus on NVMe comfortably handles millions of active series.
   This is boring and it is usually correct.
3. **Turn down retention locally + ship elsewhere** (remote_write to an LTS system). This is the modern
   default answer.
4. **Run an HA pair** — for availability, *not* for capacity.
5. **Shard by target** (hashmod) — for capacity.
6. **Federate aggregates only** — for a small global view, *not* for scaling.
7. **Adopt a horizontally scalable backend** (Thanos / Mimir / VictoriaMetrics / Cortex / managed).

**Blast radius framing (the real reason people move off one box):** WAL replay on restart is `O(data in
head)`. A 10 M-series Prometheus can take many minutes to become queryable after a restart, and it is a
single point of failure for both dashboards and alerting. Watch
`prometheus_tsdb_data_replay_duration_seconds`.

---

## 5. High availability: two identical Prometheis

### 5.1 The pattern

Run **two (or more) identically configured Prometheus servers** scraping the same targets. There is no
clustering, no leader election, no replication protocol. They are simply two independent copies.

Each replica **must** get a distinguishing external label:

```yaml
# prometheus-a.yml
global:
  scrape_interval: 15s
  external_labels:
    cluster: prod-eu
    replica: a
```

```yaml
# prometheus-b.yml
global:
  scrape_interval: 15s
  external_labels:
    cluster: prod-eu
    replica: b
```

`external_labels` are attached on the way *out* — to remote_write, to federation, to alerts sent to
Alertmanager, and to blocks uploaded by a Thanos sidecar. They are **not** attached to locally stored series,
so local queries on each replica look identical. That is exactly the property that makes dedup possible
later, and it is a genuinely confusing point for beginners — spell it out.

### 5.2 What breaks: graph flapping

This is the concrete failure the reader must see and feel:

- Put the two replicas behind a round-robin load balancer / Kubernetes Service.
- Point one Grafana data source at the VIP.
- Every panel refresh lands on a different replica. The two replicas scrape at slightly different offsets
  (they started at different times), so the newest data point and the exact sample timestamps differ.
- Result: graphs **flicker/jitter**; the last point jumps; `rate()` over short windows wobbles;
  "Last" stat panels bounce between two values; and if one replica was down for a scrape, the gap
  appears and disappears depending on which replica answered.

**Grafana does not deduplicate Prometheus replicas.** There is no setting for it. A Grafana Prometheus data
source is one HTTP endpoint; it has no concept of a replica label. Do not let the reader believe otherwise.

### 5.3 The three real fixes (in increasing order of machinery)

**(a) Sticky routing / one data source per replica.**
Simplest. Either configure the LB with session affinity so a given browser sticks to one replica, or create
two Grafana data sources (`Prometheus A`, `Prometheus B`) and switch manually when one is down. Ugly but
zero new components, and it is what small shops actually do. No dedup, but no flapping either.

**(b) Thanos Query in front of both.** Deduplicates at query time using the replica label.

```
thanos query \
    --http-address 0.0.0.0:19192 \
    --query.replica-label replica \
    --endpoint prometheus-a-sidecar:10901 \
    --endpoint prometheus-b-sidecar:10901
```

- `--query.replica-label` is **repeatable**: `--query.replica-label replica --query.replica-label replicaX`.
- Series that differ *only* by the replica label(s) are merged into one, and **gaps in one replica are
  filled from the other**. This is strictly better than sticky routing.
- `--deduplication.func` selects the algorithm (verified from thanos.io/tip/components/query.md):
  - `penalty` (**default**) — fills gaps only after a penalty window, which prevents flapping between
    replicas that are a few seconds out of step. Correct choice for classic HA Prometheus pairs.
  - `chain` — 1:1 sample dedup with no penalty window. Intended for receiver-based deployments where every
    replica holds identical data. **Does not support HA group deduplication.**
- Worked example from the Thanos docs, worth reproducing: given `cluster=1,env=2,replica=A`,
  `cluster=1,env=2,replica=B`, `cluster=2,env=2,replica=A`, a query for `up{job="prometheus",env="2"}` with
  `--query.replica-label replica` returns **two** results, not three — the two `replica=A` entries stay
  distinct because their `cluster` labels differ.
- Related: `--query.partial-response` (default `true`) returns HTTP 200 with warnings when some StoreAPIs
  time out, instead of failing the whole query.

**(c) Deduplicate on ingest, at the remote_write receiver.**

- **Mimir / Cortex / Amazon Managed Prometheus** use an **HA tracker**: it elects a leader replica per
  cluster and drops samples from the non-leader.
- **VictoriaMetrics** deduplicates by timestamp bucketing instead (see §10.3) — and there the replicas must
  have **identical** external labels, which is the *opposite* of what Thanos wants. This inversion trips up
  everyone; call it out explicitly in a table.

### 5.4 Mimir / Cortex HA tracker — exact config (verified)

Prometheus side — note the label names:

```yaml
global:
  external_labels:
    cluster: prom-team1
    __replica__: replica1     # replica2 on the other server
```

Mimir side (YAML form):

```yaml
limits:
  accept_ha_samples: true

distributor:
  ha_tracker:
    enable_ha_tracker: true
    kvstore:
      store: memberlist

memberlist:
  join_members:
    - <IP_OR_DNS:PORT>
```

Equivalent CLI flags:

```
-distributor.ha-tracker.enable=true
-distributor.ha-tracker.enable-for-all-users=true
-distributor.ha-tracker.store=memberlist          # default and recommended since Mimir 3.0
-distributor.ha-tracker.cluster=cluster           # default
-distributor.ha-tracker.replica=__replica__       # default
```

Per-tenant overrides: `ha_cluster_label`, `ha_replica_label`, `accept_ha_samples`.

Behaviour: non-leader samples are dropped and answered with **HTTP 202**. Leadership fails over if the
current leader stops sending for **~30 seconds**. The `__replica__` label is **stripped** from accepted
samples, so the stored series are identical regardless of which replica won — which is why the dashboards
don't flap. AMP exposes an "HA tracker clusters" quota of 500 per workspace, confirming it runs the same
mechanism.

### 5.5 Alertmanager HA (must be mentioned — the reader will otherwise double-page)

If both Prometheus replicas evaluate the same alert rules, **both fire**. That is by design. Deduplication of
*notifications* is Alertmanager's job, and it needs its own clustering (gossip via `--cluster.peer`), not a
load balancer. Each Prometheus should list **all** Alertmanagers in `alertmanager_configs`, and the
Alertmanagers gossip to agree on who sends the page. Cross-reference the Alertmanager chapter; do not
re-teach it here, but do warn that "HA Prometheus + single Alertmanager behind an LB" is a broken design.

---

## 6. Federation — and the official line that it is not a scaling strategy

### 6.1 What the docs actually say (verified verbatim from `docs/federation.md` @ v3.13.1)

Federation *"allows a Prometheus server to scrape selected time series from another Prometheus server."*
Two documented use cases:

- **Hierarchical federation** — *"allows Prometheus to scale to environments with tens of data centers and
  millions of nodes... many per-datacenter Prometheus servers that collect data in high detail
  (instance-level drill-down), and a set of global Prometheus servers which collect and store only
  **aggregated data (job-level drill-down)** from those local servers."*
- **Cross-service federation** — pull a *selected* few metrics from another team's Prometheus so you can
  alert/query across both datasets.

The canonical config, verbatim:

```yaml
scrape_configs:
  - job_name: 'federate'
    scrape_interval: 15s

    honor_labels: true
    metrics_path: '/federate'

    params:
      'match[]':
        - '{job="prometheus"}'
        - '{__name__=~"job:.*"}'

    static_configs:
      - targets:
        - 'source-prometheus-1:9090'
        - 'source-prometheus-2:9090'
        - 'source-prometheus-3:9090'
```

Mechanics: at least one `match[]` URL parameter is **required**; each must be an instant vector selector
(`up`, `{job="api-server"}`); multiple `match[]` values produce the **union**. `honor_labels: true` prevents
the federating server from overwriting labels exposed by the source.

Note the `{__name__=~"job:.*"}` selector in the official example — that is the `job:` recording-rule naming
convention. **The official example is literally federating recording rules, not raw series.** Point that out;
it is the strongest available textual evidence for the "aggregates only" rule.

### 6.2 Why federation is not a scaling strategy — state this plainly

**Honesty note for the author:** the current `federation.md` page does *not* contain an explicit sentence
saying "do not use federation to copy all your data." The "aggregates only" guidance is community/maintainer
consensus, reinforced by the docs' framing ("collect and store **only aggregated data**") and by the design
of the endpoint. Write it as reasoned engineering guidance backed by the doc's own wording, **not** as a
quoted prohibition. Marking this **PARTIALLY VERIFIED**.

The technical reasons (all defensible from first principles + documented behaviour):

1. **It is a scrape, so it inherits every scrape limit.** `/federate` renders the *current* value of every
   matched series into one HTTP response. Federating 1 M series means a multi-hundred-MB body every scrape
   interval. Scrape timeouts, `body_size_limit`, and memory spikes on both ends follow.
2. **You get one sample per series per scrape, not the source's history.** Federation samples at the
   *federating* server's `scrape_interval`. If the child scrapes at 15s and the parent federates at 60s, you
   silently downsample 4:1 and `rate()` gets less accurate. If the parent is down for 10 minutes, that data
   is **gone forever** — federation has no backfill.
3. **Timestamps.** `/federate` exposes the source's original timestamps. That interacts badly with staleness
   handling and out-of-order rules, and is a classic source of "why are my counters resetting."
4. **It doesn't help the child.** The child still stores everything locally with local retention. You've
   added load, not removed any.
5. **No deduplication, no global PromQL.** A federating parent cannot merge HA replicas or do a true global
   `sum()` across children without you having pre-aggregated correctly with recording rules.

**The rule to print in a box:** *Federate recording-rule output (`job:*`, `cluster:*`), a few hundred to a few
thousand series, on a modest interval. If you want all the data in one place, use `remote_write`.*

### 6.3 Federation + native histograms (new, easy to get wrong)

Verbatim note from the current doc:

> *"To scrape native histograms via federation, the scraping Prometheus server needs to set
> `scrape_native_histograms: true` in its scrape config, implying that the protobuf format is used for
> scraping. Should the federated metrics contain a mix of different sample types ... the federation payload
> will contain multiple metric families with the same name (but different types – for technical reasons,
> float samples are always federated as `untyped`, while histogram samples are federated with their full
> type information). Technically, this violates the rules of the protobuf exposition format, but Prometheus
> is nevertheless able to ingest all metrics correctly."*

Note the config key is `scrape_native_histograms`, **not** the old `--enable-feature=native-histograms`
flag — native histograms stopped being experimental in **Prometheus 3.9.0** (2026-01-06) and the feature flag
is now a no-op.

Also: NHCB (native histograms with custom buckets) support in federation was added in **3.7.0** (#17215).

---

## 7. Sharding with `hashmod` relabeling

### 7.1 The mechanism (verified)

From `docs/configuration/configuration.md` @ v3.13.1, the relabel action list:

> *`hashmod`: Set `target_label` to the `modulus` of a hash of the concatenated `source_labels`.*

And the relevant `relabel_config` fields:

```yaml
[ source_labels: '[' <labelname> [, ...] ']' ]
[ separator: <string> | default = ; ]
[ target_label: <labelname> ]
[ regex: <regex> | default = (.*) ]
[ modulus: <int> ]
[ replacement: <string> | default = $1 ]
[ action: <relabel_action> | default = replace ]
```

Also verified: *"The regex is anchored on both ends. To un-anchor the regex, use `.*<regex>.*`."* — relevant
because a naive `regex: 1` would otherwise be a substring match.

### 7.2 The canonical pattern

Every shard runs the **same config file** except for one number. Shard 0 of 4:

```yaml
scrape_configs:
  - job_name: 'node'
    file_sd_configs:
      - files: ['/etc/prometheus/targets/*.yml']
    relabel_configs:
      # 1. Hash a per-target-unique label into a temp label.
      - source_labels: [__address__]
        modulus: 4
        target_label: __tmp_hash
        action: hashmod
      # 2. Keep only the targets belonging to this shard.
      - source_labels: [__tmp_hash]
        regex: 0            # <-- 1, 2, 3 on the other shards
        action: keep
```

Notes to get right in the prose:

- **The hash function, verified from source** (`model/relabel/relabel.go` @ v3.13.1):

  ```go
  case HashMod:
      hash := md5.Sum([]byte(val))
      // Use only the last 8 bytes of the hash to give the same result as earlier versions of this code.
      mod := binary.BigEndian.Uint64(hash[8:]) % cfg.Modulus
      lb.Set(cfg.TargetLabel, strconv.FormatUint(mod, 10))
  ```

  So: **MD5** of the separator-joined source label values, take the **last 8 bytes** as a big-endian
  `uint64`, modulo `modulus`. The comment explains the odd 8-byte slice — it preserves compatibility with
  older Prometheus versions, so shard assignments are stable across upgrades. The docs only say "a hash";
  this is the real behaviour and it is worth stating, because it means **shard membership is deterministic
  and identical on every Prometheus and every version** — which is exactly why the pattern works at all.
- Also verified from the same file: `modulus` must be non-zero (`"relabel configuration for hashmod requires
  non-zero modulus"`) and `target_label` is required and must be a valid label name.
- `__tmp_hash` starts with `__`, so it is **automatically dropped** after relabeling and never becomes a
  label on the stored series. Use the `__tmp` prefix convention; the docs reserve `__tmp` for user temp
  labels.
- **Choose a source label that is unique per target.** `__address__` and `instance` are the usual picks.
  Hashing `job` would put every target of a job on one shard.
- **Changing `modulus` reshuffles everything.** Going from 4 shards to 5 moves most targets to a different
  shard, splitting each affected series' history across two Prometheis. Plan shard counts with headroom,
  or use a system with consistent hashing (Thanos Receive's `ketama`, VictoriaMetrics).

### 7.3 What sharding costs you

- **You lose global queries.** A `sum(rate(http_requests_total[5m]))` on shard 2 only covers shard 2's
  targets. You now *need* a global query layer (Thanos Query / Mimir / VM) or per-shard recording rules
  plus federation of the aggregates.
- **Alerting rules that span shards break.** Rules must either be shard-local or move to a global ruler
  (Thanos Ruler, Mimir Ruler).
- **Operational multiplication.** N shards × 2 replicas = 2N Prometheus servers to upgrade, monitor, and
  size.

**Chapter framing:** sharding is the *last* thing you do to raw Prometheus, and in 2026 most teams skip it
entirely by using agent mode + a scalable backend, which shards for you.

### 7.4 vmagent's built-in sharding (nicer ergonomics, worth a mention)

```
-promscrape.cluster.membersCount=3
-promscrape.cluster.memberNum=0            # 0..N-1
-promscrape.cluster.replicationFactor=2    # each target scraped by 2 members
```

Same idea, but the replication factor gives you HA *and* sharding in one knob, and you don't hand-edit a
regex per shard.

---

## 8. Prometheus agent mode

### 8.1 Status: STABLE

Verified from `docs/stability.md` @ v3.13.1 — under **"Things considered stable for 3.x"**, the list
literally includes:

```
* Agent mode
```

Do **not** describe agent mode as experimental. It was introduced experimentally in 2.32 (Nov 2021); it is
stable in 3.x.

### 8.2 What it is (verified from `docs/prometheus_agent.md`)

> *"The Prometheus Agent is an operational mode built into the Prometheus binary with the same scraping APIs,
> semantics, configuration, and discovery mechanism; this agent mode disables some of Prometheus' usual
> features (TSDB, alerting, and rule evaluations) and optimizes the binary for scraping and remote writing to
> remote locations."*

Enable with `--agent`. It is the same binary — no separate download.

**Benefits** (verbatim-ish): the customized Agent WAL *"removes the data immediately after successful
writes"*; if the remote endpoint is unreachable it *"persists the data temporarily on the disk until the
remote endpoint is back online. This is currently limited to a two-hour buffer only."* No in-memory chunks,
no query index.

**Downsides** (verbatim list):
- *"No local queries. You can not query the local Prometheus instance."*
- *"Recording rules are not possible."*
- *"No alerting. All alerting must be done by the remote system."*

### 8.3 Agent-specific flags (verified from the CLI reference @ v3.13.1)

```
--agent                                          Run Prometheus in 'Agent mode'.
--storage.agent.path="data-agent/"               Base path for metrics storage. Agent mode only.
--storage.agent.wal-compression                  (default true)
--storage.agent.retention.min-time=5m            Min age before WAL truncation may delete samples
--storage.agent.retention.max-time=4h            Max age before forcible deletion on WAL truncation
--storage.agent.no-lockfile                      (default false)
--storage.agent.checkpoint-from-in-memory-series (default false)
--storage.agent.checkpoint-batch-size=1000
```

Note `--storage.tsdb.path` says *"Use with server mode only"* and `--storage.agent.path` says *"Use with
agent mode only"* — the help text convention is worth teaching, since a shared flag has no such sentence.

**Documentation bug to be careful about:** `prometheus_agent.md` claims agent mode *"exposes a web UI on port
9095"*. The default `--web.listen-address` is `0.0.0.0:9090` and there is no agent-specific override flag in
the CLI reference. **Treat "9095" as a doc error — do not repeat it.** In the lab, agent mode serves its UI
on 9090 like everything else. (Marked **UNVERIFIED** in the sense that I did not run the binary; but the
flag reference contradicts the prose, and only 9090 has a documented default.)

### 8.4 When to reach for it

- Edge/branch/IoT sites that must ship metrics out but never need local dashboards.
- Kubernetes clusters where the LTS backend is central and you want minimal per-cluster footprint.
- Any "collector tier" in front of Mimir/Thanos Receive/VM/AMP/GMP.

**Alternatives to name honestly:** **Grafana Alloy** (the OTel-Collector-based successor to Grafana Agent)
and **vmagent**. See §12 for the Grafana Agent EOL fact.

---

## 9. `remote_write` — the real scaling primitive

### 9.1 Full config reference (verbatim from v3.13.1, defaults exact)

**This is the section most books get wrong.** Several defaults changed over the 2.x line and blog posts still
quote the old ones. Everything below is copied from `docs/configuration/configuration.md` at tag `v3.13.1`.

```yaml
# The URL of the endpoint to send samples to.
url: <string>

# protobuf message to use when writing to the remote write endpoint.
[ protobuf_message: <prometheus.WriteRequest | io.prometheus.write.v2.Request> | default = prometheus.WriteRequest ]

# Timeout for requests to the remote write endpoint.
[ remote_timeout: <duration> | default = 30s ]

# Custom HTTP headers to be sent along with each remote write request.
headers:
  [ <string>: <string> ... ]

# List of remote write relabel configurations.
write_relabel_configs:
  [ - <relabel_config> ... ]

[ name: <string> ]

# Enables sending of exemplars over remote write.
[ send_exemplars: <boolean> | default = false ]

# Enables sending of native histograms over remote write.
# For the `io.prometheus.write.v2.Request` message, this option is noop (always true).
[ send_native_histograms: <boolean> | default = false ]

# Experimental. Resolve the URL host via DNS and pick one IP at random.
[ round_robin_dns: <boolean> | default = false ]

sigv4:            # AWS SigV4. Cannot combine with basic_auth/authorization/oauth2/azuread.
  [ region: <string> ]
  [ access_key: <string> ]
  [ secret_key: <secret> ]
  [ profile: <string> ]
  [ role_arn: <string> ]
  [ external_id: <string> ]
  [ use_fips_sts_endpoint: <boolean> | default = false ]   # requires Prometheus >= 2.54.0

azuread:          # Azure AD. cloud / managed_identity / workload_identity / oauth / certificate / sdk / scope
  [ cloud: <string> | default = AzurePublic ]
  ...

google_iam:       # NOTE: "WARNING: Remote write is NOT SUPPORTED by Google Cloud.
  credentials_file: <file_name>   #        This configuration is reserved for future use."

queue_config:
  [ capacity: <int> | default = 10000 ]
  [ max_shards: <int> | default = 50 ]
  [ min_shards: <int> | default = 1 ]
  [ max_samples_per_send: <int> | default = 2000 ]
  [ batch_send_deadline: <duration> | default = 5s ]
  [ min_backoff: <duration> | default = 30ms ]
  [ max_backoff: <duration> | default = 5s ]
  [ retry_on_http_429: <boolean> | default = false ]      # experimental
  [ sample_age_limit: <duration> | default = 0s ]         # 0 = send everything

metadata_config:   # only used with prometheus.WriteRequest; RW2.0 always sends metadata
  [ send: <boolean> | default = true ]
  [ send_interval: <duration> | default = 1m ]
  [ max_samples_per_send: <int> | default = 500 ]         # NOTE: main branch shows 2000; v3.13.1 says 500

# HTTP client settings (basic_auth, authorization, oauth2, tls_config, proxy_url, follow_redirects, ...)
# NOTE: "enable_http2 defaults to false for remote-write."
[ <http_config> ]
```

**Defaults that are commonly mis-stated — flag these in an errata box:**

| Field | **Correct (v3.13.1)** | Wrong value you'll see in older writing |
|---|---|---|
| `queue_config.max_shards` | **50** | 200 (pre-2.32 default; also what several LLM-era blog posts still say) |
| `queue_config.max_samples_per_send` | **2000** | 500 |
| `queue_config.max_backoff` | **5s** | 100ms |
| `send_exemplars` | **false** | true |
| `enable_http2` (for remote-write) | **false** | true (it *is* true for scraping) |
| `protobuf_message` | **`prometheus.WriteRequest`** (i.e. RW **1.0** by default) | "RW2 is the default now" — it is not |

Also: `metadata_config.max_samples_per_send` is **500** on the v3.13.1 tag but **2000** on `main` — a change
in flight. Cite the released value.

Also verified: 3.12.0 added *"Config: Validate remote_write queue_config fields at load time to prevent
runtime panic and silent misconfiguration. #18209"* — so bad queue configs now fail fast.

### 9.2 How sharding works internally (great sidebar material)

From `storage/remote/queue_manager.go` @ v3.13.1:

```go
ewmaWeight             = 0.2
shardUpdateDuration    = 10 * time.Second
shardToleranceFraction = 0.3   // "Allow 30% too many shards before scaling down."
```

The desired-shard calculation (paraphrasing the real code comments):

> *"We use the number of incoming samples as a prediction of how much work we will need to do next iteration.
> We add to this any pending samples (received - send) so we can catch up with any backlog. We use the average
> outgoing batch latency to work out how many shards we need."*

with `backlogCatchup = 0.05 * dataPending` — *"When behind we will try to catch up on 5% of samples per
second."* Recalculated every **10 seconds**.

Practical consequence: **Prometheus auto-scales shards. Your job is to set the ceiling and stay out of the
way.** Official tuning guidance, verbatim: *"Unless remote writing to a very slow endpoint, it is unlikely
that `max_shards` should be increased beyond the default."* And: `capacity` *"should be 3-10 times
`max_samples_per_send`."*

### 9.3 Monitoring remote_write — exact metric names

All names verified by reading `storage/remote/queue_manager.go` and `storage/remote/write.go` @ v3.13.1.
Namespace `prometheus`, subsystem `remote_storage`. Const labels on the per-queue metrics: **`remote_name`**
and **`url`**.

```
prometheus_remote_storage_samples_total
prometheus_remote_storage_samples_failed_total
prometheus_remote_storage_samples_retried_total
prometheus_remote_storage_samples_dropped_total      # labeled by reason
prometheus_remote_storage_samples_pending
prometheus_remote_storage_exemplars_total / _failed_total / _retried_total / _dropped_total / _pending
prometheus_remote_storage_histograms_total / _failed_total / _retried_total / _dropped_total / _pending
prometheus_remote_storage_metadata_total / _failed_total / _retried_total
prometheus_remote_storage_bytes_total
prometheus_remote_storage_metadata_bytes_total
prometheus_remote_storage_enqueue_retries_total
prometheus_remote_storage_sent_batch_duration_seconds   # histogram
prometheus_remote_storage_shards
prometheus_remote_storage_shards_desired
prometheus_remote_storage_shards_min
prometheus_remote_storage_shards_max
prometheus_remote_storage_shard_capacity
prometheus_remote_storage_max_samples_per_send
prometheus_remote_storage_queue_highest_sent_timestamp_seconds
prometheus_remote_storage_queue_highest_timestamp_seconds
```

The `samples_dropped_total` `reason` label values, read from the source constants:

```
too_old
dropped_series
unintentionally_dropped_series
nhcb_in_rw1_not_supported
```

### 9.4 **DEPRECATED remote-write metrics — do not put these in the book's dashboards**

Verified from the Prometheus **3.7.0** CHANGELOG (2025-10-15), `[CHANGE]`, #17065. Verbatim:

> * `prometheus_remote_storage_samples_in_total`, use `prometheus_wal_watcher_records_read_total{type="samples"}` and `prometheus_remote_storage_samples_dropped_total` instead,
> * `prometheus_remote_storage_histograms_in_total`, use `prometheus_wal_watcher_records_read_total{type=~".*histogram_samples"}` and `prometheus_remote_storage_histograms_dropped_total` instead,
> * `prometheus_remote_storage_exemplars_in_total`, use `prometheus_wal_watcher_records_read_total{type="exemplars"}` and `prometheus_remote_storage_exemplars_dropped_total` instead,
> * `prometheus_remote_storage_highest_timestamp_in_seconds`, use the more accurate `prometheus_remote_storage_queue_highest_timestamp_seconds` instead in dashboards and alerts to properly account for relabeling and for more accuracy.

**This kills the single most-copied remote-write PromQL snippet on the internet.** The old lag expression:

```promql
# STALE — uses a deprecated metric. Do NOT print this.
prometheus_remote_storage_highest_timestamp_in_seconds
  - ignoring(remote_name, url) group_right
prometheus_remote_storage_queue_highest_sent_timestamp_seconds
```

**Current, correct form:**

```promql
# Remote write lag in seconds, per queue.
prometheus_remote_storage_queue_highest_timestamp_seconds
  - prometheus_remote_storage_queue_highest_sent_timestamp_seconds
```

Both metrics now carry the same `remote_name`/`url` labels, so no `ignoring()`/`group_right` gymnastics are
needed. That is precisely why the change was made.

Other good expressions for the book:

```promql
# Are we falling behind? (docs call this out as the key signal)
prometheus_remote_storage_samples_pending

# Failure rate
rate(prometheus_remote_storage_samples_failed_total[5m])

# Am I pinned at max shards? (if this is 1 for a sustained period, you are saturated)
prometheus_remote_storage_shards / prometheus_remote_storage_shards_max

# What is being dropped and why
sum by (reason) (rate(prometheus_remote_storage_samples_dropped_total[5m]))
```

And a sane alert:

```yaml
- alert: PrometheusRemoteWriteBehind
  expr: |
    (
      prometheus_remote_storage_queue_highest_timestamp_seconds
      - prometheus_remote_storage_queue_highest_sent_timestamp_seconds
    ) > 120
  for: 15m
  labels:
    severity: warning
  annotations:
    summary: "Remote write to {{ $labels.url }} is {{ $value | humanizeDuration }} behind."
```

### 9.5 Remote Write 2.0 — **still experimental**, be precise

Verified from the live spec page (`prometheus/docs` `main`):

```
* Version: 2.0-rc.4
* Status: **Experimental**
* Date: May 2024
```

Stabilisation is tracked in **PROM-35** (prometheus/prometheus issue **#16944**, opened 2025-07-29). As of my
check, roughly **4 of 14** checklist items are complete; remaining work includes exemplar timestamp
requirements, CT/ST integration, PRW1 metadata parity, agent-mode compatibility testing, ecosystem adoption
by Thanos/Cortex/Mimir, benchmarks, and a blog post. **No target release date is published.**

**Therefore: the book must not present RW2.0 as the default or as production-ready.** Present it as
"the next version, coming, opt-in, check your receiver first."

#### What 2.0 adds

- New mandatory Protobuf message **`io.prometheus.write.v2.Request`**, deprecating `prometheus.WriteRequest`.
- **String interning** via a deduplicated `symbols` table; all label names/values and metadata strings are
  indices into it. *"The first element of the symbols table MUST be an empty string."* This is the main
  bandwidth/CPU win.
- **Metadata** (type, help, unit) sent inline with every series rather than on a separate 1-minute cadence.
- **Start timestamps** (formerly "created timestamps"; renamed **CT → ST** per Prometheus 3.8.0 which updated
  receiving to the 2.0-rc.4 spec, #17411).
- **Native histograms** always on (`send_native_histograms` becomes a no-op).
- **Exemplars** with `trace_id`.
- Mandatory `X-Prometheus-Remote-Write-*-Written` response headers.

#### Exact wire details (verbatim from the spec)

```
Content-Encoding: snappy            # block format, not framed
```

Content types — senders MUST send one of exactly these three:

```
Content-Type: application/x-protobuf
Content-Type: application/x-protobuf;proto=prometheus.WriteRequest
Content-Type: application/x-protobuf;proto=io.prometheus.write.v2.Request
```

Guidance: *"When talking to 1.x Receivers, Senders SHOULD use `Content-Type: application/x-protobuf` for
backward compatibility. Otherwise, Senders SHOULD use
`Content-Type: application/x-protobuf;proto=io.prometheus.write.v2.Request`."*

Version header:

```
X-Prometheus-Remote-Write-Version: 0.1.0     # when talking to 1.x Receivers (MUST)
X-Prometheus-Remote-Write-Version: 2.0.0     # otherwise (SHOULD, newest compatible)
```

Required response headers on success:

```
X-Prometheus-Remote-Write-Samples-Written    <count>
X-Prometheus-Remote-Write-Histograms-Written <count>
X-Prometheus-Remote-Write-Exemplars-Written  <count>
```

Success semantics: *"the status code SHOULD be 204 HTTP No Content"* with an empty body.

**The broken-1.0-receiver detection trick** (great sidebar — verbatim):

> *"Senders SHOULD assume 415 HTTP Unsupported Media Type status code when sending the data using
> `io.prometheus.write.v2.Request` request and receiving 2xx HTTP status code, but none of the
> `X-Prometheus-Remote-Write-*-Written` response headers from the Receiver. This is a common issue for the
> 1.0 Receivers that do not check the `Content-Type` request header; accidental decoding of the
> `io.prometheus.write.v2.Request` payload with `prometheus.WriteRequest` schema results in empty result and
> no decoding errors."*

Translation for the reader: **if you flip `protobuf_message` to v2 against an old receiver, your data can
silently vanish with HTTP 200s.** That is the single most useful practical warning in this whole section.

#### Error/retry semantics (verbatim rules)

- **415** if the receiver doesn't support the content type or encoding. Senders MAY retry with a different
  content type.
- **400** for invalid samples. Senders **MUST NOT** retry on 4xx other than 429.
- **429** for overload; receivers MAY include `Retry-After`. Senders **MAY** retry.
- **5xx** — Senders **MUST** retry, with backoff.
- Partial writes: receivers MUST return non-2xx; may return 5xx/429 if they want a whole-request retry, in
  which case *"the Receiver MUST support idempotency."*

Note the Prometheus-side default `retry_on_http_429: false` — i.e. by default Prometheus **drops** on 429
rather than retrying. Worth an explicit paragraph, because managed backends (AMP especially) throttle with
429.

#### Trying it out

```yaml
remote_write:
  - url: http://receiver:9090/api/v1/write
    protobuf_message: io.prometheus.write.v2.Request
```

Receiver side:

```
--web.enable-remote-write-receiver
--web.remote-write-receiver.accepted-protobuf-messages=prometheus.WriteRequest,io.prometheus.write.v2.Request
```

(Default for that flag is `prometheus.WriteRequest` only — verified from the CLI reference. So a
Prometheus-as-receiver lab **will 415** on v2 until you add the flag. Excellent, reproducible teaching
moment.)

`promtool push metrics --protobuf_message ...` gained RW2.0 support in **3.8.0** (#17417) — handy for a lab
exercise without writing code.

### 9.6 What receivers exist

Verified list of things that accept the Prometheus remote-write protocol (from the projects' own docs):

| Receiver | Endpoint / notes |
|---|---|
| **Prometheus itself** | `--web.enable-remote-write-receiver` → `POST /api/v1/write` |
| **Thanos Receive** | remote-write API, hashring-distributed, uploads blocks to object storage |
| **Grafana Mimir** | distributor endpoint (`/api/v1/push`) |
| **Cortex** | distributor `/api/v1/push` |
| **VictoriaMetrics** | `/api/v1/write` on single-node `:8428` or on `vminsert` |
| **Grafana Cloud** | hosted Mimir endpoint |
| **Amazon Managed Service for Prometheus** | `.../api/v1/remote_write`, SigV4-signed |
| **Google Cloud Managed Service for Prometheus** | **NOT via remote_write** — see the explicit warning in the `google_iam` config block: *"WARNING: Remote write is NOT SUPPORTED by Google Cloud. This configuration is reserved for future use."* Use the GMP collectors / OTel instead. |
| **Grafana Alloy / OTel Collector** | `prometheusremotewrite` receiver+exporter |
| Various TSDBs | InfluxDB, TimescaleDB/Promscale (**archived**, see §12), GreptimeDB, ClickHouse adapters, M3 (**dormant**) |

Full list: prometheus.io/docs/operating/integrations/#remote-endpoints-and-storage.

**Book note:** the GMP remote-write warning is a real trap. Many readers on GCP will assume the AMP pattern
transfers. It does not.

### 9.7 `remote_read` — teach it, then tell them not to build on it

Config reference verbatim @ v3.13.1:

```yaml
url: <string>
[ name: <string> ]
required_matchers:
  [ <labelname>: <labelvalue> ... ]
[ remote_timeout: <duration> | default = 1m ]
headers:
  [ <string>: <string> ... ]
[ read_recent: <boolean> | default = false ]
[ filter_external_labels: <boolean> | default = true ]
[ <http_config> ]
```

Why it is a dead end — verbatim from `storage.md`:

> *"Note that on the read path, Prometheus only fetches raw series data for a set of label selectors and time
> ranges from the remote end. **All PromQL evaluation on the raw data still happens in Prometheus itself.**
> This means that remote read queries have some scalability limit, since all necessary data needs to be
> loaded into the querying Prometheus server first and then processed there. However, supporting fully
> distributed evaluation of PromQL was deemed infeasible for the time being."*

And from `stability.md`, under **unstable for 3.x**:

```
* Remote read and the remote read endpoint
```

So: remote_read is **not** a stable API, it does not push down aggregation, and a `sum(rate(...[5m]))` over a
year will try to stream a year of raw samples into your local Prometheus. Its legitimate uses are narrow:
migration/backfill reads, and `required_matchers` + `read_recent: false` to blend a small remote dataset.

**This is why Thanos/Mimir/VM all expose a Prometheus-compatible *query* API (`/api/v1/query_range`) instead
and you point Grafana at them directly.** Make that the punchline.

Security note: remote-read has had CVEs — **CVE-2026-42154** (3.11.3, snappy decode bomb) and a related
32 MB decode cap in 3.12.0 for remote-write (#18642). If you expose a read endpoint, put it behind a proxy.

---

## 10. The long-term storage systems — a fair 2026 comparison

### 10.0 The shared idea (explain this once, before the four sections)

All four projects solve the same problem the same way at the bottom of the stack:

1. Get data off the Prometheus box — either by **shipping its 2-hour TSDB blocks to object storage**
   (S3/GCS/Azure Blob/MinIO), or by **receiving remote_write** into their own ingesters that then flush
   blocks to object storage.
2. Put a **stateless query layer** in front that reads recent data from memory/ingesters and older data from
   object storage, merges the two, and speaks the Prometheus HTTP query API.
3. **Compact and downsample** the object-storage data in the background so year-long queries are cheap.

Object storage is the trick. It is effectively infinite, cheap, durable, and someone else's problem.
Everything else is engineering around the fact that object storage has high latency and no indexes.

For a reader who's never done this: **you point Grafana at the query layer instead of at Prometheus, and
everything else stays the same.** PromQL is PromQL.

### 10.1 Thanos — v0.42.2, CNCF Incubating, Apache-2.0

**Architecture in one paragraph.** Thanos bolts onto Prometheus rather than replacing it. A **Sidecar** runs
next to each Prometheus, serves its recent data over a gRPC **StoreAPI**, and uploads completed 2-hour blocks
to object storage. A **Store Gateway** exposes the object-storage blocks over the same StoreAPI. A stateless
**Query** component fans out to every StoreAPI, merges and **deduplicates** the results, and serves the
Prometheus HTTP API — so Grafana just points at it. A **Compactor** (singleton per bucket) compacts and
downsamples blocks in the background. Optional: **Query Frontend** (splitting + result caching), **Ruler**
(global recording/alerting rules), and **Receive** (a remote_write endpoint, for push-based or
multi-tenant setups where you can't run a sidecar).

**Key commands (verified):**

```
thanos sidecar   --prometheus.url=http://localhost:9090 --tsdb.path=/prometheus \
                 --objstore.config-file=bucket.yml
thanos store     --data-dir /var/thanos/store --objstore.config-file bucket_config.yaml
thanos query     --http-address 0.0.0.0:19192 --query.replica-label replica \
                 --endpoint 1.2.3.4:10901
thanos compact   --wait --wait-interval=5m --objstore.config-file bucket_config.yaml
```

**Sidecar requirements — the classic footgun:**
- Prometheus must have `--storage.tsdb.min-block-duration` **equal to** `--storage.tsdb.max-block-duration`
  (both `2h`) so that Prometheus does **not** locally compact blocks the sidecar has already uploaded.
- **NEW and worth highlighting:** Prometheus **3.9.0** added `--storage.tsdb.delay-compact-file.path`
  (#17435) *"Path to a JSON file with uploaded TSDB blocks e.g. Thanos shipper meta file. If set TSDB will
  only compact 1 level blocks that are marked as uploaded in that file, improving external storage
  integrations e.g. with Thanos sidecar."* This is the modern, cleaner alternative to disabling compaction
  outright. Mention it — it is genuinely new and almost nothing written before 2026 knows about it.
- Prometheus `external_labels` must be **unique per instance** across the whole Thanos system.
- Keep local retention *"not lower than three times of the min block duration, so 6 hours."*
- `--web.enable-admin-api` (for the snapshot path) and `--web.enable-lifecycle` (for reload) as needed.
- `--shipper.upload-compacted` for one-time migration of pre-existing compacted blocks.

**Downsampling & retention (Compactor):**

```
--retention.resolution-raw=0d    # 0d == keep forever (default)
--retention.resolution-5m=0d
--retention.resolution-1h=0d
```
Raw → **5m** resolution once older than **40 hours**; 5m → **1h** resolution once older than **10 days**.
Downsampled chunks store `raw, count, sum, min, max, counter` aggregates.

**The Compactor warning that must be a box in the book:** only **one** Compactor may run against a single
stream of blocks. Object stores lack safe locking. Running two corrupts data by merging blocks in ways that
*"there is currently no easy way to split them back."* Also: *"if retention at each resolution is lower than
minimum age for successive downsampling, data will be deleted before downsampling completes."*

**Vertical compaction / dedup at compaction time:** `--deduplication.replica-label=<label>` plus
`--deduplication.func=penalty` merges HA replica blocks so you stop paying storage twice. Off by default and
historically risky — mention, don't recommend for beginners.

**Thanos Receive** (push mode): implements remote-write, distributes series across nodes via a hashring file
(`--receive.hashrings-file`) using **ketama** (recommended; stable when scaling) or **hashmod**
(discouraged; causes *"series churn and memory usage spikes"* on scale events).
`--receive.replication-factor` (RF=2 → quorum 1, RF=3 → quorum 2),
`--receive.tenant-header` (default `THANOS-TENANT`), `--label receive_cluster="eu1"`, `--tsdb.retention`
(here it also controls tenant decommissioning: a tenant with no new samples for longer than the retention is
flushed and dropped). Uploads blocks **every 2 hours** by default.

**Pick Thanos when:** you already run Prometheus servers you're happy with and want to *add* long-term
storage and a global view with the least disruption; you want a component-by-component, incrementally
adoptable system; you like Apache-2.0 and CNCF governance; you're fine with one more sidecar per Prometheus.

**Don't pick Thanos when:** you want a single thing to operate; you need strong multi-tenancy with per-tenant
limits out of the box; your Prometheus servers are ephemeral or unreachable (then Receive, or something else).

### 10.2 Grafana Mimir — mimir-3.1.4, AGPL-3.0

**Architecture in one paragraph.** Mimir is a Cortex fork that replaces Prometheus's storage entirely: you
`remote_write` into it and you query it. A **distributor** validates incoming series, applies per-tenant
limits and HA-tracker dedup, and shards them across **ingesters** via a hash ring; ingesters hold recent data
and periodically flush TSDB blocks to object storage. A **querier** merges ingester data with blocks read via
the **store-gateway**; a **query-frontend** (plus optional **query-scheduler**) splits, shards and caches
queries. A **compactor** compacts and deduplicates blocks in object storage. Optional **ruler**,
**alertmanager** and **overrides-exporter** complete the set. Everything is multi-tenant by default (an
`X-Scope-OrgID` header).

**Deployment modes — this changed in 3.0, and it matters:**
- **Monolithic**: `-target=all`, everything in one process. Good for dev/small.
- **Microservices**: `-target=ingester`, `-target=distributor`, etc. Recommended for production, usually via
  the `mimir-distributed` Helm chart.
- **Read-write mode is GONE.** Removed in **Mimir 3.0** as part of the removal of deprecated/experimental
  features. Any book or blog describing the three-mode model is out of date.

**What's new in Mimir 3.0 (verified from Grafana's own release blog):**
- **Kafka-based ingest storage**: an asynchronous buffer between ingestion and query, so heavy queries no
  longer degrade ingestion and vice versa; read and write paths scale independently. Called a "decoupled
  architecture."
- **Mimir Query Engine (MQE)** became the **default** in 3.0 (introduced in 2.17). Streaming rather than
  bulk evaluation; Grafana claims *"reduces peak memory usage by up to 92%"* and it is *"100%
  PromQL-compatible."*
- Claimed ~15% lower resource usage in large internal clusters.
- Upgrading is non-trivial: Grafana's own guidance is to plan early and run two clusters during migration.
  **Do not present a 2.x→3.x Mimir upgrade as routine.**

**Pick Mimir when:** you want one system that owns metrics end-to-end; you need real multi-tenancy with
per-tenant limits and quotas; you're already in the Grafana LGTM ecosystem; you're deploying on Kubernetes
with Helm; you want the same engine that powers Grafana Cloud.

**Don't pick Mimir when:** AGPL-3.0 is a problem for your legal team; you can't or won't run Kubernetes + now
possibly Kafka; you want to keep your existing Prometheus servers as the source of truth; you're a small team
— Mimir's floor of operational complexity is genuinely higher than Thanos's or VictoriaMetrics'.

### 10.3 VictoriaMetrics — v1.148.0, Apache-2.0

**Architecture in one paragraph.** VictoriaMetrics is a from-scratch TSDB (not a Prometheus fork, not
block-on-object-storage) that speaks Prometheus's ingestion and query APIs. The **single-node** binary is
literally one process with one data directory, and its own docs say it handles *"1.5+ million samples per
second"* and *"50+ million active time series"* in production case studies. When you outgrow it, the
**cluster** version splits into three stateless-ish services: **vminsert** (accepts writes, spreads them over
storage nodes by consistent hashing), **vmstorage** (holds data, shared-nothing), and **vmselect** (fans out
queries). Supporting components: **vmagent** (scraper/forwarder with disk buffering, sharding and stream
aggregation), **vmalert** (rule evaluation), **vmauth** (auth + LB). It stores on ordinary block storage, not
object storage, and queries in **MetricsQL** — a superset of PromQL.

**Ingestion protocols accepted** (verified): Prometheus remote write, **OTLP** (`/opentelemetry/v1/metrics`),
InfluxDB line protocol, Graphite, OpenTSDB `/api/put`, DataDog v1/v2, CSV, JSON lines. That breadth is a real
differentiator.

**Retention** (verified, and *different from everything else*):
- `-retentionPeriod` takes a number + unit `h/d/w/M/y`. **No unit means months.** Default **1M (31 days)**.
  Minimum **24h**. `-retentionPeriod=3` means *three months*, not three days. This trips people constantly.
- Data is in per-month partitions; *"Data partitions outside the configured retention are deleted **on the
  first day of the new month**."* Max disk usage for a given retention is `(retentionPeriod + 1) months`.
- No indefinite retention, but `-retentionPeriod=100y` works.
- `-futureRetention` (default rejects samples > `now+2d`), `-maxBackfillAge`.
- Per-series retention filters are **Enterprise-only**.

**Deduplication — the mechanism is completely unlike Thanos/Mimir** (verbatim from the README):

> *"VictoriaMetrics leaves a single raw sample with the biggest timestamp for each time series per each
> `-dedup.minScrapeInterval` discrete interval... If multiple raw samples have **the same timestamp** on the
> given `-dedup.minScrapeInterval` discrete interval, then the sample with **the biggest value** is kept.
> Numerical values are preferred over stale markers."*

Critical consequences, all verbatim or near-verbatim from the docs:
- *"labels of raw samples should be identical in order to be deduplicated"* — so an HA pair must have
  **identical `external_labels`**. **This is the exact opposite of the Thanos requirement.** Put this in a
  comparison table; it is the highest-value gotcha in the whole LTS section.
- *"The recommended value for `-dedup.minScrapeInterval` must equal to `scrape_interval` config from
  Prometheus configs."*
- Must be **consistent across all `vmselect` and `vmstorage`** nodes.
- `-dedup.minScrapeInterval=D` is equivalent to `-downsampling.period=0s:D`.
- Samples are **all stored on disk anyway**; dedup happens during background merges and at query time.
  `-streamAggr.dedupInterval` dedups *before* writing to disk.
- For HA vmagent pairs, pass **different `-promscrape.cluster.name`** values so dedup consistently prefers
  one instance.

**HA model:** two identically configured VictoriaMetrics instances in different AZs, both written to
simultaneously (multiple `-remoteWrite.url` on vmagent, or multiple `remote_write` entries in Prometheus),
with **vmauth** failing queries over. Cluster HA additionally uses `-replicationFactor=N` on vminsert/vmselect.

```sh
/path/to/vmagent \
  -remoteWrite.url=http://<vm-az1>:8428/api/v1/write \
  -remoteWrite.url=http://<vm-az2>:8428/api/v1/write
```

```yaml
remote_write:
  - url: http://<vm-az1>:8428/api/v1/write
  - url: http://<vm-az2>:8428/api/v1/write
```

**Capacity guidance (verbatim from the docs, refreshingly concrete):** leave *"50% of free RAM"*, *"50% of
spare CPU"*, *"at least 20% of free storage space"*. Extrapolate disk from a test run:
*"if `-storageDataPath` directory size becomes 10GB after a day-long test run ... then it will need at least
`10GB*100=1TB` of disk space for `-retentionPeriod=100d`."*

**Pick VictoriaMetrics when:** you want the least operational surface area for the most capacity; you want a
single binary you can actually run on one VM; you want cheap; you need non-Prometheus ingestion protocols;
you don't want to think about object storage.

**Don't pick VictoriaMetrics when:** you need 100.000% bit-exact PromQL semantics (MetricsQL is a superset
and has some deliberate behavioural differences, e.g. around `rate()` extrapolation and default lookbacks —
mostly nicer, but *different*); you want CNCF-vendor-neutral governance (VM is a single-vendor project); you
need features that turn out to be Enterprise-gated (downsampling, retention filters, multi-tenant auth
niceties, LTS release lines).

**LTS note (verified):** LTS *release lines* are an **Enterprise** offering. Currently supported lines are
**v1.148.x** and **v1.136.x**; each line gets fixes for 12 months, new lines every 6 months. OSS users are
told to track latest.

### 10.4 Cortex — v1.21.1, CNCF Incubating, Apache-2.0 — **and it is not dead**

**Architecture in one paragraph.** Cortex is the original horizontally scalable, multi-tenant, long-term
Prometheus, started by Tom Wilkie and Julius Volz in **June 2016**. Its component model is the one Mimir
inherited: distributor → ingester (hash ring) → object-storage blocks, with querier, query-frontend,
store-gateway, compactor and ruler. It now also positions itself for OpenTelemetry metrics.

**Status — correct the record.** The widely repeated 2022-era narrative is "Grafana forked Cortex into Mimir,
Cortex is in maintenance mode, don't use it." That was reasonable in 2022. Verified facts today:

- CNCF page: *"Cortex was accepted to CNCF on September 20, 2018 and moved to the **Incubating** maturity
  level on August 20, 2020."* **Not archived.**
- Releases: **v1.21.0** (2026-04-27), **v1.21.1** (2026-06-05). Repository `pushed_at` 2026-07-28.
- README references KubeCon talks from 2025–2026.
- Grafana Labs genuinely stopped contributing in 2022; Tom Wilkie and Bryan Boreham are listed as
  **Emeritus Maintainers**. Development continued under new maintainers (heavily AWS-adjacent, since Amazon
  Managed Service for Prometheus is built on Cortex — the AMP HA-tracker quota confirms the lineage).

**Pick Cortex when:** honestly, rarely, for a greenfield self-hosted deployment — Mimir and VictoriaMetrics
have more momentum. It is a legitimate choice if you specifically want Apache-2.0 (not AGPL) *and* the
Cortex/Mimir architecture *and* CNCF governance, or if you're already running it.

**What the book should say:** "Cortex is the ancestor of Mimir. It is still CNCF Incubating and still
releasing — as recently as June 2026 — but Grafana Labs moved to Mimir in 2022 and most new self-hosted
deployments choose Mimir, VictoriaMetrics or Thanos. If you meet Cortex in the wild it's most likely inside
Amazon Managed Service for Prometheus." That is accurate and doesn't repeat the obituary.

### 10.5 One-screen comparison table (draft for the book)

| | **Thanos** | **Mimir** | **VictoriaMetrics** | **Cortex** |
|---|---|---|---|---|
| Version (2026-07) | v0.42.2 | 3.1.4 | v1.148.0 | v1.21.1 |
| License | Apache-2.0 | AGPL-3.0 | Apache-2.0 (OSS) | Apache-2.0 |
| Governance | CNCF Incubating | Grafana Labs | VictoriaMetrics (single vendor) | CNCF Incubating |
| Relationship to Prometheus | **Adds on** to existing Prometheis | **Replaces** storage | **Replaces** storage | **Replaces** storage |
| Primary ingest | Sidecar uploads blocks (or Receive: remote_write) | remote_write | remote_write + many others | remote_write |
| Storage | Object storage | Object storage | Local disk | Object storage |
| Query language | PromQL | PromQL (MQE) | **MetricsQL** (PromQL superset) | PromQL |
| HA dedup mechanism | Query-time, `--query.replica-label`, replicas need **different** replica label | HA tracker leader election, `cluster` + `__replica__` | Timestamp bucketing, replicas need **identical** labels | HA tracker (same as Mimir) |
| Downsampling | Yes (5m, 1h), OSS | Yes | **Enterprise only** | Yes |
| Multi-tenancy | Via Receive | First-class | Cluster version (`accountID`/`projectID`) | First-class |
| Smallest sane deployment | Prometheus + sidecar + store + query + compact | `-target=all` single process | **one binary** | ~5 components |
| Sweet spot | Keep your Prometheis, add global view + LTS | Large multi-tenant platform team | Best resource efficiency / lowest ops | Legacy / AMP under the hood |

**Note on the "smallest sane deployment" row:** this is the row that matters most to our reader. Say plainly
that if they just want their metrics to survive longer than 15 days and they have one team, **single-node
VictoriaMetrics or Prometheus with longer retention on a bigger disk** is very likely the right answer, and
the rest of this chapter is about the day that stops being true.

---

## 11. Managed options

### 11.1 Grafana Cloud

- Hosted Grafana + hosted metrics/logs/traces. The metrics backend is Grafana's own **Mimir** (Grafana
  markets Mimir as the engine behind Grafana Cloud Metrics; the docs page I fetched did not state it in so
  many words, so **PARTIALLY VERIFIED** — phrase as "Grafana Cloud Metrics is built on Mimir" only if you're
  comfortable, otherwise "Grafana's hosted metrics service").
- Ingestion protocols (verified from grafana.com/docs/grafana-cloud/send-data/metrics/): **Prometheus
  remote_write**, **OTLP**, **Graphite**, **InfluxDB**, **Datadog**.
- Retention: the docs reference a **13-month** metrics retention as the standard paid figure.
- **Free tier:** the official free-tier page states *"Generous usage limits and 14-day retention"* and
  *"14 days retention for metrics, logs, traces, profiles, & k6 performance tests"* but **does not publish
  the numeric series limit on that page**. Third-party trackers say 10,000 active series. **Mark the
  10k figure UNVERIFIED and either omit it or write "on the order of ten thousand active series — check the
  current free-tier page, these limits change."** Do not print a hard number that will be wrong by
  publication.
- Collector: **Grafana Alloy**.

### 11.2 Amazon Managed Service for Prometheus (AMP)

Fully verified against the AWS quotas page — this is the most concretely documented managed option and the
numbers make excellent textbook material.

- Built on **Cortex** (strongly implied by the "HA tracker clusters" quota and project history).
- Ingest: `remote_write` to `.../api/v1/remote_write`, **SigV4-signed** (hence Prometheus's `sigv4:` block).
  Also an AWS-managed agentless scraper.
- Query: Prometheus-compatible API; works as a Grafana data source with SigV4 auth.
- Managed **Alertmanager** and managed **rules**.
- **Retention: 150 days by default**, configurable **from 1 day up to 1095 days (3 years)**.
  *(Retention figures from AWS "what's new"/roadmap sources — the numbers page I fetched covers quotas;
  mark the 150/1095 figures as verified-by-secondary and re-check at typesetting.)*
- **Query time range limit: 95 days** (raised from 32 days in 2025). Note the asymmetry: you can *store* 3
  years but a single query can only span 95 days.

Verified quota highlights (all "per workspace, per Region"):

| Quota | Default | Adjustable |
|---|---|---|
| Active series per workspace | **50,000,000** (max 1.5 billion) | Yes |
| Ingestion rate per workspace | **1,666,666 samples/sec** (auto-set to 1/30 of the series limit) | Yes |
| Native histogram active series | 5,000,000 (10% of series limit) | Yes |
| Labels per metric series | 150 | Yes |
| Label size (all labels combined) | 7 KB | No |
| Rules per workspace | 2,000 | Yes |
| Min rule evaluation interval | 30 s | Yes |
| Query samples scanned | 50,000,000 | No |
| Query series fetched | 12,000,000 | No |
| Query bytes scanned | 5 GB | No |
| Query time range | 95 days | No |
| Request size (ingest or query) | 1 MB | No |
| HA tracker clusters | 500 | No |
| Workspaces per region per account | 25 | Yes |

Behavioural facts worth teaching:
- *"A series is active if a sample has been reported in the past 2 hours."* Good, concrete definition of
  "active series" — steal it for the sizing section.
- Capacity **auto-scales**: below 5 M usage the capacity doubles; above 5 M it adds a 10 M buffer. Minimum
  capacity 2 M with no throttling below that.
- Throttling is a **token bucket**. Exceeding it produces `DiscardedSamples` in CloudWatch with reason
  `rate_limited`. Crucially: *"Ingestion happens in batched requests. If you have 100 tokens available, and
  send a request with 101 samples, the entire request is rejected. AMP does not partially accept requests."*
- *"Metric samples older than 1 hour are refused from being ingested."* → Combined with Prometheus's default
  `retry_on_http_429: false`, a long AMP outage silently loses data. This is a genuinely important, concrete
  operational lesson. Recommend `retry_on_http_429: true` and a `sample_age_limit` when writing to AMP.

### 11.3 Google Cloud Managed Service for Prometheus (GMP)

- *"a fully managed, multi-cloud, cross-project solution for Prometheus and OpenTelemetry metrics."*
- Backed by **Monarch**, Google's internal global monitoring datastore. This is architecturally quite
  different from the block-storage designs — it's a purpose-built globally distributed TSDB.
- **Retention: 24 months at no additional cost.** Storage tiering is automatic and worth stating precisely:
  **full granularity for 1 week, then downsampled to 1-minute for 5 weeks, then 10-minute intervals
  thereafter.** That is a nice concrete illustration of the downsampling concept.
- Four collection options:
  - **Managed collection** (recommended on GKE) — a Google-run operator, configured via lightweight CRDs
    (`PodMonitoring`, `ClusterPodMonitoring`).
  - **Self-deployed collection** — a drop-in replacement Prometheus binary you run yourself; reuse existing
    scrape configs; supports local rule evaluation at the edge.
  - **OpenTelemetry Collector** — push-based, unified metrics/logs/traces.
  - **Ops Agent** — for Compute Engine VMs.
- Query: PromQL over everything, including **6,500+ free Cloud Monitoring metrics**; works with unmodified
  Grafana dashboards via a Prometheus-API frontend.
- **Critical difference from AMP: no `remote_write` ingestion.** Prometheus's own config docs carry the
  warning *"Remote write is NOT SUPPORTED by Google Cloud. This configuration is reserved for future use."*
  Readers must use the GMP collectors or OTel.

### 11.4 Also exists (mention in one line each, don't expand)

Azure Monitor managed Prometheus, Chronosphere, Last9, Levitate, New Relic / Datadog / Dynatrace
Prometheus-compatible endpoints, Grafana Cloud's competitors generally. None need chapter space.

---

## 12. Security basics — "Prometheus has no auth by default"

### 12.1 The security model (verified, quote these)

From prometheus.io/docs/operating/security/:

> *"It is presumed that untrusted users have access to the Prometheus HTTP endpoint and logs. They have
> access to all time series information contained in the database, plus a variety of operational/debugging
> information."*

> *"Prometheus, as a monitoring system, collects and serves information about the systems it is monitoring.
> Therefore, the HTTP endpoints provided by Prometheus components **should not be exposed to publicly
> accessible networks like the internet**."*

> *"It is also presumed that only trusted users have the ability to change the command line, configuration
> file, rule files and other aspects of the runtime environment."*

> *"Fields containing secrets in configuration files (marked explicitly as such in the documentation) will
> not be exposed in logs or via the HTTP API."* — but *metrics themselves are not considered secret*.

> *"We do not consider pure denial of service issues to be security vulnerabilities requiring private
> disclosure."*

**Plain-English translation for the reader:** out of the box, anyone who can reach `:9090` can read every
metric you have, list your targets and service discovery, read your rules and (redacted) config, and run
arbitrary expensive PromQL. There is no login page. **There has never been a login page.**

### 12.2 The two dangerous flags

Both default to `false` (verified from the CLI reference):

```
--web.enable-lifecycle      # POST /-/reload and POST /-/quit
--web.enable-admin-api      # /api/v1/admin/tsdb/{delete_series,clean_tombstones,snapshot}
```

`--web.enable-admin-api` lets anyone who can reach the port **delete your time series**. Turn on only what
you need, and never on a reachable-from-anywhere port.

Also relevant, defaults `false`:

```
--web.enable-remote-write-receiver
--web.enable-otlp-receiver
```

Enabling a receiver without a proxy in front means anyone can inject arbitrary metrics into your TSDB.

### 12.3 `--web.config.file` — built-in TLS and basic auth

**Status: EXPERIMENTAL.** Two independent confirmations:
- `docs/configuration/https.md` opens with: *"Prometheus supports basic authentication and TLS. This is
  **experimental** and might change in the future."*
- `docs/stability.md` lists under **unstable for 3.x**: *"Server-side HTTPS and basic authentication"*.
- The CLI reference labels the flag `[EXPERIMENTAL] Path to configuration file that can enable TLS or
  authentication.`

Useful property, verbatim: *"The file is read upon every http request, such as any change in the
configuration and the certificates is picked up immediately."* — no restart needed to rotate certs or add
users. That's genuinely nice and worth mentioning.

**The official example file, verbatim** (`documentation/examples/web-config.yml` @ v3.13.1):

```yaml
# TLS and basic authentication configuration example.
#
# Additionally, a certificate and a key file are needed.
tls_server_config:
  cert_file: server.crt
  key_file: server.key

# Usernames and passwords required to connect to Prometheus.
# Passwords are hashed with bcrypt: https://github.com/prometheus/exporter-toolkit/blob/master/docs/web-configuration.md#about-bcrypt
basic_auth_users:
  alice: $2y$10$mDwo.lAisC94iLAyP81MCesa29IzH37oigHC/42V2pdJlUprsJPze
  bob: $2y$10$hLqFl9jSjoAAy95Z/zw8Ye8wkdMBM8c5Bn1ptYqP/AXyV0.oy0S8m
```

**Full schema (verbatim, abridged to the interesting keys):**

```yaml
tls_server_config:
  cert_file: <filename>
  key_file: <filename>
  # NOTE: If you want to enable client authentication, you need to use
  # RequireAndVerifyClientCert. Other values are insecure.
  [ client_auth_type: <string> | default = "NoClientCert" ]
  [ client_ca_file: <filename> ]
  [ client_allowed_sans: [ - <string> ] ]
  [ min_version: <string> | default = "TLS12" ]
  [ max_version: <string> | default = "TLS13" ]
  [ cipher_suites: [ - <string> ] ]
  [ prefer_server_cipher_suites: <boolean> | default = true ]
  [ curve_preferences: [ - <string> ] ]

http_server_config:
  # Note that HTTP/2 is only supported with TLS.
  [ http2: <boolean> | default = true ]
  [ headers:
    [ Content-Security-Policy: <string> ]
    [ X-Frame-Options: <string> ]          # deny | sameorigin
    [ X-Content-Type-Options: <string> ]   # nosniff
    [ X-XSS-Protection: <string> ]
    [ Strict-Transport-Security: <string> ] ]

basic_auth_users:
  [ <string>: <secret> ... ]     # bcrypt hashes
```

Generating a hash (worth a lab step):

```bash
htpasswd -nBC 10 "" | tr -d ':\n'
# or:
python3 -c 'import bcrypt,getpass;print(bcrypt.hashpw(getpass.getpass().encode(),bcrypt.gensalt(10)).decode())'
```

**Same file works for Alertmanager, node_exporter, and most official exporters** — they all share
`prometheus/exporter-toolkit`. That's a good "one thing you learn, five places you use it" note.

**What it does NOT give you:** roles, per-endpoint authorization, read-only users, SSO/OIDC, audit logging,
rate limiting, or a way to say "this user may query but may not hit `/api/v1/admin`". Basic auth is
all-or-nothing per server.

### 12.4 The reverse proxy reality

For anything beyond a single shared password, put a reverse proxy in front. This is the mainstream answer and
the book should say so without apology.

What a proxy buys you that Prometheus can't: OIDC/SSO, per-path rules (block `/api/v1/admin/*`, allow
`/api/v1/query`), rate limiting, request logging/audit, mTLS termination, and a place to put a WAF.

Minimal nginx sketch for the lab:

```nginx
server {
  listen 443 ssl;
  server_name prometheus.internal.example.com;

  ssl_certificate     /etc/nginx/tls/tls.crt;
  ssl_certificate_key /etc/nginx/tls/tls.key;

  auth_basic           "Prometheus";
  auth_basic_user_file /etc/nginx/htpasswd;

  # Never expose the admin API through the proxy.
  location /api/v1/admin/ { return 403; }
  location /-/reload      { return 403; }
  location /-/quit        { return 403; }

  location / {
    proxy_pass http://prometheus:9090;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

If Prometheus lives at a subpath behind the proxy, set `--web.external-url` (and possibly
`--web.route-prefix`) or the UI's generated links will be wrong. Note the 3.7.0 bugfix
*"UI: Fix redirect to path of `-web.external-url` if `-web.route-prefix` is configured"* (#17240) — this
combination has historically been buggy.

Also set `--web.cors.origin` (default `.*` — i.e. **wide open**) if a browser app will call the API.

### 12.5 Security posture of the LTS layer

Say this once, plainly: **Thanos, Mimir, Cortex and VictoriaMetrics components are, by default, also
unauthenticated.** Thanos Query has no auth. Mimir trusts the `X-Scope-OrgID` header — *anyone who can reach
the distributor can write to any tenant*. VictoriaMetrics ships `vmauth` precisely because the core
components have none. Every one of these needs network isolation plus a proxy or gateway.

### 12.6 Recent CVEs worth mentioning as "keep it patched" evidence

All from the verified CHANGELOG:
- **CVE-2026-44990** (3.13.0) — XSS in the UI via `sanitize-html`.
- **CVE-2026-42151** (3.11.3) — AzureAD remote-write `client_secret` exposed in plaintext via `/-/config`.
- **CVE-2026-42154** (3.11.3) — remote-**read** snappy decompression bomb.
- **CVE-2026-40179** (3.11.2) — stored XSS via crafted metric names/label values in UI tooltips.
- 3.12.0 — remote-**write** snappy decode limited to 32 MB; STACKIT SD secrets exposed via `/-/config`.
- 3.13.0 `[CHANGE]` — *"Credentials ... are no longer forwarded when following a redirect to a different
  host; affects scraping, remote read/write, alerting, and service discovery"* (CVE-2025-4673,
  CVE-2023-45289).

Note the pattern: **several of these are "attacker controls a metric name or label value."** That is a
genuinely non-obvious threat model for a developer — untrusted input reaches your monitoring UI. Good sidebar.

---

## 13. Suggested lab progression for this chapter

Keeping with the book's "one growing docker-compose stack" pedagogy:

1. **Measure before you scale.** Add a "Prometheus watching itself" dashboard row: `prometheus_tsdb_head_series`,
   `rate(prometheus_tsdb_head_samples_appended_total[5m])`, the bytes/sample expression, and
   `prometheus_tsdb_data_replay_duration_seconds`. Reader computes their own disk projection.
2. **Change retention the modern way.** Move retention from the flag to `storage.tsdb.retention.time` in
   `prometheus.yml`, then `curl -XPOST http://localhost:9090/-/reload` and watch
   `prometheus_tsdb_retention_limit_seconds` change without a restart. This *demonstrates* the deprecation
   rather than just asserting it.
3. **Add `prometheus-b`.** Identical config, `external_labels: {replica: b}`. Put both behind an nginx
   round-robin. Point Grafana at the VIP. **Watch a graph flap.** This is the emotional beat of the chapter.
4. **Fix it with Thanos.** Add `thanos-sidecar` ×2, `thanos-query` with `--query.replica-label=replica`,
   `minio` as the object store, `thanos-store`, `thanos-compact --wait`. Repoint Grafana at Thanos Query
   (`:19192`). Flapping gone; gaps filled. Same PromQL, same dashboards.
   - Optional detour: show `--deduplication.func=chain` producing worse results than `penalty`.
5. **Remote write instead.** Add single-node VictoriaMetrics (`:8428`), `remote_write` both Prometheis to it
   with `-dedup.minScrapeInterval=15s`. **Note the label inversion**: for VM the two replicas must have
   *identical* external labels, so this exercise needs a second config pair. That contrast is the lesson.
6. **Agent mode.** Convert `prometheus-b` to `--agent` + `remote_write`, show its memory drop, show the UI
   with query disabled.
7. **Shard.** Add a third scrape job with 8 fake targets, split across two Prometheis with `hashmod`
   modulus 2, show that `count(up)` differs per shard and is only correct at the Thanos Query layer.
8. **Lock it down.** Add `web-config.yml` with TLS + one bcrypt user; update Grafana's data source to use
   basic auth; then replace it with the nginx proxy that blocks `/api/v1/admin/*`.

Every step is additive to the same compose file. Steps 4–7 can be flagged optional for readers short on RAM.

---

## 14. Beginner pitfalls (candidate sidebars / "Common mistakes" boxes)

1. **Thinking two Prometheis behind a load balancer is HA.** It's availability for *scraping*, but query
   results flap. Dedup happens in the query layer or the receiver, never in the LB.
2. **Copying remote_write `queue_config` defaults from a blog.** `max_shards` is 50 (not 200),
   `max_samples_per_send` is 2000 (not 500), `max_backoff` is 5s (not 100ms).
3. **Using `prometheus_remote_storage_highest_timestamp_in_seconds`.** Deprecated since 3.7.0. Use
   `prometheus_remote_storage_queue_highest_timestamp_seconds`.
4. **Assuming remote write 2.0 is the default.** `protobuf_message` defaults to `prometheus.WriteRequest`,
   and RW2.0 is still spec `2.0-rc.4`, status Experimental.
5. **Flipping to RW2.0 against an old receiver.** You can get HTTP 200 with zero data written and no error.
   Check for the `X-Prometheus-Remote-Write-*-Written` response headers.
6. **Federating everything.** `/federate` is a scrape. Federate recording-rule aggregates only.
7. **Forgetting `honor_labels: true` on a federation job.** Without it the parent overwrites `instance`/`job`
   from the child, silently corrupting the data.
8. **Putting TSDB on NFS/EFS.** Explicitly unsupported; risks unrecoverable corruption.
9. **Setting `--storage.tsdb.retention.size` to 100% of the disk.** Only blocks are deleted to honour it;
   the WAL and head chunks count toward the total. Target 80–85%.
10. **Expecting disk to shrink immediately after lowering retention.** Cleanup is background and can take up
    to two hours; whole blocks must be fully expired.
11. **Running two Thanos Compactors on one bucket.** Silent, effectively unrecoverable corruption.
12. **Getting the HA label requirement backwards.** Thanos: replicas need **different** replica labels.
    VictoriaMetrics: replicas need **identical** labels. Mimir/Cortex: `cluster` + `__replica__`, and the
    replica label gets stripped.
13. **`-retentionPeriod=7` in VictoriaMetrics.** That's *seven months*, not seven days. Unitless means months.
14. **Changing `modulus` on a hashmod shard set.** Reshuffles nearly all targets and splits series history.
15. **Believing Prometheus has authentication.** It does not, by default. The built-in TLS/basic auth is
    experimental and is all-or-nothing.
16. **Leaving `--web.enable-admin-api` on.** Anyone who reaches the port can delete your data.
17. **Exposing a remote-write receiver without a proxy.** Free metric injection for the internet.
18. **Assuming GCP works like AWS.** GMP does **not** accept `remote_write`.
19. **Ignoring 429s.** `retry_on_http_429` defaults to `false` — Prometheus drops throttled samples silently.
    On AMP, samples older than 1 hour are refused outright, so a long outage means permanent loss.
20. **Not planning for WAL replay.** A restart on a large Prometheus can mean many minutes of no queries.

---

## 15. Stale advice to actively contradict

Things a 2021–2024 book, blog, or a model trained before this year will tell the reader that are now wrong:

1. **"The current Prometheus is 2.x."** It's 3.13.1; 3.x has been out since November 2024, and even
   Prometheus 3.5 LTS goes end-of-life on 2026-07-31.
2. **"Set retention with `--storage.tsdb.retention.time`."** Both retention flags are now marked
   `[DEPRECATED]`; retention lives in the config file under `storage.tsdb.retention` and is
   runtime-reloadable. (Note: `storage.md` itself still shows only the flags — the docs are inconsistent.)
3. **"Agent mode is experimental."** It is listed as **stable** in `stability.md` for 3.x.
4. **"Native histograms need `--enable-feature=native-histograms`."** Native histograms stopped being
   experimental in **3.9.0** (2026-01-06); the feature flag is a **no-op**. Use the `scrape_native_histograms`
   scrape-config option.
5. **"Remote write 2.0 is the new default / is stable."** Spec is **2.0-rc.4, Experimental, dated May 2024**.
   Stabilisation (PROM-35, issue #16944) is ~4/14 items done with no published target date.
   `protobuf_message` still defaults to `prometheus.WriteRequest`.
6. **The old remote-write lag PromQL** using `prometheus_remote_storage_highest_timestamp_in_seconds` with
   `ignoring(remote_name, url) group_right`. Deprecated in 3.7.0; the replacement needs no label gymnastics.
   Same for `*_samples_in_total`, `*_histograms_in_total`, `*_exemplars_in_total`.
7. **`queue_config` defaults of `max_shards: 200` / `max_samples_per_send: 500` / `max_backoff: 100ms`.**
   All wrong for 3.x.
8. **"`send_exemplars` defaults to true."** It defaults to **false**.
9. **"Mimir has three deployment modes (monolithic / read-write / microservices)."** **Read-write mode was
   removed in Mimir 3.0.** Two modes remain.
10. **"Mimir's query engine is the standard Prometheus engine."** MQE is the **default** as of Mimir 3.0.
11. **"Cortex is abandoned / archived / in maintenance mode."** It is CNCF **Incubating**, not archived, and
    shipped v1.21.1 in June 2026. The 2022 "Great Split" narrative is outdated; Grafana left, others stayed.
12. **"Use Grafana Agent."** **Grafana Agent reached EOL on 2025-11-01.** All three modes (static, flow,
    operator) are dead. The successor is **Grafana Alloy**.
13. **"Promscale is a good remote-write target."** Timescale **archived/discontinued Promscale in 2023**.
    Do not list it. *(Marked PARTIALLY VERIFIED — I did not re-fetch the archive notice this session.)*
14. **"Federate to scale."** Even the official docs' example federates only recording-rule output
    (`{__name__=~"job:.*"}`).
15. **"Grafana can deduplicate HA Prometheus replicas."** It cannot. There is no such setting.
16. **AMP retention is fixed at 150 days.** It's configurable from 1 to 1095 days; and separately, single
    queries are capped at a **95-day** range (raised from 32 days in 2025).
17. **"Thanos requires you to disable Prometheus compaction by hand."** Still the common setup, but
    Prometheus **3.9.0** added `--storage.tsdb.delay-compact-file.path` specifically to make sidecar
    interop cleaner.
18. **"3 kB of RAM per active series."** That's Robust Perception's figure for *head chunk* memory as of
    **Prometheus 2.20 (2020)**. Real-world RSS per active series in 2026 is materially higher; budget ~8 KiB
    and measure.
19. **`prom/prometheus` images are the only option.** Since **3.10.0** there are `-busybox` and `-distroless`
    variants (distroless runs as UID 65532 and drops the `VOLUME` declaration), and since **3.13.0** images
    are also published to **ghcr.io**.
20. **"Prometheus's built-in basic auth is a supported way to secure it."** It's explicitly listed as
    unstable/experimental in `stability.md` and in the HTTPS doc itself.

---

## 16. Open questions / things to re-verify before publication

- **Grafana Cloud free-tier numbers.** Official page gives retention (14 days) but not the series limit.
  Re-check `grafana.com/docs/grafana-cloud/cost-management-and-billing/` near press time, or omit numbers.
- **AMP retention 150 days / 1095 max.** Verified via AWS "what's new" and roadmap issues, not the quotas
  page I fetched. Re-confirm on `docs.aws.amazon.com/prometheus/latest/userguide/`.
- **Memory-per-series guidance.** No primary source exists. Consider running the lab and publishing a
  measured number for the book's own stack instead of quoting a rule of thumb.
- ~~**hashmod hash function.**~~ **RESOLVED** — verified from `model/relabel/relabel.go` @ v3.13.1: MD5,
  last 8 bytes as big-endian uint64, modulo `modulus`. See §7.2.
- **Prometheus agent web UI port.** `prometheus_agent.md` says 9095; the CLI reference default is 9090.
  Run it and confirm before writing either number.
- **"Grafana Cloud Metrics is Mimir."** Widely known, not stated on the page I fetched. Verify or soften.
- **Promscale archived date.** Re-verify if you mention it at all.
- **Mimir 3.x and Kafka**: confirm whether Kafka is *required* or *optional* for the classic architecture in
  3.1.x before implying every Mimir install now needs a Kafka cluster. The blog says the classic architecture
  "remains available." **Important not to overstate this.**

---

## 17. Sources

Primary — Prometheus project:
- https://prometheus.io/docs/prometheus/latest/storage/
- https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/storage.md
- https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/federation.md
- https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/prometheus_agent.md
- https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/stability.md
- https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/feature_flags.md
- https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/configuration/configuration.md
- https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/configuration/https.md
- https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/docs/command-line/prometheus.md
- https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/documentation/examples/web-config.yml
- https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/CHANGELOG.md
- https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/storage/remote/queue_manager.go
- https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/storage/remote/write.go
- https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/storage/remote/read.go
- https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/tsdb/head.go
- https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/tsdb/db.go
- https://raw.githubusercontent.com/prometheus/prometheus/v3.13.1/tsdb/compact.go
- https://prometheus.io/docs/specs/prw/remote_write_spec_2_0/
- https://raw.githubusercontent.com/prometheus/docs/main/docs/specs/prw/remote_write_spec_2_0.md
- https://prometheus.io/docs/specs/prw/remote_write_spec/
- https://prometheus.io/docs/practices/remote_write/
- https://prometheus.io/docs/operating/security/
- https://prometheus.io/docs/introduction/release-cycle/
- https://github.com/prometheus/prometheus/releases
- https://github.com/prometheus/prometheus/issues/16944  (PROM-35, RW2.0 stability umbrella issue)

Thanos:
- https://thanos.io/tip/thanos/quick-tutorial.md/
- https://thanos.io/tip/components/query.md/
- https://thanos.io/tip/components/compact.md/
- https://thanos.io/tip/components/sidecar.md/
- https://thanos.io/tip/components/receive.md/
- https://github.com/thanos-io/thanos/releases

Grafana Mimir / Grafana:
- https://grafana.com/docs/mimir/latest/references/architecture/
- https://grafana.com/docs/mimir/latest/references/architecture/components/
- https://grafana.com/docs/mimir/latest/references/architecture/deployment-modes/
- https://grafana.com/docs/mimir/latest/configure/configure-high-availability-deduplication/
- https://grafana.com/blog/grafana-mimir-3-0-release-all-the-latest-updates/
- https://github.com/grafana/mimir/releases/tag/mimir-3.0.0
- https://github.com/grafana/mimir/releases
- https://github.com/grafana/grafana/releases
- https://grafana.com/docs/grafana-cloud/send-data/metrics/
- https://grafana.com/products/cloud/free-tier/
- https://grafana.com/blog/grafana-agent-to-grafana-alloy-opentelemetry-collector-faq/
- https://grafana.com/docs/agent/latest/  (EOL notice)

VictoriaMetrics:
- https://raw.githubusercontent.com/VictoriaMetrics/VictoriaMetrics/master/docs/victoriametrics/README.md
- https://raw.githubusercontent.com/VictoriaMetrics/VictoriaMetrics/master/docs/victoriametrics/LTS-releases.md
- https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/
- https://docs.victoriametrics.com/victoriametrics/vmagent/
- https://github.com/VictoriaMetrics/VictoriaMetrics/releases

Cortex:
- https://cortexmetrics.io/docs/
- https://github.com/cortexproject/cortex/blob/master/README.md
- https://github.com/cortexproject/cortex/releases
- https://www.cncf.io/projects/cortex/

Managed services:
- https://docs.aws.amazon.com/prometheus/latest/userguide/AMP_quotas.html
- https://docs.aws.amazon.com/prometheus/latest/userguide/AMP-what-is.html
- https://aws.amazon.com/about-aws/whats-new/2025/05/amazon-managed-service-prometheus-95-day-queries
- https://aws.amazon.com/about-aws/whats-new/2025/07/amazon-managed-service-prometheus-50M-default-activeserieslimit
- https://docs.cloud.google.com/stackdriver/docs/managed-prometheus

Secondary (used only where flagged, and flagged as such):
- https://www.robustperception.io/why-does-prometheus-use-so-much-ram/  (3 kB/series, 2020, Prometheus 2.20)
- Container registry APIs: hub.docker.com/v2/repositories/…, quay.io/api/v1/repository/thanos/thanos/tag/
