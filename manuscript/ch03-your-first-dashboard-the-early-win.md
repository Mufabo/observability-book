# Chapter 3 — Your First Dashboard: The Early Win

Every question you have asked the lab so far has cost you a trip to the Prometheus Query page and
a retyped expression. That works when you already know what you are looking for. It is close to
useless when you do not — when a colleague messages you "is Snip broken?" and the honest answer is
"give me four minutes and six queries."

What you want instead is a wall. Three graphs, always there, always current, that between them
answer *how much traffic is there, how much of it is failing, and how slow is it*. That is the RED
shape from Chapter 1, "Ten Minutes to Your First Metric", and this chapter turns it into something
you can leave open on a second monitor.

You will get there without clicking through a setup wizard. Grafana arrives already configured,
from files in your repository — so the win survives `make reset`, and you can read your
monitoring setup in a diff instead of reconstructing it from memory. Along the way you will use
four pieces of PromQL you do not understand yet. That is deliberate, and a printed receipt names
the chapter that repays each one.

!!! objectives "Objectives"
    After this chapter you can:

    - Provision a Grafana data source and a dashboard entirely from files, with no UI clicks.
    - Build three panels that together are RED: request rate, error ratio, p95 latency.
    - Say why the data source URL is `http://prometheus:9090` and never `localhost`.
    - Say what `jsonData.timeInterval` is for, and why it must equal `global.scrape_interval`.
    - Cause a failure with the chaos API and watch a specific panel respond within two scrapes.
    - Name, from the printed IOU, the chapters that explain the queries you just used.

## Where the lab is

You are at the end of Chapter 2, "What's Actually on the Wire": `snip-api` and `snip-api-b` both
scraped, `loadgen` driving about twenty requests a second, Prometheus on
`http://localhost:9090`. If you need to rejoin:

```bash
cd lab
git checkout ch03
make up
```

That tag already contains the Grafana service and the three files this chapter adds, so you can
read them on disk as you go. The checkout matters: the repository's default branch is the finished
chapter-29 stack, with different services and different ports, and almost nothing printed here
answers the same way there.

## Grafana stores dashboards, not metrics

The single most useful thing to know about Grafana before you install it: **Grafana does not store
your metrics.** It has no time series database of its own. When a panel draws a line, Grafana's
backend has just made an HTTP request to Prometheus's query API, received a JSON blob of timestamps
and floats, and drawn it. Close the browser tab and nothing about that drawing is retained
anywhere.

What Grafana *does* store, in its own small database, is dashboards, users, folders, preferences
and other facts about itself. Your data lives in Prometheus. Grafana is a query client with a very
good renderer attached.

That one fact decides most of the rest of this chapter.

```text
┌─────────┐  dashboards  ┌──────────┐    PromQL    ┌────────────┐
│ browser │◀────────────▶│ Grafana  │◀────────────▶│ Prometheus │
│         │  and drawn   │  :3000   │  /api/v1/…   │   :9090    │
└─────────┘  results     └────┬─────┘              └─────┬──────┘
                              │ stores dashboards,       │ scrapes
                              │ users, folders           │ every 15s
                        ┌─────▼──────┐             ┌─────▼──────┐
                        │ grafanadata│             │  loadgen   │
                        │  (volume)  │             │   :8089    │
                        └────────────┘             └────────────┘
```

Read the two arrows leaving Grafana. Neither is a scrape. Grafana never talks to `loadgen` or to
`snip-api`; it only ever asks Prometheus, the only process in that picture holding a sample. That
is why a dashboard cannot show you anything Prometheus did not collect, and why "the graph is
empty" is almost never a Grafana problem.

It also explains why this chapter never asks you to click **Add data source**. Anything you
configure by clicking lives in the `grafanadata` volume, which `make reset` deletes. So everything
Grafana needs arrives as files on disk, read at startup.

!!! jargon "Provisioning"
    **Provisioning** is Grafana's word for configuring itself from files rather than from the UI or
    the HTTP API. At startup Grafana scans `/etc/grafana/provisioning/` and applies whatever it
    finds there: data sources, dashboard providers, alerting objects, plugin settings. Provisioned
    objects are recreated on every start, so they survive a deleted database — and they can be
    reviewed, diffed and reverted like any other code in your repository.

## Adding Grafana to the stack

One service, in `lab/compose.yaml`:

```yaml
  grafana:
    image: grafana/grafana:13.1.1
    restart: unless-stopped
    environment:
      GF_AUTH_ANONYMOUS_ENABLED: "true"
      GF_AUTH_ANONYMOUS_ORG_ROLE: Admin
      GF_USERS_DEFAULT_THEME: light
      GF_FEATURE_TOGGLES_ENABLE: ""
    ports:
      - "3000:3000"
    volumes:
      - ./provisioning:/etc/grafana/provisioning:ro
      - ./dashboards:/var/lib/grafana/dashboards:ro
      - grafanadata:/var/lib/grafana
    depends_on:
      prometheus:
        condition: service_started
    healthcheck:
      test: [CMD, wget, -q, -O, /dev/null,
             "http://localhost:3000/api/health"]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 30s
    networks: [obsnet]
    mem_limit: 512m
```

