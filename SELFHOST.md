# Self-hosting the command center

`apps/server` is a single-container personal dashboard with Notes, Bookmarks, Calendar, Board, Wins, and a scheduled Daily Briefing. Optional Notes questions and weekly Wins summaries use an OpenAI-compatible `/chat/completions` endpoint (including [Command Code Provider API](https://api.commandcode.ai/provider/v1)).

## Quick start

1. Build the image (`docker build -t command-center .`) or publish via your CI.
2. Copy `compose.yml` and `.env.example` (as `.env`), set Cloudflare Access and/or `ADMIN_TOKEN`.
3. `docker compose up -d` and open the site through your tunnel.

The app listens on **8080 inside the container**; compose binds `127.0.0.1:${HOST_PORT}` by default.

## Configuration (environment)

| Variable | Notes |
|---|---|
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | Optional. Enable **Notes space questions** and **weekly Wins summaries**. Example base URL: `https://api.commandcode.ai/provider/v1`. Daily Briefing does not require an LLM. |
| `TODOIST_API_TOKEN` | Optional. [Todoist REST API](https://developer.todoist.com/rest/v2/) token for the **Todoist** panel (today/overdue tasks, quick-add, complete). Without it the panel shows a clear disabled message. |
| `GITHUB_TOKEN` | Optional. Personal access token (classic or fine-grained) for the **GitHub** panel. Public data works without it; the panel degrades gracefully on rate limits. |
| `GITHUB_USERNAME` | GitHub login for open issues/PRs and public events. Default `kellandamm`. |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | Cloudflare Access JWT on every request (`Cf-Access-Jwt-Assertion`). Set both or neither. |
| `ADMIN_TOKEN` | ≥ 24 chars. `Authorization: Bearer …`, or `/?token=…` once (HttpOnly cookie; needs HTTPS). |
| `ALLOW_INSECURE_NO_AUTH=1` | Localhost only. Without any auth setting the server refuses to start. |
| `TZ` | Calendar dates, briefing day boundary, and settings times use this zone. |
| `HOST_PORT` | Compose publish port on loopback. |
| `DATA_DIR` | Default `/data` (Docker volume). |
| `DOCKER_SOCKET` | Optional. Unix path to the Docker Engine API socket (e.g. `/var/run/docker.sock`). When set and readable, the **Server health** panel lists containers (read-only). When unset, host CPU/memory/disk still work; the container section explains that Docker is not configured. |
| `RECALLIO_URL` | Optional. Base URL for the **Recallio search** panel (e.g. `https://recall.gobison.io`). Without it the panel shows a disabled message; the rest of the dashboard is unchanged. |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | Optional **outbound** Cloudflare Access service token. Sent as `CF-Access-Client-Id` / `CF-Access-Client-Secret` when the server calls Recallio behind Access. Set both if Recallio requires them; omit if Recallio is reachable without a service token. |
| `WEATHER_LAT`, `WEATHER_LON` | Optional. Open-Meteo coordinates for the **Weather** panel (no API key). Default **Chicago** (`41.8781`, `-87.6298`) when unset. |
| `ICS_URLS` | Optional. Comma-separated **https** iCal subscription URLs for the **Calendar** panel. When unset, the panel explains how to enable it. Requests use server-side SSRF protection. |
| `MCP_CF_CLIENT_MAP` | **Required** for `/mcp` and the Power Automate webhook. Non-empty JSON: MCP client id → service token id (must match verified JWT `common_name`). If unset, empty, or unknown id → **403**. Invalid JSON prevents startup. |
| `MCP_APP_TOKENS` | JSON map of MCP client id → bearer token (≥ 24 chars). Used with `/mcp` after CF client id checks. |
| `WEBHOOK_SECRET` | ≥ 24 chars. Webhook requires **`X-Webhook-Secret`** plus a verified **`Cf-Access-Jwt-Assertion`** (Access injects this for service tokens). `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` must be set. |
| `HOBIE_POLL_TOKEN` | Optional bearer for Hobie to `GET /api/hobie/tasks` and `POST /api/hobie/claim`. Admin or MCP tokens also work. |
| `MCP_MAX_HOBIE_PENDING` | Max pending Hobie tasks (default 20). |

`/healthz` is unauthenticated and returns `{ ok, version }` only.

### MCP and webhooks

External agents connect to **`/mcp`** (Streamable HTTP) through Cloudflare Access. The server verifies **`Cf-Access-Jwt-Assertion`** against your team JWKS (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`), reads the service token id from JWT **`common_name`**, maps it via **`MCP_CF_CLIENT_MAP`**, then checks the matching **`MCP_APP_TOKENS`** bearer. The raw `CF-Access-Client-Id` header is **not** trusted. Webhooks use the same JWT checks plus **`X-Webhook-Secret`**. Tools: `notes_read`, `notes_append`, `panel_post_update`, `todoist_add_task`, `hobie_queue_task`.

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

The search accepts JSON either as an array of hits or as `{ results | items | memories | data: [...] }`. Each item may use Recallio-style fields (`content`, `similarityScore`) or generic ones (`title`, `snippet`, `url`, `score`). If your instance uses a different path or method, adjust `apps/server/src/recallio/client.ts` or open an issue with the expected contract.

## Data layout (`/data`)

- `settings.json` — daily briefing time, sidebar tabs, and view preferences
- `rss.sqlite` — Board cards/events and Wins, including weekly summaries (WAL mode); the legacy filename is retained to preserve existing records
- `daily-briefings/` — per-day calendar, weather, tasks, GitHub, Board activity, and Wins snapshots
- `state.json` — scheduler timestamps
- `knowledge.json` — individual Markdown notes, captured links, tags, and personal spaces
- `bookmarks.json` — separate bookmark groups, ordered links, and launchpad layout preferences
- `notes.md` — legacy plain-Markdown Notes file; its contents are copied into the knowledge store on first startup and the original file is kept as a backup
- `panel-updates.json` — **Activity** panel (agent updates via MCP/webhook)
- `hobie-queue.json` — **Hobie queue** (tasks for the owner assistant)

Back up the volume to keep Board, Wins, briefings, and personal knowledge. The Notes page can export an ordinary Markdown bundle or a complete JSON backup; JSON imports merge records without overwriting existing entries.

### Daily Briefing and removed integrations

Settings controls the daily briefing time (default `06:00`, using `TZ`). The briefing retains calendar, weather, Todoist tasks, GitHub activity, Board blockers/moves, and yesterday's wins. It does not fetch news or request AI news summaries.

News, RSS/OPML import and polling, article actions, Summaries, and AI Security publishing/archive APIs have been removed, including their scheduled jobs and publish-only credentials. Remove obsolete `AI_SECURITY_TOKEN` values from deployment secrets and stop any external jobs posting roundups; those endpoints now return 404 for authenticated requests.

Existing archives are not automatically erased. Old `feeds.json`, `feeds.json.migrated`, `news-prefs.json`, `briefing.json`, and `ai-security/` data is no longer read or written. Legacy Daily Briefing files remain on disk, but responses omit retired news and AI sections. Old News/Summaries/AI Security sidebar entries and settings are ignored and omitted when settings are next saved. Legacy news tables in `rss.sqlite` are untouched and unused; **do not delete this database**, because it also contains Board and Wins. Back up first before manually removing obsolete files or tables.

Run `pnpm --filter @homepage/server test:personal-dashboard-browser` for the retained Dashboard, Settings, and Daily Briefing workflow (requires Playwright Chromium).

### Writing in Notes

The writing-first Notes workspace takes inspiration from [Tagdown](https://github.com/sthix/tagdown): a searchable note library, Source / Split / Preview views, a Markdown formatting toolbar, and focus mode. Existing notes, spaces, captured links, Board/Calendar references, graph, and imports/exports remain available; properties and secondary tools are collapsed until needed.

Edits autosave to the server after 900 ms without typing. Save status distinguishes pending changes, successful writes, and failures. Switching notes waits for pending saves; a failed save keeps the current draft open. Leaving with unsaved changes prompts a warning. This requires a connection to the server; it is not an offline vault or version-history system.

Use Ctrl/Cmd+S to save immediately, Ctrl/Cmd+1/2/3 for Source/Split/Preview, Ctrl/Cmd+B or I to format selected text, and Ctrl/Cmd+Shift+F to toggle focus mode (Escape exits). Narrow screens stack Split panes. Task checkboxes in the preview are read-only; edit their Markdown in Source. Preview rendering stays on your server, sanitizes HTML, and does not load remote images.

The dedicated writing-workflow regression runs with `pnpm --filter @homepage/server test:notes-browser` (requires the Playwright Chromium browser installed via `pnpm --filter @homepage/server exec playwright install chromium`).

Questions in a personal space use the configured LLM and include up to 24,000 characters of source text, titles, URLs, and separators. Only sources included in that context are returned as citations. Each knowledge store allows up to 10 questions per hour.

### Calendar workspace

The read-only `/calendar` workspace is inspired by Fantastical's information layout: mini-month navigation, a period agenda, Day/Week/Month views, a Today shortcut, event search, and color-coded calendar filters. Choose an event to read its dates, location, description, and optional HTTP/HTTPS event link. Existing `ICS_URLS` and `ICS_LOCAL_FILES` subscriptions remain the data source; configure calendars on the server rather than inside the page. Calendar names use `X-WR-CALNAME` when supplied, with generic names as fallback.

Dates and times use the server's `TZ` (shown above the calendar), including each event's `TZID` when supplied. All-day and overnight events span their occupied dates; all-day `DTEND` is exclusive. Week starts follow Settings' existing Monday/Sunday preference. Week/day timelines display overlapping events side by side; small screens scroll the timeline horizontally and keep an agenda above it. Calendar filters and the selected view are temporary page state.

The page requests the displayed date range, including past dates, rather than the dashboard's default 12 upcoming events. `/api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD` accepts an exclusive end date, at most 62 days, and returns at most 2,000 events with an explicit truncation warning. The dashboard's existing horizon-based API remains compatible. Failed feeds and refresh failures are shown explicitly.

This is not a Fantastical service integration: event creation/editing, account synchronization, scheduling, and natural-language entry are not included. The existing lightweight ICS parser reads explicit VEVENT occurrences; it does not expand RRULE recurrence rules. Use feeds that include individual occurrences when recurring instances are needed. Run `pnpm --filter @homepage/server test:calendar-browser` for the dedicated browser regression.

### Bookmarks launchpad

The separate `/bookmarks` page is inspired by [Tinypad](https://www.tinypad.app/): grouped quick-access links, instant search, and a responsive grid. It does not change Dashboard or Notes' captured links. Create and rename groups, add/edit/remove links, move links between groups in the edit dialog, and reorder groups or links using their Manage menus. Only empty groups can be deleted.

Layout & files saves comfortable/compact spacing and 1-4 columns to the server (narrow screens reduce columns automatically). Import a Netscape-style browser bookmarks HTML export from Chrome, Edge, Firefox, or Safari, or restore a Bookmarks JSON backup. Folder paths become group names; imports merge matching group names and skip duplicate URLs within each group. Imports are limited to 5 MB, 100 groups and 5,000 links including existing records; invalid JSON imports fail without partial changes. HTML imports skip unsupported URL schemes and report the count. Only HTTP/HTTPS links without embedded credentials are accepted.

Links open in new tabs. Site initials replace remotely fetched favicons: the launchpad does not contact bookmarked sites or third-party icon services until you open a link. Back up `bookmarks.json` with your data volume, or use Download backup on the page. This is a server-backed launchpad, not automatic browser synchronization.

Run the dedicated browser workflow with `pnpm --filter @homepage/server test:bookmarks-browser` (uses the same Playwright Chromium installation as the Notes regression).

## Security

- Auth on every route except `/healthz`; writes need same-origin `Origin` and `x-ah: 1` (CSRF).
- Calendar subscriptions and other outbound URLs use server-side SSRF checks (public IPs only, DNS re-checked).
- Container runs as non-root with capabilities dropped (`compose.yml`).

## Cloudflare tunnel + Access

1. Run compose so the app is on `127.0.0.1:8088` (or your `HOST_PORT`).
2. Tunnel public hostname → `http://localhost:8088`.
3. Protect the hostname with Access; set `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN`.

## Adding a dashboard panel

1. Create `apps/server/src/panels/your-panel.ts` exporting a `PanelModule` (`id`, `title`, `dashboardHtml`, optional `handle` for API routes).
2. Register it in `apps/server/src/panels/registry.ts`.
3. If the panel needs client-side behavior, add a small script from `ui/pages.ts` (see the calendar and daily briefing panels).

## Development

```bash
pnpm install
pnpm --filter @homepage/server test
pnpm --filter @homepage/server typecheck
ALLOW_INSECURE_NO_AUTH=1 DATA_DIR=./data pnpm --filter @homepage/server dev
```
