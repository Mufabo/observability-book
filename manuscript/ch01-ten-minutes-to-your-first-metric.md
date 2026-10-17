# Chapter 1 — Ten Minutes to Your First Metric

Something is wrong with the service you shipped last week. A colleague says
it "felt slow this morning." You open a terminal, tail the log, and watch
lines scroll past at a rate no human can read. The log tells you what
happened to individual requests. It does not tell you how many requests
there were, what fraction of them failed, or whether this morning was
different from yesterday morning. You cannot answer *since when*, and you
cannot answer *how much*, because nothing in your system has been counting.

Monitoring is not a product you install. It is the practice of being able
to ask a running system a question and get a numeric answer, including
questions you had not thought of when you wrote the code. That practice
needs three pieces: a program that counts things, a second program that
collects those counts on a timer and keeps the history, and a place to ask
questions of the history. All three will be running on your machine by the
end of this chapter, and the remaining twenty-eight chapters are built on top
of them without throwing any of it away.

So: no definitions yet. Start the stack, look at what is on the screen, and
let the vocabulary attach itself to things you can point at.

!!! objectives "Objectives"
    After this chapter you can:

    - Run the Snip stack and confirm Prometheus is scraping three targets.
    - Read a `/metrics` endpoint and say what one line of it means.
    - Define *metric*, *label*, *sample*, *series* and *scrape* by pointing
      at something on your own screen.
    - Run three queries in the Prometheus Query page and switch between the
      Table, Graph and Explain tabs.
    - Say why Prometheus connects to your service rather than the reverse,
      and what that arrangement gives you for free.
    - Work the first four rungs of the No-Data debugging ladder.

## What you are about to run

The lab is one git repository called `obslab`. It contains **Snip**, a URL
shortener: you post a long URL to it, it gives you back a short code, and
visiting `/l/{code}` redirects you. Snip is small enough to read in one
sitting and rich enough to produce every shape of measurement you are going
to need — a hot read path, a write path, a cache, a database, and a set of
switches that make it misbehave on purpose.

Snip is written in Go, and it is **yours**. You start editing it in Chapter
5, "Your First Counter: Instrumenting Code You Own", and keep editing it for
most of the book. That matters more than it sounds: most monitoring
tutorials hand you somebody else's prewritten service and ask you to admire
it. Here, the code producing the numbers is code you can change.

Five containers start in this chapter.

| Service | Host port | What it is |
|---|---|---|
| `snip-api` | 8000 | Snip itself — the service you own |
| `loadgen` | 8089 | Traffic driver, and a measured service too |
| `postgres` | 5432 | Snip's store |
| `valkey` | 6379 | Snip's cache |
| `prometheus` | 9090 | The thing that collects and answers questions |

Postgres and Valkey are plumbing from day one, deliberately: later chapters
teach you to monitor a database and a cache without rewriting your
application first to make the lesson interesting. Valkey is the BSD-licensed
fork of Redis, speaks the same protocol, and everything said later about
monitoring Redis applies to it unchanged.

`loadgen` is the piece most labs leave out. It drives about twenty requests
per second at Snip from the moment the stack starts, so every graph in this
book has something moving in it. A flat line teaches nothing.

Every image the book is actually about is pinned to an exact version —
`quay.io/prometheus/prometheus:v3.13.1`, never `:latest`. The plumbing —
Postgres, Valkey and the language base images — is pinned to a major line
(`postgres:18-alpine`) instead, because a base-image patch pin goes stale
within a quarter; Appendix A prints each resolved digest and the date it was
verified. The Prometheus project publishes to Docker Hub as well, but this
lab takes every Prometheus-org image from Quay, so there is one
image-registry rule to remember instead of five. Prometheus also publishes a
Long Term Support line; check prometheus.io/download for the current one.
This lab runs the latest release.

## Start the stack

You need Docker with Compose v2, GNU make, `curl`, `jq`, a shell, about 3 GB
of free memory for the chapters ahead — the full stack later wants about 6 GB
— and about 10 GB of disk. `jq` is the one people are missing: it is not
installed by default on macOS, on a minimal Debian image, or in Git Bash on
Windows.

