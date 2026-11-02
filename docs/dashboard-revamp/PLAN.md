# Dashboard revamp plan

## Layout JSON (version 3)

```json
{
  "version": 3,
  "widgets": [
    { "id": "today-agenda", "size": "XL" },
    { "id": "tasks", "size": "W", "config": {} }
  ]
}
```

- **Version:** `3`. Saved layouts with `version` 1–2 are converted from legacy `panels[]` (infer `S|W|L|XL` from `w`/`h`, preserve order by `y`/`x`).
- **Widgets:** ordered array (max **40** entries, max **16 KiB** JSON). Each entry: `id` (known widget), `size` (`S`|`W`|`L`|`XL`), optional `config` (widget-specific, no secrets).
- **Size presets:** `S` = 3×1, `W` = 6×1, `L` = 6×2, `XL` = 12×2 on a **12-column** grid. Positions are derived server-side by flow-packing array order (not stored).
- **Validation:** Zod parse → normalize (drop unknown ids, clamp config) → pack. Invalid or oversize input **falls back to the default layout** for that user (never throws on read/save).

## Storage

- Path: `{DATA_DIR}/dashboard-layouts/{userKey}.json`
- **userKey:** verified Cloudflare Access identity — lowercased `email` from the JWT when present, otherwise `sub` / `who`, sanitized (same principal the app already uses for owner checks).
- Legacy `{DATA_DIR}/dashboard-layout.json` migrates into the default user key on first access.
- **Budget** widget id is omitted from layout, API, and defaults unless the session is owner; budget data never appears in widget HTML, layout JSON, or service-status payloads.

## Existing panels → cards

| Panel id | Default size | Category |
| --- | --- | --- |
| daily-briefing | W | Agenda |
| calendar | W | Agenda |
| weather | S | Agenda |
| today-agenda (new) | XL | Agenda |
| tasks | W | Productivity |
| notes | W | Productivity |
| focus | S | Productivity |
| attention | L | Work |
| heatmap | S | Work |
| launchpad | W | Work |
| activity | W | Agents |
| hobie | W | Agents |
| agents-usage | W | Agents |
| agent-jobs (new) | L | Agents |
| host-health | W | Monitoring |
| service-status (new) | W | Monitoring |
| recallio | W | Info |
| countdown (new) | S | Time |
| world-clock (new) | S | Time |
| budget | W | Finance (owner only) |

Panel bodies are unchanged inside `dashboard-panel-body`; only the shared card chrome (status dot, title, category tag, menu) wraps them.

## Widget catalog (+ Add drawer)

**In drawer:** GitHub activity (`activity`), Weather, Bookmarks (`launchpad`), RSS / briefing (`daily-briefing`), Calendar, Tasks, Notes, Service status, Countdown, World clock, Agent jobs, plus other registered panels not already on the grid.

**Excluded from drawer:** Pomodoro, Habit tracker, Budget (unless owner session).

## Service status (server-only)

- Endpoint: `GET /api/widgets/service-status` (auth required). Checks run server-side with **5s** timeout, **60s** in-memory cache per process.
- Services: **Stremmy** (`GET {APP_PUBLIC_URL or self}/healthz`), **Todoist** (configured token → projects API), **Plaud** (`PLAUD_URL` if set), **Home Assistant** (`HA_URL` + `Authorization: Bearer HA_TOKEN` → `GET /api/`).
- Response per service: `state` (`up`|`down`|`unknown`|`not_configured`), optional `latencyMs`, optional `downFor` label — **no tokens, credential URLs, or error bodies**. Redaction strips any substring matching known secrets before JSON is sent.

## Test plan

1. **Unit:** Zod/layout — valid v3, corrupt JSON, oversize payload, unknown widget id; save/load routes require auth and isolate two user keys; service-status redaction with planted secret; today-agenda “now” marker position for `TZ=America/Chicago` and `TZ=Asia/Tokyo`.
2. **Browser (built tree):** Edit layout → resize to XL → reorder → remove → add World clock → reload persists; drawer lacks Pomodoro/Habit; cards full width at 375px.
3. **Regression:** Existing panel scripts still load; main’s two known browser failures (`notes-productivity`, `read-later`) unchanged.
