# Chapter 16 — Alerting Rules, and What "Firing" Actually Means

Here is a story that has happened to almost everyone who has ever written an alert. A
service is broken for an hour. Nobody is paged. Afterwards someone opens the rule file,
reads the expression out loud, and it is *correct*. The threshold is right. The window is
right. The service really was over the threshold. The alert really did not fire.

There are three ways that happens, and this chapter covers all three. The condition was
true most of the time but not at every single evaluation, and `for` threw the clock away
each time it lapsed. Or the expression returned nothing rather than a number, and nothing
is not a value you can compare against a threshold. Or the alert did fire, in Prometheus,
and had nowhere to go. None of those look like failures: a rule that has never fired and a
rule that *cannot* fire render identically, as one gray word, `inactive`. By the end of
this chapter you will have four alerting rules running against Snip, you will have watched
one climb into `pending` and fall back without ever firing, and you will have made one
silently incapable of firing — on purpose, so that you recognize it the day it happens by
accident.

!!! objectives "Objectives"
    After this chapter you can:

    - Write an alerting rule and predict its `inactive` → `pending` → `firing`
      transitions on a graph.
    - Explain what `for` actually does, and why `keep_firing_for` is the opposite tool.
    - Choose ratios over rates over counters as alert expressions, and defend the choice.
    - Template an annotation with `$labels`, `$value` and the `humanize` family.
    - Recognize the silent-alert failure: an expression over a series that has never
      existed returns nothing and never fires, forever.
    - Explain why an alert that aggregates away `job` cannot be routed.

## Where the lab is

Everything here runs against the stack as Chapter 15, "Recording Rules", left it: two
`snip-api` replicas behind the `edge` proxy, `snip-worker`, `catalog`, `loadgen`, Grafana,
Prometheus, and `lab/prometheus/rules/snip-recording.yml`. Every tag is that chapter's end
state, so at `ch16` the finished `snip-alerts.yml` and `alerting:` block are already there
to read along with. To type them yourself, check out `ch15` instead.

```bash
cd lab
git checkout ch16
make check
make up
make ps
```

Snip answers on `http://localhost:8080/`, Prometheus on `http://localhost:9090/`, Grafana
on `http://localhost:3000/`, and the load generator's control API on
`http://localhost:8089/`. Put the injector into a known state and leave it there — every
number in this chapter assumes twenty requests per second:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","error_ratio":0}'
```

Two things from Chapter 15 are load-bearing here. `prometheus.yml` already carries a
`rule_files:` glob, so a new file dropped into `lab/prometheus/rules/` is picked up on the
next reload with no config edit. And the group `snip-red` holds five recording rules —
twenty-three series on a running lab — two of which this chapter consumes:
`job_route:snip_http_errors:ratio_rate5m` and `job:snip_sli_valid:rate5m`.

"Reload" in this chapter always means Chapter 15's two commands, `make check` and then
`make reload` — the first because a rule file that does not parse is rejected as a unit
while the old rules keep running, which is an excellent way to spend twenty minutes
wondering why your edit did nothing.

## An alerting rule is a query with a clock

You already know most of the machinery. An alerting rule lives in the same file format as
a recording rule, in the same kind of group, on the same schedule, in the same engine. The
difference is what happens to the result. A recording rule writes the result vector into
the database under a new name. An alerting rule treats **every element in it as one
alert**. Not the expression — the elements. Four result series means four alerts, separate
objects with separate lifetimes: one can be firing while another is inactive, each is
notified on its own, and — from Chapter 17 — each can be muted on its own.

!!! jargon "Alert instance"
    One element of an alerting rule's result vector, identified by its label set. A rule is
    a template; an instance is a specific thing that is wrong right now — this replica, this
    route. "The alert is firing" is shorthand for "at least one instance is firing."

Six fields make up a rule. Three you will use every time:

```yaml
- alert: TheNameThatShowsUpOnYourPhone
  expr: some_expression > some_threshold
  for: 5m
```

`alert` is the name. Community convention is CamelCase, and unlike a recorded metric name
it only has to be a valid *label value* — but it becomes the `alertname` label on every
instance, and you will match on it in Chapter 17, "Alertmanager: Routing, Grouping and
Silence".

`expr` is ordinary PromQL, and the *values* it returns are irrelevant to whether the alert
fires — only whether an element is present in the result. This is why almost every
alerting expression ends in a comparison: comparisons without `bool` filter, so an element
that fails the comparison is not in the result at all. Chapter 9, "Ratios, Arithmetic, and
the Series That Isn't There", taught that distinction; this is what it was for.

`for` is the clock, and the subject of half this chapter. Leave it out and the rule fires
on the first evaluation where the element appears, with no pending state at all.

The other three are `keep_firing_for`, `labels` and `annotations`. Labels become part of
the alert's identity and are what routing decides on. Annotations are free text for the
human who gets woken up, and are not part of the identity.

### Where an alert's labels come from

This is worth slowing down for: it explains three separate mistakes later in the chapter.
An alert instance's label set is built from three sources, in this order:

1. Every label on the expression's result element — whatever survived your aggregations
   and matchings, including target labels like `job`, `instance` and `env`.
2. `alertname`, added by Prometheus.
3. The rule's own `labels:` block, added last, overwriting on collision.

The metric name is dropped; everything else is inherited, and inheritance is not
selective. Two consequences follow, and both cost people real incidents. Aggregate away
`job` and the alert has no `job`, so nothing downstream can tell which service is broken
or which team owns it. Keep a high-cardinality label and you get one alert instance per
value of it — a thousand distinct values is a thousand alerts, from one rule, in one
evaluation.

## The first rule: a target that stopped answering

Create `lab/prometheus/rules/snip-alerts.yml`:

```yaml
groups:
  - name: snip-alerts
    interval: 30s
    rules:
      - alert: SnipTargetDown
        expr: up{job=~"snip-api|snip-worker"} == 0
        for: 2m
        labels:
          severity: page
          service: snip
        annotations:
          summary: >-
            Snip replica {{ $labels.instance }} has stopped answering
            scrapes.
          description: >-
            Prometheus has not reached {{ $labels.instance }} in job
            {{ $labels.job }} for two minutes. Every request that
            replica would have served is now on the others, or on
            nobody.
