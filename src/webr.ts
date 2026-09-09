import { ChannelType, WebR } from 'webr';
import type { Backend, ConsoleEvent } from './backend.js';

export class WebRBackend implements Backend {
  private runtime?: WebR;
  private closed = false;
  private waiting = false;
  private interrupting = false;
  private pending?: NodeJS.Immediate;

  async start(emit: (event: ConsoleEvent) => void): Promise<void> {
    if (this.closed || this.runtime) throw new Error('Backend already started or closed');
    this.runtime = new WebR({
      interactive: true,
      channelType: ChannelType.SharedArrayBuffer,
      RArgs: ['--no-save', '--no-restore'],
    });
    await this.runtime.init();
    if (this.closed) return;
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
          case 'stdout':
          case 'stderr':
          case 'prompt':
            if (message.type === 'prompt') {
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
    this.runtime?.close();
  }
}
