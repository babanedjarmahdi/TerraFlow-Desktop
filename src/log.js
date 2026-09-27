import fs from 'fs';
import path from 'path';

export function createLogger({ dir = null, tee = true } = {}) {
  const file = dir ? path.join(dir, 'runtime.log') : null;
  let fd = null;

  const getFd = () => {
    if (fd !== null) return fd;
    if (!file) return null;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fd = fs.openSync(file, 'a');
    } catch {
      fd = null;
    }
    return fd;
  };

  const write = (level, msg) => {
    const f = getFd();
    if (f === null) return;
    try {
      fs.writeSync(f, `${new Date().toISOString()}  ${level}  ${msg}\n`);
    } catch {
      try {
        fs.closeSync(f);
      } catch {}
      fd = null;
    }
  };

  return {
    info(msg) {
      write('INFO', msg);
      if (tee) console.log(`[terraflow] ${msg}`);
    },
    warn(msg) {
      write('WARN', msg);
      if (tee) console.warn(`[terraflow] WARN ${msg}`);
    },
    error(msg) {
      write('ERROR', msg);
      if (tee) console.error(`[terraflow] ERROR ${msg}`);
    },
  };
}

export const quietLogger = {
  info() {},
  warn() {},
  error() {},
};
