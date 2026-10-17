# Appendix A — The complete lab

Every service, port, switch, script, make target and image pin the lab uses, in
one place. Each entry names the chapter that built it, so you can go back for
the reasoning when the fact alone is not enough.

Two commands recover any broken state: `make reset` removes the containers and
the named volumes, and `git checkout ch<NN> && make up` rebuilds that chapter's
exact stack in about thirty seconds plus image pull time.

## The repository at a glance

These names are fixed, and several are load-bearing: the Compose project name
is what makes every container predictably `obslab-<service>-<N>`.

| Item | Value |
|---|---|
| Repository and Compose project | `obslab` (top-level `name:` key) |
| Network | `obsnet` (explicit `name:`, so it is not prefixed) |
| Git tags | `ch01` … `ch29`; `main` is the finished ch29 state |
| Named volumes | `promdata`, `grafanadata`, `pgdata`, `amdata`, `caddydata`, `caddyconfig` |
| Overlay volumes | `prombdata` (ch26), `tempodata`, `lokidata`, `alloydata` (ch29) |

## Service inventory

Sixteen services make up the finished base stack — seventeen containers,
because `snip-api` runs two replicas. The overlays add four more.

| Service | Image or build | Added | Role |
|---|---|---|---|
| `snip-api` | build `./snip`, Go 1.25 | ch1 | The service you own and edit |
| `snip-api-b` | build `./snip` | ch2 | Second replica; deleted in ch12 |
| `loadgen` | build `./loadgen`, Go 1.25 | ch1 | Traffic driver, chaos control plane, measured too |
| `valkey` | `valkey/valkey:9-alpine` | ch1 | Snip's cache; persistence off |
| `postgres` | `postgres:18-alpine` | ch1 | Snip's store |
| `prometheus` | Prometheus v3.13.1 | ch1 | TSDB on `promdata` |
| `grafana` | Grafana 13.1.1 | ch3 | Provisioned from files; anonymous Admin |
| `catalog` | build `./catalog`, Python 3.13 | ch4 | Someone else's service; three planted bugs |
| `snip-worker` | build `./snip`, `SNIP_ROLE=worker` | ch8 | No HTTP API; metrics only |
| `edge` | `caddy:2-alpine` | ch12 | Reverse proxy; basic auth from ch25 |
| `alertmanager` | Alertmanager v0.33.1 | ch17 | State on `amdata` |
| `pager` | build `./pager`, Python 3.13 | ch17 | Offline webhook sink with a web UI |
| `node-exporter` | node_exporter v1.12.1 | ch22 | Host metrics; see Platform notes |
| `cadvisor` | cAdvisor v0.60.5 | ch22 | Container metrics; privileged |
| `postgres-exporter` | postgres_exporter v0.20.1 | ch22 | Connects as `pg_monitor` |
| `blackbox-exporter` | blackbox_exporter v0.28.0 | ch23 | Probes from outside |
| `redis-exporter` | redis_exporter v1.88.0 | ch23 | Multi-target as a pattern |
| `prometheus-b` | the same Prometheus pin | ch26 | `compose.scale.yaml` only |
| `tempo` · `loki` · `alloy` | Tempo 3.0.2 · Loki 3.7.4 · Alloy v1.18.0 | ch29 | `compose.signals.yaml` only |

Deliberately absent, forever: the Pushgateway, `snmp_exporter`,
`windows_exporter`, and any Thanos, Mimir, Cortex or VictoriaMetrics component.

!!! selfcheck "Self-check"
    With the base stack up, `http://localhost:9090/targets` shows **12 scrape
    jobs and 14 targets**, every one of them `up == 1`. The target count is
    higher than the job count because the blackbox job alone accounts for
    three of them, one per probed address.

## The port map

One table, no internal collisions, and nothing else is published. A service
reachable only inside `obsnet` is not here.

