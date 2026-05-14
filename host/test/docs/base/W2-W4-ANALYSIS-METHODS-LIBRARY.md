# W2-W4 Analysis Methods Library

W2-W4 era methods reference, lifted from now-archived analysis scripts (`host/test/scripts/_attic/w2-w4-iter-distribution/`). Both source scripts are pure stdlib — no scipy/numpy — so the math is hand-rolled and worth preserving for any future iter-count or sampler-comparison work. Re-use guidance for Sprint 1.23 sampler-ablation memo at the bottom; provenance attributed to the v2 plan (`TODO-ITERATION-DISTRIBUTION-TEST.md` §W2/W3 analysis) per source comments.

---

## Sampler-arm comparison methods

Source: `host/test/scripts/_attic/w2-w4-iter-distribution/sampler-arm-compare.py`. Designed to compare two sampler arms (originally `v1-prod` vs `v3-deterministic`) on iter_count and wallclock distributions, with a practical-equivalence retirement criterion.

### Hodges-Lehmann shift estimate

Median of all pairwise differences `a_i − b_j` between two samples. Robust nonparametric estimate of the shift between two distributions; less sensitive to outliers than mean-difference, less wasteful than median-difference (which discards pair structure).

`host/test/scripts/_attic/w2-w4-iter-distribution/sampler-arm-compare.py:62-67`:

```python
def hodges_lehmann(a: list[float], b: list[float]) -> Optional[float]:
    """Median of all pairwise (a_i − b_j)."""
    if not a or not b:
        return None
    diffs = [ai - bj for ai in a for bj in b]
    return percentile(diffs, 0.5)
```

**When to use:** central-tendency shift between two samples when n is small (≤30) and you do not want to assume Gaussianity. Computes |a|·|b| pairs — O(nm) — fine at n=20 per arm, would matter at n≥1000.

### Bootstrap 95% CI for delta of arbitrary statistic

Resample both arms with replacement `B=10000` times, recompute `stat_fn(a) − stat_fn(b)` per iteration, return the empirical 2.5th/97.5th percentiles of the delta distribution alongside the point estimate from the original samples.

`host/test/scripts/_attic/w2-w4-iter-distribution/sampler-arm-compare.py:124-155`:

```python
def bootstrap_delta_ci(
    a: list[float],
    b: list[float],
    stat_fn,
    *,
    iterations: int = 10000,
    seed: int = 17,
    alpha: float = 0.05,
) -> Optional[tuple[float, float, float]]:
    """Returns (delta, ci_low, ci_high) for stat_fn(a) − stat_fn(b)."""
```

**Algorithm:**
1. Seed RNG (default `seed=17` for reproducibility).
2. For `iterations` (default 10000) trials: draw `len(a)` samples from `a` with replacement, same for `b`, compute `stat_fn` on each, append the delta.
3. Sort the delta vector. Return `(stat_fn(a) − stat_fn(b), diffs[lo_idx], diffs[hi_idx])` with `lo_idx = int((alpha/2) * B)` and `hi_idx = int((1 - alpha/2) * B) - 1`.

**Why bootstrap vs analytical:** the statistic of interest is arbitrary (median, p75, p90, mean-of-top-5). Analytical CIs exist for the median and arguably the mean, but not for `mean_of_top_n(5)` or arbitrary tail percentiles — bootstrap covers all of them with a single implementation. Particularly necessary for `mean_of_top_n` because there is no closed-form sampling distribution.

### Cliff's δ

Probability that a random draw from `a` exceeds a random draw from `b`, minus the reverse, normalized to `[-1, 1]`. Positive δ ⇒ `a` tends to exceed `b`.

`host/test/scripts/_attic/w2-w4-iter-distribution/sampler-arm-compare.py:70-85`:

```python
def cliffs_delta(a: list[float], b: list[float]) -> Optional[float]:
    """Cliff's δ ∈ [-1, 1]. Positive: a tends to exceed b."""
    ...
    return (ab - ba) / n
```

**Interpretation thresholds (Romano et al. convention):**

