# Chapter 12 — `prometheus.yml` in Full: Service Discovery and Relabeling

At 03:14 a page arrives. The failing thing, it says, is `172.19.0.7:8000`. You
are awake, you are logged in, and you still do not know what that is. It is a
container that did not exist yesterday and will not exist tomorrow, on a
network whose address range you have never memorized, and the only way to find
out which service it belongs to is to go and ask Docker — which is exactly what
you would have wanted the monitoring system to do in the first place.

The second problem is smaller and just as annoying. Snip is getting popular, so
you want four copies of it. Right now that means adding four lines to
`prometheus.yml`, and four more when somebody scales to eight, and remembering
to take them out again afterwards. The configuration file has become a
hand-maintained inventory of a system that changes without asking it.

Both problems have the same fix, and it lives entirely inside one file you have
been treating as boilerplate. This chapter reads `prometheus.yml` from the first
line to the last, now that every section in it means something to you, and then
replaces the hand-written target list with a job that asks the container runtime
what is running — and rewrites what comes back until the page says
`snip-api-3`.

!!! objectives "Objectives"
    After this chapter you can:

    - Read any `prometheus.yml` and say what each block does and which
      setting wins when two of them disagree.
    - Move a job from `static_configs` to `file_sd_configs` and then to
      `docker_sd_configs`.
    - Write `relabel_configs` using `keep`, `drop`, `replace` and
      `labelmap`, and predict the label set that comes out.
    - Tell `relabel_configs`, `metric_relabel_configs` and
      `write_relabel_configs` apart, and say what each of them can see.
    - Scale a service and watch its targets appear with no config edit and
      no restart.
    - Set the six scrape limits and explain why five of the six fail the
      whole scrape instead of trimming it.

## Where you are

This chapter assumes the lab as Chapter 11, "Joins, Info Metrics, and the Rest
of PromQL" left it: two Snip containers named `snip-api` and `snip-api-b`, plus
`snip-worker`, `loadgen` and `catalog`, all listed by hand in
`prometheus.yml`. Prometheus is on `http://localhost:9090` and Grafana on
`http://localhost:3000`.

```bash
cd lab
make down
git checkout ch12
make up
```

The `make down` is not decoration. The file you are about to check out has no
`snip-api-b` service, and Compose will not remove a container belonging to a
service it no longer knows about — it leaves it running and calls it an orphan.
`make down` runs with `--remove-orphans`, so doing it first, while the old file
is still checked out, is the clean way through. Your stored data lives in a
named volume and survives all of it.

When `make up` finishes you have **two** `snip-api` containers and no
`snip-api-b`: the Makefile passes `--scale snip-api=2` from this chapter on.
Snip publishes no host port at all now, and `http://localhost:8080` is the way
in. Chapter 2, "What's Actually on the Wire", promised this fix in a trap box;
re-read it before you continue.

## The file, top to bottom

Open `lab/prometheus/prometheus.yml`. Every top-level key in a Prometheus
configuration belongs to one of a handful of groups: defaults, where alerts go,
which rule files to load, how much disk to keep, what leaves the server, and
one entry per thing to scrape. Only the last group has ever mattered to you.
The others do now.

### `global`, and what "global" does not mean

```yaml
global:
  scrape_interval: 15s
  scrape_timeout: 10s
  evaluation_interval: 30s
```

`global` is a set of **defaults**, not overrides, for the keys a job can also
set: `scrape_interval`, `scrape_timeout`, `scrape_protocols`,
`metric_name_validation_scheme` and the six limits below. Write one of those
inside a `scrape_config` and the more specific setting wins, with no merge.

The keys that describe the *server* rather than a scrape have no per-job form
at all: `evaluation_interval`, `external_labels`, `query_log_file` and
`rule_query_offset`. Writing one inside a job is not a losing override, it is
a file the server refuses to load — `field evaluation_interval not found in
type config.ScrapeConfig`. And `external_labels` is the one key here that
really is enforced on everything.

`scrape_interval` is the resolution of everything you will ever see, and
`scrape_timeout` is how long one fetch may take before it is abandoned. The
timeout may not exceed the interval, and Prometheus refuses the configuration
rather than guessing:

```text
  FAILED: parsing YAML file /etc/prometheus/prometheus.yml: global
  scrape timeout greater than scrape interval
```

`evaluation_interval` is how often recording and alerting rules run. It
changes nothing today, because the lab loads no rules until Chapter 15,
"Recording Rules".

Two more `global` keys are worth knowing by name even though the lab leaves
both at their defaults. `scrape_protocols` is the ordered list of exposition
formats Prometheus offers a target during content negotiation; Chapter 5, "Your
First Counter: Instrumenting Code You Own", introduced Prometheus 3's refusal
to guess when a target sends no `Content-Type`, and this is the list it
negotiates from.
`metric_name_validation_scheme` defaults to `utf8` in v3, which is why a metric
name containing a dot is storable at all; `legacy` restores the old
letters-numbers-colons-underscores rule. Both can be set per job too.

Then the key that behaves unlike anything else in the file:

```yaml
global:
  external_labels:
    cluster: obslab
    replica: ${PROM_REPLICA}
```

`compose.yaml` sets `PROM_REPLICA: a` in the `environment:` of the `prometheus`
service. Ask two questions that look almost identical:

```promql
up{env="lab"}
```

One row per target, every one of them present. Now:

```promql
up{cluster="obslab"}
```

```text
Empty query result
```

`env="lab"` is a **target label**: it is attached to every sample as it is
stored, so every query can see it. `cluster="obslab"` is an **external label**,
and external labels are not stored at all. They are stamped on data as it
*leaves* this server — on alerts, on copies pushed to a remote system, and on
what it serves at `/federate` when another Prometheus pulls from it, which is
the subject of Chapter 26, "When One Prometheus Isn't Enough: HA,
`remote_write`, and the Scaling Map". An ordinary scrape of `/metrics` gets
none of them, which is why the `prometheus` job in this very file stores
`up{job="prometheus"}` with no `cluster` on it.

That distinction costs teams weeks. Somebody puts `region` in
`external_labels`, writes a dashboard filtering on `region`, and gets nothing.
The rule is simple once you have seen it fail: if a query needs the label, it
is a target label and belongs in a relabel rule. If only the *outside world*
needs it, it is an external label.

