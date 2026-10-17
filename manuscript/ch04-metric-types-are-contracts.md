# Chapter 4 — Metric Types Are Contracts

Somewhere in your dashboard, right now, is a number that is smooth, plausible,
non-negative, and wrong. Not broken — wrong. It will not blank out, it will not
throw, it will not turn red. It will sit there looking like measurement while
describing something that never happened. That is not a hypothetical either: in
a few pages you will produce one on purpose, from a real service in this lab,
and then produce the proof that it is nonsense. The mechanism is the whole
subject of this chapter — somebody declared a metric to be one kind of thing
and then used it as another, and no software anywhere in the pipeline
objected.

There is one line in the exposition format that says which kind of thing a
metric is. You met it in Chapter 2, "What's Actually on the Wire", and you were
told to file it away. Here is the file:

```text
# TYPE snip_http_requests_total counter
```

That word is not decoration and it is not a hint. It is a **contract** — a set
of promises the process makes about how the numbers behave, which the query
language then relies on. Learn what each type promises and you stop memorizing
lists of which function is allowed where. The legal operations *follow* from
the promises: four contracts, not four definitions, from which you can derive
the rules yourself, including rules for functions nobody has shown you.

!!! objectives "Objectives"
    After this chapter you can:

    - State the contract each of the four metric types makes, in one sentence
      each.
    - Derive, rather than recall, which PromQL functions are safe on a counter
      and which on a gauge.
    - Explain the gauge-blindness asymmetry: a spike living entirely between
      two scrapes never happened, for a gauge — while a counter of the same
      events cannot hide it.
    - Recognize a gauge being used as a counter from its graph, and from its
      name before you even graph it.
    - Say why a summary's quantiles cannot be aggregated, and therefore why
      histograms exist.
    - Read a `# TYPE` line and predict which operations that series tolerates.

## Where the lab is, and who just joined it

One service arrives in this chapter, and you write no code.

```bash
cd lab
git checkout ch04
make up
```

The new container is **`catalog`**, a book-metadata service written in Python.
It carries real traffic: `snip-api` calls its `GET /books/{id}` every time it
serves `GET /links/{code}`, to enrich a link with a title and an author. And it
is the first thing in this lab that is **not yours**. You did not write it, you
will not edit it, and you are going to find bugs in it. Diagnosing somebody
else's instrumentation from the outside is most of what this skill actually is,
and no amount of writing your own correct code prepares you for it.

Three files grew to bring it in — `compose.yaml`, `prometheus/prometheus.yml`
and the `Makefile`, which now knows about a Python build base and about port
8081. The `catalog/` directory arrived whole, and one new file arrived for you
to fill in. In `lab/compose.yaml`:

```yaml
  # ── ch4 ──────────────────────────────────────────────────────
  # Someone else's service. You diagnose it; you never own it — you
  # have no more right to edit this image than you would have to
  # edit another team's repository. The CATALOG_FIX_* switches are
  # how you verify a proposed fix without editing anything.
  catalog:
    build: ./catalog
    restart: unless-stopped
    environment:
      CATALOG_FIX_TYPE: ${CATALOG_FIX_TYPE:-0}
      CATALOG_FIX_UNITS: ${CATALOG_FIX_UNITS:-0}
      CATALOG_FIX_CARDINALITY: ${CATALOG_FIX_CARDINALITY:-0}
    ports:
      - "8081:8081"
    networks: [obsnet]
    cpus: "0.15"
    mem_limit: 256m
```

Three switches named `CATALOG_FIX_*`, all off. They exist so that when you work
out what is wrong here you can *verify* your fix instead of asserting it; two
of the three belong to later chapters. The resource limits are deliberate too,
and nothing in the lab can observe their effect for another eighteen chapters.

And in `lab/prometheus/prometheus.yml`, one more job, in the shape you already
know:

```yaml
  # ── ch4 ──────────────────────────────────────────────────────
  # Somebody else's service. Python, port 8081, and nobody on this
  # team has read its instrumentation. It is deliberately noisy: it
  # produces more series than everything you own put together, and
  # chapter 7 explains the arithmetic.
  - job_name: catalog
    static_configs:
      - targets: ["catalog:8081"]
        labels:
          env: lab
```

Open `http://localhost:9090/targets`. There are now four jobs — `prometheus`,
`snip-api` with its two targets, `loadgen` and `catalog` — five targets, all of
which should read UP within fifteen seconds of the stack settling. The third
file is `lab/docs/type-census.md`, empty except for instructions; it is the
chapter's lab step, and the last section explains it.

