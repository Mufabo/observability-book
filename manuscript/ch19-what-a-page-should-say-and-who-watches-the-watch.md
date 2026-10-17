# Chapter 19 — What a Page Should Say, and Who Watches the Watcher

It is 03:14. Your phone lights the ceiling. You unlock it with one eye shut and read
this, which is exactly what Chapter 16, "Alerting Rules, and What 'Firing' Actually
Means", told Alertmanager to send:

```text
[FIRING x1] SnipTargetDown (snip)
Snip replica snip-api-2 has stopped answering scrapes.
Prometheus has not reached snip-api-2 in job snip-api for two
minutes. Every request that replica would have served is now on
the others, or on nobody.
```

Now what? You have a service name and a container name. You do not know whether anybody
is affected, because two other replicas may be absorbing the traffic without a hiccup.
You do not know where to look, so you will open a laptop, find Grafana, guess a time
range, and lose four minutes before you have seen a single number. You do not know
whether this has happened before or what the person who wrote the rule expected you to
do about it. The rule is correct. The page is nearly useless.

That is the first half of this chapter: an alert is a message from you, awake and
thinking clearly, to you, asleep and thinking not at all. It has about ninety seconds to
be useful. The second half is the question nobody asks until the morning after: what if
the phone had never buzzed at all? Prometheus cannot page you about Prometheus. A rule
engine that has stopped evaluating rules is, from the outside, indistinguishable from a
system where nothing is wrong — and it is *quieter*, which is worse, because quiet is
what you have trained yourself to read as good.

!!! objectives "Objectives"
    After this chapter you can:

    - Define a severity taxonomy that maps one-to-one onto Alertmanager routes,
      rather than one that decorates labels and changes nothing.
    - Write an annotation that makes a 3 a.m. page actionable in ninety seconds.
    - Say what a runbook is for, and why a troubleshooting flowchart is the wrong
      artifact.
    - Monitor the monitoring system, and route a dead man's switch to something that
      screams when it stops arriving.
    - Audit your own alert noise from Alertmanager's own metrics, and defend or delete
      every alert.
    - Quote a quantitative standard for what an acceptable on-call load looks like.

## Getting the lab into position

This chapter builds on Chapter 17, "Alertmanager: Routing, Grouping and Silence", and
Chapter 18, "Testing Alerts Before They Page You". You need Alertmanager, the pager and
a rule file with alerts in it. The `ch19` tag already holds everything this chapter
builds — the five-field annotations, the two new scrape jobs, `meta-alerts.yml`, the
Watchdog and its `deadman` route — to read along with. To build them yourself, check out
`ch18` instead; the steps in this chapter start there.

```bash
cd lab
git checkout ch19
make check
make up
make ps
```

Put the load generator into a known, boring state, so nothing fires while you are
reading:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","error_ratio":0}'
```

Open the pager at `http://localhost:5001/`. On `ch18` the header is gray and says:

```text
No heartbeat yet
Waiting for the first POST /deadman. The Watchdog alert and the
deadman receiver are wired up in chapter 19.
```

That gray bar is this chapter's second half, waiting for you. On `ch19` it is already
green, which is where the chapter ends. As in Chapter 16, "reload"
below always means `make check` followed by `make reload`, and a rule file that does not
parse is rejected as a unit while the old rules keep running.

## Severity is a route, not an adjective

Every rule you wrote in Chapter 16 carries a `severity` label. It is tempting to read
that label as a description of how bad the situation is — `critical` is worse than
`warning`, which is worse than `info` — and to add whichever word feels right on the day.

A `severity` label describes nothing. It is an input to a routing decision, and it means
exactly what your Alertmanager route tree says it means. Nothing else in either program
reads it. If your tree has no route matching `severity="warning"`, then writing
`severity: warning` does not make an alert less urgent; it makes it go somewhere you were
not thinking about.

You can prove that in twenty seconds, using Chapter 17's technique of posting an alert by
hand rather than waiting for one:

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

Wait fifteen seconds for `group_wait`, then reload the pager UI.

!!! trap "The severity that routes nowhere"
    The alert arrives. It does not vanish, and it is not held back. It is delivered —
    to the receiver at the top of the tree, the one that exists only because the root
    route is required to match everything:

    ```text
    #14 · receiver pager-default · 03:19:07
    Grouped by alertname="SnipCacheColdish" service="snip"
    ```

    On this lab, `pager-default` writes to the same page you are looking at, so you
    notice. In a real installation the root receiver is usually a channel somebody set
    up during the first week and nobody has read since. A `severity` value with no
    matching route is not a quieter page. It is a page that goes to the drawer.

The alert carries no `endsAt`, which is the one case where Alertmanager's
`resolve_timeout: 5m` applies, so it clears itself in five minutes. Leave it.

