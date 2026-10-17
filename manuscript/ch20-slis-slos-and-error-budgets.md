# Chapter 20 — SLIs, SLOs and Error Budgets

Three weeks of notifications sit in the pager's history. Forty-seven of them woke
somebody. Forty-four turned out to be nothing: a replica restarting, a scrape that
missed once, a latency spike lasting ninety seconds at four in the morning when nobody
was awake to be inconvenienced. The three that mattered were real, and one of them
arrived twenty minutes after the first user complained.

Every rule that produced those forty-seven pages is individually defensible. You wrote
them. You can explain each one. The set is still unusable, and no amount of tuning
thresholds will fix it, because tuning a threshold requires knowing what the right
answer is — and nobody has written down what "Snip is working" means.

That sentence is the whole chapter. Not "Snip is up", which is a question about
processes. Not "errors are below 20 %", which is a number somebody picked on a Tuesday.
A written definition of working: which requests count, which ones are excluded and why,
how good is good enough, over what period, and what happens when you fall short of it.
Once that exists, "was this worth waking someone for?" becomes arithmetic instead of an
argument. Chapter 21 does the arithmetic. This chapter writes the definition, turns it
into recording rules, and puts the result on a dashboard where you can watch it move.

!!! objectives "Objectives"
    After this chapter you can:

    - Define an SLI as good events over **valid** events, and write the exclusion list
      that makes "valid" mean something.
    - Separate an SLO from an SLA, and say why the internal target must be stricter.
    - Choose a window and a target, and state the resulting budget in minutes.
    - Express a latency objective as the fraction of requests faster than a threshold,
      and say why a quantile cannot do that job.
    - Compute how much error budget is left and put it on a dashboard.
    - Write a one-page error-budget policy that a single developer could actually follow.

## Where the lab is

Everything here runs against the stack as Chapter 19, "What a Page Should Say, and Who
Watches the Watcher", left it: Snip behind the `edge` proxy, the worker, `catalog`,
`loadgen`, Prometheus, Grafana, Alertmanager and the pager, with four alerting rules in
`lab/prometheus/rules/snip-alerts.yml`, the meta-alerts and the Watchdog in
`meta-alerts.yml`, and one recording-rule group, `snip-red`, in
`lab/prometheus/rules/snip-recording.yml`. The `ch20` tag already holds what this chapter
builds — `docs/SLO.md`, the `snip-slo` ladder, the SLO dashboard and the error-budget
policy — to read along with. To build them yourself, check out `ch19` instead.

```bash
cd lab
git checkout ch20
make check
make up
make ps
```

Snip answers on `http://localhost:8080/`, Prometheus on `http://localhost:9090/`,
Grafana on `http://localhost:3000/`, and the load generator's control API on
`http://localhost:8089/`. Put the injector into a known, healthy state:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","error_ratio":0,"extra_latency_ms":0}'
```

Two things from earlier chapters are load-bearing here, and both are already running.
Chapter 15's group `snip-red` records `job:snip_sli_good:rate5m` and
`job:snip_sli_valid:rate5m` — two counts that reserved a name without defining it.
Chapter 10 built Snip's latency histogram with a bucket boundary at exactly `0.3`
seconds, and said at the time that the number came from an objective that had not been
written yet. This chapter writes it.

!!! iou "IOU from chapter 15, settled"
    Chapter 15 recorded `job:snip_sli_good:rate5m` and `job:snip_sli_valid:rate5m` and
    promised that chapter 20 would say what "good" and "valid" actually mean, why some
    events are excluded, and what to do with the ratio. All of that arrives here. The two
    recorded counts do not change; everything below is built on top of them.

## Good events over valid events

A **service level indicator**, an SLI, is one number that says whether a service is doing
the job its users care about. It is a proportion:

```text
SLI = good events / valid events
```

Read that denominator again. It is **valid**, not *total*. Almost every treatment of this
gets the word right and then quietly writes code that uses the total, and the difference
is where the whole idea either becomes honest or becomes decoration.

Snip serves six kinds of request. Only one of them is a person following a short link.
The others are the load balancer's liveness probe, the API call that creates a link, the
API call that reads a link's details, the home page, and whatever a scanner asked for
this morning. Measure "requests that did not fail" across all of those and you get a
number that mostly reports how many health checks you serve. Run the wrong version and
see for yourself. With the injector healthy, first the version that divides by
everything:

```promql
sum(rate(snip_http_requests_total{job="snip-api",
                                  code!~"5.."}[5m]))
/
sum(rate(snip_http_requests_total{job="snip-api"}[5m]))
```

It reads `1`, or a hair under. Now cause a genuine outage on the redirect path only —
30 % of redirects and creates failing, which is what the shipped outage scenario does:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":40,"route":"mix","error_ratio":0.30}'
```

