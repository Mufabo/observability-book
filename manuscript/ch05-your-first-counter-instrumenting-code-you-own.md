# Chapter 5 — Your First Counter: Instrumenting Code You Own

Your dashboard is green. It has been green all afternoon. It is green because
every panel on it reads `loadgen_requests_total` — the load generator's own
counter, incremented by the process that *sends* the traffic, not the process
that serves it. If Snip started returning 500s to real users tomorrow while
`loadgen` kept getting 200s on its own narrow slice of routes, that dashboard
would not move.

Snip exports exactly one counter of its own, `snip_http_requests_total`, and it
carries no labels: a single number that goes up, unable to say which route was
hit or what came back. Chapter 3, "Your First Dashboard: The Early Win", was
honest about borrowing the client's numbers for the early win, and it promised
you would fix this. This is the chapter where you start: by the end the counter
knows what came back, on series the service owns.

You are going to open a Go file and read metrics line by line — five families,
about sixty lines — and defend every decision in them. What makes this chapter
longer than sixty lines of code is that almost every decision has a rule behind
it and a consequence attached to breaking it. Where a metric is constructed
decides whether the service survives its second request. What you call it
decides whether anyone can add it up honestly a year from now. At the end you
will break your own `/metrics` endpoint in the one specific way Prometheus 3
punishes hardest, fix it twice, and decide which fix you would defend in review.

!!! objectives "Objectives"
    After this chapter you can:

    - Say where a counter and a gauge belong in a real service and why, and
      see them in Prometheus within one scrape.
    - Apply the naming law: `_total` on counters, base units only, unit suffix
      before type suffix.
    - Use the aggregation-honesty test to decide whether something belongs in
      the metric name or in a label.
    - Explain why a fresh registry is empty, and what you lose when you forget
      to register the runtime collectors.
    - Diagnose a Prometheus 3 scrape that fails on a missing or unrecognized
      `Content-Type`, and name both fixes.
    - List the labels application code must never emit, and say who sets them
      instead.

## Where the lab is, and what you will need

Everything here builds on the stack Chapter 4, "Metric Types Are Contracts",
left you: two `snip-api` containers, the load generator, Valkey, Postgres,
Prometheus, Grafana with the RED dashboard from Chapter 3, and `catalog`.

```bash
cd lab
git checkout ch05
make up
```

`make up` is `docker compose up -d --build`, and this is the first chapter where
the `--build` matters: chapters 1 through 4 changed the compose file, the scrape
config and the dashboards, but never a line of Snip. Three files carry the
work — `lab/snip/metrics.go`, which is new and holds every metric the service
exports; `lab/snip/api.go`, which gains the middleware that feeds them; and
`lab/snip/main.go`, which registers the build-info metric and starts the gauge's
refresh loop.

The `ch05` tag ships all three finished. You are not typing them — the lab never
asks you to edit a source file to make something work — you are reading them and
deciding whether you would have written them the same way.

Leave every `SNIP_*` switch in `lab/.env` at its default for now; the last
section turns one on deliberately. Leave the load generator alone too: it has
been sending Snip about twenty requests per second since Chapter 1, "Ten Minutes
to Your First Metric", in the mix you know — 80 % redirects, 10 % link lookups,
5 % creates, 5 % health checks — and you need traffic to see any of this.

## What a client library actually is

Before you read a line of it, be precise about what the library in front of you
does. The mental model people arrive with is wrong in one specific way: they
think `/metrics` is a log the application writes to. It is not. Nothing is
written anywhere until Prometheus asks.

!!! jargon "Registry, collector, gatherer"
    A **collector** is anything that can be asked "what do you have right now?"
    and answer with a set of metric families. A counter is a collector. So is
    the object that reads the Go runtime's memory statistics. A **registry** is
    a set of collectors, and a **gatherer** is the thing that asks every
    collector in a registry for its current state and merges the answers. A
    scrape is nothing more than an HTTP handler running a gather and rendering
    the result as text.

That definition explains three things at once: why the `/metrics` body is
generated fresh on every request; why an unregistered metric is invisible however
often you increment it, because nobody will ever ask it anything; and why "what
does this service expose?" has an exact answer, which is its registry.

There are two registries in the lab, and they behave differently on purpose.
`snip-api` uses the library's **default registry**, the package-level global.
`lab/snip/main.go` hands it to every constructor:

```go
newBuildInfo(prometheus.DefaultRegisterer, cfg)
```

and the handler serves the matching global gatherer:

```go
return promhttp.HandlerFor(prometheus.DefaultGatherer,
	promhttp.HandlerOpts{
		EnableOpenMetrics: c.OpenMetrics,
		ErrorHandling:     promhttp.ContinueOnError,
	})
```

Neither option is on in the lab's defaults: `EnableOpenMetrics` would offer
OpenMetrics, a second exposition format, alongside the text one, and
`ContinueOnError` degrades the response rather than blanking it when one
collector fails.

`loadgen` does the opposite. `lab/loadgen/main.go` builds an empty registry and
fills it by hand:

```go
reg := prometheus.NewRegistry()
reg.MustRegister(
	collectors.NewGoCollector(),
	collectors.NewProcessCollector(
		collectors.ProcessCollectorOpts{}),
)
```

Both services expose the same runtime families. Count them:

```bash
curl -s localhost:8000/metrics | grep -c '^# TYPE go_'
curl -s localhost:8089/metrics | grep -c '^# TYPE go_'
```

Both print `29`. Do it again for `process_` and both print `9`. The difference
is not in the output — it is in who asked. `snip-api` gets those thirty-eight
families because the default registry arrives with the Go collector and the
process collector already in it. `loadgen` gets them because one `MustRegister`
call put them there. Delete that call and `loadgen`'s `/metrics` drops from
forty-seven families to nine: no `go_goroutines`, no
`process_resident_memory_bytes`, and no `process_start_time_seconds`, which is
how you find out when a process last restarted.

