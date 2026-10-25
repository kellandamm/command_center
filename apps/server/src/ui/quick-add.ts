export const quickAddCss = `
.quick-add-bar{margin-bottom:1rem}
.quick-add-wrap{position:relative;max-width:36rem}
.quick-add-row{display:flex;gap:.35rem;align-items:center}
.quick-add-row input{flex:1;min-width:8rem}
.quick-add-preview{border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);padding:0;background:var(--card);box-shadow:0 4px 16px rgba(0,0,0,.08)}
.quick-add-preview.quick-add-dropdown{position:absolute;top:calc(100% + .25rem);left:0;right:0;z-index:30;max-height:min(70vh,24rem);display:flex;flex-direction:column;overflow:hidden}
.quick-add-preview-hint{margin:0;padding:.5rem .65rem .25rem;font-size:.8125rem;color:var(--muted-foreground);border-bottom:1px solid var(--border)}
.quick-add-scroll{flex:1;overflow:auto;padding:.5rem .65rem;min-height:0}
.quick-add-preview ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.5rem}
.quick-add-item{display:grid;gap:.25rem}
.quick-add-kind{font-size:.8125rem;font-weight:600;margin:0}
.quick-add-item label{font-size:.75rem;color:var(--muted-foreground)}
.quick-add-actions{display:flex;gap:.35rem;flex-wrap:wrap;padding:.5rem .65rem;border-top:1px solid var(--border);background:var(--card);flex-shrink:0}
.quick-add-status:empty{display:none}
`;

