import { ChannelType, WebR } from 'webr';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ConsoleEvent } from './backend.js';

export type WebRSessionEvent = ConsoleEvent;
export type EvaluationResult = 'completed' | 'failed' | 'exited';

/** Owns one WebR instance and all WebR-specific lifetime behavior. */
export class WebRSession {
  private runtime?: WebR;
  private initialized = false;
  private closed = false;
  private rExited = false;
  private waiting = false;
  private interrupting = false;
  private pending?: NodeJS.Immediate;

  constructor(private readonly hostDirectory?: string, private readonly interactive = true) {}

  async start(emit: (event: WebRSessionEvent) => void): Promise<void> {
    if (this.closed || this.runtime) throw new Error('WebR session already started or closed');
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
    await this.installBridge();
    if (this.closed) return;
    void this.consume(emit);
  }

  private async installBridge(): Promise<void> {
    // WebR 0.6.0 buffers partial TTY output and keeps its worker alive after
    // R's exit. Its shipped R.js sets process.exitCode in quit_(). Bridge that
    // signal without replacing q()/quit() or bypassing R's .Last hooks.
    await this.runtime!.evalRVoid(`webr::eval_js(${JSON.stringify(`
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
        const timer = setInterval(() => {
          if (process.exitCode !== undefined) {
            clearInterval(timer);
            flush();
            Module.webr.channel.write({ type: 'aranea-exit', data: Number(process.exitCode) });
          }
        }, 25);
      })();
    `)})`);
  }

  private async consume(emit: (event: WebRSessionEvent) => void): Promise<void> {
    let code = 0;
    try {
      for await (const message of this.runtime!.stream()) {
        if (this.closed) break;
        switch (message.type) {
          case 'aranea-exit':
            code = Number(message.data);
            this.rExited = true;
            this.close();
            break;
          case 'aranea-batch-error':
            emit({ type: 'error', error: new Error(String(message.data)) });
            break;
          case 'aranea-input-unsupported':
            emit({ type: 'error', error: new Error('Standard input is not supported in batch mode') });
            break;
          case 'stdout':
          case 'stderr':
          case 'prompt':
            if (message.type === 'prompt') {
              if (!this.interactive) break;
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

  /** Evaluate a UTF-8 script without deciding when the session should end. */
  async evaluateScript(code: string): Promise<EvaluationResult> {
    if (this.interactive) throw new Error('Script evaluation requires a non-interactive WebR session');
    if (this.closed || this.rExited) return 'exited';
    const runtime = this.startedRuntime();
    try {
      await runtime.FS.writeFile('/tmp/aranea-script.R', new TextEncoder().encode(code));
      if (this.closed) return 'exited';
      await runtime.evalRVoid('webr::eval_js("Module.webr.araneaExecuting = true; undefined")');
      if (this.closed) return 'exited';
      const succeeded = await runtime.evalRBoolean(`base::tryCatch({
        base::source("/tmp/aranea-script.R", local=globalenv(), echo=FALSE,
                     print.eval=TRUE, chdir=FALSE, encoding="UTF-8")
        TRUE
      },
        error=function(e) {
          base::message(base::conditionMessage(e))
          FALSE
        }
      )`, { captureStreams: false, captureConditions: false, captureGraphics: false });
      if (this.closed || this.rExited) return 'exited';
      await runtime.evalRVoid('webr::eval_js("Module.webr.araneaExecuting = false; undefined")');
      return succeeded ? 'completed' : 'failed';
    } catch (error) {
      if (this.closed) return 'exited';
      if (error instanceof Error && error.name === 'ExitStatus') {
        this.rExited = true;
        await this.sendExitMarker();
        return 'exited';
      }
      const message = error instanceof Error ? error.message : String(error);
      await runtime.evalRVoid(`webr::eval_js(${JSON.stringify(`
        Module.webr.araneaFlush();
        Module.webr.araneaExecuting = false;
        Module.webr.channel.write({ type: 'aranea-batch-error', data: ${JSON.stringify(message)} });
        undefined;
      `)})`);
      return 'failed';
    }
  }

  /** Ask R to exit normally, including .Last hooks. */
  async quit(status = 0, runLast = true): Promise<void> {
    if (this.closed || this.rExited) return;
    try {
      await this.startedRuntime().evalRVoid(`base::quit(save="no", status=${status}, runLast=${runLast ? 'TRUE' : 'FALSE'})`, {
        captureStreams: false, captureConditions: false, captureGraphics: false,
      });
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'ExitStatus') throw error;
      this.rExited = true;
      await this.sendExitMarker();
    }
  }

  private async sendExitMarker(): Promise<void> {
    if (this.closed) return;
    await this.startedRuntime().evalRVoid(`webr::eval_js('Module.webr.araneaFlush(); Module.webr.channel.write({ type: "aranea-exit", data: Number(process.exitCode) }); undefined')`);
  }

  sendLine(line: string): void {
    if (this.closed) return;
    const runtime = this.startedRuntime();
    this.pending = setImmediate(() => {
      this.pending = undefined;
      if (this.closed) return;
      this.waiting = false;
      runtime.writeConsole(line);
    });
  }

  interrupt(): void {
    if (this.closed || this.interrupting) return;
    const runtime = this.startedRuntime();
    clearImmediate(this.pending);
    this.pending = undefined;
    this.interrupting = true;
    if (this.waiting) runtime.write({ type: 'aranea-interrupt' });
    else runtime.interrupt();
    this.waiting = false;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearImmediate(this.pending);
    try { if (this.initialized) this.runtime?.interrupt(); }
    finally { this.runtime?.close(); }
  }

  private startedRuntime(): WebR {
    if (!this.runtime) throw new Error('WebR session has not been started');
    return this.runtime;
  }
}
