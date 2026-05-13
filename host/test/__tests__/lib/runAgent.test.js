import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runAgent } from '../../lib/runAgent.js';

function makeT() {
  return { signal: new AbortController().signal, diagnostic: () => {} };
}

function makeRunner(calls) {
  return async (opts) => {
    calls.push(opts);
    return { code: 0, stdout: '', stderr: '', elapsedMs: 0, runDir: '/tmp/none' };
  };
}

const BASE = {
  prompt: 'p',
  testId: 'unit-runAgent',
  seedFiles: {},
  preconditionMustFail: null,
  postScript: null,
};

describe('runAgent input validation', () => {
  it('throws when prompt missing', async () => {
    await assert.rejects(
      () => runAgent({ ...BASE, prompt: '', t: makeT(), clawTimeoutMs: 60_000, runner: makeRunner([]) }),
      /prompt required/,
    );
  });

  it('throws when testId missing', async () => {
    await assert.rejects(
      () => runAgent({ ...BASE, testId: '', t: makeT(), clawTimeoutMs: 60_000, runner: makeRunner([]) }),
      /testId required/,
    );
  });

  it('throws when t lacks diagnostic or signal', async () => {
    await assert.rejects(
      () => runAgent({ ...BASE, t: {}, clawTimeoutMs: 60_000, runner: makeRunner([]) }),
      /TestContext/,
    );
  });
});

describe('runAgent slack derivation', () => {
  // Defaults: precondition 5000, post 5000, flush 3000.
  // Slack table by (preconditionMustFail, postScript) presence:
  //   (T, T) = 13_000   (T, F) = 8_000   (F, T) = 8_000   (F, F) = 3_000
  const CASES = [
    { pre: 'pre.js', post: 'post.js', expectedSlack: 13_000 },
    { pre: 'pre.js', post: null,      expectedSlack: 8_000 },
    { pre: null,     post: 'post.js', expectedSlack: 8_000 },
    { pre: null,     post: null,      expectedSlack: 3_000 },
  ];

  for (const { pre, post, expectedSlack } of CASES) {
    it(`throws when clawTimeoutMs <= slack (pre=${!!pre}, post=${!!post})`, async () => {
      await assert.rejects(
        () => runAgent({
          ...BASE,
          preconditionMustFail: pre,
          postScript: post,
          clawTimeoutMs: expectedSlack,
          t: makeT(),
          runner: makeRunner([]),
        }),
        new RegExp(
          `slack \\(${expectedSlack}ms = precondition ${pre ? 5000 : 0} ` +
          `\\+ post ${post ? 5000 : 0} \\+ flush 3000\\)`,
        ),
      );
    });
  }

  it('does not throw when clawTimeoutMs = slack + 1', async () => {
    const calls = [];
    await assert.doesNotReject(() => runAgent({
      ...BASE,
      clawTimeoutMs: 3_001,
      t: makeT(),
      runner: makeRunner(calls),
    }));
    assert.equal(calls[0].timeoutMs, 1);
  });

  it('preconditionTimeoutMs override flows into slack', async () => {
    await assert.rejects(
      () => runAgent({
        ...BASE,
        preconditionMustFail: 'pre.js',
        preconditionTimeoutMs: 20_000,
        clawTimeoutMs: 23_000, // = 20000 + 3000 flush
        t: makeT(),
        runner: makeRunner([]),
      }),
      /precondition 20000.*flush 3000/,
    );
  });

  it('postScriptTimeoutMs override flows into slack', async () => {
    await assert.rejects(
      () => runAgent({
        ...BASE,
        postScript: 'post.js',
        postScriptTimeoutMs: 15_000,
        clawTimeoutMs: 18_000, // = 15000 + 3000 flush
        t: makeT(),
        runner: makeRunner([]),
      }),
      /post 15000.*flush 3000/,
    );
  });

  it('throws when clawTimeoutMs is missing/non-numeric', async () => {
    await assert.rejects(
      () => runAgent({ ...BASE, t: makeT(), runner: makeRunner([]) }),
      /clawTimeoutMs/,
    );
  });
});

describe('runAgent RUNAGENT_FLUSH_MARGIN_MS override', () => {
  it('honors env override at module load', async () => {
    // Module reads FLUSH_MARGIN_MS at top level; bust ESM cache with a query
    // suffix so a fresh module instance reads the overridden env var.
    const prev = process.env.RUNAGENT_FLUSH_MARGIN_MS;
    process.env.RUNAGENT_FLUSH_MARGIN_MS = '7000';
    try {
      const mod = await import('../../lib/runAgent.js?flush=7000');
      await assert.rejects(
        () => mod.runAgent({
          ...BASE,
          clawTimeoutMs: 7_000,
          t: makeT(),
          runner: makeRunner([]),
        }),
        /flush 7000/,
      );
    } finally {
      if (prev === undefined) delete process.env.RUNAGENT_FLUSH_MARGIN_MS;
      else process.env.RUNAGENT_FLUSH_MARGIN_MS = prev;
    }
  });
});

describe('runAgent runner invocation', () => {
  it('passes prompt, signal, and shrunk timeoutMs to runner', async () => {
    const calls = [];
    const t = makeT();
    await runAgent({
      ...BASE,
      prompt: 'hello',
      clawTimeoutMs: 60_000, // slack = 3000 → runner gets 57_000
      t,
      runner: makeRunner(calls),
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prompt, 'hello');
    assert.equal(calls[0].signal, t.signal);
    assert.equal(calls[0].timeoutMs, 57_000);
  });
});
