# Chapter 24 — Cardinality: Detonate, Diagnose, Defuse

The change that takes a monitoring system down is almost never a change to the
monitoring system. It is one line in an application, written on a Tuesday, by
somebody answering a reasonable question. *Which short code was that?* One
label. It passes review, because it is one label. It passes the tests, because
the tests do not count series. It ships, and the service it was added to keeps
working perfectly — same latency, same error rate, same everything — for about
four minutes.

Then Prometheus starts using memory faster than it can be given, queries that
took a fifth of a second take nine, the dashboards that would have told you
what was happening go blank because the thing drawing them is the thing dying,
and somewhere in the next twenty minutes the container is killed by the kernel
for using more memory than it was allowed. Nothing in the application logs. No
alert fires about the label, because nobody has ever written one. The postmortem
sentence is always the same: *we added a label.*

Chapter 7, "Labels, and the Cardinality Arithmetic You Must Do First", gave you
the arithmetic that prevents this, and you did it on paper before you had
enough series for the answer to matter. Reading about it is not the same as
watching it. This chapter makes you set it off on purpose, on your own machine,
with a switch you can turn back off — and then teaches you to find it the way
you would find somebody else's, in the order you would really reach for the
tools.

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
"Metrics From Things You Didn't Write", the probe jobs from Chapter 23, and
everything the chapters before them built. The `ch24` tag already holds this
chapter's permanent deliverable — `sample_limit` and `label_limit` on the
`snip-api` job — to read along with. Those limits stop the bomb this chapter
detonates, so to work through it, check out `ch23` instead; every step in this chapter
starts there.

```bash
cd lab
git checkout ch24
make up
make ps
```

