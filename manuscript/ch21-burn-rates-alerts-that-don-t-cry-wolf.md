# Chapter 21 — Burn Rates: Alerts That Don't Cry Wolf

Chapter 20 left you holding two numbers and a budget. Snip must serve 99.5 % of
redirects without failing, over a rolling thirty days, and 0.5 % of thirty days
is 216 minutes of total failure to spend. The obvious next move is to alert when
you start spending it.

Try it and watch what happens. You write one rule that fires whenever the error
ratio exceeds 0.5 %, and on Tuesday morning it pages you at 09:02 for a
forty-second blip in which one redirect in four failed — ten seconds out of the
216. You add `for: 15m` to calm it down, and on Thursday a real outage runs for
nineteen minutes with two healthy evaluations in the middle, and nobody is woken
at all. By Friday the rule is commented out, and Snip is unmonitored again with
a straight face.

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
chapter built.

There are two ways to work through what follows. Check out `ch21` and you get
the finished state to read along with: `snip-burnrate.yml` with its four tiers
and their guards, the test file, the new inhibit rule, and `SnipHighErrorRatio`
already deleted. Check out `ch20` and you build all of it yourself, in the order
this chapter writes it — which is the order in which the low-traffic test fails
before it passes, and that failure is the point of the exercise.

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

The third is the budget: `1 - 0.995 = 0.005`. Every threshold in this chapter
is that number multiplied by something.

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

Within about five minutes that expression returns a series with a value
near `0.01`, and it keeps returning it for as long as the drip runs. Turn it
into an alert with no `for:` and it pages immediately, then pages again on every
repeat interval, for the whole hour.

Now ask what that page is worth. One percent of redirects failing is twice the
budget, which means the month's 216 minutes are gone in fifteen days. That is a
genuine problem and a genuinely slow one. It deserves a ticket on Monday. It
does not deserve a human being awake at 04:00, and any rule that cannot tell
those two apart will be silenced within a week.

The flaw has a name. **Precision** — the share of alerts that turn out to
matter — is terrible here: the rule is perfectly sensitive, catching every real
problem, and almost worthless at telling you whether what it caught deserved a
human. Stop the drip before moving on:

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

What breaks instead is **reset time**. Start the outage and then watch the two
windows next to each other on one graph — the five-minute rung and the one-day
rung:

```bash
./scripts/scenario-outage.sh --no-wait
```

`--no-wait` starts the injection and hands you back the prompt; it runs until
you reset it with `POST /chaos/reset`, so it ends when you say so and not on a
timer.

```promql
1 - job:snip_sli_availability:ratio_rate5m{job="snip-api"}
```

The five-minute line climbs to about 0.30, holds while the outage runs, and is
back at zero five minutes after you reset it. The one-day line barely moves —
and whatever it moved to, **it stays there until tomorrow**, because a quarter
of an hour of outage sits inside a twenty-four-hour window for twenty-four
hours. Your alert
fires long after you have fixed the problem, and there is nothing you can do
about it except wait for the calendar.

An alert that will not clear is worse than a noisy one. People learn to ignore
it, and then they ignore the next one. Stop the outage before moving on:

```bash
curl -s -XPOST http://localhost:8089/chaos/reset
```

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
**every single evaluation** in the interval — 120 of them in an hour at a
30-second interval — and one healthy evaluation anywhere in that hour throws the
clock away and starts it again from zero. Chapter 16's ninety-minute outage with
one healthy evaluation at minute 50 produced a fifty-minute `pending` run, then
a forty-minute one, and fired nothing at all. Not late — never.

`for:` is a debounce on a switch. It suppresses brief self-correcting nonsense,
which is a real and useful job. It is not a measurement of how long something
has been broken, and the longer you make it the more fragile it gets, because
you have handed more evaluations the chance to spoil it. Google's *Site
Reliability Engineering* workbook rejects this approach by name, and so should
you.

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

