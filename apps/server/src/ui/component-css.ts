/** Shared shadcn-style component classes (appended after theme tokens in layout.ts). */
export const COMPONENT_CSS = `
.sr-only,.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.btn-secondary{background:var(--secondary);color:var(--secondary-foreground);border-color:transparent}
.btn-outline{background:transparent;color:var(--foreground);border-color:var(--border)}
.btn-outline:hover{background:var(--accent)}
.btn-destructive{background:var(--destructive);color:var(--primary-foreground);border-color:transparent}
.btn-link{background:transparent;color:var(--foreground);border-color:transparent;padding:0;min-height:auto;text-decoration:underline;text-underline-offset:3px}
.btn-link:hover{opacity:1;text-decoration-thickness:2px}
.btn-sm{font-size:.8125rem;padding:.35rem .75rem;min-height:2rem}
.btn-lg{font-size:.9375rem;padding:.65rem 1.25rem;min-height:2.75rem}
.btn-icon{min-width:2.25rem;padding:.5rem}
.ui-card-header{margin-bottom:.75rem}
.ui-card-title{font-size:.875rem;font-weight:600;line-height:1.2;margin:0}
.ui-card-desc{margin:.35rem 0 0;font-size:.8125rem}
.ui-card-content{min-width:0}
.dashboard-panel-body>.ui-card-content{padding:0}
.ui-badge{display:inline-flex;align-items:center;font-size:.7rem;font-weight:600;line-height:1;padding:.2em .55em;border-radius:999px;border:1px solid var(--border);background:var(--secondary);color:var(--secondary-foreground)}
.ui-badge-secondary{background:var(--muted);color:var(--muted-foreground)}
.ui-badge-outline{background:transparent;color:var(--foreground)}
.ui-badge-destructive{background:color-mix(in srgb,var(--destructive) 12%,transparent);color:var(--destructive);border-color:color-mix(in srgb,var(--destructive) 35%,var(--border))}
.ui-badge-warning{background:color-mix(in srgb,var(--warning, #ca8a04) 15%,transparent);color:var(--warning, #ca8a04);border-color:color-mix(in srgb,var(--warning, #ca8a04) 35%,var(--border))}
.ui-tabs{display:flex;gap:1.25rem;border-bottom:1px solid var(--border);margin-bottom:1rem;overflow:auto}
.ui-tabs a{padding:.65rem 0;white-space:nowrap;color:var(--muted-foreground);font-size:.875rem;font-weight:500}
.ui-tabs a[aria-current=page]{color:var(--foreground);border-bottom:2px solid var(--foreground);font-weight:600}
.ui-table{width:100%;border-collapse:collapse;font-size:.875rem}
.ui-table th,.ui-table td{text-align:left;padding:.4rem .35rem;border-top:1px solid var(--border);vertical-align:top}
.ui-table thead th{border-top:0;color:var(--muted-foreground);font-weight:500;font-size:.8125rem}
.ui-table tbody tr:first-child td{border-top:0}
.ui-field{margin:0 0 1rem}
.ui-field-label{display:block;margin:0 0 .35rem;font-size:.875rem;font-weight:500}
.ui-field-hint,.ui-field-error{margin:.35rem 0 0;font-size:.8125rem}
.ui-dialog{border:1px solid var(--border);border-radius:var(--radius);padding:0;max-width:32rem;width:calc(100% - 2rem);background:var(--card);color:var(--card-foreground);box-shadow:0 12px 40px rgba(0,0,0,.18)}
.ui-dialog::backdrop{background:rgba(0,0,0,.45)}
.ui-dialog-inner{margin:0;padding:1rem 1.25rem 1.25rem}
.ui-dialog-header{margin-bottom:.75rem}
.ui-dialog-title{margin:0;font-size:1rem;font-weight:600}
.ui-dialog-body{font-size:.875rem}
.ui-dialog-footer{margin-top:1rem;display:flex;gap:.5rem;justify-content:flex-end;flex-wrap:wrap}
.ui-empty{padding:1.25rem .5rem;text-align:center;border:1px dashed var(--border);border-radius:calc(var(--radius) - 2px)}
.ui-empty-title{margin:0;font-size:.875rem;font-weight:500}
.ui-empty-desc{margin:.5rem 0 0;font-size:.8125rem}
.ui-loading{padding:.75rem 0}
.ui-error{padding:.75rem;border:1px solid color-mix(in srgb,var(--destructive) 35%,var(--border));border-radius:calc(var(--radius) - 2px);background:color-mix(in srgb,var(--destructive) 6%,transparent)}
.ui-list{margin:0;padding-left:1.2rem}
.host-health-toolbar{display:flex;align-items:flex-start;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem}
.host-health-meta{flex:1;min-width:10rem}
.host-health-subhead{margin:1em 0 .4em;font-size:1rem;font-weight:600}
.host-health-host-grid{align-items:flex-start;gap:1rem}
.host-health-host-meta{flex:1;min-width:200px}
.host-health-metrics{flex:2;min-width:240px}
.host-metric-row{margin-bottom:.5rem}
.host-metric-label{min-width:4.5rem}
.host-metric-value{min-width:3rem;text-align:right}
.host-disk-path{margin:.4em 0 0;font-size:.85rem}
.recallio-form{margin:.65rem 0}
.recallio-form input[type=search]{flex:1;min-width:0}
.focus-controls label.dim{font-size:.8125rem;font-weight:400;margin:0}
.focus-controls input[type=number]{width:4rem;margin-left:.25rem}
.focus-task-select{width:100%;margin:.35rem 0}
.focus-actions{margin:.35rem 0}
.focus-timer{font-size:1.1rem;font-weight:600;margin:.35rem 0 0}
.host-metric-bar{background:var(--border);border-radius:6px;height:8px;flex:1;min-width:80px}
.host-metric-bar>span{display:block;height:100%;background:var(--accent);border-radius:6px}
.weather-temp{font-size:1.6rem;margin:.2em 0}
.weather-meta{margin:0}
#panel-notes textarea{width:100%;min-height:8rem;font-family:inherit}
.notes-panel-actions{margin-top:.5rem}
`;
