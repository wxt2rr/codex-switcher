#!/usr/bin/env bash
set -euo pipefail

PURGE="false"
if [[ "${1:-}" == "--purge" ]]; then
  PURGE="true"
elif [[ -n "${1:-}" ]]; then
  echo "Usage: $0 [--purge]" >&2
  exit 1
fi

remove_block() {
  local file="$1"
  local start="# >>> codex-sw init >>>"
  local end="# <<< codex-sw init <<<"
  [[ -f "$file" ]] || return 0

  awk -v s="$start" -v e="$end" '
    $0 == s {skip=1; next}
    $0 == e {skip=0; next}
    skip != 1 {print}
  ' "$file" > "$file.tmp"
  mv "$file.tmp" "$file"
}

rm -f "$HOME/.local/bin/codex-sw" "$HOME/.local/bin/codex-switcher"
remove_block "$HOME/.zshrc"
remove_block "$HOME/.bashrc"

if [[ "$PURGE" == "true" ]]; then
  rm -rf "$HOME/.codex-switcher" "$HOME/.codex-profiles"
fi

echo "Uninstalled codex-sw."
if [[ "$PURGE" == "true" ]]; then
  echo "State and profiles removed."
fi
