# Front matter

## F.1 — Who this book is for, and what it assumes

You write code. You have run `docker compose up` and watched containers
start. You have never run a monitoring system, you have never been handed a
pager, and you do not know what a time series is.

That is the starting point, and nothing here quietly requires more. Where a
term from operations work appears for the first time, it is defined in the
sentence that uses it or in a `jargon` box beside it. Where an expression
does something you have not learned yet, it carries an `iou` box naming the
chapter that repays the debt.

Four things are **not** assumed:

- **Kubernetes.** The lab is Docker Compose on your laptop from chapter 1 to
  chapter 29. Kubernetes is one optional chapter that builds its own cluster
  and deletes it again.
- **Go.** The service you own — `snip-api` — is written in Go, and you edit
  it in several chapters. Every edit is printed in full and none of them needs
  more Go than a working developer can read. `catalog`, the service you
  diagnose but never own, is Python. You do not write Python either.
- **A production system to practice on.** Every failure in this book is
  summoned on purpose, on one machine, with a documented switch or an HTTP
  request, and every one is reversible.
- **A colleague.** Every chapter ends with a check you can run alone, and the
  check states the number, count or status you should see.

### What you will be able to do

By the end, five verbs:

1. **Instrument** code you own with counters, gauges and histograms whose
   names, units and labels survive review — and do the cardinality arithmetic
   *before* the label ships, not after the database fills up.
2. **Query** in PromQL with intent: rates over counters, ratios that do not
   divide by a series that is not there, quantiles read out of histogram
   buckets, and joins against info metrics.
3. **Diagnose** an empty graph in a fixed order instead of by guessing,
   using the twelve-rung No-Data ladder in Appendix B.
4. **Alert** on symptoms rather than causes — routing, grouping and silence
   in Alertmanager, error budgets and burn rates, and rules unit-tested with
   `promtool` before they ever page a human.
5. **Operate** the thing: retention and disk arithmetic, a cardinality
   budget you enforce, backups, and an honest answer to the question of when
   one Prometheus stops being enough.

### Who this is not for

If you want a Thanos, Mimir or Cortex deployment guide, a Grafana Cloud
evaluation, or a tour of every exporter in the ecosystem, look elsewhere.
Chapter 26 gives you the scaling map and the decision, and stops. Four
exporters are taught properly, with a checklist for evaluating a fifth.
Grafana Alerting gets an honest sidebar in chapter 17 rather than a second
alerting system to keep in step.

The book is also not a certification course, though Appendix H maps its
chapters onto the Prometheus Certified Associate curriculum for readers who
want that.

## F.2 — How to read this book

Read it in order, and do the labs.

The lab is one repository, `obslab`, and it grows by one increment per
chapter. Chapter 21's burn-rate alert fires on chapter 15's recording rule,
computed from chapter 10's histogram, measuring chapter 5's endpoint,
discovered by chapter 12's relabel config, drawn on chapter 14's dashboard,
routed by chapter 17's tree, and graded by chapter 18's test file. Skipping a
lab does not save time; it removes the thing the next lab is built on.

Each chapter is a git tag, `ch01` through `ch29`, and each tag is a complete
working state. You can rejoin at any chapter, and you can go back.

Every tag is its chapter's *end* state, and each chapter is meant to be
worked twice. First read along: check out that chapter's tag, where every
file the chapter discusses is already finished, and read the chapter
against the real thing. Then recreate it: check out the *previous* tag and
make the chapter's changes with your own hands. The steps, and every output
printed between them — including the deliberate failures — follow that
second pass, so a test the chapter says will fail fails on the previous
tag, not on the finished one. When you are done, `git diff` against the
chapter's tag compares your work with the reference.

The twenty-nine chapters sit in nine parts. Each part opens with a
one-paragraph incident — what broke, and what you currently cannot answer —
and closes with a before-and-after box putting a number on the diagnosis time
then and now.

### Four recurring devices

**IOU boxes.** Chapter 3 hands you a working dashboard whose queries use
`rate()`, `sum by`, `histogram_quantile()` and `$__rate_interval`, none of
which you have met. The box names the chapters that repay each one, and when
the repayment lands the text says so: *"IOU from chapter 3, settled."* Copy
the query, run it, and let the explanation arrive when the lab has earned it.

