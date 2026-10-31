# Chapter 22 — Metrics From Things You Didn't Write

Snip's p95 panel will not sit still, and you shipped nothing. The RED
dashboard from Chapter 14, "Dashboards That Tell the Truth", says the request
rate is normal and the error ratio is flat, while the ninety-fifth percentile
flickers between about ten milliseconds and a couple of hundred. Set that
dashboard's `$route` variable to `/links/{code}` and the flicker resolves:
that one route is tens of milliseconds slow, all the time, and it is roughly
one request in twenty — just enough to straddle the line an all-routes p95
keeps crossing. Every panel is telling the truth. None can tell you why.

That is not a gap in your instrumentation but in *what you have
instrumented*. Snip runs on a machine with a finite number of CPU seconds per
second, inside a container with a memory limit somebody typed once, talking
to a PostgreSQL server with a finite number of connection slots. You wrote
none of them, and none imports a client library.

This chapter makes it visible, and almost nothing new is involved. An
**exporter** is a small program that reads somebody else's state and
republishes it in the exposition format from Chapter 2, "What's Actually on
the Wire". Prometheus scrapes it the way it scrapes Snip, and the series
answer the same PromQL and fire the same rules. The only new skill is judging
whether the exporter in front of you can be trusted — and, as PostgreSQL is
about to show, not always.

!!! objectives "Objectives"
    After this chapter you can:

    - Name the three exporter categories and pick the right one for a system.
    - Evaluate an unfamiliar exporter against a checklist before deploying it.
    - Build a USE row for the host and a container row for your own service.
    - Diagnose a service that is slow while its CPU usage looks unremarkable.
    - Publish a batch job's result through the textfile collector.
    - Say why the Pushgateway is almost never the answer.

## Where the lab is

Everything here builds on the stack as Chapter 21, "Burn Rates: Alerts That
Don't Cry Wolf", left it: Snip behind the `edge` proxy, the worker,
`catalog`, `loadgen`, Prometheus, Grafana, Alertmanager and the pager, over
PostgreSQL and Valkey as plumbing nobody has yet monitored.

```bash
cd lab
git checkout ch22
make check
make up
make ps
```

Prometheus is on `http://localhost:9090/`, Grafana on
`http://localhost:3000/`, Snip through `edge` on `http://localhost:8080/`,
and the load generator's control API on `http://localhost:8089/`. Put the
injector into a known, boring state — the problem this chapter chases is
there whether or not you provoke one:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","error_ratio":0}'
```

The `ch22` tag changes seven files. The ones this chapter prints and explains
are three services in `compose.yaml`, their three jobs in `prometheus.yml`
and three alerts in `prometheus/rules/meta-alerts.yml`; the `Makefile` learns
the new ports. `dashboards/snip-use.json` and `scripts/backup-example.sh` are
read later and meant to be copied from the tag rather than typed. Check out
`ch22` to read along, or `ch21` to add the services and jobs yourself from
the blocks here.

Either way, open `http://localhost:9090/targets`. Three new rows are there —
`node-exporter`, `cadvisor` and `postgres-exporter`, each with one target,
each reading UP. That is the entire lab step for the "install an exporter"
part of this chapter, which is rather the point. A job showing zero targets
is missing the `obslab.scrape` label; a target DOWN with a connection error
is missing `networks: [obsnet]`. Both are in the blocks that follow.

## An exporter is a translator, and that is all it is

There are exactly three ways a number gets into Prometheus, worth naming
before you meet a strange one.

**Direct instrumentation** is what you have been doing since Chapter 5, "Your
First Counter: Instrumenting Code You Own": your process imports a client
library, holds the counters in memory, and serves them on its own `/metrics`.
It is the best option when you control the code, because the process knows
things nobody outside can see — which route, which cache result, which
database operation.

**A single-target exporter** is a separate process that reads one system's
state and republishes it. `node_exporter` reads `/proc` and `/sys`. cAdvisor
reads the container runtime and the kernel's control groups — the boxes with
accounting and limits attached that a container is built from.
`postgres_exporter` opens a SQL connection and selects from the statistics
views. Prometheus scrapes the exporter directly, so the exporter's address is
what ends up in `instance`.

**A multi-target exporter** is one process that inspects *many* things, told
which one to look at per scrape through a URL parameter.

!!! iou "IOU — chapter 23"
    That inversion needs a chapter of its own. Chapter 23, "The Multi-Target
    Pattern: Probing From Outside", builds it from the relabeling you already
    know. Everything in *this* chapter is category two, and category two is
    boring on purpose.

```text
 (1) direct instrumentation
   ┌──────────┐  serves its own /metrics
   │ snip-api │─────────────────────────────▶  :8000/metrics
   └──────────┘

 (2) single-target exporter
   ┌──────────┐   reads    ┌───────────────┐
   │ /proc/*  │◀───────────│ node_exporter │──▶  :9100/metrics
   └──────────┘            └───────────────┘

 (3) multi-target exporter — chapter 23
   ┌────────────┐ GET /probe?target=X ┌──────────┐  asks
   │ Prometheus │────────────────────▶│ exporter │───────▶ X
   └────────────┘                     └──────────┘
```

Look at the middle row: the exporter pulls from the system and Prometheus
pulls from the exporter, so Chapter 1's pull model is unbroken all the way
down. That is what makes exporters dull to operate.

Everything you already know still applies. A dead exporter shows up as
`up == 0`, exactly like a dead application; its series carry `job` and
`instance` because the scrape attaches them; Chapter 12's relabeling works on
them, and the three new jobs reuse the same seven relabel rules as every
other job with one string changed. And Chapter 7's cardinality arithmetic
applies with a vengeance, because an exporter has no idea what your series
budget is.

## USE: the question RED cannot ask

RED describes a thing that serves requests: **R**ate, **E**rrors,
**D**uration. It is the right frame for Snip and a poor one for a disk, which
has no error ratio you would page on and no single answer to "how long did it
take".

