import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { coreCandidateRoots, findCoreDir, setup } from '../src/setup.js';
import { createShortcuts, removeShortcuts, SHORTCUTS_PS_SCRIPT } from '../src/shortcuts.js';
import { psQuote } from '../src/powershell.js';
import { isWindows } from '../src/autostart.js';
import { quietLogger } from '../src/log.js';
import { runtimeIsValid } from '../src/paths.js';

function tmp(prefix = 'tf-setup-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeCoreFixture() {
  const core = tmp('tf-core-');
  fs.writeFileSync(path.join(core, 'package.json'), JSON.stringify({ name: 'core', private: true }));
  fs.mkdirSync(path.join(core, 'apps', 'api', 'src'), { recursive: true });
  fs.writeFileSync(path.join(core, 'apps', 'api', 'src', 'server.js'), '// server');
  fs.mkdirSync(path.join(core, 'apps', 'api', 'public'), { recursive: true });
  fs.writeFileSync(path.join(core, 'apps', 'api', 'public', 'index.html'), '<html></html>');
  fs.mkdirSync(path.join(core, 'packages', 'engine'), { recursive: true });
  fs.writeFileSync(path.join(core, 'packages', 'engine', 'index.js'), 'export const x = 1;');
  fs.writeFileSync(path.join(core, '.env.example'), 'GROQ_API_KEY=\n');
  return core;
}

function makeFakeInstall() {
  const dir = tmp('tf-inst-');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'TerraFlow.vbs'), 'WScript.Echo "hi"\r\n');
  fs.writeFileSync(path.join(dir, 'uninstall.cmd'), '@echo off\r\n');
  return dir;
}

test('coreCandidateRoots: env override comes first', () => {
  const roots = coreCandidateRoots({ root: 'C:\\repo\\TerraFlow-Desktop', env: { TERRAFLOW_CORE_DIR: 'D:\\core' } });
  assert.equal(roots[0], 'D:\\core');
  assert.ok(roots.includes(path.join('C:\\repo\\TerraFlow-Desktop', 'core')));
});

test('findCoreDir: locates a valid Core in candidate roots', () => {
  const root = tmp('tf-root-');
  const core = path.join(root, 'core');
  fs.mkdirSync(path.join(core, 'apps', 'api', 'src'), { recursive: true });
  fs.writeFileSync(path.join(core, 'apps', 'api', 'src', 'server.js'), '// s');
  fs.writeFileSync(path.join(core, 'package.json'), '{}');
  assert.equal(findCoreDir({ roots: [path.join(root, 'nope'), core] }), path.resolve(core));
  fs.rmSync(root, { recursive: true, force: true });
});

test('findCoreDir: null when no candidate is valid', () => {
  const root = tmp('tf-empty-root-');
  assert.equal(findCoreDir({ roots: [path.join(root, 'a'), path.join(root, 'b')] }), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('setup: full one-click flow into temp dirs (no launch, no autostart)', async (t) => {
  const core = makeCoreFixture();
  const installDir = tmp('tf-setup-install-');
  const desktopDir = tmp('tf-setup-desktop-');
  const startMenuDir = tmp('tf-setup-menu-');

  const res = await setup({
    installDir,
    coreDir: core,
    log: quietLogger,
    withDeps: false,
    autostart: false,
    launchApp: false,
    picker: false,
    desktopDir,
    startMenuDir,
  });

  assert.equal(res.installDir, installDir);
  assert.equal(res.coreDir, path.resolve(core));
  assert.equal(runtimeIsValid(installDir), true);
  assert.ok(fs.existsSync(path.join(installDir, 'assets', 'terraflow.ico')));
  assert.ok(fs.existsSync(path.join(installDir, 'TerraFlow.vbs')));
  assert.equal(res.autostart.skipped, true);
  assert.equal(res.launch, null);

  if (isWindows()) {
    assert.equal(res.shortcuts.supported, true, `shortcuts error: ${res.shortcuts.error}`);
    assert.equal(res.shortcuts.ok, true, `shortcuts error: ${res.shortcuts.error}`);
    assert.ok(fs.existsSync(path.join(desktopDir, 'TerraFlow.lnk')), 'desktop shortcut missing');
    assert.ok(fs.existsSync(path.join(startMenuDir, 'TerraFlow', 'TerraFlow.lnk')), 'start menu shortcut missing');
    assert.ok(
      fs.existsSync(path.join(startMenuDir, 'TerraFlow', 'Uninstall TerraFlow.lnk')),
      'uninstall shortcut missing'
    );

    const rm = await removeShortcuts({ installDir, desktopDir, startMenuDir });
    assert.equal(rm.ok, true);
    assert.equal(fs.existsSync(path.join(desktopDir, 'TerraFlow.lnk')), false);
    assert.equal(fs.existsSync(path.join(startMenuDir, 'TerraFlow')), false);
  }

  fs.rmSync(core, { recursive: true, force: true });
  fs.rmSync(installDir, { recursive: true, force: true });
  fs.rmSync(desktopDir, { recursive: true, force: true });
  fs.rmSync(startMenuDir, { recursive: true, force: true });
});

test('setup: rejects when Core cannot be found (picker disabled)', async () => {
  const installDir = tmp('tf-setup-nocore-');
  const emptyRoot = tmp('tf-setup-roots-');
  await assert.rejects(
    () =>
      setup({
        installDir,
        coreDir: null,
        log: quietLogger,
        withDeps: false,
        autostart: false,
        launchApp: false,
        picker: false,
        roots: [path.join(emptyRoot, 'missing')],
      }),
    /Core not found/
  );
  fs.rmSync(installDir, { recursive: true, force: true });
  fs.rmSync(emptyRoot, { recursive: true, force: true });
});

test('setup: rejects an invalid explicit coreDir', async () => {
  const installDir = tmp('tf-setup-badcore-');
  const notCore = tmp('tf-setup-notcore-');
  await assert.rejects(
    () =>
      setup({
        installDir,
        coreDir: notCore,
        log: quietLogger,
        withDeps: false,
        autostart: false,
        launchApp: false,
        picker: false,
      }),
    /not a TerraFlow Core checkout/
  );
  fs.rmSync(installDir, { recursive: true, force: true });
  fs.rmSync(notCore, { recursive: true, force: true });
});

test('psQuote escapes single quotes for PowerShell', () => {
  assert.equal(psQuote('plain'), "'plain'");
  assert.equal(psQuote("O'Brien"), "'O''Brien'");
  assert.equal(psQuote('a\'b\'c'), "'a''b''c'");
});

test('shortcuts: rejects install dir without launcher', { skip: !isWindows() }, async () => {
  const dir = tmp('tf-nolaunch-');
  const desktopDir = tmp('tf-nolaunch-desk-');
  const r = await createShortcuts({ installDir: dir, desktopDir });
  assert.equal(r.supported, true);
  assert.equal(r.ok, false);
  assert.match(String(r.error), /TerraFlow\.vbs/);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(desktopDir, { recursive: true, force: true });
});

test('shortcuts script is non-empty PowerShell', () => {
  assert.match(SHORTCUTS_PS_SCRIPT, /WScript\.Shell/);
  assert.match(SHORTCUTS_PS_SCRIPT, /param\(/);
});