The `${PROM_REPLICA}` is not a typo. Prometheus 3 expands `${var}` and `$var`
inside external label values from its own environment, unconditionally — the v2
`expand-external-labels` feature flag was removed when it became the default. An
undefined variable becomes the empty string and logs a warning, and `$$` escapes
a literal dollar sign. Chapter 26 needs exactly this to run two servers from
one config file that disagree on one label.

!!! jargon "Target label"
    A **target label** is a label Prometheus attaches to every sample it
    stores from one target, decided entirely by the scrape configuration:
    `job`, `instance`, and anything a relabel rule writes. The application
    being scraped has no say in it. Chapter 2's rule — that `job`,
    `instance` and `env` are set by whoever runs the scrape and never by the
    code being scraped — is a statement about target labels.

### The blocks that are not scrapes

Your file has two top-level keys today: `global:` and `scrape_configs:`. The
rest arrive as you need them. Read them here anyway, so that somebody else's
file holds no surprises.

`alerting:` names the servers that alerts are sent to, and pins
`api_version: v2` because v1 no longer exists; Chapter 16, "Alerting Rules, and
What 'Firing' Actually Means", fills it in. `rule_files:`, added in Chapter 15,
is a list of globs, and the glob does not recurse — which is how Chapter 18,
"Testing Alerts Before They Page You", will sit its rule *tests* one level down
without the server ever loading them. `storage:` holds the retention settings,
which live in the config file rather than on the command line because — unlike
the deprecated flags — these are re-read on a reload; Chapter 25, "Storage,
Retention, Backups and Locking the Door", adds it. `otlp:` configures the
receiver Chapter 28, "OpenTelemetry and Prometheus", turns on — that one is
about what *arrives*. `remote_write:` is the "what leaves the server" group: a
list of destinations this server copies every sample to as it stores it, and
the block `write_relabel_configs` lives in; Chapter 26 fills it in. Each is
one chapter's subject and none of them is this chapter's; knowing they exist
and roughly what shape they are is enough.

### Inside one `scrape_config`

Four per-job keys deserve a name before you meet them in anger.

`metrics_path` defaults to `/metrics`, and you set it when an exporter serves
somewhere else. `scheme` defaults to `http`; set it to `https` and Prometheus
speaks TLS. `params` is a map of URL query parameters appended to every request
for that job — the lab uses it in Chapter 23, "The Multi-Target Pattern:
Probing From Outside", where an exporter is *told what to probe* through the
query string.

`honor_labels` is the one Chapter 2 promised you. By default, when a scraped
sample already carries a label the scrape config also wants to set, Prometheus
keeps its own and renames the application's: your `job` arrives in storage as
`exported_job`. Set `honor_labels: true` and the polarity flips — the scraped
value wins and the target label is discarded. You want that in exactly one
family of situations: when the thing you are scraping is not reporting on
itself but relaying data about *other* things, already labeled correctly —
one Prometheus reading another is the canonical case, and Chapter 26 uses it
there. Everywhere else it lets an application claim to be a different job.

### The six limits

Every one of these can be set globally or per job, every one defaults to `0`,
and `0` means unlimited.

| Limit | Counts | Breached when |
|---|---|---|
| `sample_limit` | samples in one scrape | too many samples |
| `label_limit` | labels on one metric | any metric too wide |
| `label_name_length_limit` | characters in a label name | any name too long |
| `label_value_length_limit` | characters in a label value | any value too long |
| `target_limit` | targets in one job | the job discovered too many |
| `keep_dropped_targets` | dropped targets remembered | nothing fails |

The first five share one property that surprises everybody: they do not trim,
they **fail**. Exceed `sample_limit` by one sample and the entire scrape is
discarded, `up` goes to `0`, and not one of the metrics under the limit is
stored. No partial success, and you will prove it later in the chapter. A
seventh in the same family, `body_size_limit`, caps the response in bytes and
fails the scrape the same way; nothing in this lab comes close to it.

`keep_dropped_targets` is the odd one out and breaks nothing. Discovery can
hand Prometheus thousands of candidates that relabeling throws away, and the
server remembers each one so you can inspect it — which on a large estate is
not free, so this caps how many are kept per job. It costs you visibility,
never data.

## Service discovery is one idea with several sources

Prometheus pulls. To pull, it needs a list of addresses. Everything called
"service discovery" is a way of producing that list, and every one produces the
same shape of thing: a set of **candidate targets**, each carrying a bag of
labels describing where it came from. What happens after that is identical no
matter which source produced the list.

There are three rungs on the ladder, and the lab climbs all of them.

**`static_configs` is the list you type.** Honest, auditable, and it does not
survive anything changing. Its failure mode is in front of you: the `snip-api`
job names `snip-api:8000` and `snip-api-b:8000` by hand, and this chapter's
compose file deletes the second of those hostnames. Left alone, that target
would read `DOWN` forever.

**`file_sd_configs` moves the list out of the config file and onto disk.**
Prometheus watches the named files and re-reads them when their contents
change, with no reload and no restart — and it re-reads them every
`refresh_interval` as well, which defaults to five minutes:

```yaml
  - job_name: catalog
    file_sd_configs:
      - files:
          - /etc/prometheus/targets/*.json
```

The repository ships one such file already, at
`lab/prometheus/targets/extra.json`, which no job reads yet:

```json
[
  {
    "targets": ["catalog:8081"],
    "labels": {
      "env": "lab"
    }
  }
]
```

A list of target groups; each group has addresses and labels that apply to all
of them. Note what is *not* there: no `job` label, because a `file_sd` target
takes `job` from the scrape config that read it. Adding the `file_sd_configs`
block needs one reload; everything after it — adding an address, removing one,
changing a label — needs none, which is why this is the rung a deployment
script can drive. Exercise 3 is you climbing it.

On Docker Desktop it is that poll, not the file watch, that notices your edit:
file-change events do not cross a bind mount from a Windows or macOS host.
Write `refresh_interval: 15s` on the block to make the rung feel immediate.

**`docker_sd_configs` asks the container runtime what is running right now.**
Nobody writes the list at all. That is the rung the rest of this chapter builds,
and it is the one that makes `--scale snip-api=6` a thing you type once.

## Making `--scale` possible

