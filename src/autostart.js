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
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn('reg.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d) => (out += d));
    child.stderr?.on('data', (d) => (err += d));
    child.on('error', (e) => finish({ code: 127, out: '', err: e.message }));
    child.on('close', (code) => finish({ code, out, err }));
  });
}

function isNotFound(r) {
  return /unable to find|cannot find|not found/i.test(`${r.err}\n${r.out}`);
}

export async function enableAutostart(installDir) {
  if (!isWindows()) return { enabled: false, reason: 'non-windows' };
  const target = vbsPath(installDir);
  if (!fs.existsSync(target)) return { enabled: false, reason: `missing ${target}` };
  const r = await reg([
    'add',
    REG_RUN_KEY,
    '/v',
    RUN_VALUE,
    '/t',
    'REG_SZ',
    '/d',
    `wscript.exe //B "${target}"`,
    '/f',
  ]);
  return { enabled: r.code === 0, code: r.code, error: r.code === 0 ? null : r.err.trim() || r.out.trim() || null };
}

export async function disableAutostart() {
  if (!isWindows()) return { disabled: false, reason: 'non-windows' };
  const r = await reg(['delete', REG_RUN_KEY, '/v', RUN_VALUE, '/f']);
  const absent = r.code !== 0 && isNotFound(r);
  return {
    disabled: r.code === 0 || absent,
    alreadyAbsent: absent || undefined,
    code: r.code,
    error: r.code === 0 || absent ? null : r.err.trim() || r.out.trim() || null,
  };
}

export async function autostartStatus() {
  if (!isWindows()) return { registered: false, reason: 'non-windows' };
  const r = await reg(['query', REG_RUN_KEY, '/v', RUN_VALUE]);
  return { registered: r.code === 0, code: r.code };
}