Clone the lab repository — the address is in the front matter — and then
check out this chapter's tag. Every chapter is a git tag, `ch01` through
`ch29`, and every tag is a complete working state, which is also your escape
hatch if you break something beyond repair.

```bash
cd obslab
git checkout ch01
make pull
```

The checkout is not optional. The repository's default branch is the
*finished* chapter-29 stack: three times as many services, different ports,
different URLs. `make up` refuses to run there and tells you what to do
instead.

`make pull` fetches every pinned image and builds the two Go services. It is
the slow step and it needs the internet; after it finishes you can work
through the whole Compose lab offline. Two exceptions, one printed by the
command itself: Chapter 27, "Optional: What Changes on Kubernetes", fetches a
Helm chart, and one flagged exercise in Chapter 23, "The Multi-Target
Pattern: Probing From Outside", probes a public host.

Now the two commands you will type most:

```bash
make check
make up
```

`make check` is static validation. It parses `compose.yaml`, runs
`promtool check config` over the Prometheus configuration — `promtool` is
the configuration checker that ships inside the Prometheus image — and
confirms that every file the compose file wants to mount exists on disk. It
starts nothing, but it does need that image already pulled, because the
checker lives inside it. Run it before every `make up`: a typo caught in two
seconds is a typo you do not chase through container logs for twenty
minutes.

`make up` builds and starts everything in the background. The first run
takes a minute or two. Then:

```bash
make ps
```

You should see five containers, named `obslab-snip-api-1`,
`obslab-loadgen-1` and so on, each with a status beginning `Up`. The three
that carry a health check — `postgres`, `valkey` and `prometheus` — also
read `(healthy)` once they have settled. If `snip-api` has not appeared in
`make ps` yet, it is waiting for Postgres to report healthy and has not been
started at all; give it another thirty seconds, then read
`make logs S=snip-api`.

Confirm the two things that matter:

```console
$ curl -sf -o /dev/null -w '%{http_code}\n' \
    http://localhost:9090/-/healthy
200
$ curl -s http://localhost:8000/healthz
{"status":"ok"}
```

Two processes are alive: Prometheus on 9090, your service on 8000.

## Make it do something

Open <http://localhost:8000/> in a browser. Snip serves one page: a box for
a long URL, a box for a lifetime in seconds, and a Shorten button. Paste
something — `https://prometheus.io/docs/` will do — and press it. You get
back a short code and a link. Follow the link and your browser lands on the
site you shortened. The footer links to `/metrics` and `/healthz`; both
matter shortly.

You are now the first user of a service you are about to measure. The same
thing on the command line, if you prefer to watch the wire:

```console
$ curl -s -X POST http://localhost:8000/links \
    -H 'Content-Type: application/json' \
    -d '{"url":"https://prometheus.io/docs/"}' | jq
{
  "code": "Kq7bT2m",
  "expires_at": "2026-08-01T09:34:11.482731Z",
  "short_path": "/l/Kq7bT2m",
  "url": "https://prometheus.io/docs/"
}
$ curl -s -o /dev/null \
    -w '%{http_code} %{redirect_url}\n' \
    http://localhost:8000/l/Kq7bT2m
302 https://prometheus.io/docs/
```

Your code will differ; they are random. Links get a ten-minute lifetime when
you do not ask for one, so the lab always has links expiring somewhere.

Meanwhile `loadgen` has been hammering Snip since the stack came up. It has a
small HTTP API for changing what it does; read its current settings:

```console
$ curl -s http://localhost:8089/control | jq
{
  "rps": 20,
  "route": "mix",
  "error_ratio": 0,
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

Twenty requests a second, no injected errors, no injected delay. Later
chapters turn those knobs to summon specific failures on demand. Leave them
alone for now.

## The endpoint Prometheus reads

Here is the part that surprises people. Snip does not send its measurements
anywhere. It publishes them at an ordinary HTTP endpoint and waits.

```console
$ curl -s localhost:8000/metrics | head -40
# HELP go_gc_duration_seconds A summary of the wall-time pause
#   (compute-bound) duration of garbage collection cycles.
# TYPE go_gc_duration_seconds summary
go_gc_duration_seconds{quantile="0"} 3.6708e-05
go_gc_duration_seconds{quantile="0.25"} 6.2417e-05
go_gc_duration_seconds{quantile="0.5"} 9.2833e-05
go_gc_duration_seconds{quantile="0.75"} 0.000131875
go_gc_duration_seconds{quantile="1"} 0.000724458
go_gc_duration_seconds_sum 0.021475916
go_gc_duration_seconds_count 214
... thirty-one more lines in the same vein ...
```

(That first description is one long line in the real output; it is wrapped
here to fit the column. Nothing else is wrapped without saying so.)

Forty lines and not one of them is about URL shortening. Every one describes
the Go runtime — garbage-collection pauses, goroutine counts, memory and
thread statistics. Nobody asked for them. They arrive because Snip's
instrumentation library ships them switched on, and Chapter 4, "Metric Types
Are Contracts", has something to say about the pile of numbers you did not
choose. What you actually came for is further down:

```bash
curl -s localhost:8000/metrics | grep snip_http
```

```text
# HELP snip_http_requests_total Total HTTP requests handled by the Snip API.
# TYPE snip_http_requests_total counter
snip_http_requests_total 41827
```

Three lines, and the last one is the whole idea. Take it apart.

`snip_http_requests_total` is a **metric name**: a stable identifier for one
thing you have decided to measure. It obeys a convention enforced everywhere
that follows — an application prefix (`snip_`), snake case, and the suffix
`_total` on a running total.

`41827` is the current value. Yours will differ, because it depends entirely
on how long the stack has been up: at twenty requests a second it climbs by
about 1,200 every minute. It is not a rate, an average or a percentage. It is
the number of HTTP requests this process has handled since it started, and
the only thing that ever happens to it is that it goes up. That is a design
decision, and chapter 4 explains what the word `counter` on the `# TYPE` line
commits you to. Chapter 2, "What's Actually on the Wire", takes this text
format apart line by line. For now: `# HELP` is a human-readable description,
`# TYPE` is metadata, and the third line is the measurement.

Notice what is *missing*. No timestamp. No history. Reload the page and the
number is bigger, but the previous value is gone forever — Snip has no memory
of it. `/metrics` is a snapshot of right now, and building a history out of a
stream of snapshots is somebody else's job.

!!! jargon "Sample"
    A **sample** is one measurement at one instant: a 64-bit floating-point
    value plus a millisecond timestamp. `/metrics` gives you the value;
    Prometheus supplies the timestamp when it reads the page and stores the
    pair. Everything you query in this book is made of samples.

## Prometheus fetched that, on a timer

Prometheus's whole job in this chapter is to fetch that page, over and over,
and remember what it saw. Its entire configuration at this point is
`prometheus/prometheus.yml`, at the root of the repository you cloned:

```yaml
global:
  scrape_interval: 15s
  scrape_timeout: 10s

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ["localhost:9090"]
        labels:
          env: lab

  - job_name: snip-api
    static_configs:
      - targets: ["snip-api:8000"]
        labels:
          env: lab

  - job_name: loadgen
    static_configs:
      - targets: ["loadgen:8089"]
        labels:
          env: lab
```

`scrape_interval: 15s` says: fetch every page listed under `scrape_configs`
once every fifteen seconds. That is the resolution of everything you will
ever see. A spike that begins and ends between two fetches did not happen, as
far as Prometheus is concerned. Fifteen seconds is a common default and the
number this lab uses everywhere; `scrape_timeout: 10s` is how long one fetch
may take before it is abandoned.

A **scrape** is one such fetch: an HTTP GET, a parse, and a write. A
**target** is one address to scrape. `static_configs` is the simplest way to
list targets — you type them in — and it is the only one you need until
Chapter 12, "`prometheus.yml` in Full: Service Discovery and Relabeling",
replaces every one of these blocks with automatic discovery.

