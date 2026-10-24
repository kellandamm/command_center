import type { NavLink } from "./layout";
import { workspacePage } from "./workspace";

export function agentQueuePage(nav?: NavLink[]): string {
  return workspacePage({
    title: "Queue",
    description: "Hobie board tasks and homelab agent work (Command Center queue).",
    active: "/agent/queue",
    nav,
    actions: '<button id="queue-refresh" type="button" class="ghost">Refresh</button>',
    body: `<div class="workspace-toolbar"><label for="queue-status">Board status</label><select id="queue-status">
<option value="">All tasks</option><option value="pending">Pending</option><option value="claimed">In progress</option><option value="done">Done</option></select>
<a class="btn ghost" href="/agent?view=board">Add work on Board</a></div>
<div id="agent-queue" class="workspace-list"></div>
<section class="card" id="agent-cc-queue" style="margin-top:1.5rem">
<h2 style="margin:0 0 8px">Homelab agent queue</h2>
<p class="dim">Outbound worker tasks and approval proposals (owner actions).</p>
<div id="cc-queue-tasks" class="workspace-list"></div>
<h3 style="margin:1rem 0 8px">Pending approvals</h3>
<div id="cc-approvals" class="workspace-list"></div>
</section>`,
    script: `
async function loadBoardQueue(){
  var result=await api("/api/hobie/queue"+($("queue-status").value?"?status="+encodeURIComponent($("queue-status").value):""));
  var box=$("agent-queue");box.replaceChildren();
  if(!result.tasks.length){emptyState(box,"No tasks here","Move a Board card to Ready for Hobie to queue work.");return;}
  result.tasks.forEach(function(task){
    var row=element("article",undefined,"workspace-item"),content=element("div");
    content.append(element("h2",task.title),element("p",(task.urgent?"Urgent · ":"")+(task.status==="claimed"?"In progress":task.status)+" · "+task.clientId));
    if(task.body){var details=element("details"),summary=element("summary","Task details");details.append(summary,element("p",task.body));content.append(details);}
    row.append(content);
    if(task.status!=="done"){var done=element("button","Mark done","ghost");done.type="button";done.setAttribute("aria-label","Mark done: "+task.title);
      done.onclick=function(){busy(this,async function(){var result=await api("/api/hobie/queue/"+encodeURIComponent(task.id)+"/done","POST",{});if(!result.ok)throw new Error("Task was not found. Refresh the queue and try again.");await loadBoardQueue();message("Task completed.");});};row.append(done);}
    box.append(row);
  });
}
async function loadCcQueue(){
  var boxTasks=$("cc-queue-tasks"),boxApprovals=$("cc-approvals");
  try{
    var overview=await api("/api/agent-queue/overview");
    boxTasks.replaceChildren();
    if(!overview.tasks.length){emptyState(boxTasks,"No agent tasks","Tasks appear when Hobie posts to /api/queue.");}
    else overview.tasks.slice().reverse().forEach(function(task){
      var row=element("article",undefined,"workspace-item"),content=element("div");
      content.append(element("h2",task.text.slice(0,120)),element("p",task.status+(task.result&&task.result.summary?" · "+task.result.summary:"")));
      row.append(content);boxTasks.append(row);
    });
    boxApprovals.replaceChildren();
    if(!overview.approvals.length){emptyState(boxApprovals,"No pending approvals","The worker queues proposals here for your decision.");}
    else overview.approvals.forEach(function(a){
      var row=element("article",undefined,"workspace-item"),content=element("div");
      content.append(element("h2",a.action_id),element("p",a.reason||"(no reason)"),element("p","Expires "+a.expires_at,"dim"));
      row.append(content);
      var actions=element("div");
      var approve=element("button","Approve","primary");approve.type="button";
      approve.onclick=function(){busy(this,function(){return api("/api/approvals/"+encodeURIComponent(a.id)+"/approve","POST",{}).then(function(){message("Approved (recorded only).");return loadCcQueue();});});};
      var deny=element("button","Deny","ghost");deny.type="button";
      deny.onclick=function(){busy(this,function(){return api("/api/approvals/"+encodeURIComponent(a.id)+"/deny","POST",{}).then(function(){message("Denied.");return loadCcQueue();});});};
      actions.append(approve,deny);row.append(actions);boxApprovals.append(row);
    });
  }catch(err){
    if(String(err&&err.message||err).indexOf("403")>=0||String(err).indexOf("owner")>=0){
      $("agent-cc-queue").innerHTML='<p class="dim">Homelab queue overview requires an owner Cloudflare Access login.</p>';
    }else fail(err);
  }
}
$("queue-refresh").onclick=function(){busy(this,function(){return Promise.all([loadBoardQueue(),loadCcQueue()]);});};
$("queue-status").onchange=function(){loadBoardQueue().catch(fail);};
loadBoardQueue().catch(fail);loadCcQueue().catch(function(){});
`,
  });
}