**Self-check boxes.** Every chapter has at least one, and it states a
concrete result — a count, a status, a passing command. Most are a `make`
target: `make verify-ch08` prints `ch08 OK` or names the assertion that
failed and what it got. Three of them (chapters 4, 6 and 7) fail on a fresh
clone on purpose, because they check a worksheet *you* write; each says so in
its output. A few others need an overlay or a switch that the chapter turns
on, and each of those names what is missing rather than failing silently.

**Ladder cross-references.** "My graph is empty" has twelve causes and one
correct order for eliminating them. Chapter 1 introduces the first four rungs
in its section "When the answer is 'no data'", chapter 2 completes the list,
and from then on chapters point at a rung by number — *Appendix B, rung 4* —
rather than repeating the prose.

**Trap boxes.** A named, reproducible way to break the thing you have built,
printed with the wrong output. You will recognize your own mistakes on sight
long before you recognize correct code.

### In a hurry, or short of a cluster

Chapters 27, 28 and 29 are optional. The book stands without them: 27 is
Kubernetes on a throwaway `kind` cluster, 28 is OpenTelemetry, 29 is the
bridge to traces and logs.

On a first pass you can skim three chapters and come back:

- **Chapter 11**, the rest of PromQL — joins, subqueries, `offset` and `@`.
  Read "Info metrics: a value of one, and everything in the labels" and move
  on; the rest is reference you will want later.
- **Chapter 26**, HA and `remote_write`. Read "Do you need any of this yet?"
  and "The map", and come back when the answer changes.
- **Chapter 27**, Kubernetes. Read "Six things that do not change" and skip
  the cluster if you do not have one.

One warning before you start: check out the `ch01` tag first. The `main`
branch is the *finished* chapter 29 stack, with different services and
different ports. `make up` refuses to start it unless you are on a chapter
tag, and tells you the command that fixes it.

## F.3 — What you need

### Software

| Tool | Why |
|---|---|
| Docker with Compose v2 | Runs every service in the lab |
| GNU `make` | Every command in the book is a `make` target |
| `curl` | The standard check, and half the exercises |
| `jq` | `scripts/lib.sh` refuses to load without it |
| `awk`, `bash`, `git` | The scripts, and the chapter tags |

Docker Desktop and Docker Engine both work. `jq` is absent by default on
macOS, on a minimal Debian or Ubuntu image, and in Git Bash on Windows;
`make check` reports the whole tool set with resolved paths before it runs
anything, so you find out in one command rather than on the fourth.

### Memory and disk

About **3 GB of resident memory for the base stack** through chapter 11, and
about **6 GB for the full stack** from chapter 12 onward. Chapter 24 detonates
a cardinality bomb on purpose and peaks near 4.5 GB, with Prometheus alone
reaching about 1.6 GB. Budget about **10 GB of disk**.

On macOS and Windows the number that matters is not your laptop's memory but
the memory Docker gives its Linux virtual machine, which is commonly 2–4 GB
out of the box — less than Prometheus's own limit. Run `make doctor` before
your first `make up`. It prints what Docker actually sees, tells you where to
raise it for Docker Desktop, Colima and WSL2, and then runs `make ports`,
which checks every host port this lab publishes and names the two that catch
people out: macOS AirPlay Receiver on 5001, and Cockpit on 9090.

### Apple Silicon and other arm64 machines

Every pinned image in the lab is multi-arch, verified at freeze time, so
nothing runs under emulation. One caveat that is not architecture-specific
but bites hardest on a Mac: under Docker Desktop, `node_exporter` measures the
LinuxKit virtual machine, not your laptop. Chapter 22 says so where it
matters.

### Working offline

Run `make pull` once. It pulls every pinned image *and* builds the five
services that have a `build:` stanza — which is the step that downloads Go
modules and Python wheels. Pulling alone is not enough, and a reader who
pulls, gets on a plane and runs `make up` will fail in chapter 1.

After `make pull` finishes, the lab runs with no internet at all. There are
exactly two documented exceptions, both optional:

- `make k8s-up` in chapter 27 fetches a Helm chart from a Helm repository.
- One stretch exercise in chapter 23 adds a public HTTPS site to the blackbox
  target list, so you can watch a real certificate expiry against a
  certificate you did not issue.

### Why the TSDB lives in a named volume

Prometheus's database is on the named volume `promdata`, never on a bind
mount into your home directory. Bind mounts into a Docker Desktop virtual
machine have a history of corrupting the write-ahead log, and a corrupt TSDB
in chapter 6 is an evening you do not get back. Configuration is bind-mounted
read only; state is always a named volume. `make reset` removes those volumes
by name and refuses to report success if one survives.

## F.4 — The lab in one page

**Snip** is a URL shortener. `POST /links` returns a short code;
`GET /l/{code}` redirects, reading a Valkey cache, falling through to
PostgreSQL on a miss, and calling another team's `catalog` service for link
metadata. Look at which service owns which dependency, and at what Prometheus
reaches:

```text
 host :8089 ── loadgen (Go) ───────┐   traffic + X-Snip-* headers
                                   ▼
 host :8080 ─ edge (Caddy) ──► snip-api ×2 (Go) ─► valkey   (cache)
 host :8443 ─┘   (ch12+)           │              └─► postgres (store)
                                   ├──────────► catalog  (Python)
                                   └─► snip-worker (Go, :8090)

 prometheus :9090 ─ scrapes all of the above, itself, five exporters
      │  └─ rules ─► alertmanager :9093 ─► pager :5001 (offline sink)
      └─ grafana :3000  (provisioned from files: 5 dashboards)

 exporters  node-exporter :9100 · cadvisor :8085 · postgres-exporter
            :9187 · blackbox-exporter :9115 · redis-exporter :9121
```

That shape is why the book can ask "which layer is slow?" and have a wrong
answer available at every hop. `snip-api` and `snip-worker` are yours to edit.
`loadgen` and `catalog` you read and diagnose but never own — `catalog`
carries three planted bugs, harvested in chapters 4, 10 and 24.

### Ports

Nothing is published except these.

| Host port | Service | Live from | Live to |
|---|---|---|---|
| 3000 | `grafana` | ch3 | — |
| 3100 | `loki` | ch29 (overlay) | — |
| 3200 | `tempo` | ch29 (overlay) | — |
| 5001 | `pager` | ch17 | — |
| 5432 | `postgres` | ch1 | — |
| 6379 | `valkey` | ch1 | — |
| 8000 | `snip-api` | ch1 | **ch11** |
| 8080 | `edge` (HTTP) | ch12 | — |
| 8081 | `catalog` | ch4 | — |
| 8085 | `cadvisor` (→ 8080) | ch22 | — |
| 8089 | `loadgen` | ch1 | — |
| 8090 | `snip-worker` | ch8 | — |
| 8443 | `edge` (HTTPS) | ch12 | — |
| 9090 | `prometheus` | ch1 | **ch24** |
| 9093 | `alertmanager` | ch17 | — |
| 9094 | `alertmanager` (TCP and UDP) | ch17 | — |
| 9099 | `prometheus-b` (→ 9090) | ch26 (overlay) | — |
| 9100 | `node-exporter` | ch22 | — |
| 9115 | `blackbox-exporter` | ch23 | — |
| 9121 | `redis-exporter` | ch23 | — |
| 12345 | `alloy` | ch29 (overlay) | — |

Two host ports disappear during the book, and both removals are lessons.
`8000` goes in chapter 12, because a service publishing a fixed host port
cannot be scaled. `9090` goes in chapter 25, when Prometheus moves behind
`edge` and gains basic authentication.

### The chaos API

`loadgen` is a traffic driver and a control plane. `GET /control` returns the
current state; `POST /control` merges the fields you send and returns the new
state. Every knob is optional.

