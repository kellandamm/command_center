# Homelab agent (Infra Ops)

Outbound-only worker that polls Command Center `/api/queue`, calls an LLM through an egress proxy, and reaches Home Assistant only through `ha-proxy`.

## Components

| Service | Role |
|---|---|
| **worker** | Polls queue, runs tool loop (`openai` + `httpx` only). Never sees `HA_TOKEN`. |
| **ha-proxy** | Injects HA + Cloudflare Access headers; allowlists read-only HA paths + `script.notify_kellan`. |
| **egress** | Squid allowlist to LLM host and Command Center host only. |

## Environment

See `env/*.env.example`. Command Center additionally needs `QUEUE_HMAC_KEY_PRODUCER`, `QUEUE_HMAC_KEY_WORKER`, and existing `CF_ACCESS_*` JWT settings.

## Deploy

1. Copy `env/*.env.example` to `env/worker.env` and `env/ha-proxy.env`; fill secrets.
2. Edit `egress/squid.conf` with your Command Center hostname.
3. Provide **container status JSON** on the host (read-only mount):

```bash
# Example cron (host VM, not in worker): write /opt/homelab-agent/container-status.json every minute
* * * * * docker ps --format '{{json .}}' | jq -s '.' > /opt/homelab-agent/container-status.json
```

4. Ensure Home Assistant has `script.notify_kellan` for notifications.
5. `docker compose -f homelab-agent/compose.yml up -d --build`

## Smoke tests (from design §5)

- From a debug shell on the agent network: `curl -X POST http://ha-proxy:8080/api/services/light/turn_on` → **403** (upstream must not see the request).
- From worker container: `curl https://example.com` → **fails** (egress deny).
- `docker logs` worker | grep -E 'KEY|TOKEN|SECRET|Authorization` → **0 hits** at INFO.
- Post 10 tasks via `/api/queue`; confirm results and token usage in Command Center.

## Security notes

- Do **not** mount the Docker socket into the worker. Container status is a host-produced JSON file (Infra Ops interface).
- v1 records approvals only; no executor runs destructive commands.