Wait five minutes for the rate window to fill, then run the same expression again. It
settles near **0.745**. Now run the version scoped to the journey that matters:

```promql
sum(rate(snip_http_requests_total{job="snip-api",
                                  route="/l/{code}",
                                  code!~"5.."}[5m]))
/
sum(rate(snip_http_requests_total{job="snip-api",
                                  route="/l/{code}"}[5m]))
```

That one settles near **0.70**. The arithmetic behind the gap is worth doing by hand,
because it is the argument. The load generator's mix is 80 % redirects, 10 % link
details, 5 % creates and 5 % health checks. Only redirects and creates can be made to
fail, so 85 % of the traffic is exposed to a 30 % failure rate: 0.30 × 0.85 = 0.255, and
1 − 0.255 = 0.745. The 15 % that cannot fail has quietly bought you four and a half
points of apparent availability during an outage.

Four and a half points sounds survivable. It is not, because the number is not stable: it
depends on how often your orchestrator probes, a setting in a file nobody associates with
reliability. Turn the liveness probe from every ten seconds to every second and your
measured availability improves without a line of code changing. An indicator you can
improve by probing yourself more often is not an indicator.

So the exclusion list is not tidying-up done after the fact. It is **part of the
definition**, it gets written down, and it gets written down in the same place as the
target — because it is precisely where teams cheat later, usually without noticing.
Reset the injector before moving on:

```bash
curl -s -XPOST http://localhost:8089/chaos/reset
```

!!! jargon "SLI, SLO, SLA"
    An **SLI** is a number you measure: good events over valid events. An **SLO** is a
    target you set for that number — a promise you make to yourself. An **SLA** is a
    promise you make to a customer, with money attached: it is what happens when users
    are unhappy enough that you have to compensate them. Most services should have SLIs
    and SLOs. Very few need an SLA.

Which indicator to pick depends on what kind of thing you are running. The standard menu
is short enough to memorize:

| Service type | Indicators worth measuring |
|---|---|
| Request-driven | Availability, latency, quality |
| Pipeline | Freshness, correctness, coverage |
| Storage | Durability |

Each of those is the same shape: a proportion of valid things that were good.
*Availability* is the proportion of valid requests served successfully. *Latency* is the
proportion served faster than a threshold — not "the p99", which is a different kind of
number entirely. *Freshness* is the proportion of data updated more recently than a
threshold. *Coverage* is the proportion of input that was processed at all. Snip is a
request-driven service, so it gets availability and latency, and that is where the
menu ends for this chapter.

## Two SLOs for Snip

Create `lab/docs/SLO.md`. It is a document, not code, and it is short on purpose: a
definition you cannot hold in your head is one you will not use at three in the morning.

Start with the journey. Someone follows a short link. `GET /l/{code}` either sends them
where they were going, quickly, or it does not. Everything else Snip does is either not
user-facing or not what the service is *for*. Both objectives are scoped to that one
route.

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

**A 404 is a good event.** A short code that does not exist is Snip answering correctly.
The visitor is disappointed, but the service did its job, and if you count 404s as
failures then every expired link burns budget that should have been spent on deploys.
Only a `5xx` is Snip failing. The same logic keeps `410 Gone` on the good side: an
expired link is a correct answer to a stale request.

**Availability and latency are two SLOs, not one.** It is tempting to define "good" as
`2xx or 3xx AND faster than 300 ms` and have a single number. Resist it. A fast 500 and
a slow 302 are different failures with different causes and different fixes, and rolling
them together means the one number goes down and you learn nothing. There is a second,
sharper reason: a fast failure makes your latency numbers look *better*. Fail every
request in four milliseconds and your latency SLI is perfect. Two indicators, two
budgets, two conversations.

**Nothing about the fault injector is excluded.** Requests carrying `X-Snip-Fail-Ratio`
or `X-Snip-Delay-Ms` count exactly like any other. An SLO that quietly ignores your own
fault injection reads healthy through every exercise in this chapter and the next, and
teaches you to trust a number that has been rigged.

Then the exclusion list, in the same file, with a reason per line:

| Excluded | Why |
|---|---|
| `route="/healthz"` | Liveness probes. Nobody is having a bad day when one fails. |
| `route="other"` | Bots and scanners. Their 404s are correct behavior. |
| `route="/"`, `/links`, `/links/{code}` | Real traffic, different journey. Give them their own SLO. |
| `/metrics` | Never instrumented. Scraping is not user traffic. |

Write a name next to the document, too. `docs/SLO.md` in the lab says the owner is
whoever is on call for Snip and that it is reviewed monthly. An unowned SLO is a wish
with a table in it.

### SLO is not SLA

The distinction matters more than it sounds. An SLA is a contract: below the number,
money moves. An SLO is internal, and the only thing it moves is your own decisions about
what to ship.

