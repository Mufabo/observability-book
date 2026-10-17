# Chapter 22 — Metrics From Things You Didn't Write

Redirect latency doubled overnight and you shipped nothing. No deploy, no
config change, no traffic spike. The RED dashboard from Chapter 14,
"Dashboards That Tell the Truth", says the request rate is normal, the error
ratio is flat, and the ninety-fifth percentile has moved from a hundred and
ten milliseconds to two hundred and forty. Every panel on it is drawn from
metrics your own code emits, and every one of them is telling you the truth.
None of them can tell you why.

That is not a gap in your instrumentation. It is a gap in *what you have
instrumented*. Snip runs on a machine with a finite number of CPU seconds per
second, inside a container with a memory limit somebody typed once, talking
to a PostgreSQL server with a finite number of connection slots. You did not
write the kernel, the container runtime, or PostgreSQL, and none of them
imports a Prometheus client library. Right now, everything underneath your
code is invisible.

This chapter makes it visible, and the good news is that almost nothing new
is involved. An **exporter** is a small program that reads somebody else's
state and republishes it in the exposition format from Chapter 2, "What's
Actually on the Wire". Prometheus scrapes it exactly the way it scrapes Snip.
The series land in the same database, answer the same PromQL, draw on the
same dashboards, and fire the same alerting rules. The only genuinely new
skill in this chapter is judging whether the exporter in front of you can be
trusted — and, as you will see with PostgreSQL, the answer is sometimes no.

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
`catalog`, `loadgen`, Prometheus, Grafana, Alertmanager and the pager.

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
injector into a known, boring state — this chapter is about a problem that is
there whether or not you provoke one:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","error_ratio":0}'
```

The `ch22` tag adds three services to `compose.yaml` and three jobs to
`prometheus.yml`. Open the targets page at
`http://localhost:9090/targets`. Three new rows are there:
`node-exporter`, `cadvisor` and `postgres-exporter`, each with one target,
each reading UP. That is the entire lab step for the "install an exporter"
part of this chapter, which is rather the point. To recreate it, check out
`ch21` and add the three services and jobs from the excerpts in this chapter.

## An exporter is a translator, and that is all it is

There are exactly three ways a number gets into Prometheus, and it is worth
being able to name all three before you meet a strange one.

**Direct instrumentation** is what you have been doing since Chapter 5, "Your
First Counter: Instrumenting Code You Own": your process imports a client library, holds the counters in
memory, and serves them on its own `/metrics`. This is always the best option
when you control the code, because the process knows things nobody outside it
can see — which route, which cache result, which database operation.

**A single-target exporter** is a separate process that reads one system's
state and republishes it. `node_exporter` reads `/proc` and `/sys`. cAdvisor
reads the container runtime and the kernel's control groups.
`postgres_exporter` opens a SQL connection and selects from the statistics
views. Prometheus scrapes the exporter directly, so the exporter's own
address is what ends up in `instance`.

**A multi-target exporter** is one process that inspects *many* things, told
which one to look at per scrape through a URL parameter. That inversion needs
a chapter of its own.

!!! iou "IOU — chapter 23"
    The third category behaves differently enough from the first two that it
    gets its own chapter. Chapter 23, "The Multi-Target Pattern: Probing From
    Outside", builds it from the relabeling you already know. Everything in
    *this* chapter is category two, and category two is boring on purpose.

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

Look at where the arrows point in the middle row: the exporter pulls from the
system and Prometheus pulls from the exporter, so the pull model from Chapter
1 is unbroken all the way down. That is what makes exporters so unexciting to
operate, and it is the single most useful thing to understand about them.

Everything you already know still applies, unchanged. A dead exporter shows
up as `up == 0`, exactly like a dead application. Its series carry `job` and
`instance` because the scrape attaches them, exactly like your own. Chapter
12's relabeling works on them — in fact the three new jobs in `prometheus.yml`
reuse the same seven relabel rules as every other job, with one string
changed. And Chapter 7's cardinality arithmetic applies with a vengeance,
because an exporter you did not write has no idea what your series budget is.

## USE: the question RED cannot ask

RED describes a thing that serves requests: **R**ate, **E**rrors,
**D**uration. It is the right frame for Snip and a poor frame for a disk.
A disk does not have an error ratio you would page on, and "how long did the
disk take" is not a question with one answer.

The counterpart is **USE**, named by Brendan Gregg for resources rather than
services: for every resource, measure **U**tilization, **S**aturation and
**E**rrors. Utilization is the fraction of time the resource was busy.
Saturation is the amount of work that could not be served immediately and had
to wait. Errors is the count of things that outright failed.

The one people skip is saturation, and it is the one that predicts pain.
Utilization is bounded — a CPU cannot be more than 100% busy, a memory limit
cannot be more than fully used — so a utilization graph flattens exactly when
things start getting bad and tells you nothing more. Saturation is unbounded.
It keeps climbing while the queue grows, which is precisely the period during
which your users are noticing and your utilization panel is a flat line at
the top of its axis.

Here is the USE row for every layer under Snip. Every metric named is one the
three new exporters actually publish.

