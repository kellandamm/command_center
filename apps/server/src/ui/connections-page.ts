import type { NavLink } from "./layout";
import { settingsWorkspace } from "./settings-workspace";

export function connectionsPage(nav?: NavLink[]) {
  return settingsWorkspace({
    category: "connections", title: "Connections", nav,
    description: "See which services power each feature, their effective settings, and their last access check.",
    body: `<p class="dim">Provider settings require a verified owner login. Configuration and access checks are separate: a configured service is not necessarily reachable.</p>
<p id="connection-loading" role="status">Loading connections...</p>
<button type="button" id="connection-retry" class="ghost" hidden>Retry loading connections</button>
<div id="connections-list"></div>
<p class="dim">Looking for <a href="/settings/calendars">Google Calendar and subscriptions</a>? Authentication, agent access, and encryption are in <a href="/settings#advanced">Advanced</a>.</p>
<style>
.connection-section{padding:1.25rem 0;border-bottom:1px solid var(--cp-border);overflow-wrap:anywhere}
.connection-section h3{margin:0 0 .4rem}.connection-summary{display:flex;justify-content:space-between;align-items:start;gap:1rem}.connection-summary p{margin:.25rem 0}
.connection-summary>div{flex:1;min-width:0}.connection-summary>button{flex-shrink:0;white-space:nowrap}
.connection-detail{padding-top:1.5rem}.connection-current{font-size:.8125rem}.connection-fields p{margin:.4rem 0}
.connection-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr));gap:1rem}
.connection-fields label{display:block;margin-top:.5rem}.connection-fields input{width:100%}
.connection-fields label.row{display:flex;align-items:center;gap:.5rem}.connection-fields input[type=checkbox]{width:auto;margin:0}
.connection-actions{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1rem}
.connection-message{overflow-wrap:anywhere;margin-top:.75rem}
</style>`,
    script: `
var labels={llmBaseUrl:"API base URL",llmApiKey:"API key",llmModel:"Model",braveSearchApiKey:"API key",githubToken:"Personal access token",todoistApiToken:"API token",recallioUrl:"Recallio URL",cfAccessClientId:"Access client ID (optional)",cfAccessClientSecret:"Access client secret (optional)",ntfyUrl:"ntfy URL (optional)",ntfyTopic:"Topic",ntfyToken:"Token (optional)"};
function connectionElement(tag,text,cls){var el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;}
function renderConnections(data,onlyId){
  var box=$("connections-list");if(!onlyId)box.replaceChildren();
  $("connection-retry").hidden=true;
  $("connection-loading").textContent=data.writable?"":"Encrypted storage is not enabled. Set CONNECTIONS_MASTER_KEY in deployment configuration before saving credentials.";
  data.connections.forEach(function(connection){
    if(onlyId&&connection.id!==onlyId)return;
    var section=connectionElement("section",null,"connection-section"),heading=connectionElement("h3",connection.label);
    section.dataset.connectionId=connection.id;
    var check=connection.lastCheck,state=connection.disabled?"Disconnected":check?(check.ok?"Last check passed":"Last check failed"):connection.configured?"Configured - not tested":"Not configured";
    var summary=connectionElement("div",null,"connection-summary"),overview=connectionElement("div"),manage=connectionElement("button","Manage","ghost");
    manage.type="button";manage.setAttribute("aria-label","Manage "+connection.label);manage.setAttribute("aria-expanded","false");manage.setAttribute("aria-controls","detail-"+connection.id);
    var safeSummary=connection.id==="github"&&data.githubUsername?"Pull request author: "+data.githubUsername:connection.fields.filter(function(field){return !field.secret&&field.value;}).map(function(field){return field.value;}).join(" · ");
    var summaryStatus=connectionElement("p",state,"dim");
    overview.append(heading,summaryStatus,connectionElement("p",safeSummary||connection.usage,"dim"));summary.append(overview,manage);section.appendChild(summary);
    var detail=connectionElement("div",null,"connection-detail");detail.id="detail-"+connection.id;detail.hidden=true;
    var back=connectionElement("button","Close details","ghost");back.type="button";detail.appendChild(back);
    function openDetail(){
      box.querySelectorAll(".connection-detail").forEach(function(panel){panel.hidden=true;});
      box.querySelectorAll("[aria-expanded]").forEach(function(button){button.setAttribute("aria-expanded","false");});
      detail.hidden=false;manage.setAttribute("aria-expanded","true");back.focus();
    }
    manage.onclick=function(){if(detail.hidden)openDetail();else{detail.hidden=true;manage.setAttribute("aria-expanded","false");}};
    back.onclick=function(){detail.hidden=true;manage.setAttribute("aria-expanded","false");manage.focus();};
    detail.appendChild(connectionElement("p","Used by: "+connection.usage));
    detail.appendChild(connectionElement("p",connection.fallback,"dim"));
    if(connection.id==="github"&&data.githubUsername)detail.appendChild(connectionElement("p","Configured pull request author: "+data.githubUsername+" (deployment-managed)","dim"));
    if(!connection.disabled&&connection.missingFields&&connection.missingFields.length){
      detail.appendChild(connectionElement("p","Missing: "+connection.missingFields.map(function(name){return labels[name]||name;}).join(", ")));
    }
    detail.appendChild(connectionElement("p",connection.updatedAt?"Saved settings updated: "+new Date(connection.updatedAt).toLocaleString():"No saved override. Deployment defaults apply where configured.","dim"));
    var checkStatus=connectionElement("p",check?(check.ok?"Last access check passed: ":"Last access check failed: ")+new Date(check.checkedAt).toLocaleString()+". "+check.message:"Not tested since server restart or settings change. Configured does not mean connected.","dim");
    detail.appendChild(checkStatus);
    var form=document.createElement("form"),fields=connectionElement("div",null,"connection-fields");
    connection.fields.forEach(function(field){
      var wrap=document.createElement("div"),id="connection-"+field.name,label=connectionElement("label",labels[field.name]||field.name);
      label.htmlFor=id;var input=document.createElement("input");input.id=id;input.name=field.name;
      input.type=field.secret?"password":"text";input.autocomplete="off";input.maxLength=4096;input.disabled=!data.writable;
      input.value=field.secret?"":field.value||"";input.dataset.initial=input.value;
      input.required=!field.secret&&!!field.value;
      input.placeholder=field.configured?"Configured - leave blank to keep":"Not configured";
      var current=field.value!==null&&field.value!==undefined?field.value:field.configured?(field.secret?"Set (secret hidden)":"Set (value hidden for safety)"):"Not set";
      wrap.appendChild(label);
      if(field.secret&&field.configured){
        var replaceLabel=connectionElement("label",null,"row"),replace=connectionElement("input");replace.type="checkbox";replace.disabled=!data.writable;
        replaceLabel.append(replace,document.createTextNode("Replace saved credential"));input.hidden=true;input.disabled=true;
        replace.onchange=function(){input.hidden=!replace.checked;input.disabled=!replace.checked;input.value="";if(replace.checked)input.focus();syncActions();};wrap.appendChild(replaceLabel);
      }
      wrap.append(input,connectionElement("p","Current: "+current,"connection-current dim"),connectionElement("p","Source: "+field.source,"connection-current dim"));fields.appendChild(wrap);
    });
    form.appendChild(fields);var actions=connectionElement("div",null,"connection-actions");
    var save=connectionElement("button",connection.disabled?"Reconnect":"Save changes"),cancel=connectionElement("button","Cancel","ghost"),test=connectionElement("button","Test access","ghost"),disconnect=connectionElement("button","Disconnect","ghost"),remove=connectionElement("button","Restore deployment defaults","ghost");
    save.type="submit";test.type=disconnect.type=remove.type="button";save.disabled=!data.writable;disconnect.disabled=!data.writable||connection.disabled;remove.disabled=!data.writable||!connection.hasSavedSettings;test.disabled=connection.disabled||!connection.configured;
    cancel.type="button";actions.append(save,cancel);form.appendChild(actions);
    var status=connectionElement("p",null,"connection-message");status.setAttribute("role","status");form.appendChild(status);
    var pending=false,conflict=false;
    function dirty(){return Array.from(fields.querySelectorAll("input[name]")).some(function(input){return input.value!==input.dataset.initial;});}
    function syncActions(){
      save.disabled=!data.writable||pending||conflict||(!dirty()&&!connection.disabled);cancel.disabled=pending||!dirty();
      disconnect.disabled=!data.writable||pending||conflict||connection.disabled;remove.disabled=!data.writable||pending||conflict||!connection.hasSavedSettings;test.disabled=pending||connection.disabled||!connection.configured;
    }
    function reset(){fields.querySelectorAll("input[name]").forEach(function(input){input.value=input.dataset.initial;});fields.querySelectorAll('input[type="checkbox"]').forEach(function(input){input.checked=false;});fields.querySelectorAll('input[type="password"]').forEach(function(input){var field=connection.fields.find(function(f){return f.name===input.name;});if(field.configured){input.hidden=true;input.disabled=true;}});if(!conflict)status.textContent="";syncActions();}
    registerSettingsDraft("connection-"+connection.id,{dirty:dirty,get pending(){return pending;},reset:reset});
    fields.oninput=syncActions;cancel.onclick=function(){if(conflict)perform(function(){return api("/api/connections").then(function(current){renderConnections(current,connection.id);});});else reset();};
    async function reviewConflict(){
      var current=await api("/api/connections"),updated=current.connections.find(function(item){return item.id===connection.id;});
      conflict=true;syncActions();
      var review=connectionElement("div"),title=connectionElement("p","Current server configuration (secrets hidden):");
      review.appendChild(title);updated.fields.forEach(function(field){review.appendChild(connectionElement("p",(labels[field.name]||field.name)+": "+(field.value|| (field.configured?"Set (hidden)":"Not set"))+" · "+field.source,"dim"));});
      var reload=connectionElement("button","Discard draft and load current","ghost"),keep=connectionElement("button","Keep draft against reviewed version","ghost");reload.type=keep.type="button";
      reload.onclick=function(){renderConnections(current,connection.id);};
      keep.onclick=function(){connection.revision=updated.revision;conflict=false;review.remove();status.textContent="Version reviewed. Save your draft when ready.";syncActions();};review.append(reload,keep);status.appendChild(review);
    }
    function perform(work){
      if(pending)return Promise.resolve();pending=true;syncActions();fields.querySelectorAll("input").forEach(function(input){input.disabled=true;});status.textContent="Working...";
      return work().catch(async function(error){status.textContent=error.message||"Connection request failed.";if(String(error.message).includes("changed elsewhere")){try{await reviewConflict();}catch(reviewError){status.appendChild(connectionElement("p","Could not load current values: "+reviewError.message));}}}).finally(function(){
        pending=false;fields.querySelectorAll("input").forEach(function(input){input.disabled=!data.writable||input.hidden;});syncActions();
      });
    }
    form.onsubmit=function(event){event.preventDefault();var values={};
      fields.querySelectorAll("input[name]").forEach(function(input){if(input.value.trim()&&input.value!==input.dataset.initial)values[input.name]=input.value.trim();});
      perform(function(){return api("/api/connections/"+connection.id,"PUT",{values:values,disabled:false,expectedRevision:connection.revision}).then(function(updated){renderConnections(updated,connection.id);message("Connection settings saved. Use Test access to check access.");});});
    };
    test.onclick=function(){
      if(dirty()){status.textContent="Save your changes first. The access check uses effective settings, not unsaved fields.";return;}
      if(connection.id==="ntfy"&&!confirm("Send a test notification to the configured ntfy topic?"))return;
      perform(function(){return api("/api/connections/"+connection.id+"/test","POST",{}).then(function(result){
        status.textContent=(result.ok?"Passed: ":"Not ready: ")+result.message;
        checkStatus.textContent=(result.ok?"Last access check passed: ":"Last access check failed: ")+new Date(result.checkedAt).toLocaleString()+". "+result.message;
        summaryStatus.textContent=result.ok?"Last check passed":"Last check failed";
      });});
    };
    disconnect.onclick=function(){if(!confirm("Disable "+connection.label+" for all features? Stored settings will be retained."))return;
      perform(function(){return api("/api/connections/"+connection.id,"PUT",{disabled:true,expectedRevision:connection.revision}).then(function(updated){renderConnections(updated,connection.id);});});
    };
    remove.onclick=function(){if(!confirm("Remove saved "+connection.label+" settings? Deployment defaults will become active again if configured."))return;
      perform(function(){return fetch("/api/connections/"+connection.id,{method:"DELETE",headers:{"x-ah":"1","if-match":connection.revision}}).then(async function(response){var result=await response.json();if(!response.ok)throw new Error(result.error||"Could not restore defaults.");return result;}).then(function(updated){renderConnections(updated,connection.id);});});
    };
    var access=connectionElement("div",null,"connection-actions");access.appendChild(test);form.append(access,connectionElement("p","Access checks use saved settings, send a request to the provider, and may consume quota. No checks run automatically.","dim"));
    var advanced=connectionElement("details"),advancedTitle=connectionElement("summary","Advanced actions");advanced.append(advancedTitle,connectionElement("p","Saved values override deployment defaults, except ntfy where deployment values win. Disconnect affects all dependent features; ntfy deployment configuration can remain active.","dim"),disconnect,remove);form.appendChild(advanced);
    detail.appendChild(form);section.appendChild(detail);syncActions();
    var existing=onlyId?Array.from(box.children).find(function(child){return child.dataset.connectionId===connection.id;}):null;
    if(existing){existing.replaceWith(section);openDetail();}else box.appendChild(section);
  });
  if(!onlyId&&location.hash){var target=box.querySelector('[data-connection-id="'+CSS.escape(location.hash.slice(1))+'"] button[aria-controls]');if(target)target.click();}
}
function loadConnections(){
  $("connection-retry").hidden=true;$("connection-loading").textContent="Loading connections...";
  return api("/api/settings").then(function(settingsRes){
    var meta=settingsRes.meta||{};
    return api("/api/connections").then(renderConnections).catch(function(error){
      var hint=ownerViewOnlyHint(meta);
      $("connection-loading").textContent=hint||error.message||"Could not load connections.";$("connection-retry").hidden=false;
    });
  }).catch(function(error){$("connection-loading").textContent=error.message||"Could not load connections.";$("connection-retry").hidden=false;});
}
$("connection-retry").onclick=loadConnections;loadConnections();
`,
  });
}
