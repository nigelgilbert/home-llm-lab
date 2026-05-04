# Tier-Eval Suite Improvement Plan

**Date:** 2026-04-29  
**Revision:** Revised after study-owner / PhD-student technical review; constraint pass for one-MBP overnight sweeps  
**Status:** Strategic guidance, accepted. Operational execution plan lives in `TIER-EVAL-V2-SPRINT-PLAN.md` — that doc is the source of truth for what this iteration will actually build. This doc is the longer-horizon strategic frame.  
**Audience:** R&D leadership, evaluation owners, harness engineers, model/config engineers  
**Scope:** Strategic guidance for improving the tier-eval suite for 16 GB, 32 GB, and 64 GB Apple SoC targets  
**Non-scope:** No implementation code, no immediate model-selection decision. Iteration-level sequencing, locked schema decisions, and sprint deliverables are in the sprint-plan doc, not here.

---

## Executive summary

The strategic direction is unchanged: the suite should stop behaving like a one-model W4 failure-mode audit and become a cross-tier, cross-model diagnostic instrument for local Apple SoC systems.

The current tier-64 results should be treated as a **ceiling observation**, not as proof that the existing tests are bad. A test that passes at 100% on tier-64 may still be valuable if it separates tier-32 from tier-16, or if it acts as a regression check for smaller models/configs.

However, the reviewer identified several valid foundation risks that need to be addressed before engineering starts running production lower-tier sweeps. The most important changes to this plan are:

1. **The discrimination matrix must be uncertainty-aware.** Do not classify tests using raw point spread alone. A `30 percentage point` spread is useful as a screening heuristic, not as a final keep/drop rule.
2. **"Tier" must be decomposed.** Product-facing tier labels are useful, but R&D analysis must explicitly track hardware, model, quantization, context limit, sampler, and harness version.
3. **Phase 0 is a real engineering deliverable.** The canonical run registry, telemetry reconciliation, historical-data policy, and manifest schema are a first sprint, not a checklist item.
4. **Thermal behavior must be controlled or measured.** Lower-tier Mac mini sweeps should not silently mix model latency with thermal-throttling artifacts.
5. **Productivity grading needs its own methodology.** The task ideas are good, but the grader architecture, judge calibration, and human validation loop must be designed before those tests become part of the matrix.
6. **Hidden holdouts need to be operationalized.** Public tests are useful for development and tuning; model admission needs protected holdout variants.

The primary artifact should become:

```text
[test x hardware_tier x model_config x context_limit x sampler/harness] ->
  pass rate with uncertainty,
  cost and thermal telemetry,
  behavioral trace signature,
  capability-axis score,
  public-vs-holdout status
```

The largest coverage gap remains productivity. Coding is well covered. Agentive behavior is lightly covered. Productivity is essentially unmeasured. But productivity tests should not be rushed into the suite with brittle string-match scoring or uncalibrated LLM-as-judge scoring.

Recommended next action:

1. Run **Phase 0** as a foundation sprint: registry, run manifests, historical-data policy, statistical decision rule, hidden-holdout policy, thermal telemetry policy, and productivity-grading design.
2. Then run a **single-MBP overnight screen** rather than the full provisional matrix: one sampler, n=8-10, no new productivity/agentive families in the same run, reuse canonical-compatible tier-64 data when possible, and prioritize tier-16/tier-32 signal.
3. Build the first discrimination matrix and classify tests only as **screening candidates**: provisional discriminator, likely ceiling, likely floor, noisy, or contaminated. Do not make durable keep/drop or model-admission decisions from this overnight run.
4. Promote only high-value candidates into later n=20-40 confirmatory runs.
5. Add productivity and richer agentive tests once grading and holdout policies are in place, preferably as separate pilots rather than as part of the first overnight census.
6. Use capability-axis scorecards and behavioral trace signatures as the primary R&D output. Avoid a single aggregate score, especially in external or leadership-facing communication.

### Constraint-pass note: one M5 Max MBP

The plan below now includes an explicit **single-machine overnight mode**. Its goal is to get the first useful cross-tier signal on the available 1x M5 Max MBP without pretending that the result is admission-grade. The mode trades statistical confidence for coverage and speed: broad n=8-10 screening first, then targeted confirmatory reruns later.

Target wall clock for the first constrained run: **overnight**, roughly **6.5-12 hours** depending on whether tier-64 can be reused from canonical-compatible historical data or must be rerun as a small anchor panel.

---

## 0. Review disposition

The study-owner review did not require a redesign. It did identify foundation decisions that the original draft underweighted. My disposition is below.

| Review issue | Assessment | Change made in this revision |
|---|---|---|
| Raw `30 pp spread` rule is statistically loose | Accepted. Point estimates at n=10 or n=20 are too noisy for final test classification. | Replaced with a two-stage screen/confirm rule using confidence intervals or power-derived sample sizes. |
| Tier conflates hardware, model, quantization, and context | Accepted with nuance. Tier remains a valid product-facing label, but not a sufficient causal variable. | Added product-facing and R&D/ablation matrix views; made model/config/context fields mandatory. |
| Phase 0 is larger than a checklist | Accepted. This is a migration and instrumentation deliverable. | Recast Phase 0 as the first sprint, with sign-off criteria before production lower-tier sweeps. |
| Thermal throttling is unaddressed | Accepted for latency and cost metrics; possible output effects are configuration-dependent. | Added thermal telemetry/control requirements and thermal-contamination flags. |
| Productivity grading is underspecified | Accepted. This is the biggest risk to productivity credibility. | Added grader design, pinned judge, human calibration set, and budget line. |
| Hidden holdouts are not operationalized | Accepted. This matters for model admission and long-term benchmark integrity. | Added public/dev vs hidden/admission split and rotation/access policy. |
| Sampler/prompt/harness are not orthogonal | Accepted. Sequential tuning can hit local optima. | Added small DOE-style config experiments after the baseline matrix. |
| Paired sampler comparison needs shared seeds | Accepted. | Added seed-sharing requirement; otherwise compare as unpaired and increase N. |
| Trace tags are under-validated | Accepted. | Added trace-tag calibration against prior failed-tail data before canonical use. |
| Single aggregate score warning should include external communication | Accepted. | Strengthened the prohibition on single-score reporting. |
| Timeline/staffing estimate missing | Accepted as a planning note, not as a delivery commitment. | Added rough planning envelope for leadership discussion. |

One reviewer detail I would not hard-code as written: **n ≈ 40 is not always enough for a 25 percentage point effect at alpha=0.05 and 80% power.** The required N depends on the baseline pass rate, pairedness, and the chosen confidence criterion. Treat n=40 as a reasonable confirmatory starting point for large effects, not as a universal power guarantee.

---

## 1. Strategic goal

The project is not trying to characterize one model's failure modes in isolation. The project is trying to bring a Claude-like agentic harness and genuinely useful local models to consumer-grade Apple SoC systems at three memory targets:

- 16 GB
- 32 GB
- 64 GB

The evaluation suite should support four strategic functions:

1. **Stratify the three systems** on productivity, agentive, and coding tasks.
2. **Compare models side-by-side** to tune samplers, prompts, quantization choices, and harness behavior.
3. **Trial new models** and slot them into the same evaluation grid.
4. **Drive R&D** by identifying what fails first as hardware, memory, context, model, quantization, and harness constraints change.

