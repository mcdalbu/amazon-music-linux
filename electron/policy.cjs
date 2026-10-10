'use strict';

const REGIONS = Object.freeze({
  BR: { label: 'Brasil', url: 'https://music.amazon.com.br/' },
  US: { label: 'Estados Unidos', url: 'https://music.amazon.com/' },
  DE: { label: 'Alemanha', url: 'https://music.amazon.de/' },
  UK: { label: 'Reino Unido', url: 'https://music.amazon.co.uk/' },
  FR: { label: 'França', url: 'https://music.amazon.fr/' },
  ES: { label: 'Espanha', url: 'https://music.amazon.es/' },
  IT: { label: 'Itália', url: 'https://music.amazon.it/' },
  JP: { label: 'Japão', url: 'https://music.amazon.co.jp/' },
});
const amazonDomains = ['amazon.com.br', 'amazon.com', 'amazon.de', 'amazon.co.uk',
  'amazon.fr', 'amazon.es', 'amazon.it', 'amazon.co.jp'];

function parseHttps(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (!url.port || url.port === '443') ? url : null;
  } catch { return null; }
}
function isAmazonURL(raw) {
  const url = parseHttps(raw);
  return !!url && amazonDomains.some(domain =>
    url.hostname === domain || url.hostname.endsWith(`.${domain}`));
}
function isMusicURL(raw) {
  const url = parseHttps(raw);
  return !!url && Object.values(REGIONS).some(region =>
    url.hostname === new URL(region.url).hostname);
}
function externalURL(raw) {
  const url = parseHttps(raw);
  return url ? url.href : null;
}
function cleanSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  return {
    region: Object.hasOwn(REGIONS, input.region) ? input.region : 'BR',
    theme: ['system', 'light', 'dark'].includes(input.theme) ? input.theme : 'system',
    hardwareAcceleration: input.hardwareAcceleration === true,
    mute: input.mute === true,
    background: input.background === true,
  };
}
function cleanMedia(input) {
  if (!input || typeof input !== 'object' || typeof input.paused !== 'boolean' ||
      typeof input.available !== 'boolean') return null;
  return {
    available: input.available,
    paused: input.paused,
    title: typeof input.title === 'string' ? input.title.slice(0, 256) : '',
    artist: typeof input.artist === 'string' ? input.artist.slice(0, 256) : '',
    album: typeof input.album === 'string' ? input.album.slice(0, 256) : '',
    artwork: artworkURL(input.artwork),
    canNext: input.canNext === true,
    canPrevious: input.canPrevious === true,
  };
}
function artworkURL(raw) {
  if (typeof raw !== 'string' || raw.length>4096) return '';
  if (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(raw)) return raw;
  const url=parseHttps(raw);
  return url && ['media-amazon.com','ssl-images-amazon.com',...amazonDomains].some(d=>url.hostname===d||url.hostname.endsWith('.'+d)) ? url.href : '';
}
function hardwareRequested(settings, args = []) {
  if (args.includes('--disable-gpu')) return false;
  return args.includes('--enable-gpu') || settings.hardwareAcceleration === true;
}
module.exports = { REGIONS, isAmazonURL, isMusicURL, externalURL, cleanSettings, cleanMedia, hardwareRequested, artworkURL };
