# Sprint 1.5 Code Review

**Opened:** 2026-05-01. **Gate:** Sprint 2 starts when all rows have a verdict and all `cut` items have landed.

Audit target is **maintenance surface area** (schema fields, code paths, doc drift), not engineer-hours. Verdicts: `keep` / `cut` / `defer` (with tripwire).

---

## 1.5.1 — `canonical_status` 4-state enum

**Where:** [run_registry.schema.json](../../lib/schemas/run_registry.schema.json), [historical_bucketing.csv](historical_bucketing.csv).
**States:** `canonical` / `legacy-compatible` / `legacy-asterisked` / `excluded`.
**Findings:** Only consumer is [scripts/registry-to-csv.mjs:73](../../scripts/registry-to-csv.mjs#L73) — a string-equality `--bucket` filter, identical on any value set. Defaults written by [lib/claw.js:258](../../lib/claw.js#L258) and [lib/run_row.js:97](../../lib/run_row.js#L97), both `'canonical'`. The four states appear elsewhere only as **human labels for 9 historical artifacts** in `historical_bucketing.csv`; no code distinguishes the three non-canonical states from each other.

**Verdict:** **cut** (collapse to 2-state).
**Action:**
- replace 4-state enum in `run_registry.schema.json` with `canonical` / `non-canonical`
- add nullable free-text `provenance_note` column for the historical-labeling story
- migrate `historical_bucketing.csv`: existing label strings move into `provenance_note`; `canonical_status` becomes `non-canonical` for all 9 rows
- [scripts/registry-to-csv.mjs](../../scripts/registry-to-csv.mjs) `--bucket` filter continues to work as a string-equality match (now binary in practice)
- defaults in [lib/claw.js](../../lib/claw.js) and [lib/run_row.js](../../lib/run_row.js) stay `'canonical'`

---

## 1.5.2 — Thermal-watch (pmset hint + drift advisory)

**Status (2026-05-04): executed.** Cut shipped — `scripts/thermal-watch.sh` and `lib/telemetry.js` deleted, schema columns removed, runbook references stripped. Section retained as the rationale of record.

**Where (pre-cut):** `scripts/thermal-watch.sh`, `lib/telemetry.js` (`captureThermalStatus`, `captureThroughputAdvisory`), `thermal_status` + `thermal_drift_advisory` columns.
**Signal so far:** 0/650 `pmset_contaminated` rows; 19–31% drift-advisory rate, never used to drive a decision.
**Operator context:** lab runs 24/7 under an external fan; thermal headroom is hardware-managed. Software layer is redundant.

**Verdict:** **cut** (full remove).
**Action:**
- delete `scripts/thermal-watch.sh`
- remove `captureThermalStatus` + `captureThroughputAdvisory` from `lib/telemetry.js` (delete file if no other callers)
- stop emitting `thermal_status` + `thermal_drift_advisory` from [lib/run_row.js](../../lib/run_row.js) and [scripts/harvest-runs-to-registry.mjs](../../scripts/harvest-runs-to-registry.mjs)
- drop both columns from `run_registry.schema.json`
- remove parallel-terminal launch step from [scripts/run-overnight-screen.sh](../../scripts/run-overnight-screen.sh) and the overnight runbook
- **historical archive (2026-04-28):** frozen CSV, nothing re-validates it. Leave as-is. If a future tool ever needs to read it, it pins to the row's `harness_version` and resolves to the pre-cut schema.
- **tripwire to restore:** any registry row with anomalous tokens/sec traceable to thermal cause we can't otherwise explain

---

## 1.5.3 — `expected-attempts.mjs` plan/diff layer

**Where:** [scripts/expected-attempts.mjs](../../scripts/expected-attempts.mjs), wired into [run-overnight-screen.sh](../../scripts/run-overnight-screen.sh).
**Catches to date:** Sprint 1.10 missing `mini-vm tier=64 rep=1`; Sprint 1.18 tier-16 over-emission (n=9 from split kickoff); 1.12–15 clean.
**Findings:** Subcommands `plan` and `diff` both wired into the overnight driver. Flags: `--tests-dir`, `--tiers`, `--reps`, `--out`, `--expected`, `--registry`, `--help`/`-h`. All required and consumed; no `--strict`, no dead options.

**Verdict:** **keep**. No cuts.

---

## 1.5.4 — Telemetry library split

Subsumed by 1.5.2. **Verdict:** **cut** (no separate task).

---

## Retained without review

Near-zero maintenance, locking value real. Re-open on concrete signal.

- **Three separate JSON Schemas** (`run_registry` / `model_config` / `test_manifest`) — independent lifecycles; collapsing would regress.
- **Hidden-holdout policy memo + `.gitignore` entry** — small memo, one gitignore line, no code refs.
