import type { NavLink } from "./layout";
import { page } from "./layout";

export function dailyBriefingPage(nav?: NavLink[]): string {
  return page({
    title: "Daily Briefing — Command center",
    active: "/briefing",
    nav,
    body: `<main class="morning-briefing">
  <header class="morning-masthead">
    <div class="morning-kicker"><span>YOUR PERSONAL EDITION</span><span>THE DAILY READ</span><span>ONE OPEN TAB</span></div>
    <h1>The Morning Briefing</h1>
    <p class="morning-deck">A considered look at your corner of the internet.</p>
  </header>
  <div class="morning-edition">
    <label><span class="visually-hidden">Briefing day</span><select id="db-day" aria-label="Briefing day"></select></label>
    <span class="morning-edition-label">Morning edition</span>
    <div class="morning-edition-actions"><span id="db-meta" class="dim"></span><button type="button" id="db-refresh" class="ghost">Refresh edition</button></div>
  </div>
  <div id="db-error" class="morning-error" role="status" hidden></div>
  <div class="briefing-grid" id="db-sections">
    <section class="briefing-section briefing-news" id="db-news">
      <div class="section-head"><div><p class="briefing-kicker">FROM YOUR FEEDS</p><h2>Stories worth your time</h2></div><span class="status-pill dim" id="db-news-status">…</span></div>
      <div id="db-news-body"></div>
    </section>
    <section class="briefing-section briefing-ai" id="db-ai">
      <div class="section-head"><div><p class="briefing-kicker">THE EDITOR'S NOTE</p><h2>What matters today</h2></div><span class="status-pill dim" id="db-ai-status">…</span></div>
      <pre class="briefing" id="db-ai-body"></pre>
    </section>
    <aside class="briefing-rail" aria-label="Your day">
      <section class="briefing-section briefing-rail-card" id="db-calendar"><div class="section-head"><h2>Your day</h2><span class="status-pill dim" id="db-calendar-status">…</span></div><div id="db-calendar-body"></div></section>
      <section class="briefing-section briefing-rail-card" id="db-weather"><div class="section-head"><h2>The almanac</h2><span class="status-pill dim" id="db-weather-status">…</span></div><div id="db-weather-body"></div></section>
      <section class="briefing-section briefing-rail-card" id="db-todoist"><div class="section-head"><h2>On your list</h2><span class="status-pill dim" id="db-todoist-status">…</span></div><div id="db-todoist-body"></div></section>
    </aside>
    <section class="briefing-section briefing-github" id="db-github"><div class="section-head"><div><p class="briefing-kicker">FROM THE WORKBENCH</p><h2>GitHub dispatches</h2></div><span class="status-pill dim" id="db-github-status">…</span></div><div id="db-github-body"></div></section>
    <section class="briefing-section briefing-board" id="db-board-blocked"><div class="section-head"><h2>Blocked on me</h2><span class="status-pill dim" id="db-board-blocked-status">…</span></div><div id="db-board-blocked-body"></div></section>
    <section class="briefing-section briefing-board" id="db-board-moved"><div class="section-head"><h2>Moved since yesterday</h2><span class="status-pill dim" id="db-board-moved-status">…</span></div><div id="db-board-moved-body"></div></section>
    <section class="briefing-section briefing-board" id="db-board-wins"><div class="section-head"><h2>Yesterday's wins</h2><span class="status-pill dim" id="db-board-wins-status">…</span></div><div id="db-board-wins-body"></div></section>
  </div>
</main>`,
    script: dailyBriefingScript(),
  });
}

