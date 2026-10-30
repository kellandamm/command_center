import { panelCard } from "../ui/components";
import type { PanelModule } from "./types";

export const agentsUsagePanel: PanelModule = {
  id: "agents-usage",
  title: "Agents usage",
  pageHref: "/agent?view=usage",
  dashboardHtml: panelCard("panel-agents-usage", `
  <div class="agents-usage-panel panel-scroll-region">
    <p class="agents-usage-stale-banner" hidden></p>
    <p class="agents-usage-cycle-msg" hidden></p>
    <div class="agents-usage-metrics">
      <div class="agents-usage-panel-head">
        <p class="agents-usage-panel-pct unavailable">${"Unavailable"}</p>
        <span class="pill unknown agents-usage-pace-pill">Unavailable</span>
      </div>
      <div class="agents-usage-panel-bar" aria-hidden="true"></div>
      <p class="agents-usage-reset dim">Reset unknown</p>
      <ul class="agents-usage-bots"></ul>
      <div class="agents-usage-panel-foot"><a href="/agent?view=usage">Open full usage →</a></div>
    </div>
  </div>`),
};

export { agentsUsagePanelDashboardScript } from "../ui/agents-usage-client";