The rule that follows is short and non-negotiable: **your SLO must be strictly stricter
than your SLA.** If the contract promises 99.9 %, the internal target is 99.95 %, so that
you run out of internal budget while there is still room to react — and not on the phone
with a customer. Snip has no SLA at all. Nobody outside owes anybody anything for these
numbers, which is the normal case and the reason the internal target can be chosen
honestly rather than defensively.

## Choosing the window

An SLI on its own is instantaneous. "99.5 % of requests succeed" is meaningless until you
say *over what period*, because 99.5 % over five minutes and 99.5 % over a year are
wildly different promises.

Two shapes are available. A **rolling window** — the last 30 days, recomputed
continuously — tracks what users have actually experienced recently. A **calendar
window** — this month, this quarter — lines up with business reporting. The guidance is
to prefer rolling for the objective and to summarize on calendar boundaries when
somebody needs a report.

Calendar months are worse than they look for three separate reasons. They forgive: an
outage at 23:00 on the 31st is wiped out at midnight, so the day you should be most
careful is the day with the most slack. They are unequal: February gives you
10 % less budget than January while the target claims to mean the same thing. And they
are awkward to compute, because a range selector in PromQL is a duration, not a calendar
unit — `[30d]` is thirty times twenty-four hours, and there is no `[1month]`.

Which leaves the choice between 28 days and 30 days, and it is not cosmetic.

Four weeks is a genuinely good window: it contains exactly four of every weekday, so a
service with a weekly rhythm is compared against itself. The trap is what else moves when
you choose it. Sloth — a generator that writes SLO rule files for you, and which Chapter
21 introduces properly — ships two stock configurations, `google-30d.yaml` and
`google-28d.yaml`, identical except for the period. The alerting thresholds those files
produce are derived from the period at generation time, so 28 days yields **13.44, 5.6,
2.8 and 0.933** where 30 days yields 14.4, 6, 3 and 1. Pick a 28-day window, then copy the
famous four numbers out of a blog post, and every threshold you have is about 7 % too
permissive. Chapter 21 derives all eight of those numbers from a single formula, at which
point this stops being memorization and becomes arithmetic.

This lab uses a rolling 30 days, and says so in the file, because it makes the budget
arithmetic land on numbers a person can hold: 30 days is 43,200 minutes.

## Choosing the target, in minutes

Nines are a terrible unit for a decision. Minutes are a good one. Multiply the allowed
failure fraction by the window and the target stops being an aspiration:

| Target | Budget over 30 days | Budget over 28 days |
|---|---|---|
| 99 % | 432 min (7 h 12 m) | 403.2 min |
| 99.5 % | **216 min (3 h 36 m)** | 201.6 min |
| 99.9 % | 43.2 min | 40.3 min |
| 99.95 % | 21.6 min | 20.2 min |
| 99.99 % | 4.32 min | 4.03 min |

Read the bottom two rows as an operator rather than as a marketer. At 99.99 % you may be
unavailable for four minutes and nineteen seconds a month. That is less than one careless
deployment. It is less than one container restart that takes its time draining
connections. Committing to it means committing to an engineering program — redundancy,
automated rollback, staged deploys — not to a number in a document. Each additional nine
costs roughly ten times more work than the one before, and the work is real.

So pick the target from measurement, not from aesthetics. Look at what the service
already does, and choose the loosest number that keeps users happy. If you are running at
99.4 % today, promising 99.99 % does not improve anything; it produces a budget that is
gone by the fourth of the month, a policy nobody can follow, and a set of alerts everyone
mutes. And 100 % is never a valid target: a zero budget means you can never deploy, never
upgrade a dependency, never restart anything.

Snip gets 99.5 %. That is 216 minutes of total failure in 30 days, which is generous by
the standards of a payment system and about right for a link shortener on a laptop. The
latency target is 99 % — one request in a hundred is allowed to be slow, and 300 ms is
the boundary because Chapter 10 put a bucket there.

### The budget is a currency

Here is the flip that makes all of this useful, and it is the part most teams never make.

The error budget is not a line you stay away from. It is an amount of unreliability you
are **entitled to spend**. Those 216 minutes buy things: deploys, dependency upgrades,
schema migrations, a load test against the real thing, and the occasional honest mistake.
A month that ends with 100 % of the budget untouched was not an excellent month. It was a
conservative one. Something shippable did not ship, and the cost of that is invisible
precisely because nothing broke.

That reframing is what converts an SLO from a stick into a decision procedure. Budget
left means ship. Budget gone means stop shipping and fix things. Neither of those is a
punishment, and the number that decides between them is the one this chapter is about to
put on a dashboard.

## A latency SLO is a fraction, never a quantile

Now the rule the chapter turns on, and the single most common way a latency objective is
written wrongly.

The tempting form is the one everybody reaches for first, because it reads like English:
*p99 latency must be under 300 ms.* In PromQL that is a comparison against
`histogram_quantile`. Try it. With the lab healthy:

```promql
histogram_quantile(0.99,
  sum by (le) (rate(snip_http_request_duration_seconds_bucket{
    job="snip-api", route="/l/{code}"}[5m]))) < 0.3
```

```text
{}   0.0472
```

That looks like success — a number, well under the objective. Now make Snip slow. Every
redirect gets an extra 400 ms:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","extra_latency_ms":400}'
```

Give it five minutes and run the same expression:

```text
Empty query result
```

!!! trap "The objective that disappears when it is violated"
    A bare comparison in PromQL **filters**; it does not return true or false. When the
    p99 is under 300 ms you get the p99 back. When it is over, the element is removed and
    the result is empty — and an empty result is not a zero, as Chapter 16 showed at
    length. Written as an alert, this expression is quiet exactly when the service is
    breaking its objective. Written on a dashboard it draws a line that vanishes during
    an incident and looks like a broken query.

That is the shallow problem and `bool` would fix it. The deep problems do not have a fix,
and they are why this form is not merely awkward but unusable:

**A quantile has no count of good events.** `0.0472` is a duration. There is no numerator
and no denominator in it, so there is nothing to build a budget out of. You cannot ask
"how many requests were too slow this month" of a number that is a millisecond figure.

**A quantile cannot be aggregated.** Chapter 10 established this: you cannot average the
p99 of two replicas and get the p99 of both. So you cannot combine windows, cannot
combine services, and — the part that matters for Chapter 21 — cannot compute how fast
the budget is being consumed, because that computation is arithmetic on ratios.

The correct form asks the question a waiting person actually has, which is not "what is
the ninety-ninth percentile" but "did my page arrive fast". It is Chapter 10's bucket
ratio:

```promql
sum(rate(snip_http_request_duration_seconds_bucket{
      job="snip-api", route="/l/{code}", le="0.3"}[5m]))
/
sum(rate(snip_http_request_duration_seconds_count{
      job="snip-api", route="/l/{code}"}[5m]))
```

Healthy, that reads `1` or a hair under. With 400 ms of injected delay it drops close to
`0`, and — this is the point — it *keeps returning a number*. It is a proportion of good
events over valid events, in exactly the same shape as the availability SLI, and
everything you can do to one you can do to the other.

The same question without the string literal, using the function Chapter 10 introduced:

```promql
histogram_fraction(0, 0.3,
  sum by (le) (rate(snip_http_request_duration_seconds_bucket{
    job="snip-api", route="/l/{code}"}[5m])))
```

The two agree, because `0.3` is a real boundary of this histogram. `histogram_fraction`
is the safer form to type, because no `le` value appears in it at all.

!!! pitfall "`le=\"0.30\"` matches nothing, silently"
    Prometheus 3 normalizes `le` label values to a canonical float form on ingestion.
    The bucket is stored as `le="0.3"`. A selector for `le="0.30"` — or `le=".3"`, or
    `le="0.300"` — matches no series, the numerator is empty, the whole division is
    empty, and the panel reads *No data* while the query itself is perfectly valid.
    This is the single most likely typo in the whole chapter, and it is why the lab's
    rule file carries a comment saying the value is `"0.3"` and nothing else.

Put the injector back before continuing:

```bash
curl -s -XPOST http://localhost:8089/chaos/reset
```

## Two ways to count: requests or minutes

There is a second choice hiding inside "good events over valid events": what is an event?

**Request-based.** Every request counts equally. A thousand failures during the afternoon
peak weigh a thousand times one failure at 3 a.m. This is what the whole Prometheus
tooling ecosystem implements, it costs two counters, and it is what this lab uses.

**Window-based.** Every *minute* counts equally, and a minute is "good" if its error ratio
stayed under some threshold. A twenty-minute outage costs twenty minutes whether it
happened at noon or at dawn. This matches how humans and contracts talk — "43 minutes of
downtime a month" is a window-based sentence — and it needs a second threshold you have to
justify.

Writing a window-based indicator in PromQL is where Chapter 9's `bool` modifier earns its
place. Start with the obvious attempt:

```promql
sum(rate(snip_http_requests_total{job="snip-api",
      route="/l/{code}", code=~"5.."}[1m]))
/
sum(rate(snip_http_requests_total{job="snip-api",
      route="/l/{code}"}[1m]))
<= 0.01
```

That does not return 1 or 0. It returns the ratio itself on good minutes and nothing at
all on bad ones — the same filtering behavior that made the quantile comparison
disappear. Add `bool` and it becomes the indicator you meant:

```promql
(
  sum(rate(snip_http_requests_total{job="snip-api",
        route="/l/{code}", code=~"5.."}[1m]))
  /
  sum(rate(snip_http_requests_total{job="snip-api",
        route="/l/{code}"}[1m]))
  <= bool 0.01
) or vector(1)
```