| Resource | Utilization | Saturation |
|---|---|---|
| Host CPU | busy fraction | run queue per core |
| Host memory | 1 − available/total | swapping, OOM kills |
| Host disk | seconds of I/O per second | queue-weighted I/O time |
| Container CPU | cores used | CFS throttling |
| Container memory | working set ÷ limit | OOM kills |
| Postgres | backends ÷ max_connections | refused connections |

RED and USE answer different questions and neither substitutes for the other.
RED told you latency doubled. USE is going to tell you why.

## node_exporter: the host, whatever the host turns out to be

`quay.io/prometheus/node-exporter:v1.12.1`, port **9100**. It reads the Linux
kernel's own accounting — `/proc`, `/sys`, the loadavg, the mount table — and
publishes it. It knows nothing about your containers and nothing about your
application, which is a routine source of confusion: people install
node_exporter, look for their request rate, and conclude the exporter is
broken.

### The Docker Desktop caveat, stated once

If you are on Docker Desktop, on macOS or Windows, there is no Linux host.
Your containers run inside a lightweight Linux virtual machine, and
node_exporter reports that VM. The disks will be unfamiliar, the network
interfaces will not be the ones on your laptop, and the memory total will be
whatever you granted Docker in its settings. This is expected. Every number in
this section is real; it is just real about the VM.

The lab's `node-exporter` service also joins `obsnet` like everything else,
rather than using host networking. The upstream documentation reaches for
`--net=host`, and on a real Linux server that is right. Here it would make the
container unreachable as `node-exporter:9100` from Prometheus and break the
whole lab, and on Docker Desktop it would not buy you your laptop's metrics
anyway. What the lab does instead is mount the host's root filesystem
read-only and point the exporter at it:

```yaml
  node-exporter:
    image: quay.io/prometheus/node-exporter:v1.12.1
    pid: host
    command:
      - --path.rootfs=/host
      - --collector.textfile.directory=/textfile
    volumes:
      - /:/host:ro
      - ./textfile:/textfile:ro
    ports:
      - "9100:9100"
```

`--path.rootfs=/host` tells the exporter that what looks like `/host` to it is
`/` to everyone else, so the mount points it reports come out with sane names.

!!! trap "`rslave` fails on Docker Desktop, and takes three services with it"
    Upstream's own documentation mounts the root filesystem as `/:/host:ro,rslave`,
    so that filesystems mounted *after* the exporter starts become visible to it.
    Docker Desktop cannot do that: its `/` lives in the LinuxKit VM and is neither
    a shared nor a slave mount. Add `rslave` here and `make up` prints

    ```text
    Error response from daemon: path / is mounted on / but it is
    not a shared or slave mount
    ```

    and — because Compose aborts on the first error — `edge` and `loadgen`
    never start either. One bad mount option, three dead services, and an error
    message that names none of them. Plain `ro` works everywhere. On a real
    Linux server, put `rslave` back.

### Why the names are shouting

Run this in the Prometheus expression browser:

```promql
node_memory_MemAvailable_bytes
```

`MemAvailable`, in the middle of a metric name, in CamelCase, in a system
whose naming convention is rigorously lower_snake_case. It looks like
somebody was careless. It is the opposite. The meminfo collector builds each
name as the namespace `node`, the subsystem `memory`, and then the field name
taken verbatim from `/proc/meminfo`. The kernel writes `MemAvailable:`, so
the exporter writes `MemAvailable`. Translating it to `mem_available` would
mean inventing a mapping, and the first time the kernel added a field the
mapping would be wrong in a way nobody could grep for.

That is a principle worth carrying to every exporter you meet: **faithfulness
to the source beats conformity to the convention**, because a name you can
trace back to a kernel field is a name you can look up.

### `avail`, not `free`

Two pairs of names in node_exporter differ by one word and mean genuinely
different things, and both traps cost people incidents.

For memory, `node_memory_MemFree_bytes` is memory holding nothing at all.
Linux deliberately keeps that number small, because unused RAM is wasted RAM
— the kernel fills it with page cache and gives it back the moment a process
needs it. `node_memory_MemAvailable_bytes` is the kernel's own estimate of
what a new process could actually get. Use available. Alerting on free means
alerting on a healthy machine.

For filesystems, the pair is subtler and worse:

```promql
node_filesystem_free_bytes - node_filesystem_avail_bytes
```

Both are gauges, per `device`/`mountpoint`/`fstype`. `free` is the total free
space on the filesystem. `avail` is the space available *to processes that are
not root*, and on ext4 the difference is the reserved block percentage, which
defaults to 5% of the filesystem. Run that subtraction against your own lab
and read the numbers off: on a 100 GB filesystem, `free` is five gigabytes
larger than `avail`, permanently, on a completely healthy disk.

Now imagine the alert. You alert on `free < 5 GB` and your application, which
does not run as root, hit "no space left on device" some time ago. The
filesystem is full from your process's point of view while the metric you
chose still reads five gigabytes of headroom. Alert on `avail`. The lab's disk
alert does, and so does the USE dashboard.

### The host's USE row, in three expressions

