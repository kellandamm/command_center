export const calendarPlanningScript = String.raw`
(function(){
  var box=document.getElementById("cal-tasks"),status=document.getElementById("cal-task-status"),form=document.getElementById("cal-task-capture");
  function node(tag,text){var e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
  function link(text,href){var e=node("a",text);e.href=href;return e;}
  function fail(error){status.textContent=error.message||"Task request failed. Refresh to retry.";status.className="bad";}
  function load(){
    return api("/api/calendars/planning").then(function(data){
      box.replaceChildren();status.className="dim";
      var active=data.cards.filter(function(card){return card.column!=="Done";});
      var unscheduled=active.filter(function(card){return !card.scheduled;});
      status.textContent=unscheduled.length+" unscheduled · "+active.length+" open Board tasks";
      var scheduled=node("details"),summary=node("summary","Scheduled tasks ("+(active.length-unscheduled.length)+")");scheduled.appendChild(summary);
      var completed=node("details");completed.appendChild(node("summary","Completed tasks"));
      data.cards.forEach(function(card){
        var row=node("article");row.className="calendar-task";
        row.appendChild(node("strong",card.title));
        row.appendChild(node("p",(card.estimatedMinutes?card.estimatedMinutes+" min estimate · ":"")+card.priority+" priority"+(card.dueDate?" · Due "+card.dueDate:"")+" · "+card.column));
        var actions=node("div");actions.className="row";
        actions.appendChild(link("Plan / edit task","/calendar/event?task="+encodeURIComponent(card.id)));
        row.appendChild(actions);
        var blocks=data.blocks.filter(function(block){return block.taskId===card.id;});
        blocks.forEach(function(block){
          var copy=block.allDay?block.start+" (all day)":new Date(block.start).toLocaleString(undefined,{timeZone:data.timezone});
          row.appendChild(link("Edit block: "+copy+(block.enabled?"":" · paused calendar"),"/calendar/event?event="+encodeURIComponent(block.id)));
        });
        if(card.column==="Done")completed.appendChild(row);else if(card.scheduled)scheduled.appendChild(row);else box.appendChild(row);
      });
      if(!unscheduled.length)box.appendChild(node("p","No unscheduled tasks. Capture a task below or review scheduled tasks."));
      box.appendChild(scheduled);box.appendChild(completed);
      var orphans=data.blocks.filter(function(block){return block.orphaned;});
      if(orphans.length){
        var warning=node("details");warning.appendChild(node("summary","Blocks with missing tasks ("+orphans.length+")"));
        orphans.forEach(function(block){warning.appendChild(link(block.summary+" · clear or change task link","/calendar/event?event="+encodeURIComponent(block.id)));});
        box.appendChild(warning);
      }
      if(!data.canManage)box.appendChild(node("p","A verified owner can reserve or change calendar time. Board task capture remains available."));
    });
  }
  form.onsubmit=function(event){
    event.preventDefault();var input=document.getElementById("cal-task-title"),button=form.querySelector("button");button.disabled=true;
    api("/api/board/cards","POST",{title:input.value,column:"Backlog"}).then(function(){
      input.value="";return load();
    }).catch(fail).finally(function(){button.disabled=false;});
  };
  document.getElementById("cal-task-refresh").onclick=function(){load().catch(fail);};
  load().catch(fail);
})();
`;