!!! warning "`catalog` is deliberately noisy"
    Give it half an hour and this one service is storing more time series than
    everything you own put together, and it is still climbing. That is on
    purpose, and Chapter 7, "Labels, and the Cardinality Arithmetic You Must Do
    First", explains the arithmetic. Over a laptop session it costs nothing; if
    you leave the stack up for days it becomes most of your database. `make
    down` between sessions is fine, and the data you have collected survives
    it.

## The line that nothing enforces

Start with the uncomfortable part, because everything else here follows from
it. Nothing checks the `# TYPE` line. Not the client library — in Go a counter
and a gauge both have an `Inc()` method, so the compiler is happy either way.
Not the scrape — Prometheus reads the word, files it away, and ingests your
samples regardless. Not PromQL — you can call `rate()` on a gauge and get a
number back, and graph the raw value of a counter and get a picture.

So the type is not enforced. It is *declared*. And it is kept: Prometheus
stores what each target said about each family, and hands it to anything that
asks.

```bash
curl -s 'localhost:9090/api/v1/metadata?metric=catalog_items_processed'
```

```text
{"status":"success","data":{"catalog_items_processed":[{"type":
"gauge","unit":"","help":"Items processed by the catalog
indexer."}]}}
```

That is the shape of the problem in one response. A promise made by whoever
wrote the instrumentation, recorded faithfully, served to whoever writes the
query — and nothing in between checking it was ever true. When the two
disagree, nothing fails. You get answers.

There are four types in the exposition format — `counter`, `gauge`,
`histogram`, `summary` — plus one non-answer, `untyped`, for a metric that
declares nothing. Two of the four are foundations and two are built out of the
first two. Take them in that order.

## Counter: three promises

A **counter** is a value that counts occurrences of something. It makes exactly
three promises, and everything you are allowed to do with it comes out of them.

**One: it never decreases, within one process lifetime.** From the moment the
process starts to the moment it dies, the number goes up or stays the same. It
never goes down at all.

**Two: it resets to zero when the process restarts.** Not an exception to
promise one — the boundary of it. "Within one process lifetime" is doing real
work in that sentence. A counter is not a durable total, and it has no memory
of the container it replaced.

**Three: only differences carry meaning.** The absolute value is an accident of
how long this particular process has been alive.

That third promise has a consequence people find genuinely surprising, so here
it is as bluntly as it deserves: **displaying the current value of a counter is
always a mistake.** Not usually. Always.

Look at what the number actually is:

```bash
curl -s localhost:8000/metrics | grep '^snip_http_requests_total'
```

```text
snip_http_requests_total 41827
```

Forty-one thousand what? Requests since this container started, which was
whenever you last ran `make up`. It is not requests today, not requests ever,
not even requests handled by Snip — `snip-api-b` keeps a separate count of its
own, and adding the two would be adding up two arbitrary container ages. Put
that figure on a wall and somebody reads it as a business number exactly once,
and is wrong.

The graph is no better: a staircase climbing to the right, whose slope is the
only interesting thing about it and which no human eye can read off four orders
of magnitude of climb. Chapter 6, "`rate()`, `increase()`, and Why Nothing Is a
Whole Number", takes that staircase apart. For now the derivation is what
matters: only differences carry meaning, therefore only functions that compute
differences are safe. That is a short list — `rate()`, `irate()`, `increase()`
and `resets()` — and you now know *why* it is that list.

!!! jargon "Odometer"
    The analogy that follows you through the rest of the book. A counter is an
    **odometer**: it only goes up, and the useful question is never "what does
    it read?" but "how much did it change since I last looked?" Two hundred
    thousand miles tells you nothing; two hundred miles since Tuesday tells you
    everything.

    Where it breaks down: a car's odometer survives switching the engine off,
    and a counter does not. Every deploy is a brand-new car with a brand-new
    odometer, wearing the same license plate.

## Watching the reset happen

Promise two is easy to disbelieve until you have watched it. Note the number
you just curled, then restart the one replica you can reach directly:

```bash
docker compose restart snip-api
```

Give it half a minute. The load generator has been firing at the service the
whole time, at the lab's default of twenty requests a second, so the new
process is already busy. Ask again:

```bash
curl -s localhost:8000/metrics | grep '^snip_http_requests_total'
```

```text
snip_http_requests_total 431
```

Your number will not be that one; check it with arithmetic rather than against
mine, at twenty a second times your half-minute minus the few seconds the
container took to come back. What matters is the shape of the answer. The
service never stopped doing its job for more than a couple of seconds, no user
would have noticed, and the counter has forgotten everything it ever knew.

Prometheus has a function that reports exactly this event:

```promql
resets(snip_http_requests_total{job="snip-api"}[10m])
```

```text
{env="lab", instance="snip-api:8000", job="snip-api"}     1
{env="lab", instance="snip-api-b:8000", job="snip-api"}   0
```

The `[10m]` asks for every sample in the last ten minutes rather than only the
latest one; Chapter 6 names that construct properly. `resets()` walks those
samples and counts every place the value went *down*. One restart, one reset,
on exactly the instance you restarted — and ten minutes later it falls back to
zero as the event slides out of the window.

The second row is worth a moment. `snip-api-b` reports zero resets, and it has
reported zero of everything since Chapter 2: nothing addresses it, so its
counter has sat at `0` since the process started. No restart, no decrease,
nothing for `resets()` to find. One metric name, two series, two entirely
independent histories — because "within one process lifetime" is a per-series
promise, and `instance` is what separates the lifetimes.

Read the function's definition carefully, because it is narrower than the name
suggests. `resets()` does not count restarts. It counts **decreases between
consecutive samples**. On a counter those are usually the same thing, and not
always, which is exercise 5.

## Gauge: one promise and one silence

A **gauge** is a value that can go up and down. That is the whole contract, and
it is deliberately weaker than the counter's.

What you gain: **the instantaneous value is meaningful on its own.** A gauge is
a state at a moment — a queue is five deep, memory is 200 MB, 580 short links
currently exist. You can graph it raw, put it in a single-value panel, alert on
it crossing a threshold. None of that is true of a counter.

What you lose: **no direction guarantee at all.** Prometheus cannot assume a
decrease is a restart, because a decrease is the entirely normal behavior of a
gauge. Every function that compensates for counter resets is therefore
meaningless here, and every function that assumes monotonic behavior will lie
to you.

In exchange, the gauge contract buys two functions a counter can never have:
`deriv()`, which fits a line through the samples and reports an honest slope
that is allowed to be negative, and `predict_linear()`, which extends that line
forward to answer "when will this disk be full?" Both are gauge-only for the
same reason — they are meaningful precisely because the value may fall.
`deriv()` arrives in Chapter 6 and `predict_linear()` in Chapter 22, "Metrics
From Things You Didn't Write". You need neither today; you need to be able to
say why neither could ever be safe on a counter.

!!! jargon "Speedometer"
    The counterpart analogy, and the second half of a pair that comes back in
    every later chapter. A gauge is a **speedometer**: what it reads right now
    is the answer, and what it read a minute ago is history you did not record.

    Where it breaks down, and this is the important half: you watch a
    speedometer continuously. Prometheus glances at a gauge every fifteen
    seconds and writes down what it saw. Everything the needle did between
    those glances is gone, and there is no way to know it ever happened.

## The asymmetry, worked

That last paragraph is the most useful idea in the chapter, and it deserves
real numbers rather than a warning.

`catalog` runs a background indexer. Once a second it wakes up, sometimes adds
between 4 and 32 items to a work queue, then works off as many as it can before
the next tick. It publishes two numbers about this: `catalog_queue_depth`, a
gauge of how many items are waiting right now, and `catalog_items_processed`, a
running total of how many it has finished.

The indexer ticks about once a second — one second of sleep, plus however long
the rescoring takes on a container limited to 0.15 of a core — and Prometheus
scrapes every fifteen. Over ten minutes the queue depth is therefore set five
or six hundred times, and Prometheus writes down forty of those settings. Ask
the gauge how often it changed:

```promql
changes(catalog_queue_depth[10m])
```

```text
{env="lab", instance="catalog:8081", job="catalog"}     38
```

`changes()` counts how many times a sample differed from the one before it. It
is the gauge counterpart to `resets()`, and it is how you detect something
flapping. Ten minutes at a fifteen-second interval is forty samples, so there
are thirty-nine chances to change, and thirty-eight were taken on this run: the
depth was different at almost every single scrape. Yours will read somewhere
between the high twenties and thirty-nine, lower when the host is busy and the
indexer is starved of CPU. The handful it misses are stretches where the queue
sat at the same depth — usually zero — across two scrapes in a row, which is
not evidence that nothing happened, only that nothing was waiting at both of
the moments anyone looked.

Hold on to what that result is telling you. The gauge changed at thirty-eight
of the forty moments you can see, and was *set* five hundred-odd more times you
have no record of whatsoever — most of those a change, some of them the value
it already had. Suppose the queue exploded to 400 and drained back to 3 in the
eight seconds between two scrapes. Not this queue: the indexer adds at most
thirty-two items a tick, so it is far too slow to move that far that fast.
Imagine one that can. Both scrapes read 3. Not "read a smoothed 3" — read 3,
stored 3, graphed 3. As far as every dashboard, alert and query you will ever
write is concerned, **that spike did not happen.** No setting fixes this. It
is what sampling a state variable means.