Prometheus is on `http://localhost:9090/`, Snip on `http://localhost:8080/`,
Grafana on `http://localhost:3000/`, the load generator's control API on
`http://localhost:8089/`. Put the traffic into a known state so that nothing
else moves while you work:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","error_ratio":0}'
```

Two things about `lab/prometheus/prometheus.yml` matter today. Under the
`snip-api` job there is a commented-out pair of lines with a long note above
them — the one Chapter 12, "`prometheus.yml` in Full: Service Discovery and
Relabeling", told you to leave alone. That is this chapter's emergency brake and
you will pull it in anger shortly. And the `snip-api` job has no `sample_limit`
and no `label_limit` yet. Chapter 12 promised that this chapter would add them
and explain the numbers. It does, at the end, once you have seen what they are
for.

!!! warning
    The cardinality scenario is the one exercise in this book that can make
    your laptop unhappy. Prometheus is given a 2 GB memory ceiling in
    `compose.yaml`, and the scenario is designed to walk it toward that
    ceiling. If you have less than about 6 GB of memory free, read the chapter
    through first and run the scenario at `DURATION=180` rather than the
    default.

## Where the series actually are

Before you break anything, find out what you have. Chapter 7 counted Snip. Now
count the whole database, which is one query:

```promql
topk(12, count by (job) ({__name__=~".+"}))
```

That selector says "every series that has a name", which is every series;
`count by (job)` collapses each job to a number. On the stack this book was
measured against, it returned these twelve rows.

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

Your own numbers will be close but not identical, because several of them scale
with your machine — `node-exporter` grows with your filesystems and network
interfaces, `cadvisor` with your container count. One row will be larger than
the figure printed here, and it will be larger every time you look: `catalog`
is growing, and it is growing because of a defect you found by arithmetic in
Chapter 7 and are going to fix at the end of this chapter.

Add those up and the whole database is somewhere around nine thousand series.
That is the number to hold on to, and there is a single metric that reports it
without the arithmetic:

```promql
prometheus_tsdb_head_series
```

This is the most important number in the operation of a Prometheus server, and
it is the one you will watch for the rest of the chapter. It counts **active
series**: series that currently exist in memory, being written to, one entry
each in an in-memory index.

!!! jargon "Head block"
    Prometheus does not write each sample straight into its final resting
    place. Recent data lives in the **head block** — an in-memory structure
    holding roughly the last couple of hours — and is periodically cut into a
    permanent block on disk. `prometheus_tsdb_head_series` counts the series in
    that in-memory structure. That is why it tracks memory use so closely, and
    why, as you are about to see, it does not fall the instant you stop
    producing a series. Chapter 25 takes the storage layer apart properly; for
    today, "the head is what is in memory right now" is the whole model you
    need.

Two consequences follow from "active series" and are worth stating before you
need them. Memory tracks active series, not how long you keep data. Shortening
your retention window — how long samples are kept on disk — reclaims disk and
does approximately nothing for an out-of-memory kill, because the kill is about
what is in the head. And a series stays active until it stops being written
*and* ages out of the head, which is two separate clocks.

## Cardinality, churn, and which one is worse

Chapter 7 drew this distinction on paper. Here is the operational version.

**Cardinality** is how many distinct series a metric family has right now. A
thousand shard names that have been the same for two years is a cardinality of
a thousand: costed once, paid for continuously, irritating and survivable.

**Churn** is how fast the *set* changes. A `container_id` or a `pod` label
whose value is different after every deploy has a cardinality of a thousand too
— measured at any instant. But every deploy strands a whole generation. The old
series are not overwritten and they are not reclaimed; they stay in the head
until it is cut, and their samples stay on disk for the retention window. Four
deploys a day for a week is not a thousand series. It is twenty-eight thousand,
and every diagnostic that samples the present still reports one thousand.

Churn is strictly worse, for a reason that has nothing to do with the numbers:
cardinality announces itself and churn does not. A high-cardinality label is a
big number in a table you can sort. A high-churn label is a small number in
that same table, and a graph that creeps. Prometheus counts the creation events
for you:

```promql
rate(prometheus_tsdb_head_series_created_total[5m])
```

On the idle lab this is small but not zero, and the reason is instructive:
Snip's links expire after ten minutes, so the working set of short codes turns
over continuously, and each new code introduces a `book_id` that `catalog` has
never seen. Sustained, a number like that is how you notice a label no other
diagnostic reports as a problem. The five-second test for any proposed label is
still the one from Chapter 7: *does this value change when nothing about the
world changed?* A deploy is not a change in the world.

## Light the fuse

Snip carries a switch that adds the short-link code as a label on
`snip_http_requests_total`. In `lab/snip/metrics.go`:

```go
requestLabels := []string{"route", "method", "code"}
if c.UnboundedLabel {
	requestLabels = append(requestLabels, "link_code")
}
```

And in `lab/snip/api.go`, the value:

```go
func linkCodeLabel(r *http.Request) string {
	return r.PathValue("code")
}
```

That is the whole bug. Four lines, every one of them defensible on its own, and
together the single most common way a real Prometheus is killed. Turn it on:

```bash
echo 'SNIP_UNBOUNDED_LABEL=1' >> .env
make up
```

Confirm that the label is real before you spend eight minutes on it. One
scrape interval after the containers come back:

```promql
count(count by (link_code) (snip_http_requests_total))
```

A small number — one per short code the lab has served since the restart, plus
one for the empty string that routes without a code record. Now light it:

```bash
./scripts/scenario-cardinality.sh
```

The script refuses to run if the switch is off, because without it this is 300
requests a second of ordinary traffic and proves nothing. With the switch on,
it sets the load generator to 300 requests a second against `/l/{code}`, every
one of them asking for a different, non-existent short code, and reports every
thirty seconds:

```text
  [  30s] head series     18240  (  2.0x)  RSS 0.29 GB
  [  60s] head series     27100  (  3.0x)  RSS 0.36 GB
  [ 120s] head series     45380  (  5.0x)  RSS 0.52 GB
  [ 240s] head series     81600  (  9.0x)  RSS 0.91 GB
  [ 480s] head series    152900  ( 17.0x)  RSS 1.47 GB
