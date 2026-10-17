# Chapter 2 — What's Actually on the Wire

You have a running stack. You typed `snip_http_requests_total` into the Query
page and a row came back with a number on it, and the number went up when you
looked again. That is a real result, and it is also the last time in this book
that "a row came back" will be good enough.

Here is the problem waiting for you. Right now there is one row. In about
fifteen minutes there will be two, because you are going to start a second copy
of Snip. By chapter 10 there will be several hundred, all with the same name.
The moment there is more than one, every question you ask has to say *which
one*, and the language for saying which one is the thing this chapter teaches.
Get it wrong and you will not get an error message — you will get an answer.
The wrong answer, silently, with a plausible number on it.

So this chapter goes slowly over ground that looks like it does not need it.
What exactly is a line of text at `/metrics`, and what did Prometheus store
when it read that line? Where did `job` and `instance` come from, given that
your code never wrote them? And when a service dies, what happens to the data
it left behind — because the answer you will find on the internet is wrong for
the case that matters most.

!!! objectives "Objectives"
    After this chapter you can:

    - Read any line of a `/metrics` response and say which series and which
      sample it describes.
    - State the identity rule: two series are the same series if and only if
      their complete label sets match.
    - Write selectors with all four matchers — `=`, `!=`, `=~`, `!~` — and
      predict what each returns before you press Enter.
    - Explain why matcher regexes are fully anchored, and why a matcher
      against the empty string also selects series that lack the label
      entirely.
    - Predict what happens to a series when its target goes away, and say why
      it is not a five-minute flat line.
    - Name three labels your application code must never emit, and say who
      sets them instead.

## Where the lab is

You are at the end of chapter 1. If you need to rejoin:

```bash
cd lab
git checkout ch02
make up
```

That tag already contains the second replica this chapter adds; the edits
below are what produced it, so you can do them yourself from `ch01` instead
if you would rather. The checkout is not decoration. On the repository's
default branch Snip publishes no host port, its targets are discovered
rather than written down, and almost every command printed here answers
differently or not at all.

## Three kinds of line

Everything Prometheus knows about your service arrived as text over HTTP. Not
a binary protocol, not an agent, not a socket your framework opened — a `GET`
request answered with a body you can read. Look at the load generator's, which
is the richest thing in the lab right now:

```bash
curl -s localhost:8089/metrics | grep loadgen_requests_total
```

```text
# HELP loadgen_requests_total Total HTTP requests issued by the load
#   generator, by templated route, method and observed status code.
# TYPE loadgen_requests_total counter
loadgen_requests_total{code="200",method="GET",route="/"} 8
loadgen_requests_total{code="200",method="GET",route="/healthz"} 240
loadgen_requests_total{code="200",method="GET",route="/links/{code}"} 457
loadgen_requests_total{code="201",method="POST",route="/links"} 235
loadgen_requests_total{code="302",method="GET",route="/l/{code}"} 3652
loadgen_requests_total{code="400",method="POST",route="/links"} 5
loadgen_requests_total{code="404",method="GET",route="/l/{code}"} 188
loadgen_requests_total{code="404",method="GET",route="/links/{code}"} 23
loadgen_requests_total{code="404",method="GET",route="other"} 8
```

The order is not editorial: the code that renders that page sorts its output
by label value, `code` first, then `method`, then `route`.

A real `# HELP` line is longer than this page is wide. Where one is wrapped
here the continuation is indented, and the same convention covers any other
over-wide output in this book — including query results, which are not
sample lines. Sample lines themselves are never wrapped, in print or on the
wire.

Those numbers came from a stack that had been running about four minutes.
Yours will be larger, and the ratios between them will be close to these: the
load generator drives a fixed mix, and 80% of it is redirects.

One line of the response, before the body, is worth stopping on: it is the
only place the format announces itself.

```bash
curl -s -o /dev/null -D - localhost:8089/metrics | grep -i content-type
```

```text
Content-Type: text/plain; version=0.0.4; charset=utf-8; escaping=underscores
```

Three claims in one header. `text/plain` is the honest description: there is no
framing, no length prefix and no schema — the parser reads lines. `version=0.0.4`
is the version of the **exposition format** itself, and it has not moved in
years. `escaping=underscores` is the new one: Prometheus 3 accepts any UTF-8
string as a metric or label name, and this parameter is the exporter saying
that any name which does not fit the classic
character set has been written with underscores in this payload rather than
sent through raw. That is why nothing you scrape in this lab will ever hand
you a dotted name — and why the quoted selector form later in this chapter
has no use here until chapter 28, when a service *pushes* names that were
never escaped in the first place.

Prometheus 3 reads that header before it reads a single sample, and chapter 5,
"Your First Counter: Instrumenting Code You Own", shows you an endpoint that
gets it wrong and a whole scrape that fails because of it.

Now the body. There are exactly three kinds of line, and no fourth.

A **`# HELP` line** gives one metric name a one-sentence description. It is
documentation, written by whoever instrumented the code, and Prometheus stores
it and shows it in the Metrics Explorer. It is not free text you can ignore:
when you are looking at somebody else's service at three in the morning,
`# HELP` is the only thing standing between you and guessing. Read the one
above again and notice that it says what is counted, from whose point of view,
and what the labels mean. It does not repeat the metric name back at you.

