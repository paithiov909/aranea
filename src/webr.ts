import { ChannelType, WebR } from 'webr';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Backend, ConsoleEvent } from './backend.js';

export class WebRBackend implements Backend {
  private runtime?: WebR;
  private initialized = false;
  private closed = false;
  private waiting = false;
  private interrupting = false;
  private pending?: NodeJS.Immediate;

  constructor(private readonly hostDirectory?: string, private readonly interactive = true) {}

  async start(emit: (event: ConsoleEvent) => void): Promise<void> {
    if (this.closed || this.runtime) throw new Error('Backend already started or closed');
    let root: string;
    try {
      root = resolve(this.hostDirectory ?? process.cwd());
    } catch (cause) {
      throw new Error(`Cannot determine host working directory: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
    this.runtime = new WebR({
      interactive: this.interactive,
      channelType: ChannelType.SharedArrayBuffer,
      RArgs: ['--no-save', '--no-restore', ...(this.interactive ? [] : ['--quiet'])],
    });
    await this.runtime.init();
    this.initialized = true;
    if (this.closed) return;
    try {
      const info = await stat(root);
      if (this.closed) return;
      if (!info.isDirectory()) throw new Error('Not a directory');
      await this.runtime.FS.mkdir('/workspace');
      if (this.closed) return;
      await this.runtime.FS.mount('NODEFS', { root }, '/workspace');
      if (this.closed) return;
      await this.runtime.evalRVoid('setwd("/workspace")');
      if (this.closed) return;
    } catch (cause) {
      if (this.closed) return;
      throw new Error(`Cannot mount host directory ${JSON.stringify(root)} at /workspace: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
    // WebR 0.6.0 buffers partial TTY output and keeps its worker alive after
    // R's exit. Its shipped R.js sets process.exitCode in quit_(). Bridge that
    // signal without replacing q()/quit() or bypassing R's .Last hooks.
    await this.runtime.evalRVoid(`webr::eval_js(${JSON.stringify(`
      (() => {
        const flush = () => {
          for (const fd of [1, 2]) {
            const stream = Module.FS.getStream(fd);
            if (stream?.tty) stream.tty.ops.fsync(stream.tty);
          }
        };
        Module.webr.araneaFlush = flush;
        if (${!this.interactive}) {
          const readConsole = Module.webr.readConsole;
          Module.webr.readConsole = () => {
            if (Module.webr.araneaExecuting) {
              flush();
              Module.webr.channel.write({ type: 'aranea-input-unsupported' });
            }
            return readConsole();
          };
        }
        const prompt = Module.webr.setPrompt;
        Module.webr.setPrompt = text => { flush(); prompt(text); };
        const channel = Module.webr.channel;
        const read = channel.read.bind(channel);
        channel.read = () => {
          let message = read();
          while (message.type === 'aranea-sync') message = read();
          if (message.type === 'aranea-interrupt') {
            Module._Rf_onintr();
            return { type: 'stdin', data: '\\n' };
          }
          return message;
        };
        // The worker event loop resumes when R exits its synchronous REPL.
        const timer = setInterval(() => {
          if (process.exitCode !== undefined) {
            clearInterval(timer);
            flush();
            Module.webr.channel.write({ type: 'aranea-exit', data: Number(process.exitCode) });
          }
        }, 25);
      })();
    `)})`);
    if (this.closed) return;
    void this.consume(emit);
  }

  private async consume(emit: (event: ConsoleEvent) => void): Promise<void> {
    let code = 0;
    try {
      for await (const message of this.runtime!.stream()) {
        if (this.closed) break;
        switch (message.type) {
          case 'aranea-exit':
            code = Number(message.data);
            this.close();
            break;
          case 'aranea-batch-error':
            emit({ type: 'error', error: new Error(String(message.data)) });
            this.close();
            break;
          case 'aranea-input-unsupported':
            emit({ type: 'error', error: new Error('Standard input is not supported in batch mode') });
            this.close();
            break;
          case 'stdout':
          case 'stderr':
          case 'prompt':
            if (message.type === 'prompt') {
              if (!this.interactive) break;
              // An interrupted synchronous read may still reach the main
              // queue after WebR resets it. A harmless message absorbs that
              // abandoned read; the worker ignores it if no read was abandoned.
              if (this.interrupting) this.runtime!.write({ type: 'aranea-sync' });
              this.waiting = true;
              this.interrupting = false;
            }
            emit({ type: message.type, text: String(message.data) });
            break;
          default:
            emit({ type: 'stderr', text: `aranea: unsupported WebR output: ${message.type}` });
        }
      }
    } catch (error) {
      if (!this.closed) emit({ type: 'error', error });
    } finally {
      this.closed = true;
      emit({ type: 'closed', code });
    }
  }

  /** Execute a UTF-8 script in the global environment; completion comes through stream(). */
  async execute(code: string): Promise<void> {
    if (this.interactive) throw new Error('Batch execution requires a non-interactive backend');
    if (this.closed) return;
    const runtime = this.runtime!;
    try {
      await runtime.FS.writeFile('/tmp/aranea-script.R', new TextEncoder().encode(code));
      if (this.closed) return;
      await runtime.evalRVoid('webr::eval_js("Module.webr.araneaExecuting = true; undefined")');
      if (this.closed) return;
      await runtime.evalRVoid(`base::tryCatch(
        base::source("/tmp/aranea-script.R", local=globalenv(), echo=FALSE,
                     print.eval=TRUE, chdir=FALSE, encoding="UTF-8"),
        error=function(e) {
          base::message(base::conditionMessage(e))
          base::quit(save="no", status=1, runLast=FALSE)
        }
      )`, {
        captureStreams: false, captureConditions: false, captureGraphics: false,
      });
      if (this.closed) return;
      await runtime.evalRVoid('base::quit(save="no", status=0)', { captureStreams: false, captureConditions: false, captureGraphics: false });
    } catch (error) {
      // q() rejects the RPC but leaves the synchronous input dispatcher running.
      // Flush and send the usual exit marker through that dispatcher; its timer
      // cannot run until the worker returns to the JavaScript event loop.
      if (this.closed) return;
      if (error instanceof Error && error.name === 'ExitStatus') {
        await runtime.evalRVoid(`webr::eval_js('Module.webr.araneaFlush(); Module.webr.channel.write({ type: "aranea-exit", data: Number(process.exitCode) }); undefined')`);
        return;
      }
      // A marker on the same stream drains partial output before reporting failure.
      const message = error instanceof Error ? error.message : String(error);
      await runtime.evalRVoid(`webr::eval_js(${JSON.stringify(`
        Module.webr.araneaFlush();
        Module.webr.channel.write({ type: 'aranea-batch-error', data: ${JSON.stringify(message)} });
        undefined;
      `)})`);
    }
  }

  sendLine(line: string): void {
    if (this.closed) return;
    // Let a Ctrl+C in the same input burst cancel the line before submission.
    this.pending = setImmediate(() => {
      this.pending = undefined;
      if (this.closed) return;
      this.waiting = false;
      this.runtime!.writeConsole(line);
    });
  }

  interrupt(): void {
    if (this.closed || this.interrupting) return;
    clearImmediate(this.pending);
    this.pending = undefined;
    this.interrupting = true;
    // Avoid WebR's inputQueue.reset() orphaning an outstanding read while idle.
    if (this.waiting) this.runtime!.write({ type: 'aranea-interrupt' });
    else this.runtime!.interrupt();
    this.waiting = false;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearImmediate(this.pending);
    // Wake a worker blocked in a synchronous input read before terminating it.
    // Node worker termination alone can otherwise wait for that read to yield.
    try { if (this.initialized) this.runtime?.interrupt(); }
    finally { this.runtime?.close(); }
  }
}
