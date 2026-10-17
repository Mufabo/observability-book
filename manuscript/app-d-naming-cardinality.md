# Appendix D — Metric and Label Design Checklist, with the Cardinality Worksheet

A metric is two things at once: a public interface that people who never read
your code will type into alert rules, and a recurring bill that arrives every
scrape interval for as long as the series exists. Both are decided in the few
minutes before a pull request is opened, and almost never revisited.

This is the sheet to run in those few minutes. Work top to bottom for a new
metric family. Run the worksheet whenever you add a label, and keep the filled
copy.

## The checklist

The last column of each table names the chapter that earned the rule:
Chapter 4, "Metric Types Are Contracts"; Chapter 5, "Your First Counter:
Instrumenting Code You Own"; Chapter 7, "Labels, and the Cardinality Arithmetic
You Must Do First"; Chapter 8, "Aggregation: `sum`, `without`, and the
Rate-Then-Aggregate Law"; Chapter 9, "Ratios, Arithmetic, and the Series That
Isn't There"; Chapter 10, "Latency: Histograms Without Tears"; Chapter 16,
"Alerting Rules, and What 'Firing' Actually Means"; and Chapter 29, "Beyond
Metrics: Exemplars, Traces, Logs, and Where to Go Next".

### Type

| Check | Pass | Where |
|---|---|---|
| Can the value go down? | No → counter. Yes → gauge | Chapter 4 |
| Do you want a quantile, or "what fraction was under X"? | A histogram, not a gauge of an average | Chapter 10 |
| Does `# TYPE` agree with the name? | Both say counter, or both say gauge | Chapter 4 |

The third row catches real defects, because nothing enforces it.
`catalog_items_processed` is declared a gauge, climbs monotonically, and carries
no `_total`. The name is the half telling the truth, and `rate()` over it returns
a believable number anyway.

### Name

| Check | Pass | Where |
|---|---|---|
| Single-word application prefix | `snip_`, `loadgen_`, `catalog_`, `pager_` | Chapter 5 |
| Base unit, spelled in the name | `_seconds`, `_bytes`, `_ratio` | Chapter 5 |
| Unit suffix before type suffix | `..._seconds_total`, never `..._total_seconds` | Chapter 5 |
| `_total` on every counter | `snip_links_created_total` | Chapter 4 |
| No label name inside the name | `snip_http_requests_total{method="GET"}` | Chapter 5 |
| `_info` metrics always export `1` | `snip_build_info`, payload in labels | Chapter 5 |
| A Unix timestamp says so | `snip_worker_last_success_timestamp_seconds` | Chapter 8 |
| You did not write `_bucket`, `_sum` or `_count` | The library appends them | Chapter 10 |

The row that settles most arguments is the fifth, and the test behind it is one
question: **if somebody adds up every series sharing this name, is the answer a
sentence you would sign your name to?** `sum(snip_http_requests_total)` is "how
many requests Snip has handled" — true. `sum(snip_get_requests_total)` would be
true and *incomplete*, with nothing in the data announcing the missing half. A
label you do not group by is aggregated away and the total stays right; a name
split you do not know about is missing, and the total is quietly wrong.

The prefix rule has one deliberate exception in the lab:
`obslab_backup_last_success_timestamp_seconds`, written by
`lab/scripts/backup-example.sh`, is a fact about the lab host rather than about
any service, so there is no application to name.

### Labels

Admit a label only if **all four** hold. Three passes and one failure is a
failure.

| Check | Fails when | Where |
|---|---|---|
| The value set is bounded and known at deploy time | It grows with users, traffic or time | Chapter 7 |
| You would filter or group by it in a query or alert | You cannot name the panel or rule | Chapter 7 |
| It does not identify one user, request, session or entity | It is an ID of any kind | Chapter 7 |
| It is not derivable from a target label | You emitted `env` yourself | Chapter 5 |

Two more, absolute rather than a judgment call:

- **No unit and no metric type in a label.** A `snip_request_duration` carrying a
  `unit` label valued `ms` and `s` lets any query that forgets to match on `unit`
  average milliseconds together with seconds, and the answer looks reasonable.
- **Never emit `job`, `instance`, `env`, `cluster` or `region` from application
  code.** Prometheus keeps its own `job` and `instance` and renames yours to
  `exported_job` and `exported_instance`. The other three describe where the code
  is running, which is the deployer's fact, not the code's. Label names beginning
  with `__` are reserved by Prometheus outright.

### Cost, and the last look before merge

| Check | Pass | Where |
|---|---|---|
| The series product is computed and written down | A number, not "not many" | Chapter 7 |
| The histogram multiplier is inside that number | `(boundaries + 1) + 2` per combination | Chapter 7 |
| Buckets are justified against a stated threshold | `0.3` exists because the objective is 300 ms | Chapter 10 |
| Combinations known in advance are pre-initialized to zero | A blank panel is not a quiet service | Chapters 9, 16 |
| Anything per-request is an exemplar, not a label | Trace IDs cost no cardinality at all | Chapter 29 |

Published guidance puts numbers on the first row: keep a metric's cardinality
below 10 where you can, and treat anything over 100 — or able to grow that large
— as a design to revisit. Both numbers count the **series of one metric on one
target**, the whole product, not the number of labels.

!!! pitfall "Budgeting a histogram as if it were a counter"
    The multiplier applies to the product of the labels, not to the metric.
    Snip's twelve observed `(route, method, code)` combinations cost 12 series as
    a counter. The same twelve on a histogram with thirteen finite boundaries
    cost 12 × 16 = 192. A label set that was fine on a counter has to be
    justified again from scratch on a histogram, and the honest move is usually
    to carry fewer labels on the histogram than on the counter.

## Base units

