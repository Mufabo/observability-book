export const meta = {
  name: 'obs-fix-verify-scripts',
  description: 'Close the four verify-script defects recorded as V1-V4 in lab/VERIFY-STATUS.md',
  phases: [{ title: 'Fix', detail: 'one agent per defect, each proving its fix against a live stack' }],
}

const ROOT = 'C:/Users/fatih/Desktop/Co-Authored with Claude/observability-book'
const LAB = ROOT + '/lab'
const MS = ROOT + '/manuscript'
const SCRATCH = 'C:/Users/fatih/AppData/Local/Temp/claude/C--Users-fatih-Desktop-Co-Authored-with-Claude/ff0d43dd-98b0-46ae-ad93-8bb48428a4dd/scratchpad'
const TODAY = '2026-09-19'

const GROUND = `
You are fixing a defect in the obslab teaching lab at ${LAB}. Today is ${TODAY}.

Every chapter promises the reader that \`make verify-chNN\` prints \`chNN OK\`. Where that is not
true, the promise is broken. ${LAB}/VERIFY-STATUS.md records four such defects, V1-V4, and yours
is named below.

AUTHORITIES
- ${LAB}/VERIFY-STATUS.md — the defect register. ${LAB}/MEASURED.md — figures measured from a
  running stack; outranks everything for any number.
- ${LAB}/scripts/lib.sh — the assertion helpers every verify script uses (\`promq\`, \`assert_eq\`,
  \`assert_gt\`, \`assert_absent\`, \`assert_between\`, \`wait_for\`). Reuse them; do not hand-roll.
- ${MS}/ch<NN>-*.md — the chapter the script belongs to. If the chapter prints the script's
  output, your fix must keep that transcript true.
- ${LAB}/LAB-SPEC.md §9.4 is the verify-script contract: \`PASS <assertion>\` /
  \`FAIL <assertion> — got X, want Y\`, ending \`chNN OK\` or \`chNN FAILED\`.

RUNNING A CHAPTER'S STACK. Any chapter's tree is materialised at ${SCRATCH}/trees/ch<NN>/.
To start one (only one stack can run at a time — they share ports and the project name \`obslab\`):

    cd ${SCRATCH}/trees/ch<NN> && docker compose up -d --build

Run a verify script against it from a container on the same network:

    MSYS_NO_PATHCONV=1 docker run --rm --network obsnet \\
      -v "${SCRATCH}/trees/ch<NN>:/lab" -w /lab \\
      -e PROM_URL=http://prometheus:9090 -e LOADGEN_URL=http://loadgen:8089 \\
      -e AM_URL=http://alertmanager:9093 -e PAGER_URL=http://pager:5001 \\
      -e GRAFANA_URL=http://grafana:3000 -e SNIP_BASE_URL=http://edge:8080 \\
      alpine:3 sh -c 'apk add --no-cache curl jq >/dev/null 2>&1; sh scripts/verify-ch<NN>.sh'

**Tear your stack down when you are done** (\`docker compose down -v --remove-orphans\`) so the
next agent can start theirs. If a stack is already running that is not yours, say so and work
statically rather than killing someone else's.

RULES
- Fix the script, not the assertion's meaning. These checks exist to prove the chapter's lesson
  happened; a check weakened until it always passes is worse than a failing one.
- Keep POSIX \`sh\`. Keep LF line endings — CRLF breaks these scripts on every platform.
- **Do not edit any manuscript file unless your brief says to.** Another pass is verifying
  chapters concurrently and will clobber you.
- Prove it. Paste what you ran and what it printed.
`

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['defect', 'resolution', 'files_changed', 'proof', 'residual'],
  properties: {
    defect: { type: 'string' },
    resolution: { type: 'string' },
    files_changed: { type: 'array', items: { type: 'string' } },
    proof: { type: 'array', items: { type: 'string' },
      description: 'commands run and their actual output' },
    residual: { type: 'array', items: { type: 'string' } },
  },
}

phase('Fix')

