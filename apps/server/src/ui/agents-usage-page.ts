import type { NavLink } from "./layout";
import { page } from "./layout";
import { AGENTS_USAGE_CLIENT_HELPERS } from "./agents-usage-client";
import { CHART_SVG_CLIENT } from "./chart-svg";
import { pageHeader } from "./components";

const usageCss = `
.usage-hero{display:grid;grid-template-columns:minmax(220px,1fr) 2fr;gap:var(--grid-gap);margin-bottom:var(--section-gap)}
@media(max-width:900px){.usage-hero{grid-template-columns:1fr}}
.usage-ring-wrap{display:flex;flex-direction:column;align-items:center;gap:.75rem}
.usage-ring-legend{font-size:.85rem;color:var(--muted-foreground);text-align:center}
.usage-charts{display:grid;grid-template-columns:1fr;gap:var(--grid-gap);margin:var(--section-gap) 0}
.usage-chart svg{width:100%;height:auto;display:block}
.usage-table{width:100%;border-collapse:collapse;font-size:.875rem}
.usage-table th,.usage-table td{padding:.5rem .5rem .5rem 1rem;border-bottom:1px solid var(--border);text-align:left}
.usage-table th{color:var(--muted-foreground);font-weight:500;font-size:.75rem;background:color-mix(in srgb,var(--muted) 50%,transparent)}
.usage-table .num{text-align:right}
.pill{display:inline-flex;align-items:center;gap:.35rem;padding:.2rem .55rem;border-radius:999px;font-size:.75rem;font-weight:600}
.pill.on-pace{background:color-mix(in srgb,var(--primary) 18%,transparent);color:var(--primary)}
.pill.ahead{background:color-mix(in srgb,var(--warning) 22%,transparent);color:var(--warning)}
.pill.behind{background:color-mix(in srgb,var(--primary) 18%,transparent);color:var(--primary)}
.pill.unknown{background:var(--muted);color:var(--muted-foreground)}
.bar-over{fill:var(--warning)}
.bar-under{fill:var(--chart-1)}
.line-usage{stroke:var(--chart-1);fill:none;stroke-width:2}
.line-baseline{stroke:var(--chart-2);fill:none;stroke-width:1.5;stroke-dasharray:4 3}
.line-cap{stroke:var(--muted-foreground);stroke-dasharray:6 4;opacity:.6}
.usage-stat-card .stat-value{font-size:1.625rem;font-variant-numeric:tabular-nums}
.usage-stat-card .stat-hint{white-space:nowrap}
`;

export function agentsUsagePage(nav?: NavLink[]): string {
  return page({
    title: "Usage — Command Center",
    active: "/agent/usage",
    nav,
    extraCss: usageCss,
    body: `${pageHeader({ title: "Agent usage", description: "Weekly Grok Build quota from automated check-ins." })}
<div id="usage-unavailable" class="card" hidden><p><strong>Unavailable</strong> — no successful reading yet. Imports with <code>weeklyPercentUsed: null</code> stay unavailable (never shown as 0%).</p></div>
<div id="usage-root" hidden>
<section class="usage-hero card">
<div class="usage-ring-wrap">
<svg id="usage-ring" viewBox="0 0 120 120" width="160" height="160" aria-label="Weekly usage ring"></svg>
<div id="usage-ring-center" class="usage-ring-legend"></div>
<span id="usage-status-pill" class="pill unknown">Unavailable</span>
</div>
<div class="stat-grid" id="usage-stats"></div>
</section>
<section class="card usage-charts">
<h2 style="margin-top:0">Cumulative vs baseline</h2>
<div class="usage-chart"><svg id="usage-line-chart" viewBox="0 0 700 220" role="img" aria-label="Cumulative usage chart"></svg></div>
<h2>Daily increments</h2>
<div class="usage-chart"><svg id="usage-bar-chart" viewBox="0 0 700 200" role="img" aria-label="Daily increment chart"></svg></div>
</section>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
<section class="card"><h2 style="margin-top:0">By bot</h2><table class="usage-table"><thead><tr><th>Bot</th><th>Share</th></tr></thead><tbody id="usage-bots"></tbody></table></section>
<section class="card"><h2 style="margin-top:0">By routine</h2><table class="usage-table"><thead><tr><th>Routine</th><th>Share</th></tr></thead><tbody id="usage-routines"></tbody></table></section>
</div>
<section class="card" style="margin-top:1rem"><h2 style="margin-top:0">Daily log</h2><table class="usage-table"><thead><tr><th>Recorded</th><th>Weekly %</th><th>Reset at</th></tr></thead><tbody id="usage-log"></tbody></table></section>
<section class="card" style="margin-top:1rem"><h2 style="margin-top:0">Check-in notes</h2><div id="usage-checkins"></div></section>
<footer class="dim" style="margin-top:1rem;font-size:.85rem" id="usage-footer"></footer>
</div>`,
    script: usageScript(),
  });
}

