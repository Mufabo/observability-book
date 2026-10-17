# Chapter 17 — Alertmanager: Routing, Grouping and Silence

At the end of Chapter 16, "Alerting Rules, and What 'Firing' Actually Means", you had four
rules that worked. You watched one climb into `pending` and drop back, and another reach
`firing` and stay there. And every one of those firing alerts went absolutely nowhere,
because the address you wrote into `prometheus.yml` — `alertmanager:9093` — had nothing
listening on it.

That was deliberate, and it left you with the most useful confusion available in this
subject: *an alert can be firing and nobody can be told.* Prometheus does not know what a
person is. It has no notion of a phone, an on-call rotation, or the fact that you are already
looking at the incident. Deciding who hears about a firing rule — once, or forty times, or
not at all — is a different job, for a different program.

This chapter is that program. You will send it an alert by hand, with `curl`, before
Prometheus is allowed near it, because almost every tutorial fuses the two into one
pipeline. Pull them apart once and they stay apart.

!!! objectives "Objectives"
    After this chapter you can:

    - Send an alert to Alertmanager by hand and watch it route, group and notify.
    - Read a route tree as depth-first, first-match-wins, and say what `continue: true` does.
    - Name the four timers between a condition going bad and a human finding out, and which
      to change when the first page is too slow.
    - Write modern `matchers:`, quoted correctly, knowing regexes are fully anchored.
    - Write an inhibition rule, and recognize the trap where a label missing from both sides
      counts as equal.
    - Silence an alert with `amtool`, and explain why silences expire rather than delete.

## Where the lab is

Everything runs on the stack as Chapter 16 left it, plus two new containers.

```bash
cd lab
git checkout ch17
make check
make up
make ps
```

The new services are `alertmanager` on `http://localhost:9093/` and `pager` on
`http://localhost:5001/`, in `lab/compose.yaml`, trimmed to what matters:

```yaml
  alertmanager:
    image: quay.io/prometheus/alertmanager:v0.33.1
    command:
      - --config.file=/etc/alertmanager/alertmanager.yml
      - --storage.path=/alertmanager
      - --web.external-url=http://localhost:9093
    volumes:
      - ./alertmanager:/etc/alertmanager:ro
      - amdata:/alertmanager
    ports:
      - "9093:9093"
      - "9094:9094/tcp"
      - "9094:9094/udp"

  pager:
    build: ./pager
    ports:
      - "5001:5001"
```

`pager` is a small Python service that accepts a webhook, renders it as a web page and counts
what arrived. It exists so this chapter needs no SMTP server, no Slack workspace and no
internet, and every notification in it really traversed a real route tree.

Put the load generator into a known, healthy state:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","error_ratio":0}'
```

Now open `http://localhost:5001/`. The gray banner saying *"No heartbeat yet"* is the
business of Chapter 19, "What a Page Should Say, and Who Watches the Watcher"; leave it
alone. Underneath, the page probably says *"No notifications yet"* — but it may not.
`SnipLatencyObjectiveAtRisk` sits close to its threshold on an idle lab, and Prometheus has
pointed at `alertmanager:9093` since Chapter 16, so a notification you did nothing to cause
may already be there. Everything you send carries a name you chose.

## Two programs, two data models

Prometheus stores time series: a name, a label set, and a value at every scrape. Questions
you ask it are *queries*, and the answer is a number that was true at an instant.

Alertmanager stores none of that. It has never run a query, does not know what a metric is
and cannot compute anything. What it holds is a set of **alerts**, and an alert is a small,
dull object:

- a **label set** — the alert's identity, so two alerts with identical labels are the same
  alert;
- an optional **annotation** map — free text for humans, never used for matching;
- a **`startsAt`** timestamp and an **`endsAt`** timestamp.

That is the whole data model. Alerts have *lifetimes*, not values. The only question
Alertmanager asks is "is this label set live, and who should be told."

One wrinkle, for alerts Prometheus sends. `prometheus.yml` sets
`external_labels: {cluster: obslab, replica: a}`, and external labels are attached on the
way out — on alerts, on federation, on remote write. Every alert from a rule arrives here
carrying a `cluster` and a `replica` you never see in a query result; one you POST by hand
does not. Same name, different label set, different fingerprint: two different alerts.

```text
┌────────────┐  POST /api/v2/alerts   ┌──────────────┐   ┌───────┐
│ Prometheus │───────────────────────▶│ Alertmanager │──▶│ pager │
│   :9090    │  label sets, resent    │    :9093     │   │ :5001 │
│ evaluates  │  every evaluation      │ groups them, │   │ shows │
│  PromQL    │  while they fire       │ routes them, │   │ them  │
└────────────┘                        │ suppresses   │   └───────┘
                                      └──────────────┘
```

Chapter 16 lived entirely in the left-hand box; everything from here is the middle one.

The arrow between them repays a second look. Prometheus re-sends every firing alert
repeatedly — no more often than once per `--rules.alert.resend-delay`, which defaults to one
minute — for as long as it keeps firing. Alerts are not events: nothing is queued, nothing is
delivered once and consumed. Alertmanager sees a continuously refreshed picture of what is
currently wrong. Prove the separation by cutting that arrow out.

### Post an alert with your own hands

`lab/alertmanager/alertmanager.yml` at this tag already holds the finished configuration, and
you will arrive at it a piece at a time. Cut it down: keep `global:` and `templates:`, delete
everything from `route:` onwards, and put this in its place.

```yaml
route:
  receiver: pager-default
  group_wait: 10s
  group_interval: 30s
  repeat_interval: 2m

receivers:
  - name: pager-default
    webhook_configs:
      - url: http://pager:5001/webhook
```

Those three timers are the lab's deliberately short teaching values, and get a section to
themselves shortly. Carry one fact for now: the first means a notification arrives about ten
seconds after you post, not instantly. Whenever an experiment goes wrong,
`git checkout ch17 -- alertmanager/alertmanager.yml` puts the shipped file back.

Tell Alertmanager to re-read the file. There is no flag to enable first — the reload endpoint
is always on, and answers `200`:

```bash
curl -s -XPOST http://localhost:9093/-/reload
```