Before Prometheus can discover four Snip containers, four Snip containers have
to be able to exist. Until this chapter they could not, for the reason
Chapter 2 printed in full: Snip published host port 8000, a single resource on
a single machine, and the second container to want it died with
`port is already allocated`.

So the port goes away. In `compose.yaml`, `snip-api` loses its `ports:` block
entirely, `snip-api-b` is deleted, and the service gains three labels that
nothing reads yet:

```yaml
  snip-api:
    build:
      context: ./snip
      target: api
    labels:
      obslab.scrape: "true"
      obslab.metrics_port: "8000"
      obslab.metrics_path: "/metrics"
    networks: [obsnet]
```

Every other service gets the same treatment: `obslab.scrape: "true"` with a
port and a path if it should be scraped, a bare `obslab.scrape: "false"` if it
should not. Writing `"false"` out rather than leaving the label off is
deliberate; rule 1 is where the reason shows.

Then a reverse proxy takes over the front door:

```yaml
  edge:
    image: caddy:2-alpine
    restart: unless-stopped
    volumes:
      - ./edge/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddydata:/data
      - caddyconfig:/config
    ports:
      - "8080:8080"
      - "8443:8443"
    labels:
      obslab.scrape: "false"
    networks: [obsnet]
```

The interesting half of `edge/Caddyfile` is four lines:

```text
:8080 {
  handle /-/healthy {
    respond "OK" 200
  }

  handle {
    reverse_proxy snip-api:8000
  }
}
```

Chapter 2's `snip-api-b` was a second *service name*, so nothing ever sent it
traffic. `snip-api` here is one Docker DNS name that resolves to every replica,
and Caddy re-resolves it each time it opens a new upstream connection — so
under concurrency the work genuinely lands on different replicas. The file also
carries an HTTPS listener on `:8443` that Chapters 23 and 25 wake up. And
`loadgen` now drives `LOADGEN_TARGET_URL: http://edge:8080`.

And Prometheus needs to be able to ask Docker anything at all:

```yaml
  prometheus:
    user: "0:0"
    volumes:
      - ./prometheus:/etc/prometheus:ro
      - ./fixtures:/fixtures:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - promdata:/prometheus
```

Four things are new here and only two are in that excerpt: `user: "0:0"` and
the socket mount. The others are `environment: PROM_REPLICA: a`, which the
external-label expansion above reads, and two flags on `command:` —
`--web.enable-lifecycle` and `--config.auto-reload`, both of which this
chapter comes back to. The `obslab.*` labels arrive too, with every other
service's.

!!! trap "Read access to the Docker socket is root on your host"
    The image's default user cannot read `/var/run/docker.sock`, so the lab
    runs Prometheus as `user: "0:0"`. Be clear about what that buys: anyone
    who can talk to that socket can start a container that mounts your whole
    filesystem, which is root by another name. The `:ro` on the mount limits
    what Prometheus can do through the Docker *API*, not what the socket is
    worth to an attacker. On a real host you put a read-only socket proxy in
    front of it, or you run service discovery somewhere else entirely.

    There is a practical consequence. Running as root writes root-owned files
    into the `promdata` volume, so checking out a tag *earlier* than `ch12` on
    top of it leaves Prometheus unable to write its own query log. It
    restart-loops on an error naming neither the volume nor the cause:

    ```text
    Unable to create mmap-ed active query log
    ```

    `make reset && git checkout ch05 && make up`, all three commands in that
    order, is the way to visit an earlier chapter safely.

## The labels you cannot see

Every target that arrives from service discovery carries a label set that never
reaches storage. Names in that set begin and end with a double underscore, and
they are instructions rather than data: they tell the scrape loop what to do,
and then they are thrown away.

Six matter here.

- `__address__` — the `host:port` Prometheus will connect to. This is the only
  one that must survive; a target without it is an error.
- `__scheme__` and `__metrics_path__` — the other two thirds of the URL,
  defaulted from `scheme` and `metrics_path`.
- `__param_<name>` — one per entry in `params`, and writable, which is how
  Chapter 23 makes one exporter probe many things.
- `__meta_*` — everything the discovery mechanism knows. This is the bag.
- `__tmp_*` — reserved for you. Prometheus promises never to define one, so
  it is safe scratch space for a value one rule computes and a later rule
  consumes.

Scale up first, so there is something to look at:

```bash
make scale N=4
```

Then open `http://localhost:9090/service-discovery`. Each job is listed with a
count of the form `4 / 22` — targets kept, out of candidates discovered — and
under it a two-column table: the discovered labels on the left, the target
labels relabeling produced on the right. Here is what Docker discovery reports
about one Snip container, trimmed to the lines that matter:

```text
__address__                    172.19.0.9:8000
__meta_docker_container_id     9b8caf54d469...
__meta_docker_container_name   /obslab-snip-api-1
__meta_docker_network_ip       172.19.0.9
__meta_docker_port_private     8000
__meta_docker_container_label_com_docker_compose_service
                               snip-api
__meta_docker_container_label_com_docker_compose_container_number
                               1
__meta_docker_container_label_obslab_scrape        true
__meta_docker_container_label_obslab_metrics_port  8000
__meta_docker_container_label_obslab_metrics_path  /metrics
__metrics_path__               /metrics
__scheme__                     http
```

Three things to notice. First, the labels you set in `compose.yaml` come back
with every character that is not a letter, digit or underscore replaced by an
underscore: `obslab.scrape` becomes `..._obslab_scrape`, and Compose's own
`com.docker.compose.service` becomes `..._com_docker_compose_service`.

Second, `__address__` already has a port on it, taken from the container's
port — and it is not a default. Prometheus 3 never appends `:80` or `:443` to a
target based on the scheme. A target appears in `__address__`, and so in
`instance`, exactly as configured or discovered. What it does *not* do is
write the port in for you: give Prometheus `snip-api` with no port and
`instance` reads `snip-api`, while the HTTP client dials port 80 anyway —
`dial tcp 172.19.0.7:80: connect: connection refused`. The port is gone from
the label, not from the connection. The one place a port
appears from nowhere is Docker discovery's own fallback: a container exposing
no port at all gets the container's address and `:80`, which is a setting on
`docker_sd_configs`, not a scheme default.

