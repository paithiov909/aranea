import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from '../dist/args.js';

const cli = resolve('dist/cli.js');
function run(args, cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 15000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

test('argument parser accepts only the supported invocation shapes', () => {
  assert.deepEqual(parseArgs([]), { mode: 'repl' });
  assert.deepEqual(parseArgs(['-e', '']), { mode: 'expression', code: '' });
  assert.deepEqual(parseArgs(['--', '-script.R']), { mode: 'file', path: '-script.R' });
  for (const args of [['-e'], ['--'], ['--unknown'], ['a.R', 'arg'], ['-e', '1', 'a.R'], ['-e', '1', '-e', '2'], ['--help', 'a.R']]) {
    assert.throws(() => parseArgs(args), /Invalid arguments/);
    const result = run(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Usage/);
  }
  assert.match(run(['--help']).stdout, /Usage/);
  assert.equal(run(['--version']).stdout.trim(), JSON.parse(readFileSync('package.json')).version);
});

test('batch expressions print visible values, stream diagnostics and run .Last', () => {
  const result = run(['-e', 'q <- identity\nx <- 40\nx + 2\ninteractive()\nmessage("MESSAGE")\nwarning("WARNING")\ncat("tail")\n.Last <- function() cat("LAST")']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '[1] 42\n[1] FALSE\ntailLAST\n');
  assert.match(result.stderr, /MESSAGE/);
  assert.match(result.stderr, /WARNING/);
  const empty = run(['-e', '']);
  assert.equal(empty.status, 0, empty.stderr);
  assert.equal(empty.stdout, '');
});

test('file execution supports host paths and keeps the invocation working directory', t => {
  const root = mkdtempSync(join(tmpdir(), 'aranea batch 日本語 '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  const file = join(root, 'scripts', '計算 script.R');
  writeFileSync(file, '#!/usr/bin/env aranea\nd <- read.csv("input.csv")\nwrite.csv(d, "output.csv", row.names=FALSE)\nsum(d$value)\ngetwd()\n');
  writeFileSync(join(root, 'input.csv'), 'value\n10\n20\n');
  for (const path of [file, 'scripts/計算 script.R']) {
    const result = run([path], root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '[1] 30\n[1] "/workspace"\n');
    assert.equal(readFileSync(join(root, 'output.csv'), 'utf8'), '"value"\n10\n20\n');
  }
  writeFileSync(join(root, '-script.R'), 'print("dash")');
  assert.equal(run(['--', '-script.R'], root).stdout, '[1] "dash"\n');
  for (const path of ['missing.R', 'scripts']) {
    const result = run([path], root);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /aranea:/);
  }
});

test('batch failures stop evaluation; explicit q preserves status and partial output', t => {
  const root = mkdtempSync(join(tmpdir(), 'aranea error '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = run(['-e', 'q <- identity; cat("before"); stop("FAILED"); writeLines("bad", "after")'], root);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, 'before\n');
  assert.match(result.stderr, /FAILED/);
  assert.equal(existsSync(join(root, 'after')), false);
  assert.equal(run(['-e', 'if ('], root).status, 1);
  const quit = run(['-e', '.Last <- function() cat("LAST"); cat("tail"); q(save="no", status=7); print("after")'], root);
  assert.equal(quit.status, 7, quit.stderr);
  assert.equal(quit.stdout, 'tailLAST\n');
});

test('batch input does not wait for host stdin', () => {
  const result = run(['-e', 'readLines(stdin(), n=1)']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'character(0)\n');
  const unsupported = run(['-e', 'webr::eval_js("Module.webr.readConsole()")']);
  assert.equal(unsupported.status, 1, unsupported.stderr);
  assert.match(unsupported.stderr, /Standard input is not supported/);
  const readline = run(['-e', 'readline("name: ")']);
  assert.equal(readline.status, 0, readline.stderr);
  assert.equal(readline.stdout, 'name: \n[1] ""\n');
});

for (const [signal, status] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`batch ${signal} terminates running evaluation after streaming output`, { timeout: 20000 }, async () => {
    const child = spawn(process.execPath, [cli, '-e', 'cat("READY\\n"); repeat {}']);
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.includes('READY')) child.kill(signal);
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    try {
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      assert.match(stdout, /READY/);
      assert.equal(code, status, stderr);
    } finally {
      clearTimeout(timer);
      child.stdin.destroy();
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  });
}
