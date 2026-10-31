# Chapter 19 — What a Page Should Say, and Who Watches the Watcher

It is 03:14. Your phone lights the ceiling. You unlock it with one eye shut and read all
that the two annotations from Chapter 16, "Alerting Rules, and What 'Firing' Actually
Means", gave Alertmanager to say:

```text
[FIRING x1] SnipTargetDown (snip)
Snip replica snip-api-2 has stopped answering scrapes.
Prometheus has not reached snip-api-2 in job snip-api for two
minutes. Every request that replica would have served is now on
the others, or on nobody.
```

Now what? You have a service name and a container name. You do not know whether anybody
is affected, because another replica may be absorbing the traffic without a hiccup, and
you do not know where to look, so you will open a laptop, find Grafana, guess a time
range, and lose four minutes before you see a single number. The rule is correct. The
page is nearly useless.

That is the first half of this chapter: an alert is a message from you, awake, to you,
asleep, and it has about ninety seconds to be useful. The second half is the question
nobody asks until the morning after: what if the phone had never buzzed at all? A rule
engine that has stopped evaluating is, from the outside, indistinguishable from one where
nothing is wrong — and *quieter*, which is worse, because quiet is what you have trained
yourself to read as good.

!!! objectives "Objectives"
    After this chapter you can:

    - Define a severity taxonomy that maps one-to-one onto Alertmanager routes, rather
      than one that decorates labels and changes nothing.
    - Write an annotation that makes a 3 a.m. page actionable in ninety seconds.
    - Say what a runbook is for, and why a troubleshooting flowchart is the wrong
      artifact.
    - Monitor the monitoring system, and route a dead man's switch to something that
      screams when it stops arriving.
    - Audit your alert noise from Alertmanager's own metrics, and defend or delete
      every alert.
    - Quote a quantitative standard for an acceptable on-call load.

## Getting the lab into position

This chapter builds on Chapter 17, "Alertmanager: Routing, Grouping and Silence", and
Chapter 18, "Testing Alerts Before They Page You". The `ch19` tag already holds everything
this chapter builds — the five-field annotations, two new scrape jobs, `meta-alerts.yml`,
the Watchdog and its `deadman` route — to read along with. To build them yourself, check
out `ch18` instead; the steps here start there.

```bash
cd lab
git checkout ch19
make check
make up
make ps
```

Seven files here are not built by a step — the verify script, the noise scenario, the
four runbooks and the review log, since writing the last five is exercises 3 and 4. On
the `ch18` path, fetch them first:

```bash
git checkout ch19 -- scripts/verify-ch19.sh \
  scripts/scenario-noise-history.sh docs/runbooks docs/ALERT-REVIEW.md
```

Put the load generator into a known, boring state, so nothing fires while you read:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","error_ratio":0}'
```

Open the pager at `http://localhost:5001/`. On `ch18` the header stays gray forever:

```text
No heartbeat yet
Waiting for the first POST /deadman. The Watchdog alert and the
deadman receiver are wired up in chapter 19.
```

On `ch19` it is gray only until the first heartbeat lands, then turns green — where this
chapter ends. As in Chapter 16, "reload" means `make check` followed by `make reload`.

## Severity is a route, not an adjective

Every rule you wrote in Chapter 16 carries a `severity` label, and it is tempting to read
it as a description of how bad things are — `critical` worse than `warning`, worse than
`info` — and to add whichever word feels right on the day. It describes nothing. It is an
input to a routing decision, and it means exactly what your Alertmanager route tree says
it means. If your tree has no route matching `severity="warning"`, writing
`severity: warning` does not make an alert less urgent; it makes it go somewhere you were
not thinking about.

Prove it, with Chapter 17's hand-POSTed alert:

```bash
curl -s -XPOST http://localhost:9093/api/v2/alerts \
  -H 'Content-Type: application/json' -d '[{
    "labels": {"alertname": "SnipCacheColdish",
               "severity": "warning",
               "service": "snip",
               "job": "snip-api"},
    "annotations": {"summary": "cache hit ratio is lowish"}
  }]'
```

The root route's `group_wait` is ten seconds. Give it fifteen, then reload the pager.

!!! trap "The severity that routes nowhere"
    The alert arrives, and it is delivered — to the receiver at the top of the tree,
    which exists only because the root route must match everything:

    ```text
    #14 · receiver pager-default · reason first notification
      · 03:19:07
    Grouped by alertname="SnipCacheColdish" service="snip"
    ```

    Here `pager-default` writes to the page you are looking at, so you notice. In a real
    installation the root receiver is a channel nobody has read since the week it was set
    up. A `severity` with no matching route is not a quieter page; it is a page that goes
    to the drawer.

That alert carries no `endsAt` — the one case where `resolve_timeout: 5m` applies — so it
clears itself.

The fix is not a better vocabulary but a shorter one: the smallest set of severities that
produces *genuinely different human behavior*, each with a route. This lab uses three, and
`LAB-SPEC` fixes them as the only legal values:

| `severity` | Route sends it to | What a human does |
|---|---|---|
| `page` | `pager-page`, and `pager-ticket` as a record | Wakes up. Minutes, not hours. |
| `ticket` | `pager-ticket` | Sees it next working day. |
| `none` | `deadman`, or the `null` receiver | Nothing. It is machinery. |

