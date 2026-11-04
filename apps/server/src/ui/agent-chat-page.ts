import type { NavLink } from "./layout";
import { workspacePage } from "./workspace";

const agentChatCss = `
.agent-chat-layout{display:grid;grid-template-columns:16rem minmax(0,1fr);gap:1rem;min-height:36rem}
.agent-chat-sidebar{display:flex;flex-direction:column;gap:1rem;min-width:0}
.agent-chat-list{border-top:1px solid var(--border);max-height:17rem;overflow:auto}
.agent-chat-list button{display:block;width:100%;text-align:left;justify-content:start;background:transparent;color:var(--foreground);border:0;border-bottom:1px solid var(--border);border-radius:0;padding:.65rem .5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.agent-chat-list button[aria-pressed=true]{background:var(--accent);color:var(--accent-foreground)}
.agent-chat-agent-row{display:flex;align-items:center;border-bottom:1px solid var(--border)}
.agent-chat-agent-row button:first-child{flex:1;min-width:0}
.agent-chat-agent-row button+button{flex-shrink:0;width:auto;border:0}
.agent-chat-panel{display:flex;flex-direction:column;min-width:0;min-height:36rem}
.agent-chat-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding-bottom:.75rem;border-bottom:1px solid var(--border)}
.agent-chat-head h2{margin:0}
.agent-chat-messages{display:flex;flex-direction:column;gap:.75rem;flex:1;overflow:auto;padding:1rem 0}
.agent-chat-message{max-width:min(90%,65ch);white-space:pre-wrap;overflow-wrap:anywhere;padding:.75rem 1rem;border-radius:var(--radius);background:var(--muted)}
.agent-chat-message[data-role="user"]{align-self:flex-end;background:var(--accent);color:var(--accent-foreground)}
.agent-chat-message[data-role="assistant"]{align-self:flex-start}
.agent-chat-message p{margin:0}
.agent-chat-composer{display:flex;align-items:end;gap:.75rem;border-top:1px solid var(--border);padding-top:.75rem}
.agent-chat-composer label{flex:1;margin:0}
.agent-chat-composer textarea{min-height:3rem;max-height:12rem;resize:vertical;font:inherit}
.agent-chat-composer button{flex-shrink:0}
.agent-chat-muted{font-size:.8rem;color:var(--muted-foreground)}
.agent-connect-form{max-width:48rem}
.agent-connect-form .row>label{flex:1;min-width:14rem}
.agent-connect-form textarea{min-height:5rem}
.agent-chat-empty{margin:auto;text-align:center;padding:2rem;color:var(--muted-foreground)}
.agent-chat-section h2{margin-bottom:.5rem}
.agent-connection-status{min-height:1.5rem;color:var(--muted-foreground)}
.agent-connection-status.bad{color:var(--destructive)}
@media(max-width:760px){.agent-chat-layout{grid-template-columns:1fr}.agent-chat-sidebar{display:grid;grid-template-columns:1fr 1fr}.agent-chat-panel{min-height:28rem}.agent-chat-sidebar .card{min-width:0}}
@media(max-width:500px){.agent-chat-sidebar{grid-template-columns:1fr}.agent-chat-composer{align-items:stretch;flex-direction:column}.agent-chat-composer button{align-self:flex-end}}
`;

