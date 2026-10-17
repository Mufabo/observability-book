# Appendix H — The Prometheus Certified Associate exam

The Prometheus Certified Associate is the Linux Foundation's entry-level
certification for Prometheus. The questions it asks are close to the questions
the preceding twenty-nine chapters answer — with six exceptions, which is why
this appendix exists.

Certification appendices go wrong in two ways. They map a curriculum onto
headings that were never written with it in mind, so the map quietly stops
matching the book. And they drift: the curriculum changes, the appendix does
not, and a reader studies for last year's exam. The defense against both is to
print the date, point at real headings, and say where the book and the exam
disagree.

So that is the shape here. A verified curriculum with its date on it. A map
from every published sub-competency to the chapter and section that teaches it.
Six gap-fillers for the places where the book deliberately teaches something
else, or nothing at all. Then practice questions, written against a lab you can
run.

## H.0 The exam, as the Linux Foundation publishes it

Three disclaimers first, because they change how you should read everything
below.

!!! warning "Not affiliated, not endorsed, not official"
    This book has no affiliation with the Linux Foundation or the Cloud Native
    Computing Foundation, and neither organization has endorsed or reviewed it.
    It is not an official study guide. The curriculum below is reproduced as a
    factual summary of a published syllabus; the authority is the official
    page, not this appendix.

**Curricula change, and this one has a date on it.** Everything in this section
was verified on **2026-09-18** against
<https://training.linuxfoundation.org/certification/prometheus-certified-associate/>.
Weights move, sub-competencies get renamed, formats are revised. Check that
page yourself before you book, and treat any disagreement between it and this
appendix as settled in its favor.

**Nothing here reproduces the exam.** No real question appears in this
appendix, in whole, in paraphrase, or reconstructed from fragments. Every
practice question is original, written against the lab. Study material claiming
to contain actual exam questions is either wrong or in breach of the exam's own
terms, and either way it teaches you to recognize strings rather than to answer
questions.

### The format

The PCA is **online, proctored and multiple-choice**, it runs for **90
minutes**, and the certification is **valid for two years**.

The thing to internalize is what that sentence does not say. This is not a
hands-on lab exam. Its better-known siblings — the Kubernetes administrator
and developer certifications — put you in a terminal with a cluster and a task
list, and readers who have heard about those often prepare the same way. That
preparation is misaimed. You are not asked to fix a broken `prometheus.yml`
under time pressure. You are asked to read an expression, a config fragment, or
a description of a failure, and pick the sentence that is true about it.

So while the exercises in each chapter build competence, the higher-value habit
for the exam is being able to look at `rate(x[5m])` against `increase(x[5m])`,
or `by` against `without`, or a bucket selector, and say what each returns and
why the other is wrong — in prose, without a keyboard.

The official page does not publish a passing score or a question count. This
appendix therefore does not name either. If you find a number for one of them,
find out where it came from before you plan around it.

### The five domains

The published curriculum has five domains with fixed weights. The
sub-competencies are listed as the syllabus lists them.

| # | Domain | Weight |
|---|---|---|
| 1 | Observability Concepts | 18 % |
| 2 | Prometheus Fundamentals | 20 % |
| 3 | PromQL | 28 % |
| 4 | Instrumentation and Exporters | 16 % |
| 5 | Alerting & Dashboarding | 18 % |

And the sub-competencies inside each:

| Domain | Sub-competencies |
|---|---|
| 1 | Metrics · Understand logs and events · Tracing and Spans · Push vs Pull · Service Discovery · Basics of SLOs, SLAs, and SLIs |
| 2 | System Architecture · Configuration and Scraping · Understanding Prometheus Limitations · Data Model and Labels · Exposition Format |
| 3 | Selecting Data · Rates and Derivatives · Aggregating over time · Aggregating over dimensions · Binary operators · Histograms · Timestamp Metrics |
| 4 | Client Libraries · Instrumentation · Exporters · Structuring and naming metrics |
| 5 | Dashboarding basics · Configuring Alerting rules · Understand and Use Alertmanager · Alerting basics (when, what, and why) |

PromQL is 28 % of the exam, eight points clear of the next domain and larger
than any other on its own. The book is heaviest in exactly that place, which is
worth exploiting: chapters 6 through 11 are six consecutive chapters of PromQL,
and they are the best return on study time you have.

## H.1 The competency map

Each table maps one domain's sub-competencies onto the chapter and the `##`
section that teaches it. Chapter titles are shortened where the full title
would not fit; the number is the authority. Section headings are quoted exactly
as they appear in the chapter files, so you can search for them. The fourth
column is the honest one: where the book goes past what the exam needs, and
where it goes deliberately shallower.

### Domain 1 — Observability Concepts (18 %)

| Sub-competency | Chapter | Section | Note |
|---|---|---|---|
| Metrics | 1 — Ten Minutes to Your First Metric | `## What is worth measuring` | RED is introduced here and never leaves; exam-adequate on its own |
| Metrics | 4 — Metric Types Are Contracts | `## Counter: three promises`, `## Gauge: one promise and one silence` | Deeper than the exam needs — the type *contract* framing is this book's own |
| Understand logs and events | 29 — Beyond Metrics | `## Three questions, three answers`, `## Loki, in one page` | Deliberately shallow; H.2.4 supplies the conceptual layer |
| Tracing and Spans | 29 — Beyond Metrics | `## Traces and TraceQL, in one page` | One page, plus exemplars; H.2.4 fills in parent/child and trace context |
| Push vs Pull | 1 — Ten Minutes to Your First Metric | `## Why Prometheus connects to you` | Argued, not tabulated; H.2.6 lays it out the way a question will |
| Push vs Pull | 28 — OpenTelemetry and Prometheus | `## Three roads into the same database` | Deeper than the exam needs; the three bridges are a 2026 concern |
| Service Discovery | 12 — `prometheus.yml` in Full | `## Service discovery is one idea with several sources` | Exam-adequate; the relabeling that follows is well past associate level |
| Service Discovery | 27 — What Changes on Kubernetes | `## Change one: targets become a query` | Optional chapter; useful context, not required |
| Basics of SLOs, SLAs, SLIs | 20 — SLIs, SLOs and Error Budgets | `## Good events over valid events`, `## Two SLOs for Snip` | Much deeper than the exam needs on SLI and SLO; near-silent on SLA — H.2.3 |

### Domain 2 — Prometheus Fundamentals (20 %)

| Sub-competency | Chapter | Section | Note |
|---|---|---|---|
| System Architecture | 1 — Ten Minutes to Your First Metric | `## Prometheus fetched that, on a timer` | The scrape loop end to end; exactly the exam's altitude |
| System Architecture | 17 — Alertmanager | `## Two programs, two data models` | The server/Alertmanager split, which the exam does test |
| System Architecture | 25 — Storage, Retention, Backups | `## What is actually on the disk` | Deeper than needed — head block, WAL and blocks in detail |
| Configuration and Scraping | 12 — `prometheus.yml` in Full | `## The file, top to bottom` | Exam-adequate; the global block and `honor_labels` are both here |
| Configuration and Scraping | 12 — `prometheus.yml` in Full | `## Relabeling, precisely` | Well past associate level; read it for competence |
| Understanding Prometheus Limitations | 26 — When One Prometheus Isn't Enough | `## Do you need any of this yet?` | The scaling ladder; the limits are scattered — H.2.2 collects them |
| Understanding Prometheus Limitations | 29 — Beyond Metrics | `## The bargain metrics made` | The cost/identity trade, as a design decision |
| Data Model and Labels | 2 — What's Actually on the Wire | `## A name plus a label set is an identity` | The single most exam-relevant section in the book |
| Data Model and Labels | 7 — Labels, and the Cardinality Arithmetic | `## A label value is a new series, not a new column` | Deeper than needed; the arithmetic is lightly examined |
| Exposition Format | 2 — What's Actually on the Wire | `## Three kinds of line` | HELP, TYPE and sample lines; exactly right |
| Exposition Format | 5 — Your First Counter | `## Breaking /metrics the way Prometheus 3 punishes hardest` | The `Content-Type` requirement, which the exam can ask about |

### Domain 3 — PromQL (28 %)

| Sub-competency | Chapter | Section | Note |
|---|---|---|---|
| Selecting Data | 2 — What's Actually on the Wire | `## Asking for exactly one thing` | Matchers, plus the anchored-regex surprise |
| Selecting Data | 6 — `rate()`, `increase()` | `## Four kinds of thing an expression can be`, `## The range-vector selector, and the samples actually inside it` | Instant against range vector, a standing exam favorite; read the type section first |
| Rates and Derivatives | 6 — `rate()`, `increase()` | `## rate(): the first-to-last slope, and the part that scales it up`, `## increase(), and the two and a half requests` | Extrapolation and counter resets; why `increase()` is not a whole number |
| Rates and Derivatives | 6 — `rate()`, `increase()` | `## Three functions that are not rate(), and when each is wrong` | `irate`, `delta`, `deriv`; exam-adequate |
| Aggregating over time | 11 — Joins, info metrics | `## The _over_time family` | Exactly the exam's scope; `## Subqueries` in the same chapter is past it |
| Aggregating over dimensions | 8 — Aggregation | `## What an aggregation operator actually does`, `## The grouping clause: by and without` | The core of the domain; `by` against `without` is a guaranteed question shape |
| Aggregating over dimensions | 8 — Aggregation | `## The rate-then-aggregate law` | Deeper than needed, and worth every minute |
| Binary operators | 9 — Ratios, Arithmetic | `## Arithmetic, and what it costs the metric name`, `## Comparison, and the bool modifier`, `## and, or, unless` | Vector matching, the dropped name, `bool`, set operators — all examinable |
| Binary operators | 11 — Joins, info metrics | `## group_left and group_right` | Past associate level; useful, not required |
| Histograms | 10 — Latency: Histograms Without Tears | `## What a histogram looks like on the wire`, `## Question three: histogram_quantile` | `_bucket`, `_sum`, `_count`, cumulative `le`, and the function's failure modes |
| Histograms | 10 — Latency | `## Designing buckets backwards from a question` | Deeper than needed; a working skill the exam does not reach |
| Timestamp Metrics | 14 — Dashboards That Tell the Truth | `## The Stat panel that is four minutes old` | `time()` minus a timestamp gauge, in use |
| Timestamp Metrics | 22 — Metrics From Things You Didn't Write | `## The textfile collector` | The freshness alert, worked; the convention stays implicit — H.2.5 |

### Domain 4 — Instrumentation and Exporters (16 %)

| Sub-competency | Chapter | Section | Note |
|---|---|---|---|
| Client Libraries | 5 — Your First Counter | `## What a client library actually is`, `## Construct once, at startup` | Registry, collectors, handler, and the lifecycle mistake the exam likes to test |
| Instrumentation | 5 — Your First Counter | `## Writing the families` | Counter, gauge and histogram in code you own |
| Instrumentation | 8 — Aggregation | `## Instrumenting something that is not a web server` | Past the exam's scope; the worker is where timestamps appear |
| Instrumentation | 9 — Ratios, Arithmetic | `## The series that isn't there` | Pre-initialization; deeper than needed, and load-bearing |
| Exporters | 22 — Metrics From Things You Didn't Write | `## An exporter is a translator, and that is all it is`, `## node_exporter: the host, whatever the host turns out to be` | The definition the exam wants; the Docker Desktop caveats are extra |
| Exporters | 23 — The Multi-Target Pattern | `## The exporter is a function` | Deeper than needed; multi-target is an advanced shape |
| Structuring and naming metrics | 5 — Your First Counter | `## The naming law` | `_total`, base units, suffix order, no label names inside names |
| Structuring and naming metrics | 5 — Your First Counter | `## The aggregation-honesty test` | Name against label; deeper than the exam goes |
| Structuring and naming metrics | 7 — Labels, and the Cardinality Arithmetic | `## The label-admission test` | Deeper than needed; the best habit in the book |

### Domain 5 — Alerting & Dashboarding (18 %)

