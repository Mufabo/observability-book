# Chapter 6 — `rate()`, `increase()`, and Why Nothing Is a Whole Number

At the end of Chapter 5, "Your First Counter: Instrumenting Code You Own", you had a
counter you wrote yourself, arriving in Prometheus every fifteen seconds, and a graph of
it that was completely useless. It went up. It kept going up. When you made a third of the
requests fail, the line went up at a very slightly different angle, and you could not see
it.

That is not a defect in your instrumentation and it is not a defect in Prometheus. A
counter answers one question — *how many, since this process started* — and that is a
question almost nobody has. The question you have is *how many per second, right now*,
and *how many in the last five minutes*. Both of those are differences, and a difference
needs two points in time.

This chapter is about the two functions that compute those differences, `rate()` and
`increase()`, and about the machinery you need first: the kinds of thing a PromQL
expression can evaluate to, how you ask for a window of samples instead of one sample, and
exactly which samples land inside that window. Then it removes the mystery from `rate()` by
making you compute one on paper, with a calculator, before Prometheus computes it for you.
By the end you will recognize what `rate()` does rather than take it on faith — and you
will know why `increase()` sometimes says that two and a half requests happened.

!!! objectives "Objectives"
    After this chapter you can:

    - Name the four PromQL expression types and say which functions consume which.
    - Explain why `rate(x)` is a type error and `rate(x[5m])` is not.
    - Count the samples inside `[1m]` at a 15-second scrape interval, get 4 rather
      than 5, and say why.
    - Predict what `increase(x[1m])` will return, fraction included, before you press
      Execute.
    - Diagnose an empty `rate()` panel with the two-sample rule and the 4× guideline.
    - Say what a counter reset costs you permanently, and which functions survive one.

## Where the lab is, and what you will need

Everything here runs against the stack you already have. Two files arrive — a predictions
worksheet and a verification script — and you add one scratch row to a dashboard yourself.
No application code changes, so nothing has to be rebuilt.

```bash
cd lab
git checkout ch06
make up
```

Leave the load generator at its defaults. It starts at 20 requests per second across the
fixed mix you met in Chapter 1, "Ten Minutes to Your First Metric": 80% `GET /l/{code}`,
10% `GET /links/{code}`, 5% `POST /links`, 5% `GET /healthz`. Read the whole control state
back at any time:

```bash
curl -s localhost:8089/control
```

One convention for this chapter. Chapter 2, "What's Actually on the Wire", gave you a
second replica, `snip-api-b`. Both containers report under `job="snip-api"` and are told
apart by their `instance` label, which at this point in the book is the address Prometheus
was told to scrape: `snip-api:8000` and `snip-api-b:8000`. Chapter 8, "Aggregation: `sum`,
`without`, and the Rate-Then-Aggregate Law", is where having two of them earns its keep.

Until then, every query in this chapter is pinned to `instance="snip-api:8000"`. That is the
replica whose `/metrics` endpoint you can reach with `curl` on port 8000, so a number you
compute by hand and a number Prometheus computes are about the same process.

## The staircase, and why it tells you nothing

Open the Prometheus Query page at `http://localhost:9090`, switch to the Graph tab, set
the time picker to one hour, and run this:

```promql
snip_http_requests_total{
  job="snip-api", instance="snip-api:8000", code="302"}
```

`302` is the redirect Snip returns when a short code resolves, so this single series is the
hot read path. You get a staircase: a line that climbs to the right and never once goes
down. Hover it and you will find a large number — tens of thousands — that was already
large an hour ago. The interesting part of this graph is its *slope*, and slope is exactly
what a human eye is bad at reading off a line spanning four orders of magnitude.

Now do something to the service and watch how little the graph reacts:

```bash
curl -s -XPOST localhost:8089/control -d '{"rps": 40}'
```

You have doubled the traffic. Wait a minute and look again. The staircase is very slightly
steeper. If somebody put that graph on a wall and asked when the traffic doubled, you could
not answer to better than about ten minutes.

There is a second problem, and it is worse. Restart the process and the counter goes back to
zero, because a counter counts events *in one process lifetime* — that was Chapter 4,
"Metric Types Are Contracts". So this is not one staircase; it is a sequence of staircases
separated by cliffs.

Put the traffic back where it was before you go on:

```bash
curl -s -XPOST localhost:8089/chaos/reset
```

## Doing it by hand, with two curls and a calculator

Before you let a function do this for you, do it yourself. It takes ninety seconds and it
is the difference between believing `rate()` and recognizing it.

Snip's exposition endpoint is a text document. Ask for it twice, fifteen seconds apart, and
print the clock each time so you know how far apart "fifteen seconds apart" really was:

```bash
date +%s
curl -s localhost:8000/metrics \
  | grep '^snip_http_requests_total{code="302"'
sleep 15
date +%s
curl -s localhost:8000/metrics \
  | grep '^snip_http_requests_total{code="302"'
```

Here is what that produced on one run. Yours will not match, and does not need to:

```console
$ date +%s
1785322930
$ curl -s localhost:8000/metrics \
    | grep '^snip_http_requests_total{code="302"'
snip_http_requests_total{code="302",method="GET"} 48231
$ sleep 15
$ date +%s
1785322945
$ curl -s localhost:8000/metrics \
    | grep '^snip_http_requests_total{code="302"'
snip_http_requests_total{code="302",method="GET"} 48464
```

Two numbers and two timestamps. That is the whole input.

```text
   48464 − 48231          =  233 redirects
1785322945 − 1785322930   =   15 seconds

233 / 15 = 15.5333… redirects per second
```

Write **15.53** on a sticky note, or anywhere you will still have it in ten minutes. You
are going to hold Prometheus to it.

Notice what you assumed while doing that, because every one of these assumptions comes
back later as a property of `rate()`.

You assumed the counter did not reset between the two captures. If the process had
restarted in that fifteen seconds, the second number would have been smaller than the
first and your subtraction would have produced a negative rate — which is not a thing.

