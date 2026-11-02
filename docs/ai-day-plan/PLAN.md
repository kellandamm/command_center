# AI day plan — implementation plan

**AI day plan** for Stremmy (Dayplan-style): build today’s schedule from calendar, Todoist, and Board time blocks; warn on over-capacity; **exactly three** editable must-dos; scheduled breaks; end-of-day shutdown tied to existing review data. **Budget, subscriptions, and home-vault data must never reach the LLM.** Reuses `chatCompletion` (`apps/server/src/llm/provider.ts`), calendar snapshot/planning, Todoist client, and `buildShutdownReview` (`apps/server/src/briefing/shutdown-service.ts`).

**Out of scope:** new LLM provider, MCP tools, ntfy push of plans, auto-writing Todoist/Board without explicit user actions, budget/subscription/vault surfaces.

**Cross-cutting:** prefer **no new env vars**; **`cfg.tz`** for all day boundaries; shadcn gray + royal blue (`--primary`) + orange warnings (`--warning` / `dashboard-status-dot--orange`).

**Build order:** PR-sized steps at end (store → planner → LLM → API → page → widget).

---

## User flow

1. **Morning (owner):** Open dashboard **Day plan** widget or **`/day-plan`**. Server loads or generates plan for `dayKey(now, cfg.tz)`. If no saved plan or user clicks **Refresh plan**, gather sources → optional LLM rank/schedule → persist. Widget shows capacity bar, three must-dos, next meeting; link **Open full plan**.
2. **Edit:** On `/day-plan`, user toggles must-do completion, swaps a must-do from ranked alternates, adjusts break times (within working window), edits working hours for this day only. Saves via POST (no LLM).
3. **During day:** Widget refreshes on load (no WebSocket). Over-capacity banner uses **orange** (`var(--warning)`); lists deterministic **defer suggestions** (lowest-priority / unscheduled tasks first).
4. **Shutdown:** Same page section **End of day** (or link to `/briefing` shutdown tab): `GET /api/briefing/shutdown` + optional reflection POST (existing). Day plan marks rolled items: open must-dos + unfinished scheduled tasks → **`rolledToTomorrow`** on save or auto at day boundary.

Non-owners: no nav tab, no widget in catalog, all `/api/day-plan/*` → **403** `OWNER_ACTION_FORBIDDEN`.

---

## Data sources (exact fields read)

| Source | API / module | Fields used in planner (server) | Never sent to LLM |
|--------|----------------|----------------------------------|-------------------|
| Calendar | `CalendarWorkspace.snapshot({ rangeStart, rangeEnd, limit: 500 })` | `events[]`: `summary`, `start`, `end`, `allDay`, `timezone` (fallback `cfg.tz`), `eventId`; block link via `planning().blocks` → `taskId`, block `start`/`end`/`durationMinutes` | `description`, `location`, feed names/URLs, Google ids, `noteId`, `spaceId` |
| Board | `BoardStore.list()` + `planning().cards` | `id`, `title`, `column`, `estimatedMinutes`, `dueDate`, `priority`, `scheduled` (from planning) | `notes`, `hobieTaskId`, internal ids in UI only |
| Todoist | `listTasks` when `todoistConfigured(cfg)` | `id`, `content`, `priority`, `due.date` / `due.datetime` (for due-day only) | `description`, `url`, tokens |
| Settings | `SettingsStore` (existing) | Optional future: none in v1 | — |
| Shutdown | `buildShutdownReview` (shutdown section only) | Same public shapes as `/api/briefing/shutdown` response | Full review already sanitized for reflection POST separately |

**Excluded modules (must not import):** `budget/*`, subscription rollup paths, `home-vault` / vault blobs. `day-plan/excluded.ts` documents policy (mirror `budget/excluded.ts`).

---

## LLM prompt input / output

### When LLM runs

- **Only** on explicit **Generate with AI** or first-time **Refresh plan** when `llmConfigured(cfg)`; otherwise **deterministic planner only**.
- Rate limit: **6 generations / hour / owner** (in-memory, like notes Q&A pattern).

### Input allowlist (exact JSON keys sent as `user` message)