| Host port | → container | Service | Live |
|---|---|---|---|
| 3000 | 3000 | `grafana` | ch3 onward |
| 3100 | 3100 | `loki` (overlay) | ch29 onward |
| 3200 | 3200 | `tempo` (overlay) | ch29 onward |
| 5001 | 5001 | `pager` | ch17 onward |
| 5432 | 5432 | `postgres` (TCP) | ch1 onward |
| 6379 | 6379 | `valkey` (TCP) | ch1 onward |
| 8000 | 8000 | `snip-api` | ch1 through ch11 |
| 8080 | 8080 | `edge` | ch12 onward |
| 8081 | 8081 | `catalog` | ch4 onward |
| 8085 | 8080 | `cadvisor` | ch22 onward |
| 8089 | 8089 | `loadgen` | ch1 onward |
| 8090 | 8090 | `snip-worker` | ch8 onward |
| 8443 | 8443 | `edge` (HTTPS, `tls internal`) | ch12 onward |
| 9090 | 9090 | `prometheus` | ch1 through ch24 |
| 9093 | 9093 | `alertmanager` | ch17 onward |
| 9094 | 9094 | `alertmanager` (TCP **and** UDP) | ch17 onward |
| 9099 | 9090 | `prometheus-b` (overlay) | ch26 onward |
| 9100 | 9100 | `node-exporter` | ch22 onward |
| 9115 | 9115 | `blackbox-exporter` | ch23 onward |
| 9121 | 9121 | `redis-exporter` | ch23 onward |
| 9187 | 9187 | `postgres-exporter` | ch22 onward |
| 12345 | 12345 | `alloy` (overlay) | ch29 onward |

Two host ports disappear during the book, and both removals are the lesson.
Port 8000 goes in Chapter 12, "`prometheus.yml` in Full: Service Discovery and
Relabeling", because a service publishing a fixed host port cannot be scaled.
Port 9090 goes in Chapter 25, "Storage, Retention, Backups and Locking the
Door", when Prometheus moves behind `edge`. Both verify scripts assert that the
port is gone.

Unpublished on purpose: Caddy's admin API on `edge:2019`, `snip-api-b`'s HTTP
port, and Tempo's OTLP receivers on `tempo:4317` and `tempo:4318`.

## The teaching switches

Every fault is summoned by an environment variable, never by asking you to
break your own file. All of these live in `.env`, which `make up` creates from
`.env.example`. Change one, run `make up` again, and the stack picks it up; set
it back and the fault is gone.

| Switch | Default | What it summons | Used in |
|---|---|---|---|
| `SNIP_ROLE` | `api` | `api` or `worker` — the entrypoint, from one image | ch8 |
| `SNIP_VERSION` | `1.4.0` | Value of `snip_build_info{version}` | ch5, ch11 |
| `SNIP_COMMIT` | `a1b2c3d` | Value of `snip_build_info{commit}` | ch5, ch11 |
| `SNIP_ALLOW_FAULT_HEADERS` | `1` | Enables the `X-Snip-*` request headers | ch3 |
| `SNIP_NO_CONTENT_TYPE` | `0` | Bare `/metrics`; Prometheus 3 fails the whole scrape | ch5 |
| `SNIP_GAUGE_COUNTER` | `0` | A monotonic value typed as a gauge; `rate()` returns plausible garbage | ch4 |
| `SNIP_UNBOUNDED_LABEL` | `0` | Adds `link_code` to `snip_http_requests_total` — the bomb | ch7, ch24 |
| `SNIP_BUCKETS` | `slo` | `slo` or `default` — objective-designed buckets versus `client_golang`'s eleven `DefBuckets` | ch10 |
| `SNIP_NO_ZERO_INIT` | `0` | Stops pre-initializing known label values — the silent alert | ch9, ch16 |
| `SNIP_OPENMETRICS` | `0` | `EnableOpenMetrics` on the handler; exemplars need it | ch29 |
| `SNIP_EXEMPLARS` | `0` | Attaches exemplars to `snip_http_request_duration_seconds` | ch29 |
| `SNIP_EXEMPLAR_LABEL` | `trace_id` | `trace_id` or `traceID` — the one-character mismatch that produces a dead link and no error | ch29 |
| `SNIP_OTEL` | `0` | Worker only: the OpenTelemetry SDK and OTLP push | ch28 |
| `LOADGEN_NATIVE` | `0` | Sets `NativeHistogramBucketFactor: 1.1`; dual exposition | ch10 |
| `CATALOG_FIX_TYPE` | `0` | Fixes planted bug 1 (the gauge that counts) | ch4 |
| `CATALOG_FIX_UNITS` | `0` | Fixes planted bug 2 (milliseconds against second buckets) | ch10 |
| `CATALOG_FIX_CARDINALITY` | `0` | Fixes planted bug 3 (the unbounded `book_id` label) | ch24 |

