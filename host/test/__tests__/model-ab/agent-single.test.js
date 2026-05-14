// Agent single-file: minimum-viable agentic loop. One tool call, one file, done.
// If this fails, the model isn't usable for any agent work through this stack.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { runClaw } from '../../lib/claw.js';
import * as workspace from '../../lib/workspace.js';
import { clawModel, MODEL_LABEL } from '../../lib/model.js';

const PROMPT  = "create hello.py with one line: print('hello')";
// runClaw's inner timer must fire before node:test's outer timeout so its structured timeout result lands first — see claw.js:90-97.
const CLAW_TIMEOUT = 300_000;

describe(`agent: single-file write (model=${MODEL_LABEL}, bridge=${clawModel})`, () => {
  beforeEach(() => workspace.reset());

  it('claw creates hello.py with the requested content', { timeout: CLAW_TIMEOUT + 20_000 }, async ({ signal }) => {
    const r = await runClaw({ prompt: PROMPT, model: clawModel, signal, timeoutMs: CLAW_TIMEOUT });

    console.log(`\n=== agent-single (${MODEL_LABEL}) ===`);
    console.log(`  exit=${r.code} elapsed=${r.elapsedMs}ms files=${JSON.stringify(workspace.list())}`);
    if (r.code !== 0) console.log(`  stderr (tail):\n${r.stderr.slice(-1500)}`);

    assert.equal(r.code, 0);
    assert.equal(workspace.exists('hello.py'), true);
    assert.match(workspace.read('hello.py'), /print\(\s*['"]hello['"]\s*\)/);
  });
});