Three levels, three routes, one-to-one. Read the tree in
`lab/alertmanager/alertmanager.yml` with that table beside it and it stops being
configuration and becomes policy: `page` means somebody's sleep is worth less than this
problem, said in YAML. Downgrading from `page` to `ticket` is a one-word edit that changes
who is woken and nothing else — the cheapest intervention in alerting, and what the audit
at the end of this chapter goes looking for.

## The five fields a page has to carry

Chapter 16 gave every rule two annotations and said a good one answers three questions:
what is broken, who it hurts, and what to look at first. That was right and not enough —
two answers doing three jobs, and no links at all. Here is the template this lab uses, on
every alerting rule you write:

| Annotation | The question it answers |
|---|---|
| `summary` | What is broken, in words a user would use. One line. |
| `description` | Who is affected and how many, with the number in it. |
| `first_step` | The single first thing to look at. Not a procedure. |
| `dashboard_url` | Somewhere to look, with the time range already set. |
| `runbook_url` | One page, about this alert, written before the incident. |

Five is what you can read on a phone screen before deciding whether to get out of bed.
`make verify-ch19` enforces the mechanical half — five annotations on every rule bar the
Watchdog, none empty, one a runbook link and one something you can open. The names and the
order are this lab's convention, and nothing checks them.

Chapter 16 taught the templating for the first two — `{{ $labels.x }}`, `{{ $value }}`,
and the `humanize` family, because `$value` raw is a float with fifteen digits — and what
is new here is editorial. `summary` is the line on the lock screen, so it must not be
about your monitoring: "Snip replica snip-api-2 has stopped answering scrapes" is about
scraping; "snip-api-2 is not serving" is about serving.

`first_step` is the field almost nobody writes and the one that saves the most time, and
it is deliberately singular. Not "investigate the database" — *the one thing to look at
before anything else*, chosen because it splits the possibilities in half. For a bad error
ratio: "split by instance, because one bad replica and a bad deploy look identical on the
aggregate panel and want opposite responses." The two links are where a five-field
annotation most often still fails.

### Links you can use half asleep

A dashboard link without a time range is a link to *now*, the one moment you already know
about. Every dashboard URL in this lab carries its range in the query string:

```text
http://localhost:3000/d/snip-red?from=now-6h&to=now
```

Six hours for a slow-moving problem, one hour for an outage — chosen per alert, so the
panel that opens contains the thing you were paged about and enough history to see when it
started. Chapter 13, "Dashboard Mechanics: Intervals, Panels and Variables", used the time
picker; the same two values travel in the URL.

A runbook link should be derived mechanically from the alert name, not chosen. This lab
uses `https://runbooks.example.com/obslab/` plus the alert name in lower case, so
`SnipTargetDown` becomes:

```text
https://runbooks.example.com/obslab/sniptargetdown
```

Deriving it means you can never forget one and a linter can check every rule. That domain
does not resolve — RFC 2606 reserves `example.com` for documentation — so the pages those
URLs stand for are the Markdown files in `lab/docs/runbooks/`.

There is a third link you did not write, and people expect it to work: the `generatorURL`
Chapter 17 found on every payload, a deep link back to the expression that fired. The
Watchdog is where to read one, and the short version is that it does not work either.

## Rewriting the file

Open `lab/prometheus/rules/snip-alerts.yml`. Its four rules from Chapter 16 each gain
three annotation keys. Here is `SnipTargetDown` in full, as the template wants it:

```yaml
      - alert: SnipTargetDown
        expr: up{job=~"snip-api|snip-worker"} == 0
        for: 2m
        labels:
          severity: page
          service: snip
        annotations:
          summary: >-
            Snip replica {{ $labels.instance }} has stopped
            answering scrapes.
          description: >-
            Prometheus has not reached {{ $labels.instance }} in
            job {{ $labels.job }} for two minutes. Every request
            that replica would have served is now on the others,
            or on nobody.
          first_step: >-
            Run make ps and look at that container: is it
            restarting, or is it gone?
          dashboard_url: http://localhost:3000/d/snip-red?from=now-1h&to=now
          runbook_url: https://runbooks.example.com/obslab/sniptargetdown
```

The `>-` is YAML's folded block scalar with the trailing newline stripped: it wraps an
annotation over several lines and yields one line of text. Use it everywhere; annotations
that run past column 80 in a rule file are annotations nobody proof-reads.

Do the same for the other three. `SnipHighErrorRatio` gets a `first_step` of "split by
instance before you do anything else" and points at the RED dashboard over six hours.
`SnipLatencyObjectiveAtRisk` gains a sentence saying what the number means to a person —
"Visitors are waiting for a redirect that should be instant" — and a `first_step` of the
p99 panel beside the database panel. `SnipSLIAbsent` sends you to the targets page.

Reload, and then run Chapter 18's unit tests:

```bash
make test-rules
```

The four tests that assert an alert fires now fail; the three that assert nothing fires
still pass, because a test with no `exp_annotations` has nothing to mismatch.
`exp_annotations` is **exhaustive** — not a subset check — so five annotations against a
test expecting two is a mismatch, and that is worth paying for: a test that checked only
the annotations you remembered would never notice the one you dropped. The updated file is
at the `ch19` tag.

