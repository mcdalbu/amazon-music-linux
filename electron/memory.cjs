"use strict";
// Internal CDP calls use Electron's private debugger transport, not a TCP port.
class MemoryMaintenance {
  constructor(target, report, { delay = 15000 } = {}) {
    this.target = target;
    this.report = report;
    this.delay = delay;
    this.timer = null;
    this.background = false;
    this.busy = false;
    this.count = 0;
    this.closed = false;
    this.status = "idle";
  }
  setBackground(background) {
    this.background = background;
    clearTimeout(this.timer);
    this.timer = null;
    if (background && !this.closed) {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.background) this.trim("background");
      }, this.delay);
      this.timer.unref?.();
    }
  }
  async trim(reason = "manual") {
    if (this.closed || this.busy) return;
    const wc = this.target();
    if (!wc || wc.isDestroyed() || wc.isLoadingMainFrame()) return;
    if (wc.debugger.isAttached()) {
      this.status = "unavailable";
      this.report({ status: this.status, reason, count: this.count });
      return;
    }
    this.busy = true;
    this.status = "running";
    this.report({ status: this.status, reason, count: this.count });
    let attached = false;
    try {
      wc.debugger.attach("1.3");
      attached = true;
      const before = await wc.debugger.sendCommand("Runtime.getHeapUsage");
      await wc.debugger.sendCommand("HeapProfiler.collectGarbage");
      // Let Chromium reclaim unused allocator/cache pages, without critical
      // pressure, renderer suspension, page reloads or deleting the session.
      await wc.debugger.sendCommand("Memory.simulatePressureNotification", {
        level: "moderate",
      });
      const after = await wc.debugger.sendCommand("Runtime.getHeapUsage");
      this.status = "complete";
      this.count++;
      this.report({
        status: this.status,
        reason,
        count: this.count,
        beforeJSHeapBytes: before.usedSize,
        afterJSHeapBytes: after.usedSize,
      });
    } catch (error) {
      this.status = "unavailable";
      this.report({
        status: this.status,
        reason,
        count: this.count,
        error: String(error.message).slice(0, 200),
      });
    } finally {
      if (attached && !wc.isDestroyed() && wc.debugger.isAttached())
        wc.debugger.detach();
      this.busy = false;
    }
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
module.exports = { MemoryMaintenance };
