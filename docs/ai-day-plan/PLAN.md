# AI day plan — implementation plan

**AI day plan** for Stremmy (Dayplan-style): build today’s schedule from calendar, Todoist, and Board time blocks; warn on over-capacity; **up to three** editable must-dos; scheduled breaks; end-of-day shutdown tied to existing review data. **Budget, subscriptions, and home-vault data must never reach the LLM.** Reuses `chatCompletion` (`apps/server/src/llm/provider.ts`), calendar snapshot + block matching (same `eventId` join as `buildShutdownReview`), Todoist `partitionTodayAndOverdue`, and shutdown review shapes.

**Out of scope:** new LLM provider, MCP tools, ntfy push of plans, auto-writing Todoist/Board without explicit user actions, budget/subscription/vault surfaces.

**Cross-cutting:** **no new env vars**; **`cfg.tz`** for all day boundaries (including shutdown paths — see PR1); shadcn gray + royal blue (`--primary`) + orange warnings (`--warning` / `dashboard-status-dot--orange`).

**Build order:** PR-sized steps at end (**core → API → page → widget → LLM last**; deterministic planner covers the full spec without a model).

---

## User flow

1. **Morning (owner):** Open dashboard **Day plan** widget or **`/day-plan`**. Server loads plan for `dayKey(now, cfg.tz)`. On **first owner load of the day** with no saved plan, run **deterministic generate only** (no LLM). Widget shows capacity bar, must-dos (1–3), next meeting; link **Open full plan**.
2. **Edit:** On `/day-plan`, user toggles must-do completion (UI-only v1), swaps a must-do from **alternates** returned on `GET /api/day-plan`, adjusts break times (within working window), edits working hours for this day only. Saves via PUT (no LLM).
3. **AI refresh:** **Generate with AI** button only when `llmConfigured(cfg)` — never on first load. **Refresh plan** re-runs deterministic planner only.
4. **During day:** Widget refreshes on page load (no WebSocket). Over-capacity banner uses **orange**; lists deterministic **defer suggestions**.
5. **Shutdown:** Same page section **End of day** (or link to `/briefing` shutdown tab): `GET /api/briefing/shutdown` + optional reflection POST (existing). **`rolledToTomorrow`** is computed **at read time** on `GET /api/day-plan` (open must-dos + unfinished scheduled items for today) — no day-boundary cron or background job.

Non-owners: no nav tab, no widget in catalog, all `/api/day-plan/*` → **403** `OWNER_ACTION_FORBIDDEN`.

---

## Data sources (exact fields read)

Gather in `day-plan/gather.ts` with **explicit field picks** — never spread `planning().cards` (`workspace.ts` spreads `...card` and would pull `notes`).

| Source | API / module | Fields used in planner (server) | Never sent to LLM |
|--------|----------------|----------------------------------|-------------------|
| Calendar | `CalendarWorkspace.snapshot({ rangeStart, rangeEnd, limit: 500 })` | Timed `events[]`: `summary`, `start`, `end`, `allDay`, `timezone`, `eventId`. **All-day events:** UI labels only — **excluded from capacity and LLM meetings list**. Board blocks: match snapshot rows to `planning().blocks` by **`eventId`** (same loop as `shutdown-service.ts` ~277–286), then read block `taskId` — **not** `durationMinutes` on block defs (occurrence `start`/`end` from snapshot). | `description`, `location`, feed names/URLs, raw Google/`eventId` strings, attendees, `noteId`, `spaceId` |
| Board | `BoardStore.list()` + scheduled flag from block join above | `id`, `title`, `column`, `estimatedMinutes`, `dueDate`, `priority`; include in capacity only if **`dueDate <= day`** and column ≠ `Done` | `notes`, `hobieTaskId` |
| Todoist | `listTasks` + `partitionTodayAndOverdue(open, now, cfg.tz)` | **`overdue` + `today` slices only** for capacity and must-do pool: `id`, `content`, `priority`, due day | `description`, `url`, tokens |
| Settings | `SettingsStore` (existing) | None in v1 | — |
| Shutdown | `buildShutdownReview` (shutdown section only) | Same public shapes as `/api/briefing/shutdown` response | Full review already sanitized for reflection POST separately |

**Excluded modules (must not import):** `budget/*`, subscription rollup paths, `home-vault` / vault blobs. `day-plan/excluded.ts` documents policy (mirror `budget/excluded.ts`).

