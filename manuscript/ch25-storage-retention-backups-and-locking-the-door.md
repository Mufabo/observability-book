# Chapter 25 — Storage, Retention, Backups and Locking the Door

Two questions arrive on the same afternoon, usually from different people.
Somebody in finance wants to know how much disk to buy. Somebody in security
wants to know who can log in to "the monitoring thing." Both sound like
paperwork, and both have answers that will surprise you.

The disk answer is one line of arithmetic the official documentation prints and
almost nobody applies, plus one measurement you take yourself, because the
constant in that line is not the same for your data as for anybody else's. Ten
minutes of work, and the difference between a volume that fills at 03:00 during
an incident and a volume that does not.

The security answer is shorter. There is no login. There has never been a
login. Anyone who can open a TCP connection to port 9090 can read every metric
you have ever collected, list every target you scrape, read your rule files,
and — on this lab, right now — delete your time series with one HTTP request.
That is not a bug. It is the documented security model, and the answer to it
lives outside Prometheus. By the end of this chapter the port will be gone, a
password will be in front of it, and Grafana will not have noticed.

!!! objectives "Objectives"
    After this chapter you can:

    - Size a Prometheus disk from the official formula, and measure your own
      bytes-per-sample instead of guessing at the constant.
    - Configure retention the current way, and say why the command-line flags
      are the wrong way.
    - Explain why size-based retention does not bound total disk usage, and
      what number to target instead.
    - Take a snapshot, read what is inside it, and restore it into a throwaway
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

That checks out `ch24`, not `ch25`. The `ch25` tag already holds both of this
chapter's changes finished — retention moved out of the command line, and
Prometheus behind a password with `:9090` gone — so `git diff ch25` at the end
compares your files against the reference. Until the port goes away, Prometheus
is still on `http://localhost:9090/` and Grafana on `http://localhost:3000/`.
Put the injector somewhere quiet so nothing else moves while you measure:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","error_ratio":0}'
```

Two earlier decisions carry the whole chapter. Prometheus has stored its data
in the **named volume** `promdata` since Chapter 1 and has never used a bind
mount, for a reason this chapter finally explains. And `edge`, the Caddy
reverse proxy Chapter 12 put in front of Snip, is about to get one more job.

## What is actually on the disk

Everything Prometheus writes lives under one directory, which the lab mounts at
`/prometheus` inside the container. Look at it:

```bash
docker compose exec prometheus /bin/sh -c 'ls -1 /prometheus'
```

On a freshly started lab, the whole listing is four lines:

```text
chunks_head
lock
queries.active
wal
```

Not a single block. Nothing that looks like stored history. And yet every
dashboard you have built is drawing, which is the first thing worth
understanding: **the last couple of hours of data are not on disk in any form
you can query.** They are in memory, in the head block, and `wal/` is the
insurance policy on that memory.

Chapter 24 gave you the one-sentence version of the head block while you
watched `prometheus_tsdb_head_series` climb. Here is the whole model, in four
steps, because three separate operational surprises fall out of it.

1. A sample arrives from a scrape. It is appended to the **head block** in
   memory **and** written to the write-ahead log on disk. The WAL exists for
   exactly one purpose: if the process dies, the memory is gone and the WAL is
   how the head is rebuilt. It is written in 128 MB segments, and Prometheus
   keeps a minimum of three — a busy server keeps more, because it needs at
   least two hours of raw records.
2. When a chunk inside the head fills up, it is written out to `chunks_head/`
   and memory-mapped: out of the Go heap, still queryable. That is why memory
   use does not climb in a straight line with the samples taken.
3. Roughly every two hours the head is compacted into a persistent block
   directory, and the WAL is checkpointed: the segments covering that window
   are dropped, and records for series still live are rewritten into a
   `checkpoint.NNNNNNNN/` directory.
4. In the background, those two-hour blocks are merged into bigger ones.

Leave the lab running and come back; the listing grows directories whose names
look like somebody sat on the keyboard:

```text
/prometheus
├── 01M696NNMSS88TMATNJEXBJT0G   a finished block, 2 h or more
│   ├── chunks/000001            the samples themselves
│   ├── index                    labels ▶ series ▶ chunks
│   ├── meta.json                time range and counts
│   └── tombstones               deleted, not yet removed
├── 01M696SXDGBM2D0G5849GM8Z71   another finished block
├── chunks_head/000001           head chunks, memory-mapped
└── wal/                         128 MB segments, plus a checkpoint
```

The keyboard-mash names are **ULIDs**. They sort lexicographically in creation
order, so `ls` gives you the blocks oldest first, and that is the entire ULID
tour you need.

Step 4 has one number in it that matters. Compaction creates blocks spanning up
to **10% of the retention period, or 31 days, whichever is smaller**. The lab
keeps 45 days, so the largest block you will see here spans about four and a
half. A server keeping a year would top out at 31 days.

The operational consequence of steps 1 and 2 together is the sentence this
chapter exists to deliver. **RAM tracks active series. Disk tracks samples.**

Two resources, driven by two different things. The head block holds one entry
per *series* currently receiving data — the sample values are small, the series
metadata and label strings are not. The blocks on disk hold every *sample* you
have ever kept, compressed.

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
sample**. That sounds too good until you remember what a sample is: a timestamp
and a float, stored inside a chunk that already knows which series it belongs
to, with the timestamps delta-of-delta encoded (they arrive at a fixed
interval, so the deltas are nearly all identical) and the values XOR-encoded
against the previous one (most metrics change slowly or not at all). The label
strings — the expensive part — are stored once per series in the index, not
once per sample.

Two of the three terms you already know. Retention is whatever you configure.
Samples per second you can measure right now:

```promql
sum(rate(prometheus_tsdb_head_samples_appended_total[5m]))
```

On the lab run these measurements come from, twelve scrape jobs across fourteen
targets held roughly 9,000 series at a 15-second interval. Nine thousand
divided by fifteen puts the ingest rate near 600 samples per second, and the
query is how you check the arithmetic against your own stack. Expect a larger
number the longer the stack has been up: `catalog` is deliberately
misinstrumented and its series count grows without bound, so a reading near
1,000 after a few hours is normal here. That is itself the lesson — ingest rate
is a property of the stack *today*, not of the stack.

So for 90 days at 600 samples per second:

```text
90 days = 7,776,000 seconds

