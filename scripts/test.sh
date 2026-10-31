#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
./scripts/node.sh --test tests/*.test.cjs
desktop-file-validate packaging/io.github.amzml.AmazonMusic.desktop
sh -n pwa/amazon-music-pwa
desktop-file-validate pwa/*.desktop
sh -n scripts/run-electron.sh electron-wrapper/amazon-music-electron
desktop-file-validate electron-wrapper/*.desktop
./scripts/node.sh --check electron-wrapper/main.cjs