The core question should become:

> On 16/32/64 GB Apple SoC targets, what can this model reliably do, at what latency and cost, under which harness settings, and what fails first when we scale down?

---

## 2. Current diagnosis

### 2.1 Tier-64 has produced a ceiling observation

The current tier-64 sweep should not be read as evidence that most tests are bad. It should be read as evidence that the current tier-64 configuration is strong enough to pass many of them.

Initial interpretation:

| Test or family | Current tier-64 observation | Strategic interpretation |
|---|---:|---|
| `expression-eval` | Meaningful failure rate | Already discriminative at tier-64; keep as a core diagnostic/stress test. |
| `csv-parser` | Ceiling at tier-64 | Do not drop until tier-32 and tier-16 are measured. |
| `lru-cache` | Ceiling at tier-64 | Do not drop until tier-32 and tier-16 are measured. |
| `agent-single` | Ceiling at tier-64 in retrofit-aware runs | Critical to test at lower tiers because tool latency and TTFT effects may be tier-sensitive. |
| `large-refactor`, `api-evolution` | Ceiling at tier-64 in small-n pilots | Likely useful for lower-tier multi-file/context discrimination. |
| `parseISO`, `eight-functions`, `tool-confusion`, `subtle-broken-spec` | Too easy at tier-64 | Discrimination unknown until lower-tier sweeps are run. |

A test should be dropped from the main stratification suite only after observing that it fails to discriminate across tiers, models, and configs. Tier-64-only pass rate is not sufficient evidence.

### 2.2 Productivity is the largest coverage gap

The current suite is weighted toward coding tasks. That is useful, but it is not enough for the lab's product and R&D goals.

Approximate current coverage:

| Dimension | Current coverage | Gap |
|---|---|---|
| Coding | Strong: parsers, refactors, bug fixes, edge cases, multi-file tasks | Needs better axis tagging and difficulty knobs, but not the largest gap. |
| Agentive | Light: tool-use and harness-shape probes | Needs multi-step, recovery-oriented, artifact-producing tasks. |
| Productivity | Essentially absent | Highest-priority new test category. |

A local model that is useful to users must summarize, rewrite, extract, organize, and reason over documents. Those abilities are currently not measured in a serious way.

### 2.3 The W4 taxonomy is useful, but no longer primary

The W4 A/B/C/D/E/F taxonomy was designed for one-model failure characterization. It is not the right top-level frame for a cross-tier stratification suite.

The taxonomy should be retained as a secondary diagnostic layer, but top-level reporting should move to:

1. Capability axes.
2. Cross-tier discrimination signatures.
3. Behavioral trace signatures.
4. Cost, thermal, and local-usability metrics.

In practice, instead of asking:

> Which W4 class did this failed run belong to?

The suite should first ask:

> Which capability axis degraded, on which hardware tier, under which model/config, and with what behavioral signature?

### 2.4 Context pressure appears to be a gradient, not a binary class

The tier-64 expression-eval failures show elevated context pressure, iteration count, edit activity, and output-token burden relative to productive runs. That matters for R&D.

However, the observed signal is better treated as continuous telemetry than as a hard class boundary. A trace can be primarily a convergence failure while also being made worse by context pressure.

Recommended treatment:

- Track input-token/context ratio as a continuous metric.
- Report p50, p75, p90, and max by test/tier/model/config.
- Flag high-context traces for inspection.
- Do not overfit a single threshold such as 70% or 80% as a categorical classifier.

### 2.5 Data hygiene is a blocking foundation item

Before engineering builds durable reporting or starts production lower-tier sweeps, the team should reconcile production, pilot, and archived sweep data into one canonical run registry.

Known issue to resolve:

- The handoff describes production plus pilot data, while the bundled run table appears to represent only the 120-run production sweep.
- This is not a blocker for strategic planning, but it is a blocker for reliable dashboarding and model comparisons.

The updated recommendation is stricter than the original draft: **Phase 0 must be signed off before the first production lower-tier census.** Dry runs can happen during Phase 0, but they should be labeled as non-canonical unless the new schema is already active.

---

## 3. Proposed evaluation architecture

Use four suite layers. Each layer has a different purpose and should be reported separately.

### Layer A: Smoke and harness health

Purpose: detect infrastructure and harness problems, not model capability.

Examples:

- Basic tool-call sanity checks.
- Edit/write/read loop checks.
- Terminal execution checks.
- Assertion-result emission checks.
- Timeout and telemetry integrity checks.
- Thermal/telemetry sanity checks on each hardware target.

Reporting rule:

- Do not mix harness-health failures into model pass-rate comparisons.
- Report harness-health failures as separate infrastructure metrics.
- A model/config cannot enter the core grid until smoke and telemetry gates pass.

### Layer B: Core stratification suite

Purpose: compare tiers, models, and configs on useful capability.

This should contain tests expected to produce differential signatures across 16/32/64 GB systems or across model/config choices.

Initial candidates:

- `csv-parser`
- `lru-cache`
- `expression-eval`
- `adversarial-input`
- `deep-equal`
- `state-machine`
- `agent-single`
- `large-refactor`
- `api-evolution`
- `eight-functions`
- `tool-confusion`
- `parseISO`
- `subtle-broken-spec`

Keep tests in this layer if they show statistically credible spread across tiers, models, or configs, or if they are axis-critical.

### Layer C: Diagnostic deep-dive suite

Purpose: explain failures and guide R&D levers.

This layer is less about leaderboard pass rate and more about trace interpretation.

Useful diagnostic tags:

| Tag | Trigger | Likely engineering lever |
|---|---|---|
| `verify-loop` | Repeated edit/verify cycles without convergence | Improve error extraction, final verification guidance, or patch planning. |
| `low-verify-cadence` | Many edits before running tests | Prompt or harness policy: verify after bounded edits. |
| `incorrect-convergence` | Model declares success but final verifier fails | Mandatory final-verifier gate; stricter success criteria. |
| `bash-loop-no-progress` | Repeated shell calls without workspace changes | No-progress detector; intervention prompt. |
| `context-pressure` | High input-token/context ratio plus degraded behavior | Compaction, shorter tool outputs, context warnings, context budget design. |
| `write-churn` | Repeated broad rewrites instead of targeted edits | Patch planning, diff discipline, edit-tool guidance. |
| `tool-shape-error` | Invalid tool JSON or invalid tool-call shape | Tool grammar constraints, structured error feedback. |
| `thermal-contaminated` | Run begins or proceeds under high SoC temperature / throttling | Cooldown, rerun, or exclude latency from clean matrix. |

Important: this tag system should be treated as provisional until it has been calibrated beyond the 11 expression-eval failed traces. Validate it against the prior failed-tail traces and a sample of lower-tier failures before treating tag rates as canonical.

### Layer D: Frontier and stress suite

Purpose: expose the edge of the strongest local configuration.

This layer should include:

- Harder expression-eval-like tasks.
- Larger multi-file refactors.
- Context-heavy tasks.
- Long-horizon agentive tasks.
- Frontier coding/productivity stressors.

