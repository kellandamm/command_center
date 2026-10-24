# Homelab agent (Infra Ops)

Outbound-only worker that polls Command Center `/api/queue`, calls an LLM through an egress proxy, and reaches Home Assistant only through `ha-proxy`.

Homelab hosts are **unprivileged Proxmox LXCs** (Docker via nesting). A typical target is an LXC such as **CT 110** (not necessarily a full VM). Enable nesting before `docker compose up`:

```bash
pct set <ct-id> --features nesting=1,keyctl=1
```

The same compose hardening applies on an LXC or a VM: `read_only` rootfs, `cap_drop: [ALL]`, `security_opt: no-new-privileges`, non-root UID 10001, tmpfs, and resource limits.

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
3. On the **host** (LXC or VM), create the container status file (read-only mount into the worker):

```bash
mkdir -p /srv/homelab-agent/status
# Example cron — host Docker, not the worker container:
* * * * * docker ps --format json | jq -s '.' > /srv/homelab-agent/status/containers.json
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
