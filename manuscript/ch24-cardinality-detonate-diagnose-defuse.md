# Chapter 24 — Cardinality: Detonate, Diagnose, Defuse

The change that takes a monitoring system down is almost never a change to the
monitoring system. It is one line in an application, written on a Tuesday, by
somebody answering a reasonable question. *Which short code was that?* One
label. It passes review, because it is one label. It passes the tests, because
the tests do not count series. It ships, and the service it was added to keeps
working perfectly — same latency, same error rate, same everything.

Then Prometheus starts using memory faster than it can be given, queries that
took a fifth of a second take nine, the dashboards that would have told you
what was happening go blank because the thing drawing them is the thing dying,
and the kernel kills the container for using more memory than it was allowed.
Nothing appears in the application logs, and no alert fires about the label,
because nobody has ever written one. The postmortem sentence is always the
same: *we added a label.*

Chapter 7, "Labels, and the Cardinality Arithmetic You Must Do First", gave you
the arithmetic that prevents this, and you did it on paper before you had
enough series for the answer to matter. Reading about it is not the same as
watching it. So set it off on purpose, on your own machine, with a switch you
can turn back off — then find it the way you would find somebody else's, in the
order you would really reach for the tools.

!!! objectives "Objectives"
    After this chapter you can:

    - Detonate a cardinality bomb deliberately and watch it in three different
      metrics at once.
    - Diagnose an unfamiliar cardinality incident top-down, in the order a
      practitioner actually reaches for the tools.
    - Distinguish cardinality from churn, and say which of the two is worse.
    - Rank the four cures and say when each one is the right answer.
    - Apply the emergency scrape-side brake, and state exactly what it costs.
    - Explain why series do not disappear the moment you stop creating them.

## Where the lab is

This runs against the stack as Chapter 23, "The Multi-Target Pattern: Probing
From Outside", left it: Snip behind `edge`, the exporters from Chapter 22,
"Metrics From Things You Didn't Write", Chapter 23's probe jobs, and everything
built before them.

```bash
cd lab
git checkout ch24
make check
make up
make ps
```

Prometheus is on `http://localhost:9090/`, Snip on `http://localhost:8080/`,
Grafana on `http://localhost:3000/`, and the load generator's control API on
`http://localhost:8089/`. Put the injector into a known state so that nothing
else moves while you work:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","error_ratio":0}'
```

Two things in `lab/prometheus/prometheus.yml` matter today, and both are this
chapter's own work, shipped finished — every tag holds the state its chapter
*ends* in. Under the `snip-api` job sits a commented-out pair of lines with a
long note over them, which Chapter 12, "`prometheus.yml` in Full: Service
Discovery and Relabeling", told you to leave alone. That is the emergency
brake, and you will pull it in anger shortly. At the head of the same job are
two more lines:

```yaml
  - job_name: snip-api
    # (ch24) Guard rails, added after the reader has detonated the
    # cardinality bomb once. Both are all-or-nothing: breach either and
    # the WHOLE scrape fails with up == 0. Nothing is truncated.
    sample_limit: 5000
    label_limit: 20
```

Those are the guard rails this chapter builds, and they work — which is a
problem for a chapter whose first act is to drive off the cliff. With
`sample_limit: 5000` armed, the bomb kills the *scrape* within a minute and
never reaches the database. Take that one rail off for the detonation and put
it back when you have earned it: comment it out, leave `label_limit: 20` alone,
and have Prometheus re-read the file.

```yaml
    # sample_limit: 5000
    label_limit: 20