and the volume it names, beside `promdata` and `pgdata` at the bottom of the same file:

```yaml
volumes:
  grafanadata:
    name: grafanadata
```

Ten things in that block are worth a sentence each, and the two after them get a box.

`grafanadata` is a **named volume**, not a bind mount. The Grafana image runs as UID 472, and a
bind-mounted host directory on Linux is owned by you rather than by 472, which produces a container
that exits with a permission error on a path you never chose. A named volume side-steps that
entirely. Chapter 1 applied the same rule to `promdata`.

The two bind mounts are `:ro`. Grafana reads them and never writes to them, so read-only turns
"did Grafana just modify my repository?" into a non-question.

The mounts nest. `grafanadata` covers `/var/lib/grafana`, and `./dashboards` mounts *inside* it at
`/var/lib/grafana/dashboards`. Docker orders mounts by path depth, so the deeper one wins where
they overlap. That is why the `options.path` key in the provider file has to be exactly
`/var/lib/grafana/dashboards` and nothing shorter.

`depends_on` here is ordering, not a requirement — the condition is `service_started`, not
`service_healthy`. Grafana queries Prometheus lazily, when a panel asks, so if Prometheus is slow
to start the data source works a few seconds later. `GF_FEATURE_TOGGLES_ENABLE` is deliberately
empty: nothing here needs a feature toggle, and an empty variable says so more clearly than the
variable's absence would. `GF_USERS_DEFAULT_THEME: light` picks the theme a new visitor gets, so
that the colors you see match the ones described here.

The `healthcheck:` is the one Chapter 1 described and did not print, in Grafana's version: it asks
`/api/health` with `wget`, the tool this image happens to ship, and `start_period: 30s` is the
grace window before a failing probe counts against the container. That block is why `make ps`
prints `(healthy)` rather than a bare `Up`. `restart: unless-stopped` brings Grafana back after a
crash or a reboot but leaves it down if you stopped it on purpose. `mem_limit: 512m` caps the
container, so a query that goes wrong cannot take your laptop with it. `networks: [obsnet]` joins
the private Compose network every service here shares — the line the data source URL depends on.

The two anonymous-auth variables get the box.

!!! warning "Anonymous Admin is a lab setting"
    `GF_AUTH_ANONYMOUS_ENABLED=true` together with `GF_AUTH_ANONYMOUS_ORG_ROLE=Admin` means anyone
    who can reach port 3000 is an administrator of this Grafana, with no login at all. It exists
    here for one reason: so that the first time you open a dashboard in this book, there is no
    password screen between you and the graph.

    Grafana 13.1.1 logs `auth.anonymous.org_role is deprecated, only viewer role is supported` at
    every start. Admin still takes effect today — it is what lets you press **Save** later — but
    the setting is on its way out, which is one more reason not to build on it.

    It is correct for a lab bound to your laptop and wrong everywhere else. Any Grafana other
    people can reach gets real accounts. Chapter 25, "Storage, Retention, Backups and Locking the
    Door", comes back to this when it puts a reverse proxy and a password in front of Prometheus.

Bring it up:

```bash
make up
```

Then open `http://localhost:3000`. You land in Grafana with no login prompt. There is nothing on
the home page worth looking at yet — the interesting part is that the data source is already there,
and so is a dashboard.

## The data source, as a file

`lab/provisioning/datasources/prometheus.yaml`, with its comments stripped:

```yaml
apiVersion: 1

prune: true

datasources:
  - name: Prometheus
    type: prometheus
    uid: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
    jsonData:
      httpMethod: POST
      timeInterval: 15s
      queryTimeout: 60s
      prometheusType: Prometheus
      prometheusVersion: 3.13.1
      cacheLevel: Low
      manageAlerts: false
      disableRecordingRules: false
```

`apiVersion: 1` is the version of the *provisioning file format*. It has been `1` for years, it is
unrelated to every other `apiVersion` in Grafana, and there is nothing to modernize. `prune: true`
deletes provisioned data sources that later disappear from this file; without it, one you remove
lives on in the database forever.

`access: proxy` means Grafana's *backend* makes the query request. The browser talks only to
Grafana; Grafana talks to Prometheus. That is what makes the `url:` line correct.

`httpMethod: POST` sends each query in a request body instead of a URL, which starts to matter as
soon as an expression grows long enough to hit a URL-length limit. `queryTimeout: 60s` is how long
Grafana waits before giving up. `prometheusType` and `prometheusVersion` tell it which flavor and
release it is talking to, so the query editor offers only functions that exist here, and
`cacheLevel: Low` sets how hard its browser-side query cache tries. None of those four changes a
number you will see in this chapter.

