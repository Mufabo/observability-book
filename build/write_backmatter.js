export const meta = {
  name: 'obs-book-backmatter',
  description: 'Write the front matter and all appendices (A-G, H=PCA, I=Solutions) for the textbook',
  phases: [
    { title: 'Front + A-G', detail: 'front matter and the seven original appendices, in parallel' },
    { title: 'H and I', detail: 'the PCA appendix and the solutions appendix, each split across agents' },
    { title: 'Merge', detail: 'assemble the multi-part appendices into one file each' },
  ],
}

const ROOT = 'C:/Users/fatih/Desktop/Co-Authored with Claude/observability-book'
const MS = ROOT + '/manuscript'
const LAB = ROOT + '/lab'
const TODAY = '2026-09-18'

const GROUND = `
GROUND TRUTH — in priority order. Later sources never override earlier ones.
0. **${LAB}/MEASURED.md** — figures captured from the stack ACTUALLY RUNNING. Outranks everything,
   including the lab source and the spec, for any number you print.
   **${LAB}/VERIFY-STATUS.md** — which verify scripts really pass, and four known checker defects.
1. **${LAB}/** — the real lab. Every path, metric, label, port and config key must match it.
2. **${LAB}/SPEC-DELTAS.md** then **${LAB}/LAB-SPEC.md** (§0.2/§14: main line is **Go**, amendment
   A3; \`catalog\` is Python. §5 metrics, §6 ports, §7.2 pins).
3. **${MS}/_specs/_POLICY.md** — editorial rules, quarantine list, exclusions.
4. **${MS}/_STYLE-GUIDE.md** — binding house style: 76-column code limit, approved admonition
   classes only, American English, second person, no "simply"/"just"/"obviously".
5. **${ROOT}/research/*.md**; **${ROOT}/research/_CONFLICTS.md** is the quarantine list.

ALL 29 CHAPTERS ARE WRITTEN and live in ${MS}/ch01-*.md .. ch29-*.md. Read the ones you reference.
Never cite a section heading you have not seen in the file.

NON-NEGOTIABLE: invent nothing — no metric name, label, port, path, flag, function or version.
Print no quarantined claim (no Prometheus LTS number, no Grafana 13.2).
`

const REPORT = {
  type: 'object', additionalProperties: false,
  required: ['unit', 'file', 'word_count', 'notes'],
  properties: {
    unit: { type: 'string' }, file: { type: 'string' },
    word_count: { type: 'integer' },
    notes: { type: 'array', items: { type: 'string' } },
  },
}

phase('Front + A-G')