```

Your numbers will differ — they depend on your baseline and on how much traffic
the load generator really lands — but the shape will not. The arithmetic is
worth doing while you watch, because it is the only part of this that is
predictable: 300 requests a second, each with a code nobody has used before,
each producing one new `(route, method, code, link_code)` combination, is 300
new series a second. At a fifteen-second scrape interval, that is 4,500 new
series arriving in every single scrape, for ever, from a service that is
otherwise behaving impeccably.

Open Grafana and put `prometheus_tsdb_head_series` on a graph while this runs.
It is a hockey stick. Put `process_resident_memory_bytes{job="prometheus"}`
next to it — the resident set size, which is the memory the operating system
has actually given the process — and the second line has the same shape as the
first, offset by nothing at all. That is the lesson of the whole chapter in two
lines on one panel: the memory of a Prometheus server is a function of its
active series, and a label is what makes active series.

## Diagnose it three ways

You know the answer. Pretend you do not. Open a text file and write down what
you think is wrong and how you would prove it, before you run anything below —
this is the only chance you will get to practice the diagnosis without already
knowing the answer, and a diagnosis you did not commit to in writing is a
diagnosis you cannot grade.

**First: the TSDB status page.** It is the thing to open, because it costs
nothing and answers the question directly. In the browser it is at
`http://localhost:9090/tsdb-status`. From a terminal it is one endpoint:

```bash
curl -s http://localhost:9090/api/v1/status/tsdb | jq '.data.headStats'
```

```json
{
  "numSeries": 152900,
  "chunkCount": 161044,
  "minTime": 1789564800000,
  "maxTime": 1789572112000
}
```

Then the table that names the culprit:

```bash
curl -s http://localhost:9090/api/v1/status/tsdb |
  jq '.data.seriesCountByMetricName[:3]'
```

```json
[
  { "name": "snip_http_requests_total", "value": 143800 },
  { "name": "catalog_lookups_total", "value": 3390 },
  { "name": "node_cpu_seconds_total", "value": 128 }
]
```

Your second row will be bigger than that one and your third row will be
different — the machine these pages were measured on has sixteen CPUs and
`node-exporter` reports eight modes for each of them, which is where `128`
comes from. The shape is what matters.

One metric family holds more than nine-tenths of the database. The
response carries three more tables alongside that one — label names ranked by
how many distinct values they have, label names ranked by memory, and
label-value pairs ranked by series count. Run `jq '.data | keys'` to see what
your server calls them, because the useful reflex is to read all four rather
than to memorize one field name. The second of them, values per label name, is
where `link_code` appears with a six-figure count next to `route`'s six.

That took about fifteen seconds and it is normally the end of the diagnosis.
The next two tools exist for the cases where it is not.

**Second: `promtool tsdb analyze`.** `promtool` ships inside the Prometheus
image, but that image's entry point is the server, so every invocation has to
override it — the same pattern `make check` uses:

```bash
docker compose run --rm --no-deps -T \
  --entrypoint /bin/promtool prometheus \
  tsdb analyze --extended --limit=20 /prometheus
```

This is a different kind of instrument. The status API describes what is in
memory this second. `analyze` opens the data directory and reports on one
written block — by default the most recent one it finds — and it is the only
tool in this chapter that measures **churn**, because a block knows how many
distinct series existed across its whole time range rather than at one instant.
It will tell you the block's series count, the label names with the highest
cardinality, the most common label pairs, and the label names and pairs most
involved in churning. `--extended` adds the distribution of chunks per series;
`--limit=20` sets how many rows each table prints. You can also aim it:

```bash
docker compose run --rm --no-deps -T \
  --entrypoint /bin/promtool prometheus \
  tsdb analyze --limit=20 --match='{job="snip-api"}' /prometheus
```