!!! trap "Trap"
    A switch left on is invisible until you count series. With a stale `.env`
    carrying `SNIP_UNBOUNDED_LABEL=1`, `count(snip_http_requests_total)`
    returns this instead of the 12 that Chapter 7, "Labels, and the Cardinality
    Arithmetic You Must Do First", predicts:

    ```text
    1562
    ```

    Nothing errors, no target goes down, every dashboard still draws. The cure
    is `rm .env && make up`, which regenerates it from `.env.example`.

## The `loadgen` control API

`GET http://localhost:8089/control` returns the current state; a `POST` to the
same address merges the fields you supply. Every field is optional, and these
are the defaults:

```json
{
  "rps": 20,
  "route": "mix",
  "error_ratio": 0.0,
  "extra_latency_ms": 0,
  "latency_ratio": 1.0,
  "db_delay_ms": 0,
  "cache_bypass": false,
  "cardinality_mode": false,
  "write_ratio": 0.05,
  "timeout_ms": 2000,
  "scenario": ""
}
```

`route` accepts `mix` plus the five routes `loadgen` drives directly: `/`,
`/l/{code}`, `/links`, `/links/{code}` and `/healthz`. The `mix` weighting is
fixed: **80 % `GET /l/{code}`, 10 % `GET /links/{code}`, 5 % `POST /links`,
5 % `GET /healthz`**. Only `write_ratio` moves it, and the redirect share
absorbs the difference.

Three more endpoints take a POST.

| Endpoint | Effect |
|---|---|
| `POST /chaos/stall {"seconds": 60}` | Sends nothing for N seconds — a genuine data gap |
| `POST /chaos/kill` | Exits 1; Docker restarts it — a counter reset on a service you do not own |
| `POST /chaos/reset` | Every knob back to its default; scenario canceled |

Faults are injected with request headers rather than a private channel, so
they apply to every replica and you can reproduce any of them with `curl`.

| Header | Meaning |
|---|---|
| `X-Snip-Fail-Ratio: 0.35` | This request fails with `500` with probability 0.35 |
| `X-Snip-Delay-Ms: 2500` | Sleep 2500 ms inside the handler |
| `X-Snip-DB-Delay-Ms: 400` | Sleep 400 ms inside the database call only |
| `X-Snip-Cache-Bypass: 1` | Skip Valkey; go straight to Postgres |

## Scenario scripts

Each script wraps `POST /control`, prints what it is about to do and how long
it will run, then restores the previous state. All take `DURATION=<seconds>`.

