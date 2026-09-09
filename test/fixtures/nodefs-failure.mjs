import { runTerminal } from '../../dist/terminal.js';
import { WebRBackend } from '../../dist/webr.js';

process.exitCode = await runTerminal(new WebRBackend(process.argv[2]));
