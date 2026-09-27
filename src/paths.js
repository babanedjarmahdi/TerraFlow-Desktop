import fs from 'fs';
import os from 'os';
import path from 'path';

export function defaultInstallDir() {
  const base = process.env.TERRAFLOW_INSTALL_DIR
    || process.env.LOCALAPPDATA
    || process.env.APPDATA
    || os.homedir();
  return path.join(base, 'TerraFlow');
}

export function logDir(runtimeDir) {
  return path.join(runtimeDir, 'output', 'logs');
}

export function stateFile(runtimeDir) {
  return path.join(logDir(runtimeDir), 'supervisor.json');
}

export function sourceFile(runtimeDir) {
  return path.join(runtimeDir, 'output', 'source.json');
}

export function runtimeIsValid(runtimeDir) {
  return (
    fs.existsSync(path.join(runtimeDir, 'apps', 'api', 'src', 'server.js')) &&
    fs.existsSync(path.join(runtimeDir, 'package.json'))
  );
}