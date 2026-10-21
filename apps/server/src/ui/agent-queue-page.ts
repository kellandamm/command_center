import type { NavLink } from "./layout";
import { workspacePage } from "./workspace";

export function agentQueuePage(nav?: NavLink[]): string {
  return workspacePage({
    title: "Queue", description: "Hobie tasks waiting to run, in progress, or completed.",
    active: "/agent/queue", nav,
    actions: '<button id="queue-refresh" type="button" class="ghost">Refresh</button>',
    body: `<div class="workspace-toolbar"><label for="queue-status">Status</label><select id="queue-status">
<option value="">All tasks</option><option value="pending">Pending</option><option value="claimed">In progress</option><option value="done">Done</option></select>
<a class="btn ghost" href="/agent?view=board">Add work on Board</a></div><div id="agent-queue" class="workspace-list"></div>`,
    script: `
async function loadQueue(){
  var result=await api("/api/hobie/queue"+($("queue-status").value?"?status="+encodeURIComponent($("queue-status").value):""));
  var box=$("agent-queue");box.replaceChildren();
  if(!result.tasks.length){emptyState(box,"No tasks here","Move a Board card to Ready for Hobie to queue work.");return;}
  result.tasks.forEach(function(task){
    var row=element("article",undefined,"workspace-item"),content=element("div");
    content.append(element("h2",task.title),element("p",(task.urgent?"Urgent · ":"")+(task.status==="claimed"?"In progress":task.status)+" · "+task.clientId));
    if(task.body){var details=element("details"),summary=element("summary","Task details");details.append(summary,element("p",task.body));content.append(details);}
    row.append(content);
    if(task.status!=="done"){var done=element("button","Mark done","ghost");done.type="button";done.setAttribute("aria-label","Mark done: "+task.title);
      done.onclick=function(){busy(this,async function(){var result=await api("/api/hobie/queue/"+encodeURIComponent(task.id)+"/done","POST",{});if(!result.ok)throw new Error("Task was not found. Refresh the queue and try again.");await loadQueue();message("Task completed.");});};row.append(done);}
    box.append(row);
  });
}
$("queue-refresh").onclick=function(){busy(this,loadQueue);};$("queue-status").onchange=function(){loadQueue().catch(fail);};
loadQueue().catch(fail);`,
  });
}
