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
echo "api_key=${OPENAI_API_KEY:-}|base_url=${OPENAI_BASE_URL:-}|https_proxy=${HTTPS_PROXY:-}|http_proxy=${HTTP_PROXY:-}|all_proxy=${ALL_PROXY:-}" >> "${CODEX_SWITCHER_TEST_CODEX_ENV_LOG:?}"
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
    IFS= read -r key || true
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
echo "api_key=${OPENAI_API_KEY:-}|base_url=${OPENAI_BASE_URL:-}|https_proxy=${HTTPS_PROXY:-}|http_proxy=${HTTP_PROXY:-}|all_proxy=${ALL_PROXY:-}" >> "${CODEX_SWITCHER_TEST_APP_ENV_LOG:?}"
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
export CODEX_SWITCHER_DISABLE_TOKEN_REFRESH_AUTO_START=true
export CODEX_SWITCHER_TEST_NPM_LOG="$TMPBASE/npm-args.log"
export CODEX_SWITCHER_TEST_NPM_VIEW_VERSION=""
export CODEX_SWITCHER_TEST_CODEX_LOG="$TMPBASE/codex-args.log"
export CODEX_SWITCHER_TEST_CODEX_ENV_LOG="$TMPBASE/codex-env.log"
export CODEX_SWITCHER_TEST_APP_ENV_LOG="$TMPBASE/app-env.log"
export CODEX_SWITCHER_TEST_CURL_LOG="$TMPBASE/curl-args.log"
export CODEX_SWITCHER_TEST_CURL_MODE="success"
unset OPENAI_API_KEY
unset CODEX_SWITCHER_SKIP_UPDATE_CHECK
unset HTTPS_PROXY https_proxy HTTP_PROXY http_proxy ALL_PROXY all_proxy
: > "$CODEX_SWITCHER_TEST_CODEX_LOG"
: > "$CODEX_SWITCHER_TEST_CODEX_ENV_LOG"
: > "$CODEX_SWITCHER_TEST_APP_ENV_LOG"
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
printf '8\n' | "$SW" tui >/tmp/codex_sw_tui_catalog_en.out
grep -q "https://github.com/wxt2rr/codex-switcher" /tmp/codex_sw_tui_catalog_en.out
grep -q "1\\. Switch" /tmp/codex_sw_tui_catalog_en.out
grep -q "2\\. Accounts" /tmp/codex_sw_tui_catalog_en.out
grep -q "3\\. Environments" /tmp/codex_sw_tui_catalog_en.out
grep -q "4\\. Proxy" /tmp/codex_sw_tui_catalog_en.out
grep -q "5\\. Status" /tmp/codex_sw_tui_catalog_en.out
grep -q "6\\. Refresh Account Token" /tmp/codex_sw_tui_catalog_en.out
grep -Eq "6\\. Refresh Account Token[[:space:]]{2,}Run one token refresh scan now" /tmp/codex_sw_tui_catalog_en.out
grep -q "7\\. Logs" /tmp/codex_sw_tui_catalog_en.out
grep -q "8\\. Quit" /tmp/codex_sw_tui_catalog_en.out
! grep -q "Current status (data may be delayed by 1 minute)" /tmp/codex_sw_tui_catalog_en.out

"$SW" lang en >/tmp/codex_sw_lang_en.out
grep -q "language set to: en" /tmp/codex_sw_lang_en.out
printf '8\n' | "$SW" tui >/tmp/codex_sw_tui_home_en.out
grep -q "https://github.com/wxt2rr/codex-switcher" /tmp/codex_sw_tui_home_en.out
! grep -q "Current status (data may be delayed by 1 minute)" /tmp/codex_sw_tui_home_en.out

if command -v expect >/dev/null 2>&1; then
  SW_EXPECT="$SW" expect <<'EXPECT'
set timeout 10
log_user 0

proc expect_home {code} {
  expect {
    -re {Switch active account quickly} {}
    -re {Choose:} { puts stderr "home fell back to non-interactive input after $code"; exit $code }
    timeout { puts stderr "timed out waiting for home after $code"; exit $code }
  }
}

proc expect_interactive {pattern code label} {
  expect {
    -re $pattern {}
    -re {Choose:} { puts stderr "$label fell back to non-interactive input"; exit $code }
    timeout { puts stderr "timed out waiting for $label"; exit $code }
  }
}

