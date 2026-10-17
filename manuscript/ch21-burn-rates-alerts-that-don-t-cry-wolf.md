# Chapter 21 — Burn Rates: Alerts That Don't Cry Wolf

Chapter 20 left you holding two numbers and a budget. Snip must serve 99.5 % of
redirects without failing, over a rolling thirty days, and 0.5 % of thirty days
is 216 minutes of total failure to spend. The obvious next move is to alert when
you start spending it.

Try it and watch what happens. You write one rule that fires whenever the error
ratio exceeds 0.5 %, and on Tuesday morning it pages you at 09:02 for a
forty-second blip that cost eleven seconds of the 216. You add `for: 15m` to
calm it down, and on Thursday a real outage runs for nineteen minutes with two
healthy evaluations in the middle, and nobody is woken at all. By Friday the
rule is commented out, and Snip is unmonitored again with a straight face.

This chapter fixes that, and it fixes it by arithmetic rather than by taste. You
will replay six approaches in the order the industry actually discovered them,
each one motivated by the concrete failure of the one before, and land on four
alerting rules whose thresholds you can derive from scratch on the back of an
envelope. By the end, `14.4` will not be a magic number you copied from a blog
post. It will be a multiplication you can do in your head, and redo for a
seven-day window when somebody hands you one.

!!! objectives "Objectives"
    After this chapter you can:

    - Derive any burn-rate threshold from `budget_fraction × period /
      long_window`, without looking up a table.
    - Say in one sentence what the long window decides and what the short
      window decides.
    - Implement four tiers as alerting rules over your own recording rules, and
      route two to a pager and two to a ticket queue.
    - Predict how long an alert will take to fire, then check it against the
      clock.
    - Diagnose the low-traffic failure and pick a fix with its cost stated out
      loud.
    - Recognize Sloth- and Pyrra-generated rules in a repository you inherited,
      and edit them without silently killing them.

## Where the lab is

Everything here runs against the stack as Chapter 20, "SLIs, SLOs and Error
Budgets", left it: `docs/SLO.md` declaring the two objectives, and
`lab/prometheus/rules/snip-recording.yml` carrying the windowed SLI ladder that
chapter built. The `ch21` tag already holds the finished `snip-burnrate.yml`, guards
included, its test file and the new inhibit rule, with `SnipHighErrorRatio` already
deleted — read along with those. To build them yourself, check out `ch20` instead; the
steps in this chapter start there, which is why the low-traffic test fails the first time you run
it.

```bash
cd lab
git checkout ch21
make check
make up
make ps
```

Put the load generator into a known, healthy state:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","error_ratio":0}'
```

Prometheus is on `http://localhost:9090/`, Alertmanager on
`http://localhost:9093/`, and the pager on `http://localhost:5001/`.

Three things from Chapter 20 are load-bearing. The first is the ladder itself:
eight recorded windows for the availability SLO, from five minutes to thirty
days. Check that the rungs you are about to use exist:

```promql
job:snip_sli_availability:ratio_rate1h{job="snip-api"}
```

One series, `{job="snip-api"}`, reading `1` on a healthy lab — or a hair under 1
if you have been running scenarios.

The second is that **these rungs record a success ratio, not an error ratio**.
`job:snip_sli_availability:ratio_rate1h` is the fraction of redirects that
worked. Every expression in this chapter therefore starts with `1 -` to get the
fraction that failed. That is a real fork in the road: Sloth, which you will
meet at the end of this chapter, records the error ratio instead, so its rules
read `> threshold` where yours read `1 - x > threshold`. Copy one convention's
expression onto the other convention's metric name and you have inverted the
alert without changing a single number.

The third is the budget: `1 - 0.995 = 0.005`. Every threshold below is that
number multiplied by something.

## Approach 1 — alert on the objective itself

The first thing everyone writes is the objective, turned into a comparison.

```promql
1 - job:snip_sli_availability:ratio_rate5m{job="snip-api"} > 0.005
```

Give it a background to work against. Start the drip scenario, which drives
40 requests per second with 1 % of redirects failing, and leave it running:

```bash
./scripts/scenario-drip.sh --no-wait
```

Within about five minutes the expression above returns a series with a value
near `0.01`, and it keeps returning it for as long as the drip runs. Turn it
into an alert with no `for:` and it pages immediately, then pages again on every
repeat interval, for the whole hour.

Now ask what that page is worth. One percent of redirects failing is twice the
budget, which means the month's 216 minutes are gone in fifteen days. That is a
genuine problem and a genuinely slow one. It deserves a ticket on Monday. It
does not deserve a human being awake at 04:00, and any rule that cannot tell
those two apart will be silenced within a week.

The flaw has a name: **precision**. The rule is perfectly sensitive — it catches
everything — and almost worthless at telling you whether what it caught matters.
Stop the drip before moving on:

```bash
curl -s -XPOST http://localhost:8089/chaos/reset
```

## Approach 2 — use a much longer window

The instinct is to look at more time. The ladder already has a one-day rung:

```promql
1 - job:snip_sli_availability:ratio_rate1d{job="snip-api"} > 0.005
```

This is better. A forty-second blip is one part in 2,160 of a day, so it cannot
move the number far enough to trip anything. Precision improves.

What breaks instead is **reset time**. Run the fifteen-minute outage and then
watch the two windows next to each other on one graph — the five-minute rung and
the one-day rung:

```bash
DURATION=900 ./scripts/scenario-outage.sh
```

```promql
1 - job:snip_sli_availability:ratio_rate5m{job="snip-api"}
```

The five-minute line climbs to about 0.30, holds while the outage runs, and is
back at zero five minutes after it ends. The one-day line barely moves — and
whatever it moved to, **it stays there until tomorrow**, because a fifteen-minute
outage sits inside a twenty-four-hour window for twenty-four hours. Your alert
fires long after you have fixed the problem, and there is nothing you can do
about it except wait for the calendar.

An alert that will not clear is worse than a noisy one. People learn to ignore
it, and then they ignore the next one.

