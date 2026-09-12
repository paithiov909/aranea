import test from 'node:test';
import assert from 'node:assert/strict';
import { WebRSession } from '../dist/webr-session.js';

test('script evaluation does not close the WebR session', { timeout: 30000 }, async () => {
  const events = [];
  const session = new WebRSession(undefined, false);
  try {
    await session.start(event => events.push(event));
    assert.equal(await session.evaluateScript('answer <- 42'), 'completed');
    assert.equal(events.some(event => event.type === 'closed'), false);
  } finally {
    session.close();
  }
});

test('each evaluation delivers partial stdout and stderr before returning', { timeout: 30000 }, async () => {
  const events = [];
  const session = new WebRSession(undefined, false);
  try {
    await session.start(event => events.push(event));
    events.length = 0;
    for (const code of ['cat("first"); cat("diagnostic", file=stderr())', 'cat("second")', 'cat("before error"); stop("FAILED")']) {
      const start = events.length;
      const status = await session.evaluateScript(code);
      const output = events.slice(start);
      assert.equal(status, code.includes('stop') ? 'failed' : 'completed');
      assert.deepEqual(output.filter(e => e.type === 'stdout').map(e => e.text), [code.includes('first') ? 'first' : code.includes('second') ? 'second' : 'before error']);
      if (code.includes('diagnostic')) assert.deepEqual(output.filter(e => e.type === 'stderr').map(e => e.text), ['diagnostic']);
    }
  } finally {
    session.close();
  }
});
