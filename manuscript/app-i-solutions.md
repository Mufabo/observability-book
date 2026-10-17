# Appendix I — Solutions to the exercises

The solutions sit here, at the back, rather than under each exercise, so the
exercises stay honest: an answer you can see while you are still thinking is not
an exercise, it is a worked example. Come here after you have run the thing, not
instead of running it.

Some exercises are graded by the lab itself. Where a chapter ships a
`make verify-chNN` target, the solution says so and says what the target
asserts. That check, not this page, is the authority on whether your answer
holds up.

Open-ended exercises — design a page, name a metric, argue a trade-off — get
"what a good answer contains" rather than one right answer. Read those as a
checklist against your own reasoning.

And if a solution here disagrees with what you are looking at, trust the running
lab. Versions drift and defaults change; your Prometheus is the primary source,
and this page is a report about one that ran earlier.

## Chapter 1 — Ten Minutes to Your First Metric

**1.** The line climbs to the moment `loadgen` stops, runs flat and level for
that minute, then climbs again — and at no point does it dip, drop to zero or
run backwards. A counter records events since the process started, so no
traffic means no increments, and no increments means every scrape reports the
same value. The instant traffic stopped is the instant the slope went to zero,
which is the thing you point at. A drop would have been a different event
entirely: a restart, which Chapter 4 explains.

**2.** Predict **21** samples at a fifteen-second interval and **61** at five
seconds. Both are 300 ÷ interval **plus one**: twenty gaps need twenty-one
fenceposts, so the ratio is 61/21 ≈ 2.90 rather than 3. Chapter 6 settles the
other half of this — a PromQL range selector is left-open and right-closed, so
`count_over_time(x[5m])` returns exactly 20 and 60, and the fencepost
disappears precisely because one end of the window is excluded. At a
fifteen-second scrape read at five-second resolution, three consecutive
readouts repeat because each one is the newest sample at or before that step
and nothing new arrived between them. Put `scrape_interval` back to `15s`:
`make verify-ch06` asserts `count_over_time(...[1m]) == 4`.

**3.** Any metric whose name and `# HELP` describe *scraping* rather than
memory or the HTTP API. `prometheus_target_interval_length_seconds` is one: it
reports the actual wall-clock time between scrape cycles, in seconds, and
carries an `interval` label naming the configured interval. A good answer names
the metric, says what quantity it measures, and takes the unit from the name's
suffix or the `# HELP` line rather than guessing. Find the candidates rather
than recalling them:

```bash
curl -s localhost:9090/metrics | grep '^# HELP' | grep -i scrape
```

The common wrong turn is answering `up` or `scrape_duration_seconds`. Neither
appears on that page: Prometheus writes both per target at scrape time, so they
are series about other targets, not lines Prometheus exposes about itself.

**4.** The container fails to start and restarts forever; `docker compose logs
prometheus` names the path you typed, in the shape the chapter's trap box
prints:

```text
msg="Error loading config (--config.file=/nope.yml)"
  err="open /nope.yml: no such file or directory"
```

`make ps` shows it restarting rather than `Up`. The second half of the lesson is
the flag you did not write: `command:` replaces the image's arguments wholesale,
so dropping `--storage.tsdb.path=/prometheus` sends the TSDB to the binary's
built-in default instead of the `promdata` volume — a failure you would not have
noticed if the config had loaded, because nothing would have complained. Restore
both flags and run `docker compose up -d prometheus`.

**5.** `up{job="bogus"}` reads **0**; it appears at the first scrape attempt
after the restart, so within one `scrape_interval` — fifteen seconds; and the
Error column names a refused connection (`dial tcp ...:9999: connect:
connection refused`). Nothing is listening on 9999, so the connection fails at
once, and a failed scrape is still a scrape: Prometheus writes `up = 0` for that
target every fifteen seconds. Delete the job from the configuration instead and
there is no target, so no `up` sample is written at all and `up{job="bogus"}`
returns nothing. "Down" is an alertable zero and "not configured" is an absence;
Chapter 2's staleness section and Chapter 9's `absent()` are both about keeping
those two apart.

## Chapter 2 — What's Actually on the Wire

**1.** Four selectors, each with a different matcher doing the work:

```promql
loadgen_requests_total{route="/l/{code}", method="GET",
  code="302"}
```

```promql
loadgen_requests_total{route="/l/{code}", method="GET",
  code!="404", code!="500", code!="503"}
```

```promql
loadgen_requests_total{route="/l/{code}", method="GET",
  code=~"3.."}
```

```promql
loadgen_requests_total{route="/l/{code}", method="GET",
  code!~"[45].."}
```

Keep the `=` form. It states the series it wants and cannot drift; the other
three all depend on knowing which status codes that route can currently
produce, so a new code silently changes what they return. The regex pair costs
you one more thing every time you read it: matcher regexes are fully anchored,
so `code=~"3.."` means `^3..$` and not "contains a 3".

**2.** Yes — it returns every series scraped from `job="snip-api"`, several
hundred rows. At this point Snip's counter carries no labels on the wire, so no
series has a `method` label at all, and a matcher against the empty string also
selects series that lack the label entirely; the selector is legal because
`job="snip-api"` cannot match the empty string. After Chapter 5 adds `method`,
the `snip_http_requests_total` series carry `method="GET"` or `"POST"` and drop
out of this result, while everything else — the Go runtime families,
`process_*`, `up` and the `scrape_*` series — still matches, because none of
them has a `method` label either.

**3.** Three spellings of one selector:

```promql
loadgen_build_info{version="1.4.0"}
```

```promql
{"loadgen_build_info", version="1.4.0"}
```

```promql
{"__name__"="loadgen_build_info", version="1.4.0"}
```

The written answer is that **none** of the dotted text required the quoted form.
The dots live in the label *value* `1.4.0`, and label values have always been
arbitrary quoted strings. Quoting is a rule about *names*: the metric name and
the label name are what must fit `[a-zA-Z_:][a-zA-Z0-9_:]*` or be written
inside the braces in quotes, and both of these already do. The quoted spelling
matters when OpenTelemetry's dotted metric names arrive in Chapter 28.

**4.** A good answer names one mechanism per half and never mixes them. `up` is
synthesized by Prometheus itself, one sample per target per scrape attempt, so
a failed scrape writes a fresh `0`; the series is never stale, never absent, and
keeps reading 0 for as long as the container stays down. The application's
series are not reported at all by that failed scrape, so Prometheus writes a
**staleness marker** for every series the target produced last time, and a
selector that looks back and finds a marker returns nothing for that series —
not zero, nothing. The common wrong turn is reaching for the five-minute
lookback delta: that only governs data which stops with no failed scrape behind
it, and here the marker gets there first. `make verify-ch02` runs the same
experiment and prints `PASS up{instance="snip-api-b:8000"} == 0` and `PASS the
stopped replica's counter returns nothing`.

**5.** Somewhere under thirty seconds, and typically around fifteen. Prometheus
has to attempt the next scheduled scrape and fail before it can write staleness
markers, so the series survives until then and disappears at that scrape; where
in the cycle you stopped the container decides whether you measure five seconds
or fifteen. Compare it with `global.scrape_interval: 15s` in
`lab/prometheus/prometheus.yml`: the number you measured is a property of the
scrape interval, not of `--query.lookback-delta`, and the five minutes the
internet promised you never entered into it.

**6.** The smallest value that works on all ten attempts is one scrape interval
— `15s`. An instant query returns the newest sample at or before the evaluation
time only if that sample is inside the lookback window, and the newest sample is
between zero and fifteen seconds old depending on when you ask, so anything
shorter fails whenever you ask late in the cycle:

```bash
curl -s http://localhost:9090/api/v1/query \
  --data-urlencode 'query=up{instance="snip-api:8000"}' \
  --data-urlencode 'lookback_delta=15s' | jq '.data.result'
```

Reload with `scrape_interval: 5s` and the answer drops to `5s`. The number
tracks the scrape interval and nothing else; the five-minute default is a
ceiling a healthy target never approaches, which is why the practical rule is to
keep the scrape interval well under half of it.

## Chapter 3 — Your First Dashboard: The Early Win

**1.** Panel 2 draws a low, rounded bump instead of a square step, and its peak
sits well below 0.21. `$__rate_interval` is `max($__interval + timeInterval,
4 * timeInterval)`, so declaring a sixty-second scrape interval floors every
rate window at 240 s, and a ninety-second event averaged over four minutes is a
fraction of its true height. Nothing errors and nothing warns, because the two
numbers live in two files that no tool compares. Write down both the shape and
the peak, put `15s` back, and run the injection again to watch the square step
return.

**2.** Every panel reports that its data source was not found. Grafana invents a
random uid when the file does not pin one, `make reset` deletes `grafanadata`
so a fresh one is generated, and every panel in `dashboards/snip-red.json` still
names `"uid": "prometheus"` — a string that now points at nothing. The book's
harder version: a lab can repoint a panel by hand, but printed material — a
dashboard file, and the address `http://localhost:3000/d/snip-red` — has to name
identifiers that will be correct on machines the author will never see, so
nothing generated at runtime can appear in print.

**3.** Predict: Grafana starts cleanly, logs no warning, shows no error in the
UI, and there is no dashboard. `provisioning/dashboards/` holds provider YAML;
the JSON belongs wherever `options.path` points. The two checks agree with each
other:

```console
$ curl -s localhost:3000/api/dashboards/uid/snip-red
{"message":"Dashboard not found","status":"not-found"}
```

and `make verify-ch03` fails its first assertion with the hint naming the two
files and their two jobs. Move the file back to `dashboards/` and the provider
picks it up within `updateIntervalSeconds`, ten seconds later.

**4.** Two series, `up{instance="snip-api:8000"}` and
`up{instance="snip-api-b:8000"}`, both reading 1. A good answer picks a panel
type, defends it by what the panel must make obvious, and then says honestly
whether the choice survives `docker compose stop snip-api-b`: a time series
panel keeps *when* the replica went down, which is the question you will have at
3 a.m., while a stat panel showing both series reads 1 and 0 at a glance and
says nothing about when. Two wrong turns to avoid. Reducing both series to one
number hides which replica is down — a mean of 0.5 tells you half the fleet is
gone but not which half. And do not expect the row to vanish: at this point in
the book the target is written down in `prometheus.yml`, so Prometheus keeps
scraping the address and keeps writing `up = 0`.

**5.** A dashboard of an idle service is worth nothing. Panel 1 falls to zero,
panel 3 empties because `rate()` over a histogram nobody is filling has nothing
to compute, panel 2 was already blank — and a healthy idle service draws exactly
the same picture as one that is wedged or gone. To make silence visible you need
a series produced by the monitoring system rather than by your traffic, which is
`up`, or a stated expectation of a floor on the request rate that something
checks. The sentence to land is that the panels are fine and the evidence
stopped.