Now invent an alert and post it:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -XPOST http://localhost:9093/api/v2/alerts \
  -H 'Content-Type: application/json' \
  -d '[{
    "labels": {
      "alertname": "HandMade",
      "severity": "page",
      "service": "snip",
      "instance": "snip-api-1"
    },
    "annotations": {"summary": "I typed this myself."},
    "generatorURL": "http://localhost:9090/graph"
  }]'
```

```text
200
```

Note the square brackets: the endpoint takes an *array* of alerts, always, even for one. Note
also that you supplied no `startsAt` and no `endsAt`. Ask what Alertmanager made of that —
`curl -s http://localhost:9093/api/v2/alerts | jq` — and `startsAt` is the moment the POST
arrived, `endsAt` exactly five minutes later. That is `global.resolve_timeout`, so your alert
resolves itself. It reaches only alerts arriving without an `endsAt`, which is why it never
touches a real one: Prometheus always sets both.

Count to fifteen and refresh the pager. There is a notification, with a header line close
to:

```text
FIRING  1 alert in this one notification
        #25 · receiver pager-default · reason first notification · 17:47:34
```

Underneath, because your config has no `group_by` yet, the page says *"Grouped by nothing —
this route has an empty group_by."* Expand "raw webhook payload". This is version 4 of
Alertmanager's webhook contract, and it has been stable for years:

```json
{
  "version": "4",
  "groupKey": "{}:{}",
  "truncatedAlerts": 0,
  "status": "firing",
  "receiver": "pager-default",
  "groupLabels": {},
  "commonLabels": {
    "alertname": "HandMade",
    "instance": "snip-api-1",
    "service": "snip",
    "severity": "page"
  },
  "commonAnnotations": {"summary": "I typed this myself."},
  "externalURL": "http://localhost:9093",
  "notification_reason": "first notification",
  "alerts": [
    {
      "status": "firing",
      "labels": {
        "alertname": "HandMade",
        "instance": "snip-api-1",
        "service": "snip",
        "severity": "page"
      },
      "annotations": {"summary": "I typed this myself."},
      "startsAt": "2026-09-19T17:47:20.295007563Z",
      "endsAt": "0001-01-01T00:00:00Z",
      "generatorURL": "http://localhost:9090/graph",
      "fingerprint": "4ef353d9d1cdfe59"
    }
  ]
}
```

Two details are worth stopping on. `endsAt` is `0001-01-01T00:00:00Z` — Go's zero time —
though the API reported a real one a moment ago: the webhook carries what the *sender*
supplied, and you supplied nothing. The five minutes are Alertmanager's reckoning of when to
give up on you, not part of the alert. And `fingerprint` is a hash of the label set — what
"two alerts with identical labels are the same alert" means in practice.

You have now exercised routing, grouping, deduplication and delivery with Prometheus not
involved at all. When somebody tells you next year that "the alert didn't fire", you have two
separate questions, and this `curl` answers the second without touching the first.

Note the version in that path: **only `/api/v2` exists.** Alertmanager's v1 HTTP API was
removed in 0.27.0, and Prometheus 3 dropped v1 from its own side too — which is why the
`alerting:` block from Chapter 16 says `api_version: v2`, and why a config saying `v1` is
rejected at startup rather than warned about. Any tutorial posting to `/api/v1/alerts`
predates February 2024.

### The one field that is not camelCase

Read the payload once more. `groupKey`, `truncatedAlerts`, `groupLabels`, `commonLabels`,
`externalURL`, `startsAt`, `endsAt`, `generatorURL` — every one camelCase. And then
`notification_reason`, alone, in snake_case. Not a typo in the pager: it is what Alertmanager
sends, and it costs twenty minutes the first time you write a receiver. Its job is to say
*why this notification exists*, the one thing the rest of the payload cannot. On 0.33.1 there
are five values:

| Value | What just happened |
|---|---|
| `first notification` | the group was created and `group_wait` elapsed |
| `new alerts added` | an alert joined the group |
| `some alerts resolved` | part of the group ended, but not all of it |
| `repeat interval elapsed` | nothing changed and `repeat_interval` came round |
| `all alerts resolved` | the last alert in the group ended |

Those are the four timers made visible, one string at a time, plus one for a group that is
only partly better. You will meet all five before the chapter ends.

## A group is a bucket, and you choose the bucket

The component inside Alertmanager that receives alerts is the **dispatcher**, and the first
thing it does is decide which **group** an alert belongs to. A group is every alert sharing
identical values for every label named in `group_by`, and one group produces one notification,
holding however many alerts it has.

Your configuration has no `group_by` at all, which is the first of two available mistakes.
Post a second, unrelated alert:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -XPOST http://localhost:9093/api/v2/alerts \
  -H 'Content-Type: application/json' \
  -d '[{
    "labels": {
      "alertname": "DiskFilling",
      "severity": "ticket",
      "service": "monitoring"
    }
  }]'
```

Wait half a minute and refresh. Alertmanager has not opened a second group — it has
re-notified the same one. A **second** notification appears, reason `new alerts added`,
saying **2 alerts in this one notification**: still grouped by nothing, listing a disk
problem and a redirect problem side by side as though they were one thing. The original
one-alert card sits underneath it; the pager appends, never updating a card in place.

Alertmanager says the same thing in a number: grep
`alertmanager_dispatcher_aggregation_groups` out of `http://localhost:9093/metrics` and it
reads `1`. One group, for the whole system.

!!! pitfall "The two ways to get grouping wrong"
    Omitting `group_by` from the root route puts **every alert in the system into one
    group**. A full disk and a latency regression arrive in one message, whose title can
    describe only one of them.

    Writing `group_by: ['...']` — a literal three dots, as the only entry — does the
    opposite. It groups by every label there is, so no two alerts are ever alike and you get
    one notification per alert. The upstream documentation calls that effectively disabling
    aggregation. It is occasionally right, at very low volume, and almost never right by
    accident.

Set the sane starting point instead:

```yaml
route:
  receiver: pager-default
  group_by: [alertname, service]
  group_wait: 10s
  group_interval: 30s
  repeat_interval: 2m
```

