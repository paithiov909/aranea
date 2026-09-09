import { runTerminal } from '../../dist/terminal.js';
let count = 0;
process.exitCode = await runTerminal({
  async start() { throw new Error('simulated initialization failure'); },
  close() { count++; },
});
if (count !== 1) throw new Error(`close called ${count} times`);
