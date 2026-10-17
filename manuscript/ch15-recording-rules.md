# Chapter 15 — Recording Rules

Open `http://localhost:3000/d/snip-red`, find the *Latency quantiles* panel, and set the
time picker to the last six hours. It draws. It takes a moment. Now count what you asked
for: three quantiles, each one a `rate()` over every latency bucket series `snip-api` has
ever produced, each re-evaluated at every step across six hours of graph. Prometheus read
the same numbers off the same disk three times over, and it will read them all again the
next time anyone loads this dashboard, and again for everyone else who has it open.

That is the first problem. The second is quieter. The *Error ratio (5xx / all)* panel next
to it is ten lines of PromQL, and Chapter 16, "Alerting Rules, and What 'Firing' Actually
Means", is about to page on that same ratio. Written out in both places they are two copies
of a string, and copies drift. Somebody adds a `route` filter to the panel and not to the
alert, and six weeks later the graph is green while the pager is going off, and neither of
them is lying.

The fix for both is the same: give the expression a name, tell Prometheus to compute it on a
schedule, and store the answer as an ordinary time series. That is a **recording rule** — a
YAML file, four fields, and an execution model you can hold in your head. It is load-bearing
because one decision inside it, worth about four lines of YAML, decides what Chapter 20,
"SLIs, SLOs and Error Budgets", and Chapter 21, "Burn Rates: Alerts That Don't Cry Wolf",
will be able to build on top of it.

!!! objectives "Objectives"
    After this chapter you can:

    - Write a rule group and predict the order its rules evaluate in.
    - Name the two legitimate reasons to record an expression, and the illegitimate one.
    - Explain why recording a quantile destroys your ability to re-aggregate it or change
      the quantile later.
    - Give a recorded series a name whose prefix is a true statement about its labels,
      and reserve a stable one for the service level indicator Chapters 20 and 21 build on.
    - Prove a recording rule correct by graphing it against the expression it replaces.
    - Query the rule engine to find out whether it is keeping up.

## Where the lab is

Everything here runs against the stack as Chapter 14, "Dashboards That Tell the Truth",
left it: two `snip-api` replicas behind the `edge` proxy, `snip-worker`, `catalog`,
`loadgen`, Grafana and Prometheus.

```bash
cd lab
git checkout ch15
make check
make up
make ps
```

