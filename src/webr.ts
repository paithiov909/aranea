import type { Backend, ConsoleEvent } from './backend.js';
import { WebRSession } from './webr-session.js';

/** Interactive console adapter backed by a WebR session. */
export class WebRBackend implements Backend {
  private readonly session: WebRSession;

  constructor(hostDirectory?: string) {
    this.session = new WebRSession(hostDirectory, true);
  }

  start(emit: (event: ConsoleEvent) => void): Promise<void> {
    return this.session.start(emit);
  }

  sendLine(line: string): void { this.session.sendLine(line); }
  interrupt(): void { this.session.interrupt(); }
  close(): void { this.session.close(); }
}
