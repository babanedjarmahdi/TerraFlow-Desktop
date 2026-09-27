import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import {
  apiBaseUrl,
  isProcessAlive,
  portOwnerIsApi,
  resolvePort,
  waitUntilHealthy,
  webBundleExists,
} from './api.js';
import { ensurePostgres } from './docker.js';
import { createLogger } from './log.js';
import { isTerraflowHealthy, portOpen } from './net.js';
import { logDir } from './paths.js';
import {
  Supervisor,
  clearStopRequest,
  requestStop,
  stopHere,
  stopRequested,
  supervisorState,
} from './supervisor.js';

export async function launch({
  runtimeDir,
  port = resolvePort(),
  foreground = false,
  openBrowser = true,
  withDb = true,
  log,
  quiet = false,
}) {
  const logger = log || createLogger({ dir: logDir(runtimeDir), tee: !quiet });
  const base = apiBaseUrl(port);
  const shouldStop = () => stopRequested(runtimeDir);

  clearStopRequest(runtimeDir);

  const onSignal = () => requestStop(runtimeDir);
  if (foreground) {
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
  }

  try {
    const supState = supervisorState(runtimeDir);
    const supAlive = Boolean(supState?.supervisorPid && isProcessAlive(supState.supervisorPid));

    const occupied = await portOpen(port);
    if (occupied) {
      const owner = await portOwnerIsApi(port);
      if (owner.api) {
        let healthy = owner.healthy || (await isTerraflowHealthy(base));
        if (!healthy) {
          logger.info(`TerraFlow API present on ${base} but unhealthy - waiting for recovery`);
          healthy = (await waitUntilHealthy({ port, timeoutMs: 30000, log: logger, abort: shouldStop }))
            .healthy;
        } else {
          logger.info(`already running and healthy at ${base}`);
        }
        if (healthy && openBrowser) openDefaultBrowser(base);
        if (shouldStop()) return { status: 'stopped' };
        return { status: 'already-running', healthy, supervised: supAlive, port };
      }
      logger.warn(`port ${port} is occupied by a non-TerraFlow process - refusing to start another instance`);
      return { status: 'port-conflict' };
    }

    if (supAlive) {
      logger.info('a supervisor is already running - waiting for the API to come back...');
      const h = await waitUntilHealthy({ port, timeoutMs: 60000, log: logger, abort: shouldStop });
      if (shouldStop()) return { status: 'stopped' };
      if (h.healthy && openBrowser) openDefaultBrowser(base);
      return {
        status: h.healthy ? 'already-running' : 'started',
        healthy: h.healthy,
        supervised: true,
        base,
        port,
      };
    }

    let pg;
    if (withDb) {
      pg = await ensurePostgres({ runtimeDir, log: logger, shouldStop });
      if (pg.status === 'aborted' || shouldStop()) {
        clearStopRequest(runtimeDir);
        logger.info('launch aborted before start');
        return { status: 'stopped' };
      }
    } else {
      pg = { status: 'skipped' };
    }

    if (shouldStop()) {
      clearStopRequest(runtimeDir);
      return { status: 'stopped' };
    }

    const supervisor = new Supervisor({ runtimeDir, port, log: logger });
    let loopPromise = null;
    let result;
    if (foreground) {
      loopPromise = supervisor.start({ foreground: true });
      result = { supervised: true, foreground: true };
    } else {
      result = supervisor.daemonize();
    }

    const h = await waitUntilHealthy({ port, timeoutMs: 60000, log: logger, abort: shouldStop });
    if (h.healthy && openBrowser) {
      openDefaultBrowser(base);
    } else if (!h.healthy && !shouldStop()) {
      logger.warn('API did not become healthy within 60s');
    }

    if (foreground) {
      const fin = await loopPromise;
      return {
        status: 'stopped',
        supervised: true,
        foreground: true,
        restarts: fin?.restarts ?? 0,
        apiPid: fin?.apiPid ?? null,
        postgres: pg.status,
        port,
      };
    }

    if (shouldStop()) return { status: 'stopped' };

    return {
      status: 'started',
      healthy: h.healthy,
      base,
      postgres: pg.status,
      db: h.healthy ? h.db : null,
      supervised: result.supervised,
      daemonPid: result.daemonPid || null,
      apiPid: result.apiPid || null,
      port,
    };
  } finally {
    if (foreground) {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    }
  }
}

export async function stop({ runtimeDir, port = resolvePort(), log, quiet = false }) {
  const logger = log || createLogger({ dir: logDir(runtimeDir), tee: !quiet });
  return stopHere(runtimeDir, port, logger);
}

export async function status({ runtimeDir, log, quiet = false }) {
  const logger = log || createLogger({ dir: logDir(runtimeDir), tee: !quiet });
  const state = supervisorState(runtimeDir);
  const port = Number.isInteger(state?.port) && state.port > 0 ? state.port : resolvePort();
  const base = apiBaseUrl(port);
  const up = await portOpen(port);
  let healthy = null;
  if (up) {
    healthy = await isTerraflowHealthy(base);
  }
  return {
    runtimeDir,
    port,
    installed: fs.existsSync(path.join(runtimeDir, 'apps', 'api', 'src', 'server.js')),
    webBundle: webBundleExists(runtimeDir),
    portOpen: up,
    healthy,
    supervisor: state,
    supervisorAlive: Boolean(state?.supervisorPid && isProcessAlive(state.supervisorPid)),
    postgres: await portOpen(5432),
  };
}

export async function oneShotHealth({ runtimeDir }) {
  return isTerraflowHealthy(apiBaseUrl(effectivePort(runtimeDir)));
}

export function effectivePort(runtimeDir) {
  const state = supervisorState(runtimeDir);
  const p = state?.port;
  return Number.isInteger(p) && p > 0 ? p : resolvePort();
}

export function openDefaultBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
    return child;
  } catch {
    return null;
  }
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

export function isApiRunning(runtimeDir) {
  const pid = activePid(runtimeDir);
  return Boolean(pid && isProcessAlive(pid));
}