The counterpart is **USE**, named by Brendan Gregg for resources rather than
services: for every resource, measure **U**tilization, **S**aturation and
**E**rrors. Utilization is the share of time the resource spent busy;
saturation is the extra work it could not service and which therefore
queued; errors is the count of things that outright failed.

Two things are easy to miss. The first is that USE is a checklist built from
your list of *resources*, not from the metrics you happen to have. Write down
"host CPU, host memory, host disk, container CPU, container memory,
connection pool", then go looking for three numbers each. Starting from the
exporter's metric list gets you a dashboard of whatever it found easy to
publish.

The second is that saturation is the letter people skip and the one that
predicts pain. Utilization is bounded — a CPU cannot be more than 100% busy —
so its graph flattens exactly when things start getting bad. Saturation is
unbounded: it climbs while the queue grows, which is precisely when users are
noticing and your utilization panel is a flat line at the top of its axis.

Here is that checklist for every layer under Snip, with the honest answer in
the last column rather than a convenient one.

| Resource | Utilization | Saturation | Errors |
|---|---|---|---|
| Host CPU | busy fraction | run queue per core | none exposed |
| Host memory | 1 − available/total | swapping, out-of-memory (OOM) kills | none exposed |
| Host disk | I/O seconds per second | queue-weighted I/O | none exposed |
| Host network | bytes per second | — | receive errors, drops |
| Container CPU | cores used | CFS throttling | none exposed |
| Container memory | working set ÷ limit | OOM kills | none exposed |
| Postgres | backends ÷ max | refused connections | rollbacks, deadlocks |

Five of those seven Errors cells say "none exposed", which is not a defect in
the table: the Linux kernel publishes no count of CPU errors, and
node_exporter cannot invent one. "Not measurable with the exporter I have"
beats filling the cell with something adjacent.

RED and USE answer different questions, and the difference decides who gets
woken. RED measures symptoms — a user is waiting, a user got a 500 — so RED
pages. USE measures causes, and a cause with no symptom is not an emergency.
Chapter 19, "What a Page Should Say, and Who Watches the Watcher", gave the
test: *would a user have noticed if nobody had?* All three alerts here answer
no, so all three carry `severity: ticket`. RED told you one route was slow;
USE will tell you why, during office hours.

## node_exporter: the host, whatever the host turns out to be

`quay.io/prometheus/node-exporter:v1.12.1`, port **9100**. It reads the Linux
kernel's own accounting — `/proc`, `/sys`, the load average, the mount table
— and publishes it. It knows nothing about your containers or your
application, which is a routine source of confusion: people install it, look
for their request rate, and conclude it is broken.

### The Docker Desktop caveat, stated once

On Docker Desktop, on macOS or Windows, there is no Linux host: your
containers run inside a lightweight Linux virtual machine, and node_exporter
reports that VM. The disks will be unfamiliar, the interfaces will not be
your laptop's, and the memory total is whatever you granted Docker. Every
number is real; it is real about the VM.

The lab's `node-exporter` joins `obsnet` rather than using host networking.
Upstream reaches for `--net=host`, right on a real Linux server and here
enough to make the container unreachable as `node-exporter:9100`. The lab
mounts the host's root filesystem read-only instead:

```yaml
  node-exporter:
    image: quay.io/prometheus/node-exporter:v1.12.1
    restart: always
    pid: host
    command:
      - --path.rootfs=/host
      - --collector.textfile.directory=/textfile
    volumes:
      - /:/host:ro
      - ./textfile:/textfile:ro
    ports:
      - "9100:9100"
    labels:
      obslab.scrape: "true"
      obslab.metrics_port: "9100"
      obslab.metrics_path: "/metrics"
    networks: [obsnet]
    mem_limit: 128m
```

`--path.rootfs=/host` tells the exporter that what looks like `/host` to it
is `/` to everyone else, so the mount points come out with sane names. The
`obslab.*` labels and `networks: [obsnet]` are what every service here
carries: the labels are what Chapter 12's discovery keeps and reads the port
off, `obsnet` is how Prometheus reaches the container. The other two services
carry them identically.

!!! trap "`rslave` fails on Docker Desktop, and takes three services with it"
    Upstream mounts the root filesystem as `/:/host:ro,rslave`, so
    filesystems mounted *after* the exporter starts become visible to it.
    Docker Desktop cannot: its `/` lives in the LinuxKit VM and is neither a
    shared nor a slave mount. Add `rslave` and `make up` prints this — one
    line in your terminal, wrapped here to fit the page:

    ```text
    Error response from daemon: path / is mounted on / but it is
    not a shared or slave mount
    ```

    and — because Compose aborts on the first error — `edge` and `loadgen`
    never start either. One bad mount option, three dead services, and an
    error naming none of them. Plain `ro` works everywhere; on a real Linux
    server, put `rslave` back.

### Why the names are shouting

Run this in the Prometheus expression browser:

```promql
node_memory_MemAvailable_bytes
```

CamelCase, in the middle of a metric name, in a system whose naming
convention is rigorously lower_snake_case. It looks careless. It is the
opposite: the meminfo collector builds each name from the namespace `node`,
the subsystem `memory`, and the field name taken verbatim from
`/proc/meminfo`. The kernel writes `MemAvailable:`, so the exporter writes
`MemAvailable`. Translating that to `mem_available` would mean inventing a
mapping the next kernel field would break, in a way nobody could grep for.

Carry that to every exporter you meet: **faithfulness to the source beats
conformity to the convention**, because a name you can trace back to a kernel
field is a name you can look up.

### `avail`, not `free`

Two pairs of names in node_exporter differ by one word and mean genuinely
different things. Both traps cost people incidents.

For memory, `node_memory_MemFree_bytes` is memory holding nothing at all.
Linux keeps that small on purpose — unused RAM is wasted RAM, so the kernel
fills it with page cache and gives it back the moment a process needs it.
`node_memory_MemAvailable_bytes` is the kernel's own estimate of what a new
process could actually get. Alerting on free is alerting on a healthy
machine.