The addresses are container names, not `localhost`. Prometheus dials
`snip-api:8000` across the Compose network the same way any other container
would. `localhost:9090` is the exception, and it means what it says: the
Prometheus container scraping itself. That is not vanity — a monitoring
system that cannot report on its own health is one you have to monitor with
something else.

`env: lab` is a **label** you are attaching by hand to everything these
targets produce. It costs nothing here and earns its place in chapter 12,
against a similar-looking setting that behaves completely differently.

Here is the whole arrangement:

```text
┌──────────┐  GET /metrics   ┌────────────┐
│ snip-api │◀────────────────│            │
│  :8000   │   every 15 s    │            │
└──────────┘                 │            │       ┌──────────┐
     ▲                       │ Prometheus │──────▶│ promdata │
     │ ~20 req/s             │   :9090    │ write │ (volume) │
     │                       │            │       └──────────┘
┌──────────┐  GET /metrics   │            │
│ loadgen  │◀────────────────│            │
│  :8089   │   every 15 s    └────────────┘
└──────────┘                       ▲ │
                                   └─┘  and itself
```

Every arrow into a `/metrics` endpoint is Prometheus making an outbound HTTP
request, and none of them points the other way. That is the single most
important structural fact in this chapter. The only traffic Snip receives
that it did not wait for is loadgen's, and that is application traffic, not
measurement.

Two things about that picture will cost you an evening if you get them wrong.

!!! trap "`command:` replaces the image's arguments — it does not add to them"
    The Prometheus image's entrypoint is the server binary; its default
    arguments — `--config.file` and `--storage.tsdb.path` — live in the
    image's `CMD`. Write a `command:` key in `compose.yaml` and **all** of
    them are replaced by yours. Add one innocent flag:

    ```yaml
      prometheus:
        image: quay.io/prometheus/prometheus:v3.13.1
        command:
          - --log.level=debug
    ```

    …and the container starts, exits, and restarts forever. `docker compose
    logs prometheus` ends like this:

    ```text
    time=2026-08-01T09:41:02.331Z level=ERROR
      msg="Error loading config (--config.file=prometheus.yml)"
      err="open prometheus.yml: no such file or directory"
    ```

    (One line in the real output, wrapped here, with the `source=` field
    elided.) The tell is that the error names a path you never typed. You
    mounted your config at `/etc/prometheus/prometheus.yml`; Prometheus is
    looking for a bare `prometheus.yml`, the built-in default of a flag that
    was thrown away with the rest. The lab's rule, obeyed in every chapter:
    if a service has a `command:` block at all, every flag it needs is
    written out in full — and you change that block by editing the flags in
    it, never by adding a second `command:` key.

The lab's `prometheus` service therefore restates both defaults, even though
nothing has been added yet:

```yaml
  prometheus:
    image: quay.io/prometheus/prometheus:v3.13.1
    restart: unless-stopped
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.path=/prometheus
    volumes:
      - ./prometheus:/etc/prometheus:ro
      - promdata:/prometheus
    ports:
      - "9090:9090"
```

`--storage.tsdb.path=/prometheus` is where the time-series database — the
**TSDB**, Prometheus's on-disk store — writes. The real service also names
its network, a memory limit, and the health check that makes `make ps` print
`(healthy)`: `promtool check healthy`, run out of the same image. None of the
three changes anything yet.

!!! warning "Never bind-mount the Prometheus data directory"
    `promdata` is a **named volume**, not `./promdata:/prometheus`, and it
    never will be. Prometheus's own documentation is blunt: non-POSIX
    filesystems are not supported for local storage, unrecoverable corruption
    may happen, and NFS — including AWS EFS — is named specifically. The
    translation layer Docker Desktop puts between a macOS or Windows host and
    its Linux VM is exactly that kind of almost-POSIX surface. There is a
    duller second reason: the image runs as `nobody`, and a directory created
    on your host usually is not writable by it. Config is bind-mounted
    read-only because it is text you edit; state goes in a volume. If you do
    corrupt the store, `make reset` removes the containers and the volumes
    and you start clean.