Now every evaluation yields exactly one sample: `1` for a good minute, `0` for a bad one.
The `or vector(1)` tail handles the minute with no traffic at all, where the division
produces nothing — a silent minute is not a bad minute. Record that and the 30-day
indicator is `avg_over_time` over the recorded series, which reads as "the fraction of
minutes that were good".

The specification language OpenSLO names this choice `budgetingMethod`, with values
`Occurrences` and `Timeslices`. Reach for time slices when your service has long idle
periods that would let a real outage hide behind low traffic. Snip is busy every minute
of every day, so it uses occurrences.

## Recording the ladder

Everything so far has been definitions. Now they become series.

Open `lab/prometheus/rules/snip-recording.yml` — Chapter 15's file, which currently holds
one group — and add a second group below it, `snip-slo`, with the same
`interval: 30s`. It records the same two indicators at eight different averaging windows:
`5m`, `30m`, `1h`, `2h`, `6h`, `1d`, `3d` and `30d`.

Eight windows sounds excessive for two numbers. It is not, and the reason is Chapter 21:
the alerts it builds compare a long window against a short one, and both sides have to
already exist as series before a rule can reference them. Recording the whole ladder now
means Chapter 21 writes alerting rules rather than expressions.

Here is the first rung in full. Every other availability rung is this expression with the
window swapped:

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

**It records the success ratio, not the failure ratio.** Much of the published SLO
material records errors, because the alerting arithmetic in Chapter 21 is written in terms
of errors, and one minus the other is a cheap conversion. Recording the success side keeps
the *name* honest: `job:snip_sli_availability:ratio_rate1h` really is the availability over
the last hour, it reads correctly on a gauge, and nobody has to remember which convention
this repository chose. It is worth knowing that the two conventions exist and that they
are inverses, because a query copied from one world into the other produces a number that
is wrong by everything.

**`or 0 *` on the numerator** is Chapter 9's fix for a series that is not there. With no
failures at all, the `code!~"5.."` selector is fine, but its mirror image in the error
convention would be missing entirely. Keeping the guard here costs nothing and means the
rung has the same shape as every other ratio in the file.

**`> 0` on the denominator** is the one that will save you. Snip pre-initializes all
twelve of its label combinations to zero, so when traffic stops the counters do not
disappear — they sit still. Both sides of the division are then 0, and 0 divided by 0 is
`NaN`: a real, stored sample carrying a value that compares false against everything and
looks like data. Filtering the denominator makes an idle window produce **no sample** at
all, which every downstream function knows how to skip.

That distinction is not theoretical here, and the next rule is why.

```yaml
      - record: job:snip_sli_availability:ratio_rate30d
        expr: |
          avg_over_time(
            job:snip_sli_availability:ratio_rate5m{job="snip-api"}[30d]
          )
```

The 30-day rung averages the 5-minute rung instead of running a `rate()` over thirty days
of raw counters. A 30-day range query over raw data, every thirty seconds, is the one rule
in this file that could genuinely hurt a laptop; reading an already-computed series is
cheap. Rules inside one group evaluate in order, so the 5-minute rung has already been
written when this one reads it.

Two honest caveats come with that trick. It is an average of averages, which is exactly
right only while traffic is steady — a five-minute window carrying two requests counts as
much as one carrying six thousand. And `avg_over_time` propagates `NaN`: one unguarded
idle window would leave this rung `NaN` for the following thirty days, which would make
the budget gauge, the burn-down panel and every comparison built on them silently
meaningless. Absent beats wrong, which is what the `> 0` buys.

The eight latency rungs are the same ladder built on the bucket ratio:

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

Read it from the inside. `1 - availability` is the observed failure ratio over the window.
Divide by `0.005` — the budget, which is `1 - 0.995` — and you have the fraction of the
budget that has been *consumed*. One minus that is the fraction remaining: `1` is
untouched, `0` is gone. `clamp_min(v, 0)` replaces anything below zero with zero, because
"how far past empty" is not a number anybody acts on differently, and a gauge that swings
to −3 is a gauge nobody reads. Overspend is still visible; Chapter 21 is where you see it.

Check the file and reload:

```bash
make check
```

```bash
make reload
```

`make check` runs `promtool check rules` over everything in `prometheus/rules/`. The line
you are looking for:

```text
Checking /etc/prometheus/rules/snip-recording.yml
  SUCCESS: 22 rules found
```

Five from `snip-red`, seventeen from `snip-slo`: eight availability rungs, eight latency
rungs, and the budget. Give Prometheus a minute, then query
`job:snip_sli_availability:ratio_rate5m` on the Query page. A single series, value near
`1`.

### One alert collapses to one line

Chapter 16 wrote `SnipLatencyObjectiveAtRisk` with the whole bucket ratio spelled out
inline, because the recording rules for it did not exist yet. They do now, so the rule
loses eleven lines:

```yaml
      - alert: SnipLatencyObjectiveAtRisk
        expr: |
          1 - job:snip_sli_latency:ratio_rate30m{job="snip-api"} > 0.01
        for: 10m
```

Same number, same arithmetic, computed once. Leave the two copies in place and they
will drift the first time somebody adjusts the route filter on one of them — and then the
dashboard and the pager disagree about whether you are in trouble, and both of them are
telling the truth about a different expression. That is the failure a recording rule
exists to prevent, and it is now prevented.

## The budget, on a screen

Add `lab/dashboards/snip-slo.json`, provisioned the same way as every other dashboard in
this book, at `http://localhost:3000/d/snip-slo`. Four panels carry this chapter; the rest
of the file belongs to Chapter 21 and will be dark until then.

**Availability SLI (30 days)** and **Latency SLI (30 days)** are Stat panels with instant
queries on `job:snip_sli_availability:ratio_rate30d` and
`job:snip_sli_latency:ratio_rate30d`. Unit `percentunit`, four decimals, and a threshold
step at the objective — `0.995` and `0.99` respectively — so the number turns green when
you are meeting it. Set the minimum near the objective, `0.98` and `0.95`, rather than
`0`: every interesting movement happens in the last few percent of the range, and a stat
scaled from zero never appears to change.

**Error budget remaining (30 days)** is a Gauge on `slo:error_budget_remaining:ratio30d`,
unit `percentunit`, `min: 0`, `max: 1`. A gauge without explicit bounds means nothing —
Chapter 13's rule — and here the bounds are the definition rather than a guess, because
the expression is constructed to live between 0 and 1. Thresholds at 0.75, 0.5 and 0.25
map onto the policy in the next section, which is the only reason to color a gauge at all.

**Budget spent, in minutes** is the same fact in the unit an on-call engineer thinks in:

```promql
(1 - slo:error_budget_remaining:ratio30d) * 0.005 * 30 * 24 * 60
```

`0.005 × 43,200` is 216, so this reads out of a possible 216 minutes. Unit `m`, maximum
216. Percentages are for reasoning; minutes are for explaining to somebody else why you
are not shipping today.

The last panel is a time series of `slo:error_budget_remaining:ratio30d` — the burn-down.
A healthy month is a gentle downward slope that reaches the end of the window somewhere
above zero. A cliff is an incident. The *slope* of that line is the quantity Chapter 21
turns into a single number and alerts on, so spend a moment looking at it now; it is the
picture the whole next chapter is about.

## Burn 40 % of it on purpose

A gauge you have never seen move is a gauge you do not believe. Spend some budget.

First, read the current value on the dashboard, or:

```promql
slo:error_budget_remaining:ratio30d
```

Then find out how much history that 30-day average actually covers, which on a lab that
came up this afternoon is not thirty days:

```promql
count_over_time(job:snip_sli_availability:ratio_rate5m[30d])
```

Call that answer **N**. It is the number of samples the average is over, one every thirty
seconds. Now the arithmetic. An outage of `T` seconds at error ratio `E` adds roughly
`E × T / 30` to the sum of those samples, so the average failure ratio rises by
`E × T / (30 N)`, and the fraction of a 0.5 % budget that buys is that divided by 0.005.
Set it to 0.4 and solve for the time:

```text
T = 0.4 × 0.005 × 30 × N / E   seconds

at E = 0.30:   T = N / 5 seconds
```

If Prometheus has been recording for three hours, N is about 360 and forty percent of your
monthly budget costs you **seventy-two seconds** of outage. Run it:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":40,"route":"/l/{code}","error_ratio":0.30}'
```

Watch the gauge, not the clock — the 5-minute rate window means the effect arrives
smeared over the following few minutes, and the number you are steering by is the gauge
itself. When it reaches roughly 0.6, stop:

```bash
curl -s -XPOST http://localhost:8089/chaos/reset
```

Two things to notice afterwards. The gauge does not spring back when the injector stops:
budget is spent, not borrowed, and those failures stay inside the window until they age
out of it. But on a young lab it does creep back up faster than it should, because every
new healthy sample dilutes an average taken over a few hundred samples rather than a few
hundred thousand. Both are the same artifact, and it deserves its own box.

!!! warning "Your thirty-day window is three days old"
    A rolling 30-day SLO computed on a TSDB that has existed since Tuesday is a 30-day
    window over mostly nothing. The ratios are correct — 99.5 % of what happened is still
    99.5 % of what happened — but the absolute minutes are not, and the budget burns
    implausibly fast whenever the injector runs, as the arithmetic above shows. This is an
    artifact of the lab, not of SLOs. You have two honest options. Read the *ratios* and
    ignore the minutes until the window fills. Or backfill some history.

The lab ships a fixture for the second option: thirty days of invented Snip counters,
sampled every thirty minutes, with two incidents in the month so the budget is visibly
spent rather than a flat 100 %.

One edit has to land before the import does, or the import is six megabytes of wasted
disk. **Prometheus keeps 15 days by default**, and deletes any block older than that at
the next compaction. Import a month into a server configured for a fortnight and half of
it is gone before you have finished reading this page — silently, with no error, while a
rung named `:ratio_rate30d` goes on calling itself thirty days. Retention shorter than
the longest window you query does not fail. It just quietly answers a different question.

So add one flag to the `prometheus` command in `lab/compose.yaml`:

```yaml
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.path=/prometheus
      - --web.enable-lifecycle
      - --config.auto-reload
      - --storage.tsdb.retention.time=45d
