import type { EditionMeta } from "../store";
import { MODEL_CHOICES } from "@homepage/agent-core";
import { esc, page } from "./layout";

const when = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** The edition lives in a sandboxed iframe (no same-origin, no network). The doc is fetched, then set as srcdoc. */
export function viewerPage(meta: EditionMeta): string {
  return page({
    title: meta.title,
    active: "/",
    fullBleed: true,
    body: `<iframe id="page" title="${esc(meta.title)}" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"></iframe>`,
    script: `fetch("/e/${meta.id}/doc",{headers:{"x-ah":"1"}}).then(function(r){if(!r.ok)throw 0;return r.text()}).then(function(h){document.getElementById("page").srcdoc=h}).catch(function(){document.body.insertAdjacentHTML("afterbegin","<main><p class='bad'>Could not load this edition.</p></main>")});`,
  });
}

export function emptyPage(hasKey: boolean): string {
  return page({
    title: "AI Homepage",
    active: "/",
    body: `<h1>No edition yet</h1>
<div class="card"><p>Your homepage is built by an AI agent from the sources in <a href="/settings">Settings</a>. The first build is manual; after it succeeds the schedule takes over.</p>
${hasKey ? `<button id="go">Build the first edition</button><p id="msg" class="dim"></p>` : `<p class="bad">ANTHROPIC_API_KEY is not set on the server, so builds are disabled.</p>`}</div>`,
    script: `var b=document.getElementById("go");if(b)b.onclick=function(){b.disabled=true;api("/api/build","POST",{}).then(function(){location.href="/status"}).catch(function(e){document.getElementById("msg").textContent=e.message;b.disabled=false})}`,
  });
}

export function archivePage(editions: EditionMeta[], tz: string): string {
  const rows = editions
    .map(
      (e) => `<div class="card"><div class="row"><a href="/e/${e.id}"><strong>${esc(when(e.createdAt, tz))}</strong></a>
<span class="dim">${e.trigger === "schedule" ? "scheduled" : "manual"} · $${e.costUsd.toFixed(2)} · ${esc(e.model.replace("claude-", ""))}</span>
<button class="ghost" style="margin-left:auto" data-del="${e.id}">Delete</button></div>
${e.summary ? `<p class="dim" style="margin:.4em 0 0">${esc(e.summary)}</p>` : ""}</div>`,
    )
    .join("");
  return page({
    title: "Archive",
    active: "/archive",
    body: `<h1>Archive</h1>${rows || '<p class="dim">Nothing here yet.</p>'}`,
    script: `document.querySelectorAll("[data-del]").forEach(function(b){b.onclick=function(){if(confirm("Delete this edition?"))api("/api/editions/"+b.dataset.del+"/delete","POST",{}).then(function(){location.reload()})}})`,
  });
}

export function statusPage(): string {
  return page({
    title: "Status",
    active: "/status",
    body: `<h1>Status</h1><div id="root" class="dim">Loading…</div>`,
    script: `
function money(n){return "$"+n.toFixed(2)}
function pct(a,b){return Math.min(100,Math.round(a/b*100))}
function render(s){
  var b=s.build,sp=s.spend,h="";
  h+='<div class="card"><div class="row"><strong>'+(b.running?"Building… "+(b.phase||""):"Idle")+'</strong>';
  if(b.running){h+='<span class="dim">'+money(b.costUsd)+' of '+money(b.capUsd)+' cap</span><button class="ghost" id="cancel" style="margin-left:auto">Cancel</button>'}
  else{h+='<button id="go" style="margin-left:auto"'+(s.hasKey?"":" disabled")+'>Build now</button>'}
  h+='</div>';
  if(b.running)h+='<div class="bar"><i style="width:'+pct(b.costUsd,b.capUsd)+'%"></i></div>';
  if(!s.hasKey)h+='<p class="bad">ANTHROPIC_API_KEY is not set.</p>';
  if(!b.running&&b.last)h+='<p class="'+(b.last.status==="ok"?"ok":"bad")+'">Last: '+esc(b.last.message)+' ('+money(b.last.costUsd)+')</p>';
  h+='<p id="msg" class="bad"></p></div>';
  h+='<h2>Spend</h2><div class="grid"><div class="card">Today<br><strong>'+money(sp.today)+'</strong> <span class="dim">of '+money(sp.caps.daily)+'</span><div class="bar"><i style="width:'+pct(sp.today,sp.caps.daily)+'%"></i></div></div>'+
   '<div class="card">This month<br><strong>'+money(sp.month)+'</strong> <span class="dim">of '+money(sp.caps.monthly)+'</span><div class="bar"><i style="width:'+pct(sp.month,sp.caps.monthly)+'%"></i></div></div>'+
   '<div class="card">Builds today<br><strong>'+sp.buildsToday+'</strong> <span class="dim">of '+sp.caps.maxBuildsPerDay+'</span></div></div>';
  if(b.log.length)h+='<h2>Log</h2><pre class="log">'+esc(b.log.join("\\n"))+'</pre>';
  h+='<p class="dim">v'+esc(s.version)+' · '+esc(s.tz)+'</p>';
  document.getElementById("root").innerHTML=h;
  var g=document.getElementById("go");if(g)g.onclick=function(){g.disabled=true;api("/api/build","POST",{}).then(poll).catch(function(e){document.getElementById("msg").textContent=e.message;g.disabled=false})};
  var c=document.getElementById("cancel");if(c)c.onclick=function(){api("/api/cancel","POST",{}).then(poll)};
}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function poll(){return api("/api/state").then(render).catch(function(e){document.getElementById("root").textContent=e.message})}
poll();setInterval(poll,3000);`,
  });
}

