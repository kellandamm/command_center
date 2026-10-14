import { panels } from "../panels/registry";
import { activityDashboardScript } from "../panels/activity";
import { aiSecurityDashboardScript } from "../panels/ai-security-panel";
import { briefingDashboardScript } from "../panels/briefing";
import { dailyBriefingDashboardScript } from "../panels/daily-briefing-panel";
import { hobieDashboardScript } from "../panels/hobie";
import { calendarDashboardScript } from "../panels/calendar";
import { feedsDashboardScript } from "../panels/feeds";
import { githubDashboardScript } from "../panels/github";
import { hostHealthDashboardScript } from "../panels/host-health";
import { notesDashboardScript } from "../panels/notes";
import { recallioDashboardScript } from "../panels/recallio";
import { taggedNewsDashboardScript } from "../panels/tagged-news";
import { todoistDashboardScript } from "../panels/todoist";
import { weatherDashboardScript } from "../panels/weather";
import { defaultDashboardLayout } from "../dashboard-layout/defaults";
import { dashboardGridScript } from "./dashboard-grid";
import { page } from "./layout";

function panelGridStyle(entry: { x: number; y: number; w: number; h: number }): string {
  return `--gc-start:${entry.x + 1};--gc-span:${entry.w};--gr-start:${entry.y + 1};--gr-span:${entry.h}`;
}

export function dashboardPage(): string {
  const layout = defaultDashboardLayout(panels.map((p) => p.id));
  const byId = new Map(layout.panels.map((p) => [p.id, p]));
  const sections = panels
    .map((p) => {
      const entry = byId.get(p.id)!;
      return `<div class="dashboard-item" data-panel-id="${p.id}" style="${panelGridStyle(entry)}">${p.dashboardHtml}</div>`;
    })
    .join("\n");
  return page({
    title: "Command center",
    active: "/",
    body: `<div class="dashboard-page"><header class="page-header"><h1>Dashboard</h1><p class="dim">Daily tools in one place. Drag panel headers to rearrange; resize from the corner handle.</p></header>
<div class="dashboard-toolbar">
  <button type="button" class="ghost" id="dashboard-reset-layout">Reset layout</button>
  <p class="dim">Layout is saved on this server.</p>
</div>
<div class="dashboard-grid" id="dashboard-grid">${sections}</div></div>`,
    script: `${dashboardGridScript()}${activityDashboardScript()}${hobieDashboardScript()}${taggedNewsDashboardScript()}${dailyBriefingDashboardScript()}${aiSecurityDashboardScript()}${weatherDashboardScript()}${calendarDashboardScript()}${notesDashboardScript()}${feedsDashboardScript()}${briefingDashboardScript()}${todoistDashboardScript()}${hostHealthDashboardScript()}${githubDashboardScript()}${recallioDashboardScript()}`,
  });
}

export function settingsPage(): string {
  return page({
    title: "Settings",
    active: "/settings",
    body: `<header class="page-header"><h1>Settings</h1><p class="dim">Feeds, briefing schedule, and fetch interval.</p></header>
<div class="card settings-card"><form id="f">
<label for="feeds">RSS / Atom feeds</label>
<textarea id="feeds" spellcheck="false"></textarea>
<p class="dim">One per line. Use <code>hn</code> for Hacker News, or paste a feed URL. Lines starting with <code>#</code> are comments.</p>
<div id="feederr" class="bad"></div>
<div class="row" style="gap:16px">
<div style="flex:1"><label for="fetchInterval">Fetch interval (minutes)</label><input id="fetchInterval" type="number" min="5" max="1440"></div>
<div style="flex:1"><label for="briefingTime">Daily briefing time</label><input id="briefingTime" placeholder="07:00"></div>
</div>
<div class="row" style="margin-top:18px"><button type="submit">Save</button><span id="saved" class="dim"></span></div></form></div>`,
    script: `
api("/api/settings").then(function(r){var s=r.settings;
 $("feeds").value=s.feeds;$("fetchInterval").value=s.fetchIntervalMinutes;$("briefingTime").value=s.briefingTime});
document.getElementById("f").onsubmit=function(e){e.preventDefault();$("saved").textContent="Saving…";$("feederr").textContent="";
 api("/api/settings","PUT",{feeds:$("feeds").value,fetchIntervalMinutes:$("fetchInterval").value,briefingTime:$("briefingTime").value})
 .then(function(r){$("saved").textContent="Saved ("+r.feedCount+" feeds)";
  $("feederr").textContent=(r.feedErrors||[]).map(function(x){return "Line "+x.line+": "+x.reason}).join("  ·  ")})
 .catch(function(err){$("saved").textContent="";$("feederr").textContent=err.message})};
var $=function(i){return document.getElementById(i)};`,
  });
}
