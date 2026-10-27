"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  net = require("node:net"),
  { spawn } = require("node:child_process");
const { GLib } = require("./gi.cjs");
const bridge = require("./bridge.node");
const MAX = 64 * 1024 * 1024;
function textureInfo(info, fds) {
  if (
    !info ||
    !Number.isSafeInteger(info.sequence) ||
    info.sequence <= 0 ||
    !["bgra", "rgba"].includes(info.format)
  )
    throw Error("Invalid texture identity");
  for (const key of ["width", "height"])
    if (!Number.isInteger(info[key]) || info[key] < 1 || info[key] > 8192)
      throw Error("Invalid texture dimensions");
  if (
    typeof info.modifier !== "string" ||
    !/^\d+$/.test(info.modifier) ||
    BigInt(info.modifier) > 2n ** 64n - 1n
  )
    throw Error("Invalid texture modifier");
  if (
    !Array.isArray(info.planes) ||
    info.planes.length !== fds.length ||
    fds.length < 1 ||
    fds.length > 4
  )
    throw Error("Invalid texture planes");
  const planes = info.planes.map((p, i) => {
    if (
      !p ||
      !["stride", "offset", "size"].every(
        (k) => Number.isSafeInteger(p[k]) && p[k] >= 0,
      ) ||
      !p.stride ||
      p.stride > 0xffffffff ||
      p.offset > 0xffffffff ||
      p.size < 1 ||
      p.size > 256 * 1024 * 1024
    )
      throw Error("Invalid texture layout");
    return { ...p, fd: fds[i] };
  });
  return {
    info: {
      ...info,
      fourcc: info.format === "bgra" ? 0x34325241 : 0x34324241,
      modifier: BigInt(info.modifier),
    },
    planes,
  };
}
class Engine {
  constructor(root, profile, url, { gpu, onEvent, onFrame, onExit }) {
    this.onEvent = onEvent;
    this.onFrame = onFrame;
    this.state = {};
    this.pending = null;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    const [parent, child, memory, texture, textureChild] = bridge.channels();
    this.memory = memory;
    this.textureFD = texture;
    const runtime = fs.existsSync(path.join(root, "runtime/electron"))
      ? path.join(root, "runtime/electron")
      : path.join(root, ".cache/runtime/electron/electron");
    const env = {
      ...process.env,
      AMZML_ENGINE_FD: "3",
      AMZML_FRAME_FD: "4",
      AMZML_TEXTURE_FD: "5",
      AMZML_PROFILE: profile,
      AMZML_URL: url,
      AMZML_GPU: gpu ? "1" : "0",
      AMZML_SHARED_TEXTURE: gpu ? "1" : "0",
      AMZML_X11: process.env.GDK_BACKEND === "x11" ? "1" : "0",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.CHROME_DESKTOP;
    this.socket = new net.Socket({
      fd: parent,
      readable: true,
      writable: true,
    });
    this.socket.on("data", (chunk) => {
      try {
        this.receive(chunk);
      } catch (error) {
        onEvent(3, error.message);
        this.stop();
      }
    });
    this.socket.on("error", (error) => {
      if (!this.closed) onEvent(3, error.message);
    });
    try {
      this.process = spawn(runtime, [path.join(root, "electron/main.cjs")], {
        env,
        stdio: ["ignore", "inherit", "inherit", child, memory, textureChild],
      });
    } catch (error) {
      this.socket.destroy();
      for (const fd of [child, memory, texture, textureChild]) fs.closeSync(fd);
      throw error;
    }
    for (const fd of [child, textureChild]) fs.closeSync(fd);
    this.process.on("error", (error) => onEvent(3, error.message));
    this.process.on("exit", (code, signal) => {
      this.closed = true;
      onExit?.(code, signal);
    });
    bridge.onRelease((sequence) => this.send("texture-release", { sequence }));
    this.io = GLib.IOChannel.unixNew(texture);
    this.watch = GLib.ioAddWatch(
      this.io,
      0,
      GLib.IOCondition.IN | GLib.IOCondition.HUP,
      (_channel, condition) => {
        if (condition & GLib.IOCondition.HUP) {
          this.watch = 0;
          return false;
        }
        try {
          let packet;
          while ((packet = bridge.receiveTexture(texture))) {
            const [body, fds] = packet;
            let info;
            try {
              info = JSON.parse(body.toString());
              const checked = textureInfo(info, fds);
              this.enqueue({ gpu: true, ...checked });
            } catch (error) {
              console.error("Texture packet:", error);
              for (const fd of fds) fs.closeSync(fd);
              if (info?.sequence)
                this.send("texture-release", { sequence: info.sequence });
              this.send("texture-fallback");
            }
          }
        } catch (error) {
          if (!this.closed) onEvent(3, error.message);
          this.watch = 0;
          return false;
        }
        return true;
      },
    );
  }
  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > 1024 * 1024)
      throw Error("Oversized engine packet");
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32BE(0);
      if (size < 2 || size > 8192) throw Error("Invalid packet size");
      if (this.buffer.length < size + 4) return;
      const message = JSON.parse(this.buffer.subarray(4, size + 4));
      this.buffer = this.buffer.subarray(size + 4);
      if (message.type === "frame") {
        const { width: w, height: h, bytes, slot, sequence } = message;
        if (
          !Number.isInteger(w) ||
          !Number.isInteger(h) ||
          w < 1 ||
          h < 1 ||
          w > 8192 ||
          h > 8192 ||
          bytes !== w * h * 4 ||
          bytes > MAX ||
          !Number.isInteger(slot) ||
          slot < 0 ||
          slot > 2 ||
          !Number.isSafeInteger(sequence) ||
          sequence <= 0
        )
          throw Error("Invalid frame");
        this.enqueue({ gpu: false, info: message });
      } else if (
        message.type === "event" &&
        Number.isInteger(message.kind) &&
        typeof message.text === "string"
      ) {
        if (message.kind === 16) this.state = JSON.parse(message.text);
        else this.onEvent(message.kind, message.text);
      } else throw Error("Invalid engine event");
    }
  }
  enqueue(frame) {
    if (process.env.AMZML_DEBUG === "1")
      console.log("FRAME_IN", frame.gpu, frame.info.width, frame.info.height);
    if (this.pending) this.release(this.pending);
    this.pending = frame;
    this.onFrame();
  }
  release(frame) {
    if (frame.gpu) {
      for (const p of frame.planes) fs.closeSync(p.fd);
      this.send("texture-release", { sequence: frame.info.sequence });
    } else
      this.send("frame-release", {
        slot: frame.info.slot,
        sequence: frame.info.sequence,
      });
  }
  present(address) {
    const frame = this.pending;
    if (!frame) return false;
    this.pending = null;
    if (frame.gpu) {
      try {
        bridge.presentGPU(address, frame.info, frame.planes);
        this.send("texture-ready");
      } catch (error) {
        console.error("Texture import:", error);
        this.release(frame);
        this.send("texture-fallback");
        return false;
      }
    } else {
      const data = Buffer.allocUnsafe(frame.info.bytes);
      try {
        let offset = 0;
        while (offset < data.length) {
          const n = fs.readSync(
            this.memory,
            data,
            offset,
            data.length - offset,
            frame.info.slot * MAX + offset,
          );
          if (!n) throw Error("Incomplete frame");
          offset += n;
        }
        bridge.presentBitmap(
          address,
          frame.info.width,
          frame.info.height,
          data,
        );
      } finally {
        this.release(frame);
      }
    }
    return true;
  }
  send(command, args = {}) {
    if (!this.closed && !this.socket.destroyed)
      this.socket.write(JSON.stringify({ command, ...args }) + "\n");
  }
  stop() {
    if (this.closed) return;
    this.send("close");
    this.killTimer = setTimeout(() => this.process.kill("SIGKILL"), 5000);
    this.killTimer.unref();
  }
  dispose() {
    clearTimeout(this.killTimer);
    if (this.watch) GLib.sourceRemove(this.watch);
    this.watch = 0;
    if (this.pending) this.release(this.pending);
    this.pending = null;
    this.socket.destroy();
    for (const fd of [this.memory, this.textureFD])
      try {
        fs.closeSync(fd);
      } catch {}
  }
}
module.exports = { Engine, textureInfo };
