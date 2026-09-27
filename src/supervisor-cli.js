import path from 'path';
import { createLogger } from './log.js';
import { logDir } from './paths.js';
import { Supervisor, requestStop } from './supervisor.js';

const [runtimeDir, portStr] = process.argv.slice(2);

if (!runtimeDir) {
  console.error('[terraflow] supervisor-cli: missing <runtimeDir> argument');
  process.exit(2);
}

const port = Number(portStr) || 3000;
const log = createLogger({ dir: logDir(runtimeDir), tee: false });
const supervisor = new Supervisor({ runtimeDir, port, log });

log.info(`supervisor daemon started for ${runtimeDir} on port ${port}`);

let halted = false;
const halt = () => {
  if (halted) return;
  halted = true;
  log.info('signal received - requesting graceful stop');
  requestStop(runtimeDir);
  setTimeout(() => {
    log.error('supervisor did not stop within 8s - exiting');
    process.exit(1);
  }, 8000);
};

process.on('SIGINT', halt);
process.on('SIGTERM', halt);
process.on('uncaughtException', (err) => {
  log.error(`uncaughtException: ${err?.stack || err}`);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  log.error(`unhandledRejection: ${err?.stack || err}`);
  process.exit(1);
});

try {
  await supervisor.start({ foreground: true });
  log.info('supervisor daemon exited cleanly');
  process.exit(0);
} catch (err) {
  log.error(`supervisor crashed: ${err?.stack || err}`);
  process.exit(1);
}
