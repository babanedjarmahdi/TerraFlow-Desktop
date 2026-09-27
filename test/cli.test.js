import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, run } from '../src/cli.js';

test('parseArgs: positional + flag with value', () => {
  const a = parseArgs(['launch', '--core', 'C:\\core', '--install-dir', 'D:\\tf']);
  assert.deepEqual(a._, ['launch']);
  assert.equal(a.core, 'C:\\core');
  assert.equal(a['install-dir'], 'D:\\tf');
});

test('parseArgs: boolean flags', () => {
  const a = parseArgs(['--quiet', '--no-browser', '--foreground']);
  assert.equal(a.quiet, true);
  assert.equal(a['no-browser'], true);
  assert.equal(a.foreground, true);
});

test('parseArgs: --key=value form', () => {
  const a = parseArgs(['--port=4321', 'status']);
  assert.equal(a.port, '4321');
  assert.deepEqual(a._, ['status']);
});

test('parseArgs: flag does not swallow following flag', () => {
  const a = parseArgs(['--quiet', '--purge']);
  assert.equal(a.quiet, true);
  assert.equal(a.purge, true);
});

test('run: help returns 0', async () => {
  assert.equal(await run(['help']), 0);
});

test('run: bare invocation defaults to help', async () => {
  assert.equal(await run([]), 0);
});

test('run: version returns 0', async () => {
  assert.equal(await run(['version']), 0);
});

test('run: unknown command returns 2', async () => {
  assert.equal(await run(['frobnicate']), 2);
});