Do not let frontier tests dominate the core scorecard. Their job is to reveal the next failure frontier, not to define day-to-day usefulness.

---

## 4. Capability-axis taxonomy

Use capability axes as the main reporting frame. Behavioral signatures and W4-style labels live underneath these axes.

Recommended initial axes:

| Axis | What it measures | Existing coverage | Needed additions |
|---|---|---|---|
| Spec precision | Edge cases, ambiguity, semantic constraints, hidden corner cases | `expression-eval`, `deep-equal`, `adversarial-input`, `parseISO` | More semantic task families with broad edge surfaces. |
| Stateful logic | Caches, state machines, accumulators, ordering, intervals | `lru-cache`, `state-machine`, interval-style tests | Property-based variants and stateful holdouts. |
| Multi-file context | Cross-file coherence, API evolution, refactors | `large-refactor`, `api-evolution`, `eight-functions` | Larger but realistic repo edits. |
| Convergence | Ability to use verifier feedback to reach correctness | All coding tests | Trace tags and final-verifier gates. |
| Tool discipline | Tool choice, recovery, efficient inspection, avoiding thrash | `agent-single`, `tool-confusion`, tool-discipline tests | Real multi-step agentic tasks. |
| Productivity | Non-code summarization, rewriting, extraction, formatting, synthesis | Essentially absent | New productivity test families. |
| Local usability | Quality per time, token, context, thermals, memory target | All tests | Explicit reporting of wallclock, p90 latency, context pressure, pass-per-minute, thermal status. |

Every test should have:

- One primary axis.
- Up to two secondary axes.
- A suite layer.
- A difficulty band.
- An oracle/holdout type.
- A known-confounds field.
- A keep/drop rule.

---

## 5. Matrix design: tier, model, quantization, and context

The word "tier" is useful but ambiguous. It can mean at least four things:

1. Hardware memory target: 16 GB, 32 GB, or 64 GB.
2. Model choice: which model can fit and run acceptably on that target.
3. Quantization choice: which compression level is used.
4. Effective context limit: which may vary by model and quantization.

The suite should support two matrix views.

### 5.1 Product-facing tier matrix

Question answered:

> What can a user expect from the best supported configuration on each hardware tier?

Cell identity:

```text
(test_id, hardware_tier, product_model_config_id)
```

This view is appropriate for product and leadership communication. It intentionally allows different models/quantizations/context limits per tier, because that is what users will actually run.

### 5.2 R&D / ablation matrix

Question answered:

> Which variable caused the degradation: hardware capacity, model size, quantization, context, sampler, or harness behavior?

Cell identity:

```text
(test_id, hardware_tier, model_id, quantization, context_limit, sampler_config_id, harness_version)
```

This view should hold variables constant whenever feasible. Examples:

| Ablation | What to hold constant | What to vary |
|---|---|---|
| Hardware capacity | model, quantization, context, sampler, harness | hardware tier |
| Quantization | hardware tier, model family, context, sampler, harness | quantization |
| Context limit | hardware tier, model, quantization, sampler, harness | context limit |
| Sampler | hardware tier, model, quantization, context, harness | sampler config |
| Harness | hardware tier, model, quantization, context, sampler | harness version |

Not every ablation will be possible on every tier. The point is to make the confound explicit rather than hide it behind `tier-32` or `tier-16` labels.

### 5.3 Mandatory model-config identity

Every run must reference a stable `model_config_id` that expands to:

| Field | Requirement |
|---|---|
| `model_id` | Exact model name and revision/hash. |
| `model_family` | Family name for aggregation. |
| `parameter_count` | Nominal size, if known. |
| `quantization` | Format and parameters. |
| `context_limit` | Effective context available to the harness. |
| `runtime_backend` | Backend/runtime version. |
| `sampler_config_id` | Full sampler settings and seed policy. |
| `harness_version` | Git SHA or release identifier. |
| `prompt_pack_version` | System/developer/task prompt version. |

A dashboard that only says `(test, tier)` is allowed as a summary view, but never as the source of truth.

---

## 6. Phase 0: foundation sprint

Phase 0 is not a setup checklist. It is the first engineering deliverable.

### 6.1 Objectives

Before production lower-tier sweeps, Phase 0 should produce:

1. A canonical run registry schema.
2. A historical-data reconciliation policy.
3. A test manifest schema.
4. A model-config manifest schema.
5. A statistical decision rule for test classification.
6. A thermal telemetry/control policy.
7. A public/dev vs hidden/admission holdout policy.
8. A productivity-grading design.
9. Trace-tag calibration criteria.

### 6.2 Canonical run registry

Required fields:

| Field | Purpose |
|---|---|
| `run_id` | Stable row identity. |
| `run_kind` | Production, pilot, archived, smoke, diagnostic, admission, etc. |
| `canonical_status` | Canonical, legacy-compatible, legacy-asterisked, or excluded. |
| `hardware_tier` | 16, 32, or 64. |
| `memory_gb` | Physical memory. |
| `model_config_id` | Stable key to model/config manifest. |
| `model_id` | Exact model name and revision. |
| `quantization` | Quantization format and parameters. |
| `context_limit` | Effective context window. |
| `sampler_config_id` | Full sampler settings and seed policy. |
| `seed` | Random seed, if applicable. |
| `harness_version` | Git SHA or release identifier. |
| `prompt_pack_version` | System/developer/task prompt version. |
| `test_id` | Stable test family identifier. |
| `test_version` | Exact prompt/verifier version. |
| `oracle_type` | Public verifier, hidden holdout, rubric, judge, human, etc. |
| `timeout_budget` | Time/iteration budget used for the run. |
| `start_time` / `end_time` | Run timing. |
| `terminal_status` | Done, error, timeout, interrupted, harness-error, etc. |
| `passed` | Final model-task pass/fail, excluding harness contamination where appropriate. |
| `harness_error` | Boolean or typed error category. |
| `thermal_status` | Clean, warning, contaminated, unknown. |
| `trace_artifact_uri` | Link/path to trace artifacts. |

The registry should make it impossible to accidentally compare pilot rows, production rows, and archived runs without knowing their provenance.

### 6.3 Historical-data policy

Engineering should classify historical rows into four buckets:

| Bucket | Meaning | Allowed use |
|---|---|---|
| Canonical | Full required metadata and compatible telemetry | Main dashboards and comparisons. |
| Legacy-compatible | Missing non-critical fields but comparable after explicit assumptions | Exploratory dashboards with visible caveat. |
| Legacy-asterisked | Useful qualitatively but missing important metadata/schema fields | Narrative context only; do not use for formal deltas. |
| Excluded | Harness-contaminated or insufficient provenance | Do not aggregate. |

The 120-run production sweep, pilot loops, and archived sampler-grid data should not be merged into one table until each row has a bucket and provenance label.

### 6.4 Phase 0 sign-off criteria

Production lower-tier sweeps should not start until:

- A run can be executed end-to-end and lands in the registry with all mandatory fields.
- A smoke run on each hardware tier verifies telemetry, thermal status, model-config identity, and trace artifact links.
- Historical rows have been bucketed.
- The statistical classification rule is written and accepted.
- Hidden/admission holdout handling is decided.
- Productivity grading methodology is decided, even if productivity tests are not yet implemented.

