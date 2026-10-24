import json
import os
import time
from typing import Any, Callable

import httpx

from .queue_client import QueueClient


def _ha_client() -> httpx.Client:
    base = os.environ.get("HA_URL", "http://ha-proxy:8080").rstrip("/")
    return httpx.Client(base_url=base, timeout=30.0)


def ha_states(filter_text: str = "") -> dict[str, Any]:
    with _ha_client() as client:
        r = client.get("/api/states")
        r.raise_for_status()
        states = r.json()
    needle = (filter_text or "").strip().lower()
    trimmed = []
    for row in states if isinstance(states, list) else []:
        eid = str(row.get("entity_id", ""))
        if needle and needle not in eid.lower():
            continue
        trimmed.append(
            {
                "entity_id": eid,
                "state": row.get("state"),
                "friendly_name": (row.get("attributes") or {}).get("friendly_name"),
            }
        )
        if len(trimmed) >= 40:
            break
    return {"count": len(trimmed), "states": trimmed}


def ha_history(entity: str, hours: float = 24) -> dict[str, Any]:
    entity = str(entity).strip()
    if not entity or len(entity) > 120:
        raise ValueError("entity is required")
    hours = max(0.25, min(float(hours), 168))
    end = time.time()
    start = end - hours * 3600
    with _ha_client() as client:
        r = client.get(f"/api/history/period/{start}", params={"filter_entity_id": entity, "end_time": end})
        r.raise_for_status()
        data = r.json()
    return {"entity": entity, "hours": hours, "points": data}


def host_health() -> dict[str, Any]:
    load1, load5, load15 = os.getloadavg()
    mem: dict[str, int] = {}
    with open("/proc/meminfo", encoding="utf-8") as f:
        for line in f:
            if line.startswith(("MemTotal:", "MemAvailable:")):
                k, v = line.split(":")
                mem[k.strip()] = int(v.split()[0]) * 1024
    stat = os.statvfs("/")
    disk_total = stat.f_frsize * stat.f_blocks
    disk_free = stat.f_frsize * stat.f_bavail
    with open("/proc/uptime", encoding="utf-8") as f:
        uptime_sec = float(f.read().split()[0])
    return {
        "cpu_load": {"1m": load1, "5m": load5, "15m": load15},
        "memory_bytes": mem,
        "disk_bytes": {"total": disk_total, "avail": disk_free},
        "uptime_sec": uptime_sec,
    }


def container_status() -> dict[str, Any]:
    path = os.environ.get("CONTAINER_STATUS_FILE", "/var/lib/agent/containers.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def notify_kellan(text: str) -> dict[str, Any]:
    msg = str(text).strip()[:500]
    if not msg:
        raise ValueError("text is required")
    with _ha_client() as client:
        r = client.post("/api/services/script/notify_kellan", json={"message": msg})
        r.raise_for_status()
        return {"ok": True}


def propose_action(
    queue: QueueClient,
    task_id: str,
    action_id: str,
    args: dict[str, Any],
    reason: str,
) -> dict[str, Any]:
    queue.post_proposal(
        task_id,
        {"action_id": action_id, "args": args or {}, "reason": reason},
    )
    return {"queued": True, "action_id": action_id}


TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "ha_states": {"type": "object", "properties": {"filter": {"type": "string"}}, "additionalProperties": False},
    "ha_history": {
        "type": "object",
        "properties": {"entity": {"type": "string"}, "hours": {"type": "number"}},
        "required": ["entity"],
        "additionalProperties": False,
    },
    "host_health": {"type": "object", "properties": {}, "additionalProperties": False},
    "container_status": {"type": "object", "properties": {}, "additionalProperties": False},
    "notify_kellan": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"], "additionalProperties": False},
    "propose_action": {
        "type": "object",
        "properties": {
            "action_id": {"type": "string"},
            "args": {"type": "object"},
            "reason": {"type": "string"},
        },
        "required": ["action_id", "reason"],
        "additionalProperties": False,
    },
}


def validate_tool_args(name: str, args: dict[str, Any]) -> None:
    schema = TOOL_SCHEMAS.get(name)
    if not schema:
        raise ValueError(f"unknown tool {name}")
    if schema.get("additionalProperties") is False:
        for key in args:
            if key not in schema.get("properties", {}):
                raise ValueError(f"unexpected arg {key}")
    if name == "ha_history" and not str(args.get("entity", "")).strip():
        raise ValueError("entity is required")
    if name == "notify_kellan" and not str(args.get("text", "")).strip():
        raise ValueError("text is required")
    if name == "propose_action" and not str(args.get("action_id", "")).strip():
        raise ValueError("action_id is required")


def build_tool_dispatch(task_id: str, queue: QueueClient) -> dict[str, Callable[..., Any]]:
    return {
        "ha_states": lambda **kw: ha_states(kw.get("filter", "")),
        "ha_history": lambda **kw: ha_history(kw["entity"], kw.get("hours", 24)),
        "host_health": lambda **_kw: host_health(),
        "container_status": lambda **_kw: container_status(),
        "notify_kellan": lambda **kw: notify_kellan(kw["text"]),
        "propose_action": lambda **kw: propose_action(queue, task_id, kw["action_id"], kw.get("args") or {}, kw.get("reason", "")),
    }
