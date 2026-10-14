/** Dashboard grid layout (native CSS grid + pointer drag/resize; zero extra deps). */

export const dashboardGridCss = `
.dashboard-toolbar{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;margin-bottom:1rem}
.dashboard-toolbar .dim{margin:0}
.app-main:has(.dashboard-page){overflow:hidden;max-height:100vh}
.page-content:has(.dashboard-page){max-height:100vh;overflow:hidden;padding-bottom:.75rem;box-sizing:border-box}
.dashboard-page{overflow:hidden;max-height:100%}
.dashboard-page .page-header{margin-bottom:.75rem}
.dashboard-page .page-header p{margin:.2rem 0 0}
.dashboard-page .dashboard-toolbar{margin-bottom:.5rem}
.dashboard-grid{
  display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:var(--dash-gap,6px);
  grid-auto-rows:var(--dash-row,32px);position:relative;touch-action:none;
  max-height:calc(100vh - 10.5rem);overflow:hidden}
.dashboard-item{
  min-width:0;min-height:0;max-height:100%;overflow:hidden;display:flex;flex-direction:column;position:relative;
  grid-column:var(--gc-start)/span var(--gc-span);grid-row:var(--gr-start)/span var(--gr-span)}
.dashboard-item.is-dragging{opacity:.92;z-index:30;box-shadow:0 8px 24px rgba(0,0,0,.12)}
.dashboard-item.is-collapsed .dashboard-panel-body{display:none}
.dashboard-item>.card{
  flex:1;min-height:0;display:flex;flex-direction:column;margin:0;padding:0;overflow:hidden}
.dashboard-panel-chrome{
  display:flex;align-items:center;gap:.35rem;padding:.5rem .75rem;border-bottom:1px solid var(--border);
  flex-shrink:0;background:var(--card)}
.dashboard-panel-chrome h2{margin:0;font-size:.875rem;font-weight:600;flex:1;min-width:0}
.dashboard-drag-handle{
  cursor:grab;touch-action:none;border:0;background:transparent;color:var(--muted-foreground);
  padding:.25rem .35rem;border-radius:calc(var(--radius) - 4px);font-size:.75rem;line-height:1;min-height:auto}
.dashboard-drag-handle:active{cursor:grabbing}
.dashboard-drag-handle:focus-visible,.dashboard-collapse:focus-visible,.dashboard-resize:focus-visible{
  outline:2px solid var(--ring);outline-offset:1px}
.dashboard-collapse{
  border:0;background:transparent;color:var(--muted-foreground);min-width:2rem;min-height:2rem;
  padding:.25rem;border-radius:calc(var(--radius) - 4px);font-size:1rem;line-height:1;cursor:pointer}
.dashboard-panel-body{flex:1;min-height:0;overflow:hidden;padding:.5rem .65rem .65rem;display:flex;flex-direction:column;gap:.35rem}
.dashboard-panel-body .panel-scroll-region{flex:1;min-height:0;overflow:auto}
.dashboard-panel-body>.row:first-child{display:none}
.dashboard-panel-body>h2:first-child{display:none}
.dashboard-resize{
  position:absolute;right:2px;bottom:2px;width:14px;height:14px;cursor:nwse-resize;
  border:0;background:transparent;padding:0;z-index:2}
.dashboard-resize::after{
  content:"";position:absolute;right:2px;bottom:2px;width:10px;height:10px;
  border-right:2px solid var(--muted-foreground);border-bottom:2px solid var(--muted-foreground);opacity:.7}
.dashboard-item.is-collapsed .dashboard-resize{display:none}
.feeds-panel-scroll{flex:1;min-height:0;overflow:auto;border:1px solid var(--border);
  border-radius:calc(var(--radius) - 2px);padding:0 .5rem}
.feed-headline{display:flex;gap:.35rem;align-items:flex-start;justify-content:space-between}
.feed-headline summary{cursor:pointer;list-style:none;font-weight:600}
.feed-headline summary::-webkit-details-marker{display:none}
.feed-headline summary::before{content:"▸ ";font-size:.7rem;color:var(--muted-foreground)}
details.feed-item[open] .feed-headline summary::before{content:"▾ "}
.feed-item .feed-summary{margin:.25rem 0 .35rem;font-size:.8125rem}
.feed-item .feed-meta{margin:0;font-size:.75rem}
#panel-notes #notes-editor{min-height:0;max-height:4.5rem;resize:vertical;font-size:.8125rem}
#panel-briefing #briefing-body{max-height:4.5rem;margin:0;font-size:.75rem}
#panel-notes .dim{font-size:.75rem;margin:0}
#panel-feeds .feeds-full-link{margin:.25rem 0 0;font-size:.8125rem}
#panel-feeds .feeds-full-link a{text-decoration:underline;text-underline-offset:2px}
@media(max-width:900px){
  .dashboard-grid{grid-template-columns:repeat(6,minmax(0,1fr))}
  .dashboard-item{grid-column:1/-1!important;grid-row:auto!important;height:auto!important}
  .dashboard-drag-handle,.dashboard-resize{display:none}
}
`;