**PR1 note:** Today `buildShutdownReview` / `parseClientShutdownReview` hard-code `SHUTDOWN_TZ = "America/Chicago"` (`shutdown-service.ts` ~20, 87, 171). When extracting `day-duration.ts`, **parameterize shutdown on `cfg.tz`** in the same small follow-up commit within PR1 (day-plan must not import Chicago-only paths).

---

## LLM prompt input / output

### When LLM runs

- **Only** on explicit **Generate with AI** when `llmConfigured(cfg)` — not on first load, not on **Refresh plan**.
- Rate limit: **6 generations / hour / owner** (in-memory, like notes Q&A pattern).

### Input allowlist (exact JSON keys sent as `user` message)

1. `buildDayPlanLlmInput()` maps sources with **per-field literals** (no object spread from board/calendar/todoist rows).
2. **`DayPlanLlmInputSchema.strict()`** with **`.strict()` on every nested object** (`capacity`, each meeting, each task).
3. **`generate.ts` call site:** `const payload = DayPlanLlmInputSchema.parse(buildDayPlanLlmInput(...))` then **only** `JSON.stringify(payload)` as the user message — no other keys, no pre-parse object.

```ts
{
  day: string;
  timezone: string;
  workStart: string;
  workEnd: string;
  capacity: {
    availableMinutes: number;
    meetingMinutes: number;
    blockedTaskMinutes: number;
    unscheduledTaskMinutes: number;
    overByMinutes: number;
  };
  meetings: Array<{
    ref: string;           // opaque "m1" | "m2" — server map only; NOT Google eventId (base64 embeds calendar id, often email — google.ts:56-57)
    title: string;
    start: string;
    end: string;
  }>;
  tasks: Array<{
    id: string;
    source: "board" | "todoist";
    title: string;
    priority: number;
    dueDay: string | null;
    estimateMinutes: number | null;
    scheduled: boolean;
  }>;
}
```

Timed meetings only (`allDay` omitted from LLM payload entirely).

**System prompt:** Return strict JSON only; pick **up to 3** `mustDo` task refs (fewer if input has fewer tasks), ordered; suggest `breaks` in free gaps; optional `theme` (max 120 chars). No markdown.

### Output schema (parsed + clamped)

```ts
{
  mustDo: Array<{ source: "board" | "todoist"; id: string }>;  // length 1–3
  breaks: Array<{ startLocal: string; minutes: number }>;
  theme?: string;
  deferTaskIds?: Array<{ source: "board" | "todoist"; id: string }>;
}
```

**Post-parse validation:** Drop/reject any `mustDo` / `deferTaskIds` entry whose `(source, id)` is **not** in the input `tasks` list; if zero valid must-dos remain or JSON invalid → **deterministic fallback**. Never trust LLM for capacity numbers.

### Enforcement + leak test

| Layer | Location |
|-------|----------|
| Field mapper | `day-plan/llm-input.ts` — explicit picks only |
| Zod in | `DayPlanLlmInputSchema.strict()` nested strict objects |
| Zod out | `day-plan/llm-output.ts` |
| Call site | `day-plan/generate.ts` — **`chatCompletion` receives only `DayPlanLlmInputSchema.parse(...)`** |
| CI guard | `day-plan/excluded.ts` + grep (no `budget/`, subscriptions, vault) |
| **Leak test** | `day-plan-llm-allowlist.test.ts`: plant `PLANT_*` in **source objects the gatherer reads** — `card.notes`, `task.description`, event `description`/`location`, fake extra keys on cards — then run generate with **mock `fetch`**. Assert **`JSON.parse` of the POST body `messages` user content** contains no `PLANT_*` and matches strict schema keys only. Also seed budget/subscription/vault strings elsewhere to prove builder never reads those modules. |

**Logging:** Do not log raw LLM error bodies (`provider.ts` ~33 exposes up to 200 chars in thrown `Error` — day-plan catch paths log **status/code only**, same as budget redact discipline).

---

## Fallback when LLM fails

**Deterministic planner** (`day-plan/planner.ts`), no model:

1. **Timeline:** all-day events as non-capacity labels; timed meetings from snapshot (clipped to work window); board work blocks from snapshot occurrences joined to blocks by `eventId`.
2. **Must-dos:** up to **3** from scored pool (today/overdue Todoist + board due ≤ day); fewer if pool smaller.
3. **Breaks:** choose **nearest free gap ≥ 15 min** within the work window that does **not** overlap clipped meetings/blocks; place **15 min** break there. If no gap ≥ 15 min, omit break row (do not place inside a meeting or at blind “midpoint” of window).
4. **Defer list:** remaining pool tasks by lowest score.
5. Persist `generatedBy: "deterministic" | "llm"`.

