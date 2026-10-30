# Goals & milestones — implementation plan

**Owner-only** goals with **milestones** linked to Board cards and Todoist tasks. **Todoist writes only after owner confirmation in the UI.** No silent `createTask` calls.

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

## Owner access

**Owner-only for all reads and writes** (Kellan). Do **not** use `canManageSharedServerState` or `isBudgetOwner`.

```ts
export function isGoalsOwner(who: AuthResult & { ok: true }): boolean {
  return who.owner === true && Boolean(who.email);
}
```

Every **`/api/goals/*`** route and **`GET /goals`** page: **`isGoalsOwner(who)`** → else **403** + `OWNER_ACTION_FORBIDDEN` (`owner-auth.ts`). Reject admin-token for goals data.

---

## Data model

`{dataDir}/goals.sqlite` — `GoalsStore.open` like `wins/store.ts` (`DatabaseSync`, migrations).

Tables: `goals`, `milestones`, `milestone_links` (`kind`: `board` | `todoist`).

**Todoist draft tokens:** `todoist_drafts` — `draft_token`, `milestone_id`, **`owner_email`** (lowercase, must match confirming user), payload `{ content, due }`, **`expires_at` ~10 minutes**, **`used_at`**. Single-use: confirm verifies `owner_email === who.email`; mismatch or reuse → 403/409 without second `createTask`.

---

## API routes

| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| GET | `/api/goals` | `isGoalsOwner` | List goals + milestones + links |
| POST/PUT | `/api/goals`, milestones, links | `isGoalsOwner` | CRUD; no Todoist except confirm path |
| POST | `/api/goals/milestones/:id/todoist/create` | `isGoalsOwner` | `{ draftToken, preview }`; binds token to `who.email` |
| POST | `/api/goals/milestones/:id/todoist/confirm` | `isGoalsOwner` | **`createTask`** once |

**Do not** expose `completeTask` in v1 unless adding a confirm-gated route with the same draft-token pattern.

Board links: no Todoist confirmation. Card → `DONE`: UI may suggest milestone complete with undo snackbar (decision below)—no auto API write.

JSON `cache-control: no-store`. CSRF: `csrfOk` + `x-ah` (`auth.ts`).

---

## UI

`apps/server/src/ui/goals-page.ts` — `pageHeader`, `dialog()` (`components.ts`). Omit owner API script for non-owner (like budget page pattern).

**Nav:** Add sidebar tab **`goals`** in `nav-tabs.ts` (`DEFAULT_SIDEBAR_TABS`, workspace group). **`visibleNavTabs` / page `nav()`:** include Goals tab only when **`who.owner === true`** (same pattern as budget tab gating in `http.ts` lines 339–343). Non-owners do not see the tab or `/goals`.

Focus: **`trapSidebarTab`** / `.sidebar-inset` `inert` from `layout.ts`.

---

## Privacy and security

| Rule | Enforcement |
|------|-------------|
| Owner-only module | All routes + page |
| Todoist token server-only | Never in JSON |
| draftToken bound to owner email | Store + tests |
| No budget / briefings / ntfy | Import grep |
| No new deps/env | Review |

---

## Tests

**Unit:** `goals-store.test.ts`, `goals-todoist-confirm.test.ts`, `goals-owner.test.ts` (non-owner 403 on GET).

**Browser:** `goals.browser.ts` in `test:dashboard-browser`.

---

## PR breakdown

Single PR: `goals/` store, routes, `goals-page.ts`, `nav-tabs.ts`, `http.ts`, tests.

---

## Decisions (Kellan)

1. **Access:** Owner-only read and write (`isGoalsOwner` everywhere).
2. **Board DONE:** Suggest milestone complete in UI with undo; no automatic milestone API update.
3. **Dashboard panel:** Page-only in v1; no `panels/registry.ts` entry.
4. **Archive goal:** Leave linked Todoist task open; no auto-complete.

---

## Reference paths

- `apps/server/src/board/store.ts`, `board/routes.ts`, `board/types.ts` `DONE`.
- `apps/server/src/todoist/client.ts` `createTask`, `listTasks`; `todoistConfigured` in `config.ts`.
- `apps/server/src/auth.ts` `csrfOk`; owner flag lines 40–48.
- `apps/server/src/owner-auth.ts` `OWNER_ACTION_FORBIDDEN`.
- `apps/server/src/nav-tabs.ts`, `http.ts` nav closure (~339–343).
- `apps/server/src/ui/components.ts` `dialog`; `layout.ts` focus patterns.
- `apps/server/src/wins/store.ts` (sqlite file pattern).