You assumed the two captures were exactly fifteen seconds apart. They were not. `date`
prints whole seconds, `curl` takes tens of milliseconds, and `sleep 15` sleeps for *at
least* fifteen seconds. Your denominator is 15 seconds give or take a few hundredths, and
you rounded that away without noticing.

And you assumed that the rate you computed — an average over one fifteen-second span — is
the rate "now". It is not; it is the average over that span. There is no such thing as an
instantaneous rate in a system that only samples. Prometheus makes all three of the same
assumptions: explicit about the first, arithmetically careful about the second, and
completely honest about the third.

## Four kinds of thing an expression can be

Everything you have typed into the Query page so far has been a **series selector**: a
metric name, optionally with label matchers in braces. That is one of four things a PromQL
expression can evaluate to, and until you can name all four, half of PromQL's error
messages will look like nonsense.

| Type | What it is | Example |
|---|---|---|
| Instant vector | A set of series, one sample each | `snip_links_active` |
| Range vector | A set of series, a *list* of samples each | `snip_links_active[5m]` |
| Scalar | One bare number, no labels, no identity | `300` |
| String | A bare string, only as a function argument | `"hit"` |

An **instant vector** is what a selector returns. For every series that matches, you get
exactly one sample: the most recent one at or before the evaluation time. That is why the
Table tab shows one row per series with one number in it.

A **range vector** is the new thing in this chapter, and it is what you get when you append
a duration in square brackets to a selector. For every matching series you get not one
sample but every sample inside a window ending at the evaluation time. Four of them, at a
fifteen-second scrape and a one-minute window, as you are about to prove.

A **scalar** is a bare number. `300` is a scalar, and so is the result of `time()`. Scalars
have no labels and no series identity, which makes them useless as an answer and very
useful as an argument. A **string** exists in the type system and you will meet it exactly
once, as an argument to `label_replace()` in Chapter 9, "Ratios, Arithmetic, and the Series
That Isn't There". It is not something you graph.

### What a graph is actually asking for

To see why the types matter, you need one fact about how a graph is produced, and it is not
the obvious one. A graph is not "give me the stored points". When Grafana draws a time
series panel — or when you press Graph on the Prometheus Query page — the client sends a
**range query**: a start time, an end time, and a *step*. Prometheus then evaluates the
entire expression, independently and from scratch, at every timestamp on that step grid.

Look at how much two neighboring evaluations have in common:

```text
 samples  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ──▶ time
                   ├───────── [1m] at t₃ ──────┤
                           ├───────── [1m] at t₄ ──────┤
                   ▲                           ▲       ▲
                 t₃−1m                        t₃      t₄
```

`rate(x[1m])` at `t₃` reads the window `(t₃−1m, t₃]`; at the next step, `t₄`, it reads
`(t₄−1m, t₄]`. If the step is fifteen seconds those two windows share forty-five seconds of
data. That overlap is normal, and it is why a `rate()` graph looks smoother than the raw
traffic actually was: every point on the line is an average over a window that mostly
overlaps its neighbors.

Two rules follow from the types, and this is where the overlap picture pays off.

**A range vector is only ever legal inside something that consumes one.** `rate()`,
`increase()`, and functions whose names end in `_over_time` take a range vector and hand
back an instant vector. A range vector on its own is not an answer to anything.

**A range query will only accept a scalar or an instant vector at the root of the
expression.** Each evaluation has to produce one number per series so the drawing code has
one point to plot. A range vector at each timestamp would be a *list* of values per series,
and there is no way to draw that as a line.

That second rule is the most common beginner error in PromQL, so it is worth seeing it fail
rather than reading about it.

!!! trap "A range vector where a graph was expected"
    In the Prometheus Query page, switch to the **Graph** tab and run:

    ```promql
    snip_http_requests_total[5m]
    ```

    You do not get a graph and you do not get an empty graph. You get an error:

    ```text
    invalid expression type "range vector" for range query,
    must be Scalar or instant Vector
    ```

    A Grafana time series panel refuses it the same way, under the panel header. The
    fix is never to make Grafana accept it — it is to wrap the range vector in a
    function that turns it back into an instant vector.

Now switch to the **Table** tab and run that same expression again. It works. The Table tab
issues an *instant* query, which accepts all four types, and it renders a range vector as a
list of `value @timestamp` pairs — every raw sample in the window, exactly as stored. You will
come back to that view shortly, to see the four samples `rate()` works from.

The other half of the type rule is the mistake you will make when you first reach for
`rate()`.

!!! trap "`rate()` without a range"
    ```promql
    rate(snip_http_requests_total)
    ```

    ```text
    1:6: parse error: expected type range vector in call to
    function "rate", got instant vector
    ```

    This one is caught by the parser, before anything is evaluated, which is why it
    fires on the Table tab and the Graph tab alike. `rate()` is declared as taking a
    range vector; you handed it an instant vector. The `1:6` is the character
    position of the offending argument. The fix is a duration in brackets.

## The range-vector selector, and the samples actually inside it

The syntax is a duration literal in square brackets, appended to a selector:

```promql
snip_http_requests_total{
  job="snip-api", instance="snip-api:8000", code="302"}[5m]
```

Durations are an integer plus a unit — `ms`, `s`, `m`, `h`, `d`, `w`, `y` — concatenated
longest-first, so `1h30m` and `54s321ms` are both legal. Decimals are not: write `90m`,
never `1.5h`. In PromQL `d` always means 24 hours and `y` always means 365 days; there is
no calendar in there.

The important question is not the syntax. It is: **which samples end up inside the
window?**

The window ends at the evaluation timestamp and extends backwards by the declared duration.
Since Prometheus 3.0 it is **left-open and right-closed** — written as `(t−5m, t]`. A sample
landing exactly on the right-hand edge is included; one landing exactly on the left-hand edge
is **excluded**. In Prometheus 2.x both ends were closed, so a sample sitting on a boundary
was counted in two adjacent windows at once.

That change has one arithmetic consequence you can check yourself, and this lab is
configured so that you can. Here is the top of `lab/prometheus/prometheus.yml`:

```yaml
global:
  # 15s is chosen, not inherited: it makes count_over_time(x[1m]) == 4,
  # which is how chapter 6 shows that rate() works on samples and not on
  # a continuous line.
  scrape_interval: 15s
  scrape_timeout: 10s
```

