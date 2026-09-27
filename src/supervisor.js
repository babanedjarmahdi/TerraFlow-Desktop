import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { apiBaseUrl, isProcessAlive, kill, spawnApi } from './api.js';
import { isTerraflowHealthy, portOpen, wait } from './net.js';
import { logDir, stateFile } from './paths.js';
import { readJson, writeJson } from './state.js';

const DEFAULT_OPTS = {
  pollMs: 3000,
  startTimeoutMs: 45000,
  unhealthyTolerance: 2,
  backoffMs: [2000, 4000, 8000, 15000, 30000],
};

export function stopFlagPath(runtimeDir) {
  return path.join(logDir(runtimeDir), 'stop.flag');
}

export function stopRequested(runtimeDir) {
  try {
    return fs.existsSync(stopFlagPath(runtimeDir));
  } catch {
    return false;
  }
}

export function requestStop(runtimeDir) {
  try {
    fs.mkdirSync(logDir(runtimeDir), { recursive: true });
    fs.writeFileSync(stopFlagPath(runtimeDir), String(Date.now()), 'utf8');
  } catch {}
}

export function clearStopRequest(runtimeDir) {
  try {
    fs.rmSync(stopFlagPath(runtimeDir), { force: true });
  } catch {}
}

export class Supervisor {
  constructor({ runtimeDir, port, log, opts = {} }) {
    this.runtimeDir = runtimeDir;
    this.port = port;
    this.log = log;
    this.opts = { ...DEFAULT_OPTS, ...opts };
    this.base = apiBaseUrl(port);
    this.apiPid = null;
    this.restarts = 0;
    this.status = 'idle';
    this.startedAt = null;
    this.lastCheck = null;
    this.lastSpawnAt = 0;
  }

  async start({ foreground = false } = {}) {
    if (foreground) {
      await this.runLoop();
      return { supervised: true, apiPid: this.apiPid, restarts: this.restarts, foreground: true };
    }
    return this.daemonize();
  }

  daemonize() {
    const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'supervisor-cli.js');
    const child = spawn(process.execPath, [entry, this.runtimeDir, String(this.port)], {
      cwd: this.runtimeDir,
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (err) => this.log.error(`failed to spawn supervisor daemon: ${err.message}`));
    child.unref();
    this.log.info(`background supervisor started (pid ${child.pid})`);
    return { supervised: true, daemonPid: child.pid };
  }

  warmingUp() {
    return Date.now() - this.lastSpawnAt < this.opts.startTimeoutMs;
  }

