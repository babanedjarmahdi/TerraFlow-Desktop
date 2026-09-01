import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { apiBaseUrl, isProcessAlive, resolvePort, waitUntilHealthy, webBundleExists } from './api.js';
import { ensurePostgres } from './docker.js';
import { createLogger } from './log.js';
import { isTerraflowHealthy, portOpen } from './net.js';
import { logDir } from './paths.js';
import { Supervisor, stopHere, supervisorState } from './supervisor.js';

export async function launch({ runtimeDir, port = resolvePort(), foreground = false, openBrowser = true, withDb = true, log, quiet = false }) {
  const logger = log || createLogger({ dir: logDir(runtimeDir), tee: !quiet });
  const base = apiBaseUrl(port);

  const occupied = await portOpen(port);
  if (occupied) {
    const healthy = await isTerraflowHealthy(base);
    if (healthy) {
      logger.info(`already running and healthy at ${base}`);
      if (openBrowser) openDefaultBrowser(base);
      return { status: 'already-running', healthy: true };
    }
    logger.warn(`port ${port} is occupied by a non-TerraFlow process - refusing to start another instance`);
    return { status: 'port-conflict' };
  }

  let pg;
  if (withDb) {
    pg = await ensurePostgres({ runtimeDir, log: logger });
  } else {
    pg = { status: 'skipped' };
  }

  const supervisor = new Supervisor({ runtimeDir, port, log: logger });
  const result = await supervisor.start({ foreground });

  const healthy = await waitUntilHealthy({ port, timeoutMs: 60000, log: logger });
  if (healthy.healthy && openBrowser) openDefaultBrowser(base);

  return {
    status: 'started',
    base,
    postgres: pg.status,
    db: healthy.healthy ? healthy.db : null,
    supervised: result.supervised,
    daemonPid: result.daemonPid || null,
    apiPid: result.apiPid || null,
    port,
  };
}

export async function stop({ runtimeDir, port = resolvePort(), log, quiet = false }) {
  const logger = log || createLogger({ dir: logDir(runtimeDir), tee: !quiet });
  return stopHere(runtimeDir, effectivePort(runtimeDir) || port, logger);
}

export async function status({ runtimeDir, log, quiet = false }) {
  const logger = log || createLogger({ dir: logDir(runtimeDir), tee: !quiet });
  const port = effectivePort(runtimeDir) || resolvePort();
  const state = supervisorState(runtimeDir);
  const base = apiBaseUrl(port);
  const up = await portOpen(port);
  let healthy = null;
  if (up) {
    healthy = await isTerraflowHealthy(base);
  }
  const result = {
    runtimeDir,
    port,
    installed: fs.existsSync(path.join(runtimeDir, 'apps', 'api', 'src', 'server.js')),
    webBundle: webBundleExists(runtimeDir),
    portOpen: up,
    healthy,
    supervisor: state,
    postgres: await portOpen(5432),
  };
  return result;
}

export async function oneShotHealth({ runtimeDir }) {
  return isTerraflowHealthy(apiBaseUrl(effectivePort(runtimeDir) || resolvePort()));
}

export function effectivePort(runtimeDir) {
  const state = supervisorState(runtimeDir);
  const p = state?.port;
  return Number.isInteger(p) && p > 0 ? p : resolvePort();
}

export function openDefaultBrowser(url) {
  const escaped = url.replace(/&/g, '^&');
  const cmd = process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', escaped] : [url];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return child;
}

export function activePid(runtimeDir) {
  try {
    const raw = fs.readFileSync(path.join(logDir(runtimeDir), 'api.pid'), 'utf8').trim();
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function isApiRunning(runtimeDir, port = resolvePort()) {
  const pid = activePid(runtimeDir, port);
  return Boolean(pid && isProcessAlive(pid));
}