```

```bash
make reload
```

```text
reloaded
```

!!! warning
    The cardinality scenario is the one exercise here that can make your laptop
    unhappy. Prometheus is given a 2 GB memory ceiling by `mem_limit: 2g` in
    `lab/compose.yaml`, and the scenario is designed to walk it toward that
    ceiling. If you have less than about 6 GB of memory free, read the chapter
    through first and run the scenario at `DURATION=180` rather than at its
    default of 480 seconds.

## Where the series actually are

Before you break anything, find out what you have. Chapter 7 counted Snip. Now
count the whole database, which is one query:

```promql
topk(12, count by (job) ({__name__=~".+"}))
```

That selector says "every series that has a name", which is every series;
`count by (job)` collapses each job to a number. On the reference stack it
returned these twelve rows.

| Job | Series | Stable? |
|---|---|---|
| `catalog` | 3,302 | growing |
| `prometheus` | 1,274 | steady |
| `cadvisor` | 1,166 | steady |
| `node-exporter` | 1,001 | steady |
| `postgres-exporter` | 655 | steady |
| `alertmanager` | 570 | steady |
| `redis` | 514 | steady |
| `loadgen` | 177 | steady |
| `snip-api` | 170 | steady |
| `blackbox` | 74 | steady |
| `snip-worker` | 63 | steady |
| `pager` | 21 | steady |

Your own numbers will be close but not identical, and one of them will be
roughly double: that capture ran a single `snip-api` container, `make up` has
started two replicas since Chapter 12, and every series a target produces
exists once per target. `node-exporter` scales with your filesystems and
network interfaces, `cadvisor` with your container count, and `snip-api` with
how much of Snip's behavior your traffic has covered — the latency histogram
alone contributes sixteen series for every route-method-code combination that
has occurred: fourteen buckets plus `_sum` and `_count`.

And one row is larger every single time you look. `catalog` is growing, because
of the defect you found by arithmetic in Chapter 7 and will repair at the end
of this chapter. One metric reports the whole total without the arithmetic:

```promql
prometheus_tsdb_head_series
```

Write down what it says. That number is the most important one in the operation
of a Prometheus server, you will watch it for the rest of the chapter, and you
cannot grade a recovery you took no baseline for. It counts **active series**:
series that exist in memory right now, being written to, each holding one entry
in an in-memory index.

!!! iou "IOU — chapter 25"
    Prometheus does not write each sample straight into its final resting
    place. Recent data lives in memory and is periodically cut out to a
    permanent block on disk, and `prometheus_tsdb_head_series` counts what is
    in the in-memory part — the *head*. Two rules follow, and this chapter uses
    both before either is explained: a series stays active until it stops being
    written **and** the head is next emptied, which is two separate clocks; and
    memory is a function of active series rather than of how long you keep
    data, so shortening retention reclaims disk and does nothing measurable for
    an out-of-memory kill. Chapter 25, "Storage, Retention, Backups and Locking
    the Door", takes that layer apart and settles both.

## Cardinality, churn, and which one is worse

Chapter 7 drew this distinction on paper. Here is the operational version.

**Cardinality** is how many distinct series a metric family has right now. A
thousand shard names that have been the same for two years is a cardinality of
a thousand: costed once, paid for continuously, irritating and survivable.

**Churn** is how fast the *set* changes. A `container_id` or a `pod` label
whose value differs after every deploy has a cardinality of a thousand too, at
any instant. But every deploy strands a whole generation. The old series are
not overwritten and not reclaimed; they stay in memory until the head is next
cut, and on disk for the retention window. Four deploys a day for a week is not
a thousand series. It is twenty-eight thousand, and every diagnostic that
samples the present still reports one thousand.

Churn is strictly worse, for a reason that has nothing to do with the numbers:
cardinality announces itself and churn does not. A high-cardinality label is a
big number in a table you can sort. A high-churn label is a small number in
that same table, and a graph that creeps. Prometheus counts the creation events
for you:

```promql
rate(prometheus_tsdb_head_series_created_total[5m])
```

On the lab at rest this reads somewhere around nine new series a second, which
is higher than most people guess and entirely explained: Snip's links expire,
the working set of short codes turns over continuously, and `bookIDFor` in
`lab/snip/api.go` maps each new code onto a `book_id` that `catalog` has never
seen. Sustained, a number like that is how you notice a label no other
diagnostic reports as a problem. The five-second test for any proposed label is
still Chapter 7's: *does this value change when nothing about the world
changed?* A deploy is not a change in the world.

## Light the fuse

Snip carries a switch that adds the short-link code as a label on
`snip_http_requests_total`. Two places in the source do the work. In
`lab/snip/metrics.go`, the label list:

```go
requestLabels := []string{"route", "method", "code"}
if c.UnboundedLabel {
	requestLabels = append(requestLabels, "link_code")
}
```

And in `lab/snip/api.go`, the value, handed to `promhttp`'s documented escape
hatch for deriving a label from the request:

```go
if s.cfg.UnboundedLabel {
	countOpts = append(countOpts,
		promhttp.WithLabelFromRequest("link_code", linkCodeLabel))
}
```

```go
func linkCodeLabel(r *http.Request) string {
	return r.PathValue("code")
}
```

That is the whole bug: six lines, each defensible on its own, together the
single most common way a real Prometheus is killed. Turn it on. Your `.env`
already carries `SNIP_UNBOUNDED_LABEL=0`, and Compose reads that file top to
bottom with the last assignment winning, so appending one line is enough:

```bash
echo 'SNIP_UNBOUNDED_LABEL=1' >> .env
make up
```

Confirm the label is real before you spend eight minutes on it. One scrape
interval after the containers come back:

```promql
count(snip_http_requests_total{link_code=~".+"})
```

A small number — one per short code the lab has served since the restart. Ask
it the wrong way and you will fool yourself: `count(count by (link_code) (...))`
returns `1` when the label is *absent*, because every series then falls into
the same nameless group. A selector demanding at least one character is the
honest question.

Now light it:

```bash
./scripts/scenario-cardinality.sh
```

The script refuses to run if the switch is off, because without it this is
ordinary traffic and proves nothing. With the switch on, it drives 300 requests
a second at `/l/{code}`, every one asking for a different, non-existent short
code. Here is the reference run, heavily abridged — it prints a line every
thirty seconds, not only at the moments shown:

```text
  prometheus RSS at start: 0.24 GB

  [  30s] head series     14900  (  2.5x)  RSS 0.33 GB
  [ 300s] head series     95200  ( 15.7x)  RSS 1.09 GB
  [ 390s] head series    123100  ( 20.3x)  RSS 1.28 GB
  Reached 20x the baseline. Letting it run on.
  [ 480s] head series    151007  ( 24.9x)  RSS 1.47 GB