Utilization for the CPU is derived from idle time, because idle is the one
mode every kernel reports identically:

```promql
1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))
```

Saturation is the run queue, and it only means anything per core:

```promql
node_load1 / scalar(count(count by (cpu) (node_cpu_seconds_total)))
```

The inner `count by (cpu)` produces one element per CPU and the outer `count`
counts them. `scalar()` turns that one-element result into a plain number,
which matters: `count()` returns a series with *no* labels, `node_load1`
carries `job`, `instance` and `env`, and Chapter 11's one-to-one matching
would find no pair with identical label sets and return an empty result with
no error at all. Divided this way, 1.0 means the machine is exactly full
however many cores it has.

Memory utilization is the available/total pair from earlier:

```promql
1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes
```

Those three, plus disk and network, are the top row of
`dashboards/snip-use.json`, which the `ch22` tag provisions for you.

### Collectors, and the ones the lab throws away

node_exporter is a bundle of about fifty **collectors**, each responsible for
one subsystem, most of them on by default. You turn one on with
`--collector.<name>` and off with `--no-collector.<name>`. The `textfile`
collector is one of them and gets its own section later.

The lab drops three families at scrape time, in `prometheus.yml`:

```yaml
    metric_relabel_configs:
      - source_labels: [__name__]
        regex: node_(scrape_collector_.*|cpu_guest_seconds_total|softnet_.*)
        action: drop
```

Per-collector timing self-metrics, guest CPU time nobody in this lab runs, and
the softnet counters. Nothing reads them, and Chapter 12 taught you that the
cheapest series is the one you never store. Note where the rule lives:
`metric_relabel_configs`, which runs on samples coming back from a scrape, not
`relabel_configs`, which runs on targets before one happens.

Even after the drop, count what you just bought:

```promql
count({job="node-exporter"})
```

On the measured run of the finished lab, node-exporter contributed **1,001**
series. Yours will differ, because that number scales with how many
filesystems and network interfaces your host has. Compare it with `snip-api`
at 170 and `snip-worker` at 63. One `docker compose` entry you did not write
has produced several times more series than everything you have instrumented
by hand. That is normal, it is worth knowing, and it is why every exporter
gets a cardinality question asked of it.

## cAdvisor: your own containers, from underneath

`ghcr.io/google/cadvisor:v0.60.5`, published on host port **8085** because
8080 already belongs to `edge`. If you find a tutorial pointing at
`gcr.io/cadvisor/cadvisor`, it predates v0.53.0 and that registry is dead.

cAdvisor reads the kernel's control groups and reports per-container CPU,
memory, network and filesystem usage. It is the one exporter in this chapter
that measures *your own code* — from the outside, which turns out to be the
only place some of these facts are visible at all.

!!! jargon "cgroup"
    A **control group** is a Linux kernel feature that puts a set of processes
    into a box with accounting and limits attached: this box may use 0.15 of a
    CPU and 256 MB of memory, and here are counters for what it has used. A
    container is a cgroup plus a filesystem plus some namespaces. Everything
    cAdvisor reports about resource use, it reads out of the cgroup — which is
    why it can see a limit your process cannot.

### The Docker Desktop box, printed on purpose

cAdvisor needs more privilege and more mounts than anything else in this lab,
and getting one of them wrong produces a container that starts, serves
`/metrics`, and quietly reports almost nothing.

!!! warning "Running cAdvisor on Docker Desktop"
    The lab's service is this, and every line earns its place:

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
    ```

    `/sys` is where the cgroup accounting lives; without it there are no
    resource numbers. `/var/lib/docker` is how cAdvisor maps a cgroup back to
    a container name; without it your series arrive with unreadable
    identifiers and no `name` label you would want to group by. `/var/run`
    reaches the container runtime, and `--docker_only=true` keeps cAdvisor to
    containers rather than every cgroup on the machine.

    Three Docker Desktop differences to expect. Some disk and memory figures
    are missing or read zero under cgroup v2 — that is the platform, not a
    misconfiguration. The image's `ENTRYPOINT` is the cAdvisor binary, so the
    `command:` above is *appended* rather than replacing anything, and Chapter
    1's Compose override trap does not apply here. And `--store_container_labels`
    now defaults to `false`; older posts telling you to set it explicitly are
    describing a cardinality bomb that has already been defused.

### The `name` label, and the cgroup that is all of them

cAdvisor emits a series for every cgroup it can see, including the root — the
box that contains every other box. The root cgroup has no container, so its
`name` label is the empty string, and its numbers are the sum of everything
below it. Include it in a `sum by (name)` and every total is exactly double
what it should be, with no error and no warning.

The universal fix is `{name!=""}` on every cAdvisor selector, and you should
write it out of habit. In this lab you do not have to, because the scrape
config removes those series before they are ever stored:

```yaml
      - source_labels: [__name__, name]
        separator: ";"
        regex: container_.*;
        action: drop