| Script | Control state | Default run | Used in |
|---|---|---|---|
| `scenario-outage.sh` | `rps 40, error_ratio 0.30` | 15 min | ch19, ch21, ch29 |
| `scenario-drip.sh` | `rps 40, error_ratio 0.01` | 60 min | ch21 |
| `scenario-slow-db.sh` | `rps 40, db_delay_ms 400` | 15 min | ch22 |
| `scenario-latency-tail.sh` | `rps 40, extra_latency_ms 12000, latency_ratio 0.02` | 10 min | ch10 |
| `scenario-flap.sh` | alternates `error_ratio` 0.30 and 0.00 every 45 s | 20 min | ch16, ch17 |
| `scenario-low-traffic.sh` | `rps 0.0028` with one forced failure | 60 min | ch21 |
| `scenario-cardinality.sh` | `rps 300, cardinality_mode true` | 8 min | ch24 |
| `scenario-noise-history.sh` | drives about 40 notifications | 4 min | ch19 |

`scenario-cardinality.sh` refuses to run unless `SNIP_UNBOUNDED_LABEL=1`, and
prints the expected peak before it starts.

## The `make` targets

A bare `make` prints this list rather than starting sixteen containers.

| Target | What it does |
|---|---|
| `make help` | Prints the target list; the default goal |
| `make up` | `docker compose up -d --build --scale snip-api=$(SNIP_API_SCALE)` |
| `make down` | Removes the containers; the volumes survive |
| `make reset` | Containers and volumes gone, verified |
| `make pull` | Pulls every pinned image **and builds** the local ones |
| `make ps` / `make logs` | Status; `make logs S=snip-api` follows one service |
| `make check` | Static validation: tree, compose files, binds, schema, rules |
| `make verify` | The verify script for the checked-out chapter tag |
| `make verify-chNN` | One chapter's script, e.g. `make verify-ch12` |
| `make test-rules` | `promtool test rules` over `prometheus/rules/tests/` |
| `make scale N=4` | Changes the `snip-api` replica count |
| `make reload` | Asks Prometheus to re-read its config (ch12; before that, `docker compose restart prometheus`) |
| `make history` | Regenerates `fixtures/history.om`, 30 days ending now |
| `make backfill` | Turns that file into TSDB blocks (ch20) |
| `make snapshot` | Admin-API snapshot into `./snapshots/` (ch25) |
| `make scale-up` / `make signals-up` | The ch26 and ch29 overlays |
| `make ports` | Checks each published host port for a listener |
| `make doctor` | Checks Docker and its memory, then runs `ports` |
| `make k8s-up` / `make k8s-down` | The ch27 parallel lab on a `kind` cluster |

`make reload` posts to `$(PROM_URL)`, which defaults to the ch25 address
`https://localhost:8443/prometheus` with the `edge` credentials. Before ch25,
override it: `make reload PROM_URL=http://localhost:9090 PROM_CURL_OPTS=`.

Three verify targets fail on a fresh clone **by design**, because they grade a
file you write: `verify-ch04` wants `docs/type-census.md`, `verify-ch06` your
written rate predictions, `verify-ch07` a `TOTAL:` figure in
`docs/cardinality-budget.md`. Four more need what the base stack does not start:
the ch26 and ch29 overlays, `SNIP_OTEL=1` for ch28, a `kind` cluster for ch27.

## Registry policy and the pinned images

One registry rule per source, decided once.

| Source | Rule |
|---|---|
| Prometheus-org images | `quay.io/prometheus/*` |
| Grafana images | Docker Hub; not published to Quay |
| cAdvisor | `ghcr.io/google/cadvisor`; the old `gcr.io` path is dead |
| postgres_exporter | `quay.io/prometheuscommunity/*` — the community org |
| redis_exporter | `oliver006/redis_exporter` on Docker Hub — a named exception |

Every tag here was verified against its registry on 2026-07-27.

| Component | Exact tag | Released |
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

Library pins: `github.com/prometheus/client_golang v1.24.1` for `snip-api`,
`snip-worker` and `loadgen`; `prometheus-client==0.26.0` for `catalog` and
`pager`; `go.opentelemetry.io/otel/sdk/metric v1.44.0` for ch28.

