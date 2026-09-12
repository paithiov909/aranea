import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, createConnection } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { runServer, runClient, socketPath } from '../dist/rpc.js';
import { WebRSession } from '../dist/webr-session.js';

function workspace(t) {
  const previous = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), 'aranea-rpc-'));
  process.chdir(directory);
  t.after(() => { process.chdir(previous); rmSync(directory, { recursive: true, force: true }); });
}

for (const partial of ['', '{"jsonrpc":"2.0"']) {
  test(`client rejects premature EOF with ${partial ? 'partial' : 'no'} response`, async t => {
    workspace(t);
    const server = createServer(socket => socket.once('data', () => socket.end(partial)));
    server.listen(socketPath());
    await once(server, 'listening');
    t.after(() => server.close());
    await assert.rejects(runClient('eval', { code: '1' }), /closed the connection before responding/);
  });
}

test('client accepts a complete response followed by EOF', async t => {
  workspace(t);
  const server = createServer(socket => socket.once('data', () => {
    socket.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { status: 'completed' } }) + '\n');
  }));
  server.listen(socketPath());
  await once(server, 'listening');
  t.after(() => server.close());
  assert.equal(await runClient('eval', { code: '1' }), 0);
});

test('bind failure closes initialized session and preserves the winning socket', async t => {
  workspace(t);
  const winner = createServer(socket => socket.end());
  t.after(() => winner.close());
  let closed = false;
  t.mock.method(WebRSession.prototype, 'start', async () => {
    winner.listen(socketPath());
    await once(winner, 'listening');
  });
  t.mock.method(WebRSession.prototype, 'close', () => { closed = true; });
  await assert.rejects(runServer(), { code: 'EADDRINUSE' });
  assert.equal(closed, true);
  const socket = createConnection(socketPath());
  await once(socket, 'connect');
  socket.destroy();
});

test('session errors reach the active request before its response', async t => {
  workspace(t);
  let emit;
  t.mock.method(WebRSession.prototype, 'start', async callback => { emit = callback; });
  t.mock.method(WebRSession.prototype, 'evaluateScript', async () => {
    emit({ type: 'error', error: new Error('Standard input is not supported in batch mode') });
    return 'failed';
  });
  t.mock.method(WebRSession.prototype, 'quit', async () => {});
  const running = runServer();
  // Wait for the mocked startup and listen callback without polling the socket.
  await new Promise(resolve => setImmediate(resolve));
  const socket = createConnection(socketPath());
  await once(socket, 'connect');
  let buffer = '';
  const messages = [];
  const response = new Promise(resolve => socket.on('data', chunk => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      messages.push(message);
      if (message.id === 1) resolve();
    }
  }));
  try {
    socket.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eval', params: { code: '' } }) + '\n');
    await response;
    assert.equal(messages[0].method, 'stderr');
    assert.match(messages[0].params.text, /Standard input is not supported/);
    assert.equal(messages[1].result.status, 'failed');
  } finally {
    socket.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'shutdown' }) + '\n');
    await running;
    socket.destroy();
  }
});