```

Two source labels joined by `;`, so a series called `container_anything` whose
`name` is empty produces `container_anything;` and matches. The four drop
rules in that job — this one plus three families the lab never reads — are
modeled on kube-prometheus's own rules, and without them cAdvisor alone
contributes several thousand series. With them it contributed **1,166** on the
measured run. That number scales with the number of containers you are
running, so it will drift as the book adds services.

### Working set, not usage

Two memory gauges, one right answer:

```promql
container_memory_usage_bytes{name=~"obslab-snip-api-.*"}
```

```promql
container_memory_working_set_bytes{name=~"obslab-snip-api-.*"}
```

Run both. `usage` is the larger of the two, and on a container that has been
serving traffic for a while it sits close to the limit. `working_set` is
lower, and it is the one that matters.

The difference is page cache. When a process reads a file, the kernel keeps
the contents in memory in case it is read again, and charges that memory to
the container's cgroup. `usage` counts it. But that cache is *reclaimable*:
the moment the container needs memory for something real, the kernel throws
the cache away and hands the pages over. `working_set` is usage minus the part
that can be reclaimed, which makes it the number the kernel's out-of-memory
killer is effectively looking at when it decides whether this container has
exceeded its limit.

!!! pitfall "Alerting on `container_memory_usage_bytes`"
    A container reading a lot of files will sit at 95% of its limit
    indefinitely, in perfect health, because almost all of it is cache. Alert
    on `usage` and you get a page every night from every container that
    touches disk, you learn to ignore it, and then you ignore the one that was
    about to be killed. This is the most common false-alarm generator in
    container monitoring and it comes from choosing one of two adjacent metric
    names.

### Memory as a share of the limit, and the zero that ruins it

The useful question is not how many bytes a container holds but how close it
is to the ceiling somebody set for it. The obvious expression is a division:

```promql
container_memory_working_set_bytes{name!=""}
/
container_spec_memory_limit_bytes{name!=""}
```

Run it and read the table. Most rows are sensible fractions. At least one row
— `obslab-pager-1` — reads `+Inf`. The `pager` service is the one service in
the lab with no `mem_limit` at all, and cAdvisor reports an unset limit as
`0`. You have divided by zero, Prometheus has cheerfully given you infinity,
and on a Grafana panel with a 0–1 axis that row draws as nothing at all while
poisoning every legend calculation on the panel.

Chapter 9 gave you the tool. A comparison operator used as a *filter* drops
elements that fail it, so putting the guard on the denominator removes the
unlimited containers from the result entirely:

```promql
container_memory_working_set_bytes{name!=""}
/
(container_spec_memory_limit_bytes{name!=""} > 0)
```

`obslab-pager-1` is now absent from the result, which is the honest answer: a container
with no limit has no percentage of a limit. That expression, with the guard,
is exactly what ships in the lab's `ContainerNearMemoryLimit` alert.

Both sides of that division carry identical label sets, so Chapter 11's
one-to-one matching pairs them up with no help. When the two sides *do not*
match — which is the usual case the moment you join an exporter's series to
anything else — you need `on (...)` and, where one element on the right serves
many on the left, `group_left`. Here is that shape doing real work, asking
what share of the host's memory each container is holding:

```promql
sum by (name) (container_memory_working_set_bytes{name!=""})
/ on () group_left()
sum(node_memory_MemTotal_bytes)
```

`on ()` says "match on no labels at all", collapsing both sides into one
group; `group_left()` says the left side is the many. Without it, Prometheus
refuses the query rather than guessing. Note also that this joins a cAdvisor
series to a node_exporter one across two different jobs and two different
`instance` values, and it works, because after `on ()` neither of those labels
is part of the match.

## The incident: slow, and its CPU looks fine

Now go back to the latency. Snip calls `catalog` on part of its read path, so
if `catalog` got slower, Snip got slower. Ask the obvious question first:

```promql
topk(5, sum by (name) (
  rate(container_cpu_usage_seconds_total{name!=""}[5m])
))
```

That is CPU seconds consumed per second, which is to say cores. On one run of
this lab the top row is `obslab-catalog-1` at about **0.14** cores, on a host
with several idle ones. Nothing here looks like a problem. A machine that is
mostly idle running a container that is using a seventh of one core is the
picture of a healthy system, and this is the panel that appears on every
container dashboard ever built.

Now ask the saturation question:

```promql
topk(5, sum by (name) (
  rate(container_cpu_cfs_throttled_seconds_total{name!=""}[5m])
))
```

`obslab-catalog-1` comes back around **0.35**, and everything else is zero.

Read that unit carefully, because it is the whole trick. This is a counter of
*seconds the container spent stopped, waiting for CPU it was not allowed to
have*, and `rate` turns it into seconds per second. A value of 0.35 means
that for roughly a third of every wall-clock second, this container had work
ready to run and the kernel refused to schedule it.

The Linux scheduler enforces a CPU limit with a quota per period: the cgroup
gets *N* microseconds of CPU in every 100 ms window, and when it has spent
them, every thread in it is frozen until the window rolls over. That is
**CFS throttling**, after the Completely Fair Scheduler. It does not slow your
process down evenly; it stops it dead, repeatedly, in bursts of up to a
hundred milliseconds. That is what your latency histogram is measuring.

And now look at `compose.yaml`:

```yaml
  catalog:
    build: ./catalog
    cpus: "0.15"
    mem_limit: 256m