For filesystems, the pair is subtler and worse:

```promql
node_filesystem_free_bytes - node_filesystem_avail_bytes
```

Both are gauges, per `device`/`mountpoint`/`fstype`. `free` is total free
space; `avail` is the space available *to processes that are not root*, and
on ext4 the difference is the reserved block percentage, 5% by default. Run
that subtraction against your own lab: wherever the two differ, the gap is
that reserve — five gigabytes on a hundred-gigabyte ext4 filesystem,
permanently, on a healthy disk. Rows with a zero gap are pseudo-filesystems,
which have no reserve, and under Docker Desktop most of them are.

Now imagine the alert. You alert on `free < 5 GB`; your application, which
does not run as root, hit "no space left on device" some time ago, and the
metric you chose still reads five gigabytes of headroom. Alert on `avail`.
The lab's disk alert does, and so does the USE dashboard.

### The host's USE row, in three expressions

CPU utilization is derived from idle, the one mode every kernel reports
identically:

```promql
1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))
```

Saturation comes from the load average, and only means anything per core.
`node_load1` is the Linux load average over the last minute — roughly, how
many tasks were running or waiting to run. On Linux it also counts tasks
blocked waiting on disk, which is why a storage problem shows up here and not
on the CPU panel. One task per core is a machine that is exactly busy, so
divide:

```promql
node_load1 / scalar(count(count by (cpu) (node_cpu_seconds_total)))
```

The inner `count by (cpu)` produces one element per CPU and the outer
`count` counts them. `scalar()` turns that into a plain number, which
matters: `count()` returns a series with *no* labels while `node_load1`
carries `job`, `instance` and `env`, so Chapter 9's one-to-one matching finds
no pair with identical label sets and returns an empty result with no error
at all. Divided this way, 1.0 means the machine is exactly full, however many
cores it has.

Memory utilization is the available-over-total pair:

```promql
1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes
```

Those three, plus a filesystem panel, disk I/O and network throughput, are
the host row of `dashboards/snip-use.json`, which the `ch22` tag provisions.

### Collectors, and the ones the lab throws away

node_exporter is a bundle of **collectors**, each responsible for one
subsystem. There are more than eighty, about fifty on by default; the rest —
`systemd`, `processes`, `interrupts` and friends — are expensive,
platform-specific, or both. Turn one on with `--collector.<name>` and off
with `--no-collector.<name>`; `--collector.disable-defaults` turns everything
off so you can list only what you want. `textfile` is a default and gets its
own section.

The lab drops three families at scrape time. Here is the whole job in
`prometheus.yml`, abbreviated only where it repeats itself:

```yaml
  - job_name: node-exporter
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        refresh_interval: 15s
    relabel_configs:
      - source_labels: [__meta_docker_container_label_obslab_scrape]
        regex: "true"
        action: keep
      - source_labels:
          - __meta_docker_container_label_com_docker_compose_service
        regex: node-exporter
        action: keep
      # …then the same five rules every other job in this file
      # carries: address from the port label, metrics path, the
      # instance name, the job override, and env=lab.
    metric_relabel_configs:
      - source_labels: [__name__]
        regex: node_(scrape_collector_.*|cpu_guest_seconds_total|softnet_.*)
        action: drop
```

The other two jobs are this one copied twice, with the name changed in
`job_name` and in the second rule's `regex`, and with their own
`metric_relabel_configs` — four drop rules for cAdvisor, none for
postgres-exporter. Rule one is the keep every target here passes through,
which is why a service without the `obslab.scrape` label is discovered and
then immediately dropped.

The three families dropped are per-collector timing self-metrics, guest CPU
time, and the softnet counters. Note where the rule lives:
`metric_relabel_configs` runs on samples coming back from a scrape, not
`relabel_configs`, which runs on targets before one happens.

Even after the drop, count what you just bought:

```promql
count({job="node-exporter"})
```

On the measured run of the finished lab, node-exporter contributed **1,001**
series — yours will differ, because that scales with your host's filesystems
and network interfaces. Compare `snip-api` at 170 and `snip-worker` at 63.
One `docker compose` entry you did not write produced several times more
series than everything you instrumented by hand. That is normal, and it is
why every exporter gets a cardinality question asked of it.

## cAdvisor: your own containers, from underneath

`ghcr.io/google/cadvisor:v0.60.5`, on host port **8085** because 8080 belongs
to `edge`. A tutorial pointing at `gcr.io/cadvisor/cadvisor` predates
v0.53.0, and that registry is dead.

cAdvisor reads the kernel's control groups and reports per-container CPU,
memory, network and filesystem usage. It is the one exporter here that
measures *your own code*, from the outside — the only place some of these
facts are visible.

!!! jargon "cgroup"
    A **control group** puts a set of processes into a box with accounting
    and limits attached: this box may use 0.15 of a CPU and 256 MB of memory,
    and here are counters for what it has used. A container is a cgroup plus
    a filesystem plus some namespaces. cAdvisor reads every resource number
    out of the cgroup — which is why it can see a limit your process
    cannot.

### The Docker Desktop box, printed on purpose

cAdvisor needs more privilege and more mounts than anything else here, and
getting one wrong produces a container that starts, serves `/metrics` and
reports almost nothing.

