# Chapter 25 — Storage, Retention, Backups and Locking the Door

Two questions arrive on the same afternoon, usually from different people.
Somebody in finance wants to know how much disk to buy. Somebody in security
wants to know who can log in to "the monitoring thing." Both questions sound
like paperwork, and both have answers that will surprise you.

The disk answer is a single line of arithmetic that the official documentation
prints and almost nobody applies, plus one measurement you take yourself
because the constant in that line is not the same for your data as it is for
anybody else's. It takes ten minutes and it is the difference between a volume
that fills at 03:00 during an incident and a volume that does not.

The security answer is shorter. There is no login. There has never been a
login. Anyone who can open a TCP connection to port 9090 can read every metric
you have ever collected, list every target you scrape, read your rule files,
and — on this lab, right now, as you sit here — delete your time series with
one HTTP request. That is not a bug and it is not an oversight. It is the
documented security model, and the answer to it lives outside Prometheus. By
the end of this chapter the port will be gone, a password will be in front of
it, and Grafana will not have noticed any of it happened.

!!! objectives "Objectives"
    After this chapter you can:

    - Size a Prometheus disk from the official formula, and measure your own
      bytes-per-sample instead of guessing at the constant.
    - Configure retention the current way, and say why the command-line flags
      are the wrong way.
    - Explain why size-based retention does not bound total disk usage, and
      what number to target instead.
    - Take a snapshot through the admin API and restore it into a throwaway
      server.
    - Build a meta-monitoring row that tells you when Prometheus itself is in
      trouble.
    - Put authentication in front of Prometheus, and explain why the built-in
      option is not it.

## Where the lab is

This runs against the stack as Chapter 24, "Cardinality: Detonate, Diagnose,
Defuse", left it: the bomb defused, `SNIP_UNBOUNDED_LABEL` back to `0`, the
emergency `labeldrop` brake commented out again, and `sample_limit: 5000` plus
`label_limit: 20` standing guard on the `snip-api` job.

```bash
cd lab
git checkout ch24
make check
make up
make ps
```

The block checks out `ch24`, not `ch25`. The `ch25` tag already holds both of
this chapter's changes finished — retention moved out of the command line, and
Prometheus behind a password with `:9090` gone — so read along with it, then
come back to `ch24` to recreate them with your own hands, and `git diff ch25`
at the end compares your files against the reference. Every command up to
"Taking the port away" assumes the `ch24` starting point.

Prometheus is therefore still on `http://localhost:9090/`, Grafana on
`http://localhost:3000/`, Snip behind `edge` on `http://localhost:8080/`, and
the load generator's control API on `http://localhost:8089/`. Put the injector
somewhere quiet so nothing else moves while you measure:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","error_ratio":0}'
```

Two earlier decisions carry the whole chapter. Prometheus has stored its data
in the **named volume** `promdata` since Chapter 1 and has never used a bind
mount, for a reason this chapter finally explains. And `edge` — the Caddy
reverse proxy that took over Snip's front door in Chapter 12, along with an
offline HTTPS listener on `:8443` that Chapter 23's certificate probe reads —
is about to get one more job.

## What is actually on the disk

Everything Prometheus writes lives under one directory, which the lab mounts
at `/prometheus` inside the container. Look at it:

```bash
docker compose exec prometheus /bin/sh -c 'ls -1 /prometheus'
```

You will see a handful of directories with names that look like somebody sat
on the keyboard, plus two that do not. Laid out in full, the shape is this:

```text
/prometheus
├── 01BKGTZQ1SYQJTR4PB43C8PD98    a finished block, 2 h or more
│   ├── chunks/000001             the samples themselves
│   ├── index                     labels ▶ series ▶ chunks
│   ├── meta.json                 time range, series and sample counts
│   └── tombstones                deleted, but not yet removed
├── 01BKGV7JBM69T2G1BGBGM6KB12    another finished block
├── chunks_head/000001            head chunks, memory-mapped
└── wal/                          the write-ahead log, 128 MB segments
    ├── 00000042
    └── checkpoint.00000041/
