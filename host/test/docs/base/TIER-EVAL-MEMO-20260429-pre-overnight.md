# Memo: pre-overnight research-team check — 2026-04-29

## Context

I'm running point on the Tier-Eval Suite v2 harness — the cross-tier
discrimination work scoped in
[`TIER-EVAL-V2-SPRINT-PLAN.md`](TIER-EVAL-V2-SPRINT-PLAN.md). The goal of
this iteration is to produce a `discrimination_matrix_v1.csv` that labels
each test as `core_discriminator_candidate`, `provisional_discriminator`,
`likely_ceiling`, `likely_floor`, `noisy_diagnostic`, `harness_contaminated`,
or `thermal_contaminated`, against three local hardware tiers (16/32/64 GB
M5 Max MBP, single-machine serial — three-machine parallel is not available
for the foreseeable future).

**Where we are in the plan:**

- **Sprint 0** — locked. Schema (`run_registry.schema.json`,
  `model_config.schema.json`, `test_manifest.schema.json`), test-manifest
  headers on all 35 tier-eval tests, historical bucketing, EVAL-DESIGN
  decision-rule addendum, thermal telemetry hook, hidden-holdout policy
  memo, productivity-grader design memo.
- **Sprint 1** — building blocks landed. `lib/run_row.js` assembles a
  schema-validated registry row by joining the claw sidecar to the test
  manifest header. `lib/claw.js`'s `writeAssertionResult` auto-emits a
  row when `RUN_REGISTRY_EMIT=1`. `scripts/run-overnight-screen.sh`
  wraps the existing per-tier plist-swap pattern with an `EVAL_REPS`
  outer loop. CSV exporter and offline harvester are done. Two real-claw
  confirmatories ran clean:
  - **1.9** (multi-tier, `EVAL_REPS=1`, 16/32/64): 32 rows, 80 min
    wallclock, plist swaps clean (tier-32 cold-load 4s, tier-64 6s),
    auto-emit fired correctly on every runClaw-using test that called
    `writeAssertionResult`.
  - **1.10** (tier-64, `EVAL_REPS=1`, post-coverage-fix): 31 rows after
    closing the gap where 23/35 tests didn't call `writeAssertionResult`.
    Every row `passed=true`, manifest joins clean (`v1` +
    `public_verifier` on every row).
- **Sprint 2** (not started) — discrimination matrix v1, Wilson CIs per
  cell, label rules, confirmatory-night plan. Gated on the overnight's
  output.
- **Sprint 3** (not started, ~1.5–2 weeks) — productivity grader +
  calibration set.
- **Sprint 4** (not started) — hidden holdouts + model-trial protocol
  skeleton.

**The decision in front of us:** kick off the actual overnight —
`EVAL_REPS=10 EVAL_TIERS="16 32 64"`, ~10 hours wallclock, ~105 rows. This
is the data Sprint 2 will analyze for ~3–5 days. Before committing the
compute, three calls would benefit from research-team sign-off. Each is
cheap to address now and expensive to retroactively re-interpret in the
Sprint 2 matrix.

## TL;DR — three asks

| # | Decision | Default if no response | Cost of getting it wrong |
|---|---|---|---|
| 1 | Throughput-drift threshold | Ship as-is, treat drift-only flags as advisory | ~16% of tier-64 rows mis-labeled `thermal_contaminated`, biases Wilson CIs in Sprint 2 |
| 2 | Timeout handling | Missing row = "this tier can't do this task" signal | Wilson CIs computed against observed N, not planned N; biased toward higher pass-rate at lower tiers |
| 3 | Provisional discriminators (preview) | Run overnight on the 35-test list as planned | None — informational; flag chance to revise list before 10h compute spend |

---

## 1. Throughput-drift threshold

`lib/telemetry.js` flags a row `contaminated` when iter-by-iter throughput
drift crosses an internal `drop_pct`. In the 1.10 smoke (tier-64,
`thermal_warning=null` from pmset on every row), 5/31 rows flagged
`contaminated` from drift alone:

| test_id | thermal_status | observation |
|---|---|---|
| csv-parser | contaminated | drift-only |
| deep-equal | contaminated | drift-only |
| expression-eval | contaminated | drift-only |
| multi-bug-decoy | contaminated | drift-only |
| subtle-broken-spec | contaminated | drift-only |

Tier-16 in 1.9 hit 4/9, tier-32 hit 1/12. The pattern is consistent with
warmup-phase decode — the first few iterations of a fresh run are slower
than the subsequent ones, and the current `drop_pct` reads that as a
contamination signal.

**Three options:**

- (a) **Tighten `drop_pct`** so warmup doesn't trip it. Requires fitting
  the threshold against observed warmup curves — ~1 hour of analysis
  against the 1.9 + 1.10 iteration records.
