import fs from 'fs';
import path from 'path';

export function readJson(file, fallback = null) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const stripped = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
    return JSON.parse(stripped);
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}