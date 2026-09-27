import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readJson, writeJson } from '../src/state.js';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tf-state-'));
}

test('writeJson creates parent dirs and round-trips', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'nested', 'deep', 'state.json');
  writeJson(file, { a: 1, b: 'two' });
  assert.deepEqual(readJson(file), { a: 1, b: 'two' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeJson overwrites atomically', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'state.json');
  writeJson(file, { v: 1 });
  writeJson(file, { v: 2 });
  assert.deepEqual(readJson(file), { v: 2 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readJson returns fallback for missing/corrupt files', () => {
  const dir = tmpdir();
  assert.equal(readJson(path.join(dir, 'nope.json')), null);
  assert.deepEqual(readJson(path.join(dir, 'nope.json'), { x: 1 }), { x: 1 });
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{not json');
  assert.equal(readJson(bad, 'fb'), 'fb');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeJson leaves no tmp files behind', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'state.json');
  writeJson(file, { ok: true });
  const leftovers = fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
  fs.rmSync(dir, { recursive: true, force: true });
});
