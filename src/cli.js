import fs from 'fs';
import path from 'path';
import { autostartStatus, disableAutostart, enableAutostart } from './autostart.js';
import { install } from './installer.js';
import { createLogger } from './log.js';
import { defaultInstallDir, logDir, runtimeIsValid } from './paths.js';
import { launch, oneShotHealth, status, stop } from './runtime.js';
import { setup } from './setup.js';
import { SOURCE_MISSING, update } from './updater.js';
import { isProcessAlive } from './api.js';
import { supervisorState } from './supervisor.js';

const PKG = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const HELP = `TerraFlow Desktop Runtime v${PKG.version}

Usage: terraflow <command> [options]

Commands:
  setup         One-click install: stages the Core, creates Desktop/Start Menu
                shortcuts, enables login autostart, then launches the app.
                Finds the Core via --core, TERRAFLOW_CORE_DIR, ./core/, or a
                folder picker dialog.
  launch        Ensure infra (Docker/Postgres), start + supervise the Core API,
                then open the browser. Idempotent. Re-stages changed sources
                first (auto-update) unless --no-update.
  update        Re-sync the installed runtime from the Core/Desktop checkouts
                that staged it, then restart the API if it was running.
  stop          Stop the local API and its supervisor.
  status        Report runtime state as JSON.
  health        One-shot API health check (exit 0 when healthy).
  install       Stage the Core runtime into the install dir.
  uninstall     Stop processes, remove autostart (keeps data unless --purge).
  autostart     Show/on/off the login autostart registration.
  version       Print the runtime version.
  help          Show this help.

Options:
  --core <dir>      (launch/install) use a Core checkout as the runtime dir.
  --install-dir <d> override the install directory (default %LOCALAPPDATA%\\\\TerraFlow).
  --no-browser      do not open the browser (used by autostart).
  --no-db           skip Docker/Postgres bootstrap.
  --no-update       (launch) skip the source re-sync (auto-update is on by default).
  --force-update    (update/launch) re-stage even if nothing changed.
  --foreground      run the supervisor attached to this terminal (Ctrl+C to stop).
  --deps            (install) run npm ci --omit=dev after staging.
  --no-deps         (setup) skip npm ci after staging.
  --no-autostart    (setup) do not register login autostart.
  --no-launch       (setup) do not start the app after install.
  --purge           (uninstall) delete the install dir too.
  --quiet           suppress console output (logs still written).

Environment:
  TERRAFLOW_PORT / PORT   API port (default 3000).
  TERRAFLOW_INSTALL_DIR   default install directory.
  TERRAFLOW_CORE_DIR      where to find the Core checkout on setup.
  TERRAFLOW_NO_UPDATE=1   disable the auto-update on launch.

The runtime is consumable as a library: import { launch, stop, status }
from 'src/runtime.js' for a programmatic API.
`;

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 2) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

export async function run(argv) {
  const a = parseArgs(argv);
  const command = a.version && !a._.length ? 'version' : a._[0] || 'help';
  const quiet = Boolean(a.quiet);

  switch (command) {
    case 'help':
      console.log(HELP);
      return 0;

    case 'version':
      console.log(PKG.version);
      return 0;

    case 'setup':
      return cmdSetup(a, quiet);

    case 'launch':
      return cmdLaunch(a, quiet);

    case 'stop':
      return cmdStop(a, quiet);

    case 'status':
      return cmdStatus(a, quiet);

    case 'health':
      return cmdHealth(a);

    case 'install':
      return cmdInstall(a, quiet);

    case 'update':
      return cmdUpdate(a, quiet);

    case 'uninstall':
      return cmdUninstall(a, quiet);

    case 'autostart':
      return cmdAutostart(a, quiet);

    default:
      console.error(`unknown command: ${command}\n`);
      console.log(HELP);
      return 2;
  }
}

function runtimeDirOf(a) {
  return a.core ? path.resolve(a.core) : path.resolve(a['install-dir'] || defaultInstallDir());
}

function loggerFor(dir, quiet) {
  return createLogger({ dir: logDir(dir), tee: !quiet });
}

async function cmdSetup(a, quiet) {
  const installDir = path.resolve(a['install-dir'] || defaultInstallDir());
  const coreDir = a.core ? path.resolve(a.core) : null;
  const log = loggerFor(installDir, quiet);
  const res = await setup({
    installDir,
    coreDir,
    log,
    quiet,
    withDeps: !a['no-deps'],
    autostart: !a['no-autostart'],
    launchApp: !a['no-launch'],
    openBrowser: !a['no-browser'],
  });
  if (!quiet) {
    console.log(
      JSON.stringify(
        {
          installDir: res.installDir,
          coreDir: res.coreDir,
          shortcuts: res.shortcuts,
          autostart: res.autostart,
          launch: res.launch,
        },
        null,
        2
      )
    );
  }
  if (res.launch?.status === 'port-conflict') {
    console.error('[terraflow] installed, but the API port is busy - click the TerraFlow shortcut later');
    return 1;
  }
  return 0;
}

