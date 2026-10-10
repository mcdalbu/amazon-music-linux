'use strict';
const { ipcRenderer, contextBridge } = require('electron');

// Install before page scripts: isolated-world prototypes cannot observe the
// site's detached Audio objects or MediaSession action handlers. Only bounded
// metadata crosses a DOM event; no Electron/Node API is exposed to the site.
document.addEventListener('amzml-media-state', event => {
  if (typeof event.detail !== 'string' || event.detail.length > 6144) return;
  try { ipcRenderer.send('media-state', JSON.parse(event.detail)); } catch { /* Invalid page data. */ }
});
for (const [channel, name] of [['media-command','amzml-media-command'], ['media-playback','amzml-media-playback']]) {
  ipcRenderer.on(channel, (_event, value) => document.dispatchEvent(new CustomEvent(name, {detail:value})));
}
ipcRenderer.on('media-refresh', () => document.dispatchEvent(new Event('amzml-media-refresh')));
function installMediaObserver() {
  const tracked = new Set(), watched = new WeakSet(), actions = new Map();
  let browserPlaying = false, browserSeen = false, last = '';
  function track(media) {
    if (watched.has(media)) return;
    watched.add(media); tracked.add(new WeakRef(media));
    for (const type of ['play','playing','pause','ended','emptied','loadedmetadata']) media.addEventListener(type, report);
  }
  function activeMedia() {
    for (const media of document.querySelectorAll('audio,video')) track(media);
    const media = [];
    for (const ref of tracked) {
      const value = ref.deref();
      if (value) media.push(value); else tracked.delete(ref);
    }
    return media.find(value => !value.paused && !value.ended) || media.find(value => value.readyState > 0) || null;
  }
  function report() {
    const media = activeMedia(), session = navigator.mediaSession, metadata = session?.metadata;
    const available = !!media || browserSeen || (!!metadata && (actions.has('play') || actions.has('pause')));
    const paused = media ? media.paused || media.ended :
      session?.playbackState === 'playing' ? false : session?.playbackState === 'paused' ? true : !browserPlaying;
    const artworks=Array.from(metadata?.artwork || []).filter(a=>typeof a.src==='string' && a.src.length<=4096);
    artworks.sort((a,b)=>(parseInt(b.sizes)||0)-(parseInt(a.sizes)||0));
    const state = JSON.stringify({available, paused, title:(metadata?.title || document.title).slice(0,256),
      artist:(metadata?.artist || '').slice(0,256), album:(metadata?.album || '').slice(0,256),
      artwork:artworks[0]?.src || '',canNext:actions.has('nexttrack'),canPrevious:actions.has('previoustrack')});
    if (state !== last) { last = state; document.dispatchEvent(new CustomEvent('amzml-media-state', {detail:state})); }
  }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function(...args) { track(this); return Reflect.apply(play,this,args); };
  const session = navigator.mediaSession;
  if (session) {
    const setActionHandler = session.setActionHandler;
    session.setActionHandler = function(action, handler) {
      const result = Reflect.apply(setActionHandler,this,[action,handler]);
      if (handler) actions.set(action,handler); else actions.delete(action);
      return result;
    };
  }
  document.addEventListener('amzml-media-playback', event => {
    if (typeof event.detail !== 'boolean') return;
    browserPlaying = event.detail; browserSeen ||= browserPlaying; report();
  });
  document.addEventListener('amzml-media-command', async event => {
    if (!['play','pause','toggle','next','previous'].includes(event.detail)) return;
    const media = activeMedia();
    const paused = media ? media.paused : session?.playbackState === 'paused' || !browserPlaying;
    const action = event.detail === 'toggle' ? (paused ? 'play' : 'pause') :
      event.detail==='next' ? 'nexttrack' : event.detail==='previous' ? 'previoustrack' : event.detail;
    try {
      if (actions.has(action)) await actions.get(action)({action});
      else if (media) { if (action === 'play') await media.play(); else if (action==='pause') media.pause(); }
    } catch { /* Preserve the actual state on autoplay/service rejection. */ }
    report();
  });
  document.addEventListener('DOMContentLoaded', report);
  document.addEventListener('amzml-media-refresh', () => { last=''; report(); });
  setInterval(report,1000);
}
contextBridge.executeInMainWorld({func:installMediaObserver});

let drmReady = false;
async function probeDRM() {
  if (drmReady) return;
  try {
    const access = await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
      initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
    }]);
    await access.createMediaKeys();
    drmReady = true;
    ipcRenderer.send('drm-state', { ready: true });
  } catch (error) { ipcRenderer.send('drm-state', { ready: false, error: error.name }); }
}
window.addEventListener('DOMContentLoaded', () => { probeDRM(); setInterval(probeDRM, 10000); });
