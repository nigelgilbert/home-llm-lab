# Writing good evals — a brief field guide

Notes for the lab. We've felt every one of these the hard way:

- An "always-pass" eval (every model 5/5) gives no signal — kill it.
- An "always-fail" eval (timeouts on the strongest model too) is measuring the harness, not the model — fix it before trusting it.
- An n=1 verdict is a coin flip on agentic tasks. Run more, or don't conclude.

Distilled from SWE-bench Verified, METR's task-design memos, BigCodeBench, LiveCodeBench, Aider's leaderboard methodology, EvalPlus, Inspect AI, and the eval cookbooks at OpenAI/Anthropic.

## Eight rules

**1. Verify the eval before you trust the model.** SWE-bench's 2024 audit found ~30% of original tasks were under-specified or had broken tests; *Verified* is the human-screened survivor set. Hand-solve every test from prompt + seed *yourself* in <10 minutes before checking it in. If you have to guess intent, the prompt is broken. → see [SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/).

**2. Run n≥5; report pass-rate and Wilson interval, not pass@1.** METR's RE-Bench and Inspect AI both bake repeated trials in. Anything in the [0.2, 0.8] band at n=5 needs more n before you call a winner. Single-shot verdicts on agentic tasks are noise. → see [METR R&D capabilities](https://metr.org/blog/2024-11-22-evaluating-r-d-capabilities-of-llms/).

**3. Aim for the discriminative middle: strong ~60–90%, weak <30%.** LiveCodeBench and BigCodeBench retired toy snippets in 2024 because HumanEval saturated at ~99%. If your strongest model passes 5/5 *and* the smallest also passes ≥3/5, the test isn't separating anything. → see [BigCodeBench](https://bigcode-bench.github.io/), [LiveCodeBench](https://livecodebench.github.io/).

**4. Separate agent-noise from capability-noise.** A 240s timeout on the strongest model isn't "model can't code" — it's claw retry-storming. Aider's leaderboard reports edit-format failures separately from logic failures for exactly this reason. Log token counts, tool-call counts, and timeout reason; if the strongest model times out >25% of runs, the test is measuring the harness. → see [Aider polyglot leaderboard](https://aider.chat/docs/leaderboards/).

