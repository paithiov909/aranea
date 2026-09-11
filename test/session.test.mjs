import test from 'node:test';
import assert from 'node:assert/strict';
import { WebRSession } from '../dist/webr-session.js';

test('script evaluation does not close the WebR session', { timeout: 30000 }, async t => {
  const events = [];
  const session = new WebRSession(undefined, false);
  t.after(() => session.close());
  await session.start(event => events.push(event));

  assert.equal(await session.evaluateScript('answer <- 42'), 'completed');
  assert.equal(events.some(event => event.type === 'closed'), false);

  await session.quit();
  const deadline = Date.now() + 5000;
  while (!events.some(event => event.type === 'closed')) {
    if (Date.now() > deadline) throw new Error(`Timeout: ${JSON.stringify(events)}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(events.find(event => event.type === 'closed')?.code, 0);
});
