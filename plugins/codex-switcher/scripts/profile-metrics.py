#!/usr/bin/env python3
import argparse
import base64
import datetime as dt
import json
import os
import subprocess
import sys
from typing import Any, Dict, Optional


USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage"
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
)
DASH = "-"
KNOWN_PLANS = {"free", "plus", "pro", "team", "business", "enterprise", "edu"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect account usage metrics for codex-switcher list output.")
    parser.add_argument("--account-name", required=True)
    parser.add_argument("--auth-file", required=True)
    parser.add_argument("--data-path", required=True)
    parser.add_argument("--usage-proxy", default="")
    parser.add_argument("--timeout-seconds", type=int, default=4)
    return parser.parse_args()


def clamp_percent(value: float) -> int:
    return int(round(max(0.0, min(100.0, value))))


def sanitize_field(value: str) -> str:
    return value.replace("\t", " ").replace("\n", " ").strip()


def decode_jwt_payload(token: str) -> Dict[str, Any]:
    if not token or "." not in token:
        return {}
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    payload = parts[1]
    padding = "=" * ((4 - len(payload) % 4) % 4)
    try:
        raw = base64.urlsafe_b64decode(payload + padding)
        decoded = json.loads(raw.decode("utf-8"))
        if isinstance(decoded, dict):
            return decoded
    except Exception:
        return {}
    return {}


def parse_timestamp(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        timestamp = int(value)
        if timestamp > 10_000_000_000:
            timestamp = int(timestamp / 1000)
        return timestamp
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        if s.isdigit():
            return parse_timestamp(int(s))
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            parsed = dt.datetime.fromisoformat(s)
            return int(parsed.timestamp())
        except Exception:
            return None
    return None


def normalize_plan(plan: Any) -> str:
    if not isinstance(plan, str):
        return "unknown"
    value = plan.strip().lower()
    if not value:
        return "unknown"
    if value in KNOWN_PLANS:
        return value
    if value.startswith("chatgpt_"):
        trimmed = value[len("chatgpt_") :]
        if trimmed in KNOWN_PLANS:
            return trimmed
    return "unknown"


def load_json(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            obj = json.load(f)
        if isinstance(obj, dict):
            return obj
    except Exception:
        return {}
    return {}


def parse_json_string(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, str) or not raw.strip():
        return {}
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            return obj
    except Exception:
        return {}
    return {}


def nested_auth_namespace(payload: Dict[str, Any]) -> Dict[str, Any]:
    namespace = payload.get("https://api.openai.com/auth")
    if isinstance(namespace, dict):
        return namespace
    return {}


def first_string(*values: Any) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def parse_window(window: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(window, dict):
        return None

    used = None
    if isinstance(window.get("unused_percent"), (int, float)):
        used = 100.0 - float(window.get("unused_percent"))
    elif isinstance(window.get("remaining_percent"), (int, float)):
        used = 100.0 - float(window.get("remaining_percent"))
    elif isinstance(window.get("used_percent"), (int, float)):
        used = float(window.get("used_percent"))
    if used is None:
        return None

    minutes = window.get("window_minutes")
    if not isinstance(minutes, (int, float)):
        seconds = window.get("limit_window_seconds")
        if isinstance(seconds, (int, float)) and seconds > 0:
            minutes = int(round(float(seconds) / 60.0))
    if not isinstance(minutes, (int, float)):
        return None

    reset_epoch = parse_timestamp(
        window.get("resets_at")
        if "resets_at" in window
        else window.get("reset_at")
    )
    return {
        "minutes": int(minutes),
        "used_percent": float(used),
        "reset_epoch": reset_epoch,
    }


def pick_window(windows: Dict[int, Dict[str, Any]], target: int) -> Optional[Dict[str, Any]]:
    if target in windows:
        return windows[target]
    if not windows:
        return None
    nearest = min(windows.keys(), key=lambda m: abs(m - target))
    if target == 300 and abs(nearest - target) <= 30:
        return windows[nearest]
    if target == 10080 and abs(nearest - target) <= 720:
        return windows[nearest]
    return None


def extract_windows_from_usage_blob(blob: Dict[str, Any]) -> Dict[int, Dict[str, Any]]:
    windows: Dict[int, Dict[str, Any]] = {}
    candidates = []
    for key in ("rate_limit", "rate_limits"):
        value = blob.get(key)
        if isinstance(value, dict):
            candidates.append(value)
    candidates.append(blob)

    for container in candidates:
        for key in ("primary_window", "secondary_window", "primary", "secondary"):
            parsed = parse_window(container.get(key))
            if parsed:
                windows[parsed["minutes"]] = parsed
        if isinstance(container.get("windows"), list):
            for item in container["windows"]:
                parsed = parse_window(item)
                if parsed:
                    windows[parsed["minutes"]] = parsed
    return windows


def request_usage(access_token: str, account_id: str, usage_proxy: str, timeout_seconds: int) -> Dict[str, Any]:
    if not access_token:
        return {"ok": False, "error": "expired", "http_code": 0}
    cmd = [
        "curl",
        "-sS",
        "--connect-timeout",
        str(max(1, timeout_seconds)),
        "--max-time",
        str(max(2, timeout_seconds + 2)),
        "-H",
        f"Authorization: Bearer {access_token}",
        "-H",
        "Accept: application/json",
        "-H",
        f"User-Agent: {DEFAULT_USER_AGENT}",
        "-w",
        "\n__CODEX_SWITCHER_HTTP_CODE__:%{http_code}",
    ]
    if account_id:
        cmd.extend(["-H", f"ChatGPT-Account-Id: {account_id}"])
    cmd.append(USAGE_ENDPOINT)
    try:
        env = os.environ.copy()
        proxy = (usage_proxy or "").strip()
        if proxy:
            env["HTTPS_PROXY"] = proxy
            env["HTTP_PROXY"] = proxy
        result = subprocess.run(
            cmd,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )
    except Exception:
        return {"ok": False, "error": "network-failed", "http_code": 0}
    marker = "\n__CODEX_SWITCHER_HTTP_CODE__:"
    stdout = result.stdout or ""
    http_code = 0
    body = stdout
    if marker in stdout:
        body, raw_code = stdout.rsplit(marker, 1)
        try:
            http_code = int(raw_code.strip() or "0")
        except Exception:
            http_code = 0
    body = body.strip()
    if http_code == 200 and body:
        try:
            payload = json.loads(body)
            if isinstance(payload, dict):
                return {"ok": True, "payload": payload, "http_code": http_code}
        except Exception:
            return {"ok": False, "error": "api-failed", "http_code": http_code}

    if http_code in (401, 403):
        return {"ok": False, "error": "unauthorized", "http_code": http_code}
    if result.returncode in (6, 7, 28, 35, 52, 56):
        return {"ok": False, "error": "network-failed", "http_code": http_code}
    if http_code > 0:
        return {"ok": False, "error": "api-failed", "http_code": http_code}
    if result.returncode != 0:
        return {"ok": False, "error": "network-failed", "http_code": http_code}
    return {"ok": False, "error": "api-failed", "http_code": http_code}


def format_usage(window: Optional[Dict[str, Any]]) -> str:
    if not window:
        return DASH
    percent = clamp_percent(float(window["used_percent"]))
    reset_epoch = window.get("reset_epoch")
    if isinstance(reset_epoch, int):
        reset_text = dt.datetime.fromtimestamp(reset_epoch).strftime("%m-%d %H:%M")
        return f"{percent}% ({reset_text})"
    return f"{percent}%"


def format_last_activity(last_epoch: Optional[int]) -> str:
    if not isinstance(last_epoch, int):
        return DASH
    return dt.datetime.fromtimestamp(last_epoch).strftime("%m-%d %H:%M")


def collect_api_metrics(access_token: str, account_id: str, usage_proxy: str, timeout_seconds: int) -> Optional[Dict[str, Any]]:
    result = request_usage(access_token, account_id, usage_proxy, timeout_seconds)
    if not result.get("ok"):
        return {
            "windows": {},
            "plan_type": "unknown",
            "last_activity_epoch": None,
            "source": "api",
            "error": result.get("error") or "api-failed",
            "http_code": result.get("http_code") or 0,
        }

    payload = result["payload"]

    windows = extract_windows_from_usage_blob(payload)
    nested_plan = None
    for key in ("rate_limit", "rate_limits"):
        value = payload.get(key)
        if isinstance(value, dict):
            nested_plan = value.get("plan_type")
            if nested_plan:
                break
    plan_type = normalize_plan(payload.get("plan_type") or nested_plan)
    last_activity = parse_timestamp(
        payload.get("last_activity_at")
        or payload.get("last_activity")
        or payload.get("updated_at")
        or payload.get("timestamp")
    )

    return {
        "windows": windows,
        "plan_type": plan_type,
        "last_activity_epoch": last_activity,
        "source": "api",
        "error": None,
        "http_code": result.get("http_code") or 200,
    }


def pick_error_usage_label(error: str) -> str:
    if error == "expired":
        return "expired"
    if error == "unauthorized":
        return "unauthorized"
    if error == "network-failed":
        return "network-failed"
    return "api-failed"


def main() -> int:
    args = parse_args()
    auth_data = load_json(args.auth_file)
    tokens = auth_data.get("tokens")
    if not isinstance(tokens, dict):
        tokens = parse_json_string(tokens)

    access_token = first_string(tokens.get("access_token"), auth_data.get("access_token"))
    account_id = first_string(tokens.get("account_id"), auth_data.get("account_id"))
    id_token = first_string(tokens.get("id_token"), auth_data.get("id_token"))

    claims = decode_jwt_payload(id_token)
    auth_claims = nested_auth_namespace(claims)
    email = first_string(claims.get("email"), auth_data.get("email"))

    plan_from_claims = normalize_plan(
        auth_claims.get("chatgpt_plan_type")
        or claims.get("chatgpt_plan_type")
        or claims.get("plan_type")
    )
    if plan_from_claims == "unknown":
        plan_from_claims = normalize_plan(
            auth_data.get("chatgpt_plan_type")
            or auth_data.get("plan_type")
            or nested_auth_namespace(auth_data).get("chatgpt_plan_type")
        )
    if not account_id:
        account_id = first_string(
            auth_claims.get("chatgpt_account_id"),
            claims.get("chatgpt_account_id"),
            auth_data.get("account_id"),
        )

    api_metrics = collect_api_metrics(access_token, account_id, args.usage_proxy, args.timeout_seconds)
    metrics = api_metrics if api_metrics is not None else {
        "windows": {},
        "plan_type": "unknown",
        "last_activity_epoch": None,
        "source": "api",
        "error": "expired" if not access_token else "api-failed",
        "http_code": 0,
    }

    windows = metrics.get("windows")
    if not isinstance(windows, dict):
        windows = {}
    window_5h = pick_window(windows, 300)
    window_week = pick_window(windows, 10080)

    error = str(metrics.get("error") or "").strip()
    if error:
        error_label = pick_error_usage_label(error)
        usage_5h = error_label
        usage_weekly = error_label
    else:
        usage_5h = format_usage(window_5h)
        usage_weekly = format_usage(window_week)
    plan = normalize_plan(metrics.get("plan_type"))
    if plan == "unknown":
        plan = plan_from_claims
    if plan == "unknown":
        plan = "unknown"

    source = metrics.get("source")
    if source != "api":
        source = "api"

    last_activity_epoch = metrics.get("last_activity_epoch")
    if not isinstance(last_activity_epoch, int):
        last_activity_epoch = None
    last_activity = format_last_activity(last_activity_epoch)

    if email:
        display_email = email
    else:
        display_email = "-"

    out_fields = [
        display_email,
        plan,
        usage_5h,
        usage_weekly,
        last_activity,
        source,
    ]
    print("\t".join(sanitize_field(str(x)) for x in out_fields))
    return 0


if __name__ == "__main__":
    sys.exit(main())
