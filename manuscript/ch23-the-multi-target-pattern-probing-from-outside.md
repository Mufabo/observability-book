# Chapter 23 — The Multi-Target Pattern: Probing From Outside

Every number in this book so far has come from inside the fence. Snip counts its
own requests. `node-exporter` reads the kernel's own counters. `cadvisor` reads
the cgroup's own accounting. `postgres-exporter` asks Postgres about Postgres.
All of it is the system's opinion of itself, and all of it arrives over a
network path Prometheus has already proven works, because the scrape succeeded.

There is one question none of it can answer. Can anybody actually reach you?

A DNS record still points at a load balancer you decommissioned last quarter.
The certificate on the front door expired at 02:00. A proxy in front of your
service is answering `502` to everybody while your service, behind it, serves
`200` to the only client left that can reach it — Prometheus. In all three cases
every panel is green, every replica is `up`, the error ratio is zero, and the
service is down. The dashboards are not lying. They are describing the inside of
a building nobody can get into.

The fix is to measure from outside, and the tool is `blackbox_exporter`. But the
tool is not the lesson. The lesson is a *calling convention*: some exporters are
not sources of data at all, they are functions you call with a parameter, and
relabeling is how you pass the argument. Once you can see that shape you can
write a scrape job for an exporter whose documentation you have never read.

!!! objectives "Objectives"
    After this chapter you can:

    - Explain the `__address__` → `__param_target` → `instance` → `__address__`
      maneuver line by line, and say what `__address__` holds at each step.
    - Write a multi-target scrape job from the model rather than by copying one.
    - Say what black-box probing tells you that instrumentation cannot, and what
      it cannot tell you that instrumentation can.
    - Diagnose the most common Docker probe failure in one setting change.
    - Alert on probe failure and on certificate expiry.
    - Recognize the same pattern in an exporter you have never seen.

## Where the lab is

This runs against the stack as Chapter 22, "Metrics From Things You Didn't
Write", left it: Snip behind `edge`, plus `node-exporter`, `cadvisor` and
`postgres-exporter`.

```bash
cd lab
git checkout ch23
make check
make up
make ps
```

The `ch23` tag holds finished versions of everything this chapter adds — two
services, two scrape jobs, `blackbox/config.yml` and two alerts — to read
alongside the text. To build them by hand, and to meet the failure the first
probe produces, check out `ch22` and follow along from there.

Prometheus is on `http://localhost:9090/`, Snip on `http://localhost:8080/`,
Grafana on `http://localhost:3000/`, and the load generator's control API on
`http://localhost:8089/`. Put the injector into a known state so nothing else
moves while you work:

```bash
curl -s -XPOST http://localhost:8089/control \
  -d '{"rps":20,"route":"mix","error_ratio":0}'
```

Two things from earlier chapters are load-bearing here. `edge` has been serving
HTTPS on `:8443` from Caddy's own internal certificate authority since Chapter
12 — an offline TLS listener, which is the only reason a certificate-expiry
alert is possible on a laptop with the network unplugged. And `valkey` has been
running since Chapter 1 as Snip's cache, unmonitored, waiting for this chapter.

!!! jargon "Black-box monitoring"
    Measuring a system the way a stranger would: from outside, over the real
    network, through whatever sits in front of it, with no access to its
    internals. The opposite is white-box monitoring — everything else in this
    book — where the system reports on itself. Black-box tells you *that* it is
    broken from where a user stands. White-box tells you *what* is broken. You
    need both, and neither substitutes for the other.

## The exporter is a function

Chapter 22 sorted the ways a number gets into Prometheus into three and left
the third one open. This chapter is that third category: *IOU from chapter 22,
settled.* `node-exporter` is the second. It runs next to the thing it
describes, it reads that one thing, and it publishes it at `/metrics`. One
exporter, one subject, forever.

`blackbox_exporter` does not work that way, and it cannot. It has no subject of
its own. Ask it for `/metrics` and it will tell you about itself — its own Go
runtime, its own config reloads — which is nothing you want. What you want is
for it to go and check something, and *which* something changes with every
request.

So it serves a different endpoint:

```bash
curl -sG http://localhost:9115/probe \
  --data-urlencode 'module=http_2xx' \
  --data-urlencode 'target=http://edge:8080/healthz'
```