## Approach 3 — a short window with a long `for:`

The third instinct is the one Chapter 16 already dismantled. Take a fast window
and demand that it stay bad for an hour:

```yaml
      - alert: SnipBudgetBurning
        expr: |
          1 - job:snip_sli_availability:ratio_rate5m{job="snip-api"}
            > 0.005
        for: 1h
```

Chapter 16, "Alerting Rules, and What 'Firing' Actually Means", proved on your
own screen why this does not work. `for:` requires the condition to be true at
**every single evaluation** in the interval. At a 30-second evaluation interval,
an hour is 120 consecutive evaluations, and one healthy one anywhere in that
hour throws the whole clock away and starts it again from zero. Chapter 16's
`scenario-flap.sh` produced a signal that was bad half the time for ten minutes
and never left `inactive`.

`for:` is a debounce on a switch. It suppresses brief self-correcting nonsense,
which is a real and useful job. It is not a measurement of how long something
has been broken, and the longer you make it the more fragile it gets, because
you have handed more evaluations the chance to spoil it. The SRE literature
rejects this approach by name, and so should you.

Three approaches in, and each one traded a flaw for a different flaw. The reason
is that all three are asking the wrong question. They ask *how bad is it right
now*. The question that decides whether to wake somebody is *how much of the
month am I about to lose*.

## Approach 4 — alert on the burn rate

Here is the idea that makes the rest of the chapter possible.

!!! jargon "Burn rate"
    The burn rate is how fast you are spending the error budget, expressed as a
    multiple of the rate that would spend exactly all of it in exactly one SLO
    period. A burn rate of 1 means you will finish the thirty days with nothing
    left and nothing spare. A burn rate of 2 means the budget is gone in fifteen
    days. A burn rate of 60 means it is gone in twelve hours.

Because the budget is itself an error ratio, the burn rate is the observed error
ratio divided by the budget:

```promql
(1 - job:snip_sli_availability:ratio_rate1h{job="snip-api"}) / 0.005
```

Run that during the drip and it reads about 2. Run it during the outage and it
climbs toward 60. It is a dimensionless number that means the same thing on a
service doing ten requests a second and one doing ten thousand, and it means the
same thing at 99.5 % as at 99.9 % — which is exactly what a threshold you want
to reuse should look like.

### Deriving the threshold, so you never have to look one up

Now choose a threshold. Not by taste: by arithmetic.

Suppose you burn at rate *B* for a window of *W* hours, and your SLO period is
*P* hours. You will have spent

```text
    B × W / P
```

of the budget by the end of that window. That is the whole model. Now flip it
around. Decide the only thing that is genuinely yours to decide — *how much of
the month am I willing to lose before somebody is interrupted?* Call that
fraction *F*. Then set `B × W / P = F` and solve:

```text
    burn rate = budget_fraction × period / long_window
```

For Snip the period is 30 days, which is 720 hours. Pick "I will spend 2 % of
the month before I page anybody" and a one-hour window:

```text
    0.02 × 720 / 1 = 14.4
```

There it is. Not a magic number, not a convention, not something you memorize:
one multiplication and one division from two decisions you already made. Do it
three more times with three more pairs:

```text
    spend  2 % over  1 hour   →  0.02 × 720 /  1  = 14.4
    spend  5 % over  6 hours  →  0.05 × 720 /  6  =  6
    spend 10 % over  1 day    →  0.10 × 720 / 24  =  3
    spend 10 % over  3 days   →  0.10 × 720 / 72  =  1
```

To turn a burn rate into something you can compare a recorded ratio against,
multiply by the budget:

```text
    14.4 × 0.005 = 0.072    ( 7.2 % of redirects failing)
       6 × 0.005 = 0.030    ( 3.0 %)
       3 × 0.005 = 0.015    ( 1.5 %)
       1 × 0.005 = 0.005    ( 0.5 %)
```

Write the multiplication into the rule rather than the product. `> (14.4 *
0.005)` says where the number came from; `> 0.072` says nothing, and the next
person to change the objective will not know to change it.

A single tier looks like this:

```promql
(1 - job:snip_sli_availability:ratio_rate1h{job="snip-api"})
  > (14.4 * 0.005)
```

Precision and detection are both good now. What is still wrong is reset time:
this reads a one-hour window, so it stays true for up to an hour after the
incident ends. And one tier cannot be both fast and quiet — 14.4 will never
notice a slow leak, and a threshold low enough to notice a slow leak will page
you for one.

## Approach 5 — several burn rates at once

So use more than one tier. A fast one that pages, a slow one that opens a
ticket, combined with `or`:

```promql
(1 - job:snip_sli_availability:ratio_rate1h{job="snip-api"})
  > (14.4 * 0.005)
or
(1 - job:snip_sli_availability:ratio_rate6h{job="snip-api"})
  > (6 * 0.005)
```

Recall improves: fast burns and slow burns both get caught, by the tier suited
to each. But reset time has not improved at all — the six-hour clause stays true
for six hours after recovery — and you now have several windows and several
thresholds to reason about at once.

## Approach 6 — multiwindow, multi-burn-rate

The last move is small and it is the one that matters. For each tier, require
**two** windows to be over the threshold at the same time: the long one, and a
short one.

```promql
(1 - job:snip_sli_availability:ratio_rate1h{job="snip-api"})
  > (14.4 * 0.005)
and
(1 - job:snip_sli_availability:ratio_rate5m{job="snip-api"})
  > (14.4 * 0.005)
```

Read what the second clause buys you. When the incident ends, the five-minute
window empties out in five minutes and the whole conjunction goes false — even
though the one-hour window will stay elevated for another fifty-five. Reset time
drops from the length of the long window to the length of the short one.

**The long window decides whether this is worth paging about; the short window
decides whether it is still happening.** That single sentence is the whole of
multiwindow, multi-burn-rate alerting. Everything else is arithmetic.

The short window is the long window divided by twelve, every time:

```text
    1 h / 12 =  5 m        1 d / 12 = 2 h
    6 h / 12 = 30 m        3 d / 12 = 6 h
```

