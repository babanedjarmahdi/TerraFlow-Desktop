import fs from 'fs';
import os from 'os';
import path from 'path';
import { disableAutostart } from './autostart.js';
import { removeShortcuts } from './shortcuts.js';
import { stopHere, supervisorState } from './supervisor.js';

export async function uninstall({ installDir, log, purge = false, desktopDir = '', startMenuDir = '' }) {
  log.info(`stopping runtime in ${installDir}`);
  const st = supervisorState(installDir);
  const stopRes = await stopHere(installDir, st?.port ?? null, log);

  const as = await disableAutostart();
  if (as.disabled) log.info(as.alreadyAbsent ? 'autostart entry was not registered' : 'autostart entry removed');

  const sc = await removeShortcuts({ installDir, desktopDir, startMenuDir });
  if (sc.ok) log.info('shortcuts removed');
  else if (sc.supported && sc.error) log.warn(`shortcuts not removed: ${sc.error}`);

  if (purge && fs.existsSync(installDir)) {
    try {
      process.chdir(os.tmpdir());
    } catch {
      /* not recoverable; rm still guarded below */
    }
    await rmRecursive(installDir);
    if (fs.existsSync(installDir)) {
      throw new Error(
        `EPERM: could not remove ${installDir} (a process may still hold files; remove it manually)`
      );
    }
    log.info(`removed ${installDir}`);
  } else {
    log.info('preserved install dir (your data lives in output/ and the Docker volume)');
  }
  return {
    stopped: stopRes.stopped,
    autostart: as,
    shortcuts: sc,
    purged: purge && !fs.existsSync(installDir),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rmRecursive(dir, attempt = 0) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  } catch {
    if (attempt >= 3) return;
    await sleep(300);
    return rmRecursive(dir, attempt + 1);
  }
}