```

Your numbers will differ — they depend on your baseline and on how much traffic
the load generator really lands — but the shape will not, and the arithmetic is
worth doing while you watch, because it is the only predictable part. Three
hundred requests a second, each with a code nobody has used before, each
producing exactly one new `(route, method, code, link_code)` combination, is
300 new series a second: 4,500 arriving in every fifteen-second scrape, for
ever, from a service that is otherwise behaving impeccably. Eight minutes of
that is 144,000 series, and the reference stack's baseline of about 6,060 plus
144,000 is the 151,007 on the last line.

Open Grafana and put `prometheus_tsdb_head_series` on a graph while this runs.
It is a hockey stick. Put `process_resident_memory_bytes{job="prometheus"}`
next to it — the resident set size, the memory the operating system has
actually given the process — and the second line has the same shape as the
first, offset by nothing at all. That is the whole chapter in two lines on one
panel: the memory of a Prometheus server is a function of its active series,
and a label is what makes active series.

## Diagnose it three ways

You know the answer. Pretend you do not. Before you run any of the three tools,
write down what you think is wrong and how you would prove it — this is the
only chance you get to practice the diagnosis without already knowing the
answer, and a diagnosis you did not commit to in writing is one you cannot
grade.

**First: the TSDB status page.** It is the thing to open, because it costs
nothing and answers the question directly. In the browser it is at
`http://localhost:9090/tsdb-status`. From a terminal it is one endpoint:

```bash
curl -s http://localhost:9090/api/v1/status/tsdb |
  jq '.data.headStats.numSeries'
```

```text
151007
```

That object carries four more fields beside `numSeries` — `numLabelPairs`,
`chunkCount`, and the `minTime` and `maxTime` of the data in memory, as
millisecond timestamps. Then the table that names the culprit:

```bash
curl -s http://localhost:9090/api/v1/status/tsdb |
  jq '.data.seriesCountByMetricName[0]'
```

```json
{ "name": "snip_http_requests_total", "value": 144012 }
```

One metric family holds more than nine-tenths of the database, and the figure
is the arithmetic you did a moment ago. Three more tables sit alongside it —
`labelValueCountByLabelName`, `memoryInBytesByLabelName` and
`seriesCountByLabelValuePair`, all five names printed by `jq '.data | keys'` —
and the reflex worth building is to read every table rather than memorize one
field name. The first is where `link_code` appears with a six-figure count next
to `route`'s single digit, and it is the one table that points at a *label*
rather than a metric. That distinction decides your fix: a metric family that
is too big can be dropped whole, but a label that is too wide has to be removed
from a family you want to keep.