The last two keys keep Grafana's own alerting and rule engine out of the way. `manageAlerts: false`
stops Grafana's alerting UI from writing rules back into this Prometheus. `disableRecordingRules`
is the one place to read carefully: `false` is Grafana's default and switches nothing off, so it is
here for the record and not as a lever. This lab's rules live in Prometheus, next to the PromQL,
from Chapter 15, "Recording Rules", onward.

### Why the URL is never localhost

`url: http://prometheus:9090` is the Compose service name, resolved on `obsnet` — the private
network every service in this stack joins, carried by the Compose file since Chapter 1 and first
seen named in Chapter 2's `networks: [obsnet]` line on `snip-api-b`. On that network Docker runs a
DNS server that resolves each service's name to its container. The URL is not
`http://localhost:9090`, even though that is the address you have been typing into your browser
all morning.

The reason is `access: proxy`. With it, the process opening the connection is Grafana's backend,
inside the Grafana container — where `localhost` is the Grafana container, and nothing is
listening on 9090.

!!! trap "The data source that points at localhost"
    Change the URL to `http://localhost:9090` and restart Grafana. Nothing fails at startup. The
    data source appears in the UI and looks configured. The failure arrives later, on the first
    panel that tries to draw:

    ```text
    Post "http://localhost:9090/api/v1/query_range": dial tcp
    [::1]:9090: connect: connection refused
    ```

    Every panel shows the same message and no data. The give-away is the address Grafana dialed:
    `[::1]` is the loopback address *of the Grafana container* — the IPv6 form here, sometimes
    `127.0.0.1` — which is correct from your browser and meaningless from inside a container. Put
    the service name back.

### uid, isDefault, editable

`uid: prometheus` pins the data source's identifier. Omit it and Grafana invents a random one the
first time it starts. That matters because every dashboard file in this repository refers to the
data source by uid:

```json
"datasource": { "type": "prometheus", "uid": "prometheus" }
```

With a random uid that reference breaks the moment you `make reset` — the dashboards come back, the
data source comes back, and every panel reads that its data source was not found, because the
string in the JSON no longer names anything. Pinning it costs one line and removes a whole category
of confusing Monday mornings. Exercise 2 has you delete it and watch.

`isDefault: true` makes this the data source pre-selected for new panels — a convenience in a lab
with one Prometheus, and a hazard in the chapters that add a second, which is why every panel
names its uid explicitly anyway.

`editable: false` makes the data source read-only in the UI. Configuration as code, enforced: to
change it you edit this file and restart Grafana. Dashboards go deliberately the other way, and
that is next.

### timeInterval, the setting that quietly decides everything

`timeInterval: 15s` is labeled **Scrape interval** in the Grafana UI, which is a slightly
misleading name — Grafana does not scrape anything. It is the number Grafana *assumes* your
Prometheus scrape interval to be, and Grafana has no way to discover it. You tell it, or it guesses
15 s and hopes.

It has to equal `global.scrape_interval` in `lab/prometheus/prometheus.yml`, which Chapter 1 set to
`15s`. The two numbers are written in two different files, by two different tools, and nothing
anywhere checks that they agree.

What it decides is the range window every `rate()` in every panel in this book is computed over.
Grafana exposes that window as the macro `$__rate_interval`, and the formula is:

```text
$__rate_interval = max($__interval + timeInterval, 4 * timeInterval)
```

The operative half is the right-hand term. Whatever window Grafana would otherwise have picked,
`$__rate_interval` is never shorter than four scrape intervals — 60 s here. That floor is the whole
point. A rate computed over a window that happens to contain one sample, or none, produces a graph
full of holes, and a reader zooming into a fifteen-minute range on a wide monitor gets there
easily.

Now put the wrong number in. Set `timeInterval` to `60s` while Prometheus still scrapes every 15 s,
and the floor becomes 240 s. Nothing errors, and the graphs still draw — smoothed over four minutes
instead of one, so a thirty-second failure you could have seen becomes a bump you cannot.
Exercise 1 makes you do this and write down what changed.

## The dashboard provider, and the mistake everyone makes

`lab/provisioning/dashboards/obslab.yaml`, again stripped of its comments:

```yaml
apiVersion: 1

providers:
  - name: obslab
    orgId: 1
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /var/lib/grafana/dashboards
      foldersFromFilesStructure: true
```

Read it again and notice what is *not* in it: a dashboard. This file does not contain one, and the
directory it lives in does not contain one either. It is a **provider** — a standing instruction
that says "there are dashboards in that directory over there; go and load them, and keep watching."

