# Self-hosting the command center

`apps/server` is a single-container personal dashboard: pluggable panels, RSS/Atom news feeds (fetched on a schedule, stored on disk), and an optional daily AI briefing via any OpenAI-compatible `/chat/completions` endpoint (including [Command Code Provider API](https://api.commandcode.ai/provider/v1)).

## Quick start

1. Build the image (`docker build -t command-center .`) or publish via your CI.
2. Copy `compose.yml` and `.env.example` (as `.env`), set Cloudflare Access and/or `ADMIN_TOKEN`.
3. `docker compose up -d` and open the site through your tunnel.

The app listens on **8080 inside the container**; compose binds `127.0.0.1:${HOST_PORT}` by default.

## Configuration (environment)

| Variable | Notes |
|---|---|
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | Optional. When all three are set, the **AI briefing** panel can generate summaries. Example base URL: `https://api.commandcode.ai/provider/v1`. Without them the dashboard still runs; briefing shows a clear disabled message. |
| `TODOIST_API_TOKEN` | Optional. [Todoist REST API](https://developer.todoist.com/rest/v2/) token for the **Todoist** panel (today/overdue tasks, quick-add, complete). Without it the panel shows a clear disabled message. |
| `GITHUB_TOKEN` | Optional. Personal access token (classic or fine-grained) for the **GitHub** panel. Public data works without it; the panel degrades gracefully on rate limits. |
| `GITHUB_USERNAME` | GitHub login for open issues/PRs and public events. Default `kellandamm`. |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | Cloudflare Access JWT on every request (`Cf-Access-Jwt-Assertion`). Set both or neither. |
| `ADMIN_TOKEN` | ≥ 24 chars. `Authorization: Bearer …`, or `/?token=…` once (HttpOnly cookie; needs HTTPS). |
| `ALLOW_INSECURE_NO_AUTH=1` | Localhost only. Without any auth setting the server refuses to start. |
| `TZ` | Feed fetch schedule, briefing day boundary, and settings times use this zone. |
| `HOST_PORT` | Compose publish port on loopback. |
| `DATA_DIR` | Default `/data` (Docker volume). |
| `DOCKER_SOCKET` | Optional. Unix path to the Docker Engine API socket (e.g. `/var/run/docker.sock`). When set and readable, the **Server health** panel lists containers (read-only). When unset, host CPU/memory/disk still work; the container section explains that Docker is not configured. |
| `RECALLIO_URL` | Optional. Base URL for the **Recallio search** panel (e.g. `https://recall.gobison.io`). Without it the panel shows a disabled message; the rest of the dashboard is unchanged. |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | Optional **outbound** Cloudflare Access service token. Sent as `CF-Access-Client-Id` / `CF-Access-Client-Secret` when the server calls Recallio behind Access. Set both if Recallio requires them; omit if Recallio is reachable without a service token. |
| `WEATHER_LAT`, `WEATHER_LON` | Optional. Open-Meteo coordinates for the **Weather** panel (no API key). Default **Chicago** (`41.8781`, `-87.6298`) when unset. |
| `ICS_URLS` | Optional. Comma-separated **https** iCal feed URLs for the **Calendar** panel. When unset, the panel explains how to enable it. Feeds are fetched server-side with the same SSRF rules as RSS. |
| `MCP_CF_CLIENT_MAP` | **Required** for `/mcp` and the Power Automate webhook. Non-empty JSON: MCP client id → inbound **service token** `CF-Access-Client-Id`. If unset, empty, or unknown id → **403** (no app token / webhook secret alone). Invalid JSON prevents startup. |
| `MCP_APP_TOKENS` | JSON map of MCP client id → bearer token (≥ 24 chars). Used with `/mcp` after CF client id checks. |
| `WEBHOOK_SECRET` | ≥ 24 chars. `POST /api/webhooks/power-automate` requires **`X-Webhook-Secret` and `CF-Access-Client-Id`** (create a dedicated Access service token for Power Automate). |
| `HOBIE_POLL_TOKEN` | Optional bearer for Hobie to `GET /api/hobie/tasks` and `POST /api/hobie/claim`. Admin or MCP tokens also work. |
| `MCP_MAX_HOBIE_PENDING` | Max pending Hobie tasks (default 20). |

`/healthz` is unauthenticated and returns `{ ok, version }` only.

### MCP and webhooks

External agents (e.g. work Copilot) connect to **`/mcp`** (Streamable HTTP) through Cloudflare Access with a **per-client service token** (`CF-Access-Client-Id` must appear in `MCP_CF_CLIENT_MAP`) plus the matching **`MCP_APP_TOKENS`** bearer. Tools: `notes_read`, `notes_append`, `panel_post_update`, `todoist_add_task`, `hobie_queue_task`. If IT blocks custom MCP connectors, use **`POST /api/webhooks/power-automate`** with the same **service token headers**, `X-Webhook-Secret`, and JSON `{ "action": "…", … }`.

### Server health panel (optional Docker socket)

Host metrics (CPU load and utilization estimate, memory, disk use on `DATA_DIR`) work without Docker.

To show **container status** on the same machine as the dashboard, mount the Engine socket **read-only** and set `DOCKER_SOCKET`:

```yaml
environment:
  DOCKER_SOCKET: /var/run/docker.sock
volumes:
  - homepage-data:/data
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

The server only issues **GET** requests to `/containers/json` and `/version`. There is no start/stop/restart UI or API.

**Security trade-off:** A read-only *filesystem* mount on the socket does **not** make the Docker API read-only. Any process that can talk to `docker.sock` can typically control containers and often the host. Treat socket access like root on the Docker host. Prefer running the dashboard on a trusted admin host and keep auth (Cloudflare Access / `ADMIN_TOKEN`) strict.

**Recommended (optional): [docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy)** — not enabled in the default `compose.yml`. When you want container status without giving the app the raw Engine socket, add a sidecar and point `DOCKER_SOCKET` at the proxy’s HTTP-over-Unix socket:

```yaml
services:
  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy:latest
    restart: unless-stopped
    environment:
      CONTAINERS: 1
      INFO: 1
      # Leave everything else at 0 (default) — no POST/start/stop/exec.
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks: [internal]

  homepage:
    # …existing homepage service…
    environment:
      DOCKER_SOCKET: /var/run/docker.sock
    volumes:
      - homepage-data:/data
      - docker-socket:/var/run/docker.sock
    depends_on: [docker-socket-proxy]
    networks: [internal]

volumes:
  homepage-data:
  docker-socket:

networks:
  internal:
```

Mount the proxy’s socket into the homepage container (exact path depends on how you wire the shared volume; some setups use a TCP URL to the proxy instead). The server only issues **GET** `/containers/json` and `/version`; the proxy should deny all mutating routes.

### Recallio API assumption

The private **kellan-damm/Recallio** repo was not available from this environment, so the panel calls:

`POST {RECALLIO_URL}/api/search` with JSON body `{ "q": "<query>", "limit": 10 }`

and accepts JSON either as an array of hits or as `{ results | items | memories | data: [...] }`. Each item may use Recallio-style fields (`content`, `similarityScore`) or generic ones (`title`, `snippet`, `url`, `score`). If your instance uses a different path or method, adjust `apps/server/src/recallio/client.ts` or open an issue with the expected contract.

## Data layout (`/data`)

- `settings.json` — feed list, fetch interval, briefing time
- `feeds.json` — cached items and per-feed fetch status
- `news-prefs.json` — tagged news view: muted topics and focus chips
- `briefing.json` — latest briefing and short history
- `state.json` — scheduler timestamps
- `notes.md` — dashboard **Notes** panel (plain markdown)
- `panel-updates.json` — **Activity** panel (agent updates via MCP/webhook)
- `hobie-queue.json` — **Hobie queue** (tasks for the owner assistant)

Back up the volume to keep feeds, read state, and briefings.

## Security

- Auth on every route except `/healthz`; writes need same-origin `Origin` and `x-ah: 1` (CSRF).
- Feed URLs are fetched server-side with SSRF checks (public IPs only, DNS re-checked).
- Container runs as non-root with capabilities dropped (`compose.yml`).

## Cloudflare tunnel + Access

1. Run compose so the app is on `127.0.0.1:8088` (or your `HOST_PORT`).
2. Tunnel public hostname → `http://localhost:8088`.
3. Protect the hostname with Access; set `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN`.

## Adding a dashboard panel

1. Create `apps/server/src/panels/your-panel.ts` exporting a `PanelModule` (`id`, `title`, `dashboardHtml`, optional `handle` for API routes).
2. Register it in `apps/server/src/panels/registry.ts`.
3. If the panel needs client-side behavior, add a small script from `ui/pages.ts` (see the feeds and briefing panels).

## Development

```bash
pnpm install
pnpm --filter @homepage/server test
pnpm --filter @homepage/server typecheck
ALLOW_INSECURE_NO_AUTH=1 DATA_DIR=./data pnpm --filter @homepage/server dev
```
