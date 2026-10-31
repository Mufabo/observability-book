# Chapter 20 — SLIs, SLOs and Error Budgets

Open `lab/prometheus/rules/snip-alerts.yml` and look at the threshold on
`SnipHighErrorRatio`. It fires when more than twenty percent of redirects return a
5xx. The comment next to it, written in Chapter 16, "Alerting Rules, and What
'Firing' Actually Means", is unusually honest about where the number came from:
twenty percent is a figure somebody picked because one redirect in five failing
is unambiguously an outage. It is not derived from anything.

That is the state of every alert you own. Each one is individually defensible.
You wrote them, you can explain them, and not one of them can tell you whether
nineteen percent for four minutes at three in the morning is worth waking up
for. Tuning does not help, because tuning requires knowing the right answer, and
nobody has written down what "Snip is working" means.

That sentence is the whole chapter. Not "Snip is up", which is a question about
processes, but a written definition of working: which requests count, which are
excluded and why, how good is good enough, over what period, and what happens
when you fall short. Once that exists, "was this worth waking someone for"
becomes arithmetic instead of an argument. Chapter 21, "Burn Rates: Alerts That
Don't Cry Wolf", does the arithmetic. This chapter writes the definition, turns
it into recording rules, and puts the result on a screen.

!!! objectives "Objectives"
    After this chapter you can:

    - Define an SLI as good events over **valid** events, and write the
      exclusion list that makes "valid" mean something.
    - Separate an SLO from an SLA, and say why the internal target must be
      stricter.
    - Choose a window and a target, and state the resulting budget in minutes.
    - Express a latency objective as the fraction of requests faster than a
      threshold, and say why a quantile cannot do that job.
    - Compute how much error budget is left and put it on a dashboard.
    - Write a one-page error-budget policy that one developer could follow.

## Where the lab is

Everything here runs against the stack as Chapter 19, "What a Page Should Say,
and Who Watches the Watcher", left it: eleven services, four alerting rules in
`lab/prometheus/rules/snip-alerts.yml`, the meta-alerts and the Watchdog in
`meta-alerts.yml`, and one recording-rule group, `snip-red`, in
`lab/prometheus/rules/snip-recording.yml`. The `ch20` tag already holds what this
chapter builds — `docs/SLO.md`, the `snip-slo` ladder, the SLO dashboard, the
error-budget policy, the fixture generator `fixtures/generate-history.py`, the
`history` and `backfill` targets in `lab/Makefile`, and
`scripts/verify-ch20.sh` — to read along with. To build them yourself, check out
`ch19` instead; the last three are shipped rather than typed, and the text says
where to take them across.

```bash
cd lab
git checkout ch20
make check
make up
make ps
```

Snip answers through the `edge` proxy on `http://localhost:8080/`, Prometheus on
`http://localhost:9090/`, Grafana on `http://localhost:3000/`, and the load
generator's control API on `http://localhost:8089/`. Put the injector into a
known, healthy state:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","error_ratio":0,"extra_latency_ms":0}'
```

Two things from earlier chapters are load-bearing, and both are already running.
Chapter 15, "Recording Rules", records `job:snip_sli_good:rate5m` and
`job:snip_sli_valid:rate5m` — two counts that reserved a name without defining
it. Chapter 10, "Latency: Histograms Without Tears", gave Snip's latency
histogram a bucket boundary at exactly `0.3` seconds, from an objective nobody
had written yet. This chapter writes it.

!!! iou "IOU from chapter 15, settled"
    Chapter 15 recorded `job:snip_sli_good:rate5m` and
    `job:snip_sli_valid:rate5m` and promised that Chapter 20 would say what
    "good" and "valid" actually mean, why some events are excluded, and what to
    do with the ratio. All of that arrives here. The two recorded counts do not
    change; everything here is built on top of them.

## Good events over valid events

A **service level indicator**, an SLI, is one number that says whether a service
is doing the job its users care about. It is a proportion:

```text
SLI = good events / valid events
```

Read that denominator again. It is **valid**, not *total*. Almost every treatment
of this gets the word right and then quietly writes code that uses the total, and
the difference is where the idea either becomes honest or becomes decoration.

Snip serves six kinds of request, and only one of them is a person following a
short link. The others are the orchestrator's liveness probe, two API calls, the
home page, and whatever a scanner asked for this morning. Measure "requests that
did not fail" across all of those and you mostly report how many health checks
you serve. With the injector healthy, run the version that divides by everything:

```promql
sum(rate(snip_http_requests_total{job="snip-api",
                                  code!~"5.."}[5m]))
/
sum(rate(snip_http_requests_total{job="snip-api"}[5m]))
```

It reads `1`, or a hair under. Now cause a genuine outage — thirty percent of the
requests that *can* fail, which is what the shipped outage scenario does:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":40,"route":"mix","error_ratio":0.30}'
```

Wait five minutes for the rate window to fill, then run the same expression
again. It settles near **0.745**. Now run the version scoped to the journey that
matters:

```promql
sum(rate(snip_http_requests_total{job="snip-api",
                                  route="/l/{code}",
                                  code!~"5.."}[5m]))
/
sum(rate(snip_http_requests_total{job="snip-api",
                                  route="/l/{code}"}[5m]))
```

That one settles near **0.70**. The arithmetic behind the gap is the argument, so
do it by hand. `loadgen`'s mix is eighty percent redirects, ten percent link
details, five percent creates and five percent health checks — the weights are in
`pickRoute` in `lab/loadgen/driver.go` — and only redirects and creates are
eligible to be failed. So eighty-five percent of the traffic is exposed to a
thirty percent failure rate: 0.30 × 0.85 = 0.255, and 1 − 0.255 = 0.745. The
fifteen percent that cannot fail has quietly bought you four and a half points of
apparent availability during an outage.

Four and a half points sounds survivable. It is not, because the number is not
stable: it depends on how often your orchestrator probes, a setting in a file
nobody associates with reliability. Turn the liveness probe from every ten
seconds to every second and your measured availability improves without a line of
code changing. An indicator you can improve by probing yourself more often is not
an indicator.

So the exclusion list is **part of the definition**, not tidying-up done
afterward, and it is written down in the same place as the target — because that
is precisely where teams cheat later, usually without noticing. Reset the
injector before moving on:

```bash
curl -s -XPOST http://localhost:8089/chaos/reset
```

