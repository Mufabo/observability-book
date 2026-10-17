# Chapter 26 — When One Prometheus Isn't Enough: HA, `remote_write`, and the Scaling Map

Everything you have built lives in one container. One process holds the head
block, the write-ahead log, the rule engine and the query API, and one named
volume holds the blocks. Stop that container and every dashboard in this book
goes blank, every alerting rule stops evaluating, and the Watchdog stops
arriving — which is exactly what Chapter 19, "What a Page Should Say, and Who
Watches the Watcher", built the pager to notice. Start it again and it replays
the log before it will answer a single query.

For a laptop lab that is fine. For a first production system it is usually still
fine, and saying so plainly is the most useful thing this chapter can do. The
documentation is blunt about the constraint: Prometheus's local storage is not
clustered and not replicated, so a Prometheus server should be managed the way
you would manage any other single-node database. That is a statement about
*durability and blast radius*, not about capacity. A modern machine with an NVMe
disk runs a Prometheus with millions of active series without complaint.

So this chapter is a decision before it is a set of techniques. First: do you
need any of this yet, and how would you know. Then the two things you will
actually be asked to do in a first job — run a second copy without lying to
yourself about what it buys, and ship your data somewhere that outlives the box.
Then a map of the systems people reach for next, drawn carefully enough to
choose between them and deliberately not taught.

!!! objectives "Objectives"
    After this chapter you can:

    - Decide from ingestion rate, retention, blast radius and geography
      whether you need any of this yet.
    - Run two scrapers, and explain precisely why putting a load balancer in
      front of them is not high availability.
    - Name the three mutually contradictory replica-label conventions and pick
      the right one for a given backend.
    - Configure `remote_write` with the current 3.x defaults, and build a lag
      panel from the metrics that are not deprecated.
    - Say what federation is, what it is for, and why it is not a scaling
      strategy.
    - Choose between Thanos, Mimir, VictoriaMetrics, Cortex and a managed
      service without deploying any of them.

## Where the lab is

This runs against the stack as Chapter 25, "Storage, Retention, Backups and
Locking the Door", left it: Prometheus has no published host port of its own and
lives behind `edge` with a password, `meta.json` watches the monitoring system
watching everything else, and retention is set in `prometheus.yml` rather than
on the command line. The `ch26` tag adds the `compose.scale.yaml` overlay and a
second Grafana data source, to read along with; to write them yourself, check out
`ch25` instead. The `remote_write` block is yours to write on either tag.

```bash
cd lab
git checkout ch26
make check
make up
make ps
```

Prometheus is on `https://localhost:8443/prometheus/` with the credentials
`obslab` / `obslab`, Grafana on `http://localhost:3000/`, Snip on
`http://localhost:8080/`, and the load generator's control API on
`http://localhost:8089/`. Put the injector into a steady state so that nothing
but the thing you are studying moves:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","error_ratio":0}'
```

This chapter adds a second Prometheus, which is another two gigabytes of
memory limit. The full stack with the overlay budgets around 4.5 GB of actual
resident memory. If your machine is tight, run this chapter and then
`make down` — nothing later in the book depends on the overlay staying up.

## Do you need any of this yet?

There is a ladder here, and every rung is cheaper to climb than the one above
it. Work it in order and stop at the first rung that solves your problem. Most
people stop on rung two or three and never come back.

**Rung 1: reduce cardinality.** The documentation's own advice is that lowering
the ingested sample rate is better done with fewer series than with a longer
scrape interval, because samples within one series compress extremely well while
each new series costs an index entry and a fresh chunk. You did this in Chapter
24, "Cardinality: Detonate, Diagnose, Defuse". It is free, and it is usually where the win is.

**Rung 2: buy a bigger box.** Boring and usually correct. This is the rung the
internet skips.

**Rung 3: shorten local retention and ship the data somewhere else.** Keep two
weeks locally for the queries that must be fast, and `remote_write` everything
to a system whose job is to keep it for a year. This is the modern default
answer and the second half of this chapter.

**Rung 4: run a highly available pair.** Two identical servers. This buys
*availability*, not capacity — both of them do all of the work.

**Rung 5: shard by target.** Split the targets across several servers so each
holds a fraction. This buys capacity and costs you global queries.

**Rung 6: federate aggregates only.** A small global view over several servers.
Not a scaling technique, for reasons this chapter makes concrete.

**Rung 7: adopt a horizontally scalable backend.** Thanos, Mimir,
VictoriaMetrics, Cortex, or somebody's managed service.

The trigger for rungs 4 and above is rarely ingestion rate. It is **blast
radius**. One Prometheus is a single point of failure for both your dashboards
and your alerting, and its restart is not instant: on startup it replays the
write-ahead log, and that replay takes time proportional to how much data was in
the head block. Chapter 25 put `prometheus_tsdb_data_replay_duration_seconds` on
the meta dashboard for exactly this reason. On this lab the replay is a couple of
seconds. On a ten-million-series server it can be many minutes, and during those
minutes nothing evaluates and nothing answers.

Multi-region is the other trigger, and it is not subtle: if you have servers on
two continents and you want one query to span both, no amount of vertical sizing
gets you there.

## Two scrapers, and what they buy

Bring up the overlay. It is an overlay rather than an edit, so a failed
experiment never leaves your working stack broken:

```bash
make scale-up
```

That is `docker compose -f compose.yaml -f compose.scale.yaml up -d`, and it
starts one new service, `prometheus-b`, on `http://localhost:9099/`. It runs the
same pinned image as the primary, reads the same `prometheus/prometheus.yml`
through the same read-only bind mount, discovers the same containers through the
same Docker socket, and writes to its own named volume.

