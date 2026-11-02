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
5. **Auto AI plan:** **Daily LLM cap:** at most **2 attempts per owner per calendar day** when **`autoAiPlan`** is **ON** (default) — **1 auto + 1 manual**. When **`autoAiPlan`** is **OFF**, at most **1 manual** attempt (no auto run on first load). **Slot claims:** before each LLM HTTP call, claim **`auto`** or **`manual`** in SQLite with **one atomic statement** (`INSERT ... ON CONFLICT DO NOTHING` or `UPDATE ... WHERE <slot>_attempted_at IS NULL`); call the model only when the claim wins (`changes === 1`). Count **attempts**, not successes — a failed LLM still consumes that slot and must **not** retry on every page/widget load. Concurrent widget + page loads contending for the same slot → **one** LLM call. **Auto:** first owner load of the day when auto is on and `llmConfigured` → claim auto slot, run LLM once, cache on success (`llm_generated_at`). **Manual Generate with AI** **may** claim the **manual** slot and run the model **once more** even after morning auto (success or failure). If auto is off, the first **Generate with AI** uses the only allowed attempt (manual slot). When a slot is exhausted or cap reached: show **cached AI plan** (if any) plus **deterministic refresh** (replan without LLM). **Deterministic planner** remains instant fallback when LLM off, claim lost, cap exhausted, or failure.
6. **Breaks:** **Nearest free gap ≥ 15 min** to **work-window midpoint**, not overlapping meetings/blocks. No break when **weekend 0h** and nothing to schedule (no false over-capacity).

**`autoAiPlan` toggle:** **`PUT /api/day-plan/settings`** gated by **`isDayPlanOwner`** only — **not** the shared **`SettingsStore` / `PUT /api/settings`** path (`canManageSharedServerState` / admin-token). Stored via owner-scoped day-plan storage, not global settings writes.

---

## User flow

1. **Morning (owner):** Open **Day plan** widget or **`/day-plan`**. If no plan, **generate** deterministic plan; if **`autoAiPlan`** + LLM configured + **auto slot unclaimed**, atomically claim auto and run LLM once.
2. **Edit:** Swap must-dos, PUT edits, **complete** POST (Todoist/Board).
3. **Generate with AI:** If **manual slot** still available → claim manual and run LLM (including **once more** after morning auto). If both slots used (or auto off and manual already used) → cached AI output + deterministic refresh only.
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

- **Cap:** **2 attempts/day** with **`autoAiPlan` ON** (auto + manual slots); **1 attempt/day** with auto **OFF** (manual slot only).
- **Auto:** first owner load when `autoAiPlan` + configured + **auto slot** claim succeeds (`llm_auto_attempted_at` set before HTTP).
- **Manual Generate:** when **manual slot** claim succeeds (`llm_manual_attempted_at` before HTTP) — allowed after auto already ran.
- **Not:** deterministic refresh alone; not a third LLM call after both slots consumed.

### Input allowlist

`z.strictObject({ ... })` nested strict; call site sends **only** `DayPlanLlmInputSchema.parse(...)` JSON.

### Tests (LLM PR)

- **Concurrency (auto slot):** parallel first-load / auto generate → one auto claim, one mock LLM invocation.
- **Concurrency (manual slot):** parallel **Generate with AI** → one manual claim, one mock LLM invocation.
- **Failure no-retry:** failed auto leaves `llm_auto_attempted_at` set; reload does not call LLM for auto again; failed manual leaves `llm_manual_attempted_at` set; second manual click does not call LLM again.
- **Cap auto on:** auto then manual each invoke LLM once; a third LLM request same day does not call the model.
- **Cap auto off:** no auto LLM on load; exactly one manual Generate may call LLM; second manual does not.

---

## Storage

`{dataDir}/day-plan.sqlite` with **`PRAGMA user_version = 1`** (bump on migrations).

| Table / column | Purpose |
|----------------|---------|
| `plan_days` | … **`llm_auto_attempted_at`**, **`llm_manual_attempted_at`**, **`llm_generated_at`** (successful AI cache) |
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

Unit: gather/capacity/planner regression tests; store transaction; TZ tests; excluded glob `day-plan/*`. LLM PR: leak, concurrency (auto + manual), failure no-retry (per slot), cap tests (2 with auto on, 1 with auto off).

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
