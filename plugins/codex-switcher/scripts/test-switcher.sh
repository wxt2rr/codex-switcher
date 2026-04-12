#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SW="$ROOT/scripts/codex-sw"

bash -n "$SW"

TMPBASE="$(mktemp -d /tmp/codex-switcher-test.XXXXXX)"
STATE="$TMPBASE/state"
PROFILES="$TMPBASE/profiles"
BIN="$TMPBASE/bin"
mkdir -p "$BIN"

cleanup() {
  pkill -f "$BIN/fake-codex-app" >/dev/null 2>&1 || true
  rm -rf "$TMPBASE"
}
trap cleanup EXIT INT TERM

cat > "$BIN/codex" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "login" && "${2:-}" == "status" ]]; then
  if [[ -f "${CODEX_HOME}/auth.json" ]]; then
    echo "Logged in"
    exit 0
  fi
  echo "Not logged in"
  exit 1
fi
if [[ "${1:-}" == "login" ]]; then
  mkdir -p "$CODEX_HOME"
  echo '{"auth_mode":"api_key"}' > "$CODEX_HOME/auth.json"
  exit 0
fi
if [[ "${1:-}" == "logout" ]]; then
  rm -f "$CODEX_HOME/auth.json"
  exit 0
fi
exit 0
FAKE
chmod +x "$BIN/codex"

cat > "$BIN/fake-codex-app" <<'APP'
#!/usr/bin/env bash
set -euo pipefail
sleep 30
APP
chmod +x "$BIN/fake-codex-app"

cat > "$BIN/npm" <<'NPM'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" > "${CODEX_SWITCHER_TEST_NPM_LOG:?}"
exit 0
NPM
chmod +x "$BIN/npm"

export PATH="$BIN:$PATH"
export CODEX_SWITCHER_STATE_DIR="$STATE"
export CODEX_SWITCHER_PROFILES_DIR="$PROFILES"
export CODEX_SWITCHER_APP_BIN="$BIN/fake-codex-app"
export CODEX_SWITCHER_LOCK_WAIT_SECONDS=2
export CODEX_SWITCHER_DEFAULT_HOME="$TMPBASE/default-home"
export CODEX_SWITCHER_TEST_NPM_LOG="$TMPBASE/npm-args.log"

mkdir -p "$CODEX_SWITCHER_DEFAULT_HOME/memories"
echo '{"auth_mode":"chatgpt"}' > "$CODEX_SWITCHER_DEFAULT_HOME/auth.json"
echo '{"projects":["demo"]}' > "$CODEX_SWITCHER_DEFAULT_HOME/state_5.sqlite"
echo '{"memo":"persist"}' > "$CODEX_SWITCHER_DEFAULT_HOME/memories/demo.json"

check_out="$("$SW" check)"
echo "$check_out" | grep -q "check: ok"
init_out="$("$SW" init --dry-run)"
echo "$init_out" | grep -q "\[dry-run\]"
"$SW" upgrade
grep -q "i -g @wangxt0223/codex-switcher@latest --registry https://registry.npmjs.org/" "$CODEX_SWITCHER_TEST_NPM_LOG"

"$SW" add work
"$SW" add personal
"$SW" use personal
[[ "$("$SW" current cli)" == "personal" ]]

"$SW" login personal
"$SW" login sync-login --sync
[[ -f "$PROFILES/sync-login/state_5.sqlite" ]]
[[ -f "$PROFILES/sync-login/memories/demo.json" ]]
[[ -f "$PROFILES/sync-login/auth.json" ]]

echo '{"auth_mode":"api_key","owner":"personal"}' > "$PROFILES/personal/auth.json"
echo '{"auth_mode":"api_key","owner":"work"}' > "$PROFILES/work/auth.json"
echo "from-personal-newer" > "$PROFILES/personal/history.jsonl"
echo "from-work-older-baseline" > "$PROFILES/work/history.jsonl"
"$SW" switch work --sync
[[ "$("$SW" current cli)" == "work" ]]
grep -q "from-personal-newer" "$PROFILES/work/history.jsonl"
grep -q '"owner":"work"' "$PROFILES/work/auth.json"
grep -q '"owner":"personal"' "$PROFILES/personal/auth.json"

"$SW" import-default imported
[[ -f "$PROFILES/imported/state_5.sqlite" ]]
[[ -f "$PROFILES/imported/memories/demo.json" ]]
[[ ! -f "$PROFILES/imported/auth.json" ]]
set +e
CODEX_HOME="$PROFILES/imported" codex login status >/tmp/codex_sw_imported_login 2>&1
imported_login_rc=$?
set -e
[[ "$imported_login_rc" -ne 0 ]]

"$SW" import-default imported-auth --with-auth
[[ -f "$PROFILES/imported-auth/auth.json" ]]
CODEX_HOME="$PROFILES/imported-auth" codex login status >/tmp/codex_sw_imported_auth_login 2>&1
[[ "$?" -eq 0 ]]

"$SW" logout work

set +e
"$SW" app open ghost >/tmp/codex_sw_app_open_missing 2>&1
app_open_missing_rc=$?
set -e
[[ "$app_open_missing_rc" -ne 0 ]]
grep -q "profile 'ghost' not found" /tmp/codex_sw_app_open_missing

set +e
"$SW" app use work >/tmp/codex_sw_app_use_unauthed 2>&1
app_use_unauthed_rc=$?
set -e
[[ "$app_use_unauthed_rc" -ne 0 ]]
grep -q "profile 'work' is not logged in" /tmp/codex_sw_app_use_unauthed

"$SW" login work
"$SW" app use work
[[ "$("$SW" app current)" == "work" ]]

set +e
"$SW" status >/tmp/codex_sw_status_1
status_rc=$?
set -e
[[ "$status_rc" -eq 0 ]]
grep -q "cli(work): logged-in" /tmp/codex_sw_status_1
grep -q "app(work): logged-in" /tmp/codex_sw_status_1

"$SW" logout work
set +e
"$SW" status >/tmp/codex_sw_status_2
status_rc=$?
set -e
[[ "$status_rc" -eq 1 ]]
grep -q "cli(work): not-logged-in" /tmp/codex_sw_status_2

"$SW" app status >/tmp/codex_sw_app_status_1
[[ "$?" -eq 0 ]]
grep -q "running" /tmp/codex_sw_app_status_1

"$SW" app stop
set +e
"$SW" app status >/tmp/codex_sw_app_status_2
app_status_rc=$?
set -e
[[ "$app_status_rc" -eq 1 ]]

printf '***bad***\n' > "$STATE/current_cli"
set +e
"$SW" status >/tmp/codex_sw_status_3
status_rc=$?
set -e
[[ "$status_rc" -eq 2 ]]

"$SW" recover
validate_cli="$("$SW" current cli)"
[[ -n "$validate_cli" ]]

doctor_out="$("$SW" doctor --fix)"
echo "$doctor_out" | grep -q "doctor --fix: completed"
check_out="$("$SW" check)"
echo "$check_out" | grep -q "check: ok"

"$SW" remove work --force
"$SW" list >/tmp/codex_sw_list
grep -q "personal" /tmp/codex_sw_list

echo "smoke-test: ok"