`-G` puts those two values on the query string, so what leaves your laptop is
`GET /probe?module=http_2xx&target=http%3A%2F%2Fedge…`. Both the quoting and the
encoding matter, which is why the long form is worth typing once.

Read that as a function call. `probe` is the name, `module` and `target` are the
arguments — `target` is the thing to check, `module` names a block of probe
settings in the exporter's own config — and the return value is an
exposition-format body, the same format
Chapter 2, "What's Actually on the Wire", took apart, produced fresh, on demand,
describing a network transaction that happened while you waited.

Nothing in Prometheus knows how to call a function. Prometheus knows how to
scrape a URL. The whole of the multi-target pattern is the trick that makes one
look like the other, and the trick is relabeling.

## The maneuver, line by line

Chapter 12, "`prometheus.yml` in Full: Service Discovery and Relabeling",
introduced the label namespace that never reaches storage: `__address__` is the
`host:port` Prometheus connects to, and any label named `__param_<name>` becomes
the query parameter `<name>` on the scrape URL. It also promised that
`__param_*` is writable, and that this chapter would spend the promise. Here is
the job. Write it into `lab/prometheus/prometheus.yml` from the model rather
than copying it — the three rules are the whole lesson, and the table after it
should be enough to produce them from:

```yaml
  - job_name: blackbox
    metrics_path: /probe
    params:
      module: [http_2xx]
    static_configs:
      - targets:
          - http://edge:8080/healthz
          - http://catalog:8081/healthz
    relabel_configs:
      # 1. The thing to probe becomes the ?target= query parameter.
      - source_labels: [__address__]
        target_label: __param_target
      # 2. …and the identity of every series the probe returns.
      - source_labels: [__param_target]
        target_label: instance
      # 3. Only now does __address__ become what Prometheus connects
      #    to.
      - target_label: __address__
        replacement: blackbox-exporter:9115
      - target_label: env
        replacement: lab
```

The conceptual leap is in the `targets:` list, before any relabeling happens.
Those two entries are **things to probe**, written in the slot where Prometheus
normally expects things to scrape. They are not URLs Prometheus will ever
connect to. They are not even `host:port` — the first is a full URL with a
scheme and a path, which no ordinary scrape target could be.

Prometheus does not know that. It loads each one into `__address__` exactly as
written, and the three rules then move it around. Follow one target through and
watch which column changes on each line:

| After | `__address__` | `__param_target` | `instance` |
|---|---|---|---|
| discovery | the probed URL | — | — |
| rule 1 | the probed URL | the probed URL | — |
| rule 2 | the probed URL | the probed URL | the probed URL |
| rule 3 | `blackbox-exporter:9115` | the probed URL | the probed URL |

Rule 2 is the one people leave out, and leaving it out does not produce an
error. `instance` defaults to `__address__`, and after rule 3 that is
`blackbox-exporter:9115` for every target in the job. Two probes then write
two sets of samples into one identical series, each scrape overwriting the
last, and the graph looks like a single endpoint flapping. Rule 2 is what makes
the series say what was probed rather than who did the probing.

The order is not decorative. Rules run top to bottom and each sees what the one
before it produced, so moving rule 3 first makes rule 1 copy the exporter's own
address into `?target=`, and the exporter dutifully probes itself.

Here is the whole arrangement. Prometheus talks only to the exporter; the
exporter is the only thing that touches the target.

```text
┌────────────┐  GET /probe?target=…&module=…  ┌───────────────┐
│ Prometheus │───────────────────────────────▶│   blackbox    │
│   :9090    │◀───────────────────────────────│ exporter :9115│
└────────────┘   probe_success 1, …           └───────────────┘
                                                      │
                                        GET /healthz  │
                                                      ▼
                                              ┌───────────────┐
                                              │  edge :8080   │
                                              └───────────────┘
```

What that proves is where each label comes from. `job="blackbox"` describes the
scrape, which really did go to the exporter. `instance` describes the probe,
which really did go to `edge`. The two arrows are different requests, and the
label set records both honestly.

## Adding the exporter, and getting it wrong first

Add the service to `lab/compose.yaml`:

```yaml
  blackbox-exporter:
    image: quay.io/prometheus/blackbox-exporter:v0.28.0
    restart: unless-stopped
    cap_add:
      - NET_RAW
    volumes:
      - ./blackbox/config.yml:/etc/blackbox_exporter/config.yml:ro
    ports:
      - "9115:9115"
    labels:
      obslab.scrape: "false"
    networks: [obsnet]
    mem_limit: 128m
```

`obslab.scrape: "false"` is Chapter 12's opt-out written out in full rather
than left off, so it stays visible in the file the keep rule reads. Nothing
would discover this container in any case: every discovered job keeps exactly
one Compose service by name, and none of them names `blackbox-exporter`. Probe
results arrive through the job you wrote. `cap_add: [NET_RAW]` is for the ICMP
prober, and is explained where that prober is.

Now write `lab/blackbox/config.yml`. A **prober** is the piece of the exporter
that speaks one protocol — `http`, `tcp`, `dns`, `icmp`. A **module** is a
prober plus that prober's settings, and the scrape job picks one with
`?module=`. Write the smallest thing that could work:

```yaml
modules:
  http_2xx:
    prober: http
    http:
      method: GET
      valid_status_codes: []
      follow_redirects: true
      ip_protocol_fallback: false
```

`valid_status_codes: []` is the documented default written out loud: any 2xx
passes, anything else — including a redirect that was not followed — fails.
`ip_protocol_fallback: false` is a laboratory choice, and the reason for it is
worth having before you need it: a probe that fails for a reason you can name
beats one that succeeds for a reason you cannot.

Start the exporter and reload:

```bash
docker compose up -d blackbox-exporter
make check
make reload
```

The `blackbox` job now appears on `http://localhost:9090/targets` with two
targets. Wait one scrape interval and query `probe_success`.

!!! trap "Every probe fails, and the target is fine"
    ```text
    probe_success{env="lab", instance="http://catalog:8081/healthz",
      job="blackbox"}                                            0
    probe_success{env="lab", instance="http://edge:8080/healthz",
      job="blackbox"}                                            0
    ```

    Both targets are healthy. `curl -s http://localhost:8080/healthz` from
    your laptop returns `{"status":"ok"}`, exactly as it did in Chapter 1. The
    exporter's own container can reach both of them. Nothing in the failure
    has anything to do with the thing being probed.

The way to find out is the best feature in this exporter. Add `debug=true` to
the query and it returns a human-readable report instead of metrics:

```bash
curl -sG http://localhost:9115/probe \
  --data-urlencode 'target=http://edge:8080/healthz' \
  --data-urlencode 'module=http_2xx' \
  --data-urlencode 'debug=true'
```

The response has three sections. Trimmed of timestamps and source-file fields,
and with the metrics section cut to the two lines that matter, the first two
look like this:

```text
Logs for the probe:
level=INFO msg="Beginning probe" probe=http
level=INFO msg="Resolving target address" target=edge ip_protocol=ip6
level=ERROR msg="Resolution with IP protocol failed"
  err="lookup edge on 127.0.0.11:53: no such host"
level=ERROR msg="Probe failed" duration_seconds=0.0018

Metrics that would have been returned:
# TYPE probe_duration_seconds gauge
probe_duration_seconds 0.0018
# TYPE probe_success gauge
probe_success 0
```

The exact error text depends on what your resolver said, but one line is the
one that matters: `ip_protocol=ip6`. Nobody asked for IPv6.

**`preferred_ip_protocol` defaults to `ip6`.** That is the single most common
cause of probes failing or hanging in IPv4-only environments, which includes
almost every Docker setup, and nothing in the error points at it. The exporter
asked for an AAAA record — the IPv6 address record — of a name that has only an
A record on an IPv4-only bridge network, and then stopped, because you turned
fallback off.

Leaving `ip_protocol_fallback` at its default `true` is the worse outcome, and
avoiding it is why that line went in from the start. With fallback on, the
exporter asks for both families at once, finds the IPv4 address, uses it, and
reports `probe_success 1` — green, by a route nobody chose, with the wrong
default still sitting in the file and nothing to debug until the day it
matters.