function dailyBriefingScript(): string {
  return `
function pill(el,status,label){
  el.textContent=label||status.replace("_"," ");
  el.className="status-pill "+(status==="ok"?"ok":status==="error"?"bad":"dim");
}
function briefingError(message){
  var el=document.getElementById("db-error");
  el.textContent=message;
  el.hidden=!message;
}
function fmtWhen(iso){
  if(!iso)return "";
  try{return new Date(iso).toLocaleString()}catch(e){return iso}
}
function fmtEventWhen(ev){
  if(ev.allDay)return ev.start.slice(0,10)+" (all day)";
  return new Date(ev.start).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
}
function renderNews(s){
  pill(document.getElementById("db-news-status"),s.status);
  var body=document.getElementById("db-news-body");
  if(s.status==="not_configured"||s.status==="error"){body.innerHTML='<p class="bad">'+esc(s.message||"Unavailable")+'</p>';return}
  var items=(s.data&&s.data.items)||[];
  if(!items.length){body.innerHTML='<p class="dim">'+esc(s.message||"No items.")+'</p>';return}
  var stories=items.slice(0,8);
  body.innerHTML=stories.map(function(it,index){
    return '<article class="briefing-story'+(index===0?" featured":"")+'"><h3>'+(it.link?'<a href="'+esc(it.link)+'" target="_blank" rel="noopener">'+esc(it.title)+'</a>':esc(it.title))+'</h3>'
      +(it.summary?'<p>'+esc(it.summary.slice(0,index===0?420:240))+(it.summary.length>(index===0?420:240)?"…":"")+'</p>':'')+'</article>';
  }).join("")+(items.length>stories.length?'<p><a href="/news">Read all stories in News →</a></p>':"");
}
function renderAi(s){
  pill(document.getElementById("db-ai-status"),s.status);
  var pre=document.getElementById("db-ai-body");
  pre.classList.remove("bad");
  if(s.status==="not_configured"){pre.textContent=s.message||"Not configured.";return}
  if(s.status==="error"){pre.textContent=s.message||"Error";pre.classList.add("bad");return}
  if(s.status==="empty"){pre.textContent=s.message||"Nothing to summarize.";return}
  pre.textContent=(s.data&&s.data.content)||"";
}
function renderTodoist(s){
  pill(document.getElementById("db-todoist-status"),s.status);
  var body=document.getElementById("db-todoist-body");
  if(s.status==="not_configured"){body.innerHTML='<p class="dim">'+esc(s.message||"Not configured.")+'</p>';return}
  if(s.status==="error"){body.innerHTML='<p class="bad">'+esc(s.message||"Error")+'</p>';return}
  var overdue=(s.data&&s.data.overdue)||[], today=(s.data&&s.data.today)||[];
  if(!overdue.length&&!today.length){body.innerHTML='<p class="dim">'+esc(s.message||"No tasks.")+'</p>';return}
  function rows(list,title){
    if(!list.length)return "";
    return '<h3 class="dim" style="font-size:.85rem;margin:.5em 0 .25em">'+esc(title)+'</h3><ul class="todoist-list">'
      +list.map(function(t){return '<li class="todoist-item">'+esc(t.content)+'</li>'}).join("")+'</ul>';
  }
  body.innerHTML=rows(overdue,"Overdue")+rows(today,"Today");
}
function renderWeather(s){
  pill(document.getElementById("db-weather-status"),s.status);
  var body=document.getElementById("db-weather-body");
  if(s.status==="error"||s.status==="not_configured"){body.innerHTML='<p class="dim">'+esc(s.message||"Unavailable")+'</p>';return}
  var w=s.data&&s.data.weather;
  if(!w){body.innerHTML='<p class="dim">'+esc(s.message||"No weather data.")+'</p>';return}
  body.innerHTML='<p>'+esc(w.label)+' · '+esc(String(w.current.temperatureC))+'°C</p>'
    +'<p class="dim">High '+esc(String(w.today.highC))+'° / Low '+esc(String(w.today.lowC))+'°</p>';
}
function renderCalendar(s){
  pill(document.getElementById("db-calendar-status"),s.status);
  var body=document.getElementById("db-calendar-body");
  if(s.status==="not_configured"){body.innerHTML='<p class="dim">'+esc(s.message||"Not configured.")+'</p>';return}
  var events=(s.data&&s.data.events)||[];
  if(!events.length){body.innerHTML='<p class="dim">'+esc(s.message||"No events.")+'</p>';return}
  body.innerHTML='<ul>'+events.slice(0,5).map(function(ev){
    return '<li><strong>'+esc(ev.summary)+'</strong><br><span class="dim">'+esc(fmtEventWhen(ev))+'</span></li>';
  }).join("")+'</ul>';
}
function renderBoardSection(statusId,bodyId,s,renderFn){
  pill(document.getElementById(statusId),s.status);
  var body=document.getElementById(bodyId);
  if(s.status==="not_configured"||s.status==="error"){body.innerHTML='<p class="dim">'+esc(s.message||"Unavailable")+'</p>';return}
  if(s.status==="empty"){body.innerHTML='<p class="dim">'+esc(s.message||"Nothing here.")+'</p>';return}
  body.innerHTML=renderFn(s.data||{});
}
function renderBoardBlocked(s){renderBoardSection("db-board-blocked-status","db-board-blocked-body",s,function(d){
  var rows=d.blocked||[];
  if(!rows.length)return '<p class="dim">No blockers.</p>';
  return '<ul class="todoist-list">'+rows.map(function(c){return '<li class="todoist-item">'+esc(c.title)+'</li>'}).join("")+'</ul>';
})}
function renderBoardMoved(s){renderBoardSection("db-board-moved-status","db-board-moved-body",s,function(d){
  var rows=d.moved||[];
  if(!rows.length)return '<p class="dim">No moves in the last 24 hours.</p>';
  return '<ul>'+rows.slice(0,12).map(function(m){
    return '<li><strong>'+esc(m.title)+'</strong> <span class="dim">'+esc(m.fromCol||"new")+' → '+esc(m.toCol)+'</span></li>';
  }).join("")+'</ul>';
})}
function renderBoardWins(s){renderBoardSection("db-board-wins-status","db-board-wins-body",s,function(d){
  var rows=d.wins||[];
  if(!rows.length)return '<p class="dim">No wins yesterday.</p>';
  return '<ul>'+rows.map(function(w){return '<li>'+esc(w.title)+'</li>'}).join("")+'</ul>';
})}
function renderGithub(s){
  var section=document.getElementById("db-github");
  if(s.status==="not_configured"){section.hidden=true;return;}
  section.hidden=false;
  pill(document.getElementById("db-github-status"),s.status);
  var body=document.getElementById("db-github-body");
  if(s.status==="error"){body.innerHTML='<p class="bad">'+esc(s.message||"Error")+'</p>';return}
  var a=s.data&&s.data.activity;
  if(!a){body.innerHTML='<p class="dim">'+esc(s.message||"No data.")+'</p>';return}
  if(s.status==="empty"){body.innerHTML='<p class="dim">'+esc(s.message||"Quiet day on GitHub.")+'</p>';return}
  function list(title,rows){
    if(!rows||!rows.length)return "";
    return '<h3 class="dim" style="font-size:.85rem;margin:.6em 0 .25em">'+esc(title)+'</h3>'
      +rows.slice(0,5).map(function(r){
        return '<div class="feed-item"><a href="'+esc(r.url)+'" target="_blank" rel="noopener">'+esc(r.title)+'</a></div>';
      }).join("");
  }
  body.innerHTML='<p class="dim">@'+esc(a.username)+' · updated '+esc(fmtWhen(a.fetchedAt))+'</p>'
    +list("Open PRs",a.pulls)+list("Open issues",a.issues)+list("Recent activity",a.events);
}
function renderBriefing(b){
  var meta=document.getElementById("db-meta");
  briefingError("");
  if(!b){meta.textContent="No briefing stored for this day yet — use Refresh briefing.";renderNews({status:"empty",message:"Generate a briefing to load feed highlights."});
    renderAi({status:"not_configured",message:"Generate a briefing to build the AI summary."});
    renderTodoist({status:"not_configured",message:"Generate a briefing to load tasks."});
    renderWeather({status:"empty",message:"Generate a briefing to load weather."});
    renderCalendar({status:"not_configured",message:"Generate a briefing to load calendar."});
    renderGithub({status:"empty",message:"Generate a briefing to load GitHub."});
    renderBoardBlocked({status:"empty",message:"Generate a briefing to load board sections."});
    renderBoardMoved({status:"empty",message:"Generate a briefing to load board sections."});
    renderBoardWins({status:"empty",message:"Generate a briefing to load board sections."});
    return;}
  meta.textContent="Generated "+fmtWhen(b.generatedAt)+" · "+b.trigger;
  var src=b.sources||{};
  renderNews(src.news||{status:"error",message:"Missing news section"});
  renderAi(src.ai||{status:"error",message:"Missing AI section"});
  renderTodoist(src.todoist||{status:"error",message:"Missing Todoist section"});
  renderWeather(src.weather||{status:"error",message:"Missing weather section"});
  renderCalendar(src.calendar||{status:"error",message:"Missing calendar section"});
  renderGithub(src.github||{status:"error",message:"Missing GitHub section"});
  var board=src.board||{status:"error",message:"Missing board section"};
  renderBoardBlocked(board);
  renderBoardMoved(board);
  renderBoardWins(board);
}
function loadDayOptions(days,selected){
  var sel=document.getElementById("db-day");
  var opts=days.length?days:[selected];
  sel.innerHTML=opts.map(function(d){
    var label=new Date(d+"T12:00:00").toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric",year:"numeric"});
    return '<option value="'+esc(d)+'"'+(d===selected?" selected":"")+'>'+esc(label)+'</option>';
  }).join("");
}
function loadBriefing(day){
  document.getElementById("db-meta").textContent="";
  return api("/api/daily-briefing?day="+encodeURIComponent(day)).then(function(r){renderBriefing(r.briefing)}).catch(function(err){briefingError(err.message||"Could not load this edition.")})
}
function initDays(){
  return api("/api/daily-briefing/days").then(function(r){
    var days=r.days||[];
    var today=days[0]||new Date().toISOString().slice(0,10);
    loadDayOptions(days,today);
    return loadBriefing(document.getElementById("db-day").value||today);
  }).catch(function(err){briefingError(err.message||"Could not load briefing dates.")});
}
document.getElementById("db-day").onchange=function(){loadBriefing(this.value)};
var refreshBtn=document.getElementById("db-refresh");
refreshBtn.onclick=function(){
  refreshBtn.disabled=true;
  api("/api/daily-briefing/refresh","POST",{}).then(function(r){
    return api("/api/daily-briefing/days").then(function(d){
      loadDayOptions(d.days||[],r.briefing.day);
      renderBriefing(r.briefing);
    });
  }).catch(function(err){briefingError(err.message||"Could not refresh the briefing.")}).finally(function(){refreshBtn.disabled=false});
};
window.viewPreferencesReady.then(function(prefs){
  var sections=prefs&&prefs.briefing||{};
  [["news","news"],["ai","ai"],["todoist","todoist"],["weather","weather"],["calendar","calendar"],["github","github"]].forEach(function(pair){
    if(sections[pair[0]]===false)document.getElementById("db-"+pair[1]).hidden=true;
  });
});
initDays();
`;
}