const UNITS = [
  {
    key: 'front', file: '00-front-matter.md', words: 3500,
    ask: `Write ALL SIX front-matter sections into one file, in order, each as a \`##\` section under
a single \`# Front matter\` heading. The brief is ${MS}/_specs/front-matter.md — follow it.

F.1 Who this book is for (~700) · F.2 How to read this book (~600) · F.3 What you need (~500) ·
F.4 The lab in one page (~500) · F.5 Versions this book was written against (~600) ·
F.6 Conventions (~600).

Specifics that must be right:
- F.3: Docker with Compose v2, GNU make, curl, jq, a shell; RAM and disk from LAB-SPEC §2.11;
  Apple Silicon/arm64 notes. Say the lab works offline after the first pull, and name the two
  documented exceptions (ch27 fetches a Helm chart; one ch23 exercise probes a public host).
- F.4: an ASCII service diagram (72 cols max), the port map from LAB-SPEC §6, the chaos API, and
  the one recovery command.
- F.5: the pin table from LAB-SPEC §7.2 with verification dates, and the currency policy —
  including the explicit refusal to name an LTS version and why.
- F.6: document every recurring device the chapters actually use. Check which admonition classes
  appear across ch01..ch29 and describe exactly those: objectives, iou, selfcheck, trap, sidebar,
  ladder, pitfall, warning, jargon, note, exercise, grafana12.`,
  },
  { key: 'app-a', file: 'app-a-complete-lab.md', words: 2500, ask: `Appendix A — the complete lab reference. Per ${MS}/_specs/appendices.md. The full service/port table, the complete SNIP_*/LOADGEN_*/CATALOG_* switch catalogue (LAB-SPEC §3.4), the scenario scripts, the make targets (§10), the pin table with dates, and the directory tree. This is the reference a reader flips to mid-chapter, so favour tables over prose.` },
  { key: 'app-b', file: 'app-b-debugging-ladder.md', words: 1800, ask: `Appendix B — the No-Data debugging ladder: 12 numbered rungs, each with its one-line tell and its fix, ordered cheapest-check-first. The chapters reference rungs by number (\`!!! ladder\` boxes) — grep ch01..ch29 for "rung" and make sure every rung number they cite exists and means what they say. Ends with the answer key to chapter 14's five planted lies.` },
  { key: 'app-c', file: 'app-c-promql-by-type.md', words: 3500, ask: `Appendix C — PromQL organised by TYPE rather than alphabetically: what each construct takes and returns (instant vector, range vector, scalar, string). Selectors and matchers; the function list grouped by signature; aggregation operators; binary operators and vector matching; subqueries; the @ and offset modifiers. Flag anything experimental or behind a feature flag, with the flag name. Use ${ROOT}/research/promql.md as the source and the lab's own metric names in examples.` },
  { key: 'app-d', file: 'app-d-naming-cardinality.md', words: 1800, ask: `Appendix D — the metric and label naming checklist, plus a cardinality worksheet the reader can actually fill in. Naming law from LAB-SPEC §5.0 and research/instrumentation-clients.md: base units, _total on counters, no units in labels, what belongs in a name vs a label. The worksheet: a worked example using the lab's real label sets, then a blank the reader applies to their own service.` },
  { key: 'app-e', file: 'app-e-three-metrics-three-languages.md', words: 3500, ask: `Appendix E — the same three metrics (a counter, a histogram, a gauge) in Python, Java and Node, alongside the Go the book has used throughout. Correct, current, compile-accurate APIs from ${ROOT}/research/instrumentation-clients.md — client_java 1.x not the old simpleclient; prom-client for Node; prometheus_client for Python. Include the default-bucket differences (Go 11, Python 14) that chapters 7 and 10 rely on, and the Python multiprocess-registry trap, framed as "if your service is Python, here is the trap waiting for you" (LAB-SPEC §0.2).` },
  { key: 'app-f', file: 'app-f-reading-older-material.md', words: 2500, ask: `Appendix F — how to read anything written before 2025 without being misled. The Prometheus 3 breaking changes (research/pedagogy.md §9.1): regex \`.\` now matches newline; \`le\`/\`quantile\` normalised to float form so \`le="1"\` no longer matches; range selectors left-open; removed feature flags; strict Content-Type on scrape; UTF-8 names; holt_winters renamed. The citation rule: \`/docs/.../latest/\` documents the latest RELEASE while main-branch docs document UNRELEASED work — this rule is what caught conflict C6, so tell that story concretely. Plus what "experimental" has meant at different times, and how to date a blog post from its PromQL.` },
  { key: 'app-g', file: 'app-g-promtool-cookbook.md', words: 2000, ask: `Appendix G — a promtool cookbook: check config, check rules, check healthy, check metrics, test rules, query instant/range, tsdb analyze, tsdb create-blocks-from. One recipe per task: the command, what good output looks like, what failure looks like. Everything must be real for the pinned version — the lab's own rule files and tests are the examples, and \`promtool test rules\` genuinely passes on them (see ${LAB}/BUILD-STATUS.md).` },
]

const first = await parallel(UNITS.map((u) => () =>
  agent(
    `You are writing back matter for the textbook "Observability with Prometheus and Grafana:
A Hands-On Introduction". Today is ${TODAY}.

UNIT: ${u.key}. Target ~${u.words} words. Write to: ${MS}/${u.file}

${GROUND}

Start the file with a single \`# \` heading naming the unit as it should appear in the table of
contents (e.g. \`# Appendix C — PromQL by type\`). Use \`##\` for sections below it.

${u.ask}

An appendix is a reference, not a lecture: prefer tables, short entries and scannable structure.
Every claim must be checkable against the lab or the research.`,
    { label: `write:${u.key}`, phase: 'Front + A-G', schema: REPORT }
  )
))
log(`Front + A-G: ${first.filter(Boolean).length}/${UNITS.length}`)

phase('H and I')

// --- Appendix H: PCA. Two agents, same file, sequential so part 2 appends. ---
const hMap = await agent(
  `Write PART 1 of Appendix H — the Prometheus Certified Associate (PCA) exam.
Today is ${TODAY}. Brief: ${MS}/_specs/appendix-h-pca.md — read it in full and obey it,
especially §H.0's honesty requirements.

${GROUND}

Write to ${MS}/app-h-pca.md, starting with \`# Appendix H — The Prometheus Certified Associate exam\`.

Cover H.0 (curriculum table, format, the not-affiliated/verify-the-date disclaimers), H.1 (the
competency map) and H.2 (the six gap-fillers). Target ~5,000 words. **Do not write the practice
questions — another agent appends those.** End the file after H.2.

For H.1 you must open the actual chapter files and cite REAL \`##\` headings. A map pointing at a
heading that does not exist is worse than no map. For each of the five domains, give a table:
sub-competency -> chapter number and title -> section heading -> a one-line note where the book
goes deeper or deliberately shallower than the exam needs.

For H.2, write the six gap-filler sections the brief names. Keep the book's opinions: the
Pushgateway section still argues it is usually the wrong answer and still points at the
node_exporter textfile collector for machine-level batch jobs — it just adds the mechanics
(grouping keys, honor_labels, why metrics outlive the job) that the exam expects.`,
  { label: 'write:app-h-map', phase: 'H and I', schema: REPORT }
)