Built only by `buildDayPlanLlmInput()` in `day-plan/llm-input.ts`, validated with Zod before `chatCompletion`:

```ts
{
  day: string;           // YYYY-MM-DD
  timezone: string;      // cfg.tz
  workStart: string;     // HH:mm
  workEnd: string;       // HH:mm
  capacity: {
    availableMinutes: number;
    meetingMinutes: number;
    blockedTaskMinutes: number;
    unscheduledTaskMinutes: number;
    overByMinutes: number;
  };
  meetings: Array<{ id: string; title: string; start: string; end: string; allDay: boolean }>;
  tasks: Array<{
    id: string;
    source: "board" | "todoist";
    title: string;
    priority: number;      // Todoist 1–4; board mapped low=1 normal=2 high=3
    dueDay: string | null;
    estimateMinutes: number | null;
    scheduled: boolean;
  }>;
}
```

**System prompt:** Return strict JSON only; pick **exactly 3** `mustDo` task refs, ordered; suggest `breaks` as `{ startLocal: "HH:mm", minutes: number }[]` inside working window; optional one-line `theme` (max 120 chars). No markdown.

### Output schema (parsed + clamped)

```ts
{
  mustDo: Array<{ source: "board" | "todoist"; id: string }>;  // length 3
  breaks: Array<{ startLocal: string; minutes: number }>;        // max 6, minutes 5–30
  theme?: string;
  deferTaskIds?: Array<{ source: "board" | "todoist"; id: string }>; // optional hints only
}
```

Post-parse: merge with deterministic schedule (meetings fixed); if LLM returns invalid JSON or wrong must-do count → **fallback** (below). Never trust LLM for capacity numbers.

### Enforcement + leak test

| Layer | Location |
|-------|----------|
| Allowlist builder | `day-plan/llm-input.ts` — only mapped fields |
| Zod parse in | `day-plan/llm-input.ts` `DayPlanLlmInputSchema` |
| Zod parse out | `day-plan/llm-output.ts` |
| Call site | `day-plan/generate.ts` — only passes `JSON.stringify(buildDayPlanLlmInput(...))` |
| CI guard | `day-plan/excluded.ts` + grep test (no `budget/`, `subscriptions`, vault imports) |
| **Leak test** | `day-plan-llm-allowlist.test.ts`: seed BudgetStore payee, subscription label, vault filename into data dir; build input with planted strings in **disallowed** fields (`card.notes`, `task.description`, etc.); assert `JSON.stringify(input)` and mock `chatCompletion` messages contain **none** of `PLANT_*` constants; assert disallowed top-level keys absent via schema strict mode |

---

## Fallback when LLM fails

**Deterministic planner** (`day-plan/planner.ts`), no model:

1. Fixed timeline: all-day markers as labels; timed meetings from snapshot; Board blocks from `planning().blocks` occurrences today.
2. **Must-dos (3):** score = due today/overdue + priority + (scheduled ? 0 : +1) + estimate fit; top 3 distinct tasks.
3. **Breaks:** insert **15 min** at midpoint of working window if `(available - meeting - blocked) >= 120` min; else **10 min** once after longest meeting gap if gap ≥ 45 min (reuse focus defaults conceptually: 25/5 panel uses client localStorage — server uses fixed template).
4. **Defer list:** tasks not in must-dos, sorted by lowest score, until `unscheduledTaskMinutes <= available slack`.
5. Persist `generatedBy: "deterministic" | "llm"` on plan record.

---

## Capacity math

All in **`cfg.tz`** using shared helper extracted from shutdown: **`durationMsOnDay`** → `apps/server/src/calendar/day-duration.ts` (move from `shutdown-service.ts`, re-export for shutdown).

- **Working window:** default **`09:00`–`17:00`** local (same defaults as calendar event preview, `calendar/workspace.ts`). Per-day override stored on plan row (`work_start`, `work_end`).
- **`availableMinutes`:** minutes between workStart and workEnd on `day`, minus **weekend optional**: v1 treats Sat/Sun as **0 available** unless user overrides window (Kellan question).
- **`meetingMinutes`:** sum of `durationMsOnDay` for events **without** `taskId` block link.
- **`blockedTaskMinutes`:** sum for occurrences linked to Board blocks (`planning().blocks`).
- **`unscheduledTaskMinutes`:** sum of `estimatedMinutes` (or **30** default when null) for open tasks (board not DONE + todoist open) **not** counted in blocked minutes today.
- **`overByMinutes`:** `max(0, meeting + blocked + unscheduled - available)`.
- **Warnings:** UI when `overByMinutes > 0` (orange); copy lists top defer suggestions from deterministic rank.

