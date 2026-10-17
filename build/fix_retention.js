export const meta = {
  name: 'obs-lab-retention',
  description: 'Close the retention/backfill MAJOR across ch20-ch24 and sweep the residual minors',
  phases: [{ title: 'Fix', detail: 'retention decision, then the minor sweep' }],
}

const ROOT = 'C:/Users/fatih/Desktop/Co-Authored with Claude/observability-book'
const LAB = ROOT + '/lab'
const MS = ROOT + '/manuscript'
const HIST = LAB + '/.history'
const SCRATCH = 'C:/Users/fatih/AppData/Local/Temp/claude/C--Users-fatih-Desktop-Co-Authored-with-Claude/ff0d43dd-98b0-46ae-ad93-8bb48428a4dd/scratchpad'
const PY = 'C:/Users/fatih/AppData/Local/Programs/Python/Python310/python.exe'

const LOOP = `
VERIFY LOOP — Go is NOT installed on this host; use containers.

    "${PY}" ${ROOT}/build/assemble.py <N> ${SCRATCH}/ch<NN> --quiet

    MSYS_NO_PATHCONV=1 docker run --rm -v "${SCRATCH}/ch<NN>:/src" \\
      -v gomodcache:/go/pkg/mod -w /src/snip golang:1.25-alpine go build ./...

    MSYS_NO_PATHCONV=1 docker run --rm -v "${SCRATCH}/ch<NN>:/src" \\
      --entrypoint promtool quay.io/prometheus/prometheus:v3.13.1 \\
      check config /src/prometheus/prometheus.yml

**Note the \`--entrypoint promtool\`.** The image's entrypoint is \`/bin/prometheus\`, so without
it you get "unexpected promtool", which reads exactly like a config error and is not one.
`

const GROUND = `
You are finishing the reconstructed per-chapter history of a teaching lab at ${LAB}.
${HIST}/AUDIT.md holds the current state: all 29 chapters build and validate; what remains is
below. The live files in ${LAB} are the FINAL (ch29) state and are correct; earlier states are
produced by subtracting, never by redesigning. The chapters in ${MS} are the authority on their
own increments.

${LOOP}
`

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['job', 'decision', 'files_written', 'verified', 'residual'],
  properties: {
    job: { type: 'string' },
    decision: { type: 'string', description: 'what you decided and why, in a few sentences' },
    files_written: { type: 'array', items: { type: 'string' } },
    verified: { type: 'array', items: { type: 'string' } },
    residual: { type: 'array', items: { type: 'string' } },
  },
}

phase('Fix')

const jobs = await parallel([
  () => agent(
    `${GROUND}

**THE MAJOR — retention, ch20 to ch24.**

No retention is configured until ch25, and no \`compose.yaml\` at any chapter carries
\`--storage.tsdb.retention.time\`. Prometheus therefore runs its 15-day default while
\`make backfill\` (introduced for chapter 20's SLO work) imports 30 days. The backfilled history
is silently trimmed, so every 30-day rung reads only the last 15 — the SLO numbers the reader
computes in ch20 and the burn rates in ch21 are quietly wrong.

Compounding it, the \`backfill\` target's closing message at ch20-ch24 says
*"compose.yaml sets --storage.tsdb.retention.time"*, which is false at those chapters. The ch25
Makefile has corrected wording; ch20-ch24 kept the false one.

**Decide and implement.** The two defensible routes:

(a) **Set retention early with an IOU.** Put \`--storage.tsdb.retention.time\` into the Prometheus
    command from the chapter that first needs it, with a comment pointing at ch25, and let ch25
    *explain and change* it rather than introduce it. The book already leans on this device
    heavily (\`!!! iou\` boxes: "you do not understand this yet, and that is the plan").
(b) **Keep retention at ch25** and make ch20-ch24 tell the truth: the default is 15 days, the
    backfill will be trimmed, here is what that means for your numbers, chapter 25 fixes it.

Read chapter 20 and chapter 25 before choosing — in particular whether ch25's lab step is
"set retention" (route (a) steals its lesson) or "change retention" (route (a) is free). Whichever
you choose, the printed message must be true at every chapter, and ch25's own warning box must
not assume a state that does not exist yet.

Implement across: the \`compose.yaml\` versions in ${HIST}, the \`Makefile\` versions, and any
chapter text in ${MS} that states something now false. Keep chapter edits surgical.

Verify with the loop, and state in \`verified\` exactly which chapters you re-checked.`,
    { label: 'fix:retention', phase: 'Fix', schema: SCHEMA }),

  () => agent(
    `${GROUND}

**THE MINOR SWEEP.** Work these in order, skipping any you judge not worth the churn — say which
you skipped and why.

1. \`compose.scale.yaml\` at ch26/ch27 carries two Prometheus flags the primary lacks until
   ch28/ch29, contradicting its own comment that the two servers "differ in exactly one external
   label". Make the comment true, or make the flags match.
2. ch26 claims Prometheus B has existed "since you provisioned the first one". It enters at ch26.
   Fix the sentence in ${MS}/ch26-*.md.
3. \`make check\` runs \`tree-audit.sh\` only at ch29; it should run wherever the script exists.
4. \`snip/Dockerfile\`'s \`worker\` target exists from ch1, but \`main.go\` ignores \`SNIP_ROLE\`
   until ch8, so nothing can build that target before ch8. Either gate the target or note it.
5. \`.env.example\`: \`SNIP_OTEL\` is self-marked "# ch28:" — confirm that is genuinely fine
   (the \`SNIP_API_SCALE\` defect of the same shape was already fixed) and leave it if so.
6. \`SnipSLIAbsent\` is missing its \`runbook_url\` annotation, which LAB-SPEC §5.11 and chapter 19
   both make mandatory for every alert. Add it, in both the live rule file and the history.
7. LAB-SPEC §4 and §8 have not caught up with the enlarged \`.history\` file set. Append a short
   subsection to §8 (or a new §8.2) listing which files now carry reconstructed per-chapter
   versions, so the next person does not have to rediscover it. Add a row to the §14 amendment log.

Verify anything mechanical with the loop. Do not touch the four already-fixed blockers.`,
    { label: 'fix:minors', phase: 'Fix', schema: SCHEMA }),
])

return jobs.filter(Boolean).map((j) => ({ job: j.job, decision: j.decision, residual: j.residual }))
