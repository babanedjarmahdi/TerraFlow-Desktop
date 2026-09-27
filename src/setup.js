import path from 'path';
import { fileURLToPath } from 'url';
import { enableAutostart, isWindows } from './autostart.js';
import { install } from './installer.js';
import { launch } from './runtime.js';
import { runtimeIsValid } from './paths.js';
import { psQuote, runPowerShell } from './powershell.js';
import { createShortcuts } from './shortcuts.js';

const DESKTOP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function coreCandidateRoots({ root = DESKTOP_ROOT, env = process.env } = {}) {
  return [
    env.TERRAFLOW_CORE_DIR,
    path.join(root, 'core'),
    path.join(root, 'TerraFlow-Core'),
    path.join(root, 'terraflow-core'),
    path.resolve(root, '..', 'TerraFlow-Core'),
    path.resolve(root, '..', 'terraflow-core'),
    path.resolve(root, '..', 'TerraFlow'),
    path.resolve(root, '..', 'New folder (2)'),
  ].filter(Boolean);
}

export function findCoreDir({ roots = coreCandidateRoots() } = {}) {
  for (const r of roots) {
    try {
      if (runtimeIsValid(r)) return path.resolve(r);
    } catch {
      /* unreadable candidate - keep looking */
    }
  }
  return null;
}

export async function pickCoreDir({ description = 'Select the TerraFlow Core folder' } = {}) {
  if (!isWindows()) return null;
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = ${psQuote(description)}
$d.ShowNewFolderButton = $false
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output ('PICKED:' + $d.SelectedPath)
}
`;
  const r = await runPowerShell(script, [], { timeoutMs: 0 });
  if (r.code !== 0) return null;
  const line = r.out.split(/\r?\n/).find((l) => l.startsWith('PICKED:'));
  return line ? line.slice(7) : null;
}

export async function setup({
  installDir,
  coreDir = null,
  log,
  quiet = false,
  withDeps = true,
  autostart = true,
  launchApp = true,
  openBrowser = true,
  desktopDir = '',
  startMenuDir = '',
  roots = null,
  picker = null,
}) {
  let core = coreDir ? path.resolve(coreDir) : null;
  if (core && !runtimeIsValid(core)) {
    throw new Error(`not a TerraFlow Core checkout: ${core}`);
  }
  if (!core) {
    core = findCoreDir({ roots: roots || coreCandidateRoots() });
  }

  const usePicker =
    picker === null || picker === undefined
      ? Boolean(isWindows() && process.stdout.isTTY && !process.env.TERRAFLOW_NO_PICKER)
      : Boolean(picker);

  if (!core && usePicker) {
    if (log) log.info('Core not found in known locations - please pick the Core folder in the dialog');
    core = await pickCoreDir();
  }

  if (!core || !runtimeIsValid(core)) {
    throw new Error(
      `TerraFlow Core not found. Put the Core checkout in "${path.join(DESKTOP_ROOT, 'core')}", ` +
        'set TERRAFLOW_CORE_DIR, pass --core <dir>, or re-run setup and pick the folder in the dialog.'
    );
  }

  const dir = await install({ coreDir: core, installDir, log, withDeps });

  const iconPath = path.join(dir, 'assets', 'terraflow.ico');
  const shortcuts = await createShortcuts({ installDir: dir, desktopDir, startMenuDir, iconPath });
  if (log) {
    if (shortcuts.ok) log.info('desktop and Start Menu shortcuts created');
    else if (shortcuts.supported) log.warn(`shortcuts not created: ${shortcuts.error}`);
  }

  let as = { enabled: false, skipped: true };
  if (autostart) {
    as = await enableAutostart(dir);
    if (as.enabled) {
      if (log) log.info('TerraFlow will start automatically at login');
    } else if (isWindows() && log) {
      log.warn(`autostart not enabled: ${as.error || as.reason || 'unknown reason'}`);
    }
  }

  let launched = null;
  if (launchApp) {
    launched = await launch({ runtimeDir: dir, log, openBrowser, quiet });
  }

  return { installDir: dir, coreDir: core, shortcuts, autostart: as, launch: launched };
}
