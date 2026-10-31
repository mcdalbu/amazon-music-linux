'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const launcher = path.resolve(__dirname, '../pwa/amazon-music-pwa');

test('PWA launch isolates the profile, preserves paths with spaces and matches desktop identity', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amzml-pwa-test-'));
  try {
    const capture = path.join(dir, 'capture.json');
    const browser = path.join(dir, 'browser with spaces');
    fs.writeFileSync(browser, '#!/bin/sh\nexec "$TEST_NODE" "$TEST_CAPTURE_SCRIPT" "$@"\n', { mode: 0o755 });
    const script = path.join(dir, 'capture.cjs');
    fs.writeFileSync(script, 'require("fs").writeFileSync(process.env.TEST_CAPTURE,JSON.stringify({args:process.argv.slice(2),desktop:process.env.CHROME_DESKTOP,prefix:process.env.CHROME_WEB_APP_DESKTOP_ID_PREFIX}));');
    const profile = path.join(dir, 'private profile');
    const env = { ...process.env, AMZML_PWA_BROWSER: browser, AMZML_PWA_PROFILE: profile,
      TEST_NODE: process.execPath, TEST_CAPTURE_SCRIPT: script, TEST_CAPTURE: capture };
    const result = spawnSync(launcher, [], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const state = JSON.parse(fs.readFileSync(capture));
    assert.ok(state.args.includes('--user-data-dir=' + profile));
    assert.equal(fs.statSync(profile).mode & 0o777, 0o700);
    const url = new URL(state.args.find(arg => arg.startsWith('--app=')).slice(6));
    const generatedID = state.prefix + 'chrome-' + url.host + '__-Default';
    assert.equal(state.desktop, generatedID + '.desktop');
    const desktop = fs.readFileSync(path.resolve(__dirname, '../pwa', state.desktop), 'utf8');
    const windowClass = state.args.find(arg => arg.startsWith('--class=')).slice(8);
    assert.ok(desktop.includes('StartupWMClass=' + windowClass + '\n'));
    assert.ok(!state.args.some(arg => /no-sandbox|disable-web-security|remote-debugging/.test(arg)));
    assert.equal(spawnSync(launcher, ['--user-data-dir=/tmp/unwanted'], { env }).status, 2);
    assert.equal(spawnSync(launcher, [], { env: { ...env, AMZML_PWA_PROFILE: 'relative' } }).status, 2);
    assert.equal(spawnSync(launcher, [], { env: { ...env, AMZML_PWA_BROWSER: '/no/such/browser' } }).status, 127);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
