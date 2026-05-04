# Memo: Aider polyglot data does not exist per-exercise; calibration implications — 2026-05-02

## TL;DR

Per-exercise pass-rate data for any Qwen3-class model on the Aider polyglot
benchmark is **not published anywhere** — neither in the
[`Aider-AI/polyglot-benchmark`](https://github.com/Aider-AI/polyglot-benchmark)
repo, [`Aider-AI/aider`](https://github.com/Aider-AI/aider) repo,
[aider.chat/docs/leaderboards](https://aider.chat/docs/leaderboards/) UI,
nor on Hugging Face. Aider commits **only aggregate stats** over all 225
mixed-language cases. Our 7 P1 picks proceed blind on per-slug data.

What the aggregate data **does** tell us shifts the calibration: our pick
mix is plausibly tilted **too hard** for Qwen3.5-9B, and we should be
ready to swap in runner-ups during pilot rather than reject-without-swap.

## What Aider publishes

Files (raw URLs, both confirmed accessible 2026-05-02):

- [`polyglot_leaderboard.yml`](https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml) — main models
- [`qwen3_leaderboard.yml`](https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/qwen3_leaderboard.yml) — Qwen3 variants

Each entry exposes only:
- `pass_rate_1`, `pass_rate_2` — aggregate pass@1 / pass@2 over all 225 cases
- `percent_cases_well_formed` — fraction with parseable edit format
- token + cost counts
- model id, edit_format (`diff` / `whole`), provider, thinking flags

**Not exposed at any level:** per-exercise, per-language subset, per-difficulty-band.

## Aggregate Qwen3 numbers (relevant slice)

| model | edit_format | provider | pass@1 | pass@2 |
|---|---|---|---|---|
| Qwen3 32B | whole | VLLM bf16, no_think | 20.4% | **45.8%** |
| Qwen3 32B | diff | VLLM bf16, no_think | 20.4% | 41.3% |
| Qwen3 32B | diff | OpenRouter (default thinking) | 14.2% | 40.0% |
| Qwen3 235B A22B | diff | official API, no_think | 28.9% | **59.6%** |
| Qwen3 235B A22B | whole | VLLM bf16, no_think | 28.0% | 65.3% |
| Qwen3 235B A22B | whole | llama.cpp Q5_K_M unsloth | 27.1% | 59.1% |

Note the **5 percentage-point gap** between full-precision VLLM and
llama.cpp Q5_K_M on the same 235B model — same dynamic likely applies to
our 9B at IQ4_XS / Q5_K_XL.

## Calibration implications for our 7 P1 picks

### 1. The 32B → 9B model gap

Our model is Qwen3.5-**9B**, strictly weaker than Qwen3-32B (which scores
40–46% pass@2 aggregate). Naive linear extrapolation by parameter count is
not load-bearing, but the rough expectation is **9B aggregate pass@2 ≈
25–35%** on the full 225-case polyglot set.

That is also our model's *expected aggregate floor* on Aider hard — meaning
on the Aider problems that landed in the 32B's "discriminative middle,"
the 9B is likely to **floor** rather than land mid-band.

### 2. Pick difficulty distribution may be over-rotated hard

| Pick | Exercism difficulty | Risk on 9B |
|---|---|---|
| `book-store` | 5 | Mid — likely lands |
| `wordy` | 7 | High — may floor |
| `alphametics` | 7 | High — may floor |
| `word-search` | 8 | Very high — already flagged floor risk |
| `forth` | 8 | Very high — may floor |
| `grade-school` | 5 | Mid — already flagged ceiling risk |
| `two-bucket` | 6 | Mid–high — may floor |

Four of seven picks (`wordy`, `alphametics`, `word-search`, `forth`) sit at
difficulty 7–8 — exactly where Qwen3-32B's 40% pass@2 is presumably
concentrated and where 9B is most likely to floor.

### 3. Counter-evidence from our own data

Sprint 1.19 N=8 t16 confirm landed at **84.6% pass-all / 98.3% done-only**
on our 26-test pack. The pack is easier than Aider's difficulty-7–8 tail
in absolute terms, but the gap between our model and Aider's 32B is
narrower than parameter count alone would predict. Plausible reasons:

- Sampler tuning (`v6antiloop-pp01` for t16) targets the iterative-agent
  loop, not first-shot generation Aider measures
- `runClaw`'s feedback loop (verify.js → re-prompt) supplies Aider-style
  pass@2 *plus* per-iteration error context
- Our test pack averages lower spec density than Exercism difficulty-8

Net: 9B-on-difficulty-8 may not floor as hard as the naive extrapolation
suggests. We genuinely don't know until pilot.

## Operational adjustment

**Add to calibration pilot interpretation rules** (per
[`../PLAN.md`](../PLAN.md) §Calibration / Reject criteria):

> When R1 (t16 0/5 floor) fires on a difficulty-7–8 P1 pick, **do not
> immediately auto-reject and re-author**. First swap with a runner-up
> bench candidate at the next difficulty band down (e.g., `word-search`
> 8 → `ledger`; `wordy` 7 → no comparable runner-up — accept or
> hand-author). The runner-up bench is positioned exactly for this
> scenario.

Concrete swap candidates if pilot floors:

| If this floors | Swap to |
|---|---|
| `word-search` (diff 8, spec_precision) | `ledger` — runner-up |
| `forth` (diff 8, stateful_logic) | `robot-name` (diff 6) — runner-up |
| `wordy` (diff 7, spec_precision) | (no comparable runner-up; consider hand-authored substitute) |
| `alphametics` (diff 7, spec_precision) | `zebra-puzzle` (diff 7) — but contamination-heavier; only if must |

**Budget impact:** worst case all four difficulty-7–8 picks floor and we
swap; that's 4 extra pilot N=5 cycles ≈ 40 attempts × 2 tiers = 80
additional GPU attempts. At t16 + t32 cold-load + serial scheduling, ~1.5
extra hours of exclusive chip time. Within tolerance of the 3–7 hour
calibration budget called out in [`../PLAN.md`](../PLAN.md) §Execution
order.

## Updated research disclosure

The original "Aider pass rate: unknown — proceed blind" disclosure should
additionally say:

> Aggregate Qwen3-32B pass@2 = 40–46%. Qwen3.5-9B aggregate is
> conservatively estimated at 25–35%, suggesting four difficulty-7–8 picks
> (`wordy`, `alphametics`, `word-search`, `forth`) carry elevated floor
> risk. Runner-up swap-in protocol per `aider-calibration-note.md`.

(Apply this edit in step 2 — mutation specs — when we revisit the picks file.)

## Addendum (2026-05-02): leaderboard sanity-check confirms framing

Cross-check via [aider.chat/docs/leaderboards](https://aider.chat/docs/leaderboards/)
on 2026-05-02 reports the same numbers as the YAML pull. Two new pieces:

**Run dates.** Qwen3 235B = 2025-05, Qwen3 32B = 2025-05-08. Both predate
Qwen3.5 (Feb 2026) by ~9 months. The leaderboard cannot answer "what does
Qwen3.5-9B do on Aider" because the data is from the prior model
generation. Treat the 32B 40% number as a **lower-bound anchor for
Qwen3.5-9B's capability ceiling on this benchmark family**, not a direct
prediction.

**Floor anchor — Qwen2.5-Coder-32B = 8.0% pass@2.** This is the *base
coder* of our model's predecessor family. Our Qwen3.5-9B inherits Qwen3
architectural improvements *plus* additional training-time delta over a
year. So 8% is a "what we replaced" floor; we expect strictly better, by
an unknown but probably substantial margin.

**Operational reading of the full Aider Qwen-family slice:**

| model | pass@2 | role for our calibration |
|---|---|---|
| Qwen2.5-Coder-32B-Instruct | 8.0% | Pre-Qwen3 floor; "what we replaced" |
| QwQ-32B | 20.9% | Reasoning model variant; not directly comparable |
| qwen-max-2025-01-25 | 21.8% | Closed Alibaba commercial; not directly comparable |
| Qwen3 32B | 40.0% | **Lower bound for our discriminative-middle target** |
| Qwen3 235B A22B | 59.6% | Upper bound for the discriminative middle |
| (frontier reference) gpt-5 high | 88.0% | Saturation territory — out of band |

The middle band on Aider polyglot **is** where 2025-vintage open-weights
Qwen3-class models land. Our discriminative-middle target (30–60% on the
new pack) is operationally validated against this distribution — though
the absolute mapping from "Aider hard" → "our pack hard" remains an
unknown function of:
- our agent loop (`runClaw` re-prompts on verifier fail; Aider's pass@2
  feeds *test output* back, similar but not identical)
- our pack's spec density vs Exercism's
- model generation gap (2025-05 → 2026-02)

**Bottom line for staff-scientist review:**

The 30–60% framing is defensible. Specific numerical predictions for
Qwen3.5-9B on individual Aider exercises are not — write the 1.21 final
writeup as "we expect mid-band, calibrated by N=5 pilot, with runner-up
bench positioned for floor-rotation." Avoid quoting a specific
extrapolated 9B number.

## Open question for staff-scientist review

Is naive parameter-count extrapolation (32B → 9B → minus ~10pp aggregate)
defensible at all, or should we just say "unknown"? The published Qwen3
data has no 9B entry; the closest comparable is Qwen2.5-Coder-32B-Instruct
(present in main leaderboard). Using a 32B-coder as a more-capable
upper-bound and our own 26-test pack as a relative anchor may be more
defensible than parameter-count extrapolation. Calling this out in the
final 1.21 writeup so it doesn't read as fabricated rigor.

**Updated stance after addendum:** prefer the framing "we expect
mid-band, calibrated by N=5 pilot" over any specific numerical
extrapolation. Drop the "25–35%" estimate from the picks.md research
disclosure.

## Status

Note only; no code or test changes yet. Apply during step 2 (mutation
specs) per [`../PLAN.md`](../PLAN.md) §Execution order, item 2.