**6.** `$__rate_interval` is still **1m**, and the query inspector shows the
range in milliseconds — `[60000ms]` — beside a `step` of 20 or 30 seconds. At
six hours, `$__interval` is 21,600 s divided by Max data points (which defaults
to the panel's width in pixels) and then snapped to a round duration, which
lands on `20s` or `30s` at any realistic panel width. So
`max($__interval + 15s, 4 × 15s)` is `max(35s or 45s, 60s)` = 60 s: the floor
dominates until `$__interval` passes 45 s. That floor is the entire point of the
macro, and Chapter 13 walks the precedence chain behind it.

## Chapter 4 — Metric Types Are Contracts

**1.** Open database connections: **gauge** — a state that rises and falls.
Bytes written to disk: **counter**, named `..._bytes_total` — writes accumulate
and only differences carry meaning. Current queue depth: **gauge** — the word
*current* is the giveaway. Cache evictions: **counter** — an event that has
already happened. Seconds since the last successful backup: **gauge**, but the
useful form is a gauge of the *Unix timestamp* of the last success, subtracted
at query time, which is exactly what `snip_worker_last_success_timestamp_seconds`
does in Chapter 8. Temperature: **gauge**.

The two traps are the last two. An age computed inside the process is only as
fresh as the last scrape and resets its own frame of reference on restart, so
export the timestamp and let PromQL do the subtraction. Temperature is a gauge
and nobody argues about that, but the reading people reach for — the
instantaneous value — is blind between scrapes; if you would be paged for an
excursion, put a counter of threshold crossings beside it. An answer that
nominates "bytes written to disk" instead is acceptable if it explains that the
first reading most people give is current disk
*usage*, which is a different metric altogether.

**2.** First sentence: `rate(catalog_queue_depth[5m])` returns a smooth,
plausible figure around one per second only because `resets(...[10m])` reports
something like seventeen "counter resets" on a process that has not restarted
once — every ordinary drain of the queue is read as a reset and added back, so
the number is arithmetic performed correctly on false premises. Mind the
windows: the reset count is over ten minutes and roughly half of those
decreases fall inside the five the `rate()` saw. Second sentence: the same
query over `catalog_items_processed` is correct today because the code
only ever calls `.inc()` on it, so the series happens to satisfy a contract its
`# TYPE` line does not declare; one future commit calling `.set()` or `.dec()` —
which a `Gauge` openly invites — turns every `rate()` over it into fiction, with
no error anywhere in the pipeline.

**3.** A good answer states a named event, a duration shorter than fifteen
seconds, and why both neighboring samples read a normal value — the state
returned to normal before the next scrape, so nothing anomalous was ever
sampled. Then it names the counter of the same events and says why it cannot
miss them: the burst appears as a difference between two samples even though
nobody was watching while it happened. Confirm the premise with `changes(
catalog_queue_depth[10m])` reading between the high twenties and thirty-nine
against forty samples in ten minutes — the depth is different at almost every
scrape, so what you can see is forty of the five or six hundred values it
actually took. The common wrong turn is proposing a shorter scrape interval as
the fix: that narrows the window, it does not close it.

**4.** The one-line diff, against `lab/catalog/metrics.py`:

```diff
-ITEMS_PROCESSED = Gauge(
+ITEMS_PROCESSED = Counter(
     "catalog_items_processed",
     "Items processed by the catalog indexer.",
 )
```

The PR description has to carry the rename: `prometheus_client` appends `_total`
to counter names on its own, so the exposed name becomes
`catalog_items_processed_total` and every saved query, panel and alert on the
old name goes blank the moment it ships. Verify rather than assert — set
`CATALOG_FIX_TYPE=1` in `lab/.env`, `make up`, and compare:

```bash
curl -s localhost:8081/metrics | grep items_processed
```

The fix is **cheap, not free**, and the people who pay are the ones holding
dashboards and alerts on the old name, which is why the rename belongs in the
description and not in a commit body nobody reads. Set the switch back to `0`
and `make up` before you run `make verify-ch04`: with the fix on, the live name
no longer matches your census entry and the checker reports "no live metric on
this line" instead of grading it.

**5.** Yes, it returns 3 — provided Prometheus actually sampled a lower value
after each restart. `resets()` counts decreases between consecutive samples, not
restarts, and those are only the same thing when a scrape lands between the
death of one process and the moment its replacement climbs back past the old
value. For the function to report zero, the crash loop has to cycle **faster
than one scrape interval**, so that no scrape and its successor ever sample the
same process: at fifteen seconds every sample then comes from a different,
roughly equally-aged process, the values do not decrease, and the graph looks
perfectly healthy. Chapter 6 states the same limit from the other side — a reset
entirely between two scrapes is invisible, and no setting recovers it.

**6.** Run the census against the server and then filter it to the one type that
matters here:

```bash
curl -s localhost:9090/metrics \
  | awk '$1=="#" && $2=="TYPE" {print $4}' | sort | uniq -c
```

```bash
curl -s localhost:9090/metrics \
  | awk '$1=="#" && $2=="TYPE" && $4=="summary" {print $3}'
```

Read the name with `query` in it off your own server rather than from memory;
the family list differs between releases. The two sentences: a summary is
defensible there because the server is reporting on work it did itself, the
quantiles are cheap to compute in-process, and nobody was expected to combine
them with another server's. What two Prometheus servers cost you is exactly
that — quantiles cannot be aggregated, so there is no expression that yields the
median query duration across both, and the only honest moves are to read each
server separately or to re-instrument with a histogram. The wrong turn is `avg()`
across the two `quantile="0.5"` series, which is the mistake this chapter names.

## Chapter 5 — Your First Counter: Instrumenting Code You Own

**1.** The reference metric, one family with one closed label:

```go
Redirects: f.NewCounterVec(prometheus.CounterOpts{
    Name: "snip_redirects_total",
    Help: "Total redirect attempts on /l/{code}, by outcome.",
}, []string{"outcome"}),
```

First sentence: `sum(snip_redirects_total)` is "every redirect attempt Snip has
handled on `/l/{code}`, whatever happened next" — true, complete, and the
denominator of every hit-rate question you will ask. Second sentence: with three
separate names the same total requires knowing all three names exist, so a
fourth outcome added next quarter is silently missing from every panel, and the
hit ratio becomes an expression over three families instead of a group-by on
one. The query confirms both halves of the chapter's claim: all three outcome
values exist at `0` from the first scrape because `zeroInit` touches them, and
`expired` starts climbing about ten minutes in. `make verify-ch05` asserts
`snip_redirects_total covers hit|miss|expired`.

**2.** Three names that break the law, and the sentence each makes `sum()` tell:

- `snip_request_duration` with a `unit` label taking `ms` and `s`. Summing adds
  milliseconds to seconds and produces a number that is neither. **Not
  catchable** — the result looks entirely reasonable, and nothing in it says
  which rows carried which unit.
- `snip_get_requests_total` beside `snip_post_requests_total`. Summing gives
  "how many GET requests Snip has handled", which is true and incomplete, and
  announces neither. **Not catchable** from the data: the reader has to know
  from outside it that a sibling name exists.
- `snip_cache_hit_percent`, scaled 0 to 100. Summing a family of percentages
  gives a "percentage" of several hundred. **Catchable** — the value leaves the
  plausible range, which is the only one of the three a reader can spot cold.

**3.** The first request succeeds with `201`; the second returns `curl: (52)
Empty reply from server` and HTTP code `000`. The error is in the container log
— `http: panic serving ...: duplicate metrics collector registration attempted`,
with `promauto.Factory.NewCounter` and `prometheus.(*Registry).MustRegister` in
the stack — because `promauto` panics rather than returning an error, and Go's
HTTP server catches the panic, logs it and closes the connection. Two requests
is the entire margin. The part that matters: **nothing you are watching
noticed.** The process stays up, `/healthz` stays 200, `up` stays 1, no 5xx is
recorded anywhere, because the handler never wrote a status for the middleware
to count — the only evidence is the container log and a counter that stopped
moving. Put the file back and `make up`.

**4.** It arrives as `exported_env`. Prometheus attaches `env="lab"` from the
scrape configuration, and when a scraped label collides with a target label the
server keeps its own and prefixes yours; every query written against `env` now
quietly misses your copy. The one line: the application is the wrong place
because the value is a property of the deployment rather than of the code, so
changing it later costs a code change, a build and a deploy of every service
that hard-coded it, where the same change at the scrape is one line of YAML and
`docker compose restart prometheus`.

**5.** A good pair of comments differs in **where the defect lives**, not in
tone. For a service the team owns: the fallback records a defect in the
monitoring configuration rather than fixing it in the code that caused it; it
applies to every target in that job forever, including services that do not
exist yet, so the next one can regress to no header and nobody is told; and the
fix at the source is one line, because `promhttp.HandlerFor` sets the header for
you. For a vendor appliance: this is exactly what the field is for, since you
cannot change the endpoint; pin the value to the format the appliance actually
serves, one of the five case-sensitive names; and say in a comment which vendor
and why, so that it can be removed when they ship a fix. The common wrong turn
is calling the fallback a hack in both cases — using it on code you control is
choosing to carry the defect, and that is a different sentence from "never use
it".

**6.** Grade your own against these, from `lab/snip/metrics.go`:

- `snip_links_created_total` — *Total short links successfully created.*
- `snip_cache_lookups_total` — *Total cache lookups performed while resolving a
  short code, by result.*
- `snip_links_active` — *Short links that currently exist and have not expired.*
- `snip_build_info` — *Build information for the running Snip process. Always 1;
  read the labels.*
- `snip_redirects_total` — *Total redirect attempts on `/l/{code}`, by outcome.*

Every one of them says what is counted and, where a unit exists, in what unit;
none of them repeats the metric name back at you. "Snip links created total."
fails on both counts. `make verify-ch05` enforces the mechanical half of the
naming law — no metric name may contain one of the label names the service uses,
and every duration-shaped name must end in `_seconds`.

## Chapter 6 — `rate()`, `increase()`, and Why Nothing Is a Whole Number

**1.** Read the four samples off the Table tab and compute
Δ × R ÷ C, where Δ is the last value minus the first, C is the span between the
first and last sample (45 s at a fifteen-second interval) and R is the declared
range (60 s). So the prediction is Δ × 60 ÷ 45 = Δ × 1.3333, and it will not be
a whole number: the counter went up by, say, 46 over 45 seconds of evidence, and
`increase()` is asked about 60 seconds. Neither guard rail fires in the ordinary
case — the two edge gaps must add up to 15 s, so neither can reach the 16.5 s
threshold, and a counter with thousands behind it is nowhere near the zero
clamp. Write the prediction into `exercises/ch06-predictions.txt`:

```text
increase(snip_links_created_total{job="snip-api",
  instance="snip-api:8000"}[1m]) = 61.33
```

That is **one physical line** in the file — it is wrapped here to fit the page —
because the verifier splits on the exact string ` = ` and ignores any line
without it. `make verify-ch06` grades it within 10 % or 0.5 absolute, whichever
is kinder, and prints `PASS prediction N within tolerance: <yours> vs
<measured>`.

**2.** **Rung 9** — is the range at least 4× the scrape interval? Rung 8 comes
first and clears the selector: strip `rate(...)` and the staircase is there;
put the range back without the function and `count_over_time(...[10s])` returns
1, or no row at all. The one-line fix is to widen the window to at least four
scrape intervals — `[1m]` here, or `$__rate_interval` on a panel. Dropping to 4
requests per second is not what emptied it: every function in this family needs
two **samples**, not two events, and a ten-second half-open window over a
fifteen-second grid cannot hold two at any alignment, at 4 rps or at 400.

**3.** They agree to every digit, because `increase(x[R])` **is** `rate(x[R])`
multiplied by R seconds — the same code path with the final division omitted.
Whatever extrapolation factor was applied to the numerator at that evaluation
was applied to both expressions, so it cancels identically every time; the
factor moving from one step to the next changes both sides together and can
never separate them. That is also why the identity is not a coincidence you
should re-verify on your own service: it is the definition.

**4.** A large negative number — tens of thousands of negative requests per
five minutes — for as long as the restart stays inside the window. The rule:
**`rate()` and `increase()` for counters, `delta()` and `deriv()` for gauges,
and nothing crosses over.** Check that your sentence is about metric types: it
must be, because `delta()` is not broken and needs no fixing. It did precisely
what it promises — first-to-last difference with no reset correction — and it
was the only function in the family that had no business being pointed at a
counter.

**5.** Put the threshold on `rate()`. Two sentences about `irate()`: on the
graph it draws a picket fence rather than a curve, because it computes from the
last two samples only and has no averaging left to absorb a fifteen-second
wobble; and against `for:` every dip below the threshold restarts the debounce
timer, so an `irate()` alert with `for: 5m` can sit over its threshold for an
hour and never fire once. Reset with `curl -s -XPOST
localhost:8089/chaos/reset` when you are done, or `make verify-ch06` grades your
`loadgen_target_rps` prediction against 40 rather than 20.

**6.** 15 s → **4**; 20 s → **3**; 30 s → **2**. Each is 60 ÷ interval exactly,
and the answer does not depend on alignment because the window is half-open; the
`⌊⌋`-or-`⌈⌉` case only appears when the interval does not divide the range
evenly. At a thirty-second interval the `[2m]` panel holds four samples, which
is the 4× floor itself and therefore **no headroom at all**: one missed scrape
takes it to three, and there is nothing left to give before the two-sample
minimum. That is why the chapter's table says people write `[2m]` or `[5m]` at
thirty seconds. Put `scrape_interval` back to `15s`; `make verify-ch06` asserts
`count_over_time(...[1m]) == 4` and several later chapters assume it.

## Chapter 7 — Labels, and the Cardinality Arithmetic You Must Do First

**1.** There is no single right label set, so a good answer is three things: a
**figure**, a **rejected label**, and the **sentence** that says where the
rejected label's question gets answered instead. The figure has to be built the
way the chapter builds it — the product of the value sets per family, times the
replica count, plus the two blocks nobody budgets for: the `go_*` and
`process_*` families that arrived with the default registry, and the five
`up`/`scrape_*` series the server writes per target. Reconcile the product
against the observed set and note the gap; budget with the product, because the
gap closes on its own as new code paths and status codes appear. The wrong turn
is the one `make verify-ch07` is built to catch: budgeting only the metrics you
wrote and then failing the 10 % comparison against `count({job="snip-api"})`.
Passing prints `PASS your budget is within 10% of the measured series count`
and ends `ch07 OK`.

**2.** **394** against the chapter's worked figure of 138. The point is that
the label multiplies rather than adds: cardinality is a product, so three
values triple everything the process exposes — runtime families included —
giving 3 × 128. The five server-written series per target are excluded,
because Prometheus writes `up` and `scrape_*` from the target's own label set
and never sees yours; those ten stay ten, and 3 × 128 + 10 = 394. Getting 414
means you tripled block three as well. Who should set it: whoever runs the
scrape. `region` belongs with `job`, `instance`, `env` and `cluster` in the list
application code must never emit, because the process knows only which
environment variable it was handed, not where it is deployed — and changing the
value later costs a code change, a build and a deploy, against one line of YAML
and a reload.

**3.** **132** and **192** series per replica. A histogram costs
`(finite boundaries + 1) + 2` series per label combination — the `+1` is the
`+Inf` bucket and the `+2` is `_sum` and `_count` — so eight boundaries is 11
per combination and thirteen is 16. The label set is the twelve observed
`(route, method, code)` combinations, giving 12 × 11 = 132 and 12 × 16 = 192.
Chapter 10 ships the thirteen-boundary design, because `0.3` has to be a real
boundary for Chapter 20's objective; it also checks your figure, and warns you
that the measured count sits *below* 192 because histograms are deliberately not
pre-initialized.

**4.** State the `result` assumption first, because it doubles the answer:
200,000 books at 0.5 % requested per day is **1,000 new `book_id` values a day**,
and if a given book is seen as both a hit and a miss that is **2,000 new series
a day**, none of which is ever reclaimed — roughly 60,000 a month, from one
counter whose honest cardinality is two. The PR description needs four parts:
the defect (`book_id` comes straight off the URL path and nothing bounds it, and
misses are labeled too, so any caller can mint series), the cost per week, the
fix (drop `book_id`, keep `result`), and what the fix breaks (any saved query
grouping by `book_id` stops returning rows, and the per-book question has to move
to the database, a log pipeline or a nightly top-N job). Then compare with
`count(count by (book_id) (catalog_lookups_total))` on your own stack; the
captured reference run held **3,248 series and climbing** on that one counter.
The one-line explanation of the difference: your number is a function of how long
the stack has been up and how many distinct books the link pool has touched, not
of anything in the instrument — and a traffic pattern is not a bound.

**5.** A good answer names a metric from **your** run, explains its size in one
line of multiplication, and shows the two sources agreeing. The explanations
that actually apply here are: a histogram family costs boundaries + 3 per label
combination, which is why one latency metric outranks a dozen counters; a
metric on two replicas costs twice what the same metric costs on one; and
`catalog_lookups_total` is large for a reason nobody chose. Confirm with the
status API, which needs no query engine and is the thing to reach for when the
server is too busy to answer PromQL:

```bash
curl -s localhost:9090/api/v1/status/tsdb \
  | jq '.data.seriesCountByMetricName[:10]'
```

Both rankings count head series by metric name, so they agree; if they do not,
you scoped the PromQL form with a matcher and are comparing two different
questions.

## Chapter 8 — Aggregation: `sum`, `without`, and the Rate-Then-Aggregate Law

**1.** The chapter hands you the first pair:

```promql
sum by (route) (
  rate(snip_http_requests_total{job="snip-api"}[1m]))
```

```promql
sum without (instance, code) (
  rate(snip_http_requests_total{job="snip-api"}[1m]))
```

Six groups and six identical values both times — each route in this lab has
exactly one method, so folding `method` away changes nothing — but the second
arrives carrying `env`, `job`, `method` and `route`. `by (route)` threw away
`job` and `env`, which are the two labels Chapter 17 routes on: "send anything
from `job="snip-api"` to the rotation" cannot be written against a series whose
only label is a route name. The other two pairs work the same way —
`count by (job) (up)` against `count without (instance) (up)` loses `env`, and
`sum by (job) (rate(...))` against `sum without (instance, route, method, code)
(rate(...))` loses it too. Verify each pair with `count()` wrapped around both
sides: the same number of output series, different label sets.

**2.** Exactly **3** rows as an instant query, and more than 3 legend entries
over six hours. A graph is one range query evaluated independently at every step
on the grid, `topk` is recomputed at each of those timestamps, and the panel
unions the winners: a route that was third busiest at 09:00 and a different one
at 09:05 both appear, each drawn only over the steps where it won. The panel is
not buggy, and there is no sorting to fall back on either — output is sorted for
instant queries and no sorting applies to range queries. Keep `topk` in tables
and instant queries.

**3.** One row, reading 3:

```promql
count_values by (version) ("copies", snip_build_info)
```

```text
{copies="1", version="1.4.0"}   3
```

Three processes — two `snip-api` replicas and `snip-worker`, all running the
same image. Read the row carefully: `copies="1"` is the *sample value* of an
info metric, which is always 1, and `3` is how many series carried it. The same
answer with `count` is `count by (version) (snip_build_info)`. Either is
defensible on a deploy dashboard as long as the reason is about reading: `count
by (version)` drops the always-1 value and gives you one row per version, while
`count_values` keeps a `copies` label that carries no information on an info
metric — and would carry real information on any metric whose value varies.

**4.** They agree today because there is exactly one `snip-worker`, so each
group has one member and the average of one number is its sum. With three
workers they would diverge, and `avg` — or `max` — is the one to threshold:
`snip_worker_queue_depth` is read straight out of the shared database, so three
workers all report the *same* backlog and `sum` would triple-count it, exactly
like `snip_links_active`. For the five-minute watch, back whatever you observe
with arithmetic: the analytics queue wakes every five seconds and does at most
`maxBurst` jobs per wake, so compare its drain rate against its arrival rate

```promql
sum(rate(snip_worker_jobs_total{job="snip-worker",
  queue="analytics", outcome="success"}[5m]))
```

against the redirect rate feeding it. Drain below arrivals means the depth must
trend up and the queue is saturated at its burst cap; roughly equal means flat.
The wrong turn is reading the gauge as throughput — it is a state sample, blind
between scrapes, and the counter is what cannot hide the work.

**5.** A good answer adds something that is different **in kind**, not in
subject: the worker already has a counter of events, a gauge of state, a
histogram of durations and a timestamp gauge, so a fifth request-shaped counter
is not an answer. The two shapes that qualify are another state reading the
counter cannot express — the age of the oldest unprocessed row, as a gauge in
seconds — or a timestamp of something other than success. Whatever you pick, the
name is yours and nothing in the lab ships it, so Chapter 5's law is the test:
`_total` only if it is a counter, base units so a duration ends in `_seconds`,
unit suffix before type suffix, and no label name buried in the name. Verify by
`curl`ing `localhost:8090/metrics` and then querying it in Prometheus one scrape
later; if it is on the wire but not in Prometheus, the problem is the scrape and
not the code.

**6.** Predict **A ÷ 60 plus the real rate**, where A is the counter of the
replica that does **not** restart and 60 is the rate window in seconds. That is
what the algebra leaves behind: `rate()` adds the pre-drop value of the summed
series back in as a reset correction, everything cancels except the survivor's
lifetime count, and dividing by the window gives the spike's height.
`max(sum by (instance) (snip_http_requests_total{job="snip-api"}))` is a usable
predictor only when the two replicas are similarly loaded — if the split is
lopsided and you restart the busier one, `max` names the counter that has gone
to zero, and the number you should have used is the smaller one. `make verify-ch08`
runs the same restart and prints `PASS rate(sum(...)) exceeds sum(rate(...)) by
over 5x` along with a `peak multiple:` note you can compare against your
prediction.

## Chapter 9 — Ratios, Arithmetic, and the Series That Isn't There

**1.** `avg(...)` is higher, by roughly two hundred times: about **0.3333**
against about **0.0017** on a settled lab at 20 rps. At 200 rps the ratio of the
sums falls by about a factor of ten while the average barely moves, so the gap
widens to something like two thousand times. The two sentences: the 404s are
dominated by `route="other"`, a fixed trickle of one request every thirty
seconds that does not scale with `rps`, so raising the rate multiplies the
denominator of `sum(a)/sum(b)` by ten while leaving its numerator where it was.
The average gives `other` one equal vote regardless of its volume, and `other`
is 100 % 404 at any rate, so the mean of the per-route ratios stays where it is.
`make verify-ch09` prints both numbers side by side and asserts `avg(a/b)
disagrees with sum(a)/sum(b)`.

**2.** The three whole-service forms:

```promql
(sum(rate(snip_http_requests_total{job="snip-api",
   code=~"5.."}[5m])) or vector(0))
/ sum(rate(snip_http_requests_total{job="snip-api"}[5m]))
```

```promql
(sum(rate(snip_http_requests_total{job="snip-api",
   code=~"5.."}[5m]))
 or 0 * sum(rate(snip_http_requests_total{job="snip-api"}[5m])))
/ sum(rate(snip_http_requests_total{job="snip-api"}[5m]))
```

```promql
sum(rate(snip_http_requests_total{job="snip-api",
  code=~"5.."}[5m]))
/ sum(rate(snip_http_requests_total{job="snip-api"}[5m]))
```

Swap every `sum(` for `sum by (route) (` for the by-route versions. Ranked worst
to best: `or vector(0)`, then `or 0 * <denominator>`, then pre-initialization in
the application. The argument must reach the new-status-code case, because that
is where the ranking earns itself: `or vector(0)` is fine while the answer has
no labels and wrong the moment it has any — on the by-route form it matches none
of the six routes and appends a seventh, unlabeled row that no legend can name.
`or 0 * <denominator>` is correct at any grouping and merely verbose, because
the zeros it supplies carry the denominator's own label set. Pre-initialization
is the real fix and patches nothing — but it only covers the combinations the
code enumerates, so a status code nobody listed is absent again on the day it
first occurs, which is precisely when you needed the panel. That is the argument
for keeping the query-side guard even on a service that pre-initializes.

**3.** `up == 1` filters: it returns the surviving elements with their original
values and keeps the metric name, so with one replica stopped it returns five
rows rather than five ones and a zero. `up == bool 1` returns every element with
its value replaced by 1 or 0 and drops the name, so it returns six rows, one of
them 0. Use the plain comparison where you want a **set of bad things** — `up ==
0` in an alerting rule produces one alert per down target and nothing when all
is well. Use `bool` where you want to **count or average an outcome** —
`avg(up == bool 1)` is the fraction of targets that are up, and the plain form
cannot produce it because the denominator has already been filtered away.

**4.** One expression, three states, never empty:

```promql
(sum(rate(snip_http_requests_total{job="snip-api"}[5m]))
   > bool 0)
or vector(0)
```

With traffic the comparison yields 1. With `rps: 0` the pre-initialized counters
are still there, flat, so the rate is 0 and `> bool 0` yields 0. With both
replicas stopped the series go stale, `sum()` over an empty vector produces no
element, and `or vector(0)` supplies the label-less zero — which is the one
place that idiom is exactly right, because the answer has no labels either way.
It cannot distinguish "serving nothing" from "gone", since both read 0. On a
tile answering "is Snip serving?" that is acceptable, because the operator's
next move is the same. In an alert it is not: those two need different
responses, and `absent_over_time(snip_http_requests_total{job="snip-api"}[10m])`
is the expression that separates them.

**5.** Two calls, with the regexes anchored explicitly:

```promql
label_replace(
  label_replace(
    sum by (instance) (
      rate(snip_http_requests_total{job="snip-api"}[5m])),
    "replica", "replica-$1", "instance",
    "^snip-api-(.+):8000$"),
  "replica", "replica-a", "instance", "^snip-api:8000$")
```

The other legend was empty because `label_replace` returns an element
**unchanged** when the regex does not match: `snip-api:8000` has no `-b` in it,
so no `replica` label was created, no error was raised, and a legend pointed at
`{{replica}}` rendered nothing. There is no single regex that invents an `a`
that is not in the string, so the fix is a second `label_replace` naming the
other case. Anchor both patterns yourself, as the chapter advises, so the
intent is on the page rather than in the reader's memory.

**6.** A group modifier exists to solve one problem: an element on the "one"
side has to be **combined with** several elements on the "many" side, and the
modifier declares which side is which so the arithmetic can be applied
repeatedly while the result stays uniquely identified. `and`, `or` and `unless`
never combine two values. They perform a membership test on label sets and then
return the left-hand element unchanged — its value, its labels and its metric
name all come from the left, and the right-hand element's value is never read at
all, only its existence. So there is no second value to fold in and no result
identity to disambiguate, which means there is nothing for `group_left` to say.
Asking `and` which side is the many side is asking a question about an operation
that is not happening.

## Chapter 10 — Latency: Histograms Without Tears

**1.** Divide the measured count by sixteen — thirteen finite boundaries, plus
`+Inf`, plus `_sum` and `_count` — and you get the number of `(route, method,
code)` combinations your traffic has actually produced. It is below the 192
ceiling because the histogram is deliberately not pre-initialized, so a
combination appears only once it has happened. The usual holdouts are the two
`500`s, which need the error injector; `POST /links` answering `400`, which
waits for the malformed-URL trickle; `/` and `other`, which arrive with the
browser-and-scanner noise; and `503`, which needs Postgres to be unreachable.
Mint one on purpose, cleanly and alone:

```bash
curl -s -o /dev/null http://localhost:8000/nope
```

That is `route="other"`, `method="GET"`, `code="404"` on the replica listening
on 8000, and `count by (instance) (...)` rises by exactly sixteen there within
one scrape.

**2.** Adding `15` above `10` in `sloBuckets` moves the p99 off `10` and into
the new band: the twelve-second observations now land in the `le="15.0"` bucket
instead of `+Inf`, and `histogram_quantile` interpolates inside it, so you get a
number between 10 and 15 with decimals on it. The two sentences for your
colleague: latency did not change, the instrument's resolution did — the p99
moved because the ceiling moved. And the previous reading of exactly 10 was
never a measurement of ten seconds; it was the ceiling rule saying "at least ten
seconds, resolution exhausted". The cost is one more series per label
combination, 16 → 17, which raises the per-replica ceiling from 192 to 204.
Revert the boundary before you run `make verify-ch10`, which asserts `13 finite
buckets plus +Inf` and would read 15. One caveat on that target: its p99
assertion needs the two-minute rate window to sit mostly inside the injection,
so a first run can report a value near your baseline instead of `10`. Wait a
minute and run it again before you go looking at your bucket list.

**3.** They agree, because `0.3` is a real boundary of this histogram:

```promql
sum(rate(snip_http_request_duration_seconds_bucket{
      job="snip-api", le="0.3"}[5m]))
/
sum(rate(snip_http_request_duration_seconds_count{
      job="snip-api"}[5m]))
```

```promql
histogram_fraction(0, 0.3,
  sum by (le) (rate(snip_http_request_duration_seconds_bucket{
    job="snip-api"}[5m])))
```

Either is defensible in a rule, and a good answer picks one and names the
failure mode it is accepting. The bucket ratio is two plain counter rates —
cheap, obvious, and readable by anyone — but it hard-codes `le="0.3"` as a
string, which is one silent blank away from the normalization trap and breaks if
the bucket list is ever edited. `histogram_fraction` never spells an `le` value,
reads like the question, and survives a later move to native histograms — but it
still needs `le` to survive the inner aggregation, and it is one more function
whose behavior you have to check against your server's version. What must appear
either way: neither form can answer for a threshold that is not a boundary, so
the real decision was made in the bucket list.

**4.** The tail injection gives you the first disagreement for free: the mean
climbs from roughly `0.005` to roughly `0.23` while the p95 stays in
milliseconds, because under two percent of requests are slow and p95 sits below
where the tail starts. A `db_delay_ms` injection gives you the opposite shape —
the delay lands only on requests that miss the cache or write, which is a
minority of the mix but far more than two percent, so the p95 moves a long way
while the mean moves much less. Put both on one panel:

```promql
sum(rate(snip_http_request_duration_seconds_sum{
      job="snip-api"}[5m]))
/
sum(rate(snip_http_request_duration_seconds_count{
      job="snip-api"}[5m]))
```

```promql
histogram_quantile(0.95,
  sum by (le) (rate(snip_http_request_duration_seconds_bucket{
    job="snip-api"}[5m])))
```

Quote the quantile in the incident channel and the mean in the capacity review:
a mean tells you about the total, and mean latency times request rate is total
time spent waiting, which has a budget; a quantile tells you about a person, and
in an incident a person is who is complaining.

**5.** `catalog_request_duration_seconds_bucket{le="0.3"}` is empty because that
**boundary does not exist**: `prometheus_client`'s defaults go 0.25, 0.5, with
no 0.3 anywhere, so the series was never created and no query can recover it.
`snip_http_request_duration_seconds_bucket{job="snip-api", le="1"}` is empty
because the **spelling is wrong**: Prometheus 3 normalizes `le` to canonical
float form on ingestion, so the stored value is `1.0` and your selector matches
nothing while the series sits right there. `count by (le) (...)` prevents the
second one outright — it lists the stored values and you paste what comes back.
It would also have *revealed* the first, but not prevented it: the fix there is
upstream, in a bucket list that contains the boundary, which is exactly what
Snip's `0.3` is doing in this chapter.

**6.** The diff against `lab/catalog/metrics.py`, in `observe_request()`:

```diff
-    elapsed_ms = (perf_counter() - started) * 1000.0
-    REQUEST_DURATION.labels(route=route).observe(elapsed_ms)
+    REQUEST_DURATION.labels(route=route).observe(
+        perf_counter() - started
+    )
```

Does the metric name change? **No** — and say so in the description, because a
reviewer's first instinct is that a unit change must be breaking. The name
promised seconds all along; the code was wrong, so this is the one place in
metric naming where the correct fix leaves every existing query working. Verify
without editing the repository:

```bash
CATALOG_FIX_UNITS=1 docker compose up -d catalog
```

Give it a minute of traffic, then re-run `histogram_quantile(0.95, sum by (le)
(rate(catalog_request_duration_seconds_bucket[5m])))`; the finite buckets fill
in and the answer becomes a small number with decimals instead of `10`. Tell the
reviewer what to check on today's dashboards: every query keeps working, and
every *number* moves by a factor of 1,000, so any threshold, axis range or alert
tuned against the broken values has to be retuned in the same change. Turn the
switch back off — the bug belongs to the team that owns `catalog`.

## Chapter 11 — Joins, info metrics, and the rest of PromQL

**1.** Three different failures, and each one names a different label set.

(a) With the left side aggregated `sum by (instance, route)` and the
group modifier flipped to `group_right(version)`:

```promql
sum by (instance, route) (
  rate(snip_http_requests_total{job="snip-api"}[5m])
)
  * on (instance) group_right(version)
    snip_build_info{job="snip-api"}
```

You get `found duplicate series for the match group {instance="…"} on
the left hand-side`. `group_right` declares the *right* side to be the
many side, so the left must hold one series per match group — and it
holds one per route. The label that failed to line up is `route`: it
survives the aggregation and `on (instance)` does not account for it.

(b) Deleting `on (instance)` leaves full-label-set matching. The left
side carries `{instance, route}`; `snip_build_info` carries `{commit,
env, goversion, instance, job, version}`. No two signatures are equal,
every element is dropped, and the result is empty.

(c) `on (instance, version)` is empty for the opposite reason: the left
side has no `version` label at all, so its match signature can never
equal the right side's. A label you are matching on has to exist on
both sides.

**2.** Join first, then aggregate, and divide once at the end.

```promql
sum by (version) (
  sum by (instance) (rate(snip_http_requests_total{
    job="snip-api", code=~"5.."}[5m]))
  * on (instance) group_left(version)
    snip_build_info{job="snip-api"}
)
/
sum by (version) (
  sum by (instance) (rate(snip_http_requests_total{
    job="snip-api"}[5m]))
  * on (instance) group_left(version)
    snip_build_info{job="snip-api"}
)
```

The shape matters more than the query. Sum the numerators and sum the
denominators per version, then divide — averaging per-instance ratios
gives an idle replica the same vote as a busy one, which is chapter
14's first planted lie. During the roll you see two lines; the version
that is scraped but serving nothing has 0 on both sides, so that
element is `NaN` unless you guard the denominator with `> 0`.

**3.** The commands, one per measurement:

```bash
Q='max_over_time((sum(rate(
  snip_http_requests_total{job="snip-api"}[1m])))[1h:1m])'
curl -sS -G localhost:9090/api/v1/query \
  --data-urlencode "query=$Q" \
  --data-urlencode 'stats=all' | jq .data.stats.samples
```

Repeat with `[1h:15s]`, and then with
`Q='max_over_time(loadgen_inflight_requests[1h])'`.

The ordering the chapter predicts holds, and the arithmetic is the
reason. A subquery re-evaluates the inner expression once per step —
about 61 evaluations at `1m`, about 241 at `15s` — and each evaluation
reads a fresh one-minute window of every `snip_http_requests_total`
series on every replica. Four times the steps, four times the samples.
The plain range vector reads each stored sample of one small gauge
family exactly once, with no re-evaluation at all.

**4.** The ratio:

```promql
sum(rate(snip_http_requests_total{job="snip-api"}[5m]))
/
sum(rate(snip_http_requests_total{job="snip-api"}[5m] offset 1h))
```

A value of 2 means traffic is twice what it was an hour ago. `offset
7d` returns nothing because no sample from seven days ago is stored,
and an unmatched series on a graph is an absent line with no error —
the same silence chapter 9 taught you to distrust. Chapter 20's `make
backfill` is what eventually gives the seven-day form something to
read.

**5.** The error, verbatim:

```text
1:1: parse error: offset modifier must be preceded by an instant vector
selector or range vector selector or a subquery
```

The form that works moves the modifier inside, onto the selector:

```promql
sum(snip_links_active{job="snip-api"} offset 5m)
```

The gap between the two numbers is the *net* change in live links over
five minutes — creations minus expiries. Snip gives a link a default
lifetime of ten minutes, so once the gauge has settled the two sides
balance and the difference sits near zero. Run it within the first ten
minutes after `make up` and you see five minutes of creations with
nothing yet expiring, which is the large number the exercise is after.

**6.** All three need `--enable-feature=promql-experimental-functions`,
per this chapter's table. Without it each one fails at parse time in
the same shape:

```text
1:1: parse error: function "info" is not enabled
```

Note the wording: not "unknown function", because Prometheus knows the
function perfectly well and has been told not to offer it.
`docker compose config prometheus` at `ch11` shows a `command:` block
with no `--enable-feature` at all, so all three functions fail. The only
feature flag this lab ever sets is `exemplar-storage`, and that arrives
in Chapter 29 — it would not help here either. A flag being present is
not the same as *your* flag being present.

## Chapter 12 — `prometheus.yml` in Full: Service Discovery and Relabeling

**1.** The constant form — no `source_labels`, so `replacement` is
written literally. It goes in `relabel_configs` on the `snip-api` job:

```yaml
      - target_label: tier
        replacement: frontend
```

After `make reload` plus one refresh and one scrape,
`up{job="snip-api", tier="frontend"}` returns one row per replica and
`snip_http_requests_total{tier="frontend"}` returns rows too. Both work
because a target label is attached to every sample from that target as
it is stored — the application was never asked.

**2.** The rule, on the `loadgen` job:

```yaml
    metric_relabel_configs:
      - source_labels: [__name__]
        regex: go_.*
        action: drop
```

`count({job="loadgen"})` falls from 177 to 142, which is 177 − 35. It
has to be `metric_relabel_configs` and not `relabel_configs`: the
`__name__` label does not exist until the response has been parsed.
Take the rule out again afterward — `loadgen` is the one service whose
Go runtime metrics the repository keeps, so that chapter 22 has a
runtime to look at.

**3.** Replace the whole `docker_sd_configs` block and its seven rules
with:

```yaml
  - job_name: catalog
    file_sd_configs:
      - files:
          - /etc/prometheus/targets/*.json
```

`catalog` comes back UP. `job` is `catalog` because the scrape config
that read the file says so; the file supplies only `targets` and
`env: lab`. Note what you lost along with the seven rules: `instance`
now falls back to `__address__`, so it reads `catalog:8081` rather
than a name a relabel rule wrote.

The second half is the contrast the exercise exists for. A `file_sd`
target with nothing behind it *appears* on `/targets`, in state DOWN,
with a connection error, and `up` for it reads `0` forever — the same
behavior as `static_configs`, because both are hand-written lists.
That is rung 2 of the ladder, with rung 3 for the error text. A
discovered container that disappears is *withdrawn*: no target, no
`up` series at all, which is rung 1. "Is it down" and "is it missing"
are two different questions, and chapter 16 writes an alert for each.

**4.** Predict first: the rule reads a `__meta_*` label, and those are
consumed and discarded before the HTTP request goes out, so at
sample-relabeling time the joined source string is empty, `regex:
"true"` does not match it, and `keep` keeps nothing.

What you see confirms it and looks contradictory. `/targets` shows the
replicas UP with a healthy last-scrape time. `up{job="snip-api"}` reads
`1`. And `snip_http_requests_total{job="snip-api"}` returns nothing at
all. The first two disagree with the third because the scrape genuinely
succeeded — the fetch happened, the response parsed — and `up` is
written by Prometheus *after* metric relabeling has run, so it is
never one of the samples a `drop` or `keep` can remove.

**5.** All four go down, not two. `target_limit` is the only one of the
six limits whose breach is collective: the job discovered more targets
than allowed, so the job fails, including the two replicas that were
fine before the others appeared. `/targets` reads:

```text
target_limit exceeded (number of targets: 4, limit: 2)
```

**6.** The spread is 0 to 30 seconds, and it is not jitter. Prometheus
polls the file every `--config.auto-reload-interval`, which defaults to
30 seconds, so where your save lands inside that cycle decides the
delay. The worst case is one full interval, a shade under 30 seconds,
plus the one scrape interval a new target then needs before it produces
a sample.

Break the file and the log shows the parse error at `level=ERROR` with
`msg="Error reloading config"`, then keeps trying at every interval —
and keeps serving the last good configuration. Nothing is lost and no
target stops being scraped. A rejected reload is a no-op.

## Chapter 13 — Dashboard Mechanics: Intervals, Panels and Variables

**1.** `$__interval` is `1m` and `$__rate_interval` is `1m15s`.

With Max data points empty it defaults to the panel's width, 400. Six
hours is 21,600 seconds, and 21,600 ÷ 400 is 54 seconds, which snaps to
the nearest rung on the ladder — 60, not 30, and not upward to 120.
Then `max(60 + 15, 4 × 15) = 75`. Inspect → Query must show `step: 60`
and the window written as `75000ms`, which is the same 75 seconds in
the unit Grafana emits.

**2.** The panel develops gaps at the first zoom level where
`$__interval` snaps to `20s` or below, and the exact range depends on
your panel width, because Max data points is the pixel count.

The reason it breaks *there* and not one step earlier is arithmetic on
a 15-second scrape. A left-open `[30s]` window holds exactly two
samples, which is the bare minimum `rate()` needs, so at `30s` the
panel still draws — with no margin, so one missed scrape empties a
window. At `20s` most windows hold one sample and `rate()` returns
nothing for them, which renders as dots and broken lines rather than
an error.

**3.** What a good note contains, because the observation is the point
and the exact seconds are yours:

- The mechanism. An instant query returns the newest sample within
  Prometheus's five-minute lookback delta and shows no sign of its
  age; a range query's `rate()` needs two samples inside its window
  and therefore stops sooner. When a series stops being produced, the
  graph ends while the Stat keeps painting a confident number for up
  to five minutes.
- The measurement. The disagreement opens roughly one
  `$__rate_interval` after the series stops and lasts until the
  lookback delta expires.

The common wrong turn is choosing an expression over a counter that is
still being scraped. At `{"rps":0}` Snip's twelve pre-initialized
combinations do not disappear — they sit still — so both panels decay
to zero together and there is nothing to see. To reproduce the effect
you need a series that genuinely stops: pause a container, or use the
`timeShift` mechanism chapter 14 plants on the broken dashboard.

**4.** With one value selected the panel works. With a second, it goes
blank and the legend empties, and Inspect → Query shows why:

```promql
sum by (route) (
  rate(snip_http_requests_total{job=~"snip-api",
    route="(/links|/healthz)"}[75000ms])
)
```

You asked for series whose `route` label is that literal string,
parentheses and pipe included. None exists, Prometheus returns an empty
vector, and Grafana draws nothing — with no error, which is what makes
it indistinguishable from an outage. Change the one character back to
`=~`.

**5.** With Reduce *below* Organize the pipeline runs rename first:
`Value` becomes `req/s`, and then Reduce throws that column away and
replaces the frame with `Field` and a calculation column. Your header
is gone.

With Reduce *above* Organize the collapse happens first, so Organize
is renaming columns that exist at that point in the chain and `req/s`
survives. Transformations consume the output of the one above them,
which is why "this transformation does nothing" almost always means
the column it names no longer exists by the time it runs.

**6.** Open-ended. A good answer contains three things:

- What you observed at both widths. Auto grid reflows the panels into
  a uniform grid as the window narrows; Custom keeps the two
  spike-recovery panels side by side at every width, which is the
  whole point of that row.
- The file check. The Auto grid conversion does not appear in the
  exported JSON, because Auto grid belongs to the newer dashboard
  resource schema and the classic `schemaVersion: 42` model this lab
  provisions has no field that can express it. The browser can do
  things the file format cannot record.
- A defended choice for the wall display, with the reason naming
  *comparison* rather than taste: a row whose meaning depends on two
  panels being adjacent must not be allowed to reflow.

The common wrong turn is concluding that the export is broken. It is
not; the layout was never in the file to begin with.

## Chapter 14 — Dashboards That Tell the Truth

**1.** The five lies are answered in Appendix B, "The debugging ladder",
under *Answer key: chapter 14's five planted lies*. Time yourself, fill
in `lab/exercises/ch14-audit.md`, then read it there rather than here.

`make verify-ch14` grades this one. Passing output is six `PASS` lines
— the file exists, plus one per lie — then `ch14: 6 passed, 0 failed`
and `ch14 OK`, under a line reporting how many panels it examined. If
a check fails, the `FAIL` line names the panel rather than the defect,
on purpose: finding the defect is the exercise.

**2.** Open-ended by construction — the exercise measures *you*, twice,
a week apart. A good sixth lie has one property: it renders without an
error and survives a reading of the panel title. A stacked latency
panel qualifies, because p50, p95 and p99 are not parts of a whole and
stacking draws the p99 line at the sum of all three. So does a `ms`
unit on a seconds-valued metric, which reports a service a thousand
times faster than it is.

The common wrong turn is planting something that *breaks*. A defect
that shows "No data" gets fixed the day it lands; the whole subject of
this chapter is the one that gets trusted for a year.

**3.** What a good answer contains:

- Where the difference lives. Everything between the two timers: the
  `edge` proxy hop that chapter 12 put in front of Snip, connection
  setup, kernel and Go server queueing before the handler's timer
  starts, and the load generator's own client-side queueing once
  requests pile up at 60 requests per second. Snip's histogram starts
  counting when the handler runs; loadgen's starts when it sends.
- Two audiences, two answers, with a reason. The client line is what a
  visitor experiences, so it is the number to show a product manager
  and the number an objective should be written against. The server
  line is the part the engineer can change, so it is the one to debug
  with. The honest finding is neither line — it is the *gap*, which
  says how much of the delay is not in the code at all.

The common wrong turn is calling one of the two lines wrong. Both are
correct measurements of different things.

**4.** Twelve redraws in two minutes at the `10s` option; about eight of
them paint a new scrape, because a 15-second scrape produces eight new
samples in two minutes, and the other four repaint a value that has not
changed.

Appending `?refresh=1s` does not get you one second. Grafana's
`min_refresh_interval` defaults to five seconds and silently clamps
anything below it, so once the page has loaded the picker reads the
clamped value rather than `1s`, with no warning anywhere. What you are
watching when a dashboard redraws more often than data arrives is the
browser re-running the same query against the same stored samples:
network and render work, and no new information.

**5.** Open-ended. Each of the three descriptions must contain:

- The unit, spelled out — `reqps`, `percentunit`, seconds — because a
  ratio and a percentage differ by a factor of a hundred and look
  identical on screen.
- What the selector excludes, named by the selector. "Scoped with
  `job=~"$job"`" is the shipped file's own idiom, and the reason it
  exists is that `process_cpu_seconds_total` is on every service in
  the stack.
- One thing the panel is *not*, naming the similar number that lives
  elsewhere. The shipped "Faster than 300 ms (selected routes)"
  description is the model: it says the panel follows `$route`,
  therefore includes `/healthz`, and is therefore not the objective
  on `/d/snip-slo`.

The common wrong turn is describing what the query does. The reader at
3 a.m. can see the query; what they cannot see is what it leaves out.

**6.** Open-ended, and the second half is the part that counts. Run the
five checks — averaged ratio, wrong rate window, unit against value
range, missing `job` matcher, stale Stat — and record the count.

Then answer the question no checker can: name the question the panel
answers, in one sentence, in a user's words. A panel you cannot write
that sentence for is competing for attention with the panels that pass,
which makes it worse than absent.

## Chapter 15 — Recording Rules

**1.** Both attempts fail, for two different reasons, and both are the
chapter's central claim.

You cannot build a service-wide p95 from two per-replica p95 values. A
quantile is a property of a population, and the average — or the max,
or any other arithmetic — of two populations' 95th percentiles is not
the 95th percentile of the union. Compare whatever you produce against
`histogram_quantile(0.95, sum by (job, le) (rate(...[5m])))` and the
two disagree except when both replicas happen to carry identical
traffic.

You cannot produce a p99 for the last hour either. The recorded series
holds one float per evaluation — the 95th percentile — and the
distribution that would answer any other quantile was deleted at record
time. A new p99 rule records p99 from the moment you load it and never
earlier.

`make verify-ch15` catches both rules if you forget to delete them:

```text
FAIL no recorded quantile masquerading as a series — got 1 series,
     want no series at all
     → expression: {__name__=~".*:.*quantile.*"}
```

**2.** Inside the `snip-red` group, after the rule it reads, the values
are correct: rules in a group run in order, one at a time, so the
`max_over_time` rule sees this evaluation's `job:snip_http_requests:
rate5m`. Moved to a second group, it reads whatever was last written —
up to one full interval old, and nothing at all for the first minute
after a restart. Nothing errors and the numbers stay plausible.

The expression that shows it rather than assuming it compares the two
series' sample timestamps:

```promql
timestamp(job:snip_http_requests:max1h_rate5m)
  - on (job)
    timestamp(job:snip_http_requests:rate5m)
```

In one group this sits at 0. Split across two groups it wanders by up
to the group interval, because the two groups start independently and
nobody waits.

**3.** You expect 2 and you get 12. `count_over_time(x[1m])` counts
samples in a one-minute window, and at `interval: 5s` the group writes
twelve of them instead of the two a 30-second interval writes.

What you bought is nothing. The underlying samples still arrive every
fifteen seconds, so a five-minute rate recomputed every five seconds
writes three near-identical values for every one thing that actually
changed. What you paid is six times the stored samples and six times
the evaluation time, inside a budget the group has to finish within.
Set it back to `30s`.

**4.** At risk of skipping:

```promql
prometheus_rule_group_last_duration_seconds > 15
```

Already skipped:

```promql
sum by (rule_group) (
  rate(prometheus_rule_group_iterations_missed_total[5m])
) > 0
```

Fifteen is half the 30-second budget every group in this lab declares,
chosen so the alarm arrives before the damage. If your groups run at
different intervals, compare each against its own interval — which the
rules page prints next to the group name — rather than against a
constant. A subquery over a long range inside the group is the cheapest
way to watch the first expression start returning a row.

**5.** Two messages that read nothing alike, and `make check` stops on
either before `make reload` can run.

`recrod:` is caught by the YAML schema: promtool names the file, the
line, and the field it does not recognize. The unparseable `expr:` is
caught by PromQL: promtool names the position inside the expression and
the token it expected. One is about the shape of the document, the
other about the shape of a query, and knowing which you are reading
tells you which half of the file to look at.

Reload with the file still broken and `http://localhost:9090/rules`
shows the old rules, still loaded and still evaluating. That is right,
because a rejected reload is a no-op and a typo at 03:14 must not take
your recording rules down with it. It is also how you lose twenty
minutes: nothing on that page says the file on disk differs from what
is loaded, so the edit you are staring at is not the one running.

## Chapter 16 — Alerting Rules, and What "Firing" Actually Means

**1.** Predict five minutes plus up to one evaluation interval, so five
to five and a half minutes after the recorded ratio first crosses
`0.20`.

Measured from the `ALERTS` graph, the gap between the first `pending`
sample and the first `firing` sample is exactly `5m`: the alert becomes
active at some evaluation and fires at the first evaluation at least
`for` later, and the evaluations are on a regular 30-second grid.

The residue is quantization, at two stages rather than one. The
alerting group only looks every 30 seconds, and the recorded ratio it
reads was itself computed by the `snip-red` group up to 30 seconds
before that. Measuring pending-to-firing removes both, which is why
that measurement is clean and the crossing-to-firing one is not.

**2.** Two failures, and the second is the interesting one.

Before the restart: `snip_http_requests_total` only goes up, so once a
replica has served its hundredth 5xx the comparison is true forever.
With no `for` it fires on the next evaluation and never resolves, no
matter how healthy the service becomes. The expression also carries
every label the counter has, so with four replicas you get one alert
instance per `(instance, route, method, code)` series that crosses.

The restart: `docker compose restart snip-api` sets the counter back to
zero, the comparison becomes false, and the alert *silently resolves* —
Alertmanager sends a recovered notification generated by a crash. An
odometer reading is not a statement about now.

**3.** A bare `sum()` keeps nothing, so the result element has no labels
at all and the `ALERTS` series carries only `alertname`, `alertstate`
and whatever the rule's own `labels:` block supplies.

The three the chapter names are `job`, `instance` and `service`. `job`
is what Alertmanager's route tree and this lab's inhibit rule
(`equal: [job]`) use to decide who owns the problem; `instance` is what
says which replica; `service` is the second axis of `group_by` and the
matcher the ticket route reads. Working from `SnipHighErrorRatio` you
keep that rule's `labels:` block, so `severity` and `service` survive
your edit and what actually vanishes from the `ALERTS` row is `job` and
`route` — and `route` is the one the annotation templates, so
`{{ $labels.route }}` now renders `<no value>`. Revert.

**4.** Open-ended. What a good rewrite contains, in under four lines:

- `$labels` used at least once, and only for a label the alert
  actually carries. `SnipLatencyObjectiveAtRisk` aggregates `sum by
  (job)` and puts `route` back through its own `labels:` block, so
  `{{ $labels.route }}` and `{{ $labels.job }}` both resolve.
- `$value` through a `humanize` function. The value here is a 0-to-1
  fraction, so `{{ $value | humanizePercentage }}` is the right one and
  yields `10%` rather than fifteen digits.
- Who is hurt and what to look at first, in user words — visitors
  waiting on a redirect that should be instant — not a metric name.

The common wrong turn is templating a label the alert does not carry.
Go renders a missing map key as the literal string `<no value>`, with
no error and nothing in any log, and chapter 19's verify script is the
only thing that ever finds it.

**5.** About fifteen to sixteen minutes, and four clocks add up to it.

First, `docker compose stop` removes the containers from Docker's
running list, so `docker_sd_configs` withdraws the targets within one
`refresh_interval` — fifteen seconds. (Note that `SnipTargetDown` does
*not* fire here: there is no `up == 0`, because there is no `up`.)
Second, and this is the large term, `job:snip_sli_valid:rate5m` does
not vanish with the target. Its five-minute rate window still holds
samples that were stored before the stop, so the recording rule keeps
writing a number for most of the following five minutes. Third, the
evaluation grid adds up to 30 seconds. Fourth, `for: 10m` on
`absent()` requires the element at every evaluation across ten minutes.

**6.** At `{"rps":20,"error_ratio":0.3}` both fire. The injector stamps
its failure header only on `/l/{code}` and `POST /links`, which are
85 % of the mix, so the service-wide 5xx rate settles near
20 × 0.85 × 0.30 ≈ 5 per second, comfortably past `> 2`. The ratio on
`/l/{code}` is 0.30, past `> 0.20`.

Raise the load tenfold and the ratio rule reads 0.30 again — the same
sentence about the service, because nothing about a visitor's chance of
a working redirect changed. The rate rule reads about 50 per second
instead of 5: a tenfold change in the alert's own number for an
identical user experience. The corollary is the one that costs teams
real money: a `> 2` threshold that is a catastrophe at 20 requests per
second is a rounding error at 2,000, so every rate threshold has to be
retuned for each environment it is copied into. A ratio is
dimensionless and moves unchanged.

## Chapter 17 — Alertmanager: Routing, Grouping and Silence

**1.** Open-ended, and the predictions are the exercise. Test each label
set without sending anything:

```bash
docker compose exec alertmanager amtool config routes test \
  --config.file=/etc/alertmanager/alertmanager.yml \
  severity=page service=snip alertname=Demo
```

What a good answer contains:

- Predictions written down *before* running, one per label set, naming
  the receivers and why.
- The two rules that decide it. The walk is depth-first and
  first-match-wins, so exactly one sibling wins unless it says
  `continue: true`. And a child that does not match means the *parent*
  handles it — the alert goes to the root receiver, not nowhere.
- Agreement between `amtool` and the pager on all three.

The common wrong turn is a disagreement caused by reloading one program
and not the other. Alertmanager re-reads on `curl -XPOST
http://localhost:9093/-/reload`; `amtool` reads the file straight off
disk. If they differ, that is what happened.

**2.** Any anchored substring works. This one looks like it catches
warnings and does not:

```yaml
    - matchers:
        - 'severity =~ "warn"'
      receiver: pager-ticket
```

`amtool config routes test severity=warning alertname=Demo` prints
`pager-default`, the root receiver, with no error and no hint. Matcher
regexes are anchored at both ends exactly as in a series selector, so
`warn` matches the string `warn` and nothing else. Fix it with
`'severity =~ "warn.*"'`, or better by spelling out the values you mean:
`'severity =~ "warning|critical"'`.

**3.** The rule:

```yaml
inhibit_rules:
  - source_matchers:
      - 'alertname = "AlphaDown"'
    target_matchers:
      - 'alertname = "BetaSlow"'
    equal: [team]
```

Hand-POST both and `BetaSlow` comes back `suppressed` although the two
alerts have nothing to do with each other. The upstream CAUTION in one
sentence, for the comment above the rule: *if every label named in
`equal` is missing from both the source and the target, the values
count as equal and the rule inhibits unconditionally.*

This lab is a good place to be fooled by it, because Prometheus stamps
`external_labels` on every alert it sends, so real alerts here do carry
`cluster="obslab"` and `equal: [cluster]` would look safe. Hand-posted
alerts carry no such label. Delete the rule afterward.

**4.** It cannot be one range because a time range cannot wrap past
midnight: `start_time: "18:00"` with `end_time: "09:00"` is not a
night, it is nothing. Split it, and add the weekend as its own spec:

```yaml
  - name: out-of-hours-18
    time_intervals:
      - weekdays: [saturday, sunday]
        location: Europe/Berlin
      - weekdays: ["monday:friday"]
        times:
          - start_time: "00:00"
            end_time: "09:00"
          - start_time: "18:00"
            end_time: "24:00"
        location: Europe/Berlin
```

Within one spec every field you give must match; across the specs in
the list, any one matching is enough — which is what makes Friday
18:00 through Monday 09:00 continuous. Wire it with
`mute_time_intervals: [out-of-hours-18]` on the ticket route.
`amtool check-config` still prints `SUCCESS`, and the receiver count is
unchanged, because a time interval is not a receiver. Revert the route:
a muted ticket route makes `make verify-ch17` depend on what time you
are reading.

**5.** Before the second alert, the pager's "Common to every alert here"
line includes `instance="snip-api-1"`. After it, `instance` is gone
from that line — and so is the summary, if the two summaries differ,
which they will when the summary names the instance.

`.CommonLabels` holds only the labels whose values are identical across
every alert in the group, and a label that differs is dropped silently.
So `obslab.oneline` rendered `SnipTargetDown on snip-api-1 — …` with
one alert in the group, and renders `SnipTargetDown on  —` with two:
two spaces and a dash, no error, no warning. Use `.GroupLabels` for
what you are certain of and `range .Alerts` for anything per-alert.

**6.** `notification_reason`. Every other field in the version-4 payload
is camelCase — `groupKey`, `truncatedAlerts`, `groupLabels`,
`commonLabels`, `commonAnnotations`, `externalURL`, `startsAt`,
`endsAt`, `generatorURL` — and this one is snake_case. It names *why*
this particular notification was generated rather than what it
contains, and it is the field that costs twenty minutes the first time
you write a receiver of your own.

## Chapter 18 — Testing Alerts Before They Page You

**1.** `1x6` is seven samples, because `n` counts the samples *after*
the first. The other notation is the literal list, `1 1 1 1 1 1 1`.

```yaml
  - name: seven samples
    interval: 30s
    input_series:
      - series: 'up{job="snip-api", instance="snip-api-1"}'
        values: "1x6"

    promql_expr_test:
      - expr: count_over_time(up[1h])
        eval_time: 3m
        exp_samples:
          - labels: '{job="snip-api", instance="snip-api-1"}'
            value: 7
```

Seven samples at a 30-second interval reach exactly `t=3m`, and the
expected label set omits the metric name because `count_over_time`
drops it. `make test-rules` prints `SUCCESS`.

**2.** Expect nothing to fire, and assert `exp_alerts: []` at `t=8m`.

```yaml
        values: "1x9 stale _x10 1x9"
```

A staleness marker means the series has no value from that point on, so
`up{job=~"snip-api|snip-worker"} == 0` returns no element, there is
nothing to hold in `pending`, and `SnipTargetDown` cannot fire however
long you wait. That is the whole reason chapter 16 told you to `docker
compose pause` a container rather than `stop` it: a paused container
stays in Docker's running list and `up` goes to 0, while a stopped one
is withdrawn by service discovery and `up` stops existing.

Note the contrast with `_`, which is a missed scrape: the previous
value stands for the lookback delta and the alert behaves as though
nothing happened.

**3.** The blip starts paging only when `for` is deleted outright —
equivalently `for: 0s`.

The blip is exactly one sample wide at a 30-second interval, so the
expression returns the element at exactly one evaluation, `t=5m`. Any
non-zero `for`, including `30s`, requires the element to still be
present at a *later* evaluation, and the next evaluation at `t=5m30s`
already reads `1`. `for: 30s` and `for: 1m` therefore behave
identically to `for: 2m` on this input. Only `for: 0` fires on a single
evaluation. Put `for: 2m` back.

**4.** Make the output directory writable first — the image runs as
`nobody` and a bind mount keeps your host's ownership:

```bash
mkdir -p ci-out && chmod 0777 ci-out
docker compose run --rm --no-deps -T --entrypoint /bin/sh \
  -v "$PWD/ci-out:/out" prometheus \
  -c 'promtool test rules --junit /out/rule-tests.xml \
        /etc/prometheus/rules/tests/*.yml'
```

The rename is open-ended, and a good one has one property: the test
case name alone tells a colleague what broke, because the report is all
they will see. `a thirty-second blip must never page` becomes something
like `SnipTargetDown: a 30 s blip must not page` — the rule under test,
then the behavior asserted. Say which of the two halves you added and
why.

**5.** The four edits, and what each failure looks like:

- Swap `> 0.01` to `< 0.01` on `SnipLatencyObjectiveAtRisk`: two
  failures in opposite directions, printed side by side. The clearest
  of the four.
- Delete `for: 2m` from `SnipTargetDown`: the blip test's
  `exp_alerts: []` at `t=5m` now finds an alert.
- Wrap `SnipTargetDown`'s expression in `sum by (job) (…)`: `instance`
  disappears, so the `exp_labels` assertion fails *and* the rendered
  annotation loses the instance name.
- Misspell a matcher, `route="/l/{codes}"`: the expression returns
  nothing and the failure reads `got:[]`.

The answer to "least readable" must name *why*, not only which. The two
candidates are the aggregation, whose real damage is buried in a long
rendered-annotation diff rather than in the label line, and the
misspelled matcher, whose `got:[]` is indistinguishable from a rule
that correctly did not fire.

**6.** Open-ended infrastructure work, and the one exercise in the book
that needs the internet. A good answer contains: the workflow running
at least once so GitHub offers `rules` by name, the check marked
*required* in branch protection on the default branch, and the pull
request blocked with the chapter's two-failure output visible in the
check. Confirm the block rather than assuming it — a required check
that was never marked required looks exactly like a passing one.

## Chapter 19 — What a Page Should Say, and Who Watches the Watcher

**1.** Open-ended, and the scoring rubric is the five keys in order:
`summary`, `description`, `first_step`, `dashboard_url`, `runbook_url`.
Score one point each for: a summary in user words with no metric name
in it; a description carrying the number, humanized; a `first_step`
that is singular and splits the possibilities; a dashboard link with
`from` and `to` already set; and a runbook link derived mechanically
from the alert name. For this rule that is:

```text
http://localhost:3000/d/snip-red?from=now-6h&to=now
https://runbooks.example.com/obslab/sniplatencyobjectiveatrisk
```

`make verify-ch19` grades the mechanical half. Passing output is 19
`PASS` lines ending in `ch19: 19 passed, 0 failed` and `ch19 OK`, and
the ones that matter here are *every alerting rule has five annotations
(Watchdog aside)*, *no annotation is an empty string*, *every rule links
a runbook*, *every rule links somewhere you can look*, and *no firing
alert renders an annotation to `<no value>`*. If a field is missing the
script names the rule and the count it found.

**2.** `PrometheusNotificationsFailed` catches it. The Watchdog fires
continuously, so Prometheus is always trying to deliver something, and
every attempt to a dead Alertmanager increments
`prometheus_notifications_errors_total`. Five minutes later the rule is
firing.

Two of the other three cannot. `AlertmanagerNotificationFailures` reads
`alertmanager_notifications_failed_total` — a metric that comes from the
process that is down, so there is no scrape, no series, and no alert.
`PrometheusTargetScrapesFailing` reads `count by (job) (up == 0)`, and
`docker compose stop` takes the container out of Docker's running list,
so `docker_sd_configs` withdraws the target and there is no `up` series
to read 0. `PrometheusRuleEvaluationFailures` is unaffected; rule
evaluation is fine.

Now follow the notification. The one alert that did fire is
`severity: page`, and the page about it has to travel through the dead
Alertmanager. Nobody is told. What actually reaches a human is the
pager's banner going red when the heartbeat stops — which is the
argument for the Watchdog in one observation.

**3.** The three commands, in order:

```promql
sum by (integration) (increase(alertmanager_notifications_total[6h]))
```

```promql
sum by (receiver) (increase(pager_notifications_received_total[6h]))
```

```bash
curl -s http://localhost:5001/api/notifications \
  | jq -r '.notifications[].payload.groupLabels.alertname' \
  | sort | uniq -c | sort -rn
```

The winner is whichever alert the script skewed toward — in the
chapter's own run, `SnipTargetDown`. Two points must appear in the
defense or the deletion. The Watchdog dominates the raw
Alertmanager counter and is excluded by construction, because it goes
to the `deadman` receiver and no human reads it. And `pager-ticket`
exceeds `pager-page` even though fewer alerts are tickets, because
`continue: true` mirrors every page into the ticket queue.

The verdict must be exactly one of keep, downgrade, retune or delete,
with a reason, in `lab/docs/ALERT-REVIEW.md`. The common wrong turn is
"leave it, we will look next month", which is not a verdict.

**4.** Open-ended. The six headings, in order, on one screen: what it
means (and what it does *not* mean — `SnipTargetDown` firing does not
mean Snip is down for users); who is affected, with a query you can
paste; the first step, identical to the annotation; the four causes you
have really seen, most frequent first, as an ordered list; mitigation
in order of speed; and escalate-when as a condition rather than a mood.

The diff against the shipped page is the exercise. The interesting
difference is what you *included* that will rot — anything naming a
container, a port or a topology is a branch that a deploy invalidates.
That is why the causes are a list and not a tree.

**5.** The taxonomy the lab uses, and the only three values `LAB-SPEC`
permits: `page` routes to `pager-page` and, through `continue: true`,
to `pager-ticket`, and promises a human in minutes; `ticket` routes to
`pager-ticket` and promises the next working day; `none` routes to
`deadman` or the `null` receiver and promises nothing, because it is
machinery.

A good answer names a response time per level and a *different human
behavior* per level — if you cannot write that sentence, you do not
need the severity. Then change one rule's severity, run `make check`
and `make reload`, reload Alertmanager with
`curl -s -XPOST http://localhost:9093/-/reload`, hand-POST an alert
with the new label set, and read the receiver name the pager prints.

The common wrong turn is inventing a fourth value. `severity: warning`
matches no route, so it lands on `pager-default` — a page that goes to
the drawer rather than a quieter one.

**6.** The first number:

```promql
sum(increase(pager_notifications_received_total{
  receiver="pager-page"}[6h])) * 2
```

That is pages per simulated 12-hour shift, against Google's ceiling of
two per shift. It will be far above it, because you spent four minutes
manufacturing noise on purpose.

The second number needs the mirror removed. Every page is delivered
twice — once to `pager-page` and once to `pager-ticket` — so summing
both receivers double-counts every page. Subtracting the mirror leaves
`pager-ticket` alone, which already contains every page plus the
genuine tickets, and is therefore the count of *distinct* human-facing
notifications.

Both are defensible. What makes the metric honest is saying which one
you mean: "pages that woke someone" and "notifications a human
received" are different questions, and a number quoted without naming
its receiver answers neither.

## Chapter 20 — SLIs, SLOs and Error Budgets

**1.** Open-ended, and `make verify-ch20` only greps the file for an
exclusion list — the reasoning is the exercise. Each of the three
defenses has to be a statement about *whose experience you are
measuring*, not about convenience. The lab's own list is the model:
`/healthz` because nobody is having a bad day when a liveness probe
fails; `other` because a scanner's 404 is correct behavior; the
remaining routes because they are real traffic on a different journey
and deserve their own SLO.

The strongest answer to the second half is the one the chapter makes:
requests carrying `X-Snip-Fail-Ratio` or `X-Snip-Delay-Ms` were
tempting and are *not* excluded, because an SLO that quietly ignores
your own fault injection reads healthy through every exercise in this
chapter and teaches you to trust a rigged number.

The common wrong turn is an exclusion that is really a client you find
inconvenient. Every exclusion has to be written before you need it.

**2.** Thirty days is 43,200 minutes, so the budget is the allowed
failure fraction times that:

- 99.5 % → 0.005 × 43,200 = **216 minutes**, 3 h 36 m. This matches
  the chapter.
- 99.9 % → 0.001 × 43,200 = **43.2 minutes**.
- 99.99 % → 0.0001 × 43,200 = **4.32 minutes**.

The honest half is the second question. A good answer reads the bottom
row as an operator: 4 minutes 19 seconds a month is less than one
careless deploy and less than one container that takes its time
draining connections, so sustaining it means redundancy, automated
rollback and staged deploys — an engineering program, not a number in
a document.

**3.** Twenty-eight days is 40,320 minutes: **201.6**, **40.32** and
**4.032** minutes for the same three targets. The factor is 28/30,
which is 14/15, or about 0.9333.

What chapter 21 needs to know is that every threshold derived from the
period moves by that same factor, so its four burn rates become 13.44,
5.6, 2.8 and 0.933 rather than 14.4, 6, 3 and 1. Copy the famous four
numbers into a 28-day configuration and every threshold you own is
about 7 % too permissive.

**4.** The two expressions:

```promql
sum(rate(snip_http_request_duration_seconds_bucket{
      job="snip-api", route="/l/{code}", le="0.3"}[5m]))
/
sum(rate(snip_http_request_duration_seconds_count{
      job="snip-api", route="/l/{code}"}[5m]))
```

```promql
histogram_fraction(0, 0.3,
  sum by (le) (rate(snip_http_request_duration_seconds_bucket{
    job="snip-api", route="/l/{code}"}[5m])))
```

They agree because `0.3` is a real boundary of this histogram — chapter
10 put it there on purpose. Change `le="0.3"` to `le="0.30"` and you
get:

```text
Empty query result
```

Prometheus 3 normalizes `le` values to a canonical float form on
ingestion, so the bucket is stored as `le="0.3"` and `le="0.30"`,
`le=".3"` and `le="0.300"` all match nothing. The numerator is empty,
the whole division is empty, and a panel built on it reads *No data*
while the query itself is perfectly valid. That output is the thing to
recognize on sight.

**5.** Open-ended. A policy that works contains four things and one of
them is usually missing:

- Gates with numbers, not adjectives: what changes at 50 %, at 90 % and
  at 100 % spent.
- A named decider, so the decision is not made by whoever is most tired.
- A *scoped* freeze. The lab freezes the redirect path, not the
  repository, because a freeze that stops all work is ignored the
  second time it happens.
- An exit condition. "The rolling window recovers, or a review is
  written and its first action item has shipped, whichever is later."

The place yours will be vaguest is the exit condition. A freeze with no
stated end is a hostage situation, and it is the clause everybody
leaves out.

**6.** A rule-file-shaped expression, with the polarity that fires when
the objective is violated rather than vanishing:

```promql
histogram_quantile(0.99, sum by (job, le) (
  rate(snip_http_request_duration_seconds_bucket{
    job="snip-api", route="/l/{code}"}[30m])
)) > 0.3
```

Hold `{"rps":20,"extra_latency_ms":400}` for five minutes and it
returns a duration above 0.3. Two things you cannot compute from it:

- **A count of good events, and therefore a budget.** The result is a
  millisecond figure with no numerator and no denominator in it, so
  there is no way to ask how many requests were too slow this month.
  Without that, neither **Error budget remaining (30 days)** nor
  **Budget spent, in minutes** can be drawn — both are arithmetic on a
  ratio of event counts.
- **An aggregatable, re-windowable value.** You cannot average two
  replicas' p99s into one, and you cannot combine windows, so the
  30-day rung does not exist. Without it, **Latency SLI (30 days)**
  has nothing to read, and the burn-down time series of
  `slo:error_budget_remaining:ratio30d` — the slope chapter 21 turns
  into an alert — cannot be plotted at all.

## Chapter 21 — Burn Rates: Alerts That Don't Cry Wolf

**1.** With a 7-day period the hours term becomes `7 × 24 = 168`, so the four
multiplications are:

```text
    spend  2 % over  1 hour   ->  0.02 x 168 /  1  = 3.36
    spend  5 % over  6 hours  ->  0.05 x 168 /  6  = 1.4
    spend 10 % over  1 day    ->  0.10 x 168 / 24  = 0.7
    spend 10 % over  3 days   ->  0.10 x 168 / 72  = 0.2333
```

All four are under 3.4 and the last is under 0.25. The factor is the ratio of
the periods, `720 / 168 = 4.2857`, so a hard-coded 14.4 makes the fast tier
about 4.29 times less sensitive than the derivation intended. The uncomfortable
part is tier 4: a burn rate of 0.2333 trips at an error ratio of
`0.2333 × 0.005 = 0.00117`, which is *below* the 0.5 % budget itself, so that
tier opens a ticket on a service that is meeting its objective. Its
minimum-events guard would also have to grow to `1 / 0.00117 ≈ 857` valid
events in the long window before one failure stops being able to trip it.

**2.** The burn rate is `0.03 / 0.005 = 6`. Tier 1's threshold is 14.4, and 6
is below it, so the detection time is infinite — the one-hour window
asymptotes at 3 %, never reaches 7.2 %, and `SnipAvailabilityBurnFast` never
becomes active. The measurement agrees: `ALERTS_FOR_STATE{alertname=
"SnipAvailabilityBurnFast"}` stays an empty result for as long as you leave the
injector at `0.03`, and that empty result is the correct answer rather than a
broken rule. Tier 2 is the boundary case — its threshold is exactly 6, the
comparison is strict `>`, and the six-hour window approaches 0.030 from below,
so it can only fire if sampling noise carries it over for two consecutive
minutes. To get a finite number you can time, raise the injector to
`"error_ratio":0.09`: the burn rate is 18, and the predictions are
`1 h × 14.4 / 18 = 48 min` for tier 1 and `6 h × 6 / 18 = 2 h` for tier 2, plus
`for: 2m` on each. Reset with `curl -s -XPOST
http://localhost:8089/chaos/reset` afterward.

**3.** Wrap tier 2's short-window clause and leave the rest of the rule,
including its guard, alone:

```promql
(1 - job:snip_sli_availability:ratio_rate6h{job="snip-api"})
  > (6 * 0.005)
and
(1 - label_replace(
      job:snip_sli_availability:ratio_rate30m{job="snip-api"},
      "window", "30m", "", ""))
  > (6 * 0.005)
```

Reload, run `DURATION=1800 ./scripts/scenario-outage.sh --no-wait`, and
`ALERTS{alertname="SnipAvailabilityBurnMedium"}` returns nothing for the whole
outage while `/rules` shows the rule `inactive` with health `ok`. `make
test-rules` fails in about a second, on the first case in
`snip-burnrate_test.yml` — "a sustained ten percent error ratio fires all four
tiers" — at the `SnipAvailabilityBurnMedium` assertion. The test told you in a
second; the running system predicted roughly 38 minutes to tier 2 at burn rate
60 and then never told you at all. `make verify-ch21` grades this indirectly:
it asserts `make test-rules exits 0`, so the stray label also takes the verify
target down, and a clean run ends `ch21: 21 passed, 0 failed, 1 skipped`
followed by `ch21 OK`.

**4.** `long_window × threshold / period` returns the fraction you chose, and
216 minutes is the budget:

```text
    tier 1   1 h x 14.4 / 720 = 0.02  ->  4.3 min
    tier 2   6 h x  6   / 720 = 0.05  -> 10.8 min
    tier 3  24 h x  3   / 720 = 0.10  -> 21.6 min
    tier 4  72 h x  1   / 720 = 0.10  -> 21.6 min
```

Tiers 3 and 4 tie as the expensive ones at 21.6 minutes each, five times what
tier 1 spends. A good answer to the second half makes two points. First, that
cost at fire time is not severity — the formula contains no term for how bad
the incident is — so what you are buying with a `ticket` severity is time to
act, not a smaller bill. Second, that promoting tier 3 to `page` is defensible
if a tenth of the month in a single day is intolerable for your service, and
that its price is being woken for a 1.5 % error ratio, which on many services
is inside the day-to-day noise. The common wrong turn is "tier 4 costs the most,
so tier 4 should page": its long window is three days, so the condition has
been true since the day before yesterday and will still be true after
breakfast.

**5.** The three forms, each replacing the `>= 60` clause in tier 1:

```promql
sum by (job) (
  increase(snip_http_requests_total{job="snip-api",
                                    route="/l/{code}"}[1h])
) >= 60
```

```promql
sum by (job) (
  increase(snip_http_requests_total{job="snip-api",
                                    route="/l/{code}",
                                    code=~"5.."}[1h])
) >= 5
```

```promql
job:snip_sli_valid:rate5m{job="snip-api"} >= 60 / 3600
```

All three pass all four cases in `snip-burnrate_test.yml` — "a sustained ten
percent error ratio fires all four tiers", "a one percent drip opens a ticket
and never pages", "the minimum-events guard stops a near-idle service from
paging" and "one failure in sixty redirects opens no ticket" — provided the
failed-events floor is set above 3, because the near-idle case supplies exactly
three failures an hour. Ranked by what each costs you: the valid-events floor
costs coverage below one redirect a minute, explicitly and measurably; the
recorded-rate floor costs almost nothing to evaluate but judges a one-hour
window by a five-minute rate, so it mutes an alert whose long window is still
full and un-mutes one whose window is still empty; the failed-events floor
costs you the incident you built the alert for, because a total outage on a
quiet service produces few failures and the guard suppresses exactly then.

**6.** Copy the `sloth-slo-sli-recordings-snip-availability` group across as
well as the alert — `fixtures/` is never loaded, so without the recording rules
the alert reads series that do not exist and is empty for the wrong reason.
Then delete the wrapper from one clause of each `or` branch, or the second
branch will still fire during a long outage and spoil the demonstration. The
one-line explanation: Sloth labels every recorded rung with `sloth_window`, so
`slo:sli_error:ratio_rate5m` carries `sloth_window="5m"` and
`slo:sli_error:ratio_rate1h` carries `sloth_window="1h"`; `and` matches on
every label except `__name__`, the unwrapped side keeps that label and the
wrapped side does not, no pair of elements has identical label sets, and the
result is empty forever with a rule whose health reads `ok`.

## Chapter 22 — Metrics From Things You Didn't Write

**1.** The two rules differ by one word:

```yaml
      - alert: DiskFreeLow
        expr: |
          node_filesystem_free_bytes{job="node-exporter",
            fstype!~"tmpfs|overlay|squashfs|ramfs"} < 5e9
        for: 15m

      - alert: DiskAvailLow
        expr: |
          node_filesystem_avail_bytes{job="node-exporter",
            fstype!~"tmpfs|overlay|squashfs|ramfs"} < 5e9
        for: 15m
```

`node_filesystem_free_bytes - node_filesystem_avail_bytes` is the root-reserved
block count, so the gap is zero on `tmpfs` and `overlay` and roughly 5 % of
`node_filesystem_size_bytes` on ext4. Divide by `node_filesystem_size_bytes` to
read that percentage off directly. `DiskFreeLow` is the rule that lets a
non-root process hit "no space left on device" in silence: Snip does not run as
root, so its ceiling is `avail`, and `free` still shows the reserved blocks as
headroom nobody outside root can spend.

**2.** The unguarded panel puts `obslab-pager-1` at `+Inf`, because `pager` is
the one service in `compose.yaml` with no `mem_limit` and cAdvisor reports an
unset limit as `0`. On a 0-to-1 `percentunit` axis that row draws as nothing at
all while poisoning every legend calculation on the panel. Adding `> 0` to the
denominator removes `obslab-pager-1` from the result entirely — the honest
answer, since a container with no limit has no percentage of a limit. The
other series do not change value; what changes is that their legend
calculations become readable again, which is the whole point of the guard.
`make verify-ch22` asserts `pager really does report a memory limit of 0`, so
you can confirm the cause rather than assume it.

**3.** Open-ended. A good answer works all five checklist questions in order —
maintained, conventional, bounded, readable, multi-target — and names the
evidence for each, not the impression: a release date and whether it was a real
release, fifty actual lines of `/metrics` rather than the README's examples,
the specific labels whose values come from data, and whether a `/scrape?target=`
style endpoint exists. It should end with a decision and the one answer that
drove it. The common wrong turn is scoring on popularity: stars and download
counts say nothing about whether a label is bounded, and cardinality is the
answer that will cost you an incident.

**4.** The rule is the chapter's with the range you chose:

```yaml
      - alert: MyDiskWillFillIn4Hours
        expr: |
          predict_linear(
            node_filesystem_avail_bytes{job="node-exporter",
              fstype!~"tmpfs|overlay|squashfs|ramfs"}[6h],
            4 * 3600
          ) < 0
        for: 30m
```

Ship `[6h]`, which is what the lab's `NodeDiskWillFillIn4Hours` uses. `[1h]` is
too jumpy: one compaction or one `make backfill` writing a gigabyte dominates
the fit, the slope swings, and the rule fires on an event that finished before
you read the ticket. `[24h]` is too slow: a leak that started this morning is
one part in twenty-four of the fit, so the line stays nearly flat and the
prediction does not cross zero until the disk is close to full. Six hours is
long enough to absorb a single write burst and short enough to see this
morning's leak before lunch.

**5.** Keep the previous success timestamp when the run fails, or a failed run
erases the very thing the alert reads:

```bash
M=obslab_backup_last_success_timestamp_seconds
E=obslab_backup_last_exit_code

if [ "$RC" -eq 0 ]; then
  LAST=$END
else
  LAST=$(awk -v m="$M" '$1==m {print $2}' "$OUT" 2>/dev/null)
  LAST=${LAST:-0}
fi

{
  echo "# HELP $M Unix time of the last successful run."
  echo "# TYPE $M gauge"
  echo "$M $LAST"
  echo "# HELP $E Exit code of the most recent run."
  echo "# TYPE $E gauge"
  echo "$E $RC"
} > "$TMP"

mv "$TMP" "$OUT"
```

Both names are yours to choose, because neither is part of any service's
catalog; both are gauges, and the exit code carries no unit suffix because it
has no unit. The alert:

```yaml
      - alert: BackupStale
        expr: |
          time() - obslab_backup_last_success_timestamp_seconds
            > 26 * 3600
        for: 10m
```

Edit the timestamp in `textfile/backup-example.prom` to a value two days old,
wait one scrape interval, and the rule goes `pending` and then `firing` after
ten minutes while `node_textfile_scrape_error` stays at `0` — the file still
parses, it is only stale. `make verify-ch22` grades the textfile half: look for
`PASS node_textfile_mtime_seconds is present`, `PASS the custom backup metric
arrived` and the `node_textfile_scrape_error is 0` assertion. The whole run must end
`0 failed` and `ch22 OK`.

**6.** Open-ended. A good answer decides each case on one property —
*is this job tied to a particular machine?* — and says so out loud. The
textfile case must be something whose result belongs to the host: a backup of
that machine's volume, a certificate rotation on that machine, a log rotation.
The Pushgateway case must be service-level: a nightly job that runs on whatever
worker the scheduler picked, whose identity is the job and not the host. Swap
them and you get the two named failures: a machine-level fact in the
Pushgateway loses its association with a machine and outlives the machine
itself, and a service-level job written to a textfile directory reports from
whichever host happened to run it, so the series moves between `instance`
values and nothing sums correctly. What you lose in both cases is `up` —
neither pattern gives you a per-target health signal for the job, which an
ordinary scraped target has had since Chapter 1.

## Chapter 23 — The Multi-Target Pattern: Probing From Outside

**1.** For the target `https://edge:8443/-/healthy`, which also carries
`__param_module: http_2xx_insecure_tls` from its own `labels:` block, the four
rules move one value across three slots:

| After | `__address__` | `__param_target` | `instance` |
|---|---|---|---|
| discovery | the probed URL | — | — |
| rule 1 | the probed URL | the probed URL | — |
| rule 2 | the probed URL | the probed URL | the probed URL |
| rule 3 | `blackbox-exporter:9115` | the probed URL | the probed URL |
| rule 4 | `blackbox-exporter:9115` | the probed URL | the probed URL |

Rule 4 writes `env="lab"` and touches none of the three columns. Confirm the
last row with `probe_ssl_earliest_cert_expiry{job="blackbox"}`: its `instance`
reads `https://edge:8443/-/healthy`, and `__address__` appears nowhere, because
every label whose name begins with `__` is discarded before storage. `make
verify-ch23` checks that second half mechanically — it asserts that no probe
series carries the exporter's own address in `instance` — and a clean run ends
`ch23: 12 passed, 0 failed` followed by `ch23 OK`.

**2.** `probe_success` for `http://nowhere:8080/healthz` reads `0`, and that is
the verdict rather than the diagnosis. A good answer names a second series that
separates "the name never resolved" from "the host resolved and refused", and
the candidates worth checking on your own run are the ones the chapter lists as
arriving from every prober: `probe_ip_addr_hash` and `probe_ip_protocol` exist
only once an address has been resolved, and `probe_dns_lookup_time_seconds`
records the time the lookup took. A refused connection produces all three and
still fails; an unresolvable name stops before them. The answer must also note
that `up{job="blackbox"}` stays `1` throughout — the exporter answered the
scrape perfectly — and that `debug=true` settles it in one request by printing
a `Resolution with IP protocol failed` line. Remove the target before you run
`make verify-ch23` again, or its `probe_success == 1` assertion fails on a
target you added on purpose.

**3.** The job, using the module as it ships:

```yaml
  - job_name: blackbox-dns
    metrics_path: /probe
    params:
      module: [dns_a]
    static_configs:
      - targets: ["edge"]
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox-exporter:9115
```

With `?target=edge` the probe fails: the DNS prober treats `target` as the
server to interrogate, so it sends a DNS query to port 53 on `edge`, where
Caddy is not listening, and `probe_success` reads `0`. The `debug=true` log
shows the failure in the query, not in the name. Change the target to
`127.0.0.11:53` and `probe_success` reads `1`, because the module's
`query_name: edge` is now being asked of a resolver. One sentence for a
colleague: for the DNS prober, `target` is whom you ask and `query_name` is
what you ask about, which is backwards from every other module because a DNS
probe is a probe of a resolver.

**4.** Open-ended in its wording, determinate in its shape. Remove `cap_add:
[NET_RAW]`, run `docker compose up -d --force-recreate blackbox-exporter`, and
probe with `?target=edge&module=icmp`. What you should write down is a
permissions error raised while opening the raw socket — not a timeout, not a
DNS error, and nothing that names ICMP or the target. That is the point of the
exercise: the message describes a syscall, so it sends you looking at the
network when the problem is the container's capabilities. Put `cap_add:
[NET_RAW]` back, recreate the container again, and the same probe returns
`probe_success 1`.

**5.** Add the site to the existing `blackbox` job's first `targets:` list so
it uses the plain `http_2xx` module, then:

```promql
(probe_ssl_earliest_cert_expiry{job="blackbox"} - time()) / 86400
```

A public site using an ACME certificate typically returns somewhere between a
few days and ninety. The rule, given a name of its own so it does not collide
with the lab's six-hour `ProbeCertificateExpiringSoon`:

```yaml
      - alert: ExternalCertificateExpiringSoon
        expr: |
          (probe_ssl_earliest_cert_expiry{job="blackbox"} - time())
            / 86400 < 30
        for: 1h
        labels:
          severity: ticket
          service: snip
```

`insecure_skip_verify` must stay off here because on a certificate you do not
control, verification *is* the measurement. Skipping it means a chain that is
expired at an intermediate, signed by an authority nobody trusts, or issued for
a different name still probes green, and you would be alerting on one failure
mode of the certificate while ignoring all the others. The lab's `edge` target
needs it only because Caddy's internal authority is untrusted by design.

**6.** Open-ended. A good answer writes the job from the model and changes
exactly two strings — `metrics_path` and the `replacement` that puts the
exporter's address back into `__address__` — then lists the differences the
README actually adds. Expect the list to be about arguments rather than shape:
an extra `__param_*` this exporter wants, a different default when the
parameter is missing, or authentication. The common wrong turn is omitting rule
2 because the exporter's own examples happen to include it and nobody explains
it; without it every target collides on one series named after the exporter,
and nothing reports an error.

## Chapter 24 — Cardinality: Detonate, Diagnose, Defuse

**1.** Three inputs: the baseline you read off `prometheus_tsdb_head_series`
before you start, around 9,000 on the measured stack; the arrival rate, 300
requests a second, each asking for a code nobody has used before; and one new
series per request, because only `snip_http_requests_total` carries
`link_code`. So `9,000 + 300 × 480 = 153,000` after eight minutes, and the
measured run reached about 152,900. If you are outside a factor of two, check
the arrival rate first — a laptop that cannot land 300 requests a second is the
usual cause — then your baseline, then whether you assumed more than one series
per request.

**2.** Open-ended on the timing, determinate on the two sentences. `promtool
tsdb analyze` reads one written block, so it reports across a time range: the
distinct series that existed over the whole block, and — uniquely among the
three tools — the label names and pairs most involved in *churn*, which no
instantaneous count can see. `/api/v1/status/tsdb` reads the head, so it
reports what is happening this second, including a bomb that started four
minutes ago and has not been written to a block at all. The common wrong turn
is running `analyze` first during a live incident and concluding the bomb is
elsewhere, because the most recent block was cut before the detonation started;
check with `promtool tsdb list -r /prometheus` before you trust an empty table.

**3.** Immediately after the loop, both diagnostics look alarming: every commit
the loop set is still inside the five-minute lookback window, so `count(count by
(commit) (snip_build_info))` reports about six — the five new values plus
`a1b2c3d`, which `snip-worker` still carries because the loop recreates only
`snip-api` — and `count(snip_build_info)` reports two series per commit for the
two API replicas plus the worker's one. Ten minutes later both report that
everything is normal, because an instant query stops resolving a series about
five minutes after its last sample. `prometheus_tsdb_head_series` says they are
both wrong: it does not fall, because a series leaves the head when the head is
cut into a block on its roughly two-hour cycle, not when you stop writing to
it. That gap between "I cannot see it" and "it is not there" is the whole of
churn, and it is why the rate of
`prometheus_tsdb_head_series_created_total` is the diagnostic that sees it.

**4.** With `labeldrop` on `link_code`, `count(snip_http_requests_total)` falls
back to `12` — the design count from LAB-SPEC §5.1 — while
`scrape_samples_post_metric_relabeling{job="snip-api"}` stays in the tens of
thousands, because the samples are still arriving and being parsed. With a
`drop` on `__name__` matching `snip_http_requests_total`,
`count(snip_http_requests_total)` is an empty result and
`scrape_samples_post_metric_relabeling` returns to roughly eighty per target.
In one sentence: `labeldrop` keeps the family and destroys its meaning by
merging thousands of series onto twelve and discarding all but one sample each,
while `drop` keeps the meaning of everything that survives and removes the
family outright — and only `drop` reduces what you store.

**5.** Add `label_value_length_limit: 32` to the `catalog` job, reload, and send
the 64-character book id. Yes, it fails the same way: every scrape limit except
`keep_dropped_targets` fails the entire scrape, so the target goes `DOWN` and
`up{job="catalog"}` reads `0` — nothing is truncated and no partial scrape is
stored. A good answer to the second half compares the two messages on
`/targets` on your own run and says which one narrowed the search faster: the
sample-limit message tells you the target produced too much and nothing more,
while the label-value message at least names the constraint that was breached,
though neither prints the offending label or its value. The common wrong turn
is expecting the limit to trim the long value; it does not, and reading these
limits as truncation is the mistake the chapter names. Take the line back out
afterward, or `make verify-ch24` runs against a job whose scrapes are failing.

**6.** Open-ended. A good three-sentence summary has one sentence of
observation, one of action, and one of prevention, and the third is the one
that decides whether the incident is really closed: it names the change that
makes the same mistake impossible or loud, which here is the `sample_limit` and
`label_limit` pair on the `snip-api` job, not "we will be more careful". Keep
the numbers in it — head series before and after, and how long the head kept
them after the label was removed. The common wrong turn is writing the second
sentence about the emergency `labeldrop` and stopping there, which records a
brake as if it were a repair.

## Chapter 25 — Storage, Retention, Backups and Locking the Door

**1.** Trust the `[6h]` number. Both `prometheus_tsdb_compaction_chunk_size_
bytes_sum` and `prometheus_tsdb_compaction_chunk_samples_sum` only move when a
compaction happens, and compactions are hours apart, so a one-hour window
frequently contains none at all and returns an empty result, or contains
exactly one and reports that single event as if it were an average. Two reasons
your figure can sit above the documented 1 to 2 bytes: this lab is restarted
often, and every restart cuts a head whose chunks hold few samples each, so the
per-chunk overhead is spread over fewer values; and `catalog`'s unbounded
`book_id` mints series that live briefly, and a short-lived series pays a full
chunk's overhead for a handful of samples. For 90 days at the measured 600
samples per second, `7,776,000 × 600 × 1` is about 4.7 GB and
`7,776,000 × 600 × 2` is about 9.3 GB.

**2.** At a size limit equal to the whole volume, the persistent block
directories are deleted oldest first while `wal/` and `chunks_head/` are not —
they are counted toward the total and cannot be trimmed, so you can lose every
block and still be over the limit. You also remove the free space compaction
needs to write a new block before deleting the old ones, and the failure then
looks like corruption rather than a full disk. At 80 % the headroom holds those
two directories at their two-hourly peak plus one compaction's working set. One
sentence each: the setting never touches the WAL, which is sized by ingest and
checkpointing; it deletes only whole expired blocks, and only on the next block
reload cycle.

**3.** Copy the snapshot before you mount it, then run the throwaway server on
`:9098` exactly as the chapter does and query `snip_http_requests_total`. Five
things the restore does not have, with where each one actually lives:

| Missing | Held by |
|---|---|
| Scrape config and targets | `lab/prometheus/prometheus.yml` |
| Recording and alerting rules | `lab/prometheus/rules/` |
| Dashboards and Grafana state | `lab/dashboards/`, volume `grafanadata` |
| Alertmanager routing and silences | `lab/alertmanager/`, volume `amdata` |
| Which teaching switches are on | `lab/.env` |

The repository is the more valuable half of that table, because it is the half
you cannot regenerate from the data.

**4.** Through the proxy, with credentials:

```bash
P=https://localhost:8443/prometheus/api/v1/admin/tsdb
curl -sk -u obslab:obslab -X POST \
  "$P/delete_series?match[]=catalog_lookups_total"
curl -sk -u obslab:obslab -X POST "$P/clean_tombstones"
```

Each returns `204` with no body, and `count(catalog_lookups_total)` is empty
immediately afterward. The whole thing takes seconds on a lab this size, which
is the uncomfortable part. A good change-request sentence states the capability
rather than the risk in the abstract: one unauthenticated HTTP request to this
endpoint permanently deletes any time series matching any selector, with no
confirmation, no undo and no audit record, so the endpoint must be blocked at
the proxy before `--web.enable-admin-api` is turned on rather than after.

**5.** Record what you saw. During WAL replay the server is listening but not
ready, so a query through Grafana returns an error rather than an empty result,
and the panel shows a failure banner instead of "No data" — which is the
distinction worth writing down, because an empty result would read as "nothing
happened" rather than "the database is not up". `prometheus_tsdb_data_replay_
duration_seconds` is seconds on this lab. Replay time scales with how much of
the WAL has to be read back, which tracks head series, so a hundred times the
series is roughly a hundred times the window: seconds become minutes, and every
dashboard is blank and every alert silent for all of them.

**6.** The second block, and the two settings it forces:

```text
  handle_path /grafana/* {
    reverse_proxy grafana:3000
  }
```

What breaks is both the login redirect and the assets, for one reason: Grafana
builds absolute URLs from `root_url`, which defaults to `http://localhost:3000/`,
so every generated link and every asset path points at the root of the host
rather than at `/grafana/`. `root_url` is what tells the application the address
the outside world uses to reach it. Two sentences for the last part: the proxy
decides which prefix arrives at the application and the application decides
which prefix it writes into the HTML it generates, and neither one can see the
other's decision — so `handle_path`, which strips the prefix, has to be paired
with `GF_SERVER_ROOT_URL` carrying the sub-path and
`GF_SERVER_SERVE_FROM_SUB_PATH=false`, while a `handle` that leaves the prefix
on has to be paired with `GF_SERVER_SERVE_FROM_SUB_PATH=true`. Undo this before
re-running `make verify-ch25`, whose eight assertions include the `401` and
`200` pair on `/prometheus/`.

## Chapter 26 — When One Prometheus Isn't Enough: HA, `remote_write`, and the Scaling Map

**1.** A site block in `lab/edge/Caddyfile` is enough, and it needs no
published host port because Grafana connects from its backend over `obsnet`:

```text
:9091 {
  reverse_proxy prometheus:9090 prometheus-b:9090 {
    lb_policy round_robin
  }
}
```

Add a second data source pointing at `http://edge:9091` and the ten refreshes
alternate between two slightly different values, with an occasional missing
point where one server missed a scrape the other caught. No Grafana setting
fixes it because a Prometheus data source is one HTTP endpoint with no concept
of a replica label, so there is nothing in Grafana that could merge the two
answers; deduplication has to happen in a replica-aware query layer or at the
receiver that ingests both replicas.

**2.** Open-ended in wording, fixed in content. The three shapes:

```yaml
external_labels: {cluster: obslab, replica: a}        # Thanos
external_labels: {cluster: obslab, __replica__: r1}   # Mimir
external_labels: {cluster: obslab}                    # VictoriaMetrics
```

A good answer states which backend each is correct for and then the four
crossings that matter: Thanos-shaped labels sent to VictoriaMetrics make the
two replicas look like different series, so both copies are stored and paid for
forever and `-dedup.minScrapeInterval` never fires; identical labels sent to
Thanos Query give `--query.replica-label` one value to merge, so nothing merges
and a scrape one replica missed becomes a real gap; `replica` rather than
`__replica__` leaves Mimir's HA tracker with nothing to key on, so it stores
both replicas; and `__replica__` sent to a Thanos configured for `replica`
merges nothing for the same reason. Be honest about the count the exercise
asks for: in this book's framing every one of these is silent at the query
page, so if one of yours produces an error, record which, because that is the
only one you can catch in CI.

**3.** The job, on the primary:

```yaml
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

Find one with `{__name__=~"job:.*", replica="b"}` — the external label is
attached by `prometheus-b` on the way out and survives because
`honor_labels: true` keeps it. For the extrapolation, divide the `wc -c` of the
`{__name__!=""}` body by `count({__name__!=""})` on `prometheus-b` to get bytes
per series, typically one to two hundred, then multiply by a million: a single
HTTP response of a few hundred megabytes, rendered in full, every scrape
interval, on both ends. Keep the selector restricted to `job:.*` before you run
`make verify-ch26`, whose count comparison between the replicas allows a
difference of two series.

**4.** Without `honor_labels: true`, the federate job's own target labels win:
`job` becomes `federate` and `instance` becomes `prometheus-b:9090` on every
federated series. The original values are not lost — they are renamed to
`exported_job` and `exported_instance`. Nothing errors, and every rule and
panel that selected on `job` or `instance` stops matching.

**5.** With the block from the chapter, the queue geometry is
`max_shards × (capacity + max_samples_per_send) = 10 × (2500 + 500) = 30,000`
samples in flight. Against the whole server's ingest rate of about 600 samples
a second that is 50 seconds; against what actually enters this queue it is much
longer, because `write_relabel_configs` keeps only `job="prometheus"`, which is
about 1,274 series every 15 seconds, or 85 samples a second — so nearly six
minutes. Pause the receiver and `prometheus_remote_storage_samples_pending`
climbs to that ceiling and flattens. Everything beyond it is still in the
write-ahead log, which the sender reads as it is written, so nothing was lost:
the queue is a window onto the WAL rather than the buffer of record, and on
unpause the sender resumes from where it stopped.

**6.** `retry_on_http_429: true` goes beside `url:` in the `remote_write`
block. A good answer names a receiver where a 429 is a hard quota rather than
momentary backpressure — a metered managed service whose token bucket refills
on a fixed schedule — and explains that retrying there converts a throttling
episode into a growing backlog of samples the receiver will refuse again, and
then refuse a second time as too old. The metric that tells you the decision
cost you data is `sum by (reason) (rate(prometheus_remote_storage_samples_
dropped_total[5m]))`, whose `reason` label separates the drops from
`too_old` and the rest; pair it with `prometheus_remote_storage_samples_pending`
and a `sample_age_limit` so the queue does not spend its life retrying samples
that can no longer be accepted.

## Chapter 27 — Optional: What Changes on Kubernetes

**1.** `port: 8000` is rejected by the API server with
`spec.endpoints.port in body must be of type string: integer`, so nothing is
applied and you find out in one second. Renaming the Service port to `metrics`
while the ServiceMonitor still names `http` validates cleanly, applies, and
produces zero targets and no error anywhere — `up{job="snip-api"}` is an empty
result and `kubectl describe servicemonitor snip-api` says nothing. The numeric
mistake tells you what is wrong because the CRD's schema declares the field a
string; the name mismatch is silent because `endpoints[].port` names a Service
port whose existence is not the schema's business, and a search that matches
nothing is a legal outcome of a selector. Put both files back afterward.

**2.** Time it honestly. The path is: read the generated config first, with
`kubectl -n monitoring get secret prometheus-kps-kube-prometheus-prometheus
-ojson | jq -r '.data["prometheus.yaml.gz"]' | base64 -d | gunzip | grep -A5
snip`. Nothing at all means the `Prometheus` object is not selecting your
`ServiceMonitor`, which points straight at the missing `release: kps` label;
restore it with `kubectl -n snip label servicemonitor snip-api release=kps`. If
the job *is* in the config and the Targets page is still empty, the fault is
downstream — a Service that matches nothing, a Service with no ready endpoints,
or a wrong port name. The number worth recording is the second one a week
later, because the first time is a lesson and the second is the skill.

**3.** One value per pod, with the pod-level rollup excluded by naming the
container:

```promql
sum by (pod) (
  container_memory_working_set_bytes{namespace="snip",
    container="snip-api"}
)
/
sum by (pod) (
  kube_pod_container_resource_limits{namespace="snip",
    container="snip-api", resource="memory"}
)
```

The numerator comes from cAdvisor, which is compiled into the kubelet and
served at `/metrics/cadvisor` — the same code as the standalone container in
Chapter 22. The denominator comes from kube-state-metrics, which reports what
somebody declared in YAML and knows nothing about usage. For a pod with no
memory limit there is no series on the right, so one-to-one matching finds no
partner and that pod is absent from the result altogether — not `+Inf`, which is
the Docker-side behavior Chapter 22's exercise 2 produced, because cAdvisor
reports an unset limit as `0` while kube-state-metrics reports nothing at all.

**4.** Open-ended in the count, fixed in the lesson. The number of firing
alerts depends on your chart version and how long you wait, so record yours;
what must appear in the answer is that they are alerts about components a
managed cluster does not expose to you, that no action on your part can clear
them, and that they fired within minutes of an install nobody misconfigured.
The chapter that told you this would happen is Chapter 19, "What a Page Should
Say, and Who Watches the Watcher", whose whole argument is that an alert is a
message to a human who must be able to do something; Chapter 21 is the second
half of it, since a pager that fires on day one for the unfixable is how a team
learns to disbelieve the pager. Set the four components back to `enabled:
false` when you are done.

**5.** Tier 2 needs `job:snip_sli_availability:ratio_rate6h` and
`job:snip_sli_availability:ratio_rate30m` added to the same `PrometheusRule`,
and the alert itself is Chapter 21's `SnipAvailabilityBurnMedium` copied
verbatim, guard included. The first list has two entries: the CRD wrapper
around the groups, and the `release: kps` label on `metadata` — without which
the object applies, validates and is never loaded, with the same silence as the
ServiceMonitor. The second list is everything else: the expression, both
windows, the `(6 * 0.005)` form, the minimum-events clause, `for: 2m`, the
`severity`/`service`/`route` labels, and the `{{ $value | humanizePercentage }}`
templating in the annotations. Confirm on the Rules page, and note that unlike
a file-based rule the operator validates the expression and rejects a bad one —
`kubectl get events -n snip` is where that rejection is reported.

**6.** Helm v3 installs CRDs on first install and never upgrades them, so the
answer to "did Helm update them?" is no, every time, and the `kubectl get crd`
output still shows the old schema beside a chart that ships a newer one. What
you have to do yourself is apply the bundled CRD manifests with
`kubectl apply --server-side --force-conflicts` *before* the `helm upgrade`,
server-side because the `Prometheus` CRD exceeds the 262,144-byte annotation
limit that client-side apply writes into
`kubectl.kubernetes.io/last-applied-configuration`. The field that would have
failed silently is any field the new chart uses that the old CRD's schema does
not declare — the chapter's own example is `serviceDiscoveryRole` — because a
structural schema prunes unknown fields: `kubectl apply` succeeds, the field is
dropped on the way in, and the object runs on the old default with nothing
logged anywhere.

`make verify-ch27` grades the chapter rather than these exercises, and two
caveats apply to all of them: without `kubectl` or a reachable cluster the
script exits `2` rather than failing, and it is the one verify target in the
book that has never been exercised against a live cluster, so read a failure as
evidence about the script as well as about your work.

## Chapter 28 — OpenTelemetry and Prometheus

**1.** Three names:

```text
http_server_request_duration_seconds_bucket
http_server_request_duration_seconds_sum
http_server_request_duration_seconds_count
```

Dots become underscores, the UCUM unit `s` becomes the word `seconds` and is
appended, and a histogram then adds `_bucket`, `_sum` and `_count` on top of
that. No `_total` appears, because a histogram is not a monotonic sum. The
worker's own `snip.worker.job.duration` with unit `s` is the same type and the
same unit, and it is in your database as
`snip_worker_job_duration_seconds_bucket` and its two siblings.

**2.** The count does not change. The ceiling from Chapter 7's arithmetic is 32
— six for `snip_worker_jobs_total`, two each for the two gauges, and
`(8 finite + +Inf + _sum + _count) × 2 queues = 22` for the histogram — and you
may see fewer, because an OTel counter cannot pre-create a label combination
that has not happened, so `outcome="error"` has no series until a job fails.
Removing `promote_scope_metadata` and waiting five minutes for the old series
to fall out of the lookback window returns the same number: scope labels cost
zero series, because every series belongs to exactly one scope and adding it to
the identity cannot split anything in two. What they do cost is paid per series
— more bytes in the head block and the index, longer label sets on the wire,
noisier legends — and the situation worth paying it in is a process where two
libraries emit the same metric name and nothing else tells them apart.

**3.** Add the line to `snip-worker`'s `environment:` block, `make up`, and wait
two export intervals. What the chapter's rule predicts, and what you should
check against your own run: the two gauges — `snip_worker_queue_depth` and
`snip_worker_last_success_timestamp_seconds` — keep receiving samples, because
a gauge has no temporality to get wrong, while `snip_worker_jobs_total` and the
three `snip_worker_job_duration_seconds_*` series stop, because non-cumulative
monotonic sums and histograms are dropped by default. The point of recording
the logs is that they are the wrong place to look: expect neither
`docker compose logs snip-worker` nor `docker compose logs prometheus` to name
a drop, because nobody configured anything called "drop" and the loss is
permitted by the compatibility spec. Take the line out again.

**4.** Use `by`:

```promql
sum by (queue) (rate(snip_worker_jobs_total[5m]))
```

`without (instance)` fails on the pushed side because the same value also
arrives as `service_instance_id`, which you did not name, and `without` keeps
every label it was not told to drop — so the result stays per-instance and
returns more than two series. Flipping `SNIP_OTEL` on is clean: the scraped
series get staleness markers at the first scrape that no longer carries them,
so within a scrape interval they stop resolving, and the graph dips for the
half-minute the pushed counter needs two samples before `rate()` has anything
to report. Flipping it off is not: push has no way to say a series is finished,
so the pushed series linger until they age out of the five-minute lookback
window, both populations are summed at once, and the graph steps up to roughly
double before falling back.

**5.** Open-ended, and the shape is what is graded. The recommendation must
take a side in two sentences — the chapter's own is native instrumentation for
services you own, and take OpenTelemetry as it comes when it is already there,
preferring path A because it keeps `up` and the scrape pipeline. Then each of
Volz's six points has to be answered with one of the three words the exercise
gives you: survives, mitigates, accepts. A recommendation that accepts none of
them has not engaged with the fact that losing target health and losing
relabeling are real losses with no configuration that restores them. The common
wrong turn is treating naming as the serious problem and target health as a
detail; the naming is a one-time cost you pay when you write the alert, and
`up` is a question you can no longer ask at all.

`make verify-ch28` needs `SNIP_OTEL=1` and `promote_scope_metadata: true` in
place; with both it asserts six things and prints `ch28 OK`. Exercise 2's
second half removes the scope metadata, so the `otel_scope_*` assertion fails
while it is out — put it back before you verify, and set `SNIP_OTEL=0` again
when you are finished with the chapter.

## Chapter 29 — Beyond Metrics: Exemplars, Traces, Logs, and Where to Go Next

**1.** With `SNIP_OPENMETRICS=0` the handler serves classic text, which has no
syntax for an exemplar, so nothing is scraped and
`SKIP_CHAIN=1 ./scripts/verify-ch29.sh` fails at `at least one exemplar was
stored` and then at `at least one exemplar carries trace_id`. Removing
`--enable-feature=exemplar-storage` and recreating the container fails at
exactly the same two assertions, because Prometheus scrapes the exemplars and
discards them. The one sentence: from Prometheus's side there is no observable
difference — both produce an empty `/api/v1/query_exemplars` result with no log
line anywhere — and you can only tell them apart at the exposition endpoint,
where `curl -s -H 'Accept: application/openmetrics-text'
http://localhost:8080/metrics | grep -c trace_id` prints zero in the first case
and a non-zero count in the second.

**2.** The line that marks the end of an OpenMetrics body is `# EOF`; the
classic format has no terminator at all, which is why a truncated classic
exposition can parse as a complete one. For the two other structural
differences, report what your own diff showed and expect these: in OpenMetrics
the `# HELP` and `# TYPE` lines name a counter *family* without the `_total`
suffix while the sample line keeps it, so the two strings differ where in the
classic format they are identical; and OpenMetrics defines a third metadata
line, `# UNIT`, for which the classic format has no syntax, though whether your
exposition actually carries one depends on the client library. Reporting "no
`# UNIT` lines in mine" is a correct answer — the point is that you looked.

**3.** The stars for that query disappear, and the sentence from the chapter is
that there is no exemplar support for Instant queries at all. Range and Instant
is a per-query setting, so the other two queries on the panel keep their stars
while the one you switched has none, which is the cheapest possible
demonstration that the exemplar toggle is per query rather than per panel.
Switch it back.

**4.** About 12 of 1,200. The default `TraceBased` exemplar filter only makes a
measurement eligible if it was recorded inside a sampled span, so 1 % head
sampling discards 99 % of exemplars before they are created, and a latency panel
that should be dense with stars is nearly bare. The two sentences: `always_on`
is set in `compose.signals.yaml` so that a chapter-length demonstration has
anything to show, since at any realistic production sampling rate you would
open the panel and see nothing; in production you would leave the sampler where
your trace budget puts it and accept sparse exemplars, or move the filter with
`OTEL_METRICS_EXEMPLAR_FILTER` and pay for it in the exemplar buffer instead.

**5.** The fifth rule, added to `discovery.relabel "containers"` in
`lab/alloy/config.alloy`:

```text
	rule {
		source_labels = ["__meta_docker_container_id"]
		target_label  = "container_id"
	}
```

Restart Alloy and every container's logs get a stream keyed on its id. Restart
one `snip-api` container and the stream count for `service="snip-api"` goes up
by one rather than staying where it was, because the old stream is not
reclaimed — Loki indexes the label set of each stream, so an unbounded stream
label creates one stream per value exactly as an unbounded Prometheus label
creates one series per value. Chapter 7 already told you what would happen with
its arithmetic, and Chapter 24's distinction names this version of it: a value
that changes on every restart is churn, which is worse, because an
instantaneous count of streams looks normal. The correct home for a container
id is structured metadata, which is attached to the log entry and indexed as
neither label nor line. Remove the rule afterward.

**6.** Open-ended. A good answer names one tell from the six, quotes the claim
the article makes, and states what is true instead — for example that it
installs Promtail, which was removed in Loki 3.7.3 and whose replacement is
Alloy; or that it sets `--enable-feature=native-histograms`, which has been a
no-op since Prometheus 3.9, native histograms having been stable since 3.8.0.
The discipline the exercise is training is dating a page from its vocabulary
rather than from its publication date, which is often missing or wrong. Saying
an article survives all six is a legitimate answer and worth acting on: those
are the ones to bookmark.