!!! trap "The report is about the past, not about now"
    Run `analyze` five minutes into a detonation and the bomb may be entirely
    absent from its output, because the series you created a moment ago are in
    the head and the most recent *written* block was cut before you started. On
    a lab that has only been up for a few minutes there may be nothing on disk
    at all, and you get a complaint rather than a table. Check first:

    ```bash
    docker compose run --rm --no-deps -T \
      --entrypoint /bin/promtool prometheus \
      tsdb list -r /prometheus
    ```

    This is not a flaw in the tool, it is what the tool is for. Use the status
    API for "what is happening now" and `analyze` for "what has this been
    costing me all week, and is anything churning".

**Third: PromQL.** The slowest of the three and the one you can run from a
dashboard, an alert, or a machine that will not let you exec into a container:

```promql
topk(10, count by (__name__) ({__name__=~".+"}))
```

That is a genuinely expensive query — it touches every series in the database
to count them — and on a server that is already in trouble it can be the query
that finishes it off. Run it when the cheap answer is unavailable, not first.
When you have a suspect family, narrow with two cheap queries instead:

```promql
count(count by (link_code) (snip_http_requests_total))
```

```promql
count(snip_http_requests_total)
```

The first is how many distinct values the label takes; the second is how many
series the family has. Twelve became six figures, and the ratio between the two
numbers is the multiplier the label cost you.

One more pair, and it belongs in your reflexes because it separates "the target
is emitting too much" from "we are storing too much of what it emits". Every
scrape, Prometheus writes down what it saw:

```promql
scrape_samples_scraped{job="snip-api"}
```

```promql
scrape_samples_post_metric_relabeling{job="snip-api"}
```

The first is how many samples the target put on the wire. The second is how
many survived your `metric_relabel_configs`. On a healthy `snip-api` the gap
between them is about sixty — the `go_memstats_*` family that Chapter 12 drops
at the scrape. During the detonation both numbers are enormous, which tells you
something the status API does not: the application really is generating this,
you are not accidentally duplicating it, and the fix has to start at the target.

## The cures, ranked

There are exactly four things you can do about a cardinality problem, and they
are not equal. Rank them by where the fix lives, because that is what decides
how long it lasts.

| Cure | Where it lives | Lasts |
|---|---|---|
| Fix the application | their repository | for ever |
| Drop it at the scrape | your `prometheus.yml` | until you forget |
| Bound it with limits | your `prometheus.yml` | as a tripwire |
| Delete values in-process | their repository | until restart |

**Fix the application.** Remove the label, or bound its values. This is the only
one that actually reduces what is produced, and it is the only one that is free
after it lands. It is also the slowest, because it needs a code change, a
review and a deploy — and if the code belongs to another team, a conversation.

**Drop it at the scrape.** `metric_relabel_configs` with `drop` (remove whole
series by name) or `labeldrop` (remove one label from every series). This takes
effect in one scrape interval and needs nobody's permission. It is a brake, not
a repair: the application is still producing the data, the network is still
carrying it, and something must keep throwing it away for ever.

**Bound it with limits.** `sample_limit`, `label_limit`,
`label_value_length_limit` and `target_limit` are circuit breakers, not
budgets. They do not trim a scrape down to size; they fail it entirely, which
Chapter 12 demonstrated. Use them to make a future accident loud, not to manage
a known problem.

**Delete stale label values in the process.** Client libraries can forget a
child series: `DeleteLabelValues` in Go's `client_golang`, `.remove()` on a
labeled metric in Python's `prometheus_client`. This is the right tool for a
genuinely bounded set whose members retire — a worker pool, a set of shard
names — and the wrong tool for an unbounded one, because you would have to know
which values to forget, and if you knew that you would not have had the
problem. It also only ever cleans the exporter's memory. The series already in
Prometheus stay exactly where they are.

