import os
from typing import Any

import httpx


class OutboundProxyRequiredError(RuntimeError):
    """Outbound queue/LLM HTTP(S) must use egress; agent_int has no external DNS."""


def require_egress_proxy_url() -> str:
    proxy = (os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY") or "").strip()
    if not proxy:
        raise OutboundProxyRequiredError(
            "HTTPS_PROXY or HTTP_PROXY must be set so outbound requests use egress "
            "(local DNS on agent_int cannot resolve external queue/LLM hosts)"
        )
    return proxy


def outbound_httpx_client(**kwargs: Any) -> httpx.Client:
    # Explicit proxy so HTTP(S) uses egress even when NO_PROXY would bypass trust_env routing.
    opts: dict[str, Any] = {
        "timeout": 30.0,
        "trust_env": False,
        "proxy": require_egress_proxy_url(),
    }
    opts.update(kwargs)
    return httpx.Client(**opts)


def ha_httpx_client(base_url: str) -> httpx.Client:
    # HA is reached on agent_int; must not pick up egress proxy env vars.
    return httpx.Client(base_url=base_url, timeout=30.0, trust_env=False)