A **`# TYPE` line** declares what kind of number this is. Here it says
`counter`. Chapter 4, "Metric Types Are Contracts", is entirely about what each
type promises and what breaks when the promise is broken; for now, take
`# TYPE` as a label on the metric that tells you what you are allowed to do
with it.

Every other non-blank line is a **sample line**, and this is the one you need
to be able to read cold:

```text
loadgen_requests_total{code="302",method="GET",route="/l/{code}"} 3652
```

Left to right: a **metric name**, `loadgen_requests_total`. Then, inside
braces, a **label set** — three labels, each a name and a quoted string value.
Then whitespace, then a **value**.

The name and the label set together pick out one **time series**. The value is
the current reading of that series. Note what is *not* on the line: a
timestamp. The exposition format allows an optional timestamp after the value,
and almost nothing uses it — client libraries, the code inside your service
that keeps the counters and renders this page, leave it off, and Prometheus
stamps the sample with the time of the scrape instead. That "almost nothing"
matters later in this chapter, so remember that the slot exists.

!!! jargon "Exposition format"
    That plain-text format is the **exposition format**: the agreed shape of a
    `/metrics` response. It is deliberately boring. Lines beginning with `#`
    that are not `HELP` or `TYPE` are comments and are ignored. Label values
    are quoted strings, and three characters inside them are escaped: `\\` for
    a backslash, `\"` for a quote, and `\n` for a newline. Values are decimal
    numbers, and `+Inf`, `-Inf` and `NaN` are all legal.

One consequence of "values are decimal numbers" surprises people who store
identifiers in metrics: every value Prometheus stores is a **64-bit float**.
Not an integer. A counter that reaches 9,007,199,254,740,993 stores as
9,007,199,254,740,992, because that is the nearest float64. You will not hit
that in this lab, and you will hit it on a large enough byte counter. There is
no integer type.

## A name plus a label set is an identity

Here is the rule the rest of this book rests on.

**Two series are the same series if and only if their metric name and their
complete label set are identical.** Not similar. Not "the same except for one
label you did not care about". Identical, label for label, value for value.

That means those nine sample lines are nine different series, permanently.
They share a name and they share a `# HELP` string, and none of that makes them
related as far as storage is concerned. Each one is its own append-only stream
of readings, with its own history, its own memory footprint, and its own
existence or non-existence.

It also means the metric name is not special. Internally, the name is stored as
a label too — a reserved one, called `__name__`. These two selectors are the
same selector, and Prometheus does not prefer either:

```promql
loadgen_requests_total{code="302"}
```

```promql
{__name__="loadgen_requests_total", code="302"}
```

Try both in the Query page. Same rows, same values. The double underscores mark
`__name__` as belonging to Prometheus rather than to you; there are a handful
of names in that namespace and you meet the rest of them in chapter 12,
"prometheus.yml in Full: Service Discovery and Relabeling". You cannot write
the name twice — `loadgen_requests_total{__name__="something"}` is a parse
error — so pick one spelling per query. The `__name__` form is what you reach
for when you want to match names by pattern, which you will do later in this
chapter.

Now the second half of the data model, which is even shorter. A **sample** is a
pair: a timestamp and a float64. That is the whole of it. When Prometheus
scrapes the load generator and reads that line, it appends one sample —
`(the time of the scrape, 3652)` — to the series
`loadgen_requests_total{code="302", method="GET", route="/l/{code}"}`. Fifteen
seconds later it appends another. A time series is that stream of pairs; a
metric name is a family name for a group of such streams; a label set is what
tells them apart.

Nothing else is stored. There is no room in a sample for a string, a stack
trace, a request ID or a customer name. That is not a limitation Prometheus
apologizes for — it is the trade that lets one laptop container hold millions
of readings and answer questions about them in milliseconds. Strings go in
*label values*, which are part of the identity, and that has a price you meet
in chapter 7, "Labels and the Cardinality Arithmetic You Must Do".

## One family, several series

Some metrics arrive as a set of related series with suffixed names. Look at the
load generator's latency metric, filtered down to its quietest route so the
numbers stay small enough to read:

```bash
curl -s localhost:8089/metrics \
  | grep -E '^# (HELP|TYPE) loadgen_request_duration|route="/"[,}]'
```

