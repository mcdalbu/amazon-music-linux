'use strict';
const dbus = require('dbus-next');
const APPEARANCE = 'org.freedesktop.appearance';
function portalSource(value) {
  // Older portal Read() implementations return a variant inside a variant.
  for (let depth = 0; depth < 4 && value && typeof value === 'object' && 'value' in value; depth++) value = value.value;
  // No preference uses the default light appearance, as in libadwaita.
  return value === 1 ? 'dark' : value === 0 || value === 2 ? 'light' : 'system';
}
class SystemTheme {
  constructor(nativeTheme, changed, options = {}) {
    this.nativeTheme = nativeTheme;
    this.changed = changed;
    this.service = options.service || 'org.freedesktop.portal.Desktop';
    this.closed = false;
    this.generation = 0;
    nativeTheme.themeSource = 'system';
    this.onUpdated = () => { if (!this.closed) changed(nativeTheme.shouldUseDarkColors); };
    nativeTheme.on('updated', this.onUpdated);
  }
  async start() {
    this.bus = dbus.sessionBus();
    this.bus.on('error', error => console.warn('System theme:', error.message));
    try {
      const daemon = (await this.bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus')).getInterface('org.freedesktop.DBus');
      if (this.closed) return;
      this.onOwnerChanged = (name, _oldOwner, newOwner) => {
        if (name !== this.service || this.closed) return;
        this.detach();
        this.generation++;
        if (newOwner) this.connect().catch(() => this.apply('system'));
        else this.apply('system');
      };
      this.daemon = daemon;
      daemon.on('NameOwnerChanged', this.onOwnerChanged);
      await this.connect();
    } catch (error) {
      if (!this.closed) { this.apply('system'); console.warn('System theme portal unavailable:', error.message); }
    }
  }
  async connect() {
    const object = await this.bus.getProxyObject(this.service, '/org/freedesktop/portal/desktop');
    if (this.closed) return;
    this.detach();
    const settings = object.getInterface('org.freedesktop.portal.Settings');
    this.settings = settings;
    this.onSettingChanged = (namespace, key, value) => {
      if (namespace === APPEARANCE && key === 'color-scheme') {
        this.generation++;
        this.apply(portalSource(value));
      }
    };
    settings.on('SettingChanged', this.onSettingChanged);
    const generation = this.generation;
    let value;
    try { value = await settings.ReadOne(APPEARANCE, 'color-scheme'); }
    catch { value = await settings.Read(APPEARANCE, 'color-scheme'); }
    if (!this.closed && generation === this.generation) this.apply(portalSource(value));
  }
  apply(source) {
    if (this.closed) return;
    if (this.nativeTheme.themeSource !== source) this.nativeTheme.themeSource = source;
    this.changed(this.nativeTheme.shouldUseDarkColors);
  }
  detach() {
    if (this.settings && this.onSettingChanged) this.settings.removeListener('SettingChanged', this.onSettingChanged);
    this.settings = null;
  }
  close() {
    this.closed = true;
    this.detach();
    this.nativeTheme.removeListener('updated', this.onUpdated);
    if (this.daemon) this.daemon.removeListener('NameOwnerChanged', this.onOwnerChanged);
    this.bus?.disconnect();
  }
}
module.exports = { SystemTheme, portalSource };
