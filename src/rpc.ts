import { createHash } from 'node:crypto';
import { createConnection, createServer, type Socket } from 'node:net';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebRSession } from './webr-session.js';

export function socketPath(cwd = process.cwd()): string {
  return `/tmp/aranea-${createHash('sha256').update(resolve(cwd)).digest('hex').slice(0, 24)}.sock`;
}
type Request = { jsonrpc: '2.0'; id?: string|number|null; method: string; params?: unknown };
const response = (id: Request['id'], value: unknown) => ({ jsonrpc: '2.0', id, result: value });
const error = (id: Request['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
function send(socket: Socket, value: unknown): void { if (!socket.destroyed) socket.write(JSON.stringify(value) + '\n', () => {}); }

export async function runServer(): Promise<number> {
  if (process.platform === 'win32') throw new Error('serve is supported on Linux only');
  const path = socketPath();
  if (existsSync(path)) {
    const live = await new Promise<boolean>(resolve => { const s = createConnection(path, () => { s.destroy(); resolve(true); }); s.once('error', () => resolve(false)); });
    if (live) throw new Error('a server is already running for this workspace');
    unlinkSync(path);
  }
  const session = new WebRSession(undefined, false);
  let server: ReturnType<typeof createServer>;
  let shutting = false, active: ((v: unknown) => void) | undefined;
  const clients = new Set<Socket>();
  const cleanup = async () => { if (shutting) return; shutting = true; try { await session.quit(); } catch { session.close(); } for (const c of clients) c.destroy(); try { unlinkSync(path); } catch {} };
  server = createServer(socket => {
    clients.add(socket); let buffer = '';
    socket.on('close', () => clients.delete(socket));
    socket.on('data', chunk => { buffer += chunk.toString(); let i; while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); void dispatch(line, socket); } });
  });
  let queue: Promise<void> = Promise.resolve();
  const dispatch = async (line: string, socket: Socket) => {
    let req: Request;
    try { req = JSON.parse(line); } catch { send(socket, error(null, -32700, 'Parse error')); return; }
    if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') { send(socket, error(req?.id ?? null, -32600, 'Invalid Request')); return; }
    if (req.method === 'eval') {
      if (!req.params || typeof (req.params as {code?: unknown}).code !== 'string') { send(socket, error(req.id, -32602, 'Invalid params')); return; }
      const task = queue.then(async () => { active = v => send(socket, v); try { const status = await session.evaluateScript((req.params as {code:string}).code); send(socket, response(req.id, { status })); if (status === 'exited') void cleanup(); } finally { active = undefined; } });
      queue = task.catch(() => {});
      return void task.catch(e => send(socket, error(req.id, -32603, String(e))));
    }
    if (req.method === 'shutdown') { send(socket, response(req.id, { status: 'shutting_down' })); setImmediate(() => void cleanup().finally(() => server.close())); return; }
    send(socket, error(req.id, -32601, 'Method not found'));
  };
  try {
    await session.start(event => { if (event.type === 'stdout' || event.type === 'stderr') active?.({ jsonrpc: '2.0', method: event.type, params: { text: event.text + '\n' } }); if (event.type === 'error') active?.({ jsonrpc: '2.0', method: 'stderr', params: { text: `aranea: ${event.error instanceof Error ? event.error.message : String(event.error)}\n` } }); if (event.type === 'closed') void cleanup().finally(() => server.close()); });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  } catch (cause) {
    // This process may have lost a bind race; leave the winner's socket alone.
    shutting = true;
    session.close();
    for (const client of clients) client.destroy();
    server.close();
    throw cause;
  }
  process.stdout.write('aranea: server ready\n');
  await new Promise<void>(resolve => { process.once('SIGINT', () => void cleanup().finally(resolve)); process.once('SIGTERM', () => void cleanup().finally(resolve)); server.once('close', resolve); });
  return 0;
}
export async function runClient(method: 'eval'|'shutdown', params?: object): Promise<number> {
  const socket = await new Promise<Socket>((resolve, reject) => { const s = createConnection(socketPath()); s.once('connect', () => resolve(s)); s.once('error', reject); });
  return await new Promise<number>((resolve, reject) => {
    let buffer = '';
    let settled = false;
    const fail = (cause: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(cause);
    };
    const disconnected = () => fail(new Error('Server closed the connection before responding'));
    socket.once('error', fail);
    socket.once('end', disconnected);
    socket.once('close', disconnected);
    socket.on('data', chunk => {
      buffer += chunk;
      let i;
      while (!settled && (i = buffer.indexOf('\n')) >= 0) {
        const item = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (item.method === 'stdout') process.stdout.write(item.params.text);
        else if (item.method === 'stderr') process.stderr.write(item.params.text);
        else if (item.error) fail(new Error(item.error.message));
        else {
          settled = true;
          const status = item.result?.status;
          resolve(status === 'completed' || status === 'shutting_down' ? 0 : 1);
          socket.end();
        }
      }
    });
    socket.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n');
  });
}