```text
# HELP loadgen_request_duration_seconds Client-observed latency of
#   load-generator requests, in seconds.
# TYPE loadgen_request_duration_seconds histogram
loadgen_request_duration_seconds_bucket{method="GET",route="/",le="0.005"} 1
loadgen_request_duration_seconds_bucket{method="GET",route="/",le="0.01"} 5
loadgen_request_duration_seconds_bucket{method="GET",route="/",le="0.025"} 8
loadgen_request_duration_seconds_bucket{method="GET",route="/",le="0.05"} 8
loadgen_request_duration_seconds_bucket{method="GET",route="/",le="0.1"} 8
loadgen_request_duration_seconds_bucket{method="GET",route="/",le="0.25"} 8
loadgen_request_duration_seconds_bucket{method="GET",route="/",le="0.5"} 8
loadgen_request_duration_seconds_bucket{method="GET",route="/",le="1"} 8
loadgen_request_duration_seconds_bucket{method="GET",route="/",le="2.5"} 8
loadgen_request_duration_seconds_bucket{method="GET",route="/",le="5"} 8
loadgen_request_duration_seconds_bucket{method="GET",route="/",le="10"} 8
loadgen_request_duration_seconds_bucket{method="GET",route="/",le="+Inf"} 8
loadgen_request_duration_seconds_sum{method="GET",route="/"} 0.0713
loadgen_request_duration_seconds_count{method="GET",route="/"} 8
```

The `[,}]` in that filter is doing real work: a bucket line ends the route
label with a comma and a `_sum` or `_count` line ends it with a brace, so
those two characters are what keep `/healthz` and `/links/{code}` out while
the first half of the pattern keeps the two comment lines in.

Fourteen lines. Fourteen series. One `# HELP`, one `# TYPE`, one name in the
Metrics Explorer. Three of those `le` values are the one place in this book
where the text on the wire is not the label value in storage; chapter 10
shows why, and until then do not type an `le` matcher from memory.

That is a **metric family**: a group of series that a client library produced
together and that mean something together, published under one name with
suffixes. Here the suffixes are `_bucket` (with an extra label, `le`), `_sum`
and `_count`. `le` is short for *less than or equal to*: each `_bucket` line
counts the requests that finished within that many seconds, and those counts
are the histogram's **buckets**. Chapter 10, "Latency: Histograms Without
Tears", is about getting a useful number out of them. What you need today is
smaller:

**The suffixed lines are not decorations on one series. They are separate
series with separate names.** `loadgen_request_duration_seconds_count` is a
metric name in its own right. You can select it, graph it and alert on it
without ever touching the buckets, and Prometheus has no idea the three of them
are siblings — that knowledge lives in the client library, in the `# TYPE`
line, and in your head.

A reader types `loadgen_request_duration_seconds` into the Query page, gets
nothing back, and concludes the metric is missing. It is not. There is no
series by that exact name: the series are `..._bucket`, `..._sum` and
`..._count`. The family name is a name for a group, not for a series.

Chapter 1 gave you the first four rungs of a debugging ladder for an empty
result. Appendix B has all twelve, and from here on the boxes in this book cite
them by number rather than repeating them.

!!! ladder "Ladder → rung 4"
    Empty result and you are sure the metric exists? Appendix B, rung 4:
    check the metric name in the Metrics Explorer rather than from memory.
    A family name with no suffix is one of the two ways a name that "has to
    exist" turns out not to.

Now count the series in that one family across the whole load generator. Six
`(route, method)` pairs, fourteen series each: eighty-four series, from one
histogram declaration in one Go file. Count them rather than believing me:

```bash
curl -s localhost:8089/metrics \
  | grep -c '^loadgen_request_duration_seconds'
```

```text
84
```

All six pairs exist from startup, so that reads eighty-four ten seconds after
`make up`. Hold the number lightly for now. Chapter 7 turns it into arithmetic
you do before you add a label, rather than after.

## Where `job` and `instance` came from

Go back to that sample line and read it again with fresh eyes:

```text
loadgen_requests_total{code="302",method="GET",route="/l/{code}"} 3652
```

Three labels. Now run the same thing through the Query page:

```promql
loadgen_requests_total{code="302"}
```

```text
loadgen_requests_total{code="302", env="lab", instance="loadgen:8089",
    job="loadgen", method="GET", route="/l/{code}"}   3652
```

Six labels. Three of them — `env`, `instance`, `job` — were not on the wire.
Nothing in the load generator's source code mentions them. They were attached
by Prometheus, at scrape time, from the scrape configuration you wrote in
chapter 1:

```yaml
  - job_name: loadgen
    static_configs:
      - targets: ["loadgen:8089"]
        labels:
          env: lab
```

`job` is the `job_name`. `instance` is the target address, host and port. `env`
is a label the scrape config attaches by hand, because the lab wants one. This
is the distinction to carry out of this chapter:

**Application labels** describe what happened inside the process: which route,
which method, which status code. Your code owns them, because only your code
knows them.

**Target labels** describe *where the process is*: which service, which copy of
it, which environment. Your code must never emit them, because your code does
not know — a container has no reliable idea what job it belongs to, what
environment it is deployed into, or what its address looks like from the
monitoring system's side.

One picture, because this is the only place the same counter appears on both
sides of a scrape at once:

```text
  on the wire, from your code        in Prometheus, after the scrape
┌─────────────────────────┐        ┌────────────────────────────────┐
│ snip_http_requests_total│  GET   │ snip_http_requests_total{      │
│                    4816 │/metrics│   env="lab",                   │
│                         │───────▶│   instance="snip-api:8000",    │
│ no labels at all        │  15s   │   job="snip-api"}   4816       │
└─────────────────────────┘        └────────────────────────────────┘
     your code wrote this            the scrape config wrote these
```