**5. Pick one sampling regime per suite.** Temperature-0 for capability (low variance, masks brittleness); realistic temperature for robustness (exposes prompt sensitivity). Don't mix in the same suite — you'll average across two distributions and learn nothing. → see [OpenAI evals cookbook](https://cookbook.openai.com/examples/evaluation/getting_started_with_openai_evals).

**6. Calibrate difficulty with explicit knobs.** SWE-bench Verified tags tasks by estimated human time. Useful local knobs: *files to read before writing*, *plausible-but-wrong distractor code in the seed*, *edge cases not mentioned in the prompt*, *requires deleting* (consistently harder than adding). Tier tests by `files × hidden-edges`; 1×0 is hello-world, 3×2 is your sweet spot for the 7B–30B band.

**7. Assert on behavior, never on text.** EvalPlus showed thin test suites let wrong-for-the-right-reason solutions through. For agents, watch the dual: right-for-the-wrong-reason — model patches the wrong file but the harness imports the wrong file too and passes anyway. Always `import` the prompt-specified path; assert with adversarial inputs the prompt didn't mention; never `grep` for keywords. → see [EvalPlus](https://evalplus.github.io/).

**8. Don't leak the answer.** Inspect AI and METR both call out: filenames, comments, and assertion messages leak intent. If a seed is named `buggy_parser.js` with `// FIXME: off-by-one`, you're testing reading comprehension. Strip `TODO` / `FIXME` from seeds. Use neutral filenames. Keep assertion messages generic (`"output mismatch"`, not `"expected sorted ascending"`).

## Red flags

- Pass-rate is 0/5 or 5/5 on *every* tier → no signal, retire or harden.
- Strongest model times out >25% of runs → measuring the harness.
- Pass-rate swings >40 points between consecutive n=5 batches → flaky, not discriminative.
- A human can't solve it from the prompt + seed alone in 10 min → under-specified.
- Test passes when the model writes the fix to the wrong file → assertion too loose.
- Seed contains `TODO` / `FIXME` / hint-y comments → answer leaks.
- Assertion message contains the expected value → answer leaks.
- Post-condition depends on wall-clock, unseeded RNG, or network → non-deterministic.
- Same seed + temp=0 gives different verdicts → agent-loop nondeterminism, isolate first.
- Difficulty was set by "feels about right" not by `files × hidden-edges` → calibrate.

## How to add a test in this repo

1. Drop a new `__tests__/tier-eval/<name>.test.js` mirroring `refactor.test.js`'s shape.
2. Hand-solve it from the prompt before committing (rule #1).
3. Run it ≥3 times against each tier
4. Rebuild the test image: `(cd host/test && docker compose build)`.
5. Add it to the `tier-eval` suite list in `run-tier-eval.sh` header comment for posterity.
6. If pass-rate is the same on every tier, retire it.

---

## Tier-Eval v2 addendum: statistical decision rules (Sprint 0.6)

This section supersedes the "kill / retire" framing above for tier-eval v2
work. The eight rules and red flags still apply for authoring new tests; this
addendum governs **classification** (keep, drop, defer) once a test has been
running across tiers/models/configs.

The motivating problem: at n=10 or n=20, a 30 percentage-point gap between
two cells can easily be sampling noise. Treating raw point spread as the
keep/drop rule retires useful tests during noisy weeks and promotes false
discriminators during lucky ones. This addendum replaces that with a
two-stage screen-then-confirm protocol with explicit uncertainty.

### 1. Two-stage protocol

| Stage | Sample size | Allowed conclusion |
|---|---:|---|
| Overnight constrained screen | n=8–10 per cell, one sampler | Identify candidate discriminators and obvious contamination. **Not valid for durable keep/drop, model admission, or sampler conclusions.** |
| Broad census | n≈10 per cell | Screen for obvious ceiling/floor/spread; **do not drop tests solely from this**. |
| Provisional classification | n≈20–30 per cell | Mark candidate core, noisy, ceiling, or floor with visible uncertainty. |
| Confirmatory classification | Power-derived (often n≈40–60 for 25 pp effects, more for smaller effects or noisier baselines) | Make durable keep/drop / admission decisions. |

Screening-only outputs must carry a `screening_only=true` flag on every
registry row (run_registry.schema.json). No leadership-facing artifact may
quote screening-only numbers.

### 2. Default core-discriminator rule

```
A test is a confirmed core discriminator if ALL of:
  1. observed max(pass_rate) − min(pass_rate) >= 25 percentage points
     across the cells under comparison, AND
  2. the highest and lowest cells' 80% Wilson confidence intervals do not
     overlap, OR an agreed Bayesian/bootstrap rule gives high probability
     (>= 0.8) that the true spread exceeds 25 pp, AND
  3. harness-error rate < 5% and thermal_contamination_rate < 5%, AND
  4. failures are interpretable or the test is axis-critical
     (test_manifest.keep_drop_rule = "Never drop").
```

Rationale:

- The 25 pp floor keeps the test practically meaningful; smaller spreads
  can be real but are not worth the suite's wall-clock budget unless
  axis-critical.
- The 80% Wilson interval is intentionally less conservative than 95%.
  Screening-tier decisions tolerate more false positives than admission
  gates; a 95% rule effectively never retires anything at n=20.
- Tests that fail the interval test but have a 25 pp point spread should
  be labeled `provisional_discriminator`, not dropped. They earn a
  confirmatory rerun.
- Layer-A (smoke) and `keep_drop_rule = "Never drop"` tests are exempt —
  the rule only governs Layer-B core-matrix membership.

### 3. Power-derived N for high-stakes comparisons

For model admission, major config changes, or external claims, do not rely
on a fixed n=20 plan. Compute sample size from:

- Target minimum effect size (typical: 20, 25, or 30 percentage points).
- Expected baseline pass rate (sample-size requirements grow as p moves
  toward 0.5).
- Paired vs. unpaired design (paired sampler comparisons require shared
  task seeds — see strategy doc §14.2).
- Desired alpha (false-positive tolerance) and power.
- Number of comparisons being made (Bonferroni or BH correction if many).

Working rules of thumb:

- n=20 is useful for finding large effects, not for retiring subtle
  sampler/config questions.
- n≈40 can be adequate for large, clean effects, especially with paired
  designs — but **n=40 is not a universal power guarantee**; it depends on
  baseline rates and pairedness.
- n≈40–60 or more may be needed for 25–30 pp effects depending on the
  baseline.
- For sampler/prompt/harness tuning, use paired seeds where possible;
  otherwise treat the comparison as unpaired and budget more N.

### 4. Test classification labels (Sprint 2 discrimination matrix)

| Label | Definition | Action |
|---|---|---|
| `core_discriminator` | Meets §2 confirmed-discriminator rule under confirmatory N. | Keep in Layer B. |
| `provisional_discriminator` | Large point spread but insufficient N or overlapping intervals. | Rerun confirmatory sample; do not drop. |
| `likely_ceiling` | Pass rate ≥ 0.95 across all tiers/configs in screening; confirmation pending. | Provisional only — do not move to Layer A or smoke until confirmed. |
| `likely_floor` | Pass rate ≤ 0.05 across all tiers/configs in screening; confirmation pending. | Provisional only — do not move to Layer D until confirmed. |
| `noisy_diagnostic` | Useful traces but unstable pass rate even at confirmatory N. | Keep for R&D; exclude from leaderboard/admission summaries. |
| `harness_contaminated` | Infrastructure/tooling failures dominate. | Quarantine until the harness issue is fixed; do not aggregate. |
| ~~`thermal_contaminated`~~ | _Removed 2026-05-04 per CODE-REVIEW §1.5.2 — 0/650 contamination signal across n=8 sweep; lab runs under external fan, hardware-managed headroom. No longer a label._ | — |

The screen-stage labels are `*_candidate` versions of the same set
(`core_discriminator_candidate`, `likely_ceiling`, etc.) and never become
durable on their own.

### 5. Reporting requirements

Report effect sizes, never p-values alone:

| Outcome | Report |
|---|---|
| Pass/fail | Pass rate plus Wilson/bootstrap/Bayesian interval. |
| Tier spread | Point spread plus interval/probability qualification. |
| Config deltas | Paired deltas with bootstrap CI where possible. |
| Iterations / cost | Median, p75, p90, and outlier inspection. |
| Trace behavior | Tag rates and representative trace links. |
| Local usability | Pass-per-minute, p90 wallclock, throughput, context-pressure distribution, thermal status. |

A single aggregate score (e.g. "tier-32 = 72%") is **forbidden** in any
external or leadership-facing artifact for this iteration. Capability-axis
scorecards stand on their own; the pull toward a single number is strong
and misleading.

### 6. Relationship to the eight rules above

The eight rules govern **test design** (so a test can be informative at
all). This addendum governs **interpretation of results** once tests have
been running. Both apply: a test that violates rule #4 (measures the
harness, not the model) cannot be rescued by §2's interval rule, and a
test with a beautifully calibrated edge surface still needs §2 evidence
before earning core-matrix permanence.

