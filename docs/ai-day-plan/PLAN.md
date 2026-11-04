# AI day plan — implementation plan

**AI day plan** for Stremmy (Dayplan-style): build today’s schedule from calendar, Todoist, and Board time blocks; warn on over-capacity; **up to three** editable must-dos; scheduled breaks; end-of-day shutdown tied to existing review data. **Budget, subscriptions, and home-vault data must never reach the LLM.** Reuses `chatCompletion` (`apps/server/src/llm/provider.ts`), calendar snapshot + block matching (same `eventId` join as `buildShutdownReview`), Todoist `partitionTodayAndOverdue`, and shutdown review shapes.

**Out of scope:** new LLM provider, MCP tools, ntfy push of plans, budget/subscription/vault surfaces.

**Cross-cutting:** **no new env vars**; **`cfg.tz`** for all day boundaries; shadcn gray + royal blue (`--primary`) + orange warnings (`--warning` / `dashboard-status-dot--orange`).

**Build order:** PR-sized steps at end (**core → API → page/widget (with must-do writes) → LLM last**).

---

## Decisions (Kellan, approved)

1. **Weekends:** Default **`availableMinutes = 0`** on Sat/Sun unless the user sets a **per-day work window override** on the plan (`weekendOverride` / per-day work window on the plan row).
2. **Todoist → LLM:** **`content` (title), `priority`, due day only** — no description, url, or other fields.
3. **Shutdown review:** **`GET /api/briefing/shutdown`** (and related routes) require **CF-verified owner** (`who.owner === true` + email), same as reflection POST — shipped in **PR #105**.
4. **Must-do completion:** Checking off a must-do **also completes** the linked Todoist task or Board card. **Only the owner’s UI click** may trigger that write — never the LLM, auto-run, or background jobs. Owner-only **`POST /api/day-plan/must-do/complete`** with **`csrfOk` + `x-ah`** (same pattern as board/Todoist writes). **Idempotency:** second POST for same `(day, slot)` with already-completed remote → **200** with unchanged state. On Todoist/Board failure: **409/502** with generic message (**no task title in logs or JSON**), plan row stays **not** completed locally. **Undo:** **`POST /api/day-plan/must-do/reopen`** — Board card moved out of `Done`; Todoist **`POST /api/v1/tasks/{id}/reopen`**. On reopen failure: show error and **do not** desync local state (keep completed until reopen succeeds). **UI:** success toast, error banner, undo snackbar. **Tests:** mock fetch for Todoist; board move; idempotent complete; failure leaves DB consistent; **no task content in logs**.
5. **Auto AI plan:** On **first owner load of the day** (page or widget path that calls generate), if **`autoAiPlan`** is **ON** (default) and `llmConfigured` → claim **auto** slot and run LLM once. **Daily cap:** at most **2 LLM attempts per owner per calendar day** when auto is **ON** — **1 auto + 1 manual**. When **`autoAiPlan`** is **OFF**, at most **1 manual** attempt (no auto on first load). **Manual “Generate with AI”** **may** claim the **manual** slot and run the model **once more** after morning auto (success or failure). **Slot claims (critical):** attempts live in **`plan_llm_attempts`**, **not** on `plan_days` — `DayPlanStore.save` deletes and re-inserts `plan_days` (and cascades), which would wipe attempt timestamps stored there; `UPDATE ... WHERE` also fails when no row exists yet. Claim each slot with **`INSERT INTO plan_llm_attempts (day, slot, attempted_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`** (`slot` ∈ `auto` | `manual`); call the LLM only when **`changes === 1`**. Count **attempts**, not successes — failed LLM still consumes the slot and must **not** retry on every load. Concurrent widget + page loads contending for the same slot → **one** LLM HTTP call. When caps are exhausted: **cached AI plan** (if `llm_generated_at` / `generated_by = llm`) plus **deterministic refresh** (replan without LLM). **Deterministic planner** remains instant fallback when LLM off, claim lost, cap exhausted, or failure. **No repo-wide morning scheduler** for this feature; first owner load is the auto trigger. **Mid-day toggle:** turning **autoAiPlan** **off** cancels a **pending** auto run for that day (deterministic only until next day); turning it **on** mid-day does **not** trigger auto until the **next calendar day’s first load**.
6. **Breaks:** **Nearest free gap ≥ 15 min** to **work-window midpoint**, not overlapping meetings/blocks. When **`availableMinutes === 0`** without a per-day override: **no break** item; **still show timed meeting/block items** on the timeline; **`overByMinutes` counts unscheduled task minutes only** (calendar time does not add to over-capacity — a 1h Saturday event with no tasks shows **`overByMinutes = 0`**). An empty weekend (no tasks, no timed events) shows **no over-capacity**.