spawn env COLUMNS=100 LINES=32 CODEX_SWITCHER_SKIP_UPDATE_CHECK=true $env(SW_EXPECT) tui
expect {
  -re {Switch active account quickly} {}
  timeout { puts stderr "timed out waiting for home"; exit 10 }
}
send "2"
expect {
  -re {Login Account} {}
  timeout { puts stderr "timed out waiting for accounts menu"; exit 11 }
}
send "\r"
expect {
  -re {Select env} {}
  timeout { puts stderr "timed out waiting for env menu"; exit 12 }
}
send "\r"
expect {
  -re {Choose an account alias:} {}
  timeout { puts stderr "timed out waiting for account alias prompt"; exit 13 }
}
send "tui-key\r"
expect {
  -re {Login mode} {}
  timeout { puts stderr "timed out waiting for login mode menu"; exit 14 }
}
send "2"
expect {
  -re {Enter OpenAI API key:} {}
  timeout { puts stderr "timed out waiting for API key prompt"; exit 15 }
}
send "sk-tui-key-0001\r"
expect {
  -re {Base URL} {}
  timeout { puts stderr "timed out waiting for base URL menu"; exit 16 }
}
send "\r"
expect {
  -re {Switch active account quickly} {}
  timeout { puts stderr "timed out waiting for home after API key login"; exit 17 }
}
send "1"
expect {
  -re {Select target} {}
  timeout { puts stderr "timed out waiting for target menu"; exit 18 }
}
send "\r"
expect {
  -re {Select env} {}
  timeout { puts stderr "timed out waiting for switch env menu"; exit 19 }
}
send "\r"
expect {
  -re {Select account} {}
  timeout { puts stderr "timed out waiting for switch account menu"; exit 20 }
}
send "\r"
expect {
  -re {Launch CLI} {}
  timeout { puts stderr "timed out waiting for CLI action menu"; exit 21 }
}
expect {
  -re {Do not launch} {}
  timeout { puts stderr "CLI action menu missing switch-only option"; exit 22 }
}
send "4"
expect {
  -re {Switch active account quickly} {}
  timeout { puts stderr "timed out waiting for home from action menu"; exit 23 }
}

foreach pair {
  {2 {> 1\. Login Account} Accounts 5}
  {3 {> 1\. Create Env} Environments 3}
  {4 {> 1\. Auto detect \(default\)} Proxy 3}
} {
  set key [lindex $pair 0]
  set pattern [lindex $pair 1]
  set label [lindex $pair 2]
  set back [lindex $pair 3]
  send $key
  expect_interactive $pattern 24 $label
  send $back
  expect_home 25
}

send "5"
expect_interactive {codex-sw .*Status} 26 Status
send "q"
expect_home 27

send "6"
expect_interactive {Refresh Account Token} 28 Refresh
send "q"
expect_home 29

send "7"
expect_interactive {Logs -} 30 Logs
send "q"
expect_home 31

send "4"
expect {
  -re {> 1\. Auto detect \(default\)} {}
  -re {Choose:} { puts stderr "proxy menu fell back to non-interactive input"; exit 32 }
  timeout { puts stderr "timed out waiting for interactive proxy menu"; exit 33 }
}
send "q\r"
expect eof
EXPECT
fi

set +e
"$SW" lang ko >/tmp/codex_sw_lang_invalid.out 2>/tmp/codex_sw_lang_invalid.err
lang_invalid_rc=$?
set -e
[[ "$lang_invalid_rc" -ne 0 ]]
grep -q "invalid language 'ko' (English-only build, use en)" /tmp/codex_sw_lang_invalid.err
"$SW" ac login personal --env default
"$SW" ac login work --env default
printf 'sk-test-apikey-12345678\n1\n' | "$SW" ac login key --env default --mode apikey >/tmp/codex_sw_apikey_login.out
grep -q '"auth_mode":"api_key"' "$STATE/env-accounts/default/key/auth.json"
grep -q '"OPENAI_API_KEY":"sk-test-apikey-12345678"' "$STATE/env-accounts/default/key/auth.json"
grep -q '"preferred_auth_method":"apikey"' "$STATE/env-accounts/default/key/runtime.json"
grep -q '"openai_base_url_mode":"default"' "$STATE/env-accounts/default/key/runtime.json"
grep -q "login --with-api-key" "$CODEX_SWITCHER_TEST_CODEX_LOG"
grep -q "API key saved successfully" /tmp/codex_sw_apikey_login.out
"$SW" ac use key --env default
grep -q '"auth_mode":"api_key"' "$DEFAULT_HOME/auth.json"
grep -q '^preferred_auth_method = "apikey"$' "$DEFAULT_HOME/config.toml"
! grep -q '^openai_base_url = ' "$DEFAULT_HOME/config.toml"
head -n 1 "$DEFAULT_HOME/config.toml" | grep -q '^preferred_auth_method = "apikey"$'
"$SW" cli launch-current -- login status >/tmp/codex_sw_cli_launch_apikey_default.out
tail -n 1 "$CODEX_SWITCHER_TEST_CODEX_ENV_LOG" | grep -q "api_key=sk-test-apikey-12345678|base_url="
tail -n 1 "$CODEX_SWITCHER_TEST_CODEX_ENV_LOG" | grep -q "https_proxy=http://127.0.0.1:7899|http_proxy=http://127.0.0.1:7899|all_proxy=http://127.0.0.1:7899"