```

`up` has been in front of you since Chapter 1, "Ten Minutes to Your First Metric": one
sample per target per scrape, `1` if the scrape succeeded, `0` if it did not. `up == 0`
returns one element per failing target, carrying that target's labels, so this one rule
covers both `snip-api` replicas and the worker separately, with no list to maintain.

The two labels are not decoration. Alertmanager — the separate program that turns firing
alerts into notifications, and the whole subject of Chapter 17 — decides who to tell by
matching on labels and nothing else. Add them to every rule from the start; retrofitting
them onto twenty rules after you have written the routing is miserable.

`make check` now has two files to look at. With this first rule alone in the file, it ends
with:

```text
Checking /etc/prometheus/rules/snip-alerts.yml
  SUCCESS: 1 rules found

Checking /etc/prometheus/rules/snip-recording.yml
  SUCCESS: 5 rules found
```

Then `make reload` and open `http://localhost:9090/rules`. Beside Chapter 15's `snip-red`
group is `snip-alerts`, one rule, state `inactive`. At the `ch16` tag the count reads
`4 rules found` and all four are on the page already.

### Making it fire

Now break something. Pause the container rather than stopping it. A paused container is
still in Docker's running list, so service discovery keeps the target and the scrape gets
no answer; a *stopped* one leaves that list, discovery drops the target, and `up` stops
existing rather than going to zero.

```bash
docker compose pause snip-worker
```

Within about twenty-five seconds — one fifteen-second scrape interval plus the ten-second
timeout — `up{job="snip-worker"}` goes to 0. The state machine has three states. Look at
which edges are driven by the expression and which by the clock:

```text
     element appears           `for` elapsed
 ┌──────────┐            ┌─────────┐          ┌────────┐
 │ inactive │───────────▶│ pending │─────────▶│ firing │
 └──────────┘            └─────────┘          └────────┘
      ▲                       │                    │
      │    element gone       │                    │
      ├───────────────────────┘                    │
      │    element gone — keep_firing_for delays   │
      │    this edge and only this edge            │
      └────────────────────────────────────────────┘
```

Two things to notice. There is no edge from `pending` back to a partially-served clock:
the return goes all the way to `inactive`, and the next visit starts the timer at zero.
And `firing` is reached only by the passage of time, never by the expression getting
*worse*.

Unpause the worker before two minutes are up, and the alert visits `pending` and goes
straight home:

```bash
docker compose unpause snip-worker
```

## The `ALERTS` series, where this becomes real

While an alert instance is pending or firing, Prometheus writes a synthetic series for it,
valued `1`, and marks it stale the moment the instance leaves that state:

```promql
ALERTS{alertname="SnipTargetDown"}
```

Pause the worker again and leave it paused this time. Within a minute the Table tab shows:

```text
ALERTS{alertname="SnipTargetDown", alertstate="pending",
       env="lab", instance="snip-worker-1", job="snip-worker",
       service="snip", severity="page"}                        1
```

Read that label set again, because every label came from somewhere different. `alertname`
and `alertstate` were added by Prometheus. `instance` and `job` came from the `up` series,
which got them from the relabeling in Chapter 12, "`prometheus.yml` in Full: Service
Discovery and Relabeling". `env="lab"` came along for the ride from the same place,
because inheritance is not selective. `severity` and `service` came from the rule. The
value is `1`, always, and carries no information.

Two minutes after the target went down, run it again and the only thing that changes is
`alertstate="firing"`. The pending series was not updated. It was marked stale, and a
*different* series — different `alertstate`, therefore a different identity — began.
Switch to the Graph tab with a fifteen-minute range and you can see it: one line that runs
for two minutes and stops, and a second line that starts where the first ended. That
picture is the whole chapter in one panel; keep it open.

`ALERTS` is an ordinary series in an ordinary database, so you can count what is currently
active, by state:

```promql
count by (alertstate) (ALERTS)
```

Resist the temptation to go further and measure how noisy your alerting has been over the
last month: the series is marked stale rather than dropping to zero, so counting episodes
over a long range is easy to get wrong. Chapter 19, "What a Page Should Say, and Who
Watches the Watcher", audits alert volume from Alertmanager's own notification counters,
which are designed for the question.

A second synthetic series, `ALERTS_FOR_STATE`, carries the Unix timestamp at which the
instance became active — the moment the `for` clock started. On a running lab it reads
something like `1789830208`. Prometheus writes it so that a restart does not reset every
pending timer to zero: on startup it reads these back and restores the clocks, within a
bound you can see for yourself:

```bash
curl -s http://localhost:9090/api/v1/status/flags \
  | grep -o '"rules.alert.for-outage-tolerance":"[^"]*"'
```

```text
"rules.alert.for-outage-tolerance":"1h"
```

Unpause the worker before moving on:

```bash
docker compose unpause snip-worker
```

## `for` is a debounce, not a sustained-badness detector

Here is the sentence this chapter exists to install, and it is worth reading twice.

**`for: 5m` does not mean "the condition was true for five minutes". It means "the
condition was true at every single evaluation across five minutes". One evaluation where
the element is missing puts the clock back to zero.**

Not paused. Not banked. Zero. The consequence is easiest to see drawn. Take the
construction everybody writes when they want "this has been bad for an hour" — a
one-minute error ratio with `for: 1h` — and give it a ninety-minute outage with a single
healthy thirty-second dip in it:

```text
min  0      15      30      45      60      75      90
     ████████████████████████████·█████████████████████
     └───── 50 minutes pending ──┘└──── 40 minutes ────┘
                                 ▲
       one evaluation, at minute 50, where the condition
       was false. Neither run reaches sixty minutes, so
       nothing ever fires.
```