!!! pitfall "The single most common Grafana provisioning mistake"
    `lab/provisioning/dashboards/` holds **provider YAML**. The dashboard JSON lives wherever
    `options.path` points — here `/var/lib/grafana/dashboards`, which is the container-side path of
    the `./dashboards` bind mount.

    Put `snip-red.json` into `lab/provisioning/dashboards/` instead and Grafana starts perfectly
    happily. No crash, no warning in the UI, and no dashboard. Ask its API directly and you get a
    404 with three words in it:

    ```console
    $ curl -s localhost:3000/api/dashboards/uid/snip-red
    {"message":"Dashboard not found"}
    ```

    This chapter's check tells you the same thing in more words (the `FAIL` line is one long
    line, wrapped here):

    ```text
    FAIL the snip-red dashboard is provisioned — got Dashboard not
    found, want a dashboard at uid snip-red
         → provisioning/dashboards/obslab.yaml is the provider;
         → dashboards/snip-red.json is the dashboard. Two files,
         → two jobs, and only one of them is a dashboard.
    ```

    Two directories, two file formats, two jobs. Exercise 3 asks you to predict the symptom before
    you cause it.

The other keys earn their place too.

`updateIntervalSeconds: 10` is how often Grafana rescans the directory. Edit `snip-red.json` on
your laptop, wait ten seconds, refresh the browser, and the change is live. One caveat: the file
watcher compares modification times, and some editors — and some Docker Desktop bind mounts — do
not propagate those into the container reliably. If a saved edit has not appeared after fifteen
seconds, `docker compose restart grafana` always works. It is not a bug in Grafana or in your
JSON.

`allowUiUpdates: true` lets you click around in the browser, press **Save**, and have the change
persist to Grafana's database; the default `false` makes Save raise an error dialog instead. The
file on disk still wins, because the next time the provider re-reads a changed JSON file Grafana
overwrites the database copy with it. Chapter 13, "Dashboard Mechanics: Intervals, Panels and
Variables", turns that into the real workflow.

`disableDeletion: false` means a dashboard you delete from disk is deleted from Grafana as well.
`foldersFromFilesStructure: true` turns subdirectories under `path` into Grafana folders; this lab
keeps every dashboard flat, so they all land in the default folder, which Grafana's API calls
`General`.

## The dashboard file

`lab/dashboards/snip-red.json` is a plain Grafana dashboard object — the same shape the UI produces
when you export one. Its head:

```json
{
  "id": null,
  "uid": "snip-red",
  "title": "Snip RED",
  "tags": ["obslab", "snip", "red"],
  "timezone": "browser",
  "editable": true,
  "schemaVersion": 42,
  "version": 1,
  "refresh": "30s",
  "time": { "from": "now-1h", "to": "now" }
}
```

Everything after that is the `panels` array, which is where the rest of this chapter goes.

`"id": null` is required. `id` is Grafana's internal numeric key, handed out by its own database. A
provisioned file carrying a stale number from some other Grafana collides with whatever already
owns it here. Write `null` and let Grafana assign one.

`"uid": "snip-red"` is the dashboard's stable identifier, and it is why a URL can be printed for it:
`http://localhost:3000/d/snip-red`. That address works on your laptop and on mine, before and after
a reset, because the uid comes from the file rather than from a database sequence. Dashboard uids
must be between 8 and 40 characters; `snip-red` is exactly 8.

`"time"` sets the **time picker** — the control in the top right that decides which slice of
history every panel queries. `now-1h` to `now` is a rolling last hour. `"refresh": "30s"` re-runs
every query every thirty seconds, which is what makes the dashboard a live thing rather than a
snapshot. There is a floor: Grafana's `min_refresh_interval` defaults to 5 s and silently overrides
anything faster, so a dashboard asking for `1s` quietly gets 5 s.

`"schemaVersion": 42` is the schema Grafana 13.1.1 writes. Hand-write an older number and Grafana
migrates the file forward as it loads it — which is why printed dashboard JSON ages badly, and why
fragments are printed here and whole files are shipped.

## Three panels that are RED

Now the panels. RED, from Chapter 1: **R**ate, **E**rrors, **D**uration. Three questions, in the
order you would ask them.

Before the queries, one honest admission about which series they read.

Snip does not yet measure itself in any useful detail. The one counter it exports,
`snip_http_requests_total`, has no labels at all — you saw that on the wire in Chapter 2. It cannot
tell you which route was hit or what status code came back, and Snip has no latency metric
whatsoever. Chapter 5, "Your First Counter: Instrumenting Code You Own", is where you fix that, by
writing the instrumentation yourself.

But something in this stack already measures Snip: `loadgen`, which has been sending it traffic
since Chapter 1 and is instrumented properly. `loadgen_requests_total` carries `route`, `method`
and `code`; `loadgen_request_duration_seconds` is a latency histogram. Those are a *client's*
numbers — what a caller experiences, including the network in between — rather than what the
server believes happened, and for an early win that is a feature: a caller's view is the one your
users have. Chapter 5 moves these panels onto Snip's own series, and the first thing you notice
is that the two views disagree.

