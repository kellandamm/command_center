# AI day plan — implementation plan

**AI day plan** for Stremmy (Dayplan-style): build today’s schedule from calendar, Todoist, and Board time blocks; warn on over-capacity; **up to three** editable must-dos; scheduled breaks; end-of-day shutdown tied to existing review data. **Budget, subscriptions, and home-vault data must never reach the LLM.** Reuses `chatCompletion` (`apps/server/src/llm/provider.ts`), calendar snapshot + block matching (same `eventId` join as `buildShutdownReview`), Todoist `partitionTodayAndOverdue`, and shutdown review shapes.

**Out of scope:** new LLM provider, MCP tools, ntfy push of plans, budget/subscription/vault surfaces.

**Cross-cutting:** **no new env vars**; **`cfg.tz`** for all day boundaries; shadcn gray + royal blue (`--primary`) + orange warnings (`--warning` / `dashboard-status-dot--orange`).

**Build order:** PR-sized steps at end (**core → API → page/widget (with must-do writes) → LLM last**).

---

## Decisions (Kellan, approved)

1. **Weekends:** Default **`availableMinutes = 0`** on Sat/Sun unless the user sets a **per-day work window override** on the plan.
2. **Todoist → LLM:** **`content` (title), `priority`, due day only** — no description, url, or other fields.
3. **Shutdown review:** **`GET /api/briefing/shutdown`** requires **CF-verified owner** — shipped (PR #105).
4. **Must-do completion:** Checking off a must-do **also completes** the linked Todoist task or Board card. **Only the owner’s UI click** may trigger that write — never the LLM, auto-run, or background jobs. Owner-only **`POST /api/day-plan/must-do/complete`** with **`csrfOk` + `x-ah`**. **Idempotency:** second POST for same `(day, slot)` when already completed → **200** unchanged. On failure: generic error (no task title in logs), local plan row stays open. **Undo:** **`POST /api/day-plan/must-do/reopen`** — Board card moved out of `Done`; Todoist **`POST /api/v1/tasks/{id}/reopen`**. On reopen failure: show error and **do not** desync local state (keep completed until reopen succeeds).
5. **Auto AI plan:** On **first owner load of the day**, if **`autoAiPlan`** is **ON** (default) and `llmConfigured` and **no LLM attempt yet today** → run **exactly one LLM attempt** for that owner/calendar day, cache result. **At most one LLM attempt per owner per calendar day** (not six). **Single-run guard:** claim the day in SQLite **before** calling the model — e.g. `INSERT INTO plan_llm_day (day, llm_attempted_at) VALUES (?, ?) ON CONFLICT(day) DO NOTHING` and proceed only when `changes === 1`; or conditional `UPDATE ... WHERE llm_attempted_at IS NULL`. Count **attempts**, not successes, so a failed LLM does **not** retry on every page/widget load. Concurrent widget + page loads must result in **one** LLM HTTP call. If auto already ran: **Generate with AI** shows the **cached AI plan** plus a **deterministic refresh** action (replan without LLM). If auto is off: the first **Generate with AI** uses the day’s **only** LLM attempt. **Manual re-runs that consume a second LLM call:** *pending Kellan*. **Deterministic planner** remains instant fallback when LLM off, claim lost, or failure.
6. **Breaks:** **Nearest free gap ≥ 15 min** to **work-window midpoint**, not overlapping meetings/blocks. No break when **weekend 0h** and nothing to schedule (no false over-capacity).

**`autoAiPlan` toggle:** **`PUT /api/day-plan/settings`** gated by **`isDayPlanOwner`** only — **not** the shared **`SettingsStore` / `PUT /api/settings`** path (`canManageSharedServerState` / admin-token). Stored via owner-scoped day-plan storage, not global settings writes.

---

## User flow

1. **Morning (owner):** Open **Day plan** widget or **`/day-plan`**. If no plan, **generate** deterministic plan; if **`autoAiPlan`** + LLM configured + **no `llm_attempted_at` today**, claim attempt and run LLM once.
2. **Edit:** Swap must-dos, PUT edits, **complete** POST (Todoist/Board).
3. **Generate with AI:** If attempt already used → show cached AI output + deterministic refresh; else use the single daily attempt (*extra manual LLM re-runs pending Kellan*).
4. **Refresh plan:** Deterministic replan only (no LLM).
5. **Shutdown:** Owner-only shutdown APIs. **`rolledToTomorrow`** at read time; rolled refs **boost** tomorrow’s must-do score.
6. **Auto AI toggle:** Day-plan owner settings route only.

Non-owners: `/api/day-plan/*` → **403**.

---

## Data sources (exact fields read)

Gather in `day-plan/gather.ts` with **explicit field picks**. On calendar/Todoist failure, set **`sources.calendarUnavailable` / `sources.todoistUnavailable`** on the plan (do not silently treat as empty capacity).

| Source | Fields | Never to LLM |
|--------|--------|--------------|
| Calendar | timed events + block join by `eventId`; all-day labels only | descriptions, raw `eventId`, … |
| Board | due ≤ day, not `Done` | `notes` |
| Todoist | `partitionTodayAndOverdue` only | description, url |

**Excluded modules:** `budget/*`, subscriptions, home-vault — policy in `day-plan/excluded.ts` + grep all `day-plan/*` sources.

---

## LLM prompt input / output

### When LLM runs

- **Once per owner per calendar day** (attempt recorded in **`llm_attempted_at`** before HTTP call).
- **Auto:** first owner load when `autoAiPlan` + configured + claim succeeds.
- **Manual Generate:** uses the single attempt if not yet attempted; otherwise cached plan + deterministic refresh.

### Input allowlist

`z.strictObject({ ... })` nested strict; call site sends **only** `DayPlanLlmInputSchema.parse(...)` JSON.

### Tests (LLM PR)

- **Concurrency:** parallel generate calls → one claim, one mock LLM invocation.
- **Failure no-retry:** failed LLM leaves `llm_attempted_at` set; second load does not call LLM again.

---

## Storage

`{dataDir}/day-plan.sqlite` with **`PRAGMA user_version = 1`** (bump on migrations).

| Table / column | Purpose |
|----------------|---------|
| `plan_days` | … **`llm_attempted_at`**, **`llm_generated_at`** |
| `plan_items`, `plan_must_dos` | as before |
| owner prefs | **`auto_ai_plan`** via owner route |

**`DayPlanStore.save`:** single SQLite **transaction**; mid-save failure leaves prior plan intact (test required).

---

## API routes and auth

`isDayPlanOwner` for all day-plan routes including **`PUT /api/day-plan/settings`**.

| Method | Path |
|--------|------|
| GET | `/api/day-plan?day=` |
| POST | `/api/day-plan/generate` |
| PUT | `/api/day-plan` |
| PUT | `/api/day-plan/settings` |
| POST | `/api/day-plan/must-do/complete` |
| POST | `/api/day-plan/must-do/reopen` |

---

## Test plan

Unit: gather/capacity/planner regression tests; store transaction; TZ tests; excluded glob `day-plan/*`. LLM PR: leak, concurrency, failure no-retry.

---

## PR-sized build sequence

1. **PR1 — Core** (#106 + round 2).
2. **PR2 — API**
3. **PR3 — Page + must-do writes**
4. **PR4 — Widget**
5. **PR5 — LLM + auto**

---

## Reference paths

- `apps/server/src/day-plan/*`, `calendar/day-duration.ts`
- Todoist: `completeTask`, **`POST .../tasks/{id}/reopen`**
