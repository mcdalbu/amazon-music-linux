"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  cache = path.join(root, ".cache");
const versions = { node: "24.22.1", electron: "44.5.1+wvcus" };
const hashes = {
  node: {
    x64: "6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6",
    arm64: "dbabf7a1cbf947e6059ffad2c27b80041db97dea1e553b62afdee7f13fca336e",
  },
  electron: {
    x64: "afa7d4ea49abf1e91c5be0f88cfe1abdb977ff3454d57658e90b004aacbde9cc",
    arm64: "4c8254f1719e7596e3e5661a2c7922591bd3c5eb2dacd74fb96b022ea291ea95",
  },
};
function digest(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}
function download(url, file, checksum) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    const temp = file + ".download";
    try {
      execFileSync(
        "curl",
        ["--fail", "--location", "--retry", "2", "--output", temp, url],
        { stdio: "inherit" },
      );
      if (digest(temp) !== checksum) throw Error("Checksum mismatch: " + file);
      fs.renameSync(temp, file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
  if (digest(file) !== checksum) throw Error("Checksum mismatch: " + file);
}
function safeNames(names) {
  for (const name of names.split("\n").filter(Boolean))
    if (path.isAbsolute(name) || name.split("/").includes(".."))
      throw Error("Unsafe archive path");
}
function prepare() {
  const arch = process.arch;
  if (!hashes.node[arch]) throw Error("Only x64 and arm64 are supported");
  const nodeFile = path.join(
    cache,
    `node-v${versions.node}-linux-${arch}.tar.xz`,
  );
  download(
    `https://nodejs.org/dist/v${versions.node}/${path.basename(nodeFile)}`,
    nodeFile,
    hashes.node[arch],
  );
  const nodeDest = path.join(cache, "node");
  if (!fs.existsSync(path.join(nodeDest, "bin/node"))) {
    safeNames(execFileSync("tar", ["-tJf", nodeFile], { encoding: "utf8" }));
    fs.mkdirSync(nodeDest, { recursive: true });
    execFileSync("tar", [
      "-xJf",
      nodeFile,
      "--strip-components=1",
      "-C",
      nodeDest,
    ]);
  }
  const file = path.join(
      cache,
      "runtime",
      `electron-v${versions.electron}-linux-${arch}.zip`,
    ),
    dest = path.join(cache, "runtime", "electron");
  download(
    `https://github.com/castlabs/electron-releases/releases/download/v${encodeURIComponent(versions.electron)}/${encodeURIComponent(path.basename(file))}`,
    file,
    hashes.electron[arch],
  );
  if (!fs.existsSync(path.join(dest, "electron"))) {
    safeNames(execFileSync("unzip", ["-Z1", file], { encoding: "utf8" }));
    const modes = execFileSync("zipinfo", ["-l", file], { encoding: "utf8" });
    if (/^l/m.test(modes))
      throw Error("Unexpected symlink in Electron archive");
    fs.mkdirSync(dest, { recursive: true });
    execFileSync("unzip", ["-q", file, "-d", dest]);
  }
  return { node: nodeDest, electron: dest };
}
module.exports = { prepare, digest, versions, safeNames };
if (require.main === module) console.log(prepare());