- (b) **Demote drift-only flags to advisory** — keep the column, exclude
  it from the `thermal_contaminated` row-level label. `thermal_status`
  becomes `clean`/`warning`/`pmset_contaminated`/`drift_advisory`.
- (c) **Ship as-is** — accept ~16% tier-64 contamination, ~44% tier-16,
  and let Sprint 2 decide whether to exclude or re-include those rows.

**Engineering recommendation:** (b). It preserves the signal as a column
without letting it degrade the per-row label that Sprint 2 will use for
inclusion decisions. (a) is correct but adds a tuning loop that delays
the overnight; (c) creates analysis debt.

**Question for research team:** which?

## 2. Timeout-as-row methodology

`runClaw` currently throws when the 240s claw timeout fires.
`writeAssertionResult` is the auto-emit hook, so a thrown timeout never
emits a row — the registry has no record that the test was attempted.

Sprint 1.10 lost one row this way: `mini-vm` on tier-64 timed out at 240s.
Lower tiers will lose more (the test is hard; tier-16 may time out 100%
of the time on the harder convergence tests).

**Two readings:**

- **"Missing row IS the signal."** A test that can't complete in any
  reasonable budget is observably failing — the OVERNIGHT-SCREEN markdown
  log captures the timeout, and Sprint 2 can compute a `harness_error_rate`
  column from `expected_reps - observed_rows`. No code change.
- **"Every cell needs N=10 observations."** Wilson CIs are sensitive to
  N. A tier-16 cell with 0 observed rows out of 10 attempted reps reads
  as "no data" rather than "unanimous fail," and the matrix label engine
  has nothing to chew on. Fix: wrap `runClaw` in a try/finally that
  emits a row with `passed=false`, `terminal_status='timeout'`,
  `claw_exit=null` regardless of how runClaw exits. Schema needs minor
  loosening (a few currently-required fields would be null on timeout).

**Engineering recommendation:** the second reading. The schema change is
small, makes Sprint 2's matrix arithmetic uniform, and means a 0/10 cell
reads as "tier can't do this task" not "harness lost the data." The
overnight will produce N≈10 cells per (test × tier × seed), and any cell
that drops below 7-8 observed rows starts to skew Wilson CIs.

**Question for research team:** if you agree, this is ~2 hours of work
before the overnight (extend schema, add try/finally, smoke-test against
a deliberately-too-short timeout). If you disagree, no action needed.

## 3. Sprint 1.9 preliminary discriminators (informational)

At `EVAL_REPS=1` (so n=1 per cell — screening only, no admission decisions
allowed per §4 of the plan), six tests showed perfect FAIL→FAIL→PASS
across tiers 16→32→64:

- `csv-parser`
- `deep-equal`
- `eight-functions`
- `large-refactor`
- `lru-cache`
- `tool-confusion-redundant-verifies`

One ceiling test (`agent-single`, PASS at all 3 tiers). One non-monotonic
row to investigate: `adversarial-input` PASS→FAIL→PASS.

**Not a decision request** — the n=1 evidence is too thin for keep/drop
calls. Flagging because:

(a) These will be the first cells the Sprint 2 matrix marks as
`provisional_discriminator`, and the team should know the candidate list
before the overnight produces n=10 evidence on them.

(b) If any of these tests look mis-targeted at the discrimination axis
they're tagged with (`@manifest.primary_axis`), revising the test
**before** the overnight saves 10 reps × 3 tiers = 30 wasted cells.

(c) The non-monotonic `adversarial-input` row could be noise (n=1) or a
genuine "tier-32 worse than tier-16" inversion. The overnight's n=10
will resolve it. No action requested pre-overnight.

## What I need from you

- A yes/no on (1) and (2) above — preferably (1) with a specific answer
  because the threshold work would happen before the overnight kicks off.
- Optional skim of (3) — flag any of the six tests you'd want to revise
  before committing 10h of compute.

Operational items (not research-team scope, listed for completeness):

- ~~Need `host/test/scripts/thermal-watch.sh` running in a separate terminal
  during the sweep~~ — thermal layer cut 2026-05-04 (CODE-REVIEW §1.5.2);
  no longer required. Memo concern (1) is moot post-cut.
- Need ~10h on the M5 Max MBP with no competing heavy compute. Cleanup
  trap restores tier-64 plist on exit.
- The kickoff command is one line:
  `EVAL_REPS=10 EVAL_TIERS="16 32 64" host/test/scripts/run-overnight-screen.sh`.

Happy to walk through any of this on a 30-min sync. The two methodology
calls are the load-bearing ones; (3) can wait until after the overnight.
