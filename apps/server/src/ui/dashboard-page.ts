import { defaultDashboardLayout } from "../dashboard-layout/defaults";
import type { DashboardLayout } from "../dashboard-layout/types";
import { renderDashboardGrid, renderWidgetDrawer, type DashboardRenderContext } from "../dashboard-layout/render-page";
import { serviceStatusClientScript } from "../widgets/service-status";
import { widgetById } from "../dashboard-layout/widgets";
import { panels } from "../panels/registry";
import { activityDashboardScript } from "../panels/activity";
import { attentionDashboardScript } from "../panels/attention";
import { calendarDashboardScript } from "../panels/calendar";
import { dailyBriefingDashboardScript } from "../panels/daily-briefing-panel";
import { heatmapDashboardScript } from "../panels/heatmap";
import { hobieDashboardScript } from "../panels/hobie";
import { hostHealthDashboardScript } from "../panels/host-health";
import { launchpadDashboardScript } from "../panels/launchpad";
import { focusDashboardScript } from "../panels/focus";
import { notesDashboardScript } from "../panels/notes";
import { recallioDashboardScript } from "../panels/recallio";
import { tasksDashboardScript } from "../panels/tasks";
import { weatherDashboardScript } from "../panels/weather";
import { agentsUsagePanelDashboardScript } from "../panels/agents-usage";
import { budgetDashboardScript, budgetPanelDashboardCss, BUDGET_PANEL_ID } from "../panels/budget";
import { agentsUsagePanelCss } from "./agents-usage-client";
import { button, pageHeader } from "./components";
import { dashboardGridCss, dashboardGridScript } from "./dashboard-grid";
import { page, type NavLink } from "./layout";
import { quickAddCss, quickAddScript } from "./quick-add";
import { voiceInboxScript } from "./voice-inbox";

export const dashboardPanelCss = `
.tasks-chips{display:flex;flex-wrap:wrap;gap:.35rem;margin-bottom:.35rem}
.tasks-chip[aria-pressed=true]{background:var(--selected);color:var(--selected-foreground);border-color:color-mix(in srgb,var(--primary) 35%,var(--border))}
.attention-block-warn h3{color:var(--warning)}
.attention-reason.attention-warn{color:var(--warning);font-weight:500}
.attention-sections{display:flex;flex-direction:column;gap:.65rem}
.attention-block h3{margin:0 0 .25rem;font-size:.8125rem;font-weight:600}
.attention-item{position:relative;padding-right:4.5rem}
.attention-controls{position:absolute;right:0;top:.15rem;display:flex;gap:.15rem}
.attention-controls button{min-height:auto;padding:.1rem .25rem;font-size:.75rem}
.heatmap-scroll{overflow-x:auto}
.heatmap-grid{display:grid;gap:2px;min-width:min(100%,26rem)}
.heatmap-cell{display:block;width:100%;aspect-ratio:1;border-radius:2px;background:var(--muted)}
.heatmap-cell.level-1{background:color-mix(in srgb,var(--primary) 25%,var(--muted))}
.heatmap-cell.level-2{background:color-mix(in srgb,var(--primary) 45%,var(--muted))}
.heatmap-cell.level-3{background:color-mix(in srgb,var(--primary) 65%,var(--muted))}
.heatmap-cell.level-4{background:var(--primary)}
.launchpad-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(6.5rem,1fr));gap:.35rem}
.launchpad-tile{display:flex;flex-direction:column;gap:.25rem;padding:.45rem;border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);text-decoration:none;color:inherit;font-size:.8125rem}
.launchpad-tile:hover{border-color:var(--ring)}
.launchpad-form{margin-top:.35rem;flex-wrap:wrap}
.launchpad-form input{flex:1;min-width:6rem}
.focus-timer{font-size:1.25rem;font-weight:600;margin:.25rem 0}
.focus-controls{gap:.75rem;flex-wrap:wrap}
.page-header-menu{position:relative}
.page-header-menu>summary{list-style:none;cursor:pointer}
.page-header-menu>summary::-webkit-details-marker{display:none}
.page-header-menu-panel{
  position:absolute;right:0;top:calc(100% + .35rem);min-width:12rem;padding:.35rem;display:flex;flex-direction:column;gap:.25rem;
  background:var(--card);border-radius:calc(var(--radius) - 2px);
  box-shadow:0 0 0 1px color-mix(in srgb,var(--foreground) 8%,transparent),0 8px 24px rgba(0,0,0,.12);z-index:30}
.page-header-menu-panel .btn,.page-header-menu-panel .dashboard-import-btn{justify-content:flex-start;width:100%}
#panel-daily-briefing .ui-empty{padding:1rem .5rem 1.25rem}
.widget-countdown .countdown-big{font-size:1.75rem;font-weight:700;letter-spacing:-.02em}
.world-clock-row{display:flex;justify-content:space-between;font-size:.8125rem;padding:.15rem 0}
.world-clock-row b{font-variant-numeric:tabular-nums}
.service-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
@media(max-width:640px){.service-grid{grid-template-columns:1fr}}
.service-cell{display:flex;align-items:center;gap:.35rem;padding:.45rem .55rem;border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);font-size:.8125rem;min-width:0}
.service-cell>span:nth-child(2){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.service-cell-down{border-color:color-mix(in srgb,var(--warning) 45%,var(--border))}
.service-cell-meta{margin-left:auto}
.agenda-summary{margin:0 0 .35rem}
.agenda-timeline{position:relative;height:6.5rem;margin-top:.35rem;border-top:1px solid var(--border)}
.agenda-hour{position:absolute;top:-1px;height:100%;border-left:1px dashed color-mix(in srgb,var(--border) 80%,transparent);font-size:.65rem;color:var(--muted-foreground);padding-left:.2rem;pointer-events:none}
.agenda-event{position:absolute;height:1.75rem;border-radius:calc(var(--radius) - 4px);padding:.2rem .35rem;font-size:.6875rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:color-mix(in srgb,var(--primary) 18%,var(--muted));top:1.5rem}
.agenda-now{position:absolute;top:-.35rem;bottom:0;border-left:2px solid var(--primary);pointer-events:none;z-index:2}
.agenda-now span{position:absolute;top:-1.1rem;left:-1.1rem;background:var(--primary);color:var(--primary-foreground);font-size:.625rem;font-weight:700;padding:.05rem .3rem;border-radius:calc(var(--radius) - 4px)}
`;

