import { fetchDockerSnapshot } from "../docker/read-client";
import { collectHostMetrics } from "../host/metrics";
import { dockerSocketPath } from "../config";
import type { PanelModule } from "./types";

export const hostHealthPanel: PanelModule = {
  id: "host-health",
  title: "Server health",
  dashboardHtml: `
<section class="card" id="panel-host-health">
  <div class="row"><h2 style="margin:0">Server health</h2>
  <button type="button" class="ghost" id="host-health-refresh" style="margin-left:auto">Refresh</button></div>
  <p class="dim" id="host-health-meta">Loading…</p>
  <div id="host-health-host"></div>
  <h3 style="margin:1em 0 .4em;font-size:1rem">Containers</h3>
  <p class="dim" id="host-health-docker-note"></p>
  <div id="host-health-containers"></div>
</section>`,
  async handle(ctx, req, res, path) {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    if (path === "/api/host-health" && req.method === "GET") {
      const host = await collectHostMetrics(ctx.cfg.dataDir);
      const socket = dockerSocketPath(ctx.cfg);
      const docker = socket ? await fetchDockerSnapshot(socket) : { available: false, reason: "Docker not configured (set DOCKER_SOCKET)", containers: [] };
      json(200, { host, docker, readOnly: true });
      return true;
    }
    return false;
  },
};

export function hostHealthDashboardScript(): string {
  return `
function bar(pct){var n=Math.max(0,Math.min(100,Number(pct)||0));return '<div style="background:var(--line);border-radius:6px;height:8px;flex:1;min-width:80px"><div style="width:'+n+'%;height:100%;background:var(--accent);border-radius:6px"></div></div>';}
function hostBlock(h){
  var cpu=h.cpu||{};
  var mem=h.memory||{};
  var disk=h.disk;
  var html='<div class="row" style="align-items:flex-start;gap:16px">';
  html+='<div style="flex:1;min-width:200px"><strong>'+esc(h.hostname||"host")+'</strong><p class="dim" style="margin:.3em 0">Uptime '+Math.floor((h.uptimeSec||0)/3600)+'h · '+cpu.cores+' cores</p>';
  html+='<p class="dim" style="margin:0">Load '+((cpu.loadAvg||[]).map(function(x){return Number(x).toFixed(2)}).join(" / ")||"—")+'</p></div>';
  html+='<div style="flex:2;min-width:240px">';
  html+='<div class="row" style="margin-bottom:8px"><span style="min-width:72px">CPU</span>'+bar(cpu.usedPercent)+'<span class="dim" style="min-width:48px;text-align:right">'+(cpu.usedPercent!=null?cpu.usedPercent+"%":"…")+'</span></div>';
  html+='<div class="row" style="margin-bottom:8px"><span style="min-width:72px">Memory</span>'+bar(mem.usedPercent)+'<span class="dim" style="min-width:90px;text-align:right">'+esc(fmtB(mem.totalBytes-mem.freeBytes))+' / '+esc(fmtB(mem.totalBytes))+'</span></div>';
  if(disk){
    html+='<div class="row"><span style="min-width:72px">Disk</span>'+bar(disk.usedPercent)+'<span class="dim" style="min-width:90px;text-align:right">'+esc(fmtB(disk.totalBytes-disk.freeBytes))+' / '+esc(fmtB(disk.totalBytes))+'</span></div>';
    html+='<p class="dim" style="margin:.4em 0 0;font-size:.85rem">'+esc(disk.path)+'</p>';
  }else if(h.diskError){
    html+='<p class="dim" style="margin:0">Disk: '+esc(h.diskError)+'</p>';
  }
  html+='</div></div>';
  return html;
}
function fmtB(n){return (window.__hostFmtB||(window.__hostFmtB=function(b){
  if(!Number.isFinite(b)||b<0)return "—";
  var u=["B","KB","MB","GB","TB"],v=b,i=0;
  while(v>=1024&&i<u.length-1){v/=1024;i++;}
  var d=i===0?0:v>=100?0:v>=10?1:2;
  return v.toFixed(d)+" "+u[i];
}))(n);}
function renderContainers(d){
  var note=document.getElementById("host-health-docker-note");
  if(!d.available){
    note.textContent=d.reason||"Docker unavailable";
    return '<p class="dim">No container data.</p>';
  }
  note.textContent=(d.version?"Engine "+d.version+" · ":"")+(d.containers||[]).length+" container(s) · read-only";
  var rows=d.containers||[];
  if(!rows.length)return '<p class="dim">No containers reported.</p>';
  var html='<table style="width:100%;border-collapse:collapse;font-size:.9rem"><thead><tr class="dim"><th style="text-align:left;padding:6px 4px">Name</th><th style="text-align:left;padding:6px 4px">State</th><th style="text-align:left;padding:6px 4px">Status</th></tr></thead><tbody>';
  rows.forEach(function(c){
    var cls=c.state==="running"?"ok":"dim";
    var health=c.health?(" · health "+c.health):"";
    html+='<tr><td style="padding:6px 4px;border-top:1px solid var(--line)"><strong>'+esc(c.name)+'</strong><br><span class="dim">'+esc(c.image)+'</span></td>';
    html+='<td style="padding:6px 4px;border-top:1px solid var(--line)" class="'+cls+'">'+esc(c.state)+'</td>';
    html+='<td style="padding:6px 4px;border-top:1px solid var(--line)" class="dim">'+esc(c.status)+health+'</td></tr>';
  });
  html+='</tbody></table>';
  return html;
}
function renderHostHealth(data){
  document.getElementById("host-health-meta").textContent="Updated "+new Date().toISOString()+" · metrics are read-only";
  document.getElementById("host-health-host").innerHTML=hostBlock(data.host||{});
  document.getElementById("host-health-containers").innerHTML=renderContainers(data.docker||{available:false,containers:[]});
}
function loadHostHealth(){return api("/api/host-health").then(renderHostHealth)}
var hr=document.getElementById("host-health-refresh");if(hr)hr.onclick=function(){hr.disabled=true;loadHostHealth().finally(function(){hr.disabled=false})};
loadHostHealth();
setInterval(loadHostHealth,60000);
`;
}
