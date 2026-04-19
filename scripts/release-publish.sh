#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHANGELOG_FILE="$ROOT/CHANGELOG.md"
REGISTRY="https://registry.npmjs.org/"

VERSION=""
DATE_STR="$(date +"%Y-%m-%d")"
SKIP_CHECK="false"
NOTES_FILE=""
NOTES=()
PUBLISH_ARGS=()

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/release-publish.sh --version <x.y.z> [--note "<text>"]... [--notes-file <path>] [--skip-check] [-- <npm publish args...>]

Examples:
  ./scripts/release-publish.sh --version 0.7.3 --note "Added env/account remove commands with double confirmation."
  ./scripts/release-publish.sh --version 0.7.3 --notes-file /tmp/release-notes.txt
  ./scripts/release-publish.sh --version 0.7.3 --note "Fix A" --note "Fix B" -- --tag latest
USAGE
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --version)
      shift
      [[ "$#" -gt 0 ]] || { echo "Error: missing value after --version" >&2; exit 1; }
      VERSION="$1"
      ;;
    --note)
      shift
      [[ "$#" -gt 0 ]] || { echo "Error: missing value after --note" >&2; exit 1; }
      NOTES+=("$1")
      ;;
    --notes-file)
      shift
      [[ "$#" -gt 0 ]] || { echo "Error: missing value after --notes-file" >&2; exit 1; }
      NOTES_FILE="$1"
      ;;
    --skip-check)
      SKIP_CHECK="true"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      PUBLISH_ARGS=("$@")
      break
      ;;
    *)
      echo "Error: unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

[[ -n "$VERSION" ]] || { echo "Error: --version is required" >&2; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]] || {
  echo "Error: invalid version '$VERSION' (expected semver, e.g. 0.7.3)" >&2
  exit 1
}

if [[ -n "$NOTES_FILE" ]]; then
  [[ -f "$NOTES_FILE" ]] || { echo "Error: notes file not found: $NOTES_FILE" >&2; exit 1; }
  while IFS= read -r line; do
    line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -n "$line" ]] || continue
    NOTES+=("$line")
  done < "$NOTES_FILE"
fi

[[ "${#NOTES[@]}" -gt 0 ]] || {
  echo "Error: at least one changelog note is required (--note or --notes-file)." >&2
  exit 1
}

[[ -f "$CHANGELOG_FILE" ]] || { echo "Error: changelog not found: $CHANGELOG_FILE" >&2; exit 1; }

cd "$ROOT"

if grep -Eq "^## ${VERSION//./\\.} - " "$CHANGELOG_FILE"; then
  echo "Error: CHANGELOG already contains version $VERSION" >&2
  exit 1
fi

echo "Bumping version to $VERSION"
npm version "$VERSION" --no-git-tag-version >/dev/null

echo "Updating CHANGELOG.md"
CHANGELOG_BODY="$(awk 'NR==1 {next} NR==2 && $0=="" {next} {print}' "$CHANGELOG_FILE")"
{
  echo "# Changelog"
  echo
  echo "## $VERSION - $DATE_STR"
  echo
  for note in "${NOTES[@]}"; do
    echo "- $note"
  done
  echo
  echo "$CHANGELOG_BODY"
} > "$CHANGELOG_FILE"

PKG_NAME="$(node -p "require('./package.json').name")"
PKG_VER="$(node -p "require('./package.json').version")"

echo "Prepared release: ${PKG_NAME}@${PKG_VER}"
if [[ "$SKIP_CHECK" != "true" ]]; then
  echo "Running checks..."
  npm run check
  npm pack --dry-run >/dev/null
fi

echo "Publishing to $REGISTRY"
if [[ "${#PUBLISH_ARGS[@]}" -gt 0 ]]; then
  npm publish --access public --registry "$REGISTRY" "${PUBLISH_ARGS[@]}"
else
  npm publish --access public --registry "$REGISTRY"
fi
