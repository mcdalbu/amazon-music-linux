'use strict';
// A private inherited socket connects the GTK owner to this offscreen renderer.
// There is no HTTP listener, remote debugging port, or privileged page API.
const { app, BrowserWindow, Menu, components, ipcMain, nativeTheme, Tray, nativeImage } = require('electron');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const { isAmazonURL, isMusicURL, externalURL, cleanMedia } = require('./policy.cjs');
const fd = Number(process.env.AMZML_ENGINE_FD);
if (!Number.isInteger(fd) || fd < 3 || !process.env.AMZML_PROFILE) throw new Error('Start the app through its GTK launcher');
const channel = new net.Socket({ fd, readable: true, writable: true });
const frameFD=Number(process.env.AMZML_FRAME_FD), maxFrame=64*1024*1024;
if (!Number.isInteger(frameFD) || frameFD<3 || fs.fstatSync(frameFD).size !== maxFrame*3) throw new Error('Missing private frame buffer');
const frameSlots=[0,0,0]; let frameSequence=0;
const test = process.env.AMZML_TEST === '1';
const initialURL = process.env.AMZML_URL;
let window, closing = false, blocked = false, pendingFrame = null, pendingEvents = [];
let displayScale = 1, userZoom = 0;
let renderWidth=1280,renderHeight=780;
let requestedFrameRate=60, documentPainted=false, documentLoaded=false;
let activeUntil=0, idleTimer=null;
function applyFrameRate() {
  if (closing || !window || window.isDestroyed() || !documentPainted) return;
  const wc=window.webContents;
  const fps=Date.now()<activeUntil ? requestedFrameRate : Math.min(15,requestedFrameRate);
  if(wc.getFrameRate()!==fps)wc.setFrameRate(fps);
}
function renderingActivity() {
  activeUntil=Date.now()+2000;
  applyFrameRate();
  // One idle transition per interaction burst, rather than a timer per input.
  if(!idleTimer)idleTimer=setTimeout(renderingIdle,2000);
}
function renderingIdle() {
  idleTimer=null;
  const remaining=activeUntil-Date.now();
  if(remaining>0)idleTimer=setTimeout(renderingIdle,remaining);
  else {applyFrameRate();if(!closing)engineState();}
}
const textureFD=Number(process.env.AMZML_TEXTURE_FD);
let sharedGPU=process.env.AMZML_GPU==='1' && process.env.AMZML_SHARED_TEXTURE==='1' && Number.isInteger(textureFD) && textureFD>=3;
const gpuBridge=sharedGPU ? require('./gpu-bridge.node') : null;
const textureLeases=new Map();let textureSequence=0, sharedFrames=0;
let tray = null, trayError = '', traySignature = '';
let component = { id: 'widevine', status: 'preparing', version: '' };
function write(header, body) {
  const json = Buffer.from(JSON.stringify(header));
  const size = Buffer.alloc(4); size.writeUInt32BE(json.length);
  // Keep the bitmap separate: concatenating it allocated and copied the entire
  // HiDPI frame again on every paint. Cork batches the small header writes.
  channel.cork();
  const headerOK = channel.write(Buffer.concat([size,json]));
  const bodyOK = body ? channel.write(body) : true;
  blocked = !headerOK || !bodyOK;
  channel.uncork();
}
function event(kind, value) {
  const header = { type: 'event', kind, text: typeof value === 'string' ? value : JSON.stringify(value) };
  if (blocked) {
    if (pendingEvents.length >= 128) return app.exit(1);
    pendingEvents.push(header);
  } else write(header);
}
function frame(image) {
  const slot=frameSlots.indexOf(0);
  if (blocked || slot<0) { pendingFrame=image; return; }
  const scaleFactor = Math.max(...image.getScaleFactors(), 1);
  const { width, height } = image.getSize(scaleFactor);
  const body = image.toBitmap({ scaleFactor });
  if (!width || !height || body.length !== width * height * 4 || body.length > 64 * 1024 * 1024) return;
  // A leased memfd slot avoids sending full HiDPI bitmaps through the socket.
  // GTK acknowledges only after copying the pixels into its immutable texture.
  let offset=0;
  while (offset<body.length) offset+=fs.writeSync(frameFD,body,offset,body.length-offset,slot*maxFrame+offset);
  frameSlots[slot]=++frameSequence;
  write({type:'frame',width,height,bytes:body.length,slot,sequence:frameSequence});
  if (documentLoaded && !documentPainted) {
    const first=body.readUInt32LE(0), step=Math.max(4,Math.floor(body.length/4096/4)*4);
    for (let offset=step;offset<body.length;offset+=step) {
      if (body.readUInt32LE(offset)!==first) {
        documentPainted=true;
        // Let the first capture callback finish before reconfiguring it.
        setImmediate(() => {
          if (!closing && !window.isDestroyed()) { applyFrameRate();engineState(); }
        });
        break;
      }
    }
  }
}
function sharedFrame(texture) {
  if (++sharedFrames===1 && process.env.AMZML_GPU_DEBUG==='1') console.error('GPU_TEXTURE_INFO',JSON.stringify(texture.textureInfo));
  const info=texture.textureInfo, pixmap=info.handle?.nativePixmap;
  if (!pixmap || !['bgra','rgba'].includes(info.pixelFormat)) {texture.release();setImmediate(textureFallback);return;}
  if (textureLeases.size>=4) {texture.release();return;}
  const sequence=++textureSequence;
  const packet={sequence,width:info.codedSize.width,height:info.codedSize.height,format:info.pixelFormat,
    modifier:String(pixmap.modifier),planes:pixmap.planes.map(p=>({stride:p.stride,offset:p.offset,size:p.size}))};
  try {
    if (gpuBridge.send(textureFD,Buffer.from(JSON.stringify(packet)),pixmap.planes.map(p=>p.fd))) textureLeases.set(sequence,texture);
    else texture.release();
  } catch(error) {texture.release();event(3,'GPU texture transfer: '+error.message);}
}
function textureFallback() {
  if (!sharedGPU || closing || !window || window.isDestroyed()) return;
  const url=window.webContents.getURL() || initialURL;
  sharedGPU=false;
  // Keep the Chromium session/profile and native GTK window; only replace the
  // hidden capture surface if this driver cannot export/import DMA-BUFs.
  window.destroy();
  for(const texture of textureLeases.values())texture.release();
  textureLeases.clear();documentLoaded=false;documentPainted=false;
  createWindow(url);
}
channel.on('drain', () => {
  blocked = false;
  while (!blocked && pendingEvents.length) write(pendingEvents.shift());
  if (!blocked && pendingFrame) { const image = pendingFrame; pendingFrame = null; frame(image); }
});
function stop() {
  if (closing) return;
  closing = true; pendingFrame = null;
  clearTimeout(idleTimer);idleTimer=null;
  if (tray) { tray.destroy(); tray = null; }
  if (window && !window.isDestroyed()) window.destroy();
  for(const texture of textureLeases.values())texture.release();
  textureLeases.clear();
  app.quit();
}
channel.on('end', stop); channel.on('error', stop);
app.setName('Amazon Music Linux');
app.setPath('userData', process.env.AMZML_PROFILE);
app.enableSandbox();
app.commandLine.appendSwitch('disable-setuid-sandbox');
app.commandLine.appendSwitch('no-first-run');
// The GTK owner publishes MPRIS with the app identity and artwork.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
// Offscreen Wayland surfaces stay at scale 1; render physical pixels and
// compose display scale with page zoom instead of enlarging a low-res bitmap.
app.commandLine.appendSwitch('force-device-scale-factor', '1');
// The software offscreen device can retain an empty backing surface on Wayland.
// Use X11/XWayland for that hidden device when available; GTK stays on its own
// native backend and GPU DMA-BUF capture stays on Wayland.
app.commandLine.appendSwitch('ozone-platform', process.env.AMZML_X11 === '1' ||
  (process.env.AMZML_GPU !== '1' && process.env.DISPLAY) ? 'x11' : 'wayland');
