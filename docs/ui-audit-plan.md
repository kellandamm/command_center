# UI audit plan — shadcn-aligned SSR

**Repo:** `kellandamm/command_center` · **Scope:** `apps/server/src/ui/*.ts`, `apps/server/src/panels/*.ts`, shared shell in `layout.ts`  
**Out of scope:** `:root` / `html.dark` token *values* (theme PR), settings *logic* and API accuracy PRs, React whiteboard bundle (`notes-editor`).

---

## 1. Inventory (routes, pages, panels)

Legend: **Nav** = default sidebar (`nav-tabs.ts` `DEFAULT_SIDEBAR_TABS`). Hand-rolled = not using a shared primitive module (none exists today).

### Full-page routes (`http.ts` ~267–314)

| Route | Renderer | Nav | Hand-rolled UI | Inconsistencies (evidence) |
|-------|----------|-----|----------------|----------------------------|
| `/` | `dashboard-page.ts` | Dashboard (locked) | `page-header`, `.card` panels via `panels/*.dashboardHtml`, `dashboard-grid.ts` chrome injected in script (`dashboard-grid.ts:263`) | Buttons: only default + `.ghost` (`layout.ts:67–76`). No shared empty/loading components—panels use ad hoc `.dim` text (`panels/activity.ts:33`, `panels/calendar.ts:12`). Duplicate `h2` in panel HTML hidden by grid CSS (`dashboard-grid.ts:48–49`) while chrome also renders title. Mobile stack at 900px (`dashboard-grid.ts:59–69`); sidebar at 768px (`layout.ts:204–212`)—breakpoint mismatch. |
| `/briefing` | `daily-briefing-page.ts` | Daily Briefing | Custom **newspaper** layout (`.morning-briefing`, `layout.ts:159–225`), not `.card` | Intentional editorial look bypasses shadcn card/tabs; buttons `.ghost` only (`daily-briefing-page.ts:17`). Status uses `.status-pill` not Badge primitive (`layout.ts:100–103`). Error: `.morning-error` (`layout.ts:174`). Mobile rules at 1000/680px (`layout.ts:214–225`). |
| `/library` | `sources-page.ts` | Read Later | `workspacePage` + large `workspaceCss` (`workspace.ts:9–118`) | Tabs: `.workspace-tabs.library-views` (`sources-page.ts:25–30`) vs agent/settings tab patterns. **Broken a11y:** `class="sr-only"` label (`sources-page.ts:32`) with **no** `.sr-only` in global CSS (contrast `notes-sr-only` in `notes-page.ts:242`). Empty: `emptyState()` (`workspace.ts:133`). Loading: `aria-busy` on list (`sources-page.ts:39`). Mobile: reading manager breakpoints (`workspace.ts:75–78`). |
| `/library/:id` | `sourceDetailPage` in `sources-page.ts` | Read Later | Same workspace stack | Detail reading column; actions as raw buttons/links. |
| `/spaces` | `spaces-page.ts` | Spaces | `workspacePage`, inline form | Empty via `emptyState` (`spaces-page.ts:17`). No card wrapper on list. |
| `/spaces/:id` | `spaceDetailPage` | Spaces | `workspace-item` links, `.btn` / `.btn ghost` (`spaces-page.ts:38–39`) | Headings bare `<h2>` outside cards. |
| `/agent?view=board` | `board-page.ts` | Agent | `boardCss` (`board-page.ts:4–18`), kanban HTML in script | Toolbar `.card`; columns custom muted columns not Card subcomponents. Mobile 2-col at 1100px (`board-page.ts:9`). Active nav `/board` mapped to `/agent` in `layout.ts:253–260`. |
| `/agent?view=queue` | `agent-queue-page.ts` | Agent | `workspacePage` + `.card` section (`agent-queue-page.ts:15–21`) | Mixes workspace list + card; inline `h2`/`h3` styles (`agent-queue-page.ts:16–19`). Supersedes old Hobie full page (see §2). |
| `/agent?view=wins` | `wins-page.ts` | Agent | `winsCss`, form with **inline** `<label>Win <input/></label>` (`wins-page.ts:20–22`) | Not `field()` pattern; empty as `<p class="dim card">` in script (`wins-page.ts:34`). |
| `/agent?view=assistant` | `assistant-page.ts` | Agent | `workspace-form` | Minimal chrome; no card around Q&A. |
| `/agent?view=activity` | `activity-page.ts` | Agent | Copy of activity **panel** markup (`activity-page.ts:9–11` ≈ `panels/activity.ts:7–11`) | Duplicate view; feed list only; empty `<li class="dim">` (`activity-page.ts:15`). |
| `/notes` | `notes-page.ts` | Notes | ~800 lines: inline `<style>` (`notes-page.ts:190+`), `workspaceTabs`, native `<dialog>` (`notes-page.ts:188–189`) | Many button sizes via inline `font-size`/`min-height` (`notes-page.ts:213–220`). Dialog styles one-off. Mobile grid (`notes-page.ts:202+` media queries). Uses `page()` not `workspacePage` for shell. |
| `/notes/connections`, `/notes/transfer` | `noteToolsPage` | Notes (same tab) | `workspacePage` + tabs (`notes-page.ts:5–7`) | Overlaps Spaces/notes features; transfer uses raw `<h2>` in body. |
| `/bookmarks` | `bookmarks-page.ts` | Bookmarks | Page-local `<style>` (`bookmarks-page.ts:38+`), `<dialog>` (`bookmarks-page.ts:25–36`) | Custom marketing header (`.bookmark-eyebrow`); dialog CSS duplicated vs calendar (`bookmarks-page.ts:60–61` vs `calendar-page.ts:116–117`). |
| `/calendar` | `calendar-page.ts` | Calendar | ~70 lines inline CSS in body (`calendar-page.ts:54–121`), `<dialog id="cal-event-dialog">` (`calendar-page.ts:45–52`) | `.btn` + `.btn ghost` (`calendar-page.ts:14`). View switch uses `button[aria-pressed=true]` with primary fill (`calendar-page.ts:92`)—different from settings tabs. Mobile 700/1050px (`calendar-page.ts:119–120`). |
| `/calendar/event` | `calendar-event-page.ts` | Calendar (deep link) | `workspace-form`, fieldsets | Long form; mixed `.row` checkboxes; no field helper/error components. |
| `/settings` | `pages.ts` `settingsPage` | Settings (locked) | `.settings-tabs` + `.settings-tab-panel` cards (`pages.ts:14–57`) | Tab buttons `.ghost.on` (`pages.ts:15–18`, `layout.ts:130–132`)—third tab variant. Forms mix `fieldset.settings-option` and raw labels (`pages.ts:24–31`). **Do not change** settings script/logic in UI PRs. |
| `/settings/connections` | `connections-page.ts` | Settings only (link) | `workspacePage` + inline `<style>` (`connections-page.ts:14–21`) | Dynamically built forms; buttons default/ghost only (`connections-page.ts:41`). |
| `/settings/calendars` | `calendar-settings-page.ts` | Settings only | `workspacePage` | Status paragraphs; `workspace-details` sections. |
| `/settings/capture` | `capture-page.ts` | Hidden (linked from library) | `workspacePage` | `active: "/library"` (`capture-page.ts:7`)—sidebar highlights Read Later, not Settings. |

