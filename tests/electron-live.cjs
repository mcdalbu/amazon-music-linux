'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { fileURLToPath } = require('node:url');
const dbus = require('dbus-next');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check(); if (result) return result;
    await sleep(150);
  }
  throw Error('Timed out: ' + label);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amzml-electron-live-'));
let process_, bus;
const runtime = process.env.AMZML_ELECTRON_RUNTIME;
const installedApp = process.env.AMZML_ELECTRON_APP;
const state = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'state.json'))); } catch { return {}; } };
const propsXML = '<interface name="org.freedesktop.DBus.Properties"><method name="GetAll"><arg type="s" direction="in"/><arg type="a{sv}" direction="out"/></method></interface>';
async function main() {
  bus = dbus.sessionBus();
  const themeService = 'org.freedesktop.portal.Desktop.amzmltest' + process.pid;
  class ThemePortal extends dbus.interface.Interface {
    constructor() { super('org.freedesktop.portal.Settings'); this.scheme = 1; }
    ReadOne() { return new dbus.Variant('u', this.scheme); }
    Read() { return new dbus.Variant('v', new dbus.Variant('u', this.scheme)); }
    SettingChanged(namespace, key, value) { return [namespace, key, value]; }
    change(value) { this.scheme = value; this.SettingChanged('org.freedesktop.appearance', 'color-scheme', new dbus.Variant('u', value)); }
  }
  ThemePortal.configureMembers({
    methods: { ReadOne: { inSignature: 'ss', outSignature: 'v' }, Read: { inSignature: 'ss', outSignature: 'v' } },
    signals: { SettingChanged: { signature: 'ssv' } },
  });
  const themePortal = new ThemePortal();
  bus.export('/org/freedesktop/portal/desktop', themePortal);
  assert.equal(await bus.requestName(themeService, 4), 1);
  const executable = installedApp ? runtime : path.resolve(__dirname, '../scripts/run-electron.sh');
  const env = { ...process.env, AMZML_ELECTRON_TEST_DIR: dir, WAYLAND_DEBUG: '1', AMZML_ELECTRON_THEME_PORTAL: themeService };
  // Match the installed launcher: an empty ELECTRON_RUN_AS_NODE is not the
  // same as removing it for Electron's spawned renderer/zygote processes.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_DESKTOP;
  delete env.CHROME_WEB_APP_DESKTOP_ID_PREFIX;
  delete env.GTK_THEME;
  process_ = spawn(executable, installedApp ? [installedApp, '--smoke-test'] : ['--smoke-test'], {
    env,
    stdio: ['ignore', 'ignore', fs.openSync(path.join(dir, 'wayland.log'), 'w')],
  });
  await until(() => state().hiddenOnce && state().media?.available && !state().visible, 'window hidden with playing audio');
  const initial = state();
  assert.equal(initial.windows, 1); assert.equal(initial.tray, true);
  assert.equal(initial.preferences.sandbox, true);
  assert.equal(initial.preferences.contextIsolation, true);
  assert.equal(initial.preferences.nodeIntegration, false);
  assert.equal(initial.offscreen, false);
  assert.equal(initial.appName, 'Amazon Music');
  await until(() => state().themeSource === 'dark' && state().rendererDark === true, 'initial system dark theme');
  const nativeIsDark = () => state().nativeGtk?.preferDark === true &&
    state().nativeGtk.menuRGB.every(value => value < 128) && state().nativeGtk.titlebarRGB.every(value => value < 128);
  const nativeIsLight = () => state().nativeGtk?.preferDark === false &&
    state().nativeGtk.menuRGB.every(value => value > 180) && state().nativeGtk.titlebarRGB.every(value => value > 180);
  await until(nativeIsDark, 'actual GTK menu and titlebar dark colors');
  themePortal.change(2);
  await until(() => state().themeSource === 'light' && state().dark === false && state().rendererDark === false && state().backgroundColor?.toLowerCase() === '#ffffff', 'live system light theme');
  await until(nativeIsLight, 'actual GTK menu and titlebar light colors');
  themePortal.change(1);
  await until(() => state().themeSource === 'dark' && state().dark === true && state().rendererDark === true, 'live system dark theme');
  await until(nativeIsDark, 'GTK menu and titlebar switch back to dark');
  themePortal.change(0);
  await until(() => state().themeSource === 'light' && state().rendererDark === false, 'default system appearance');
  themePortal.change(1);
  assert.ok(!initial.media.paused, 'Audio must continue after close');
  const daemon = (await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus')).getInterface('org.freedesktop.DBus');
  const service = 'org.mpris.MediaPlayer2.amazon_music_electron.test' + process_.pid;
  await until(async () => (await daemon.ListNames()).includes(service), 'MPRIS registration');
  const object = await bus.getProxyObject(service, '/org/mpris/MediaPlayer2');
  const props = object.getInterface('org.freedesktop.DBus.Properties');
  const player = object.getInterface('org.mpris.MediaPlayer2.Player');
  const get = async property => (await props.Get('org.mpris.MediaPlayer2.Player', property)).value;
  assert.equal((await props.Get('org.mpris.MediaPlayer2', 'DesktopEntry')).value, 'io.github.amzml.AmazonMusicElectron');
  assert.equal((await props.Get('org.mpris.MediaPlayer2', 'Identity')).value, 'Amazon Music');
  assert.equal(await get('PlaybackStatus'), 'Playing');
  await until(async () => (await get('Metadata'))['mpris:artUrl'].value.includes('/artwork/'), 'album cover cached');
  const first = await get('Metadata');
  assert.equal(first['xesam:title'].value, 'Faixa de teste');
  assert.deepEqual(first['xesam:artist'].value, ['Artista de teste']);
  assert.ok(fs.readFileSync(fileURLToPath(first['mpris:artUrl'].value)).subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  await player.Pause();
  await until(async () => (await get('PlaybackStatus')) === 'Paused', 'MPRIS pause');
  await player.Play();
  await until(async () => (await get('PlaybackStatus')) === 'Playing', 'MPRIS play');
  await player.Next();
  await until(async () => {
    const m = await get('Metadata');
    return m['xesam:title'].value === 'Segunda faixa' && m['mpris:artUrl'].value !== first['mpris:artUrl'].value && m['mpris:artUrl'].value.includes('/artwork/');
  }, 'next track and new artwork');
  await player.Previous();
  await until(async () => (await get('Metadata'))['xesam:title'].value === 'Faixa de teste', 'previous track');
  assert.ok(!(await daemon.ListNames()).includes('org.mpris.MediaPlayer2.chromium.instance' + process_.pid), 'No duplicate native Chromium media service');
  const watcher = await bus.getProxyObject('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher', '<node>' + propsXML + '</node>');
  const watcherProps = await watcher.getInterface('org.freedesktop.DBus.Properties').GetAll('org.kde.StatusNotifierWatcher');
  assert.equal(watcherProps.IsStatusNotifierHostRegistered.value, true, 'Tray host required');
  let tray;
  for (const item of watcherProps.RegisteredStatusNotifierItems.value) {
    const slash = item.indexOf('/');
    const destination = slash >= 0 ? item.slice(0, slash) : item;
    const objectPath = slash >= 0 ? item.slice(slash) : '/StatusNotifierItem';
    let ownerPID;
    try { ownerPID = await daemon.GetConnectionUnixProcessID(destination); }
    catch { continue; } // A desktop watcher can still contain a disconnected item.
    if (ownerPID !== process_.pid) continue;
    const obj = await bus.getProxyObject(destination, objectPath, '<node>' + propsXML + '<interface name="org.kde.StatusNotifierItem"><method name="Activate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method></interface></node>');
    const values = await obj.getInterface('org.freedesktop.DBus.Properties').GetAll('org.kde.StatusNotifierItem');
    tray = { destination, obj, values }; break;
  }
  assert.ok(tray, 'Electron tray must be registered with desktop host');
  const pixels = tray.values.IconPixmap?.value;
  if (pixels?.length) {
    assert.ok(pixels[0][0] >= 32);
    assert.equal(pixels[0][2].length, pixels[0][0] * pixels[0][1] * 4);
  } else assert.ok(tray.values.IconName?.value, 'Tray icon must have pixels or icon name');
  await tray.obj.getInterface('org.kde.StatusNotifierItem').Activate(0, 0);
  await until(() => state().visible, 'tray activation reopens window');
  const menu = await bus.getProxyObject(tray.destination, tray.values.Menu.value, `<node><interface name="com.canonical.dbusmenu">
    <method name="GetLayout"><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="as" direction="in"/><arg type="u" direction="out"/><arg type="(ia{sv}av)" direction="out"/></method>
    <method name="Event"><arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="in"/><arg type="u" direction="in"/></method>
  </interface></node>`);
  const menuInterface = menu.getInterface('com.canonical.dbusmenu');
  async function click(label) {
    const id = await until(async () => {
      const layout = await menuInterface.GetLayout(0, -1, []);
      for (const variant of layout[1][2]) {
        const item = variant.value;
        if (item[1].label?.value === label) return { value: item[0] };
      }
    }, 'tray menu ' + label);
    await menuInterface.Event(id.value, 'clicked', new dbus.Variant('i', 0), 0);
  }
  await click('Pausar');
  await until(async () => (await get('PlaybackStatus')) === 'Paused', 'tray pause');
  await click('Reproduzir');
  await until(async () => (await get('PlaybackStatus')) === 'Playing', 'tray play');
  await click('Silenciar áudio');
  await until(() => state().muted, 'tray mute');
  assert.equal(await get('Volume'), 0);
  await object.getInterface('org.mpris.MediaPlayer2').Raise();
  assert.ok(state().visible);
  const log = fs.readFileSync(path.join(dir, 'wayland.log'), 'utf8');
  assert.ok(log.includes('set_app_id("io.github.amzml.AmazonMusicElectron")'), 'Wayland shelf ID');
  await click('Sair');
  await until(() => process_.exitCode !== null, 'quit terminates background process');
  assert.equal(process_.exitCode, 0);
  console.log('PASS: Amazon Music identity; actual GTK titlebar/menu colors, live portal dark/light/default themes and renderer CSS preference; visible Electron window; shelf app ID; tray activation/play/pause/mute/quit; background audio; MPRIS artwork/next/previous/Raise; renderer sandbox.');
  console.log('Test artifacts:', dir);
}
main().catch(error => { console.error(error); console.error('Test artifacts:', dir); process.exitCode = 1; }).finally(async () => {
  bus?.disconnect();
  if (process_ && process_.exitCode === null) {
    process_.kill('SIGTERM');
    await Promise.race([once(process_, 'exit'), sleep(4000)]);
    if (process_.exitCode === null) process_.kill('SIGKILL');
  }
});
