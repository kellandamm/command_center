import type { NavLink } from "./layout";
import { workspacePage } from "./workspace";

export function assistantPage(nav?: NavLink[]): string {
  return workspacePage({
    title: "Assistant", description: "Ask a question and get an answer cited from your own notes and saved pages.",
    active: "/assistant", nav,
    body: `<form id="ask-form" class="workspace-form"><label for="ask-scope">Ask about</label><select id="ask-scope"></select>
<label for="ask-question">Question</label><textarea id="ask-question" required maxlength="2000" placeholder="What should I know about this?"></textarea>
<label id="ask-meetings-wrap" class="row" style="display:none"><input id="ask-meetings" type="checkbox"> Include sensitive meeting transcripts (owner only)</label>
<button type="submit">Ask</button></form>
<section aria-live="polite"><div id="ask-answer" class="workspace-answer"></div><div id="ask-citations" class="workspace-citations"></div></section>`,
    script: `
var params=new URLSearchParams(location.search);
var askOwner=false;
async function setup(){
  var caps=await api("/api/state").catch(function(){return {};});
  askOwner=!!caps.owner;
  $("ask-meetings-wrap").style.display=askOwner?"flex":"none";
  var d=await api("/api/knowledge"),select=$("ask-scope");
  select.add(new Option("Everything I have saved",""));
  d.spaces.forEach(function(s){select.add(new Option("Space: "+s.name,"space:"+s.id));});
  d.sources.forEach(function(s){select.add(new Option("Page: "+s.title,"source:"+s.id));});
  var wanted=params.get("source")?"source:"+params.get("source"):params.get("space")?"space:"+params.get("space"):"";
  select.value=wanted;
}
function citationItem(c){
  if(c.url&&c.url.indexOf("/notes?note=")===0)return appLink("["+c.number+"] "+c.title,c.url);
  var link=safeLink(c.url||"");var item=link?appLink("["+c.number+"] "+c.title,link):element("span","["+c.number+"] "+c.title);
  if(link){item.target="_blank";item.rel="noopener noreferrer";}
  return item;
}
$("ask-form").onsubmit=function(e){e.preventDefault();busy(e.submitter,async function(){
  message("Reading your material…");$("ask-answer").textContent="";$("ask-citations").replaceChildren();
  var scope=$("ask-scope").value,body={question:$("ask-question").value};
  if(scope.indexOf("space:")===0)body.spaceId=scope.slice(6);else if(scope.indexOf("source:")===0)body.sourceId=scope.slice(7);
  if(askOwner&&$("ask-meetings").checked)body.includeSensitiveMeetings=true;
  var r=await api("/api/knowledge/ask","POST",body);
  $("ask-answer").textContent=r.answer;message("");
  r.citations.forEach(function(c){$("ask-citations").append(citationItem(c));});
});};
setup().catch(fail);`,
  });
}
