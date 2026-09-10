import { readFile } from 'node:fs/promises';
import type { Invocation } from './args.js';
import { WebRBackend } from './webr.js';

export async function runBatch(invocation: Extract<Invocation, { mode: 'file' | 'expression' }>): Promise<number> {
  const backend = new WebRBackend(undefined, false);
  return new Promise<number>(resolve => {
    let closed = false;
    const finish = (code: number): void => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
      backend.close();
      resolve(code);
    };
    const fail = (error: unknown): void => {
      if (closed) return;
      process.stderr.write(`aranea: ${error instanceof Error ? error.message : String(error)}\n`);
      finish(1);
    };
    const interrupt = (): void => finish(130);
    const terminate = (): void => finish(143);
    const timer = setTimeout(() => fail(new Error('WebR startup timed out')), 30_000);
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    void (async () => {
      const code = invocation.mode === 'file' ? await readFile(invocation.path, 'utf8') : invocation.code;
      if (closed) return;
      await backend.start(event => {
        if (closed) return;
        switch (event.type) {
          case 'stdout': process.stdout.write(event.text + '\n'); break;
          case 'stderr': process.stderr.write(event.text + '\n'); break;
          case 'error': fail(event.error); break;
          case 'closed': finish(event.code ?? 0); break;
        }
      });
      if (closed) return;
      clearTimeout(timer);
      await backend.execute(code);
    })().catch(fail);
  });
}