### Panel 1 — Rate

*How much traffic is there, and where is it going?*

```promql
sum by (route) (
  rate(loadgen_requests_total{job="loadgen"}[$__rate_interval])
)
```

A time series panel, legend `{{route}}`, unit `reqps` (requests per second). The **legend** is the
key under the graph naming each line; `{{route}}` fills it with that line's `route` label instead
of the whole series identity. The **unit** is what turns a bare number on the axis into `16 req/s`.

You should see six lines whose total sits near 19: the redirect path `/l/{code}` at about 16 a
second, `/links` and `/healthz` near 1 each, `/links/{code}` under 1, and a barely-visible trickle
on `/` and `other`. That is the fixed traffic mix — 80 % redirects, 10 % lookups, 5 % writes, 5 %
health checks — plus a simulated browser and a scanner knocking every thirty seconds, which is the
only reason the `/` and `other` route labels exist at all.

Two of those numbers do not match the mix, and the panel is right both times. `/links/{code}` is
10 % of what `loadgen` sends but draws at about 5 %, and the six lines add up to roughly 19 rather
than 20. Both have one cause: `GET /links/{code}` calls out to a service named `catalog` that is
not in the stack yet — it arrives in Chapter 4, "Metric Types Are Contracts" — so the call waits
out its two-second budget every time. Watch it against a link you create:

```bash
curl -s -XPOST localhost:8000/links -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/x"}'
```

Take the `code` from the answer and time the lookup:

```console
$ curl -s -o /dev/null -w '%{time_total}s\n' \
    localhost:8000/links/kZ2v87V
2.004356s
```

`loadgen` gives each request 2000 ms before it gives up, so roughly half of those lookups are
abandoned before a status code comes back — and a request with no status code is not one this
counter can count. It lands in `loadgen_request_failures_total` instead, labeled
`reason="timeout"`. Hence a missing request in twenty, and a route line at half its share.

That is worth noticing rather than fixing. You have owned this dashboard for five minutes and it
has already told you something true about the system that you did not type into it. Otherwise the
panel is a two-second read: total height is load, and a line that changes shape is a change in
what callers are doing.

### Panel 2 — Errors

*What fraction of that traffic is failing?*

```promql
sum(rate(loadgen_requests_total{job="loadgen",
  code=~"5.."}[$__rate_interval]))
/
sum(rate(loadgen_requests_total{job="loadgen"}[$__rate_interval]))
```

A time series panel, legend `5xx ratio`, unit `percentunit` — Grafana's *Percent (0.0–1.0)*, which
takes the zero-to-one number this expression produces and writes it on the axis as a percentage.

`code=~"5.."` is the regular-expression matcher from Chapter 2, and it is fully anchored, so it
selects exactly the three-character codes beginning with `5`. Server errors, not client mistakes.

Right now, on a lab that has never failed, this panel reads **No data**. That is not a typo on your
part. Nothing in the stack has returned a 5xx, so no series matching the top half of that
expression has ever been created, and a division with nothing on its left produces nothing. You are
about to make it exist.

The blankness is a real defect, and a nastier one than it looks: a panel that goes empty when the
service is healthy is indistinguishable from one that goes empty because monitoring broke.
Chapter 9, "Ratios, Arithmetic, and the Series That Isn't There", repairs it properly.

### Panel 3 — Duration

*How slow is it, for the unlucky?*

```promql
histogram_quantile(0.95, sum by (le) (
  rate(loadgen_request_duration_seconds_bucket{
    job="loadgen"}[$__rate_interval])
))
```

A time series panel, legend `p95`, unit `s` (seconds). It reads the 95th percentile: the latency
that 95 % of requests came in under. Not the average — an average latency of 40 ms is perfectly
compatible with one request in twenty taking four seconds, and it is the one in twenty that files
the support ticket.

On a busy, healthy lab this reads about ten milliseconds most of the time, and then, every minute
or two, leaps to somewhere between 0.05 s and 0.4 s for a refresh or two before dropping back.
Nothing is wrong when it does. The slow lookups from panel 1 sit right *at* 5 % of the traffic —
4.1 % one minute, 5.2 % the next — which is exactly the edge of what a 95th percentile can see.
Below 5 % the quantile is reading a fast request; above it, a slow one; and there is nothing in
between for it to land on. A flickering panel 3 is the healthy state here.

!!! iou "IOU — Chapters 6, 8, 10 and 13"
    You have just used four things you do not understand yet, and that is the plan. Copy them; they
    are correct.

    - `rate()` — what it computes, why a counter is useless without it, and the surprising
      arithmetic inside it: **Chapter 6**.
    - `sum by (…)` — aggregation, and the law about which order to do it in: **Chapter 8**.
    - `histogram_quantile`, the `_bucket` series and the `le` label: **Chapter 10**.
    - `$__rate_interval` in full — its sibling `$__interval`, Max data points, and the precedence
      chain behind the formula this chapter only states: **Chapter 13**.

    Every one is repaid in the chapter named, and the repayment is flagged in the text when it
    lands.

