# Chapter 9 — Ratios, Arithmetic, and the Series That Isn't There

The error-ratio panel you built in Chapter 3, "Your First Dashboard: The Early
Win", has two failure modes, and only one of them looks like a failure.

The first is loud. You aim the chaos injector at Snip, the panel climbs, you
turn the injector off, the panel falls. That is the panel working. The second
is quiet: on a perfectly healthy afternoon the panel says **No data**, and
somebody walking past the screen reads that as "nothing is wrong". They are half
right. Nothing is wrong with *Snip*. Something is wrong with the question — and
the same wrongness, in a different hat, is why a thirty-day availability number
can read better than the month actually was, and why an alert on a service that
has stopped serving traffic never fires. Not fires late. Never fires.

This chapter is about combining two time series into one number. Half of it is
mechanics: the arithmetic, the comparisons, the set operators, and what happens
to a metric name along the way. The other half is the two ways a ratio lies to
you — by averaging when it should be dividing, and by returning nothing when it
should be returning zero. Neither one raises an error.

!!! objectives "Objectives"
    After this chapter you can:

    - Write vector–scalar and vector–vector arithmetic and predict the label
      set of the result.
    - State the metric-name dropping rules for arithmetic and comparison,
      including what `bool` and `on(...)` change.
    - Use `and`, `or` and `unless`, and say why they never take a group
      modifier.
    - Compute an error ratio correctly, and show numerically that `avg(a/b)`
      disagrees with `sum(a)/sum(b)`.
    - Make a ratio panel read a truthful `0` instead of going blank when there
      are no errors.
    - Detect a series that has stopped existing, with `absent()` and
      `absent_over_time()`.

## Where the lab is

Everything here runs against the stack as Chapter 8, "Aggregation: `sum`,
`without`, and the Rate-Then-Aggregate Law", left it. One file changes in this
chapter — a dashboard — and one is added: `lab/scripts/verify-ch09.sh`, which
the self-check at the end runs.

```bash
cd lab
git checkout ch09
make up
```

The `ch09` tag already contains this chapter's edits: the guarded ratio query
and two new panels in `lab/dashboards/snip-red.json`. If you would rather type
them yourself, stay on `ch08`.

Snip answers on `http://localhost:8000/`, Prometheus on
`http://localhost:9090/`, Grafana on `http://localhost:3000/`. Put the load
generator into a known state — the response echoes the whole of it back:

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"rps":20,"route":"mix","error_ratio":0}' \
  localhost:8089/control
```

That is twenty requests per second across the load generator's fixed mix — 80%
`GET /l/{code}`, 10% `GET /links/{code}`, 5% `POST /links`,
5% `GET /healthz` — plus a slow trickle outside the mix: one
request to `/` and one to a path Snip does not route, every thirty seconds. The
unrouted one is recorded as `route="other"` and always answers 404. Keep that
trickle in mind; it does a great deal of work later on.

Give the stack five to ten minutes before you read numbers off it: the load
generator replays short codes it created earlier, and that pool needs a few
minutes to fill.

Then run one query, because half of this chapter depends on the answer:

```promql
sum by (instance) (
  rate(snip_http_requests_total{job="snip-api"}[5m])
)
```

```text
{instance="snip-api:8000"}                                20.07
{instance="snip-api-b:8000"}                                  0
```

One replica is carrying everything and the other is carrying nothing. That is
not a fault. Look at `lab/compose.yaml`: `loadgen` is configured with
`LOADGEN_TARGET_URL: http://snip-api:8000`, one container's name, and nothing
sits in front of the pair to spread requests between them. Chapter 12,
"`prometheus.yml` in Full: Service Discovery and Relabeling", retires
`snip-api-b` in favor of a reverse proxy and a scalable `snip-api`. Until then
the second replica is scraped, healthy and idle.

Now notice what it is *not* doing: it is not missing. It has all twelve of its
`snip_http_requests_total` series, every one sitting at exactly zero, because
Chapter 7, "Labels, and the Cardinality Arithmetic You Must Do First", had the
application create them at startup. That zero could so easily have been a
nothing instead, and telling those two apart is the whole second half of this
chapter.

One convention for the listings. The Prometheus Query page's **Table** tab
prints the full label set on every row; to fit the page, labels that are the
same on every row of a listing — `env="lab"`, usually `job="snip-api"` — have
been dropped. Yours will show them.

## Arithmetic, and what it costs the metric name

Start with the simplest binary operation there is: a vector on the left, a
plain number on the right.

`rate()` gives you requests per second. Somebody in a meeting wants requests per
minute. That is a multiplication:

```promql
rate(snip_http_requests_total{job="snip-api",
  route="/l/{code}", code="302"}[5m]) * 60
```

```text
{code="302", instance="snip-api:8000", method="GET",
 route="/l/{code}"}                                       947.6
{code="302", instance="snip-api-b:8000", method="GET",
 route="/l/{code}"}                                           0
```

Sixteen redirects a second on the busy replica — 80% of twenty — which is a
little under 960 a minute. And a flat, honest zero on the idle one.

Now look at what is missing from those rows. Before the multiplication they read
`snip_http_requests_total{...}`. After it they are anonymous label sets.

That is neither a bug nor cosmetic. A metric name is a promise about what a
number means and what unit it is in. `snip_http_requests_total` promises "a
monotonically increasing count of requests". Divide it by five minutes and
multiply by sixty and the promise is void: the value is now a rate in requests
per minute, and keeping the old name would be a lie every downstream reader
would believe. PromQL refuses to tell it. Chapter 2, "What's Actually on the
Wire", showed that the metric name is a reserved label called `__name__`;
**every arithmetic operator deletes it**, and so does every aggregation and
every function that changes a value. The functions that only rearrange labels or
ordering — `label_replace`, `label_join`, `sort` — leave the name alone, and you
meet two of those at the end of this chapter.