```

The keyboard-mash names are **ULIDs**. The useful property is that they sort
lexicographically in creation order, so `ls` gives you the blocks oldest
first. That is the entire ULID tour you need.

The two names that are not ULIDs are where the interesting behavior is.

!!! jargon "The head block"
    The **head block** is the two-hour window Prometheus is writing into right
    now. It lives in memory, not on disk, which is what makes an ingest path
    that accepts hundreds of samples per second cheap. Everything older than
    the head has been compacted into a numbered directory and is read from
    disk. "Head series" — the number Chapter 24 watched climb — means the
    series that exist in that in-memory window.

Here is the four-step model, and it is worth learning because three separate
operational surprises fall out of it.

1. A sample arrives from a scrape. It is appended to the head block in memory
   **and** written to the write-ahead log on disk. The WAL exists for exactly
   one purpose: if the process dies, the memory is gone and the WAL is how the
   head is rebuilt. It is written in 128 MB segments, and Prometheus keeps a
   minimum of three of them — a busy server keeps more, because it needs at
   least two hours of raw records.
2. When a chunk inside the head fills up, it is written out to `chunks_head/`
   and memory-mapped. That takes it out of the Go heap while leaving it
   queryable. This is why a server's memory use does not climb in a straight
   line with the number of samples it has taken.
3. Roughly every two hours the head is compacted into a persistent block
   directory, and the WAL is checkpointed: the segments covering that window
   are dropped, and records for series that are still live are rewritten into
   a `checkpoint.NNNNNNNN/` directory.
4. In the background, those two-hour blocks are merged into bigger ones.

Step 4 has one number in it that matters. Compaction creates blocks spanning
up to **10% of the retention period, or 31 days, whichever is smaller**. The
lab keeps 45 days, so 10% of that is 4.5 days and the largest block you will
ever see here spans about four and a half days. A server keeping a year would
top out at 31.

The operational consequence of steps 1 and 2 together is the sentence this
chapter exists to deliver. **RAM tracks active series. Disk tracks samples.**

Those are two different resources driven by two different things. The head
block holds one entry per *series* currently receiving data — the sample
values in it are small, but the series metadata and the label strings are not.
The blocks on disk hold every *sample* you have ever kept, compressed.

!!! iou "IOU from chapter 24, settled"
    Chapter 24 promised that shortening retention never fixes an
    out-of-memory crash, and deferred the reason to here. This is it. Cutting
    retention from 45 days to 7 deletes old blocks from disk. It does not
    remove a single series from the head block, because every one of those
    series is still being scraped right now. Memory is a function of how many
    distinct label combinations are live; retention is a function of how far
    back you can query. Changing one to fix the other is the single most
    common wrong move in this subject.

## How much disk do you need

The official formula is one line:

```text
needed_disk_space =
    retention_time_seconds
  × ingested_samples_per_second
  × bytes_per_sample
```

The documentation says Prometheus stores an average of only **1 to 2 bytes per
sample**. That sounds too good until you remember what a sample is: a
timestamp and a float, stored inside a chunk that already knows which series
it belongs to, with the timestamps delta-of-delta encoded (they arrive at a
fixed interval, so the deltas are nearly all identical) and the values
XOR-encoded against the previous one (most metrics change slowly or not at
all). The label strings — the expensive part — are stored once per series in
the index, not once per sample.

Two of the three terms you already know. Retention is whatever you configure.
Samples per second you can measure right now:

```promql
sum(rate(prometheus_tsdb_head_samples_appended_total[5m]))
```

On the run that produced this book's measurements, twelve scrape jobs across
fourteen targets held roughly 9,000 series, scraped every 15 seconds. Nine
thousand series divided by a fifteen-second interval puts the ingest rate near
600 samples per second; the query is how you check that against your own stack
instead of taking the arithmetic's word for it. Expect a higher number if the
stack has been up a while, because `catalog` is deliberately misinstrumented
and its series count grows without bound.

So for 90 days at 600 samples per second:

```text
90 days = 7,776,000 seconds

7,776,000 × 600 × 1 byte  ≈  4.7 GB
7,776,000 × 600 × 2 bytes ≈  9.3 GB
```

Five to nine gigabytes to keep this laptop-sized lab for a quarter — a real
number to hand to whoever asked. It should also make you look hard at the
2 GB size cap this chapter is about to add to `prometheus.yml`: at 600
samples per second that limit binds long before 45 days do. Which of the two actually stops you is a thing to know
rather than discover.

### Measuring your own bytes per sample

One to two bytes is an average over other people's data. Measure yours.
Prometheus reports, for every compaction it performs, both the number of bytes
written and the number of samples those bytes contain:

```promql
rate(prometheus_tsdb_compaction_chunk_size_bytes_sum[1h])
  /
rate(prometheus_tsdb_compaction_chunk_samples_sum[1h])
```

Bytes over samples is bytes per sample. Both series are counters that only
move when a compaction happens, which is the catch: compactions are hours
apart, so on a server that started twenty minutes ago this expression returns
nothing at all.

!!! ladder "Ladder → rung 9"
    An empty result here is Appendix B, rung 9 in a new disguise: is the range
    wide enough? Chapter 6's version of that rung asked whether the window
    held four scrapes. This one asks whether it held one **compaction**, which
    happens every couple of hours rather than every fifteen seconds. Widen the
    range to `[6h]` before you go looking for a bug.

That is also why the dashboard panel you are about to build uses `[$__range]`
rather than the `$__rate_interval` every other panel in this book uses. It is
the one deliberate exception: `$__rate_interval` on a default dashboard range
is a few minutes wide, and a few minutes almost never contains a compaction.
`$__range` is as wide as whatever the time picker says, so the panel fills in
as soon as the range covers one.

Your number will probably not be exactly 1 or 2, and the reasons are worth
knowing. Samples compress well when they arrive at a regular interval and the
value changes predictably; a counter climbing by a steady amount costs almost
nothing per sample. They compress badly when a series is short-lived, because
a chunk that holds twelve samples still carries its own overhead, and when the
values are noisy. A server that restarts often, or one with heavy label churn,
will read worse than one that has been up for a week doing the same thing.

### The memory question, answered honestly

Every capacity discussion eventually reaches "and how much RAM per series?"
You will find a number quoted everywhere: 3 kB. It is worth knowing where that
number comes from, because it is not what people think it is.

**There is no official memory-per-active-series figure in the Prometheus
documentation.** The 3 kB everyone repeats traces to a single blog post from
September 2020, written against Prometheus 2.20, and it described *head chunk*
memory — not the memory the whole process actually holds. Quoting it as a
budget for the container in 2026 is quoting a six-year-old measurement of a
different quantity.

What practitioners observe now clusters higher, in the region of 6 to 10 KiB
per active series once the index, query working memory and Go's own overhead
are counted. Budget around **8 KiB per active series as a starting point, then
measure**, and treat the result as specific to your workload.

Measure it here. The lab caps the Prometheus container at 2 GB, and Chapter 22
gave you cAdvisor:

```promql
container_memory_working_set_bytes{name="obslab-prometheus-1"}
  / scalar(prometheus_tsdb_head_series)
