import { panels } from "../panels/registry";
import { briefingDashboardScript } from "../panels/briefing";
import { feedsDashboardScript } from "../panels/feeds";
import { githubDashboardScript } from "../panels/github";
import { hostHealthDashboardScript } from "../panels/host-health";
import { todoistDashboardScript } from "../panels/todoist";
import { page } from "./layout";

export function dashboardPage(): string {
  const sections = panels.map((p) => p.dashboardHtml).join("\n");
  return page({
    title: "Command center",
    active: "/",
    body: `<h1>Command center</h1><p class="dim">Daily tools in one place.</p>${sections}`,
    script: `${feedsDashboardScript()}${briefingDashboardScript()}${todoistDashboardScript()}${hostHealthDashboardScript()}${githubDashboardScript()}`,
  });
}

export function settingsPage(): string {
  return page({
    title: "Settings",
    active: "/settings",
    body: `<h1>Settings</h1><form id="f">
<label for="feeds">RSS / Atom feeds</label>
<textarea id="feeds" spellcheck="false"></textarea>
<p class="dim">One per line. Use <code>hn</code> for Hacker News, or paste a feed URL. Lines starting with <code>#</code> are comments.</p>
<div id="feederr" class="bad"></div>
<div class="row" style="gap:16px">
<div style="flex:1"><label for="fetchInterval">Fetch interval (minutes)</label><input id="fetchInterval" type="number" min="5" max="1440"></div>
<div style="flex:1"><label for="briefingTime">Daily briefing time</label><input id="briefingTime" placeholder="07:00"></div>
</div>
<div class="row" style="margin-top:18px"><button type="submit">Save</button><span id="saved" class="dim"></span></div></form>`,
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