```

There it is. Fifteen hundredths of a CPU. The container is using 0.14 cores
because 0.15 is all it may have — the "unremarkable" usage number was
unremarkable only because you did not know what its ceiling was. This limit
has been in the file since `catalog` arrived in Chapter 4, and nothing in the
lab could observe it until ten minutes ago.

This is why utilization alone is a bad safety net, and why saturation belongs
on the same row of the same dashboard. Open `http://localhost:3000/d/snip-use`
and look at the two container CPU panels side by side: usage on the left,
throttling on the right, both grouped by `name`. Both use
`[$__rate_interval]` rather than the literal `[5m]` you typed above, for the
reason Chapter 13 gave — a panel's rate window has to follow the panel's
width. The left panel has looked like that for eighteen chapters.

## Three alerts, one per layer

The `ch22` tag adds three rules to `prometheus/rules/meta-alerts.yml`, one for
each layer you just gained visibility into. Reload with `make reload` if you
edit them; they are already loaded at this tag.

The first is a *trend* alert rather than a threshold, and it is the best
example in the book of why that distinction matters. A disk that has sat at
91% for a year is not an incident. A disk at 60% filling by ten gigabytes an
hour is.

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
    Chapter 4 promised that the gauge contract buys you two functions a
    counter can never have, and named `predict_linear()` as the second of
    them. Here it is. `predict_linear(v[6h], 14400)` fits a least-squares
    straight line through six hours of samples and reports where that line
    will be 14,400 seconds — four hours — from now. It is gauge-only for the
    same reason `deriv()` is: it is meaningful precisely because the value is
    allowed to fall.

Three choices in that rule are worth defending. The range is `[6h]`, not the
`$__rate_interval` you would use on a panel: this is a trend estimator's
memory, not a display window, and it must not change meaning when somebody
drags the time picker. Six hours is long enough that a single compaction
writing a gigabyte does not swing the slope, and short enough that a leak
starting this morning shows up before lunch. The horizon is four hours because
that is roughly how long a human takes to notice a ticket, find the growing
directory and delete something. And `fstype!~` excludes the pseudo-filesystems
whose "free space" is not a thing you can run out of by writing files.

The `and on (instance, mountpoint)` clause is the part most people leave out.
A read-only filesystem that is already nearly full satisfies the prediction
forever, and no amount of paging anybody will fix it — a permanently firing
ticket, which is exactly the alert fatigue Chapter 19's noise audit teaches
you to hunt. Matching on `(instance, mountpoint)` rather than a bare `and`
also survives node_exporter adding a label to one family and not the other.

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

Working set, not usage. The `> 0` guard, so `pager` is excluded rather than
permanently over threshold at `+Inf`. And `for: 10m`, because a container that
touches 91% during a garbage collection and comes back down is not news.

The third belongs to PostgreSQL, and needs its exporter first.

## postgres_exporter, and the metric that was not there

`quay.io/prometheuscommunity/postgres-exporter:v0.20.1`, port **9187**. Note
the registry: this one lives under the `prometheuscommunity` organization, not
the Prometheus organization the other two came from. Community exporters are
where most of the ecosystem lives, and the ownership question is the first
line of the checklist for a reason.

It connects with a DSN, and the lab creates a dedicated role for it in
`postgres/initdb/02-exporter.sql`:

```sql
CREATE ROLE postgres_exporter WITH LOGIN PASSWORD 'exporter';

GRANT pg_monitor TO postgres_exporter;
```

`pg_monitor` is a built-in PostgreSQL role that grants read access to exactly
the statistics views a monitoring agent needs, and nothing else. Those two
lines are the difference between an exporter that can read your query
statistics and an exporter that can drop your tables. An exporter is a
long-lived network-reachable process that only ever needs to read; give it a
role that can only read.

The third alert uses two of its series:

```promql
sum by (job, instance) (
  pg_stat_database_numbackends{job="postgres-exporter"}
)
/ on (job, instance)
pg_settings_max_connections{job="postgres-exporter"}
```

Connections are a saturation metric with a hard wall. PostgreSQL does not
queue connections past `max_connections`; it refuses them. So the errors this
saturation produces do not appear in any PostgreSQL metric — they appear in
Snip's own 500s, on the RED dashboard, looking like an application bug. The
alert fires at 0.8 with `for: 10m`, giving you the connection graph before you
get the mystery.

### The lesson you actually came for

Now the part that matters more than any individual `pg_*` name. Version 0.20.0
of this exporter renamed the `replication_slot` collector to
`replication_slots`, and re-prefixed its metrics from `pg_replication_slot_*`
to `pg_replication_slots_*`. Every dashboard, alert and blog post written
before mid-2026 uses the old spelling, and every one of them now silently
returns nothing. That is what an exporter upgrade can do to you, and it is why
the lab pins `v0.20.1` exactly rather than a floating tag.