That took about fifteen seconds and it is normally the end of the diagnosis.
The next two tools exist for when it is not.

**Second: `promtool tsdb analyze`.** `promtool` ships inside the Prometheus
image, but that image's entry point is the server, so every invocation
overrides it — the same pattern `make check` uses:

```bash
docker compose run --rm --no-deps -T \
  --entrypoint /bin/promtool prometheus \
  tsdb analyze --extended --limit=20 /prometheus
```

This is a different kind of instrument. The status API describes what is in
memory this second; `analyze` opens the data directory and reports on one
written block. It is the only tool in this chapter that measures **churn**,
because a block knows how many distinct series existed across its whole time
range rather than at one instant — its own one-line description is the
giveaway, *analyze churn, label pair cardinality and compaction efficiency*.
Appendix G, "The `promtool` Cookbook", has the full flag set; the three worth
knowing here are `--extended`, `--limit=20` (which is also the default) and
`--match='{job="snip-api"}'`, and only one matcher set is supported.

!!! trap "The report is about the past, not about now"
    Run `analyze` five minutes into a detonation and the bomb may be entirely
    absent from its output, because the series you created a moment ago are
    still in memory and the most recent *written* block was cut before you
    started. On a lab that has only been up for a couple of hours there is
    nothing on disk at all, and the whole report is one line:

    ```text
    no blocks found
    ```

    Check what exists before you trust an empty answer — `tsdb list -r` prints
    a header row and, on a young stack, nothing underneath it:

    ```bash
    docker compose run --rm --no-deps -T \
      --entrypoint /bin/promtool prometheus \
      tsdb list -r /prometheus
    ```

    This is not a flaw in the tool, it is what the tool is for. Use the status
    API for "what is happening now" and `analyze` for "what has this been
    costing me all week, and is anything churning".

**Third: PromQL.** The slowest of the three and the one you can run from a
dashboard, an alert, or a machine that will not let you into a container:

```promql
topk(10, count by (__name__) ({__name__=~".+"}))
```

That is a genuinely expensive query — it touches every series in the database
to count them — and on a server already in trouble it can be the query that
finishes it off. Run it when the cheap answer is unavailable, not first. With a
suspect family in hand, narrow with two cheap queries instead:

```promql
count(count by (link_code) (snip_http_requests_total))
```

```promql
count(snip_http_requests_total)
```

The first is how many distinct values the label takes; the second is how many
series the family has. Twelve became six figures.

One more pair belongs in your reflexes, because it separates "the target emits
too much" from "we store too much of what it emits". Every scrape, Prometheus
writes down what it saw:

```promql
scrape_samples_scraped{job="snip-api"}
```

```promql
scrape_samples_post_metric_relabeling{job="snip-api"}
```

The first is how many samples the target put on the wire. The second is how
many survived your `metric_relabel_configs`. On a healthy `snip-api` they read
250 and 228, and the gap of twenty-two is exactly the `go_memstats_*` family
Chapter 12 drops at the scrape — count those lines in
`curl -s http://localhost:8080/metrics` and the arithmetic closes. During the
detonation both numbers are enormous, which tells you what the status API
cannot: the application really is generating this, and the fix has to start at
the target.

## The cures, ranked

There are exactly four things you can do about a cardinality problem, and they
are not equal. Rank them by where the fix lives, because that decides how long
it lasts.

| Cure | Where it lives | Lasts |
|---|---|---|
| Fix the application | their repository | for ever |
| Drop it at the scrape | your `prometheus.yml` | until you forget |
| Bound it with limits | your `prometheus.yml` | as a tripwire |
| Delete values in-process | their repository | until restart |

**Fix the application.** Remove the label, or bound its values. This is the
only cure that reduces what is produced, and the only one that is free after it
lands. It is also the slowest: a code change, a review, a deploy, and — if the
code belongs to another team — a conversation.

**Drop it at the scrape.** `metric_relabel_configs` with `drop` (remove whole
series by name) or `labeldrop` (remove one label from every series). This takes
effect in one scrape interval and needs nobody's permission. It is a brake, not
a repair: the application is still producing the data, the network is still
carrying it, and something must keep throwing it away for ever.

**Bound it with limits.** `sample_limit`, `label_limit`,
`label_name_length_limit`, `label_value_length_limit` and `target_limit` are
circuit breakers, not budgets. All five default to zero, meaning no limit, and
none of them trims a scrape down to size: they fail it entirely. Use them to
make a future accident loud, not to manage a known problem.