```

Write the answer down. Then re-run it after you have done anything that
changes series counts and watch whether it is stable. If it is not, you have
learned something more useful than a constant.

## Retention, the way that works now

Almost every `docker-compose.yml` you will find on the internet configures
retention like this:

```yaml
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.retention.time=45d
```

That still works. It is also deprecated, and the binary will tell you so if
you ask it:

```bash
docker compose run --rm --no-deps -T \
  --entrypoint /bin/prometheus prometheus --help 2>&1 \
  | grep -A3 'storage.tsdb.retention'
```

!!! trap "The flags you were about to copy"
    The help text on Prometheus 3.13.1 reads, wrapped here to fit the page:

    ```text
    --storage.tsdb.retention.time  [DEPRECATED] ... This flag has been
                                   deprecated, use the
                                   storage.tsdb.retention.time field in
                                   the config file instead.
    --storage.tsdb.retention.size  [DEPRECATED] ... use the
                                   storage.tsdb.retention.size field in
                                   the config file instead.
    ```

    Set both the flag and the config field and the **config field wins** — it
    takes precedence, silently. So a stack that has a flag in `compose.yaml`
    left over from 2022 and a field in `prometheus.yml` added last month is
    running on the field, and the flag is a lie that reads like documentation.
    Delete the flag.

The current form lives in the config file, in a top-level `storage:` block
that this chapter is the first to use. Your `compose.yaml` carries one of those
deprecated flags right now: Chapter 20 added
`--storage.tsdb.retention.time=45d` so that `make backfill`'s imported month
would survive its first compaction, said in as many words that the command line
was the wrong home for it, and owed you this chapter. *IOU from chapter 20,
settled.* Delete that line from the `prometheus` command block. Then add this to `lab/prometheus/prometheus.yml`,
below `rule_files:`:

```yaml
storage:
  tsdb:
    retention:
      time: 45d
      size: 2GB
```

Three things about that block are load-bearing.

It is **hot-reloadable**. Unlike the flags, which need a process restart,
these fields are re-read when the configuration is reloaded — and the lab runs
Prometheus with `--config.auto-reload`, so saving the file is enough; the
change lands within thirty seconds without you typing anything. Chapter 12's
`make reload` still works if you are impatient.

The time unit accepts `y`, `w`, `d`, `h`, `m`, `s` and `ms`. **45 days is a
deliberate number, not a default** — it is the one Chapter 20 picked when it
put the flag on the command line, and the field inherits it unchanged. The
upstream default is 15 days. Both of
the service level objectives you wrote in Chapter 20 are defined over a
rolling 30 days, the recording-rule ladder has a `:ratio_rate30d` rung, and
`make backfill` imports a month of synthetic history so that rung has
something to read. Retention shorter than the longest window you query does
not produce an error. It produces a gauge that still renders, labeled "30
days", showing you fifteen. 45 days is the window plus headroom.

And the size unit accepts `B`, `KB`, `MB`, `GB`, `TB`, `PB`, `EB` — in powers
of two, so `2GB` is 2 GiB. If both a time and a size limit are set, whichever
one triggers first is the one that acts.

### Size retention does not bound your disk

This is the part that costs people a volume.

Size retention deletes **persistent blocks**. It does not delete the WAL, and
it does not delete `chunks_head/`. But both of those are counted toward the
total it compares against your limit. So the limit is enforced against a
number that includes two directories the limit cannot shrink.

Play that forward. If the WAL and the head chunks together are, at their peak,
larger than your size limit, Prometheus will delete every persistent block you
have — all of them — and still be over the limit, and there is nothing further
it can do. You will have a monitoring system with no history and a full disk.

The floor is therefore not zero: **the minimum disk you need is the peak size
of `wal/` and `chunks_head/` combined**, and that peak arrives every two
hours, just before compaction. Look at yours:

```bash
docker compose exec prometheus /bin/sh -c \
  'du -sh /prometheus/wal /prometheus/chunks_head; df -h /prometheus'