!!! warning "Running cAdvisor on Docker Desktop"
    The lab's service, every line of it:

    ```yaml
      cadvisor:
        image: ghcr.io/google/cadvisor:v0.60.5
        privileged: true
        command:
          - --docker_only=true
          - --housekeeping_interval=10s
        devices:
          - /dev/kmsg
        volumes:
          - /:/rootfs:ro
          - /var/run:/var/run:ro
          - /sys:/sys:ro
          - /var/lib/docker/:/var/lib/docker:ro
          - /dev/disk/:/dev/disk:ro
        ports:
          - "8085:8080"
        labels:
          obslab.scrape: "true"
          obslab.metrics_port: "8080"
          obslab.metrics_path: "/metrics"
        networks: [obsnet]
        mem_limit: 512m
    ```

    `/sys` is where the cgroup accounting lives; without it there are no
    resource numbers. `/var/lib/docker` is how cAdvisor maps a cgroup back to
    a container name; without it your series arrive with unreadable
    identifiers and no `name` label to group by. `/var/run` reaches the
    container runtime, `--docker_only=true` keeps cAdvisor to containers
    rather than every cgroup, and `/dev/kmsg` is the kernel log device it
    watches for out-of-memory kills. `privileged: true` is the bluntest line:
    cAdvisor reads cgroup and device state a confined container may not see,
    and this grants all of it at once. It is a lab compromise; on a real host
    you narrow it to what your collectors actually need.

    Three Docker Desktop differences to expect. Some disk and memory figures
    are missing or read zero under cgroup v2 — the platform, not a
    misconfiguration. The image's `ENTRYPOINT` is the cAdvisor binary, so
    `command:` is *appended*, and Chapter 1's Compose override trap does not
    apply. And `--store_container_labels` now defaults to `false`; older
    posts telling you to set it describe a cardinality bomb already
    defused.

    On Colima, Rancher Desktop and rootless Docker the `devices:` line fails
    container *creation* outright — not a degraded cAdvisor but none at all,
    which takes two assertions of `make verify-ch22` with it: `the cadvisor
    job is up` and `catalog is being CFS-throttled`. Delete the two
    `devices:` lines. OOM-kill detection goes with them; the cgroup
    accounting every expression here uses comes from `/sys` and is
    unaffected, so both assertions pass again.

### The `name` label, and the cgroup that is all of them

cAdvisor emits a series for every cgroup it can see, including the root — the
box containing every other box. The root has no container, so its `name` is
the empty string and its numbers are the sum of everything inside it. Include
it in a `sum by (name)` and every total doubles, with no error and no
warning.

The universal fix is `{name!=""}` on every cAdvisor selector, and you should
write it out of habit. Here you need not: the scrape config removes those
series before they are stored:

```yaml
      - source_labels: [__name__, name]
        separator: ";"
        regex: container_.*;
        action: drop
```

Two source labels joined by `;`, so a series called `container_anything`
whose `name` is empty produces `container_anything;` and matches. The four
drop rules in that job are modeled on the ones the Kubernetes monitoring
community ships with `kube-prometheus`, which have had far more containers
thrown at them than this lab has. Without them cAdvisor alone contributes
several thousand series; with them it contributed **1,166** on the finished
stack, which has more containers than you do — expect a smaller figure, and
expect it to drift.

### Working set, not usage

Two memory gauges, one right answer:

```promql
container_memory_usage_bytes{name=~"obslab-snip-api-.*"}
```

```promql
container_memory_working_set_bytes{name=~"obslab-snip-api-.*"}
```

Run both. `usage` is the larger, and on a container that has been serving
traffic a while it sits close to the limit. `working_set` is lower, and the
one that matters.

The difference is page cache. When a process reads a file the kernel keeps
the contents in memory in case it is read again and charges them to the
container's cgroup, and `usage` counts them. That cache is *reclaimable*: the
moment the container needs memory for something real, the kernel throws it
away. `working_set` is usage minus the reclaimable part, which is the number
the out-of-memory killer effectively watches.

!!! pitfall "Alerting on `container_memory_usage_bytes`"
    A container reading a lot of files will sit at 95% of its limit
    indefinitely, in perfect health, because almost all of it is cache. Alert
    on `usage` and you get a page every night from every container that
    touches disk, you learn to ignore it, and then you ignore the one that
    was about to be killed — the most common false-alarm generator in
    container monitoring, from choosing one of two adjacent names.

### Memory as a share of the limit, and the zero that ruins it

The useful question is not how many bytes a container holds but how close to
its ceiling, which is a division:

```promql
container_memory_working_set_bytes{name!=""}
/
container_spec_memory_limit_bytes{name!=""}
```

Run it and read the table. Most rows are sensible fractions. One —
`obslab-pager-1` — is not, because `pager` is the one service with no
`mem_limit` at all. On Docker Desktop under cgroup v2 its limit reads `0`, so
the row reads `+Inf`: Prometheus has cheerfully divided by zero, and on a
0–1 axis that row draws as nothing while poisoning every legend calculation
on the panel. A runtime reporting the host's memory total for an unset limit
gives a meaningless small fraction instead — neither is a percentage of a
limit a human set, and both have the same fix.

Chapter 9 gave you the tool: a comparison operator used as a *filter* drops
elements that fail it, so a guard on the denominator removes the unlimited
containers from the result entirely:

```promql
container_memory_working_set_bytes{name!=""}
/
(container_spec_memory_limit_bytes{name!=""} > 0)
```

`obslab-pager-1` is now absent, the honest answer: a container with no limit
has no percentage of a limit. That expression is what ships in the lab's
`ContainerNearMemoryLimit` alert.

Both sides carry identical label sets, so Chapter 9's one-to-one matching
pairs them up with no help. When they *do not* match — the usual case the
moment you join an exporter's series to anything else — you need `on (...)`
and, where one element on the right serves many on the left, `group_left`.
Here is that shape asking what share of the host's memory each container
holds:

```promql
sum by (name) (container_memory_working_set_bytes{name!=""})
/ on () group_left()
sum(node_memory_MemTotal_bytes)
```

`on ()` matches on no labels at all, collapsing both sides into one group;
`group_left()` says the left side is the many, and without it Prometheus
refuses the query rather than guessing. This joins cAdvisor to node_exporter
across two jobs and two `instance` values, and works because after `on ()`
neither label is part of the match.

## The incident: slow, and its CPU looks fine

Now go back to the one route that was slow. `/links/{code}` is the only
handler in Snip that calls `catalog`: it reads the link from PostgreSQL and
then asks `catalog` to enrich the answer. `GET /l/{code}`, the redirect that
is most of Snip's traffic, never touches `catalog` at all — which is exactly
why this hid. One request in twenty crosses that hop, so an all-routes p95
sees it only when the ninety-fifth percentile happens to land there.

