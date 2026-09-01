import path from 'path';
import { createLogger } from './log.js';
import { logDir } from './paths.js';
import { Supervisor } from './supervisor.js';

const [runtimeDir, portStr] = process.argv.slice(2);
const port = Number(portStr) || 3000;

const log = createLogger({ dir: logDir(runtimeDir), tee: false });
const supervisor = new Supervisor({ runtimeDir, port, log });

process.on('SIGTERM', async () => {
  try {
    await supervisor.stop();
  } finally {
    process.exit(0);
  }
});
process.on('SIGINT', async () => {
  try {
    await supervisor.stop();
  } finally {
    process.exit(0);
  }
});

log.info(`supervisor daemon started for ${runtimeDir} on port ${port}`);
await supervisor.start({ foreground: true });