7,776,000 × 600 × 1 byte  ≈  4.7 GB
7,776,000 × 600 × 2 bytes ≈  9.3 GB
```

Five to nine gigabytes to keep this laptop-sized lab for a quarter — a real
number to hand to whoever asked. It should also make you look hard at the 2 GB
size cap this chapter is about to add to `prometheus.yml`: at 600 samples per
second that limit binds long before 45 days do, and which of your two limits
actually stops you is a thing to know rather than discover.

### Measuring your own bytes per sample

One to two bytes is an average over other people's data. Measure yours.
Prometheus reports, for every compaction it performs, both the number of bytes
written and the number of samples those bytes contain:

```promql
rate(prometheus_tsdb_compaction_chunk_size_bytes_sum[1h])
  /
rate(prometheus_tsdb_compaction_chunk_samples_sum[1h])
```

Bytes over samples is bytes per sample. Both series are counters that only move
when a compaction happens, which is the catch: compactions are hours apart, so
on a young server this expression does not return an error and does not return
nothing. It returns this:

```text
NaN
```

Both counters are sitting at zero, both rates are therefore zero, and zero
divided by zero is NaN. The query is not broken. It is telling you, in the only
vocabulary it has, that nothing has been compacted inside your range.

!!! ladder "Ladder → rung 9"
    NaN from a ratio is Appendix B rung 9 wearing a disguise: is the range wide
    enough? Chapter 6's version of that rung asked whether the window held four
    scrapes. This one asks whether it held one **compaction**, which happens
    every couple of hours rather than every fifteen seconds. Widen to `[6h]`
    before you go looking for a bug — and if `[6h]` is still NaN, your server
    has genuinely not compacted yet, which on a lab you restarted this morning
    is the expected answer rather than a fault.

Once a compaction has landed, the number arrives. On the stack these
measurements come from it read **2.63 bytes per sample** — higher than the
documented one-to-two band, and yours probably will be too. Samples compress
well when they arrive at a regular interval and the value changes predictably;
a counter climbing by a steady amount costs almost nothing per sample. They
compress badly when a series is short-lived, because a chunk holding twelve
samples still carries its own overhead. This lab is the bad case on purpose:
`catalog` mints new series continuously, so many of its chunks never fill up
before the series they belong to is abandoned.

Compactions being hours apart is also why the dashboard panel you are about to
build is the one place in the lab that uses `[$__range]` instead of
`$__rate_interval`: a few minutes of window almost never contains a compaction,
and `$__range` is as wide as whatever the time picker says.

### The memory question, answered honestly

Every capacity discussion eventually reaches "and how much RAM per series?" You
will find one number quoted everywhere: 3 kB. It is not what people think.

**There is no official memory-per-active-series figure in the Prometheus
documentation.** The 3 kB everyone repeats traces to a single blog post from
September 2020, written against Prometheus 2.20, and it described *head chunk*
memory — not the memory the whole process holds. Quoting it as a container
budget today is quoting a six-year-old measurement of a different quantity.

What practitioners report now clusters higher, in the region of 6 to 10 KiB per
active series once the index, query working memory and Go's own overhead are
counted. Budget around **8 KiB per active series as a starting point, then
measure**. Measure it here: the lab caps the Prometheus container at 2 GB, and
Chapter 22 gave you cAdvisor.

```promql
container_memory_working_set_bytes{name="obslab-prometheus-1"}
  / scalar(prometheus_tsdb_head_series)
```

On this lab that comes back around **23,000 bytes** — roughly three times the
8 KiB you were told to budget. The budget is not wrong and the measurement is
not wrong; they describe different regimes. The absolute numbers say why: 367
MiB of working set against about 17,000 head series. A Prometheus process pays
a **fixed cost before it stores anything** — the Go runtime, the symbol table,
compaction buffers, the memory a concurrent range query borrows — and at
seventeen thousand series that fixed cost is most of the total. Per-series
arithmetic only starts to mean anything once the series are the bulk of the
process. Below that, dividing by series count measures the floor.

So provision from the per-series figure, because on a server large enough to
care it is the term that dominates, and then watch the absolute number, because
that is what the kernel kills you on. Write today's down and re-run it after
anything that changes series counts.

## Retention, the way that works now

Almost every `docker-compose.yml` you will find on the internet configures
retention like this:

```yaml
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.retention.time=45d
```

That still works. It is also deprecated, and the binary will tell you so if you
ask it:

```bash
docker compose run --rm --no-deps -T \
  --entrypoint /bin/prometheus prometheus --help 2>&1 \
  | grep -A9 'storage.tsdb.retention.time'