```

The official guidance is to set the size limit to **at most 80–85% of the disk
space you have allocated**. That headroom is not superstition; it is the space
the two untrimmable directories need at their peak, plus room for a compaction
to write a new block before it deletes the old ones.

!!! pitfall "Setting the size limit to the size of the volume"
    It looks tidy: a 10 GB volume, `size: 10GB`, nothing wasted. What you have
    built is a system that only starts deleting blocks once the disk is
    already full, and that needs free space in order to compact — which it no
    longer has. Compaction fails, blocks are not released, and the failure
    mode looks like corruption rather than like a full disk. Use 8 GB, not 10.

### Watching a block die

The lab is currently keeping 45 days. Change that to 15 and watch what
happens. First, list the blocks you have:

```bash
docker compose run --rm --no-deps -T \
  --entrypoint /bin/promtool prometheus \
  tsdb list -r /prometheus
```

!!! warning "This deletes your backfilled history"
    `make backfill` imported 30 days of synthetic traffic in Chapter 20 so
    that the 30-day SLO panels had something to read. Dropping retention to 15
    days deletes those blocks permanently, and putting 45 back does not bring
    them home. That is the lesson, but do it knowing the price. To restore
    afterwards: `make history && make backfill`.

Edit `lab/prometheus/prometheus.yml`, change `time: 45d` to `time: 15d`, and
save. Within thirty seconds the auto-reloader picks it up. Confirm that
Prometheus is running on the new value rather than taking your word for it:

```bash
curl -s http://localhost:9090/api/v1/status/config \
  | jq -r '.data.yaml' | grep -A4 'retention'
```

Now list the blocks again. They are still there. Wait a minute and list once
more, and the old ones start disappearing.

That gap is the behavior to internalize. A retention change applies to the
running server **immediately**, but block deletion happens on the next block
reload cycle, which comes around within a minute or when a compaction
finishes, whichever is sooner. And cleanup of fully expired blocks runs in the
background and may take **up to two hours**. A block is only removed once it
is *entirely* outside the window; a block that straddles the boundary stays.
At 15 days the largest block spans 1.5 days, so a 15-day retention can
legitimately still be answering questions about samples sixteen and a half
days old, out of a block that has not fully expired.

So: you cut retention because the disk is nearly full, nothing happens, and
you cut it again. Twenty minutes later both cuts land at once and you have
deleted far more history than you meant to. Change it once, then wait two
hours before deciding it did not work.

Put `time: 45d` back and save.

## Where the data must not live

One line of the storage documentation deserves to be read out loud:
non-POSIX-compliant filesystems are not supported for local storage, because
unrecoverable corruption may happen. NFS is named explicitly, and so is AWS's
EFS, which is NFS wearing a different badge.

This is not a performance note. Prometheus relies on POSIX semantics for
file locking, renames and memory mapping, and a filesystem that approximates
them will work for weeks and then hand you a block that cannot be read.

The same caution is why `promdata` has been a named Docker volume since
Chapter 1 and not a bind mount to a folder on your laptop. On Docker Desktop —
Windows or macOS — a bind mount crosses a translation layer between the host
filesystem and the Linux VM. That layer is not POSIX-complete, and the TSDB is
precisely the kind of workload that finds the gaps: memory-mapped chunk files
and a write-ahead log. A named volume lives inside the VM's own filesystem and
avoids the whole question, which is why the official installation guidance
recommends one too.

The corollary is that you cannot browse the data directory from your file
manager, which is why every command in this chapter goes through the
container. That is a feature.

One more field lives in the same `storage.tsdb` block and is worth knowing by
name now even though you will not set it here:
`out_of_order_time_window`. It defaults to zero, meaning a sample whose
timestamp is older than the newest sample in its series is rejected. Chapter
28 turns it on, and explains what changes when it does.

## Snapshots, and what "backup" honestly means

The documented way to back up a Prometheus server is a **snapshot**, taken
through the admin API. The documentation is blunt about the alternative:
backups made without snapshots risk losing everything recorded since the last
block was written — which can be almost two hours of data.

A snapshot is a directory of hard links to the existing block files, created
inside the data directory itself. That makes it nearly instant and nearly
free in disk space, and it also means that on its own it is not a backup at
all. It is on the same volume, on the same filesystem, on the same machine as
the thing it is protecting. It becomes a backup when you copy it somewhere
else.

The endpoint needs a flag:

```yaml
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.path=/prometheus
      - --web.enable-lifecycle
      - --config.auto-reload
      - --web.enable-admin-api
```

The first two arrived in Chapter 1 and the next two in Chapter 12; the
retention flag that sat after them is the one you just deleted. All of them
are listed because `command:` replaces the image's own arguments wholesale, so
the list is always complete or always broken.

The last line is the one this chapter adds, and it is a bargain you should
make consciously. `--web.enable-admin-api` enables three endpoints:
`/api/v1/admin/tsdb/snapshot`, `/api/v1/admin/tsdb/delete_series`, and
`/api/v1/admin/tsdb/clean_tombstones`. One flag buys you the backup and the
loaded gun. There is no way to have the first without the second. Hold that
thought; it is the hinge of the second half of this chapter.

A flag change needs the container recreated, not restarted, so `make up`
first. Then take one:

```bash
make up
make snapshot
```

That runs `scripts/snapshot.sh`: it posts to the endpoint, reads the
snapshot's name — a timestamp and a short hash — out of the JSON response, and
copies the directory out of the container into `lab/snapshots/`. If it reports
that the admin APIs are disabled, the flag did not take.

### Restoring into a throwaway

A backup you have never restored is not a backup. Restore this one.

Copy the snapshot first — do not mount your only copy:

```bash
cp -r snapshots/<name> /tmp/restore-test
```

A Prometheus server writes into its data directory the moment it starts: a
lock file, a fresh write-ahead log, a new head block. Point a server at your
only copy of a backup and it is no longer a pristine copy of anything. Copy,
then mount the copy.

```bash
docker run --rm -p 9098:9090 \
  --user "$(id -u):$(id -g)" \
  -v /tmp/restore-test:/prometheus \
  quay.io/prometheus/prometheus:v3.13.1 \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/prometheus
