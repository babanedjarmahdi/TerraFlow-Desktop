import fs from 'fs';
import os from 'os';
import path from 'path';
import { disableAutostart } from './autostart.js';
import { stopHere, supervisorState } from './supervisor.js';

export async function uninstall({ installDir, log, purge = false }) {
  log.info(`stopping runtime in ${installDir}`);
  const st = supervisorState(installDir);
  await stopHere(installDir, st ? st.port : null, log);

  const as = await disableAutostart();
  if (as.disabled) log.info('autostart entry removed');

  if (purge && fs.existsSync(installDir)) {
    try {
      process.chdir(os.tmpdir());
    } catch {
      /* not recoverable; rm still guarded below */
    }
    await rmRecursive(installDir);
    if (fs.existsSync(installDir)) {
      throw new Error(`EPERM: could not remove ${installDir} (a process may still hold files; remove it manually)`);
    }
    log.info(`removed ${installDir}`);
  } else {
    log.info('preserved install dir (your data lives in output/ and the Docker volume)');
  }
  return { stopped: true, autostart: as };
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