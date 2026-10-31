'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Variant } = require('dbus-next');
const { portalSource } = require('../electron-wrapper/system-theme.cjs');
test('Desktop color scheme accepts both portal variant formats and falls back on invalid values', () => {
  assert.equal(portalSource(new Variant('u', 1)), 'dark');
  assert.equal(portalSource(new Variant('v', new Variant('u', 2))), 'light');
  assert.equal(portalSource(new Variant('u', 0)), 'light');
  for (const value of [undefined, null, '1', -1, 3, true]) assert.equal(portalSource(value), 'system');
});