**Delete stale label values in the process.** Client libraries can forget a
child series: `DeleteLabelValues` in Go's `client_golang`, `.remove()` on a
labeled metric in Python's `prometheus_client`. That suits a bounded set whose
members retire — a worker pool, a set of shard names — and not an unbounded
one, because you would have to know which values to forget, and if you knew
that you would not have the problem. It also only cleans the exporter's memory;
the series already in Prometheus stay exactly where they are.

And the rule that outranks all four: the labels on Chapter 7's always-wrong
list are always wrong. `user_id`, `email`, `session_id`, `request_id`, any
primary key, any UUID, the raw URL path, the raw error string. To get from a
slow graph to the one request that was slow, the feature is an exemplar — a
reference attached to a sample, costing no cardinality at all — and Chapter 29,
"Beyond Metrics: Exemplars, Traces, Logs, and Where to Go Next", turns them on
in this lab. A trace ID is forbidden as a label and free as an exemplar.

## The 3 a.m. fix

It is the middle of the night, the graph is a hockey stick, and the person who
owns that code is asleep. You do not need them. Open
`lab/prometheus/prometheus.yml`, find the `snip-api` job, and uncomment the two
lines at the bottom of its `metric_relabel_configs`:

```yaml
    metric_relabel_configs:
      - source_labels: [__name__]
        regex: go_memstats_.*
        action: drop
      - regex: link_code
        action: labeldrop
```

`labeldrop` is the one relabel action with no `source_labels`: its `regex` is
matched against label *names*, and every label whose name matches is removed
from every series in this scrape. Ask Prometheus to re-read the file:

```bash
make reload
```

The container also runs with `--config.auto-reload`, so the edit would land on
its own shortly; the explicit reload makes it immediate, which at 3 a.m. is the
point. Within two scrape intervals the hockey stick goes flat: not down, flat.
Five minutes later, once the abandoned series have aged past the lookback
window, the label has left the database as far as any query is concerned:

```promql
count(snip_http_requests_total{link_code=~".+"})
```

```text
Empty query result
```

While this is true at the same moment:

```promql
scrape_samples_post_metric_relabeling{job="snip-api"}
```

```text
{instance="snip-api-1", job="snip-api"}   72014
{instance="snip-api-2", job="snip-api"}   71786
```

!!! pitfall "A brake is not a repair, and it is not free"
    Read those two results together. The label is out of the database, and the
    samples still arrive by the tens of thousands, still cross the network,
    still get parsed, still count against any limit you set. `labeldrop` does
    not remove samples — it removes a label, which **merges** the series that
    differed only by it. Seventy thousand samples now land on twelve series in
    one scrape, and all but one per series are discarded as duplicates. The
    counter still exists, still has a value, and that value is now meaningless.
    You have stopped the bleeding and broken the metric: a trade worth making
    at 3 a.m. and not worth making on Monday.

## The real fix, and the two timescales

Monday's fix is the switch. Strip it out of `.env` altogether — with no value
set, `compose.yaml` supplies the default, which is off — and restart:

```bash
grep -v '^SNIP_UNBOUNDED_LABEL=' .env > .env.tmp
mv .env.tmp .env
make up
```

Then take the brake off again: comment those two lines back out and reload. A
brake left engaged is a bug you have hidden from yourself — while that
`labeldrop` is in place, anybody who re-arms the switch sees nothing happen —
which is why the lab ships it commented out rather than armed. If you ever
engage one in anger, open the ticket to remove it in the same minute.

Now watch two numbers behave completely differently. The series actually being
written come back quickly:

```promql
count({job="snip-api"})
```

Within a couple of minutes this is back within a few percent of the baseline
you wrote down at the start of the chapter. The abandoned series stop receiving
samples, and an instant query stops resolving them once they are more than five
minutes stale, which is the `lookback_delta` behavior from Chapter 2, "What's
Actually on the Wire".

The head does not care:

```promql
prometheus_tsdb_head_series
```

It is still six figures, and it will stay six figures. A series leaves memory
when the head is cut into a block, on a roughly two-hour cycle — not when you
stop writing to it. Your memory is not coming back this session. The samples on
disk outlive even that: expired-block cleanup is background work and may take
up to two hours after the data falls outside the retention window.