There is no clustering here. No leader election, no replication protocol, no
shared state. Two copies of the same program doing the same work in parallel,
and the only thing that distinguishes them is one label. Look at the top of
`lab/prometheus/prometheus.yml`:

```yaml
external_labels:
  cluster: obslab
  replica: ${PROM_REPLICA}
```

`compose.yaml` sets `PROM_REPLICA: a` on the primary; `compose.scale.yaml` sets
`PROM_REPLICA: b` on the replica. Prometheus 3 expands `${var}` inside external
label *values* unconditionally — the feature flag that used to gate this was
removed in 3.0 — so one config file serves both servers and there is no second
file to keep in sync. Write a literal `a` there and both servers claim to be
`a`, which nothing reports and which you cannot debug from inside the config.

Chapter 12, "`prometheus.yml` in Full: Service Discovery and Relabeling", made
you prove that external labels are attached on the way *out* and never appear on
locally stored series. That property is what makes everything here possible, so
re-prove it now that it matters. Ask the primary whether it can see its own
replica label:

```bash
curl -sk -u obslab:obslab -G \
  https://localhost:8443/prometheus/api/v1/query \
  --data-urlencode 'query=up{replica!=""}' | jq '.data.result'
```

The answer is `[]`. Not an error, not a value — an empty result. Every series in
both databases is label-for-label identical. Now ask `prometheus-b` what it
thinks it is called:

```bash
curl -s http://localhost:9099/api/v1/status/config \
  | jq -r '.data.yaml' | grep -A2 external_labels
```

You get `cluster: obslab` and `replica: b`. The distinguishing label exists only
in the configuration and only takes effect on data leaving the server.

!!! warning "The second replica arrived without the lock"
    Chapter 25 took `:9090` away from the primary and put it behind `edge`
    with a password. `prometheus-b` publishes `9099` straight to your host
    with no authentication at all, because this is a laboratory and you are
    about to need a second window. In a real deployment the replica is exactly
    as sensitive as the primary — same data, same admin API, and
    `compose.scale.yaml` hands it `--web.enable-admin-api` too. A second copy
    of a system is a second copy of its attack surface.

Here is what the pair actually looks like. The two servers never talk to each
other; they only agree about what to point at.

```text
        ┌──────────────┐        ┌──────────────┐
        │  prometheus  │        │ prometheus-b │
        │  replica: a  │        │  replica: b  │
        └──────┬───────┘        └──────┬───────┘
               │   scrape every 15s    │
               │   (different offsets) │
               ▼                       ▼
        ┌───────────────────────────────────┐
        │     the same 14 targets           │
        └───────────────────────────────────┘
```

What that diagram buys you is **scrape availability**: if one server is down for
an upgrade, the other one still has the data for that window. What it does not
buy you is a single place to ask the question.

## The flap

Wait a couple of minutes for `prometheus-b` to have some history, then ask both
servers the same question at the same moment. The question is: how fresh is your
newest `up` sample for Snip? `timestamp()` is the function for that — it returns
each sample's own timestamp as the sample's value, so the answer is a Unix time
in seconds rather than a `0` or a `1`.

```bash
for u in https://localhost:8443/prometheus http://localhost:9099; do
  curl -sk -u obslab:obslab -G "$u/api/v1/query" \
    --data-urlencode 'query=max(timestamp(up{job="snip-api"}))' \
    | jq -r '.data.result[0].value[1]'
done
```

```text
1789603244.180
1789603236.904
```

Seven and a bit seconds apart, and it will be a different gap every time you
run it. Neither number is wrong. The two servers started at different moments,
so their fifteen-second scrape cycles sit at different offsets, and each one is
telling you the truth about the last time *it* looked.

Now see it as a picture, which is how you will actually meet it. Grafana already
knows about the replica, and you did not have to teach it: this chapter adds a
second data source named **Prometheus B**, uid `prometheus-b`, to
`provisioning/datasources/prometheus.yaml` — the only file outside the overlay
that ch26 touches. Its health check fails whenever the overlay is down, which is
harmless, because no dashboard points at it. Open the Snip RED dashboard, find
the "Request rate by route" panel, set the dashboard refresh to five seconds,
and edit the panel's data source. Flip it
from **Prometheus** to **Prometheus B** and back a few times while it is
refreshing. The line does not stay still. The right-hand edge jumps, the last
point moves up and down by a percent or two, and if one server missed a scrape
that the other one caught, a gap appears and disappears depending on which one
you asked.

One thing worth noticing while you are there: panels over long windows — the
thirty-day SLO rungs from Chapter 20, "SLIs, SLOs and Error Budgets" — are empty
on **Prometheus B**, because `make backfill` wrote its blocks into the primary's
volume and the replica has only the history it has scraped for itself.

!!! trap "The load balancer that is not high availability"
    The obvious next move is to put both servers behind a load balancer — one
    address that forwards each request to whichever backend is healthy — and
    point Grafana at that address. It looks like the fix. It is the bug.

    Each panel refresh is a separate HTTP request, so each refresh lands on a
    different backend, and you get the flap above on *every* panel at *every*
    refresh rather than only when you flip a data source by hand. A "Last"
    stat panel bounces between two values. A short `rate()` window wobbles. A
    scrape one server missed appears and vanishes. Worse, it is now
    intermittent and unreproducible, so you will spend an afternoon looking
    for a bug in your query.

    **Grafana does not deduplicate Prometheus replicas.** There is no setting
    for it and no plugin option: a Prometheus data source is one HTTP endpoint
    with no concept of a replica label. Deduplication happens in a
    replica-aware query layer, or at the receiver that ingests both replicas'
    data — never in the load balancer.