The value crossed unchanged and the label set did not. That is the whole claim:
a scrape does not only copy, it *attaches*. The diagram uses Snip rather than
the load generator because Snip's counter makes the point with no noise at all —
it carries zero labels on the wire today and three in storage. Check it
yourself:

```bash
curl -s localhost:8000/metrics | grep '^snip_http_requests_total'
```

```text
snip_http_requests_total 4816
```

Every label on that series in Prometheus was attached by the scrape. The value
will also be within a handful of the load generator's own total, because the
load generator is the only thing sending Snip traffic — plus whatever you typed
by hand in chapter 1.

One honest caveat while you have both sides in view. Nothing between this
counter and storage rewrote its value, and at this point in the lab nothing is
dropping series either — but do not read that as a law. A scrape config can
drop and rewrite series on the way in, and from chapter 12 this one does.
`curl` and the Query page can then legitimately disagree about what exists.
When they do, the scrape config is the reason — and it is a file you can read.

!!! pitfall "Emitting `job`, `instance` or `env` from application code"
    Sooner or later somebody adds `instance=os.Hostname()` or
    `env=os.Getenv("ENV")` to a metric, because it seems helpful. It is not.
    When a scraped label collides with a target label, Prometheus keeps its
    own and renames yours: your `job` arrives in storage as `exported_job`.
    Every query written against `job` now quietly misses it, every dashboard
    legend grows a second nearly-identical entry, and nobody notices for a
    month. One configuration key reverses the precedence, and chapter 12 shows
    it along with the single situation that wants it. Until then the rule has
    no exceptions: `job`, `instance` and `env` are set by whoever runs the
    scrape, never by the code being scraped — and so are `cluster` and
    `region` wherever a stack uses them, though this lab attaches `cluster` a
    different way that chapter 12 gets to.

### Making `instance` mean something

Right now `instance` is a label with one value per job, which makes it look
like decoration. Time to fix that. Open `lab/compose.yaml` and add a second
copy of Snip next to the first:

```yaml
  # ── ch2 ──────────────────────────────────────────────────────
  # A second container of the same image. It publishes no host
  # port: Prometheus reaches it over the compose network, which
  # is all anybody needs.
  snip-api-b:
    build:
      context: ./snip
      target: api
    restart: unless-stopped
    environment:
      SNIP_ROLE: api
      # …and the rest of snip-api's environment block. Every
      # default already points at a compose service name, so this
      # only matters if you have edited .env.
    depends_on:
      postgres:
        condition: service_healthy
      valkey:
        condition: service_healthy
    networks: [obsnet]
    mem_limit: 256m
```

The important line is the one that is missing. `snip-api-b` has no `ports:`
key, so nothing on your laptop can reach it directly. Prometheus does not care:
it lives on the same Compose network and dials `snip-api-b:8000` by name. A
published host port is for *you*, not for the monitoring system, and forgetting
that is how people end up exposing an internal service to their whole network
in order to graph it.

