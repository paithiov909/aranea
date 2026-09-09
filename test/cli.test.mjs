import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('CLI rejects piped input without starting R', () => {
  const child = spawnSync(process.execPath, ['dist/cli.js'], { input: '1+1\n', encoding: 'utf8', timeout: 5000 });
  assert.ifError(child.error);
  assert.equal(child.status, 1);
  assert.match(child.stderr, /interactive terminal is required/);
  assert.equal(child.stdout, '');
});

test('NODEFS startup failures explain the path and exit without a prompt', { timeout: 30000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'aranea failure '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'file');
  writeFileSync(file, 'not a directory');
  for (const [path, reason] of [[join(root, 'missing'), /ENOENT/], [file, /Not a directory/]]) {
    // Keep stdin open so EOF does not cancel asynchronous initialization.
    const child = spawn(process.execPath, ['test/fixtures/nodefs-failure.mjs', path]);
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    try {
      const status = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      assert.equal(status, 1, stderr);
      assert.ok(stderr.includes(path), stderr);
      assert.match(stderr, /Cannot mount host directory/);
      assert.match(stderr, reason);
      assert.doesNotMatch(stdout, /> /);
    } finally {
      clearTimeout(timer);
      child.stdin.destroy();
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
});

for (const [mode, status] of [['fail', 1]]) {
  test(`terminal lifecycle: ${mode}`, () => {
    const child = spawnSync(process.execPath, ['test/fixtures/lifecycle.mjs', mode], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(child.error);
    assert.equal(child.status, status, child.stderr);
    if (mode === 'fail') assert.match(child.stderr, /simulated initialization failure/);
  });
}
