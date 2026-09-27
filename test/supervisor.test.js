import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { kill, isProcessAlive, resolvePort, apiBaseUrl, waitUntilHealthy } from '../src/api.js';
import {
  Supervisor,
  clearStopRequest,
  requestStop,
  stopHere,
  stopRequested,
  supervisorState,
} from '../src/supervisor.js';
import { quietLogger } from '../src/log.js';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tf-sup-'));
}

test('stop flag helpers: request / detect / clear', () => {
  const dir = tmpdir();
  assert.equal(stopRequested(dir), false);
  requestStop(dir);
  assert.equal(stopRequested(dir), true);
  clearStopRequest(dir);
  assert.equal(stopRequested(dir), false);
  clearStopRequest(dir); // idempotent
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Supervisor: default opts applied', () => {
  const s = new Supervisor({ runtimeDir: tmpdir(), port: 3000, log: quietLogger });
  assert.equal(s.opts.pollMs, 3000);
  assert.equal(s.opts.unhealthyTolerance, 2);
  assert.deepEqual(s.opts.backoffMs, [2000, 4000, 8000, 15000, 30000]);
  assert.equal(s.status, 'idle');
});

test('supervisorState: null when no state file', () => {
  assert.equal(supervisorState(tmpdir()), null);
});

test('stopHere: no state and no pids -> already stopped', async () => {
  const res = await stopHere(tmpdir(), null, quietLogger);
  assert.deepEqual(res, { stopped: true, already: true });
});

test('isProcessAlive: rejects bogus pids, accepts self', () => {
  assert.equal(isProcessAlive(null), false);
  assert.equal(isProcessAlive(0), false);
  assert.equal(isProcessAlive(-1), false);
  assert.equal(isProcessAlive(process.pid), true);
});

test('kill: returns false for dead/absent pid', async () => {
  assert.equal(await kill(99999999), false);
});

test('resolvePort / apiBaseUrl', () => {
  const prevT = process.env.TERRAFLOW_PORT;
  const prevP = process.env.PORT;
  delete process.env.TERRAFLOW_PORT;
  delete process.env.PORT;
  try {
    assert.equal(resolvePort(), 3000);
    process.env.TERRAFLOW_PORT = '4321';
    assert.equal(resolvePort(), 4321);
    assert.equal(apiBaseUrl(4321), 'http://127.0.0.1:4321');
  } finally {
    if (prevT === undefined) delete process.env.TERRAFLOW_PORT;
    else process.env.TERRAFLOW_PORT = prevT;
    if (prevP === undefined) delete process.env.PORT;
    else process.env.PORT = prevP;
  }
});

test('waitUntilHealthy: abort stops the wait', async () => {
  const t0 = Date.now();
  const r = await waitUntilHealthy({
    port: 1,
    timeoutMs: 10000,
    stepMs: 50,
    abort: () => Date.now() - t0 > 100,
  });
  assert.equal(r.healthy, false);
  assert.equal(r.aborted, true);
  assert.ok(Date.now() - t0 < 5000);
});