Now look at what all this produced. Open <http://localhost:9090/targets>.

You get one section per job. Each row shows the endpoint URL, a **State**
column reading **UP**, the labels attached to that target, how long ago the
last scrape happened and how long it took, and — since Prometheus 3.7 — the
scrape interval and timeout in force for that target. All three jobs
(`prometheus`, `snip-api`, `loadgen`) should read UP, with a Last Scrape
under fifteen seconds and a Scrape Duration in the single-digit
milliseconds. There is an Error column on the right: empty on a healthy
target, and the first place to look when one is not.

Watch the page for half a minute. The Last Scrape values reset to zero every
fifteen seconds, one job at a time. That is the pull model, happening.

## Your first three queries

Open <http://localhost:9090/query>. This is the Query page. Prometheus 3
replaced the old web interface wholesale, so any tutorial showing a plain
grey page with a *Graph* link in the top bar is describing something you no
longer have.

Type `up` into the expression box and press Enter.

```promql
up
```

The Table tab shows three rows:

```text
up{env="lab", instance="localhost:9090", job="prometheus"}   1
up{env="lab", instance="loadgen:8089", job="loadgen"}        1
up{env="lab", instance="snip-api:8000", job="snip-api"}      1
```

Stop and read those rows carefully: four terms are sitting in front of you,
much easier to learn here than from a definition.

`up` is the **metric name**. All three rows share it.

Everything inside the braces is a set of **labels** — key/value pairs that
distinguish one row from another. Nothing else does. Two rows with the same
name and the same labels are the same thing.

Each row is a **time series**: one metric name plus one specific set of
labels, tracked through time. Three rows means three series. The single
number on the right is the most recent **sample** of that series — its value
at the instant you pressed Enter.

And `up` itself is remarkable, because no service in your stack produces it.
Snip does not export `up`. Prometheus writes one `up` sample per target per
scrape: `1` if the scrape succeeded, `0` if it did not. Liveness monitoring
for every target you will ever add, at no cost and with no code, because the
side that makes the connection is the side that knows whether it worked.

Look at the two labels you did not write, either. `job` is the `job_name`
from the scrape configuration. `instance` is the address that was scraped.
Both are attached by Prometheus at scrape time to every series from that
target, not only to `up`. Your application code does not emit them and must
never try to.

Now filter, by putting a label inside braces:

```promql
up{job="snip-api"}
```

One row. That is how you narrow a result: name the metric, then constrain its
labels. Chapter 2 gives you the full grammar, including how to match on
patterns rather than exact values, and from there on almost every expression
that follows carries a `{job="..."}` for reasons that come into focus there.

Now switch to the **Explain** tab, beside Table and Graph, with that same
expression in the box. It describes the expression node by node in plain
English: this one is an instant-vector selector, it matches the metric name
`up`, and it applies one label matcher, `job="snip-api"`. Nothing new — which
is the point of meeting the tab on an expression you already understand. When
one stops making sense in Chapter 9, "Ratios, Arithmetic, and the Series That
Isn't There", it is faster than re-reading the chapter.

Third query — your own measurement, no functions, nothing clever:

```promql
snip_http_requests_total
```

The Table tab gives you a single row and a number in the tens of thousands.
Switch to the **Graph** tab and set the range to fifteen minutes. You get a
line that climbs steadily from lower left to upper right and never dips,
because `loadgen` has been sending twenty requests a second the whole time
and the value only ever increases. It is not a beautiful graph. It is the
first graph drawn from your own service, and it is honest.

Two more things on this page are worth knowing now.

The **Metrics Explorer** — the button beside the expression input — lists
every metric name Prometheus currently knows about, with its description.
Use it whenever you are not sure a name exists. Guessing metric names is the
most common way to produce an empty result.