Fifteen seconds between samples, sixty seconds of window. Half-open. So: four samples, or
five?

Do not answer from intuition. There is a function whose entire job is to count the samples
in a range vector, and it is the cheapest reality check in PromQL:

```promql
count_over_time(snip_http_requests_total{job="snip-api"}[1m])
```

`count_over_time()` takes a range vector and returns an instant vector holding, per series,
the number of samples in the window. It counts samples; it does not care what they mean.
And unlike everything else in this chapter, it is perfectly happy with **one** sample. With
none it returns no row at all — a series with nothing in the window is not in the range
vector to begin with — and that silence is itself the answer: no scrape landed in that
window. One row reading 1 and no row at all are different diagnoses, and this is the
function that tells them apart.

!!! selfcheck "Self-check"
    Run that `count_over_time()` query on the Table tab. You get one row per series —
    eight per replica at this point in the book, so sixteen rows — and every one of
    them reads **4**. All eight exist from the moment the process starts: Snip creates
    every `(method, code)` combination it can produce at value zero during startup, so
    the row count does not depend on what traffic has happened yet. The sample count is
    a property of the scrape interval, not of the metric.

    A row reading anything other than 4 means the window is not holding four scrapes.
    Divide 60 by the number you got to estimate the interval: 5 means roughly 12 s, 6
    means 10 s, 3 means around 20 s — or a scrape that failed inside the window. If you
    changed `scrape_interval` in Chapter 1's exercises, put it back to `15s`.

Four, not five. A half-open window of length 60 seconds contains exactly four points of a
grid spaced 15 seconds apart, *whatever the phase* — however the scrape schedule happens to
line up against the moment you pressed Execute. That is what left-open buys you: a
deterministic sample count, and no sample counted twice by two neighboring windows.

Prove it is arithmetic rather than luck. Predict these two before you run them:

```promql
count_over_time(snip_http_requests_total{job="snip-api"}[45s])
```

```promql
count_over_time(snip_http_requests_total{job="snip-api"}[75s])
```

45 ÷ 15 = 3. 75 ÷ 15 = 5. Both come back exactly. The rule: **a half-open window of length
*R* over samples spaced *I* apart holds exactly *R*/*I* samples when *I* divides *R* evenly,
and otherwise either ⌊*R*/*I*⌋ or ⌈*R*/*I*⌉**, depending on where it lands relative to the
scrapes. Hold on to that second half. It is why a panel goes blank later in this chapter.

## `rate()`: the first-to-last slope, and the part that scales it up

Now the function itself.

```promql
rate(snip_http_requests_total{
  job="snip-api", instance="snip-api:8000", code="302"}[5m])
```

On the run captured with `date` and `curl`, this returned:

```text
15.410526315789472
```

Against the **15.53** on your sticky note. Close, not equal. The rest of this section is
about where those two numbers come from and why they differ by less than one percent.

The documentation says `rate()` "calculates the per-second average rate of increase of the
time series in the range vector", that "breaks in monotonicity … are automatically adjusted
for", and that "the calculation extrapolates to the ends of the time range". Each clause is
a separate piece of machinery. Take them one at a time.

**One: the reset-corrected first-to-last difference.** Prometheus takes the first and last
sample in the window and subtracts. Walking the samples in between, any time one sample is
*lower* than the one before it, that drop is treated as a counter reset: the counter is
assumed to have gone to zero and started again, so the value before the drop is added back
in. The result is the total the counter would have reached had it never restarted. This is
why `rate()` never returns a negative number for a well-behaved counter.

**Two: the extrapolation.** The first and last samples almost never sit exactly on the
window's edges. In a one-minute window over fifteen-second scrapes, the four samples span
45 seconds, and the remaining 15 seconds of window are gap: some before the first sample,
some after the last. Prometheus scales the difference up by the ratio of the full window to
the span the samples actually covered.

**Three: the division.** For `rate()` specifically, the scaled-up total is then divided by
the **declared** range — the number you wrote in the brackets — to give a per-second figure.

Put those together for the ordinary case and something pleasant falls out. Call the covered
span *C* (45 seconds, in a one-minute window at a 15-second interval) and the declared range
*R* (60 seconds). The two edge gaps must add up to *R* − *C*, so the scale factor is *R*/*C*,
and then you divide by *R*:

```text
rate = Δ × (R / C) / R
     = Δ / C
```

The *R*s cancel. **In the ordinary case, `rate(x[R])` is the plain slope between the first
and last sample in the window: the difference divided by the time between them.** That is
precisely the sum you did with `date` and a calculator. You were not approximating `rate()`;
you were computing it, on a two-sample window.

So why is 15.41 not 15.53? Because you used a fifteen-second window and Prometheus used five
minutes. Your two captures spanned one particular fifteen seconds; the `[5m]` query spans the
285 seconds between its first and last sample and averages everything inside. The load
generator picks each request's route at random, so a five-minute average and a fifteen-second
average will differ by a percent or two forever. Neither is wrong. They answer slightly
different questions.

You can close the gap almost exactly. Run the same query with a thirty-second window, which
at a fifteen-second interval holds exactly two samples:

```promql
rate(snip_http_requests_total{
  job="snip-api", instance="snip-api:8000", code="302"}[30s])
```

Two samples, 15 seconds apart, no reset, no clamping: the result is the difference divided by
15 — identical arithmetic to your sticky note, over a different fifteen seconds. Read it a few
times in a row and you will see it jump by a request per second or so. That is what
"instantaneous" costs you.

### When the cancellation does not happen

The *R*s cancel only when Prometheus extrapolates all the way to both edges. It refuses to do
that in two situations, and both are guard rails against lying.

**The 1.1× threshold.** Prometheus computes the average spacing between the samples it
actually has — the covered span divided by (number of samples − 1) — and multiplies it by
1.1. If the gap between the window's edge and the nearest sample is *at least* that
threshold, Prometheus concludes that the series genuinely was not there, rather than that the
scrape happened to land a little short. Instead of extrapolating across the whole gap, it
extrapolates across **half an average sample interval** and stops.

