#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -x .cache/runtime/electron/electron ]; then
    /usr/bin/python3 scripts/build_electron.py
fi
unset ELECTRON_RUN_AS_NODE CHROME_DESKTOP
if [ ! -f electron/gpu-bridge.node ] || [ electron/gpu-bridge.c -nt electron/gpu-bridge.node ]; then
    /usr/bin/python3 scripts/build_gpu_bridge.py
fi
exec /usr/bin/python3 native/app.py "$@"