export function settingsPage(): string {
  const models = MODEL_CHOICES.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join("");
  return page({
    title: "Settings",
    active: "/settings",
    body: `<h1>Settings</h1><form id="f">
<label for="sources">Sources</label>
<textarea id="sources" spellcheck="false"></textarea>
<p class="dim">One per line: <code>hn</code>, <code>hn:best</code>, <code>github:owner/repo</code> (<code>#issues</code>, <code>#pulls</code>), <code>rss:https://…/feed.xml</code>, or a page URL. Add <code>*3</code> to weight 1–5. Public pages only: the server's browser is never signed in to anything.</p>
<div id="srcerr" class="bad"></div>
<label for="instructions">Standing instructions</label><textarea id="instructions" style="min-height:5em;font-family:inherit" placeholder="e.g. I care about Rust, cycling and local news. Keep it calm."></textarea>
<div class="grid"><div><label for="model">Model</label><select id="model">${models}</select></div>
<div><label for="times">Daily build times</label><input id="times" placeholder="06:30, 18:00"></div></div>
<label><input type="checkbox" id="scheduleEnabled" style="width:auto"> Build on a schedule (starts after the first manual build succeeds)</label>
<h2>Spend caps (USD)</h2>
<div class="grid"><div><label for="perBuild">Per build</label><input id="perBuild" type="number" step="0.1" min="0.1"></div>
<div><label for="daily">Per day</label><input id="daily" type="number" step="0.1" min="0.1"></div>
<div><label for="monthly">Per month</label><input id="monthly" type="number" step="1" min="1"></div>
<div><label for="maxBuildsPerDay">Max builds / day</label><input id="maxBuildsPerDay" type="number" min="1" max="100"></div>
<div><label for="keepEditions">Editions to keep</label><input id="keepEditions" type="number" min="1" max="1000"></div></div>
<label for="blockedSites">Never read these hosts (one per line)</label><textarea id="blockedSites" style="min-height:5em"></textarea>
<div class="row" style="margin-top:18px"><button type="submit">Save</button><span id="saved" class="dim"></span></div></form>`,
    script: `
var f=document.getElementById("f"),$=function(i){return document.getElementById(i)};
api("/api/settings").then(function(r){var s=r.settings;
 $("sources").value=s.sources;$("instructions").value=s.instructions;$("model").value=s.model;$("times").value=s.times.join(", ");
 $("scheduleEnabled").checked=s.scheduleEnabled;["perBuild","daily","monthly","maxBuildsPerDay"].forEach(function(k){$(k).value=s.caps[k]});
 $("keepEditions").value=s.keepEditions;$("blockedSites").value=s.blockedSites.join("\\n")});
f.onsubmit=function(e){e.preventDefault();$("saved").textContent="Saving…";$("srcerr").textContent="";
 api("/api/settings","PUT",{sources:$("sources").value,instructions:$("instructions").value,model:$("model").value,
  times:$("times").value.split(/[ ,]+/).filter(Boolean),scheduleEnabled:$("scheduleEnabled").checked,
  caps:{perBuild:$("perBuild").value,daily:$("daily").value,monthly:$("monthly").value,maxBuildsPerDay:$("maxBuildsPerDay").value},
  keepEditions:$("keepEditions").value,blockedSites:$("blockedSites").value})
 .then(function(r){$("saved").textContent="Saved ("+r.sourceCount+" sources)";
  $("srcerr").textContent=(r.sourceErrors||[]).map(function(x){return "Line "+x.line+": "+x.reason}).join("  ·  ")})
 .catch(function(err){$("saved").textContent="";$("srcerr").textContent=err.message})};`,
  });
}

export function extensionPage(hasZip: boolean): string {
  return page({
    title: "Extension",
    active: "/extension",
    body: `<h1>Browser extension</h1>
<div class="card"><p>The original extension builds the homepage <em>locally</em> from your own browsing history, using your own Anthropic key. This server is a separate, always-on alternative; the extension is optional.</p>
${hasZip ? `<p><a class="btn" href="/extension.zip">Download extension.zip</a></p>
<ol><li>Unzip it somewhere permanent.</li><li>Open <code>chrome://extensions</code>, turn on Developer mode.</li><li>Choose “Load unpacked” and select the unzipped folder.</li><li>Open a new tab and paste your Anthropic API key when asked.</li></ol>` : `<p class="dim">This image was built without the extension bundle.</p>`}</div>`,
  });
}