There are three real answers, in increasing order of machinery. The smallest is
what you just did by hand: one data source per replica, switched when one is
down. It deduplicates nothing and it flaps not at all, and plenty of small teams
run exactly that. The middle answer is a replica-aware query layer — Thanos
Query is the usual one — which merges series differing only by the replica label
and fills gaps in one replica from the other. The largest is to deduplicate on
ingest at a `remote_write` receiver, which is what Mimir, Cortex and Amazon's
managed service do.

All three need to know which label identifies a replica. This is where the field
disagrees with itself.

## Three conventions that contradict each other

Three systems, three requirements, and two of them are exact opposites. Getting
this backwards is the single highest-value mistake to avoid in this whole area,
because it fails silently: you get data, and it is wrong or duplicated.

| Backend | What the replicas' labels must be | Who strips them |
|---|---|---|
| Thanos | **Different** replica label per replica | Query layer, at query time |
| Mimir / Cortex / AMP | `cluster` plus a **different** `__replica__` | Receiver strips the winner's |
| VictoriaMetrics | **Byte-identical** external labels | Nothing; dedup is by timestamp |

Thanos merges at query time. You run `thanos query` with
`--query.replica-label replica`, and series that differ only in that label
collapse into one, with gaps in one replica filled from the other. For that to
work the replicas must be *distinguishable*, so they need different values. The
lab's `replica: a` / `replica: b` is already in Thanos's shape.

Mimir and Cortex — and Amazon Managed Service for Prometheus, which is built on
Cortex — use an **HA tracker** in the component that accepts writes. It keys on
`cluster` and `__replica__`, elects one replica per cluster as the leader, and
drops the other's samples with HTTP 202 so the sender does not retry. Leadership
fails over if the leader goes quiet for about thirty seconds. Crucially the
`__replica__` label is **stripped** from accepted samples, so what gets stored
is identical whichever replica won — which is why dashboards do not flap across
a failover. Note the name: two leading and two trailing underscores, and
`__replica__` rather than `replica`:

```yaml
external_labels:
  cluster: prom-team1
  __replica__: replica1     # replica2 on the other server
```

VictoriaMetrics does the opposite. It deduplicates by keeping one raw sample per
series per `-dedup.minScrapeInterval` window, and its rule for "same series" is
that the labels are identical. If your two replicas carry different external
labels, VictoriaMetrics sees two different series and stores both, forever. The
replicas must be **byte-identical**, which is precisely what Thanos forbids.

!!! pitfall "Setting the replica label for the wrong backend"
    Point a Thanos-shaped HA pair (`replica: a` / `replica: b`) at
    VictoriaMetrics and nothing errors. Ingestion succeeds, queries succeed,
    and you quietly store and pay for two copies of everything while
    `-dedup.minScrapeInterval` does nothing at all, because it never sees two
    samples of the same series.

    Point a VictoriaMetrics-shaped pair (identical labels) at Thanos Query and
    also nothing errors. `--query.replica-label replica` finds one value,
    merges nothing, and a scrape one replica missed is a real gap in your
    graph, because there is no second copy to fill it from.

    Both failures are invisible from the query page. Decide which backend you
    are writing for *before* you write `external_labels`.

## Federation is a scrape

Federation is the oldest answer to "I have several Prometheus servers and I want
one view", and it is worth ten minutes because you will meet it in other
people's configs and because understanding what it is makes the argument against
it obvious.

A Prometheus server exposes `/federate`. You ask it, with one or more `match[]`
URL parameters, for the current value of every series matching those selectors,
and it renders them into a single exposition-format response. Then you scrape
that response with an ordinary scrape job. That is the entire mechanism.

Here is the canonical configuration, in the shape the official documentation
uses:

```yaml
scrape_configs:
  - job_name: federate
    scrape_interval: 15s
    honor_labels: true
    metrics_path: /federate
    params:
      'match[]':
        - '{__name__=~"job:.*"}'
    static_configs:
      - targets: ['prometheus-b:9090']
```

Two lines in that block are doing all the work.

`honor_labels: true` is not optional. Chapter 12 taught what the default does:
when a scraped sample carries a label the scrape job also sets, the job's value
wins and the original is renamed to `exported_<label>`. A federated response
carries the *original* `job` and `instance` from the child server, so with the
default you would rewrite every federated series' `job` to `federate` and every
`instance` to `prometheus-b:9090`, and file the truth away under
`exported_job` and `exported_instance`. Your data survives, renamed beyond
recognition, and every query and every rule that referenced it stops matching.

`{__name__=~"job:.*"}` is the more interesting line, because it is the official
example's own selector and it is not an accident. The `job:` prefix is the
recording-rule naming convention from Chapter 15, "Recording Rules" —
`level:metric:operations`. The official example of how to federate is an example
of federating **recording-rule output**. This lab's rules follow the same
convention, so that selector matches `job:up:ratio`,
`job:snip_sli_availability:ratio_rate5m` and their siblings, and matches no raw
series at all.

You can see the size difference for yourself. `prometheus-b` has no password on
it, so ask it for the aggregates and then for everything:

```bash
curl -s -G http://localhost:9099/federate \
  --data-urlencode 'match[]={__name__=~"job:.*"}' | wc -c

curl -s -G http://localhost:9099/federate \
  --data-urlencode 'match[]={__name__!=""}' | wc -c
```

The first is a few kilobytes. The second is several megabytes on a laptop lab
with fourteen targets, and it is one HTTP response, rendered in full, every
scrape interval. Scale that mentally to a server with a million series and you
have the first of five reasons federation is not a scaling strategy:

1. **It is a scrape, so it inherits every scrape limit.** Scrape timeouts, body
   size limits, and a memory spike on both ends, every interval. The
   `sample_limit` of Chapter 24, "Cardinality: Detonate, Diagnose, Defuse", is
   all-or-nothing: breach it and the whole scrape fails.
