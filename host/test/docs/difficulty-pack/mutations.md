# P1 mutation specs — Sprint 1.21

Front matter only. The per-pick rename maps, edge-case shifts, and
return-shape changes that were applied at authoring time are now baked
into the shipped tests under
[`../../__tests__/tier-eval/`](../../__tests__/tier-eval/) (with
`adapted_from` notes in each manifest) and the canonical references
under [`canonicals/`](canonicals/). Read the test file alongside the
canonical to see what changed.

**Goal of mutation:** defeat surface-level recall ("I've seen this exact
problem") while preserving the underlying capability test (spec_precision
under non-greedy edge cases, stack interpreter with redefinition, etc.).
Mutations should *not* change which axis the test probes.

**Calibration interaction:** R8 calibration check fires if t16 ≥ 70% — if
the produced model solution is structurally identical to the canonical
upstream at [`canonicals/<slug>/proof.ci.js`](canonicals/), mutate harder
and re-pilot.

**Open question for staff scientist** ([`PLAN.md`](PLAN.md) §Open
questions Q3): at what mutation depth does the test transition from
`adapted_from` to `inspired_by` for attribution purposes? Heavy mutations
sit at the boundary; flag in PR for review.

## Mutation-depth gate (fired once)

Alphametics shipped with `+`/`*` mixed-operator extension; cycle 1+2
pilot floored 0/3 t32 + 0/2 t16, gate triggered, `*` extension dropped,
test now addition-only with rename, bidirectional `=`, and
`[{symbol,code}]` return shape retained. Recorded here as evidence that
the mutation-depth gate is load-bearing — future ports should expect to
trip it occasionally and revert.
