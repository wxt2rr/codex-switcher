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


def request_usage(access_token: str, account_id: str, usage_proxy: str, timeout_seconds: int) -> Optional[Dict[str, Any]]:
    if not access_token:
        return None
    cmd = [
        "curl",
        "-fsS",
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
        return None
    if result.returncode != 0 or not result.stdout.strip():
        return None
    try:
        payload = json.loads(result.stdout)
        if isinstance(payload, dict):
            return payload
    except Exception:
        return None
    return None


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


def collect_local_metrics(data_path: str) -> Dict[str, Any]:
    sessions_dir = os.path.join(data_path, "sessions")
    if not os.path.isdir(sessions_dir):
        return {"source": "local"}

    best: Optional[Dict[str, Any]] = None
    for root, _, files in os.walk(sessions_dir):
        for file_name in files:
            if not file_name.endswith(".jsonl"):
                continue
            file_path = os.path.join(root, file_name)
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    for line in f:
                        if '"rate_limits"' not in line:
                            continue
                        obj = json.loads(line)
                        if not isinstance(obj, dict):
                            continue
                        payload = obj.get("payload")
                        if not isinstance(payload, dict):
                            continue
                        rate_limits = payload.get("rate_limits")
                        if not isinstance(rate_limits, dict):
                            continue

                        windows = extract_windows_from_usage_blob({"rate_limits": rate_limits})
                        if not windows:
                            continue

                        timestamp = parse_timestamp(obj.get("timestamp")) or parse_timestamp(payload.get("timestamp"))
                        plan = normalize_plan(rate_limits.get("plan_type"))
                        candidate = {
                            "windows": windows,
                            "plan_type": plan,
                            "last_activity_epoch": timestamp,
                            "source": "local",
                        }
                        if best is None:
                            best = candidate
                        else:
                            prev_ts = best.get("last_activity_epoch")
                            if isinstance(timestamp, int) and (not isinstance(prev_ts, int) or timestamp > prev_ts):
                                best = candidate
            except Exception:
                continue

    if best:
        return best
    return {"source": "local"}


def collect_api_metrics(access_token: str, account_id: str, usage_proxy: str, timeout_seconds: int) -> Optional[Dict[str, Any]]:
    payload = request_usage(access_token, account_id, usage_proxy, timeout_seconds)
    if not payload:
        return None

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

    if not windows and plan_type == "unknown" and last_activity is None:
        return None
    return {
        "windows": windows,
        "plan_type": plan_type,
        "last_activity_epoch": last_activity,
        "source": "api",
    }


def main() -> int:
    args = parse_args()
    auth_data = load_json(args.auth_file)
    tokens = auth_data.get("tokens")
    if not isinstance(tokens, dict):
        tokens = {}

    access_token = tokens.get("access_token")
    if not isinstance(access_token, str):
        access_token = ""
    account_id = tokens.get("account_id")
    if not isinstance(account_id, str):
        account_id = ""
    id_token = tokens.get("id_token")
    if not isinstance(id_token, str):
        id_token = ""

    claims = decode_jwt_payload(id_token)
    email = claims.get("email")
    if not isinstance(email, str):
        email = ""

    plan_from_claims = normalize_plan(claims.get("chatgpt_plan_type") or claims.get("plan_type"))
    if plan_from_claims == "unknown":
        plan_from_claims = normalize_plan(auth_data.get("chatgpt_plan_type") or auth_data.get("plan_type"))

    api_metrics = collect_api_metrics(access_token, account_id, args.usage_proxy, args.timeout_seconds)
    local_metrics = collect_local_metrics(args.data_path)
    metrics = api_metrics if api_metrics is not None else local_metrics

    windows = metrics.get("windows")
    if not isinstance(windows, dict):
        windows = {}
    window_5h = pick_window(windows, 300)
    window_week = pick_window(windows, 10080)

    usage_5h = format_usage(window_5h)
    usage_weekly = format_usage(window_week)
    plan = normalize_plan(metrics.get("plan_type"))
    if plan == "unknown":
        plan = plan_from_claims
    if plan == "unknown":
        plan = "unknown"

    source = metrics.get("source")
    if source not in ("api", "local"):
        source = "local"

    last_activity_epoch = metrics.get("last_activity_epoch")
    if not isinstance(last_activity_epoch, int):
        fallback_last_activity = local_metrics.get("last_activity_epoch")
        if isinstance(fallback_last_activity, int):
            last_activity_epoch = fallback_last_activity
        else:
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