Nothing fired. Not late — never. The service was down for an hour and a half and the rule
behaved exactly as written. That construction is the SRE Workbook's Approach 3 — one of
six the workbook compares, and one of the ones it rejects, for precisely this reason.
Chapter 21, "Burn Rates: Alerts That Don't Cry Wolf", walks the whole list.

!!! pitfall "The alert that reads correctly and cannot work"
    `for` is the first thing everyone reaches for to express "this has been bad for a
    while", and it is the wrong tool for that job. It expresses "this has been bad *without
    interruption* for a while", a much more fragile claim — and the longer the `for`, the
    more fragile it gets, because there are more evaluations available to spoil it. Chapter
    21 replaces the whole construction with something that measures damage instead.

So what is `for` good for? Suppressing brief, self-correcting nonsense: one failed scrape
because a container was busy collecting garbage, one evaluation during a rolling restart
where a replica is gone. It is a debounce on a switch, and debounces are useful. It is not
a measurement of duration.

### Watch it happen, on your own machine

Add the second rule to `snip-alerts.yml`. Order inside a group does not matter for
alerting rules, since none of them consumes another's output:

```yaml
      - alert: SnipHighErrorRatio
        expr: |
          job_route:snip_http_errors:ratio_rate5m{
            job="snip-api", route="/l/{code}"} > 0.20
        for: 5m
        labels:
          severity: page
          service: snip
        annotations:
          summary: >-
            {{ $value | humanizePercentage }} of Snip redirects on
            {{ $labels.route }} are failing.
          description: >-
            The 5xx ratio on GET /l/{code} has been above 20 percent
            for five minutes. Everyone following a short link is
            affected, in proportion.
```

This is Chapter 15's recorded ratio with a threshold on it. Notice what it did *not* need:
no `rate`, no `sum`, no division, no guard against a zero denominator. All of that is in
the recording rule, computed once and used by both the alert and the dashboard, so the two
cannot drift apart. Notice also where `route` comes from: not the `labels:` block — the
recording rule aggregates `by (job, route)`, so the result element already carries it and
the alert inherits it, which is why the annotation can say `{{ $labels.route }}`.

Twenty percent is a number somebody picked because one redirect in five failing is
unambiguously an outage. Chapter 20, "SLIs, SLOs and Error Budgets", replaces guessed
thresholds with a stated objective, and Chapter 21 deletes this rule outright.

Reload, then inject a ninety-second blip:

```bash
curl -s -XPOST http://localhost:8089/control -d '{"error_ratio":0.9}'
sleep 90
curl -s -XPOST http://localhost:8089/control -d '{"error_ratio":0}'
```

Now graph `ALERTS{alertname="SnipHighErrorRatio"}` over a fifteen-minute window. On
`GET /l/{code}` — eighty percent of the mix — `error_ratio` lands as a 500 on exactly that
fraction of requests, so the route's 5xx ratio is 0.9 while the blip runs. The recorded
ratio is a `[5m]` rate, though, so ninety seconds of it is averaged across three hundred:
`90 × 0.9 / 300` = **0.27**, held for as long as the window contains the whole blip.

```text
 t=0s     blip starts; the recorded ratio begins to climb
 t≈67s    ratio crosses 0.20
 t=90s    blip ends. Ratio reaches 0.27 and STAYS there: the
          five-minute window still holds all ninety seconds
 t=300s   the far edge of the window reaches the start of
          the blip, and the ratio begins to decay
 t≈323s   ratio drops back below 0.20
 ──────────────────────────────────────────────────────────
 above the threshold for 4 min 17 s; `for: 5m` wanted 5 min
```

The `pending` series appears, sits there for about four minutes, and vanishes. `firing`
never happens. It misses by roughly forty seconds: a minute and a half of real damage,
stretched by a five-minute window into four and a quarter minutes of elevated ratio,
falling short of a five-minute debounce by less than two evaluations.

Your own graph will sit about a minute to the right of those marks at both ends. The
arithmetic is continuous; the machinery is not. The counter increase only becomes visible
at a scrape, fifteen seconds apart; the recording rule turns it into a ratio on its own
thirty-second grid; the alert rule reads that ratio on a third. Three quantizations,
stacked, and they do not cancel. Measured here: the ratio crossed 0.20 between `t = 100 s`
and `t = 110 s`, `pending` appeared at `t = 130 s` and was gone by `t = 371 s`. Hold the
arithmetic against the *span* rather than the clock times — four minutes flat, measured,
against the 4 min 17 s predicted.

!!! trap "Making it worse by making it more sensitive"
    The instinct on seeing that is to lower the threshold. Try it: change `0.20` to
    `0.10`, reload, and run the identical ninety-second blip again. Now the ratio crosses
    the threshold at `t ≈ 33 s`, stays above it until `t ≈ 357 s`, and `for: 5m` is
    satisfied at `t ≈ 333 s` — with twenty-four seconds to spare. This appears:

    ```text
    ALERTS{alertname="SnipHighErrorRatio", alertstate="firing",
           job="snip-api", route="/l/{code}",
           service="snip", severity="page"}                   1
    ```

    Four minutes after the blip ended — and gone at the next evaluation, thirty seconds
    later. A page and a recovery, back to back, for something that stopped happening
    before your phone lit up. Twenty-four seconds is under one evaluation interval, so
    depending on where your group's grid falls you may get one firing sample or none. That
    margin is the point: a threshold tuned to make an alert fire after the incident is
    over is a threshold tuned to nothing. Put the threshold back to `0.20`.

That is not a bug in `for` or in `rate`. It is what happens when a smoothing window is
stacked under a debounce and the result is read as a measurement of now.

### The flap that isn't

The lab ships a scenario for exactly this discussion. It alternates the error ratio
between 30 % and 0 % every forty-five seconds, at forty requests per second:

```bash
DURATION=600 ./scripts/scenario-flap.sh
```