So if `catalog` is slow, that route is slow. Which container is burning CPU?

```promql
topk(5, sum by (name) (
  rate(container_cpu_usage_seconds_total{name!=""}[5m])
))
```

That is CPU seconds consumed per second, which is to say cores.
`obslab-catalog-1` comes back at **a few hundredths of one core** — write
your own number down — on a host with several idle ones. This is the panel on
every container dashboard ever built, and here it says the service is
asleep.

Now ask the saturation question:

```promql
topk(5, sum by (name) (
  rate(container_cpu_cfs_throttled_seconds_total{name!=""}[5m])
))
```

`obslab-catalog-1` comes back clearly non-zero and everything else flat
zero. Read that unit carefully: a counter of *seconds the container spent
stopped, waiting for CPU it was not allowed to have*, which `rate` turns into
seconds of waiting per second.

A companion pair counts occasions rather than seconds, and gives the share of
scheduling periods that ended with the container frozen:

```promql
rate(container_cpu_cfs_throttled_periods_total{name=~".*catalog.*"}[5m])
/
rate(container_cpu_cfs_periods_total{name=~".*catalog.*"}[5m])
```

Hold that next to the CPU figure. Both are true at once, because the limit is
not enforced on an average: the Linux scheduler gives a cgroup *N*
microseconds of CPU in every 100 ms window, and when it has spent them every
thread in it freezes until the window rolls over. That is **CFS
throttling**, after the Completely Fair Scheduler. It does not slow your
process evenly; it stops it dead, repeatedly, for up to a hundred
milliseconds at a time. That is what your latency histogram is measuring.

And now look at `catalog` in `compose.yaml`, abridged to the two lines that
matter — the last two:

```yaml
  catalog:
    build: ./catalog
    ports:
      - "8081:8081"
    networks: [obsnet]
    cpus: "0.15"
    mem_limit: 256m
```

There it is. Fifteen hundredths of a CPU is 15 ms in each 100 ms period.
`catalog` answers a lookup by scanning its catalog in memory, which costs
fifteen to twenty-five milliseconds, and re-scores an index once a second in
a burst that wants about fifty. Either one blows through a 15 ms budget
inside a single period, several times a second — then idles for the rest of
it, which is why the *average* comes out so low. A container can be starved
and idle at once, and only one of those facts is on the usual dashboard.

That limit has been in the file since `catalog` arrived in Chapter 4, and
nothing in the lab could observe it until ten minutes ago. Open
`http://localhost:3000/d/snip-use` and read the two container CPU panels side
by side: cores used on one, throttling on the other. Leave the `Container`
variable on `All`, whose value is `.+` and not `.*` — the root-cgroup
exclusion you just wrote by hand, done a third way. Both panels use
`[$__rate_interval]`, for the reason Chapter 13, "Dashboard Mechanics:
Intervals, Panels and Variables", gave.

## Three alerts, one per layer

The `ch22` tag adds three rules to `prometheus/rules/meta-alerts.yml`, one
per layer; they are already loaded, and `make reload` picks up your edits.
All three carry `severity: ticket` — the USE-versus-RED distinction becoming
a routing decision, because none means a user is waiting *yet*.

The first is a *trend* alert rather than a threshold. A disk sitting at 91%
for a year is not an incident; a disk at 60% filling by ten gigabytes an hour
is.

```yaml
      - alert: NodeDiskWillFillIn4Hours
        expr: |
          predict_linear(
            node_filesystem_avail_bytes{job="node-exporter",
              fstype!~"tmpfs|overlay|squashfs|ramfs"}[6h], 4 * 3600
          ) < 0
          and on (instance, mountpoint)
          node_filesystem_readonly{job="node-exporter"} == 0
        for: 30m
        labels:
          severity: ticket
          service: monitoring
```

!!! iou "IOU from chapter 4, settled"
    Chapter 4 promised that the gauge contract buys two functions a counter
    can never have, and named `predict_linear()` as the second. Here it is.
    `predict_linear(v[6h], 14400)` fits a least-squares straight line through
    six hours of samples and reports where it will be 14,400 seconds — four
    hours — from now. Its second argument is seconds as a plain number, never
    a duration literal. It is gauge-only for the same reason `deriv()` is: it
    is meaningful precisely because the value may fall.

Three choices there are worth defending. The range is `[6h]`, not the
`$__rate_interval` you would use on a panel: this is a trend estimator's
memory, not a display window, and must not change meaning when somebody drags
the time picker. Six hours is long enough that one compaction does not swing
the slope and short enough that a leak starting this morning shows up before
lunch. Four hours is roughly how long a human takes to notice a ticket and
delete something. And `fstype!~` excludes pseudo-filesystems, whose "free
space" you cannot run out of.

The `and on (instance, mountpoint)` clause is the part most people leave out.
A read-only filesystem already nearly full satisfies the prediction forever
and no paging will fix it — a permanently firing ticket, the alert fatigue
Chapter 19's noise audit teaches you to hunt. Matching on
`(instance, mountpoint)` rather than a bare `and` also survives node_exporter
adding a label to one family and not the other.

The second alert is the guarded division you already built:

```yaml
      - alert: ContainerNearMemoryLimit
        expr: |
          container_memory_working_set_bytes{job="cadvisor", name!=""}
          /
          (container_spec_memory_limit_bytes{job="cadvisor",
                                             name!=""} > 0)
          > 0.9
        for: 10m
```

Both choices are the ones you made two sections ago. `for: 10m` is the new
one, because a container that touches 91% during a garbage collection and
comes back down is not news.

The third belongs to PostgreSQL, and needs its exporter first.

## postgres_exporter, and the metric that was not there

`quay.io/prometheuscommunity/postgres-exporter:v0.20.1`, port **9187**. Note
the registry: this one lives under `prometheuscommunity`, not the Prometheus
organization the other two came from. Community exporters are most of the
ecosystem, which is why ownership is the checklist's first line.

