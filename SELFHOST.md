# Self-hosting the command center

`apps/server` is a single-container personal dashboard with Notes, Read Later, Spaces, Agent, Bookmarks, Calendar, and a scheduled Daily Briefing. Agent brings Board, Hobie Queue, Wins, Assistant, and Activity into a single tabbed destination. Chrome capture saves selected pages; optional summaries and cited answers use an OpenAI-compatible `/chat/completions` endpoint (including [Command Code Provider API](https://api.commandcode.ai/provider/v1)).

## Quick start

1. Build the image (`docker build -t command-center .`) or publish via your CI.
2. Copy `compose.yml` and `.env.example` (as `.env`), set Cloudflare Access and/or `ADMIN_TOKEN`.
3. `docker compose up -d` and open the site through your tunnel.

The app listens on **8080 inside the container**; compose binds `127.0.0.1:${HOST_PORT}` by default.

## Configuration (environment)

| Variable | Notes |
|---|---|
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | Optional. Enable Notes space questions, saved-article summaries, weekly Wins summaries, and keyword briefing digests. Example base URL: `https://api.commandcode.ai/provider/v1`. Weather and calendar do not require an LLM. |
| `BRAVE_SEARCH_API_KEY` | Optional. Enables fresh keyword lookups for Daily Briefing through Brave Search. Topic summaries also require the LLM settings above. Set an environment default or an encrypted override in Settings. |
| `OWNER_EMAILS` | Comma-separated owner email allowlist, matched against verified human Cloudflare Access JWTs. Required for service connection management; ordinary users, machine identities, and admin-token logins cannot manage keys. |
| `CONNECTIONS_MASTER_KEY` | Optional until saving connections. Exactly 64 hexadecimal characters (32 random bytes). Encrypts provider overrides at rest; keep a separate secure backup. Existing encrypted data prevents startup if the key is missing/wrong. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google OAuth web-client credentials. The client secret is deployment-managed and never shown in Settings. |
| `GOOGLE_REDIRECT_URI` | Exact HTTPS OAuth callback registered in Google Cloud Console, e.g. `https://your-domain.example/api/google-calendar/callback` (HTTP localhost is allowed for development). |
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

### Managing service credentials in Settings

Set `OWNER_EMAILS` and `CONNECTIONS_MASTER_KEY` in the deployment, restart, and sign in through Cloudflare Access with an allowed email. Open **Settings > Manage service connections and keys**. Adapters support AI summaries, Brave Search, GitHub, Todoist, and Recallio (including its optional outbound Access pair).

To connect Google Calendar, configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the exact callback URI `GOOGLE_REDIRECT_URI` in Google Cloud Console and the deployment. The app requests calendar-list read access and event read/write access; each selected calendar is synced into the shared Calendar view. Google tokens and selected calendar IDs are stored in the encrypted connection vault, not in `calendars.json`. The calendar editor allows event edits only when Google reports writer/owner access. Updates and deletes send the Google ETag as an `If-Match` precondition; a concurrent edit returns a conflict and is not overwritten. Recurring series and local note/Space/task links are not editable through the Google event form yet. Disconnect revokes the Google refresh token before removing the encrypted connection.

Inputs are write-only: blank preserves the current value. Responses show configured/source metadata, not secret values or existing URLs. Saved fields override their environment defaults; **Remove saved settings** deletes the override and restores defaults. **Disconnect** disables that provider even if environment keys exist. Reconnect retains stored fields. Tests make a bounded request to the selected provider and can consume quota; an access check does not guarantee every operation or model is available.

Credentials are stored separately in `connections.enc.json` using AES-256-GCM with a random nonce and authenticated format version. Ordinary Settings and knowledge exports do not include them. Runtime consumers use the effective configuration without restarting; already-started remote requests cannot be recalled when credentials are disconnected.

Provider URLs entered in Settings must be public HTTPS endpoints without embedded credentials, query strings or fragments. Existing deployment-managed private/local model configurations are not changed, but cannot be introduced through this UI. Outbound network isolation is still recommended because DNS may change between address validation and connection.

**Backup and recovery:** back up the encrypted vault with the data volume and keep the matching master key separately in a secret manager. Restoring the data requires that exact key; there is no recovery backdoor and startup will not silently replace an unreadable vault. Do not publish the key or vault in issues or ordinary workspace exports.

**Rotation:** no online master-key rotation UI is provided yet. To rotate, securely record/retrieve the provider credentials and private subscription URLs from their issuers, stop the application, retain the old encrypted vault and key together as a protected backup, remove only `connections.enc.json`, set a newly generated master key, restart, and re-enter the provider credentials. Remove/reconnect managed ICS subscriptions to restore their private URLs; native calendars/events remain intact. Removing the vault restores environment defaults, so check those before restarting. Revoke provider keys at the issuer if compromised; removing a stored override alone does not revoke its remote credential.

Owner identities, the encryption master key, inbound machine credentials, and authentication/bootstrap settings stay deployment-managed. Do not give agents the owner session or access to the data volume/master key.

### Writing and restoring Notes

Notes now opens in **Write**, a directly editable formatted document. Source, Split, and read-only Preview remain available. Formatting includes headings, emphasis, lists/checklists, quotes, links, code, tables, and undo/redo. Existing wiki links remain connected across formatted edits. Unsupported content such as raw HTML, images, frontmatter or footnotes opens in Source instead of silently losing markup. Markdown remains the stored/exported format; formatted editing may normalize whitespace and Markdown delimiters.

Saved note links use `?note=<id>` and reopen that note. A missing note displays an explicit not-found message rather than selecting an unrelated document. **Version history > Load versions** shows the previous 20 saves per note with text previews and conditional restore. Restoring creates a new save; deleting a note also removes its history. Histories count toward the existing 20 MB knowledge-store limit and are included in JSON backups (Markdown export includes current text only).

**Finding and organizing notes:** the library switches between active, pinned, recently opened (this page session), and archived notes, with tag and Space filters. Open documents appear in up to ten tabs; **Switch note** (`Ctrl/Cmd + K`) searches titles, including archived notes, with arrow-key navigation. Rename directly in the title; move with Note properties. **Document tools** contains pin/archive/restore, duplicate, and meeting/daily-plan/research templates. Templates append to the current note and do not overwrite existing text; the meeting template includes an event-link field. Duplicates are independent, unpinned active notes. Pin/archive changes are versioned and included in JSON backups/history. Archive is an organization filter, not an access-control or AI-retrieval exclusion.

**Editing tools:** type `/` in an empty formatted paragraph to choose a heading, list, checklist, quote, code block, or table. Arrow Down enters the command list; Escape dismisses it without removing the literal slash. **Find & replace** (`Ctrl/Cmd + F`) performs literal, case-sensitive searches in Markdown source and switches to Source to show the selected match. Replacements can affect link URLs and formatting; Replace all asks for confirmation, uses literal replacement text (not regex substitution), and refuses oversized results. Changes use normal autosave/history.

**Recovery and conflicting edits:** browser recovery is off by default. Enable it under **Draft recovery** only on a trusted browser profile: copies are not encrypted and contain private note text. It retains up to 20 drafts/2 MB total for seven days, pruned on the next recovery access. Failed/quota-denied storage is reported explicitly; do not assume a recovery copy exists when a warning is shown. Successfully saved copies are removed, and disabling recovery removes this site's recovery drafts from that profile. Browser drafts are not server backups and do not sync across devices.

Recovering a browser draft never automatically sends it to the server; review and explicitly Save note. Its original base version is retained, so recovery cannot silently overwrite a newer server edit. **Review latest saved version** pauses autosave, displays the server's current Markdown and properties alongside the still-editable draft, and offers **Save reviewed draft** for a manual merge or **Discard draft and use latest**. Both replacement/discard actions require confirmation. Saving checks the exact reviewed version again; a further concurrent edit still returns a conflict. Close comparison keeps autosave paused until an explicit save. Initial load failures expose a retry action instead of leaving disabled controls without recovery.

The editor sends a version with each update; a conflicting save returns HTTP 409 without replacing the draft. Copy your draft before reloading and merge it with the latest version. Legacy clients that omit the version retain their existing behavior, but their writes advance versions so the editor detects them. Autosave still requires server connectivity; this is not a full offline editor.

Build before running the Notes browser checks or starting development with formatted editing: `pnpm --filter @homepage/server build`. The production server embeds the browser editor bundle, so no CDN or additional runtime files are needed.

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
- `rss.sqlite` — Board cards/events and Wins, including weekly summaries (WAL mode); legacy starred articles and summaries are copied into Read later at startup without modifying the original tables
- `daily-briefings/` — per-day calendar, weather, and keyword digest snapshots (older files are preserved)
- `state.json` — scheduler timestamps
- `capture-access.json` — SHA-256 hash of the Chrome capture token (create or revoke it at `/settings/capture`)
- `knowledge.json` — individual Markdown notes, captured links, tags, and personal spaces
- `bookmarks.json` — separate bookmark groups, ordered links, and launchpad layout preferences
- `calendars.json` — managed calendar metadata, native events/recurrence, versions, and hashes of opt-in sharing keys (not private feed URLs)
- `connections.enc.json` — encrypted service overrides and private subscription URLs; restore together with the separately backed-up `CONNECTIONS_MASTER_KEY`
- `notes.md` — legacy plain-Markdown Notes file; its contents are copied into the knowledge store on first startup and the original file is kept as a backup
- `panel-updates.json` — **Activity** panel (agent updates via MCP/webhook)
- `hobie-queue.json` — **Hobie queue** (tasks for the owner assistant)

Back up the volume to keep Board, Wins, briefings, and personal knowledge. The Notes page can export an ordinary Markdown bundle or a complete JSON backup; JSON imports merge records without overwriting existing entries.

### Daily Briefing and removed integrations

Settings controls the daily briefing time (default `06:00`, using `TZ`). Daily Briefing contains weather, calendar, and a keyword digest. Todoist, GitHub activity, and Agent board/wins sections are no longer generated or displayed in briefings; the separate Agent workflows remain unchanged.

In **Settings → Briefing topics**, enter one keyword or phrase per line (up to 10, each 120 characters). Topics are shared server settings, saved in `settings.json`. Clear the field to disable keyword lookups. Set `BRAVE_SEARCH_API_KEY` and the three `LLM_*` variables in the deployment environment, then recreate the container (for Compose, `docker compose up -d`). Settings reports whether those providers are configured without exposing keys.

Each scheduled edition searches Brave's web index for results from the past 24 hours and summarizes up to three distinct sources per topic using their search excerpts, not full articles. Digests include numbered source links. Keywords go to Brave; keywords and returned excerpts go to your configured LLM provider. Provider quotas, charges, and occasional incomplete indexing apply. No RSS subscriptions are created, and results are not automatically added to Read Later.

Saved topics apply to the next daily run. **Refresh edition** starts a background lookup and replaces today's snapshot; the page checks progress without keeping a long HTTP request open. Concurrent refreshes share one generation. Empty searches and per-topic errors are displayed explicitly, with source links retained if summarization fails. Scheduled source errors retry once after 30 minutes. Old archive files are not rewritten, and removed sections are omitted when they are read. The page opens today's date in the configured timezone, even if no edition exists yet, rather than silently opening an old edition.

RSS/OPML import and polling, article actions, legacy Summaries APIs, and AI Security publishing/archive APIs have been removed, including their scheduled jobs and publish-only credentials. News and Summaries page URLs redirect to filtered views in Read Later. Remove obsolete `AI_SECURITY_TOKEN` values from deployment secrets and stop any external jobs posting roundups; those API endpoints now return 404 for authenticated requests.

Existing archives are not automatically erased. Old `feeds.json`, `feeds.json.migrated`, `news-prefs.json`, `briefing.json`, and `ai-security/` data is no longer read or written. Legacy Daily Briefing files remain on disk, but responses omit retired news and AI sections. Old News/Summaries/AI Security sidebar entries and settings are ignored and omitted when settings are next saved. Legacy news tables in `rss.sqlite` are read only for the idempotent saved-article migration; **do not delete this database**, because it also contains Board and Wins. Back up first before manually removing obsolete files or tables.

Run `pnpm --filter @homepage/server test:personal-dashboard-browser` for the retained Dashboard, Settings, and Daily Briefing workflow (requires Playwright Chromium).

### Writing in Notes

The writing-first Notes workspace takes inspiration from [Tagdown](https://github.com/sthix/tagdown): a searchable note library, Source / Split / Preview views, a Markdown formatting toolbar, and focus mode. Existing notes, spaces, captured links, Board/Calendar references, graph, and imports/exports remain available; properties and secondary tools are collapsed until needed.

Edits autosave to the server after 900 ms without typing. Save status distinguishes pending changes, successful writes, and failures. Switching notes waits for pending saves; a failed save keeps the current draft open. Leaving with unsaved changes prompts a warning. This requires a connection to the server; it is not an offline vault or version-history system.

Use Ctrl/Cmd+S to save immediately, Ctrl/Cmd+1/2/3 for Source/Split/Preview, Ctrl/Cmd+B or I to format selected text, and Ctrl/Cmd+Shift+F to toggle focus mode (Escape exits). Narrow screens stack Split panes. Task checkboxes in the preview are read-only; edit their Markdown in Source. Preview rendering stays on your server, sanitizes HTML, and does not load remote images.

The dedicated writing-workflow regression runs with `pnpm --filter @homepage/server test:notes-browser` (requires the Playwright Chromium browser installed via `pnpm --filter @homepage/server exec playwright install chromium`).

Read Later (still available at `/library` for compatibility) is the single home for saved links. All saved includes everything; Inbox shows unarchived links; Summarized shows links with a summary; Archived keeps finished reading out of the queue without deleting it. Compact is the default layout; List and Cards remain available. Each page shows at most 50 articles, with Previous/Next navigation. Filters, sort, layout, and page number are preserved in the URL.

The folder/tag sidebar uses existing Spaces as folders, shared with Notes and Assistant, not a separate folder system. Create a folder there, choose a folder and tags when saving, or use Organize on any article to move it and edit tags without changing its summary. Search titles, URLs, captured text, summaries and tags. Existing `/read-later`, `/news`, and `/summaries` links redirect into Read Later; saved-link APIs and Chrome capture remain compatible.

Pages are saved only when you press Save or Save & summarize in the extension (or Read Later). Summarize is also available on each unsummarized link and in its reading view, alongside folder assignment, tags, Assistant, and note/task creation. The extension sends the page URL, title, and up to 20,000 characters of selected or readable text; the capture token can only save pages and cannot read your library. Download the extension from `/settings/capture`, unzip it, and load it unpacked in Chrome.

Agent (`/agent`) opens Board by default. Its tabs use `?view=board|queue|wins|assistant|activity`. The Queue tab lists pending, claimed and completed Hobie tasks and can mark them done, using the existing board/wins synchronization. Legacy `/board`, `/hobie`, `/wins`, `/assistant`, and `/activity` links redirect to their Agent tab; source/space query parameters are retained for Assistant. Existing APIs are unchanged, and personalized Agent sidebar settings take precedence over legacy tab settings.

Questions in the Assistant, a space, or a saved page use the configured LLM and include up to 24,000 characters of source text, titles, URLs, and separators. Only sources included in that context are returned as citations. Each knowledge store allows up to 10 questions per hour.

### Calendar workspace

The `/calendar` workspace has mini-month navigation, a period agenda, Day/Week/Month views, a Today shortcut, event search, and color-coded calendar filters. **Settings > Calendars** adds named/color-coded Command Center calendars or existing HTTPS ICS subscriptions. Deployment-managed `ICS_URLS` and `ICS_LOCAL_FILES` continue to work. Private subscription URLs require the encrypted connection vault and are never returned in metadata, errors, or ordinary exports.

**New event** creates a native event; select a native event and choose **Edit event** to change or delete it. These mutations require a verified owner login, not an admin/machine token. Events support explicit IANA timezones, all-day exclusive end dates, location/description, and optional Note/Space links. Daily, weekly, and monthly repeats require an end date within 366 days. Edits/deletions affect the whole series; monthly overflow dates and nonexistent spring-forward times are skipped, while repeated fall-back times use the earlier occurrence. Timed recurrence preserves the start wall time and elapsed duration. Concurrent edits return a conflict without overwriting the form's draft. Notes links and the shared Calendar/Dashboard/Briefing service use the same native records.

Native calendars can import up to 100 explicit non-recurring events per `.ics` file (1 MB), with duplicate title/start pairs skipped. Imports reject invalid dates, cancelled events, unsupported recurrence/duration-only events, and missing timed end dates without partial writes. Export downloads all native events, including paused calendars; bounded recurrence is exported as explicit occurrences so external clients do not shift local start times across DST.

Read-only sharing is **off by default**. Enabling sharing returns a bearer-capability URL once; anyone holding it can read every event's title, location, and description in that native calendar. Only its SHA-256 hash is stored. Replace or revoke the link in Settings; pausing a calendar suspends the feed until re-enabled. External applications may cache already-downloaded events and refresh slowly. Provider calendars are never republished automatically.

Behind Cloudflare Access, configure an edge exception **only** for `/feeds/calendars/*.ics` if external clients must subscribe. The app independently validates the calendar/token and returns 404 for absent or revoked capabilities. Never bypass authentication for the whole app. Redact query strings in reverse-proxy/edge logs, protect copied subscription links like credentials, and remember that downloaded exports may contain private event text. Ordinary Notes backups do not include calendars or encrypted connection data; back up the data volume and master key separately.

Dates and times use the server's `TZ` (shown above the calendar), including each event's `TZID` when supplied. All-day and overnight events span their occupied dates; all-day `DTEND` is exclusive. Week starts follow Settings' existing Monday/Sunday preference. Week/day timelines display overlapping events side by side; small screens scroll the timeline horizontally and keep an agenda above it. Calendar filters and the selected view are temporary page state.

The page requests the displayed date range, including past dates, rather than the dashboard's default 12 upcoming events. `/api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD` accepts an exclusive end date, at most 62 days, and returns at most 2,000 events with an explicit truncation warning. The dashboard's existing horizon-based API remains compatible. Failed feeds and refresh failures are shown explicitly.

Google Calendar OAuth and conflict-aware event editing are available when configured above. ICS subscriptions remain read-only; the lightweight parser reads explicit VEVENT occurrences and does not expand external RRULE series. Use feeds with individual occurrences when recurring instances are needed. Native recurrence is handled by the managed calendar store. Run `pnpm --filter @homepage/server test:calendar-browser` for the calendar-view and native-editing browser regressions (set `BROWSER_CHANNEL=msedge` when using installed Edge).

#### Board task planning and native time blocks

Calendar's **Task inbox** reads the same Board cards as Agent > Board. Quick capture creates a Backlog card through the existing Board API; **Plan / edit task** opens task details and the native event form. Board cards retain their original IDs and Queue/Wins relationships. The existing SQLite database gains additive, restart-safe columns for estimated minutes (optional integer, 1-1440), a date-only deadline, low/normal/high priority, and a version counter. Task details and completion in the planning form send `expectedVersion`; stale updates return 409 without overwriting the draft. Legacy Board clients may still omit versions for non-planning updates.

**Save task details** changes only the Board card. **Save event** explicitly reserves native calendar time using that card's `taskId` and `expectedTaskVersion`. Task links are validated against the Board store, never a parallel task repository. Task entry defaults to a native calendar and does not offer Google calendars. Multiple blocks are allowed: creating a new event always creates another reservation, even with the same task/time. Edit an existing block to reschedule it or adjust its start/end/duration; deleting a block leaves its task intact. Completion moves the same card to Done and records the existing deduplicated win; it does not delete reservations, move meetings, or queue/cancel agent execution. No new agent scheduling behavior is introduced.

Unscheduled means an open task has no remaining occurrence on an enabled native calendar. Scheduled/completed tasks remain available in expandable lists, with links to each block, including past and paused-calendar blocks. A removed task leaves its historical blocks visible; choose another task or clear the missing link before saving the event. Event titles do not automatically change when task titles change. Calendar mutations and availability previews retain verified-owner and CSRF checks; ordinary users, admin tokens, and machine credentials cannot write calendars.

Elapsed duration is optional and separate from the task estimate. It uses an explicit IANA timezone, rejects nonexistent spring-forward starts, chooses the earlier repeated fall-back start, and calculates elapsed minutes across clock changes. Existing all-day exclusive-end and recurring-event editing remain supported. **Availability preview** is read-only and checks the first occurrence against enabled native/ICS/selected Google calendars, with editable Monday-Friday working hours and buffers (0-120 minutes). Those controls apply only to the preview, not stored preferences. Incomplete feeds and overlaps are warnings, never automatic scheduling or meeting moves; results can become stale before saving. Google events are neither copied into native storage nor included in native export/sharing.

This focused flow uses keyboard-accessible forms, not drag-to-schedule. Persistent working-hour preferences, daily/weekly capacity summaries, automatic placement suggestions, Notes-to-task extraction, natural-language entry, Fabric/Fastio connectors, and durable agent schedules remain separate follow-ups. No real Google credentials are used by the planning regression tests.

### Bookmarks launchpad

The separate `/bookmarks` page is inspired by [Tinypad](https://www.tinypad.app/): grouped quick-access links, instant search, and a responsive grid. It does not change Dashboard or Notes' captured links. Create and rename groups, add/edit/remove links, move links between groups in the edit dialog, and reorder groups or links using their Manage menus. Only empty groups can be deleted.

Layout & files saves comfortable/compact spacing and 1-4 columns to the server (narrow screens reduce columns automatically). Import a Netscape-style browser bookmarks HTML export from Chrome, Edge, Firefox, or Safari, or restore a Bookmarks JSON backup. Folder paths become group names; imports merge matching group names and skip duplicate URLs within each group. Imports are limited to 5 MB, 100 groups and 5,000 links including existing records; invalid JSON imports fail without partial changes. HTML imports skip unsupported URL schemes and report the count. Only HTTP/HTTPS links without embedded credentials are accepted.

Links open in new tabs. Site initials replace remotely fetched favicons: the launchpad does not contact bookmarked sites or third-party icon services until you open a link. Back up `bookmarks.json` with your data volume, or use Download backup on the page. This is a server-backed launchpad, not automatic browser synchronization.

Run the dedicated browser workflow with `pnpm --filter @homepage/server test:bookmarks-browser` (uses the same Playwright Chromium installation as the Notes regression).

## Security

- Auth on every route except `/healthz`; browser writes need same-origin `Origin` and `x-ah: 1` (CSRF). The Chrome capture token authorizes only `POST /api/capture`, without a browser session.
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