The unit lives in the name and nowhere else, because Prometheus stores float64
samples with no unit attached.

| Quantity | Base unit | Note |
|---|---|---|
| Time | `seconds` | Never milliseconds |
| Bytes | `bytes` | Also for bits — always export bytes |
| Fraction | `ratio` | Values 0–1, never 0–100 |
| Temperature | `celsius` | Preferred over kelvin |
| Length | `meters` | |
| Mass | `grams` | Preferred over kilograms |
| Voltage | `volts` | |
| Electric current | `amperes` | |
| Energy | `joules` | As a counter; `rate()` then yields watts |

`_percent` is the frequent violation. Two services in one estate will disagree
about whether 5% is `5` or `0.05`, and no threshold works for both. Store the
ratio, and let Grafana's *Percent (0.0–1.0)* unit multiply at display time.

## Label values that are always wrong

| Never a label value | Why | Use instead |
|---|---|---|
| `user_id`, `email` | Grows with the number the business wants to grow | An aggregate, or a database |
| `session_id`, `request_id` | One series per event, kept forever | An exemplar, or a log |
| `trace_id` | The same, and exemplars exist for exactly this | An exemplar |
| `order_id`, any primary key | Unbounded by construction | A bounded status or type |
| The raw URL path | `/l/8134` and `/l/abc9x2` are two series | The templated route |
| The raw error string | Stack frames mint series | A bounded `reason` |
| Any UUID or generated hostname | Churns on every restart | A target label |

Snip's defense is structural rather than careful: unrecognized paths collapse to
`other`, and each route template is bound once, at wiring time, so no code path
exists that could emit `/l/8134`.

## The worked example

One instance of `snip-api` in its finished state, costed from the label value
sets in the lab spec.

| Family | Combinations | Series each | Subtotal |
|---|---|---|---|
| `snip_http_requests_total` | 12 observed | 1 | 12 |
| `snip_redirects_total` | 3 (`outcome`) | 1 | 3 |
| `snip_cache_lookups_total` | 2 (`result`) | 1 | 2 |
| `snip_links_created_total` | 1 (no labels) | 1 | 1 |
| `snip_links_active` | 1 (no labels) | 1 | 1 |
| `snip_build_info` | 1 per build | 1 | 1 |
| `snip_http_request_duration_seconds` | 12 | 16 | 192 |
| `snip_db_query_duration_seconds` | 3 (`operation`) | 14 | 42 |
| **Ceiling, one instance** | | | **254** |

Two rows carry the lesson. `snip_build_info` has three labels and one series,
because the values never change inside one build — cardinality counts
combinations that occur, not labels declared. And the two histograms are 234 of
the 254: thirteen finite boundaries plus `+Inf` is 14 bucket series, plus `_sum`
and `_count` is 16 per combination.

The same arithmetic on `loadgen_request_duration_seconds` is the one this book
measured end to end: 6 `(route, method)` pairs × (11 finite + `+Inf` + `_sum` +
`_count`) = **84 series**, confirmed against the running stack.

Now reconcile. A budget has three blocks, and readers get it wrong by counting
only the first:

```promql
count({job="snip-api", __name__=~"snip_.*"})
```

```promql
count({job="snip-api", __name__=~"go_.*|process_.*"})
```

```promql
count({job="snip-api", __name__=~"up|scrape_.*"})
```

The first you derive. The second you **measure** — it is set by your client
library and language runtime, moves on an upgrade you did not write, and has no
value worth memorizing. The third is fixed at five per target.

Expect the measured total to sit under the ceiling. On the stack this book was
measured against, the whole `snip-api` job held **170** series: histograms are
not pre-initialized, so a `(route, method, code)` combination that has never
occurred has no bucket series at all. A product is a ceiling, not a measurement.

## The blank worksheet

Copy this into the pull request. The lab's template is
`lab/exercises/ch07-worksheet.md`, and the single figure it produces belongs in
`lab/docs/cardinality-budget.md`. Do the arithmetic before you query: the value
is in the gap between your figure and the real one, and it does not work
backwards.

**1. Every family this job exposes.** Not only the ones you wrote.

| Family | Yours, or the library's? |
|---|---|
| | |

**2. Combinations per family.** Write out each label's value set and multiply.
Then write one sentence on why the observed count is smaller than the product.

| Family | Labels | Value counts | Combinations |
|---|---|---|---|
| | | | |

**3. Histograms, multiplied out.** State the rule in your own words first.

| Histogram | Boundaries | Series per combination | Subtotal |
|---|---|---|---|
| | | | |

**4. Replicas.** Everything above is per instance. Multiply.

**5. The figure.** Add the three blocks, write the total down, and only then run
the reconciliation queries.

**6. The label you wanted and rejected.** Name it. What would it have told you?
What bounds its value set — and if the answer is "our current traffic pattern",
that is not a bound. What does it multiply at production traffic, rather than lab
traffic? What will you do instead?

**7. The one you found in somebody else's service.** Metric and label, distinct
values today, distinct values available, and the sentence you would put in the
pull request.

Step 6 is not optional, and neither is its difficulty: a design rule you have
only ever applied to labels you did not want is a rule you have not applied.

!!! selfcheck "Self-check"
    The naming half of this appendix is enforced mechanically. `make verify-ch05`
    walks every `snip-api` metric name for a buried label name, and every
    `snip_`, `loadgen_`, `catalog_` and `pager_` name for anything
    duration-shaped that does not end in `_seconds`, or anything ending in `_ms`
    or `_percent`; it must print `ch05 OK`. The arithmetic half is
    `make verify-ch07`, which compares the figure on your `TOTAL:` line against
    `count({job="snip-api"})` and passes within ten per cent. On a fresh clone it
    fails until you write a figure, and that is the file doing its job.
