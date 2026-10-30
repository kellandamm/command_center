export const quickAddCss = `
.quick-add-bar{margin-bottom:0}
.quick-add-wrap{position:relative;max-width:36rem;width:100%}
.quick-add-row{display:flex;gap:.5rem;align-items:stretch}
.quick-add-row input{flex:1;min-width:8rem;min-height:2.25rem}
.quick-add-row .btn,.quick-add-row button{align-self:stretch;display:inline-flex;align-items:center}
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
.voice-inbox{margin-bottom:1rem;max-width:36rem}
.voice-inbox.card{padding:.75rem 1rem;margin-bottom:0}
.voice-inbox-header{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.voice-inbox-badge{font-size:.75rem;font-weight:600;padding:.1rem .45rem;border-radius:999px;background:var(--primary);color:var(--primary-foreground)}
.voice-inbox-list{list-style:none;margin:.35rem 0 0;padding:0;display:flex;flex-direction:column;gap:.35rem}
.voice-inbox-item{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.35rem .5rem;border:1px solid var(--border);border-radius:calc(var(--radius) - 2px)}
`;

export const quickAddScript = `
function mountQuickAdd(rootId,opts){
  var root=document.getElementById(rootId);if(!root)return;
  var input=root.querySelector(".quick-add-input");
  var preview=root.querySelector(".quick-add-preview");
  var status=root.querySelector(".quick-add-status");
  var items=[];
  var previewOpen=false;
  var saving=false;
  function displayTime(value,tz){
    if(!value||!/(Z|[+-]\\d{2}:\\d{2})$/.test(value))return value||"";
    var p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value)).map(function(p){return[p.type,p.value];}));
    return p.year+"-"+p.month+"-"+p.day+"T"+p.hour+":"+p.minute;
  }
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
        var d=wallDeltaMin(displayTime(item.start,item._tz),displayTime(item.end,item._tz));if(d!=null&&d>0)item._durationMin=d;
      }
      var row=document.createElement("li");row.className="quick-add-item";
      var kind=document.createElement("p");kind.className="quick-add-kind";kind.textContent=item.kind==="task"?(item.source==="board"?"Native Board task (date-only deadline)":"External Todoist task"+(!item.version?" — legacy preview":"")):"Calendar event";
      row.appendChild(kind);
      var titleLabel=document.createElement("label");titleLabel.textContent="Title";
      var titleInput=document.createElement("input");titleInput.value=item.title||"";titleInput.disabled=saving;
      titleInput.oninput=function(){items[index].title=titleInput.value;};
      row.appendChild(titleLabel);row.appendChild(titleInput);
      var whenLabel=document.createElement("label");
      whenLabel.textContent=item.kind==="task"?"Due (local "+item._tz+")":"Start (local "+item._tz+"; repeated wall times use earlier occurrence unless an explicit offset is kept)";
      var whenInput=document.createElement("input");
      whenInput.disabled=saving;
      whenInput.value=displayTime(item.kind==="task"?item.due:item.start,item._tz);
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
        endInput=document.createElement("input");endInput.disabled=saving;endInput.value=displayTime(item.end,item._tz);endInput.placeholder="YYYY-MM-DDTHH:mm";
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
    var confirm=document.createElement("button");confirm.type="button";confirm.textContent="Confirm";confirm.disabled=saving;
    var cancel=document.createElement("button");cancel.type="button";cancel.className="ghost";cancel.textContent="Cancel";
    cancel.disabled=saving;
    cancel.onclick=function(){items=[];setStatus("");setPreviewOpen(false);if(opts)opts.voiceCaptureId=null;if(opts&&opts.onCancel)opts.onCancel();};
    confirm.onclick=function(){
      if(saving)return;
      saving=true;
      confirm.disabled=true;
      renderPreview("Saving…");
      var captureId=opts&&opts.voiceCaptureId;
      var commit=captureId
        ?api("/api/voice-captures/"+encodeURIComponent(captureId)+"/confirm","POST",{items:items})
        :api("/api/quick-add/commit","POST",{items:items,calendarId:opts&&opts.calendarId||undefined});
      commit.then(function(data){
        saving=false;
        var failed=new Set((data.failures||[]).map(function(f){return f.index;}));
        items=items.filter(function(_,i){return failed.has(i);});
        var done=!items.length;
        if(done&&captureId&&opts)opts.voiceCaptureId=null;
        if(data.results&&data.results.length&&opts&&opts.onCommitted)opts.onCommitted(data.results,opts.context||{},done);
        if(done&&opts&&opts.onVoiceCommitted)opts.onVoiceCommitted();
        if(done){setPreviewOpen(false);setStatus((data.results&&data.results.length)?"Added. ":"");(data.results||[]).forEach(function(r){var a=document.createElement("a");a.href=r.url;a.textContent=r.title+" ("+(r.source||"legacy external")+")";status.appendChild(a);status.appendChild(document.createTextNode(" "));});if(input)input.value="";if(input)input.focus();}
        else{renderPreview("Some items could not be saved. "+(data.failures||[]).map(function(f){return f.title+": "+f.error;}).join(" ")+" Fix and retry.");}
      }).catch(function(err){saving=false;renderPreview(err.message||"Could not save");});
    };
    actions.append(confirm,cancel);preview.appendChild(actions);
    if(status)status.hidden=true;
  }
  function parseText(text){
    if(saving)return Promise.resolve();
    setStatus("Parsing…");
    return api("/api/quick-add/parse","POST",{text:text}).then(function(data){
      items=(data.items||[]).map(function(item){item._tz=item.timezone||"America/Chicago";return item;});
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
  function openPreview(nextItems,hint,captureId){
    if(saving){setStatus("Wait for the current save before opening another preview.",true);return;}
    if(opts&&captureId)opts.voiceCaptureId=captureId;
    items=(nextItems||[]).map(function(item){item._tz=item.timezone||"America/Chicago";return item;});
    setStatus("");
    renderPreview(hint||"Review and confirm.");
  }
  return {parseSelection:function(text,context){
    if(!text||!text.trim()){setStatus("Select text first.",true);return Promise.resolve();}
    opts=Object.assign({},opts||{},context?{context:context}:{});
    if(input)input.value=text.trim();
    return parseText(text.trim());
  },openPreview:openPreview,clear:function(){items=[];setStatus("");setPreviewOpen(false);if(input)input.value="";}};
}
`;
