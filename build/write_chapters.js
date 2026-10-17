export const meta = {
  name: 'obs-book-chapters',
  description: 'Write, adversarially verify, and repair chapters of the Prometheus/Grafana textbook',
  phases: [
    { title: 'Draft', detail: 'one author per chapter, against the running lab as ground truth' },
    { title: 'Verify', detail: 'two independent lenses: technical accuracy and teachability' },
    { title: 'Repair', detail: 'apply confirmed findings' },
  ],
}

const ROOT = 'C:/Users/fatih/Desktop/Co-Authored with Claude/observability-book'
const MS = ROOT + '/manuscript'
const LAB = ROOT + '/lab'
const SCRATCH = 'C:/Users/fatih/AppData/Local/Temp/claude/C--Users-fatih-Desktop-Co-Authored-with-Claude/ff0d43dd-98b0-46ae-ad93-8bb48428a4dd/scratchpad'
const TODAY = '2026-09-19'

const CHAPTERS = [
  { n: 1, t: 'Ten Minutes to Your First Metric', f: 'ch01-ten-minutes-to-your-first-metric.md', w: 5000 },
  { n: 2, t: "What's Actually on the Wire", f: 'ch02-what-s-actually-on-the-wire.md', w: 6000 },
  { n: 3, t: 'Your First Dashboard: The Early Win', f: 'ch03-your-first-dashboard-the-early-win.md', w: 5500 },
  { n: 4, t: 'Metric Types Are Contracts', f: 'ch04-metric-types-are-contracts.md', w: 5500 },
  { n: 5, t: 'Your First Counter: Instrumenting Code You Own', f: 'ch05-your-first-counter-instrumenting-code-you-own.md', w: 6500 },
  { n: 6, t: 'rate(), increase(), and Why Nothing Is a Whole Number', f: 'ch06-rate-increase-and-why-nothing-is-a-whole-number.md', w: 7500 },
  { n: 7, t: 'Labels, and the Cardinality Arithmetic You Must Do First', f: 'ch07-labels-and-the-cardinality-arithmetic-you-must-d.md', w: 6000 },
  { n: 8, t: 'Aggregation: sum, without, and the Rate-Then-Aggregate Law', f: 'ch08-aggregation-sum-without-and-the-rate-then-aggreg.md', w: 6000 },
  { n: 9, t: "Ratios, Arithmetic, and the Series That Isn't There", f: 'ch09-ratios-arithmetic-and-the-series-that-isn-t-ther.md', w: 6500 },
  { n: 10, t: 'Latency: Histograms Without Tears', f: 'ch10-latency-histograms-without-tears.md', w: 8000 },
  { n: 11, t: 'Joins, Info Metrics, and the Rest of PromQL', f: 'ch11-joins-info-metrics-and-the-rest-of-promql.md', w: 6000 },
  { n: 12, t: 'prometheus.yml in Full: Service Discovery and Relabeling', f: 'ch12-prometheus-yml-in-full-service-discovery-and-rel.md', w: 7000 },
  { n: 13, t: 'Dashboard Mechanics: Intervals, Panels and Variables', f: 'ch13-dashboard-mechanics-intervals-panels-and-variabl.md', w: 6500 },
  { n: 14, t: 'Dashboards That Tell the Truth', f: 'ch14-dashboards-that-tell-the-truth.md', w: 6000 },
  { n: 15, t: 'Recording Rules', f: 'ch15-recording-rules.md', w: 4500 },
  { n: 16, t: 'Alerting Rules, and What "Firing" Actually Means', f: 'ch16-alerting-rules-and-what-firing-actually-means.md', w: 6500 },
  { n: 17, t: 'Alertmanager: Routing, Grouping and Silence', f: 'ch17-alertmanager-routing-grouping-and-silence.md', w: 7000 },
  { n: 18, t: 'Testing Alerts Before They Page You', f: 'ch18-testing-alerts-before-they-page-you.md', w: 4500 },
  { n: 19, t: 'What a Page Should Say, and Who Watches the Watcher', f: 'ch19-what-a-page-should-say-and-who-watches-the-watch.md', w: 5500 },
  { n: 20, t: 'SLIs, SLOs and Error Budgets', f: 'ch20-slis-slos-and-error-budgets.md', w: 6500 },
  { n: 21, t: "Burn Rates: Alerts That Don't Cry Wolf", f: 'ch21-burn-rates-alerts-that-don-t-cry-wolf.md', w: 8000 },
  { n: 22, t: "Metrics From Things You Didn't Write", f: 'ch22-metrics-from-things-you-didn-t-write.md', w: 6500 },
  { n: 23, t: 'The Multi-Target Pattern: Probing From Outside', f: 'ch23-the-multi-target-pattern-probing-from-outside.md', w: 4500 },
  { n: 24, t: 'Cardinality: Detonate, Diagnose, Defuse', f: 'ch24-cardinality-detonate-diagnose-defuse.md', w: 5500 },
  { n: 25, t: 'Storage, Retention, Backups and Locking the Door', f: 'ch25-storage-retention-backups-and-locking-the-door.md', w: 6500 },
  { n: 26, t: "When One Prometheus Isn't Enough: HA, remote_write, and the Scaling Map", f: 'ch26-when-one-prometheus-isn-t-enough-ha-remote-write.md', w: 6500 },
  { n: 27, t: 'Optional: What Changes on Kubernetes', f: 'ch27-optional-what-changes-on-kubernetes.md', w: 7000 },
  { n: 28, t: 'OpenTelemetry and Prometheus', f: 'ch28-opentelemetry-and-prometheus.md', w: 5000 },
  { n: 29, t: 'Beyond Metrics: Exemplars, Traces, Logs, and Where to Go Next', f: 'ch29-beyond-metrics-exemplars-traces-logs-and-where-t.md', w: 5500 },
]

