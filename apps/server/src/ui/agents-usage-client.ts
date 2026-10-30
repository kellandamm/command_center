/** Shared client helpers for Agents usage (full page + dashboard panel). Pace math stays server-side. */

export const AGENTS_USAGE_CLIENT_HELPERS = `
var USAGE_PACE=${100 / 7};
function usageFmtPct(v,digits){
  if(v===null||v===undefined||!Number.isFinite(v))return "Unavailable";
  var n=digits===0?Math.round(v):Math.round(v*10)/10;
  var s=digits===0?String(n):n.toFixed(1).replace(/\\.0$/,"");
  return s+"%";
}
function usageFormatAge(ms){
  if(ms===null||ms===undefined)return "";
  var h=Math.floor(ms/3600000);
  if(h>=48)return Math.floor(h/24)+"d ago";
  if(h>=1)return h+"h ago";
  return "<1h ago";
}
function usagePacePillClass(status){
  if(status==="ahead")return "ahead";
  if(status==="behind")return "behind";
  if(status==="on_pace")return "on-pace";
  return "unknown";
}
function usagePacePillLabel(status){
  if(status==="ahead")return "▲ Ahead";
  if(status==="behind")return "▼ Behind";
  if(status==="on_pace")return "On pace";
  return "Unavailable";
}
function usageRenderBar(root,pct,baseline,dimmed){
  if(!root)return;
  root.replaceChildren();
  root.classList.toggle("is-dimmed",!!dimmed);
  var track=document.createElement("div");track.className="agents-usage-bar-track";
  var fill=document.createElement("div");fill.className="agents-usage-bar-fill";
  if(pct!==null&&Number.isFinite(pct)&&!dimmed){
    fill.style.width=Math.min(100,pct)+"%";
    fill.classList.toggle("over",baseline!==null&&pct>baseline);
  }else if(pct!==null&&Number.isFinite(pct)&&dimmed){
    fill.style.width=Math.min(100,pct)+"%";
    fill.classList.add("dimmed");
  }
  track.appendChild(fill);
  if(baseline!==null&&Number.isFinite(baseline)&&!dimmed){
    var mark=document.createElement("span");mark.className="agents-usage-bar-baseline";
    mark.style.left=Math.min(100,baseline)+"%";
    track.appendChild(mark);
  }
  root.appendChild(track);
}
`;

export const agentsUsagePanelCss = `
.agents-usage-panel{display:flex;flex-direction:column;gap:.5rem;font-size:.8125rem}
.agents-usage-stale-banner{font-size:.75rem;font-weight:600;color:var(--warning);margin:0}
.agents-usage-panel.is-dimmed .agents-usage-metrics{opacity:.45}
.agents-usage-panel-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap}
.agents-usage-panel-pct{font-size:1.1rem;font-weight:600;margin:0}
.agents-usage-panel-pct.unavailable{color:var(--muted-foreground);font-size:.875rem;font-weight:500}
.agents-usage-bar-track{position:relative;height:.55rem;border-radius:999px;background:var(--muted);overflow:visible}
.agents-usage-bar-fill{height:100%;border-radius:999px;background:var(--primary);max-width:100%;transition:width .2s}
.agents-usage-bar-fill.over{background:var(--warning)}
.agents-usage-bar-fill.dimmed{background:var(--muted-foreground);opacity:.5}
.agents-usage-bar-baseline{position:absolute;top:-2px;bottom:-2px;width:2px;margin-left:-1px;background:var(--muted-foreground);pointer-events:none}
.agents-usage-reset{margin:0;font-size:.75rem;color:var(--muted-foreground)}
.agents-usage-bots{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.25rem}
.agents-usage-bots li{display:flex;justify-content:space-between;gap:.5rem}
.agents-usage-panel-foot{margin-top:.15rem}
.agents-usage-panel-foot a{font-size:.75rem;font-weight:500;color:var(--primary)}
.agents-usage-cycle-msg{margin:0;font-size:.8125rem;color:var(--muted-foreground)}
.agents-usage-panel .pill{display:inline-flex;align-items:center;gap:.35rem;padding:.15rem .45rem;border-radius:999px;font-size:.6875rem;font-weight:600}
.agents-usage-panel .pill.on-pace{background:color-mix(in srgb,var(--primary) 18%,transparent);color:var(--primary)}
.agents-usage-panel .pill.ahead{background:color-mix(in srgb,var(--warning) 22%,transparent);color:var(--warning)}
.agents-usage-panel .pill.behind{background:color-mix(in srgb,var(--primary) 18%,transparent);color:var(--primary)}
.agents-usage-panel .pill.unknown{background:var(--muted);color:var(--muted-foreground)}
`;