!!! jargon "SLI, SLO, SLA"
    An **SLI** is a number you measure: good events over valid events. An **SLO**
    is a target you set for that number — a promise you make to yourself. An
    **SLA** is a promise you make to a customer, with money attached: it is what
    happens when users are unhappy enough that you have to compensate them. Most
    services should have SLIs and SLOs. Very few need an SLA.

Which indicator to pick depends on what kind of thing you are running. The
standard menu is short enough to memorize:

| Service type | Indicators worth measuring |
|---|---|
| Request-driven | Availability, latency, quality |
| Pipeline | Freshness, correctness, coverage |
| Storage | Durability |

Each of those is the same shape: a proportion of valid things that were good.
*Availability* is the proportion of valid requests served successfully; *latency*
the proportion served faster than a threshold — not "the p99", which is a
different kind of number entirely; *freshness* the proportion of data updated
recently enough; *coverage* the proportion of input processed at all. Snip is
request-driven, so it gets availability and latency.

## Two SLOs for Snip

Create `lab/docs/SLO.md`. It is a document, not code, and it is short on purpose:
a definition you cannot hold in your head is one you will not use at three in the
morning.

Start with the journey. Someone follows a short link. `GET /l/{code}` either
sends them where they were going, quickly, or it does not. Everything else Snip
does is either not user-facing or not what the service is *for*. Both objectives
are scoped to that one route.

```text
SLO 1 — Availability
  99.5 % of valid GET /l/{code} requests do not fail,
  over a rolling 30 days.

  Good  snip_http_requests_total{job="snip-api",
          route="/l/{code}", code!~"5.."}
  Valid snip_http_requests_total{job="snip-api",
          route="/l/{code}"}
  Budget 0.5 % of requests = 216 minutes in 30 days
```

```text
SLO 2 — Latency
  99 % of valid GET /l/{code} requests complete in under
  300 ms, over a rolling 30 days.

  Good  snip_http_request_duration_seconds_bucket{
          job="snip-api", route="/l/{code}", le="0.3"}
  Valid snip_http_request_duration_seconds_count{
          job="snip-api", route="/l/{code}"}
  Budget 1 % of requests slower than 300 ms
```

Three decisions in there deserve a sentence each.

**A 404 is a good event.** A short code that does not exist is Snip answering
correctly. The visitor is disappointed, but the service did its job, and counting
404s as failures makes every expired link burn budget that should have been spent
on deploys. Only a `5xx` is Snip failing.

**Availability and latency are two SLOs, not one.** It is tempting to define
"good" as `2xx or 3xx AND faster than 300 ms` and have a single number. Resist
it. A fast 500 and a slow 302 are different failures with different fixes, and
rolling them together means the one number goes down and you learn nothing. There
is a sharper reason too: a fast failure makes your latency numbers look *better*.
Fail every request in four milliseconds and your latency SLI is perfect.

**Nothing about the fault injector is excluded.** Requests carrying
`X-Snip-Fail-Ratio` or `X-Snip-Delay-Ms` count exactly like any other. An SLO
that quietly ignores your own fault injection reads healthy through every
exercise in this chapter and the next, and teaches you to trust a rigged number.

Then the exclusion list, in the same file, with a reason on every line:

| Excluded | Why |
|---|---|
| `route="/healthz"` | Liveness probes. Nobody is having a bad day when one fails. |
| `route="other"` | Bots and scanners. Their 404s are correct behavior. |
| `route="/"`, `/links`, `/links/{code}` | Real traffic, different journey. Give them their own SLO. |
| `/metrics` | Never instrumented. Scraping is not user traffic. |

Write a name next to the document, too. The shipped `docs/SLO.md` says the owner
is whoever is on call for Snip and that it is reviewed monthly, at the alert
review Chapter 19 set up. An unowned SLO is a wish with a table in it.

### SLO is not SLA

An SLA is a contract: below the number, money moves. An SLO is internal, and the
only thing it moves is your own decisions about what to ship. The rule that
follows is short and non-negotiable: **your SLO must be strictly stricter than
your SLA.** If the contract promises 99.9 %, the internal target is 99.95 %, so
that you run out of internal budget while there is still room to react — and not
while on the phone with a customer. Snip has no SLA at all, which is the normal
case and the reason its internal target can be chosen honestly rather than
defensively.

## Choosing the window

An SLI on its own is instantaneous. "99.5 % of requests succeed" is meaningless
until you say *over what period*: 99.5 % over five minutes and 99.5 % over a year
are wildly different promises.

Two shapes are available. A **rolling window** — the last thirty days,
recomputed continuously — tracks what users have actually experienced recently. A
**calendar window** — this month, this quarter — lines up with business
reporting. Prefer rolling for the objective, and summarize on calendar boundaries
when somebody needs a report.

Calendar months are worse than they look, for three reasons. They forgive: an
outage at 23:00 on the 31st is wiped out at midnight, so the day you should be
most careful is the day with the most slack. They are unequal: February gives you
ten percent less budget than January while the target claims to mean the same
thing. And they are awkward to compute, because a PromQL range selector is a
duration, not a calendar unit — `[30d]` is thirty times twenty-four hours, and
there is no `[1month]`.

Which leaves the choice between twenty-eight days and thirty, and it is not
cosmetic. Four weeks is a genuinely good window, and the one Google's own SRE
material recommends as the balanced general-purpose choice: it contains exactly
four of every weekday, so a service with a weekly rhythm is compared against
itself. The trap is what else moves when you choose it. Sloth — a generator that
writes SLO rule files for you, and which Chapter 21 introduces properly — ships
two stock configurations, `google-30d.yaml` and `google-28d.yaml`, identical
except for the period: same budget percentages, same window sizes. The alerting
thresholds are derived from the period at generation time, so the factor scales
with it. The same catalogue over 672 hours instead of 720 gives **13.44, 5.6, 2.8
and 0.933** where thirty days gives 14.4, 6, 3 and 1. Pick a 28-day window, copy
the famous four numbers out of a blog post, and every threshold you have is about
seven percent too permissive. That is arithmetic you can redo yourself, and
Chapter 21 derives all eight of those numbers from one formula.

This lab uses a rolling thirty days, and says so in the file, because it makes the
budget arithmetic land on numbers a person can hold: thirty days is 43,200
minutes.

## Choosing the target, in minutes

