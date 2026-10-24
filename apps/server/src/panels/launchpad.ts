import type { PanelModule } from "./types";
import { ValidationError } from "../settings";

const OWNER_MSG =
  "Connection management requires a verified owner login. Set OWNER_EMAILS and sign in through Cloudflare Access; machine/admin tokens cannot manage keys.";

function ownerDenied(res: import("node:http").ServerResponse): void {
  res.writeHead(403, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ error: OWNER_MSG }));
}

async function readJsonBody(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const c of req) body += c;
  try {
    return JSON.parse(body || "{}") as Record<string, unknown>;
  } catch {
    throw new ValidationError("invalid JSON");
  }
}

export const launchpadPanel: PanelModule = {
  id: "launchpad",
  title: "Launchpad",
  dashboardHtml: `
<section class="card" id="panel-launchpad">
  <div id="launchpad-grid" class="launchpad-grid panel-scroll-region"></div>
  <form id="launchpad-form" class="launchpad-form row" hidden>
    <input id="launchpad-label" placeholder="Label" maxlength="120" required />
    <input id="launchpad-url" placeholder="https://…" maxlength="2048" required />
    <input id="launchpad-emoji" placeholder="Emoji" maxlength="8" />
    <button type="submit">Add link</button>
  </form>
</section>`,
  async handle(ctx, req, res, path) {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    if (path === "/api/launchpad" && req.method === "GET") {
      json(200, { links: ctx.launchpad.list(), owner: ctx.owner });
      return true;
    }
    if (path === "/api/launchpad" && req.method === "POST") {
      if (!ctx.owner) return ownerDenied(res), true;
      const body = await readJsonBody(req);
      const link = await ctx.launchpad.add({
        label: String(body.label ?? ""),
        url: String(body.url ?? ""),
        emoji: body.emoji !== undefined ? String(body.emoji) : undefined,
      });
      json(201, { link });
      return true;
    }
    const match = path.match(/^\/api\/launchpad\/([^/]+)$/);
    if (match && req.method === "PUT") {
      if (!ctx.owner) return ownerDenied(res), true;
      const body = await readJsonBody(req);
      const link = await ctx.launchpad.update(decodeURIComponent(match[1]!), {
        label: body.label !== undefined ? String(body.label) : undefined,
        url: body.url !== undefined ? String(body.url) : undefined,
        emoji: body.emoji === null ? null : body.emoji !== undefined ? String(body.emoji) : undefined,
      });
      if (!link) return json(404, { error: "link not found" }), true;
      json(200, { link });
      return true;
    }
    if (match && req.method === "DELETE") {
      if (!ctx.owner) return ownerDenied(res), true;
      const ok = await ctx.launchpad.remove(decodeURIComponent(match[1]!));
      json(200, { removed: ok });
      return true;
    }
    return false;
  },
};

export function launchpadDashboardScript(): string {
  return `
function renderLaunchpad(data){
  var grid=document.getElementById("launchpad-grid");
  var form=document.getElementById("launchpad-form");
  if(!grid)return;
  var links=data.links||[];
  grid.innerHTML=links.length?links.map(function(link){
    var emoji=link.emoji?esc(link.emoji)+" ":"";
    var del=data.owner?'<button type="button" class="ghost launchpad-remove" data-id="'+esc(link.id)+'">Remove</button>':'';
    return '<a class="launchpad-tile" href="'+esc(link.url)+'" target="_blank" rel="noopener noreferrer">'
      +'<span class="launchpad-label">'+emoji+esc(link.label)+'</span>'+del+'</a>';
  }).join(""):'<p class="dim">No links yet.</p>';
  if(form)form.hidden=!data.owner;
  grid.querySelectorAll(".launchpad-remove").forEach(function(btn){
    btn.onclick=function(e){e.preventDefault();
      api("/api/launchpad/"+encodeURIComponent(btn.dataset.id),"DELETE").then(loadLaunchpad);
    };
  });
}
function loadLaunchpad(){return api("/api/launchpad").then(renderLaunchpad);}
var launchpadForm=document.getElementById("launchpad-form");
if(launchpadForm)launchpadForm.onsubmit=function(e){
  e.preventDefault();
  api("/api/launchpad","POST",{
    label:document.getElementById("launchpad-label").value,
    url:document.getElementById("launchpad-url").value,
    emoji:document.getElementById("launchpad-emoji").value
  }).then(function(){launchpadForm.reset();loadLaunchpad();});
};
loadLaunchpad();
`;
}