Then there is the sharper version of the same problem, which you can see on
your own machine right now. PostgreSQL 17 split the `pg_stat_bgwriter` view,
moving the checkpoint counters out into a new `pg_stat_checkpointer` view. The
lab runs PostgreSQL 18. The exporter has a `stat_checkpointer` collector in
its collector list. Everything says these metrics should be here. So:

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

What is actually there is the old family, under the old name:

```promql
{__name__=~"pg_stat_bgwriter_.*"}
```

Four series come back: `pg_stat_bgwriter_buffers_alloc_total`,
`pg_stat_bgwriter_buffers_clean_total`,
`pg_stat_bgwriter_maxwritten_clean_total` and
`pg_stat_bgwriter_stats_reset_total`. No checkpointer family at all. The
server moved the counters; the exporter has not picked them up under the new
name; and which metrics you get depends on the *server* version and the
*exporter* version and the interaction between them, which no single piece of
documentation describes.

!!! trap "The lab's own verify script believed the documentation"
    The first version of `scripts/verify-ch22.sh` asserted that the
    checkpointer family was present, because whoever wrote it reasoned from
    the PostgreSQL release notes and the exporter's collector list instead of
    from a running exporter. Its first live run failed:

    ```text
    FAIL pg_stat_checkpointer metrics are present (PG 18) — got
         0 series, want at least one series
         → expression: {__name__=~"pg_stat_checkpointer_.*"}
    ```

    The fix went into the script, not the lab. It now asserts what the
    exporter really ships — the four `pg_stat_bgwriter_*` counters — and that
    the checkpointer family is absent, and `make verify-ch22` prints
    `PASS pg_stat_checkpointer_* is absent, as ch22 shows`. That first failure
    is the cheapest possible demonstration of this chapter's thesis: **the
    metric the documentation implies is not always the metric the exporter
    ships**, and the only way to know is to read the exposition.

## A checklist beats a catalog

There are hundreds of exporters. A list of them in a book is out of date
before it is printed — three of the four in this chapter changed something
load-bearing in the last two years. So here is the thing that does not rot:
five questions to ask about any exporter before you deploy it, all of which
you can answer in about ten minutes.

**Is it maintained?** When was the last release, and was it a real one or a
dependency bump? Does it name a version of the thing it exports that is recent
enough to be yours? An exporter whose last release predates your database's
last major version will be missing metrics for exactly the features you care
about — as you just watched happen.

**Does it follow the conventions?** Read fifty lines of its `/metrics`. Are
counters suffixed `_total`? Are durations in seconds and sizes in bytes, not
milliseconds and megabytes? Is there a `# HELP` on every family? A metric
called `something_latency_ms` tells you the author has not read the naming
conventions, which tells you what else to expect. The convention really is
shared: Snip's Go runtime and `catalog`'s Python runtime publish entirely
different runtime metrics, and both publish the same `process_*` family,
because that one is specified rather than invented by each library.

**Is its cardinality bounded?** This is the one that will hurt you. Look for
labels whose values come from *data* rather than from *configuration*: a
customer ID, a table name in a schema that grows, a queue name, a full URL
path. Then do Chapter 7's multiplication with the real numbers from your own
system. cAdvisor is fine because its label values come from your container
list; it would not be fine if it copied every container label, which is why
that behavior was turned off by default.

**Can you read its `/metrics` and understand it?** Not "does it produce
metrics" — can you, personally, work out what a number means? If the HELP
strings are empty and the names are abbreviations, then during an incident at
3 a.m. this exporter is decoration.

**Does it support multi-target mode?** One exporter process per database
server is a lot of processes to run and upgrade. An exporter that can be told
which target to inspect per scrape is one deployment instead of fifty. That is
Chapter 23's subject, and it is worth checking for before you commit to a
topology.

Apply all five to `postgres_exporter` as it stands in your lab: released this
month, conventional names, small and bounded cardinality, readable output,
and it does support multi-target mode. It scores well. It also does not have
the checkpoint metrics. Both things are true, and only one of them is in any
README.

## The textfile collector

Some things that produce numbers are not services and never will be. A nightly
backup script runs for four minutes and exits. A cron job rotates certificates
once a week. There is no process to scrape, because by the time you would
scrape it, it is gone.

For anything **tied to a specific machine**, the answer is node_exporter's
textfile collector. It is enabled by default and needs one flag, which the lab
already sets: `--collector.textfile.directory=/textfile`. On every scrape, the
collector reads every file in that directory matching `*.prom`, parses it as
exposition format, and serves the contents alongside its own metrics. Your
batch job's only job is to write a file.

`scripts/backup-example.sh` is the whole pattern in about sixty lines, a third
of them comments. The part that matters:

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

Write to a temporary file, then `mv` it into place. That rename is atomic on a
local filesystem, so node_exporter either sees the old file or the new one and
never a half-written one. Skip it and you will eventually scrape a truncated
file, which fails to parse — and *that* is what `node_textfile_scrape_error`
is for.

Note what is being recorded: not "the backup took 43 seconds" but "the backup
last succeeded at this Unix timestamp". Duration is interesting; freshness is
what you alert on, because a job that stopped running produces no duration at
all. Run it:

```bash
./scripts/backup-example.sh
```