| Sub-competency | Chapter | Section | Note |
|---|---|---|---|
| Dashboarding basics | 3 — Your First Dashboard | `## Three panels that are RED` | The first dashboard; exam-adequate for "basics" |
| Dashboarding basics | 13 — Dashboard Mechanics | `## A panel is a pipeline`, `## Five panel types, and four names that are gone` | Exam-adequate; the rest of the chapter is past associate level |
| Dashboarding basics | 14 — Dashboards That Tell the Truth | `## A graph is a sampled query result, not a photograph` | Well past the exam; the most useful dashboard section in the book |
| Configuring Alerting rules | 16 — Alerting Rules | `## An alerting rule is a query with a clock`, `## The ALERTS series, which is where this becomes real` | Rule structure, `expr`, labels, annotations; pending against firing |
| Configuring Alerting rules | 16 — Alerting Rules | `## for is a debounce, not a sustained-badness detector` | Examinable, and reliably misunderstood |
| Configuring Alerting rules | 18 — Testing Alerts | `## The test file, field by field` | Past the exam entirely; keep it for the work |
| Understand and Use Alertmanager | 17 — Alertmanager | `## The route tree`, `## Matchers: two quoting layers and a fully anchored regex` | Routing and match order; the core of the sub-competency |
| Understand and Use Alertmanager | 17 — Alertmanager | `## A group is a bucket, and you choose the bucket`, `## Four timers, one timeline` | Grouping is the most examinable idea here; then the four timers |
| Understand and Use Alertmanager | 17 — Alertmanager | `## Inhibition: one cause, one page`, `## Silences, and why they expire` | Both examinable; silences the more likely |
| Alerting basics | 16 — Alerting Rules | `## Symptoms, and the causes worth keeping` | Alert on symptoms — the "when and why" of the sub-competency |
| Alerting basics | 19 — What a Page Should Say | `## The five fields a page has to carry` | Deeper than needed; better writing than the exam rewards |
| Alerting basics | 21 — Burn Rates | `## Approach 6 — multiwindow, multi-burn-rate` | Far past associate level; read it after you pass |

### The readiness read

Take the map at face value and the picture is lopsided in a useful way.

**Domain 3, PromQL, is the largest slice of the exam and the place the book
over-prepares you most.** Six consecutive chapters of expression mechanics, and
a lab to run every query against. Work chapters 6 through 11 with the stack up
and the only sub-competency you have not met head-on is **Timestamp Metrics**,
which the book uses in four places without ever naming as a topic. That is
gap-filler H.2.5.

**Domain 5 is similarly over-prepared, and domain 4 nearly so.** Chapters 16
through 19 cover alerting from rule syntax to what a page should say, and
chapters 20 and 21 go so far past the exam that they are a mild distraction
from it. Chapters 3, 13 and 14 cover dashboarding well beyond "basics". Domain
4's soft spot is that naming is taught as a discipline rather than a list —
better for the work, so reread `## The naming law` in chapter 5 as a list
before you sit.

**Domain 2 has one hole, and it is a named sub-competency.** *Understanding
Prometheus Limitations* is real exam surface, and the answers are scattered
across chapters 24, 25, 26 and 29 without ever being collected. H.2.2 collects
them.

**Domain 1 is where the book is thinnest, and it is 18 % of the exam.** Three
of its six sub-competencies are under-served. *Understand logs and events* and
*Tracing and Spans* get one bridge chapter that is honest about being a bridge
— H.2.4. *Push vs Pull* is argued rather than tabulated, and a multiple-choice
question wants the table — H.2.6. And *SLAs* get a few sentences beside two
full chapters on SLIs and SLOs — H.2.3.

One more hole sits outside the domain list, because it is a component rather
than a competency: the **Pushgateway**, excluded on principle and absent from
the lab. That is a defensible editorial position and a bad exam outcome, since
the exam expects you to know how it works. H.2.1 adds the mechanics without
withdrawing the opinion.

Six holes, six gap-fillers. Everything else you already have.

## H.2 Gap-fillers — the six holes, closed

Each of these teaches something the book otherwise leaves out on purpose. Each
one says why it was left out, and why the exam wants it anyway.

### H.2.1 The Pushgateway, mechanically

**Why the book omits it.** Including the Pushgateway in `lab/compose.yaml`
would endorse it, and Chapter 22, "Metrics From Things You Didn't Write",
argues at length that it is usually the wrong answer. Nothing below withdraws
that argument. **Why the exam wants it.** It is a Prometheus-project component
with its own documentation page, so you need both what it does and why you
would decline.

**It is still usually the wrong answer.** For a batch job tied to a specific
machine — a cron job, a nightly backup, a certificate rotation — the correct
tool is node_exporter's **textfile collector**, which chapter 22 teaches in
`## The textfile collector`. Your job writes a `*.prom` file, node_exporter
serves it on its next scrape, the metric arrives carrying
`job="node-exporter"` and the host's `instance`, and `up` keeps meaning what it
has meant since chapter 1. No new target, no new port, no new failure mode.

The Pushgateway's documented niche is narrower than people remember: capturing
the outcome of a **service-level** batch job, meaning one whose identity is the
service rather than the host that happened to run it, and which therefore
should carry no `instance` label. Version 1.11.3 is current, it listens on port
**9091**, and it is deliberately absent from this lab.

**How metrics get in.** You `POST` or `PUT` exposition-format text to a path
that encodes the job name and any additional grouping labels:

```text
/metrics/job/<JOB_NAME>{/<LABEL_NAME>/<LABEL_VALUE>}
```

That whole path is the **grouping key**, and it is the unit everything else
operates on. A `PUT` replaces every metric under that exact key. A `POST`
merges, replacing only the metrics whose names appear in the body. Two
different grouping keys are wholly independent.

```bash
cat <<'EOF' | curl --data-binary @- \
  http://pushgateway:9091/metrics/job/backup/db/customers
# HELP backup_last_success_timestamp_seconds Unix time.
# TYPE backup_last_success_timestamp_seconds gauge
backup_last_success_timestamp_seconds 1785500000
EOF
```

That push lands under the grouping key `job="backup", db="customers"`, so a
second database pushing to `/metrics/job/backup/db/orders` neither overwrites
it nor merges with it.

**Why `honor_labels: true` is not optional.** By default, Prometheus overwrites
any `job` and `instance` a target exposed with the scrape job's own values,
moving the originals to `exported_job` and `exported_instance`. Chapter 12,
"`prometheus.yml` in Full: Service Discovery and Relabeling", teaches that
default and the flag that reverses it. For the Pushgateway the default is
backwards, because the pushed `job` is the real one:

```yaml
scrape_configs:
  - job_name: pushgateway
    honor_labels: true
    static_configs:
      - targets: ['pushgateway:9091']
```

Omit it and every series from every batch job arrives labeled
`job="pushgateway"`. The result looks plausible, queries cleanly, and is
useless. This is the single most common Pushgateway misconfiguration.

**Why metrics outlive the job.** The Pushgateway never forgets. A series pushed
once is served to Prometheus forever, until somebody deletes it by hand. There
is no time-to-live and there will not be one: the maintainers declined it
deliberately, because expiry would make the gateway feel safe for the things it
is not for. A decommissioned job leaves a permanently frozen value behind, and
a renamed one leaves its old name behind too.

```bash
curl -X DELETE \
  http://pushgateway:9091/metrics/job/backup/db/customers
```

That deletes one grouping key. Wiping everything needs the admin API, off
unless the gateway was started with `--web.enable-admin-api`. Note the inverse
hazard too: without `--persistence.file`, a container restart silently empties
the gateway. The same component forgets too little and too easily, depending on
which failure you meet first.

**What it gives you to alert on.** The gateway attaches `push_time_seconds` and
`push_failure_time_seconds` to every group — Unix timestamps of the last
successful and last failed push. Those are what you alert on, because `up`
cannot help you here:

```promql
time() - push_time_seconds{job="backup"} > 25 * 3600
```

**The four standard objections**, which are the examinable part:

| Objection | What it costs you |
|---|---|
| Single point of failure | Route many jobs through one gateway and one box's death blinds all of them |
| You lose `up` | Prometheus reports health for the *gateway*, so "job is down" and "job has not pushed yet" become the same reading |
| Metrics live forever | No expiry; a dead job's last value is served indefinitely and alerts on nothing |
| The instance dimension flattens | A group with no `instance` in its key comes out with `instance=""` — correct for service-level jobs, and a loss of per-host attribution for anything else |

!!! pitfall "The gateway that is really a StatsD"
    The failure mode is not using the Pushgateway; it is pointing long-lived
    services at it because pushing felt easier than exposing a port. That
    discards target health for your whole estate and puts it behind one shared
    failure domain. Push is not forbidden in 2026: remote write in Chapter 26
    and the OTLP receiver in Chapter 28, "OpenTelemetry and Prometheus", are
    both genuinely push-shaped and both legitimate. Neither is this.

### H.2.2 What Prometheus is not for

**Why the book omits it.** There is no "what Prometheus cannot do" chapter,
because the limits surface where they bite: in chapter 7 when you count series,
in chapter 24 when they detonate, in chapter 25 when the disk fills, in chapter
26 when one server is not enough. **Why the exam wants it.** *Understanding
Prometheus Limitations* is a named sub-competency, asked as a set of yes/no
judgments rather than as a narrative.

Six limits, and what each one means.

**It is not durable long-term storage on its own.** Local retention is finite
and configured, the storage belongs to one server, and the server replicates
nothing. Chapter 25, "Storage, Retention, Backups and Locking the Door", covers
`## Retention, the way that works now` and honest backups; Chapter 26, "When
One Prometheus Isn't Enough: HA, `remote_write`, and the Scaling Map", covers
shipping the data somewhere whose job is to keep it.

**It is not a billing or auditing system.** Understand this one mechanically.
Prometheus *samples*: it reads a counter's current value every scrape interval
and stores that reading, and it never observes what happened between readings.
A failed scrape loses a sample outright, and `rate()` and `increase()`
compensate by extrapolating across the window — correct for a trend,
unacceptable for a number somebody is charged for. Chapter 6, "`rate()`,
`increase()`, and Why Nothing Is a Whole Number", shows why `increase()`
returns 2.5 requests. If money or compliance depends on the count, count it
somewhere transactional.

**It is not for per-event or per-request records.** Identity is discarded at
write time, as Chapter 29, "Beyond Metrics: Exemplars, Traces, Logs, and Where
to Go Next", states in `## The bargain metrics made`. Once an observation lands
in a bucket, nothing recovers which request it was. That is not a gap to
engineer around; it is the property that makes the cost curve flat.

**It is not for high-cardinality unique identifiers.** User IDs, request IDs,
trace IDs, email addresses, full URLs. Each distinct value is a whole new time
series with its own index entries and its own memory. Chapter 7, "Labels, and
the Cardinality Arithmetic You Must Do First", gives the arithmetic; chapter 24
detonates it on purpose.

**There is no cross-service transactional consistency.** Two targets are
scraped by two independent loops at two different instants, so a query dividing
one service's counter by another's divides readings taken up to a scrape
interval apart. For rates over minutes that is immaterial. For anything that
must balance exactly it is wrong, and no query rewrite fixes it.

**It is single-node by default.** One server holds the data, evaluates the
rules and answers the queries, and its restart is not instant — it replays the
write-ahead log first. Chapter 26's `## Do you need any of this yet?` is the
ladder out, and its point is that the trigger for climbing is blast radius
rather than ingestion rate.

!!! note "The shape of the exam question"
    These are usually asked as "which of the following is Prometheus a poor fit
    for?" with one clearly-wrong distractor, one plausible-but-fine use, and two
    that are genuinely arguable. The discriminator is nearly always sampling or
    cardinality. If the scenario needs every event, or needs a unique ID as a
    dimension, the answer is that Prometheus is the wrong tool.

### H.2.3 SLA versus SLO versus SLI

**Why the book is thin here.** Chapter 20, "SLIs, SLOs and Error Budgets", and
chapter 21 are two full chapters on measuring and defending an objective, and
the lab's Snip service has no contract with anyone. SLAs are a commercial
instrument, so they get a jargon box and a short `SLO is not SLA` subsection.
**Why the exam wants it.** The sub-competency names all three, and the
distinction is conceptual rather than technical — easy to write a question
about.

