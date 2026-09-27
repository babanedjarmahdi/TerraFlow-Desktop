import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { install, readSourceRecord, sourceRecordPath } from './installer.js';
import { defaultInstallDir } from './paths.js';

// Syncs the installed runtime with the Core + Desktop checkouts that staged it.
// The install dir is a static copy; edits in the repos never reach it on their
// own. `update` re-runs the staging step (upgrade-safe: preserves output/ and
// .env) so the running program tracks the repos without a full reinstall.

const WATCHED = ['packages', 'apps/api/src', 'apps/api/public', 'apps/api/package.json'];

function describeSource(installDir) {
  const rec = readSourceRecord(installDir);
  if (!rec) return null;
  return {
    installSource: rec,
    coreDir: rec.coreDir && fs.existsSync(rec.coreDir) ? rec.coreDir : null,
    desktopDir: rec.desktopDir && fs.existsSync(rec.desktopDir) ? rec.desktopDir : null,
  };
}

export function coreHead(coreDir) {
  try {
    const r = spawnSync('git', ['-C', coreDir, 'rev-parse', '--short', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return r.status === 0 ? String(r.stdout).trim() : null;
  } catch {
    return null;
  }
}

// Cheap change detector: mtime+size of every watched file under the source
// trees. A changed signature means a re-stage will pick something new up.
export function sourceSignature({ coreDir, desktopDir }) {
  const files = new Set();
  const walk = (dir, prefix = '') => {
    let st;
    try {
      st = fs.statSync(dir);
    } catch {
      return;
    }
    if (st.isFile()) {
      files.add({ rel: prefix, full: dir });
      return;
    }
    if (!st.isDirectory()) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) files.add({ rel, full });
    }
  };
  for (const w of WATCHED) walk(path.join(coreDir, w), w);
  walk(path.join(desktopDir, 'src'), 'desktop/src');
  walk(path.join(desktopDir, 'bin'), 'desktop/bin');
  walk(path.join(desktopDir, 'installer'), 'desktop/installer');
  walk(path.join(desktopDir, 'assets'), 'desktop/assets');

  let h = 0;
  for (const { rel, full } of [...files].sort((a, b) => a.rel.localeCompare(b.rel))) {
    try {
      const st = fs.statSync(full);
      h = (h * 31 + st.size) | 0;
      h = (h * 31 + Math.floor(st.mtimeMs)) | 0;
    } catch {
      /* ignore vanishing files */
    }
  }
  return h >>> 0;
}

const SKIP = new Set(['node_modules', '.git', 'dist', '.vite', 'output', 'coverage', '.vercel']);

function readSignature(installDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(installDir, 'output', '.signature.json'), 'utf8'));
  } catch {
    return null;
  }
}

function writeSignature(installDir, sig) {
  fs.mkdirSync(path.join(installDir, 'output'), { recursive: true });
  fs.writeFileSync(path.join(installDir, 'output', '.signature.json'), JSON.stringify(sig), 'utf8');
}

export const SOURCE_MISSING = 'no-source';

// Returns { status, reason, changed, coreDir, desktopDir, head, stagedAt }.
// status: 'clean' | 'staged' | 'no-source' | 'error'
export async function update({ installDir, log, force = false, withDeps = false, quiet = false }) {
  const logFn = log || {
    info: quiet ? () => {} : (m) => console.log(`[terraflow] ${m}`),
    warn: quiet ? () => {} : (m) => console.warn(`[terraflow] WARN ${m}`),
    error: quiet ? () => {} : (m) => console.error(`[terraflow] ERROR ${m}`),
  };

  const src = describeSource(installDir);
  if (!src || !src.coreDir || !src.desktopDir) {
    logFn.warn('no recorded source checkout — run `terraflow setup` once, then updates auto-sync');
    return { status: SOURCE_MISSING, reason: 'no-source' };
  }

  const { coreDir, desktopDir } = src;
  const head = coreHead(coreDir);
  const sig = sourceSignature({ coreDir, desktopDir });
  const prev = readSignature(installDir);
  const changed = !prev || prev.signature !== sig || (head && prev.head !== head);

  if (!force && !changed) {
    logFn.info('installed runtime is current (no changes detected)');
    return { status: 'clean', changed: false, coreDir, desktopDir, head, stagedAt: prev?.stagedAt || null };
  }

  logFn.info(`syncing installed runtime from Core (${coreDir})${head ? ` @ ${head}` : ''}...`);
  const desktopDirArg = src.installSource.desktopDir || desktopDir;
  const dir = await install({
    coreDir,
    installDir,
    log: logFn,
    withDeps,
    desktopDir: desktopDirArg,
  });

  writeSignature(installDir, { signature: sig, head, stagedAt: new Date().toISOString() });
  logFn.info(`installed runtime synced: ${dir}`);
  return { status: 'staged', changed: true, coreDir, desktopDir, head, stagedAt: new Date().toISOString() };
}

export function installedSourceInfo(installDir = defaultInstallDir()) {
  const rec = readSourceRecord(installDir);
  if (!rec) return { record: null, coreDir: null, desktopDir: null, head: null };
  return {
    record: rec,
    coreDir: rec.coreDir && fs.existsSync(rec.coreDir) ? rec.coreDir : null,
    desktopDir: rec.desktopDir && fs.existsSync(rec.desktopDir) ? rec.desktopDir : null,
    head: coreHead(rec.coreDir),
    sourceFile: sourceRecordPath(installDir),
  };
}