import { createInterface } from 'node:readline';
import type { Backend, ConsoleEvent } from './backend.js';

// One prompt grants permission to submit exactly one line, including an empty line.
export class InputQueue {
  private lines: string[] = [];
  private waiting = false;
  constructor(private send: (line: string) => void) {}
  line(line: string): void { this.lines.push(line); this.drain(); }
  prompt(): void { this.waiting = true; this.drain(); }
  clear(): void { this.lines = []; this.waiting = false; }
  private drain(): void {
    if (this.waiting && this.lines.length) {
      this.waiting = false;
      this.send(this.lines.shift()!);
    }
  }
}

export async function runTerminal(backend: Backend): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const queue = new InputQueue((line) => backend.sendLine(line));
  let closed = false;
  let ready = false;
  let discardingLine = false;
  let resolve!: (code: number) => void;
  const done = new Promise<number>((finish) => { resolve = finish; });
  const finish = (code = 0): void => {
    if (closed) return;
    closed = true;
    queue.clear();
    clearTimeout(startupTimer);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
    rl.close();
    backend.close();
    resolve(code);
  };
  const fail = (error: unknown): void => {
    if (closed) return;
    process.stderr.write(`aranea: ${error instanceof Error ? error.message : String(error)}\n`);
    finish(1);
  };
  const interrupt = (): void => {
    if (closed) return;
    queue.clear();
    // Complete and discard the local edit buffer. Unlike Ctrl+U, Return also
    // clears text after the cursor and works with readline's TERM=dumb mode.
    discardingLine = true;
    try { rl.write(null, { name: 'return' }); }
    finally { discardingLine = false; }
    if (!ready) { finish(130); return; }
    try { backend.interrupt(); } catch (error) { fail(error); }
  };
  const terminate = (): void => finish(143);
  const startupTimer = setTimeout(() => fail(new Error('WebR startup timed out')), 30_000);
  rl.on('line', (line) => {
    if (!closed && !discardingLine) {
      try { queue.line(line); } catch (error) { fail(error); }
    }
  });
  rl.on('SIGINT', interrupt);
  rl.on('close', () => finish());
  rl.on('error', fail);
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  const emit = (event: ConsoleEvent): void => {
    if (closed) return;
    switch (event.type) {
      case 'stdout': process.stdout.write(event.text + '\n'); break;
      case 'stderr': process.stderr.write(event.text + '\n'); break;
      case 'prompt':
        rl.setPrompt(event.text);
        rl.prompt(true);
        queue.prompt();
        break;
      case 'closed': finish(event.code); break;
      case 'error': fail(event.error); break;
    }
  };
  void backend.start(emit).then(() => {
    ready = true;
    clearTimeout(startupTimer);
  }, fail);
  return done;
}
