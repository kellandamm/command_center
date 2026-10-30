/** Shared layout chrome for phase 2 page restyles (Bookmarks, Calendar, Notes, Settings). */
export const PHASE2_PAGE_CSS = `
.phase2-page{max-width:90rem;margin:0 auto;width:100%}
.phase2-page>.ui-page-header{margin-bottom:1.25rem}
.phase2-toolbar{display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-end;justify-content:space-between;margin-bottom:1.25rem;padding-bottom:1rem;border-bottom:1px solid var(--border)}
.phase2-toolbar .ui-field{flex:1;min-width:min(100%,20rem);margin:0}
.phase2-shell{border:0;border-radius:calc(var(--radius) + 0.25rem);overflow:hidden;background:var(--card);
  box-shadow:0 0 0 1px color-mix(in srgb,var(--foreground) 6%,transparent),0 1px 2px rgba(0,0,0,.04)}
html.dark .phase2-shell{box-shadow:0 0 0 1px color-mix(in srgb,var(--foreground) 10%,transparent),0 1px 2px rgba(0,0,0,.35)}
.settings-quick-links{display:flex;flex-wrap:wrap;gap:.75rem;margin:0 0 1.25rem}
.settings-quick-links a{font-size:.875rem;font-weight:500;padding:.5rem .85rem;border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);background:var(--card);text-decoration:none}
.settings-quick-links a:hover{background:var(--muted);border-color:var(--border)}
.settings-page .settings-tabs{margin-bottom:1rem}
.settings-page .settings-card{margin-bottom:1rem}
`;