Nines are a terrible unit for a decision. Minutes are a good one. Multiply the
allowed failure fraction by the window and the target stops being an aspiration:

| Target | Budget over 30 days | Budget over 28 days |
|---|---|---|
| 99 % | 432 min (7 h 12 m) | 403.2 min |
| 99.5 % | **216 min (3 h 36 m)** | 201.6 min |
| 99.9 % | 43.2 min | 40.32 min |
| 99.95 % | 21.6 min | 20.16 min |
| 99.99 % | 4.32 min | 4.032 min |

Read the bottom two rows as an operator rather than as a marketer. At 99.99 % you
may be unavailable for four minutes and nineteen seconds a month — less than one
careless deployment, and less than one container restart that takes its time
draining connections. Committing to it means committing to an engineering
program: redundancy, automated rollback, staged deploys. Each additional nine
costs roughly ten times more work than the one before.

So pick the target from measurement, not from aesthetics, and choose the loosest
number that keeps users happy. If you are running at 99.4 % today, promising
99.99 % produces a budget that is gone by the fourth of the month, a policy
nobody can follow, and a set of alerts everyone mutes. And 100 % is never valid:
a zero budget means you can never deploy, never upgrade a dependency, never
restart anything.

Snip gets 99.5 %. That is 216 minutes of total failure in thirty days, generous
by the standards of a payment system and about right for a link shortener on a
laptop. The latency target is 99 % — one request in a hundred is allowed to be
slow — and 300 ms is the boundary because Chapter 10 put a bucket there.

### The budget is a currency

Here is the flip that makes all of this useful, and the part most teams never
make. The error budget is not a line you stay away from. It is an amount of
unreliability you are **entitled to spend**. Those 216 minutes buy deploys,
dependency upgrades, schema migrations, a load test against the real thing, and
the occasional honest mistake. A month that ends with 100 % of the budget
untouched was not an excellent month. It was a conservative one: something
shippable did not ship, and the cost of that is invisible precisely because
nothing broke.

That reframing converts an SLO from a stick into a decision procedure. Budget
left means ship. Budget gone means stop shipping and fix things. Neither is a
punishment, and the number that decides between them is the one this chapter is
about to put on a dashboard.

## A latency SLO is a fraction, never a quantile

Now the rule the chapter turns on, and the single most common way a latency
objective is written wrongly. The tempting form is the one everybody reaches for
first, because it reads like English: *p99 latency must be under 300 ms.* In
PromQL that is a comparison against `histogram_quantile`. Try it, with the lab
healthy:

```promql
histogram_quantile(0.99,
  sum by (le) (rate(snip_http_request_duration_seconds_bucket{
    job="snip-api", route="/l/{code}"}[5m]))) < 0.3
```

One element comes back, labeled `{}`, carrying a duration comfortably under
`0.3` — a redirect served out of the cache is fast, which is the only reason the
comparison returns anything at all. That looks like success. Now give every
redirect an extra 400 ms:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","extra_latency_ms":400}'
```

Give it five minutes and run the same expression:

!!! trap "The objective that disappears when it is violated"
    ```text
    Empty query result
    ```

    A bare comparison in PromQL **filters**; it does not return true or false.
    When the p99 is under 300 ms you get the p99 back. When it is over, the
    element is removed and the result is empty — and an empty result is not a
    zero, as Chapter 16 showed at length. Written as an alert, this expression is
    quiet exactly when the service is breaking its objective. Written on a
    dashboard it draws a line that vanishes during an incident and looks like a
    broken query.

That is the shallow problem, and `bool` would fix it. The deep problems have no
fix, and they are why this form is not merely awkward but unusable:

**A quantile has no count of good events.** The result is a duration — no
numerator, no denominator, nothing to build a budget out of. You cannot ask "how
many requests were too slow this month" of a millisecond figure.

**A quantile cannot be aggregated.** Chapter 10 established this: you cannot
average the p99 of two replicas and get the p99 of both. So you cannot combine
windows, cannot combine services, and — the part that matters for Chapter 21 —
cannot compute how fast the budget is being consumed, because that computation is
arithmetic on ratios.

The correct form asks the question a waiting person actually has, which is not
"what is the ninety-ninth percentile" but "did my page arrive fast". It is
Chapter 10's bucket ratio:

```promql
sum(rate(snip_http_request_duration_seconds_bucket{
      job="snip-api", route="/l/{code}", le="0.3"}[5m]))
/
sum(rate(snip_http_request_duration_seconds_count{
      job="snip-api", route="/l/{code}"}[5m]))
```

Healthy, that reads `1` or a hair under. With 400 ms of injected delay it drops
close to `0`, and — this is the point — it *keeps returning a number*. It is good
events over valid events, in exactly the same shape as the availability SLI, and
everything you can do to one you can do to the other.

The same question without the string literal, using the function Chapter 10
introduced:

```promql
histogram_fraction(0, 0.3,
  sum by (le) (rate(snip_http_request_duration_seconds_bucket{
    job="snip-api", route="/l/{code}"}[5m])))
```

The two agree, because `0.3` is a real boundary of this histogram.
`histogram_fraction` is the safer form to type, because no `le` value appears in
it at all.

!!! pitfall "An le of 0.30 matches nothing, silently"
    Prometheus 3 normalizes `le` label values to a canonical float form on
    ingestion. The bucket is stored as `le="0.3"`. A selector for `le="0.30"` — or
    `le=".3"`, or `le="0.300"` — matches no series, the numerator is empty, the
    whole division is empty, and the panel reads *No data* while the query itself
    is perfectly valid. It is why the lab's rule file carries a comment saying the
    value is `"0.3"` and nothing else.

Put the injector back before continuing:

```bash
curl -s -XPOST http://localhost:8089/chaos/reset
```

## Two ways to count: requests or minutes

There is a second choice hiding inside "good events over valid events": what is
an event?

**Request-based.** Every request counts equally. A thousand failures during the
afternoon peak weigh a thousand times one failure at 3 a.m. This is what the
Prometheus tooling ecosystem implements, it costs two counters, and it is what
this lab uses.

**Window-based.** Every *minute* counts equally, and a minute is "good" if its
error ratio stayed under some threshold. A twenty-minute outage costs twenty
minutes whether it happened at noon or at dawn. This matches how humans and
contracts talk — "43 minutes of downtime a month" is a window-based sentence — and
it needs a second threshold you have to justify.

Writing a window-based indicator is where the `bool` modifier from Chapter 9,
"Ratios, Arithmetic, and the Series That Isn't There", earns its place. Start
with the obvious attempt:

```promql
sum(rate(snip_http_requests_total{job="snip-api",
      route="/l/{code}", code=~"5.."}[1m]))