Dry runs during Phase 0 are fine. They should be labeled `run_kind=smoke` or `run_kind=dry_run`, not used as production evidence unless they satisfy the signed-off schema.

---

## 7. Hidden-holdout and leakage policy

Public tests are useful for development. They are not sufficient for model admission after repeated tuning.

### 7.1 Split tests by use

Each capability axis should eventually have two sets:

| Set | Purpose | Visibility | Use |
|---|---|---|---|
| Public/dev | Authoring, debugging, sampler/prompt/harness tuning | Visible to engineers and models during runs | Development and regression. |
| Hidden/admission | Model-trial acceptance and final comparison | Restricted; not tuned against | Admission gates and periodic audit. |

Hidden holdouts should be close enough to the public tasks to measure the same axis, but different enough that solving the public verifier is not equivalent to solving the hidden set.

### 7.2 Storage and access

Engineering should decide before model-trial admission begins:

- Where hidden tests live: private repo, restricted directory, encrypted artifact, or controlled CI job.
- Who can view and modify them.
- Whether hidden inputs are revealed to the model at run time but not to tuning engineers, or whether only result artifacts are visible.
- How result summaries are reported without leaking exact cases.

### 7.3 Rotation policy

Hidden sets decay as they influence decisions. The plan should include:

- A rotation cadence, for example quarterly or after major tuning cycles.
- A rule for retiring leaked or overfit cases.
- A small reserve pool per capability axis.
- A distinction between exploratory hidden probes and official admission holdouts.

### 7.4 What hidden holdouts should not be

Hidden holdouts should not be trick questions. They should test generalization to nearby cases:

- Similar task, new inputs.
- Same spec, unseen edge combinations.
- Same productivity rubric, new document.
- Same agentic pattern, new repo layout or tool-error instance.

---

## 8. Cross-tier sweep plan

### Phase 1: lower-tier census

After Phase 0 sign-off, run the existing telemetry-compatible suite on tier-32 and tier-16 before writing many new hard tests.

Recommended design:

| Dimension | Recommendation |
|---|---|
| Hardware tiers | 16, 32, 64. |
| First view | Product-facing tier matrix using the baseline supported config per tier. |
| Second view | R&D ablation matrix where feasible. |
| First model/config | Current baseline model/config or explicitly chosen product config per tier. |
| Repeats | n=10 broad census only as a screen; n=20-30 for provisional core candidates; n≈40-60 or power-derived N for admission-grade claims. |
| Sampler arms | v1-prod first; add v3-deterministic or other arms only if seed policy and budget are clear. |
| Ordering | Randomized or block-randomized, plus thermal controls. |
| Timeout policy | Same user-facing SLA for primary product score; ablation studies may also report fixed iteration/token budgets. |
| Telemetry | Capture pass/fail, iterations, tool calls, token pressure, terminal state, trace tags, thermal status, wallclock. |

The output of this phase should be a first discrimination matrix. It should not make irreversible keep/drop decisions from n=10 screen results.

### Phase 1A: single-MBP overnight constraint mode

This mode is for the current hardware constraint: **1x M5 Max MBP** and a target run window of **overnight**. It is not the final production sweep. It is a triage pass designed to answer: which tests are worth spending confirmatory wall clock on?

A caution on interpretation: if the M5 Max MBP is being used to emulate tier-16/tier-32/tier-64 by switching model/config/context rather than by running on separate physical machines, treat latency as **single-hardware config latency**, not final product-tier latency. Pass/fail and trace behavior can still be useful for R&D screening if the model/config identity is recorded.

#### Goals

| Goal | Requirement |
|---|---|
| Fit in one overnight run | Prefer 6.5-12 hours wall clock; hard-stop the job if it threatens to consume the next workday. |
| Preserve cross-tier signal | Cover tier-16 and tier-32 broadly; use tier-64 historical data when trustworthy. |
| Avoid low-value expansion | Do not add new productivity/agentive families to this first overnight run unless they are smoke pilots. |
| Keep statistical claims honest | Treat results as screening/provisional only. |
| Keep the machine busy | Use telemetry flags rather than blanket cooldowns; rerun contaminated cells later. |

#### Recommended overnight recipe

Use this as the default constrained run:

| Dimension | Overnight setting |
|---|---|
| Run kind | `overnight_screen`. |
| Hardware | Current 1x M5 Max MBP. |
| Tiers/configs | Full tier-16 and tier-32 screen; tier-64 reused from canonical-compatible baseline if available. |
| Tier-64 drift check | If reusing old tier-64, run only a small anchor panel: `expression-eval`, `csv-parser`, `lru-cache`, `agent-single`, and one multi-file test, n=5-10 each. |
| Repeats | n=10 per tier/test for tier-16 and tier-32. Use n=8 if the projected queue exceeds the overnight window. |
| Sampler arms | One sampler only: current product/default sampler. No v3-deterministic comparison in this pass. |
| Test set | Existing telemetry-compatible suite first. Do not expand the suite in the same overnight run. |
| Ordering | Interleave by tier, test family, and seed where possible. |
| Thermal policy | Capture thermal status; no mandatory 60-second cooldown between every run. |
| Stopping rule | Complete coverage beats extra repeats. If time runs short, finish n=8 for all selected tests before deepening any cell to n=10. |
| Output label | `screening_only=true`; not valid for model admission, public claims, or permanent keep/drop decisions. |

#### Runtime budget

The current empirical planning anchor is approximately **6-10 hours per tier** for the existing suite at n=20. The constrained modes below scale from that anchor.

| Mode | Contents | Approx wall clock | When to use |
|---|---|---:|---|
| Preferred overnight screen | tier-16 + tier-32, existing 31 tests, n=10; tier-64 reused plus small anchor panel | 6.5-11 hours | Default if old tier-64 rows are canonical-compatible. |
| No-reuse fallback | tier-16 + tier-32 + tier-64, existing 31 tests, n=8 | 7.5-12 hours | Use if tier-64 must be rerun but overnight still matters. |
| Tight-night fallback | priority subset, tier-16 + tier-32, n=10; small tier-64 anchor | 3.5-6 hours | Use if the machine is needed the next morning or thermal/throughput is worse than expected. |
| Confirmatory night | only top candidate discriminators, n=20-40 depending on power target | Variable; usually another overnight | Use after the screen identifies high-value cells. |

#### Priority subset for tight-night fallback

If the full suite cannot fit, keep axis coverage instead of sampling tests arbitrarily.

| Axis | Keep first |
|---|---|
| Spec precision | `expression-eval`, `adversarial-input`, `deep-equal`, `parseISO`. |
| Stateful logic | `csv-parser`, `lru-cache`, `state-machine`, `algorithm-intervals` if available. |
| Multi-file context | `large-refactor`, `api-evolution`, `eight-functions`. |
| Tool discipline / agentive | `agent-single`, `tool-confusion`, `tool-discipline` if available. |
| Harness health | minimal smoke tests needed to validate telemetry and final verification. |

If a named test is unavailable or quarantined, substitute the closest test on the same axis. Do not add frontier/stress tests to the tight-night fallback.

#### Interpretation rule

