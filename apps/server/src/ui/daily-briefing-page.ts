import type { NavLink } from "./layout";
import { page } from "./layout";

export function dailyBriefingPage(nav?: NavLink[]): string {
  return page({
    title: "Daily Briefing - Command center",
    active: "/briefing",
    nav,
    body: `<main class="morning-briefing">
  <header class="morning-masthead">
    <h1>The Morning Briefing</h1>
    <p class="morning-deck">Your topics, weather, and schedule for the day ahead.</p>
  </header>
  <div class="morning-edition">
    <label><span class="visually-hidden">Briefing day</span><select id="db-day" aria-label="Briefing day"></select></label>
    <a href="/settings#topics">Manage topics</a>
    <div class="morning-edition-actions"><span id="db-meta" class="dim"></span><button type="button" id="db-refresh" class="ghost">Refresh edition</button></div>
  </div>
  <div id="db-error" class="morning-error" role="status" hidden></div>
  <div class="briefing-grid" id="db-sections">
    <section class="briefing-section briefing-topics" id="db-topics"><div class="section-head"><h2>Your topics</h2><span class="status-pill dim" id="db-topics-status">Loading</span></div>
      <p class="dim">Web results from the past 24 hours, summarized from search excerpts. Follow the sources for the full story.</p><div id="db-topics-body" aria-live="polite"></div></section>
    <aside class="briefing-rail" aria-label="Your day">
      <section class="briefing-section briefing-rail-card" id="db-calendar"><div class="section-head"><h2>Your day</h2><span class="status-pill dim" id="db-calendar-status">Loading</span></div><div id="db-calendar-body"></div></section>
      <section class="briefing-section briefing-rail-card" id="db-weather"><div class="section-head"><h2>The almanac</h2><span class="status-pill dim" id="db-weather-status">Loading</span></div><div id="db-weather-body"></div></section>
    </aside>
  </div>
</main>`,
    script: `
function pill(el,status){
  el.textContent=status.replace("_"," ");
  el.className="status-pill "+(status==="ok"?"ok":status==="error"?"bad":"dim");
}
function briefingError(message){
  var el=document.getElementById("db-error");el.textContent=message;el.hidden=!message;
}
function renderWeather(s){
  pill(document.getElementById("db-weather-status"),s.status);
  var body=document.getElementById("db-weather-body"),w=s.data&&s.data.weather;
  if(!w){body.innerHTML='<p class="dim">'+esc(s.message||"No weather data.")+'</p>';return}
  body.innerHTML='<p>'+esc(w.label)+' · '+esc(String(w.current.temperatureC))+'°C</p>'
    +'<p class="dim">High '+esc(String(w.today.highC))+'° / Low '+esc(String(w.today.lowC))+'°</p>';
}
function renderCalendar(s){
  pill(document.getElementById("db-calendar-status"),s.status);
  var body=document.getElementById("db-calendar-body"),events=(s.data&&s.data.events)||[];
  var message=s.message?'<p class="'+(s.status==="error"?"bad":"dim")+'">'+esc(s.message)+'</p>':"";
  if(!events.length){body.innerHTML=message||'<p class="dim">No upcoming events.</p>';return}
  body.innerHTML=message+'<ul>'+events.slice(0,5).map(function(ev){
    var when=ev.allDay?ev.start.slice(0,10)+" (all day)":new Date(ev.start).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
    return '<li><strong>'+esc(ev.summary)+'</strong><br><span class="dim">'+esc(when)+'</span></li>';
  }).join("")+'</ul>';
}
function safeArticleUrl(value){
  try{var u=new URL(value);return (u.protocol==="https:"||u.protocol==="http:")&&!u.username&&!u.password?u.href:null}catch(e){return null}
}
function renderTopics(s){
  pill(document.getElementById("db-topics-status"),s.status);
  var body=document.getElementById("db-topics-body"),items=s.data&&s.data.items||[];
  if(!items.length){
    body.innerHTML='<p class="'+(s.status==="error"?"bad":"dim")+'">'+esc(s.message||"No topic results in this edition.")+'</p><p><a href="/settings#topics">Set up briefing topics</a></p>';return;
  }
  body.innerHTML=items.map(function(item){
    return '<article class="briefing-topic"><div class="section-head"><h3>'+esc(item.keyword)+'</h3><span class="dim">'+esc(item.status.replace("_"," "))+'</span></div>'
      +(item.summary?'<p class="topic-summary">'+esc(item.summary)+'</p>':"")
      +(item.message?'<p class="'+(item.status==="error"?"bad":"dim")+'">'+esc(item.message)+'</p>':"")
      +'<ol class="topic-sources">'+(item.articles||[]).map(function(a){
        var url=safeArticleUrl(a.url);
        return '<li>'+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(a.title)+'</a>':esc(a.title))+'</li>';
      }).join("")+'</ol></article>';
  }).join("");
}
function renderBriefing(b){
  var meta=document.getElementById("db-meta");briefingError("");
  if(!b){
    meta.textContent="No edition for this day yet. Refresh edition to generate today's briefing.";
    renderWeather({status:"empty",message:"Generate an edition to load weather."});
    renderCalendar({status:"empty",message:"Generate an edition to load your calendar."});
    renderTopics({status:"empty",message:"Generate an edition to look up your saved keywords."});return;
  }
  meta.textContent="Generated "+new Date(b.generatedAt).toLocaleString()+" · "+b.trigger;
  var src=b.sources||{};
  renderWeather(src.weather||{status:"error",message:"Missing weather section"});
  renderCalendar(src.calendar||{status:"error",message:"Missing calendar section"});
  renderTopics(src.topics||{status:"not_configured",message:"This edition predates keyword briefings. Add topics in Settings and refresh today's edition."});
}
function loadDayOptions(days,selected){
  var sel=document.getElementById("db-day"),opts=Array.from(new Set([selected].concat(days))).sort().reverse();
  sel.innerHTML=opts.map(function(d){
    var label=new Date(d+"T12:00:00").toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric",year:"numeric"});
    return '<option value="'+esc(d)+'"'+(d===selected?" selected":"")+'>'+esc(label)+'</option>';
  }).join("");
}
var loadVersion=0;
function loadBriefing(day){
  var version=++loadVersion;
  document.getElementById("db-meta").textContent="Loading edition...";
  return api("/api/daily-briefing?day="+encodeURIComponent(day)).then(function(r){if(version===loadVersion)renderBriefing(r.briefing)}).catch(function(err){if(version===loadVersion)briefingError(err.message||"Could not load this edition.")});
}
function initDays(){
  return Promise.all([api("/api/daily-briefing/days"),api("/api/daily-briefing")]).then(function(results){
    loadDayOptions(results[0].days||[],results[1].day);
    renderBriefing(results[1].briefing);
  }).catch(function(err){briefingError(err.message||"Could not load briefing dates.")});
}
document.getElementById("db-day").onchange=function(){loadBriefing(this.value)};
var refreshBtn=document.getElementById("db-refresh");
function waitForEdition(day){
  return api("/api/daily-briefing/refresh?day="+encodeURIComponent(day)).then(function(r){
    if(r.status==="error")throw new Error(r.message||"Could not generate the briefing.");
    if(r.status==="generating")return new Promise(function(resolve){setTimeout(resolve,2000)}).then(function(){return waitForEdition(day)});
    return api("/api/daily-briefing?day="+encodeURIComponent(day)).then(function(r){
      if(!r.briefing)throw new Error("The refresh ended without saving an edition. Please retry.");
      return r.briefing;
    });
  });
}
refreshBtn.onclick=function(){
  ++loadVersion;refreshBtn.disabled=true;document.getElementById("db-day").disabled=true;
  refreshBtn.textContent="Looking up topics...";briefingError("");
  api("/api/daily-briefing/refresh","POST",{}).then(function(r){return waitForEdition(r.day)}).then(function(briefing){
    renderBriefing(briefing);
    loadDayOptions(Array.from(document.getElementById("db-day").options).map(function(o){return o.value}),briefing.day);
  }).catch(function(err){briefingError(err.message||"Could not refresh the briefing.")}).finally(function(){
    refreshBtn.disabled=false;refreshBtn.textContent="Refresh edition";document.getElementById("db-day").disabled=false;
  });
};
window.viewPreferencesReady.then(function(prefs){
  var sections=prefs&&prefs.briefing||{};
  ["weather","calendar","topics"].forEach(function(key){if(sections[key]===false)document.getElementById("db-"+key).hidden=true});
});
initDays();
`,
  });
}