The third section of the debug report, "Module configuration:", prints the
module as the exporter parsed it, which is worth reading any time a module
behaves in a way you did not write down. One line fixes this one:

```yaml
modules:
  http_2xx:
    prober: http
    http:
      method: GET
      valid_status_codes: []
      follow_redirects: true
      preferred_ip_protocol: ip4
      ip_protocol_fallback: false
```

`make check` validates `prometheus.yml` and the rule files; nothing validates
`lab/blackbox/config.yml`, so a typo there arrives as a failing probe rather
than as a failed check. And `make reload` asks *Prometheus* to re-read its
configuration. The file you changed belongs to the exporter, so restart that:

```bash
docker compose restart blackbox-exporter
```

Wait fifteen seconds and both probes read `1`.

## What comes back from a probe

Every probe returns the same three series whatever it was checking.
`probe_success` is the verdict, `1` or `0`. `probe_duration_seconds` is how long
the whole thing took, in seconds. `probe_timeout_seconds` is the budget it had —
and nothing in `lab/blackbox/config.yml` sets a timeout anywhere, because
Prometheus sends its own scrape timeout to the exporter in a request header and
the probe inherits it. `probe_timeout_seconds` is where you confirm that, and the
gap between it and `probe_duration_seconds` is your headroom. Set a module
`timeout` only when you want a probe to be stricter than the scrape that
triggered it.

Three more come from the name-resolution step every prober in this lab performs:
`probe_ip_protocol` (`4` or `6` — this is where you confirm the fix took, and
`0` when nothing was resolved at all), `probe_ip_addr_hash`, which changes when
the address behind a name changes, and `probe_dns_lookup_time_seconds`. All
three are published whether or not the lookup succeeded, so what tells the two
cases apart is their value and not their presence.

None of those six carry a label of their own. Everything that distinguishes one
probe from another arrived through relabeling, which is why rule 2 matters so
much.

The HTTP prober adds a dozen more, and the useful ones are
`probe_http_status_code`, `probe_http_redirects`, `probe_http_ssl`,
`probe_http_version`, `probe_http_content_length`, and the one that turns an
outage into a diagnosis:

```promql
probe_http_duration_seconds
```

That is a breakdown of where the time went, labeled by `phase` — `resolve`,
`connect`, `tls`, `processing`, `transfer`. A probe that got slower is a
question; a probe whose `connect` phase got slower while `processing` stayed
flat is an answer.

Count what the job costs:

```promql
count({job="blackbox"})
```

Run it now and you get two targets' worth. With the third target this chapter
still has to add, the measured total is 74 — roughly two dozen series per
probed endpoint, scrape metadata included, with the TLS target carrying the
most. Probes are cheap, and their
cardinality is bounded by the number of things you chose to probe, which is the
best kind of bound there is.

Two more properties of `/probe` are worth meeting here rather than at an awkward
moment. A request with no `target` at all is answered `400`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  http://localhost:9115/probe
```

And a scrape that omits `module` does not get an error — it gets the module
literally named `http_2xx`, the exporter's hard-coded default. If your config has
no module by that name, you are back to `400`. Naming your general-purpose HTTP
module something else is a small decision with a long-delayed consequence.

Finally: never put `debug=true` in a scrape job. The response is prose, not
exposition format, and the scrape fails to parse it. By hand it is the fastest
tool in the chapter, and `http://localhost:9115/` lists recent probes with a
debug link beside each one.

## Seven probers, and the one that reads backwards

Version 0.28.0 ships seven probers: `http`, `tcp`, `dns`, `icmp`, `grpc`, `unix`
and `websocket`. The last two, and HTTP/3 support, are new in this release, so
anything you read about them written before December 2025 is speculation.

Add three of them to `lab/blackbox/config.yml`, under the existing `modules:`
key:

```yaml
  tcp_connect:
    prober: tcp
    tcp:
      preferred_ip_protocol: ip4

  icmp:
    prober: icmp
    icmp:
      preferred_ip_protocol: ip4

  dns_a:
    prober: dns
    dns:
      query_name: edge
      query_type: A
      preferred_ip_protocol: ip4
```

Restart the exporter and confirm all four modules parsed, without involving
Prometheus at all:

```bash
curl -sG http://localhost:9115/probe \
  --data-urlencode 'target=valkey:6379' \
  --data-urlencode 'module=tcp_connect' | grep probe_success
```

That prints `probe_success 1`. `tcp_connect` answers "is anything listening at
all", which is the only sensible question to ask of `postgres:5432` or
`valkey:6379` — an HTTP probe against either would be meaningless.

`icmp` is the one that carries `cap_add: [NET_RAW]` on the exporter's
container. ICMP needs a raw socket and a raw socket needs that capability.
Docker already grants it by default, so the line changes nothing on a stock
daemon: it is there to say out loud what the prober depends on, and to keep
working where somebody has trimmed the default set. Exercise 4 takes the
capability away for real and makes you read what comes back.

The DNS prober inverts the convention every other module follows, and it does it
silently.

!!! pitfall "`target` is the DNS server, not the name you are looking up"
    For `http`, `tcp`, `icmp` and `grpc`, `?target=` is the thing you care
    about. For `dns`, `?target=` is **the DNS server to interrogate**, and the
    record you want is `query_name` inside the module. Get them the wrong way
    round and you are asking a web server to resolve a name, which times out and
    reports as a DNS failure — a message that sends you looking at DNS, which is
    exactly where the problem is not.

So a DNS probe of Docker's own embedded resolver, from inside the network, has
`query_name: edge` and `query_type: A` — the IPv4 address record — in the
module, and `127.0.0.11:53` in the target list. The
module says what to ask; the target says whom to ask. It reads backwards because
a DNS probe is a probe *of a resolver*, and the resolver is the thing that can
be broken.

## Certificates, and the alert everybody wishes they had

Add the third target. `edge` serves HTTPS on `:8443` from Caddy's own internal
certificate authority, which nothing in this stack trusts, so this probe has to
skip verification:

```yaml
  http_2xx_insecure_tls:
    prober: http
    http:
      method: GET
      valid_status_codes: []
      follow_redirects: true
      preferred_ip_protocol: ip4
      ip_protocol_fallback: false
      tls_config:
        insecure_skip_verify: true
```

Skipping verification does not skip the handshake. The chain is still fetched
and still inspected, which is why this probe still produces
`probe_ssl_earliest_cert_expiry` — a gauge holding the Unix timestamp at which
the earliest certificate in the chain stops being valid.

One target needs a different module from the other two, and the job already
declares `params: module: [http_2xx]` for all of them. The fix is a per-target
label, because a `__param_module` written on the target beats the job-wide
`params:`:

```yaml
      - targets:
          - https://edge:8443/-/healthy
        labels:
          __param_module: http_2xx_insecure_tls
```

Two different things have to re-read two different files here: restart the
exporter so it learns the new module, `make reload` so Prometheus learns the
new target. Then ask how long the certificate has:

```promql
(probe_ssl_earliest_cert_expiry - time()) / 86400
```

`time()` returns the evaluation timestamp in seconds, so the subtraction is
seconds remaining and the division makes it days. On this lab the number is
small and never grows: Caddy's internal authority issues short-lived leaf
certificates and renews them well before they expire, so the value sits in a
narrow band and sinks to that band's floor once per renewal cycle.

That is why the two alerts this chapter adds to
`lab/prometheus/rules/meta-alerts.yml` use a six-hour threshold rather than the
thirty days you would use in production. Six hours is also close enough to the
floor that this alert can genuinely fire on a lab left running overnight, which
is worth leaving alone: almost nobody gets to watch a certificate alert work
before the day it matters.

```yaml
      - alert: ProbeFailing
        expr: probe_success{job="blackbox"} == 0
        for: 5m
        labels:
          severity: page
          service: snip

      - alert: ProbeCertificateExpiringSoon
        expr: |
          probe_ssl_earliest_cert_expiry{job="blackbox"} - time()
            < 6 * 3600
        for: 15m
        labels:
          severity: ticket
          service: snip
```

The annotations follow the five-field template from Chapter 19, "What a Page
Should Say, and Who Watches the Watcher", and are in the file. The two things
worth arguing about are the numbers.

