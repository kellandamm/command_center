import type { NavLink } from "./layout";
import { page } from "./layout";

const whiteboardCss = `
.whiteboard-workspace{display:grid;grid-template-columns:14rem minmax(0,1fr);gap:1rem;min-height:calc(100vh - 10rem)}
.whiteboard-rail{display:flex;flex-direction:column;gap:.5rem}
.whiteboard-rail button{width:100%;justify-content:flex-start}
.whiteboard-canvas-wrap{border:1px solid var(--border);border-radius:var(--radius);min-height:32rem;height:calc(100vh - 11rem);overflow:hidden;background:var(--card)}
#whiteboard-root{width:100%;height:100%}
@media(max-width:900px){.whiteboard-workspace{grid-template-columns:1fr}.whiteboard-canvas-wrap{min-height:24rem;height:70vh}}
`;

const whiteboardHead = `<link rel="stylesheet" href="/assets/excalidraw/index.css" />
<script>window.EXCALIDRAW_ASSET_PATH="/assets/excalidraw/";</script>
<script defer src="/assets/whiteboard-editor.js"></script>`;

export function whiteboardPage(nav?: NavLink[]): string {
  return page({
    title: "Whiteboard — Command center",
    active: "/whiteboard",
    nav,
    extraCss: whiteboardCss,
    extraHead: whiteboardHead,
    body: `<header class="page-header"><h1>Whiteboard</h1><p class="dim">Sketch ideas with Excalidraw. Scenes are stored on the server as JSON.</p></header>
<div class="whiteboard-workspace">
  <aside class="whiteboard-rail card" aria-label="Board list">
    <button type="button" id="whiteboard-new" disabled>New board</button>
    <ul id="whiteboard-list" class="workspace-list"></ul>
    <p id="whiteboard-status" class="dim"></p>
  </aside>
  <section class="whiteboard-canvas-wrap" aria-label="Canvas">
    <div id="whiteboard-root"></div>
  </section>
</div>`,
    script: whiteboardScript(),
  });
}

function whiteboardScript(): string {
  return `
function $(id){return document.getElementById(id);}
function fail(err){setStatus(err&&err.message?err.message:String(err));}
var whiteboardState={scenes:[],current:null,owner:false,dirty:false,timer:null};
function setStatus(msg){var el=$("whiteboard-status");if(el)el.textContent=msg||"";}
function renderList(){
  var list=$("whiteboard-list");if(!list)return;
  list.innerHTML="";
  whiteboardState.scenes.forEach(function(scene){
    var li=document.createElement("li");
    var btn=document.createElement("button");
    btn.type="button";btn.className="ghost";
    btn.textContent=scene.title;
    if(whiteboardState.current&&whiteboardState.current.id===scene.id)btn.setAttribute("aria-current","true");
    btn.onclick=function(){openScene(scene.id);};
    li.appendChild(btn);list.appendChild(li);
  });
}
function scheduleSave(){
  if(!whiteboardState.owner||!whiteboardState.current)return;
  whiteboardState.dirty=true;
  clearTimeout(whiteboardState.timer);
  whiteboardState.timer=setTimeout(saveScene,800);
}
function saveScene(){
  if(!whiteboardState.owner||!whiteboardState.current||!window.whiteboardEditor)return;
  var payload={title:whiteboardState.current.title,scene:window.whiteboardEditor.getScene()};
  api("/api/whiteboard/scenes/"+encodeURIComponent(whiteboardState.current.id),"PUT",payload).then(function(res){
    whiteboardState.current=res.scene;whiteboardState.dirty=false;setStatus("Saved");
  }).catch(function(err){setStatus(err.message||"Save failed");});
}
function openScene(id){
  return api("/api/whiteboard/scenes/"+encodeURIComponent(id)).then(function(res){
    whiteboardState.current=res.scene;
    if(window.whiteboardEditor)window.whiteboardEditor.loadScene(res.scene.scene);
    renderList();setStatus("");
  });
}
function loadIndex(){
  return api("/api/whiteboard/scenes").then(function(data){
    whiteboardState.scenes=data.scenes||[];whiteboardState.owner=!!data.owner;
    var newBtn=$("whiteboard-new");if(newBtn)newBtn.disabled=!data.owner;
    renderList();
    if(!whiteboardState.current&&whiteboardState.scenes[0])return openScene(whiteboardState.scenes[0].id);
  });
}
document.addEventListener("whiteboard:change",scheduleSave);
$("whiteboard-new").onclick=function(){
  if(!whiteboardState.owner)return;
  api("/api/whiteboard/scenes","POST",{title:"Untitled board"}).then(function(res){
    whiteboardState.scenes.push({id:res.scene.id,title:res.scene.title,createdAt:res.scene.createdAt,updatedAt:res.scene.updatedAt});
    return openScene(res.scene.id);
  }).catch(fail);
};
function syncEditorScene(){
  if(whiteboardState.current&&window.whiteboardEditor){
    window.whiteboardEditor.loadScene(whiteboardState.current.scene);
  }
}
document.addEventListener("whiteboard:ready",syncEditorScene);
loadIndex().then(syncEditorScene).catch(fail);
`;
}
