#!/usr/bin/env python3
"""静默恢复当前 Codex 回合中未落盘的图片生成结果。"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
from pathlib import Path
from typing import Any, Iterable


def emit(payload: dict[str, Any], as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    elif payload.get("path"):
        print(payload["path"])


def walk(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def detect_extension(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp"
    return None


def find_transcript(codex_home: Path, session_id: str) -> Path | None:
    sessions = codex_home / "sessions"
    if not sessions.is_dir():
        return None
    matches = list(sessions.rglob(f"rollout-*{session_id}.jsonl"))
    return max(matches, key=lambda path: path.stat().st_mtime_ns) if matches else None


def current_turn_image_calls(transcript: Path) -> list[dict[str, Any]]:
    latest_user_line = -1
    calls: list[tuple[int, dict[str, Any]]] = []

    for line_number, line in enumerate(transcript.read_text(errors="ignore").splitlines()):
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue

        nodes = list(walk(record))
        if any(node.get("type") == "message" and node.get("role") == "user" for node in nodes):
            latest_user_line = line_number
            calls.clear()

        for node in nodes:
            if node.get("type") == "image_generation_call":
                calls.append((line_number, node))

    return [node for line_number, node in calls if line_number > latest_user_line]


def native_existing_path(output_dir: Path, call_id: str) -> Path | None:
    for extension in (".png", ".jpg", ".jpeg", ".webp"):
        candidate = output_dir / f"{call_id}{extension}"
        if candidate.is_file() and candidate.stat().st_size > 0:
            return candidate.resolve()
    return None


def recover(args: argparse.Namespace) -> dict[str, Any]:
    codex_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")).expanduser().resolve()
    session_id = args.session_id.strip()
    if not session_id:
        return {"status": "error", "code": "missing_session_id"}

    transcript = find_transcript(codex_home, session_id)
    if transcript is None:
        return {"status": "no_result"}

    calls = current_turn_image_calls(transcript)
    if not calls:
        return {"status": "no_result"}

    output_dir = codex_home / "generated_images" / session_id
    recovered: list[dict[str, str]] = []

    for call in calls:
        call_id = call.get("id")
        if not isinstance(call_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", call_id):
            continue

        saved_path = call.get("saved_path")
        if isinstance(saved_path, str):
            official = Path(saved_path).expanduser()
            if official.is_file() and official.stat().st_size > 0:
                recovered.append({"status": "official", "path": str(official.resolve()), "call_id": call_id})
                continue

        result = call.get("result")
        if not isinstance(result, str) or not result:
            existing = native_existing_path(output_dir, call_id)
            if existing is not None:
                recovered.append({"status": "official", "path": str(existing), "call_id": call_id})
            continue

        try:
            data = base64.b64decode(result, validate=True)
        except (ValueError, base64.binascii.Error):
            continue

        extension = detect_extension(data)
        if extension is None:
            continue

        output_dir.mkdir(parents=True, exist_ok=True)
        output = output_dir / f"{call_id}{extension}"
        if output.exists():
            if output.read_bytes() != data:
                return {"status": "error", "code": "conflicting_existing_file", "call_id": call_id}
        else:
            temporary = output.with_suffix(output.suffix + f".tmp-{os.getpid()}")
            try:
                temporary.write_bytes(data)
                os.replace(temporary, output)
            finally:
                temporary.unlink(missing_ok=True)

        recovered.append({"status": "recovered", "path": str(output.resolve()), "call_id": call_id})

    if not recovered:
        return {"status": "no_result"}
    if len(recovered) == 1:
        return recovered[0]
    return {"status": "recovered", "images": recovered}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        payload = recover(args)
    except Exception as error:  # 兜底不得中断主流程。
        payload = {"status": "error", "code": "unexpected_error", "message": str(error)}
    emit(payload, args.json)


if __name__ == "__main__":
    main()
