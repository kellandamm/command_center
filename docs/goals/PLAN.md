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

## Owner checks (not budget)

Use a **goals-specific owner helper** — do **not** reuse `isBudgetOwner` from budget (goals are not gated on `budgetAvailable`).

```ts
export function isGoalsOwner(who: AuthResult & { ok: true }): boolean {
  return who.owner === true && Boolean(who.email);
}
```

- **Todoist `createTask` confirm routes:** **`isGoalsOwner(who)` only** (403 + `OWNER_ACTION_FORBIDDEN` for admin-token / non-owner).
- **Non-Todoist writes** (create/edit goals, milestones, board links, local milestone complete): **`canManageSharedServerState(cfg, principal)`** (`owner-auth.ts`) — same bar as board card POST today; admin-token may write when `OWNER_EMAILS` unset or when configured for automation tests. **Never** call Todoist from these routes.

---

## Data model

`{dataDir}/goals.sqlite` — `GoalsStore.open` like `wins/store.ts` (`DatabaseSync`, migrations).

Tables: `goals`, `milestones`, `milestone_links` (`kind`: `board` | `todoist`).

**Todoist draft tokens:** `todoist_drafts` — `draft_token`, `milestone_id`, **`owner_email`** (lowercase, must match confirming user), payload `{ content, due }`, **`expires_at` ~10 minutes**, **`used_at`**. Single-use: confirm verifies `owner_email === who.email`; mismatch or reuse → 403/409 without second `createTask`.

---

## API routes

| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| GET | `/api/goals` | Authenticated | List goals + milestones + links |
| POST/PUT goals, milestones, board links | | `canManageSharedServerState` | CRUD; no Todoist |
| POST | `/api/goals/milestones/:id/todoist/create` | `isGoalsOwner` | `{ draftToken, preview }` — no Todoist HTTP; binds token to `who.email` |
| POST | `/api/goals/milestones/:id/todoist/confirm` | `isGoalsOwner` | Body `{ draftToken }` — **`createTask`** once; mark token used |

**Do not** expose `completeTask` in v1 unless adding a **separate confirm-gated** route with the same draft-token + `isGoalsOwner` pattern.

Board links: no Todoist confirmation. Card → `DONE` may suggest UI completion only—no auto milestone complete.

JSON `cache-control: no-store` (`board/routes.ts` style). CSRF: `csrfOk` + `x-ah` (`auth.ts`).

---

## UI

`apps/server/src/ui/goals-page.ts` — `pageHeader`, `dialog()` (`components.ts`).

Todoist preview → confirm: **only `isGoalsOwner`** sees confirm (parallel to budget page owner script gating in `budget-page.ts` / `http.ts` `/budget`).

Focus: **`trapSidebarTab`** / `.sidebar-inset` `inert` from `layout.ts`.

---

## Privacy and security

| Rule | Enforcement |
|------|-------------|
| Todoist token server-only | Never in JSON |
| Todoist confirm owner-only | `isGoalsOwner` |
| draftToken bound to owner email | Store + tests |
| No budget / briefings / ntfy | Import grep |
| No new deps/env | Review |

---

## Tests

**Unit:** `goals-store.test.ts`, `goals-todoist-confirm.test.ts` (double submit → one `createTask`; wrong owner → 403; expired token → 410).

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
- `apps/server/src/auth.ts` `csrfOk`; owner flag lines 40–48.
- `apps/server/src/owner-auth.ts` `canManageSharedServerState`, `OWNER_ACTION_FORBIDDEN`.
- `apps/server/src/ui/components.ts` `dialog`; `layout.ts` focus patterns.
- `apps/server/src/wins/store.ts` (sqlite file pattern).
