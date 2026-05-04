#!/usr/bin/env node
// Sprint 1.21 explore-cycle summarizer.
//
// Reads a cycle's run_registry.<sweep>.jsonl, aggregates per-(test_id,
// hardware_tier) stats, snapshots one model session per failing cell into
// the cycle's snapshots/ dir, and writes summary.md — the single artifact
// the analyze-agent reads to propose tweaks.
//
// Usage:
//   node scripts/explore-summarize.mjs \
//     --registry .claw-runtime/run_registry.explore-c1-20260502.jsonl \
//     --runtime-dir .claw-runtime \
//     --tests "wordy alphametics ..." \
//     --cycle 1 \
//     --out-dir docs/difficulty-pack/explore/c1
//
// The model-session snapshot is the iterations.jsonl head + tail (60 lines
// each end) — enough for the analyze-agent to see the failure mode without
// pulling the entire trace into context.

import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const a = argv.slice(2);
  const opts = {};
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--registry') opts.registryPath = a[++i];
    else if (k === '--runtime-dir') opts.runtimeDir = a[++i];
    else if (k === '--tests') opts.tests = a[++i];
    else if (k === '--cycle') opts.cycle = a[++i];
    else if (k === '--out-dir') opts.outDir = a[++i];
    else { console.error(`unknown arg: ${k}`); process.exit(2); }
  }
  if (!opts.registryPath || !opts.runtimeDir || !opts.tests || !opts.cycle || !opts.outDir) {
    console.error('missing required args; see file header');
    process.exit(2);
  }
  return opts;
}

function readJsonl(p) {
  if (!fs.existsSync(p)) {
    console.error(`registry not found: ${p}`);
    return [];
  }
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function pct(n, d) {
  if (d === 0) return '0% (0/0)';
  return `${Math.round((n / d) * 100)}% (${n}/${d})`;
}

function p90(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
}

function aggregateCell(rows) {
  const total = rows.length;
  const passed = rows.filter((r) => r.passed === true).length;
  const failed = rows.filter((r) => r.passed === false).length;
  const nullPass = rows.filter((r) => r.passed === null).length;
  const timeouts = rows.filter((r) => r.terminal_status === 'timeout').length;
  const harnessErrors = rows.filter((r) => r.terminal_status === 'harness_error').length;
  const errors = rows.filter((r) => r.terminal_status === 'error').length;
  const dones = rows.filter((r) => r.terminal_status === 'done').length;
  const iters = rows.map((r) => r.iters_count).filter((x) => typeof x === 'number');
  const elapsedMs = rows.map((r) => {
    if (!r.start_time || !r.end_time) return null;
    return new Date(r.end_time) - new Date(r.start_time);
  }).filter((x) => typeof x === 'number');
  return {
    total,
    passed, failed, nullPass,
    timeouts, harnessErrors, errors, dones,
    p90Iters: p90(iters),
    p90ElapsedMs: p90(elapsedMs),
  };
}

function r1Trips(cell) { return cell.total > 0 && (cell.passed === 0 || cell.passed === cell.total); }
function r2Trips(cell) { return cell.total > 0 && (cell.timeouts / cell.total) >= 0.25; }
function r3Trips(cell) { return cell.total > 0 && cell.harnessErrors >= 1; }
function r4Trips(cell) { return cell.total > 0 && (cell.nullPass / cell.total) > 0.20; }
function r5Trips(cell) { return cell.total > 0 && cell.p90Iters !== null && cell.p90Iters > 25; }
function r6Trips(cell) { return cell.total > 0 && (cell.passed / cell.total) > 0.85; }

function snapshotSession(runtimeDir, runId, outPath) {
  // Find iterations.jsonl in any of the standard runtime layouts.
  // Sprint 1.16+: host/test/.claw-runtime/<run_id>/iterations.jsonl
  const candidates = [
    path.join(runtimeDir, runId, 'iterations.jsonl'),
    path.join(runtimeDir, runId, 'sessions', 'iterations.jsonl'),
  ];
  let found = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) { found = c; break; }
  }
  if (!found) {
    // Glob: any iterations.jsonl under the run_id directory
    const dir = path.join(runtimeDir, runId);
    if (fs.existsSync(dir)) {
      const stack = [dir];
      while (stack.length) {
        const d = stack.pop();
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, e.name);
          if (e.isDirectory()) stack.push(full);
          else if (e.name === 'iterations.jsonl') { found = full; break; }
        }
        if (found) break;
      }
    }
  }
  if (!found) {
    fs.writeFileSync(outPath, `(no iterations.jsonl found for run_id=${runId})\n`);
    return null;
  }
  const lines = fs.readFileSync(found, 'utf8').split('\n').filter(Boolean);
  const HEAD = 60, TAIL = 60;
  const out = [];
  out.push(`# run_id: ${runId}`);
  out.push(`# source:  ${found}`);
  out.push(`# total iterations: ${lines.length}`);
  out.push('');
  if (lines.length <= HEAD + TAIL) {
    out.push(...lines);
  } else {
    out.push('# === HEAD ===');
    out.push(...lines.slice(0, HEAD));
    out.push('');
    out.push(`# === ... (${lines.length - HEAD - TAIL} iterations elided) ===`);
    out.push('');
    out.push('# === TAIL ===');
    out.push(...lines.slice(-TAIL));
  }
  fs.writeFileSync(outPath, out.join('\n') + '\n');
  return found;
}