```

The `--user` line matters on Linux. The image runs as `nobody` by default,
the copy belongs to you, and without it the server cannot write into its own
data directory and fails at startup with
`open /prometheus/queries.active: permission denied`.

That is deliberately not part of the Compose stack: a bare container, on a
port nothing else uses, with the image's bundled default configuration
scraping nothing but itself. Open `http://localhost:9098/` and query
`snip_http_requests_total`. Your traffic is there.

Yes, this bind-mounts a TSDB on Docker Desktop, which this chapter has just
told you never to do. The difference is exposure: ten minutes of inspection in
a container you are about to delete is a different risk from months of
continuous writes, and if this copy corrupts you lose a copy you made in order
to throw away.

Now notice what is missing. The restored server has your samples and nothing
else. It does not have `prometheus.yml`, so it scrapes nothing and knows about
no targets. It does not have your rule files, so no alerts exist and no
recording rules are being evaluated — the `:ratio_rate30d` series stops at
the moment of the snapshot rather than continuing. It does not have Grafana,
or Grafana's database of dashboards, or Alertmanager's silences, or the
`.env` file that decides which teaching switches are on.

**"Snapshot" means the time series database. "Backup" means everything you
would need to stand the system up again.** In this lab that is the entire git
repository plus a snapshot; the repository is the more valuable half, because
it is the half you cannot regenerate.

### What a restart costs you

Restart Prometheus and time it:

```bash
docker compose restart prometheus
```

On startup the server replays the write-ahead log to rebuild the head block in
memory. Everything in the WAL has to be read back before the head is whole,
and while that is happening the server is listening but not ready. Watch the
progress:

```bash
curl -s http://localhost:9090/api/v1/status/walreplay | jq
```

When it is done, ask how long it took:

```promql
prometheus_tsdb_data_replay_duration_seconds
```

On this lab that is seconds. On a server holding a few million active series
it is minutes, and those are minutes during which every dashboard you own is
blank and every alert that depends on that server is silent. That is the true
cost of restarting Prometheus, and it is worth knowing before a change window
rather than during one.

## The row that watches the watcher

Chapter 19 built alerts about the monitoring system — rule evaluation
failures, notification failures, the Watchdog — and one of its annotations
pointed at a dashboard link, `http://localhost:3000/d/obslab-meta`, that went
nowhere. Time to settle that: *IOU from chapter 19, settled.*

Two files. The first is `lab/prometheus/rules/meta-recording.yml`, three
recording rules aggregating the series Prometheus writes about every scrape it
performs, whether or not the target has ever been instrumented:

```yaml
groups:
  - name: meta
    interval: 30s
    rules:
      - record: job:up:ratio
        expr: avg by (job) (up)

      - record: job:scrape_samples_post_metric_relabeling:sum
        expr: sum by (job) (scrape_samples_post_metric_relabeling)

      - record: job:scrape_duration_seconds:max
        expr: max by (job) (scrape_duration_seconds)
```

`job:up:ratio` is a number between 0 and 1. Exactly 1 means every target of
that job answered its last scrape. On a two-replica job, 0.5 means one replica
is gone — which reads very differently from `up == 0`, and is a distinction a
bare count throws away. The second rule records what each job costs *after*
`metric_relabel_configs` has run, which is the honest number rather than what
the target offered. The third takes the maximum rather than the average,
because an average hides the one exporter that is about to time out.

The second file is `lab/dashboards/meta.json`, provisioned exactly the way
Chapter 3 set up: drop it in `dashboards/`, and the provider picks it up. It
has uid `obslab-meta`, which is the uid Chapter 19's annotation already
named, and three rows.

Dashboard JSON is not something to type, so take both files from the
repository rather than transcribing them:

```bash
git checkout ch25 -- dashboards/meta.json \
  prometheus/rules/meta-recording.yml
```

That form of `git checkout` takes named paths out of a tag and leaves the rest
of your working tree — including the edits you have been making — alone.

| Row | Answers |
|---|---|
| Scrape health | Is every target answering, and how fast? |
| TSDB and the rule engine | Is Prometheus itself coping? |
| The notification pipeline | Did the page actually reach a human? |

The first row reads `job:up:ratio` as a percentage, counts targets that are
down, draws a state timeline of `up` per target, and graphs
`job:scrape_duration_seconds:max`. The last of those is the early warning
nobody builds: scrape duration climbing toward `scrape_timeout` is how a
target starts failing, minutes before `up` goes to zero.

