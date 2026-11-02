/** Dashboard grid layout (native CSS grid + edit mode; zero extra deps). */

export const dashboardGridCss = `
.dashboard-page .dashboard-quick-add-bar.quick-add-bar{margin-bottom:.75rem;flex-shrink:0}
.dashboard-quick-add-bar .quick-add-wrap{max-width:none;width:100%}
.dashboard-page .voice-inbox{margin-bottom:.75rem;flex-shrink:0;max-width:none;padding:.75rem 1rem}
.dashboard-main-row{display:flex;align-items:stretch;gap:0;min-height:0;flex:1 1 auto}
.app-shell:has(.dashboard-page){height:100vh;max-height:100vh;overflow:hidden}
.page-body:has(.dashboard-page),.page-body-inner:has(.dashboard-page){
  flex:1 1 0;min-height:0;display:flex;flex-direction:column;padding:1rem 1.25rem .5rem;box-sizing:border-box;
  overflow:hidden;max-width:none;width:100%}
.dashboard-page{flex:1 1 0;min-height:0;display:flex;flex-direction:column;width:100%;max-width:none;margin:0}
.dashboard-page .page-header{margin-bottom:.75rem;flex-shrink:0}
.dashboard-page .page-header p{margin:.2rem 0 0}
.dashboard-edit-banner{margin:0 0 .5rem;font-size:.8125rem;color:var(--warning)}
.dashboard-grid{
  width:100%;flex:1 1 auto;min-height:0;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));
  grid-auto-rows:minmax(7rem,auto);gap:var(--grid-gap);align-content:start;overflow-y:auto;padding-bottom:.5rem}
.dashboard-item{
  min-width:0;display:flex;flex-direction:column;position:relative;
  grid-column:var(--gc-start)/span var(--gc-span);grid-row:var(--gr-start)/span var(--gr-span)}
.dashboard-item.is-dragging{opacity:.92;z-index:30;box-shadow:0 8px 24px rgba(0,0,0,.12)}
.dashboard-item>.card{flex:1;min-height:0;display:flex;flex-direction:column;margin:0;padding:0;overflow:hidden}
.dashboard-widget-chrome{
  display:flex;align-items:center;gap:.35rem;padding:0 var(--card-pad);min-height:2.75rem;border-bottom:1px solid var(--border);
  flex-shrink:0;background:var(--card)}
.dashboard-widget-chrome h2{margin:0;font-size:.875rem;font-weight:600;flex:1;min-width:0}
.dashboard-status-dot{width:.5rem;height:.5rem;border-radius:999px;flex:none;background:var(--muted-foreground)}
.dashboard-status-dot--green{background:var(--ok,#22c55e)}
.dashboard-status-dot--blue{background:var(--primary)}
.dashboard-status-dot--orange{background:var(--warning)}
.dashboard-status-dot--red{background:var(--destructive)}
.dashboard-status-dot--muted{background:var(--muted-foreground)}
.dashboard-category-tag{font-size:.625rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground);
  border:1px solid var(--border);border-radius:999px;padding:.05rem .45rem;white-space:nowrap}
.dashboard-card-menu{position:relative;margin-left:.15rem}
.dashboard-card-menu>summary{list-style:none;cursor:pointer;color:var(--muted-foreground);padding:.2rem .35rem}
.dashboard-card-menu>summary::-webkit-details-marker{display:none}
.dashboard-card-menu-panel{position:absolute;right:0;top:calc(100% + .25rem);min-width:8rem;padding:.35rem;display:flex;flex-direction:column;gap:.25rem;
  background:var(--card);border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);z-index:20;box-shadow:0 8px 24px rgba(0,0,0,.12)}
.dashboard-edit-only{display:none!important}
.dashboard-page.is-editing .dashboard-edit-only{display:inline-flex!important}
.dashboard-page.is-editing .dashboard-view-only{display:none!important}
.dashboard-page.is-editing .dashboard-item>.card{outline:1px dashed var(--warning);outline-offset:-1px}
.dashboard-drag-handle{cursor:grab;touch-action:none;border:0;background:transparent;color:var(--muted-foreground);
  padding:.2rem .35rem;border-radius:calc(var(--radius) - 4px);font-size:.75rem;line-height:1}
.dashboard-drag-handle:active{cursor:grabbing}
.dashboard-size-toggle{display:inline-flex;border:1px solid var(--border);border-radius:calc(var(--radius) - 4px);overflow:hidden;margin-left:auto}
.dashboard-size-btn{border:0;background:transparent;font-size:.625rem;padding:.15rem .35rem;color:var(--muted-foreground);cursor:pointer;min-height:auto}
.dashboard-size-btn.is-active{background:var(--primary);color:var(--primary-foreground);font-weight:600}
.dashboard-remove{border:0;background:var(--muted);color:var(--muted-foreground);width:1.35rem;height:1.35rem;border-radius:calc(var(--radius) - 4px);cursor:pointer;margin-left:.25rem}
.dashboard-panel-body{flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;padding:var(--card-pad);display:flex;flex-direction:column;gap:.35rem}
.dashboard-panel-body .panel-scroll-region{flex:0 0 auto;min-height:0;overflow:visible}
.dashboard-panel-body>.row:first-child{display:none}
.dashboard-panel-body>h2:first-child{display:none}
.dashboard-panel-body section.card{border:0;padding:0;background:transparent;box-shadow:none}
.dashboard-widget-drawer{width:17rem;flex:none;border-left:1px solid var(--border);padding:1rem;background:var(--card);overflow-y:auto}
.dashboard-page.is-editing .dashboard-widget-drawer{display:block!important}
.dashboard-drawer-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.35rem}
.dashboard-drawer-head h2{margin:0;font-size:.9375rem}
.dashboard-drawer-list{display:flex;flex-direction:column;gap:.5rem;margin-top:.75rem}
.dashboard-drawer-item{display:flex;align-items:center;gap:.5rem;width:100%;text-align:left;border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);
  padding:.55rem .65rem;background:var(--background);cursor:pointer;color:inherit;font:inherit}
.dashboard-drawer-item:hover{border-color:var(--ring)}
.dashboard-drawer-icon{width:1.5rem;height:1.5rem;border-radius:calc(var(--radius) - 4px);background:var(--muted);display:flex;align-items:center;justify-content:center;color:var(--warning)}
#panel-notes #notes-editor{min-height:3rem;flex:1;max-height:100%;resize:none;font-size:.8125rem}
#panel-notes .dim{font-size:.75rem;margin:0}
@media(max-width:640px){
  .app-shell:has(.dashboard-page){height:auto;max-height:none;overflow:visible}
  .page-body:has(.dashboard-page),.page-body-inner:has(.dashboard-page){overflow:visible;flex:none;min-height:auto}
  .dashboard-page{flex:none;min-height:auto}
  .dashboard-main-row{flex-direction:column}
  .dashboard-grid{grid-template-columns:1fr;grid-auto-rows:auto;height:auto!important;overflow:visible}
  .dashboard-item{grid-column:1/-1!important;grid-row:auto!important;height:auto!important;overflow:visible}
  .dashboard-widget-drawer{width:100%;border-left:0;border-top:1px solid var(--border)}
  .dashboard-drag-handle,.dashboard-size-toggle{display:none!important}
}
`;

