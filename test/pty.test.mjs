import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('Linux PTY: paste, Ctrl+C, q(), npm start and Ctrl+D', { timeout: 60000, skip: process.platform !== 'linux' }, () => {
  const child = spawnSync('python3', ['test/terminal_smoke.py', process.execPath], { encoding: 'utf8', timeout: 55000 });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr + child.stdout);
});
