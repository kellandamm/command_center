import type { NavLink } from "./layout";
import { button, emptyState, field, pageHeader, tabs } from "./components";
import { page } from "./layout";

const VIEW_LINKS = [
  { id: "overview", label: "Overview", href: "/budget" },
  { id: "transactions", label: "Transactions", href: "/budget?view=transactions" },
  { id: "budget", label: "Budget", href: "/budget?view=budget" },
  { id: "accounts", label: "Accounts", href: "/budget?view=accounts" },
  { id: "import", label: "Import", href: "/budget?view=import" },
  { id: "settings", label: "Settings", href: "/budget?view=settings" },
] as const;

function viewTabs(active: string): string {
  return tabs(
    VIEW_LINKS.map((v) => ({ id: v.id, label: v.label, href: v.href })),
    active,
  );
}

export function budgetPage(nav: NavLink[], opts: { owner: boolean; initialView?: string }): string {
  const initialView = opts.initialView ?? "accounts";
  if (!opts.owner) {
    return page({
      title: "Budget",
      active: "/budget",
      nav,
      body: pageHeader({
        title: "Budget",
        description: "Sign in through Cloudflare Access as a configured owner to use Budget.",
      }),
    });
  }

  const comingSoon = emptyState({
    title: "Coming soon",
    description: "Overview, transactions, and monthly budget views ship in the next Budget PR.",
  });

  const accountsEmpty = emptyState({
    title: "No accounts yet",
    description: "Add an account, then import a CSV from your bank.",
    actionHtml: button({ label: "Add account", attrs: { id: "budget-add-account", type: "button" } }),
  });

  const importSection = `<section id="budget-panel-import" class="budget-panel" hidden>
${cardImportWizard()}
</section>`;

  const body = `${pageHeader({ title: "Budget", description: "CSV import and accounts (owner-only)." })}
${viewTabs(initialView === "overview" ? "overview" : initialView)}
<div id="budget-status" class="workspace-status" role="status"></div>
<section id="budget-panel-accounts" class="budget-panel">${accountsEmpty}</section>
<section id="budget-panel-placeholder" class="budget-panel" hidden>${comingSoon}</section>
${importSection}
<script>
(function(){
var params=new URLSearchParams(location.search);
var view=params.get("view")||"accounts";
var panels={overview:"placeholder",transactions:"placeholder",budget:"placeholder",accounts:"accounts",import:"import",settings:"placeholder"};
var active=panels[view]?view:"accounts";
document.querySelectorAll(".ui-tabs a").forEach(function(a){
  var href=a.getAttribute("href")||"";
  var match=href==="/budget"?"overview":(href.split("view=")[1]||"");
  a.setAttribute("aria-current",match===active?"page":"false");
});
["accounts","import","placeholder"].forEach(function(id){
  var el=document.getElementById("budget-panel-"+id);
  if(el)el.hidden=(panels[active]!==id);
});
function api(path,method,body){
  return fetch(path,{method:method||"GET",headers:{"content-type":"application/json","x-ah":"1"},body:body?JSON.stringify(body):undefined}).then(function(r){
    return r.json().then(function(j){if(!r.ok)throw new Error(j.error||("HTTP "+r.status));return j;});
  });
}
function fmt(cents){var n=Number(cents)||0;return (n<0?"-":"")+"$"+(Math.abs(n)/100).toFixed(2);}
function setStatus(msg,bad){var el=document.getElementById("budget-status");el.textContent=msg||"";el.classList.toggle("bad",!!bad);}
var state={accounts:[],preview:null};
function renderAccounts(){
  var box=document.getElementById("budget-panel-accounts");
  if(!state.accounts.length){box.innerHTML=${JSON.stringify(accountsEmpty)};var btn=document.getElementById("budget-add-account");if(btn)btn.onclick=openAccountDialog;return;}
  var rows=state.accounts.map(function(a){
    var bal=a.type==="investment"?(a.currentBalanceCents||0):a.openingBalanceCents;
    var dis=a.type==="investment"?" disabled":"";
    return "<tr><td>"+a.name.replace(/</g,"\\u003c")+"</td><td>"+a.type+"</td><td class='tabular-nums'>"+fmt(bal)+"</td><td><button type='button' class='ghost btn-sm' data-import='"+a.id+"'"+dis+">Import</button></td></tr>";
  }).join("");
  box.innerHTML="<div class='row' style='margin-bottom:1rem'>"+${JSON.stringify(button({ label: "Add account", attrs: { id: "budget-add-account", type: "button" } }))}+"</div><table class='ui-table'><thead><tr><th>Name</th><th>Type</th><th>Balance</th><th></th></tr></thead><tbody>"+rows+"</tbody></table>";
  document.getElementById("budget-add-account").onclick=openAccountDialog;
  box.querySelectorAll("[data-import]").forEach(function(b){b.onclick=function(){location.href="/budget?view=import&account="+b.getAttribute("data-import");};});
}
function openAccountDialog(){
  var name=prompt("Account name"); if(!name)return;
  var type=(prompt("Type: checking, savings, credit, cash, investment","checking")||"checking").trim();
  api("/api/budget/accounts","POST",{name:name,type:type}).then(loadAccounts).catch(function(e){setStatus(e.message,true);});
}
function loadAccounts(){api("/api/budget/accounts").then(function(r){state.accounts=r.accounts;renderAccounts();if(active==="import")fillImportAccounts();}).catch(function(e){setStatus(e.message,true);});}
function fillImportAccounts(){
  var sel=document.getElementById("budget-import-account"); if(!sel)return;
  sel.innerHTML="";
  state.accounts.filter(function(a){return a.type!=="investment";}).forEach(function(a){
    var o=document.createElement("option");o.value=a.id;o.textContent=a.name;sel.appendChild(o);
  });
  var pre=params.get("account"); if(pre)sel.value=pre;
}
function runPreview(){
  var accountId=document.getElementById("budget-import-account").value;
  var file=document.getElementById("budget-import-file").files[0];
  if(!accountId||!file){setStatus("Choose an account and CSV file.",true);return;}
  setStatus("Parsing…");
  fetch("/api/budget/import/preview?accountId="+encodeURIComponent(accountId)+"&fileName="+encodeURIComponent(file.name),{method:"POST",headers:{"content-type":"text/csv","x-ah":"1"},body:file})
  .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||"preview failed");return j;});})
  .then(function(p){
    state.preview=p;
    setStatus("New: "+p.counts.newCount+", duplicates: "+p.counts.duplicateCount+", errors: "+p.counts.errorCount);
    var hint=document.getElementById("budget-invert-hint");
    if(p.suggestInvertSign){hint.hidden=false;document.getElementById("budget-invert-confirm").checked=true;}
    else hint.hidden=true;
    document.getElementById("budget-preview-table").hidden=false;
    document.querySelector("#budget-preview-table tbody").innerHTML=p.sample.map(function(r){
      return "<tr><td>"+r.rowNumber+"</td><td>"+r.date+"</td><td class='tabular-nums'>"+fmt(r.amountCents)+"</td><td>"+(r.payee||"").replace(/</g,"\\u003c")+"</td><td>"+r.status+"</td></tr>";
    }).join("");
  }).catch(function(e){setStatus(e.message,true);});
}
function commitImport(){
  if(!state.preview){setStatus("Run preview first.",true);return;}
  var invert=document.getElementById("budget-invert-confirm").checked;
  api("/api/budget/import/commit","POST",{previewId:state.preview.previewId,invertSign:invert}).then(function(){
    setStatus("Import complete.");state.preview=null;loadAccounts();
  }).catch(function(e){setStatus(e.message,true);});
}
document.getElementById("budget-preview-btn").onclick=runPreview;
document.getElementById("budget-commit-btn").onclick=commitImport;
loadAccounts();
if(active==="import")fillImportAccounts();
})();
</script>`;

  return page({ title: "Budget", active: "/budget", nav, body });
}

function cardImportWizard(): string {
  return `<div class="card card-sm">${field({
    label: "Account",
    id: "budget-import-account",
    inputHtml: '<select id="budget-import-account"></select>',
  })}${field({
    label: "CSV file",
    id: "budget-import-file",
    hint: "Up to 5 MB. The server stores only normalized rows, not the original file.",
    inputHtml: '<input id="budget-import-file" type="file" accept=".csv,text/csv">',
  })}
<p id="budget-invert-hint" class="dim" hidden><label><input type="checkbox" id="budget-invert-confirm"> Flip sign for credit-card charges (recommended)</label></p>
<div class="row">${button({ label: "Preview", attrs: { id: "budget-preview-btn", type: "button" } })}${button({
    label: "Import",
    variant: "secondary",
    attrs: { id: "budget-commit-btn", type: "button" },
  })}</div>
<table class="ui-table" id="budget-preview-table" hidden><thead><tr><th>Row</th><th>Date</th><th>Amount</th><th>Payee</th><th>Status</th></tr></thead><tbody></tbody></table></div>`;
}
