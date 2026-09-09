import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('CLI rejects piped input without starting R', () => {
  const child = spawnSync(process.execPath, ['dist/cli.js'], { input: '1+1\n', encoding: 'utf8', timeout: 5000 });
  assert.ifError(child.error);
  assert.equal(child.status, 1);
  assert.match(child.stderr, /interactive terminal is required/);
  assert.equal(child.stdout, '');
});

for (const [mode, status] of [['fail', 1]]) {
  test(`terminal lifecycle: ${mode}`, () => {
    const child = spawnSync(process.execPath, ['test/fixtures/lifecycle.mjs', mode], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(child.error);
    assert.equal(child.status, status, child.stderr);
    if (mode === 'fail') assert.match(child.stderr, /simulated initialization failure/);
  });
}