Twelve is a choice, not a law, and it is the SRE workbook's choice. It is short
enough that recovery clears the alert quickly and long enough that the short
window still contains a real number of events rather than a coin flip. Divide by
sixty instead and the alert will flap on any service quiet enough to have gaps.

### The four tiers

| Tier | Long / short | Burn rate | Error ratio |
|---|---|---|---|
| 1 — page | 1 h / 5 m | 14.4 | 7.2 % |
| 2 — page | 6 h / 30 m | 6 | 3.0 % |
| 3 — ticket | 1 d / 2 h | 3 | 1.5 % |
| 4 — ticket | 3 d / 6 h | 1 | 0.5 % |

You will find a great many copies of this table on the internet with only three
rows — the 1 d / 2 h tier at burn rate 3 missing. That three-row version is real:
it is the recommended-parameters *table* in the SRE workbook. The workbook's own
Approach-6 *example code*, a few paragraphs earlier in the same chapter, has
four. Every mainstream implementation followed the code rather than the table:
Sloth's shipped window catalog has four tiers, Pyrra has four, and Grafana
Cloud's SLO alerting pairs the same four burn rates into two alerts. Use four.
The missing tier is the one that catches a 1.5 % error ratio, which is three
times your budget and completely invisible to the other three.

## Two numbers that fall out for free

Once the thresholds are derived rather than copied, two more numbers come out of
the same arithmetic, and both change how you argue about alerts.

### What each tier costs you when it fires

Rearrange the derivation and you get the budget already spent at the moment an
alert fires:

```text
    budget consumed = long_window × threshold / period
```

Which returns exactly the fraction you put in. Tier 1 fires having spent 2 % of
the month; tier 4 fires having spent 10 %. Snip's budget is 216 minutes, so:

| Tier | Budget spent when it fires | In minutes |
|---|---|---|
| 1 | 2 % | 4.3 |
| 2 | 5 % | 10.8 |
| 3 | 10 % | 21.6 |
| 4 | 10 % | 21.6 |

Notice what is *not* in that formula: the severity of the incident. A tier costs
you the same slice of budget whether it was tripped by a total outage or by a
long grinding drip, because the threshold and the window were chosen together to
make it so. The design knob is not "how bad must it be". It is **how much of the
month am I willing to lose before waking someone**, which is a question a
non-engineer can answer and a question you can defend in a review.

### How long you will wait

The same model predicts detection time. The long window is a rolling average, so
after *t* minutes of an incident that is *B* times over budget, the window reads
`t / W` of the way toward *B*. It crosses the threshold when

```text
    detection time = long_window × threshold / actual_burn_rate
```

Two assumptions are hiding in that line and you should know both. It assumes the
window was clean before the incident started, and it assumes the request rate
does not change. Neither is always true, and the next section is where you watch
one of them break.

The formula also has nothing to say when the actual burn rate is *below* the
threshold. Detection time is then infinite, which is not a defect — that is the
alert correctly declining to fire.

## Writing the four rules

Create `lab/prometheus/rules/snip-burnrate.yml`. Start with the first tier, and
leave out the minimum-events guard for now — you are going to discover why it
exists rather than being told.

```yaml
groups:
  - name: snip-burnrate
    interval: 30s
    rules:
      - alert: SnipAvailabilityBurnFast
        expr: |
          (
            (1 - job:snip_sli_availability:ratio_rate1h{job="snip-api"})
              > (14.4 * 0.005)
            and
            (1 - job:snip_sli_availability:ratio_rate5m{job="snip-api"})
              > (14.4 * 0.005)
          )
        for: 2m
        labels:
          severity: page
          service: snip
          route: "/l/{code}"
        annotations:
          summary: >-
            Snip is burning its 30-day error budget about fourteen
            times too fast.
          description: >-
            {{ $value | humanizePercentage }} of redirects have failed
            over the last hour, against a budget of 0.5 percent. At
            this rate the whole 30-day budget is gone in roughly two
            days, and every visitor following a short link can see it.
          first_step: >-
            Open the SLO dashboard and split the error rate by
            instance: one bad replica and a bad deploy look completely
            different.
          dashboard_url: http://localhost:3000/d/snip-slo?from=now-6h&to=now
```

There is a fifth annotation in the shipped file, `runbook_url`, built
mechanically from the lowercased alert name exactly as Chapter 19, "What a Page
Should Say, and Who Watches the Watcher", specified. It is too long for a printed
line; read it in the repository.

Four details in that block are decisions rather than typing.

`interval: 30s` on the group matches the interval of the recording-rule groups it
reads. An alert cannot be fresher than the series underneath it, and evaluating
the alert twice as often as the series it consumes only means evaluating the same
sample twice.

`for: 2m` is a debounce and nothing more. It exists so that a single strange
evaluation does not page anybody. The short window is what handles duration, and
the derivation already accounted for the delay; two minutes on top of a
fourteen-minute detection time is noise. Note that the generators disagree here:
Sloth emits no `for:` at all on burn-rate alerts.

The `labels:` block carries `severity: page`, which is routing and not
decoration — Chapter 17, "Alertmanager: Routing, Grouping and Silence", made `severity` the thing the route tree
matches on. `service` and `route` are there so the inhibit rules later in this
chapter have stable labels to compare.

`$value` in the description is the value of the whole expression, and an `and`
returns the values of its left-hand side. So the number the page carries is the
**one-hour** error ratio, which is the right one to quote: it is the long window,
the one that decided this was worth an interruption.

Now add the other three. They are the same shape with the pairs from the table
substituted, and two changes: tiers 3 and 4 carry `severity: ticket` and
`for: 15m`. Fifteen minutes is free on a rule whose long window is a day — nobody
is measuring reaction time on a ticket — and it buys immunity to a class of
transient nonsense the two-minute debounce would let through.

