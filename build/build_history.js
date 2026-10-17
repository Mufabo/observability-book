export const meta = {
  name: 'obs-lab-history',
  description: 'Produce per-chapter versions of every lab file that evolves, for the ch01..ch29 git history',
  phases: [
    { title: 'Evolve', detail: 'one agent per evolving file, emitting each chapter version' },
    { title: 'Audit', detail: 'check every emitted version is internally consistent for its chapter' },
  ],
}

const ROOT = 'C:/Users/fatih/Desktop/Co-Authored with Claude/observability-book'
const LAB = ROOT + '/lab'
const MS = ROOT + '/manuscript'
const HIST = LAB + '/.history'
const TODAY = '2026-09-18'

// Files the growth plan shows being touched in more than one chapter.
// `created` is the chapter the file first exists; `touched` are the chapters
// the growth plan says it changes. Agents may add change points they find in
// the chapters themselves — the book is the authority on its own increments.
const FILES = [
  { path: 'compose.yaml', created: 1, touched: [1, 2, 3, 4, 8, 12, 17, 22, 23, 25, 27, 28] },
  { path: 'prometheus/prometheus.yml', created: 1, touched: [1, 2, 4, 8, 12, 15, 16, 19, 22, 23, 24, 25, 28] },
  { path: 'dashboards/snip-red.json', created: 3, touched: [3, 5, 6, 9, 10, 11, 13] },
  { path: 'snip/metrics.go', created: 1, touched: [1, 5, 7, 10, 29] },
  { path: 'snip/api.go', created: 1, touched: [1, 5, 7, 10, 29] },
  { path: 'provisioning/datasources/prometheus.yaml', created: 3, touched: [3, 26, 29] },
  { path: 'Makefile', created: 1, touched: [1, 18] },
  { path: 'edge/Caddyfile', created: 12, touched: [12, 25] },
  { path: 'prometheus/rules/snip-alerts.yml', created: 16, touched: [16, 19, 21] },
  { path: 'alertmanager/alertmanager.yml', created: 17, touched: [17, 19, 21] },
  { path: 'prometheus/rules/meta-alerts.yml', created: 19, touched: [19, 22, 23] },
]

const GROUND = `
You are reconstructing the history of a teaching lab. The repository at ${LAB} currently holds
only its FINAL state — the state at the end of chapter 29. The book promises a git tag per
chapter (\`git checkout ch07\`) so a reader who breaks something can rejoin. Those tags do not
exist yet. You are producing the file contents they will point at.

AUTHORITIES
- ${LAB}/LAB-SPEC.md §8 — the chapter-by-chapter growth plan: which files each chapter creates
  and modifies, and what the reader can newly observe.
- ${MS}/ch01-*.md .. ch29-*.md — **the chapters themselves are the authority on their own
  increments.** Each has a lab step saying exactly what it adds or changes. If a chapter's text
  disagrees with §8, the chapter wins: the reader follows the chapter.
- ${LAB}/MEASURED.md — measured figures. ${LAB}/SPEC-DELTAS.md — where the built lab
  deliberately departs from the spec.
- The final file itself, in ${LAB}. It is correct. You are producing earlier states of it, never
  a different design.

THE RULE THAT MATTERS MOST
**Every version you emit must actually work on its own.** A reader checks out \`ch04\` and runs
\`make up\`. If your chapter-4 \`compose.yaml\` references a service that arrives in chapter 12, or
your chapter-4 \`prometheus.yml\` scrapes a job whose target does not exist yet, the lab is broken
at that tag and the promise is worse than no promise at all.

So for each version, check it against the chapter's own state of the world:
- Only services/targets/files that exist at or before that chapter.
- Only metrics the instrumentation emits by then.
- Only config keys and flags the chapter has introduced or that were there from the start.
- Comments that reference a later chapter as a promise are fine ("chapter 12 fixes this");
  comments that assume a later chapter has already happened are not.

Work FORWARD from the creation chapter, subtracting from the final file rather than inventing:
take the final version and remove everything later chapters added. Never redesign.
`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'versions_written', 'change_points', 'notes'],
  properties: {
    path: { type: 'string' },
    versions_written: { type: 'array', items: { type: 'integer' },
      description: 'chapter numbers for which a file was written' },
    change_points: { type: 'array', items: { type: 'string' },
      description: 'one line per version: what that chapter added or changed' },
    notes: { type: 'array', items: { type: 'string' },
      description: 'disagreements with LAB-SPEC §8, or anything a reviewer should check' },
  },
}

