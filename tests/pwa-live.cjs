'use strict';
// Opt-in desktop integration test. Debugging is enabled only in this disposable
// test browser, bound to loopback; the shipped launcher never enables it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const dbus = require('dbus-next');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(150);
  }
  throw new Error('Timed out: ' + label);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amzml-pwa-live-'));
const profile = path.join(dir, 'profile');
const log = path.join(dir, 'wayland.log');
let browser, bus, socket;
async function main() {
  const executable = process.env.AMZML_PWA_BROWSER || 'chromium-browser';
  const shim = path.join(dir, 'browser');
  fs.writeFileSync(shim, '#!/bin/sh\nexec "$AMZML_TEST_BROWSER" --ozone-platform=wayland --remote-debugging-port=0 --autoplay-policy=no-user-gesture-required "$@"\n', { mode: 0o755 });
  browser = spawn(path.resolve(__dirname, '../pwa/amazon-music-pwa'), [], {
    env: { ...process.env, AMZML_PWA_BROWSER: shim, AMZML_TEST_BROWSER: executable,
      AMZML_PWA_PROFILE: profile, XDG_DATA_HOME: path.join(dir, 'data'),
      XDG_CONFIG_HOME: path.join(dir, 'config'), WAYLAND_DEBUG: '1' },
    stdio: ['ignore', 'ignore', fs.openSync(log, 'w')],
  });
  const portFile = path.join(profile, 'DevToolsActivePort');
  await until(() => fs.existsSync(portFile), 'browser startup');
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = await until(async () => {
    const values = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    return values.find(target => target.type === 'page');
  }, 'app page');
  socket = new WebSocket(targets.webSocketDebuggerUrl);
  await once(socket, 'open');
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      clearTimeout(timer); pending.delete(message.id);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    }
  });
  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 10000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  // Real, non-silent audio longer than Chromium's short-sound cutoff.
  const samples = 44100 * 8, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(150 * Math.sin(i * 2 * Math.PI * 220 / 44100)), 44 + 2 * i);
  const fixture = fs.readFileSync(path.join(__dirname, 'player_fixture.html'), 'utf8')
    .replace(/data:audio\/wav;base64,[A-Za-z0-9+/=]+/, 'data:audio/wav;base64,' + wav.toString('base64'));
  const fixturePath = path.join(dir, 'player.html');
  fs.writeFileSync(fixturePath, fixture);
  await cdp('Page.navigate', { url: 'file://' + fixturePath });
  await until(async () => {
    const state = await cdp('Runtime.evaluate', { expression: 'typeof detachedAudio' });
    return state.result.value === 'object';
  }, 'fixture load');
  await cdp('Runtime.evaluate', { expression: 'detachedAudio.play(); navigator.mediaSession.playbackState="playing"', userGesture: true });
  bus = dbus.sessionBus();
  const daemon = (await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus')).getInterface('org.freedesktop.DBus');
  const name = await until(async () => (await daemon.ListNames()).find(name => name === 'org.mpris.MediaPlayer2.chromium.instance' + browser.pid), 'Chromium MPRIS service');
  // Chromium exports the standard calls without introspection signatures.
  const object = await bus.getProxyObject(name, '/org/mpris/MediaPlayer2', `<node>
    <interface name="org.freedesktop.DBus.Properties"><method name="Get"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method></interface>
    <interface name="org.mpris.MediaPlayer2.Player">${['Pause','Play','Next','Previous'].map(name => `<method name="${name}"/>`).join('')}</interface>
  </node>`);
  const props = object.getInterface('org.freedesktop.DBus.Properties');
  const player = object.getInterface('org.mpris.MediaPlayer2.Player');
  const get = async prop => (await props.Get('org.mpris.MediaPlayer2.Player', prop)).value;
  await until(async () => (await get('PlaybackStatus')) === 'Playing', 'MPRIS playing');
  const metadata = await get('Metadata');
  assert.equal(metadata['xesam:title'].value, 'Faixa de teste');
  assert.deepEqual(metadata['xesam:artist'].value, ['Artista de teste']);
  assert.ok(metadata['mpris:artUrl']?.value, 'Album artwork missing');
  await player.Pause();
  await until(async () => (await get('PlaybackStatus')) === 'Paused', 'MPRIS pause');
  await player.Play();
  await until(async () => (await get('PlaybackStatus')) === 'Playing', 'MPRIS play');
  await player.Next();
  await until(async () => (await get('Metadata'))['xesam:title']?.value === 'Segunda faixa', 'MPRIS next');
  await player.Previous();
  await until(async () => (await get('Metadata'))['xesam:title']?.value === 'Faixa de teste', 'MPRIS previous');
  const appID = 'io.github.amzml.pwa.chrome-music.amazon.com.br__-Default';
  assert.ok(fs.readFileSync(log, 'utf8').includes('set_app_id("' + appID + '")'), 'Wayland app ID must match installed desktop filename');
  console.log('PASS: real Wayland app ID; native Chromium MPRIS metadata, artwork, pause/play and next/previous. Browser PID:', browser.pid);
  console.log('Temporary test log:', log);
}
main().catch(error => { console.error(error); console.error('Test log:', log); process.exitCode = 1; }).finally(async () => {
  if (socket) socket.close();
  if (bus) bus.disconnect();
  if (browser && browser.exitCode === null) {
    browser.kill('SIGTERM');
    await Promise.race([once(browser, 'exit'), sleep(4000)]);
    if (browser.exitCode === null) browser.kill('SIGKILL');
  }
  // Keep the small diagnostic log, remove the disposable browsing session.
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