Unlike the other two it has something to connect *to*, so its service carries
a **DSN** — a data source name, one string saying which server, which
database, which user and with what options:

```yaml
  postgres-exporter:
    image: quay.io/prometheuscommunity/postgres-exporter:v0.20.1
    restart: unless-stopped
    environment:
      # one unbroken line in the file; wrapped here to fit the page,
      # with <database> standing in for ${POSTGRES_DB:-snip}
      DATA_SOURCE_NAME: >-
        postgresql://postgres_exporter:exporter@postgres:5432/
        <database>?sslmode=disable
    ports:
      - "9187:9187"
    depends_on:
      postgres:
        condition: service_healthy
    labels:
      obslab.scrape: "true"
      obslab.metrics_port: "9187"
      obslab.metrics_path: "/metrics"
    networks: [obsnet]
    mem_limit: 128m
```

The DSN is one unbroken line in the file, shown here in two because a URL
does not fit the page; `<database>` stands in for `${POSTGRES_DB:-snip}`,
templated because `.env` invites you to change `POSTGRES_DB`. `depends_on`
waits for Postgres to be *healthy*, not merely started, because an exporter
connecting before initdb finishes finds no role to connect as. The role comes
from `postgres/initdb/02-exporter.sql`, three statements long:

```sql
CREATE ROLE postgres_exporter WITH LOGIN PASSWORD 'exporter';

GRANT pg_monitor TO postgres_exporter;

GRANT CONNECT ON DATABASE :"DBNAME" TO postgres_exporter;
```

`pg_monitor` is a built-in role granting read access to exactly the
statistics views a monitoring agent needs and nothing else. That line is the
difference between an exporter that can read your query statistics and one
that can drop your tables: an exporter is long-lived, network-reachable and
read-only by right. `:"DBNAME"` is psql's own variable for the database the
script is connected to — writing `snip` there aborts the whole bootstrap the
day somebody changes `POSTGRES_DB`.

Its job is the only one of the three with no `metric_relabel_configs`. On
the measured run it contributed 655 series — more than Snip's own
instrumentation, and small enough to leave alone. A drop list is a response
to a measurement, not a habit. The three exporters together carried about
2,800 series you did not write, against 233 from `snip-api` and
`snip-worker`.

The third alert uses two of its series:

```promql
sum by (job, instance) (
  pg_stat_database_numbackends{job="postgres-exporter"}
)
/ on (job, instance)
pg_settings_max_connections{job="postgres-exporter"}
```

Connections are a saturation metric with a hard wall: PostgreSQL does not
queue past `max_connections`, it refuses. The errors that saturation produces
appear in no PostgreSQL metric — they appear in Snip's own 500s, on the RED
dashboard, looking like an application bug. The alert fires at 0.8 with
`for: 10m`, giving you the connection graph before the mystery.

### The lesson you actually came for

Now the part that matters more than any individual `pg_*` name. Version
0.20.0 renamed the `replication_slot` collector to `replication_slots` and
re-prefixed its metrics to `pg_replication_slots_*`; five collectors in that
release stopped honoring `--metric-prefix` and `--disable-default-metrics`.
Every dashboard and blog post written before mid-2026 uses the old spellings
and now silently returns nothing. That is why the lab pins `v0.20.1`.

The sharper version of the same problem is on your own machine right now.
PostgreSQL 17 split the `pg_stat_bgwriter` view, moving the checkpoint
counters into a new `pg_stat_checkpointer` view. The lab runs PostgreSQL 18,
and the exporter has a `stat_checkpointer` collector in its collector list.
Everything says these metrics should be here. So:

```promql
{__name__=~"pg_stat_checkpointer_.*"}
```

```text
Empty query result
```

```bash
curl -s http://localhost:9187/metrics | grep -c checkpointer
```

```text
0
```

The natural next thought is that the exporter is broken. Rule that out before
you act on it: the exporter reports its own health per collector, on every
scrape, as `pg_scrape_collector_success{collector="..."}`.

```promql
pg_scrape_collector_success{collector="stat_bgwriter"}
```

```text
1
```

Nothing is broken: the scrape succeeded and `stat_bgwriter` ran cleanly. Now
point that self-metric at the collector you were looking for:

```promql
pg_scrape_collector_success{collector="stat_checkpointer"}
```

```text
Empty query result
```

And that is the answer, which the `grep` already gave you. The exporter
emits a success and a duration series for every collector it *runs*, so had
`stat_checkpointer` run and found nothing, the string `checkpointer` would
still have appeared in `/metrics`. It appeared zero times. The collector is
not running at all — a different fault from "it ran and the view was empty",
and one that sends you looking elsewhere.

Why it is not running, the wire cannot say — it may be off by default here,
or this build may decline to register it against this server version. The
exporter's own `--help` is where to look next. What it *does* ship is the old
family, under the old name:

```promql
{__name__=~"pg_stat_bgwriter_.*"}
```

Four series come back: `pg_stat_bgwriter_buffers_alloc_total`,
`pg_stat_bgwriter_buffers_clean_total`,
`pg_stat_bgwriter_maxwritten_clean_total` and
`pg_stat_bgwriter_stats_reset_total`. No checkpointer family, and no
checkpointer collector. Which metrics you get depends on the *server*
version, the *exporter* version and the interaction between them, and no
single piece of documentation describes that — which is why the only reliable
source is the exposition in front of you.

!!! trap "The lab's own verify script believed the documentation"
    The first version of `scripts/verify-ch22.sh` asserted the checkpointer
    family was present, because whoever wrote it reasoned from the release
    notes and the collector list instead of from a running exporter. Its
    first live run failed — one line in a real terminal, wrapped here to fit
    the page:

    ```text
    FAIL pg_stat_checkpointer metrics are present (PG 18) — got
         0 series, want at least one series
         → expression: {__name__=~"pg_stat_checkpointer_.*"}
    ```

    The fix went into the script, not the lab: it now asserts the four
    `pg_stat_bgwriter_*` counters and the checkpointer family's absence. The
    lab's own authors made this chapter's mistake first.