Now read a rule back from the server:

```bash
curl -s http://localhost:9090/api/v1/rules \
  | jq -r '.data.groups[].rules[]
           | select(.name=="SnipTargetDown") | .annotations'
```

The values come back with the `{{ }}` still in them, because `/api/v1/rules` shows the
rule and not an instance of it. Templating happens when an alert becomes active, so
rendered text needs `/api/v1/alerts` — a distinction about to matter.

## What a runbook is for

Every one of those annotations now links a runbook, and all four ship with the `ch19` tag
in `lab/docs/runbooks/`. They are written against the finished lab, so a few of their
links and metric names — the USE dashboard, the Postgres and Redis counters, the burn-rate
alerts — do not arrive until Chapters 20 to 23. The six headings are what to read them
for. Open `SnipTargetDown.md` and notice what it is not.

It is not a decision tree. There is no "if X then go to step 4". Rob Ewaschuk's "My
Philosophy on Alerting" — the 2013 document the SRE alerting literature grew out of — says
a runbook should contain a brief explanation of what the alert means and the current
context, and should not be an exhaustive troubleshooting flowchart. The reason is not
aesthetic. A flowchart encodes topology, and topology changes: every deploy invalidates a
branch of it, and nobody re-reads one in a quarter where nothing broke. Six months later
it is confidently wrong, which is worse than absent, because the person reading it at
03:20 is following it *instead of thinking*.

What does not rot is six headings, in this order:

1. **What it means.** One paragraph, in user terms — and, the part people skip, what it
   does *not* mean. `SnipTargetDown` firing does not mean Snip is down for users: with two
   replicas behind `edge`, one dead instance is invisible from outside.
2. **Who is affected.** With a query you can paste, so the answer is a number.
3. **First step.** The same one as the annotation. If they disagree, one is stale.
4. **The four causes, in the order they actually happen.** The four you have really seen,
   most frequent first. A list rather than a tree, so it can be reordered as reality
   changes.
5. **Mitigation.** Roll back, restart, scale — in order of speed. Diagnose afterward.
6. **Escalate when.** A condition, not a person's mood. "All instances are down and a
   restart does not hold for two minutes."

Then a short `Related` list: the dashboard, and the alerts somebody arriving here will
confuse this one with. If the page runs past one screen the alert is wrong, not the
runbook.

The inverse is the useful test: **a missing runbook is a bug against the alert.** If nobody
can write those six headings, nobody knows what the alert means. Exercise 4 asks you to
write one.

## Prometheus cannot page you about Prometheus

Everything so far assumes the page arrives. Consider the ways it does not. One rule starts
erroring, and Prometheus skips it and carries on with the rest of its group. Prometheus
evaluates fine but cannot reach Alertmanager. Alertmanager receives the alert and fails to
deliver the webhook. Prometheus is not running. In every one of those cases your alerting
system's output is *silence*, the same signal it sends when everything is fine.

!!! jargon "Meta-monitoring"
    Monitoring the monitoring system: alerts whose subject is Prometheus, Alertmanager
    and the delivery path between them, rather than the service you are paid to keep up.
    It is the one category where "who watches this one?" has no satisfying answer, which
    is why the last of them works by a different trick.

The first requirement is data. Prometheus has scraped itself since Chapter 1, but
Alertmanager and the pager are not scraped at all. Chapter 12, "`prometheus.yml` in Full:
Service Discovery and Relabeling", gave every job the same seven relabel rules; two new
jobs are those seven again with one string changed. Add both to
`lab/prometheus/prometheus.yml`:

```yaml
  # ── ch19 ────────────────────────────────────────────────────
  # Alertmanager cannot tell you that it is broken. This job is how
  # AlertmanagerNotificationFailures gets its numbers.
  - job_name: alertmanager
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        refresh_interval: 15s
    relabel_configs:
      - source_labels: [__meta_docker_container_label_obslab_scrape]
        regex: "true"
        action: keep
      - source_labels:
          - __meta_docker_container_label_com_docker_compose_service
        regex: alertmanager
        action: keep
```

The remaining five rules — address, metrics path, `instance`, the `job` override and the
`env` label — are identical to every other job in the file; copy them from the job above.
Then do it once more with `pager` in place of `alertmanager`, and give the pager job the
same `python_gc_.*` drop in `metric_relabel_configs` that `catalog` has, because the pager
is Python too. Reload and check:

```promql
up{job=~"alertmanager|pager"}
```

Two series, both `1` — but give it half a minute first. `refresh_interval: 15s` means
Docker service discovery has not noticed the new jobs yet, and an undiscovered target has
no `up` series at all, so an empty result means "too soon" rather than "wrong". Once they
appear you are scraping the thing that decides who hears about problems.

### The four meta-alerts

Create `lab/prometheus/rules/meta-alerts.yml`. Four rules go in now; the fifth and most
interesting follows.

The first watches the rule engine, and settles the IOU Chapter 15, "Recording Rules",
left on `prometheus_rule_evaluation_failures_total`:

```yaml
      - alert: PrometheusRuleEvaluationFailures
        expr: |
          rate(prometheus_rule_evaluation_failures_total{
            job="prometheus"}[5m]) > 0
        for: 5m
        labels:
          severity: ticket
          service: monitoring
```

The damage is per rule, not per group: Prometheus marks the broken rule unhealthy, counts
it here, and goes on evaluating its neighbours. So the series or alert that one rule owned
stops existing while everything around it looks healthy — quietly, forever, and
indistinguishable from a rule with nothing to say. The `description` names
`{{ $labels.rule_group }}`, because the counter carries that label and the rules page
prints the error beside the failing rule.

The second watches the wire between Prometheus and Alertmanager:

```yaml
      - alert: PrometheusNotificationsFailed
        expr: |
          rate(prometheus_notifications_errors_total{
            job="prometheus"}[5m]) > 0
        for: 5m
        labels:
          severity: page
          service: monitoring
```

Read that one twice. If it is true, the notification telling you about it cannot be
delivered either. It is `severity: page` anyway, because the failure is sometimes partial
and the page gets through. The counter carries an `alertmanager` label, so the description
can say *which* one.

The third is the sweep-up for targets:

```yaml
      - alert: PrometheusTargetScrapesFailing
        expr: count by (job) (up == 0) > 0
        for: 10m
        labels:
          severity: ticket
          service: monitoring
```

`SnipTargetDown` pages after two minutes for the two jobs you own. This one waits ten and
covers everything else at ticket severity, because an exporter unreachable for ten minutes
is a working day's problem. It is also the only rule here that cannot go stale when a
metric is renamed, because `up` comes from Prometheus itself.

The fourth watches delivery from Alertmanager outward:

```yaml
      - alert: AlertmanagerNotificationFailures
        expr: |
          rate(alertmanager_notifications_failed_total{
            job="alertmanager"}[5m]) > 0
        for: 10m
        labels:
          severity: page
          service: monitoring
```

This is the nastiest failure in the set, and its `first_step` says why: when delivery
fails, alerts still show as firing in the Alertmanager UI. It looks busy and correct;
nothing has reached a human.

One caveat covers the whole file. Prometheus's documentation lists the metrics on its own
`/metrics` endpoint as explicitly *not* covered by its API stability guarantees, and
Alertmanager publishes no stability contract for its own metrics either — the
`alertmanager_marked_alerts` removal later in this chapter is what that looks like in
practice. Any name here can go at a minor upgrade, which is part of why `count by (job)
(up == 0)` is in the set.

Reload. All four appear on `http://localhost:9090/rules` under a new group, `inactive`
with `health: ok` — and none of them can help you if Prometheus is not running.

## The Watchdog

Every alert so far follows one pattern: something becomes true, and a message is sent.
That pattern cannot detect its own absence. Invert it. Write an alert that is *always*
true, send it every minute forever, and point it at a receiver whose job is to notice when
the messages stop. The failure mode flips from silent to loud, because the absence of a
heartbeat is a thing a program can see.

!!! jargon "Dead man's switch"
    Borrowed from trains: a control the operator must keep pressed, so that releasing it
    — because the operator has collapsed — applies the brakes. In alerting the operator
    is your whole pipeline and the switch is a heartbeat. Everything else alarms on a
    signal arriving; this one on a signal stopping.

Add the fifth rule to `meta-alerts.yml`:

```yaml
      - alert: Watchdog
        expr: vector(1)
        labels:
          severity: none
          service: monitoring
        annotations:
          summary: >-
            This alert always fires. Its absence is the signal.
          description: >-
            The Watchdog proves that scraping, rule evaluation,
            alert delivery and the receiver are all working end to
            end. The pager turns red when it has not seen one for
            three minutes.
          first_step: >-
            If you are reading this because the pager went red,
            start with the Prometheus container, not with the
            alert.
          dashboard_url: >-
            http://localhost:3000/d/obslab-meta?from=now-6h&to=now
          runbook_url: https://runbooks.example.com/obslab/watchdog
```

Three things about that rule are unlike anything else in the book. No threshold:
`vector(1)` is Chapter 9's scalar-to-vector function, returning one element valued 1 with
**no labels at all**. No `for`, because a debounce on an alert meant to fire forever would
only delay the first heartbeat. And `severity: none` is the routing key that keeps this
out of the human queues.

!!! iou "IOU — chapter 25"
    That `dashboard_url` points at `obslab-meta`, a dashboard that does not exist yet, so
    Grafana answers `{"message":"Dashboard not found"}`. Chapter 25, "Storage, Retention,
    Backups and Locking the Door", builds it. Write the link now: an alert whose link
    404s is a to-do you cannot forget; one with no link is never noticed as missing.

Now route it. In `lab/alertmanager/alertmanager.yml`, add a first child route — first
because it is the most specific and the tree is first-match-wins — and its receiver:

```yaml
    - matchers:
        - 'alertname = "Watchdog"'
      receiver: deadman
      group_wait: 0s
      group_interval: 1m
      repeat_interval: 30s
```

```yaml
  - name: deadman
    webhook_configs:
      - url: http://pager:5001/deadman
        send_resolved: false
```