```

!!! trap "The flag you were about to copy"
    Prometheus 3.13.1's own help text, wrapped here to fit the page:

    ```text
    --storage.tsdb.retention.time=STORAGE.TSDB.RETENTION.TIME
        [DEPRECATED] How long to retain samples in storage. If
        neither this flag nor "storage.tsdb.retention.size" is
        set, the retention time defaults to 15d. Units Supported:
        y, w, d, h, m, s, ms. This flag has been deprecated, use
        the storage.tsdb.retention.time field in the config file
        instead. Use with server mode only.
    ```

    `--storage.tsdb.retention.size` carries the same `[DEPRECATED]` marker and
    the same instruction. Set both the flag and the config field and the
    **config field wins** — it takes precedence, silently. So a stack with a
    flag in `compose.yaml` left over from 2022 and a field in `prometheus.yml`
    added last month is running on the field, and the flag is a lie that reads
    like documentation. Delete the flag.

If you go looking for confirmation in the documentation you will find the
documentation disagreeing with itself. The storage page still presents
retention as command-line flags and says nothing about the config fields; the
configuration reference documents the fields and marks the flags deprecated.
Both ship with 3.13.1. When two pages of one manual conflict, prefer the one
the binary agrees with, and the binary's `--help` is quoted here saying
`[DEPRECATED]`. That is the general technique, and not only here: the program
is the primary source, and its help text is the cheapest way to ask it.

Your `compose.yaml` carries one of those deprecated flags right now. Chapter 20
added `--storage.tsdb.retention.time=45d` so that `make backfill`'s imported
month would survive its first compaction, said in as many words that the
command line was the wrong home for it, and owed you this chapter. *IOU from
chapter 20, settled.* Delete that line from the `prometheus` command block.

Then add this to `lab/prometheus/prometheus.yml`, below `rule_files:`, in a
top-level `storage:` block that this chapter is the first to use:

```yaml
storage:
  tsdb:
    retention:
      time: 45d
      size: 2GB
```

Three things about that block are load-bearing.

It is **hot-reloadable**. Unlike the flags, which need a process restart, these
fields are re-read on a configuration reload — and the lab runs Prometheus with
`--config.auto-reload`, so saving the file is enough; the change lands within
thirty seconds. Chapter 12's `make reload` still works if you are impatient.
Either way the server says so in its log, and that line is the confirmation
worth waiting for:

```text
msg="TSDB retention updated" duration=45d size=2GiB percentage=0
```

The time unit accepts `y`, `w`, `d`, `h`, `m`, `s` and `ms`. **45 days is a
deliberate number, not a default** — it is the one Chapter 20 picked, and the
field inherits it unchanged. Upstream's default is 15 days, shorter than the
rolling 30-day window both of Chapter 20's objectives are defined over.
Retention shorter than the longest window you query does not produce an error.
It produces a gauge that still renders, labeled "30 days", showing you fifteen.

And the size unit accepts `B`, `KB`, `MB`, `GB`, `TB`, `PB`, `EB` — in powers
of two. Look again at that log line: you wrote `2GB` and Prometheus echoed
`2GiB`, because those are the same quantity under this scheme. If both a time
and a size limit are set, whichever triggers first is the one that acts.

A third field in the same block is worth knowing by name: `percentage`, added
in 3.11, which expresses the size limit as a share of the total disk so it
adapts when a volume is resized. It is **experimental**, and a server that
cannot determine its own total capacity refuses to start with it enabled. The
log line prints `percentage=0`, which is off.

### Size retention does not bound your disk

This is the part that costs people a volume.

Size retention deletes **persistent blocks**, and only those. It does not touch
the WAL or `chunks_head/` — but both count toward the total it compares against
your limit, so the limit is enforced against a number that includes two
directories the limit cannot shrink.

Play that forward. If the WAL and the head chunks together are, at their peak,
larger than your size limit, Prometheus will delete every persistent block you
have and still be over the limit, with nothing further it can do. You will have
a monitoring system with no history and a full disk.

The floor is therefore not zero: **the minimum disk you need is the peak size
of `wal/` and `chunks_head/` combined**, and that peak arrives every two hours,
just before compaction. Look at yours:

```bash
docker compose exec prometheus /bin/sh -c \
  'du -sh /prometheus/wal /prometheus/chunks_head'
```

Three hours into a session, this lab reported 38.1 MB of WAL against 17.3 MB of
head chunks — about 55 MB of floor under a 2 GB ceiling, which is comfortable.
A server with a hundred times the series would not be.

The official guidance is to set the size limit to **at most 80–85% of the disk
space you have allocated**. That headroom is not superstition; it is the space
those two untrimmable directories need at their peak, plus room for a
compaction to write a new block before it deletes the old ones.

!!! pitfall "Setting the size limit to the size of the volume"
    It looks tidy: a 10 GB volume, `size: 10GB`, nothing wasted. What you have
    built is a system that only starts deleting blocks once the disk is already
    full, and that needs free space in order to compact — which it no longer
    has. Compaction fails, blocks are not released, and the failure mode looks
    like corruption rather than like a full disk. Use 8 GB, not 10.

### Watching a block die

Changing retention is instantaneous. Seeing the effect is not, and the gap
between those two facts is where people hurt themselves.

First, list the blocks you have:

```bash
docker compose run --rm --no-deps -T \
  --entrypoint /bin/promtool prometheus \
  tsdb list -r /prometheus
