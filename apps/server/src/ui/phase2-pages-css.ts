/** Shared layout chrome for phase 2 page restyles (Bookmarks, Calendar, Notes, Settings). */
export const PHASE2_PAGE_CSS = `
.phase2-page{max-width:90rem;margin:0 auto;width:100%}
.phase2-page>.ui-page-header{margin-bottom:1.25rem}
.phase2-toolbar{display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-end;justify-content:space-between;margin-bottom:1.25rem;padding-bottom:1rem;border-bottom:1px solid var(--border)}
.phase2-toolbar .ui-field{flex:1;min-width:min(100%,20rem);margin:0}
.phase2-shell{border:0;border-radius:calc(var(--radius) + 0.25rem);overflow:hidden;background:var(--card);
  box-shadow:0 0 0 1px color-mix(in srgb,var(--foreground) 6%,transparent),0 1px 2px rgba(0,0,0,.04)}
html.dark .phase2-shell{box-shadow:0 0 0 1px color-mix(in srgb,var(--foreground) 10%,transparent),0 1px 2px rgba(0,0,0,.35)}
.settings-page .settings-stack{display:flex;flex-direction:column;gap:1.25rem;width:100%;max-width:48rem}
.settings-page .settings-section{display:flex;flex-direction:column;gap:.75rem}
.settings-page .settings-section-title{margin:0;font-size:.8125rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted-foreground)}
.settings-page .settings-card{max-width:none;margin:0}
.settings-page .settings-tabs{margin:0 0 .25rem}
.settings-link-list{display:flex;flex-direction:column;gap:.5rem}
.settings-link-row{
  display:flex;align-items:center;gap:.75rem;padding:.75rem 1rem;border:1px solid var(--border);border-radius:var(--radius);
  background:var(--card);color:var(--foreground);text-decoration:none;box-shadow:0 0 0 1px color-mix(in srgb,var(--foreground) 6%,transparent);
  transition:background .15s,border-color .15s}
html.dark .settings-link-row{box-shadow:0 0 0 1px color-mix(in srgb,var(--foreground) 10%,transparent)}
.settings-link-row:hover{background:var(--muted);border-color:color-mix(in srgb,var(--foreground) 12%,var(--border))}
.settings-link-row:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.settings-link-row-icon,.settings-link-row-chevron{flex-shrink:0;color:var(--muted-foreground)}
.settings-link-row-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:.15rem}
.settings-link-row-label{font-size:.9375rem;font-weight:500;line-height:1.35}
.settings-link-row-desc{font-size:.8125rem;line-height:1.35}
.settings-features-list{display:flex;flex-direction:column;gap:.65rem;margin:0}
.settings-feature-row{display:flex;flex-direction:column;gap:.35rem}
.settings-feature-top{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;width:100%}
.settings-feature-label{flex:1;min-width:0;font-size:.875rem;font-weight:500;line-height:1.4}
.settings-feature-status{flex-shrink:0}
.settings-feature-hint{margin:.35rem 0 0;font-size:.8125rem;line-height:1.45}
.settings-page button:disabled:not(.ghost){
  opacity:1;cursor:not-allowed;background:var(--muted);color:var(--muted-foreground);border-color:var(--border)}
.settings-page button:disabled:not(.ghost):hover{opacity:1}
.settings-page .settings-options-grid{align-items:stretch}
.settings-page .settings-option{display:flex;flex-direction:column;height:100%;box-sizing:border-box}
.settings-page .settings-option fieldset{border:0;padding:0;margin:0;min-height:0;display:flex;flex-direction:column;flex:1}
`;
