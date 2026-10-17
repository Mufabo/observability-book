export const meta = {
  name: 'obs-lab-history-fix',
  description: 'Close the four blockers the history audit found, so every ch01..ch29 tag actually works',
  phases: [
    { title: 'Fix', detail: 'four agents, one per blocker, each verifying its own work' },
    { title: 'Re-audit', detail: 'compile and config-check every chapter state end to end' },
  ],
}

const ROOT = 'C:/Users/fatih/Desktop/Co-Authored with Claude/observability-book'
const LAB = ROOT + '/lab'
const MS = ROOT + '/manuscript'
const HIST = LAB + '/.history'
const SCRATCH = 'C:/Users/fatih/AppData/Local/Temp/claude/C--Users-fatih-Desktop-Co-Authored-with-Claude/ff0d43dd-98b0-46ae-ad93-8bb48428a4dd/scratchpad'
const PY = 'C:/Users/fatih/AppData/Local/Programs/Python/Python310/python.exe'

const LOOP = `
THE VERIFY LOOP — use it constantly, it is the whole point.

Assemble any chapter's complete tree and test it:

    "${PY}" ${ROOT}/build/assemble.py <N> ${SCRATCH}/ch<NN> --quiet

That applies build/chapter_map.json (which file first exists at which chapter) plus
${HIST}/ch<NN>/<path> (reconstructed versions of files that evolve), falling back to the live
file in ${LAB} when nothing earlier was reconstructed.

Compile the Go there — **Go is NOT installed on this host**, so use the lab's own build image:

    MSYS_NO_PATHCONV=1 docker run --rm \\
      -v "${SCRATCH}/ch<NN>:/src" -v gomodcache:/go/pkg/mod \\
      -w /src/snip golang:1.25-alpine go build ./...

The module cache volume makes runs after the first one fast. \`loadgen\` and \`catalog\` do not
change across chapters, so only \`snip\` needs this.

Check Prometheus config and rules the same way:

    MSYS_NO_PATHCONV=1 docker run --rm -v "${SCRATCH}/ch<NN>:/src" \\
      quay.io/prometheus/prometheus:v3.13.1 \\
      promtool check config /src/prometheus/prometheus.yml
`

const GROUND = `
You are repairing the reconstructed history of a teaching lab at ${LAB}. The book promises a git
tag per chapter (\`git checkout ch07\`) so a reader who breaks something can rejoin. An audit found
that most tags would not work. ${HIST}/AUDIT.md has the full findings — read it first.

AUTHORITIES
- ${MS}/ch01-*.md .. ch29-*.md — the chapters are the authority on their own increments.
- ${LAB}/LAB-SPEC.md §8 growth plan, §4 tree. ${LAB}/SPEC-DELTAS.md for deliberate departures.
- The live files in ${LAB} are the FINAL (chapter 29) state and are correct. You produce earlier
  states by subtracting what later chapters added — never by redesigning.

THE RULE THAT MATTERS MOST
A reader checks out a tag and runs \`make up\`. It must work. A tag that half-works is worse than
no tag, because the reader cannot tell your mistake from theirs.

${LOOP}
`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['blocker', 'files_written', 'verified', 'residual'],
  properties: {
    blocker: { type: 'string' },
    files_written: { type: 'array', items: { type: 'string' } },
    verified: { type: 'array', items: { type: 'string' },
      description: 'exactly what you ran and what it printed — commands and results' },
    residual: { type: 'array', items: { type: 'string' },
      description: 'anything still broken, or that you deliberately did not fix, and why' },
  },
}

phase('Fix')