This is the whole of "a fresh registry starts empty", and it is a two-sided
trap. Reach for `prometheus.NewRegistry()` because globals are bad, forget the
two runtime collectors, and you have silently opted out of every runtime metric
your service could have had. Stay on the default registry and you inherit
forty-four series of runtime detail per container that nobody asked for. Count
them yourself with
`count({job="snip-api", instance="snip-api:8000", __name__=~"(go|process)_.+"})`
— `count` returns how many series the selector matched, and this one reads 44.
That is what Chapter 4 made you notice, and what Chapter 12, "`prometheus.yml`
in Full: Service Discovery and Relabeling", will let you throw away at the
scrape instead.

Here is the whole mechanism in one picture. Follow the two arrows into the
registry box, and notice that only one of them starts outside the process.

```text
┌──────────────┐              ┌───────────────────────────┐
│  your code   │  .Inc()      │  registry                 │
│  handlers    │─────────────▶│   ├─ snip_* collectors    │
└──────────────┘              │   ├─ Go collector         │
                              │   └─ process collector    │
┌──────────────┐  GET         └────────────┬──────────────┘
│  Prometheus  │─────────────▶ /metrics    │ gather
│    :9090     │◀────────────  handler ◀───┘ (on every scrape)
└──────────────┘  text body
```

Nothing crosses that diagram until Prometheus makes the request. Between
scrapes, your counters are nothing but numbers in memory.

## Construct once, at startup

Here is the rule, and it has no exceptions worth learning as a beginner:
**construct every metric exactly once, when the process starts.** In Go that
means inside a constructor `main` calls once — never inside a request handler, a
loop, or any function that runs more than once.

Two things go wrong when you break it, and only one of them is the one people
warn you about. The boring one is cost: creating a counter allocates, computes a
descriptor, and takes a write lock on the registry, while incrementing an
existing counter is an atomic add on a float. Construct per request and you have
put a lock in the hot path of every handler to save one line of setup.

The interesting one is that it does not work at all. Suppose `handleCreate` in
`lab/snip/api.go` were written like this:

```go
func (s *server) handleCreate(w http.ResponseWriter, r *http.Request) {
	// WRONG: constructed per request.
	created := promauto.NewCounter(prometheus.CounterOpts{
		Name: "snip_links_created_total",
		Help: "Total short links successfully created.",
	})
	created.Inc()
	// ... store the link, write the response
}
```

That compiles. It passes a unit test that creates one link. It survives your
first manual `curl`:

```console
$ curl -sS -o /dev/null -w '%{http_code}\n' -XPOST \
    localhost:8000/links -H 'Content-Type: application/json' \
    -d '{"url":"https://prometheus.io/docs/"}'
201
$ curl -sS -o /dev/null -w '%{http_code}\n' -XPOST \
    localhost:8000/links -H 'Content-Type: application/json' \
    -d '{"url":"https://prometheus.io/docs/"}'
000
curl: (52) Empty reply from server
```

!!! trap "The second request"
    The first request registers the counter. The second one tries to register
    a second collector with the same fully-qualified name, `promauto` panics
    rather than returning an error, and Go's HTTP server catches the panic,
    logs it, and closes the connection without writing a response. In
    `docker compose logs snip-api`:

    ```text
    http: panic serving 172.19.0.9:41288: duplicate metrics
    collector registration attempted
    goroutine 37 [running]:
    net/http.(*conn).serve.func1()
    ...
    prometheus.(*Registry).MustRegister(...)
    promauto.Factory.NewCounter(...)
    main.handleCreate(...)
    ```

    Every subsequent create fails the same way. The process stays up,
    `GET /healthz` still answers 200 — it is a different route and the panic
    never touches it — `up` stays at 1, and only the one route is broken,
    which is the worst possible failure shape, because nothing you are
    watching notices.

Two requests. That is the entire margin between "works on my machine" and a
handler that never succeeds twice.

The shape that avoids all of this is a constructor that takes the registry as
an argument. That is what `lab/snip/metrics.go` does:

```go
func newAPIMetrics(reg prometheus.Registerer, c *config) *apiMetrics {
	f := promauto.With(reg)

	requestLabels := []string{"method", "code"}
	// ... plus a link_code the SNIP_UNBOUNDED_LABEL switch appends,
	// which chapter 7 makes you price before you may turn it on.

	m := &apiMetrics{
		Requests: f.NewCounterVec(prometheus.CounterOpts{
			Name: "snip_http_requests_total",
			Help: "Total HTTP requests handled by the Snip API, by " +
				"method and response status code.",
		}, requestLabels),
		// ... the rest of the families
	}
	return m
}
```

`promauto.With(reg)` returns a factory bound to one registry, so every
constructor below it registers in the right place and panics loudly at startup
if the same name is written twice. Called once, from `runAPI`, it either
succeeds before the service listens or takes the process down while you are
still watching the terminal.

Then handlers only ever *use* what already exists:

```go
s.m.LinksCreated.Inc()
s.m.CacheLookups.WithLabelValues(resultHit).Inc()
s.m.LinksActive.Set(float64(n))
```

`.Inc()` on a counter, `.Set()` on a gauge, and `WithLabelValues(...)` to pick
which series of a labeled family you mean. That is the whole runtime API you
need for this chapter.

## The naming law

A metric name is a public interface. It will be typed into alert rules by people
who have never read your code, and it outlives the service that emits it.
Prometheus enforces almost nothing, so the conventions do all the work. Four
rules cover nearly every case.

**Every counter ends in `_total`.** Not because Prometheus checks — it does
not — but because `_total` is the only signal a reader gets, from the name
alone, that the raw value is meaningless and only differences carry meaning.
Chapter 4 showed you `catalog_items_processed`: a value that climbs forever,
declared a gauge, with no `_total`. Two conventions broken, one metric, and
every `rate()` over it since has been confident nonsense.

**Base units only.** Seconds, never milliseconds. Bytes, never kilobytes. A
ratio between 0 and 1, never a percentage between 0 and 100. Prometheus stores
float64 samples with no unit attached, so the unit lives entirely in the name
and in your discipline. Mix units across two services and a threshold of "slower
than 0.3" fires on every request against the one recording milliseconds and
behaves correctly against the one recording seconds.