```

You get one line per block: ULID, time range, sample and series counts, size on
disk. Do not be surprised if the first one is short — on this lab it read
`16m5.1s`, because head blocks are cut on two-hourly wall-clock boundaries
rather than two hours after startup, so the first is whatever was left of the
bucket you started in. That also means how soon your first block appears
depends on when you ran `make up` relative to an even hour.

If the command prints a header row and nothing under it, you have no persistent
blocks yet — the lab is young, or a `make reset` took them. Chapter 20's import
is the quickest way to get some: `make history && make backfill` writes thirty
days of blocks in one pass.

!!! warning "This deletes your backfilled history"
    Dropping retention to 15 days deletes those backfilled blocks permanently,
    and putting 45 back does not bring them home. That is the lesson, but do it
    knowing the price. To restore afterwards: `make history && make backfill`.

Edit `lab/prometheus/prometheus.yml`, change `time: 45d` to `time: 15d`, and
save. Within thirty seconds the auto-reloader picks it up. Confirm that
Prometheus is running on the new value rather than taking your word for it:

```bash
curl -s http://localhost:9090/api/v1/status/config \
  | jq -r '.data.yaml' | grep -A3 'retention:'
```

That reads the configuration the server is actually holding, not the file:

```text
    retention:
      time: 15d
      size: 2GiB
```

Now list the blocks again. They are still there. Wait a minute, list once more,
and the old ones start disappearing.

That gap is the behavior to internalize. A retention change applies to the
running server **immediately**, but block deletion happens on the next block
reload cycle — within a minute, or when a compaction finishes, whichever comes
first — and cleanup of fully expired blocks runs in the background and may take
**up to two hours**. A block is only removed once it is *entirely* outside the
window, so one straddling the boundary stays: at 15 days the largest block
spans 1.5 days, and a 15-day retention can legitimately still be answering
questions about samples sixteen and a half days old. Change retention once,
then wait two hours before deciding it did not work.

Put `time: 45d` back and save.

## Where the data must not live

One line of the storage documentation deserves to be read out loud:
non-POSIX-compliant filesystems are not supported for local storage, because
unrecoverable corruption may happen. NFS is named explicitly, and so is AWS's
EFS, which is NFS wearing a different badge. This is not a performance note.
Prometheus relies on POSIX semantics for file locking, renames and memory
mapping, and a filesystem that approximates them will work for weeks and then
hand you a block that cannot be read.

The same caution is why `promdata` has been a named Docker volume since
Chapter 1 and not a bind mount to a folder on your laptop. On Docker Desktop a
bind mount crosses a translation layer between the host filesystem and the
Linux VM, and the TSDB — memory-mapped chunk files and a write-ahead log — is
precisely the workload that finds the gaps in it.

You do not have to take that on faith, because Prometheus announces the
filesystem it found at startup:

```bash
docker compose logs prometheus | grep 'filesystem information'
```

On the lab's named volume, one line comes back:

```text
msg="filesystem information" fs_type=EXT4_SUPER_MAGIC
```

Start the same image against a folder on your Docker Desktop host instead and
the same line reads `fs_type=V9FS_MAGIC` — the Plan 9 protocol used to pass
host directories into the VM, and emphatically not a local POSIX filesystem.
That one grep is the fastest honest answer to "is my Prometheus data somewhere
safe?" that exists. The corollary is that you cannot open the data directory in
your file manager, which is why every command here goes through a container.

One more field lives in the same `storage.tsdb` block and is worth knowing by
name even though you will not set it here: `out_of_order_time_window`. It
defaults to zero, meaning a sample whose timestamp is older than the newest
sample in its series is rejected. Chapter 28 turns it on and explains what
changes when it does.

## Snapshots, and what "backup" honestly means

The documented way to back up a Prometheus server is a **snapshot**, taken
through the admin API. The documentation is blunt about the alternative:
backups made without snapshots risk losing everything recorded since the last
block was written — which, given what you now know about the head, can be
almost two hours of data.

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
retention flag that sat after them is the one you just deleted. All of them are
listed because `command:` replaces the image's own arguments wholesale, so the
list is always complete or always broken.

The last line is the one this chapter adds, and it is a bargain to make
consciously. `--web.enable-admin-api` enables three endpoints:
`/api/v1/admin/tsdb/snapshot`, `/api/v1/admin/tsdb/delete_series`, and
`/api/v1/admin/tsdb/clean_tombstones`. One flag buys you the backup and the
loaded gun; there is no way to have the first without the second. Hold that
thought — it is the hinge of the rest of this chapter.

A flag change needs the container recreated, not restarted, so:

```bash
make up
make snapshot
```

That runs `scripts/snapshot.sh`: it posts to the endpoint, reads the snapshot's
name out of the JSON response, and copies the directory out of the container
into `lab/snapshots/`. The reply is a timestamp and a short hash:

```json
{"status":"success","data":
 {"name":"20261031T144616Z-2ffce58eb8ced030"}}
