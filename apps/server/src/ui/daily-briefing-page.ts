import { page } from "./layout";

export function dailyBriefingPage(): string {
  return page({
    title: "Daily Briefing — Command center",
    active: "/briefing",
    body: `<header class="page-header">
  <h1>Daily Briefing</h1>
  <p class="dim">One snapshot per day — news, AI summary, tasks, weather, calendar, and GitHub.</p>
</header>
<div class="briefing-toolbar">
  <label class="dim" style="margin:0;display:flex;align-items:center;gap:.5rem;font-weight:500">
    <span>Day</span>
    <select id="db-day" aria-label="Briefing day"></select>
  </label>
  <button type="button" id="db-refresh">Refresh briefing</button>
  <span class="dim" id="db-meta"></span>
</div>
<div class="briefing-grid" id="db-sections">
  <section class="card briefing-section" id="db-news"><div class="section-head"><h2>News feeds</h2><span class="status-pill dim" id="db-news-status">…</span></div><div id="db-news-body"></div></section>
  <section class="card briefing-section" id="db-ai"><div class="section-head"><h2>AI briefing</h2><span class="status-pill dim" id="db-ai-status">…</span></div><pre class="briefing" id="db-ai-body"></pre></section>
  <section class="card briefing-section" id="db-todoist"><div class="section-head"><h2>Todoist</h2><span class="status-pill dim" id="db-todoist-status">…</span></div><div id="db-todoist-body"></div></section>
  <section class="card briefing-section" id="db-weather"><div class="section-head"><h2>Weather</h2><span class="status-pill dim" id="db-weather-status">…</span></div><div id="db-weather-body"></div></section>
  <section class="card briefing-section" id="db-calendar"><div class="section-head"><h2>Calendar</h2><span class="status-pill dim" id="db-calendar-status">…</span></div><div id="db-calendar-body"></div></section>
  <section class="card briefing-section" id="db-github"><div class="section-head"><h2>GitHub</h2><span class="status-pill dim" id="db-github-status">…</span></div><div id="db-github-body"></div></section>
</div>`,
    script: dailyBriefingScript(),
  });
}

function dailyBriefingScript(): string {
  return `
var dbCurrentDay=null;
function pill(el,status,label){
  el.textContent=label||status.replace("_"," ");
  el.className="status-pill "+(status==="ok"?"ok":status==="error"?"bad":"dim");
}
function setMsg(id,msg){document.getElementById(id).innerHTML='<p class="dim">'+esc(msg)+'</p>'}
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
  body.innerHTML=items.map(function(it){
    return '<div class="feed-item"><strong>'+(it.link?'<a href="'+esc(it.link)+'" target="_blank" rel="noopener">'+esc(it.title)+'</a>':esc(it.title))+'</strong>'
      +(it.summary?'<p class="dim" style="margin:.25em 0 0">'+esc(it.summary.slice(0,200))+'</p>':'')+'</div>';
  }).join("");
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
  if(s.status==="error"){body.innerHTML='<p class="bad">'+esc(s.message||"Error")+'</p>';return}
  var w=s.data&&s.data.weather;
  if(!w){body.innerHTML='<p class="dim">No data.</p>';return}
  body.innerHTML='<p style="font-size:1.25rem;font-weight:600;margin:0">'+esc(w.label)+'</p>'
    +'<p class="dim" style="margin:.35em 0 0">Now '+esc(String(w.current.temperatureC))+'°C · High '+esc(String(w.today.highC))+'° / Low '+esc(String(w.today.lowC))+'°</p>';
}
function renderCalendar(s){
  pill(document.getElementById("db-calendar-status"),s.status);
  var body=document.getElementById("db-calendar-body");
  if(s.status==="not_configured"){body.innerHTML='<p class="dim">'+esc(s.message||"Not configured.")+'</p>';return}
  var events=(s.data&&s.data.events)||[];
  if(!events.length){body.innerHTML='<p class="dim">'+esc(s.message||"No events.")+'</p>';return}
  body.innerHTML='<ul style="margin:0;padding-left:1.2rem">'+events.map(function(ev){
    return '<li><strong>'+esc(ev.summary)+'</strong> · '+esc(fmtEventWhen(ev))+'</li>';
  }).join("")+'</ul>';
}
function renderGithub(s){
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
  if(!b){meta.textContent="No briefing stored for this day yet — use Refresh briefing.";renderNews({status:"empty",message:"Generate a briefing to load feed highlights."});
    renderAi({status:"not_configured",message:"Generate a briefing to build the AI summary."});
    renderTodoist({status:"not_configured",message:"Generate a briefing to load tasks."});
    renderWeather({status:"empty",message:"Generate a briefing to load weather."});
    renderCalendar({status:"not_configured",message:"Generate a briefing to load calendar."});
    renderGithub({status:"empty",message:"Generate a briefing to load GitHub."});
    return;}
  meta.textContent="Generated "+fmtWhen(b.generatedAt)+" · "+b.trigger;
  var src=b.sources||{};
  renderNews(src.news||{status:"error",message:"Missing news section"});
  renderAi(src.ai||{status:"error",message:"Missing AI section"});
  renderTodoist(src.todoist||{status:"error",message:"Missing Todoist section"});
  renderWeather(src.weather||{status:"error",message:"Missing weather section"});
  renderCalendar(src.calendar||{status:"error",message:"Missing calendar section"});
  renderGithub(src.github||{status:"error",message:"Missing GitHub section"});
}
function loadDayOptions(days,selected){
  var sel=document.getElementById("db-day");
  var opts=days.length?days:[selected];
  sel.innerHTML=opts.map(function(d){return '<option value="'+esc(d)+'"'+(d===selected?" selected":"")+'>'+esc(d)+'</option>'}).join("");
}
function loadBriefing(day){
  dbCurrentDay=day;
  return api("/api/daily-briefing?day="+encodeURIComponent(day)).then(function(r){renderBriefing(r.briefing)})
}
function initDays(){
  return api("/api/daily-briefing/days").then(function(r){
    var days=r.days||[];
    var today=days[0]||new Date().toISOString().slice(0,10);
    loadDayOptions(days,today);
    return loadBriefing(document.getElementById("db-day").value||today);
  });
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
  }).finally(function(){refreshBtn.disabled=false});
};
initDays();
`;
}