/
sum(rate(snip_http_requests_total{job="snip-api",
      route="/l/{code}"}[1m]))
<= 0.01
```

That does not return 1 or 0. It returns the ratio itself on good minutes and
nothing at all on bad ones — the same filtering behavior that made the quantile
comparison disappear. Add `bool` and it becomes the indicator you meant:

```promql
(
  sum(rate(snip_http_requests_total{job="snip-api",
        route="/l/{code}", code=~"5.."}[1m]))
  /
  (sum(rate(snip_http_requests_total{job="snip-api",
        route="/l/{code}"}[1m])) > 0)
  <= bool 0.01
) or vector(1)
```

Now every evaluation yields exactly one sample: `1` for a good minute, `0` for a
bad one. The `> 0` on the denominator is pulling as much weight as the `bool`.
Snip pre-initializes its counters, so an idle minute leaves both sides of the
division present and valued zero; unguarded, `0 / 0` is `NaN`, `NaN <= bool 0.01`
is false, and the quietest minute of the night gets recorded as a *bad* one.
Guarded, the division is empty there, `or vector(1)` supplies the `1`, and a
silent minute is not a bad minute. Record that and the thirty-day indicator is
`avg_over_time` over the recorded series, which reads as "the fraction of minutes
that were good".

The specification language OpenSLO requires this choice, under the name
`budgetingMethod`: `Occurrences` for the request-based form, `Timeslices` for the
window-based one, and a third, `RatioTimeslices`, that this lab does not need.
Reach for time slices when your service has long idle periods that would let a
real outage hide behind low traffic. Snip is busy every minute of every day, so
it uses occurrences.

## Recording the ladder

Everything so far has been definitions. Now they become series.

Open `lab/prometheus/rules/snip-recording.yml` — Chapter 15's file, which at
`ch19` holds one group — and add a second group below it, `snip-slo`, with the same
`interval: 30s`. It records the same two indicators at eight averaging windows:
`5m`, `30m`, `1h`, `2h`, `6h`, `1d`, `3d` and `30d`.

Eight windows sounds excessive for two numbers. The reason is Chapter 21: the
alerts it builds compare a long window against a short one, and both sides have
to already exist as series before a rule can reference them.

Here is the first rung in full. Every other availability rung is this expression
with the window swapped:

```yaml
  - name: snip-slo
    interval: 30s
    rules:
      - record: job:snip_sli_availability:ratio_rate5m
        expr: |
          (
            sum by (job) (
              rate(snip_http_requests_total{job="snip-api",
                                            route="/l/{code}",
                                            code!~"5.."}[5m])
            )
            or
            0 * sum by (job) (
              rate(snip_http_requests_total{job="snip-api",
                                            route="/l/{code}"}[5m])
            )
          )
          /
          (
            sum by (job) (
              rate(snip_http_requests_total{job="snip-api",
                                            route="/l/{code}"}[5m])
            ) > 0
          )
```

Three things in there are not decoration.

**It records the success ratio, not the failure ratio.** Much of the published
SLO material records errors, because Chapter 21's alerting arithmetic is written
in terms of errors and one minus the other is a cheap conversion. Recording the
success side keeps the *name* honest: `job:snip_sli_availability:ratio_rate1h`
really is the availability over the last hour, and it reads correctly on a gauge.
Know that both conventions exist and that they are inverses — Grafana's own SLO
feature wants a success ratio, Sloth emits an error ratio — because a query
copied from one world into the other is wrong by everything.

**`or 0 *` on the numerator** is Chapter 9's fix for a series that is not there.
With no failures at all the `code!~"5.."` selector is fine, but its mirror image
in the error convention would be missing entirely. Keeping the guard here costs
nothing and means the rung has the same shape as every other ratio in the file.

**`> 0` on the denominator** is the one that will save you, for the reason the
time-slice indicator already showed: all twelve pre-initialized combinations sit
still when traffic stops, both sides of the division are 0, and `0 / 0` is a
stored `NaN` that compares false against everything and looks like data.
Filtering the denominator makes an idle window produce **no sample** at all,
which every downstream function knows how to skip. That is not theoretical here,
and the next rule is why.

```yaml
      - record: job:snip_sli_availability:ratio_rate30d
        expr: |
          avg_over_time(
            job:snip_sli_availability:ratio_rate5m{job="snip-api"}[30d]
          )
```

The thirty-day rung averages the five-minute rung instead of running a `rate()`
over thirty days of raw counters. A 30-day range query over raw data, every
thirty seconds, is the one rule in this file that could genuinely hurt a laptop.
Rules inside one group evaluate in order, so the five-minute rung has already
been written when this one reads it.

Two honest caveats. It is an average of averages, which is exactly right only
while traffic is steady — a five-minute window carrying two requests counts as
much as one carrying six thousand. And `avg_over_time` propagates `NaN`: one
unguarded idle window would leave this rung `NaN` for the following thirty days,
making the budget gauge, the burn-down panel and every comparison built on them
silently meaningless. Absent beats wrong, which is what the `> 0` buys.

The eight latency rungs are the same ladder built on the bucket ratio. Their
guard is there for a slightly different reason, and the file says so in a
comment: histograms are *not* pre-initialized — a zero-count histogram would be
sixteen series saying nothing — so a service that has never served a redirect
produces no denominator at all, and one that served some and then went quiet
produces a denominator frozen at its last value. The second case is the `0 / 0`.
The first is absent outright, which is also fine.

```yaml
      - record: job:snip_sli_latency:ratio_rate5m
        expr: |
          (
            sum by (job) (
              rate(snip_http_request_duration_seconds_bucket{
                job="snip-api", route="/l/{code}", le="0.3"}[5m])
            )
            or
            0 * sum by (job) (
              rate(snip_http_request_duration_seconds_count{
                job="snip-api", route="/l/{code}"}[5m])
            )
          )
          /
          (
            sum by (job) (
              rate(snip_http_request_duration_seconds_count{
                job="snip-api", route="/l/{code}"}[5m])
            ) > 0
          )