The fix is not a better vocabulary. It is a shorter one. Pick the smallest set of
severities that produces *genuinely different human behavior*, and give each one a route.
This lab uses three, and `LAB-SPEC` fixes them as the only legal values:

| `severity` | Route sends it to | What a human does |
|---|---|---|
| `page` | `pager-page`, and `pager-ticket` as a record | Wakes up. Minutes, not hours. |
| `ticket` | `pager-ticket` | Sees it next working day. |
| `none` | `deadman`, or the `null` receiver | Nothing. It is machinery. |

Three levels, three routes, one-to-one. Read the route tree in
`lab/alertmanager/alertmanager.yml` again with that table beside it and the tree stops
being configuration and starts being policy: `page` means somebody's sleep is worth less
than this problem, and you are saying so in YAML.

Two consequences follow, and both are worth stating out loud because they are the ones
teams argue about. First, adding a fourth severity costs a route, a receiver and a
sentence in the table defining what a human does differently — if you cannot write that
sentence, you do not need the severity. Second, downgrading an alert from `page` to
`ticket` is a one-word edit that changes who is woken and nothing else. That is the
cheapest and most under-used intervention in alerting, and the audit at the end of this
chapter exists to find candidates for it.

## The five fields a page has to carry

Look again at what arrived at 03:14. Chapter 16 gave every rule two annotations,
`summary` and `description`, and said a good annotation answers three questions: what is
broken, who it hurts, and what to look at first. That was right and it was not enough,
because two of those answers were doing three jobs and the links were missing entirely.

Here is the template this lab uses, and the one `make verify-ch19` enforces. Five
annotation keys, in this order, on every alerting rule you write:

| Annotation | The question it answers |
|---|---|
| `summary` | What is broken, in words a user would use. One line. |
| `description` | Who is affected and how many, with the number in it. |
| `first_step` | The single first thing to look at. Not a procedure. |
| `dashboard_url` | Somewhere to look, with the time range already set. |
| `runbook_url` | One page, about this alert, written before the incident. |

Five is not a magic number. It is the number of things you can read on a phone screen
before you have decided whether to get out of bed, and each one exists because a page
that lacks it costs measurable minutes.

`summary` is the line that shows on the lock screen, so it must not contain a metric
name. "Snip replica snip-api-2 has stopped answering scrapes" is about scraping;
"snip-api-2 is not serving" is about serving. Prefer the second when the alert really
means the second.

`description` is where the number goes, and where you say who is hurt. This is the field
that stops a page being an interruption and starts it being information. Chapter 16
taught the templating: `{{ $labels.x }}` for a label on the alert, `{{ $value }}` for the
sample value, and the `humanize` family to make that value readable. `$value` raw is a
float with fifteen digits.

`first_step` is the field almost nobody writes, and the one that saves the most time. It
is deliberately singular. Not "investigate the database" — *the one thing to look at
before anything else*, chosen because it splits the possibilities in half. For a bad
error ratio, that is "split by instance, because one bad replica and a bad deploy look
identical on the aggregate panel and want opposite responses." For a target that has
stopped answering, it is "run `make ps` and look at that container: is it restarting, or
is it gone?"

`dashboard_url` and `runbook_url` are the two links. They deserve their own paragraph,
because getting them wrong is the most common way a five-field annotation becomes a
five-field annotation that still does not help.

### Links you can use half asleep

A dashboard link without a time range is a link to *now*, which is the one moment you
already know about. Every dashboard URL in this lab carries its range in the query
string:

```text
http://localhost:3000/d/snip-red?from=now-6h&to=now
```

Six hours for a slow-moving problem, one hour for an outage — chosen per alert, so that
the panel that opens already contains the thing you were paged about and enough history
to see when it started. Chapter 13, "Dashboard Mechanics: Intervals, Panels and
Variables", is where `from` and `to` came from; this is the payoff.

A runbook link should be derived mechanically from the alert name, not chosen. This lab
uses `https://runbooks.example.com/obslab/` followed by the alert name in lower case, so
`SnipTargetDown` becomes:

```text
https://runbooks.example.com/obslab/sniptargetdown
```

Deriving it means you can never forget one and a linter can check every rule. That
domain does not resolve, because `example.com` is the documentation domain reserved by
RFC 2606 and this lab has no internet; the pages those URLs stand for are the Markdown
files in `lab/docs/runbooks/`.

There is a third link you did not write, and it is worth knowing about because it is the
one people expect to work. Every alert Prometheus sends carries a `generatorURL` — a
deep link back to the expression that fired. Read the one on a live alert:

```bash
curl -s http://localhost:9093/api/v2/alerts \
  | jq -r '.[] | select(.labels.alertname=="Watchdog")
           | .generatorURL'
```

```text
http://a3f19c0b7e42:9090/graph?g0.expr=vector%281%29&g0.tab=1
```

