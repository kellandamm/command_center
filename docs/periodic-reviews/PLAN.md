# Weekly & monthly reviews — implementation plan

**Periodic reviews** from activity: tasks done, meetings, bookmarks touched, calendar/day-plan context, and a notes reflection prompt. Reuses shutdown and planning code paths. **Budget and subscriptions excluded.** Optional LLM: **note titles only** (see LLM section)—counts stay in a deterministic template, not model prose.

**Out of scope:** email triage, agent memory, direct bank connection, ntfy push of reviews, budget/subscription totals.

**Cross-cutting:** no new dependencies or env vars; no budget data; budget alerts never in briefings or push.

**Build order:** One PR; optional after command palette.

---

## Scope

| In | Out |
|----|-----|
| `/reviews` + `GET /api/reviews/weekly|monthly` | `BudgetStore` / budget routes |
| Todoist, Board, Calendar, Notes, Bookmarks, Meetings | Changing owner auth model |
| Reuse `buildShutdownReview` slices | Newspaper briefing edits |
| Optional LLM summary (titles-only policy below) | Full note bodies / bookmark URLs to LLM |

---

## Data model

File-backed under `cfg.dataDir`:

| Path | Purpose |
|------|---------|
| `reviews/weekly.json`, `reviews/monthly.json` | Last run metadata per period key |
| `reviews/snapshots/{id}.json` | Aggregates + user reflection text (**no budget fields**) |

Period boundaries: `cfg.tz` via `dayKey` / `dayKeyFromIso` (`store.ts`, `heatmap/counts.ts`).

| Section | Sources |
|---------|---------|
| Tasks done | `buildShutdownReview` filters: `listCompletedTasks`, `listTasks`, `board.movesSince`, `DONE` (`briefing/shutdown-service.ts`, `todoist/client.ts`, `board/store.ts`) |
| Meetings | Notes from meetings import (`meetings/import-service.ts`) with `updatedAt` in range |
| Bookmarks | **`BookmarksStore` has no `readAt`** (`bookmarks/store.ts` schema: id, groupId, title, url, description only). **Fallback v1:** count/list bookmarks **added or updated in period** via import/mutation timestamps if added later; else **omit section** with copy “Bookmark activity tracking not available yet” — do not invent `readAt`. |
| Calendar / day plan | `CalendarWorkspace.planning()` + `snapshot` hours (shutdown `time` fields) |
| Notes prompt | Static checklist + user reflection stored on snapshot |

**Exclude budget:** `reviews/excluded.ts`; CI grep no `budget/` imports under `reviews/`.

---

## API routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/reviews/weekly?week=…` | Build/load snapshot |
| GET | `/api/reviews/monthly?month=…` | Same |
| POST | `/api/reviews/weekly/reflection` | Save user reflection (no LLM) |
| POST | `/api/reviews/monthly/summary` | Optional LLM (policy below) |

Wire near `handleDailyBriefingRoutes` (`daily-briefing/routes.ts`). JSON no-store.

### LLM policy (single rule)

When `llmConfigured(cfg)` (`config.ts`):

1. **Deterministic block (never LLM):** all numeric counts, lists of task/board/meeting **titles** already shown in the UI, calendar hours, bookmark fallback counts, period labels — rendered from snapshot JSON in SSR/ client template.
2. **LLM input (only if user clicks “Summarize”):** newline-separated **non-sensitive note titles only** from notes touched in period (`isNoteSensitive` → exclude entirely via `notes/sensitive.ts`), plus the user’s saved reflection text, plus **aggregate counts as numbers in the prompt** (same as `generateShutdownReflection` numeric lines in `shutdown-service.ts` lines 332–338). **No note bodies, no bookmark URLs, no meeting transcript text, no budget fields.**
3. Call `chatCompletion` (`llm/provider.ts`) with byte cap inspired by `MAX_CLIENT_REVIEW_BYTES` in `shutdown-service.ts`.

---

## UI

`apps/server/src/ui/reviews-page.ts` — `pageHeader`, `statCard`, `card()`.

Link to shutdown tab: `daily-briefing-page.ts`, `/api/briefing/shutdown`.

Day plan: `/api/calendars/planning` (`calendar/routes.ts`).

---

## Privacy and security

| Rule | Test |
|------|------|
| No budget imports | Grep |
| LLM gets titles-only policy | Unit: sensitive note title excluded; body never in prompt |
| No ntfy | Grep |
| Briefing unchanged | `DailyBriefingService` |
| no-store | Header test |

---

## Tests

**Unit:** `reviews-build.test.ts`, `reviews-llm.test.ts`.

**Browser:** `reviews.browser.ts` in `test:dashboard-browser`.

---

## PR breakdown

Single PR: `reviews/service.ts`, routes, `reviews-page.ts`, tests.

---

## Open questions for Kellan

1. ISO week vs Sunday-start in `cfg.tz`?
2. Default nav tab visibility?
3. LLM button-only vs auto on open?
4. Include `FocusSessionsStore` (`focus/store.ts`)?

---

## Reference paths

- `apps/server/src/briefing/shutdown-service.ts` `buildShutdownReview`, `generateShutdownReflection`.
- `apps/server/src/daily-briefing/routes.ts`, `ui/daily-briefing-page.ts`.
- `apps/server/src/calendar/workspace.ts` `planning()`.
- `apps/server/src/bookmarks/store.ts` (no readAt).
- `apps/server/src/notes/sensitive.ts` `isNoteSensitive`, `notesForLlmContext` (titles-only policy stricter than full notesForLlmContext).
- `apps/server/src/config.ts` `llmConfigured`.
- `apps/server/src/http.ts` `send()` line 134.
