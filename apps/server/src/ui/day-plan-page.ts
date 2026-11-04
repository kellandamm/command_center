import type { NavLink } from "./layout";
import { page } from "./layout";

const dayPlanCss = `
.day-plan-header{display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-end;justify-content:space-between;margin-bottom:1.25rem}
.day-plan-day-row{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center}
.day-plan-capacity.card{padding:1rem 1.1rem;margin-bottom:1rem}
.day-plan-capacity-track{height:.55rem;background:var(--muted);border-radius:999px;overflow:hidden;margin:.65rem 0 .35rem}
.day-plan-capacity-fill{height:100%;background:var(--primary);border-radius:999px;transition:width .2s}
.day-plan-capacity-fill.over{background:var(--warning)}
.day-plan-capacity-meta{display:flex;flex-wrap:wrap;gap:1rem;font-size:.8125rem;color:var(--dim)}
.day-plan-over{color:var(--warning);font-weight:600}
.day-plan-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:1rem;align-items:start}
@media(max-width:900px){.day-plan-grid{grid-template-columns:1fr}}
.day-plan-panel.card{padding:1rem}
.day-plan-panel h2{font-size:1rem;margin:0 0 .75rem}
.day-plan-timeline{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.45rem}
.day-plan-timeline li{display:grid;grid-template-columns:4.5rem minmax(0,1fr);gap:.65rem;padding:.35rem 0;border-bottom:1px solid var(--border)}
.day-plan-timeline li:last-child{border-bottom:0}
.day-plan-time{font-size:.75rem;color:var(--dim);font-variant-numeric:tabular-nums}
.day-plan-kind{font-size:.6875rem;text-transform:uppercase;letter-spacing:.04em;color:var(--dim)}
.day-plan-must-dos{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.5rem}
.day-plan-must-dos li{display:flex;gap:.55rem;align-items:flex-start;padding:.45rem .5rem;border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);background:var(--card)}
.day-plan-must-dos label{display:flex;gap:.55rem;align-items:flex-start;cursor:pointer;flex:1}
.day-plan-must-dos input{margin-top:.15rem}
.day-plan-must-dos .done{text-decoration:line-through;color:var(--dim)}
.day-plan-banner{margin:.75rem 0;padding:.65rem .85rem;border-radius:var(--radius);border:1px solid color-mix(in srgb,var(--warning) 45%,var(--border));background:color-mix(in srgb,var(--warning) 12%,var(--card));color:var(--foreground)}
.day-plan-toast{position:fixed;right:1rem;bottom:1rem;z-index:40;max-width:min(420px,calc(100vw - 2rem));padding:.75rem 1rem;border-radius:var(--radius);border:1px solid var(--border);background:var(--card);box-shadow:0 8px 30px rgb(0 0 0 / .18);display:flex;gap:.75rem;align-items:center}
.day-plan-toast[hidden]{display:none!important}
.day-plan-sources{font-size:.8125rem;color:var(--dim);margin-top:.35rem}
`;

export function dayPlanPage(nav?: NavLink[], opts?: { owner: boolean }): string {
  if (!opts?.owner) {
    return page({
      title: "Day plan — Stremmy",
      active: "/day-plan",
      nav,
      body: `<header class="page-header"><h1>Day plan</h1><p class="dim">Sign in through Cloudflare Access as a configured owner to view your day plan.</p></header>`,
    });
  }

  return page({
    title: "Day plan — Stremmy",
    active: "/day-plan",
    nav,
    extraCss: dayPlanCss,
    body: `<header class="page-header day-plan-header">
  <div><h1>Day plan</h1><p class="dim">Timeline, must-dos, and capacity for the workspace day.</p></div>
  <div class="day-plan-day-row">
    <label>Day <input type="date" id="dp-day" aria-label="Plan day"/></label>
    <button type="button" class="ghost" id="dp-refresh">Refresh plan</button>
  </div>
</header>
<div id="dp-banner" class="day-plan-banner" role="alert" hidden></div>
<div id="dp-sync-conflict" class="day-plan-banner" role="alert" hidden>
  <p id="dp-sync-conflict-text"></p>
  <button type="button" class="ghost" id="dp-sync-conflict-reopen">Reopen linked task</button>
</div>
<section class="day-plan-capacity card" aria-label="Capacity">
  <div class="row" style="justify-content:space-between;align-items:center">
    <strong id="dp-cap-title">Capacity</strong>
    <span id="dp-cap-over" class="day-plan-over" hidden></span>
  </div>
  <div class="day-plan-capacity-track" aria-hidden="true"><div class="day-plan-capacity-fill" id="dp-cap-fill" style="width:0"></div></div>
  <div class="day-plan-capacity-meta" id="dp-cap-meta"></div>
  <p class="day-plan-sources" id="dp-sources" hidden></p>
</section>
<div class="day-plan-grid">
  <section class="day-plan-panel card" aria-labelledby="dp-timeline-title">
    <h2 id="dp-timeline-title">Timeline</h2>
    <ol class="day-plan-timeline" id="dp-timeline"></ol>
  </section>
  <section class="day-plan-panel card" aria-labelledby="dp-must-title">
    <h2 id="dp-must-title">Must-dos</h2>
    <ul class="day-plan-must-dos" id="dp-must-dos"></ul>
  </section>
</div>
<div id="dp-toast" class="day-plan-toast" role="status" hidden>
  <span id="dp-toast-text"></span>
  <button type="button" class="ghost" id="dp-toast-undo">Undo</button>
  <button type="button" class="ghost" id="dp-toast-dismiss" aria-label="Dismiss">×</button>
</div>`,
    script: dayPlanScript(),
  });
}