At a healthy 15-second scrape the average spacing is 15 s and the threshold is 16.5 s. The
two edge gaps have to add up to only 15 s between them, so neither can possibly reach 16.5 —
which is why the ordinary case is so reliably ordinary. Lose the scrape at the *edge* of the
window, though, or query a series that only started existing partway through it, and that
gap jumps to 30 s, the threshold fires, and that side's extrapolation is cut back to 7.5 s.

**The zero clamp, on counters only.** A counter cannot be negative. If the slope Prometheus
just measured implies the counter would have been below zero at the point it is about to
extrapolate back to, it stops where the counter would have been exactly zero instead. A
counter whose first value in the window is 0 has nothing behind it, so its left-hand
extrapolation is clamped to nothing at all.

When either guard rail fires, the numerator is scaled up only part of the way to the window
edge, but the denominator is still the **full declared range**. So `rate()` over a window with
sparse or missing data reads *lower* than the truth. That is deliberate: under-reporting a rate
you are unsure about is safer than inventing traffic that did not happen.

!!! sidebar "Optional — the algorithm in the source"
    Skippable. The thread continues without it.

    All of that arithmetic lives in one Go function, `extrapolatedRate`, in
    `promql/functions.go`. `rate()`, `increase()` and `delta()` are all thin wrappers
    around it, differing only in two booleans: is this a counter (do reset correction,
    apply the zero clamp), and is this a rate (divide by the range).

    The names map onto the prose one for one. `sampledInterval` is the span the samples
    covered; `averageDurationBetweenSamples` is that divided by the number of samples
    minus one; `extrapolationThreshold` is that times 1.1. `durationToStart` and
    `durationToEnd` are the two edge gaps, each replaced by
    `averageDurationBetweenSamples / 2` when it reaches the threshold. `durationToZero`
    is the zero clamp: the covered span times the ratio of the first value to the
    computed increase, which is how far back the counter would have to run to reach
    zero at the measured slope.

    The last line is the one worth remembering, because it is the one everybody gets
    wrong from memory: `factor /= ms.Range.Seconds()`. The division is by `Range` — the
    duration you typed in the brackets — never by the span the samples covered.

## `increase()`, and the two and a half requests

`increase()` is `rate()` without the final division. Same window, same reset correction, same
extrapolation, same guard rails — but the answer is "how many, over this window" instead of
"how many per second". The documentation calls it syntactic sugar and means it:
`increase(x[5m])` is defined as `rate(x[5m])` multiplied by 300. It exists for human
readability. "Fourteen thousand requests in the last hour" lands in a way that "3.9 per
second" does not, especially in an alert annotation somebody reads at three in the morning.

And it returns fractions. Constantly. Here is why, on real numbers from the lab. Put the raw
samples on screen first, on the Table tab:

```promql
snip_links_created_total{
  job="snip-api", instance="snip-api:8000"}[1m]
```

```text
3057 @1785323040.121
3072 @1785323055.121
3087 @1785323070.121
3103 @1785323085.121
```

Four samples, fifteen seconds apart, each about fifteen higher than the last — five percent of
20 requests per second go to `POST /links`, so Snip creates roughly one link a second. Now
predict, on paper, what `increase(...[1m])` will return before you run it:

```text
Δ                = 3103 − 3057 = 46
covered span C   = 85.121 − 40.121 = 45 s
declared range R = 60 s
average spacing  = 45 / (4 − 1) = 15 s
threshold        = 15 × 1.1 = 16.5 s

The two edge gaps must add up to R − C = 15 s, so neither one
can reach the 16.5 s threshold. Nothing is clamped.

factor   = R / C = 60 / 45 = 1.3333…
increase = 46 × 1.3333… = 61.3333…
```

Then run it:

```promql
increase(snip_links_created_total{
  job="snip-api", instance="snip-api:8000"}[1m])
```

```text
61.33333333333333
```

Prometheus prints the full float; how the trailing digits land depends on the exact scrape
timestamps.

The counter observably went up by **46**. `increase()` reports **61.33**. It is not broken and
it has not miscounted. It is answering the question you asked, which was not "how many samples'
worth of increase did you see" but "how much did this counter increase over a sixty-second
window" — and it has only 45 seconds of evidence, so it scales what it has. The fraction has
nowhere to go: 46 × 60 ÷ 45 is not an integer, and no wishing makes it one.

Here is the version of this that most people meet first, and it is worth working through
because it is the one where the guard rail fires. Same 15-second scrape, same
`increase(x[1m])`, but one scrape was missed, so the window holds only three samples, at
`t−30`, `t−15` and `t`, with values 10, 11 and 12:

```text
Δ               = 12 − 10 = 2
covered span C  = 30 s
average spacing = 30 / (3 − 1) = 15 s
threshold       = 16.5 s

left gap  = 60 − 30 = 30 s  →  30 ≥ 16.5, so it IS clamped,
                               down to 15 / 2 = 7.5 s
right gap = 0 s

zero clamp: the counter would reach zero 30 × (10 / 2) = 150 s
back, which is further than 7.5 s, so it does not bind.

factor   = (30 + 7.5 + 0) / 30 = 1.25
increase = 2 × 1.25 = 2.5
```

**Two and a half requests.** There is no such thing as half a request, and that is still the
correct answer. `increase()` is an *estimate of the increase over the window*, not a count of
observed events, and this is what an honest estimate looks like when the evidence is thin.

Notice how the guard rail interacts with the denominator. Had you asked for `rate()` instead,
the numerator would be 2.5 and the denominator would still be the full 60 seconds, giving
0.0417 per second — when the two samples you have say 2 ÷ 30 = 0.0667 per second. The sparse
window reads low, on purpose.

Change one thing and the second guard rail appears. Keep the missing scrape, but make the
counter brand new, so the values are 0, 1 and 2 instead of 10, 11 and 12. Now the zero clamp
bites: at the measured slope the counter would have been at zero 30 × (0 ÷ 2) = 0 seconds
back, which is less than the 7.5 s the left gap was clamped to, so the left extrapolation is
cut to nothing. The factor is (30 + 0 + 0) ÷ 30 = 1, and `increase()` returns exactly **2**.
A young counter is not extrapolated backwards into a past it did not have.