Reload, then post both alerts again so nothing depends on how long ago you sent them. Now
you get two notifications, one per group, each saying **Grouped by `alertname="HandMade"`
`service="snip"`** or the equivalent, and the gauge reads `2` — plus whatever groups
Prometheus's own alerts have made, which is your first hint that it counts the whole
process, not just your corner of it.

`alertname` belongs in `group_by` almost always: it is the closest thing an alert has to a
subject line. `service` is this lab's second axis because every rule in
`lab/prometheus/rules/snip-alerts.yml` carries one. What does *not* belong is anything
high-cardinality — put `instance` there and forty machines going down produce forty
notifications, the pile-up grouping exists to prevent.

## Letting Prometheus in

Everything so far worked with Prometheus disconnected in your head, not in the config. Connect
the two deliberately now. The block is the one Chapter 16 added to the top of
`lab/prometheus/prometheus.yml`:

```yaml
alerting:
  alertmanagers:
    - api_version: v2
      static_configs:
        - targets: ["alertmanager:9093"]
```

Prometheus reports the address it derived, not the one you typed:

```bash
curl -s http://localhost:9090/api/v1/alertmanagers | \
  jq -r '.data.activeAlertmanagers[].url'
```

```text
http://alertmanager:9093/api/v2/alerts
```

One active Alertmanager, path appended for you — the fastest way to answer "is Prometheus
even trying?" An empty list means the alerting side is not wired at all, and staring at the
route tree will not help.

## Four timers, one timeline

Between a condition going bad and a human reading about it there are four delays, in two
different files, and confusing them is the most common way to build an alerting system that
is both too slow and too noisy. Read them in the order the alert meets them:

| Timer | Where | What it waits for |
|---|---|---|
| `for` | the Prometheus rule | the condition to hold at every evaluation |
| `group_wait` | the route | friends to arrive, for a brand-new group |
| `group_interval` | the route | the next check, once a group exists |
| `repeat_interval` | the route | long enough to be worth nagging again |

Here is the whole chain for `SnipHighErrorRatio`, which you wrote in Chapter 16 with
`for: 5m`, against this lab's route timings:

```text
 t=0        the recorded ratio first exceeds 0.20
 │
 │          for: 5m — Prometheus side. One evaluation where the
 │          expression does not return a value puts this back to zero.
 │
 t=5m00s    the rule goes firing; Prometheus POSTs it, and keeps POSTing
 │
 │          group_wait: 10s — a brand-new group, so Alertmanager holds
 │          the door open in case a second alert joins
 │
 t=5m10s    NOTIFICATION 1   reason: first notification
 │
 │          group_interval: 30s — checked at t=5m40s, 6m10s, 6m40s,
 │          7m10s… Nothing changed in the group, so nothing is sent.
 │
 t=7m40s    NOTIFICATION 2   reason: repeat interval elapsed
```

Three things fall straight out of that picture.

**`group_wait` is the only timer that delays the first notification.** If the first page
takes too long, `group_wait` is the knob — or `for`, back on the Prometheus side. Nothing
else is in the path.

**`group_interval` gates notifications about a group that is *changing*.** An alert joining
the group, or one of its alerts resolving, makes the group's contents different from what
you were last told, and Alertmanager tells you again — but no more often than once per
`group_interval`. A join is the `new alerts added` reason; one of the group's alerts
resolving while the rest keep firing is `some alerts resolved`.

**`repeat_interval` is the nag for a group that is not changing.**

You can watch the first window rather than taking it on faith. Post two alerts in different
groups and grep `alertmanager_alerts` out of `/metrics`: inside `group_wait` it reads
`{state="unprocessed"} 2`, and ten seconds later both read `state="active"`. `unprocessed`
means "received, but nobody told yet".

!!! warning "Do not lower `group_interval` to get alerted faster"
    It is the natural reaction and it is exactly wrong. `group_interval` has no effect on
    the first notification, so lowering it buys nothing on the number you care about — and
    during a real outage, where alerts join and leave every few seconds, `10s` turns one
    incident into a notification every ten seconds, per group, until somebody silences it.

One arithmetic surprise, before it bites. A group is only examined on a `group_interval`
tick, so `repeat_interval` is effectively rounded up to a multiple of it: `7m` against
`group_interval: 5m` gives ten-minute repeats, not seven. This lab's `2m` against `30s`
divides exactly — which is why the repeat lands at 7m40s, not 7m10s. Alertmanager stamps its
notification log *after* the first notification goes out, so the dividing tick is a few
milliseconds too early and the nag waits one more tick. Every repeat here is 2m30s.

!!! warning "The timings in this lab are teaching values"
    Alertmanager's defaults are `group_wait: 30s`, `group_interval: 5m`,
    `repeat_interval: 4h`, and they are *good*: right for someone on an on-call rotation who
    needs reminding about an unresolved problem a few times a day.

    This lab uses `10s / 30s / 2m` for one reason — a chapter cannot contain a four-hour
    wait — and `make verify-ch17` asserts the `2m` because later scripts depend on it. Do not
    ship them: a two-minute `repeat_interval` in production teaches people to ignore their
    pager.

## The route tree

One receiver for everything is not an alerting system; it is a mailing list. The route tree
turns a label set into a destination, by rules that are short and absolute:

1. Every alert enters at the **root route**, which must match everything — so it carries no
   matchers — and must name a receiver.
2. It walks the root's children **in order, depth first**.
3. The **first child that matches wins** and the walk stops there, unless that child says
   `continue: true`, in which case later siblings may match too.
4. A child that does not match does **not** mean the alert is unrouted; it means the parent
   handles it.
5. Children **inherit** `receiver`, `group_by`, the three timers and the time-interval
   fields, and may override any.

Point 4 is the one people get wrong in the other direction: three children, none matches, and
they assume the alert vanished. It went to the root receiver, usually the wrong place, and
nothing said so.

Add three children to your root route:

```yaml
  routes:
    # 1. Pages, which continue: true also copies to the ticket
    #    queue as a written record.
    - matchers:
        - 'severity = "page"'
      receiver: pager-page
      continue: true

    # 2. Tickets, plus the mirror of every page from route 1.
    - matchers:
        - 'severity =~ "page|ticket"'
      receiver: pager-ticket

    # 3. severity: none. Nothing lands here yet; the route exists
    #    so "where did it go" is never answered with "the root
    #    receiver, apparently".
    - matchers:
        - 'severity = "none"'
      receiver: "null"
```