const PANEL_SCRIPT_BY_ID: Record<string, () => string> = {
  activity: activityDashboardScript,
  focus: focusDashboardScript,
  hobie: hobieDashboardScript,
  "daily-briefing": dailyBriefingDashboardScript,
  weather: weatherDashboardScript,
  calendar: calendarDashboardScript,
  notes: notesDashboardScript,
  "host-health": hostHealthDashboardScript,
  recallio: recallioDashboardScript,
  tasks: tasksDashboardScript,
  attention: attentionDashboardScript,
  heatmap: heatmapDashboardScript,
  launchpad: launchpadDashboardScript,
  "agents-usage": agentsUsagePanelDashboardScript,
  budget: budgetDashboardScript,
};

export function dashboardPage(
  nav?: NavLink[],
  opts?: { showBudgetPanel?: boolean; renderCtx?: DashboardRenderContext; layout?: DashboardLayout },
): string {
  const showBudgetPanel = opts?.showBudgetPanel ?? false;
  const layout = opts?.layout ?? opts?.renderCtx?.layout ?? defaultDashboardLayout({ showBudget: showBudgetPanel });
  const renderCtx: DashboardRenderContext =
    opts?.renderCtx ??
    ({
      cfg: { tz: "UTC" } as DashboardRenderContext["cfg"],
      layout,
      showBudgetPanel,
      showServiceStatusPanel: showBudgetPanel,
      calendarEvents: [],
      serviceStatus: [],
    } satisfies DashboardRenderContext);

  const panelIdsOnPage = new Set<string>();
  for (const w of layout.widgets) {
    const def = widgetById(w.id);
    if (def?.panelId) panelIdsOnPage.add(def.panelId);
  }
  const pageLinks = Object.fromEntries(
    panels.filter((p) => panelIdsOnPage.has(p.id) && p.pageHref).map((p) => [p.id, p.pageHref!]),
  );
  const panelTitles = Object.fromEntries(panels.filter((p) => panelIdsOnPage.has(p.id)).map((p) => [p.id, p.title]));
  const widgetTitles = Object.fromEntries(layout.widgets.map((w) => [w.id, widgetById(w.id)?.title ?? w.id]));

  const layoutActions = `${button({
    label: "Edit layout",
    variant: "outline",
    size: "sm",
    className: "dashboard-edit-toggle",
    attrs: { type: "button", id: "dashboard-edit-toggle", "aria-pressed": "false" },
  })}<details class="page-header-menu">
  <summary class="btn btn-outline btn-sm">Layout</summary>
  <div class="page-header-menu-panel">
    ${button({ label: "Reset layout", variant: "outline", size: "sm", attrs: { id: "dashboard-reset-layout" } })}
    ${button({ label: "Export layout", variant: "outline", size: "sm", href: "/api/dashboard-layout/export.json", attrs: { id: "dashboard-export-layout" } })}
    <input type="file" id="dashboard-import-layout" accept="application/json" hidden />
    ${button({ label: "Import layout", variant: "outline", size: "sm", className: "dashboard-import-btn", attrs: { id: "dashboard-import-layout-btn" } })}
  </div>
</details>`;

  const panelScripts = [...panelIdsOnPage]
    .filter((id) => showBudgetPanel || id !== BUDGET_PANEL_ID)
    .map((id) => PANEL_SCRIPT_BY_ID[id]?.())
    .filter(Boolean)
    .join("\n");

  return page({
    title: "Stremmy",
    active: "/",
    nav,
    extraCss: dashboardGridCss + dashboardPanelCss + quickAddCss + agentsUsagePanelCss + budgetPanelDashboardCss(),
    body: `<div class="dashboard-page">
${pageHeader({ title: "Dashboard", description: "Your Stremmy home — widgets, jobs, and quick capture.", actionsHtml: layoutActions })}
<p class="dim dashboard-edit-banner" hidden>Editing layout: drag ⠿ to reorder, pick a size, or add widgets from the drawer.</p>
<div class="dashboard-quick-add-bar quick-add-bar">
<div id="dashboard-quick-add" class="quick-add-wrap" aria-label="Quick add">
  <div class="quick-add-row"><input class="quick-add-input" type="text" placeholder="Quick add — e.g. call mom tomorrow 3pm" autocomplete="off" />${button({ label: "Preview", variant: "outline", size: "sm", className: "quick-add-parse" })}</div>
  <p class="quick-add-status dim" role="status"></p>
  <div class="quick-add-preview quick-add-dropdown" hidden></div>
</div>
</div>
<section id="voice-inbox" class="voice-inbox card" hidden aria-label="Voice inbox">
  <div class="voice-inbox-header"><strong>Voice inbox</strong><span class="voice-inbox-badge" hidden>0</span></div>
  <p class="voice-inbox-unavailable dim" hidden>Voice inbox unavailable</p>
  <ul class="voice-inbox-list"></ul>
</section>
<p class="dim dashboard-layout-hint" style="margin:0;font-size:.8125rem">Layout saves automatically.</p>
<div class="dashboard-main-row">
<div id="dashboard-grid" class="dashboard-grid">${renderDashboardGrid(renderCtx)}</div>
${renderWidgetDrawer(renderCtx)}
</div>
</div>`,
    script: `
var PANEL_PAGE_LINKS=${JSON.stringify(pageLinks)};
var PANEL_TITLES=${JSON.stringify(panelTitles)};
var WIDGET_TITLES=${JSON.stringify(widgetTitles)};
var DASHBOARD_LAYOUT=${JSON.stringify({ version: layout.version, registryEpoch: layout.registryEpoch, widgets: layout.widgets })};
${dashboardGridScript()}
${serviceStatusClientScript()}
document.getElementById("dashboard-import-layout-btn")?.addEventListener("click",function(){
  document.getElementById("dashboard-import-layout")?.click();
});
document.getElementById("dashboard-import-layout")?.addEventListener("change",function(ev){
  var input=ev.target;var file=input.files&&input.files[0];if(!file)return;
  file.text().then(function(text){
    return api("/api/dashboard-layout/import","POST",JSON.parse(text));
  }).then(function(r){if(r.layout&&window.applyDashboardLayout)window.applyDashboardLayout(r.layout);})
  .catch(function(err){alert(err.message||"Import failed");})
  .finally(function(){input.value="";document.querySelector(".page-header-menu[open]")?.removeAttribute("open");});
});
${panelScripts}
${quickAddScript}
var dashboardQuickAdd=mountQuickAdd("dashboard-quick-add",{onVoiceCommitted:function(){if(window.__voiceInboxRefresh)window.__voiceInboxRefresh();}});
${voiceInboxScript}
window.__voiceInboxRefresh=(mountVoiceInbox(dashboardQuickAdd)||{}).refresh;
`,
  });
}