!!! pitfall "Rounding an estimate to make it look tidy"
    Sooner or later you will wrap an `increase()` in `round()` for an alert, because
    "47 errors in the last hour" reads better than "47.31578947368421 errors in the
    last hour". Format it in the annotation template if you must — Chapter 16,
    "Alerting Rules, and What 'Firing' Actually Means", shows you how — but never
    round it inside the expression the alert fires on.

    Rounding turns an estimate into a claim. Compare these two on the 500s. The
    `> 0` is a filter — Chapter 9 covers comparisons properly; for now, read it as
    "keep only the series whose value is above zero", which is what makes this an
    alert expression rather than a graph.

    ```promql
    increase(snip_http_requests_total{
      job="snip-api", code="500"}[5m]) > 0
    ```

    ```promql
    round(increase(snip_http_requests_total{
      job="snip-api", code="500"}[5m])) > 0
    ```

    A series that genuinely saw one error fires the first every time. Whether it fires
    the second depends on which side of 0.5 the extrapolation landed. You have turned a
    stable threshold into a coin flip and hidden that you did it. If you need exact
    counts, widen the window until the extrapolation is a rounding error next to the
    total — and accept that you still have an estimate.

## The panel that goes empty

Now build the thing this chapter exists to build, and break it on the way.

In Grafana, open the Snip RED dashboard at `http://localhost:3000/d/snip-red` and add a
**row** — a named, collapsible group of panels — titled **Rate workbench**, and put three
time series panels in it. Nothing here is permanent —
Chapter 13, "Dashboard Mechanics: Intervals, Panels and Variables", rebuilds this dashboard
properly — so treat the row as a scratchpad. The lab's dashboard provider sets
`allowUiUpdates: true`, so your edits save and survive a reload.

The first panel is the staircase, so you can see what you are replacing. One query, legend
`raw counter`:

```promql
snip_http_requests_total{
  job="snip-api", instance="snip-api:8000", code="302"}
```

The second panel is a rate with a deliberately narrow window:

```promql
rate(snip_http_requests_total{
  job="snip-api", instance="snip-api:8000", code="302"}[30s])
```

Set the time picker to the last hour. The panel draws a line at roughly 15 — recognizably the
number from your sticky note. But look at the right-hand edge: the line stops thirty seconds
or so short of "now" and leaves a sliver of empty panel. That sliver is the leading edge, where
the newest scrape has not been committed yet. Any gap you see *mid*-line is different: 30
divides by 15 exactly, so phase can never cost you a sample here, and a hole in the middle of
this line means a scrape genuinely did not happen. One missed scrape leaves one sample, and one
is not enough.

That is the worst kind of broken panel, because it is broken *sometimes*. A panel that is
always empty gets fixed the day it is built. One that is empty for ninety seconds during the
incident you needed it for does not.

Now narrow the window past the point where two samples can fit, to ten seconds:

```promql
rate(snip_http_requests_total{
  job="snip-api", instance="snip-api:8000", code="302"}[10s])
```

The panel goes empty. Not an error, not a zero line — the header says **No data** and there is
nothing to look at. The query is valid, the metric exists, the labels are right, and you just
watched the same expression work with one number changed. Before reading on, work it out.

A half-open window of 10 seconds over samples spaced 15 seconds apart holds one sample, or
none. It cannot hold two at any alignment. Here is the rule that turns "fewer than two samples"
into a blank panel:

**`rate()`, `increase()`, `irate()`, `delta()`, `idelta()` and `deriv()` all require at least
two samples inside the range. Given fewer, the series is not an error and is not `NaN`. It is
silently dropped from the result.**

Silently. That word is doing a lot of work. Nothing tells you that every evaluation in that
panel produced nothing; the series is not in the answer, and Grafana draws what it was
given. This is the most common cause of "my panel is empty and I cannot see why", and it is
why the debugging ladder has a rung for it.

Now widen it to twenty seconds, which is the version of this you will actually meet in
somebody else's dashboard. This one is worse, because it is a coin flip you cannot see. A
20-second window over a 15-second grid holds two samples when the evaluation timestamp lands
within five seconds after a scrape, and one otherwise. The lab's Prometheus data source
declares `timeInterval: 15s`, so Grafana never steps finer than one scrape interval and every
evaluation timestamp sits on the same 15-second grid; the offset between that grid and Snip's
scrape schedule is fixed. So the panel catches two samples at *every* step or one at *every*
step. It does not alternate, and which one you get is decided by a scrape offset you never
chose. If your `[20s]` panel draws a line, you drew the lucky offset — and it is still one
missed scrape from going blank.

!!! ladder "Ladder → rung 9"
    Empty panel, valid query, metric definitely exists? Appendix B, rung 8: take the
    function off and check that the bare selector returns data. Then rung 9: **is the
    range at least 4× the scrape interval?** Two samples is the bare mathematical
    minimum, and a window sized at the minimum has no margin for anything.

    Rung 8 first, always. Removing `rate(...)` and the `[10s]` together tells you the
    selector is fine; putting the range back without the function tells you how many
    samples are in there. `count_over_time()` answers that directly, and it is the one
    function here that does not need two samples to speak.

Now the third panel. Same query, a two-minute window:

```promql
rate(snip_http_requests_total{
  job="snip-api", instance="snip-api:8000", code="302"}[2m])
```

Solid line, no holes, right-hand end reaching all the way to now. Two minutes at a
fifteen-second scrape is eight samples, so the window can lose one or two and still have
plenty.

### The 4× rule, and its three reasons

The published guidance is that the range in a `rate()` query should be **at least four times
the scrape interval**. Two is the mathematical floor; four is the operational one, and there
are three reasons for the gap.

First, two samples is the bare minimum for a difference to exist at all, and a window that
holds exactly two has zero margin: any deviation from perfect regularity takes you to one.