**The unit suffix comes before the type suffix.** `process_cpu_seconds_total`,
already in the lab, is the canonical example: a *counter* of *seconds*. Write
`_total_seconds` and you have described a quantity of totals.

**No label name inside a metric name.** `snip_get_requests_total` and
`snip_post_requests_total` should be one family with a `method` label. Why that
is true rather than merely tidy is the next section.

Applied to the families in this chapter:

| Instead of | Write | Because |
|---|---|---|
| `snip_links_created` | `snip_links_created_total` | counters say so |
| a `_latency_ms` name | a `_duration_seconds` name | base units |
| a `_percent` at 0–100 | a `_ratio` at 0–1 | 0–100 is a trap |
| a `_total_bytes` name | a `_bytes_total` name | unit, then type |

!!! pitfall "The percentage that is 0.05 and 5 at the same time"
    `_percent` looks harmless and costs you an incident. Two services in the
    same estate will disagree about whether 5 % is `5` or `0.05`, and no
    threshold works for both. Store the ratio, name it `_ratio`, and let the
    display layer multiply. Grafana has a unit for exactly this — *Percent
    (0.0–1.0)*, spelled `percentunit`, which you already used on the
    error-ratio panel in Chapter 3. The same trap in a different costume is a
    `unit` label whose values are `ms` and `s`: any query that forgets to
    match on it averages milliseconds together with seconds, and the answer
    looks entirely reasonable.

`make verify-ch05` checks two of these mechanically: it fails if any `snip-api`
metric name contains one of the label names the service uses, or if any name it
walks is duration-shaped without ending in `_seconds`, or ends in `_ms` or
`_percent`. Naming rules nobody can check are naming suggestions.

## The aggregation-honesty test

Here is the test that decides name-versus-label, and it is worth memorizing
because it settles the argument in one question:

> If somebody adds up every series that shares this metric name, is the answer
> a sentence you would sign your name to?

Adding up every series of a family is written `sum(...)` in PromQL. It is one of
the Chapter 3 IOUs and Chapter 8, "Aggregation: `sum`, `without`, and the
Rate-Then-Aggregate Law", teaches it properly. For the test you need only what
it means, not how to write it.

Apply it to the good version. `sum(snip_http_requests_total)` collapses every
method and status code into one number — and every route too, once Chapter 7,
"Labels, and the Cardinality Arithmetic You Must Do First", adds that label —
and that number is "how many requests Snip has handled".
True, useful, and exactly what someone glancing at a top-line panel wants.

Now the bad version. `sum(snip_get_requests_total)` is "how many GET requests
Snip has handled" — which is *also* true, and that is the problem. It is true
and incomplete, and nothing about it announces the incompleteness. The reader
has to know, from outside the data, that `snip_post_requests_total` exists and
must be added. Add a `DELETE` route next quarter and every dashboard and alert
built on that pair silently starts undercounting.

That is the asymmetry. A label you do not group by is *aggregated away*, and
the total stays correct. A name split you do not know about is *missing*, and
the total is quietly wrong.

!!! note "Where a name split is right"
    The test cuts both ways, which is what makes it useful rather than a slogan
    for "always use labels". Two things belong under different names when
    adding them up would be nonsense. `snip_links_active` counts links that
    exist right now; `snip_links_created_total` counts creation events since
    startup. One is a stock, the other is a flow, and their sum means nothing.
    Different units fail the same way. The working rule: same unit, same
    population, and a meaningful total means one name with labels. Otherwise,
    two names.

## Writing the families

Five new metric families arrive in this chapter, and the request counter you
already have gains its labels. Four of the five are walked through below; the
fifth, `snip_redirects_total`, is exercise 1, because arguing a label set out of
a plain description is the only way to find out whether the rules have stuck.
`lab/snip/metrics.go` gathers every `snip_*` family into one file, deliberately,
so that "what does this service expose?" has one place to look and a wrong unit
has one place to be fixed.

### The request counter, and where `code` comes from

`snip_http_requests_total` already exists; this chapter gives it the two labels
that make it useful, and it does so without a single `.Inc()` in a handler. The
client library ships middleware for the most common job in the world:

```go
func (s *server) instrument(next http.Handler) http.Handler {
	countOpts := []promhttp.Option{
		promhttp.WithLabelFromRequest("method", methodLabel),
	}
	// ... plus the matching link_code option under the same switch.
	return promhttp.InstrumentHandlerCounter(
		s.m.Requests, next, countOpts...)
}
```

`InstrumentHandlerCounter` wraps a handler, watches what status code it wrote,
and increments the counter afterwards with `code` filled in for you. That is
where the `code` label comes from: not from a hand-written line, but from the
response the handler actually produced — the only version of the truth worth
counting.

`method` needs one line of help. The middleware lower-cases the method it
derives, and Snip's `method` label is closed at exactly two values, so
`lab/snip/api.go` supplies it through the documented dynamic-label option:

```go
func methodLabel(r *http.Request) string {
	if r.Method == http.MethodPost {
		return "POST"
	}
	return "GET"
}
```

Note what that function does *not* do: it does not pass the request's method
through. The set of values this label can take is two, decided by code, forever.
A label whose values a caller can choose is a label a caller can multiply.

### The templated route

One label is conspicuously missing from `snip_http_requests_total`, and its
absence is the point. `route` is the single most dangerous label you will write,
and Chapter 7 is where it arrives — *after* you have worked out what it costs.
What this chapter builds is the machinery that makes Chapter 7's version safe.

The danger in `route` is entirely in how you compute it. Snip's redirect path is
`GET /l/{code}`, and a request arrives as `/l/Kq7bT2m`. Record the **raw path**
and every short link anyone has ever visited becomes a permanent new time
series, because Prometheus keeps a series alive long after the requests stop.
Record the **templated path** — `/l/{code}`, the pattern the router matched, not
the URL the client typed — and the label has exactly six possible values
forever. `lab/snip/api.go` gets this right by construction: the template is what
the mux was configured with, so it is bound to the handler once, at wiring time.