**Redirects (not separate views):** `/news`, `/summaries`, `/read-later` → `/library` (`http.ts:271–276`); `/read-later/:id` → `/library/:id` (`http.ts:279–282`); `/board`, `/hobie`, `/hobie/queue`, `/wins`, `/assistant`, `/activity` → `/agent?view=…` (`http.ts:293–299`).

### Dashboard panels only (`panels/registry.ts` — 12 modules)

| Panel id | File | `pageHref` | Hand-rolled | Notes |
|----------|------|------------|-------------|-------|
| `tasks` | `panels/tasks.ts` | `/agent?view=board` | `.card`, filter chips `.tasks-chip` (`dashboard-page.ts:19–20`) | Title only in chrome after grid init. |
| `attention` | `panels/attention.ts` | — | Section headings in script | No full-page link. |
| `heatmap` | `panels/heatmap.ts` | `/agent?view=activity` | Heatmap grid | Title **"Activity"** collides with `activity` panel (`heatmap.ts:7–8` vs `activity.ts:5`). |
| `launchpad` | `panels/launchpad.ts` | — | Tile grid | |
| `activity` | `panels/activity.ts` | `/activity` (**stale**; redirects) | `todoist-list` | `pageHref` should be `/agent?view=activity`. |
| `hobie` | `panels/hobie.ts` | `/board` (**stale**) | List counts | Should be `/agent?view=board`. |
| `daily-briefing` | `panels/daily-briefing-panel.ts` | `/briefing` | Preview body | |
| `weather` | `panels/weather.ts` | — | Inline `h2` + status | |
| `calendar` | `panels/calendar.ts` | `/calendar` | Inline styles on `ul` (`calendar.ts:13`) | |
| `notes` | `panels/notes.ts` | `/notes` | Textarea + buttons in panel (`notes.ts:44–50`) | Duplicates full editor patterns. |
| `host-health` | `panels/host-health.ts` | — | **Only** `<table>` in app (`host-health.ts:73` JS string) | Inline table styles, not shadcn Table. |
| `recallio` | `panels/recallio.ts` | — | Inline form `style=` (`recallio.ts:11–14`) | |