```

And finally the number this chapter exists to produce:

```yaml
      - record: slo:error_budget_remaining:ratio30d
        expr: |
          clamp_min(
            1 - (
              (1 - job:snip_sli_availability:ratio_rate30d{job="snip-api"})
              / 0.005
            ),
            0
          )
```

Read it from the inside. `1 - availability` is the observed failure ratio over
the window. Divide by `0.005` — the budget, which is `1 - 0.995` — and you have
the fraction *consumed*. One minus that is the fraction remaining: `1` is
untouched, `0` is gone. `clamp_min(v, 0)` replaces anything below zero with zero,
because "how far past empty" is not a number anybody acts on differently, and a
gauge that swings to −3 is a gauge nobody reads. Overspend is still visible;
Chapter 21 is where you see it.

Check the file and reload:

```bash
make check
```

```bash
make reload
```

`make check` runs `promtool check rules` over everything in
`prometheus/rules/`. The line you are looking for:

```text
Checking /etc/prometheus/rules/snip-recording.yml
  SUCCESS: 22 rules found
```

Five from `snip-red`, seventeen from `snip-slo`: eight availability rungs, eight
latency rungs, and the budget. Give Prometheus a minute, then query
`job:snip_sli_availability:ratio_rate5m` on the Query page. A single series,
value near `1`.

### One alert collapses to one line

Chapter 16 wrote `SnipLatencyObjectiveAtRisk` with the whole bucket ratio spelled
out inline, because the recording rules for it did not exist yet. They do now, so
the expression loses eleven of its twelve lines:

```yaml
      - alert: SnipLatencyObjectiveAtRisk
        expr: |
          1 - job:snip_sli_latency:ratio_rate30m{job="snip-api"} > 0.01
        for: 10m
```

Same number, same arithmetic, computed once. Leave the two copies in place and
they will drift the first time somebody adjusts the route filter on one of them —
and then the dashboard and the pager disagree about whether you are in trouble,
each telling the truth about a different expression. That is the failure a
recording rule exists to prevent. While you are in the file, point
`SnipSLIAbsent`'s `dashboard_url` at `/d/snip-slo` instead of `/d/snip-red`: the
indicator it watches now has a dashboard of its own.

## Proving the guard before you need it

The `> 0` on every denominator is a claim about something that happens only when
traffic stops. You could wait for an idle lab and check. Chapter 18, "Testing
Alerts Before They Page You", built a better habit: assert it in
`lab/prometheus/rules/tests/snip-alerts_test.yml` and let `promtool` run the
clock.

That file already loads `snip-recording.yml`, so add `snip-slo` to
`group_eval_order`, between `snip-red` and `snip-alerts`, and add an eighth case.
It feeds twenty minutes of traffic and then stops — the counters hold their last
value rather than disappearing, exactly as the real service behaves:

```yaml
  - name: an idle window writes no SLI sample rather than a NaN
    interval: 30s
    input_series:
      - series: 'snip_http_requests_total{job="snip-api",
                 instance="snip-api-1", env="lab", route="/l/{code}",
                 method="GET", code="302"}'
        values: "0+90x40 3600x40"
      - series: 'snip_http_requests_total{job="snip-api",
                 instance="snip-api-1", env="lab", route="/l/{code}",
                 method="GET", code="500"}'
        values: "0+10x40 400x40"
```

`0+90x40` is Chapter 18's expansion syntax: start at 0, add 90 each step, forty
more samples after the first — forty-one samples of traffic, then `3600x40` is
forty-one that never move. Twenty minutes of ten percent errors, then silence.

Then the assertions, read at `40m`, twenty minutes into the silence:

```yaml
    promql_expr_test:
      - expr: 'job:snip_sli_availability:ratio_rate5m{job="snip-api"}'
        eval_time: 40m
        exp_samples: []
      - expr: 'job:snip_sli_availability:ratio_rate30d{job="snip-api"}
               > bool 0.85'
        eval_time: 40m
        exp_samples:
          - labels: '{job="snip-api"}'
            value: 1
```

The first asserts **absence**, which is rarer than asserting a value and no less
important: the five-minute rung must produce no sample, not a zero and not a
`NaN`. The second asserts that the thirty-day rung survived the gap —
`avg_over_time` skipped the missing samples and averaged the twenty minutes that
really happened. With a `NaN` anywhere in that range the comparison would be
false and the assertion fail.

```bash
make test-rules
```

Delete the `> 0` from the two denominators and run it again: both assertions fail,
the first because the rung now carries `NaN` instead of nothing. The bug that case
catches is otherwise invisible for thirty days — which is exactly why you must
not leave it in place. Put both guards back
(`git checkout -- prometheus/rules/snip-recording.yml` if you would rather not
retype them) and run `make test-rules` once more. It has to read `SUCCESS` for
all eight cases before you go on: everything after this point reads the
thirty-day rung, and an unguarded denominator writes a `NaN` into it at the first
idle window and poisons it for a month.

## The budget, on a screen

Add `lab/dashboards/snip-slo.json`, provisioned the same way as every other
dashboard in the lab, at `http://localhost:3000/d/snip-slo`. Its first row,
**Compliance — rolling 30 days**, is this chapter's and holds six panels. The row
under it, **Burn rate — four tiers**, is Chapter 21's: its six panels read the
same rungs and will already draw, but the thresholds painted on them — 14.4, 6, 3
and 1 — are numbers you have not derived yet. A third row, **The recording rules
underneath**, ships collapsed and holds three of Chapter 15's panels: the SLI
numerator and denominator, the recorded error ratio by route, and the p99 from
recorded buckets. Expand it when you want to see the counts under the ratio.

**Availability SLI (30d)** and **Latency SLI (30d)** are Stat panels with instant
queries on `job:snip_sli_availability:ratio_rate30d` and
`job:snip_sli_latency:ratio_rate30d`. Unit `percentunit`, four decimals, and a
threshold step at the objective — `0.995` and `0.99` — so the number turns green
when you are meeting it. The minimum is set near the objective, `0.98` and
`0.95`, rather than `0`: every interesting movement happens in the last few
percent of the range, and a stat scaled from zero never appears to change.

**Error budget remaining (30d)** is a Gauge on
`slo:error_budget_remaining:ratio30d`, unit `percentunit`, `min: 0`, `max: 1`. A
gauge without explicit bounds means nothing — the rule from Chapter 13,
"Dashboard Mechanics: Intervals, Panels and Variables" — and here the bounds are
the definition rather than a guess. Its steps at 0.75, 0.5 and 0.25 are a coarse
four-color band and nothing more: only the 0.5 step lines up with a gate in the
policy this chapter ends with, because the gauge reads *remaining* while the
policy is written in *spent*.