The rest of the label set survives untouched — `instance`, `route`, `method`,
`code`, `env`, `job`. That matters, because the label set is what the *next*
operator will match on.

### Two vectors, and the matching rule

Now put a vector on both sides. Snip counts cache lookups with
`snip_cache_lookups_total{result="hit"|"miss"}`, and a cache hit ratio is an
obvious thing to want. Here is the obvious way to write it, which is wrong:

```promql
rate(snip_cache_lookups_total{job="snip-api", result="hit"}[5m])
/
rate(snip_cache_lookups_total{job="snip-api"}[5m])
```

```text
{instance="snip-api:8000",   result="hit"}                    1
{instance="snip-api-b:8000", result="hit"}                  NaN
```

A cache hit ratio of exactly 1.0 on the busy replica — not a rounding artifact,
exactly 1, at every timestamp, no matter what the cache is doing — and `NaN` on
the idle one.

Here is why. When both sides of a binary operator are instant vectors, PromQL
performs **vector matching**: for each element on the left it looks for an
element on the right with an identical label set, `__name__` excluded. The left
side has two elements, both carrying `result="hit"`. The right side has four — a
hit and a miss per replica. `{instance="snip-api:8000", result="hit"}` on the
left finds exactly one twin on the right: itself. It divides itself by itself.
The misses have no partner on the left, so they are discarded without comment.
On the idle replica the same self-division happens with zero on both sides, and
zero divided by zero is `NaN`.

!!! jargon "Vector matching"
    The rule PromQL uses to decide which element on the left of a binary
    operator pairs with which element on the right. The default, and the only
    kind this chapter uses, is **one-to-one**: two elements match when their
    label sets are identical after the metric name is set aside. Anything
    unmatched on either side is silently dropped from the result. Chapter 11,
    "Joins, Info Metrics, and the Rest of PromQL", covers the modifiers that
    change the rule.

The fix is not a modifier. It is to make both sides *have the same shape* before
they meet, by aggregating each one to the label set you want the answer in. For
a whole-service number, that label set is empty:

```promql
sum(rate(snip_cache_lookups_total{job="snip-api",
  result="hit"}[5m]))
/
sum(rate(snip_cache_lookups_total{job="snip-api"}[5m]))
```

```text
{}                                                       0.9937
```

Yours will sit somewhere in the nineties — Snip writes each new link into the
cache as it creates it, so a replayed short code is nearly always a hit. One
element on the left, one on the right, both with no labels at all, so they
match, and the result is a single number with no labels. Chapter 8 taught
`without` as your default habit because it preserves the dimensions alert
routing needs. This is that habit's exception: a whole-service ratio wants
*every* dimension gone, and a bare `sum(...)` says exactly that.

!!! trap "The ratio that is always exactly 1"
    Divide two `rate()` vectors that you have not aggregated, and PromQL matches
    each series against itself on the full label set:

    ```text
    {instance="snip-api:8000",   result="hit"}              1
    {instance="snip-api-b:8000", result="hit"}            NaN
    ```

    It never blanks, it never spikes, it has plausible-looking labels, and it is
    not a ratio of anything. If a panel called "error ratio" or "hit ratio" is
    pinned at exactly 1.000 and refuses to move, this is why: you divided a
    thing by itself.

### When the metric name survives

Arithmetic always drops the name. Comparison is more subtle, and the rules are
worth having in one place. There are only four of them.

| Operation | Metric name in the result |
|---|---|
| Arithmetic (`+ - * / % ^`) | always dropped |
| Comparison, plain | the left-hand side's name is kept |
| Comparison with `bool` | dropped |
| Either, with `on(...)` | dropped; only the named labels survive |

Check the last row yourself in ten seconds:

```promql
up{job="prometheus"} == on(job) up{job="prometheus"}
```

```text
{job="prometheus"}                                            1
```

The `on(...)` row is a consequence rather than a special case: `on(...)` says
"the result is identified by exactly these labels", and `__name__` cannot appear
in that list, so it goes — along with `instance` and `env`. There is a fifth
corner: with `group_right`, the surviving name is the *right* side's, because
that modifier makes the right side the one that supplies the result's identity.
`on()`, `group_left` and `group_right` are Chapter 11's subject. The one-line
check above is the only place this chapter uses `on()`, and the two group
modifiers do not appear again.

## Comparison, and the `bool` modifier

`== != > < >= <=` do something that surprises people coming from other query
languages. They do not return true and false. **They filter.**

```promql
up == 1
```

```text
up{instance="catalog:8081",    job="catalog"}                 1
up{instance="loadgen:8089",    job="loadgen"}                 1
up{instance="localhost:9090",  job="prometheus"}              1
up{instance="snip-api-b:8000", job="snip-api"}                1
up{instance="snip-api:8000",   job="snip-api"}                1
up{instance="snip-worker:8090",job="snip-worker"}             1
```

Six rows, because all six targets are up. The comparison did not produce six
`true` values; it took the six elements of `up`, kept the ones where the
comparison held, and threw the rest away. The values you see are the *original*
values, not booleans. And the metric name `up` is still there, exactly as the
table promised.

Stop one of the replicas and run it again:

```bash
docker compose stop snip-api-b
```

Now `up == 1` returns five rows. Not five ones and a zero — five rows. The
failing target did not become false, it became absent from the result. That is
the entire mental model: a comparison is a filter over a set, and the result is
a smaller set. (`up` itself still has six elements. The target is written into
`prometheus.yml` by hand, so Prometheus keeps trying an address nobody answers
on and keeps recording a `0`. What *does* vanish is `snip_http_requests_total`
for that instance, because a failed scrape writes no samples — Chapter 2's
staleness lesson, doing its work.)