and three more receivers beside `pager-default`:

```yaml
  - name: pager-page
    webhook_configs:
      - url: http://pager:5001/webhook

  - name: pager-ticket
    webhook_configs:
      - url: http://pager:5001/webhook

  - name: "null"
```

Three of the four point at the same URL on purpose: the receiver's name travels in the
payload and the pager prints it, so you see which route delivered each notification rather
than guessing. `null` is a receiver with no integrations — legal, and the idiomatic way to
write "deliver this nowhere". The quotes are load-bearing: unquoted, YAML reads `null` as the
null value and the config will not load.

### Test the tree without firing anything

Reload — then, separately, ask `amtool` to draw the tree **the file** describes. It parses
the file on disk and contacts nobody, not even the running Alertmanager, which is why the
reload is a separate step and not a prerequisite:

```bash
docker compose exec alertmanager amtool config routes show \
  --config.file=/etc/alertmanager/alertmanager.yml
```

```text
Routing tree:
.
└── default-route  receiver: pager-default
    ├── {severity="page"}  continue: true  receiver: pager-page
    ├── {severity=~"page|ticket"}  receiver: pager-ticket
    └── {severity="none"}  receiver: null
```

Then push a label set through it — the single most useful command in the chapter:

```bash
docker compose exec alertmanager amtool config routes test \
  --config.file=/etc/alertmanager/alertmanager.yml \
  severity=page service=snip alertname=Demo
```

```text
pager-page,pager-ticket
```

Two receivers from one alert, comma-separated on one line. That second name is what
`continue: true` buys. `severity=ticket` prints `pager-ticket`, `severity=none` prints
`null`, and `severity=info` — which nothing here emits — prints `pager-default`, the root
receiver catching what the children missed.

!!! trap "Trap: delete `continue: true` and a whole receiver goes quiet"
    Delete the `continue: true` line, reload, and run the first `routes test` again:

    ```text
    pager-page
    ```

    The ticket queue has gone silent for every page in the system, permanently, and nothing
    reports an error: no log line, no failed notification, no metric. This is the number one
    reason a second receiver never fires — somebody tidied a route tree, the first matching
    sibling swallowed the alert, and the failure mode of routing is silence. Put the line
    back.

!!! selfcheck "Self-check"
    Run `make verify-ch17`. It budgets ninety seconds and usually finishes in about
    twenty-five, because it stops polling the moment both receivers have been seen. It posts
    three synthetic alerts with three severities and asserts that exactly the right
    notifications reach the pager, including the `continue: true` duplicate, then prints
    `ch17 OK`.

    ```text
    == verify-ch17 ==
       expected runtime: about 1 min 30

    PASS Alertmanager answers on http://localhost:9093
    PASS the pager answers on http://localhost:5001
         pager is at seq 41
    PASS POST /api/v2/alerts accepted the three alerts
         waiting for group_wait (10 s) and the flush, up to 90 s
      [ 10s] page→[] ticket→[]
      [ 20s] page→[pager-page pager-ticket] ticket→[pager-ticket]
    PASS the page alert reached pager-page
    PASS the page alert also reached pager-ticket
    PASS the ticket alert reached pager-ticket
    PASS the severity: none alert reached nobody
    PASS exactly three notifications for three alerts
         pager_notifications_received_total totals 44
    PASS exactly one route carries continue: true
    PASS repeat_interval is 2m (the lab's deliberate shortening)

    ch17: 10 passed, 0 failed
    ch17 OK
    ```

    The `seq` and `totals` lines are counters, so your numbers will be larger. Only the
    `PASS` lines are assertions, and there are ten.

## Matchers: two quoting layers and a fully anchored regex

A matcher is three tokens — a label name, an operator, a value — with the same four operators
you know from series selectors in Chapter 2, "What's Actually on the Wire": `=`, `!=`, `=~`,
`!~`. The regexes behave the same way too, which is the first trap.

!!! trap "Trap: matcher regexes are fully anchored"
    Every regex in a matcher is anchored at both ends, exactly as in PromQL. `=~ "page"`
    matches the string `page` and nothing else — not `pages`, not `webpage`.

    Add a child route meant to catch warnings, with `'severity =~ "warn"'` as its only
    matcher, and test it against a real warning:

    ```bash
    docker compose exec alertmanager amtool config routes test \
      --config.file=/etc/alertmanager/alertmanager.yml \
      severity=warning alertname=Demo
    ```

    ```text
    pager-default
    ```

    No error, no warning, no hint: the alert fell through every child onto the root receiver.
    The fix is `'severity =~ "warn.*"'` or, better, spelling out what you mean:
    `'severity =~ "warning|critical"'`.

The second trap is quoting, common enough that Alertmanager 0.33.0 shipped a documentation
fix about it. **Two independent quoting layers are in play**: YAML has one, the matcher
grammar has another, and different programs parse them at different times. The habit that
survives both is **single-quote the whole matcher in YAML, double-quote the value inside.**

```yaml
matchers:
  - 'severity =~ "page|ticket"'
  - 'route = "/l/{code}"'
```

YAML passes a single-quoted scalar through untouched, and the matcher parser then sees a
properly quoted value. The bare form — `- severity =~ "page|ticket"` — works today and
breaks the moment a value contains a `:` or a `#`, which YAML reads as structure. The
second line is real: `SnipLatencyObjectiveAtRisk` carries `route: "/l/{code}"`, and `{` and
`}` are both characters the matcher grammar reserves unless the value is quoted.

Since 0.27.0 Alertmanager has had a new matcher parser accepting any UTF-8 character in label
names and values. As of 0.33.1 the default is still **fallback mode**: the new parser runs
first, and what it cannot handle falls back to the classic parser with a log warning. Strict
mode is opt-in with `--enable-feature=utf8-strict-mode`.

Check your file before you reload it. This works offline, against the file, with no running
server:

```bash
docker compose exec alertmanager \
  amtool check-config /etc/alertmanager/alertmanager.yml
```

```text
Checking '/etc/alertmanager/alertmanager.yml'  SUCCESS
Found:
 - global config
 - route
 - 0 inhibit rules
 - 4 receivers
 - 1 templates
  SUCCESS
```

That receiver count is a sanity check: add one, and if the number does not move you edited
the wrong file. Watch the inhibit-rule count too — `0` now, `1` shortly.

!!! note "Decoding an older config: `match` and `match_re`"
    Configurations written before 2024 use two different keys:

    ```yaml
    match:
      severity: page
    match_re:
      service: snip|catalog
    ```

    `match` is an exact-equality map; `match_re` a regex map. Both are **deprecated but not
    removed** in 0.33.1 — the source says "remove before v1.0 release", and Alertmanager has
    been pre-1.0 for ten years. The inhibit-rule equivalents are `source_match`,
    `source_match_re`, `target_match` and `target_match_re`. Read them, translate them, do not
    write them.

## Templates, and the trap in `.CommonLabels`

Every configuration field Alertmanager's documentation marks `<tmpl_string>` is a Go
`text/template`. The lab ships a file of them at `lab/alertmanager/templates/pager.tmpl`,
loaded by the glob you kept at the top of the config.

The fact that governs everything else here: **a template is rendered once per notification**
— once per group, per receiver — **not once per alert**. If the group holds four alerts,
`.Alerts` is a list of four and the template runs once over all of them. The lab's title
template:

```text
{{ define "obslab.title" -}}
[{{ .Status | toUpper }}
{{- if eq .Status "firing" }} x{{ .Alerts.Firing | len }}{{ end }}]
{{- " " }}{{ .GroupLabels.alertname }} ({{ .GroupLabels.service }})
{{- end }}
```

The file keeps lines two and three as one; the leading `{{-` is what lets them be split here
without changing the output. Two mechanics to take from it. `.Alerts.Firing` and
`.Alerts.Resolved` are filtered sub-lists, which is how a notification says "3 firing, 1
resolved". And the dash in `{{-` and `-}}` trims whitespace on that side — without it, a
loop over alerts leaves a blank line per alert.

You can render any of them without sending anything, which is the difference between
debugging templates and spamming a channel:

```bash
docker compose exec alertmanager amtool template render \
  --template.glob='/etc/alertmanager/templates/*.tmpl' \
  --template.text='{{ template "obslab.title" . }}'
```

```text
[ALERTSTATUS]  ()
```

There is no alert behind that command — `ALERTSTATUS` is the placeholder `amtool` puts in for
`.Status`, and the empty parentheses are an empty `.GroupLabels`. What matters is what it
proves: the file parses, the template name exists, every function you called is real. Do it
early and often, because a template error does **not** fail at config load. It fails at
delivery — nothing is sent, and the only trace is a log line and a bump in
`alertmanager_notifications_failed_total`.


No receiver references those templates, and that is not an oversight. A webhook's body is
fixed; the only way to template it is the `payload:` option added in 0.32.0, which replaces
the body with a flat map of strings and so cannot reproduce the nested `alerts` array the
pager reads. On a receiver taking a `title` and a `text` — email, Slack and most others —
you name them there instead.

!!! trap "Trap: `.CommonLabels` empties itself when the group grows"
    `.GroupLabels` holds the labels the group was formed on, so it is always populated.
    `.CommonLabels` holds only labels whose values are **identical across every alert in the
    group** — and one that differs is dropped silently.

    Post one alert with `alertname="GroupDemo"`, `severity="ticket"`, `service="snip"`,
    `instance="snip-api-1"`, and a summary naming that instance. The pager's "Common to every
    alert here" line, which is exactly the map a template sees as `.CommonLabels`, reads:

    ```text
    alertname="GroupDemo" instance="snip-api-1" service="snip"
    severity="ticket"
    ```

    Now post a second alert into the same group — same `alertname`, `service` and
    `severity`, but `instance="snip-api-2"` and a summary naming *that* instance, the way a
    templated rule annotation would — and wait one `group_interval`. A **new** notification
    arrives, reason `new alerts added`, and its line reads:

    ```text
    alertname="GroupDemo" service="snip" severity="ticket"
    ```

    `instance` is gone, and so is every annotation, because the two summaries differed:
    `commonAnnotations` is now `{}`. A template reading `.CommonLabels.instance` rendered
    `snip-api-1` a moment ago and now renders nothing — no error, no warning, only a gap where
    the hostname was. Use `.GroupLabels` for what you are sure of, `range .Alerts` for
    anything per-alert.

Two limits, because readers try both. Alertmanager templates **cannot query Prometheus** —
they have no data source, so anything computed must be baked into a label or annotation by
the rule. And `$labels` and `$value` from Chapter 16 do not exist here: that is Prometheus's
rule templating, evaluated before the alert is sent. Here the same data is `.Labels` and
`.Annotations`, inside `range .Alerts`.

## Inhibition: one cause, one page

A replica stops answering. `SnipTargetDown` fires, and so do `SnipHighErrorRatio`,
`SnipLatencyObjectiveAtRisk` and `SnipSLIAbsent`: four notifications, one problem, three of
them consequences of the first. **Inhibition** is the mechanism for saying so.

An inhibit rule has three parts. `source_matchers` select the alert doing the suppressing,
`target_matchers` select the alerts to suppress, and `equal` lists the labels that must match
on both for the rule to apply at all.

Restore the shipped file — `git checkout ch17 -- alertmanager/alertmanager.yml`, then
`curl -XPOST http://localhost:9093/-/reload` — because the rule you are about to read is
already in it:

```yaml
inhibit_rules:
  - source_matchers:
      - 'alertname = "SnipTargetDown"'
    target_matchers:
      - 'alertname != "SnipTargetDown"'
      - 'service = "snip"'
    equal: [team]
```

Read it as a sentence: *a Snip replica being down suppresses every other Snip alert on the
same team.* That is the canonical shape — a cause swallowing the symptoms above it. The `!=`
matcher is not decoration: without it, a replica down in one container would inhibit the
identical alert about a different container.