```yaml
      - alert: SnipAvailabilityBurnVerySlow
        expr: |
          (
            (1 - job:snip_sli_availability:ratio_rate3d{job="snip-api"})
              > (1 * 0.005)
            and
            (1 - job:snip_sli_availability:ratio_rate6h{job="snip-api"})
              > (1 * 0.005)
          )
        for: 15m
        labels:
          severity: ticket
          service: snip
          route: "/l/{code}"
```

Write `(1 * 0.005)` rather than `0.005`, even though the multiplication is a
no-op. Four rules that all say `(<burn> * 0.005)` are four rules you can read as
a set, and `make verify-ch21` greps for exactly that form.

Reload and confirm all four loaded:

```bash
curl -s -XPOST http://localhost:9090/-/reload
```

Then open `http://localhost:9090/alerts`. Four new rules under the group
`snip-burnrate`, all `inactive`, all green.

## Why `and` works, and the one edit that kills it

Stop and look at the operator in the middle of every one of those expressions,
because it is where these rules break.

`A and B` returns the elements of `A` that have an **exactly matching label set**
in `B`. Matching compares every label except `__name__`, which is the only reason
this works at all: the two sides have different metric names —
`job:snip_sli_availability:ratio_rate1h` and `…:ratio_rate5m` — and the operator
does not care. Both sides come out of `sum by (job)`, so both carry exactly one
label, `{job="snip-api"}`, and they match.

Now break it. Chapter 9, "Ratios, Arithmetic, and the Series That Isn't There",
gave you `label_replace`; use it to put one extra label on one side:

```promql
(1 - job:snip_sli_availability:ratio_rate1h{job="snip-api"})
  > (14.4 * 0.005)
and
(1 - label_replace(
      job:snip_sli_availability:ratio_rate5m{job="snip-api"},
      "window", "5m", "", ""))
  > (14.4 * 0.005)
```

!!! trap "The alert that can never fire, and never says so"
    Put that expression in the rule, reload, and run a full outage. Nothing
    happens. Not `pending`, not `firing`, no error in the log, no red banner on
    `/rules`. The rule's health reads `ok`, because as far as Prometheus is
    concerned the expression evaluated perfectly and returned nothing.

    Run each half separately in the expression browser and the reason is one
    label wide:

    ```text
    {job="snip-api"}                    0.30012
    {job="snip-api", window="5m"}       0.30028
    ```

    And the two together:

    ```text
    Empty query result
    ```

    A rule that has never fired and a rule that *cannot* fire render
    identically. This is the same silent failure Chapter 16 planted with a
    misspelled route label, arriving by a different door.

This is exactly why generated rules look the way they do. Sloth attaches a
`sloth_window` label to every recorded rung — `5m`, `1h`, `2h` and so on — which
means the two sides of every one of its conjunctions differ by construction. So
every clause Sloth emits is wrapped:

```promql
max(slo:sli_error:ratio_rate5m{sloth_id="snip-availability"}
    > (14.4 * 0.005)) without (sloth_window)
```

The `max(...) without (sloth_window)` does two jobs at once. It removes the one
label that differs, and — because it is an aggregation — it drops `__name__` as
well. Delete that wrapper because it looks like ceremony, and the alert stops
firing forever, silently, with a perfectly healthy rule. It is the single most
common way a working SLO alert gets killed by a tidy-up commit.

The rules you wrote avoid the whole problem by keeping the window in the metric
*name* instead of in a label. That is less ceremony, and it is a real trade-off:
you cannot select "all windows" with one matcher the way Sloth can.

Put the rule back the way it was before continuing.

## Watch it fire, and time it first

Now the part the whole chapter has been building toward. Before you run anything,
predict.

`scenario-outage.sh` drives 40 requests per second with 30 % of redirects
failing. That is an error ratio of 0.30 against a budget of 0.005, so the burn
rate is **60**. Feed that into the detection formula, holding the request rate
constant:

| Tier | threshold ÷ 60 | × long window | with `for:` |
|---|---|---|---|
| 1 | 0.24 | 14.4 min | ≈ 16 min |
| 2 | 0.10 | 36 min | ≈ 38 min |
| 3 | 0.05 | 72 min | ≈ 87 min |
| 4 | 0.017 | 72 min | ≈ 87 min |

Write those down. Then run it for half an hour so that tier 2 has a chance too:

```bash
DURATION=1800 ./scripts/scenario-outage.sh --no-wait
```

Watch `http://localhost:9090/alerts`, or query the alert state directly:

```promql
ALERTS{alertname=~"SnipAvailabilityBurn.*"}
```

Tier 1 will fire **early** — at roughly ten minutes, not sixteen. That is not a
mistake in the formula and it is not a mistake in the rule. It is the second
hidden assumption breaking, and it is worth the two minutes it takes to see why.

The scenario does not only inject errors; it raises the request rate from 20 to
40. The redirect route gets 80 % of the mix, so it goes from 16 requests per
second to 32, of which 9.6 per second now fail. The one-hour window therefore
fills with outage traffic **twice as fast** as the formula assumed, because each
minute of outage contributes twice as many events as each minute of the healthy
hour it is displacing. Working the ratio out minute by minute:

```text
    error ratio after t minutes
      = 9.6 t / (32 t + 16 (60 - t))
      = 9.6 t / (16 t + 960)

    crosses 0.072 at t ≈ 8.2 minutes
```

Add the two-minute debounce and the page lands at about ten minutes. Tier 2's
six-hour window crosses at about nineteen minutes by the same arithmetic, so it
pages at roughly twenty-one.

The lesson generalizes, and it cuts both ways. **Detection time depends on the
mix of traffic inside the window, not only on the severity of the incident.** An
incident that arrives with a traffic spike is detected sooner than the formula
says. An incident that makes users give up and go away — a checkout that hangs,
a page that will not load — reduces the request rate, and is detected *later*.
Use the formula as the number to argue with, not as a promise.

Look at the pager on `http://localhost:5001/` while this runs. Two of the four
alerts carry `severity: page`, and Chapter 17's route tree sends those to the
`pager-page` receiver and then — because that route sets `continue: true` — on to
`pager-ticket` as well, so every page is also written to the ticket queue as a
record. Tickets go to `pager-ticket` only.

