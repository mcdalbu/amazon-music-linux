"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { MemoryMaintenance } = require("../electron/memory.cjs");
function harness(failure = false) {
  const calls = [],
    reports = [];
  let attached = false;
  const wc = {
    isDestroyed: () => false,
    isLoadingMainFrame: () => false,
    debugger: {
      isAttached: () => attached,
      attach: () => {
        attached = true;
        calls.push("attach");
      },
      detach: () => {
        attached = false;
        calls.push("detach");
      },
      sendCommand: async (name, args) => {
        calls.push([name, args]);
        if (failure) throw Error("Unavailable");
        return { usedSize: 100 };
      },
    },
  };
  return {
    calls,
    reports,
    wc,
    manager: new MemoryMaintenance(
      () => wc,
      (r) => reports.push(r),
      { delay: 10 },
    ),
  };
}
test("Memory maintenance asks Chromium to reclaim, and never reloads or clears session data", async () => {
  const h = harness();
  await h.manager.trim();
  assert.equal(h.reports.at(-1).status, "complete");
  assert.deepEqual(
    h.calls.map((x) => (Array.isArray(x) ? x[0] : x)),
    [
      "attach",
      "Runtime.getHeapUsage",
      "HeapProfiler.collectGarbage",
      "Memory.simulatePressureNotification",
      "Runtime.getHeapUsage",
      "detach",
    ],
  );
  assert.deepEqual(
    h.calls.find((x) => x[0] === "Memory.simulatePressureNotification")[1],
    { level: "moderate" },
  );
  h.manager.close();
});
test("Background cleanup is cancelled when the window is reopened and runs only once per hide", async () => {
  const h = harness();
  h.manager.setBackground(true);
  h.manager.setBackground(false);
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(h.calls.length, 0);
  h.manager.setBackground(true);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(h.manager.count, 1);
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(h.manager.count, 1);
  h.manager.close();
});
test("Cleanup always detaches its own debugger on failure and leaves external debuggers alone", async () => {
  const h = harness(true);
  await h.manager.trim();
  assert.equal(h.reports.at(-1).status, "unavailable");
  assert.equal(h.calls.at(-1), "detach");
  h.manager.close();
  const other = harness();
  other.wc.debugger.isAttached = () => true;
  await other.manager.trim();
  assert.deepEqual(other.calls, []);
  assert.equal(other.reports.at(-1).status, "unavailable");
  other.manager.close();
});