`group_wait: 0s` because there is no companion alert to wait for. `group_interval: 1m`
sets how often this group may flush at all, and a heartbeat a minute is inside the pager's
three-minute patience. `send_resolved: false` because a resolved notification for
`vector(1)` would say that one equals one is no longer true.

And `repeat_interval: 30s`, which looks like a mistake and is not. A repeat is only
*considered* on a `group_interval` tick, and Alertmanager stamps its notification log a
moment **after** the tick that sent — so `repeat_interval: 1m` against a `group_interval`
of `1m` finds the last heartbeat a fraction under a minute old on every tick, declines,
and waits for the next: you asked for one a minute and you get one every two. An earlier
build of this lab, paired that way, produced 180 heartbeats in six hours rather than 360.
A repeat shorter than the tick makes every tick qualify, which is what ships here.

The endpoint is `/deadman`, not `/webhook`: the pager updates a clock and stays out of the
notification list, because sixty heartbeats an hour would bury every real notification.

Reload both. Prometheus takes `make reload`; Alertmanager has its own endpoint:

```bash
make check
make reload
curl -s -XPOST http://localhost:9093/-/reload
```

Within a minute or two the header turns green:

```text
Pipeline alive — last heartbeat 34 s ago
The Watchdog alert always fires, so a heartbeat here proves rule
evaluation and notification delivery are both working end to end.
```

Give it ten minutes and check the rate, a number you subtract from every volume figure
for the rest of the chapter:

```promql
rate(pager_notifications_received_total{
  receiver="deadman"}[10m]) * 60
```

One series, reading close to `1` — one heartbeat per minute.

The Watchdog is also the one alert reliably there to read, so this is where the
`generatorURL` gets settled. Ask Alertmanager for its host part:

```bash
curl -s http://localhost:9093/api/v2/alerts \
  | jq -r '.[] | select(.labels.alertname=="Watchdog")
           | .generatorURL' \
  | cut -d/ -f3
```

```text
a3f19c0b7e42:9090
```

That is the Prometheus container's ID, which your browser cannot resolve: a server guesses
its own address from its hostname unless you set `--web.external-url`, the flag Chapter 17
put on `alertmanager` and the lab leaves off Prometheus on purpose. Even fixed, a
generator URL takes you to an expression, not a diagnosis.

!!! trap "The annotation that renders to nothing"
    The Watchdog is always firing, which makes it the place to see the worst annotation
    bug there is. Add a label reference to its `summary` that cannot resolve — `vector(1)`
    has no labels, remember:

    ```yaml
          summary: >-
            This alert always fires on {{ $labels.instance }}.
    ```

    Reload, then read the *rendered* annotation from the alerts API:

    ```bash
    curl -s http://localhost:9090/api/v1/alerts \
      | jq -r '.data.alerts[]
               | select(.labels.alertname=="Watchdog")
               | .annotations.summary'
    ```

    ```text
    This alert always fires on <no value>.
    ```

    No error, no warning, no entry in any log. Go's templating renders a missing map key
    as `<no value>`, and will keep doing it at 03:14 for as long as the rule lives.
    `make verify-ch19` checks every firing alert for it — the only reason anybody would
    find it — and reports `FAIL no firing alert renders an annotation to <no value>`
    until you put the summary back to:

    ```yaml
          summary: >-
            This alert always fires. Its absence is the signal.
    ```

### Make it go red

Now the part the chapter exists for. Stop Prometheus:

```bash
docker compose stop prometheus
```

Then watch `http://localhost:5001/` — it refreshes every five seconds — and be patient,
because the delay is longer than you expect and the reason is the lesson. Eventually the
page turns red:

```text
WATCHDOG MISSING — no heartbeat for 183 s
Nothing has reached POST /deadman for more than 180 s. The
alerting pipeline is not delivering: Prometheus, its rules, or
Alertmanager. Absence is the signal.
```

Three clocks had to run out, and the first is not the one you would guess. Alertmanager
does not know Prometheus has died; it knows only that it holds an alert with an end time,
because Prometheus stamps every alert with an `endsAt` minutes in the future so that one
missed evaluation does not resolve everything. Read it before it expires:

```bash
curl -s http://localhost:9093/api/v2/alerts \
  | jq -r '.[] | select(.labels.alertname=="Watchdog")
           | "\(.startsAt)  \(.endsAt)"'
```

Until that `endsAt`, Alertmanager keeps re-notifying every `repeat_interval`, so the
heartbeats continue after Prometheus is already gone. Only then do they stop, and only
then does the pager's own 180-second timer start counting toward red.

That sum — Alertmanager's held-alert lifetime, plus one gap between heartbeats, plus the
receiver's patience — is the number to state when somebody asks how quickly you would know
your monitoring had failed. In a real installation the third clock lives in a hosted
heartbeat service such as Dead Man's Snitch. The point is not that it is fast but that it
is *finite*, which is an infinite improvement on silence.

Bring it back with `docker compose start prometheus`. Green within a minute.

## Auditing your own noise