That hostname is the Prometheus container's ID. Your browser cannot resolve it. A server
has no way to know what address *you* reach it on, so it guesses from its own hostname
unless you tell it, and the flag that tells it is `--web.external-url` — the same flag
Chapter 17 put on `alertmanager` so that its own links and its `externalURL` payload
field point at `http://localhost:9093`. The lab leaves Prometheus without one on purpose,
so that you meet this the first time in a chapter rather than at 03:14.

Even fixed, the generator URL takes you to an expression. An expression is not a
diagnosis. That is why the two links you write by hand are the ones that matter.

## Rewriting the file

Open `lab/prometheus/rules/snip-alerts.yml`. It holds the four rules from Chapter 16, and
every one of them gets three new annotation keys. Here is `SnipTargetDown` in full, as
the template wants it:

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

The `>-` is YAML's folded block scalar with the trailing newline stripped: it lets you
wrap an annotation over several lines in the file and get one line of text out. Use it
everywhere; annotations that run past column 80 in a rule file are annotations nobody
proof-reads.

Do the same for the other three. `SnipHighErrorRatio` gets a `first_step` of "split by
instance before you do anything else" and points at the RED dashboard over six hours.
`SnipLatencyObjectiveAtRisk` gains a sentence in its `description` that says what the
number means to a person — "Visitors are waiting for a redirect that should be instant" —
and points its `first_step` at putting the p99 panel next to the database panel.
`SnipSLIAbsent` says to check the targets page for job `snip-api` first, then whether
`loadgen` is still sending traffic.

Reload, and read one back to see the whole thing rendered rather than templated:

```bash
curl -s http://localhost:9090/api/v1/rules \
  | jq -r '.data.groups[].rules[]
           | select(.name=="SnipTargetDown") | .annotations'
```

The values come back with the `{{ }}` still in them, because `/api/v1/rules` shows you
the rule and not an instance of it. Templating happens when an alert becomes active. To
see rendered text you need a firing alert, which is what `/api/v1/alerts` returns — and
that distinction is about to matter.

## What a runbook is for

Every one of those annotations now links a runbook, and all four exist, in
`lab/docs/runbooks/`. Open `SnipTargetDown.md` and notice what it is not.

It is not a decision tree. There is no "if X then go to step 4". Rob Ewaschuk's
"My Philosophy on Alerting" — the 2013 document the entire SRE alerting literature grew
out of — says a runbook should contain a brief explanation of what the alert means and
the current context, and should not be an exhaustive troubleshooting flowchart. The
reason is not aesthetic. A flowchart encodes the system's topology, and the topology
changes. Every deploy, every new dependency, every renamed service invalidates a branch
of it, and nobody re-reads a flowchart in a quarter where nothing broke. Six months later
the flowchart is confidently wrong, which is worse than absent, because the person
following it at 03:20 is following it *instead of thinking*.

What does not rot is the same six things, in the same order:

1. **What it means.** One paragraph, in user terms. And — this is the part people skip —
   what it does *not* mean. `SnipTargetDown` firing does not mean Snip is down for users:
   with two replicas behind `edge`, one dead instance is invisible from outside.
2. **Who is affected.** With a query you can paste, so the answer is a number and not a
   guess.
3. **First step.** The same one as the annotation. If they disagree, one of them is
   stale.
4. **The four causes, in the order they actually happen.** Not every cause. The four you
   have really seen, most frequent first. This is the part that carries the institutional
   memory, and it is a list rather than a tree precisely so it can be reordered as
   reality changes.
5. **Mitigation.** Roll back, restart, scale — in order of speed. Diagnose afterward.
6. **Escalate when.** A condition, not a person's mood. "All instances are down and a
   restart does not hold for two minutes."

One screen. If it needs more than one screen, the alert is wrong rather than the runbook.
And the inverse is the useful test: **a missing runbook is a bug against the alert.** If
nobody can write those six headings, nobody knows what the alert means, and an alert
nobody can explain will not be acted on at 3 a.m. either. Deleting it is the honest move.
Exercise 4 asks you to write one.

## Prometheus cannot page you about Prometheus

Everything so far assumes the page arrives. Consider the ways it does not.

Prometheus stops evaluating a rule group because one rule in it errors. Prometheus
evaluates fine but cannot reach Alertmanager. Alertmanager receives the alert, groups it,
and fails to deliver the webhook. Prometheus itself is not running. In every one of those
cases your alerting system's output is *silence*, and silence is the same signal it sends
when everything is fine.

!!! jargon "Meta-monitoring"
    Monitoring the monitoring system: alerts whose subject is Prometheus, Alertmanager
    and the delivery path between them, rather than the service you are being paid to
    keep up. It is the one category of alert where "who watches this one?" has no
    satisfying answer, which is why the last of them works by a different trick.