This is the shape of every cardinality incident. The damage is done the moment
the series is created, so stopping the creation stops it getting worse and does
nothing about what already happened. On a real server against a real memory
ceiling the sequence is: stop the creation, then restart Prometheus if you
cannot wait for the head to be cut.

## Guard rails

This chapter is here and not in Part I because you now have enough series for a
limit to be meaningful. Measure before you choose one:

```promql
max_over_time(
  scrape_samples_post_metric_relabeling{job="snip-api"}[1h])
```

About 228 samples per target, once the detonation has aged out of the hour. Now
put the guard rail back, knowing what the number means:

```yaml
  - job_name: snip-api
    sample_limit: 5000
    label_limit: 20
```

Five thousand is roughly twenty times the honest figure, and that is
deliberate: a limit is a tripwire for an accident, not a budget for normal
growth. Set it at twice your current usage and a feature launch will wake you
up; set it where no legitimate change could ever reach and only a mistake can
trip it.

`label_limit: 20` guards a different failure, and it would not have caught
today's bomb. It limits how many labels a single sample may carry after
relabeling, and Snip's widest series carries eight counting the metric name:
`snip_http_request_duration_seconds_bucket`, with `route`, `method`, `code` and
`le` from the application and `env`, `instance` and `job` from the scrape. The
bomb takes `snip_http_requests_total` from seven to eight. Twenty is nowhere
near either. What `label_limit` catches is an exporter that copies every
container label onto every series it emits, and a milder version is already in
your stack: on the reference run the third-heaviest entry in
`memoryInBytesByLabelName` was a cAdvisor `container_label_*` name, behind only
`__name__` and `instance`. Which one depends on what your Docker installation
puts on containers; that it is one of them does not.

Reload, then prove the limit is armed by breaching it on purpose:

```bash
make reload
echo 'SNIP_UNBOUNDED_LABEL=1' >> .env
make up
DURATION=90 ./scripts/scenario-cardinality.sh
```

Ninety seconds is more than enough. Measured on the reference stack, one
replica breaches inside thirty seconds and both are down inside ninety. Watch
`http://localhost:9090/targets`:

!!! trap "The whole scrape fails, and nothing is truncated"
    ```text
    snip-api   snip-api-1   DOWN   sample limit exceeded
    snip-api   snip-api-2   DOWN   sample limit exceeded
    ```

    ```promql
    up{job="snip-api"}
    ```

    ```text
    {instance="snip-api-1", job="snip-api"}   0
    {instance="snip-api-2", job="snip-api"}   0
    ```

    Not the first five thousand samples. Not the ones with short names.
    Nothing. Snip answers every request correctly and its entire metric surface
    is gone: request rate, latency histogram, cache hit ratio, every panel,
    every alert expression — and five minutes later, when the last stored
    samples fall outside the lookback window, the queries stop returning
    anything at all. The limit did its job, its job is brutal, and you want to
    know that before you set one rather than after.

One detail saves you in the aftermath, so look while the target is down.
`scrape_samples_post_metric_relabeling{job="snip-api"}` keeps being recorded
through every failed scrape, and keeps climbing — on the reference run it
reached 130,046 samples the database never stored. A dead target still tells
you how much it tried to send, which is the number that decides whether to
raise the limit or fix the producer. Here it says the producer, by a factor of
twenty-six.

Strip the switch out of `.env` again, run `make up`, and confirm that both
targets return to `up == 1` within a scrape interval. Leave the two limits in
place. They are this chapter's permanent deliverable, and Chapter 25 expects to
find them.

## Somebody else's bomb

Chapter 7 had you find a defect in `catalog` — another team's service, which
you diagnose and never own — by arithmetic alone, and told you not to fix it.
The bill has been arriving ever since. Look at it now:

```promql
count(catalog_lookups_total)
```

```promql
count(count by (book_id) (catalog_lookups_total))
```

Both return the same four- or five-figure number, both are larger than the last
time you looked, and on any stack that has been up a few hours this one counter
tops two of the four status-API tables at once:

```bash
curl -s http://localhost:9090/api/v1/status/tsdb |
  jq '.data.labelValueCountByLabelName[:3]'
```

```json
[
  { "name": "book_id", "value": 8807 },
  { "name": "__name__", "value": 1418 },
  { "name": "le", "value": 113 }
]
```

