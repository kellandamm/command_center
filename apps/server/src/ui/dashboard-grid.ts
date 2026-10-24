import { DASHBOARD_GRID_LAYOUT_HELPERS } from "./dashboard-grid-layout";

/** Dashboard grid layout (native CSS grid + pointer drag/resize; zero extra deps). */

export const dashboardGridCss = `
.dashboard-toolbar{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;margin-bottom:1rem}
.dashboard-toolbar .dim{margin:0}
.app-shell:has(.dashboard-page){height:100vh;max-height:100vh;overflow:hidden}
.page-content:has(.dashboard-page){
  flex:1 1 0;min-height:0;display:flex;flex-direction:column;padding:1rem 1.25rem .5rem;box-sizing:border-box;
  overflow:hidden}
.dashboard-page{flex:1 1 0;min-height:0;display:flex;flex-direction:column}
.dashboard-page .page-header{margin-bottom:.5rem;flex-shrink:0}
.dashboard-page .page-header p{margin:.2rem 0 0}
.dashboard-page .dashboard-toolbar{margin-bottom:.5rem;flex-shrink:0}
.dashboard-grid{
  flex:none;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));
  gap:var(--dash-gap,6px);position:relative;touch-action:none}
.dashboard-grid.is-packed{display:block;gap:0}
.dashboard-grid.is-packed .dashboard-item{
  grid-column:unset;grid-row:unset;margin:0;min-height:0}
.dashboard-item{
  min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column;position:relative;
  grid-column:var(--gc-start)/span var(--gc-span);grid-row:var(--gr-start)/span var(--gr-span)}
.dashboard-grid.is-packed .dashboard-item{position:absolute}
.dashboard-item.is-dragging{opacity:.92;z-index:30;box-shadow:0 8px 24px rgba(0,0,0,.12)}
.dashboard-item.is-collapsed{align-self:start;height:var(--dash-strip-h,30px)!important;max-height:var(--dash-strip-h,30px)}
.dashboard-item.is-collapsed .dashboard-panel-body{display:none}
.dashboard-item.is-collapsed>.card{flex:0 0 auto;height:100%;min-height:0}
.dashboard-item.is-collapsed .dashboard-panel-chrome{padding:.28rem .45rem;border-bottom:0;min-height:0}
.dashboard-item.is-collapsed .dashboard-panel-chrome h2{font-size:.8125rem;line-height:1.2}
.dashboard-item.is-collapsed .dashboard-drag-handle,.dashboard-item.is-collapsed .dashboard-collapse{
  min-height:auto;min-width:1.6rem;padding:.1rem .2rem}
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
.dashboard-panel-body{flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;padding:.5rem .65rem .65rem;display:flex;flex-direction:column;gap:.35rem;overscroll-behavior:contain}
.dashboard-panel-body .panel-scroll-region{flex:0 0 auto;min-height:0;overflow:visible}
@media(min-width:769px){
  .dashboard-item:not(.is-collapsed) .dashboard-panel-body{max-height:100%}
}
.dashboard-panel-body>.row:first-child{display:none}
.dashboard-panel-body>h2:first-child{display:none}
.dashboard-resize{
  position:absolute;right:2px;bottom:2px;width:14px;height:14px;cursor:nwse-resize;
  border:0;background:transparent;padding:0;z-index:2}
.dashboard-resize::after{
  content:"";position:absolute;right:2px;bottom:2px;width:10px;height:10px;
  border-right:2px solid var(--muted-foreground);border-bottom:2px solid var(--muted-foreground);opacity:.7}
.dashboard-item.is-collapsed .dashboard-resize{display:none}
#panel-notes #notes-editor{min-height:3rem;flex:1;max-height:100%;resize:none;font-size:.8125rem}
#panel-notes .dim{font-size:.75rem;margin:0}
@media(max-width:768px){
  .app-shell:has(.dashboard-page){height:auto;max-height:none;overflow:visible}
  .page-content:has(.dashboard-page){overflow:visible;flex:none;min-height:auto}
  .dashboard-page{flex:none;min-height:auto}
  .dashboard-grid{grid-template-columns:repeat(6,minmax(0,1fr));height:auto!important;max-height:none!important;grid-template-rows:none!important}
  .dashboard-grid.is-stacked .dashboard-item{height:auto!important;max-height:none!important}
  .dashboard-item{grid-column:1/-1!important;grid-row:auto!important;height:auto!important;max-height:none!important;overflow:visible}
  .dashboard-item:not(.is-collapsed)>.card{height:auto;overflow:visible}
  .dashboard-item:not(.is-collapsed) .dashboard-panel-body{overflow:visible;flex:none;min-height:auto}
  .dashboard-item:not(.is-collapsed) .dashboard-panel-body .panel-scroll-region{overflow:visible;flex:none;min-height:auto}
  .dashboard-drag-handle,.dashboard-resize{display:none}
}
`;

