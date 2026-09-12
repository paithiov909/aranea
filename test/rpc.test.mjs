import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, createConnection } from 'node:net';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { runServer, runClient, socketPath } from '../dist/rpc.js';
import { WebRSession } from '../dist/webr-session.js';

const cli = resolve('dist/cli.js');
const execute = promisify(execFile);

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
  t.mock.method(WebRSession.prototype, 'quit', async () => { emit({ type: 'closed', code: 0 }); });
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

test('shutdown drains accepted evaluations and waits for R closure before replying', { timeout: 10000 }, async t => {
  workspace(t);
  let emit, finishEvaluation, finishQuit, startedEvaluation, startedQuit;
  const evaluationStarted = new Promise(resolve => { startedEvaluation = resolve; });
  const quitStarted = new Promise(resolve => { startedQuit = resolve; });
  const evaluationGate = new Promise(resolve => { finishEvaluation = resolve; });
  const quitGate = new Promise(resolve => { finishQuit = resolve; });
  const evaluated = [];
  t.mock.method(WebRSession.prototype, 'start', async callback => { emit = callback; });
  t.mock.method(WebRSession.prototype, 'evaluateScript', async code => {
    evaluated.push(code);
    startedEvaluation();
    await evaluationGate;
    return 'completed';
  });
  const quit = t.mock.method(WebRSession.prototype, 'quit', async () => {
    startedQuit();
    await quitGate;
    // quit() returning alone does not guarantee the output consumer is closed.
  });
  const running = runServer();
  await new Promise(resolve => setImmediate(resolve));
  const socket = createConnection(socketPath());
  await once(socket, 'connect');
  const messages = new Map(), waiters = new Map();
  let buffer = '';
  socket.on('data', chunk => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      messages.set(message.id, message);
      waiters.get(message.id)?.(message);
    }
  });
  const receive = id => messages.has(id) ? Promise.resolve(messages.get(id)) : new Promise(resolve => waiters.set(id, resolve));
  const request = (id, method, code) => socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: { code } }) + '\n');
  try {
    request(1, 'eval', 'first');
    await evaluationStarted;
    request(2, 'eval', 'second');
    request(3, 'shutdown');
    request(4, 'shutdown');
    request(5, 'eval', 'late');
    assert.match((await receive(5)).error.message, /shutting down/);
    assert.equal(messages.has(3), false);
    assert.equal(quit.mock.callCount(), 0);
    finishEvaluation();
    await quitStarted;
    assert.deepEqual(evaluated, ['first', 'second']);
    finishQuit();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages.has(3), false);
    emit({ type: 'closed', code: 0 });
    assert.equal((await receive(3)).result.status, 'shutting_down');
    assert.equal((await receive(4)).result.status, 'shutting_down');
    assert.equal(quit.mock.callCount(), 1);
    // Rebinding immediately after the response must succeed.
    const replacement = createServer();
    replacement.listen(socketPath());
    await once(replacement, 'listening');
    await running;
    await new Promise(resolve => replacement.close(resolve));
  } finally {
    finishEvaluation();
    finishQuit();
    emit({ type: 'closed', code: 0 });
    socket.destroy();
    await running;
  }
});

test('real shutdown waits for .Last and permits immediate server restart', { timeout: 30000 }, async t => {
  workspace(t);
  const start = async () => {
    const child = spawn(process.execPath, [cli, 'serve']);
    const exited = once(child, 'close');
    t.after(async () => { if (child.exitCode === null) child.kill('SIGKILL'); await exited; });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    await new Promise((resolve, reject) => {
      let output = '';
      child.stdout.on('data', chunk => {
        output += chunk;
        if (output.includes('server ready')) resolve();
      });
      child.once('error', reject);
      child.once('close', code => reject(new Error(`Server exited ${code}: ${stderr}`)));
    });
    return { exited };
  };
  const { exited: firstExit } = await start();
  await execute(process.execPath, [cli, 'eval', '.Last <- function() { Sys.sleep(0.3); writeLines("done", "last-finished") }'], { timeout: 10000 });
  await execute(process.execPath, [cli, 'shutdown'], { timeout: 10000 });
  assert.equal(readFileSync('last-finished', 'utf8'), 'done\n');
  const { exited: secondExit } = await start();
  assert.equal((await firstExit)[0], 0);
  await execute(process.execPath, [cli, 'shutdown'], { timeout: 10000 });
  assert.equal((await secondExit)[0], 0);
});