For this constrained mode, the strongest legitimate conclusions are:

- "This test is a candidate discriminator worth confirming."
- "This test appears ceiling/floor under the current model/config, but needs confirmation."
- "This axis appears tier-sensitive and deserves deeper sampling."
- "This run was contaminated by harness or thermal issues and should be rerun."

Do **not** conclude:

- "This test should be permanently dropped."
- "This model passes admission."
- "Tier-32 is definitively better/worse by X percentage points."
- "Sampler A beats sampler B." Sampler comparisons are out of scope for this overnight screen.

### Phase 2: discrimination matrix

Build a report where rows are tests and columns are hardware tiers, with model/config dimensions visible or filterable.

Minimum columns:

| Column | Meaning |
|---|---|
| `pass_rate_t16` | Pass rate on 16 GB target. |
| `pass_rate_t32` | Pass rate on 32 GB target. |
| `pass_rate_t64` | Pass rate on 64 GB target. |
| `ci_t16`, `ci_t32`, `ci_t64` | Wilson, bootstrap, or Bayesian interval. |
| `spread_point` | `max(pass_rate) - min(pass_rate)` across tiers. |
| `spread_credible` | Whether spread remains meaningful under the interval rule. |
| `monotonicity` | Whether pass rate generally improves with tier. |
| `harness_error_rate` | Infrastructure contamination. |
| `thermal_contamination_rate` | Fraction of runs with thermal warning/contamination. |
| `median_iters`, `p90_iters` | Convergence burden. |
| `median_wallclock`, `p90_wallclock` | User-facing cost. |
| `median_tokens_per_second`, `p90_tokens_per_second` | Runtime throughput. |
| `p90_context_pressure` | Context fragility. |
| `dominant_trace_tags` | Common failure signatures. |
| `oracle_type` | Public/dev, hidden/admission, rubric, judge, etc. |

Sort tests by credible discrimination value, not raw point spread alone.

Recommended classification:

| Label | Definition | Action |
|---|---|---|
| Core discriminator | Meaningful cross-tier or cross-config spread, uncertainty-aware, stable, interpretable | Keep in main grid. |
| Provisional discriminator | Large point spread but insufficient N or overlapping intervals | Rerun confirmatory sample before relying on it. |
| Ceiling regression | 100% or near-100% across all tiers/configs after confirmatory data | Move to smoke/regression. |
| Floor stressor | 0% or near-0% across all tiers/configs after confirmatory data | Move to frontier/stress. |
| Noisy diagnostic | Useful traces but unstable pass rate | Keep for R&D, not leaderboard/admission. |
| Harness-contaminated | Infrastructure/tooling dominates failures | Quarantine until fixed. |
| Thermal-contaminated | Latency/throughput distorted by heat | Exclude from clean latency comparisons; rerun if pass/fail may be affected. |

### Phase 3: axis scorecards

Aggregate tests by capability axis.

Example view:

| Axis | Tier-16 | Tier-32 | Tier-64 | Notes |
|---|---:|---:|---:|---|
| Spec precision | TBD | TBD | High but not ceiling | `expression-eval` remains informative. |
| Stateful logic | TBD | TBD | Ceiling | Lower-tier data needed. |
| Multi-file context | TBD | TBD | Ceiling in pilots | Likely tier-sensitive. |
| Tool discipline | TBD | TBD | Ceiling in simple tasks | Needs richer agentive tests. |
| Productivity | Not measured | Not measured | Not measured | Highest coverage gap. |
| Local usability | TBD | TBD | TBD | Needs wallclock/token/thermal reporting. |

Avoid a single global score until the axis scorecards are stable. Even then, do not use a single aggregate score for external or leadership-facing communication without the axis breakdown beside it. The pull toward "tier-32 scored 72%" will be strong and misleading.

---

## 9. Statistical decision rules

### 9.1 Screening versus classification

Separate screening from classification.

| Stage | Sample size | Allowed conclusion |
|---|---:|---|
| Overnight constrained screen | n=8-10 per cell, one sampler | Identify candidate discriminators and obvious contamination; not valid for durable keep/drop, admission, or sampler conclusions. |
| Broad census | n≈10 per cell | Screen for obvious ceiling/floor/spread; do not drop tests solely from this. |
| Provisional classification | n≈20-30 per cell | Mark candidate core, noisy, ceiling, or floor with visible uncertainty. |
| Confirmatory classification | Power-derived, often n≈40-60 for large effects | Make durable keep/drop/admission decisions. |

### 9.2 Default core-discriminator rule

Replace the original raw-spread rule with this default:

```text
A test is a confirmed core discriminator if:
  1. observed max(pass_rate) - min(pass_rate) >= 25 percentage points, and
  2. the highest and lowest cells' 80% Wilson intervals do not overlap,
     or an agreed Bayesian/bootstrap rule gives high probability that the true spread exceeds the threshold,
  3. harness-error and thermal-contamination rates are below the accepted limits,
  4. failures are interpretable or axis-critical.
```

Rationale:

- The point spread keeps the test practically meaningful.
- The interval condition prevents overreacting to small-N noise.
- 80% intervals are intentionally less conservative than 95% intervals for screening/core-maintenance decisions; admission decisions can require stricter evidence.
- Borderline tests should move to `provisional discriminator`, not be dropped.

### 9.3 Power-derived N for high-stakes comparisons

For model admission, major config changes, or public claims, do not rely on a fixed n=20 plan. Compute sample size from:

- Target minimum effect size, for example 20, 25, or 30 percentage points.
- Expected baseline pass rate.
- Paired versus unpaired design.
- Desired alpha / false-positive tolerance.
- Desired power.
- Number of comparisons.

Rule of thumb:

- n=20 is useful for finding large effects, not for retiring subtle sampler/config questions.
- n≈40 can be adequate for large, clean effects, especially with paired designs.
- n≈40-60 or more may be needed for 25-30 percentage point effects depending on baseline rates and comparison structure.
- For sampler/prompt/harness tuning, use paired seeds where possible; otherwise treat comparisons as unpaired and budget more N.

### 9.4 Reporting requirements

Report effect sizes, not only p-values.

Recommended reporting:

| Outcome | Report |
|---|---|
| Pass/fail | Pass rate plus Wilson/bootstrap/Bayesian interval. |
| Tier spread | Point spread plus interval/probability qualification. |
| Config deltas | Paired deltas with bootstrap CI where possible. |
| Iterations/cost | Median, p75, p90, and outlier inspection. |
| Trace behavior | Tag rates and representative trace links. |
| Local usability | Pass-per-minute, p90 wallclock, throughput, context-pressure distribution, thermal status. |

---

## 10. Productivity test plan

Start with five productivity families. Design them as reusable families, not one-off prompts.

Productivity tasks should be:

- Useful to real users.
- Deterministically or semi-deterministically gradable.
- Sensitive to hallucination and omission.
- Cheap enough to run across models and tiers.
- Not dependent on subjective prose taste alone.

### 10.1 Initial productivity families

