# Chapter 18 — Testing Alerts Before They Page You

In Chapter 16, "Alerting Rules, and What 'Firing' Actually Means", you misspelled a route on
purpose. `route="/l/{codes}"` instead of `route="/l/{code}"` — one letter, a plausible
plural. The rules page kept showing the rule as `inactive` with health `ok`, because from
Prometheus's point of view nothing was wrong: the expression evaluated fine and returned
no elements, and a rule that returns no elements is a rule that is not firing. There is no
error, no warning, no red anything. The rule sits there looking healthy for as long as you
leave it, and the first time you find out is the outage it was supposed to catch.

Every other piece of code you write has a defense against this. You would not ship a
payment function whose only proof of correctness was that it compiled. But alerting rules
get reviewed by eye, merged, deployed, and then never executed against a known input until
the day something real happens.

They do not have to be special. A rule file is a pure function from a set of time series
to a set of alerts, and Prometheus ships a tool that feeds it series you invent and tells
you exactly which alerts came out. It needs no server, no database and no network. By the
end of this chapter every alert you wrote in Chapter 16 has a test that fails when you
break the rule, those tests run on every push, and from here on every alerting exercise
comes with a test file you grade yourself against.

!!! objectives "Objectives"
    After this chapter you can:

    - Write a `promtool test rules` file and run it offline against the lab's rules.
    - Read and write the expanding series notation, including the off-by-one in `1x4`.
    - Manufacture a counter reset, a scrape gap and a staleness marker deterministically.
    - Write a test that proves an alert does *not* fire, and prove the test tests something.
    - Say which alerts are worth unit-testing and which are not worth the samples.
    - Run the suite in CI, emit a JUnit report, and fail a build on a broken rule.

## Where you are, and the one incantation

This builds on the lab as Chapter 17, "Alertmanager: Routing, Grouping and Silence", left
it. The `ch18` tag already holds the finished test file and the CI workflow, to read
along with; to write them yourself, check out `ch17` instead.

```bash
cd lab
git checkout ch18
```

You do not need the stack running. `promtool` reads files and evaluates PromQL against
series it builds in memory; it never talks to Prometheus. If the image is on disk — `make
pull` put it there — this chapter works offline with every container stopped.

`promtool` is the command-line companion that ships **inside** the Prometheus image, and
that costs one flag. The image's `ENTRYPOINT` is the server binary, so a plain `docker
compose run prometheus …` starts a Prometheus and ignores everything you typed. Override
it:

```bash
docker compose run --rm --entrypoint /bin/promtool prometheus \
  test rules /etc/prometheus/rules/tests/snip-alerts_test.yml
```

That is the one incantation worth memorizing, and it is the same shape as the `promtool
check config` call Chapter 12, "prometheus.yml in Full", used. `--rm` throws the container
away afterwards, `--entrypoint /bin/promtool` replaces the server with the tool, and
everything after the service name is the tool's own argument list. The `Makefile` wraps
it, adding `--no-deps` so no other service starts and `-T` so the output is not run
through a TTY.

The path is a container path because `compose.yaml` mounts the config directory
read-only:

```yaml
    volumes:
      - ./prometheus:/etc/prometheus:ro
