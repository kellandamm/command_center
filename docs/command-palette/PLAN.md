# Command palette (Cmd+K) — implementation plan

Global **command palette** for Command Center: fuzzy navigation, quick actions, and search across notes, tasks, bookmarks, meetings (meeting notes), and agent views. **No AI.** Budget PR A is on `main`; palette may surface budget hits only when `budgetAvailable(cfg)` and the shared owner check pass on the server.

**Out of scope:** email triage, agent memory, direct bank connection, natural-language command parsing, MCP tools.

**Cross-cutting:** no new dependencies or env vars; budget data never in briefings or push notifications.

---

## Scope

| In | Out |
|----|-----|
| `Cmd+K` / `Ctrl+K` opens palette from any authenticated page | Changing auth (`auth.ts`, CF Access flow) |
| Fuzzy search over allowed corpora (see API) | New npm dependencies |
| Static quick actions + nav jumps | Budget data in responses for non-owners |
| Owner-only budget rows when gate + owner check pass | Caching palette JSON or `/budget` in the PWA |
| Keyboard-first ARIA combobox + focus trap (reuse shell patterns) | LLM / briefing / ntfy integration |

---

## Owner check (shared helper)

`ownerOk` today is private in `apps/server/src/budget/routes.ts` (lines 30–32). **Extract** to e.g. `apps/server/src/budget/owner-access.ts`:

```ts
export function isBudgetOwner(who: AuthResult & { ok: true }, cfg: Config): boolean {
  return budgetAvailable(cfg) && who.owner === true && Boolean(who.email);
}
```

Use `isBudgetOwner` from palette search and subscriptions routes (same semantics as budget JSON handlers). Do not invent `requireBudgetOwner`.

---

## Search architecture (decision)

**Server endpoint** `GET /api/command-palette/search?q=&limit=` (not client-side full-catalog search).

| Reason | Grounding |
|--------|-----------|
| **Sensitive notes** | `NotesStore.listNotes(query, true)` + `redactNoteForCatalog` (`notes/sensitive.ts`). |
| **Budget privacy** | Budget slice only when `isBudgetOwner(who, cfg)`; mirror `handleBudgetRoutes` (`budget/routes.ts`). |
| **Single audit surface** | One handler; follow `budget/excluded.ts` “never in agent context”. |
| **Size** | Corpora too large for inline HTML; nav from filtered tabs (below). |

Client merges API results with **static nav/actions**. Debounce 120–180 ms; JSON `cache-control: no-store`.

### Static nav / quick actions

Build navigation rows from `DEFAULT_SIDEBAR_TABS` (`nav-tabs.ts` lines 31–41) filtered the same way as the HTML shell: pass `visibleNavTabs(tabs, { whiteboard, budget: budgetAvailable(cfg) && who.owner === true })` (`http.ts` lines 340–342, `visibleSidebarTabs` strips `budget` when `opts.budget` is false at `nav-tabs.ts` lines 97–101). **Non-owners must not get a Budget nav action** even if the tab exists in settings JSON.

Agent sub-nav hrefs: `AGENT_SUB_NAV` in `layout.ts` (board, queue, usage, wins, assistant, activity).

### Todoist search (no per-keystroke API)

Do **not** call `listTasks` on every debounced query. Use an in-process cache (same TTL idea as `budget/import-preview-cache.ts`): refresh open tasks at most once per **60s** per server instance when Todoist is configured, then filter locally for the query. Palette may also surface **board** tasks from `BoardStore.list()` without Todoist.

---

## Data model

No new SQLite file.

| Source | Store / API | Palette row |
|--------|-------------|-------------|
| Notes | `NotesStore.search` / `listNotes(q, true)` | `type: note`, `href: /notes?note=` |
| Tasks | Cached `listTasks` + `BoardStore.list()` | `type: task` / `board-card` |
| Bookmarks | `BookmarksStore.list()` (`http.ts` `GET /api/bookmarks`) | `type: bookmark` |
| Meetings | Meeting notes per `meetings/import-service.ts` | `type: meeting` |
| Agent pages | Filtered nav metadata | `type: nav` |
| Budget | `BudgetStore` payee/tx search if `isBudgetOwner` | `type: budget-tx`, `href: /budget?view=transactions` |