```

If instead it reports that the admin APIs are disabled, the flag did not take.

Now look at what you got, because the usual description of a snapshot is only
half true. Blocks already on disk are **hard links** to the existing files:
nearly instant, nearly free in space. But the head is not on disk, so it cannot
be linked — it is written out as a brand new block inside the snapshot
directory, and that part costs real bytes. On the lab, a snapshot taken three
hours in came to 21.9 MB across two directories: one hard-linked block costing
almost nothing, and one new 16,702-series block that is the head being made
durable for the first time.

That is also why a snapshot on its own is not a backup. It sits on the same
volume, on the same machine, as the thing it is protecting. It becomes a backup
when you copy it somewhere else.

### Reading a block

You now have a block, which means you can take it apart. `promtool` ships in
the Prometheus image and has a subcommand for exactly this:

```bash
docker compose exec prometheus /bin/promtool \
  tsdb analyze --extended /prometheus/snapshots/<name>
```

Run it against `/prometheus` instead, on a young lab, and you get the answer
the directory listing already implied:

```text
no blocks found
```

Pointed at the snapshot, it has plenty to say. The header first:

```text
Block ID: 01M696SXDGBM2D0G5849GM8Z71
Duration: 2h46m15.229s
Total Series: 16702
Label names: 197
Postings (unique label pairs): 11236
Postings entries (total label pairs): 137413
```

Then, further down, the list that makes this tool worth remembering:

```text
Highest cardinality metric names:
8771 catalog_lookups_total
210 prometheus_http_request_duration_seconds_bucket
189 prometheus_http_response_size_bytes_bucket
145 redis_commands_latencies_usec_bucket
128 node_cpu_seconds_total
126 snip_http_request_duration_seconds_bucket
```

One metric name is forty times the next, and you already know which one and
why: `catalog`'s unbounded `book_id` label, predicted by arithmetic in
Chapter 7 and detonated in Chapter 24. The exact counts depend on how long your
stack has been up — that family grows for as long as `catalog` runs, and the
`prometheus_http_*` families grow with every distinct API path you have hit, so
the order after first place shifts between runs. First place does not move.
Chapter 24 found that bomb on a live server; `promtool tsdb analyze` finds it
in a block with the server switched off, which is what you will have during a
post-mortem.

The compaction analysis at the end shows the physics behind your
bytes-per-sample number:

```text
samples per float chunk (min/avg/max): 1/106/232
bytes per float chunk (min/avg/max): 16/279/1015
```

279 bytes divided by 106 samples is 2.63 bytes per sample, the same figure the
PromQL expression gave. Two completely different routes, one through the
server's own counters and one through the bytes on disk, same answer. Note the
minimum: a chunk holding one sample still costs 16 bytes, and `catalog`
manufactures those by the thousand.

### Restoring into a throwaway

A backup you have never restored is not a backup. Restore this one.

The snapshot is inside `promdata`, where the running server has it. Copy it
into a second named volume without ever touching your host filesystem, which
keeps the restored TSDB off the translation layer `V9FS_MAGIC` names:

```bash
docker volume create restoretest

docker run --rm -v promdata:/src:ro -v restoretest:/dst \
  alpine:3 sh -c 'cp -a /src/snapshots/<name>/. /dst/'
```

Copy, do not mount the original. A Prometheus server writes into its data
directory the moment it starts: a lock file, a fresh write-ahead log, a new
head block. Point a server at your only copy of a backup and it is no longer a
pristine copy of anything.

!!! trap "Mounting the backup read-only"
    The obvious defense is to mount it `:ro` so the server cannot touch it. It
    does not start:

    ```text
    level=ERROR source=query_logger.go:113 msg="Error opening query
      log file" component=activeQueryTracker
      file=/prometheus/queries.active err="open
      /prometheus/queries.active: read-only file system"
    panic: Unable to create mmap-ed active query log
    ```

    The second failure is the same lesson in different clothing. The copying
    container ran as root, so the files landed root-owned, and the Prometheus
    image runs as `nobody` — a plain `docker run` panics on the identical line
    with `permission denied` instead. Both say the same thing: a Prometheus
    data directory is a working directory, not an archive.

So give it a writable volume and a user that can write there:

```bash
docker run --rm -p 9098:9090 --user 0:0 \
  -v restoretest:/prometheus \
  quay.io/prometheus/prometheus:v3.13.1 \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/prometheus
```

That is deliberately not part of the Compose stack: a bare container, on a port
nothing else uses, with the image's bundled configuration. Its startup log says
`duration=15d size=0B percentage=0` — upstream's defaults, because none of your
configuration came along for the ride.

!!! selfcheck "Self-check"
    Open `http://localhost:9098/` and run `count(snip_http_requests_total)`. It
    returns **12** — the twelve series Chapter 7's arithmetic predicted, frozen
    at the instant of the snapshot. `count(up)` returns **14**, one per target,
    and every one of them is a fossil: the restored server is not scraping
    anything, so those series stop dead at the snapshot's timestamp.