The three form a stack, each resting on the one below.

An **SLI**, a service level *indicator*, is a number you measure. Chapter 20
gives it one canonical shape: good events over valid events. The proportion of
redirects that did not return a `5xx`. The proportion that completed in under
300 ms. It is a measurement and nothing else — no opinion, no threshold.

An **SLO**, a service level *objective*, is a target for that number over a
window. "99.5 % of valid `GET /l/{code}` requests do not fail, over a rolling
30 days." It is internal. Nobody outside the team agreed to it, and the only
thing it moves is your own decisions about what to ship. Its consequence is the
**error budget**: the amount of failure the objective permits, which chapter 20
turns into 216 minutes and chapter 21 turns into alerts.

An **SLA**, a service level *agreement*, is the third leg and the one the book
mostly leaves alone. **It is a contract with consequences.** Somebody outside
the team signed it, and falling below the number triggers something
commercial — service credits, a refund, a penalty clause, in extreme cases a
right to terminate. The number in an SLA is a legal position, not an
engineering one, and it usually arrives from a sales conversation rather than
from a histogram.

That difference drives the two rules the exam tests.

**The SLO sits inside the SLA, with margin.** If the contract promises 99.9 %,
the internal objective is stricter — 99.95 %, say. The reason is operational
rather than conservative: you want to exhaust your *internal* budget while
there is still contractual room to react, so the conversation about slowing
down happens between engineers rather than on a call with a customer. An SLO
equal to the SLA gives no warning at all, and an SLO looser than the SLA is a
mechanism for breaching a contract on schedule.

**Alert on the SLO, never on the SLA.** By the time the SLA number is in
danger the money has effectively moved, so an alert there reports a loss rather
than preventing one. Chapter 21's multiwindow burn-rate alerts fire on the
internal budget, at several speeds, so that a slow burn is caught days before
either number is threatened.

| Leg | SLI | SLO | SLA |
|---|---|---|---|
| What it is | A measurement | An internal target | An external contract |
| Agreed with | Nobody | Your team | A customer |
| Missing it costs | Nothing | Budget spent, ship slower | Credits, penalties, termination |

### H.2.4 Logs, events, traces and spans

**Why the book is thin here.** Chapter 29 is explicitly a bridge, not a
treatment: a working exemplar demo, one page on Tempo, one page on Loki, and a
refusal to become a tracing tutorial. **Why the exam wants it.** Three of
domain 1's six sub-competencies are about signals that are not metrics, which
is roughly 9 % of the exam sitting in one chapter's worth of bridge.

A **log line** is a timestamped record of something that happened, emitted by
your code as it ran. Unstructured logs are text; structured logs are key/value
records, usually JSON, which is the form worth emitting because it can be
filtered without regular expressions. The defining property is that a log line
is *per occurrence* — a thousand requests produce a thousand lines.

An **event** is the same idea with more discipline: one structured record per
unit of work, carrying everything known about that unit, emitted once when the
work completes. Logs narrate; an event describes a whole transaction in one
wide record. Chapter 29's `## Three questions, three answers` covers the
argument that events, rather than three separate signals, are the right
primitive.

A **trace** is one request's journey through a distributed system. It is not a
different kind of log; it is a tree.

A **span** is one node in that tree: a named operation with a start time, an
end time, a status and a bag of attributes. The root span covers the whole
request. Its children are the individual pieces of work — the database query,
the cache lookup, the outbound call to another service. Each span carries its
own identifier and its parent's, and that **parent/child relationship** is what
turns a pile of timings into a causal chain. A span with no parent is a root.

**Trace context** is how the relationship survives a network hop. The W3C
standard defines a `traceparent` header carrying the trace ID, the current span
ID and flags; a service receiving it creates its child spans under that ID and
passes its own context onward. Without propagation you do not have a
distributed trace — you have several unrelated single-service traces that
happened at the same time.

**When each signal answers something metrics cannot.** The test is whether the
question is about *how often* or about *which one*. Metrics answer how often,
how long, how many — cheaply, continuously, over months. The moment the
question becomes "which customer", "was it the same 2 % each time", or "which
downstream call ate the four seconds", identity is required, and metrics
discarded identity at write time.

**The cost curves are why these are different systems.** A counter costs the
same at ten requests per second as at a hundred thousand; the bill is set by
the shape of the label set. Logs cost per line. Traces cost per span. That is
why trace stores sample — keeping one request in a hundred — and why a sampled
store cannot then produce a rate or an error budget, because it holds anecdotes
rather than a census. It is also why Loki indexes only stream labels and greps
the compressed lines at query time: the cardinality physics of chapter 7,
applied to a different signal.

!!! note "The connection the exam may ask about"
    An **exemplar** is the supported bridge from a metric to a trace. It
    attaches a reference — canonically a trace ID — to one specific sample of a
    counter or histogram bucket. It is not a label: it does not participate in
    series identity and creates no new series, which is the entire reason the
    feature exists. Chapter 29 demonstrates it end to end.

### H.2.5 Timestamp metrics

**Why the book is thin here.** Timestamps appear in four chapters as a
technique rather than a topic — a Stat panel in chapter 14, a backup freshness
alert in chapter 22, a certificate expiry alert in chapter 23, a rule-engine
lag check in chapter 15. **Why the exam wants it.** *Timestamp Metrics* is a
named sub-competency of the largest domain, and the two functions involved are
easy to confuse.

**`time()` returns the evaluation timestamp** as a scalar: the Unix time, in
seconds, at which the expression is being evaluated. It is not "now" in any
wall-clock sense — inside a range query it is the timestamp of each step.

**`timestamp()` returns each sample's own timestamp** as that sample's value.
It takes an instant vector and hands back an instant vector with identical
labels and a Unix time in place of every value. Chapter 15, "Recording Rules",
uses it to measure how far behind the clock a recorded series is:

```promql
time() - timestamp(job:snip_http_requests:rate5m)
```

Chapter 26 uses it to ask two Prometheus servers how fresh their newest `up`
sample is, which is a question about sample age rather than about any value.

**The `*_timestamp_seconds` convention** is the third piece. A metric whose
name ends that way is a gauge whose value is a Unix timestamp in seconds. The
lab has two:

```text
snip_worker_last_success_timestamp_seconds{queue="expiry"}
obslab_backup_last_success_timestamp_seconds
```

The first is chapter 8's background worker, recording when each queue last
completed a job successfully. The second is chapter 22's batch job, written
into a `*.prom` file and served by node_exporter's textfile collector. Both
obey chapter 5's naming law — `_seconds` is the unit, and a gauge carries no
type suffix, so the name ends there.

**The canonical staleness alert** subtracts one from the other:

```promql
time() - snip_worker_last_success_timestamp_seconds > 600
```

Read it as "more than ten minutes have passed since this queue last succeeded."
Chapter 22's version of the same shape watches a nightly backup at 86400
seconds. What makes the pattern good is that two different failures produce the
same alert: a job that ran and failed leaves the old timestamp in place, and a
job that never started does the same. Both make the number climb.

Watch the direction. A timestamp in the *future* subtracts the other way, which
is why chapter 23's certificate alert reads
`probe_ssl_earliest_cert_expiry - time()`. Reversed operands produce a large
negative number that no threshold catches.

**Why a Unix-timestamp gauge beats a "seconds since" gauge.** The tempting
alternative is to have the application compute the age itself and export a
gauge holding the number of seconds since its last success. Do not. That gauge
is correct only at the instant the application last updated it, and the failure
it exists to catch is precisely the one where the application has stopped
updating anything. A process that hangs freezes its age gauge at whatever it
last wrote — a small, healthy-looking number — and the alert never fires. The
same hang freezes a timestamp gauge too, but `time()` keeps moving, so the
subtraction climbs and the alert fires on schedule. The arithmetic belongs at
query time, where the clock is Prometheus's rather than the process's.

Two smaller reasons reinforce it. A timestamp gauge holds the same value at
every scrape between events, which compresses to almost nothing, while an age
gauge changes at every scrape and stores a fresh sample each time. And a
timestamp is absolute, so it survives being aggregated with `max by`, compared
against another server's reading, or read back months later — none of which is
true of a relative age.

### H.2.6 Push versus pull, as the exam frames it

**Why the book is thin here.** Chapter 1 argues the pull model in prose, well,
but as an argument rather than a comparison. **Why the exam wants it.**
*Push vs Pull* is a named sub-competency, and a multiple-choice question about
it is a question about which column a property belongs in.

Prometheus pulls: it opens the connection, on its own schedule, to targets it
was told about. A push system inverts that — the process sends measurements
outward to a collector on its own schedule.

| Property | Pull | Push |
|---|---|---|
| Target health | `up` is free, generated per target per scrape | A silent sender is indistinguishable from one with nothing to say |
| Source of truth | The scrape config enumerates what should exist; absences are visible | The collector knows only about senders that appeared |
| Load control | The scraper sets the request rate; a struggling fleet cannot flood it | Senders set the rate; an incident can produce a thundering herd |
| Local debugging | `curl` the endpoint and see byte for byte what Prometheus sees | The payload lives inside an agent or a queue |
| Short-lived jobs | A job that exits in nine seconds has no page to scrape | Natural fit — the job pushes before it exits |
| NAT and firewalls | The scraper must be able to reach the target | Works wherever outbound traffic is permitted |
| Event-driven loads | Fixed-interval sampling misses what happens between scrapes | Sends when something happens |

Where each breaks is the second half of the question.

**Pull breaks** on things that are not reachable and things that are not alive
long enough to be reached. A batch job that runs for nine seconds and exits
never overlaps a scrape; a service behind a firewall permitting only outbound
connections cannot be scraped at all. The answers are the textfile collector
for machine-bound jobs, the Pushgateway for service-level batch jobs with its
four objections attached, and a proxy such as PushProx for the firewall case.

**Push breaks** on the things pull gets for free. There is no `up`, so silence
is ambiguous. There is no enumerated target list, so a service that was never
deployed and one that died look identical. The collector becomes a shared
failure domain and a bottleneck. And backpressure inverts: the moment your
fleet is in trouble is the moment it sends the most data.

The honest 2026 position is that Prometheus is no longer purely one or the
other. `remote_write` pushes data out of a server and the OTLP receiver accepts
data pushed into one; chapters 26 and 28 build both, and neither is the
Pushgateway. What has not changed is the scrape loop at the edge, and with it
the two properties that make the pull model worth defending: you always know
what *should* be there, and you always know whether it answered.

## H.3 Practice questions

Eighty questions, distributed by the published domain weights so that the
practice has the same shape as the exam. Four options each, one correct,
single-select — the format the PCA uses.

None of these is an exam question, and none is reconstructed from one. They are
written against the preceding chapters and against the lab, which is the point:
where a question names a metric, the metric is one your stack is exporting
right now, so you can settle an argument with yourself by running the query.
Where a question prints a result, it is a result this lab produces.

The wrong answers are the part worth taking seriously. Every distractor is a
belief somebody holds — drawn from the ranked list of where beginners actually
fall over. If a distractor looks tempting, that is
the question working. If you pick one, the answer in H.4 tells you which
chapter to reread rather than telling you that you were wrong.

Ten questions are marked **(harder than the exam)**. The book goes deeper than
associate level in those places, and missing one is not a signal that you are
unprepared. Work through H.3 with H.4 covered. Write your answers down; a
guess you did not commit to is a guess you cannot grade.

### Domain 1 — Observability Concepts (14 questions)

**1.** A container serving one of your targets is stopped. What do you see in
Prometheus a minute later?

- **A** `up` for that target reads `0`, and the target's own series disappear
  from query results.
- **B** `up` disappears along with every other series the target produced.
- **C** The target's counters flat-line at their last value for five minutes,
  then stop.
- **D** The target's counters drop to `0` and stay there.

**2.** A nightly backup runs on one specific host, takes about forty seconds,
and exits. You want its outcome in Prometheus. What is the right mechanism?