2. **You get one sample per series per scrape, not the child's history.** Child
   at 15 s, parent at 60 s, and you have silently thrown away three quarters of
   the data — `rate()` at the parent is correspondingly less accurate.
3. **There is no backfill.** If the parent is down for ten minutes, those ten
   minutes are gone from the parent forever. The child still has them; nothing
   moves them across.
4. **It does not help the child**, which stores everything with its own
   retention exactly as before. You have added load, not removed any.
5. **It does not deduplicate.** Federating both replicas of an HA pair gives
   you both copies and no way to merge them.

The rule to carry away: federate recording-rule output, a few thousand series at
most, when you want one small global view. If you want all of the data in one
place, that is what `remote_write` is for. This is reasoned guidance rather than
a quoted prohibition — the documentation frames hierarchical federation as
collecting aggregated, job-level data, and its own example federates nothing
else.

## `remote_write`: the defaults nobody has right

`remote_write` is the scaling primitive. The sending server keeps scraping and
keeps serving queries exactly as before; in parallel, a component reads the
write-ahead log as it is written and pushes the samples to an HTTP endpoint.
Everything that matters about it is in one config block, and almost every blog
post you will find quotes at least one default that is no longer true.

`prometheus-b` is already a receiver: `compose.scale.yaml` starts it with
`--web.enable-remote-write-receiver`, which turns on `POST /api/v1/write`. The
sending half is not shipped, because it is yours to write. Open
`lab/prometheus/prometheus.yml` and add this block at the top level — next to
`alerting:` and `rule_files:`, not inside `scrape_configs:`:

```yaml
# (ch26) Ship one job's worth of data to the second replica.
remote_write:
  - url: http://prometheus-b:9090/api/v1/write
    name: prometheus-b
    # Choose what leaves. Without this you would copy the entire
    # database onto a second disk on the same laptop, which is
    # precisely the mistake this chapter is about. `job=prometheus`
    # is this server's own self-metrics: if the primary dies, its
    # own health history survives on the replica.
    write_relabel_configs:
      - source_labels: [job]
        regex: prometheus
        action: keep
    queue_config:
      # 50 in production. 10 here so the ceiling is somewhere you
      # could actually reach on a laptop.
      max_shards: 10
      # The guidance is capacity = 3-10x max_samples_per_send.
      # 2500 / 500 = 5.
      max_samples_per_send: 500
      capacity: 2500
```

The primary runs with `--config.auto-reload`, so it will pick this up on its
own within the poll interval; `make reload` forces it immediately. A scrape or
two later, confirm the queue exists:

```bash
curl -sk -u obslab:obslab -G \
  https://localhost:8443/prometheus/api/v1/query \
  --data-urlencode 'query=prometheus_remote_storage_shards' \
  | jq -r '.data.result[0]'
```

You get one series with `remote_name="prometheus-b"` and
`url="http://prometheus-b:9090/api/v1/write"`, and a value of `1`.

Now the defaults, because this is the table people get wrong. Every value below
is the released 3.13.1 default, and the right-hand column is what you will find
in writing that predates it.

| `queue_config` field | Default in 3.x | Commonly printed |
|---|---|---|
| `capacity` | 10000 | — |
| `max_shards` | **50** | 200 |
| `min_shards` | 1 | — |
| `max_samples_per_send` | **2000** | 500 |
| `batch_send_deadline` | 5s | — |
| `min_backoff` | 30ms | — |
| `max_backoff` | **5s** | 100ms |
| `sample_age_limit` | 0s (send everything) | — |
| `retry_on_http_429` | **false** | — |

Three more defaults live outside `queue_config` and matter just as much.
`send_exemplars` is `false`. `send_native_histograms` is `false`.
And `enable_http2` is `false` **for remote write specifically** — it is `true`
for scraping, which is exactly the kind of asymmetry that makes people assume
they have it backwards.

!!! note "Native histograms, exactly"
    Native histograms are stable since Prometheus 3.8.0; the
    `native-histograms` feature flag has been a complete no-op since 3.9; and
    there are still **three independent opt-ins** — the client library's
    `NativeHistogramBucketFactor`, the server's `scrape_native_histograms:
    true`, and remote write's `send_native_histograms: true`. The latter two
    default to true only from v4. The classic text exposition format cannot
    carry them at all.

    That third opt-in is the one Chapter 10, "Latency: Histograms Without
    Tears", promised and could not show you, because there was nothing to
    write to. It is a field in the `remote_write` block, a sibling of `url`.
    If `loadgen` is running with `LOADGEN_NATIVE=1` and you do not set it,
    those histograms do not leave this server. *IOU from chapter 10, settled.*

`retry_on_http_429: false` deserves a paragraph of its own, because the default
is surprising and the consequence is data loss. HTTP 429 means "you are sending
too fast"; by default Prometheus does not retry those requests, it drops the
samples quietly. Managed backends throttle with 429 as a matter of routine.
Amazon's, for instance, throttles with a token bucket and rejects the *entire*
request if it is one sample over budget, and separately refuses any sample more
than an hour old. Put those two together and a long throttling episode against a
default-configured sender is permanent, silent loss.

!!! sidebar "How Prometheus decides how many shards to run"
    Skippable. A **shard** here is one concurrent stream of batches to the
    endpoint, not a partition of your data. Prometheus recalculates how many
    it wants every ten seconds, from the rate of incoming samples plus
    whatever backlog has built up, divided by the average time a batch takes
    to be accepted — and it aims to work off 5% of any backlog per second. It
    tolerates about 30% more shards than it needs before scaling back down, so
    the number does not oscillate.

    Two consequences. Your job is to set the ceiling and stay out of the way —
    the official guidance is that unless you are writing to a very slow
    endpoint, `max_shards` rarely needs raising above its default. And each
    shard holds `capacity + max_samples_per_send` samples, under 2 MB with the
    stock defaults; enabling remote write at all costs roughly 25% more
    memory.

## Watching a queue

The one number that tells you whether remote write is healthy is how far behind
it is, in seconds:

```promql
prometheus_remote_storage_queue_highest_timestamp_seconds
  - prometheus_remote_storage_queue_highest_sent_timestamp_seconds
