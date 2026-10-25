export const quickAddCss = `
.quick-add-wrap{display:flex;flex-direction:column;gap:.5rem;flex:1;min-width:12rem;max-width:28rem}
.quick-add-row{display:flex;gap:.35rem;align-items:center}
.quick-add-row input{flex:1;min-width:8rem}
.quick-add-preview{border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);padding:.5rem .65rem;background:var(--card)}
.quick-add-preview ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.5rem}
.quick-add-item{display:grid;gap:.25rem}
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
  function setStatus(msg){if(status)status.textContent=msg||"";}
  function renderPreview(){
    if(!items.length){preview.hidden=true;preview.innerHTML="";return;}
    preview.hidden=false;
    var list=document.createElement("ul");
    items.forEach(function(item,index){
      var row=document.createElement("li");row.className="quick-add-item";
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
      var kind=document.createElement("span");kind.className="dim";kind.textContent=item.kind==="task"?"Task":"Event";
      row.appendChild(kind);
      list.appendChild(row);
    });
    preview.replaceChildren(list);
    var actions=document.createElement("div");actions.className="quick-add-actions";
    var confirm=document.createElement("button");confirm.type="button";confirm.textContent="Confirm";
    var cancel=document.createElement("button");cancel.type="button";cancel.className="ghost";cancel.textContent="Cancel";
    cancel.onclick=function(){items=[];renderPreview();setStatus("");};
    confirm.onclick=function(){
      confirm.disabled=true;setStatus("Saving…");
      api("/api/quick-add/commit","POST",{items:items,calendarId:opts&&opts.calendarId||undefined}).then(function(data){
        items=[];renderPreview();setStatus("Added.");
        if(opts&&opts.onCommitted)opts.onCommitted(data.results||[],opts.context||{});
        input.value="";input.focus();
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
  input.addEventListener("keydown",function(ev){
    if(ev.key==="Enter"){ev.preventDefault();var text=input.value.trim();if(!text)return;parseText(text);}
  });
  root.querySelector(".quick-add-parse")?.addEventListener("click",function(){
    var text=input.value.trim();if(!text){setStatus("Type something first.");return;}
    parseText(text);
  });
  return {parseSelection:function(text,context){
    if(!text||!text.trim()){setStatus("Select text first.");return Promise.resolve();}
    opts=Object.assign({},opts||{},context?{context:context}:{});
    input.value=text.trim();
    return parseText(text.trim());
  },clear:function(){items=[];renderPreview();setStatus("");input.value="";}};
}
`;
