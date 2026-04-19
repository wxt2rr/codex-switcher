#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org/}"
CACHE_DIR="${NPM_CONFIG_CACHE:-/tmp/codex-switcher-npm-cache}"
TOKEN="${NPM_TOKEN:-${NODE_AUTH_TOKEN:-}}"
TOKEN_SOURCE="env(NPM_TOKEN/NODE_AUTH_TOKEN)"
OTP="${NPM_CONFIG_OTP:-${NPM_OTP:-}}"
REGISTRY_HOST="${REGISTRY#http://}"
REGISTRY_HOST="${REGISTRY_HOST#https://}"
REGISTRY_HOST="${REGISTRY_HOST%/}"

mask_token() {
  local raw="$1"
  local len="${#raw}"
  if [[ "$len" -le 12 ]]; then
    echo "***"
    return 0
  fi
  local prefix="${raw:0:8}"
  local suffix="${raw:len-6:6}"
  echo "${prefix}...${suffix}"
}

token_fingerprint() {
  local raw="$1"
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$raw" | shasum -a 256 | awk '{print substr($1,1,12)}'
    return 0
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$raw" | sha256sum | awk '{print substr($1,1,12)}'
    return 0
  fi
  echo "na"
}

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/publish-npm-with-token.sh [--token <npm_token>] [--otp <6digits>] [--skip-check] [-- <npm publish args...>]

Env:
  NPM_TOKEN / NODE_AUTH_TOKEN   npm token used for publish
  NPM_CONFIG_OTP / NPM_OTP      npm one-time password (optional)
  NPM_REGISTRY                  default: https://registry.npmjs.org/
  NPM_CONFIG_CACHE              default: /tmp/codex-switcher-npm-cache

Examples:
  NPM_TOKEN=npm_xxx ./scripts/publish-npm-with-token.sh
  NPM_TOKEN=npm_xxx NPM_CONFIG_OTP=123456 ./scripts/publish-npm-with-token.sh
  ./scripts/publish-npm-with-token.sh --token npm_xxx -- --tag latest
USAGE
}

SKIP_CHECK="false"
PUBLISH_ARGS=()

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --token)
      shift
      [[ "$#" -gt 0 ]] || { echo "Error: missing token after --token" >&2; exit 1; }
      TOKEN="$1"
      TOKEN_SOURCE="arg(--token)"
      ;;
    --skip-check)
      SKIP_CHECK="true"
      ;;
    --otp)
      shift
      [[ "$#" -gt 0 ]] || { echo "Error: missing otp after --otp" >&2; exit 1; }
      OTP="$1"
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
      PUBLISH_ARGS+=("$1")
      ;;
  esac
  shift
done

[[ -n "${TOKEN:-}" ]] || {
  echo "Error: npm token is required. Use --token or set NPM_TOKEN." >&2
  exit 1
}

TMP_NPMRC="$(mktemp /tmp/codex-switcher-npmrc.XXXXXX)"
cleanup() {
  rm -f "$TMP_NPMRC"
}
trap cleanup EXIT INT TERM

cat > "$TMP_NPMRC" <<EOF
registry=${REGISTRY}
always-auth=true
//${REGISTRY_HOST}/:_authToken=${TOKEN}
EOF

cd "$ROOT"

PKG_NAME="$(node -p "require('./package.json').name")"
PKG_VER="$(node -p "require('./package.json').version")"

echo "Publishing ${PKG_NAME}@${PKG_VER} with token"
echo "Target registry: ${REGISTRY}"
echo "Cache dir: ${CACHE_DIR}"
echo "Token source: ${TOKEN_SOURCE}"
echo "Token in use: $(mask_token "$TOKEN") (sha256:$(token_fingerprint "$TOKEN"))"
if [[ -n "${OTP:-}" ]]; then
  echo "OTP: set"
else
  echo "OTP: not-set"
fi

if [[ "$SKIP_CHECK" != "true" ]]; then
  npm run check
  npm pack --dry-run >/dev/null
fi

WHOAMI=""
if ! WHOAMI="$(NPM_CONFIG_USERCONFIG="$TMP_NPMRC" NPM_CONFIG_CACHE="$CACHE_DIR" npm whoami --registry "$REGISTRY" 2>/dev/null)"; then
  echo "Error: token validation failed for ${REGISTRY}" >&2
  exit 1
fi
echo "Authenticated as: ${WHOAMI}"
echo "Publishing with token: $(mask_token "$TOKEN") (sha256:$(token_fingerprint "$TOKEN"))"

if [[ "${#PUBLISH_ARGS[@]}" -gt 0 ]]; then
  if [[ -n "${OTP:-}" ]]; then
    NPM_CONFIG_USERCONFIG="$TMP_NPMRC" NPM_CONFIG_CACHE="$CACHE_DIR" NPM_CONFIG_OTP="$OTP" npm publish --access public --registry "$REGISTRY" "${PUBLISH_ARGS[@]}"
  else
    NPM_CONFIG_USERCONFIG="$TMP_NPMRC" NPM_CONFIG_CACHE="$CACHE_DIR" npm publish --access public --registry "$REGISTRY" "${PUBLISH_ARGS[@]}"
  fi
else
  if [[ -n "${OTP:-}" ]]; then
    NPM_CONFIG_USERCONFIG="$TMP_NPMRC" NPM_CONFIG_CACHE="$CACHE_DIR" NPM_CONFIG_OTP="$OTP" npm publish --access public --registry "$REGISTRY"
  else
    NPM_CONFIG_USERCONFIG="$TMP_NPMRC" NPM_CONFIG_CACHE="$CACHE_DIR" npm publish --access public --registry "$REGISTRY"
  fi
fi