Now notice what is missing. The restored server has your samples and nothing
else. No `prometheus.yml`, so it scrapes nothing and knows no targets. No rule
files, so no alerts exist and nothing is being recorded — the `:ratio_rate30d`
series stops at the snapshot rather than continuing. No Grafana and no database
of dashboards, no Alertmanager silences, no `.env`.

**"Snapshot" means the time series database. "Backup" means everything you
would need to stand the system up again.** In this lab that is the git
repository plus a snapshot, and the repository is the more valuable half,
because it is the half you cannot regenerate.

Clean up when you are done: `docker volume rm restoretest`.

### What a restart costs you

Restart Prometheus and time it:

```bash
docker compose restart prometheus
```

On startup the server replays the write-ahead log to rebuild the head block in
memory. All of it has to be read back before the head is whole, and while that
is happening the server is listening but not ready. Watch the progress:

```bash
curl -s http://localhost:9090/api/v1/status/walreplay | jq
```

While a replay is running those three numbers move; when it is finished they
read `{"min":0,"max":0,"current":0}`. Then ask how long it took:

```promql
prometheus_tsdb_data_replay_duration_seconds
```

That metric is the server's own log line in numeric form — compare it with
`total_replay_duration` in `docker compose logs prometheus` and they agree to
the microsecond. On this lab it is a couple of milliseconds. On a server
holding a few million active series it is minutes, and those are minutes during
which every dashboard is blank and every alert on that server is silent. Worth
knowing before a change window rather than during one.

## The row that watches the watcher

Chapter 19 built alerts about the monitoring system — rule evaluation failures,
notification failures, the Watchdog — and one of its annotations pointed at a
dashboard link, `http://localhost:3000/d/obslab-meta`, that went nowhere. Time
to settle that: *IOU from chapter 19, settled.*

Two files. The first is `lab/prometheus/rules/meta-recording.yml`, three
recording rules over the series Prometheus writes about every scrape it
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
that job answered its last scrape; on a two-replica job, 0.5 means one replica
is gone, a distinction `up == 0` and a bare count both throw away. The second
rule records what each job costs *after* `metric_relabel_configs` has run,
which is the honest number rather than what the target offered. The third takes
the maximum rather than the average, because an average hides the one exporter
about to time out.

The second file is `lab/dashboards/meta.json`, picked up by the provider
Chapter 3 set up. Its uid is `obslab-meta` — the one Chapter 19's annotation
already named — and it has three rows. Dashboard JSON is not something to type,
so take both files from the repository:

```bash
git checkout ch25 -- dashboards/meta.json \
  prometheus/rules/meta-recording.yml
```

That form of `git checkout` takes named paths out of a tag and leaves the rest
of your working tree, your edits included, alone.

| Row | Answers |
|---|---|
| Scrape health | Is every target answering, and how fast? |
| TSDB and the rule engine | Is Prometheus itself coping? |
| The notification pipeline | Did the page actually reach a human? |

The first row reads `job:up:ratio` as a percentage, counts targets that are
down, draws a state timeline of `up` per target, and graphs
`job:scrape_duration_seconds:max`. The last of those is the early warning
nobody builds: scrape duration climbing toward `scrape_timeout` is how a target
starts failing, minutes before `up` goes to zero.

The second row is this chapter's. `prometheus_tsdb_head_series` is the
cardinality line Chapter 24 taught you to fear.
`rate(prometheus_tsdb_head_samples_appended_total[$__rate_interval])` is the
ingest rate that feeds the disk formula, next to the per-job breakdown from
`job:scrape_samples_post_metric_relabeling:sum`. Bytes-per-sample is the
`[$__range]` stat panel, and the WAL replay time you just learned to read gets
its own. Rule group evaluation time, failures and missed iterations complete
it: a group whose evaluation takes longer than its interval starts skipping
iterations, and `prometheus_rule_group_iterations_missed_total` is the only
thing that says so.

The third row is Chapter 19's, unchanged: Prometheus to Alertmanager,
Alertmanager to receivers, what the pager received, the dead man's switch, and
Chapter 23's probe results.

!!! selfcheck "Self-check"
    Open `http://localhost:3000/d/obslab-meta`. The "Scrape health, worst job"
    stat reads **100%** with all fourteen targets up, "Targets down" reads
    **0**, and "Head series" draws a line rather than an empty panel. "Bytes
    per sample" shows nothing until a compaction has landed inside the picker's
    range; widen it to 6 hours and it fills in.

## Locking the door

Now the part most introductory books skip.

### What Prometheus gives you, and why it is not enough

The Prometheus security documentation states its model plainly: untrusted users
are presumed to have access to the HTTP endpoint and the logs, and therefore to
every time series in the database plus a good deal of operational and debugging
information. It follows that with a sentence worth memorizing — the HTTP
endpoints "should not be exposed to publicly accessible networks like the
internet."

Read that as an operator rather than as a reader. It is not saying "secure your
Prometheus." It is saying that securing it is not Prometheus's job, and that
the intended deployment has something else standing in front.

Concretely, anyone who can reach `:9090` right now can list your targets and
your service discovery, read your rule files and your configuration, read every
metric you have, and run arbitrary expensive PromQL until the server falls
over. Denial of service through an expensive query is explicitly not treated as
a security vulnerability by the project.

And four flags widen that further on this lab by the final chapter:

| Flag | Default | What it opens |
|---|---|---|
| `--web.enable-lifecycle` | `false` | `POST /-/reload` and `/-/quit` |
| `--web.enable-admin-api` | `false` | snapshot, delete series, tombstones |
| `--web.enable-otlp-receiver` | `false` | an endpoint that accepts writes |
| `--web.cors.origin` | `.*` | every browser origin, anchored |

The first three are switches, all off by default upstream. The first two are on
now because Chapter 12 and this chapter needed them, and Chapter 28 turns on
the third. The fourth is not a switch: the permissive value *is* the default.
`POST /-/quit` stops the server. The admin API deletes series. The receiver
lets anyone who can reach the port inject arbitrary metrics into your database,
a subtler attack than deletion and much harder to notice. And the lab's
Prometheus runs as root with the Docker socket mounted, which Chapter 12
already said out loud is effectively root on your host.

Prometheus does ship something. `--web.config.file` points at a file that can
configure TLS and bcrypt-hashed basic auth users, and the same file format is
understood by Alertmanager and by most official exporters — one thing learned,
used in five places. The file is read on every HTTP request, so adding a user
or rotating a certificate takes effect immediately, with no restart.

It is also **explicitly experimental**. The HTTPS documentation says so in its
first paragraph, and the project's stability document lists server-side HTTPS
and basic authentication as unstable for the 3.x line. That is not a prediction
that it will break; it is a statement that its behavior is not covered by the
compatibility promise.

More to the point, it is all-or-nothing. A basic auth user is authenticated for
the whole server or not at all: no roles, no read-only users, no per-endpoint
rules, no way to say "this account may query but may not touch
`/api/v1/admin`", no single sign-on, no audit log, no rate limiting. If you
want someone to be able to look at a graph without being able to delete your
data, the built-in option cannot express that.

A reverse proxy can. It terminates TLS with a certificate your organization
already manages, authenticates against whatever your organization already uses,
logs every request, rate-limits, and — the part that matters most here — routes
per path. Blocking `/api/v1/admin/` and `/-/quit` while allowing
`/api/v1/query` is three lines in any proxy configuration and is inexpressible
inside Prometheus.

### Putting a proxy in front

You already have one. `edge` has been serving HTTPS on `:8443` since
Chapter 12, with a certificate from Caddy's own internal certificate authority
— which is what makes an offline TLS lab possible. It gains a second handler.

Generate a password hash — never write a plaintext password into a config file,
even in a lab:

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

Prometheus's own pages then ask for their assets from the root of whatever host
served them, not from `/prometheus/`. That is why the bare `handle` block is
there, proxying the site root behind the same credentials. Leave it out and the
UI renders as a blank page with a correct page title — a maddening symptom to
debug from the browser alone.

And the basic auth is scoped to those handlers, leaving `GET /-/healthy` on
`:8443` open. That is Chapter 23's probe target, reached as
`https://edge:8443/-/healthy` with the `http_2xx_insecure_tls` module. Put a
site-wide password in front of it and `probe_success` for that target goes to
zero, the certificate-expiry alert loses its data source, and you have broken
monitoring in the act of securing it. Which is itself the lesson: the first
thing an authentication change breaks is usually the thing that was watching.

One detail of the certificate carries over from Chapter 12 and bites here. It
covers two names: `localhost` for you, `edge` for the blackbox exporter inside
the Compose network. Caddy chooses a certificate from the name in the TLS
handshake, so `curl -k https://127.0.0.1:8443/` matches neither site block,
`-k` notwithstanding. Use `https://localhost:8443/`.

### Taking the port away

Now delete this from the `prometheus` service in `compose.yaml`:

```yaml
    ports:
      - "9090:9090"
```

Then `make up`, and here is the thing to watch: open Grafana and look at any
dashboard. Everything works. Nothing reconnects, nothing errors, nothing needs
reconfiguring.

That is because Grafana never used the published port. Its data source is
`http://prometheus:9090` — a Compose service name resolved on the `obsnet`
network, with `access: proxy` so the request is made by Grafana's backend and
not by your browser. The published port existed for you, and removing it
removes your access and nobody else's. That is exactly the property you want
from a port you are about to stop publishing in production.

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
certificate, issued by Caddy's own authority, which your machine has no reason
to trust — accept it for the lab, and note that this is what a certificate
warning is *for*.

From here on `http://localhost:9090` is gone. `make reload` already knows: the
Makefile's `PROM_URL` defaults to the proxy URL with the credentials attached.
If you check out an earlier tag, where the port is still published, override it
for that command:

```bash
make reload PROM_URL=http://localhost:9090 PROM_CURL_OPTS=
```