Before you run it, write down what you expect `ALERTS{alertname="SnipHighErrorRatio"}` to
do. Most people predict a rapid cycle of `pending` appearing and vanishing. What you
actually get is **nothing at all**. No pending. No firing. The rule never leaves
`inactive`.

Put the recorded ratio and its one-minute equivalent on one graph while it runs:

```promql
job_route:snip_http_errors:ratio_rate5m{job="snip-api",
                                        route="/l/{code}"}
```

```promql
sum by (route) (
  rate(snip_http_requests_total{job="snip-api",
                                route="/l/{code}",
                                code=~"5.."}[1m])
)
/
sum by (route) (
  rate(snip_http_requests_total{job="snip-api",
                                route="/l/{code}"}[1m])
)
```

The one-minute line swings between roughly 0 and 0.30, which is the flapping you asked
for. The five-minute line — the one the alert reads — climbs to about **0.15** and sits
nearly flat, because a three-hundred-second window always holds between 135 and 165
seconds of a ninety-second duty cycle. That is a ratio between 0.135 and 0.165, and it
never gets near 0.20.

The debouncing you thought `for` would do was already done, before `for` ever saw a number,
by the rate window. On a rate-based expression the window is your primary noise filter and
`for` is a small correction on top of it. Chapter 21 makes that explicit by pairing a long
window with a short one instead of a window with a stopwatch.

Stop the scenario with Ctrl-C; it resets the injector on the way out.

The scenario's own banner suggests you will see the alert "reach pending and fall back,
over and over, without ever firing". At forty-five seconds you will not, for the reason
just given. Slow the flap down with `PERIOD=300 DURATION=1200 ./scripts/scenario-flap.sh`
— five minutes on, five minutes off — and the recorded ratio finally sweeps linearly from
0 up to 0.30 and back. It crosses 0.20 two thirds of the way into each bad phase, and
falls below it a hundred seconds after the phase ends: 3 min 20 s above the threshold per
cycle, one clean `pending` episode every cycle, and never enough for `for: 5m`. The
arithmetic is the same every time; what changes is whether the window can see the shape
you are trying to alert on.

## `keep_firing_for` is the opposite tool

`for` delays the transition *into* firing. `keep_firing_for` delays the transition *out
of* it: after the condition stops being met, hold the alert in `firing` this long anyway.

That sounds like a way to make alerts worse. It has two honest uses: flapping at the
*alert* level, where a condition crossing back and forth over the line produces a resolved
notification and then a firing notification over and over; and a signal that disappears
for reasons that are not recovery — a target that vanishes during a deploy is not "fixed".

`SnipTargetDown` is a clean place to see it, because `up == 0` is binary and reacts within
one scrape. Add one line to that rule:

```yaml
        for: 2m
        keep_firing_for: 5m
```

Reload, pause the worker, wait for `ALERTS{alertname="SnipTargetDown",
alertstate="firing"}` to appear — call it three minutes, since the scrape has to time out
before the clock even starts — and then `docker compose unpause snip-worker`.

`up` returns to 1 at the very next scrape. Before, that ended the alert. Now the firing
series continues for a further five minutes, and only then goes stale. Pause the container
again inside that window and nothing happens at the alert level: it never left `firing`, so
there is no second `for` period and no second notification. Take the line out again and
reload — the shipped `snip-alerts.yml` carries no `keep_firing_for`, because Chapter 17
needs the resolved notification to arrive promptly.

The flap scenario's banner asks you to try the same line on `SnipHighErrorRatio`. Nothing
changes: at a forty-five-second period the recorded ratio never crosses 0.20, so there is
no firing state to hold. `keep_firing_for` extends an alert; it cannot create one — which
is why the demonstration here uses `up == 0`.

!!! warning
    `keep_firing_for` is not a fix for a noisy expression. If an alert flaps because the
    expression is badly chosen — a threshold sitting in the middle of the signal's normal
    range, a window too short for the traffic — holding it firing longer only lengthens
    each false alarm. Fix the expression first.

## Counters, rates, ratios: pick the last one

Every alerting expression is one of three shapes, and they are not equally good. Work up
the ladder with Snip's own counter.

**A raw counter threshold.** The shape everyone writes first:

```promql
snip_http_requests_total{job="snip-api", code=~"5.."} > 100
```

This is broken in two independent ways, and the second is the interesting one. A counter
only goes up, so once a process has served its hundredth 5xx — at 4 a.m. last Tuesday,
perhaps — this is true forever and the alert never resolves. And when the process
restarts, the counter resets to zero, so the alert *silently resolves* and you get a
"recovered" notification generated by a crash. An odometer reading is not a statement about
now.

**A rate threshold.** Better, because differences carry meaning where absolute counter
values do not:

```promql
sum by (job) (
  rate(snip_http_requests_total{job="snip-api",
                                code=~"5.."}[5m])
) > 2
```

This one is true, and it handles restarts, because `rate` corrects for counter resets. But
"more than two errors per second" only means something at one traffic level. At Snip's
twenty requests per second, two errors a second is a ten percent failure rate — a
catastrophe. At two thousand it is one request in a thousand, so the identical rule pages
you daily for a service that is fine. Copy a threshold the other way — one tuned on the
big service, say `> 200` — and it stays silent while Snip dies. A rate threshold is a
statement about one traffic level and nothing else.

**A ratio.** Dimensionless, and therefore portable:

```promql
job_route:snip_http_errors:ratio_rate5m{job="snip-api",
                                        route="/l/{code}"} > 0.20
```

Twenty percent means twenty percent at twenty requests per second and at twenty thousand.
The threshold survives a tenfold change in traffic untouched, survives the move from
staging to production, and means the same thing to a person reading a notification. This
is the shape everything from Chapter 20 onwards is built on.

There is one honest use for an absolute count inside an alert, and it is not as the
condition: it is as a *guard*. At very low traffic a ratio becomes violently unstable — one
failed request in ten is a 10 % error ratio — so a clause requiring a minimum number of
events before the ratio may mean anything is a real fix, and Chapter 21 derives it.