function dayPlanScript(): string {
  return `
var dpState={day:"",plan:null,undo:null,toastTimer:null,busy:false,syncConflictSlot:null};
function dpApi(path,method,body){
  return fetch(path,{method:method||"GET",headers:{"x-ah":"1","x-day-plan-ui":"1","content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)})
    .then(function(r){return r.json().catch(function(){return{}}).then(function(j){
      if(!r.ok){
        var err=new Error(j.error||("HTTP "+r.status));
        if(j.mustDoSyncConflict)err.mustDoSyncConflict=true;
        throw err;
      }
      return j;
    });});
}
function showBanner(text){var el=document.getElementById("dp-banner");el.textContent=text;el.hidden=!text;hideSyncConflict();}
function hideSyncConflict(){var box=document.getElementById("dp-sync-conflict");box.hidden=true;dpState.syncConflictSlot=null;}
function showSyncConflict(message,slot){
  hideToast();
  dpState.syncConflictSlot=slot;
  document.getElementById("dp-sync-conflict-text").textContent=message;
  document.getElementById("dp-sync-conflict").hidden=false;
}
function hideToast(){var t=document.getElementById("dp-toast");t.hidden=true;if(dpState.toastTimer){clearTimeout(dpState.toastTimer);dpState.toastTimer=null;}}
function showToast(text,undo){
  hideToast();dpState.undo=undo||null;
  document.getElementById("dp-toast-text").textContent=text;
  document.getElementById("dp-toast-undo").hidden=!undo;
  document.getElementById("dp-toast").hidden=false;
  dpState.toastTimer=setTimeout(hideToast,8000);
}
function fmtTime(iso){
  if(!iso)return "—";
  return new Date(iso).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
}
function renderCapacity(plan){
  var cap=plan.capacity||{};
  var avail=cap.availableMinutes||0;
  var used=(cap.meetingMinutes||0)+(cap.blockedTaskMinutes||0)+(cap.unscheduledTaskMinutes||0);
  var pct=avail>0?Math.min(100,Math.round((used/avail)*100)):0;
  var fill=document.getElementById("dp-cap-fill");
  fill.style.width=(avail?pct:0)+"%";
  fill.classList.toggle("over",!!cap.overByMinutes);
  document.getElementById("dp-cap-title").textContent=avail?"Capacity · "+plan.workStart+"–"+plan.workEnd:"Zero-hour day";
  var over=document.getElementById("dp-cap-over");
  if(cap.overByMinutes){over.hidden=false;over.textContent="Over capacity by "+cap.overByMinutes+" min";}
  else over.hidden=true;
  document.getElementById("dp-cap-meta").innerHTML=[
    ["Available",avail+" min"],
    ["Meetings",String(cap.meetingMinutes||0)+" min"],
    ["Blocked tasks",String(cap.blockedTaskMinutes||0)+" min"],
    ["Unscheduled tasks",String(cap.unscheduledTaskMinutes||0)+" min"],
  ].map(function(row){return "<span><strong>"+esc(row[0])+":</strong> "+esc(row[1])+"</span>";}).join("");
  var src=plan.sources||{},flags=[];
  if(src.calendarUnavailable)flags.push("Calendar unavailable");
  if(src.todoistUnavailable)flags.push("Todoist unavailable");
  var srcEl=document.getElementById("dp-sources");
  if(flags.length){srcEl.textContent=flags.join(" · ");srcEl.hidden=false;}else srcEl.hidden=true;
}
function renderTimeline(plan){
  var list=document.getElementById("dp-timeline");
  var items=(plan.items||[]).slice().sort(function(a,b){return (a.sortOrder||0)-(b.sortOrder||0);});
  if(!items.length){list.innerHTML='<li><span class="day-plan-time">—</span><span class="dim">Nothing scheduled on the timeline.</span></li>';return;}
  list.innerHTML=items.map(function(item){
    var when=item.startIso?fmtTime(item.startIso)+(item.endIso?" – "+fmtTime(item.endIso):""):"All day";
    return '<li><span class="day-plan-time">'+esc(when)+'</span><span><span class="day-plan-kind">'+esc(item.kind)+'</span><br><strong>'+esc(item.title)+'</strong></span></li>';
  }).join("");
}
function renderMustDos(plan){
  var root=document.getElementById("dp-must-dos");
  var rows=plan.mustDos||[];
  if(!rows.length){root.innerHTML='<li class="dim">No must-dos for this day.</li>';return;}
  root.innerHTML=rows.map(function(m){
    var done=!!m.completedAt;
    return '<li><label><input type="checkbox" data-slot="'+m.slot+'"'+(done?" checked disabled":"")+'/><span class="'+(done?"done":"")+'">'+esc(m.title)+'</span></label></li>';
  }).join("");
  root.querySelectorAll("input[type=checkbox]").forEach(function(box){
    box.onchange=function(){if(box.checked)completeMustDo(Number(box.dataset.slot));};
  });
}
function applyPlan(payload){
  dpState.plan=payload.plan;dpState.day=payload.day;
  showBanner("");
  renderCapacity(payload.plan);
  renderTimeline(payload.plan);
  renderMustDos(payload.plan);
}
function loadPlan(day){
  showBanner("");
  return dpApi("/api/day-plan?day="+encodeURIComponent(day)).then(applyPlan).catch(function(err){showBanner(err.message||"Could not load day plan.");});
}
function completeMustDo(slot){
  if(dpState.busy)return;
  dpState.busy=true;
  showBanner("");
  dpApi("/api/day-plan/must-do/complete","POST",{day:dpState.day,slot:slot}).then(function(r){
    applyPlan(r);
    showToast("Must-do completed.",{slot:slot});
  }).catch(function(err){
    if(err.mustDoSyncConflict){showSyncConflict(err.message||"Task may already be completed in Todoist or Board.",slot);}
    else showBanner(err.message||"Could not complete must-do.");
    loadPlan(dpState.day);
  }).finally(function(){dpState.busy=false;});
}
function reopenMustDo(slot){
  if(dpState.busy)return;
  dpState.busy=true;
  showBanner("");
  dpApi("/api/day-plan/must-do/reopen","POST",{day:dpState.day,slot:slot}).then(function(r){
    applyPlan(r);
    showToast("Must-do reopened.");
  }).catch(function(err){showBanner(err.message||"Could not undo completion.");})
  .finally(function(){dpState.busy=false;});
}
document.getElementById("dp-sync-conflict-reopen").onclick=function(){
  if(dpState.syncConflictSlot==null)return;
  reopenMustDo(dpState.syncConflictSlot);
};
document.getElementById("dp-toast-undo").onclick=function(){
  if(!dpState.undo)return;
  var slot=dpState.undo.slot;
  hideToast();
  reopenMustDo(slot);
};
document.getElementById("dp-toast-dismiss").onclick=hideToast;
document.getElementById("dp-refresh").onclick=function(){
  var day=document.getElementById("dp-day").value||dpState.day;
  loadPlan(day);
};
document.getElementById("dp-day").onchange=function(){
  if(this.value)loadPlan(this.value);
};
(function init(){
  dpApi("/api/day-plan").then(function(r){
    document.getElementById("dp-day").value=r.day;
    applyPlan(r);
  }).catch(function(err){showBanner(err.message||"Could not load day plan.");});
})();
`;
}