The **Tree view** renders your expression as a tree and shows what each part
evaluates to. On `up` it is unexciting; from Chapter 6, "`rate()`,
`increase()`, and Why Nothing Is a Whole Number", onward, when expressions
grow three levels deep, it is the best debugging tool in the product.

## Why Prometheus connects to you

You have watched the mechanism twice, so the name will stick. Prometheus uses
a **pull model**: it opens the connection, on its own schedule, to targets it
was told about. The alternative — services pushing measurements outward to a
collection service — is what several competitors do.

Pulling buys you four things.

You get liveness for free. `up` exists because somebody had to make the
connection and can report whether it worked. In a push system a service that
has stopped sending is indistinguishable from a service with nothing to say.

You get a list of what *should* exist. The scrape configuration enumerates
the targets, so a target that vanishes is visible as an absence. A push
system knows only about senders that showed up.

You can reproduce any scrape by hand. `curl -s localhost:8000/metrics` is
exactly what Prometheus does, byte for byte. There is no agent, no queue and
no private protocol between you and the data — which is why the debugging
ladder that closes this chapter works at all.

And the request rate is set by Prometheus, not by the fleet. A service under
stress does not also flood a collection pipeline, because Prometheus asks at
its own pace and gives up on a target too slow to answer.

Now the honest part, which the Prometheus FAQ supplies itself: none of that
is decisive. These are properties that suit the way this system is built, not
a proof that pull wins, and there are real limits. A batch job that runs for
nine seconds and exits has no page to scrape. A service behind a firewall
that permits only outbound traffic cannot be reached. Both have answers, and
neither answer is "give up and push everything" — Chapter 22, "Metrics From
Things You Didn't Write", names the tool for short-lived jobs and is honest
about why it is discouraged here.

## What is worth measuring

You have one metric. Which ones should you add?

**RED** is the spine: for every request-serving thing you own, measure
**Rate** (the number of requests per second), **Errors** (the number of those
requests that are failing), and **Duration** (the amount of time those
requests take). Tom Wilkie named it in 2015, on the grounds that the existing
checklists described hardware rather than services. Three questions, and they
are enough to describe the health of an HTTP service to a person who has
never seen it.

`snip_http_requests_total` is already the raw material for Rate. In chapter 5
you add labels to it so that the same counter answers Errors as well: a
failure is a request with a different status code, not a different metric.
Duration needs a different shape of measurement, and it arrives in Chapter
10, "Latency: Histograms Without Tears".

Where RED stops working is worth knowing on the day you meet it. It assumes a
stream of requests with outcomes, so it describes an HTTP API very well, a
cache poorly, and a nightly batch job hardly at all. Chapter 22 introduces the
checklist for resources rather than services, and Chapter 8, "Aggregation:
`sum`, `without`, and the Rate-Then-Aggregate Law", adds a background worker
that serves no requests at all and measures it anyway.

Those three letters run through everything that follows. The dashboard in
Chapter 3, "Your First Dashboard: The Early Win", has three panels and they
are R, E and D. The alerts in Chapter 16, "Alerting Rules, and What 'Firing'
Actually Means", fire on E and D, and so do the objectives in Chapter 20,
"SLIs, SLOs and Error Budgets". Keep the three words.

## When the answer is "no data"

The most common beginner experience is an empty result and no explanation.
Prometheus does not say *why* nothing came back, because a dozen unrelated
causes produce the identical empty table.

The cure is a fixed ladder you climb in order, changing one thing at a time.
Here are the first four rungs; Chapter 2 completes the set, and Appendix B
prints all twelve for use during an incident.

