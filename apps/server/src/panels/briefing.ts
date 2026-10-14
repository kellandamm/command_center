import { feedIdsInScope } from "../feed-scope";
import type { PanelModule } from "./types";
import { llmConfig } from "../config";

export const briefingPanel: PanelModule = {
  id: "briefing",
  title: "AI briefing",
  dashboardHtml: `
<section class="card" id="panel-briefing">
  <div class="row"><h2 style="margin:0">AI briefing</h2>
  <button type="button" class="ghost" id="briefing-generate" style="margin-left:auto">Generate now</button></div>
  <p class="dim" id="briefing-meta"></p>
  <pre id="briefing-body" class="briefing"></pre>
</section>`,
  async handle(ctx, req, res, path) {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    if (path === "/api/briefing" && req.method === "GET") {
      const last = ctx.briefing.get();
      json(200, { briefing: last, llmEnabled: Boolean(llmConfig(ctx.cfg)) });
      return true;
    }
    if (path === "/api/briefing/generate" && req.method === "POST") {
      const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
      const rec = await ctx.briefing.generate({
        llm: llmConfig(ctx.cfg),
        feeds: ctx.feeds,
        sinceIso: since,
        trigger: "manual",
        feedIds: feedIdsInScope(ctx.feeds, ctx.settings.get().feedScope),
      });
      json(200, { briefing: rec, llmEnabled: Boolean(llmConfig(ctx.cfg)) });
      return true;
    }
    return false;
  },
};

export function briefingDashboardScript(): string {
  return `
function renderBriefing(r){
  var meta=document.getElementById("briefing-meta");
  var body=document.getElementById("briefing-body");
  var btn=document.getElementById("briefing-generate");
  if(!r.llmEnabled){
    meta.textContent="Briefing disabled — set LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL on the server.";
    body.textContent="";
    if(btn)btn.disabled=true;
    return;
  }
  if(btn)btn.disabled=false;
  var b=r.briefing;
  if(!b){meta.textContent="No briefing yet.";body.textContent="";return;}
  meta.textContent=(b.error?"Error: "+b.error:"Updated "+b.generatedAt+" · "+b.itemCount+" items · "+b.trigger);
  body.textContent=b.error?"":(b.content||"");
}
function loadBriefing(){return api("/api/briefing").then(renderBriefing)}
var bg=document.getElementById("briefing-generate");
if(bg)bg.onclick=function(){bg.disabled=true;api("/api/briefing/generate","POST",{}).then(renderBriefing).finally(function(){bg.disabled=false})};
loadBriefing();
`;
}
