import test from 'node:test';
import assert from 'node:assert/strict';
import { InputQueue } from '../dist/terminal.js';

test('paste sends exactly one line per prompt and preserves empty answers', () => {
  const sent = [];
  const queue = new InputQueue(line => sent.push(line));
  queue.line('x <- readline()'); queue.line(''); queue.line('x');
  assert.deepEqual(sent, []);
  queue.prompt(); assert.deepEqual(sent, ['x <- readline()']);
  queue.prompt(); assert.deepEqual(sent, ['x <- readline()', '']);
  queue.clear(); queue.prompt();
  assert.equal(sent.length, 2);
  queue.line('1+1'); assert.equal(sent.at(-1), '1+1');
});
