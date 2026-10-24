#!/usr/bin/env python3
"""Minimal Home Assistant reverse proxy with method+path allowlist."""

import os
import re
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx

ALLOW_GET = re.compile(r"^/api/states(?:/[^/]+)?$")
ALLOW_HISTORY = re.compile(r"^/api/history/period(/[^/]+)?$")
ALLOW_NOTIFY = re.compile(r"^/api/services/script/notify_kellan$")


def proxy_config() -> dict[str, str]:
    return {
        "upstream": os.environ.get("HA_UPSTREAM", "https://ha.gobison.io").rstrip("/"),
        "ha_token": os.environ["HA_TOKEN"],
        "cf_id": os.environ["CF_ACCESS_CLIENT_ID"],
        "cf_secret": os.environ["CF_ACCESS_CLIENT_SECRET"],
    }


def listen_address() -> tuple[str, int]:
    return ("0.0.0.0", int(os.environ.get("PORT", "8080")))


def normalize_path(path: str) -> str:
    decoded = urllib.parse.unquote(path)
    if "%" in decoded:
        raise ValueError("path not allowed")
    if "\\" in decoded:
        raise ValueError("path not allowed")
    if ".." in decoded or decoded.startswith("//"):
        raise ValueError("path not allowed")
    collapsed = re.sub(r"/+", "/", decoded)
    if collapsed != "/":
        collapsed = collapsed.rstrip("/") or "/"
    return collapsed


def allowed(method: str, path: str) -> bool:
    if method == "GET" and (ALLOW_GET.match(path) or ALLOW_HISTORY.match(path)):
        return True
    if method == "POST" and ALLOW_NOTIFY.match(path):
        return True
    return False


def forward_path(raw_path: str) -> str:
    """Normalized path plus original query string (if any)."""
    if "?" in raw_path:
        path_part, query = raw_path.split("?", 1)
        return normalize_path(path_part) + "?" + query
    return normalize_path(raw_path)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        return

    def _proxy(self) -> None:
        try:
            target = forward_path(self.path)
        except ValueError:
            self.send_error(403)
            return
        path_only = target.split("?", 1)[0]
        method = self.command
        if not allowed(method, path_only):
            self.send_error(403)
            return
        cfg = proxy_config()
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length else b""
        headers = {
            "Authorization": f"Bearer {cfg['ha_token']}",
            "CF-Access-Client-Id": cfg["cf_id"],
            "CF-Access-Client-Secret": cfg["cf_secret"],
            "Content-Type": self.headers.get("Content-Type", "application/json"),
        }
        url = f"{cfg['upstream']}{target}"
        with httpx.Client(timeout=30.0, verify=True) as client:
            resp = client.request(method, url, headers=headers, content=body)
        self.send_response(resp.status_code)
        for k, v in resp.headers.items():
            lk = k.lower()
            if lk in ("transfer-encoding", "connection", "authorization"):
                continue
            if lk.startswith("cf-access"):
                continue
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(resp.content)

    def do_GET(self) -> None:
        self._proxy()

    def do_POST(self) -> None:
        self._proxy()

    def do_PUT(self) -> None:
        self.send_error(403)

    def do_DELETE(self) -> None:
        self.send_error(403)

    def do_PATCH(self) -> None:
        self.send_error(403)


def main() -> None:
    server = ThreadingHTTPServer(listen_address(), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
