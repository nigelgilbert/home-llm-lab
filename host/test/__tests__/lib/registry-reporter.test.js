// Synthetic event-stream tests for ../../lib/registry-reporter.js.
//
// Why: the reporter is the only writer of assertion_result.json for migrated
// tier-eval tests, and the row-loss regression caught mid-PR (PR #5, fixed in
// af0cf87) showed the failure mode is silent — no rows, no thrown error.
// These tests pin the contract end-to-end: feed in synthetic node:test events,
// read the resulting sidecar from a tmpdir, assert contents and gating.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import registryReporter from '../../lib/registry-reporter.js';

const tmpdirs = [];
function makeRunDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-rep-'));
  tmpdirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true });
});

// node:test buffers diagnostics and emits them *after* the corresponding
// test:pass / test:fail event (see registry-reporter.js header comment), so
// synthetic streams emit pass/fail first, then the four diagnostics.
const loc = (file, line, col) => ({ file, line, column: col });
const passEv  = (l, name) => ({ type: 'test:pass',  data: { ...l, name, details: { type: 'test' }  } });
const failEv  = (l, name) => ({ type: 'test:fail',  data: { ...l, name, details: { type: 'test' }  } });
const suiteEv = (l, name) => ({ type: 'test:pass',  data: { ...l, name, details: { type: 'suite' } } });
const diag    = (l, msg)  => ({ type: 'test:diagnostic', data: { ...l, message: msg } });

async function* source(events) {
  for (const ev of events) yield ev;
}

async function drain(events) {
  // Silence the per-test header so npm test's spec output stays clean.
  const orig = console.log;
  console.log = () => {};
  try {
    for await (const _ of registryReporter(source(events))) { /* reporter has no yields */ }
  } finally {
    console.log = orig;
  }
}