**Budget spent, in minutes** is the same fact in the unit an on-call engineer
thinks in, and it is the panel whose colors really are the policy:

```promql
(1 - slo:error_budget_remaining:ratio30d) * 0.005 * 30 * 24 * 60
```

`0.005 × 43,200` is 216, so this reads out of a possible 216 minutes. Unit `m`,
maximum 216, and steps at 108 and 194 — the 50 % and 90 % gates, in the unit the
gates are argued in. Percentages are for reasoning; minutes are for explaining to
somebody else why you are not shipping today.

One honesty note about that conversion. Snip's budget is counted in requests, not
minutes, so 216 minutes means *216 minutes' worth of average traffic failing
completely* — the two agree only while traffic is flat. Snip is busy at a steady
rate around the clock, so it is close enough to argue with; on a service with a
daily peak it is not, and a peak-hour outage costs far more budget than the clock
says. If minutes are the unit your contracts are written in, measure in minutes,
which is the window-based indicator rather than this one.

The last two panels are time series. **Availability SLI across every window**
draws five rungs at once — 5m, 1h, 6h, 1d, 30d — and that panel is the argument
for recording all eight: short windows are jumpy and honest about right now, long
ones smooth and honest about the month. **Error budget burn-down** draws
`slo:error_budget_remaining:ratio30d` alone. A healthy month is a gentle downward
slope that reaches the end of the window above zero; a cliff is an incident. The
*slope* of that line is what Chapter 21 turns into a single number and alerts on,
so spend a moment looking at it now.

## Burn 40 percent of it on purpose

A gauge you have never seen move is a gauge you do not believe. Spend some
budget.

First, read the current value on the dashboard, or:

```promql
slo:error_budget_remaining:ratio30d
```

Then find out how much history that thirty-day average actually covers, which on
a lab that came up this afternoon is not thirty days:

```promql
count_over_time(job:snip_sli_availability:ratio_rate5m[30d])
```

Call that answer **N**. It is the number of samples the average is over, one
every thirty seconds. Now the arithmetic, in three steps.

The rung is recorded every 30 seconds over a 5-minute window, so each second of
an outage falls inside ten consecutive evaluations — 300 seconds of window
divided by a 30-second step. Each of those ten sees a slice of the outage, so an
outage of `T` seconds at error ratio `E` adds `E × 10T / 300`, which is
`E × T / 30`, to the *sum* of the recorded ratios. The thirty-day rung is the
*average* of N such samples, so it rises by `E × T / (30 N)`. Divide that by the
0.005 budget and you have the fraction spent. Set the fraction to 0.4 and solve
for the time:

```text
T = 0.4 × 0.005 × 30 × N / E   seconds

at E = 0.30:   T = N / 5 seconds
```

If Prometheus has been recording for three hours, N is about 360 and forty
percent of your monthly budget costs you **seventy-two seconds** of outage. Run
it:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":40,"route":"/l/{code}","error_ratio":0.30}'
```

Watch the gauge, not the clock — the five-minute rate window smears the effect
over the following few minutes, and the gauge is the number you steer by. When it
reaches roughly 0.6, stop:

```bash
curl -s -XPOST http://localhost:8089/chaos/reset
```

Two things to notice afterward. The gauge does not spring back when the injector
stops: budget is spent, not borrowed, and those failures stay inside the window
until they age out of it. But on a young lab it creeps back up faster than it
should, because every new healthy sample dilutes an average taken over a few
hundred samples rather than a few hundred thousand.

!!! warning "Your thirty-day window is three days old"
    A rolling 30-day SLO computed on a TSDB that has existed since Tuesday is a
    thirty-day window over mostly nothing. The ratios are correct — 99.5 % of what
    happened is still 99.5 % of what happened — but the absolute minutes are not,
    and the budget burns implausibly fast whenever the injector runs. This is an
    artifact of the lab, not of SLOs, and you have two honest options: read the
    *ratios* and ignore the minutes until the window fills, or backfill history.

## Thirty days you did not live through

The lab ships a fixture for the second option: thirty days of invented Snip
counters, sampled every thirty minutes, with two incidents in the month so the
budget is visibly spent rather than a flat 100 %.

One edit has to land before the import, or the import is six megabytes of wasted
disk. Prometheus does not store samples one at a time. It writes them into
immutable directories called **blocks**, each covering a fixed stretch of time,
and a housekeeping pass called **compaction** periodically merges small blocks
into larger ones — and drops any block whose whole time range is older than the
retention setting. Chapter 25, "Storage, Retention, Backups and Locking the
Door", takes the lid off both; here you need only the consequence.

**Prometheus keeps fifteen days by default.** Import a month into a server
configured for a fortnight and half of it is gone within hours — silently, with
no error, while a rung named `:ratio_rate30d` goes on calling itself thirty days.
Retention shorter than the longest window you query does not fail. It quietly
answers a different question.

So add one flag to the `prometheus` command in `lab/compose.yaml`:

```yaml
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.path=/prometheus
      - --web.enable-lifecycle
      - --config.auto-reload
      - --storage.tsdb.retention.time=45d
```

Forty-five days is the longest window you query, plus headroom. A flag change
needs the container recreated rather than restarted, so `make up` again, then
confirm the server took it rather than assuming:

```bash
docker compose logs prometheus | grep retention
```

One line comes back, behind the usual timestamp and level fields, and it is the
whole confirmation:

```text
TSDB retention updated duration=45d
```

!!! iou "IOU — chapter 25"
    That is the wrong place for the setting, and it is there on purpose. The
    `--storage.tsdb.retention.*` flags are marked deprecated in Prometheus
    3.13.1's own help text, they are not re-read on a configuration reload, and a
    `storage:` block in `prometheus.yml` beats them silently if both are set. The
    binary accepts the flag without complaint — no warning is printed, so do not
    go looking for one. They are also what you will find in almost every stack you
    inherit, which is the only reason this lab writes one. Chapter 25 makes you
    read the deprecation notice, do the disk arithmetic that chooses the number,
    and move the setting where it belongs. Until then the flag is honest about the
    one thing that matters here: the window is forty-five days, not fifteen.

Now the import, which is two targets and has to be in this order. The generator
and both targets are shipped rather than typed, so if you are building along from
`ch19` this is the moment to take them across, along with the chapter's verify
script:

```bash
git checkout ch20 -- fixtures/generate-history.py \
  Makefile scripts/verify-ch20.sh