The second row is this chapter's. `prometheus_tsdb_head_series` is the
cardinality line Chapter 24 taught you to fear.
`rate(prometheus_tsdb_head_samples_appended_total[$__rate_interval])` is the
ingest rate that feeds the disk formula, next to the per-job breakdown from
`job:scrape_samples_post_metric_relabeling:sum`. Bytes-per-sample is the
`[$__range]` stat panel. Rule group evaluation time, rule failures and missed
iterations complete it: a rule group whose evaluation takes longer than its
interval will start skipping iterations, and
`prometheus_rule_group_iterations_missed_total` is the only thing that says
so.

`prometheus_tsdb_data_replay_duration_seconds` gets its own stat panel, the
one you just learned to read.

The third row is Chapter 19's, unchanged: notifications from Prometheus to
Alertmanager, notifications from Alertmanager to receivers, what the pager
actually received, the dead man's switch, and the probe results from Chapter
23.

!!! selfcheck "Self-check"
    Open `http://localhost:3000/d/obslab-meta`. The "Scrape health, worst
    job" stat reads **100%** with all fourteen targets up, "Targets down"
    reads **0**, and "Head series" draws a line rather than an empty panel.
    "Bytes per sample" may read "No data" until a compaction completes; widen
    the time picker to 6 hours and it fills in.

## Locking the door

Now the part most introductory books skip.

### What Prometheus gives you, and why it is not enough

The Prometheus security documentation states its model plainly, and the model
is that untrusted users are presumed to have access to the HTTP endpoint and
the logs, and therefore to every time series in the database plus a good deal
of operational and debugging information. It follows that up with a sentence
worth memorizing: the HTTP endpoints "should not be exposed to publicly
accessible networks like the internet."

Read that again as an operator rather than as a reader. It is not saying
"secure your Prometheus." It is saying that securing it is not Prometheus's
job, and that the intended deployment has something else standing in front.

Concretely, anyone who can reach `:9090` right now can list your targets and
your service discovery, read your rule files, read your configuration, read
every metric you have, and run arbitrary expensive PromQL against your server
until it falls over. Denial of service through an expensive query is
explicitly not treated as a security vulnerability by the project.

And by the end of this book, four flags widen that further on this lab:

| Flag | Default | What it opens |
|---|---|---|
| `--web.enable-lifecycle` | `false` | `POST /-/reload` and `POST /-/quit` |
| `--web.enable-admin-api` | `false` | snapshot, delete series, tombstones |
| `--web.enable-otlp-receiver` | `false` | an endpoint that accepts writes |
| `--web.cors.origin` | `.*` | every browser origin, anchored |

The first three are switches, all off by default upstream. The first two are
on now because Chapter 12 and this chapter needed them, and Chapter 28 turns
on the third. The fourth is not a switch: the permissive value *is* the
default. `POST /-/quit` stops the server. The admin API deletes series. The
receiver lets anyone who can reach the port inject arbitrary metrics into your
database, which is a subtler attack than deletion and much harder to notice.
And the lab's Prometheus container runs as root with the Docker socket
mounted, which Chapter 12 already said out loud is effectively root on your
host.

Prometheus does ship something. `--web.config.file` points at a file that can
configure TLS and bcrypt-hashed basic auth users, and the same file format is
understood by Alertmanager and by most official exporters, so it is one thing
learned and used in five places. It has one genuinely nice property: the file
is read on every HTTP request, so adding a user or rotating a certificate
takes effect immediately, with no restart.

It is also **explicitly experimental**. The HTTPS documentation says so in its
first paragraph, and the project's stability document lists server-side HTTPS
and basic authentication as unstable for the 3.x line. That is not a
prediction that it will break; it is a statement that its behavior is not
covered by the compatibility promise.

More to the point, it is all-or-nothing. A basic auth user is authenticated
for the whole server or not at all. There are no roles, no read-only users, no
per-endpoint rules, no way to say "this account may query but may not touch
`/api/v1/admin`", no single sign-on, no audit log and no rate limiting. If you
want a person to be able to look at a graph without being able to delete your
data, the built-in option cannot express that.

A reverse proxy can. It can terminate TLS with a certificate your organization
already manages, authenticate against whatever your organization already uses,
log every request, rate-limit, and — the part that matters most here — make
routing decisions per path. Blocking `/api/v1/admin/` and `/-/quit` at the
proxy while allowing `/api/v1/query` is three lines in any proxy configuration
and is inexpressible inside Prometheus.

### Putting a proxy in front

You already have one. `edge` has been serving HTTPS on `:8443` since Chapter
12, using a certificate from Caddy's own internal certificate authority, which
is what makes an offline TLS lab possible. It gains a second site handler.

Generate a password hash — never write a plaintext password into a config
file, even in a lab:

```bash
docker run --rm caddy:2-alpine \
  caddy hash-password --plaintext obslab
```

Then in `lab/edge/Caddyfile`, inside the existing `:8443` block:

```text
  handle_path /prometheus/* {
    basic_auth {
      obslab $2a$14$6r1s95UbB28xnjvRDZNOou.BnbdtOdkwj3cRnKTt6M1wO1qGyAaBO
    }
    reverse_proxy prometheus:9090
  }

  @prometheus_bare path /prometheus
  redir @prometheus_bare /prometheus/ 308

  handle {
    basic_auth {
      obslab $2a$14$6r1s95UbB28xnjvRDZNOou.BnbdtOdkwj3cRnKTt6M1wO1qGyAaBO
    }
    reverse_proxy prometheus:9090
  }
```

That hash is the lab's, for the password `obslab`; yours from
`caddy hash-password` will look different and work identically. Three details
in the block are the difference between working and not.

`handle_path` **strips** the `/prometheus` prefix before proxying. Prometheus
has not been told it lives at a sub-path — it still serves at `/` inside the
network — so `/prometheus/graph` has to arrive as `/graph`. The alternative is
to give Prometheus `--web.route-prefix`, and that would break Grafana, whose
data source points at `http://prometheus:9090` with no prefix at all.

Prometheus's own pages then ask for their assets from the root of whatever
host served them, not from `/prometheus/`. That is why the bare `handle` block
is there, proxying the site root behind the same credentials. Leave it out and
the UI renders as a blank page with a correct page title, which is a maddening
symptom to debug from the browser alone.

And the basic auth is scoped to those handlers, leaving `GET /-/healthy` on
`:8443` open. That is Chapter 23's TLS probe target. Put a site-wide password
in front of it and `probe_success` for `http_2xx_insecure_tls` goes to zero,
the certificate-expiry alert loses its data source, and you have broken
monitoring in the act of securing it. Which is itself the lesson: the first
thing an authentication change breaks is usually the thing that was watching.

!!! trap "Use the name, not the address"
    The certificate carries two names — `localhost`, for you, and `edge`, for
    the blackbox exporter inside the Compose network. Caddy chooses a
    certificate from the name in the TLS handshake, so
    `curl -k https://127.0.0.1:8443/` matches neither site block and does not
    do what you meant, `-k` notwithstanding. Use `https://localhost:8443/`.

### Taking the port away

Now delete this from the `prometheus` service in `compose.yaml`:

```yaml
    ports:
      - "9090:9090"
```

Then `make up`. And here is the thing to actually watch: open Grafana and look
at any dashboard. Everything works. Nothing reconnects, nothing errors,
nothing needs reconfiguring.

That is because Grafana never used the published port. Its data source is
`http://prometheus:9090` — a Compose service name resolved on the `obsnet`
network, with `access: proxy` so the request is made by Grafana's backend and
not by your browser. The published port existed for you. Removing it removes
your access and nobody else's, which is exactly the property you want from a
port you are about to stop publishing in production.

Confirm both halves:

```console
$ curl -sk -o /dev/null -w '%{http_code}\n' \
    https://localhost:8443/prometheus/
401

$ curl -sk -o /dev/null -w '%{http_code}\n' \
    -u obslab:obslab https://localhost:8443/prometheus/-/healthy
200
```

Open `https://localhost:8443/prometheus/` in a browser and you get the
credentials prompt. `obslab` / `obslab`. Your browser will also warn about the
certificate, because it was issued by Caddy's own authority, which your
machine has no reason to trust — accept it for the lab and note that this is
what a certificate warning is *for*.

From here on, `http://localhost:9090` is gone for every command in this book.
`make reload` already knows: the Makefile's `PROM_URL` defaults to the proxy
URL with the credentials attached. If you check out an earlier tag, where the
port is still published, override it for that command:

```bash
make reload PROM_URL=http://localhost:9090 PROM_CURL_OPTS=
```

The verify scripts need no such help. They try `:9090` first and fall back to
the proxy, which is why `make verify-ch12` still works on the tag it belongs
to and `make verify-ch25` works here.

!!! selfcheck "Self-check"
    ```console
    $ make verify-ch25

    == verify-ch25 ==
       expected runtime: about 20 s

    PASS host port 9090 is unreachable
    PASS https://localhost:8443/prometheus/ is 401 without credentials
    PASS it is 200 with them
    PASS Grafana's data source health check passes
    PASS retention is configured in prometheus.yml
    PASS prometheus/rules/meta-recording.yml exists
    PASS the meta dashboard is provisioned
    PASS Prometheus answers queries behind the proxy
         reached at: https://localhost:8443/prometheus

    ch25: 8 passed, 0 failed
    ch25 OK
    ```

    If the 401 assertion fails and you get 200 instead, the `basic_auth`
    directive is outside the handler you think it is in. If the credentials
    assertion fails, set `OBSLAB_PROM_USER` and `OBSLAB_PROM_PASS` to whatever
    you hashed.

## Common mistakes

**Shortening retention to fix memory.** The most common wrong move in this
subject, and now you know precisely why it does nothing: retention governs
blocks on disk, memory is governed by the count of series currently receiving
samples. Chapter 24 has the fix; this chapter has the explanation.

**Setting the size limit to the size of the volume.** Worth repeating, because
it fails in a way that does not look like a configuration error: compaction
needs free space to write a new block before it can delete the old ones, and a
100% limit guarantees there is none. Use 80–85%.

**Believing the retention change did not work.** You edit, you reload, you
watch `du`, nothing moves. Deletion happens on the next block reload cycle —
within a minute, or when a compaction finishes — and full expired-block
cleanup can take two hours. Changing it a second time out of impatience is how
people delete a quarter of history in one afternoon.

