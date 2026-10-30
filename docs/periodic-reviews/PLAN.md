# Weekly & monthly reviews — implementation plan

**Periodic reviews** from activity: tasks done, meetings, bookmarks touched, calendar/day-plan context, and a notes reflection prompt. Reuses shutdown and planning code paths. **Budget and subscriptions excluded.** Optional LLM receives **only non-sensitive note titles plus the user’s saved reflection text**—see LLM section. **All counts and activity lists stay in the deterministic UI template and are never sent to the model.**

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
| Optional LLM paragraph (titles + reflection only) | Note bodies, counts, URLs, transcripts to LLM |

---

## Period boundaries (Kellan)

Reviews use **`America/Chicago` local calendar**, not UTC and not the browser zone.

- **Weekly:** Weeks **start Sunday 00:00** and end **Saturday 23:59:59.999** America/Chicago. Week key = `YYYY-MM-DD` of that Sunday (or `YYYY-Www` derived from it). Query param `week` resolves to that Sunday-start interval.
- **Monthly:** Calendar month in America/Chicago: **`YYYY-MM-01` 00:00** through **last day 23:59:59.999** (month length handled explicitly for month-end activity).

Implement with `Intl` / existing `dayKey` helpers parameterized by **`America/Chicago`** for this module (even if `cfg.tz` differs elsewhere).

---

## Data model

File-backed under `cfg.dataDir`:

| Path | Purpose |
|------|---------|
| `reviews/weekly.json`, `reviews/monthly.json` | Last run metadata per period key |
| `reviews/snapshots/{id}.json` | Aggregates + user reflection text (**no budget fields**) |

| Section | Sources |
|---------|---------|
| Tasks done | `buildShutdownReview` filters (`briefing/shutdown-service.ts`, `todoist/client.ts`, `board/store.ts`) |
| Meetings | `meetings/import-service.ts` notes in range |
| Bookmarks | No `readAt` — omit section with static copy (do not invent) |
| Calendar / day plan | `CalendarWorkspace.planning()` + `snapshot` |
| Notes prompt | Static checklist + user reflection on snapshot |

**Exclude budget:** `reviews/excluded.ts`; CI grep no `budget/` imports.

---

## API routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/reviews/weekly?week=…` | Build/load snapshot (Chicago Sunday week) |
| GET | `/api/reviews/monthly?month=YYYY-MM` | Chicago calendar month |
| POST | `/api/reviews/weekly/reflection` | Save reflection (no LLM) |
| POST | `/api/reviews/monthly/summary` | Optional LLM (policy below) |

Wire near `handleDailyBriefingRoutes` (`daily-briefing/routes.ts`). JSON no-store.

### LLM policy (single rule)

When `llmConfigured(cfg)` and user clicks **Summarize**:

- **Never sent to `chatCompletion`:** counts, task/board/meeting lists, calendar hours, bookmark text, period labels—anything rendered in the deterministic template.
- **LLM input only:** non-sensitive **note titles** in period + user **saved reflection text** (`notes/sensitive.ts` excludes sensitive notes entirely).
- System prompt: short reflective paragraph; byte cap per `MAX_CLIENT_REVIEW_BYTES` pattern in `shutdown-service.ts`.

---

## UI

`apps/server/src/ui/reviews-page.ts` — `pageHeader`, `statCard`, `card()`. **Summarize** button only (no auto LLM on load).

**Nav:** Add sidebar tab **`reviews`** in `nav-tabs.ts` (workspace group). **Normal visibility:** respect user sidebar settings like other non-owner tabs (not budget-gated—reviews contain no financial data). `visibleNavTabs(app.settings.get().sidebarTabs, { … })` without an owner-only filter for Reviews.

Link to shutdown: `/briefing` shutdown tab. Day plan: `/api/calendars/planning`.

---

## Privacy and security

| Rule | Test |
|------|------|
| No budget imports | Grep |
| LLM = titles + reflection only | Unit on prompt bytes |
| No ntfy | Grep |
| Briefing unchanged | `DailyBriefingService` |
| no-store | Header test |

---

## Tests

**Unit:** `reviews-build.test.ts` (Sunday Chicago week edges, month boundaries), `reviews-llm.test.ts`.

**Browser:** `reviews.browser.ts` in `test:dashboard-browser`.

---

## PR breakdown

Single PR: `reviews/service.ts`, routes, `reviews-page.ts`, `nav-tabs.ts`, tests.

---

## Decisions (Kellan)

1. **Weeks:** Sunday-start in **America/Chicago** (see Period boundaries).
2. **Nav:** Dedicated **Reviews** tab; normal sidebar visibility rules.
3. **LLM:** **Summarize** button only.
4. **Focus sessions:** Not included in v1.

---

## Reference paths

- `apps/server/src/briefing/shutdown-service.ts` `buildShutdownReview`.
- `apps/server/src/daily-briefing/routes.ts`, `ui/daily-briefing-page.ts`.
- `apps/server/src/calendar/workspace.ts` `planning()`.
- `apps/server/src/bookmarks/store.ts`.
- `apps/server/src/notes/sensitive.ts` `isNoteSensitive`.
- `apps/server/src/config.ts` `llmConfigured`.
- `apps/server/src/nav-tabs.ts`, `http.ts` nav (~339–343).
- `apps/server/src/http.ts` `send()` line 134.