| \|δ\| | label |
|---|---|
| < 0.147 | negligible |
| < 0.33 | small |
| < 0.474 | medium |
| ≥ 0.474 | large |

Source script does not encode these thresholds — they are reader-applied at write-up time.

### Mann-Whitney U

Rank-sum test, normal-approximation z-score path. Returns U statistic and a two-sided p-value via Φ(z) computed from `math.erf`.

`host/test/scripts/_attic/w2-w4-iter-distribution/sampler-arm-compare.py:88-117`:

```python
def mann_whitney_u(a, b) -> tuple[Optional[float], Optional[float]]:
    """U statistic and approximate two-sided p-value (normal approximation)."""
    # Average ranks (handles ties), compute U = min(U1, U2),
    # mu = n1*n2/2, sigma = sqrt(n1*n2*(n1+n2+1)/12)
    z = (u - mu) / sigma
    p = 2 * (1 - _phi(abs(z)))
```

with `_phi(x) = 0.5 * (1 + math.erf(x / math.sqrt(2)))` at `host/test/scripts/_attic/w2-w4-iter-distribution/sampler-arm-compare.py:120-121`.

**Role:** explicitly **supporting evidence only** per the docstring at `:11`. Practical-equivalence verdict (below) is driven by the bootstrap CIs, not the MWU p-value. Normal approximation is acceptable at n≥20 per arm but does not include the standard tie-correction term, so do not over-interpret marginal p-values.

### Practical-equivalence retirement criterion

Decision rule for retiring sampler tuning as a recurring lever. All of the following must hold per test for the rule to fire `retire=True`.

`host/test/scripts/_attic/w2-w4-iter-distribution/sampler-arm-compare.py:276-325`:

```
band(reference, abs_min, rel_pct) = max(abs_min, rel_pct * reference)

For each test:
  median_band = band(median_iter_v1, abs_min=1, rel_pct=0.20)
  p75_band    = band(p75_iter_v1,    abs_min=1, rel_pct=0.20)
  top5_band   = band(mean_top5_iter_v1, abs_min=2, rel_pct=0.25)

  median_inside = -median_band <= median_delta_ci[low,high] <= +median_band
  p75_inside    = -p75_band    <= p75_delta_ci[low,high]    <= +p75_band
  top5_inside   = -top5_band   <= top5_delta_ci[low,high]   <= +top5_band
  pass_guard    = pass_count_delta >= -1

  test_passes = median_inside AND p75_inside AND top5_inside AND pass_guard

retire = all(test_passes for test in tests)
```

**Threshold table:**

| statistic | abs_min | rel_pct |
|---|---|---|
| median iter | 1 | 0.20 |
| p75 iter | 1 | 0.20 |
| mean-of-top-5 iter | 2 | 0.25 |
| pass-count delta (Δ_v3 − Δ_v1) | n/a | must be ≥ −1 |

**Read of the rule:** the band is `max(abs_min, rel_pct × v1_reference)`. The 95% bootstrap CI on the (v3 − v1) delta must lie entirely inside `[−band, +band]` for that statistic to count as "practically equivalent." Tail (top-5) gets a wider band (`abs_min=2`, `rel_pct=0.25`) because tail estimates are higher-variance at n=20. Pass-count guard prevents a sampler swap that ties on iteration shape but loses 2+ passes from being labeled equivalent.

### Powered-design qualification

n=20 per arm only powers detection of *large* distributional shifts. The retirement rule's verdict therefore supports **deprioritizing** sampler tuning, not proving zero effect. Source language at `host/test/scripts/_attic/w2-w4-iter-distribution/sampler-arm-compare.py:318-324` (verbatim):

> At n=20 per arm, this design is powered only for large distributional shifts. The result can support deprioritizing sampler tuning as a primary wallclock-variance lever when practical-equivalence criteria are met, but it does not prove sampler has no effect. Moderate sampler effects may remain unresolved; resolving them would require n ≥ 50 per arm.

---

## Iter-distribution analysis methods