if (test) app.commandLine.appendSwitch('disable-component-update');
if (process.env.AMZML_GPU !== '1') app.disableHardwareAcceleration();
const allowed = url => isAmazonURL(url) || url === 'about:blank' || (test && url === initialURL);
const observe = url => isMusicURL(url) || (test && url === initialURL);
function guardedLoad(url) {
  if (allowed(url)) window.loadURL(url).catch(error => event(3, error.code || error.message));
  else if (externalURL(url)) event(4, url);
}
function updateTray(message) {
  if (!message.enabled) {
    if (tray) { tray.destroy(); tray = null; }
    traySignature = ''; trayError = ''; return;
  }
  try {
    if (!tray) {
      const image = nativeImage.createFromPath(path.join(__dirname, '../assets/io.github.amzml.AmazonMusic.png'));
      if (image.isEmpty()) throw new Error('Missing tray icon');
      tray = new Tray(image.resize({width:48, height:48}));
      tray.setToolTip('Amazon Music Linux');
      tray.on('click', () => event(17, 'open'));
      tray.on('double-click', () => event(17, 'open'));
      traySignature = '';
    }
    const media = cleanMedia(message.media) || { available:false, paused:true };
    const signature = JSON.stringify([media.available, media.paused, message.muted === true]);
    if (signature !== traySignature) {
      tray.setContextMenu(Menu.buildFromTemplate([
        { id:'open', label:'Abrir Amazon Music', click:() => event(17, 'open') },
        { id:'toggle', label:media.paused ? 'Reproduzir' : 'Pausar', enabled:media.available, click:() => event(17, 'toggle') },
        { id:'mute', label:'Silenciar áudio', type:'checkbox', checked:message.muted === true, click:() => event(17, 'mute') },
        { type:'separator' },
        { id:'quit', label:'Sair', click:() => event(17, 'quit') },
      ]));
      traySignature = signature;
    }
    trayError = '';
  } catch (error) { trayError = String(error.message).slice(0, 160); }
}
function engineState() {
  event(16, { visibleWindows: BrowserWindow.getAllWindows().filter(w => w.isVisible()).length,
    offscreen: window.webContents.isOffscreen(), sandbox: window.webContents.getLastWebPreferences().sandbox,
    hardwareAcceleration: app.isHardwareAccelerationEnabled(), features: app.getGPUFeatureStatus(),
    sharedGPU, sharedFrames, textureLeases:textureLeases.size, tray:!!tray, trayError, painting:window.webContents.isPainting(), frameRate:window.webContents.getFrameRate(), targetFrameRate:requestedFrameRate, displayScale, userZoom, muted:window.webContents.isAudioMuted(), electron: process.versions.electron, chromium: process.versions.chrome });
}
let input = ''; const startupCommands = [];
function receive(chunk) {
  input += chunk.toString('utf8');
  if (Buffer.byteLength(input) > 65536) return stop();
  let newline;
  while ((newline = input.indexOf('\n')) >= 0) {
    const line = input.slice(0, newline); input = input.slice(newline + 1);
    try {
      const message = JSON.parse(line);
      if (!window) { startupCommands.push(line); continue; }
      if (window.isDestroyed()) continue;
      const wc = window.webContents;
      switch (message.command) {
        case 'texture-ready':
          if(sharedGPU && !documentPainted) {
            documentPainted=true;
            if(documentLoaded) {applyFrameRate();engineState();}
          }
          break;
        case 'texture-fallback': textureFallback();break;
        case 'texture-release': {
          const texture=textureLeases.get(message.sequence);
          if (texture) {textureLeases.delete(message.sequence);texture.release();}
          break;
        }
        case 'frame-rate':
          if (Number.isInteger(message.fps) && message.fps>=1 && message.fps<=240) {
            requestedFrameRate=message.fps;
            renderingActivity();
            engineState();
          }
          break;
        case 'frame-release':
          if (Number.isInteger(message.slot) && message.slot>=0 && message.slot<3 && frameSlots[message.slot] === message.sequence) {
            frameSlots[message.slot]=0;
            if (!blocked && pendingFrame) { const image=pendingFrame; pendingFrame=null; frame(image); }
          }
          break;
        case 'resize': {
          const w = Math.max(1, Math.min(8192, Math.round(message.width)));
          const h = Math.max(1, Math.min(8192, Math.round(message.height)));
          if (Number.isFinite(w) && Number.isFinite(h)) {
            displayScale = Math.max(1, Math.min(4, Number(message.factor)||1));
            renderWidth=Math.round(w*displayScale);renderHeight=Math.round(h*displayScale);
            renderingActivity(); window.setContentSize(renderWidth,renderHeight);
            wc.setZoomFactor(displayScale*Math.pow(1.2,userZoom));
            wc.invalidate();
          }
          break;
        }
        case 'focus': if (message.active) wc.focus(); break;
        case 'foreground':
          if (message.active) { renderingActivity(); wc.startPainting(); wc.invalidate(); }
          else { wc.stopPainting(); pendingFrame = null; }
          break;
        case 'tray': updateTray(message); break;
        case 'mute': wc.setAudioMuted(message.muted === true); break;
        case 'mouse': {
          const inputEvent = {...message.event, x:Math.round(message.event.x*displayScale), y:Math.round(message.event.y*displayScale)};
          if (inputEvent.type==='mouseWheel') { inputEvent.deltaX*=displayScale; inputEvent.deltaY*=displayScale; }
          renderingActivity(); wc.sendInputEvent(inputEvent); break;
        }
        case 'key': renderingActivity(); wc.sendInputEvent(message.event); break;
        case 'text': renderingActivity(); wc.insertText(message.text); break;
        case 'script': wc.executeJavaScript(message.script, true).catch(error => { if (test) event(11,{error:error.message}); }); break;
        case 'media': if (observe(wc.getURL()) && ['play','pause','toggle','next','previous'].includes(message.action)) wc.send('media-command',message.action); break;
        case 'load': guardedLoad(message.url); break;
        case 'reload': wc.reload(); break;
        case 'zoom': renderingActivity(); userZoom = message.level; wc.setZoomFactor(displayScale*Math.pow(1.2,userZoom)); break;
        case 'theme': nativeTheme.themeSource = ['dark', 'light'].includes(message.theme) ? message.theme : 'system'; break;
        case 'edit': {
          const operation = { copy: 'copy', cut: 'cut', paste: 'paste', select_all: 'selectAll' }[message.action];
          if (operation) wc[operation](); break;
        }
        case 'components': event(14, component); engineState(); break;
        case 'update': registerWidevine(); break;
        case 'close': stop(); break;
      }
    } catch (error) { event(3, 'Backend command failed: ' + error.message.slice(0, 160)); }
  }
}
channel.on('data', receive);
let registering = false;
async function registerWidevine() {
  if (test || registering) return;
  registering = true;
  try {
    // status() can be empty on every launch while CUS registers an existing CDM.
    // Only the completed registration result identifies a new installation.
    const results = await components.whenReady([components.WIDEVINE_CDM_ID]);
    const result = results.find(item => item.id === components.WIDEVINE_CDM_ID);
    component = { id: 'widevine', status: result?.status || 'unavailable', version: result?.version || '' };
    event(14, component); event(15, '0');
  } catch (error) {
    component = { id: 'widevine', status: 'unavailable', version: '', error: error.message.slice(0, 160) };
    event(14, component); event(15, '1');
  } finally { registering = false; }
}
function createWindow(url) {
  window = new BrowserWindow({ width: renderWidth, height: renderHeight, show: false, frame: false, skipTaskbar: true,
    backgroundColor: '#101418', webPreferences: { offscreen: sharedGPU ? {useSharedTexture:true} : true, sandbox: true, contextIsolation: true,
      nodeIntegration: false, webSecurity: true, backgroundThrottling: false,
      preload: path.join(__dirname, 'media-preload.cjs'), spellcheck: false } });
  const wc = window.webContents;
  // Bootstrap only; the GTK owner supplies the active monitor's refresh rate.
  wc.setFrameRate(60);
  const current=()=>!closing && window && !window.isDestroyed() && window.webContents===wc;
  wc.on('paint', (event_, _dirty, image) => {
    if(!current()){event_.texture?.release();return;}
    if(event_.texture) sharedFrame(event_.texture);else frame(image);
  });
  wc.on('media-started-playing', () => { if (observe(wc.getURL())) wc.send('media-playback',true); });
  wc.on('media-paused', () => { if (observe(wc.getURL())) wc.send('media-playback',false); });
  wc.on('audio-state-changed', event_ => { if (event_.audible && observe(wc.getURL())) wc.send('media-playback',true); });
  const documentReady = () => {
    if(!current())return;
    documentLoaded=true;
    wc.setZoomFactor(displayScale*Math.pow(1.2,userZoom)); event(2,wc.getURL());
    wc.send('media-refresh'); wc.invalidate();
    // Some offscreen drivers deliver only the loading background after a
    // viewport change. Restart capture after the parsed document has settled,
    // but only until the first real frame is confirmed.
    const target=window;
    for(const delay of [250,1000,2000]) {
      setTimeout(()=>{
        if(!current() || window!==target || documentPainted)return;
        wc.stopPainting();wc.startPainting();wc.invalidate();
      },delay).unref();
    }
    if(sharedGPU && documentPainted)applyFrameRate();
    if(sharedGPU) {
      const target=window;
      setTimeout(()=>{if(!closing && window===target && !documentPainted)textureFallback();},5000).unref();
    }
  };
  // Detached media and long-running assets can delay window.onload indefinitely.
  // Present the parsed document without waiting for every media resource.
  wc.on('dom-ready',documentReady);
  wc.on('did-finish-load',documentReady);
  wc.on('did-navigate-in-page', (_event, url, main) => { if (main && current()) event(2, url); });
  wc.on('did-fail-load', (_event, code, description, _url, main) => {
    if (main && code !== -3 && current()) event(3, description);
  });
  wc.on('render-process-gone', (_event, details) => {if(current())event(3, 'Player process: ' + details.reason);});
  wc.on('will-navigate', event_ => { if (!allowed(event_.url)) { event_.preventDefault(); event(4, event_.url); } });
  wc.on('will-redirect', event_ => { if (!allowed(event_.url)) { event_.preventDefault(); event(4, event_.url); } });
  wc.setWindowOpenHandler(({ url }) => { event(4, url); return { action: 'deny' }; });
  wc.on('will-attach-webview', event_ => event_.preventDefault());
  wc.session.on('will-download', event_ => event_.preventDefault());
  wc.session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(permission === 'mediaKeySystem' && isMusicURL(details.requestingUrl));
  });
  wc.session.setPermissionCheckHandler((_contents, permission, origin) => permission === 'mediaKeySystem' && isMusicURL(origin));
  wc.on('console-message', event_ => {
    const message = event_.message;
    if (test && process.env.AMZML_TEST_CONSOLE === '1') console.error('Fixture console:',message);
    // Production DRM/media reports use isolated preload IPC. Console is test-only.
    if (test && typeof message === 'string' && message.startsWith('AMZML_TEST ') && message.length < 4096)
      event(11, message.slice(11));
  });
  const trustedSender = event_ => current() && event_.sender === wc && event_.senderFrame === wc.mainFrame && observe(event_.senderFrame.url);
  ipcMain.on('media-state', (event_, state) => {
    if (!trustedSender(event_)) return;
    const media = cleanMedia(state); if (media) event(5, media);
  });
  ipcMain.on('drm-state', (event_, state) => {
    if (trustedSender(event_) && typeof state?.ready === 'boolean')
      event(6, { ready: state.ready, error: String(state.error || '').slice(0, 100) });
  });
  engineState();
  if (startupCommands.length) receive(Buffer.from(startupCommands.join('\n')+'\n'));
  guardedLoad(url);
}
app.whenReady().then(()=>{if(closing)return;Menu.setApplicationMenu(null);createWindow(initialURL);registerWidevine();})
  .catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => {if(closing)app.quit();});