### What Grafana actually sends

`$__rate_interval` is a Grafana macro, not PromQL. Prometheus has never heard of it. Grafana
substitutes a real duration before the query leaves the building, and on this dashboard's default
one-hour range that duration is `1m`: the four-scrape floor wins. `timeInterval` is also the floor
under `$__interval`, so at an hour's range `$__interval` is 15 s or 30 s, `$__interval + 15s`
never reaches 60 s, and the `4 ×` term decides. The query Prometheus answers for panel 1 is:

```promql
sum by (route) (rate(loadgen_requests_total{job="loadgen"}[1m]))
```

Paste that into the Prometheus Query page and you get the same six numbers the panel is drawing.
Doing it once by hand is the fastest way to settle "is the panel wrong, or is the data wrong?"
The other two resolve the same way:

```promql
sum(rate(loadgen_requests_total{job="loadgen",code=~"5.."}[1m]))
/
sum(rate(loadgen_requests_total{job="loadgen"}[1m]))
```

```promql
histogram_quantile(0.95, sum by (le) (
  rate(loadgen_request_duration_seconds_bucket{job="loadgen"}[1m])
))
```

### Building them yourself

The repository ships `lab/dashboards/snip-red.json` finished, so if you would rather read than
click, open `http://localhost:3000/d/snip-red` and skip ahead. But the panel editor is worth
twenty minutes: build the three RED panels in the UI from the intent stated for each — query,
panel type, legend, unit — then **Export as code / JSON**, save the result over
`lab/dashboards/snip-red.json`, and commit it. Within ten seconds the provider reloads the file
and the browser is showing your own work.

Do not switch on **Share dashboard with another instance** when exporting. It replaces the data
source uid with a placeholder, and a placeholder is exactly what a provisioned file cannot
resolve.

## Make it move

A dashboard you have never seen break is a dashboard you do not trust. Break it.

`loadgen`'s control API has been running on port 8089 since Chapter 1. Every field is optional and
only the ones you send are changed:

```bash
curl -s -XPOST localhost:8089/control -d '{"error_ratio":0.25}'
```

It answers with the whole state, so you can always see what you actually did:

```json
{
  "rps": 20,
  "route": "mix",
  "error_ratio": 0.25,
  "extra_latency_ms": 0,
  "latency_ratio": 1,
  "db_delay_ms": 0,
  "cache_bypass": false,
  "cardinality_mode": false,
  "write_ratio": 0.05,
  "timeout_ms": 2000,
  "scenario": ""
}
```

Now watch panel 2. The first non-empty point appears after about thirty seconds — two scrapes,
not one, because the 5xx series did not exist until the first of them and a rate needs two samples
before it can be a rate. Within a minute or two the line settles. It does not settle at 0.25. It
settles near **0.23**.

Two things move it, and between them they are the reason ratios are harder than they look.

First, `loadgen` injects failures by stamping a header on outgoing requests, and only on the two
routes Snip is willing to fail: `GET /l/{code}` and `POST /links`, which are 85 % of the mix.
Health checks and lookups keep succeeding whatever you ask for. So the *service-wide* error ratio
is roughly 0.25 × 0.85, while on the redirect path alone it really is a quarter.

Second, the `/links/{code}` timeouts from panel 1 are removed from the bottom of this fraction
without being added to the top: a request that never got a status code is in neither half. The
denominator is therefore about 19 rather than 20, the failing routes are a larger share of what is
left than 85 %, and the ratio lands a little above the 0.21 the first calculation predicts.

This is the first time in the book a panel disagrees with the number you typed and is still right.
A ratio is only as meaningful as the denominator you chose: scoped to one route this expression
reads 0.25, scoped to everything the service does it reads about 0.23. Chapter 20, "SLIs, SLOs
and Error Budgets", turns that into a rule about what belongs in a denominator. For now, notice
that "the dashboard says 23 %" and "a quarter of redirects are failing" describe the same
outage.

Now the third panel. Reset first, so you are changing one thing:

```bash
curl -s -XPOST localhost:8089/chaos/reset
curl -s -XPOST localhost:8089/control -d '{"extra_latency_ms":400}'
```

Watch panel 2 while you send that first line. It does **not** go blank again — it drops to a
flat line at zero, and that difference is the most useful thing in this section.

The delay header goes on three routes rather than two — the two failable routes plus
`GET /links/{code}` — which is 95 % of the mix, so almost everything now takes 400 ms longer. Panel
3 climbs within one scrape and settles just under **0.5 s**: about 0.49. What tells you this is an
injection rather than one of the flickers is that it stops moving. Refresh after refresh it reads
0.49 again; the healthy panel never holds still like that.