That is one reading on one afternoon, and the only number in it that will not
have moved by tomorrow is 113. A counter whose honest cardinality is two —
`result="hit"` and `result="miss"` — has one label with more distinct values
than the whole server has metric names. `lab/catalog/metrics.py` explains
itself:

```python
LOOKUPS = Counter(
    "catalog_lookups",
    "Catalog lookups by book and result.",
    ["book_id", "result"],
)
```

Apply the ranking you learned, in order. The emergency brake first, on the
`catalog` job this time:

```yaml
    metric_relabel_configs:
      - source_labels: [__name__]
        regex: python_gc_.*
        action: drop
      - regex: book_id
        action: labeldrop
```

Run `make reload`, wait five minutes for the abandoned series to age out of the
lookback window, and `count(catalog_lookups_total)` reads `2`. Then take those
two lines straight back out and reload again, because this one is not your 3
a.m. and nobody is paging you: a brake left on would hide a live defect from
the only team that can repair it.

The real fix is a code change you do not own, so you propose it — and the lab
lets you test the proposal first, because `catalog` reads three switches at
import time and one of them is exactly this fix:

```bash
echo 'CATALOG_FIX_CARDINALITY=1' >> .env
docker compose up -d catalog
```

Five minutes later `count(catalog_lookups_total)` is `2`, permanently, and
nothing else about the service has changed. Now write the pull request. A good
one is short, states the cost in units the owner cares about, and answers the
question the label was trying to answer:

```text
catalog: drop book_id from catalog_lookups_total

book_id comes straight off the URL path of GET /books/{id} and
nothing bounds it. It is not validated as a number, and a miss
is labeled too, so any caller — including a scanner walking
/books/1 upward — mints series that are never reclaimed. The
catalog holds 200,000 entries.

In our monitoring stack this one counter is the largest metric
family in the database, and book_id has more distinct values
than the server has metric names.

The diff is two lines: drop "book_id" from the label list and
from the .labels() call. Cardinality goes from unbounded to two.

Per-book hit rates are a real question and a good one. They
belong in the request log or an analytics table, where the cost
is linear in what you store rather than permanent in memory.
```

Then strip `CATALOG_FIX_CARDINALITY` out of `.env` and restart `catalog`. The
switch exists so you can test a proposal, not so you can fix somebody else's
service behind their back, and every later chapter describes a lab in which
that defect is still open. That is the whole job: find it by arithmetic, cost
it in numbers the owner recognizes, propose the two-line diff, and name a
better home for the question somebody was genuinely trying to answer.

!!! selfcheck "Self-check"
    With the switch off, the `labeldrop` commented out and both guard rails
    back in place, run `make verify-ch24`. It arms `SNIP_UNBOUNDED_LABEL`
    itself, detonates, and puts your `.env` back afterward. It opens by naming
    which of this chapter's two brakes it is standing behind, and because you
    restored the guard rail it is the `sample_limit` one, so it proves the
    tripwire instead of the explosion:

    ```text
    ch24: 8 passed, 0 failed, 1 skipped
    ch24 OK
    ```

    The skip is the twentyfold rise in head series, and it is correct: the
    scrape dies before the head can grow, which is the guard rail working, and
    the script prints the one-line edit that takes the rail off for a run.
    Then check three things by hand: `count({job="snip-api"})` is back within a
    fifth of your baseline, `count(snip_http_requests_total{link_code=~".+"})`
    is empty, and `up{job="snip-api"}` reads `1` for both replicas.

## Common mistakes

**Shortening retention to stop an out-of-memory kill.** The most common wrong
move, and wrong for a structural reason rather than a tuning one. Retention
governs how long samples stay on disk; the kill is about active series in
memory. Halving retention halves your disk and changes your memory by nothing
measurable. The fix for memory is fewer active series.

**Reading `sample_limit` as truncation.** It is the mistake the name invites.
All five of those limits fail the whole scrape, so setting one on a job you
have not measured converts a slow growth in cardinality into a total blackout
of that target — at the exact moment you most need to see it. Measure first,
then set the limit where no honest change reaches.

**Trusting an instantaneous count on a churning label.** `count(count by (pod)
(x))` is a photograph. A label that turns over on every deploy photographs
beautifully and bills you by the week. Use the rate of
`prometheus_tsdb_head_series_created_total`, or the churn tables in
`promtool tsdb analyze`: the only two things here that see across time.

