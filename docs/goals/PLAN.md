# Goals & milestones — implementation plan

**Goals** with **milestones** linked to Todoist tasks and Board cards. Todoist writes (`createTask`, `completeTask` in `todoist/client.ts`) happen **only after explicit UI confirmation**—no silent API side effects.

**Out of scope:** email triage, agent memory, direct bank connection, auto-sync from budget/subscriptions, LLM goal decomposition.

**Build order:** One implementation PR; may follow periodic reviews. No budget imports.

---

## Scope

| In | Out |
|----|-----|
| `goals.sqlite` (or table set in dedicated file) | New OAuth scopes for Todoist |
| UI `/goals` with milestone progress | Automatic Todoist sync on board moves |
| Link milestones ↔ `BoardStore` cards ↔ Todoist task ids | MCP tools exposing goals (v1) |

---

## Data model

**File:** `{dataDir}/goals.sqlite` — `GoalsStore.open` mirroring `wins/store.ts` / `board/store.ts` (`node:sqlite` `DatabaseSync`, `schema_version` table per budget plan pattern).

| Table | Columns |
|-------|---------|
| `goals` | `id`, `title`, `description`, `target_date` nullable, `status` (`active` \| `completed` \| `archived`), `created_at`, `updated_at` |
| `milestones` | `id`, `goal_id`, `title`, `position`, `due_date` nullable, `completed_at` nullable |
| `milestone_links` | `milestone_id`, `kind` (`board` \| `todoist`), `external_id`, `created_at` |

Unique `(milestone_id, kind, external_id)`.

**Board link:** `external_id` = board card id (`BoardStore.get`, `board/routes.ts` CRUD). Display column/title from `board.list()`.

**Todoist link:** store Todoist task id from `createTask` response; completion state read via `listTasks` / user action—not polled every request (load on page open + after confirmed writes).

---

## API routes

Authenticated users may **read** goals (shared workspace visibility—same as board read today). **Writes** require `canManageSharedServerState(cfg, principal)` **or** stricter—default plan: **owner-only writes** if Kellan prefers; open question below.

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/api/goals` | List goals + milestones + link summaries |
| POST | `/api/goals` | Create goal |
| PUT | `/api/goals/:id` | Update / archive |
| POST | `/api/goals/:id/milestones` | Add milestone |
| PUT | `/api/goals/milestones/:id` | Edit / mark complete locally |
| POST | `/api/goals/milestones/:id/link` | Body `{ kind, externalId }` — validate card exists or Todoist id format |
| POST | `/api/goals/milestones/:id/todoist/create` | **Two-step:** returns `{ draft: { content, due } }` without calling Todoist |
| POST | `/api/goals/milestones/:id/todoist/confirm` | Body `{ confirm: true, draftToken }` — only then call `createTask` (`todoist/client.ts`) |

Board link creation does not need Todoist confirmation; moving a card to `DONE` (`board/types.ts`) can suggest milestone completion in UI but **does not** auto-complete milestone without button click.

JSON `cache-control: no-store` (`board/routes.ts` helper style).

---

## UI

| Piece | Files |
|-------|-------|
| Page | `apps/server/src/ui/goals-page.ts` — `#85` `pageHeader`, milestone list, link picker (board cards from `/api/board/cards`, Todoist tasks when configured) |
| Confirmation modal | Reuse `dialog()` from `components.ts` (as `notes-page.ts`); focus trap via shared `layout.ts` Esc/inert pattern |
| Todoist flow | Step 1 preview task title/due → Step 2 “Create in Todoist” button sets `x-ah: 1` POST confirm |

Route: `GET /goals` in `http.ts`; optional nav entry in `nav-tabs.ts` (workspace group).

---

## Privacy and security

| Rule | Enforcement | Test |
|------|-------------|------|
| Todoist token never sent to browser | Server-side `cfg.todoistApiToken` only | Route test |
| No goal text in LLM briefing by default | No import into `shutdown-service` / reviews without explicit future PR | Grep |
| CSRF on confirm POST | `csrfOk` (`auth.ts`) + `x-ah` header | Existing pattern test |
| Budget excluded | No budget fields | N/A |

Goals are not owner-gated like budget unless Kellan chooses owner-only writes.

---

## Tests

**Unit:** `goals-store.test.ts`, `goals-todoist-confirm.test.ts` (confirm false → no fetch to Todoist; mock fetch called once on confirm).

**Browser:** `goals.browser.ts` in `test:dashboard-browser` — link board card; Todoist confirm dialog blocks until clicked.

---

## PR breakdown

Single PR: `goals/` store + routes, `goals-page.ts`, `http.ts`, tests, optional nav.

---

## Open questions for Kellan

1. **Read access:** all authenticated users or owner-only entire module?
2. When a linked board card hits `DONE`, auto-check milestone complete with undo snackbar?
3. Show goals panel on dashboard (`panels/registry.ts`) in v1 or page-only?
4. Archive goal behavior for linked Todoist tasks (leave open vs prompt to complete)?

---

## Reference paths (existing)

- Board: `apps/server/src/board/store.ts`, `board/routes.ts`, `board/types.ts` `DONE`, `BOARD_COLUMNS`.
- Todoist: `apps/server/src/todoist/client.ts` `createTask`, `completeTask`, `listTasks`; `todoistConfigured` in `config.ts`.
- Calendar-task linking precedent: `apps/server/src/calendar/workspace.ts` `nativeDraft` task version checks.
- UI dialog: `apps/server/src/ui/components.ts` `dialog`; notes usage `notes-page.ts`.
- CSRF: `apps/server/src/auth.ts` `csrfOk`.
- SQLite: `apps/server/src/wins/store.ts`, `apps/server/src/board/store.ts`.