```go
func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	s.handle(mux, "GET /{$}", routeIndex, false, s.handleIndex)
	s.handle(mux, "GET /healthz", routeHealthz, false, s.handleHealthz)
	s.handle(mux, "GET /l/{code}", routeRedirect, true, s.handleRedirect)
	s.handle(mux, "POST /links", routeLinks, true, s.handleCreate)
	s.handle(mux, "GET /links/{code}", routeLink, false, s.handleDetail)
	s.handle(mux, "GET /", routeOther, false, s.handleNotFound)

	mux.Handle("GET /metrics", newMetricsHandler(s.cfg))
	return mux
}
```

The boolean on each `s.handle` line is whether that route may return a `500`,
which is what the lab's fault switch honors: `/healthz` can be delayed but never
failed.

Three more details are worth stealing. The catch-all is wired with `routeOther`,
whose value is the literal string `other` rather than the path requested — so
when Chapter 7 turns that template into a label value, a scanner looking for
`/wp-login.php` cannot mint series. The front page is `GET /{$}`, Go's
exact-match pattern; without the `{$}` it would swallow every unknown path and
the catch-all would never run. And `/metrics` is registered outside `s.handle`,
so it is never instrumented: a service that measures its own exposition endpoint
is measuring Prometheus, not itself.

### A counter with no labels

`snip_links_created_total` is the simplest metric in the file, and it is worth
seeing exactly how little there is to it:

```go
m.LinksCreated = f.NewCounter(prometheus.CounterOpts{
	Name: "snip_links_created_total",
	Help: "Total short links successfully created.",
})
```

One line in `handleCreate`, on the success path only, after the database insert
has returned without error and before the response is written:

```go
s.m.LinksCreated.Inc()
```

No labels. Not every metric needs them. A creation either happened or it did
not, the failure case is already visible as a `500` on
`snip_http_requests_total{method="POST", code="500"}`, and a label you cannot
name a query for is a label you should not add.

This is also the metric Chapter 4 was waiting for: `SNIP_GAUGE_COUNTER=1`
re-declares it as a gauge — same name, same help string, same monotonically
climbing value, and a `# TYPE` line that now contradicts both. Chapter 4 could
only show you that fault in somebody else's service. Now your own has one.

### A counter with one label

`snip_cache_lookups_total` is the same thing with a closed, two-value label:

```go
CacheLookups: f.NewCounterVec(prometheus.CounterOpts{
	Name: "snip_cache_lookups_total",
	Help: "Total cache lookups performed while resolving a " +
		"short code, by result.",
}, []string{"result"}),
```

`result` is `hit` or `miss`, and nothing else, ever. In `handleRedirect` the two
branches are one line each:

```go
if hit {
	s.m.CacheLookups.WithLabelValues(resultHit).Inc()
} else {
	s.m.CacheLookups.WithLabelValues(resultMiss).Inc()
}
```

Run the aggregation test on it. Summing the family gives "how many times Snip
looked in the cache", which is true and useful. Split it into
`snip_cache_hits_total` and `snip_cache_misses_total` and the hit *ratio*, the
number anyone actually wants, becomes an expression over two families.

The label values are constants, `resultHit` and `resultMiss`, rather than string
literals at each call site. Two call sites and one typo is all it takes to ship
`result="hits"` alongside `result="hit"` for a month.

### A gauge

`snip_links_active` counts short links that exist and have not expired. That is
a fact about the database, not about any one request, so it is not touched from
a handler at all:

```go
LinksActive: f.NewGauge(prometheus.GaugeOpts{
	Name: "snip_links_active",
	Help: "Short links that currently exist and have not expired.",
}),
```

`runAPI` starts a goroutine that refreshes it on a five-second ticker:

```go
go srv.refreshLinksActive(ctx, 5*time.Second)
```

Recomputing it inside every redirect would put a `SELECT count(*)` on the hot
path and make your instrumentation the slowest thing in the handler. This is the
general shape for gauges that describe state rather than events: sample them on
a timer, off the request path, at an interval no longer than your scrape
interval. And remember Chapter 4's warning on every gauge: anything that happens
entirely between two samples did not happen.

### The info metric

`snip_build_info` looks strange the first time and then you see it everywhere:

```go
promauto.With(reg).NewGaugeVec(prometheus.GaugeOpts{
	Name: "snip_build_info",
	Help: "Build information for the running Snip process. " +
		"Always 1; read the labels.",
}, []string{"version", "commit", "goversion"}).
	WithLabelValues(c.Version, c.Commit, runtime.Version()).Set(1)
```

The value is always 1 and carries no information. Everything you wanted is in
the labels, because a Prometheus sample is a float64 and a version string is
not. Chapter 4 named this pattern; here is one. Chapter 11, "Joins, Info
Metrics, and the Rest of PromQL", is where the value 1 earns its keep —
multiplying by 1 is how you attach `version` to every other series from the same
process. It is registered in `main` rather than `runAPI` because it describes
the process, not what the process does, and both roles of the binary export it,
so `snip-worker` will carry the same version label in Chapter 8.

## Labels your application must never emit

Five label names are off limits in application code: `job`, `instance`, `env`,
`cluster`, `region`. Prometheus does not reserve them and nothing stops you.
They are wrong for two different reasons.

`job` and `instance` are attached by Prometheus at scrape time, from the scrape
configuration — that was Chapter 1. If your application emits them too,
Prometheus keeps its own and renames yours to `exported_job` and
`exported_instance`. You now have a label nobody queries, on a metric that looks
fine, and the mismatch only surfaces when a join fails months later. Chapter 12
names the setting that changes this, `honor_labels`, and the one situation where
you would want it.

`env`, `cluster` and `region` are wrong for a better reason: the process does
not reliably know them. It knows what environment variable it was handed, which
is a different thing from where it is running. Hardcode `env="dev"`, ship it to
production, and every production series says `dev` — fixable only by a code
change, a build and a deploy. Set the same label at the scrape and the fix is
one line of YAML and a restart. In this lab it is set on the target, which is
why every series you have queried so far carries `env="lab"` without a line of
Go producing it:

```yaml
  - job_name: snip-api
    static_configs:
      - targets:
          - "snip-api:8000"
          - "snip-api-b:8000"
        labels:
          env: lab
```

