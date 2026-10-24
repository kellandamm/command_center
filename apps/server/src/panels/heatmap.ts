import { aggregateDailyCounts, buildHeatmapDays, heatmapDateRange, dayKeyFromIso } from "../heatmap/counts";
import { dayKey } from "../store";
import { panelCard } from "../ui/components";
import type { PanelModule } from "./types";

export const heatmapPanel: PanelModule = {
  id: "heatmap",
  title: "Activity heatmap",
  pageHref: "/agent?view=activity",
  dashboardHtml: panelCard("panel-heatmap", `
  <p class="dim ui-card-desc">Last 26 weeks of board moves, wins, note edits, and focus sessions.</p>
  <div id="heatmap-scroll" class="heatmap-scroll panel-scroll-region">
    <div id="heatmap-grid" class="heatmap-grid" role="img" aria-label="Activity heatmap"></div>
  </div>`),
  async handle(ctx, req, res, path) {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    if (path !== "/api/dashboard/heatmap" || req.method !== "GET") return false;
    const { days } = heatmapDateRange(new Date());
    const since = `${days[0]}T00:00:00.000Z`;
    const stamps: string[] = [
      ...ctx.board.eventTimestampsSince(since),
      ...ctx.wins.list(5_000).map((w) => w.at),
      ...ctx.notes.listNotes().map((n) => n.updatedAt),
      ...ctx.focusSessions.endedAtSince(since),
    ];
    const counts = aggregateDailyCounts(stamps, ctx.cfg.tz, days);
    json(200, { days: buildHeatmapDays(counts, days) });
    return true;
  },
};

export function heatmapDashboardScript(): string {
  return `
function renderHeatmap(data){
  var grid=document.getElementById("heatmap-grid");
  if(!grid)return;
  var days=data.days||[];
  grid.style.gridTemplateColumns="repeat(26,minmax(10px,1fr))";
  grid.style.gridTemplateRows="repeat(7,minmax(10px,1fr))";
  var cells=[];
  for(var c=0;c<26;c++){
    for(var r=0;r<7;r++){
      var idx=c*7+r;
      var d=days[idx];
      if(!d)continue;
      cells.push('<span class="heatmap-cell level-'+d.level+'" title="'+esc(d.date)+": "+d.count+'"></span>');
    }
  }
  grid.innerHTML=cells.join("");
}
function loadHeatmap(){return api("/api/dashboard/heatmap").then(renderHeatmap);}
loadHeatmap();
`;
}