`for: 5m` on `ProbeFailing` is chosen against a specific event: a rolling
restart of `snip-api`. With a fifteen-second scrape interval a single failed
probe is one sample, and a deployment that briefly drops a connection produces
one or two. Five minutes of *continuous* failure — remembering from Chapter 16
that one good evaluation resets the clock — outlasts any restart in this lab and
still pages before anybody notices the outage by other means.

Six hours for a certificate is a laboratory number. In production, use thirty
days:

```promql
(probe_ssl_earliest_cert_expiry - time()) / 86400 < 30
```

Thirty days is a working week of slack plus a holiday. Every reader has met the
failure this alert prevents: an expired certificate fails every request, all at
once, for everybody, with no warning whatsoever from any white-box metric —
because from the inside, nothing is wrong.

## What the outside can and cannot see

A probe of `http://edge:8080/healthz` tests more than Snip. It tests DNS
resolution of the name `edge`, the TCP connection to it, Caddy's willingness to
accept and route the request, the hop from Caddy to whichever `snip-api` replica
it chose, Snip's handler, and the response coming back. Any one of those failing
turns `probe_success` to `0`. That coverage is the point: it is the only signal
you have that fails when the *path* fails rather than when the service does.

And that is also its limit. When it goes to `0`, it tells you nothing about
which of those six things broke. It knows nothing about which handler ran, which
database query was slow, which customer was affected, or which of your replicas
is the sick one — because it never saw inside. A probe is a smoke alarm. It is
loud, it is right about the building, and it will not tell you which room.

Two more honest limits. A probe is synthetic traffic: `/healthz` now gets an
extra request every fifteen seconds, and it shows up in Snip's own counters like
any other request.

```promql
rate(snip_http_requests_total{route="/healthz"}[5m])
```

Part of that number is the monitoring system watching itself, at a steady
one-fifteenth of a request per second. That is also the machinery behind the
fifth low-traffic fix in Chapter 21, "Burn Rates: Alerts That Don't Cry Wolf":
point one more probe at a real redirect — `http://edge:8080/l/readme` rather
than `/healthz` — and the availability SLI gains a floor of 240 events an hour
at exactly the cost Chapter 21 named. That probe needs a module of its own,
with `follow_redirects: false` and `valid_status_codes: [302]`, because the
seeded links point at the public internet and the module you have would chase
them off a laptop with the network unplugged. *IOU from chapter 21, settled.*

And a probe runs from wherever the exporter runs. This one runs inside `obsnet`,
alongside the thing it probes, so it cannot detect anything that breaks between
your users and your network edge. Real black-box monitoring runs from several
places that are deliberately not yours, and comparing them is how you tell "we
are down" from "one region cannot reach us".

## The same shape again

Everything so far could be a quirk of one exporter. It is not, and the cheapest
way to prove that is to do it a second time against something completely
different.

`valkey` has been Snip's cache since Chapter 1 and nothing has ever monitored
it. Valkey is the BSD-licensed fork of Redis, speaks the same protocol, and
`redis_exporter` v1.88.0 describes itself as a Valkey *and* Redis exporter — the
2024 license change split that ecosystem and you will meet both names. Add it:

```yaml
  redis-exporter:
    image: oliver006/redis_exporter:v1.88.0
    restart: unless-stopped
    command:
      - --redis.addr=redis://valkey:6379
    ports:
      - "9121:9121"
    depends_on:
      valkey:
        condition: service_healthy
    labels:
      obslab.scrape: "true"
      obslab.metrics_port: "9121"
      obslab.metrics_path: "/metrics"
      obslab.job: "redis"
    networks: [obsnet]
    mem_limit: 128m
```

The image comes from Docker Hub, under the maintainer's own account. Chapter
1's one-registry rule covers Prometheus-org images, and — like cAdvisor in
Chapter 22 — this exporter is not one. `obslab.job` is the one Chapter 12 label
you have not seen used: it overrides the job name a discovered container would
otherwise be given. It is here for completeness, because the job you are about
to write is static rather than discovered, so nothing reads any of these four
labels.

Now the job. Write it without looking at the exporter's documentation:

```yaml
  - job_name: redis
    metrics_path: /scrape
    static_configs:
      - targets: ["valkey:6379"]
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: redis-exporter:9121
      - target_label: env
        replacement: lab
```