And the rule that outranks all four: the labels on the always-wrong list are
always wrong. `user_id`, `email`, `session_id`, `request_id`, any primary key,
any UUID, the raw URL path, the raw error string. If what you want is to get
from a slow graph to the one request that was slow, the feature for that is an
exemplar: a reference attached to a sample, which creates no series and costs
no cardinality at all. Chapter 29 turns them on in this lab. A trace ID is
forbidden as a label and free as an exemplar.

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
make reload PROM_URL=http://localhost:9090 PROM_CURL_OPTS=
```

The two variables are there because `make reload` defaults to the address
Prometheus moves to in Chapter 25, and at this point in the book it is still on
`:9090` with no password. The container also runs with `--config.auto-reload`,
so the edit would land on its own shortly; the explicit reload makes it
immediate, which at 3 a.m. is the point.

Now watch. Within two scrape intervals the hockey stick goes flat: not down,
flat. Five minutes after that, once the abandoned series have aged past the
lookback window, the label has left the database as far as any query is
concerned:

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
    samples are still arriving by the tens of thousands, still being parsed,
    still being counted against any limit you set. `labeldrop` does not remove
    samples — it removes a label, which **merges** the series that differed
    only by it. Seventy thousand samples now land on a handful of series in one
    scrape, and all but one per series are discarded as duplicates. The counter
    still exists, still has a value, and that value is now meaningless. You
    have stopped the bleeding and broken the metric. That is a trade worth
    making at 3 a.m. and not worth making on Monday.

## The real fix, and the two timescales

Monday's fix is the switch. Strip it out of `.env` altogether — with no value
set, `compose.yaml` supplies the default, which is off — and restart:

```bash
grep -v '^SNIP_UNBOUNDED_LABEL=' .env > .env.tmp
mv .env.tmp .env
make up
```

Then take the brake off again — comment those two lines back out and reload —
because a brake left engaged is a bug you have hidden from yourself. While that
`labeldrop` is in place, anybody who re-arms the switch sees nothing happen,
and the next person to read the config has no way to tell whether it is
load-bearing.

Now watch two numbers behave completely differently. The series that are
actually being written come back quickly:

```promql
count({job="snip-api"})
```

Within a couple of minutes this is back to about 170 — the figure from the
table at the start of the chapter. The abandoned series stop receiving samples,
and an instant query stops resolving them once they are more than five minutes
stale, which is the `lookback_delta` behavior from Chapter 2, "What's Actually
on the Wire".

The head does not care:

```promql
prometheus_tsdb_head_series
```

It is still six figures, and it will stay six figures. A series leaves the head
when the head is cut into a block, which happens on a roughly two-hour cycle —
not when you stop writing to it. Your memory is not coming back this session.
And the samples on disk outlive even that: expired block cleanup runs in the
background and can take up to two hours after the data is out of the retention
window.

This is the shape of every cardinality incident, and it is why the emergency
brake matters. The damage is done at the moment the series is created. Stopping
the creation stops the damage getting worse and does nothing about the damage
already done. On a real server with a real memory ceiling, the sequence is:
stop the creation, then restart Prometheus if you cannot wait for the head to
be cut, and accept that you lose nothing on disk by doing so.

## Guard rails

The reason this chapter is here and not in Part I is that you now have enough
series for a limit to be meaningful. Measure before you choose one:

```promql
max_over_time(
  scrape_samples_post_metric_relabeling{job="snip-api"}[1h])
```

About eighty samples per target, on a job with two replicas. Now add the guard
rails to the `snip-api` job, above its `docker_sd_configs`:

```yaml
  - job_name: snip-api
    sample_limit: 5000
    label_limit: 20