```

```bash
make history
```

```bash
make backfill
```

`make history` regenerates `fixtures/history.om` through the pinned Python image
so the data ends now rather than whenever the file was committed — an OpenMetrics
file carries absolute timestamps, and a fixture generated in July is July data
forever. Skip it and `make backfill` refuses to run: it reads the last timestamp
in the file and rejects anything older than seven days, rather than writing
blocks the next compaction would delete. `make backfill` then runs
`promtool tsdb create-blocks-from openmetrics` inside the Prometheus container,
writing blocks straight into the data directory, and restarts Prometheus so it
picks them up.

The fixture lands at **99.35 %** under 300 ms every time, and somewhere between
**99.53 %** and **99.68 %** availability depending on the hour you regenerate:
its two scripted incidents land at the same hour of day as the moment of
generation, and the traffic curve is diurnal, so an incident across the afternoon
peak costs far more requests than the same one at dawn. Both objectives are met
either way.

Read that spread the way this chapter has taught you to. Those 0.15 points of
availability sound like nothing, and against a 0.5 % budget they are the
difference between **36 %** of the budget left and **7 %** — which is past the
90 % gate in the policy this chapter ends with, and therefore a feature freeze. A
tenth of a point is a fifth of your month. The ladder cannot show you this,
because the recorded rungs only know what they have evaluated, so ask the raw
counters:

```promql
1 - sum(increase(snip_http_requests_total{job="snip-api",
      route="/l/{code}", code=~"5.."}[30d]))
  / sum(increase(snip_http_requests_total{job="snip-api",
      route="/l/{code}"}[30d]))