**Recall** — the share of real problems the rule actually catches — improves:
fast burns and slow burns are both caught, each by the tier suited to it. A
single tier had to choose. But reset time has not improved at all — the
six-hour clause stays true
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

You will find a great many copies of this table with only three rows — the
1 d / 2 h tier at burn rate 3 missing. That version is real: it is the
recommended-parameters *table* in the SRE workbook. The workbook's own
Approach-6 *example code*, earlier in the same chapter, has four, and the
implementations followed the code: Sloth ships four tiers, Pyrra ships four, and
Grafana Cloud's SLO app folds the same four into a fast-burn alert and a
slow-burn one. Use four. The missing tier is the one that catches a 1.5 % error
ratio, which is three times your budget and completely invisible to the other
three.

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
`t / W` of the way toward *B*. Set that equal to the threshold and solve for
*t*:

```text
    (t / W) × B = threshold
            t   = W × threshold / B
```

which is the same rearrangement you did for the threshold, run the other way:

```text
    detection time = long_window × threshold / actual_burn_rate
```

Two assumptions are hiding in that line and you should know both. It assumes the
window was clean before the incident started, and it assumes the request rate
does not change. Neither is always true, and the live outage is where you watch
one of them break.

The formula also has nothing to say when the actual burn rate is *below* the
threshold. Detection time is then infinite, which is not a defect — that is the
alert correctly declining to fire.

## Writing the four rules

Create `lab/prometheus/rules/snip-burnrate.yml` — or, reading along on `ch21`,
open the file that is already there and read it in this order. Start with the
first tier, and leave out the minimum-events guard for now: you are going to
discover why it exists rather than being told.

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
Should Say, and Who Watches the Watcher", specified. A folded scalar keeps it
inside the line length:

```yaml
          runbook_url: >-
            https://runbooks.example.com/obslab/snipavailabilityburnfast
```

The other three are that URL with their own lowercased names. Be honest about
where they point: `docs/runbooks/` holds four pages and not one of them is for a
burn tier, and Chapter 19's rule was that a missing runbook is a bug against the
alert. Write the two paging tiers' pages before any of this goes on call.

Four details in that block are decisions rather than typing.

`interval: 30s` on the group matches the interval of the recording-rule groups it
reads. An alert cannot be fresher than the series underneath it, and evaluating
the alert twice as often as the series it consumes only means evaluating the same
sample twice.

`for: 2m` is a debounce and nothing more, so that one strange evaluation does
not page anybody. The short window handles duration, and two minutes on top of a
fourteen-minute detection time is noise. The generators disagree here: Sloth
emits no `for:` at all on burn-rate alerts.

The `labels:` block carries `severity: page`, which is routing and not
decoration — Chapter 17, "Alertmanager: Routing, Grouping and Silence", made `severity` the thing the route tree
matches on. `service` and `route` are there so the inhibit rules later in this
chapter have stable labels to compare.

`$value` in the description is the value of the whole expression, and an `and`
returns the values of its left-hand side. So the number the page carries is the
**one-hour** error ratio, which is the right one to quote: it is the long window,
the one that decided this was worth an interruption.