## Symptoms, and the causes worth keeping

There is a decision inside every alert: are you alerting on something a user feels, or on
something you *think* makes users feel things?

`SnipHighErrorRatio` is a symptom. It fires because people clicking short links are getting
errors, and it fires no matter *why* — bad deploy, dead database, exhausted connection
pool, a bug nobody has thought of yet. One rule, total coverage of one user experience. A
cause alert — connection pool above 90 %, memory above 4 GB — covers only the failure modes
you already imagined, pages you for conditions that turn out to be survivable, and stays
quiet for the outage nobody predicted.

The rule of thumb: **if an alert has no user impact and no lead time, it is a dashboard
panel, not a page.** That overclaims slightly, and a short list of cause alerts earns its
place:

| Cause alert | Why it survives the rule |
|---|---|
| Disk full in N hours | The outage has not happened yet and is preventable |
| Certificate expires in N days | Pure lead time; nothing is broken now |
| Quota or capacity headroom | Human procurement takes weeks |
| Every replica of a job down | You have lost the ability to measure the symptom |

Note the last one: it is why `SnipTargetDown` exists in a chapter that just argued for
symptoms — except that as written it pages for a *single* replica, which by the rule just
stated it should not, since the other one is still serving. It stays that way because
Chapter 17 needs a binary, fast-reacting alert to route, and Chapter 19 argues about the
severity it deserves and says why the lab keeps it anyway. The rule here that genuinely
earns a page on a cause is the fourth:
when the indicator disappears, there is nothing left to measure the symptom with.

## Annotations: writing for the person you woke up

Labels are for machines. Annotations are for the human holding a phone at 3 a.m., with
ninety seconds of patience and no context. They are Go templates, evaluated per instance
when the alert fires, with three variables: `$labels`, a map of the instance's labels;
`$value`, the numeric value of the expression's element; and `$externalLabels`, so
`{{ $externalLabels.cluster }}` renders `obslab` here.

The trap is `$value` printed raw:

```text
0.27000000000000013 of Snip redirects on /l/{code} are failing.
```

Nobody reads that at 3 a.m. and thinks "ah, 27 %". Prometheus ships formatting functions
for exactly this — `humanize` for a plain number with an SI suffix, `humanize1024` for
bytes, `humanizeDuration` for seconds, `humanizeTimestamp` for a Unix time, and
`humanizePercentage`, which multiplies a 0-to-1 ratio by a hundred and appends a `%`. The
rule you already wrote uses it, and renders:

```text
27% of Snip redirects on /l/{code} are failing.
```

For a value that is not a ratio, `{{ printf "%.2f" $value }}` is the workhorse.

A good annotation answers three questions in one screen: what is broken, who it hurts, and
what to look at first. Deliberately not "how to fix it" — a rule file is a terrible place
for a troubleshooting flowchart, and one that rots. Chapter 19 turns this into a five-field
template, and Exercise 4 asks you to write one now and be graded against it later.

## The alert that can never fire

Add the third rule. This one is the latency counterpart of the error ratio, and it is
written out in full because the recorded rung it will eventually use does not exist yet:

```yaml
      - alert: SnipLatencyObjectiveAtRisk
        expr: |
          1 - (
            sum by (job) (
              rate(snip_http_request_duration_seconds_bucket{
                job="snip-api", route="/l/{code}",
                le="0.3"}[30m])
            )
            /
            sum by (job) (
              rate(snip_http_request_duration_seconds_count{
                job="snip-api", route="/l/{code}"}[30m])
            )
          ) > 0.01
        for: 10m
        labels:
          severity: ticket
          service: snip
          route: "/l/{code}"
        annotations:
          summary: >-
            Snip redirects are missing the 300 ms latency objective.
          description: >-
            {{ $value | humanizePercentage }} of GET /l/{code}
            requests took longer than 300 ms over the last half hour,
            against a 1 percent objective.
```

This is the bucket-ratio form from Chapter 10, "Latency: Histograms Without Tears": the
`le="0.3"` bucket counts requests that finished inside 300 ms, the `_count` series counts
all of them, and one minus their ratio is the fraction that was too slow. The `0.3`
boundary exists because Chapter 10 designed Snip's buckets backwards from that objective.
Try `le="0.30"` instead and the query returns nothing at all, silently — Prometheus 3
normalizes bucket bounds to a canonical float form and `0.30` is not it.

Two label details are worth a moment. `severity: ticket` rather than `page`, because slow
is not down — Chapter 19 turns that instinct into a taxonomy. And `route` *is* in the
`labels:` block this time, because `sum by (job)` threw it away — the opposite of what
happened in `SnipHighErrorRatio`. Both rules end up with a `route` label from opposite
directions, and only one of the two would survive an edit to the aggregation.

Reload and run the inner expression without the `> 0.01`:

```text
{job="snip-api"}                                      0.00003688
```

A very small number — a flat `0` on a lab quiet the whole half hour, a few ten-thousandths
otherwise. The value is not the point; the point is that there *is* one. One element,
labeled `job="snip-api"`, and `0.00003688 > 0.01` is false, so the comparison filters it
out and the rule sits `inactive`. Remember that reading: the next section produces
something that looks identical from the outside and is not.

A thirty-minute window plus `for: 10m` is patient by design. Run the latency tail, and give
it half an hour rather than the script's ten-minute default:

```bash
DURATION=1800 ./scripts/scenario-latency-tail.sh
```

Two percent of requests now take twelve seconds — or two, since loadgen hangs up at its own
timeout, which is still far past the 300 ms bucket. The thirty-minute ratio crosses 0.01
between ten and fifteen minutes in, and `for: 10m` turns that into `firing` ten minutes
later. The default duration will not do it: ten minutes of tail is a third of the window,
so the ratio tops out short of the threshold and decays again. For a ticket, twenty-odd
minutes of detection is correct; for a page it would be indefensible, which is the
argument Chapter 21 is built on.

