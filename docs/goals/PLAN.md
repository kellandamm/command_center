# Goals & milestones — implementation plan

**Goals** with **milestones** linked to Board cards and Todoist tasks. **Todoist writes only after owner confirmation in the UI.** No silent `createTask` calls.

**Out of scope:** email triage, agent memory, direct bank connection, budget/subscription data, LLM decomposition, MCP tools in v1.

**Cross-cutting:** **no new dependencies or env vars**; **no budget data**; **budget alerts never in briefings or push** (goals module must not import budget).

**Build order:** One PR; may follow periodic reviews.

---

## Scope

| In | Out |
|----|-----|
| `goals.sqlite` | New Todoist OAuth scopes |
| `/goals` UI + milestone links | Auto Todoist sync on board moves |
| Board + Todoist links | `completeTask` without confirm (see below) |
| Owner-confirmed Todoist **create** only | MCP exposure v1 |

---

## Data model

`{dataDir}/goals.sqlite` — `GoalsStore.open` like `wins/store.ts` (`DatabaseSync`, migrations).

Tables: `goals`, `milestones`, `milestone_links` (`kind`: `board` | `todoist`).

**Todoist draft tokens:** server-side table or cache `todoist_drafts` — `draft_token` (random), `milestone_id`, payload `{ content, due }`, **`expires_at` ~10 minutes**, **`used_at`**. Single-use: confirm consumes token; duplicate confirm returns 409 without second `createTask`.

---

## API routes

Reads: authenticated users (same as board list today). **Todoist confirm and all writes that call Todoist: owner only** (`who.owner === true` + email, same bar as budget `ownerOk` — use shared `isBudgetOwner` pattern or parallel `isGoalsTodoistWriter` with identical owner check).

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/api/goals` | List goals + milestones + links |
| POST/PUT | `/api/goals`, milestones, board links | CRUD (per write policy above) |
| POST | `/api/goals/milestones/:id/todoist/create` | Returns `{ draftToken, preview }` — **no Todoist HTTP** |
| POST | `/api/goals/milestones/:id/todoist/confirm` | Body `{ draftToken }` — **`createTask`** once (`todoist/client.ts`); mark token used |

**Do not** expose `completeTask` in v1 unless adding a **separate confirm-gated** route (`/todoist/complete/confirm`) with the same draft-token pattern. Milestone completion stays local until explicitly designed.

Board links: no Todoist confirmation required. Card → `DONE` may suggest UI completion only—no auto milestone complete.

JSON `cache-control: no-store` (`board/routes.ts` style). CSRF: `csrfOk` + `x-ah` (`auth.ts`).

---

## UI

`apps/server/src/ui/goals-page.ts` — `pageHeader`, `dialog()` (`components.ts`, `notes-page.ts` pattern).

Todoist: preview → confirm dialog; only **owner** sees confirm button (match budget page owner gating pattern in `budget-page.ts` / `http.ts` `/budget`).

Focus: reuse **`trapSidebarTab`** / `.sidebar-inset` `inert` patterns from `layout.ts` for modal focus.

---

## Privacy and security

| Rule | Enforcement |
|------|-------------|
| Todoist token server-only | Never in JSON to browser |
| Owner-only Todoist confirm | Route checks |
| draftToken single-use | Store + tests |
| No budget / briefings / ntfy | Import grep |
| No new deps/env | Package + config review |

---

## Tests

**Unit:** `goals-store.test.ts`, `goals-todoist-confirm.test.ts` (double submit → one `createTask`; expired token → 410).

**Browser:** `goals.browser.ts` in `test:dashboard-browser`.

---

## PR breakdown

Single PR: `goals/` store, routes, `goals-page.ts`, `http.ts`, tests.

---

## Open questions for Kellan

1. Goal **read** access: all authenticated users or owner-only module?
2. Board card → DONE: suggest milestone complete with undo?
3. Dashboard panel in v1?
4. Archive goal while Todoist task open?

---

## Reference paths

- `apps/server/src/board/store.ts`, `board/routes.ts`, `board/types.ts` `DONE`.
- `apps/server/src/todoist/client.ts` `createTask`, `listTasks`; `todoistConfigured` in `config.ts`.
- `apps/server/src/auth.ts` `csrfOk`; `auth.ts` owner flag lines 40–48.
- `apps/server/src/ui/components.ts` `dialog`; `layout.ts` focus patterns.
- `apps/server/src/wins/store.ts` (sqlite file pattern).
- `apps/server/src/budget/routes.ts` `ownerOk` → shared extract for owner-only writes.