You now have a page worth reading and a pipeline that admits when it dies. The hardest
question is left: are these alerts worth having at all? It has a number attached, and the
number is *notifications delivered* — not alerts written, not rules loaded, not even
alerts fired. A rule that fires once and notifies forty times because of `repeat_interval`
is a forty-notification problem; one that fires constantly and is inhibited is a
zero-notification problem. Only one of the two keeps anybody awake.

!!! note "A lab that has been up one afternoon has nothing to audit"
    A genuine noise audit reads weeks; yours has run since lunchtime. The lab ships a
    script that manufactures a history — real alerts, really posted to Alertmanager,
    really routed, grouped and delivered. Nothing about the notifications is faked; only
    their cause is.

Start it and keep reading:

```bash
./scripts/scenario-noise-history.sh
```

It posts waves of synthetic alerts to `POST /api/v2/alerts` — Chapter 17's technique —
until Alertmanager's own counter says it has driven about forty notifications through the
real route tree, then resolves everything it sent, including on Ctrl-C. The notification
history stays. That is the point.

### The wrong source, and why it is tempting

Chapter 16 pointed you here and said the audit would run on the `ALERTS` series. It half
does, and the half that fails is the important half, so settling that IOU means showing
the failure:

```promql
sum by (alertname) (count_over_time(ALERTS{alertstate="firing"}[6h]))
```

`ALERTS` is a synthetic series Prometheus writes for every active alert at every
evaluation, so counting its samples looks exactly like a noise audit. On a stack where the
Watchdog has been firing for six hours, it returns one row:

```text
{alertname="Watchdog"}   720
```

Yours has been firing only as long as you have been reading, so your count — and every
count in this section — is proportionally smaller. Two failures are visible in that line.

The first is what is *there*. The noisiest alert in your system, by this measure, is the
one alert in it that is not an alert. `ALERTS` counts evaluations, and the meta-alerts
group runs every thirty seconds, so six hours is 720 samples by construction.

The second is what is *missing*, and it is worse. Every notification the script drove
through Alertmanager is absent, because it posted straight to Alertmanager and Prometheus
never wrote an `ALERTS` series for any of it. So is anything that fired and stopped before
your window began: when an alert stops firing its series does not go to zero, it goes
**stale**, and `count_over_time` counts the samples that exist and reports a smaller
number with complete confidence.

Underneath both is the structural reason. `ALERTS` records what Prometheus *decided*, and
everything that determines whether a human was disturbed happens afterward in
Alertmanager: grouping, inhibition, silences, `continue: true` and `repeat_interval` each
multiply or erase what Prometheus decided. Auditing `ALERTS` for noise is auditing the
kitchen to find out what the customers ate.

### The right source

Ask the program that sends the notifications:

```promql
sum by (integration) (increase(alertmanager_notifications_total[6h]))
```

The window is a literal `[6h]`, not the dashboard's time picker: an audit has to cover the
same span every time, or this month cannot be compared with last.

Eighteen rows come back. Seventeen are zero — Alertmanager registers every integration it
ships, configured or not — and the only non-zero one is `{integration="webhook"}`, honest
and not yet useful. Every receiver here is a webhook, so `integration` cannot separate
them; there *is* a `receiver_name` dimension on this counter in Alertmanager 0.33.1, but
it is behind `--enable-feature=receiver-name-in-metrics`, which this lab does not set. And
the number is mostly heartbeat: one a minute for six hours is about 360 notifications
before a single real alert, far more than the forty the script produced. Any volume figure
that ignores your dead man's switch is nonsense.

The pager can separate them, because it records the receiver name out of each payload.
Subtract the heartbeat in the question, not afterward:

```promql
sum by (receiver) (increase(pager_notifications_received_total{
  receiver!="deadman"}[6h]))
```

`pager-ticket` reads higher than `pager-page` even though fewer alerts are tickets,
because `continue: true` sends every page to the ticket queue as well — Chapter 17's
wiring, measured rather than trusted.

Now ask the same two series for their raw values:

```promql
sum by (receiver) (pager_notifications_received_total{
  receiver!="deadman"})
```

The raw numbers read materially higher — not a rounding difference — and nothing was lost
in between. Both receiver series were *born* at the script's first wave, inside the
window, so `increase()` takes each one's first sample as its baseline and everything that
sample had already counted drops out; Alertmanager's `webhook` series has existed since
the stack started, so it loses nothing. The habit: when you compare a sender against a
receiver to find lost notifications, compare raw counters, or series older than the
window.

### Which alert, though

Neither counter carries `alertname`. For the breakdown, ask the receiver:

```bash
curl -s http://localhost:5001/api/notifications \
  | jq -r '.notifications[].payload.groupLabels.alertname' \
  | sort | uniq -c | sort -rn
```

The counts add up to the receiver figures — the same deliveries, now with names on them.
The list includes resolved notifications and counts every page twice, once per receiver,
so each quiet alert appears three times per receiver: opened, `repeat_interval`, resolved.

The shape is the finding. Three groups grow — the script adds an instance to
`SnipTargetDown` and `PrometheusTargetScrapesFailing` on every wave, and to
`SnipHighErrorRatio` on every third — and those three carry most of the volume while the
rest sit at the bottom with the same small count each. The top two are the mechanism in
one comparison: they grow at the same rate, and a group flushes at most once per
`group_interval` however many alerts join it, so `SnipTargetDown` leads only because it is
a page and `continue: true` delivers every page to two receivers where a ticket reaches
one. Growth rate is half of what makes an alert loud; routing is the other half. And the
shape is the most reliable result in alert auditing: **the few alerts at the top are most
of the problem.** Fix or delete those and the pager becomes usable; tune the tail and
nothing changes.