## A checklist beats a catalog

There are hundreds of exporters, and a list of them is out of date before it
is printed: two of the four here changed something load-bearing in the last
two years, and a third changed its name before that. Here is what does not
rot — five questions to ask about any exporter before you deploy it, all
answerable in about ten minutes.

**Is it maintained?** When was the last release, and was it a real one or a
dependency bump? An exporter whose last release predates your database's last
major version will be missing metrics for exactly the features you care
about — as you just watched happen.

**Does it follow the conventions?** Read fifty lines of its `/metrics`. Are
counters suffixed `_total`? Are durations in seconds and sizes in bytes? Is
there a `# HELP` on every family? A metric called `something_latency_ms`
tells you the author has not read the naming conventions, which tells you
what else to expect.

**Is its cardinality bounded?** This is the one that will hurt you. Look for
labels whose values come from *data* rather than *configuration*: a customer
ID, a table name in a growing schema, a full URL path. Then do Chapter 7's
multiplication with your own numbers. cAdvisor is fine because its label
values come from your container list; it would not be if it copied every
container label, which is why that was turned off by default.

**Can you read its `/metrics` and understand it?** Not "does it produce
metrics" — can you work out what a number means? If the HELP strings are
empty and the names are abbreviations, then at 3 a.m. this exporter is
decoration.

**Does it support multi-target mode?** One exporter process per database
server is a lot to run and upgrade; one that can be told which target to
inspect per scrape is a single deployment instead of fifty. That is
Chapter 23's subject, and worth checking before you commit to a topology.

Apply all five to `postgres_exporter` in your lab: released this year,
conventional names, bounded cardinality, readable output, multi-target
capable. It scores well. It also does not have the checkpoint metrics. Both
are true, and only one is in any README.

## The textfile collector

Some things that produce numbers are not services and never will be. A
nightly backup runs for four minutes and exits; a cron job rotates
certificates once a week. There is no process to scrape: by the time you
would, it is gone.

For anything **tied to a specific machine**, the answer is node_exporter's
textfile collector. It needs one flag, which the lab already sets:
`--collector.textfile.directory=/textfile`. On every scrape it reads every
`*.prom` file in that directory, parses it as exposition format, and serves
the contents alongside its own metrics. Your batch job's only job is to write
the file. From `scripts/backup-example.sh`:

```bash
M=obslab_backup_last_success_timestamp_seconds
H='Unix timestamp of the last successful lab backup run.'

{
  echo "# HELP $M $H"
  echo "# TYPE $M gauge"
  echo "$M $END"
} > "$TMP"

mv "$TMP" "$OUT"
```

Write to a temporary file, then `mv` it into place. That rename is atomic on
a local filesystem, so node_exporter sees either the old file or the new one,
never a half-written one. Skip it and you will eventually scrape a truncated
file, which fails to parse — and *that* is what `node_textfile_scrape_error`
is for.

Two details are deliberate. It records not "the backup took 43 seconds" but
"the backup last succeeded at this Unix timestamp": freshness is what you
alert on, because a job that stopped running produces no duration at all.
And the prefix is `obslab_`, not `snip_` — Chapter 5's naming law wants an
application prefix, and there is no application. Run it:

```bash
./scripts/backup-example.sh
```

Wait one scrape interval — fifteen seconds — and ask Prometheus:

```promql
obslab_backup_last_success_timestamp_seconds
```

There it is, carrying `job="node-exporter"` and `instance="node-exporter-1"`
like everything else that job produces, because as far as Prometheus is
concerned it *is* node_exporter's metric. That is the design: no new target,
no new port, no new failure mode, and `up` still means what it always
meant.

The collector also reports on itself:

```promql
node_textfile_mtime_seconds
```

One series per file, labeled `file`, carrying its modification time — so you
can alert on "this file has stopped being written" even if you cannot parse
what is inside. And the alert you actually wanted:

```promql
time() - obslab_backup_last_success_timestamp_seconds > 86400
```

`time()` is the evaluation timestamp, so this reads "more than a day has
passed since the last success". A run that fails leaves the old timestamp in
place and the number climbs; a run that never starts does the same. Both
failures produce one alert, which is correct.

!!! selfcheck "Self-check"
    Run `make verify-ch22`. It should end `0 failed` and `ch22 OK`. Among
    the assertions:

    ```text
    PASS the node-exporter job is up
    PASS the cadvisor job is up
    PASS the postgres-exporter job is up
    PASS the root cgroup is dropped
    PASS catalog is being CFS-throttled
    PASS pg_stat_checkpointer_* is absent, as ch22 shows
    PASS node_textfile_mtime_seconds is present
    PASS the custom backup metric arrived
    ```

    If the throttling line fails, check that `loadgen` has been running a
    couple of minutes: the assertion uses a five-minute rate window. If it
    and `the cadvisor job is up` fail together, cAdvisor did not start — see
    the `devices:` note earlier.

    This script has not yet been run end to end against a `ch22` stack. If
    anything else fails on a lab that looks healthy, write it down rather
    than working around it.

## The Pushgateway, and why it is not in your compose file

The instinct almost everyone has here is that a script should *push* its
numbers somewhere — it is how StatsD and most pre-Prometheus systems work.
Prometheus has a component for that, the Pushgateway, and this lab does not
use it. Knowing why matters, because "we don't do that here" is not an
argument you can take to a colleague.

The Pushgateway is a small server you `POST` metrics to; Prometheus then
scrapes it. Its own documentation names exactly one case: the outcome of a
*service-level* batch job, not tied to a particular machine, whose identity
is the service rather than the host that ran it. If your job is tied to a
machine, the textfile collector is the documented answer.