Not 0.4 s. The p95 comes out of a histogram whose bucket boundaries are fixed in advance, and
every delayed request now lands between the same two of them, so the honest answer the histogram
can give is a band rather than a point. The measurement is not lying to you; it has a resolution,
and you are looking straight at it. Chapter 10, "Latency: Histograms Without Tears", is where
that stops being a curiosity and becomes a design decision you make on purpose.

Notice what panel 2 did while panel 3 climbed: nothing. Slow is not broken, they have separate
panels, and an incident where only one moves is a different incident from one where both do. That
is the whole argument for RED being three numbers rather than one health check.

Put it back:

```bash
curl -s -XPOST localhost:8089/chaos/reset
```

Panel 3 falls back to milliseconds within a minute or two. Panel 2 stays where the first reset
left it, flat at zero.

Be clear about why that zero is not a blank. Before your first injected failure no series matched
`code=~"5.."` — that label combination had never occurred, so there was nothing to divide. Now
`loadgen_requests_total{code="500", route="/l/{code}", …}` exists, frozen at whatever value it
reached, and `loadgen` republishes it on every scrape. A rate over a counter that has stopped
moving is zero, and zero is a number. "No data" was never the healthy state; it was the
never-happened state — the distinction Chapter 9 repairs.

### Reading it back

Leave the dashboard on the last hour and look at the shape rather than the value. You can now
point at the minute the errors started and the minute they stopped, to within one scrape. In
Chapter 1 you could not have answered "when did it start?" at all.

| Panel | Healthy | Under `error_ratio: 0.25` |
|---|---|---|
| Request rate by route | six lines totalling ≈ 19/s | unchanged |
| Error ratio (5xx / all) | No data until the first 5xx ever; flat 0 after | ≈ 0.23, flat |
| p95 latency | ≈ 10 ms, flicking to 0.05–0.4 s | unchanged |

Under `extra_latency_ms: 400` instead: panel 1 unchanged, panel 2 back to zero, panel 3 just under
0.5 s.

!!! selfcheck "Self-check"
    Run the chapter's check:

    ```bash
    make verify-ch03
    ```

    It reads the dashboard back out of Grafana's API, pulls the query from each panel, substitutes
    the macros, and runs the result against Prometheus. It must end:

    ```text
    ch03: 5 passed, 0 failed
    ch03 OK
    ```

    Five: one for Grafana's health, one for the dashboard existing, and one per panel. If you have
    not yet run the error injection at least once since the last `make reset`, panel 2's query
    returns no series and that assertion fails — correctly, and for the reason panel 2's blankness
    gave: the numerator has never existed. Inject errors once and re-run.

    If you open the script you will find it substitutes `[5m]` where the dashboard resolves
    `$__rate_interval` to `[1m]`. Both are right: the panel prints what Grafana really sends, and
    the script wants a window wide enough to pass on a stack that has been up for a minute.

    The script needs `curl` and `jq`. `jq` is the one that is usually missing.

## Why an idle service teaches nothing

One last thing, and it is the reason `loadgen` shipped in Chapter 1 rather than in Chapter 17,
"Alertmanager: Routing, Grouping and Silence".

Turn the traffic off — `curl -s -XPOST localhost:8089/control -d '{"rps":0}'` — and look at the
dashboard for five minutes. Panel 1 drops to zero and stays there. Panels 2 and 3 empty out
entirely, and for the same reason: every counter has stopped moving, so every `rate()` in both
expressions is zero. A quantile of an all-zero histogram is `NaN`, and so is zero divided by zero.
A time series panel draws `NaN` as a gap.

Three panels, none of them moving, and nothing in that picture tells you whether Snip is healthy,
wedged, or gone. The panels are fine. The system under them stopped generating evidence.

That is the difference between a monitoring setup that works and one that has merely been
installed, and it is why every chapter here ends with something moving. A dashboard renders the
questions your service is currently answering, and a service nobody asks anything of answers
nothing. Turn the traffic back on with `chaos/reset` before you continue.

## Common mistakes

**Dashboard JSON in `lab/provisioning/dashboards/`.** That directory holds provider YAML; the JSON
goes wherever `options.path` points. Symptom: Grafana starts cleanly and no dashboard exists.
Check this first whenever a provisioned dashboard fails to appear — there is no error message in
the UI to lead you there.

**`url: http://localhost:9090` in the data source.** Symptom: every panel shows a connection
refused against a loopback address. With `access: proxy` the request comes from inside the
container. Use the Compose service name.

**No `uid` on the data source.** Symptom: everything works until the first `make reset`, after
which every panel reports that its data source was not found. Grafana generated a new random uid;
the dashboards still name the old one. Pin the uid.

**A non-null `"id"` in the dashboard file.** Usually arrives by copying a dashboard out of another
Grafana. Symptom: a provisioning error and no dashboard, or a dashboard that overwrites an
unrelated one. Set `"id": null` and keep the `uid`.