Second, the most recent scrape may not have been ingested and committed by the time your query
runs. Prometheus scrapes on its own schedule and you query on yours; right at the leading edge
of the window, the sample you expect is sometimes not there yet. That is the missing right-hand
end you saw on the `[30s]` panel.

Third, one failed scrape must not empty the window. Processes pause; a garbage collection or a
slow database can push a scrape past its ten-second timeout. If a single missed scrape blanks
your graph, your graph will blank.

Those three eat two samples of headroom between them, so four is the floor:

| Scrape interval | Minimum sane range | What people write |
|---|---|---|
| 10 s | 40 s | `[1m]` |
| 15 s | 60 s | `[1m]` |
| 30 s | 2 m | `[2m]` or `[5m]` |
| 60 s | 4 m | `[5m]` |

The practical advice that goes with it: pick **one** range for everything you own — 1m, 2m or
5m — and then use it everywhere, in every panel and every rule you later write. Resist the urge
to maintain `rate5m`, `rate10m` and `rate30m` variants of the same thing.

That advice has an exception, and it is dashboards. A panel does not have one fixed step; the
step changes with the width of the panel and the span of the time picker, so a hard-coded range
is tied to a step it cannot see. Change your third panel's query to use Grafana's macro instead
of a literal:

```promql
rate(snip_http_requests_total{
  job="snip-api", instance="snip-api:8000",
  code="302"}[$__rate_interval])
```

Zoom in and out. The window follows the step, so the line is drawn from the same density of
data at every zoom level. A hard-coded `[2m]` does not break here — at a one-week view the step
is around ten minutes and a two-minute window still finds eight samples at every evaluation —
but it is now measuring two minutes out of every ten and discarding the other eight, so a burst
that lasted five minutes can vanish from the graph entirely. Grafana computes `$__rate_interval`
so the window is always at least four scrape intervals wide and always at least one scrape
interval wider than the panel's step, which means nothing falls between two evaluations. That is
the 4× rule, automated — and the "scrape interval" there is the `timeInterval: 15s` on the data
source, which is why Chapter 3, "Your First Dashboard: The Early Win", made you set it.

!!! iou "IOU from chapter 3, settled — and one still outstanding"
    Chapter 3 had you paste `rate()` into three panels and promised the explanation
    here. That debt is now paid: you have computed one by hand, watched the
    extrapolation produce a fraction, and broken a panel by ignoring the two-sample
    rule. Chapters 4 and 5 ran up the same `rate()` debt, and it is paid in the same
    coin: *IOU from chapter 4, settled. IOU from chapter 5, settled.*

    `$__rate_interval` is still owed — you have used it and seen what it fixes, but the
    arithmetic and its precedence chain are Chapter 13. The other two Chapter 3 IOUs are
    `sum by`, in Chapter 8, and `histogram_quantile`, in Chapter 10, "Latency:
    Histograms Without Tears".

## What a restart costs you

Time to break the counter properly. Watch the raw-counter panel and the `[2m]` rate panel side
by side while you do this:

```bash
docker compose restart snip-api
```

Give it forty-five seconds, then look.

The raw counter panel shows a cliff. The line climbs to 48,000-something, drops vertically to
near zero, and starts climbing again. A sawtooth. Same metric, same series identity, same
labels — the process behind it is new, and its counters started at zero, exactly as Chapter 4
said they would.

The rate panel shows a dip and a recovery, and no cliff at all. There may be a short sag while
the container is down and not being scraped, but at no point does it go negative or spike.
`rate()` walked the samples in that window, found one place where the value went down, and
treated it as "the counter went to zero and started again" rather than as "traffic was minus
forty-eight thousand requests per second".

Confirm that Prometheus agrees a reset happened, with the function you met in Chapter 4:

```promql
resets(snip_http_requests_total{
  job="snip-api", instance="snip-api:8000", code="302"}[10m])
```

It reads 1 for ten minutes, then falls back to 0 as the restart slides out of the window.

Now the part nobody tells you. **A reset costs you the requests that happened between the last
scrape before the restart and the moment the process died.** Prometheus has samples, not a
transaction log. If the last scrape saw 48,464 and the service served nineteen more redirects
before it was killed, those nineteen are gone — not estimated, gone. Nothing in the pull model
can recover them, because nothing recorded them.

The loss is bounded by the scrape interval and the traffic rate, which is a useful thing to be
able to say out loud: at 15 requests per second and a 15-second scrape interval, a restart
costs you *at most* about 225 requests' worth of counting, and on average half that. On a
counter that has recorded millions, that is noise. On an error counter that has recorded four,
it is most of your data.

There is a second, sneakier loss. **A reset that happens entirely between two scrapes, where
the counter climbs back above its previous value before the next scrape, is invisible.**
Prometheus sees 100, then 140, and cannot know whether that is forty new events or a restart
followed by 140. It will report forty. That is a limit of sampling a counter, not a defect you
can configure away, and it is why a service that crash-loops every few seconds produces rate
graphs that are quietly, unfixably wrong.

One more thing, and it needs a counter that is young right now, so restart again:

```bash
docker compose restart snip-api
```

Within the first minute of the new process's life, run:

```promql
increase(snip_links_created_total{
  job="snip-api", instance="snip-api:8000"}[1m])
```

The answer is suspiciously tidy — much closer to the raw difference between the samples than
the 61.33 the earlier worked example produced. That is the zero clamp you did on paper,
happening in front of you: the first value in the window is 0 or close to it, so there is
nothing behind it to extrapolate into, and Prometheus does not invent any.

## Three functions that are not `rate()`, and when each is wrong

`rate()` and `increase()` handle counters. Three neighbors handle other things, or claim to,
and each has a failure mode worth meeting once.

**`delta()`** is the gauge equivalent of `increase()`: first-to-last difference, extrapolated
to the window, **with no reset correction**. It is the right tool for "how much did the queue
depth change in the last ten minutes", where a decrease is real and not a restart. Point it at
a counter and it will happily answer, and the answer will be a lie the moment anything
restarts. You have a restart in your recent history, so try it:

```promql
delta(snip_http_requests_total{
  job="snip-api", instance="snip-api:8000", code="302"}[5m])
```

