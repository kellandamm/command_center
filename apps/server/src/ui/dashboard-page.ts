import { defaultEntryForPanel } from "../dashboard-layout/defaults";
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
#panel-daily-briefing .dashboard-panel-body{padding-bottom:1rem}
#panel-daily-briefing .ui-empty{padding:1rem .5rem 1.25rem}
`;

const PANEL_SCRIPTS = [
  activityDashboardScript,
  focusDashboardScript,
  hobieDashboardScript,
  dailyBriefingDashboardScript,
  weatherDashboardScript,
  calendarDashboardScript,
  notesDashboardScript,
  hostHealthDashboardScript,
  recallioDashboardScript,
  tasksDashboardScript,
  attentionDashboardScript,
  heatmapDashboardScript,
  launchpadDashboardScript,
  agentsUsagePanelDashboardScript,
];

function dashboardItemsHtml(): string {
  return panels
    .map((panel) => {
      const entry = defaultEntryForPanel(panel.id);
      const collapsed = entry.collapsed ? " is-collapsed" : "";
      const span = entry.collapsed ? 1 : entry.h;
      return `<div class="dashboard-item${collapsed}" data-panel-id="${panel.id}" data-full-h="${entry.h}"
  style="--gc-start:${entry.x + 1};--gc-span:${entry.w};--gr-start:${entry.y + 1};--gr-span:${span}">
  ${panel.dashboardHtml}
</div>`;
    })
    .join("\n");
}

export function dashboardPage(nav?: NavLink[]): string {
  const pageLinks = Object.fromEntries(
    panels.filter((p) => p.pageHref).map((p) => [p.id, p.pageHref!]),
  );
  const panelTitles = Object.fromEntries(panels.map((p) => [p.id, p.title]));
  const layoutActions = `<details class="page-header-menu">
  <summary class="btn btn-outline btn-sm">Layout</summary>
  <div class="page-header-menu-panel">
    ${button({ label: "Reset layout", variant: "outline", size: "sm", attrs: { id: "dashboard-reset-layout" } })}
    ${button({ label: "Export layout", variant: "outline", size: "sm", href: "/api/dashboard-layout/export.json", attrs: { id: "dashboard-export-layout" } })}
    <input type="file" id="dashboard-import-layout" accept="application/json" hidden />
    ${button({ label: "Import layout", variant: "outline", size: "sm", className: "dashboard-import-btn", attrs: { id: "dashboard-import-layout-btn" } })}
  </div>
</details>`;
  return page({
    title: "Command center",
    active: "/",
    nav,
    extraCss: dashboardGridCss + dashboardPanelCss + quickAddCss + agentsUsagePanelCss,
    body: `<div class="dashboard-page">
${pageHeader({ title: "Dashboard", description: "Drag panels, pin what matters, and jump in quickly.", actionsHtml: layoutActions })}
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
<div id="dashboard-grid" class="dashboard-grid">${dashboardItemsHtml()}</div>
</div>`,
    script: `
var PANEL_PAGE_LINKS=${JSON.stringify(pageLinks)};
var PANEL_TITLES=${JSON.stringify(panelTitles)};
${dashboardGridScript()}
document.getElementById("dashboard-import-layout-btn")?.addEventListener("click",function(){
  document.getElementById("dashboard-import-layout")?.click();
});
document.getElementById("dashboard-import-layout")?.addEventListener("change",function(ev){
  var input=ev.target;var file=input.files&&input.files[0];if(!file)return;
  file.text().then(function(text){
    return api("/api/dashboard-layout/import","POST",JSON.parse(text));
  }).then(function(r){if(r.layout&&window.applyDashboardLayout)window.applyDashboardLayout(r.layout);})
  .catch(function(err){alert(err.message||"Import failed");})
  .finally(function(){input.value="";});
});
${PANEL_SCRIPTS.map((fn) => fn()).join("\n")}
${quickAddScript}
var dashboardQuickAdd=mountQuickAdd("dashboard-quick-add",{onVoiceCommitted:function(){if(window.__voiceInboxRefresh)window.__voiceInboxRefresh();}});
${voiceInboxScript}
window.__voiceInboxRefresh=(mountVoiceInbox(dashboardQuickAdd)||{}).refresh;
`,
  });
}