Test it by hand. Post the cause and the symptom together:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -XPOST http://localhost:9093/api/v2/alerts \
  -H 'Content-Type: application/json' \
  -d '[
    {"labels": {"alertname":"SnipTargetDown","severity":"page",
                "service":"snip","job":"snip-api",
                "instance":"snip-api-1"}},
    {"labels": {"alertname":"SnipHighErrorRatio","severity":"page",
                "service":"snip","job":"snip-api",
                "route":"/l/{code}"}}
  ]'
```

Ask Alertmanager what it thinks of them:

```bash
curl -s http://localhost:9093/api/v2/alerts | jq -r \
  '.[] | [.labels.alertname, .status.state] | @tsv'
```

```text
SnipTargetDown	active
SnipHighErrorRatio	suppressed
```

You may have more rows than those two: the command lists everything Alertmanager holds, and
anything you posted in the last five minutes is still live. Only these two matter here.

The pager gets **two** notifications for the cause — `pager-page` and, via `continue: true`,
`pager-ticket` — and none at all for the symptom, which is `suppressed`: still there, still
firing, still visible in the UI with a marker on it.

!!! warning "Suppressed is not resolved"
    Inhibition suppresses the **notification**, not the alert. "It disappeared from my inbox"
    and "it is fixed" are different statements, and an inhibit rule written against the wrong
    source is how a real problem hides behind an unrelated one for a week.

### The rule that works for the wrong reason

That rule did exactly what you wanted. It is also broken, and the only way to find out is
to try to make it fail.

`HandMade` carries `service="snip"` and has nothing to do with a replica being down. Post
it again if `resolve_timeout` has aged it out, then run the same query and read all three
rows:

```text
SnipTargetDown	active
SnipHighErrorRatio	suppressed
HandMade	suppressed
```

An alert you typed by hand, about nothing, is being suppressed by an unrelated outage.

The reason is `equal: [team]`. Nothing in `lab/prometheus/rules/snip-alerts.yml` sets a
`team` label, and neither do the alerts you have been posting. The upstream documentation
raises its voice about exactly this, with a capitalized CAUTION: **if every label name listed
in `equal` is missing from both the source and the target, the inhibition rule applies.**
Missing equals missing. The clause was never scoping anything — it was matching absence
against absence on every pair offered.

Prove it rather than trusting the explanation. Post two more alerts, identical except that
one carries a `team` label:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -XPOST http://localhost:9093/api/v2/alerts \
  -H 'Content-Type: application/json' \
  -d '[
    {"labels": {"alertname":"NoTeamAlert","severity":"ticket",
                "service":"snip","job":"snip-api"}},
    {"labels": {"alertname":"TeamAlert","severity":"ticket",
                "service":"snip","job":"snip-api",
                "team":"platform"}}
  ]'
```

```text
NoTeamAlert	suppressed
TeamAlert	active
```

Read that twice. **Adding a label made an alert page again.** `TeamAlert` has
`team="platform"` and `SnipTargetDown` has no `team` at all; present is not equal to
missing, so the rule does not apply. `NoTeamAlert` has no `team` either, so it matches the
source's absence and is swallowed.

The fix is to name a label both sides carry. Change one line:

```yaml
    equal: [job]
```

Every rule in `snip-alerts.yml` produces alerts carrying `job`, and it is worth checking why
rather than assuming: `SnipTargetDown` comes from `up`; `SnipHighErrorRatio` from a rule
aggregated `by (job, route)`; `SnipLatencyObjectiveAtRisk` from `sum by (job) (…)`; and
`SnipSLIAbsent` from `absent()` around a selector carrying `job="snip-api"`.

Clear `TeamAlert` and `NoTeamAlert` — props for the `team` demonstration — by re-posting them
with an `endsAt` in the past. Reload, then post the cause, the symptom and `HandMade` again.
`SnipHighErrorRatio` is still `suppressed`: same `job` as the source, so the rule applies.
`HandMade` is `active`, having no `job` at all. The unrelated alert pages and the related one
does not, which is the whole purpose of `equal`. Every later chapter ships `equal: [job]`.

### The other half of the trap

The opposite mistake is the one people make while being careful. This rule looks as though
it ought to be scoped to one container, so `instance` belongs in `equal`:

```yaml
    equal: [job, instance]
```

Reload and post the cause-and-symptom pair again. Both alerts are `active`, both
notifications arrive, and inhibition has quietly stopped working. `SnipTargetDown` comes from
`up`, which carries `instance`; `SnipHighErrorRatio` comes from a rule aggregated
`by (job, route)`, which does not. One side has `instance="snip-api-1"`, the other has none,
so they are not equal and the rule never applies.

The two failures are mirror images and both are silent. A label only one side carries means
the rule never fires; a label neither side carries means it always does. Name only labels you
can point to on both sides, and check with a hand-posted pair.

Put the rule back the way the fix left it — `equal: [job]` — and reload. That is what every
later chapter ships, and `git checkout ch18` refuses to move over a modified file. The ch17
tag is the wrong thing to restore from here: it ships the broken `equal: [team]`.

## Time intervals: muting the clock, not the alert

Muting a route between five in the evening and nine in the morning is a two-step
configuration whose halves live in different places. **Define** a named interval once, under
the top-level `time_intervals:` key; then **reference** it by name from a route's
`mute_time_intervals:` or `active_time_intervals:`.

```yaml
time_intervals:
  - name: monthly-maintenance
    time_intervals:
      - days_of_month: ["1"]
        times:
          - start_time: "02:00"
            end_time: "04:00"
        location: UTC

  - name: out-of-hours
    time_intervals:
      - weekdays: [saturday, sunday]
        location: Europe/Berlin
      - weekdays: ["monday:friday"]
        times:
          - start_time: "00:00"
            end_time: "09:00"
          - start_time: "17:00"
            end_time: "24:00"
        location: Europe/Berlin
```

A route can only reference an interval that already exists, which is why the ticket route was
written without the key earlier. The shipped file has it:

```yaml
    - matchers:
        - 'severity =~ "page|ticket"'
      receiver: pager-ticket
      mute_time_intervals:
        - monthly-maintenance
```