Add `bool` and the behavior changes completely:

```promql
up == bool 1
```

```text
{instance="catalog:8081",    job="catalog"}                   1
{instance="loadgen:8089",    job="loadgen"}                   1
{instance="localhost:9090",  job="prometheus"}                1
{instance="snip-api-b:8000", job="snip-api"}                  0
{instance="snip-api:8000",   job="snip-api"}                  1
{instance="snip-worker:8090",job="snip-worker"}               1
```

Every element survives, the values become 1 and 0, and the metric name is gone.
Start the replica again before you go on:

```bash
docker compose start snip-api-b
```

The difference decides which one you want, and the decision is always the same
shape.

*Use the plain comparison when you want a set of bad things.* An alerting rule
fires one alert per element its expression returns, so `up == 0` returning
nothing means "nothing is down" and returning two rows means "these two are
down". A `bool` there would return a row for every target, always, and the
alert would fire permanently.

*Use `bool` when you want to count or average over the outcome.* This is a
number, and it is a number a plain comparison cannot produce:

```promql
avg(up == bool 1)
```

```text
{}                                                            1
```

The fraction of targets that are up. With one replica stopped it reads
`0.8333`. Written without `bool`, `avg(up == 1)` averages the surviving
values — all of which are 1 — and therefore reads 1.000 while a sixth of the
fleet is on fire.

Hold on to that shape. Chapter 20, "SLIs, SLOs and Error Budgets", builds a
service level indicator out of exactly this move. A comparison that filters
cannot be aggregated into a proportion, because the denominator has already
been thrown away.

One rule to memorize: **between two plain numbers, `bool` is mandatory.**
`1 > 2` is rejected before it runs:

```text
parse error: comparisons between scalars must use BOOL modifier
```

`1 > bool 2` is `0`.

## `and`, `or`, `unless`

Three operators work only between two instant vectors, and they do not touch
values at all. They decide which elements of the left-hand side survive.

- **`and`** keeps the elements of the left that have a match on the right.
  Intersection.
- **`or`** returns all of the left, plus those elements of the right that had no
  match on the left. Union, left-biased.
- **`unless`** keeps the elements of the left that have *no* match on the right.
  Complement.

Matching is one-to-one on the full label set, exactly as it is for arithmetic.
For `and` and `unless`, values and metric names come from the left, because only
left-hand elements ever survive. `or` is different: left-hand elements come
through unchanged, and so do the *unmatched right-hand ones*, carrying their own
values and their own metric names. That is precisely what makes the guard later
in this chapter work.

`and` is how you gate an expression on something else being true. An error rate
from a route with two requests an hour is noise; suppress it unless there is
real traffic:

```promql
sum by (route) (rate(snip_http_requests_total{job="snip-api",
  code=~"5.."}[5m]))
and
sum by (route) (rate(snip_http_requests_total{
  job="snip-api"}[5m])) > 5
```

```text
{route="/l/{code}"}                                           0
```

The right-hand side is a filter: the routes carrying more than five requests per
second. At 20 rps only `/l/{code}` clears it — the next busiest route,
`/links/{code}`, runs at two — so `and` keeps that route's error rate and
discards `/links`, the other route that can produce a 5xx. The value you get
back is the error rate, from the left; the right-hand side contributed nothing
but a decision.

Choose the threshold with the mix in mind: at 20 rps `/links` is served exactly
one request per second, so a `> 1` gate would flicker it in and out of the
result between evaluations.

`unless` is the mirror image, and it is how exclusions get written:

```promql
sum by (route) (rate(snip_http_requests_total{job="snip-api"}[5m]))
unless
sum by (route) (rate(snip_http_requests_total{job="snip-api",
  route="/healthz"}[5m]))
```

Five routes, with the health check removed. You could have written that as a
matcher — `route!="/healthz"` — and for this example you should. `unless` earns
its keep when the thing you are excluding is *computed* rather than named: a
set of series that some other expression produced, which no matcher can
describe.

`or` is the one this chapter is really about, and it arrives shortly.

None of the three accepts `group_left` or `group_right`. Type one and you get:

```text
parse error: unexpected <group_left>
```

The reason is worth extracting from the label-set model rather than memorizing.
A group modifier exists to solve one problem: an element on the "one" side has
to be *combined with* several elements on the "many" side, and the modifier says
which side is which, so that the arithmetic can be applied repeatedly and the
results can still be told apart. But `and`, `or` and `unless` never combine two
values. They compute a membership test and hand back the left-hand element
unchanged. There is no second value to fold in and no result whose identity is
in doubt, so there is nothing for the modifier to say.

## The error ratio, done correctly

You now have every part. The correct pattern is three steps, and they are always
in this order.

1. `rate()` each counter, per series, so counter resets are handled where they
   happen.
2. Aggregate the numerator and the denominator **separately**, to the same label
   set.
3. Divide.

Turn the injector on so there is something to measure:

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"error_ratio":0.30}' localhost:8089/control
```

Now wait five minutes. Rates have memory: a `[5m]` rate ninety seconds into an
outage has seen ninety seconds of outage and three and a half minutes of calm.
Then:

```promql
sum(rate(snip_http_requests_total{job="snip-api",
  code=~"5.."}[5m]))
/
sum(rate(snip_http_requests_total{job="snip-api"}[5m]))
```

```text
{}                                                       0.2550
```

About a quarter of all requests are failing, and the quarter is arithmetic
rather than luck. The injector fails 30% of the two routes that are allowed to
return a 500 — `GET /l/{code}` and `POST /links` — and those two are 85% of the
mix. Thirty percent of eighty-five percent is 25.5%; the health checks, the
detail route and the trickle on `/` and `other` are the other fifteen, and they
never fail. Your reading converges on that figure as the window fills — a window
half inside the injection reads about half of it.

For a per-route breakdown, aggregate both sides the same way and the matching
takes care of itself:

```promql
sum by (route) (rate(snip_http_requests_total{job="snip-api",
  code=~"5.."}[5m]))