ORIG_CODEX_BIN="${CODEX_SWITCHER_CODEX_BIN:-}"
BIN_ONLY_CODEX="$BIN/codex-bin-only"
mv "$BIN/codex" "$BIN/codex.hidden"
cat > "$BIN_ONLY_CODEX" <<'FAKEBIN'
#!/usr/bin/env bash
set -euo pipefail
echo "${CODEX_HOME:-}|$*" >> "${CODEX_SWITCHER_TEST_CODEX_LOG:?}"
if [[ "${1:-}" == "login" && "${2:-}" == "status" ]]; then
  [[ -f "${CODEX_HOME}/auth.json" ]]
  exit $?
fi
if [[ "${1:-}" == "login" ]]; then
  mkdir -p "$CODEX_HOME"
  echo '{"auth_mode":"chatgpt","tokens":{"access_token":"fake-access-bin","id_token":"fake.jwt.sig"}}' > "$CODEX_HOME/auth.json"
  exit 0
fi
if [[ "${1:-}" == "logout" ]]; then
  rm -f "$CODEX_HOME/auth.json"
  exit 0
fi
exit 0
FAKEBIN
chmod +x "$BIN_ONLY_CODEX"
CODEX_SWITCHER_CODEX_BIN="$BIN_ONLY_CODEX" "$SW" ac login binonly --env default >/tmp/codex_sw_login_bin_only.out
grep -q "Logged in account: default/binonly" /tmp/codex_sw_login_bin_only.out
grep -q '"access_token":"fake-access-bin"' "$STATE/env-accounts/default/binonly/auth.json"
mv "$BIN/codex.hidden" "$BIN/codex"
if [[ -n "$ORIG_CODEX_BIN" ]]; then
  export CODEX_SWITCHER_CODEX_BIN="$ORIG_CODEX_BIN"
else
  unset CODEX_SWITCHER_CODEX_BIN
fi

printf 'sk-relogin-key-9999\n2\nhttps://proxy.example.test/v1\n' | "$SW" ac relogin key --env default --mode apikey >/tmp/codex_sw_relogin_apikey.out
grep -q '"OPENAI_API_KEY":"sk-relogin-key-9999"' "$STATE/env-accounts/default/key/auth.json"
grep -q '"openai_base_url_mode":"custom"' "$STATE/env-accounts/default/key/runtime.json"
grep -q '"openai_base_url":"https://proxy.example.test/v1"' "$STATE/env-accounts/default/key/runtime.json"
grep -q "API key saved successfully" /tmp/codex_sw_relogin_apikey.out
grep -q '^preferred_auth_method = "apikey"$' "$DEFAULT_HOME/config.toml"
grep -q '^openai_base_url = "https://proxy.example.test/v1"$' "$DEFAULT_HOME/config.toml"
head -n 1 "$DEFAULT_HOME/config.toml" | grep -q '^preferred_auth_method = "apikey"$'
head -n 2 "$DEFAULT_HOME/config.toml" | tail -n 1 | grep -q '^openai_base_url = "https://proxy.example.test/v1"$'
"$SW" cli launch-current -- login status >/tmp/codex_sw_cli_launch_apikey_custom.out
tail -n 1 "$CODEX_SWITCHER_TEST_CODEX_ENV_LOG" | grep -q "api_key=sk-relogin-key-9999|base_url=https://proxy.example.test/v1"
tail -n 1 "$CODEX_SWITCHER_TEST_CODEX_ENV_LOG" | grep -q "https_proxy=http://127.0.0.1:7899|http_proxy=http://127.0.0.1:7899|all_proxy=http://127.0.0.1:7899"
COLUMNS=100 LINES=32 "$SW" __test-status-snapshot >/tmp/codex_sw_tui_status_apikey.out
grep -Fq "api key" /tmp/codex_sw_tui_status_apikey.out
grep -Fq "sk-***9999" /tmp/codex_sw_tui_status_apikey.out
grep -Fq "base url:https://proxy.example" /tmp/codex_sw_tui_status_apikey.out
"$SW" status >/tmp/codex_sw_status_apikey.out || true
grep -Fq "cli_auth: apikey | base_url: https://proxy.example.test/v1" /tmp/codex_sw_status_apikey.out
! grep -Fq "plan:apikey" /tmp/codex_sw_tui_status_apikey.out
! grep -Fq "AUTH EXP --" /tmp/codex_sw_tui_status_apikey.out
grep -Fq "CLI [logged-in]" /tmp/codex_sw_tui_status_apikey.out
grep -Fq "APP [logged-in]" /tmp/codex_sw_tui_status_apikey.out