- **A** node_exporter's textfile collector.
- **B** The Pushgateway, because the job exits before a scrape can reach it.
- **C** A shorter scrape interval, so a scrape lands while the job is running.
- **D** `remote_write` from the backup script.

**3.** A contract with a customer promises 99.9 % availability. What should the
team's internal availability objective be?

- **A** Stricter than the contract — 99.95 %, say.
- **B** Identical to the contract, 99.9 %, so the two never disagree.
- **C** Looser than the contract, 99.5 %, to leave engineering room.
- **D** There should be no internal objective; alert on the contract number.

**4.** Which of these is a service level indicator?

- **A** The proportion of valid redirect requests that did not return a `5xx`.
- **B** 99.5 % availability over a rolling 30 days.
- **C** 216 minutes of permitted failure per 30 days.
- **D** A clause awarding service credits when availability falls below 99.9 %.

**5.** What makes several services' spans part of one distributed trace?

- **A** A `traceparent` header carrying the trace ID and the caller's span ID
  across each network hop.
- **B** Each service mints its own trace ID; the backend correlates them by
  timestamp.
- **C** A Prometheus label attached to the spans at scrape time.
- **D** The collector assigns a shared trace ID when the spans arrive.

**6.** A span arrives with no parent span ID. What is it?

- **A** The root span — the one covering the whole request.
- **B** An orphan, which the trace store discards.
- **C** An error; every span must have a parent.
- **D** A span emitted by a service that was never instrumented.

**7.** Your latency histogram says 2 % of redirects were slow. Someone asks
whether it was the same 2 % of customers each time. Why can the histogram not
answer?

- **A** Identity is discarded at write time; an observation inside a bucket
  cannot be traced back to a request.
- **B** The buckets are too coarse; add boundaries and the answer appears.
- **C** You need `histogram_quantile` with a higher quantile.
- **D** You need a `customer_id` label on the histogram.

**8.** What is an exemplar?

- **A** A reference — canonically a trace ID — attached to one sample, which
  creates no new series.
- **B** A label whose value is a trace ID.
- **C** A sampled copy of a metric, kept at higher resolution for debugging.
- **D** An annotation stored in Grafana rather than in Prometheus.

**9.** What does service discovery produce?

- **A** A target list that changes without anyone editing the configuration
  file.
- **B** The list of metric names available to query.
- **C** The set of labels each application exports.
- **D** An endpoint that targets register themselves against.

**10.** Which weakness is inherent to a push-based collection model?

- **A** A sender that has gone silent is indistinguishable from one that has
  nothing to send.
- **B** Push cannot carry histograms.
- **C** The collector must be reachable from the public internet.
- **D** The metric name is lost in transit.

**11.** Why is Prometheus a poor system of record for billing?

- **A** It samples on an interval, and `rate()` and `increase()` extrapolate
  across the window, so counts are estimates.
- **B** Counters are float64 and overflow at high volume.
- **C** Counters reset when a process restarts, so the total is permanently
  lost.
- **D** Retention defaults to fifteen days, so old invoices age out.

**12.** How does an event differ from a log line?

- **A** An event is one structured record per unit of work, carrying everything
  known about it, emitted once when the work completes.
- **B** An event is a log line with no timestamp.
- **C** An event is a metric sample with a string attached to it.
- **D** Events are log lines stored in a tracing backend.

**13.** **(harder than the exam)** A trace store keeps one request in a
hundred. Why can you not compute an error budget from it?

- **A** It holds anecdotes rather than a census, so it has no denominator you
  can trust.
- **B** Its clocks are not synchronized with Prometheus.
- **C** Spans carry no status field.
- **D** Trace query languages cannot express division.

**14.** An availability objective of 99.5 % over a rolling 30 days permits how
much total failure?

- **A** 216 minutes.
- **B** 43.2 minutes.
- **C** 432 minutes.
- **D** 3.6 minutes.

### Domain 2 — Prometheus Fundamentals (16 questions)

**15.** When are two time series the same series?

- **A** When the metric name and the complete label set are identical.
- **B** When they share a metric name and a `job` label.
- **C** When they share a metric name, whatever the labels say.
- **D** When they share `__name__` and `instance`.

**16.** What is true of `{__name__="snip_http_requests_total", code="302"}`?

- **A** It selects exactly the same series as
  `snip_http_requests_total{code="302"}`.
- **B** It is a parse error, because `__name__` is reserved.
- **C** It returns the metric's `# HELP` text rather than its samples.
- **D** It matches only series whose name was set by relabeling.

**17.** What is a `# HELP` line?

- **A** A one-sentence description of a metric name, which Prometheus stores
  and shows you in the Metrics Explorer.
- **B** A comment the parser discards.
- **C** A required prefix before every sample line.
- **D** A declaration of the metric's unit, which Prometheus enforces.

**18.** A handler serves valid exposition text but sets no usable
`Content-Type`. What does Prometheus 3 do?

- **A** Fails the entire scrape.
- **B** Stores the samples as untyped.
- **C** Falls back to the text format and logs a warning.
- **D** Stores the samples but drops the `# HELP` and `# TYPE` lines.

**19.** **(harder than the exam)** Besides `version=0.0.4` and
`charset=utf-8`, which parameter appears on the `Content-Type` of every scrape
in this lab?

- **A** `escaping=underscores`
- **B** `encoding=utf8`
- **C** `format=openmetrics`
- **D** `compression=none`

**20.** Where do the `job` and `instance` labels on your application's series
come from?

- **A** The scrape configuration, applied by Prometheus as it ingests.
- **B** The client library's default registry.
- **C** The `# HELP` lines the application writes.
- **D** `__meta_*` labels the application puts in its exposition.

**21.** What produces the `up` series?

- **A** Prometheus, for every target, on every scrape attempt.
- **B** The client library inside the target process.
- **C** The service discovery mechanism.
- **D** A recording rule that ships with Prometheus.

**22.** A scrape fails, so Prometheus writes staleness markers for that
target's series. What does a plain selector return for one of them?

- **A** Nothing at all — the series is omitted from the result.
- **B** Zero.
- **C** The last known value, for the next five minutes.
- **D** `NaN`.

**23.** **(harder than the exam)** You `curl` the Snip API's `/metrics` and
count far more lines than Prometheus has series. What explains the gap in this
lab?

- **A** `metric_relabel_configs` drops the `link_code` label after the scrape,
  collapsing many wire lines into few stored series.
- **B** Prometheus deduplicates identical label sets on ingestion.
- **C** `relabel_configs` drops the label before the request is made.
- **D** Prometheus stores only the series named by a recording rule.

**24.** Which relabeling block can read `__meta_*` labels?

- **A** `relabel_configs`, which runs before the scrape.
- **B** `metric_relabel_configs`, which runs after it.
- **C** `write_relabel_configs`, on the way to remote write.
- **D** All three, because the syntax is identical.

**25.** What does `honor_labels: true` do on a scrape job?

- **A** Keeps the `job` and `instance` values the target exposed, instead of
  overwriting them with the scrape job's own.
- **B** Preserves the target's `# HELP` and `# TYPE` lines.
- **C** Stops Prometheus adding the scrape config's `env` label.
- **D** Moves the target's labels to `exported_job` and `exported_instance`.

**26.** Which label would do the most damage on a request counter?

- **A** A request ID.
- **B** The templated route.
- **C** The HTTP method.
- **D** The response status code.

**27.** You divide one service's counter rate by another service's. What is the
honest caveat?

- **A** The two readings come from independent scrape loops and can be taken up
  to a scrape interval apart.
- **B** PromQL refuses to divide series from two different jobs.
- **C** The result carries both metric names.
- **D** Prometheus aligns the two scrapes so the readings are simultaneous.

**28.** What is the cost of adding a label whose values are unbounded?

- **A** Every distinct value creates a new series, with its own index entries
  and its own memory.
- **B** The existing series gain a column, which is cheap.
- **C** Prometheus rejects label values it has not seen before.
- **D** The metric family's memory grows, but the series count does not.

**29.** **(harder than the exam)** Your `compose.yaml` passes
`--storage.tsdb.retention.time=45d` and your `prometheus.yml` sets
`storage.tsdb.retention.time: 30d`. Which wins?

- **A** The config file field, silently.
- **B** The flag, because command-line flags override configuration.
- **C** Neither; Prometheus refuses to start with both set.
- **D** Whichever is shorter.

**30.** `snip_http_request_duration_seconds` has thirteen finite bucket bounds
and a label set closed at twelve `(route, method, code)` combinations. What is
the ceiling on series for this one metric per replica?

- **A** 192 — sixteen series per combination.
- **B** 156 — thirteen per combination.
- **C** 168 — fourteen per combination.
- **D** 180 — fifteen per combination.

### Domain 3 — PromQL (23 questions)

**31.** What does `rate(snip_http_requests_total)` return?

- **A** A parse error — `rate()` takes a range vector, and that is an instant
  vector.
- **B** The per-second rate over a default five-minute window.
- **C** The current value of each series.
- **D** An empty result.

**32.** What about `sum(snip_http_requests_total[5m])`?

- **A** A type error — aggregation operators take instant vectors.
- **B** The total of every sample inside the window.
- **C** The same answer as `sum_over_time`.
- **D** A valid but slow expression.

**33.** How are `rate()` and `increase()` related?

- **A** `increase(x[5m])` is `rate(x[5m])` multiplied by 300.
- **B** `increase(x[5m])` is `rate(x[5m])` with counter resets ignored.
- **C** `increase()` counts observed events; `rate()` estimates them.
- **D** `increase(x[5m])` is `x - (x offset 5m)`.

**34.** Four samples of `snip_links_created_total` inside a one-minute window
read 3057, 3072, 3087 and 3103, fifteen seconds apart. `increase(...[1m])`
returns `61.33`. Why is that not `46`?

- **A** Only 45 seconds of the 60-second window carry samples, so the observed
  slope is scaled up to the full window.
- **B** A counter reset was detected and the pre-reset total was added back.
- **C** Prometheus interpolated the missing samples using their average.
- **D** The counter is stored as a float and lost precision.

**35.** A counter reads 41,827 at one scrape and 12 at the next, because the
process restarted. What does `rate()` do?

- **A** Treats the decrease as a reset and adds the new value to the pre-reset
  total.
- **B** Returns a large negative rate.
- **C** Returns nothing until the counter passes its old value.
- **D** Returns the difference between the last two samples, unadjusted.

**36.** You apply `rate()` to `snip_worker_queue_depth`, a gauge that rises and
falls. What happens?

- **A** Every decrease is read as a counter reset and quietly added back, so
  you get a plausible number that means nothing.
- **B** Prometheus rejects the expression, because the `# TYPE` line says
  gauge.
- **C** The result goes negative whenever the gauge falls.
- **D** You get the same answer as `deriv()`.

**37.** Snip runs two replicas and you restart one. Which expression shows a
spurious spike at the moment of the restart?

- **A** `rate(sum(snip_http_requests_total{job="snip-api"})[1m:15s])`
- **B** `sum(rate(snip_http_requests_total{job="snip-api"}[1m]))`
- **C** `sum without (instance) (rate(snip_http_requests_total{job="snip-api"}[1m]))`
- **D** `sum by (job) (rate(snip_http_requests_total{job="snip-api"}[1m]))`

**38.** What is the difference between the two grouping clauses?

- **A** `sum without (instance, code) (...)` keeps `job`, `env`, `method` and
  `route`; `sum by (route) (...)` keeps only `route`.
- **B** `by (route)` keeps every label except `route`.
- **C** They are two spellings of the same operation.
- **D** `without` keeps only the labels you name.

**39.** On a settled lab, the average of the per-route 404 ratios reads
`0.3333` and the ratio of the sums reads `0.0017`. Which belongs on an SLO
dashboard, and why?

- **A** The ratio of the sums, because a user is a request rather than a route.
- **B** The average, because it gives every route an equal vote.
- **C** Neither; use `avg_over_time` on the ratio instead.
- **D** The average, because the larger number is the safer one to act on.

**40.** What happens to the metric name in `rate(a[5m]) / rate(b[5m])`?

