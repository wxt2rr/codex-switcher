#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SW="$ROOT/scripts/codex-sw"
SW_LINK=""

bash -n "$SW"

TMPBASE="$(mktemp -d /tmp/codex-switcher-test.XXXXXX)"
STATE="$TMPBASE/state"
ENVS="$TMPBASE/envs"
DEFAULT_HOME="$TMPBASE/default-home"
BIN="$TMPBASE/bin"
mkdir -p "$BIN" "$DEFAULT_HOME"
SW_LINK="$BIN/codex-sw-link"
ln -s "$SW" "$SW_LINK"

cleanup() {
  pkill -f "$BIN/fake-codex-app" >/dev/null 2>&1 || true
  rm -rf "$TMPBASE"
}
trap cleanup EXIT INT TERM

cat > "$BIN/codex" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
echo "${CODEX_HOME:-}|$*" >> "${CODEX_SWITCHER_TEST_CODEX_LOG:?}"
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
  if [[ "${2:-}" == "--with-api-key" ]]; then
    key="${OPENAI_API_KEY:-}"
    echo "{\"auth_mode\":\"api_key\",\"OPENAI_API_KEY\":\"$key\"}" > "$CODEX_HOME/auth.json"
    exit 0
  fi
  echo '{"auth_mode":"chatgpt","tokens":{"access_token":"fake-access","id_token":"fake.jwt.sig"}}' > "$CODEX_HOME/auth.json"
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
if [[ "${1:-}" == "view" && "${3:-}" == "version" ]]; then
  echo "$*" >> "${CODEX_SWITCHER_TEST_NPM_LOG:?}"
  if [[ -n "${CODEX_SWITCHER_TEST_NPM_VIEW_VERSION:-}" ]]; then
    echo "${CODEX_SWITCHER_TEST_NPM_VIEW_VERSION}"
  fi
  exit 0
fi
echo "$*" > "${CODEX_SWITCHER_TEST_NPM_LOG:?}"
exit 0
NPM
chmod +x "$BIN/npm"

cat > "$BIN/curl" <<'CURL'
#!/usr/bin/env bash
set -euo pipefail
mode="${CODEX_SWITCHER_TEST_CURL_MODE:-success}"
echo "proxy=${HTTPS_PROXY:-}" >> "${CODEX_SWITCHER_TEST_CURL_LOG:?}"
if [[ "$mode" == "success" ]]; then
  cat <<'JSON'
{"rate_limit":{"plan_type":"plus","primary_window":{"used_percent":40,"limit_window_seconds":18000,"reset_at":"2099-01-01T06:30:00Z"},"secondary_window":{"used_percent":20,"limit_window_seconds":604800,"reset_at":"2099-01-03T08:00:00Z"}},"last_activity_at":"2099-01-01T04:30:00Z"}
JSON
  exit 0
fi
echo "simulated curl failure" >&2
exit 22
CURL
chmod +x "$BIN/curl"

export PATH="$BIN:$PATH"
export CODEX_SWITCHER_STATE_DIR="$STATE"
export CODEX_SWITCHER_ENVS_DIR="$ENVS"
export CODEX_SWITCHER_ACCOUNTS_DIR="$STATE/env-accounts"
export CODEX_SWITCHER_APP_BIN="$BIN/fake-codex-app"
export CODEX_SWITCHER_LOCK_WAIT_SECONDS=2
export CODEX_SWITCHER_DEFAULT_HOME="$DEFAULT_HOME"
export CODEX_SWITCHER_DISABLE_SYSTEM_PROXY_DETECT=true
export CODEX_SWITCHER_TEST_NPM_LOG="$TMPBASE/npm-args.log"
export CODEX_SWITCHER_TEST_NPM_VIEW_VERSION=""
export CODEX_SWITCHER_TEST_CODEX_LOG="$TMPBASE/codex-args.log"
export CODEX_SWITCHER_TEST_CURL_LOG="$TMPBASE/curl-args.log"
export CODEX_SWITCHER_TEST_CURL_MODE="success"
unset OPENAI_API_KEY
unset HTTPS_PROXY https_proxy HTTP_PROXY http_proxy ALL_PROXY all_proxy
: > "$CODEX_SWITCHER_TEST_CODEX_LOG"
: > "$CODEX_SWITCHER_TEST_CURL_LOG"