Now add the other three: `SnipAvailabilityBurnMedium`,
`SnipAvailabilityBurnSlow` and `SnipAvailabilityBurnVerySlow`. The names matter,
because `verify-ch21.sh` matches them literally. They are the same shape with
the pairs from the table substituted, and two changes: tiers 3 and 4 carry
`severity: ticket` and
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
    label wide. Fifteen minutes into the outage the one-hour window is still
    filling and the five-minute one is entirely inside it, so the two numbers
    differ — and both are comfortably past the 0.072 threshold, so both halves
    really do return a series:

    ```text
    {job="snip-api"}                    0.1203
    {job="snip-api", window="5m"}       0.3001
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
check the starting conditions and then predict.

The one-hour rung still remembers the outage you ran to break approach 2, and a
dirty window makes every alert arrive sooner than any formula says. Check it:

```promql
1 - job:snip_sli_availability:ratio_rate1h{job="snip-api"}
```

Wait until that reads below 0.01. If you would rather not wait the best part of
an hour, start anyway and expect the page sooner than the predictions you are
about to write down. You will have learned the same lesson from the other
direction.

`scenario-outage.sh` drives 40 requests per second with 30 % of redirects
failing. That is an error ratio of 0.30 against a budget of 0.005, so the burn
rate is **60**. Feed that into the detection formula, holding the request rate
constant:

| Tier | threshold ÷ burn rate | × long window | with `for:` |
|---|---|---|---|
| 1 | 0.24 | 14.4 min | ≈ 16 min |
| 2 | 0.10 | 36 min | ≈ 38 min |
| 3 | 0.05 | 72 min | ≈ 87 min |
| 4 | 0.017 | 72 min | ≈ 87 min |

Write those down. Then start it and leave it running for half an hour, so that
tier 2 has a chance too:

```bash
./scripts/scenario-outage.sh --no-wait
```

Watch `http://localhost:9090/alerts`, or query the alert state directly:

```promql
ALERTS{alertname=~"SnipAvailabilityBurn.*"}
```

Tier 1 arrives **early** — at about ten minutes rather than sixteen. That is not
a mistake in the formula and it is not a mistake in the rule. It is the second
hidden assumption breaking, and the correction is arithmetic you can do before
the clock confirms it.

The scenario does not only inject errors; it raises the request rate from the
default 20 to 40. The redirect route gets 80 % of the mix, so it goes from 16
requests per second to 32, of which 9.6 per second now fail. The one-hour window
therefore fills with outage traffic **twice as fast** as the formula assumed,
because each minute of outage contributes twice as many events as each minute of
the healthy hour it is displacing. Work the ratio out minute by minute — the
per-second rates cancel top and bottom, so *t* can stay in minutes:

```text
    error ratio after t minutes
      = 9.6 t / (32 t + 16 (60 - t))
      = 9.6 t / (16 t + 960)

    crosses 0.072 at t ≈ 8.2 minutes
```

Add the two-minute debounce and the page lands at about ten minutes. Tier 2's
six-hour window crosses at about nineteen minutes by the same arithmetic, so it
pages at roughly twenty-one. Rules evaluate every thirty seconds, so read every
prediction in this chapter to the nearest half minute and no finer.

The same correction applies to the two ticket tiers and is still not enough to
bring either inside a thirty-minute run: tier 3's one-day window crosses 1.5 %
at around thirty-seven minutes, and then owes you a fifteen-minute `for:`. Both
numbers, the constant-traffic 87 and the traffic-corrected 52, say the same
thing to the person holding the phone: the ticket tiers are not in a hurry.

The lesson cuts both ways. **Detection time depends on the mix of traffic inside
the window, not only on the severity of the incident.** An incident that arrives
with a traffic spike is detected sooner than the formula says; one that makes
users give up and go away is detected *later*. Use the formula as the number to
argue with, not as a promise.

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
    compare the label sets character by character. That is the label trap, and
    it is the first thing to rule out.

Reset the injector when you are done:

```bash
curl -s -XPOST http://localhost:8089/chaos/reset
```

## The drip that must never page

Now the opposite case, and the one that justifies the chapter's title.

```bash
./scripts/scenario-drip.sh --no-wait
```

Half an hour of it is enough to see the point. It runs until you reset it with
`POST /chaos/reset`.

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

Be honest about what half an hour cannot show you. Tier 4's long window is three
days, so on a lab that has been healthy a while the drip never dominates it and
the ticket will not appear inside your session. The formula says so out loud:
`72 h × 1 / 2 = 36 hours`. The unit tests prove that tier deterministically, in
about a second. What the live run reliably shows is the budget falling with
nobody being woken, and that is the claim that matters. Reset the injector:

```bash
curl -s -XPOST http://localhost:8089/chaos/reset
```

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

The shipped file has four cases, not three. The fourth cannot be written yet,
because it grades a guard you have not added: it is the case that proves each
tier's event floor is sized for that tier rather than copied from tier 1.

### Why the three-day tier is not really tested

The test never gives the slow tiers three days of samples, and pretending
otherwise would be worse than saying so: three days of 30-second points costs
8,640 samples per series and buys nothing. Over a seventy-minute test the
one-day and three-day windows contain whatever data exists, which is enough to
exercise everything that genuinely breaks here — the label sets on either side
of each `and`, the thresholds, and the guard. What a three-day fixture would
additionally prove is that `rate()` works over long ranges, and that is
Prometheus's problem, not yours.

### The case that fails

Now add the third case, and expect it to fail. A near-idle service: one redirect
every two minutes, nine tenths of one of them good — thirty redirects an hour,
three of them failing.

```yaml
  - name: the minimum-events guard stops a near-idle service
          from paging
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

Run it. This is the one step that only works on the `ch20` path: the `ch21` tag
already carries the guards, so reading along there prints `SUCCESS`, and you
read the failure here instead of causing it.

```bash
make test-rules
```

```text
Unit Testing:  /etc/prometheus/rules/tests/snip-burnrate_test.yml
  FAILED:
    name: the minimum-events guard stops a near-idle service
    from paging,
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

The root cause is not the threshold. It is that a ratio computed from a handful
of events is not a measurement. Nine successes and one failure give a 95 percent
confidence interval on the true failure rate of roughly 0.3 % to 45 %. One event
is not a measurement, and no alerting rule can extract certainty that the data
does not contain.

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
    fires. That is not the guard working, it is the window remembering. The
    low-traffic failure belongs to a service that is *always* quiet, and you
    cannot conjure one on a lab that has been busy. The near-idle unit test is
    what proves it, in one second, deterministically.

### Five fixes, and what each one costs

There are five honest fixes. None of them is free, and they are ranked here by
how much you give up.

**A minimum-events guard.** Require a floor of valid events in the long window
before the ratio is allowed to mean anything. This is what the lab ships, and it
is first because the cost is the smallest and the most explicit: below the floor,
these alerts are switched off rather than wrong. Grafana's SLO app — a Grafana
Cloud feature, not something you can switch on in the OSS Grafana this lab runs
— ships a related control called "Minimum Failures", which puts the floor on
*failures* rather than on valid events. Exercise 5 asks you to build both and
say which one you would rather own.

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

Take the first fix. The guard itself is one clause appended to each rule. Each
tier counts events over *that tier's own long window*, so the range changes with
the tier — `[1h]`, `[6h]`, `[1d]`, `[3d]` — and so does the floor. Tier 1:

```yaml
          and
          sum by (job) (
            increase(snip_http_requests_total{job="snip-api",
                                              route="/l/{code}"}[1h])
          ) >= 60
```

`sum by (job)` matters: the output has to carry the same single `job` label as
the two ratio clauses, or you have written the label trap into your own fix.

Now the number. Sixty is not a taste. With *N* valid events in the long window,
one failure is an error ratio of `1/N`, so a single failure is enough to trip a
tier whenever `N < 1 / threshold`:

| Tier | Guard range | 1 / error ratio | Guard shipped |
|---|---|---|---|
| 1 | `[1h]` | 13.9 | 60 |
| 2 | `[6h]` | 33.3 | 60 |
| 3 | `[1d]` | 66.7 | 67 |
| 4 | `[3d]` | 200 | 200 |

!!! pitfall "One guard for all four tiers"
    The obvious move is a single number everywhere, and this file shipped a flat
    `>= 60` first. Sixty is comfortably above what tiers 1 and 2 need and
    **below** what tiers 3 and 4 need. One failed redirect in sixty a day is
    1.67 %, which is past tier 3's 1.5 % and past tier 4's 0.5 % — so both ticket
    tiers opened a ticket for one request, and the fix that was supposed to stop
    spurious alerts quietly did not. Each guard has to be the larger of
    `1 / threshold` and whatever floor you consider the minimum measurable rate.

