import importlib.util
import os
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from pathlib import Path

import pytest

PROXY_PATH = Path(__file__).resolve().parents[1] / "proxy.py"


def load_proxy():
    spec = importlib.util.spec_from_file_location("ha_proxy", PROXY_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Upstream(BaseHTTPRequestHandler):
    hits: list[dict] = []

    def _record(self, method: str) -> None:
        Upstream.hits.append(
            {
                "method": method,
                "path": self.path,
                "authorization": self.headers.get("Authorization"),
                "cf_id": self.headers.get("CF-Access-Client-Id"),
                "cf_secret": self.headers.get("CF-Access-Client-Secret"),
            }
        )

    def do_GET(self) -> None:
        self._record("GET")
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"[]")

    def do_POST(self) -> None:
        self._record("POST")
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, *args) -> None:
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


@pytest.fixture()
def proxy_env(upstream, monkeypatch):
    monkeypatch.setenv("HA_UPSTREAM", f"http://127.0.0.1:{upstream}")
    monkeypatch.setenv("HA_TOKEN", "upstream-bearer-token-secret")
    monkeypatch.setenv("CF_ACCESS_CLIENT_ID", "cf-client-id-test")
    monkeypatch.setenv("CF_ACCESS_CLIENT_SECRET", "cf-client-secret-test")
    return load_proxy()


@pytest.fixture()
def live_proxy(proxy_env, upstream):
    proxy = proxy_env
    server = ThreadingHTTPServer(("127.0.0.1", 0), proxy.Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield port, proxy
    server.shutdown()


def request_proxy(port: int, method: str, path: str, body: bytes | None = None) -> tuple[int, bytes, dict[str, str]]:
    url = f"http://127.0.0.1:{port}{path}"
    req = urllib.request.Request(url, data=body, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            headers = {k.lower(): v for k, v in resp.headers.items()}
            return resp.status, resp.read(), headers
    except urllib.error.HTTPError as err:
        headers = {k.lower(): v for k, v in err.headers.items()}
        return err.code, err.read(), headers


def test_allowlist_helpers(proxy_env):
    proxy = proxy_env
    assert proxy.allowed("POST", "/api/services/light/turn_on") is False
    assert proxy.allowed("GET", "/api/config") is False
    assert proxy.allowed("GET", "/api/states/light.kitchen") is True
    assert proxy.allowed("GET", "/api/history/period/1700000000") is True
    assert proxy.allowed("GET", "/api/history/period/1700000000/extra") is False
    assert proxy.allowed("POST", "/api/services/script/notify_kellan") is True
    with pytest.raises(ValueError):
        proxy.normalize_path("/api/%252e%252e/config")
    with pytest.raises(ValueError):
        proxy.normalize_path("/api\\states")


def test_live_proxy_blocks_without_upstream_hits(live_proxy):
    port, _proxy = live_proxy
    blocked = [
        ("POST", "/api/services/light/turn_on", b"{}"),
        ("POST", "/api/services/lock/unlock", b"{}"),
        ("POST", "/api/services/script/notify_kellan/../../light/turn_on", b"{}"),
        ("POST", "/api/services/script/notify_kellan/%2e%2e%2flight%2fturn_on", b"{}"),
        ("POST", "//api/services/light/turn_on", b"{}"),
        ("POST", "/api/%252e%252e/services/light/turn_on", b"{}"),
        ("GET", "/api/config", None),
        ("PUT", "/api/states/light.kitchen", b"{}"),
        ("DELETE", "/api/states/light.kitchen", None),
        ("PATCH", "/api/states/light.kitchen", b"{}"),
    ]
    for method, path, body in blocked:
        before = len(Upstream.hits)
        status, _body, _hdrs = request_proxy(port, method, path, body)
        assert status in (403, 501), (method, path, status)
        assert len(Upstream.hits) == before, (method, path, Upstream.hits)


def test_live_proxy_allows_states_and_notify(live_proxy, proxy_env):
    port, proxy = live_proxy
    token = os.environ["HA_TOKEN"]
    status, body, headers = request_proxy(port, "GET", "/api/states/light.kitchen")
    assert status == 200
    assert len(Upstream.hits) == 1
    hit = Upstream.hits[-1]
    assert hit["method"] == "GET"
    assert hit["path"] == "/api/states/light.kitchen"
    assert hit["authorization"] == f"Bearer {token}"
    assert hit["cf_id"] == os.environ["CF_ACCESS_CLIENT_ID"]
    assert hit["cf_secret"] == os.environ["CF_ACCESS_CLIENT_SECRET"]
    assert token not in body.decode()
    assert token not in str(headers)

    status, body, headers = request_proxy(
        port,
        "POST",
        "/api/services/script/notify_kellan",
        b'{"message":"hi"}',
    )
    assert status == 200
    hit = Upstream.hits[-1]
    assert hit["path"] == "/api/services/script/notify_kellan"
    assert hit["authorization"] == f"Bearer {token}"
    assert token not in body.decode()
    assert token not in str(headers)

    assert proxy.forward_path("/api/states/foo?filter=1") == "/api/states/foo?filter=1"