!!! note "The metric that is not there"
    Chasing this, you will find a dashboard or a blog post using
    `alertmanager_marked_alerts`. It was **removed in Alertmanager 0.33.0**. A panel built
    on it shows "No data" with no error anywhere, which reads exactly like a working panel
    on a quiet system. The replacement is `alertmanager_alerts`, which carries a `state`
    label: `sum by (state) (alertmanager_alerts)`. Both forms sit side by side in
    `lab/fixtures/stale-queries/03-marked-alerts.promql`.

### Defend it or delete it

For every alert on that list, three questions, in order:

1. **Did a human do something?** Not "could have" — did. If no, it is not an alert.
2. **Would a user have noticed if nobody had?** If not, it is at most a ticket.
3. **Was it right?** Count the times it fired against the times something was genuinely
   wrong. Ewaschuk's line is blunt and worth memorizing: *"Alerts that are less than 50%
   accurate are broken."* Not sensitive. Broken.

Run `SnipTargetDown` through them, since it tops the list and Chapter 16 left it here on
purpose. Did a human do something? Yes — somebody looks at the container. Would a user
have noticed? With two replicas behind `edge`, no. Was it right? Every time; `up == 0`
does not lie. Two yes and one no, and the no is on the question that decides whether
anybody gets woken. The severity it deserves is `ticket`. The lab keeps it at `page`
because the rest of the book needs one fast, binary page to route, group, silence and
test — a teaching decision, not an operational one, and the argument you should expect to
have about half your own paging rules.

Then exactly one verdict per alert, recorded in `lab/docs/ALERT-REVIEW.md`: **keep**,
**downgrade** (`page` to `ticket`), **retune** (say the new threshold and why), or
**delete**. "Leave it, we will look next month" is not a verdict, and "we might need it
one day" is a delete — the rule is in git. An alert that has fired forty times and been
acted on twice trains the team to ignore the channel that also carries the real ones.

## What good looks like, in numbers

Whether your on-call is reasonable is not a matter of taste. From Google's SRE practice,
worth quoting because it is one of the few hard numbers in this subject: *"The maximum
number of incidents per day is 2 per 12-hour on-call shift."* The distribution should be
very flat, and the median number of incidents per day should be **zero**.

That ceiling is arithmetic, not ideology. An incident costs roughly six hours once you
count diagnosis, remediation, the write-up and the follow-up fix, so two incidents is one
whole shift. Above two, the on-call engineer is being consumed by incidents, and the
follow-up work that would stop the next one never happens. And: **if an alert has no lead
time and no user impact, it is a dashboard panel, not a page.**

Measure yourself. Your lab's paging volume over six hours, as a twelve-hour shift:

```promql
sum(increase(pager_notifications_received_total{
  receiver="pager-page"}[6h])) * 2
```

Whatever that reads, it is far above a ceiling of two — and the raw counter, for the
reason the last section gave, reads higher still. On a stack older than the window the two
converge; on this one, quote the raw figure. The answer will be embarrassing, because you
spent four minutes manufacturing noise on purpose. That is the correct reaction, and the
one the number is supposed to produce on a real system.

The review that acts on all this is thirty minutes, monthly, in the same slot, with
numbers rather than opinions; `lab/docs/ALERT-REVIEW.md` is both procedure and log, and
you never edit an old row.

!!! selfcheck "Self-check"
    Run `make verify-ch19`. It must print `ch19 OK` after 19 passing assertions. The
    indented lines come from `note`, not from an assertion: `9 alerting rules loaded` is
    fixed at this chapter — four rules in `snip-alerts.yml`, five in `meta-alerts.yml` —
    and the last carries your own stack's count, dominated by the heartbeat:

    ```text
    == verify-ch19 ==
       expected runtime: about 20 s

    PASS alerting rules are loaded
         9 alerting rules loaded
    PASS every alerting rule has five annotations (Watchdog aside)
    PASS no annotation is an empty string
    PASS every rule links a runbook
    PASS every rule links somewhere you can look
    PASS no firing alert renders an annotation to <no value>
    PASS docs/runbooks/SnipHighErrorRatio.md exists
    PASS docs/runbooks/SnipTargetDown.md exists
    PASS docs/runbooks/SnipLatencyObjectiveAtRisk.md exists
    PASS docs/runbooks/SnipSLIAbsent.md exists
    PASS PrometheusRuleEvaluationFailures is loaded
    PASS PrometheusNotificationsFailed is loaded
    PASS PrometheusTargetScrapesFailing is loaded
    PASS AlertmanagerNotificationFailures is loaded
    PASS Watchdog is loaded
    PASS Watchdog is firing
         if the Watchdog stops arriving, the pager goes red after
         three minutes. That is the only alert whose silence is
         the emergency.
    PASS the alertmanager job is up
    PASS the pager job is up
         alertmanager_notifications_total = <your stack's count>
    PASS there is notification history to audit

    ch19: 19 passed, 0 failed
    ch19 OK
    ```

    Before you run `scenario-noise-history.sh` the last line is a `SKIP`, the summary
    reads `18 passed, 0 failed, 1 skipped`, and the script names the command to run. The
    Watchdog is the one rule exempt from the five-annotation check.