function readSidecar(runDir) {
  const p = path.join(runDir, 'assertion_result.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('registryReporter (synthetic event stream)', () => {
  it('writes sidecar with passed=true on test:pass + full diagnostic set', async () => {
    const runDir = makeRunDir();
    const l = loc('/fake/file.test.js', 10, 3);
    const postStderr = 'x'.repeat(900); // longer than POST_STDERR_TAIL=800
    await drain([
      passEv(l, 'happy-pass'),
      diag(l, `runDir=${runDir}`),
      diag(l, 'test_id=happy-pass'),
      diag(l, `agent_result=${JSON.stringify({ code: 0, elapsedMs: 12, files: ['a.js'] })}`),
      diag(l, `post_result=${JSON.stringify({ script: 'post.js', status: 0, stderrTrim: '', stderrTail: postStderr })}`),
    ]);

    const sc = readSidecar(runDir);
    assert.equal(sc.passed, true);
    assert.equal(sc.claw_exit, 0);
    assert.equal(sc.post_status, 0);
    assert.equal(sc.post_stderr_tail, postStderr.slice(-800));
    assert.equal(typeof sc.written_at_ms, 'number');
  });

  it('writes sidecar with passed=false on test:fail (passed never null)', async () => {
    const runDir = makeRunDir();
    const l = loc('/fake/file.test.js', 20, 3);
    await drain([
      failEv(l, 'sad-fail'),
      diag(l, `runDir=${runDir}`),
      diag(l, 'test_id=sad-fail'),
      diag(l, `agent_result=${JSON.stringify({ code: 1, elapsedMs: 7, files: [], stderrTail: 'boom' })}`),
      diag(l, `post_result=${JSON.stringify({ script: 'post.js', status: 2, stderrTrim: '', stderrTail: 'eek' })}`),
    ]);

    const sc = readSidecar(runDir);
    assert.equal(sc.passed, false);
    assert.equal(sc.claw_exit, 1);
    assert.equal(sc.post_status, 2);
    assert.equal(sc.post_stderr_tail, 'eek');
  });

  it('omits post_status / post_stderr_tail when no post_result diagnostic was emitted', async () => {
    const runDir = makeRunDir();
    const l = loc('/fake/file.test.js', 30, 3);
    await drain([
      passEv(l, 'no-post'),
      diag(l, `runDir=${runDir}`),
      diag(l, 'test_id=no-post'),
      diag(l, `agent_result=${JSON.stringify({ code: 0, elapsedMs: 1, files: [] })}`),
    ]);

    const sc = readSidecar(runDir);
    assert.equal(sc.passed, true);
    assert.equal(sc.claw_exit, 0);
    assert.equal(sc.post_status, null);
    assert.equal(sc.post_stderr_tail, null);
  });

  it('writes no sidecar when the runDir diagnostic is absent', async () => {
    const runDir = makeRunDir();
    const l = loc('/fake/family-c.test.js', 40, 3);
    await drain([
      passEv(l, 'family-c-shape'),
      diag(l, 'test_id=family-c-shape'),
      diag(l, `agent_result=${JSON.stringify({ code: 0, elapsedMs: 1, files: [] })}`),
    ]);

    assert.equal(fs.existsSync(path.join(runDir, 'assertion_result.json')), false);
  });

  it('ignores describe/suite-level pass events (details.type !== "test")', async () => {
    const runDir = makeRunDir();
    const l = loc('/fake/file.test.js', 50, 1);
    await drain([
      suiteEv(l, 'a-suite'),
      diag(l, `runDir=${runDir}`),
      diag(l, 'test_id=a-suite'),
      diag(l, `agent_result=${JSON.stringify({ code: 0, elapsedMs: 1, files: [] })}`),
    ]);

    assert.equal(fs.existsSync(path.join(runDir, 'assertion_result.json')), false);
  });

  it('flushes per-test on runAgent_done sentinel (sidecar A lands before B drains)', async () => {
    const runDirA = makeRunDir();
    const runDirB = makeRunDir();
    const la = loc('/fake/file.test.js', 80, 3);
    const lb = loc('/fake/file.test.js', 90, 3);

    let sidecarAExistedMidStream = false;
    const events = [
      passEv(la, 'test-a'),
      diag(la, `runDir=${runDirA}`),
      diag(la, 'test_id=test-a'),
      diag(la, `agent_result=${JSON.stringify({ code: 0, elapsedMs: 1, files: [] })}`),
      diag(la, 'runAgent_done=1'),
      passEv(lb, 'test-b'),
      diag(lb, `runDir=${runDirB}`),
      diag(lb, 'test_id=test-b'),
      diag(lb, `agent_result=${JSON.stringify({ code: 0, elapsedMs: 1, files: [] })}`),
      diag(lb, 'runAgent_done=1'),
    ];

    // Source observes sidecar A's existence right after the reporter
    // processes A's runAgent_done — i.e. before B's events have drained.
    async function* checkingSource() {
      for (const ev of events) {
        yield ev;
        if (ev.type === 'test:diagnostic'
            && ev.data.line === la.line
            && ev.data.message === 'runAgent_done=1') {
          sidecarAExistedMidStream = fs.existsSync(path.join(runDirA, 'assertion_result.json'));
        }
      }
    }

    const orig = console.log;
    console.log = () => {};
    try {
      for await (const _ of registryReporter(checkingSource())) { /* */ }
    } finally {
      console.log = orig;
    }

    assert.equal(sidecarAExistedMidStream, true, 'sidecar A must exist after its runAgent_done, before B drains');
    assert.equal(fs.existsSync(path.join(runDirB, 'assertion_result.json')), true);
  });

  it('distinguishes two tests by file:line:column and writes the correct sidecar to each', async () => {
    const runDirA = makeRunDir();
    const runDirB = makeRunDir();
    const la = loc('/fake/file.test.js', 60, 3);
    const lb = loc('/fake/file.test.js', 70, 3);
    await drain([
      passEv(la, 'test-a'),
      failEv(lb, 'test-b'),
      diag(la, `runDir=${runDirA}`),
      diag(lb, `runDir=${runDirB}`),
      diag(la, 'test_id=test-a'),
      diag(lb, 'test_id=test-b'),
      diag(la, `agent_result=${JSON.stringify({ code: 0, elapsedMs: 1, files: [] })}`),
      diag(lb, `agent_result=${JSON.stringify({ code: 1, elapsedMs: 1, files: [], stderrTail: 'x' })}`),
    ]);

    const a = readSidecar(runDirA);
    const b = readSidecar(runDirB);
    assert.equal(a.passed, true);
    assert.equal(a.claw_exit, 0);
    assert.equal(b.passed, false);
    assert.equal(b.claw_exit, 1);
  });
});