const JOBS = [
  {
    key: 'go-compiles',
    ask: `**BLOCKER 1 — the \`snip\` Go package does not compile at any tag from ch01 to ch28.**
This is the one that matters; nothing else counts until it is fixed.

\`snip/main.go\`, \`snip/settings.go\` and \`snip/worker.go\` were treated as add-only, so every
chapter gets the chapter-29 copy. That copy calls into things that only exist later:
\`newBuildInfo\` and \`srv.refreshLinksActive\` (ch5), \`m.DBDuration\` (ch10), \`newWorker\` /
\`jobRecorder\` / \`newWorkerMetrics\` (ch8), \`rec.shutdown\` (ch28), \`newOTelWorkerMetrics\`
(ch28, otelmetrics.go); and \`settings.go\` references \`exemplarTraceID\` /
\`exemplarTraceIDCamel\`, which only ch29's metrics.go defines.

Confirmed by running the loop: at ch05, \`go build ./...\` fails with
\`m.DBDuration undefined\`, \`undefined: newWorker\`, \`undefined: jobRecorder\`.

YOUR JOB: write ${HIST}/ch<NN>/snip/<file> versions for \`main.go\`, \`settings.go\`,
\`worker.go\` and \`otelmetrics.go\` — and adjust the existing reconstructed \`metrics.go\` /
\`api.go\` versions if and only if consistency demands it — so that

    go build ./...   succeeds for EVERY chapter from 01 to 29.

Constraints:
- \`snip/worker.go\` must not exist before ch8 (LAB-SPEC §4 marks it (ch8)); \`main.go\` at
  ch1..ch7 must therefore not reference the worker at all. Same for \`otelmetrics.go\` before ch28.
- Each version must be a believable state of the program at that point: the ch1 service serves
  the endpoints ch1 describes; ch5 adds the counter the reader writes in ch5; and so on. Read
  those chapters — they print this code and the reader compares.
- The ch29 versions must be byte-identical to the live files. Verify with \`cmp\`.
- Run the compile for all 29 chapters and paste the results into \`verified\`. Do not claim a
  chapter compiles without having built it.`,
  },
  {
    key: 'recording-rules',
    ask: `**BLOCKER 3 — \`prometheus/rules/snip-recording.yml\` was never reconstructed.**

LAB-SPEC §4 marks it "(ch15; grows in ch20)" and §8 lists it as modified at ch20. Because no
earlier version exists, tags ch15..ch19 would ship the finished ch20 file — the full windowed
SLI ladder and \`slo:error_budget_remaining:ratio30d\` — which is precisely what chapter 20
exists to build. The reader would open ch20 to find its work already done.

YOUR JOB: write ${HIST}/ch15/prometheus/rules/snip-recording.yml (what chapter 15 builds) and
${HIST}/ch20/prometheus/rules/snip-recording.yml (what chapter 20 grows it into). Read chapters
15 and 20 and follow what they actually print. Check LAB-SPEC §5.9 for the normative recorded
names, and confirm the ch20 version matches the live file with \`cmp\`.

Then check the same failure mode across the other rule files: for each of
\`snip-alerts.yml\`, \`snip-burnrate.yml\`, \`meta-alerts.yml\`, \`meta-recording.yml\`, confirm
the earliest reconstructed version matches the chapter that creates it. Fix any that ship a
later state early, and say which you checked.

Verify each version with \`promtool check rules\` using the loop above.`,
  },
  {
    key: 'makefile-reload',
    ask: `**BLOCKER 4 — \`make reload\` cannot work at ch05, ch06 and ch10, but silently claims it did.**

\`--web.enable-lifecycle\` only enters the prometheus command block at ch12 (LAB-SPEC §2.7 marks
it "(ch12+)"). The Makefile ships a \`reload\` target from ch01, and chapters 5, 6 and 10 tell the
reader to run it. Prometheus answers 403. The recipe uses \`curl -sS\` with no \`-f\`, so it exits
0 and prints "reloaded" while nothing reloaded. Chapter 1 gets this right and says
\`docker compose restart prometheus\`.

YOUR JOB, in this order:
1. Reconstruct \`Makefile\` versions so that before ch12 the \`reload\` target either does not
   exist or actually restarts the container. Whichever you choose, the printed message must be
   true.
2. Add \`-f\` (or an explicit status check) to the reload recipe from ch12 onward, so a failed
   reload fails the target instead of lying. Fix the live ${LAB}/Makefile too — this is a real
   defect in the shipped lab, not only in its history.
3. Then check the chapters: chapters 5, 6 and 10 instruct the reader to run \`make reload\` at a
   point where it cannot work. Edit those chapters to use the restart form, matching chapter 1's
   wording. These are edits to ${MS}/ch05-*.md, ch06-*.md, ch10-*.md — keep them surgical.
4. Also fix \`.env.example\`, which claims \`SNIP_API_SCALE\` takes effect "from ch2"; \`--scale\`
   only enters \`make up\` at ch12.

Report every chapter file you edited.`,
  },
  {
    key: 'dashboard-route',
    ask: `**Two dashboard defects the audit found.**

(a) The reconstructed \`dashboards/snip-red.json\` at ch05 and ch06 queries
\`sum by (route) (...)\` on \`snip_http_requests_total\`, but that metric has no \`route\` label
until ch07. LAB-SPEC §0.3 deviation D2 is explicit: ch5 adds \`{method, code}\` and **ch7 adds
\`route\`**. The dashboard agent followed chapter 5's printed query; the Go agents followed D2.
One of them has to give.

Resolve it in favour of whatever makes the lab TRUE at ch05: read chapter 5 and chapter 7, decide
whether the chapter text or the dashboard is wrong, and fix the one that is. If chapter 5 prints a
query that cannot work at chapter 5, that is a chapter defect — fix ${MS}/ch05-*.md. Say clearly
which way you resolved it and why.

(b) The ch12 tag inherits chapter 11's three workbench panels, which are pinned to
\`instance="snip-api:8000"\`. Chapter 12 replaces static targets with \`docker_sd\`, after which
that instance label no longer exists, so those panels go permanently blank at exactly the tag
that introduces service discovery. Write a ch12 version of the dashboard that repairs them.

Verify every expression you write against the live stack if it is up
(\`docker compose ps\` in ${LAB}), otherwise against ${LAB}/MEASURED.md and the metric catalogue
in LAB-SPEC §5. Every metric and label you reference must exist at that chapter.`,
  },
]

