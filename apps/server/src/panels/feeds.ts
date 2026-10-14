import { parseFeedList } from "../feeds/parse";
import { fetchAllFeeds } from "../feeds/service";
import type { PanelModule } from "./types";

export const feedsPanel: PanelModule = {
  id: "feeds",
  title: "News feeds",
  dashboardHtml: `
<section class="card" id="panel-feeds">
  <div class="row"><h2 style="margin:0">News feeds</h2>
  <button type="button" class="ghost" id="feeds-refresh" style="margin-left:auto">Refresh now</button></div>
  <p class="dim" id="feeds-status">Loading…</p>
  <div id="feeds-list" class="feeds-panel-scroll"></div>
  <p class="feeds-full-link dim"><a href="/news">Open full tagged news view</a></p>
  <div class="row" style="margin-top:10px">
    <button type="button" class="ghost" id="feeds-mark-all">Mark all read</button>
  </div>
</section>`,
  async handle(ctx, req, res, path) {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    if (path === "/api/feeds" && req.method === "GET") {
      const parsed = parseFeedList(ctx.settings.get().feeds);
      const items = ctx.feeds.list({ limit: 80 });
      const unread = ctx.feeds.list({ unreadOnly: true, limit: 200 }).length;
      json(200, { items, unread, feeds: ctx.feeds.statuses(parsed.feeds.map((f) => f.id)), feedErrors: parsed.errors });
      return true;
    }
    if (path === "/api/feeds/fetch" && req.method === "POST") {
      const parsed = parseFeedList(ctx.settings.get().feeds);
      const results = await fetchAllFeeds(ctx.feeds, parsed.feeds);
      json(200, { results, unread: ctx.feeds.list({ unreadOnly: true }).length });
      return true;
    }
    if (path === "/api/feeds/read" && req.method === "POST") {
      let body = "";
      for await (const c of req) body += c;
      const ids = (JSON.parse(body || "{}") as { ids?: string[] }).ids ?? [];
      const n = ctx.feeds.markRead(ids);
      await ctx.feeds.save();
      json(200, { marked: n });
      return true;
    }
    if (path === "/api/feeds/read-all" && req.method === "POST") {
      const n = ctx.feeds.markAllRead();
      await ctx.feeds.save();
      json(200, { marked: n });
      return true;
    }
    return false;
  },
};

export function feedsDashboardScript(): string {
  return `
function renderFeeds(data){
  var st=document.getElementById("feeds-status");
  var unread=data.unread||0;
  st.textContent=unread?unread+" unread":"All caught up";
  var html="";
  (data.items||[]).forEach(function(it){
    var cls=it.read?"dim":"";
    html+='<div class="feed-item '+cls+'" data-id="'+esc(it.id)+'">';
    html+='<div class="row"><strong>'+(it.link?'<a href="'+esc(it.link)+'" target="_blank" rel="noopener">'+esc(it.title)+'</a>':esc(it.title))+'</strong>';
    if(!it.read)html+='<button type="button" class="ghost mark-read" data-id="'+esc(it.id)+'">Mark read</button>';
    html+='</div>';
    if(it.summary)html+='<p class="dim" style="margin:.3em 0">'+esc(it.summary)+'</p>';
    html+='<p class="dim" style="margin:0;font-size:.85rem">'+esc(it.feedId)+' · '+esc(it.firstSeenAt)+'</p></div>';
  });
  document.getElementById("feeds-list").innerHTML=html||'<p class="dim">No items yet. Feeds refresh on a schedule, or click Refresh now.</p>';
  document.querySelectorAll(".mark-read").forEach(function(b){b.onclick=function(){
    api("/api/feeds/read","POST",{ids:[b.dataset.id]}).then(loadFeeds);
  }});
}
function loadFeeds(){return api("/api/feeds").then(renderFeeds)}
var fr=document.getElementById("feeds-refresh");if(fr)fr.onclick=function(){fr.disabled=true;api("/api/feeds/fetch","POST",{}).then(loadFeeds).finally(function(){fr.disabled=false})};
var fa=document.getElementById("feeds-mark-all");if(fa)fa.onclick=function(){api("/api/feeds/read-all","POST",{}).then(loadFeeds)};
loadFeeds();
`;
}
