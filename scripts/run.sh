#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
unset ELECTRON_RUN_AS_NODE CHROME_DESKTOP
if [ ! -f app/bridge.node ] || [ app/bridge.c -nt app/bridge.node ]; then ./scripts/node.sh scripts/build-native.cjs; fi
exec ./scripts/node.sh app/main.cjs "$@"