- **A** It is dropped; the result has no `__name__`.
- **B** It becomes the two names joined.
- **C** The left-hand side's name is kept.
- **D** The expression fails unless both names match.

**41.** `snip_links_active > 500` returns only the series above 500. How do you
get `1` and `0` instead?

- **A** Add the `bool` modifier.
- **B** Wrap the expression in `count()`.
- **C** Use `>=` rather than `>`.
- **D** Wrap it in `absent()`.

**42.** What does `a unless b` return?

- **A** The elements of `a` that have no matching element in `b`.
- **B** The elements of `a` whose value differs from the matching `b`.
- **C** `a` minus `b`, arithmetically.
- **D** Nothing, unless `bool` is supplied.

**43.** **(harder than the exam)** What does `group_left` permit?

- **A** Many-to-one matching, with at most one match on the right for each
  element on the left.
- **B** Many-to-many matching.
- **C** Copying labels from the left side onto the right.
- **D** Matching two sides whose metric names differ.

**44.** The Go client writes `le="1"` on the wire, but
`snip_http_request_duration_seconds_bucket{le="1"}` returns nothing. Why?

- **A** Prometheus 3 normalizes `le` to a canonical float form on ingestion, so
  the stored value is `1.0`.
- **B** There is no one-second bound in this histogram's bucket list.
- **C** `le` must be written as a number, not a quoted string.
- **D** The series went stale because no request took that long.

**45.** `histogram_quantile(0.95, sum by (route) (rate(..._bucket[5m])))`
returns `NaN`. What is wrong?

- **A** `le` was aggregated away, and bucket samples without `le` are silently
  ignored.
- **B** `0.95` is not a valid quantile argument.
- **C** The rate window is too short for the scrape interval.
- **D** `sum` should be `avg` when the input is buckets.

**46.** For one label combination, the `le="+Inf"` bucket reads 2,914. What
else reads 2,914?

- **A** `_count` for the same label combination.
- **B** `_sum` for the same combination.
- **C** The largest finite bucket, always.
- **D** Nothing; `+Inf` counts a separate population.

**47.** **(harder than the exam)** Your p99 latency pins at a round number that
happens to equal one of your bucket bounds and refuses to move. What is
happening?

- **A** When the quantile falls in the highest bucket, the function returns the
  upper bound of the second-highest bucket.
- **B** The histogram has overflowed and reports `+Inf`.
- **C** `histogram_quantile` rounds its answer to the nearest bucket bound by
  design.
- **D** The rate window is longer than the retention period.

**48.** You write the latency objective as
`histogram_quantile(0.99, ...) < 0.3`. Why is that unusable as an alert?

- **A** A bare comparison filters, so when the objective is violated the result
  is empty and the alert is quiet.
- **B** `histogram_quantile` cannot be compared against a scalar.
- **C** `0.3` is not one of the bucket bounds.
- **D** The function returns milliseconds, so the threshold is wrong by 1000.

**49.** The rule
`job_route:snip_http_errors:ratio_rate5m{route="/l/{code}"} > 0.20` is loaded
and Snip is not running at all. What does it do?

- **A** Nothing. The expression returns no elements, and Prometheus reads an
  empty result as "everything is fine."
- **B** Fires immediately, because a missing ratio is treated as `1`.
- **C** Fires once `for` has elapsed, because the series is stale.
- **D** Errors, and the whole rule group is marked failed.

**50.** What is the difference between `time()` and `timestamp()`?

- **A** `time()` returns the evaluation timestamp as a scalar; `timestamp()`
  returns each sample's own timestamp as that sample's value.
- **B** They are synonyms.
- **C** `time()` returns the scrape time; `timestamp()` returns the rule
  evaluation time.
- **D** `timestamp()` takes a range vector.

**51.** Which expression alerts when a certificate is within six hours of
expiry?

- **A** `probe_ssl_earliest_cert_expiry - time() < 6 * 3600`
- **B** `time() - probe_ssl_earliest_cert_expiry < 6 * 3600`
- **C** `probe_ssl_earliest_cert_expiry < 6 * 3600`
- **D** `time() - probe_ssl_earliest_cert_expiry > 6 * 3600`

**52.** `loadgen_inflight_requests` spiked to 48 for ninety seconds. At a
one-hour range the panel shows the spike; at 24 hours it is gone. What recovers
it?

- **A** `max by (route) (max_over_time(loadgen_inflight_requests[$__interval]))`
- **B** A longer `$__rate_interval`.
- **C** Switching the panel to an instant query.
- **D** A faster dashboard refresh rate.

**53.** The lab scrapes every fifteen seconds. What does `rate(x[5s])` return?

- **A** Nothing — the window rarely contains the two samples `rate()` needs.
- **B** A rate five times larger than `rate(x[25s])`.
- **C** The most recent sample's value.
- **D** An error, because the window is shorter than the scrape interval.

### Domain 4 — Instrumentation and Exporters (13 questions)

**54.** Your service has been running for an hour and nobody has scraped it.
Where are the samples?

- **A** Nowhere. The counters are numbers in memory; the exposition body is
  generated fresh on each request.
- **B** Buffered in the client library, to be flushed on the next scrape.
- **C** In a local file that the scrape endpoint reads.
- **D** Nowhere, because counters do not increment until a scrape arrives.

**55.** A developer constructs the counter inside the HTTP handler rather than
at startup. What goes wrong?

- **A** The metric is either never registered and therefore invisible, or
  re-registered and rejected; either way the value never accumulates.
- **B** It works, but more slowly.
- **C** Prometheus deduplicates the copies at scrape time.
- **D** It produces one series per request.

**56.** Which name obeys the naming law?

- **A** `snip_data_written_bytes_total`
- **B** `snip_data_written_total_bytes`
- **C** `snip_data_written_bytes`
- **D** `snip_data_written_kilobytes_total`

**57.** You want a cache hit rate. What do you export?

- **A** A counter with a `result` label, and compute the ratio at query time.
- **B** A gauge named `snip_cache_hit_percent`, between 0 and 100.
- **C** A gauge holding the ratio, computed inside the application.
- **D** A summary with a `quantile` label.

**58.** What is wrong with `snip_get_requests_total` and
`snip_post_requests_total`?

- **A** They encode a label name in the metric name; they should be one family
  with a `method` label.
- **B** Nothing; one metric per method is the convention.
- **C** They should be one family, with the method named in the `# HELP`.
- **D** They should carry a `unit` label.

**59.** Why does the lab pre-initialize `snip_http_requests_total` to zero for
all twelve label combinations at startup?

- **A** So that the series exist before the first matching request, and ratios
  and alerts are not computed against an empty result.
- **B** To reduce memory by allocating series up front.
- **C** To satisfy `promlint`.
- **D** So counters survive a restart.

**60.** Which label must application code never emit?

- **A** `instance`
- **B** `route`
- **C** `outcome`
- **D** `queue`

**61.** The lab pre-initializes its counters but deliberately not its
histograms. Why?

- **A** A zero-count histogram is sixteen series that say nothing.
- **B** Client libraries cannot pre-initialize histograms.
- **C** Empty buckets make `histogram_quantile` return `NaN` forever.
- **D** It would make `le` values inconsistent between replicas.

**62.** **(harder than the exam)** How do Go's `prometheus.DefBuckets` and the
Python client's default buckets differ?

- **A** In count — eleven finite bounds against fourteen — so two services'
  buckets do not line up.
- **B** They are identical, which is why histograms aggregate across languages.
- **C** Only in rendering: one writes `1`, the other `1.0`.
- **D** Go writes the `+Inf` bound explicitly and Python does not.

**63.** What is an exporter?

- **A** A process that reads one system's state and republishes it in
  exposition format, scraped like any other target.
- **B** An agent that pushes another system's metrics into Prometheus.
- **C** A plugin Prometheus loads at startup.
- **D** A translator that converts PromQL into the target system's own query
  language.

**64.** **(harder than the exam)** In the blackbox job you copy `__address__`
into `__param_target` and then overwrite `__address__` with the exporter's
address, but you forget to copy `__param_target` into `instance`. What happens?

- **A** Every probed target writes into one identical series, labeled with the
  exporter's address, and the graph looks like a single flapping endpoint.
- **B** The exporter probes itself.
- **C** The scrape fails with a missing-target error.
- **D** `probe_success` is correct but carries no `job` label.

**65.** **(harder than the exam)** The exporter's collector list names a
checkpointer collector, the documentation describes the metrics, and
`{__name__=~"pg_stat_checkpointer_.*"}` returns nothing. What do you conclude?

- **A** The metric the documentation implies is not the metric this exporter
  version ships; assert on what is actually on the wire.
- **B** The scrape is failing.
- **C** The collector needs a flag to enable it.
- **D** The exporter's database role lacks permission on that view.

**66.** `catalog_items_processed` is declared a gauge and only ever
incremented. Which two conventions does it break?

- **A** It is missing `_total`, and its declared type contradicts its behavior.
- **B** It is missing a unit suffix, and it has no `# HELP`.
- **C** It puts a label name in the metric name, and it is not in base units.
- **D** It uses a reserved prefix, and it has no application prefix.

### Domain 5 — Alerting and Dashboarding (14 questions)

**67.** A rule uses a one-minute error ratio with `for: 1h`. The service is
broken for ninety minutes, with one single evaluation at minute 50 where the
expression returns nothing. When does it fire?

- **A** Never.
- **B** At minute 60.
- **C** At minute 110, an hour after the dip.
- **D** At minute 50, and it resolves immediately.

**68.** An alert instance moves from pending to firing. What happens in the
`ALERTS` series?

- **A** The pending series is marked stale and a different series, carrying
  `alertstate="firing"`, begins.
- **B** The same series changes its value from `0` to `1`.
- **C** The series is deleted and recreated with the same identity.
- **D** Nothing; `ALERTS` exists only while an alert is firing.

**69.** Your first page arrives too slowly. Which Alertmanager timer is in the
path of the first notification?

- **A** `group_wait`
- **B** `group_interval`
- **C** `repeat_interval`
- **D** `evaluation_interval`

**70.** Somebody lowers `group_interval` from `5m` to `10s` to be paged faster.
What actually happens?

- **A** The first notification is no faster, and every subsequent notification
  about an evolving incident becomes far more frequent.
- **B** The first notification arrives thirty times sooner.
- **C** Nothing, unless `repeat_interval` is lowered too.
- **D** Alerts start being dropped.

**71.** **(harder than the exam)** A route sets `group_interval: 5m` and
`repeat_interval: 7m`. How often does an unchanged firing group notify?

- **A** Every ten minutes.
- **B** Every seven minutes.
- **C** Every five minutes.
- **D** Every twelve minutes.

**72.** Two sibling routes both match an alert, and neither sets `continue`.
What happens?

- **A** The first matching sibling wins and the walk stops there.
- **B** Both receivers are notified.
- **C** The more specific matcher wins.
- **D** The alert falls through to the root receiver.

**73.** You add three child routes. An alert matches none of them. Where does
it go?

- **A** To the root receiver, because the parent handles what its children do
  not match.
- **B** Nowhere; it is dropped.
- **C** Nowhere; Alertmanager logs an error and holds it.
- **D** To every child receiver.

**74.** An inhibition rule silences far more than intended. What is the most
likely cause?

- **A** The `equal` list is missing, so one source alert inhibits every
  matching target across the estate.
- **B** `source_matchers` and `target_matchers` are the wrong way around.
- **C** The inhibit rule is declared above the route tree.
- **D** Inhibition requires `continue: true` on the route.

**75.** What is true of a silence?

- **A** It has an expiry, and notifications resume when it lapses.
- **B** It persists until somebody deletes it.
- **C** It stops Prometheus evaluating the rule.
- **D** It removes the matching `ALERTS` series.

**76.** A rule whose expression is `vector(1)` fires forever and routes to a
receiver nobody reads. What is it for?

- **A** Its absence is the signal: when the heartbeat stops arriving, the
  alerting pipeline itself has broken.
- **B** It proves the service is meeting its objective.
- **C** It keeps the `ALERTS` series from going stale.
- **D** It is a placeholder to be replaced with a real expression.

