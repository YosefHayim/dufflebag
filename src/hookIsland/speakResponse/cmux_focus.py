"""Cmux focus discovery for response narration without persisted capabilities."""

from __future__ import annotations

import json
import socket
import subprocess
import sys
import threading
import time
from typing import Any
import uuid


CMUX_BUNDLE_IDENTIFIER = "com.cmuxterm.app"

_focus_lock = threading.Lock()
_focus_cache: dict[str, tuple[float, dict[str, Any] | None]] = {}


def cmux_identify(socket_path: str) -> dict[str, Any] | None:
    if not socket_path or not hasattr(socket, "AF_UNIX"):
        return None
    request = {"id": uuid.uuid4().hex, "method": "system.identify", "params": {}}
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(0.35)
            client.connect(socket_path)
            client.sendall(json.dumps(request).encode("utf-8") + b"\n")
            payload = b""
            while b"\n" not in payload and len(payload) < 1_048_576:
                chunk = client.recv(65_536)
                if not chunk:
                    break
                payload += chunk
        document = json.loads(payload.split(b"\n", 1)[0].decode("utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        document = None
    if isinstance(document, dict) and document.get("ok") is True and isinstance(document.get("result"), dict):
        return document["result"]
    try:
        command = ["cmux", "identify", "--json", "--id-format", "both", "--socket", socket_path]
        fallback = subprocess.run(command, check=True, capture_output=True, text=True, timeout=0.75)
        value = json.loads(fallback.stdout)
        return value if isinstance(value, dict) else None
    except (json.JSONDecodeError, OSError, subprocess.SubprocessError):
        return None


def cached_cmux_identify(socket_path: str) -> dict[str, Any] | None:
    now = time.monotonic()
    with _focus_lock:
        cached = _focus_cache.get(socket_path)
        if cached is not None and now - cached[0] < 0.25:
            return cached[1]
    focused = cmux_identify(socket_path)
    with _focus_lock:
        _focus_cache[socket_path] = (now, focused)
    return focused


def clear_focus_cache() -> None:
    with _focus_lock:
        _focus_cache.clear()


def frontmost_bundle_identifier() -> str:
    if sys.platform != "darwin":
        return ""
    try:
        from AppKit import NSWorkspace

        application = NSWorkspace.sharedWorkspace().frontmostApplication()
        identifier = application.bundleIdentifier() if application is not None else ""
        return identifier if isinstance(identifier, str) else ""
    except Exception:
        return ""
