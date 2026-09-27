import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createLogger, quietLogger } from '../src/log.js';
import { autostartStatus, disableAutostart, vbsPath, launchVbsPath, isWindows } from '../src/autostart.js';
import { activePid, isApiRunning, effectivePort, openDefaultBrowser } from '../src/runtime.js';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tf-log-'));
}

test('createLogger writes levels to runtime.log', () => {
  const dir = tmpdir();
  const log = createLogger({ dir, tee: false });
  log.info('hello-info');
  log.warn('hello-warn');
  log.error('hello-error');
  const body = fs.readFileSync(path.join(dir, 'runtime.log'), 'utf8');
  assert.match(body, /INFO {2}hello-info/);
  assert.match(body, /WARN {2}hello-warn/);
  assert.match(body, /ERROR {2}hello-error/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('createLogger: tee:false stays silent and no-dir logger is a no-op', () => {
  const bare = createLogger({ tee: false });
  bare.info('nowhere');
  quietLogger.info('nowhere');
  quietLogger.warn('nowhere');
  quietLogger.error('nowhere');
});

test('autostart paths', () => {
  assert.equal(vbsPath('C:\\tf'), path.join('C:\\tf', 'startup.vbs'));
  assert.equal(launchVbsPath('C:\\tf'), path.join('C:\\tf', 'TerraFlow.vbs'));
});

test('autostart API behaves safely on this platform', async () => {
  if (isWindows()) {
    const st = await autostartStatus();
    assert.equal(typeof st.registered, 'boolean');
    const dis = await disableAutostart();
    assert.equal(typeof dis.disabled, 'boolean');
  } else {
    const st = await autostartStatus();
    assert.equal(st.registered, false);
    assert.equal(st.reason, 'non-windows');
    const dis = await disableAutostart();
    assert.equal(dis.disabled, false);
  }
});

test('activePid: null when no pid file', () => {
  const dir = tmpdir();
  assert.equal(activePid(dir), null);
  assert.equal(isApiRunning(dir), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('effectivePort falls back to env/default', () => {
  const prev = process.env.TERRAFLOW_PORT;
  delete process.env.TERRAFLOW_PORT;
  const prevPort = process.env.PORT;
  delete process.env.PORT;
  try {
    assert.equal(effectivePort(tmpdir()), 3000);
  } finally {
    if (prev !== undefined) process.env.TERRAFLOW_PORT = prev;
    if (prevPort !== undefined) process.env.PORT = prevPort;
  }
});

test('openDefaultBrowser: does not throw for unreachable handlers', () => {
  const child = openDefaultBrowser('http://127.0.0.1:1/');
  if (child) child.unref?.();
});
