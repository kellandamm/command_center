# AI day plan — implementation plan

**AI day plan** for Stremmy (Dayplan-style): build today’s schedule from calendar, Todoist, and Board time blocks; warn on over-capacity; **up to three** editable must-dos; scheduled breaks; end-of-day shutdown tied to existing review data. **Budget, subscriptions, and home-vault data must never reach the LLM.** Reuses `chatCompletion` (`apps/server/src/llm/provider.ts`), calendar snapshot + block matching (same `eventId` join as `buildShutdownReview`), Todoist `partitionTodayAndOverdue`, and shutdown review shapes.

**Out of scope:** new LLM provider, MCP tools, ntfy push of plans, budget/subscription/vault surfaces.

**Cross-cutting:** **no new env vars**; **`cfg.tz`** for all day boundaries; shadcn gray + royal blue (`--primary`) + orange warnings (`--warning` / `dashboard-status-dot--orange`).

**Build order:** PR-sized steps at end (**core → API → page/widget (with must-do writes) → LLM last**).

---

## Decisions (Kellan, approved)

1. **Weekends:** Default **`availableMinutes = 0`** on Sat/Sun unless the user sets a **per-day work window override** on the plan.
2. **Todoist → LLM:** **`content` (title), `priority`, due day only** — no description, url, or other fields.
3. **Shutdown review:** **`GET /api/briefing/shutdown`** (and related routes) require **CF-verified owner** (`who.owner === true` + email), same as reflection POST — shipped in **separate auth PR (B)**, not bundled with day-plan feature PRs.
4. **Must-do completion:** Checking off a must-do **also completes** the linked Todoist task or Board card. **Only the owner’s UI click** may trigger that write — never the LLM, auto-run, or background jobs. Owner-only **`POST /api/day-plan/must-do/complete`** with **`csrfOk` + `x-ah`** (same pattern as board/Todoist writes). **Idempotency:** second POST for same `(day, slot)` with already-completed remote → **200** with unchanged state. On Todoist/Board failure: **409/502** with generic message (no task title in logs or JSON), plan row stays **not** completed locally. **Undo:** **`POST /api/day-plan/must-do/reopen`** moves Board card out of `Done` / reopens Todoist if API supports (v1: Board move only; Todoist reopen documented as manual if API lacks reopen — implement Board undo + clear local `completed_at`; Todoist undo best-effort or “couldn’t reopen” with local revert). UI: success toast, error banner, undo snackbar. Tests: mock fetch for Todoist; board move; idempotent complete; failure leaves DB consistent; no content in logs.
5. **Auto AI plan:** On **first owner load of the day** (page or widget path that calls generate), if **`autoAiPlan`** setting is **ON** (default) and `llmConfigured` and **no LLM run yet today** in storage → run LLM once, cache result (**at most one LLM run per owner per calendar day** in `day-plan.sqlite`). **No repo-wide morning scheduler** for this feature (briefing scheduler is separate); first load is the trigger because it matches owner presence without new cron. **Deterministic planner** remains instant fallback when LLM off, over cap, or failure. **`autoAiPlan`** stored in **`SettingsStore`** (`viewPreferences` or dedicated `dayPlan: { autoAiPlan: boolean }`), not env. **Manual “Generate with AI”** still allowed; **daily LLM cap: 6 runs/day/owner** (auto + manual combined), tracked in store. Turning **autoAiPlan** off skips auto LLM on first load (deterministic only).
6. **Breaks:** Keep server template — **nearest free gap ≥ 15 min** to **work-window midpoint**, not overlapping meetings/blocks.

---

## User flow

1. **Morning (owner):** Open **Day plan** widget or **`/day-plan`**. If no plan for `dayKey(now, cfg.tz)`, **generate**: deterministic plan immediately; if **`autoAiPlan`** and LLM allowed and under daily cap, **one** auto LLM run replaces/enhances must-dos/breaks (cached). Widget: capacity bar, 1–3 must-dos, next meeting.
2. **Edit:** Swap must-dos from **alternates** on `GET /api/day-plan`; adjust breaks/work window via PUT. **Check off must-do** → complete POST (Todoist/Board + local state).
3. **Manual AI:** **Generate with AI** when under daily cap; counts toward cap.
4. **Refresh plan:** Deterministic replan only (does not consume LLM cap unless body requests LLM — manual only).
5. **Shutdown:** `GET /api/briefing/shutdown` (owner only, PR B) + reflection POST. **`rolledToTomorrow`** on `GET /api/day-plan`: open must-dos + unfinished scheduled work for today, computed at read time. **Rolled items add a simple +score boost** when ranking tomorrow’s must-dos (same ref as yesterday’s roll list).
6. **Settings:** Toggle **Auto AI plan** (default ON) in day-plan page or settings section.

Non-owners: no nav, no widget catalog, `/api/day-plan/*` → **403**.

---

## Data sources (exact fields read)

Gather in `day-plan/gather.ts` with **explicit field picks** — never spread `planning().cards`.

| Source | API / module | Fields used in planner (server) | Never sent to LLM |
|--------|----------------|----------------------------------|-------------------|
| Calendar | `CalendarWorkspace.snapshot` + `planning().blocks` by **`eventId`** | Timed events: `summary`, `start`, `end`, `allDay`, `timezone`, `eventId`. All-day: UI only, **excluded from capacity/LLM**. Blocks: occurrence times from snapshot. | descriptions, locations, raw `eventId`, Google payloads |
| Board | `BoardStore.list()` + scheduled via block join | `id`, `title`, `column`, `estimatedMinutes`, `dueDate`, `priority`; capacity if **`dueDate <= day`**, not `Done` | `notes`, `hobieTaskId` |
| Todoist | `listTasks` + **`partitionTodayAndOverdue`** | overdue + today: **`content`, `priority`, due day** | description, url |
| Settings | `SettingsStore` | **`dayPlan.autoAiPlan`** (default true) | — |