Six tags are pinned to a major line rather than a patch, because they are
plumbing rather than the subject of this book: `postgres:18-alpine`,
`valkey/valkey:9-alpine`, `caddy:2-alpine`, `python:3.13-slim`,
`golang:1.25-alpine` and `gcr.io/distroless/static-debian13:nonroot`. Record
what your own pull resolved, so a future discrepancy is checkable:

```bash
docker image inspect postgres:18-alpine \
  --format '{{index .RepoDigests 0}}'
```

Distroless publishes no version numbers, so `:nonroot` is the most specific
named tag there is. It also carries behavior — it sets `USER 65532` — which is
why neither Go Dockerfile writes a `USER` line.

## The directory tree

Directories and the files worth knowing by name. `make check` runs a tree audit
that fails if any of these paths is missing.

```text
obslab/
├── compose.yaml                compose.scale.yaml   (ch26)
├── .env.example                compose.signals.yaml (ch29)
├── Makefile  README.md  LICENSE
├── .github/workflows/rules.yml                      (ch18)
├── snip/          main.go api.go worker.go metrics.go db.go
│                  cache.go faults.go settings.go otelmetrics.go
├── loadgen/       main.go control.go driver.go metrics.go
├── catalog/       app.py metrics.py BUGS.md  ← the spoiler file
├── pager/         app.py templates/pager.html       (ch17)
├── prometheus/
│   ├── prometheus.yml
│   ├── targets/extra.json                           (ch12)
│   └── rules/     snip-recording.yml  snip-alerts.yml
│                  snip-burnrate.yml   meta-alerts.yml
│                  meta-recording.yml  tests/*.yml
├── alertmanager/  alertmanager.yml templates/pager.tmpl
├── provisioning/  datasources/prometheus.yaml
│                  dashboards/obslab.yaml  ← the PROVIDER
├── dashboards/    snip-red.json  snip-red-BROKEN.json
│                  snip-slo.json  snip-use.json  meta.json
├── blackbox/config.yml    edge/Caddyfile
├── postgres/initdb/       01-schema.sql 02-exporter.sql
├── textfile/              tempo/  loki/  alloy/
├── scripts/       lib.sh check.sh tree-audit.sh
│                  verify-ch01.sh … verify-ch29.sh
│                  scenario-*.sh  snapshot.sh  backup-example.sh
├── fixtures/      history.om  generate-history.py
│                  sloth-generated.yml  pyrra-generated.yml
│                  stale-queries/*.promql
├── docs/          SLO.md  error-budget-policy.md  runbooks/*.md
│                  ALERT-REVIEW.md  type-census.md
│                  cardinality-budget.md
├── exercises/     ch06 ch07 ch14 ch21 worksheets
└── k8s/           kind-cluster.yaml  values-kps.yaml       (ch27)
                   snip-{deployment,service,servicemonitor}.yaml
                   snip-prometheusrule.yaml
```

The two most-confused paths: `provisioning/dashboards/obslab.yaml` is the
*provider*; `dashboards/*.json` are the *dashboards*.

## Chapter to git tag

Each tag is a complete working state. This is what lands at each one.