| Family | Task | Oracle or grading approach |
|---|---|---|
| Changelog summarization | Convert an 800-1200 word changelog into release notes | Required issue IDs, required risks, max length, no unsupported claims. |
| Noisy meeting notes | Extract action items, owners, dates, blockers | Exact JSON fields; content-unit match; abstain if owner/date absent. |
| Email rewrite | Rewrite a blunt internal email into formal/customer-safe tone | Preserve facts and ask; length bounds; banned phrases; no invented commitments. |
| Structured data brief | Summarize a CSV/table into Markdown with totals and anomalies | Deterministic totals plus required observations. |
| Doc cleanup | Turn messy notes into a short spec/RFC | Required sections; preserved constraints; no invented requirements. |

### 10.2 Productivity grading dimensions

| Dimension | What to check |
|---|---|
| Factual preservation | Required source facts appear in the output. |
| Non-hallucination | No unsupported dates, numbers, owners, commitments, or claims. |
| Structure | Required headings, JSON schema, table format, or section order. |
| Concision | Length bounds or bullet limits. |
| Usefulness | Human or fixed-judge review on sampled outputs. |

### 10.3 Grading methodology

The productivity suite should use a hybrid grader:

| Component | Role |
|---|---|
| Deterministic checks | Schema validity, length bounds, exact IDs, computed totals, forbidden phrases. |
| Semantic content matching | Match paraphrased facts and omissions without brittle string matching. |
| Pinned external judge | Score subjective usefulness or tone when deterministic checks are insufficient. |
| Human calibration | Validate the judge against human consensus before production use. |

Requirements before first productivity test enters the core matrix:

1. Specify the judge model and pinned version, if LLM-as-judge is used.
2. Create a calibration set of roughly 30 examples across pass, fail, and borderline outputs.
3. Have at least two humans grade the calibration set or adjudicate disagreements.
4. Measure judge agreement with human consensus before trusting judge scores at scale.
5. Define what judge failures look like and when human review overrides the judge.
6. Budget 1-2 sprint weeks for grading infrastructure and calibration.

Do not rely solely on LLM-as-judge scoring. Do not let the local model grade itself. Do not make the productivity column a leadership-facing metric until the grading methodology has been calibrated.

---

## 11. Agentive test plan

The agentive suite should move beyond hello-world tool use into multi-step task execution.

Recommended first families:

| Family | What it probes | Example |
|---|---|---|
| Multi-step repo repair | Search, inspect, edit, verify | Failing test plus docs; model must find the right file and patch it. |
| Tool-error recovery | Recovery after failed tool calls or stale assumptions | Seeded edit failure such as `old_string not found`; model must re-read and recover. |
| Verifier selection | Choosing the authoritative signal | Multiple scripts exist; only one is specified as official. |
| Local research synthesis | Grounded answers over local files | Read several docs and answer with citations or explicit unknowns. |
| Artifact update | Code/prose consistency | Change an API and update README, examples, and changelog. |

Avoid pure adversarial trickery. The better design is aligned public tests plus hidden holdout checks. The visible verifier should help normal development; the hidden verifier should test generalization, not punish reasonable interpretations.

Agentive tests should report:

- Tool-call count and cadence.
- File-inspection coverage.
- Recovery from tool errors.
- No-progress loop rate.
- Final artifact quality.
- Grounding/citation accuracy for local research tasks.

---

## 12. Coding-suite improvements

Do not only make `expression-eval` harder. Instead, create siblings that share the same useful property: many interacting semantic edges.

Candidate families:

| Family | Edge surface |
|---|---|
| Query-filter evaluator | Boolean precedence, string quoting, numeric comparisons, null/missing fields. |
| Template renderer | Variables, conditionals, escaping, loops, missing keys. |
| Mini dependency resolver | Semver-like constraints, cycles, optional dependencies, tie-breaking. |
| Log parser/classifier | Multiline records, severity mapping, malformed lines. |
| Markdown table transformer | Escaping, alignment, numeric totals, missing values. |

Each family should expose difficulty knobs:

| Knob | Examples |
|---|---|
| Edge density | 6, 12, or 24 assertions. |
| File count | 1 file, 4 files, or 12 files. |
| Context pressure | Short prompt, long docs, or distractor docs. |
| Verification visibility | Public tests only; public tests plus hidden holdout. |
| Recovery burden | Clean workspace, seeded wrong implementation, or seeded partial fix. |

This lets R&D answer targeted questions:

- Does tier-32 fail because the task is multi-file?
- Does it fail because the spec has too many semantic edges?
- Does it fail because context pressure grows?
- Does it fail because verifier feedback is hard to use?
- Does a sampler or prompt change improve convergence without hurting other axes?

---

## 13. Thermal and environmental controls

> **Status (2026-05-04): superseded.** The thermal layer described here was implemented through Sprint 1.18 and then removed (CODE-REVIEW §1.5.2): 0/650 contamination signal across the deep n=8 sweep, lab runs 24/7 under an external fan, hardware-managed headroom. `thermal_status` and `thermal_drift_advisory` no longer exist as registry columns; `lib/telemetry.js` and `scripts/thermal-watch.sh` have been deleted. This section is retained as design history. Tripwire to restore: anomalous tokens/sec traceable to thermal cause we can't otherwise explain.

Thermal control matters most for latency, throughput, and user-facing cost metrics. It may also affect model output in configurations where nondeterminism or timing-dependent scheduling affects sampling.

### 13.1 Minimum telemetry

Each run should capture, if feasible:

| Metric | Use |
|---|---|
| Start SoC temperature | Detect hot-start contamination. |
| End SoC temperature | Detect sustained heating. |
| Peak SoC temperature | Flag throttling risk. |
| Fan / power state, if available | Explain throughput changes. |
| Ambient condition or lab machine group | Interpret machine-to-machine variation. |
| Tokens/sec or eval throughput | Separate model behavior from runtime slowdown. |
| Thermal status | Clean, warning, contaminated, unknown. |

### 13.2 Control policy

Pick one of these before production lower-tier sweeps:

| Option | Pros | Cons |
|---|---|---|
| Cooldown between runs | Simple and reliable | Slower sweeps. |
| Temperature threshold with rerun | Preserves data quality | Requires telemetry integration. |
| Multiple physical units with randomized order | High throughput | More hardware coordination. |
| Thermal status flag only | Cheap | Leaves latency matrix partly contaminated. |

Recommended default:

- Randomize test order.
- Capture start/end/peak thermal status.
- Mark runs as `thermal_status=warning` or `thermal_status=contaminated` when thresholds are exceeded.
- Exclude contaminated runs from clean latency/throughput comparisons.
- Rerun contaminated runs if pass/fail appears suspect or if the run is part of an admission gate.

Block randomization spreads thermal contamination across cells; it does not remove the contamination. Use it with telemetry, not instead of telemetry.

### 13.3 Single-MBP overnight default

For the first constrained overnight screen, do **not** add a mandatory cooldown between every run. A blanket 60-second cooldown could consume a meaningful fraction of the overnight budget. Use this cheaper policy instead:

1. Randomize or interleave tier/test/seed order.
2. Record thermal status at run start and end where available.
3. Record throughput tokens/sec or equivalent runtime speed.
4. Mark hot-start or throttled runs as `thermal_status=warning` or `thermal_status=contaminated`.
5. Exclude contaminated rows from clean latency comparisons.
6. Rerun only contaminated or suspicious cells during a later confirmatory night.