**A dashboard exported for another instance.** Symptom: every panel reports a missing data source
whose name looks like `${DS_PROMETHEUS}`. The export switch replaced your uid with a placeholder
that only the import wizard knows how to fill in. Export without it, or replace the placeholder
with `prometheus` before you commit the file.

**`timeInterval` that does not match `global.scrape_interval`.** Symptom: nothing at all. No
error, no warning, no missing panel — just rate graphs computed over the wrong window, reading
"quieter than reality" if the value is too high and "gappy" if it is too low. The only defense is
knowing the setting exists, which you now do.

!!! trap "The mistake with no error message"
    Set `timeInterval: 60s` in the data source, leave Prometheus scraping every 15 s, and restart
    Grafana. Then run the error injection for ninety seconds and reset it. Panel 2 shows a low,
    rounded bump instead of a square step, and its peak sits well below 0.23.

    Nothing is broken. Grafana asked for a rate over four minutes because you told it the scrape
    interval was a minute, and a ninety-second event averaged over four minutes is a small bump.
    Every graph on the dashboard is now quietly understating every short event, and there is no
    error anywhere to find. Put it back to `15s` and run the injection again to watch the square
    step return.

## Summary

Grafana is a query client. It stores dashboards and users and not one metric sample; every line it
draws is a fresh PromQL query against Prometheus, made by Grafana's backend rather than by your
browser. That single fact decides the data source URL, explains why an empty panel is almost never
Grafana's fault, and is why this chapter configured everything from files instead of clicking.

You now have three panels that answer the three RED questions against real traffic, you have
broken the service on purpose twice and watched exactly one panel respond each time, and the
arrangement survives `make reset` because it lives in your repository. You also have two
observations you did not go looking for: a route slowed by a dependency that does not exist yet,
and a panel whose emptiness meant something other than health.

The durable takeaways:

- Grafana queries; Prometheus stores. There is no Grafana copy of your data.
- `lab/provisioning/dashboards/` holds provider YAML. Dashboard JSON lives at `options.path`.
- With `access: proxy`, the data source URL is resolved from inside the Grafana container — so it
  is the service name, never `localhost`.
- Pin `uid` on data sources and on dashboards, and write `"id": null`. Unpinned identifiers break
  on the first rebuild, and a pinned dashboard uid is what makes `/d/snip-red` a printable
  address.
- `jsonData.timeInterval` must equal `global.scrape_interval`. It is the hidden term inside
  `$__rate_interval`, and getting it wrong produces graphs that are wrong without being broken.
- A ratio is only as meaningful as its denominator. 23 % service-wide and 25 % on one route were
  the same outage.
- An empty panel means a series that has never existed. A flat zero means one that exists and is
  not moving. They look similar and mean opposite things.
- A dashboard of an idle service is a picture of nothing. Keep traffic flowing.

## Exercises

!!! exercise
    **1. The setting with no error message (core).** Set
    `jsonData.timeInterval` to `"60s"` in
    `lab/provisioning/datasources/prometheus.yaml` while Prometheus still
    scrapes every 15 s, and restart Grafana. Run `{"error_ratio":0.25}` for
    ninety seconds, then reset. Compare the shape and the peak of panel 2
    against what you saw earlier in this chapter, and write both down. Put
    `15s` back. You will understand exactly why in Chapter 13; record the
    observation now.

    **2. Unpin the identifier (core).** Delete the `uid: prometheus` line
    from the data source file, then `make reset && make up`. Report what
    every panel now says, and explain in one sentence why a printed book has
    a harder version of this problem than a lab does.

    **3. The wrong directory (warm-up).** Predict in writing what you will
    see, then move `lab/dashboards/snip-red.json` into
    `lab/provisioning/dashboards/` and restart Grafana. Check your
    prediction against `curl -s localhost:3000/api/dashboards/uid/snip-red`
    and against `make verify-ch03`. Move it back.

    **4. A fourth panel (core).** Add a panel driven by
    `up{job="snip-api"}`. You should get two series, one per replica, both
    reading 1. Choose between a time series panel like the three you already
    have and a **Stat** panel, which shows one current number per series
    instead of a line, and defend the choice in one sentence. Then stop one
    replica with `docker compose stop snip-api-b` and say whether it still
    reads well. Start it again after.

    **5. The idle dashboard (warm-up).** Set `{"rps":0}` and leave the
    dashboard open for five minutes. Write one sentence on what a dashboard
    of an idle service is worth, and one on what you would have to add to
    make silence itself visible. Reset the injector.

    **6. Prove the substitution (stretch).** Change the time picker to the
    last 6 hours, then open the panel menu's **Inspect › Query** and read
    the range window Grafana actually sent. You should find it is still
    `[60000ms]` — the same `1m` as at one hour, because the four-scrape
    floor is still winning. Chapter 13 walks the precedence chain that
    decides when it stops. Solutions are in the solutions appendix.