```

Be clear about what the backfill does and does not buy you:

- It gives the **counters** a month of history. `increase(...[30d])` over the raw
  series works, and so do the `1d` and `3d` rungs of the ladder, which read those
  counters directly.
- It does **not** retroactively evaluate your recording rules.
  `job:snip_sli_availability:ratio_rate5m` is computed forward from the moment the
  rule was loaded and nowhere else, so the thirty-day rung still averages only
  what it has seen.
- The fixture's resolution is thirty minutes, not fifteen seconds — thirty days at
  the real scrape interval would be a 700 MB file — so no range shorter than an
  hour resolves over the historical region. `rate(...[5m])` returns nothing there.

Which is why the honesty box stands even with the fixture in place. The lab can
give you a month of counters; it cannot give you a month of having been running.

## A policy one person can follow

The last artifact is the one that gives the number teeth. Without it the gauge is
decoration: everybody looks at it, nobody changes what they do. Create
`lab/docs/error-budget-policy.md`, one page, four gates.

| Budget spent | What changes |
|---|---|
| under 50 % | Nothing. Ship. |
| 50 % | Say it out loud. Redirect-path changes get a second reader. |
| 90 % | Feature work on the redirect path stops; next merge is a reliability fix. |
| 100 % | Freeze the redirect path: only fixes for the failure that spent the budget. |

The shipped file carries a third column, **Who decides**, because on a team of two
or three the hardest part of a gate is not the number but who may invoke it
without calling a meeting. Alone, every cell in that column reads *you* — which
is why it can leave the table and not the thinking.

Three design notes, all of which come from policies that failed.

**Scope the freeze.** The gates apply to the redirect path, not to the
repository. A freeze that stops all work is a freeze that gets ignored the second
time it happens, and then you have neither the work nor the policy.

**Say when it lifts.** For Snip: when the rolling window recovers on its own, or
when a post-incident review is written and its first action item has shipped,
whichever is later. A freeze with no exit condition is a hostage situation.

**Change the target only when you are calm.** If the budget runs out every month
and nothing is actually broken, the target is wrong or the indicator is measuring
the wrong thing. Both are an edit to `docs/SLO.md` — proposed with the
measurement that motivates it, and never mid-incident. Loosening a target to stop
an alert firing during an outage is how a team ends up with an SLO that means
nothing.

For a team of one the whole policy compresses to a sentence worth writing into
the repository with a date on it: *when the budget is gone, the next thing I work
on is reliability, not features.* The pre-commitment matters far more than the
mechanism, because writing it down is what gets the decision made by a rested
person in daylight rather than a tired one at midnight who badly wants to ship.

!!! selfcheck "Self-check"
    Run `make verify-ch20` on a stack that came up a minute ago and it reports
    **6 passed, 17 failed**. That is the correct answer, not a defect: no rule has
    evaluated yet, so no rung has a value to return. The six that pass are the two
    documents, the dashboard and the raw histogram bucket — not one of them a
    recorded series. Leave the lab running for ten minutes and run it again. That,
    and not the backfill, is what makes the ladder return values: backfill changes
    what the longest rungs *say*, but it cannot make a recorded rung exist,
    because recording rules only ever evaluate forward. On a lab that has been up
    a while it walks all sixteen rungs, checks that the budget is a ratio, and
    checks that both documents exist and say what they should:

    ```text
    == verify-ch20 ==
       expected runtime: about 20 s

    PASS job:snip_sli_availability:ratio_rate5m returns a value
    PASS job:snip_sli_latency:ratio_rate5m returns a value
    PASS job:snip_sli_availability:ratio_rate30m returns a value
    PASS job:snip_sli_latency:ratio_rate30m returns a value
    PASS job:snip_sli_availability:ratio_rate1h returns a value
    PASS job:snip_sli_latency:ratio_rate1h returns a value
    PASS job:snip_sli_availability:ratio_rate2h returns a value
    PASS job:snip_sli_latency:ratio_rate2h returns a value
    PASS job:snip_sli_availability:ratio_rate6h returns a value
    PASS job:snip_sli_latency:ratio_rate6h returns a value
    PASS job:snip_sli_availability:ratio_rate1d returns a value
    PASS job:snip_sli_latency:ratio_rate1d returns a value
    PASS job:snip_sli_availability:ratio_rate3d returns a value
    PASS job:snip_sli_latency:ratio_rate3d returns a value
    PASS job:snip_sli_availability:ratio_rate30d returns a value
    PASS job:snip_sli_latency:ratio_rate30d returns a value
    PASS slo:error_budget_remaining:ratio30d is in [0,1]
         92.4% of the 30-day error budget is left
    PASS job:snip_sli_availability:ratio_rate30d is between 0 and 1
    PASS job:snip_sli_latency:ratio_rate30d is between 0 and 1
    PASS the le="0.3" bucket the latency SLI needs
    PASS docs/SLO.md exists
    PASS docs/error-budget-policy.md exists
    PASS docs/SLO.md states an exclusion list
    PASS docs/SLO.md names both objectives (99.5%, 300 ms)
    PASS the SLO dashboard is provisioned at /d/snip-slo

    ch20: 25 passed, 0 failed
    ch20 OK
    ```

    The percentage on that indented line depends on your lab's history. If a rung
    still reports `got nothing, want a ratio` on a lab that has been up for hours,
    the script says where to look: that is the zero-errors hole from Chapter 9, not
    a window that is too young.

## Common mistakes

**Dividing by total instead of valid.** The most common and the most flattering.
Health checks, internal probes and bot traffic are all guaranteed-good events, so
including them raises your measured availability without improving anybody's day.
The tell is that your number improves when you add an instance or shorten a probe
interval.

**Writing the latency objective as a quantile.**
`histogram_quantile(0.99, ...) < 0.3` looks like the objective and is not one. It
filters instead of returning a value, so it vanishes when violated; it carries no
count of good events, so there is no budget in it; and it cannot be aggregated, so
nothing downstream can use it. Chapter 21 cannot build on it at all.

!!! pitfall "The exclusion list written after the fact"
    The failure mode is not omitting the list. It is adding to it during an
    incident. Something fails, somebody notices that one particular client is
    responsible for most of the failures, that client gets excluded — and the SLI
    recovers without a single user's experience changing. Every exclusion has to
    be defensible as a statement about *whose experience you are measuring*,
    written before you need it, and reviewed on a schedule rather than under
    pressure.

**Copying the target from a table.** 99.9 % is not a default. It is 43.2 minutes a
month, and if your deploy takes four minutes and you deploy weekly, a third of it
is already committed to routine work. Start from what you measure.

**Leaving the denominator unguarded.** `0 / 0` is `NaN`, `NaN` is a stored sample,
and `avg_over_time` spreads it across the whole window. One idle five-minute
stretch can leave a thirty-day figure meaningless for a month, and nothing about it
looks like an error: the gauge reads blank, every comparison against it is quietly
false, and no alert fires because no alert can. `> 0` on every denominator, every
time.

## Summary

An SLI is good events over valid events, and the second word does the work.
Writing down what "valid" excludes — and why, and before you need it — separates
a service level indicator from a number that flatters you. An SLO adds a target
and a window, and the two together define an error budget: an amount of failure
you are entitled to spend before you have to stop and fix things.

Snip now has two written objectives, seventeen recorded series that measure them,
a budget expression clamped to a readable range, a unit test that proves the
guard under it, a dashboard where the budget is a needle and a slope, and a
one-page policy that says what happens at 50, 90 and 100 percent. Chapter 21
takes the slope of that burn-down and turns it into alerts that fire in minutes
for a real outage and stay quiet for a blip.

The things to still know in six months:

- **Valid, not total.** Health checks, bots and out-of-scope clients belong in a
  written exclusion list, and that list is part of the definition.
- **State the budget in minutes.** 99.9 % over thirty days is 43.2 minutes;
  99.99 % is 4.32, less than one careless deploy. Nines hide the decision.
- **Rolling windows, not calendar months** — and if you choose twenty-eight days,
  every threshold derived from the period changes with it.
- **An SLO is stricter than any SLA you sign.** Run out of internal budget while
  there is still room to react.
- **The budget is a currency.** Ending the month with all of it unspent means you
  shipped too little, not that you did well.
- **A latency objective is a proportion of requests faster than a threshold**,
  read off a bucket boundary or from `histogram_fraction` — never a comparison
  against `histogram_quantile`, which has no good-event count, cannot be
  aggregated, and vanishes the moment it is violated.
- **Guard the denominator.** `0/0` is `NaN`, and `NaN` poisons a thirty-day
  average for thirty days.

## Exercises

!!! exercise
    **1. Defend three exclusions (warm-up).** Write the exclusion list for
    Snip's availability SLI in your own `docs/SLO.md`. Name three things you
    excluded and defend each in one line, in terms of whose experience you
    are measuring. Then name one thing you were tempted to exclude and did
    not, and say why. `make verify-ch20` greps the file for an exclusion
    list; it cannot grade your reasoning, and the reasoning is the exercise.

    **2. Nines into minutes (warm-up).** Convert 99.5 %, 99.9 % and 99.99 %
    over a rolling thirty days into minutes of budget. Check the first against
    the 216 minutes this chapter claims. Then answer honestly: which of the
    three could you personally sustain for a service you deploy by hand, and
    what would have to change for the next one up?

    **3. The same objectives over 28 days (core).** Recompute all three
    budgets for a 28-day window. State the ratio between the two sets of
    numbers as a single factor. Then write down, in one sentence, what
    Chapter 21 will need to know about that factor before it derives an
    alerting threshold — you should be able to predict that its four numbers
    move by the same factor.

    **4. The latency SLI, twice (core).** Compute the fraction of redirects
    under 300 ms two ways over the same five-minute window: the bucket ratio
    at `le="0.3"`, and `histogram_fraction(0, 0.3, ...)`. They should agree
    to at least four decimal places. Then change `le="0.3"` to `le="0.30"`
    in the first one and record exactly what you get — that output is the
    thing you need to recognize on sight.

    **5. Your policy (core).** Draft a one-page error-budget policy for a
    service you actually run. Say what happens at 50 %, at 90 % and at 100 %
    spent, who decides, what is in scope for a freeze and what is not, and
    what condition lifts it. Keep it under one page. Compare it with
    `docs/error-budget-policy.md` afterward and note every place yours is
    vaguer.

    **6. The objective you cannot build (stretch).** Write a latency SLO using
    `histogram_quantile` — a real expression, against the lab, that you would be
    prepared to put in a rule file. Then hold
    `{"rps":20,"extra_latency_ms":400}` for five minutes and run it. Write down
    the two things you cannot compute from the result: name them precisely, and
    for each one say which panel on `/d/snip-slo` could not be drawn without it.
