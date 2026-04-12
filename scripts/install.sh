#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/plugins/codex-switcher/scripts/codex-sw"

[[ -x "$BIN" ]] || { echo "codex-sw binary not executable: $BIN" >&2; exit 1; }

mkdir -p "$HOME/.local/bin"
ln -sf "$BIN" "$HOME/.local/bin/codex-sw"
ln -sf "$ROOT/plugins/codex-switcher/scripts/codex-switcher" "$HOME/.local/bin/codex-switcher"

"$BIN" init --shell "$(basename "${SHELL:-zsh}")"

echo "Installed codex-sw. Run: source ~/.zshrc (or your shell rc file)"