---

## Capacity math

All in **`cfg.tz`** via **`durationMsOnDay`** in `apps/server/src/calendar/day-duration.ts` (extract from `shutdown-service.ts`, re-export for shutdown after **`cfg.tz` parameterization**).

- **Working window:** default **`09:00`–`17:00`** local (`calendar/workspace.ts` preview defaults). Per-day override on plan row (`work_start`, `work_end`).
- **`availableMinutes`:** minutes between workStart and workEnd on `day` (weekend default **0** unless override — see open questions).
- **`meetingMinutes`:** timed, non-block events only: clip each interval to `[workStart, workEnd]`, **merge overlapping** clipped intervals, sum minutes. **Skip all-day.**
- **`blockedTaskMinutes`:** timed snapshot occurrences with `eventId` matching a `planning().blocks` entry with `taskId`: same clip + merge rules.
- **`unscheduledTaskMinutes`:** sum estimates for **eligible tasks only**: Todoist **`partitionTodayAndOverdue` → overdue + today**; Board **`dueDate <= day`**, not `Done`, not already counted in blocked minutes. Use `estimatedMinutes` or **30** default when null.
- **`overByMinutes`:** `max(0, meeting + blocked + unscheduled - available)`.

**Tests:** `day-plan-capacity.test.ts` — Chicago/Tokyo, DST edges, all-day excluded, overlap merge, overdue-only Todoist, clip-to-window.

---

## Storage

**File:** `{dataDir}/day-plan.sqlite` — `DayPlanStore.open` like `wins/store.ts` (`DatabaseSync`, migrations).

| Table | Columns |
|-------|---------|
| `plan_days` | `day` PK, `timezone`, `work_start`, `work_end`, `generated_at`, `generated_by`, `theme` (nullable), `capacity_json` |
| `plan_items` | `id`, `day`, `kind` (`meeting` \| `block` \| `break` \| `task`), `source`, `ref_id`, `title`, `start_iso`, `end_iso`, `sort_order`, `completed_at` |
| `plan_must_dos` | `day`, `slot` (0–2), `source`, `ref_id`, `user_locked` |

Migration v1 in `day-plan/db.ts`. `capacity_json` holds derived numbers only.

User key: owner-only v1; optional `owner_email` later if multi-owner.

---

## API routes and auth

`isDayPlanOwner(who)` = `who.owner === true && Boolean(who.email)` — **CF-verified owner** (prod behind Cloudflare Access). **Do not widen** to `admin-token` or `canManageSharedServerState` for day-plan routes.

| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| GET | `/api/day-plan?day=YYYY-MM-DD` | `isDayPlanOwner` | Plan + **alternates** (ranked tasks not in must-dos) + **`rolledToTomorrow`** computed at read time; `{ ready: false }` if none |
| POST | `/api/day-plan/generate` | `isDayPlanOwner` | Body `{ day?, useLlm?: boolean }` — `useLlm: true` only from UI **Generate with AI** |
| PUT | `/api/day-plan` | `isDayPlanOwner` | Edits must-dos, breaks, completions, work window |

Wire in `http.ts` near briefing routes. JSON **`cache-control: no-store`**. CSRF: `csrfOk` + `x-ah`. No secrets in responses.

**Shutdown (related):** Day-plan page uses existing shutdown APIs. Recommended: tighten **`GET /api/briefing/shutdown`** to **verified owner email** (match reflection POST, `daily-briefing/routes.ts` ~47) in a **small separate PR** — see open questions.

---

## UI

| Surface | Size / layout | Why |
|---------|----------------|-----|
| **Dashboard widget** `ai-day-plan` | Default **`W`**; **`ownerOnly: true`**; catalog **Agenda**; over-capacity subtitle **orange** | At-a-glance on revamp grid; hidden from non-owner catalog/layout |
| **Page** `/day-plan` | Timeline, must-do editor, breaks, shutdown section | Full editing surface |

**Registry epoch:** bump `CURRENT_REGISTRY_EPOCH` in `widgets.ts`; extend **`widgetIdsIntroducedAfterEpoch`** to skip **`ownerOnly`** widgets for non-owner sessions **generally** (same gate as `showServiceStatus` — not budget-only).

**Mobile 375px:** Single column; full-width capacity bar (see `docs/dashboard-revamp/PLAN.md`).

**Nav:** Tab **`day-plan`**, owner-only visibility (`http.ts` budget pattern).

**Widget body:** `widgets/ai-day-plan.ts`; no secrets in HTML.

