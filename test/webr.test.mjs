import test from 'node:test';
import assert from 'node:assert/strict';
import { WebRBackend } from '../dist/webr.js';
import { mkdtemp, writeFile, readFile, rm, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('real WebR REPL: input, errors, interrupts and R shutdown', { timeout: 30000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'aranea 日本語 '));
  const backend = new WebRBackend(root);
  t.after(async () => { backend.close(); await rm(root, { recursive: true, force: true }); });
  await writeFile(join(root, '計算 script.R'), 'answer <- 42\n');
  await writeFile(join(root, '入力 data.csv'), 'value\n10\n20\n');
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
  assert.match(await line('getwd()'), /"\/workspace"/);
  assert.match(await line('source("計算 script.R"); answer'), /\[1\] 42/);
  assert.match(await line('d <- read.csv("入力 data.csv"); sum(d$value)'), /\[1\] 30/);
  await line('write.csv(d, "出力 data.csv", row.names=FALSE)');
  assert.equal(await readFile(join(root, '出力 data.csv'), 'utf8'), '"value"\n10\n20\n');
  assert.match(await line('source("missing.R")'), /cannot open/);
  assert.match(await line('6*7'), /\[1\] 42/);
  await t.test('NODEFS permission errors allow subsequent evaluation', {
    skip: process.platform === 'win32' || process.getuid?.() === 0,
  }, async () => {
    const restricted = join(root, 'restricted');
    await mkdir(restricted, { mode: 0o555 });
    try {
      assert.match(await line('write.csv(d, "restricted/output.csv")'), /Permission denied/);
      assert.match(await line('6*7'), /\[1\] 42/);
    } finally {
      await chmod(restricted, 0o755);
    }
  });
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