```

The first is the newest timestamp that has entered the queue; the second is the
newest that the receiver has acknowledged. Their difference is your lag. Both
carry the same `remote_name` and `url` labels, so this is an ordinary
one-to-one binary operation between two matching series, with no `on()` or
`ignoring()` required — Chapter 11, "Joins, Info Metrics, and the Rest of
PromQL", would have you write it exactly like that.

!!! pitfall "The lag expression every surviving blog post still prints"
    Search for "prometheus remote write lag" and you will find this:

    ```promql
    prometheus_remote_storage_highest_timestamp_in_seconds
      - ignoring(remote_name, url) group_right
    prometheus_remote_storage_queue_highest_sent_timestamp_seconds
    ```

    The `ignoring(...) group_right` gymnastics are there for a reason: the old
    `..._highest_timestamp_in_seconds` was a single server-wide metric with no
    `remote_name` or `url` on it, so it could not match one-to-one against a
    per-queue metric. Prometheus 3.7.0 deprecated it along with
    `prometheus_remote_storage_samples_in_total`, `..._histograms_in_total`
    and `..._exemplars_in_total`, and the replacement carries the queue labels
    precisely so that the join goes away. It is also more accurate, because it
    counts what survived `write_relabel_configs` rather than what arrived
    before them.

    A dashboard containing the block above is a dated artifact, not a style
    choice. Replace it.

Build the panel. Open the **obslab Meta-Monitoring** dashboard that Chapter 25
provisioned, add a time series panel titled "Remote write lag", give it the
expression above, and set the unit to seconds. Add a second panel for
`prometheus_remote_storage_samples_pending`, which the documentation calls out
as the first signal that you are falling behind: it moves before the lag does.

Two more expressions belong in your head rather than on the dashboard. This one
says whether you are saturated — if it sits at 1 for any length of time, the
sender is at its ceiling and the ceiling is the problem:

```promql
prometheus_remote_storage_shards
  / prometheus_remote_storage_shards_max
```

And this one tells you what is being thrown away and why. The `reason` label
takes values like `too_old` and `dropped_series`:

```promql
sum by (reason) (
  rate(prometheus_remote_storage_samples_dropped_total[5m])
)
```

## Break it on purpose

A lag panel that has only ever read zero has taught you nothing. Stop the
receiver — not kill it, *pause* it, so that the socket stays open and the sender
experiences a hang rather than a refusal, which is what a struggling backend
actually feels like:

```bash
docker compose -f compose.yaml -f compose.scale.yaml \
  pause prometheus-b
```

Watch the panel. Nothing happens for a few seconds — the sender is waiting out
`remote_timeout`, which defaults to 30 s — and then the lag line leaves zero and
climbs at one second per second, because `highest_timestamp` keeps advancing as
new samples are appended while `highest_sent_timestamp` is frozen. That slope is
diagnostic: a lag climbing at exactly 1 s/s means nothing at all is getting
through. A lag climbing more slowly means you are behind but still moving.

Leave it for a minute, then let it go:

```bash
docker compose -f compose.yaml -f compose.scale.yaml \
  unpause prometheus-b
```

The line falls back to near zero within a few scrape intervals. Nothing was
lost: the samples were held in the write-ahead log, and the sender picked up
from where it stopped. That is the property that makes `remote_write` safe to
point at something that occasionally goes away — and it is also why an
unreachable `remote_write` URL is not an emergency. The server keeps scraping,
keeps evaluating rules and keeps answering queries; only the queue metrics show
the backlog.

!!! selfcheck "Self-check"
    With the overlay up and the `remote_write` block in place, run
    `make verify-ch26`. It takes about two minutes and twenty seconds, because
    it pauses the receiver for thirty and then gives the queue ninety to
    drain. Expect:

    ```text
    PASS prometheus-b answers on http://localhost:9099
    PASS prometheus-b carries external label replica: b
    PASS replica is not visible on locally queried series
         series for job=snip-api — a: 170  b: 170
    PASS both replicas agree on count() (within two series)
         newest snip-api sample differs by 7.312s between replicas
    PASS the two replicas disagree on sample timestamps
    PASS remote_write lag is measurable
         lag while paused: 31.5s
      [ 10s] lag 0.421s
    PASS lag returned to under 30 s within two minutes

    ch26: 7 passed, 0 failed
    ch26 OK
    ```

    Your series count depends on how many of Snip's routes have been
    exercised; around 170 once every route has been hit at least once. The
    timestamp gap is different every run, and that is the point of the check.

    This target needs the overlay, so it is one of the few that cannot run on
    the base stack: without `make scale-up` it reports that `prometheus-b` is
    not answering and stops. Without the `remote_write` block it passes the
    replica half and *skips* the lag half, printing the YAML you are missing
    rather than calling a working lab broken.

One consequence of that script is worth knowing. It compares
`count({job="snip-api"})` on both servers and expects them to agree within two
series. If you remote-write *everything* into `prometheus-b` instead of one job,
every Snip series arrives there a second time carrying `replica="a"`, the counts
differ by a factor of two, and the check fails — correctly, because you have
just built the thing this chapter warns about. The `write_relabel_configs` block
above is what keeps the two halves of the script compatible.

One last thing to look at, and it is the clearest demonstration of external
labels in the book. Ask **`prometheus-b`** how many of the primary's
self-metrics it holds, grouped by replica:

```bash
curl -s -G http://localhost:9099/api/v1/query \
  --data-urlencode 'query=count by (replica) ({job="prometheus"})' \
  | jq -r '.data.result[] | "\(.metric) \(.value[1])"'