```

So `lab/prometheus/rules/tests/` on your disk is `/etc/prometheus/rules/tests/` inside.
That directory is deliberately one level below the rules themselves, and the reason is a
line in `lab/prometheus/prometheus.yml`:

```yaml
rule_files:
  - /etc/prometheus/rules/*.yml
```

A `rule_files` glob does not recurse. `rules/*.yml` matches the rule files and never
matches `rules/tests/*.yml`, so the test files live inside the mounted directory — which
is what makes them reachable by that single container path — without the server ever
trying to load them as rules.

## The test file, field by field

Create `lab/prometheus/rules/tests/snip-alerts_test.yml`. Start with the header:

```yaml
rule_files:
  - ../snip-recording.yml
  - ../snip-alerts.yml

evaluation_interval: 30s

group_eval_order:
  - snip-red
  - snip-alerts

tests:
```

Four fields, and each one is load-bearing.

`rule_files` lists the files under test. Paths resolve **relative to the test file**, not
to your working directory, which is why they read `../` and why the same file works from
your shell, from inside the container and in CI without anybody editing it. Chapter 16's
alerts sit in `snip-alerts.yml`, but two of them read series that Chapter 15, "Recording
Rules", recorded, so `snip-recording.yml` is loaded too — and it is *executed*, not
stubbed. `promtool` runs your real recording rules over your synthetic input, so a passing
test proves the recording rule and the alert agree.

`evaluation_interval` is how often the rule groups run inside the test. It defaults to one
minute; the lab's `global.evaluation_interval` is `30s`, so say `30s` and test what you
run.

`group_eval_order` fixes the order groups evaluate in. Chapter 15 taught that groups run
independently of each other, which means an alert that reads a recorded series normally
gets whatever was last written. A test that inherited that non-determinism would be
useless, so `promtool` lets you pin it: `snip-red` writes `job:snip_sli_valid:rate5m`
before `snip-alerts` looks for it. You need not list every group, only the ones whose
order matters — but every group you *do* list must exist in the files you loaded.

`tests` is a list of independent scenarios. Each one gets its own input series and its own
clock starting at zero; nothing leaks between them.

Three more fields exist and this lab does not use them, which is worth knowing so you
recognize them in somebody else's file. `fuzzy_compare: true`, at the top level, weakens
floating-point equality by ignoring the last bit of the mantissa — useful when you assert
an exact value that came out of a division. `external_labels:`, inside a test, supplies
what `prometheus.yml`'s `global.external_labels` would have supplied (`cluster: obslab`
and `replica: a`, here); without it, an annotation templating `$externalLabels.cluster`
renders empty in the test and populated in production. `start_timestamp:`, added in
Prometheus 3.9, moves the test's clock off the Unix epoch, which matters only if a rule
of yours does arithmetic on `time()`.

## The notation, and the off-by-one that catches everyone

Every test manufactures its input with `input_series`: a series selector and a string of
values, one per `interval`, starting at the test's time zero.

Writing out sixty samples by hand would be miserable, so the values string has an
expanding notation. `a+bxn` means "start at `a`, add `b`, and do that `n` more times".
`a-bxn` subtracts. `axn` repeats. An underscore is a sample that never arrived, and
`stale` is an explicit staleness marker — the value Prometheus itself writes when a target
disappears, which Chapter 2, "What's Actually on the Wire", introduced.

| Notation | Expands to | Samples |
|---|---|---|
| `0+90x3` | `0 90 180 270` | 4 |
| `3600-90x3` | `3600 3510 3420 3330` | 4 |
| `1x4` | `1 1 1 1 1` | **5** |
| `1 _x3 stale` | `1 _ _ _ stale` | 5 slots |

Look at the third row, because it is the single most common mistake in this file format.
`1x4` is **five** samples, not four. The number after the `x` counts the samples *after*
the first one. At a 30-second interval, `1x4` covers `t=0` through `t=2m`, and `1x9` — the
one you will write most often — covers `t=0` through `t=4m30s`.

You do not have to take that on faith. The tool will count for you. Add the first test:

```yaml
  - name: the off-by-one, checked by the tool
    interval: 30s
    input_series:
      - series: 'up{job="snip-api", instance="snip-api-1"}'
        values: "1x4"

    promql_expr_test:
      - expr: count_over_time(up[1h])
        eval_time: 2m
        exp_samples:
          - labels: '{job="snip-api", instance="snip-api-1"}'
            value: 5
```

Run it with `make test-rules` and it passes. Two details are worth a second look.
`count_over_time` drops the metric name, which is why the expected label set is written
bare — `'{job="snip-api", instance="snip-api-1"}'`, with no `up` in front of it. And
`eval_time: 2m` is a duration from the test's start, not a wall-clock time: inside a
test, the clock starts at zero, so five samples at a 30-second interval reach exactly
`t=2m`.

`promql_expr_test` is the second of the two assertion kinds, and it is the one people
under-use. It evaluates any expression at any instant and compares the whole result set —
labels and values — against what you wrote. It is how you test a recording rule, and how
you check your own arithmetic before you build an alert on top of it.

## The outage that must page

Now the real thing. Chapter 16 left four alerts in `lab/prometheus/rules/snip-alerts.yml`:

| Alert | Fires when | `for` |
|---|---|---|
| `SnipTargetDown` | `up == 0` on a Snip target | 2m |
| `SnipHighErrorRatio` | recorded 5xx ratio above 20 % | 5m |
| `SnipLatencyObjectiveAtRisk` | over 1 % slower than 300 ms | 10m |
| `SnipSLIAbsent` | the SLI series has no data | 10m |

Start with `SnipTargetDown`, because `up == 0` is binary and the arithmetic is visible.
One replica goes down five minutes in and comes back five and a half minutes later; the
other never falters. Ten good samples, then the outage, then recovery — and with `for:
2m`, the page should be firing two minutes after the first zero, at `t=7m`.

```yaml
  - name: a five-minute outage pages, and only for the dead replica
    interval: 30s
    input_series:
      - series: 'up{job="snip-api", instance="snip-api-1",
                 env="lab"}'
        values: "1x10 0x11 1x9"
      - series: 'up{job="snip-api", instance="snip-api-2",
                 env="lab"}'
        values: "1x31"

    alert_rule_test:
      - eval_time: 7m
        alertname: SnipTargetDown
        exp_alerts:
          - exp_labels:
              alertname: SnipTargetDown
              job: snip-api
              instance: snip-api-1
              env: lab
              severity: page
              service: snip
            exp_annotations:
              summary: >-
                Snip replica snip-api-1 has stopped answering scrapes.
              description: >-
                Prometheus has not reached snip-api-1 in job snip-api
                for two minutes. Every request that replica would have
                served is now on the others, or on nobody.
```

!!! trap "`1x10` is eleven samples"
    ```text
    Unit Testing:  /etc/prometheus/rules/tests/snip-alerts_test.yml
      FAILED:
        name: a five-minute outage pages, and only for the dead
        replica,
        alertname: SnipTargetDown, time: 7m,
            exp:[
                0:
                  Labels:{alertname="SnipTargetDown", env="lab",
                  instance="snip-api-1", job="snip-api",
                  service="snip", severity="page"}
            ],
            got:[]
    ```

    *(Output trimmed to fit the page; the real failure also prints the rendered
    annotations.)* The rule is fine. The input is off by one sample. `1x10` is eleven
    samples, `t=0` through `t=5m`, so the first zero lands at `t=5m30s` and the alert
    fires at `t=7m30s` — thirty seconds after you looked. Change `1x10` to `1x9` and the
    test passes.

    This is the off-by-one arriving in the only place it ever does: an assertion that is
    one evaluation early. When a test fires later than you predicted, count the samples
    before you touch the rule.

With `1x9` the arithmetic lines up. Ten samples cover `t=0` through `t=4m30s`, the first
zero lands at `t=5m`, the `for: 2m` timer starts there, and the alert becomes firing at
`t=7m`. The three runs now total 32 samples, which is exactly what `1x31` gives the
healthy replica, so both series end at the same instant.

Add one more assertion above the first, at a moment when the alert is pending:

```yaml
      # One minute into the outage: pending, not firing. Delete the
      # rule's `for: 2m` and this assertion fails.
      - eval_time: 6m
        alertname: SnipTargetDown
        exp_alerts: []
```

`alert_rule_test` reports **only firing alerts**, never pending ones, so an empty list at
six minutes is the shape of a working debounce rather than the shape of nothing
happening.

`exp_alerts` is exhaustive, not a subset. Listing one alert asserts that exactly one alert
instance of that name is firing, which is what makes this test prove `snip-api-2` stayed
quiet without mentioning `snip-api-2` at all.

The label block is the part that catches real bugs. Chapter 16 explained that an alert
inherits every label on the expression's result element, then gets `alertname`, then the
rule's own `labels:` block last. Here `job`, `instance` and `env` came off the input
series, and `severity` and `service` came off the rule. Write them all out. The day
somebody wraps the expression in `sum by (job)` to "clean it up", `instance` disappears
from the page, nobody can tell which replica died, and this test is what says so.

The annotations are asserted as rendered text, with `{{ $labels.instance }}` already
expanded to `snip-api-1`. That is stricter than it looks: templating a label the alert
does not carry renders an empty string rather than an error, and this is how you find out.

## The test that is worth more: the blip that must not page

`for: 2m` exists to swallow nonsense: one failed scrape during a garbage collection, one
evaluation in the middle of a rolling restart. The alert you want is one that ignores
those. So assert it.

```yaml
  - name: a thirty-second blip must never page
    interval: 30s
    input_series:
      # Exactly one failed scrape, at t=5m.
      - series: 'up{job="snip-api", instance="snip-api-1",
                 env="lab"}'
        values: "1x9 0 1x20"
      - series: 'up{job="snip-api", instance="snip-api-2",
                 env="lab"}'
        values: "1x31"

    # The blip really did make the expression true — otherwise the
    # assertions below would pass for the wrong reason.
    promql_expr_test:
      - expr: 'up{job="snip-api", instance="snip-api-1"} == 0'
        eval_time: 5m
        exp_samples:
          - labels: 'up{job="snip-api", instance="snip-api-1",
                     env="lab"}'
            value: 0

    alert_rule_test:
      - eval_time: 5m
        alertname: SnipTargetDown
        exp_alerts: []
      # Two minutes after the blip started. A `for` timer that banked
      # its progress instead of resetting would have fired by now.
      - eval_time: 7m
        alertname: SnipTargetDown
        exp_alerts: []
      - eval_time: 10m
        alertname: SnipTargetDown
        exp_alerts: []
```

This is the harder kind of test and the more valuable one. An alert that fires when it
should not is caught by the first person who ignores the pager; an alert that fires when
it *should* is caught by the first outage. But a rule that has quietly stopped being able
to fire is caught by nobody, ever — and `exp_alerts: []` is the exact shape of an
assertion that passes for that reason.

!!! pitfall "The negative test that tests nothing"
    Misspell the job in your input series — `job="snip_api"` with an underscore — and the
    rule's `up{job=~"snip-api|snip-worker"} == 0` matches nothing, no alert fires, and
    your "must not page" test passes. It would keep passing if you deleted `for: 2m`
    outright. It would keep passing if you deleted the entire rule. A green suite that
    proves nothing is worse than no suite, because you now trust it.

    The fix is the `promql_expr_test` above. It asserts that the alert's own expression
    returned a sample at the moment of the blip, so the only thing standing between that
    input and a page is the `for` clause. Pair every negative assertion with positive
    evidence that the input reached the rule.

Note also what `0` is *not*. A missed scrape is `_`, and `up` keeps its previous value for
the five-minute lookback delta Chapter 2 introduced. A target removed from service
discovery is `stale`, and from that sample on the series has no value at all, so `up == 0`
returns nothing and `SnipTargetDown` cannot fire. That is the same distinction Chapter 16
made with `docker compose pause` versus `docker compose stop`, and you can now assert it
offline in half a second instead of waiting two minutes for a container.

## Manufacturing an outage, and a counter reset

`SnipHighErrorRatio` is the third alert, and before a test can assert that it stays quiet
you need one that asserts it does not. A steady one-in-four failure rate is unambiguously
an outage:

```yaml
  - name: a sustained one-in-four failure rate pages
    interval: 30s
    input_series:
      - series: 'snip_http_requests_total{job="snip-api",
                 instance="snip-api-1", env="lab",
                 route="/l/{code}", method="GET", code="302"}'
        values: "0+75x30"
      - series: 'snip_http_requests_total{job="snip-api",
                 instance="snip-api-1", env="lab",
                 route="/l/{code}", method="GET", code="500"}'
        values: "0+25x30"

    alert_rule_test:
      - eval_time: 3m
        alertname: SnipHighErrorRatio
        exp_alerts: []
      - eval_time: 10m
        alertname: SnipHighErrorRatio
        exp_alerts:
          - exp_labels:
              alertname: SnipHighErrorRatio
              job: snip-api
              route: "/l/{code}"
              severity: page
              service: snip
            exp_annotations:
              summary: >-
                25% of Snip redirects on /l/{code} are failing.
              description: >-
                The 5xx ratio on GET /l/{code} has been above 20
                percent for five minutes. Everyone following a short
                link is affected, in proportion.
```

Two things to notice. `instance` and `env` are on the input and absent from the expected
labels, because Chapter 15's recording rule aggregates `by (job, route)` — so this
assertion is also a test of that `by` clause. And `25%` in the summary is `$value` after
`humanizePercentage`, so the annotation is asserted exactly as you would read it on your
phone.

Now the harder case. Counters reset when a process restarts, and Chapter 6, "`rate()`,
`increase()`, and Why Nothing Is a Whole Number", showed that `rate()` detects the drop and
adds the pre-reset value back. Every alert built on a rate depends on that, and you have
never once tested it, because arranging a restart at a chosen moment against live traffic
is fiddly.

In this notation, arranging one costs a single space — two runs of the same expansion,
back to back:

```text
0+10x50 0+10x50
```

That is 51 samples climbing to 500, then 51 more starting again at zero. Scale it to the
lab's traffic — ninety successful redirects and ten failures per 30-second interval, a
steady 10 % error ratio, with the replica restarting twenty minutes in:

```yaml
  - name: a replica restart does not spike the error ratio
    interval: 30s
    input_series:
      - series: 'snip_http_requests_total{job="snip-api",
                 instance="snip-api-1", env="lab",
                 route="/l/{code}", method="GET", code="302"}'
        values: "0+90x40 0+90x40"
      - series: 'snip_http_requests_total{job="snip-api",
                 instance="snip-api-1", env="lab",
                 route="/l/{code}", method="GET", code="500"}'
        values: "0+10x40 0+10x40"

    promql_expr_test:
      # Across the reset, the recorded ratio is still one in ten.
      # `bool` turns the comparison into a 1 and drops the metric
      # name, so this says "between 5 % and 15 %" without pretending
      # to know the last bit of a division.
      - expr: 'job_route:snip_http_errors:ratio_rate5m{
               job="snip-api", route="/l/{code}"} > bool 0.05'
        eval_time: 21m
        exp_samples:
          - labels: '{job="snip-api", route="/l/{code}"}'
            value: 1
      - expr: 'job_route:snip_http_errors:ratio_rate5m{
               job="snip-api", route="/l/{code}"} < bool 0.15'
        eval_time: 21m
        exp_samples:
          - labels: '{job="snip-api", route="/l/{code}"}'
            value: 1

    alert_rule_test:
      - eval_time: 21m
        alertname: SnipHighErrorRatio
        exp_alerts: []
      - eval_time: 25m
        alertname: SnipHighErrorRatio
        exp_alerts: []
```

Work through what the correction does at `t=21m`, because the result is prettier than you
might expect. The five-minute window there spans the restart: ten samples, climbing to 3,600
and then starting again at 0 and 90. For the 302 counter, `rate()` sees that drop, adds the 3,600
back, and ends up with an increase of 720 across those samples instead of the 810 an
uninterrupted run would have given — the one interval that straddles the reset is gone,
exactly as Chapter 6 said. The 500 counter loses the same interval: 80 instead of 90.
Both sides of the ratio shrink by the identical factor, so the ratio is untouched at 0.1
and the alert stays quiet through a restart. That is the behavior you want, it is not
obvious, and now it is asserted.

## Break the rule, and watch the test catch it

Two more tests, on `SnipLatencyObjectiveAtRisk`. Both feed the same two histogram series
and differ in one number.

```yaml
  - name: one redirect in ten slower than 300 ms opens a ticket
    interval: 30s
    input_series:
      - series: 'snip_http_request_duration_seconds_bucket{
                 job="snip-api", instance="snip-api-1", env="lab",
                 route="/l/{code}", method="GET", code="302",
                 le="0.3"}'
        values: "0+90x100"
      - series: 'snip_http_request_duration_seconds_count{
                 job="snip-api", instance="snip-api-1", env="lab",
                 route="/l/{code}", method="GET", code="302"}'
        values: "0+100x100"

    alert_rule_test:
      - eval_time: 45m
        alertname: SnipLatencyObjectiveAtRisk
        exp_alerts:
          - exp_labels:
              alertname: SnipLatencyObjectiveAtRisk
              job: snip-api
              severity: ticket
              service: snip
              route: "/l/{code}"
            exp_annotations:
              summary: >-
                Snip redirects are missing the 300 ms latency
                objective.
              description: >-
                10% of GET /l/{code} requests took longer than 300 ms
                over the last half hour, against a 1 percent
                objective.

  - name: every redirect inside 300 ms opens nothing
    interval: 30s
    input_series:
      # Every observation lands in the le="0.3" bucket, so the slow
      # fraction is exactly zero.
      - series: 'snip_http_request_duration_seconds_bucket{
                 job="snip-api", instance="snip-api-1", env="lab",
                 route="/l/{code}", method="GET", code="302",
                 le="0.3"}'
        values: "0+100x100"
      - series: 'snip_http_request_duration_seconds_count{
                 job="snip-api", instance="snip-api-1", env="lab",
                 route="/l/{code}", method="GET", code="302"}'
        values: "0+100x100"

    alert_rule_test:
      - eval_time: 45m
        alertname: SnipLatencyObjectiveAtRisk
        exp_alerts: []
```

Notice where `route` comes from here. `sum by (job)` threw it away, so the rule's
`labels:` block puts it back — the opposite of `SnipHighErrorRatio`, which inherits
`route` from its recording rule. Two rules, the same label, opposite sources, and only one
of them survives somebody editing an aggregation.

Now break the rule on purpose. Open `lab/prometheus/rules/snip-alerts.yml` and change
`SnipLatencyObjectiveAtRisk`'s final comparison from `> 0.01` to `< 0.01`. Run `make
test-rules`:

```text
Unit Testing:  /etc/prometheus/rules/tests/snip-alerts_test.yml
  FAILED:
    name: one redirect in ten slower than 300 ms opens a ticket,
    alertname: SnipLatencyObjectiveAtRisk, time: 45m,
        exp:[
            0:
              Labels:{alertname="SnipLatencyObjectiveAtRisk",
              job="snip-api", route="/l/{code}",
              service="snip", severity="ticket"}
        ],
        got:[]
    name: every redirect inside 300 ms opens nothing,
    alertname: SnipLatencyObjectiveAtRisk, time: 45m,
        exp:[],
        got:[
            0:
              Labels:{alertname="SnipLatencyObjectiveAtRisk",
              job="snip-api", route="/l/{code}",
              service="snip", severity="ticket"}
        ]
```

*(Output trimmed to fit the page; the real failure also prints the rendered
annotations.)*

Two failures, in opposite directions, from one character. The healthy service now opens a
ticket and the sick one does not, and the suite said so in under a second with nothing
running.

While you are iterating on one broken test, `--run` takes a regular expression and skips
every test whose `name` does not match, so you can work on a single case in a file of
thirty without reading thirty results. Then change `<` back to `>`, run the whole suite,
and read the line you will be looking for from now on:

```text
Unit Testing:  /etc/prometheus/rules/tests/snip-alerts_test.yml
  SUCCESS
```

Finish the file with the fourth alert. `SnipSLIAbsent` is the odd one: it fires when a
series is *missing*, so its test supplies a target that is up and answering but has never
served a redirect, which leaves Chapter 15's `job:snip_sli_valid:rate5m` with nothing to
record.

```yaml
  - name: an SLI that never appears is caught by absent()
    interval: 30s
    input_series:
      - series: 'up{job="snip-api", instance="snip-api-1",
                 env="lab"}'
        values: "1x40"

    alert_rule_test:
      - eval_time: 5m
        alertname: SnipSLIAbsent
        exp_alerts: []
      - eval_time: 15m
        alertname: SnipSLIAbsent
        exp_alerts:
          - exp_labels:
              alertname: SnipSLIAbsent
              job: snip-api
              severity: page
              service: snip
            exp_annotations:
              summary: >-
                The Snip availability indicator has no data, so
                anything built on it is blind.
              description: >-
                The recording rule job:snip_sli_valid:rate5m produced
                no series for ten minutes. Either snip-api is not
                being scraped, or it has served no redirects at all.
```

The `job="snip-api"` in the expected label set is not decoration either. Chapter 16
showed that `absent()` reconstructs its output labels from the equality matchers in the
selector and nothing else; drop the matcher from the rule and this assertion fails,
because the alert would arrive carrying no `job` and nobody could route it.

!!! iou "IOU from chapter 16, settled"
    Chapter 16 promised that the only reliable defense against a rule that cannot fire is
    a test that asserts it fires, and that this chapter would write those tests for
    exactly those four rules. It has. The second debt from that box — replacing the
    threshold-plus-`for` shape entirely — belongs to Chapter 21, "Burn Rates: Alerts
    That Don't Cry Wolf", and it arrives with its own test file.

## What is not worth testing

Be honest about the limits. Every sample in `input_series` is a sample the tool generates
and holds, so a test costs whatever the longest window in the rules it exercises costs. A
five-minute window is a handful of samples. A three-day window, at the 30-second interval
you are testing with, is 8,640 samples *per series* before you have asserted anything —
and what those samples would additionally prove is that `rate()` works over long ranges,
which is Prometheus's problem and not yours.

So: unit-test the short windows, where the paging risk lives, and unit-test the label
sets and the guards everywhere. Chapter 21 writes a rule with a three-day window and says
the same thing in a comment rather than generating three days of nothing.

## Running it in CI

Everything so far was a command you typed. Now make the machine type it.

`make test-rules` already exists in the lab's `Makefile`, and it is one line:

```text
test-rules: ## promtool test rules over prometheus/rules/tests/
	$(PROMTOOL_SH) 'promtool test rules /etc/prometheus/rules/tests/*.yml'
```

`PROMTOOL_SH` routes through `/bin/sh` rather than `/bin/promtool`, because the `*.yml`
glob has to be expanded inside the container where the files are. Every test file a later
chapter adds is picked up with no edit here.

`lab/.github/workflows/rules.yml` runs four steps, and every one of them is a command this
book already had you type by hand:

```yaml
      - name: promtool check config --lint=all
        run: |
          docker run --rm \
            -e PROM_REPLICA=a \
            -v "$PWD/prometheus:/etc/prometheus:ro" \
            --entrypoint /bin/promtool "$PROM_IMAGE" \
            check config --lint=all /etc/prometheus/prometheus.yml

      - name: make test-rules
        run: make test-rules
```

That equivalence is the whole design. A CI job that reimplements your checks in YAML is a
second thing to keep in step with the first, and the day they disagree is the day you stop
believing either — so `make test-rules` is invoked as itself. `PROM_IMAGE` is the same
`quay.io/prometheus/prometheus:v3.13.1` pin as `compose.yaml`, because a rule test that
passes against an unpinned server tells you nothing about the server you run.
`PROM_REPLICA=a` is set because `prometheus.yml` expands `${PROM_REPLICA}` in an external
label, and an unset variable would lint clean while meaning something else.

The step between those two is `promtool check rules`, which `make check` also runs. It
answers a different question: `check rules` parses the files and the PromQL inside them,
so it catches a stray tab and an unbalanced parenthesis, while `test rules` catches a rule
that parses perfectly and means the wrong thing. You want both, and you want the cheap one
first, because a syntax error makes every unit test fail for a reason that is not the one
you are hunting.

The last step runs the suite again with `--junit`, which writes the same results as an XML
report the Actions UI can render as a list of named test cases:

```yaml
          mkdir -p ci-out && chmod 0777 ci-out
          docker run --rm \
            -v "$PWD/prometheus:/etc/prometheus:ro" \
            -v "$PWD/ci-out:/out" \
            --entrypoint /bin/sh "$PROM_IMAGE" \
            -c 'promtool test rules --junit /out/rule-tests.xml \
                  /etc/prometheus/rules/tests/*.yml'
```

The `chmod` is not superstition: the image runs as `nobody`, a bind-mounted directory keeps
your host's ownership, and without it the report is unwritable and the step fails for a
reason that has nothing to do with your rules. Note where `--junit` goes — on the `test`
command, before `rules`. The report is uploaded as a build artifact, so a failure on
somebody else's branch is readable without cloning it.

!!! selfcheck "Self-check"
    Run `make verify-ch18`. It needs `make` or `docker` on your PATH and takes about
    thirty seconds. It must end:

    ```text
    PASS make test-rules exits 0
    PASS .github/workflows/rules.yml exists
    PASS the workflow runs promtool
    SKIP the CI workflow is green — that lives on GitHub, not on
         your laptop

    ch18: 5 passed, 0 failed, 1 skipped
    ch18 OK
    ```

    The `SKIP` is deliberate and is not a failure. Whether a workflow is green on GitHub
    is not something a script on your laptop can know, so it says so instead of pretending.

## Common mistakes

**Counting `1x4` as four samples.** The most common error in this file format, and it
shifts every `eval_time` in your test by one interval. When a test fires one evaluation
later than you predicted, count the samples before you touch the rule.

**Expecting `alert_rule_test` to report pending alerts.** It reports firing alerts only.
`exp_alerts: []` while the alert is pending is correct, which is why an assertion placed
shortly before the `for` elapses is how you test a debounce.

**Writing a relative `rule_files` path from your shell's point of view.** The paths resolve
relative to the test file. `../snip-alerts.yml` is right from `rules/tests/`;
`prometheus/rules/snip-alerts.yml` works from the repository root and breaks the moment CI
or the container runs it from anywhere else.

**Asserting an annotation you have not rendered.** `exp_annotations` compares the expanded
text. Copy the expected wording out of a failing run rather than out of the rule file, and
the empty strings left by a label the alert does not carry show up immediately.

**Testing the server instead of the files.** `make test-rules` reads
`lab/prometheus/rules/`, not the rules Prometheus currently has loaded, so a test can pass
against a file you edited and never reloaded. `make check` lints what is on disk; `make
reload` makes the server agree with it.

!!! warning
    Do not add your test files to `rule_files` in `prometheus.yml`. They are not rules,
    the server would reject them, and the reason they sit in `rules/tests/` is that the
    config's glob does not recurse into it. If you ever see Prometheus fail to start with
    a parse error naming a `_test.yml` file, that is what happened.

## Summary

A rule file is a function, and Prometheus ships the harness to call it. You wrote a file
that invents time series, runs your real recording rules and your real alerting rules over
them, and asserts which alerts came out — down to the label set and the rendered
annotation text. It runs in under a second, needs no server and no network, and it caught
a one-character change to an operator that no amount of reading the rule would have
caught.

The durable takeaways:

- Alerting rules are code and get the same defenses as code. The failure mode they have
  that other code does not is *silence*, and silence is what a test file converts into a
  red build.
- `n` in `a+bxn` counts the samples after the first, so `1x4` is five samples. Check your
  arithmetic with `count_over_time` when it matters.
- `_` is a missed scrape and the previous value stands for the lookback delta; `stale` is
  a staleness marker and the series has no value at all from that point. They produce
  different alerts.
- Two runs of one expansion back to back manufacture a counter reset. A ratio survives one
  intact; an absolute rate loses the partial interval.
- A test that asserts nothing fires must also prove the input reached the rule, or it will
  pass for the wrong reason forever.
- Test the short windows and the label sets. A three-day window costs 8,640 samples per
  series to prove something about `rate()` that is not yours to prove.
- CI must run the same command you run, not an equivalent one. `make test-rules` in a
  workflow step, not a reimplementation of it in YAML.

## Exercises

!!! exercise
    **1. Seven samples (warm-up).** Write an `input_series` whose values
    expand to exactly seven samples, and add a `promql_expr_test` with
    `count_over_time` that proves it. Two different notations get you there;
    find both. You should see `SUCCESS`, and your expected label set must
    omit the metric name.

    **2. Going stale mid-test (core).** Take the five-minute outage test and
    replace the run of zeros with a `stale` marker followed by underscores.
    Assert what `SnipTargetDown` does at `t=8m`. Say what you expect in one
    sentence before you run it, then check yourself — the answer is the
    reason Chapter 16 told you to `pause` a container rather than `stop` it.

    **3. Finding the boundary (core).** Keep the thirty-second blip test.
    Shorten `SnipTargetDown`'s `for` to `1m`, then `30s`, then delete it,
    re-running the suite each time. Record the exact value at which the blip
    starts paging, and say why that value and not the one before it. Put
    `for: 2m` back when you are done.

    **4. A report for a colleague (stretch).** Add `--junit
    /out/rule-tests.xml` to a local run, using a second `-v` bind so the
    container can write it, and open the XML. Each test's `name` becomes a
    test-case name. Rename one of your tests so that the report alone tells
    a colleague what broke, and say what you changed.

    **5. Four breakages (stretch).** Break each of the four alerts in a
    different way: swap a comparison operator, delete a `for`, aggregate
    away a label that an annotation templates, and misspell a matcher so the
    expression returns nothing. Confirm the suite catches all four, and note
    which one produced the least readable failure.

    **6. Make it required (stretch).** Push the lab to your own repository
    and make the `rules` workflow a required status check on pull requests.
    Open a pull request that changes `> 0.01` to `< 0.01` and confirm you
    cannot merge it.