Now look at the counter of the exact same work:

```promql
changes(catalog_items_processed[10m])
```

```text
{env="lab", instance="catalog:8081", job="catalog"}     39
```

Thirty-nine out of thirty-nine — which tells you, by itself, that `changes()`
on a busy counter is a meaningless statistic dressed as a measurement. A
counter under load moves between every pair of scrapes by definition, so the
function just returns the number of samples minus one, forever.

But the *events* are a different story, and this is the whole point. If 397
items were processed during that invisible burst, this counter is 397 higher at
the next scrape than at the last one. Not approximately. Exactly. The burst is
fully recorded in the difference, even though nobody was watching.

```text
             the burst that happened between two scrapes

  gauge      3 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ 3     both samples read 3
               ▲                    ▲     the peak is unrecoverable
               │   /\               │
  reality      │  /  \  400         │
               │ /    \             │
  counter    1200 ─────────────── 1597    +397, exactly
               ▲                    ▲
            scrape                scrape
```

That is the asymmetry, and it settles almost every "should this be a counter or
a gauge?" argument you will ever have. **A gauge is blind between scrapes; a
counter of the same events is not.** If what you care about is *how many times
something happened*, count it — even when a gauge feels more natural, even when
you also want the gauge. If what you care about is *what the state is right
now*, only a gauge can tell you, and you accept that you are looking through a
fifteen-second strobe light. The practical version: when a gauge would hide an
event you would be paged for, add a counter next to it. Queue depth and items
enqueued. Connections open and connections accepted. Both, not either.

## A gauge being used as a counter

Time to meet `catalog`'s instrumentation. Before you look at its `# TYPE`
lines, look only at the names:

```bash
curl -s localhost:8081/metrics | grep '^# TYPE catalog_'
```

Cover the right-hand column with your thumb and predict. A *total* of requests
is a counter, and `catalog_lookups_total` has the same shape. A *depth* is a
state, so a gauge. A duration measured many times is a histogram. And
`catalog_build_info` carries a suffix this chapter comes back to shortly. Now
look:

```text
# TYPE catalog_http_requests_total counter
# TYPE catalog_request_duration_seconds histogram
# TYPE catalog_queue_depth gauge
# TYPE catalog_items_processed gauge
# TYPE catalog_lookups_total counter
# TYPE catalog_build_info gauge
```

`catalog_items_processed`. A gauge. Items *processed* — a thing that has
already happened, counted — declared as a value that can go up and down, with
no `_total` on the end to warn anyone. Watch it for a minute:

```promql
catalog_items_processed
```

```text
{__name__="catalog_items_processed", env="lab",
    instance="catalog:8081", job="catalog"}     128616
```

Your figure will not be this one — it depends entirely on how long `catalog`
has been running, which is itself the tell. Refresh. It is bigger. Refresh
again. Bigger. It has never once gone down and it never will, because the only
thing the code ever does to it is add. This is a counter wearing a gauge's
`# TYPE` line, and the metric's own *name* is the one telling the truth.

Now switch the Query page to Graph and give it an hour.
`catalog_items_processed` draws a line that climbs and never once dips. Add
`catalog_queue_depth` as a second query and you get the other picture: a
sawtooth between zero and a couple of hundred, falling as often as it rises.
That contrast is the tell. **A series declared `gauge` whose graph holds no
downward step at all is a counter**, whatever its `# TYPE` line says — and once
you can see that shape you do not need the name to tell you.

The obvious question is what breaks. The uncomfortable answer is: today,
nothing.

```promql
rate(catalog_items_processed[5m])
```

```text
{env="lab", instance="catalog:8081", job="catalog"}     7.656570193414368

PromQL info: metric might not be a counter, name does not end in
_total/_sum/_count/_bucket: "catalog_items_processed" (1:6)
```

About seven items a second — yours will land somewhere between six and eight,
because the indexer is sharing a fraction of one core with everything else the
service does. A believable number, and even the right one. `rate()` does not
read `# TYPE` — it walks the samples and adds up the increases, and this
series only ever increases, so it comes out correct by accident. Even the
restart case works: when `catalog` is redeployed the value drops to zero,
`rate()` reads that drop as a counter reset and adds the lost value back,
exactly as it would for a real counter.

