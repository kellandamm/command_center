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
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | Cloudflare Access JWT on every request (`Cf-Access-Jwt-Assertion`). Set both or neither. |
| `ADMIN_TOKEN` | ≥ 24 chars. `Authorization: Bearer …`, or `/?token=…` once (HttpOnly cookie; needs HTTPS). |
| `ALLOW_INSECURE_NO_AUTH=1` | Localhost only. Without any auth setting the server refuses to start. |
| `TZ` | Feed fetch schedule, briefing day boundary, and settings times use this zone. |
| `HOST_PORT` | Compose publish port on loopback. |
| `DATA_DIR` | Default `/data` (Docker volume). |

`/healthz` is unauthenticated and returns `{ ok, version }` only.

## Data layout (`/data`)

- `settings.json` — feed list, fetch interval, briefing time
- `feeds.json` — cached items and per-feed fetch status
- `briefing.json` — latest briefing and short history
- `state.json` — scheduler timestamps

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