echo '{"memo":"persist"}' > "$DEFAULT_HOME/shared.json"

check_out="$("$SW" check)"
echo "$check_out" | grep -Eq '^version: [0-9]+\.[0-9]+\.[0-9]+$'
echo "$check_out" | grep -q "check: ok"
echo "$("$SW" version)" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'
link_check_out="$("$SW_LINK" check)"
echo "$link_check_out" | grep -Eq '^version: [0-9]+\.[0-9]+\.[0-9]+$'
echo "$link_check_out" | grep -q "check: ok"
echo "$("$SW_LINK" version)" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'
[[ "$("$SW" ops proxy)" == "usage_api_proxy: off" ]]
"$SW" ops proxy 127.0.0.1:7899
[[ "$("$SW" ops proxy)" == "usage_api_proxy: http://127.0.0.1:7899 (manual)" ]]
init_out="$("$SW" ops init --dry-run)"
echo "$init_out" | grep -q "\[dry-run\]"
"$SW" upgrade
grep -q "i -g @wangxt0223/codex-switcher@latest --registry https://registry.npmjs.org/" "$CODEX_SWITCHER_TEST_NPM_LOG"

export CODEX_SWITCHER_TEST_NPM_VIEW_VERSION="99.99.99"
whoami_out="$("$SW" whoami -t cli 2>/tmp/codex_sw_update_hint.err)"
[[ "$whoami_out" == "default/default" ]]
grep -Eq "Update available: [0-9]+\\.[0-9]+\\.[0-9]+ -> 99\\.99\\.99\\. run codex-sw upgrade" /tmp/codex_sw_update_hint.err
export CODEX_SWITCHER_TEST_NPM_VIEW_VERSION=""

[[ "$("$SW" lang)" == "language: en" ]]
printf '6\n' | "$SW" tui >/tmp/codex_sw_tui_catalog_en.out
grep -q "https://github.com/wxt2rr/codex-switcher" /tmp/codex_sw_tui_catalog_en.out
grep -q "1\\. Switch" /tmp/codex_sw_tui_catalog_en.out
grep -q "2\\. Accounts" /tmp/codex_sw_tui_catalog_en.out
grep -q "3\\. Environments" /tmp/codex_sw_tui_catalog_en.out
grep -q "4\\. Proxy" /tmp/codex_sw_tui_catalog_en.out
grep -q "5\\. Status" /tmp/codex_sw_tui_catalog_en.out
grep -q "6\\. Quit" /tmp/codex_sw_tui_catalog_en.out
! grep -q "Current status (data may be delayed by 1 minute)" /tmp/codex_sw_tui_catalog_en.out

"$SW" lang en >/tmp/codex_sw_lang_en.out
grep -q "language set to: en" /tmp/codex_sw_lang_en.out
printf '6\n' | "$SW" tui >/tmp/codex_sw_tui_home_en.out
grep -q "https://github.com/wxt2rr/codex-switcher" /tmp/codex_sw_tui_home_en.out
! grep -q "Current status (data may be delayed by 1 minute)" /tmp/codex_sw_tui_home_en.out

set +e
"$SW" lang ko >/tmp/codex_sw_lang_invalid.out 2>/tmp/codex_sw_lang_invalid.err
lang_invalid_rc=$?
set -e
[[ "$lang_invalid_rc" -ne 0 ]]
grep -q "invalid language 'ko' (English-only build, use en)" /tmp/codex_sw_lang_invalid.err
"$SW" ac login personal --env default
"$SW" ac login work --env default
printf 'sk-test-apikey-12345678\n' | "$SW" ac login key --env default --mode apikey >/tmp/codex_sw_apikey_login.out
grep -q '"auth_mode":"api_key"' "$STATE/env-accounts/default/key/auth.json"
grep -q '"OPENAI_API_KEY":"sk-test-apikey-12345678"' "$STATE/env-accounts/default/key/auth.json"
grep -q "login --with-api-key" "$CODEX_SWITCHER_TEST_CODEX_LOG"
grep -q "API key saved successfully" /tmp/codex_sw_apikey_login.out
"$SW" ac use key --env default
grep -q '"auth_mode":"api_key"' "$DEFAULT_HOME/auth.json"

