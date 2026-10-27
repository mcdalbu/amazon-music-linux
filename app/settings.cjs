"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { cleanSettings } = require("../electron/policy.cjs");
class Settings {
  constructor(temporary = false) {
    this.temporary = temporary;
    this.directory = temporary
      ? fs.mkdtempSync(path.join(os.tmpdir(), "amzml-node-"))
      : path.join(
          process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
          "Amazon Music Linux",
        );
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.file = path.join(this.directory, "settings.json");
    try {
      this.value = cleanSettings(
        JSON.parse(fs.readFileSync(this.file, "utf8")),
      );
    } catch {
      this.value = cleanSettings();
    }
    this.profile = temporary
      ? path.join(this.directory, "electron")
      : path.join(
          process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"),
          "amazon-music-linux/electron",
        );
    fs.mkdirSync(this.profile, { recursive: true, mode: 0o700 });
  }
  save(changes) {
    this.value = cleanSettings({ ...this.value, ...changes });
    const next = this.file + ".tmp";
    fs.writeFileSync(next, JSON.stringify(this.value, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(next, this.file);
    return this.value;
  }
  cleanup() {
    if (this.temporary)
      fs.rmSync(this.directory, { recursive: true, force: true });
  }
}
function refreshRate(millihertz = 0, interval = 0) {
  const value =
    millihertz > 0 ? millihertz / 1000 : interval > 0 ? 1000000 / interval : 60;
  return Math.min(
    240,
    Math.max(1, Math.round(Number.isFinite(value) ? value : 60)),
  );
}
function drmState(component, ready, startup) {
  if (ready) return "ready";
  if (!component?.version || component.version === "0.0.0.0")
    return "preparing";
  return startup.has(component.version) ? "unavailable" : "restart";
}
function scrollInput(dx, dy, precise) {
  const sensitivity = 1.2;
  const scale = (precise ? 1 : 40) * sensitivity;
  return {
    type: "mouseWheel",
    deltaX: -dx * scale,
    deltaY: -dy * scale,
    hasPreciseScrollingDeltas: precise,
    canScroll: true,
  };
}
module.exports = { Settings, refreshRate, drmState, scrollInput };
