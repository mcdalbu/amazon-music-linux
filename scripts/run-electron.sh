#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
unset ELECTRON_RUN_AS_NODE CHROME_DESKTOP CHROME_WEB_APP_DESKTOP_ID_PREFIX
if [ ! -f "$root/electron-wrapper/gtk-theme.node" ] || [ "$root/electron-wrapper/gtk-theme.c" -nt "$root/electron-wrapper/gtk-theme.node" ]; then
  "$root/scripts/node.sh" "$root/scripts/build-electron-theme.cjs"
fi
runtime=${AMZML_ELECTRON_RUNTIME:-$root/.cache/runtime/electron/electron}
if [ ! -x "$runtime" ]; then
  echo 'Prepare the bundled runtime with ./scripts/node.sh scripts/runtimes.cjs' >&2
  exit 1
fi
exec "$runtime" "$root/electron-wrapper" "$@"