const JOBS = [
  {
    key: 'v1-ch14',
    ask: `**V1 — \`scripts/verify-ch14.sh\` admits its own bug in its output.**

It prints, literally: *"this one is the checker's fault, not yours"*. Check 5 — the stale-value
Stat panel — trips on the honest reference dashboard as well as on the broken one, so it cannot
tell them apart. Until it can, chapter 14 cannot claim a clean verify.

Chapter 14 is "Dashboards That Tell the Truth" and audits five planted lies in
\`dashboards/snip-red-BROKEN.json\` against the honest \`dashboards/snip-red.json\`.

YOUR JOB: make check 5 discriminate. Read both dashboards, find what actually differs for the
stale-value lie, and assert on that difference. Then run the script against **both** dashboards
and show that it passes on the honest one and fails on the broken one — that is the only proof
that matters. Remove the apology line once it is true.

Read chapter 14 first: whatever the five lies are there, the script must check those five.`,
  },
  {
    key: 'v2-ch22',
    ask: `**V2 — \`scripts/verify-ch22.sh\` asserts a metric family that does not exist.**

It asserts \`pg_stat_checkpointer_*\` exists. It does not. Measured and recorded in
\`MEASURED.md\` §9: \`postgres_exporter\` v0.20.1 against PostgreSQL 18 ships
\`pg_stat_bgwriter_{buffers_alloc,buffers_clean,maxwritten_clean,stats_reset}_total\` and **no
checkpointer family at all** — PostgreSQL 17 moved the checkpoint counters out of
\`pg_stat_bgwriter\` and the exporter has not picked them up under the new name.

YOUR JOB is the script only: assert on a family that genuinely exists, chosen so the check still
proves what chapter 22 is teaching. Verify against a running ch22 stack by listing what the
exporter actually emits.

**Do not edit chapter 22** — a concurrent pass is verifying it and has been told to turn this
finding into that chapter's worked example (the metric the documentation implies is not the
metric the exporter in front of you ships). Your job is to stop the script lying; theirs is to
teach the lesson. In \`residual\`, state exactly what you changed so their text can match it.`,
  },
  {
    key: 'v3-ch10',
    ask: `**V3 — \`scripts/verify-ch10.sh\` needs a manual retry, which means it is not a verify target.**

It asserts p99 pins at exactly \`10\` under the 12-second tail injection. Measured \`2.27\`. The
script's own hint says *"give it another minute and re-run: the 2 m rate window"*. The scenario is
right; the script does not wait for the rate window to fill before asserting.

YOUR JOB: make it wait rather than tell the reader to try again. \`lib.sh\` already has
\`wait_for\` — use it. Give it a bounded timeout and a useful message on expiry; never hang
forever. Chapter 10 is already verified and repaired, so keep its printed self-check transcript
true — if your change alters what the script prints, say so in \`residual\` rather than editing
the chapter yourself.

Prove it end to end: start a ch10 stack, run the tail scenario, and show the script reaching
\`ch10 OK\` unattended.`,
  },
  {
    key: 'v4-ch24',
    ask: `**V4 — \`scripts/verify-ch24.sh\` asserts a 20x head-series rise; measured 1.4x.**

Same class as V3: the cardinality scenario needs longer than the script allows. Its own hint
suggests \`LOAD_MAX=600\`.

YOUR JOB: decide honestly between driving the scenario to completion inside the script, and
lowering the assertion to what the default run actually produces. Chapter 24 is
"Cardinality: Detonate, Diagnose, Defuse" — the check has to prove the bomb went off, so a
threshold lowered until it always passes defeats the chapter.

Measure first: start a ch24 stack, run the cardinality scenario as the chapter tells the reader
to, and record what the head-series count actually does over time. Set the assertion from that
measurement, and make the script wait for it. \`MEASURED.md\` §2 notes \`catalog\` alone is
already 3,302 series and growing, which is part of the baseline you are measuring against.`,
  },
]

const out = await parallel(JOBS.map((j) => () =>
  agent(`${GROUND}\n\n${j.ask}`, { label: `fix:${j.key}`, phase: 'Fix', schema: SCHEMA })
))

const done = out.filter(Boolean)
log(`Verify-script defects worked: ${done.length}/${JOBS.length}`)
return done.map((d) => ({ defect: d.defect, resolution: d.resolution, residual: d.residual }))
