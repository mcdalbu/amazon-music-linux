#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ -n "${AMZML_NODE:-}" ]; then exec "$AMZML_NODE" "$@"
elif [ -x "$root/.cache/node/bin/node" ]; then exec "$root/.cache/node/bin/node" "$@"
elif command -v node >/dev/null 2>&1; then exec node "$@"
else echo 'Instale Node.js 24 ou defina AMZML_NODE para executar os scripts de desenvolvimento.' >&2; exit 1; fi
