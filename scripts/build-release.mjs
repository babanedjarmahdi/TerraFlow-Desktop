#!/usr/bin/env node
// Builds the downloadable one-click installer bundle for the website:
//
//   release/TerraFlow-Setup.zip
//     ├── Install-TerraFlow.cmd   ← double-click entry
//     ├── bin/ src/ installer/ assets/ package.json README.md
//     └── core/                   ← Core checkout (auto-discovered by setup)
//
// Usage: node scripts/build-release.mjs [--core <dir>]
// Without --core, the Core is discovered via TERRAFLOW_CORE_DIR / ./core /
// sibling candidates (same discovery as `terraflow setup`).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { findCoreDir, coreCandidateRoots } from '../src/setup.js';
import { runtimeIsValid } from '../src/paths.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = path.join(ROOT, 'release');
const STAGE = path.join(RELEASE, 'stage');
const BUNDLE = path.join(STAGE, 'TerraFlow');
const ZIP = path.join(RELEASE, 'TerraFlow-Setup.zip');

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'output',
  'dist',
  'coverage',
  '.vercel',
  'release',
  'reference',
  'test',
  'docs',
  'downloads',
]);

const DESKTOP_DIRS = ['bin', 'src', 'installer', 'assets'];
const DESKTOP_FILES = ['Install-TerraFlow.cmd', 'package.json', 'README.md'];

function skipEntry(src) {
  const base = path.basename(src);
  if (SKIP_DIRS.has(base)) return true;
  if (base.endsWith('.log') || base.endsWith('.pid')) return true;
  if (base === '.env' || base === '.env.local' || base === '.env.production') return true;
  return false;
}

function resolveCore() {
  const argv = process.argv.slice(2);
  let explicit = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--core' && argv[i + 1]) explicit = path.resolve(argv[i + 1]);
  }
  const core = explicit || findCoreDir({ roots: coreCandidateRoots() });
  if (!core) {
    console.error(
      '[release] Core checkout not found. Pass --core <dir> or set TERRAFLOW_CORE_DIR.'
    );
    process.exit(1);
  }
  if (!runtimeIsValid(core)) {
    console.error(`[release] not a valid Core checkout: ${core}`);
    process.exit(1);
  }
  return core;
}

function stageDesktop() {
  for (const dir of DESKTOP_DIRS) {
    const src = path.join(ROOT, dir);
    if (!fs.existsSync(src)) {
      console.error(`[release] missing desktop directory: ${dir}`);
      process.exit(1);
    }
    fs.cpSync(src, path.join(BUNDLE, dir), { recursive: true, filter: (s) => !skipEntry(s) });
  }
  for (const file of DESKTOP_FILES) {
    const src = path.join(ROOT, file);
    if (!fs.existsSync(src)) {
      console.error(`[release] missing desktop file: ${file}`);
      process.exit(1);
    }
    fs.copyFileSync(src, path.join(BUNDLE, file));
  }
}

function stageCore(core) {
  fs.cpSync(core, path.join(BUNDLE, 'core'), { recursive: true, filter: (s) => !skipEntry(s) });
}

function verify() {
  const checks = [
    path.join(BUNDLE, 'Install-TerraFlow.cmd'),
    path.join(BUNDLE, 'bin', 'terraflow.mjs'),
    path.join(BUNDLE, 'core', 'package.json'),
    path.join(BUNDLE, 'core', 'apps', 'api', 'src', 'server.js'),
    path.join(BUNDLE, 'core', 'apps', 'api', 'public', 'index.html'),
    path.join(BUNDLE, 'core', 'docker-compose.yml'),
    path.join(BUNDLE, 'core', '.env.example'),
  ];
  for (const f of checks) {
    if (!fs.existsSync(f)) {
      console.error(`[release] bundle incomplete, missing: ${f}`);
      process.exit(1);
    }
  }
}

function compress() {
  fs.rmSync(ZIP, { force: true });
  const ps = [
    'Add-Type -AssemblyName System.IO.Compression',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `[System.IO.Compression.ZipFile]::CreateFromDirectory(${JSON.stringify(BUNDLE)}, ${JSON.stringify(
      ZIP
    )}, [System.IO.Compression.CompressionLevel]::Optimal, $false)`,
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
}

function main() {
  const core = resolveCore();
  console.log(`[release] core: ${core}`);
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(BUNDLE, { recursive: true });
  console.log('[release] staging desktop runtime...');
  stageDesktop();
  console.log('[release] staging core...');
  stageCore(core);
  verify();
  console.log('[release] compressing zip...');
  compress();
  const mb = (fs.statSync(ZIP).size / 1024 / 1024).toFixed(1);
  console.log(`[release] done: ${ZIP} (${mb} MB)`);
  console.log('[release] next: copy it to the website public/downloads/ and rebuild the web app');
}

main();
