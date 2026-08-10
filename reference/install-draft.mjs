#!/usr/bin/env node
// TerraFlow desktop installer.
// Copies the API + engine + built web into %LOCALAPPDATA%\TerraFlow, installs
// production deps, writes launcher/autostart scripts, and registers run-on-login.
// Usage: node scripts/desktop/install.mjs
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const INSTALL = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'TerraFlow')
  : path.join(process.env.HOME || process.env.USERPROFILE, 'TerraFlow');

function log(m) { console.log(`  ${m}`); }
function copyTree(src, dst, filter) {
  fs.cpSync(src, dst, {
    recursive: true,
    filter: filter || (() => true),
  });
}
const skipJunk = (s) => {
  const b = path.basename(s);
  if (b === 'node_modules' || b === '.git' || b === '.vite') return false;
  return true;
};

log(`Installing TerraFlow desktop build to:\n  ${INSTALL}\n`);
if (fs.existsSync(INSTALL)) {
  log('Removing previous install...');
  fs.rmSync(INSTALL, { recursive: true, force: true });
}
fs.mkdirSync(INSTALL, { recursive: true });

// --- Runtime tree ----------------------------------------------------------
const topFiles = ['package.json', 'package-lock.json', 'docker-compose.yml', '.env'];
for (const f of topFiles) {
  const s = path.join(REPO, f);
  if (fs.existsSync(s)) fs.copyFileSync(s, path.join(INSTALL, f));
  else log(`WARN: missing ${f}`);
}

for (const pkg of fs.readdirSync(path.join(REPO, 'packages'))) {
  copyTree(path.join(REPO, 'packages', pkg), path.join(INSTALL, 'packages', pkg), skipJunk);
}
copyTree(path.join(REPO, 'apps/api/src'), path.join(INSTALL, 'apps/api/src'), skipJunk);
fs.copyFileSync(path.join(REPO, 'apps/api/package.json'), path.join(INSTALL, 'apps/api/package.json'));
if (fs.existsSync(path.join(REPO, 'apps/api/public'))) {
  copyTree(path.join(REPO, 'apps/api/public'), path.join(INSTALL, 'apps/api/public'), skipJunk);
}
if (fs.existsSync(path.join(REPO, 'output'))) {
  copyTree(path.join(REPO, 'output'), path.join(INSTALL, 'output'), skipJunk);
}
log('Copied app + web build + data');

// --- Helper scripts (written at install time so paths are absolute) --------
const runPs1 = `param([switch]$OpenBrowser)
$ErrorActionPreference = "Continue"
$App = $PSScriptRoot
$logDir = Join-Path $App "output\\logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
function Write-Log($m) { Add-Content -Path (Join-Path $logDir "launcher.log") -Value ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m) }
Set-Location $App
$quiet = { try { [bool](Test-NetConnection localhost -Port $args[0] -InformationLevel Quiet -WarningAction SilentlyContinue) } catch { $false } }
$pgUp = & $quiet 5432
if (-not $pgUp) {
  Write-Log "Postgres down - starting Docker Desktop"
  $dd = "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"
  if (Test-Path $dd) { Start-Process $dd | Out-Null }
  $dockerReady = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 3
    & docker info 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $dockerReady = $true; break }
  }
  if ($dockerReady) {
    & docker compose up -d 2>&1 | Out-Null
    for ($i = 0; $i -lt 40; $i++) {
      Start-Sleep -Seconds 3
      $pgUp = & $quiet 5432
      if ($pgUp) { break }
    }
  } else { Write-Log "Docker did not start in time" }
}
Write-Log ("Postgres up: " + $pgUp)
$srvUp = & $quiet 3000
if (-not $srvUp) {
  Write-Log "Starting TerraFlow server"
  Start-Process -FilePath "node" -ArgumentList "apps/api/src/server.js" -WorkingDirectory $App -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "server.log") -RedirectStandardError (Join-Path $logDir "server.err.log") | Out-Null
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 600
    $srvUp = & $quiet 3000
    if ($srvUp) { break }
  }
}
Write-Log ("Server up: " + $srvUp)
if ($OpenBrowser -and $srvUp) { Start-Process "http://localhost:3000" | Out-Null }
`;

const vbs = (withBrowser) => `Set sh = CreateObject("Wscript.Shell")
sh.CurrentDirectory = "${INSTALL.replace(/\\/g, '\\\\')}"
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & "${INSTALL.replace(/\\/g, '\\\\')}\\run.ps1"${withBrowser ? ' -OpenBrowser' : ''}""", 0, False
`;

fs.writeFileSync(path.join(INSTALL, 'run.ps1'), runPs1);
fs.writeFileSync(path.join(INSTALL, 'TerraFlow.vbs'), vbs(true));
fs.writeFileSync(path.join(INSTALL, 'startup.vbs'), vbs(false));
fs.writeFileSync(path.join(INSTALL, 'uninstall.cmd'),
  `@echo off` + '\r\n' +
  `reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v TerraFlow /f >nul 2>&1` + '\r\n' +
  `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -like '*` + INSTALL.replace(/\\/g, '\\\\') + `*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"` + '\r\n' +
  `echo TerraFlow removed. Delete the folder to finish.` + '\r\n');
log('Wrote launcher/autostart scripts');

// --- Production deps -------------------------------------------------------
log('Installing production dependencies (npm ci --omit=dev)...');
const res = spawnSync('npm.cmd', ['ci', '--omit=dev'], { cwd: INSTALL, shell: true, stdio: 'inherit' });
if (res.status !== 0) {
  console.error('npm ci failed. The app may still run if node_modules already exist.');
}

// --- Autostart on login -----------------------------------------------------
const reg = spawnSync('reg', [
  'add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  '/v', 'TerraFlow', '/t', 'REG_SZ',
  '/d', `wscript.exe "${path.join(INSTALL, 'startup.vbs')}"`,
  '/f',
]);
if (reg.status === 0) log('Registered TerraFlow to start on login');
else { console.error(reg.stderr ? reg.stderr.toString() : 'reg add failed'); process.exitCode = 1; }

console.log(`\nDone. Launch now with:\n  wscript "${path.join(INSTALL, 'TerraFlow.vbs')}"\nor double-click TerraFlow.vbs in the install folder.`);
console.log(`Autostart on login: registered (startup.vbs). Uninstall: run uninstall.cmd in the install folder.`);