let a = args
if (typeof a === 'string') { try { a = JSON.parse(a) } catch (e) { a = null } }
let want = Array.isArray(a) ? a : (a && Array.isArray(a.chapters) ? a.chapters : null)
const STAGE = (a && !Array.isArray(a) && a.stage) ? a.stage : 'full'
// Optional: a prior review to hand the verifiers, so they confirm or refute
// known findings instead of rediscovering them at full cost.
const NOTES = (a && !Array.isArray(a) && a.notes) ? a.notes : ''
if (!want || !want.length) want = CHAPTERS.map((c) => c.n)
want = want.map(Number)
const TODO = CHAPTERS.filter((c) => want.includes(c.n))
log(`Chapters queued (${TODO.length}), stage=${STAGE}: ${TODO.map((c) => c.n).join(', ')}`)

const GROUND_TRUTH = `
GROUND TRUTH — read in this order. Later sources never override earlier ones.

0. **${LAB}/MEASURED.md** — numbers, label sets, bucket boundaries and exposition lines captured
   from the stack ACTUALLY RUNNING. **This outranks everything else, including the lab source and
   the spec**, for any figure you print. All 14 targets were up; all 75 referenced metric names
   were confirmed to exist. Where MEASURED says a count is "growing", do not print a fixed number.
   **${LAB}/VERIFY-STATUS.md** — which chapters' verify scripts actually pass today, and the four
   known checker defects. Do not promise a clean \`make verify-chNN\` that VERIFY-STATUS contradicts.
1. **${LAB}/** — the ACTUAL BUILT LAB. Every command, file path, metric name, label, port and
   config key you print must match the real files. Open them. Do not describe code you have
   not read.
2. **${LAB}/SPEC-DELTAS.md** — where the built lab deliberately differs from LAB-SPEC, including
   defects found only by running it (rows R1-R4).
3. **${LAB}/LAB-SPEC.md** — the design contract. §0.2 and §14: the main-line language is **Go**
   (amendment A3); \`catalog\` is Python. §5 metric catalogue, §6 ports, §7.2 pins, §8 growth plan.
4. **${MS}/_specs/_POLICY.md** — the eight editorial rules, the quarantine list, the exclusions.
5. **${MS}/_specs/_DEPENDENCY-GRAPH.md** — which concept is first taught where.
   **You may not use a term before the chapter that owns it.**
6. **${MS}/_STYLE-GUIDE.md** — house style. Binding: 76-column code limit, admonition classes,
   the mandatory chapter skeleton.
7. **${ROOT}/research/*.md** — the dossiers. **${ROOT}/research/_CONFLICTS.md** is the quarantine
   list: nothing on it may be printed as fact.

NON-NEGOTIABLE
- Never invent a metric name, label, port, file path, config key, function or version.
- Never print a quarantined claim (no Prometheus LTS number, no Grafana 13.2).
- Every PromQL expression must be valid Prometheus 3.13 PromQL against series that exist.
- Every command must be one the reader can really run against the real lab.

TWO SOURCES OF TRUTH, AND THEY ANSWER DIFFERENT QUESTIONS

**(a) What exists at your chapter — the assembled tree.** Every chapter's exact file state is
materialised at:

    ${SCRATCH}/trees/ch<NN>/

All 29 are there, so you can open your own chapter's tree and its neighbours to see exactly what
a later chapter adds. **Use these, not ${LAB}**, to judge what a file contains at your point in
the book — ${LAB} stays on \`main\`, which is the finished ch29 state and is ahead of you.
This is how you catch a chapter describing a file that does not look like that yet.

**(b) How it behaves — the live stack.** A stack may be running. Find it with:

    docker ps --format '{{.Names}}\\t{{.Ports}}'

**Read the tag it is running before you trust it.** It may be at a LATER chapter than yours, in
which case it is good for measuring behaviour (what a query returns, what an endpoint emits, what
Grafana renders) but **must not** be used to judge what exists at your chapter — (a) answers that.
A verify script in particular reports different counts at different tags, and both are correct.

If containers are up, **use them** — a measured answer beats a reasoned one every time:

    # PromQL, against the chapter's own data
    docker run --rm --network obsnet alpine:3 sh -c \\
      'apk add --no-cache curl >/dev/null 2>&1;
       curl -s -G --data-urlencode "query=<EXPR>" http://prometheus:9090/api/v1/query'

    # Grafana: what is actually provisioned, and what it renders
    curl -s http://localhost:3000/api/health
    curl -s http://localhost:3000/api/search?query=

    # the raw exposition a chapter quotes
    docker run --rm --network obsnet alpine:3 sh -c \\
      'apk add --no-cache curl >/dev/null 2>&1; curl -s http://snip-api:8000/metrics | head -40'

If nothing is running, say so in your findings rather than guessing — an unverified runtime claim
is exactly the failure mode \`MEASURED.md\` exists to prevent.
`