const fixes = await parallel(JOBS.map((j) => () =>
  agent(`${GROUND}\n\n${j.ask}`,
    { label: `fix:${j.key}`, phase: 'Fix', schema: SCHEMA })
))
log(`Fixes: ${fixes.filter(Boolean).length}/${JOBS.length}`)

phase('Re-audit')

const reaudit = await agent(
  `Re-audit the reconstructed history end to end, now that four blockers have been worked.

${GROUND}

Four agents just reported:
${fixes.filter(Boolean).map((f) => `- ${f.blocker}: ${(f.residual || []).join('; ') || 'no residual'}`).join('\n')}

DO THIS MECHANICALLY, for **every** chapter 1 to 29 — do not sample, and do not trust the
reports above:

1. Assemble the tree.
2. \`go build ./...\` in \`snip\` using the golang image. Record pass/fail per chapter.
3. \`promtool check config\` on the assembled prometheus.yml, and \`promtool check rules\` on
   whatever rule files exist at that chapter. Record pass/fail per chapter.
4. Confirm every \`rule_files\` glob matches at least one file that exists at that chapter — an
   unmatched glob is not an error, but a rules file arriving before the chapter that writes it is.
5. Confirm the ch29 assembly is byte-identical to the live lab, ignoring the files
   build/assemble.py deliberately skips. Use \`diff -r\`.

Rewrite ${HIST}/AUDIT.md with the results: a table of chapter x (go build, promtool config,
promtool rules) and a list of what is still broken.

Return a plain-text summary: how many of the 29 chapters now pass all checks, and the remaining
failures in order of severity. Be exact and do not round up — a tag that does not build is a
broken promise to the reader.`,
  { label: 'reaudit:history', phase: 'Re-audit' }
)

return { fixes: fixes.filter(Boolean).map((f) => f.blocker), reaudit }
