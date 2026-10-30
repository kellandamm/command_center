# Restyle leftovers (#85 / #87)

Inventory of **full-page UI** not yet on the shared **`pageHeader` / `components.ts` primitives** from the emporium restyle (PR #85) and phase-2 pass (#87). **Leave `daily-briefing-page.ts` newspaper styling alone.** Palette: gray surfaces, royal blue (`--primary`) accents; orange / `--destructive` **only** for warnings and destructive actions.

## Already on shared primitives

| Path | Primitives used |
|------|-----------------|
| `apps/server/src/ui/dashboard-page.ts` | `pageHeader`, `button` (`components.ts`) |
| `apps/server/src/ui/agents-usage-page.ts` | `pageHeader` |
| `apps/server/src/ui/sources-page.ts` | `button`, `field`, `esc`; `workspacePage` + `tabs` |
| `apps/server/src/ui/spaces-page.ts` | `button`, `field` |
| `apps/server/src/ui/notes-page.ts` | `button`, `dialog` (large inline `<style>` remains) |

## Leftovers (migrate in a future restyle PR)

| Path | Issue |
|------|--------|
| `apps/server/src/ui/board-page.ts` | Hand-rolled `.page-header` + `boardCss`; not `pageHeader()` |
| `apps/server/src/ui/agent-queue-page.ts` | `workspacePage` only; legacy card headings |
| `apps/server/src/ui/wins-page.ts` | Inline labels, `winsCss` |
| `apps/server/src/ui/assistant-page.ts` | Minimal `workspace-form`, no `pageHeader` |
| `apps/server/src/ui/activity-page.ts` | Duplicates panel markup (`panels/activity.ts`) |
| `apps/server/src/ui/bookmarks-page.ts` | Page-local `<style>`, `<dialog>` CSS duplicated vs calendar |
| `apps/server/src/ui/calendar-page.ts` | ~70 lines inline CSS, custom view switch vs `tabs()` |
| `apps/server/src/ui/calendar-event-page.ts` | Long `workspace-form`, `#task-planning` fieldsets |
| `apps/server/src/ui/calendar-settings-page.ts` | `workspacePage` status blocks |
| `apps/server/src/ui/capture-page.ts` | `workspacePage` |
| `apps/server/src/ui/connections-page.ts` | Inline `<style>` in body |
| `apps/server/src/ui/pages.ts` (`settingsPage`) | `.settings-tabs` variant; mixed raw labels |
| `apps/server/src/ui/share-page.ts` | Not using `pageHeader` / card helpers |
| `apps/server/src/ui/whiteboard-page.ts` | Excalidraw shell; separate from SSR primitives |
| `apps/server/src/ui/budget-page.ts` | Planned in `docs/budget/PLAN.md`—apply `pageHeader` when Budget PR A lands |

## Intentionally excluded

| Path | Reason |
|------|--------|
| `apps/server/src/ui/daily-briefing-page.ts` | Newspaper / `.morning-briefing` masthead (`layout.ts` briefing CSS)—do not shadcn-card |

## Dashboard panels (secondary pass)

Several `apps/server/src/panels/*.ts` still emit hand-rolled `.card` innards without `card()` helpers—track with a panel-only PR after full pages (`panels/host-health.ts` inline table, `panels/recallio.ts` inline forms, stale `pageHref` values noted in historical `docs/ui-audit-plan.md` on branch `cursor/ui-audit-plan-21c1`).

## New feature pages (these plans)

Apply **`pageHeader` / `statCard` / `emptyState`** from day one in: `command-palette` (modal only), `reviews-page.ts`, `home-vault-page.ts`, `goals-page.ts`, and budget/subscriptions tabs per `docs/budget/PLAN.md`.