**77.** Which of these deserves to wake a human at three in the morning?

- **A** The redirect path's error ratio is burning the error budget fast.
- **B** One container restarted.
- **C** Database connections are at 60 % of `max_connections`.
- **D** The Prometheus volume crossed 50 % full.

**78.** A panel at a one-hour range with a thousand data points uses
`rate(x[$__interval])`. The lab scrapes every fifteen seconds. What do you see?

- **A** An empty panel — the window is five seconds and rarely holds two
  samples.
- **B** The same result as `$__rate_interval`, which is also one minute here.
- **C** A correct graph that uses more memory than it needs.
- **D** A correct graph, because Grafana rewrites the macro.

**79.** A Stat panel shows a number that turns out to be four minutes old,
while looking entirely current. Why?

- **A** An instant query returns the most recent sample within the lookback
  window, which is five minutes by default.
- **B** The dashboard refresh interval is too long.
- **C** The panel is caching its last render.
- **D** The series went stale and the panel keeps showing the last value
  forever.

**80.** Your error-ratio query returns `0.03`, and you know that is three
percent. The panel reads `0.03%`. What is wrong?

- **A** The panel's unit is *Percent (0–100)*; a Prometheus ratio needs
  *Percent (0.0–1.0)*.
- **B** The query divides by the wrong denominator.
- **C** The panel is stacking its series.
- **D** The Y axis does not start at zero.

## H.4 Answers and explanations

Each answer says why the correct option is correct and why each of the other
three is wrong, and names the chapter and section that teaches it. A wrong
answer is a routing instruction, not a verdict.

### Observability Concepts — answers 1 to 14

**1 — A.** Prometheus synthesizes `up` for every target on every scrape
attempt, so a failed scrape produces a fresh `up` sample valued `0`. The
target's own series, by contrast, get staleness markers and vanish from query
results. **B** is wrong because `up` is the one series a dead target still
produces. **C** is the five-minute-lookback flat-line, which is what you see
when *Prometheus* was down, not when a scrape failed. **D** is wrong for the
same reason: staleness markers make the series absent rather than zero.
Chapter 2, `## When a target goes away`.

**2 — A.** The job is tied to a host, so the host's exporter is the right
carrier: write a `.prom` file, node_exporter serves it, and the metric arrives
carrying the host's `job` and `instance` with `up` still meaningful. **B** is
the Pushgateway's most common misuse; its documented niche is *service-level*
batch jobs with no host identity. **C** cannot work — a forty-second job and a
ten-second scrape interval still leave you scraping a process that has exited,
and the metric would vanish the moment it did. **D** sends data out of a
Prometheus server; it is not an ingestion path for a shell script.
Chapter 22, `## The textfile collector`; this appendix, H.2.1.

**3 — A.** The internal objective sits inside the contract with margin, so you
exhaust your own budget while there is still contractual room to react. **B**
gives you no warning at all: the moment you miss the objective you have also
missed the contract. **C** is a mechanism for breaching a contract on schedule.
**D** inverts the rule — by the time the contract number is in danger the money
has already moved. This appendix, H.2.3; Chapter 20, `## Choosing the target,
in minutes`.

**4 — A.** An indicator is a measurement: good events over valid events, with
no threshold and no opinion in it. **B** is the objective — a target for that
measurement over a window. **C** is the error budget that falls out of the
objective. **D** is the agreement, a contract with commercial consequences.
Chapter 20, `## Good events over valid events`; this appendix, H.2.3.

**5 — A.** Trace context is propagated in-band. The W3C `traceparent` header
carries the trace ID, the current span ID and flags, and the receiving service
creates its children under that trace ID. **B** describes what you get *without*
propagation: several unrelated single-service traces that happened at the same
time. **C** confuses signals — Prometheus labels have nothing to do with span
identity. **D** cannot work, because the collector has no way to know which
spans belong together. This appendix, H.2.4; Chapter 29, `## Traces and TraceQL,
in one page`.

**6 — A.** A span with no parent is the root, covering the whole request; its
children are the individual pieces of work. **B** and **C** both assume a
parent is mandatory, which would leave every trace headless. **D** confuses a
missing parent with a missing instrumentation, which produces a *gap* in a
trace rather than a root. This appendix, H.2.4.

**7 — A.** Metrics discard identity at write time. Once an observation lands in
a bucket, nothing recovers which request produced it. That is the bargain that
makes the cost curve flat. **B** and **C** change the resolution of the
estimate, not the presence of identity. **D** is the misconception worth naming:
a customer ID is an unbounded label, and adding it converts a cheap metric into
a cardinality bomb without answering the question any better than a trace
would. Chapter 29, `## The bargain metrics made`; Chapter 7, `## Bounded,
unbounded, and the labels that are always wrong`.

**8 — A.** An exemplar attaches a reference to one specific sample. **B** is
the point of the whole feature: it is emphatically *not* a label, does not
participate in series identity, and creates no new series. **C** describes
sampling, which is what traces do and metrics do not. **D** is wrong about
where it lives; Grafana renders it, Prometheus stores it. Chapter 29, `## The
star, and the one word that has to match`; this appendix, H.2.4.

**9 — A.** Service discovery turns a target list into a query against something
that already knows what is running, so targets appear and disappear without a
config edit. **B** confuses targets with metric names. **C** describes the
exposition, which Prometheus only sees after it has connected. **D** describes
a push model, which is what service discovery exists to avoid. Chapter 12,
`## Service discovery is one idea with several sources`.

**10 — A.** Pull gives you `up` for free because the scraper initiates; push
has no equivalent, so silence is ambiguous. **B** is false — push protocols
carry histograms. **C** overstates it; a collector inside your network is
normal. **D** is false. This appendix, H.2.6; Chapter 1, `## Why Prometheus
connects to you`.

**11 — A.** Prometheus samples. It reads a counter every scrape interval and
never observes what happened in between, and the rate functions extrapolate
across the window to compensate. That is correct for a trend and unacceptable
for a number somebody is charged for. **B** is not the problem at realistic
volumes. **C** is a real property of counters but `rate()` corrects for it.
**D** picks a retention number out of the air and misses the mechanism.
Chapter 6, `## increase(), and the two and a half requests`; this appendix,
H.2.2.

**12 — A.** An event is one wide structured record per unit of work, emitted
once when the work completes; logs narrate a thousand lines for a thousand
requests. **B** is wrong — events are timestamped. **C** confuses events with
exemplars. **D** confuses a signal with a storage backend. Chapter 29, `## Three
questions, three answers`; this appendix, H.2.4.

**13 — A.** A one-percent sample gives you representative examples, not a
count. An error budget is arithmetic on a numerator and a denominator that must
both be complete. **B**, **C** and **D** are all things that are false or
irrelevant: clocks are synchronized well enough, spans do carry status, and
division is not the obstacle. This appendix, H.2.4.

**14 — A.** 0.5 % of 30 days is 216 minutes, or three hours and thirty-six
minutes. **B** is the budget for 99.9 %, **C** for 99 %, and **D** is not a
budget for any of the common targets. If you had to compute rather than
recall, that is the right instinct: nines are a terrible unit and minutes are a
good one. Chapter 20, `## Choosing the target, in minutes`.

### Prometheus Fundamentals — answers 15 to 30

**15 — A.** Identity is the metric name plus the complete label set, identical
label for label. **B** and **D** name a subset, which would make two different
series collide. **C** describes a metric *family*, which is a group of series
that share a name and nothing else about their storage. Chapter 2, `## A name
plus a label set is an identity`.

**16 — A.** The metric name is stored as a reserved label called `__name__`, so
the two spellings select the same series. **B** is wrong; `__name__` is
readable in a selector, though you cannot write the name twice in one selector.
**C** confuses the sample stream with the documentation line. **D** invents a
distinction that does not exist. Chapter 2, `## A name plus a label set is an
identity`.

**17 — A.** `# HELP` is documentation written by whoever instrumented the code,
and Prometheus keeps it. **B** is the belief that costs you a useful metadata
surface. **C** is wrong — it appears once per family, not once per sample.
**D** is the wish rather than the fact: nothing enforces units, which is why
the naming law exists. Chapter 2, `## Three kinds of line`.

**18 — A.** Prometheus 3 fails the whole scrape. Nothing from that target is
stored for that cycle, and the failure shows up as `up == 0` rather than as
missing metrics. **B**, **C** and **D** all assume a partial ingest, which is
what older versions permitted and what makes this trap worth summoning
deliberately. Chapter 5, `## Breaking /metrics the way Prometheus 3 punishes
hardest`.

**19 — A.** Every scrape in this lab carries
`escaping=underscores`, a parameter that belongs to the UTF-8-names era.
**B**, **C** and **D** are plausible-looking inventions. If you have only ever
seen a pre-2025 header printed in a tutorial, this is the kind of drift that
makes old material quietly wrong. Chapter 2, `## Three kinds of line`.

**20 — A.** `job` and `instance` are attached by Prometheus from the scrape
configuration and relabeling, which is why they are identical in shape across
every target in the estate. **B** is wrong — the registry knows nothing about
who is scraping it. **C** is unrelated. **D** is backwards: `__meta_*` labels
come from service discovery and never appear in an exposition body.
Chapter 2, `## Where job and instance came from`; Chapter 12, `## The labels
you cannot see`.

**21 — A.** Prometheus synthesizes `up` per target per scrape attempt, writing
`1` on success and `0` on failure, which is the punchline of the pull model.
**B** would make a dead process responsible for reporting that it is dead.
**C** and **D** invent mechanisms. Chapter 1, `## Prometheus fetched that, on a
timer`.

**22 — A.** A staleness marker means "this series stopped." A selector that
looks back and finds one returns nothing for that series — omitted entirely.
**B** is the single most damaging misreading, because an empty result in an
alert expression reads as "everything is fine." **C** is the lookback behavior,
which markers override. **D** is wrong; you never see the marker through
PromQL. Chapter 2, `## When a target goes away`; Chapter 9, `## The series that
isn't there`.

**23 — A.** On the wire the API also emits a `link_code` label, and the scrape
drops it with `metric_relabel_configs`, so `curl` shows far more lines than
Prometheus stores. **B** is wrong; Prometheus does not merge distinct label
sets. **C** is the position confusion worth fixing: `relabel_configs` runs
before the request and has never seen a sample, so it cannot drop a label from
one. **D** describes nothing Prometheus does. Chapter 12, `## Three places to
relabel, and what each can see`.

**24 — A.** Only `relabel_configs` runs before the scrape, which is when the
`__meta_*` labels from service discovery exist; they are consumed and discarded
before the request goes out. **B** sees `__name__` and the sample's own labels
and nothing else. **C** operates on samples leaving for remote write. **D**
confuses identical syntax with identical inputs. Chapter 12, `## Three places
to relabel, and what each can see`.

**25 — A.** With `honor_labels: true` the target's own `job` and `instance`
survive, which is exactly what the Pushgateway needs, since the pushed `job` is
the real one. **D** is the *default* behavior, which the flag reverses —
choosing it is the most instructive way to get this wrong. **B** is unrelated
to labels. **C** is wrong; the flag governs collisions, not additions.
Chapter 12, `## The file, top to bottom`; this appendix, H.2.1.

**26 — A.** A request ID is unbounded: every distinct value is a permanent new
series with its own index entries and memory. **B**, **C** and **D** are the
bounded dimensions this lab's catalog is built from, and together they close
at twelve combinations. Chapter 7, `## The label-admission test`; Chapter 24,
`## Light the fuse`.

**27 — A.** Two targets are scraped by two independent loops at two different
instants, so the division compares readings taken up to a scrape interval
apart. Immaterial for rates over minutes, wrong for anything that must balance,
and no query rewrite fixes it. **B** is false. **C** is false — arithmetic
drops the name. **D** describes a guarantee Prometheus does not make. This
appendix, H.2.2.

**28 — A.** Every unique combination of labels is one more series to ingest,
index, store and process. **B** is the mental model that causes the damage:
labels are not columns. **C** is false. **D** is false; the series count *is*
the cost. Chapter 7, `## A label value is a new series, not a new column`.