**Tests:** `day-plan-capacity.test.ts` with `TZ=America/Chicago` and `TZ=Asia/Tokyo`; DST spring-forward day (Chicago: no 2:30 AM block); fall-back ambiguous hour handled by using UTC instants from calendar layer.

---

## Storage

**File:** `{dataDir}/day-plan.sqlite` — `DayPlanStore.open` like `wins/store.ts` / `goals` pattern (`DatabaseSync`, migrations).

| Table | Columns |
|-------|---------|
| `plan_days` | `day` PK, `timezone`, `work_start`, `work_end`, `generated_at`, `generated_by`, `theme`, `capacity_json`, `llm_theme` |
| `plan_items` | `id`, `day`, `kind` (`meeting` \| `block` \| `break` \| `task`), `source`, `ref_id`, `title`, `start_iso`, `end_iso`, `sort_order`, `completed_at` |
| `plan_must_dos` | `day`, `slot` (0–2), `source`, `ref_id`, `user_locked` (bool — user picked alternate) |

Migration v1 in `day-plan/db.ts`. No blob storage. JSON in `capacity_json` is derived fields only (no secrets).

User key: single-owner deployment (Kellan); same as goals — **owner-only module**, no per-email row required in v1; if multi-owner later, add `owner_email` column (open question).

---

## API routes and auth

`isDayPlanOwner(who)` = `who.owner === true && Boolean(who.email)` (same as `isGoalsOwner` in `docs/goals/PLAN.md`).

| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| GET | `/api/day-plan?day=YYYY-MM-DD` | `isDayPlanOwner` | Load plan or 404 `{ ready: false }` |
| POST | `/api/day-plan/generate` | `isDayPlanOwner` | Body `{ day?, useLlm?: boolean }`; gather + plan + persist |
| PUT | `/api/day-plan` | `isDayPlanOwner` | User edits must-dos, breaks, completions, work window |
| GET | `/api/day-plan/sources` | `isDayPlanOwner` | Read-only gathered tasks/meetings for UI (no LLM) |

Wire in `http.ts` near briefing routes. JSON **`cache-control: no-store`**. CSRF: `csrfOk` + `x-ah`. Responses: no Todoist token, no ICS URLs, no LLM keys, no raw card `notes`.

Shutdown: **reuse** `GET /api/briefing/shutdown` (today `canManageSharedServerState` — day-plan page calls it for owner; optional follow-up to align shutdown GET with owner-only — open question).

---

## UI

| Surface | Size / layout | Why |
|---------|----------------|-----|
| **Dashboard widget** `ai-day-plan` | Default **`W`** (6×1); catalog **Agenda**; status dot **blue**; over-capacity → card subtitle **orange** | At-a-glance must-dos + capacity on revamp grid (`dashboard-layout/widgets.ts`, bump `CURRENT_REGISTRY_EPOCH`) |
| **Page** `/day-plan` | Full `pageHeader`, timeline list, must-do editor, break rows, shutdown section | Editing three must-dos and breaks needs space; drawer alone is too cramped for timeline + defer list |

**Not drawer-only:** Quick-add drawer stays for capture; day plan is not a transient overlay.

**Mobile 375px:** Single column; timeline stacks; must-dos as full-width cards; capacity bar full width (same as dashboard grid `375px` tests in `docs/dashboard-revamp/PLAN.md`).

**Nav:** Sidebar tab **`day-plan`** (workspace group), **`visibleNavTabs` only when `who.owner`** (budget tab pattern in `http.ts`).

**Theme:** `page()`, `statCard`, `button()` from `components.ts`; warnings use `--warning`, actions/focus `--primary`.

**Widget body:** server-rendered fragment in `widgets/ai-day-plan.ts` (pattern `today-agenda.ts`); no secrets in HTML.