While the restart is still inside the five-minute window you get a large negative number —
tens of thousands of negative requests. `delta()` looked at the first and last samples, saw the
last one was smaller, subtracted, and reported the difference as though a counter running
backwards were a normal thing.

!!! warning
    `delta()` on a counter is not a subtle mistake. It produces a number, the number is
    confidently wrong, and it is wrong precisely when something interesting has
    happened. The one-line rule: **`rate()` and `increase()` for counters, `delta()`
    and `deriv()` for gauges, and nothing crosses over.**

**`deriv()`** is a per-second derivative computed by fitting a straight line through every
sample in the window by least squares, rather than by looking only at the endpoints. Gauges
only, no reset correction, and — like the rest of the family — at least two samples. It is the
honest tool for a value that legitimately moves in both directions:

```promql
deriv(snip_links_active{
  job="snip-api", instance="snip-api:8000"}[5m])
```

`snip_links_active` is a gauge — links get created and links expire — so it goes up and down.
Asking `rate()` about it would be nonsense: every legitimate decrease would be misread as a
counter reset and added back in. Chapter 22, "Metrics From Things You Didn't Write", uses
`deriv()`'s better-known cousin `predict_linear()` to answer "will this disk fill up before
Monday".

**`irate()`** is the one that needs a warning label rather than a description. It computes a
per-second rate from **the last two samples only**, so instead of a curve it draws a picket
fence: every fifteen-second wobble becomes a spike, because there is no averaging left to
absorb it.

That spikiness is why it must never appear in an alert. Chapter 16 will give you `for:`, a
debounce that requires a condition to hold continuously before an alert fires. A picket fence
drops back under any threshold you would realistically set, several times a minute, and every
dip resets that timer — so an `irate()` alert with `for: 5m` can sit over its threshold for an
hour and never fire once.

!!! sidebar "Optional — `irate()`, and why it stays off the main line"
    Skippable, but read it once so you can recognize it in somebody else's dashboard.

    The range you give `irate()` does not widen the calculation; it only says how far
    back to look for a second sample. On a healthy target `irate(x[1m])` and
    `irate(x[10m])` compute the same number from the same two samples.

    Graph it next to `rate()` during a burst and the difference is obvious: `rate()`
    draws a curve, `irate()` draws the fence.

    There is also a quieter trap: at a dashboard step wider than the scrape interval,
    `irate()` ignores almost all of your data — two samples out of every eight, chosen
    by position rather than by anything meaningful. Use `rate()`. If a fast-moving
    counter's detail is genuinely what you need on a graph you are staring at right
    now, `irate()` earns its place, and then only on that graph, never in a rule.

## Verify

`exercises/ch06-predictions.txt` came with `git checkout ch06`: a template with a format and
no answers in it. The predictions are yours to write, one per line, as
`<promql expression> = <number>`, with spaces around the equals sign and `#` for comments.

Write at least two. Two of the suggestions in the file work with everything you have now: the
sample count in a one-minute window, and the load generator's configured rate. Add the
`increase()` on `snip_links_created_total` you worked out on paper as a third. The file's other
suggestions need `count`, `sum` or a comparison — aggregation and operators that arrive in
Chapter 8 and Chapter 9 — and one of them asks for a `route` label your counter does not carry
until Chapter 7, so leave those four commented out for now.

```text
count_over_time(snip_http_requests_total{job="snip-api"}[1m]) = 4
loadgen_target_rps = 20
```

Then run the check:

```bash
make verify-ch06
```

!!! selfcheck "Self-check"
    `make verify-ch06` finishes with `ch06 OK`. Before that it prints, in order: that
    `count_over_time(...[1m])` equals 4 at a 15-second interval, that a `[2m]` rate
    returns a value at all, that your predictions file exists, one line per prediction,
    and that the file holds at least two of them.

    ```text
    == verify-ch06 ==
       expected runtime: about 10 s

    PASS count_over_time(...[1m]) == 4 at a 15 s interval
    PASS rate(...[2m]) returns a value
    PASS exercises/ch06-predictions.txt exists
    PASS prediction 1 within tolerance: 4 vs 4
    PASS prediction 2 within tolerance: 20 vs 20
    PASS the file contains at least two predictions

    ch06: 6 passed, 0 failed
    ch06 OK
    ```

    A `FAIL` on one of your own predictions is not a broken lab. Tolerance is 10% or
    0.5 absolute, whichever is kinder; being outside it means you predicted wrongly,
    which is the exercise working. Work out why before you change the number.

## Common mistakes

**Putting a range vector where a graph goes.** `snip_http_requests_total[5m]` in a time series
panel gives you `invalid expression type "range vector" for range query, must be Scalar or
instant Vector`. The instinct is to hunt for a setting that makes it work. There is none. A
range vector has to be consumed by a function before anything can draw it; the Table tab will
show you the raw samples if that is what you were after.

**Sizing the window from the panel rather than from the scrape interval.** "It refreshes every
thirty seconds so I will use `[30s]`" reads the number off the wrong thing: at a 15-second
scrape that window holds exactly two samples, and one missed scrape empties it. The window is
sized by the scrape interval and nothing else: at least four of them, always. On a dashboard,
let `$__rate_interval` do it.

**Blaming low traffic for an empty rate panel.** A window narrower than two scrapes is empty at
40 requests per second and at 4. Events are irrelevant; *samples* are what matter.

**Expecting `increase()` to be an integer.** It is an estimate over a declared window, and the
extrapolation that makes it an estimate is what puts a fraction on the end. A dashboard reading
"47.3 errors in the last hour" is correct.

!!! pitfall "`rate()` on a gauge, and `delta()` on a counter"
    These are the same mistake seen from two sides, and both produce a number rather
    than an error. `rate()` on a gauge treats every legitimate decrease as a counter
    reset and adds the pre-drop value back in: point it at `snip_links_active` and you
    get a smooth, plausible, entirely fictional line that rises whenever links expire.
    Chapter 4's `SNIP_GAUGE_COUNTER=1` switch exists so you can watch that happen to a
    metric whose *name* says counter.

    Neither direction will ever be caught by a test, a linter or a code review, because
    both are valid PromQL producing valid floats. The only defense is knowing the type
    of the thing you are querying, which is why Chapter 4 came before this one.

