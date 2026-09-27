import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { portOpen, wait, waitFor } from './net.js';

const MAX_OUTPUT = 64 * 1024;

const DOCKER_DESKTOP_CANDIDATES = () => {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  return [
    path.join(pf, 'Docker', 'Docker', 'Docker Desktop.exe'),
    path.join(process.env['ProgramW6432'] || pf, 'Docker', 'Docker', 'Docker Desktop.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Docker', 'Docker Desktop.exe'),
  ];
};

function exec(cmd, args, { cwd = process.cwd(), timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(cmd, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d) => {
      if (out.length < MAX_OUTPUT) out += d;
    });
    child.stderr?.on('data', (d) => {
      if (err.length < MAX_OUTPUT) err += d;
    });
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
      finish({ code: 124, out: out.trim(), err: (err.trim() || `timed out after ${timeoutMs}ms`) });
    }, timeoutMs);
    child.on('error', (e) => finish({ code: 127, out: '', err: e.message }));
    child.on('close', (code) => finish({ code, out: out.trim(), err: err.trim() }));
  });
}

export async function dockerVersion() {
  const r = await exec('docker', ['version', '--format', '{{.Server.Version}}'], { timeoutMs: 8000 });
  return r.code === 0 ? r.out : null;
}

export function launchDockerDesktop() {
  for (const exe of DOCKER_DESKTOP_CANDIDATES()) {
    if (fs.existsSync(exe)) {
      try {
        const child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: true });
        child.on('error', () => {});
        child.unref();
        return exe;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function dockerComposeUp(runtimeDir, service = 'postgres') {
  const args = ['compose', 'up', '-d', service];
  return exec('docker', args, { cwd: runtimeDir, timeoutMs: 180000 });
}

export async function ensurePostgres({ runtimeDir, log, waitMs = 120000, stepMs = 2000, shouldStop = null }) {
  const stopping = () => Boolean(shouldStop && shouldStop());
  if (stopping()) return { status: 'aborted' };
  if (await portOpen(5432)) return { status: 'already-up' };

  let version = await dockerVersion();
  if (!version) {
    const exe = launchDockerDesktop();
    if (exe) {
      log.info(`starting Docker Desktop: ${exe}`);
      const deadline = Date.now() + 90000;
      while (!version && Date.now() < deadline && !stopping()) {
        await wait(stepMs);
        version = await dockerVersion();
      }
    }
  }

  if (stopping()) return { status: 'aborted' };
  if (!version) {
    log.warn('Docker is unavailable - Postgres will not start; API will report db: down');
    return { status: 'docker-unavailable' };
  }

  log.info(`docker ready (server ${version}); booting postgres via compose`);
  const up = await dockerComposeUp(runtimeDir);
  if (up.code !== 0) {
    log.warn(`docker compose up failed: ${up.err || up.out}`);
    return { status: 'compose-failed', detail: up.err || up.out };
  }

  const open = await waitFor(() => portOpen(5432), { timeoutMs: waitMs, stepMs, abort: stopping });
  if (stopping()) return { status: 'aborted' };
  return open ? { status: 'up' } : { status: 'timeout' };
}