**Shared shell:** `layout.ts` — tokens (`:7–33`), base components (`.card`, `button`/`.btn`, inputs, `page-header`, sidebar, `.agent-tabs` `layout.ts:285–287`), briefing + dead `.dashboard-overview*` CSS (`layout.ts:149–158`, unused per `apps/server/test/ui.test.ts:35`).

**Tab systems (5):** sidebar nav; `agent-tabs` (`layout.ts:285–287`); `settings-tabs` (`pages.ts:14–18`); `workspace-tabs` (`workspace.ts:4–7`, `notes-page.ts:5–7`); library view links (`sources-page.ts:25–30`); calendar view switch (`calendar-page.ts:39`).

**Button variants today:** default (`button`, `.btn`) + `.ghost` only (`layout.ts:67–76`). Missing: secondary, outline, destructive, link, size sm/lg/icon (except `.icon-btn` on theme toggle `layout.ts:76`).

---

## 2. Dead or duplicate views

| Item | Evidence | Safe to delete? |
|------|----------|-----------------|
| `ui/hobie-page.ts` (`hobiePage`) | **Zero imports** (only self export). Queue UI is `agent-queue-page.ts`; route `/hobie` redirects (`http.ts:293–298`). | **Yes** — remove file. |
| `layout.ts` `.dashboard-overview*` rules | No markup; test asserts absence (`ui.test.ts:35`). | **Yes** — CSS only (~10 lines). |
| `activity-page.ts` vs `panels/activity.ts` | Same API `/api/activity/updates`, same list markup class `todoist-list`. Full page adds refresh button only. | **No** — keep route; **consolidate** markup via shared fragment/helper when refactoring. |
| Legacy redirects (`/board`, `/activity`, …) | Still registered (`http.ts:293–299`). | **Keep** — bookmarks/older links; fix `pageHref` on panels instead. |
| `heatmap` panel title "Activity" vs `activity` panel | Both on dashboard (`registry.ts:17–21`). | **No** — rename heatmap title/link in UI pass (copy fix, not delete). |

---

## 3. Proposed approach

### Recommended: `ui/components.ts` + shared CSS block in `layout.ts`

**Module** (`apps/server/src/ui/components.ts`):

- `esc` re-export from `layout.ts` (single escape helper).
- `button({ variant, size, className, attrs })` → `<button>` or `<a class="btn">` for links.
- `card({ title, description, body, className })`, `cardHeader`, `cardContent`.
- `badge(variant)`, `statusPill` (wrap existing semantics).
- `tabs({ items, activeId })` — one markup pattern for settings/agent/workspace/library subnav.
- `table({ head, rows })` — replace host-health inline table.
- `field({ label, id, hint, error, inputHtml })` for SSR forms.
- `dialog({ id, title, body, footer })` + documented `showModal()` convention.
- `sheet({ ... })` — optional CSS slide-over for mobile nav (sidebar already collapses to row at 768px).
- `emptyState({ title, description, action? })`, `loadingState()`, `errorState(message)` — align with `workspace.ts:133` `emptyState` JS helper.

**CSS:** Append **component classes** to `layout.ts` `CSS` string *after* tokens (e.g. `.btn-outline`, `.btn-destructive`, `.btn-sm`, `.ui-tabs`, `.ui-table`, `.ui-dialog`, `.ui-field`, `.ui-empty`) mapping to existing variables (`--primary`, `--destructive`, `--border`, `--radius`) without changing token values.

**Migrate consumers in order:** shell + dashboard → workspace pages → heavy pages (notes, calendar, bookmarks).

### Alternatives

| Option | Pros | Cons |
|--------|------|------|
| Expand `workspace.ts` only | Already has `emptyState`, large CSS | Does not cover dashboard panels, settings, briefing |
| Per-page CSS modules / files | Smaller diffs per file | More imports; still duplicates dialog/button rules |
| Tailwind + shadcn React | Full design system | Conflicts with SSR-string architecture; only whiteboard uses React |

### Line estimate (structural refactor, not theme)

| Area | Add | Remove |
|------|-----|--------|
| `components.ts` + tests | ~280–350 | — |
| `layout.ts` shared component CSS | ~180–250 | ~15 (dead overview CSS) |
| Page/panel string updates (class swaps, dialog wrappers) | ~120–200 touch lines | ~350–550 (inline `<style>`, duplicate dialog CSS, repeated `h2 style=`) |
| **Net** | **~600–800** | **~400–550** → **+150–300 LOC** |