/
sum by (route) (rate(snip_http_requests_total{job="snip-api"}[5m]))
```

```text
{route="/l/{code}"}                                      0.3007
{route="/links"}                                         0.3191
```

Two rows, both near 30%, because that is the dial you turned. `/links` carries
one request a second against the redirect route's sixteen, so it jitters more —
sixty requests in a minute is a small sample.

Note what is *not* in that result: the four routes with no errors. Remember
that. It is the second half of the chapter.

## `avg(a/b)` is not `sum(a)/sum(b)`

Now the mistake that survives code review, because both forms return a plausible
number and neither one errors.

Turn the injector off. You do not need it: the lab has a permanent, honest skew
in it already — the 404 ratio. Recall the trickle. `route="other"` receives one
request every thirty seconds and every single one is a 404, while `/l/{code}`
receives sixteen a second and almost none of them 404. Two populations, wildly
different sizes, wildly different failure ratios. That is exactly the shape that
makes averaging a ratio dangerous.

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"error_ratio":0}' localhost:8089/control
```

**Before you run anything, write down a prediction.** Which of these two will be
higher, and by roughly how much?

```promql
avg(
  sum by (route) (rate(snip_http_requests_total{job="snip-api",
    code="404"}[5m]))
  /
  sum by (route) (rate(snip_http_requests_total{
    job="snip-api"}[5m]))
)
```

```promql
sum(rate(snip_http_requests_total{job="snip-api",
  code="404"}[5m]))
/
sum(rate(snip_http_requests_total{job="snip-api"}[5m]))
```

Now measure. On a settled lab at 20 rps:

```text
avg of the per-route ratios                              0.3333
ratio of the sums                                        0.0016
```

Two hundred times apart. Both queries are valid PromQL, both are computed from
the same samples over the same window, and neither is a bug.

They answer different questions. Start from the middle of the first expression,
which is worth looking at on its own:

```promql
sum by (route) (rate(snip_http_requests_total{job="snip-api",
  code="404"}[5m]))
/
sum by (route) (rate(snip_http_requests_total{job="snip-api"}[5m]))
```

```text
{route="/l/{code}"}                                      0.0000
{route="/links/{code}"}                                  0.0000
{route="other"}                                          1.0000
```

Three routes: one that is entirely 404 and carries a thirtieth of a request per
second, and two that are essentially never 404 and carry eighteen requests per
second between them. `avg` gives each of those three rows one equal vote, so the
tiny route drags the answer to a third. `sum(a)/sum(b)` weights every *request*
equally, so the tiny route contributes a thirtieth of a request per second to a
numerator whose denominator is twenty.

(Leave the lab running for an hour and `/l/{code}` creeps off zero — short
links expire after ten minutes, and the load generator keeps replaying codes
that have died. The average drifts to `0.34`, `0.35`, which changes the
arithmetic not at all.)

The first asks **"how bad is a typical route?"** The second asks **"how bad is a
typical request?"** A dashboard, a service level objective and an alert that
wakes somebody up all want the second, every time, because a user is a request
and not a route.

!!! pitfall "Averaging a ratio"
    `avg(a/b)` computes an unweighted mean of ratios. Any grouping that has one
    low-volume member with an extreme ratio — a bot-scanned 404 path, a debug
    endpoint, a replica that started a minute ago and has served four
    requests — moves that mean a very long way. The fix is never a smarter
    average. It is to aggregate the numerator and the denominator separately
    and divide once, so that the weighting is done by the arithmetic instead
    of by accident.

There is a second thing wrong with the average, hiding in that listing. Six
routes receive traffic. Only three appear. The three that have never returned a
404 — `/`, `/healthz` and `/links` — have no series on the numerator, so
one-to-one matching drops them and the "average" is taken over three survivors
rather than six routes. Included at 0.0, they would bring it to 0.1667. It was
not even an average of the right set.

### Build the comparison as a panel

Put all four expressions on one screen so they can never drift apart again. As
this chapter's checkout leaves it, `lab/dashboards/snip-red.json` carries a
**table** panel — one that prints a row per returned series rather than drawing
a line — titled *Four ways to write one ratio*, with four instant queries and
these legends:

- `A — naive, un-aggregated (one-to-one)`
- `B — sum(a) / sum(b), whole service`
- `C — avg of the per-route ratios`
- `D — the per-route ratios themselves`

Query A is the un-aggregated division, applied to 404s: six rows, one reading
exactly `1` for the busy replica's `other` route and five reading `NaN`. B is
the one you would put on a wall. C is two hundred times higher than B. D is the
three rows C averaged.

Then, in `lab/exercises/ch09-ratios.md`, write two paragraphs reconciling the
numbers. Not "they differ" — *why* they differ, and which one you would show to
somebody deciding whether to roll back a deploy. Chapter 20 asks you for that
number under a different name, and you will want to have argued it out once
already.

## The series that isn't there

Set the error injector to zero and leave it there. Watch the error-ratio panel
on the *Snip RED* dashboard for a couple of minutes while the rate window
drains. It drops to a solid line at zero and stays there — which is the behavior
you want, and it is not free. It reads zero because two people made it read zero
on purpose: the application pre-creates the series it knows it can produce, and
this chapter's panel query carries a guard for the ones it cannot. Both
mechanisms are worth understanding before you meet a service that has neither.

Ask for a ratio on a combination that has genuinely never occurred.
`GET /links/{code}` answers 200 and 404 and nothing else; a 500 on that route is
not a thing Snip can produce, so nobody pre-created the series:

```promql
sum(rate(snip_http_requests_total{job="snip-api",
  route="/links/{code}", code="500"}[5m]))
/
sum(rate(snip_http_requests_total{job="snip-api",
  route="/links/{code}"}[5m]))
```

```text
Empty query result
```

Not zero. *Nothing.* The denominator is a healthy two requests per second, but
the numerator selector matches no series at all, so `sum()` over an empty vector
produces no element, the division has nothing on its left to match, and the
result is the empty vector. In Grafana that panel reads **No data**, in the same
grey as a panel whose data source is misconfigured.

!!! trap "The panel that goes blank when the service is healthy"
    A ratio panel whose numerator counts errors blanks *precisely when there are
    no errors*:

    ```text
    Empty query result
    ```

    The healthier the service, the emptier the panel. Readers learn
    to interpret the blank as "fine", and then one day it is blank because the
    scrape has been failing for six hours and it still looks fine. An alert
    built the same way is worse: an expression that returns no elements produces
    no alert instances, so it cannot fire, ever, no matter how bad things get.

!!! ladder "Ladder → rung 7"
    Empty result, metric name definitely right, bare selector definitely
    returning data? Appendix B, rung 7: has this label combination ever
    occurred? A selector for a combination that has never happened is not
    wrong. It is asking about something that has not happened yet.

### Repairing it in the query: `or 0 *`

`or` is a union that keeps the left-hand side and fills in from the right only
where the left has nothing. That is precisely the tool for "use this, or zero if
it is missing" — as long as the zero you supply has the right label set.

```promql
(
  sum(rate(snip_http_requests_total{job="snip-api",
    route="/links/{code}", code="500"}[5m]))
  or
  0 * sum(rate(snip_http_requests_total{job="snip-api",
    route="/links/{code}"}[5m]))
)
/
sum(rate(snip_http_requests_total{job="snip-api",
  route="/links/{code}"}[5m]))
```

```text
{}                                                            0
```

Read `0 * <denominator>` carefully, because it is doing something clever and
slightly sneaky. Multiplying by a scalar keeps the label set and replaces every
value with zero, so `0 * denominator` is *a copy of the denominator's shape, at
value zero*. When the numerator exists, `or` returns it and the zeros are
discarded as matched. When it does not, `or` has nothing on the left and the
zeros come through. Either way the division finds a partner and the panel draws
a line. (`*` binds tighter than `or`, so no inner parentheses are needed; the
outer ones are, because `/` binds tighter than `or`.)

The by-route form is where this really earns its place, because there the
numerator is only partly present:

```promql
(
  sum by (route) (rate(snip_http_requests_total{job="snip-api",
    code=~"5.."}[5m]))
  or
  0 * sum by (route) (rate(snip_http_requests_total{
    job="snip-api"}[5m]))
)
/
sum by (route) (rate(snip_http_requests_total{job="snip-api"}[5m]))
```

Every route that can produce a 5xx keeps its real numerator; every route that
cannot gets a zero carrying its own `route` label, so all six rows appear. The
unguarded form returns two rows and silently omits the other four.

### The other idiom: `or vector(0)`

`vector(0)` is a function that converts a number into an instant vector: one
element, no labels, value 0. You will see it everywhere:

```promql
sum(rate(snip_http_requests_total{job="snip-api",
  route="/links/{code}", code="500"}[5m])) or vector(0)
```

It works here, and it is shorter. But it has a sharp edge that `0 * ...` does
not, and the edge only shows up once your expression carries labels. `vector(0)`
produces an element with **no labels at all**. If the left-hand side is
completely empty, that label-less zero is the whole answer — fine for a
whole-service number, though the result can no longer be routed by `job` or
`route`. If the left-hand side is *partially* present, the label-less zero
matches none of it, so `or` appends it:

```promql
sum by (route) (rate(snip_http_requests_total{job="snip-api",
  code=~"5.."}[5m])) or vector(0)
```

```text
{route="/l/{code}"}                                           0
{route="/links"}                                              0
{}                                                            0
```

Three rows where the guarded form gives six, and one of them is an element no
legend can name and no `by (route)` can group.

Ranked, worst to best:

| Fix | Where it lives | Verdict |
|---|---|---|
| `or vector(0)` | the query | Fine for a label-less scalar; wrong once labels exist |
| `or 0 * <denom>` | the query | Correct at any grouping; verbose |
| Pre-initialize | the application | The real fix; the others patch a symptom |

### The upstream fix: create the series before the event

Both query-side idioms are patches. The series is missing because the
application never created it, and the application could have. Chapter 7 showed
you the code that does it, in `lab/snip/metrics.go`: a loop over the closed list
of every `(route, method, code)` triple Snip can produce, touching each one with
`.With(...)` so that the child series exists at zero from the first scrape.
**IOU from Chapter 3, settled** — that is why the error-ratio panel reads a flat
zero today instead of the **No data** Chapter 3 warned you about.

The rule has a limit, and `zeroInit` respects it: it pre-creates counters, and
it will never pre-create a histogram. A zero-count histogram is sixteen series
saying nothing, which is a bill you pay per label combination — Chapter 10,
"Latency: Histograms Without Tears", shows you the arithmetic.

Count the result:

```promql
count(snip_http_requests_total{job="snip-api"})
```

```text
{}                                                           24
```

Twelve combinations, two replicas, and the count does not creep upward as status
codes happen for the first time. It is the same twelve you reconciled your
series budget against in Chapter 7.

Now take it away and watch. Edit `lab/.env`:

```ini
SNIP_NO_ZERO_INIT=1
```

```bash
make up
```

That restarts both replicas, so every counter starts at zero again. Give it a
minute of traffic and ask:

```promql
snip_http_requests_total{job="snip-api", code="500"}
```

```text
Empty query result
```

The series does not exist. Not zero — absent. `count(...)` drops from 24 to
single figures: only the combinations that have actually happened are there, and
since `snip-api-b` serves no requests it now contributes *none* — the whole
family is missing from its `/metrics`. Paste Chapter 3's unguarded whole-service
error ratio into the Query page and it returns nothing at all: that is the blank
panel, on a service that is running perfectly. The guarded form — the one this
chapter ends on — still reads a solid `0`. That is the argument for the guard,
made on one screen.

Turn the injector on for thirty seconds:

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"error_ratio":0.3}' localhost:8089/control
```

The series springs into existence at the moment of the first 500, and the panel
starts drawing. That is the whole failure in one motion: the metric that tells
you something is wrong is *created by the thing going wrong*. Put
`SNIP_NO_ZERO_INIT` back to `0`, run `make up`, and set `error_ratio` back to
`0`. Chapter 16, "Alerting Rules, and What 'Firing' Actually Means", comes back
to this switch to show the same mechanism silencing an alert.

### The corner nobody warns you about: 0 ÷ 0

Pre-initialization trades one problem for a smaller one, and you have already
met the smaller one twice in this chapter without being told what it was.

Pre-created series never disappear — they sit still. A `rate()` over a flat
counter is 0, and a guarded ratio then becomes `0 / 0`, which in IEEE 754 is
`NaN`. `NaN` is a real sample with a real timestamp, and it propagates: average
a window containing one `NaN` and the average is `NaN`; compare `NaN` against a
threshold and the comparison is quietly false.

You do not need to stop anything to see it. `snip-api-b` has been idle since you
started the lab:

```promql
sum by (instance) (rate(snip_http_requests_total{job="snip-api",
  code=~"5.."}[5m]))
/
sum by (instance) (rate(snip_http_requests_total{
  job="snip-api"}[5m]))
```

```text
{instance="snip-api:8000"}                                    0
{instance="snip-api-b:8000"}                                NaN
```

One honest zero and one `NaN`, and `avg()` over the two is `NaN` — a
whole-service number ruined by a container that is doing nothing wrong. The same
thing happens to *every* replica when traffic stops completely, which over a
thirty-day window means one quiet Sunday morning poisons the month.

The fix is a comparison used as a filter, on the denominator:

```promql
avg(
  sum by (instance) (rate(snip_http_requests_total{
    job="snip-api", code=~"5.."}[5m]))
  /
  (sum by (instance) (rate(snip_http_requests_total{
    job="snip-api"}[5m])) > 0)
)
```

```text
{}                                                            0
```

`> 0` with no `bool` filters: where there is traffic the denominator survives
with its real value, and where there is none it vanishes, so the division has no
right-hand partner and that element is *absent* rather than `NaN`. Absent beats
wrong. A gap in a panel tells the truth about an idle period; a `NaN` poisons
every window that contains it.

!!! warning
    Two guards, two different jobs, and you usually want both. `or 0 *` on the
    numerator handles "this failure has not happened yet". `> 0` on the
    denominator handles "nothing happened at all". Neither substitutes for the
    other.

### `fill()`, and why it stays out of your rules

Prometheus 3.10.0 added modifiers that address this directly: `fill(0)`,
`fill_left(0)` and `fill_right(0)`, written between the operator and its
right-hand operand, supplying a value for unmatched elements instead of dropping
them. They are exactly the right shape for the problem. Type one into the lab's
Prometheus and you get:

```text
parse error: binop fill modifiers are experimental and not enabled
```

They live behind `--enable-feature=promql-binop-fill-modifiers`, and an
experimental feature may change name, syntax or semantics without a
major-version bump — 3.13.0 already shipped one behavioral fix to these. They
are named here so that you can read a blog post from next spring without
confusion, and `or 0 *` is used everywhere instead. Until they stabilize, they
are not a thing to put in an alert that has to work at 3 a.m.

## `absent()` and `absent_over_time()`

There is one more way for a series to be missing, and it matters most: the whole
thing has stopped existing. The process is gone, the scrape is failing, someone
renamed a label. Every expression built on that series returns nothing, and
"nothing" is not an alarm.

`absent()` inverts the polarity. It returns nothing when its argument has any
elements, and a single element with value 1 when its argument is empty.

```promql
absent(snip_http_requests_total{job="snip-api"})
```

```text
Empty query result
```

That empty result is the good news, and it is also the lesson. On a healthy
stack it reads **No data** forever, and a panel that only ever says "No data" is
indistinguishable from a broken one — which is why `absent()` on its own belongs
in an alerting rule and not on a dashboard.

Stop both replicas and run it again:

```bash
docker compose stop snip-api snip-api-b
```

```text
{job="snip-api"}                                              1
```

Two things to notice. It returns 1. And it carries `job="snip-api"` — a label
that no longer exists anywhere in the database, because `absent()` reconstructs
the label set from the **equality matchers** in the selector you gave it. Prove
that without stopping anything, on a metric name that never existed:

```promql
absent(nosuchmetric{job=~"snip.*", env="lab"})
```

```text
{env="lab"}                                                   1
```

The regex matcher contributed nothing. `absent(sum(nosuchmetric))` is worse: it
returns `{}`, because the aggregation erased the labels before `absent()` saw
them. That is a real operational cost — an alert with no labels cannot be routed
to a team. Write `absent()` selectors with explicit `=` matchers.

Start the replicas again:

```bash
docker compose start snip-api snip-api-b
```

For a dashboard, pair it with the union idiom so that the panel always has a
value:

```promql
absent(snip_http_requests_total{job="snip-api"}) or vector(0)
```

This is the one place `or vector(0)` is exactly right: the expression has at
most one element and no labels, so there is nothing for a label-less zero to
collide with. As this chapter's checkout leaves it,
`lab/dashboards/snip-red.json` carries a **stat** panel — one big number —
titled *Are the request series still there?*, with this as an instant query and
`0` mapped to "series present" in green, `1` to "SERIES MISSING" in red. The
panel says something true in both states.

`absent_over_time()` asks the same question of a window:

```promql
absent_over_time(snip_http_requests_total{job="snip-api"}[10m])
```

It returns 1 only if the series had no samples anywhere in the last ten minutes.
For alerting this is the one you want: a missed scrape on every target the
selector covers, a slow reload or a container restart taking eleven seconds can
each make a plain `absent()` fire for one evaluation, and a one-evaluation alert
is noise. With a single-instance selector it takes only one of them.
`absent_over_time(x[10m])` shrugs at all of them and still catches a service
that has genuinely gone.

## Legend hygiene: `label_replace` and `label_join`

Arithmetic strips the metric name, aggregation strips whatever you did not ask
to keep, and by the time an expression reaches a panel its legend is often a
label value nobody meant a human to read. Two functions put readable labels
back.

`label_replace(v, dst, replacement, src, regex)` matches `regex` against the
value of `src` on every element. On a match it sets `dst` to the expansion of
`replacement`, where `$1`, `$2` and named groups refer to the captures. On no
match, **the element is returned unchanged** — the behavior that trips people
up, because a typo in the regex produces no error and no new label, only a
legend that still looks wrong.

```promql
label_replace(
  sum by (instance) (
    rate(snip_http_requests_total{job="snip-api"}[5m])),
  "replica", "replica-$1", "instance", "snip-api-(.+):8000"
)
```

```text
{instance="snip-api:8000"}                                20.07
{instance="snip-api-b:8000", replica="replica-b"}             0
```

The `-b` replica gained a `replica` label reading `replica-b`. The other one did
not match the regex, so it came back untouched, with no `replica` label at all.
Point a panel's legend at `{{replica}}` and one series is named and the other is
blank, which is a very common way to discover that your regex was wrong.

Two details worth knowing. The regex is **fully anchored**, exactly like a
selector matcher — it has to match the whole label value, not a piece of it.
Confirm it in one query:

```promql
label_replace(up{job="prometheus"}, "x", "[$1]",
  "instance", "(local)")