```

Two groups come back: one with no `replica` label at all, which is what
`prometheus-b` scraped for itself, and one with `replica="a"`, which arrived
over remote write. Same job, same metrics, same targets — and the replica label
becomes visible at exactly the moment the data crosses a server boundary.

## Remote Write 2.0, and a 2xx that means nothing

There is a version 2 of the remote write protocol. As of this writing its spec
is at **2.0-rc.4**, its status is **experimental**, and `protobuf_message` still
defaults to `prometheus.WriteRequest` — version 1. Anyone who tells you 2.0 is
the default is repeating something they read rather than something they checked.

What it adds is worth knowing: a symbol table, so every label name and value is
written once per request and referenced by index, which is most of the bandwidth
win; metadata inline with each series instead of on a separate one-minute
cadence; start timestamps; native histograms unconditionally, making
`send_native_histograms` a no-op; and mandatory
`X-Prometheus-Remote-Write-*-Written` response headers.

Switching a sender is one line:

```yaml
remote_write:
  - url: http://prometheus-b:9090/api/v1/write
    protobuf_message: io.prometheus.write.v2.Request
```

Try it against this lab and it breaks, on purpose. The receiver flag
`--web.remote-write-receiver.accepted-protobuf-messages` defaults to version 1
only, and `compose.scale.yaml` does not widen it. `prometheus-b` therefore
answers **415 Unsupported Media Type**, and because senders must not retry a 4xx
that is not 429, nothing gets through. You will see it on the panel you just
built: the lag climbs at 1 s/s and never comes back down. Take the line out
again.

That is the *good* failure. Here is the bad one.

!!! pitfall "A 2xx that wrote nothing"
    A version 1.0 receiver that does not inspect the `Content-Type` header
    will happily accept a v2 payload and decode it with the v1 schema. The two
    messages are close enough in shape that this produces **no decoding
    error** — it produces an empty result. The receiver then returns a
    perfectly ordinary 2xx, your sender records a successful write, your lag
    metric reads zero, and none of your data exists anywhere.

    The spec's own advice is the workaround: a sender that gets a 2xx with
    **none** of the `X-Prometheus-Remote-Write-*-Written` response headers
    should treat that response as if it were a 415. When you point a v2 sender
    at a receiver you did not write, check for those headers before you trust
    the green dashboard.

    Prometheus-as-a-receiver does check the header, which is why this lab
    gives you a clean 415 instead. Not every receiver in the world does.

## Agent mode

Sometimes you want a scraper and nothing else: no local queries, no rules, no
alerts, minimal memory, ship everything onward. That is **agent mode**, the same
binary with one flag. It is listed as stable for 3.x; if you read that it is
experimental, that page is old.

`--agent` switches off the TSDB, rule evaluation and alerting. Its write-ahead
log is a different animal: it deletes data as soon as it has been written
successfully, and if the remote endpoint is unreachable it buffers to disk for
up to two hours and then starts losing data. Everything you gave up has to
happen wherever you are shipping to.

Try it for five minutes. Write `lab/prometheus/agent.yml`:

```yaml
# A throwaway agent. No TSDB, so there is nothing here to query;
# no rule_files and no alerting, because agent mode cannot run
# them; and remote_write is not optional, because it is the only
# way data leaves.
global:
  scrape_interval: 15s
  external_labels:
    cluster: obslab
    replica: agent

scrape_configs:
  # Deliberately NOT one of this lab's twelve job names, so
  # nothing you have built sees this data.
  - job_name: agent-demo
    static_configs:
      - targets: ['snip-api:8000']

remote_write:
  - url: http://prometheus-b:9090/api/v1/write
    name: prometheus-b
```

Run it on the lab's network, with no published port and no volume:

```bash
docker run -d --rm --name obslab-agent --network obsnet \
  --user 0:0 \
  -v "$PWD/prometheus:/etc/prometheus:ro" \
  quay.io/prometheus/prometheus:v3.13.1 \
  --agent \
  --config.file=/etc/prometheus/agent.yml \
  --storage.agent.path=/agent
```

Give it a minute, then ask the receiver whether the agent's data arrived:

```bash
curl -s -G http://localhost:9099/api/v1/query \
  --data-urlencode 'query=up{job="agent-demo"}' \
  | jq -r '.data.result[0].metric'
```

One series comes back, carrying `job="agent-demo"` and `instance="snip-api:8000"`
from the config and `cluster="obslab"` with `replica="agent"` from the external
labels. The agent is working.

Now try to query the agent itself. `promtool` lives inside the same image:

```bash
docker run --rm --network obsnet \
  --entrypoint /bin/promtool \
  quay.io/prometheus/prometheus:v3.13.1 \
  query instant http://obslab-agent:9090 up