export function agentChatPage(nav?: NavLink[]): string {
  return workspacePage({
    title: "Agent Chat",
    description: "Connect an OpenAI-compatible agent and keep a separate, persistent conversation with each one.",
    active: "/agent/chat",
    nav,
    extraCss: agentChatCss,
    actions: '<button id="agent-connect-toggle" type="button" class="ghost">Connect agent</button>',
    body: `<section id="agent-connect-panel" class="card agent-connect-form" hidden aria-labelledby="agent-connect-title">
  <h2 id="agent-connect-title">Connect an agent</h2>
  <p class="agent-chat-muted">This first adapter supports OpenAI-compatible chat-completions endpoints. Use a public HTTPS endpoint; API keys are encrypted at rest.</p>
  <form id="agent-connect-form">
    <div class="row">
      <label for="agent-name">Name<input id="agent-name" required maxlength="80" placeholder="Research assistant"/></label>
      <label for="agent-model">Model<input id="agent-model" required maxlength="200" placeholder="provider/model-name"/></label>
    </div>
    <label for="agent-base-url">API base URL<input id="agent-base-url" type="url" required maxlength="2048" placeholder="https://api.example.com/v1"/></label>
    <label for="agent-api-key">API key<input id="agent-api-key" type="password" autocomplete="new-password" maxlength="4096" placeholder="Stored encrypted; never shown again"/></label>
    <label for="agent-system-prompt">System prompt <span class="agent-chat-muted">(optional)</span><textarea id="agent-system-prompt" maxlength="4000" placeholder="Optional instructions for this agent…"></textarea></label>
      <div class="row"><button id="agent-connect-save" type="submit">Connect</button><button id="agent-connect-delete" class="ghost" type="button" hidden>Delete agent</button><button id="agent-connect-cancel" class="ghost" type="button">Cancel</button></div>
  </form>
  <p id="agent-connect-status" class="agent-connection-status" role="status" aria-live="polite"></p>
</section>
<div class="agent-chat-layout">
  <aside class="agent-chat-sidebar" aria-label="Agent and chat navigation">
    <section class="card agent-chat-section">
      <h2>Connected agents</h2>
      <div id="agent-chat-agents" class="agent-chat-list" role="list"></div>
    </section>
    <section class="card agent-chat-section">
      <div class="row" style="justify-content:space-between"><h2>Conversations</h2><button id="agent-chat-new" type="button" class="ghost" disabled>New chat</button></div>
      <div id="agent-chat-conversations" class="agent-chat-list" role="list"></div>
    </section>
  </aside>
  <section class="card agent-chat-panel" aria-label="Conversation">
    <header class="agent-chat-head"><h2 id="agent-chat-title">Select an agent</h2><span id="agent-chat-status" class="agent-chat-muted"></span></header>
    <div id="agent-chat-messages" class="agent-chat-messages" aria-live="polite">
      <p class="agent-chat-empty">Connect an agent to start a conversation.</p>
    </div>
    <form id="agent-chat-form" class="agent-chat-composer">
      <label for="agent-chat-input"><span class="visually-hidden">Message</span><textarea id="agent-chat-input" maxlength="16000" rows="2" placeholder="Message your agent…" disabled></textarea></label>
      <button id="agent-chat-send" type="submit" disabled>Send</button>
    </form>
  </section>
</div>`,
    script: `
var chatAgents=[],chatConversations=[],selectedAgent=null,selectedConversation=null,canManageAgents=false,editingAgent=null,chatPending=false;
function agentRequest(path,method,body){
  return api(path,method,body);
}
function setChatStatus(text,bad){
  $("agent-chat-status").textContent=text||"";
  $("agent-chat-status").classList.toggle("bad",!!bad);
}
function setConnectionStatus(text,bad){
  $("agent-connect-status").textContent=text||"";
  $("agent-connect-status").classList.toggle("bad",!!bad);
}
function renderAgentList(){
  var box=$("agent-chat-agents");box.replaceChildren();
  if(!chatAgents.length){emptyState(box,"No agents connected",canManageAgents?"Connect an agent using an OpenAI-compatible chat endpoint.":"Ask your workspace owner to connect an agent.");return;}
  chatAgents.forEach(function(agent){
    var row=element("div",undefined,"agent-chat-agent-row"),select=element("button",agent.name);
    select.type="button";select.setAttribute("aria-pressed",selectedAgent&&selectedAgent.id===agent.id?"true":"false");
    select.onclick=function(){selectAgent(agent);};
    row.append(select);
    if(canManageAgents){
      var manage=element("button","Manage","ghost");manage.type="button";manage.onclick=function(){openAgentForm(agent);};row.append(manage);
    }
    box.append(row);
  });
}
function renderConversationList(){
  var box=$("agent-chat-conversations");box.replaceChildren();
  if(!selectedAgent){emptyState(box,"Choose an agent","Conversations are private to your signed-in account.");return;}
  if(!chatConversations.length){emptyState(box,"No conversations yet","Start a new chat with this agent.");return;}
  chatConversations.forEach(function(conversation){
    var button=element("button",conversation.title);
    button.type="button";button.title=conversation.title;button.setAttribute("aria-pressed",selectedConversation&&selectedConversation.id===conversation.id?"true":"false");
    button.onclick=function(){loadConversation(conversation.id);};
    box.append(button);
  });
}
function renderConversation(conversation){
  selectedConversation=conversation;
  $("agent-chat-title").textContent=conversation.title==="New chat"?"New chat":conversation.title;
  var box=$("agent-chat-messages");box.replaceChildren();
  if(!conversation.messages.length){
    var empty=element("p","Ask "+selectedAgent.name+" anything to start this conversation.","agent-chat-empty");box.append(empty);
  }
  conversation.messages.forEach(function(message){
    var bubble=element("article",undefined,"agent-chat-message");bubble.dataset.role=message.role;
    bubble.append(element("p",message.content));box.append(bubble);
  });
  box.scrollTop=box.scrollHeight;
  $("agent-chat-input").disabled=chatPending;
  $("agent-chat-send").disabled=chatPending||!selectedAgent;
  renderConversationList();
}
async function loadConversations(selectId){
  if(!selectedAgent)return;
  var result=await agentRequest("/api/agents/"+encodeURIComponent(selectedAgent.id)+"/conversations");
  chatConversations=result.conversations||[];renderConversationList();
  var next=selectId||chatConversations[0]&&chatConversations[0].id;
  if(next)await loadConversation(next);
  else await createConversation();
}
async function createConversation(){
  if(!selectedAgent)return;
  var result=await agentRequest("/api/agents/"+encodeURIComponent(selectedAgent.id)+"/conversations","POST",{});
  chatConversations.unshift(result.conversation);renderConversation(result.conversation);
  $("agent-chat-input").focus();
}
async function loadConversation(id){
  var result=await agentRequest("/api/agents/"+encodeURIComponent(selectedAgent.id)+"/conversations/"+encodeURIComponent(id));
  renderConversation(result.conversation);
}
async function selectAgent(agent){
  selectedAgent=agent;selectedConversation=null;
  $("agent-chat-title").textContent=agent.name;
  $("agent-chat-new").disabled=false;
  $("agent-chat-input").disabled=false;
  renderAgentList();setChatStatus(agent.credentialConfigured?"":"Credential missing; ask the owner to update this agent.",!agent.credentialConfigured);
  $("agent-chat-messages").replaceChildren();
  try{await loadConversations();}catch(error){errorState($("agent-chat-conversations"),error.message||"Could not load conversations.");setChatStatus(error.message,true);}
}
function openAgentForm(agent){
  editingAgent=agent||null;
  $("agent-connect-title").textContent=agent?"Manage agent":"Connect an agent";
  $("agent-connect-save").textContent=agent?"Save changes":"Connect";
  $("agent-connect-delete").hidden=!agent;
  $("agent-name").value=agent?agent.name:"";
  $("agent-model").value=agent?agent.model:"";
  $("agent-base-url").value=agent?agent.baseUrl:"";
  $("agent-api-key").value="";
  $("agent-api-key").required=!agent;
  $("agent-api-key").placeholder=agent&&agent.credentialConfigured?"Leave blank to keep current key":"API key";
  $("agent-system-prompt").value=agent?agent.systemPrompt:"";
  $("agent-connect-panel").hidden=false;setConnectionStatus("");$("agent-name").focus();
}
async function loadAgents(preferredId){
  var result=await agentRequest("/api/agents");
  chatAgents=result.agents||[];canManageAgents=!!result.canManage;
  $("agent-connect-toggle").hidden=!canManageAgents||!result.credentialStorageWritable;
  renderAgentList();
  var next=chatAgents.find(function(agent){return agent.id===preferredId;})||
    chatAgents.find(function(agent){return selectedAgent&&agent.id===selectedAgent.id;})||chatAgents[0];
  if(next)await selectAgent(next);
  else{
    selectedAgent=null;selectedConversation=null;
    $("agent-chat-title").textContent="Select an agent";
    $("agent-chat-new").disabled=true;$("agent-chat-input").disabled=true;$("agent-chat-send").disabled=true;
    $("agent-chat-messages").replaceChildren(element("p","Connect an agent to start a conversation.","agent-chat-empty"));
    renderConversationList();
  }
  if(canManageAgents&&!result.credentialStorageWritable)setChatStatus("Agent credentials require encrypted storage. Configure CONNECTIONS_MASTER_KEY to connect or manage agents.",true);
}
$("agent-connect-toggle").onclick=function(){openAgentForm();};
$("agent-connect-cancel").onclick=function(){$("agent-connect-panel").hidden=true;editingAgent=null;};
$("agent-connect-delete").onclick=function(){if(!editingAgent||!confirm("Delete "+editingAgent.name+" and its saved chat history?"))return;
  busy(this,async function(){await agentRequest("/api/agents/"+encodeURIComponent(editingAgent.id),"DELETE");editingAgent=null;$("agent-connect-panel").hidden=true;selectedAgent=null;selectedConversation=null;await loadAgents();message("Agent and its conversations deleted.");});
};
$("agent-chat-new").onclick=function(){busy(this,createConversation);};
$("agent-connect-form").onsubmit=async function(event){
  event.preventDefault();
  $("agent-connect-save").disabled=true;setConnectionStatus("Saving…");
  try{
    var body={name:$("agent-name").value,model:$("agent-model").value,baseUrl:$("agent-base-url").value,
      apiKey:$("agent-api-key").value,systemPrompt:$("agent-system-prompt").value};
    if(editingAgent&&!body.apiKey)delete body.apiKey;
    var result=await agentRequest(editingAgent?"/api/agents/"+encodeURIComponent(editingAgent.id):"/api/agents",editingAgent?"PUT":"POST",body);
    $("agent-connect-panel").hidden=true;setConnectionStatus("");editingAgent=null;
    await loadAgents(result.agent.id);message("Agent connection saved.");
  }catch(error){setConnectionStatus(error.message||"Could not save agent.",true);}
  finally{$("agent-connect-save").disabled=false;}
};
$("agent-chat-form").onsubmit=function(event){
  event.preventDefault();if(chatPending||!selectedAgent||!selectedConversation)return;
  var content=$("agent-chat-input").value.trim();if(!content)return;
  chatPending=true;$("agent-chat-send").disabled=true;$("agent-chat-input").disabled=true;
  setChatStatus("Waiting for "+selectedAgent.name+"…");
  var optimistic=structuredClone(selectedConversation);
  optimistic.messages.push({role:"user",content:content,createdAt:new Date().toISOString()});
  renderConversation(optimistic);$("agent-chat-input").value="";
  agentRequest("/api/agents/"+encodeURIComponent(selectedAgent.id)+"/conversations/"+encodeURIComponent(selectedConversation.id)+"/messages","POST",{content:content})
    .then(function(result){renderConversation(result.conversation);setChatStatus("");return loadConversations(result.conversation.id);})
    .catch(function(error){renderConversation(selectedConversation);$("agent-chat-input").value=content;setChatStatus(error.message||"Agent request failed.",true);})
    .finally(function(){chatPending=false;$("agent-chat-input").disabled=false;$("agent-chat-send").disabled=false;$("agent-chat-input").focus();});
};
$("agent-chat-input").addEventListener("keydown",function(event){if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();$("agent-chat-form").requestSubmit();}});
loadAgents().catch(function(error){
  errorState($("agent-chat-agents"),error.message||"Could not load connected agents.");
  setChatStatus(error.message||"Could not load Agent Chat.",true);
});
`,
  });
}