Four things about that YAML are worth saying out loud.

**`location` defaults to UTC when you leave it out.** The most common cause of a maintenance
window firing at the wrong hour. Write it even when UTC is what you meant.

**A time range cannot wrap past midnight.** `start_time: "17:00"` with `end_time: "09:00"`
is not a night; it is nothing. That is why `out-of-hours` is two specs — the whole weekend,
then weekdays — and why the weekday spec carries two ranges, the small hours and the evening.
`end_time: "24:00"` is the idiom for end of day. Within a spec every field must match; across
specs, any one is enough.

**Route-level `mute_time_intervals` is current, not deprecated.** The deprecated one is the
**top-level** key, superseded by `time_intervals` above. Many blog posts conflate the two,
and readers who believe them delete a working key.

**A muted route consumes the alert; it does not fall through to a sibling.** With both
`mute_time_intervals` and `active_time_intervals` on one route, an alert must be inside an
active interval *and* outside every mute interval to be delivered.

`out-of-hours` is defined here and deliberately referenced by no route: muting the ticket
queue outside working hours would make `make verify-ch17` pass or fail depending on the time
you read it. Exercise 4 wires it up.

## Silences, and why they expire

A **silence** is a time-bounded set of matchers. Any alert matching *all* of them produces
no notification for as long as the silence lasts.

Silences are not configuration. They are runtime state, created by a human during an incident
and stored under `--storage.path` — which is why the compose file gives the container the
named volume `amdata` instead of letting a restart throw them away.

Trigger a real page first, with Chapter 16's `SnipHighErrorRatio` fired by the outage
scenario rather than by hand:

```bash
./scripts/scenario-outage.sh --no-wait
```

That drives forty requests per second with thirty percent failing. The recorded ratio is built
on five-minute rates, so it crosses the rule's `0.20` threshold after three or four minutes;
then `for: 5m`; then `group_wait: 10s`. Expect your first real page eight to ten minutes in,
delivered to **both** `pager-page` and `pager-ticket`, then a repeat every two and a half.
Watch `http://localhost:9090/alerts` meanwhile: `pending` appears before `firing`, as in
Chapter 16.

Now pretend you are about to deploy a fix and do not want to be paged about a problem you are
already working on. Note `--alertmanager.url`: every `amtool` subcommand that talks to a
running Alertmanager requires it, and omitting it fails with
`amtool: error: required flag --alertmanager.url not provided`.

```bash
docker compose exec alertmanager amtool silence add \
  'alertname="SnipHighErrorRatio"' \
  --alertmanager.url=http://localhost:9093 \
  --duration=2m \
  --author=obslab \
  --comment="deploying the fix, ticket OPS-123"
```

It prints the ID:

```text
f048da1e-db01-4783-ac7d-4e578c1b743e
```

`amtool silence query` lists what is silenced; its table is wider than this page, so read
the same rows from the API:

```bash
curl -s http://localhost:9093/api/v2/silences | jq -r \
  '.[] | [.id[0:7], .status.state, .comment] | @tsv'
```

```text
f048da1	active	deploying the fix, ticket OPS-123
```

The repeat stops. Nothing else changes: the alert still fires in Prometheus, is still active
in Alertmanager, and now carries the silence's ID in `.status.silencedBy`.

Then do nothing at all for two minutes. The nag comes back on its own, because the silence
**expired**. A silence has an `endsAt`, and when the clock passes it the silence stops
applying — nothing has to remember to remove it. A silence you forget about fails *open*, the
alert coming back, which is the correct direction for a mechanism whose whole purpose is to
hide problems from you.

Ending one early is an expiry too, not a deletion. This prints nothing on success:

```bash
docker compose exec alertmanager amtool silence expire \
  --alertmanager.url=http://localhost:9093 \
  f048da1e-db01-4783-ac7d-4e578c1b743e
```

The record stays. Run the same API query and the state has changed rather than the row
disappearing — `expired`, not gone. Alertmanager's `alertmanager_silences` gauge counts them
under three states, `active`, `pending` and `expired`, and none is "deleted".

The API's URL shapes trip everyone, so note them once: the list endpoint is plural
(`/api/v2/silences`, which both creates and updates — pass an existing `id` to update), the
single-item endpoint is singular (`/api/v2/silence/{id}`), and `DELETE` on the singular
expires rather than erases.

Stop the scenario:

```bash
curl -s -XPOST http://localhost:8089/chaos/reset
```

## Running it: three details that will find you

**`--web.external-url`.** The compose file sets it to `http://localhost:9093`, and that is
what appears as `externalURL` in every webhook payload and `.ExternalURL` in templates — how
a notification tells its reader where to go to silence the thing. Behind a reverse proxy the
container cannot know what URL the outside world reaches it on, so every link it generates is
wrong until you set this.

**Port 9094, TCP *and* UDP.** Alertmanager's clustering gossips over both, and a firewall
rule opening only TCP produces a half-working mesh rather than an obvious failure — so this
lab publishes both even for a single instance. One Alertmanager is right for every reader
here; Chapter 26, "When One Prometheus Isn't Enough: HA, `remote_write`, and the Scaling
Map", covers the rest.

**Alertmanager is still pre-1.0, after ten years.** Do not read `0.32` → `0.33` as a semver
minor bump: minor releases here can and do carry breaking changes. The `auto-gomaxprocs`
feature flag was removed outright in 0.33.0. Read the changelog before you upgrade.

One last thing: the Status page in the UI shows what Alertmanager parsed, not your file —
comments gone, defaults spelled out, secrets reading `<secret>`. The right place to ask what
this process is running; the wrong place to copy from.

