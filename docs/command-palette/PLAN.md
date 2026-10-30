# Command palette (Cmd+K) — implementation plan

Global **command palette** for Command Center: fuzzy navigation, quick actions, and search across notes, tasks, bookmarks, meetings (meeting notes), and agent views. **No AI.** Ships as **one implementation PR** after Budget PR A is on `main` (palette may surface budget hits only when the budget gate and owner check pass on the server).

**Out of scope:** email triage, agent memory, direct bank connection, natural-language command parsing, MCP tools.

---

## Scope

| In | Out |
|----|-----|
| `Cmd+K` / `Ctrl+K` opens palette from any authenticated page | Changing auth (`auth.ts`, CF Access flow) |
| Fuzzy search over allowed corpora (see API) | New npm dependencies (use in-repo fuzzy match, e.g. small score helper or `Intl.Collator` + substring) |
| Static quick actions (theme, sidebar, jump to settings) | Budget data in responses for non-owners |
| Owner-only budget rows when `budgetAvailable(cfg)` and `who.owner` | Caching palette JSON or budget routes in the PWA |
| Keyboard-first ARIA combobox + focus trap (reuse shell patterns) | LLM / briefing / ntfy integration |

---

## Search architecture (decision)

**Use a server endpoint** `GET /api/command-palette/search?q=&limit=` rather than embedding full catalogs in page HTML.

| Reason | Grounding |
|--------|-----------|
| **Sensitive notes** | `NotesStore.listNotes(query, true)` applies `redactNoteForCatalog` (`notes/sensitive.ts`); sensitive bodies must not ship to the browser for client-only search. |
| **Budget privacy** | Budget hits are omitted unless `budgetAvailable(cfg)` and `requireBudgetOwner`-equivalent checks pass in the handler—same as `handleBudgetRoutes` (`budget/routes.ts`, `ownerOk`). |
| **Single audit surface** | One route to grep for LLM/MCP/briefing importers; mirror `budget/excluded.ts` “never in agent context” rule. |
| **Size** | Notes, bookmarks, board cards, and library sources can exceed practical inline JSON; nav tabs alone come from `visibleNavTabs` (`nav-tabs.ts`). |

Client holds **static** action list (navigation targets from `DEFAULT_SIDEBAR_TABS` + agent sub-nav in `layout.ts` `AGENT_SUB_NAV`) and merges with API results. Debounce 120–180 ms; `cache-control: no-store` on JSON.

---

## Data model

No new SQLite file. Search reads existing stores on each request (no palette index v1).

| Source | Store / API | Palette row |
|--------|-------------|-------------|
| Notes | `NotesStore.search` / `listNotes(q, true)` | `type: note`, `id`, `title`, `href: /notes?note=`, optional `subtitle` (tags) |
| Tasks (Todoist) | `listTasks` when `todoistConfigured(cfg)` (`todoist/client.ts`) | `type: task`, `href` external or `/agent?view=board` if linked |
| Board | `BoardStore.list()` | `type: board-card`, `href: /agent?view=board` |
| Bookmarks | `bookmarks.list()` via existing service used in `http.ts` `GET /api/bookmarks` | `type: bookmark`, `href: /bookmarks` |
| Meetings | Notes with meetings import tag (same filter as `meetings/import-service.ts` space/tag conventions) | `type: meeting`, `href: /notes?note=` |
| Agent pages | Static metadata | `type: nav`, `href` from `http.ts` agent views |
| Budget | `BudgetStore` transaction/payee search **owner + gate only** | `type: budget-tx`, `href: /budget?view=transactions` |

Response shape (zod in route module): `{ query, results: Array<{ type, id, title, subtitle?, href, score }> }`. Cap **50** rows; drop budget section entirely when not owner.

---

## API routes

| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| GET | `/api/command-palette/search` | Authenticated (`makeAuthenticator`); budget slice requires `who.owner === true` + `budgetAvailable(cfg)` | Runs corpora above; **503** if budget gate off is not an error—just skip budget. Never log `q` or payee/titles at error level (use code-only logs like `budget/redact.ts`). |

Wire in `http.ts` **before** the panel loop (same ordering as `handleBoardRoutes` / budget plan). Register handler in new `apps/server/src/command-palette/routes.ts`.

---

## UI

