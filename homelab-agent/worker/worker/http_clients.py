from typing import Any

import httpx


def outbound_httpx_client(**kwargs: Any) -> httpx.Client:
    """HTTPS (and HTTP) to external hosts via HTTPS_PROXY/HTTP_PROXY from the environment."""
    return httpx.Client(timeout=30.0, trust_env=True, **kwargs)


def ha_httpx_client(base_url: str) -> httpx.Client:
    # HA is reached on agent_int; must not pick up egress proxy env vars.
    return httpx.Client(base_url=base_url, timeout=30.0, trust_env=False)
