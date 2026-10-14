import { fetchGithubActivity } from "../github/activity";
import type { GithubActivitySnapshot } from "../github/activity";
import type { PanelModule } from "./types";

const CACHE_MS = 120_000;
let cache: { key: string; at: number; snapshot: GithubActivitySnapshot } | null = null;

function cacheKey(username: string, hasToken: boolean): string {
  return `${username}:${hasToken ? "auth" : "anon"}`;
}

async function loadActivity(username: string, token: string | null): Promise<GithubActivitySnapshot> {
  const key = cacheKey(username, Boolean(token));
  const now = Date.now();
  if (cache && cache.key === key && now - cache.at < CACHE_MS) return cache.snapshot;
  const snapshot = await fetchGithubActivity({ username, token });
  cache = { key, at: now, snapshot };
  return snapshot;
}

export const githubPanel: PanelModule = {
  id: "github",
  title: "GitHub",
  dashboardHtml: `
<section class="card" id="panel-github">
  <div class="row"><h2 style="margin:0">GitHub</h2>
  <button type="button" class="ghost" id="github-refresh" style="margin-left:auto">Refresh</button></div>
  <p class="dim" id="github-meta">Loading…</p>
  <p class="bad" id="github-warn" style="display:none"></p>
  <h3 style="margin:1em 0 .4em;font-size:1rem">Open pull requests</h3>
  <div id="github-prs"></div>
  <h3 style="margin:1em 0 .4em;font-size:1rem">Open issues</h3>
  <div id="github-issues"></div>
  <h3 style="margin:1em 0 .4em;font-size:1rem">Recent activity</h3>
  <div id="github-events"></div>
</section>`,
  async handle(ctx, req, res, path) {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    if (path === "/api/github/activity" && req.method === "GET") {
      const snapshot = await loadActivity(ctx.cfg.githubUsername, ctx.cfg.githubToken);
      json(200, { activity: snapshot });
      return true;
    }
    if (path === "/api/github/activity/refresh" && req.method === "POST") {
      cache = null;
      const snapshot = await loadActivity(ctx.cfg.githubUsername, ctx.cfg.githubToken);
      json(200, { activity: snapshot });
      return true;
    }
    return false;
  },
};

export function githubDashboardScript(): string {
  return `
function ghList(elId, rows, empty){
  var el=document.getElementById(elId);
  if(!rows||!rows.length){el.innerHTML='<p class="dim">'+esc(empty)+'</p>';return;}
  var html="";
  rows.forEach(function(r){
    html+='<div class="feed-item"><div class="row"><strong><a href="'+esc(r.url)+'" target="_blank" rel="noopener">'+esc(r.title)+'</a></strong></div>';
    html+='<p class="dim" style="margin:.25em 0 0;font-size:.85rem">'+esc(r.repo||"")+' · #'+r.number+' · '+esc(r.updatedAt||r.createdAt||"")+'</p></div>';
  });
  el.innerHTML=html;
}
function renderGithub(data){
  var a=data.activity||{};
  var meta=document.getElementById("github-meta");
  var warn=document.getElementById("github-warn");
  meta.textContent="@"+(a.username||"")+" · "+(a.pulls||[]).length+" open PRs · "+(a.issues||[]).length+" open issues · updated "+(a.fetchedAt||"");
  if(a.authenticated)meta.textContent+=" · token set";
  if(a.warning){warn.style.display="block";warn.textContent=a.warning;}else{warn.style.display="none";warn.textContent="";}
  ghList("github-prs",a.pulls,"No open pull requests.");
  ghList("github-issues",a.issues,"No open issues assigned or authored.");
  ghList("github-events",a.events,"No recent public events.");
}
function loadGithub(){return api("/api/github/activity").then(renderGithub)}
var gr=document.getElementById("github-refresh");
if(gr)gr.onclick=function(){gr.disabled=true;api("/api/github/activity/refresh","POST",{}).then(renderGithub).finally(function(){gr.disabled=false})};
loadGithub();
`;
}