Put that next to the blackbox job and read the three rules that carry the
pattern across, plus the job's usual `env` label. They are character for
character identical. Two strings changed: `/probe` became
`/scrape`, and `blackbox-exporter:9115` became `redis-exporter:9121`. That is
the entire difference between probing an HTTP endpoint and interrogating a
cache, because both exporters are functions and this is how you call one.

The job name is `redis` and not `redis-exporter` on purpose: these series
describe Valkey, not the process reporting on it.

Which brings up the one thing this pattern quietly changes about a label you
have trusted since Chapter 1. `up{job="redis"}` is `1` when the *exporter*
answered the scrape. Whether Valkey is alive is `redis_up`. The same split runs
through the probes: `up{job="blackbox"}` says the exporter replied,
`probe_success` says the probe worked. In a multi-target job `up` has stopped
being a health check of the thing named in `instance`, and any alert that
assumed otherwise is now watching the wrong process.

Reload and look:

```promql
redis_up
```

`1`, labeled `instance="valkey:6379"` — the probed address again, not
`redis-exporter:9121`. Then the number that matters for a cache, because it is
the clearest "this cache is too small" signal there is:

```promql
rate(redis_evicted_keys_total[5m])
```

Anything above zero means Valkey is throwing away keys that had not expired, to
make room. Snip's hit ratio from Chapter 9, "Ratios, Arithmetic, and the Series
That Isn't There", will be falling at the same time, and now you can see both
halves of that story. From Valkey's own side:

```promql
rate(redis_keyspace_hits_total[5m])
  / (rate(redis_keyspace_hits_total[5m])
     + rate(redis_keyspace_misses_total[5m]))
```

`snmp_exporter` is the other famous member of this family: one exporter, a
`/snmp?target=` endpoint, and thousands of network devices behind the same four
relabel rules.

!!! selfcheck "Self-check"
    Both jobs are in place now, so run `make verify-ch23`. It must end with:

    ```text
    ch23: 12 passed, 0 failed
    ch23 OK
    ```

    Among those twelve it asserts `probe_success == 1` for all three probe
    targets, that no probe series carries the exporter's own address in
    `instance` — which is rule 2, checked mechanically — and that `redis_up`
    arrived through the second job. If `probe_success` is `0`, the script prints
    the by-hand `debug=true` URL and reminds you about `preferred_ip_protocol`.

## Common mistakes

**Forgetting rule 2.** The job loads, the scrape succeeds, `probe_success`
exists, and every target has collided into one series labeled
`instance="blackbox-exporter:9115"`. Nothing anywhere reports an error. Check
`instance` on every multi-target job you write; it should never name the
exporter.

**Putting rule 3 first.** `__address__` becomes the exporter before rule 1 reads
it, so `?target=blackbox-exporter:9115` and the exporter probes itself. The probe
succeeds, which is the worst possible outcome, because a green panel that means
nothing is harder to find than a red one.

!!! pitfall "Probing localhost from inside a container"
    `target=http://localhost:8080/healthz` resolves inside the
    `blackbox-exporter` container, where nothing is listening on 8080. The probe
    fails and the message is a connection refusal, which reads as "the service
    is down". Targets are always written from the exporter's point of view:
    `http://edge:8080/healthz`, on the Compose network, never `localhost` and
    never a published host port.

**Scraping the exporter's `/metrics` and expecting probes.** `/metrics` is the
exporter describing itself — a legitimate thing to collect, and how you learn
that a config reload failed — but no `probe_*` series ever appears there. Probe
results exist only as the response to a `/probe` request.

**Alerting on a single failed probe.** One probe, from one vantage point, with
no `for:`, will page you for a dropped packet. Either use `for: 5m`, as
`ProbeFailing` does, or average the verdict over a window:
`avg_over_time(probe_success[5m]) < 0.5`.

**Treating a probe as a replacement for instrumentation.** It is the other half,
not a cheaper version. A team with only probes knows when it is down and never
knows why.

## Summary

Some exporters have no subject of their own. They are functions: you call them
with a parameter and they go and find out. Prometheus has no idea how to call a
function, so you write the argument list where it expects a target list, then use
relabeling to move it into a query parameter and put the exporter's real address
back where Prometheus will look for it.