The first requirement is data. Prometheus has scraped itself since Chapter 1, so its own
metrics are already in the database. Alertmanager and the pager are not scraped yet.
Chapter 12, "`prometheus.yml` in Full: Service Discovery and Relabeling", gave every job in this file the same seven relabel
rules; two new jobs are those seven rules again with one string changed. Add both to
`lab/prometheus/prometheus.yml`:

```yaml
  # ── ch19 ──────────────────────────────────────────────────────
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

The remaining five rules — address, metrics path, `instance`, the job override and the
`env` label — are identical to every other job in the file; copy them from the one above.
Then do it once more with `pager` in place of `alertmanager`, and give the pager job the
same `python_gc_.*` drop that `catalog` has, because the pager is Python too.

Reload and check:

```promql
up{job=~"alertmanager|pager"}
```

Two series, both `1`. You are now scraping the thing that decides who hears about
problems, and the thing that receives the notifications.

### The four meta-alerts

Create `lab/prometheus/rules/meta-alerts.yml`. Four rules go in it now, and the fifth —
the interesting one — goes in after them.

The first watches the rule engine. Chapter 15, "Recording Rules", introduced
`prometheus_rule_evaluation_failures_total` and promised this chapter would turn it into
an alert; here it is, and that IOU is settled:

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

A rule group that errors produces no recorded series and no alerts, quietly, forever. It
looks exactly like a group with nothing to say. The `description` names
`{{ $labels.rule_group }}`, because the counter carries that label and the rules page
prints the error next to the failing rule.

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
delivered either. It is `severity: page` anyway, because sometimes the failure is partial
and the page gets through; and because a rule that describes a real failure is worth
having even when it cannot always reach you. Note that
`prometheus_notifications_errors_total` carries an `alertmanager` label, one series per
Alertmanager the server sends to, so the description can say *which* Alertmanager.

The third is the sweep-up for targets:

```yaml
      - alert: PrometheusTargetScrapesFailing
        expr: count by (job) (up == 0) > 0
        for: 10m
        labels:
          severity: ticket
          service: monitoring
```

`SnipTargetDown` pages after two minutes for the two jobs you own. This one waits ten
minutes and covers everything else, at ticket severity, because a black-box exporter that
has been unreachable for ten minutes is a working day's problem rather than a night's. It
is also the only rule in the file that cannot go stale when a metric is renamed, because
`up` is generated by Prometheus and not by any exporter.

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

This is the nastiest failure in the set, and its `first_step` says why: alerts still show
as firing in the Alertmanager UI when delivery is failing. The UI looks busy and correct.
Nothing has reached a human. "Open the pager UI: if it is empty while alerts are firing,
the receiver is the problem and not the rules."

!!! note "Self-metrics are outside the stability contract"
    Prometheus's own documentation lists "the metrics in the /metrics endpoint of
    Prometheus itself" as explicitly *not* covered by its API stability guarantees, and
    Alertmanager says the same of its own. A name in this file can disappear at a minor
    upgrade. If one of these alerts silently stops working after an upgrade, that is the
    first thing to check — and it is part of why `count by (job) (up == 0)` is in the set.

Reload. All four rules should appear on `http://localhost:9090/rules` under a new group,
all in state `inactive`, all with `health: ok`. Four alerts about the alerting system,
none of which can help you if Prometheus is not running.

## The Watchdog

Every alert you have written so far follows one pattern: something becomes true, and a
message is sent. That pattern cannot detect its own absence.

Invert it. Write an alert that is *always* true, send it every minute forever, and point
it at a receiver whose job is to notice when the messages stop. The failure mode flips
from silent to loud: a broken pipeline stops producing heartbeats, and the absence of
heartbeats is a thing a program can see.

!!! jargon "Dead man's switch"
    Borrowed from trains. A dead man's switch is a control the operator must keep
    actively pressed; releasing it — because the operator has collapsed — applies the
    brakes. In alerting, the operator is your whole pipeline and the switch is a
    heartbeat. Everything else in this book alarms on a signal arriving. This one alarms
    on a signal stopping.

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

Three things about that rule are unlike anything else in the book. There is no threshold:
`vector(1)` is the scalar-to-vector function from Chapter 9, "Ratios, Arithmetic, and the
Series That Isn't There", and it returns a single element valued 1 with **no labels at
all**. There is no `for`: a debounce on an alert that is meant to fire instantly and
forever would only delay the first heartbeat. And `severity: none` is not modesty — it is
the routing key that keeps this thing out of the human queues.

!!! iou "IOU — chapter 25"
    That `dashboard_url` points at `obslab-meta`, a dashboard that does not exist yet.
    Grafana will answer with "Dashboard not found". Chapter 25, "Storage, Retention,
    Backups and Locking the Door", builds it, and its noise-audit panel is the query at the end of this chapter. Write
    the link now: an alert whose link 404s is a to-do you cannot forget, and an alert
    with no link is one nobody will ever notice is missing.

