#!/usr/bin/env node
// Builds the downloadable one-click Windows installer:
//
//   release/TerraFlow-Setup.exe           - Inno Setup installer (bundles node.exe)
//   release/TerraFlow-Desktop-Setup.iss   - Inno Setup script (for recompiling)
//   release/TerraFlow-Desktop.zip         - portable ZIP (no Node install needed)
//   release/TerraFlow-Desktop/            - staged runtime (sources + prod deps + node.exe)
//
// The staged runtime is exactly what `terraflow install` produces, but the
// launchers embed a bundled node.exe so a clean machine needs nothing preinstalled.
// Launchers resolve their own location at runtime (WScript.ScriptFullName / %~dp0)
// so the bundle is relocatable, not pinned to the build machine.
//
// Usage: node scripts/build-release.mjs [--core <dir>] [--no-exe]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { install } from '../src/installer.js';
import { findCoreDir, coreCandidateRoots } from '../src/setup.js';
import { runtimeIsValid } from '../src/paths.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = path.join(ROOT, 'release');
const APP_DIR = path.join(RELEASE, 'TerraFlow-Desktop');

const quietLog = {
  info: () => {},
  warn: (m) => console.warn(`[release] ${m}`),
  error: (m) => console.error(`[release] ${m}`),
};

function resolveCore() {
  const argv = process.argv.slice(2);
  let explicit = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--core' && argv[i + 1]) explicit = path.resolve(argv[i + 1]);
  }
  const noExe = argv.includes('--no-exe');
  const core = explicit || findCoreDir({ roots: coreCandidateRoots() });
  if (!core) {
    console.error('[release] Core checkout not found. Pass --core <dir> or set TERRAFLOW_CORE_DIR.');
    process.exit(1);
  }
  if (!runtimeIsValid(core)) {
    console.error(`[release] not a valid Core checkout: ${core}`);
    process.exit(1);
  }
  return { core, noExe };
}

function stage() {
  fs.rmSync(APP_DIR, { recursive: true, force: true });
  fs.mkdirSync(APP_DIR, { recursive: true });
  console.log(`[release] staging runtime at ${APP_DIR}`);
}

