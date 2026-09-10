import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('tarball installs without development dependencies and runs through npx', { timeout: 240000 }, t => {
  const root = mkdtempSync(join(tmpdir(), 'aranea package '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const consumer = join(root, 'consumer');
  mkdirSync(consumer);
  const run = (command, args, cwd = consumer, timeout = 30000) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    return result.stdout;
  };
  const output = run('npm', ['pack', '--json', '--pack-destination', root], resolve('.'));
  // npm lifecycle output may precede the JSON array.
  const [pack] = JSON.parse(output.slice(output.indexOf('[\n')));
  assert.ok(pack.files.some(file => file.path === 'dist/cli.js'));
  assert.ok(pack.files.every(file => /^(dist\/|package.json$|README.md$|LICENSE$)/.test(file.path)));
  writeFileSync(join(consumer, 'package.json'), '{"private":true}');
  run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', join(root, pack.filename)], consumer, 120000);
  assert.equal(existsSync(join(consumer, 'node_modules', 'typescript')), false);
  assert.equal(existsSync(join(consumer, 'node_modules', 'aranea', 'src')), false);
  assert.equal(run('npx', ['--no-install', 'aranea', '-e', 'print("hello!")']), '[1] "hello!"\n');
  writeFileSync(join(consumer, 'script.R'), '6*7');
  assert.equal(run('npx', ['--no-install', 'aranea', 'script.R']), '[1] 42\n');
  if (process.platform === 'linux') {
    run('python3', [resolve('test/package-pty.py')]);
  }
});