Snip answers on `http://localhost:8080/`, Prometheus on `http://localhost:9090/`, Grafana
on `http://localhost:3000/`, and the load generator's control API on
`http://localhost:8089/`. Pin the injector so this chapter's numbers are reproducible:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","error_ratio":0}'
```

The `ch15` tag already carries this chapter's work finished: the `rule_files:` key in
`prometheus/prometheus.yml`, and `prometheus/rules/snip-recording.yml` with all five rules
in it. Read those two files alongside the rules below rather than adding a second
`rule_files:` key — a duplicate mapping key is a config parse error, and `make check` stops
on it. If you would rather type the rule file with your own hands, start from `ch14`, where
neither exists, and check out `ch15` at the end to compare.

## A rule file, and what is in it

Prometheus loads rules from files listed under `rule_files:` in the main configuration.
Chapter 14 left `lab/prometheus/prometheus.yml` with no such key; this chapter's edit is the
one that adds it:

```yaml
rule_files:
  - /etc/prometheus/rules/*.yml
```

That path is inside the container. `./prometheus` is bind-mounted read-only at
`/etc/prometheus`, so `lab/prometheus/rules/snip-recording.yml` appears there. The glob is
shallow: it matches files directly in `rules/` and does not descend into `rules/tests/`,
which is deliberate — Chapter 18, "Testing Alerts Before They Page You", puts unit-test
files one level down precisely so the server never tries to load them as rules.

A rule file contains a list of **groups**, and each group a list of rules:

```yaml
groups:
  - name: snip-red
    interval: 30s
    rules:
      - record: job:snip_http_requests:rate5m
        expr: sum by (job) (rate(snip_http_requests_total[5m]))
```

Five fields matter on a group, and only `name` is required. It must be unique within its
file, and it is the identity the rule engine reports itself under when you monitor it.

`interval` is how often the whole group runs. Omit it and the group inherits
`global.evaluation_interval`, which is `30s` here. Every group the lab ships writes
`interval: 30s` anyway, so nobody has to open `prometheus.yml` to find out.

`limit` caps how many series one rule may produce. Exceed it and the rule fails: no samples
are written at all, and the failure is counted. Zero, the default, means no limit. It is a
seatbelt against a `by` clause you widened without thinking.

`query_offset` moves the group's evaluation timestamp into the past by a fixed duration, so
a sample that arrived a few seconds late is still inside the window the rule reads; the
global default is `rule_query_offset`. It is the answer when rules and dashboards disagree
by exactly one evaluation. `labels` adds labels to everything the group produces — resist it
for recording rules, because such a label is invisible in the rule's own expression and the
next person will not find where it came from.

Inside `rules:`, a recording rule is two fields — `record:`, the name to store the result
under, and `expr:`, the PromQL to evaluate. The same list holds alerting rules, which use
`alert:` instead; Chapter 16 adds those in a second file.

## The execution model, which is the whole trick

There are exactly two facts about scheduling, and every subtle thing recording rules do
follows from them.

**Rules inside a group run in order, one at a time.** Rule 2 does not start until rule 1 has
finished and its result has been written. So rule 2 may read what rule 1 recorded and get
this evaluation's value, not the previous one. Prometheus 3 can relax this —
`--enable-feature=concurrent-rule-eval` runs rules a group's dependency map says are
independent in parallel — but it still orders any rule that reads another's output after
it, and this lab does not set the flag.

**Groups run independently of each other.** Prometheus spreads groups across the interval
by hashing each group's identity, so two thirty-second groups in one server evaluate a
fixed number of seconds apart — permanently, with nothing negotiating between them. A rule
in group B that reads a series recorded by group A therefore gets whatever was last
written: up to one full interval old, every single time, and on a cold start nothing at all.

```text
t = 0s ────────────────────────────────────────────────────────▶

  group snip-red      rule 1 ▸ rule 2 ▸ rule 3 ▸ rule 4 ▸ rule 5
  interval 30s        └── strictly in order, one at a time ──┘

  any other group              rule A ▸ rule B
  interval 30s                 └─ its own phase; nobody waits ─┘

t = 30s ───────────────────────────────────────────────────────▶
  each group starts again on its own clock, finished or not
```

Read the diagram as a promise and a non-promise. Within a row, order is guaranteed. Between
rows, nothing you get to choose. The practical rule that falls out: **if rule B consumes
rule A's output, they belong in the same group, with A above B.** Chapter 20 does this — it
records a five-minute ratio and then, seven rules later in the same group, averages that
recorded series over thirty days. Split them across groups and the thirty-day figure quietly
reads a value from the previous evaluation, forever, with nothing reporting a problem.

The last line of the diagram matters too. If a group takes longer than its interval to
evaluate, Prometheus does not run two copies: it skips the tick and counts the skip. A group
that is permanently behind produces a series with holes in it, and the only thing that tells
you is a counter you meet at the end of this chapter.

## A recorded series is an ordinary series

There is no such thing as a "recording-rule series". The rule engine writes into the same
storage the scrapes write into, and everything you already know applies.

The timestamp is the group's evaluation time, not a scrape time. Scrapes land every fifteen
seconds; this group evaluates every thirty. The grids do not line up, and there is no reason
they should. Ask how far behind the clock the newest recorded sample is, several times in a
row — `timestamp()` returns, as a value, the moment each sample was written, in epoch
seconds, so subtracting it from `time()` gives that sample's age:

```promql
time() - timestamp(job:snip_http_requests:rate5m)
```

The number climbs by one each second and drops by exactly thirty — the group's interval —
every time the group runs. That sawtooth is the scheduler, not lag and not an error, and it
is why this chapter's verification script compares the recorded value against the ad-hoc
expression *at the recorded sample's own timestamp* rather than at "now".

Staleness works the way Chapter 2, "What's Actually on the Wire", described it, which is not
the way most people remember it. When a group evaluates and a rule does not produce a series
it produced last time — you deleted the rule, you renamed it, its expression stopped
matching — Prometheus writes a staleness marker for that series, and instant queries return
nothing for it from then on. One evaluation interval, thirty seconds here, not five minutes.
The five-minute lookback delta governs only series for which no marker is ever written. Old
samples stay where they are until Prometheus's **retention window** — how far back it keeps
data at all, fifteen days by default in this lab, and a number Chapter 25, "Storage,
Retention, Backups and Locking the Door", makes you choose — passes over them.

Which leads to the thing nobody expects the first time: **renaming a recorded series is a
migration, not an edit.** The old name stops answering instant queries within one interval,
but it keeps appearing in autocomplete for weeks, keeps answering range queries over the
past until retention expires, and keeps being read by whatever dashboard you forgot about.

## Naming: `level:metric:operations`

Recorded names use colons. Scraped names never do, by convention, so a colon is a reliable
signal that a human wrote this name and a rule computes it. The convention has three parts:

- **level** — the labels that survive the aggregation. `job:` means the output has `job` and
  nothing else; `job_route:` means `job` and `route`.
- **metric** — what is measured: the source metric name, with `_total` stripped when a
  `rate()` has been applied, because a rate is no longer a total.
- **operations** — what was done, **most recent first**, with `sum` left implicit because it
  is almost always there. `ratio_rate5m` is a ratio of two five-minute rates: the ratio
  happened last, so it is written first.

So `job_le:snip_http_request_duration_seconds_bucket:rate5m` reads, left to right: per job
and per bucket boundary, the request-duration bucket counters, as a five-minute rate.

The level is a promise, and easy to break. Here is the version of the request-rate rule
almost everyone writes first:

```yaml
- record: job:snip_http_requests:rate5m
  expr: |
    sum without (instance, route, method, code) (
      rate(snip_http_requests_total{job="snip-api"}[5m])
    )
```

That is defensible arithmetic: `snip_http_requests_total` carries `route`, `method` and
`code` from the application and `instance` from the scrape, so naming all four removes all
four. Reloading that rule and querying the recorded name gives:

!!! trap "The level that lies"
    ```text
    job:snip_http_requests:rate5m{env="lab", job="snip-api"}
    20.065551679849527
    ```

    There is an `env` label on a series whose name promises `job` and only `job`. Chapter
    12, "`prometheus.yml` in Full: Service Discovery and Relabeling", put `env: lab` on
    every target in this stack with a one-line relabel rule, and `without`
    keeps everything you did not name. The rule is not wrong; the *name* is now false, and
    the name is what other people build on. Add one more target label next year and the name
    gets falser without anyone touching this file.

Chapter 8, "Aggregation: `sum`, `without`, and the Rate-Then-Aggregate Law", warned that
`without` bites hardest where expressions acquire permanent names. This is the bite. The fix
is one word:

```yaml
- record: job:snip_http_requests:rate5m
  expr: |
    sum by (job) (
      rate(snip_http_requests_total{job="snip-api"}[5m])
    )
```

```text
job:snip_http_requests:rate5m{job="snip-api"}
20.065551679849527
```

**Aggregate recorded series with `by`, never with `without`.** `without` says "drop what I
listed"; `by` says "keep exactly this", and only the second can keep a promise. And never
aggregate away `job` itself: every alert this book builds on these series selects on `job`,
so a series that lost it cannot be selected at all — and Chapter 17, "Alertmanager: Routing,
Grouping and Silence", can only route an alert that fired in the first place.

## Two good reasons, and one bad one

The first legitimate reason to record is **cost**. A query that reads a lot of samples, run
often, is worth computing once — at every step of every graph, for everyone who has the
dashboard open. This chapter prices the latency expression and puts a number on it.

The second is **a stable name**. If the expression that defines "is Snip working" exists in
exactly one place, the dashboard, the alert and the monthly report cannot disagree about it.
This reason is worth more than the first and gets mentioned less.

The illegitimate reason is tidiness. Recording an expression because it is long, or because
precomputing feels thorough, costs three things: a series written forever at every interval,
evaluation time inside a group that has to finish before its next tick, and a name that is
now a public interface you cannot change without breaking a caller you have not met. Before
you add a rule, be able to name the panel or the alert that will read it.

## Writing the rules

`lab/prometheus/rules/snip-recording.yml` holds one group and five rules. The first is the
`by (job)` version the naming section arrived at.

```yaml
groups:
  - name: snip-red
    interval: 30s
    rules:
      # R — requests per second, for the whole service.
      - record: job:snip_http_requests:rate5m
        expr: |
          sum by (job) (
            rate(snip_http_requests_total{job="snip-api"}[5m])
          )
```

Next, E: the error-ratio pattern from Chapter 9, "Ratios, Arithmetic, and the Series That
Isn't There", with both of its guards, recorded per route.

```yaml
      - record: job_route:snip_http_errors:ratio_rate5m
        expr: |
          (
            sum by (job, route) (
              rate(snip_http_requests_total{job="snip-api",
                                            code=~"5.."}[5m])
            )
            or
            0 * sum by (job, route) (
              rate(snip_http_requests_total{job="snip-api"}[5m])
            )
          )
          /
          (
            sum by (job, route) (
              rate(snip_http_requests_total{job="snip-api"}[5m])
            ) > 0
          )
```

The `or 0 *` on the numerator is Chapter 9's fix for a route with no errors at all: it
supplies a zero instead of an absent series. The `> 0` on the denominator is the other half,
and it matters more in a rule than it did on a panel. Snip pre-initializes all twelve of its
`(route, method, code)` combinations to zero, so when traffic stops the counters do not
vanish — they sit still. Both sides of the division are then 0, and 0/0 is `NaN`: a real,
stored sample whose value compares false against everything. A blank panel is obvious; a
stored `NaN` is not, and Chapter 20 feeds this shape into a thirty-day average where one
`NaN` poisons the next thirty days. Filtering the denominator makes an idle window produce
*no sample*, which every downstream function knows how to skip.

Then D — and this is the rule the rest of the book leans on.

```yaml
      - record: job_le:snip_http_request_duration_seconds_bucket:rate5m
        expr: |
          sum by (job, le) (
            rate(snip_http_request_duration_seconds_bucket{
              job="snip-api"}[5m])
          )
```

Note what is *not* there: no `histogram_quantile`. Why not is the next section.

Finally, the two halves of the service level indicator, recorded separately.

!!! iou "IOU — chapter 20"
    **SLI** stands for service level indicator: one number that says whether the service is
    doing the job its users care about, computed as good events over valid events. Chapter
    20 builds the definition properly — which events count as valid, why some are excluded,
    and what to do with the result. All you are doing here is reserving the name. Chapter 16
    builds an alert on `job:snip_sli_valid:rate5m` existing at all, and Chapter 20's SLO
    dashboard draws both halves side by side, so before you add these two rules you can
    already name the alert and the panel that will read them. For Snip, valid means a
    redirect, `GET /l/{code}`, and good means a redirect that was not a 5xx.

```yaml
      - record: job:snip_sli_good:rate5m
        expr: |
          sum by (job) (
            rate(snip_http_requests_total{job="snip-api",
                                          route="/l/{code}",
                                          code!~"5.."}[5m])
          )

      - record: job:snip_sli_valid:rate5m
        expr: |
          sum by (job) (
            rate(snip_http_requests_total{job="snip-api",
                                          route="/l/{code}"}[5m])
          )
```

Good and valid are two rules, not one ratio. A ratio you cannot take apart is a ratio you
cannot debug: when the number drops you want to know at once whether good fell or valid
rose. Being counts rather than ratios, these two are deliberately *not* guarded with `> 0` —
a valid rate of exactly zero is a true and useful fact.

Check the file before Prometheus ever sees it:

```bash
make check
```

`make check` ends by running `promtool check rules` over every file in `prometheus/rules/`,
out of the pinned `v3.13.1` image, so it needs no network and no running stack. On a good
file the last two lines are:

```text
Checking /etc/prometheus/rules/snip-recording.yml
  SUCCESS: 5 rules found
```

Misspell `record:` as `recrod:` on the first rule and it fails instead, naming the file, the
field and the line the field sits on — line 39 in the copy this lab ships, wherever your
typo landed in yours:

```text
Checking /etc/prometheus/rules/snip-recording.yml
  FAILED:
/etc/prometheus/rules/snip-recording.yml: yaml: unmarshal errors:
  line 39: field recrod not found in type rulefmt.Rule
```

The exit code is non-zero, which stops `make check` — and that is why this belongs in a
pre-commit gate rather than in your memory. Fix it, then reload:

```bash
make reload
```

`make reload` sends `POST /-/reload`, which re-reads the configuration **and every rule file
it names**. This lab also runs Prometheus with `--config.auto-reload`, which Chapter 12
added, and that watch covers the rule files too: edit one and the server picks it up within
thirty seconds on its own. Either way, a rule file that does not parse is rejected as a unit
and the old rules keep running, which is correct behavior. Which of the two you used decides
whether you find out. `make reload` will not let you miss it: the recipe uses
`curl --fail-with-body`, so the server's refusal arrives as an HTTP 500 and fails the target.

```text
failed to reload config: one or more errors occurred while applying
the new configuration (--config.file="/etc/prometheus/prometheus.yml")
```

`--config.auto-reload` is the one that costs twenty minutes. It retries silently every
thirty seconds, writing the same line into the server log each time while the old rules go
on evaluating:

```text
Failed to apply configuration err="error loading rules, previous
rule set restored"
```

Open `http://localhost:9090/rules`. There is one group, `snip-red`, with five rules under
it, each showing its expression, its health and its last evaluation time. Thirty seconds
later, the series exist.

## Record the bucket rates, never the quantile

There is an obvious sixth rule, and it is a trap. The dashboard shows p95, so record p95:

```yaml
      - record: job:snip_http_request_duration_seconds:quantile95
        expr: |
          histogram_quantile(0.95, sum by (job, le) (
            rate(snip_http_request_duration_seconds_bucket{
              job="snip-api"}[5m])
          ))
```

It works. Reload, wait thirty seconds, query the name, and you get a number in seconds. The
panel that reads it is fast. Then two things happen, a month apart.

The first: somebody asks for p99. You cannot answer. The recorded series is a single float
per evaluation — the 95th percentile — and no operation on that float yields the 99th. You
add a second rule and you have p99 *from now on*. The question was about last Tuesday's
incident, and last Tuesday's p99 does not exist and never will.

The second: somebody wants p95 per replica during an incident, and adds `instance` to the
grouping — `sum by (job, instance, le)` — which is the first thing anyone does after a bad
deploy. Now you have one recorded p95 per replica and no way back to the service-wide
number. Averaging them is meaningless, for the reason Chapter 10, "Latency: Histograms
Without Tears", spent a page on: a quantile is a property of a population, and the average
of two populations' 95th percentiles is not the 95th percentile of the combined population.
No arithmetic recovers it, because the information was thrown away at record time. **A
recorded quantile is a summary of a distribution with the distribution deleted.** You can
always compute a quantile from buckets; you can never recover buckets from a quantile.

So record the buckets, and watch what the aggregation does to the series count:

```promql
count(snip_http_request_duration_seconds_bucket{job="snip-api"})
```

```promql
count(job_le:snip_http_request_duration_seconds_bucket:rate5m)
```

The second answer is `14` — one series per bucket boundary, the thirteen finite bounds
Chapter 10 designed around the 300 ms objective, plus `+Inf`. The first is 14 times however
many `(route, method, code)` combinations each replica has actually served, times the number
of replicas. Unlike the request counter, histograms are not pre-initialized, so a
combination's fourteen series appear the first time it occurs — and of the twelve
combinations `snip/metrics.go` names, one is `/l/{code}` answering 503, which happens only
when the database call itself fails, and nothing in this lab arranges that. So a replica
settles at eleven combinations and 154 bucket series, and the lab's two replicas give you
308. Yours will differ. The second answer is 14 whatever you do, which is most of the point.

Every question is still available, instantly, over the whole recorded history:

```promql
histogram_quantile(0.95,
  job_le:snip_http_request_duration_seconds_bucket:rate5m)
```

Change `0.95` to `0.99` and the graph redraws for the *entire* retention window, not from
now on: the recorded series kept the shape of the distribution, so the choice of quantile
stayed a query-time decision. `le` survived the grouping clause, which Chapter 10
established as the non-negotiable condition for `histogram_quantile` to work at all — and
the prefix `job_le:` tells a reader, without opening the rule file, that it did.

!!! trap "The verification script has a tripwire for this"
    Add that p95 rule to the group, reload, wait thirty seconds, and run `make verify-ch15`:

    ```text
    FAIL no recorded quantile masquerading as a series
         — got 1 series, want no series at all
         → expression: {__name__=~".*:.*quantile.*"}

    ch15: 11 passed, 1 failed
    ch15 FAILED
    ```

    (The `FAIL` line is one line in your terminal; it is wrapped here to fit the page.)
    Delete the rule and reload. Prometheus marks the series stale on the group's next pass,
    so the check passes again within thirty seconds.

## Proving the rule is the expression

A recording rule is a copy of an expression, and copies are what you are trying to
eliminate. So verify the copy, once, on a graph — in Grafana, because Prometheus's
expression browser draws every query in a panel of its own and this test needs both lines in
one set of axes. Open any time series panel on `snip-red` for editing and give it two
queries: A, the recorded name, and B, the expression it is supposed to be.

```promql
job:snip_http_requests:rate5m
```

```promql
sum by (job) (rate(snip_http_requests_total{job="snip-api"}[5m]))
```

Two lines, indistinguishable, one drawn on top of the other. If you can see two lines they
are not the same query, so diff the two strings character by character. The only difference
you should find is at the right-hand edge, where the recorded line stops up to one interval
earlier. Discard the edit; the panel has done its job.

To turn "indistinguishable" into a number, subtract them — and this one runs in Prometheus,
where a single expression is all you need:

```promql
abs(
  job:snip_http_requests:rate5m
  - on (job)
  sum by (job) (rate(snip_http_requests_total{job="snip-api"}[5m]))
)
```

`on (job)` because the two sides must match on their one shared label; `abs` because the
sign does not matter. At "now" this is not zero — it read `1.89` when these numbers were
taken — because "now" pairs a recorded sample up to an interval old with a freshly computed
one, and traffic moved in between. At the recorded sample's own timestamp the difference
collapses to floating-point dust, which is what `verify-ch15` does for three of the five
rules. What it cannot do is prove you named the level correctly: it holds its own copy of
each ad-hoc expression, so all it proves is that the values agree.

!!! selfcheck "Self-check"
    ```bash
    make verify-ch15
    ```

    ```text
    == verify-ch15 ==
       expected runtime: about 15 s

    PASS job:snip_http_requests:rate5m exists
    PASS job_route:snip_http_errors:ratio_rate5m exists
    PASS job_le:snip_http_request_duration_seconds_bucket:rate5m exists
    PASS job:snip_sli_good:rate5m exists
    PASS job:snip_sli_valid:rate5m exists
    PASS the snip-red rule group is loaded
    PASS no rule is in an error state
      (three more PASS lines follow, one per recorded rate, each
       ending with the value it compared — too wide for this page)
    PASS the recorded bucket rate keeps its le label
    PASS no recorded quantile masquerading as a series

    ch15: 12 passed, 0 failed
    ch15 OK
    ```

    Those three compared values track the load generator's twenty requests per second, about
    eighty percent of them on `/l/{code}`, so yours will differ. What must hold is twelve
    passes and no failures.

## Spending it: three panels, and what they lose

A recording rule nothing reads is a cost with no benefit, so go spend these. Three panels on
`snip-red` can be repointed at recorded series, and each loses something different — that is
the lesson, not the speed. It is a dry run: repoint the panels, read what changes, throw the
edits away, and the dashboard file on disk stays exactly as Chapter 14 left it.

Open the *Latency quantiles* panel for editing. It has three queries, A, B and C, one per
quantile, each of them `histogram_quantile(φ, sum by (le) (rate(…[$__rate_interval])))`.
Replace each with the recorded form:

```promql
histogram_quantile(0.95,
  job_le:snip_http_request_duration_seconds_bucket:rate5m)
```

Do the same to the *Request latency distribution* heatmap, whose query is the bucket rate
itself and so collapses to the recorded name alone. Both panels lose the same three things.
`$route` stops doing anything, because the rule summed the routes together before the query
ran and you cannot filter a dimension that no longer exists. `$job` stops doing anything for
a different reason: the rule hard-codes `job="snip-api"`, so the selector is baked in rather
than aggregated away — free today, with one job, and the cost of a variable the day there
are two. And `$__rate_interval` is gone: the window is `5m` because the *name* says
`rate5m`, so zooming out to seven days no longer widens it and the line gets spikier rather
than smoother.

The third panel goes the other way on purpose. *Error ratio (5xx / all)* computes one
overall ratio; point it at `job_route:snip_http_errors:ratio_rate5m{route=~"$route"}` and
you get one line per route — and `$route` still works, because that rule recorded at the
`job_route:` level and kept the label. Same technique, opposite outcome, for one reason: the
level you record at is the level the panel can show.

Now price it. The panel's **Inspect → Stats** tab reports it, but total request time on a
laptop is weather rather than arithmetic; the figure that is arithmetic is the number of
samples the query touched. Prometheus gives it directly with `stats=all`:

```bash
curl -sG http://localhost:9090/api/v1/query \
  --data-urlencode 'query=histogram_quantile(0.95, sum by (le) (
     rate(snip_http_request_duration_seconds_bucket{
       job="snip-api"}[5m])))' \
  --data-urlencode 'stats=all' |
  jq '.data.stats.samples.totalQueryableSamples'
```

```text
3080
```

```bash
curl -sG http://localhost:9090/api/v1/query \
  --data-urlencode 'query=histogram_quantile(0.95,
     job_le:snip_http_request_duration_seconds_bucket:rate5m)' \
  --data-urlencode 'stats=all' |
  jq '.data.stats.samples.totalQueryableSamples'
```

```text
14
```

`3080` is 154 bucket series times the 20 samples each contributes to a five-minute window at
a fifteen-second scrape interval. That is one replica's worth; on the lab's two replicas
expect roughly double, because the first figure tracks your own series count. The second
does not: the recorded query reads one sample from each of 14 series, whatever the traffic
and the replica count have been doing. A six-hour graph at a thirty-second step runs that
query 720 times, and there are three of them on the panel.

**A recording rule buys speed by spending flexibility, in advance, on your behalf.**
Pre-aggregation is a decision about which questions you will be allowed to ask later. Which
is exactly why the D rule keeps `le`: losing `route` costs you one filter, and losing `le`
would cost you every latency question except the one you happened to record.

When you do this for real, put it in writing where the next person will see it: each
repointed panel's description should say that it reads a pre-aggregated series and which
variables no longer apply, and the change becomes permanent through the workflow from
Chapter 13, "Dashboard Mechanics: Intervals, Panels and Variables" — edit in the UI, export,
paste back, commit. Here, leave the panel editor **without saving**; the dashboard file on
disk is the source of truth and this chapter does not change it.

## Watching the rule engine

Rules fail quietly by design. A failing rule writes nothing, and a series that is not being
written looks exactly like a service with nothing to say. Prometheus scrapes itself here, so
the rule engine's own metrics are already in the database. The ones worth knowing carry a
`rule_group` label whose value is the file path and the group name joined by a semicolon.

How long the last evaluation of each group took:

```promql
prometheus_rule_group_last_duration_seconds
```

```text
prometheus_rule_group_last_duration_seconds{env="lab",
  instance="prometheus-1", job="prometheus", rule_group=
  "/etc/prometheus/rules/snip-recording.yml;snip-red"} 0.015238704
```

Fifteen milliseconds on that run, against a thirty-second budget; it moves around, and at
this point in the book `snip-red` is the only group, so you get one series. Rather than
compare it to a constant, compare each group against its own interval, which Prometheus
also publishes:

```promql
prometheus_rule_group_last_duration_seconds
  / prometheus_rule_group_interval_seconds
  > 0.5
```

An empty result is the healthy answer. Half the budget is chosen so the warning arrives
before the damage does.

Skips that have already happened:

```promql
sum by (rule_group) (
  rate(prometheus_rule_group_iterations_missed_total[5m])
)
```

Non-zero means the group ran late and Prometheus dropped an iteration rather than stacking
two. Your recorded series has holes in it, exactly as wide as the interval.

Evaluations that ran and errored:

```promql
sum by (rule_group) (
  rate(prometheus_rule_evaluation_failures_total[5m])
)
```

Most commonly a `limit` breach, or a query that timed out or tried to load too many samples
at once. An expression that matches nothing is *not* a failure — it is an empty result. It
writes no samples, increments no counter, and is invisible here. Prometheus also exports
`prometheus_rule_evaluation_duration_seconds`, a summary of evaluation time across every
rule at once; because it carries no `rule_group` label it can tell you that something is
slow but never which thing, so build on the per-group gauge instead.

Chapter 19, "What a Page Should Say, and Who Watches the Watcher", turns the failure counter
into an alert. For now, run the three queries and note what healthy looks like — that is the
comparison you will want at three in the morning.

## Common mistakes

**Assuming rules in different groups can see each other's output.** The symptom is a series
that is always one evaluation behind, or empty for the first minutes after every restart and
then quietly correct. Nothing errors. If rule B reads rule A's output, put them in one group
with A first.

**Recording a quantile.** Worth repeating, because the wrong version works perfectly on the
day you write it and fails only when somebody asks a new question. Record
`sum by (job, le) (rate(…_bucket[5m]))` and take the quantile at query time.

**Aggregating with `without` in a recorded expression.** The output carries every label
nobody thought to name, the level prefix becomes a lie, and it gets worse each time somebody
adds a target label. Use `by`.

!!! pitfall "Renaming a recorded series and expecting the old one to leave"
    You fix a name, reload, and the old series is still there — in autocomplete, in the
    metrics explorer, in query results. It has not been deleted. Prometheus wrote a
    staleness marker for it on the group's next pass, so within one evaluation interval —
    thirty seconds here — it answers no instant query at all. But it goes on answering range
    queries over the past until retention expires, and goes on appearing in autocomplete for
    weeks. Treat a rename as a migration: add the new rule, move every reader across, then
    delete the old rule.

**A group interval shorter than the scrape interval.** Evaluating a five-minute rate every
five seconds does not produce fresher data. The samples underneath still arrive every
fifteen seconds, so you write three identical values for every one thing that changed, and
pay for all three.

## Summary

A recording rule is a query with a name and a schedule. Prometheus evaluates the expression
on the group's interval and writes the result as an ordinary time series, subject to every
staleness and retention rule you already know. Two reasons justify one: an expensive query
run repeatedly, and a definition that must live in exactly one place. The reason not to is
that a recorded name is permanent — it costs storage and evaluation time forever, and other
people build on it. The durable takeaways:

- Rules **within a group** run in order and can consume each other's output. Rules in
  **different groups** cannot rely on each other at all. Group by dependency.
- Name recorded series `level:metric:operations`, and make the level true. Aggregate with
  `by`, never `without`, so the promise in the name survives the next target label.
- **Record bucket rates; never record a quantile.** Buckets re-aggregate across replicas and
  answer any quantile, retroactively, over the whole recorded history. A recorded quantile
  answers exactly one question, forever, starting the day you deployed it.
- Pre-aggregation trades flexibility for speed in advance. Every label you drop is a filter
  somebody cannot apply later; say so in the panel description.
- Prove a rule by graphing it against the expression it replaces, and compare the two at the
  recorded sample's timestamp, not at "now" — a group is up to one interval behind the
  clock, by design.
- The rule engine fails quietly. `prometheus_rule_group_last_duration_seconds`,
  `prometheus_rule_group_iterations_missed_total` and
  `prometheus_rule_evaluation_failures_total` are how you find out; all three carry
  `rule_group`, and `promtool check rules` inside `make check` catches the rest before
  Prometheus ever sees the file.

## Exercises

!!! exercise
    **1. Record a p95, then try to use it (core).** Add the
    `job:snip_http_request_duration_seconds:quantile95` rule from this chapter and confirm
    it produces a number in seconds. The lab already runs two `snip-api` replicas, so add a
    second rule grouping `by (job, instance, le)` before taking the quantile, recorded as
    `job_instance:snip_http_request_duration_seconds:quantile95`, and you have one p95 per
    replica. Try to produce a single service-wide p95 from those two values, and compare it
    against the honest answer:

    ```promql
    histogram_quantile(0.95, sum by (job, le) (
      rate(snip_http_request_duration_seconds_bucket{
        job="snip-api"}[5m])
    ))
    ```

    Then try to produce a p99 for the last hour. Write down, in one sentence each, what
    stopped you both times. Delete both rules when you are done — `make verify-ch15` will
    tell you if you forgot. If you scaled the lab while experimenting, put it back to its
    default with `make scale N=2`; Chapter 16 assumes two replicas.

    **2. Split a dependent pair across groups (core).** Record
    `max_over_time(job:snip_http_requests:rate5m[1h])` as
    `job:snip_http_requests:max1h_rate5m`, placed *after* the rule it reads in the
    `snip-red` group, and confirm the values look sensible. Now move it into a second group
    in the same file, with the same interval, and reload. Describe what changes about the
    values, and write the PromQL that lets you observe the difference rather than assume it.
    Comparing the two series' timestamps is the shortest route.

    **3. Outrun the scrapes (warm-up).** Set the `snip-red` group's `interval` to `5s`,
    reload, and wait a minute. Graph `job:snip_http_requests:rate5m` against the same graph
    from before the change, then run `count_over_time(job:snip_http_requests:rate5m[1m])`
    and say what number you expected and what you got. Explain in one sentence what you
    bought and what you paid, then set it back to `30s`.

    **4. Are the groups keeping up? (core).** Write one expression that returns a result
    only when a rule group is at risk of skipping an iteration, and one that returns a
    result only when it has already skipped. Both should be empty on a healthy lab. Then
    make the first fire on purpose: set the group's `interval` to `5s`, which brings half
    its budget down to 2.5 seconds, and add a deliberately expensive rule — a subquery
    stepping a one-second grid across the longest range your lab actually holds. Watch the
    ratio cross 0.5, then watch `prometheus_rule_group_iterations_missed_total` start
    counting. Remove the rule and put the interval back to `30s`.

    **5. Break it before Prometheus does (warm-up).** Break `snip-recording.yml` two ways —
    misspell `record:` as `recrod:`, and separately give a rule an `expr:` that cannot
    parse, such as `sum by (job) (` — running `make check` after each. Record the exact
    message; one comes from the YAML parser and one from PromQL, and they read nothing
    alike. Then run `make reload` with the file still broken and open
    `http://localhost:9090/rules`: the old rules are still loaded and still evaluating.
    Explain why that is right, and why it is also a good way to lose twenty minutes.
