import fs from 'fs';
import path from 'path';

export function createLogger({ dir = null, tee = true } = {}) {
  const file = dir ? path.join(dir, 'runtime.log') : null;
  if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
  const write = (level, msg) => {
    if (!file) return;
    try {
      fs.appendFileSync(file, `${new Date().toISOString()}  ${level}  ${msg}\n`);
    } catch {}
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