Say out loud what that buys and what it does not. Each floor is a count in its
own window, so the same count is a looser *rate* the longer the window: sixty in
an hour is one redirect a minute, sixty in six hours is one every six minutes,
and sixty-seven in a day and two hundred in three days are both about one every
twenty-two minutes. Only tier 1 enforces one a minute. A service that is
*always* near-idle — thirty redirects an hour, three of them failing — puts a
hundred and eighty events in six hours, clears tier 2's sixty, and pages once
that window has filled. The guard buys you a floor per tier, not one floor for
the service, and that is the cost, stated plainly. If a permanently quiet
service is the case you care about, do not lean on the guards alone. Alert on
the valid-event rate itself falling under the floor:

```promql
job:snip_sli_valid:rate5m{job="snip-api"} < 60 / 3600
```

Add the guards, with the per-tier ranges and numbers, and add a fourth test case
— the one that grades the sizing. It is that one-failure-in-sixty arithmetic
made executable: fifty-nine good redirects over an hour and a single failure at
minute 36.

```yaml
  - name: one failure in sixty redirects opens no ticket
    interval: 1m
    input_series:
      - series: 'snip_http_requests_total{job="snip-api",
                 instance="snip-api-1", env="lab", route="/l/{code}",
                 method="GET", code="302"}'
        values: "0+1x59 59x10"
      - series: 'snip_http_requests_total{job="snip-api",
                 instance="snip-api-1", env="lab", route="/l/{code}",
                 method="GET", code="500"}'
        values: "0x35 1x34"

    alert_rule_test:
      - eval_time: 70m
        alertname: SnipAvailabilityBurnSlow
        exp_alerts: []
      - eval_time: 70m
        alertname: SnipAvailabilityBurnVerySlow
        exp_alerts: []
```

Then assert with `promql_expr_test` that both ratio halves really are true and
both guards really are false — `> bool (3 * 0.005)` and `> bool (1 * 0.005)`
reading 1, `>= bool 67` and `>= bool 200` reading 0 — so the guard is provably
the only thing holding those two tiers back. Without those four assertions the
case would pass for the wrong reason. Set either guard back to 60 and it fails,
which is what turns the pitfall from advice into a test.

Run the suite again:

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
ratio, its 20 % boundary picked because one redirect in five failing is
unambiguously bad. It has been superseded four times over by rules whose
thresholds come from a written-down objective, and leaving it in place pages you
twice for one outage, from two rules that disagree about what "bad" means. `make
verify-ch21` checks that it is gone. Chapter 16 promised the
threshold-plus-`for` shape would be replaced wholesale, and this is the
replacement: *IOU from chapter 16, settled.*

**Keep `SnipSLIAbsent`.** Every rule you wrote today is built on
`job:snip_sli_availability:ratio_rate*`, and an expression over a series that
does not exist returns nothing and therefore never fires — forever, with a
perfectly healthy-looking rule.

```promql
absent(job:snip_sli_valid:rate5m{job="snip-api"})
```

Apart from Chapter 19's Watchdog, which is `vector(1)` by construction, that is
the only alert in the repository whose value is always 1 when it fires — and the
pair is worth noticing: one proves the pipeline is alive, the other proves the
SLI is.

Be precise about which blindness it covers, because this chapter's own quiet
service walks straight past it. `absent()` catches snip-api not being scraped:
the target goes, its counters go with it, the recording rule produces nothing
and the alert returns a 1. It does **not** catch snip-api being up and serving
no redirects. Chapter 9's fix pre-initializes the counters, so with no traffic
they sit still rather than disappearing, and `job:snip_sli_valid:rate5m` is a
count deliberately left unguarded — so it exists reading 0 and `absent()` stays
silent. Every availability rung, meanwhile, divides by a denominator filtered
`> 0`, so an idle window produces no sample at all, and with the rungs gone all
four tiers return an empty vector with health `ok`. The alert built to catch a
blind SLI is blind to the quietest way of going blind, and
`scenario-low-traffic.sh` drives the lab toward exactly that state.

