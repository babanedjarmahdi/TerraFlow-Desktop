import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getJson, isTerraflowHealthy, portOpen, wait } from './net.js';

export function resolvePort() {
  const p = Number(process.env.TERRAFLOW_PORT || process.env.PORT || 3000);
  return Number.isInteger(p) && p > 0 ? p : 3000;
}

export function apiBaseUrl(port = resolvePort()) {
  return `http://127.0.0.1:${port}`;
}

export function apiEntry(runtimeDir) {
  return path.join(runtimeDir, 'apps', 'api', 'src', 'server.js');
}

export function webBundleExists(runtimeDir) {
  return fs.existsSync(path.join(runtimeDir, 'apps', 'api', 'public'));
}

export function spawnApi(runtimeDir, { port = resolvePort() } = {}) {
  const logs = path.join(runtimeDir, 'output', 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const outFd = fs.openSync(path.join(logs, 'api.log'), 'a');
  const errFd = fs.openSync(path.join(logs, 'api.err.log'), 'a');
  const child = spawn(process.execPath, ['apps/api/src/server.js'], {
    cwd: runtimeDir,
    windowsHide: true,
    detached: true,
    stdio: ['ignore', outFd, errFd],
    env: {
      ...process.env,
      PORT: String(port),
      TERRAFLOW_RUNTIME_DIR: runtimeDir,
    },
  });
  child.once('spawn', () => {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  });
  child.unref();
  return child;
}

export function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function kill(pid) {
  if (!isProcessAlive(pid)) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {}
}

export async function portOwnerIsApi(port = resolvePort()) {
  if (!(await portOpen(port))) return { present: false, api: false };
  const base = apiBaseUrl(port);
  if (await isTerraflowHealthy(base)) return { present: true, api: true, healthy: true };
  const probe = await getJson(`${base}/api/health`);
  const apiLike = probe.ok && probe.data && typeof probe.data.status !== 'undefined';
  return { present: true, api: apiLike, healthy: false };
}

export async function waitUntilHealthy({ port = resolvePort(), timeoutMs = 30000, stepMs = 1000, log } = {}) {
  const base = apiBaseUrl(port);
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await getJson(`${base}/api/health`);
    if (r.ok && r.status === 200 && r.data && r.data.status === 'ok') {
      if (log) log.info(`API healthy at ${base} (db: ${r.data.db})`);
      return { healthy: true, db: r.data.db };
    }
    last = r;
    await wait(stepMs);
  }
  if (log) log.warn('API did not become healthy within the timeout');
  return { healthy: false, last };
}