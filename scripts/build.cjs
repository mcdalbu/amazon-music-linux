"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  { prepare, digest } = require("./runtimes.cjs");
const { version } = require("../package.json");
require("./build-native.cjs");
const runtime = prepare();
const base = path.join(root, "build", "node-rpm"),
  name = "amazon-music-linux-" + version,
  stage = path.join(base, "stage", name),
  app = path.join(stage, "app");
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(app, { recursive: true });
const cp = (from, to) =>
  fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
for (const directory of ["app", "electron", "assets", "node_modules", "vendor"])
  cp(path.join(root, directory), path.join(app, directory));
for (const filename of [
  "package.json",
  "pnpm-lock.yaml",
  "README.md",
  "LICENSE",
])
  cp(path.join(root, filename), path.join(app, filename));
fs.mkdirSync(path.join(app, "tests"));
cp(
  path.join(root, "tests/player_fixture.html"),
  path.join(app, "tests/player_fixture.html"),
);
cp(runtime.electron, path.join(app, "runtime"));
fs.mkdirSync(path.join(app, "node/bin"), { recursive: true });
cp(path.join(runtime.node, "bin/node"), path.join(app, "node/bin/node"));
cp(path.join(runtime.node, "LICENSE"), path.join(app, "node/LICENSE"));
cp(path.join(root, "packaging"), path.join(stage, "packaging"));
for (const dir of [
  "BUILD",
  "BUILDROOT",
  "RPMS",
  "SOURCES",
  "SPECS",
  "SRPMS",
  "tmp",
])
  fs.mkdirSync(path.join(base, dir), { recursive: true });
const source = path.join(base, "SOURCES", name + ".tar.gz");
execFileSync("tar", ["-czf", source, "-C", path.dirname(stage), name]);
const spec = fs
  .readFileSync(path.join(root, "packaging/amazon-music-linux.spec.in"), "utf8")
  .replaceAll("@VERSION@", version);
const specfile = path.join(base, "SPECS/amazon-music-linux.spec");
fs.writeFileSync(specfile, spec);
const arch = { x64: "x86_64", arm64: "aarch64" }[process.arch];
execFileSync(
  "rpmbuild",
  [
    "-bb",
    "--define",
    "_topdir " + base,
    "--define",
    "_tmppath " + path.join(base, "tmp"),
    "--define",
    "_binary_payload w6T2.zstdio",
    "--target",
    arch,
    specfile,
  ],
  { stdio: "inherit" },
);
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });
for (const file of fs
  .readdirSync(path.join(base, "RPMS", arch))
  .filter((x) => x.endsWith(".rpm"))) {
  const target = path.join(dist, file);
  fs.copyFileSync(path.join(base, "RPMS", arch, file), target);
  fs.writeFileSync(target + ".sha256", digest(target) + "  " + file + "\n");
  console.log("RPM:", target);
}