async function main() {
  const { core, noExe } = resolveCore();
  console.log(`[release] core: ${core}`);
  stage();

  await install({
    coreDir: core,
    installDir: APP_DIR,
    log: quietLog,
    withDeps: true,
    desktopDir: ROOT,
    recordSource: false,
  });

  const nodeExe = process.execPath;
  fs.mkdirSync(path.join(APP_DIR, 'bin'), { recursive: true });
  fs.copyFileSync(nodeExe, path.join(APP_DIR, 'bin', 'node.exe'));
  console.log(`[release] bundled node ${process.version} (bin/node.exe)`);

  const stagedOut = path.join(APP_DIR, 'output');
  if (fs.existsSync(stagedOut)) {
    fs.rmSync(stagedOut, { recursive: true, force: true });
    console.log('[release] excluded dev output/ (fresh install starts clean; existing install keeps its data)');
  }

  writeLaunchers(APP_DIR);
  writeInno(RELEASE, version());

  if (!noExe && process.platform === 'win32') {
    compileSetup(RELEASE);
  } else {
    console.log('[release] skipping Setup.exe compile (--no-exe or non-Windows)');
  }

  console.log('[release] compressing portable zip (can take a minute)');
  const zipOut = path.join(RELEASE, 'TerraFlow-Desktop.zip');
  fs.rmSync(zipOut, { force: true });
  const ps = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `[System.IO.Compression.ZipFile]::CreateFromDirectory(${JSON.stringify(APP_DIR)}, ${JSON.stringify(zipOut)})`,
  ].join('; ');
  const r = spawnSync(
    `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    ['-NoProfile', '-Command', ps],
    { stdio: 'inherit', windowsHide: true }
  );
  if (r.status !== 0) {
    console.error('[release] zip creation failed');
    process.exit(1);
  }
  const mb = (fs.statSync(zipOut).size / 1024 / 1024).toFixed(1);
  console.log(`[release] done: ${zipOut} (${mb} MB)`);
  console.log('[release] next: copy TerraFlow-Setup.exe to apps/web/public/downloads/ (or Vercel env VITE_DESKTOP_DOWNLOAD_URL)');
}

function version() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function write(s, content) {
  fs.writeFileSync(s, content, 'utf8');
}

// Runtime-relative VBS launcher: resolves its own folder from ScriptFullName so
// the bundle works wherever the user unzips/installs it (no build paths baked in).
function vbsRun(flags) {
  return [
    'Set sh = CreateObject("Wscript.Shell")',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'base = fso.GetParentFolderName(WScript.ScriptFullName)',
    'sh.CurrentDirectory = base',
    `sh.Run """" & base & "\\bin\\node.exe"" """ & base & "\\bin\\terraflow.mjs"" ${flags}", 0, False`,
    '',
  ].join('\r\n');
}

function writeLaunchers(dir) {
  write(
    path.join(dir, 'TerraFlow.cmd'),
    '@echo off\r\ncd /d "%~dp0"\r\n"%~dp0bin\\node.exe" "%~dp0bin\\terraflow.mjs" launch --quiet\r\n'
  );
  write(path.join(dir, 'TerraFlow.bat'), '@echo off\r\ncd /d "%~dp0"\r\n"%~dp0bin\\node.exe" "%~dp0bin\\terraflow.mjs" launch --quiet\r\n');
  write(path.join(dir, 'TerraFlow.vbs'), vbsRun('launch --quiet'));
  write(path.join(dir, 'startup.vbs'), vbsRun('launch --quiet --no-browser'));
  write(
    path.join(dir, 'uninstall.cmd'),
    '@echo off\r\ncd /d "%~dp0"\r\n"%~dp0bin\\node.exe" "%~dp0bin\\terraflow.mjs" uninstall --purge\r\n'
  );
  console.log('[release] relocatable launchers written (no build-machine paths)');
}

function writeInno(release, ver) {
  const lines = [
    `#define MyAppName "TerraFlow Desktop"`,
    `#define MyAppVersion "${ver}"`,
    `#define MyAppExeName "TerraFlow.vbs"`,
    ``,
    `[Setup]`,
    `AppId={{9F7C39A2-5B4E-4F3A-9D2C-1E6B8A4D7C01}}`,
    `AppName={#MyAppName}`,
    `AppVersion={#MyAppVersion}`,
    `AppPublisher=TerraFlow`,
    `DefaultDirName={localappdata}\\TerraFlow`,
    `DisableProgramGroupPage=yes`,
    `ShowLanguageDialog=no`,
    `PrivilegesRequired=lowest`,
    `CloseApplications=yes`,
    `UninstallDisplayIcon={app}\\bin\\node.exe`,
    `OutputDir=.`,
    `Compression=lzma2`,
    `SolidCompression=yes`,
    `OutputBaseFilename=TerraFlow-Setup`,
    ``,
    `[Languages]`,
    `Name: "english"; MessagesFile: "compiler:Default.isl"`,
    ``,
    `[Tasks]`,
    `Name: "autostart"; Description: "Start TerraFlow automatically when I log in"; Flags: checkedonce`,
    `Name: "desktopicon"; Description: "Create a desktop &shortcut"; Flags: checkedonce`,
    ``,
    `[Files]`,
    `Source: "TerraFlow-Desktop\\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs`,
    ``,
    `[Icons]`,
    `Name: "{autoprograms}\\{#MyAppName}"; Filename: "{app}\\{#MyAppExeName}"; WorkingDir: "{app}"`,
    `Name: "{autodesktop}\\{#MyAppName}"; Filename: "{app}\\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon`,
    ``,
    `[Registry]`,
    `Root: HKCU; Subkey: "Software\\Microsoft\\Windows\\CurrentVersion\\Run"; ValueType: string; ValueName: "TerraFlow"; ValueData: "wscript.exe ""{app}\\startup.vbs"""; Flags: uninsdeletevalue; Tasks: autostart`,
    ``,
    `[UninstallRun]`,
    `Filename: "{app}\\bin\\node.exe"; Parameters: "{app}\\bin\\terraflow.mjs uninstall"; Flags: runhidden`,
  ];
  const iss = path.join(release, 'TerraFlow-Desktop-Setup.iss');
  write(iss, lines.join('\n'));
  console.log(`[release] Inno script: ${iss}`);
}

function compileSetup(release) {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
    'ISCC.exe',
  ];
  const iscc = candidates.find(fs.existsSync);
  if (!iscc) {
    console.error('[release] Inno Setup (ISCC.exe) not found - run --no-exe or install Inno Setup 6');
    process.exit(1);
  }
  const iss = path.join(release, 'TerraFlow-Desktop-Setup.iss');
  const out = path.join(release, 'TerraFlow-Setup.exe');
  fs.rmSync(out, { force: true });
  const r = spawnSync(iscc, [iss], { cwd: release, stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) {
    throw new Error(`ISCC failed (${r.status})`);
  }
  if (fs.existsSync(out)) {
    console.log(`[release] Setup.exe: ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
  }
}

main().catch((err) => {
  console.error(`[release] failed: ${err?.stack || err}`);
  process.exitCode = 1;
});