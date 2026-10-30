# Restyle leftovers (#85 / #87 / phase 2)

After PR #85 (shell), #87 (phase 2), and Budget PR A on `main`: gray surfaces, royal blue (`--primary`) accents; orange / `--destructive` **only** for warnings and destructive actions.

## Done (do not re-list as backlog)

| Path | Notes |
|------|--------|
| `apps/server/src/ui/dashboard-page.ts` | `pageHeader`, `button` |
| `apps/server/src/ui/agents-usage-page.ts` | `pageHeader` |
| `apps/server/src/ui/notes-page.ts` | Phase 2 shell + `button`, `dialog` |
| `apps/server/src/ui/bookmarks-page.ts` | Phase 2 (`phase2-pages-css.ts`) |
| `apps/server/src/ui/calendar-page.ts` | Phase 2 |
| `apps/server/src/ui/pages.ts` + `pages-settings-body.ts` | Settings shell + tab panels |
| `apps/server/src/ui/budget-page.ts` | Budget PR A shell |

## Partial (not “done” — still use `workspacePage` / no `pageHeader`)

| Path | Notes |
|------|--------|
| `apps/server/src/ui/sources-page.ts` | Some `components.ts` helpers; not full phase-2 `pageHeader` shell |
| `apps/server/src/ui/spaces-page.ts` | Same as sources |

## Intentionally excluded

| Path | Reason |
|------|--------|
| `apps/server/src/ui/daily-briefing-page.ts` | Newspaper `.morning-briefing` — leave editorial layout alone |

## Still to do (future restyle PR)

| Path | Notes |
|------|--------|
| `apps/server/src/ui/board-page.ts` | Hand-rolled `page-header` + `boardCss` |
| `apps/server/src/ui/agent-queue-page.ts` | `workspacePage`; client script uses `emptyState()` for empty Hobie queue |
| `apps/server/src/ui/wins-page.ts` | `winsCss`, inline form labels |
| `apps/server/src/ui/assistant-page.ts` | Minimal `workspace-form` |
| `apps/server/src/ui/activity-page.ts` | Duplicates `panels/activity.ts` markup |
| `apps/server/src/ui/calendar-event-page.ts` | Long `workspace-form`, `#task-planning` |
| `apps/server/src/ui/calendar-settings-page.ts` | `workspacePage` status blocks |
| `apps/server/src/ui/capture-page.ts` | `workspacePage` |
| `apps/server/src/ui/connections-page.ts` | Inline styles in body |
| `apps/server/src/ui/share-page.ts` | No `pageHeader` / card helpers |
| `apps/server/src/ui/whiteboard-page.ts` | Excalidraw shell (separate from SSR primitives) |
| `apps/server/src/ui/sources-page.ts` | Migrate to phase-2 `pageHeader` shell |
| `apps/server/src/ui/spaces-page.ts` | Migrate to phase-2 `pageHeader` shell |

## New feature pages (these plans)

Use `pageHeader`, `statCard`, `emptyState`, `field`, `dialog` from `components.ts` on first ship: command palette modal chrome, `reviews-page.ts`, `home-vault-page.ts`, `goals-page.ts`.
