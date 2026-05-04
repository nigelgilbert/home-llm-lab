# Exercism canonicals — retrieval log

Snapshot of upstream Exercism JS exercise files for the 4 P1 picks
active in the Sprint 2 core matrix: `book-store`, `wordy`,
`two-bucket`, `word-search`. Pulled verbatim from
`raw.githubusercontent.com/exercism/javascript/main/` on **2026-05-02**
via `curl`. Files committed unmodified.

The original P1 set was 7 picks. Three did not make the core matrix
and their canonicals are not retained here:

- `grade-school` — dropped as a dead-end cell in cycle 2 (commit `5c7e7cf`).
- `alphametics`, `forth` — floored on both tiers in cycles 1–2 and
  relocated to [`../../../__tests__/tier-eval/frontier/`](../../../__tests__/tier-eval/frontier/)
  as documented capability gaps. Their license attribution lives in the
  manifest `notes` field on each frontier `.test.js`. The canonicals
  were dropped because frontier tests are not going to Sprint 2 N=60
  confirmatory, so the R8 memorization-audit re-fire scenario doesn't
  apply.

## Why these files live in-repo

1. **R8 memorization audit reference.** During pilot calibration, if a
   P1 port hits t16 ≥ 70%, hand-compare the model's produced solution
   against `<slug>/proof.ci.js`. Structural identity → memorization →
   mutate harder. Ran during cycles 1–4 at N=5 and did not fire on any
   port; held in case Sprint 2's N=60 confirmatory pushes a port over
   the threshold.
2. **Mutation spec inputs.** Mutation design (rename map, edge shifts,
   return-shape changes) used the canonical spec (`instructions.md`)
   and the canonical solve (`proof.ci.js`) side by side. Authoring
   complete; retained as the audit trail for the derivative chain.
3. **License attribution.** Per-pick `config.json` carries source +
   author metadata required for derivative-work attribution in the
   test manifest `notes` field.

## Contents

| File | Origin path under each `<slug>/` |
|---|---|
| `instructions.md` | `.docs/instructions.md` |
| `instructions.append.md` | `.docs/instructions.append.md` (only book-store, two-bucket) |
| `config.json` | `.meta/config.json` |
| `proof.ci.js` | `.meta/proof.ci.js` (canonical solution) |
| `tests.toml` | `.meta/tests.toml` (canonical test-case enable list) |

## License

Per Exercism repo root ([github.com/exercism/javascript/blob/main/LICENSE](https://github.com/exercism/javascript/blob/main/LICENSE)):

> The MIT License (MIT)
> Copyright (c) 2015 Exercism

Per-exercise `config.json` may name additional authors and an upstream
inspiration source — see each file's `authors` and `source` fields. After
mutation, our committed test is a derivative work; attribution preserved
in the test-file manifest `notes` field.

## Re-fetch

```sh
BASE="https://raw.githubusercontent.com/exercism/javascript/main/exercises/practice"
for slug in book-store wordy word-search two-bucket; do
  for src in .meta/config.json .meta/proof.ci.js .meta/tests.toml \
             .docs/instructions.md .docs/instructions.append.md; do
    curl -sf -o "$slug/$(basename "$src")" "$BASE/$slug/$src" && echo "OK $slug/$src"
  done
done
```

Files in this directory are read-only references; do not edit.