```

No `x` label appears, because `local` is not the whole of `localhost:9090`.
Change the pattern to `(local).*` and `x="[local]"` shows up. Second: setting
`dst` to the empty string **removes** that label — occasionally what you want,
and occasionally the cause of `vector cannot contain metrics with the same
labelset` when the removal makes two elements identical.

`label_join(v, dst, separator, src...)` is the simpler sibling: concatenate
several label values into one.

```promql
label_join(snip_build_info{instance="snip-api:8000"}, "build",
  "-", "version", "commit")
```

```text
snip_build_info{build="1.4.0-a1b2c3d", commit="a1b2c3d",
  goversion="go1.25.14", instance="snip-api:8000",
  version="1.4.0"}                                            1
```

Both replicas run the same image, so a `job="snip-api"` selector returns this
row twice; the `instance` matcher keeps the listing to one. One legend entry
reading `1.4.0-a1b2c3d` instead of two interpolations. Note
that the metric name survived: neither function is an arithmetic operator, and a
function that only touches labels leaves `__name__` alone.

## Rewriting the panel

Time to fix Chapter 3's panel for real. As this chapter's checkout leaves it,
`lab/dashboards/snip-red.json`'s panel *Error ratio (5xx / all)* already reads
the guarded form. The Chapter 8 version was the same expression without the
`or 0 *` clause — two aggregates divided with no guard. Put them side by side:

```promql
(
  sum(rate(snip_http_requests_total{job="snip-api",
    code=~"5.."}[$__rate_interval]))
  or 0 *
  sum(rate(snip_http_requests_total{job="snip-api"}[$__rate_interval]))
)
/
sum(rate(snip_http_requests_total{job="snip-api"}[$__rate_interval]))
```

`$__rate_interval` is still the IOU from Chapter 3; Chapter 13, "Dashboard
Mechanics: Intervals, Panels and Variables", settles it. For now it is the
window Grafana computes for you, and the guard is the only thing that changed:
same unit, same axis limits, same legend. The panel's description carries the
reason for the guard, which is the part that keeps it alive — a future reader
will otherwise delete it as noise.

!!! selfcheck "Self-check"
    With `SNIP_NO_ZERO_INIT=0` in `lab/.env` and the stack up, run
    `make verify-ch09`. It takes about two minutes, sets `error_ratio` to 0, and
    restores your previous setting on the way out. Six assertions pass, and two
    lines are not passes. Both are expected. The script prints each of them on
    one line; they are wrapped here to fit the page, and the passes are elided:

    ```text
    SKIP the naive ratio returns nothing
         — pre-initialisation is on, so the series exists
    FAIL the per-instance error ratio reads 0 with errors off
         — got NaN, want 0

    ch09: 6 passed, 1 failed, 1 skipped
    ch09 FAILED
    ```

    The `SKIP` is the script telling you that pre-initialization is on, so the
    whole-service numerator exists and the naive form reads `0` instead of
    blanking. The `FAIL` is this chapter's own `0 / 0`, in the checker: the
    script averages per-instance ratios, and `snip-api-b` has no traffic to
    divide. Run the `> 0`-guarded version of that expression by hand. It must
    return a single sample of value `0`.

## Common mistakes

**Dividing two vectors you have not aggregated.** The symptom is a ratio pinned
at exactly `1.000`, with a few `NaN` rows for company: one-to-one matching
paired each series with itself. Aggregate both sides to the same label set
first, and check the shapes by running each side on its own before you divide
them.

**Averaging per-thing ratios.** `avg(a/b)` gives a route with one request every
thirty seconds the same vote as a route with sixteen a second. Every dashboard,
every service level objective and every alert wants `sum(a)/sum(b)`. The tell is
a ratio panel that looks far
worse than the service feels and jumps when a low-traffic endpoint hiccups.

!!! pitfall "Reading `bool` as a synonym for `==`"
    `up == 0` in an alerting rule returns one element per down target and
    nothing when all is well — correct. `up == bool 0` returns one element per
    target, always, with value 1 or 0 — so the alert fires permanently, for
    every target, including the healthy ones. The two forms differ by four
    characters and by everything.

**Treating an empty result as a zero.** It is not a zero, and Grafana renders it
as **No data**, which readers interpret as "fine". Guard any ratio whose
numerator counts a failure with `or 0 * <denominator>`, and fix it upstream by
pre-initializing the label values the service knows it can produce.

**Using `or vector(0)` on an expression that has labels.** `vector(0)` has no
labels, so it substitutes only when the left-hand side is *entirely* empty; when
the left is partly present it appends an extra unlabeled row instead. Reach for
it only where the result is a single label-less number — after `absent()`, for
example.

**Forgetting that name-dropping can cause a collision.** Arithmetic, `bool`
comparisons, aggregations and every value-changing function remove `__name__`.
Put two
*different* metrics whose remaining labels are identical into one vector and
Prometheus rejects the query with `vector cannot contain metrics with the same
labelset`. Give them a distinguishing label back with `label_replace` first.

## Summary

Binary operators in PromQL are not the arithmetic you know from a spreadsheet,
because their operands are sets of labeled series rather than numbers. A vector
against a scalar applies elementwise and voids the metric name, because the name
is a promise about a unit. Two vectors match one-to-one on their full label sets
with the name set aside, which is why the fix for a broken ratio is almost never
a modifier and almost always aggregating both sides to the same shape first.
Anything that fails to match disappears with no error and no warning, and that
silence is the most expensive behavior in the language.

The two ratio failures are the reason this chapter exists. Averaging per-thing
ratios answers "how bad is a typical thing", which is a question nobody asked;
dividing two aggregates answers "how bad is a typical request", which is the one
every dashboard, objective and alert means. And a ratio whose numerator counts failures
goes blank exactly when the service is healthy, which teaches everyone who looks
at it to read blank as fine — right up until blank means the scrape died.

The durable takeaways:

- Aggregate the numerator and the denominator separately, to the same label set,
  then divide once. `avg(a/b)` is a different question from `sum(a)/sum(b)`, and
  it is usually the wrong one.
- Arithmetic always drops the metric name. A plain comparison filters and keeps
  the left-hand name; `bool` returns 1 and 0 and drops it. Filter when you want
  a set of bad things, `bool` when you want to count or average an outcome.
- `and`, `or` and `unless` select elements of the left-hand side and never
  combine values, which is why no group modifier can apply to them.
- An empty result is not zero. Guard with `or 0 * <denominator>`, prefer
  pre-initializing the known label values in the application, and use
  `or vector(0)` only where the answer has no labels.
- Pre-initialized counters cannot vanish, so an idle series produces `0 / 0` —
  `NaN`. Filter the denominator with `> 0` so that an idle window produces no
  sample instead.
- `absent()` returns nothing while the series exists; `absent_over_time(x[10m])`
  is the form to alert on. Give both explicit `=` matchers, or the result
  carries no labels to route by.

## Exercises

!!! exercise
    **1. The weighting, measured (core).** With the injector off and the lab
    settled at `rps: 20`, write down which of `avg(...)` and
    `sum(...)/sum(...)` you expect to be higher for the 404 ratio, and by
    roughly what factor. Then run both and record the two numbers. Now set `rps`
    to 200, wait five minutes, and repeat. One number should barely move and the
    other should fall by about a factor of ten. Explain in two sentences which
    is which, and why.

    **2. Three fixes, ranked (core).** Write the whole-service 5xx ratio three
    ways: with `or vector(0)`, with `or 0 * <denominator>`, and with neither
    guard but `SNIP_NO_ZERO_INIT=0` doing the work in the application. Then
    write the by-route version of each and run all six. Rank the three
    approaches and defend the ranking in a paragraph. Your argument must say
    what happens to each one when a *new* status code appears for the first
    time.

    **3. Filter or boolean (warm-up).** Run `up == 1` and `up == bool 1`, then
    stop `snip-api-b` and run both again. Explain the difference in one
    sentence, and name one place each is the right choice.

    **4. Never nothing (core).** Write a single expression that returns `1`
    while Snip is serving traffic, `0` when it has stopped entirely, and *never*
    returns an empty result. Verify all three states: normal, `rps: 0`, and both
    replicas stopped. State which two of the three states your expression cannot
    tell apart, and why that is acceptable on a dashboard but not in an alert.

    **5. A readable legend (warm-up).** Use `label_replace` to turn
    `instance="snip-api-b:8000"` into a label whose value is `replica-b`, and
    point a panel legend at it. Then explain why the other replica's legend is
    empty, and name it too. Remember that the pattern has to match the whole
    label value — and that one `label_replace` cannot do it, because the busy
    replica has no `-b` to capture. You should end with two legend entries,
    neither of them blank.

    **6. Why `and` has no many side (stretch).** Explain, using the label-set
    model rather than "the documentation says so", why `and` cannot take
    `group_left`. Your answer should say what a group modifier is *for*, and
    what `and` does with the right-hand element's value. One paragraph, written
    down, not thought about. Then confirm the premise by typing it:
    `up and group_left up` must answer
    `parse error: unexpected <group_left>`.