This preserves the overnight objective while keeping the evidence honest.

---

## 14. Config-comparison design

Sampler, prompt, and harness behavior are not independent in practice. Sequentially tuning one lever at a time can produce local optima.

### 14.1 Baseline first

Do not start broad config tuning until the baseline product matrix exists. First answer:

> What does the current supported configuration do on each hardware tier?

Then tune on tests that are:

- Non-ceiling.
- Non-floor.
- Stable enough to detect movement.
- Strategically relevant.
- Not hidden admission tests.

### 14.2 Paired design when possible

For sampler/config comparisons:

- Use the same task seed across arms whenever the task generator supports seeds.
- Use the same hardware/thermal policy across arms.
- Interleave arms by block to avoid temporal drift.
- If seeds cannot be paired, label the comparison unpaired and budget more N.

### 14.3 Small DOE-style experiments

For high-leverage config questions, consider a small factorial design rather than one-change-at-a-time tuning.

Example factors:

| Factor | Arms |
|---|---|
| Sampler | v1-prod, v3-deterministic |
| Prompt policy | baseline, verify-after-edit guidance |
| Harness policy | baseline, no-progress intervention |
| Context policy | raw logs, compacted tool output |

Use DOE-style experiments only on a subset of stable tests. Do not run every factor combination across the whole suite until the high-signal subset is known.

---

## 15. Model-trial protocol

Every new model should enter through the same funnel.

### Stage 0: fit and harness admission

Gate requirements:

| Gate | Requirement |
|---|---|
| Model loads | Fits target tier without memory failure. |
| Tool loop works | Can inspect files, edit files, and run verifier. |
| Telemetry complete | Emits assertion results, model-config identity, trace metrics, and thermal status. |
| Smoke pass | Basic smoke/harness tests pass without infrastructure errors. |

### Stage 1: public core grid

Run the public/dev core stratification suite on the target tier with the standard baseline sampler/harness.

Report:

- Axis pass rates.
- Test-level pass rates.
- Median and p90 wallclock.
- Throughput and thermal status.
- Median and p90 iteration count.
- p90 context pressure.
- Harness-error rate.
- Incorrect-convergence rate.
- Dominant diagnostic trace tags.

### Stage 2: config tuning

Tune sampler, prompts, and harness behavior only after the baseline public core grid is known.

Do not tune on all tests equally. Tune on tests with:

- Room to improve.
- Stable pass/fail behavior.
- Interpretable traces.
- Strategic relevance to target use cases.

Do not tune on hidden admission holdouts.

### Stage 3: hidden admission gate

Before adopting a model/config, run the hidden/admission panel.

The hidden panel should answer:

- Does the model generalize beyond the public/dev tests?
- Did tuning improve public scores while overfitting task-specific verifiers?
- Does the model retain productivity, tool discipline, and local usability?

### Stage 4: regression check

Before shipping or standardizing a model/config, rerun a fixed regression panel to ensure the tuning did not improve one hard coding task while degrading productivity, tool discipline, or local usability.

---

## 16. Engineering deliverables

Recommended implementation order:

| Priority | Deliverable | Purpose |
|---:|---|---|
| 1 | Phase 0 run registry and manifests | Remove ambiguity across sweep, pilot, and archived data. |
| 2 | Statistical decision spec | Prevent raw point-spread misclassification. |
| 3 | Tier/model/config matrix spec | Separate product-tier and R&D/ablation views. |
| 4 | Thermal telemetry/control policy | Protect latency and local-usability conclusions. |
| 5 | Hidden-holdout policy | Make model admission defensible. |
| 6 | Productivity grading design | Make productivity tests credible before they influence decisions. |
| 7 | Test manifest | Map every test to axis, suite layer, oracle type, and difficulty knobs. |
| 8 | Cross-tier sweep runner config | Make tier/model/sampler comparisons reproducible. |
| 9 | Discrimination matrix report | Primary strategic dashboard. |
| 10 | Behavioral signature extractor | Diagnostic data layer for failure interpretation. |
| 11 | Productivity test families | Close the largest coverage gap. |
| 12 | Agentive task families | Close the second-largest coverage gap. |
| 13 | Model admission protocol | Let new models slot into the same grid. |
| 14 | Config-comparison report | Support sampler, prompt, and harness tuning. |
| 15 | Test cards | Document what each test means and when to trust it. |

### 16.1 Test-card template

Each test should have a small card:

| Field | Description |
|---|---|
| Test ID | Stable identifier. |
| Suite layer | Smoke, core, diagnostic, or frontier. |
| Primary axis | Main capability measured. |
| Secondary axes | Up to two secondary capabilities. |
| Oracle type | Deterministic verifier, hidden holdout, rubric, human/LLM judge, etc. |
| Public/hidden status | Public/dev, hidden/admission, or both. |
| Intended difficulty | Expected behavior on tier-16, tier-32, tier-64. |
| Known confounds | Model may inspect verifier, prompt ambiguity, thermal sensitivity, harness contamination, etc. |
| Diagnostic tags | Expected failure signatures. |
| Keep/drop rule | Uncertainty-aware criterion; axis-critical override if appropriate. |
| Example traces | Representative pass and fail runs. |

---

## 17. Revised sprint plan

### Sprint 0: foundation / Phase 0

Objective:

> Make the evidence base trustworthy before production lower-tier sweeps.

Work items:

1. Define and implement the canonical run registry schema.
2. Define `model_config_id` and expand it into model, quantization, context, sampler, harness, runtime, and prompt-pack fields.
3. Bucket historical rows as canonical, legacy-compatible, legacy-asterisked, or excluded.
4. Decide product-tier matrix versus R&D/ablation matrix views.
5. Write the statistical decision rule for core/provisional/ceiling/floor/noisy classifications.
6. Add or specify thermal telemetry and contamination flags.
7. Decide hidden-holdout storage, access, and rotation policy.
8. Specify productivity grading methodology, including judge choice and human calibration plan.
9. Validate provisional trace tags against the prior failed-tail sample and at least one additional sample.
10. Run smoke/dry-run checks on each tier to confirm telemetry completeness.

Sprint 0 output:

- Signed-off registry and manifest schema.
- Historical-data status table.
- Matrix specification.
- Statistical decision spec.
- Thermal policy.
- Holdout policy.
- Productivity grading plan.
- Smoke evidence from each hardware tier.

### Sprint 1: constrained lower-tier census

Objective:

> Produce the first useful cross-tier screening matrix on the available 1x M5 Max MBP without exceeding an overnight wall-clock window.

Work items:

1. Run the **overnight constrained screen** from Phase 1A.
2. Use existing telemetry-compatible tests only; defer new productivity/agentive families to separate pilots.
3. Run tier-16 and tier-32 broadly at n=8-10 using the signed-off schema.
4. Reuse tier-64 baseline rows only if they satisfy canonical or legacy-compatible criteria; otherwise run the n=8 no-reuse fallback or a minimal tier-64 anchor panel.
5. Use one sampler only: the current product/default sampler.
6. Apply randomized/interleaved ordering and thermal telemetry flags, but avoid blanket cooldowns during the overnight run.
7. Build a **screening** discrimination matrix with intervals, spread, monotonicity, harness-error rate, thermal status, cost metrics, and trace tags.
8. Classify tests as candidate core, likely ceiling, likely floor, noisy diagnostic, harness-contaminated, or thermal-contaminated. Treat every label as provisional.