"$SW" ac relogin work --env default --mode auth >/tmp/codex_sw_relogin_auth.out
grep -q "Logged in account: default/work" /tmp/codex_sw_relogin_auth.out
grep -q '"auth_mode":"chatgpt"' "$STATE/env-accounts/default/work/auth.json"
grep -q '"preferred_auth_method":"chatgpt"' "$STATE/env-accounts/default/work/runtime.json"
grep -q '^preferred_auth_method = "chatgpt"$' "$DEFAULT_HOME/config.toml"
! grep -q '^openai_base_url = ' "$DEFAULT_HOME/config.toml"
head -n 1 "$DEFAULT_HOME/config.toml" | grep -q '^preferred_auth_method = "chatgpt"$'

cat > /tmp/codex_sw_sub2api_input.json <<'JSON'
{
  "access_token": "sub2api-access-token-123",
  "id_token": "sub2api-id-token-456",
  "refresh_token": "sub2api-refresh-token-789",
  "last_refresh": "2026-05-12T04:30:37.901Z",
  "email": "sub2api@example.com",
  "account_id": "acc-sub2api-001",
  "expired": "2026-05-22T04:30:37.901Z",
  "unused_field": "ignored"
}
JSON
cat /tmp/codex_sw_sub2api_input.json | "$SW" ac login sub2 --env default --mode sub2api >/tmp/codex_sw_sub2api_login.out
python3 - "$STATE/env-accounts/default/sub2/auth.json" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)
assert data.get("auth_mode") == "chatgpt"
tokens = data.get("tokens") or {}
assert tokens.get("access_token") == "sub2api-access-token-123"
assert tokens.get("id_token") == "sub2api-id-token-456"
assert data.get("refresh_token") == "sub2api-refresh-token-789"
assert data.get("last_refresh") == "2026-05-12T04:30:37.901Z"
assert data.get("email") == "sub2api@example.com"
assert data.get("account_id") == "acc-sub2api-001"
assert data.get("expired") == "2026-05-22T04:30:37.901Z"
assert "unused_field" not in data
PY
grep -q '"preferred_auth_method":"chatgpt"' "$STATE/env-accounts/default/sub2/runtime.json"

