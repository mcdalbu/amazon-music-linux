"use strict";
const dbus = require("dbus-next"),
  { Interface, ACCESS_READ, ACCESS_READWRITE } = dbus.interface;
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  { pathToFileURL } = require("node:url");
const { artworkURL } = require("../electron/policy.cjs");
const V = (type, value) => new dbus.Variant(type, value),
  PLAYER = "org.mpris.MediaPlayer2.Player",
  OBJECT = "/org/mpris/MediaPlayer2";
class Root extends Interface {
  constructor(host) {
    super("org.mpris.MediaPlayer2");
    this.host = host;
  }
  Raise() {
    this.host.command("open");
  }
  Quit() {
    this.host.command("quit");
  }
  get CanQuit() {
    return true;
  }
  get CanRaise() {
    return true;
  }
  get HasTrackList() {
    return false;
  }
  get Identity() {
    return "Amazon Music Linux";
  }
  get DesktopEntry() {
    return "io.github.amzml.AmazonMusic";
  }
  get SupportedUriSchemes() {
    return [];
  }
  get SupportedMimeTypes() {
    return [];
  }
}
Root.configureMembers({
  methods: { Raise: {}, Quit: {} },
  properties: Object.fromEntries(
    Object.entries({
      CanQuit: "b",
      CanRaise: "b",
      HasTrackList: "b",
      Identity: "s",
      DesktopEntry: "s",
      SupportedUriSchemes: "as",
      SupportedMimeTypes: "as",
    }).map(([k, signature]) => [k, { signature, access: ACCESS_READ }]),
  ),
});
class Player extends Interface {
  constructor(host) {
    super(PLAYER);
    this.host = host;
  }
  PlayPause() {
    this.host.command("toggle");
  }
  Play() {
    this.host.command("play");
  }
  Pause() {
    this.host.command("pause");
  }
  Stop() {
    this.Pause();
  }
  Next() {
    if (!this.CanGoNext)
      throw new dbus.DBusError(
        "org.mpris.MediaPlayer2.Error.NotSupported",
        "Next unavailable",
      );
    this.host.command("next");
  }
  Previous() {
    if (!this.CanGoPrevious)
      throw new dbus.DBusError(
        "org.mpris.MediaPlayer2.Error.NotSupported",
        "Previous unavailable",
      );
    this.host.command("previous");
  }
  Seek() {
    throw new dbus.DBusError(
      "org.mpris.MediaPlayer2.Error.NotSupported",
      "Seek unavailable",
    );
  }
  SetPosition() {
    this.Seek();
  }
  OpenUri() {
    this.Seek();
  }
  get PlaybackStatus() {
    return !this.host.media.available
      ? "Stopped"
      : this.host.media.paused
        ? "Paused"
        : "Playing";
  }
  get Metadata() {
    const m = this.host.media;
    if (!m.available) return {};
    return {
      "mpris:trackid": V(
        "o",
        OBJECT +
          "/track/" +
          crypto
            .createHash("sha256")
            .update([m.title, m.artist, m.album].join("\n"))
            .digest("hex"),
      ),
      "xesam:title": V("s", m.title || "Amazon Music"),
      "xesam:artist": V("as", [m.artist || "Amazon Music"]),
      "xesam:album": V("s", m.album || ""),
      "mpris:artUrl": V("s", this.host.art),
    };
  }
  get Rate() {
    return 1;
  }
  get MinimumRate() {
    return 1;
  }
  get MaximumRate() {
    return 1;
  }
  get Position() {
    return 0n;
  }
  get Volume() {
    return this.host.muted ? 0 : 1;
  }
  set Volume(value) {
    this.host.command(value === 0 ? "mute-on" : "mute-off");
  }
  get CanGoNext() {
    return !!this.host.media.available && !!this.host.media.canNext;
  }
  get CanGoPrevious() {
    return !!this.host.media.available && !!this.host.media.canPrevious;
  }
  get CanPlay() {
    return !!this.host.media.available;
  }
  get CanPause() {
    return this.CanPlay;
  }
  get CanSeek() {
    return false;
  }
  get CanControl() {
    return true;
  }
}
Player.configureMembers({
  methods: {
    PlayPause: {},
    Play: {},
    Pause: {},
    Stop: {},
    Next: {},
    Previous: {},
    Seek: { inSignature: "x" },
    SetPosition: { inSignature: "ox" },
    OpenUri: { inSignature: "s" },
  },
  properties: Object.fromEntries(
    Object.entries({
      PlaybackStatus: "s",
      Metadata: "a{sv}",
      Rate: "d",
      MinimumRate: "d",
      MaximumRate: "d",
      Position: "x",
      Volume: "d",
      CanGoNext: "b",
      CanGoPrevious: "b",
      CanPlay: "b",
      CanPause: "b",
      CanSeek: "b",
      CanControl: "b",
    }).map(([k, signature]) => [
      k,
      { signature, access: k === "Volume" ? ACCESS_READWRITE : ACCESS_READ },
    ]),
  ),
});
function imageValid(bytes) {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    const w = bytes.readUInt32BE(16),
      h = bytes.readUInt32BE(20);
    return w > 0 && h > 0 && w <= 4096 && h <= 4096;
  }
  if (bytes[0] !== 255 || bytes[1] !== 216) return false;
  for (let i = 2; i + 9 < bytes.length; ) {
    if (bytes[i++] !== 255) continue;
    const marker = bytes[i++];
    if (marker === 0xda || marker === 0xd9) return false;
    const size = bytes.readUInt16BE(i);
    if (size < 2 || i + size > bytes.length) return false;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      const h = bytes.readUInt16BE(i + 3),
        w = bytes.readUInt16BE(i + 5);
      return h > 0 && w > 0 && h <= 4096 && w <= 4096;
    }
    i += size;
  }
  return false;
}
class Desktop {
  constructor(root, directory, command, test = false) {
    this.command = command;
    this.media = { available: false, paused: true };
    this.muted = false;
    this.generation = 0;
    this.key = "";
    this.fallback = pathToFileURL(
      path.join(root, "assets/io.github.amzml.AmazonMusic.png"),
    ).href;
    this.art = this.fallback;
    this.directory = path.join(directory, "artwork");
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.bus = dbus.sessionBus();
    this.bus.on("error", (error) => console.error("D-Bus:", error.message));
    this.player = new Player(this);
    this.bus.export(OBJECT, new Root(this));
    this.bus.export(OBJECT, this.player);
    this.name =
      "org.mpris.MediaPlayer2.amazon_music_linux" +
      (test ? ".test" + process.pid : "");
    this.bus
      .requestName(this.name, 4)
      .then((result) => {
        if (result !== 1) throw Error("MPRIS name already owned");
      })
      .catch((error) => console.error("MPRIS:", error.message));
  }
  update(media, muted) {
    this.media = media;
    this.muted = muted;
    this.emit();
    const key = media.artwork || "";
    if (key !== this.key) {
      this.key = key;
      const generation = ++this.generation;
      this.art = this.fallback;
      this.emit();
      this.loadArtwork(key, generation).catch(() => {});
    }
  }
  emit() {
    const p = this.player;
    Interface.emitPropertiesChanged(
      p,
      Object.fromEntries(
        [
          "PlaybackStatus",
          "Metadata",
          "CanGoNext",
          "CanGoPrevious",
          "CanPlay",
          "CanPause",
          "Volume",
        ].map((k) => [k, p[k]]),
      ),
      [],
    );
  }
  async loadArtwork(raw, generation) {
    if (!artworkURL(raw)) return;
    let bytes;
    if (raw.startsWith("data:"))
      bytes = Buffer.from(raw.slice(raw.indexOf(",") + 1), "base64");
    else {
      let url = raw;
      for (let redirect = 0; redirect < 4; redirect++) {
        const response = await fetch(url, {
          redirect: "manual",
          signal: AbortSignal.timeout(6000),
        });
        if (response.status >= 300 && response.status < 400) {
          url = new URL(response.headers.get("location"), url).href;
          if (!artworkURL(url) || !url.startsWith("https:")) return;
          continue;
        }
        if (
          !response.ok ||
          Number(response.headers.get("content-length")) > 4 * 1024 * 1024
        )
          return;
        const chunks = [];
        let length = 0;
        for await (const chunk of response.body) {
          length += chunk.length;
          if (length > 4 * 1024 * 1024) {
            await response.body.cancel().catch(() => {});
            return;
          }
          chunks.push(chunk);
        }
        bytes = Buffer.concat(chunks);
        break;
      }
    }
    if (!bytes || !imageValid(bytes) || generation !== this.generation) return;
    const file = path.join(
      this.directory,
      crypto.createHash("sha256").update(bytes).digest("hex") + ".image",
    );
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    this.art = pathToFileURL(file).href;
    this.emit();
    const files = fs
      .readdirSync(this.directory)
      .map((name) => ({
        name,
        date: fs.statSync(path.join(this.directory, name)).mtimeMs,
      }))
      .sort((a, b) => b.date - a.date);
    for (const f of files.slice(32))
      if (f.name !== path.basename(file))
        fs.rmSync(path.join(this.directory, f.name), { force: true });
  }
  close() {
    this.generation++;
    this.bus.disconnect();
  }
}
module.exports = { Desktop, imageValid };