export function dashboardGridScript(): string {
  return `
(function(){
  var grid=document.getElementById("dashboard-grid");
  if(!grid)return;
  var page=document.querySelector(".dashboard-page");
  var LAYOUT_VERSION=3,saveTimer=null;
  function isStacked(){return window.matchMedia("(max-width: 640px)").matches}
  function readLayout(){
    var widgets=[];
    grid.querySelectorAll(".dashboard-item").forEach(function(el){
      var id=el.getAttribute("data-widget-id")||el.getAttribute("data-panel-id");
      if(!id)return;
      widgets.push({id:id,size:el.getAttribute("data-size")||"W"});
    });
    return {version:LAYOUT_VERSION,widgets:widgets};
  }
  function scheduleSave(){
    if(saveTimer)clearTimeout(saveTimer);
    saveTimer=setTimeout(function(){
      api("/api/dashboard-layout","PUT",readLayout()).then(function(r){
        if(r.layout)applyLayout(r.layout);
      }).catch(function(){});
    },400);
  }
  function applyPanel(entry){
    var el=grid.querySelector('[data-widget-id="'+entry.id+'"]');
    if(!el)return;
    el.setAttribute("data-size",entry.size||"W");
    el.style.setProperty("--gc-start",(entry.x+1));
    el.style.setProperty("--gc-span",entry.w);
    el.style.setProperty("--gr-start",(entry.y+1));
    el.style.setProperty("--gr-span",entry.h);
    el.querySelectorAll(".dashboard-size-btn").forEach(function(btn){
      btn.classList.toggle("is-active",btn.getAttribute("data-size")===entry.size);
    });
  }
  function applyLayout(layout){
    (layout.panels||[]).forEach(applyPanel);
    if(layout.widgets){
      layout.widgets.forEach(function(w){
        var el=grid.querySelector('[data-widget-id="'+w.id+'"]');
        if(el)grid.appendChild(el);
      });
    }
  }
  window.applyDashboardLayout=applyLayout;
  function bindItem(item){
    item.querySelectorAll(".dashboard-size-btn,.dashboard-menu-resize").forEach(function(btn){
      btn.addEventListener("click",function(){
        var size=btn.getAttribute("data-size");if(!size)return;
        item.setAttribute("data-size",size);
        item.querySelectorAll(".dashboard-size-btn").forEach(function(b){b.classList.toggle("is-active",b.getAttribute("data-size")===size);});
        scheduleSave();
      });
    });
    item.querySelector(".dashboard-remove")?.addEventListener("click",function(){
      var wid=item.getAttribute("data-widget-id")||item.getAttribute("data-panel-id");
      item.remove();
      if(wid){
        var addBtn=document.querySelector('[data-add-widget="'+wid+'"]');
        if(addBtn)addBtn.hidden=false;
      }
      scheduleSave();
    });
    var handle=item.querySelector(".dashboard-drag-handle");
    if(!handle)return;
    handle.addEventListener("keydown",function(ev){
      if(ev.key!=="ArrowUp"&&ev.key!=="ArrowDown")return;
      ev.preventDefault();
      var sibling=ev.key==="ArrowUp"?item.previousElementSibling:item.nextElementSibling;
      if(!sibling||!sibling.classList.contains("dashboard-item"))return;
      if(ev.key==="ArrowUp")grid.insertBefore(item,sibling);else grid.insertBefore(sibling,item);
      scheduleSave();
    });
    handle.addEventListener("pointerdown",function(ev){
      if(ev.button!==0||isStacked())return;
      ev.preventDefault();
      item.classList.add("is-dragging");
      handle.setPointerCapture(ev.pointerId);
      function move(e){
        var target=document.elementFromPoint(e.clientX,e.clientY);
        var over=target&&target.closest(".dashboard-item");
        if(!over||over===item)return;
        var rect=over.getBoundingClientRect();
        if(e.clientY<rect.top+rect.height/2)grid.insertBefore(item,over);else grid.insertBefore(item,over.nextElementSibling);
      }
      function up(){
        item.classList.remove("is-dragging");
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener("pointermove",move);
        handle.removeEventListener("pointerup",up);
        scheduleSave();
      }
      handle.addEventListener("pointermove",move);
      handle.addEventListener("pointerup",up);
    });
  }
  grid.querySelectorAll(".dashboard-item").forEach(bindItem);
  function setEditing(on){
    page&&page.classList.toggle("is-editing",on);
    var drawer=document.getElementById("dashboard-widget-drawer");
    if(drawer)drawer.hidden=!on;
    var banner=document.querySelector(".dashboard-edit-banner");
    if(banner)banner.hidden=!on;
    var toggle=document.getElementById("dashboard-edit-toggle");
    if(toggle){toggle.setAttribute("aria-pressed",on?"true":"false");toggle.textContent=on?"Done editing":"Edit layout";}
  }
  document.getElementById("dashboard-edit-toggle")?.addEventListener("click",function(){
    setEditing(!(page&&page.classList.contains("is-editing")));
  });
  if(location.hash==="#edit"||new URLSearchParams(location.search).get("edit")==="1")setEditing(true);
  document.getElementById("dashboard-drawer-close")?.addEventListener("click",function(){setEditing(false);});
  document.querySelectorAll("[data-add-widget]").forEach(function(btn){
    btn.addEventListener("click",function(){
      var id=btn.getAttribute("data-add-widget");if(!id)return;
      var size=btn.getAttribute("data-default-size")||"W";
      var layout=readLayout();
      layout.widgets.push({id:id,size:size});
      btn.hidden=true;
      api("/api/dashboard-layout","PUT",layout).then(function(){location.reload();});
    });
  });
  api("/api/dashboard-layout").then(function(r){if(r.layout)applyLayout(r.layout);}).catch(function(){});
  var reset=document.getElementById("dashboard-reset-layout");
  if(reset)reset.addEventListener("click",function(){
    reset.disabled=true;
    api("/api/dashboard-layout/reset","POST",{}).then(function(){location.reload();}).finally(function(){reset.disabled=false;});
  });
})();
`;
}