make_id_token() {
  python3 - "$1" "$2" <<'PY'
import base64, json, sys
email = sys.argv[1]
plan = sys.argv[2]
header = base64.urlsafe_b64encode(json.dumps({"alg":"none","typ":"JWT"}, separators=(",", ":")).encode()).decode().rstrip("=")
payload = base64.urlsafe_b64encode(json.dumps({"email":email,"chatgpt_plan_type":plan,"exp":4102444800}, separators=(",", ":")).encode()).decode().rstrip("=")
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
grep -q '^preferred_auth_method = "chatgpt"$' "$DEFAULT_HOME/config.toml"
! grep -q '^openai_base_url = ' "$DEFAULT_HOME/config.toml"
head -n 1 "$DEFAULT_HOME/config.toml" | grep -q '^preferred_auth_method = "chatgpt"$'
"$SW" ac use work --env default
grep -q "token-work" "$DEFAULT_HOME/auth.json"
grep -q '{"memo":"persist"}' "$DEFAULT_HOME/shared.json"
"$SW" ac use personal --env default --sync
grep -q '{"memo":"persist"}' "$DEFAULT_HOME/shared.json"

"$SW" ac use key --env default
grep -q '"OPENAI_API_KEY":"sk-relogin-key-9999"' "$DEFAULT_HOME/auth.json"
grep -q '^preferred_auth_method = "apikey"$' "$DEFAULT_HOME/config.toml"
grep -q '^openai_base_url = "https://proxy.example.test/v1"$' "$DEFAULT_HOME/config.toml"
head -n 1 "$DEFAULT_HOME/config.toml" | grep -q '^preferred_auth_method = "apikey"$'
head -n 2 "$DEFAULT_HOME/config.toml" | tail -n 1 | grep -q '^openai_base_url = "https://proxy.example.test/v1"$'

"$SW" ac use work --env default
grep -q '"auth_mode":"chatgpt"' "$DEFAULT_HOME/auth.json"
grep -q '^preferred_auth_method = "chatgpt"$' "$DEFAULT_HOME/config.toml"
! grep -q '^openai_base_url = ' "$DEFAULT_HOME/config.toml"
head -n 1 "$DEFAULT_HOME/config.toml" | grep -q '^preferred_auth_method = "chatgpt"$'

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

"$SW" ac use corp --env project
[[ "$("$SW" whoami -t cli)" == "project/corp" ]]

"$SW" ac use dev --env project
[[ "$("$SW" whoami -t cli)" == "project/dev" ]]

"$SW" env new current-trash --empty
mkdir -p "$STATE/env-accounts/current-trash/tmp"
cat > "$STATE/env-accounts/current-trash/tmp/auth.json" <<'JSON'
{"auth_mode":"chatgpt","tokens":{"access_token":"token-current-trash","id_token":"current-trash.jwt.sig"}}
JSON
"$SW" ac use tmp --env current-trash
[[ "$("$SW" whoami -t cli)" == "current-trash/tmp" ]]
printf 'y\ny\n' | "$SW" env rm current-trash --force >/tmp/codex_sw_env_rm_current_force.out
grep -q "Removed env: current-trash" /tmp/codex_sw_env_rm_current_force.out
[[ ! -d "$ENVS/current-trash" ]]
[[ ! -d "$STATE/env-accounts/current-trash" ]]
[[ "$("$SW" whoami -t cli)" == "default/default" ]]

"$SW" env new tui-trash --empty
mkdir -p "$STATE/env-accounts/tui-trash/tmp"
cat > "$STATE/env-accounts/tui-trash/tmp/auth.json" <<'JSON'
{"auth_mode":"chatgpt","tokens":{"access_token":"token-tui-trash","id_token":"tui-trash.jwt.sig"}}
JSON
"$SW" ac use tmp --env tui-trash
[[ "$("$SW" whoami -t cli)" == "tui-trash/tmp" ]]
if command -v expect >/dev/null 2>&1; then
  SW_EXPECT="$SW" expect <<'EXPECT'
set timeout 10
log_user 0
spawn env COLUMNS=100 LINES=32 CODEX_SWITCHER_SKIP_UPDATE_CHECK=true $env(SW_EXPECT) tui
expect {
  -re {Switch active account quickly} {}
  timeout { puts stderr "timed out waiting for home before env delete"; exit 50 }
}
send "3"
expect {
  -re {> 1\. Create Env} {}
  timeout { puts stderr "timed out waiting for envs menu before env delete"; exit 51 }
}
send "2"
expect {
  -re {Select env} {}
  timeout { puts stderr "timed out waiting for env selector before env delete"; exit 52 }
}
send "\r"
expect {
  -re {Remove env 'tui-trash'\?} { send "y\r" }
  -re {current CLI env} { puts stderr "tui env delete did not force current env"; exit 53 }
  timeout { puts stderr "timed out waiting for first env delete confirmation"; exit 54 }
}
expect {
  -re {Final confirmation: remove env 'tui-trash'} { send "y\r" }
  timeout { puts stderr "timed out waiting for final env delete confirmation"; exit 55 }
}
expect {
  -re {Removed env: tui-trash} {}
  -re {current CLI env} { puts stderr "tui env delete did not force current env"; exit 56 }
  timeout { puts stderr "timed out waiting for env delete success"; exit 57 }
}
expect {
  -re {> 1\. Create Env} {}
  timeout { puts stderr "timed out waiting for envs menu after env delete"; exit 58 }
}
send "q"
expect eof
EXPECT
fi
[[ ! -d "$ENVS/tui-trash" ]]
[[ ! -d "$STATE/env-accounts/tui-trash" ]]
[[ "$("$SW" whoami -t cli)" == "default/default" ]]

"$SW" ac use work --env default -t app
[[ "$("$SW" whoami -t app)" == "default/work" ]]
"$SW" app restart-current >/tmp/codex_sw_app_restart.out
grep -q "Opened Codex App with: default/work" /tmp/codex_sw_app_restart.out
tail -n 1 "$CODEX_SWITCHER_TEST_APP_ENV_LOG" | grep -q "https_proxy=http://127.0.0.1:7899|http_proxy=http://127.0.0.1:7899|all_proxy=http://127.0.0.1:7899"
first_pid="$(cat "$STATE/app.pid")"
app_instances_after_restart="$(find "$STATE/app-instances" -name '*.pid' | wc -l | tr -d ' ')"
[[ "$app_instances_after_restart" -eq 1 ]]

"$SW" app launch-new >/tmp/codex_sw_app_launch_new.out
grep -q "Opened Codex App with: default/work" /tmp/codex_sw_app_launch_new.out
tail -n 1 "$CODEX_SWITCHER_TEST_APP_ENV_LOG" | grep -q "https_proxy=http://127.0.0.1:7899|http_proxy=http://127.0.0.1:7899|all_proxy=http://127.0.0.1:7899"
second_pid="$(cat "$STATE/app.pid")"
[[ "$second_pid" != "$first_pid" ]]
app_instances_after_launch_new="$(find "$STATE/app-instances" -name '*.pid' | wc -l | tr -d ' ')"
[[ "$app_instances_after_launch_new" -eq 2 ]]
kill -0 "$first_pid"
kill -0 "$second_pid"

"$SW" status >/tmp/codex_sw_status_auth_paths.out
grep -q "DEFAULT AUTH: $DEFAULT_HOME/auth.json" /tmp/codex_sw_status_auth_paths.out
grep -q "CUSTOM  AUTH: $STATE/env-accounts/{env}/{account}/auth.json" /tmp/codex_sw_status_auth_paths.out
grep -Eq "^cli_auth_expiry: -$" /tmp/codex_sw_status_auth_paths.out
grep -Eq "^app_auth_expiry: -$" /tmp/codex_sw_status_auth_paths.out
"$SW" ops token-refresh status >/tmp/codex_sw_token_refresh_status.out
grep -q "^token_refresh_guard:" /tmp/codex_sw_token_refresh_status.out
"$SW" ops token-refresh run-once >/tmp/codex_sw_token_refresh_run_once.out
grep -q "^Token refresh run  " /tmp/codex_sw_token_refresh_run_once.out
grep -q "ACCOUNT.*EMAIL.*EXPIRES.*REMAINING.*STATUS" /tmp/codex_sw_token_refresh_run_once.out
grep -q "default/personal.*personal@example.com" /tmp/codex_sw_token_refresh_run_once.out
grep -q "^Summary: scanned=" /tmp/codex_sw_token_refresh_run_once.out
! grep -q "start --- token refresh run" /tmp/codex_sw_token_refresh_run_once.out

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
"$SW" use corp >/tmp/codex_sw_legacy_use.out 2>/tmp/codex_sw_legacy_use.err
legacy_use_rc=$?
"$SW" switch corp >/tmp/codex_sw_legacy_switch.out 2>/tmp/codex_sw_legacy_switch.err
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
"$SW" ac use work --env default -t app --launch >/tmp/codex_sw_removed_launch.out 2>/tmp/codex_sw_removed_launch.err
removed_launch_rc=$?
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
[[ "$legacy_app_status_rc" -eq 0 ]]
[[ "$removed_launch_rc" -ne 0 ]]
[[ "$legacy_ops_app_ps_rc" -ne 0 ]]
[[ "$legacy_ops_app_stop_rc" -ne 0 ]]
grep -q "unknown command: use" /tmp/codex_sw_legacy_use.err
grep -q "unknown command: switch" /tmp/codex_sw_legacy_switch.err
grep -q "unknown command: login" /tmp/codex_sw_legacy_login.err
grep -q "unknown command: logout" /tmp/codex_sw_legacy_logout.err
grep -q "unknown command: add" /tmp/codex_sw_legacy_add.err
grep -q "unknown command: remove" /tmp/codex_sw_legacy_remove.err
grep -q "app_process: running" /tmp/codex_sw_legacy_app_status.out
grep -q "option --launch was removed" /tmp/codex_sw_removed_launch.err
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
