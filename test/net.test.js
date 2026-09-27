import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { getJson, isTerraflowHealthy, portOpen, waitFor, wait } from '../src/net.js';

test('portOpen: false for a closed port', async () => {
  assert.equal(await portOpen(1, '127.0.0.1', 400), false);
});

test('portOpen: true for a listening server', async () => {
  const server = http.createServer(() => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  assert.equal(await portOpen(port, '127.0.0.1', 1000), true);
  await new Promise((r) => server.close(r));
});

test('getJson: resolves ok:false on connection error (no hang)', async () => {
  const r = await getJson('http://127.0.0.1:1/api/health', 500);
  assert.equal(r.ok, false);
  assert.equal(r.status, 0);
});

test('getJson: parses JSON body', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', db: 'up' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const r = await getJson(`http://127.0.0.1:${port}/api/health`);
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { status: 'ok', db: 'up' });
  await new Promise((r2) => server.close(r2));
});

test('getJson: non-JSON body resolves ok:false', async () => {
  const server = http.createServer((req, res) => res.end('<html>nope</html>'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const r = await getJson(`http://127.0.0.1:${port}/x`);
  assert.equal(r.ok, false);
  await new Promise((r2) => server.close(r2));
});

test('isTerraflowHealthy: requires status ok', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'degraded' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  assert.equal(await isTerraflowHealthy(`http://127.0.0.1:${port}`), false);
  await new Promise((r2) => server.close(r2));
});

test('waitFor: false on timeout', async () => {
  const t0 = Date.now();
  const ok = await waitFor(() => false, { timeoutMs: 150, stepMs: 50 });
  assert.equal(ok, false);
  assert.ok(Date.now() - t0 >= 150);
});

test('waitFor: true when probe succeeds', async () => {
  let n = 0;
  const ok = await waitFor(() => ++n >= 2, { timeoutMs: 1000, stepMs: 20 });
  assert.equal(ok, true);
});

test('waitFor: abort stops early', async () => {
  let aborted = false;
  setTimeout(() => (aborted = true), 50);
  const t0 = Date.now();
  const ok = await waitFor(() => false, { timeoutMs: 5000, stepMs: 20, abort: () => aborted });
  assert.equal(ok, false);
  assert.ok(Date.now() - t0 < 2000);
});

test('wait: resolves after delay', async () => {
  const t0 = Date.now();
  await wait(30);
  assert.ok(Date.now() - t0 >= 25);
});