Notice the second half of that output, though. Prometheus 3 does not fail the
query; it attaches a note to the result, shown under the query box in the web
UI. That annotation is the only thing in this entire stack that will ever
comment on the mismatch, it is triggered by the *name* and not by the `# TYPE`
line, and it is purely advisory. Had the metric been called
`catalog_items_processed_total` and still declared a gauge, you would get
silence.

So the damage is not in today's graph. It is in the contract:

- `# TYPE` is metadata other software reads, as that metadata response showed.
  Grafana's query builder, `promtool`, the translation layer Chapter 28,
  "OpenTelemetry and Prometheus", puts in front of OpenTelemetry — all of them
  are being told this is a state.
- A gauge is the type with `.set()` and `.dec()` on it. The declaration is an
  invitation, and the next person to touch this file is entitled to accept it.
  The moment anybody calls `.set()`, every `rate()` in your dashboards silently
  becomes fiction.
- Somebody will eventually put 128,616 on a panel labeled "backlog", because
  the type said state and the name gave them no reason to doubt it.

That is planted bug number one, and exercise 4 asks you to write the pull
request. Verify it rather than asserting it: the `CATALOG_FIX_TYPE=1` switch
exists so you can see what your fix does to the metric's name on the wire
before you decide the fix is free.

## Plausible, silent, and wrong

`catalog_items_processed` is the harmless half of the mistake: a counter
mislabeled as a gauge, where the numbers survive. Run it the other way round
and it stops being harmless. `catalog_queue_depth` is a genuine gauge that
genuinely rises and falls. Ask for its rate.

!!! trap "`rate()` over a gauge"
    ```promql
    rate(catalog_queue_depth[5m])
    ```

    ```text
    {env="lab", instance="catalog:8081", job="catalog"}     0.9684754231816525

    PromQL info: metric might not be a counter, name does not end in
    _total/_sum/_count/_bucket: "catalog_queue_depth" (1:6)
    ```

    About one per second. Yours will be a different figure and just as
    convincing. Smooth. Non-negative. Stable enough to alert on. Put it on a
    dashboard beside nine correct panels and nobody will ever pick it out.

    The actual gauge spends its life bouncing between zero and a couple of
    hundred with no trend whatsoever. Nothing here is increasing by one of
    anything per second. The number is not an approximation of a true value;
    there is no true value for it to approximate.

Here is the proof, and the mechanism with it:

```promql
resets(catalog_queue_depth[10m])
```

```text
{env="lab", instance="catalog:8081", job="catalog"}     17
```

Seventeen "counter resets" in ten minutes — you will see a dozen or two — on a
process that has been running for hours and has not restarted once. Every one
is an ordinary decrease: the indexer worked the queue down, which is its job.
`rate()` cannot tell "the queue got shorter" from "the process died", because
on a counter those look identical, and its whole correction algorithm assumes
the counter contract holds. So it discards every decrease and adds the pre-drop
value back as if the series had restarted. Mind the windows when you check the
arithmetic: seventeen is the count over ten minutes, and roughly half of them
fall inside the five minutes the `rate()` above was computed over. Every one of
that half was added back. The result is a sum of phantom increases divided by a
time window: arithmetic performed correctly on false premises.

!!! iou "IOU — chapter 6"
    You have now run `rate()` twice and nobody has told you what it does.
    That is deliberate. Chapter 6 derives it from first principles, including
    the reset correction you just watched misfire and the extrapolation that
    puts a fraction on the end of its output. Until then: `rate()` is per-second
    average increase, and it belongs to counters only.

Your own service ships a switch that plants this same fault in code you own:
`SNIP_GAUGE_COUNTER=1`, in `lab/.env.example`. Setting it today changes
nothing, because the metric it re-declares does not exist in Snip yet. Chapter
5, "Your First Counter: Instrumenting Code You Own", gives Snip that metric and
then throws the switch.

## Histogram: a family of counters

The third type is not really a third thing. A **histogram** is a bundle of
counters shipped under one name, which is why it needs so little new
machinery. You met the shape in Chapter 2: for one histogram named
`catalog_request_duration_seconds`, the wire carries a `_bucket` series per
boundary, plus `_sum` and `_count`. Every one of those is a counter. Each
`_bucket` counts observations at or below its boundary; `_count` counts
observations; `_sum` accumulates their values. They all only go up, they all
reset together, and only differences carry meaning. So `rate()` is legal on all
of them and graphing their raw values is a mistake, for the reasons you derived
a few pages ago.

Two consequences fall straight out of "it is counters underneath". Because
counters are additive, buckets from ten replicas can be added together and the
result is a real histogram of all ten. And because buckets are chosen when the
code is written, a histogram can only ever answer questions at the resolution
somebody picked in advance. Chapter 10, "Latency: Histograms Without Tears", is
where that becomes a skill.

