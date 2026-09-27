import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { install } from '../src/installer.js';
import { quietLogger } from '../src/log.js';
import { runtimeIsValid } from '../src/paths.js';

function makeCoreFixture() {
  const core = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-core-'));
  fs.writeFileSync(path.join(core, 'package.json'), JSON.stringify({ name: 'core', private: true }));
  fs.writeFileSync(path.join(core, 'docker-compose.yml'), 'services:\n  postgres:\n    image: postgres:16-alpine\n');
  fs.writeFileSync(path.join(core, '.env.example'), 'GROQ_API_KEY=\n');
  fs.mkdirSync(path.join(core, 'apps', 'api', 'src'), { recursive: true });
  fs.writeFileSync(path.join(core, 'apps', 'api', 'src', 'server.js'), '// v1');
  fs.writeFileSync(path.join(core, 'apps', 'api', 'package.json'), JSON.stringify({ name: 'api' }));
  fs.mkdirSync(path.join(core, 'apps', 'api', 'public'), { recursive: true });
  fs.writeFileSync(path.join(core, 'apps', 'api', 'public', 'index.html'), '<html>v1</html>');
  fs.mkdirSync(path.join(core, 'packages', 'engine'), { recursive: true });
  fs.writeFileSync(path.join(core, 'packages', 'engine', 'index.js'), 'export const x = 1;');
  fs.mkdirSync(path.join(core, 'output', 'data'), { recursive: true });
  fs.writeFileSync(path.join(core, 'output', 'data', 'seed.txt'), 'seed');
  fs.mkdirSync(path.join(core, 'node_modules', 'junk'), { recursive: true });
  fs.writeFileSync(path.join(core, 'node_modules', 'junk', 'x.js'), 'junk');
  return core;
}

test('install: stages a valid runtime and launchers', async () => {
  const core = makeCoreFixture();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-dest-'));

  const out = await install({ coreDir: core, installDir: dest, log: quietLogger, withDeps: false });

  assert.equal(out, dest);
  assert.equal(runtimeIsValid(dest), true);
  assert.ok(fs.existsSync(path.join(dest, 'apps', 'api', 'src', 'server.js')));
  assert.ok(fs.existsSync(path.join(dest, 'apps', 'api', 'public', 'index.html')));
  assert.ok(fs.existsSync(path.join(dest, 'packages', 'engine', 'index.js')));
  assert.ok(fs.existsSync(path.join(dest, '.env')));
  assert.ok(fs.existsSync(path.join(dest, 'docker-compose.yml')));
  assert.ok(fs.existsSync(path.join(dest, 'desktop-package.json')));
  assert.ok(fs.existsSync(path.join(dest, 'TerraFlow.bat')));
  assert.ok(fs.existsSync(path.join(dest, 'TerraFlow.vbs')));
  assert.ok(fs.existsSync(path.join(dest, 'startup.vbs')));
  assert.ok(fs.existsSync(path.join(dest, 'uninstall.cmd')));
  assert.ok(fs.existsSync(path.join(dest, 'bin', 'terraflow.mjs')));
  assert.ok(fs.existsSync(path.join(dest, 'src', 'cli.js')));
  assert.ok(fs.existsSync(path.join(dest, 'output', 'data', 'seed.txt')));
  assert.equal(fs.existsSync(path.join(dest, 'node_modules')), false);

  fs.rmSync(core, { recursive: true, force: true });
  fs.rmSync(dest, { recursive: true, force: true });
});

test('install: upgrade preserves existing user data', async () => {
  const core = makeCoreFixture();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-dest-'));

  await install({ coreDir: core, installDir: dest, log: quietLogger, withDeps: false });

  const marker = path.join(dest, 'output', 'jobs', 'marker.json');
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, '{"keep":true}');

  fs.writeFileSync(path.join(core, 'apps', 'api', 'src', 'server.js'), '// v2');
  await install({ coreDir: core, installDir: dest, log: quietLogger, withDeps: false });

  assert.ok(fs.existsSync(marker), 'user data must survive reinstall');
  assert.equal(fs.readFileSync(path.join(dest, 'apps', 'api', 'src', 'server.js'), 'utf8'), '// v2');

  fs.rmSync(core, { recursive: true, force: true });
  fs.rmSync(dest, { recursive: true, force: true });
});

test('install: does not overwrite existing .env', async () => {
  const core = makeCoreFixture();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-dest-'));
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, '.env'), 'SECRET=keep-me\n');

  await install({ coreDir: core, installDir: dest, log: quietLogger, withDeps: false });
  assert.equal(fs.readFileSync(path.join(dest, '.env'), 'utf8'), 'SECRET=keep-me\n');

  fs.rmSync(core, { recursive: true, force: true });
  fs.rmSync(dest, { recursive: true, force: true });
});

test('install: rejects a Core checkout equal to the install dir', async () => {
  const core = makeCoreFixture();
  await assert.rejects(
    () => install({ coreDir: core, installDir: core, log: quietLogger, withDeps: false }),
    /differs from the install dir/
  );
  fs.rmSync(core, { recursive: true, force: true });
});

test('install: rejects a directory that is not a Core checkout', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-empty-'));
  await assert.rejects(
    () => install({ coreDir: empty, installDir: empty + '-out', log: quietLogger, withDeps: false }),
    /not a TerraFlow Core checkout/
  );
  fs.rmSync(empty, { recursive: true, force: true });
});

test('install: rejects Core without the API entry', async () => {
  const core = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-noapi-'));
  fs.writeFileSync(path.join(core, 'package.json'), '{}');
  await assert.rejects(
    () => install({ coreDir: core, installDir: core + '-out', log: quietLogger, withDeps: false }),
    /missing Core API entry/
  );
  fs.rmSync(core, { recursive: true, force: true });
});