Source: `host/test/scripts/_attic/w2-w4-iter-distribution/iter-distribution.py`. Designed to characterize iteration-count distributions and assess H1 ("iter_count is a tail-heavy contributor to wallclock variance") on the v1-prod arm.

### Descriptive statistics + tail-shape ratios

`descriptive(values)` returns `n`, `mean`, `median`, `p25`, `p75`, `iqr` (=p75−p25), `p90`, `min`, `max`. Helper at `host/test/scripts/_attic/w2-w4-iter-distribution/iter-distribution.py:81-100`.

`tail_shape(iter_counts)` returns three ratios at `host/test/scripts/_attic/w2-w4-iter-distribution/iter-distribution.py:103-127`:

| ratio | definition | guard |
|---|---|---|
| `p90_over_median` | `percentile(s, 0.9) / percentile(s, 0.5)` | None if median is 0 or absent |
| `max_over_median` | `max(s) / percentile(s, 0.5)` | None if median is 0 or absent |
| `top_quartile_share` | `sum(s[ceil(n*0.75):]) / sum(s)` | None if total is 0 |

**Note on `top_quartile_share`:** the cutoff is `math.ceil(len(s) * 0.75)` — values *above* that index — i.e., the top quartile is up to 25% of values by count, and `top_quartile_share` is their share of the total iter-count mass. At n=20 the cutoff is 15, so the top-5 by rank.

### Spearman ρ + OLS R²

Pure-stdlib implementations, used for assoc strength between iter_count (and other token-count predictors) and wallclock.

**Spearman ρ** at `host/test/scripts/_attic/w2-w4-iter-distribution/iter-distribution.py:130-149`: rank both vectors via `_ranks` (average ranks for ties), then Pearson on the rank vectors. Helper `_ranks` at `:152-166`.

**OLS R²** at `host/test/scripts/_attic/w2-w4-iter-distribution/iter-distribution.py:172-220`:
- `_solve_normal(X, y)`: solves the normal equations `X^T X β = X^T y` via Gaussian elimination with partial pivoting. Returns `None` on singularity (pivot magnitude `< 1e-12`).
- `ols_r2(X, y)`: requires `len(X) ≥ 3`, returns `1 - SS_res/SS_tot`. Returns `None` if `SS_tot == 0`.
- `add_intercept(rows)`: prepends a `1.0` column.

**Combined association suite** in `association_stats` at `host/test/scripts/_attic/w2-w4-iter-distribution/iter-distribution.py:292-337`. Computes:
- `rho_iter_wallclock`, `rho_outt_wallclock`, `rho_intt_wallclock` (Spearman ρ for each predictor vs wallclock)
- `univariate_r2_iter`, `univariate_r2_output_tokens`, `univariate_r2_input_tokens`
- `multivariate_r2_iter_plus_output_tokens` — joint OLS on `[output_tokens, iter_count]`
- `incremental_r2_iter_over_output_tokens = multivariate_r2 − univariate_r2_output_tokens` (only meaningful when both are not None)

Requires ≥ 5 complete rows (all five fields non-None) or returns the all-None dict.

### Wallclock decomposition

Per-row component shares of total wallclock, then median across rows. Three shares are reported per cell.

`host/test/scripts/_attic/w2-w4-iter-distribution/iter-distribution.py:262-280`:

```python
ms = total_model_elapsed_ms / wallclock_ms      # model_share
gs = total_non_model_gap_ms / wallclock_ms      # non_model_gap_share
us = max(0.0, 1 - ms - gs)                       # unaccounted_share
```

Then `model_share_median`, `non_model_gap_share_median`, `unaccounted_share_median` are the per-row medians. Rows with `wallclock_ms ≤ 0` or absent are dropped.

**Interpretation:** `model_share` is time spent inside the model; `non_model_gap_share` is observable harness/IO/tool time; `unaccounted_share` is residual (clamped to ≥ 0 to absorb timing-skew artifacts where component sums slightly exceed wallclock).

### Censoring counts

Terminal-status breakdown at `host/test/scripts/_attic/w2-w4-iter-distribution/iter-distribution.py:247-259`:

| bucket | mapping |
|---|---|
| `completed` | `terminal_status == 'done'` |
| `timeout` | `terminal_status == 'timeout'` |
| `context_overflow` | `terminal_status == 'context_overflow'` |
| `harness_error` | anything else (including missing/null) |

Note: this script's `harness_error` bucket is the **catch-all residual** — anything not matched by the three explicit cases. Distinct from the registry schema's `harness_error` enum value, which is a typed label.

### H1 multi-outcome verdict

`host/test/scripts/_attic/w2-w4-iter-distribution/iter-distribution.py:340-371`. Per-test mini-verdicts collapsed into one overall verdict.

**Per-test predicates:**

```
tail_heavy = (p90_over_median   >= 2.0)
          OR (max_over_median   >= 3.0)
          OR (top_quartile_share >= 0.40)

strong_assoc = (rho_iter_wallclock > 0.6)
            OR (univariate_r2_iter >= 0.6)
```

(Both `rho` and `r2` default to `0` when missing — `ass.get('...') or 0` — so missing predictors are conservatively treated as "no association" rather than blocking a verdict.)

**Per-test verdict:**

| condition | verdict |
|---|---|
| `tail_heavy AND strong_assoc` | `supported` |
| `(NOT tail_heavy) AND (rho < 0.4 AND r2 < 0.4)` | `not_supported` |
| else | `mixed_or_unresolved` |

**Overall verdict:**

| set of per-test verdicts | overall |
|---|---|
| `{supported}` only | `supported` |
| `{not_supported}` only | `not_supported` |
| anything else (mixed set or contains `mixed_or_unresolved`) | `mixed_or_unresolved` |

Source prose for the decision rule, verbatim from `host/test/scripts/_attic/w2-w4-iter-distribution/iter-distribution.py:464-467`:

> - **supported:** every test shows tail-heavy distribution AND strong iter-count association.
> - **not_supported:** every test is tight on tail ratios AND iter-count association is weak.
> - **mixed_or_unresolved:** otherwise; proceed to W4 trace inspection per the v2 plan.

---

## Provenance

Both scripts cite the v2 plan as their source spec:

- `sampler-arm-compare.py:3` — "Per the v2 plan (TODO-ITERATION-DISTRIBUTION-TEST.md §\"W3 analysis\")".
- `iter-distribution.py:3-4` — "Implements the v2 plan (TODO-ITERATION-DISTRIBUTION-TEST.md §\"W2 analysis\")".

Justifications captured inline in source worth preserving:

- `host/test/scripts/_attic/w2-w4-iter-distribution/sampler-arm-compare.py:234`, on choice of mean-of-top-5 over p90 for tail comparison:

  > Mean of top-5 (more stable than p90 at n=20).

- `host/test/scripts/_attic/w2-w4-iter-distribution/iter-distribution.py:464-467`, the H1-verdict prose quoted in full above.

- `host/test/scripts/_attic/w2-w4-iter-distribution/sampler-arm-compare.py:318-324`, the powered-design qualification quoted in full above.

---

## Re-use guidance

For Sprint 1.23 (sampler-ablation memo at `host/test/docs/difficulty-pack/memos/sampler-ablation-1.23.md`): registry rows under `host/test/.claw-runtime/run_registry.ablation-sampler-1.23-<datestamp>.jsonl` already carry `terminal_status`, `harness_error`, `iters_count`, and `sampler_config_id` (see `lib/schemas/run_registry.schema.json` and the W1 emitter at `lib/run_row.js`). The input-shape adapter is therefore small — load the JSONL, project to the same field names the attic scripts read (`test_id`, `sampler_id` from `sampler_config_id`, `iter_count` from `iters_count`, `terminal_status`, plus wallclock derived from `end_time − start_time` per Sprint 1.16b notes in `TIER-EVAL-V2-SPRINT-PLAN.md`), and the math copies as-is. The two scripts are good candidates to lift wholesale into a `host/test/scripts/sprint1-23/` worktree rather than re-deriving; modify only the load function and the output paths.
