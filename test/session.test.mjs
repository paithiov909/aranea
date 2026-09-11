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