---

## Env and server changes

| Item | Needed? |
|------|---------|
| New env vars | **No** — uses existing `TODOIST_API_TOKEN`, `LLM_*`, Google/ICS via existing calendar config |
| New npm deps | **No** |
| Auth | `OWNER_EMAILS` + CF Access (existing) |
| Data migration | Create `day-plan.sqlite` on first open |
| Server deploy | Normal app deploy; no compose change |

---

## Test plan

**Unit**

- `day-plan-capacity.test.ts` — Chicago/Tokyo, DST edge, over-capacity math
- `day-plan-planner.test.ts` — deterministic must-dos, breaks, defer ordering
- `day-plan-llm-allowlist.test.ts` — allowlist keys only; **PLANT leak failure**
- `day-plan-store.test.ts` — migrations, must-do slot uniqueness
- `day-plan-owner.test.ts` — non-owner 403 on all routes
- `day-plan-excluded.test.ts` — no budget/subscriptions/vault imports (grep + `excluded.ts`)

**Browser** (`test:dashboard-browser`)

- `day-plan.browser.ts` — owner: generate, edit must-do, over-capacity orange, 375px layout
- Widget: add **Day plan** from drawer, persists in layout v3

**Revert guards**

- Extend `budget-subscriptions-guards.test.ts` or parallel: `day-plan/*` must not import budget/subscriptions/vault
- Snapshot: LLM mock records message keys only (no raw task descriptions)

---

## Rollout

1. Merge plan PR (docs only).
2. Ship store + deterministic planner behind flag **`DAY_PLAN_ENABLED=1`** optional — prefer **no flag**: owner-only routes safe to ship dark until nav enabled.
3. Enable nav + widget registry epoch for owner sessions.
4. Verify LLM off → deterministic plan still works in prod.
5. Monitor logs: no `todoist` token substrings (reuse budget redact patterns for errors).

---

## Open questions (Kellan)

1. **Weekends:** Should default `availableMinutes` be **zero** on Sat/Sun unless the user sets a custom work window, or always use 09:00–17:00?
2. **Todoist descriptions:** Confirm **excluded** from LLM (plan assumes yes); any field from Todoist besides title/priority/due needed for ranking?
3. **Shutdown GET auth:** Keep **`canManageSharedServerState`** for `/api/briefing/shutdown` (admin token OK) or restrict shutdown + day-plan to **verified owner email only**?
4. **Must-do completion:** Checking a must-do on the plan **UI-only**, or sync completion to Todoist/Board (with confirm)?
5. **Auto-generate:** Run deterministic plan **once at first dashboard load** each day, or require explicit **Generate** every morning?
6. **Break defaults:** OK with server template (15 min midpoint / 10 min gap) vs reading Focus panel localStorage (client-only today)?

---

## PR-sized build sequence

1. **PR1 — Core:** `day-duration` extract, `DayPlanStore`, gather service, deterministic planner, capacity tests, excluded module + grep test.
2. **PR2 — LLM:** `llm-input` / `llm-output`, `generate.ts`, allowlist leak test, fallback integration tests.
3. **PR3 — API:** routes, owner auth, HTTP wiring, owner 403 tests.
4. **PR4 — Page:** `day-plan-page.ts`, nav tab (owner), shutdown section embed, browser test.
5. **PR5 — Widget:** `widgets/ai-day-plan.ts`, registry epoch + default layout append, dashboard browser smoke.

---

## Reference paths

- Calendar: `apps/server/src/calendar/workspace.ts` (`snapshot`, `planning`)
- Shutdown: `apps/server/src/briefing/shutdown-service.ts`
- LLM: `apps/server/src/llm/provider.ts`, `apps/server/src/quick-add/parse.ts` (JSON extract pattern)
- Todoist: `apps/server/src/todoist/client.ts`
- Board: `apps/server/src/board/store.ts`, `types.ts`
- Dashboard: `apps/server/src/dashboard-layout/widgets.ts`, `docs/dashboard-revamp/PLAN.md`
- Theme: `apps/server/src/ui/theme-tokens.ts`
- Privacy precedent: `apps/server/test/budget-privacy.test.ts`, `budget/excluded.ts`
