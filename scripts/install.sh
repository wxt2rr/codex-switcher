#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$ROOT/scripts/bin/codex-sw-node.cjs"

[[ -f "$NODE_BIN" ]] || { echo "codex-sw node entry not found: $NODE_BIN" >&2; exit 1; }

exec node "$NODE_BIN" install "$@"