!!! ladder "Ladder → rungs 1 to 4"
    **Rung 1 — does the target exist at all?** Open
    <http://localhost:9090/targets>. If the job is not listed, the problem is
    in `prometheus.yml`, not in your query. A configuration Prometheus never
    loaded cannot produce targets.

    **Rung 2 — is `up` 1 for it?** Run `up` and read the row. A `0` means
    Prometheus tried and failed. A missing row means Prometheus never tried,
    which sends you back to rung 1.

    **Rung 3 — did the scrape fail, and why?** The Error column on the
    targets page names the reason: a refused connection, a timeout, a 404 on
    the path. One reason is subtle enough to have a chapter of its own,
    chapter 5; until then the Error column is the answer.

    **Rung 4 — does the metric name exist?** Open the Metrics Explorer and
    look, rather than trusting your memory. Typos and half-remembered names
    are the largest single cause of empty results, and the second largest is
    asking for a metric the service does not export yet.

The discipline that makes the ladder work, from rung 5 onward, is peeling
back rather than retyping. Rewrite the whole expression and you change three
things at once, so a result that improves teaches you nothing. Strip to a
bare metric name, confirm it returns rows, then rebuild one piece at a time.

!!! selfcheck "Self-check"
    Run `make verify-ch01`. It takes about forty seconds, because it reads
    the counter, waits thirty seconds, and reads it again.

    ```text
    == verify-ch01 ==
       expected runtime: about 40 s

    PASS three targets report up == 1
    PASS snip_http_requests_total exists
         counter now: 41827 — waiting 30 s for it to move
    PASS snip_http_requests_total is increasing
    PASS the last snip-api scrape is under 60 s old

    ch01: 4 passed, 0 failed
    ch01 OK
    ```

    Any line beginning `FAIL` prints what it got and what it wanted. If it is
    the target assertion that fails, the script also lists every target
    Prometheus knows about. Start at rung 1.

## Common mistakes

**`localhost` in `prometheus.yml` means the Prometheus container.** This is
the mistake that catches almost everyone, because `localhost:8000` is exactly
what works from your own shell.

!!! pitfall "The target that is refused, not missing"
    Write `targets: ["localhost:8000"]` for the `snip-api` job, restart, and
    the targets page shows the job with State **DOWN** and this in the Error
    column:

    ```text
    Get "http://localhost:8000/metrics": dial tcp
      127.0.0.1:8000: connect: connection refused
    ```

    `localhost` inside the Prometheus container *is* the Prometheus
    container, and nothing is listening on port 8000 in there. The address
    must be the Compose service name — `snip-api:8000` — because that is the
    name the container network resolves. Note the shape of the failure: this
    is rungs 2 and 3, a target Prometheus tried and could not reach, a
    completely different problem from one it never knew about.

**Querying before the first scrape.** Run `make up`, immediately ask for
`snip_http_requests_total`, and you get an empty table. Nothing is broken:
Prometheus has not scraped yet. Wait fifteen seconds. Internalize this now:
the shortest honest answer to "why is my brand-new metric missing?" is almost
always "give it one scrape interval."

**Port 9090 is already taken.** `make up` fails with a message naming a
number and no service. On Fedora, RHEL and CentOS, Cockpit binds 9090 by
default; on macOS, AirPlay Receiver takes 5000 and 5001, which matters from
Chapter 17, "Alertmanager: Routing, Grouping and Silence". `make ports`
checks every port the lab publishes and names the service that wants each
one. Stop the conflicting service rather than
renumbering the lab — Cockpit's socket unit on Fedora and RHEL, AirPlay
Receiver in System Settings on macOS. Every URL in print assumes 9090 and
8000, and moving one means editing `compose.yaml`, the port table in
`LAB-SPEC.md` and `scripts/lib.sh` together. A single unavailable port aborts
the whole `up`, so the service that fails to start is often not the one that
wanted the port.

**Reading `/metrics` and expecting history.** The page shows current values
and nothing else; the trend lives in Prometheus, which is precisely why
Prometheus exists. Ask the Query page, not the endpoint.

**Editing `prometheus.yml` and expecting it to take effect.** At this point in
the lab Prometheus reads its configuration once, at startup. After any edit,
run `docker compose restart prometheus`. Chapter 12 makes the server reload
without a restart, and says why that matters.

## Summary