The general principle: a label describing *where the code is running* belongs to
whoever deployed it; a label describing *what the code did* belongs to the code.

## Look at the wire first

The stack you started at the top of this chapter is already running every metric
above. Look at the wire before you look at Prometheus: the wire is where you
find out whether the code says what you think it says.

```bash
curl -s localhost:8000/metrics | grep '^snip_'
```

Sixteen lines. Here they are about five minutes after `make up`, on a lab with
nothing injected. Your counters will be different numbers — they depend entirely
on how long traffic has been running — but the *shape* should match line for
line:

```text
snip_build_info{commit="a1b2c3d",goversion="go1.25.14",version="1.4.0"} 1
snip_cache_lookups_total{result="hit"} 3958
snip_cache_lookups_total{result="miss"} 268
snip_http_requests_total{code="200",method="GET"} 776
snip_http_requests_total{code="201",method="POST"} 247
snip_http_requests_total{code="302",method="GET"} 4196
snip_http_requests_total{code="400",method="POST"} 8
snip_http_requests_total{code="404",method="GET"} 38
snip_http_requests_total{code="500",method="GET"} 0
snip_http_requests_total{code="500",method="POST"} 0
snip_http_requests_total{code="503",method="GET"} 0
snip_links_active 245
snip_links_created_total 247
snip_redirects_total{outcome="expired"} 0
snip_redirects_total{outcome="hit"} 4196
snip_redirects_total{outcome="miss"} 29
```

Read across it once and the service tells a coherent story. Every redirect did
exactly one cache lookup, so `3958 + 268` lookups matches `4196 + 29` redirect
outcomes with one request still in flight, and `snip_links_created_total` agrees
with the `201` row. `snip_links_active` sits a link or two under the number
created, and the gap is the sampling interval rather than anything that happened
to the links: the gauge is resampled every five seconds and the lab creates
about one link a second. Nothing has expired yet — a link lives ten minutes by
default and the lab is five minutes old — so watch that gauge for another ten
and it stops climbing. `goversion` is whatever the build used, so the patch
number moves when you rebuild and yours may not read `go1.25.14`.

Eight series for the request counter, which is every `(method, code)`
combination this service can produce and not one more. Three of them read `0`
and have never been anything else. That is not an accident and it is not dead
weight: `lab/snip/metrics.go` creates the known combinations at value zero
before the first request arrives, so a query about errors returns `0` on a
healthy service rather than nothing at all. Chapter 9, "Ratios, Arithmetic, and
the Series That Isn't There", is where the difference between those two answers
turns into a blank panel, and Chapter 16, "Alerting Rules, and What 'Firing'
Actually Means", is where it turns into an alert that can never fire.

Eight, and not twelve: the `route` template is not a label yet. Chapter 7 admits
it and these eight become twelve — six routes crossed with the `(method, code)`
pairs each one can actually produce, which is not six times eight. Doing that
multiplication before writing the label is what Chapter 7 is for.

Now Prometheus. Open the Query page at `http://localhost:9090` and run:

```promql
{__name__=~"snip_.+", job="snip-api"}
```

The Table tab shows every `snip_*` series from both containers, each carrying
`job="snip-api"`, `env="lab"`, and an `instance` of either `snip-api:8000` or
`snip-api-b:8000`. Within one scrape interval — fifteen seconds — everything in
that file is queryable.

Almost every `snip-api-b` counter reads `0`, which is the arrangement from
Chapter 2, "What's Actually on the Wire", doing its job: `loadgen` sends its
traffic to the name `snip-api`, so the second container serves nothing and its
counters sit at the zeros the constructor created. Two metrics are the
exceptions, and they are exceptions for different reasons. Run the first:

```promql
snip_links_active
```

Two rows, both non-zero, both roughly equal, differing only because their
five-second tickers are not in step. A gauge describing the shared database
rather than this process's own work reports the same fact from every container
that asks. That distinction — what this process *did* versus what it can *see* —
decides how you aggregate it later, which is why Chapter 8 spends a section on
`sum` versus `avg`.

Confirm the rest:

```promql
snip_cache_lookups_total{job="snip-api", result="miss"}
```

```promql
snip_build_info
```

Two rows for that last one, one per container, both reading `1` and both
carrying the same three labels — the second exception, and a different kind: a
value set once at startup needs no traffic to be non-zero. When the background
worker arrives in Chapter 8
it will run the same image and add a third — which is exactly what makes the
join in Chapter 11 work across two jobs rather than inside one.

!!! ladder "Ladder → rung 4"
    Nothing there? Rung 4 of the No-Data ladder from Chapter 1: does the metric
    name exist at all? Open the Metrics Explorer and look rather than trusting
    your typing. If the name is absent but `curl` showed it, the scrape is the
    problem, not the query.

## The dashboard was green because it was watching something else

The `ch05` tag ships the repaired dashboard, so two of the three panels you
built in Chapter 3 are already reading Snip's own series when Grafana starts. Open
`lab/dashboards/snip-red.json` and look at the rate panel. Its query used to be
this, with the legend `{{route}}` and the title "Request rate by route":

```promql
sum by (route) (
  rate(loadgen_requests_total{job="loadgen"}[$__rate_interval])
)
```

It is now this, with the legend `all requests` and the title "Request rate":

```promql
sum(
  rate(snip_http_requests_total{job="snip-api"}[$__rate_interval])
)
```

That is a real loss and you should feel it: the panel loses "by route" from its
title along with its breakdown. Snip's counter carries no `route` label yet, so
the honest panel here is the total. It is also exactly the pressure Chapter 7
exists to answer, and the first thing that chapter does is give the breakdown
back — on series you can price.

The third panel is untouched. The p95 still reads
`loadgen_request_duration_seconds_bucket`, because `snip-api` exports no
histogram until Chapter 10, "Latency: Histograms Without Tears" — so a third of
that dashboard is still the client's view, and you should feel that too.