async function cmdLaunch(a, quiet) {
  const dir = runtimeDirOf(a);
  if (!runtimeIsValid(dir)) {
    console.error(
      `[terraflow] ${dir} is not a valid TerraFlow runtime (run 'terraflow install --core <core>')`
    );
    return 1;
  }

  const autoUpdate = !a['no-update'] && process.env.TERRAFLOW_NO_UPDATE !== '1';
  if (autoUpdate) {
    const log = loggerFor(dir, quiet);
    const res = await update({ installDir: dir, log, force: Boolean(a['force-update']), quiet });
    if (res.status === 'staged') {
      log.info('sources changed - stopping runtime so the next start loads fresh code');
      await stop({ runtimeDir: dir, log });
    }
  }

  const res = await launch({
    runtimeDir: dir,
    foreground: Boolean(a.foreground),
    openBrowser: !a['no-browser'],
    withDb: !a['no-db'],
    quiet,
  });
  if (!quiet) console.log(JSON.stringify(res, null, 2));
  if (res.status === 'port-conflict') return 1;
  if (res.status === 'stopped') return 0;
  if (res.healthy === false) return 1;
  return 0;
}

async function cmdUpdate(a, quiet) {
  const dir = path.resolve(a['install-dir'] || defaultInstallDir());
  const log = loggerFor(dir, quiet);
  const wasRunning = supervisorState(dir)?.apiPid
    ? isProcessAlive(supervisorState(dir).apiPid)
    : false;
  const res = await update({
    installDir: dir,
    log,
    force: Boolean(a['force-update']),
    quiet,
  });
  if (!quiet) console.log(JSON.stringify(res, null, 2));
  if (res.status === SOURCE_MISSING) return 1;
  if (res.status === 'staged' && wasRunning) {
    log.info('restarting API with freshly staged code...');
    await stop({ runtimeDir: dir, log });
    const launchRes = await launch({ runtimeDir: dir, quiet, openBrowser: false });
    if (launchRes.healthy === false) return 1;
  }
  return 0;
}

async function cmdStop(a, quiet) {
  const dir = runtimeDirOf(a);
  const log = loggerFor(dir, quiet);
  const res = await stop({ runtimeDir: dir, log });
  if (!quiet) console.log(JSON.stringify(res, null, 2));
  return res.stopped ? 0 : 1;
}

async function cmdStatus(a, quiet) {
  const dir = runtimeDirOf(a);
  const log = loggerFor(dir, quiet);
  const res = await status({ runtimeDir: dir, log });
  if (!quiet) console.log(JSON.stringify(res, null, 2));
  return 0;
}

async function cmdHealth(a) {
  const dir = runtimeDirOf(a);
  const ok = await oneShotHealth({ runtimeDir: dir });
  if (!ok) {
    console.log('unhealthy');
    return 1;
  }
  console.log('healthy');
  return 0;
}

async function cmdInstall(a, quiet) {
  if (!a.core) {
    console.error('[terraflow] install requires --core <dir> pointing at the Core checkout');
    return 1;
  }
  const coreDir = path.resolve(a.core);
  const installDir = path.resolve(a['install-dir'] || defaultInstallDir());
  const log = loggerFor(installDir, quiet);
  const dir = await install({ coreDir, installDir, log, withDeps: Boolean(a.deps) });
  if (!quiet) console.log(`installed: ${dir}`);
  return 0;
}

async function cmdUninstall(a, quiet) {
  const dir = path.resolve(a['install-dir'] || defaultInstallDir());
  const log = loggerFor(dir, quiet);
  const { uninstall } = await import('./uninstaller.js');
  const res = await uninstall({ installDir: dir, log, purge: Boolean(a.purge) });
  if (!quiet) console.log(JSON.stringify(res, null, 2));
  return 0;
}

async function cmdAutostart(a, quiet) {
  const dir = path.resolve(a['install-dir'] || defaultInstallDir());
  const log = loggerFor(dir, quiet);
  const target = a._[1];
  let res;
  if (target === 'on') {
    res = await enableAutostart(dir);
  } else if (target === 'off') {
    res = await disableAutostart();
  } else {
    res = await autostartStatus();
  }
  if (!quiet) console.log(JSON.stringify(res, null, 2));
  if (target) log.info(`autostart ${target}: ${JSON.stringify(res)}`);
  if ((target === 'on' && res.enabled === false) || (target === 'off' && res.disabled === false)) return 1;
  return 0;
}