const hQ = await agent(
  `Write PART 2 of Appendix H: the practice-question bank. Today is ${TODAY}.
Brief: ${MS}/_specs/appendix-h-pca.md §H.3 and §H.4.

${GROUND}

**APPEND to the existing file ${MS}/app-h-pca.md.** Read it first so you do not repeat its
material or contradict it. Do not rewrite what is there. Add \`## H.3 Practice questions\`,
\`## H.4 Answers and explanations\` and \`## H.5 A study path\`.

~80 questions, weighted: Observability Concepts 14, Prometheus Fundamentals 16, PromQL 23,
Instrumentation and Exporters 13, Alerting and Dashboarding 14. Group them by domain.

Every question: four options, one correct, single-select. **Every distractor must be a real
misconception** — use the ranked list in ${ROOT}/research/pedagogy.md §4 (rate vs increase,
counter resets, aggregate-then-rate, averaging quantiles, le as a string, cardinality arithmetic,
empty-result ratios, by vs without, staleness). A question whose wrong answers are obviously
wrong teaches nothing.

Answers go in H.4, not inline — the reader must be able to work through H.3 without seeing them.
Each answer says why the right option is right AND why each wrong option is wrong, and cites the
chapter that teaches it. PromQL questions use this book's real lab metric names so the reader can
run them; any printed result must agree with MEASURED.md. Mark ~10 questions "(harder than the
exam)" where the book goes deeper than associate level.

Write no real or reconstructed exam questions. Everything original, against this book's material.`,
  { label: 'write:app-h-questions', phase: 'H and I', schema: REPORT }
)

// --- Appendix I: solutions, split by chapter range ---
const RANGES = [
  { key: 'i1', from: 1, to: 10 },
  { key: 'i2', from: 11, to: 20 },
  { key: 'i3', from: 21, to: 29 },
]

const sols = await parallel(RANGES.map((r) => () =>
  agent(
    `Write the solutions for chapters ${r.from}-${r.to} of the textbook. Today is ${TODAY}.

${GROUND}

Write to ${MS}/_part-app-i-${r.key}.md. **No \`# \` heading** — this is a fragment that gets merged
into Appendix I. Start directly with \`## Chapter ${r.from}\` and continue per chapter.

For EACH chapter in ${r.from}..${r.to}: open ${MS}/ch<NN>-*.md, read its \`## Exercises\` section,
and write a solution for every numbered exercise. There are about six per chapter.

Format per chapter: a \`## Chapter N — Title\` heading, then \`**N.**\` per exercise with the
solution beneath it.

Rules:
- A solution states the answer, then the reasoning in two to five sentences. Where the exercise
  asks for an expression, command or config, give it — correct, runnable, and within the
  76-column code limit.
- Where an exercise is open-ended ("rank these", "explain why", "name a situation"), do not
  invent a single right answer. Write **what a good answer contains** — the two or three points
  that must appear, and the common wrong turn.
- Where \`make verify-chNN\` grades the exercise, say so and say what passing output looks like.
- Never contradict the chapter. If the chapter's own text answers it, agree with the chapter.
- Verify every expression against the real lab and MEASURED.md before printing it.
- Be concise. This is an answer key, not a second pass at teaching.`,
    { label: `write:app-i-${r.key}`, phase: 'H and I', schema: REPORT }
  )
))
log(`Solutions parts: ${sols.filter(Boolean).length}/3`)

phase('Merge')

const merged = await agent(
  `Assemble Appendix I from its three parts.

Read ${MS}/_part-app-i-i1.md, ${MS}/_part-app-i-i2.md and ${MS}/_part-app-i-i3.md, and write a
single file ${MS}/app-i-solutions.md that begins:

\`# Appendix I — Solutions to the exercises\`

followed by a short intro (about 150 words) explaining: solutions are here rather than inline so
the exercises stay honest; some exercises are graded by \`make verify-chNN\` and say so; open-ended
exercises get "what a good answer contains" rather than one right answer; and that a reader who
disagrees with a solution should trust the running lab over the page.

Then append the three parts in chapter order, unchanged except for fixing heading levels so every
chapter is a \`##\` and nothing inside a solution uses \`#\`.

Then delete the three \`_part-app-i-*.md\` files.

Finally, check the result: every chapter from 1 to 29 must have a section, and no section may be
empty. Report any chapter whose solutions are missing or thin.`,
  { label: 'merge:app-i', phase: 'Merge' }
)

return {
  front_and_ag: first.filter(Boolean).map((u) => u && u.file),
  appendix_h: [hMap && hMap.file, hQ && hQ.file],
  appendix_i: merged,
}
