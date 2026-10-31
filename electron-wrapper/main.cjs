'use strict';
const { app, BrowserWindow, Menu, Tray, nativeImage, nativeTheme, ipcMain, shell, dialog, components } = require('electron');
const { SystemTheme } = require('./system-theme.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Desktop } = require('../app/desktop.cjs');
const { REGIONS, isAmazonURL, isMusicURL, externalURL, cleanMedia } = require('../electron/policy.cjs');
const ID = 'io.github.amzml.AmazonMusicElectron';
const root = path.resolve(__dirname, '..');
const icon = path.join(root, 'assets/io.github.amzml.AmazonMusic.png');
const test = process.argv.includes('--smoke-test');
if (test && !process.env.AMZML_ELECTRON_TEST_DIR) throw Error('Smoke test requires a disposable AMZML_ELECTRON_TEST_DIR');
app.setName('Amazon Music');
app.setDesktopName(ID + '.desktop');
const directory = test ? process.env.AMZML_ELECTRON_TEST_DIR :
  path.join(process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config'), 'amazon-music-electron');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
app.setPath('userData', directory);
app.enableSandbox();
// Use the user-namespace sandbox, as in the existing CastLabs runtime package.
app.commandLine.appendSwitch('disable-setuid-sandbox');
app.commandLine.appendSwitch('class', ID);
// Publish one app-specific MPRIS service, including DesktopEntry and Raise.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
if (test) app.commandLine.appendSwitch('disable-component-update');
let window, tray, desktop, systemTheme, rendererDark, quitting = false, traySignature = '', hiddenOnce = false;
const backgroundColor = () => nativeTheme.shouldUseDarkColors ? '#101418' : '#ffffff';
function themeChanged() {
  if (!window || window.isDestroyed()) return;
  window.setBackgroundColor(backgroundColor());
  if (test) window.webContents.executeJavaScript('matchMedia("(prefers-color-scheme: dark)").matches')
    .then(value => { rendererDark = value; }).catch(() => {});
}
let media = { available: false, paused: true }, muted = false;
let settings = { region: 'BR', background: true };
try {
  const input = JSON.parse(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8'));
  if (Object.hasOwn(REGIONS, input.region)) settings.region = input.region;
  if (typeof input.background === 'boolean') settings.background = input.background;
} catch { /* First launch uses defaults. */ }
function save() {
  const file = path.join(directory, 'settings.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(settings, null, 2), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}
function open() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
}
function command(action) {
  if (action === 'open') return open();
  if (action === 'quit') { quitting = true; return app.quit(); }
  if (!window || window.isDestroyed()) return;
  if (['mute-on', 'mute-off', 'mute'].includes(action)) {
    muted = action === 'mute' ? !muted : action === 'mute-on';
    window.webContents.setAudioMuted(muted);
    desktop?.update(media, muted); updateMenus();
  } else if (['play', 'pause', 'toggle', 'next', 'previous'].includes(action)) {
    window.webContents.send('media-command', action);
  }
}
function setRegion(region) {
  settings.region = region; save(); updateMenus();
  window.loadURL(REGIONS[region].url).catch(() => {});
}
function updateMenus() {
  const signature = JSON.stringify([media.available, media.paused, muted, settings]);
  if (signature === traySignature) return;
  traySignature = signature;
  const playback = () => [
    { label: media.paused ? 'Reproduzir' : 'Pausar', enabled: media.available, click: () => command('toggle') },
    { label: 'Faixa anterior', enabled: !!media.available && !!media.canPrevious, click: () => command('previous') },
    { label: 'Próxima faixa', enabled: !!media.available && !!media.canNext, click: () => command('next') },
    { label: 'Silenciar áudio', type: 'checkbox', checked: muted, click: () => command('mute') },
  ];
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Amazon Music', click: open }, ...playback(), { type: 'separator' },
    { label: 'Sair', click: () => command('quit') },
  ]));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Amazon Music', submenu: [
      { label: 'Início', click: () => setRegion(settings.region) },
      { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: () => window.webContents.reload() },
      { label: 'Região', submenu: Object.entries(REGIONS).map(([region, value]) => ({
        label: value.label, type: 'radio', checked: region === settings.region, click: () => setRegion(region),
      })) },
      { label: 'Continuar em segundo plano ao fechar', type: 'checkbox', checked: settings.background,
        click: item => { settings.background = item.checked; save(); updateMenus(); } },
      { type: 'separator' }, { label: 'Sair', accelerator: 'CmdOrCtrl+Q', click: () => command('quit') },
    ] },
    { label: 'Reprodução', submenu: playback() },
    { label: 'Editar', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Exibir', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
  ]));
}
const fixture = pathToFileURL(path.join(root, 'tests/player_fixture.html')).href;
const allowed = url => isAmazonURL(url) || (test && url === fixture);
const observe = url => isMusicURL(url) || (test && url === fixture);
function external(url) {
  const safe = externalURL(url);
  if (safe) shell.openExternal(safe).catch(error => console.error('External link:', error.message));
}
function createWindow() {
  window = new BrowserWindow({ width: 1280, height: 820, minWidth: 620, minHeight: 480,
    title: 'Amazon Music', icon, backgroundColor: backgroundColor(), show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
      preload: path.join(root, 'electron/media-preload.cjs'), spellcheck: false } });
  window.on('ready-to-show', () => { if (!process.argv.includes('--background')) open(); });
  window.on('close', event => {
    if (!quitting && settings.background && tray && !tray.isDestroyed()) { event.preventDefault(); window.hide(); }
  });
  const wc = window.webContents;
  const trust = event => !window.isDestroyed() && event.sender === wc && event.senderFrame === wc.mainFrame && observe(event.senderFrame.url);
  ipcMain.on('media-state', (event, value) => {
    if (!trust(event)) return;
    const clean = cleanMedia(value);
    if (clean) { media = clean; desktop?.update(media, muted); updateMenus(); }
  });
  ipcMain.on('drm-state', (event, state) => {
    if (trust(event) && state?.error) console.info('Widevine probe:', String(state.error).slice(0, 100));
  });
  for (const [event, value] of [['media-started-playing', true], ['media-paused', false]])
    wc.on(event, () => { if (observe(wc.getURL())) wc.send('media-playback', value); });
  wc.on('audio-state-changed', state => { if (state.audible && observe(wc.getURL())) wc.send('media-playback', true); });
  for (const name of ['will-navigate', 'will-redirect']) wc.on(name, event => {
    if (!allowed(event.url)) { event.preventDefault(); external(event.url); }
  });
  wc.setWindowOpenHandler(({ url }) => {
    // Amazon login links stay in the same sandboxed window and session.
    if (allowed(url)) wc.loadURL(url).catch(() => {}); else external(url);
    return { action: 'deny' };
  });
  wc.on('will-attach-webview', event => event.preventDefault());
  wc.session.on('will-download', event => event.preventDefault());
  wc.session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(permission === 'mediaKeySystem' && isMusicURL(details.requestingUrl));
  });
  wc.session.setPermissionCheckHandler((_contents, permission, origin) => permission === 'mediaKeySystem' && isMusicURL(origin));
  let showingError = false;
  wc.on('did-fail-load', async (_event, code, description, _url, main) => {
    if (!main || code === -3 || test || showingError || quitting) return;
    showingError = true;
    try {
      const result = await dialog.showMessageBox(window, { type: 'error', message: 'Não foi possível carregar o Amazon Music',
        detail: description, buttons: ['Tentar novamente', 'Fechar'], defaultId: 0, cancelId: 1 });
      if (result.response === 0 && !window.isDestroyed()) wc.loadURL(REGIONS[settings.region].url).catch(() => {});
    } finally { showingError = false; }
  });
  wc.on('render-process-gone', (_event, details) => console.error('Player process:', details.reason));
  wc.on('did-finish-load', async () => {
    themeChanged();
    wc.send('media-refresh');
    if (test) {
      try {
        const image = await wc.capturePage();
        fs.writeFileSync(path.join(directory, 'window.png'), image.toPNG());
      } catch (error) { console.warn('Test screenshot:', error.message); }
      await wc.executeJavaScript('detachedAudio.play(); navigator.mediaSession.playbackState="playing"', true);
    }
  });
  wc.loadURL(test ? fixture : REGIONS[settings.region].url).catch(() => {});
}
async function start() {
  systemTheme = new SystemTheme(nativeTheme, themeChanged, test && process.env.AMZML_ELECTRON_THEME_PORTAL
    ? { service: process.env.AMZML_ELECTRON_THEME_PORTAL } : {});
  // The portal is authoritative on GNOME, even when the GTK theme name stays
  // unchanged. Keep Electron's native system detection if the portal is absent.
  await Promise.race([systemTheme.start(), new Promise(resolve => setTimeout(resolve, 2000))]);
  createWindow();
  const image = nativeImage.createFromPath(icon);
  if (image.isEmpty()) throw Error('Missing application icon');
  tray = new Tray(image.resize({ width: 48, height: 48 }));
  tray.setToolTip('Amazon Music');
  tray.on('click', open); tray.on('double-click', open);
  desktop = new Desktop(root, directory, command, test, {
    identity: 'Amazon Music', desktopEntry: ID,
    busName: 'org.mpris.MediaPlayer2.amazon_music_electron',
  });
  updateMenus();
  if (test) {
    const timer = setInterval(() => {
      if (!window || window.isDestroyed()) return;
      if (media.available && !media.paused && !hiddenOnce) { hiddenOnce = true; window.close(); }
      fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({
        pid: process.pid, visible: window.isVisible(), hiddenOnce, media, muted,
        tray: !!tray && !tray.isDestroyed(), windows: BrowserWindow.getAllWindows().length,
        preferences: window.webContents.getLastWebPreferences(), offscreen: window.webContents.isOffscreen(), electron: process.versions.electron,
        appName: app.getName(), themeSource: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors,
        rendererDark, backgroundColor: window.getBackgroundColor(),
      }));
    }, 150);
    timer.unref();
  } else if (components) {
    components.whenReady([components.WIDEVINE_CDM_ID]).then(results => {
      console.info('Widevine registration:', JSON.stringify(results));
    }).catch(error => console.error('Widevine registration:', error.message));
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', open);
  app.whenReady().then(start).catch(error => { console.error(error); app.exit(1); });
}
app.on('activate', open);
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { systemTheme?.close(); desktop?.close(); tray?.destroy(); });
app.on('window-all-closed', () => { if (!settings.background || quitting) app.quit(); });