```

You do not get a result. You get an error and a non-zero exit status, because
there is no query API on that port to answer with — the exact wording depends on
your build, but the absence of an answer does not. That is agent mode's whole
trade: it gives up being a database in exchange for being small. Clean up:

```bash
docker stop obslab-agent
```

Two alternatives you will meet. **Grafana Alloy** is the successor to Grafana
Agent, which reached end of life on 2025-11-01 in all of its modes — so any
tutorial telling you to deploy Grafana Agent is describing a dead product.
**vmagent**, from the VictoriaMetrics project, adds built-in sharding and disk
buffering.

## `remote_read`, and why you point Grafana somewhere else

There is a `remote_read` to match `remote_write`, and it is a trap. It fetches
*raw series* for a set of matchers and a time range from the remote end and then
evaluates all of the PromQL locally. There is no pushdown: a year-long
`sum(rate(...))` will try to stream a year of raw samples into your local
Prometheus before it computes anything. It is also listed as unstable for 3.x. Its
legitimate uses are narrow — reading data out of an old server during a
migration, or blending a small remote dataset with `required_matchers` and
`read_recent: false`. It is not how you query long-term storage.

The way you actually query long-term storage is that Thanos, Mimir, Cortex and
VictoriaMetrics all expose a *Prometheus-compatible query API*, and you point
Grafana at that instead of at a Prometheus. Your dashboards do not change. Your
PromQL does not change. That is the punchline of the whole chapter, and it is
why the comparison below is about operations rather than query languages.

One more technique to name and dismiss. Chapter 12 introduced `hashmod` as a
relabel action and did not use it; sharding by target is what it is for. Give
each server a `hashmod` rule with the same `modulus` and a different expected
remainder and each keeps roughly one Nth of the targets. It works, and it costs
you every global query, every alerting rule that spans shards, and N times the
operational work — and changing the modulus later reshuffles nearly every target
and splits every series' history at that moment. Most teams now skip it by
running agents and letting a scalable backend shard for them.

## The map

Everything below solves the same problem the same way. Get data off the
Prometheus box — either by uploading its finished two-hour blocks to **object
storage** (a bucket: S3, GCS, Azure Blob, MinIO — effectively infinite, cheap,
durable, high-latency, no indexes) or by receiving `remote_write` into their own
ingesters. Put a stateless query layer in front that merges recent data with
older data from the bucket and speaks the Prometheus HTTP API. Compact and
downsample in the background so year-long queries stay cheap.

This is a map, not a tutorial. None of these is something you deploy in your
first year, and each would be its own book.

| | Thanos | Mimir | VictoriaMetrics |
|---|---|---|---|
| Version | v0.42.2 | 3.1.x | v1.148.x |
| License | Apache-2.0 | AGPL-3.0 | Apache-2.0 |
| Prometheus | Adds on to yours | Replaces storage | Replaces storage |
| Storage | Object storage | Object storage | Local disk |
| Smallest sane | 5 components | one process | **one binary** |

Thanos bolts onto the servers you already have: a sidecar next to each
Prometheus uploads blocks and serves recent data, a store gateway serves the
bucket, and a stateless query component fans out, merges and deduplicates. Pick
it when you like your existing servers and want a global view with the least
disruption. One warning belongs in any mention of it: only **one** compactor may
ever run against a single bucket, because object stores have no safe locking and
two compactors corrupt data in a way with no easy repair.

Mimir is a Cortex fork that replaces Prometheus's storage entirely — you write
into it and you query it. Multi-tenant by default, meaning one deployment
serving several independent teams whose data must not mix. Pick it for a platform team
on Kubernetes with real tenant isolation requirements; its floor of operational
complexity is genuinely higher than the others'.

VictoriaMetrics is a from-scratch database that speaks Prometheus's ingestion
and query APIs, stores on ordinary disks, and runs as a single binary on one VM.
It queries in MetricsQL, a superset of PromQL with some deliberate behavioral
differences. Pick it for the least operational surface per unit of capacity.
Watch two things: downsampling and retention filters are Enterprise features,
and `-retentionPeriod` is in **months** when you give it no unit, so
`-retentionPeriod=7` is seven months and not seven days.

That leaves one self-hosted system and three services:

| Option | What it is |
|---|---|
| Cortex v1.21.1 | Mimir's ancestor; CNCF Incubating, still releasing |
| Grafana Cloud | Hosted metrics; ingests `remote_write` and more |
| AMP (Amazon) | `remote_write` with SigV4; managed rules and alerts |
| GMP (Google) | **Does not accept `remote_write`** |

Cortex is not dead. The 2022 story — Grafana forked it into Mimir, everyone
left — was true at the time and is stale now: it is CNCF Incubating, not
archived, and shipped v1.21.1 in June 2026 under new maintainers. Where you are
most likely to meet it is underneath Amazon's managed service.

Grafana Cloud's free tier publishes a 14-day retention; it does not publish an
active-series number on that page, so do not plan against one you read
elsewhere. Amazon Managed Service for Prometheus takes `remote_write` at a
SigV4-signed endpoint, which is why the `sigv4:` block exists in the
`remote_write` config. Its query time range is capped at 95 days even though it
stores far longer — the sort of asymmetry that only bites after you commit.

Google Cloud Managed Service for Prometheus is the trap, because everything else
on this list makes you assume it works like AMP. It does not accept
`remote_write` at all. Prometheus's own configuration reference says so, in a
warning inside the `google_iam` block: remote write is not supported by Google
Cloud, and the setting is reserved for future use. On GCP you run their own
collectors instead.

### Alertmanager, in two sentences

If both Prometheus replicas evaluate the same alerting rules then both of them
fire, by design, and deduplicating *notifications* is Alertmanager's job rather
than yours — so each Prometheus should list every Alertmanager in its
`alerting:` block, and the Alertmanagers gossip among themselves to agree on who
sends the page. That gossip is the reason `compose.yaml` publishes 9094 on UDP
as well as TCP, as Chapter 17, "Alertmanager: Routing, Grouping and Silence",
noted: an HA Alertmanager cluster behind a load balancer is a broken design for
the same reason an HA Prometheus pair behind one is.

## Common mistakes

**Believing a load balancer in front of two replicas is high availability.** It
is availability for *scraping* and a flap for *querying*. The fix is a
replica-aware query layer or receiver-side deduplication, and Grafana has
neither.

**Getting the replica label backwards.** Thanos wants the replicas to differ.
VictoriaMetrics wants them byte-identical. Mimir and Cortex want `cluster` plus
`__replica__` and strip the replica label from the winner. Both wrong
combinations fail silently, one by storing two copies forever and the other by
leaving real gaps in your graphs.

**Copying `queue_config` from a blog post.** `max_shards` is 50, not 200.
`max_samples_per_send` is 2000, not 500. `max_backoff` is 5s, not 100ms.
`send_exemplars` is false. Since 3.12.0 a malformed `queue_config` is rejected
at load time instead of panicking at runtime — which catches typos and not
wrong numbers.

!!! pitfall "Ignoring 429"
    `retry_on_http_429` defaults to **false**, so a throttled sender drops the
    samples it could not send and says nothing. Against a managed backend this
    is the most likely way you will lose data, and you will discover it from a
    hole in a graph weeks later. Turn it on when your receiver throttles, and
    pair it with a `sample_age_limit` so the queue does not spend its life
    retrying samples the receiver will refuse as too old anyway.

**Using the deprecated lag metric.** The old server-wide
`..._highest_timestamp_in_seconds` was deprecated in 3.7.0 along with the
`*_in_total` family. If your expression contains
`ignoring(remote_name, url) group_right`, it is a copy of a dashboard older
than the metric it should be using.

**Federating everything.** `/federate` is a scrape, it renders every matched
series into one response every interval, it downsamples silently to the parent's
interval, it cannot backfill, and it takes nothing off the child. Federate
recording-rule output or do not federate.

**Forgetting `honor_labels: true` on a federation job.** The parent overwrites
`job` and `instance` on everything it federates and files the originals under
`exported_job` and `exported_instance`. Every rule and every dashboard that
referenced them stops matching, and nothing errors.

## Summary

The honest order of operations is: reduce cardinality, buy a bigger box, shorten
local retention and ship the data elsewhere. Everything past that is bought with
operational complexity, and what usually buys it is blast radius rather than
ingestion rate.

Two identical Prometheus servers are not a cluster. They are two independent
copies that happen to look at the same targets, which buys scrape availability
and nothing else — and the moment you hide the pair behind one address you have
built a flap instead of a fix. `remote_write` is the primitive that matters: it
runs beside everything else the server does, it survives the receiver going
away, and it is configured almost entirely by leaving the defaults alone, as
long as you know what they actually are.

The durable takeaways:

- External labels travel out and are invisible locally. That is what makes both
  HA deduplication and remote write possible, and you can prove it with one
  empty query result.
- A load balancer in front of an HA pair is not HA. Deduplication lives in a
  replica-aware query layer or at the receiver, never in the balancer.
- Thanos wants different replica labels; VictoriaMetrics wants identical ones;
  Mimir and Cortex want `cluster` plus `__replica__` and strip it on ingest.
- Federation is a scrape. It downsamples, cannot backfill, and does not reduce
  the child's storage. It is for aggregates and small global views.
- Remote write lag is
  `..._queue_highest_timestamp_seconds - ..._queue_highest_sent_timestamp_seconds`,
  with no vector-matching modifiers; the version with `ignoring()` is deprecated.
- `retry_on_http_429` is false by default, so throttled samples are dropped
  silently.
- Remote Write 2.0 is still experimental and still not the default, and a v2
  payload sent to a careless v1 receiver can return 2xx having stored nothing.
- Agent mode is stable, scrapes and ships, and cannot answer a query. You do not
  query long-term storage through `remote_read` either — you point Grafana at
  the backend's Prometheus-compatible query API and nothing else changes.

## Exercises

!!! exercise
    **1. Two servers behind one proxy (warm-up).** Put both servers behind a
    round-robin proxy — a dozen lines of Caddy is enough — and add a Grafana
    data source pointing at the proxy. Put a Stat panel showing
    `sum(rate(snip_http_requests_total[5m]))` on screen and refresh it ten
    times. Write down the sequence of values, then explain in two sentences
    why no Grafana setting fixes it.

    **2. `external_labels`, three ways (core).** Write out `external_labels`
    three ways: Thanos-style, Mimir/Cortex-style, VictoriaMetrics-style. For
    each, name the backend it is correct for and say what goes wrong if you
    send it to the other two. You should end with six sentences, four of
    them describing a failure that produces no error message.

    **3. Federate the recording rules (core).** Add a federation job to the
    primary that federates `{__name__=~"job:.*"}` from `prometheus-b`, and
    confirm the series arrive by finding one carrying `replica="b"`. Then
    measure the response body for that selector and for `{__name__!=""}`
    with `wc -c`, and extrapolate the second number to a server with a
    million series.

    **4. Turn off `honor_labels` (core).** Remove `honor_labels: true` from
    that federation job and reload. Query one federated series and report
    what `instance` and `job` now contain, and where the original values
    went.

    **5. How many seconds your queue holds (stretch).** Using
    `rate(prometheus_tsdb_head_samples_appended_total[5m])` for your ingest
    rate and the queue geometry `max_shards * (capacity +
    max_samples_per_send)`, compute how many seconds of samples your
    configured queue holds. Then pause the receiver, watch
    `prometheus_remote_storage_samples_pending` plateau, and explain where
    the samples beyond that plateau are being kept — and why nothing was
    lost.

    **6. When to leave 429 retries off (stretch).** Set `retry_on_http_429:
    true` and reload. Then describe a receiver for which you would
    deliberately leave it false, and name the metric that would tell you the
    decision had cost you data.
