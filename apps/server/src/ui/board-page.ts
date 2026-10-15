import type { NavLink } from "./layout";
import { page } from "./layout";

const boardCss = `
.board-toolbar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:flex-end;margin-bottom:1rem}
.board-form{display:flex;flex-wrap:wrap;gap:.5rem;align-items:flex-end}
.board-form input{min-width:12rem}
.board-columns{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:.5rem;align-items:start}
@media(max-width:1100px){.board-columns{grid-template-columns:repeat(2,minmax(0,1fr))}}
.board-col{background:var(--muted);border:1px solid var(--border);border-radius:var(--radius);padding:.5rem;min-height:12rem}
.board-col h2{font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:var(--dim);margin:0 0 .5rem}
.board-col-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.35rem;min-height:4rem}
.board-card{background:var(--card);border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);padding:.45rem .5rem;cursor:grab}
.board-card:focus-within{outline:2px solid var(--ring);outline-offset:1px}
.board-card-title{font-weight:600;font-size:.8125rem;margin:0 0 .2rem}
.board-card-notes{font-size:.75rem;color:var(--dim);margin:0}
.board-card-move{margin-top:.35rem;width:100%;font-size:.75rem}
.board-col.drag-over{outline:2px dashed var(--ring)}
`;

export function boardPage(nav?: NavLink[]): string {
  return page({
    title: "Board — Command center",
    active: "/board",
    nav,
    extraCss: boardCss,
    body: `<header class="page-header"><h1>Board</h1><p class="dim">Drag cards between columns or use the move menu. Ready for Hobie queues a Hobie task.</p></header>
<div class="board-toolbar card">
  <form class="board-form" id="board-add-form">
    <label>Title <input type="text" id="board-new-title" required maxlength="200" placeholder="New card"/></label>
    <label>Notes <input type="text" id="board-new-notes" maxlength="500" placeholder="Optional"/></label>
    <button type="submit">Add to Backlog</button>
  </form>
  <button type="button" class="ghost" id="board-refresh">Refresh</button>
</div>
<div class="board-columns" id="board-columns" aria-label="Kanban columns"></div>`,
    script: boardScript(),
  });
}

function boardScript(): string {
  return `
var BOARD_COLUMNS=["Backlog","Ready for Hobie","Waiting","Blocked on me","Done"];
var boardCards=[];
function renderBoard(){
  var root=document.getElementById("board-columns");
  if(!root)return;
  root.innerHTML=BOARD_COLUMNS.map(function(col){
    var cards=boardCards.filter(function(c){return c.column===col}).sort(function(a,b){return a.position-b.position});
    var lis=cards.map(function(c){
      var opts=BOARD_COLUMNS.map(function(target){
        return '<option value="'+esc(target)+'"'+(target===col?" selected":"")+'>'+esc(target)+'</option>';
      }).join("");
      return '<li class="board-card" draggable="true" data-id="'+esc(c.id)+'">'
        +'<p class="board-card-title">'+esc(c.title)+'</p>'
        +(c.notes?'<p class="board-card-notes">'+esc(c.notes)+'</p>':'')
        +'<label class="visually-hidden" for="move-'+esc(c.id)+'">Move card</label>'
        +'<select class="board-card-move" id="move-'+esc(c.id)+'" data-id="'+esc(c.id)+'">'+opts+'</select></li>';
    }).join("");
    return '<section class="board-col" data-column="'+esc(col)+'"><h2>'+esc(col)+' ('+cards.length+')</h2>'
      +'<ul class="board-col-list" data-drop="'+esc(col)+'">'+lis+'</ul></section>';
  }).join("");
  root.querySelectorAll(".board-card").forEach(function(card){
    card.addEventListener("dragstart",function(ev){
      ev.dataTransfer.setData("text/plain",card.dataset.id);
      card.classList.add("dragging");
    });
    card.addEventListener("dragend",function(){card.classList.remove("dragging")});
  });
  root.querySelectorAll(".board-col-list").forEach(function(list){
    list.addEventListener("dragover",function(ev){ev.preventDefault();list.parentElement.classList.add("drag-over")});
    list.addEventListener("dragleave",function(){list.parentElement.classList.remove("drag-over")});
    list.addEventListener("drop",function(ev){
      ev.preventDefault();
      list.parentElement.classList.remove("drag-over");
      var id=ev.dataTransfer.getData("text/plain");
      var col=list.dataset.drop;
      if(id&&col)moveCard(id,col);
    });
  });
  root.querySelectorAll(".board-card-move").forEach(function(sel){
    sel.onchange=function(){
      if(sel.value)moveCard(sel.dataset.id,sel.value);
    };
  });
}
function moveCard(id,column){
  return api("/api/board/cards","PATCH",{id:id,column:column}).then(function(r){
    boardCards=boardCards.map(function(c){return c.id===r.card.id?r.card:c});
    if(!boardCards.some(function(c){return c.id===r.card.id}))boardCards.push(r.card);
    renderBoard();
  });
}
function loadBoard(){
  return api("/api/board/cards").then(function(r){
    boardCards=r.cards||[];
    renderBoard();
  });
}
document.getElementById("board-add-form").onsubmit=function(ev){
  ev.preventDefault();
  var title=document.getElementById("board-new-title").value.trim();
  var notes=document.getElementById("board-new-notes").value.trim();
  if(!title)return;
  api("/api/board/cards","POST",{title:title,notes:notes,column:"Backlog"}).then(function(r){
    boardCards.push(r.card);
    document.getElementById("board-new-title").value="";
    document.getElementById("board-new-notes").value="";
    renderBoard();
  });
};
document.getElementById("board-refresh").onclick=loadBoard;
loadBoard();
`;
}