!!! sidebar "When Grafana Alerting is the better choice"
    Grafana has a complete alerting system of its own, and Alertmanager is taught here
    instead. That is a decision, not an oversight, so here is the honest version.

    Alertmanager wins where this approach wins. Your rules are YAML files living next to the
    code and the PromQL they depend on. They are reviewed in the same pull request as the
    change that made them necessary, rolled back with it, and unit tested — Chapter 18,
    "Testing Alerts Before They Page You" — which is not something you can do to a rule that
    exists only in a database. The service-level-objective literature Chapter 20 builds on,
    and every generator implementing it, emits rule files.

    Grafana Alerting wins in three situations. **Multi-data-source alerts**: a Grafana-managed
    rule can combine a Prometheus query with a SQL query and alert on the pair, which
    Prometheus structurally cannot do. **Teams who will not edit YAML**: a UI-driven rule that
    exists beats a version-controlled rule nobody writes. And **alerting on data Prometheus
    never sees at all**.

    The two systems are closer than they look. Grafana provisions contact points,
    notification policies and mute timings as YAML of its own, and a Grafana-managed rule has
    a *pending period* — `for` under another name — plus a *keep firing for* setting for
    damping flapping. Everything in this chapter transfers.

    Plenty of organizations run both, and Grafana can be pointed at an external Alertmanager
    as a contact point. Pick a main line, be able to say why, and do not let alerts pile up in
    two systems where neither knows about the other.

## Common mistakes

**A second receiver that has never once fired.** The alert matched an earlier sibling, that
sibling had no `continue: true`, and routing's failure mode is silence. Check with
`amtool config routes test` before looking at the receiver.

**Lowering `group_interval` because the page was slow.** It is not in the path of the first
notification; `for` and `group_wait` are. Lowering it makes an evolving incident noisier and
does nothing for detection time.

**A matcher regex that is not anchored the way you think.** `=~ "warn"` does not match
`warning`; matcher regexes are anchored at both ends, like a series selector.

!!! pitfall "The inhibit rule that fires on everything, or on nothing"
    Name a label **one** side lacks and inhibition never applies: the symptom keeps paging
    alongside the cause. Name a label **neither** side has and missing counts as equal, so the
    rule suppresses indiscriminately — worse, because the evidence is an alert that never
    arrived. Both are silent. Check every new rule with a hand-posted pair.

**A maintenance window in the wrong timezone.** `location` defaults to UTC. Write it
explicitly, even when UTC is what you meant.

**Silencing by commenting out the rule.** Same quiet, but no expiry, no author, no comment,
no record. A silence is the right tool because it is temporary by construction.

## Summary

Alertmanager is a separate program with a separate data model, and everything else in this
chapter follows from that. It receives label sets with a `startsAt` and an `endsAt`, not
queries and not values — which you proved with `curl`, before Prometheus was involved.

Inside it, the dispatcher buckets alerts into groups, a group is the unit of notification,
and four timers stand between a bad condition and a human, with `notification_reason` naming
which one just fired. Inhibition drops notifications for symptoms when a cause is already
firing; silences do the same by hand, with an expiry rather than a delete.

The things to still know in six months:

- An alert firing in Prometheus and a human being notified are separated by a second
  program, so a page that never arrives has two places to look.
  `curl -XPOST /api/v2/alerts` isolates the second. Only `/api/v2` exists.
- `alertname` belongs in `group_by`; high-cardinality labels do not. Omitting `group_by`
  gives one group for the whole system; `['...']` gives one group per alert.
- `group_wait` is the only timer that delays the first notification. `group_interval` gates
  notifications about a group that changed; `repeat_interval` nags about one that has not,
  rounded up to a multiple of `group_interval` — and then one tick more.
- A child route that does not match means the parent handles it, not that the alert was
  dropped; `continue: true` is the only way an alert reaches a second sibling.
- Matcher regexes are fully anchored: single-quote the matcher in YAML, double-quote the
  value inside.
- Every label in an inhibit rule's `equal` must exist on both sides; missing on both counts
  as equal. `location` defaults to UTC, and a range cannot wrap past midnight.
- Silences expire rather than being deleted, so a forgotten one fails open. `amtool config
  routes show`, `routes test`, `check-config` and `template render` all work against the
  file, offline: use them before you reload, not after.

## Exercises

!!! exercise
    **1. Four siblings, one `continue` (core).** Write a route tree with four child routes and
    exactly one `continue: true`. Before running anything, write down which receivers you
    expect for three label sets of your choosing. Check each prediction with
    `amtool config routes test`, then hand-POST all three and confirm the pager agrees. If they
    disagree, you reloaded one and not the other.

    **2. A matcher that cannot match (warm-up).** Write a matcher you expect to select
    `severity="warning"` and which does not, because of anchoring. Confirm it lands on
    `pager-default` with `amtool config routes test severity=warning`, plus
    `--alertmanager.url=http://localhost:9093`, without which `amtool` refuses to run. Then
    fix the matcher and confirm it lands where you meant.

    **3. Inhibit far too much (core).** Build an inhibit rule whose `equal` list names a label
    neither of two unrelated alerts carries — `datacenter`, say. Hand-POST both and confirm
    from `/api/v2/alerts` that the target reads `suppressed`. Then add that label to the
    target only, re-post, and watch it turn `active` again. Write the upstream CAUTION in your
    own words above the rule, then delete it. `cluster` would have been the wrong choice:
    every alert Prometheus dispatches carries it.

    **4. Out of hours, your way (stretch).** Write a *new* time interval called
    `out-of-hours-18` covering 18:00 to 09:00 on weekdays plus the whole weekend, in a named
    timezone. It cannot be one range — work out why first. Wire it to the ticket route, and
    confirm with `amtool check-config` that the file still validates and the receiver count
    has not moved. Revert the route afterwards, or `make verify-ch17` fails outside working
    hours.

    **5. Watch `.CommonLabels` collapse (core).** POST one alert carrying `severity="ticket"`,
    `instance="snip-api-1"` and a summary naming that instance, then read the pager's "Common
    to every alert here" line — `instance` is on it. POST a second into the *same* group with
    `instance="snip-api-2"` and a summary naming *that* one, wait a `group_interval`, and read
    the new notification's line. Write down what changed, annotations included, and what a
    template reading `.CommonLabels.instance` rendered before and after.

    **6. Collect all five reasons (core).** Fetch
    `http://localhost:5001/api/notifications` and read the `notification_reason` of every
    notification you caused here. For each of the five, name the timer that produced it and
    the action of yours behind it. Two take work: one you cause only by doing nothing for two
    minutes, and one needs a group of two where exactly one alert ends. Then name the one
    version-4 payload field that is not camelCase.
