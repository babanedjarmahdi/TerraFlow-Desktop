import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const MAX_OUTPUT = 64 * 1024;

export function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function runPowerShell(script, args = [], { timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    const file = path.join(
      os.tmpdir(),
      `terraflow-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`
    );
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        fs.rmSync(file, { force: true });
      } catch {}
      resolve(result);
    };
    try {
      fs.writeFileSync(file, script, 'utf8');
    } catch (err) {
      resolve({ code: 1, out: '', err: err.message });
      return;
    }
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let out = '';
    let err = '';
    child.stdout?.on('data', (d) => {
      if (out.length < MAX_OUTPUT) out += d;
    });
    child.stderr?.on('data', (d) => {
      if (err.length < MAX_OUTPUT) err += d;
    });
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            try {
              child.kill('SIGKILL');
            } catch {}
            finish({ code: 124, out: out.trim(), err: err.trim() || `powershell timed out after ${timeoutMs}ms` });
          }, timeoutMs)
        : null;
    child.on('error', (e) => finish({ code: 127, out: '', err: e.message }));
    child.on('close', (code) => finish({ code, out: out.trim(), err: err.trim() }));
  });
}