### Now break it on purpose

Everything above assumes the expression returns *something*. Edit `SnipHighErrorRatio` and
misspell the route — a plausible typo, a plural:

```yaml
        expr: |
          job_route:snip_http_errors:ratio_rate5m{
            job="snip-api", route="/l/{codes}"} > 0.20
```

Reload. `make check` passes without a murmur: the YAML is valid, the PromQL parses, and
`promtool` has no opinion about whether a label value exists. The rules page still shows
state `inactive`, health `ok`. Now run a real outage:

```bash
DURATION=420 ./scripts/scenario-outage.sh
```

The dashboard climbs, the recorded ratio climbs, and the alert does not move — not
pending, not firing, and not tomorrow either. Run the expression by hand with the
threshold removed:

```promql
job_route:snip_http_errors:ratio_rate5m{job="snip-api",
                                        route="/l/{codes}"}
```

```text
Empty query result
```

**Empty is not zero.** Compare it with the latency reading you just took: that returned an
element, too small to cross its threshold, and the comparison rejected it. This one has no
elements at all, so there is nothing to compare against `0.20` and nothing to hold in
`pending`. The alert is not quiet because the service is healthy. It is quiet because the
question is unanswerable, and Prometheus renders both as the same gray word.

!!! ladder "Ladder → rung 4"
    Empty result from a selector that looks right? Appendix B, rung 4: the metric exists,
    but not with those labels. `job_route:snip_http_errors:ratio_rate5m` with no label
    matchers will show you the label values that do exist, and the misspelling becomes
    obvious in a second — once you think to look.

Put the route back to `/l/{code}`, reload, and run the outage again with room to finish:

```bash
DURATION=600 ./scripts/scenario-outage.sh
```

This scenario drives forty requests per second, so the recorded ratio climbs to 0.30 and
holds there. It crosses 0.20 two thirds of the way up the five-minute window, about three
and a half minutes in, and `for: 5m` turns that into `firing` a little after the
eight-minute mark once the evaluation grid has rounded it. Measured on the lab: the
crossing falls between 200 and 210 seconds, `pending` at 230, `firing` at 500. Watch
`ALERTS{alertname="SnipHighErrorRatio"}` change `alertstate` under you. A firing alert is
the state Chapter 17 picks up from.

There is a second flavor of the same failure, and it needs no typo at all. Snip answers
`503` when it cannot reach Postgres, which on a healthy lab never happens. Ask what that
condition's rate is right now:

```promql
sum by (job) (
  rate(snip_http_requests_total{job="snip-api",
                                code="503"}[5m])
)
```

```text
{job="snip-api"}                                               0
```

Zero. A real answer, from a real series, that exists because Chapter 9 made Snip create all
twelve of its `(route, method, code)` combinations at startup. Now take that away — set
`SNIP_NO_ZERO_INIT=1` in `lab/.env`, run `make up`, give it a minute of traffic, and then
wait five minutes more before asking the identical question:

```text
Empty query result
```

The extra five minutes are the `[5m]` in the expression, not politeness. `make up`
recreates the replicas and Prometheus marks the old series stale, but a range selector
steps over a stale marker and keeps the real samples behind it — so until the last
pre-restart sample ages out, `rate()` is still computing across a series that no longer
exists, and still answering `{job="snip-api"} 0`. The bare selector, without the `rate()`,
is empty at once. A monitoring system's memory of a thing outlives the thing.

"The database has failed nobody in the last five minutes" and "I have no idea whether the
database has failed anybody" are not the same sentence. Put a `> 0` on either and build a
rule out of it, and both render as `inactive`, health `ok`, indistinguishable from the
three real rules beside them. A typo makes an expression permanently unanswerable; a
missing pre-initialization makes it unanswerable until the incident itself creates the
series. Neither shows up in the UI, because Prometheus has no way to know which empty
results you were expecting. The habit that catches both takes ten seconds:

**Before you trust a new alerting rule, paste its expression into the query page with the
comparison removed. If it does not return a row, the rule cannot fire.**

Put `SNIP_NO_ZERO_INIT` back to `0` and run `make up` before continuing.

!!! iou "IOU from chapter 9, settled"
    Chapter 9 used this switch to make a ratio panel go blank and promised it would come
    back to silence an alert. That is what you have just watched, and the mechanism was the
    same both times: an empty result is not a zero, and no part of the system will tell you
    which one you are looking at.

### Two fixes, and what each covers

The first fix is upstream and already in Snip: create the series you know you can produce,
at zero, before the first request. Twelve series, and an alert on a rare condition becomes
testable on a quiet Tuesday.

The second fix is to alert on the absence itself. Add the fourth rule:

```yaml
      - alert: SnipSLIAbsent
        expr: absent(job:snip_sli_valid:rate5m{job="snip-api"})
        for: 10m
        labels:
          severity: page
          service: snip
        annotations:
          summary: >-
            The Snip availability indicator has no data, so anything
            built on it is blind.
          description: >-
            The recording rule job:snip_sli_valid:rate5m produced no
            series for ten minutes. Either snip-api is not being
            scraped, or it has served no redirects at all.
```

`job:snip_sli_valid:rate5m` is the series Chapter 15 recorded as Snip's service level
indicator — the count of redirect requests a judgment about availability may be based on.
Chapter 20 gives that idea its full definition; here it is the series everything else
stands on, which is what makes its disappearance so dangerous.

`absent()` is Chapter 9's function with its polarity inverted: nothing when the argument
has elements, a single element valued `1` when it does not. It is the only rule in this
file that fires when its subject is missing rather than wrong.

The `{job="snip-api"}` matcher is not optional. `absent()` reconstructs its output label
set from the **equality matchers** in the selector, and only those. Write it bare —

```promql
absent(job:snip_sli_valid:rate5m)
```