So keep both. `absent()` is the floor under a target that vanished; the
valid-event comparison you met while sizing the guards —
`job:snip_sli_valid:rate5m{job="snip-api"} < 60 / 3600` — is the floor under a
service that is still there and has nothing to measure. Two rules, and between
them the burn tiers can no longer go quiet without saying so.

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
meant to silence.

Tighten the existing `SnipTargetDown` inhibit rule in the same edit. Chapter 17
wrote its target as "every Snip alert that is not this one" — `alertname !=
"SnipTargetDown"` plus `service = "snip"`. Replace those two matchers with one
that names what it suppresses:

```text
alertname =~ "Snip(AvailabilityBurn.*|SLIAbsent|LatencyObjectiveAtRisk)"
```

A replica that has stopped answering is the cause and the burn rates climbing
are the symptom, so the suppression is right. Naming the targets is what keeps
it right: a catch-all target silences the next alert somebody adds to the
service, including one that has nothing to do with a dead replica.

!!! selfcheck "Self-check"
    ```bash
    make verify-ch21
    ```

    It prints one `PASS` line per tier for each of loaded, windows, threshold and
    severity, then checks the deletion, `SnipSLIAbsent`, the test file, the test
    suite, and that Alertmanager routes `page` and `ticket` separately. It should
    end with:

    ```text
    ch21: 21 passed, 0 failed, 1 skipped
    ch21 OK
    ```

    The skip is the live outage and drip scenarios: 15 and 60 minutes, longer
    than a verify script may take. You have already run them by hand. If `make`
    is not on your path the script cannot drive `promtool`, so that line skips
    too and the tally reads `20 passed, 0 failed, 2 skipped`. Building from
    `ch20` you need the script itself before the target resolves:
    `git checkout ch21 -- scripts/verify-ch21.sh`.

## Generators: Sloth and Pyrra

Nothing you wrote today was hard, but count it: four rules with twelve clauses
between them, standing on Chapter 20's eight recorded windows — all for **one**
SLO, and `docs/SLO.md` declares two. Multiply by a dozen services and
hand-writing stops being a virtue. Two tools generate all of it, and you will
meet their output in somebody else's repository before you choose to adopt one.
The point here is recognition, not installation.

**Sloth** (v0.16.0, April 2026, `ghcr.io/slok/sloth:v0.16.0`) is a generator and
nothing else. You give it a fifteen-line spec — service, objective, an error
query, a total query — and it emits a rules file you commit. There is no runtime
component; you can run it once in CI. The lab ships a sample of its output at
`lab/fixtures/sloth-generated.yml`, which is never loaded, so you can read it
without risking your stack.

Four things identify Sloth output on sight. The recorded names are
`slo:sli_error:ratio_rate5m` through `…:ratio_rate30d`, uniform across every
service. Every SLI rung carries `sloth_id`, `sloth_service` and `sloth_slo` —
three labels chosen for you, which is a cardinality decision somebody else
made — plus a `sloth_window` naming the range. The meta rules carry the first
three and not the window. The alerts carry a `sloth_severity`
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
Its **30-day budget** figure is an `increase()` over the raw counter rather than
an average of the five-minute rung — `snip_http_requests:increase30d`, recorded
in its own group every 2m30s. The burn-rate windows themselves are plain
`rate()` ratios, the same shape as yours. Windows scale to whatever `window:`
you asked for instead of coming from a fixed catalog. There is one alert name,
`ErrorBudgetBurn`, repeated four times and distinguished by `long` and `short`
labels. It names its four tiers FastBurn, MediumBurn, SlowBurn and LongTermBurn
internally, but none of those names reaches the generated file: what you will
see on each alert is `severity: critical` or `severity: warning`, with `long`
and `short` carrying the windows. Recognize Pyrra by the repeated
`ErrorBudgetBurn` and that `long`/`short` pair, not by the tier names. It also
has an absent-data alert built in rather than bolted on, offers four indicator
types — `ratio`, `latency`, `latencyNative` and `boolGauge` — and since v0.10.0
annotates alerts with a `pyrra_url` that links straight to that SLO's page.