**`autoAiPlan` toggle:** **`PUT /api/day-plan/settings`** gated by **`isDayPlanOwner`** only — **not** the shared **`SettingsStore` / `PUT /api/settings`** path (`canManageSharedServerState` / admin-token). Persist **`auto_ai_plan`** in owner-scoped day-plan storage (e.g. `day-plan.sqlite` prefs table or dedicated column), not global settings writes.

---

## User flow

1. **Morning (owner):** Open **Day plan** widget or **`/day-plan`**. If no plan for `dayKey(now, cfg.tz)`, **generate**: deterministic plan immediately; if **`autoAiPlan`** + LLM configured + **auto slot** unclaimed → claim and run LLM once. Widget: capacity bar, 1–3 must-dos, next meeting.
2. **Edit:** Swap must-dos from **alternates** on `GET /api/day-plan`; adjust breaks/work window via PUT. **Check off must-do** → complete POST (Todoist/Board + local state).
3. **Generate with AI:** If **manual slot** available → claim manual and run LLM (including once more after auto). If both slots used (or auto off and manual used) → cached AI + deterministic refresh only.
4. **Refresh plan:** Deterministic replan only (**does not** consume LLM slots; must **not** reset `plan_llm_attempts`).
5. **Shutdown:** Owner-only shutdown APIs + reflection POST. **`rolledToTomorrow`** on `GET /api/day-plan`: open must-dos + unfinished scheduled work for today, computed at read time. Rolled refs **boost** tomorrow’s must-do score.
6. **Auto AI toggle:** Day-plan owner settings route only (see mid-day behavior in decision 5).

Non-owners: no nav, no widget catalog, `/api/day-plan/*` → **403**.

---

## Data sources (exact fields read)

Gather in `day-plan/gather.ts` with **explicit field picks** — never spread `planning().cards`. On calendar/Todoist failure, set **`sources.calendarUnavailable` / `sources.todoistUnavailable`** on the plan (do not silently treat as empty capacity).

| Source | API / module | Fields used in planner (server) | Never sent to LLM |
|--------|----------------|----------------------------------|-------------------|
| Calendar | `CalendarWorkspace.snapshot` + `planning().blocks` by **`eventId`** | Timed events: `summary`, `start`, `end`, `allDay`, `timezone`, `eventId`. **All-day:** label in UI only — **`continue` skip** for capacity/LLM (use `durationMsOnDay` > 0 for labels). Blocks: occurrence times from snapshot. | descriptions, locations, raw `eventId`, Google payloads |
| Board | `BoardStore.list()` + scheduled via block join | `id`, `title`, `column`, `estimatedMinutes`, `dueDate`, `priority`; include only **`dueDate <= day`**, **`column !== Done`** | `notes`, `hobieTaskId` |
| Todoist | `listTasks` + **`partitionTodayAndOverdue`** | **Overdue + today only:** **`content`, `priority`, due day** | description, url |
| Day-plan prefs | owner-scoped store | **`auto_ai_plan`** (default true) | — |

**Excluded modules:** `budget/*`, subscriptions, home-vault — `day-plan/excluded.ts` + grep all `day-plan/*.ts` sources (skip `excluded.ts` allowlist file in grep).