— and you get an element with no labels, an alert instance carrying nothing but
`alertname`, `severity` and `service`, and a page that cannot say which service went dark.
Written with the matcher, the instance reads:

```text
ALERTS{alertname="SnipSLIAbsent", alertstate="pending",
       job="snip-api", service="snip", severity="page"}        1
```

Chapter 9 recommended `absent_over_time(x[10m])` for alerting, and this rule only appears
to ignore that. `absent_over_time` asks one question about a ten-minute window; `absent()`
plus `for: 10m` asks it at every evaluation and needs all twenty answers to agree. Either
way a missed scrape is survivable.

Be honest about the coverage, and read the rule's own `description` sceptically.
`SnipSLIAbsent` protects the one series it names: it would not have caught the
`/l/{codes}` typo, because the SLI was fine throughout. Nor can it see an idle Snip.
Chapter 9's pre-initialization keeps the twelve counters alive at zero, so a live, scraped
`snip-api` serving no redirects still produces this series reading `0` — a real sample, and
`absent()` stays quiet. That second clause is optimistic: what this rule catches is the
target being gone, not the traffic stopping.

!!! iou "IOU — chapters 18 and 21"
    Two debts, both dated. The only reliable defense against a rule that cannot fire is a
    test that asserts it fires: Chapter 18, "Testing Alerts Before They Page You", writes
    those tests for these four rules. And the threshold-plus-`for` shape you have been
    building all chapter is replaced wholesale in Chapter 21 by paired windows, which need
    neither a guessed threshold nor a stopwatch.

### Why aggregating away `job` breaks routing

One more expression to try, and then a rule never to write:

```promql
sum(rate(snip_http_requests_total{code=~"5.."}[5m]))
```

```text
{}                                                             0
```

The value is beside the point — on an idle lab it is zero, under the outage scenario it
climbs toward ten. Look at the left-hand column instead: `{}`. A bare `sum()` keeps
nothing, so the result element has no labels. Turn it into a rule and the instance reads
`{alertname="…", service="snip", severity="page"}` — the rule's own labels survive,
because they are added after the expression runs, which is the three-source order from the
start of this chapter. What is gone is everything the expression produced: no `job`, no
`route`, and no `instance`, which was never on this alert in the first place.

So the notification arrives, routed correctly by `severity`, and cannot say which job,
replica or route is failing. Nothing can group it with the other alerts about the same job,
because the key is missing. Chapter 17's mechanism for stopping a dead replica paging you
twice compares labels two alerts share, and nobody can key that on `job` when there is no
`job`. Worst of all, this instance is label-for-label identical to the honest version of
the same alert, so the two collapse into one and it is the honest one you stop seeing.

The habit that prevents it is Chapter 15's: aggregate with `by`, name the labels you intend
to keep, and make sure `job` is one of them. Every rule in `snip-alerts.yml` mentions `job`
in its expression, and `make verify-ch16` prints a note if one ever stops.

## Telling Prometheus where to send them

Prometheus decides what is wrong. It does not decide who hears about it: it has no notion
of a person, a schedule or a phone. That is a separate program. Add the last piece of
configuration to `lab/prometheus/prometheus.yml`, above `rule_files:`:

```yaml
alerting:
  alertmanagers:
    - api_version: v2
      static_configs:
        - targets: ["alertmanager:9093"]
```

`make check` runs `promtool check config --lint=all` over that file before you reload it, so
a typo here costs seconds rather than an afternoon.

Prometheus 3 removed support for Alertmanager's v1 API entirely: a config that asks for
`api_version: v1` is rejected at load, and v2 is all that is left. You could omit the key and
get v2 anyway. Write it, because every tutorial older than Prometheus 3 that sets it to `v1`
now describes a configuration that will not start. Your `external_labels` —
`cluster: obslab` and `replica` — ride along on every outgoing alert automatically, which is
how a second Prometheus in Chapter 26, "When One Prometheus Isn't Enough: HA,
`remote_write`, and the Scaling Map", stays distinguishable from this one.

Alertmanager itself arrives in Chapter 17, so for now nothing is listening on that address:
whenever an alert is firing, Prometheus tries to deliver it and logs a failure naming
`alertmanager:9093`. Nothing you have been watching changes — `pending`, `firing` and the
`ALERTS` series are entirely Prometheus-side and do not depend on delivery succeeding.
Internalize that separation now, because "firing but I got no notification" and "a
notification but the alert is not firing" are both normal, and they are questions about two
different programs.

!!! selfcheck "Self-check"
    Run `make verify-ch16`. It takes about two minutes twenty, because it injects a
    ninety-second blip and watches. It must end with `ch16 OK`:

    ```text
    == verify-ch16 ==
       expected runtime: about 2 min 20

    PASS SnipTargetDown is loaded
    PASS SnipLatencyObjectiveAtRisk is loaded
    PASS SnipSLIAbsent is loaded
    PASS SnipHighErrorRatio is loaded
    PASS SnipTargetDown uses for: 2m
    PASS every alerting rule carries severity and service
         SnipHighErrorRatio has for: 300s
         injecting a 90 s blip at a 0.9 error ratio
      [ 10s] pending=- firing=-
      [ 70s] pending=1 firing=-
         [90s] blip over
      [ 90s] pending=1 firing=-
      [130s] pending=1 firing=-
    PASS the blip reached alertstate="pending"
    PASS it never reached alertstate="firing"
    SKIP a five-minute outage produces firing — that needs longer
         than a verify script may take
         → run: DURATION=420 ./scripts/scenario-outage.sh
         → and watch ALERTS{alertname="SnipHighErrorRatio"} on /alerts.

    ch16: 8 passed, 0 failed, 1 skipped
    ch16 OK
    ```

    A few ten-second rows are left out and the SKIP line is wrapped to fit. Read the
    `never reached alertstate="firing"` line narrowly: the script stops watching at 130
    seconds, and `for: 5m` makes `firing` impossible inside that budget, so it proves the
    script saw none — not that none could have come later. The graph you drew is the real
    demonstration.

    Its marks also sit earlier than the arithmetic, for an instructive reason: the script
    steps the load from twenty requests per second to forty as it turns the errors on, so
    the window holds a mixture of two traffic levels and the ratio climbs faster than
    `0.9 × t / 300`. A steady twenty and a steady two thousand give the identical curve.
    It is the *step* that moves the marks, never the rate.

