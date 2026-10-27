"use strict";
const { execFileSync } = require("node:child_process");
const path = require("node:path"),
  fs = require("node:fs");
const root = path.resolve(__dirname, "..");
const flags = execFileSync("pkg-config", ["--cflags", "--libs", "gtk4"], {
  encoding: "utf8",
})
  .trim()
  .split(/\s+/);
for (const [source, target, extra] of [
  ["app/bridge.c", "app/bridge.node", flags],
  ["electron/gpu-bridge.c", "electron/gpu-bridge.node", []],
]) {
  execFileSync(
    process.env.CC || "cc",
    [
      "-std=c11",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Wno-misleading-indentation",
      "-fPIC",
      "-shared",
      "-D_GNU_SOURCE",
      "-DNAPI_VERSION=8",
      "-I" + path.join(root, "vendor/node-api"),
      path.join(root, source),
      "-o",
      path.join(root, target + ".tmp"),
      ...extra,
    ],
    { stdio: "inherit" },
  );
  fs.renameSync(path.join(root, target + ".tmp"), path.join(root, target));
}
