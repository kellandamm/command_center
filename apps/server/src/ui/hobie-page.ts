import type { NavLink } from "./layout";
import { page } from "./layout";

export function hobiePage(nav?: NavLink[]): string {
  return page({
    title: "Hobie queue — Command center",
    active: "/hobie",
    nav,
    body: `<header class="page-header"><h1>Hobie queue</h1><p class="dim">Tasks from MCP agents — mark done or remove when finished.</p></header>
<div class="card"><div class="row" style="margin-bottom:.75rem">
  <button type="button" class="ghost" id="hobie-refresh">Refresh</button>
  <button type="button" class="ghost" id="hobie-clear-done">Clear done</button>
  <button type="button" class="ghost bad" id="hobie-clear-all">Clear all</button>
</div>
<ul id="hobie-full-list" class="todoist-list"></ul></div>`,
    script: `
function renderHobieFull(rows){
  var el=document.getElementById("hobie-full-list");
  if(!rows||!rows.length){el.innerHTML='<li class="dim">Queue empty.</li>';return;}
  el.innerHTML=rows.map(function(t){
    var tag=t.urgent?'<span class="bad">urgent</span> ':'';
    var actions='<div class="row" style="margin-top:.35rem;gap:.35rem">';
    if(t.status!=="done")actions+='<button type="button" class="ghost hobie-done" data-id="'+esc(t.id)+'">Mark done</button>';
    actions+='<button type="button" class="ghost hobie-del" data-id="'+esc(t.id)+'">Delete</button></div>';
    return '<li class="todoist-item">'+tag+'<strong>'+esc(t.title)+'</strong> <span class="dim">'+esc(t.status)+'</span>'
      +'<div class="dim">'+esc(t.clientId)+' · '+esc(t.createdAt)+'</div><div>'+esc(t.body)+'</div>'+actions+'</li>';
  }).join("");
  el.querySelectorAll(".hobie-done").forEach(function(b){b.onclick=function(){
    api("/api/hobie/queue/"+encodeURIComponent(b.dataset.id)+"/done","POST",{}).then(loadHobieFull);
  }});
  el.querySelectorAll(".hobie-del").forEach(function(b){b.onclick=function(){
    if(!confirm("Delete this task permanently?"))return;
    api("/api/hobie/queue/"+encodeURIComponent(b.dataset.id),"DELETE").then(loadHobieFull);
  }});
}
function loadHobieFull(){return api("/api/hobie/queue").then(function(r){renderHobieFull(r.tasks)})}
document.getElementById("hobie-refresh").onclick=loadHobieFull;
document.getElementById("hobie-clear-done").onclick=function(){
  if(!confirm("Remove all done tasks from the queue?"))return;
  api("/api/hobie/queue/clear","POST",{onlyDone:true}).then(loadHobieFull);
};
document.getElementById("hobie-clear-all").onclick=function(){
  if(!confirm("Clear the entire Hobie queue? This cannot be undone."))return;
  api("/api/hobie/queue/clear","POST",{}).then(loadHobieFull);
};
loadHobieFull();
`,
  });
}