## Summary: shown once, then never again

The fourth type is the one to recognize and avoid, so here it is, once. A
**summary** also measures a distribution, but it computes the answers inside
the process, at observation time, and ships the results. Your Go services carry
exactly one, from the runtime instrumentation the client library switches on
for you:

```bash
curl -s localhost:8000/metrics | grep '^go_gc_duration_seconds'
```

```text
go_gc_duration_seconds{quantile="0"} 3.3546e-05
go_gc_duration_seconds{quantile="0.25"} 9.4382e-05
go_gc_duration_seconds{quantile="0.5"} 0.000189185
go_gc_duration_seconds{quantile="0.75"} 0.000272317
go_gc_duration_seconds{quantile="1"} 0.000575879
go_gc_duration_seconds_sum 0.006673769
go_gc_duration_seconds_count 34
```

Read the shape. `_sum` and `_count` are counters and behave exactly as you now
expect. The interesting part is the `quantile` label: five series, each holding
an answer the Go runtime computed for itself. `quantile="0.5"` says the median
garbage-collection pause in this process was 189 microseconds. Nothing was
stored that would let you re-derive that; the process did the statistics and
threw the observations away.

Which is precisely the problem. Ask for
`go_gc_duration_seconds{job="snip-api", quantile="0.5"}` and you get two rows,
two different medians, one per process. Now try to answer "what is the median
GC pause across the service?" You cannot. Not with more PromQL, not with a
cleverer query — the information required was destroyed inside each process
before either number was exposed.

!!! pitfall "Averaging quantiles"
    The query people write anyway, and the official Prometheus documentation
    annotates it with the comment `// BAD!`:

    ```promql
    avg(go_gc_duration_seconds{job="snip-api", quantile="1.0"})
    ```

    ```text
    {}     0.000524421
    ```

    (`avg()` collapses several series into their arithmetic mean; Chapter 8,
    "Aggregation: `sum`, `without`, and the Rate-Then-Aggregate Law", teaches
    aggregation properly.)

    It returns a number, so it looks like it worked. It is the mean of two
    medians, or of two maxima, and that quantity is not a percentile of
    anything. If one replica handled ten requests and the other ten thousand,
    they count equally. No weighting fixes it: the underlying observations are
    gone, and a percentile of a population cannot be reconstructed from
    percentiles of its parts.

    Buckets, by contrast, are counts — and counts add. Add the buckets from
    both replicas and you have the true distribution of both. **That is the
    entire reason histograms exist.**

One last thing, because it will otherwise cost you ten confused minutes. On the
wire that top quantile is written `quantile="1"`, and
`go_gc_duration_seconds{quantile="1"}` returns an empty result. Prometheus 3
normalizes the numeric values of the `quantile` label into float form, so `1`
is stored as `1.0` and `0` as `0.0`, and a selector has to match what was
stored — which is why the pitfall box writes `quantile="1.0"`. You will meet
the same rule again, on the `le` label, in Chapter 10.

## Untyped, and the metric that is always 1

Two loose ends, both of which turn up in the census you are about to write.

**Untyped** is what a metric gets when the exposition carries no `# TYPE` line
for it at all. Prometheus ingests it happily and promises nothing: it will not
stop you calling `rate()` on it, and will not tell you whether that makes
sense. Check your own stack:

```bash
curl -s localhost:8081/metrics \
  | awk '$1=="#" && $2=="TYPE" {print $4}' | sort | uniq -c
```

```text
      6 counter
      9 gauge
      1 histogram
```

Sixteen families, every one typed, because every mainstream client library
writes the header for you. Untyped is not something a library produces by
accident; it is what hand-written exposition and older exporters give you.
Treat it as a metric whose author told you nothing.

**Info metrics** are the other loose end, and they are a convention rather than
a type. A metric whose name ends in `_info` carries no measurement at all:

```promql
catalog_build_info
```

```text
{__name__="catalog_build_info", env="lab", instance="catalog:8081",
    job="catalog", python_version="3.13.15", revision="6f3c11e",
    version="0.9.2"}     1
```

The value is 1. It is always 1. Everything the metric is for lives in the
labels: version, revision, Python version. This is how you attach a string to a
time series in a system that stores nothing but floating-point numbers. The
value is 1 rather than 0 because 1 is the multiplicative identity — multiply
another series by this one and nothing changes except which labels come along
for the ride, which is exactly how Chapter 11, "Joins, Info Metrics, and the
Rest of PromQL", attaches a version number to a latency graph.

