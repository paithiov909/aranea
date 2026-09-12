#!/usr/bin/env node
import { runTerminal } from './terminal.js';
import { WebRBackend } from './webr.js';
import { readFile } from 'node:fs/promises';
import { parseArgs } from './args.js';
import { runBatch } from './batch.js';
import { runClient, runServer } from './rpc.js';

try {
  const invocation = parseArgs(process.argv.slice(2));
  if (invocation.mode === 'help') {
    process.stdout.write('Usage: aranea [script.R | -e code | --help | --version]\nUse aranea -- filename for filenames starting with a dash.\n');
  } else if (invocation.mode === 'version') {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    process.stdout.write(pkg.version + '\n');
  } else if (invocation.mode === 'serve') {
    process.exitCode = await runServer();
  } else if (invocation.mode === 'eval' || invocation.mode === 'shutdown') {
    try { process.exitCode = await runClient(invocation.mode === 'eval' ? 'eval' : 'shutdown', invocation.mode === 'eval' ? { code: invocation.code } : {}); }
    catch { process.stderr.write('aranea: no running server for this workspace\n'); process.exitCode = 1; }
  } else if (invocation.mode === 'file' || invocation.mode === 'expression') {
    process.exitCode = await runBatch(invocation);
  } else if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('aranea: an interactive terminal is required (stdin and stdout must be TTYs).\n');
    process.exitCode = 1;
  } else {
    process.exitCode = await runTerminal(new WebRBackend());
  }
} catch (error) {
  process.stderr.write(`aranea: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
