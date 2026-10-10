#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
/usr/bin/python3 -m unittest discover -s tests -p 'test_*.py'
desktop-file-validate packaging/io.github.amzml.AmazonMusic.desktop
if [ -x .cache/runtime/electron/electron ]; then
    ELECTRON_RUN_AS_NODE=1 .cache/runtime/electron/electron --test tests/*.test.cjs
fi
