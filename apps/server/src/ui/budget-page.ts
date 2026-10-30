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

  const body = `${pageHeader({ title: "Budget", description: "CSV import and accounts (owner-only)." })}
${viewTabs(initialView === "overview" ? "overview" : initialView)}
<div id="budget-status" class="workspace-status" role="status"></div>
<section id="budget-panel-accounts" class="budget-panel">${accountsEmpty}</section>
<section id="budget-panel-placeholder" class="budget-panel" hidden>${comingSoon}</section>
<section id="budget-panel-import" class="budget-panel" hidden>
${cardImportWizard()}
</section>
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
function textCell(tr,text){var td=document.createElement("td");td.textContent=text;tr.appendChild(td);}
var state={accounts:[],preview:null,dateFormatTouched:false};
function importDateFormatFor(accountId){
  var acct=state.accounts.find(function(a){return a.id===accountId;});
  return (acct&&acct.importDateFormat)||"MM/DD/YYYY";
}
function syncImportDateFormat(){
  var accountSel=document.getElementById("budget-import-account");
  var dateSel=document.getElementById("budget-date-format");
  if(!accountSel||!dateSel||state.dateFormatTouched)return;
  dateSel.value=importDateFormatFor(accountSel.value);
}
function renderAccounts(){
  var box=document.getElementById("budget-panel-accounts");
  if(!state.accounts.length){
    box.innerHTML=${JSON.stringify(accountsEmpty)};
    var btn=document.getElementById("budget-add-account");if(btn)btn.onclick=openAccountDialog;return;
  }
  box.replaceChildren();
  var toolbar=document.createElement("div");toolbar.className="row";toolbar.style.marginBottom="1rem";
  var addBtn=document.createElement("button");addBtn.type="button";addBtn.className="btn";addBtn.id="budget-add-account";addBtn.textContent="Add account";
  addBtn.onclick=openAccountDialog;toolbar.appendChild(addBtn);box.appendChild(toolbar);
  var table=document.createElement("table");table.className="ui-table";
  var thead=document.createElement("thead");var hr=document.createElement("tr");
  ["Name","Type","Balance",""].forEach(function(h){var th=document.createElement("th");th.scope="col";th.textContent=h;hr.appendChild(th);});
  thead.appendChild(hr);table.appendChild(thead);
  var tbody=document.createElement("tbody");
  state.accounts.forEach(function(a){
    var tr=document.createElement("tr");
    textCell(tr,a.name);textCell(tr,a.type);
    var bal=a.type==="investment"?(a.currentBalanceCents||0):a.openingBalanceCents;
    var tdBal=document.createElement("td");tdBal.className="tabular-nums";tdBal.textContent=fmt(bal);tr.appendChild(tdBal);
    var tdAct=document.createElement("td");
    var imp=document.createElement("button");imp.type="button";imp.className="ghost btn-sm";imp.textContent="Import";imp.dataset.import=a.id;
    if(a.type==="investment")imp.disabled=true;
    imp.onclick=function(){location.href="/budget?view=import&account="+a.id;};
    tdAct.appendChild(imp);tr.appendChild(tdAct);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);box.appendChild(table);
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
  sel.onchange=function(){state.dateFormatTouched=false;syncImportDateFormat();};
  syncImportDateFormat();
}
function runPreview(){
  var accountId=document.getElementById("budget-import-account").value;
  var file=document.getElementById("budget-import-file").files[0];
  if(!accountId||!file){setStatus("Choose an account and CSV file.",true);return;}
  setStatus("Parsing…");
  var url="/api/budget/import/preview?accountId="+encodeURIComponent(accountId)+"&fileName="+encodeURIComponent(file.name);
  if(state.dateFormatTouched){
    url+="&dateFormat="+encodeURIComponent(document.getElementById("budget-date-format").value);
  }
  fetch(url,{method:"POST",headers:{"content-type":"text/csv","x-ah":"1"},body:file})
  .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||"preview failed");return j;});})
  .then(function(p){
    state.preview=p;
    setStatus("New: "+p.counts.newCount+", duplicates: "+p.counts.duplicateCount+", errors: "+p.counts.errorCount);
    var invertBox=document.getElementById("budget-invert-confirm");
    var useInvert=!!(p.invertSign||p.suggestInvertSign);
    invertBox.checked=useInvert;
    document.getElementById("budget-invert-hint").hidden=!useInvert&&!p.suggestInvertSign;
    if(p.mapping&&p.mapping.dateFormat){document.getElementById("budget-date-format").value=p.mapping.dateFormat;}
    document.getElementById("budget-preview-table").hidden=false;
    var tbody=document.querySelector("#budget-preview-table tbody");
    tbody.replaceChildren();
    p.sample.forEach(function(r){
      var tr=document.createElement("tr");
      textCell(tr,String(r.rowNumber));textCell(tr,r.date);textCell(tr,fmt(r.amountCents));textCell(tr,r.payee||"");textCell(tr,r.status);
      tbody.appendChild(tr);
    });
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
document.getElementById("budget-date-format").onchange=function(){state.dateFormatTouched=true;};
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
    label: "Date format",
    id: "budget-date-format",
    hint: "Must match the dates in your CSV. Uses each account's saved format until you change it.",
    inputHtml:
      '<select id="budget-date-format"><option value="MM/DD/YYYY">MM/DD/YYYY</option><option value="DD/MM/YYYY">DD/MM/YYYY</option><option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option></select>',
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