export function dashboardGridScript(): string {
  return `
(function(){
  var grid=document.getElementById("dashboard-grid");
  if(!grid)return;
  var COLS=12,ROW=32,GAP=6,saveTimer=null,lastMovedId=null;
  grid.style.setProperty("--dash-row",ROW+"px");
  grid.style.setProperty("--dash-gap",GAP+"px");

  function titleFor(id){
    var map={
      activity:"Activity",hobie:"Hobie queue","tagged-news":"Tagged news","daily-briefing":"Daily briefing",
      "ai-security":"AI Security",weather:"Weather",calendar:"Calendar",notes:"Notes",
      feeds:"News feeds",briefing:"AI briefing",todoist:"Todoist","host-health":"Host health",
      github:"GitHub",recallio:"Recallio"
    };
    return map[id]||id;
  }

  function applyEntry(el,entry){
    el.style.setProperty("--gc-start",entry.x+1);
    el.style.setProperty("--gc-span",entry.w);
    el.style.setProperty("--gr-start",entry.y+1);
    el.style.setProperty("--gr-span",entry.collapsed?1:entry.h);
    el.classList.toggle("is-collapsed",!!entry.collapsed);
    var btn=el.querySelector(".dashboard-collapse");
    if(btn){
      btn.setAttribute("aria-expanded",entry.collapsed?"false":"true");
      btn.textContent=entry.collapsed?"+":"−";
      btn.setAttribute("aria-label",entry.collapsed?"Expand "+titleFor(entry.id)+" panel":"Collapse "+titleFor(entry.id)+" panel");
    }
  }

  function readLayout(){
    var panels=[];
    grid.querySelectorAll(".dashboard-item").forEach(function(el){
      var id=el.getAttribute("data-panel-id");
      if(!id)return;
      var collapsed=el.classList.contains("is-collapsed");
      var span=parseInt(el.style.getPropertyValue("--gr-span"),10)||3;
      var fullH=parseInt(el.dataset.fullH||String(span),10)||span;
      panels.push({
        id:id,
        x:parseInt(el.style.getPropertyValue("--gc-start"),10)-1||0,
        y:parseInt(el.style.getPropertyValue("--gr-start"),10)-1||0,
        w:parseInt(el.style.getPropertyValue("--gc-span"),10)||3,
        h:collapsed?fullH:span,
        collapsed:collapsed
      });
    });
    return {version:1,cols:COLS,rowHeight:ROW,panels:panels};
  }

  function effH(p){return p.collapsed?1:p.h}
  function overlaps(a,b){
    return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+effH(b)&&a.y+effH(a)>b.y;
  }
  function packAfterMove(panels,anchorId){
    var out=panels.map(function(p){return Object.assign({},p)});
    var anchor=out.find(function(p){return p.id===anchorId});
    if(!anchor)return out;
    var queue=[anchor],seen={};
    seen[anchorId]=1;
    while(queue.length){
      var cur=queue.shift();
      out.forEach(function(other){
        if(other.id===cur.id)return;
        if(!overlaps(cur,other))return;
        var needY=cur.y+effH(cur);
        if(other.y<needY){
          other.y=needY;
          if(other.x+other.w>COLS)other.x=Math.max(0,COLS-other.w);
          if(!seen[other.id]){seen[other.id]=1;queue.push(other);}
        }
      });
    }
    return out;
  }
  function applyPanels(panels){
    var byId={};
    panels.forEach(function(p){byId[p.id]=p});
    grid.querySelectorAll(".dashboard-item").forEach(function(el){
      var id=el.getAttribute("data-panel-id");
      var entry=byId[id];
      if(!entry)return;
      el.dataset.fullH=String(entry.h);
      applyEntry(el,entry);
    });
  }
  function scheduleSave(){
    if(saveTimer)clearTimeout(saveTimer);
    saveTimer=setTimeout(function(){
      var layout=readLayout();
      if(lastMovedId){
        layout.panels=packAfterMove(layout.panels,lastMovedId);
        applyPanels(layout.panels);
      }
      api("/api/dashboard-layout","PUT",layout).then(function(r){
        if(r.layout)applyLayout(r.layout);
      }).catch(function(){});
    },400);
  }

  function cellFromPoint(clientX,clientY){
    var r=grid.getBoundingClientRect();
    var colW=(r.width-GAP*(COLS-1))/COLS;
    var x=Math.floor((clientX-r.left)/(colW+GAP));
    var y=Math.floor((clientY-r.top)/(ROW+GAP));
    return {x:Math.max(0,Math.min(COLS-1,x)),y:Math.max(0,y)};
  }

  function setupChrome(){
    grid.querySelectorAll(".dashboard-item").forEach(function(item){
      var section=item.querySelector("section.card");
      if(!section||section.dataset.chromeReady)return;
      section.dataset.chromeReady="1";
      var id=item.getAttribute("data-panel-id")||"";
      var chrome=document.createElement("div");
      chrome.className="dashboard-panel-chrome";
      chrome.innerHTML='<button type="button" class="dashboard-drag-handle" tabindex="0" aria-label="Drag '+esc(titleFor(id))+' panel">⠿</button>'
        +'<h2>'+esc(titleFor(id))+'</h2>'
        +'<button type="button" class="dashboard-collapse" aria-expanded="true" aria-label="Collapse panel">−</button>';
      var body=document.createElement("div");
      body.className="dashboard-panel-body";
      while(section.firstChild)body.appendChild(section.firstChild);
      section.appendChild(chrome);
      section.appendChild(body);
      var resize=document.createElement("button");
      resize.type="button";
      resize.className="dashboard-resize";
      resize.setAttribute("aria-label","Resize "+titleFor(id)+" panel");
      item.appendChild(resize);

      chrome.querySelector(".dashboard-collapse").addEventListener("click",function(){
        var collapsed=!item.classList.contains("is-collapsed");
        item.classList.toggle("is-collapsed",collapsed);
        var span=collapsed?1:(parseInt(item.dataset.fullH||"3",10)||3);
        item.style.setProperty("--gr-span",span);
        var btn=this;
        btn.setAttribute("aria-expanded",collapsed?"false":"true");
        btn.textContent=collapsed?"+":"−";
        lastMovedId=id;
        scheduleSave();
      });

      var drag=chrome.querySelector(".dashboard-drag-handle");
      drag.addEventListener("pointerdown",function(ev){
        if(ev.button!==0)return;
        ev.preventDefault();
        item.classList.add("is-dragging");
        drag.setPointerCapture(ev.pointerId);
        var startCell=cellFromPoint(ev.clientX,ev.clientY);
        var ox=parseInt(item.style.getPropertyValue("--gc-start"),10)-1||0;
        var oy=parseInt(item.style.getPropertyValue("--gr-start"),10)-1||0;
        var dx=startCell.x-ox,dy=startCell.y-oy;
        function move(e){
          var cell=cellFromPoint(e.clientX,e.clientY);
          var nx=Math.max(0,Math.min(COLS-(parseInt(item.style.getPropertyValue("--gc-span"),10)||3),cell.x-dx));
          var ny=Math.max(0,cell.y-dy);
          item.style.setProperty("--gc-start",nx+1);
          item.style.setProperty("--gr-start",ny+1);
        }
        function up(){
          item.classList.remove("is-dragging");
          drag.releasePointerCapture(ev.pointerId);
          drag.removeEventListener("pointermove",move);
          drag.removeEventListener("pointerup",up);
          lastMovedId=id;
          scheduleSave();
        }
        drag.addEventListener("pointermove",move);
        drag.addEventListener("pointerup",up);
      });

      resize.addEventListener("pointerdown",function(ev){
        if(ev.button!==0||item.classList.contains("is-collapsed"))return;
        ev.preventDefault();
        resize.setPointerCapture(ev.pointerId);
        var startW=parseInt(item.style.getPropertyValue("--gc-span"),10)||3;
        var startH=parseInt(item.style.getPropertyValue("--gr-span"),10)||3;
        var startX=ev.clientX,startY=ev.clientY;
        function move(e){
          var colW=(grid.getBoundingClientRect().width-GAP*(COLS-1))/COLS;
          var dw=Math.round((e.clientX-startX)/(colW+GAP));
          var dh=Math.round((e.clientY-startY)/(ROW+GAP));
          var w=Math.max(2,Math.min(COLS,startW+dw));
          var h=Math.max(2,Math.min(24,startH+dh));
          var x=parseInt(item.style.getPropertyValue("--gc-start"),10)-1||0;
          if(x+w>COLS)w=COLS-x;
          item.style.setProperty("--gc-span",w);
          item.style.setProperty("--gr-span",h);
          item.dataset.fullH=String(h);
        }
        function up(){
          resize.releasePointerCapture(ev.pointerId);
          resize.removeEventListener("pointermove",move);
          resize.removeEventListener("pointerup",up);
          lastMovedId=id;
          scheduleSave();
        }
        resize.addEventListener("pointermove",move);
        resize.addEventListener("pointerup",up);
      });

      drag.addEventListener("keydown",function(ev){
        if(ev.key!=="ArrowLeft"&&ev.key!=="ArrowRight"&&ev.key!=="ArrowUp"&&ev.key!=="ArrowDown")return;
        ev.preventDefault();
        var x=parseInt(item.style.getPropertyValue("--gc-start"),10)-1||0;
        var y=parseInt(item.style.getPropertyValue("--gr-start"),10)-1||0;
        var w=parseInt(item.style.getPropertyValue("--gc-span"),10)||3;
        if(ev.key==="ArrowLeft")x=Math.max(0,x-1);
        if(ev.key==="ArrowRight")x=Math.min(COLS-w,x+1);
        if(ev.key==="ArrowUp")y=Math.max(0,y-1);
        if(ev.key==="ArrowDown")y=y+1;
        item.style.setProperty("--gc-start",x+1);
        item.style.setProperty("--gr-start",y+1);
        lastMovedId=id;
        scheduleSave();
      });
    });
  }

  function applyLayout(layout){
    var byId={};
    (layout.panels||[]).forEach(function(p){byId[p.id]=p;});
    grid.querySelectorAll(".dashboard-item").forEach(function(el){
      var id=el.getAttribute("data-panel-id");
      var entry=byId[id];
      if(!entry)return;
      el.dataset.fullH=String(entry.h);
      applyEntry(el,entry);
    });
  }

  setupChrome();
  api("/api/dashboard-layout").then(function(r){applyLayout(r.layout||{});}).catch(function(){});
  var reset=document.getElementById("dashboard-reset-layout");
  if(reset)reset.addEventListener("click",function(){
    reset.disabled=true;
    api("/api/dashboard-layout/reset","POST",{}).then(function(r){
      applyLayout(r.layout||{});
    }).finally(function(){reset.disabled=false;});
  });
})();
`;
}
