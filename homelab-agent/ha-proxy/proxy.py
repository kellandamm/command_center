#!/usr/bin/env python3
"""Minimal Home Assistant reverse proxy with method+path allowlist."""

import os
import re
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx

UPSTREAM = os.environ.get("HA_UPSTREAM", "https://ha.gobison.io").rstrip("/")
HA_TOKEN = os.environ["HA_TOKEN"]
CF_ID = os.environ["CF_ACCESS_CLIENT_ID"]
CF_SECRET = os.environ["CF_ACCESS_CLIENT_SECRET"]
LISTEN = ("0.0.0.0", int(os.environ.get("PORT", "8080")))

ALLOW_GET = re.compile(r"^/api/states(?:/[^/]+)?$")
ALLOW_HISTORY = re.compile(r"^/api/history/period/")
ALLOW_NOTIFY = re.compile(r"^/api/services/script/notify_kellan$")


def normalize_path(path: str) -> str:
    decoded = urllib.parse.unquote(path)
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


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        return

    def _proxy(self) -> None:
        try:
            path = normalize_path(self.path.split("?", 1)[0])
        except ValueError:
            self.send_error(403)
            return
        method = self.command
        if not allowed(method, path):
            self.send_error(403)
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length else b""
        headers = {
            "Authorization": f"Bearer {HA_TOKEN}",
            "CF-Access-Client-Id": CF_ID,
            "CF-Access-Client-Secret": CF_SECRET,
            "Content-Type": self.headers.get("Content-Type", "application/json"),
        }
        url = f"{UPSTREAM}{self.path}"
        with httpx.Client(timeout=30.0, verify=True) as client:
            resp = client.request(method, url, headers=headers, content=body)
        self.send_response(resp.status_code)
        for k, v in resp.headers.items():
            if k.lower() in ("transfer-encoding", "connection"):
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


def main() -> None:
    server = ThreadingHTTPServer(LISTEN, Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
