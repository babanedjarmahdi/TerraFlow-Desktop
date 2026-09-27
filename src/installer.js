import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { webBundleExists } from './api.js';

const DESKTOP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOP_LEVEL_FILES = ['package.json', 'package-lock.json', 'docker-compose.yml'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.vite', 'dist', 'coverage', '.vercel']);

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export async function install({ coreDir, installDir, log, withDeps = true, desktopDir = null }) {
  if (path.resolve(coreDir) === path.resolve(installDir)) {
    throw new Error('--core must point at a Core checkout that differs from the install dir');
  }
  if (!fs.existsSync(path.join(coreDir, 'package.json'))) {
    throw new Error(`not a TerraFlow Core checkout: ${coreDir}`);
  }
  if (!fs.existsSync(path.join(coreDir, 'apps', 'api', 'src', 'server.js'))) {
    throw new Error(`missing Core API entry in ${coreDir}`);
  }

  const desktopRoot = desktopDir ? path.resolve(desktopDir) : DESKTOP_ROOT;
  fs.mkdirSync(installDir, { recursive: true });

  for (const file of TOP_LEVEL_FILES) {
    const src = path.join(coreDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(installDir, file));
    } else {
      log.warn(`core file not found (skipped): ${file}`);
    }
  }

  const envSrc = fs.existsSync(path.join(coreDir, '.env'))
    ? path.join(coreDir, '.env')
    : path.join(coreDir, '.env.example');
  if (!fs.existsSync(path.join(installDir, '.env'))) {
    if (fs.existsSync(envSrc)) {
      fs.copyFileSync(envSrc, path.join(installDir, '.env'));
    } else {
      log.warn('no .env or .env.example found in Core - skipped');
    }
  }

  copyTree(path.join(coreDir, 'packages'), path.join(installDir, 'packages'));
  copyTree(path.join(coreDir, 'apps', 'api', 'src'), path.join(installDir, 'apps', 'api', 'src'));
  copyTree(path.join(coreDir, 'apps', 'api', 'public'), path.join(installDir, 'apps', 'api', 'public'));

  const apiPkg = path.join(coreDir, 'apps', 'api', 'package.json');
  if (fs.existsSync(apiPkg)) {
    const apiDst = path.join(installDir, 'apps', 'api', 'package.json');
    fs.mkdirSync(path.dirname(apiDst), { recursive: true });
    fs.copyFileSync(apiPkg, apiDst);
  }

  const outDir = path.join(installDir, 'output');
  const hasUserData = fs.existsSync(outDir) && fs.readdirSync(outDir).some((n) => n !== 'logs');
  if (!hasUserData) {
    copyTree(path.join(coreDir, 'output'), outDir, ['logs', 'watcher.log']);
  } else {
    log.info('existing data dir preserved (upgrade-safe)');
  }

  copyTree(path.join(desktopRoot, 'bin'), path.join(installDir, 'bin'));
  copyTree(path.join(desktopRoot, 'src'), path.join(installDir, 'src'));
  copyTree(path.join(desktopRoot, 'installer'), path.join(installDir, 'installer'));
  copyTree(path.join(desktopRoot, 'assets'), path.join(installDir, 'assets'));
  fs.copyFileSync(path.join(desktopRoot, 'package.json'), path.join(installDir, 'desktop-package.json'));

  writeSourceRecord(installDir, { coreDir, desktopDir: desktopRoot });

  if (!webBundleExists(installDir)) {
    log.warn(
      'no web bundle found in Core apps/api/public - UI will 404 until a build is staged (watchers still run via API)'
    );
  }

  if (withDeps) {
    let res = await runNpm(installDir, ['ci', '--omit=dev']);
    if (res.code !== 0) {
      log.warn('npm ci failed (missing lockfile?) - falling back to npm install');
      res = await runNpm(installDir, ['install', '--omit=dev', '--no-audit', '--no-fund']);
    }
    if (res.code !== 0) {
      log.warn('npm install failed - the app may not start until dependencies are installed');
    } else {
      log.info('production dependencies installed');
    }
  }

  generateScripts({ installDir, nodeExe: process.execPath, mjs: path.join(installDir, 'bin', 'terraflow.mjs'), log });

  return installDir;
}

function copyTree(src, dst, skip = SKIP_DIRS) {
  if (!fs.existsSync(src)) return;
  const skipSet = skip instanceof Set ? skip : new Set(skip);
  fs.cpSync(src, dst, {
    recursive: true,
    force: true,
    dereference: true,
    filter: (s) => !skipSet.has(path.basename(s)),
  });
}

export function sourceRecordPath(installDir) {
  return path.join(installDir, 'output', '.source.json');
}

export function readSourceRecord(installDir) {
  try {
    const raw = fs.readFileSync(sourceRecordPath(installDir), 'utf8');
    const stripped = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

export function writeSourceRecord(installDir, record) {
  fs.mkdirSync(path.dirname(sourceRecordPath(installDir)), { recursive: true });
  fs.writeFileSync(sourceRecordPath(installDir), JSON.stringify(record, null, 2), 'utf8');
}

function runNpm(cwd, npmArgs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const argStr = npmArgs.join(' ');
    const [cmd, args] =
      process.platform === 'win32'
        ? ['cmd.exe', ['/d', '/s', '/c', `${npmCmd} ${argStr}`]]
        : [npmCmd, npmArgs];
    const child = spawn(cmd, args, {
      cwd,
      windowsHide: true,
      stdio: 'inherit',
    });
    child.on('error', (err) => finish({ code: 127, error: err }));
    child.on('close', (code) => finish({ code }));
  });
}

function q(str) {
  return `"${str.replace(/"/g, '\\"')}"`;
}

function vbsRun(nodeExe, mjs, flags) {
  const line = `${q(nodeExe)} ${q(mjs)} ${flags}`;
  return `sh.Run "${line.replace(/"/g, '""')}", 0, False`;
}

function generateScripts({ installDir, nodeExe, mjs, log }) {
  const launchBat = path.join(installDir, 'TerraFlow.bat');
  fs.writeFileSync(launchBat, `@echo off\r\n"${nodeExe}" "${mjs}" launch --quiet\r\n`);

  const launchVbs = path.join(installDir, 'TerraFlow.vbs');
  fs.writeFileSync(
    launchVbs,
    `Set sh = CreateObject("Wscript.Shell")\r\nsh.CurrentDirectory = ${q(installDir)}\r\n${vbsRun(nodeExe, mjs, 'launch --quiet')}\r\n`
  );

  const startupVbs = path.join(installDir, 'startup.vbs');
  fs.writeFileSync(
    startupVbs,
    `Set sh = CreateObject("Wscript.Shell")\r\nsh.CurrentDirectory = ${q(installDir)}\r\n${vbsRun(nodeExe, mjs, 'launch --quiet --no-browser')}\r\n`
  );

  const uninstallCmd = path.join(installDir, 'uninstall.cmd');
  fs.writeFileSync(uninstallCmd, `@echo off\r\n"${nodeExe}" "${mjs}" uninstall\r\npause\r\n`);

  log.info(`launcher written: ${launchVbs}`);
  log.info(`double-click ${launchVbs} to run TerraFlow; startup.vbs handles login autostart`);
}
