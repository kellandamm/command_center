import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest

from worker.http_clients import ha_httpx_client, outbound_httpx_client
from worker.queue_client import QueueClient


class _RecordingProxyHandler(BaseHTTPRequestHandler):
    connect_targets: list[str] = []

    def log_message(self, *_args: object) -> None:
        return

    def do_CONNECT(self) -> None:
        type(self).connect_targets.append(self.path)
        self.send_response(200, "Connection Established")
        self.end_headers()

    def do_GET(self) -> None:
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


def test_outbound_queue_uses_https_proxy_without_local_dns(block_external_dns, monkeypatch: pytest.MonkeyPatch) -> None:
    _RecordingProxyHandler.connect_targets = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), _RecordingProxyHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    monkeypatch.setenv("HTTPS_PROXY", f"http://127.0.0.1:{port}")
    client = QueueClient(
        "https://api.commandcode.ai",
        "test-hmac-key",
        "cf-id",
        "cf-secret",
    )

    with pytest.raises(Exception):
        client.claim_next()

    assert _RecordingProxyHandler.connect_targets == ["api.commandcode.ai:443"]


def test_ha_client_does_not_use_https_proxy(block_external_dns, monkeypatch: pytest.MonkeyPatch) -> None:
    proxy_connects: list[str] = []

    class ProxyHandler(BaseHTTPRequestHandler):
        def log_message(self, *_args: object) -> None:
            return

        def do_CONNECT(self) -> None:
            proxy_connects.append(self.path)
            self.send_response(200, "Connection Established")
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
    threads = [
        threading.Thread(target=proxy.serve_forever, daemon=True),
        threading.Thread(target=ha.serve_forever, daemon=True),
    ]
    for t in threads:
        t.start()

    monkeypatch.setenv("HTTPS_PROXY", f"http://127.0.0.1:{proxy_port}")
    monkeypatch.setenv("HA_URL", f"http://127.0.0.1:{ha_port}")

    with ha_httpx_client(f"http://127.0.0.1:{ha_port}") as client:
        r = client.get("/api/states")
        r.raise_for_status()

    assert proxy_connects == []
    assert r.json() == []


def test_outbound_httpx_client_reads_proxy_env(block_external_dns, monkeypatch: pytest.MonkeyPatch) -> None:
    _RecordingProxyHandler.connect_targets = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), _RecordingProxyHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    monkeypatch.setenv("HTTPS_PROXY", f"http://127.0.0.1:{port}")

    with pytest.raises(Exception):
        with outbound_httpx_client() as client:
            client.get("https://api.stremmy.com/api/queue/next")

    assert _RecordingProxyHandler.connect_targets == ["api.stremmy.com:443"]
