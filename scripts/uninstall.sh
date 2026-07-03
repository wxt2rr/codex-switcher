#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$ROOT/scripts/bin/codex-sw-node.cjs"
STATE_DIR="${CODEX_SWITCHER_STATE_DIR:-$HOME/.codex-switcher}"
ENVS_DIR="${CODEX_SWITCHER_ENVS_DIR:-$HOME/.codex-envs}"

PURGE="false"
NODE_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge)
      PURGE="true"
      shift
      ;;
    --shell)
      [[ $# -ge 2 ]] || { echo "Usage: $0 [--shell <shell>] [--purge]" >&2; exit 1; }
      NODE_ARGS+=("$1" "$2")
      shift 2
      ;;
    *)
      echo "Usage: $0 [--shell <shell>] [--purge]" >&2
      exit 1
      ;;
  esac
done

[[ -f "$NODE_BIN" ]] || { echo "codex-sw node entry not found: $NODE_BIN" >&2; exit 1; }

node "$NODE_BIN" uninstall "${NODE_ARGS[@]}"

if [[ "$PURGE" == "true" ]]; then
  rm -rf "$STATE_DIR" "$ENVS_DIR"
  echo "State and env homes removed."
fi