In the classic text format an info metric is declared `gauge`, so `gauge` is
what your census records for it. The `_info` suffix, not the `# TYPE` line, is
the signal that the value means nothing.

## The census

Now do it yourself, deliberately. This is the chapter's lab step, and it
produces a file the verifier grades.

Open `lab/docs/type-census.md`. It ships as a template with an empty table. The
rule is that you **predict from the name first**, write the prediction down,
and only then look at `# TYPE`. Predicting is the skill; reading the header is
not.

Three endpoints are in scope, and they are the three the verifier reads. Count
what you are up against first:

```bash
curl -s localhost:8000/metrics | grep -c '^# TYPE'   # snip-api
curl -s localhost:8089/metrics | grep -c '^# TYPE'   # loadgen
curl -s localhost:8081/metrics | grep -c '^# TYPE'   # catalog
```

Thirty-nine, forty-seven, sixteen. Of Snip's thirty-nine families, exactly
**one** is yours: `snip_http_requests_total`. Twenty-five of the other
thirty-eight are gauges describing the Go runtime — heap sizes, goroutine
counts, garbage-collection settings — and six more are gauges describing the
operating-system process itself. All of them arrive switched on because the
client library ships them that way, and you have never once looked at them.
`loadgen` is the same thirty-eight with nine of its own on top, and `catalog`,
a Python process, shares six `process_*` families with both — same names, same
types, the first time in this lab two different client libraries agree on a
family. Counting each shared family once, the lab exposes fifty-eight distinct
families.

Do not classify all fifty-eight. Get the six `catalog_*` families right, add
the one metric you own, and add a few runtime metrics whose names you had to
think about. Anything with a name and a type word on the same line counts as an
entry — a table row works, a sentence works. You need at least six. Two rules
about what to write, because both catch people:

**Record what is declared, not what is right.** The verifier compares your file
against the live `# TYPE` lines. `catalog_items_processed` is a counter in
every sense that matters, and the honest entry is `gauge`, because that is the
promise the service is making. The census records what the lab claims; the gap
between that claim and the name is the finding.

**Stay on those three endpoints.** Prometheus exposes a couple of hundred
families of its own on `:9090` — the only thing in this lab with a serious
number of histograms and summaries in one body — but the verifier does not read
that endpoint, so a `prometheus_*` entry is reported as a line naming no live
metric. That census is exercise 6.

These are the naming signals worth internalizing — the whole reason prediction
is possible:

| Signal | Almost always | Because |
|---|---|---|
| `_total` | counter | it is a running total |
| `_bucket`, `_sum`, `_count` | part of a family | histogram or summary |
| `_info` | gauge, value 1 | the payload is in the labels |
| a noun of state | gauge | depth, size, active, bytes, fds |

The signal that matters most is the one that is *missing*: no `_total` on a
value that only ever increases. That is the tell for planted bug one, and it is
why the census asks for your prediction before your reading.

!!! selfcheck "Self-check"
    Run this before you write anything, so you can see the shape of a failing
    run:

    ```bash
    make verify-ch04
    ```

    ```text
    == verify-ch04 ==
       expected runtime: about 10 s

    PASS the live endpoints expose # TYPE lines
         58 metric families are being exposed right now
    PASS docs/type-census.md exists
         no live metric on this line: counter / gauge / histogram /
         summary / untyped / info
         census entries recognised: 0 (0 agree)
    FAIL the census classifies at least six metrics — got 0, want > 5
    PASS every classification matches the live # TYPE line
         1 line(s) named a type but no metric this lab
         exposes. Typos count as census errors.
    PASS catalog_items_processed is declared a gauge (bug #1)
         its name has no _total and its # TYPE says gauge, yet it
         only ever increases. That is the planted bug.

    ch04: 4 passed, 1 failed
    ch04 FAILED
    ```

    Four passes and one failure is the correct starting state: the lab is
    healthy and you have not done the work yet. The "no live metric on this
    line" note is the template's own list of the six type words, printed on
    one long line and wrapped here to fit the page; the template tells you to
    delete it. A typo in a metric name reports the same way.

    Write six or more entries that match, and the run ends `5 passed, 0 failed`
    and `ch04 OK`. A wrong classification is reported by name:

    ```text
    FAIL catalog_items_processed is a counter — got gauge, want counter
    ```

## Common mistakes

**Graphing a counter's raw value.** The most common instrumentation-adjacent
mistake there is, and it survives code review because the graph looks fine: it
climbs, so it looks like data. It is the age of a container drawn as a line. If
a panel's query is a bare counter name, the panel is wrong.