Sprint 1 output:

- First overnight cross-tier screening matrix.
- Candidate list for confirmatory reruns.
- Evidence on whether tier-16/tier-32 separate on existing tests.
- Short list of tests that look likely to move to smoke/regression, frontier/stress, or quarantine after confirmation.
- Updated wall-clock estimate from observed throughput on the M5 Max MBP.

### Sprint 2: missing coverage and confirmatory runs

Objective:

> Close the biggest coverage gaps and confirm the most important discriminators.

Work items:

1. Run confirmatory samples for high-value provisional discriminators.
2. Implement the first calibrated productivity test families.
3. Implement richer agentive task families.
4. Start hidden-holdout variants for axes used in model admission.
5. Build axis scorecards.
6. Begin small config-comparison experiments on stable non-ceiling tests.

Sprint 2 output:

- Confirmed core suite v1.
- Productivity pilot with calibrated grader.
- Agentive pilot with trace diagnostics.
- Axis scorecard v1.
- Config-comparison pilot report.

### Planning envelope

This is not a few-day cleanup. A realistic planning envelope is:

| Workstream | Rough effort |
|---|---:|
| Phase 0 registry/manifests/reconciliation | 1-2 focused sprint weeks |
| Thermal and telemetry integration | 0.5-1 sprint week, depending on tooling |
| Single-MBP overnight screen | 1 overnight run plus 0.5-1 day analysis/reporting |
| Confirmatory lower-tier reruns | Additional targeted overnight runs as needed |
| Productivity grading calibration | 1-2 sprint weeks |
| Productivity and agentive pilots | 1-2 sprint weeks |
| Dashboard polish and model-admission protocol | 1-2 sprint weeks |

Overall expectation remains roughly **2-3 months of focused work** to reach a defensible v1 engineering handoff, depending on staffing and how much telemetry infrastructure already exists. The constraint pass changes the first sweep from a multi-day provisional census into an overnight screen; it does not eliminate the later confirmatory work.

---

## 18. Decisions needed from R&D leadership

> Several items below are now locked in `TIER-EVAL-V2-SPRINT-PLAN.md` §3 (hidden-holdout storage path, productivity judge = `claude-opus-4-7`, single-MBP serial execution, useful-test threshold per §9.2, sampler tuning deferred to next iteration). The remaining open items are productivity scope (§18.1) and tier-comparison priority (§18.2).

### 18.1 Productivity scope

What does productivity mean for this lab?

Possible interpretations:

- Developer productivity: code review notes, changelogs, documentation, issue triage.
- General knowledge-work productivity: meeting notes, emails, tables, summaries, document Q&A.
- Local personal assistant productivity: file organization, calendar/email-style tasks, retrieval over local documents.

The answer determines which productivity tests to author first.

### 18.2 Tier-comparison goal

Which question has priority?

| Goal | Suite implication |
|---|---|
| Which tier is good enough for which use case? | Need clean tier separation and use-case-aligned axes. |
| Where is the current model strong or weak per tier? | Need broad capability profiling. |
| Does config X move the needle? | Need stable, low-variance tests and paired comparison tooling. |
| Which new model should we trial next? | Need admission gates and model-comparison dashboards. |

These goals are compatible, but they prioritize different engineering work.

### 18.3 Product matrix versus ablation matrix

Leadership and engineering should explicitly decide:

- Which model/config represents each hardware tier in the product-facing matrix.
- Which variables must be held constant for R&D ablations.
- Whether context should be equalized for some comparisons even if that underuses tier-64.
- Whether quantization comparisons are first-class R&D questions or secondary diagnostics.

### 18.4 Useful-test threshold

Replace the old tier-64 failure-rate rule with an uncertainty-aware cross-tier discrimination rule.

Recommended default:

```text
Confirmed core discriminator =
  observed spread >= 25 pp
  + non-overlapping 80% Wilson intervals between highest and lowest cells
  + acceptable harness/thermal contamination
  + interpretable or axis-critical failures.
```

Use n=10 only for screening, n=20-30 for provisional classification, and power-derived N for admission or public claims.

### 18.5 Hidden-holdout policy

Decide:

- Which axes get hidden/admission variants first.
- Where hidden tests live.
- Who can access them.
- How often they rotate.
- What happens when a hidden case leaks or becomes overfit.

### 18.6 Productivity grading policy

Decide:

- Whether productivity scoring uses deterministic checks only, hybrid deterministic + judge, or human review.
- Which judge model/version is pinned.
- How much human calibration budget is available.
- What agreement threshold is required before judge scores are trusted.

### 18.7 Sampler/config priority

Sampler tuning has not been retired as a lever. Decide whether sampler exploration runs in parallel with cross-tier sweeps or waits until the first discrimination matrix exists.

Recommended default:

- First produce the tier discrimination matrix using the baseline sampler/config.
- Then tune sampler/configs on tests with stable, non-ceiling, non-floor behavior.
- Use paired seeds where possible; otherwise budget larger unpaired samples.

---

## 19. What not to do

Do not drop tests simply because tier-64 passes them.

Do not create adversarial traps whose only purpose is to make tier-64 fail.

Do not let coding dominate the suite if the lab wants useful local agents.

Do not use a single aggregate score until the axis-level scorecards are stable.

Do not use a single aggregate score in external or leadership-facing communication without the axis breakdown beside it.

Do not continue optimizing around Cohen's kappa unless the project explicitly returns to one-model failure-mode classification.

Do not mix harness failures into model pass rates.

Do not mix thermal-contaminated latency into clean local-usability comparisons.

Do not tune sampler/prompt/harness settings on hidden admission tests and then claim generalization.

Do not tune sampler/prompt/harness settings on frontier stressors and then claim broad product improvement.

Do not compare `tier-16`, `tier-32`, and `tier-64` without also exposing model, quantization, context, sampler, and harness identity.

---

## 20. Recommended north star

The mature suite should produce one concise report per model/config:

```text
For each hardware tier, what can this local model reliably do?
At what latency, throughput, thermal, token, and context cost?
Which capability axes are strong or weak?
Which failures are caused by convergence, context pressure, tool discipline, harness issues, or thermal/runtime artifacts?
What changes when we alter model, quantization, context, sampler, prompt, or harness behavior?
Does the model generalize from public/dev tests to hidden/admission holdouts?
```

That report should be grounded in:

- A cross-tier discrimination matrix.
- A product-facing tier view.
- An R&D/ablation view.
- Capability-axis scorecards.
- Productivity and agentive coverage.
- Behavioral trace diagnostics.
- Local usability and thermal metrics.
- Reproducible run manifests.
- Public/dev versus hidden/admission separation.

The current suite is close enough to start answering the right question, but not before the evidence foundation is cleaned up. The next move is not to discard the existing tests or make everything harder. The next move is to run Phase 0, measure tier-32 and tier-16 under a signed-off schema, add calibrated productivity and richer agentive coverage, and turn the suite into a cross-tier R&D instrument.