That is three rules, in a fixed order, and once you can write them from memory
you can adopt any multi-target exporter in about five minutes — including ones
whose documentation is worse than this explanation.

The things to still know in six months:

- `__address__` means two different things in the same block. Before rule 3 it
  is the thing you want to know about; after rule 3 it is what Prometheus
  connects to. Every mistake in this pattern is about which one is in there.
- Rule 2 — `__param_target` into `instance` — is what makes the series say what
  was probed. Without it every target collides, silently.
- `preferred_ip_protocol` defaults to `ip6`. On Docker, set it to `ip4` in every
  module, or spend an afternoon reading DNS errors that have nothing to do with
  DNS.
- `?debug=true` returns the probe log, the metrics that would have been
  returned, and the module as it actually resolved. It answers the question
  faster than anything else in this chapter, and it must never appear in a
  scrape job.
- The DNS prober inverts the convention: `target` is the server, `query_name` is
  the record.
- `probe_ssl_earliest_cert_expiry` minus `time()` is the highest-value,
  lowest-effort alert in this book. Thirty days in production.
- Black-box probing tests the path, the proxy, DNS and the TLS chain, and can
  identify none of them when it fails. Instrumentation identifies all of them and
  cannot see the path. Run both.

## Exercises

!!! exercise
    **1. The label ledger (warm-up).** Write out the three relabel rules of
    the `blackbox` job and, after each one, the value of `__address__`,
    `__param_target` and `instance` for the target
    `https://edge:8443/-/healthy`. Then confirm the last row against reality:
    the `instance` label on `probe_ssl_earliest_cert_expiry` in Prometheus must
    equal what you wrote, and `__address__` must appear nowhere at all.

    **2. A name that does not resolve (core).** Add
    `http://nowhere:8080/healthz` to the blackbox target list and reload. Which
    series tells you the name failed to resolve, and what value does it take?
    Name a second series whose value also distinguishes this failure from a
    service that resolved and refused the connection. Remove the target
    afterward.

    **3. The DNS probe, backwards then forwards (core).** Write a scrape job
    using the `dns_a` module with `?target=` set to `edge` — the name, not a
    server. Read what `probe_success` does and read the `debug=true` log. Now
    set the target to `127.0.0.11:53`, Docker's embedded resolver, and reload.
    Write one sentence explaining which field is the server and which is the
    record, in words you would use on a colleague.

    **4. ICMP without permission (core).** Deleting `cap_add: [NET_RAW]`
    proves nothing, because Docker grants `NET_RAW` by default. Take it away
    instead: give the `blackbox-exporter` service `cap_drop: [NET_RAW]`, and
    `sysctls: {net.ipv4.ping_group_range: "1 0"}` to close the unprivileged
    path as well. Recreate the container and probe `?target=edge&module=icmp`.
    Read the error in the `debug=true` log and write it down verbatim. Put the
    service back as it was and confirm the same probe returns
    `probe_success 1`.

    **5. A real certificate, requires internet (stretch).** Add an external
    HTTPS site to the blackbox target list using the plain `http_2xx` module — a
    public one you do not own is fine. Confirm
    `(probe_ssl_earliest_cert_expiry - time()) / 86400` returns a plausible
    number of days, then write an alerting rule that fires thirty days before
    expiry. Explain why `insecure_skip_verify` must *not* be set on this one.

    **6. An exporter you have never used (stretch).** Find one exporter in the
    wild whose endpoint is `/scrape?target=` or similar — `snmp_exporter` and
    `postgres_exporter`'s multi-target mode both qualify. Without reading its
    README, write its scrape job. Then check the README and list every
    difference. If there are none, you have the pattern.

!!! note "Part VII, closing"
    Redirect latency had doubled and nobody had shipped anything. The service's
    own CPU usage looked unremarkable, which is why three people spent an
    afternoon reading application code that had not changed. The answer was a
    container being held back by a limit somebody set months earlier and
    everybody had forgotten:
    `rate(container_cpu_cfs_throttled_seconds_total[5m])`, non-zero, on exactly
    one container. Two queries, no code changes, and — since this chapter — a
    probe that would have said from the outside that the path had slowed before
    anybody had to ask.