!!! selfcheck "Self-check"
    While the outage is running, `ALERTS{alertname=~"SnipAvailabilityBurn.*"}`
    must return at least one series with `alertstate="firing"` and
    `severity="page"` within fifteen minutes of the start. If it returns nothing
    after twenty minutes, run each half of the tier-1 conjunction on its own and
    compare the label sets character by character. That is the trap above, and it
    is the first thing to rule out.

Reset the injector when you are done:

```bash
curl -s -XPOST http://localhost:8089/chaos/reset
```

## The drip that must never page

Now the opposite case, and the one that justifies the chapter's title.

```bash
DURATION=1800 ./scripts/scenario-drip.sh --no-wait
```

One percent of redirects failing. Burn rate 2. Above tier 4's threshold of
0.005, below tier 3's 0.015, and an order of magnitude below either paging tier.
Predict before you look: the only alert in the file that is *eligible* to fire is
`SnipAvailabilityBurnVerySlow`, and it is a ticket.

Watch two things. The observed ratio settles near 0.01:

```promql
1 - job:snip_sli_availability:ratio_rate1h{job="snip-api"}
```

And the budget gauge falls, visibly, over the half hour:

```promql
slo:error_budget_remaining:ratio30d
```

Nothing pages. That is what "alerts that don't cry wolf" means, and you have
watched a real, ongoing, budget-consuming problem fail to wake anybody.

Be honest about what an hour cannot show you, though. Tier 4's long window is
three days. On a lab that has been healthy for a while, thirty minutes of drip
does not dominate three days of clean traffic, so the ticket will not appear
inside your session no matter how long you sit there. The detection formula says
so out loud: `72 h × 1 / 2 = 36 hours`. That tier is proved deterministically by
the unit tests in the next section, which build the whole incident synthetically
in about a second. What the live run reliably shows is the budget falling with
nobody being woken, and that is the claim that matters.

## Testing the tiers, and finding the low-traffic failure

Chapter 18, "Testing Alerts Before They Page You", turned rules into code you can
grade. Create `lab/prometheus/rules/tests/snip-burnrate_test.yml` and load both
the recording rules and the burn-rate rules, in evaluation order:

```yaml
rule_files:
  - ../snip-recording.yml
  - ../snip-burnrate.yml

evaluation_interval: 30s

group_eval_order:
  - snip-red
  - snip-slo
  - snip-burnrate
```

The first case is the outage: 100 redirects every 30 seconds, ten percent of them
failing.

```yaml
tests:
  - name: a sustained ten percent error ratio fires all four tiers
    interval: 30s
    input_series:
      - series: 'snip_http_requests_total{job="snip-api",
                 instance="snip-api-1", env="lab", route="/l/{code}",
                 method="GET", code="302"}'
        values: "0+90x160"
      - series: 'snip_http_requests_total{job="snip-api",
                 instance="snip-api-1", env="lab", route="/l/{code}",
                 method="GET", code="500"}'
        values: "0+10x160"
```

Ten percent is past 7.2 %, so both paging tiers fire — and it is past every other
threshold too, and the one-day and three-day windows contain the same seventy
minutes of data, so **all four fire at once**. Assert that explicitly rather than
letting it be an accident. Four alerts for one outage is the design: the tiers
exist to catch a burn at four different speeds, and collapsing them belongs in
Alertmanager, not in the expression.

The second case is the drip — one percent — asserting `exp_alerts: []` for the
three faster tiers and a single ticket from the slowest. Negative cases are the
valuable ones, and this one is the chapter's whole promise reduced to something a
machine can check.

### Why the three-day tier is not really tested

You may notice the test never actually gives the slow tiers three days of
samples. It does not, and pretending otherwise would be worse than saying so:
generating three days of 30-second samples for a unit test costs 8,640 points per
series and buys nothing. Over a seventy-minute test the one-day and three-day
windows contain whatever data exists, which is enough to exercise everything
that genuinely breaks in these rules — the label sets on either side of each
`and`, the thresholds, and the guard. What a three-day fixture would additionally
prove is that `rate()` works over long ranges, and that is Prometheus's problem,
not yours.

### The case that fails

Now add the third case, and expect it to fail. A near-idle service: one redirect
every two minutes, nine tenths of one of them good — thirty redirects an hour,
three of them failing.

```yaml
  - name: the minimum-events guard stops a near-idle service
    interval: 2m
    input_series:
      - series: 'snip_http_requests_total{job="snip-api",
                 instance="snip-api-1", env="lab", route="/l/{code}",
                 method="GET", code="302"}'
        values: "0+0.9x60"
      - series: 'snip_http_requests_total{job="snip-api",
                 instance="snip-api-1", env="lab", route="/l/{code}",
                 method="GET", code="500"}'
        values: "0+0.1x60"

    alert_rule_test:
      - eval_time: 70m
        alertname: SnipAvailabilityBurnFast
        exp_alerts: []
```

Run it:

```bash
make test-rules
```

```text
Unit Testing:  /etc/prometheus/rules/tests/snip-burnrate_test.yml
  FAILED:
    alertname: SnipAvailabilityBurnFast, time: 70m,
        exp:[],
        got:[
            0:
              Labels:{alertname="SnipAvailabilityBurnFast",
              job="snip-api", route="/l/{code}",
              service="snip", severity="page"}
        ]
```

*(Output trimmed to fit the page; the real failure also prints the rendered
annotations.)*

Three failed requests in an hour paged you. And the rule is right: three
failures in thirty requests is a 10 % error ratio, comfortably past 7.2 %, which
by the arithmetic really is a burn rate of twenty. The arithmetic is correct and
the conclusion is absurd.

## The low-traffic problem

This is the dominant real-world failure of SLO alerting for a service the size of
the one you probably run, and most treatments skip it.

At 99.5 %, tier 1 trips at a 7.2 % error ratio. If your service handles ten
requests an hour, **one** failure is a 10 % error ratio. You will be paged for a
single request. Push the target up to 99.9 % and it gets worse, not better: the
tier-1 threshold falls to 1.44 %, and now a single failure in ten is seven times
over it.

