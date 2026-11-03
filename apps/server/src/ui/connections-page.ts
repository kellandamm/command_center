import type { NavLink } from "./layout";
import { workspacePage } from "./workspace";

export function connectionsPage(nav?: NavLink[]) {
  return workspacePage({
    title: "Service connections", active: "/settings", nav,
    description: "See which services power each feature, their effective settings, and their last access check.",
    body: `<p><a href="/settings">Back to Settings</a></p>
<p>Only a verified owner can view and manage provider settings here. Secrets stay hidden; current endpoints and model names are shown when safe. Leave a field blank to keep its effective value.</p>
<p class="dim">Saved values override deployment defaults. Remove saved settings to restore those defaults; disconnect to disable a provider even when environment credentials exist. Connection tests send a small request to the provider and may consume quota.</p>
<p id="connection-loading" role="status">Loading connections...</p>
<button type="button" id="connection-retry" class="ghost" hidden>Retry loading connections</button>
<div id="connections-list"></div>
<p class="dim">Google Calendar and calendar subscriptions are managed in <a href="/settings/calendars">Calendars</a>, not through these providers. Agent access, authentication, and the encryption master key remain deployment-managed; see <a href="/settings#general">Current settings</a>.</p>
<style>
.connection-section{padding:1.5rem 0;border-bottom:1px solid var(--cp-border);overflow-wrap:anywhere}
.connection-section:first-child{padding-top:.5rem}.connection-section h2{margin:0 0 .5rem}
.connection-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr));gap:1rem}
.connection-fields label{display:block;margin-top:.5rem}.connection-fields input{width:100%}
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
    var section=connectionElement("section",null,"connection-section"),heading=connectionElement("h2",connection.label);
    section.dataset.connectionId=connection.id;
    section.appendChild(heading);
    var state=connection.disabled?"Disconnected":connection.configured?"Configured - access not guaranteed":"Incomplete - required settings are missing";
    section.appendChild(connectionElement("p",state,"dim"));
    section.appendChild(connectionElement("p","Used by: "+connection.usage));
    section.appendChild(connectionElement("p",connection.fallback,"dim"));
    if(connection.id==="github"&&data.githubUsername)section.appendChild(connectionElement("p","Configured pull request author: "+data.githubUsername+" (deployment-managed)","dim"));
    if(!connection.disabled&&connection.missingFields&&connection.missingFields.length){
      section.appendChild(connectionElement("p","Missing: "+connection.missingFields.map(function(name){return labels[name]||name;}).join(", ")));
    }
    section.appendChild(connectionElement("p",connection.updatedAt?"Saved settings updated: "+new Date(connection.updatedAt).toLocaleString():"No saved override. Deployment defaults apply where configured.","dim"));
    var check=connection.lastCheck;
    var checkStatus=connectionElement("p",check?(check.ok?"Last access check passed: ":"Last access check failed: ")+new Date(check.checkedAt).toLocaleString()+". "+check.message:"Not tested since server restart or settings change. Configured does not mean connected.","dim");
    section.appendChild(checkStatus);
    var form=document.createElement("form"),fields=connectionElement("div",null,"connection-fields");
    connection.fields.forEach(function(field){
      var wrap=document.createElement("div"),id="connection-"+field.name,label=connectionElement("label",labels[field.name]||field.name);
      label.htmlFor=id;var input=document.createElement("input");input.id=id;input.name=field.name;
      input.type=field.secret?"password":"text";input.autocomplete="off";input.maxLength=4096;input.disabled=!data.writable;
      input.placeholder=field.configured?"Configured - leave blank to keep":"Not configured";
      var current=field.value!==null&&field.value!==undefined?field.value:field.configured?(field.secret?"Set (secret hidden)":"Set (value hidden for safety)"):"Not set";
      wrap.append(label,input,connectionElement("p","Current: "+current,"dim"),connectionElement("p","Source: "+field.source,"dim"));fields.appendChild(wrap);
    });
    form.appendChild(fields);var actions=connectionElement("div",null,"connection-actions");
    var save=connectionElement("button","Save / reconnect"),test=connectionElement("button","Test connection","ghost"),disconnect=connectionElement("button","Disconnect","ghost"),remove=connectionElement("button","Remove saved settings","ghost");
    save.type="submit";test.type=disconnect.type=remove.type="button";save.disabled=!data.writable;disconnect.disabled=!data.writable||connection.disabled;remove.disabled=!data.writable||!connection.hasSavedSettings;test.disabled=connection.disabled||!connection.configured;
    actions.append(save,test,disconnect,remove);form.appendChild(actions);
    var status=connectionElement("p",null,"connection-message");status.setAttribute("role","status");form.appendChild(status);
    function perform(work){
      actions.querySelectorAll("button").forEach(function(button){button.disabled=true;});status.textContent="Working...";
      return work().catch(function(error){status.textContent=error.message||"Connection request failed.";}).finally(function(){
        save.disabled=!data.writable;disconnect.disabled=!data.writable||connection.disabled;remove.disabled=!data.writable||!connection.hasSavedSettings;test.disabled=connection.disabled||!connection.configured;
      });
    }
    form.onsubmit=function(event){event.preventDefault();var values={};
      fields.querySelectorAll("input").forEach(function(input){if(input.value.trim())values[input.name]=input.value.trim();});
      perform(function(){return api("/api/connections/"+connection.id,"PUT",{values:values,disabled:false}).then(function(updated){renderConnections(updated,connection.id);message("Connection settings saved. Use Test connection to check access.");});});
    };
    test.onclick=function(){
      if(Array.from(fields.querySelectorAll("input")).some(function(input){return input.value.trim();})){status.textContent="Save your changes first. The access check uses effective settings, not unsaved fields.";return;}
      perform(function(){return api("/api/connections/"+connection.id+"/test","POST",{}).then(function(result){
        status.textContent=(result.ok?"Passed: ":"Not ready: ")+result.message;
        checkStatus.textContent=(result.ok?"Last access check passed: ":"Last access check failed: ")+new Date(result.checkedAt).toLocaleString()+". "+result.message;
      });});
    };
    disconnect.onclick=function(){if(!confirm("Disable "+connection.label+" for all features? Stored settings will be retained."))return;
      perform(function(){return api("/api/connections/"+connection.id,"PUT",{disabled:true}).then(function(updated){renderConnections(updated,connection.id);});});
    };
    remove.onclick=function(){if(!confirm("Remove saved "+connection.label+" settings? Deployment defaults will become active again if configured."))return;
      perform(function(){return api("/api/connections/"+connection.id,"DELETE").then(function(updated){renderConnections(updated,connection.id);});});
    };
    section.appendChild(form);
    var existing=onlyId?Array.from(box.children).find(function(child){return child.dataset.connectionId===connection.id;}):null;
    if(existing)existing.replaceWith(section);else box.appendChild(section);
  });
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