| Tag | What it adds |
|---|---|
| `ch01` | The repo: `snip-api`, `loadgen`, `valkey`, `postgres`, `prometheus` |
| `ch02` | `snip-api-b`, and a second static target |
| `ch03` | `grafana`, the provisioning files, `snip-red.json` |
| `ch04` | `catalog` and its three bugs; `docs/type-census.md` |
| `ch05` | `snip/metrics.go` — five metric families of your own |
| `ch06` | `exercises/ch06-predictions.txt` and the rate workbench row |
| `ch07` | `docs/cardinality-budget.md`, the `route` label |
| `ch08` | `snip-worker` and its job |
| `ch09` | The ratio panel, rewritten to stop lying |
| `ch10` | Histogram buckets, the heatmap, the quantile panels |
| `ch11` | The version row and the spike-recovery panel |
| `ch12` | `edge`, `docker_sd_configs`, host port 8000 gone |
| `ch13` | `snip-red.json` rebuilt: variables, `$__rate_interval` |
| `ch14` | `snip-red-BROKEN.json` and the audit sheet |
| `ch15` | `prometheus/rules/snip-recording.yml` |
| `ch16` | `snip-alerts.yml` and the `alerting:` block |
| `ch17` | `alertmanager`, `pager`, and the routing tree |
| `ch18` | `rules/tests/`, `make test-rules`, the CI workflow |
| `ch19` | `meta-alerts.yml`, the runbooks, `ALERT-REVIEW.md` |
| `ch20` | `docs/SLO.md`, `snip-slo.json`, `fixtures/history.om`, 45-day retention |
| `ch21` | `snip-burnrate.yml`, the Sloth and Pyrra fixtures |
| `ch22` | `node-exporter`, `cadvisor`, `postgres-exporter`, `snip-use.json` |
| `ch23` | `blackbox-exporter`, `redis-exporter`, `blackbox/config.yml` |
| `ch24` | `scenario-cardinality.sh`, `sample_limit`, `label_limit` |
| `ch25` | `meta-recording.yml`, `meta.json`, `snapshot.sh`, retention moved into `prometheus.yml`, port 9090 gone |
| `ch26` | `compose.scale.yaml` and `prometheus-b` |
| `ch27` | `k8s/` — a parallel lab; `compose.yaml` untouched |
| `ch28` | `snip/otelmetrics.go`, `SNIP_OTEL=1`, the OTLP receiver |
| `ch29` | `compose.signals.yaml`, Tempo, Loki, Alloy, exemplars |

## Platform notes

**State lives in named volumes, never in bind mounts.** A bind mount crosses a
filesystem boundary the TSDB's file locking does not survive, so `promdata` and
`grafanadata` are named volumes and config is bind-mounted read-only. Postgres
18 keeps data in a version subdirectory and refuses to start if it finds a
volume at the old `/var/lib/postgresql/data` path, so the lab mounts the
parent, `pgdata:/var/lib/postgresql`. Tutorials written before 2025 teach the
old path.

**`node_exporter` under Docker Desktop measures the virtual machine.** On macOS
and Windows your containers run inside a LinuxKit VM, so the disks, memory and
CPUs it reports are the VM's, not your laptop's. The lab mounts `/:/host:ro`
without the usual `rslave` option, which Docker Desktop rejects outright — and
a rejected mount aborts the whole `up`.

**cAdvisor asks the most of its host**: `privileged: true`, five read-only
mounts, and the `/dev/kmsg` device. It runs with `--docker_only=true`, which is
what makes it behave on Docker Desktop. On Colima, Rancher Desktop and rootless
Docker, `/dev/kmsg` fails container creation; cAdvisor is also the first image
to check if a pull fails on Apple Silicon.

**Compose v2 conventions.** No top-level `version:` key — obsolete, and Compose
warns about it — and no `container_name:` anywhere, because a fixed name makes
`--scale` impossible and Chapter 12 needs `--scale snip-api=4`.

!!! warning
    `make up` refuses to run when the repository has the chapter tags and you
    are not standing on one, because `main` is the finished chapter 29 stack:
    different services, different ports, no `localhost:8000`. It prints the
    fix, and `make up FORCE=1` proceeds anyway.

    Run `make doctor` before the first `make up`. Four of the lab's host ports
    are popular elsewhere — 3000 with several web frameworks, 8080 with Tomcat
    and Jenkins, 9090 with Cockpit, 5001 with the macOS AirPlay Receiver — and
    a collision aborts the entire stack with an error naming a number and no
    service.

Budget about 3 GB of free memory for the base stack through Chapter 11, about
6 GB for the full stack, and about 10 GB of disk. On macOS and Windows what
matters is the memory Docker gives its VM, which is commonly less; `make
doctor` reads it.