**Shutdown / tz note:** `buildShutdownReview` uses **`cfg.tz`**. **`completedOnDay(..., tz)`** and **`parseClientShutdownReview`** require explicit timezone (PR #105). PR1 core imports **`day-duration.ts`** only.

---

## LLM prompt input / output

### When LLM runs

- **Cap:** **2 attempts/day** with **`autoAiPlan` ON** (`auto` + `manual` rows in **`plan_llm_attempts`**); **1 attempt/day** with auto **OFF** (`manual` only).
- **Auto:** first owner generate when `autoAiPlan` + configured + **auto** claim succeeds.
- **Manual:** **Generate with AI** when **manual** claim succeeds — allowed after auto.
- **Not:** deterministic refresh alone; not a third LLM call after both slots consumed.

### Input allowlist

1. Explicit field mapping in `buildDayPlanLlmInput()`.
2. **`z.strictObject({ ... })`** for root and nested **`capacity`**, each meeting, each task (Zod 4 — no extra keys).
3. Call site: **`DayPlanLlmInputSchema.parse(...)`** then send **only** that JSON as the user message (no side-channel fields).

Meetings use opaque **`ref: "m1" | "m2" | …`** (server-side map); **never** Google `eventId` or calendar IDs in the prompt.

Todoist tasks in LLM input: **title, priority, dueDay only**.

### Output schema

**`DayPlanLlmOutputSchema`**: up to **3** `mustDo` entries; each **`refId` must match an input task ref**; reject unknown refs; invalid output → **deterministic fallback** (do not persist bad LLM JSON).

### Enforcement + leak test

Mock **`fetch`** and assert the **POST body** user message JSON contains **no** planted sensitive fields: Board **`notes`**, Todoist **description**, calendar **description/location**, or **extra keys** beyond the strict schema (e.g. plant `PLANT_*` on source rows). **Never log raw LLM error text** (generic log line only).

### Tests (LLM PR)

- **Concurrency (auto slot):** parallel first-load / auto generate → one `plan_llm_attempts` auto row, one mock LLM invocation.
- **Concurrency (manual slot):** parallel **Generate with AI** → one manual row, one mock LLM invocation.
- **Failure no-retry:** failed LLM leaves attempt row; reload / second click does not call LLM again for that slot.
- **Cap auto on:** auto then manual each invoke LLM once; third LLM request same day does not call the model.
- **Cap auto off:** no auto LLM on load; one manual Generate may call LLM; second does not.
- **Save does not reset cap:** after an attempt, **`DayPlanStore.save` / deterministic refresh** must **not** delete `plan_llm_attempts`; a subsequent generate must **still** block retry for an exhausted slot.

---

## Fallback when LLM fails

Deterministic **`day-plan/planner.ts`**: timeline, ≤3 must-dos (rolled refs boosted tomorrow), breaks in **free gap ≥ 15 min nearest work-window midpoint**, defer list (`alternates`).

---

## Capacity math

`durationMsOnDay` in **`calendar/day-duration.ts`**.

- Default window **09:00–17:00**; weekend **0 available** unless **per-day override** (decision 1).
- **Timed meetings/blocks only:** **clip** each interval to the work window (`clipIntervalToWindow`); **merge overlapping** intervals separately for meetings, blocks, and **combined occupied** time (overlapping block + meeting must not double-count for over-capacity).
- **Unscheduled task minutes:** Todoist **overdue + today** + Board **`dueDate <= day`**, not `Done`, **not already scheduled** on calendar blocks; use **`estimatedMinutes` or 30 min default**; subtract blocked minutes already counted in timed blocks (no double-count).
- **All-day events:** never add timed occurrence minutes to capacity totals.
- Surface **`sources.*Unavailable`** when gather fails so capacity is not silently low.

---

## Storage

`{dataDir}/day-plan.sqlite` with **`PRAGMA user_version = 2`** (bump on migrations; v2 adds per-day **`weekend_override`** on `plan_days`).

| Table | Purpose |
|-------|---------|
| `plan_days` | day metadata, `capacity_json`, `sources_json`, `generated_by`, `theme`, optional **`llm_generated_at`** (cache timestamp only — **not** attempt counters) |
| `plan_items`, `plan_must_dos` | timeline + must-do slots |
| **`plan_llm_attempts`** | **`PRIMARY KEY (day, slot)`**, `slot` ∈ `auto` \| `manual`, **`attempted_at`** — survives `plan_days` delete/reinsert |
| owner prefs | **`auto_ai_plan`** via owner route |

**`DayPlanStore.save`:** single SQLite **transaction** (`BEGIN IMMEDIATE` … `COMMIT` / `ROLLBACK`); mid-save failure leaves prior plan intact (**test required**). **`save` must not DELETE FROM `plan_llm_attempts`.**

---

## API routes and auth

**`isDayPlanOwner`:** **`who.owner === true`** — CF Access–verified identity email listed in **`OWNER_EMAILS`**. **Never** treat **`canManageSharedServerState`** (admin-token / shared settings write path) as day-plan owner. **Not** admin-token, service-token, or “any authenticated user”.

**403 matrix (every `/api/day-plan/*` route):** admin-token → **403**; service-token → **403**; verified non-owner email → **403**; empty **`OWNER_EMAILS`** → **403**; verified owner email in **`OWNER_EMAILS`** → **200** (or route-appropriate success).

All day-plan routes: **`csrfOk` + `x-ah`**, **`Cache-Control: no-store`**, **no secrets** in JSON responses.

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/api/day-plan?day=` | Plan, alternates, **`rolledToTomorrow`**, settings snapshot |
| POST | `/api/day-plan/generate` | `{ day?, useLlm?, forceDeterministic? }` |
| PUT | `/api/day-plan` | Edits (work window, items) |
| PUT | `/api/day-plan/settings` | **`autoAiPlan`** (owner only) |
| POST | `/api/day-plan/must-do/complete` | Owner click → Todoist `completeTask` or Board → `Done` |
| POST | `/api/day-plan/must-do/reopen` | Undo (Board move + Todoist reopen) |

---

## UI

- Widget **`ai-day-plan`**, catalog flag **`ownerOnly: true`**, default **W**.
- Page **`/day-plan`**; nav hidden for non-owners.
- Registry epoch skips **`ownerOnly`** widgets for non-owners.
- Must-do complete/reopen: toasts, error banner, undo snackbar (PR3).

---

## Env and server changes

No new env vars. **`autoAiPlan`** persisted via owner day-plan settings only.

---

## Test plan

**Unit (core / hardening):** capacity Chicago, Tokyo, DST; gather filters (all-day skip, board due/Done, Todoist partition); clip/merge/over-cap; planner break gap; store transaction; excluded glob `day-plan/*`; source-unavailable flags.

**Unit (API PR):** owner matrix above on all routes.

**Unit (page PR):** must-do complete/reopen idempotency, failure consistency, no content in logs; UI tests per decision 4.

**Unit (LLM PR):** allowlist leak test, output validation, concurrency, failure no-retry, cap tests, **`plan_llm_attempts` survives save**.

**Browser:** page + widget PRs.

---

## Rollout

1. Plan merged (#103 + docs fixes). 2. **PR #105** shutdown auth (done). 3. **PR1 core** (#106 + hardening). 4. API. 5. Page + widget + must-do writes. 6. LLM + auto toggle.

---

## PR-sized build sequence

1. **PR1 — Core (C):** `calendar/day-duration.ts`; `DayPlanStore` + **`plan_llm_attempts` schema**; `gather.ts`; deterministic planner + **capacity rules**; `rolledToTomorrow` + roll boost; `excluded.ts`; unit tests (TZ Chicago/Tokyo/DST, rule regressions, store transaction). **No LLM HTTP, routes, UI.**
2. **PR2 — API:** `/api/day-plan/*` routes, generate-on-miss hook, **`isDayPlanOwner` matrix tests**, alternates/`rolledToTomorrow` on GET, **`csrfOk` + `no-store`**.
3. **PR3 — Page + must-do writes:** `day-plan-page.ts`, nav, **`POST must-do/complete|reopen`**, undo UX + toasts/banners, browser test, write-path tests (decision 4).
4. **PR4 — Widget:** `ai-day-plan`, **`ownerOnly`** epoch rules, dashboard smoke.
5. **PR5 — LLM + auto:** strict allowlist + leak test, **`plan_llm_attempts` claims**, auto on first load, owner **`autoAiPlan`** setting, cap tests, output validation.

**Separate PR #105 (done):** shutdown owner-only GET + `completedOnDay` / `parseClientShutdownReview` **`cfg.tz`** fixes.

**Post-#106 hardening PR:** regression tests that fail when MUST rules removed; transaction; source flags; schema `user_version`; overlap merge — **no new product surface**.

---

## Reference paths

- Calendar / duration: `calendar/workspace.ts`, `calendar/day-duration.ts`, `calendar/google.ts`
- Day plan: `apps/server/src/day-plan/*`
- Shutdown: `briefing/shutdown-service.ts`, `daily-briefing/routes.ts`
- LLM: `llm/provider.ts`, `quick-add/parse.ts` (strict Zod pattern)
- Todoist: `partitionTodayAndOverdue`, `completeTask`, **`POST /api/v1/tasks/{id}/reopen`**
- Board: `board/store.ts` `move(..., DONE)`
- Dashboard: `dashboard-layout/widgets.ts`
- Auth: `OWNER_EMAILS`, CF verified email helpers used by shutdown routes