Wait one scrape interval — fifteen seconds — and ask Prometheus:

```promql
obslab_backup_last_success_timestamp_seconds
```

There it is, carrying `job="node-exporter"` and
`instance="node-exporter-1"` like everything else that job produces, because
as far as Prometheus is concerned it *is* node_exporter's metric. That is the
whole design: no new target, no new port, no new failure mode. If
node_exporter is up, the metric is fresh or provably stale, and `up` still
means what it always meant.

The collector also tells you about itself:

```promql
node_textfile_mtime_seconds
```

One series per file, labeled `file`, carrying the file's modification time —
which lets you alert on "this file has stopped being written" even if you
cannot parse whatever is inside it. And the alert you actually wanted:

```promql
time() - obslab_backup_last_success_timestamp_seconds > 86400
```

`time()` is the evaluation timestamp, so this reads "more than a day has
passed since the last success". A run that fails leaves the old timestamp in
place and the number climbs; a run that never starts does the same. Both
failures produce the same alert, which is the correct behavior.

!!! selfcheck "Self-check"
    Run `make verify-ch22`. Every assertion must pass, and the summary must
    end `0 failed` and `ch22 OK`. Among them:

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

    If the throttling line fails instead, check that `loadgen` is running and
    that you have left it a couple of minutes: the assertion uses a five-minute
    rate window and needs samples in it.

## The Pushgateway, and why it is not in your compose file

Every reader arriving from StatsD has the same instinct at this point: my
script should just *push* its numbers somewhere. Prometheus has a component
for that, called the Pushgateway, and this lab does not use it. It is worth
knowing exactly why, because "we don't do that here" is not an argument you
can take to a colleague.

The Pushgateway is a small server you `POST` metrics to; Prometheus then
scrapes the Pushgateway. Its own documentation recommends it in "certain
limited cases" and names exactly one: capturing the outcome of a
*service-level* batch job — one not tied to any particular machine, whose
identity is the service rather than the host that happened to run it. If your
job is tied to a machine, the textfile collector is the documented answer, and
it is the one this chapter taught.

Three properties make it the wrong default. It is a single point of failure
and a bottleneck: route many jobs through it and you have built one box whose
death blinds all of them. You lose `up`: Prometheus generates its per-target
health signal for the *Pushgateway*, not for your job, so "the job is down"
and "the job has not pushed yet" become indistinguishable — and that health
signal is most of what you have been getting for free since Chapter 1. And it
never forgets. A series pushed once is served forever until somebody deletes
it by hand, so a decommissioned job leaves a permanently stale value behind,
alerting on nothing, forever. There is no automatic expiry, and that is a
design position rather than a missing feature: a time-to-live would make the
Pushgateway feel safe for the things it is not for.

If you do use it, one setting is mandatory. Prometheus normally overwrites a
scraped target's `job` and `instance` with the scrape job's own values. For
the Pushgateway that is backwards — the pushed `job` is the real one — so its
scrape config needs `honor_labels: true`, which Chapter 12 introduced. Without
it, every pushed series arrives labeled `job="pushgateway"`, which looks
plausible and is useless. The gateway also attaches a push timestamp to each
group, and "now, minus that timestamp, exceeds twenty-five hours" is the
staleness alert you would write.

The honest 2026 postscript: push is not forbidden, it is not the
Pushgateway's job. Two genuinely push-shaped paths exist and both are in this
book — remote write in Chapter 26, "When One Prometheus Isn't Enough: HA,
`remote_write`, and the Scaling Map", and the OpenTelemetry receiver in
Chapter 28, "OpenTelemetry and Prometheus".

## windows_exporter, in one paragraph

If you have Windows hosts, the equivalent of node_exporter is
`windows_exporter`, currently **v0.31.8**, and it listens on port **9182** —
not 9100, which is the single most common mistake people make when adding it
to a scrape config. The normal deployment is the MSI installer, which
registers a Windows service; container images exist but are the unusual
choice. It was renamed from `wmi_exporter` some years ago, so any tutorial
using that name is describing a project that no longer exists under that
spelling. Point the checklist at its `/metrics` and read the names off the
wire, exactly as you just did with PostgreSQL.

## Common mistakes

**Installing node_exporter and looking for your application's metrics.** It
reports the host and only the host. Your request rate comes from your own
instrumentation, your container's memory comes from cAdvisor, and nothing in
`node_*` knows either exists.

**Summing cAdvisor series without `{name!=""}`.** The root cgroup is the sum
of every container, so including it doubles every total. The lab drops it at
the scrape, so you will not meet this here — which is precisely why you should
type the filter anyway, so that it is a habit on the day you are looking at
somebody else's Prometheus.

**Alerting on `container_memory_usage_bytes` or `node_filesystem_free_bytes`.**
Both are the larger, friendlier-looking number of an adjacent pair, and both
are wrong for alerting. Usage counts reclaimable page cache; free counts space
your non-root process cannot have.

**Dividing by a limit without checking it is non-zero.** An unset container
memory limit reads `0` and the ratio is `+Inf`, which is above every threshold
you will ever write and renders as an empty gap on the panel. Guard the
denominator with `> 0`.