!!! trap "You cannot scale a service that publishes a host port"
    The obvious move is to skip the new service and ask Compose for two copies
    of the one you have. It does not work, and the error is worth seeing once
    (the daemon's message is one long line, wrapped here):

    ```console
    $ docker compose up -d --scale snip-api=2
    [+] Running 1/2
     ✔ Container obslab-snip-api-1  Running
     ✘ Container obslab-snip-api-2  Error
    Error response from daemon: driver failed programming external
    connectivity on endpoint obslab-snip-api-2: Bind for
    0.0.0.0:8000 failed: port is already allocated
    ```

    A host port is a single resource on a single machine. Two containers
    cannot both own `0.0.0.0:8000`, so the second one never starts. That is
    the entire reason the second replica is a separate named service here.
    Chapter 12 fixes it properly, by putting a reverse proxy in front and
    taking the published port off Snip altogether — at which point
    `--scale snip-api=4` works and `snip-api-b` is deleted.

Now tell Prometheus about it. In `lab/prometheus/prometheus.yml`, the
`snip-api` job gains a second target:

```yaml
  - job_name: snip-api
    static_configs:
      - targets:
          - "snip-api:8000"
          - "snip-api-b:8000"
        labels:
          env: lab
```

One job, two targets. There is no new job here and there should not be: `job`
answers "what service is this?" and both containers are the same service. It is
`instance` that answers "which copy?".

Bring it up. Prometheus reads its configuration once, at startup, so it needs
a restart to notice the edit — the named volume means the restart costs you no
stored data, and chapter 12 is where the server learns to reload in place:

```bash
docker compose up -d
docker compose restart prometheus
```

Open `http://localhost:9090/targets`. Four endpoints now, all reading **UP**:
Prometheus itself, the load generator, and two under `snip-api`. Then go back
to the Query page and ask for Snip's counter with no labels at all:

```promql
snip_http_requests_total
```

```text
snip_http_requests_total{env="lab", instance="snip-api:8000",
    job="snip-api"}     9412
snip_http_requests_total{env="lab", instance="snip-api-b:8000",
    job="snip-api"}     0
```

One metric name. Two series. Identical in every label but one. This is the
identity rule in front of you: change `instance` and you have a different
series, with a different history, forever.

Your second number is `0`, and that is not a fault. Nothing addresses
`snip-api-b`: the load generator sends its traffic to `snip-api` by name, and
`snip-api-b` publishes no host port for you to reach either. The series exists
anyway, reading zero, because Snip creates its counter when the process
starts rather than when the first request arrives — a design decision chapter
9 will make you grateful for. A replica nothing can reach is not much of a
replica, which is exactly why chapter 12 puts a reverse proxy in front and
lets it distribute work for real.

What matters here is not the traffic. It is that `instance` now separates two
things that were previously indistinguishable, and that you can ask for either
one.

## Asking for exactly one thing

A **series selector** is the expression that picks which series you want. You
have been writing them since chapter 1 without a name for them. The shape is a
metric name, or nothing, followed by braces containing zero or more
**matchers**:

```promql
snip_http_requests_total{instance="snip-api-b:8000"}
```

There are exactly four matcher operators. Learn all four now; every one of them
earns its place within three chapters.

| Operator | Reads as |
|---|---|
| `=` | the label is exactly this string |
| `!=` | the label is not exactly this string |
| `=~` | the label matches this regular expression |
| `!~` | the label does not match this regular expression |

Multiple matchers are combined with AND, always. There is no OR inside braces,
and matchers on the same label are legal and useful — `{code=~"4..", code!="404"}`
means "a client error that is not a 404".

Work through these against the load generator, in order, predicting each result
before you run it:

```promql
loadgen_requests_total{route="/l/{code}"}
```

Two series with the default switches: one for the successful redirects, one for
the codes that did not resolve. The `{code}` in the value is not syntax; it is
part of the string, because the label records the *templated* route rather than
the path that was requested. That is what keeps ten thousand short links from
becoming ten thousand label values, and chapter 5 is where you do it to your
own code.

```promql
loadgen_requests_total{route="/l/{code}", code!="302"}
```

The same set, minus the successful redirects.

```promql
loadgen_requests_total{code=~"4.."}
```

Every three-digit client error, on every route — four series, and this is
where regexes start paying for themselves.

```promql
loadgen_requests_total{code!~"4.."}
```

The other five: the redirect, the created link, and the three flavors of
`200`. `!~` is the one you reach for when the set you want to exclude is
easier to describe than the set you want to keep.

That is all four matchers, on real rows you can count. Now the surprise that
catches everybody.

### Matcher regexes are fully anchored

```promql
loadgen_requests_total{route=~"links"}
```

That returns **nothing**. Not "the two routes with `links` in the name".
Nothing at all.

!!! pitfall "The unanchored-regex mistake"
    Every regex in a label matcher is **fully anchored**. Prometheus evaluates
    `route=~"links"` as `route=~"^links$"`, so it only matches a label whose
    value is exactly `links` — and no route is called that. This is the
    opposite of `grep`, which is where the instinct comes from, and it catches
    everybody exactly once.

    ```promql
    loadgen_requests_total{route=~".*links.*"}
    ```

    That one returns what you wanted: the four series across `/links` and
    `/links/{code}`. Substring matching costs you two explicit `.*`.

The regex flavor is RE2, Go's engine. Two consequences: there are no
backreferences and no lookahead or lookbehind, so patterns copied from Perl or
JavaScript may fail to parse; and matching is linear-time, so a hostile pattern
cannot lock up your monitoring system. The second property is why the first
restriction exists, and it is a good trade.

One change caught out people upgrading to Prometheus 3: **`.` now matches a
newline.** In version 2 it did not. If you have a label value that can contain
a line break — an error message, most commonly — then `.*` will now match
across it, and a matcher you wrote in 2024 to catch single-line values may
suddenly catch more than you meant. If you need the old behavior, write
`[^\n]` where you used to write `.`.

### The empty string is not "no value"

This one is useful once you have been bitten by it. Try:

```promql
loadgen_requests_total{region=""}
```

Every `loadgen_requests_total` series comes back. No series in this lab has a
`region` label at all, and that is precisely why they all match.

**A matcher against the empty string also selects series that do not have the
label.** Prometheus does not distinguish "the label is present and empty" from
"the label is absent"; both are the empty string as far as matching goes. So
`{region=""}` reads as "series with no meaningful `region`", which is a real
question with a useful answer.

The negation is the one you will actually reach for:

```promql
loadgen_requests_total{route!=""}
```

That means "series that have a route", and it is how you filter out a family
member that is missing a dimension the others have. You write it for real in
chapter 10.

!!! ladder "Ladder → rungs 5 and 6"
    A selector that returns nothing is Appendix B, rung 5: strip every matcher
    off and confirm the bare name returns rows. Rung 6 is what finds the
    culprit — add them back one at a time. Two causes account for most
    failures — an unanchored regex that was never going to match, and a label
    value that has never actually occurred. Rung 7
    covers the second: Prometheus cannot tell you about a combination your
    application has never produced.

### One matcher has to mean something

You can leave the metric name off entirely. This is legal and occasionally
exactly right:

```promql
{job="snip-api"}
```

That returns every series scraped from the two Snip containers, which is a
good way to see everything a target actually publishes. Do not take a row
count for it from this page — read your own:

```promql
count({job="snip-api"})
```

Most of what it counts is Go runtime and process measurements that arrived
without anybody asking, and the figure climbs as later chapters add metrics.

What you cannot do is ask for everything:

```promql
{job=~".*"}
```

```text
parse error: vector selector must contain at least one non-empty matcher
```

The rule is exactly what the message says (the UI prefixes it with the
parameter name and the character position). At least one matcher in the
selector must be incapable of matching the empty string — otherwise you have
asked for every series in the database, including all the ones with no `job`
label, and
the answer would be the whole storage engine. `.*` matches the empty string, so
it does not count. `.+` does not, so it does:

```promql
{job=~".+"}
```

That is legal, and it means "every series that has a non-empty `job`". A metric
name in front of the braces also satisfies the rule, which is why you have
never hit this before. So does `{__name__=~"snip_.*"}`, the idiomatic way to
ask "show me the metrics my service declared" — the Go runtime series do not
carry that prefix, which is exactly why those two questions need two
expressions:

```promql
{__name__=~"snip_.*"}
```

### Names with dots in them

Since Prometheus 3, any UTF-8 string is a valid metric or label name — that is
what the `escaping=underscores` parameter on the `Content-Type` header was
quietly about. Names that fit the classic pattern `[a-zA-Z_:][a-zA-Z0-9_:]*`
are written the way you have been writing them. Names that do not — anything
with a dot, a slash or a hyphen in it — must be **quoted and written inside the
braces**. These three select the same series:

```promql
loadgen_build_info{version="1.4.0"}
```

```promql
{"loadgen_build_info", version="1.4.0"}
```

```promql
{"__name__"="loadgen_build_info", version="1.4.0"}
```

Nothing in this lab needs the quoted form yet. It exists because
OpenTelemetry's metric names are dotted — `snip.worker.jobs` and friends — and
a service that pushes them arrives in chapter 28, "OpenTelemetry and
Prometheus".

Be clear about what needs quoting, because this is where the confusion starts:
it is *names*, not *values*. That series has a dotted label value,
`1.4.0`, and needs nothing special — label values have always been arbitrary
quoted strings. Only the name on the left of the `=` is subject to the old
character rules. The support is purely additive: every selector you already
have keeps working unchanged.

## When a target goes away

Now the part that most tutorials get wrong.

Stop the second replica:

```bash
docker compose stop snip-api-b
```

Leave the Query page on the Table tab and re-run this every few seconds:

```promql
snip_http_requests_total
```

Within one scrape interval — fifteen seconds in this lab, and you can watch it
happen — the `snip-api-b` row does not go flat, does not go to zero, and does
not linger. It **disappears**. One moment there are two rows, the next there is
one. Switch to the Graph tab over the last fifteen minutes and you see the same
event drawn: the `snip-api-b` line **stops**. It does not run on flat for five
minutes.

Now ask about the target itself:

```promql
up{instance="snip-api-b:8000"}
```

```text
up{env="lab", instance="snip-api-b:8000", job="snip-api"}   0
```

That row is still there, reading `0`, and it will keep reading `0` for as long
as the container stays down. Two different behaviors from the same event.

### Staleness markers

When a scrape fails, Prometheus writes a **staleness marker** for every series
that target produced in its previous scrape. Physically it is a sample with a
particular NaN payload, which is why you can never see one through PromQL and
never need to. Its effect is what matters: **a selector that looks back and
finds a staleness marker returns nothing for that series.** Not zero. Nothing.
The series is omitted from the result entirely.

Markers get written in three situations, which are the same idea at three
scales. A target is scraped successfully but a series it used to report is gone
— that one series is marked. A scrape fails outright, so everything that target
reported last time is marked at once; this is your case. Or the target
disappears from the configuration, in which case Prometheus waits roughly two
scrape intervals first, so a target recreated straight away can win that race
and never be marked at all.

One gap in the mechanism is worth knowing about. Markers are written by a
*running* Prometheus, so if the server itself is killed without a clean
shutdown nothing gets marked, and the series that were live at that moment fall
back to the older rule the lookback delta enforces: they age out instead.

Meanwhile `up` is not produced by your application at all. Prometheus
synthesizes it for every target on every scrape attempt, writing `1` if the
scrape succeeded and `0` if it did not. A failed scrape is still a scrape: `up`
gets a fresh sample every fifteen seconds saying `0`, so it is never stale and
never disappears.

That is the whole of it. `up == 0` means "I tried and I could not reach it".
An absent series means "nothing is reporting this any more". They are produced
by two different mechanisms and they answer two different questions, which is
why chapter 16, "Alerting Rules and What Firing Actually Means", builds one
alert on each.

### The lookback delta, and the five-minute story

Somewhere in your search results is a blog post saying that a Prometheus
metric holds its last value for five minutes after the target goes away. That
statement is not invented, and it is not right either. Here is the actual
mechanism.

A selector evaluated at time *t* does not ask "what is the value now". It asks
"what is the newest sample at or before *t*". If the newest one is older than
the **lookback delta**, the series is treated as having no value at *t* and
drops out of the result. The lookback delta defaults to **five minutes** and is
set with the server flag `--query.lookback-delta`.

You can see it directly, though not from the Query page: it has no box for
this knob. Everything that page does, it does over an HTTP API at
`/api/v1/query`. `curl` posts the same expression the page posts plus one
extra parameter, the per-query override `lookback_delta`, and `jq` — the JSON
tool chapter 1 had you install — pulls the result list out of the reply.
Shrink the window to one second and ask for a healthy series:

```bash
curl -s http://localhost:9090/api/v1/query \
  --data-urlencode 'query=up{job="loadgen"}' \
  --data-urlencode 'lookback_delta=1s' | jq '.data.result'
```

```text
[]
```

An empty list — the same nothing the Table tab draws as an empty table — and
you get it almost every time you run this. The load generator is perfectly
healthy; its newest sample is somewhere between zero and fifteen seconds old,
and almost never within the last second. Drop the `lookback_delta` line and the
same query returns a row immediately. Every query you type into that box works
this way. There is no "current value" — only the most recent sample, and a
window in which you are willing to accept it.

So where does five minutes of flat line come from? From the case where a
staleness marker is *never written*. Data that arrives without a live scrape
behind it — pushed into Prometheus from elsewhere, or copied in from another
server — can stop, with no failed scrape to notice it. The lookback
delta is then the only thing that ends the series, so the last value really is
repeated at every step for five minutes and then vanishes. The blog post
described that case and generalized it to yours.

For a scraped target — which is everything in this lab, and almost everything
you will ever run — the staleness marker gets there first, and the series stops
within one scrape interval. Fifteen seconds, not five minutes.

One exception is worth knowing by name, because you will not guess it when
you hit it. A few exporters put **their own timestamps** on their sample
lines, using that optional field in the exposition format. Prometheus does not
write staleness markers for those series by default, on the grounds that the
exporter is reporting on something whose clock it does not control. Those
series age out after the lookback delta instead, exactly like pushed data. If
you need them treated like everything else, there is a per-job scrape option
called `track_timestamps_staleness` that turns marker-writing back on. You will
not need it in this lab. You will need to remember it exists the first time an
exporter's graph runs five minutes past the truth.

!!! ladder "Ladder → rung 11"
    A series that vanished while the target looks healthy is Appendix B, rung
    11. The test is the `lookback_delta` curl in this chapter: if a small
    window returns nothing but the default window returns a row, the sample is
    merely old rather than absent — which points at a timestamp-setting
    exporter, not at a failed scrape.

One practical rule falls out of all this: keep your scrape interval well under
half the lookback delta. At the lab's fifteen seconds you have enormous room.
At a three-minute interval, a single missed scrape can push the newest sample
past five minutes old, and a perfectly healthy series drops out of every query
until the next successful scrape. The fix is to scrape more often, not to raise
the lookback delta.

### Put it back

```bash
docker compose start snip-api-b
```

Within one scrape the second row is back, `up` returns to `1`, and the counter
resumes from where the container left it — which is to say, from zero, because
the process restarted. Chapter 6, "`rate()`, `increase()`, and Why Nothing Is a
Whole Number", is about what that does to your graphs.

!!! selfcheck "Self-check"
    From `lab/`, run `make verify-ch02`. It stops the second replica, checks
    the five things this chapter promised, and starts it again. Between the
    `PASS` lines it prints progress notes; the assertions are what matter:

    ```text
    == verify-ch02 ==
       expected runtime: about 2 minutes

    PASS count(up{job="snip-api"}) == 2
    PASS the second replica has its own series
    PASS up{instance="snip-api-b:8000"} == 0
    PASS the stopped replica's counter returns nothing
    PASS the replica recovers after a restart

    ch02: 5 passed, 0 failed
    ch02 OK

    restoring: docker start obslab-snip-api-b-1
    ```

    The `restoring:` line lands *after* the summary, because restarting the
    container is cleanup that runs on the way out: read the count, not the
    last line. If the first assertion fails, Prometheus has not re-read its
    configuration — check `http://localhost:9090/targets` for four endpoints.
    If instead the first line reads `PASS at least two snip-api targets
    (post-ch12 scaling)` and the third reads `PASS the target was withdrawn
    by service discovery`, the script has found a later state of the lab,
    where the target is discovered rather than written down — `up == 0` is a
    property of the hand-written target this chapter uses. The checkout at
    the top of this chapter puts you back.

## Common mistakes

**Treating a family name as a series name.** Typing
`loadgen_request_duration_seconds` and getting nothing back does not mean the
metric is absent. The series are `_bucket`, `_sum` and `_count`. The Metrics
Explorer lists what actually exists; your memory lists what you expected.

**Writing an unanchored regex.** `{route=~"links"}` returns nothing, silently,
because it is evaluated as `^links$`. There is no warning and no error — an
empty result looks the same whether you asked a precise question badly or a
badly-formed question precisely. When a `=~` matcher surprises you, wrap the
pattern in `.*` and see whether the rows appear.

**Reading an empty result as "the value is zero".** Zero means something was
measured and it was nothing. Empty means nothing is being measured — the target
is down, the label combination has never occurred, or the series went stale. A
panel that shows a blank where you expected `0` is telling you something
specific, and chapter 9, "Ratios, Arithmetic and the Series That Isn't There",
is about making it say so out loud.

**Assuming a stopped service leaves a five-minute flat line.** It does not,
for anything Prometheus scrapes. The series stops within one scrape interval.
If you are building an alert on the theory that you have five minutes of grace,
you do not.

!!! pitfall "Debugging with the wrong label spelling"
    `instance` is the target address as Prometheus dialed it, including the
    port: `snip-api-b:8000`, not `snip-api-b` and not the container name
    `obslab-snip-api-b-1`. `=` is exact, so `{instance="snip-api-b"}` returns
    nothing and looks exactly like a dead service. Copy label values out of a
    result row rather than typing them.

## Summary

A `/metrics` response is plain text with a `Content-Type` that names the
format, and three kinds of line and nothing else: `# HELP`, `# TYPE`, and
sample lines. A series is identified by its metric name — stored as the
reserved label `__name__` — plus its complete label set, and two series are the
same series only when those match exactly. A sample is a timestamp and a
float64, and that is all Prometheus stores.

Some of a series' labels come from your code and describe what happened. The
rest come from the scrape configuration and describe where the process is. You
now have two containers running the same image, distinguished in every query by
one label your application never wrote.

The durable takeaways:

- Metric name plus complete label set **is** the series identity. Adding a
  label does not annotate a series; it creates different ones.
- `__name__` is an ordinary label with a reserved name, so name matching is
  label matching.
- `_bucket`, `_sum` and `_count` are separate series that share a family name.
  The family name selects nothing on its own.
- `job`, `instance` and `env` belong to whoever runs the scrape, and so do
  `cluster` and `region` wherever a stack sets them. Application code that
  emits them gets its labels renamed with an `exported_` prefix and its
  queries quietly broken.
- All four matchers exist for a reason, matcher regexes are fully anchored
  RE2, and a selector needs at least one matcher that cannot match the empty
  string.
- A matcher against `""` also selects series lacking the label entirely.
- A scraped target that dies gets staleness markers within one scrape
  interval, and its series vanish from the result. `up` keeps reporting
  `0` because Prometheus writes it, not your service. The five-minute lookback
  delta only governs data that stops without a failed scrape behind it.

## Exercises

!!! exercise
    **1. Four ways to say one thing (warm-up).** Write four selectors that
    each return exactly the `loadgen_requests_total` series for a successful
    redirect — `route="/l/{code}"`, `method="GET"`, `code="302"` — using a
    different matcher type each time: one built around `=`, one that uses
    `!=` to exclude everything else, one with `=~`, and one with `!~`. All
    four must return one row with the same value. Note which one you would
    actually want to read again in six months.

    **2. A matcher against nothing (warm-up).** Predict first, then check:
    does `{job="snip-api", method=""}` return anything? Write down your
    prediction and your reasoning before you run it. Then explain the result
    in one sentence, and say what would change about it after chapter 5 adds
    a `method` label to Snip's counter.

    **3. Three spellings of one series (core).** Find a series whose *label
    value* contains a dot — `loadgen_build_info` is one place to look, the Go
    runtime metrics another — and select it three ways: with the metric name in
    front of the braces, with the name quoted inside the braces, and with an
    explicit `"__name__"` matcher. All three must return the same row. Then
    answer in writing: which part of that query actually required the quoted
    form, and why?

    **4. Two kinds of nothing (core).** Stop `snip-api-b` and, without looking
    back at this chapter, write half a page explaining why
    `up{instance="snip-api-b:8000"}` returns `0` while
    `snip_http_requests_total{instance="snip-api-b:8000"}` returns nothing.
    Name the mechanism behind each. Keep what you write; chapter 16 builds an
    alert on each of these and you will want to check your answer.

    **5. Time it yourself (core).** Stop `snip-api-b` again and measure. Note
    the wall clock, re-run `snip_http_requests_total` every few seconds until
    the `snip-api-b` row disappears, and write down the elapsed time. Compare
    it with the scrape interval in `lab/prometheus/prometheus.yml`, and with
    the five minutes the internet promised you.

    **6. Find the floor (stretch).** Using the `lookback_delta` query
    parameter shown in this chapter, find the smallest value for which
    `up{instance="snip-api:8000"}` reliably returns a row on ten consecutive
    attempts. Explain the number you land on in terms of the scrape
    interval, and predict — then verify — what happens to that number if you
    change `scrape_interval` to `5s` and restart Prometheus. Put
    `scrape_interval` back to `15s` and restart again when you are done:
    chapter 6's arithmetic assumes four samples a minute, and so does every
    number printed from here on.