**Comparing a hand-computed number against a query pinned to a different process.** If you
`curl localhost:8000/metrics` and then query `{job="snip-api"}` with no `instance` matcher, you
are comparing one replica's arithmetic against whichever series Prometheus returned first — and
the other replica may be nearly idle. Pin the instance.

## Summary

A counter's value is nearly meaningless; the interesting thing is its slope, and a slope needs
a window of samples. PromQL gets you that window with a range-vector selector — a duration in
square brackets — and hands it to a function that turns it back into something you can draw.

`rate()` is not magic. In the ordinary, healthy case it is the difference between the first and
last sample in the window divided by the time between them: the arithmetic you did with `date`,
`curl` and a calculator. Everything else it does is correction for the cases that are not
ordinary — counter resets, missing scrapes, series younger than the window — and every
correction pushes in the conservative direction.

The durable takeaways:

- There are four expression types. A range vector is legal only inside a function that takes
  one, and never at the root of a graph query.
- A range selector is left-open and right-closed since Prometheus 3.0. A 60-second window at a
  15-second scrape holds exactly four samples, whatever the alignment, and `count_over_time()`
  will tell you for free.
- `rate(x[R])` in the ordinary case equals (last − first) ÷ (time between them). The declared
  range cancels — except when a guard rail fires, and then the answer reads low, not high.
- `increase(x[R])` is `rate(x[R])` × *R* seconds. It returns fractions because it is an estimate
  over a declared window, and the fraction is honest. Do not round it inside an expression.
- Every function in this family needs **two samples** in the window, and a series with fewer is
  dropped silently. Size every range at **at least four scrape intervals**; on a dashboard, use
  `$__rate_interval`.
- `rate()`, `increase()` and `irate()` correct counter resets. `delta()`, `idelta()` and
  `deriv()` do not, and are for gauges. Nothing crosses over.
- A reset permanently loses the events between the last scrape and the process's death, and a
  reset entirely between two scrapes is invisible. Both are limits of sampling, not settings.
- `irate()` reads only the last two samples. Never put a threshold on it.

## Exercises

!!! exercise
    **1. Predict, then run (core).** Without executing anything, write down
    what `increase(snip_links_created_total{job="snip-api",
    instance="snip-api:8000"}[1m])` will return, to two decimal places. Use
    the Table tab to read the four raw samples out of
    `snip_links_created_total{job="snip-api", instance="snip-api:8000"}[1m]`
    first — that is not cheating, it is the input. Then run the `increase()`
    and reconcile any difference using the extrapolation arithmetic on
    paper. Put the prediction in `exercises/ch06-predictions.txt` and let
    `make verify-ch06` grade it.

    You should be within a fraction of a request. If you are out by more than a few
    percent, work out which of the two guard rails fired.

    **2. Manufacture an empty panel (warm-up).** Set the load generator to 4
    requests per second with `curl -s -XPOST localhost:8089/control -d
    '{"rps": 4}'`, then graph `rate(snip_http_requests_total{job="snip-api",
    instance="snip-api:8000", code="302"}[10s])`. The panel reads **No
    data**. Walk the ladder from rung 8: strip the function and confirm the
    selector returns a staircase; put the range back without the function
    and count the samples with `count_over_time()`; then find the rung that
    names your problem. Write down the rung number, the one-line fix, and
    one sentence on why dropping to 4 rps was not what emptied the panel.
    Reset with `curl -s -XPOST localhost:8089/chaos/reset` afterwards.

    **3. Prove the identity (core).** On live data, show that
    `increase(snip_http_requests_total{job="snip-api", instance="snip-api:8000",
    code="302"}[5m])` and
    `rate(snip_http_requests_total{job="snip-api", instance="snip-api:8000",
    code="302"}[5m]) * 300` return the same number. Multiplying an instant vector by a
    plain number multiplies every sample's value; Chapter 9 covers what happens when
    both sides are vectors. Run both on the Table tab within a second of each other and
    compare every digit. Then answer in writing: the extrapolation factor changes from
    one evaluation to the next, because the edge gaps move. Why does the identity hold?

    **4. Negative requests (warm-up).** Run
    `delta(snip_http_requests_total{job="snip-api", instance="snip-api:8000",
    code="302"}[5m])`, then `docker compose restart snip-api`, wait thirty seconds, and
    run it again. Record the negative value. Then write the one-line rule you will never
    break again, and check that it says something about metric types rather than about
    `delta()`.

    **5. Two lines, one threshold (core).** Put
    `rate(snip_http_requests_total{job="snip-api", instance="snip-api:8000",
    method="GET", code="500"}[1m])` and
    `irate(snip_http_requests_total{job="snip-api", instance="snip-api:8000",
    method="GET", code="500"}[1m])` on one panel, then run
    `curl -s -XPOST localhost:8089/control -d '{"rps": 40, "error_ratio": 0.30}'`
    and leave it for two minutes. `method="GET"` matters: failures are injected on the
    redirect path and the create path both, and without it you get four lines instead
    of two. You should see one smooth curve and one picket fence. Say which you would
    put a threshold on, and write two sentences on what would go wrong with the other —
    one about the shape of the graph, one about `for:`. Reset with
    `curl -s -XPOST localhost:8089/chaos/reset` when you are done, or `make verify-ch06`
    will grade your `loadgen_target_rps` prediction against 40.

    **6. Change the interval (stretch).** Predict `count_over_time(x[1m])`
    at scrape intervals of 15 s, 20 s and 30 s before you touch anything.
    Then edit `global.scrape_interval` in `lab/prometheus/prometheus.yml`,
    apply it with `docker compose restart prometheus`, wait two minutes for
    the new interval to fill a window, and check each answer with
    `count_over_time(snip_http_requests_total{job="snip-api"}[1m])`. At 30
    s, also look at the `[2m]` rate panel and say how much headroom is left
    against the 4× rule. Put `scrape_interval` back to `15s` when you are
    done — `make verify-ch06` asserts 4, and several later chapters assume
    it.