Now route it. In `lab/alertmanager/alertmanager.yml`, add a first child route — first
because it is the most specific and the tree is first-match-wins — and a receiver:

```yaml
    - matchers:
        - 'alertname = "Watchdog"'
      receiver: deadman
      group_wait: 0s
      group_interval: 1m
      repeat_interval: 1m
```

```yaml
  - name: deadman
    webhook_configs:
      - url: http://pager:5001/deadman
        send_resolved: false
```

The three timers are overridden on this route alone and every one of them is deliberate.
`group_wait: 0s` because there is nothing to wait for a companion alert about.
`repeat_interval: 1m` because the heartbeat *is* the repeat — that is what makes it a
heartbeat rather than a notification. `send_resolved: false` because a resolved
notification for `vector(1)` would be a message saying that one equals one is no longer
true.

The endpoint is `/deadman` and not `/webhook`, and the pager treats it differently: it
updates a clock and is deliberately kept out of the notification list. A heartbeat every
minute would bury every real notification within an hour.

Reload both programs. Prometheus takes `make reload`; Alertmanager has its own endpoint:

```bash
make check
make reload
curl -s -XPOST http://localhost:9093/-/reload
```

Within a minute or two, the pager's header turns green:

```text
Pipeline alive — last heartbeat 34 s ago
The Watchdog alert always fires, so a heartbeat here proves rule
evaluation and notification delivery are both working end to end.
```

!!! trap "The annotation that renders to nothing"
    The Watchdog is the one alert in this lab that is always firing, which makes it the
    perfect place to see the worst annotation bug there is. Add a label reference to its
    `summary` that cannot possibly resolve — `vector(1)` has no labels, remember:

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

    No error. No warning. No entry in the log. Go's templating renders a missing map key
    as the string `<no value>`, and it will keep doing that at 03:14 for as long as the
    rule lives. `make verify-ch19` checks every firing alert for it, which is the only
    reason anybody would ever find it. Put the summary back.

### Make it go red

Now the part the chapter exists for. Stop Prometheus:

```bash
docker compose stop prometheus
```

Then watch `http://localhost:5001/` — it refreshes itself every five seconds — and be
patient, because the delay is longer than you expect and the reason is the whole lesson.
Eventually the page turns red:

```text
WATCHDOG MISSING — no heartbeat for 187 s
Nothing has reached POST /deadman for more than 180 s. The
alerting pipeline is not delivering: Prometheus, its rules, or
Alertmanager. Absence is the signal.
```

Three clocks had to run out for that, and none of them is the one you would guess.
Alertmanager does not know Prometheus has died; it knows only that it holds an alert with
an end time. Prometheus stamps every alert it sends with an `endsAt` several minutes in
the future, precisely so that one missed evaluation does not resolve everything. Read it
yourself, before the alert expires:

```bash
curl -s http://localhost:9093/api/v2/alerts \
  | jq -r '.[] | select(.labels.alertname=="Watchdog")
           | "\(.startsAt)  \(.endsAt)"'
```

Until that `endsAt`, Alertmanager keeps re-notifying every `repeat_interval`, so the
heartbeats continue after Prometheus is already gone. Only then do they stop. Only then
does the pager's own 180-second timer start counting toward red.

That sum — Alertmanager's held-alert lifetime, plus one repeat interval, plus the
receiver's own patience — is the **detection time** of your dead man's switch, and it is
the number to state when somebody asks how quickly you would know your monitoring had
failed. On this lab it is several minutes. In a real installation the third clock lives
in a hosted heartbeat service such as Dead Man's Snitch, which integrates with PagerDuty,
and you set it deliberately.
The point is not that it is fast. The point is that it is *finite*, which is an infinite
improvement on silence.

Bring it back:

```bash
docker compose start prometheus
```

Green within a minute or two.

## Auditing your own noise

You now have a page worth reading and a pipeline that admits when it dies. The remaining
question is the hardest one: are these alerts worth having at all?

That question has a number attached, and the number is *notifications delivered* — not
alerts written, not rules loaded, not even alerts fired. A rule that fires once and
notifies forty times because of `repeat_interval` is a forty-notification problem. A rule
that fires constantly and is inhibited by another is a zero-notification problem. Only
one of those two is keeping anybody awake.

### The wrong source, and why it is tempting

Chapter 16 pointed you here and said the audit would run on the `ALERTS` series. It half
does, and the half that fails is the important half. Settling that IOU properly means
showing you the failure.

`ALERTS` is a synthetic series Prometheus writes for every active alert at every
evaluation. Counting samples of it looks exactly like a noise audit:

```promql
sum by (alertname) (count_over_time(ALERTS{alertstate="firing"}[6h]))
```

Run it. On the stack this chapter was measured on, the Watchdog had been firing for six
hours, and the query returned one row:

```text
{alertname="Watchdog"}   718
```

