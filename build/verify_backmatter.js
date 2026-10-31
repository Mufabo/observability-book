export const meta = {
  name: 'obs-book-backmatter',
  description: 'Verify and repair the front matter and appendices A-I against the live lab',
  phases: [
    { title: 'Verify', detail: 'two independent lenses per unit: technical truth and cross-book consistency' },
    { title: 'Adjudicate', detail: 'three adversarial refuters per unit; majority vote kills a finding' },
    { title: 'Repair', detail: 'one agent per file, applying only confirmed findings' },
    { title: 'Critic', detail: 'completeness pass over the repaired back matter' },
  ],
}

const ROOT = 'C:/Users/fatih/Desktop/Co-Authored with Claude/observability-book'
const MS = ROOT + '/manuscript'
const LAB = ROOT + '/lab'
const SCRATCH = 'C:/Users/fatih/AppData/Local/Temp/claude/C--Users-fatih-Desktop-Co-Authored-with-Claude/ff0d43dd-98b0-46ae-ad93-8bb48428a4dd/scratchpad'

// One unit = one verifiable slice. The two big appendices are split because
// 18k and 22k words do not get read carefully by a single agent.
const UNITS = [
  { id: 'front', file: '00-front-matter.md', scope: 'the whole file (F.1-F.6)', target: 'n/a',
    note: 'F.5 is the version table. ALREADY CHECKED MECHANICALLY: all 11 image tags match the lab exactly. Spend your effort on F.1-F.4 and F.6 instead.' },
  { id: 'app-a', file: 'app-a-complete-lab.md', scope: 'the whole file', target: '2,500 (actual 3,168)',
    note: 'ALREADY CHECKED MECHANICALLY and correct: the port map (including the "ch1 through ch24" row that reflects chapter 25 deleting the published 9090 port), the service inventory across all three compose files, and every make target. Do not re-litigate those; verify the directory tree, the chapter-to-tag table, the teaching switches, the loadgen control API and the registry policy instead.' },
  { id: 'app-b', file: 'app-b-debugging-ladder.md', scope: 'the whole file', target: '1,800 (actual 2,044)',
    note: 'The twelve rungs must each be runnable against the real lab. The "answer key: chapter 14\'s five planted lies" section must match what verify-ch14.sh actually detects and what chapter 14 actually plants.' },
  { id: 'app-c', file: 'app-c-promql-by-type.md', scope: 'the whole file', target: '3,500 (actual 3,767)',
    note: 'EVERY PromQL expression here must parse and run against Prometheus 3.13.1 on the live stack. Run them. The "experimental surface, flag by flag" and "names that changed" sections are the highest-risk parts: check each flag name against the real binary.' },
  { id: 'app-d', file: 'app-d-naming-cardinality.md', scope: 'the whole file', target: '1,800 (actual 2,050)',
    note: 'The worked example and the base-units table. The cardinality arithmetic must reproduce exactly.' },
  { id: 'app-e', file: 'app-e-three-metrics-three-languages.md', scope: 'the whole file', target: '3,500 (actual 3,481)',
    note: 'KNOWN DEVIATION: the spec (_specs/appendices.md) titles this "Go, Java and Node" but the appendix covers FOUR languages - Python was added, with a multiprocess trap section. The reader-facing title is correct and the deviation looks deliberate and good; confirm it is intentional and that _specs is the stale side, not the appendix. The filename still says "three-languages" but the reader never sees it (the manifest carries the real title) - note it, do not rename the file, because the manifest and the build reference that path. Verify every client-library version against what the lab actually pins, and verify each code sample compiles/parses.' },
  { id: 'app-f', file: 'app-f-reading-older-material.md', scope: 'the whole file', target: '2,500 (actual 2,532)',
    note: 'The "if the page says this, it now means that" table is the core. Every claimed rename/retirement must be real. "The citation rule that caught this book\'s worst error" must describe an error that genuinely happened.' },
  { id: 'app-g', file: 'app-g-promtool-cookbook.md', scope: 'the whole file', target: '2,000 (actual 2,359)',
    note: 'RUN every promtool invocation shown. promtool runs inside the Prometheus image with an overridden entrypoint - see the lab Makefile. Exit codes must be the real ones.' },
  { id: 'app-h-map', file: 'app-h-pca.md', scope: 'sections H.0, H.1 and H.2 only', target: 'part of 9,000 (file is 18,265)',
    note: 'H.0 restates the Linux Foundation exam domains and weights - verify against research/, and respect research/_CONFLICTS.md. H.1 is the competency map: every chapter reference and every quoted heading must exist verbatim in that chapter. H.2 closes six gaps.' },
  { id: 'app-h-q', file: 'app-h-pca.md', scope: 'section H.3 (practice questions) only', target: 'part of 9,000',
    note: 'Every question must be answerable from the book, and must have exactly one defensible answer. Flag any question whose distractors are ambiguous or whose stem leaks the answer.' },
  { id: 'app-h-a', file: 'app-h-pca.md', scope: 'section H.4 (answers and explanations) only', target: 'part of 9,000',
    note: 'CRITICAL: every answer letter must match the correct option in H.3, and every explanation must agree with the chapter it cites. An answer key that is off by one option is the worst defect this appendix can ship. Check each one.' },
  { id: 'app-h-path', file: 'app-h-pca.md', scope: 'section H.5 (study path) only', target: 'part of 9,000',
    note: 'The study path must reference chapters that exist and must not promise content the book does not have.' },
  { id: 'app-i-1', file: 'app-i-solutions.md', scope: 'the sections for chapters 1 through 10', target: 'n/a (scales with exercises)',
    note: 'ALREADY CHECKED MECHANICALLY: all 170 exercises across 29 chapters have exactly one matching numbered solution, so coverage is complete - do not re-count. Verify instead that each solution actually SOLVES its exercise as worded, and that every command and figure in the solution is real.' },
  { id: 'app-i-2', file: 'app-i-solutions.md', scope: 'the sections for chapters 11 through 20', target: 'n/a',
    note: 'Same as app-i-1. Chapter 19.3 figures come from a measured run recorded in MEASURED.md section 12 - they outrank anything you reason out.' },
  { id: 'app-i-3', file: 'app-i-solutions.md', scope: 'the sections for chapters 21 through 29', target: 'n/a',
    note: 'Same as app-i-1. Chapters 24-29 were revised immediately before this run, so their exercises may have changed - re-read each chapter\'s CURRENT exercise text before judging its solution. This is the highest-risk slice in the whole back matter.' },
]

