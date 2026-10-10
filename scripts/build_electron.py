#!/usr/bin/python3
"""Download a pinned, verified ECS runtime and build a self-contained RPM."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import urllib.request
from urllib.parse import quote
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ELECTRON = "44.5.1+wvcus"
HASHES = {
    "x64": "afa7d4ea49abf1e91c5be0f88cfe1abdb977ff3454d57658e90b004aacbde9cc",
    "arm64": "4c8254f1719e7596e3e5661a2c7922591bd3c5eb2dacd74fb96b022ea291ea95",
}
RPM_ARCH = {"x64": "x86_64", "arm64": "aarch64"}


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def extract_runtime(archive, destination):
    """Upstream archives contain regular files only; reject traversal and symlinks."""
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as bundle:
        for item in bundle.infolist():
            target = destination / item.filename
            if not target.resolve().is_relative_to(destination.resolve()):
                raise ValueError("Caminho inseguro no arquivo do runtime")
            mode = item.external_attr >> 16
            if mode & 0o170000 == 0o120000:
                raise ValueError("Symlink inesperado no runtime")
            bundle.extract(item, destination)
            if not item.is_dir():
                target.chmod(0o755 if mode & 0o111 else 0o644)
    for name in ["electron", "chrome-sandbox", "chrome_crashpad_handler"]:
        (destination / name).chmod(0o755)


def runtime(arch):
    cache = ROOT / ".cache/runtime"
    cache.mkdir(parents=True, exist_ok=True)
    filename = f"electron-v{ELECTRON}-linux-{arch}.zip"
    archive = cache / filename
    if not archive.exists():
        url = ("https://github.com/castlabs/electron-releases/releases/download/"
               f"v{quote(ELECTRON, safe='')}/{quote(filename, safe='')}")
        print(f"Baixando Electron {ELECTRON} ({arch})…", flush=True)
        temporary = archive.with_suffix(".download")
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "AmazonMusicLinux-build/0.1"})
            with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as stream:
                shutil.copyfileobj(response, stream)
            temporary.rename(archive)
        finally:
            temporary.unlink(missing_ok=True)
    if digest(archive) != HASHES[arch]:
        raise ValueError(f"Checksum SHA-256 incorreto: {archive}. Remova o arquivo e tente novamente.")
    destination = cache / ("electron" if arch == "x64" else "electron-arm64")
    marker = destination / ".amzml-runtime.json"
    identity = {"version": ELECTRON, "sha256": HASHES[arch]}
    if marker.exists() and json.loads(marker.read_text()) == identity:
        return destination
    if destination.exists():
        shutil.rmtree(destination)
    extract_runtime(archive, destination)
    marker.write_text(json.dumps(identity))
    return destination


def build_runtime():
    arch = {"x86_64":"x64", "aarch64":"arm64"}.get(platform.machine())
    if not arch: raise RuntimeError("Supported architectures: x86_64 and aarch64")
    return runtime(arch)

if __name__ == '__main__': print(build_runtime())