| Field | Default | Effect |
|---|---|---|
| `rps` | 20 | Requests per second; `0` is idle |
| `route` | `mix` | One route, or the weighted mix |
| `error_ratio` | 0.0 | Fraction of requests told to fail |
| `extra_latency_ms` | 0 | Server-side delay, in milliseconds |
| `latency_ratio` | 1.0 | Fraction that receive that delay |
| `db_delay_ms` | 0 | Delay inside the database call only |
| `cache_bypass` | false | Force a cache miss on every redirect |
| `cardinality_mode` | false | Request short codes that do not exist |
| `write_ratio` | 0.05 | Fraction of the mix that is `POST /links` |
| `timeout_ms` | 2000 | Client timeout |

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps": 40, "error_ratio": 0.30}'
```

Three chaos endpoints sit beside it. `POST /chaos/stall {"seconds": 60}`
sends nothing for a minute, producing a genuine data gap. `POST /chaos/kill`
exits the process so Docker restarts it, which is how you see a counter reset
on a service that is not yours. `POST /chaos/reset` puts every knob back and
cancels any running scenario. Named presets live in `lab/scripts/`, one per
`scenario-*.sh` script, and each prints what it is about to do and how long it
will run before it starts.

Faults reach `snip-api` as request headers, not through a private channel, so
they apply to every replica and you can reproduce any of them by hand with
`curl`.

### When something is broken

One command recovers any state, in about thirty seconds plus image pull time:

```bash
make reset && git checkout ch07 && make up
```

`make reset` removes the containers and the named volumes; the checkout puts
the tree back to a known chapter; `make up` rebuilds. Use it freely. Nothing
in the lab is precious.

## F.5 — Versions this book was written against

Every tag below was verified on **2026-07-27**, and the running stack that
produced the measured figures in these chapters was captured on
**2026-08-01**.

| Component | Image tag | Released |
|---|---|---|
| Prometheus | `quay.io/prometheus/prometheus:v3.13.1` | 2026-07-10 |
| Alertmanager | `quay.io/prometheus/alertmanager:v0.33.1` | 2026-07-04 |
| node_exporter | `quay.io/prometheus/node-exporter:v1.12.1` | 2026-07-14 |
| blackbox_exporter | `quay.io/prometheus/blackbox-exporter:v0.28.0` | 2025-12-04 |
| postgres_exporter | `quay.io/prometheuscommunity/postgres-exporter:v0.20.1` | 2026-07-08 |
| redis_exporter | `oliver006/redis_exporter:v1.88.0` | 2026-07-23 |
| cAdvisor | `ghcr.io/google/cadvisor:v0.60.5` | 2026-07-11 |
| Grafana | `grafana/grafana:13.1.1` | 2026-07-21 |
| Tempo | `grafana/tempo:3.0.2` | 2026-06-09 |
| Loki | `grafana/loki:3.7.4` | 2026-07-24 |
| Alloy | `grafana/alloy:v1.18.0` | 2026-07-20 |

Client libraries: `github.com/prometheus/client_golang v1.24.1` for
`snip-api`, `snip-worker` and `loadgen`; `prometheus-client==0.26.0` for
`catalog` and `pager`; `go.opentelemetry.io/otel/sdk/metric v1.44.0` for
chapter 28.

Six base images are pinned to a major tag rather than a patch —
`postgres:18-alpine`, `valkey/valkey:9-alpine`, `caddy:2-alpine`,
`python:3.13-slim`, `golang:1.25-alpine` and
`gcr.io/distroless/static-debian13:nonroot`. These are the lab's plumbing
rather than its subject, and pinning a base-image patch that is superseded
weekly would make the lab unbuildable within a quarter. Appendix A prints the
exact digest each one resolved to at freeze time, so a discrepancy is
reproducible.

One registry per component, stated once and obeyed everywhere: Prometheus-org
images from `quay.io`, Grafana images from Docker Hub, cAdvisor from
`ghcr.io`, `postgres_exporter` from the `prometheuscommunity` organization on
quay, and `redis_exporter` from Docker Hub as a named exception.

### What is deliberately not printed here

Some facts were contested by the research this book is built on, or were
flagged unverified by the source that supplied them. A textbook that prints a
contested number sends readers to the wrong page for years, so those claims
are absent rather than hedged.

The largest one is the Long Term Support line. Two sources disagreed about
which Prometheus release carries the LTS badge, and one flagged its own
reading as unverified. **No LTS version number appears anywhere in this
book.** What appears instead is this: Prometheus publishes a Long Term
Support line; check prometheus.io/download for the current one. The lab pin,
`v3.13.1`, was never in doubt and is used everywhere.

Absent for the same reason: any Grafana Cloud free-tier active-series figure
(only the retention window is published), any claim that `grafana/grafana`
and `grafana/grafana-oss` are identical builds, any Grafana release after
13.1.1, route-level `labels:` in Alertmanager (it exists on the development
branch and is a config parse error in v0.33.1), any `windows_exporter` metric
name, and Promscale.

!!! note "The citation rule that produced this list"
    `/docs/.../latest/` documents the latest *release*. Docs built from a
    project's `main` branch document *unreleased* work, and they look
    identical in a search result. Only a version-pinned documentation URL or
    a git tag is a safe citation. That single rule caught an Alertmanager
    config key that was about to be recommended here, and that would have
    been a parse error on the pinned version.

Software moves. Appendix F is the antidote: an "if the page says X, it now
means Y" table covering Prometheus 2 to 3, Grafana 11 and 12 to 13, and
Alertmanager 0.2x to 0.33, plus the recommendations to retire on sight when
you meet them in an older blog post.

## F.6 — Conventions

### Boxes

Twelve kinds of box appear, and each means one thing.

| Box | What it is |
|---|---|
| `objectives` | Opens every chapter: what you can do afterward |
| `iou` | An expression you do not understand yet, and the chapter that repays it |
| `selfcheck` | A concrete result to confirm before moving on |
| `ladder` | A pointer into Appendix B by rung number |
| `trap` | A named way to break this, printed with the wrong output |
| `pitfall` | The classic mistake, and what it looks like from inside |
| `warning` | Something that will cost you time or data |
| `jargon` | A one-paragraph definition at a term's first use |
| `sidebar` | Skippable background; the thread continues without it |
| `note` | An aside worth knowing, not worth stopping for |
| `exercise` | Only inside a chapter's Exercises section |
| `grafana12` | What differs if you are on Grafana 12.4 |

That last one is rarer than the others and earns its place where the user
interface actually diverges — chapter 13, on dashboard mechanics. Grafana
12.4 is the final minor of the 12 line and carries support into May 2027, so
a reader on a corporate install is a real reader, not a hypothetical one.

Nothing load-bearing is ever inside a `sidebar`. If you must have it, it is
not a sidebar.

### Code

Code fences are tagged by language. A `bash` block is a command you type,
with no `$` prompt to copy by accident. A `console` block is a captured
session, with input lines prefixed `$ ` and the real output underneath. A
`text` block is raw output, an exposition-format sample, or a diagram.

Every line in every fence is wrapped at 76 characters so it survives a narrow
screen, which means long PromQL is broken across lines and long shell
commands use `\` continuations. Paths are shown relative to the repository
root, as `lab/prometheus/prometheus.yml`.

Output printed in this book is output the lab actually produced, with the
same job names and the same label sets you will see. Where a number depends
on how long your stack has been running, the text says so instead of
pretending otherwise.

### Two PromQL habits

**Every selector names its job.** You will see
`snip_http_requests_total{job="snip-api"}` rather than the bare name. Metric
names are not unique across a Prometheus server: `process_cpu_seconds_total`
comes from all five of the lab's own services and from Prometheus and
Alertmanager as well, and `up` exists for every target there is. A bare
selector therefore answers a question you did not ask, and it answers it
differently on the day somebody adds an exporter. Naming the job makes an
expression say out loud which service it measures, and keeps it saying that
after the stack grows.

**Aggregation uses `without()`, not `by()`.** `sum without (instance)` keeps
every label except the one you named; `sum by (route)` throws away everything
you did not name. The difference is invisible until it costs you. The labels
`by()` discards are exactly the ones an alert needs to route on — and for
histograms, `le` has to survive aggregation or `histogram_quantile()` reads
buckets that are no longer there. Chapter 8 makes both consequences visible
and gives the rule: reach for `without()` by default, and use `by()` when a
deliberately narrow result is what you want.

### Cross-references

Chapters are referred to by number and title on first mention, then by number
alone. There are no page references and no "see above", because a reflowable
book has neither. A forward reference is always a promise, never a
prerequisite: if you need something now, it is defined now.
