import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

# Import after setting env in subprocess tests; inline allowlist checks here
from pathlib import Path
import importlib.util

spec = importlib.util.spec_from_file_location("proxy", Path(__file__).resolve().parents[1] / "proxy.py")
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)


class Upstream(BaseHTTPRequestHandler):
    hits: list[tuple[str, str]] = []

    def do_GET(self):
        Upstream.hits.append(("GET", self.path))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"[]")

    def do_POST(self):
        Upstream.hits.append(("POST", self.path))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, *args):
        return


@pytest.fixture()
def upstream():
    Upstream.hits = []
    server = HTTPServer(("127.0.0.1", 0), Upstream)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield port
    server.shutdown()


def test_allowlist_blocks_disallowed(monkeypatch, upstream):
    monkeypatch.setenv("HA_UPSTREAM", f"http://127.0.0.1:{upstream}")
    monkeypatch.setenv("HA_TOKEN", "t")
    monkeypatch.setenv("CF_ACCESS_CLIENT_ID", "id")
    monkeypatch.setenv("CF_ACCESS_CLIENT_SECRET", "sec")
    assert proxy.allowed("POST", "/api/services/light/turn_on") is False
    assert proxy.allowed("GET", "/api/config") is False
    assert proxy.allowed("GET", "/api/states") is True
    assert proxy.allowed("GET", "/api/states/light.kitchen") is True
    assert proxy.allowed("GET", "/api/history/period/123") is True
    assert proxy.allowed("POST", "/api/services/script/notify_kellan") is True
    with pytest.raises(ValueError):
        proxy.normalize_path("/api/../config")
    with pytest.raises(ValueError):
        proxy.normalize_path("//api/states")
