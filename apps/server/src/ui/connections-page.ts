import type { NavLink } from "./layout";
import { workspacePage } from "./workspace";

export function connectionsPage(nav?: NavLink[]) {
  return workspacePage({
    title: "Service connections", active: "/settings", nav,
    description: "Manage credentials without putting keys in ordinary preferences.",
    body: `<p><a href="/settings">Back to Settings</a></p>
<p>Only a verified owner can manage connections. Saved values are encrypted on this server and are never shown again. Leave a field blank to keep its current value.</p>
<p class="dim">Saved values override deployment defaults. Remove saved settings to restore those defaults; disconnect to disable a provider even when environment credentials exist. Connection tests send a small request to the provider and may consume quota.</p>
<p id="connection-loading" role="status">Loading connections...</p>
<div id="connections-list"></div>
<p class="dim">Google Calendar, Fabric, Fastio, and agent connections will appear as their adapters become available. Authentication, owner identities, and the encryption master key remain deployment-managed.</p>
<style>
.connection-section{padding:1.5rem 0;border-bottom:1px solid var(--border)}
.connection-section:first-child{padding-top:.5rem}.connection-section h2{margin:0 0 .5rem}
.connection-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr));gap:1rem}
.connection-fields label{display:block;margin-top:.5rem}.connection-fields input{width:100%}
.connection-actions{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1rem}
.connection-message{overflow-wrap:anywhere;margin-top:.75rem}
</style>`,
    script: `
var labels={llmBaseUrl:"API base URL",llmApiKey:"API key",llmModel:"Model",braveSearchApiKey:"API key",githubToken:"Personal access token",todoistApiToken:"API token",recallioUrl:"Recallio URL",cfAccessClientId:"Access client ID (optional)",cfAccessClientSecret:"Access client secret (optional)"};
function connectionElement(tag,text,cls){var el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;}
function renderConnections(data){
  var box=$("connections-list");box.replaceChildren();
  $("connection-loading").textContent=data.writable?"":"Encrypted storage is not enabled. Set CONNECTIONS_MASTER_KEY in deployment configuration before saving credentials.";
  data.connections.forEach(function(connection){
    var section=connectionElement("section",null,"connection-section"),heading=connectionElement("h2",connection.label);
    section.appendChild(heading);
    section.appendChild(connectionElement("p",connection.disabled?"Disconnected":connection.configured?"Configured - test access below":"Not configured - add the required fields below","dim"));
    var form=document.createElement("form"),fields=connectionElement("div",null,"connection-fields");
    connection.fields.forEach(function(field){
      var wrap=document.createElement("div"),id="connection-"+field.name,label=connectionElement("label",labels[field.name]||field.name);
      label.htmlFor=id;var input=document.createElement("input");input.id=id;input.name=field.name;
      input.type=field.secret?"password":"text";input.autocomplete="off";input.maxLength=4096;input.disabled=!data.writable;
      input.placeholder=field.configured?"Configured - leave blank to keep":"Not configured";
      wrap.append(label,input,connectionElement("p","Source: "+field.source,"dim"));fields.appendChild(wrap);
    });
    form.appendChild(fields);var actions=connectionElement("div",null,"connection-actions");
    var save=connectionElement("button","Save / reconnect"),test=connectionElement("button","Test connection","ghost"),disconnect=connectionElement("button","Disconnect","ghost"),remove=connectionElement("button","Remove saved settings","ghost");
    save.type="submit";test.type=disconnect.type=remove.type="button";save.disabled=disconnect.disabled=remove.disabled=!data.writable;
    actions.append(save,test,disconnect,remove);form.appendChild(actions);
    var status=connectionElement("p",null,"connection-message");status.setAttribute("role","status");form.appendChild(status);
    function perform(work){
      actions.querySelectorAll("button").forEach(function(button){button.disabled=true;});status.textContent="Working...";
      return work().catch(function(error){status.textContent=error.message||"Connection request failed.";}).finally(function(){
        actions.querySelectorAll("button").forEach(function(button){button.disabled=button!==test&&!data.writable;});
      });
    }
    form.onsubmit=function(event){event.preventDefault();var values={};
      fields.querySelectorAll("input").forEach(function(input){if(input.value.trim())values[input.name]=input.value.trim();});
      perform(function(){return api("/api/connections/"+connection.id,"PUT",{values:values,disabled:false}).then(function(updated){renderConnections(updated);message("Connection settings saved. Use Test connection to check access.");});});
    };
    test.onclick=function(){perform(function(){return api("/api/connections/"+connection.id+"/test","POST",{}).then(function(result){status.textContent=(result.ok?"Passed: ":"Not ready: ")+result.message;});});};
    disconnect.onclick=function(){if(!confirm("Disable "+connection.label+" for all features? Stored settings will be retained."))return;
      perform(function(){return api("/api/connections/"+connection.id,"PUT",{disabled:true}).then(renderConnections);});
    };
    remove.onclick=function(){if(!confirm("Remove saved "+connection.label+" settings? Deployment defaults will become active again if configured."))return;
      perform(function(){return api("/api/connections/"+connection.id,"DELETE").then(renderConnections);});
    };
    section.appendChild(form);box.appendChild(section);
  });
}
api("/api/connections").then(renderConnections).catch(function(error){$("connection-loading").textContent=error.message||"Could not load connections. Reload to retry.";});
`,
  });
}