The root cause is not the threshold. It is that a ratio computed from a handful of
events is not a measurement. Nine successes and one failure is consistent with a
true failure rate anywhere from about 0.3 % to 45 %, and no alerting rule can
extract certainty that the data does not contain.

Watch it against real series:

```bash
DURATION=900 ./scripts/scenario-low-traffic.sh
```

The script drops Snip to ten requests an hour, waits a minute for the windows to
notice, and then forces exactly one failure by hand — the same `curl` you could
type yourself:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'X-Snip-Fail-Ratio: 1' http://localhost:8080/l/obslab
```

!!! warning "What the live run can and cannot show you"
    Your one-hour window still holds the previous hour of healthy traffic —
    tens of thousands of redirects — so the ratio stays microscopic and nothing
    fires. That is not the guard working. It is the window remembering. The
    low-traffic failure belongs to a service that is *always* quiet, and you
    cannot conjure one inside a session on a lab that has been busy. The live
    run shows you the two halves of the rule on real series; the unit test above
    is what proves the failure, in one second, deterministically.

### Five fixes, and what each one costs

There are five honest fixes. None of them is free, and the ranking below is by
how much you give up.

**A minimum-events guard.** Require a floor of valid events in the long window
before the ratio is allowed to mean anything. This is what the lab ships, and it
is first because the cost is the smallest and the most explicit: below the floor,
these alerts are switched off rather than wrong. Grafana Cloud's SLO product
exposes the same idea under the name "Minimum Failures".

**A wider long window.** Thirty days instead of seven gives every tier more
events. Cost: slower detection, and a longer memory of every incident.

**A looser target.** 99 % instead of 99.9 % raises every threshold in absolute
terms, so a single failure has further to reach. Cost: you have promised your
users less, which is a product decision wearing an engineering costume.

**Aggregate across services.** One SLO for the whole product instead of one per
endpoint gives you a bigger denominator. Cost: you lose the attribution. A total
outage of one small service is a rounding error in the aggregate.

**Synthetic probe traffic.** A prober hitting the endpoint every fifteen seconds
puts a floor of 240 events an hour under the denominator, and turns "no traffic"
into "measurable availability". Cost: part of your SLI is now measuring a robot
rather than a user, and you have added a component whose own failure looks like
your service failing.

!!! iou "IOU — chapter 23"
    You do not have a prober yet, so the fifth fix is not something you can
    implement today. Chapter 23, "The Multi-Target Pattern: Probing From Outside",
    builds one, and it is worth coming back to this list afterward.

### Sizing the guard, per tier

Take the first fix. The guard itself is one clause appended to each rule:

```yaml
          and
          sum by (job) (
            increase(snip_http_requests_total{job="snip-api",
                                              route="/l/{code}"}[1h])
          ) >= 60
```

`sum by (job)` matters: the output has to carry the same single `job` label as
the two ratio clauses, or you have just written the label trap into your own fix.

Now the number. Sixty is not a taste. With *N* valid events in the long window,
one failure is an error ratio of `1/N`, so a single failure is enough to trip a
tier whenever `N < 1 / threshold`:

| Tier | 1 / error ratio | Guard shipped |
|---|---|---|
| 1 (1 h) | 13.9 | 60 |
| 2 (6 h) | 33.3 | 60 |
| 3 (1 d) | 66.7 | 67 |
| 4 (3 d) | 200 | 200 |

!!! pitfall "One guard for all four tiers"
    The obvious move is a single number everywhere, and this file shipped a flat
    `>= 60` first. Sixty is comfortably above what tiers 1 and 2 need and
    **below** what tiers 3 and 4 need. One failed redirect in sixty a day is
    1.67 %, which is past tier 3's 1.5 % and past tier 4's 0.5 % — so both ticket
    tiers opened a ticket for one request, and the fix that was supposed to stop
    spurious alerts quietly did not. Each guard has to be the larger of
    `1 / threshold` and whatever floor you consider the minimum measurable rate.

Sixty valid redirects in an hour is one a minute. Below that, this lab declares
the availability SLO unmeasurable and turns these alerts off. That is the cost,
stated plainly, and it should make you slightly uncomfortable — because there is
now a band between one and fifty-nine redirects an hour where the SLI exists (so
`SnipSLIAbsent` stays quiet) and the burn alerts are muted. If that band matters
for your service, alert on the valid-event rate itself falling below the floor:

```promql
job:snip_sli_valid:rate5m{job="snip-api"} < 60 / 3600
```

Add the guards, with the per-tier numbers, and run the suite again:

```bash
make test-rules
```

```text
Unit Testing:  /etc/prometheus/rules/tests/snip-alerts_test.yml
  SUCCESS
Unit Testing:  /etc/prometheus/rules/tests/snip-burnrate_test.yml
  SUCCESS
```

## Deleting the old alert, and keeping the one that matters

Two edits to `lab/prometheus/rules/snip-alerts.yml` finish the lab step.

**Delete `SnipHighErrorRatio`.** It was Chapter 16's threshold on the error
ratio, with a 20 % boundary that was picked because one redirect in five failing
is unambiguously bad. It has now been superseded four times over by rules whose
thresholds come from a written-down objective. Leaving it in place does not make
you safer; it pages you twice for one outage, from two rules that disagree about
what "bad" means. `make verify-ch21` checks that it is gone. Chapter 16
promised the threshold-plus-`for` shape would be replaced wholesale, and this
is the replacement: *IOU from chapter 16, settled.*

**Keep `SnipSLIAbsent`.** Every rule you wrote today is built on
`job:snip_sli_availability:ratio_rate*`, and an expression over a series that
does not exist returns nothing and therefore never fires — forever, with a
perfectly healthy-looking rule.

```promql
absent(job:snip_sli_valid:rate5m{job="snip-api"})
```

That is the only alert in the repository whose value is always 1 when it fires.
It is the floor underneath everything else in this chapter, and it costs one
rule.

One edit to `lab/alertmanager/alertmanager.yml`. A sustained outage trips all
four tiers, and four notifications for one incident is exactly the noise this
chapter exists to prevent — but the place to fix it is Alertmanager, not the
expressions. Suppressing the slow tiers inside the rules would mean the fast
tier's `for: 2m` gates them all.

```yaml
inhibit_rules:
  - source_matchers:
      - 'alertname = "SnipAvailabilityBurnFast"'
    target_matchers:
      - 'alertname =~ "SnipAvailabilityBurn(Medium|Slow|VerySlow)"'
    equal: [job, service, route]