make_id_token() {
  python3 - "$1" "$2" <<'PY'
import base64, json, sys
email = sys.argv[1]
plan = sys.argv[2]
header = base64.urlsafe_b64encode(json.dumps({"alg":"none","typ":"JWT"}, separators=(",", ":")).encode()).decode().rstrip("=")
payload = base64.urlsafe_b64encode(json.dumps({"email":email,"chatgpt_plan_type":plan}, separators=(",", ":")).encode()).decode().rstrip("=")
print(f"{header}.{payload}.sig")
PY
}

personal_id_token="$(make_id_token personal@example.com plus)"
work_id_token="$(make_id_token work@example.com team)"

cat > "$STATE/env-accounts/default/personal/auth.json" <<JSON
{"auth_mode":"chatgpt","tokens":{"access_token":"token-personal","id_token":"$personal_id_token"}}
JSON
cat > "$STATE/env-accounts/default/work/auth.json" <<JSON
{"auth_mode":"chatgpt","tokens":{"access_token":"token-work","id_token":"$work_id_token"}}
JSON

"$SW" ac use personal --env default
grep -q "token-personal" "$DEFAULT_HOME/auth.json"
"$SW" ac use work --env default
grep -q "token-work" "$DEFAULT_HOME/auth.json"
grep -q '{"memo":"persist"}' "$DEFAULT_HOME/shared.json"
"$SW" ac use personal --env default --sync
grep -q '{"memo":"persist"}' "$DEFAULT_HOME/shared.json"

"$SW" env new project --empty
[[ -d "$ENVS/project/home" ]]
echo '{"shared":"project"}' > "$ENVS/project/home/shared.json"

corp_id_token="$(make_id_token corp@example.com business)"
dev_id_token="$(make_id_token dev@example.com pro)"
mkdir -p "$STATE/env-accounts/project/corp" "$STATE/env-accounts/project/dev"
cat > "$STATE/env-accounts/project/corp/auth.json" <<JSON
{"auth_mode":"chatgpt","tokens":{"access_token":"token-corp","id_token":"$corp_id_token"}}
JSON
cat > "$STATE/env-accounts/project/dev/auth.json" <<JSON
{"auth_mode":"chatgpt","tokens":{"access_token":"token-dev","id_token":"$dev_id_token"}}
JSON

"$SW" ac use corp --env project
[[ "$("$SW" whoami -t cli)" == "project/corp" ]]
grep -q "token-corp" "$ENVS/project/home/auth.json"
"$SW" ac use dev --env project
[[ "$("$SW" whoami -t cli)" == "project/dev" ]]
grep -q "token-dev" "$ENVS/project/home/auth.json"
grep -q '{"shared":"project"}' "$ENVS/project/home/shared.json"

"$SW" ac use corp --env project --no-launch
[[ "$("$SW" whoami -t cli)" == "project/corp" ]]

before_launch_count="$(wc -l < "$CODEX_SWITCHER_TEST_CODEX_LOG")"
"$SW" ac use dev --env project --launch
after_launch_count="$(wc -l < "$CODEX_SWITCHER_TEST_CODEX_LOG")"
[[ "$after_launch_count" -eq $((before_launch_count + 1)) ]]

"$SW" ac use work --env default -t app --launch
[[ "$("$SW" whoami -t app)" == "default/work" ]]

"$SW" env new trash --empty
echo '{"trash":"1"}' > "$ENVS/trash/home/shared.json"
mkdir -p "$STATE/env-accounts/trash/tmp"
cat > "$STATE/env-accounts/trash/tmp/auth.json" <<'JSON'
{"auth_mode":"chatgpt","tokens":{"access_token":"token-trash","id_token":"trash.jwt.sig"}}
JSON

printf 'n\n' | "$SW" env rm trash >/tmp/codex_sw_env_rm_cancel_1.out
grep -q "Cancelled" /tmp/codex_sw_env_rm_cancel_1.out
[[ -d "$ENVS/trash/home" ]]
[[ -d "$STATE/env-accounts/trash/tmp" ]]

printf 'y\nn\n' | "$SW" env rm trash >/tmp/codex_sw_env_rm_cancel_2.out
grep -q "Cancelled" /tmp/codex_sw_env_rm_cancel_2.out
[[ -d "$ENVS/trash/home" ]]
[[ -d "$STATE/env-accounts/trash/tmp" ]]

