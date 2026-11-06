# Homelab agent (Infra Ops)

Outbound-only worker that polls Stremmy `/api/queue`, calls an LLM through an egress proxy, and reaches Home Assistant only through `ha-proxy`.

Homelab hosts are **unprivileged Proxmox LXCs** (Docker via nesting) or a VM such as **VM 111**. Enable nesting before `docker compose up` on an LXC:

```bash
pct set <ct-id> --features nesting=1,keyctl=1
```

The same compose hardening applies on an LXC or a VM: `read_only` rootfs, `cap_drop: [ALL]`, `security_opt: no-new-privileges`, non-root UID 10001, tmpfs, and resource limits.

## Components

| Service | Role | Image |
|---|---|---|
| **worker** | Polls queue, runs tool loop (`openai` + `httpx` only). Never sees `HA_TOKEN`. | `ghcr.io/kellandamm/homelab-agent-worker` |
| **ha-proxy** | Injects HA + Cloudflare Access headers; allowlists read-only HA paths + `script.notify_kellan`. | `ghcr.io/kellandamm/homelab-agent-ha-proxy` |
| **egress** | Squid allowlist to LLM host and Stremmy host only. | `ghcr.io/kellandamm/homelab-agent-egress` |

Images are published by `.github/workflows/homelab-agent-publish.yml` (path filter `homelab-agent/**` on `main`, plus `workflow_dispatch`). Packages **must stay private**. The workflow sets visibility to private after each push; confirm in GitHub Packages that they did not inherit public visibility from this public repo.

## Pull token (VM 111)

On the host, log in to GHCR with a **read-only** token before `docker compose up`:

- Classic PAT: scope `read:packages` only (no `write:packages`, no repo write).
- Or a fine-grained token with Packages **Read** on these three packages (or the user account).

```bash
echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u kellandamm --password-stdin
```

## Environment

Names only (values live in `env/*.env` on the host, never in git):

| File / var | Used by |
|---|---|
| `WORKER_IMAGE` | compose pin (`name@sha256:...`) |
| `HA_PROXY_IMAGE` | compose pin |
| `EGRESS_IMAGE` | compose pin |
| `QUEUE_URL` | worker |
| `QUEUE_HMAC_KEY_WORKER` | worker |
| `CF_ACCESS_CLIENT_ID` | worker + ha-proxy |
| `CF_ACCESS_CLIENT_SECRET` | worker + ha-proxy |
| `LLM_BASE_URL` | worker |
| `LLM_API_KEY` | worker |
| `LLM_MODEL` | worker |
| `POLL_INTERVAL_MIN_SEC` | worker |
| `POLL_INTERVAL_MAX_SEC` | worker |
| `CONTAINER_STATUS_FILE` | worker (compose sets the path) |
| `HA_UPSTREAM` | ha-proxy (VM 111: `https://ha.stremmy.dev`) |
| `HA_TOKEN` | ha-proxy only |
| `PORT` | ha-proxy (default 8080) |

Stremmy additionally needs `QUEUE_HMAC_KEY_PRODUCER`, `QUEUE_HMAC_KEY_WORKER`, and existing `CF_ACCESS_*` JWT settings. See `env/*.env.example`.

There is **no `DRY_RUN` flag** in this tree. Allowlisting lives only in `ha-proxy`; the worker always talks to `HA_URL=http://ha-proxy:8080` on the internal Docker network and cannot reach HA directly.

## Pin digests

1. After the publish workflow is green, open the run **Summary**.
2. Copy the three `name@sha256:...` lines into `homelab-agent/.env` (see `.env.example`).
3. Compose requires the vars (`${WORKER_IMAGE:?}` / `${HA_PROXY_IMAGE:?}` / `${EGRESS_IMAGE:?}`); it will not start with floating tags.

## Deploy

1. Copy `env/*.env.example` to `env/worker.env` and `env/ha-proxy.env`; fill secrets.
2. Copy `.env.example` to `.env`; pin digests from the workflow summary.
3. Edit `egress/squid.conf` with your Stremmy hostname (and LLM host). Do **not** add the HA hostname — the worker must not reach HA via egress.
4. On the **host** (LXC or VM), create the container status file (read-only mount into the worker):

```bash
mkdir -p /srv/homelab-agent/status
# Example cron — host Docker, not the worker container:
* * * * * docker ps --format json | jq -s '.' > /srv/homelab-agent/status/containers.json
```

5. Ensure Home Assistant has `script.notify_kellan` for notifications.
6. `docker login ghcr.io` (read-only token), then:
   `docker compose -f homelab-agent/compose.yml up -d`

## Smoke tests (from design §5)

- From a debug shell on the agent network: `curl -X POST http://ha-proxy:8080/api/services/light/turn_on` → **403** (upstream must not see the request).
- From worker container: `curl https://example.com` → **fails** (egress deny).
- `docker logs` worker | grep -E 'KEY|TOKEN|SECRET|Authorization` → **0 hits** at INFO.
- Post 10 tasks via `/api/queue`; confirm results and token usage in Stremmy.

## Security notes

- Do **not** mount the Docker socket into the worker. Container status is a host-produced JSON file (Infra Ops interface).
- v1 records approvals only; no executor runs destructive commands.
- Keep GHCR packages private. A public repo does not imply public images.
