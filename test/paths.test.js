import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { defaultInstallDir, logDir, runtimeIsValid, stateFile } from '../src/paths.js';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tf-paths-'));
}

test('logDir / stateFile layout', () => {
  const d = 'C:\\tf';
  assert.equal(logDir(d), path.join(d, 'output', 'logs'));
  assert.equal(stateFile(d), path.join(d, 'output', 'logs', 'supervisor.json'));
});

test('runtimeIsValid: false for empty dir', () => {
  const dir = tmpdir();
  assert.equal(runtimeIsValid(dir), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runtimeIsValid: true for staged Core layout', () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, 'apps', 'api', 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'apps', 'api', 'src', 'server.js'), '// server');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  assert.equal(runtimeIsValid(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runtimeIsValid: missing package.json is invalid', () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, 'apps', 'api', 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'apps', 'api', 'src', 'server.js'), '// server');
  assert.equal(runtimeIsValid(dir), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('defaultInstallDir honors TERRAFLOW_INSTALL_DIR', () => {
  const prev = process.env.TERRAFLOW_INSTALL_DIR;
  process.env.TERRAFLOW_INSTALL_DIR = path.join(os.tmpdir(), 'tf-install-override');
  try {
    assert.equal(defaultInstallDir(), path.join(process.env.TERRAFLOW_INSTALL_DIR, 'TerraFlow'));
  } finally {
    if (prev === undefined) delete process.env.TERRAFLOW_INSTALL_DIR;
    else process.env.TERRAFLOW_INSTALL_DIR = prev;
  }
});
