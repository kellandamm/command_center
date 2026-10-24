import { fetchDockerSnapshot } from "../docker/read-client";
import { collectHostMetrics } from "../host/metrics";
import { dockerSocketPath } from "../config";
import { loadingState, panelCard } from "../ui/components";
import type { PanelModule } from "./types";

export const hostHealthPanel: PanelModule = {
  id: "host-health",
  title: "Server health",
  dashboardHtml: panelCard("panel-host-health", `
  <div class="host-health-toolbar row">
    <div id="host-health-meta-wrap" class="host-health-meta">${loadingState()}</div>
    <button type="button" class="ghost" id="host-health-refresh">Refresh</button>
  </div>
  <div id="host-health-host"></div>
  <h3 class="host-health-subhead">Containers</h3>
  <p class="dim" id="host-health-docker-note"></p>
  <div id="host-health-containers"></div>`),
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
function bar(pct){var n=Math.max(0,Math.min(100,Number(pct)||0));return '<div class="host-metric-bar"><span style="width:'+n+'%"></span></div>';}
function hostBlock(h){
  var cpu=h.cpu||{};
  var mem=h.memory||{};
  var disk=h.disk;
  var html='<div class="row host-health-host-grid">';
  html+='<div class="host-health-host-meta"><strong>'+esc(h.hostname||"host")+'</strong><p class="dim">Uptime '+Math.floor((h.uptimeSec||0)/3600)+'h · '+cpu.cores+' cores</p>';
  html+='<p class="dim">Load '+((cpu.loadAvg||[]).map(function(x){return Number(x).toFixed(2)}).join(" / ")||"—")+'</p></div>';
  html+='<div class="host-health-metrics">';
  html+='<div class="row host-metric-row"><span class="host-metric-label">CPU</span>'+bar(cpu.usedPercent)+'<span class="dim host-metric-value">'+(cpu.usedPercent!=null?cpu.usedPercent+"%":"…")+'</span></div>';
  html+='<div class="row host-metric-row"><span class="host-metric-label">Memory</span>'+bar(mem.usedPercent)+'<span class="dim host-metric-value">'+esc(fmtB(mem.totalBytes-mem.freeBytes))+' / '+esc(fmtB(mem.totalBytes))+'</span></div>';
  if(disk){
    html+='<div class="row host-metric-row"><span class="host-metric-label">Disk</span>'+bar(disk.usedPercent)+'<span class="dim host-metric-value">'+esc(fmtB(disk.totalBytes-disk.freeBytes))+' / '+esc(fmtB(disk.totalBytes))+'</span></div>';
    html+='<p class="dim host-disk-path">'+esc(disk.path)+'</p>';
  }else if(h.diskError){
    html+='<p class="dim">Disk: '+esc(h.diskError)+'</p>';
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
    return '<div class="ui-empty" role="status"><p class="ui-empty-title">No container data.</p></div>';
  }
  note.textContent=(d.version?"Engine "+d.version+" · ":"")+(d.containers||[]).length+" container(s) · read-only";
  var rows=d.containers||[];
  if(!rows.length)return '<div class="ui-empty" role="status"><p class="ui-empty-title">No containers reported.</p></div>';
  var html='<table class="ui-table"><caption class="sr-only">Docker containers</caption><thead><tr><th scope="col">Name</th><th scope="col">State</th><th scope="col">Status</th></tr></thead><tbody>';
  rows.forEach(function(c){
    var cls=c.state==="running"?"ok":"dim";
    var health=c.health?(" · health "+c.health):"";
    html+='<tr><td><strong>'+esc(c.name)+'</strong><br><span class="dim">'+esc(c.image)+'</span></td>';
    html+='<td class="'+cls+'">'+esc(c.state)+'</td>';
    html+='<td class="dim">'+esc(c.status)+health+'</td></tr>';
  });
  html+='</tbody></table>';
  return html;
}
function renderHostHealth(data){
  var metaWrap=document.getElementById("host-health-meta-wrap");
  if(metaWrap)metaWrap.innerHTML='<p class="dim" id="host-health-meta">Updated '+esc(new Date().toISOString())+' · metrics are read-only</p>';
  document.getElementById("host-health-host").innerHTML=hostBlock(data.host||{});
  document.getElementById("host-health-containers").innerHTML=renderContainers(data.docker||{available:false,containers:[]});
}
function loadHostHealth(){return api("/api/host-health").then(renderHostHealth)}
var hr=document.getElementById("host-health-refresh");if(hr)hr.onclick=function(){hr.disabled=true;loadHostHealth().finally(function(){hr.disabled=false})};
loadHostHealth();
setInterval(loadHostHealth,60000);
`;
}