Third, and this explains a count you are about to see: Docker reports **one
candidate per port mapping**, not one per container. On the machine this was
written on, every container publishing a host port published it on IPv4 and
IPv6, so each arrived as two candidates differing in one label,
`__meta_docker_port_public_ip` — `0.0.0.0` on one, `::` on the other.
Twenty-two candidates; twelve containers. It stops mattering once relabeling
has finished: two targets with identical label sets are one target.

## Relabeling, precisely

`relabel_configs` is a list of rules applied, in order, to that label set. Rule
two sees what rule one produced. No branching, no loop, so the same input
always gives the same output and you can reason about it on paper.

One rule has six fields, and all but `target_label` come with a default:

```yaml
- source_labels: [a, b]     # read these, in this order
  separator: ";"            # join their values with this
  regex: "(.*)"             # match the joined string against this
  target_label: c           # write here
  replacement: "$1"         # write this, with $N capture groups
  action: replace           # what to do
```

The order in that comment is the algorithm. The values of `source_labels` are
looked up — a label that does not exist contributes an empty string — and
**joined with `separator` before the regex ever runs**. The regex is matched
against that single joined string, not against each label separately. Almost
every relabeling bug is a failure to picture the joined string.

Two properties of the regex will bite you if nobody says them out loud. It is
**fully anchored**: `regex: snip` behaves as `^snip$`, so it matches neither
`snip-api` nor `snip-worker`. And in Prometheus 3, `.` matches newlines. Break a
regex on purpose and the server tells you both:

```text
error parsing regexp: missing closing ): `^(?s:([0-9]+)$`
```

Prometheus wrapped your `([0-9]+` in `^(?s:` and `)$` before compiling it. The
`^`/`$` is the anchoring; the `s` flag is what makes `.` match a newline.

The defaults are what make short rules readable. `action: replace` with
`regex: "(.*)"` and `replacement: "$1"` means "copy this label to that one", so
a copy rule is two lines. Leave `source_labels` out and there is nothing to
match, `regex` matches the empty string, and `replacement` is written
literally — which is how you set a constant.

Four actions carry this chapter.

**`replace`** matches the joined string and, if it matches, writes
`replacement` — with `$1`, `$2` substituted — into `target_label`. If the regex
does *not* match, the rule does nothing at all. That silence is a feature, and
the lab leans on it. Writing the empty string to a label deletes it.

**`keep`** discards the target unless the regex matches. **`drop`** discards it
if the regex matches. Neither writes anything.

**`labelmap`** is the odd one: it ignores `source_labels` and instead matches
the regex against every *label name* present, copying the value of each match
into a new label whose name comes from `replacement` (default `$1`). It is a
bulk operation, and bulk operations need tight regexes.

The rest you will meet by name. `labeldrop` and `labelkeep` filter labels
wholesale by name — Chapter 24, "Cardinality: Detonate, Diagnose, Defuse",
keeps a disarmed `labeldrop` in this very file as an emergency brake.
`keepequal` and `dropequal` compare the joined source value against
`target_label` instead of a regex. `lowercase` and `uppercase` do what they
say. And `hashmod` writes `MD5(joined) mod N` into a label, so N servers can
each `keep` one slice of the same target list — horizontal sharding, for
target counts this book never reaches.

## Building the job, one rule at a time

The job you checked out already has all seven of its rules. Do not read the
finished block and nod: take it apart and put it back a rule at a time, and
look at the damage each one repairs. Replace the `snip-api` job in
`lab/prometheus/prometheus.yml` with the smallest possible discovery config —
no relabeling at all:

```yaml
  - job_name: snip-api
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        refresh_interval: 15s
```

Apply it with `make reload`, new in this chapter: it posts to `/-/reload`,
which `compose.yaml` opened by adding `--web.enable-lifecycle` to Prometheus's
command line. Until now an edit to this file meant
`docker compose restart prometheus`. Wait fifteen seconds and open
`http://localhost:9090/targets`. That one job produced thirteen targets on the
machine this was written on, trimmed here to the endpoint, the state and the
error text:

```text
172.19.0.9:8000    UP
172.19.0.15:8000   UP
172.19.0.16:8000   UP
172.19.0.17:8000   UP
172.19.0.10:8090   UP
172.19.0.12:8089   UP
172.19.0.6:8081    UP
172.19.0.4:9090    UP
172.19.0.8:3000    UP
172.19.0.11:8080   UP
172.19.0.11:8443   DOWN   server returned HTTP status 400 Bad Request
172.19.0.5:6379    DOWN   Get "http://172.19.0.5:6379/metrics": EOF
172.19.0.3:5432    DOWN   Get "http://172.19.0.3:5432/metrics": EOF
```

Thirteen targets out of twenty-two candidates, and no rule has run yet: the
duplicate candidates relabeled to identical label sets and collapsed on their
own. Your list will differ, and not only in the addresses — Docker discovery
reports every container the daemon knows about, not only this project's.

Read what went wrong, though. Postgres and Valkey are being asked for
`/metrics` over HTTP and answer in their own binary protocols, hence `EOF`.
Grafana answers, and does have a `/metrics` page, and is not something a job
called `snip-api` should own. `edge` appears twice, once per published port:
its plaintext port reads `UP`, because a request to the proxy is forwarded
straight to Snip, so one Snip container is scraped twice under two identities;
its TLS port answers `400`, because Prometheus spoke HTTP to an HTTPS
listener.

Everything else is filtering.

### Rule 1: nothing is scraped without opting in

The fragments that follow are the job's `relabel_configs:` entries in file
order, printed at their own indentation rather than the file's. Add them one
at a time.

```yaml
- source_labels: [__meta_docker_container_label_obslab_scrape]
  regex: "true"
  action: keep
```

This is the rule those Compose labels were for. Nothing is scraped unless it
opts in, and writing `obslab.scrape: "false"` out in full on the services that
do not — Postgres, Valkey, Grafana, `edge` — keeps the filter visible in the
file it filters on. Delete the label instead and you get the same result with
no way to tell it from an oversight.

Thirteen targets become eight — four Snip replicas, the worker, the load
generator, `catalog` and Prometheus itself. Everything answering in the wrong
protocol, or on behalf of something else, is gone.

### Rule 2: one job, one service

Eight is better than thirteen and still wrong: this job is called `snip-api`
and four of those eight are not `snip-api`. The second rule pins it:

```yaml
- source_labels:
    - __meta_docker_container_label_com_docker_compose_service
  regex: snip-api
  action: keep
```

Four targets. This is the rule that differs between jobs — the only line you
change when you copy the block for `loadgen` or `catalog` — and where the
anchoring first bites. `regex: snip-api` compiles as `^snip-api$`. Write
`regex: snip` instead, expecting a prefix match, and the job goes to zero
targets: nothing is called exactly `snip`.

### Rule 3: say which port

```yaml
- source_labels:
    - __meta_docker_network_ip
    - __meta_docker_container_label_obslab_metrics_port
  separator: ":"
  regex: (.+):(.+)
  replacement: $1:$2
  target_label: __address__
```

Picture the joined string: `172.19.0.9` and `8000` joined by `:` gives
`172.19.0.9:8000`, the regex captures the two halves, the replacement puts them
back. Written out like that it looks like an elaborate way to change nothing,
and on this container it is. The work is in the two failure cases.

If a container names no `obslab.metrics_port`, the joined string ends in a
colon, `(.+):(.+)` does not match, and — because a `replace` whose regex misses
does nothing — the address discovery already produced stands untouched. A
built-in guard, and no way to write an address with an empty port.

And if a container publishes several ports, this rule forces every candidate
from it onto the port you named. They then produce identical label sets and
Prometheus keeps one. Chapter 17, "Alertmanager: Routing, Grouping and
Silence", adds a service publishing two ports, one of which does not speak HTTP
at all — without this rule it would arrive as two targets, one permanently
down.

### Rule 4: say which path

```yaml
- source_labels:
    - __meta_docker_container_label_obslab_metrics_path
  regex: (.+)
  target_label: __metrics_path__
```

This is to the path what rule 3 was to the port, with the same guard: `(.+)`
cannot match an absent label, so a container naming no path keeps `/metrics`.
Nothing in this lab serves anywhere else yet; the rule is here so that the day
one does, the job already knows how to ask.

### Rule 5: a name a human can page on

```yaml
- source_labels:
    - __meta_docker_container_label_com_docker_compose_service
    - __meta_docker_container_label_com_docker_compose_container_number
  separator: "-"
  target_label: instance
```

No `regex`, no `replacement`, no `action` — all three defaults do the right
thing. `snip-api` and `3`, joined with a hyphen, matched by `(.*)`, written as
`$1`. This single rule is most of why the chapter exists. `instance` now reads
`snip-api-3`, and the page at 03:14 says something you can act on.

Prometheus derives `instance` from `__address__` only when nothing else has
set it, so writing it here wins.

!!! note "The numbers are Compose's, not yours"
    Scale down and Compose removes the highest numbers, so four replicas
    reduced to two leave `snip-api-1` and `snip-api-2`. But the numbers are
    not a contract: remove one container by hand and scale back up and
    Compose takes the next number above the highest, so four replicas can
    read `-1`, `-3`, `-4`, `-5`. The label is stable for the life of a
    container, which is what a graph legend needs. Do not read the number as
    a shard or a rank.

### Rules 6 and 7: the finishing touches

```yaml
- source_labels: [__meta_docker_container_label_obslab_job]
  regex: (.+)
  target_label: job
- target_label: env
  replacement: lab
```

The first lets a container overrule the job name it would otherwise get.
Nothing in this book ever does: the one exporter that might want to,
`redis-exporter` in Chapter 23, ends up on a hand-written target list instead.
The rule is here because it costs one no-op, and it is the hook you reach for
the first time a container has to name its own job. The second is the constant
form: no `source_labels`, so `replacement` is written literally. That is where
`env="lab"` comes from, now that the `static_configs` block that used to carry
it is gone.

That is the whole pattern: seven rules, of which exactly one — the service name
in rule 2 — differs between jobs, which is exactly what the file you checked
out already does. `loadgen`, `catalog`, `snip-worker` and `prometheus` each
carry the same seven, differing in that one string. Read the seven rules once,
here; skim them everywhere else.

### What `labelmap` does when you are careless

Add this as an eighth rule and reload:

```yaml
- regex: __meta_docker_container_label_obslab_(.+)
  action: labelmap
```

```text
up{env="lab", instance="snip-api-1", job="snip-api",
   metrics_path="/metrics", metrics_port="8000", scrape="true"}
```

Three new labels on every series from every target in this job, forever, none
of which any query will ever ask about. `labelmap` matched three label *names*,
captured the tail of each, and wrote each captured name as a new label carrying
the old value. It did not ask whether the result was useful — and it does not
ask whether the result collides, either. The captured name becomes the new label
name, so a container label named `obslab.job` would produce a label called `job`
and overwrite the job name, silently, from a rule that never mentions `job`.
Take the rule back out.

`labelmap` is a firehose aimed by a regex. It is the right tool when a platform
hands you a whole namespace you want wholesale — the commonest one in
production is `__meta_kubernetes_pod_label_(.+)` — and aimed looser it costs
you cardinality you did not choose. Chapter 7, "Labels, and the Cardinality
Arithmetic You Must Do First", applies: every label multiplies.

!!! trap "The label name that silently matches nothing"
    Docker's label keys contain dots. The meta labels do not. Write the keep
    rule as `__meta_docker_container_label_obslab.scrape` and nothing
    complains: dots are legal in a label name in v3, so the config parses,
    `promtool` reports `SUCCESS`, and the reload succeeds. The label never
    exists, the joined string is empty, `regex: "true"` does not match it,
    and every candidate is dropped. What you see is a job on `/targets` with
    no targets under it at all, and the Service Discovery page counting it as

    ```text
    0 / 22
    ```

    Rung 1 of the debugging ladder — the target is not in `/targets` at
    all — and the Service Discovery page is where rung 1 gets answered
    whenever discovery is involved.

!!! sidebar "One job per service, or one job for everything?"
    The lab writes one `scrape_config` per Compose service, each with the
    rule-2 `keep`, so `job` comes from `job_name`. The other design deletes
    rule 2 and writes `job` with a `replace` from
    `__meta_docker_container_label_com_docker_compose_service` instead: one
    scrape config, one `job` value per service, the same targets. You will
    meet it in the wild.

    The lab does not use it because `sample_limit` and
    `metric_relabel_configs` are properties of a scrape config and cannot
    vary within one — and `snip-api` needs a sample limit `catalog` must not
    have. (`scrape_interval` is the exception: a relabel rule *can* write
    `__scrape_interval__`, and `__scrape_timeout__`, per target. A limit and
    a metric-relabel block cannot be.) The repetition is bought deliberately.

## Reloading, and being told no

Prometheus re-reads its configuration without restarting and without losing a
single stored sample. The lab's `prometheus` service carries both mechanisms:

```yaml
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.path=/prometheus
      - --web.enable-lifecycle
      - --config.auto-reload
```

`--web.enable-lifecycle` opens `POST /-/reload`, which `make reload` wraps.
`--config.auto-reload` makes the server watch the file itself and reload when
its contents change; it checks every `--config.auto-reload-interval`, which
defaults to 30 seconds. It has been **stable since Prometheus 3.12**, and it
replaced a feature flag called `auto-reload-config` that is deprecated but
still accepted: pass it to 3.13.1 and the server logs `This option for
--enable-feature is deprecated. Use --config.auto-reload instead.` and then
enables the feature anyway. A blog post that turns it on with
`--enable-feature` still works; it is only older than it looks, and the flag
will go — unlike the flags v3 removed outright, which warn and do nothing.

Now break the file on purpose — the unclosed capture group that produced the
regex error will do — and reload:

```console
$ make reload
failed to reload config: couldn't load configuration
(--config.file="/etc/prometheus/prometheus.yml"): parsing YAML file
/etc/prometheus/prometheus.yml: error parsing regexp: missing closing
): `^(?s:([0-9]+)$`
curl: (22) The requested URL returned error: 500
make: *** [reload] Error 22
```

That is HTTP 500, and `make reload` fails with it rather than printing
`reloaded` over the top. The server log carries the same text:

```text
level=ERROR msg="Error reloading config"
```

The important part is what did *not* happen: the old configuration is still
running, every target is still being scraped, nothing was lost. A rejected
reload is a no-op — worth knowing before you first edit this file at 03:14.

You can find the error before the server does:

```bash
make check
```

Among other things, `make check` runs the config through `promtool`, which
ships inside the Prometheus image and so needs nothing installed. With that
plumbing removed:

```console
$ promtool check config --lint=all \
    /etc/prometheus/prometheus.yml
Checking /etc/prometheus/prometheus.yml
 SUCCESS: /etc/prometheus/prometheus.yml is valid prometheus config
 file syntax
```

A syntax error prints `FAILED` and exits `1`. `--lint=all` adds findings for
things that parse and are still probably wrong — point it at a scratch
`slow.yml` with a five-minute scrape interval on one job:

```text
 SUCCESS: /etc/prometheus/slow.yml is valid prometheus config file
 syntax

  FAILED: too long scrape interval found, data point will be marked
  as stale - job: slow, interval: 5m
```

Note that it says both, and note the exit code: that run still exits `0`.
Lint findings are advisory unless you add `--lint-fatal`, which turns them
into exit code `3`. In CI you want `--lint-fatal`.

A second subcommand earns its keep once you use discovery.
`promtool check service-discovery <config-file> <job>` runs discovery for one
job and prints every candidate with its `__meta_*` labels and the final label
set relabeling produced. A dropped candidate shows an empty final set:

```text
"labels": {}
```

That is the fastest answer to "why is my target not there", and it needs no
running server.

## The payoff

You have been taking apart a job the repository ships finished, and left a
broken regex in it. Put the file back in one move:

```bash
git checkout -- prometheus/prometheus.yml
make reload
```

That undoes the breakage and brings back two things the dismantling threw away
with the `snip-api` job: the `metric_relabel_configs` block this chapter comes
back to in a moment, and a commented-out `labeldrop` for Chapter 24.

You are still at four replicas, and now Prometheus knows about all four:

```promql
count(up{job="snip-api"} == 1)
```

```text
{} 4
```

Open `http://localhost:9090/targets` and leave it on screen. Then scale down:

```bash
make scale N=2
```

Within one `refresh_interval` — fifteen seconds, because the lab pins it;
leave it unset and you inherit the source's own longer default — two rows
vanish. Now scale up past where you started:

```bash
make scale N=6
```

Four rows appear, named `snip-api-3` through `snip-api-6` and scraped on their
first refresh. You edited no configuration and reloaded nothing. The file
describes a *rule for what to scrape*, and the answer changes underneath it.
Put it back to four — `make scale N=4` — before the self-check.

!!! selfcheck "Self-check"
    Run `make verify-ch12`. It takes about two minutes: it scales `snip-api`
    to four, asserts `count(up{job="snip-api"} == 1) == 4`, asserts that no
    `instance` value matches an IP-address pattern, asserts `env="lab"` is
    present and `cluster` is not, checks that host port 8000 is refused and
    that `edge` answers on 8080, checks the metric drops later in this
    chapter, and then scales back. It must print `ch12 OK`. If the line about
    scaling back to two arrives *after* that, which looks odd, it is only the
    script's teardown trap running last.

That teardown leaves you at two replicas. Run `make scale N=4` again before
you read on: the counts that follow are per target, and assume four.

One consequence changes something Chapter 2 taught you. A `static_configs`
target that stops answering stays a target: Prometheus keeps scraping an address
nobody is listening on, and `up` reads `0` forever. A discovered target that
stops *existing* is withdrawn — Docker no longer lists the container, so the
target and its `up` series go with it. Scale to zero and there is
no `up == 0` to alert on, because there is no `up` at all. That is why "is it
down" and "is it missing" are two different alerts, and Chapter 16 writes both.

## Three places to relabel, and what each can see

Relabeling appears in three positions in a Prometheus config, doing the same
transformation over three different label sets at three different moments.

| Block | Runs | Operates on |
|---|---|---|
| `relabel_configs` | before the scrape | one target's labels |
| `metric_relabel_configs` | after the scrape | every scraped sample |
| `write_relabel_configs` | before remote write | every outgoing sample |

`relabel_configs` shapes the **target list**. It sees `__meta_*`, `__address__`
and the rest of the invisible set; it has never seen a metric, because nothing
has been fetched yet. Dropping a target here means never making the request.

`metric_relabel_configs` shapes **what gets stored**. It runs once per sample
after the response is parsed, and sees `__name__` and the sample's own labels.
It has never heard of `__meta_docker_container_label_obslab_scrape`: those
labels were consumed and discarded before the request went out.
Dropping here still costs you the scrape: you pay for the bytes and throw them
away, which is the correct trade when the alternative is storing them forever.

The lab's first one came back with the file you restored, on the `snip-api`
job:

```yaml
metric_relabel_configs:
  - source_labels: [__name__]
    regex: go_memstats_.*
    action: drop
```

Snip's `/metrics` carries 35 samples whose names begin `go_`, and 22 of those
are `go_memstats_*` — a Go runtime accounting family nobody in this book ever
queries. Dropping them costs the application nothing and needs no deploy. Count
both sides yourself. On the wire, through `edge`, which answers from whichever
replica it picks:

```bash
curl -s http://localhost:8080/metrics | grep -c '^go_'
```

```text
35
```

In the database — grouped by target, because `curl` asked one replica and
`count()` on its own would answer for all four at once:

```promql
count by (instance) ({job="snip-api", __name__=~"go_.*"})
```

```text
{instance="snip-api-1"} 13
{instance="snip-api-2"} 13
{instance="snip-api-3"} 13
{instance="snip-api-4"} 13
```

Thirty-five minus twenty-two is thirteen, and `curl` and the Query page now
legitimately disagree about what exists — exactly the caveat Chapter 2 printed
and said would come true here. Check that you dropped a family and not a
runtime:

```promql
go_goroutines{job="snip-api"}
```

Still there, one row per replica. `snip-worker` gets the same rule, and the
Python equivalent goes on `catalog`:

```yaml
metric_relabel_configs:
  - source_labels: [__name__]
    regex: python_gc_.*
    action: drop
```

Nine samples a scrape, on a service that produces thousands. Put it in anyway,
so that "which runtime noise am I paying for" has a visible answer in the file
for both languages in the stack. `loadgen` keeps its whole `go_*` family on
purpose — one service in the lab has to, and Exercise 2 is why.

`write_relabel_configs` shapes **what leaves the building** — the same
per-sample transformation, on the way out to a queue that copies samples
elsewhere. That mechanism is Chapter 26's subject; what matters here is that it
is a third position, not a third dialect.

A fourth thing in this file looks like relabeling and is not armed: the
commented-out `labeldrop` under the `snip-api` job. That is Chapter 24's
emergency brake, and the note above it explains why it ships disarmed.

## The limits, in anger

Set a limit you know will break, on one job:

```yaml
  - job_name: snip-api
    sample_limit: 50
```

`make reload`, wait one scrape interval, and look at `/targets`:

```text
snip-api   snip-api-1   DOWN   sample limit exceeded
snip-api   snip-api-2   DOWN   sample limit exceeded
snip-api   snip-api-3   DOWN   sample limit exceeded
snip-api   snip-api-4   DOWN   sample limit exceeded
```

Then ask what survived:

```promql
{job="snip-api", __name__=~"snip_.*"}
```

```text
Empty query result
```

Not the first fifty samples. Not the ones with short names. Nothing. Snip is
running perfectly, answering every request, and its entire metric surface has
vanished from the database. The only series left for those targets are the five
bookkeeping ones Prometheus writes about every scrape of its own accord, `up`
among them, now reading `0`. Chapter 24 puts the other four to work.

The other limits fail the same way and are more forthcoming about why. A
breached `label_limit` names the first metric it found too wide, how many labels
it had, and the limit — useful, because it tells you which family to look at. A
breached `target_limit` names the counts:

```text
target_limit exceeded (number of targets: 4, limit: 2)
```

`target_limit` is the harshest of the six: its breach is collective. Every
target in the job goes down, including the ones that were fine before the extra
one appeared. A job that worked quietly at three replicas fails completely at
four, and nothing about the failure points at the replica that arrived.

One ordering fact is worth knowing rather than guessing: `sample_limit` counts
samples **after** `metric_relabel_configs` has run. That is the useful order. A
`drop` rule taking a noisy target from three hundred samples to forty brings it
back under a limit of fifty, with no change to the target at all.

Take the limit back out before you continue. Chapter 24 puts `sample_limit` and
`label_limit` on this job for good, once you have enough series for those
numbers to mean something.

## The mechanisms this lab does not use

Discovery integrations differ in where the list comes from and in what
`__meta_*` labels they attach; the relabeling you just learned is identical for
all of them. These are the ones you are most likely to meet, and the first is
the subject of Chapter 27, "Optional: What Changes on Kubernetes":

| Mechanism | Asks | Where you meet it |
|---|---|---|
| `kubernetes_sd_configs` | the API server | Chapter 27 |
| `dns_sd_configs` | SRV or A records | small on-prem setups |
| `consul_sd_configs` | a Consul catalog | service-mesh estates |
| `ec2_sd_configs` | the AWS API | one per cloud provider |
| `http_sd_configs` | any URL you write | your own inventory |
| `dockerswarm_sd_configs` | a Swarm manager | Swarm clusters |

`http_sd_configs` is the escape hatch: it fetches JSON from a URL you control,
in the same shape `file_sd_configs` reads from disk. If your inventory lives in
a database nobody has written an integration for, that is a forty-line web
service and you are done.

One detail from Prometheus's own stability document is worth carrying, because
it decides upgrade risk. Of all the discovery mechanisms, exactly three are
covered by the 3.x stability guarantee: `static_configs`, `file_sd_configs` and
`http_sd_configs`. Every other integration — including the `docker_sd_configs`
this chapter is built on — may change between minor releases, and the `__meta_*`
names are the part that would move. Read the release notes before a minor
upgrade if a discovery mechanism is load-bearing for you; that is the whole of
the precaution.

## Common mistakes

**Assuming `global` overrides the jobs.** It is the other way around. When
`scrape_interval` is `15s` globally and `60s` in a job, that job scrapes every
sixty seconds. Nothing warns you; the graph has fewer points than you
expected and says nothing about why. Check `/config`, which shows the
configuration the server actually loaded — with every default filled in —
rather than what you meant to write. The same text is at
`/api/v1/status/config` if you would rather diff it.

**Expecting a partially-successful scrape.** Every limit except
`keep_dropped_targets` fails the whole thing. Set `sample_limit` "just to be
safe" on a job you have not measured and you have built a tripwire that turns
slow cardinality growth into a total outage of that target's data — at the
moment you most want to see it.

**Writing a relabel regex that is not anchored the way you think.**
`regex: snip` does not match `snip-api`; the anchors are added for you. If you
want a prefix match, write `snip.*`. It catches people twice because relabel
regexes *look* like free-text matching.

!!! pitfall "Relabeling in the wrong block"
    Putting a rule that reads `__meta_*` into `metric_relabel_configs` is the
    single most common relabeling error, and it is silent. Those labels do
    not exist at that point in the pipeline: the joined source string is
    empty, so a `keep` keeps nothing and every sample from the target is
    discarded, while a `drop` drops nothing and you conclude the rule does
    not work. The tell is a target that reads `UP` on `/targets`, with a
    healthy last-scrape time, whose metrics are entirely absent from the
    Query page. `up` itself is unaffected, because Prometheus writes it after
    metric relabeling.

**Forgetting that discovery sees the whole daemon.** `docker_sd_configs` lists
every container Docker knows about, not the ones in your Compose project. A job
with no `keep` rule will happily scrape a colleague's container. The `keep` is
not tidiness; it is the definition of the job.

**Confusing a reload with a refresh.** A reload rebuilds every discovery
provider and each one refreshes at once, so a job you have just added produces
targets within a second or two whatever its `refresh_interval` says — you
still wait one `scrape_interval` for the first sample. It is a container that
starts *later*, under a config already running, that waits up to one
`refresh_interval` to be discovered and another `scrape_interval` after that.
Fifteen plus fifteen is not a bug there; thirty seconds after a reload is.

## Summary

A Prometheus configuration is a set of *rules for what to scrape*, and until
this chapter you had been using it as a list. The difference shows up the moment
anything changes: a list must be edited, a rule does not.

Service discovery produces candidate targets carrying `__meta_*` labels
describing where they came from. Relabeling is a deterministic, ordered
transformation over that label set doing three jobs at once: it decides which
candidates survive, builds the URL to fetch, and writes the target labels every
future query will filter on. `instance` reads `snip-api-3` instead of
`172.19.0.7:8000` because of one five-line rule, and `--scale snip-api=6` needs
no config edit because no address was ever written down.

What to carry forward:

- `global` sets defaults for the keys a job can also set, and there the more
  specific setting wins. The server-wide keys — `evaluation_interval`,
  `external_labels` — have no per-job form at all. External labels are
  stamped on data leaving the server and are invisible to every local query.
- Six scrape limits, all defaulting to `0` meaning unlimited, and five of the
  six fail the entire scrape rather than trimming it.
- Relabeling reads `source_labels`, joins them with `separator`, matches the
  joined string against a fully anchored `regex`, and writes `replacement`
  into `target_label`. A `replace` whose regex misses does nothing, and that
  silence is how you write a rule with a built-in guard.
- Four actions do the work: `replace`, `keep`, `drop`, `labelmap`. `hashmod`
  exists for sharding and you do not need it.
- Three positions: `relabel_configs` sees targets before the scrape,
  `metric_relabel_configs` sees samples after it, and `write_relabel_configs`
  sees samples on the way out under `remote_write:`. Same syntax, different
  visibility.
- `POST /-/reload` needs `--web.enable-lifecycle`; `--config.auto-reload` has
  been stable since 3.12 and checks every 30 seconds by default. A rejected
  reload changes nothing.
- `promtool check config --lint=all` finds it before the server does, and
  `promtool check service-discovery` answers "why is my target missing"
  without a running server.

## Exercises

!!! exercise
    **1. A label from nowhere (warm-up).** Add `tier="frontend"` to every
    `snip-api` target using one relabel rule, without touching Snip's source
    or its container labels. Reload, wait a scrape, and confirm that
    `up{job="snip-api", tier="frontend"}` returns one row per replica and
    that `snip_http_requests_total{tier="frontend"}` returns rows too. Then
    take the rule out again.

    **2. Drop the Go runtime from `loadgen` (warm-up).** Record
    `count({job="loadgen"})` and `count({job="loadgen", __name__=~"go_.*"})`
    first; the second reads 35. Add a `metric_relabel_configs` rule to the
    `loadgen` job that drops every `go_*` metric, reload, wait two scrapes,
    and confirm the first number has fallen by the second. Then take the rule
    out: the repository keeps one service's runtime metrics on purpose.

    **3. Move a job to `file_sd_configs`, twice (core).** Replace the
    `catalog` job's `docker_sd_configs` and its seven relabel rules with a
    `file_sd_configs` block pointing at `/etc/prometheus/targets/*.json`. The
    repository already ships `lab/prometheus/targets/extra.json`, holding one
    target group for `catalog:8081` with `env: lab` on it. Put
    `refresh_interval: 15s` on the block. That config change needs one
    reload; after it, edits to the JSON file need no reload — but give the
    poll up to one `refresh_interval` to notice them. Confirm `catalog` reads
    `UP`, and note what `instance` says now that no rule is writing it.

    Then add a second JSON file naming an address with no container behind
    it — and *do not* start anything. What appears on `/targets`, what does
    `up` read for it, and which rung of the debugging ladder names that
    state? Compare that with what happens when a *discovered* container
    disappears.

    **4. Put the rule in the wrong block (core).** Take the `keep` rule on
    `__meta_docker_container_label_obslab_scrape` out of `relabel_configs`
    and put it, unchanged, into `metric_relabel_configs` on the `snip-api`
    job. Write down what you expect before reloading. Then reload and check
    three things: what `/targets` says, what `up{job="snip-api"}` reads, and
    what `snip_http_requests_total{job="snip-api"}` returns. Explain why the
    first two disagree with the third.

    **5. A limit that fires on the fourth replica (core).** `make scale N=2`
    first — the chapter left you at four. Set `target_limit: 2` on the
    `snip-api` job, reload, and confirm both targets are `UP`. Now
    `make scale N=4`. Predict, before you look: how many of the four targets
    go down? Check `/targets` and read the error text.

    **6. Time the auto-reload (stretch).** `--config.auto-reload` is already
    on. Make a trivial change to `prometheus.yml`, note the wall-clock time
    you saved the file, and watch the Prometheus log for
    `msg="Loading configuration file"`. Do it three times. Explain the spread
    you see, say what the worst case is, and say which of the two reload
    mechanisms you would rather rely on in a deployment pipeline. Then break
    the file, and confirm from the log that the server keeps serving the last
    good configuration.
