import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';
import { webBundleExists } from './api.js';

const DESKTOP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOP_LEVEL_FILES = ['package.json', 'package-lock.json', 'docker-compose.yml'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.vite', 'dist', 'coverage', '.vercel']);

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export async function install({ coreDir, installDir, log, withDeps = true }) {
  if (!fs.existsSync(path.join(coreDir, 'package.json'))) {
    throw new Error(`not a TerraFlow Core checkout: ${coreDir}`);
  }
  if (!fs.existsSync(path.join(coreDir, 'apps', 'api', 'src', 'server.js'))) {
    throw new Error(`missing Core API entry in ${coreDir}`);
  }

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
    fs.copyFileSync(envSrc, path.join(installDir, '.env'));
  }

  copyTree(path.join(coreDir, 'packages'), path.join(installDir, 'packages'));
  copyTree(path.join(coreDir, 'apps', 'api', 'src'), path.join(installDir, 'apps', 'api', 'src'));
  copyTree(path.join(coreDir, 'apps', 'api', 'public'), path.join(installDir, 'apps', 'api', 'public'));

  const apiPkg = path.join(coreDir, 'apps', 'api', 'package.json');
  if (fs.existsSync(apiPkg)) fs.copyFileSync(apiPkg, path.join(installDir, 'apps', 'api', 'package.json'));

  const hasUserData =
    fs.existsSync(path.join(installDir, 'output', 'jobs')) ||
    fs.existsSync(path.join(installDir, 'output', 'json')) ||
    fs.existsSync(path.join(installDir, 'output', 'templates'));
  if (!hasUserData) {
    copyTree(path.join(coreDir, 'output'), path.join(installDir, 'output'), ['logs', 'watcher.log']);
  } else {
    log.info('existing data dir preserved (upgrade-safe)');
  }

  copyTree(path.join(DESKTOP_ROOT, 'bin'), path.join(installDir, 'bin'));
  copyTree(path.join(DESKTOP_ROOT, 'src'), path.join(installDir, 'src'));
  fs.copyFileSync(path.join(DESKTOP_ROOT, 'package.json'), path.join(installDir, 'desktop-package.json'));

  if (!webBundleExists(installDir)) {
    log.warn('no web bundle found in Core apps/api/public - UI will 404 until a build is staged (watchers still run via API)');
  }

  if (withDeps) {
    const res = await runNpmCi(installDir);
    if (res.code !== 0) {
      log.warn('npm ci failed - install may still run if node_modules already exist');
    } else {
      log.info('production dependencies installed');
    }
  }

  const { nodeExe, mjs } = { nodeExe: process.execPath, mjs: path.join(installDir, 'bin', 'terraflow.mjs') };
  generateScripts({ installDir, nodeExe, mjs, log });

  return installDir;
}

function copyTree(src, dst, skip = SKIP_DIRS) {
  if (!fs.existsSync(src)) return;
  const skipSet = skip instanceof Set ? skip : new Set(skip);
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (skipSet.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyTree(from, to, skipSet);
    else fs.copyFileSync(from, to);
  }
}

function runNpmCi(cwd) {
  return new Promise((resolve) => {
    const args =
      process.platform === 'win32'
        ? ['/d', '/s', '/c', `${npmCmd} ci --omit=dev`]
        : ['ci', '--omit=dev'];
    const child = spawn(process.platform === 'win32' ? 'cmd.exe' : npmCmd, args, {
      cwd,
      windowsHide: true,
      stdio: 'inherit',
    });
    child.on('close', (code) => resolve({ code }));
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
  writeFileSync(launchBat, `@echo off\r\n"${nodeExe}" "${mjs}" launch --quiet\r\n`);

  const launchVbs = path.join(installDir, 'TerraFlow.vbs');
  writeFileSync(
    launchVbs,
    `Set sh = CreateObject("Wscript.Shell")\r\nsh.CurrentDirectory = ${q(installDir)}\r\n${vbsRun(nodeExe, mjs, 'launch --quiet')}\r\n`
  );

  const startupVbs = path.join(installDir, 'startup.vbs');
  writeFileSync(
    startupVbs,
    `Set sh = CreateObject("Wscript.Shell")\r\nsh.CurrentDirectory = ${q(installDir)}\r\n${vbsRun(nodeExe, mjs, 'launch --quiet --no-browser')}\r\n`
  );

  const uninstallCmd = path.join(installDir, 'uninstall.cmd');
  writeFileSync(uninstallCmd, `@echo off\r\n"${nodeExe}" "${mjs}" uninstall\r\npause\r\n`);

  log.info(`launcher written: ${launchVbs}`);
  log.info(`double-click ${launchVbs} to run TerraFlow; startup.vbs handles login autostart`);
}