## Common mistakes

**Writing `severity: critical` and never adding a route for it.** The symptom is an alert
that is definitely firing, definitely visible in the Alertmanager UI, and reaches whoever
owns the root receiver — often nobody. Grep your rules for every distinct `severity` value
and check each against the route tree. Seven values means somebody is describing feelings.

**Auditing noise with the `ALERTS` series.** It counts decisions, not deliveries, it goes
stale rather than to zero, and it cannot see anything that reached Alertmanager by another
path.

**An annotation that renders to `<no value>`.** Two ways in: a copied rule
(`{{ $labels.pod }}` in a lab with no pods), and an aggregation that dropped the label you
were about to print — `sum by (job)` throws away `route`, and `{{ $labels.route }}` is
then empty. Both look perfect in the rule file, and only a firing alert shows the damage.

**A dashboard link with no time range.** It opens on "now", which is the one window you
already know about, so put `from` and `to` in the URL and choose them per alert.

**Treating the Watchdog as noise.** It is the largest single source of notifications in
the lab and it will be in yours too. The mistake is not that it is loud — it is routing it
anywhere a human reads, or leaving it out of a volume metric and then forgetting it
exists.

## Summary

An alert is a piece of writing with a deadline. It has ninety seconds and one phone screen
to tell a half-conscious person what broke, who it hurts, where to look and what to do.
Underneath it sits a colder fact: the alerting system is a service with users, and it can
fail in the one way no ordinary alert can detect — by going quiet.

The durable takeaways:

- `severity` is an input to a routing decision and nothing else. Three values, three
  routes, one-to-one, and a sentence for what a human does differently at each.
- Five annotations on every rule: what broke in user terms, who is affected with a number,
  the single first thing to check, a dashboard link with the range pre-set, and a runbook
  link derived mechanically from the alert name.
- A runbook is a brief explanation and current context, not a troubleshooting flowchart.
  A missing runbook is a bug against the alert.
- Prometheus cannot page you about Prometheus. Scrape Alertmanager and the receiver, and
  alert on the rule engine and both delivery hops.
- The dead man's switch is the only one that works when everything else is broken:
  `expr: vector(1)`, `severity: none`, routed somewhere that alarms when it *stops*
  arriving. Know how long it takes to notice.
- Audit notifications, never `ALERTS`, with the heartbeat subtracted and raw counters
  whenever a series is younger than the window. The few alerts at the top are most of
  the problem.
- Fewer than two paging events per 12-hour shift; a median of zero incidents per day; a
  rule under 50 percent accurate is broken rather than sensitive. One verdict per alert at
  the monthly review, and one of the four is delete.

## Exercises

!!! exercise
    **1. Your worst annotation, graded (warm-up).** Chapter 16 exercise 4
    asked you to rewrite `SnipLatencyObjectiveAtRisk`'s `description`. Put
    it beside the five-field template and score it out of five, then
    finish it, reload, and confirm `make verify-ch19` still prints `ch19
    OK`. If your rewrite lost a field, the script names the rule and the
    count it found.

    **2. Kill the other half (core).** Run `docker compose stop
    alertmanager` and leave it down for fifteen minutes. Which meta-alert
    catches it, which does not, and why? Write down what each of the four
    rules is looking at, then check yourself against
    `http://localhost:9090/alerts` — paying attention to where the
    *notification* about the failure would travel. Then `docker compose
    start alertmanager`.

    **3. The noise audit (core).** Run
    `./scripts/scenario-noise-history.sh`, then the audit query, the
    per-receiver breakdown and the alert-name count from the pager API.
    Which alert produced the most notifications? Write two sentences
    defending it or deleting it, and record the verdict as a row in
    `lab/docs/ALERT-REVIEW.md`. A verdict without a reason does not count.

    **4. A runbook that fits (core).** Write
    `docs/runbooks/SnipHighErrorRatio.mine.md` in your own words without
    opening the one that ships beside it. One screen, six headings, no
    flowchart, causes as an ordered list. Then `diff` the two files — the
    interesting difference is not what you missed but what you included
    that will rot.

    **5. A taxonomy you can defend (core).** Write down three severity
    levels, the route each maps to, and the response time each promises.
    Then find one rule in `snip-alerts.yml` or `meta-alerts.yml` whose
    severity you disagree with, change it, reload, hand-POST an alert
    with the new label set, and confirm from the pager that it reached a
    different receiver. Revert.

    **6. Your paging rate (stretch).** Compute paging notifications per
    simulated 12-hour shift from
    `pager_notifications_received_total{receiver="pager-page"}` and
    compare it with Google's fewer-than-two. Then recompute with
    `status="firing"` added to the selector, which drops every resolved
    notification, and say which of the two you would put in front of a
    manager. Saying which one you mean is most of what makes an on-call
    metric honest.