export const quickAddScript = `
function mountQuickAdd(rootId,opts){
  var root=document.getElementById(rootId);if(!root)return;
  var input=root.querySelector(".quick-add-input");
  var preview=root.querySelector(".quick-add-preview");
  var status=root.querySelector(".quick-add-status");
  var items=[];
  var previewOpen=false;
  function setStatus(msg,isError){if(status){status.textContent=msg||"";status.hidden=!!previewOpen&&!isError;}}
  function wallParts(wall){
    var m=/^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})$/.exec(wall||"");
    if(!m)return null;
    return {y:+m[1],mo:+m[2],d:+m[3],h:+m[4],mi:+m[5]};
  }
  function wallToMs(wall){var p=wallParts(wall);if(!p)return NaN;return Date.UTC(p.y,p.mo-1,p.d,p.h,p.mi);}
  function msToWall(ms){var d=new Date(ms);var pad=function(n){return String(n).padStart(2,"0");};
    return d.getUTCFullYear()+"-"+pad(d.getUTCMonth()+1)+"-"+pad(d.getUTCDate())+"T"+pad(d.getUTCHours())+":"+pad(d.getUTCMinutes());}
  function wallDeltaMin(a,b){var da=wallToMs(a),db=wallToMs(b);if(!Number.isFinite(da)||!Number.isFinite(db))return null;return Math.round((db-da)/60000);}
  function addWallMin(wall,delta){var base=wallToMs(wall);if(!Number.isFinite(base))return wall;return msToWall(base+delta*60000);}
  function setPreviewOpen(open){
    previewOpen=open;
    if(opts&&opts.lockEditor)opts.lockEditor(open);
    if(!open){
      if(preview){preview.hidden=true;preview.innerHTML="";}
      if(opts&&opts.onPreviewClose)opts.onPreviewClose();
    }
  }
  function renderPreview(hint){
    if(!items.length){setPreviewOpen(false);setStatus("");return;}
    previewOpen=true;
    if(opts&&opts.lockEditor)opts.lockEditor(true);
    preview.hidden=false;
    preview.classList.add("quick-add-dropdown");
    preview.replaceChildren();
    var hintEl=document.createElement("p");hintEl.className="quick-add-preview-hint";hintEl.textContent=hint||"Review and confirm.";
    preview.appendChild(hintEl);
    var scroll=document.createElement("div");scroll.className="quick-add-scroll";
    var list=document.createElement("ul");
    items.forEach(function(item,index){
      if(item.kind==="event"&&item.start&&item.end&&!item._durationMin){
        var d=wallDeltaMin(item.start,item.end);if(d!=null&&d>0)item._durationMin=d;
      }
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
      var endInput=null;
      whenInput.oninput=function(){
        if(item.kind==="task"){items[index].due=whenInput.value;return;}
        var prev=items[index].start;
        items[index].start=whenInput.value;
        if(endInput&&items[index]._durationMin!=null&&prev){
          items[index].end=addWallMin(whenInput.value,items[index]._durationMin);
          endInput.value=items[index].end;
        }
      };
      row.appendChild(whenLabel);row.appendChild(whenInput);
      if(item.kind==="event"){
        var endLabel=document.createElement("label");endLabel.textContent="End (local)";
        endInput=document.createElement("input");endInput.value=item.end||"";endInput.placeholder="YYYY-MM-DDTHH:mm";
        endInput.oninput=function(){
          items[index].end=endInput.value;
          var d=wallDeltaMin(items[index].start,items[index].end);
          if(d!=null&&d>0)items[index]._durationMin=d;
        };
        row.appendChild(endLabel);row.appendChild(endInput);
      }
      list.appendChild(row);
    });
    scroll.appendChild(list);preview.appendChild(scroll);
    var actions=document.createElement("div");actions.className="quick-add-actions";
    var confirm=document.createElement("button");confirm.type="button";confirm.textContent="Confirm";
    var cancel=document.createElement("button");cancel.type="button";cancel.className="ghost";cancel.textContent="Cancel";
    cancel.onclick=function(){items=[];setStatus("");setPreviewOpen(false);if(opts&&opts.onCancel)opts.onCancel();};
    confirm.onclick=function(){
      confirm.disabled=true;
      renderPreview("Saving…");
      api("/api/quick-add/commit","POST",{items:items,calendarId:opts&&opts.calendarId||undefined}).then(function(data){
        var failed=new Set((data.failures||[]).map(function(f){return f.index;}));
        items=items.filter(function(_,i){return failed.has(i);});
        var done=!items.length;
        if(data.results&&data.results.length&&opts&&opts.onCommitted)opts.onCommitted(data.results,opts.context||{},done);
        if(done){setPreviewOpen(false);setStatus((data.results&&data.results.length)?"Added.":"");if(input)input.value="";if(input)input.focus();}
        else{renderPreview("Some items could not be saved. Fix and retry.");}
      }).catch(function(err){renderPreview(err.message||"Could not save");}).finally(function(){confirm.disabled=false;});
    };
    actions.append(confirm,cancel);preview.appendChild(actions);
    if(status)status.hidden=true;
  }
  function parseText(text){
    setStatus("Parsing…");
    return api("/api/quick-add/parse","POST",{text:text}).then(function(data){
      items=(data.items||[]).map(function(item){item._tz="America/Chicago";return item;});
      setStatus("");
      renderPreview(items.length?"Review and confirm.":"Nothing to add.");
    }).catch(function(err){setStatus(err.message||"Parse failed",true);});
  }
  if(input)input.addEventListener("keydown",function(ev){
    if(ev.key==="Enter"){ev.preventDefault();var text=input.value.trim();if(!text)return;parseText(text);}
  });
  root.querySelector(".quick-add-parse")?.addEventListener("click",function(){
    var text=input&&input.value.trim();if(!text){setStatus("Type something first.",true);return;}
    parseText(text);
  });
  return {parseSelection:function(text,context){
    if(!text||!text.trim()){setStatus("Select text first.",true);return Promise.resolve();}
    opts=Object.assign({},opts||{},context?{context:context}:{});
    if(input)input.value=text.trim();
    return parseText(text.trim());
  },clear:function(){items=[];setStatus("");setPreviewOpen(false);if(input)input.value="";}};
}
`;
