"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs");
const { gi, Gtk, Adw } = require("./gi.cjs"),
  bridge = require("./bridge.node");
function cpuTree(pid, result = {}) {
  try {
    const stat = fs
      .readFileSync(`/proc/${pid}/stat`, "utf8")
      .split(")")
      .slice(1)
      .join(")")
      .trim()
      .split(/\s+/);
    result[pid] = Number(stat[11]) + Number(stat[12]);
    for (const child of fs
      .readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8")
      .trim()
      .split(/\s+/)
      .filter(Boolean))
      cpuTree(child, result);
  } catch {}
  return result;
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition, label, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (condition()) return;
    await wait(50);
  }
  throw Error("Timeout: " + label);
}
async function script(app, source) {
  app.scriptSequence = (app.scriptSequence || 0) + 1;
  const requestId = app.scriptSequence;
  app.engine.send("script", { script: source, requestId });
  await until(
    () => app.reports?.some((r) => r.requestId === requestId),
    "fixture result " + requestId,
  );
  const report = app.reports.find((r) => r.requestId === requestId);
  if (report.error) throw Error(report.error);
  return report.result;
}
function click(app, x, y) {
  for (const type of ["mouseDown", "mouseUp"])
    app.engine.send("mouse", {
      event: { type, x, y, button: "left", clickCount: 1 },
    });
}
function smoke(app) {
  if (process.env.AMZML_MEMORY_TEST === "1") return memorySmoke(app);
  (async () => {
    console.log("SMOKE stage startup");
    await until(() => app.ready && app.frames > 0, "first frame", 25000);
    await wait(700);
    assert.equal(app.engine.state.visibleWindows, 0);
    assert.equal(app.engine.state.sandbox, true);
    assert.ok(app.window instanceof Adw.ApplicationWindow);
    assert.equal(app.app.getWindows().length, 1);
    await until(() => {
      const frame = bridge.capture(
        BigInt(gi.System.addressOf(app.picture)),
        "",
      );
      return frame[0] === app.overlay.getWidth() * app.window.getScaleFactor();
    }, "HiDPI frame after startup resize");
    const capture = bridge.capture(
      BigInt(gi.System.addressOf(app.picture)),
      process.env.AMZML_CAPTURE ||
        path.join(app.desktop.directory, "smoke.png"),
    );
    assert.equal(capture[2], 1, "Player must contain actual page pixels");
    assert.equal(
      capture[0],
      app.overlay.getWidth() * app.window.getScaleFactor(),
    );
    console.log("SMOKE stage preferences");
    app.preferences();
    await wait(250);
    app.themeRow.setSelected(2);
    assert.equal(app.style.getDark(), true);
    app.themeRow.setSelected(1);
    assert.equal(app.style.getDark(), false);
    app.themeRow.setSelected(0);
    app.gpuRow.setActive(true);
    app.backgroundRow.setActive(true);
    app.prefs.close();
    assert.equal(app.app.getWindows().length, 1);
    console.log("SMOKE stage input");
    click(app, 100, 130);
    app.engine.send("text", { text: "Música — 日本語" });
    await wait(200);
    let report = await script(app, "report()");
    assert.equal(report.text, "Música — 日本語");
    click(app, 100, 195);
    await wait(100);
    report = await script(app, "report()");
    assert.equal(report.clicks, 1);
    app.engine.send("mouse", {
      event: {
        type: "mouseWheel",
        x: 400,
        y: 300,
        deltaY: -100.5,
        deltaX: 0,
        hasPreciseScrollingDeltas: true,
        canScroll: true,
      },
    });
    await wait(300);
    report = await script(app, "report()");
    assert.ok(report.scroll > 0);
    console.log("SMOKE stage media");
    await until(
      () => app.media.available && app.media.canNext && app.media.canPrevious,
      "MPRIS media actions",
    );
    await until(() => app.desktop.art !== app.desktop.fallback, "album cover");
    const first = app.desktop.art;
    const dbus = require("dbus-next");
    const bus = dbus.sessionBus();
    const proxy = await bus.getProxyObject(
      app.desktop.name,
      "/org/mpris/MediaPlayer2",
    );
    const player = proxy.getInterface("org.mpris.MediaPlayer2.Player");
    const root = proxy.getInterface("org.mpris.MediaPlayer2");
    await player.Next();
    await until(
      () =>
        app.media.title === "Segunda faixa" &&
        app.desktop.art !== first &&
        app.desktop.art !== app.desktop.fallback,
      "next track and artwork",
    );
    await player.Previous();
    await until(() => app.media.title === "Faixa de teste", "previous track");
    console.log("SMOKE stage background");
    await player.Play();
    await until(() => !app.media.paused, "play");
    app.hide();
    await wait(300);
    assert.equal(app.background, true);
    assert.equal(app.media.paused, false);
    await until(
      () => app.engine.capturePaused,
      "capture pause acknowledgement",
    );
    await until(
      () => app.picture.getPaintable() === null,
      "hidden GTK texture released",
    );
    assert.equal(
      fs.fstatSync(app.engine.memory).blocks,
      0,
      "hidden software frame pages reclaimed",
    );
    await until(
      () =>
        app.memoryReport?.status === "complete" &&
        app.memoryReport.reason === "background",
      "automatic background memory cleanup",
      22000,
    );
    assert.equal(
      app.media.paused,
      false,
      "cleanup must preserve background audio",
    );
    await player.Pause();
    await until(() => app.media.paused, "background pause");
    const hiddenFrames = app.frames;
    await root.Raise();
    await until(() => app.frames > hiddenFrames, "fresh frame after reopen");
    const restored = bridge.capture(
      BigInt(gi.System.addressOf(app.picture)),
      "",
    );
    assert.equal(restored[2], 1, "reopened player must not remain black");
    const lastTrim = app.memoryReport.count;
    await script(
      app,
      "globalThis.memoryTestWaste = Array.from({length: 400000}, (_,i) => ({i, value:'temporary-'+i})); globalThis.memoryTestWaste = null; report()",
    );
    app.engine.send("trim-memory");
    await until(
      () =>
        app.memoryReport?.status === "complete" &&
        app.memoryReport.count > lastTrim,
      "manual memory cleanup",
    );
    console.log("MEMORY_CLEANUP", JSON.stringify(app.memoryReport));
    await wait(300);
    app.command("mute-on");
    await wait(100);
    assert.equal(app.desktop.player.Volume, 0);
    app.command("mute-off");
    console.log("SMOKE stage timing");
    for (const fps of [60, 144, app.rate]) {
      app.engine.send("frame-rate", { fps });
      app.engine.send("components");
      await until(
        () => app.engine.state.targetFrameRate === fps,
        "rate " + fps,
      );
    }
    await wait(2400);
    app.engine.send("components");
    await until(() => app.engine.state.frameRate === 15, "idle 15fps");
    const idleStart = performance.now(),
      cpuBefore = cpuTree(process.pid),
      idleFrames = app.frames;
    await wait(3000);
    const cpuAfter = cpuTree(process.pid);
    const cpuPercent =
      (Object.keys(cpuAfter).reduce(
        (n, pid) => n + Math.max(0, cpuAfter[pid] - (cpuBefore[pid] || 0)),
        0,
      ) *
        1000) /
      (performance.now() - idleStart);
    console.log(
      "NODE_IDLE",
      JSON.stringify({
        cpuPercentOneCore: Math.round(cpuPercent * 100) / 100,
        newFrames: app.frames - idleFrames,
      }),
    );
    app.engine.send("mouse", { event: { type: "mouseMove", x: 100, y: 100 } });
    app.engine.send("components");
    await until(
      () => app.engine.state.frameRate === app.rate,
      "interactive monitor refresh",
    );
    const before = app.frames,
      receivedBefore = app.engine.receivedFrames;
    await script(
      app,
      "new Promise(resolve=>{let n=0;function animate(){document.body.style.backgroundColor=n++%2?'#163848':'#284252';if(n<100)requestAnimationFrame(animate);else resolve({animated:n});}requestAnimationFrame(animate)})",
    );
    await until(
      () => app.engine.receivedFrames - receivedBefore >= 8,
      "continuous frames after memory cleanup",
      5000,
    );
    console.log(
      "FRAME_RECOVERY",
      JSON.stringify({
        presented: app.frames - before,
        received: app.engine.receivedFrames - receivedBefore,
      }),
    );
    bus.disconnect();
    console.log(
      "NODE_SMOKE PASS " +
        JSON.stringify({
          frames: app.frames,
          scale: app.window.getScaleFactor(),
          texture: capture.slice(0, 2),
          sharedGPU: app.engine.state.sharedGPU,
          targetHz: app.rate,
          gtkWindows: app.app.getWindows().length,
          offscreenWindows: app.engine.state.visibleWindows,
          media: true,
          albumArt: true,
          previousNext: true,
          backgroundAudio: true,
          idleFps: 15,
        }),
    );
    app.exitCode = 0;
  })()
    .catch((error) => {
      console.error("NODE_SMOKE FAIL", error);
      app.exitCode = 1;
    })
    .finally(() => app.quit());
}
function memorySmoke(app) {
  (async () => {
    await until(
      () => app.ready && app.frames > 0 && app.media.available,
      "memory fixture ready",
      25000,
    );
    app.save({ background: true });
    app.command("play");
    await until(() => !app.media.paused, "local audio playing");
    app.hide();
    await until(
      () => app.engine.capturePaused && app.picture.getPaintable() === null,
      "hidden frames released",
    );
    assert.equal(fs.fstatSync(app.engine.memory).blocks, 0);
    await until(
      () =>
        app.memoryReport?.status === "complete" &&
        app.memoryReport.reason === "background",
      "one-shot background reclamation",
      22000,
    );
    assert.equal(app.media.paused, false);
    const beforeShow = app.frames;
    app.command("open");
    await until(
      () => app.frames > beforeShow,
      "fresh frame after memory reclamation",
    );
    const frame = bridge.capture(BigInt(gi.System.addressOf(app.picture)), "");
    assert.equal(frame[2], 1);
    await script(
      app,
      "globalThis.memoryTestWaste=Array.from({length:400000},(_,i)=>({i,value:'temporary-'+i}));globalThis.memoryTestWaste=null;report()",
    );
    const previous = app.memoryReport.count;
    app.engine.send("trim-memory");
    await until(
      () =>
        app.memoryReport?.status === "complete" &&
        app.memoryReport.count > previous,
      "manual reclamation",
    );
    const report = app.memoryReport;
    assert.ok(report.afterJSHeapBytes < report.beforeJSHeapBytes);
    const receivedBefore = app.engine.receivedFrames;
    await script(
      app,
      "new Promise(resolve=>{let n=0;function animate(){document.body.style.backgroundColor=n++%2?'#163848':'#284252';if(n<100)requestAnimationFrame(animate);else resolve(n);}requestAnimationFrame(animate)})",
    );
    await until(
      () => app.engine.receivedFrames - receivedBefore >= 8,
      "frame stream after cleanup",
    );
    assert.equal(app.media.paused, false);
    app.command("next");
    await until(
      () => app.media.title === "Segunda faixa",
      "next after cleanup",
    );
    app.command("previous");
    await until(
      () => app.media.title === "Faixa de teste",
      "previous after cleanup",
    );
    app.command("pause");
    await until(() => app.media.paused, "pause after cleanup");
    console.log(
      "MEMORY_SMOKE PASS",
      JSON.stringify({
        ...report,
        sharedGPU: app.engine.state.sharedGPU,
        receivedFrames: app.engine.receivedFrames - receivedBefore,
        memfdAllocatedBytes: fs.fstatSync(app.engine.memory).blocks * 512,
      }),
    );
    app.exitCode = 0;
  })()
    .catch((error) => {
      console.error("MEMORY_SMOKE FAIL", error);
      app.exitCode = 1;
    })
    .finally(() => app.quit());
}
module.exports = { smoke };