phase('Evolve')

const results = await parallel(FILES.map((f) => () =>
  agent(
    `${GROUND}

YOUR FILE: **${f.path}**
It first exists at **chapter ${f.created}**. The growth plan says it changes at chapters
${f.touched.join(', ')} — verify that against the chapters' own text and adjust if the book
disagrees.

TASK
1. Read the final version: ${LAB}/${f.path}
2. Read LAB-SPEC §8, and every chapter whose lab step touches this file. Grep the manuscript for
   the filename to find them all — a chapter may change it without §8 recording that.
3. For EACH chapter where the file changes (including chapter ${f.created}, its first version),
   write the complete file as it stands at the END of that chapter to:
       ${HIST}/ch<NN>/${f.path}
   using a two-digit chapter number, e.g. ${HIST}/ch04/${f.path}
   Write the WHOLE file, not a diff. Do not write a version for chapters where it does not change;
   the assembler carries the previous version forward.
4. The version for chapter 29 must be **byte-identical to the current final file**. Verify that
   explicitly — diff them — because the final tag has to match what the reader already has.

Return the structured report. \`change_points\` must have one entry per version you wrote,
saying what changed at that chapter and why, in one line.`,
    { label: `evolve:${f.path.replace(/[^a-z0-9]/gi, '-')}`, phase: 'Evolve', schema: SCHEMA }
  )
))

const ok = results.filter(Boolean)
log(`Evolved ${ok.length}/${FILES.length} files`)

phase('Audit')

const summary = ok.map((r) =>
  `${r.path}: versions at ch ${(r.versions_written || []).join(',')}` +
  ((r.notes || []).length ? `\n   notes: ${r.notes.join(' | ')}` : '')
).join('\n')

const audit = await agent(
  `Audit the reconstructed lab history at ${HIST}. Today is ${TODAY}.

${GROUND}

What the evolving-file agents produced:
${summary}

CHECK, per chapter from 01 to 29, treating the chapter's state as
"every add-only file whose creation chapter <= N" (see ${ROOT}/build/chapter_map.json)
"plus the newest version <= N of each evolving file":

1. **compose.yaml self-consistency.** Every service it defines has a build context or image that
   exists at that chapter. Every \`depends_on\` names a service defined in the same file. No
   service references a volume or network that is not declared.
2. **prometheus.yml self-consistency.** Every scrape job's target is a service that exists at
   that chapter. Every \`rule_files\` glob matches files that exist at that chapter — a missing
   rule file is a fatal Prometheus start-up error, so this one really matters.
3. **No forward references that assume the future has happened.** A comment promising a later
   chapter is fine; config that only works once a later chapter has run is not.
4. **Chapter 29 versions are byte-identical to the live files in ${LAB}.**
5. **Monotonic growth.** Nothing present at chapter N should vanish at N+1 unless a chapter
   explicitly retires it — LAB-SPEC names two: \`snip-api-b\` is deleted in ch12, and the
   published host ports for snip-api (ch12) and prometheus (ch25) are dropped.

Write your findings to ${HIST}/AUDIT.md as a table: chapter, file, problem, fix.
Fix nothing yourself. Return a plain-text summary: how many chapters are clean, and the
blocking problems in order of severity.`,
  { label: 'audit:history', phase: 'Audit' }
)

return { files: ok.map((r) => ({ path: r.path, versions: r.versions_written })), audit }