export function dashboardGridScript(): string {
  return `
(function(){
${DASHBOARD_GRID_LAYOUT_HELPERS}
  var grid=document.getElementById("dashboard-grid");
  if(!grid)return;
  var COLS=12,LAYOUT_VERSION=2,GAP=6,REF_ROW=32,STRIP_H=30,saveTimer=null,lastMovedId=null,lastPack=null;
  grid.style.setProperty("--dash-gap",GAP+"px");
  grid.style.setProperty("--dash-strip-h",STRIP_H+"px");
  grid.style.setProperty("--dash-rows","8");
  function layoutMaxEnd(panels){
    var max=1;
    (panels||[]).forEach(function(p){
      var end=p.y+(p.collapsed?1:p.h);
      if(end>max)max=end;
    });
    return max;
  }
  function effH(p){return p.collapsed?1:p.h}
  function panelCoversRow(p,row){
    var end=p.y+effH(p);
    return p.y<=row&&row<end;
  }
  function rowIsStripOnly(panels,row){
    var hits=(panels||[]).filter(function(p){return panelCoversRow(p,row)});
    return hits.length>0&&hits.every(function(p){return p.collapsed});
  }
  function isStacked(){return window.matchMedia("(max-width: 768px)").matches}
  function syncGridRows(panels){
    if(isStacked()){
      grid.classList.add("is-stacked");
      grid.classList.remove("is-packed");
      lastPack=null;
      grid.style.gridTemplateRows="";
      grid.style.height="auto";
      grid.style.maxHeight="none";
      return;
    }
    grid.classList.remove("is-stacked");
    grid.classList.add("is-packed");
    var maxEnd=layoutMaxEnd(panels);
    grid.style.setProperty("--dash-rows",String(maxEnd));
    var page=document.querySelector(".dashboard-page");
    if(!page)return;
    var header=page.querySelector(".page-header");
    var toolbar=page.querySelector(".dashboard-toolbar");
    var chrome=(header?header.offsetHeight:0)+(toolbar?toolbar.offsetHeight:0)+10;
    var avail=Math.max(160,page.clientHeight-chrome-6);
    var stripRows=0,flexRows=0;
    for(var r=0;r<maxEnd;r++){
      if(rowIsStripOnly(panels,r)){stripRows++}else{flexRows++}
    }
    var gapTotal=GAP*(maxEnd-1);
    var rowH=flexRows?Math.max(42,Math.floor((avail-stripRows*STRIP_H-gapTotal)/flexRows)):STRIP_H;
    lastPack=columnPackLayout(panels,rowH,GAP,COLS,STRIP_H);
    grid.style.gridTemplateRows="";
    grid.style.height=lastPack.gridH+"px";
    grid.style.maxHeight=avail+"px";
    grid.dataset.rowPx=String(rowH);
    grid.dataset.stripPx=String(STRIP_H);
    grid.dataset.maxEnd=String(maxEnd);
  }
  function gridMetrics(){
    var maxEnd=parseInt(grid.dataset.maxEnd||"8",10)||8;
    var strip=parseFloat(grid.dataset.stripPx||"0")||0;
    var rowH=parseFloat(grid.dataset.rowPx||"52")||52;
    var r=grid.getBoundingClientRect();
    var colW=COLS?(r.width-GAP*(COLS-1))/COLS:80;
    return {rows:maxEnd,rowH:rowH,strip:strip,colW:colW};
  }
  function rowIndexFromY(clientY,gridTop,m){
    var y=clientY-gridTop;
    if(!isStacked()){
      var maxEnd=parseInt(grid.dataset.maxEnd||"8",10)||8;
      return Math.max(0,Math.min(maxEnd-1,Math.floor(y/(m.rowH+GAP))));
    }
    var maxEnd=parseInt(grid.dataset.maxEnd||"8",10)||8;
    for(var r=0;r<maxEnd;r++){
      var h=rowIsStripOnly(readLayout().panels,r)?m.strip:m.rowH;
      if(y<h)return r;
      y-=h+GAP;
    }
    return Math.max(0,maxEnd-1);
  }

  function titleFor(id){
    if(typeof PANEL_TITLES!=="undefined"&&PANEL_TITLES&&PANEL_TITLES[id])return PANEL_TITLES[id];
    return id;
  }

  function applyEntry(el,entry){
    el.dataset.logicalY=String(entry.y);
    el.dataset.logicalH=String(entry.h);
    el.classList.toggle("is-collapsed",!!entry.collapsed);
    if(isStacked()){
      el.style.left=el.style.top=el.style.width=el.style.height="";
      el.style.setProperty("--gc-start",entry.x+1);
      el.style.setProperty("--gc-span",entry.w);
      el.style.setProperty("--gr-start",entry.y+1);
      el.style.setProperty("--gr-span",entry.collapsed?1:entry.h);
    }else{
      var m=gridMetrics();
      var left=(m.colW+GAP)*entry.x;
      var width=m.colW*entry.w+GAP*(entry.w-1);
      var rect=lastPack&&lastPack.rects[entry.id];
      el.style.setProperty("--gc-start",entry.x+1);
      el.style.setProperty("--gc-span",entry.w);
      el.style.left=left+"px";
      el.style.width=width+"px";
      if(rect){
        el.style.top=rect.top+"px";
        el.style.height=rect.height+"px";
      }
    }
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
      var fullH=parseInt(el.dataset.fullH||el.dataset.logicalH||"3",10)||3;
      var span=parseInt(el.style.getPropertyValue("--gr-span"),10)||fullH;
      panels.push({
        id:id,
        x:parseInt(el.style.getPropertyValue("--gc-start"),10)-1||0,
        y:parseInt(el.dataset.logicalY||(parseInt(el.style.getPropertyValue("--gr-start"),10)-1||0),10),
        w:parseInt(el.style.getPropertyValue("--gc-span"),10)||3,
        h:collapsed?fullH:(parseInt(el.dataset.logicalH||String(span),10)||span),
        collapsed:collapsed
      });
    });
    return {version:LAYOUT_VERSION,cols:COLS,rowHeight:REF_ROW,panels:panels};
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
    syncGridRows(panels);
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
  function updatePanel(id,patch){
    var panels=readLayout().panels.map(function(p){
      return p.id===id?Object.assign({},p,patch):p;
    });
    applyPanels(panels);
  }
  function scheduleSave(){
    if(saveTimer)clearTimeout(saveTimer);
    saveTimer=setTimeout(function(){
      var layout=readLayout();
      if(lastMovedId){
        layout.panels=packAfterMove(layout.panels,lastMovedId);
        layout.panels=compactDashboardRows(layout.panels);
        applyPanels(layout.panels);
      }
      api("/api/dashboard-layout","PUT",layout).then(function(r){
        if(r.layout)applyLayout(r.layout);
      }).catch(function(){});
    },400);
  }

  function cellFromPoint(clientX,clientY){
    var m=gridMetrics();
    var r=grid.getBoundingClientRect();
    var x=Math.floor((clientX-r.left)/(m.colW+GAP));
    var y=rowIndexFromY(clientY,r.top,m);
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
      var pageLink=(typeof PANEL_PAGE_LINKS!=="undefined"&&PANEL_PAGE_LINKS)?PANEL_PAGE_LINKS[id]:null;
      var titleHtml=pageLink?'<a href="'+esc(pageLink)+'">'+esc(titleFor(id))+'</a>':esc(titleFor(id));
      chrome.innerHTML='<button type="button" class="dashboard-drag-handle" tabindex="0" aria-label="Drag '+esc(titleFor(id))+' panel">⠿</button>'
        +'<h2>'+titleHtml+'</h2>'
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
        if(isStacked()){
          var span=collapsed?1:(parseInt(item.dataset.fullH||"3",10)||3);
          item.style.setProperty("--gr-span",span);
        }
        var btn=this;
        btn.setAttribute("aria-expanded",collapsed?"false":"true");
        btn.textContent=collapsed?"+":"−";
        var layout=readLayout();
        layout.panels=compactDashboardRows(layout.panels);
        applyPanels(layout.panels);
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
        var oy=parseInt(item.dataset.logicalY||(parseInt(item.style.getPropertyValue("--gr-start"),10)-1||0),10);
        var ow=parseInt(item.style.getPropertyValue("--gc-span"),10)||3;
        var dx=startCell.x-ox,dy=startCell.y-oy;
        function move(e){
          var cell=cellFromPoint(e.clientX,e.clientY);
          var nx=Math.max(0,Math.min(COLS-ow,cell.x-dx));
          var ny=Math.max(0,cell.y-dy);
          if(isStacked()){
            item.style.setProperty("--gc-start",nx+1);
            item.style.setProperty("--gr-start",ny+1);
          }else{
            updatePanel(id,{x:nx,y:ny,w:ow});
          }
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
        var startH=parseInt(item.dataset.logicalH||item.dataset.fullH||"3",10)||3;
        var startX=ev.clientX,startY=ev.clientY;
        function move(e){
          var m=gridMetrics();
          var dw=Math.round((e.clientX-startX)/(m.colW+GAP));
          var dh=Math.round((e.clientY-startY)/(m.rowH+GAP));
          var w=Math.max(2,Math.min(COLS,startW+dw));
          var h=Math.max(2,Math.min(24,startH+dh));
          var x=parseInt(item.style.getPropertyValue("--gc-start"),10)-1||0;
          if(x+w>COLS)w=COLS-x;
          if(isStacked()){
            item.style.setProperty("--gc-span",w);
            item.style.setProperty("--gr-span",h);
            item.dataset.fullH=String(h);
            item.dataset.logicalH=String(h);
          }else{
            updatePanel(id,{x:x,w:w,h:h});
          }
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
        var y=parseInt(item.dataset.logicalY||(parseInt(item.style.getPropertyValue("--gr-start"),10)-1||0),10);
        var w=parseInt(item.style.getPropertyValue("--gc-span"),10)||3;
        if(ev.key==="ArrowLeft")x=Math.max(0,x-1);
        if(ev.key==="ArrowRight")x=Math.min(COLS-w,x+1);
        if(ev.key==="ArrowUp")y=Math.max(0,y-1);
        if(ev.key==="ArrowDown")y=y+1;
        if(isStacked()){
          item.style.setProperty("--gc-start",x+1);
          item.style.setProperty("--gr-start",y+1);
        }else{
          updatePanel(id,{x:x,y:y,w:w});
        }
        lastMovedId=id;
        scheduleSave();
      });
    });
  }

  function applyLayout(layout){
    var panels=compactDashboardRows(layout.panels||[]);
    applyPanels(panels);
  }

  window.applyDashboardLayout=applyLayout;
  setupChrome();
  syncGridRows(readLayout().panels);
  window.addEventListener("resize",function(){
    if(isStacked())syncGridRows(readLayout().panels);
    else applyPanels(readLayout().panels);
  });
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