Yours has been firing only as long as you have been reading, so your count — and every
count in this section — will be proportionally smaller. The shape is what to compare.

Two separate failures are visible in that single line.

The first is what is *there*. The noisiest alert in your system, by this measure, is the
one alert in the system that is not an alert. `ALERTS` counts evaluations, and the
Watchdog is evaluated every thirty seconds forever, so it dominates any count-based audit
by construction.

The second is what is *missing*, and it is worse. Anything you posted by hand to
Alertmanager never went through Prometheus, so it has no `ALERTS` series at all — and
neither does anything that fired, notified, and stopped before your window began, because
when an alert stops firing its series does not go to zero. It goes **stale**: Prometheus
writes a staleness marker and the series ends. `count_over_time` then counts the
samples that exist and reports a smaller number with total confidence.

Underneath both is the structural reason. `ALERTS` records what Prometheus *decided*.
Everything that determines whether a human was disturbed happens afterward, in
Alertmanager: grouping collapses ten alerts into one notification, inhibition suppresses
some entirely, silences remove others, `continue: true` duplicates the rest, and
`repeat_interval` multiplies whatever is left. Auditing `ALERTS` for noise is auditing the
kitchen to find out what the customers ate.

### The right source

Ask the program that actually sends the notifications:

```promql
sum by (integration) (increase(alertmanager_notifications_total[6h]))
```

The window is a literal `[6h]` and not the dashboard's time picker, on purpose: an audit
has to cover the same span every time it runs, or this month's number cannot be compared
with last month's.

!!! note "A lab that has been up one afternoon has nothing to audit"
    This is a real limitation and pretending otherwise would teach the wrong thing. A
    genuine noise audit reads weeks. Yours has been running since lunchtime. The lab
    ships a script that manufactures a history to audit — real alerts, really posted to
    Alertmanager, really routed, grouped and delivered to the pager. Nothing about the
    notifications is faked; only their cause is.

Run it, and give it about four minutes:

```bash
./scripts/scenario-noise-history.sh
```

It posts waves of synthetic alerts to `POST /api/v2/alerts` — Chapter 17's technique —
until it has driven roughly forty notifications through the real route tree, then
resolves everything it sent, including if you interrupt it. The notification history
stays. That is the point.

Now run the audit query. On the six-hour measurement run it returned one row:

```text
{integration="webhook"}   402.04
```

That is honest and it is not yet useful, for two reasons you should know about before you
build a dashboard on it.

Every receiver in this lab is a webhook, so `integration` cannot separate them. There is
a `receiver_name` dimension on this counter in Alertmanager 0.33.1, but it is behind
`--enable-feature=receiver-name-in-metrics`, which this lab does not set — so
`sum by (receiver)` on this counter is not wrong so much as empty of meaning. And the
number is fractional because `increase()` extrapolates to the window edges, exactly as
Chapter 6, "`rate()`, `increase()`, and Why Nothing Is a Whole Number", showed.

The second reason is the one that matters: most of those 402 notifications are the
Watchdog. One a minute, by design, for six hours. Your dead man's switch is the loudest
thing in your notification pipeline, and any volume number that does not account for it
is nonsense.

The receiver end can separate them, because the pager records the receiver name out of
each payload:

```promql
sum by (receiver) (increase(pager_notifications_received_total[6h]))
```

```text
{receiver="deadman"}       359.80
{receiver="pager-page"}     17.10
{receiver="pager-ticket"}   25.14
```

Three useful facts in three rows. The heartbeat is 90 percent of the traffic and none of
it is a page. The two human-facing receivers together carry about forty notifications,
which matches the script. And `pager-ticket` is larger than `pager-page` even though
fewer alerts are tickets — because `continue: true` sends every page to the ticket queue
as well, which is exactly the behavior Chapter 17 wired up and here it is, measured.

Note also that the two totals agree: 359.80 + 17.10 + 25.14 is 402.04. Alertmanager
counted what it attempted; the pager counted what arrived. When those two numbers stop
agreeing, `AlertmanagerNotificationFailures` is about to fire.

### Which alert, though

Neither counter carries `alertname`. For the breakdown you have to ask the receiver, and
the pager's JSON API answers directly:

```bash
curl -s http://localhost:5001/api/notifications \
  | jq -r '.notifications[].payload.groupLabels.alertname' \
  | sort | uniq -c | sort -rn
```

```text
     17 SnipTargetDown
      9 PrometheusTargetScrapesFailing
      8 SnipHighErrorRatio
      2 AlertmanagerNotificationFailures
      2 PrometheusNotificationsFailed
      2 SnipSLIAbsent
      1 SnipLatencyObjectiveAtRisk
      1 PrometheusRuleEvaluationFailures
```

That shape is the finding, and it is the shape you will see in real life. The
distribution is never flat. Three alerts account for about eighty percent of the volume,
and a long tail fires once. This is the single most reliable result in alert auditing:
**the top three are almost always the whole problem.** Fix or delete those and the pager
becomes usable; tune the tail and nothing changes.

