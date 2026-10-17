# Appendix G — The `promtool` Cookbook

`promtool` is the command-line half of Prometheus. It ships inside the same
container image as the server, at `/bin/promtool`, so the lab already has it and
there is nothing to install. It parses configuration, lints it, unit-tests
rules, reads exposition text, queries a running server, and reads and writes
TSDB blocks — and most of that it does offline, against files, with every
container stopped.

This appendix collects every use the book makes of it. Each recipe gives the
command as the lab runs it, what a pass looks like, and what a failure looks
like. Everything here is for `quay.io/prometheus/prometheus:v3.13.1`, the pin in
`lab/compose.yaml`.

## The two invocations everything else is built on

The image's `ENTRYPOINT` is the server binary, so a plain `docker compose run
prometheus …` starts a Prometheus and ignores whatever you typed. Every call
overrides the entry point. There are two shapes, and `lab/Makefile` keeps both:

```text
PROMTOOL    := $(COMPOSE) run --rm --no-deps -T \
                 --entrypoint /bin/promtool prometheus
PROMTOOL_SH := $(COMPOSE) run --rm --no-deps -T \
                 --entrypoint /bin/sh prometheus -c
```

`--rm` throws the container away afterwards, `--no-deps` keeps the rest of the
stack from starting, and `-T` turns off the TTY so output and input pipe
cleanly.

!!! pitfall "The glob that expands in the wrong place"
    Use the second shape whenever an argument contains a `*`. `/bin/promtool` is
    not a shell, so it receives the literal string `/etc/prometheus/rules/*.yml`
    and reports that no such file exists — while your own shell, if it expands
    the glob first, hands over *host* paths the container cannot see. Either way
    you get a confusing error about a file you are looking straight at. Route
    globs through `/bin/sh -c` so they expand inside the container.

Paths are container paths. `compose.yaml` mounts `./prometheus` read-only at
`/etc/prometheus` and `./fixtures` at `/fixtures`, so
`lab/prometheus/rules/snip-alerts.yml` on your disk is
`/etc/prometheus/rules/snip-alerts.yml` to the tool.

## `check config`

```bash
docker compose run --rm --no-deps -T \
  --entrypoint /bin/promtool prometheus \
  check config --lint=all /etc/prometheus/prometheus.yml
```

`make check` ends with exactly this. A pass looks the way Chapter 12,
"`prometheus.yml` in Full: Service Discovery and Relabeling", prints it:

```text
Checking /etc/prometheus/prometheus.yml
 SUCCESS: /etc/prometheus/prometheus.yml is valid prometheus config
 file syntax
```

The command also follows `rule_files` and checks every file that glob matches,
which is the reason to run it *inside* the container: from your host,
`/etc/prometheus/rules/*.yml` resolves to nothing, the config still validates,
and the link between the config and the rules goes unchecked in silence.

A lint finding looks like this, and the run still exits `0`:

```text
  FAILED: too long scrape interval found, data point will be marked
  as stale - job: slow, interval: 5m
```

| Flag | What it does |
|---|---|
| `--lint` | `all`, `duplicate-rules` (default), `none`, `too-long-scrape-interval` |
| `--lint-fatal` | turns any finding into exit code 3 |
| `--syntax-only` | parse only, skip the semantic checks |
| `--agent` | validate a configuration for agent mode |

Add `--lint-fatal` in CI. Advisory findings that nobody fails on are findings
nobody reads.

## `check rules`

```bash
docker compose run --rm --no-deps -T \
  --entrypoint /bin/sh prometheus \
  -c 'promtool check rules /etc/prometheus/rules/*.yml'
```

The lab's finished state is five files and forty-two rules:

```text
Checking /etc/prometheus/rules/meta-alerts.yml
  SUCCESS: 10 rules found
Checking /etc/prometheus/rules/meta-recording.yml
  SUCCESS: 3 rules found
Checking /etc/prometheus/rules/snip-alerts.yml
  SUCCESS: 3 rules found
Checking /etc/prometheus/rules/snip-burnrate.yml
  SUCCESS: 4 rules found
Checking /etc/prometheus/rules/snip-recording.yml
  SUCCESS: 22 rules found
```

Break one — misspell `record:` as `recrod:` — and it names the file and the
offending line instead. The exact wording comes from the YAML parser and varies
with what you broke; what matters is the word `FAILED` and the non-zero exit,
which stops `make check` before you ever run `make reload`. Chapter 15,
"Recording Rules", makes you do it once on purpose.

`check rules` takes `--lint` with `all`, `duplicate-rules` or `none` — there is
no scrape interval in a rule file — plus `--lint-fatal`. Given no file
arguments it reads a rule file on standard input.

## `check healthy`

This one talks to a running server. Its `--url` defaults to
`http://localhost:9090`, which is why `compose.yaml` can use it as the
Prometheus container's own health check with no arguments at all:

```yaml
    healthcheck:
      test: ["CMD", "/bin/promtool", "check", "healthy"]
```

That is what puts `(healthy)` beside Prometheus in `make ps`, first seen in
Chapter 1, "Ten Minutes to Your First Metric". Docker judges it by the exit
status alone, and so should you.

From a throwaway container, `localhost` is that container, so name the service:

```bash
docker compose run --rm --no-deps -T \
  --entrypoint /bin/promtool prometheus \
  check healthy --url http://prometheus:9090
```

`check ready` takes the same flags and asks the other question: healthy means
the process is alive, ready means it will answer queries. A server replaying a
large write-ahead log is healthy and not ready.

## `check metrics`

This one reads exposition text on **standard input**, so it lints anything you
can `curl` — including a target Prometheus has never scraped:

```bash
curl -s http://localhost:8081/metrics \
  | docker compose run --rm --no-deps -T \
      --entrypoint /bin/promtool prometheus check metrics
```

`--extended` adds a cardinality analysis of what it has read; `--lint` takes
`all` or `none`.

Be clear about what it can and cannot see, because `catalog` — the deliberately
mis-instrumented service on port 8081 — is the perfect demonstration. The lint
checks *conventions*: naming, suffixes, units in names, the agreement between a
declared `# TYPE` and the name in front of it. It reads one scrape's text, and
two of `catalog`'s three planted bugs are invisible in one scrape's text:

- `catalog_items_processed` is declared a gauge and named like a gauge. Only
  the fact that it climbs forever makes it a counter, and a single sample
  cannot show you that.
- `catalog_request_duration_seconds` is named in seconds and observed in
  milliseconds. The name is conventional; the arithmetic behind it is wrong.

The third bug is the one `--extended` exists for. `catalog_lookups_total`
carries an unbounded `book_id`, and every distinct value is a line in the
exposition you piped in — 3,248 of them and climbing on a stack that has been
running a while, which Chapter 24, "Cardinality: Detonate, Diagnose, Defuse",
confronts directly.

So a clean lint means the exposition is well-formed, not that the metrics are
true.

## `test rules`

The one that matters most, and the subject of Chapter 18, "Testing Alerts Before
They Page You".

```bash
docker compose run --rm --no-deps -T \
  --entrypoint /bin/sh prometheus \
  -c 'promtool test rules /etc/prometheus/rules/tests/*.yml'
```

`make test-rules` is that line. The lab ships two test files, ten scenarios
between them, and they pass:

```text
Unit Testing:  /etc/prometheus/rules/tests/snip-alerts_test.yml
  SUCCESS
Unit Testing:  /etc/prometheus/rules/tests/snip-burnrate_test.yml
  SUCCESS
```

A failure prints what you asked for beside what the rules produced. This one is
real — it is the defect the lab's own build gate caught in
`snip-alerts_test.yml`:

```text
FAILED:
  expr: "job:snip_sli_valid:rate5m{job=\"snip-api\"}", time: 40m,
      exp: {job="snip-api"} 0E+00
      got: {__name__="job:snip_sli_valid:rate5m", job="snip-api"} 0E+00
```

Read it as the lesson it is: a **bare selector keeps `__name__`**, so the
expected label set has to name the series. Write `> bool 0.85` instead and the
metric name is dropped, and the bare form becomes correct. Two neighboring
assertions in that same file are written the other way for exactly that reason.

Top-level fields are `rule_files`, `evaluation_interval` (default `1m`),
`group_eval_order`, `fuzzy_compare` (default `false`, weakens floating-point
equality by the last bit of the mantissa) and `tests`. Inside a test:
`name`, `interval`, `input_series`, `alert_rule_test`, `promql_expr_test`,
`external_labels`, and `start_timestamp` — added in Prometheus 3.9, accepting a
Unix timestamp or an RFC3339 string, and moving the test clock off the epoch.

The `values:` expansion notation, which is where the mistakes live:

| Notation | Expands to | Samples |
|---|---|---|
| `a+bxn` | `a`, `a+b`, `a+2b`, … | n + 1 |
| `a-bxn` | `a`, `a-b`, `a-2b`, … | n + 1 |
| `axn` | `a` repeated | n + 1 |
| `1x4` | `1 1 1 1 1` | **5** |
| `1 _x3 stale` | `1 _ _ _ stale` | 5 slots |

`_` is a sample that never arrived and `stale` is an explicit staleness marker.
`n` counts the samples *after* the first, so `1x4` is five, not four.

Flags worth knowing: `--run <regex>` (repeatable) runs only the tests whose
`name` matches, `--junit <path>` writes an XML report — note that it goes on the
`test` command, before `rules` — `--debug` prints the evaluation, and `--diff`
is an experimental colored diff of expected against actual.
`lab/.github/workflows/rules.yml` runs the plain suite and then the `--junit`
one, and invokes `make test-rules` as itself rather than reimplementing it.

## `query instant` and `query range`

These need a server, and in the lab's finished state Prometheus publishes no
host port — Chapter 25, "Storage, Retention, Backups and Locking the Door", puts
it behind `edge`. Run the query from inside the Compose network and address the
service by name:

```bash
docker compose run --rm --no-deps -T \
  --entrypoint /bin/promtool prometheus \
  query instant http://prometheus:9090 'up{job="snip-api"}'
```

One line per series comes back, with its label set and its value. `query range`
adds `--start`, `--end` and `--step`; `query instant` takes `--time`. Both take
`--header` for an extra HTTP header and `-o`/`--format`, which defaults to
`promql`. Authentication goes in `--http.config.file`, not on the command line —
which is the other reason to stay inside the network rather than go through
`edge`'s basic auth. Run `query range --help` in the pinned image for the time
formats your build accepts.

There are also `query series --match`, `query labels` and `query analyze`. None
of them is faster than the expression browser when you have a browser. They earn
their keep on a CI runner or a jump host, where you do not.

## `tsdb analyze`

```bash
docker compose run --rm --no-deps -T \
  --entrypoint /bin/promtool prometheus \
  tsdb analyze --extended --limit=20 /prometheus
```

It opens the data directory and reports on one **written block**, by default the
most recent one: the block's series count, the label names with the highest
cardinality, the most common label pairs, and the label names and pairs most
involved in churn. `--extended` adds the distribution of chunks per series,
`--limit` sets how many rows each table prints (default 20), and `--match` takes
one matcher set — `--match='{job="snip-api"}'` — to aim it.

!!! trap "The report is about the past, not about now"
    Run it five minutes into a cardinality detonation and the bomb may be
    entirely absent, because the new series are still in the head and the most
    recent written block was cut before you started. On a lab that has been up
    for a few minutes there may be no block at all, and you get a complaint
    rather than a table. Check what exists first:

    ```bash
    docker compose run --rm --no-deps -T \
      --entrypoint /bin/promtool prometheus \
      tsdb list -r /prometheus
    ```

    Use `/api/v1/status/tsdb` for what is happening now; use `analyze` for what
    this has been costing all week, and for churn, which is the one thing only a
    block can tell you.

## `tsdb create-blocks-from openmetrics`

Backfill. Chapter 20, "SLIs, SLOs and Error Budgets", uses it to give the
30-day panels something to read:

```bash
docker compose run --rm --no-deps -T \
  --entrypoint /bin/promtool prometheus \
  tsdb create-blocks-from openmetrics \
  --max-block-duration=24h /fixtures/history.om /prometheus
```

`make backfill` is that command plus two guards and a `restart prometheus`. The
input is `lab/fixtures/history.om`, 40,353 lines of OpenMetrics text.
Twenty-four-hour blocks rather than the two-hour default, because the tool
re-reads the whole input file once per block.

An OpenMetrics file carries absolute timestamps, so a committed fixture is
whatever month it was generated in, forever — and `make backfill` refuses to
import blocks that retention would drop at the next compaction. Run it on a
clone that has been sitting a while and you get the staleness guard instead,
with your own fixture's age in the first line:

```text
fixtures/history.om ends 48 days ago, which is already
outside a normal retention window: most of these blocks
would be deleted at the next compaction.
Regenerate it first:  make history
```

`make history` regenerates the fixture through the pinned Python image so the
data ends now. There is a second guard for the file being absent altogether.

Success is silent enough that you should check rather than assume: `tsdb list -r
/prometheus` shows the new blocks, and the week-over-week panel from
Chapter 14, "Dashboards That Tell the Truth", stops reading *No data*.

!!! warning "Never backfill the last three hours"
    Prometheus's own documentation is blunt about it: that range may overlap the
    head block the server is still mutating. Native histograms and staleness
    markers cannot be represented in OpenMetrics at all, so they do not survive
    the trip either.

`--label` stamps a label onto everything imported, `-r`/`--human-readable` and
`-q`/`--quiet` change the reporting, and since 3.3 the input may be a pipe. Its
sibling `tsdb create-blocks-from rules` replays recording rules against a server
over `--url` for a `--start`/`--end` window; alerting rules are ignored, and
rules in one group cannot see each other's output.

## Exit codes, and the rest of the binary

Zero on success. Three when `--lint-fatal` turns a lint finding into a failure.
Non-zero otherwise — which is all a `Makefile`, a pre-commit hook or a CI job
needs to know.

| Command | Use it for |
|---|---|
| `check web-config` | files passed to `--web.config.file` |
| `check service-discovery` | why a target is missing, with no server running |
| `tsdb dump` | samples out of blocks, as text or `seriesjson` |
| `promql format` | pretty-printing a query (needs `--experimental`) |
| `push metrics` | sending a metrics file to a remote-write endpoint |

`promtool --version` prints the build you are actually running, which is the
first thing to check when a flag in this appendix is not there. Its
`--enable-feature` list is much shorter than the server's:
`promql-experimental-functions`, `promql-delayed-name-removal`,
`promql-duration-expr` and `promql-extended-range-selectors`.