Ten minutes ago you had a service that could not answer a question about
itself. Now you have one that publishes a count at an HTTP endpoint, a server
that reads that endpoint every fifteen seconds and remembers what it saw, and
a query box where three questions got three answers. None of it is a toy
version of the real thing — it is the real thing, at the size of a laptop.

The vocabulary arrived attached to objects rather than definitions. A metric
is a name you chose. A label is a key/value pair that distinguishes one row
from another. A series is a name plus a label set. A sample is one value at
one instant. A scrape is one HTTP GET that turns the first three into the
fourth.

What to carry forward:

- Prometheus **pulls**. It connects to your service on a timer; your service
  never connects to it. `up` is free because of that, and so is knowing which
  targets ought to exist.
- `/metrics` is an ordinary HTTP endpoint publishing current values with no
  history. You can `curl` it, and when something is wrong you should.
- A time series is identified by its metric name **and** its full label set.
  Change one label value and you have a different series.
- `job` and `instance` are attached by Prometheus, not by your code.
- **Rate, Errors, Duration.** Three questions that describe the health of any
  request-serving service, and the spine of every chapter that follows.
- Empty result? Climb the ladder: target exists, target is up, read the Error
  column, check the name. One change at a time.
- A `command:` block in Compose replaces the image's arguments. The TSDB lives
  in a named volume, never a bind mount.

Chapter 2 gets serious about the text format and about what makes two series
the same or different. Chapter 3 puts Grafana in front of all this and gives
you a dashboard that moves.

## Exercises

!!! exercise
    **1. The gap that is not a dip (warm-up).** Stop the load generator with
    `docker compose stop loadgen`, wait a full minute, then
    `docker compose start loadgen`. Graph `snip_http_requests_total` over the
    last fifteen minutes. In one sentence, describe what the line does during
    that minute — and what it does *not* do. You should be able to point at
    the exact moment traffic stopped without the value ever decreasing.

    **2. Three times the resolution, not three times the points (core).**
    First, write down two predictions: how many samples one series has in a
    five-minute window at a fifteen-second scrape interval, and how many at
    five seconds. Then edit `prometheus/prometheus.yml`, set
    `scrape_interval` to `5s`, run `docker compose restart prometheus`, and
    watch `/targets`: the Last Scrape column should now cycle three times as
    often. Wait five minutes, graph `snip_http_requests_total`, set the
    graph's resolution input to `5`, and hover along the line. At fifteen
    seconds, three consecutive readouts repeat the same value; at five
    seconds every one is different. Your two numbers should not be in a ratio
    of exactly three to one — explain the fencepost. Put the interval back to
    `15s` afterwards, because every other number in print assumes it.

    **3. Prometheus watching Prometheus (core).** Point a browser at
    <http://localhost:9090/metrics> — the third target, Prometheus's own page
    of measurements. Find one metric that describes Prometheus's *scraping*
    behavior rather than its memory or its HTTP API, and write one sentence
    saying what it measures and in what unit. The `# HELP` line is allowed to
    help you.

    **4. Break it on purpose (core).** In `compose.yaml`, **replace** the two
    flags in the `prometheus` service's `command:` block with one flag,
    `--config.file=/nope.yml`. Replace, not add: a second `command:` key in
    the same service is a duplicate YAML key, and Compose rejects the file
    before starting anything. It also discards `--storage.tsdb.path`, which
    is the trap box's point restated. Run `docker compose up -d prometheus`
    and read `docker compose logs prometheus`. The container should fail to
    start with an error naming `/nope.yml`, and `make ps` should show it
    restarting. Then put both original flags back and bring it up again.

    **5. A target that was never there (stretch).** Add a fourth job to
    `prometheus/prometheus.yml` pointing at an address nothing is listening
    on — `targets: ["snip-api:9999"]` under `job_name: bogus` — and restart
    Prometheus. Query `up{job="bogus"}`. What value does the series take, how
    long after the restart does it appear, and what does the Error column say?
    Then explain in one sentence why this differs from a job you deleted from
    the configuration entirely. Remove the job when you are done.

    Solutions are in the solutions appendix.