!!! note "The metric that is not there"
    Chasing this, you will eventually find a dashboard or a blog post using
    `alertmanager_marked_alerts`. It was **removed in Alertmanager 0.33.0**. A panel
    built on it shows "No data" with no error anywhere, which reads exactly like a
    working panel on a quiet system. The replacement is `alertmanager_alerts`, which
    carries a `state` label: `sum by (state) (alertmanager_alerts)`.

### Defend it or delete it

For every alert on that list, three questions, in order:

1. **Did a human do something?** Not "could have" — did. If the answer is no, it is not
   an alert.
2. **Would a user have noticed if nobody had?** If not, it is at most a ticket.
3. **Was it right?** Count the times it fired against the times something was genuinely
   wrong. Ewaschuk's line is blunt and worth memorizing: *"Alerts that are less than 50%
   accurate are broken."* Not sensitive. Broken.

Then exactly one verdict per alert, recorded in `lab/docs/ALERT-REVIEW.md`: **keep**,
**downgrade** (`page` to `ticket`, a one-word routing change), **retune** (say the new
threshold and why), or **delete**. "Leave it, we will look next month" is not a verdict,
and "we might need it one day" is a delete — the rule is in git.

Deleting alerts is the single most effective thing you will ever do to a pager. An alert
that has fired forty times and been acted on twice is worse than no alert at all, because
it trains the team to ignore the channel that also carries the real ones.

## What good looks like, in numbers

You are allowed to know whether your on-call is reasonable, and the answer is not a
matter of taste. From Google's SRE practice, and worth quoting because it is one of the
few hard numbers in this subject: *"The maximum number of incidents per day is 2 per
12-hour on-call shift."* The distribution should be very flat, and the median number of
incidents per day should be **zero**.

The reasoning behind the ceiling is arithmetic, not ideology. An incident costs roughly
six hours once you count diagnosis, remediation, the write-up and the follow-up fix. Two
incidents is twelve hours, which is one whole shift. Above two, the on-call engineer is
not responding to incidents; they are being consumed by them, and the follow-up work that
would stop the next one never happens.

Alongside it, Ewaschuk's precision floor: below 50 percent accuracy, a paging rule is
broken. And a rule of thumb worth printing on the wall: **if an alert has no lead time
and no user impact, it is a dashboard panel, not a page.**

Measure yourself. Your lab's paging rate over a six-hour window, converted to a
twelve-hour shift, is:

```promql
sum(increase(pager_notifications_received_total{
  receiver="pager-page"}[6h])) * 2
```

Exercise 6 asks you to compare that with two, and the answer will be embarrassing,
because you spent four minutes deliberately manufacturing noise. That is the correct
reaction, and it is the reaction the number is supposed to produce on a real system too.

The review that acts on all this is a recurring thirty minutes, monthly, in the same slot
every time, with the numbers in hand rather than opinions. `lab/docs/ALERT-REVIEW.md` is
the procedure and the log. Never edit an old row; the point of the log is to show you
what you decided last time and whether it worked. It is the only mechanism in this book
that *removes* alerts, which makes it the only thing standing between you and a pager
nobody trusts.