```

45 days is the longest window you query, plus headroom. A flag change needs the container
recreated rather than restarted, so:

```bash
make up
```

!!! iou "IOU — chapter 25"
    That is the wrong place for it, and it is there on purpose. The
    `--storage.tsdb.retention.*` flags are deprecated in Prometheus 3.13.1, they are not
    re-read on a configuration reload, and a `storage:` block in `prometheus.yml` beats
    them silently if both are set. They are also what you will find in almost every stack
    you inherit, which is the only reason this lab writes one. Chapter 25, "Storage,
    Retention, Backups and Locking the Door", makes you read the deprecation notice out of
    the binary's own help text, do the disk arithmetic that chooses the number, and move
    the setting to where it belongs. Until then the flag is honest about the one thing
    that matters here: the window is 45 days, not 15.

```bash
make history
```

```bash
make backfill
```

`make history` regenerates `fixtures/history.om` through the pinned Python image so the
data ends now rather than whenever the file was committed — an OpenMetrics file carries
absolute timestamps, and a fixture generated in July is July data forever. `make backfill`
then runs `promtool tsdb create-blocks-from openmetrics` inside the Prometheus container,
writing TSDB blocks straight into the data directory, and restarts Prometheus so it picks
them up. The fixture is built to land near 99.57 % availability and 99.35 % under 300 ms
across the month, which is a service that met both objectives and spent most of its
budget doing it.

Be clear about what that does and does not buy you, because the difference catches
everybody:

- It gives the **counters** a month of history. `increase(...[30d])` over the raw series
  works. Chapter 14's week-over-week panel, which read *No data* because there was no data
  from seven days ago, starts drawing.
- It does **not** retroactively evaluate your recording rules. `job:snip_sli_availability:ratio_rate5m`
  is computed forward from the moment the rule was loaded and nowhere else, so the 30-day
  rung still averages only what it has seen.
- The fixture's resolution is thirty minutes, not fifteen seconds — thirty days at the real
  scrape interval would be a 700 MB file — so no range shorter than an hour resolves over
  the historical region at all. `rate(...[5m])` returns nothing there.

Which is why the honesty box stands even with the fixture in place. The lab can give you a
month of counters; it cannot give you a month of having been running.

## A policy one person can follow

The last artifact is the one that gives the number teeth. Without it, the gauge is
decoration: everybody looks at it, nobody changes what they do. Create
`lab/docs/error-budget-policy.md`, one page, four gates.

| Budget spent | What changes |
|---|---|
| under 50 % | Nothing. Ship. |
| 50 % | Say it out loud. Redirect-path changes get a second reader. |
| 90 % | Feature work on the redirect path stops; next merge is a reliability fix. |
| 100 % | Freeze the redirect path: only fixes for the failure that spent the budget. |

Three design notes, all of which come from policies that failed.

**Scope the freeze.** The gates apply to the redirect path, not to the repository. A
freeze that stops all work is a freeze that gets ignored the second time it happens, and
then you have neither the work nor the policy.

**Say when it lifts.** For Snip: when the rolling window recovers on its own, or when a
post-incident review is written and its first action item has shipped, whichever is later.
A freeze with no exit condition is a hostage situation.

**Change the target only when you are calm.** If the budget runs out every month and
nothing is actually broken, the target is wrong or the indicator is measuring the wrong
thing. Both are fixable and both are an edit to `docs/SLO.md` — proposed with the
measurement that motivates it, and never mid-incident. Loosening a target to stop an alert
firing during an outage is how a team ends up with an SLO that means nothing.

For a team of one, the whole policy compresses to a single sentence worth writing into the
repository with a date on it: *when the budget is gone, the next thing I work on is
reliability, not features.* The mechanism matters far less than the pre-commitment,
because the value of writing it down is that the decision gets made by a rested person in
daylight rather than by a tired person at midnight who badly wants to ship.

!!! selfcheck "Self-check"
    Run `make verify-ch20`. It walks all sixteen rungs of the ladder, checks that the
    budget is a ratio, and checks that both documents exist and say what they should:

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

    The percentage on that indented line depends on your lab's history. If a rung reports
    `got nothing, want a ratio`, the script says where to look: it is the zero-errors hole
    from Chapter 9, not a lab that is too young. A 30-day rate over two hours of data
    still returns a number.

## Common mistakes

**Dividing by total instead of valid.** The most common and the most flattering. Health
checks, internal probes and bot traffic are all guaranteed-good events, so including them
raises your measured availability without improving anybody's day. The tell is that your
number improves when you add an instance or shorten a probe interval.

**Writing the latency objective as a quantile.** `histogram_quantile(0.99, ...) < 0.3`
looks like the objective and is not one. It filters instead of returning a value, so it
vanishes when violated; it carries no count of good events, so there is no budget in it;
and it cannot be aggregated, so nothing downstream can use it. Chapter 21 cannot build on
it at all.

!!! pitfall "The exclusion list written after the fact"
    The failure mode is not omitting the list. It is adding to it during an incident.
    A month into running an SLO, something fails, somebody notices that a particular
    client is responsible for most of the failures, and that client gets excluded — and
    the SLI recovers without a single user's experience changing. Every exclusion has to
    be defensible as a statement about *whose experience you are measuring*, written
    before you need it, and reviewed on a schedule rather than under pressure.

**Choosing a calendar month for the window.** The budget resets at midnight on the 1st, so
the riskiest day of the month has the least incentive to be careful, and February is a
10 % smaller promise than January wearing the same number.

**Copying the target from a table.** 99.9 % is not a default. It is 43.2 minutes a month,
and if your deploy takes four minutes and you deploy weekly, a third of it is already
committed to routine work. Start from what you measure.

**Leaving the denominator unguarded.** `0 / 0` is `NaN`, `NaN` is a stored sample, and
`avg_over_time` spreads it across the whole window. One idle five-minute stretch can leave
a 30-day figure meaningless for a month, and nothing about it looks like an error: the
gauge reads blank, every comparison against it is quietly false, and no alert fires
because no alert can. `> 0` on every denominator, every time.

## Summary

An SLI is good events over valid events, and the second word is the one that does the
work. Writing down what "valid" excludes — and why, and before you need it — is what
separates a service level indicator from a number that flatters you. An SLO adds a target
and a window to that indicator, and the two together define an error budget: an amount of
failure you are entitled to spend before you have to stop and fix things.

Snip now has two written objectives, sixteen recorded series that measure them at eight
window lengths each, a budget expression clamped to a readable range, a dashboard where
the budget is a needle and a slope, and a one-page policy that says what happens at 50, 90
and 100 percent. Chapter 21 takes the slope of that burn-down and turns it into alerts
that fire in minutes for a real outage and stay quiet for a blip.

The things to still know in six months:

- **Valid, not total.** Health checks, bots and out-of-scope clients belong in a written
  exclusion list, and that list is part of the definition rather than a convenience.
- **State the budget in minutes.** 99.9 % over 30 days is 43.2 minutes; 99.99 % is 4.32,
  which is less than one careless deploy. Nines hide the decision; minutes expose it.
- **Rolling windows, not calendar months.** And if you choose 28 days, remember that every
  threshold derived from the period changes with it.
- **An SLO is stricter than any SLA you sign.** You want to run out of internal budget
  while there is still room to react.
- **The budget is a currency.** Ending the month with all of it unspent means you shipped
  too little, not that you did well.
- **A latency objective is a proportion of requests faster than a threshold**, read off a
  bucket boundary or from `histogram_fraction` — never a comparison against
  `histogram_quantile`, which has no good-event count, cannot be aggregated, and vanishes
  the moment it is violated.
- **Guard the denominator.** `0/0` is `NaN`, and `NaN` poisons a thirty-day average for
  thirty days.

## Exercises

!!! exercise
    **1. Defend three exclusions (warm-up).** Write the exclusion list for
    Snip's availability SLI in your own `docs/SLO.md`. Name three things you
    excluded and defend each in one line, in terms of whose experience you
    are measuring. Then name one thing you were tempted to exclude and did
    not, and say why. `make verify-ch20` greps the file for an exclusion
    list; it cannot grade your reasoning, and the reasoning is the exercise.

    **2. Nines into minutes (warm-up).** Convert 99.5 %, 99.9 % and 99.99 %
    over a rolling 30 days into minutes of budget. Check the first against
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
    `docs/error-budget-policy.md` afterwards and note every place yours is
    vaguer.

    **6. The objective you cannot build (stretch).** Write a latency SLO using
    `histogram_quantile` — a real expression, against the lab, that you would be prepared
    to put in a rule file. Then hold `{"rps":20,"extra_latency_ms":400}` for five minutes
    and run it. Write down the two things you cannot compute from the result: name them
    precisely, and for each one say which panel on `/d/snip-slo` could not be drawn
    without it.