---

## Env and server changes

| Item | Needed? |
|------|---------|
| New env vars | **No** |
| Feature flags | **No** (`DAY_PLAN_ENABLED` not used) |
| New npm deps | **No** |
| Auth | Existing `OWNER_EMAILS` + CF Access |
| Data migration | `day-plan.sqlite` on first open |
| Server deploy | Normal app deploy |

---

## Test plan

**Unit**

- `day-plan-capacity.test.ts` — clip, merge, all-day skip, partitionTodayAndOverdue, board due filter
- `day-plan-planner.test.ts` — ≤3 must-dos, break in free gap, block join by `eventId`
- `day-plan-llm-allowlist.test.ts` — **mock fetch body** + planted source fields; strict schema
- `day-plan-store.test.ts`
- `day-plan-owner.test.ts` — **403 on every route** for: **admin-token**, **service-token**, **non-owner email**, **`OWNER_EMAILS` empty** (insecure mode visitor); owner email **200**
- `day-plan-excluded.test.ts`

**Browser:** `day-plan.browser.ts`; owner widget add from drawer.

**Revert guards:** `day-plan/*` no budget/subscriptions/vault imports.

---

## Rollout

1. Merge plan PR (docs only).
2. Ship **PR1 core** (deterministic) — owner routes safe without nav until PR4.
3. Enable nav + widget epoch (**ownerOnly** append rules).
4. Prod without `LLM_*` → deterministic only.
5. Error logs: no token/LLM body substrings.

---

## Open questions (Kellan)

Each item keeps the product question; **recommended default (pending Kellan)** is what we implement until answered.

1. **Weekends:** Should default `availableMinutes` be **zero** on Sat/Sun unless the user sets a custom work window, or always use 09:00–17:00?  
   **Recommended default (pending Kellan):** **0h** on Sat/Sun unless user overrides work window on that day.

2. **Todoist descriptions:** Confirm excluded from LLM; any other Todoist fields for ranking?  
   **Recommended default (pending Kellan):** **Excluded** — LLM and planner use **title (`content`), priority, due day only**.

3. **Shutdown GET auth:** Keep `canManageSharedServerState` or owner email only?  
   **Recommended default (pending Kellan):** **`GET /api/briefing/shutdown` requires verified owner email** (like reflection POST) — implement as **small separate PR**, not bundled with day-plan feature PRs.

4. **Must-do completion:** UI-only or sync Todoist/Board?  
   **Recommended default (pending Kellan):** **UI-only in v1** (plan `completed_at` only).

5. **Auto-generate:** First load vs explicit Generate?  
   **Recommended default (pending Kellan):** **Deterministic plan on first owner load of the day**; **LLM only on “Generate with AI” click**.

6. **Break defaults:** Server template vs Focus localStorage?  
   **Recommended default (pending Kellan):** **Server break template** (free gap ≥ 15 min, no Focus localStorage read).

---

## PR-sized build sequence

1. **PR1 — Core:** `day-duration.ts` extract + **shutdown `cfg.tz` fix**; `DayPlanStore`; `gather.ts` (explicit fields, `eventId` block join); deterministic planner + capacity tests; `excluded.ts` + grep.
2. **PR2 — API:** routes, `isDayPlanOwner`, read-time `rolledToTomorrow` + alternates on GET, owner matrix tests.
3. **PR3 — Page:** `day-plan-page.ts`, nav (owner), shutdown embed, browser test.
4. **PR4 — Widget:** `ai-day-plan` **`ownerOnly: true`**, registry epoch + **general `ownerOnly` epoch skip**, dashboard smoke.
5. **PR5 — LLM last:** strict allowlist, output validation, mock-fetch leak test, **Generate with AI** only.

---

## Reference paths

- Calendar: `apps/server/src/calendar/workspace.ts`, `calendar/google.ts` (opaque ids)
- Shutdown: `apps/server/src/briefing/shutdown-service.ts` (`eventId` ↔ blocks)
- LLM: `apps/server/src/llm/provider.ts`, `apps/server/src/quick-add/parse.ts`
- Todoist: `partitionTodayAndOverdue` in `apps/server/src/todoist/client.ts`
- Board: `apps/server/src/board/store.ts`, `types.ts`
- Dashboard: `apps/server/src/dashboard-layout/widgets.ts` (`ownerOnly`, epoch append)
- Theme: `apps/server/src/ui/theme-tokens.ts`
- Privacy: `apps/server/test/budget-privacy.test.ts`, `budget/excluded.ts`