Neither tool is wrong. They implement the same chapter of the same book and they
disagree about window pairs, burn factors, alert names, severities and how to
compute the long-window figure. That is the actual lesson: **a generator encodes
somebody's judgment, and if you cannot read the output you cannot tell whose.**
Read the two fixtures side by side once and generated rules stop being
mysterious.

!!! warning "Read your generator's output, not a book's description of it"
    Both fixtures in this repository are illustrations of shape. Field names,
    annotation keys and label conventions move between releases: the Pyrra
    fixture carries `exhaustion` and no `pyrra_url`, although a current Pyrra
    emits both. That is the point — verify every annotation key against your own
    generated file before you build anything on one. Generate once, read what
    you got, then commit it.

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

**A single minimum-events guard for all four tiers.** Worth repeating, because
it is the failure that survives the first round of testing:
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
  minimum event count over *that tier's own long window*, sized as at least
  `1 / threshold`, and say out loud what the guard switches off — the same count
  is a looser rate the longer the window.
- Keep the `absent()` alert on the SLI, and a floor on the valid-event rate
  beside it. `absent()` catches a target that vanished; only the rate floor
  catches a service that is up and serving nothing, which is when every
  burn-rate rung disappears.

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
    against the 99.5 % availability objective, compute the burn rate and then
    the detection time for tiers 1 and 2. Write down what the formula returns
    for each, and say in one sentence what that answer means for the person on
    call. Then produce the incident and check your answer against the clock:

    ```bash
    curl -s -XPOST http://localhost:8089/control \
      -d '{"rps":20,"route":"mix","error_ratio":0.03}'
    ```

    Keeping `rps` at 20 is the point — it is the constant-traffic assumption the
    formula needs. Read `ALERTS_FOR_STATE{alertname="SnipAvailabilityBurnFast"}`,
    which holds the Unix timestamp at which the alert became active. Then raise
    `error_ratio` to `0.09`, predict both detection times again, and this time
    measure them: at that ratio the arithmetic produces finite numbers and the
    clock should land within a minute or two of each. Reset the injector
    afterward.

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
    `lab/fixtures/sloth-generated.yml` and copy *both* the
    `sloth-slo-sli-recordings-snip-availability` group and the
    `SnipAvailabilityHighErrorRate` alert into a scratch rule file under
    `lab/prometheus/rules/` — `fixtures/` is never loaded, so the alert on its
    own reads series that do not exist and is empty for the wrong reason.
    Reload, give the recordings a few minutes, run `scenario-outage.sh` and
    confirm the alert does fire: that is your control. Now remove the
    `max(...) without (sloth_window)` wrapper from one clause of *each* `or`
    branch and confirm it goes dead. Remove it from one branch only and watch
    the alert half-die — the fast pair stops, the slow pair still fires, and
    nothing anywhere says so. Then explain in one line why: the answer is one
    label wide.

!!! note "Part VI — before and after"
    In Chapter 1 you spent an unbounded amount of time failing to answer "is it
    still getting worse". Run `scenario-outage.sh` and time it: the page arrives
    within about ten minutes, while the fifteen-minute outage is still running,
    carrying the ratio, a dashboard with its range already set, and a first
    step. And `scenario-drip.sh` — which is genuinely bad, genuinely ongoing, and
    burning the month's budget in fifteen days — does not wake anybody at all.
