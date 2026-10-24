import os
import time
import uuid
from typing import Any

import httpx

from .hmac import queue_hmac_sign


class QueueClient:
    def __init__(self, base_url: str, hmac_key: str, cf_id: str, cf_secret: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.hmac_key = hmac_key
        self.headers_base = {
            "CF-Access-Client-Id": cf_id,
            "CF-Access-Client-Secret": cf_secret,
        }

    def _signed_headers(self, raw_body: str) -> dict[str, str]:
        ts = str(int(time.time()))
        nonce = str(uuid.uuid4())
        sig = queue_hmac_sign(self.hmac_key, ts, nonce, raw_body)
        return {
            **self.headers_base,
            "X-Queue-Timestamp": ts,
            "X-Queue-Nonce": nonce,
            "X-Queue-Signature": sig,
        }

    def claim_next(self) -> dict[str, Any] | None:
        with httpx.Client(timeout=30.0) as client:
            r = client.get(f"{self.base_url}/api/queue/next", headers=self._signed_headers(""))
            r.raise_for_status()
            task = r.json().get("task")
            return task

    def post_result(self, task_id: str, payload: dict[str, Any]) -> None:
        import json

        raw = json.dumps(payload, separators=(",", ":"))
        with httpx.Client(timeout=30.0) as client:
            r = client.post(
                f"{self.base_url}/api/queue/{task_id}/result",
                content=raw,
                headers={**self._signed_headers(raw), "Content-Type": "application/json"},
            )
            r.raise_for_status()

    def post_proposal(self, task_id: str, payload: dict[str, Any]) -> None:
        import json

        raw = json.dumps(payload, separators=(",", ":"))
        with httpx.Client(timeout=30.0) as client:
            r = client.post(
                f"{self.base_url}/api/queue/{task_id}/proposals",
                content=raw,
                headers={**self._signed_headers(raw), "Content-Type": "application/json"},
            )
            r.raise_for_status()