function main() {
  const opts = parseArgs(process.argv);
  const tests = opts.tests.trim().split(/\s+/).filter(Boolean);
  const rows = readJsonl(opts.registryPath);

  console.error(`explore-summarize: read ${rows.length} registry rows from ${opts.registryPath}`);

  const tiers = [...new Set(rows.map((r) => r.hardware_tier))].sort((a, b) => a - b);
  if (tiers.length === 0) {
    console.error('no rows to summarize');
    fs.mkdirSync(opts.outDir, { recursive: true });
    fs.writeFileSync(path.join(opts.outDir, 'summary.md'),
      '# Sprint 1.21 Explore — Cycle ' + opts.cycle + '\n\n**Status: NO ROWS** — registry was empty. Likely a harness or plist failure during the sweep. Inspect overnight log + registry path before retrying.\n');
    process.exit(0);
  }

  const snapshotsDir = path.join(opts.outDir, 'snapshots');
  fs.mkdirSync(snapshotsDir, { recursive: true });

  const cells = new Map(); // key: "test_id|tier" -> cell stats + sample fail rows
  for (const t of tests) {
    for (const tier of tiers) {
      const cellRows = rows.filter((r) => r.test_id === t && r.hardware_tier === tier);
      const stats = aggregateCell(cellRows);
      // Pick one failing row (passed===false preferred, else passed===null) to snapshot
      const failingRow = cellRows.find((r) => r.passed === false) || cellRows.find((r) => r.passed === null);
      cells.set(`${t}|${tier}`, { stats, failingRow });
    }
  }

  // Build the markdown summary
  const md = [];
  md.push(`# Sprint 1.21 Explore — Cycle ${opts.cycle}`);
  md.push('');
  md.push(`Generated ${new Date().toISOString()} from \`${path.basename(opts.registryPath)}\` (${rows.length} rows).`);
  md.push('');
  md.push(`Tiers in this cycle: ${tiers.join(', ')}.  Tests: ${tests.length}.`);
  md.push('');
  md.push('## Per-cell pass-rate matrix');
  md.push('');
  // Header
  let header = '| test_id |';
  let separator = '|---|';
  for (const tier of tiers) {
    header += ` t${tier} pass | t${tier} status |`;
    separator += '---|---|';
  }
  md.push(header);
  md.push(separator);
  for (const t of tests) {
    let row = `| \`${t}\` |`;
    for (const tier of tiers) {
      const { stats } = cells.get(`${t}|${tier}`);
      const { passed, total } = stats;
      const passStr = total === 0 ? '— (0/0)' : pct(passed, total);
      const statusBits = [];
      if (stats.timeouts) statusBits.push(`${stats.timeouts}t`);
      if (stats.harnessErrors) statusBits.push(`${stats.harnessErrors}h`);
      if (stats.errors) statusBits.push(`${stats.errors}e`);
      if (stats.nullPass) statusBits.push(`${stats.nullPass}n`);
      const statusStr = statusBits.length ? statusBits.join(' ') : 'clean';
      row += ` ${passStr} | ${statusStr} |`;
    }
    md.push(row);
  }
  md.push('');
  md.push('Status legend: `Nt`=timeouts, `Nh`=harness_error, `Ne`=error, `Nn`=passed=null. \'clean\' means all `done`.');
  md.push('');

  // Reject-criteria flags
  md.push('## R1–R6 calibration flags (per-cell)');
  md.push('');
  md.push('| test_id | tier | R1 floor/ceil | R2 timeout | R3 harn-err | R4 null-pass | R5 iter-storm | R6 sat | p90 iters | p90 elapsed (ms) |');
  md.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const t of tests) {
    for (const tier of tiers) {
      const { stats } = cells.get(`${t}|${tier}`);
      if (stats.total === 0) continue;
      const flags = [
        r1Trips(stats) ? '!' : '',
        r2Trips(stats) ? '!' : '',
        r3Trips(stats) ? '!' : '',
        r4Trips(stats) ? '!' : '',
        r5Trips(stats) ? '!' : '',
        r6Trips(stats) ? '!' : '',
      ];
      md.push(`| \`${t}\` | t${tier} | ${flags[0]} | ${flags[1]} | ${flags[2]} | ${flags[3]} | ${flags[4]} | ${flags[5]} | ${stats.p90Iters ?? '—'} | ${stats.p90ElapsedMs ?? '—'} |`);
    }
  }
  md.push('');
  md.push('R1: 0/N or N/N pass.  R2: ≥25% timeouts.  R3: any harness_error.  R4: >20% passed=null.  R5: p90 iters > 25.  R6: pass-rate > 85%.');
  md.push('');

  // Snapshots
  md.push('## Failing-cell snapshots');
  md.push('');
  md.push('One iterations.jsonl head+tail (60 lines each end) per failing cell, for analyze-agent to inspect failure modes without pulling the full trace.');
  md.push('');
  md.push('| test_id | tier | run_id | snapshot | terminal_status |');
  md.push('|---|---|---|---|---|');
  for (const t of tests) {
    for (const tier of tiers) {
      const { failingRow } = cells.get(`${t}|${tier}`);
      if (!failingRow) continue;
      const runId = failingRow.run_id;
      const snapPath = path.join(snapshotsDir, `${t}.t${tier}.jsonl`);
      const sourcePath = snapshotSession(opts.runtimeDir, runId, snapPath);
      const relSnap = path.relative(opts.outDir, snapPath);
      md.push(`| \`${t}\` | t${tier} | \`${runId}\` | [${relSnap}](${relSnap}) | ${failingRow.terminal_status} |`);
      if (sourcePath === null) {
        console.error(`  warn: no iterations.jsonl found for ${t} t${tier} run_id=${runId}`);
      }
    }
  }
  md.push('');
  md.push('## Tweak-allowed scope (for analyze-agent)');
  md.push('');
  md.push('**ALLOWED edits** (within `host/test/__tests__/tier-eval/` and `host/test/docs/difficulty-pack/`):');
  md.push('- Prompt-string clarifications, examples, or disambiguation');
  md.push('- Verifier assertion-message improvements');
  md.push('- Loosening over-strict spec clauses (e.g., specific sort order → "any order")');
  md.push('- Removing genuinely-ambiguous test cases (with rationale)');
  md.push('- Manifest field updates (e.g., `expected_tier_signature` flip after pilot evidence)');
  md.push('- Updates to `mutations.md`, `PLAN.md`, or `1.21-handsolve-log.md` to reflect the tweak');
  md.push('');
  md.push('**NOT ALLOWED** (require user sign-off):');
  md.push('- Cutting a test (write recommendation to `1.21-cycle-N-recommendations.md` instead)');
  md.push('- Adding new test files (no H5)');
  md.push('- Modifying `lib/*.js`, `lib/model_configs.json`, anything in `scripts/`, or `canonicals/`');
  md.push('- Raising `CLAW_TIMEOUT` (legitimate-looking shortcut that hides spec problems)');
  md.push('- Swapping picks from the runner-up bench (deeper-pass concern)');
  md.push('');
  md.push('## Reference');
  md.push('');
  md.push('- [PLAN.md](../../PLAN.md) — engineering plan (R1–R8 reject criteria, calibration protocol)');
  md.push('- [mutations.md](../../mutations.md) — per-pick mutation specs');
  md.push('- [1.21-handsolve-log.md](../../1.21-handsolve-log.md) — design intent + estimated hand-solve per test');
  md.push('- [memos/aider-calibration-note.md](../../memos/aider-calibration-note.md) — runner-up swap protocol (informational)');
  md.push('');

  const summaryPath = path.join(opts.outDir, 'summary.md');
  fs.writeFileSync(summaryPath, md.join('\n'));
  console.error(`explore-summarize: wrote ${summaryPath}`);
}

main();
