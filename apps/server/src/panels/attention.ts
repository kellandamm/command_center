import { composeAttentionSections } from "../attention/sections";
import { isNoteSensitive } from "../notes/sensitive";
import type { TimelineEvent } from "../attention/types";
import { snoozeUntil } from "../attention/store";
import { dayKey } from "../store";
import { ValidationError } from "../settings";
import { panelCard } from "../ui/components";
import type { PanelModule } from "./types";

import { OWNER_ACTION_FORBIDDEN } from "../owner-auth";

function ownerDenied(res: import("node:http").ServerResponse): void {
  res.writeHead(403, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ error: OWNER_ACTION_FORBIDDEN }));
}

export const attentionPanel: PanelModule = {
  id: "attention",
  title: "Attention",
  dashboardHtml: panelCard("panel-attention", `
  <div id="attention-sections" class="attention-sections panel-scroll-region"></div>`),
  async handle(ctx, req, res, path) {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    if (path === "/api/dashboard/attention" && req.method === "GET") {
      const today = dayKey(new Date(), ctx.cfg.tz);
      const nowMs = Date.now();
      const notes = ctx.notes.listNotes().filter((note) => !isNoteSensitive(note));
      const sources = ctx.notes.listSources();
      const wins = ctx.wins.list(500);
      const cardEvents = ctx.board.listCardEventActivity();
      const timeline: TimelineEvent[] = [
        ...ctx.notes.listNotes()
          .filter((n) => !isNoteSensitive(n))
          .map((n) => ({ at: n.updatedAt, kind: "note" as const, refId: n.id, title: n.title })),
        ...cardEvents.map((e) => ({ at: e.at, kind: "card" as const, refId: e.cardId, title: e.title })),
      ];
      const snap = ctx.attention.snapshot();
      const sections = composeAttentionSections({
        todayYmd: today,
        tz: ctx.cfg.tz,
        nowMs,
        cards: ctx.board.list(),
        notes,
        sources,
        wins,
        timeline,
        pinned: snap.pinned,
        hidden: new Set(snap.hidden),
        isSnoozed: (id) => ctx.attention.isSnoozed(id, nowMs),
      });
      json(200, { sections, pinned: snap.pinned, hidden: snap.hidden });
      return true;
    }
    if (path === "/api/attention/pin" && req.method === "POST") {
      if (!ctx.owner) return ownerDenied(res), true;
      const body = await readJsonBody(req);
      if (typeof body.id !== "string" || typeof body.pinned !== "boolean") throw new ValidationError("id and pinned are required");
      await ctx.attention.setPinned(body.id, body.pinned);
      json(200, { ok: true });
      return true;
    }
    if (path === "/api/attention/snooze" && req.method === "POST") {
      if (!ctx.owner) return ownerDenied(res), true;
      const body = await readJsonBody(req);
      if (typeof body.id !== "string") throw new ValidationError("id is required");
      if (body.until === null || body.until === false) {
        await ctx.attention.clearSnooze(body.id);
      } else {
        const until = snoozeUntil(String(body.until ?? body.option ?? "1d"));
        await ctx.attention.snooze(body.id, until);
      }
      json(200, { ok: true });
      return true;
    }
    if (path === "/api/attention/hide" && req.method === "POST") {
      if (!ctx.owner) return ownerDenied(res), true;
      const body = await readJsonBody(req);
      if (typeof body.id !== "string" || typeof body.hidden !== "boolean") throw new ValidationError("id and hidden are required");
      await ctx.attention.setHidden(body.id, body.hidden);
      json(200, { ok: true });
      return true;
    }
    return false;
  },
};

async function readJsonBody(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const c of req) body += c;
  try {
    return JSON.parse(body || "{}") as Record<string, unknown>;
  } catch {
    throw new ValidationError("invalid JSON");
  }
}

export function attentionDashboardScript(): string {
  return `
function attentionAction(path,payload){
  return api(path,"POST",payload).then(function(){return loadAttention();});
}
function renderAttention(data){
  var root=document.getElementById("attention-sections");
  if(!root)return;
  var sections=data.sections||[];
  if(!sections.some(function(s){return s.items&&s.items.length;})){
    root.innerHTML='<div class="ui-empty" role="status"><p class="ui-empty-title">Nothing needs your attention right now.</p></div>';
    return;
  }
  root.innerHTML=sections.map(function(section){
    if(!section.items||!section.items.length)return "";
    var items=section.items.map(function(item){
      var controls='<span class="attention-controls">'
        +'<button type="button" class="ghost attention-pin" data-id="'+esc(item.id)+'" title="Pin">📌</button>'
        +'<button type="button" class="ghost attention-snooze" data-id="'+esc(item.id)+'" title="Snooze">⏸</button>'
        +'<button type="button" class="ghost attention-hide" data-id="'+esc(item.id)+'" title="Don\\'t rediscover">✕</button>'
        +'</span>';
      var warn=/overdue|due today/i.test(item.reason)?" attention-warn":"";
      return '<li class="todoist-item attention-item"><a href="'+esc(item.href)+'"><strong>'+esc(item.title)+'</strong></a>'
        +'<div class="dim attention-reason'+warn+'">'+esc(item.reason)+'</div>'+controls+'</li>';
    }).join("");
    var blockCls=section.id==="due"?" attention-block-warn":"";
    return '<section class="attention-block'+blockCls+'"><h3>'+esc(section.title)+'</h3><ul class="todoist-list">'+items+'</ul></section>';
  }).join("");
  root.querySelectorAll(".attention-pin").forEach(function(btn){
    btn.onclick=function(){attentionAction("/api/attention/pin",{id:btn.dataset.id,pinned:true});};
  });
  root.querySelectorAll(".attention-snooze").forEach(function(btn){
    btn.onclick=function(){attentionAction("/api/attention/snooze",{id:btn.dataset.id,until:"1d"});};
  });
  root.querySelectorAll(".attention-hide").forEach(function(btn){
    btn.onclick=function(){attentionAction("/api/attention/hide",{id:btn.dataset.id,hidden:true});};
  });
}
function loadAttention(){return api("/api/dashboard/attention").then(renderAttention);}
loadAttention();
`;
}