## Common mistakes

**Reading `inactive` as "healthy".** An alert that has never fired and one that cannot fire
look identical. Before trusting a rule, make it true once and watch it go pending. If you
cannot make it true, you do not have an alert, you have a comment.

**Alerting on a raw counter.** `something_total > 100` fires forever and then resolves
itself on a crash. An odometer reading is not a statement about the present.

**Believing the alerts page about delivery.** `firing` in Prometheus means Prometheus
believes it; whether anyone was told is a fact about Alertmanager, and `/alerts` and
`/rules` will never mention it. Prometheus keeps those receipts elsewhere — Status →
Alertmanagers for the endpoints it is trying,
`rate(prometheus_notifications_errors_total[5m])` for the attempts that failed.

**Putting a threshold in two places.** An alert computing its own ratio and a dashboard
computing it slightly differently will disagree during the one hour it matters.

!!! pitfall "The alert that pages a thousand times"
    Every element of the result vector is an alert instance. Put a high-cardinality label in
    the output of an alerting expression — a user ID, a URL path, Snip's `link_code` under
    `SNIP_UNBOUNDED_LABEL` — and one bad afternoon produces one alert per label value. A
    rule group's `limit:` caps the instances its rules may produce, but it does that by
    failing the evaluation, not by picking the important ones. Aggregate before you
    threshold, and keep only the labels a human would read in the message.

## Summary

An alerting rule is a recording rule with a clock and a different destination. Every element
of the result becomes an alert instance with its own identity, lifetime and label set —
inherited from the expression, plus `alertname`, plus the rule's own labels last. The state
machine is small: `inactive` → `pending` when the element appears, `pending` → `firing`
when `for` has elapsed with the element present at *every* evaluation since, and back to
`inactive` the moment it is gone. All of it is visible in the `ALERTS` series.

The things to still know in six months:

- `for` is a debounce, not a duration of badness. One missing evaluation resets it to zero,
  which is why a ninety-minute outage containing a single thirty-second recovery never pages
  a rule with `for: 1h`.
- `keep_firing_for` solves the opposite problem: an alert that resolves and re-fires, or a
  signal that disappears for reasons that are not recovery.
- On a rate-based expression the window is already the noise filter, and lowering a
  threshold to compensate can make an alert fire after the incident is over.
- Prefer ratios. A counter threshold fires forever and resets on restart; a rate threshold
  has to be re-tuned per environment; a ratio is dimensionless and ports unchanged.
- Alert on symptoms. Keep cause alerts only where there is lead time, or where you have lost
  the ability to measure the symptom at all.
- An empty result is not a zero, so an expression over a series that has never existed can
  never fire — and it looks exactly like a healthy one. `absent()` with explicit `=`
  matchers, and pre-initialized label values, are the two defenses.
- `api_version: v2`, because Prometheus 3 dropped v1 entirely.

## Exercises

!!! exercise
    **1. Detection time, predicted then measured (core).** With `for: 5m` and a 30-second
    evaluation interval, how long after the recorded ratio first crosses `0.20` does
    `SnipHighErrorRatio` reach `firing`? Write the prediction down, including the
    contribution of the evaluation interval. Then hold `{"error_ratio":0.9}` for eight
    minutes and measure the gap between the first `pending` sample and the first `firing`
    sample on the `ALERTS` graph. You should be within one evaluation interval; explain the
    residue.

    **2. The odometer, twice broken (core).** Write a rule `SnipErrorCount` on
    `snip_http_requests_total{job="snip-api", code=~"5.."} > 100` with no `for`, carrying
    the same `severity: page` and `service: snip` as the shipped rules — `make verify-ch16`
    checks every alerting rule Prometheus has loaded, not only mine, and fails on one
    without them. Drive enough errors to make it fire, then
    `docker compose restart snip-api`. Describe both failures: the one before the restart
    and the one caused by it. Delete the rule afterwards.

    **3. The unroutable alert (warm-up).** Change `SnipHighErrorRatio`'s expression to
    `sum(rate(snip_http_requests_total{code=~"5.."}[5m])) > 1` and reload. Make it fire.
    Read the label set of the `ALERTS` series it produces, write down which two labels have
    gone and what each was for, then say why `instance` is not one of them and why
    `severity` and `service` survived. Revert.

    **4. Write the annotation you would want (core).** Rewrite
    `SnipLatencyObjectiveAtRisk`'s `description` so a person woken at 3 a.m. can start work
    without opening a dashboard. Use `$labels` once and `$value` with a `humanize` function.
    Keep it under four lines. Chapter 19 grades it against a five-field template.

    **5. Make the silence loud (core).** Stop every `snip-api` replica with
    `docker compose stop snip-api` and time how long `SnipSLIAbsent` takes to reach
    `firing`. Then explain what determined that number — it is not one thing. Start them
    again with `docker compose start snip-api`.

    **6. Rate versus ratio under a traffic change (stretch).** Write two rules on the same
    symptom, both carrying `severity: page` and `service: snip` as in Exercise 2: one on
    `sum by (job) (rate(snip_http_requests_total{job="snip-api", code=~"5.."}[5m])) > 2` and
    one on the recorded ratio at `> 0.20`. With the injector at
    `{"rps":20,"error_ratio":0.3}`, check which fire. Now raise the load tenfold to
    `{"rps":200,"error_ratio":0.3}` without touching either rule — if your laptop cannot
    hold 200, use 100 and call it fivefold. The error *ratio* has not changed; the *rate*
    has. Which rule still says the same thing? Delete the rate rule when you are done.
