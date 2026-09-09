export type ConsoleEvent =
  | { type: 'stdout' | 'stderr' | 'prompt'; text: string }
  | { type: 'closed'; code?: number }
  | { type: 'error'; error: unknown };

export interface Backend {
  start(emit: (event: ConsoleEvent) => void): Promise<void>;
  sendLine(line: string): void;
  interrupt(): void;
  close(): void;
}