!!! selfcheck "Self-check"
    Run `make verify-ch19`. It must print `ch19 OK` after 19 passing assertions:

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
    PASS the alertmanager job is up
    PASS the pager job is up
         alertmanager_notifications_total = 402
    PASS there is notification history to audit

    ch19: 19 passed, 0 failed
    ch19 OK
    ```

    The last one is a `SKIP` rather than a `PASS` until you have run
    `scenario-noise-history.sh`; the script says so and tells you what to run.

## Common mistakes

**Writing `severity: critical` and never adding a route for it.** The symptom is an alert
that is definitely firing, definitely visible in the Alertmanager UI, and reaches whoever
owns the root receiver — which is often nobody. Grep your rules for every distinct
`severity` value and check each one against the route tree. Three values is a good number;
seven means somebody has been describing feelings.

**Auditing noise with the `ALERTS` series.** It counts decisions, not deliveries, it goes
stale rather than to zero, and it cannot see anything that reached Alertmanager by another
path. Use `alertmanager_notifications_total`, and remember to subtract your heartbeat.

!!! pitfall "The annotation that always worked until it didn't"
    An annotation referencing a label that is not on the alert renders as `<no value>` —
    silently, forever, with nothing in any log. The two ways to get there are a copied
    rule (`{{ $labels.pod }}` in a lab with no pods) and an aggregation that dropped the
    label you were about to print (`sum by (job)` throws away `route`, and then
    `{{ $labels.route }}` is empty). Both look perfect in the rule file. Only a firing
    alert shows the damage, which is why `verify-ch19` reads `/api/v1/alerts` and not
    `/api/v1/rules`.

**A dashboard link with no time range.** It opens on "now", which is the one window you
already know about. Put `from` and `to` in the URL and choose them per alert.

**A runbook that is a flowchart.** It is correct on the day you write it and confidently
wrong within a quarter, and it is followed *instead of* thinking. Six headings, one
screen, causes as an ordered list rather than a tree.

**Treating the Watchdog as noise.** It is the largest single source of notifications in
the lab and it will be in yours too. The mistake is not that it is loud — the mistake is
routing it anywhere a human reads, or excluding it from a volume metric and then
forgetting it exists. It goes to its own receiver, with `severity: none`, and you subtract
it when you count.

## Summary

An alert is a piece of writing with a deadline. It has ninety seconds and one phone screen
to tell a half-conscious person what broke, who it hurts, where to look and what to do,
and every field that is missing is a field they will reconstruct by hand while the problem
continues. The five-field template is not bureaucracy; it is the smallest set of answers
that makes the difference between a page and an interruption.

Underneath that sits a colder fact. The alerting system is a service, it has users, and it
can fail in the one way no ordinary alert can detect: by going quiet. The Watchdog is the
answer, and it works by inverting the polarity of the entire system — one alert whose
absence is the emergency.

The durable takeaways:

- `severity` is an input to a routing decision and nothing else. Three values, three
  routes, one-to-one, and a written sentence for what a human does differently at each.
- Five annotations on every rule: what broke in user terms, who is affected with a number,
  the single first thing to check, a dashboard link with the range pre-set, and a runbook
  link derived mechanically from the alert name.
- A runbook is a brief explanation and current context, not a troubleshooting flowchart —
  flowcharts rot within a quarter and are followed instead of thinking. A missing runbook
  is a bug against the alert.
- Prometheus cannot page you about Prometheus. Scrape Alertmanager and the receiver, alert
  on the rule engine and both delivery hops, and accept that all four of those can fail
  silently.
- The dead man's switch is the only one that works when everything else is broken:
  `expr: vector(1)`, `severity: none`, routed somewhere that alarms when it *stops*
  arriving. Know its detection time and be able to state it.
- Audit notifications, never the `ALERTS` series: `sum by (integration)
  (increase(alertmanager_notifications_total[6h]))`, with the heartbeat subtracted. The top
  three alerts are almost always the whole problem.
- Fewer than two paging events per 12-hour shift; a median of zero incidents per day; and
  a paging rule under 50 percent accurate is broken rather than sensitive.
- The alert review is monthly, thirty minutes, with numbers. Every alert gets exactly one
  verdict, and one of the four is delete.

## Exercises

!!! exercise
    **1. Your worst annotation, graded (warm-up).** Chapter 16 exercise 4
    asked you to rewrite `SnipLatencyObjectiveAtRisk`'s `description` and
    keep what you wrote. Put it side by side with the five-field template
    and score it out of five. Then finish it, reload, and confirm `make
    verify-ch19` still prints `ch19 OK`. If your rewrite lost a field, the
    script names the rule and the count it found.

    **2. Kill the other half (core).** Run `docker compose stop
    alertmanager` and leave it down for fifteen minutes. Which meta-alert
    catches it? Which does not, and why? Write down what each of the four
    rules is looking at, then check yourself against
    `http://localhost:9090/alerts`. Pay attention to where the
    *notification* about the failure would have to travel. Then `docker
    compose start alertmanager`.

    **3. The noise audit (core).** Run
    `./scripts/scenario-noise-history.sh`, wait four minutes, then run the
    audit query and the per-receiver breakdown, and count alert names from
    the pager API. Which alert produced the most notifications? Write two
    sentences defending it or deleting it, and record the verdict as a row
    in `lab/docs/ALERT-REVIEW.md`. A verdict without a reason does not
    count.

    **4. A runbook that fits (core).** Write
    `docs/runbooks/SnipHighErrorRatio.md` in your own words before reading
    the one that ships. One screen, six headings, no flowchart, and the
    causes as an ordered list. Then diff yours against the shipped page —
    the interesting difference is not what you missed but what you included
    that will rot.

    **5. A taxonomy you can defend (core).** Write down three severity
    levels, the route each maps to, and the human response time each
    promises. Then find one rule in `snip-alerts.yml` or `meta-alerts.yml`
    whose severity you disagree with, change it, reload, hand-POST an alert
    with the new label set, and confirm from the pager that it reached a
    different receiver.

    **6. Your paging rate (stretch).** Compute paging notifications per
    simulated 12-hour shift from
    `pager_notifications_received_total{receiver="pager-page"}`. Compare it
    with Google's fewer-than-two. Then subtract the notifications the
    `continue: true` mirror produced and recompute — you have two defensible
    numbers now, and saying which one you mean is most of what makes an
    on-call metric honest.