Cap **50** rows; omit budget types entirely when not owner.

---

## API routes

| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| GET | `/api/command-palette/search` | Authenticated; budget slice requires `isBudgetOwner` | Skip budget when gate off (not 503). Never log query or payee strings (`budget/redact.ts` `logBudgetError`). |

Wire in `http.ts` before the panel loop (with `handleBoardRoutes` / `handleBudgetRoutes`). Module: `apps/server/src/command-palette/routes.ts`.

---

## UI

| Piece | Location |
|-------|----------|
| Modal | `apps/server/src/ui/command-palette.ts` — script injected from `layout.ts` `page()`. |
| Shortcut | `(metaKey\|ctrlKey) && key === "k"`; skip when `sidebarShortcutBlocked()` (`layout.ts` ~382–389). |
| ARIA | Combobox + listbox + `aria-activedescendant`; `aria-modal="true"`. |
| Focus trap | Mirror mobile sheet: **`trapSidebarTab`** tab cycle (`layout.ts` lines 325–333), **`inert` on `.sidebar-inset`** when open (`layout.ts` lines 312–365), **Esc** closes and restores prior focus (lines 411–416). Generalize for palette overlay without a third divergent trap. |
| Styling | `#85` tokens via `button()` / `emptyState()` where applicable. |

`/budget` is already excluded from the PWA cache (`pwa.ts` line 74). No separate palette route.

---

## Privacy and security

| Rule | Enforcement | Test |
|------|-------------|------|
| Sensitive note bodies omitted | `forCatalog=true` paths | Unit with sensitive note |
| Budget omitted for non-owner | `isBudgetOwner` | admin-token → no `budget-*` types |
| No palette in LLM/MCP/briefings/ntfy | No imports in those trees | Grep + snapshot |
| `Cache-Control: no-store` | JSON helper like `board/routes.ts` | Header assert |
| PWA | `/api/*` bypass; `/budget` skip in SW | `budget-privacy.test.ts` pattern |

---

## Tests

**Unit:** `command-palette-search.test.ts` (corpora, redaction, budget gating, Todoist cache not called per request).

**Browser (`test:dashboard-browser`):** `command-palette.browser.ts` — Meta+K, keyboard nav, Esc; non-owner has no budget row or Budget nav action.

---

## PR breakdown

Single PR: `command-palette/`, `budget/owner-access.ts` (extract), `ui/command-palette.ts`, `layout.ts` hook, `http.ts`, tests.

---

## Open questions for Kellan

1. Todoist task group hidden when `todoistConfigured(cfg)` is false, or show board-only tasks?
2. Include Read Later (`ReadLaterService`) in v1?
3. `Ctrl+Shift+P` alias or Cmd+K only?
4. Quick actions: include briefing refresh (`POST /api/daily-briefing/refresh`) or navigation-only?

---

## Reference paths (existing)

- Auth owner: `apps/server/src/auth.ts` (`makeAuthenticator`, lines 40–48).
- Nav filter: `apps/server/src/nav-tabs.ts` `visibleNavTabs`, `DEFAULT_SIDEBAR_TABS`; `http.ts` lines 340–342.
- Notes: `apps/server/src/notes/store.ts` `search`, `listNotes`; `notes/sensitive.ts`.
- Board: `apps/server/src/board/store.ts` `list`.
- Bookmarks: `apps/server/src/bookmarks/store.ts` `list`; `http.ts` `GET /api/bookmarks`.
- Budget: `apps/server/src/budget/gate.ts` `budgetAvailable`, `budget/routes.ts` `handleBudgetRoutes`, `ownerOk` (to extract).
- PWA: `apps/server/src/pwa.ts` `SERVICE_WORKER` line 74.
- Focus: `apps/server/src/ui/layout.ts` `trapSidebarTab`, `.sidebar-inset` inert.
- HTML `send()`: `apps/server/src/http.ts` lines 134–136 (`SECURITY` includes `x-content-type-options: nosniff`).