| Piece | Location |
|-------|----------|
| Modal shell | New `apps/server/src/ui/command-palette.ts` — export `commandPaletteScript()` injected from `layout.ts` `page()` for all pages (like sidebar boot script). |
| Trigger | Hidden `<button id="command-palette-trigger" class="visually-hidden">` + `document.addEventListener("keydown")` for `(metaKey\|ctrlKey) && key === "k"`; respect `sidebarShortcutBlocked()` pattern from `layout.ts` (skip when focus in `#knowledge-editor`, inputs, etc.). |
| ARIA | `role="combobox"` on input, `role="listbox"` / `option` on results, `aria-activedescendant`, `aria-expanded`. |
| Focus trap | Reuse **#85/#86** mobile sidebar pattern from `layout.ts` `SIDEBAR_SCRIPT`: backdrop `inert` on `.app-shell` main, focus first result on open, **Esc** closes and restores focus to prior `document.activeElement`, `aria-modal="true"`. Do not duplicate a third trap implementation—extract shared `trapFocus(container, onEscape)` in `layout.ts` script block if needed. |
| Styling | `#85` tokens: gray surfaces, `--primary` royal blue accents; `--destructive` / orange **only** for destructive actions (e.g. “Clear local layout cache”). Use `button()` / `emptyState()` from `components.ts` where SSR fragments exist. |

No `/command-palette` page route (modal only). Budget result clicks navigate to `/budget?...`; SW must not cache `/budget` (extend `pwa.ts` `SERVICE_WORKER` per `docs/budget/PLAN.md` when budget ships).

---

## Privacy and security

| Rule | Enforcement | Test |
|------|-------------|------|
| Sensitive note bodies not in search JSON | Route uses `forCatalog=true` paths only | Unit: seed sensitive note, search query matches title only, `content` absent |
| Budget omitted for non-owner | Handler skips `BudgetStore` unless `ownerOk` | `command-palette-privacy.test.ts`: admin-token gets no `budget-*` types |
| Budget omitted when gate off | Skip when `!budgetAvailable(cfg)` | Gate test with env unset |
| No palette data in LLM/MCP/briefings | No imports from palette route into `llm/`, `mcp/`, `daily-briefing/`, `notify/` | Grep + snapshot test |
| `Cache-Control: no-store` | JSON helper mirrors `board/routes.ts` | Header assert |
| PWA | `/api/*` already bypasses SW (`pwa.ts` line 74); confirm `/budget` skip when budget exists | Assert SW source |

---

## Tests

**Unit:** `apps/server/test/command-palette-search.test.ts` (corpora, redaction, budget gating, limit, scoring).

**Browser (`test:dashboard-browser` suite):** `apps/server/test/command-palette.browser.ts` — open dashboard, `Meta+K`, type query, arrow keys + Enter navigate, Esc closes and focus returns; non-owner fixture has no budget row.

---

## PR breakdown

Single PR: `command-palette/{routes,search}.ts`, `ui/command-palette.ts`, `layout.ts` script hook, `http.ts` route, tests above.

---

## Open questions for Kellan

1. Should Todoist tasks appear when `todoistConfigured` is false (board-only), or hide the task group entirely?
2. Include Read Later **library entries** (`ReadLaterService`) in v1 or defer (large corpus)?
3. Default keybinding: also `Ctrl+Shift+P` alias or Cmd+K only?
4. Quick actions: include “Refresh daily briefing” (hits `POST /api/daily-briefing/refresh`) or keep navigation-only?

---

## Reference paths (existing)

- Auth owner bit: `apps/server/src/auth.ts` (`makeAuthenticator`, lines 40–48).
- Nav visibility: `apps/server/src/nav-tabs.ts` `visibleNavTabs`.
- Notes search: `apps/server/src/notes/store.ts` `search`, `listNotes`; redaction `notes/sensitive.ts`.
- Board list: `apps/server/src/board/store.ts` `list`.
- Bookmarks: `apps/server/src/http.ts` `GET /api/bookmarks`.
- Budget gate (when merged): `apps/server/src/budget/gate.ts` `budgetAvailable`, `routes.ts` `ownerOk`.
- PWA: `apps/server/src/pwa.ts` `SERVICE_WORKER`.
- Focus / Esc / inert: `apps/server/src/ui/layout.ts` `SIDEBAR_SCRIPT` (~lines 299–392).
- Global `send()` no-store: `apps/server/src/http.ts` `send()` (~129–131).