```

Every alert involved carries all three of `job`, `service` and `route`, which is
what makes this rule safe: an `equal` list naming a label that is missing from
both sides counts as a match, and that is how inhibit rules silence things nobody
meant to silence. Extend the existing `SnipTargetDown` inhibit rule's target
matcher to cover `SnipAvailabilityBurn.*` at the same time — a replica that has
stopped answering is the cause, and the burn rates climbing are the symptom.

!!! selfcheck "Self-check"
    ```bash
    make verify-ch21
    ```

    It prints one `PASS` line per tier for each of loaded, windows, threshold and
    severity, then checks the deletion, `SnipSLIAbsent`, the test file, the test
    suite and the two Alertmanager routes. It must end with:

    ```text
    ch21: 21 passed, 0 failed, 1 skipped
    ch21 OK
    ```

    The skip is the live outage and drip scenarios: 15 and 60 minutes, longer
    than a verify script may take. You have already run them by hand.

## Generators: Sloth and Pyrra

Nothing you wrote today was hard, but you wrote nine expressions and four rules
for **one** SLO, and you have two. Multiply by a dozen services and hand-writing
stops being a virtue. Two tools generate all of it, and you will meet their
output in somebody else's repository before you ever choose to adopt one. The
point of this section is recognition, not installation.

**Sloth** (v0.16.0, April 2026, `ghcr.io/slok/sloth:v0.16.0`) is a generator and
nothing else. You give it a fifteen-line spec — service, objective, an error
query, a total query — and it emits a rules file you commit. There is no runtime
component; you can run it once in CI. The lab ships a sample of its output at
`lab/fixtures/sloth-generated.yml`, which is never loaded, so you can read it
without risking your stack.

Four things identify Sloth output on sight. The recorded names are
`slo:sli_error:ratio_rate5m` through `…:ratio_rate30d`, uniform across every
service. Every series carries `sloth_id`, `sloth_service`, `sloth_slo` and
`sloth_window` — three labels chosen for you, on every rung, which is a
cardinality decision somebody else made. The alerts carry a `sloth_severity`
label alongside your own `severity`. And every clause is wrapped in
`max(...) without (sloth_window)`, for the reason you proved earlier in this
chapter.

The most useful thing about Sloth for this chapter is its window catalog, because
it is expressed the way the derivation is: as `errorBudgetPercent` plus a pair of
windows, with the burn factor *derived at generation time*. Its `google-30d.yaml`
and `google-28d.yaml` files are identical except for the period — which means the
28-day file's effective burn rates are not 14.4 / 6 / 3 / 1 at all. Redo the
multiplication with 672 hours if you want to see what they are, and notice that
nobody who hard-coded 14.4 would ever have found out.

**Pyrra** (v0.10.1, June 2026) is a generator *and* a running service with a web
UI and burn-down charts. It takes a `ServiceLevelObjective` object and emits
rules; the fixture at `lab/fixtures/pyrra-generated.yml` shows the shape, wrapped
in a Kubernetes resource that Chapter 27 unpacks — read past the wrapper to the
`groups:` key and it is a rules file like any other.

Pyrra's conventions differ from Sloth's almost everywhere. Recorded names are
per-metric, `snip_http_requests:burnrate3m` rather than a uniform `slo:` prefix.
The long-window figure is an `increase()` over the raw counter rather than an
average of the five-minute rung. Windows scale to whatever `window:` you asked
for instead of coming from a fixed catalog. There is one alert name,
`ErrorBudgetBurn`, repeated four times and distinguished by `long` and `short`
labels. It classifies its tiers as FastBurn, MediumBurn, SlowBurn and
LongTermBurn, has an absent-data alert built in rather than bolted on, offers
four indicator types — `ratio`, `latency`, `latencyNative` and `boolGauge` — and
since v0.10.0 annotates alerts with a `pyrra_url` that links straight to that
SLO's page.

Neither tool is wrong. They implement the same chapter of the same book and they
disagree about window pairs, burn factors, alert names, severities and how to
compute the long-window figure. That is the actual lesson: **a generator encodes
somebody's judgment, and if you cannot read the output you cannot tell whose.**
Read the two fixtures side by side once and generated rules stop being
mysterious.

!!! warning "Read your generator's output, not a book's description of it"
    Both fixtures in this repository are illustrations of shape. Field names,
    annotation keys and label conventions move between releases — the
    `exhaustion` annotation on the Pyrra fixture is a good example of a detail
    worth verifying against your own generated file before you build anything on
    it. Generate once, read what you got, then commit it.

## Common mistakes

**Copying 14.4 into a window that is not thirty days.** The number is
`0.02 × 720 / 1`. Put a seven-day period in and it becomes `0.02 × 168 / 1 =
3.36`. Keeping 14.4 makes your fast tier roughly four times less sensitive than
you think it is, which is not a rounding error — it is the difference between a
page and silence for most real incidents. The 28-day case is subtler and
therefore worse: the thresholds move by only about 7 %, so nothing looks wrong.

**Deleting the `max(...) without (...)` wrapper from generated rules.** It looks
like noise, it is load-bearing, and removing it produces a rule that is green,
healthy and permanently incapable of firing.

!!! pitfall "Keeping the old threshold alert as a safety net"
    "I will leave `SnipHighErrorRatio` in place, just in case." Now one outage
    produces a page from the threshold rule at minute three and a page from tier
    1 at minute ten, with different values and different annotations, and the
    person holding the phone has to work out whether they are the same incident.
    Two alerts on one SLI is not redundancy. Pick one and delete the other.

**A single minimum-events guard for all four tiers.** Covered above, and worth
repeating because it is the failure that survives the first round of testing:
a guard sized for the fast tier is too small for the slow ones, and the slow ones
are the tiers with the lowest thresholds and therefore the greatest exposure to a
single failure.

**Building a burn rate on a quantile.** `histogram_quantile(0.99, …) > 0.3` has
no count of good events, so it has no budget, so there is nothing to burn.
Chapter 20 made this rule and it applies with full force here: a latency SLO is
the fraction of requests under the threshold, which is the `le="0.3"` bucket
ratio, and only that form can be burn-rated.

**Trying to stop the four tiers firing together.** They are supposed to. A
sustained outage is past every threshold, and once each long window fills, four
alerts describe one incident. Fixing that inside the expressions means the fast
tier's `for:` gates the slow ones. Fix it where grouping and inhibition live.

## Summary

Alerting on an SLO is not a threshold problem, it is a budget problem. Once you
accept that the thing worth waking a human for is *how much of the month you are
about to lose*, every number in this chapter falls out of two decisions you have
already made and one you make deliberately: the target, the period, and the
fraction of the budget you will spend before interrupting somebody.

The path through the six approaches is worth remembering as a path, because you
will watch colleagues walk the first three. A threshold on the objective has no
precision. A longer window has no reset time. A long `for:` has no recall,
because one good evaluation restarts the clock. A burn rate fixes precision and
detection but not reset time, and one tier cannot be both fast and quiet.
Several burn rates fix recall. Two windows per tier fix reset time. That is
where it stops.

The durable takeaways:

- `burn rate = budget_fraction × period / long_window`. Everything else is this
  expression rearranged. The threshold to compare a ratio against is
  `burn_rate × budget`, and writing the multiplication into the rule keeps the
  derivation where the next person will find it.
- The long window decides whether it is worth paging; the short window decides
  whether it is still happening. The short window is the long one over twelve.
- Four tiers, not three. The three-row table is the workbook's table; its own
  example code has four, and every generator followed the code.
- Budget consumed when a tier fires is `long_window × threshold / period`, which
  is the fraction you chose. It does not depend on how bad the incident is.
- Detection time is `long_window × threshold / actual_burn_rate`, assuming a
  clean window and a steady request rate. When traffic rises during the
  incident, it arrives sooner; when traffic falls, later.
- `and` matches on every label except `__name__`. One extra label on one side
  and the alert is silently dead. That is what `max(...) without (sloth_window)`
  exists for.
- A ratio over a handful of events is not a measurement. Guard every tier with a
  minimum event count sized as at least `1 / threshold`, and say out loud what
  the guard switches off.
- Keep the `absent()` alert on the SLI. Every burn-rate rule you own is blind
  without it.

## Exercises

!!! exercise
    **1. Re-derive for seven days (warm-up).** Compute all four thresholds
    for a 7-day SLO period at the same 99.5 % target and the same budget
    fractions. Write the four multiplications out in full in
    `lab/exercises/ch21-derivation.md`, step 7. Then state the factor by
    which hard-coding 14.4 would have been wrong, and check it: the factor
    is the ratio of the two periods. You should get four thresholds all
    under 3.4, and one of them below 0.25 — which tells you something
    uncomfortable about short SLO windows and burn-rate alerting.

    **2. Predict, then measure (core).** For a sustained 3 % error ratio
    against the 99.5 % availability objective, compute the burn rate and the
    detection time for tiers 1 and 2. Then produce it and time it:

    ```bash
    curl -s -XPOST http://localhost:8089/control \
      -d '{"rps":20,"route":"mix","error_ratio":0.03}'
    ```

    Keeping `rps` at 20 is the point — it is the constant-traffic assumption the
    formula needs. Note the wall-clock time, then read
    `ALERTS_FOR_STATE{alertname="SnipAvailabilityBurnFast"}`, which holds the
    Unix timestamp at which the alert became active. Your prediction should be
    within a couple of minutes of the measurement. Reset the injector afterward.

    **3. Kill a tier silently (core).** Add a stray label to one side of
    tier 2's `and`, using `label_replace` as shown in this chapter. Reload,
    run an outage, and confirm the rule stays `inactive` with health `ok`
    and no error anywhere. Then run `make test-rules` and confirm the suite
    catches what the running system did not. Write down which of the two
    told you faster.

    **4. Price each tier (warm-up).** Compute `long_window × threshold /
    period` for all four tiers and convert each to minutes of Snip's
    216-minute budget. Which tier is the expensive one? Then answer the
    question that follows from it: given that answer, would you move any
    tier between `page` and `ticket`?

    **5. Three guards (stretch).** Implement the minimum-events guard three
    ways — a floor on valid events with `increase(...)[1h]`, a floor on
    *failed* events with `code=~"5.."`, and a floor on the recorded rate
    `job:snip_sli_valid:rate5m`. Put each into tier 1 in turn, run `make
    test-rules`, and record which of the four test cases each version
    passes. Rank the three by what each costs you, in one sentence each.

    **6. Break a generated rule (core).** Open
    `lab/fixtures/sloth-generated.yml`, copy the
    `SnipAvailabilityHighErrorRate` alert into a scratch rule file, and remove
    the `max(...) without (sloth_window)` wrapper from one clause. Load it and
    confirm it never fires. Then explain in one line why — the answer is one
    label wide, and you should be able to point at it in the recording rules
    above the alert.

!!! note "Part VI — before and after"
    In Chapter 1 you spent an unbounded amount of time failing to answer "is it
    still getting worse". Run `scenario-outage.sh` and time it: the page arrives
    within about ten minutes, while the fifteen-minute outage is still running,
    carrying the ratio, a dashboard with its range already set, and a first
    step. And `scenario-drip.sh` — which is genuinely bad, genuinely ongoing, and
    burning the month's budget in fifteen days — does not wake anybody at all.