export function agentsUsagePanelDashboardScript(): string {
  return `
${AGENTS_USAGE_CLIENT_HELPERS}
function renderAgentsUsagePanel(data){
  var root=document.getElementById("panel-agents-usage");
  if(!root)return;
  var wrap=root.querySelector(".agents-usage-panel");
  if(!wrap)return;
  var c=data.computed||{};
  var pct=c.weeklyPercentUsed;
  var staleEl=wrap.querySelector(".agents-usage-stale-banner");
  var cycleEl=wrap.querySelector(".agents-usage-cycle-msg");
  var metricsEl=wrap.querySelector(".agents-usage-metrics");
  var pctEl=wrap.querySelector(".agents-usage-panel-pct");
  var resetEl=wrap.querySelector(".agents-usage-reset");
  var barEl=wrap.querySelector(".agents-usage-panel-bar");
  var botsEl=wrap.querySelector(".agents-usage-bots");
  var pillEl=wrap.querySelector(".agents-usage-pace-pill");
  if(staleEl)staleEl.hidden=true;
  if(cycleEl){cycleEl.hidden=true;cycleEl.textContent="";}
  wrap.classList.remove("is-dimmed");
  if(!data.latest){
    if(pctEl){pctEl.textContent="Unavailable";pctEl.classList.add("unavailable");}
    if(resetEl)resetEl.textContent="Reset unknown";
    if(barEl)usageRenderBar(barEl,null,null,false);
    if(botsEl)botsEl.replaceChildren();
    if(pillEl){pillEl.className="pill unknown";pillEl.textContent="Unavailable";}
    if(metricsEl)metricsEl.hidden=false;
    return;
  }
  if(c.cycleEnded){
    if(cycleEl){cycleEl.hidden=false;cycleEl.textContent=c.cycleEndedMessage||"Reset passed, awaiting new reading";}
    if(pctEl){pctEl.textContent=c.cycleEndedMessage||"Cycle ended";pctEl.classList.add("unavailable");}
    if(resetEl)resetEl.textContent=c.resetsAt?("Last reset "+c.resetsAt):"Reset unknown";
    if(barEl)usageRenderBar(barEl,pct,null,true);
    if(pillEl){pillEl.className="pill unknown";pillEl.textContent=c.cycleEndedMessage||"Cycle ended";}
    if(botsEl)botsEl.replaceChildren();
    wrap.classList.add("is-dimmed");
    return;
  }
  if(pct===null||c.metricsUnavailable){
    if(pctEl){pctEl.textContent="Unavailable";pctEl.classList.add("unavailable");}
    if(resetEl)resetEl.textContent=c.resetsAt===null?"Reset unknown":(c.resetsAt||"Reset unknown");
    if(barEl)usageRenderBar(barEl,null,c.baseline,false);
    if(pillEl){pillEl.className="pill unknown";pillEl.textContent="Unavailable";}
    if(botsEl)botsEl.replaceChildren();
    return;
  }
  if(pctEl){pctEl.textContent=usageFmtPct(pct,0)+" used";pctEl.classList.remove("unavailable");}
  if(c.readingStale&&staleEl){
    staleEl.hidden=false;
    staleEl.textContent="Stale · last reading "+usageFormatAge(c.lastReadingAgeMs);
    wrap.classList.add("is-dimmed");
  }
  if(pillEl){
    pillEl.className="pill "+usagePacePillClass(c.status);
    pillEl.textContent=usagePacePillLabel(c.status);
  }
  usageRenderBar(barEl,pct,c.baseline,c.readingStale);
  if(resetEl){
    if(c.resetsAt===null)resetEl.textContent="Reset unknown";
    else{
      var rc=c.resetCountdown;
      var rcText=rc?(rc.days+"d "+rc.hours+"h"):"—";
      resetEl.textContent="Resets in "+rcText+" · "+c.resetsAt;
    }
  }
  if(botsEl){
    botsEl.replaceChildren();
    var bots=(data.byBot||[]).slice().sort(function(a,b){return b.share-a.share}).slice(0,3);
    if(!bots.length){
      var li=document.createElement("li");li.className="dim";li.textContent="No bot breakdown";botsEl.appendChild(li);
    }else bots.forEach(function(b){
      var li=document.createElement("li");
      li.innerHTML="<span>"+esc(b.name)+"</span><span class=dim>"+esc(usageFmtPct(b.share,1))+"</span>";
      botsEl.appendChild(li);
    });
  }
}
function loadAgentsUsagePanel(){
  return api("/api/agents/usage").then(renderAgentsUsagePanel).catch(function(){
    renderAgentsUsagePanel({latest:null,computed:{},byBot:[]});
  });
}
loadAgentsUsagePanel();
setInterval(loadAgentsUsagePanel,120000);
`;
}