**29 — A.** The configuration field takes precedence, silently, so a stack
carrying an old flag and a new field is running on the field while the flag
reads like documentation. **B** is the intuition that makes this dangerous.
**C** and **D** invent behaviors. Chapter 25, `## Retention, the way that works
now`.

**30 — A.** Thirteen finite bounds produce thirteen `_bucket` series, plus one
for `+Inf`, plus `_sum`, plus `_count` — sixteen per label combination, so
12 × 16 = 192 per replica. **B** forgets `+Inf`, `_sum` and `_count`. **C**
counts `+Inf` but not the two summary series. **D** counts one of them. The
count you actually observe is lower than 192, because histograms are not
pre-initialized and a combination appears only once it has happened.
Chapter 10, `## What a histogram looks like on the wire`; Chapter 7,
`## The histogram multiplier`.

### PromQL — answers 31 to 53

**31 — A.** `rate()` takes a range vector. A bare selector is an instant
vector, so this is a parse error rather than a wrong answer. **B** invents a
default window. **C** describes what the selector alone returns. **D** would be
a silent failure, which is exactly what PromQL's type system prevents here.
Chapter 6, `## Four kinds of thing an expression can be`.

**32 — A.** Aggregation operators take instant vectors, so a range vector is a
type error. **B** describes `sum_over_time`, which is the function for that
question. **C** is wrong in the direction that matters: they are different
functions with different inputs. **D** treats a type error as a performance
note. Chapter 6, `## Four kinds of thing an expression can be`; Chapter 11,
`## The _over_time family`.

**33 — A.** `increase()` is `rate()` without the final division by the window,
so over five minutes it is `rate()` times 300. Same window, same reset
correction, same extrapolation. **B** is wrong; both handle resets identically.
**C** is the belief that makes fractional results feel like a bug — neither
counts observed events. **D** ignores resets and extrapolation entirely.
Chapter 6, `## increase(), and the two and a half requests`.

**34 — A.** The samples span 45 seconds of a 60-second window, so the observed
increase of 46 is scaled by 60/45 to 61.33. It is an estimate of the increase
over the window you asked for, not a count of what was seen. **B** invents a
reset that did not happen. **C** invents interpolation. **D** blames float
precision for a factor of a third. Chapter 6, `## increase(), and the two and a
half requests`.

**35 — A.** Any decrease between consecutive samples is read as a reset, and
the new value is added to the pre-reset total. The increments between the last
scrape and the reset are lost, which is the honest cost. **B** is what would
happen with naive subtraction. **C** and **D** describe behaviors `rate()` does
not have. Chapter 6, `## What a restart costs you`; Chapter 4, `## Watching the
reset happen`.

**36 — A.** PromQL cannot detect the mistake. Every time the gauge falls,
`rate()` reads a counter reset and silently corrects for it, producing a number
that looks entirely plausible. That silence is what makes this a Tier S error.
**B** is the protection people assume exists; the `# TYPE` line is not
enforced. **C** describes naive subtraction. **D** is backwards: `deriv()` is
the gauge-only function that reports an honest, possibly negative slope.
Chapter 4, `## Plausible, silent, and wrong`; Chapter 6, `## Three functions
that are not rate(), and when each is wrong`.

**37 — A.** Summing the raw counters first means the restarted replica's drop
to zero shows up as a decrease in the sum, which `rate()` then reads as a reset
and corrects with a large spurious spike. **B** takes the rate per series
first, so each replica's reset is handled in isolation. **C** and **D** do the
same thing with different grouping clauses. The law is: rate first, aggregate
second, always. Chapter 8, `## The rate-then-aggregate law`.

**38 — A.** `by` is a whitelist and `without` is a blacklist. `without` keeps
everything it was not told about, including labels you had forgotten existed —
which is why the result still carries `env`. **B** inverts `by`. **C** is the
assumption that produces unroutable alerts. **D** inverts `without`.
Chapter 8, `## The grouping clause: by and without`.

**39 — A.** `avg(a/b)` gives every route one equal vote, so a route receiving
one request every thirty seconds and returning 404 to all of them drags the
answer to a third. `sum(a)/sum(b)` weights every request equally. A dashboard,
an SLO and a page all want the second. **B** names the mechanism and draws the
wrong conclusion from it. **C** smooths the wrong number over time. **D**
treats a larger number as a safer one, which is how averaging survives code
review. Chapter 9, `## avg(a/b) is not sum(a)/sum(b)`.

**40 — A.** Arithmetic between two vectors drops the metric name, because the
result is no longer either input. **B** invents a naming rule. **C** is a
common assumption and is wrong. **D** confuses name matching with label
matching — it is the *labels* that must match, not the names. Chapter 9,
`## Arithmetic, and what it costs the metric name`.

**41 — A.** A bare comparison filters: it returns the elements that pass and
removes the rest. `bool` converts it to `1` and `0` for every element instead.
**B** counts the survivors, which is a different question. **C** changes the
threshold, not the behavior. **D** tests for absence of a whole series.
Chapter 9, `## Comparison, and the bool modifier`.

**42 — A.** `unless` is a set operator on series identity: it returns elements
of the left side that have no match on the right. **B** compares values, which
is what a comparison does. **C** is arithmetic subtraction. **D** confuses set
operators with comparisons; `bool` applies to the latter. Chapter 9, `## and,
or, unless`.

**43 — A.** `group_left` enables many-to-one matching: many elements on the
left may match one on the right, and the modifier names which side is the
"many." Many-to-many remains forbidden, which is what "found duplicate series
for the match group" is telling you. **B** is the thing it specifically does
not permit. **C** is backwards — it copies labels from the "one" side onto the
"many" side. **D** confuses vector matching with name matching. Chapter 11,
`## group_left and group_right`; `## Reading "found duplicate series for the
match group"`.

**44 — A.** Prometheus 3 normalizes the `le` label of classic histograms to a
canonical float form on ingestion, so `10` is stored as `10.0` and `1` as
`1.0`, while `0.3` survives untouched. The selector matches nothing, with no
error and no warning. **B** is false — the bound exists. **C** is false; `le`
is a label value and label values are strings. **D** misreads an empty result
as staleness. Do not copy `le` values out of `curl`; list them with
`count by (le) (...)`. Chapter 10, `## What a histogram looks like on the
wire`.

**45 — A.** `histogram_quantile` needs the `le` label on its input, and samples
without one are silently ignored — which leaves nothing to interpolate and
returns `NaN`. `sum by (route, le)` fixes it. **B** is false. **C** would give
you an empty result rather than `NaN`. **D** invents a rule; the aggregation
operator is right, the grouping is not. Chapter 10, `## Question three:
histogram_quantile`.

**46 — A.** Buckets are cumulative, so `le="+Inf"` counts every observation and
is always exactly equal to `_count`. **B** is the sum of the observed *values*,
in seconds. **C** is true only when nothing exceeded the largest finite bound.
**D** inverts the cumulative property, which is the most common misreading of a
Prometheus histogram. Chapter 10, `## What a histogram looks like on the wire`.

**47 — A.** This is documented behavior, not a bug: when the quantile lands in
the highest bucket, the function returns the upper bound of the second-highest
bucket. The diagnosis is that your buckets are wrong for the latencies you are
seeing, and the fix is boundaries around the range you care about. **B**
invents an overflow. **C** invents rounding. **D** is unrelated. Chapter 10,
`## The incident: a p99 that cannot move`; `## Designing buckets backwards from
a question`.

**48 — A.** A bare comparison filters. While the p99 is under 300 ms you get
the p99 back; the moment it is over, the element is removed and the result is
empty — so the alert is quiet exactly when the objective is being broken. `bool`
fixes that much, but the deeper problems remain: a quantile has no numerator and
no denominator, so there is no budget to build from, and quantiles cannot be
aggregated. **B** is false. **C** is false — `0.3` is a real boundary in this
lab, put there on purpose. **D** confuses the unit; the histogram observes
seconds. Chapter 20, `## A latency SLO is a fraction, never a quantile`.

**49 — A.** With nothing running there is no input series, the expression
returns no elements, and Prometheus treats an empty result as nothing to alert
on. This is the silent-alert failure, and it is why the lab ships
`SnipSLIAbsent` alongside the threshold rules. **B** invents a default. **C**
misunderstands staleness, which removes elements rather than creating them.
**D** is what you would want and is not what happens. Chapter 16, `## The alert
that can never fire`; Chapter 9, `## The series that isn't there`.

**50 — A.** `time()` is a scalar: the timestamp at which the expression is
being evaluated, which inside a range query is the timestamp of each step.
`timestamp()` takes an instant vector and returns each sample's own timestamp
as that sample's value, with the labels unchanged. **B** would make one of them
pointless. **C** invents a distinction. **D** is wrong about the input type.
This appendix, H.2.5; Chapter 15, `## Watching the rule engine`.

**51 — A.** The expiry is in the future, so the freshness subtraction runs the
other way: expiry minus now is the time remaining, and you alert when it falls
below the threshold. **B** and **D** reverse the operands and produce a large
negative number that no threshold usefully catches. **C** compares a Unix
timestamp against six hours' worth of seconds, which is true only in 1970.
Chapter 23, `## Certificates, and the alert everybody wishes they had`; this
appendix, H.2.5.

**52 — A.** A graph is a sampled query result. At a wide range each rendering
step covers minutes, and a ninety-second spike has a good chance of falling
between two sampled instants — it is not averaged down, it is missed.
`max_over_time` over exactly one rendering step keeps it, shrinking to a single
tall pixel but never disappearing. Note the window is `[$__interval]`, not
`[$__rate_interval]`: you want one step, with no overlap. **B** widens a rate
window, which is a different problem. **C** makes it worse. **D** redraws the
same missing data faster. Chapter 11, `## The _over_time family`; Chapter 14,
`## The vanishing spike`.

**53 — A.** `rate()` needs at least two samples in the window. At a 15-second
scrape a 5-second window usually holds one and sometimes none, so the result is
an empty array — no error, no warning. The rule is that a rate window is never
less than four scrape intervals, which is why `$__rate_interval` exists. **B**
misunderstands the units; `rate()` is already per-second. **C** describes the
bare selector. **D** would at least be visible; the real failure is silent.
Chapter 6, `## The panel that goes empty`; Chapter 13, `## $__rate_interval,
and the term Grafana cannot guess`.

### Instrumentation and Exporters — answers 54 to 66

**54 — A.** A registry is a set of collectors; a scrape is an HTTP handler
running a gather and rendering the result as text. Nothing is written anywhere
until somebody asks, and the body is generated fresh on every request. **B**
and **C** describe a push agent and a log file respectively — the two mental
models readers usually arrive with. **D** is wrong: the counters increment as
your code runs, scrape or no scrape. Chapter 5, `## What a client library
actually is`.

**55 — A.** Metrics are constructed once, at startup, and registered once.
Building one inside a handler either leaves it unregistered — so nobody ever
asks it anything and it is invisible however many times you increment it — or
re-registers it and is rejected. Either way the value never accumulates. **B**
treats a correctness bug as a performance note. **C** invents deduplication.
**D** describes what a *label* with a per-request value would do, which is a
different disaster. Chapter 5, `## Construct once, at startup`.

**56 — A.** The unit suffix comes before the type suffix: a counter of bytes is
`..._bytes_total`. **B** reverses them and describes a quantity of totals.
**C** drops `_total` from a counter, so a reader cannot tell from the name that
only differences carry meaning. **D** is not a base unit — bytes, never
kilobytes. Chapter 5, `## The naming law`.

**57 — A.** Export the raw counts with a `result` label and divide at query
time, aggregating numerator and denominator separately. **B** breaks the base
unit rule twice over: a percentage instead of a ratio, and the unit in the
name. **C** computes a ratio inside the process, which cannot then be
re-aggregated across replicas or re-windowed at query time. **D** uses a
summary for something that is not a distribution at all. Chapter 5, `## The
naming law`; Chapter 9, `## The error ratio, done correctly`.

