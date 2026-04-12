#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org/}"

cd "$ROOT"

PKG_NAME="$(node -p "require('./package.json').name")"
PKG_VER="$(node -p "require('./package.json').version")"

echo "Publishing ${PKG_NAME}@${PKG_VER}"
echo "Target registry: ${REGISTRY}"

npm run check
npm pack --dry-run >/dev/null

if ! npm whoami --registry "$REGISTRY" >/dev/null 2>&1; then
  echo "Not logged in for ${REGISTRY}" >&2
  echo "Run: npm login --registry ${REGISTRY}" >&2
  exit 1
fi

npm publish --access public --registry "$REGISTRY" "$@"
