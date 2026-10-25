export const quickAddCss = `
.quick-add-bar{margin-bottom:1rem}
.quick-add-wrap{position:relative;max-width:36rem}
.quick-add-row{display:flex;gap:.35rem;align-items:center}
.quick-add-row input{flex:1;min-width:8rem}
.quick-add-preview{border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);padding:.5rem .65rem;background:var(--card);box-shadow:0 4px 16px rgba(0,0,0,.08)}
.quick-add-preview.quick-add-dropdown{position:absolute;top:calc(100% + .25rem);left:0;right:0;z-index:30;max-height:min(70vh,24rem);overflow:auto}
.quick-add-preview ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.5rem}
.quick-add-item{display:grid;gap:.25rem}
.quick-add-kind{font-size:.8125rem;font-weight:600;margin:0}
.quick-add-item label{font-size:.75rem;color:var(--muted-foreground)}
.quick-add-actions{display:flex;gap:.35rem;flex-wrap:wrap;margin-top:.35rem}
`;

export const quickAddScript = `
function mountQuickAdd(rootId,opts){
  var root=document.getElementById(rootId);if(!root)return;
  var input=root.querySelector(".quick-add-input");
  var preview=root.querySelector(".quick-add-preview");
  var status=root.querySelector(".quick-add-status");
  var items=[];
  var previewOpen=false;
  function setStatus(msg){if(status)status.textContent=msg||"";}
  function setPreviewOpen(open){
    previewOpen=open;
    if(opts&&opts.lockEditor)opts.lockEditor(open);
    if(!open&&preview){preview.hidden=true;preview.innerHTML="";}
  }
  function renderPreview(){
    if(!items.length){setPreviewOpen(false);return;}
    setPreviewOpen(true);
    preview.hidden=false;
    preview.classList.add("quick-add-dropdown");
    var list=document.createElement("ul");
    items.forEach(function(item,index){
      var row=document.createElement("li");row.className="quick-add-item";
      var kind=document.createElement("p");kind.className="quick-add-kind";kind.textContent=item.kind==="task"?"Task":"Event";
      row.appendChild(kind);
      var titleLabel=document.createElement("label");titleLabel.textContent="Title";
      var titleInput=document.createElement("input");titleInput.value=item.title||"";
      titleInput.oninput=function(){items[index].title=titleInput.value;};
      row.appendChild(titleLabel);row.appendChild(titleInput);
      var whenLabel=document.createElement("label");
      whenLabel.textContent=item.kind==="task"?"Due (local "+item._tz+")":"Start (local "+item._tz+")";
      var whenInput=document.createElement("input");
      whenInput.value=item.kind==="task"?(item.due||""):(item.start||"");
      whenInput.placeholder="YYYY-MM-DD or YYYY-MM-DDTHH:mm";
      whenInput.oninput=function(){
        if(item.kind==="task")items[index].due=whenInput.value;
        else items[index].start=whenInput.value;
      };
      row.appendChild(whenLabel);row.appendChild(whenInput);
      if(item.kind==="event"){
        var endLabel=document.createElement("label");endLabel.textContent="End (local)";
        var endInput=document.createElement("input");endInput.value=item.end||"";endInput.placeholder="YYYY-MM-DDTHH:mm";
        endInput.oninput=function(){items[index].end=endInput.value;};
        row.appendChild(endLabel);row.appendChild(endInput);
      }
      list.appendChild(row);
    });
    preview.replaceChildren(list);
    var actions=document.createElement("div");actions.className="quick-add-actions";
    var confirm=document.createElement("button");confirm.type="button";confirm.textContent="Confirm";
    var cancel=document.createElement("button");cancel.type="button";cancel.className="ghost";cancel.textContent="Cancel";
    cancel.onclick=function(){items=[];setPreviewOpen(false);setStatus("");};
    confirm.onclick=function(){
      confirm.disabled=true;setStatus("Saving…");
      api("/api/quick-add/commit","POST",{items:items,calendarId:opts&&opts.calendarId||undefined}).then(function(data){
        var failed=new Set((data.failures||[]).map(function(f){return f.index;}));
        items=items.filter(function(_,i){return failed.has(i);});
        if(!items.length){setPreviewOpen(false);setStatus((data.results&&data.results.length)?"Added.":"");}
        else{renderPreview();setStatus("Some items could not be saved. Fix and retry.");}
        if(data.results&&data.results.length&&opts&&opts.onCommitted)opts.onCommitted(data.results,opts.context||{});
        if(!items.length)input.value="";
        input.focus();
      }).catch(function(err){setStatus(err.message||"Could not save");}).finally(function(){confirm.disabled=false;});
    };
    actions.append(confirm,cancel);preview.appendChild(actions);
  }
  function parseText(text){
    setStatus("Parsing…");
    return api("/api/quick-add/parse","POST",{text:text}).then(function(data){
      items=(data.items||[]).map(function(item){item._tz="America/Chicago";return item;});
      renderPreview();setStatus(items.length?"Review and confirm.":"Nothing to add.");
    }).catch(function(err){setStatus(err.message||"Parse failed");});
  }
  if(input)input.addEventListener("keydown",function(ev){
    if(ev.key==="Enter"){ev.preventDefault();var text=input.value.trim();if(!text)return;parseText(text);}
  });
  root.querySelector(".quick-add-parse")?.addEventListener("click",function(){
    var text=input&&input.value.trim();if(!text){setStatus("Type something first.");return;}
    parseText(text);
  });
  return {parseSelection:function(text,context){
    if(!text||!text.trim()){setStatus("Select text first.");return Promise.resolve();}
    opts=Object.assign({},opts||{},context?{context:context}:{});
    if(input)input.value=text.trim();
    return parseText(text.trim());
  },clear:function(){items=[];setPreviewOpen(false);setStatus("");if(input)input.value="";}};
}
`;