Three properties make it the wrong default. It is a single point of failure:
route many jobs through it and one box's death blinds all of them. You lose
`up`, because Prometheus generates that signal for the *Pushgateway* and not
for your job, so "the job is down" and "the job has not pushed yet" stop
being distinguishable. And it never forgets: a series pushed once is served
until somebody deletes it by hand, so a decommissioned job leaves a
permanently stale value behind. The missing time-to-live is a design
position, not an oversight.

If you do use it, one setting is mandatory. Prometheus normally overwrites a
scraped target's `job` and `instance` with the scrape job's own values; for
the Pushgateway that is backwards, because the pushed `job` is the real one.
Its scrape config needs `honor_labels: true`, from Chapter 12 — without it
every pushed series arrives labeled `job="pushgateway"`, which looks
plausible and is useless.

Push is not forbidden, it is just not the Pushgateway's job. Two push-shaped
paths are in the chapters ahead — remote write in Chapter 26, "When One
Prometheus Isn't Enough: HA, `remote_write`, and the Scaling Map", and the
OpenTelemetry receiver in Chapter 28, "OpenTelemetry and Prometheus".

## windows_exporter, in one paragraph

If you have Windows hosts, the equivalent of node_exporter is
`windows_exporter`, currently **v0.31.8**, on port **9182** — not 9100, which
is the most common mistake when adding it to a scrape config. The normal
deployment is the MSI installer, which registers a Windows service. It was
renamed from `wmi_exporter` years ago, so any tutorial using that name
describes a project that no longer exists. Point the checklist at its
`/metrics` and read the names off the wire, as you just did with
PostgreSQL.

## Common mistakes

**Installing node_exporter and looking for your application's metrics.** It
reports the host and only the host. Nothing in `node_*` knows your request
rate exists.

**Summing cAdvisor series without `{name!=""}`.** The root cgroup is the sum
of every container, so including it doubles every total. The lab drops it at
the scrape — type the filter anyway, so it is a habit the day you read
somebody else's Prometheus.

**Alerting on the friendlier-looking name of an adjacent pair.**
`container_memory_usage_bytes` counts reclaimable page cache;
`node_filesystem_free_bytes` counts space your non-root process cannot have.
The matching error is dividing by a limit without checking it is non-zero.

**Reading an average and concluding there is headroom.** A quota is enforced
inside a 100 ms window, and no five-minute average shows what happened inside
one.

**Trusting a metric name because a blog post used it.** `curl` the exporter
and grep before you write the alert, not after it fails to fire.

## Summary

An exporter is a translator and nothing more. It reads state you do not own —
the kernel's, the container runtime's, a database's — and republishes it in
the exposition format so Prometheus can pull it the way it pulls Snip.
Nothing about the data model, PromQL, dashboards or alerting changes; what
changes is that you now depend on somebody else's judgment about names, units
and cardinality. You added three exporters, built a USE row for each layer,
and found that the one slow route came from a `cpus: "0.15"` line typed in
Chapter 4 — visible only as CFS throttling, on a container whose average CPU
usage looked like nothing at all.

The things to still know in six months:

- RED describes services and pages; USE describes resources and tickets. A
  USE row is built from your list of resources, not from the metric list an
  exporter happens to offer, and "not measurable here" is a real answer.
- Saturation is the half of USE people skip and the half that predicts pain,
  because utilization is bounded and saturation is not.
- node_exporter's CamelCase names are copied verbatim from `/proc/meminfo`:
  faithfulness to the source beats conformity to a convention.
- Of each adjacent pair, the smaller name is the one to alert on: `avail` over
  `free`, `MemAvailable` over `MemFree`, working set over usage.
- `predict_linear` over a long, fixed range turns a threshold alert into a
  trend alert.
- Exporters churn, and the exposition is the only source that cannot be
  out of date. A checklist replaces any catalog.
- For a machine-tied batch job, write a `.prom` file atomically into the
  textfile directory. Almost everywhere else the Pushgateway is wrong, and
  losing `up` is why.

## Exercises

!!! exercise
    **1. Five percent you cannot have (warm-up).** Write two alerting rules
    on the same mountpoint at the same threshold, one on
    `node_filesystem_free_bytes` and one on `node_filesystem_avail_bytes`.
    Run the subtraction and write down the gap for each filesystem your host
    reports, plus that gap as a fraction of `node_filesystem_size_bytes`.
    Explain, with your own numbers, which rule would have let a non-root
    process hit "no space left on device" without firing.

    **2. Divide by zero on purpose (warm-up).** Add a panel to a scratch
    dashboard dividing `container_memory_working_set_bytes{name!=""}` by
    `container_spec_memory_limit_bytes{name!=""}` with no guard; unit
    `percentunit`, max 1. Record what it shows for `obslab-pager-1`, then add
    the `> 0` guard and record what changes — including what happens to the
    *other* series.

    **3. Score a stranger (core).** Pick an exporter you have never used for
    a system you actually run. Answer all five checklist questions against
    its repository and, if you can start it, against fifty lines of its real
    `/metrics`. Write three lines: what worried you most, what reassured you
    most, and whether you would deploy it.

    **4. Choose a window and defend it (core).** Write your own
    `predict_linear` rule for disk exhaustion within four hours. Then make
    the disk actually move: append to a large scratch file on a filesystem
    node_exporter reports, in a loop, for ten minutes, then delete it. Run
    your expression with `[15m]`, `[1h]` and `[6h]` ranges during and after,
    and record all six values. Say which window you would ship, and what
    failure each of the other two produces.

    **5. A backup that can go wrong (core).** Extend
    `scripts/backup-example.sh` to publish the job's exit code as a second
    gauge, written even when the job fails. Write a rule that fires when
    there has been no successful run in 26 hours, and confirm it by editing
    the timestamp in the `.prom` file to two days ago. The rule should reach
    `firing` with `node_textfile_scrape_error` still at 0.

    **6. Two right answers (stretch).** Describe one batch job for which the
    Pushgateway is genuinely correct and one for which the textfile collector
    is clearly better. Name the property that decides each, say what breaks
    if you swap them, and say what you lose in both cases that an ordinary
    scraped target gives you for free.