Reading a diff is not the same as feeling the difference, so prove it: break
Snip in a way the load generator cannot see. Snip has a lab backdoor for this, a
set of `X-Snip-*` request headers that let one `curl` inject a fault into
whichever container serves it, enabled by `SNIP_ALLOW_FAULT_HEADERS=1` in
`lab/.env` and cataloged in Appendix A. Never ship one.

```bash
for i in $(seq 1 200); do
  curl -s -o /dev/null -XPOST localhost:8000/links \
    -H 'Content-Type: application/json' \
    -H 'X-Snip-Fail-Ratio: 1' \
    -d '{"url":"https://prometheus.io/docs/"}'
done
```

Two hundred requests, every one a real `500` from the real handler. Now put the
two versions of the error ratio side by side in the Query page — Chapter 3's
first:

```promql
sum(rate(loadgen_requests_total{job="loadgen",
  code=~"5.."}[5m]))
/
sum(rate(loadgen_requests_total{job="loadgen"}[5m]))
```

```promql
sum(rate(snip_http_requests_total{job="snip-api",
  code=~"5.."}[5m]))
/
sum(rate(snip_http_requests_total{job="snip-api"}[5m]))
```

The first does not move. On a lab never asked to inject an error it returns
**no data** at all: `loadgen` did not make those requests, so its counter has no
`code="500"` series to select, and a division with nothing on its left produces
nothing. If you ran a Chapter 3 scenario earlier it returns a flat zero instead.
Either way it is the same answer it gave before you sent two hundred failures.
The second returns a number that climbs within about thirty seconds and decays
over the following minutes, because it is reading the server's own count.

There is a second difference in that pair. Before the loop, the `snip-api`
expression did not return no data on a freshly started lab — it returned `0`,
because Snip pre-creates its `5xx` series at zero. The load generator
pre-creates nothing, so a brand-new stack gives the two expressions genuinely
different answers to the same question. That is the whole of Chapter 9 in one
comparison — and that panel's own description in Grafana still says *No data*,
true of the Chapter 3 version and false from the moment it was repointed.
Nothing checks a description.

Then reach for the chaos control plane the way Chapter 3 did, and prove the
opposite direction:

```bash
curl -s -XPOST localhost:8089/control -d '{"error_ratio":0.25}'
```

Now *both* expressions return a number, because this time the load generator is
causing the failures and therefore sees them. A client's view and a server's
view agree about everything the client did and disagree about everything else —
and "everything else" includes every real user you have. Chapter 14,
"Dashboards That Tell the Truth", puts the two on one screen and makes that gap
a permanent feature rather than a surprise.

Put the traffic back:

```bash
curl -s -XPOST localhost:8089/chaos/reset
```

!!! iou "IOU — chapters 6, 8 and 13"
    `rate()`, `sum` and `$__rate_interval` are still the Chapter 3 IOUs, and
    they are still unpaid. Chapter 6, "`rate()`, `increase()`, and Why Nothing
    Is a Whole Number", derives the first; Chapter 8 does `sum`; Chapter 13,
    "Dashboard Mechanics: Intervals, Panels and Variables", does the third.
    Copy them for now; what this chapter asks you to judge is which *series*
    they read, not what they compute.

## Breaking `/metrics` the way Prometheus 3 punishes hardest

One thing left: the failure Chapter 2 promised had a chapter of its own.

An HTTP response says what it contains. The client library sets that header for
you, and you have never had to think about it. Look at what Snip sends:

```console
$ curl -sI localhost:8000/metrics | grep -i content-type
Content-Type: text/plain; version=0.0.4; charset=utf-8;
  escaping=underscores
```

That is one header line, wrapped here to fit — the same line Chapter 2 took
apart. It is a versioned declaration of the exposition format, and not a
constant: the handler negotiates it against the request's `Accept` header, and a
client that asks for protobuf gets that format and a `Content-Type` saying so.
The header always describes what was actually sent.

Now take it away. In `lab/.env`:

```ini
SNIP_NO_CONTENT_TYPE=1
```

```bash
make up
```

`lab/snip/main.go` swaps in a hand-rolled handler that renders exactly the same
bytes and then suppresses the one header:

```go
families, err := prometheus.DefaultGatherer.Gather()
if err != nil {
	http.Error(w, "gather failed", http.StatusInternalServerError)
	return
}
w.Header()["Content-Type"] = nil
for _, mf := range families {
	if _, err := expfmt.MetricFamilyToText(w, mf); err != nil {
		log.Printf("write exposition: %v", err)
		return
	}
}
```

That first line is the gather from the jargon box, called by hand: this handler
does everything the library's does except set the header. Assigning `nil` to the
key rather than deleting it is what suppresses it — Go adds a `Content-Type` of
its own only when the key is absent altogether. The body is byte-for-byte valid,
and `curl localhost:8000/metrics` still prints every family above. Wait fifteen
seconds and open `http://localhost:9090/targets`.

!!! trap "One missing header, every metric gone"
    Both `snip-api` targets are **DOWN**, and the Error column reads:

    ```text
    non-compliant scrape target sending blank Content-Type and no
    fallback_scrape_protocol specified for target
    ```

    In `docker compose logs prometheus`, one of these every fifteen seconds:

    ```text
    level=ERROR source=scrape_append_v2.go:109
    msg="Failed to determine correct type of scrape target."
    component="scrape manager" scrape_pool=snip-api
    target=http://snip-api:8000/metrics content_type=""
    fallback_media_type="" err="non-compliant scrape target
    sending blank Content-Type and no fallback_scrape_protocol
    specified for target"
    ```

    Run `up{job="snip-api"}` and both rows read `0`. Every `snip_*` series
    stops. Nothing is partially ingested — Prometheus could not decide what
    format it was looking at, so it discarded the whole response.

Prometheus 2 did not do this: faced with a missing or unrecognized
`Content-Type` it assumed the text format and carried on, which is why so much
advice about hand-written `/metrics` endpoints is silently out of date. Version
3 made the check strict.

The rule is narrower than "must be plausible" and wider than "must be exact", so
it is worth knowing precisely which headers are accepted:

```text
text/plain;version=0.0.4
text/plain;version=1.0.0
application/openmetrics-text;version=0.0.1
application/openmetrics-text;version=1.0.0
application/vnd.google.protobuf;
    proto=io.prometheus.client.MetricFamily;encoding=delimited
```

That last one is a single line, wrapped here to fit.

A plain `text/plain; charset=utf-8` with no version is still read as the 0.0.4
text format and scrapes fine. `application/json` on a `/metrics` endpoint fails
with the sibling message, `received unsupported Content-Type "application/json"
and no fallback_scrape_protocol specified for target`. And no header fails as
you have just seen. All three are things a hand-rolled endpoint does by accident.

### Fix one: tell Prometheus what to assume

The scrape configuration has a field for exactly this. In
`lab/prometheus/prometheus.yml`:

```yaml
  - job_name: snip-api
    fallback_scrape_protocol: PrometheusText0.0.4
    static_configs:
      - targets:
          - "snip-api:8000"
          - "snip-api-b:8000"
        labels:
          env: lab
```

```bash
docker compose restart prometheus
```

A restart, not a reload: Prometheus reads its configuration once at startup
until Chapter 12 adds `--web.enable-lifecycle`, and until then a `POST /-/reload`
is answered with `403`. The named volume makes the restart free.

Within one scrape interval both targets are UP and every series is back. The
value is one of five case-sensitive names — `PrometheusText0.0.4`,
`PrometheusText1.0.0`, `OpenMetricsText0.0.1`, `OpenMetricsText1.0.0`,
`PrometheusProto` — and it applies only when the header is missing or
unrecognized, so it costs nothing for targets that behave.

Now read the Prometheus log. It is silent: no error, no warning, nothing at all
about a target that is still sending no header. The defect did not get fixed, it
got configured around, and the record of it is one line of YAML nobody will read
again.

### Fix two: send the header

Take the `fallback_scrape_protocol` line back out of
`lab/prometheus/prometheus.yml`, put `SNIP_NO_CONTENT_TYPE=0` back in
`lab/.env`, then run `make up` followed by `docker compose restart prometheus` —
the first picks up the switch, the second picks up the config. The library
handler returns, the header comes back, and the targets go UP for the reason
they should have been UP all along.

In Go there is nothing to write: `promhttp.HandlerFor` negotiates the format and
sets `Content-Type` to match. Every mainstream client library does the
equivalent, and the constant carrying the right value is worth recognizing in
someone else's code. In Python it is `CONTENT_TYPE_LATEST`, exported by
`prometheus_client` next to the function that renders the body, and in the
version this lab runs its value is `text/plain; version=1.0.0; charset=utf-8` —
"latest" means the newest text format the library writes, not a fixed string.
The lab's Python service negotiates instead, in two lines:

```python
encode, content_type = choose_encoder(
    request.headers.get("accept", ""))
return Response(encode(REGISTRY),
                headers={"content-type": content_type})
```

This whole class of failure exists because somebody wrote that response by hand.
There is no prize for hand-rolling an exposition endpoint.

### Which one would you defend?

Both fixes turn the target green, so choose on what happens next rather than on
what happens now.

The fallback is a permanent statement in a file owned by whoever runs monitoring,
describing a defect in code owned by whoever writes the service. It applies to
every target in that job forever, including ones that do not exist yet, so the
next service added can regress to no header and nobody will be told — you
watched Prometheus go quiet about it. Sending the header fixes it once, at the
source, for every scraper that will ever read the endpoint.

The fallback is not a hack, though. Some endpoints you cannot change: a vendor
appliance, a third-party exporter, a service in a language nobody on the team
writes. `fallback_scrape_protocol` exists for those. Using it on code you do
control is choosing to carry the defect.

!!! sidebar "If your service is Python behind Gunicorn"
    Snip is Go, so this one is not yours — but it is the most common "my Python
    metrics are wrong" cause in the wild. Under Gunicorn or uWSGI with several
    worker processes, each worker has its own registry, and a scrape reaches
    whichever worker the operating system routed the connection to. Your
    counters appear to jump around and go backwards for no reason. The fix
    is `prometheus_client`'s multiprocess mode: a directory pointed at by
    `PROMETHEUS_MULTIPROC_DIR` that must be cleared at startup, a registry built
    with `multiprocess.MultiProcessCollector`, an explicit `multiprocess_mode`
    on every gauge, and `mark_process_dead` in the worker-exit hook. Appendix E
    has the working version.

!!! selfcheck "Self-check"
    ```bash
    make verify-ch05
    ```

    Thirteen assertions, ending in `ch05: 13 passed, 0 failed` and `ch05 OK`.
    It checks that the five new families exist, that `snip_cache_lookups_total`
    carries both `hit` and `miss`, that `snip_redirects_total` covers
    `expired`, that every `snip_build_info` series reads `1` and carries a
    `version` label, that both naming checks above pass, and that both
    `snip-api` targets are being scraped — which they will not be if you left
    `SNIP_NO_CONTENT_TYPE=1` set.

## Common mistakes

**Package-level variables plus the global registry.** It looks like the tidiest
possible code and it is the combination `promauto`'s own documentation warns
about. Registration happens during package initialization, before `main` gets
control, so a name collision between two packages panics at import time with a
stack trace pointing at neither line you would want to read. Take the registry
as a constructor argument instead, and a test can hand over
`prometheus.NewRegistry()` and assert on exactly what the code under test
produced.

**Instrumenting `/metrics`.** Register the exposition endpoint outside the
instrumentation, as `lab/snip/api.go` does. Wrap it by accident and you get a
request rate that never drops to zero on an idle service, tracking your scrape
interval instead of your traffic.

**A `# HELP` string that repeats the name.** "Snip HTTP requests total." tells a
reader nothing they could not get from the name, and it is the default output of
every code generator that has ever touched a metric. Every HELP line in
`lab/snip/metrics.go` is written for one reader — you, at 3 a.m., looking at a
name you have never seen — and the test is whether it says what is counted and
in what unit without repeating the name back at you. "Total short links
successfully created." earns its place; "Snip links created total." does not.

