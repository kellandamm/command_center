# Weekly & monthly reviews — implementation plan

Structured **periodic reviews** built from workspace activity: tasks completed, meetings, bookmarks consumed, and a notes reflection prompt. Reuses shutdown review and calendar/day-plan data paths. **Budget and subscriptions are excluded entirely.** Optional AI summary uses **note text only** under existing LLM configuration—never financial data.

**Out of scope:** email triage, agent memory, direct bank connection, pushing review content via ntfy (unless Kellan later opts in—default **off**), including budget/subscription totals.

**Build order:** One implementation PR after command palette (optional) and independent of budget; no hard dependency on Budget PR A.

---

## Scope

| In | Out |
|----|-----|
| `/reviews` page + `GET /api/reviews/weekly|monthly` | Budget / `BudgetStore` imports |
| Aggregates from Todoist, Board, Calendar, Notes, Bookmarks, Meetings | Changing `OWNER_EMAILS` semantics |
| Reuse `buildShutdownReview` logic for task/calendar slices | Auto-posting to daily briefing newspaper |
| Optional LLM paragraph from non-sensitive notes only | LLM over bookmark URLs or meeting transcripts without size caps |

---

## Data model

**File-backed metadata** under `cfg.dataDir` (no new sqlite v1):

| File | Purpose |
|------|---------|
| `reviews/weekly.json` | Last generated `{ periodStart, periodEnd, generatedAt, snapshotId }` per week key |
| `reviews/monthly.json` | Same for calendar month |
| `reviews/snapshots/{id}.json` | Cached aggregate payload (counts + ids + user reflection text); **no budget fields** |

Week/month boundaries use workspace `cfg.tz` (`config.ts` `tz`), same as `dayKey` / `dayKeyFromIso` (`store.ts`, `heatmap/counts.ts`).

Snapshot sections (all optional if integration missing):

| Section | Source functions |
|---------|------------------|
| Tasks done | `listCompletedTasks` + `partitionTodayAndOverdue` inverse (`todoist/client.ts`); Board `movesSince` + `DONE` column (`board/store.ts`, `board/types.ts`) — same filters as `buildShutdownReview` (`briefing/shutdown-service.ts`) |
| Meetings | Notes tagged via meetings pipeline (`meetings/import-service.ts`, `meetings/summary-queue.ts`) with `updatedAt` in range |
| Bookmarks read | Bookmark items with `readAt` / consumed flag if present in bookmarks store (else “added in period” fallback from `http.ts` bookmarks service) |
| Calendar / day plan | `CalendarWorkspace.planning()` blocks + `snapshot` event hours (`calendar/workspace.ts` `planning`, `snapshot`); mirror shutdown `time.calendarHours` / blocked task hours |
| Notes prompt | Static template + optional user free-text saved in snapshot only |

**Exclude budget:** static rule in `reviews/excluded.ts` (mirror `budget/excluded.ts` intent); CI grep that `reviews/` does not import `budget/`.

---

## API routes

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/api/reviews/weekly?week=YYYY-Www` | Authenticated principal (same as briefing routes) | `{ period, sections, llmEnabled, errors }` |
| GET | `/api/reviews/monthly?month=YYYY-MM` | Same | Same structure, wider ranges |
| POST | `/api/reviews/weekly/reflection` | Same + `readBody` | Saves user reflection text on snapshot (no LLM required) |
| POST | `/api/reviews/monthly/summary` | Same | Optional LLM: **only** concatenated non-sensitive note titles + user reflection + numeric aggregates (no raw URLs, no bookmark bodies) |

Wire in `http.ts` near `handleDailyBriefingRoutes` (`daily-briefing/routes.ts`). JSON `cache-control: no-store`.

**LLM:** when `llmConfigured(cfg)` (`config.ts`), call `chatCompletion` (`llm/provider.ts`) with system prompt similar to `generateShutdownReflection` (`shutdown-service.ts` lines 324–354) but fed **only** `notesForLlmContext`-filtered excerpts (`notes/sensitive.ts`). Cap input bytes (reuse `MAX_CLIENT_REVIEW_BYTES` pattern from shutdown).

---

## UI

| Piece | Files |
|-------|-------|
| Page | `apps/server/src/ui/reviews-page.ts` — `#85` `pageHeader`, `statCard` for counts, sections as `card()` from `components.ts` |
| Route | `GET /reviews` in `http.ts`; nav tab optional (hidden by default in `nav-tabs.ts` until enabled—**no new env**; use settings sidebar visibility patch only if Kellan wants) |
| Shutdown reuse | Link “See today’s shutdown” → `/briefing` shutdown tab (`daily-briefing-page.ts` `#db-mode-shutdown`, `/api/briefing/shutdown`) |
| Day plan reuse | Show “Scheduled blocks remaining” from `/api/calendars/planning` (`calendar/routes.ts` line 19, `calendar-planning-script.ts`) |

**Daily Briefing newspaper style** (`daily-briefing-page.ts`) stays unchanged—reviews are a separate gray/royal-blue workspace page.

---

## Privacy and security

| Rule | Enforcement | Test |
|------|-------------|------|
| No budget data | No `BudgetStore` in review builders | Grep + fixture assert |
| Sensitive notes excluded from LLM | `notesForLlmContext` | Unit with sensitive note seeded |
| No review payload in MCP tools | `IntegrationDeps` unchanged | MCP tool name snapshot |
| No ntfy on generate | Do not call `notify/ntfy.ts` | Grep |
| Briefing editions unchanged | `DailyBriefingService` does not read reviews dir | Integration test |
| `Cache-Control: no-store` | JSON + HTML `send()` | Header test |

---

## Tests

**Unit:** `reviews-build.test.ts` (week boundaries in `cfg.tz`, section counts, budget import forbidden), `reviews-llm.test.ts` (sensitive exclusion).

**Browser:** `reviews.browser.ts` in `test:dashboard-browser` — load `/reviews`, weekly tab shows shutdown-linked counts, LLM button disabled when `LLM_*` unset (mirror settings page pattern in `pages.ts`).

---

## PR breakdown

Single PR: `briefing/reviews-service.ts` (or `reviews/service.ts`), routes, `reviews-page.ts`, snapshot storage, tests, optional nav entry.

---

## Open questions for Kellan

1. Should weekly reviews align to **ISO week** or **Sunday-start** in `cfg.tz`?
2. Nav tab visible by default or buried under Settings → Features?
3. LLM summary opt-in per review (button) vs auto-generate on first open?
4. Include **focus sessions** (`FocusSessionsStore` in `focus/store.ts`, `panels/focus.ts`) in activity section?

---

## Reference paths (existing)

- Shutdown aggregate: `apps/server/src/briefing/shutdown-service.ts` `buildShutdownReview`, `generateShutdownReflection`.
- Briefing HTTP: `apps/server/src/daily-briefing/routes.ts` (`/api/briefing/shutdown`).
- UI shutdown tab: `apps/server/src/ui/daily-briefing-page.ts`.
- Calendar planning: `apps/server/src/calendar/workspace.ts` `planning()`; API `calendar/routes.ts`.
- Todoist: `apps/server/src/todoist/client.ts` `listCompletedTasks`, `listTasks`, `partitionTodayAndOverdue`.
- Board done: `apps/server/src/board/store.ts` `movesSince`, `DONE` in `board/types.ts`.
- LLM gate: `apps/server/src/config.ts` `llmConfigured`, `llmConfig`.
- Note sensitivity: `apps/server/src/notes/sensitive.ts` `notesForLlmContext`, `isNoteSensitive`.
- Timezone day keys: `apps/server/src/store.ts` `dayKey`.