**Assuming the series are gone because the query is empty.** An instant query
stops resolving a series about five minutes after its last sample. The series
is still in memory, still counted by `prometheus_tsdb_head_series`, still part
of your memory bill, until the head is cut. "I cannot see it" and "it is not
there" are different statements, and only one of them is about your memory.

## Summary

Cardinality is not a performance topic. It is the one failure mode where a
change to an application takes down the system that was supposed to be watching
it, and it arrives disguised as a small, sensible improvement. You have caused
it, watched three separate metrics react, found it three different ways,
stopped it in fifteen seconds without a deploy, repaired it properly, and built
the tripwire that makes the next one loud — and you have felt the part no
amount of reading conveys, which is that the recovery is not symmetrical with
the damage.

The durable takeaways:

- `prometheus_tsdb_head_series` is the number. Graph it, and alert on its rate
  of change rather than its value, because the value is different at every site
  and the slope is not.
- The diagnostic order is `/api/v1/status/tsdb` first because it is cheap and
  direct, `promtool tsdb analyze` when you need history or churn, and
  `topk(count by (__name__))` when you can reach neither.
- `scrape_samples_scraped` against `scrape_samples_post_metric_relabeling`
  tells you whether the target produces too much or you store too much of what
  it produces — and both keep being recorded while the target is down.
- The cures are ranked: fix the application, drop it at the scrape, bound it
  with limits, delete stale values in-process. Only the first is free once it
  lands, and `labeldrop` buys time by merging series and breaking the metric.
- Scrape limits are tripwires that fail the entire scrape and take the target's
  `up` to `0`. Measure first, then set them where only a mistake can reach.
- Series stop being written immediately and stop being counted hours later.
  Memory tracks active series; retention does not touch them.

## Exercises

!!! exercise
    **1. Predict the blast radius (warm-up).** Before you detonate, use the
    worksheet from Chapter 7 to predict the peak of
    `prometheus_tsdb_head_series` after eight minutes at 300 requests a second.
    Write the number down, then run `./scripts/scenario-cardinality.sh` and
    compare. You should be within a factor of two. If you are not, find which
    input was wrong: the arrival rate, the baseline, or the series per request.

    **2. One tool only (core).** Detonate again, let the stack run for a few
    hours so the head is cut into a block, and then diagnose the incident using
    nothing but `promtool tsdb analyze`. Time yourself. Then write one sentence
    on what it told you that `/api/v1/status/tsdb` could not, and one on what
    the status API told you that it could not.

    **3. Churn instead of cardinality (core).** Snip's `snip_build_info`
    carries a `commit` label, and `SNIP_COMMIT` sets it. Simulate five deploys:

    ```bash
    for c in b2c3d4e c3d4e5f d4e5f6a e5f6a7b f6a7b8c; do
      SNIP_COMMIT=$c docker compose up -d \
        --scale snip-api=2 snip-api
      sleep 45
    done
    ```

    Ask two questions immediately afterward: `count(count by (commit)
    (snip_build_info))` and `count(snip_build_info)`. Ask both again ten
    minutes later. Which diagnostic reports a problem, which reports that
    everything is normal, and what does `prometheus_tsdb_head_series` say
    about which of them is right?

    **4. `labeldrop` against `drop` (core).** Detonate, then defuse twice:
    once with `labeldrop` on `link_code`, and once with a `drop` on
    `__name__` matching `snip_http_requests_total`. For each, record
    `count(snip_http_requests_total)` and
    `scrape_samples_post_metric_relabeling{job="snip-api"}`. State the
    difference in one sentence about what remains.

    **5. A different limit, a different failure (stretch).** Put
    `label_value_length_limit: 32` on the `catalog` job and reload, then ask
    `catalog` for a book id far longer than that:

    ```bash
    curl -s "http://localhost:8081/books/$(printf 'x%.0s' {1..64})"
    ```

    Does the target fail the same way a breached `sample_limit` does, and does
    the message on `/targets` tell you more or less than the sample-limit one
    did? Take the limit back out afterward.

    **6. Three sentences (warm-up).** Write the incident summary you would
    post after resolving this: what happened, what you did, what stops it
    happening again. Three sentences, no more. If you cannot write the third
    one, you closed the incident too early.
