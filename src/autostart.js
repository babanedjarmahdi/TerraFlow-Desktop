import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const REG_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE = 'TerraFlow';

export function isWindows() {
  return process.platform === 'win32';
}

export function vbsPath(installDir) {
  return path.join(installDir, 'startup.vbs');
}

export function launchVbsPath(installDir) {
  return path.join(installDir, 'TerraFlow.vbs');
}

function reg(args) {
  return new Promise((resolve) => {
    const child = spawn('reg.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, err }));
  });
}

export async function enableAutostart(installDir) {
  if (!isWindows()) return { enabled: false, reason: 'non-windows' };
  const target = vbsPath(installDir);
  if (!fs.existsSync(target)) return { enabled: false, reason: `missing ${target}` };
  const r = await reg(['add', REG_RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', `wscript.exe "${target}"`, '/f']);
  return { enabled: r.code === 0, code: r.code, error: r.err.trim() || null };
}

export async function disableAutostart() {
  if (!isWindows()) return { disabled: false, reason: 'non-windows' };
  const r = await reg(['delete', REG_RUN_KEY, '/v', RUN_VALUE, '/f']);
  return { disabled: true, code: r.code, error: r.err.trim() || null };
}

export async function autostartStatus() {
  if (!isWindows()) return { registered: false, reason: 'non-windows' };
  const r = await reg(['query', REG_RUN_KEY, '/v', RUN_VALUE]);
  return { registered: r.code === 0, code: r.code };
}