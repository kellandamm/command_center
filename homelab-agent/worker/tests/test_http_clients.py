import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest

from worker.http_clients import OutboundProxyRequiredError, ha_httpx_client, outbound_httpx_client
from worker.queue_client import QueueClient


class _RecordingProxyHandler(BaseHTTPRequestHandler):
    connect_targets: list[str] = []
    absolute_gets: list[str] = []

    def log_message(self, *_args: object) -> None:
        return

    def do_CONNECT(self) -> None:
        type(self).connect_targets.append(self.path)
        self.send_response(200, "Connection Established")
        self.end_headers()

    def do_GET(self) -> None:
        type(self).absolute_gets.append(self.path)
        self.send_response(502)
        self.end_headers()


@pytest.fixture
def block_external_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    real = socket.getaddrinfo

    def guarded(host: str, *args: object, **kwargs: object) -> list[tuple]:
        if host not in ("127.0.0.1", "localhost"):
            raise socket.gaierror(socket.EAI_NONAME, "Temporary failure in name resolution")
        return real(host, *args, **kwargs)

    monkeypatch.setattr(socket, "getaddrinfo", guarded)


@pytest.fixture
def recording_proxy() -> tuple[int, type[_RecordingProxyHandler]]:
    _RecordingProxyHandler.connect_targets = []
    _RecordingProxyHandler.absolute_gets = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), _RecordingProxyHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield port, _RecordingProxyHandler
    server.shutdown()


def test_outbound_requires_proxy_env(block_external_dns, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("HTTPS_PROXY", raising=False)
    monkeypatch.delenv("HTTP_PROXY", raising=False)
    with pytest.raises(OutboundProxyRequiredError):
        outbound_httpx_client()


def test_outbound_queue_https_connects_via_proxy(block_external_dns, monkeypatch: pytest.MonkeyPatch, recording_proxy) -> None:
    port, handler = recording_proxy
    monkeypatch.delenv("HTTP_PROXY", raising=False)
    monkeypatch.setenv("HTTPS_PROXY", f"http://127.0.0.1:{port}")
    monkeypatch.delenv("NO_PROXY", raising=False)

    client = QueueClient("https://api.commandcode.ai", "test-hmac-key", "cf-id", "cf-secret")
    with pytest.raises(Exception):
        client.claim_next()

    assert handler.connect_targets == ["api.commandcode.ai:443"]
    assert handler.absolute_gets == []


def test_outbound_queue_http_uses_proxy_with_only_https_proxy_env(
    block_external_dns, monkeypatch: pytest.MonkeyPatch, recording_proxy
) -> None:
    port, handler = recording_proxy
    monkeypatch.delenv("HTTP_PROXY", raising=False)
    monkeypatch.setenv("HTTPS_PROXY", f"http://127.0.0.1:{port}")
    monkeypatch.delenv("NO_PROXY", raising=False)

    client = QueueClient("http://stremmy.com", "test-hmac-key", "cf-id", "cf-secret")
    with pytest.raises(Exception):
        client.claim_next()

    assert handler.connect_targets == []
    assert handler.absolute_gets == ["http://stremmy.com/api/queue/next"]


def test_outbound_https_ignores_no_proxy_bypass(block_external_dns, monkeypatch: pytest.MonkeyPatch, recording_proxy) -> None:
    port, handler = recording_proxy
    monkeypatch.setenv("HTTPS_PROXY", f"http://127.0.0.1:{port}")
    monkeypatch.setenv("NO_PROXY", "stremmy.com,api.commandcode.ai,*")

    with pytest.raises(Exception):
        with outbound_httpx_client() as client:
            client.get("https://api.stremmy.com/api/queue/next")

    assert handler.connect_targets == ["api.stremmy.com:443"]


def test_legacy_stock_client_http_fails_without_http_proxy_env(
    block_external_dns, monkeypatch: pytest.MonkeyPatch, recording_proxy
) -> None:
    """Documents VM 111 case 1: http:// URL + only HTTPS_PROXY + stock httpx (no explicit proxy)."""
    port, handler = recording_proxy
    monkeypatch.delenv("HTTP_PROXY", raising=False)
    monkeypatch.setenv("HTTPS_PROXY", f"http://127.0.0.1:{port}")
    monkeypatch.delenv("NO_PROXY", raising=False)

    with pytest.raises(httpx.ConnectError, match="name resolution"):
        with httpx.Client(timeout=30.0) as client:
            client.get("http://stremmy.com/api/queue/next")

    assert handler.connect_targets == []
    assert handler.absolute_gets == []


def test_legacy_stock_client_https_honors_no_proxy_bypass(
    block_external_dns, monkeypatch: pytest.MonkeyPatch, recording_proxy
) -> None:
    """Documents VM 111 case 2: NO_PROXY bypass + stock httpx trust_env (default True)."""
    port, handler = recording_proxy
    monkeypatch.setenv("HTTPS_PROXY", f"http://127.0.0.1:{port}")
    monkeypatch.setenv("NO_PROXY", "api.stremmy.com")

    with pytest.raises(httpx.ConnectError, match="name resolution"):
        with httpx.Client(timeout=30.0) as client:
            client.get("https://api.stremmy.com/api/queue/next")

    assert handler.connect_targets == []


def test_ha_client_stays_direct_with_http_and_https_proxy_env(
    block_external_dns, monkeypatch: pytest.MonkeyPatch,
) -> None:
    proxy_connects: list[str] = []
    proxy_gets: list[str] = []

    class ProxyHandler(BaseHTTPRequestHandler):
        def log_message(self, *_args: object) -> None:
            return

        def do_CONNECT(self) -> None:
            proxy_connects.append(self.path)
            self.send_response(200, "Connection Established")
            self.end_headers()

        def do_GET(self) -> None:
            proxy_gets.append(self.path)
            self.send_response(502)
            self.end_headers()

    class HAHandler(BaseHTTPRequestHandler):
        def log_message(self, *_args: object) -> None:
            return

        def do_GET(self) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b"[]")

    proxy = ThreadingHTTPServer(("127.0.0.1", 0), ProxyHandler)
    ha = ThreadingHTTPServer(("127.0.0.1", 0), HAHandler)
    proxy_port = proxy.server_address[1]
    ha_port = ha.server_address[1]
    for target in (proxy, ha):
        threading.Thread(target=target.serve_forever, daemon=True).start()

    proxy_url = f"http://127.0.0.1:{proxy_port}"
    monkeypatch.setenv("HTTP_PROXY", proxy_url)
    monkeypatch.setenv("HTTPS_PROXY", proxy_url)
    monkeypatch.setenv("NO_PROXY", "ha-proxy,localhost,127.0.0.1")

    with ha_httpx_client(f"http://127.0.0.1:{ha_port}") as client:
        r = client.get("/api/states")
        r.raise_for_status()

    assert proxy_connects == []
    assert proxy_gets == []
    assert r.json() == []
