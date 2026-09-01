import path from 'path';
import { autostartStatus, disableAutostart, enableAutostart } from './autostart.js';
import { install } from './installer.js';
import { createLogger } from './log.js';
import { defaultInstallDir, logDir, runtimeIsValid } from './paths.js';
import { launch, oneShotHealth, status, stop } from './runtime.js';

const HELP = `TerraFlow Desktop Runtime

Usage: terraflow <command> [options]

Commands:
  launch        Ensure infra (Docker/Postgres), start + supervise the Core API,
                then open the browser. Idempotent.
  stop          Stop the local API and its supervisor.
  status        Report runtime state as JSON.
  health        One-shot API health check (exit 0 when healthy).
  install       Stage the Core runtime into the install dir.
  uninstall     Stop processes, remove autostart (keeps data unless --purge).
  autostart     Show/on/off the login autostart registration.

Options:
  --core <dir>      (launch/install) use a Core checkout as the runtime dir.
  --install-dir <d> override the install directory (default %LOCALAPPDATA%\\\\TerraFlow).
  --no-browser      do not open the browser (used by autostart).
  --no-db           skip Docker/Postgres bootstrap.
  --foreground      run the supervisor attached to this terminal (Ctrl+C to stop).
  --deps            (install) run npm ci --omit=dev after staging.
  --purge           (uninstall) delete the install dir too.
  --quiet           suppress console output (logs still written).
  help              show this help.

The runtime is consumable as a library: import { launch, stop, status }
from 'src/runtime.js' for a programmatic API.
`;

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
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
  const a = args(argv);
  const command = a._[0] || 'help';
  const quiet = Boolean(a.quiet);

  switch (command) {
    case 'help':
      console.log(HELP);
      return 0;

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

async function cmdLaunch(a, quiet) {
  const dir = runtimeDirOf(a);
  if (!runtimeIsValid(dir)) {
    console.error(`[terraflow] ${dir} is not a valid TerraFlow runtime (run 'terraflow install --core <core>')`);
    return 1;
  }
  const res = await launch({
    runtimeDir: dir,
    foreground: Boolean(a.foreground),
    openBrowser: !a['no-browser'],
    withDb: !a['no-db'],
    quiet,
  });
  if (res.status === 'port-conflict') return 1;
  if (!quiet) {
    console.log(JSON.stringify(res, null, 2));
  }
  return res.status === 'already-running' || res.status === 'started' ? 0 : 1;
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
  return 0;
}