The verify scripts need no such help. They try `:9090` first and fall back to
the proxy, which is why `make verify-ch12` still works on the tag it belongs to
and `make verify-ch25` works here.

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
    PASS the deprecated retention flag is gone from compose.yaml
    PASS prometheus/rules/meta-recording.yml exists
    PASS the meta dashboard is provisioned
    PASS Prometheus answers queries behind the proxy
         reached at: https://localhost:8443/prometheus

    ch25: 9 passed, 0 failed
    ch25 OK
    ```

    If the 401 assertion fails and you get 200 instead, the `basic_auth`
    directive is outside the handler you think it is in. If the credentials
    assertion fails, set `OBSLAB_PROM_USER` and `OBSLAB_PROM_PASS` to whatever
    you hashed.

## Common mistakes

**Shortening retention to fix memory.** The most common wrong move in this
subject, and now you know why it does nothing: retention governs blocks on
disk, and memory is governed by the count of series currently receiving
samples. Chapter 24 has the fix; this chapter has the explanation.

**Reading NaN as a broken query.** The bytes-per-sample expression divides one
rate by another, and on a server that has not compacted inside your range both
rates are zero. NaN is the honest answer to nothing divided by nothing. Widen
the range before you rewrite the query.

**Believing the retention change did not work.** You edit, you reload, you
watch `du`, nothing moves. Deletion happens on the next block reload cycle, and
full expired-block cleanup can take two hours. Changing it a second time out of
impatience is how people delete a quarter of their history in one afternoon.

**Treating the snapshot as the backup.** It lives inside the same data
directory on the same volume. If the volume goes, so does it. And even copied
off, it contains the TSDB alone — not your configuration, rules or dashboards.

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

Prometheus keeps the last couple of hours in memory, protected by a write-ahead
log, and everything older in immutable blocks on disk. That split explains the
two resources you plan for separately: memory scales with active series, disk
scales with samples kept. Sizing the disk is arithmetic with one constant you
should measure rather than assume. Sizing the memory has no official constant
at all, which is worth saying out loud rather than repeating a number from
2020.

Retention moved into the configuration file, where it can be changed without a
restart, and the flags you will find in every old compose file are deprecated
and silently outranked. Backups are snapshots plus the repository that
describes the system, and a restore you have never performed is a hypothesis.
And Prometheus has no authentication and says so in its own documentation. The
answer is a proxy, and you now have one.

The durable takeaways:

- RAM tracks active series. Disk tracks samples. Retention only touches the
  second.
- `retention_time_seconds × samples_per_second × bytes_per_sample`, with 1–2
  bytes as the documented average and your own measurement as the real number.
- There is no official memory-per-series figure. Budget ~8 KiB and measure; the
  3 kB everyone quotes is a 2020 head-chunk figure for Prometheus 2.20, and on
  a small server the fixed floor swamps the per-series term anyway.
- Retention belongs in `storage.tsdb.retention` in the config file. The
  matching flags are deprecated and the config fields take precedence.
- Size retention deletes blocks only, but counts the WAL and head chunks toward
  the total. Target 80–85% of your volume, never 100%.
- Block deletion lags a retention change by up to a reload cycle, and full
  cleanup by up to two hours. Change it once and wait.
- Never put the TSDB on NFS, EFS, or a Docker Desktop bind mount — check which
  you have with one grep for `fs_type` in the startup log.
- A snapshot is the TSDB. A backup is the TSDB plus everything that describes
  the system, and it is not a backup until you have restored it.
- Prometheus has no login page. `--web.config.file` is experimental and
  all-or-nothing. A reverse proxy is the real answer.

## Exercises

!!! exercise
    **1. Your own bytes per sample (warm-up).** Take a snapshot, run
    `promtool tsdb analyze --extended` against it, and divide the average bytes
    per float chunk by the average samples per float chunk. Compare that with
    the PromQL ratio over `[6h]` and with the documented 1–2 bytes. Give two
    concrete reasons yours is higher — one about `catalog`, one about chunks
    that never fill up. Then compute, from your measured ingest rate, the disk
    needed to keep 90 days.

    **2. The floor under the ceiling (core).** Measure `wal/` and
    `chunks_head/` with `du -sh` four times across an hour and record the peak.
    Set `storage.tsdb.retention.size` to half that peak, save, and watch for
    fifteen minutes: what gets deleted, and what cannot be. Put `2GB` back and
    say in one sentence why 80–85% of a volume is the right target.

    **3. The restore, and the gap (core).** Restore your snapshot into a
    throwaway server on `:9098` and confirm `count(snip_http_requests_total)`
    returns 12. Then list five things the restored server does not have that
    the original does, naming for each the file or volume that holds it.

    **4. The loaded gun (core).** Through the proxy, with credentials, POST to
    `/api/v1/admin/tsdb/delete_series?match[]=catalog_lookups_total` and then
    to `/api/v1/admin/tsdb/clean_tombstones`. Confirm the series are gone and
    note how long it took. Then write the one sentence you would put in a
    change request explaining why that endpoint must never be reachable from a
    network you do not control.

    **5. The cost of a restart (stretch).** Restart Prometheus and time it,
    polling `/api/v1/status/walreplay` as it comes back. Read
    `prometheus_tsdb_data_replay_duration_seconds` afterwards and check it
    against `total_replay_duration` in the log. During that window, what did a
    query through Grafana do — error, hang, or return an empty result? Then
    estimate the same window for a server holding a hundred times this lab's
    series count.

    **6. Grafana behind the door too (stretch).** Add a second `handle_path`
    block to the `:8443` site proxying `/grafana/*` to `grafana:3000`, and
    reach Grafana through it. Something breaks: the login redirect, the assets,
    or both. Find `root_url` in Grafana's configuration, say what it is for,
    and explain in two sentences why a reverse proxy at a sub-path is a
    contract between the proxy and the application rather than a setting on
    only one of them.
