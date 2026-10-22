export const calendarScript = String.raw`
(function(){
  var $=function(id){return document.getElementById(id);};
  var zone=Intl.DateTimeFormat().resolvedOptions().timeZone,weekStartsOn=1,view="week",selected,miniMonth;
  var snapshot={configured:false,feeds:[],events:[]},hidden=new Set(),request=0,loaded=false;
  var datesCache=new WeakMap(),dayFormatter,formatterZone;
  var colors=["red","blue","green","purple","orange","teal"];
  function node(tag,cls,text){var element=document.createElement(tag);if(cls)element.className=cls;if(text!==undefined)element.textContent=text;return element;}
  function dayKey(value){
    if(formatterZone!==zone){dayFormatter=new Intl.DateTimeFormat("en-US",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"});formatterZone=zone;}
    var parts=dayFormatter.formatToParts(new Date(value));
    function part(type){return parts.find(function(item){return item.type===type;}).value;}
    return part("year")+"-"+part("month")+"-"+part("day");
  }
  function date(key){return new Date(key+"T12:00:00Z");}
  function shift(key,days){var value=date(key);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);}
  function monthShift(key,months){
    var value=date(key),day=value.getUTCDate();value.setUTCDate(1);value.setUTCMonth(value.getUTCMonth()+months);
    var last=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()+1,0)).getUTCDate();value.setUTCDate(Math.min(day,last));return value.toISOString().slice(0,10);
  }
  function weekStart(key){return shift(key,-((date(key).getUTCDay()-weekStartsOn+7)%7));}
  function label(key,options){return date(key).toLocaleDateString(undefined,Object.assign({timeZone:"UTC"},options));}
  function today(){return dayKey(new Date());}
  function daysForView(){
    var start=view==="month"?weekStart(selected.slice(0,7)+"-01"):view==="week"?weekStart(selected):selected;
    return Array.from({length:view==="month"?42:view==="week"?7:1},function(_,index){return shift(start,index);});
  }
  function color(event){
    var index=snapshot.feeds.findIndex(function(feed){return feed.id===event.calendarId;});
    if(index>=0&&/^#[a-f0-9]{6}$/i.test(snapshot.feeds[index].color||""))return snapshot.feeds[index].color;
    return "var(--calendar-"+colors[(Math.max(index,0))%colors.length]+")";
  }
  function decorate(element,event){element.style.setProperty("--event-color",color(event));return element;}
  function sourceName(event){var source=snapshot.feeds.find(function(feed){return feed.id===event.calendarId;});return source?source.name||"Calendar":"Calendar";}
  function time(value){return new Date(value).toLocaleTimeString(undefined,{timeZone:zone,hour:"numeric",minute:"2-digit"});}
  function minutes(value){
    var parts=new Intl.DateTimeFormat("en-GB",{timeZone:zone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value));
    return Number(parts.find(function(part){return part.type==="hour";}).value)*60+Number(parts.find(function(part){return part.type==="minute";}).value);
  }
  function eventDates(event){
    var cached=datesCache.get(event);
    if(cached&&cached.zone===zone)return cached;
    var start=event.allDay?event.start.slice(0,10):dayKey(event.start);
    var last=!event.end?start:event.allDay?shift(event.end.slice(0,10),-1):dayKey(new Date(new Date(event.end).getTime()-1));
    cached={start:start,last:last,zone:zone};datesCache.set(event,cached);return cached;
  }
  function eventStart(event){return eventDates(event).start;}
  function eventLastDay(event){return eventDates(event).last;}
  function onDay(event,key){return eventStart(event)<=key&&eventLastDay(event)>=key;}
  function filtered(){
    var query=$("cal-search").value.trim().toLowerCase();
    return snapshot.events.filter(function(event){
      return !hidden.has(event.calendarId)&&(!query||(event.summary+" "+(event.location||"")+" "+(event.description||"")+" "+sourceName(event)).toLowerCase().includes(query));
    });
  }
  function eventWhen(event){return event.allDay?"All day":time(event.start)+(event.end?" – "+time(event.end):"");}
  function safeUrl(raw){try{var url=new URL(raw);return ["http:","https:"].includes(url.protocol)?url.href:null;}catch(_){return null;}}
  function details(event){
    $("cal-event-title").textContent=event.summary;
    $("cal-event-calendar").textContent=sourceName(event);
    var start=eventStart(event),last=eventLastDay(event);
    $("cal-event-time").textContent=label(start,{weekday:"long",month:"long",day:"numeric",year:"numeric"})+(last!==start?" – "+label(last,{month:"long",day:"numeric",year:"numeric"}):"")+" · "+eventWhen(event)+(event.allDay?"":" · "+zone);
    $("cal-event-location").textContent=event.location||"";
    $("cal-event-description").textContent=event.description||"";
    $("cal-event-link").replaceChildren();
    var href=safeUrl(event.url);
    if(href){var link=node("a","","Open event link");link.href=href;link.target="_blank";link.rel="noopener noreferrer";$("cal-event-link").appendChild(link);}
    if(event.url&&event.url.startsWith("/notes?note=")){var noteLink=node("a","","Open linked note");noteLink.href=event.url;$("cal-event-link").appendChild(noteLink);}
    var editable=event.readOnly===false&&event.eventId;
    var google=String(event.calendarId||"").indexOf("google-")===0;
    $("cal-event-edit").hidden=!editable;
    if(editable)$("cal-event-edit").href="/calendar/event?event="+encodeURIComponent(event.eventId);
    else $("cal-event-edit").removeAttribute("href");
    $("cal-event-permission").textContent=editable?(google?"Google Calendar event · edits are rejected if it changed elsewhere":event.recurrence&&event.recurrence!=="none"?"Recurring native event · edits apply to the whole series":"Native event · editable by an owner"):google?"Google Calendar event · read-only":"Subscribed event · read-only";
    $("cal-event-dialog").showModal();
  }
  function eventButton(event,cls,withTime){
    var button=decorate(node("button",cls||"calendar-event"),event);button.type="button";
    button.title=event.summary+" · "+eventWhen(event)+(event.location?" · "+event.location:"");
    button.setAttribute("aria-label",button.title);
    if(withTime&&!event.allDay)button.appendChild(node("span","",time(event.start)));
    button.appendChild(node("strong","",event.summary));
    button.onclick=function(){details(event);};return button;
  }
  function select(key){selected=key;miniMonth=key.slice(0,7)+"-01";load();}
  function renderMini(events){
    var container=$("cal-mini");container.replaceChildren();
    $("cal-mini-label").textContent=label(miniMonth,{month:"long",year:"numeric"});
    var start=weekStart(miniMonth),current=today();
    for(var index=0;index<7;index++)container.appendChild(node("span","",label(shift(start,index),{weekday:"narrow"})));
    for(var index=0;index<42;index++){
      var key=shift(start,index),button=node("button","",String(date(key).getUTCDate()));button.type="button";
      button.classList.toggle("outside",key.slice(0,7)!==miniMonth.slice(0,7));
      button.classList.toggle("today",key===current);button.classList.toggle("has-events",events.some(function(event){return onDay(event,key);}));
      button.setAttribute("aria-label",label(key,{weekday:"long",month:"long",day:"numeric",year:"numeric"}));
      button.setAttribute("aria-pressed",String(key===selected));button.dataset.date=key;
      button.onclick=function(){select(this.dataset.date);};container.appendChild(button);
    }
  }
  function renderSources(){
    var container=$("cal-sources");container.replaceChildren();
    snapshot.feeds.forEach(function(feed,index){
      var row=node("label","calendar-source"),checkbox=node("input");checkbox.type="checkbox";checkbox.checked=!hidden.has(feed.id);
      row.style.setProperty("--event-color",/^#[a-f0-9]{6}$/i.test(feed.color||"")?feed.color:"var(--calendar-"+colors[index%colors.length]+")");
      checkbox.onchange=function(){if(this.checked)hidden.delete(feed.id);else hidden.add(feed.id);render();};
      row.appendChild(checkbox);row.appendChild(node("span","calendar-dot"));row.appendChild(node("span","",feed.name||"Calendar "+(index+1)));
      if(!feed.ok){var error=node("span","bad","Unavailable");error.title=feed.error||"Feed could not be loaded";row.appendChild(error);}
      container.appendChild(row);
    });
    if(!snapshot.feeds.length)container.appendChild(node("p","dim calendar-hint",loaded?"No calendars configured.":"Loading…"));
  }
  function renderAgenda(events,days){
    var container=$("cal-agenda");container.replaceChildren();
    var rangeEnd=days[days.length-1];
    var items=events.filter(function(event){return eventStart(event)<=rangeEnd&&eventLastDay(event)>=days[0];});
    $("cal-agenda-title").textContent=view==="day"?"Day agenda":"Period agenda";$("cal-agenda-count").textContent=items.length;
    var previous="";
    items.forEach(function(event){
      var key=eventStart(event)<days[0]?days[0]:eventStart(event);
      if(key!==previous){container.appendChild(node("h3","calendar-agenda-date",label(key,{weekday:"short",month:"short",day:"numeric"})));previous=key;}
      var button=decorate(node("button","calendar-agenda-event"),event);button.type="button";button.appendChild(node("span","calendar-dot"));
      var copy=node("span");copy.appendChild(node("strong","",event.summary));copy.appendChild(node("small","",eventWhen(event)));button.appendChild(copy);
      button.onclick=function(){details(event);};container.appendChild(button);
    });
    if(!items.length)container.appendChild(node("p","dim calendar-hint",$("cal-search").value||hidden.size?"No matching events in this period.":"Nothing scheduled. A little room to breathe."));
  }
  function renderMonth(events,days){
    var container=node("div","calendar-month"),current=today();
    days.slice(0,7).forEach(function(key){container.appendChild(node("div","calendar-weekday",label(key,{weekday:"short"})));});
    days.forEach(function(key){
      var cell=node("div","calendar-month-day");
      cell.classList.toggle("outside",key.slice(0,7)!==selected.slice(0,7));cell.classList.toggle("selected",key===selected);
      var button=node("button","calendar-date-button",String(date(key).getUTCDate()));button.type="button";button.classList.toggle("today",key===current);
      button.setAttribute("aria-label","Show "+label(key,{weekday:"long",month:"long",day:"numeric",year:"numeric"}));button.onclick=function(){view="day";select(key);};cell.appendChild(button);
      var items=events.filter(function(event){return onDay(event,key);});
      items.slice(0,3).forEach(function(event){cell.appendChild(eventButton(event,"calendar-event",true));});
      if(items.length>3){
        var more=node("button","calendar-more","+"+(items.length-3)+" more");more.type="button";more.onclick=function(){view="day";select(key);};cell.appendChild(more);
      }
      container.appendChild(cell);
    });return container;
  }
  function layoutTimed(events,key){
    var items=events.filter(function(event){return !event.allDay&&onDay(event,key);}).map(function(event){
      var start=eventStart(event)<key?0:minutes(event.start);
      var end=event.end?(dayKey(event.end)>key?1440:minutes(event.end)):Math.min(1440,start+60);
      return {event:event,start:start,end:Math.max(start+1,end),visualEnd:Math.max(start+20,end),lane:0,lanes:1};
    }).sort(function(a,b){return a.start-b.start||b.end-a.end;});
    var group=[],ends=[];
    function finish(){group.forEach(function(item){item.lanes=ends.length;});group=[];ends=[];}
    items.forEach(function(item){
      if(group.length&&ends.every(function(end){return end<=item.start;}))finish();
      var lane=ends.findIndex(function(end){return end<=item.start;});if(lane<0)lane=ends.length;
      item.lane=lane;ends[lane]=item.visualEnd;group.push(item);
    });finish();return items;
  }
  function renderTime(events,days){
    var container=node("div","calendar-time"+(view==="day"?" day-view":""));container.style.setProperty("--day-count",days.length);
    var header=node("div","calendar-time-head");header.appendChild(node("div","calendar-time-day",""));
    days.forEach(function(key){
      var heading=node("div","calendar-time-day");heading.classList.toggle("today",key===today());
      heading.appendChild(node("span","",label(key,{weekday:"short"})));heading.appendChild(node("span","calendar-day-number",String(date(key).getUTCDate())));header.appendChild(heading);
    });container.appendChild(header);
    var allDay=node("div","calendar-all-day");allDay.appendChild(node("div","calendar-all-day-label","All day"));
    days.forEach(function(key){
      var cell=node("div","calendar-all-day-cell");
      events.filter(function(event){return event.allDay&&onDay(event,key);}).forEach(function(event){cell.appendChild(eventButton(event));});
      allDay.appendChild(cell);
    });container.appendChild(allDay);
    var body=node("div","calendar-time-body"),hours=node("div","calendar-hours");
    for(var hour=1;hour<24;hour++){var mark=node("span","calendar-hour",String(hour).padStart(2,"0")+":00");mark.style.top=hour*60+"px";hours.appendChild(mark);}body.appendChild(hours);
    days.forEach(function(key){
      var column=node("div","calendar-time-column");column.dataset.date=key;
      layoutTimed(events,key).forEach(function(item){
        var button=eventButton(item.event,"calendar-event calendar-time-event",true);
        button.style.top=item.start+"px";button.style.height=Math.min(1440-item.start,Math.max(20,item.end-item.start))+"px";
        button.style.left="calc("+item.lane/item.lanes*100+"% + 2px)";button.style.width="calc("+100/item.lanes+"% - 4px)";column.appendChild(button);
      });
      if(key===today()){var line=node("div","calendar-now");line.style.top=minutes(new Date())+"px";column.appendChild(line);}
      body.appendChild(column);
    });container.appendChild(body);return container;
  }
  function render(scroll){
    var days=daysForView(),events=filtered();
    $("cal-week-label").textContent=view==="month"?label(selected,{month:"long",year:"numeric"}):view==="day"?label(selected,{weekday:"long",month:"short",day:"numeric",year:"numeric"}):label(days[0],{month:"short",day:"numeric"})+" – "+label(days[6],{month:"short",day:"numeric",year:"numeric"});
    $("cal-timezone").textContent=zone;
    document.querySelectorAll("[data-cal-view]").forEach(function(button){button.setAttribute("aria-pressed",String(button.dataset.calView===view));});
    renderMini(events);renderSources();renderAgenda(events,days);
    var grid=$("cal-week-grid"),position=grid.scrollTop;
    grid.replaceChildren(view==="month"?renderMonth(events,days):renderTime(events,days));
    if(scroll&&view!=="month")grid.scrollTop=480;else grid.scrollTop=position;
  }
  function load(){
    var revision=++request,days=daysForView();
    $("calendar-status-full").textContent="Loading calendars…";$("calendar-status-full").className="dim";
    $("cal-refresh").disabled=true;
    return api("/api/calendar?start="+shift(days[0],-2)+"&end="+shift(days[days.length-1],3)).then(function(data){
      if(revision!==request)return;
      snapshot=data;loaded=true;
      if(data.timezone&&data.timezone!==zone){zone=data.timezone;selected=today();miniMonth=selected.slice(0,7)+"-01";return load();}
      var bad=data.feeds.filter(function(feed){return !feed.ok;});
      $("calendar-status-full").textContent=!data.configured?"No calendars connected. Open Settings > Calendars to add one.":bad.length===data.feeds.length&&bad.length?"Calendars unavailable. Check feed settings and refresh.":(bad.length?bad.length+" calendar(s) unavailable · showing available events":"Calendars up to date")+(data.truncated?" · Results limited to 2,000 events; switch to a shorter view.":"");
      $("calendar-status-full").className=bad.length?"bad":"dim";
      render(true);
    }).catch(function(error){
      if(revision!==request)return;
      $("calendar-status-full").textContent="Could not refresh calendars: "+error.message+(loaded?" · Showing previously loaded events.":"");
      $("calendar-status-full").className="bad";
    }).finally(function(){if(revision===request)$("cal-refresh").disabled=false;});
  }
  $("cal-prev").onclick=function(){selected=view==="month"?monthShift(selected,-1):shift(selected,view==="week"?-7:-1);miniMonth=selected.slice(0,7)+"-01";load();};
  $("cal-next").onclick=function(){selected=view==="month"?monthShift(selected,1):shift(selected,view==="week"?7:1);miniMonth=selected.slice(0,7)+"-01";load();};
  $("cal-today").onclick=function(){select(today());};
  $("cal-refresh").onclick=function(){load();};
  $("cal-mini-prev").onclick=function(){miniMonth=monthShift(miniMonth,-1);renderMini(filtered());};
  $("cal-mini-next").onclick=function(){miniMonth=monthShift(miniMonth,1);renderMini(filtered());};
  $("cal-search").oninput=function(){render();};
  $("cal-event-close").onclick=function(){$("cal-event-dialog").close();};
  document.querySelectorAll("[data-cal-view]").forEach(function(button){button.onclick=function(){view=button.dataset.calView;load();};});
  selected=today();miniMonth=selected.slice(0,7)+"-01";render();
  window.viewPreferencesReady.then(function(prefs){
    weekStartsOn=prefs&&prefs.calendar&&prefs.calendar.weekStartsOn==="sunday"?0:1;return load();
  }).catch(function(error){$("calendar-status-full").textContent="Could not initialize calendar: "+error.message;$("calendar-status-full").className="bad";});
})();
`;