printf 'y\ny\n' | "$SW" env rm trash >/tmp/codex_sw_env_rm_ok.out
grep -q "Removed env: trash" /tmp/codex_sw_env_rm_ok.out
[[ ! -d "$ENVS/trash" ]]
[[ ! -d "$STATE/env-accounts/trash" ]]

mkdir -p "$STATE/env-accounts/default/tmp-remove"
cat > "$STATE/env-accounts/default/tmp-remove/auth.json" <<'JSON'
{"auth_mode":"chatgpt","tokens":{"access_token":"token-tmp","id_token":"tmp.jwt.sig"}}
JSON

printf 'n\n' | "$SW" ac rm tmp-remove --env default >/tmp/codex_sw_ac_rm_cancel_1.out
grep -q "Cancelled" /tmp/codex_sw_ac_rm_cancel_1.out
[[ -f "$STATE/env-accounts/default/tmp-remove/auth.json" ]]

printf 'y\nn\n' | "$SW" ac rm tmp-remove --env default >/tmp/codex_sw_ac_rm_cancel_2.out
grep -q "Cancelled" /tmp/codex_sw_ac_rm_cancel_2.out
[[ -f "$STATE/env-accounts/default/tmp-remove/auth.json" ]]

printf 'y\ny\n' | "$SW" ac rm tmp-remove --env default >/tmp/codex_sw_ac_rm_ok.out
grep -q "Removed account slot: default/tmp-remove" /tmp/codex_sw_ac_rm_ok.out
[[ ! -d "$STATE/env-accounts/default/tmp-remove" ]]

set +e
"$SW" use corp --no-launch >/tmp/codex_sw_legacy_use.out 2>/tmp/codex_sw_legacy_use.err
legacy_use_rc=$?
"$SW" switch corp --no-launch >/tmp/codex_sw_legacy_switch.out 2>/tmp/codex_sw_legacy_switch.err
legacy_switch_rc=$?
"$SW" login >/tmp/codex_sw_legacy_login.out 2>/tmp/codex_sw_legacy_login.err
legacy_login_rc=$?
"$SW" logout >/tmp/codex_sw_legacy_logout.out 2>/tmp/codex_sw_legacy_logout.err
legacy_logout_rc=$?
"$SW" add legacy >/tmp/codex_sw_legacy_add.out 2>/tmp/codex_sw_legacy_add.err
legacy_add_rc=$?
"$SW" remove legacy >/tmp/codex_sw_legacy_remove.out 2>/tmp/codex_sw_legacy_remove.err
legacy_remove_rc=$?
"$SW" app status >/tmp/codex_sw_legacy_app_status.out 2>/tmp/codex_sw_legacy_app_status.err
legacy_app_status_rc=$?
"$SW" ops app ps >/tmp/codex_sw_legacy_ops_app_ps.out 2>/tmp/codex_sw_legacy_ops_app_ps.err
legacy_ops_app_ps_rc=$?
"$SW" ops app stop >/tmp/codex_sw_legacy_ops_app_stop.out 2>/tmp/codex_sw_legacy_ops_app_stop.err
legacy_ops_app_stop_rc=$?
set -e
[[ "$legacy_use_rc" -ne 0 ]]
[[ "$legacy_switch_rc" -ne 0 ]]
[[ "$legacy_login_rc" -ne 0 ]]
[[ "$legacy_logout_rc" -ne 0 ]]
[[ "$legacy_add_rc" -ne 0 ]]
[[ "$legacy_remove_rc" -ne 0 ]]
[[ "$legacy_app_status_rc" -ne 0 ]]
[[ "$legacy_ops_app_ps_rc" -ne 0 ]]
[[ "$legacy_ops_app_stop_rc" -ne 0 ]]
grep -q "unknown command: use" /tmp/codex_sw_legacy_use.err
grep -q "unknown command: switch" /tmp/codex_sw_legacy_switch.err
grep -q "unknown command: login" /tmp/codex_sw_legacy_login.err
grep -q "unknown command: logout" /tmp/codex_sw_legacy_logout.err
grep -q "unknown command: add" /tmp/codex_sw_legacy_add.err
grep -q "unknown command: remove" /tmp/codex_sw_legacy_remove.err
grep -q "unknown command: app" /tmp/codex_sw_legacy_app_status.err
grep -q "unknown ops subcommand: app" /tmp/codex_sw_legacy_ops_app_ps.err
grep -q "unknown ops subcommand: app" /tmp/codex_sw_legacy_ops_app_stop.err

