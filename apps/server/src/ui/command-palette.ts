import { ICONS } from "./icons";

export const COMMAND_PALETTE_CSS = `
#command-palette-overlay{position:fixed;inset:0;z-index:120;display:none;align-items:flex-start;justify-content:center;padding:max(4rem,8vh) 1rem 1rem;background:color-mix(in srgb,var(--background) 55%,transparent);backdrop-filter:blur(4px)}
#command-palette-overlay.open{display:flex}
#command-palette-panel{width:min(36rem,calc(100vw - 1.5rem));max-height:min(70vh,32rem);display:flex;flex-direction:column;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);overflow:hidden}
#command-palette-panel:focus{outline:none}
.command-palette-search-wrap{display:flex;align-items:center;gap:.5rem;padding:.65rem .85rem;border-bottom:1px solid var(--border)}
.command-palette-search-wrap .ui-icon{color:var(--muted-foreground);flex-shrink:0}
#command-palette-input{flex:1;border:0;background:transparent;font:inherit;color:var(--foreground);min-width:0}
#command-palette-input:focus{outline:none}
#command-palette-input::placeholder{color:var(--muted-foreground)}
#command-palette-listbox{overflow:auto;margin:0;padding:.35rem;list-style:none;flex:1;min-height:0}
.command-palette-option{display:flex;align-items:flex-start;gap:.65rem;width:100%;border:0;border-radius:calc(var(--radius) - 2px);background:transparent;padding:.55rem .65rem;text-align:left;cursor:pointer;color:var(--foreground);font:inherit}
.command-palette-option:hover,.command-palette-option[aria-selected=true]{background:var(--selected)}
.command-palette-option:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}
.command-palette-option-icon{color:var(--muted-foreground);margin-top:.1rem;flex-shrink:0}
.command-palette-option-body{min-width:0;flex:1}
.command-palette-option-title{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.command-palette-option-sub{font-size:.8rem;color:var(--muted-foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.command-palette-empty{padding:1.25rem .85rem;color:var(--muted-foreground);font-size:.9rem}
.command-palette-kbd{margin-left:auto;font-size:.7rem;color:var(--muted-foreground);border:1px solid var(--border);border-radius:4px;padding:.1rem .35rem}
`;

export function commandPaletteMarkup(): string {
  return `<div id="command-palette-overlay" aria-hidden="true">
  <div id="command-palette-panel" role="dialog" aria-modal="true" aria-label="Command palette" tabindex="-1">
    <div class="command-palette-search-wrap">
      <span class="ui-icon" aria-hidden="true">${ICONS.layoutDashboard}</span>
      <input id="command-palette-input" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="command-palette-listbox" aria-activedescendant="" placeholder="Search or jump to…" autocomplete="off" spellcheck="false" />
      <span class="command-palette-kbd" aria-hidden="true">Esc</span>
    </div>
    <ul id="command-palette-listbox" role="listbox" aria-label="Results"></ul>
  </div>
</div>`;
}

