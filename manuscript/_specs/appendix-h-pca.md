# Appendix H — The Prometheus Certified Associate (PCA) exam

**Status:** commissioned 2026-09-18 by the editor-in-chief. Reverses one line of `00-OUTLINE.md`
§G, which excluded certification mapping. The 29 chapters keep their shape; this appendix sits
beside them.

**Target length: ~9,000 words.** Written last, once every chapter exists, because the map must
point at real section headings.

---

## H.0 Curriculum, verified 2026-09-18

Source: <https://training.linuxfoundation.org/certification/prometheus-certified-associate/>

Format: **online, proctored, multiple-choice. 90 minutes. Certification valid 2 years.**
It is **not** a hands-on lab exam. (The CKA and its siblings are; the PCA is not. Readers who
assume otherwise prepare the wrong way.)

| # | Domain | Weight | Sub-competencies, verbatim |
|---|---|---|---|
| 1 | Observability Concepts | 18% | Metrics · Understand logs and events · Tracing and Spans · Push vs Pull · Service Discovery · Basics of SLOs, SLAs, and SLIs |
| 2 | Prometheus Fundamentals | 20% | System Architecture · Configuration and Scraping · Understanding Prometheus Limitations · Data Model and Labels · Exposition Format |
| 3 | PromQL | 28% | Selecting Data · Rates and Derivatives · Aggregating over time · Aggregating over dimensions · Binary operators · Histograms · Timestamp Metrics |
| 4 | Instrumentation and Exporters | 16% | Client Libraries · Instrumentation · Exporters · Structuring and naming metrics |
| 5 | Alerting & Dashboarding | 18% | Dashboarding basics · Configuring Alerting rules · Understand and Use Alertmanager · Alerting basics (when, what, and why) |

**Honesty requirements, binding:**

- State plainly that this book is **not affiliated with or endorsed by the Linux Foundation or
  the CNCF**, and that it is not an official study guide.
- State that curricula change, print the date above, and tell the reader to check the official
  page themselves before booking.
- Do **not** claim a passing score or question count — the official page does not publish them,
  and the quarantine rule in `_POLICY.md` §A.2 applies to this appendix too.
- Do **not** reproduce, paraphrase or reconstruct real exam questions. Every practice question
  here is original, written against this book's own material.

---

## H.1 The competency map

A table per domain: **sub-competency → chapter number and title → the specific section heading**,
plus a one-line note where the book goes deeper than the exam needs or deliberately less deep.

Build it by reading the actual chapter files and quoting real `##` headings. A map that points
at a heading which does not exist is worse than no map.

Close the section with an honest **readiness read**: which domains this book over-prepares
(PromQL, alerting, dashboarding, instrumentation) and which need the gap-fillers in H.2.

## H.2 Gap-fillers — the six holes, closed

Each is a short, self-contained section. These are the only places the book teaches something it
otherwise deliberately omits, so each one says *why* it was omitted and *why the exam wants it*.

1. **The Pushgateway, mechanically.** Chapter 22 treats it as a discouraging sidebar and the lab
   omits it on principle. The exam expects the mechanics: what it is for (service-level batch jobs
   that exit before they can be scraped), how metrics get in (`POST`/`PUT` to
   `/metrics/job/<job>/<label>/<value>`), grouping keys, why `honor_labels: true` is needed on its
   scrape job, and the four standard objections — it becomes a single point of failure, it breaks
   `up`-based health, metrics persist after the job is gone unless deleted, and it flattens the
   instance dimension. Contrast with the node_exporter **textfile collector**, which is the right
   answer for machine-level batch jobs. Keep the book's opinion; add the knowledge.
2. **What Prometheus is not for.** A named sub-competency with no home chapter. Cover: not durable
   long-term storage on its own; not a billing or auditing system, because scrapes sample and
   samples can be missed; not for per-event or per-request records (that is logs and traces); not
   for high-cardinality unique identifiers; no cross-service transactional consistency; single-node
   by default, and what that means for HA. Point forward to chapters 25, 26 and 29 for the fixes.
3. **SLA vs SLO vs SLI.** The book is rich on SLI/SLO (chapters 20, 21) and nearly silent on SLAs.
   Add the third leg: an SLA is a **contract with consequences** — credits, penalties, termination —
   agreed with someone outside the team; an SLO is the internal target, deliberately stricter; an
   SLI is the measurement. Why the SLO sits inside the SLA with margin, and why engineers alert on
   the SLO and never on the SLA.
4. **Logs, events, tracing and spans.** About a third of domain 1. Chapter 29 is a bridge, not a
   treatment. Add the conceptual layer the exam wants: what a log line, an event, a trace, a span,
   a parent/child relationship and a trace context are; when each signal answers a question metrics
   cannot; the cost and cardinality trade-off that makes them different systems.
5. **Timestamp metrics.** Named under PromQL, thin in the book. Cover `time()`, `timestamp()`, the
   `*_timestamp_seconds` convention, `time() - my_last_success_timestamp_seconds` as the canonical
   staleness/freshness alert, and why a Unix-timestamp gauge is preferable to a "seconds since"
   gauge computed in the application.
6. **Push vs pull, as the exam frames it.** The book argues the pull model well but does not lay
   the comparison out as a table the way a multiple-choice question will. Add: what pull gives you
   (`up` for free, target list as source of truth, no thundering herd from clients, easy local
   debugging by curling an endpoint), what push gives you (works through NAT and firewalls, suits
   short-lived jobs, suits event-driven loads), and where each breaks.

## H.3 Practice questions

**~80 questions**, distributed by the real domain weights so practice matches the exam:

| Domain | Weight | Questions |
|---|---|---|
| Observability Concepts | 18% | 14 |
| Prometheus Fundamentals | 20% | 16 |
| PromQL | 28% | 23 |
| Instrumentation and Exporters | 16% | 13 |
| Alerting & Dashboarding | 18% | 14 |

Rules for every question:

- Four options, one correct, single-select — matching the exam's format.
- **Every distractor must be plausible**, drawn from a real misconception. The ranked misconception
  list in `research/pedagogy.md` §4 is the source: `rate` vs `increase`, counter resets,
  aggregate-then-rate, averaging quantiles, `le` as a string, cardinality arithmetic, empty-result
  ratios, `by` vs `without`, staleness. A question whose wrong answers are obviously wrong
  teaches nothing.
- The answer key gives **the reason the correct answer is correct and the reason each distractor
  is wrong**, not just a letter.
- Every answer cites the chapter and section that teaches it, so a wrong answer routes the reader
  straight back into the book.
- PromQL questions must use **metric names from this book's lab** (`LAB-SPEC.md` §5), so the reader
  can run them. Anything printed as a result must be consistent with `MEASURED.md`.
- Mark ~10 questions **(harder than the exam)** where the book goes deeper, so the reader is not
  alarmed by them.

## H.4 A study path

Half a page. Which chapters to read for which domain if the reader is short of time; which of the
book's exercises double as exam practice; and the honest note that chapters 21, 24, 26 and 27 go
well beyond associate level and can be skipped for exam purposes but not for competence.
