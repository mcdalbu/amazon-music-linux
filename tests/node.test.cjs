"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { Settings, refreshRate, drmState, scrollInput } = require("../app/settings.cjs");
const { textureInfo } = require("../app/engine.cjs");
const { imageValid } = require("../app/desktop.cjs");
const { safeNames } = require("../scripts/runtimes.cjs");
test("Settings persist defaults and changes atomically in a private temporary directory", () => {
  const s = new Settings(true);
  try {
    assert.equal(fs.statSync(s.directory).mode & 0o777, 0o700);
    s.save({
      theme: "dark",
      background: true,
      hardwareAcceleration: true,
      region: "US",
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(s.file)), s.value);
    assert.equal(fs.statSync(s.file).mode & 0o777, 0o600);
    s.save({ theme: "invalid", region: "BAD" });
    assert.equal(s.value.theme, "system");
    assert.equal(s.value.region, "BR");
  } finally {
    s.cleanup();
  }
  assert.equal(fs.existsSync(s.directory), false);
});
test("Display target follows monitor timing without fixed 60 fps cap", () => {
  assert.equal(refreshRate(120000), 120);
  assert.equal(refreshRate(144000), 144);
  assert.equal(refreshRate(59940), 60);
  assert.equal(refreshRate(0, 8333), 120);
  assert.equal(refreshRate(360000), 240);
  assert.equal(refreshRate(), 60);
});
test("DRM never repeats restart for an already installed startup CDM or a successful EME probe", () => {
  const c = { version: "4.10.1234.0" };
  assert.equal(drmState(c, false, new Set([c.version])), "unavailable");
  assert.equal(drmState(c, true, new Set()), "ready");
  assert.equal(drmState(c, false, new Set()), "restart");
  assert.equal(drmState({ version: "0.0.0.0" }, false, new Set()), "preparing");
});
test("DMA-BUF parser rejects malformed geometry, descriptors and layouts before native import", () => {
  const info = {
    sequence: 1,
    width: 100,
    height: 100,
    format: "bgra",
    modifier: "0",
    planes: [{ stride: 400, offset: 0, size: 40000 }],
  };
  assert.equal(textureInfo(info, [4]).info.modifier, 0n);
  for (const bad of [
    { ...info, width: 9000 },
    { ...info, width: 0 },
    { ...info, modifier: "-1" },
    { ...info, modifier: String(2n ** 64n) },
    { ...info, sequence: NaN },
    { ...info, format: "bad" },
    { ...info, planes: [{ stride: 0, offset: 0, size: 40 }] },
  ])
    assert.throws(() => textureInfo(bad, [4]));
  assert.throws(() => textureInfo(info, []));
});
test("Artwork accepts bounded images and rejects HTML or oversized PNGs", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGPQaNqn0bSPAUIBACUWBaGsNM6xAAAAAElFTkSuQmCC",
    "base64",
  );
  assert.equal(imageValid(png), true);
  png.writeUInt32BE(99999, 16);
  assert.equal(imageValid(png), false);
  assert.equal(imageValid(Buffer.from("<html>error</html>")), false);
});
test("Pinned runtime archives reject path traversal", () => {
  safeNames("electron\nlocales/pt-BR.pak");
  assert.throws(() => safeNames("../escape"));
  assert.throws(() => safeNames("/absolute"));
});

test("Scrolling gains 20% sensitivity while retaining fractional touchpad movement", () => {
  const touchpad = scrollInput(0.25, -0.4, true);
  assert.ok(Math.abs(touchpad.deltaX + 0.3) < 1e-12);
  assert.ok(Math.abs(touchpad.deltaY - 0.48) < 1e-12);
  assert.equal(touchpad.hasPreciseScrollingDeltas, true);
  const wheel = scrollInput(0, 1, false);
  assert.equal(wheel.deltaY, -48);
  assert.equal(wheel.hasPreciseScrollingDeltas, false);
});
