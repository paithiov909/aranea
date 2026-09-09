import test from 'node:test';
import assert from 'node:assert/strict';
import { WebRBackend } from '../dist/webr.js';

test('real WebR REPL: input, errors, interrupts and R shutdown', { timeout: 30000 }, async t => {
  const backend = new WebRBackend();
  t.after(() => backend.close());
  const events = [];
  let wake;
  const wait = async (predicate) => {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`Timeout: ${JSON.stringify(events)}`);
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 50);
        wake = () => { clearTimeout(timer); resolve(); };
      });
    }
  };
  await backend.start(event => { events.push(event); wake?.(); });
  await wait(() => events.some(e => e.type === 'prompt'));
  const line = async (input) => {
    events.length = 0;
    backend.sendLine(input);
    await wait(() => events.some(e => e.type === 'prompt' || e.type === 'closed'));
    assert.equal(events.some(e => e.type === 'error'), false);
    return events.filter(e => e.type === 'stdout' || e.type === 'stderr').map(e => e.text).join('\n');
  };
  assert.match(await line('1+1'), /\[1\] 2/);
  await line('x <- 41');
  assert.match(await line('x+1'), /42/);
  assert.match(await line('stop("intentional")'), /intentional/);
  assert.match(await line('cat("no newline")'), /no newline/);
  await line('f <- function(x) {');
  assert.equal(events.at(-1).text, '+ ');
  await line('x+1'); await line('}');
  assert.match(await line('f(4)'), /5/);
  await line('x <- readline("name: "); x');
  assert.equal(events.at(-1).text, 'name: ');
  assert.match(await line('Alice'), /"Alice"/);
  await line('x <- readline("empty: "); x');
  assert.match(await line(''), /""/);
  for (const input of ['repeat {}', 'f <- function(x) {', 'readline("cancel: ")', '']) {
    events.length = 0;
    backend.sendLine(input);
    if (input !== 'repeat {}') await wait(() => events.some(e => e.type === 'prompt'));
    else await new Promise(resolve => setTimeout(resolve, 100));
    events.length = 0;
    backend.interrupt();
    await wait(() => events.some(e => e.type === 'prompt'));
    assert.match(await line('6*7'), /42/);
  }
  events.length = 0;
  backend.sendLine('repeat {}');
  backend.interrupt();
  backend.interrupt();
  await wait(() => events.some(e => e.type === 'prompt'));
  assert.match(await line('6*7'), /42/);
  await line('.Last <- function() cat("LAST-RAN\\n")');
  assert.match(await line('q()'), /LAST-RAN/);
  assert.equal(events.at(-1).type, 'closed');
});