**58 — A.** The label name is inside the metric name, which is redundant and
makes every cross-method query a union of two families. One family with a
`method` label answers more questions for less. **B** is the habit this rule
exists to break. **C** leaves the structural problem in place. **D** puts a
unit where a dimension belongs. Chapter 5, `## The naming law`; `## The
aggregation-honesty test`.

**59 — A.** A series that has never been observed does not exist, and an
expression over a series that does not exist returns nothing — which blanks a
ratio panel and silences an alert. Exporting `0` for label values you know
about in advance removes the whole class of failure. **B** is backwards;
pre-initialization costs memory rather than saving it. **C** is not what
`promlint` checks. **D** is false — counters always reset on restart.
Chapter 9, `## The series that isn't there`; Chapter 16, `## The alert that can
never fire`.

**60 — A.** `job`, `instance`, `env`, `cluster` and `region` belong to the
scrape, and an application that emits one of them collides with the label
Prometheus attaches — which is what `honor_labels` and `exported_*` exist to
arbitrate. **B**, **C** and **D** are ordinary application dimensions that this
lab's own metrics carry. Chapter 5, `## Labels your application must never
emit`.

**61 — A.** A histogram with thirteen finite bounds is sixteen series per label
combination, and a zero-count one says nothing that its absence does not
already say. Counters are one series each and pre-initializing them is cheap;
the asymmetry is deliberate. **B** is false. **C** is a different failure mode.
**D** is unrelated — `le` values come from the bucket list, not from traffic.
Chapter 9, `## The series that isn't there`; Chapter 10,
`## What a histogram looks like on the wire`.

**62 — A.** The counts differ, which means two services' buckets do not line up
and their histograms cannot be meaningfully combined. That is the cross-language
lesson the lab is built to make visible. **B** is the assumption that makes
cross-service latency panels quietly wrong. **C** is a real difference in
rendering and not the one that matters — and Prometheus normalizes those values
on ingestion anyway. **D** is backwards: in Go the `+Inf` bound is implicit and
must never be written, while the Python client writes it explicitly. Chapter 10,
`## Someone else's service gets it wrong`; Appendix E.

**63 — A.** An exporter reads one system's state and republishes it in
exposition format. Prometheus pulls from the exporter exactly as it pulls from
your own code, so `up`, `job`, `instance` and relabeling all keep working. **B**
inverts the direction. **C** invents a plugin architecture Prometheus does not
have. **D** describes a query proxy, which is a different thing entirely.
Chapter 22, `## An exporter is a translator, and that is all it is`.

**64 — A.** `instance` defaults to `__address__`, and by the time the rules
have run that is the exporter's address for every target in the job. All three
probes then write into one identical series, each scrape overwriting the last,
and the graph looks like one endpoint flapping. There is no error. **B** is
what happens if you reorder the rules so the exporter's address is copied into
`?target=`. **C** would be a visible failure and is therefore the kinder
outcome. **D** is wrong; `job` comes from the scrape config. Chapter 23,
`## The maneuver, line by line`.

**65 — A.** The metric the documentation implies is not the metric the exporter
in front of you ships. PostgreSQL moved the checkpoint counters into a new view
and this exporter version has not picked them up under the new name, so the
family does not exist at any name you can guess. Assert on what is on the wire.
**B** is disproved by every other family from the same job being present. **C**
and **D** are reasonable next guesses and both are wrong here — which is why
reading the exporter's own output beats reading its documentation. Chapter 22,
`## postgres_exporter, and the metric that was not there`.

**66 — A.** It is missing `_total` on a value that only climbs, and it is
declared a gauge while behaving as a counter. The name is the tell you should
catch before you read the `# TYPE` line. **B** is wrong on both counts. **C**
describes different violations that this metric does not commit. **D** is
false; `catalog_` is a perfectly good application prefix. Chapter 4, `## A
gauge being used as a counter`; Chapter 5, `## The naming law`.

### Alerting and Dashboarding — answers 67 to 80

**67 — A.** `for` does not mean "the condition was true for an hour." It means
"the condition was true at every single evaluation across an hour," and one
evaluation where the element is missing puts the clock back to zero. Neither
the fifty-minute run nor the forty-minute run reaches sixty minutes, so nothing
ever fires. **B**, **C** and **D** all assume the clock accumulates or pauses.
It does neither. Chapter 16, `## for is a debounce, not a sustained-badness
detector`.

**68 — A.** `alertstate` is a label, so pending and firing are two different
series identities. The pending one is marked stale and a new one begins, which
you can watch on a graph as one line stopping and another starting where it
ended. **B** assumes the value carries the state; the value is always `1`.
**C** describes something that could not be distinguished from **B**. **D** is
wrong — `ALERTS` exists while an alert is pending too. Chapter 16, `## The
ALERTS series, which is where this becomes real`.

**69 — A.** `group_wait` is the only Alertmanager timer in the path of the
first notification: it holds a brand-new group open in case a second alert
joins. **B** gates notifications about a group that is changing, and has no
effect at all on the first one. **C** is the nag for a group that is not
changing. **D** is a Prometheus setting, not an Alertmanager one, and governs
how often rules run. Chapter 17, `## Four timers, one timeline`.

**70 — A.** `group_interval` is not in the path of the first notification, so
lowering it buys nothing on the number you care about — and during a real
incident, where alerts join and leave the group constantly, it turns one
incident into a notification every ten seconds. **B** is the belief that
motivates the change. **C** is wrong; the effect is immediate and unwelcome.
**D** invents a behavior. Fix `for` and `group_wait` instead. Chapter 17,
`## Four timers, one timeline`.

**71 — A.** A group is examined only on a `group_interval` tick, so
`repeat_interval` is effectively rounded up to a multiple of it: the first tick
that is a full seven minutes past the last notification is the one at ten
minutes. **B** is the configured value taken literally. **C** ignores
`repeat_interval` entirely. **D** picks an arbitrary multiple. Chapter 17,
`## Four timers, one timeline`.

**72 — A.** The alert walks the children in order, depth first, and the first
match wins unless that child sets `continue: true`. **B** is what `continue`
buys you and what its absence denies. **C** invents a specificity rule that
Alertmanager does not have. **D** confuses "no child matched" with "a child
matched." Chapter 17, `## The route tree`.

**73 — A.** A child that does not match does not mean the alert is unrouted; it
means the parent handles it. That is usually the root receiver, which is
usually the wrong place and never says so. **B** and **C** are what people
assume happened when a notification does not arrive where they expected. **D**
would make routing meaningless. Chapter 17, `## The route tree`.

**74 — A.** `equal` names the labels that must agree between the source alert
and the target before inhibition applies. Leave it out and one node's alert
suppresses the matching alert everywhere. **B** would inhibit the wrong
direction, which is a real mistake but produces the opposite symptom. **C** is
a file-layout claim with no effect. **D** confuses inhibition with routing.
Chapter 17, `## Inhibition: one cause, one page`.

**75 — A.** Silences expire, and that is the feature: an expired silence means
the alert comes back rather than being forgotten. **B** describes a
configuration change, not a silence. **C** is wrong — Prometheus keeps
evaluating and the alert keeps firing; Alertmanager suppresses the
notification. **D** is wrong for the same reason: `ALERTS` is written by
Prometheus and knows nothing about silences. Chapter 17, `## Silences, and why
they expire`.

**76 — A.** Every other alert in the book alarms on a signal arriving. This one
alarms on a signal stopping, which is the only way to detect that scraping,
rule evaluation, notification and the receiver have all stopped working. **B**
confuses a heartbeat with an objective. **C** invents a mechanism. **D** misses
the point of the rule entirely — `vector(1)` is exactly the expression it wants.
Chapter 19, `## The Watchdog`.

**77 — A.** Alert on symptoms that cause user pain. A budget burning fast on
the redirect path means people following short links are being hurt right now.
**B**, **C** and **D** are causes and early warnings: worth a dashboard, worth
a ticket, not worth a human's sleep unless and until they produce a symptom.
Chapter 16, `## Symptoms, and the causes worth keeping`; Chapter 19, `## Severity
is a route, not an adjective`.

**78 — A.** `$__interval` shrinks as the panel gets more data points; at one
hour and a thousand points it is five seconds, which is shorter than the scrape
interval, so most windows hold one sample and `rate()` returns nothing. **B**
is wrong — that is what `$__rate_interval` gives you and why it exists. **C**
treats an empty panel as a resource question. **D** invents a rewrite Grafana
does not perform. In a dashboard, `rate()` always gets `[$__rate_interval]`.
Chapter 13, `## $__rate_interval, and the term Grafana cannot guess`.

**79 — A.** An instant query returns the most recent sample at or before the
evaluation time, looking back as far as the lookback delta — five minutes by
default. A Stat panel shows that number with no indication of its age. **B**
would make the panel redraw the same stale number more often. **C** invents
caching. **D** describes staleness markers, which remove the series rather than
freezing it. Chapter 14, `## The Stat panel that is four minutes old`.

**80 — A.** Prometheus's base unit for a proportion is a ratio between 0 and 1.
Grafana's *Percent (0–100)* unit assumes the value has already been scaled, so
it renders `0.03` as `0.03%` — a hundredfold error in the direction nobody
notices. The unit you want is `percentunit`. **B** would change the number, not
its rendering. **C** and **D** are real dashboard sins that do not produce this
symptom. Chapter 14, `## Units: the silent hundredfold`; Chapter 5, `## The
naming law`.

## H.5 A study path

If you have a month, read the book in order and do the exercises. What follows
is for the reader who has a fortnight.

**Start with domain 3, because it is the largest slice and the one you can
practice mechanically.** Chapters 6 through 11 are six consecutive chapters of
PromQL against a lab you can run. Do them with the stack up and the Query page
open, and type every expression rather than reading it. Chapter 6's by-hand
rate calculation and chapter 10's bucket arithmetic are the two that repay the
effort most, because they convert two things you would otherwise memorize into
two things you can derive.

**Then domain 2, because it is cheap.** Chapter 2 is the single highest-value
chapter in the book for this exam: identity, labels, the three kinds of line,
and what happens when a target goes away. Chapter 12's first two sections cover
configuration and service discovery at exactly the exam's altitude. Add H.2.2
for the limitations, which are a named sub-competency with no home chapter.

**Then domain 5.** Chapter 16 for rule structure, `for`, and the `ALERTS`
series; chapter 17 for grouping, the route tree, the four timers, inhibition
and silences. Chapters 3 and 13 cover dashboarding basics; chapter 14 goes well
past the exam and is worth reading anyway, because it is the chapter that stops
you believing a graph.

**Then domain 4.** Chapter 5 end to end, reading `## The naming law` as a
checklist rather than as prose. Chapter 22's first two sections for what an
exporter is. That is close to sufficient.

**Domain 1 last, from the gap-fillers.** It is the smallest return on chapter
reading, because three of its six sub-competencies live in H.2.3, H.2.4 and
H.2.6 rather than in a chapter. Read those three, plus chapter 1's `## Why
Prometheus connects to you` and chapter 20's `## Good events over valid
events`.

### Exercises that double as exam practice

A few of the book's exercises are unusually well aimed at this exam, because
they ask you to predict rather than to type.

- Chapter 4's type census. Walking every metric family and naming its type is
  the exam's data-model question in exercise form.
- Chapter 6's prediction exercise. Computing a rate on paper and then checking
  it is the closest thing in the book to a PromQL exam question.
- Chapter 7's cardinality budget. Series arithmetic appears in both domain 2
  and domain 4.
- Chapter 18's `promtool test rules` work. Predicting whether an alert fires,
  and being graded on it, is exactly the shape of a domain 5 question.

### What to skip, and what skipping costs you

Chapters 21, 24, 26 and 27 go well beyond associate level. Chapter 21's
multiwindow burn-rate alerts are past the exam by a wide margin; chapter 24's
cardinality detonation is a working skill rather than an examinable fact;
chapter 26 is a scaling map you will not be asked to draw; chapter 27 is
optional in the book and optional here. Skip them for the exam.

Do not skip them for the work. The exam tests whether you can read an
expression and say what it returns. None of these chapters helps with that, and
all four of them are the difference between holding a certificate and being the
person the team calls at two in the morning.