**Trusting a metric name because a blog post used it.** Names move. The
`pg_replication_slot_*` family gained an `s` in 0.20.0; the checkpoint counters
moved views in PostgreSQL 17 and never arrived. `curl` the exporter and grep
before you write the alert, not after it fails to fire.

**Adding an exporter without doing the cardinality arithmetic.** The three
exporters in this chapter contributed roughly 2,800 series between them on the
measured run — several times what all of Snip's own instrumentation produces.
Exporters are cheap to install and are not cheap to store.

## Summary

An exporter is a translator and nothing more. It reads state you do not own —
the kernel's, the container runtime's, a database's — and republishes it in
the exposition format so that Prometheus can pull it exactly the way it pulls
your own service. Nothing about the data model, PromQL, dashboards or alerting
changes. What changes is that you are now depending on somebody else's
judgment about names, units and cardinality, and you have to check it.

You added three exporters, built a USE row for each layer under Snip, and
found that the latency you could not explain came from a `cpus: "0.15"` line
somebody typed in Chapter 4 — visible only as CFS throttling, which is a
saturation metric, on a container whose utilization looked fine.

The things to still know in six months:

- RED describes services; USE describes resources. Saturation is the half of
  USE people skip and the half that predicts pain, because utilization is
  bounded and saturation is not.
- `node_filesystem_avail_bytes`, not `_free_bytes`: `free` includes the
  root-reserved blocks your process cannot use.
  `node_memory_MemAvailable_bytes`, not `MemFree`, for the same shape of
  reason.
- node_exporter's CamelCase names are copied verbatim from `/proc/meminfo`
  field names. Faithfulness to the source beats conformity to a convention.
- `container_memory_working_set_bytes`, not `container_memory_usage_bytes`:
  usage includes reclaimable page cache and sits near the limit on healthy
  containers.
- `container_cpu_cfs_throttled_seconds_total` is the metric that explains a
  service that is slow while its CPU usage looks unremarkable.
- Filter the root cgroup with `{name!=""}`, and guard any division by
  `container_spec_memory_limit_bytes` with `> 0`.
- `predict_linear` over a long, fixed range turns a threshold alert into a
  trend alert. A disk stable at 91% is not an incident; a disk at 60% filling
  fast is.
- Exporters churn. Pin the tag, read the exposition, and let a checklist —
  maintained, conventional, bounded, readable, multi-target — replace any
  catalog.
- For a machine-tied batch job, write a `.prom` file atomically into the
  textfile directory. For almost everything else, the Pushgateway is the wrong
  answer, and losing `up` is the reason that matters most.

## Exercises

!!! exercise
    **1. Five percent you cannot have (warm-up).** Write two alerting rules on
    the same mountpoint at the same threshold, one on
    `node_filesystem_free_bytes` and one on `node_filesystem_avail_bytes`.
    Then run `node_filesystem_free_bytes - node_filesystem_avail_bytes` and
    write down the gap in bytes for each filesystem your host reports, plus
    that gap as a fraction of `node_filesystem_size_bytes`. Explain, using
    your own numbers, which of the two rules would have let a non-root process
    hit "no space left on device" without firing.

    **2. Divide by zero on purpose (warm-up).** Add a panel to a scratch
    dashboard dividing `container_memory_working_set_bytes{name!=""}` by
    `container_spec_memory_limit_bytes{name!=""}` with no guard at all;
    unit `percentunit`, max 1. Find `obslab-pager-1` in the legend and record
    what the panel shows for it. Then add the `> 0` guard to the denominator
    and record what changes — including what happens to the *other* series on
    the panel.

    **3. Score a stranger (core).** Pick an exporter you have never used for a
    system you actually run — a message broker, a job runner, a load balancer.
    Answer all five checklist questions against its repository and, if you can
    start it, against fifty lines of its real `/metrics`. Write three lines:
    the answer that worried you most, the answer that reassured you most, and
    whether you would deploy it.

    **4. Choose a window and defend it (core).** Write your own
    `predict_linear` rule for disk exhaustion within four hours, then run the
    same expression with `[1h]`, `[6h]` and `[24h]` ranges in the expression
    browser while `make backfill`-scale writes are happening. Record the three
    predicted values. Say which window you would ship and what failure each of
    the other two would produce — one is too jumpy, one is too slow.

    **5. A backup that can go wrong (core).** Extend
    `scripts/backup-example.sh` to publish two metrics instead of one: the
    success timestamp it already writes, and the job's exit code as a second
    gauge. Make it write the exit code even when the job fails. Then write an
    alerting rule that fires when there has been no successful run in 26
    hours, and confirm it goes `pending` by editing the timestamp in the
    `.prom` file to something two days old. You should see the rule reach
    `firing` and `node_textfile_scrape_error` stay at 0.

    **6. Two right answers (stretch).** Describe one batch job for which the
    Pushgateway is genuinely the correct choice and one for which the textfile
    collector is clearly better. For each, name the specific property that
    decides it, and say what breaks if you swap them. Then say what you lose,
    in both cases, that you get for free from an ordinary scraped target.