function usageScript(): string {
  return `
${AGENTS_USAGE_CLIENT_HELPERS}
${CHART_SVG_CLIENT}
function $(id){return document.getElementById(id);}
function element(tag,text,cls){var e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function fail(err){console.error(err);var box=$("usage-unavailable");if(box){box.hidden=false;box.querySelector("p").textContent=err&&err.message?err.message:String(err);}}
function statCard(title,value,sub){
  var el=document.createElement("article");el.className="stat-card card card-sm usage-stat-card";
  el.innerHTML="<div class=\\"stat-card-top\\"><span class=\\"stat-label dim\\">"+esc(title)+"</span></div><div class=\\"stat-value tabular-nums\\">"+esc(value)+"</div>"+(sub?"<p class=\\"stat-hint dim\\">"+esc(sub)+"</p>":"");
  return el;
}
function renderRing(pct,baseline,dayIndex,daysLeft){
  var svg=$("usage-ring");svg.replaceChildren();
  var cx=60,cy=60,r=46,track=document.createElementNS("http://www.w3.org/2000/svg","circle");
  track.setAttribute("cx",String(cx));track.setAttribute("cy",String(cy));track.setAttribute("r",String(r));
  track.setAttribute("fill","none");track.setAttribute("stroke","var(--muted)");track.setAttribute("stroke-width","10");
  svg.appendChild(track);
  if(pct!==null&&Number.isFinite(pct)){
    var used=Math.min(100,pct),circ=2*Math.PI*r;
    var arc=document.createElementNS("http://www.w3.org/2000/svg","circle");
    arc.setAttribute("cx",String(cx));arc.setAttribute("cy",String(cy));arc.setAttribute("r",String(r));
    arc.setAttribute("fill","none");arc.setAttribute("stroke",pct>(baseline||0)?"var(--warning)":"var(--chart-1)");
    arc.setAttribute("stroke-width","10");arc.setAttribute("stroke-linecap","round");
    arc.setAttribute("stroke-dasharray",String(circ*used/100)+" "+String(circ));
    arc.setAttribute("transform","rotate(-90 "+cx+" "+cy+")");
    svg.appendChild(arc);
  }
  if(baseline!==null&&Number.isFinite(baseline)){
    var tickAng=(-90+baseline/100*360)*Math.PI/180;
    var tx=cx+r*Math.cos(tickAng),ty=cy+r*Math.sin(tickAng);
    var tick=document.createElementNS("http://www.w3.org/2000/svg","line");
    tick.setAttribute("x1",String(cx));tick.setAttribute("y1",String(cy));tick.setAttribute("x2",String(tx));tick.setAttribute("y2",String(ty));
    tick.setAttribute("stroke","var(--muted-foreground)");tick.setAttribute("stroke-width","2");
    svg.appendChild(tick);
  }
  var center=$("usage-ring-center");
  if(pct===null){center.textContent="Unavailable";}
  else{
    var left=100-pct;
    center.innerHTML="Day "+(dayIndex!==null?dayIndex:"?")+" / 7<br>"+usageFmtPct(Math.max(0,left),0)+" left<br><span class=\\"dim\\">Baseline "+usageFmtPct(baseline,0)+"</span>";
  }
}
function renderLineChart(points){
  chartRenderLine($("usage-line-chart"),points,700,220,28,100);
}
function renderBarChart(rows){
  var svg=$("usage-bar-chart");
  chartRenderBars(svg,rows,700,200,28,100);
  if(!rows.length)return;
  var w=700,h=200,p=28,slot=(w-2*p)/7;
  rows.forEach(function(row,i){
    var x=p+slot*i+slot*0.1,bw=slot*0.8;
    var lab=document.createElementNS("http://www.w3.org/2000/svg","text");
    lab.setAttribute("x",String(x+bw/2));lab.setAttribute("y",String(h-8));lab.setAttribute("text-anchor","middle");lab.setAttribute("fill","var(--muted-foreground)");lab.setAttribute("font-size","10");
    lab.textContent=row.date.slice(5);svg.appendChild(lab);
  });
}
function fillTable(tbody,rows,labelKey){
  tbody.replaceChildren();
  if(!rows.length){tbody.innerHTML='<tr><td colspan=2 class=dim>No data</td></tr>';return;}
  rows.forEach(function(r){
    var tr=document.createElement("tr");
    tr.innerHTML="<td>"+esc(r[labelKey])+"</td><td>"+esc(usageFmtPct(r.share,1))+"</td>";
    tbody.appendChild(tr);
  });
}
function renderCheckins(rows){
  var box=$("usage-checkins");box.replaceChildren();
  if(!rows.length){box.innerHTML='<p class=dim>No check-in notes yet.</p>';return;}
  var byBot={};
  rows.forEach(function(r){(byBot[r.bot]=byBot[r.bot]||[]).push(r);});
  Object.keys(byBot).sort().forEach(function(bot){
    var sec=document.createElement("section");sec.style.marginBottom="1rem";
    sec.appendChild(element("h3",bot));
    var list=document.createElement("ul");list.className="todoist-list";
    byBot[bot].forEach(function(r){
      var li=document.createElement("li");li.className="todoist-item";
      li.innerHTML='<div class=dim>'+esc(r.date)+'</div><div>'+esc(r.note)+'</div>';
      list.appendChild(li);
    });
    sec.appendChild(list);box.appendChild(sec);
  });
}
function formatRunOut(ro){
  if(!ro)return null;
  if(ro.days!==null&&ro.days>=1){var d=Math.round(ro.days*10)/10;return "Runs out early, ~"+String(d).replace(/\\.0$/,"")+" d left";}
  if(ro.hours!==null)return ro.hours===0?"Runs out early, <1 h left":"Runs out early, about "+ro.hours+" h left";
  return "Runs out early";
}
function renderUsage(data){
  var c=data.computed,pct=c.weeklyPercentUsed;
  if(!data.latest||pct===null){
    $("usage-unavailable").hidden=false;$("usage-root").hidden=true;
    $("usage-unavailable").querySelector("p").innerHTML='<strong>Unavailable</strong> — no successful reading yet (null weekly percent is never shown as 0%).';
    return;
  }
  $("usage-unavailable").hidden=true;$("usage-root").hidden=false;
  if(c.cycleEnded){
    $("usage-status-pill").className="pill unknown";
    $("usage-status-pill").textContent=c.cycleEndedMessage||"Reset passed";
    renderRing(pct,null,null,null);
    $("usage-ring-center").textContent=c.cycleEndedMessage||"Reset passed, awaiting new reading";
  }else{
    var pill=$("usage-status-pill");
    var pillCls=c.status==="ahead"?"ahead":c.status==="behind"?"behind":c.status==="on_pace"?"on-pace":"unknown";
    pill.className="pill "+pillCls;
    pill.textContent=c.status==="ahead"?"▲ AHEAD OF PACE":c.status==="behind"?"▼ BEHIND PACE":c.status==="on_pace"?"▼ ON PACE":"Unavailable";
    renderRing(pct,c.baseline,c.dayIndex,c.daysLeft);
  }
  var stats=$("usage-stats");stats.replaceChildren();
  var delta=c.baseline!==null?pct-c.baseline:null;
  var vsMain=delta===null?"Unavailable":Math.abs(Math.round(delta))+"%";
  var vsSub=delta===null?"":(delta>0?"over baseline · using it fast":"under baseline · plenty left");
  stats.appendChild(statCard("vs Baseline",vsMain,vsSub));
  var remDisp=c.remainingDisplay!==null?c.remainingDisplay:null;
  var overSub=c.remainingOverCap!==null&&c.remainingOverCap>0?usageFmtPct(c.remainingOverCap,0)+" over cap":"";
  stats.appendChild(statCard("Remaining",remDisp===null?"Unavailable":usageFmtPct(remDisp,0),overSub));
  var burnSub=c.burnRatePerDay!==null&&c.burnLowConfidence?"low confidence (<6h of samples)":"";
  stats.appendChild(statCard("Avg / day",c.burnRatePerDay===null?"Unavailable":usageFmtPct(c.burnRatePerDay,1)+"/day",burnSub));
  var ro=c.runOutBeforeReset;
  if(ro&&c.projectedAtReset!==null&&c.projectedAtReset>100){
    stats.appendChild(statCard("Projected run-out",formatRunOut(ro)||"Runs out early","before weekly reset"));
  }else{
    stats.appendChild(statCard("Projected (7d)",c.projectedAtReset===null?"Unavailable":usageFmtPct(c.projectedAtReset,0),""));
  }
  if(c.resetsAt===null||c.metricsUnavailable){
    stats.appendChild(statCard("Reset in",c.resetsAt===null?"Reset unknown":"Unavailable",c.resetsAt===null?"No countdown without resetsAt":""));
    stats.appendChild(statCard("Daily budget left","Unavailable",c.resetsAt===null?"Reset unknown":""));
  }else{
    var rc=c.resetCountdown,rcText=rc?rc.days+"d "+rc.hours+"h":"—";
    stats.appendChild(statCard("Reset in",rcText,c.resetsAt));
    var bud=c.dailyBudgetOverCap?"over cap":usageFmtPct(c.dailyBudgetLeft,1)+"/day";
    stats.appendChild(statCard("Daily budget left",c.dailyBudgetLeft===null?"Unavailable":bud,c.daysLeft!==null?"over "+c.daysLeft+"d to reset (incl. today)":""));
  }
  renderLineChart(data.chart.cumulative);
  renderBarChart(data.chart.dailyIncrements);
  fillTable($("usage-bots"),data.byBot,"name");
  fillTable($("usage-routines"),data.byRoutine,"name");
  var log=$("usage-log");log.replaceChildren();
  data.dailyLog.forEach(function(row){
    var tr=document.createElement("tr");
    tr.innerHTML="<td>"+esc(row.asOf)+"</td><td>"+esc(row.weeklyPercentUsed===null?"Unavailable":usageFmtPct(row.weeklyPercentUsed,1))+"</td><td>"+esc(row.resetsAt===null?"Reset unknown":row.resetsAt)+"</td>";
    log.appendChild(tr);
  });
  renderCheckins(data.checkins);
  var footer="Target pace "+usageFmtPct(USAGE_PACE,1)+"/day · weekly cap 100%";
  if(c.lastReadingAt){footer+=" · last reading "+c.lastReadingAt+" ("+usageFormatAge(c.lastReadingAgeMs)+")";}
  if(c.readingStale){footer+=" · stale reading";}
  $("usage-footer").textContent=footer;
}
function loadUsage(){return api("/api/agents/usage").then(renderUsage);}
loadUsage().catch(function(err){$("usage-unavailable").hidden=false;$("usage-root").hidden=true;fail(err);});
`;
}