// Repair is grouped by file so two agents never write the same file.
const FILES = [
  '00-front-matter.md', 'app-a-complete-lab.md', 'app-b-debugging-ladder.md',
  'app-c-promql-by-type.md', 'app-d-naming-cardinality.md',
  'app-e-three-metrics-three-languages.md', 'app-f-reading-older-material.md',
  'app-g-promtool-cookbook.md', 'app-h-pca.md', 'app-i-solutions.md',
]

const GROUND_TRUTH = `
GROUND TRUTH - read in this order. Later sources never override earlier ones.

0. **${LAB}/MEASURED.md** - figures captured from the stack ACTUALLY RUNNING. Outranks
   everything, including the lab source and the spec, for any number you print.
   **${LAB}/VERIFY-STATUS.md** - which verify scripts actually pass, and the five checker
   defects V1-V5 (all now closed). Do not promise a clean \`make verify-chNN\` it contradicts.
1. **${LAB}/** - the ACTUAL BUILT LAB. Every command, path, metric name, label, port and config
   key must match the real files. Open them. Never describe code you have not read.
2. **${LAB}/SPEC-DELTAS.md**, then **${LAB}/LAB-SPEC.md**.
3. **${MS}/_specs/_POLICY.md**, **_DEPENDENCY-GRAPH.md**, **${MS}/_STYLE-GUIDE.md**.
   For the appendices the briefs are **${MS}/_specs/appendices.md** and
   **${MS}/_specs/appendix-h-pca.md**; the front matter brief is **_specs/front-matter.md**.
4. **${ROOT}/research/*.md**. **${ROOT}/research/_CONFLICTS.md** is a QUARANTINE LIST:
   nothing on it may be printed as fact.

NON-NEGOTIABLE
- Never invent a metric name, label, port, path, config key, function or version.
- Every PromQL expression must be valid Prometheus 3.13 PromQL over series that exist.
- Every command must be one the reader can really run.

THE BACK MATTER IS REFERENCE MATERIAL, WHICH CHANGES THE FAILURE MODE.
A chapter that is slightly off teaches a slightly wrong idea. An appendix that is slightly off
is COPIED. A wrong flag name in Appendix C, a wrong exit code in Appendix G, or an answer key
that is off by one option in H.4 goes straight into a reader's terminal or exam. Hold this
material to a higher bar than chapter prose, and prefer "verify it by running it" every time.

TWO SOURCES OF TRUTH
(a) **What exists at a given chapter** - the assembled trees at ${SCRATCH}/trees/ch<NN>/,
    all 29 of them. Use these, not ${LAB}, to judge what a file looks like at a point in the
    book. ${LAB} is the finished ch29 state and is ahead of every chapter but the last.
(b) **How it behaves** - the live stack. Find it with:

        docker ps --format '{{.Names}}\\t{{.Ports}}'

    Read which chapter's tree it was brought up from before trusting it.

**THERE IS NO PUBLISHED localhost:9090 FROM CHAPTER 25 ON.** Chapter 25 has the reader delete
\`ports: - "9090:9090"\` as its "locking the door" lesson, and the lab history honours it: ch01-ch23
publish it, ch25/ch28/ch29 do not. If the running stack is at ch25 or later, Prometheus is
reachable ONLY from inside \`obsnet\`. A readiness poll against localhost:9090 there hangs forever.
Always query it this way:

    docker run --rm --network obsnet alpine:3 sh -c \\
      'apk add --no-cache curl >/dev/null 2>&1;
       curl -s -G --data-urlencode "query=<EXPR>" http://prometheus:9090/api/v1/query'

Grafana IS published on 3000 and Alertmanager on 9093. Chapters 1-23 legitimately print
localhost:9090 and must NOT be "corrected"; Appendix A's port map already records this.

WHAT HAS ALREADY BEEN CHECKED MECHANICALLY - DO NOT SPEND EFFORT RE-DOING IT
These were run over the whole back matter immediately before this workflow and all came back
clean. Re-report one of these ONLY if you can show the automated check was wrong:
- All 170 exercises across all 29 chapters have exactly one matching numbered solution in
  Appendix I. Coverage is complete; numbering matches exactly.
- The front matter's F.5 version table matches the lab's pinned images, all 11 of them.
- No style-guide mechanical violations anywhere in the back matter: no code fence over 76
  columns, no fence without a language tag, no table over 4 columns, no disallowed admonition
  class, no raw HTML, no images, no Mermaid.
- Every "this book" occurrence is a legitimate noun phrase, not the banned "this book will
  teach you" construction.
- Appendix A's port map, service inventory (across all three compose files) and make-target
  table are all accurate.
- The built EPUB has no encoding corruption and every build script opens text with an
  explicit encoding.
Length against spec: A-G are all within 27% of target, which is fine. **Appendix H is 18,265
words against a 9,000-word spec - more than double.** That is the one open length question.
`

