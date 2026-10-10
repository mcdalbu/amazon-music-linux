'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isAmazonURL, isMusicURL, externalURL, cleanSettings, cleanMedia, hardwareRequested } = require('../electron/policy.cjs');

test('Amazon login and music domains are accepted; lookalikes and unsafe schemes are rejected', () => {
  for (const url of ['https://music.amazon.com.br/', 'https://www.amazon.com/ap/signin',
    'https://amazon.co.jp/ap/signin', 'https://music.amazon.de/']) assert.ok(isAmazonURL(url), url);
  for (const url of ['http://music.amazon.com/', 'https://amazon.com.evil.test/',
    'https://evilamazon.com/', 'https://amazon.com@evil.test/', 'file:///etc/passwd',
    'javascript:alert(1)', 'https://music.amazon.com:8443/', 'https://user:pass@amazon.com/',
    'https://amazon.com./']) assert.equal(isAmazonURL(url), false, url);
  assert.equal(isMusicURL('https://www.amazon.com/'), false);
  assert.equal(isMusicURL('https://music.amazon.com.br/'), true);
});
test('External browser is limited to HTTPS without credentials', () => {
  assert.equal(externalURL('https://example.com/page'), 'https://example.com/page');
  for (const url of ['javascript:alert(1)', 'file:///tmp/test', 'mailto:x@y.test',
    'https://a:b@example.com/', 'not a URL']) assert.equal(externalURL(url), null);
});
test('Settings are validated and unknown keys cannot survive disk/IPC input', () => {
  const defaults = { region: 'BR', theme: 'system', hardwareAcceleration: false, mute: false, background: false };
  for (const input of [null, [], 'invalid', {}, { region: 'toString', theme: 'blue', mute: 'true' }]) {
    assert.deepEqual(cleanSettings(input), defaults);
  }
  assert.deepEqual(cleanSettings({ region: 'US', theme: 'dark', hardwareAcceleration: true, mute: true,
    dangerous: 'data' }), { region: 'US', theme: 'dark', hardwareAcceleration: true, mute: true, background: false });
  assert.equal(cleanSettings({ hardwareAcceleration: 'true' }).hardwareAcceleration, false);
  assert.equal(cleanSettings({ openOnStartup: true }).hardwareAcceleration, false);
  assert.equal(cleanSettings({ background: true }).background, true);
  assert.equal(cleanSettings({ background: 'true' }).background, false);
});
test('GPU preference is applied at startup and emergency software mode wins', () => {
  assert.equal(hardwareRequested(cleanSettings()), false);
  assert.equal(hardwareRequested(cleanSettings({ hardwareAcceleration: true })), true);
  assert.equal(hardwareRequested(cleanSettings(), ['--enable-gpu']), true);
  assert.equal(hardwareRequested(cleanSettings({ hardwareAcceleration: true }), ['--disable-gpu']), false);
  assert.equal(hardwareRequested(cleanSettings(), ['--enable-gpu', '--disable-gpu']), false);
});
test('Renderer state accepts only bounded metadata and boolean playback flags', () => {
  for (const input of [null, 'x', { available: 1, paused: false }, { available: true }]) {
    assert.equal(cleanMedia(input), null);
  }
  const input = { available: true, paused: false, title: 'x'.repeat(1000), arbitrary: true };
  assert.deepEqual(cleanMedia(input), { available: true, paused: false, title: 'x'.repeat(256), artist:'', album:'',artwork:'',canNext:false,canPrevious:false });
});
test('Album art rejects local files, credentials and unrelated hosts',()=>{
  const {artworkURL}=require('../electron/policy.cjs');
  for(const raw of ['file:///etc/passwd','http://m.media-amazon.com/x','https://media-amazon.com.evil.test/x','https://evil.test/x','https://a:b@m.media-amazon.com/x','data:image/svg+xml;base64,AAAA','x'.repeat(4097)])assert.equal(artworkURL(raw),'');
  assert.equal(artworkURL('https://m.media-amazon.com/images/a.jpg'),'https://m.media-amazon.com/images/a.jpg');
  const media=cleanMedia({available:true,paused:false,artwork:'https://images-na.ssl-images-amazon.com/a.jpg',canNext:true,canPrevious:'true'});
  assert.ok(media.artwork);assert.equal(media.canNext,true);assert.equal(media.canPrevious,false);
});