phase('Draft')

const DRAFT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['chapter', 'file', 'word_count', 'promql_used', 'uncertainties'],
  properties: {
    chapter: { type: 'integer' }, file: { type: 'string' }, word_count: { type: 'integer' },
    promql_used: { type: 'array', items: { type: 'string' } },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
}

const FINDING_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lens', 'verdict', 'findings'],
  properties: {
    lens: { type: 'string' }, verdict: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['severity', 'where', 'problem', 'fix'],
        properties: {
          severity: { type: 'string' }, where: { type: 'string' },
          problem: { type: 'string' }, fix: { type: 'string' },
        },
      },
    },
  },
}

const results = await pipeline(
  TODO,

  (c) => agent(
    `You are writing ONE chapter of the textbook "Observability with Prometheus and Grafana:
A Hands-On Introduction". Today is ${TODAY}.

YOUR CHAPTER: **Chapter ${c.n} — ${c.t}**
Target length: **${c.w} words** (+/-15%). Write to: **${MS}/${c.f}**

Your brief is at **${MS}/_specs/ch${String(c.n).padStart(2, '0')}.md**. Read it first and in full.
It gives the chapter's single job, learning objectives, concepts in order, the exact lab step,
dependencies and exercises. It was designed against a concept dependency graph and a 29-chapter
arc; deviating breaks other chapters.

${GROUND_TRUTH}

**IF A DRAFT ALREADY EXISTS AT ${MS}/${c.f}**, treat it as your own earlier work: keep what is
good, re-check every number against MEASURED.md and the real lab, fill thin sections, and bring
it up to standard. Do not start over out of habit. If absent or trivial, write from scratch.

METHOD
1. Read the brief, then _POLICY.md, _DEPENDENCY-GRAPH.md, _STYLE-GUIDE.md.
2. Read the actual lab files your chapter touches. Quote real code. Derive any /metrics output
   from the real instrumentation, not from imagination.
3. Read the relevant research dossiers before making any claim about semantics.
4. Write the whole chapter in one file. Do not stub sections.

WHAT MAKES IT GOOD
- The reader is a competent developer who has never operated anything. Respect their
  intelligence; assume none of their ops vocabulary.
- Teach through the lab. Every abstraction lands against something running on their machine.
- Show the wrong thing and its wrong output before the right thing, where the brief calls for it.
- Every checkable claim gets checked by the reader, with a printed expected result.
- Prose, not bullet soup. Earn the word count with substance; padding is worse than being short.`,
    { label: `draft:ch${c.n}`, phase: 'Draft', schema: DRAFT_SCHEMA }
  ),

  (draft, c) => {
    if (!draft) return null
    if (STAGE === 'draft') return { draft, c, verdicts: [] }
    const LENSES = [
      { key: 'technical', ask: `TECHNICAL ACCURACY. Find something WRONG.
- Every PromQL expression: does it parse? Right type for its use? Do the series exist (LAB-SPEC §5
  and the real code)? Rate-then-aggregate? Does histogram_quantile keep \`le\`? Range >= 4x scrape
  interval? Any hardcoded \`le="1"\` (v3 normalises to "1.0")? Regex \`.\` now matches newline.
  The chapter reported using: ${JSON.stringify(draft.promql_used || []).slice(0, 2500)}
- Every command, flag, path, Makefile target — against the REAL lab.
- Every config key — does it exist in the pinned version, in the right block?
- Every code snippet — against the real snip/loadgen/catalog source. Go is the main line (A3).
- Every number — recompute. Check MEASURED.md; several spec figures were superseded by measurement.
- Every version claim — against research/, and the quarantine list in research/_CONFLICTS.md.
Do not report style. Only correctness.` },
      { key: 'teaching', ask: `TEACHABILITY AND HOUSE STYLE.
- Undefined terms, against _DEPENDENCY-GRAPH.md: any concept used before the chapter that owns it,
  without an inline definition? This is the most common defect. List every one.
- Unearned leaps: where would a reader with no monitoring background get lost? Quote the sentence.
- The brief (${MS}/_specs/ch${String(c.n).padStart(2, '0')}.md): is every objective delivered? Is the
  lab step exactly as specified, with its verification? Are exercises doable AS OF THIS CHAPTER?
- Mandatory skeleton: hook, objectives box, body, "Common mistakes", "Summary", "Exercises",
  and at least one \`selfcheck\` with a concrete expected result.
- Style: American English; second person present; no "simply"/"just"/"obviously"; sentence-case
  headings; no page references; approved admonition classes only; <= 1 admonition per ~600 words.
- **The 76-column code limit** — scan every fenced block, report any line over, with the line.
- Length within 15% of ${c.w} words. Padded or thin?
Do not re-check PromQL correctness; the other lens owns that.` },
    ]
    return parallel(LENSES.map((l) => () =>
      agent(
        `Reviewing a draft chapter of a technical textbook. Today is ${TODAY}.

CHAPTER: Chapter ${c.n} — ${c.t}
FILE: ${MS}/${c.f}   (read it in full)

${GROUND_TRUTH}

Be specific and harsh. A finding without an exact quote and a concrete fix is useless and will be
discarded. Do not invent problems to look thorough. Rank: BLOCKER (wrong, would mislead or fail
the reader), MAJOR, MINOR.
${NOTES ? `
A PRIOR REVIEW OF THIS CHAPTER ALREADY EXISTS. Treat it as a lead, not as truth — it was produced
without a running stack and may be wrong. For each item in your lens, **confirm it against the
lab or the live stack, or refute it**, and say which. Then look for what it MISSED; that is where
your value is. Do not simply restate it.

<prior-review>
${NOTES}
</prior-review>
` : ''}
${l.ask}`,
        { label: `verify:ch${c.n}:${l.key}`, phase: 'Verify', schema: FINDING_SCHEMA }
      )
    )).then((vs) => ({ draft, c, verdicts: vs.filter(Boolean) }))
  },

  (r) => {
    if (!r) return null
    const all = r.verdicts.flatMap((v) => (v.findings || []).map((f) => ({ ...f, lens: v.lens })))
    if (!all.length) {
      // Distinguish "verifiers ran and found nothing" from "verifiers never ran".
      // Conflating them reported a chapter as clean when both reviewers had died on
      // a session limit — a false green is worse than no signal.
      const ran = r.verdicts.length
      const note = STAGE === 'draft'
        ? 'DRAFT ONLY - not verified'
        : (ran === 2 ? 'both verifiers clean'
          : ran === 1 ? `ONLY ${r.verdicts[0].lens} VERIFIER RAN - partially verified`
          : 'VERIFIERS DID NOT RUN - not verified')
      return { chapter: r.c.n, file: r.c.f, findings: 0, verifiers_ran: ran, note }
    }
    const order = { BLOCKER: 0, MAJOR: 1, MINOR: 2 }
    all.sort((x, y) => (order[x.severity] ?? 3) - (order[y.severity] ?? 3))
    return agent(
      `You are the editor applying review findings to a chapter you must leave BETTER, not longer.

CHAPTER: Chapter ${r.c.n} — ${r.c.t}
FILE: ${MS}/${r.c.f}   (edit in place)

${GROUND_TRUTH}

Verdicts: ${r.verdicts.map((v) => `${v.lens}=${v.verdict}`).join(', ')}.

FINDINGS, most severe first:
${all.map((f, i) => `${i + 1}. [${f.severity}] (${f.lens}) ${f.where}\n   problem: ${f.problem}\n   fix: ${f.fix}`).join('\n\n')}

RULES
- Verify each finding against the real lab and the research BEFORE acting. Reviewers get things
  wrong. If a finding is mistaken, reject it and say why — do not "fix" correct text.
- Fix every BLOCKER. Fix MAJORs unless doing so breaks something the brief requires. Apply cheap MINORs.
- Keep within 15% of ${r.c.w} words. If fixes add material, cut padding elsewhere.
- Do not change the chapter's structure or lab step; other chapters depend on them.
- Re-check every code fence for the 76-column limit after editing.

Return: what you fixed, what you rejected and why, what is still open.`,
      { label: `repair:ch${r.c.n}`, phase: 'Repair', schema: {
        type: 'object', additionalProperties: false,
        required: ['chapter', 'fixed', 'rejected', 'still_open'],
        properties: {
          chapter: { type: 'integer' },
          fixed: { type: 'array', items: { type: 'string' } },
          rejected: { type: 'array', items: { type: 'string' } },
          still_open: { type: 'array', items: { type: 'string' } },
        },
      } }
    )
  }
)

const done = results.filter(Boolean)
log(`Chapters completed: ${done.length}/${TODO.length}`)
return done
