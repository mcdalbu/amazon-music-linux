#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
./scripts/node.sh --test tests/*.test.cjs
desktop-file-validate packaging/io.github.amzml.AmazonMusic.desktop