**Treating the snapshot as the backup.** It is hard links inside the same data
directory on the same volume. If the volume goes, so does it. And even copied
off, it contains the TSDB alone — not your configuration, not your rules, not
your dashboards.

!!! pitfall "Leaving the admin API reachable"
    `--web.enable-admin-api` is a single flag that gives every client on the
    network `POST /api/v1/admin/tsdb/delete_series`. There is no confirmation,
    no undo, and no authentication in front of it unless you put some there.
    The lab enables it because the backup lesson requires it and then
    immediately removes the port that made it reachable — that order is not
    decoration. If you turn this flag on in a real deployment, the proxy in
    front must block `/api/v1/admin/` before the flag goes in, not after.

**Putting the TSDB on NFS or EFS.** It will work. It will work for weeks. Then
it will hand you an unreadable block, and the failure will not look like a
filesystem problem.

## Summary

Prometheus keeps the last two hours in memory, protected by a write-ahead log,
and everything older in immutable blocks on disk. That single split explains
the two resources you have to plan for separately: memory scales with active
series, disk scales with samples kept. Sizing the disk is arithmetic with one
constant you should measure rather than assume. Sizing the memory is a
measurement with no official constant at all, which is worth saying out loud
rather than repeating a number from 2020.

Retention moved into the configuration file, where it can be changed without a
restart, and the flags you will find in every old compose file are deprecated
and silently outranked. Backups are snapshots plus the repository that
describes the system, and a restore you have never performed is a hypothesis.

And Prometheus has no authentication, has never had any, and says so in its
own documentation. The answer is a proxy, and you now have one.

The durable takeaways:

- RAM tracks active series. Disk tracks samples. Retention only touches the
  second.
- `retention_time_seconds × samples_per_second × bytes_per_sample`, with 1–2
  bytes as the documented average and your own measurement as the real number.
- There is no official memory-per-series figure. Budget ~8 KiB and measure;
  the 3 kB everyone quotes is a 2020 head-chunk figure for Prometheus 2.20.
- Retention belongs in `storage.tsdb.retention` in the config file. The
  matching flags are deprecated and the config fields take precedence.
- Size retention deletes blocks only, but counts the WAL and head chunks
  toward the total. Target 80–85% of your volume, never 100%.
- Block deletion lags a retention change by up to a reload cycle, and full
  cleanup by up to two hours. Change it once and wait.
- Never put the TSDB on NFS, EFS, or a Docker Desktop bind mount.
- A snapshot is the TSDB. A backup is the TSDB plus everything that describes
  the system, and it is not a backup until you have restored it.
- Prometheus has no login page. `--web.config.file` is experimental and
  all-or-nothing. A reverse proxy is the real answer.

## Exercises

!!! exercise
    **1. Your own bytes per sample (warm-up).** Run the compaction ratio
    expression over `[1h]`, then over `[6h]`. Write down both numbers and say
    which one you trust and why. Compare them with the documented 1–2 bytes
    and give two concrete reasons yours might differ — one about how often
    this lab restarts, one about what `catalog` does to series lifetimes. Then
    compute, from your measured ingest rate, the disk needed to keep 90 days.

    **2. One hundred percent, then eighty (core).** Find the size of the
    `promdata` volume with `df -h /prometheus` inside the container. Set
    `storage.tsdb.retention.size` to that exact number, save, and watch for
    fifteen minutes: what gets deleted, and what does not. Then set it to 80%
    of that number and describe, in one sentence each, what the two settings
    do differently to the WAL and to the blocks.

    **3. The restore, and the gap (core).** Take a snapshot, copy it out,
    and start a throwaway server on `:9098` against a copy of it. Query
    `snip_http_requests_total` and confirm your traffic is there. Then list
    five things the restored server does not have that the original does, and
    for each one name the file or volume in the lab that holds it.

    **4. The loaded gun (core).** Through the proxy, with credentials, POST
    to `/api/v1/admin/tsdb/delete_series?match[]=catalog_lookups_total` and
    then to `/api/v1/admin/tsdb/clean_tombstones`. Confirm the series are
    gone, and note how long the whole thing took. Now write the single
    sentence you would put in a change request explaining why that endpoint
    must never be reachable from a network you do not control.

    **5. The cost of a restart (stretch).** Restart Prometheus and time it
    with a stopwatch, polling `/api/v1/status/walreplay` as it comes back.
    Read `prometheus_tsdb_data_replay_duration_seconds` afterwards. During
    that window, what did a query through Grafana do — error, hang, or return
    an empty result? Write down which, and what a dashboard showed. Then
    estimate the same window for a server holding a hundred times this lab's
    series count.

    **6. Grafana behind the door too (stretch).** Add a second `handle_path`
    block to the `:8443` site proxying `/grafana/*` to `grafana:3000`, and
    reach Grafana through it. Something breaks: the login redirect, the assets,
    or both. Find `root_url` in Grafana's configuration, say what it is for,
    and explain in two sentences why a reverse proxy at a sub-path is a
    contract between the proxy and the application rather than a setting on
    only one of them.
