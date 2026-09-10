export type Invocation =
  | { mode: 'repl' | 'help' | 'version' }
  | { mode: 'file'; path: string }
  | { mode: 'expression'; code: string };

export function parseArgs(args: string[]): Invocation {
  if (args.length === 0) return { mode: 'repl' };
  if (args.length === 1 && args[0] === '--help') return { mode: 'help' };
  if (args.length === 1 && args[0] === '--version') return { mode: 'version' };
  if (args.length === 2 && args[0] === '-e') return { mode: 'expression', code: args[1] };
  if (args.length === 2 && args[0] === '--') return { mode: 'file', path: args[1] };
  if (args.length === 1 && !args[0].startsWith('-')) return { mode: 'file', path: args[0] };
  throw new Error('Invalid arguments. Usage: aranea [script.R | -e code | --help | --version]');
}
