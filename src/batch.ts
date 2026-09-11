import { readFile } from 'node:fs/promises';
import type { Invocation } from './args.js';
import { WebRSession } from './webr-session.js';

export async function runBatch(invocation: Extract<Invocation, { mode: 'file' | 'expression' }>): Promise<number> {
  const session = new WebRSession(undefined, false);
  return new Promise<number>(resolve => {
    let closed = false;
    const finish = (code: number): void => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
      session.close();
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
      await session.start(event => {
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
      const result = await session.evaluateScript(code);
      if (closed) return;
      if (result === 'completed') await session.quit();
      else if (result === 'failed') await session.quit(1, false);
    })().catch(fail);
  });
}