**Choosing a gauge because it has more methods.** In every client library the
gauge is the type with `inc()`, `dec()` and `set()` on it, so it feels like the
safe general-purpose choice. That is the reasoning behind
`catalog_items_processed`, and it is backwards: pick the type that makes the
strongest promise your value can honor.

**Using `changes()` on a counter.** It parses, it runs, and under any traffic
it returns "number of samples minus one" forever — which is what you saw it do.
`changes()` is for gauges and discrete states: a version number, a leader
election, a queue depth that has gone flat.

!!! pitfall "Reading `resets()` as a restart count"
    `resets()` counts decreases between consecutive samples, and on a real
    counter that is usually restarts. Two ways it is not. On a gauge it counts
    ordinary downward movement — seventeen "resets" from a queue being worked
    off normally, as you saw. And on a counter, a restart is only counted if
    Prometheus actually sampled a lower value: if the process dies and its
    replacement climbs back above the old value before the next scrape, the
    decrease never appears in any sample and `resets()` reports nothing at all.
    A service that crash-loops faster than your scrape interval looks perfectly
    healthy to this function.

## Summary

The `# TYPE` line is a contract, not a label: declared by whoever wrote the
instrumentation, stored by Prometheus, relied on by whoever writes the query,
and enforced by nobody. A counter promises monotonicity within one process
lifetime, a reset to zero across restarts, and that only differences carry
meaning — from which every legal operation follows. A gauge promises only that
its current reading is meaningful, which buys `deriv()` and `predict_linear()`
and costs you everything that happened between two scrapes.

The durable takeaways:

- Type is a contract. Nothing checks it. `rate()` over a gauge returns a
  smooth, non-negative, entirely fictional number, because every ordinary
  decrease is read as a counter reset.
- Never display a counter's absolute value. It measures how long the process
  has been alive.
- A gauge is blind between scrapes; a counter of the same events cannot hide
  one. When a gauge could hide something you would be paged for, ship a counter
  beside it.
- A histogram is a family of counters, so anything counters can do, buckets can
  do — including being added across replicas.
- A summary's quantiles were computed inside one process and cannot be
  aggregated. That single limitation is why histograms exist.
- `_info` metrics are always 1. The payload is the labels.
- Odometer, speedometer: the odometer forgets when the engine restarts, and
  nobody is watching the speedometer between glances.

## Exercises

!!! exercise
    **1. Six decisions (warm-up).** For each of these, decide counter or gauge
    and defend it in one line: open database connections; bytes written to
    disk; current queue depth; cache evictions; seconds since the last
    successful backup; temperature. Two are traps, in the sense that the
    obvious reading is not the useful one — say which two and why.

    **2. One sentence for the wrong number (core).** Run
    `rate(catalog_queue_depth[5m])` and `resets(catalog_queue_depth[10m])` side
    by side, and write the one sentence that explains why the first is
    plausible, silent and wrong, using the second as your evidence. Then a
    second sentence: why the same query over `catalog_items_processed`
    currently returns a *correct* number, and what one future commit breaks it.

    **3. Design the blindness (core).** Design a gauge, for a system you
    actually work on, whose real behavior your monitoring would provably miss
    at a fifteen-second scrape interval — state the event, its duration, and
    why both neighboring samples look normal. Then design a counter that
    captures the same events and cannot miss them. Confirm the premise against
    the lab: `changes(catalog_queue_depth[10m])` should read somewhere between
    the high twenties and thirty-nine against forty samples.

    **4. The pull request (core).** Find `catalog`'s gauge that is really a
    counter. Write the one-line diff you would send against `catalog`'s
    `metrics.py` — the line that constructs `ITEMS_PROCESSED` — and the
    one-line PR description explaining the consequence. Then check it: set
    `CATALOG_FIX_TYPE=1` in `lab/.env`, run
    `make up`, and compare
    `curl -s localhost:8081/metrics | grep items_processed` before and after.
    The exposed name changes, and your PR description has to say so — decide
    whether that makes the fix free, cheap or expensive, and say who pays. Set
    the switch back to `0` and `make up` before running `make verify-ch04`.

    **5. When `resets()` lies (stretch).** Restart `snip-api` three times in
    five minutes, then run
    `resets(snip_http_requests_total{job="snip-api"}[1h])`. Does it return 3?
    Read the function's definition again, describe the case where it would
    not, and estimate how fast a crash loop would have to be, at this lab's
    scrape interval, for the function to report zero.

    **6. Census the server (stretch).** Run the type-mix command from this
    chapter against `localhost:9090/metrics` instead of `catalog`. Pick the one
    summary family whose name suggests it measures query performance, and write
    two sentences on why a summary was defensible there, and what you lose the
    day you run two Prometheus servers.