**Excluded modules:** `budget/*`, subscriptions, home-vault — `day-plan/excluded.ts`.

**Shutdown / tz note:** `buildShutdownReview` already uses **`cfg.tz`**. Only **`completedOnChicagoDay`** (rename → **`completedOnDay(..., tz)`**) and **`parseClientShutdownReview`’s default timezone** were Chicago-only; fixed in **auth PR (B)** with TZ tests (`briefing-shutdown.test.ts` ~87 updated). PR1 day-plan imports **`day-duration.ts`** only — no duplicate shutdown tz work.

---

## LLM prompt input / output

### When LLM runs

- **Auto:** first owner generate of the day when `autoAiPlan` + `llmConfigured` + under **6/day cap** + no `llm_generated_at` for that day in store.
- **Manual:** **Generate with AI** (same cap).
- **Not:** deterministic refresh alone.

### Input allowlist

1. Explicit field mapping in `buildDayPlanLlmInput()`.
2. **`z.strictObject({ ... })`** for root and nested **`capacity`**, each meeting, each task (Zod 4 — no extra keys).
3. Call site: **`DayPlanLlmInputSchema.parse(...)`** then **only** that JSON as user message.

Meetings use opaque **`ref: "m1" | "m2"`** (server map); never Google `eventId`.

Todoist tasks in LLM input: **title, priority, dueDay only**.

### Output schema

Up to 3 `mustDo`; reject refs not in input tasks; invalid → deterministic fallback.

### Enforcement + leak test

Mock **`fetch` POST body**; plant extras on source rows; assert no `PLANT_*`. No raw LLM error text in logs.

---

## Fallback when LLM fails

Deterministic **`day-plan/planner.ts`**: timeline, ≤3 must-dos (rolled refs boosted tomorrow), breaks in **free gap ≥ 15 min nearest work-window midpoint**, defer list.

---

## Capacity math

`durationMsOnDay` in **`calendar/day-duration.ts`**.

- Default window **09:00–17:00**; weekend **0 available** unless override (decision 1).
- Meetings/blocks: timed only, clip to window, merge overlaps, sum.
- Unscheduled minutes: Todoist overdue+today + board due ≤ day, estimates or 30 default, minus blocked double-count.

---

## Storage

`{dataDir}/day-plan.sqlite`: `plan_days`, `plan_items`, `plan_must_dos`, **`plan_llm_usage`** (`day`, `run_count`, `last_run_at`) for daily cap + one auto LLM cache flag (`generated_by`, `theme`).

**Settings file:** `dayPlan.autoAiPlan` boolean default **true** in `settings.ts`.

---

## API routes and auth

`isDayPlanOwner` = verified owner email only.

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/api/day-plan?day=` | Plan, alternates, **`rolledToTomorrow`**, settings snapshot |
| POST | `/api/day-plan/generate` | `{ day?, useLlm?, forceDeterministic? }` |
| PUT | `/api/day-plan` | Edits |
| POST | `/api/day-plan/must-do/complete` | Owner click → Todoist `completeTask` or Board → `Done` |
| POST | `/api/day-plan/must-do/reopen` | Undo |

CSRF + `no-store`. No secrets in responses.

---

## UI

Widget **`ai-day-plan`**, **`ownerOnly: true`**, default **W**. Page **`/day-plan`**. Registry epoch skips **`ownerOnly`** widgets for non-owners generally.

---

## Env and server changes

No new env. Stored **`autoAiPlan`** only.

---

## Test plan

Unit: capacity (Chicago, Tokyo, DST), planner, store, allowlist (LLM PR), owner matrix, must-do complete/reopen (page PR), excluded grep.

Browser: page + widget PRs.

---

## Rollout

1. Plan merged. 2. **PR B** shutdown auth. 3. **PR1** core. 4. API. 5. Page + widget + must-do writes. 6. LLM + auto toggle.

---

## PR-sized build sequence

1. **PR1 — Core (C):** `day-duration.ts` extract; `DayPlanStore`; `gather.ts`; deterministic planner + capacity; `rolledToTomorrow` + roll boost in scorer; `excluded.ts`; unit tests (TZ Chicago/Tokyo/DST). **No LLM, routes, UI.**
2. **PR2 — API:** routes, GET generate-on-miss hook for later UI, owner tests, alternates/`rolledToTomorrow` on GET.
3. **PR3 — Page + must-do writes:** `day-plan-page.ts`, nav, **`POST must-do/complete|reopen`**, undo UX, browser test.
4. **PR4 — Widget:** `ai-day-plan`, ownerOnly epoch rules, dashboard smoke.
5. **PR5 — LLM + auto:** strict allowlist, auto on first load, **`autoAiPlan`** setting, daily cap in store, leak test.

**Separate PR B (before or parallel to PR1):** shutdown owner-only GET + `completedOnDay` / `parseClientShutdownReview` **`cfg.tz`** fixes.

---

## Reference paths

- Calendar / duration: `calendar/workspace.ts`, `calendar/day-duration.ts`, `calendar/google.ts`
- Shutdown: `briefing/shutdown-service.ts`, `daily-briefing/routes.ts`
- LLM: `llm/provider.ts`, `quick-add/parse.ts`
- Todoist: `partitionTodayAndOverdue`, `completeTask`
- Board: `board/store.ts` `move(..., DONE)`
- Dashboard: `dashboard-layout/widgets.ts`
- Settings: `settings.ts`
