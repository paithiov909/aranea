#!/usr/bin/env node
import { runTerminal } from './terminal.js';
import { WebRBackend } from './webr.js';

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.stderr.write('aranea: an interactive terminal is required (stdin and stdout must be TTYs).\n');
  process.exitCode = 1;
} else {
  process.exitCode = await runTerminal(new WebRBackend());
}