```

Five thousand is roughly sixty times the honest figure. That is deliberate: a
limit is a tripwire for an accident, not a budget for normal growth. Set it at
twice your current usage and you will be woken up by a feature launch; set it
where no legitimate change could ever reach it and the only thing that can trip
it is a mistake.

`label_limit: 20` guards a different failure, and it is worth being clear that
it would not have caught today's bomb. It limits how many labels a single
metric may carry. Snip's widest series has eight, and the cardinality bomb took
it to nine. What `label_limit` catches is an exporter that copies every
container label, or every Kubernetes annotation, onto every series it emits —
a real and common way to acquire thirty labels on a metric that needed six.

Reload, then prove both limits are armed by breaching one on purpose:

```bash
make reload PROM_URL=http://localhost:9090 PROM_CURL_OPTS=
echo 'SNIP_UNBOUNDED_LABEL=1' >> .env
make up
DURATION=90 ./scripts/scenario-cardinality.sh
```

Ninety seconds is more than enough. Watch `http://localhost:9090/targets`:

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
    Nothing. Snip is answering every request correctly and its entire metric
    surface is gone: request rate, latency histogram, cache hit ratio, every
    panel, every alert expression — and five minutes later, when the last
    samples fall outside the lookback window, the queries stop returning
    anything at all. The limit did its job. Its job is brutal, and you should
    know that before you set one rather than after.

Strip the switch out of `.env` again, run `make up`, and confirm that both
targets return to `up == 1` within a scrape interval. Leave the two limits in
place. They are this chapter's permanent deliverable.

## Somebody else's bomb

Chapter 7 had you find a defect in `catalog` — the service written by another
team, which you diagnose and never own — by arithmetic alone, and told you not
to fix it. The bill has been arriving ever since. Look at it now:

```promql
count(catalog_lookups_total)
```

```promql
count(count by (book_id) (catalog_lookups_total))
```

Both return a four-figure number, and both are larger than the last time you
looked. A counter whose honest cardinality is two — `result="hit"` and
`result="miss"` — has more series in your database than cAdvisor and
`node-exporter` put together. `lab/catalog/metrics.py` explains itself:

```python
LOOKUPS = Counter(
    "catalog_lookups",
    "Catalog lookups by book and result.",
    ["book_id", "result"],
)
```

Apply the ranking you learned above, in order. The emergency brake first, on
the `catalog` job this time:

```yaml
    metric_relabel_configs:
      - source_labels: [__name__]
        regex: python_gc_.*
        action: drop
      - regex: book_id
        action: labeldrop
```

Reload with `make reload PROM_URL=http://localhost:9090 PROM_CURL_OPTS=`, wait
five minutes for the abandoned series to age out of the lookback window, and
`count(catalog_lookups_total)` reads `2`. Then take those two lines straight
back out and reload again, because this one is not your 3 a.m. and nobody is
paging you: a brake left on would hide a live defect from the only team that
can repair it.

The real fix is a code change you do not own, so you propose it. The lab lets
you test the proposal before you send it — `catalog` reads three switches at
import time, and one of them is exactly this fix:

```bash
echo 'CATALOG_FIX_CARDINALITY=1' >> .env
docker compose up -d catalog
```

Five minutes later `count(catalog_lookups_total)` is `2`, permanently, and
nothing else about the service has changed. Now write the pull request. A good
one is short, states the cost in the units the owner cares about, and answers
the question the label was trying to answer:

```text
catalog: drop book_id from catalog_lookups_total

book_id comes straight off the URL path of GET /books/{id} and
nothing bounds it. A miss is labeled too, so any caller — including
a scanner walking /books/1 upward — mints series that are never
reclaimed. The catalog holds 200,000 entries.

In our monitoring stack this one counter is the largest single
metric family in the database — more series than cAdvisor and
node-exporter put together — and it grows every day it runs.

The diff is two lines: drop "book_id" from the label list and from
the .labels() call. Cardinality goes from unbounded to exactly two.

Per-book hit rates are a real question and a good one. They belong
in the request log or an analytics table, where the cost is linear
in what you store rather than permanent in memory.
```

Then strip `CATALOG_FIX_CARDINALITY` out of `.env` and restart `catalog`. The
switch exists so you can test a proposal, not so you can fix somebody else's
service behind their back, and the rest of the book describes a lab in which
that bug is still open.

That is the whole job: find it by arithmetic, cost it in numbers the owner
recognizes, propose the two-line diff, and name the right home for the question
somebody was genuinely trying to answer.