---

## 4. PR split (3 reviewable steps)

### PR A — Primitives, shell, dashboard

**Files:** `ui/components.ts` (new), `ui/layout.ts` (component CSS + unify `agent-tabs` markup via helper), `ui/dashboard-page.ts`, `ui/dashboard-grid.ts`, `panels/*.ts` (panel inner HTML only—drop duplicate `h2`, use `cardContent`), `test/ui.test.ts` if selectors change.

**Goals:** Button/badge/table/tabs/empty primitives; dashboard panel bodies consistent; fix stale `pageHref` (`activity.ts:6`, `hobie.ts:6`).

**Theme PR conflict:** **Medium.** Theme PR edits `:root` / `html.dark` blocks (`layout.ts:8–33`). This PR should only **append** rules below line ~34 and avoid touching token lines. Rebase order: merge theme first, then append component CSS.

### PR B — Notes, Read Later, Spaces

**Files:** `ui/workspace.ts`, `ui/sources-page.ts`, `ui/spaces-page.ts`, `ui/notes-page.ts`, `ui/capture-page.ts`, `panels/notes.ts`.

**Goals:** One tab component; fix `.sr-only`; migrate notes/bookmarks dialogs to shared `dialog()` CSS; reduce inline `<style>` in `notes-page.ts` by moving layout rules to `layout.ts` or `workspaceCss`.

**Theme conflict:** **Low** (mostly `workspace.ts` and page bodies).

### PR C — Agent hub, calendar, bookmarks, settings chrome, cleanup

**Files:** `ui/board-page.ts`, `ui/agent-queue-page.ts`, `ui/wins-page.ts`, `ui/assistant-page.ts`, `ui/activity-page.ts`, `ui/calendar-page.ts`, `ui/calendar-event-page.ts`, `ui/calendar-settings-page.ts`, `ui/bookmarks-page.ts`, `ui/daily-briefing-page.ts` (only shared buttons/pills—**not** newspaper layout), `ui/pages.ts` (markup/classes only for settings tabs), `ui/connections-page.ts`, `panels/host-health.ts` (table helper), **delete** `ui/hobie-page.ts`.

**Goals:** Agent views share tabs + cards; calendar/bookmark dialogs deduped; briefing keeps editorial layout but uses shared button/badge classes.

**Theme conflict:** **Low–medium** for `daily-briefing-page` if theme touches briefing colors in `layout.ts:159–225` (coordinate: structural classes only).

---

## 5. Test and screenshot plan

**Scripts:**

- Seed: `apps/server/scripts/seed-ui-screenshots.ts` → `seed-dashboard-screenshot.ts`.
- Capture: `apps/server/scripts/capture-ui-screenshots.ts` — `SETTINGS_SHOTS` (1280×800) + `DASHBOARD_V1_SHOTS` (includes mobile 390×844 for `/` only).

**CI / local workflow:**

```bash
cd apps/server
pnpm run build
pnpm capture:ui-screenshots   # package.json script → tsx capture-ui-screenshots.ts
```

**Per PR:**

1. Run full capture before/after; commit changed PNGs under `docs/screenshots/**`.
2. Extend `SETTINGS_SHOTS` after PR B/C for gaps: `/library`, `/spaces`, `/settings` (views tab), `/settings/connections`, `/bookmarks`, `/agent?view=queue`, mobile 390×844 for calendar + notes (mirror `dashboard-mobile` pattern `capture-ui-screenshots.ts:142–149`).
3. Add `prepare` hooks that wait on stable selectors (same file pattern as `#dashboard-grid`, `#knowledge-note-list`).
4. Unit: keep `apps/server/test/ui.test.ts` assertions; add tests for `components.ts` HTML escaping and button variant classes.

**Manual checks:** dark mode toggle (`layout.ts:230–249`); `viewPreferences` compact density (`layout.ts:141–145`); agent tab `aria-current` (`layout.ts:259`).

---

## Summary

The app already centralizes **design tokens** and a minimal **card/button/input** layer in `layout.ts`, but each major route reimplements **tabs, dialogs, tables, empty/loading states, and breakpoints**. A small `components.ts` plus appended CSS in `layout.ts` (without token value changes) gives shadcn-like consistency while staying SSR-first. Remove `hobie-page.ts` and dead dashboard-overview CSS; consolidate duplicate activity markup; fix stale panel `pageHref`s and the missing `.sr-only` class on Read Later.