**Counting in the wrong place.** Incrementing a success counter before the
operation that can fail, or on a path that returns early, produces a metric that
is confidently wrong rather than absent — the worst kind. In `handleCreate`,
`LinksCreated.Inc()` sits after the insert has returned without error. Being
unsure where the increment goes usually means the metric is measuring two things
and wants to be split.

**Counting the request yourself when the middleware already does.** An `.Inc()`
on `snip_http_requests_total` inside a handler, on top of
`InstrumentHandlerCounter`, double-counts that one route and nothing else. The
shape stays plausible and the number is wrong by a factor that varies per route.
Decide once where a family is incremented, and say so in a comment there.

!!! pitfall "Deriving `route` from the request instead of the router"
    `r.URL.Path` is right there, and it is shorter than the correct answer. It
    is also the reason people find out about series counts from an
    out-of-memory kill rather than from a book: one series per short link ever
    visited, and the caller chooses how many there are. The templated route is
    a property of the *route*, known when you wire the mux; the raw path is a
    property of the *request*. Never let a caller choose a label value.
    Chapter 7 does the arithmetic that turns that instinct into a number.

## Summary

You read a service's instrumentation for the first time, and the machinery
turned out to be about six lines: build the metric once at startup with a
registry handed in, and call `.Inc()` or `.Set()` where the thing happens.
Everything else in this chapter was about the decisions around those six lines,
because those are the ones you cannot undo cheaply. A metric name is a contract
with people you will never meet, and it outlives the code.

The lasting pieces:

- A registry is a set of collectors; a scrape is a rendering of a registry.
  Nothing is written until Prometheus asks, and an unregistered metric is
  invisible however often you increment it.
- A fresh registry starts empty. The default registry brings the Go and process
  collectors with it; a new one brings nothing, and forgetting them silently
  costs you every runtime metric.
- Construct once, at startup, with the registry passed in. Constructing in a
  handler fails on the second request with `duplicate metrics collector
  registration attempted`, and only that one route breaks.
- The naming law: `_total` on counters; base units only, so seconds and bytes
  and ratios between 0 and 1; the unit suffix before the type suffix; no label
  name inside a metric name.
- The aggregation-honesty test: if summing every series under this name gives a
  sentence you would sign, the name is right. A label you ignore is aggregated
  away; a name split you do not know about is missing.
- `route` is the templated path the router matched, never the URL the caller
  typed, and unrecognized paths collapse to one catch-all value. It becomes a
  label in Chapter 7, once you have priced it.
- Application code never emits `job`, `instance`, `env`, `cluster` or `region`.
  The first two are attached at scrape time and yours get renamed to
  `exported_*`; the last three describe the deployment.
- Prometheus 3 fails the entire scrape on a missing or unrecognized
  `Content-Type` where version 2 guessed. Fix it in the handler when you own the
  code, and with `fallback_scrape_protocol` when you do not — knowing that the
  fallback makes the problem silent.

## Exercises

!!! exercise
    **1. The redirect counter, from the requirement (core).** Snip's redirect
    path has three possible outcomes: the code resolved, the code was never
    issued, and the code existed but has expired. One label carries all three.
    Write the two sentences the aggregation-honesty test produces — what
    summing the whole family means, and what would be missing if those three
    outcomes had been three metric names instead.

    Then prove the third value moves. Record it first:

    ```bash
    curl -s localhost:8000/metrics | grep 'outcome="expired"'
    ```

    On a lab five minutes old that reads `0`; on one up for half an hour it is
    already non-zero, because the load generator picks from a 512-code ring
    that spans about nine minutes against a ten-minute link lifetime, and any
    lull in traffic ages entries past the TTL. Now create a link that lives
    three seconds:

    ```bash
    curl -s -XPOST localhost:8000/links \
      -H 'Content-Type: application/json' \
      -d '{"url":"https://prometheus.io/docs/","ttl_seconds":3}'
    ```

    Take the `code` from the answer, wait ten seconds, and ask for `/l/<code>`.
    The redirect answers `404`, and the same `grep` has gone up by at least
    one — yours is one of them. Write one sentence on why a series that reads
    zero for an hour is worth exporting anyway.

    **2. Three bad names, and the sentence each one tells (warm-up).** Invent
    three metric names for Snip that break the law on purpose: one with the unit
    in a label value, one with a label name buried in the metric name, and one
    `_percent` scaled 0 to 100. For each, write the sentence that summing the
    family would make it tell. Then say which of the three `make verify-ch05`
    would have caught — it walks metric names for buried label names, for
    duration shapes that do not end in `_seconds`, and for `_ms` or
    `_percent` — and why the one it misses needs a human.

    **3. Two requests to a panic (core).** Move one metric construction
    inside a handler in `lab/snip/api.go`, rebuild with `make up`, and drive
    that route twice. Record the exact error, where it appears, what the
    client sees, how many requests it took, and — the part that matters —
    which of the things you are monitoring noticed. Check
    `up{job="snip-api"}` and `curl -s -o /dev/null -w '%{http_code}\n'
    localhost:8000/healthz` before you answer. Put the file back with `git
    checkout -- snip/` afterwards.

    **4. The label that belongs to somebody else (core).** Add `env="dev"`
    as a label emitted by the application, rebuild, and find the series in
    Prometheus. What is the label called by the time you can query it, and
    what is the value of `env` on that same series? Remove it, and write the
    one line explaining why the application was the wrong place — in terms
    of what it costs to change the value later.

    **5. Defend a fix (stretch).** Write the code-review comment you would
    leave on a pull request that fixes the `Content-Type` failure with
    `fallback_scrape_protocol` on a service the team owns. Then write the
    comment for the same change on a vendor appliance. Three sentences each,
    and they should not be the same comment.

    **6. HELP strings that survive 3 a.m (warm-up).** This chapter prints the
    `# HELP` line for four of the five families it adds. Write the fifth,
    `snip_redirects_total`, without looking — then invent two metrics Snip does
    not have and write theirs. Any of yours that merely restates the metric name
    fails; any that says what is counted and in what unit passes. Check the
    reference with `curl -s localhost:8000/metrics | grep '^# HELP snip_'`.