!!! selfcheck "Self-check"
    Run `make verify-ch24`. It arms `SNIP_UNBOUNDED_LABEL` itself, detonates,
    and puts your `.env` back afterward. Two assertions must pass every time,
    and they are the ones that grade your work: `prometheus.yml sets a
    sample_limit` and `prometheus.yml sets a label_limit`. Its third assertion
    — a twentyfold rise in head series — will **not** pass on the stack this
    chapter leaves behind. It is skipped outright while the `labeldrop` is
    engaged, and it falls short once the `sample_limit` is in place, because
    the scrape fails long before the head can grow that far. Both outcomes are
    the chapter working, not the script breaking, and the script says which
    world it is in. To watch the real thing again, take the `sample_limit` line
    out for one run. Then check these three by hand, with the switch off and
    the brake off: `count({job="snip-api"})` reads about `170`,
    `count(snip_http_requests_total{link_code=~".+"})` is empty, and
    `up{job="snip-api"}` reads `1` for both replicas.

## Common mistakes

**Shortening retention to stop an out-of-memory kill.** The single most common
wrong move, and it is wrong for a structural reason rather than a tuning one.
Retention governs how long samples stay on disk. The kill is about active
series in the head. Halving retention halves your disk and changes your memory
by nothing measurable. The fix for memory is fewer active series.

**Reading `sample_limit` as truncation.** It is the mistake the name invites.
Every scrape limit except `keep_dropped_targets` fails the whole scrape, so
setting one on a job you have not measured converts a slow growth in
cardinality into a total blackout of that target — at the exact moment you most
need to see it. Measure the job, then set the limit at a multiple no honest
change could reach.

**Trusting an instantaneous count on a churning label.** `count(count by (pod)
(x))` is a photograph. A label that turns over on every deploy photographs
beautifully and bills you by the week. Use the rate of
`prometheus_tsdb_head_series_created_total`, or the churn tables in
`promtool tsdb analyze`, which are the only two things in this chapter that see
across time.

**Leaving the emergency brake on.** The `labeldrop` did its job, the incident
closed, and nobody removed it. Now the metric silently has a merged, meaningless
value; the application still pays to produce the label; and the next person who
re-arms the real bug sees a flat graph and concludes there is no bug. If you
engage a brake, open the ticket to remove it in the same minute.

**Assuming the series are gone because the query is empty.** An instant query
stops resolving a series about five minutes after its last sample. The series
is still in the head, still counted by `prometheus_tsdb_head_series`, still
occupying memory, until the head is cut. "I cannot see it" and "it is not there"
are different statements, and only one of them is about your memory bill.

## Summary

Cardinality is not a performance topic. It is the one failure mode where a
change to an application takes down the system that was supposed to be watching
it, and it arrives disguised as a small, sensible improvement. You have now
caused it, watched three separate metrics react to it, found it three different
ways, stopped it in fifteen seconds without a deploy, and repaired it properly
— and you have felt the part that no amount of reading conveys, which is that
the recovery is not symmetrical with the damage.

The durable takeaways:

- `prometheus_tsdb_head_series` is the number. Graph it, and alert on its rate
  of change rather than on its value, because the value is different at every
  site and the slope is not.
- The diagnostic order is `/api/v1/status/tsdb` first because it is cheap and
  direct, `promtool tsdb analyze` when you need history or churn, and
  `topk(count by (__name__))` when you can reach neither.
- `scrape_samples_scraped` against `scrape_samples_post_metric_relabeling`
  tells you whether the target is producing too much or you are storing too
  much of what it produces.
- The cures are ranked: fix the application, drop it at the scrape, bound it
  with limits, delete stale values in-process. Only the first one is free once
  it lands.
- `labeldrop` merges series and discards the duplicates. It stops the bleeding
  and breaks the metric, and it is the right call in an incident and the wrong
  one afterward.
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