const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['unit', 'lens', 'checks_run', 'findings'],
  properties: {
    unit: { type: 'string' },
    lens: { type: 'string' },
    checks_run: { type: 'array', items: { type: 'string' },
      description: 'Commands or queries you actually executed, verbatim' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'severity', 'location', 'claim', 'evidence', 'fix'],
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          location: { type: 'string', description: 'file and heading or line' },
          claim: { type: 'string', description: 'what the text says that is wrong' },
          evidence: { type: 'string', description: 'the command output or file content proving it' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['unit', 'verdicts'],
  properties: {
    unit: { type: 'string' },
    verdicts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'refuted', 'reason'],
        properties: {
          id: { type: 'string' },
          refuted: { type: 'boolean', description: 'true if the finding is wrong, overstated, or already correct in the text' },
          reason: { type: 'string', description: 'the check you ran to decide' },
        },
      },
    },
  },
}

const REPAIR_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['file', 'applied', 'skipped', 'summary'],
  properties: {
    file: { type: 'string' },
    applied: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

log(`Back matter: ${UNITS.length} units over ${FILES.length} files, ~64,000 words.`)

const results = await pipeline(
  UNITS,

  // ---- Verify: two independent lenses, run concurrently per unit ----
  (unit) => parallel([
    () => agent(
      `You are the TECHNICAL verifier for the back matter of a Prometheus/Grafana textbook.

UNIT: ${unit.id}
FILE: ${MS}/${unit.file}
SCOPE: ${unit.scope}
LENGTH TARGET: ${unit.target}
UNIT NOTE: ${unit.note}

${GROUND_TRUTH}

YOUR LENS: technical truth, established by EXECUTION rather than reading.
Read your scope line by line. For every factual claim - a metric name, a flag, a port, a path,
a version, a PromQL expression, a command, an exit code, a numeric figure - verify it against
the real lab or the running stack. RUN the commands. RUN the queries. Put what you actually
ran in checks_run, verbatim.

A finding needs evidence that someone else could reproduce: the command and its output, or the
file and the line. "This looks wrong" is not a finding. If you cannot verify a claim because the
environment is not up (the ch26 scale overlay, the ch28 OTEL switch, the ch29 signals overlay, a
Kubernetes cluster), say so explicitly as a minor finding rather than guessing - an unverified
runtime claim is exactly what MEASURED.md exists to prevent.

Be hard to satisfy on reference material: it gets copied verbatim into readers' terminals.`,
      { label: `verify:${unit.id}:technical`, phase: 'Verify', schema: FINDINGS_SCHEMA },
    ),
    () => agent(
      `You are the CONSISTENCY verifier for the back matter of a Prometheus/Grafana textbook.

UNIT: ${unit.id}
FILE: ${MS}/${unit.file}
SCOPE: ${unit.scope}
LENGTH TARGET: ${unit.target}
UNIT NOTE: ${unit.note}

${GROUND_TRUTH}

YOUR LENS: does this contradict the rest of the book, and does it work for the reader it is for?

Hunt specifically for:
1. **Contradiction with a chapter.** The back matter summarises 29 chapters; it drifts when a
   chapter is revised and the appendix is not. Open the chapter and compare. This has already
   bitten the book once: chapter 18 said a missing label renders as an empty string when it is
   \`<no value>\`, and chapter 19 had said so correctly in three places.
2. **A cross-reference to the wrong chapter**, or to a heading that no longer exists verbatim.
3. **Forward references that break the dependency graph** - using a term before the chapter
   that owns it (_specs/_DEPENDENCY-GRAPH.md). Appendices are read out of order, so an appendix
   may use any term, but it must SAY where the term is taught if it is not obvious.
4. **Arithmetic the reader cannot reproduce** - a figure that does not follow from the numbers
   given, or a step silently skipped.
5. **A promise the lab does not keep** - "run this and you will see X" where X needs an overlay
   or a switch that is off.
6. **Prometheus 3 breaking changes stated wrongly**: \`le\`/\`quantile\` are normalised to canonical
   float form, so \`le="1"\` matches nothing and you must write \`le="10.0"\`; regex \`.\` matches
   newline; range selectors are left-open; scrape Content-Type is strict.
7. **Tone and usefulness**: the reader is a developer new to ops. Reference material that is
   correct but unusable - no entry point, no index, buried answer - is a real finding.

Do NOT report mechanical style issues; those were already checked and are clean. Put the
specific comparisons you made in checks_run.`,
      { label: `verify:${unit.id}:consistency`, phase: 'Verify', schema: FINDINGS_SCHEMA },
    ),
  ]).then((rs) => ({ unit, reports: rs.filter(Boolean) })),

  // ---- Adjudicate: three adversarial refuters, majority kills a finding ----
  ({ unit, reports }) => {
    const found = reports.flatMap((r) => r.findings || [])
    if (!found.length) return { unit, confirmed: [], raw: 0 }
    const packet = found.map((f) =>
      `[${f.id}] (${f.severity}) ${f.location}\n  CLAIM: ${f.claim}\n  EVIDENCE: ${f.evidence}\n  FIX: ${f.fix}`,
    ).join('\n\n')
    const LENSES = [
      'Check whether the text ALREADY SAYS the right thing and the finder misread it. Re-read the surrounding paragraphs in full before you accept any finding.',
      'Check the finder\'s EVIDENCE by re-running it yourself. Tooling errors are the single most common source of false findings on this project: a regex that missed a format variant, a file opened with the wrong encoding, a query run against the wrong chapter\'s stack, a target sampled inside the 15s docker_sd refresh window and called missing.',
      'Check whether the proposed FIX would break something else - a transcript a chapter prints verbatim, a figure MEASURED.md pins, a deliberate spec deviation, or a cross-reference another file depends on.',
    ]
    return parallel(LENSES.map((lens, i) => () => agent(
      `You are an ADVERSARIAL REFUTER for findings against a Prometheus/Grafana textbook's back matter.

UNIT: ${unit.id}
FILE: ${MS}/${unit.file}
SCOPE: ${unit.scope}

${GROUND_TRUTH}

YOUR SPECIFIC LENS: ${lens}

DEFAULT TO refuted=true. Mark a finding real ONLY if you independently reproduced the problem.
On this project, plausible-sounding findings have repeatedly turned out to be the finder's own
tooling error rather than a defect in the book. Two of the five historical checker defects were
misdiagnosed on first analysis, both in the direction of the shallow explanation.

Equally: a REAL defect that you wave away ships to the reader. Do not refute by assertion - run
the check.

FINDINGS TO ADJUDICATE:

${packet}

Return exactly one verdict per finding id, and nothing invented.`,
      { label: `judge:${unit.id}:${i + 1}`, phase: 'Adjudicate', schema: VERDICT_SCHEMA },
    ))).then((votes) => {
      const live = votes.filter(Boolean)
      const confirmed = found.filter((f) => {
        const vs = live.map((v) => (v.verdicts || []).find((x) => x.id === f.id)).filter(Boolean)
        if (!vs.length) return true // nobody adjudicated it; keep it for the repairer to judge
        return vs.filter((v) => v.refuted).length < Math.ceil(vs.length / 2)
      })
      log(`${unit.id}: ${found.length} raw -> ${confirmed.length} confirmed`)
      return { unit, confirmed, raw: found.length }
    })
  },
)

// Barrier is correct here: repair groups by FILE, and a file's findings come
// from several units (app-h has four, app-i has three). Two agents must never
// write the same file.
const live = results.filter(Boolean)
const byFile = {}
for (const r of live) {
  const f = r.unit.file
  if (!byFile[f]) byFile[f] = []
  for (const c of r.confirmed) byFile[f].push({ ...c, unit: r.unit.id })
}
const rawTotal = live.reduce((n, r) => n + r.raw, 0)
const confTotal = Object.values(byFile).reduce((n, v) => n + v.length, 0)
log(`Adjudication done: ${rawTotal} raw findings -> ${confTotal} confirmed across ${Object.keys(byFile).length} files.`)

phase('Repair')

const repairs = await parallel(FILES.map((file) => () => {
  const items = byFile[file] || []
  if (!items.length) return Promise.resolve({ file, applied: [], skipped: [], summary: 'no confirmed findings' })
  const packet = items.map((f) =>
    `[${f.id}] from ${f.unit} (${f.severity}) ${f.location}\n  PROBLEM: ${f.claim}\n  EVIDENCE: ${f.evidence}\n  PROPOSED FIX: ${f.fix}`,
  ).join('\n\n')
  return agent(
    `You are repairing one file of a Prometheus/Grafana textbook's back matter.

FILE TO EDIT: ${MS}/${file}
You are the ONLY agent editing this file. Do not edit any other file.

${GROUND_TRUTH}

CONFIRMED FINDINGS (each survived three adversarial refuters):

${packet}

HOW TO REPAIR
- Fix the defect, not the sentence around it. If the proposed fix is wrong but the problem is
  real, fix it correctly and say so in your summary.
- VERIFY each fix the same way the finding was verified - run the command, run the query. Do not
  swap one unverified claim for another.
- If applying a finding would contradict MEASURED.md, a chapter's printed transcript, or a
  deliberate spec deviation, SKIP it and say why. Skipping with a reason is a good outcome.
- Preserve the house style: code fences carry a language tag and stay at or under 76 columns,
  ASCII diagrams at or under 72, tables at most 4 columns, only the allowed admonition classes,
  American English, second person, present tense, no "simply"/"just"/"obviously", no
  "above"/"below" as pointers, no page references.
- Do not renumber Appendix I solutions or change exercise numbering: all 170 currently match.
- Do not rename the file.

Report exactly which finding ids you applied and which you skipped, with reasons.`,
    { label: `repair:${file.replace(/\.md$/, '')}`, phase: 'Repair', schema: REPAIR_SCHEMA },
  )
}))

phase('Critic')

const applied = repairs.filter(Boolean)
const critic = await agent(
  `You are the COMPLETENESS CRITIC for the back matter of a Prometheus/Grafana textbook.

${GROUND_TRUTH}

The front matter and appendices A-I have just been verified by two lenses per unit, adjudicated
by three adversarial refuters, and repaired. Here is what the repairers reported:

${applied.map((r) => `${r.file}: applied ${(r.applied || []).length}, skipped ${(r.skipped || []).length}\n  ${r.summary}`).join('\n\n')}

YOUR JOB is to find what the pass MISSED. Ask, and answer by checking:
1. Which claims in the back matter are still UNVERIFIED - nobody ran them? Name them.
2. Which verification modality was never run at all? (Did anyone actually execute promtool for
   Appendix G, or run Appendix C's PromQL against the live Prometheus?)
3. Did a repair introduce a NEW inconsistency with a chapter, or break a cross-reference?
4. Is Appendix H's length - 18,265 words against a 9,000-word spec - a real problem for the
   reader, and if so what specifically should be cut? Give a concrete recommendation, not a
   hedge. Note the spec says it was to be "written last, once every chapter exists".
5. Appendix I is 22,620 words of solutions. Spot-check at least six solutions spread across the
   range, including at least two from chapters 24-29, and confirm each solves its exercise AS
   CURRENTLY WORDED.
6. Is there anything the back matter should contain and does not?

Return prose. Be specific and name files and headings. If the pass was genuinely thorough, say
so plainly rather than inventing work.`,
  { label: 'critic:back-matter', phase: 'Critic' },
)

return {
  units: UNITS.length,
  raw_findings: rawTotal,
  confirmed_findings: confTotal,
  per_file: Object.fromEntries(Object.entries(byFile).map(([f, v]) => [f, v.length])),
  repairs: applied.map((r) => ({ file: r.file, applied: (r.applied || []).length, skipped: (r.skipped || []).length, summary: r.summary })),
  critic,
}