  async sleep(ms) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (stopRequested(this.runtimeDir)) return;
      await wait(Math.min(250, deadline - Date.now()));
    }
  }

  async runLoop() {
    this.startedAt = new Date().toISOString();
    const statePath = stateFile(this.runtimeDir);

    const save = () =>
      writeJson(statePath, {
        supervisorPid: process.pid,
        apiPid: this.apiPid,
        port: this.port,
        status: this.status,
        restarts: this.restarts,
        startedAt: this.startedAt,
        lastCheck: this.lastCheck,
      });

    const stopNow = () => stopRequested(this.runtimeDir);

    let failures = 0;
    let backoffIndex = 0;
    this.status = 'starting';
    save();

    while (true) {
      if (stopNow()) {
        this.log.info('stop requested - shutting down API');
        await kill(this.apiPid);
        this.status = 'stopped';
        save();
        clearStopRequest(this.runtimeDir);
        break;
      }

      const apiUp = this.apiPid ? isProcessAlive(this.apiPid) : false;
      const healthy = await isTerraflowHealthy(this.base);
      this.lastCheck = new Date().toISOString();

      if (apiUp && healthy) {
        failures = 0;
        backoffIndex = 0;
        if (this.status !== 'healthy') {
          this.status = 'healthy';
          this.log.info(`API healthy (pid ${this.apiPid})`);
        }
        save();
        await this.sleep(this.opts.pollMs);
        continue;
      }

      if (apiUp && this.warmingUp()) {
        if (this.status !== 'starting') {
          this.status = 'starting';
          this.log.info(`API (pid ${this.apiPid}) booting...`);
        }
        save();
        await this.sleep(this.opts.pollMs);
        continue;
      }

      failures += 1;
      this.status = apiUp ? 'unhealthy' : 'down';
      save();

      if (failures >= this.opts.unhealthyTolerance) {
        failures = 0;
        const backoff = this.opts.backoffMs[Math.min(backoffIndex, this.opts.backoffMs.length - 1)];
        backoffIndex += 1;
        const attempt = this.restarts + 1;
        if (apiUp) {
          this.log.warn(`API unhealthy (pid ${this.apiPid}) - restarting in ${backoff}ms (attempt #${attempt})`);
          await kill(this.apiPid);
        } else {
          this.log.warn(`API shown as stopped - restarting in ${backoff}ms (attempt #${attempt})`);
        }
        this.restarts = attempt;
        await this.sleep(backoff);
        if (stopNow()) continue;
        this.startApiProcess();
      } else if (!apiUp) {
        this.restarts += 1;
        this.startApiProcess();
      }

      save();
      await this.sleep(this.opts.pollMs);
    }
  }

  startApiProcess() {
    const child = spawnApi(this.runtimeDir, { port: this.port });
    this.apiPid = child.pid;
    this.lastSpawnAt = Date.now();
    fs.writeFileSync(path.join(logDir(this.runtimeDir), 'api.pid'), String(this.apiPid), 'utf8');
    this.log.info(`API spawned (pid ${this.apiPid})`);
  }
}

export function supervisorState(runtimeDir) {
  return readJson(stateFile(runtimeDir), null);
}

export async function stopHere(runtimeDir, port, log) {
  const state = supervisorState(runtimeDir);
  const supPid = state?.supervisorPid;
  const apiPid = readApiPid(runtimeDir, state?.apiPid);
  const targetPort =
    Number.isInteger(state?.port) && state.port > 0
      ? state.port
      : Number.isInteger(port) && port > 0
        ? port
        : null;

  const portWasOpen = targetPort ? await portOpen(targetPort) : false;

  let killedSup = false;
  let killedApi = false;

  if (supPid && supPid !== process.pid && isProcessAlive(supPid)) {
    requestStop(runtimeDir);
    log.info(`stopping supervisor (pid ${supPid})`);
    for (let i = 0; i < 24; i += 1) {
      if (!isProcessAlive(supPid)) break;
      await wait(250);
    }
    if (isProcessAlive(supPid)) {
      log.warn(`supervisor did not exit gracefully - forcing (pid ${supPid})`);
      await kill(supPid);
    }
    killedSup = true;
    const apiPidAfter = readApiPid(runtimeDir, state?.apiPid);
    if (apiPidAfter && isProcessAlive(apiPidAfter)) {
      await kill(apiPidAfter);
      killedApi = true;
    }
  }

  if (apiPid && isProcessAlive(apiPid)) {
    log.info(`stopping API (pid ${apiPid})`);
    await kill(apiPid);
    killedApi = true;
  }

  if (!killedSup && !killedApi) {
    clearStopRequest(runtimeDir);
    return { stopped: true, already: true };
  }

  if (!targetPort || !portWasOpen) {
    clearStopRequest(runtimeDir);
    return { stopped: true };
  }

  for (let i = 0; i < 20; i += 1) {
    if (!(await portOpen(targetPort))) {
      log.info(`port ${targetPort} is free`);
      clearStopRequest(runtimeDir);
      return { stopped: true };
    }
    await wait(500);
  }
  log.warn(`port ${targetPort} still open after stop - you may need to stop it manually`);
  clearStopRequest(runtimeDir);
  return { stopped: false };
}

function readApiPid(runtimeDir, pref) {
  if (Number.isInteger(pref) && pref > 0) return pref;
  try {
    const raw = fs.readFileSync(path.join(logDir(runtimeDir), 'api.pid'), 'utf8').trim();
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