export const COMMAND_PALETTE_SCRIPT = `
(function(){
  var overlay=document.getElementById("command-palette-overlay");
  var panel=document.getElementById("command-palette-panel");
  var input=document.getElementById("command-palette-input");
  var listbox=document.getElementById("command-palette-listbox");
  if(!overlay||!panel||!input||!listbox)return;
  var shell=document.querySelector(".app-shell");
  var inset=shell&&shell.querySelector(".sidebar-inset");
  var open=false,priorFocus=null,debounceTimer=null,fetchGen=0,activeIndex=-1,rows=[];
  var TYPE_LABELS=${JSON.stringify({ nav: "Navigation", note: "Note", meeting: "Meeting", task: "Task", "board-card": "Board", bookmark: "Bookmark", "budget-tx": "Budget" })};
  function sidebarShortcutBlocked(){
    var el=document.activeElement;
    if(!el||!el.tagName)return false;
    var tag=el.tagName;
    if(tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT")return true;
    if(el.isContentEditable)return true;
    if(el.closest&&el.closest("#knowledge-editor,#notes-editor,.notes-editor,[contenteditable=true]"))return true;
    return false;
  }
  function focusables(){
    return Array.from(panel.querySelectorAll('button,[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])'))
      .filter(function(el){return el.offsetWidth>0||el.offsetHeight>0;});
  }
  function trapTab(ev){
    if(!open||ev.key!=="Tab")return;
    var items=focusables();
    if(!items.length)return;
    var first=items[0],last=items[items.length-1],active=document.activeElement;
    if(ev.shiftKey){
      if(active===first||!panel.contains(active)){ev.preventDefault();last.focus();}
    }else if(active===last||!panel.contains(active)){ev.preventDefault();first.focus();}
  }
  function setInert(on){
    if(inset){if(on)inset.setAttribute("inert","");else inset.removeAttribute("inert");}
  }
  function setActiveIndex(next){
    activeIndex=next;
    var options=listbox.querySelectorAll(".command-palette-option");
    for(var i=0;i<options.length;i++){
      var sel=i===activeIndex;
      options[i].setAttribute("aria-selected",sel?"true":"false");
    }
    if(activeIndex>=0&&options[activeIndex]){
      input.setAttribute("aria-activedescendant",options[activeIndex].id);
    }else{
      input.removeAttribute("aria-activedescendant");
    }
  }
  function render(){
    listbox.replaceChildren();
    if(!rows.length){
      var empty=document.createElement("li");
      empty.className="command-palette-empty";
      empty.textContent=input.value.trim()?"No results.":"Type to search notes, tasks, bookmarks, and more.";
      empty.setAttribute("role","presentation");
      listbox.appendChild(empty);
      setActiveIndex(-1);
      input.setAttribute("aria-expanded","false");
      return;
    }
    input.setAttribute("aria-expanded","true");
    rows.forEach(function(row,idx){
      var li=document.createElement("li");
      li.setAttribute("role","presentation");
      var btn=document.createElement("button");
      btn.type="button";
      btn.className="command-palette-option";
      btn.id="command-palette-option-"+idx;
      btn.setAttribute("role","option");
      btn.dataset.href=row.href;
      var kind=TYPE_LABELS[row.type]||row.type;
      var body=document.createElement("span");
      body.className="command-palette-option-body";
      var titleEl=document.createElement("span");
      titleEl.className="command-palette-option-title";
      titleEl.textContent=row.title;
      var subEl=document.createElement("span");
      subEl.className="command-palette-option-sub";
      subEl.textContent=row.subtitle?kind+" · "+row.subtitle:kind;
      body.append(titleEl,subEl);
      btn.appendChild(body);
      btn.onclick=function(){navigate(row.href);};
      li.appendChild(btn);
      listbox.appendChild(li);
    });
    setActiveIndex(rows.length?0:-1);
  }
  function navigate(href){
    close();
    if(href.indexOf("http")===0)window.open(href,"_blank","noopener,noreferrer");
    else window.location.href=href;
  }
  function close(){
    if(!open)return;
    open=false;
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden","true");
    setInert(false);
    input.value="";
    rows=[];
    render();
    input.blur();
    if(priorFocus&&priorFocus.focus&&priorFocus!==input&&!overlay.contains(priorFocus))priorFocus.focus();
    priorFocus=null;
  }
  function openPalette(){
    if(open)return;
    priorFocus=document.activeElement;
    open=true;
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden","false");
    setInert(true);
    input.value="";
    rows=[];
    render();
    input.focus();
    queueFetch("");
  }
  window.ccOpenCommandPalette=openPalette;
  function queueFetch(q){
    if(debounceTimer)clearTimeout(debounceTimer);
    debounceTimer=setTimeout(function(){runFetch(q);},150);
  }
  function runFetch(q){
    var gen=++fetchGen;
    fetch("/api/command-palette/search?q="+encodeURIComponent(q)+"&limit=50",{headers:{"x-ah":"1"}})
      .then(function(r){return r.json();})
      .then(function(j){
        if(gen!==fetchGen||!open)return;
        rows=Array.isArray(j.results)?j.results:[];
        render();
      })
      .catch(function(err){console.error("command palette search failed",err);});
  }
  input.addEventListener("input",function(){queueFetch(input.value);});
  input.addEventListener("keydown",function(ev){
    if(ev.key==="ArrowDown"){
      ev.preventDefault();
      if(!rows.length)return;
      setActiveIndex(Math.min(activeIndex+1,rows.length-1));
      var el=document.getElementById("command-palette-option-"+activeIndex);
      if(el)el.focus();
    }else if(ev.key==="ArrowUp"){
      ev.preventDefault();
      if(!rows.length)return;
      setActiveIndex(Math.max(activeIndex-1,0));
      var up=document.getElementById("command-palette-option-"+activeIndex);
      if(up)up.focus();
    }else if(ev.key==="Home"){
      ev.preventDefault();
      if(rows.length)setActiveIndex(0);
    }else if(ev.key==="End"){
      ev.preventDefault();
      if(rows.length)setActiveIndex(rows.length-1);
    }else if(ev.key==="Enter"){
      ev.preventDefault();
      if(activeIndex>=0&&rows[activeIndex])navigate(rows[activeIndex].href);
    }else if(ev.key==="Escape"){
      ev.preventDefault();
      close();
    }
  });
  listbox.addEventListener("keydown",function(ev){
    if(ev.key==="Enter"&&ev.target&&ev.target.dataset&&ev.target.dataset.href){
      ev.preventDefault();
      navigate(ev.target.dataset.href);
    }
  });
  document.addEventListener("keydown",function(ev){
    trapTab(ev);
    if(ev.key==="Escape"&&open){ev.preventDefault();close();return;}
    if((ev.metaKey||ev.ctrlKey)&&ev.key.toLowerCase()==="k"){
      if(sidebarShortcutBlocked())return;
      ev.preventDefault();
      if(open)close(); else openPalette();
    }
  },true);
  overlay.addEventListener("click",function(ev){if(ev.target===overlay)close();});
})();
`;