"$SW" ops list >/tmp/codex_sw_list_api
"$SW" ac ls >/tmp/codex_sw_ac_list_api
cmp -s /tmp/codex_sw_list_api /tmp/codex_sw_ac_list_api
grep -q "ENV" /tmp/codex_sw_list_api
grep -q "HOME" /tmp/codex_sw_list_api
grep -q "ACCOUNT" /tmp/codex_sw_list_api
grep -q "EMAIL" /tmp/codex_sw_list_api
grep -q "PLAN" /tmp/codex_sw_list_api
grep -q "5H USAGE" /tmp/codex_sw_list_api
grep -q "WEEKLY USAGE" /tmp/codex_sw_list_api
grep -q "LAST ACTIVITY" /tmp/codex_sw_list_api
grep -q "SOURCE" /tmp/codex_sw_list_api
grep -q "personal@example.com" /tmp/codex_sw_list_api
grep -Eq "[[:space:]]+api$" /tmp/codex_sw_list_api
grep -q "40% (" /tmp/codex_sw_list_api
grep -q "20% (" /tmp/codex_sw_list_api
grep -Eq "40% \\([0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}\\)" /tmp/codex_sw_list_api
grep -Eq "20% \\([0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}\\)" /tmp/codex_sw_list_api
grep -Eq "[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}" /tmp/codex_sw_list_api
"$SW" ac ls --env default >/tmp/codex_sw_ac_list_default
grep -Eq "^default[[:space:]]" /tmp/codex_sw_ac_list_default
! grep -Eq "^project[[:space:]]" /tmp/codex_sw_ac_list_default
grep -q "proxy=http://127.0.0.1:7899" "$CODEX_SWITCHER_TEST_CURL_LOG"

"$SW_LINK" ops list >/tmp/codex_sw_list_symlink
grep -q "personal@example.com" /tmp/codex_sw_list_symlink
grep -Eq "[[:space:]]+api$" /tmp/codex_sw_list_symlink

mkdir -p "$ENVS/project/home/sessions/2026/04/12"
cat > "$ENVS/project/home/sessions/2026/04/12/rollout-test.jsonl" <<'JSONL'
{"timestamp":"2026-04-12T09:00:00Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"plan_type":"business","primary":{"used_percent":25,"window_minutes":300,"resets_at":1776004200},"secondary":{"used_percent":70,"window_minutes":10080,"resets_at":1776519000}}}}
JSONL
export CODEX_SWITCHER_TEST_CURL_MODE="fail"
"$SW" ops proxy off
[[ "$("$SW" ops proxy)" == "usage_api_proxy: off" ]]
: > "$CODEX_SWITCHER_TEST_CURL_LOG"
"$SW" ops list >/tmp/codex_sw_list_local
grep -Eq "[[:space:]]+local$" /tmp/codex_sw_list_local
grep -q "25% (" /tmp/codex_sw_list_local
grep -q "70% (" /tmp/codex_sw_list_local
grep -Eq "25% \\([0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}\\)" /tmp/codex_sw_list_local
grep -Eq "70% \\([0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}\\)" /tmp/codex_sw_list_local
grep -q "^proxy=$" "$CODEX_SWITCHER_TEST_CURL_LOG"

export CODEX_SWITCHER_TEST_CURL_MODE="success"
export HTTPS_PROXY="http://10.10.10.10:18080"
[[ "$("$SW" ops proxy)" == "usage_api_proxy: http://10.10.10.10:18080 (auto:env)" ]]
: > "$CODEX_SWITCHER_TEST_CURL_LOG"
"$SW" ops list >/tmp/codex_sw_list_auto_env
grep -q "proxy=http://10.10.10.10:18080" "$CODEX_SWITCHER_TEST_CURL_LOG"
unset HTTPS_PROXY

doctor_out="$("$SW" ops doctor --fix)"
echo "$doctor_out" | grep -q "doctor --fix: completed"

echo "smoke-test: ok"
